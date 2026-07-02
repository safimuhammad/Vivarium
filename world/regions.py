"""Region domain model: the :class:`Region` dataclass and :class:`ResourceTypes`.

A ``Region`` is a place in the world holding regenerating resources and edges to
adjacent regions. It is a stdlib dataclass with ``slots=True`` and is
deliberately **mutable** (NOT frozen): the :class:`~world.world.WorldState`
mutates resource levels in place on the hot path (see ``CLAUDE.md`` Section 3).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class ResourceTypes(Enum):
    """The kinds of resource an agent or region can hold.

    Attributes:
        ENERGY: Spent on actions; at or below the paralysis threshold (5.0) an agent is paralysed.
        MATERIALS: Tradeable/committable stock (e.g. for mating proposals).
    """

    ENERGY = "energy"
    MATERIALS = "materials"


@dataclass(slots=True)
class Region:
    """A place in the world with regenerating energy and materials.

    A mutable hot-path record; the :class:`~world.world.WorldState` owns and
    mutates instances in place. Not frozen by design.

    Attributes:
        name: Stable unique region name (also its map key).
        description: Human-readable description of the region.
        connections: Names of regions directly reachable from here (movement is
            only permitted along these edges).
        energy_rate: Energy added per :meth:`~world.world.WorldState.regenerate_resources`
            tick.
        materials_rate: Materials added per regeneration tick.
        current_energy: Current energy available in the region.
        current_materials: Current materials available in the region.
        max_energy: Upper bound enforced by regeneration (energy is capped here).
        max_materials: Upper bound enforced by regeneration (materials capped here).
    """

    # identity
    name: str
    description: str
    # geography
    connections: list[str]
    # regeneration rates
    energy_rate: float
    materials_rate: float
    # current levels
    current_energy: float
    current_materials: float
    # caps
    max_energy: float
    max_materials: float
