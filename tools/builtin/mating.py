"""Mating tools: the proposal/escrow lifecycle that can spawn a new agent.

Mating is a two-sided escrow so resources are never lost in flight:

* :func:`initiate_mating` -- the initiator's committed resources are deducted up
  front and a pending proposal is stored.
* :func:`reject_mating` -- the committed resources are refunded to the initiator
  and the proposal is removed.
* :func:`accept_mating` -- the acceptor commits the *same* resources, both
  contributions are consumed, and an offspring agent is spawned.

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting agent's LLM. All randomness
(offspring id category/suffix and the Faker name) routes through ``world.rng`` so
offspring identities are reproducible from a seed.

Note: the design-doc mating *minimums*, *cooldown* and *max-offspring* rules are
centralized in :mod:`core.constants` but are deliberately **not** enforced here
(preserving current gameplay behavior); this divergence is flagged for a later
phase, not fixed.
"""

from __future__ import annotations

from typing import Any

from faker import Faker

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import AGENT_ID_CATEGORIES, MATING_OFFSPRING_MULTIPLIER
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState


async def initiate_mating(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    message: str,
    resources: dict[ResourceTypes, float],
) -> str:
    """Propose mating to ``target``, committing (and deducting) resources now.

    Mutates world state:
        * Deducts each committed resource from the initiator (energy/materials).
        * Stores a pending proposal keyed ``(initiator, target)`` via
          :meth:`~world.world.WorldState.add_proposal` (timestamped from
          ``world.now()``).

    Emits events:
        * One ``"mating_initiated"`` event (:attr:`~bus.events.ScopeType.TARGETED`
          to ``target``, stamped with ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the initiating agent.
        target: Id of the agent being proposed to.
        message: Free-text message carried in the event payload.
        resources: Resources the initiator commits, keyed by
            :class:`~world.regions.ResourceTypes`.

    Returns:
        A success sentence on a stored proposal, or an ``"Error: "`` string if an
        agent is unknown or a committed amount exceeds the initiator's balance.
    """
    agent_init = world.get_agent(agent_id)
    agent_target = world.get_agent(target)
    if not agent_init or not agent_target:
        return "Error: Agent not found in the world."

    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY and agent_init.current_energy < quantity:
            return f"Error: Committed {resource_type} more than currently available."
        if resource_type == ResourceTypes.MATERIALS and agent_init.current_materials < quantity:
            return f"Error: Committed {resource_type} more than currently available."

    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_init.id, -quantity)
        elif resource_type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_init.id, -quantity)

    world.add_proposal(agent_init.id, target, resources)
    event_message = Event(
        "mating_initiated",
        agent_init.id,
        {"message": message},
        ScopeType.TARGETED,
        target=agent_target.id,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
    return (
        f"Successfully sent the mating request to agent ID:{agent_target.id}|"
        f"Agent Name:{agent_target.name}, mating request is subject to proposal acceptance, "
        f"in case of reject or timeout your committed resources will be returned back to you."
    )


async def reject_mating(
    world: WorldState, event_bus: EventBus, agent_id: str, target: str, message: str
) -> str:
    """Reject a pending proposal, refunding the initiator's committed resources.

    Here ``agent_id`` is the party rejecting (the original proposal's target) and
    ``target`` is the original initiator who committed the resources.

    Mutates world state:
        * Refunds each committed resource back to the original initiator.
        * Removes the pending proposal via
          :meth:`~world.world.WorldState.remove_proposal`.

    Emits events:
        * One ``"mating_rejected"`` event (:attr:`~bus.events.ScopeType.TARGETED`
          to the initiator, stamped with ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the agent rejecting the proposal.
        target: Id of the original initiator.
        message: Free-text message carried in the event payload.

    Returns:
        A success sentence on a refunded/removed proposal, or an ``"Error: "``
        string if an agent is unknown or there is no pending proposal.
    """
    agent_init = world.get_agent(agent_id)
    agent_target = world.get_agent(target)
    if not agent_init or not agent_target:
        return "Error: Agent not found in the world."

    pend_proposal = world.get_agent_proposals(agent_target.id, agent_init.id)
    if not pend_proposal:
        return "Error: No pending proposal found."

    resources: Any = pend_proposal.get("resources", {})
    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_target.id, quantity)
        elif resource_type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_target.id, quantity)

    world.remove_proposal(agent_target.id, agent_init.id)
    event_message = Event(
        "mating_rejected",
        agent_init.id,
        {"message": message},
        scope=ScopeType.TARGETED,
        target=target,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
    return (
        f"Rejection successful, Agent ID:{agent_target.id}|"
        f"Agent Name:{agent_target.name} informed of rejection."
    )


async def accept_mating(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    message: str,
) -> str:
    """Accept a pending proposal: consume both contributions and spawn offspring.

    Here ``agent_id`` is the accepting party and ``target`` is the original
    initiator. The acceptor must be able to match the proposal's committed
    resources.

    Mutates world state:
        * Deducts each committed resource from the acceptor.
        * Adds a new :class:`~world.agents.AgentState` (the offspring) at the
          acceptor's region with ``committed * MATING_OFFSPRING_MULTIPLIER`` of
          each resource and both parents' personas concatenated.
        * Removes the pending proposal.

    Emits events:
        * One ``"agent_born"`` event (:attr:`~bus.events.ScopeType.LOCAL` to the
          birth region, stamped with ``world.now()``, sourced from the offspring).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the accepting agent.
        target: Id of the original initiator.
        message: Free-text message (unused in the success payload, kept for the
            uniform signature and future use).

    Returns:
        A success sentence announcing the offspring, or an ``"Error: "`` string if
        an agent is unknown, there is no pending proposal, or the acceptor cannot
        match the committed resources.
    """
    agent_init = world.get_agent(target)
    agent_accept = world.get_agent(agent_id)
    if not agent_init or not agent_accept:
        return "Error: Agent not in the world."

    pending_proposal = world.get_agent_proposals(agent_init.id, agent_accept.id)
    resources: Any = pending_proposal.get("resources")
    if not resources:
        return "Error: Pending proposal not found."

    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY and agent_accept.current_energy < quantity:
            return (
                "Error: Cannot accept proposal, must commit the same resources in the proposal.\n"
                f" Commit at least {quantity} {resource_type}"
            )
        if resource_type == ResourceTypes.MATERIALS and agent_accept.current_materials < quantity:
            return (
                "Error: Cannot accept proposal, must commit the same resources in the proposal.\n"
                f" Commit at least {quantity} {resource_type}"
            )

    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_accept.id, -quantity)
        elif resource_type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_accept.id, -quantity)

    # New agent: category, id suffix and name all routed through world.rng so the
    # offspring identity is reproducible from the world seed.
    offspring_id = f"{world.rng.choice(AGENT_ID_CATEGORIES)}_{world.rng.getrandbits(16):04x}"
    faker = Faker()
    faker.seed_instance(world.rng.getrandbits(32))
    offspring_name = faker.first_name()
    # Persona currently just concatenated; later phases will do LLM-based infusion.
    offspring_persona = f"{agent_init.persona}|{agent_accept.persona}"
    # Not exactly the sum committed -- some is "burned" in the process.
    offspring_energy = resources.get(ResourceTypes.ENERGY) * MATING_OFFSPRING_MULTIPLIER
    offspring_materials = resources.get(ResourceTypes.MATERIALS) * MATING_OFFSPRING_MULTIPLIER
    offspring = AgentState(
        id=offspring_id,
        name=offspring_name,
        persona=offspring_persona,
        current_position=agent_accept.current_position,
        current_energy=offspring_energy,
        current_materials=offspring_materials,
        status=AgentStatus.ALIVE,
    )
    world.add_agent(offspring)
    world.remove_proposal(agent_init.id, agent_accept.id)
    payload = {
        "message": (
            f"New Agent is born with Agent ID:{offspring_id}|Agent Name:{offspring_name}, "
            f"Mated by Agent ID:{agent_init.id}|Agent Name:{agent_init.name} and "
            f"Agent ID:{agent_accept.id}|Agent Name:{agent_accept.name}"
        )
    }
    event_message = Event(
        "agent_born",
        offspring_id,
        payload,
        scope=ScopeType.LOCAL,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
    return (
        f"Successfully accepted mating, Your offspring is now born with "
        f"Agent ID:{offspring_id}|Agent Name:{offspring_name},Your Child is now in this world, "
        f"talk, coach, nurture it collectively if you wish so with your partner.\n"
        f" Parent Details:\n Agent ID:{agent_init.id}|Agent Name:{agent_init.name} and "
        f"Agent ID:{agent_accept.id}|Agent Name:{agent_accept.name}"
    )
