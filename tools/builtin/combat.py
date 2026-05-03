from world.world import WorldState
from bus.event_bus import EventBus
from bus.events import Event, ScopeType

ATTACK_ENERGY = 10.0  # move to a global config at some point
ATTACK_DAMAGE = 30.0  # move to a global config at some point


async def attack(
    world: WorldState, event_bus: EventBus, agent_id: str, target: str
) -> str:
    attacker_agent = world.get_agent(agent_id)
    target_agent = world.get_agent(target)
    if not attacker_agent or not target_agent:
        return f"Error: Can't find Agent in the world."
    if attacker_agent.current_position != target_agent.current_position:
        return f"Invalid: Can't attack outside the region {attacker_agent.current_position}"
    if attacker_agent.current_energy < ATTACK_ENERGY:
        return f"Invalid: Can't attack, current energy|{attacker_agent.current_energy} lower than required to attack {ATTACK_ENERGY}."
    world.modify_agent_energy(attacker_agent.id, -ATTACK_ENERGY)
    world.modify_agent_energy(target_agent.id, -ATTACK_DAMAGE)
    payload = {
        "message": f"Agent ID:{attacker_agent.id}|Agent Name:{attacker_agent.name} Attacked you! and drained {ATTACK_DAMAGE} Energy points. Energy Remaining:{target_agent.current_energy} "
    }
    event_message = Event(
        "attack",
        attacker_agent.id,
        payload,
        scope=ScopeType.LOCAL,
        target=target_agent.id,
    )
    await event_bus.publish(event_message)
    return f"Successfully Attacked {target_agent.name}|ID{target_agent.id}\n Energy remaining: {attacker_agent.current_energy}"
