"""The :class:`MemoryStore` seam and its file-backed and null implementations.

:class:`FileMemoryStore` is one agent's durable memory on disk: an immutable
``seed.md`` (the birth persona, written once), a mutable ``identity.md`` (the
self-narrative, rewritten atomically by reflection), and an append-only
``memory.jsonl`` of curated memories mirrored into a :class:`VectorStore` for
relevance. :class:`NullMemoryStore` is an inert Null Object used when an agent has
no configured memory, so the breathing loop runs unchanged without one.

The store depends on a :class:`VectorStore` and a clock callable (both injected),
so unit tests use a fake vector store and a fixed clock and never touch a model.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

from core import constants
from core.exceptions import MemoryStoreError
from core.logging import get_logger
from memory.models import Importance, MemoryItem
from memory.scoring import score_memories
from memory.vector_store import VectorStore

logger = get_logger(__name__)


class MemoryStore(Protocol):
    """Per-agent durable memory: identity + curated memories + scored retrieval."""

    def load_identity(self) -> str:
        """Return the agent's full identity text (seed plus self-narrative)."""
        ...

    def write_identity(self, new_self: str) -> None:
        """Atomically replace the mutable self-narrative."""
        ...

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        """Persist a new curated memory and return it."""
        ...

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        """Return the top-``k`` memories for ``query`` by salience score."""
        ...


class FileMemoryStore:
    """File-backed memory: ``seed.md`` + ``identity.md`` + ``memory.jsonl`` + a vector store.

    Args:
        agent_id: The owning agent's id; also the per-agent directory name.
        root: Root directory under which ``{agent_id}/`` is created.
        persona: Birth persona; written once to ``seed.md`` if absent.
        vector_store: Injected vector store for the relevance term.
        clock: Injected ``() -> float`` for memory ``created_at`` stamps.

    Raises:
        MemoryStoreError: If the per-agent directory cannot be created.
    """

    def __init__(
        self,
        agent_id: str,
        root: Path,
        *,
        persona: str,
        vector_store: VectorStore,
        clock: Callable[[], float],
    ) -> None:
        self._agent_id = agent_id
        self._dir = Path(root) / agent_id
        self._clock = clock
        self._vector_store = vector_store
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise MemoryStoreError(f"cannot create memory dir {self._dir}") from exc
        self._seed_path = self._dir / "seed.md"
        self._identity_path = self._dir / "identity.md"
        self._jsonl_path = self._dir / "memory.jsonl"
        if not self._seed_path.exists():
            self._seed_path.write_text(persona, encoding="utf-8")
        self._items: list[MemoryItem] = self._load_items()
        # Idempotent: ensures every persisted memory has a vector after a restart
        # (the jsonl is the source of truth; the vector store is a rebuildable index).
        for item in self._items:
            self._vector_store.upsert(item.id, item.content)

    def load_identity(self) -> str:
        """Return ``seed`` plus the self-narrative (if any), separated by a blank line."""
        seed = self._seed_path.read_text(encoding="utf-8").strip()
        self_narrative = (
            self._identity_path.read_text(encoding="utf-8").strip()
            if self._identity_path.exists()
            else ""
        )
        return f"{seed}\n\n{self_narrative}" if self_narrative else seed

    def write_identity(self, new_self: str) -> None:
        """Atomically replace ``identity.md`` (temp file + ``os.replace``); seed untouched.

        Raises:
            MemoryStoreError: If the write or rename fails.
        """
        tmp = self._identity_path.with_name(self._identity_path.name + ".tmp")
        try:
            tmp.write_text(new_self, encoding="utf-8")
            os.replace(tmp, self._identity_path)  # atomic rename on POSIX
        except OSError as exc:
            raise MemoryStoreError("failed to write identity") from exc

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        """Append a memory to ``memory.jsonl`` and add it to the vector store.

        Args:
            content: The memory text (the agent's own words).
            importance: Agent-assigned significance.
            breath: The agent's current ``breath_count`` (subjective creation time).

        Returns:
            The persisted :class:`MemoryItem`.

        Raises:
            MemoryStoreError: If the append fails.
        """
        item = MemoryItem(
            id=f"{self._agent_id}-{len(self._items)}",
            content=content,
            importance=importance,
            created_breath=breath,
            created_at=self._clock(),
        )
        try:
            with self._jsonl_path.open("a", encoding="utf-8") as handle:
                handle.write(item.to_jsonl_line() + "\n")
        except OSError as exc:
            raise MemoryStoreError("failed to append memory") from exc
        self._items.append(item)
        self._vector_store.upsert(item.id, item.content)
        return item

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        """Return the top-``k`` memories for ``query`` by the salience score."""
        if not self._items:
            return []
        distances = self._vector_store.distances(query, [item.id for item in self._items])
        return score_memories(
            self._items,
            distances,
            current_breath,
            k,
            w_recency=constants.W_RECENCY,
            w_importance=constants.W_IMPORTANCE,
            w_relevance=constants.W_RELEVANCE,
            recency_decay=constants.RECENCY_DECAY,
            importance_weights=constants.IMPORTANCE_WEIGHTS,
        )

    def _load_items(self) -> list[MemoryItem]:
        """Load all complete memories from ``memory.jsonl``; discard a corrupt final line."""
        if not self._jsonl_path.exists():
            return []
        items: list[MemoryItem] = []
        for line in self._jsonl_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                items.append(MemoryItem.from_jsonl_line(line))
            except (ValueError, KeyError):
                logger.warning("Discarding corrupt memory line for %s", self._agent_id)
        return items


class NullMemoryStore:
    """Inert :class:`MemoryStore` used when an agent has no configured memory.

    Every method is a no-op: identity is empty (the agent falls back to its
    persona), nothing is persisted, and retrieval surfaces nothing. Lets the
    breathing loop run identically with or without a real memory.
    """

    def load_identity(self) -> str:
        """Return an empty identity (the agent falls back to its persona)."""
        return ""

    def write_identity(self, new_self: str) -> None:
        """Discard the new self-narrative (no-op)."""
        return None

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        """Return a transient, unpersisted :class:`MemoryItem` (nothing is stored)."""
        return MemoryItem("null", content, importance, breath, 0.0)

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        """Return no memories."""
        return []


NULL_MEMORY: MemoryStore = NullMemoryStore()
"""Shared inert store; the default an :class:`~agents.runtime.Agent` uses without memory."""
