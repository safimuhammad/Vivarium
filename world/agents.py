"""Agent domain model: the :class:`AgentState` dataclass and :class:`AgentStatus`.

``AgentState`` is the single record describing one agent's live world position and
resources. It is a stdlib dataclass with ``slots=True`` for a small memory/access
win on the hot path, and is deliberately **mutable** (NOT frozen): the world
mutates these records in place (see ``CLAUDE.md`` Section 3). All mutation goes
through :class:`~world.world.WorldState` methods, not by reaching into the fields
directly from outside the world.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AgentStatus(Enum):
    """Lifecycle status of an agent.

    Attributes:
        ALIVE: The agent can perceive and act normally.
        PARALYZED: The agent is incapacitated (currently entered at 0.0 energy).
        DEAD: The agent has been removed from active play.
    """

    ALIVE = "alive"
    PARALYZED = "paralyzed"
    DEAD = "dead"


@dataclass(slots=True)
class AgentState:
    """Live state of a single agent in the world.

    A mutable hot-path record; the :class:`~world.world.WorldState` owns and
    mutates instances in place. Not frozen by design.

    Attributes:
        id: Stable unique identifier, conventionally ``"{category}_{suffix}"``.
        name: Human-readable display name.
        persona: Free-text personality/identity description for the agent.
        current_position: Name of the region the agent currently occupies.
        current_energy: Current energy reserve (floored at 0.0 by the world).
        current_materials: Current materials reserve (floored at 0.0).
        status: Lifecycle status; see :class:`AgentStatus`.
        last_mated_at: World-clock time (seconds) of this agent's last *completed*
            mating, or ``None`` if it has never mated. Drives the mating cooldown.
            Written only via :meth:`~world.world.WorldState.record_mating`.
        offspring_count: Number of offspring this agent has parented. Bounded by
            the design-doc per-agent cap (``MATING_MAX_OFFSPRING``). Written only
            via :meth:`~world.world.WorldState.record_mating`.
    """

    # identity
    id: str
    name: str
    persona: str
    # world position
    current_position: str
    # resources
    current_energy: float
    current_materials: float
    # lifecycle
    status: AgentStatus
    # mating bookkeeping (defaulted so existing construction sites are unchanged)
    last_mated_at: float | None = None
    offspring_count: int = 0


def describe_agent_brief(agent: AgentState) -> str:
    """Render a one-line summary of an agent as another being would perceive it.

    Names the agent, marks its condition (``(fallen)`` if PARALYZED, ``(dead)`` if
    DEAD), exposes its ``id`` so a perceiver can address it in a targeted action, and
    surfaces its energy and materials so a perceiver can judge whether it is a viable
    mating partner (can it match a commitment?) or attack target (is it weak?). Shared
    by the breathing-loop perception and the ``look_around`` tool so both speak with one
    voice.

    Args:
        agent: The agent being described (someone other than the perceiver).

    Returns:
        A single-line description, e.g. ``"Mae [id: wanderer_002] (energy 88.0,
        materials 45.0)"`` with a ``(fallen)``/``(dead)`` marker when not ALIVE.
    """
    match agent.status:
        case AgentStatus.PARALYZED:
            label = " (fallen)"
        case AgentStatus.DEAD:
            label = " (dead)"
        case _:
            label = ""
    return (
        f"{agent.name}{label} [id: {agent.id}] "
        f"(energy {agent.current_energy}, materials {agent.current_materials})"
    )
