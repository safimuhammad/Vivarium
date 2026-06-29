"""Vector-store seam over ChromaDB for memory relevance.

Defines the :class:`VectorStore` protocol the memory store depends on, a real
:class:`ChromaVectorStore` (embedded, no server), and an in-memory
:class:`FakeVectorStore` for fast deterministic tests. "Relevance" is exposed as a
*distance* (lower = closer, cosine space); the pure scorer converts and normalizes
it. Both implementations share identical observable semantics (asserted by the
parametrized tests).
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any, Protocol

from core.exceptions import MemoryStoreError
from core.logging import get_logger
from memory.embedding import EmbeddingFunction

logger = get_logger(__name__)


class VectorStore(Protocol):
    """Minimal vector surface the memory store needs."""

    def upsert(self, id: str, text: str) -> None:
        """Add or replace the embedding for ``id`` derived from ``text``."""
        ...

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        """Return ``{id: distance}`` for every id in ``ids`` (missing → ``inf``)."""
        ...

    def count(self) -> int:
        """Return how many vectors are currently stored."""
        ...


class ChromaVectorStore:
    """:class:`VectorStore` backed by a ChromaDB collection (cosine space).

    Args:
        collection_name: Logical collection name.
        embedding_function: Chroma-compatible embedding function (fake in tests,
            ``all-MiniLM-L6-v2`` in production).
        path: If given, a persistent on-disk store at ``path``; otherwise an
            ephemeral in-memory client (used by tests).
    """

    def __init__(
        self,
        collection_name: str,
        embedding_function: EmbeddingFunction,
        *,
        path: Path | None = None,
    ) -> None:
        import chromadb

        # We embed via our own seam and hand Chroma raw vectors, so the collection
        # carries NO embedding_function: Chroma is a pure vector index. This avoids
        # coupling to Chroma's EF interface (name()/get_config()/...) and prevents
        # any hidden model download.
        self._embedding_function = embedding_function
        try:
            client = (
                chromadb.PersistentClient(path=str(path))
                if path is not None
                else chromadb.EphemeralClient()
            )
            self._collection: Any = client.get_or_create_collection(
                name=collection_name,
                metadata={"hnsw:space": "cosine"},
            )
        except Exception as exc:  # chromadb raises broad, untyped exceptions
            raise MemoryStoreError(f"failed to open vector store {collection_name!r}") from exc

    def upsert(self, id: str, text: str) -> None:
        """Embed ``text`` via the seam and upsert its vector under ``id``.

        Raises:
            MemoryStoreError: If the underlying Chroma upsert fails.
        """
        embedding = self._embedding_function([text])[0]
        try:
            self._collection.upsert(ids=[id], embeddings=[embedding])
        except Exception as exc:
            raise MemoryStoreError(f"vector upsert failed for {id!r}") from exc

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        """Embed ``query`` and map each requested id to its vector distance.

        Args:
            query: The text to embed and compare against stored vectors.
            ids: The ids to report distances for; ids absent from the query
                result are reported as ``math.inf``.

        Returns:
            ``{id: distance}`` for every id in ``ids`` (lower = more relevant).

        Raises:
            MemoryStoreError: If the underlying Chroma query fails.
        """
        if not ids:
            return {}
        query_embedding = self._embedding_function([query])[0]
        try:
            result = self._collection.query(query_embeddings=[query_embedding], n_results=len(ids))
        except Exception as exc:
            raise MemoryStoreError("vector query failed") from exc
        got = dict(zip(result["ids"][0], result["distances"][0], strict=True))
        return {identifier: float(got.get(identifier, math.inf)) for identifier in ids}

    def count(self) -> int:
        """Return the number of vectors in the collection.

        Raises:
            MemoryStoreError: If the underlying Chroma count fails.
        """
        try:
            return int(self._collection.count())
        except Exception as exc:
            raise MemoryStoreError("vector count failed") from exc


class FakeVectorStore:
    """In-memory cosine vector store for deterministic tests (no chromadb import)."""

    def __init__(self, embedding_function: EmbeddingFunction) -> None:
        """Initialise with the embedding function used to vectorize text."""
        self._ef = embedding_function
        self._vectors: dict[str, list[float]] = {}

    def upsert(self, id: str, text: str) -> None:
        """Embed ``text`` and store (or replace) the vector for ``id``."""
        self._vectors[id] = self._ef([text])[0]

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        """Return cosine distances (``1 - cosine``) from ``query`` to each id."""
        query_vector = self._ef([query])[0]
        out: dict[str, float] = {}
        for identifier in ids:
            vector = self._vectors.get(identifier)
            out[identifier] = math.inf if vector is None else 1.0 - _cosine(query_vector, vector)
        return out

    def count(self) -> int:
        """Return the number of stored vectors."""
        return len(self._vectors)


def _cosine(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two equal-length vectors (0 if either is degenerate)."""
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a)) or 1.0
    norm_b = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (norm_a * norm_b)
