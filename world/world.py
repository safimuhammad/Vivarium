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

from core.constants import (
    HOME_BUILD_MATERIALS_COST,
    PARALYSIS_ENERGY_THRESHOLD,
    RUINS_SCAVENGE_FRACTION,
)
from core.logging import get_logger
from core.rng import Clock, SimContext, default_clock, make_rng

from .agents import AgentState, AgentStatus
from .homes import Home, HomeStatus, max_integrity
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
        homes: Map of home id -> :class:`~world.homes.Home` (Layer 1).
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
        self.homes: dict[str, Home] = {}

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
        A ``DEAD`` agent is terminal: the call early-returns without touching
        materials (mirroring :meth:`modify_agent_energy`), so a corpse can never
        hoard materials no living agent can recover.

        Args:
            agent_id: Id of the agent to modify.
            amount: Signed delta to apply (negative to spend).

        Returns:
            ``True`` if the agent exists (including the ``DEAD`` terminal no-op);
            ``False`` only if no such agent exists.
        """
        agent = self.agents.get(agent_id)
        if agent is None:
            return False
        if agent.status is AgentStatus.DEAD:
            # Death is terminal: never change a dead agent's materials.
            return True
        agent.current_materials = max(agent.current_materials + amount, 0.0)
        return True

    def kill_agent(self, agent_id: str) -> bool:
        """Mark an agent DEAD, sweep its mating proposals, and prune its homes.

        The sole death writer (Sprint 6). Sets status to DEAD and stamps ``died_at``
        with the current world clock (so the world-tick can later decay the corpse),
        then sweeps proposals:
        where the dead agent is the *initiator*, the proposal is removed and its escrow is
        abandoned (not refunded to a corpse); where the dead agent is a *target*, the
        proposal is removed and the still-live initiator's escrow is refunded immediately
        (rather than waiting for the world-tick timeout sweep). Finally (Layer 2a), for
        every home the dead agent holds a stake in it is detached via
        :meth:`remove_stakeholder` -- silent state cleanup, like the proposal sweep. Emits
        no event (the caller emits ``agent_died``).

        Mutates the agent's :attr:`~world.agents.AgentState.status` and
        :attr:`~world.agents.AgentState.died_at`, the escrow balances of any
        still-live initiators (via :meth:`modify_agent_energy` /
        :meth:`modify_agent_materials`), both :attr:`pending_proposals` and
        :attr:`pending_proposal_targets`, and, for every home the agent holds a stake in,
        removes it from the home's ``stakeholders`` -- promoting the lowest-id survivor to
        owner if it owned the home and stakeholders remain, and clamping the home's
        integrity down to the new :func:`~world.homes.max_integrity`.

        Args:
            agent_id: Id of the agent to kill.

        Returns:
            ``True`` if the agent existed (and is now DEAD); ``False`` otherwise.
        """
        if agent_id not in self.agents:
            return False
        self.agents[agent_id].status = AgentStatus.DEAD
        # Stamp time-of-death so the world-tick can decay the corpse later.
        self.agents[agent_id].died_at = self.now()
        # Initiator died: drop its proposals, abandon escrow.
        for target in list(self.get_proposed_targets(agent_id)):
            self.remove_proposal(agent_id, target)
        # Target died: refund the live initiator, drop the proposal.
        for (initiator_id, target_id), proposal in list(self.pending_proposals.items()):
            if target_id != agent_id:
                continue
            for resource_type, quantity in proposal["resources"].items():
                if resource_type is ResourceTypes.ENERGY:
                    self.modify_agent_energy(initiator_id, quantity)
                elif resource_type is ResourceTypes.MATERIALS:
                    self.modify_agent_materials(initiator_id, quantity)
            self.remove_proposal(initiator_id, target_id)
        # Prune the dead being from every home it holds a stake in (else a corpse keeps
        # propping up a fortress). remove_stakeholder promotes a surviving stakeholder to
        # owner on an owner's death and clamps integrity down to the smaller max_integrity(s).
        for home in list(self.get_all_homes()):
            if self.is_stakeholder(home.home_id, agent_id):
                self.remove_stakeholder(home.home_id, agent_id)
        return True

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

    def get_incoming_proposals(self, agent_id: str) -> list[tuple[str, dict[str, Any]]]:
        """Return the pending proposals addressed TO an agent (it is the target).

        Lets perception surface a *standing* mating offer every breath until the agent
        answers it, instead of only the one-shot ``mating_initiated`` event delivered at
        arrival (which the inbox drains immediately).

        Args:
            agent_id: The target agent id whose incoming offers to collect.

        Returns:
            A list of ``(initiator_id, proposal)`` pairs (empty if none); each
            ``proposal`` dict carries the ``"target"``, ``"timestamp"`` and
            ``"resources"`` keys recorded by :meth:`add_proposal`.
        """
        return [
            (initiator_id, proposal)
            for (initiator_id, target_id), proposal in self.pending_proposals.items()
            if target_id == agent_id
        ]

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

    # ---- Mating bookkeeping (cooldown + offspring cap) ----

    def record_mating(self, agent_id: str, when: float) -> bool:
        """Stamp an agent's last-mating time and increment its offspring count.

        Called for **both** parents on a *completed* mating (see
        :func:`tools.builtin.mating.accept_mating`). This is the sole writer of
        :attr:`~world.agents.AgentState.last_mated_at` and
        :attr:`~world.agents.AgentState.offspring_count`, keeping the explosion-guard
        bookkeeping inside ``WorldState`` per the architecture's mutation rule.

        Mutates the agent's ``last_mated_at`` (set to ``when``) and
        ``offspring_count`` (incremented by one).

        Args:
            agent_id: Id of the parent to record.
            when: World-clock time (seconds) of the completed mating, typically
                :meth:`now`.

        Returns:
            ``True`` if the agent exists and was recorded; ``False`` otherwise.
        """
        agent = self.agents.get(agent_id)
        if agent is None:
            return False
        agent.last_mated_at = when
        agent.offspring_count += 1
        return True

    def is_on_mating_cooldown(self, agent_id: str, now: float, cooldown: float) -> bool:
        """Return whether an agent mated within the last ``cooldown`` seconds.

        Pure read (no mutation). An agent that has never mated
        (``last_mated_at is None``) or that does not exist is never on cooldown.
        The boundary is exclusive: at exactly ``last_mated_at + cooldown`` the
        agent is free again.

        Args:
            agent_id: Id of the agent to check.
            now: Current world-clock time (seconds), typically :meth:`now`.
            cooldown: Cooldown window in seconds (``MATING_COOLDOWN_SECONDS``).

        Returns:
            ``True`` if the agent exists, has mated, and ``now`` is within
            ``cooldown`` seconds of its last mating; ``False`` otherwise.
        """
        agent = self.agents.get(agent_id)
        if agent is None or agent.last_mated_at is None:
            return False
        return now - agent.last_mated_at < cooldown

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

    # ---- Home methods ----

    def build_home(
        self, home_id: str, owner_id: str, region: str, *, built_at: float, integrity: float
    ) -> bool:
        """Create and store a home keyed by ``home_id``.

        Sync and event-free (the world has no bus, DD4): the caller (the
        ``build_home`` tool) publishes ``home_built``. ``last_upkeep_at`` is seeded to
        ``built_at`` so the world-tick's time-based upkeep accrues from the moment of
        building; ``last_integrity_at`` is seeded to ``built_at`` too, so the tick's
        incremental repair/decay (:data:`~core.constants.HOME_REPAIR_PER_SECOND` /
        :data:`~core.constants.HOME_DECAY_PER_SECOND`) also accrues from the moment of
        building, not from an unset clock. The builder is seeded as both
        :attr:`~world.homes.Home.owner_id` and the sole entry in
        :attr:`~world.homes.Home.stakeholders` (Layer 2 shared ownership starts as a
        one-being pool; others join later via ``pledge_home``). Mutates :attr:`homes`.

        Args:
            home_id: Stable unique id (also the map key).
            owner_id: Id of the owning being.
            region: Region the home stands in.
            built_at: World-clock time (seconds) it was raised.
            integrity: Initial integrity (typically :data:`HOME_MAX_INTEGRITY`).

        Returns:
            ``True`` if stored; ``False`` if a home with ``home_id`` already exists
            (no overwrite).
        """
        if home_id in self.homes:
            return False
        self.homes[home_id] = Home(
            home_id=home_id,
            owner_id=owner_id,
            region=region,
            integrity=integrity,
            built_at=built_at,
            last_upkeep_at=built_at,
            stakeholders=[owner_id],
            last_integrity_at=built_at,
        )
        return True

    def remove_home(self, home_id: str) -> bool:
        """Remove a home from the world. Mutates :attr:`homes`.

        Args:
            home_id: Id of the home to remove.

        Returns:
            ``True`` if it existed and was removed; ``False`` otherwise.
        """
        if home_id in self.homes:
            del self.homes[home_id]
            return True
        return False

    def modify_home_integrity(self, home_id: str, amount: float) -> bool:
        """Add ``amount`` to a home's integrity, clamped to ``[0.0, max_integrity(s)]``.

        The upper bound is the home's stakeholder-scaled ceiling
        (:func:`~world.homes.max_integrity` of ``len(stakeholders)``), so a home's soundness
        grows (with diminishing returns) as beings pledge to it and shrinks when they leave.
        Calling with ``amount=0.0`` re-clamps a home DOWN to a freshly reduced ceiling (used
        by :meth:`remove_stakeholder`). Mutates the home's :attr:`~world.homes.Home.integrity`.

        Args:
            home_id: Id of the home to modify.
            amount: Signed delta to apply.

        Returns:
            ``True`` if the home exists AND is STANDING and was modified; ``False``
            otherwise (unknown home, or a home fallen to :attr:`~world.homes.HomeStatus.RUIN` —
            a ruin's integrity is frozen, MANDATORY #4).
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        if home.status is not HomeStatus.STANDING:
            return False  # a ruin's integrity is frozen (MANDATORY #4)
        cap = max_integrity(len(home.stakeholders))
        home.integrity = min(max(home.integrity + amount, 0.0), cap)
        return True

    def home_of(self, agent_id: str) -> Home | None:
        """Return the home owned by ``agent_id`` (one per being in L1), or ``None``.

        Homes are rare, so a linear scan is free. In L1 a being owns at most one
        home; the first match is returned.

        Args:
            agent_id: Id of the owning being to look up.

        Returns:
            The owned :class:`~world.homes.Home`, or ``None`` if it owns none.
        """
        for home in self.homes.values():
            if home.owner_id == agent_id:
                return home
        return None

    def get_home(self, home_id: str) -> Home | None:
        """Look up a home by id.

        Args:
            home_id: Home id to look up.

        Returns:
            The :class:`~world.homes.Home`, or ``None`` if unknown.
        """
        return self.homes.get(home_id)

    def add_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Add ``agent_id`` as a stakeholder of a home (idempotent). Mutates :attr:`homes`.

        A being pledges into a home to share its upkeep and hearth. Idempotent: a repeat
        pledge does not double-list the being. Does NOT raise the integrity ceiling for the
        current integrity — the tick heals a paid home up to the new, larger
        :func:`~world.homes.max_integrity` over time.

        Args:
            home_id: Id of the home to join.
            agent_id: Id of the joining being.

        Returns:
            ``True`` if the home exists (whether or not it was a no-op duplicate);
            ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        if agent_id not in home.stakeholders:
            home.stakeholders.append(agent_id)
        return True

    def remove_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Remove ``agent_id`` from a home; promote a new owner if needed; clamp integrity.

        The single prune+promote+clamp primitive shared by voluntary departure
        (:func:`~tools.builtin.homes.leave_home`) and death (:meth:`kill_agent`):

        #. Remove ``agent_id`` from :attr:`~world.homes.Home.stakeholders`.
        #. If it was the ``owner_id`` and stakeholders remain, promote the lowest-id
           survivor to owner (else the home would keep a departed/dead ghost as owner).
        #. Clamp integrity DOWN to the smaller :func:`~world.homes.max_integrity` (a home
           with fewer tenders is softer), via ``modify_home_integrity(home_id, 0.0)``.

        A home whose last stakeholder is removed keeps a (now ownerless-in-practice) owner
        field but has no living payer, so the world-tick decays it to collapse (spec §6).
        Vault/structure removal on collapse is unchanged (ruins are 2c). Mutates
        :attr:`homes`.

        Args:
            home_id: Id of the home to detach from.
            agent_id: Id of the being to remove.

        Returns:
            ``True`` if the home exists and ``agent_id`` was a stakeholder that was removed;
            ``False`` if the home is unknown or ``agent_id`` was not a stakeholder.
        """
        home = self.homes.get(home_id)
        if home is None or agent_id not in home.stakeholders:
            return False
        home.stakeholders.remove(agent_id)
        if agent_id == home.owner_id and home.stakeholders:
            home.owner_id = min(home.stakeholders)
        self.modify_home_integrity(home_id, 0.0)  # re-clamp DOWN to the new, smaller ceiling
        return True

    def colonize_home(self, home_id: str, new_owner: str, new_stakeholders: list[str]) -> bool:
        """Seize a home: reassign owner+stakeholders, evict priors, retain vault/structure.

        The breach-outcome primitive (Layer 2c colonize). Overwrites
        :attr:`~world.homes.Home.owner_id` and :attr:`~world.homes.Home.stakeholders` (the
        prior owner + stakeholders are simply replaced — evicted), then re-clamps integrity to
        the new stakeholder-scaled ceiling. The vault and structure are untouched (no resource
        move -> trivially conserved); integrity stays wherever the breach left it (~0), so the
        new owners must shore it up before it collapses. The caller (the ``break_in`` tool)
        pre-filters ``new_stakeholders`` to currently-homeless co-located living breachers and
        guarantees the at-most-one-home invariant (auto-detaching a homed final striker first).
        Sync, event-free.

        Args:
            home_id: Id of the home to seize.
            new_owner: Id of the new owner (the final striker; also first in
                ``new_stakeholders``).
            new_stakeholders: The new stakeholder list (owner first), pre-filtered by the caller.

        Returns:
            ``True`` if the home exists and was reassigned; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.owner_id = new_owner
        home.stakeholders = list(new_stakeholders)
        self.modify_home_integrity(
            home_id, 0.0
        )  # re-clamp to the new ceiling (a ~0 integrity is unchanged)
        return True

    def make_ruin(self, home_id: str) -> bool:
        """Collapse a home into a scavengeable ruin. Sync, event-free.

        The sole ruin-maker, called only from the world-tick collapse path (a thieved home is left
        STANDING — MANDATORY #2 — so a split vault is never double-counted here). Computes the
        remnant as :data:`~core.constants.RUINS_SCAVENGE_FRACTION` of
        ``HOME_BUILD_MATERIALS_COST + vault_materials`` (fraction ``< 1`` — the rest is a
        permanent sink), then zeroes the vault (consumed into the remnant), clears stakeholders +
        breachers (a ruin is neither tended nor contestable), and marks it ``RUIN`` stamped with
        ``now``. Mutates :attr:`~world.homes.Home.remnant_materials` / ``vault_materials`` /
        ``stakeholders`` / ``breachers`` / ``status`` / ``ruined_at``.

        Args:
            home_id: Id of the home to ruin.

        Returns:
            ``True`` if the home exists and was ruined; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.remnant_materials = RUINS_SCAVENGE_FRACTION * (
            HOME_BUILD_MATERIALS_COST + home.vault_materials
        )
        home.vault_materials = 0.0
        home.stakeholders = []
        home.breachers.clear()
        home.status = HomeStatus.RUIN
        home.ruined_at = self.now()
        return True

    def scavenge_ruin(self, home_id: str, amount: float) -> float:
        """Draw up to ``amount`` materials from a ruin's remnant, returning the actual taken.

        Sync, event-free. The caller (the ``scavenge_ruins`` tool) credits the returned amount to
        the scavenger's personal stock (deduct-remnant-first — nothing minted). Caps the draw at
        what remains (so a ruin never goes negative). Mutates
        :attr:`~world.homes.Home.remnant_materials`.

        Args:
            home_id: Id of the ruin to draw from.
            amount: Materials the scavenger asked for.

        Returns:
            The actual materials removed from the remnant (``0.0`` for an unknown home or an
            empty ruin).
        """
        home = self.homes.get(home_id)
        if home is None:
            return 0.0
        taken = max(0.0, min(amount, home.remnant_materials))
        home.remnant_materials -= taken
        return taken

    def deposit_to_home_vault(self, home_id: str, amount: float) -> bool:
        """Add ``amount`` to a home's vault, flooring at 0.0. Sync and event-free.

        The vault is the home's shared, materials-only store (Layer 2b). This is a pure
        credit: the caller (the ``deposit_to_home`` tool) is responsible for deducting the
        matching materials from the depositor FIRST (conservation — nothing is minted). The
        world holds no bus (DD4), so no event is emitted here. Mutates the home's
        :attr:`~world.homes.Home.vault_materials`.

        Args:
            home_id: Id of the home whose vault to credit.
            amount: Materials to add (floored at 0.0 defensively).

        Returns:
            ``True`` if the home exists and was credited; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.vault_materials = max(home.vault_materials + amount, 0.0)
        return True

    def withdraw_from_home_vault(self, home_id: str, amount: float) -> bool:
        """Subtract ``amount`` from a home's vault, capped at the balance (floored at 0.0).

        Sync and event-free (DD4). A debit larger than the current balance empties the vault
        to exactly ``0.0`` rather than going negative, so the method is safe standalone; the
        caller (the ``withdraw_from_home`` tool) additionally rejects an over-request before
        crediting the withdrawer, so the amount debited here always equals the amount credited
        to personal stock (conservation — nothing is minted). Mutates the home's
        :attr:`~world.homes.Home.vault_materials`.

        Args:
            home_id: Id of the home whose vault to debit.
            amount: Materials to remove (capped at the balance; result floored at 0.0).

        Returns:
            ``True`` if the home exists and was debited; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.vault_materials = max(home.vault_materials - amount, 0.0)
        return True

    def record_breacher(self, home_id: str, agent_id: str) -> bool:
        """Record ``agent_id`` as a breacher of a home (idempotent). Sync, event-free.

        Called by the ``break_in`` tool on every attempt; the set is the pool the thieve split /
        colonize enrolment draws from (filtered to co-located + living at the breaching blow), and
        it clears on full repair (the tick) so a repelled raid resets. Mutates
        :attr:`~world.homes.Home.breachers`.

        Args:
            home_id: Id of the home being broken into.
            agent_id: Id of the raider to record.

        Returns:
            ``True`` if the home exists (whether or not it was a duplicate); ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.breachers.add(agent_id)
        return True

    def clear_breachers(self, home_id: str) -> bool:
        """Clear a home's breacher set. Sync, event-free.

        Called by the world-tick when a covered repair restores integrity to its ceiling (a
        repelled raid resets, spec Fork D) and by :meth:`make_ruin` (a ruin is not contestable).
        Mutates :attr:`~world.homes.Home.breachers`.

        Args:
            home_id: Id of the home whose breachers to clear.

        Returns:
            ``True`` if the home exists; ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.breachers.clear()
        return True

    def is_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Return whether ``agent_id`` is a stakeholder of a home (pure read).

        Args:
            home_id: Id of the home to check.
            agent_id: Id of the being to check.

        Returns:
            ``True`` if the home exists and ``agent_id`` is in its stakeholders.
        """
        home = self.homes.get(home_id)
        return home is not None and agent_id in home.stakeholders

    def stakeholder_home_of(self, agent_id: str) -> Home | None:
        """Return the home ``agent_id`` holds a stake in (owner or pledged), or ``None``.

        The stakeholder-aware counterpart to the owner-only :meth:`home_of`. Used by
        ``build_home`` and ``pledge_home`` (the shared at-most-one-home precondition),
        ``use_hearth`` (rest at the home you share), and ``leave_home`` (the home you can
        leave). A being belongs to at most one home in practice; the first match is
        returned.

        Args:
            agent_id: Id of the being to look up.

        Returns:
            The :class:`~world.homes.Home` it holds a stake in, or ``None``.
        """
        for home in self.homes.values():
            if agent_id in home.stakeholders:
                return home
        return None

    def homes_in_region(self, region: str) -> list[Home]:
        """Return every home standing in ``region`` (empty if none).

        Args:
            region: Region name to filter by.

        Returns:
            A list of homes whose ``region`` matches (a region may hold several,
            one per building being).
        """
        return [home for home in self.homes.values() if home.region == region]

    def get_all_homes(self) -> list[Home]:
        """Return every home as a list.

        Returns:
            A new list of all :class:`~world.homes.Home` instances.
        """
        return list(self.homes.values())
