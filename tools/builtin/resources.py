from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from world.world import WorldState
from world.agents import AgentState
from world.regions import ResourceTypes, Region


def _resource_handler_by_region(
    region: Region, resource_type: ResourceTypes, amount: float
):
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
):
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
    resource_type: ResourceTypes,
    amount: float,
):
    try:
        agent_state = world.get_agent(agent_id)
        req_resource = ResourceTypes(resource_type)
        if not agent_state:
            return f"Error: Cannot find Agent {agent_id} in the world."
        curr_region = world.get_region(agent_state.current_position)
        status, resource = _resource_handler_by_region(
            curr_region, req_resource, amount
        )
        if not status:
            return f"Cannot harvest {req_resource}, you requested more than available resource {resource}"

        (
            world.modify_region_energy(curr_region.name, -amount)
            if req_resource == ResourceTypes.ENERGY
            else world.modify_region_materials(curr_region.name, -amount)
        )
        (
            world.modify_agent_energy(agent_id, amount)
            if req_resource == ResourceTypes.ENERGY
            else world.modify_agent_materials(agent_id, amount)
        )
        payload = {
            "message": f"Agent ID:{agent_state.id}\n Agent Name: {agent_state.name} Successfully Harvested {amount} of {req_resource} from Region {curr_region}"
        }
        event_message = Event(
            "resource_changed", agent_id, payload, scope=ScopeType.LOCAL
        )
        await event_bus.publish(event_message)
        return f"Successfully harvested {req_resource} from Region {curr_region}\n Agent Energy: {agent_state.current_energy}|Agent Materials: {agent_state.current_materials}\n Region Energy: {curr_region.current_energy}|Region Materials:{curr_region.current_materials} "

    except ValueError:
        return f"Error: Invalid resource type {resource_type}, only known resources are {" ".join([r.value for r in ResourceTypes])} "


async def transfer_resource(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    resource_type: ResourceTypes,
    amount: float,
):
    try:
        sender_agent = world.get_agent(agent_id)
        receiver_agent = world.get_agent(target)
        req_resource = ResourceTypes(resource_type)
        if not sender_agent or not receiver_agent:
            return f"Error: Cannot find Agents in the world"

        if sender_agent.current_position != receiver_agent.current_position:
            return f"Error: Cannot transfer resources across regions, both sender and receiver has to be in the same region"

        status, resource = _resource_handler_by_agent(
            sender_agent, req_resource, amount
        )
        if not status:
            return f"Cannot transfer {amount}{req_resource} to target Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name}, Your Current {req_resource} is {resource} amount exceeding current available"

        (
            world.modify_agent_energy(sender_agent.id, -amount)
            if req_resource == ResourceTypes.ENERGY
            else world.modify_agent_materials(sender_agent.id, -amount)
        )

        (
            world.modify_agent_energy(receiver_agent.id, amount)
            if req_resource == ResourceTypes.ENERGY
            else world.modify_agent_materials(receiver_agent.id, amount)
        )
        payload = {
            "message": f"Agent ID:{sender_agent.id}|Agent Name: {sender_agent.name} Successfully Sent {amount} of {req_resource} to Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name} "
        }
        event_message = Event(
            "resource_transferred",
            sender_agent.id,
            payload,
            scope=ScopeType.LOCAL,
            target=receiver_agent.id,
        )
        await event_bus.publish(event_message)
        return f"Successfully transferred {req_resource} to Agent ID:{receiver_agent.id}|Agent Name:{receiver_agent.name},\n Agent Energy:{sender_agent.current_energy}| Agent Materials:{sender_agent.current_materials}"
    except ValueError:
        return f"Error: Invalid resource type {resource_type}, only known resources are {" ".join([r.value for r in ResourceTypes])} "
