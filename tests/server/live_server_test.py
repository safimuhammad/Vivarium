"""Tests for the browser-facing live FastAPI server."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any, cast

import pytest
from fastapi.testclient import TestClient

from agents.decider import Decision, ToolCall
from bus.events import Event, ScopeType
from core.constants import (
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_COOLDOWN_SECONDS,
    RUINS_PERSIST_SECONDS,
)
from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import FakeVectorStore, VectorStore
from scripts.run import Simulation
from server.app import ServerSettings, _sse_events, create_app
from tests.conftest import MockDecider


def _fake_factory(_agent_id: str) -> VectorStore:
    return FakeVectorStore(FakeEmbeddingFunction())


def _settings(tmp_path: Path, *, feed_maxlen: int = 16) -> ServerSettings:
    return ServerSettings(
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        duration=10.0,
        pace=0.0,
        world_tick_interval=60.0,
        refresh_interval=0.05,
        feed_maxlen=feed_maxlen,
        sse_poll_interval=0.01,
    )


def _client(tmp_path: Path, *, feed_maxlen: int = 16) -> TestClient:
    app = create_app(
        _settings(tmp_path, feed_maxlen=feed_maxlen),
        decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])] * 100),
        vector_store_factory=_fake_factory,
    )
    return TestClient(app)


def _sim(client: TestClient) -> Simulation:
    app = cast(Any, client.app)
    return cast(Simulation, app.state.simulation)


def _assert_ndjson_artifact_headers(response: Any) -> None:
    assert response.headers["content-type"].startswith("application/x-ndjson")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_live_server_exposes_run_and_world_contracts(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        run = client.get("/api/run")
        assert run.status_code == 200
        run_body = run.json()
        assert run_body["schema"] == 1
        assert run_body["run_id"]
        assert run_body["seed"] == 7
        assert run_body["status"] == "running"
        assert run_body["event_cursor"] >= 1
        assert run_body["artifacts"]["snapshots"].endswith("snapshots.jsonl")
        assert run_body["constants"]["mating_cooldown_seconds"] == MATING_COOLDOWN_SECONDS
        assert run_body["constants"]["ruins_persist_seconds"] == RUINS_PERSIST_SECONDS
        assert (
            run_body["constants"]["home_upkeep_materials_per_second"]
            == HOME_UPKEEP_MATERIALS_PER_SECOND
        )

        world = client.get("/api/world")
        assert world.status_code == 200
        snapshot = world.json()
        assert snapshot["schema"] == 1
        assert snapshot["run_id"] == run_body["run_id"]
        assert snapshot["event_cursor"] == run_body["event_cursor"]
        assert snapshot["agents"]
        assert snapshot["regions"]

    assert _sim(client).run_context.status == "stopped"


def test_live_server_events_endpoint_returns_enriched_cursor_envelope(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        response = client.get("/api/events?cursor=0")
        assert response.status_code == 200
        body = response.json()
        assert body["schema"] == 1
        assert body["cursor"] == 0
        assert body["oldest_cursor"] == 0
        assert body["next_cursor"] >= 1
        assert body["overflow"] is False
        assert body["snapshot_required"] is False
        assert body["events"]
        first = body["events"][0]
        assert first["cursor"] == 1
        assert first["event"]["type"] == "simulation_started"
        assert first["event"]["scope"] == "global"
        assert first["resolved"] == {}
        assert first["snapshot_after"] is None


def test_live_server_events_endpoint_reports_overflow(tmp_path: Path) -> None:
    with _client(tmp_path, feed_maxlen=2) as client:
        sim = _sim(client)
        for index in range(3):
            sim.feed_log.record(
                Event(
                    f"synthetic_{index}",
                    "world",
                    {"message": str(index)},
                    scope=ScopeType.GLOBAL,
                    timestamp=float(index),
                )
            )

        response = client.get("/api/events?cursor=0")
        assert response.status_code == 200
        body = response.json()
        assert body["overflow"] is True
        assert body["snapshot_required"] is True
        assert body["oldest_cursor"] > 0
        assert [item["event"]["type"] for item in body["events"]] == [
            "synthetic_1",
            "synthetic_2",
        ]


def test_live_server_sse_stream_emits_event_envelope(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        with client.stream("GET", "/api/events/stream?cursor=0&once=true") as response:
            assert response.status_code == 200
            data_line = ""
            for line in response.iter_lines():
                if line.startswith("data: "):
                    data_line = line
                    break

        assert data_line
        envelope = json.loads(data_line.removeprefix("data: "))
        assert envelope["schema"] == 1
        assert envelope["next_cursor"] >= 1
        assert envelope["events"][0]["event"]["type"] == "simulation_started"


def test_live_server_streams_replay_event_and_snapshot_artifacts(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        events = client.get("/api/replay/artifacts/events")
        assert events.status_code == 200
        _assert_ndjson_artifact_headers(events)
        event_rows = [json.loads(line) for line in events.text.splitlines()]
        assert any(row["type"] == "simulation_started" for row in event_rows)

        snapshots = client.get("/api/replay/artifacts/snapshots")
        assert snapshots.status_code == 200
        _assert_ndjson_artifact_headers(snapshots)
        snapshot_rows = [json.loads(line) for line in snapshots.text.splitlines()]
        assert any(
            row["type"] == "world_snapshot_checkpoint"
            and row["reason"] == "event:simulation_started"
            for row in snapshot_rows
        )


def test_live_server_replay_artifact_missing_file_returns_404(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        missing_run_dir = tmp_path / "missing-run"
        sim.run_context.run_dir = missing_run_dir
        sim.run_context.event_log_path = missing_run_dir / "events.jsonl"

        response = client.get("/api/replay/artifacts/events")

        assert response.status_code == 404
        assert response.json()["detail"] == "events artifact is missing."


def test_live_server_replay_artifact_traversal_escape_is_rejected(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        outside = tmp_path / "outside"
        outside.mkdir()
        escaped = outside / "events.jsonl"
        escaped.write_text('{"type":"usage_secret"}\n', encoding="utf-8")
        sim.run_context.event_log_path = (
            sim.run_context.run_dir / ".." / outside.name / escaped.name
        )

        response = client.get("/api/replay/artifacts/events")

        assert response.status_code == 403
        assert "usage_secret" not in response.text


def test_live_server_replay_artifact_symlink_escape_is_rejected(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        outside = tmp_path / "outside-symlink"
        outside.mkdir()
        escaped = outside / "events.jsonl"
        escaped.write_text('{"type":"usage_secret"}\n', encoding="utf-8")
        isolated_run_dir = tmp_path / "symlink-run"
        isolated_run_dir.mkdir()
        link = isolated_run_dir / escaped.name
        try:
            link.symlink_to(escaped)
        except OSError as exc:
            pytest.skip(f"symlink creation unavailable: {exc}")
        sim.run_context.run_dir = isolated_run_dir
        sim.run_context.event_log_path = link

        response = client.get("/api/replay/artifacts/events")

        assert response.status_code == 403
        assert "usage_secret" not in response.text


def test_live_server_replay_artifacts_do_not_expose_usage_memory_or_config(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        assert client.get("/api/replay/artifacts/usage").status_code == 404

        for query in (
            "path=/etc/passwd",
            "kind=usage",
            "artifact=memory_root",
            "file=config.yaml",
        ):
            response = client.get(f"/api/replay/artifacts/events?{query}")
            assert response.status_code == 400
            assert response.json()["detail"] == (
                "Replay artifact endpoints do not accept query parameters."
            )


def _append_archive_events(sim: Simulation, count: int) -> None:
    for index in range(count):
        sim.replay_archive.record(
            Event(
                "synthetic",
                "world",
                {"message": f"event-{index}"},
                scope=ScopeType.GLOBAL,
                timestamp=float(index),
            )
        )


def test_replay_manifest_exposes_bounded_cursor_metadata_without_paths(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        initial_checkpoint_count = sim.replay_archive.record_count("checkpoints")
        _append_archive_events(sim, 5)
        sim.snapshot_log.write_snapshot(sim.world, sim.run_context, event_cursor=3, reason="manual")
        sim.snapshot_log.write_snapshot(sim.world, sim.run_context, event_cursor=3, reason="manual")
        sim.snapshot_log.write_snapshot(sim.world, sim.run_context, event_cursor=6, reason="manual")

        response = client.get("/api/replay/manifest")

        assert response.status_code == 200
        assert response.json() == {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "events": {"count": 6, "first_cursor": 1, "last_cursor": 6},
            "checkpoints": {
                "count": initial_checkpoint_count + 3,
                "first_line": 1,
                "last_line": initial_checkpoint_count + 3,
                "first_event_cursor": 1,
                "last_event_cursor": 6,
            },
            "bootstrap": {"event_after": 0, "event_limit": 512},
        }
        assert str(tmp_path) not in response.text


def test_replay_events_page_reads_closed_segments_in_cursor_order(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        sim.replay_archive.max_segment_bytes = 1
        _append_archive_events(sim, 10)

        response = client.get("/api/replay/events?after=3&limit=4")

        assert response.status_code == 200
        body = response.json()
        assert body["schema"] == 1
        assert body["run_id"] == sim.run_context.run_id
        assert body["after"] == 3
        assert body["next_after"] == 7
        assert body["has_more"] is True
        assert [entry["cursor"] for entry in body["events"]] == [4, 5, 6, 7]
        assert all(entry["event"]["type"] == "synthetic" for entry in body["events"])


def test_replay_latest_checkpoint_returns_raw_exact_record(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        initial_checkpoint_count = sim.replay_archive.record_count("checkpoints")
        expected = sim.snapshot_log.write_snapshot(
            sim.world, sim.run_context, event_cursor=7, reason="manual"
        )

        response = client.get("/api/replay/checkpoints/latest")

        assert response.status_code == 200
        assert response.json() == {
            "schema": 1,
            "run_id": sim.run_context.run_id,
            "line": initial_checkpoint_count + 1,
            "checkpoint": expected,
        }


def test_replay_checkpoint_pages_use_exclusive_line_cursor(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        initial_checkpoint_count = sim.replay_archive.record_count("checkpoints")
        for event_cursor in (2, 2, 3, 4):
            sim.snapshot_log.write_snapshot(
                sim.world,
                sim.run_context,
                event_cursor=event_cursor,
                reason="manual",
            )

        before = initial_checkpoint_count + 4
        response = client.get(f"/api/replay/checkpoints?before={before}&limit=2")

        assert response.status_code == 200
        body = response.json()
        assert body["run_id"] == sim.run_context.run_id
        assert body["before"] == before
        assert body["next_before"] == initial_checkpoint_count + 2
        assert body["has_more"] is True
        assert [entry["line"] for entry in body["checkpoints"]] == [
            initial_checkpoint_count + 2,
            initial_checkpoint_count + 3,
        ]
        assert [entry["checkpoint"]["event_cursor"] for entry in body["checkpoints"]] == [2, 3]

        oldest = client.get(f"/api/replay/checkpoints?before={body['next_before']}&limit=64").json()
        assert oldest["next_before"] == 1
        assert oldest["has_more"] is False
        assert [entry["line"] for entry in oldest["checkpoints"]] == list(
            range(1, initial_checkpoint_count + 2)
        )


@pytest.mark.parametrize(
    "path",
    [
        "/api/replay/events?after=-1",
        "/api/replay/events?limit=0",
        "/api/replay/events?limit=601",
        "/api/replay/checkpoints?before=0",
        "/api/replay/checkpoints?limit=0",
        "/api/replay/checkpoints?limit=65",
    ],
)
def test_bounded_replay_endpoints_validate_cursor_and_limit_bounds(
    tmp_path: Path,
    path: str,
) -> None:
    with _client(tmp_path) as client:
        assert client.get(path).status_code == 422


def test_bounded_replay_endpoints_reject_arbitrary_path_selectors(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        assert client.get("/api/replay/manifest?path=/etc/passwd").status_code == 400
        assert client.get("/api/replay/events?after=0&limit=1&path=/etc/passwd").status_code == 400


def test_large_archive_bootstrap_stays_under_320_kib(tmp_path: Path) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        _append_archive_events(sim, 5_000)

        manifest = client.get("/api/replay/manifest")
        manifest_body = manifest.json()
        latest = client.get("/api/replay/checkpoints/latest")
        events = client.get(
            "/api/replay/events"
            f"?after={manifest_body['bootstrap']['event_after']}"
            f"&limit={manifest_body['bootstrap']['event_limit']}"
        )

        assert manifest.status_code == latest.status_code == events.status_code == 200
        assert len(manifest.content) + len(latest.content) + len(events.content) < 320 * 1024
        assert len(events.json()["events"]) == 512
        assert events.json()["events"][-1]["cursor"] == 5_001


def test_bounded_replay_scans_are_offloaded_from_asyncio_loop(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original_to_thread = asyncio.to_thread
    offloaded: list[str] = []

    async def tracking_to_thread(
        function: Any,
        /,
        *args: object,
        **kwargs: object,
    ) -> Any:
        offloaded.append(function.__name__)
        return await original_to_thread(function, *args, **kwargs)

    monkeypatch.setattr(asyncio, "to_thread", tracking_to_thread)

    with _client(tmp_path) as client:
        assert client.get("/api/replay/manifest").status_code == 200
        assert client.get("/api/replay/events?after=0&limit=1").status_code == 200
        assert client.get("/api/replay/checkpoints/latest").status_code == 200
        assert client.get("/api/replay/checkpoints?limit=1").status_code == 200

    assert offloaded == [
        "_replay_manifest",
        "_replay_events_page",
        "_latest_checkpoint",
        "_replay_checkpoints_page",
    ]


def test_oversized_exact_speech_record_returns_413_but_raw_export_remains_available(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        prior_count = sim.replay_archive.record_count("events")
        marker = "oversized-speech-marker"
        sim.replay_archive.record(
            Event(
                "speak",
                "wanderer_001",
                {"message": marker + ("x" * (320 * 1024))},
                scope=ScopeType.LOCAL,
                region="nirvana",
                timestamp=100.0,
            )
        )

        response = client.get(f"/api/replay/events?after={prior_count}&limit=1")

        assert response.status_code == 413
        assert response.json()["detail"] == "Replay response exceeds the 320 KiB limit."
        assert client.get("/api/replay/manifest").status_code == 200
        assert client.get("/api/run").status_code == 200
        raw = client.get("/api/replay/artifacts/events")
        assert raw.status_code == 200
        assert marker in raw.text


def test_oversized_exact_checkpoint_returns_413_but_manifest_and_raw_export_work(
    tmp_path: Path,
) -> None:
    with _client(tmp_path) as client:
        sim = _sim(client)
        marker = "oversized-checkpoint-marker"
        checkpoint = {
            "schema": 1,
            "type": "world_snapshot_checkpoint",
            "reason": "manual",
            "run_id": sim.run_context.run_id,
            "world_time": 10.0,
            "event_cursor": sim.replay_archive.record_count("events"),
            "snapshot": {"marker": marker + ("x" * (320 * 1024))},
        }
        line = (json.dumps(checkpoint, sort_keys=True) + "\n").encode("utf-8")
        checkpoint_line = sim.replay_archive.append_checkpoint_line(line)

        latest = client.get("/api/replay/checkpoints/latest")
        page = client.get(f"/api/replay/checkpoints?before={checkpoint_line + 1}&limit=1")

        assert latest.status_code == 413
        assert page.status_code == 413
        assert client.get("/api/replay/manifest").status_code == 200
        assert client.get("/api/world").status_code == 200
        raw = client.get("/api/replay/artifacts/snapshots")
        assert raw.status_code == 200
        assert marker in raw.text


def _speech_event(index: int, filler_bytes: int) -> Event:
    """Return one well-formed ``speak`` event of a deliberately chosen size.

    ``speak`` is the variable-length event: its payload carries whatever a being
    said, and it is the one the payload-enrichment work made larger.
    """
    return Event(
        "speak",
        "wanderer_001",
        {"message": f"candidate-{index}:" + ("x" * filler_bytes)},
        scope=ScopeType.LOCAL,
        region="nirvana",
        timestamp=float(index),
    )


def test_event_page_clamps_to_the_byte_budget_and_reports_truncation(
    tmp_path: Path,
) -> None:
    """A page of events that individually fit but jointly do not is clamped, not refused.

    The same failure shape as the checkpoint bug, on the endpoint that was left alone:
    the measured ceiling was ~597 events against a 512-event request, only ~15%
    headroom, and ``speak`` payloads -- the variable ones -- have since grown.

    Events page FORWARD, so the surviving window is the OLDEST contiguous prefix: it
    still begins at ``after + 1``, ``next_after`` names the newest record returned, and
    the client walks forward for the rest. Dropping from the other end would leave a
    hole between ``after`` and the first cursor returned.
    """
    with _client(tmp_path) as client:
        sim = _sim(client)
        prior_count = sim.replay_archive.record_count("events")
        for index in range(4):
            sim.replay_archive.record(_speech_event(index, 120 * 1024))
        total = sim.replay_archive.record_count("events")

        response = client.get(f"/api/replay/events?after={prior_count}&limit=4")

        assert response.status_code == 200
        body = response.json()
        assert body["truncated"] is True
        cursors = [entry["cursor"] for entry in body["events"]]
        assert 0 < len(cursors) < 4
        # The OLDEST that fit, contiguous from the requested cursor.
        assert cursors == list(range(prior_count + 1, prior_count + 1 + len(cursors)))
        assert body["next_after"] == cursors[-1]
        assert body["has_more"] is True
        assert body["next_after"] < total
        assert len(response.content) <= 320 * 1024


def test_event_page_reports_no_truncation_when_the_whole_page_fits(
    tmp_path: Path,
) -> None:
    """An ordinary page states ``truncated: False`` rather than omitting the field."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        prior_count = sim.replay_archive.record_count("events")
        for index in range(2):
            sim.replay_archive.record(_speech_event(index, 16))

        body = client.get(f"/api/replay/events?after={prior_count}&limit=2").json()

        assert body["truncated"] is False
        assert len(body["events"]) == 2


def test_a_short_event_page_still_reaches_every_dropped_record_by_paging_forward(
    tmp_path: Path,
) -> None:
    """Truncation must cost latency, never coverage."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        prior_count = sim.replay_archive.record_count("events")
        for index in range(4):
            sim.replay_archive.record(_speech_event(index, 120 * 1024))
        total = sim.replay_archive.record_count("events")

        seen: list[int] = []
        cursor = prior_count
        for _ in range(10):
            body = client.get(f"/api/replay/events?after={cursor}&limit=4").json()
            seen.extend(entry["cursor"] for entry in body["events"])
            cursor = body["next_after"]
            if not body["has_more"]:
                break

        assert seen == list(range(prior_count + 1, total + 1))


def test_single_oversized_event_still_returns_413(tmp_path: Path) -> None:
    """Clamping never silently drops a record that no page size can rescue."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        prior_count = sim.replay_archive.record_count("events")
        sim.replay_archive.record(_speech_event(0, 330 * 1024))

        response = client.get(f"/api/replay/events?after={prior_count}&limit=1")

        assert response.status_code == 413
        assert response.json()["detail"] == "Replay response exceeds the 320 KiB limit."


def _oversized_checkpoint_line(sim: Simulation, *, event_cursor: int, filler_bytes: int) -> bytes:
    """Return one well-formed but deliberately large checkpoint line for ``sim``'s run."""
    checkpoint = {
        "schema": 1,
        "type": "world_snapshot_checkpoint",
        "reason": "manual",
        "run_id": sim.run_context.run_id,
        "world_time": float(event_cursor),
        "event_cursor": event_cursor,
        "snapshot": {"filler": "x" * filler_bytes},
    }
    return (json.dumps(checkpoint, sort_keys=True) + "\n").encode("utf-8")


def test_checkpoint_page_clamps_to_the_byte_budget_and_reports_truncation(
    tmp_path: Path,
) -> None:
    """A page of records that individually fit but jointly do not is clamped, not refused.

    The measured failure: a client asking for 64 real checkpoints (~343 KB) got a 413,
    which the frontend marks non-retryable, so reconciliation stopped permanently at
    ~4 minutes of world age. The page must instead return as many of the NEWEST records
    as fit, say so, and leave ``next_before`` pointing at the oldest record it returned
    so the client can page the rest.
    """
    with _client(tmp_path) as client:
        sim = _sim(client)
        first_added_line = sim.replay_archive.record_count("checkpoints") + 1
        for index in range(4):
            sim.replay_archive.append_checkpoint_line(
                _oversized_checkpoint_line(sim, event_cursor=index + 1, filler_bytes=120 * 1024)
            )
        before = sim.replay_archive.record_count("checkpoints") + 1

        response = client.get(f"/api/replay/checkpoints?before={before}&limit=4")

        assert response.status_code == 200
        body = response.json()
        assert body["truncated"] is True
        lines = [entry["line"] for entry in body["checkpoints"]]
        assert 0 < len(lines) < 4
        assert lines == list(range(before - len(lines), before))  # the NEWEST that fit
        assert body["next_before"] == lines[0]
        assert body["has_more"] is True
        assert len(response.content) <= 320 * 1024
        # The dropped records are still reachable by paging back from next_before.
        assert body["next_before"] > first_added_line


def test_checkpoint_page_reports_no_truncation_when_the_whole_page_fits(
    tmp_path: Path,
) -> None:
    """An ordinary page states ``truncated: False`` rather than omitting the field."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        for event_cursor in (2, 3):
            sim.snapshot_log.write_snapshot(
                sim.world, sim.run_context, event_cursor=event_cursor, reason="manual"
            )
        before = sim.replay_archive.record_count("checkpoints") + 1

        body = client.get(f"/api/replay/checkpoints?before={before}&limit=2").json()

        assert body["truncated"] is False
        assert len(body["checkpoints"]) == 2


def test_single_oversized_checkpoint_still_returns_413(tmp_path: Path) -> None:
    """Clamping never silently drops a record that can never be paged around."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        sim.replay_archive.append_checkpoint_line(
            _oversized_checkpoint_line(sim, event_cursor=1, filler_bytes=330 * 1024)
        )
        before = sim.replay_archive.record_count("checkpoints") + 1

        response = client.get(f"/api/replay/checkpoints?before={before}&limit=1")

        assert response.status_code == 413


class _ConnectedRequest:
    """Minimal stand-in for a still-connected :class:`fastapi.Request`."""

    async def is_disconnected(self) -> bool:
        """Report the client as connected."""
        return False


async def _drain_frames(generator: AsyncGenerator[str], *, count: int) -> list[str]:
    """Pull ``count`` frames from an SSE generator and close it."""
    frames: list[str] = []
    try:
        async for frame in generator:
            frames.append(frame)
            if len(frames) >= count:
                break
    finally:
        await generator.aclose()
    return frames


def test_sse_stream_emits_a_heartbeat_while_the_world_is_quiet(tmp_path: Path) -> None:
    """Silence must be distinguishable from a dead connection.

    Twenty minutes of quiet is normal in this world, and the stream previously yielded
    nothing at all when idle. A named ``heartbeat`` frame is invisible to the existing
    ``events``/``message`` listeners and carries no ``id:``, so it cannot disturb the
    server cursor or an ``EventSource``'s ``lastEventId``.
    """
    with _client(tmp_path) as client:
        sim = _sim(client)
        cursor = sim.feed_log.current_cursor  # start caught up: nothing to deliver
        frames = asyncio.run(
            _drain_frames(
                _sse_events(
                    cast(Any, _ConnectedRequest()),
                    sim,
                    cursor,
                    0.001,
                    once=False,
                    heartbeat_interval=0.0001,
                ),
                count=2,
            )
        )

    assert len(frames) == 2
    for frame in frames:
        assert frame.startswith("event: heartbeat\ndata: ")
        assert "id: " not in frame  # cursor semantics untouched
        beat = json.loads(frame.split("data: ", 1)[1].strip())
        assert beat["schema"] == 1
        assert beat["cursor"] == cursor
        assert beat["status"] == "running"
        assert isinstance(beat["world_time"], (int, float))


def test_sse_stream_stays_silent_when_heartbeats_are_disabled(tmp_path: Path) -> None:
    """A zero interval keeps the previous behaviour: no keepalive at all."""
    with _client(tmp_path) as client:
        sim = _sim(client)
        cursor = sim.feed_log.current_cursor

        async def _collect() -> list[str]:
            generator = _sse_events(
                cast(Any, _ConnectedRequest()),
                sim,
                cursor,
                0.001,
                once=False,
                heartbeat_interval=0.0,
            )
            try:
                return await asyncio.wait_for(_drain_frames(generator, count=1), timeout=0.1)
            except TimeoutError:
                return []

        assert asyncio.run(_collect()) == []
