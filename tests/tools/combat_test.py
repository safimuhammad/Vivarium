"""Tests for :mod:`tools.builtin.combat` -- the ``attack`` tool.

Each test asserts the three observable effects of a tool call: the world-state
delta, the :class:`~bus.events.Event` published to the bus, and the returned
natural-language result string. Failure paths assert *no* state delta and *no*
event, plus the standardized result-string prefix (``"Error: "`` for
lookup/precondition failures, ``"Invalid: "`` for rule violations).

The tools are exercised directly (not through the registry) so each tool's own
missing-agent string is reachable. Worlds are built from the locked
``conftest`` fixtures (seeded RNG + frozen clock).
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import ATTACK_DAMAGE, ATTACK_ENERGY_COST
from tools.builtin.combat import attack
from world.world import WorldState


async def test_attack_success_applies_costs_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """A valid attack drains attacker energy + target energy and emits a LOCAL event."""
    result = await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    attacker = world.get_agent("wanderer_001")
    target = world.get_agent("wanderer_002")
    assert attacker is not None and target is not None
    assert attacker.current_energy == 100.0 - ATTACK_ENERGY_COST  # 90.0
    assert target.current_energy == 100.0 - ATTACK_DAMAGE  # 70.0

    # LOCAL event (no region) -> source region alpha -> both subscribers hear it.
    target_inbox = event_bus.get_events("wanderer_002")
    assert len(target_inbox) == 1
    event = target_inbox[0]
    assert event.type == "attack"
    assert event.source == "wanderer_001"
    assert event.scope is ScopeType.LOCAL
    assert event.target == "wanderer_002"
    assert event.timestamp == world.now()
    assert "message" in event.payload
    # The attacker, also in alpha, hears the same LOCAL event.
    assert len(event_bus.get_events("wanderer_001")) == 1

    assert result.startswith("Successfully Attacked")
    assert "wanderer_002" in result


async def test_attack_missing_target_returns_error_no_effect(
    world: WorldState, event_bus: EventBus
) -> None:
    """Attacking a non-existent target yields an ``Error:`` string and no changes."""
    result = await attack(world, event_bus, "wanderer_001", target="ghost")

    attacker = world.get_agent("wanderer_001")
    assert attacker is not None and attacker.current_energy == 100.0
    assert result == "Error: Can't find Agent in the world."
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_attack_missing_attacker_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """An unknown attacker also yields the lookup ``Error:`` string."""
    result = await attack(world, event_bus, "ghost", target="wanderer_002")
    assert result == "Error: Can't find Agent in the world."
    target = world.get_agent("wanderer_002")
    assert target is not None and target.current_energy == 100.0


async def test_attack_across_regions_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """Attacking a target in another region is a rule violation (``Invalid:``)."""
    assert world.move_agent("wanderer_002", "beta") is True

    result = await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    attacker = world.get_agent("wanderer_001")
    target = world.get_agent("wanderer_002")
    assert attacker is not None and attacker.current_energy == 100.0  # untouched
    assert target is not None and target.current_energy == 100.0  # untouched
    assert result.startswith("Invalid:")
    assert "alpha" in result
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_attack_with_insufficient_energy_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """Too little energy to pay the attack cost is a rule violation, no effect."""
    world.modify_agent_energy("wanderer_001", -95.0)  # 100 -> 5, below ATTACK_ENERGY_COST

    result = await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    attacker = world.get_agent("wanderer_001")
    target = world.get_agent("wanderer_002")
    assert attacker is not None and attacker.current_energy == 5.0  # unchanged by attack
    assert target is not None and target.current_energy == 100.0  # undamaged
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_002") == []
