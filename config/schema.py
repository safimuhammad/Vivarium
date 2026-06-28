"""Pydantic v2 schema for the ``world.yaml`` config boundary.

These models are the *only* place Pydantic is used in Vivarium: validation lives
at the boundary, and the rest of the system trusts plain stdlib dataclasses (see
the production-foundation spec Section 4). Each model validates the raw mapping
parsed from YAML, coerces YAML ints into the floats the domain expects, converts
the ``status`` string into the :class:`~world.agents.AgentStatus` enum, and then
exposes ``to_*`` helpers that produce the mutable hot-path domain dataclasses
(:class:`~world.regions.Region`, :class:`~world.agents.AgentState`).

Policy: every model sets ``extra="forbid"`` so an unknown or mistyped field in
``world.yaml`` fails loudly rather than being silently ignored.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from world.agents import AgentState, AgentStatus
from world.regions import Region

_STRICT = ConfigDict(extra="forbid")
"""Shared model config: reject unknown fields so config typos fail loudly."""


class RegionConfig(BaseModel):
    """Validated configuration for a single region.

    Mirrors the ``regions:`` entries in ``world.yaml``. Numeric fields accept
    YAML ints and coerce them to ``float`` to match the domain dataclass.

    Attributes:
        name: Stable unique region name (also its map key).
        description: Human-readable description of the region.
        connections: Names of directly reachable regions (movement edges).
        energy_rate: Energy added per regeneration tick.
        materials_rate: Materials added per regeneration tick.
        current_energy: Starting energy available in the region.
        current_materials: Starting materials available in the region.
        max_energy: Upper bound enforced by regeneration.
        max_materials: Upper bound enforced by regeneration.
    """

    model_config = _STRICT

    name: str
    description: str
    connections: list[str]
    energy_rate: float
    materials_rate: float
    current_energy: float
    current_materials: float
    max_energy: float
    max_materials: float

    def to_region(self) -> Region:
        """Convert this validated config into a domain :class:`Region`.

        Returns:
            A new mutable :class:`~world.regions.Region` carrying the validated
            values (``connections`` is copied so the config and domain objects do
            not share the same list).
        """
        return Region(
            name=self.name,
            description=self.description,
            connections=list(self.connections),
            energy_rate=self.energy_rate,
            materials_rate=self.materials_rate,
            current_energy=self.current_energy,
            current_materials=self.current_materials,
            max_energy=self.max_energy,
            max_materials=self.max_materials,
        )


class AgentConfig(BaseModel):
    """Validated configuration for a single starting agent.

    Mirrors the ``agents:`` entries in ``world.yaml``. The ``status`` string is
    validated against :class:`~world.agents.AgentStatus`; an unknown value fails
    validation. Numeric resource fields coerce YAML ints to ``float``.

    Attributes:
        id: Stable unique identifier, conventionally ``"{category}_{suffix}"``.
        name: Human-readable display name.
        persona: Free-text personality/identity description.
        current_position: Name of the region the agent starts in.
        current_energy: Starting energy reserve.
        current_materials: Starting materials reserve.
        status: Lifecycle status as an :class:`AgentStatus` member.
    """

    model_config = _STRICT

    id: str
    name: str
    persona: str
    current_position: str
    current_energy: float
    current_materials: float
    status: AgentStatus

    def to_agent_state(self) -> AgentState:
        """Convert this validated config into a domain :class:`AgentState`.

        Returns:
            A new mutable :class:`~world.agents.AgentState` with ``status`` as an
            :class:`~world.agents.AgentStatus` enum member.
        """
        return AgentState(
            id=self.id,
            name=self.name,
            persona=self.persona,
            current_position=self.current_position,
            current_energy=self.current_energy,
            current_materials=self.current_materials,
            status=self.status,
        )


class WorldConfig(BaseModel):
    """Top-level validated configuration for an entire world.

    Mirrors the root of ``world.yaml``. Both ``regions`` and ``agents`` are
    required keys; a missing key fails validation (rather than silently building
    a partially-empty world, as the prototype loader did).

    Attributes:
        regions: Validated region configs.
        agents: Validated agent configs.
    """

    model_config = _STRICT

    regions: list[RegionConfig]
    agents: list[AgentConfig]

    def to_regions(self) -> list[Region]:
        """Convert all region configs into domain :class:`Region` objects.

        Returns:
            A list of mutable :class:`~world.regions.Region` instances.
        """
        return [region.to_region() for region in self.regions]

    def to_agents(self) -> list[AgentState]:
        """Convert all agent configs into domain :class:`AgentState` objects.

        Returns:
            A list of mutable :class:`~world.agents.AgentState` instances.
        """
        return [agent.to_agent_state() for agent in self.agents]
