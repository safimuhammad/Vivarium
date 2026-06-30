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

from pydantic import BaseModel, ConfigDict, Field, model_validator

from core.constants import GENESIS_SEED
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
    energy_rate: float = Field(ge=0.0)
    materials_rate: float = Field(ge=0.0)
    current_energy: float = Field(ge=0.0)
    current_materials: float = Field(ge=0.0)
    max_energy: float = Field(gt=0.0)
    max_materials: float = Field(gt=0.0)

    @model_validator(mode="after")
    def _check_within_caps(self) -> RegionConfig:
        """Reject starting pools that exceed their caps (a still-life misconfig).

        Returns:
            ``self`` when valid.

        Raises:
            ValueError: If ``current_energy`` > ``max_energy`` or
                ``current_materials`` > ``max_materials``.
        """
        if self.current_energy > self.max_energy:
            raise ValueError(
                f"Region {self.name!r}: current_energy ({self.current_energy}) "
                f"exceeds max_energy ({self.max_energy})."
            )
        if self.current_materials > self.max_materials:
            raise ValueError(
                f"Region {self.name!r}: current_materials ({self.current_materials}) "
                f"exceeds max_materials ({self.max_materials})."
            )
        return self

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
        current_position: Name of the region the agent starts in.
        current_energy: Starting energy reserve.
        current_materials: Starting materials reserve.
        status: Lifecycle status as an :class:`AgentStatus` member.

    Note:
        There is intentionally **no** ``persona`` field. Every agent is born from the
        single shared :data:`~core.constants.GENESIS_SEED` and authors its own identity
        thereafter; a per-agent persona would re-introduce the hand-written
        personalities the design exists to avoid. Supplying one fails validation
        (``extra='forbid'``).
    """

    model_config = _STRICT

    id: str
    name: str
    current_position: str
    current_energy: float = Field(ge=0.0)
    current_materials: float = Field(ge=0.0)
    status: AgentStatus

    def to_agent_state(self) -> AgentState:
        """Convert this validated config into a domain :class:`AgentState`.

        The agent's ``persona`` is set to the shared :data:`~core.constants.GENESIS_SEED`
        (the one prompt every being is born from); it diverges only through its own
        lived experience and self-revision.

        Returns:
            A new mutable :class:`~world.agents.AgentState` with ``status`` as an
            :class:`~world.agents.AgentStatus` enum member and ``persona`` set to the
            genesis seed.
        """
        return AgentState(
            id=self.id,
            name=self.name,
            persona=GENESIS_SEED,
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

    regions: list[RegionConfig] = Field(min_length=1)
    agents: list[AgentConfig] = Field(min_length=1)

    @model_validator(mode="after")
    def _check_references_and_uniqueness(self) -> WorldConfig:
        """Cross-validate the world: unique names/ids and valid region references.

        Pydantic validates each region/agent in isolation; this checks the
        *relationships* a typo can silently break -- so a bad ``world.yaml`` fails
        loudly at load instead of producing a ghost region or a bricked agent.

        Returns:
            ``self`` when valid.

        Raises:
            ValueError: On duplicate region names or agent ids, a ``connections``
                entry naming an unknown region, or an agent ``current_position``
                naming an unknown region.
        """
        region_names = [region.name for region in self.regions]
        known_regions = set(region_names)
        if len(region_names) != len(known_regions):
            duplicates = sorted({n for n in region_names if region_names.count(n) > 1})
            raise ValueError(f"Duplicate region names: {duplicates}.")

        agent_ids = [agent.id for agent in self.agents]
        if len(agent_ids) != len(set(agent_ids)):
            duplicates = sorted({i for i in agent_ids if agent_ids.count(i) > 1})
            raise ValueError(f"Duplicate agent ids: {duplicates}.")

        for region in self.regions:
            for connection in region.connections:
                if connection not in known_regions:
                    raise ValueError(
                        f"Region {region.name!r} connects to unknown region {connection!r}."
                    )

        for agent in self.agents:
            if agent.current_position not in known_regions:
                raise ValueError(
                    f"Agent {agent.id!r} starts in unknown region {agent.current_position!r}."
                )
        return self

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
