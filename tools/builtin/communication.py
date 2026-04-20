from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from world.world import WorldState
import random


async def speak(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    message: str,
    target: str = None,
):
    agent_state = world.get_agent(agent_id)
    if not agent_state:
        return "Error speaking, Agent does not exist"
    event = Event(
        type="speak",
        source=agent_state.id,
        payload={"message": message},
        scope=ScopeType.TARGETED if target else ScopeType.LOCAL,
        target=target,
    )
    if world.modify_agent_energy(agent_id, -0.5):
        await event_bus.publish(event)
        destination = target if target else f"Region|{agent_state.current_position}"
        return f"Your message was sent to {destination}"


async def wait(world: WorldState, event_bus: EventBus, agent_id: str):
    wait_phrase = [
        "Resting",
        "Rejuvinating",
        "Looksmaxing",
        "Observing a peaceful world",
        "The world is chaotic take a break",
        "Contemplating",
        "Lost in thoughts",
    ]
    wait_mesage = (
        f"{random.choice(wait_phrase)}\n"
        f"As Time passes by slowly, use `look_around` for stats and nearby information"
    )
    return wait_mesage
