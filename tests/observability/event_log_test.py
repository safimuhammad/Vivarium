"""Tests for the append-only event-log sinks (:mod:`observability.event_log`).

Covers :class:`observability.event_log.InMemoryEventLog` ordering and
:class:`observability.event_log.JsonlEventLog` producing one parseable JSON line
per recorded event (the replay record). File I/O uses a pytest ``tmp_path``.
"""

from __future__ import annotations

import json
from pathlib import Path

from bus.events import Event, ScopeType
from observability.event_log import (
    CompositeEventLog,
    FeedEventLog,
    InMemoryEventLog,
    JsonlEventLog,
)


def _event(kind: str, source: str = "wanderer_001") -> Event:
    return Event(
        type=kind,
        source=source,
        payload={"message": f"{kind} happened"},
        scope=ScopeType.LOCAL,
        region="alpha",
        timestamp=123.0,
    )


class _RaisingLog:
    """A sink that always raises, to exercise CompositeEventLog isolation."""

    def record(self, event: Event) -> None:
        raise RuntimeError("sink unavailable")


def test_composite_isolates_a_raising_sink() -> None:
    """One sink raising neither blocks the other sinks nor propagates the error.

    Fan-out completeness + crash-resistance: a transient sink failure (e.g. a disk
    error in JsonlEventLog) must not skip the live feed or crash the publisher.
    """
    before = InMemoryEventLog()
    after = InMemoryEventLog()
    composite = CompositeEventLog(before, _RaisingLog(), after)

    event = _event("speak")
    composite.record(event)  # must NOT raise

    assert before.events == [event]
    assert after.events == [event]  # a later sink still receives it


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


def _ev(i: int) -> Event:
    return Event(f"t{i}", "src", {"message": str(i)}, scope=ScopeType.GLOBAL)


def test_composite_fans_out_to_all_sinks() -> None:
    a, b = InMemoryEventLog(), InMemoryEventLog()
    comp = CompositeEventLog(a, b)
    comp.record(_ev(1))
    assert len(a.events) == 1
    assert len(b.events) == 1


def test_feed_cursor_returns_only_new() -> None:
    feed = FeedEventLog(maxlen=10)
    feed.record(_ev(1))
    feed.record(_ev(2))
    new, cursor = feed.new_events(0)
    assert [e.type for e in new] == ["t1", "t2"]
    assert cursor == 2
    feed.record(_ev(3))
    new2, cursor2 = feed.new_events(cursor)
    assert [e.type for e in new2] == ["t3"]
    assert cursor2 == 3


def test_feed_ring_buffer_bounds_and_cursor_resumes_after_overflow() -> None:
    feed = FeedEventLog(maxlen=2)
    for i in range(5):
        feed.record(_ev(i))  # only t3,t4 retained; count == 5
    new, cursor = feed.new_events(0)  # cursor behind the buffer -> resume from oldest kept
    assert [e.type for e in new] == ["t3", "t4"]
    assert cursor == 5
