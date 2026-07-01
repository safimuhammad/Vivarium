"""Tests for :mod:`tools.builtin.communication` -- ``speak``.

``speak`` mutates speaker energy and publishes a ``speak`` event (LOCAL when
broadcasting, TARGETED when addressed to one agent).
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import SPEAK_ENERGY_COST
from tools.builtin.communication import speak
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


async def test_speak_empty_message_is_rejected(world: WorldState, event_bus: EventBus) -> None:
    """An empty or whitespace-only message is rejected: no charge, no event."""
    for blank in ("", "   ", "\n\t"):
        result = await speak(world, event_bus, "wanderer_001", message=blank)
        assert result.startswith("Invalid:")

    speaker = world.get_agent("wanderer_001")
    assert speaker is not None
    assert speaker.current_energy == 100.0  # untouched across every rejection
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_speak_whisper_to_nonexistent_target_returns_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """Whispering to an unknown target errors out: no charge, no dropped event."""
    result = await speak(world, event_bus, "wanderer_001", message="psst", target="ghost")
    assert result.startswith("Error:")

    speaker = world.get_agent("wanderer_001")
    assert speaker is not None
    assert speaker.current_energy == 100.0  # not charged for an undeliverable whisper
    assert event_bus.get_events("wanderer_001") == []
    assert event_bus.get_events("wanderer_002") == []


async def test_speak_blocked_when_paralyzed(world: WorldState, event_bus: EventBus) -> None:
    """A PARALYZED agent cannot speak: an ``Invalid:`` string, no charge, no event."""
    world.modify_agent_energy("wanderer_001", -96.0)  # 100.0 -> 4.0 => PARALYZED
    out = await speak(world, event_bus, "wanderer_001", message="hello")
    assert out.startswith("Invalid:")
    assert not event_bus.get_events("wanderer_001")  # nothing published


def test_wait_tool_is_retired() -> None:
    """`wait` is gone from both the tool registry set and the schema set (kept in lock-step)."""
    from agents.tool_schemas import TOOL_SCHEMAS
    from tools.builtin import BUILTIN_TOOLS

    assert "wait" not in BUILTIN_TOOLS
    assert "wait" not in TOOL_SCHEMAS
