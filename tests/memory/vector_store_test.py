"""Tests for :mod:`memory.vector_store` -- run against BOTH the fake and real Chroma.

Parametrizing over ``fake``/``chroma`` proves the in-memory test double and the
real (ephemeral) ChromaDB store share identical observable semantics, so unit
tests can use the fast fake with confidence.
"""

from __future__ import annotations

import itertools
import math

import pytest

from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import ChromaVectorStore, FakeVectorStore, VectorStore

# chromadb's EphemeralClient shares one in-memory backend per process, so each
# test must use a UNIQUE collection name to stay isolated.
_collection_counter = itertools.count()


def _store(kind: str) -> VectorStore:
    ef = FakeEmbeddingFunction(dim=16)
    if kind == "chroma":
        return ChromaVectorStore(f"test-{next(_collection_counter)}", ef)  # in-memory, isolated
    return FakeVectorStore(ef)


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_distances_returns_value_for_every_requested_id(kind: str) -> None:
    store = _store(kind)
    store.upsert("a", "the cat sat on the mat")
    store.upsert("b", "quantum chromodynamics lattice gauge theory")
    distances = store.distances("the cat sat on the mat", ["a", "b"])
    assert set(distances) == {"a", "b"}
    assert distances["a"] < distances["b"]  # query is closer to 'a'


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_missing_id_gets_infinity(kind: str) -> None:
    store = _store(kind)
    store.upsert("a", "hello world")
    distances = store.distances("hello world", ["a", "ghost"])
    assert distances["a"] < math.inf
    assert distances["ghost"] == math.inf


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_upsert_is_idempotent(kind: str) -> None:
    store = _store(kind)
    store.upsert("a", "hello")
    store.upsert("a", "hello")  # no raise on duplicate id
    assert "a" in store.distances("hello", ["a"])


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_empty_ids_returns_empty(kind: str) -> None:
    store = _store(kind)
    store.upsert("a", "hello")
    assert store.distances("hello", []) == {}


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_count_reflects_upserts(kind: str) -> None:
    store = _store(kind)
    assert store.count() == 0
    store.upsert("a", "x")
    store.upsert("b", "y")
    assert store.count() == 2
    store.upsert("a", "x updated")  # same id -> idempotent, still 2
    assert store.count() == 2
