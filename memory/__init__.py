"""Agent memory subsystem: durable identity + curated memories + scored retrieval.

See ``docs/superpowers/specs/2026-06-28-sprint5-memory-design.md``. The package
exposes the :class:`~memory.store.MemoryStore` seam (a real file-backed store and
a no-op null store), the :class:`~memory.models.MemoryItem` value object, and the
pure salience scorer. Embedding/similarity is delegated to ChromaDB behind an
injectable seam so unit tests stay deterministic and network-free.
"""

from __future__ import annotations

from memory.models import Importance, MemoryItem

__all__ = ["Importance", "MemoryItem"]
