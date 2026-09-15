"""Spatial movement and resource-site tool coverage."""

from __future__ import annotations

from bus.event_bus import EventBus
from core.constants import HOME_BUILD_MATERIALS_COST
from tests.conftest import FakeClock
from tools.builtin import BUILTIN_TOOLS, SPATIAL_BUILTIN_TOOLS, register_builtins
from tools.builtin.homes import build_home
from tools.builtin.movement import go_to, look_around, stop_moving
from tools.builtin.resources import harvest_resources
from tools.registry import ToolRegistry
from world.agents import AgentState, AgentStatus
from world.regions import Region, ResourceTypes
from world.spatial import SpatialWorld
from world.world import WorldState


def _spatial() -> SpatialWorld:
    """Return a one-lane map with a distinct energy destination."""
    return SpatialWorld.from_mapping(
        {
            "version": 1,
            "region_id": "nirvana",
            "map_id": "nirvana:tool-test",
            "layout_fingerprint": "tool-test",
            "tile_size": 32,
            "width": 3,
            "height": 1,
            "walkable": [[1, 1, 1]],
            "landmarks": [
                {
                    "id": "energy-1",
                    "name": "Energy grove",
                    "x": 80,
                    "y": 16,
                    "affordances": ["energy"],
                }
            ],
            "spawn_points": [{"x": 16, "y": 16}],
            "initial_pressure": {"populationHighWater": 1, "builtFootprintHighWater": 0},
        }
    )


def _world_and_bus(clock: FakeClock) -> tuple[WorldState, EventBus]:
    """Return a spatial world and a subscribed actor inbox."""
    region = Region("nirvana", "A shared valley.", [], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0)
    agent = AgentState("founder_001", "Founder", "", "nirvana", 100.0, 50.0, AgentStatus.ALIVE)
    world = WorldState([region], [agent], clock=clock, spatial=_spatial())
    bus = EventBus(world)
    assert bus.subscribe(agent.id)
    return world, bus


def test_spatial_registry_adds_only_the_nirvana_navigation_tools() -> None:
    """A map-backed registry offers the pilot actions beside the frozen legacy catalog."""
    world, bus = _world_and_bus(FakeClock(start=10.0))
    registry = ToolRegistry(world, bus)

    register_builtins(registry)

    assert set(BUILTIN_TOOLS) <= set(registry.list_tools())
    assert set(SPATIAL_BUILTIN_TOOLS) <= set(registry.list_tools())


async def test_go_to_starts_a_persistent_spatial_journey_and_records_the_route() -> None:
    """A valid named site starts one timed journey and emits its durable route state."""
    clock = FakeClock(start=10.0)
    world, bus = _world_and_bus(clock)

    result = await go_to(world, bus, "founder_001", destination_id="energy-1")

    assert result.startswith("Started travelling to Energy grove")
    events = bus.get_events("founder_001")
    assert len(events) == 1
    event = events[0]
    assert event.type == "spatial_travel_started"
    assert event.region == "nirvana"
    assert event.timestamp == 10.0
    assert event.payload["agent_id"] == "founder_001"
    assert event.payload["map_id"] == "nirvana:tool-test"
    assert event.payload["travel_id"] == "nirvana:founder_001:travel:1"
    assert event.payload["destination_id"] == "energy-1"
    assert event.payload["route"] == [
        {"x": 16.0, "y": 16.0},
        {"x": 48.0, "y": 16.0},
        {"x": 80.0, "y": 16.0},
    ]
    assert event.payload["started_at"] == 10.0
    assert event.payload["arrives_at"] == 12.0
    assert event.payload["spatial"]["travel"]["id"] == "nirvana:founder_001:travel:1"


async def test_go_to_stop_and_gather_preserve_spatial_state() -> None:
    """Tool commands preserve timed travel state and permit gathering only after arrival."""
    clock = FakeClock(start=10.0)
    world, bus = _world_and_bus(clock)

    assert (
        await harvest_resources(world, bus, "founder_001", ResourceTypes.ENERGY, amount=5.0)
    ).startswith("Invalid: You can gather energy only after arriving")
    assert (await go_to(world, bus, "founder_001", "energy-1")).startswith("Started")
    bus.get_events("founder_001")
    repeated = await go_to(world, bus, "founder_001", "energy-1")
    assert repeated == "Already travelling to Energy grove."
    assert bus.get_events("founder_001") == []

    clock.advance(0.5)
    stopped_message = await stop_moving(world, bus, "founder_001")
    assert stopped_message == "Came to rest at your current position."
    stopped = bus.get_events("founder_001")
    assert len(stopped) == 1
    assert stopped[0].type == "spatial_travel_cancelled"
    assert stopped[0].payload["reason"] == "stopped"
    assert stopped[0].payload["position"] == {"x": 32.0, "y": 16.0}
    assert stopped[0].payload["spatial"]["travel"] is None

    assert (await go_to(world, bus, "founder_001", "energy-1")).startswith("Started")
    bus.get_events("founder_001")
    clock.advance(1.5)
    assert world.spatial is not None
    assert [event.kind for event in world.spatial.tick(clock())] == ["travel_arrived"]
    result = await harvest_resources(world, bus, "founder_001", ResourceTypes.ENERGY, amount=5.0)
    assert result.startswith("Successfully harvested")
    changed = bus.get_events("founder_001")
    resource_event = next(event for event in changed if event.type == "resource_changed")
    assert resource_event.payload["site_id"] == "energy-1"


async def test_look_around_uses_the_same_spatial_senses_as_a_fresh_decision() -> None:
    """The explicit perception tool does not fall back to region-wide omniscience in Nirvana."""
    clock = FakeClock(start=10.0)
    world, bus = _world_and_bus(clock)

    rendered = await look_around(world, bus, "founder_001")

    assert rendered.startswith("Observed now")
    assert "Known destinations" in rendered
    assert bus.get_events("founder_001") == []


async def test_build_home_rejects_an_exhausted_or_occupied_spatial_plot_before_charge() -> None:
    """A home cannot consume materials when production geometry has no legal placement."""
    clock = FakeClock(start=10.0)
    spatial = SpatialWorld.from_mapping(
        {
            "version": 1,
            "region_id": "nirvana",
            "map_id": "nirvana:tool-test",
            "layout_fingerprint": "tool-test",
            "tile_size": 32,
            "width": 3,
            "height": 1,
            "walkable": [[1, 1, 1]],
            "landmarks": [],
            "spawn_points": [{"x": 16, "y": 16}],
            "initial_pressure": {"populationHighWater": 1, "builtFootprintHighWater": 0},
            "home_plots": [
                {
                    "id": "blocked-by-founder",
                    "x": 0,
                    "y": 0,
                    "door": {"x": 48, "y": 16},
                    "hard_rects": [{"x": 0, "y": 0, "width": 32, "height": 32}],
                }
            ],
        }
    )
    region = Region("nirvana", "A shared valley.", [], 1.0, 1.0, 100.0, 100.0, 500.0, 500.0)
    agent = AgentState("founder_001", "Founder", "", "nirvana", 100.0, 50.0, AgentStatus.ALIVE)
    world = WorldState([region], [agent], clock=clock, spatial=spatial)
    bus = EventBus(world)
    assert bus.subscribe(agent.id)
    agent.current_materials = HOME_BUILD_MATERIALS_COST + 1.0

    result = await build_home(world, bus, "founder_001")

    assert result.startswith("Invalid: No legal shelter plot")
    assert agent.current_materials == HOME_BUILD_MATERIALS_COST + 1.0
    assert world.get_all_homes() == []
    assert bus.get_events("founder_001") == []
