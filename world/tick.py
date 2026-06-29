"""World-tick: one pure simulation step plus a thin async driver (design DD5).

The world-tick is the slow, world-owned heartbeat that runs alongside the agents'
breathing loops. Each step does two jobs:

#. **Regenerate resources** -- every region gains its per-tick rate (capped at
   ``max_*``) via :meth:`~world.world.WorldState.regenerate_resources`, so the
   ecology self-heals and the piece can run forever.
#. **Sweep timed-out mating proposals** -- any proposal whose escrow has sat
   unanswered longer than :data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS`
   is refunded to its initiator and removed, then a timeout event is published.

This lives as a *module function* taking both the world and the bus (NOT a
:class:`~world.world.WorldState` method): the proposal sweep must publish events,
and making it a world method would invert the ``EventBus -> WorldState``
dependency direction.

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
from core.constants import MATING_PROPOSAL_TIMEOUT_SECONDS
from core.logging import get_logger
from world.regions import ResourceTypes
from world.world import WorldState

logger = get_logger(__name__)


async def tick(world: WorldState, event_bus: EventBus) -> None:
    """Run one world-tick: regenerate resources and sweep timed-out proposals.

    Mutates world state:
        * Regenerates every region's energy/materials (capped at ``max_*``).
        * For each pending proposal older than
          :data:`~core.constants.MATING_PROPOSAL_TIMEOUT_SECONDS`, refunds the
          initiator's escrowed resources and removes the proposal (keeping
          :attr:`~world.world.WorldState.pending_proposals` and
          :attr:`~world.world.WorldState.pending_proposal_targets` in sync).

    Emits events:
        * One ``"mating_proposal_timeout"`` event
          (:attr:`~bus.events.ScopeType.TARGETED` to the refunded initiator,
          stamped with ``world.now()``) per swept proposal, published only after
          all refunds/removals are complete.

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

    # All refunds/removals are done; publishing (the only ``await``) is safe now.
    for event in timed_out_events:
        await event_bus.publish(event)


async def run_world_tick(world: WorldState, event_bus: EventBus, *, interval: float) -> None:
    """Drive :func:`tick` forever, sleeping ``interval`` seconds between steps.

    This is the integration-only free-running driver (the pure, unit-tested entry
    point is :func:`tick`). It never returns on its own; cancel the task to stop.

    Args:
        world: The live world state.
        event_bus: The bus the tick publishes timeout events to.
        interval: Seconds to sleep between consecutive ticks.

    Returns:
        None.
    """
    while True:  # pragma: no cover - integration-only driver loop
        await tick(world, event_bus)
        await asyncio.sleep(interval)
