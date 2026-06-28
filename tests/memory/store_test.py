"""Tests for :mod:`memory.store` -- FileMemoryStore (disk + vectors) and the null store."""

from __future__ import annotations

from pathlib import Path

import pytest

from core.exceptions import MemoryStoreError
from memory.embedding import FakeEmbeddingFunction
from memory.models import Importance
from memory.store import FileMemoryStore, NullMemoryStore
from memory.vector_store import FakeVectorStore

PERSONA = "I am Ada, a careful wanderer."


def _store(tmp_path: Path, persona: str = PERSONA) -> FileMemoryStore:
    return FileMemoryStore(
        "wanderer_001",
        tmp_path,
        persona=persona,
        vector_store=FakeVectorStore(FakeEmbeddingFunction()),
        clock=lambda: 42.0,
    )


def test_seed_written_once_and_identity_composes(tmp_path: Path) -> None:
    store = _store(tmp_path)
    assert "Ada" in store.load_identity()  # seed only, identity empty
    store.write_identity("I have learned to distrust Kai.")
    identity = store.load_identity()
    assert "Ada" in identity and "distrust Kai" in identity
    seed_text = (tmp_path / "wanderer_001" / "seed.md").read_text(encoding="utf-8").strip()
    assert seed_text == PERSONA  # seed.md never overwritten


def test_write_identity_is_atomic_and_repeatable(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.write_identity("v1")
    store.write_identity("v2")
    identity = store.load_identity()
    assert "v2" in identity and "v1" not in identity
    assert not (tmp_path / "wanderer_001" / "identity.md.tmp").exists()  # no temp left behind


def test_append_then_retrieve_returns_item(tmp_path: Path) -> None:
    store = _store(tmp_path)
    item = store.append_memory("Kai betrayed me.", Importance.HIGH, breath=3)
    assert item.created_at == 42.0
    assert item.created_breath == 3
    got = store.retrieve("betrayal by Kai", current_breath=4, k=5)
    assert any(m.content == "Kai betrayed me." for m in got)
    jsonl = tmp_path / "wanderer_001" / "memory.jsonl"
    assert jsonl.read_text(encoding="utf-8").count("\n") == 1


def test_retrieve_on_empty_store_returns_empty(tmp_path: Path) -> None:
    assert _store(tmp_path).retrieve("anything", current_breath=0, k=5) == []


def test_ids_are_sequential(tmp_path: Path) -> None:
    store = _store(tmp_path)
    first = store.append_memory("one", Importance.LOW, 1)
    second = store.append_memory("two", Importance.LOW, 2)
    assert first.id == "wanderer_001-0"
    assert second.id == "wanderer_001-1"


def test_jsonl_truncated_last_line_is_ignored_on_load(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.append_memory("complete", Importance.LOW, 1)
    path = tmp_path / "wanderer_001" / "memory.jsonl"
    with path.open("a", encoding="utf-8") as handle:
        handle.write('{"id": "partial", "content": "tru')  # truncated, no newline
    reopened = _store(tmp_path)  # re-open over the corrupt file
    contents = [m.content for m in reopened.retrieve("x", current_breath=2, k=10)]
    assert "complete" in contents
    assert "partial" not in str(contents)


def test_memories_survive_reopen(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.append_memory("a durable thought", Importance.MEDIUM, 1)
    reopened = _store(tmp_path)
    assert any("durable thought" in m.content for m in reopened.retrieve("thought", 2, 5))


def test_init_raises_memory_store_error_when_dir_unmakeable(tmp_path: Path) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("i am a file, not a directory", encoding="utf-8")
    with pytest.raises(MemoryStoreError):
        FileMemoryStore(
            "wanderer_001",
            blocker,  # parent is a file -> mkdir fails
            persona=PERSONA,
            vector_store=FakeVectorStore(FakeEmbeddingFunction()),
            clock=lambda: 0.0,
        )


class _CountingVectorStore:
    """Wraps a FakeVectorStore and counts upserts, to prove reopen skips re-embedding."""

    def __init__(self, inner: FakeVectorStore) -> None:
        self._inner = inner
        self.upserts = 0

    def upsert(self, id: str, text: str) -> None:
        self.upserts += 1
        self._inner.upsert(id, text)

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        return self._inner.distances(query, ids)

    def count(self) -> int:
        return self._inner.count()


def test_reopen_skips_reembedding_when_vectors_present(tmp_path: Path) -> None:
    vector_store = _CountingVectorStore(FakeVectorStore(FakeEmbeddingFunction()))
    first = FileMemoryStore(
        "wanderer_001", tmp_path, persona=PERSONA, vector_store=vector_store, clock=lambda: 0.0
    )
    first.append_memory("one", Importance.LOW, 1)
    first.append_memory("two", Importance.LOW, 2)
    upserts_after_appends = vector_store.upserts  # 2

    # Reopen over the SAME (persistent-like) vector store that already holds vectors.
    second = FileMemoryStore(
        "wanderer_001", tmp_path, persona=PERSONA, vector_store=vector_store, clock=lambda: 0.0
    )

    assert vector_store.upserts == upserts_after_appends  # no re-embedding on reopen
    assert len(second.retrieve("one", current_breath=3, k=5)) >= 1


def test_reopen_rebuilds_when_vectors_missing(tmp_path: Path) -> None:
    # First store persists to jsonl with one vector store...
    seeding = FileMemoryStore(
        "wanderer_001", tmp_path, persona=PERSONA,
        vector_store=FakeVectorStore(FakeEmbeddingFunction()), clock=lambda: 0.0,
    )
    seeding.append_memory("durable", Importance.HIGH, 1)

    # ...reopened with a FRESH (empty) vector store -> count < len -> rebuild.
    rebuilt = _CountingVectorStore(FakeVectorStore(FakeEmbeddingFunction()))
    reopened = FileMemoryStore(
        "wanderer_001", tmp_path, persona=PERSONA, vector_store=rebuilt, clock=lambda: 0.0
    )
    assert rebuilt.upserts == 1  # the loaded item was re-embedded (self-heal)
    assert reopened.retrieve("durable", current_breath=2, k=5)


def test_null_store_is_inert() -> None:
    null = NullMemoryStore()
    assert null.load_identity() == ""
    null.write_identity("ignored")  # no raise, no effect
    assert null.retrieve("q", 0, 5) == []
    item = null.append_memory("dropped", Importance.HIGH, 0)
    assert item.content == "dropped"  # returns a transient value, persists nothing
