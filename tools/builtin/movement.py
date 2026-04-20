from multiprocessing import connection
from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from tests.breathing_test import agent
from world.world import WorldState


async def move(
    world: WorldState, event_bus: EventBus, agent_id: str, destination: str
) -> str:
    agent_state = world.get_agent(agent_id)
    destination_region = world.get_region(destination)
    if not agent_state or not destination_region:
        return "Error cannot move to destination, either destination is wrong or the provided region"
    current_pos = agent_state.current_position

    if world.move_agent(agent_id, destination_region.name):
        left_event = Event(
            type="agent_left_region",
            source=agent_state.id,
            region=current_pos,
            payload={
                "message": f"{agent_state.name} has left the region {current_pos}\n Currently en route to {destination_region.name}"
            },
            scope=ScopeType.LOCAL,
        )
        await event_bus.publish(left_event)
        enter_event = Event(
            type="agent_entered_region",
            source=agent_state.id,
            region=destination_region.name,
            payload={
                "message": f"{agent_state.name} has entered the region {destination_region.name}\n Migrated from {current_pos}"
            },
            scope=ScopeType.LOCAL,
        )
        await event_bus.publish(enter_event)
        return (
            f"Agent Moved from {current_pos} to {destination_region.name} Successfully"
        )


async def look_around(world: WorldState, event_bus: EventBus, agent_id: str):
    if agent_state := world.get_agent(agent_id):
        agents_nearby = world.get_agents_in_region(agent_state.current_position)
        region_state = world.get_region(agent_state.current_position)

        dashboard = (
            f"YOUR CURRENT STATUS\n"
            f"Energy| {agent_state.current_energy}\n"
            f"Materials| {agent_state.current_materials}\n"
            f"World INFORMATION\n"
            f"Region| {region_state.name} - {region_state.description}\n"
            f"Energy pool| {region_state.current_energy}\n"
            f"Materials pool| {region_state.current_materials}\n"
            f"Connections| {','.join(region_state.connections)}\n"
            f"Agents present| {','.join([agent.name for agent in agents_nearby if agent.id != agent_id ])}\n"
        )
        return dashboard
