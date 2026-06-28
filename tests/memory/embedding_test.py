"""Tests for :mod:`memory.embedding` -- the deterministic test embedder."""

from __future__ import annotations

from memory.embedding import FakeEmbeddingFunction


def test_fake_embedding_is_deterministic() -> None:
    ef = FakeEmbeddingFunction(dim=8)
    assert ef(["hello"]) == ef(["hello"])


def test_fake_embedding_distinguishes_texts() -> None:
    ef = FakeEmbeddingFunction(dim=8)
    assert ef(["alpha"]) != ef(["beta"])


def test_fake_embedding_dim_and_batch() -> None:
    ef = FakeEmbeddingFunction(dim=8)
    out = ef(["a", "b", "c"])
    assert len(out) == 3
    assert all(len(vector) == 8 for vector in out)


def test_fake_embedding_vectors_are_unit_length() -> None:
    ef = FakeEmbeddingFunction(dim=16)
    (vector,) = ef(["normalize me"])
    magnitude = sum(component * component for component in vector) ** 0.5
    assert abs(magnitude - 1.0) < 1e-9
