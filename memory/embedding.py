"""Embedding seam for the memory subsystem.

ChromaDB owns vector storage and similarity; this module supplies the *embedding
function* it uses. Production uses Chroma's local ``all-MiniLM-L6-v2`` (CPU /
onnxruntime, via :class:`~chromadb.utils.embedding_functions.DefaultEmbeddingFunction`),
chosen over an Ollama embed model so embedding never contends with the agent
decider on Ollama's sequential backend. Unit tests inject
:class:`FakeEmbeddingFunction` so they are deterministic and never download a model.

The ``__call__(self, input: list[str])`` signature (parameter literally named
``input``) is mandated by ChromaDB, which validates an embedding function's
parameter name; do not rename it.
"""

from __future__ import annotations

import hashlib
import math
from typing import Protocol, cast


class EmbeddingFunction(Protocol):
    """Chroma-compatible embedding function: ``list[str] -> list[list[float]]``."""

    def __call__(self, input: list[str]) -> list[list[float]]:
        """Embed each input string into a fixed-dimension vector."""
        ...


class FakeEmbeddingFunction:
    """Deterministic, network-free embedding for tests.

    Maps each string to a unit vector derived from its SHA-256 digest, so the same
    text always yields the same vector and different texts yield different ones.
    Not semantically meaningful -- it exists to make relevance ordering testable
    without loading a model.
    """

    def __init__(self, dim: int = 16) -> None:
        """Initialise with the embedding dimensionality.

        Args:
            dim: Length of each produced vector (default 16).
        """
        self._dim = dim

    def __call__(self, input: list[str]) -> list[list[float]]:
        """Return one deterministic unit vector per input string.

        Args:
            input: Strings to embed (Chroma's parameter name).

        Returns:
            One unit vector (length ``dim``) per input string, in order.
        """
        return [self._embed(text) for text in input]

    def _embed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        raw = [digest[i % len(digest)] - 127.5 for i in range(self._dim)]
        norm = math.sqrt(sum(component * component for component in raw)) or 1.0
        return [component / norm for component in raw]


def default_embedding_function() -> EmbeddingFunction:  # pragma: no cover - prod model
    """Return Chroma's local ``all-MiniLM-L6-v2`` embedding function (production).

    Uses :class:`DefaultEmbeddingFunction` (onnxruntime; downloads the model on
    first use) rather than the sentence-transformers variant, so no extra runtime
    dependency is required. See :data:`core.constants.EMBED_MODEL`.

    Returns:
        A Chroma-compatible :class:`EmbeddingFunction`.
    """
    from chromadb.utils import embedding_functions

    # Chroma's EF returns numpy arrays; it satisfies our ``list[list[float]]``
    # protocol numerically and is consumed opaquely by the collection. Assert the
    # fit at this boundary (mirrors the ``ollama.AsyncClient`` cast in decider.py).
    return cast(EmbeddingFunction, embedding_functions.DefaultEmbeddingFunction())
