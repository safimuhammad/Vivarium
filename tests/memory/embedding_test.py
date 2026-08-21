"""Tests for :mod:`memory.embedding` -- the deterministic test embedder."""

from __future__ import annotations

from typing import Any

import pytest
from chromadb.utils import embedding_functions
from chromadb.utils.embedding_functions import onnx_mini_lm_l6_v2

from memory.embedding import FakeEmbeddingFunction, default_embedding_function


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


def _fixed_vector(text: str) -> list[float]:
    """Return a deterministic 384-value stand-in for MiniLM output."""
    seed = sum(text.encode("utf-8"))
    return [float((seed + index) % 97) / 97.0 for index in range(384)]


def test_default_embedding_function_constructs_and_retains_one_onnx_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two embedding calls share one retained ONNX model instance."""
    instances: list[Any] = []

    class _FakeOnnx:
        def __init__(self) -> None:
            self.calls: list[list[str]] = []
            instances.append(self)

        def __call__(self, input: list[str]) -> list[list[float]]:
            self.calls.append(input)
            return [_fixed_vector(text) for text in input]

    monkeypatch.setattr(onnx_mini_lm_l6_v2, "ONNXMiniLM_L6_V2", _FakeOnnx)
    embedding = default_embedding_function()

    embedding(["first"])
    embedding(["second"])

    assert len(instances) == 1
    assert instances[0].calls == [["first"], ["second"]]


def test_retained_embedding_matches_current_wrapper_with_384_values(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Retention changes model lifetime, not vector values or dimensions."""

    class _FakeOnnx:
        def __call__(self, input: list[str]) -> list[list[float]]:
            return [_fixed_vector(text) for text in input]

    monkeypatch.setattr(onnx_mini_lm_l6_v2, "ONNXMiniLM_L6_V2", _FakeOnnx)
    current_wrapper = embedding_functions.DefaultEmbeddingFunction()
    retained = default_embedding_function()

    current_vector = current_wrapper(["the road ahead"])[0]
    retained_vector = retained(["the road ahead"])[0]

    assert len(retained_vector) == 384
    assert list(retained_vector) == list(current_vector)


@pytest.mark.integration
def test_real_retained_embedding_matches_default_minilm_vectors() -> None:
    """The cached local MiniLM model returns identical real vectors after retention."""
    legacy = embedding_functions.DefaultEmbeddingFunction()
    retained = default_embedding_function()
    texts = ["the road ahead", "the warm springs remember"]

    legacy_vectors = legacy(texts)
    retained_vectors = retained(texts)

    assert len(retained_vectors) == len(texts)
    for retained_vector, legacy_vector in zip(retained_vectors, legacy_vectors, strict=True):
        assert len(retained_vector) == 384
        assert list(retained_vector) == pytest.approx(list(legacy_vector), abs=0.0)
