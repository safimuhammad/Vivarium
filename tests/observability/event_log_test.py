"""Tests for the append-only event-log sinks (:mod:`observability.event_log`).

Covers :class:`observability.event_log.InMemoryEventLog` ordering and
:class:`observability.event_log.JsonlEventLog` producing one parseable JSON line
per recorded event (the replay record). File I/O uses a pytest ``tmp_path``.
"""

from __future__ import annotations

import json
from pathlib import Path

from bus.events import Event, ScopeType
from observability.event_log import InMemoryEventLog, JsonlEventLog


def _event(kind: str, source: str = "wanderer_001") -> Event:
    return Event(
        type=kind,
        source=source,
        payload={"message": f"{kind} happened"},
        scope=ScopeType.LOCAL,
        region="alpha",
        timestamp=123.0,
    )


def test_in_memory_log_records_in_order() -> None:
    log = InMemoryEventLog()
    first = _event("speak")
    second = _event("attack")
    log.record(first)
    log.record(second)
    assert log.events == [first, second]


def test_in_memory_events_property_is_a_copy() -> None:
    log = InMemoryEventLog()
    log.record(_event("speak"))
    snapshot = log.events
    snapshot.clear()
    assert len(log.events) == 1


def test_jsonl_log_writes_one_parseable_line_per_event(tmp_path: Path) -> None:
    path = tmp_path / "events.jsonl"
    log = JsonlEventLog(path)
    log.record(_event("speak"))
    log.record(_event("attack", source="wanderer_002"))

    lines = path.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 2
    records = [json.loads(line) for line in lines]
    assert records[0]["type"] == "speak"
    assert records[0]["scope"] == "local"
    assert records[0]["region"] == "alpha"
    assert records[0]["payload"] == {"message": "speak happened"}
    assert records[1]["source"] == "wanderer_002"


def test_jsonl_log_creates_missing_parent_and_appends(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "events.jsonl"
    log = JsonlEventLog(path)
    log.record(_event("speak"))
    log.record(_event("wait"))
    assert len(path.read_text(encoding="utf-8").splitlines()) == 2
