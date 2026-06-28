"""Tests for :class:`world.world.WorldState`.

Two jobs:

* **Characterization** -- pin the *current* observable behavior of every
  ``WorldState`` method (success path + each failure/edge) so the production
  refactor cannot silently change it. Where the current behavior diverges from
  the design-doc rules (paralysis only at exactly ``0.0`` energy; ``modify_*``
  not capping at ``max``), the test asserts the *current* behavior and the
  divergence is reported, not fixed.
* **Determinism seam** -- prove the injected ``rng`` and ``clock`` are wired:
  same seed -> same sequence, and ``now()`` reflects the injected clock (the
  mating-proposal timestamp flows through it).
"""

from __future__ import annotations

import random

from core.rng import make_rng
from tests.conftest import FakeClock
from world.agents import AgentState, AgentStatus
from world.regions import Region, ResourceTypes
from world.world import WorldState


def make_agent(agent_id: str, position: str = "alpha") -> AgentState:
    """Build a living agent for ad-hoc use in a test."""
    return AgentState(
        id=agent_id,
        name=agent_id.title(),
        persona="Test persona.",
        current_position=position,
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )


# ---------------------------------------------------------------------------
# Construction & determinism seam
# ---------------------------------------------------------------------------


def test_empty_construction() -> None:
    """No-arg construction yields empty maps and a usable seam."""
    world = WorldState()
    assert world.get_all_regions() == []
    assert world.get_all_agents() == []
    assert world.pending_proposals == {}
    assert world.pending_proposal_targets == {}
    assert isinstance(world.rng, random.Random)
    assert world.now() > 0.0  # default wall clock


def test_positional_construction_backward_compatible(
    regions: list[Region], agents: list[AgentState]
) -> None:
    """``WorldState(regions, agents)`` still works (config loader contract)."""
    world = WorldState(regions, agents)
    assert {r.name for r in world.get_all_regions()} == {"alpha", "beta"}
    assert {a.id for a in world.get_all_agents()} == {"wanderer_001", "wanderer_002"}


def test_world_exposes_injected_rng() -> None:
    """The exact ``rng`` instance passed in is exposed as ``world.rng``."""
    injected = make_rng(99)
    world = WorldState(rng=injected)
    assert world.rng is injected


def test_same_seed_same_rng_sequence(seed: int) -> None:
    """Same seed -> identical sequence drawn through the world's rng."""
    world_a = WorldState(rng=make_rng(seed))
    world_b = WorldState(rng=make_rng(seed))
    seq_a = [world_a.rng.random() for _ in range(5)]
    seq_b = [world_b.rng.random() for _ in range(5)]
    assert seq_a == seq_b


def test_now_reflects_injected_clock() -> None:
    """``now()`` returns the injected clock's value and tracks it as it advances."""
    clock = FakeClock(start=500.0)
    world = WorldState(clock=clock)
    assert world.now() == 500.0
    clock.advance(42.0)
    assert world.now() == 542.0


# ---------------------------------------------------------------------------
# Get methods
# ---------------------------------------------------------------------------


def test_get_all_regions_and_agents(world: WorldState) -> None:
    """Getters return every region/agent as a list."""
    assert len(world.get_all_regions()) == 2
    assert len(world.get_all_agents()) == 2


def test_get_region_found_and_missing(world: WorldState) -> None:
    """``get_region`` returns the region or ``None`` when absent."""
    region = world.get_region("alpha")
    assert region is not None
    assert region.name == "alpha"
    assert world.get_region("nowhere") is None


def test_get_agent_found_and_missing(world: WorldState) -> None:
    """``get_agent`` returns the agent or ``None`` when absent."""
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.name == "Ada"
    assert world.get_agent("ghost") is None


def test_get_agents_in_region(world: WorldState) -> None:
    """Returns exactly the agents whose position matches; empty otherwise."""
    in_alpha = world.get_agents_in_region("alpha")
    assert {a.id for a in in_alpha} == {"wanderer_001", "wanderer_002"}
    assert world.get_agents_in_region("beta") == []
    assert world.get_agents_in_region("nowhere") == []


# ---------------------------------------------------------------------------
# Agent add / remove
# ---------------------------------------------------------------------------


def test_add_agent_success_and_duplicate(world: WorldState) -> None:
    """Adding a new agent succeeds; adding a duplicate id fails."""
    newcomer = make_agent("wanderer_003")
    assert world.add_agent(newcomer) is True
    assert world.get_agent("wanderer_003") is newcomer
    assert world.add_agent(newcomer) is False


def test_remove_agent_success_and_missing(world: WorldState) -> None:
    """Removing a present agent succeeds; removing an absent one fails."""
    present = world.get_agent("wanderer_001")
    assert present is not None
    assert world.remove_agent(present) is True
    assert world.get_agent("wanderer_001") is None
    assert world.remove_agent(present) is False


# ---------------------------------------------------------------------------
# move_agent
# ---------------------------------------------------------------------------


def test_move_agent_to_adjacent_region(world: WorldState) -> None:
    """Moving to a connected region succeeds and updates position."""
    assert world.move_agent("wanderer_001", "beta") is True
    moved = world.get_agent("wanderer_001")
    assert moved is not None
    assert moved.current_position == "beta"


def test_move_agent_to_non_adjacent_region(world: WorldState) -> None:
    """Moving to an existing but non-connected region fails; position unchanged."""
    world.add_region(
        Region(
            name="gamma",
            description="An island.",
            connections=[],
            energy_rate=1.0,
            materials_rate=1.0,
            current_energy=10.0,
            current_materials=10.0,
            max_energy=100.0,
            max_materials=100.0,
        )
    )
    assert world.move_agent("wanderer_001", "gamma") is False
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_position == "alpha"


def test_move_agent_unknown_agent(world: WorldState) -> None:
    """Moving a missing agent fails."""
    assert world.move_agent("ghost", "beta") is False


def test_move_agent_unknown_destination(world: WorldState) -> None:
    """Moving to a non-existent destination fails; position unchanged."""
    assert world.move_agent("wanderer_001", "nowhere") is False
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_position == "alpha"


# ---------------------------------------------------------------------------
# update_agent_status
# ---------------------------------------------------------------------------


def test_update_agent_status_success_and_missing(world: WorldState) -> None:
    """Updating a present agent's status succeeds; a missing agent fails."""
    assert world.update_agent_status("wanderer_001", AgentStatus.DEAD) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.status is AgentStatus.DEAD
    assert world.update_agent_status("ghost", AgentStatus.DEAD) is False


# ---------------------------------------------------------------------------
# modify_agent_energy
# ---------------------------------------------------------------------------


def test_modify_agent_energy_add_and_subtract(world: WorldState) -> None:
    """Positive and negative deltas adjust energy."""
    assert world.modify_agent_energy("wanderer_001", 25.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == 125.0
    assert world.modify_agent_energy("wanderer_001", -50.0) is True
    assert agent.current_energy == 75.0


def test_modify_agent_energy_floors_at_zero_and_paralyzes(world: WorldState) -> None:
    """Energy floors at 0.0 and reaching exactly 0.0 sets PARALYZED."""
    assert world.modify_agent_energy("wanderer_001", -500.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == 0.0
    assert agent.status is AgentStatus.PARALYZED


def test_modify_agent_energy_above_zero_stays_alive(world: WorldState) -> None:
    """Characterization: dropping to 5.0 (>0) does NOT paralyze.

    DIVERGENCE: the design doc paralyses at <= 5.0 energy, but the current code
    only paralyses at exactly 0.0. This pins the *current* behavior.
    """
    assert world.modify_agent_energy("wanderer_001", -95.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == 5.0
    assert agent.status is AgentStatus.ALIVE


def test_modify_agent_energy_missing_agent(world: WorldState) -> None:
    """Modifying a missing agent's energy fails."""
    assert world.modify_agent_energy("ghost", 10.0) is False


# ---------------------------------------------------------------------------
# modify_agent_materials
# ---------------------------------------------------------------------------


def test_modify_agent_materials_add_and_floor(world: WorldState) -> None:
    """Positive delta adds; over-subtraction floors at 0.0."""
    assert world.modify_agent_materials("wanderer_001", 10.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_materials == 60.0
    assert world.modify_agent_materials("wanderer_001", -1000.0) is True
    assert agent.current_materials == 0.0


def test_modify_agent_materials_missing_agent(world: WorldState) -> None:
    """Modifying a missing agent's materials fails."""
    assert world.modify_agent_materials("ghost", 10.0) is False


# ---------------------------------------------------------------------------
# Mating proposals
# ---------------------------------------------------------------------------


def test_add_proposal_success(world: WorldState) -> None:
    """A proposal between two existing agents is stored with clock timestamp."""
    resources: dict[ResourceTypes, float] = {ResourceTypes.ENERGY: 10.0}
    assert world.add_proposal("wanderer_001", "wanderer_002", resources) is True
    proposal = world.get_agent_proposals("wanderer_001", "wanderer_002")
    assert proposal["target"] == "wanderer_002"
    assert proposal["resources"] == resources
    assert proposal["timestamp"] == world.now()
    assert world.get_proposed_targets("wanderer_001") == ["wanderer_002"]


def test_add_proposal_missing_initiator(world: WorldState) -> None:
    """A proposal from an unknown initiator fails."""
    assert world.add_proposal("ghost", "wanderer_002", {}) is False


def test_add_proposal_missing_target(world: WorldState) -> None:
    """A proposal to an unknown target fails."""
    assert world.add_proposal("wanderer_001", "ghost", {}) is False


def test_get_agent_proposals_none(world: WorldState) -> None:
    """Querying a non-existent proposal returns an empty dict."""
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}


def test_get_proposed_targets_none(world: WorldState) -> None:
    """Querying targets for an agent with no proposals returns an empty list."""
    assert world.get_proposed_targets("wanderer_001") == []


def test_remove_proposal_success(world: WorldState) -> None:
    """Removing an existing proposal clears both lookup structures."""
    world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 1.0})
    assert world.remove_proposal("wanderer_001", "wanderer_002") is True
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert world.get_proposed_targets("wanderer_001") == []


def test_remove_proposal_missing(world: WorldState) -> None:
    """Removing a non-existent proposal fails."""
    assert world.remove_proposal("wanderer_001", "wanderer_002") is False


# ---------------------------------------------------------------------------
# Region add / modify
# ---------------------------------------------------------------------------


def test_add_region_success_and_duplicate(world: WorldState) -> None:
    """Adding a new region succeeds; a duplicate name fails."""
    gamma = Region(
        name="gamma",
        description="A new place.",
        connections=["alpha"],
        energy_rate=1.0,
        materials_rate=1.0,
        current_energy=10.0,
        current_materials=10.0,
        max_energy=100.0,
        max_materials=100.0,
    )
    assert world.add_region(gamma) is True
    assert world.get_region("gamma") is gamma
    assert world.add_region(gamma) is False


def test_modify_region_energy_add_and_floor(world: WorldState) -> None:
    """Positive delta adds; over-subtraction floors at 0.0."""
    assert world.modify_region_energy("alpha", 50.0) is True
    region = world.get_region("alpha")
    assert region is not None
    assert region.current_energy == 150.0
    assert world.modify_region_energy("alpha", -1000.0) is True
    assert region.current_energy == 0.0


def test_modify_region_energy_does_not_cap_at_max(world: WorldState) -> None:
    """Characterization: ``modify_region_energy`` does NOT cap at ``max_energy``.

    DIVERGENCE: ``regenerate_resources`` caps at ``max_energy``, but the direct
    ``modify_region_energy`` mutator only floors at 0.0 and lets energy exceed
    ``max_energy``. This pins the *current* (uncapped) behavior.
    """
    assert world.modify_region_energy("alpha", 1000.0) is True
    region = world.get_region("alpha")
    assert region is not None
    assert region.max_energy == 500.0
    assert region.current_energy == 1100.0


def test_modify_region_energy_missing(world: WorldState) -> None:
    """Modifying a missing region's energy fails."""
    assert world.modify_region_energy("nowhere", 10.0) is False


def test_modify_region_materials_add_and_floor(world: WorldState) -> None:
    """Positive delta adds; over-subtraction floors at 0.0."""
    assert world.modify_region_materials("alpha", 25.0) is True
    region = world.get_region("alpha")
    assert region is not None
    assert region.current_materials == 125.0
    assert world.modify_region_materials("alpha", -1000.0) is True
    assert region.current_materials == 0.0


def test_modify_region_materials_missing(world: WorldState) -> None:
    """Modifying a missing region's materials fails."""
    assert world.modify_region_materials("nowhere", 10.0) is False


# ---------------------------------------------------------------------------
# regenerate_resources
# ---------------------------------------------------------------------------


def test_regenerate_resources_increments_by_rate(world: WorldState) -> None:
    """Each region gains its per-tick rate of energy and materials."""
    world.regenerate_resources()
    alpha = world.get_region("alpha")
    beta = world.get_region("beta")
    assert alpha is not None and beta is not None
    # alpha: rates 1.0/1.0 from 100.0/100.0
    assert alpha.current_energy == 101.0
    assert alpha.current_materials == 101.0
    # beta: rates 2.0/0.5 from 200.0/50.0
    assert beta.current_energy == 202.0
    assert beta.current_materials == 50.5


def test_regenerate_resources_caps_at_max(world: WorldState) -> None:
    """Characterization: regeneration caps at ``max_energy``/``max_materials``.

    Confirms the current code DOES cap on regen (matches spec Section 5.2).
    """
    alpha = world.get_region("alpha")
    assert alpha is not None
    alpha.current_energy = 499.5  # rate 1.0 -> would reach 500.5
    alpha.current_materials = 499.8  # rate 1.0 -> would reach 500.8
    world.regenerate_resources()
    assert alpha.current_energy == 500.0
    assert alpha.current_materials == 500.0
