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

Phase 2 wires the :class:`~bus.event_bus.EventBus` to ``record`` every published
event into one of these sinks at a single capture point; this phase only defines
them.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from bus.events import Event


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
