"""Tests for durable world-snapshot checkpoint JSONL artifacts."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from bus.events import Event, ScopeType
from observability.checkpoints import JsonlSnapshotCheckpointLog, SnapshotCheckpointEventLog
from observability.event_log import CompositeEventLog, FeedEventLog
from observability.replay_archive import ReplayArchive
from observability.run_context import RunContext, build_run_context
from tests.conftest import FakeClock
from world.world import WorldState


def _run_context(tmp_path: Path) -> RunContext:
    config_path = tmp_path / "world.yaml"
    config_path.write_text("regions: []\nagents: []\n", encoding="utf-8")
    return build_run_context(
        config_path=config_path,
        seed=5,
        model="mock",
        provider="ollama",
        memory_root=tmp_path / "mem",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=lambda: 123.0,
    )


def _event(kind: str) -> Event:
    return Event(
        kind,
        "wanderer_001",
        {"message": kind},
        scope=ScopeType.LOCAL,
        region="alpha",
        timestamp=456.0,
    )


def test_checkpoint_writer_appends_strict_json_snapshot_lines(
    world: WorldState,
    fake_clock: FakeClock,
    tmp_path: Path,
) -> None:
    context = _run_context(tmp_path)
    log = JsonlSnapshotCheckpointLog(context.snapshot_log_path)

    record = log.write_snapshot(world, context, event_cursor=3, reason="manual")
    fake_clock.advance(1.0)
    second = log.write_snapshot(world, context, event_cursor=4, reason="world_tick")

    assert record["schema"] == 1
    assert record["type"] == "world_snapshot_checkpoint"
    assert record["reason"] == "manual"
    assert record["run_id"] == context.run_id
    assert record["world_time"] == 1_000_000.0
    assert record["event_cursor"] == 3
    snapshot = record["snapshot"]
    assert isinstance(snapshot, dict)
    assert snapshot["schema"] == 1
    assert snapshot["run_id"] == context.run_id
    assert snapshot["world_time"] == record["world_time"]
    assert snapshot["event_cursor"] == record["event_cursor"]

    lines = context.snapshot_log_path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    parsed = [json.loads(line) for line in lines]
    assert parsed[0] == record
    assert parsed[1] == second
    json.dumps(parsed, allow_nan=False)


def test_checkpoint_writer_rejects_non_finite_snapshot_values(
    world: WorldState,
    tmp_path: Path,
) -> None:
    context = _run_context(tmp_path)
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    agent.current_energy = float("nan")

    log = JsonlSnapshotCheckpointLog(context.snapshot_log_path)
    with pytest.raises(ValueError):
        log.write_snapshot(world, context, event_cursor=1, reason="manual")
    assert not context.snapshot_log_path.exists()


def test_structural_event_sink_uses_current_feed_cursor(
    world: WorldState,
    tmp_path: Path,
) -> None:
    context = _run_context(tmp_path)
    checkpoint_log = JsonlSnapshotCheckpointLog(context.snapshot_log_path)
    feed = FeedEventLog()
    structural = SnapshotCheckpointEventLog(
        checkpoint_log,
        world=world,
        run_context=context,
        event_cursor=lambda: feed.current_cursor,
    )
    composite = CompositeEventLog(feed, structural)

    composite.record(_event("speak"))
    assert not context.snapshot_log_path.exists()

    composite.record(_event("home_built"))
    records = [
        json.loads(line)
        for line in context.snapshot_log_path.read_text(encoding="utf-8").splitlines()
    ]
    assert len(records) == 1
    assert records[0]["reason"] == "event:home_built"
    assert records[0]["event_cursor"] == 2
    assert records[0]["snapshot"]["event_cursor"] == 2


def test_checkpoint_writer_delegates_exact_line_to_replay_archive(
    world: WorldState,
    tmp_path: Path,
) -> None:
    context = _run_context(tmp_path)
    archive = ReplayArchive(context.run_dir, context.run_id, max_segment_bytes=1)
    log = JsonlSnapshotCheckpointLog(context.snapshot_log_path, archive=archive)

    record = log.write_snapshot(world, context, event_cursor=7, reason="manual")

    archived = list(archive.iter_lines("checkpoints"))
    assert len(archived) == 1
    assert archived[0][0] == 1
    assert json.loads(archived[0][1]) == record
