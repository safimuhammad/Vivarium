"""Whole-world senses remain physical, fresh and scoped to the current map."""

import asyncio
from typing import Any

import pytest

from agents.decider import Decision, SerializingDecider
from agents.runtime import Agent
from agents.spatial_perception import SpatialAwareness, spatial_agent_visible
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from tests.conftest import FakeClock, MockDecider
from tests.world.spatial_test import _navigation_config
from tools.builtin import register_builtins
from tools.registry import ToolRegistry
from world.regions import Region
from world.spatial import SpatialWorld
from world.world import WorldState

REGIONS = ("nirvana", "warm_springs", "nirvana_east", "nirvana_west")


def _attach_maps(world: WorldState) -> dict[str, SpatialWorld]:
    maps = {}
    for index, name in enumerate(REGIONS):
        world.add_region(
            Region(name, f"Land {name}", list(REGIONS), 1, 1, 20 + index, 10, 100, 100)
        )
        config = _navigation_config()
        config.update(region_id=name, map_id=f"{name}:test-layout")
        maps[name] = SpatialWorld.from_mapping(config)
        world.attach_spatial(maps[name])
    return maps


def _place(world: WorldState, maps: dict[str, SpatialWorld], agent_id: str, region: str) -> None:
    """Set up a known physical observation without invoking movement tools."""
    for spatial in maps.values():
        if spatial.has_agent(agent_id):
            spatial.leave_region(agent_id, world.now(), reason="test_setup")
    state = world.get_agent(agent_id)
    assert state is not None
    state.current_position = region
    maps[region].spawn(agent_id, now=world.now())


@pytest.mark.parametrize("region", REGIONS)
def test_every_region_has_own_senses_and_offered_walking_tools(
    world: WorldState, region: str
) -> None:
    maps = _attach_maps(world)
    first, second = world.get_all_agents()[:2]
    _place(world, maps, first.id, region)
    _place(world, maps, second.id, REGIONS[(REGIONS.index(region) + 1) % 4])
    view = SpatialAwareness(world, first.id).render(world.now())
    assert f"in {region}." in view
    assert "Quiet Spring" in view
    assert second.name not in view
    assert not spatial_agent_visible(world, first.id, second.id, world.now())
    registry = ToolRegistry(world, EventBus(world))
    register_builtins(registry)
    runtime = Agent(first.id, world, registry.event_bus, registry, decider=MockDecider([]))
    assert {"go_to", "stop_moving"} <= set(runtime._offered_tool_names())
    assert "Walking in Nirvana" not in runtime._system_prompt()


def test_supply_changes_do_not_compare_different_regions(world: WorldState) -> None:
    maps = _attach_maps(world)
    state = world.get_all_agents()[0]
    _place(world, maps, state.id, "nirvana")
    awareness = SpatialAwareness(world, state.id)
    assert "shared regional supply 20/100" in awareness.render(world.now())
    awareness.commit()
    _place(world, maps, state.id, "warm_springs")
    after = awareness.render(world.now())
    assert "shared regional supply 21/100" in after
    assert "Changed since last seen" not in after
    assert "entered warm_springs" in after
    awareness.commit()
    world.regions["warm_springs"].current_energy = 17
    assert "Changed since last seen" in awareness.render(world.now())


async def test_queue_refresh_switches_map_and_observations(
    world: WorldState, fake_clock: FakeClock
) -> None:
    maps = _attach_maps(world)
    state = world.get_all_agents()[0]
    _place(world, maps, state.id, "nirvana")
    bus = EventBus(world)
    registry = ToolRegistry(world, bus)
    register_builtins(registry)
    observed: list[list[dict[str, Any]]] = []

    class Probe:
        async def decide(
            self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
        ) -> Decision:
            observed.append(messages)
            assert {"go_to", "stop_moving"} <= {tool["function"]["name"] for tool in tools}
            return Decision(text="I have arrived.")

    lock = asyncio.Lock()
    await lock.acquire()
    runtime = Agent(state.id, world, bus, registry, decider=SerializingDecider(Probe(), lock))
    await runtime.perceive()
    task = asyncio.create_task(runtime.decide())
    await asyncio.sleep(0)
    _place(world, maps, state.id, "nirvana_east")
    fake_clock.advance(3)
    lock.release()
    await task
    assert "in nirvana_east." in observed[0][-1]["content"]
    assert "in nirvana." not in observed[0][-1]["content"]
    assert "Walking in Nirvana" not in observed[0][0]["content"]


async def test_departure_is_heard_at_origin_gate_after_sender_changes_map(
    world: WorldState,
) -> None:
    maps = _attach_maps(world)
    first, second = world.get_all_agents()[:2]
    _place(world, maps, first.id, "nirvana_east")
    _place(world, maps, second.id, "warm_springs")
    bus = EventBus(world)
    bus.subscribe(second.id)
    await bus.publish(
        Event(
            type="agent_left_region",
            source=first.id,
            region="warm_springs",
            scope=ScopeType.LOCAL,
            timestamp=world.now(),
            payload={
                "agent_id": first.id,
                "from_region": "warm_springs",
                "to_region": "nirvana_east",
                "authoritative_spatial": True,
                "source_position": {"x": 16, "y": 48},
            },
        )
    )
    delivered = bus.get_events(second.id)
    assert len(delivered) == 1
    assert delivered[0].payload["spatial"] is None
    await bus.publish(
        Event(
            type="speak",
            source=first.id,
            region="warm_springs",
            scope=ScopeType.LOCAL,
            timestamp=world.now(),
            payload={"message": "From another map"},
        )
    )
    assert bus.get_events(second.id) == []
