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
