"""Tests for :mod:`tools.builtin.movement` -- ``move`` and ``look_around``.

``move`` relocates an agent along a region edge and emits a ``agent_left_region``
event (to the origin) and an ``agent_entered_region`` event (to the destination).
It charges **no** energy -- a deliberately preserved divergence from the design
doc's ``MOVE_ENERGY_COST`` (flagged, not fixed). ``look_around`` is a read-only
dashboard that emits no event.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from tools.builtin.movement import look_around, move
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState


async def test_move_relocates_agent_and_emits_both_region_events(
    world: WorldState, event_bus: EventBus
) -> None:
    """A valid move updates position and emits left+entered region events."""
    result = await move(world, event_bus, "wanderer_001", destination="beta")

    mover = world.get_agent("wanderer_001")
    assert mover is not None
    assert mover.current_position == "beta"
    assert mover.current_energy == 100.0  # DIVERGENCE preserved: move charges no energy

    # After the move, the origin (alpha) holds wanderer_002; beta holds the mover.
    left_inbox = event_bus.get_events("wanderer_002")  # still in alpha
    enter_inbox = event_bus.get_events("wanderer_001")  # now in beta
    assert len(left_inbox) == 1 and left_inbox[0].type == "agent_left_region"
    assert left_inbox[0].region == "alpha"
    assert left_inbox[0].scope is ScopeType.LOCAL
    assert left_inbox[0].timestamp == world.now()
    assert len(enter_inbox) == 1 and enter_inbox[0].type == "agent_entered_region"
    assert enter_inbox[0].region == "beta"

    assert result == "Agent Moved from alpha to beta Successfully"


async def test_move_to_unknown_destination_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """Moving to a region that does not exist is an ``Error:`` with no effect."""
    result = await move(world, event_bus, "wanderer_001", destination="nowhere")
    mover = world.get_agent("wanderer_001")
    assert mover is not None and mover.current_position == "alpha"
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_move_to_non_adjacent_region_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """Moving to an existing-but-unconnected region is a rule violation."""
    world.add_region(
        Region(
            name="gamma",
            description="An island.",
            connections=[],
            energy_rate=1.0,
            materials_rate=1.0,
            current_energy=10.0,
            current_materials=10.0,
            max_energy=100.0,
            max_materials=100.0,
        )
    )
    result = await move(world, event_bus, "wanderer_001", destination="gamma")

    mover = world.get_agent("wanderer_001")
    assert mover is not None and mover.current_position == "alpha"  # did not move
    assert result.startswith("Invalid:")
    assert "gamma" in result
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_look_around_returns_dashboard_without_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """``look_around`` returns a status dashboard and publishes nothing."""
    result = await look_around(world, event_bus, "wanderer_001")
    assert "alpha" in result
    assert "Boris" in result  # the other agent present in the region
    assert "Energy" in result
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_look_around_missing_agent_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An unknown observer yields an ``Error:`` string."""
    result = await look_around(world, event_bus, "ghost")
    assert result.startswith("Error:")


async def test_look_around_in_unknown_region_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An agent positioned in a non-existent region cannot look around."""
    world.add_agent(
        AgentState(
            id="lost",
            name="Lost",
            persona="adrift",
            current_position="void",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        )
    )
    result = await look_around(world, event_bus, "lost")
    assert result.startswith("Error:")
