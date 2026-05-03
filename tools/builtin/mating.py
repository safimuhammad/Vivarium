from world.world import WorldState
from world.agents import AgentState, AgentStatus
from world.regions import ResourceTypes
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
import uuid
import random
from faker import Faker

AGENT_ID_CAT = ["wanderer", "fighter", "hoarder", "womenizer", "wisdom", "explorer"]


async def initiate_mating(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    message: str,
    resources: dict[ResourceTypes, float],
):
    agent_init = world.get_agent(agent_id)
    agent_target = world.get_agent(target)
    if not agent_init or not agent_target:
        return f"Error: Agent not found in the world."
    for type, quantity in resources.items():
        if type == ResourceTypes.ENERGY:
            if agent_init.current_energy < quantity:
                return f"Error: Committed {type} more than currently available."
        if type == ResourceTypes.MATERIALS:
            if agent_init.current_materials < quantity:
                return f"Error: Committed {type} more than currently available."
    for type, quantity in resources.items():
        if type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_init.id, -quantity)
        if type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_init.id, -quantity)

    world.add_proposal(agent_init.id, target, resources)
    payload = {"message": message}
    event_message = Event(
        "mating_initiated",
        agent_init.id,
        payload,
        ScopeType.TARGETED,
        target=agent_target.id,
    )
    await event_bus.publish(event_message)
    return f"Successfully sent the mating request to agent ID:{agent_target.id}|Agent Name:{agent_target.name}, mating request is subject to proposal acceptance, in case of reject or timeout your committed resources will be returned back to you."


async def reject_mating(
    world: WorldState, event_bus: EventBus, agent_id: str, target: str, message: str
):
    agent_init = world.get_agent(agent_id)
    agent_target = world.get_agent(target)
    if not agent_init or not agent_target:
        return f"Error: Agent not found in the world."
    pend_proposal = world.get_agent_proposals(agent_target.id, agent_init.id)
    if not pend_proposal:
        return f"Error: No pending proposal found."
    for type, quantity in pend_proposal.get("resources").items():
        if type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_target.id, quantity)
        if type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_target.id, quantity)

    world.remove_proposal(agent_target.id, agent_init.id)
    payload = {"message": message}
    event_message = Event(
        "mating_rejected",
        agent_init.id,
        payload,
        scope=ScopeType.TARGETED,
        target=target,
    )
    await event_bus.publish(event_message)
    return f"Rejection successful, Agent ID:{agent_target.id}|Agent Name:{agent_target.name} informed of rejection."


async def accept_mating(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    target: str,
    message: str,
):
    agent_init = world.get_agent(target)
    agent_accept = world.get_agent(agent_id)
    if not agent_init or not agent_accept:
        return f"Error: Agent not in the world."
    pending_proposal = world.get_agent_proposals(agent_init.id, agent_accept.id)
    if not pending_proposal.get("resources", None):
        return f"Error: Pending proposal not found."
    for type, quantity in pending_proposal.get("resources").items():
        if type == ResourceTypes.ENERGY:
            if agent_accept.current_energy < quantity:
                return f"Error: Cannot accept proposal, must commit the same resources in the proposal.\n Commit at least {quantity} {type}"
        if type == ResourceTypes.MATERIALS:
            if agent_accept.current_materials < quantity:
                return f"Error: Cannot accept proposal, must commit the same resources in the proposal.\n Commit at least {quantity} {type}"

    for type, quantity in pending_proposal.get("resources").items():
        if type == ResourceTypes.ENERGY:
            world.modify_agent_energy(agent_accept.id, -quantity)
        if type == ResourceTypes.MATERIALS:
            world.modify_agent_materials(agent_accept.id, -quantity)

    # create new agent
    offspring_id = f"{random.choice(AGENT_ID_CAT)}_{str(uuid.uuid4())[:4]}"
    offspring_name = Faker().first_name()
    offspring_persona = f"{agent_init.persona}|{agent_accept.persona}"  # currently just appending it will be doing more sophisticated LLM based infusion of personas.
    offspring_energy = (
        pending_proposal.get("resources").get(ResourceTypes.ENERGY) * 1.6
    )  # not exactly twice the committed resources since some are burned in process.
    offspring_materials = (
        pending_proposal.get("resources").get(ResourceTypes.MATERIALS) * 1.6
    )  # not exactly twice the committed resources since some are burned in process.
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
        "message": f"New Agent is born with Agent ID:{offspring_id}|Agent Name:{offspring_name}, Mated by Agent ID:{agent_init.id}|Agent Name:{agent_init.name} and Agent ID:{agent_accept.id}|Agent Name:{agent_accept.name}"
    }
    event_message = Event("agent_born", offspring_id, payload, scope=ScopeType.LOCAL)
    await event_bus.publish(event_message)
    return f"Successfully accepted mating, Your offspring is now born with Agent ID:{offspring_id}|Agent Name:{offspring_name},Your Child is now in this world, talk, coach, nurture it collectively if you wish so with your partner.\n Parent Details:\n Agent ID:{agent_init.id}|Agent Name:{agent_init.name} and Agent ID:{agent_accept.id}|Agent Name:{agent_accept.name}"
