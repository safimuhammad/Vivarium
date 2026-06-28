"""The :class:`WorldState` -- single source of truth for the live simulation.

``WorldState`` owns every agent and region plus the pending mating proposals, and
exposes the *only* sanctioned way to mutate them: its methods. It is a mutable,
in-memory hot-path singleton (see ``CLAUDE.md`` Section 3); mutations are
synchronous because they are cheap dictionary operations.

Determinism seam (see ``CLAUDE.md`` Section 4 and the spec's "Determinism seam"):
the world holds a :class:`~core.rng.SimContext` bundling a seedable
:class:`random.Random` and an injectable clock. Tools route all randomness
through :attr:`WorldState.rng` and read time through :meth:`WorldState.now`, so a
run is reproducible from a seed and tests can freeze time. Construction stays
backward compatible -- ``regions`` and ``agents`` remain the first two positional
parameters, so ``WorldState(regions, agents)`` and the config loader keep working;
``rng`` and ``clock`` are keyword-only with safe defaults.

Error model: the boolean-returning query/mutation methods keep their existing
contract (``True`` on success, ``False`` when a lookup/precondition fails); they
do not raise for ordinary rejected operations. :class:`~core.exceptions.WorldStateError`
is reserved for genuine infrastructure misuse should it become necessary.
"""

from __future__ import annotations

import random
from typing import Any

from core.constants import PARALYSIS_ENERGY_THRESHOLD
from core.logging import get_logger
from core.rng import Clock, SimContext, default_clock, make_rng

from .agents import AgentState, AgentStatus
from .regions import Region, ResourceTypes

logger = get_logger(__name__)


class WorldState:
    """Live, mutable container for all agents, regions and mating proposals.

    The single source of truth for the simulation. All state changes go through
    the methods on this class; nothing outside should mutate the contained
    dataclasses directly.

    Attributes:
        regions: Map of region name -> :class:`~world.regions.Region`.
        agents: Map of agent id -> :class:`~world.agents.AgentState`.
        pending_proposals: Map of ``(initiator_id, target_id)`` -> proposal dict
            (keys ``"target"``, ``"timestamp"``, ``"resources"``).
        pending_proposal_targets: Map of initiator id -> list of target ids it
            has outstanding proposals to.
        context: The :class:`~core.rng.SimContext` bundling the seam.
        rng: The injected :class:`random.Random`; route all randomness here.
        clock: The injected clock callable (seconds); prefer :meth:`now`.
    """

    def __init__(
        self,
        regions: list[Region] | None = None,
        agents: list[AgentState] | None = None,
        *,
        rng: random.Random | None = None,
        clock: Clock | None = None,
    ) -> None:
        """Initialise the world.

        Args:
            regions: Initial regions; ``None`` starts with an empty world.
            agents: Initial agents; ``None`` starts with no agents.
            rng: Seedable RNG for all randomness. ``None`` builds an unseeded
                :func:`~core.rng.make_rng` (non-deterministic).
            clock: Zero-argument callable returning the current time in seconds.
                ``None`` uses :func:`~core.rng.default_clock` (wall clock).
        """
        regions = regions or []
        agents = agents or []
        self.regions: dict[str, Region] = {region.name: region for region in regions}
        self.agents: dict[str, AgentState] = {agent.id: agent for agent in agents}
        self.pending_proposals: dict[tuple[str, str], dict[str, Any]] = {}
        self.pending_proposal_targets: dict[str, list[str]] = {}

        self.context: SimContext = SimContext(
            rng=rng if rng is not None else make_rng(),
            clock=clock if clock is not None else default_clock,
        )
        # Convenience references to the seam; same objects held by ``context``.
        self.rng: random.Random = self.context.rng
        self.clock: Clock = self.context.clock

    def now(self) -> float:
        """Return the current time from the injected clock.

        Returns:
            The current time in seconds, per the injected clock. All
            time-dependent world logic (e.g. proposal timestamps) reads here so
            runs stay reproducible under a fake clock.
        """
        return self.context.now()

    # ---- get methods ----

    def get_all_regions(self) -> list[Region]:
        """Return every region as a list.

        Returns:
            A new list of all :class:`~world.regions.Region` instances.
        """
        return list(self.regions.values())

    def get_all_agents(self) -> list[AgentState]:
        """Return every agent as a list.

        Returns:
            A new list of all :class:`~world.agents.AgentState` instances.
        """
        return list(self.agents.values())

    def get_region(self, name: str) -> Region | None:
        """Look up a region by name.

        Args:
            name: Region name to look up.

        Returns:
            The :class:`~world.regions.Region`, or ``None`` if unknown.
        """
        return self.regions.get(name)

    def get_agent(self, agent_id: str) -> AgentState | None:
        """Look up an agent by id.

        Args:
            agent_id: Agent id to look up.

        Returns:
            The :class:`~world.agents.AgentState`, or ``None`` if unknown.
        """
        return self.agents.get(agent_id)

    def get_agents_in_region(self, region_name: str) -> list[AgentState]:
        """Return all agents whose current position is the given region.

        Args:
            region_name: Region name to filter by.

        Returns:
            A list of agents located in ``region_name`` (empty if none, or if the
            region does not exist).
        """
        return [agent for agent in self.agents.values() if agent.current_position == region_name]

    # ---- Agent methods ----

    def add_agent(self, agent: AgentState) -> bool:
        """Add an agent to the world.

        Mutates :attr:`agents`.

        Args:
            agent: The agent to add.

        Returns:
            ``True`` if added; ``False`` if an agent with the same id already
            exists (no overwrite).
        """
        if agent.id not in self.agents:
            self.agents[agent.id] = agent
            return True
        return False

    def remove_agent(self, agent: AgentState) -> bool:
        """Remove an agent from the world.

        Mutates :attr:`agents`.

        Args:
            agent: The agent to remove (matched by ``agent.id``).

        Returns:
            ``True`` if removed; ``False`` if the agent was not present.
        """
        if agent.id in self.agents:
            del self.agents[agent.id]
            return True
        return False

    def move_agent(self, agent_id: str, destination: str) -> bool:
        """Move an agent to a directly connected region.

        Mutates the agent's :attr:`~world.agents.AgentState.current_position`.

        Args:
            agent_id: Id of the agent to move.
            destination: Name of the destination region.

        Returns:
            ``True`` if the agent and destination both exist and the destination
            is in the current region's ``connections``; ``False`` otherwise
            (unknown agent/region, or non-adjacent destination). Position is left
            unchanged on failure.
        """
        if agent_id in self.agents and destination in self.regions:
            current_pos = self.agents[agent_id].current_position
            current_region = self.regions.get(current_pos)
            if current_region is None:
                logger.error(
                    "move_agent: agent %r has unknown current_position %r",
                    agent_id,
                    current_pos,
                )
                return False
            if destination in current_region.connections:
                self.agents[agent_id].current_position = destination
                return True
        return False

    def update_agent_status(self, agent_id: str, status: AgentStatus) -> bool:
        """Set an agent's lifecycle status.

        Mutates the agent's :attr:`~world.agents.AgentState.status`.

        Args:
            agent_id: Id of the agent to update.
            status: New :class:`~world.agents.AgentStatus`.

        Returns:
            ``True`` if the agent exists and was updated; ``False`` otherwise.
        """
        if agent_id in self.agents:
            self.agents[agent_id].status = status
            return True
        return False

    def modify_agent_energy(self, agent_id: str, amount: float) -> bool:
        """Add ``amount`` to an agent's energy and reconcile its lifecycle status.

        This is the **sole** writer of the ``ALIVE <-> PARALYZED`` transition
        (design DD4). After applying the delta (floored at 0.0, never capped --
        agents have no max, see :meth:`modify_region_energy` for the region rule):

        * If energy ``<= PARALYSIS_ENERGY_THRESHOLD`` (inclusive, **including
          0.0**) and the agent is ``ALIVE``, it becomes ``PARALYZED``.
        * If energy ``> PARALYSIS_ENERGY_THRESHOLD`` and the agent is
          ``PARALYZED``, it revives to ``ALIVE``.

        A ``DEAD`` agent is terminal: the call early-returns without touching
        energy or status (guarding the Sprint-6 death writer against accidental
        resurrection). No events are emitted -- ``WorldState`` has no bus -- and
        ``DEAD`` is never set here (death is Sprint 6).

        Args:
            agent_id: Id of the agent to modify.
            amount: Signed delta to apply (negative to drain).

        Returns:
            ``True`` if the agent exists (including the ``DEAD`` terminal no-op);
            ``False`` only if no such agent exists.
        """
        agent = self.agents.get(agent_id)
        if agent is None:
            return False
        if agent.status is AgentStatus.DEAD:
            # Death is terminal: never change a dead agent's energy or status.
            return True
        agent.current_energy = max(agent.current_energy + amount, 0.0)
        if agent.current_energy <= PARALYSIS_ENERGY_THRESHOLD and agent.status is AgentStatus.ALIVE:
            agent.status = AgentStatus.PARALYZED
        elif (
            agent.current_energy > PARALYSIS_ENERGY_THRESHOLD
            and agent.status is AgentStatus.PARALYZED
        ):
            agent.status = AgentStatus.ALIVE
        return True

    def modify_agent_materials(self, agent_id: str, amount: float) -> bool:
        """Add ``amount`` to an agent's materials, flooring at 0.0.

        Mutates the agent's :attr:`~world.agents.AgentState.current_materials`.

        Args:
            agent_id: Id of the agent to modify.
            amount: Signed delta to apply (negative to spend).

        Returns:
            ``True`` if the agent exists and was modified; ``False`` otherwise.
        """
        if agent_id in self.agents:
            agent = self.agents[agent_id]
            agent.current_materials = max(agent.current_materials + amount, 0.0)
            return True
        return False

    # ---- Mating proposal methods ----

    def get_agent_proposals(self, agent_id: str, target: str) -> dict[str, Any]:
        """Return the pending proposal from ``agent_id`` to ``target``.

        Args:
            agent_id: Initiator id.
            target: Target id.

        Returns:
            The proposal dict (keys ``"target"``, ``"timestamp"``,
            ``"resources"``), or an empty dict if no such proposal exists.
        """
        return self.pending_proposals.get((agent_id, target), {})

    def get_proposed_targets(self, agent_id: str) -> list[str]:
        """Return the ids an agent has outstanding proposals to.

        Args:
            agent_id: Initiator id.

        Returns:
            A list of target ids (empty if the agent has no proposals).
        """
        return self.pending_proposal_targets.get(agent_id, [])

    def add_proposal(
        self, agent_id: str, target: str, resources: dict[ResourceTypes, float]
    ) -> bool:
        """Record a mating proposal from ``agent_id`` to ``target``.

        Mutates :attr:`pending_proposals` and :attr:`pending_proposal_targets`.
        The proposal's timestamp is read from :meth:`now` (the injected clock).

        Args:
            agent_id: Initiator id (must exist).
            target: Target id (must exist).
            resources: Resources the initiator commits, keyed by
                :class:`~world.regions.ResourceTypes`.

        Returns:
            ``True`` if both agents exist and the proposal was stored; ``False``
            otherwise.
        """
        if agent_id in self.agents and target in self.agents:
            self.pending_proposals[(agent_id, target)] = {
                "target": target,
                "timestamp": self.now(),
                "resources": resources,
            }
            self.pending_proposal_targets.setdefault(agent_id, []).append(target)
            return True
        return False

    def remove_proposal(self, agent_id: str, target: str) -> bool:
        """Remove a pending proposal from ``agent_id`` to ``target``.

        Mutates :attr:`pending_proposals` and :attr:`pending_proposal_targets`.

        Args:
            agent_id: Initiator id.
            target: Target id.

        Returns:
            ``True`` if the proposal existed and was removed; ``False`` otherwise.
        """
        if (agent_id, target) in self.pending_proposals:
            del self.pending_proposals[(agent_id, target)]
            self.pending_proposal_targets[agent_id].remove(target)
            return True
        return False

    # ---- Region methods ----

    def add_region(self, region: Region) -> bool:
        """Add a region to the world.

        Mutates :attr:`regions`.

        Args:
            region: The region to add.

        Returns:
            ``True`` if added; ``False`` if a region with the same name already
            exists (no overwrite).
        """
        if region.name not in self.regions:
            self.regions[region.name] = region
            return True
        return False

    def modify_region_energy(self, region_name: str, amount: float) -> bool:
        """Add ``amount`` to a region's energy, clamped to ``[0.0, max_energy]``.

        Mutates the region's :attr:`~world.regions.Region.current_energy`. Regions
        are bounded above (design DD8): the result is floored at 0.0 and capped at
        the region's ``max_energy`` (agents, by contrast, are floor-only because
        capping them would clip mating-escrow refunds).

        Args:
            region_name: Name of the region to modify.
            amount: Signed delta to apply.

        Returns:
            ``True`` if the region exists and was modified; ``False`` otherwise.
        """
        if region_name in self.regions:
            region = self.regions[region_name]
            region.current_energy = min(max(region.current_energy + amount, 0.0), region.max_energy)
            return True
        return False

    def modify_region_materials(self, region_name: str, amount: float) -> bool:
        """Add ``amount`` to a region's materials, clamped to ``[0.0, max_materials]``.

        Mutates the region's :attr:`~world.regions.Region.current_materials`.
        Regions are bounded above (design DD8): the result is floored at 0.0 and
        capped at the region's ``max_materials``.

        Args:
            region_name: Name of the region to modify.
            amount: Signed delta to apply.

        Returns:
            ``True`` if the region exists and was modified; ``False`` otherwise.
        """
        if region_name in self.regions:
            region = self.regions[region_name]
            region.current_materials = min(
                max(region.current_materials + amount, 0.0), region.max_materials
            )
            return True
        return False

    def regenerate_resources(self) -> None:
        """Regenerate every region's energy and materials by one tick.

        For each region adds its ``energy_rate``/``materials_rate``, caps the
        result at the region's ``max_energy``/``max_materials``, and floors it at
        ``0.0`` (defense-in-depth: config validation already forbids negative
        rates, so a pool can never drift below zero over a forever-run). Mutates the
        :attr:`~world.regions.Region.current_energy` and
        :attr:`~world.regions.Region.current_materials` of every region in
        :attr:`regions`.

        Returns:
            None.
        """
        for region in self.regions.values():
            region.current_energy = max(
                0.0, min(region.current_energy + region.energy_rate, region.max_energy)
            )
            region.current_materials = max(
                0.0, min(region.current_materials + region.materials_rate, region.max_materials)
            )
