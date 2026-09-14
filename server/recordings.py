"""Catalogue and safely serve replayable Vivarium recordings.

Each run owns an optional ``run.json`` sidecar beside its existing
``events.jsonl``, ``snapshots.jsonl`` and ``usage.jsonl`` files.  The sidecar is
small metadata only; replay remains in the two JSONL streams.  This module keeps
the catalogue read-only and bounded: files are scanned line by line, only the
first and latest records are retained, and unchanged summaries are reused by
their file-stat signature.
"""

from __future__ import annotations

import gzip
import json
import math
import os
import re
import time
from collections.abc import Iterator, Mapping
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Final, Literal, cast
from urllib.parse import quote

from core.logging import get_logger
from observability.replay_archive import (
    MANIFEST_FILENAME as REPLAY_MANIFEST_FILENAME,
)
from observability.replay_archive import (
    ReplayArchiveError,
    ReplayArchiveManifest,
)
from observability.run_context import RunContext

logger = get_logger(__name__)

__all__ = [
    "EVENTS_FILENAME",
    "METADATA_FILENAME",
    "SNAPSHOTS_FILENAME",
    "RecordingError",
    "RecordingFiles",
    "RecordingInfo",
    "RecordingNotFoundError",
    "RecordingPathError",
    "RecordingSecurityError",
    "iter_recording_file",
    "list_recordings",
    "load_recording",
    "recording_file_path",
    "recording_metadata",
    "update_recording_sidecar",
    "update_run_metadata",
    "write_recording_sidecar",
    "write_run_metadata",
]

METADATA_FILENAME: Final[str] = "run.json"
EVENTS_FILENAME: Final[str] = "events.jsonl"
SNAPSHOTS_FILENAME: Final[str] = "snapshots.jsonl"
USAGE_FILENAME: Final[str] = "usage.jsonl"
NDJSON_FILENAMES: Final[frozenset[str]] = frozenset({EVENTS_FILENAME, SNAPSHOTS_FILENAME})
MAX_PREVIEW_AGENTS: Final[int] = 6
MAX_PREVIEW_REGIONS: Final[int] = 12
MAX_CATALOGUE_SCAN_BYTES: Final[int] = 64 * 1024 * 1024
MAX_METADATA_BYTES: Final[int] = 64 * 1024
MAX_RECORDING_DIRECTORIES: Final[int] = 512

_RUN_ID_RE = re.compile(r"^seed-(?P<seed>-?\d+)-(?P<started_ms>\d+)(?:-|$)")
_SAFE_RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_SCOPES: Final[frozenset[str]] = frozenset({"local", "global", "targeted", "private"})
_FINAL_STATUSES: Final[frozenset[str]] = frozenset({"stopped", "failed"})


class _MalformedInteriorError(Exception):
    """Internal marker for a non-EOF malformed JSONL record."""


class _ScanLimitExceededError(Exception):
    """Internal marker for a bounded catalogue scan that reached its byte cap."""


class RecordingError(RuntimeError):
    """Base error for an unavailable or malformed recording."""


class RecordingNotFoundError(RecordingError):
    """Raised when a requested recording or required replay file is absent."""


class RecordingPathError(RecordingError):
    """Raised when a recording id or artifact name is outside the fixed contract."""


class RecordingSecurityError(RecordingError):
    """Raised when a path is a symlink, non-regular file, or escapes its root."""


@dataclass(frozen=True, slots=True)
class RecordingFiles:
    """Validated paths for one replayable recording.

    Attributes:
        recording_id: The single child directory name.
        run_dir: The validated child directory.
        events: The validated events JSONL file.
        snapshots: The validated snapshots JSONL file.
    """

    recording_id: str
    run_dir: Path
    events: Path
    snapshots: Path


@dataclass(frozen=True, slots=True)
class RecordingInfo:
    """Validated recording data used by the catalogue and metadata route."""

    files: RecordingFiles
    payload: Mapping[str, object]
    seed: int | None
    provider: str | None
    model: str | None


@dataclass(frozen=True, slots=True)
class _FileStat:
    """Small cache key for one file's contents."""

    exists: bool
    size: int = 0
    mtime_ns: int = 0
    inode: int = 0
    mode: int = 0


@dataclass(frozen=True, slots=True)
class _ScanResult:
    """Streaming JSONL scan result retaining only boundary records."""

    valid: bool
    count: int
    first: dict[str, Any] | None
    last: dict[str, Any] | None
    first_time: float | None = None
    last_time: float | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class _SnapshotRecord:
    """Validated wrapper metadata for one checkpoint line."""

    snapshot: dict[str, Any]
    event_cursor: int
    reason: str | None


@dataclass(frozen=True, slots=True)
class _ScannedRecording:
    """Internal summary inputs before they are converted to the API payload."""

    files: RecordingFiles
    events: _ScanResult
    snapshots: _ScanResult
    usage_model: str | None
    sidecar: dict[str, Any]
    seed: int | None
    provider: str | None
    model: str | None
    started_at: float | None
    duration_seconds: float
    status: str
    name: str


_SUMMARY_CACHE: dict[Path, tuple[tuple[_FileStat, ...], RecordingInfo | None]] = {}


def list_recordings(run_dir: str | Path) -> list[dict[str, object]]:
    """Return recent replayable recordings beneath ``run_dir``.

    Args:
        run_dir: Configured parent directory containing one child per run.

    Returns:
        Recent-first catalogue entries matching the saved-runs frontend contract.
        Missing, empty, malformed, or unsafe children are skipped after a warning.

    Side effects:
        Reads recording files and emits warnings for entries that cannot be listed;
        it never starts a model or mutates a recording.
    """
    root = _resolve_root(run_dir)
    if not root.exists():
        return []
    if root.is_symlink() or not root.is_dir():
        logger.warning("recording root is not a directory; returning an empty catalogue")
        return []
    try:
        children = sorted(root.iterdir(), key=_child_recency_key, reverse=True)
    except OSError:
        logger.warning("recording root cannot be read; returning an empty catalogue", exc_info=True)
        return []
    if len(children) > MAX_RECORDING_DIRECTORIES:
        logger.warning(
            "recording root has %d children; scanning the first %d",
            len(children),
            MAX_RECORDING_DIRECTORIES,
        )
        children = children[:MAX_RECORDING_DIRECTORIES]

    infos: list[RecordingInfo] = []
    for child in children:
        if not child.is_dir() or child.is_symlink() or not _SAFE_RUN_ID_RE.fullmatch(child.name):
            logger.warning("skipping unsafe or non-directory recording child %r", child.name)
            continue
        try:
            info = _cached_scan(root, child.name)
        except RecordingError as exc:
            logger.warning("skipping recording %r: %s", child.name, exc)
            continue
        if info is not None:
            infos.append(info)
    infos.sort(key=_recent_sort_key, reverse=True)
    return [dict(info.payload) for info in infos]


def load_recording(run_dir: str | Path, recording_id: str) -> RecordingInfo:
    """Load one replayable recording after validating its fixed child paths.

    Args:
        run_dir: Configured parent directory containing run children.
        recording_id: One safe child directory name, never a filesystem path.

    Returns:
        Validated summary plus safe paths for the two replay streams.

    Raises:
        RecordingPathError: If the id contains traversal, separators, or an
            unsupported artifact selector.
        RecordingSecurityError: If containment, symlink, or regular-file checks fail.
        RecordingNotFoundError: If the run is absent or not replayable.
    """
    root = _resolve_root(run_dir)
    _validated_files(root, recording_id)
    info = _cached_scan(root, recording_id)
    if info is None:
        raise RecordingNotFoundError(f"recording {recording_id!r} is not replayable")
    return info


def recording_metadata(run_dir: str | Path, recording_id: str) -> dict[str, object]:
    """Return generated replay metadata without exposing sidecar or log paths."""
    info = load_recording(run_dir, recording_id)
    return {
        "seed": info.seed,
        "provider": info.provider,
        "model": info.model,
        "name": str(info.payload["name"]),
        "started_at": info.payload["started_at"],
    }


def recording_file_path(
    run_dir: str | Path,
    recording_id: str,
    artifact: str,
) -> Path:
    """Return a safe path for one of the two fixed replay artifacts.

    The file is required to exist and be a regular, non-symlink child of the
    requested recording directory.  ``artifact`` is compared as an exact basename;
    callers cannot select ``run.json``, usage data, or arbitrary paths.
    """
    root = _resolve_root(run_dir)
    if artifact not in NDJSON_FILENAMES:
        raise RecordingPathError("recording artifact is not part of the replay contract")
    files = _validated_files(root, recording_id)
    if artifact == EVENTS_FILENAME:
        return files.events
    return files.snapshots


def iter_recording_file(
    run_dir: str | Path,
    recording_id: str,
    artifact: str,
) -> Iterator[bytes]:
    """Yield only valid JSONL records from one fixed replay artifact.

    A crash can leave a partial final line.  It is omitted so interrupted runs remain
    playable; malformed interior records make the recording unavailable during the
    validation performed by :func:`load_recording`.
    """
    recording_file_path(run_dir, recording_id, artifact)
    kind: Literal["events", "snapshots"] = "events" if artifact == EVENTS_FILENAME else "snapshots"
    root = _resolve_root(run_dir)
    files = _validated_files(root, recording_id)
    scan = _scan_archive_stream(files, kind)
    if not scan.valid:
        raise RecordingNotFoundError(f"recording {recording_id!r} has malformed {artifact}")
    try:
        pending_error: ValueError | None = None
        for raw, value, trailing in _iter_archive_json_lines(files, kind):
            if trailing:
                return
            if value is None:
                continue
            try:
                if kind == "events":
                    _parse_event(value)
                else:
                    _parse_snapshot(value)
            except ValueError as exc:
                pending_error = exc
                continue
            if pending_error is not None:
                raise RecordingNotFoundError(
                    f"recording {recording_id!r} has malformed {artifact}"
                ) from pending_error
            yield raw
    except RecordingNotFoundError:
        raise
    except RecordingError:
        raise
    except OSError as exc:
        raise RecordingNotFoundError(f"recording {recording_id!r} cannot be read") from exc


def write_recording_sidecar(
    run_context: RunContext,
    *,
    region_name: str | None,
    status: str | None = None,
    ended_at: float | None = None,
) -> Path:
    """Atomically write the optional sidecar for a newly assembled or updated run.

    Args:
        run_context: The durable run identity and true provider/model values.
        region_name: Primary world region used in the generated display name.
        status: Lifecycle status to persist; defaults to the context's status.
        ended_at: Terminal wall-clock time, or ``None`` while running.

    Returns:
        The sidecar path (for internal lifecycle use; it is never sent to clients).

    Side effects:
        Creates the run directory if needed and atomically replaces ``run.json``.
    """
    return _write_sidecar(
        run_context.run_dir,
        run_id=run_context.run_id,
        seed=run_context.seed,
        provider=run_context.provider,
        model=run_context.model,
        started_at=run_context.started_at,
        region_name=region_name,
        status=status or run_context.status,
        ended_at=ended_at,
    )


def update_recording_sidecar(
    run_context: RunContext,
    *,
    region_name: str | None,
    status: str,
    ended_at: float | None = None,
) -> Path:
    """Persist a lifecycle transition using the same atomic sidecar writer."""
    return write_recording_sidecar(
        run_context,
        region_name=region_name,
        status=status,
        ended_at=ended_at,
    )


# Short aliases make the lifecycle hook names easy to discover without changing the
# on-disk contract.  They intentionally retain the typed RunContext boundary above.
write_run_metadata = write_recording_sidecar
update_run_metadata = update_recording_sidecar


def _cached_scan(root: Path, recording_id: str) -> RecordingInfo | None:
    """Return a cached summary or scan this child once by bounded streaming reads."""
    child = _validated_child_directory(root, recording_id)
    signature = _archive_signature(child, recording_id)
    cached = _SUMMARY_CACHE.get(child)
    if cached is not None and cached[0] == signature:
        return cached[1]
    try:
        scanned = _scan_recording(root, recording_id)
    except RecordingError:
        raise
    except OSError as exc:
        raise RecordingError("recording files cannot be read") from exc
    info = None if scanned is None else _to_info(scanned)
    _SUMMARY_CACHE[child] = (signature, info)
    return info


def _scan_recording(root: Path, recording_id: str) -> _ScannedRecording | None:
    """Scan both replay streams and produce a summary input, or ``None``."""
    files = _validated_files(root, recording_id)
    events = _scan_archive_stream(files, "events")
    snapshots = _scan_archive_stream(files, "snapshots")
    if not events.valid or events.count == 0 or not snapshots.valid or snapshots.count == 0:
        return None
    sidecar = _read_sidecar(files.run_dir / METADATA_FILENAME)
    usage_model = _first_usage_model(files.run_dir / USAGE_FILENAME)
    snapshot_record = _snapshot_record(snapshots.last)
    if snapshot_record is None:
        return None
    snapshot = snapshot_record.snapshot
    run_id_seed, run_id_started = _legacy_id_fallback(recording_id)
    seed = _optional_int(sidecar.get("seed"))
    if seed is None:
        seed = run_id_seed
    provider = _optional_text(sidecar.get("provider"))
    model = _optional_text(sidecar.get("model")) or usage_model
    started_at = _optional_number(sidecar.get("started_at"))
    if started_at is None:
        started_at = (
            run_id_started or events.first_time or _optional_number(snapshot.get("world_time"))
        )
    ended_at = _optional_number(sidecar.get("ended_at"))
    duration = _optional_number(sidecar.get("duration_seconds"))
    if duration is None:
        duration = _duration_from_times(started_at, ended_at, events.first_time, events.last_time)
    status = _status_from_metadata(sidecar, snapshot_record.reason)
    region_name = _first_region_name(snapshot)
    name = _optional_text(sidecar.get("name")) or _display_name(region_name, started_at)
    return _ScannedRecording(
        files=files,
        events=events,
        snapshots=snapshots,
        usage_model=usage_model,
        sidecar=sidecar,
        seed=seed,
        provider=provider,
        model=model,
        started_at=started_at,
        duration_seconds=max(0.0, duration),
        status=status,
        name=name,
    )


def _archive_signature(child: Path, recording_id: str) -> tuple[_FileStat, ...]:
    """Return active, metadata, manifest, and segment stats for the summary cache."""
    signature = [
        _file_stat(child / name)
        for name in (
            EVENTS_FILENAME,
            SNAPSHOTS_FILENAME,
            USAGE_FILENAME,
            METADATA_FILENAME,
            REPLAY_MANIFEST_FILENAME,
        )
    ]
    manifest = _read_archive_manifest(child, recording_id)
    if manifest is not None:
        for segment in (*manifest.streams["events"], *manifest.streams["checkpoints"]):
            signature.append(_file_stat(child / segment.name))
    return tuple(signature)


def _read_archive_manifest(child: Path, recording_id: str) -> ReplayArchiveManifest | None:
    """Read and validate an existing archive manifest without opening a writer."""
    path = child / REPLAY_MANIFEST_FILENAME
    if path.is_symlink():
        raise RecordingSecurityError("replay manifest must not be a symlink")
    if not path.exists():
        return None
    _validated_regular_file(path, child)
    try:
        if path.stat().st_size > MAX_METADATA_BYTES:
            raise RecordingError("replay manifest exceeds the bounded metadata limit")
        value = json.loads(path.read_text(encoding="utf-8"))
        return ReplayArchiveManifest.from_dict(value, expected_run_id=recording_id)
    except ReplayArchiveError as exc:
        raise RecordingError("replay manifest is invalid") from exc
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RecordingError("replay manifest cannot be read") from exc


def _iter_archive_json_lines(
    files: RecordingFiles,
    kind: Literal["events", "snapshots"],
) -> Iterator[tuple[bytes, dict[str, Any] | None, bool]]:
    """Yield validated-manifest segments followed by the active JSONL tail."""
    manifest = _read_archive_manifest(files.run_dir, files.recording_id)
    if manifest is not None:
        stream: Literal["events", "checkpoints"] = "events" if kind == "events" else "checkpoints"
        segments = manifest.streams[stream]
        for segment in segments:
            segment_path = _validated_regular_file(
                files.run_dir / segment.name,
                files.run_dir,
            )
            try:
                with gzip.open(segment_path, "rb") as handle:
                    for raw, value, trailing in _iter_json_lines(handle, segment.name):
                        if trailing or (raw and not raw.endswith(b"\n")):
                            raise _MalformedInteriorError(
                                f"archive segment {segment.name!r} is incomplete"
                            ) from None
                        yield raw, value, False
            except (OSError, EOFError) as exc:
                raise RecordingError(f"replay segment {segment.name!r} cannot be read") from exc
    active_path = files.events if kind == "events" else files.snapshots
    try:
        with active_path.open("rb") as handle:
            yield from _iter_json_lines(handle, active_path.name)
    except OSError as exc:
        raise RecordingError("active replay file cannot be read") from exc


def _scan_archive_stream(
    files: RecordingFiles,
    kind: Literal["events", "snapshots"],
) -> _ScanResult:
    """Scan immutable segments plus the active tail, ignoring only final bad records."""
    count = 0
    first: dict[str, Any] | None = None
    last: dict[str, Any] | None = None
    first_time: float | None = None
    last_time: float | None = None
    pending_error: ValueError | None = None
    try:
        for _raw, value, trailing in _iter_archive_json_lines(files, kind):
            if trailing:
                logger.warning(
                    "ignoring malformed trailing line in %s",
                    files.events if kind == "events" else files.snapshots,
                )
                break
            if value is None:
                continue
            try:
                parsed = _parse_event(value) if kind == "events" else _parse_snapshot(value)
            except ValueError as exc:
                pending_error = exc
                continue
            if pending_error is not None:
                logger.warning(
                    "malformed %s line in %s",
                    kind,
                    files.events if kind == "events" else files.snapshots,
                )
                return _ScanResult(
                    False, count, first, last, first_time, last_time, str(pending_error)
                )
            count += 1
            if first is None:
                first = parsed
                first_time = _record_time(parsed, kind)
            last = parsed
            last_time = _record_time(parsed, kind)
    except (_MalformedInteriorError, _ScanLimitExceededError) as exc:
        logger.warning("invalid or over-limit %s in %s", kind, files.run_dir)
        return _ScanResult(False, count, first, last, first_time, last_time, str(exc))
    except OSError as exc:
        return _ScanResult(False, count, first, last, first_time, last_time, str(exc))
    if pending_error is not None:
        logger.warning(
            "ignoring malformed trailing line in %s",
            files.events if kind == "events" else files.snapshots,
        )
    return _ScanResult(True, count, first, last, first_time, last_time)


def _to_info(scanned: _ScannedRecording) -> RecordingInfo:
    """Convert scan inputs into the exact public catalogue shape."""
    snapshot_record = _snapshot_record(scanned.snapshots.last)
    assert snapshot_record is not None
    snapshot = snapshot_record.snapshot
    agents = snapshot.get("agents")
    regions = snapshot.get("regions")
    agent_rows = [
        {
            "id": str(agent.get("id")),
            "name": str(agent.get("name")),
            "persona": _optional_text(agent.get("persona")),
            "region": _optional_text(agent.get("position")),
            "status": _optional_text(agent.get("status")),
        }
        for agent in cast(list[dict[str, Any]], agents)[:MAX_PREVIEW_AGENTS]
    ]
    region_rows = [
        {
            "id": _optional_text(region.get("id")) or str(region.get("name")),
            "name": str(region.get("name")),
        }
        for region in cast(list[dict[str, Any]], regions)[:MAX_PREVIEW_REGIONS]
    ]
    all_agents = cast(list[dict[str, Any]], agents)
    all_regions = cast(list[dict[str, Any]], regions)
    living_count = sum(
        1
        for agent in all_agents
        if (_optional_text(agent.get("status")) or "").strip().lower() != "dead"
    )
    payload: dict[str, object] = {
        "id": scanned.files.recording_id,
        "name": scanned.name,
        "started_at": scanned.started_at,
        "duration_seconds": scanned.duration_seconds,
        "event_count": scanned.events.count,
        "status": scanned.status,
        "model": scanned.model,
        "base_url": f"/api/recordings/{quote(scanned.files.recording_id, safe='')}",
        "agent_count": len(all_agents),
        "living_count": living_count,
        "region_count": len(all_regions),
        "agents": agent_rows,
        "regions": region_rows,
    }
    return RecordingInfo(
        files=scanned.files,
        payload=payload,
        seed=scanned.seed,
        provider=scanned.provider,
        model=scanned.model,
    )


def _validated_files(root: Path, recording_id: str) -> RecordingFiles:
    """Validate a child and its two fixed replay files."""
    child = _validated_child_directory(root, recording_id)
    events = _validated_regular_file(child / EVENTS_FILENAME, child)
    snapshots = _validated_regular_file(child / SNAPSHOTS_FILENAME, child)
    return RecordingFiles(
        recording_id=recording_id,
        run_dir=child,
        events=events,
        snapshots=snapshots,
    )


def _validated_child_directory(root: Path, recording_id: str) -> Path:
    """Validate one direct child directory without following user-selected links."""
    if not isinstance(recording_id, str) or not _SAFE_RUN_ID_RE.fullmatch(recording_id):
        raise RecordingPathError("recording id must be one safe child name")
    if "/" in recording_id or "\\" in recording_id or recording_id in {".", ".."}:
        raise RecordingPathError("recording id cannot contain path separators")
    child = root / recording_id
    if child.is_symlink():
        raise RecordingSecurityError("recording directory must not be a symlink")
    if not child.exists() or not child.is_dir():
        raise RecordingNotFoundError(f"recording {recording_id!r} does not exist")
    try:
        resolved_root = root.resolve(strict=False)
        resolved_child = child.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise RecordingSecurityError("recording directory cannot be safely resolved") from exc
    if resolved_child.parent != resolved_root or resolved_child == resolved_root:
        raise RecordingSecurityError("recording directory escapes its configured root")
    return child


def _validated_regular_file(path: Path, child: Path) -> Path:
    """Validate a non-symlink regular file directly under ``child``."""
    if path.is_symlink():
        raise RecordingSecurityError(f"recording file {path.name!r} must not be a symlink")
    if not path.exists():
        raise RecordingNotFoundError(f"recording file {path.name!r} is missing")
    try:
        stat_result = path.stat()
        resolved_child = child.resolve(strict=True)
        resolved_path = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise RecordingSecurityError("recording file cannot be safely resolved") from exc
    if not _is_regular_mode(stat_result.st_mode):
        raise RecordingSecurityError(f"recording file {path.name!r} is not regular")
    if resolved_path.parent != resolved_child:
        raise RecordingSecurityError(f"recording file {path.name!r} escapes its run directory")
    return path


def _resolve_root(run_dir: str | Path) -> Path:
    """Resolve a configured root without requiring it to exist yet."""
    try:
        return Path(run_dir).resolve(strict=False)
    except (OSError, RuntimeError) as exc:
        raise RecordingSecurityError("recording root cannot be safely resolved") from exc


def _scan_file(path: Path, kind: Literal["events", "snapshots"]) -> _ScanResult:
    """Stream-parse one JSONL file, tolerating only a malformed final record."""
    count = 0
    first: dict[str, Any] | None = None
    last: dict[str, Any] | None = None
    first_time: float | None = None
    last_time: float | None = None
    try:
        with path.open("rb") as handle:
            for _raw, value, trailing in _iter_json_lines(handle, path.name):
                if trailing:
                    logger.warning("ignoring malformed trailing line in %s", path)
                    break
                if value is None:
                    continue
                try:
                    parsed = _parse_event(value) if kind == "events" else _parse_snapshot(value)
                except ValueError as exc:
                    if not _remaining_nonblank(handle):
                        logger.warning("ignoring malformed trailing line in %s", path)
                        break
                    logger.warning("malformed %s line in %s", kind, path)
                    return _ScanResult(False, count, first, last, first_time, last_time, str(exc))
                count += 1
                if first is None:
                    first = parsed
                    first_time = _record_time(parsed, kind)
                last = parsed
                last_time = _record_time(parsed, kind)
    except (_MalformedInteriorError, _ScanLimitExceededError) as exc:
        logger.warning("invalid or over-limit %s in %s", kind, path)
        return _ScanResult(False, count, first, last, first_time, last_time, str(exc))
    except OSError as exc:
        return _ScanResult(False, count, first, last, first_time, last_time, str(exc))
    return _ScanResult(True, count, first, last, first_time, last_time)


def _remaining_nonblank(handle: Any) -> bool:
    """Return whether a JSONL handle has another nonblank line."""
    return any(bool(raw.strip()) for raw in handle)


def _iter_json_lines(
    handle: Any,
    label: str,
) -> Iterator[tuple[bytes, dict[str, Any] | None, bool]]:
    """Yield raw lines and parsed objects, marking a malformed EOF line as trailing."""
    bytes_seen = 0
    iterator = iter(handle)
    while True:
        try:
            raw = next(iterator)
        except StopIteration:
            return
        bytes_seen += len(raw)
        if bytes_seen > MAX_CATALOGUE_SCAN_BYTES:
            raise _ScanLimitExceededError(f"bounded scan exceeded for {label}")
        stripped = raw.strip()
        if not stripped:
            continue
        try:
            value = json.loads(stripped.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            # Probe one nonblank line.  EOF means this is a crash tail; another
            # record means the malformed line was interior and the file is invalid.
            for probe in iterator:
                bytes_seen += len(probe)
                if probe.strip():
                    raise _MalformedInteriorError(f"malformed interior line in {label}") from None
            yield b"", None, True
            return
        if not isinstance(value, dict):
            for probe in iterator:
                bytes_seen += len(probe)
                if probe.strip():
                    raise _MalformedInteriorError(f"non-object interior line in {label}") from None
            yield b"", None, True
            return
        yield raw, cast(dict[str, Any], value), False


def _parse_event(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the fields the production recorded-run parser requires."""
    if not isinstance(value.get("type"), str) or not isinstance(value.get("source"), str):
        raise ValueError("event type/source must be strings")
    if not isinstance(value.get("payload"), dict):
        raise ValueError("event payload must be an object")
    if value.get("scope") not in _SCOPES:
        raise ValueError("event scope is invalid")
    if not _finite_number(value.get("timestamp")):
        raise ValueError("event timestamp is invalid")
    for key in ("region", "target"):
        if value.get(key) is not None and not isinstance(value.get(key), str):
            raise ValueError(f"event {key} is invalid")
    return dict(value)


def _parse_snapshot(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate a wrapper or legacy plain snapshot and return its inner snapshot."""
    inner = value.get("snapshot")
    if inner is None:
        inner = value
    if not isinstance(inner, dict):
        raise ValueError("snapshot must be an object")
    if inner.get("schema") != 1 or not isinstance(inner.get("run_id"), str):
        raise ValueError("snapshot schema or run id is invalid")
    if not _finite_number(inner.get("world_time")) or not _finite_number(inner.get("event_cursor")):
        raise ValueError("snapshot time or cursor is invalid")
    if not isinstance(inner.get("agents"), list) or not isinstance(inner.get("regions"), list):
        raise ValueError("snapshot agents/regions are invalid")
    for agent in inner["agents"]:
        if (
            not isinstance(agent, dict)
            or not isinstance(agent.get("id"), str)
            or not isinstance(agent.get("name"), str)
        ):
            raise ValueError("snapshot agent is invalid")
    for region in inner["regions"]:
        if not isinstance(region, dict) or not isinstance(region.get("name"), str):
            raise ValueError("snapshot region is invalid")
    result = dict(inner)
    if inner is not value:
        wrapper_cursor = value.get("event_cursor")
        if _finite_number(wrapper_cursor):
            result["_record_event_cursor"] = int(cast(float | int, wrapper_cursor))
        wrapper_reason = value.get("reason")
        if isinstance(wrapper_reason, str):
            result["_record_reason"] = wrapper_reason
    return result


def _snapshot_record(value: dict[str, Any] | None) -> _SnapshotRecord | None:
    """Recover wrapper cursor/reason metadata from a parsed latest snapshot."""
    if value is None:
        return None
    inner = _parse_snapshot(value)
    raw_cursor = value.get(
        "_record_event_cursor",
        value.get("event_cursor", inner.get("event_cursor", 0)),
    )
    if not _finite_number(raw_cursor):
        return None
    reason = value.get("_record_reason", value.get("reason"))
    return _SnapshotRecord(inner, int(raw_cursor), reason if isinstance(reason, str) else None)


def _record_time(value: Mapping[str, Any], kind: Literal["events", "snapshots"]) -> float | None:
    """Get a timeline value for duration fallback."""
    key = "timestamp" if kind == "events" else "world_time"
    return _optional_number(value.get(key))


def _first_usage_model(path: Path) -> str | None:
    """Read only the first bounded valid usage model for legacy fallback."""
    if not path.exists() or path.is_symlink() or not path.is_file():
        return None
    try:
        with path.open("rb") as handle:
            bytes_seen = 0
            for raw in handle:
                bytes_seen += len(raw)
                if bytes_seen > MAX_METADATA_BYTES:
                    break
                if not raw.strip():
                    continue
                try:
                    value = json.loads(raw)
                except (UnicodeDecodeError, json.JSONDecodeError):
                    logger.warning("ignoring malformed usage line in %s", path)
                    continue
                if isinstance(value, dict):
                    model = _optional_text(value.get("model"))
                    if model is not None:
                        return model
    except OSError:
        logger.warning("could not read usage fallback %s", path, exc_info=True)
    return None


def _read_sidecar(path: Path) -> dict[str, Any]:
    """Read a bounded sidecar, falling back cleanly when it is absent or malformed."""
    if not path.exists() or path.is_symlink() or not path.is_file():
        return {}
    try:
        if path.stat().st_size > MAX_METADATA_BYTES:
            logger.warning("recording sidecar is too large: %s", path)
            return {}
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        logger.warning("ignoring malformed recording sidecar %s", path)
        return {}
    if not isinstance(value, dict):
        logger.warning("ignoring non-object recording sidecar %s", path)
        return {}
    return cast(dict[str, Any], value)


def _write_sidecar(
    run_dir: Path,
    *,
    run_id: str,
    seed: int | None,
    provider: str | None,
    model: str | None,
    started_at: float,
    region_name: str | None,
    status: str,
    ended_at: float | None,
) -> Path:
    """Write sidecar bytes through a same-directory temporary file and replace."""
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / METADATA_FILENAME
    prior = _read_sidecar(path)
    effective_ended = ended_at
    if status in _FINAL_STATUSES and effective_ended is None:
        effective_ended = _optional_number(prior.get("ended_at")) or time.time()
    payload: dict[str, object] = {
        "schema": 1,
        "run_id": run_id,
        "name": _optional_text(prior.get("name")) or _display_name(region_name, started_at),
        "started_at": started_at if _finite_number(started_at) else None,
        "ended_at": effective_ended,
        "duration_seconds": _duration_from_times(started_at, effective_ended, None, None),
        "status": status,
        "seed": seed if isinstance(seed, int) and not isinstance(seed, bool) else None,
        "provider": _optional_text(provider),
        "model": _optional_text(model),
    }
    temporary = path.with_name(path.name + ".tmp")
    encoded = (json.dumps(payload, allow_nan=False, sort_keys=True) + "\n").encode("utf-8")
    try:
        with temporary.open("wb") as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except OSError:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            logger.warning("could not clean failed sidecar temporary %s", temporary)
        logger.exception("could not persist recording sidecar %s", path)
        raise
    return path


def _legacy_id_fallback(recording_id: str) -> tuple[int | None, float | None]:
    """Infer seed and start time from the historical ``seed-<seed>-<ms>-...`` id."""
    match = _RUN_ID_RE.match(recording_id)
    if match is None:
        return None, None
    return int(match.group("seed")), int(match.group("started_ms")) / 1_000


def _child_recency_key(path: Path) -> tuple[int, str]:
    """Order directory candidates newest-first before applying the scan cap."""
    _, started_at = _legacy_id_fallback(path.name)
    if started_at is not None:
        return int(started_at * 1_000_000_000), path.name
    try:
        return path.stat().st_mtime_ns, path.name
    except OSError:
        return 0, path.name


def _status_from_metadata(sidecar: Mapping[str, Any], reason: str | None) -> str:
    """Return sidecar status, or an honest legacy status from the latest reason."""
    status = _optional_text(sidecar.get("status"))
    if status is not None:
        return status
    lowered = (reason or "").strip().lower()
    if "fail" in lowered:
        return "failed"
    if lowered == "run_stopped" or lowered.endswith(":run_stopped"):
        return "stopped"
    return "running"


def _first_region_name(snapshot: Mapping[str, Any]) -> str | None:
    """Choose a safe human region label from the latest snapshot."""
    regions = snapshot.get("regions")
    if not isinstance(regions, list):
        return None
    for region in regions:
        if isinstance(region, dict):
            name = _optional_text(region.get("name"))
            if name is not None:
                return name
    return None


def _display_name(region_name: str | None, started_at: float | None) -> str:
    """Build the compact automatic name used when a sidecar has no custom label."""
    region = region_name or "Vivarium"
    if started_at is None or not math.isfinite(started_at):
        return region
    stamp = datetime.fromtimestamp(started_at).astimezone()
    return f"{region} · {stamp.strftime('%b')}{stamp.day} {stamp.strftime('%H:%M')}"


def _duration_from_times(
    started_at: float | None,
    ended_at: float | None,
    first_event: float | None,
    last_event: float | None,
) -> float:
    """Derive nonnegative duration from sidecar times or event bounds."""
    if started_at is not None and ended_at is not None:
        return max(0.0, ended_at - started_at)
    if first_event is not None and last_event is not None:
        return max(0.0, last_event - first_event)
    return 0.0


def _recent_sort_key(info: RecordingInfo) -> tuple[float, str]:
    """Sort known starts newest first, placing unknown starts last."""
    raw = info.payload.get("started_at")
    started = _optional_number(raw)
    return (started if started is not None else float("-inf"), str(info.payload["id"]))


def _file_stat(path: Path) -> _FileStat:
    """Return a cache-safe signature without following symlink content."""
    try:
        if path.is_symlink():
            return _FileStat(True, mode=0o120000)
        stat_result = path.stat()
    except OSError:
        return _FileStat(False)
    return _FileStat(
        True,
        size=stat_result.st_size,
        mtime_ns=stat_result.st_mtime_ns,
        inode=stat_result.st_ino,
        mode=stat_result.st_mode,
    )


def _is_regular_mode(mode: int) -> bool:
    """Return whether a stat mode denotes an ordinary file."""
    return (mode & 0o170000) == 0o100000


def _finite_number(value: object) -> bool:
    """Accept finite JSON numbers while excluding booleans."""
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _optional_number(value: object) -> float | None:
    """Return a finite number as float, otherwise ``None``."""
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if not math.isfinite(value):
        return None
    return float(value)


def _optional_int(value: object) -> int | None:
    """Return a JSON integer, otherwise ``None``."""
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _optional_text(value: object) -> str | None:
    """Return a trimmed nonempty string, otherwise ``None``."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None
