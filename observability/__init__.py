"""Observability: append-only event-log sinks (the replay record).

Re-exports the event-log protocol and its in-memory / JSONL implementations; see
:mod:`observability.event_log`.
"""

from __future__ import annotations

from observability.event_log import EventLog, InMemoryEventLog, JsonlEventLog

__all__ = ["EventLog", "InMemoryEventLog", "JsonlEventLog"]
