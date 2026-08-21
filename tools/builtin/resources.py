"""Resource tools: ``harvest_resources`` (region -> agent) and
``transfer_resource`` (agent -> agent).

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting agent's LLM (success sentence,
``"Error: "`` for a lookup/precondition failure such as an unknown agent or an
unrecognised resource type, ``"Invalid: "`` for a rule violation such as
insufficient stock or a cross-region transfer).
"""

from __future__ import annotations

import math

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from observability.event_payloads import resource_type_value
from world.agents import AgentState, AgentStatus, is_hoarding
from world.regions import Region, ResourceTypes
from world.world import WorldState


def _coerce_positive_amount(amount: object) -> float | str:
    """Coerce a model-supplied ``amount`` to a positive, finite float.

    The decider LLM is untrusted input: it may send ``amount`` as a numeric
    string (``"50"``), a non-numeric string (``"five"``), ``None``, a list, a
    negative number, ``0``, or a non-finite float (``inf``/``nan``). This helper
    normalises that mess *before* any world lookup or mutation so the tools never
    raise on agent-controllable input and never reverse a resource flow.

    Numeric strings are accepted (``float("50") == 50.0``) because the model
    frequently sends numbers as strings.

    Args:
        amount: The raw amount supplied by the agent/LLM (any type).

    Returns:
        The validated positive ``float`` on success, or an agent-facing error
        string (``"Error: "`` for a non-numeric value, ``"Invalid: "`` for a
        non-finite or non-positive value) that the caller should return verbatim.
    """
    try:
        value = float(amount)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return f"Error: 'amount' must be a number, but got {amount!r}."
    if not math.isfinite(value):
        return f"Invalid: 'amount' must be a finite number, but got {value}."
    if value <= 0:
        return f"Invalid: 'amount' must be a positive number, but got {value}."
    return value


def _resource_handler_by_region(
    region: Region, resource_type: ResourceTypes, amount: float
) -> tuple[bool, float | None]:
    """Check a region holds at least ``amount`` of ``resource_type``.

    Args:
        region: The region to inspect.
        resource_type: Which resource to check.
        amount: The amount the caller wants to withdraw.

    Returns:
        ``(True, None)`` if the region has enough; ``(False, available)`` with the
        currently available amount otherwise.
    """
    match resource_type:
        case ResourceTypes.ENERGY:
            curr_energy = region.current_energy
            if amount > curr_energy:
                return False, curr_energy
        case ResourceTypes.MATERIALS:
            curr_materials = region.current_materials
            if amount > curr_materials:
                return False, curr_materials
    return True, None


def _resource_handler_by_agent(
    agent: AgentState, resource_type: ResourceTypes, amount: float
) -> tuple[bool, float | None]:
    """Check an agent holds at least ``amount`` of ``resource_type``.

    Args:
        agent: The agent to inspect.
        resource_type: Which resource to check.
        amount: The amount the caller wants to spend.

    Returns:
        ``(True, None)`` if the agent has enough; ``(False, available)`` with the
        currently available amount otherwise.
    """
    match resource_type:
        case ResourceTypes.ENERGY:
            curr_energy = agent.current_energy
            if amount > curr_energy:
                return False, curr_energy
        case ResourceTypes.MATERIALS:
            curr_materials = agent.current_materials
            if amount > curr_materials:
                return False, curr_materials
    return True, None


async def _announce_if_started_hoarding(
    event_bus: EventBus,
    agent: AgentState,
    *,
    was_hoarding: bool,
    energy_before: float,
    materials_before: float,
    region: str,
    timestamp: float,
) -> None:
    """Publish a LOCAL ``agent_started_hoarding`` event iff this op crossed the threshold.

    Shared by :func:`harvest_resources` and :func:`transfer_resource` so a being that
    becomes a hoarder by *any* resource-credit path is announced once, the moment it
    crosses (mirroring the ``was_paralyzed`` revival pattern). Does nothing if the
    agent was already hoarding or is still below both thresholds.

    Args:
        event_bus: The bus the event is published to.
        agent: The credited agent (its ``current_*`` already reflect the credit).
        was_hoarding: Whether the agent was hoarding *before* the credit.
        energy_before: The agent's energy before the credit (payload pre-state, so a
            renderer can animate the crossing rather than repaint its far side).
        materials_before: The agent's materials before the credit.
        region: Region to scope the LOCAL announcement to.
        timestamp: World-clock stamp for the event.

    Returns:
        None.
    """
    if was_hoarding or not is_hoarding(agent):
        return
    await event_bus.publish(
        Event(
            "agent_started_hoarding",
            agent.id,
            {
                "agent_id": agent.id,
                "region": region,
                "energy_before": energy_before,
                "energy": agent.current_energy,
                "materials_before": materials_before,
                "materials": agent.current_materials,
                "message": (
                    f"{agent.name} (ID:{agent.id}) is now sitting on a hoard "
                    f"(energy {agent.current_energy}, materials {agent.current_materials})."
                ),
            },
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=timestamp,
        )
    )


async def harvest_resources(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    resource_type: ResourceTypes | str,
    amount: float,
) -> str:
    """Harvest resource from the agent's current region into the agent.

    Mutates world state:
        * Subtracts ``amount`` from the region's energy/materials and adds it to
          the agent's energy/materials (both via the world's flooring methods).

    Emits events:
        * One ``"resource_changed"`` event (:attr:`~bus.events.ScopeType.LOCAL`,
          stamped with ``world.now()``) to the agent's region.
        * One ``"agent_started_hoarding"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, stamped with the region and
          ``world.now()``) **only** when this harvest lifts the agent over a hoarding
          threshold (see :func:`~world.agents.is_hoarding`), so co-located beings
          perceive the new hoarder. Only the crossing is announced.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the harvesting agent.
        resource_type: Resource to harvest (a :class:`~world.regions.ResourceTypes`
            or its string value).
        amount: Quantity to harvest.

    Returns:
        A success sentence with updated balances; an ``"Error: "`` string for an
        unknown agent or unrecognised resource type; an ``"Invalid: "`` string if
        the region holds less than ``amount``.
    """
    try:
        req_resource = ResourceTypes(resource_type)
    except ValueError:
        valid = " ".join(r.value for r in ResourceTypes)
        return f"Error: Invalid resource type {resource_type}, only known resources are {valid} "

    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity

    agent_state = world.get_agent(agent_id)
    if not agent_state:
        return f"Error: Cannot find Agent {agent_id} in the world."
    curr_region = world.get_region(agent_state.current_position)
    if curr_region is None:
        return f"Error: Region {agent_state.current_position!r} does not exist."

    status, resource = _resource_handler_by_region(curr_region, req_resource, quantity)
    if not status:
        return (
            f"Invalid: Cannot harvest {req_resource}, you requested more than "
            f"available resource {resource}"
        )

    # Snapshot hoarding state before the harvest so we can detect a *crossing* into
    # hoarding (and announce it once), mirroring the was_paralyzed revival pattern in
    # transfer_resource.
    was_hoarding = is_hoarding(agent_state)
    # Pre-mutation snapshot for the renderer (spec §4.2): all four balances below are
    # reported post-harvest, so the "before" side is read here, before any modify_*.
    agent_energy_before = agent_state.current_energy
    agent_materials_before = agent_state.current_materials
    region_energy_before = curr_region.current_energy
    region_materials_before = curr_region.current_materials

    if req_resource == ResourceTypes.ENERGY:
        world.modify_region_energy(curr_region.name, -quantity)
        world.modify_agent_energy(agent_id, quantity)
    else:
        world.modify_region_materials(curr_region.name, -quantity)
        world.modify_agent_materials(agent_id, quantity)

    payload = {
        "agent_id": agent_state.id,
        "agent_name": agent_state.name,
        "region": curr_region.name,
        "resource_type": resource_type_value(req_resource),
        "amount": quantity,
        "agent_energy_before": agent_energy_before,
        "agent_energy": agent_state.current_energy,
        "agent_materials_before": agent_materials_before,
        "agent_materials": agent_state.current_materials,
        "region_energy_before": region_energy_before,
        "region_energy": curr_region.current_energy,
        "region_materials_before": region_materials_before,
        "region_materials": curr_region.current_materials,
        "message": (
            f"Agent ID:{agent_state.id}\n Agent Name: {agent_state.name} "
            f"Successfully Harvested {quantity} of {resource_type_value(req_resource)} "
            f"from Region {curr_region.name}"
        ),
    }
    event_message = Event(
        "resource_changed",
        agent_id,
        payload,
        scope=ScopeType.LOCAL,
        region=curr_region.name,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)

    # If this harvest just lifted the agent over a hoarding threshold, announce it
    # LOCALLY so co-located beings perceive the new hoarder (and the chronicle gets a
    # beat). Only the crossing is announced -- an already-hoarding agent is silent.
    await _announce_if_started_hoarding(
        event_bus,
        agent_state,
        was_hoarding=was_hoarding,
        energy_before=agent_energy_before,
        materials_before=agent_materials_before,
        region=curr_region.name,
        timestamp=world.now(),
    )
    return (
        f"Successfully harvested {req_resource} from Region {curr_region.name}\n"
        f" Agent Energy: {agent_state.current_energy}|"
        f"Agent Materials: {agent_state.current_materials}\n"
        f" Region Energy: {curr_region.current_energy}|"
        f"Region Materials:{curr_region.current_materials} "
    )


async def transfer_resource(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    resource_type: ResourceTypes | str,
    amount: float,
) -> str:
    """Transfer resource from one agent to another co-located agent.

    Mutates world state:
        * Subtracts ``amount`` from the sender's energy/materials and adds it to
          the receiver's energy/materials (both via the world's flooring methods).

    Emits events:
        * One ``"resource_transferred"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, stamped with ``world.now()``,
          targeting the receiver) to the sender's region.
        * One ``"agent_recovered"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, source = the sending feeder,
          targeting the receiver, stamped with ``world.now()``) **only** when an
          energy transfer lifts a ``PARALYZED`` receiver back to ``ALIVE``, so
          nearby agents perceive the revival.
        * One ``"agent_started_hoarding"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, source = the receiver, stamped with
          the region and ``world.now()``) **only** when the transfer lifts the
          receiver over a hoarding threshold (see :func:`~world.agents.is_hoarding`).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the sending agent.
        target: Id of the receiving agent.
        resource_type: Resource to transfer (a :class:`~world.regions.ResourceTypes`
            or its string value).
        amount: Quantity to transfer.

    Returns:
        A success sentence with the sender's updated balances; an ``"Error: "``
        string for an unknown agent or unrecognised resource type; an
        ``"Invalid: "`` string if the two agents are in different regions or the
        sender holds less than ``amount``.
    """
    try:
        req_resource = ResourceTypes(resource_type)
    except ValueError:
        valid = " ".join(r.value for r in ResourceTypes)
        return f"Error: Invalid resource type {resource_type}, only known resources are {valid} "

    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity

    sender_agent = world.get_agent(agent_id)
    receiver_agent = world.get_agent(target)
    if not sender_agent or not receiver_agent:
        return "Error: Cannot find Agents in the world"

    if sender_agent.id == receiver_agent.id:
        return "Invalid: You cannot transfer resources to yourself."

    if receiver_agent.status is AgentStatus.DEAD:
        # Feeding a corpse would debit the sender while the receiver's DEAD-guarded
        # credit no-ops (energy destroyed) or strand materials on the dead; reject
        # before any mutation. PARALYZED receivers are allowed -- that is the revival
        # path -- so only DEAD is blocked.
        return f"Invalid: {receiver_agent.name} is dead; you cannot transfer resources to a corpse."

    if sender_agent.current_position != receiver_agent.current_position:
        return (
            "Invalid: Cannot transfer resources across regions, "
            "both sender and receiver has to be in the same region"
        )

    status, resource = _resource_handler_by_agent(sender_agent, req_resource, quantity)
    if not status:
        return (
            f"Invalid: Cannot transfer {quantity}{req_resource} to target "
            f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name}, "
            f"Your Current {req_resource} is {resource} amount exceeding current available"
        )

    # Snapshot the receiver's hoarding state before the credit so we can announce a
    # crossing once (covers both the energy and materials branches below).
    receiver_was_hoarding = is_hoarding(receiver_agent)
    # Pre-mutation snapshot for the renderer (spec §4.2): both parties' balances are
    # reported post-transfer, so the "before" side is read here, before any modify_*.
    sender_energy_before = sender_agent.current_energy
    sender_materials_before = sender_agent.current_materials
    receiver_energy_before = receiver_agent.current_energy
    receiver_materials_before = receiver_agent.current_materials

    if req_resource == ResourceTypes.ENERGY:
        was_paralyzed = receiver_agent.status is AgentStatus.PARALYZED
        world.modify_agent_energy(sender_agent.id, -quantity)
        world.modify_agent_energy(receiver_agent.id, quantity)
        if was_paralyzed and receiver_agent.status is AgentStatus.ALIVE:
            recover_payload = {
                "giver_id": sender_agent.id,
                "recipient_id": receiver_agent.id,
                "revived_id": receiver_agent.id,
                "region": receiver_agent.current_position,
                "resource_type": resource_type_value(req_resource),
                "amount": quantity,
                "giver_energy_before": sender_energy_before,
                "giver_energy": sender_agent.current_energy,
                "revived_energy_before": receiver_energy_before,
                "revived_energy": receiver_agent.current_energy,
                "message": (
                    f"{sender_agent.name} revived {receiver_agent.name} (ID:{receiver_agent.id})."
                ),
            }
            await event_bus.publish(
                Event(
                    "agent_recovered",
                    sender_agent.id,
                    recover_payload,
                    scope=ScopeType.LOCAL,
                    target=receiver_agent.id,
                    timestamp=world.now(),
                )
            )
    else:
        world.modify_agent_materials(sender_agent.id, -quantity)
        world.modify_agent_materials(receiver_agent.id, quantity)

    payload = {
        "sender_id": sender_agent.id,
        "receiver_id": receiver_agent.id,
        "region": sender_agent.current_position,
        "resource_type": resource_type_value(req_resource),
        "amount": quantity,
        "sender_name": sender_agent.name,
        "receiver_name": receiver_agent.name,
        "sender_energy_before": sender_energy_before,
        "sender_energy": sender_agent.current_energy,
        "sender_materials_before": sender_materials_before,
        "sender_materials": sender_agent.current_materials,
        "receiver_energy_before": receiver_energy_before,
        "receiver_energy": receiver_agent.current_energy,
        "receiver_materials_before": receiver_materials_before,
        "receiver_materials": receiver_agent.current_materials,
        "message": (
            f"Agent ID:{sender_agent.id}|Agent Name: {sender_agent.name} "
            f"Successfully Sent {quantity} of {resource_type_value(req_resource)} to "
            f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name} "
        ),
    }
    event_message = Event(
        "resource_transferred",
        sender_agent.id,
        payload,
        scope=ScopeType.LOCAL,
        region=sender_agent.current_position,
        target=receiver_agent.id,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)

    # A gift can also make a hoarder: announce if this transfer lifted the receiver
    # over a threshold (co-located, so the sender's region is the receiver's region).
    await _announce_if_started_hoarding(
        event_bus,
        receiver_agent,
        was_hoarding=receiver_was_hoarding,
        energy_before=receiver_energy_before,
        materials_before=receiver_materials_before,
        region=receiver_agent.current_position,
        timestamp=world.now(),
    )
    return (
        f"Successfully transferred {req_resource} to "
        f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name},\n"
        f" Agent Energy:{sender_agent.current_energy}| "
        f"Agent Materials:{sender_agent.current_materials}"
    )
