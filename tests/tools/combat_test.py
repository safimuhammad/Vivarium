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
from world.agents import AgentStatus
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


async def test_attack_dead_target_is_invalid_no_effect(
    world: WorldState, event_bus: EventBus
) -> None:
    """Attacking a co-located corpse is a rule violation, with no cost and no event."""
    target = world.get_agent("wanderer_002")
    assert target is not None
    target.status = AgentStatus.DEAD

    result = await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    attacker = world.get_agent("wanderer_001")
    assert attacker is not None and attacker.current_energy == 100.0  # no cost paid
    assert target.current_energy == 100.0  # corpse undamaged
    assert result.startswith("Invalid:")
    assert "Boris" in result
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_attack_self_is_invalid_no_effect(world: WorldState, event_bus: EventBus) -> None:
    """Attacking oneself is a rule violation; the attacker takes no self-harm."""
    result = await attack(world, event_bus, "wanderer_001", target="wanderer_001")

    attacker = world.get_agent("wanderer_001")
    assert attacker is not None and attacker.current_energy == 100.0  # untouched
    assert result.startswith("Invalid:")
    assert event_bus.get_events("wanderer_001") == []


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


async def test_attack_kills_paralyzed_target(world: WorldState, event_bus: EventBus) -> None:
    """A finishing blow on an already-PARALYZED target kills it + emits ``agent_died`` GLOBAL."""
    world.modify_agent_energy("wanderer_002", -96.0)  # 100 -> 4.0 => PARALYZED
    paralyzed = world.get_agent("wanderer_002")
    assert paralyzed is not None and paralyzed.status is AgentStatus.PARALYZED

    await attack(world, event_bus, "wanderer_001", target="wanderer_002")

    slain = world.get_agent("wanderer_002")
    assert slain is not None and slain.status is AgentStatus.DEAD
    died = [e for e in event_bus.get_events("wanderer_001") if e.type == "agent_died"]
    assert died and died[0].scope is ScopeType.GLOBAL and died[0].source == "wanderer_002"


async def test_attack_overshoot_kills(world: WorldState, event_bus: EventBus) -> None:
    """A hit that overshoots below the kill threshold kills outright (20 - 30 < 0)."""
    world.modify_agent_energy("wanderer_002", -80.0)  # 100 -> 20.0; 20 - 30 < 0 => DEAD
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    slain = world.get_agent("wanderer_002")
    assert slain is not None and slain.status is AgentStatus.DEAD


async def test_attack_exact_zero_paralyzes_not_kills(
    world: WorldState, event_bus: EventBus
) -> None:
    """A hit landing exactly at 0.0 paralyses but does NOT kill (30 - 30 == 0.0, not < 0)."""
    world.modify_agent_energy("wanderer_002", -70.0)  # 100 -> 30.0; 30 - 30 == 0.0, NOT < 0
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    t = world.get_agent("wanderer_002")
    assert t is not None and t.status is AgentStatus.PARALYZED and t.current_energy == 0.0


async def test_attack_nonlethal_damages_only(world: WorldState, event_bus: EventBus) -> None:
    """A non-lethal hit on a healthy target only damages it (100 -> 70, still ALIVE)."""
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")  # 100 -> 70
    t = world.get_agent("wanderer_002")
    assert t is not None and t.status is AgentStatus.ALIVE


async def test_attack_paralyzing_blow_emits_agent_paralyzed(
    world: WorldState, event_bus: EventBus
) -> None:
    """A non-lethal blow that flips ALIVE -> PARALYZED announces the collapse.

    The victim is asleep when the blow lands, so its own ``refresh_status`` would
    miss the externally-caused flip; combat must emit ``agent_paralyzed`` itself so
    co-located agents perceive the collapse (perception is the product).
    """
    world.modify_agent_energy("wanderer_002", -70.0)  # 100 -> 30.0, still ALIVE
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")  # 30 -> 0.0 => PARALYZED

    t = world.get_agent("wanderer_002")
    assert t is not None and t.status is AgentStatus.PARALYZED
    inbox = event_bus.get_events("wanderer_002")
    paralyzed = [e for e in inbox if e.type == "agent_paralyzed"]
    assert paralyzed, "expected an agent_paralyzed event on the ALIVE->PARALYZED flip"
    assert paralyzed[0].scope is ScopeType.LOCAL
    assert paralyzed[0].region == "alpha"
    assert paralyzed[0].timestamp == world.now()
    # The damage 'attack' event is still emitted alongside it.
    assert any(e.type == "attack" for e in inbox)


async def test_attack_nonlethal_no_flip_no_agent_paralyzed(
    world: WorldState, event_bus: EventBus
) -> None:
    """A non-lethal hit that leaves the target ALIVE emits no ``agent_paralyzed``."""
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")  # 100 -> 70, ALIVE
    assert not any(e.type == "agent_paralyzed" for e in event_bus.get_events("wanderer_002"))
