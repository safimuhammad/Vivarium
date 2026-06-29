"""The :class:`EventBus` -- async pub/sub routing events into per-agent inboxes.

Agents never message each other directly. A tool mutates :class:`~world.world.WorldState`
then publishes an :class:`~bus.events.Event`; the bus routes it -- by
:class:`~bus.events.ScopeType` -- into the :class:`asyncio.Queue` inbox of each
recipient agent. Agents drain their inbox (via :meth:`EventBus.get_events`) during
perception.

Routing (see :class:`~bus.events.ScopeType`):

* ``LOCAL`` -- to subscribed agents in the event's ``region`` (or, when ``region``
  is ``None``, the source agent's current region).
* ``GLOBAL`` -- to every subscribed agent.
* ``TARGETED`` -- to the single subscribed agent named by the event's ``target``.

Error model (see ``CLAUDE.md`` Section 4): ordinary "delivered to nobody"
situations are *not* errors -- an empty region, or a target/everyone that simply
has no inbox, results in a silent no-op exactly as before. Only genuine
infrastructure misuse raises (and logs) :class:`~core.exceptions.EventBusError`:
a ``LOCAL`` event with no region whose source agent does not exist (so no region
can be resolved), or an event whose ``scope`` is not a known
:class:`~bus.events.ScopeType`.
"""

from __future__ import annotations

import asyncio

from core.exceptions import EventBusError
from core.logging import get_logger
from observability.event_log import EventLog
from world.world import WorldState

from .events import Event, ScopeType

logger = get_logger(__name__)


class EventBus:
    """Async publish/subscribe router over per-agent :class:`asyncio.Queue` inboxes.

    Attributes:
        world_state: The live world, used to resolve regions and validate agents.
        agent_queues: Map of subscribed agent id -> its inbox queue.
        event_log: Optional append-only sink; every successfully-routed event is
            recorded here (the replay record). ``None`` disables logging.
    """

    def __init__(self, world_state: WorldState, event_log: EventLog | None = None) -> None:
        """Initialise the bus.

        Args:
            world_state: The live :class:`~world.world.WorldState`; consulted to
                resolve a source agent's region and to validate subscriptions.
            event_log: Optional :class:`~observability.event_log.EventLog` sink.
                When provided, :meth:`publish` records every successfully-routed
                event to it. Defaults to ``None`` (backward compatible -- no log).
        """
        self.world_state: WorldState = world_state
        self.agent_queues: dict[str, asyncio.Queue[Event]] = {}
        self.event_log: EventLog | None = event_log

    def subscribe(self, agent_id: str) -> bool:
        """Create an inbox for an agent so it can receive events.

        Mutates :attr:`agent_queues`. Subscribing only succeeds for an agent that
        exists in the world; this guards against typos creating phantom inboxes.

        Args:
            agent_id: Id of the agent to subscribe.

        Returns:
            ``True`` if the agent exists and an inbox was created; ``False`` if
            no such agent exists in the world (no inbox is created).
        """
        if self.world_state.get_agent(agent_id) is not None:
            self.agent_queues[agent_id] = asyncio.Queue()
            return True
        logger.debug("Refused to subscribe unknown agent %r", agent_id)
        return False

    def unsubscribe(self, agent_id: str) -> bool:
        """Remove an agent's inbox so it stops receiving events.

        Mutates :attr:`agent_queues` by deleting the agent's queue (used for clean
        agent shutdown). Any events still queued in the dropped inbox are
        discarded. Subsequent publishes will no longer target this agent until it
        re-subscribes.

        Args:
            agent_id: Id of the agent to unsubscribe.

        Returns:
            ``True`` if the agent had an inbox that was removed; ``False`` if the
            agent was not subscribed (nothing to remove).
        """
        if agent_id in self.agent_queues:
            del self.agent_queues[agent_id]
            return True
        return False

    async def publish(self, event: Event) -> None:
        """Route an event into the inboxes of its recipients.

        Mutates the recipients' inboxes in :attr:`agent_queues` by enqueuing
        ``event``. Routing is by :attr:`~bus.events.Event.scope`; see the module
        docstring. Delivery to an agent only happens if that agent is subscribed
        (has an inbox); unsubscribed recipients are skipped silently.

        If an :attr:`event_log` sink is attached, the event is recorded there at a
        single capture point *after* routing succeeds (so a validly-scoped event
        delivered to nobody is still logged as emitted, while an event that fails
        to route -- raising below -- is not).

        Args:
            event: The event to route.

        Returns:
            None.

        Raises:
            EventBusError: If a ``LOCAL`` event has no ``region`` and its
                ``source`` agent does not exist (the region cannot be resolved),
                or if ``event.scope`` is not a known
                :class:`~bus.events.ScopeType`.
        """
        match event.scope:
            case ScopeType.LOCAL:
                region = event.region
                if region is None:
                    source = self.world_state.get_agent(event.source)
                    if source is None:
                        message = (
                            f"Cannot route LOCAL event {event.type!r}: no region given "
                            f"and source agent {event.source!r} does not exist."
                        )
                        logger.error(message)
                        raise EventBusError(message)
                    region = source.current_position
                await self._deliver_to_region(region, event)
            case ScopeType.GLOBAL:
                for inbox in self.agent_queues.values():
                    await inbox.put(event)
            case ScopeType.TARGETED:
                target = event.target
                if target is not None and (queue := self.agent_queues.get(target)) is not None:
                    await queue.put(event)
                else:
                    logger.debug(
                        "Dropping TARGETED event %r: target %r has no inbox",
                        event.type,
                        target,
                    )
            case _:
                message = f"Cannot route event {event.type!r}: unknown scope {event.scope!r}."
                logger.error(message)
                raise EventBusError(message)

        # Single capture point: record only events that routed without raising.
        if self.event_log is not None:
            self.event_log.record(event)

    async def _deliver_to_region(self, region_name: str, event: Event) -> None:
        """Enqueue ``event`` for every subscribed agent in a region.

        Args:
            region_name: Region whose resident agents should receive the event.
            event: The event to enqueue.

        Returns:
            None.
        """
        for agent in self.world_state.get_agents_in_region(region_name):
            queue = self.agent_queues.get(agent.id)
            if queue is not None:
                await queue.put(event)

    def get_events(self, agent_id: str) -> list[Event]:
        """Drain and return all queued events for an agent (non-blocking).

        Mutates the agent's inbox by emptying it. Safe to call for an agent that
        has no inbox (returns an empty list).

        Args:
            agent_id: Id of the agent whose inbox to drain.

        Returns:
            The queued events in FIFO order; empty if the agent is unsubscribed
            or its inbox is empty.
        """
        events: list[Event] = []
        queue = self.agent_queues.get(agent_id)
        if queue is not None:
            while not queue.empty():
                events.append(queue.get_nowait())
        return events
