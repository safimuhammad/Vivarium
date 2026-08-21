"""Tests for lossless, segmented replay archives."""

from __future__ import annotations

import gzip
import json
import threading
from pathlib import Path
from typing import Any

import pytest

import observability.replay_archive as replay_archive_module
from bus.events import Event, ScopeType
from observability.event_log import serialize_event
from observability.replay_archive import (
    DEFAULT_MAX_SEGMENT_BYTES,
    MANIFEST_FILENAME,
    ReplayArchive,
    ReplayArchiveError,
    ReplayArchiveManifest,
)


def _checkpoint_line(event_cursor: int, *, marker: str) -> bytes:
    record = {
        "schema": 1,
        "type": "world_snapshot_checkpoint",
        "reason": "world_tick",
        "run_id": "run-test",
        "world_time": float(event_cursor),
        "event_cursor": event_cursor,
        "snapshot": {"marker": marker},
    }
    return (json.dumps(record, sort_keys=True) + "\n").encode("utf-8")


def _event_line(marker: str) -> bytes:
    return (json.dumps({"type": "speak", "marker": marker}) + "\n").encode("utf-8")


def test_rotation_preserves_checkpoint_bytes_order_and_cursor_bounds(tmp_path: Path) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    lines = [
        _checkpoint_line(3, marker="first"),
        _checkpoint_line(3, marker="silent-tick"),
        _checkpoint_line(8, marker="last"),
    ]

    for line in lines:
        archive.append_checkpoint_line(line)

    assert [line for _, line in archive.iter_lines("checkpoints")] == lines
    segments = archive.load_manifest().streams["checkpoints"]
    assert [(segment.first_line, segment.last_line) for segment in segments] == [
        (1, 1),
        (2, 2),
        (3, 3),
    ]
    assert [(segment.first_event_cursor, segment.last_event_cursor) for segment in segments] == [
        (3, 3),
        (3, 3),
        (8, 8),
    ]
    assert not list((tmp_path / "run-test").glob("*.tmp"))

    for segment in segments:
        compressed = tmp_path / "run-test" / segment.name
        assert gzip.decompress(compressed.read_bytes()) == lines[segment.first_line - 1]
        assert compressed.read_bytes()[8] == 4  # gzip XFL: fastest compression, level 1


def test_reopen_repairs_partial_active_tail_and_removes_orphan_temps(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-test"
    archive = ReplayArchive(run_dir, "run-test", max_segment_bytes=1_000_000)
    lines = [_checkpoint_line(1, marker="first"), _checkpoint_line(2, marker="second")]
    for line in lines:
        archive.append_checkpoint_line(line)

    with (run_dir / "snapshots.jsonl").open("ab") as handle:
        handle.write(b'{"truncated":')
    (run_dir / "replay-manifest.json.tmp").write_text("orphan", encoding="utf-8")
    (run_dir / "snapshots.999999.jsonl.gz.tmp").write_bytes(b"orphan")

    recovered = ReplayArchive(run_dir, "run-test", max_segment_bytes=1_000_000)

    assert [line for _, line in recovered.iter_lines("checkpoints")] == lines
    assert (run_dir / "snapshots.jsonl").read_bytes() == b"".join(lines)
    assert not list(run_dir.glob("*.tmp"))

    third = _checkpoint_line(3, marker="third")
    recovered.append_checkpoint_line(third)
    assert [line for _, line in recovered.iter_lines("checkpoints")] == [*lines, third]


def test_partial_tail_recovery_truncates_in_place_and_preserves_complete_prefix(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    run_dir = tmp_path / "run-test"
    archive = ReplayArchive(run_dir, "run-test", max_segment_bytes=1_000_000)
    lines = [_event_line("first"), _event_line("second")]
    for line in lines:
        archive.append_event_line(line)
    active = run_dir / "events.jsonl"
    with active.open("ab") as handle:
        handle.write(b'{"partial":')

    original_write_bytes = Path.write_bytes

    def forbid_active_rewrite(path: Path, payload: bytes) -> int:
        if path == active:
            raise AssertionError("active replay recovery must not rewrite the complete prefix")
        return original_write_bytes(path, payload)

    monkeypatch.setattr(Path, "write_bytes", forbid_active_rewrite)

    recovered = ReplayArchive(run_dir, "run-test", max_segment_bytes=1_000_000)

    assert active.read_bytes() == b"".join(lines)
    assert list(recovered.iter_lines("events")) == [(1, lines[0]), (2, lines[1])]


def test_event_and_checkpoint_streams_keep_independent_line_cursors(tmp_path: Path) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1_000_000)

    archive.append_event_line(_event_line("one"))
    archive.append_checkpoint_line(_checkpoint_line(1, marker="checkpoint"))
    archive.append_event_line(_event_line("two"))

    assert list(archive.iter_lines("events")) == [
        (1, _event_line("one")),
        (2, _event_line("two")),
    ]
    assert list(archive.iter_lines("checkpoints")) == [
        (1, _checkpoint_line(1, marker="checkpoint")),
    ]


def test_archive_is_an_exact_event_log_sink(tmp_path: Path) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    event = Event(
        "speak",
        "wanderer_001",
        {"message": "hello"},
        ScopeType.LOCAL,
        region="nirvana",
        timestamp=12.5,
    )

    archive.record(event)

    expected = (json.dumps(serialize_event(event), default=str) + "\n").encode("utf-8")
    assert list(archive.iter_lines("events")) == [(1, expected)]


def test_archive_iteration_is_lazy_for_raw_export(tmp_path: Path) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    archive.append_event_line(_event_line("one"))
    archive.append_event_line(_event_line("two"))

    records = archive.iter_lines("events")

    assert iter(records) is records
    assert next(records) == (1, _event_line("one"))


@pytest.mark.parametrize("failure_stage", ["rename", "gzip", "temp", "final", "manifest"])
def test_precommit_rotation_failure_rolls_back_losslessly_and_remains_appendable(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    failure_stage: str,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    failed = False

    original_compress = getattr(
        replay_archive_module,
        "_compress_segment",
        lambda raw: gzip.compress(raw, compresslevel=1, mtime=0),
    )
    original_write = getattr(
        replay_archive_module,
        "_write_bytes",
        lambda path, payload: path.write_bytes(payload),
    )
    original_replace = getattr(
        replay_archive_module,
        "_replace_path",
        lambda source, target: source.replace(target),
    )

    def fail_compress_once(raw: bytes) -> bytes:
        nonlocal failed
        if failure_stage == "gzip" and not failed:
            failed = True
            raise OSError("injected gzip failure")
        return original_compress(raw)

    def fail_temp_once(path: Path, payload: bytes) -> None:
        nonlocal failed
        if failure_stage == "temp" and path.name.endswith(".jsonl.gz.tmp") and not failed:
            failed = True
            raise OSError("injected temp write failure")
        original_write(path, payload)

    def fail_publish_once(source: Path, target: Path) -> None:
        nonlocal failed
        is_target = (
            (failure_stage == "rename" and target.name.endswith(".closing"))
            or (failure_stage == "final" and target.name.endswith(".jsonl.gz"))
            or (failure_stage == "manifest" and target.name == MANIFEST_FILENAME)
        )
        if is_target and not failed:
            failed = True
            raise OSError(f"injected {failure_stage} publish failure")
        original_replace(source, target)

    monkeypatch.setattr(
        replay_archive_module,
        "_compress_segment",
        fail_compress_once,
        raising=False,
    )
    monkeypatch.setattr(replay_archive_module, "_write_bytes", fail_temp_once, raising=False)
    monkeypatch.setattr(
        replay_archive_module,
        "_replace_path",
        fail_publish_once,
        raising=False,
    )

    first = _event_line("first")
    with pytest.raises(ReplayArchiveError, match="rotation"):
        archive.append_event_line(first)

    assert failed is True
    assert archive.record_count("events") == 1
    assert (archive.run_dir / "events.jsonl").read_bytes() == first
    assert not list(archive.run_dir.glob("events.*.jsonl.gz"))
    assert not list(archive.run_dir.glob("*.closing"))
    assert not list(archive.run_dir.glob("*.tmp"))

    second = _event_line("second")
    archive.append_event_line(second)

    assert list(archive.iter_lines("events")) == [(1, first), (2, second)]


def test_manifest_replace_then_raise_finishes_verified_durable_commit(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    original_replace = replay_archive_module._replace_path
    raised_after_commit = False

    def replace_then_raise(source: Path, target: Path) -> None:
        nonlocal raised_after_commit
        original_replace(source, target)
        if target.name == MANIFEST_FILENAME and not raised_after_commit:
            raised_after_commit = True
            raise OSError("injected exception after durable manifest replacement")

    monkeypatch.setattr(replay_archive_module, "_replace_path", replace_then_raise)
    first = _event_line("first")
    second = _event_line("second")

    assert archive.append_event_line(first) == 1

    assert raised_after_commit is True
    assert archive.record_count("events") == 1
    assert list(archive.iter_lines("events")) == [(1, first)]
    assert len(archive.load_manifest().streams["events"]) == 1
    assert (archive.run_dir / "events.jsonl").read_bytes() == b""
    assert not list(archive.run_dir.glob("*.closing"))

    assert archive.append_event_line(second) == 2
    assert list(archive.iter_lines("events")) == [(1, first), (2, second)]


def test_ambiguous_manifest_publication_poison_preserves_candidate_for_recovery(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    original_replace = replay_archive_module._replace_path
    corrupted = False

    def publish_corrupt_manifest_then_raise(source: Path, target: Path) -> None:
        nonlocal corrupted
        if target.name == MANIFEST_FILENAME and not corrupted:
            corrupted = True
            source.write_bytes(b'{"truncated":')
            original_replace(source, target)
            raise OSError("injected ambiguous manifest publication")
        original_replace(source, target)

    monkeypatch.setattr(
        replay_archive_module,
        "_replace_path",
        publish_corrupt_manifest_then_raise,
    )

    with pytest.raises(ReplayArchiveError, match="poisoned"):
        archive.append_event_line(_event_line("candidate"))

    assert corrupted is True
    assert len(list(archive.run_dir.glob("events.*.jsonl.gz"))) == 1
    assert len(list(archive.run_dir.glob("events.*.closing"))) == 1
    assert (archive.run_dir / "events.jsonl").read_bytes() == b""
    with pytest.raises(ReplayArchiveError, match="poisoned"):
        archive.append_event_line(_event_line("must-not-write"))


def test_rotation_rollback_failure_poison_archive_fail_closed(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    original_replace = getattr(
        replay_archive_module,
        "_replace_path",
        lambda source, target: source.replace(target),
    )

    def fail_compress(_raw: bytes) -> bytes:
        raise OSError("injected gzip failure")

    def fail_rollback(source: Path, target: Path) -> None:
        if source.name.endswith(".closing") and target.name == "events.jsonl":
            raise OSError("injected rollback failure")
        original_replace(source, target)

    monkeypatch.setattr(
        replay_archive_module,
        "_compress_segment",
        fail_compress,
        raising=False,
    )
    monkeypatch.setattr(
        replay_archive_module,
        "_replace_path",
        fail_rollback,
        raising=False,
    )

    with pytest.raises(ReplayArchiveError, match="poisoned"):
        archive.append_event_line(_event_line("first"))
    with pytest.raises(ReplayArchiveError, match="poisoned"):
        archive.append_event_line(_event_line("must-not-write"))

    assert not (archive.run_dir / "events.jsonl").exists()
    assert len(list(archive.run_dir.glob("events.*.closing"))) == 1


def test_postcommit_cleanup_failure_keeps_committed_state_and_empty_active_file(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    original_unlink = Path.unlink

    def fail_closing_unlink(path: Path, *, missing_ok: bool = False) -> None:
        if path.name.endswith(".closing"):
            raise PermissionError("injected committed cleanup failure")
        original_unlink(path, missing_ok=missing_ok)

    monkeypatch.setattr(Path, "unlink", fail_closing_unlink)
    first = _event_line("first")
    second = _event_line("second")

    archive.append_event_line(first)
    assert (archive.run_dir / "events.jsonl").is_file()
    assert (archive.run_dir / "events.jsonl").read_bytes() == b""
    archive.append_event_line(second)

    assert archive.record_count("events") == 2
    assert list(archive.iter_lines("events")) == [(1, first), (2, second)]
    assert len(archive.load_manifest().streams["events"]) == 2


@pytest.mark.parametrize(
    ("stream", "active_name", "line"),
    [
        ("events", "events.jsonl", _event_line("event")),
        ("checkpoints", "snapshots.jsonl", _checkpoint_line(1, marker="checkpoint")),
    ],
)
def test_committed_rotation_leaves_truthful_empty_active_artifact(
    tmp_path: Path,
    stream: str,
    active_name: str,
    line: bytes,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)

    if stream == "events":
        archive.append_event_line(line)
    else:
        archive.append_checkpoint_line(line)

    active = archive.run_dir / active_name
    assert active.is_file()
    assert active.read_bytes() == b""


def test_iteration_uses_consistent_snapshot_during_concurrent_rotation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1)
    first = _event_line("first")
    second = _event_line("second")
    third = _event_line("third-after-snapshot")
    archive.append_event_line(first)
    archive.max_segment_bytes = 1_000_000
    archive.append_event_line(second)

    opened_segment = threading.Event()
    continue_reading = threading.Event()
    original_gzip_open = gzip.open
    blocked_once = False

    def blocking_gzip_open(*args: Any, **kwargs: Any) -> Any:
        nonlocal blocked_once
        if not blocked_once:
            blocked_once = True
            opened_segment.set()
            if not continue_reading.wait(timeout=2.0):
                raise TimeoutError("concurrent replay test barrier timed out")
        return original_gzip_open(*args, **kwargs)

    monkeypatch.setattr(gzip, "open", blocking_gzip_open)
    result: list[tuple[int, bytes]] = []
    errors: list[BaseException] = []

    def consume_snapshot() -> None:
        try:
            result.extend(archive.iter_lines("events"))
        except BaseException as exc:  # pragma: no cover - assertion captures worker failure
            errors.append(exc)

    worker = threading.Thread(target=consume_snapshot, daemon=True)
    worker.start()
    assert opened_segment.wait(timeout=2.0), "worker did not reach replay segment"
    try:
        archive.max_segment_bytes = 1
        archive.append_event_line(third)
    finally:
        continue_reading.set()
    worker.join(timeout=2.0)

    assert not worker.is_alive(), "concurrent replay worker did not terminate"
    assert errors == []
    assert result == [(1, first), (2, second)]
    assert list(archive.iter_lines("events")) == [
        (1, first),
        (2, second),
        (3, third),
    ]


def test_iteration_snapshot_is_captured_when_iterator_is_requested(tmp_path: Path) -> None:
    archive = ReplayArchive(tmp_path / "run-test", "run-test", max_segment_bytes=1_000_000)
    first = _event_line("first")
    second = _event_line("after-snapshot")
    archive.append_event_line(first)

    snapshot = archive.iter_lines("events")
    archive.append_event_line(second)

    assert list(snapshot) == [(1, first)]
    assert list(archive.iter_lines("events")) == [(1, first), (2, second)]


def _valid_manifest_payload() -> dict[str, object]:
    event_segments = [
        {
            "name": "events.000001.jsonl.gz",
            "first_line": 1,
            "last_line": 1,
            "record_count": 1,
            "uncompressed_bytes": 10,
            "compressed_bytes": 20,
            "sha256": "a" * 64,
            "first_event_cursor": None,
            "last_event_cursor": None,
        },
        {
            "name": "events.000002.jsonl.gz",
            "first_line": 2,
            "last_line": 2,
            "record_count": 1,
            "uncompressed_bytes": 10,
            "compressed_bytes": 20,
            "sha256": "b" * 64,
            "first_event_cursor": None,
            "last_event_cursor": None,
        },
    ]
    checkpoint_segment = {
        "name": "snapshots.000001.jsonl.gz",
        "first_line": 1,
        "last_line": 1,
        "record_count": 1,
        "uncompressed_bytes": 10,
        "compressed_bytes": 20,
        "sha256": "c" * 64,
        "first_event_cursor": 0,
        "last_event_cursor": 0,
    }
    return {
        "schema": 1,
        "run_id": "run-test",
        "streams": {
            "events": {"active": "events.jsonl", "segments": event_segments},
            "checkpoints": {
                "active": "snapshots.jsonl",
                "segments": [checkpoint_segment],
            },
        },
    }


@pytest.mark.parametrize(
    "case",
    [
        "active_name",
        "traversal",
        "wrong_stream",
        "sequence_gap",
        "line_gap",
        "nonpositive_line",
        "range_count_mismatch",
        "nonpositive_size",
        "bad_sha",
        "negative_cursor",
        "coerced_integer",
    ],
)
def test_manifest_rejects_malformed_segment_metadata(case: str) -> None:
    payload = _valid_manifest_payload()
    streams = payload["streams"]
    assert isinstance(streams, dict)
    events = streams["events"]
    checkpoints = streams["checkpoints"]
    assert isinstance(events, dict)
    assert isinstance(checkpoints, dict)
    event_segments = events["segments"]
    checkpoint_segments = checkpoints["segments"]
    assert isinstance(event_segments, list)
    assert isinstance(checkpoint_segments, list)
    first = event_segments[0]
    second = event_segments[1]
    checkpoint = checkpoint_segments[0]
    assert isinstance(first, dict)
    assert isinstance(second, dict)
    assert isinstance(checkpoint, dict)

    if case == "active_name":
        events["active"] = "../events.jsonl"
    elif case == "traversal":
        first["name"] = "../events.000001.jsonl.gz"
    elif case == "wrong_stream":
        first["name"] = "snapshots.000001.jsonl.gz"
    elif case == "sequence_gap":
        second["name"] = "events.000003.jsonl.gz"
    elif case == "line_gap":
        second["first_line"] = 3
        second["last_line"] = 3
    elif case == "nonpositive_line":
        first["first_line"] = 0
    elif case == "range_count_mismatch":
        first["record_count"] = 2
    elif case == "nonpositive_size":
        first["compressed_bytes"] = 0
    elif case == "bad_sha":
        first["sha256"] = "A" * 64
    elif case == "negative_cursor":
        checkpoint["first_event_cursor"] = -1
    elif case == "coerced_integer":
        first["first_line"] = "1"
    else:  # pragma: no cover - parametrization guard
        raise AssertionError(case)

    with pytest.raises(ReplayArchiveError):
        ReplayArchiveManifest.from_dict(payload, expected_run_id="run-test")


def test_archive_rejects_manifest_segment_symlink_escape(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-test"
    archive = ReplayArchive(run_dir, "run-test", max_segment_bytes=1)
    archive.append_event_line(_event_line("inside"))
    segment = archive.load_manifest().streams["events"][0]
    segment_path = run_dir / segment.name
    outside = tmp_path / "outside.jsonl.gz"
    outside.write_bytes(gzip.compress(_event_line("outside"), compresslevel=1, mtime=0))
    segment_path.unlink()
    try:
        segment_path.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"symlink creation unavailable: {exc}")

    with pytest.raises(ReplayArchiveError, match="symlink"):
        ReplayArchive(run_dir, "run-test")


def test_archive_recovery_rejects_closing_symlink_escape(tmp_path: Path) -> None:
    run_dir = tmp_path / "run-test"
    run_dir.mkdir()
    outside = tmp_path / "outside.jsonl"
    outside.write_bytes(_event_line("outside"))
    closing = run_dir / "events.000001.jsonl.closing"
    try:
        closing.symlink_to(outside)
    except OSError as exc:
        pytest.skip(f"symlink creation unavailable: {exc}")

    with pytest.raises(ReplayArchiveError, match="symlink"):
        ReplayArchive(run_dir, "run-test")


def test_default_rotation_budget_is_two_mib_and_measured(tmp_path: Path) -> None:
    assert DEFAULT_MAX_SEGMENT_BYTES == 2 * 1024 * 1024
    rotation_budget = getattr(replay_archive_module, "ROTATION_STALL_BUDGET_SECONDS", None)
    assert rotation_budget == 0.010
    archive = ReplayArchive(tmp_path / "run-test", "run-test")
    payload = _event_line("x" * DEFAULT_MAX_SEGMENT_BYTES)

    archive.append_event_line(payload)

    assert archive.last_rotation_seconds is not None
    assert archive.last_rotation_seconds >= 0.0
