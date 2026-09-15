"""Spatial fields in authoritative live and replayable world snapshots."""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

from bus.events import Event, ScopeType
from observability.checkpoints import JsonlSnapshotCheckpointLog, SnapshotCheckpointEventLog
from observability.run_context import build_run_context
from observability.snapshot import serialize_world_snapshot
from tests.conftest import FakeClock
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.spatial import SpatialWorld
from world.world import WorldState


def _region(name: str = "nirvana") -> Region:
    """Return a tiny region for spatial snapshot coverage."""
    return Region(name, "A shared valley.", [], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0)


def _agent(position: str = "nirvana") -> AgentState:
    """Return one alive being in ``position``."""
    return AgentState("founder_001", "Founder", "", position, 100.0, 50.0, AgentStatus.ALIVE)


def _spatial() -> SpatialWorld:
    """Return a two-tile exported map with an energy landmark."""
    return SpatialWorld.from_mapping(
        {
            "version": 1,
            "region_id": "nirvana",
            "map_id": "nirvana:snapshot-test",
            "layout_fingerprint": "snapshot-test",
            "tile_size": 32,
            "width": 3,
            "height": 1,
            "walkable": [[1, 1, 1]],
            "landmarks": [
                {
                    "id": "energy-1",
                    "name": "Energy grove",
                    "x": 48,
                    "y": 16,
                    "affordances": ["energy"],
                }
            ],
            "spawn_points": [{"x": 16, "y": 16}],
            "initial_pressure": {"populationHighWater": 1, "builtFootprintHighWater": 0},
            "home_plots": [
                {
                    "id": "shelter-one",
                    "x": 64,
                    "y": 0,
                    "door": {"x": 80, "y": 16},
                    "hard_rects": [{"x": 64, "y": 0, "width": 32, "height": 32}],
                }
            ],
        }
    )


def _records(snapshot: dict[str, object], key: str) -> list[dict[str, object]]:
    """Return one typed snapshot collection after its JSON-shape assertion."""
    value = snapshot[key]
    assert isinstance(value, list)
    return [cast(dict[str, object], item) for item in value]


def test_snapshot_includes_live_spatial_position_travel_and_region_map_metadata() -> None:
    """Reconnect/replay state retains the concrete map and uninterrupted journey."""
    clock = FakeClock(start=10.0)
    spatial = _spatial()
    world = WorldState([_region()], [_agent()], clock=clock, spatial=spatial)
    travel = spatial.begin_travel("founder_001", "energy-1", clock(), speed=32.0).travel
    assert travel is not None

    snapshot = serialize_world_snapshot(world, run_id="run-spatial", event_cursor=3)
    agent = _records(snapshot, "agents")[0]
    region = _records(snapshot, "regions")[0]

    assert agent["spatial"] == {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:snapshot-test",
        "layout_fingerprint": "snapshot-test",
        "x": 16.0,
        "y": 16.0,
        "observed_at": 10.0,
        "at_landmark": None,
        "travel": {
            "id": "nirvana:founder_001:travel:1",
            "destination_id": "energy-1",
            "route": [{"x": 16.0, "y": 16.0}, {"x": 48.0, "y": 16.0}],
            "started_at": 10.0,
            "arrives_at": 11.0,
        },
    }
    assert region["spatial"] == {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:snapshot-test",
        "layout_fingerprint": "snapshot-test",
        "tile_size": 32,
        "columns": 3,
        "rows": 1,
        "topology": "bounded",
        "initial_pressure": {"populationHighWater": 1, "builtFootprintHighWater": 0},
        "landmarks": [
            {
                "id": "energy-1",
                "name": "Energy grove",
                "x": 48.0,
                "y": 16.0,
                "affordances": ["energy"],
            }
        ],
    }


def test_snapshot_keeps_legacy_agents_and_regions_byte_shape_unchanged() -> None:
    """A world without a spatial map never gains null or placeholder spatial fields."""
    clock = FakeClock(start=10.0)
    world = WorldState([_region("alpha")], [_agent("alpha")], clock=clock)

    snapshot = serialize_world_snapshot(world, run_id="run-legacy", event_cursor=0)

    assert "spatial" not in _records(snapshot, "agents")[0]
    assert "spatial" not in _records(snapshot, "regions")[0]


def test_spatial_travel_transitions_write_reconnectable_checkpoint_snapshots(
    tmp_path: Path,
) -> None:
    """Travel starts, stops, and arrivals are structural replay boundaries."""
    clock = FakeClock(start=10.0)
    world = WorldState([_region()], [_agent()], clock=clock, spatial=_spatial())
    config_path = tmp_path / "world.yaml"
    config_path.write_text("regions: []\nagents: []\n", encoding="utf-8")
    context = build_run_context(
        config_path=config_path,
        seed=1,
        model="mock",
        provider="mlx",
        memory_root=tmp_path / "memory",
        run_dir=tmp_path / "runs",
        context_window=None,
        clock=clock,
    )
    log = JsonlSnapshotCheckpointLog(context.snapshot_log_path)
    sink = SnapshotCheckpointEventLog(
        log,
        world=world,
        run_context=context,
        event_cursor=lambda: 3,
    )

    sink.record(
        Event(
            "spatial_travel_started",
            "founder_001",
            {"message": "Founder begins walking."},
            scope=ScopeType.LOCAL,
            region="nirvana",
            timestamp=clock(),
        )
    )

    record = json.loads(context.snapshot_log_path.read_text(encoding="utf-8"))
    assert record["reason"] == "event:spatial_travel_started"
    assert record["snapshot"]["regions"][0]["spatial"]["map_id"] == "nirvana:snapshot-test"


def test_snapshot_assigns_one_production_plot_to_a_home_and_keeps_it_for_its_ruin() -> None:
    """Home snapshots align renderer placement with the same runtime obstacle assignment."""
    clock = FakeClock(start=10.0)
    world = WorldState([_region()], [_agent()], clock=clock, spatial=_spatial())

    assert world.build_home(
        "home-founder", "founder_001", "nirvana", built_at=10.0, integrity=100.0
    )
    standing = serialize_world_snapshot(world, run_id="run-spatial", event_cursor=0)
    home = _records(standing, "homes")[0]
    assert home["spatial"] == {
        "version": 1,
        "region_id": "nirvana",
        "map_id": "nirvana:snapshot-test",
        "plot_id": "shelter-one",
        "x": 64.0,
        "y": 0.0,
        "door": {"x": 80.0, "y": 16.0},
    }

    assert world.make_ruin("home-founder")
    ruined = serialize_world_snapshot(world, run_id="run-spatial", event_cursor=0)
    assert _records(ruined, "ruins")[0]["spatial"] == home["spatial"]
