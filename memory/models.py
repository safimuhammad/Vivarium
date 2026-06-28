"""Value objects for the memory subsystem: :class:`Importance` and :class:`MemoryItem`.

Unlike the deliberately-mutable :class:`~world.agents.AgentState`, a
:class:`MemoryItem` is a *frozen* value persisted to ``memory.jsonl`` (one JSON
object per line). Newlines in content are JSON-escaped so each item occupies
exactly one physical line, which keeps the append-only log crash-safe (a
truncated final line is the only thing ever lost).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum


class Importance(Enum):
    """Agent-assigned biographical significance of a memory."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

    @classmethod
    def from_str(cls, value: str) -> Importance:
        """Return the member for ``value`` (case-insensitive, surrounding space ignored).

        Args:
            value: One of ``"low"``/``"medium"``/``"high"`` (any case).

        Returns:
            The matching :class:`Importance`.

        Raises:
            ValueError: If ``value`` is not a known importance level.
        """
        return cls(value.strip().lower())


@dataclass(slots=True, frozen=True)
class MemoryItem:
    """A single curated, agent-authored memory.

    Attributes:
        id: Stable id, conventionally ``"{agent_id}-{seq}"`` (seq = line ordinal).
        content: The memory in the agent's own words.
        importance: Agent-assigned significance.
        created_breath: Subjective time of creation (the agent's ``breath_count``).
        created_at: Wall time from the injected clock; logging/replay only.
    """

    id: str
    content: str
    importance: Importance
    created_breath: int
    created_at: float

    def to_jsonl_line(self) -> str:
        """Serialize to a single JSON line (no embedded newlines).

        Returns:
            A one-line JSON object; newlines inside ``content`` are escaped so the
            line is safe to append to the crash-safe ``memory.jsonl`` log.
        """
        return json.dumps(
            {
                "id": self.id,
                "content": self.content,
                "importance": self.importance.value,
                "created_breath": self.created_breath,
                "created_at": self.created_at,
            },
            ensure_ascii=False,
        )

    @classmethod
    def from_jsonl_line(cls, line: str) -> MemoryItem:
        """Parse a :class:`MemoryItem` from one JSON line written by :meth:`to_jsonl_line`.

        Args:
            line: A single JSON line.

        Returns:
            The reconstructed :class:`MemoryItem`.

        Raises:
            ValueError: If the line is not valid JSON or holds an unknown
                importance level.
            KeyError: If a required field is absent.
        """
        data = json.loads(line)
        return cls(
            id=data["id"],
            content=data["content"],
            importance=Importance.from_str(data["importance"]),
            created_breath=int(data["created_breath"]),
            created_at=float(data["created_at"]),
        )
