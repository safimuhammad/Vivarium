"""World-tick: one pure simulation step plus a thin async driver (design DD5).

The world-tick is the slow, world-owned heartbeat that runs alongside the agents'
breathing loops. Each step does five jobs:

#. **Regenerate resources** -- every region gains its per-tick rate (capped at
   ``max_*``) via :meth:`~world.world.WorldState.regenerate_resources`, so the
   ecology self-heals and the piece can run forever.
#. **Sweep timed-out mating proposals** -- any proposal whose escrow has sat
   unanswered longer than :data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS`
   is refunded to its initiator and removed, then a timeout event is published.
#. **Sweep decayed corpses** -- any slain body older than
   :data:`~core.constants.CORPSE_DECAY_SECONDS` is removed from the world and its
   passing announced with a LOCAL ``agent_decayed`` event in its region. A body
   lingers (locally perceivable) so an away being can return and find it, then
   returns to the earth as a heard beat -- and corpses never pile up (run-forever).
#. **Sweep home upkeep/decay/collapse** -- each STANDING home draws time-based upkeep from the
   COLLECTIVE pool of its living stakeholders (owner first when still a
   stakeholder, then the rest by id), all-or-nothing. A home whose
   :attr:`~world.homes.Home.status` is :attr:`~world.homes.HomeStatus.RUIN` is skipped
   entirely -- it neither pays upkeep nor decays as a home; a ruin is instead handled by
   its own sweep (job 5, below). A covered home is repaired
   incrementally (:data:`~core.constants.HOME_REPAIR_PER_SECOND` times elapsed,
   clamped to its stakeholder-scaled ceiling via :func:`~world.homes.max_integrity`)
   and its ``last_upkeep_at`` advances; a home the pool cannot cover instead decays
   incrementally (:data:`~core.constants.HOME_DECAY_PER_SECOND` times elapsed) and
   ``last_upkeep_at`` freezes (arrears accrue). Both branches measure ``elapsed``
   from :attr:`~world.homes.Home.last_integrity_at` -- advanced to ``now`` on
   **every** tick, covered or missed -- rather than from the arrears clock
   ``last_upkeep_at``, which is what prevents decay from accelerating (a frozen
   ``last_upkeep_at`` would make each successive missed tick measure a larger
   ``elapsed`` and so decay faster, a death-spiral). Either way, at integrity
   ``<= 0.0`` the home now COLLAPSES INTO A RUIN via
   :meth:`~world.world.WorldState.make_ruin` (Layer 2c Task 5; it no longer vanishes via
   :meth:`~world.world.WorldState.remove_home` -- that would silently destroy any banked
   vault, the 2b leak this closes), announced with a LOCAL ``home_collapsed`` event in its
   region. A covered repair that restores integrity to its stakeholder-scaled ceiling also
   clears the home's :attr:`~world.homes.Home.breachers` (Layer 2c) -- a repelled raid resets.
#. **Sweep decayed ruins** -- any :attr:`~world.homes.HomeStatus.RUIN` older than
   :data:`~core.constants.RUINS_PERSIST_SECONDS` (measured from
   :attr:`~world.homes.Home.ruined_at`) is removed via
   :meth:`~world.world.WorldState.remove_home`. Mirrors the corpse-decay sweep, but the
   removal itself is SILENT (no event): the dramatic beats already fired -- the collapse
   itself (``home_collapsed``) and any ``ruins_scavenged`` in between -- so the observer
   perceives the ruin's departure only via the world-table snapshot, the same way a
   scavenged-clean ruin quietly disappears from view.

This lives as a *module function* taking both the world and the bus (NOT a
:class:`~world.world.WorldState` method): the sweeps must publish events, and
making them world methods would invert the ``EventBus -> WorldState`` dependency
direction.

Concurrency contract (avoids dict-changed-during-iteration and double-refund):
:func:`tick` first *snapshots* the pending proposals, then refunds and removes
each timed-out one **synchronously** (no ``await`` between reading a proposal and
removing it). All event publishes -- the only ``await`` points -- are deferred
until after every refund/removal is done, so an interleaved
:func:`~tools.builtin.mating.reject_mating` on the same proposal can refund it at
most once.
"""

from __future__ import annotations

import asyncio

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import (
    CORPSE_DECAY_SECONDS,
    HOME_DECAY_PER_SECOND,
    HOME_REPAIR_PER_SECOND,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
    RUINS_PERSIST_SECONDS,
)
from core.logging import get_logger
from world.agents import AgentState, AgentStatus
from world.homes import HomeStatus, max_integrity
from world.regions import ResourceTypes
from world.world import WorldState

logger = get_logger(__name__)


async def tick(world: WorldState, event_bus: EventBus) -> None:
    """Run one world-tick: regenerate, sweep proposals/corpses/home upkeep-decay-collapse/ruins.

    Mutates world state:
        * Regenerates every region's energy/materials (capped at ``max_*``).
        * For each pending proposal older than
          :data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS`, refunds the
          initiator's escrowed resources and removes the proposal (keeping
          :attr:`~world.world.WorldState.pending_proposals` and
          :attr:`~world.world.WorldState.pending_proposal_targets` in sync).
        * For each DEAD agent whose ``died_at`` is older than
          :data:`~core.constants.CORPSE_DECAY_SECONDS`, removes the body via
          :meth:`~world.world.WorldState.remove_agent`.
        * For each home whose :attr:`~world.homes.Home.status` is
          :attr:`~world.homes.HomeStatus.STANDING` (a :attr:`~world.homes.HomeStatus.RUIN`
          is skipped outright -- no draw, repair, decay, or collapse), computes
          time-based upkeep owed
          (:data:`~core.constants.HOME_UPKEEP_MATERIALS_PER_SECOND` times elapsed
          time since :attr:`~world.homes.Home.last_upkeep_at`) and draws it from
          the COLLECTIVE pool of the home's living stakeholders, in a
          deterministic order (the owner first when it is still a stakeholder,
          then the rest by id). All-or-nothing: if the pooled materials of every
          living (non-``DEAD``, non-missing) stakeholder cannot cover ``owed``,
          nothing is drawn from anyone. Otherwise draws ``owed`` across the
          ordered payers via :meth:`~world.world.WorldState.modify_agent_materials`
          (each pays ``min(their materials, remaining owed)`` until covered),
          **incrementally** repairs integrity by
          :data:`~core.constants.HOME_REPAIR_PER_SECOND` times ``elapsed`` (where
          ``elapsed = now - last_integrity_at``) via
          :meth:`~world.world.WorldState.modify_home_integrity` -- which clamps to
          the stakeholder-scaled ceiling (:func:`~world.homes.max_integrity` of
          ``len(stakeholders)``), so a funded home simply sits at its ceiling --
          clears the home's :attr:`~world.homes.Home.breachers` via
          :meth:`~world.world.WorldState.clear_breachers` iff this repair reached that
          ceiling (a repelled raid resets, Layer 2c Fork D) -- and advances
          ``last_upkeep_at`` to ``now``. When the pool cannot cover
          ``owed``, instead **incrementally** decrements integrity by
          :data:`~core.constants.HOME_DECAY_PER_SECOND` times the SAME ``elapsed``
          and deliberately leaves ``last_upkeep_at`` frozen so the shortfall accrues
          as arrears (back-rent); at ``<= 0.0`` COLLAPSES the home into a ruin via
          :meth:`~world.world.WorldState.make_ruin` (Layer 2c Task 5 -- folds any banked
          vault into the remnant rather than destroying it, closing the 2b leak). Either
          branch then advances :attr:`~world.homes.Home.last_integrity_at` to ``now`` --
          this happens on EVERY home EVERY tick (covered or missed), which is what keeps
          ``elapsed`` (and so decay) from accelerating across consecutive missed ticks:
          measuring it from the arrears clock ``last_upkeep_at`` instead (which freezes on
          a miss) would make each successive missed tick see a larger, unbounded
          ``elapsed``. Conservation: materials are only ever destroyed (drawn from
          payers, never minted) or left in place; energy is untouched by this sweep.
        * For each home whose :attr:`~world.homes.Home.status` is
          :attr:`~world.homes.HomeStatus.RUIN` and whose :attr:`~world.homes.Home.ruined_at`
          is older than :data:`~core.constants.RUINS_PERSIST_SECONDS`, removes it via
          :meth:`~world.world.WorldState.remove_home` -- silently (see "Emits events" below).

    Emits events:
        * One ``"mating_proposal_timeout"`` event
          (:attr:`~bus.events.ScopeType.TARGETED` to the refunded initiator,
          stamped with ``world.now()``) per swept proposal.
        * One ``"agent_decayed"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, stamped with the corpse's region and
          ``world.now()``, ``source`` = the removed agent) per decayed body, so a
          co-located being perceives the remains return to the earth.
        * One ``"home_collapsed"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, ``region`` = the home's region,
          ``source`` = the (former) owner's id, stamped with ``world.now()``) per
          home whose integrity reached ``<= 0.0`` this tick (it is now a ``RUIN``,
          not removed -- see :meth:`~world.world.WorldState.make_ruin`).
        * None for a swept ruin: removal past :data:`~core.constants.RUINS_PERSIST_SECONDS`
          is silent -- the collapse and any scavenging already announced it, and the
          observer perceives the ruin's departure via the world-table snapshot.
        All events are published only after every refund/removal is complete.

    Args:
        world: The live world state.
        event_bus: The bus the timeout events are published to.

    Returns:
        None.
    """
    world.regenerate_resources()

    now = world.now()
    timed_out_events: list[Event] = []
    # Snapshot then mutate: no ``await`` between reading a proposal and removing
    # it, so a concurrent reject_mating cannot trigger a double refund.
    for (initiator_id, target_id), proposal in list(world.pending_proposals.items()):
        timestamp = float(proposal["timestamp"])
        if now - timestamp <= MATING_PROPOSAL_TIMEOUT_SECONDS:
            continue

        resources: dict[ResourceTypes, float] = proposal["resources"]
        for resource_type, quantity in resources.items():
            if resource_type is ResourceTypes.ENERGY:
                world.modify_agent_energy(initiator_id, quantity)
            elif resource_type is ResourceTypes.MATERIALS:
                world.modify_agent_materials(initiator_id, quantity)
        world.remove_proposal(initiator_id, target_id)

        timed_out_events.append(
            Event(
                type="mating_proposal_timeout",
                source=initiator_id,
                payload={
                    "message": (
                        f"Your mating proposal to {target_id} timed out; your "
                        f"committed resources have been refunded."
                    )
                },
                scope=ScopeType.TARGETED,
                target=initiator_id,
                timestamp=now,
            )
        )

    # Sweep decayed corpses. A slain body lingers (perceivable) until it is older
    # than CORPSE_DECAY_SECONDS, then it is removed and its passing announced LOCALLY
    # in its region -- so the body's return to the earth is a heard, observed beat
    # (not a silent cleanup) and corpses never accumulate without bound. Same
    # snapshot-then-mutate discipline: capture each corpse's region/name, remove it
    # synchronously, defer the publish.
    decay_events: list[Event] = []
    for agent in list(world.get_all_agents()):
        if agent.status is not AgentStatus.DEAD or agent.died_at is None:
            continue
        if now - agent.died_at < CORPSE_DECAY_SECONDS:
            continue
        region, name, agent_id = agent.current_position, agent.name, agent.id
        world.remove_agent(agent)
        decay_events.append(
            Event(
                type="agent_decayed",
                source=agent_id,
                payload={"message": f"The remains of {name} return to the earth."},
                scope=ScopeType.LOCAL,
                region=region,
                timestamp=now,
            )
        )

    # Sweep home upkeep/decay (COLLECTIVE pool, L2a; incremental time-based repair/decay, L2c).
    # A RUIN is skipped outright below (MANDATORY #4): it neither pays upkeep nor decays as a
    # home -- a ruin gets its own sweep (Task 5). For a STANDING home, owed = rate *
    # elapsed(last_upkeep_at) is drawn from the home's living stakeholders in a
    # deterministic order (the owner first when it is still a stakeholder, then the rest by id)
    # — ALL-OR-NOTHING: if the pooled materials cannot cover owed, nothing is drawn. A covered
    # home is repaired INCREMENTALLY (+HOME_REPAIR_PER_SECOND * elapsed, auto-clamped to
    # max_integrity(s) by modify_home_integrity) and last_upkeep_at advances; an uncovered home
    # decays INCREMENTALLY instead (-HOME_DECAY_PER_SECOND * elapsed) and last_upkeep_at is
    # FROZEN so arrears accrue (back-rent). Both branches measure elapsed from
    # last_integrity_at — NOT last_upkeep_at — and advance last_integrity_at to now on EVERY
    # home EVERY tick (both branches), which is the fix for the decay-acceleration bug: deriving
    # elapsed from the arrears clock would grow unboundedly across consecutive missed ticks
    # (last_upkeep_at stays frozen), making decay accelerate. A departed/ghost owner (owner_id
    # not in stakeholders) never pays. Collapse (<= 0) still just removes the home (ruins are a
    # later 2c task). Same snapshot-then-mutate discipline: mutate synchronously, defer publish.
    collapse_events: list[Event] = []
    for home in list(world.get_all_homes()):
        if home.status is not HomeStatus.STANDING:
            continue  # ruins are handled by the ruin-sweep (Task 5), never upkeep/decay
        elapsed = now - home.last_integrity_at
        owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - home.last_upkeep_at)
        others = sorted(s for s in home.stakeholders if s != home.owner_id)
        ordered = ([home.owner_id] if home.owner_id in home.stakeholders else []) + others
        # Capture the (id, AgentState) of each living payer once — no re-lookup in the draw
        # loop (avoids an unreachable None-guard and keeps mypy happy without a re-narrow).
        living: list[tuple[str, AgentState]] = []
        available = 0.0
        for payer_id in ordered:
            payer = world.get_agent(payer_id)
            if payer is not None and payer.status is not AgentStatus.DEAD:
                living.append((payer_id, payer))
                available += payer.current_materials
        if living and available >= owed:
            remaining = owed
            for payer_id, payer in living:
                if remaining <= 0.0:
                    break  # owed already covered; leave the remaining payers untouched
                pay = min(payer.current_materials, remaining)
                world.modify_agent_materials(payer_id, -pay)
                remaining -= pay
            # Incremental repair (NOT heal-to-full): +rate*elapsed, clamped to max_integrity(s).
            world.modify_home_integrity(home.home_id, HOME_REPAIR_PER_SECOND * elapsed)
            if home.integrity >= max_integrity(len(home.stakeholders)):
                world.clear_breachers(home.home_id)  # a repelled raid resets (Fork D)
            home.last_upkeep_at = now  # advance only on a covered tick
        else:
            # Time-based decay from last_integrity_at (advanced every tick) — cannot accelerate.
            world.modify_home_integrity(home.home_id, -HOME_DECAY_PER_SECOND * elapsed)
            # last_upkeep_at is deliberately NOT advanced here (frozen: back-rent accrues).
            if home.integrity <= 0.0:
                region = home.region
                world.make_ruin(home.home_id)  # repurposed: collapse leaves a scavengeable ruin
                collapse_events.append(
                    Event(
                        type="home_collapsed",
                        source=home.owner_id,
                        payload={"message": f"A home in {region} has crumbled to ruin."},
                        scope=ScopeType.LOCAL,
                        region=region,
                        timestamp=now,
                    )
                )
        home.last_integrity_at = now  # advance EVERY tick (covered AND missed) — MANDATORY #1

    # Sweep ruins older than RUINS_PERSIST_SECONDS (mirror the corpse sweep). Snapshot-then-mutate:
    # a ruin made THIS tick has ruined_at == now, so it is never swept in the same tick. Removal
    # is silent — the dramatic beats are collapse-to-ruin (home_collapsed) and scavenging; the
    # observer still perceives the ruin leave via the world-table snapshot.
    for home in list(world.get_all_homes()):
        if home.status is not HomeStatus.RUIN or home.ruined_at is None:
            continue
        if now - home.ruined_at < RUINS_PERSIST_SECONDS:
            continue
        world.remove_home(home.home_id)

    # All refunds/removals are done; publishing (the only ``await``) is safe now.
    for event in (*timed_out_events, *decay_events, *collapse_events):
        await event_bus.publish(event)


async def _tick_once_resilient(world: WorldState, event_bus: EventBus) -> None:
    """Run one :func:`tick`, isolating any error so the heartbeat survives it.

    The free-running heartbeat (:func:`run_world_tick`) must keep regenerating
    resources for the world to self-heal and run forever; a single bad tick (e.g. an
    :class:`~core.exceptions.EventBusError` while publishing a timeout, or a
    malformed proposal) must not kill the loop and silently stop regeneration. This
    wrapper mirrors the per-breath isolation in :meth:`~agents.runtime.Agent.run`.

    Args:
        world: The live world state.
        event_bus: The bus the tick publishes timeout events to.

    Returns:
        None.
    """
    try:
        await tick(world, event_bus)
    except Exception:
        logger.exception("world-tick failed; skipping this tick to keep the heartbeat alive")


async def run_world_tick(world: WorldState, event_bus: EventBus, *, interval: float) -> None:
    """Drive :func:`tick` forever, sleeping ``interval`` seconds between steps.

    This is the integration-only free-running driver (the pure, unit-tested entry
    points are :func:`tick` and :func:`_tick_once_resilient`). It never returns on
    its own; cancel the task to stop. Each step is run through
    :func:`_tick_once_resilient` so one failing tick cannot stop the heartbeat.

    Args:
        world: The live world state.
        event_bus: The bus the tick publishes timeout events to.
        interval: Seconds to sleep between consecutive ticks.

    Returns:
        None.
    """
    while True:  # pragma: no cover - integration-only driver loop
        await _tick_once_resilient(world, event_bus)
        await asyncio.sleep(interval)
