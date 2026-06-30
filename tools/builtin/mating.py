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

The design-doc mating rules are enforced here (the "explosion guard" — they bound
population growth so the world neither collapses nor explodes):

* **Minimum contributions** (``MATING_MIN_ENERGY_CONTRIBUTION`` /
  ``MATING_MIN_MATERIALS_CONTRIBUTION``) — a proposal must commit at least the
  minimum of *both* resources; checked in :func:`initiate_mating`.
* **Cooldown** (``MATING_COOLDOWN_SECONDS``) — an agent that mated recently cannot
  initiate or accept; eligibility is re-validated for *both* parties at accept-time
  (a pending proposal's initiate-time snapshot can go stale).
* **Per-agent offspring cap** (``MATING_MAX_OFFSPRING``) — checked for the initiator
  at initiate-time and for both parties at accept-time.

When the initiator is no longer eligible at accept-time the proposal can never
legally complete, so it is auto-refunded and dropped (mirroring :func:`reject_mating`
and the world-tick timeout sweep) rather than stranding the escrow.
"""

from __future__ import annotations

import math
from typing import Any

from faker import Faker

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    AGENT_ID_CATEGORIES,
    GENESIS_SEED,
    MATING_COOLDOWN_SECONDS,
    MATING_MAX_OFFSPRING,
    MATING_MIN_ENERGY_CONTRIBUTION,
    MATING_MIN_MATERIALS_CONTRIBUTION,
    MATING_OFFSPRING_MULTIPLIER,
)
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from world.world import WorldState

_COOLDOWN_MESSAGE = "Invalid: You mated too recently; you must wait before mating again."
"""Agent-facing rejection when an agent is still within its mating cooldown."""

_OFFSPRING_CAP_MESSAGE = "Invalid: You have reached the maximum number of offspring."
"""Agent-facing rejection when an agent has hit the per-agent offspring cap."""


def _clean_committed_resources(resources: object) -> dict[ResourceTypes, float] | str:
    """Validate and coerce a model-supplied resource commitment.

    The decider is a messy local LLM, so ``resources`` may arrive as a non-dict, with
    string keys (e.g. ``{"energy": 50}``), unknown resource types, or non-positive
    amounts -- each of which would otherwise crash or silently corrupt the escrow.

    Args:
        resources: The raw, model-supplied commitment mapping.

    Returns:
        A clean ``{ResourceTypes: positive float}`` dict on success, or an
        agent-facing ``"Error: "`` / ``"Invalid: "`` string describing the rejection.
    """
    if not isinstance(resources, dict) or not resources:
        return "Error: 'resources' must be a non-empty mapping of resource type to amount."
    cleaned: dict[ResourceTypes, float] = {}
    for key, value in resources.items():
        try:
            resource_type = ResourceTypes(key)
        except ValueError:
            valid = ", ".join(r.value for r in ResourceTypes)
            return f"Error: Unknown resource type {key!r}; valid resources are {valid}."
        try:
            amount = float(value)  # untrusted model input; the try/except is the guard
        except (TypeError, ValueError):
            return f"Error: Amount for {resource_type.value} must be a number, but got {value!r}."
        if not math.isfinite(amount) or amount <= 0:
            return f"Invalid: Amount for {resource_type.value} must be positive, but got {value!r}."
        cleaned[resource_type] = amount
    return cleaned


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
        A success sentence on a stored proposal; an ``"Error: "`` string if an agent
        is unknown or a committed amount exceeds the initiator's balance; or an
        ``"Invalid: "`` string if the initiator is on mating cooldown, has reached the
        offspring cap, or the commitment is below the minimum contributions. Rejected
        calls mutate nothing.
    """
    agent_init = world.get_agent(agent_id)
    agent_target = world.get_agent(target)
    if not agent_init or not agent_target:
        return "Error: Agent not found in the world."

    committed = _clean_committed_resources(resources)
    if isinstance(committed, str):
        return committed

    # Explosion-guard preconditions (design-doc rules), checked before any mutation:
    # precondition -> proposal validity, all ahead of the affordability/balance check.
    if world.is_on_mating_cooldown(agent_init.id, world.now(), MATING_COOLDOWN_SECONDS):
        return _COOLDOWN_MESSAGE
    if agent_init.offspring_count >= MATING_MAX_OFFSPRING:
        return _OFFSPRING_CAP_MESSAGE
    if (
        committed.get(ResourceTypes.ENERGY, 0.0) < MATING_MIN_ENERGY_CONTRIBUTION
        or committed.get(ResourceTypes.MATERIALS, 0.0) < MATING_MIN_MATERIALS_CONTRIBUTION
    ):
        return (
            f"Invalid: A mating proposal must commit at least "
            f"{MATING_MIN_ENERGY_CONTRIBUTION:.0f} energy and "
            f"{MATING_MIN_MATERIALS_CONTRIBUTION:.0f} materials."
        )

    if world.get_agent_proposals(agent_id, target):
        return (
            f"Invalid: You already have a pending mating proposal to "
            f"Agent ID:{agent_target.id}|Agent Name:{agent_target.name}; "
            f"wait for a response or let it expire before sending another."
        )

    for resource_type, quantity in committed.items():
        if resource_type == ResourceTypes.ENERGY and agent_init.current_energy < quantity:
            return f"Error: Committed {resource_type} more than currently available."
        if resource_type == ResourceTypes.MATERIALS and agent_init.current_materials < quantity:
            return f"Error: Committed {resource_type} more than currently available."

    for resource_type, quantity in committed.items():
        if resource_type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_init.id, -quantity)
        elif resource_type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_init.id, -quantity)

    world.add_proposal(agent_init.id, target, committed)
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

    Both parties' mating eligibility (cooldown + offspring cap) is re-validated at
    accept-time; the initiator's eligibility is re-checked because a pending proposal's
    initiate-time snapshot can go stale (it may have mated elsewhere meanwhile).

    Mutates world state:
        * Deducts each committed resource from the acceptor.
        * Adds a new :class:`~world.agents.AgentState` (the offspring) at the
          acceptor's region with ``committed * MATING_OFFSPRING_MULTIPLIER`` of
          each resource and both parents' personas concatenated.
        * Removes the pending proposal.
        * Records the mating for **both** parents via
          :meth:`~world.world.WorldState.record_mating` (sets ``last_mated_at`` and
          increments ``offspring_count`` — the cooldown/cap bookkeeping).
        * On a stale-initiator rejection only: refunds the initiator's escrow and
          removes the proposal (no offspring; mirrors :func:`reject_mating`).

    Emits events:
        * On success: one ``"agent_born"`` event (:attr:`~bus.events.ScopeType.LOCAL`
          to the birth region, stamped with ``world.now()``, sourced from the offspring).
        * On a stale-initiator rejection: one ``"mating_proposal_invalidated"`` event
          (:attr:`~bus.events.ScopeType.TARGETED` to the initiator) so the refunded
          initiator can perceive why its escrow returned (mirrors the world-tick
          ``"mating_proposal_timeout"`` event).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the accepting agent.
        target: Id of the original initiator.
        message: Free-text message (unused in the success payload, kept for the
            uniform signature and future use).

    Returns:
        A success sentence announcing the offspring; an ``"Error: "`` string if an
        agent is unknown, there is no pending proposal, or the acceptor cannot match
        the committed resources; or an ``"Invalid: "`` string if the acceptor is on
        cooldown / at the offspring cap (proposal left intact), or the initiator is no
        longer eligible (proposal refunded and dropped).
    """
    agent_init = world.get_agent(target)
    agent_accept = world.get_agent(agent_id)
    if not agent_init or not agent_accept:
        return "Error: Agent not in the world."

    pending_proposal = world.get_agent_proposals(agent_init.id, agent_accept.id)
    resources: Any = pending_proposal.get("resources")
    if not resources:
        return "Error: Pending proposal not found."

    # Acceptor must currently be eligible to mate (explosion guard). A refusal here
    # leaves the proposal intact -- the acceptor may become eligible, or it is refunded
    # later via reject/timeout -- so no escrow is touched.
    if world.is_on_mating_cooldown(agent_accept.id, world.now(), MATING_COOLDOWN_SECONDS):
        return _COOLDOWN_MESSAGE
    if agent_accept.offspring_count >= MATING_MAX_OFFSPRING:
        return _OFFSPRING_CAP_MESSAGE

    # Re-validate the INITIATOR at commit-time: a proposal can sit in escrow while the
    # initiator mates elsewhere, so its initiate-time snapshot may be stale. If the
    # initiator can no longer legally mate, the proposal can never complete -- refund its
    # escrow and drop it (as reject_mating / the timeout sweep do) so resources are never
    # stranded behind a permanently-dead proposal.
    if (
        world.is_on_mating_cooldown(agent_init.id, world.now(), MATING_COOLDOWN_SECONDS)
        or agent_init.offspring_count >= MATING_MAX_OFFSPRING
    ):
        for resource_type, quantity in resources.items():
            if resource_type == ResourceTypes.ENERGY:
                world.modify_agent_energy(agent_init.id, quantity)
            elif resource_type == ResourceTypes.MATERIALS:
                world.modify_agent_materials(agent_init.id, quantity)
        world.remove_proposal(agent_init.id, agent_accept.id)
        # Notify the initiator so its LLM perceives why the escrow reappeared (perception
        # is the product; mirrors the world-tick ``mating_proposal_timeout`` event). All
        # mutations are done before this ``await``, so a concurrent reject/tick on the now
        # already-removed proposal cannot double-refund.
        await event_bus.publish(
            Event(
                "mating_proposal_invalidated",
                agent_init.id,
                {
                    "message": (
                        f"Your mating proposal to {agent_accept.id} was invalidated because "
                        f"you are no longer eligible to mate (cooldown or offspring cap); "
                        f"your committed resources have been refunded."
                    )
                },
                scope=ScopeType.TARGETED,
                target=agent_init.id,
                timestamp=world.now(),
            )
        )
        return (
            "Invalid: This mating proposal is no longer valid (the initiator is on "
            "cooldown or at their offspring cap); their committed resources have been refunded."
        )

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

    # Compute the offspring FULLY before mutating any world state: a single-type
    # commitment (only energy or only materials) must default the missing type to
    # zero, not crash mid-mutation and strand the acceptor's deducted resources
    # (validate-before-mutate). Randomness (id suffix, Faker name) routes through
    # world.rng so the offspring identity is reproducible from the world seed.
    offspring_id = f"{world.rng.choice(AGENT_ID_CATEGORIES)}_{world.rng.getrandbits(16):04x}"
    faker = Faker()
    faker.seed_instance(world.rng.getrandbits(32))
    offspring_name = faker.first_name()
    # Offspring are born from the same shared GENESIS_SEED as the founders: they are
    # not handed their parents' natures (no inheritance-by-concatenation). Like every
    # being, a child discovers and authors its own identity through living + reflection.
    offspring_persona = GENESIS_SEED
    # Not exactly the sum committed -- some is "burned" in the process.
    offspring_energy = resources.get(ResourceTypes.ENERGY, 0.0) * MATING_OFFSPRING_MULTIPLIER
    offspring_materials = resources.get(ResourceTypes.MATERIALS, 0.0) * MATING_OFFSPRING_MULTIPLIER
    offspring = AgentState(
        id=offspring_id,
        name=offspring_name,
        persona=offspring_persona,
        current_position=agent_accept.current_position,
        current_energy=offspring_energy,
        current_materials=offspring_materials,
        status=AgentStatus.ALIVE,
    )

    for resource_type, quantity in resources.items():
        if resource_type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_accept.id, -quantity)
        elif resource_type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_accept.id, -quantity)
    world.add_agent(offspring)
    world.remove_proposal(agent_init.id, agent_accept.id)
    # Both parents go on cooldown and have their offspring count incremented -- the
    # explosion-guard bookkeeping that the next initiate/accept eligibility checks read.
    completed_at = world.now()
    world.record_mating(agent_init.id, completed_at)
    world.record_mating(agent_accept.id, completed_at)
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
