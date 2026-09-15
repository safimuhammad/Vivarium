"""Startup and navigator integration for every physical region."""

from bus.event_bus import EventBus
from core.constants import MOVE_ENERGY_COST
from observability.checkpoints import DEFAULT_SNAPSHOT_CHECKPOINT_EVENT_TYPES
from observability.event_log import InMemoryEventLog
from observability.snapshot import serialize_world_snapshot
from scripts.run import (
    _advance_spatial_navigator,
    _finalize_spatial_navigation,
    _spatial_export_input,
)
from tests.conftest import FakeClock
from tests.world.regional_spatial_test import _map, _regions
from world.agents import AgentState, AgentStatus
from world.world import WorldState


def _world() -> tuple[WorldState, FakeClock]:
    clock = FakeClock(100)
    world = WorldState(
        _regions(),
        [
            AgentState("a", "A", "", "alpha", 100, 40, AgentStatus.ALIVE),
            AgentState("b", "B", "", "beta", 100, 40, AgentStatus.ALIVE),
        ],
        clock=clock,
    )
    world.attach_spatial(_map("alpha", "beta"))
    world.attach_spatial(_map("beta", "alpha"))
    return world, clock


def test_export_input_and_snapshots_include_every_region_without_nirvana() -> None:
    world, _ = _world()
    data = _spatial_export_input(world, seed=7)
    assert data is not None
    pressures = data["initial_pressures"]
    assert isinstance(pressures, dict)
    assert set(pressures) == {"alpha", "beta"}
    snapshot = serialize_world_snapshot(world, run_id="all-regions", event_cursor=0)
    for records in (snapshot["regions"], snapshot["agents"]):
        assert isinstance(records, list)
        assert {record["spatial"]["region_id"] for record in records} == {"alpha", "beta"}


async def test_navigator_publishes_exact_gate_handoff_and_current_region_snapshot() -> None:
    world, clock = _world()
    log = InMemoryEventLog()
    bus = EventBus(world, event_log=log)
    world.begin_region_travel("b", "alpha", move_energy_cost=MOVE_ENERGY_COST)
    clock.advance(1)
    await _advance_spatial_navigator(world, bus)
    agent = world.get_agent("b")
    assert agent is not None and agent.current_position == "alpha"
    assert [event.type for event in log.events] == [
        "spatial_travel_arrived",
        "agent_left_region",
        "agent_entered_region",
    ]
    left, entered = log.events[-2:]
    assert left.payload["authoritative_spatial"] is True
    assert left.payload["source_position"] == {"x": 80, "y": 16}
    assert left.payload["spatial"] is None
    assert entered.payload["spatial"]["region_id"] == "alpha"
    assert entered.payload["spatial"]["x"] == 16
    assert entered.payload["spatial"]["travel"] is None
    assert "agent_entered_region" in DEFAULT_SNAPSHOT_CHECKPOINT_EVENT_TYPES
    await _advance_spatial_navigator(world, bus)
    assert len(log.events) == 3


async def test_shutdown_freezes_journeys_in_all_maps_before_handoff() -> None:
    world, clock = _world()
    bus = EventBus(world)
    world.begin_region_travel("a", "beta", move_energy_cost=MOVE_ENERGY_COST)
    world.begin_region_travel("b", "alpha", move_energy_cost=MOVE_ENERGY_COST)
    clock.advance(0.5)
    await _finalize_spatial_navigation(world, bus, now=clock())
    clock.advance(10)
    await _advance_spatial_navigator(world, bus)
    for agent_id, region in [("a", "alpha"), ("b", "beta")]:
        agent = world.get_agent(agent_id)
        assert agent is not None and agent.current_position == region
        spatial = world.spatial_for_agent(agent_id)
        assert spatial is not None
        sample = spatial.position_at(agent_id, clock())
        assert sample["travel"] is None and sample["x"] == 64
