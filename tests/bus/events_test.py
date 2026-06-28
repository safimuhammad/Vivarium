"""Unit tests for :mod:`bus.events` -- the ``Event`` dataclass and ``ScopeType``.

These pin the *public* shape of the event model that the tool layer depends on:
field names, field order, defaults, ``slots`` behaviour, and the optional
``timestamp`` with its default factory. Routing semantics live in
``event_bus_test.py``.
"""

from __future__ import annotations

import dataclasses

import pytest

from bus.events import Event, ScopeType

# ---- ScopeType ------------------------------------------------------------


def test_scopetype_members_and_values() -> None:
    """The three scope members exist with their stable string values."""
    assert ScopeType.LOCAL.value == "local"
    assert ScopeType.GLOBAL.value == "global"
    assert ScopeType.TARGETED.value == "targeted"


def test_scopetype_has_exactly_three_members() -> None:
    """No scope members were added or removed (public surface is locked)."""
    assert {member.name for member in ScopeType} == {"LOCAL", "GLOBAL", "TARGETED"}


# ---- Event field shape (backward-compatible public API) -------------------


def test_event_field_order_is_locked() -> None:
    """Field order is part of the public API (tools pass ``scope`` positionally)."""
    names = [f.name for f in dataclasses.fields(Event)]
    assert names == [
        "type",
        "source",
        "payload",
        "scope",
        "region",
        "target",
        "timestamp",
    ]


def test_event_positional_construction_matches_tool_call_sites() -> None:
    """``Event(type, source, payload, scope, target=...)`` keeps working.

    Mirrors ``tools/builtin/mating.py`` which passes ``scope`` positionally as the
    fourth argument and ``target`` by keyword.
    """
    event = Event(
        "mating_initiated",
        "wanderer_001",
        {"message": "hi"},
        ScopeType.TARGETED,
        target="wanderer_002",
    )
    assert event.type == "mating_initiated"
    assert event.source == "wanderer_001"
    assert event.payload == {"message": "hi"}
    assert event.scope is ScopeType.TARGETED
    assert event.target == "wanderer_002"
    assert event.region is None


def test_event_keyword_construction_matches_tool_call_sites() -> None:
    """``Event(type=..., source=..., region=..., payload=..., scope=...)`` works.

    Mirrors ``tools/builtin/movement.py`` which passes everything by keyword.
    """
    event = Event(
        type="agent_left_region",
        source="wanderer_001",
        region="alpha",
        payload={"message": "left"},
        scope=ScopeType.LOCAL,
    )
    assert event.region == "alpha"
    assert event.target is None
    assert event.scope is ScopeType.LOCAL


def test_region_and_target_default_to_none() -> None:
    """Optional ``region``/``target`` default to ``None``."""
    event = Event(type="x", source="s", payload={}, scope=ScopeType.GLOBAL)
    assert event.region is None
    assert event.target is None


# ---- timestamp ------------------------------------------------------------


def test_timestamp_is_optional_with_a_float_default() -> None:
    """``timestamp`` is auto-populated with a float when not supplied."""
    event = Event(type="x", source="s", payload={}, scope=ScopeType.GLOBAL)
    assert isinstance(event.timestamp, float)


def test_timestamp_can_be_supplied_explicitly() -> None:
    """Tools may pass ``timestamp=world.now()`` -- it overrides the default."""
    event = Event(
        type="x",
        source="s",
        payload={},
        scope=ScopeType.GLOBAL,
        timestamp=1_000_000.0,
    )
    assert event.timestamp == 1_000_000.0


def test_timestamp_uses_a_default_factory_not_a_shared_default() -> None:
    """The default is produced per-instance (a ``default_factory``)."""
    field_map = {f.name: f for f in dataclasses.fields(Event)}
    timestamp_field = field_map["timestamp"]
    assert timestamp_field.default is dataclasses.MISSING
    assert timestamp_field.default_factory is not dataclasses.MISSING


# ---- slots / mutability ---------------------------------------------------


def test_event_uses_slots() -> None:
    """``Event`` is defined with ``slots=True`` (no per-instance ``__dict__``)."""
    assert hasattr(Event, "__slots__")
    assert set(Event.__slots__) == {
        "type",
        "source",
        "payload",
        "scope",
        "region",
        "target",
        "timestamp",
    }
    event = Event(type="x", source="s", payload={}, scope=ScopeType.GLOBAL)
    assert not hasattr(event, "__dict__")


def test_event_rejects_unknown_attributes_due_to_slots() -> None:
    """Slots prevent accidental attribute creation."""
    event = Event(type="x", source="s", payload={}, scope=ScopeType.GLOBAL)
    with pytest.raises(AttributeError):
        event.unexpected = "nope"  # type: ignore[attr-defined]


def test_event_is_mutable_not_frozen() -> None:
    """``Event`` is a hot-path record: its fields can be reassigned."""
    event = Event(type="x", source="s", payload={}, scope=ScopeType.LOCAL)
    event.target = "wanderer_002"
    event.region = "alpha"
    assert event.target == "wanderer_002"
    assert event.region == "alpha"
