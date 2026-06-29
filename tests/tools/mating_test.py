"""Tests for :mod:`tools.builtin.mating` -- the proposal/escrow lifecycle.

Mating is a two-step escrow:

* ``initiate_mating`` -- the initiator commits resources (deducted up front) and
  a pending proposal is stored; a TARGETED event notifies the target.
* ``reject_mating`` -- the committed resources are refunded to the initiator and
  the proposal is removed.
* ``accept_mating`` -- the acceptor commits the *same* resources, both
  contributions are consumed, and an offspring agent is spawned (inheriting
  ``committed * MATING_OFFSPRING_MULTIPLIER`` of each resource and both personas).

The final test pins determinism: the offspring id and Faker name route through
``world.rng``, so the same seed reproduces the same offspring identity.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    AGENT_ID_CATEGORIES,
    MATING_COOLDOWN_SECONDS,
    MATING_MAX_OFFSPRING,
    MATING_OFFSPRING_MULTIPLIER,
)
from core.rng import make_rng
from tests.conftest import SEED, FakeClock
from tools.builtin.mating import accept_mating, initiate_mating, reject_mating
from world.agents import AgentState, AgentStatus
from world.regions import Region, ResourceTypes
from world.world import WorldState

# A commitment that meets both design-doc minimums (>=50 energy AND >=30 materials);
# the agents fixture (100 energy / 50 materials) can afford it.
_VALID_COMMIT: dict[ResourceTypes, float] = {
    ResourceTypes.ENERGY: 50.0,
    ResourceTypes.MATERIALS: 30.0,
}


def _spawned_offspring(world: WorldState, parent_ids: set[str]) -> AgentState:
    """Return the single agent that is not one of ``parent_ids``."""
    extras = [agent for agent in world.get_all_agents() if agent.id not in parent_ids]
    assert len(extras) == 1, f"expected exactly one offspring, found {len(extras)}"
    return extras[0]


# ---- initiate_mating ------------------------------------------------------


async def test_initiate_deducts_resources_and_stores_proposal(
    world: WorldState, event_bus: EventBus
) -> None:
    """Initiating commits resources up front and records a pending proposal."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )

    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 50.0  # 100 - 50 committed
    assert initiator.current_materials == 20.0  # 50 - 30 committed

    proposal = world.get_agent_proposals("wanderer_001", "wanderer_002")
    assert proposal.get("resources") == {
        ResourceTypes.ENERGY: 50.0,
        ResourceTypes.MATERIALS: 30.0,
    }
    assert proposal.get("timestamp") == world.now()
    assert world.get_proposed_targets("wanderer_001") == ["wanderer_002"]

    inbox = event_bus.get_events("wanderer_002")
    assert len(inbox) == 1
    assert inbox[0].type == "mating_initiated"
    assert inbox[0].source == "wanderer_001"
    assert inbox[0].scope is ScopeType.TARGETED
    assert inbox[0].target == "wanderer_002"
    assert inbox[0].timestamp == world.now()
    assert result.startswith("Successfully sent the mating request")


async def test_initiate_over_commit_returns_error_no_effect(
    world: WorldState, event_bus: EventBus
) -> None:
    """Committing more than held yields ``Error:`` with nothing deducted/stored.

    The commitment meets the minimums (so it passes the minimums gate) but over-commits
    energy, so the *balance* check — which runs after minimums — is what rejects it.
    """
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 9999.0, ResourceTypes.MATERIALS: 30.0},
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # untouched
    assert initiator.current_materials == 50.0  # untouched
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_002") == []


async def test_initiate_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown target yields an ``Error:`` string, no proposal."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="ghost",
        message="hi",
        resources={ResourceTypes.ENERGY: 10.0},
    )
    assert result.startswith("Error:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0


async def test_initiate_over_commit_materials_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """Committing more materials than held yields ``Error:`` (materials balance branch).

    Energy meets its minimum so the minimums gate passes; the over-committed materials
    trip the balance check.
    """
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 9999.0},
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_materials == 50.0  # untouched
    assert initiator.current_energy == 100.0  # untouched (balance fails before deduction)
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert result.startswith("Error:")


async def test_initiate_non_dict_resources_returns_error_no_effect(
    world: WorldState, event_bus: EventBus
) -> None:
    """A non-dict ``resources`` (model sent a string/list) is a clean Error, no crash."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources="energy:50",  # type: ignore[arg-type]  # malformed model output
    )
    assert result.startswith("Error:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # untouched
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}


async def test_initiate_negative_amount_returns_invalid_no_free_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """A negative commitment must not become free energy for the initiator."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: -50.0},
    )
    assert result.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # no free energy
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}


async def test_initiate_duplicate_proposal_returns_invalid_no_double_deduct(
    world: WorldState, event_bus: EventBus
) -> None:
    """A second proposal to the same target must not double-deduct or ghost a target."""
    committed = dict(_VALID_COMMIT)
    first = await initiate_mating(
        world, event_bus, "wanderer_001", target="wanderer_002", message="1", resources=committed
    )
    assert first.startswith("Successfully")
    second = await initiate_mating(
        world, event_bus, "wanderer_001", target="wanderer_002", message="2", resources=committed
    )
    assert second.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 50.0  # deducted once, not twice
    assert world.get_proposed_targets("wanderer_001") == ["wanderer_002"]  # no phantom entry


async def test_initiate_single_resource_rejected_by_minimums(
    world: WorldState, event_bus: EventBus
) -> None:
    """A single-type commitment can't meet BOTH minimums, so it's rejected (no escrow).

    (Previously this exercised the single-resource accept path; with the minimums
    enforced a one-type proposal can never be stored, so the rejection is the behaviour
    worth pinning.)
    """
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 60.0},  # energy only -> 0 materials < 30
    )
    assert result.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # nothing deducted
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert event_bus.get_events("wanderer_002") == []


# ---- reject_mating --------------------------------------------------------


async def test_reject_refunds_initiator_and_removes_proposal(
    world: WorldState, event_bus: EventBus
) -> None:
    """Rejecting refunds the committed resources and clears the proposal."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    event_bus.get_events("wanderer_002")  # drain the initiate event

    result = await reject_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="no thanks"
    )

    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 100.0  # refunded
    assert initiator.current_materials == 50.0  # refunded
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert world.get_proposed_targets("wanderer_001") == []

    inbox = event_bus.get_events("wanderer_001")  # rejection notifies the initiator
    assert len(inbox) == 1
    assert inbox[0].type == "mating_rejected"
    assert inbox[0].scope is ScopeType.TARGETED
    assert inbox[0].target == "wanderer_001"
    assert result.startswith("Rejection successful")


async def test_reject_without_proposal_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """Rejecting when there is no pending proposal yields an ``Error:``."""
    result = await reject_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="no"
    )
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_001") == []


async def test_reject_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown party in a rejection yields an ``Error:``."""
    result = await reject_mating(world, event_bus, "wanderer_002", target="ghost", message="no")
    assert result.startswith("Error:")


# ---- accept_mating --------------------------------------------------------


async def test_accept_consumes_both_contributions_and_spawns_offspring(
    world: WorldState, event_bus: EventBus
) -> None:
    """Accepting consumes both parents' resources and births an offspring."""
    committed = dict(_VALID_COMMIT)
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=committed,
    )
    event_bus.get_events("wanderer_002")  # drain initiate event

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes!"
    )

    initiator = world.get_agent("wanderer_001")
    acceptor = world.get_agent("wanderer_002")
    assert initiator is not None and acceptor is not None
    # Initiator was charged at initiate; acceptor is charged now (50 energy, 30 materials each).
    assert initiator.current_energy == 50.0 and initiator.current_materials == 20.0
    assert acceptor.current_energy == 50.0 and acceptor.current_materials == 20.0

    offspring = _spawned_offspring(world, {"wanderer_001", "wanderer_002"})
    assert offspring.current_energy == 50.0 * MATING_OFFSPRING_MULTIPLIER  # 80.0
    assert offspring.current_materials == 30.0 * MATING_OFFSPRING_MULTIPLIER  # 48.0
    assert offspring.current_position == acceptor.current_position  # born at acceptor
    assert offspring.status is AgentStatus.ALIVE
    assert offspring.persona == f"{initiator.persona}|{acceptor.persona}"
    category, _, suffix = offspring.id.partition("_")
    assert category in AGENT_ID_CATEGORIES
    assert len(suffix) == 4

    # Proposal cleared; offspring birth broadcast LOCAL to the birth region.
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    born = event_bus.get_events("wanderer_001")
    assert len(born) == 1
    assert born[0].type == "agent_born"
    assert born[0].scope is ScopeType.LOCAL
    assert born[0].source == offspring.id
    assert born[0].timestamp == world.now()
    assert result.startswith("Successfully accepted mating")


async def test_accept_without_proposal_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """Accepting a non-existent proposal yields an ``Error:`` and no offspring."""
    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Error:")
    assert len(world.get_all_agents()) == 2  # no offspring spawned


async def test_accept_with_insufficient_resources_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """The acceptor must be able to match the commitment; otherwise ``Error:``."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    event_bus.get_events("wanderer_002")
    world.modify_agent_energy("wanderer_002", -96.0)  # 100 -> 4, below the 50 needed

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Error:")
    assert len(world.get_all_agents()) == 2  # no offspring
    # Proposal survives so it can still be accepted later or refunded on reject.
    assert world.get_agent_proposals("wanderer_001", "wanderer_002").get("resources")


async def test_accept_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown party in an acceptance yields an ``Error:``."""
    result = await accept_mating(world, event_bus, "wanderer_002", target="ghost", message="yes")
    assert result.startswith("Error:")


async def test_accept_with_insufficient_materials_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """The acceptor must match committed materials too (materials branch)."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    world.modify_agent_materials("wanderer_002", -45.0)  # 50 -> 5, below the 30 needed

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Error:")
    assert len(world.get_all_agents()) == 2  # no offspring
    assert world.get_agent_proposals("wanderer_001", "wanderer_002").get("resources")


# ---- determinism ----------------------------------------------------------


async def test_offspring_identity_is_reproducible_for_same_seed() -> None:
    """Same seed -> identical offspring id and Faker name (randomness via world.rng)."""

    def build() -> WorldState:
        regions = [
            Region(
                name="alpha",
                description="A",
                connections=[],
                energy_rate=1.0,
                materials_rate=1.0,
                current_energy=100.0,
                current_materials=100.0,
                max_energy=500.0,
                max_materials=500.0,
            )
        ]
        agents = [
            AgentState(
                id="parent_a",
                name="ParentA",
                persona="pa",
                current_position="alpha",
                current_energy=100.0,
                current_materials=100.0,
                status=AgentStatus.ALIVE,
            ),
            AgentState(
                id="parent_b",
                name="ParentB",
                persona="pb",
                current_position="alpha",
                current_energy=100.0,
                current_materials=100.0,
                status=AgentStatus.ALIVE,
            ),
        ]
        return WorldState(regions, agents, rng=make_rng(SEED), clock=FakeClock())

    async def run(world: WorldState) -> AgentState:
        bus = EventBus(world)
        for agent in world.get_all_agents():
            bus.subscribe(agent.id)
        committed = {ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0}
        await initiate_mating(
            world, bus, "parent_a", target="parent_b", message="m", resources=committed
        )
        await accept_mating(world, bus, "parent_b", target="parent_a", message="y")
        return _spawned_offspring(world, {"parent_a", "parent_b"})

    first = await run(build())
    second = await run(build())
    assert first.id == second.id
    assert first.name == second.name


# ---- explosion guard: minimums / cooldown / offspring cap ------------------


async def test_initiate_below_energy_minimum_rejected(
    world: WorldState, event_bus: EventBus
) -> None:
    """Committing below the energy minimum is rejected with no escrow or event."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 40.0, ResourceTypes.MATERIALS: 30.0},  # energy < 50
    )
    assert result.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 100.0 and initiator.current_materials == 50.0  # untouched
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert event_bus.get_events("wanderer_002") == []


async def test_initiate_below_materials_minimum_rejected(
    world: WorldState, event_bus: EventBus
) -> None:
    """Committing below the materials minimum is rejected with no escrow or event."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 20.0},  # materials < 30
    )
    assert result.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 100.0 and initiator.current_materials == 50.0  # untouched
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}


async def test_initiate_on_cooldown_rejected(world: WorldState, event_bus: EventBus) -> None:
    """An agent that just mated cannot initiate again until the cooldown clears."""
    world.record_mating("wanderer_001", world.now())  # just mated
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    assert result.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # no escrow taken
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}


async def test_initiate_at_offspring_cap_rejected(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """An agent at the offspring cap cannot initiate, even once its cooldown has cleared."""
    for _ in range(MATING_MAX_OFFSPRING):
        world.record_mating("wanderer_001", world.now())
    fake_clock.advance(MATING_COOLDOWN_SECONDS + 1.0)  # clear cooldown so the CAP is the gate
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    assert result.startswith("Invalid:")
    assert "offspring" in result.lower()  # the cap message, not the cooldown one
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # no escrow taken


async def test_accept_acceptor_on_cooldown_rejected_proposal_survives(
    world: WorldState, event_bus: EventBus
) -> None:
    """An acceptor on cooldown is refused; the proposal (and its escrow) survive."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    world.record_mating("wanderer_002", world.now())  # acceptor recently mated elsewhere

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Invalid:")
    assert len(world.get_all_agents()) == 2  # no offspring
    acceptor = world.get_agent("wanderer_002")
    assert acceptor is not None and acceptor.current_energy == 100.0  # not consumed
    # Proposal survives (acceptor may become eligible, or it times out / is rejected later).
    assert world.get_agent_proposals("wanderer_001", "wanderer_002").get("resources")


async def test_accept_acceptor_at_offspring_cap_rejected_proposal_survives(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """An acceptor at the offspring cap is refused even with its cooldown cleared."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    for _ in range(MATING_MAX_OFFSPRING):  # acceptor maxed out elsewhere
        world.record_mating("wanderer_002", world.now())
    fake_clock.advance(MATING_COOLDOWN_SECONDS + 1.0)  # clear cooldown so the CAP is the gate

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Invalid:")
    assert "offspring" in result.lower()
    assert len(world.get_all_agents()) == 2  # no offspring
    acceptor = world.get_agent("wanderer_002")
    assert acceptor is not None and acceptor.current_energy == 100.0  # not consumed
    assert world.get_agent_proposals("wanderer_001", "wanderer_002").get("resources")  # survives


async def test_accept_stale_initiator_refunds_escrow_and_drops_proposal(
    world: WorldState, event_bus: EventBus
) -> None:
    """If the initiator is no longer eligible at accept-time, refund + drop the proposal.

    The design-gate fix: a pending proposal's initiate-time snapshot can go stale (the
    initiator mates elsewhere first). The proposal can never legally complete, so the
    acceptor's attempt refunds the initiator's escrow and removes the proposal rather
    than stranding the resources until the timeout sweep.
    """
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 50.0  # escrow deducted
    world.record_mating("wanderer_001", world.now())  # initiator becomes ineligible (cooldown)

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes"
    )
    assert result.startswith("Invalid:")
    assert "refunded" in result.lower()
    initiator = world.get_agent("wanderer_001")
    acceptor = world.get_agent("wanderer_002")
    assert initiator is not None and acceptor is not None
    assert initiator.current_energy == 100.0 and initiator.current_materials == 50.0  # refunded
    assert acceptor.current_energy == 100.0  # acceptor untouched
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}  # proposal dropped
    assert len(world.get_all_agents()) == 2  # no offspring


async def test_accept_stamps_both_parents_cooldown_and_offspring_count(
    world: WorldState, event_bus: EventBus
) -> None:
    """A completed mating puts BOTH parents on cooldown and increments their counts."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    await accept_mating(world, event_bus, "wanderer_002", target="wanderer_001", message="yes")

    now = world.now()
    for parent_id in ("wanderer_001", "wanderer_002"):
        parent = world.get_agent(parent_id)
        assert parent is not None
        assert parent.offspring_count == 1
        assert parent.last_mated_at == now
        assert world.is_on_mating_cooldown(parent_id, now, MATING_COOLDOWN_SECONDS) is True


async def test_second_mating_immediately_after_birth_blocked_by_cooldown(
    world: WorldState, event_bus: EventBus
) -> None:
    """Right after a completed mating a parent cannot immediately initiate another."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources=dict(_VALID_COMMIT),
    )
    await accept_mating(world, event_bus, "wanderer_002", target="wanderer_001", message="yes")

    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="again so soon",
        resources=dict(_VALID_COMMIT),
    )
    assert result.startswith("Invalid:")
    assert "recently" in result.lower() or "wait" in result.lower()


async def test_offspring_cap_holds_across_multiple_outstanding_proposals(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """The explosion-guard regression: two proposals can't push a parent past the cap.

    An initiator one below the cap holds two distinct proposals. The first accept
    completes (reaching the cap); the second accept hits the accept-time initiator
    re-check, is refused, and refunds — so the initiator never exceeds the cap.
    """
    world.add_agent(
        AgentState(
            id="wanderer_003",
            name="Cleo",
            persona="calm",
            current_position="alpha",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        )
    )
    event_bus.subscribe("wanderer_003")
    # Resources for two commitments, and put the initiator one below the cap; then clear
    # the cooldown those recordings created so the FIRST accept can still complete.
    world.modify_agent_energy("wanderer_001", 900.0)
    world.modify_agent_materials("wanderer_001", 950.0)
    for _ in range(MATING_MAX_OFFSPRING - 1):
        world.record_mating("wanderer_001", world.now())
    fake_clock.advance(MATING_COOLDOWN_SECONDS + 1.0)

    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="m",
        resources=dict(_VALID_COMMIT),
    )
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_003",
        message="m",
        resources=dict(_VALID_COMMIT),
    )

    first = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="y"
    )
    second = await accept_mating(
        world, event_bus, "wanderer_003", target="wanderer_001", message="y"
    )

    assert first.startswith("Successfully accepted mating")
    assert second.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.offspring_count == MATING_MAX_OFFSPRING  # never 6
    assert len(world.get_all_agents()) == 4  # 3 parents + exactly one offspring
    assert (
        world.get_agent_proposals("wanderer_001", "wanderer_003") == {}
    )  # second refunded + dropped
