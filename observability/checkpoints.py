"""Durable world-snapshot checkpoints for exact replay recovery."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Literal

from bus.events import Event
from observability.replay_archive import ReplayArchive
from observability.run_context import RunContext
from observability.snapshot import serialize_snapshot_for_run
from world.world import WorldState

type SnapshotCheckpointReason = Literal["world_tick", "manual"] | str

DEFAULT_SNAPSHOT_CHECKPOINT_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "simulation_started",
        "agent_born",
        "agent_died",
        "agent_decayed",
        "agent_paralyzed",
        "agent_recovered",
        "mating_initiated",
        "mating_rejected",
        "mating_proposal_invalidated",
        "mating_proposal_timeout",
        "home_built",
        "home_joined",
        "home_left",
        "home_started_hoarding",
        "home_collapsed",
        "home_breached",
        "home_thieved",
        "home_colonized",
        "ruins_scavenged",
        # Spatial travel changes are durable boundaries: reconnecting observers and
        # replay readers need the exact route or stopped coordinate immediately,
        # not only at the next five-second ecology heartbeat.
        "spatial_travel_started",
        "spatial_travel_cancelled",
        "spatial_travel_arrived",
        "agent_entered_region",
    }
)


class JsonlSnapshotCheckpointLog:
    """Append strict JSON world snapshots to a run's ``snapshots.jsonl`` stream."""

    def __init__(self, path: str | Path, *, archive: ReplayArchive | None = None) -> None:
        """Initialise the checkpoint writer and ensure its parent exists."""
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._archive = archive
        if archive is not None and self.path != archive.run_dir / "snapshots.jsonl":
            raise ValueError("checkpoint path must be the archive's snapshots.jsonl")

    def write_snapshot(
        self,
        world: WorldState,
        run_context: RunContext,
        *,
        event_cursor: int,
        reason: SnapshotCheckpointReason,
    ) -> dict[str, object]:
        """Append one checkpoint line and return the JSON-ready record."""
        snapshot = serialize_snapshot_for_run(
            world,
            run_context,
            event_cursor=event_cursor,
        )
        record: dict[str, object] = {
            "schema": 1,
            "type": "world_snapshot_checkpoint",
            "reason": reason,
            "run_id": run_context.run_id,
            "world_time": snapshot["world_time"],
            "event_cursor": snapshot["event_cursor"],
            "snapshot": snapshot,
        }
        line = json.dumps(record, allow_nan=False, sort_keys=True)
        if self._archive is not None:
            self._archive.append_checkpoint_line(f"{line}\n".encode())
        else:
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(f"{line}\n")
        return record


class SnapshotCheckpointEventLog:
    """Event-log sink that writes snapshots after structural events."""

    def __init__(
        self,
        checkpoint_log: JsonlSnapshotCheckpointLog,
        *,
        world: WorldState,
        run_context: RunContext,
        event_cursor: Callable[[], int],
        event_types: Iterable[str] = DEFAULT_SNAPSHOT_CHECKPOINT_EVENT_TYPES,
    ) -> None:
        """Initialise the structural-event checkpoint sink."""
        self._checkpoint_log = checkpoint_log
        self._world = world
        self._run_context = run_context
        self._event_cursor = event_cursor
        self._event_types = frozenset(event_types)

    def record(self, event: Event) -> None:
        """Write a checkpoint when ``event.type`` is configured as structural."""
        if event.type not in self._event_types:
            return
        self._checkpoint_log.write_snapshot(
            self._world,
            self._run_context,
            event_cursor=self._event_cursor(),
            reason=f"event:{event.type}",
        )
