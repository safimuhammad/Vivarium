"""Lossless segmented storage for replay events and exact checkpoints.

Each stream keeps a small active JSONL file and rotates complete records into
deterministic gzip level-1 segments. Segment and manifest publication use
same-directory temporary files plus :meth:`pathlib.Path.replace`, so readers see
either the old complete archive or the new complete archive after a crash.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import re
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO, Literal, Never, cast

from bus.events import Event
from observability.event_log import serialize_event

type ReplayStreamName = Literal["events", "checkpoints"]

logger = logging.getLogger(__name__)

DEFAULT_MAX_SEGMENT_BYTES = 2 * 1024 * 1024
ROTATION_STALL_BUDGET_SECONDS = 0.010
MANIFEST_FILENAME = "replay-manifest.json"
_STREAM_ACTIVE_NAMES: dict[ReplayStreamName, str] = {
    "events": "events.jsonl",
    "checkpoints": "snapshots.jsonl",
}
_STREAMS: tuple[ReplayStreamName, ...] = ("events", "checkpoints")
_SEGMENT_PATTERN = re.compile(r"^(events|snapshots)\.(\d{6})\.jsonl\.gz$")
_CLOSING_PATTERN = re.compile(r"^(events|snapshots)\.(\d{6})\.jsonl\.closing$")
_SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class ReplayArchiveError(RuntimeError):
    """Raised when a replay archive is malformed or cannot be recovered losslessly."""


@dataclass(frozen=True, slots=True)
class ReplayArchiveSegment:
    """Metadata for one immutable compressed JSONL segment."""

    name: str
    first_line: int
    last_line: int
    record_count: int
    uncompressed_bytes: int
    compressed_bytes: int
    sha256: str
    first_event_cursor: int | None = None
    last_event_cursor: int | None = None

    def to_dict(self) -> dict[str, object]:
        """Return JSON-ready segment metadata without filesystem paths."""
        return {
            "name": self.name,
            "first_line": self.first_line,
            "last_line": self.last_line,
            "record_count": self.record_count,
            "uncompressed_bytes": self.uncompressed_bytes,
            "compressed_bytes": self.compressed_bytes,
            "sha256": self.sha256,
            "first_event_cursor": self.first_event_cursor,
            "last_event_cursor": self.last_event_cursor,
        }

    @classmethod
    def from_dict(cls, value: object) -> ReplayArchiveSegment:
        """Validate and reconstruct segment metadata from manifest JSON."""
        if not isinstance(value, dict):
            raise ReplayArchiveError("archive segment metadata must be an object")
        expected_keys = {
            "name",
            "first_line",
            "last_line",
            "record_count",
            "uncompressed_bytes",
            "compressed_bytes",
            "sha256",
            "first_event_cursor",
            "last_event_cursor",
        }
        if set(value) != expected_keys:
            raise ReplayArchiveError("archive segment metadata fields are invalid")
        name = _required_string(value, "name")
        first_line = _required_integer(value, "first_line")
        last_line = _required_integer(value, "last_line")
        record_count = _required_integer(value, "record_count")
        uncompressed_bytes = _required_integer(value, "uncompressed_bytes")
        compressed_bytes = _required_integer(value, "compressed_bytes")
        sha256 = _required_string(value, "sha256")
        first_event_cursor = _optional_int(value["first_event_cursor"])
        last_event_cursor = _optional_int(value["last_event_cursor"])
        if first_line < 1 or last_line < first_line:
            raise ReplayArchiveError("archive segment line range must be positive")
        if record_count < 1 or record_count != last_line - first_line + 1:
            raise ReplayArchiveError("archive segment record count does not match its range")
        if uncompressed_bytes < 1 or compressed_bytes < 1:
            raise ReplayArchiveError("archive segment sizes must be positive")
        if _SHA256_PATTERN.fullmatch(sha256) is None:
            raise ReplayArchiveError("archive segment sha256 is invalid")
        return cls(
            name=name,
            first_line=first_line,
            last_line=last_line,
            record_count=record_count,
            uncompressed_bytes=uncompressed_bytes,
            compressed_bytes=compressed_bytes,
            sha256=sha256,
            first_event_cursor=first_event_cursor,
            last_event_cursor=last_event_cursor,
        )


@dataclass(slots=True)
class ReplayArchiveManifest:
    """Atomic manifest of every immutable replay segment for one run."""

    run_id: str
    streams: dict[ReplayStreamName, list[ReplayArchiveSegment]] = field(
        default_factory=lambda: {"events": [], "checkpoints": []}
    )
    schema: int = 1

    def to_dict(self) -> dict[str, object]:
        """Return the durable JSON manifest representation."""
        streams: dict[str, object] = {}
        for stream in _STREAMS:
            streams[stream] = {
                "active": _STREAM_ACTIVE_NAMES[stream],
                "segments": [segment.to_dict() for segment in self.streams[stream]],
            }
        return {"schema": self.schema, "run_id": self.run_id, "streams": streams}

    @classmethod
    def from_dict(cls, value: object, *, expected_run_id: str) -> ReplayArchiveManifest:
        """Validate and reconstruct a manifest for ``expected_run_id``."""
        if not isinstance(value, dict) or set(value) != {"schema", "run_id", "streams"}:
            raise ReplayArchiveError("replay manifest fields are invalid")
        if type(value.get("schema")) is not int or value.get("schema") != 1:
            raise ReplayArchiveError("replay manifest must use schema 1")
        if value.get("run_id") != expected_run_id:
            raise ReplayArchiveError("replay manifest belongs to a different run")
        raw_streams = value.get("streams")
        if not isinstance(raw_streams, dict) or set(raw_streams) != set(_STREAMS):
            raise ReplayArchiveError("replay manifest streams must be an object")
        streams: dict[ReplayStreamName, list[ReplayArchiveSegment]] = {
            "events": [],
            "checkpoints": [],
        }
        for stream in _STREAMS:
            raw_stream = raw_streams.get(stream)
            if (
                not isinstance(raw_stream, dict)
                or set(raw_stream) != {"active", "segments"}
                or raw_stream.get("active") != _STREAM_ACTIVE_NAMES[stream]
                or not isinstance(raw_stream.get("segments"), list)
            ):
                raise ReplayArchiveError(f"replay manifest {stream} stream is invalid")
            segments = [
                ReplayArchiveSegment.from_dict(segment)
                for segment in cast(list[object], raw_stream["segments"])
            ]
            _validate_segment_sequence(stream, segments)
            streams[stream] = segments
        return cls(run_id=expected_run_id, streams=streams)


@dataclass(frozen=True, slots=True)
class ReplayArchiveSummary:
    """Atomic record and checkpoint-cursor summary for bounded API metadata."""

    event_count: int
    checkpoint_count: int
    first_checkpoint_event_cursor: int | None
    last_checkpoint_event_cursor: int | None


@dataclass(slots=True)
class _StreamState:
    stream: ReplayStreamName
    active_path: Path
    segments: list[ReplayArchiveSegment]
    next_line: int
    active_first_line: int | None
    active_record_count: int
    active_bytes: int
    active_first_event_cursor: int | None
    active_last_event_cursor: int | None


@dataclass(frozen=True, slots=True)
class _StreamReadSnapshot:
    segments: tuple[ReplayArchiveSegment, ...]
    active_handle: BinaryIO | None
    active_first_line: int | None
    active_byte_limit: int


class ReplayArchive:
    """Own the event and checkpoint archive streams for a single run."""

    def __init__(
        self,
        run_dir: str | Path,
        run_id: str,
        *,
        max_segment_bytes: int = DEFAULT_MAX_SEGMENT_BYTES,
    ) -> None:
        """Open or recover one archive without changing complete record bytes."""
        if max_segment_bytes < 1:
            raise ValueError("max_segment_bytes must be at least 1")
        self._lock = threading.RLock()
        self._max_segment_bytes = max_segment_bytes
        self._last_rotation_seconds: float | None = None
        self._poisoned_error: ReplayArchiveError | None = None
        self.run_dir = Path(run_dir)
        self.run_id = run_id
        self.manifest_path = self.run_dir / MANIFEST_FILENAME
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self._remove_orphan_temps()
        self._recover_closing_files()
        self._manifest = self._read_manifest()
        self._reconcile_unlisted_segments()
        self._states: dict[ReplayStreamName, _StreamState] = {
            stream: self._build_state(stream) for stream in _STREAMS
        }

    @property
    def max_segment_bytes(self) -> int:
        """Return the active-segment rotation threshold."""
        with self._lock:
            return self._max_segment_bytes

    @max_segment_bytes.setter
    def max_segment_bytes(self, value: int) -> None:
        """Set a positive active-segment rotation threshold atomically."""
        if value < 1:
            raise ValueError("max_segment_bytes must be at least 1")
        with self._lock:
            self._ensure_healthy()
            self._max_segment_bytes = value

    @property
    def last_rotation_seconds(self) -> float | None:
        """Return wall time for the last committed synchronous rotation."""
        with self._lock:
            return self._last_rotation_seconds

    def append_event_line(self, line: bytes) -> int:
        """Append one exact event JSONL record and return its one-based line cursor."""
        return self._append_line("events", line)

    def record(self, event: Event) -> None:
        """Serialize and append ``event`` using the durable event-log byte contract."""
        line = (json.dumps(serialize_event(event), default=str) + "\n").encode("utf-8")
        self.append_event_line(line)

    def append_checkpoint_line(self, line: bytes) -> int:
        """Append one exact checkpoint JSONL record and return its one-based line number."""
        return self._append_line("checkpoints", line)

    def iter_lines(
        self,
        stream: ReplayStreamName,
        *,
        first_line: int = 1,
        last_line: int | None = None,
    ) -> Iterator[tuple[int, bytes]]:
        """Yield complete records lazily in stable order within inclusive bounds."""
        if first_line < 1:
            raise ValueError("first_line must be at least 1")
        if last_line is not None and last_line < first_line:
            return iter(())
        with self._lock:
            self._ensure_healthy()
            state = self._states[stream]
            active_handle: BinaryIO | None = None
            if state.active_bytes:
                try:
                    active_handle = state.active_path.open("rb")
                except OSError as exc:
                    raise ReplayArchiveError(
                        f"active replay file {state.active_path.name!r} cannot be snapshotted"
                    ) from exc
            snapshot = _StreamReadSnapshot(
                segments=tuple(state.segments),
                active_handle=active_handle,
                active_first_line=state.active_first_line,
                active_byte_limit=state.active_bytes,
            )
        return self._iter_snapshot_lines(
            snapshot,
            first_line=first_line,
            last_line=last_line,
        )

    def _iter_snapshot_lines(
        self,
        snapshot: _StreamReadSnapshot,
        *,
        first_line: int,
        last_line: int | None,
    ) -> Iterator[tuple[int, bytes]]:
        """Yield a captured descriptor snapshot without retaining the archive lock."""
        try:
            for segment in snapshot.segments:
                if segment.last_line < first_line:
                    continue
                if last_line is not None and segment.first_line > last_line:
                    break
                path = self.run_dir / segment.name
                try:
                    with gzip.open(path, "rb") as handle:
                        for offset, line in enumerate(handle):
                            cursor = segment.first_line + offset
                            if cursor < first_line:
                                continue
                            if last_line is not None and cursor > last_line:
                                break
                            yield cursor, line
                except (OSError, EOFError) as exc:
                    raise ReplayArchiveError(
                        f"replay segment {segment.name!r} cannot be read"
                    ) from exc

            if snapshot.active_handle is None or snapshot.active_first_line is None:
                return
            raw = snapshot.active_handle.read(snapshot.active_byte_limit)
            if len(raw) != snapshot.active_byte_limit or (raw and not raw.endswith(b"\n")):
                raise ReplayArchiveError("active replay snapshot is incomplete")
            for offset, line in enumerate(raw.splitlines(keepends=True)):
                cursor = snapshot.active_first_line + offset
                if cursor < first_line:
                    continue
                if last_line is not None and cursor > last_line:
                    break
                yield cursor, line
        finally:
            if snapshot.active_handle is not None:
                snapshot.active_handle.close()

    def summary(self) -> ReplayArchiveSummary:
        """Return counts and checkpoint cursor bounds from one atomic state snapshot."""
        with self._lock:
            self._ensure_healthy()
            event_state = self._states["events"]
            checkpoint_state = self._states["checkpoints"]
            checkpoint_count = checkpoint_state.next_line - 1
            first_cursor: int | None = None
            last_cursor: int | None = None
            if checkpoint_count:
                if checkpoint_state.segments:
                    first_cursor = checkpoint_state.segments[0].first_event_cursor
                else:
                    first_cursor = checkpoint_state.active_first_event_cursor
                if checkpoint_state.active_record_count:
                    last_cursor = checkpoint_state.active_last_event_cursor
                elif checkpoint_state.segments:
                    last_cursor = checkpoint_state.segments[-1].last_event_cursor
                if first_cursor is None or last_cursor is None:
                    raise ReplayArchiveError("checkpoint cursor summary is incomplete")
            return ReplayArchiveSummary(
                event_count=event_state.next_line - 1,
                checkpoint_count=checkpoint_count,
                first_checkpoint_event_cursor=first_cursor,
                last_checkpoint_event_cursor=last_cursor,
            )

    def load_manifest(self) -> ReplayArchiveManifest:
        """Return the current in-memory manifest of immutable segments."""
        with self._lock:
            self._ensure_healthy()
            return ReplayArchiveManifest(
                run_id=self._manifest.run_id,
                streams={
                    "events": list(self._manifest.streams["events"]),
                    "checkpoints": list(self._manifest.streams["checkpoints"]),
                },
            )

    def record_count(self, stream: ReplayStreamName) -> int:
        """Return the total number of complete records in ``stream``."""
        with self._lock:
            self._ensure_healthy()
            return self._states[stream].next_line - 1

    def _append_line(self, stream: ReplayStreamName, line: bytes) -> int:
        with self._lock:
            self._ensure_healthy()
            value = _validate_jsonl_line(line)
            state = self._states[stream]
            cursor = state.next_line
            event_cursor = (
                _checkpoint_event_cursor_from_value(value) if stream == "checkpoints" else None
            )
            del value  # Do not retain a decoded world snapshot during segment rotation.
            try:
                with state.active_path.open("ab", buffering=0) as handle:
                    written = handle.write(line)
            except OSError as exc:
                self._restore_failed_append(state)
                raise ReplayArchiveError(
                    f"active {stream} append failed and was rolled back"
                ) from exc
            if written != len(line):
                short_write = OSError(
                    f"active {stream} append wrote {written} of {len(line)} bytes"
                )
                self._restore_failed_append(state)
                raise ReplayArchiveError(
                    f"active {stream} append was incomplete and was rolled back"
                ) from short_write
            if state.active_first_line is None:
                state.active_first_line = cursor
                state.active_first_event_cursor = event_cursor
            state.active_last_event_cursor = event_cursor
            state.active_record_count += 1
            state.active_bytes += len(line)
            state.next_line += 1
            if state.active_bytes >= self._max_segment_bytes:
                self._rotate(state)
            return cursor

    def _restore_failed_append(self, state: _StreamState) -> None:
        try:
            with state.active_path.open("r+b", buffering=0) as handle:
                handle.truncate(state.active_bytes)
        except OSError as rollback_exc:
            self._poisoned_error = ReplayArchiveError(
                f"active {state.stream} append rollback failed; archive is poisoned"
            )
            raise self._poisoned_error from rollback_exc

    def _rotate(self, state: _StreamState) -> None:
        if state.active_record_count == 0 or state.active_first_line is None:
            return
        started_at = time.perf_counter()
        sequence = _next_sequence(state.segments)
        stem = state.active_path.stem
        closing = self.run_dir / f"{stem}.{sequence:06d}.jsonl.closing"
        final = self.run_dir / f"{stem}.{sequence:06d}.jsonl.gz"
        temp = final.with_name(final.name + ".tmp")
        manifest_temp = self.manifest_path.with_name(self.manifest_path.name + ".tmp")
        for path in (closing, final, temp, manifest_temp):
            if path.exists():
                raise ReplayArchiveError(
                    f"replay rotation cannot overwrite existing file {path.name!r}"
                )

        candidate_manifest: ReplayArchiveManifest | None = None
        candidate_segments: list[ReplayArchiveSegment] | None = None
        previous_manifest = self._manifest
        raw = b""
        try:
            _replace_path(state.active_path, closing)
            _write_bytes(state.active_path, b"")
            raw = closing.read_bytes()
            compressed = _compress_segment(raw)
            _write_bytes(temp, compressed)
            _replace_path(temp, final)
            segment = ReplayArchiveSegment(
                name=final.name,
                first_line=state.active_first_line,
                last_line=state.next_line - 1,
                record_count=state.active_record_count,
                uncompressed_bytes=len(raw),
                compressed_bytes=len(compressed),
                sha256=hashlib.sha256(raw).hexdigest(),
                first_event_cursor=state.active_first_event_cursor,
                last_event_cursor=state.active_last_event_cursor,
            )
            candidate_segments = [*state.segments, segment]
            candidate_manifest = ReplayArchiveManifest(
                run_id=self._manifest.run_id,
                streams={
                    "events": (
                        candidate_segments
                        if state.stream == "events"
                        else list(self._manifest.streams["events"])
                    ),
                    "checkpoints": (
                        candidate_segments
                        if state.stream == "checkpoints"
                        else list(self._manifest.streams["checkpoints"])
                    ),
                },
            )
        except Exception as exc:
            self._rollback_verified_precommit(
                state=state,
                closing=closing,
                temp=temp,
                final=final,
                manifest_temp=manifest_temp,
                cause=exc,
            )

        if candidate_manifest is None or candidate_segments is None:
            raise AssertionError("rotation candidate was not built")
        try:
            self._write_manifest(candidate_manifest)
        except Exception as exc:
            publication = self._manifest_publication_outcome(
                previous=previous_manifest,
                candidate=candidate_manifest,
                candidate_final=final,
            )
            if publication == "previous":
                self._rollback_verified_precommit(
                    state=state,
                    closing=closing,
                    temp=temp,
                    final=final,
                    manifest_temp=manifest_temp,
                    cause=exc,
                )
            if publication == "ambiguous":
                self._poisoned_error = ReplayArchiveError(
                    "replay manifest publication is ambiguous; archive is poisoned"
                )
                raise self._poisoned_error from exc
            logger.warning(
                "Manifest publication raised after verified durable commit",
                extra={"run_id": self.run_id, "segment": final.name},
                exc_info=True,
            )

        self._manifest = candidate_manifest
        state.segments = candidate_segments
        state.active_first_line = None
        state.active_record_count = 0
        state.active_bytes = 0
        state.active_first_event_cursor = None
        state.active_last_event_cursor = None
        try:
            closing.unlink()
        except OSError:
            logger.warning(
                "Committed replay segment cleanup deferred",
                extra={"run_id": self.run_id, "segment": final.name},
                exc_info=True,
            )
        self._last_rotation_seconds = time.perf_counter() - started_at
        if self._last_rotation_seconds > ROTATION_STALL_BUDGET_SECONDS:
            logger.warning(
                "Replay rotation exceeded synchronous stall budget",
                extra={
                    "run_id": self.run_id,
                    "stream": state.stream,
                    "elapsed_seconds": self._last_rotation_seconds,
                    "budget_seconds": ROTATION_STALL_BUDGET_SECONDS,
                    "uncompressed_bytes": len(raw),
                },
            )

    def _manifest_publication_outcome(
        self,
        *,
        previous: ReplayArchiveManifest,
        candidate: ReplayArchiveManifest,
        candidate_final: Path,
    ) -> Literal["previous", "candidate", "ambiguous"]:
        """Classify durable manifest state after publication raised."""
        try:
            durable = self._read_manifest()
        except ReplayArchiveError:
            return "ambiguous"
        if durable == previous:
            return "previous"
        if durable == candidate and candidate_final.is_file() and not candidate_final.is_symlink():
            return "candidate"
        return "ambiguous"

    def _rollback_verified_precommit(
        self,
        *,
        state: _StreamState,
        closing: Path,
        temp: Path,
        final: Path,
        manifest_temp: Path,
        cause: Exception,
    ) -> Never:
        """Roll back a state known not to have crossed the manifest commit boundary."""
        try:
            self._rollback_rotation(
                active=state.active_path,
                closing=closing,
                temp=temp,
                final=final,
                manifest_temp=manifest_temp,
                expected_active_bytes=state.active_bytes,
            )
        except Exception as rollback_exc:
            self._poisoned_error = ReplayArchiveError(
                "replay rotation rollback failed; archive is poisoned"
            )
            raise self._poisoned_error from rollback_exc
        raise ReplayArchiveError(
            "replay rotation failed before manifest commit; active data was restored"
        ) from cause

    def _rollback_rotation(
        self,
        *,
        active: Path,
        closing: Path,
        temp: Path,
        final: Path,
        manifest_temp: Path,
        expected_active_bytes: int,
    ) -> None:
        """Restore a failed pre-commit rotation or raise when restoration is incomplete."""
        failures: list[OSError] = []
        for path in (temp, final, manifest_temp):
            try:
                path.unlink(missing_ok=True)
            except OSError as exc:
                failures.append(exc)
        if closing.is_file():
            try:
                active.unlink(missing_ok=True)
                _replace_path(closing, active)
            except OSError as exc:
                failures.append(exc)
        elif not active.is_file():
            failures.append(OSError(f"closing replay file {closing.name!r} is missing"))
        try:
            restored_size = active.stat().st_size
        except OSError as exc:
            failures.append(exc)
            restored_size = -1
        if (
            failures
            or restored_size != expected_active_bytes
            or not active.is_file()
            or closing.exists()
        ):
            cause = failures[0] if failures else OSError("restored active replay size is invalid")
            raise ReplayArchiveError("failed to restore active replay file") from cause

    def _ensure_healthy(self) -> None:
        if self._poisoned_error is not None:
            raise self._poisoned_error

    def _read_manifest(self) -> ReplayArchiveManifest:
        if not self.manifest_path.exists():
            return ReplayArchiveManifest(run_id=self.run_id)
        if self.manifest_path.is_symlink():
            raise ReplayArchiveError("replay manifest must not be a symlink")
        try:
            value = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ReplayArchiveError("replay manifest cannot be read") from exc
        return ReplayArchiveManifest.from_dict(value, expected_run_id=self.run_id)

    def _write_manifest(self, manifest: ReplayArchiveManifest) -> None:
        temp = self.manifest_path.with_name(self.manifest_path.name + ".tmp")
        validated = ReplayArchiveManifest.from_dict(
            manifest.to_dict(),
            expected_run_id=self.run_id,
        )
        payload = json.dumps(validated.to_dict(), allow_nan=False, sort_keys=True)
        _write_bytes(temp, (payload + "\n").encode("utf-8"))
        _replace_path(temp, self.manifest_path)

    def _build_state(self, stream: ReplayStreamName) -> _StreamState:
        active_path = self.run_dir / _STREAM_ACTIVE_NAMES[stream]
        if active_path.is_symlink():
            raise ReplayArchiveError(
                f"active replay file {active_path.name!r} must not be a symlink"
            )
        _repair_partial_tail(active_path)
        active_path.touch(exist_ok=True)
        segments = list(self._manifest.streams[stream])
        last_closed = segments[-1].last_line if segments else 0
        active_lines = _complete_lines(active_path)
        active_first = last_closed + 1 if active_lines else None
        first_event_cursor: int | None = None
        last_event_cursor: int | None = None
        if stream == "checkpoints" and active_lines:
            first_event_cursor = _checkpoint_event_cursor(active_lines[0])
            last_event_cursor = _checkpoint_event_cursor(active_lines[-1])
        return _StreamState(
            stream=stream,
            active_path=active_path,
            segments=segments,
            next_line=last_closed + len(active_lines) + 1,
            active_first_line=active_first,
            active_record_count=len(active_lines),
            active_bytes=active_path.stat().st_size if active_path.exists() else 0,
            active_first_event_cursor=first_event_cursor,
            active_last_event_cursor=last_event_cursor,
        )

    def _remove_orphan_temps(self) -> None:
        for path in self.run_dir.glob("*.tmp"):
            path.unlink(missing_ok=True)

    def _recover_closing_files(self) -> None:
        for closing in self.run_dir.glob("*.jsonl.closing"):
            if closing.is_symlink():
                raise ReplayArchiveError(
                    f"closing replay file {closing.name!r} must not be a symlink"
                )
            match = _CLOSING_PATTERN.match(closing.name)
            if match is None:
                raise ReplayArchiveError(f"unknown closing replay file {closing.name!r}")
            stem, sequence = match.groups()
            final = self.run_dir / f"{stem}.{sequence}.jsonl.gz"
            if final.is_symlink():
                raise ReplayArchiveError(f"replay segment {final.name!r} must not be a symlink")
            raw = closing.read_bytes()
            if final.exists():
                try:
                    existing = gzip.decompress(final.read_bytes())
                except (OSError, EOFError) as exc:
                    raise ReplayArchiveError(f"corrupt replay segment {final.name!r}") from exc
                if existing != raw:
                    raise ReplayArchiveError(f"closing replay file conflicts with {final.name!r}")
            else:
                temp = final.with_name(final.name + ".tmp")
                _write_bytes(temp, _compress_segment(raw))
                _replace_path(temp, final)
            try:
                closing.unlink()
            except OSError:
                logger.warning(
                    "Recovered replay closing file cleanup deferred",
                    extra={"run_id": self.run_id, "segment": final.name},
                    exc_info=True,
                )

    def _reconcile_unlisted_segments(self) -> None:
        changed = False
        for stream in _STREAMS:
            listed = {segment.name for segment in self._manifest.streams[stream]}
            expected_stem = Path(_STREAM_ACTIVE_NAMES[stream]).stem
            for path in sorted(self.run_dir.glob(f"{expected_stem}.*.jsonl.gz")):
                if path.is_symlink():
                    raise ReplayArchiveError(f"replay segment {path.name!r} must not be a symlink")
                if path.name in listed:
                    continue
                expected_sequence = _next_sequence(self._manifest.streams[stream])
                match = _SEGMENT_PATTERN.fullmatch(path.name)
                if match is None or int(match.group(2)) != expected_sequence:
                    raise ReplayArchiveError(
                        f"unlisted replay segment {path.name!r} is out of sequence"
                    )
                self._manifest.streams[stream].append(
                    _inspect_segment(
                        path,
                        stream=stream,
                        first_line=_next_first_line(self._manifest.streams[stream]),
                    )
                )
                changed = True
            for segment in self._manifest.streams[stream]:
                segment_path = self.run_dir / segment.name
                if segment_path.is_symlink():
                    raise ReplayArchiveError(
                        f"replay segment {segment.name!r} must not be a symlink"
                    )
                if not segment_path.is_file():
                    raise ReplayArchiveError(f"replay segment {segment.name!r} is missing")
        if changed:
            self._write_manifest(self._manifest)


def _inspect_segment(
    path: Path,
    *,
    stream: ReplayStreamName,
    first_line: int,
) -> ReplayArchiveSegment:
    try:
        raw = gzip.decompress(path.read_bytes())
    except (OSError, EOFError) as exc:
        raise ReplayArchiveError(f"corrupt replay segment {path.name!r}") from exc
    lines = raw.splitlines(keepends=True)
    if not lines or b"".join(lines) != raw or any(not line.endswith(b"\n") for line in lines):
        raise ReplayArchiveError(f"replay segment {path.name!r} has an incomplete record")
    first_event_cursor: int | None = None
    last_event_cursor: int | None = None
    if stream == "checkpoints":
        first_event_cursor = _checkpoint_event_cursor(lines[0])
        last_event_cursor = _checkpoint_event_cursor(lines[-1])
    return ReplayArchiveSegment(
        name=path.name,
        first_line=first_line,
        last_line=first_line + len(lines) - 1,
        record_count=len(lines),
        uncompressed_bytes=len(raw),
        compressed_bytes=path.stat().st_size,
        sha256=hashlib.sha256(raw).hexdigest(),
        first_event_cursor=first_event_cursor,
        last_event_cursor=last_event_cursor,
    )


def _repair_partial_tail(path: Path) -> None:
    if not path.exists():
        return
    try:
        with path.open("r+b") as handle:
            handle.seek(0, 2)
            end = handle.tell()
            if end == 0:
                return
            handle.seek(end - 1)
            if handle.read(1) == b"\n":
                return

            truncate_at = 0
            scan_end = end
            while scan_end:
                scan_start = max(0, scan_end - 64 * 1024)
                handle.seek(scan_start)
                chunk = handle.read(scan_end - scan_start)
                if (last_newline := chunk.rfind(b"\n")) >= 0:
                    truncate_at = scan_start + last_newline + 1
                    break
                scan_end = scan_start
            handle.truncate(truncate_at)
            handle.flush()
    except OSError as exc:
        raise ReplayArchiveError(f"active replay file {path.name!r} could not be repaired") from exc


def _complete_lines(path: Path) -> list[bytes]:
    if not path.exists():
        return []
    raw = path.read_bytes()
    if raw and not raw.endswith(b"\n"):
        raise ReplayArchiveError(f"active replay file {path.name!r} has an incomplete tail")
    return raw.splitlines(keepends=True)


def _validate_jsonl_line(line: bytes) -> object:
    """Validate the JSONL boundary and return its decoded value for reuse."""
    if not line or not line.endswith(b"\n") or line.count(b"\n") != 1:
        raise ReplayArchiveError("replay records must be one newline-terminated JSONL line")
    try:
        return json.loads(line)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReplayArchiveError("replay record must contain valid JSON") from exc


def _checkpoint_event_cursor(line: bytes) -> int:
    try:
        value = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ReplayArchiveError("checkpoint record has no valid event_cursor") from exc
    return _checkpoint_event_cursor_from_value(value)


def _checkpoint_event_cursor_from_value(value: object) -> int:
    """Read the cursor from already decoded JSON without re-parsing a snapshot."""
    if not isinstance(value, dict):
        raise ReplayArchiveError("checkpoint record has no valid event_cursor")
    try:
        cursor = value["event_cursor"]
    except KeyError as exc:
        raise ReplayArchiveError("checkpoint record has no valid event_cursor") from exc
    if not isinstance(cursor, int) or isinstance(cursor, bool) or cursor < 0:
        raise ReplayArchiveError("checkpoint event_cursor must be a non-negative integer")
    return cursor


def _next_first_line(segments: list[ReplayArchiveSegment]) -> int:
    return segments[-1].last_line + 1 if segments else 1


def _next_sequence(segments: list[ReplayArchiveSegment]) -> int:
    if not segments:
        return 1
    match = _SEGMENT_PATTERN.match(segments[-1].name)
    if match is None:
        raise ReplayArchiveError(f"invalid replay segment name {segments[-1].name!r}")
    return int(match.group(2)) + 1


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if type(value) is not int or value < 0:
        raise ReplayArchiveError("optional cursor must be a non-negative integer or null")
    return value


def _required_integer(value: dict[object, object], key: str) -> int:
    raw = value.get(key)
    if type(raw) is not int:
        raise ReplayArchiveError(f"archive segment {key} must be an integer")
    return raw


def _required_string(value: dict[object, object], key: str) -> str:
    raw = value.get(key)
    if not isinstance(raw, str):
        raise ReplayArchiveError(f"archive segment {key} must be a string")
    return raw


def _validate_segment_sequence(
    stream: ReplayStreamName,
    segments: list[ReplayArchiveSegment],
) -> None:
    expected_stem = Path(_STREAM_ACTIVE_NAMES[stream]).stem
    expected_first_line = 1
    for expected_sequence, segment in enumerate(segments, start=1):
        if Path(segment.name).name != segment.name or "/" in segment.name or "\\" in segment.name:
            raise ReplayArchiveError("archive segment name must be a basename")
        match = _SEGMENT_PATTERN.fullmatch(segment.name)
        if (
            match is None
            or match.group(1) != expected_stem
            or int(match.group(2)) != expected_sequence
        ):
            raise ReplayArchiveError(f"archive segment sequence for {stream} is invalid")
        if segment.first_line != expected_first_line:
            raise ReplayArchiveError(f"archive segment line ranges for {stream} are not contiguous")
        if stream == "events":
            if segment.first_event_cursor is not None or segment.last_event_cursor is not None:
                raise ReplayArchiveError("event segments cannot contain checkpoint cursors")
        elif (
            segment.first_event_cursor is None
            or segment.last_event_cursor is None
            or segment.first_event_cursor > segment.last_event_cursor
        ):
            raise ReplayArchiveError("checkpoint segment cursors are invalid")
        expected_first_line = segment.last_line + 1


def _compress_segment(raw: bytes) -> bytes:
    return gzip.compress(raw, compresslevel=1, mtime=0)


def _write_bytes(path: Path, payload: bytes) -> None:
    path.write_bytes(payload)


def _replace_path(source: Path, target: Path) -> None:
    source.replace(target)
