"""Tests for :mod:`world.tick` -- the pure single-step world tick.

The tick does two jobs each step: regenerate every region's resources (capped at
``max_*``) and sweep timed-out mating proposals (refunding the initiator's
escrowed resources and removing the proposal). These tests drive the *pure*
``tick`` entry point with the deterministic ``world``/``fake_clock`` fixtures;
the free-running ``run_world_tick`` driver is integration-only and not unit
tested here.

The snapshot-then-mutate contract is exercised by interleaving a concurrent
``reject_mating`` with a ``tick`` on the same proposal and asserting exactly one
refund and no exception.
"""

from __future__ import annotations

import asyncio

import pytest

import world.tick as tick_module
from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    CORPSE_DECAY_SECONDS,
    HOME_DECAY_PER_SECOND,
    HOME_MAX_INTEGRITY,
    HOME_REPAIR_PER_SECOND,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
)
from core.rng import make_rng
from tests.conftest import SEED, FakeClock
from tools.builtin.mating import initiate_mating, reject_mating
from world.agents import AgentState, AgentStatus
from world.homes import HomeStatus, max_integrity
from world.regions import Region, ResourceTypes
from world.tick import _tick_once_resilient, tick
from world.world import WorldState

# ---- Resource regeneration ------------------------------------------------


# ---- Heartbeat crash-resistance -------------------------------------------


async def test_tick_once_resilient_runs_tick_normally(
    world: WorldState, event_bus: EventBus
) -> None:
    """The resilient wrapper runs a normal tick (resources still regenerate)."""
    alpha = world.get_region("alpha")
    assert alpha is not None
    before = alpha.current_energy
    await _tick_once_resilient(world, event_bus)
    assert alpha.current_energy > before  # regen ran through the wrapper


async def test_tick_once_resilient_isolates_a_failing_tick(
    world: WorldState, event_bus: EventBus, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bad tick is swallowed so the forever-loop heartbeat survives it."""

    async def boom(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("malformed proposal")

    monkeypatch.setattr(tick_module, "tick", boom)
    # Must NOT raise: a single failing tick cannot kill the heartbeat task.
    await _tick_once_resilient(world, event_bus)


async def test_tick_regenerates_regions_by_rate(world: WorldState, event_bus: EventBus) -> None:
    """One tick adds each region's per-tick energy/materials rate."""
    await tick(world, event_bus)

    alpha = world.get_region("alpha")
    beta = world.get_region("beta")
    assert alpha is not None and beta is not None
    # alpha: rates 1.0/1.0 from 100.0/100.0
    assert alpha.current_energy == 101.0
    assert alpha.current_materials == 101.0
    # beta: rates 2.0/0.5 from 200.0/50.0
    assert beta.current_energy == 202.0
    assert beta.current_materials == 50.5


async def test_tick_regeneration_caps_at_max(world: WorldState, event_bus: EventBus) -> None:
    """Regeneration during a tick clamps at the region's ``max_*``."""
    alpha = world.get_region("alpha")
    assert alpha is not None
    alpha.current_energy = 499.5  # rate 1.0 -> would reach 500.5
    alpha.current_materials = 499.8  # rate 1.0 -> would reach 500.8

    await tick(world, event_bus)

    assert alpha.current_energy == 500.0
    assert alpha.current_materials == 500.0


# ---- Proposal-timeout sweep -----------------------------------------------


async def test_tick_refunds_stale_proposal_and_keeps_fresh(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A proposal older than the timeout is refunded+removed; a fresh one stays."""
    # Proposal A (wanderer_001 -> wanderer_002), stamped at t0; initiator charged.
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0},
    )
    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 50.0 and initiator.current_materials == 20.0

    # Age proposal A past the timeout, then add a *fresh* proposal B.
    fake_clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS + 1.0)
    await initiate_mating(
        world,
        event_bus,
        "wanderer_002",
        target="wanderer_001",
        message="no, be MINE",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0},
    )
    other = world.get_agent("wanderer_002")
    assert other is not None and other.current_energy == 50.0  # B charged

    # Drain inboxes so we can assert the timeout event in isolation.
    event_bus.get_events("wanderer_001")
    event_bus.get_events("wanderer_002")

    await tick(world, event_bus)

    # A: refunded to the initiator and removed from both maps.
    assert initiator.current_energy == 100.0
    assert initiator.current_materials == 50.0
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert world.get_proposed_targets("wanderer_001") == []

    # B: fresh, untouched.
    assert other.current_energy == 50.0
    assert world.get_agent_proposals("wanderer_002", "wanderer_001").get("resources") == {
        ResourceTypes.ENERGY: 50.0,
        ResourceTypes.MATERIALS: 30.0,
    }
    assert world.get_proposed_targets("wanderer_002") == ["wanderer_001"]

    # Maps stay consistent: exactly the fresh proposal remains.
    assert set(world.pending_proposals) == {("wanderer_002", "wanderer_001")}

    # A timeout event is delivered to the refunded initiator.
    inbox = event_bus.get_events("wanderer_001")
    assert len(inbox) == 1
    assert inbox[0].type == "mating_proposal_timeout"
    assert inbox[0].target == "wanderer_001"
    assert inbox[0].timestamp == world.now()


async def test_tick_leaves_recent_proposal_intact(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A proposal younger than the timeout is not swept (no refund, still stored)."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0},
    )
    # Advance, but stay within the timeout window.
    fake_clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS - 1.0)

    await tick(world, event_bus)

    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    assert initiator.current_energy == 50.0  # NOT refunded
    assert world.get_agent_proposals("wanderer_001", "wanderer_002").get("resources") == {
        ResourceTypes.ENERGY: 50.0,
        ResourceTypes.MATERIALS: 30.0,
    }


# ---- Corpse-decay sweep ---------------------------------------------------


async def test_tick_decays_corpse_past_window_and_announces_it(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A body older than the decay window is removed; a LOCAL ``agent_decayed`` is heard.

    The announcement is region-scoped: a co-located being perceives the body's
    passing, a being in another region does not.
    """
    afar = AgentState(
        id="wanderer_009",
        name="Distant",
        persona="Far away.",
        current_position="beta",
        current_energy=100.0,
        current_materials=50.0,
        status=AgentStatus.ALIVE,
    )
    assert world.add_agent(afar) is True
    assert event_bus.subscribe("wanderer_009") is True
    # Boris dies in alpha; Ada (wanderer_001) remains there to witness the decay.
    world.kill_agent("wanderer_002")
    fake_clock.advance(CORPSE_DECAY_SECONDS + 1.0)

    await tick(world, event_bus)

    # The body is gone from the world.
    assert world.get_agent("wanderer_002") is None
    # A co-located witness hears the body's passing, scoped to alpha.
    here = [e for e in event_bus.get_events("wanderer_001") if e.type == "agent_decayed"]
    assert len(here) == 1
    assert here[0].scope is ScopeType.LOCAL
    assert here[0].region == "alpha"
    assert here[0].source == "wanderer_002"
    assert "message" in here[0].payload
    # A being in another region perceives nothing of it.
    assert [e for e in event_bus.get_events("wanderer_009") if e.type == "agent_decayed"] == []


async def test_tick_leaves_fresh_corpse_intact(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A body younger than the decay window lingers (still perceivable), no announcement."""
    world.kill_agent("wanderer_002")
    fake_clock.advance(CORPSE_DECAY_SECONDS - 1.0)

    await tick(world, event_bus)

    corpse = world.get_agent("wanderer_002")
    assert corpse is not None and corpse.status is AgentStatus.DEAD
    assert [e for e in event_bus.get_events("wanderer_001") if e.type == "agent_decayed"] == []


async def test_tick_and_reject_interleave_yield_single_refund(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Concurrently rejecting and ticking a stale proposal refunds exactly once."""
    await initiate_mating(
        world,
        event_bus,
        "wanderer_001",
        target="wanderer_002",
        message="be mine",
        resources={ResourceTypes.ENERGY: 50.0, ResourceTypes.MATERIALS: 30.0},
    )
    fake_clock.advance(MATING_PROPOSAL_TIMEOUT_SECONDS + 1.0)

    # Interleave the acceptor's reject with a world tick on the SAME proposal.
    await asyncio.gather(
        reject_mating(world, event_bus, "wanderer_002", target="wanderer_001", message="no"),
        tick(world, event_bus),
    )

    initiator = world.get_agent("wanderer_001")
    assert initiator is not None
    # Exactly one refund: 50 -> 100 (NOT 150) energy; 20 -> 50 (NOT 80) materials.
    assert initiator.current_energy == 100.0
    assert initiator.current_materials == 50.0
    # The proposal is gone and the maps are consistent.
    assert world.pending_proposals == {}
    assert world.get_proposed_targets("wanderer_001") == []


# ---- Home upkeep / decay / collapse sweep ---------------------------------


def _world_with_home(owner_materials: float) -> tuple[WorldState, EventBus, FakeClock]:
    """A one-region world with a single owner who already owns a home.

    The region has zero regen so only home-upkeep touches the owner's materials,
    isolating the upkeep draw for the frequency-independence assertion.
    """
    clock = FakeClock()
    region = Region(
        name="alpha",
        description="A field.",
        connections=[],
        energy_rate=0.0,
        materials_rate=0.0,
        current_energy=0.0,
        current_materials=0.0,
        max_energy=500.0,
        max_materials=500.0,
    )
    owner = AgentState(
        id="owner_1",
        name="Owner",
        persona="p",
        current_position="alpha",
        current_energy=100.0,
        current_materials=owner_materials,
        status=AgentStatus.ALIVE,
    )
    world = WorldState([region], [owner], rng=make_rng(SEED), clock=clock)
    bus = EventBus(world)
    bus.subscribe("owner_1")
    world.build_home(
        "home_1", "owner_1", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    return world, bus, clock


async def test_tick_paid_upkeep_draws_materials_and_restores_integrity(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A payable tick draws time-based upkeep from the owner and restores integrity."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.modify_home_integrity("home_ada", -40.0)  # a worn home: 100 -> 60
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    mats_before = ada.current_materials
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.home_of("wanderer_001")
    assert home is not None
    assert home.integrity == HOME_MAX_INTEGRITY  # a fed home is restored to sound
    assert ada.current_materials == pytest.approx(
        mats_before - HOME_UPKEEP_MATERIALS_PER_SECOND * 10.0
    )
    assert home.last_upkeep_at == world.now()


async def test_tick_unpaid_upkeep_decays_integrity(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A broke owner cannot pay, so nothing is drawn and the home decays one step."""
    world.build_home(
        "home_boris", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_materials("wanderer_002", -boris.current_materials)  # broke: 0 materials
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.home_of("wanderer_002")
    assert home is not None
    assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND * 10.0
    assert boris.current_materials == 0.0  # nothing drawn from a broke owner


async def test_tick_partial_materials_upkeep_is_all_or_nothing(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Holding SOME but not enough materials still cannot pay: no partial draw.

    Upkeep is all-or-nothing -- an owner with ``0 < materials < owed`` is treated the
    same as a broke owner (nothing is drawn, ``last_upkeep_at`` does not advance, and
    the home decays one step), never a partial payment.
    """
    built_at = world.now()
    world.build_home(
        "home_boris", "wanderer_002", "alpha", built_at=built_at, integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_materials("wanderer_002", -(boris.current_materials - 0.5))  # -> 0.5
    assert boris.current_materials == 0.5
    fake_clock.advance(10.0)  # owed = HOME_UPKEEP_MATERIALS_PER_SECOND * 10.0 == 1.0 > 0.5 held

    await tick(world, event_bus)

    home = world.home_of("wanderer_002")
    assert home is not None
    assert boris.current_materials == 0.5  # unchanged: no partial draw
    assert home.last_upkeep_at == built_at  # NOT advanced
    assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND * 10.0


async def test_tick_dead_owner_cannot_pay_decays_and_collapses(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A DEAD owner cannot pay; a home worn to one step from ruin collapses and announces it."""
    world.build_home(
        "home_boris", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    # Wear it to exactly one missed-tick from collapse.
    world.modify_home_integrity("home_boris", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND))
    world.kill_agent("wanderer_002")  # owner DEAD -> cannot pay
    event_bus.get_events("wanderer_001")  # drain the co-located witness's inbox
    fake_clock.advance(1.0)

    await tick(world, event_bus)

    assert world.home_of("wanderer_002") is None  # collapsed and removed
    collapsed = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(collapsed) == 1
    assert collapsed[0].scope is ScopeType.LOCAL
    assert collapsed[0].region == "alpha"
    assert collapsed[0].source == "wanderer_002"
    assert collapsed[0].timestamp == world.now()


async def test_tick_swept_owner_missing_decays_and_collapses(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A swept (removed-from-world) owner cannot pay; the home decays to collapse."""
    world.build_home(
        "home_boris",
        "wanderer_002",
        "alpha",
        built_at=world.now(),
        integrity=HOME_DECAY_PER_SECOND,  # one missed tick from ruin
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    assert world.remove_agent(boris) is True  # corpse fully decayed away earlier
    assert world.get_agent("wanderer_002") is None
    event_bus.get_events("wanderer_001")
    fake_clock.advance(1.0)

    await tick(world, event_bus)

    assert world.home_of("wanderer_002") is None
    collapsed = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(collapsed) == 1


async def test_tick_home_collapse_fires_once(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Collapse is announced exactly once — the removed home cannot re-collapse next tick."""
    world.build_home(
        "home_boris",
        "wanderer_002",
        "alpha",
        built_at=world.now(),
        integrity=HOME_DECAY_PER_SECOND,
    )
    world.kill_agent("wanderer_002")

    fake_clock.advance(1.0)
    await tick(world, event_bus)
    first = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(first) == 1

    fake_clock.advance(1.0)
    await tick(world, event_bus)
    second = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert second == []
    assert world.home_of("wanderer_002") is None


async def test_tick_home_upkeep_is_frequency_independent() -> None:
    """The same wall-time draws the same upkeep regardless of tick cadence."""
    world_a, bus_a, clock_a = _world_with_home(100.0)
    world_b, bus_b, clock_b = _world_with_home(100.0)

    clock_a.advance(10.0)  # A: one tick after 10 seconds
    await tick(world_a, bus_a)

    for _ in range(10):  # B: ten one-second ticks over the same 10 seconds
        clock_b.advance(1.0)
        await tick(world_b, bus_b)

    owner_a = world_a.get_agent("owner_1")
    owner_b = world_b.get_agent("owner_1")
    assert owner_a is not None and owner_b is not None
    assert owner_a.current_materials == pytest.approx(owner_b.current_materials)
    assert owner_a.current_materials == pytest.approx(
        100.0 - HOME_UPKEEP_MATERIALS_PER_SECOND * 10.0
    )


# ---- Collective-pool home upkeep (L2a) ------------------------------------


def _home_world(*balances: tuple[str, float]) -> tuple[WorldState, EventBus, FakeClock]:
    """A zero-regen one-region world with the given (agent_id, materials) beings in ``alpha``.

    Zero regen isolates the upkeep draw. The first being owns a home (and is its first
    stakeholder); the caller adds the rest as stakeholders as needed.
    """
    clock = FakeClock()
    region = Region(
        name="alpha",
        description="A field.",
        connections=[],
        energy_rate=0.0,
        materials_rate=0.0,
        current_energy=0.0,
        current_materials=0.0,
        max_energy=1000.0,
        max_materials=1000.0,
    )
    beings = [
        AgentState(
            id=aid,
            name=aid.title(),
            persona="p",
            current_position="alpha",
            current_energy=100.0,
            current_materials=mats,
            status=AgentStatus.ALIVE,
        )
        for aid, mats in balances
    ]
    world = WorldState([region], beings, rng=make_rng(SEED), clock=clock)
    bus = EventBus(world)
    for aid, _ in balances:
        bus.subscribe(aid)
    world.build_home(
        "h1", balances[0][0], "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    return world, bus, clock


async def test_tick_collective_upkeep_solvent_owner_covers_alone() -> None:
    """A solvent owner covers upkeep alone (draw stops early); a co-stakeholder is untouched."""
    world, bus, clock = _home_world(("owner_1", 100.0), ("wanderer_9", 50.0))
    world.add_stakeholder("h1", "wanderer_9")  # [owner_1, wanderer_9] -> M(2)=150
    clock.advance(10.0)  # owed = 0.1 * 10 = 1.0

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(
        99.0
    )  # owner covered all 1.0 (draw broke early)
    assert friend.current_materials == pytest.approx(50.0)  # untouched — never reached
    assert home.integrity == 150.0  # healed to M(2)
    assert home.last_upkeep_at == world.now()  # advanced on a covered tick


async def test_tick_collective_upkeep_draws_across_payers_in_order() -> None:
    """Owed is drawn owner-first, then the next stakeholder covers the remainder; heals to M(2)."""
    world, bus, clock = _home_world(("owner_1", 0.5), ("wanderer_9", 100.0))
    world.add_stakeholder("h1", "wanderer_9")  # [owner_1, wanderer_9] -> M(2)=150
    clock.advance(10.0)  # owed = 1.0

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(0.0)  # owner paid all 0.5 it had
    assert friend.current_materials == pytest.approx(99.5)  # covered the remaining 0.5
    assert home.integrity == 150.0  # healed to M(2)
    assert home.last_upkeep_at == world.now()


async def test_tick_collective_upkeep_none_decays_and_freezes() -> None:
    """When the whole pool cannot cover owed, nothing is drawn, integrity decays, clock freezes."""
    world, bus, clock = _home_world(("owner_1", 0.2), ("wanderer_9", 0.1))
    world.add_stakeholder("h1", "wanderer_9")  # pool = 0.3
    home_before = world.get_home("h1")
    assert home_before is not None
    frozen_at = home_before.last_upkeep_at
    clock.advance(10.0)  # owed = 1.0 > 0.3

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(0.2)  # untouched (all-or-nothing)
    assert friend.current_materials == pytest.approx(0.1)  # untouched
    assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND * 10.0  # decayed one step
    assert home.last_upkeep_at == frozen_at  # frozen: arrears accrue (back-rent)


async def test_tick_ownerless_home_with_no_living_payers_decays_to_collapse() -> None:
    """A home whose only stakeholder left (ghost owner) has no payer, so it decays and collapses."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.modify_home_integrity("h1", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND))  # -> 2
    world.remove_stakeholder("h1", "owner_1")  # last stakeholder gone; owner stays ghost
    bus.get_events("owner_1")  # drain
    clock.advance(1.0)

    await tick(world, bus)

    assert world.get_home("h1") is None  # collapsed and removed
    collapsed = [e for e in bus.get_events("owner_1") if e.type == "home_collapsed"]
    assert len(collapsed) == 1
    assert collapsed[0].scope is ScopeType.LOCAL and collapsed[0].region == "alpha"


async def test_tick_promoted_costakeholder_pays_upkeep_after_owner_death() -> None:
    """``kill_agent`` prunes+promotes; the promoted survivor alone then covers upkeep.

    Conservation-critical permutation: a home has two stakeholders -- an owner about to
    die and a solvent co-stakeholder. ``kill_agent`` prunes the dead owner from
    ``stakeholders`` and promotes the co-stakeholder to owner (:meth:`WorldState.
    remove_stakeholder`) BEFORE the next tick runs. The tick must then draw upkeep from
    the promoted survivor alone (the dead owner is filtered out as non-living), heal the
    home to the NEW one-stakeholder ceiling (:func:`~world.homes.max_integrity`, not the
    stale two-stakeholder one), advance ``last_upkeep_at``, and leave the dead agent's
    own balance untouched (``kill_agent`` never mutates materials; the tick's payer loop
    skips ``DEAD`` agents).
    """
    world, bus, clock = _home_world(("owner_1", 100.0), ("wanderer_9", 50.0))
    world.add_stakeholder("h1", "wanderer_9")  # [owner_1, wanderer_9] -> M(2)=150
    world.modify_home_integrity("h1", -50.0)  # wear it down: 100 -> 50 (below both ceilings)

    world.kill_agent("owner_1")  # prunes owner_1, promotes wanderer_9 to owner

    home = world.get_home("h1")
    assert home is not None
    assert home.owner_id == "wanderer_9"  # promoted (sole survivor)
    assert home.stakeholders == ["wanderer_9"]
    assert home.integrity == 50.0  # re-clamp to M(1)=100 is a no-op here (50 < 100)
    clock.advance(10.0)  # owed = HOME_UPKEEP_MATERIALS_PER_SECOND * 10 = 1.0

    await tick(world, bus)

    survivor = world.get_agent("wanderer_9")
    dead_owner = world.get_agent("owner_1")
    home_after = world.get_home("h1")
    assert survivor is not None and dead_owner is not None and home_after is not None
    assert survivor.current_materials == pytest.approx(49.0)  # paid the full 1.0 owed, alone
    assert home_after.integrity == max_integrity(1)  # healed to the NEW one-stakeholder ceiling
    assert home_after.last_upkeep_at == world.now()  # advanced: a covered tick
    assert dead_owner.current_materials == pytest.approx(100.0)  # untouched by death or upkeep
    assert [e for e in bus.get_events("wanderer_9") if e.type == "home_collapsed"] == []


# ---- Incremental time-based repair/decay (L2c Task 1) ---------------------


async def test_tick_repair_is_incremental_not_heal_to_full() -> None:
    """A covered tick repairs +HOME_REPAIR_PER_SECOND*elapsed, NOT instantly to full.

    This is what makes break-in cumulative: a breach out-paces incremental repair, not a
    heal-to-full that would erase every mid-window blow.
    """
    world, bus, clock = _home_world(("owner_1", 100.0))  # solvent -> covered branch
    world.modify_home_integrity("h1", -50.0)  # wear it to 50
    home = world.get_home("h1")
    assert home is not None
    clock.advance(2.0)  # elapsed 2s -> +HOME_REPAIR_PER_SECOND*2 == +20

    await tick(world, bus)

    assert home.integrity == pytest.approx(50.0 + HOME_REPAIR_PER_SECOND * 2.0)  # NOT healed to 100
    assert home.last_integrity_at == world.now()  # advanced on the covered tick


async def test_tick_decay_is_time_based_and_does_not_accelerate() -> None:
    """Two consecutive unpaid ticks each decay by rate*gap — decay never accelerates (MANDATORY #1).

    The pre-fix bug measured decay from last_upkeep_at, which FREEZES on a missed tick, so each
    successive missed tick saw a larger elapsed and decayed faster (a death-spiral ~2.5x too
    fast). Driving decay from last_integrity_at (advanced every tick) makes each 5s unpaid tick
    cost exactly HOME_DECAY_PER_SECOND*5 — twice in a row, not 10 then 30.
    """
    world, bus, clock = _home_world(("owner_1", 0.0))  # broke: never pays -> missed branch
    home = world.get_home("h1")
    assert home is not None
    start = home.integrity  # 100

    clock.advance(5.0)
    await tick(world, bus)
    after_one = home.integrity
    assert after_one == pytest.approx(start - HOME_DECAY_PER_SECOND * 5.0)  # -10 -> 90
    assert home.last_integrity_at == world.now()  # advanced on the missed tick

    clock.advance(5.0)
    await tick(world, bus)
    # -10 AGAIN -> 80 (not -30): decay did not accelerate on the second consecutive missed tick.
    assert home.integrity == pytest.approx(after_one - HOME_DECAY_PER_SECOND * 5.0)


async def test_tick_funded_home_stays_at_ceiling_across_many_ticks() -> None:
    """A funded home stays clamped at M(s) forever, never decaying (L1/2a non-regression)."""
    world, bus, clock = _home_world(("owner_1", 1000.0))
    home = world.get_home("h1")
    assert home is not None
    for _ in range(20):
        clock.advance(3.0)
        await tick(world, bus)
    # == M(1) == 100, rate-independent.
    assert home.integrity == max_integrity(len(home.stakeholders))


# ---- RUIN status guard (L2c Task 2) ---------------------------------------


async def test_tick_upkeep_skips_a_ruin(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """The upkeep sweep leaves a RUIN untouched — no decay, no draw, no collapse (MANDATORY #4)."""
    world.build_home("home_ruin", "wanderer_002", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["home_ruin"].status = HomeStatus.RUIN  # manual (make_ruin is Task 5)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = 0.0  # broke: a STANDING home here would decay
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.get_home("home_ruin")
    assert home is not None and home.integrity == 40.0  # frozen, not decayed


# ---- Breacher-clear on full repair (L2c Task 3, Fork D) --------------------


async def test_tick_clears_breachers_when_fully_repaired() -> None:
    """A repelled raid resets: breachers clear once a covered tick heals back to M(s) (Fork D)."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.record_breacher("h1", "wanderer_9")  # a raider who gave up
    world.modify_home_integrity("h1", -5.0)  # 100 -> 95 (one covered tick repairs it back)
    clock.advance(5.0)  # +HOME_REPAIR_PER_SECOND*5 == +50 -> clamped to M(1)=100

    await tick(world, bus)

    home = world.get_home("h1")
    assert home is not None and home.integrity == 100.0
    assert home.breachers == set()  # cleared on full repair


async def test_tick_keeps_breachers_while_not_fully_repaired() -> None:
    """Breachers persist across a partial repair (the raid is not yet repelled)."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.record_breacher("h1", "wanderer_9")
    world.modify_home_integrity("h1", -80.0)  # 100 -> 20
    clock.advance(2.0)  # +20 -> 40, still below the ceiling

    await tick(world, bus)

    home = world.get_home("h1")
    assert home is not None and home.integrity == 40.0
    assert home.breachers == {"wanderer_9"}  # not cleared
