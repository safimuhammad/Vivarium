"""Tests for :mod:`tools.builtin.communication` -- ``speak`` and ``wait``.

``speak`` mutates speaker energy and publishes a ``speak`` event (LOCAL when
broadcasting, TARGETED when addressed to one agent). ``wait`` is a pure
perception no-op that returns a randomized rest phrase routed through
``world.rng`` (so it is reproducible from a seed) and emits no event.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import SPEAK_ENERGY_COST
from core.rng import make_rng
from tests.conftest import SEED, FakeClock
from tools.builtin.communication import speak, wait
from world.agents import AgentState, AgentStatus
from world.regions import Region
from world.world import WorldState


async def test_speak_broadcast_is_local_and_charges_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """Speaking with no target broadcasts LOCAL to the speaker's region."""
    result = await speak(world, event_bus, "wanderer_001", message="hello")

    speaker = world.get_agent("wanderer_001")
    assert speaker is not None
    assert speaker.current_energy == 100.0 - SPEAK_ENERGY_COST  # 99.5

    a_inbox = event_bus.get_events("wanderer_001")
    b_inbox = event_bus.get_events("wanderer_002")
    assert len(a_inbox) == 1 and len(b_inbox) == 1  # both in alpha hear it
    event = b_inbox[0]
    assert event.type == "speak"
    assert event.source == "wanderer_001"
    assert event.scope is ScopeType.LOCAL
    assert event.target is None
    assert event.payload == {"message": "hello"}
    assert event.timestamp == world.now()

    assert result == "Your message was sent to Region|alpha"


async def test_speak_targeted_only_reaches_target(world: WorldState, event_bus: EventBus) -> None:
    """Speaking with a target is TARGETED and reaches only that agent."""
    result = await speak(world, event_bus, "wanderer_001", message="psst", target="wanderer_002")

    event = event_bus.get_events("wanderer_002")
    assert len(event) == 1
    assert event[0].scope is ScopeType.TARGETED
    assert event[0].target == "wanderer_002"
    assert event_bus.get_events("wanderer_001") == []  # speaker does not hear targeted

    speaker = world.get_agent("wanderer_001")
    assert speaker is not None and speaker.current_energy == 100.0 - SPEAK_ENERGY_COST
    assert result == "Your message was sent to wanderer_002"


async def test_speak_missing_agent_returns_error(world: WorldState, event_bus: EventBus) -> None:
    """An unknown speaker yields an ``Error:`` string, no event, no charge."""
    result = await speak(world, event_bus, "ghost", message="hi")
    assert result.startswith("Error:")
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_wait_returns_phrase_and_emits_no_event(
    world: WorldState, event_bus: EventBus
) -> None:
    """``wait`` returns guidance text and publishes nothing."""
    result = await wait(world, event_bus, "wanderer_001")
    assert isinstance(result, str)
    assert "look_around" in result
    assert event_bus.get_events("wanderer_001") == []


async def test_wait_is_deterministic_for_same_seed() -> None:
    """Same seed -> same ``wait`` phrase (randomness routes through world.rng)."""

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
                id="a1",
                name="A1",
                persona="p",
                current_position="alpha",
                current_energy=100.0,
                current_materials=50.0,
                status=AgentStatus.ALIVE,
            )
        ]
        return WorldState(regions, agents, rng=make_rng(SEED), clock=FakeClock())

    world_a = build()
    world_b = build()
    bus_a = EventBus(world_a)
    bus_b = EventBus(world_b)
    first = [await wait(world_a, bus_a, "a1") for _ in range(5)]
    second = [await wait(world_b, bus_b, "a1") for _ in range(5)]
    assert first == second
