"""Combat tool: one agent attacks another co-located agent.

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting agent's LLM (success sentence,
``"Error: "`` for a lookup/precondition failure, ``"Invalid: "`` for a rule
violation). Combat costs and damage are sourced from :mod:`core.constants`.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import ATTACK_DAMAGE, ATTACK_ENERGY_COST
from world.agents import AgentStatus
from world.world import WorldState


async def attack(world: WorldState, event_bus: EventBus, agent_id: str, target: str) -> str:
    """Attack a co-located agent, draining the attacker's and target's energy.

    Mutates world state:
        * Subtracts :data:`~core.constants.ATTACK_ENERGY_COST` from the
          attacker's energy.
        * Subtracts :data:`~core.constants.ATTACK_DAMAGE` from the target's
          energy (floored at 0.0 by the world; the world paralyses the target
          if it reaches exactly 0.0).

    Emits events:
        * One ``"attack"`` event (:attr:`~bus.events.ScopeType.LOCAL`, stamped
          with ``world.now()``) targeting the victim, delivered to every agent in
          the attacker's region.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the attacking agent.
        target: Id of the agent being attacked.

    Returns:
        A success sentence on a landed attack; an ``"Error: "`` string if either
        agent is unknown; an ``"Invalid: "`` string if the attacker targets
        itself, the target is already dead, the target is in another region, or
        the attacker lacks the energy to attack.
    """
    attacker_agent = world.get_agent(agent_id)
    target_agent = world.get_agent(target)
    if not attacker_agent or not target_agent:
        return "Error: Can't find Agent in the world."
    if attacker_agent.id == target_agent.id:
        return "Invalid: You cannot attack yourself."
    if target_agent.status is AgentStatus.DEAD:
        return f"Invalid: {target_agent.name} is already dead — there is nothing to attack."
    if attacker_agent.current_position != target_agent.current_position:
        return f"Invalid: Can't attack outside the region {attacker_agent.current_position}"
    if attacker_agent.current_energy < ATTACK_ENERGY_COST:
        return (
            f"Invalid: Can't attack, current energy|{attacker_agent.current_energy} "
            f"lower than required to attack {ATTACK_ENERGY_COST}."
        )

    world.modify_agent_energy(attacker_agent.id, -ATTACK_ENERGY_COST)
    world.modify_agent_energy(target_agent.id, -ATTACK_DAMAGE)
    payload = {
        "message": (
            f"Agent ID:{attacker_agent.id}|Agent Name:{attacker_agent.name} Attacked you! "
            f"and drained {ATTACK_DAMAGE} Energy points. "
            f"Energy Remaining:{target_agent.current_energy} "
        )
    }
    event_message = Event(
        "attack",
        attacker_agent.id,
        payload,
        scope=ScopeType.LOCAL,
        target=target_agent.id,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
    return (
        f"Successfully Attacked {target_agent.name}|ID{target_agent.id}\n"
        f" Energy remaining: {attacker_agent.current_energy}"
    )
