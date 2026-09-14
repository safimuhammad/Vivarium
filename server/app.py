"""FastAPI live server for browser observers."""

from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import AsyncGenerator, AsyncIterator, Callable, Iterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, cast

import uvicorn
from dotenv import load_dotenv
from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from agents.decider import Decider
from bus.events import Event, ScopeType
from core.logging import configure_logging
from core.run_knobs import PROVIDER_CHOICES
from memory.vector_store import VectorStore
from observability.event_log import FeedReadResult, serialize_event
from observability.replay_archive import ReplayArchive, ReplayStreamName
from observability.snapshot import serialize_snapshot_for_run
from scripts.run import (
    DEFAULT_CONFIG,
    DEFAULT_DURATION,
    DEFAULT_MEMORY_ROOT,
    DEFAULT_PACE,
    DEFAULT_PROVIDER,
    DEFAULT_REFRESH_INTERVAL,
    DEFAULT_RUN_DIR,
    DEFAULT_SEED,
    DEFAULT_WORLD_TICK_INTERVAL,
    Simulation,
)
from server.recordings import (
    RecordingError,
    RecordingNotFoundError,
    RecordingPathError,
    RecordingSecurityError,
    iter_recording_file,
    list_recordings,
    load_recording,
    recording_metadata,
)
from server.run_config import (
    RunConfigError,
    validate_run_config,
)
from server.run_manager import RunHandle, RunManager, RunManagerSettings, RunNotStartedError

NDJSON_MEDIA_TYPE = "application/x-ndjson"
REPLAY_ARTIFACT_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
}
REPLAY_EVENT_DEFAULT_LIMIT = 512
REPLAY_EVENT_MAX_LIMIT = 600
REPLAY_CHECKPOINT_DEFAULT_LIMIT = 32
REPLAY_CHECKPOINT_MAX_LIMIT = 64
REPLAY_RESPONSE_MAX_BYTES = 320 * 1024
REPLAY_RESPONSE_TOO_LARGE_DETAIL = "Replay response exceeds the 320 KiB limit."

RUN_CONFIG_BODY: Any = Body(...)
"""Module-level body marker for ``POST /api/run/start``.

The raw decoded JSON is taken rather than a declared model so
:func:`~server.run_config.validate_run_config` owns every message the screen shows.
"""


@dataclass(frozen=True, slots=True)
class ServerSettings:
    """Configuration for one live API process.

    ``sse_heartbeat_interval`` is the maximum seconds of silence on an event stream
    before a keepalive frame is sent. Twenty minutes with no world event is normal
    here, so an idle stream must still prove it is alive; ``0`` disables it.

    ``autostart`` decides whether the process starts a run of its own. It **defaults
    to True** because every existing launcher depends on it -- ``scripts/live-observatory.js``,
    ``tests/frontend_live/live_api_server.py`` and the three ``tests/server`` suites all
    call ``create_app(...)`` and expect a world. Booting idle is therefore an explicit
    opt-in (``python -m server.app --idle``), not a changed default: it is what makes the
    configuration screen the FIRST mover, able to start the first run from its own
    ``RunConfig`` instead of replacing a run someone else configured with CLI flags.
    With ``autostart=False`` the ``seed``/``provider``/``duration`` settings are unused --
    the screen supplies them -- while ``memory_root``/``run_dir`` still say where a
    screen-started run writes.
    """

    config_path: str | Path = DEFAULT_CONFIG
    seed: int = DEFAULT_SEED
    provider: str = DEFAULT_PROVIDER
    model: str | None = None
    context_window: int | None = None
    pace: float = DEFAULT_PACE
    duration: float = DEFAULT_DURATION
    world_tick_interval: float = DEFAULT_WORLD_TICK_INTERVAL
    refresh_interval: float = DEFAULT_REFRESH_INTERVAL
    memory_root: str | Path = DEFAULT_MEMORY_ROOT
    run_dir: str | Path = DEFAULT_RUN_DIR
    feed_maxlen: int = 512
    sse_poll_interval: float = 0.25
    sse_heartbeat_interval: float = 15.0
    startup_timeout: float = 1.0
    shutdown_timeout: float = 5.0
    autostart: bool = True


def create_app(
    settings: ServerSettings | None = None,
    *,
    decider: Decider | None = None,
    vector_store_factory: Callable[[str], VectorStore] | None = None,
) -> FastAPI:
    """Create the live FastAPI app and own the simulation lifecycle."""
    resolved_settings = settings or ServerSettings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        manager = RunManager(
            _manager_settings(resolved_settings),
            decider=decider,
            vector_store_factory=vector_store_factory,
            on_run_changed=lambda handle: _bind_run_to_app_state(app, handle),
        )
        app.state.run_manager = manager
        if resolved_settings.autostart:
            handle = await manager.start_process_run(
                seed=resolved_settings.seed,
                provider=resolved_settings.provider,
                memory_root=resolved_settings.memory_root,
                duration=resolved_settings.duration,
            )
            await _wait_until_observable(
                handle.simulation,
                handle.task,
                timeout=resolved_settings.startup_timeout,
            )
        try:
            yield
        finally:
            await manager.shutdown()

    app = FastAPI(title="Vivarium Live API", version="1", lifespan=lifespan)

    @app.get("/api/run")
    async def get_run(request: Request) -> dict[str, object]:
        """Report the run honestly, including when there is not one.

        An idle process answers 200 ``{"status": "ready", "run_id": ""}`` rather than
        an error: "nothing is running yet" is a true state of this server, not a
        failure, and a viewer's first request must be able to learn it. ``run_id`` is
        the empty string because there is no run to name -- it keeps the body readable
        by the frontend's ``parseRunLifecycle`` (which requires a string) without
        inventing an id, and the frontend maps the unfamiliar ``ready`` to its own
        ``unknown``, which its launch poller already treats as "keep waiting".
        """
        manager = _get_manager(request)
        if manager.current is None:
            return {"schema": 1, "run_id": "", "status": "ready", "event_cursor": 0}
        sim = _get_simulation(request)
        return sim.run_context.to_metadata(
            world_time=sim.world.now(),
            event_cursor=sim.feed_log.current_cursor,
        )

    @app.post("/api/run/start", status_code=202)
    async def start_run(request: Request, payload: Any = RUN_CONFIG_BODY) -> dict[str, object]:
        """Start a run from a submitted configuration, replacing whatever was running.

        Returns 202 with the *new* ``run_id`` and ``status="starting"``: the world is
        assembled and its breathing tasks are launched, but the first breath has not
        landed yet. Observers learn it is live by polling ``GET /api/run``.
        """
        manager = _get_manager(request)
        region_names = {region.name for region in manager.world_config().regions}
        try:
            config = validate_run_config(payload, region_names=region_names)
        except RunConfigError as exc:
            raise HTTPException(status_code=422, detail=exc.to_detail()) from exc
        return await manager.start(config)

    @app.post("/api/run/stop", status_code=202)
    async def stop_run(request: Request) -> dict[str, object]:
        """Ask the current run to wind down gracefully.

        Returns 202 as soon as the run is signalled; the breathing loops then unwind
        through the runner's single shutdown path and a final checkpoint is written.
        """
        manager = _get_manager(request)
        try:
            return await manager.stop()
        except RunNotStartedError as exc:
            raise HTTPException(status_code=409, detail="No run has been started.") from exc

    @app.get("/api/run/config")
    async def get_run_config(request: Request) -> dict[str, object]:
        """Return the configuration the current run started with."""
        manager = _get_manager(request)
        try:
            handle = manager.require_run()
        except RunNotStartedError as exc:
            raise HTTPException(status_code=409, detail="No run has been started.") from exc
        return {
            "schema": 1,
            "run_id": handle.run_id,
            "status": handle.status,
            "config": handle.config.to_payload(),
            "derived": manager.derived_summary(handle.config),
            "warnings": list(handle.warnings),
        }

    @app.get("/api/run/defaults")
    async def get_run_defaults(request: Request) -> dict[str, object]:
        """Return the default configuration plus every knob's bounds and labels."""
        return _get_manager(request).defaults()

    @app.get("/api/world")
    async def get_world(request: Request) -> dict[str, object]:
        sim = _get_simulation(request)
        return serialize_snapshot_for_run(
            sim.world,
            sim.run_context,
            event_cursor=sim.feed_log.current_cursor,
        )

    @app.get("/api/events")
    async def get_events(
        request: Request,
        cursor: int = Query(0, ge=0),
    ) -> dict[str, object]:
        sim = _get_simulation(request)
        return _events_envelope(sim, cursor)

    @app.get("/api/events/stream")
    async def stream_events(
        request: Request,
        cursor: int = Query(0, ge=0),
        once: bool = Query(False),
    ) -> StreamingResponse:
        sim = _get_simulation(request)
        return StreamingResponse(
            _sse_events(
                request,
                sim,
                cursor,
                resolved_settings.sse_poll_interval,
                once=once,
                heartbeat_interval=resolved_settings.sse_heartbeat_interval,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )

    @app.get("/api/recordings")
    async def get_recordings() -> dict[str, object]:
        """List replayable historical runs without starting inference."""
        runs = await asyncio.to_thread(list_recordings, resolved_settings.run_dir)
        return {"runs": runs}

    @app.get("/api/recordings/{recording_id}/metadata.json")
    async def get_recording_metadata(recording_id: str) -> dict[str, object]:
        """Return generated safe metadata for one replayable recording."""
        try:
            return await asyncio.to_thread(
                recording_metadata,
                resolved_settings.run_dir,
                recording_id,
            )
        except RecordingPathError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RecordingSecurityError as exc:
            raise HTTPException(status_code=403, detail=str(exc)) from exc
        except RecordingNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RecordingError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @app.get("/api/recordings/{recording_id}/events.jsonl")
    def get_recording_events(recording_id: str) -> StreamingResponse:
        """Stream one validated recording's fixed events JSONL artifact."""
        return _recording_artifact_response(
            resolved_settings.run_dir,
            recording_id,
            "events.jsonl",
        )

    @app.get("/api/recordings/{recording_id}/snapshots.jsonl")
    def get_recording_snapshots(recording_id: str) -> StreamingResponse:
        """Stream one validated recording's fixed snapshots JSONL artifact."""
        return _recording_artifact_response(
            resolved_settings.run_dir,
            recording_id,
            "snapshots.jsonl",
        )

    @app.get("/api/replay/manifest")
    async def get_replay_manifest(request: Request) -> dict[str, object]:
        _reject_unexpected_query_params(request, allowed=frozenset())
        sim = _get_simulation(request)
        return await asyncio.to_thread(_replay_manifest, sim)

    @app.get("/api/replay/events")
    async def get_replay_events(
        request: Request,
        after: int = Query(0, ge=0),
        limit: int = Query(REPLAY_EVENT_DEFAULT_LIMIT, ge=1, le=REPLAY_EVENT_MAX_LIMIT),
    ) -> dict[str, object]:
        _reject_unexpected_query_params(request, allowed=frozenset({"after", "limit"}))
        sim = _get_simulation(request)
        return await asyncio.to_thread(_replay_events_page, sim, after=after, limit=limit)

    @app.get("/api/replay/checkpoints/latest")
    async def get_latest_replay_checkpoint(request: Request) -> dict[str, object]:
        _reject_unexpected_query_params(request, allowed=frozenset())
        sim = _get_simulation(request)
        return await asyncio.to_thread(_latest_checkpoint, sim)

    @app.get("/api/replay/checkpoints")
    async def get_replay_checkpoints(
        request: Request,
        before: int | None = Query(None, ge=1),
        limit: int = Query(
            REPLAY_CHECKPOINT_DEFAULT_LIMIT,
            ge=1,
            le=REPLAY_CHECKPOINT_MAX_LIMIT,
        ),
    ) -> dict[str, object]:
        _reject_unexpected_query_params(request, allowed=frozenset({"before", "limit"}))
        sim = _get_simulation(request)
        return await asyncio.to_thread(
            _replay_checkpoints_page,
            sim,
            before=before,
            limit=limit,
        )

    @app.get("/api/replay/artifacts/events")
    async def get_replay_events_artifact(request: Request) -> StreamingResponse:
        _reject_query_params(request)
        sim = _get_simulation(request)
        return _replay_artifact_response(
            sim.replay_archive,
            "events",
            sim.run_context.event_log_path,
            run_dir=sim.run_context.run_dir,
            expected_basename="events.jsonl",
            label="events",
        )

    @app.get("/api/replay/artifacts/snapshots")
    async def get_replay_snapshots_artifact(request: Request) -> StreamingResponse:
        _reject_query_params(request)
        sim = _get_simulation(request)
        return _replay_artifact_response(
            sim.replay_archive,
            "checkpoints",
            sim.run_context.snapshot_log_path,
            run_dir=sim.run_context.run_dir,
            expected_basename="snapshots.jsonl",
            label="snapshots",
        )

    return app


def _manager_settings(settings: ServerSettings) -> RunManagerSettings:
    """Translate process settings into the run manager's wiring.

    Args:
        settings: The resolved server settings.

    Returns:
        The :class:`~server.run_manager.RunManagerSettings` every run is built with.
    """
    return RunManagerSettings(
        config_path=settings.config_path,
        memory_root=settings.memory_root,
        run_dir=settings.run_dir,
        pace=settings.pace,
        world_tick_interval=settings.world_tick_interval,
        refresh_interval=settings.refresh_interval,
        feed_maxlen=settings.feed_maxlen,
        model=settings.model,
        context_window=settings.context_window,
        startup_timeout=settings.startup_timeout,
        shutdown_timeout=settings.shutdown_timeout,
    )


def _bind_run_to_app_state(app: FastAPI, handle: RunHandle) -> None:
    """Point ``app.state`` at the run that is now current.

    ``simulation`` / ``stop_event`` / ``run_task`` are part of the app's de-facto
    surface (the Playwright live-API harness freezes the world through them), so a
    replacing start must re-point them rather than leave them on the previous run.

    Args:
        app: The FastAPI application.
        handle: The newly launched run.

    Returns:
        None.
    """
    app.state.simulation = handle.simulation
    app.state.stop_event = handle.stop_event
    app.state.run_task = handle.task


async def _wait_until_observable(
    sim: Simulation,
    task: asyncio.Task[None],
    *,
    timeout: float,
) -> None:
    """Let startup publish the initial run event before the app accepts requests."""
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while sim.run_context.status != "running" or sim.feed_log.current_cursor == 0:
        if task.done() or loop.time() >= deadline:
            return
        await asyncio.sleep(0.001)


def _get_manager(request: Request) -> RunManager:
    """Return the run manager or report that startup has not completed.

    Args:
        request: The incoming request.

    Returns:
        The app's :class:`~server.run_manager.RunManager`.

    Raises:
        HTTPException: 503 if the lifespan has not installed one yet.
    """
    manager = getattr(request.app.state, "run_manager", None)
    if manager is None:
        raise HTTPException(status_code=503, detail="Simulation is not ready.")
    return cast(RunManager, manager)


def _get_simulation(request: Request) -> Simulation:
    """Return the live simulation or report that startup has not completed.

    Reads through the run manager so a replacing start is reflected immediately;
    ``app.state.simulation`` is kept in step for the harnesses that reach for it.

    Args:
        request: The incoming request.

    Returns:
        The current run's :class:`~scripts.run.Simulation`.

    Raises:
        HTTPException: 409 if the process is up but no run has been started (the
            idle state a screen-first server boots into -- the same conflict
            ``/api/run/config`` and ``/api/run/stop`` already report); 503 if the
            lifespan has not installed a manager at all, which is a genuinely
            incomplete startup rather than an honest idle.
    """
    manager = getattr(request.app.state, "run_manager", None)
    sim = manager.simulation if manager is not None else None
    if sim is None:
        sim = getattr(request.app.state, "simulation", None)
    if sim is None:
        if manager is None:
            raise HTTPException(status_code=503, detail="Simulation is not ready.")
        raise HTTPException(status_code=409, detail="No run has been started.")
    return cast(Simulation, sim)


def _reject_query_params(request: Request) -> None:
    """Reject browser-selected artifact names, paths, kinds, or other selectors."""
    if request.query_params:
        raise HTTPException(
            status_code=400,
            detail="Replay artifact endpoints do not accept query parameters.",
        )


def _reject_unexpected_query_params(request: Request, *, allowed: frozenset[str]) -> None:
    """Reject selectors outside the bounded replay contract."""
    unexpected = set(request.query_params) - allowed
    if unexpected:
        raise HTTPException(
            status_code=400,
            detail="Replay endpoint received unsupported query parameters.",
        )


def _replay_artifact_response(
    archive: ReplayArchive,
    stream: ReplayStreamName,
    artifact_path: Path,
    *,
    run_dir: Path,
    expected_basename: str,
    label: str,
) -> StreamingResponse:
    """Return a narrow current-run artifact stream after validating its configured path."""
    _validate_replay_artifact_path(
        artifact_path,
        run_dir=run_dir,
        expected_basename=expected_basename,
        label=label,
        require_file=True,
    )
    if not Path(run_dir).exists():
        raise HTTPException(status_code=404, detail=f"{label} artifact is missing.")
    if Path(run_dir).resolve(strict=False) != archive.run_dir.resolve(strict=False):
        raise HTTPException(status_code=403, detail=f"{label} archive is not the current run.")
    return StreamingResponse(
        _stream_archive_lines(archive, stream),
        media_type=NDJSON_MEDIA_TYPE,
        headers=REPLAY_ARTIFACT_HEADERS,
    )


def _recording_artifact_response(
    run_dir: str | Path,
    recording_id: str,
    artifact: str,
) -> StreamingResponse:
    """Validate and stream one fixed historical recording artifact."""
    try:
        load_recording(run_dir, recording_id)
    except RecordingPathError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RecordingSecurityError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RecordingNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RecordingError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return StreamingResponse(
        iter_recording_file(run_dir, recording_id, artifact),
        media_type=NDJSON_MEDIA_TYPE,
        headers=REPLAY_ARTIFACT_HEADERS,
    )


def _validate_replay_artifact_path(
    artifact_path: Path,
    *,
    run_dir: Path,
    expected_basename: str,
    label: str,
    require_file: bool = True,
) -> Path:
    """Resolve and validate one current-run replay artifact path."""
    configured_path = Path(artifact_path)
    if configured_path.name != expected_basename:
        raise HTTPException(
            status_code=500,
            detail=f"{label} artifact path is misconfigured.",
        )

    try:
        resolved_run_dir = Path(run_dir).resolve(strict=False)
        resolved_path = configured_path.resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=403,
            detail=f"{label} artifact path could not be safely resolved.",
        ) from exc
    expected_path = resolved_run_dir / expected_basename
    if resolved_path != expected_path:
        raise HTTPException(
            status_code=403,
            detail=f"{label} artifact path escapes the current run directory.",
        )
    if configured_path.is_symlink():
        raise HTTPException(
            status_code=403,
            detail=f"{label} artifact path must not be a symlink.",
        )
    if require_file and not configured_path.is_file():
        raise HTTPException(status_code=404, detail=f"{label} artifact is missing.")
    return resolved_path


def _stream_file_handle(handle: BinaryIO, chunk_size: int = 1024 * 64) -> Iterator[bytes]:
    """Yield a file in bounded chunks and close it when streaming completes."""
    with handle:
        yield from iter(lambda: handle.read(chunk_size), b"")


def _stream_archive_lines(
    archive: ReplayArchive,
    stream: ReplayStreamName,
) -> Iterator[bytes]:
    """Yield every archived record in original JSONL byte order."""
    for _, line in archive.iter_lines(stream):
        yield line


def _replay_manifest(sim: Simulation) -> dict[str, object]:
    """Return bounded replay counts and cursors without local filesystem paths."""
    archive = sim.replay_archive
    summary = archive.summary()
    event_count = summary.event_count
    checkpoint_count = summary.checkpoint_count
    return _bounded_replay_response(
        {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "events": {
                "count": event_count,
                "first_cursor": 1 if event_count else None,
                "last_cursor": event_count if event_count else None,
            },
            "checkpoints": {
                "count": checkpoint_count,
                "first_line": 1 if checkpoint_count else None,
                "last_line": checkpoint_count if checkpoint_count else None,
                "first_event_cursor": summary.first_checkpoint_event_cursor,
                "last_event_cursor": summary.last_checkpoint_event_cursor,
            },
            "bootstrap": {
                "event_after": max(0, event_count - REPLAY_EVENT_DEFAULT_LIMIT),
                "event_limit": REPLAY_EVENT_DEFAULT_LIMIT,
            },
        }
    )


def _replay_events_page(sim: Simulation, *, after: int, limit: int) -> dict[str, object]:
    """Return at most ``limit`` durable events after one line cursor.

    Like :func:`_replay_checkpoints_page`, the page is **clamped to the server's own
    byte budget** rather than refused. A client asking for the full ``limit`` of real
    events can exceed :data:`REPLAY_RESPONSE_MAX_BYTES` -- measured headroom was only
    ~15% (about 597 events against a 512-event request), and ``speak`` payloads, the
    variable ones, have since grown -- and answering that with a 413 permanently stalls
    a replay the frontend marks non-retryable.

    Events page **forward**, so the surviving window is the OLDEST contiguous prefix:
    it still begins at ``after + 1``, ``next_after`` names the newest record returned,
    and ``has_more`` stays true so the client walks forward for the rest. Dropping from
    the other end would leave a hole between ``after`` and the first cursor returned,
    and a hole in a replay is silent world drift. A single record that cannot fit even
    alone is still a 413 (:func:`_ensure_replay_record_fits`): no page size rescues it,
    and dropping it silently would be a lie.

    Args:
        sim: The live simulation whose replay archive is read.
        after: Exclusive lower line cursor.
        limit: Maximum records requested by the client.

    Returns:
        A JSON-ready page envelope with ``events``, ``next_after``, ``has_more`` and
        ``truncated``.
    """
    archive = sim.replay_archive
    count = archive.record_count("events")
    last_line = min(count, after + limit)
    records = list(
        archive.iter_lines("events", first_line=after + 1, last_line=last_line)
        if after < count
        else ()
    )
    for _, line in records:
        _ensure_replay_record_fits(line)
    events = [_event_envelope(_deserialize_event(line), cursor=cursor) for cursor, line in records]
    kept = _fit_event_records(sim.run_context.run_id, after, count, events)
    next_after = cast(int, kept[-1]["cursor"]) if kept else after
    return _bounded_replay_response(
        {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "after": after,
            "next_after": next_after,
            "has_more": next_after < count,
            "truncated": len(kept) < len(events),
            "events": kept,
        }
    )


def _fit_event_records(
    run_id: str,
    after: int,
    count: int,
    records: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Return the oldest prefix of ``records`` whose encoded page fits the byte budget.

    Records are dropped from the NEWEST end so the surviving page stays contiguous and
    still begins at ``after + 1``; ``next_after`` then points at the newest survivor and
    the client pages forward for the rest. A single record over budget is left in place
    so the caller's :func:`_ensure_replay_record_fits` guard still reports it.

    Args:
        run_id: Run id echoed in the envelope (part of the measured overhead).
        after: The page's exclusive lower line cursor.
        count: Total durable events, which decides ``has_more``.
        records: The decoded page, oldest first.

    Returns:
        The kept records, oldest first (possibly the whole list, possibly empty).
    """
    if not records:
        return records
    kept = records
    while len(kept) > 1 and _encoded_event_page_size(run_id, after, count, kept) > (
        REPLAY_RESPONSE_MAX_BYTES
    ):
        kept = kept[:-1]
    return kept


def _encoded_event_page_size(
    run_id: str,
    after: int,
    count: int,
    records: list[dict[str, object]],
) -> int:
    """Return the encoded byte length of a candidate event page."""
    next_after = cast(int, records[-1]["cursor"]) if records else after
    return _encoded_size(
        {
            "schema": 1,
            "run_id": run_id,
            "after": after,
            "next_after": next_after,
            "has_more": next_after < count,
            "truncated": True,
            "events": records,
        }
    )


def _latest_checkpoint(sim: Simulation) -> dict[str, object]:
    """Return the latest exact checkpoint or report an empty archive."""
    count = sim.replay_archive.record_count("checkpoints")
    if count == 0:
        raise HTTPException(status_code=404, detail="No replay checkpoint is available.")
    return _bounded_replay_response(
        {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "line": count,
            "checkpoint": _checkpoint_at(sim.replay_archive, count),
        }
    )


def _replay_checkpoints_page(
    sim: Simulation,
    *,
    before: int | None,
    limit: int,
) -> dict[str, object]:
    """Return an oldest-to-newest page before an exclusive checkpoint line.

    The page is **clamped to the server's own byte budget** rather than refused: a
    client asking for the full ``limit`` of real checkpoints can easily exceed
    :data:`REPLAY_RESPONSE_MAX_BYTES`, and answering that with a 413 permanently stalls
    reconciliation. Instead the newest records that fit are returned, ``truncated`` says
    so, and ``next_before`` still names the oldest record in the page, so paging
    backwards from it reaches everything that was dropped. A record that cannot fit even
    alone is still a 413 (:func:`_ensure_replay_record_fits`) -- no page size can rescue
    it, so silently dropping it would be a lie.

    Args:
        sim: The live simulation whose replay archive is read.
        before: Exclusive upper line cursor; ``None`` means "from the newest".
        limit: Maximum records requested by the client.

    Returns:
        A JSON-ready page envelope with ``checkpoints``, ``next_before``, ``has_more``
        and ``truncated``.
    """
    archive = sim.replay_archive
    count = archive.record_count("checkpoints")
    effective_before = min(before if before is not None else count + 1, count + 1)
    last_line = effective_before - 1
    first_line = max(1, effective_before - limit)
    records = list(
        archive.iter_lines("checkpoints", first_line=first_line, last_line=last_line)
        if last_line >= 1
        else ()
    )
    for _, line in records:
        _ensure_replay_record_fits(line)
    decoded = [
        {"line": line_number, "checkpoint": _decode_checkpoint(line, archive.run_id)}
        for line_number, line in records
    ]
    kept = _fit_checkpoint_records(sim.run_context.run_id, effective_before, decoded)
    next_before = cast(int, kept[0]["line"]) if kept else effective_before
    return _bounded_replay_response(
        {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "before": effective_before,
            "next_before": next_before,
            "has_more": bool(kept) and next_before > 1,
            "truncated": len(kept) < len(decoded),
            "checkpoints": kept,
        }
    )


def _fit_checkpoint_records(
    run_id: str,
    effective_before: int,
    records: list[dict[str, object]],
) -> list[dict[str, object]]:
    """Return the newest suffix of ``records`` whose encoded page fits the byte budget.

    Records are dropped from the OLDEST end so the surviving page stays contiguous and
    ends at ``effective_before - 1``; ``next_before`` then points at the oldest survivor
    and the client pages backwards for the rest. A single record over budget is left in
    place so the caller's :func:`_ensure_replay_record_fits` guard still reports it.

    Args:
        run_id: Run id echoed in the envelope (part of the measured overhead).
        effective_before: The page's exclusive upper line cursor.
        records: The decoded page, oldest first.

    Returns:
        The kept records, oldest first (possibly the whole list, possibly empty).
    """
    if not records:
        return records
    kept = records
    while len(kept) > 1 and _encoded_page_size(run_id, effective_before, kept) > (
        REPLAY_RESPONSE_MAX_BYTES
    ):
        kept = kept[1:]
    return kept


def _encoded_page_size(
    run_id: str,
    effective_before: int,
    records: list[dict[str, object]],
) -> int:
    """Return the encoded byte length of a candidate checkpoint page."""
    next_before = cast(int, records[0]["line"]) if records else effective_before
    return _encoded_size(
        {
            "schema": 1,
            "run_id": run_id,
            "before": effective_before,
            "next_before": next_before,
            "has_more": bool(records) and next_before > 1,
            "truncated": True,
            "checkpoints": records,
        }
    )


def _encoded_size(payload: dict[str, object]) -> int:
    """Return the byte length of ``payload`` encoded exactly as the response will be.

    Shared by every page-fitting helper and by :func:`_bounded_replay_response`, so a
    candidate page is measured with the *same* separators and escaping as the bytes
    that are finally sent. Measuring differently is how a clamp trips its own final
    bound check.
    """
    return len(
        json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )


def _checkpoint_at(archive: ReplayArchive, line_number: int) -> dict[str, object]:
    records = list(
        archive.iter_lines(
            "checkpoints",
            first_line=line_number,
            last_line=line_number,
        )
    )
    if len(records) != 1:
        raise HTTPException(status_code=500, detail="Replay checkpoint index is inconsistent.")
    _ensure_replay_record_fits(records[0][1])
    return _decode_checkpoint(records[0][1], archive.run_id)


def _ensure_replay_record_fits(line: bytes) -> None:
    if len(line) > REPLAY_RESPONSE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=REPLAY_RESPONSE_TOO_LARGE_DETAIL)


def _bounded_replay_response(payload: dict[str, object]) -> dict[str, object]:
    if _encoded_size(payload) > REPLAY_RESPONSE_MAX_BYTES:
        raise HTTPException(status_code=413, detail=REPLAY_RESPONSE_TOO_LARGE_DETAIL)
    return payload


def _decode_checkpoint(line: bytes, run_id: str) -> dict[str, object]:
    try:
        value = json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Replay checkpoint is malformed.") from exc
    if not isinstance(value, dict) or value.get("run_id") != run_id:
        raise HTTPException(status_code=500, detail="Replay checkpoint belongs to another run.")
    return cast(dict[str, object], value)


def _deserialize_event(line: bytes) -> Event:
    try:
        value = json.loads(line)
        if not isinstance(value, dict) or not isinstance(value["payload"], dict):
            raise TypeError
        return Event(
            type=str(value["type"]),
            source=str(value["source"]),
            payload=cast(dict[str, Any], value["payload"]),
            scope=ScopeType(str(value["scope"])),
            region=cast(str | None, value.get("region")),
            target=cast(str | None, value.get("target")),
            timestamp=float(value["timestamp"]),
        )
    except (KeyError, TypeError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Replay event is malformed.") from exc


def _events_envelope(sim: Simulation, cursor: int) -> dict[str, object]:
    """Return the HTTP/SSE event envelope for ``cursor``."""
    result = sim.feed_log.read_events(cursor)
    return _read_result_envelope(result)


def _read_result_envelope(result: FeedReadResult) -> dict[str, object]:
    first_event_cursor = result.next_cursor - len(result.events) + 1
    events = [
        _event_envelope(event, cursor=first_event_cursor + index)
        for index, event in enumerate(result.events)
    ]
    return {
        "schema": 1,
        "cursor": result.requested_cursor,
        "oldest_cursor": result.oldest_cursor,
        "next_cursor": result.next_cursor,
        "events": events,
        "overflow": result.overflow,
        "snapshot_required": result.snapshot_required,
    }


def _event_envelope(event: Event, *, cursor: int) -> dict[str, object]:
    return {
        "cursor": cursor,
        "event": serialize_event(event),
        "resolved": _resolve_event(event),
        "snapshot_after": None,
    }


def _resolve_event(event: Event) -> dict[str, object]:
    """Return a best-effort structured summary without parsing event prose."""
    payload = event.payload
    resolved: dict[str, object] = {}
    actor_id = _first_payload(
        payload,
        (
            "actor_id",
            "attacker_id",
            "sender_id",
            "giver_id",
            "builder_id",
            "breacher_id",
            "speaker_id",
            "initiator_id",
            "rejecter_id",
            "agent_id",
            "killer_id",
        ),
    )
    if actor_id is None and event.source not in {"system", "world"}:
        actor_id = event.source
    _put_if_present(resolved, "actor_id", actor_id)
    _put_if_present(
        resolved,
        "target_id",
        event.target
        or _first_payload(
            payload,
            (
                "target_id",
                "receiver_id",
                "recipient_id",
                "revived_id",
                "victim_id",
                "acceptor_id",
            ),
        ),
    )
    _put_if_present(resolved, "region", event.region or payload.get("region"))
    _put_if_present(resolved, "home_id", payload.get("home_id") or payload.get("target_home"))
    _put_if_present(resolved, "amount", payload.get("amount"))
    _put_if_present(resolved, "resource_type", payload.get("resource_type"))
    return resolved


def _first_payload(payload: dict[str, Any], keys: Sequence[str]) -> object | None:
    for key in keys:
        value = payload.get(key)
        if value is not None:
            return cast(object, value)
    return None


def _put_if_present(target: dict[str, object], key: str, value: object | None) -> None:
    if value is not None:
        target[key] = value


async def _sse_events(
    request: Request,
    sim: Simulation,
    cursor: int,
    poll_interval: float,
    *,
    once: bool,
    heartbeat_interval: float = 0.0,
) -> AsyncGenerator[str]:
    """Yield server-sent event envelopes, with a keepalive while the world is quiet.

    A world with nothing happening is the normal case here, and an idle stream that
    yields no bytes at all is indistinguishable from a dead connection. After
    ``heartbeat_interval`` seconds without a data frame, a named ``heartbeat`` frame
    is emitted instead. It deliberately carries **no** ``id:`` line, so neither the
    server's cursor nor an ``EventSource``'s ``lastEventId`` is disturbed, and its
    distinct event name means listeners bound to ``events``/``message`` never see it.

    Args:
        request: The client request, polled for disconnection.
        sim: The live simulation whose feed is read.
        cursor: Cursor to start delivering from.
        poll_interval: Seconds between feed polls.
        once: Return after the first poll (used by tests and one-shot clients).
        heartbeat_interval: Maximum seconds of silence before a keepalive frame;
            ``0`` (the default) disables heartbeats.

    Yields:
        Formatted SSE frames.
    """
    loop = asyncio.get_running_loop()
    next_cursor = cursor
    last_frame_at = loop.time()
    while True:
        if await request.is_disconnected():
            return
        envelope = _events_envelope(sim, next_cursor)
        if cast(list[object], envelope["events"]) or envelope["overflow"]:
            next_cursor = cast(int, envelope["next_cursor"])
            yield _format_sse(envelope)
            last_frame_at = loop.time()
            if once:
                return
        elif once:
            return
        elif heartbeat_interval > 0 and loop.time() - last_frame_at >= heartbeat_interval:
            yield _format_sse_heartbeat(sim, next_cursor)
            last_frame_at = loop.time()
        await asyncio.sleep(poll_interval)


def _format_sse(envelope: dict[str, object]) -> str:
    """Return one SSE frame containing an events envelope."""
    next_cursor = cast(int, envelope["next_cursor"])
    payload = json.dumps(envelope, allow_nan=False, default=str)
    return f"id: {next_cursor}\nevent: events\ndata: {payload}\n\n"


def _format_sse_heartbeat(sim: Simulation, cursor: int) -> str:
    """Return one keepalive frame proving a quiet stream is still alive.

    Args:
        sim: The live simulation, read for the world clock and run status.
        cursor: The cursor the stream is currently caught up to.

    Returns:
        A named ``heartbeat`` SSE frame with no ``id:`` line.
    """
    payload = json.dumps(
        {
            "schema": 1,
            "cursor": cursor,
            "world_time": sim.world.now(),
            "status": sim.run_context.status,
        },
        allow_nan=False,
        default=str,
    )
    return f"event: heartbeat\ndata: {payload}\n\n"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vivarium-server",
        description="Run the Vivarium browser-facing live API.",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument(
        "--provider",
        default=DEFAULT_PROVIDER,
        choices=PROVIDER_CHOICES,
        help="Decider backend: local 'mlx' (default), local 'ollama', or hosted 'gemini'.",
    )
    parser.add_argument("--model", default=None)
    parser.add_argument("--context-tokens", type=int, default=None)
    parser.add_argument("--pace", type=float, default=DEFAULT_PACE)
    parser.add_argument("--duration", type=float, default=DEFAULT_DURATION)
    parser.add_argument("--world-tick-interval", type=float, default=DEFAULT_WORLD_TICK_INTERVAL)
    parser.add_argument("--refresh-interval", type=float, default=DEFAULT_REFRESH_INTERVAL)
    parser.add_argument("--memory-root", default=DEFAULT_MEMORY_ROOT)
    parser.add_argument("--run-dir", default=DEFAULT_RUN_DIR)
    parser.add_argument(
        "--idle",
        action="store_true",
        help=(
            "Boot with no run. The server reports status 'ready' and waits for "
            "POST /api/run/start, so the browser's configuration screen starts the "
            "first world. --seed/--provider/--duration are then unused."
        ),
    )
    return parser


def settings_from_cli(argv: Sequence[str] | None = None) -> ServerSettings:
    """Translate command-line arguments into :class:`ServerSettings`.

    Split out of :func:`main` so the flags a user actually types are covered by tests
    rather than by process-launching glue.

    Args:
        argv: Argument vector, or ``None`` to read ``sys.argv``.

    Returns:
        The settings the app will be created with.
    """
    args = _build_parser().parse_args(argv)
    return ServerSettings(
        config_path=args.config,
        seed=args.seed,
        provider=args.provider,
        model=args.model,
        context_window=args.context_tokens,
        pace=args.pace,
        duration=args.duration,
        world_tick_interval=args.world_tick_interval,
        refresh_interval=args.refresh_interval,
        memory_root=args.memory_root,
        run_dir=args.run_dir,
        autostart=not args.idle,
    )


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover - live server glue
    """CLI entrypoint for the live API server."""
    args = _build_parser().parse_args(argv)
    load_dotenv()
    configure_logging()
    uvicorn.run(create_app(settings_from_cli(argv)), host=args.host, port=args.port)
    return 0


if __name__ == "__main__":  # pragma: no cover - module executed as a script
    import sys

    sys.exit(main())
