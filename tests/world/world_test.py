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

import pytest

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


def test_move_agent_from_unknown_current_region_returns_false(world: WorldState) -> None:
    """An agent stranded at an unknown position fails to move gracefully (no KeyError).

    Config validation makes this unreachable from a loaded world, but defends the
    forever-run against any code path that mispositions an agent at runtime.
    """
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    agent.current_position = "void"  # corrupted/unknown position
    assert world.move_agent("wanderer_001", "beta") is False  # must not raise


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


def test_modify_agent_energy_drain_to_zero_paralyzes_never_dead(world: WorldState) -> None:
    """Energy floors at 0.0 and reaching exactly 0.0 sets PARALYZED (never DEAD)."""
    assert world.modify_agent_energy("wanderer_001", -500.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == 0.0
    assert agent.status is not AgentStatus.DEAD  # death is Sprint 6, never here
    assert agent.status is AgentStatus.PARALYZED


def test_modify_agent_energy_paralyzes_on_or_below_threshold(world: WorldState) -> None:
    """At or below ``PARALYSIS_ENERGY_THRESHOLD`` (5.0) an ALIVE agent paralyses.

    The boundary is inclusive: exactly 5.0 paralyses, and anything below (3.0)
    paralyses too. ``modify_agent_energy`` is the sole ALIVE<->PARALYZED writer.
    """
    # 100.0 - 95.0 = 5.0 (exactly the threshold) -> PARALYZED.
    assert world.modify_agent_energy("wanderer_001", -95.0) is True
    at_threshold = world.get_agent("wanderer_001")
    assert at_threshold is not None
    assert at_threshold.current_energy == 5.0
    assert at_threshold.status is AgentStatus.PARALYZED

    # A fresh agent dropped to 3.0 (below the threshold) -> PARALYZED.
    assert world.modify_agent_energy("wanderer_002", -97.0) is True
    below_threshold = world.get_agent("wanderer_002")
    assert below_threshold is not None
    assert below_threshold.current_energy == 3.0
    assert below_threshold.status is AgentStatus.PARALYZED


def test_modify_agent_energy_just_above_threshold_stays_alive(world: WorldState) -> None:
    """Energy just above the threshold (5.01) leaves the agent ALIVE."""
    assert world.modify_agent_energy("wanderer_001", -94.99) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == pytest.approx(5.01)  # > 5.0 threshold
    assert agent.status is AgentStatus.ALIVE


def test_modify_agent_energy_revives_only_above_threshold(world: WorldState) -> None:
    """A PARALYZED agent revives to ALIVE only when fed strictly above threshold."""
    # Drain to 0.0 -> PARALYZED. (Re-fetch after each mutation so the status read
    # reflects the post-mutation state, not a narrowed earlier assertion.)
    assert world.modify_agent_energy("wanderer_001", -100.0) is True
    drained = world.get_agent("wanderer_001")
    assert drained is not None
    assert drained.status is AgentStatus.PARALYZED

    # Feed back up to exactly the threshold (5.0): NOT enough to revive.
    assert world.modify_agent_energy("wanderer_001", 5.0) is True
    at_threshold = world.get_agent("wanderer_001")
    assert at_threshold is not None
    assert at_threshold.current_energy == 5.0
    assert at_threshold.status is AgentStatus.PARALYZED

    # One more sip past the threshold revives the agent.
    assert world.modify_agent_energy("wanderer_001", 0.5) is True
    revived = world.get_agent("wanderer_001")
    assert revived is not None
    assert revived.current_energy == 5.5
    assert revived.status is AgentStatus.ALIVE


def test_modify_agent_energy_dead_is_terminal_no_resurrection(world: WorldState) -> None:
    """A DEAD agent is terminal: energy is never changed and status never flips.

    Guards the Sprint-6 death writer against accidental resurrection by the
    energy mutator.
    """
    assert world.update_agent_status("wanderer_001", AgentStatus.DEAD) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    energy_before = agent.current_energy
    # The agent exists, so the call is "handled" (True), but it is a no-op.
    assert world.modify_agent_energy("wanderer_001", 1000.0) is True
    assert agent.current_energy == energy_before  # unchanged
    assert agent.status is AgentStatus.DEAD  # never resurrected


def test_modify_agent_energy_missing_agent(world: WorldState) -> None:
    """Modifying a missing agent's energy fails."""
    assert world.modify_agent_energy("ghost", 10.0) is False


def test_modify_agent_energy_is_not_capped(world: WorldState) -> None:
    """Agents have no max energy: a large credit is NOT capped (DD8).

    Capping agent energy would clip mating-escrow refunds; only regions cap.
    """
    assert world.modify_agent_energy("wanderer_001", 10_000.0) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.current_energy == 10_100.0


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


def test_modify_agent_materials_dead_is_terminal(world: WorldState) -> None:
    """A DEAD agent is terminal: materials are never changed (mirrors energy).

    Defense-in-depth so a corpse can never hoard materials no one can recover.
    """
    assert world.update_agent_status("wanderer_001", AgentStatus.DEAD) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    materials_before = agent.current_materials
    # The agent exists, so the call is "handled" (True), but it is a no-op.
    assert world.modify_agent_materials("wanderer_001", 1000.0) is True
    assert agent.current_materials == materials_before  # unchanged


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


def test_get_incoming_proposals_none(world: WorldState) -> None:
    """An agent with no offers addressed to it gets an empty list."""
    assert world.get_incoming_proposals("wanderer_002") == []


def test_get_incoming_proposals_returns_offers_to_target(world: WorldState) -> None:
    """Proposals where the agent is the target are returned with initiator + payload."""
    world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 50.0})
    incoming = world.get_incoming_proposals("wanderer_002")
    assert len(incoming) == 1
    initiator_id, proposal = incoming[0]
    assert initiator_id == "wanderer_001"
    assert proposal["resources"] == {ResourceTypes.ENERGY: 50.0}
    # The initiator does not see it as incoming (they are the proposer, not the target).
    assert world.get_incoming_proposals("wanderer_001") == []


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
# Mating bookkeeping (cooldown + offspring count)
# ---------------------------------------------------------------------------


def test_agent_starts_with_clean_mating_bookkeeping(world: WorldState) -> None:
    """A fresh agent has never mated and has no offspring (the field defaults)."""
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.last_mated_at is None
    assert agent.offspring_count == 0


def test_record_mating_stamps_time_and_increments_count(world: WorldState) -> None:
    """``record_mating`` stamps the mating time and bumps the offspring count."""
    assert world.record_mating("wanderer_001", world.now()) is True
    agent = world.get_agent("wanderer_001")
    assert agent is not None
    assert agent.last_mated_at == world.now()
    assert agent.offspring_count == 1
    # A second mating increments again from the same agent.
    assert world.record_mating("wanderer_001", world.now() + 5.0) is True
    assert agent.last_mated_at == world.now() + 5.0
    assert agent.offspring_count == 2


def test_record_mating_missing_agent_returns_false(world: WorldState) -> None:
    """Recording a mating for an unknown agent fails without side effects."""
    assert world.record_mating("ghost", world.now()) is False


def test_is_on_mating_cooldown_never_mated_is_false(world: WorldState) -> None:
    """An agent that has never mated is never on cooldown."""
    assert world.is_on_mating_cooldown("wanderer_001", world.now(), 300.0) is False


def test_is_on_mating_cooldown_just_mated_is_true(world: WorldState) -> None:
    """An agent that just mated is on cooldown for the configured window."""
    world.record_mating("wanderer_001", world.now())
    assert world.is_on_mating_cooldown("wanderer_001", world.now(), 300.0) is True


def test_is_on_mating_cooldown_expires_after_window(
    world: WorldState, fake_clock: FakeClock
) -> None:
    """Cooldown clears once more than the window has elapsed since the last mating."""
    mated_at = world.now()
    world.record_mating("wanderer_001", mated_at)
    fake_clock.advance(300.1)  # just past the 300s window
    assert world.is_on_mating_cooldown("wanderer_001", world.now(), 300.0) is False


def test_is_on_mating_cooldown_at_exact_boundary_is_false(world: WorldState) -> None:
    """At exactly the window boundary the agent is free to mate again (inclusive edge)."""
    mated_at = world.now()
    world.record_mating("wanderer_001", mated_at)
    assert world.is_on_mating_cooldown("wanderer_001", mated_at + 300.0, 300.0) is False


def test_is_on_mating_cooldown_missing_agent_is_false(world: WorldState) -> None:
    """An unknown agent is treated as not on cooldown (no record to gate on)."""
    assert world.is_on_mating_cooldown("ghost", world.now(), 300.0) is False


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


def test_modify_region_energy_caps_at_max(world: WorldState) -> None:
    """``modify_region_energy`` caps at ``max_energy`` (DD8).

    Regions are bounded above; a credit that would exceed ``max_energy`` is
    clamped to it (unlike agents, which are floor-only).
    """
    assert world.modify_region_energy("alpha", 1000.0) is True
    region = world.get_region("alpha")
    assert region is not None
    assert region.max_energy == 500.0
    assert region.current_energy == 500.0  # capped, not 1100.0


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


def test_modify_region_materials_caps_at_max(world: WorldState) -> None:
    """``modify_region_materials`` caps at ``max_materials`` (DD8)."""
    assert world.modify_region_materials("alpha", 1000.0) is True
    region = world.get_region("alpha")
    assert region is not None
    assert region.max_materials == 500.0
    assert region.current_materials == 500.0  # capped, not 1100.0


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


def test_regenerate_resources_floors_at_zero(world: WorldState) -> None:
    """Defense-in-depth: a (config-forbidden) negative rate can't push a pool < 0.

    Config validation rejects negative rates at load, but the live mutation floors
    at 0.0 so no runtime path can drift a pool negative over a forever-run.
    """
    alpha = world.get_region("alpha")
    assert alpha is not None
    alpha.current_energy = 1.0
    alpha.energy_rate = -10.0  # bypass the config boundary, simulate corruption
    world.regenerate_resources()
    assert alpha.current_energy == 0.0  # floored, not -9.0


# ---------------------------------------------------------------------------
# kill_agent (Sprint 6 — single death writer + escrow cleanup)
# ---------------------------------------------------------------------------


def test_kill_agent_sets_dead(world: WorldState) -> None:
    """Killing an existing agent sets DEAD and returns True; a missing one False."""
    assert world.kill_agent("wanderer_001") is True
    dead = world.get_agent("wanderer_001")
    assert dead is not None and dead.status is AgentStatus.DEAD
    assert world.kill_agent("nope") is False


def test_kill_initiator_abandons_escrow_and_removes_proposal(world: WorldState) -> None:
    """Killing a proposal initiator drops the proposal and abandons its escrow."""
    world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 50.0})
    target = world.get_agent("wanderer_002")
    assert target is not None
    before = target.current_energy
    world.kill_agent("wanderer_001")
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert "wanderer_002" not in world.get_proposed_targets("wanderer_001")
    assert target.current_energy == before  # nobody refunded


def test_kill_target_refunds_live_initiator(world: WorldState) -> None:
    """Killing a proposal target drops the proposal and refunds the live initiator."""
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    world.add_proposal(
        "wanderer_001",
        "wanderer_002",
        {ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0},
    )
    e0, m0 = initiator.current_energy, initiator.current_materials
    world.kill_agent("wanderer_002")  # target dies -> live initiator refunded
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert initiator.current_energy == e0 + 50.0
    assert initiator.current_materials == m0 + 30.0
