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
from core.constants import MATING_PROPOSAL_TIMEOUT_SECONDS
from tests.conftest import FakeClock
from tools.builtin.mating import initiate_mating, reject_mating
from world.regions import ResourceTypes
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
    # Exactly one refund: 80 -> 100 (NOT 120) energy; 40 -> 50 (NOT 60) materials.
    assert initiator.current_energy == 100.0
    assert initiator.current_materials == 50.0
    # The proposal is gone and the maps are consistent.
    assert world.pending_proposals == {}
    assert world.get_proposed_targets("wanderer_001") == []
