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

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from world.agents import AgentState
from world.regions import Region, ResourceTypes
from world.world import WorldState


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

    agent_state = world.get_agent(agent_id)
    if not agent_state:
        return f"Error: Cannot find Agent {agent_id} in the world."
    curr_region = world.get_region(agent_state.current_position)
    if curr_region is None:
        return f"Error: Region {agent_state.current_position!r} does not exist."

    status, resource = _resource_handler_by_region(curr_region, req_resource, amount)
    if not status:
        return (
            f"Invalid: Cannot harvest {req_resource}, you requested more than "
            f"available resource {resource}"
        )

    if req_resource == ResourceTypes.ENERGY:
        world.modify_region_energy(curr_region.name, -amount)
        world.modify_agent_energy(agent_id, amount)
    else:
        world.modify_region_materials(curr_region.name, -amount)
        world.modify_agent_materials(agent_id, amount)

    payload = {
        "message": (
            f"Agent ID:{agent_state.id}\n Agent Name: {agent_state.name} "
            f"Successfully Harvested {amount} of {req_resource} from Region {curr_region.name}"
        )
    }
    event_message = Event(
        "resource_changed",
        agent_id,
        payload,
        scope=ScopeType.LOCAL,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
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

    sender_agent = world.get_agent(agent_id)
    receiver_agent = world.get_agent(target)
    if not sender_agent or not receiver_agent:
        return "Error: Cannot find Agents in the world"

    if sender_agent.current_position != receiver_agent.current_position:
        return (
            "Invalid: Cannot transfer resources across regions, "
            "both sender and receiver has to be in the same region"
        )

    status, resource = _resource_handler_by_agent(sender_agent, req_resource, amount)
    if not status:
        return (
            f"Invalid: Cannot transfer {amount}{req_resource} to target "
            f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name}, "
            f"Your Current {req_resource} is {resource} amount exceeding current available"
        )

    if req_resource == ResourceTypes.ENERGY:
        world.modify_agent_energy(sender_agent.id, -amount)
        world.modify_agent_energy(receiver_agent.id, amount)
    else:
        world.modify_agent_materials(sender_agent.id, -amount)
        world.modify_agent_materials(receiver_agent.id, amount)

    payload = {
        "message": (
            f"Agent ID:{sender_agent.id}|Agent Name: {sender_agent.name} "
            f"Successfully Sent {amount} of {req_resource} to "
            f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name} "
        )
    }
    event_message = Event(
        "resource_transferred",
        sender_agent.id,
        payload,
        scope=ScopeType.LOCAL,
        target=receiver_agent.id,
        timestamp=world.now(),
    )
    await event_bus.publish(event_message)
    return (
        f"Successfully transferred {req_resource} to "
        f"Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name},\n"
        f" Agent Energy:{sender_agent.current_energy}| "
        f"Agent Materials:{sender_agent.current_materials}"
    )
