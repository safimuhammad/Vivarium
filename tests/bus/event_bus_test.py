"""Unit tests for :mod:`bus.event_bus` -- routing, subscription, and draining.

Covers the three scopes' routing isolation (LOCAL region-scoped, GLOBAL to all,
TARGETED to one), the subscribe/get_events lifecycle, FIFO ordering, the ordinary
"deliver to nobody" edge cases (empty region, unsubscribed/unknown target), and
the genuine-infrastructure-misuse cases that now raise
:class:`~core.exceptions.EventBusError` instead of failing silently.

Tests build the world via the locked ``WorldState`` interface and a small local
three-agent / three-region world (two agents in ``alpha``, one in ``beta``, an
empty ``gamma``) so region isolation is observable. No conftest edits.
"""

from __future__ import annotations

from typing import cast

import pytest

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.exceptions import EventBusError
from core.rng import make_rng
from observability.event_log import InMemoryEventLog
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState

# ---- Local fixtures -------------------------------------------------------


@pytest.fixture
def bus_regions() -> list[Region]:
    """Three regions: ``alpha`` <-> ``beta``, plus an unconnected empty ``gamma``."""
    common = {
        "energy_rate": 1.0,
        "materials_rate": 1.0,
        "current_energy": 100.0,
        "current_materials": 100.0,
        "max_energy": 500.0,
        "max_materials": 500.0,
    }
    return [
        Region(name="alpha", description="A", connections=["beta"], **common),
        Region(name="beta", description="B", connections=["alpha"], **common),
        Region(name="gamma", description="empty", connections=[], **common),
    ]


@pytest.fixture
def bus_agents() -> list[AgentState]:
    """Two agents in ``alpha`` (``a1``, ``a2``) and one in ``beta`` (``b1``)."""
    return [
        AgentState(
            id="a1",
            name="A1",
            persona="p",
            current_position="alpha",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        ),
        AgentState(
            id="a2",
            name="A2",
            persona="p",
            current_position="alpha",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        ),
        AgentState(
            id="b1",
            name="B1",
            persona="p",
            current_position="beta",
            current_energy=100.0,
            current_materials=50.0,
            status=AgentStatus.ALIVE,
        ),
    ]


@pytest.fixture
def bus_world(bus_regions: list[Region], bus_agents: list[AgentState]) -> WorldState:
    """A deterministic world for bus tests (seeded rng + frozen clock)."""
    return WorldState(bus_regions, bus_agents, rng=make_rng(99), clock=lambda: 1000.0)


@pytest.fixture
def bus(bus_world: WorldState) -> EventBus:
    """An :class:`EventBus` with every agent subscribed."""
    event_bus = EventBus(bus_world)
    for agent in bus_world.get_all_agents():
        event_bus.subscribe(agent.id)
    return event_bus


# ---- Constructor ----------------------------------------------------------


def test_constructor_holds_world_and_starts_with_no_inboxes(bus_world: WorldState) -> None:
    """The bus takes the world state and starts with no subscriber inboxes."""
    event_bus = EventBus(bus_world)
    assert event_bus.world_state is bus_world
    assert event_bus.agent_queues == {}


# ---- Routing isolation ----------------------------------------------------


async def test_local_with_explicit_region_delivers_only_to_that_region(bus: EventBus) -> None:
    """LOCAL with an explicit ``region`` reaches only agents in that region."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.LOCAL, region="alpha")
    await bus.publish(event)
    assert bus.get_events("a1") == [event]
    assert bus.get_events("a2") == [event]
    assert bus.get_events("b1") == []


async def test_local_without_region_routes_to_source_region(bus: EventBus) -> None:
    """LOCAL without a region routes to the *source* agent's current region."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.LOCAL)
    await bus.publish(event)
    assert bus.get_events("a1") == [event]  # source hears its own local event
    assert bus.get_events("a2") == [event]
    assert bus.get_events("b1") == []


async def test_global_delivers_to_every_subscriber(bus: EventBus) -> None:
    """GLOBAL reaches every subscribed agent (including the source)."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await bus.publish(event)
    assert bus.get_events("a1") == [event]
    assert bus.get_events("a2") == [event]
    assert bus.get_events("b1") == [event]


async def test_targeted_delivers_to_exactly_one(bus: EventBus) -> None:
    """TARGETED reaches only the named target and nobody else."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.TARGETED, target="b1")
    await bus.publish(event)
    assert bus.get_events("b1") == [event]
    assert bus.get_events("a1") == []
    assert bus.get_events("a2") == []


async def test_publish_is_fire_and_forget(bus: EventBus) -> None:
    """``publish`` has no return value; delivery is its only effect."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await bus.publish(event)
    # GLOBAL reaches every subscriber, including the source (no source exclusion).
    assert event in bus.get_events("a1")


# ---- subscribe / get_events lifecycle -------------------------------------


def test_subscribe_known_agent_returns_true_and_creates_inbox(bus_world: WorldState) -> None:
    """Subscribing a real agent returns ``True`` and creates an (empty) inbox."""
    event_bus = EventBus(bus_world)
    assert event_bus.subscribe("a1") is True
    assert "a1" in event_bus.agent_queues
    assert event_bus.get_events("a1") == []


def test_subscribe_unknown_agent_returns_false_and_creates_no_inbox(
    bus_world: WorldState,
) -> None:
    """Subscribing a non-existent agent returns ``False`` and creates no inbox."""
    event_bus = EventBus(bus_world)
    assert event_bus.subscribe("ghost") is False
    assert "ghost" not in event_bus.agent_queues


async def test_subscribe_is_idempotent_keeps_queued_events(bus_world: WorldState) -> None:
    """Re-subscribing an already-subscribed agent is a no-op that keeps its inbox.

    A stray double-subscribe must not reset the queue and silently drop pending events.
    """
    event_bus = EventBus(bus_world)
    assert event_bus.subscribe("a1") is True
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await event_bus.publish(event)

    assert event_bus.subscribe("a1") is True  # idempotent: does not reset the inbox
    assert event_bus.get_events("a1") == [event]  # the queued event survived


async def test_publish_before_subscribe_is_not_received_but_after_is(
    bus_world: WorldState,
) -> None:
    """Events published before an agent subscribes are not delivered to it."""
    event_bus = EventBus(bus_world)
    early = Event(type="early", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await event_bus.publish(early)  # nobody subscribed yet -> dropped
    event_bus.subscribe("a1")
    late = Event(type="late", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await event_bus.publish(late)
    assert event_bus.get_events("a1") == [late]


async def test_get_events_drains_and_empties_the_inbox(bus: EventBus) -> None:
    """``get_events`` returns queued events then leaves the inbox empty."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await bus.publish(event)
    assert bus.get_events("a1") == [event]
    assert bus.get_events("a1") == []  # drained


async def test_multiple_events_are_drained_in_fifo_order(bus: EventBus) -> None:
    """Multiple events for one agent come back in publish (FIFO) order."""
    events = [
        Event(type=f"e{i}", source="a1", payload={"i": i}, scope=ScopeType.GLOBAL) for i in range(3)
    ]
    for event in events:
        await bus.publish(event)
    assert bus.get_events("a1") == events


# ---- Ordinary "deliver to nobody" edge cases (no raise) -------------------


async def test_local_to_region_with_no_agents_is_a_no_op(bus: EventBus) -> None:
    """A LOCAL event to an empty region is delivered to nobody, without error."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.LOCAL, region="gamma")
    await bus.publish(event)
    assert bus.get_events("a1") == []
    assert bus.get_events("a2") == []
    assert bus.get_events("b1") == []


async def test_targeted_to_unsubscribed_but_real_agent_drops_silently(
    bus_world: WorldState,
) -> None:
    """TARGETED to a real-but-unsubscribed agent is dropped (no inbox, no error)."""
    event_bus = EventBus(bus_world)
    event_bus.subscribe("a1")  # b1 is a real agent but not subscribed
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.TARGETED, target="b1")
    await event_bus.publish(event)
    assert event_bus.get_events("a1") == []
    assert event_bus.get_events("b1") == []


async def test_local_skips_unsubscribed_agents_in_the_region(bus_world: WorldState) -> None:
    """A LOCAL event reaches subscribed residents and skips unsubscribed ones."""
    event_bus = EventBus(bus_world)
    event_bus.subscribe("a1")  # a2 is in alpha too, but is left unsubscribed
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.LOCAL, region="alpha")
    await event_bus.publish(event)
    assert event_bus.get_events("a1") == [event]
    assert event_bus.get_events("a2") == []  # present in region but no inbox


async def test_targeted_to_unknown_agent_drops_silently(bus: EventBus) -> None:
    """TARGETED to an unknown agent id is dropped without error."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.TARGETED, target="ghost")
    await bus.publish(event)
    assert bus.get_events("a1") == []
    assert bus.get_events("a2") == []
    assert bus.get_events("b1") == []


def test_get_events_for_unsubscribed_agent_returns_empty(bus_world: WorldState) -> None:
    """Draining an inbox that was never created returns an empty list."""
    event_bus = EventBus(bus_world)
    assert event_bus.get_events("a1") == []


# ---- Genuine infrastructure misuse (raises EventBusError) -----------------


async def test_local_without_region_and_unknown_source_raises(bus: EventBus) -> None:
    """A LOCAL event with no region whose source does not exist cannot be routed."""
    event = Event(type="x", source="ghost", payload={}, scope=ScopeType.LOCAL)
    with pytest.raises(EventBusError):
        await bus.publish(event)


async def test_unknown_scope_raises(bus: EventBus) -> None:
    """An event with a scope outside :class:`ScopeType` cannot be routed."""
    event = Event(type="x", source="a1", payload={}, scope=cast(ScopeType, "weird"))
    with pytest.raises(EventBusError):
        await bus.publish(event)


# ---- Event-log sink -------------------------------------------------------


async def test_publish_records_every_event_to_the_log_in_order(bus_world: WorldState) -> None:
    """With an event log attached, every published event is recorded in order."""
    log = InMemoryEventLog()
    event_bus = EventBus(bus_world, event_log=log)
    for agent in bus_world.get_all_agents():
        event_bus.subscribe(agent.id)

    first = Event(type="e0", source="a1", payload={}, scope=ScopeType.GLOBAL)
    second = Event(type="e1", source="a1", payload={}, scope=ScopeType.LOCAL, region="alpha")
    third = Event(type="e2", source="a1", payload={}, scope=ScopeType.TARGETED, target="b1")
    await event_bus.publish(first)
    await event_bus.publish(second)
    await event_bus.publish(third)

    assert log.events == [first, second, third]


async def test_publish_records_even_deliver_to_nobody_events(bus_world: WorldState) -> None:
    """A validly-scoped event delivered to nobody is still recorded (it was emitted)."""
    log = InMemoryEventLog()
    event_bus = EventBus(bus_world, event_log=log)  # no subscribers
    event = Event(type="lonely", source="a1", payload={}, scope=ScopeType.TARGETED, target="ghost")
    await event_bus.publish(event)
    assert log.events == [event]


async def test_publish_without_event_log_is_backward_compatible(bus: EventBus) -> None:
    """A bus built without an event log still publishes normally (default None)."""
    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await bus.publish(event)  # must not raise
    assert bus.get_events("a1") == [event]


async def test_publish_survives_a_raising_event_log(bus_world: WorldState) -> None:
    """A failing event-log sink must not propagate into the publishing agent's breath.

    The single capture point records *after* routing; a transient sink error (e.g.
    disk full) must be swallowed so it cannot crash the agent whose tool published
    the event (run-forever / crash-resistance, CLAUDE.md Section 1).
    """

    class _RaisingLog:
        def record(self, event: Event) -> None:
            raise RuntimeError("disk full")

    event_bus = EventBus(bus_world, event_log=_RaisingLog())
    for agent in bus_world.get_all_agents():
        event_bus.subscribe(agent.id)

    event = Event(type="x", source="a1", payload={}, scope=ScopeType.GLOBAL)
    await event_bus.publish(event)  # must NOT raise despite the sink failing

    assert event_bus.get_events("a1") == [event]  # routing still happened


# ---- unsubscribe ----------------------------------------------------------


async def test_unsubscribe_removes_inbox_and_stops_delivery(bus: EventBus) -> None:
    """``unsubscribe`` removes the inbox so later publishes do not target it."""
    assert bus.unsubscribe("a1") is True
    assert "a1" not in bus.agent_queues

    event = Event(type="x", source="a2", payload={}, scope=ScopeType.GLOBAL)
    await bus.publish(event)
    # a1 has no inbox now; a2 (still subscribed) receives it.
    assert bus.get_events("a1") == []
    assert bus.get_events("a2") == [event]


def test_unsubscribe_unknown_agent_returns_false(bus: EventBus) -> None:
    """Unsubscribing an agent with no inbox returns ``False`` (nothing to remove)."""
    assert bus.unsubscribe("never_subscribed") is False


async def test_private_routes_to_no_inbox_but_is_recorded(bus_world: WorldState) -> None:
    """PRIVATE reaches no inbox (not even the source), yet is still recorded (observable)."""
    log = InMemoryEventLog()
    event_bus = EventBus(bus_world, event_log=log)
    for agent in bus_world.get_all_agents():
        event_bus.subscribe(agent.id)
    event = Event(
        type="self_talk",
        source="a1",
        payload={"message": "just musing"},
        scope=ScopeType.PRIVATE,
    )
    await event_bus.publish(event)
    assert event_bus.get_events("a1") == []  # not even the source hears it
    assert event_bus.get_events("a2") == []
    assert event_bus.get_events("b1") == []
    assert log.events == [event]  # but it is observable in the log/feed
