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
from core.constants import AGENT_ID_CATEGORIES, MATING_OFFSPRING_MULTIPLIER
from core.rng import make_rng
from tests.conftest import SEED, FakeClock
from tools.builtin.mating import accept_mating, initiate_mating, reject_mating
from world.agents import AgentState, AgentStatus
from world.regions import Region, ResourceTypes
from world.world import WorldState


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
        resources={ResourceTypes.ENERGY: 20.0, ResourceTypes.MATERIALS: 10.0},
    )

    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 80.0  # 100 - 20 committed
    assert initiator.current_materials == 40.0  # 50 - 10 committed

    proposal = world.get_agent_proposals("wanderer_001", "wanderer_002")
    assert proposal.get("resources") == {
        ResourceTypes.ENERGY: 20.0,
        ResourceTypes.MATERIALS: 10.0,
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
    """Committing more than held yields ``Error:`` with nothing deducted/stored."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 9999.0},
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 100.0  # untouched
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
    """Committing more materials than held yields ``Error:`` (materials branch)."""
    result = await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.MATERIALS: 9999.0},
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_materials == 50.0  # untouched
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
    committed = {ResourceTypes.ENERGY: 20.0}
    first = await initiate_mating(
        world, event_bus, "wanderer_001", target="wanderer_002", message="1", resources=committed
    )
    assert first.startswith("Successfully")
    second = await initiate_mating(
        world, event_bus, "wanderer_001", target="wanderer_002", message="2", resources=committed
    )
    assert second.startswith("Invalid:")
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None and initiator.current_energy == 80.0  # deducted once, not twice
    assert world.get_proposed_targets("wanderer_001") == ["wanderer_002"]  # no phantom entry


async def test_accept_single_resource_proposal_spawns_without_crash(
    world: WorldState, event_bus: EventBus
) -> None:
    """A proposal committing only ONE resource type must not crash on accept."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 20.0},  # energy only, no materials
    )
    event_bus.get_events("wanderer_002")

    result = await accept_mating(
        world, event_bus, "wanderer_002", target="wanderer_001", message="yes!"
    )
    assert result.startswith("Successfully accepted mating")
    offspring = _spawned_offspring(world, {"wanderer_001", "wanderer_002"})
    assert offspring.current_energy == 20.0 * MATING_OFFSPRING_MULTIPLIER
    assert offspring.current_materials == 0.0  # missing type defaults to zero, not a crash


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
        resources={ResourceTypes.ENERGY: 20.0, ResourceTypes.MATERIALS: 10.0},
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
    committed = {ResourceTypes.ENERGY: 20.0, ResourceTypes.MATERIALS: 10.0}
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
    # Initiator was charged at initiate; acceptor is charged now.
    assert initiator.current_energy == 80.0 and initiator.current_materials == 40.0
    assert acceptor.current_energy == 80.0 and acceptor.current_materials == 40.0

    offspring = _spawned_offspring(world, {"wanderer_001", "wanderer_002"})
    assert offspring.current_energy == 20.0 * MATING_OFFSPRING_MULTIPLIER  # 32.0
    assert offspring.current_materials == 10.0 * MATING_OFFSPRING_MULTIPLIER  # 16.0
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
        resources={ResourceTypes.ENERGY: 20.0},
    )
    event_bus.get_events("wanderer_002")
    world.modify_agent_energy("wanderer_002", -96.0)  # 100 -> 4, below the 20 needed

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
        resources={ResourceTypes.MATERIALS: 30.0},
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
        committed = {ResourceTypes.ENERGY: 20.0, ResourceTypes.MATERIALS: 10.0}
        await initiate_mating(
            world, bus, "parent_a", target="parent_b", message="m", resources=committed
        )
        await accept_mating(world, bus, "parent_b", target="parent_a", message="y")
        return _spawned_offspring(world, {"parent_a", "parent_b"})

    first = await run(build())
    second = await run(build())
    assert first.id == second.id
    assert first.name == second.name
