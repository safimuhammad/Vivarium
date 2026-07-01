"""Tests for :mod:`tools.builtin.movement` -- ``move`` and ``look_around``.

``move`` relocates an agent along a region edge and emits a ``agent_left_region``
event (to the origin) and an ``agent_entered_region`` event (to the destination).
It charges :data:`~core.constants.MOVE_ENERGY_COST` energy on a successful move,
validating existence, adjacency and sufficient energy *before* mutating, and only
deducting once the relocation succeeds. ``look_around`` is a read-only dashboard
that emits no event; it additionally shows a being its own co-located home's vault
balance (L2b) when the being holds a stake in a home standing in its current region.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import HOME_MAX_INTEGRITY, MOVE_ENERGY_COST
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
    assert mover.current_energy == 100.0 - MOVE_ENERGY_COST  # charged on success

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
    assert mover.current_energy == 100.0  # not charged on an Error
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
    assert mover.current_energy == 100.0  # not charged on a failed move
    assert result.startswith("Invalid:")
    assert "gamma" in result
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_move_with_insufficient_energy_is_invalid_and_uncharged(
    world: WorldState, event_bus: EventBus
) -> None:
    """Too little energy to pay the move cost is a rule violation with no effect."""
    # Drop wanderer_001 below the move cost (5.0): 100 - 97 = 3.0.
    world.modify_agent_energy("wanderer_001", -97.0)

    result = await move(world, event_bus, "wanderer_001", destination="beta")

    mover = world.get_agent("wanderer_001")
    assert mover is not None
    assert mover.current_position == "alpha"  # did not move
    assert mover.current_energy == 3.0  # not charged further
    assert result.startswith("Invalid:")
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


async def test_look_around_describes_neighbors_with_brief(
    world: WorldState, event_bus: EventBus
) -> None:
    """Neighbours are rendered with the shared brief -- id and energy/materials (Finding 6),
    matching the breathing-loop perception so the agent reads one consistent voice."""
    result = await look_around(world, event_bus, "wanderer_001")
    assert "Boris [id: wanderer_002] (energy 100.0, materials 50.0)" in result


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


async def test_look_around_shows_own_home_vault_when_co_located(
    world: WorldState, event_bus: EventBus
) -> None:
    """A stakeholder standing at its home sees its vault balance in look_around."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 120.0)

    result = await look_around(world, event_bus, "wanderer_001")

    assert "store" in result.lower()  # the home-store line is present
    assert "120.0" in result  # the vault balance is visible to the being


async def test_look_around_without_a_co_located_home_shows_no_vault_line(
    world: WorldState, event_bus: EventBus
) -> None:
    """A being that stakes no home in its region gets no home-store line."""
    result = await look_around(world, event_bus, "wanderer_002")
    assert "your home here" not in result.lower()


async def test_look_around_with_home_staked_in_a_different_region_shows_no_vault_line(
    world: WorldState, event_bus: EventBus
) -> None:
    """A stakeholder whose home stands in another region gets no vault line while away.

    Distinguishes "no vault line because no home at all" (the test above) from "no
    vault line because the staked home isn't HERE" -- both must suppress the line,
    but only the co-located case should ever show it.
    """
    world.build_home(
        "home_boris", "wanderer_002", "beta", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_boris", 40.0)

    result = await look_around(world, event_bus, "wanderer_002")  # wanderer_002 is in alpha

    assert "your home here" not in result.lower()
