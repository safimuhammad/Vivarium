r"""Append-only event-log sinks: the simulation's replay record.

The event log is *the* way a run is re-watched and (optionally) analysed later:
the live :class:`~world.world.WorldState` is mutated in place, so the ordered
stream of :class:`~bus.events.Event`\ s captured here is what makes a run
re-playable (design DD7 -- replay is from the log, not re-simulation).

This module defines:

* :class:`EventLog` -- the structural protocol a sink satisfies.
* :class:`InMemoryEventLog` -- a list-backed sink for tests/inspection.
* :class:`JsonlEventLog` -- an append-only JSON-Lines sink (one event per line),
  the durable replay record.
* :class:`CompositeEventLog` -- a fan-out sink that forwards ``record`` to several
  underlying sinks (e.g. a durable JSONL log plus a live in-memory feed).
* :class:`FeedEventLog` -- a bounded ring-buffer sink the live activity feed polls
  by a monotonic cursor for only-new events.

Phase 2 wires the :class:`~bus.event_bus.EventBus` to ``record`` every published
event into one of these sinks at a single capture point; this phase only defines
them.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any, Protocol

from bus.events import Event
from core.logging import get_logger

logger = get_logger(__name__)


class EventLog(Protocol):
    """Structural protocol for an append-only event sink."""

    def record(self, event: Event) -> None:
        """Append ``event`` to the log.

        Args:
            event: The event to record.
        """
        ...


class InMemoryEventLog:
    """An :class:`EventLog` that keeps events in a list (for tests/inspection).

    The backing list is private; read recorded events via :attr:`events`.
    """

    def __init__(self) -> None:
        """Initialise an empty in-memory log."""
        self._events: list[Event] = []

    def record(self, event: Event) -> None:
        """Append ``event`` to the in-memory list, preserving call order.

        Args:
            event: The event to record.
        """
        self._events.append(event)

    @property
    def events(self) -> list[Event]:
        """Return the recorded events, oldest first.

        Returns:
            A shallow copy of the recorded events so callers cannot mutate the
            log's internal list.
        """
        return list(self._events)


class JsonlEventLog:
    """An :class:`EventLog` that appends one JSON object per line to a file.

    JSON Lines is append-friendly and stream-parseable, making it a good durable
    replay record. The parent directory is created on construction; each
    :meth:`record` opens the file, appends a single line, and closes it (so a
    crash can lose at most the final partial line).

    Attributes:
        path: Filesystem path of the JSONL file being written.
    """

    def __init__(self, path: str | Path) -> None:
        """Initialise the sink, ensuring the parent directory exists.

        Args:
            path: Destination file path; its parent directory is created if
                missing.

        Side effects:
            Creates the parent directory of ``path`` if it does not exist.
        """
        self.path: Path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def record(self, event: Event) -> None:
        """Append ``event`` to the file as a single JSON line.

        Args:
            event: The event to serialise and append.

        Side effects:
            Appends one newline-terminated JSON line to the file at :attr:`path`.
        """
        line = json.dumps(self._serialise(event), default=str)
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(f"{line}\n")

    @staticmethod
    def _serialise(event: Event) -> dict[str, Any]:
        """Convert an :class:`~bus.events.Event` into a JSON-ready dict.

        The ``scope`` enum is flattened to its string value; any non-JSON value
        inside ``payload`` is stringified by :func:`json.dumps` (``default=str``)
        rather than raising, keeping the sink robust.

        Args:
            event: The event to convert.

        Returns:
            A plain dict ready for :func:`json.dumps`.
        """
        return {
            "type": event.type,
            "source": event.source,
            "payload": event.payload,
            "scope": event.scope.value,
            "region": event.region,
            "target": event.target,
            "timestamp": event.timestamp,
        }


class CompositeEventLog:
    """An :class:`EventLog` that fans ``record`` out to several underlying sinks.

    Lets a single :class:`~bus.event_bus.EventBus` capture point feed multiple
    destinations at once -- e.g. a durable :class:`JsonlEventLog` (the complete
    replay record) plus a :class:`FeedEventLog` (the live terminal feed) -- with no
    bus change, since the bus accepts one ``event_log``.
    """

    def __init__(self, *logs: EventLog) -> None:
        """Initialise the composite over zero or more sinks.

        Args:
            *logs: The underlying sinks to forward each recorded event to, in the
                order given.
        """
        self._logs: tuple[EventLog, ...] = logs

    def record(self, event: Event) -> None:
        """Forward ``event`` to every underlying sink, in registration order.

        Per-sink isolation: a sink that raises (e.g. a :class:`JsonlEventLog` on a
        mid-run disk error) is logged and skipped so it neither blocks the remaining
        sinks (fan-out completeness) nor propagates into the publishing agent's breath
        (crash-resistance / run-forever, ``CLAUDE.md`` Section 1).

        Args:
            event: The event to fan out.

        Side effects:
            Calls ``record(event)`` on each underlying sink (their respective side
            effects -- file appends, buffer growth -- apply); a failing sink is logged
            via :func:`logging.Logger.exception` and skipped.
        """
        for log in self._logs:
            try:
                log.record(event)
            except Exception:
                logger.exception("event-log sink %r failed to record an event; skipping it", log)


class FeedEventLog:
    """A bounded in-memory :class:`EventLog` the live feed polls by a cursor.

    Retains the most recent ``maxlen`` events in a ring buffer plus a monotonic
    total count of everything ever recorded. A renderer polls
    :meth:`new_events` with the cursor it last received to fetch only events
    appended since. If the cursor lags behind the retained window (because the ring
    buffer overflowed and dropped events between polls) the read resumes from the
    oldest retained event and silently skips the dropped ones -- acceptable for a
    live view, since the durable :class:`JsonlEventLog` remains the complete record.
    """

    def __init__(self, maxlen: int = 512) -> None:
        """Initialise an empty bounded feed.

        Args:
            maxlen: Maximum number of most-recent events to retain; older events
                are dropped from the ring buffer once exceeded (the monotonic
                count still advances).
        """
        self._buf: deque[Event] = deque(maxlen=maxlen)
        self._count: int = 0

    def record(self, event: Event) -> None:
        """Append ``event`` to the ring buffer and advance the monotonic count.

        Args:
            event: The event to record.

        Side effects:
            Appends to the bounded buffer (evicting the oldest event if full) and
            increments the total count.
        """
        self._buf.append(event)
        self._count += 1

    def new_events(self, cursor: int) -> tuple[list[Event], int]:
        """Return events recorded since ``cursor`` plus the new cursor to poll with.

        Args:
            cursor: The monotonic count returned by the previous poll (``0`` for a
                first poll).

        Returns:
            A ``(events, cursor)`` pair where ``events`` are the retained events
            with an absolute index ``>= cursor`` (oldest first), and ``cursor`` is
            the current monotonic total to pass to the next call. If ``cursor`` is
            behind the retained window, ``events`` resumes from the oldest retained
            event (dropped events are skipped).
        """
        retained = len(self._buf)
        oldest = self._count - retained  # absolute index of buf[0]
        start = max(cursor, oldest)
        events = list(self._buf)[start - oldest :] if start < self._count else []
        return events, self._count
