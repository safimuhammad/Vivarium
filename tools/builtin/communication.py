"""Communication tools: ``speak`` (broadcast/whisper) and ``wait`` (rest).

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting agent's LLM. All randomness routes
through ``world.rng`` so runs are reproducible from a seed.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import SPEAK_ENERGY_COST
from world.agents import AgentStatus
from world.world import WorldState

WAIT_PHRASES: tuple[str, ...] = (
    "Resting",
    "Rejuvinating",
    "Looksmaxing",
    "Observing a peaceful world",
    "The world is chaotic take a break",
    "Contemplating",
    "Lost in thoughts",
)
"""Flavour phrases for :func:`wait`; one is chosen via ``world.rng`` per call."""


async def speak(
    world: WorldState,
    event_bus: EventBus,
    agent_id: str,
    message: str,
    target: str | None = None,
) -> str:
    """Utter a message, either broadcast to the region or whispered to one agent.

    Mutates world state:
        * Subtracts :data:`~core.constants.SPEAK_ENERGY_COST` from the speaker's
          energy.

    Emits events:
        * One ``"speak"`` event stamped with ``world.now()``. Scope is
          :attr:`~bus.events.ScopeType.TARGETED` (to ``target``) when a target is
          given, otherwise :attr:`~bus.events.ScopeType.LOCAL` (to the speaker's
          region).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the speaking agent.
        message: The message text carried in the event payload.
        target: Optional id of a single recipient; ``None`` broadcasts locally.

    Returns:
        A confirmation sentence naming the destination, or a rejection string:
        ``"Error: "`` if the speaker is unknown or a whisper ``target`` does not
        exist, or ``"Invalid: "`` if the speaker is not ``ALIVE`` (e.g. paralysed)
        or the message is empty/blank. On any rejection path no energy is deducted
        and no event is published.
    """
    agent_state = world.get_agent(agent_id)
    if not agent_state:
        return "Error: Cannot speak, agent does not exist."

    # A paralysed (non-ALIVE) agent cannot act: reject before mutating or
    # publishing so a frozen agent neither spends energy nor broadcasts.
    if agent_state.status is not AgentStatus.ALIVE:
        return "Invalid: You are paralyzed and cannot speak."

    # Validate before mutating: an empty/blank message would broadcast a
    # semantically empty perception to every regional agent at full energy cost.
    if not isinstance(message, str) or not message.strip():
        return "Invalid: Cannot speak — message must be a non-empty string."

    # A whisper to an absent target would be silently dropped by the bus's
    # TARGETED routing, charging the speaker for an undelivered message.
    if target is not None and world.get_agent(target) is None:
        return f"Error: Cannot whisper — agent {target!r} does not exist."

    event = Event(
        type="speak",
        source=agent_state.id,
        payload={"message": message},
        scope=ScopeType.TARGETED if target else ScopeType.LOCAL,
        target=target,
        timestamp=world.now(),
    )
    world.modify_agent_energy(agent_id, -SPEAK_ENERGY_COST)
    await event_bus.publish(event)
    destination = target if target else f"Region|{agent_state.current_position}"
    return f"Your message was sent to {destination}"


async def wait(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Pass time without acting, returning a randomized rest phrase.

    Mutates world state:
        * Nothing.

    Emits events:
        * Nothing.

    Args:
        world: The live world state (used only for its seeded ``rng``).
        event_bus: Unused; present for the uniform tool signature.
        agent_id: Id of the resting agent; unused beyond the uniform signature.

    Returns:
        A flavour phrase (selected via ``world.rng`` for reproducibility) plus a
        hint to use ``look_around``.
    """
    return (
        f"{world.rng.choice(WAIT_PHRASES)}\n"
        "As Time passes by slowly, use `look_around` for stats and nearby information"
    )
