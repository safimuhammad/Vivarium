# Sprint 5 Memory Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each agent durable, self-authored memory (identity + curated memories + a reflection write-path) with salience-aware retrieval, then benchmark and optimize its memory performance end-to-end.

**Architecture:** A new `memory/` package exposes a `MemoryStore` *Protocol* (seam, like `Decider`) with a real `FileMemoryStore` (per-agent `seed.md`/`identity.md`/`memory.jsonl` + a ChromaDB vector store) and a `NullMemoryStore` no-op default. A pure scorer ranks memories by `recency × importance × relevance`. The agent writes memories via a dedicated **reflection step** (an isolated decider call with only `remember`/`revise_self` tools), not an action-menu tool — justified by the qwen3:8b spike. A benchmark harness measures per-breath overhead, retrieval/embedding latency, reflection cost, and footprint growth; an optimization phase tunes the `core/constants.py` dials against measured targets.

**Tech Stack:** Python 3.13, `chromadb` (embedded `PersistentClient` + `all-MiniLM-L6-v2`), `pytest`/`pytest-asyncio`/`pytest-cov`, `ruff`, `mypy --strict`.

## Global Constraints

Every task implicitly includes these (copied verbatim from the spec & CLAUDE.md):

- **Python 3.13**; modern syntax — `str | None` not `Optional`, `list[X]`/`dict[str, X]`, `Callable[[...], ...]`.
- **`mypy --strict` clean** on `memory/`, `agents/`. Type-hint every param and return (incl. `-> None`).
- **Google-style docstrings** on every module, class, and public function — tools/stores document *which state they mutate and which files/events they touch*.
- **`ruff` clean** (line-length 100; rules `E,W,F,I,UP,B,C4,SIM,N,RUF`).
- **No `print()` in library code.** Use `logger = get_logger(__name__)` from `core.logging`.
- **Determinism:** no live model/Ollama in unit tests; inject a fake embedder + Ephemeral Chroma; seed all RNG (`SEED = 1234`, via `world.rng`); time via an injected `clock: Callable[[], float]` (recency uses *subjective* breath counts, not wall time).
- **Constants centralized** in `core/constants.py` with `[code]`/`[doc]` provenance comments — no magic numbers in `memory/`.
- **Tests:** filename `*_test.py`; `asyncio_mode = "auto"` (no `@pytest.mark.asyncio` needed); live tests marked `@pytest.mark.integration` (excluded from default run).
- **Coverage ≥ 90%** on `memory/` (add `"memory"` to `[tool.coverage.run] source`).
- **Infra errors** raise `MemoryStoreError(VivariumError)` and are logged; **agent-facing** reflection failures never raise.
- **Agent-facing strings** from any agent-callable surface follow the `"Error: "` / `"Invalid: "` / plain-success convention (DD9: no simulation language).

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `memory/__init__.py` | Package marker; re-export `MemoryStore`, `FileMemoryStore`, `NullMemoryStore`, `MemoryItem`, `Importance`. |
| `memory/models.py` | `Importance` enum + `MemoryItem` frozen dataclass + jsonl (de)serialization. |
| `memory/scoring.py` | Pure scorer: `score_memories(items, distances, current_breath, k, weights) -> list[MemoryItem]`. |
| `memory/embedding.py` | `EmbeddingFunction` Protocol + `FakeEmbeddingFunction` (deterministic) + `default_embedding_function()` (Chroma all-MiniLM, prod). |
| `memory/vector_store.py` | `VectorStore` Protocol + `ChromaVectorStore` (Ephemeral/Persistent) + `FakeVectorStore`. |
| `memory/store.py` | `MemoryStore` Protocol + `FileMemoryStore` + `NullMemoryStore` (+ `NULL_MEMORY` singleton). |
| `agents/reflection.py` | Reflection tool schemas (`remember`, `revise_self`), recap renderer, reflective prompt. |
| `bench/bench_memory.py` | Benchmark harness (deterministic micro-bench + live e2e). |
| `docs/superpowers/benchmarks/2026-06-28-memory-perf.md` | Benchmark results + optimization log (written in Tasks 12–13). |
| `tests/memory/{__init__,models_test,scoring_test,embedding_test,vector_store_test,store_test}.py` | Unit tests for `memory/`. |
| `tests/agents/reflection_test.py` | Reflection schemas/recap/prompt + reflect-step tests. |

**Modified files**

| File | Change |
|---|---|
| `core/exceptions.py` | Add `MemoryStoreError(VivariumError)`. |
| `core/constants.py` | Add the §7 memory dials. |
| `agents/runtime.py` | `Agent.__init__` gains `memory: MemoryStore | None = None`; `_load_system_prompt` via memory; `perceive()` injects memories; add `reflect()` + trigger in `breathe()`. |
| `pyproject.toml` | Add `chromadb` runtime dep; add `"memory"` to coverage source; add `chromadb.*` to mypy `ignore_missing_imports`. |
| `tests/conftest.py` | Add `fake_embedder`, `fake_vector_store`, `memory_store`, and `memory_agent` fixtures. |

---

## Task 1: Project plumbing (deps, exception, coverage, package)

**Files:**
- Modify: `pyproject.toml`
- Modify: `core/exceptions.py`
- Create: `memory/__init__.py`
- Test: `tests/core/exceptions_test.py` (extend)

**Interfaces:**
- Produces: `MemoryStoreError` (subclass of `VivariumError`); the `memory` package; `chromadb` available; coverage tracks `memory`.

- [ ] **Step 1: Write the failing test** — append to `tests/core/exceptions_test.py`:

```python
def test_memory_store_error_is_vivarium_error():
    from core.exceptions import MemoryStoreError, VivariumError

    assert issubclass(MemoryStoreError, VivariumError)
    with pytest.raises(VivariumError):
        raise MemoryStoreError("disk gone")
```

- [ ] **Step 2: Run it, verify it fails** — `pytest tests/core/exceptions_test.py -v` → FAIL (ImportError).

- [ ] **Step 3: Add the exception** — append to `core/exceptions.py`:

```python
class MemoryStoreError(VivariumError):
    """Raised for infrastructure failures in the agent memory subsystem.

    Examples: a memory directory that cannot be created, a corrupt vector store,
    or a failed atomic write of an identity/memory file. Named to avoid shadowing
    the Python builtin ``MemoryError``. Agent-facing reflection failures (the
    model authoring nothing) are NOT this -- they are simply skipped.
    """
```

- [ ] **Step 4: Create the package** — `memory/__init__.py`:

```python
"""Agent memory subsystem: durable identity + curated memories + scored retrieval.

See ``docs/superpowers/specs/2026-06-28-sprint5-memory-design.md``. The package
exposes the :class:`~memory.store.MemoryStore` seam (a real file-backed store and
a no-op null store), the :class:`~memory.models.MemoryItem` value object, and the
pure salience scorer. Embedding/similarity is delegated to ChromaDB behind an
injectable seam so unit tests stay deterministic and network-free.
"""

from __future__ import annotations
```
(Re-exports are added at the end of Tasks 2 & 6, once the names exist.)

- [ ] **Step 5: Update `pyproject.toml`** — (a) add `"chromadb"` to `dependencies`; (b) add `"memory"` to `[tool.coverage.run] source`; (c) add `"chromadb.*"` to the mypy `ignore_missing_imports` override module list; (d) add `"memory*"` to `[tool.setuptools.packages.find] include`.

- [ ] **Step 6: Install & verify** — `pip install -e ".[dev]" && pip install chromadb` then `python -c "import chromadb; print(chromadb.__version__)"`.

- [ ] **Step 7: Run tests** — `pytest tests/core/exceptions_test.py -v` → PASS.

- [ ] **Step 8: Commit** — `git add -A && git commit -m "build(sprint5-T1): memory package scaffolding + MemoryStoreError + chromadb dep"`.

---

## Task 2: `memory/models.py` — `Importance` + `MemoryItem`

**Files:**
- Create: `memory/models.py`
- Test: `tests/memory/__init__.py`, `tests/memory/models_test.py`

**Interfaces:**
- Produces:
  - `class Importance(Enum)`: `LOW="low"`, `MEDIUM="medium"`, `HIGH="high"`; classmethod `from_str(value: str) -> Importance`.
  - `@dataclass(slots=True, frozen=True) class MemoryItem`: `id: str`, `content: str`, `importance: Importance`, `created_breath: int`, `created_at: float`; `to_jsonl_line() -> str`; classmethod `from_jsonl_line(line: str) -> MemoryItem`.

- [ ] **Step 1: Write the failing tests** — `tests/memory/models_test.py`:

```python
from memory.models import Importance, MemoryItem


def test_importance_from_str_is_case_insensitive():
    assert Importance.from_str("HIGH") is Importance.HIGH
    assert Importance.from_str("medium") is Importance.MEDIUM


def test_importance_from_str_rejects_unknown():
    import pytest

    with pytest.raises(ValueError):
        Importance.from_str("urgent")


def test_memory_item_roundtrips_through_jsonl():
    item = MemoryItem(
        id="wanderer_001-0",
        content="Kai betrayed me in the meadow.",
        importance=Importance.HIGH,
        created_breath=7,
        created_at=123.5,
    )
    restored = MemoryItem.from_jsonl_line(item.to_jsonl_line())
    assert restored == item


def test_jsonl_line_is_single_line_json():
    item = MemoryItem("a-0", "multi\nline\ncontent", Importance.LOW, 1, 0.0)
    line = item.to_jsonl_line()
    assert line.count("\n") == 0  # newlines in content are JSON-escaped
```

- [ ] **Step 2: Run, verify fail** — `pytest tests/memory/models_test.py -v` → FAIL.

- [ ] **Step 3: Implement** — `memory/models.py`:

```python
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
        """Return the member for ``value`` (case-insensitive).

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
        """Serialize to a single JSON line (no embedded newlines)."""
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
        """Parse a :class:`MemoryItem` from one JSON line written by :meth:`to_jsonl_line`."""
        data = json.loads(line)
        return cls(
            id=data["id"],
            content=data["content"],
            importance=Importance.from_str(data["importance"]),
            created_breath=int(data["created_breath"]),
            created_at=float(data["created_at"]),
        )
```

- [ ] **Step 4: Run, verify pass** — `pytest tests/memory/models_test.py -v` → PASS.

- [ ] **Step 5: Re-export** — in `memory/__init__.py` append `from memory.models import Importance, MemoryItem`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(sprint5-T2): MemoryItem + Importance value objects"`.

---

## Task 3: `core/constants.py` — memory dials

**Files:**
- Modify: `core/constants.py`
- Test: `tests/core/constants_test.py` (extend)

**Interfaces:**
- Produces: `REFLECT_EVERY_N_BREATHS: int=12`, `REFLECT_RECAP_TURNS: int=6`, `RETRIEVAL_K: int=5`, `RECENCY_DECAY: float=0.97`, `W_RECENCY/W_IMPORTANCE/W_RELEVANCE: float=1.0`, `IMPORTANCE_WEIGHTS: dict[Importance, float]`, `EMBED_MODEL: str="all-MiniLM-L6-v2"`, `MEMORY_ROOT: Path=Path("./memory")`.

- [ ] **Step 1: Write the failing test** — append to `tests/core/constants_test.py`:

```python
def test_memory_dials_present_and_sane():
    from memory.models import Importance
    from core import constants as c

    assert c.REFLECT_EVERY_N_BREATHS >= 1
    assert 0.0 < c.RECENCY_DECAY <= 1.0
    assert c.RETRIEVAL_K >= 1
    assert set(c.IMPORTANCE_WEIGHTS) == set(Importance)
    assert c.IMPORTANCE_WEIGHTS[Importance.HIGH] > c.IMPORTANCE_WEIGHTS[Importance.LOW]
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — append a "Memory subsystem" section to `core/constants.py`:

```python
# ---------------------------------------------------------------------------
# Memory subsystem (Sprint 5)  [design: 2026-06-28-sprint5-memory-design.md §7]
# ---------------------------------------------------------------------------

from pathlib import Path  # noqa: E402  (grouped with the section that uses it)

from memory.models import Importance  # noqa: E402

REFLECT_EVERY_N_BREATHS: Final[int] = 12
"""Reflection cadence: a dedicated reflection step runs every N breaths."""

REFLECT_RECAP_TURNS: Final[int] = 6
"""How many recent lifecycle turns the reflection step is shown as a recap."""

RETRIEVAL_K: Final[int] = 5
"""Number of memories surfaced into perception per breath."""

RECENCY_DECAY: Final[float] = 0.97
"""Per-breath exponential decay base for the recency term (subjective time)."""

W_RECENCY: Final[float] = 1.0
W_IMPORTANCE: Final[float] = 1.0
W_RELEVANCE: Final[float] = 1.0
"""Scorer weights (equal-weight start, per Generative Agents). Tunable dials."""

IMPORTANCE_WEIGHTS: Final[dict[Importance, float]] = {
    Importance.LOW: 0.3,
    Importance.MEDIUM: 0.6,
    Importance.HIGH: 1.0,
}
"""Numeric weight per agent-assigned importance level."""

EMBED_MODEL: Final[str] = "all-MiniLM-L6-v2"
"""Local sentence-transformer used by ChromaDB in production (not via Ollama)."""

MEMORY_ROOT: Final[Path] = Path("./memory")
"""Default root directory under which per-agent memory dirs are created."""
```
> Note: importing `Importance` into `core.constants` creates `core -> memory.models` dependency. `memory.models` imports only stdlib, so there is no cycle. If a reviewer objects to the layering, change `IMPORTANCE_WEIGHTS` keys to the string values (`"low"/"medium"/"high"`) and resolve in the scorer.

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sprint5-T3): memory-subsystem constants (the §7 dials)"`.

---

## Task 4: `memory/embedding.py` — embedding seam

**Files:**
- Create: `memory/embedding.py`
- Test: `tests/memory/embedding_test.py`

**Interfaces:**
- Produces:
  - `class EmbeddingFunction(Protocol)`: `def __call__(self, input: list[str]) -> list[list[float]]` (Chroma's EF calling convention).
  - `class FakeEmbeddingFunction`: deterministic — maps text to a fixed-dim vector from a hash, so identical text → identical vector and "closeness" is controllable in tests.
  - `def default_embedding_function() -> EmbeddingFunction`: returns Chroma's `all-MiniLM-L6-v2` EF (prod; `# pragma: no cover`).

- [ ] **Step 1: Write the failing tests** — `tests/memory/embedding_test.py`:

```python
from memory.embedding import FakeEmbeddingFunction


def test_fake_embedding_is_deterministic():
    ef = FakeEmbeddingFunction(dim=8)
    assert ef(["hello"]) == ef(["hello"])


def test_fake_embedding_distinguishes_texts():
    ef = FakeEmbeddingFunction(dim=8)
    assert ef(["alpha"]) != ef(["beta"])


def test_fake_embedding_dim_and_batch():
    ef = FakeEmbeddingFunction(dim=8)
    out = ef(["a", "b", "c"])
    assert len(out) == 3 and all(len(v) == 8 for v in out)
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `memory/embedding.py`:

```python
"""Embedding seam for the memory subsystem.

ChromaDB owns vector storage and similarity; this module supplies the *embedding
function* it uses. Production uses Chroma's local ``all-MiniLM-L6-v2`` (CPU /
onnxruntime), chosen over an Ollama embed model so embedding never contends with
the agent decider on Ollama's sequential backend. Unit tests inject
:class:`FakeEmbeddingFunction` so they are deterministic and never download a model.
"""

from __future__ import annotations

import hashlib
import math
from typing import Protocol


class EmbeddingFunction(Protocol):
    """Chroma-compatible embedding function: ``list[str] -> list[list[float]]``."""

    def __call__(self, input: list[str]) -> list[list[float]]:  # noqa: A002 (Chroma's name)
        """Embed each input string into a fixed-dimension vector."""
        ...


class FakeEmbeddingFunction:
    """Deterministic, network-free embedding for tests.

    Maps each string to a unit vector derived from its SHA-256 digest, so the same
    text always yields the same vector and different texts yield different ones.
    Not semantically meaningful -- it exists to make relevance ordering testable.
    """

    def __init__(self, dim: int = 16) -> None:
        """Initialise with the embedding dimensionality (default 16)."""
        self._dim = dim

    def __call__(self, input: list[str]) -> list[list[float]]:  # noqa: A002
        """Return one deterministic unit vector per input string."""
        return [self._embed(text) for text in input]

    def _embed(self, text: str) -> list[float]:
        digest = hashlib.sha256(text.encode("utf-8")).digest()
        raw = [digest[i % len(digest)] - 127.5 for i in range(self._dim)]
        norm = math.sqrt(sum(x * x for x in raw)) or 1.0
        return [x / norm for x in raw]


def default_embedding_function() -> EmbeddingFunction:  # pragma: no cover - prod model
    """Return Chroma's local ``all-MiniLM-L6-v2`` embedding function (production)."""
    from chromadb.utils import embedding_functions
    from core.constants import EMBED_MODEL

    return embedding_functions.SentenceTransformerEmbeddingFunction(model_name=EMBED_MODEL)
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sprint5-T4): embedding seam (FakeEmbeddingFunction + MiniLM default)"`.

---

## Task 5: `memory/vector_store.py` — Chroma seam

**Files:**
- Create: `memory/vector_store.py`
- Test: `tests/memory/vector_store_test.py`

**Interfaces:**
- Consumes: `EmbeddingFunction`, `FakeEmbeddingFunction` (Task 4); `MemoryStoreError` (Task 1).
- Produces:
  - `class VectorStore(Protocol)`: `upsert(self, id: str, text: str) -> None`; `distances(self, query: str, ids: list[str]) -> dict[str, float]` (returns a distance for every requested id; missing ids get `math.inf`).
  - `class ChromaVectorStore`: `__init__(self, collection_name: str, embedding_function: EmbeddingFunction, *, path: Path | None = None)` — `path=None` → `EphemeralClient` (tests), else `PersistentClient(path)`.
  - `class FakeVectorStore`: in-memory cosine over `FakeEmbeddingFunction`, same interface (used by store tests without importing chromadb).

- [ ] **Step 1: Write the failing tests** — `tests/memory/vector_store_test.py`:

```python
import math

from memory.embedding import FakeEmbeddingFunction
from memory.vector_store import ChromaVectorStore, FakeVectorStore


def _store(kind):
    ef = FakeEmbeddingFunction(dim=16)
    if kind == "chroma":
        return ChromaVectorStore("test", ef)  # EphemeralClient
    return FakeVectorStore(ef)


import pytest


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_distances_returns_value_for_every_requested_id(kind):
    store = _store(kind)
    store.upsert("a", "the cat sat")
    store.upsert("b", "quantum chromodynamics")
    d = store.distances("the cat sat on the mat", ["a", "b"])
    assert set(d) == {"a", "b"}
    assert d["a"] < d["b"]  # query is closer to 'a'


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_missing_id_gets_infinity(kind):
    store = _store(kind)
    store.upsert("a", "hello")
    d = store.distances("hello", ["a", "ghost"])
    assert d["a"] < math.inf
    assert d["ghost"] == math.inf


@pytest.mark.parametrize("kind", ["fake", "chroma"])
def test_upsert_is_idempotent(kind):
    store = _store(kind)
    store.upsert("a", "hello")
    store.upsert("a", "hello")  # no raise on duplicate id
    assert "a" in store.distances("hello", ["a"])
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `memory/vector_store.py`:

```python
"""Vector-store seam over ChromaDB for memory relevance.

Defines the :class:`VectorStore` protocol the memory store depends on, a real
:class:`ChromaVectorStore` (embedded, no server), and an in-memory
:class:`FakeVectorStore` for fast deterministic tests. "Relevance" is exposed as a
*distance* (lower = closer); the pure scorer converts and normalizes it.
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

    def upsert(self, id: str, text: str) -> None:  # noqa: A002 (id mirrors Chroma)
        """Add or replace the embedding for ``id`` derived from ``text``."""
        ...

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        """Return ``{id: distance}`` for every id in ``ids`` (missing → ``inf``)."""
        ...


class ChromaVectorStore:
    """:class:`VectorStore` backed by a ChromaDB collection.

    Args:
        collection_name: Logical collection name.
        embedding_function: Chroma-compatible embedding function (fake in tests).
        path: If given, a persistent on-disk store at ``path``; otherwise an
            ephemeral in-memory client.
    """

    def __init__(
        self,
        collection_name: str,
        embedding_function: EmbeddingFunction,
        *,
        path: Path | None = None,
    ) -> None:
        import chromadb

        try:
            client = (
                chromadb.PersistentClient(path=str(path))
                if path is not None
                else chromadb.EphemeralClient()
            )
            self._collection: Any = client.get_or_create_collection(
                name=collection_name,
                embedding_function=embedding_function,  # type: ignore[arg-type]
                metadata={"hnsw:space": "cosine"},
            )
        except Exception as exc:  # chromadb raises broad exceptions
            raise MemoryStoreError(f"failed to open vector store {collection_name!r}") from exc

    def upsert(self, id: str, text: str) -> None:  # noqa: A002
        """Upsert one document (id + text) into the collection."""
        try:
            self._collection.upsert(ids=[id], documents=[text])
        except Exception as exc:
            raise MemoryStoreError(f"vector upsert failed for {id!r}") from exc

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        """Query the collection and map each requested id to its distance."""
        if not ids:
            return {}
        try:
            result = self._collection.query(query_texts=[query], n_results=len(ids))
        except Exception as exc:
            raise MemoryStoreError("vector query failed") from exc
        got = dict(zip(result["ids"][0], result["distances"][0], strict=True))
        return {i: got.get(i, math.inf) for i in ids}


class FakeVectorStore:
    """In-memory cosine vector store for deterministic tests (no chromadb import)."""

    def __init__(self, embedding_function: EmbeddingFunction) -> None:
        self._ef = embedding_function
        self._vecs: dict[str, list[float]] = {}

    def upsert(self, id: str, text: str) -> None:  # noqa: A002
        self._vecs[id] = self._ef([text])[0]

    def distances(self, query: str, ids: list[str]) -> dict[str, float]:
        q = self._ef([query])[0]
        out: dict[str, float] = {}
        for i in ids:
            v = self._vecs.get(i)
            out[i] = math.inf if v is None else 1.0 - _cosine(q, v)
        return out


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
```

- [ ] **Step 4: Run, verify pass** — `pytest tests/memory/vector_store_test.py -v`. (Chroma params exercise the real embedded client with the fake EF — fast, no model download.)

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sprint5-T5): Chroma + fake vector-store seam"`.

---

## Task 6: `memory/scoring.py` — the salience scorer  ⟵ HUMAN CONTRIBUTION POINT

**Files:**
- Create: `memory/scoring.py`
- Test: `tests/memory/scoring_test.py`

**Interfaces:**
- Consumes: `MemoryItem`, `Importance` (Task 2); constants (Task 3).
- Produces: `def score_memories(items: list[MemoryItem], distances: dict[str, float], current_breath: int, k: int, *, w_recency: float, w_importance: float, w_relevance: float, recency_decay: float, importance_weights: dict[Importance, float]) -> list[MemoryItem]` — returns the top-`k` items by combined score, highest first.

> **Note (learning mode):** the *term-combination + normalization* in `_combined_scores` is a genuine design decision (min–max normalize each term, then weighted sum). During execution this is offered to the human as a `TODO(human)` (see §"Learn by Doing" handoff). The plan specifies the surrounding pure function and tests; the human fills the 5–8 line combine.

- [ ] **Step 1: Write the failing tests** — `tests/memory/scoring_test.py`:

```python
from memory.models import Importance, MemoryItem
from memory.scoring import score_memories

WEIGHTS = {Importance.LOW: 0.3, Importance.MEDIUM: 0.6, Importance.HIGH: 1.0}


def _item(id_, breath, imp):
    return MemoryItem(id_, f"content-{id_}", imp, breath, 0.0)


def _score(items, distances, breath, k, *, wr=1.0, wi=1.0, wv=1.0):
    return score_memories(
        items, distances, breath, k,
        w_recency=wr, w_importance=wi, w_relevance=wv,
        recency_decay=0.97, importance_weights=WEIGHTS,
    )


def test_recency_dominates_when_other_terms_equal():
    items = [_item("old", 0, Importance.MEDIUM), _item("new", 9, Importance.MEDIUM)]
    dist = {"old": 0.5, "new": 0.5}
    ranked = _score(items, dist, current_breath=10, k=2, wi=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["new", "old"]


def test_importance_dominates_when_other_terms_equal():
    items = [_item("low", 5, Importance.LOW), _item("high", 5, Importance.HIGH)]
    dist = {"low": 0.5, "high": 0.5}
    ranked = _score(items, dist, current_breath=5, k=2, wr=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["high", "low"]


def test_relevance_dominates_when_other_terms_equal():
    items = [_item("far", 5, Importance.MEDIUM), _item("near", 5, Importance.MEDIUM)]
    dist = {"far": 0.9, "near": 0.1}
    ranked = _score(items, dist, current_breath=5, k=2, wr=0.0, wi=0.0)
    assert [m.id for m in ranked] == ["near", "far"]


def test_topk_limits_and_orders():
    items = [_item(str(i), i, Importance.MEDIUM) for i in range(5)]
    dist = {str(i): 0.5 for i in range(5)}
    ranked = _score(items, dist, current_breath=4, k=2, wi=0.0, wv=0.0)
    assert [m.id for m in ranked] == ["4", "3"]


def test_empty_items_returns_empty():
    assert _score([], {}, current_breath=0, k=5) == []
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `memory/scoring.py`:

```python
"""Pure salience scorer: recency × importance × relevance.

Solves "similarity ≠ salience": vector search supplies only *relevance*, but the
most biographically important memories (a grudge, a bond) are often not similar to
the current moment. Each term is min–max normalized across the candidate set so no
term dominates by raw scale, then combined by a weighted sum. Pure and
deterministic -- no I/O, no model -- so it is exhaustively unit-tested.
"""

from __future__ import annotations

from memory.models import Importance, MemoryItem


def score_memories(
    items: list[MemoryItem],
    distances: dict[str, float],
    current_breath: int,
    k: int,
    *,
    w_recency: float,
    w_importance: float,
    w_relevance: float,
    recency_decay: float,
    importance_weights: dict[Importance, float],
) -> list[MemoryItem]:
    """Return the top-``k`` memories by combined salience score (highest first).

    Args:
        items: Candidate memories.
        distances: ``{item.id: vector distance}`` (lower = more relevant);
            ids absent from the map are treated as maximally distant.
        current_breath: The agent's current subjective time.
        k: Maximum number of memories to return.
        w_recency / w_importance / w_relevance: Term weights.
        recency_decay: Per-breath exponential decay base for recency.
        importance_weights: Numeric weight per :class:`Importance`.

    Returns:
        Up to ``k`` items, ordered by descending combined score.
    """
    if not items:
        return []
    recency = {m.id: recency_decay ** max(0, current_breath - m.created_breath) for m in items}
    importance = {m.id: importance_weights[m.importance] for m in items}
    relevance = {m.id: _distance_to_relevance(distances.get(m.id)) for m in items}

    scored = _combined_scores(
        items, recency, importance, relevance, w_recency, w_importance, w_relevance
    )
    ranked = sorted(items, key=lambda m: scored[m.id], reverse=True)
    return ranked[:k]


def _distance_to_relevance(distance: float | None) -> float:
    """Map a vector distance (lower = closer; ``None``/``inf`` = unknown) to [0, 1]."""
    if distance is None or distance == float("inf"):
        return 0.0
    return 1.0 / (1.0 + max(0.0, distance))


def _combined_scores(
    items: list[MemoryItem],
    recency: dict[str, float],
    importance: dict[str, float],
    relevance: dict[str, float],
    w_recency: float,
    w_importance: float,
    w_relevance: float,
) -> dict[str, float]:
    """Min–max normalize each term across ``items`` and return the weighted sum per id.

    TODO(human): implement the normalize-then-weight combination.
    """
    ...


def _normalize(values: dict[str, float]) -> dict[str, float]:
    """Min–max normalize a term to [0, 1]; a flat term maps everything to 1.0."""
    lo, hi = min(values.values()), max(values.values())
    if hi == lo:
        return {key: 1.0 for key in values}
    return {key: (value - lo) / (hi - lo) for key, value in values.items()}
```

- [ ] **Step 4 (HUMAN):** Implement `_combined_scores` at the `TODO(human)` — normalize each term with `_normalize`, then return `{id: wR*r + wI*i + wV*v}`.

- [ ] **Step 5: Run, verify pass** — `pytest tests/memory/scoring_test.py -v`.

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(sprint5-T6): salience scorer (recency × importance × relevance)"`.

---

## Task 7: `memory/store.py` — `MemoryStore` seam + `FileMemoryStore` + `NullMemoryStore`

**Files:**
- Create: `memory/store.py`
- Test: `tests/memory/store_test.py`

**Interfaces:**
- Consumes: `MemoryItem`/`Importance` (T2), constants (T3), `VectorStore`/`FakeVectorStore` (T5), scorer (T6), `MemoryStoreError` (T1).
- Produces:
  - `class MemoryStore(Protocol)`: `load_identity() -> str`; `write_identity(new_self: str) -> None`; `append_memory(content: str, importance: Importance, breath: int) -> MemoryItem`; `retrieve(query: str, current_breath: int, k: int) -> list[MemoryItem]`.
  - `class FileMemoryStore`: `__init__(self, agent_id: str, root: Path, *, persona: str, vector_store: VectorStore, clock: Callable[[], float])`.
  - `class NullMemoryStore` + `NULL_MEMORY` singleton.

- [ ] **Step 1: Write the failing tests** — `tests/memory/store_test.py`:

```python
from pathlib import Path

from memory.embedding import FakeEmbeddingFunction
from memory.models import Importance
from memory.store import FileMemoryStore, NullMemoryStore
from memory.vector_store import FakeVectorStore


def _store(tmp_path: Path, persona="I am Ada, a careful wanderer."):
    return FileMemoryStore(
        "wanderer_001", tmp_path,
        persona=persona,
        vector_store=FakeVectorStore(FakeEmbeddingFunction()),
        clock=lambda: 42.0,
    )


def test_seed_written_once_and_identity_composes(tmp_path):
    s = _store(tmp_path)
    assert "Ada" in s.load_identity()  # seed only, identity empty
    s.write_identity("I have learned to distrust Kai.")
    assert "Ada" in s.load_identity() and "distrust Kai" in s.load_identity()
    # seed.md never overwritten
    assert (tmp_path / "wanderer_001" / "seed.md").read_text().strip() == "I am Ada, a careful wanderer."


def test_write_identity_is_atomic_and_repeatable(tmp_path):
    s = _store(tmp_path)
    s.write_identity("v1")
    s.write_identity("v2")
    assert "v2" in s.load_identity() and "v1" not in s.load_identity()


def test_append_then_retrieve_returns_item(tmp_path):
    s = _store(tmp_path)
    item = s.append_memory("Kai betrayed me.", Importance.HIGH, breath=3)
    assert item.created_at == 42.0 and item.created_breath == 3
    got = s.retrieve("betrayal by Kai", current_breath=4, k=5)
    assert any(m.content == "Kai betrayed me." for m in got)
    # one physical line in the jsonl
    assert (tmp_path / "wanderer_001" / "memory.jsonl").read_text().count("\n") == 1


def test_jsonl_truncated_last_line_is_ignored_on_load(tmp_path):
    s = _store(tmp_path)
    s.append_memory("complete", Importance.LOW, 1)
    path = tmp_path / "wanderer_001" / "memory.jsonl"
    with path.open("a") as f:
        f.write('{"id": "partial", "content": "tru')  # truncated, no newline
    s2 = _store(tmp_path)  # re-open over the corrupt file
    contents = [m.content for m in s2.retrieve("x", 2, 10)]
    assert "complete" in contents and "partial" not in str(contents)


def test_null_store_is_inert(tmp_path):
    n = NullMemoryStore()
    assert n.load_identity() == ""
    n.write_identity("ignored")
    assert n.retrieve("q", 0, 5) == []
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `memory/store.py` (key shape; full docstrings required):

```python
"""The :class:`MemoryStore` seam and its file-backed + null implementations."""

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

    def load_identity(self) -> str: ...
    def write_identity(self, new_self: str) -> None: ...
    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem: ...
    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]: ...


class FileMemoryStore:
    """File-backed memory: ``seed.md`` + ``identity.md`` + ``memory.jsonl`` + a vector store."""

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
        for item in self._items:  # idempotent: ensures vectors exist after restart
            self._vector_store.upsert(item.id, item.content)

    def load_identity(self) -> str:
        seed = self._seed_path.read_text(encoding="utf-8").strip()
        self_narrative = (
            self._identity_path.read_text(encoding="utf-8").strip()
            if self._identity_path.exists()
            else ""
        )
        return f"{seed}\n\n{self_narrative}".strip() if self_narrative else seed

    def write_identity(self, new_self: str) -> None:
        tmp = self._identity_path.with_suffix(".md.tmp")
        try:
            tmp.write_text(new_self, encoding="utf-8")
            os.replace(tmp, self._identity_path)  # atomic on POSIX
        except OSError as exc:
            raise MemoryStoreError("failed to write identity") from exc

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        item = MemoryItem(
            id=f"{self._agent_id}-{len(self._items)}",
            content=content,
            importance=importance,
            created_breath=breath,
            created_at=self._clock(),
        )
        try:
            with self._jsonl_path.open("a", encoding="utf-8") as f:
                f.write(item.to_jsonl_line() + "\n")
        except OSError as exc:
            raise MemoryStoreError("failed to append memory") from exc
        self._items.append(item)
        self._vector_store.upsert(item.id, item.content)
        return item

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        if not self._items:
            return []
        distances = self._vector_store.distances(query, [m.id for m in self._items])
        return score_memories(
            self._items, distances, current_breath, k,
            w_recency=constants.W_RECENCY,
            w_importance=constants.W_IMPORTANCE,
            w_relevance=constants.W_RELEVANCE,
            recency_decay=constants.RECENCY_DECAY,
            importance_weights=constants.IMPORTANCE_WEIGHTS,
        )

    def _load_items(self) -> list[MemoryItem]:
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
    """Inert :class:`MemoryStore` used when an agent has no configured memory."""

    def load_identity(self) -> str:
        return ""

    def write_identity(self, new_self: str) -> None:
        return None

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        return MemoryItem("null", content, importance, breath, 0.0)

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        return []


NULL_MEMORY: MemoryStore = NullMemoryStore()
```
> Crash-safety note: `_load_items` iterates `splitlines()`; a truncated final line (no `\n`, unparseable JSON) is caught and discarded — every complete prior line survives.

- [ ] **Step 4: Run, verify pass** — `pytest tests/memory/store_test.py -v`.

- [ ] **Step 5: Re-export** — append to `memory/__init__.py`: `from memory.store import MemoryStore, FileMemoryStore, NullMemoryStore, NULL_MEMORY`.

- [ ] **Step 6: Coverage gate** — `pytest tests/memory --cov=memory --cov-report=term-missing` → ≥90%.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(sprint5-T7): MemoryStore seam + FileMemoryStore + NullMemoryStore"`.

---

## Task 8: `agents/reflection.py` — reflection schemas, recap, prompt

**Files:**
- Create: `agents/reflection.py`
- Test: `tests/agents/reflection_test.py`

**Interfaces:**
- Produces:
  - `REFLECTION_TOOL_SCHEMAS: list[dict[str, Any]]` — `remember(content, importance)` + `revise_self(identity)` in Ollama function format.
  - `def render_recap(history: list[dict[str, Any]], turns: int) -> str` — compact rendering of the last `turns` user/assistant/tool turns.
  - `def build_reflection_messages(identity: str, recap: str) -> list[dict[str, Any]]` — `[{system: identity}, {user: recap + reflective prompt}]`.

- [ ] **Step 1: Write the failing tests** — `tests/agents/reflection_test.py`:

```python
from agents.reflection import (
    REFLECTION_TOOL_SCHEMAS,
    build_reflection_messages,
    render_recap,
)


def test_reflection_schemas_are_only_memory_tools():
    names = {s["function"]["name"] for s in REFLECTION_TOOL_SCHEMAS}
    assert names == {"remember", "revise_self"}


def test_remember_schema_requires_content_and_importance():
    schema = next(s for s in REFLECTION_TOOL_SCHEMAS if s["function"]["name"] == "remember")
    props = schema["function"]["parameters"]["properties"]
    assert "content" in props and "importance" in props
    assert props["importance"]["enum"] == ["low", "medium", "high"]


def test_render_recap_keeps_only_last_n_turns():
    history = [{"role": "system", "content": "persona"}] + [
        {"role": "user", "content": f"perception {i}"} for i in range(10)
    ]
    recap = render_recap(history, turns=3)
    assert "perception 9" in recap and "perception 5" not in recap
    assert "persona" not in recap  # system turn excluded from recap


def test_reflection_messages_have_no_consecutive_user_turns():
    msgs = build_reflection_messages("I am Ada.", "Recently: nothing.")
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert "reflect" in msgs[1]["content"].lower()
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — `agents/reflection.py` (DD9: in-world framing, no "memory file" language):

```python
"""The reflection step: an isolated turn where an agent records what to carry forward.

The qwen3:8b spike showed a small model will not journal while acting (it always
picks an action), but reflects well when reflection is the *only* thing offered.
So the write path is a dedicated step with ONLY the memory tools and an in-world
"pause and reflect on your life" prompt -- never "manage your memory" (DD9).
"""

from __future__ import annotations

from typing import Any

from core.constants import REFLECT_RECAP_TURNS  # noqa: F401  (referenced by callers)

REFLECTION_TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "remember",
            "description": (
                "Record a durable, biographically important memory about yourself or "
                "others -- a grudge, a bond, a lesson, a goal -- worth carrying forward "
                "even when it is not relevant right now."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "content": {"type": "string", "description": "The memory, in your own words."},
                    "importance": {
                        "type": "string",
                        "enum": ["low", "medium", "high"],
                        "description": "How significant this is to who you are.",
                    },
                },
                "required": ["content", "importance"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "revise_self",
            "description": "Rewrite your sense of who you are and how you have changed.",
            "parameters": {
                "type": "object",
                "properties": {
                    "identity": {"type": "string", "description": "Your updated self-narrative."},
                },
                "required": ["identity"],
            },
        },
    },
]

_REFLECTIVE_PROMPT = (
    "Pause and reflect on your life so far. If anything here is worth carrying "
    "forward -- a grudge, a bond, a lesson, a goal -- record it, and update who "
    "you are if you have changed."
)


def render_recap(history: list[dict[str, Any]], turns: int) -> str:
    """Render the last ``turns`` non-system turns of ``history`` as a compact recap."""
    body = [m for m in history if m.get("role") != "system"]
    recent = body[-turns:] if turns > 0 else []
    lines = [f"[{m.get('role')}] {str(m.get('content') or '').strip()}" for m in recent]
    return "\n".join(lines) if lines else "Nothing of note has happened yet."


def build_reflection_messages(identity: str, recap: str) -> list[dict[str, Any]]:
    """Build the isolated 2-turn message list for a reflection call."""
    return [
        {"role": "system", "content": identity},
        {"role": "user", "content": f"Here is what has recently happened in your life:\n{recap}\n\n{_REFLECTIVE_PROMPT}"},
    ]
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(sprint5-T8): reflection schemas + recap + prompt"`.

---

## Task 9: `agents/runtime.py` — wire memory into the breathing loop

**Files:**
- Modify: `agents/runtime.py`
- Modify: `tests/conftest.py` (add fixtures)
- Test: `tests/agents/runtime_test.py` (extend)

**Interfaces:**
- Consumes: `MemoryStore`/`NULL_MEMORY`/`FileMemoryStore` (T7), reflection helpers (T8), `Importance` (T2), constants (T3).
- Produces: `Agent.__init__(..., memory: MemoryStore | None = None, ...)`; `self.memory`; `async def reflect(self) -> None`.

- [ ] **Step 1: Add fixtures** to `tests/conftest.py`:

```python
@pytest.fixture
def fake_embedder():
    from memory.embedding import FakeEmbeddingFunction
    return FakeEmbeddingFunction()


@pytest.fixture
def fake_vector_store(fake_embedder):
    from memory.vector_store import FakeVectorStore
    return FakeVectorStore(fake_embedder)


@pytest.fixture
def memory_store(tmp_path, fake_vector_store, fake_clock):
    from memory.store import FileMemoryStore
    return FileMemoryStore(
        "wanderer_001", tmp_path,
        persona="I am Ada, a careful wanderer.",
        vector_store=fake_vector_store, clock=fake_clock,
    )
```

- [ ] **Step 2: Write the failing integration tests** — append to `tests/agents/runtime_test.py`:

```python
async def test_surfaced_memories_appear_in_perception(world, event_bus, populated_registry, memory_store):
    from agents.decider import Decision, ToolCall
    from agents.runtime import Agent
    from memory.models import Importance

    memory_store.append_memory("Kai betrayed me in the meadow.", Importance.HIGH, breath=0)
    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision(tool_calls=[ToolCall("wait")])]), memory=memory_store)
    await agent.perceive()
    perception = agent.lifecycle_history[-1]
    assert perception["role"] == "user"
    assert "Kai betrayed me" in perception["content"]
    # invariant: no two consecutive user turns
    roles = [m["role"] for m in agent.lifecycle_history]
    assert not any(roles[i] == roles[i + 1] == "user" for i in range(len(roles) - 1))


async def test_reflection_fires_on_Nth_breath_and_persists(world, event_bus, populated_registry, memory_store, monkeypatch):
    import agents.runtime as runtime
    from agents.decider import Decision, ToolCall
    from agents.runtime import Agent

    monkeypatch.setattr(runtime, "REFLECT_EVERY_N_BREATHS", 2)
    # action decider always waits; reflection decider authors a memory
    reflect_decision = Decision(tool_calls=[ToolCall("remember", {"content": "I trust no one.", "importance": "high"})])
    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision(tool_calls=[ToolCall("wait")]), reflect_decision]),
                  memory=memory_store)
    await agent.breathe()  # breath 1: no reflection
    assert memory_store.retrieve("trust", 1, 5) == []
    await agent.breathe()  # breath 2: reflection fires
    assert any("trust no one" in m.content.lower() for m in memory_store.retrieve("trust", 2, 5))


async def test_revise_self_rebuilds_system_turn(world, event_bus, populated_registry, memory_store, monkeypatch):
    import agents.runtime as runtime
    from agents.decider import Decision, ToolCall
    from agents.runtime import Agent

    monkeypatch.setattr(runtime, "REFLECT_EVERY_N_BREATHS", 1)
    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision(tool_calls=[ToolCall("revise_self", {"identity": "I am reborn, wary and cold."})])]),
                  memory=memory_store)
    await agent.reflect()
    assert "reborn, wary and cold" in agent.lifecycle_history[0]["content"]


async def test_reflection_no_tool_calls_does_not_crash(world, event_bus, populated_registry, memory_store):
    from agents.decider import Decision
    from agents.runtime import Agent

    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision()]), memory=memory_store)
    await agent.reflect()  # no raise; nothing written
    assert memory_store.retrieve("x", 1, 5) == []


async def test_system_turn_byte_stable_across_breaths_without_revise(world, event_bus, populated_registry, memory_store):
    from agents.decider import Decision, ToolCall
    from agents.runtime import Agent

    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision(tool_calls=[ToolCall("wait")])]), memory=memory_store)
    before = agent.lifecycle_history[0]["content"]
    await agent.breathe()
    await agent.breathe()
    assert agent.lifecycle_history[0]["content"] == before
```

- [ ] **Step 3: Run, verify fail.**

- [ ] **Step 4: Implement the runtime changes** — in `agents/runtime.py`:

  (a) Imports:
```python
from agents.reflection import REFLECTION_TOOL_SCHEMAS, build_reflection_messages, render_recap
from core.constants import DECIDE_BACKOFF_SECONDS, REFLECT_EVERY_N_BREATHS, REFLECT_RECAP_TURNS, RETRIEVAL_K
from memory.models import Importance
from memory.store import NULL_MEMORY, MemoryStore
```

  (b) `__init__` — add `memory: MemoryStore | None = None` (after `decider`, before `pace`), and `self.memory: MemoryStore = memory if memory is not None else NULL_MEMORY`. Keep `self.event_bus.subscribe(...)` and `self._load_system_prompt()` last.

  (c) `_load_system_prompt` — source persona from memory, fall back to `AgentState.persona`:
```python
agent_state = self.world.get_agent(self.agent_id)
identity = self.memory.load_identity()
persona = identity or (agent_state.persona if agent_state is not None else "")
prompt = build_system_prompt(persona, self._tool_names())
```
  Refactor so `reflect()` can rebuild it: extract `self.lifecycle_history[0] = {"role": "system", "content": self._system_prompt()}` where `_system_prompt()` returns the string.

  (d) `perceive()` — after composing the perception string, fold in memories:
```python
perception = self._render_perception(events)
memories = self.memory.retrieve(perception, self.breath_count, RETRIEVAL_K)
if memories:
    perception += "\n\n" + self._render_memories(memories)
self.lifecycle_history.append({"role": "user", "content": perception})
```
  Add `_render_memories(items) -> str` (in-world framing, e.g. a "Surfacing in your memory:" block listing `- {content}`).

  (e) Add `reflect()`:
```python
async def reflect(self) -> None:
    """Run one isolated reflection step: author memories / revise identity.

    Builds a 2-turn context (identity + recent-life recap) offering ONLY the
    reflection tools, calls the decider, and applies any ``remember`` /
    ``revise_self`` results. A reflection that authors nothing is normal (the
    spike's Probe-A path) -- it is logged and skipped, never raised.
    """
    messages = build_reflection_messages(self.memory.load_identity(), render_recap(self.lifecycle_history, REFLECT_RECAP_TURNS))
    try:
        decision = await self.decider.decide(messages, REFLECTION_TOOL_SCHEMAS)
    except Exception:
        logger.exception("Reflection decide failed for agent %r", self.agent_id)
        return
    for call in decision.tool_calls:
        if call.name == "remember":
            self._apply_remember(call.params)
        elif call.name == "revise_self":
            self._apply_revise_self(call.params)


def _apply_remember(self, params: dict[str, Any]) -> None:
    content = params.get("content")
    if not isinstance(content, str) or not content.strip():
        return
    try:
        importance = Importance.from_str(str(params.get("importance", "medium")))
    except ValueError:
        importance = Importance.MEDIUM
    self.memory.append_memory(content.strip(), importance, self.breath_count)


def _apply_revise_self(self, params: dict[str, Any]) -> None:
    identity = params.get("identity")
    if not isinstance(identity, str) or not identity.strip():
        return
    self.memory.write_identity(identity.strip())
    self.lifecycle_history[0] = {"role": "system", "content": self._system_prompt()}
```

  (f) `breathe()` — add the trigger after `execute`, before `refresh_status` (recall `breath_count` increments in `finally`, so use `+ 1`):
```python
if previous_status is AgentStatus.ALIVE and decision is not None:
    if (self.breath_count + 1) % REFLECT_EVERY_N_BREATHS == 0:
        await self.reflect()
```

- [ ] **Step 5: Run, verify pass** — `pytest tests/agents/runtime_test.py -v`.

- [ ] **Step 6: Full gate** — `pytest && mypy --strict memory agents core && ruff check memory agents tests`.

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(sprint5-T9): wire memory + reflection into the breathing loop"`.

---

## Task 10: Acceptance sweep — confirm all 14 spec tests pass

**Files:** Test only (audit existing + fill gaps).

The 14 acceptance tests (spec §11) map to tasks as follows; verify each exists and passes, add any missing:

| # | Acceptance test | Lives in |
|---|---|---|
| 1–4 | scorer term dominance + top-k | `scoring_test.py` (T6) |
| 5 | append→retrieve, one jsonl line | `store_test.py` (T7) |
| 6 | atomic identity write, seed preserved | `store_test.py` (T7) |
| 7 | truncated jsonl ignored | `store_test.py` (T7) |
| 8 | reflection persists `remember` | `runtime_test.py` (T9) |
| 9 | `revise_self` updates identity + system turn | `runtime_test.py` (T9) |
| 10 | no-tool reflection no crash | `runtime_test.py` (T9) |
| 11 | surfaced memories in perception + invariants | `runtime_test.py` (T9) |
| 12 | reflection fires on breath N only | `runtime_test.py` (T9) |
| 13 | system turn byte-stable | `runtime_test.py` (T9) |
| 14 | memories appended at tail | add below |

- [ ] **Step 1: Add the tail-append guard (#14)** to `runtime_test.py`:

```python
async def test_memories_appended_at_tail_not_mid_history(world, event_bus, populated_registry, memory_store):
    from agents.decider import Decision, ToolCall
    from agents.runtime import Agent
    from memory.models import Importance

    memory_store.append_memory("a durable memory", Importance.HIGH, 0)
    agent = Agent("wanderer_001", world, event_bus, populated_registry,
                  MockDecider([Decision(tool_calls=[ToolCall("wait")])]), memory=memory_store)
    snapshot = list(agent.lifecycle_history)  # system turn only
    await agent.perceive()
    assert agent.lifecycle_history[: len(snapshot)] == snapshot  # prefix unchanged
    assert agent.lifecycle_history[-1]["role"] == "user"
```

- [ ] **Step 2: Run the full acceptance set** — `pytest tests/memory tests/agents -v`.

- [ ] **Step 3: Coverage** — `pytest --cov=memory --cov=agents --cov-report=term-missing` → memory ≥90%.

- [ ] **Step 4: Commit** — `git add -A && git commit -m "test(sprint5-T10): complete 14-test acceptance sweep"`.

---

## Task 11: Live integration smoke (qwen3) — marked `@integration`

**Files:**
- Create: `tests/integration/memory_smoke_test.py`

**Interfaces:** Consumes the real `OllamaDecider`, `FileMemoryStore` with `ChromaVectorStore(default_embedding_function())`.

- [ ] **Step 1: Write the smoke** (marked `@pytest.mark.integration`, excluded from default run): build a one-agent world, run ~`2*REFLECT_EVERY_N` breaths against `make_default_decider("qwen3:8b")` with a real `FileMemoryStore` (temp dir, real Chroma + MiniLM). Assert: the agent stays ALIVE through the run, ≥1 memory file line is written by reflection, and `seed.md`/`identity.md` exist. Clean up the temp dir in a `finally`.

- [ ] **Step 2: Run it once manually** — `pytest -m integration tests/integration/memory_smoke_test.py -v -s` (needs Ollama up with qwen3:8b). Record wall time.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(sprint5-T11): live qwen3 memory smoke (integration-marked)"`.

---

## Task 12: Benchmark harness — `bench/bench_memory.py`

**Files:**
- Create: `bench/__init__.py`, `bench/bench_memory.py`
- Create: `docs/superpowers/benchmarks/2026-06-28-memory-perf.md`

**Interfaces:** A CLI (`python -m bench.bench_memory --scale 1000`) that measures the memory machinery **without an LLM** (deterministic, repeatable), plus an optional `--live` mode that times real breaths.

Measured metrics (the spec's performance surface):
1. **Append latency** — ms per `append_memory` at N = 10/100/1k/10k items (real Chroma + MiniLM).
2. **Retrieval latency** — ms per `retrieve(k=5)` at each N (embedding + Chroma query + scorer).
3. **Scorer cost** — µs per `score_memories` at each N (isolates the pure ranking from I/O).
4. **Embedding latency** — ms per `embed` (batch 1 vs 32) for MiniLM.
5. **Footprint** — `memory.jsonl` bytes + Chroma dir bytes + process RSS (via `resource.getrusage`) at each N.
6. **Reflection re-prefill proxy** (live mode) — wall-time of the breath *after* a reflection vs a steady-state breath (the KV-eviction tax).
7. **Retrieval quality** — a fixed fixture of labeled memories + queries; report precision@k of the scorer vs relevance-only and recency-only baselines (does the salience scorer beat pure RAG on the grudge case?).

- [ ] **Step 1: Implement the deterministic harness** — uses `FileMemoryStore` + `ChromaVectorStore(default_embedding_function())` on a temp dir; `time.perf_counter` around each op; `statistics.median` over repeats; prints a table and appends a markdown row set to the benchmark doc. Use `argparse`; guard `--live` so the default run needs no Ollama. **No `print` in library code** — this is a script (`if __name__ == "__main__":` / `bench/` is not in coverage `source`), so `print`/`rich` output is fine here.

- [ ] **Step 2: Implement the quality harness** — a small labeled set (e.g. 20 memories with known importance + a "grudge" query whose relevant memory is *not* lexically similar) and compute precision@k for three rankers: full scorer, relevance-only, recency-only.

- [ ] **Step 3: Run the baseline** — `python -m bench.bench_memory --scale 10000` and paste the table into `docs/superpowers/benchmarks/2026-06-28-memory-perf.md` under "Baseline (pre-optimization)".

- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(sprint5-T12): end-to-end memory benchmark harness + baseline"`.

---

## Task 13: Optimization & iteration — tune to targets

**Files:** Modify `core/constants.py`, `memory/*` as bottlenecks dictate; update the benchmark doc each iteration.

**Performance targets (the "best performance" bar — iterate until met or justified):**
- Retrieval (`retrieve`, k=5) **< 15 ms median at N=1k** memories; scorer pure cost **< 2 ms at N=1k**.
- Append **< 10 ms median** (excluding the one-time MiniLM model load).
- Per-breath **non-LLM** memory overhead **< 20 ms median** at steady state.
- Footprint growth **linear and bounded**: jsonl ≤ ~200 B/memory; report RSS slope.
- Quality: full scorer **precision@5 ≥ relevance-only and ≥ recency-only** on the grudge fixture (must not regress vs pure RAG; should win on the salience case).

- [ ] **Step 1: Profile the slowest metric** — use `cProfile`/`perf_counter` to find the dominant cost (expected suspects: re-embedding all items on `_load_items` startup; querying Chroma with `n_results=len(all)`; per-retrieve embedding of the query).
- [ ] **Step 2: Apply ONE optimization, re-measure** — candidates, each its own commit + benchmark-doc row:
  - Cap the relevance candidate set (query Chroma `n_results=min(N, RELEVANCE_CANDIDATES)`) and only score those + the most-recent/most-important — avoids O(N) scoring on huge stores. (New constant `RELEVANCE_CANDIDATES`.)
  - Skip startup re-embedding when using a `PersistentClient` whose collection already holds the ids (count check).
  - Batch embedding / reuse the query embedding.
  - Tune `RETRIEVAL_K`, `REFLECT_EVERY_N_BREATHS`, `RECENCY_DECAY` against the quality fixture + the live re-prefill tax.
- [ ] **Step 3: Verify no behavioral regression** — `pytest tests/memory tests/agents` green after each change; quality precision@5 not worse.
- [ ] **Step 4: Loop** Steps 1–3 until every target is met or a miss is documented with rationale in the benchmark doc ("Optimization log" section: each iteration = change, before→after numbers, decision).
- [ ] **Step 5: Final commit** — `git add -A && git commit -m "perf(sprint5-T13): tune memory subsystem to targets (see benchmark doc)"`.

---

## Task 14: Record the design decision + checkpoint

**Files:** Modify `autonomous-agent-world-design.md` (Changelog), `.remember/remember.md`, `MEMORY.md`.

- [ ] **Step 1:** Add a Changelog entry to `autonomous-agent-world-design.md` per spec §14 (reflection-step write path; MiniLM-not-Ollama embedding).
- [ ] **Step 2:** Update `.remember/remember.md` with the Sprint-5 completion state + benchmark headline numbers.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "docs(sprint5-T14): record memory design decision + checkpoint"`.

---

## Self-Review (completed during planning)

- **Spec coverage:** §3 layers → T9 (assembly) ; §4 disk layout → T7 ; §5 `MemoryItem` → T2 ; §6 `MemoryStore` seam + injected embedder/vector/clock → T4/T5/T7 ; §7 scorer + constants → T3/T6 ; §8 reflection step → T8/T9 ; §9 KV discipline → T9 guards (#13/#14) ; §10 integration → T9 ; §11 all 14 acceptance tests → T6/T7/T9/T10 ; §12 Revisit → noted (RELEVANCE_CANDIDATES eviction surfaced in T13) ; §13 manifest → File Structure ; §14 changelog → T14. Performance goal → T12/T13. **No gaps.**
- **Placeholder scan:** the only `...` are the `Protocol` method bodies (required) and the deliberate `TODO(human)` in `_combined_scores` (Task 6, learning-mode contribution). No "TBD"/"add error handling"/"similar to".
- **Type consistency:** `MemoryStore` methods, `VectorStore.distances`, `score_memories(...)` keyword params, `Importance.from_str`, and the `EmbeddingFunction.__call__(input)` Chroma convention are used identically across T4–T9.
```
