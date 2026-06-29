# Sprint 5 — Memory Foundation (design spec)

> Status: **approved design, pre-implementation.** This spec is the contract for
> the Sprint 5 *foundation*. Compaction (action-chain summary) is Sprint 5.5;
> WorldState persistence + multi-agent runner + death are Sprint 6. The acceptance
> tests in §11 are the finish line.

---

## 1. Goal & non-goals

**Goal.** Give each agent a durable, self-authored memory so it can *exist* across
a long life as a coherent being — keeping **persona + memories + the thread of its
actions**, like a human in the world rather than a task-agent. Concretely, the
foundation delivers three things:

1. **Self-authored identity** (a versioned persona) injected into the **system
   prompt**, anchored by an immutable birth seed.
2. **Curated, agent-authored memories** persisted to disk and surfaced back into
   perception by a **salience-aware scorer** (recency × importance × relevance) —
   not pure vector similarity.
3. A **write path** that actually populates memory on the local model: a dedicated
   **reflection step**, not an action-menu tool.

**Non-goals (explicit scope guards).**

- **NOT** the action-chain compaction / running summary (→ Sprint 5.5). The
  foundation does **not** bound the growing `lifecycle_history`; `DECIDE_NUM_CTX`
  still buys the runway. The memory files are the durable substrate 5.5 will lean on.
- **NOT** WorldState/agent persistence across process restarts (→ Sprint 6). Only
  the per-agent *memory* artifacts are durable here.
- **NOT** memory eviction/forgetting, salience-/event-*triggered* reflection, or a
  cloud consolidation model. The foundation reflects on a fixed cadence; the rest is
  on the Revisit list (§12).
- **NOT** the raw append-only *event* log for research (that is `observability/`'s
  concern). "Memory" here means the agent's *curated cognition layer*.

This maps to the SPRINTS.md Sprint-5 items **E2** (identity in system prompt),
**E3** (ChromaDB RAG → the *relevance* term), and **E4** (reflection every N
breaths → here promoted to the write path).

---

## 2. Empirical basis (the smoke spike)

Three live probes against `qwen3:8b` (the design decider) shaped the write path.
They are recorded here because they justify a departure from the original SPRINTS
plan; the spike code was throwaway and has been removed.

| Probe | Setup | Result |
|---|---|---|
| **A — author while acting** | `remember` offered *alongside* `move`/`attack`; agent freshly betrayed | ❌ never journaled — chose `look_around`. The model treats *act* vs *remember* as competing and acting wins. |
| **B — injected memory steers** | same encounter, with vs without an injected grudge | ✅ strong, coherent steering: control `look_around` → grudge `speak` *"I cannot trust you, Kai. Your betrayal lingers."* |
| **C — author when reflection is isolated** | a turn with **only** `remember`/`revise_self` and a "pause and reflect on your life" prompt | ✅ authored a good memory *and* an identity revision. |

**Design law derived:** *read works; in-loop write fails; isolated write works.*
→ The write path must be a **dedicated reflection step** (only memory tools,
reflective prompt), and `remember`/`revise_self` are **removed from the per-breath
action menu** (dead weight there, per A).

---

## 3. Architecture — the three layers & message assembly

Each breath's message list, and where each layer lives:

```
[system]   SEED_KERNEL (immutable birth persona)  +  identity.md (mutable self-narrative)
... append-only lifecycle history (perception / assistant / tool turns) ...
[user]     this breath's perception  +  surfaced memories   ← folded into ONE user turn
```

- **Layer 1 — Identity** → the **system prompt**. Rebuilt **only** when
  `revise_self` fires (inside reflection, which already breaks the KV cache), so it
  is byte-stable across normal breaths.
- **Layer 2 — Curated memories** → appended at the **tail**, folded into the
  perception `user` turn (never a second consecutive `user` turn; never inserted
  mid-list).
- **Layer 3 — Action-chain continuity** → **Sprint 5.5** (compaction). Out of scope.

This shape is forced by two constraints pulling the same way: the **q8_0 KV cache**
(*never mutate an old token mid-run* → stable system prompt + append-only tail) and
the **spike** (*isolate reflection from action*). See §9.

---

## 4. On-disk layout

One directory per agent under a configurable memory root (default `./memory/`):

```
memory/
  {agent_id}/
    seed.md          # write-once birth persona (immutable anchor)
    identity.md      # mutable self-narrative (rewritten by revise_self); starts empty
    memory.jsonl     # append-only curated memories, one JSON object per line
    chroma/          # ChromaDB PersistentClient store (embeddings + metadata)
```

- `seed.md` is written once from `AgentState.persona` at first construction and
  never overwritten — the identity anchor that prevents long-run identity collapse.
- `memory.jsonl` is **append-only** (crash-safe: a truncated final line is discarded
  on load) and mirrors the KV-cache philosophy on disk.
- `chroma/` is an **embedded** `PersistentClient` (no server process) — see §6.

---

## 5. Data model — `MemoryItem`

```python
@dataclass(slots=True, frozen=True)
class MemoryItem:
    id: str               # stable id: f"{agent_id}-{seq}" (seq = line ordinal)
    content: str          # the memory, in the agent's own words
    importance: Importance  # enum LOW / MEDIUM / HIGH
    created_breath: int   # subjective time of creation (Agent.breath_count)
    created_at: float     # wall time from world.now(); logging/replay only
```

`Importance` is a string-valued `Enum` (`low`/`medium`/`high`) with a numeric
weight resolved via `IMPORTANCE_WEIGHTS` in `core/constants.py`. `MemoryItem` is
**frozen** (it is a value persisted to disk, not hot-path world state — distinct
from the deliberately-mutable `AgentState`).

---

## 6. `MemoryStore` — the seam

A class injected into `Agent` exactly like `decider`/`event_bus`/`tool_registry`
(DI per CLAUDE.md §3). It owns the per-agent files and the vector store.

```python
class MemoryStore:
    def __init__(self, agent_id: str, root: Path, *,
                 embedder: Embedder, vector_store: VectorStore, clock: Clock) -> None: ...

    def load_identity(self) -> str:
        """seed.md + ('\n\n' + identity.md if non-empty). The system persona."""

    def write_identity(self, new_self: str) -> None:
        """Atomically rewrite identity.md (temp file + os.replace). seed.md untouched."""

    def append_memory(self, content: str, importance: Importance, breath: int) -> MemoryItem:
        """Append one line to memory.jsonl (atomic), embed it, add to the vector store."""

    def retrieve(self, query: str, current_breath: int, k: int) -> list[MemoryItem]:
        """Return the top-k memories by the §7 score (deterministic given inputs)."""
```

**Injected collaborators (all behind Protocols so tests use deterministic fakes —
no model load, no Chroma, no network):**

- `Embedder.embed(texts: list[str]) -> list[list[float]]`. Real default:
  ChromaDB's built-in **`all-MiniLM-L6-v2`** (local, ~80 MB, onnxruntime/CPU).
  Chosen deliberately over an Ollama embed model so embedding never contends with
  `qwen3` on Ollama's **sequential** backend (which would evict the chat KV cache).
- `VectorStore` — thin wrapper over a ChromaDB `PersistentClient` collection;
  `add(ids, embeddings, metadatas)` and `query(embedding, k) -> list[(id, distance)]`.
  One collection, `agent_id` as a metadata filter (scales into the Sprint-6 runner).
- `Clock.now() -> float` — already available as `world.now()`; passed in for
  `created_at` stamps only (scoring uses subjective time, §7).

**Infra errors** (disk, Chroma) raise typed `VivariumError` subclasses and are
logged (CLAUDE.md §4). Agent-facing reflection failures never raise — see §8.

---

## 7. Retrieval scorer — solving "similarity ≠ salience"

For each candidate memory, against the current perception as the query:

```
score(m) = W_RECENCY   · norm(recency(m))
         + W_IMPORTANCE · norm(importance(m))
         + W_RELEVANCE  · norm(relevance(m, query))
```

- **recency(m)** = `RECENCY_DECAY ** (current_breath − m.created_breath)` — decay
  over **subjective time** (breaths), per Generative Agents. No wall-clock → fully
  deterministic.
- **importance(m)** = `IMPORTANCE_WEIGHTS[m.importance]`. This is the salience term
  vector search cannot provide — a grudge is not *similar* to "Kai offers
  materials" but it is *important* (exactly Probe B).
- **relevance(m, query)** = cosine similarity of embeddings, from the vector store
  (the demoted RAG term).
- **norm(·)** = min–max normalization across the candidate set per term (per
  Generative Agents), so one term can't dominate by raw scale.

Take **top-`RETRIEVAL_K`**, ordered, and inject as one block inside the perception
`user` turn. All weights/decay live in `core/constants.py` as tuned Game-of-Life
dials.

**Proposed initial values** (tunable; documented with provenance in constants):

| Constant | Value | Note |
|---|---|---|
| `W_RECENCY` / `W_IMPORTANCE` / `W_RELEVANCE` | `1.0` each | equal weight start (Generative Agents) |
| `RECENCY_DECAY` | `0.97` | per-breath subjective decay |
| `IMPORTANCE_WEIGHTS` | `{low:0.3, medium:0.6, high:1.0}` | |
| `RETRIEVAL_K` | `5` | memories injected per breath |
| `REFLECT_EVERY_N_BREATHS` | `12` | reflection cadence (§8) |
| `REFLECT_RECAP_TURNS` | `6` | recent turns shown to the reflection step |
| `EMBED_MODEL` | `"all-MiniLM-L6-v2"` | Chroma built-in, local |

---

## 8. The write path — the reflection step

Every `REFLECT_EVERY_N_BREATHS` breaths, after `execute`, the loop runs **one extra
decider call** in an **isolated context**:

- **messages** = `[{system: load_identity()}, {user: recap + reflective prompt}]`,
  where `recap` renders the last `REFLECT_RECAP_TURNS` turns of `lifecycle_history`
  into a compact "here is what has recently happened in your life" passage (the
  foundation has no compaction, so this is the recent raw turns).
- **tools** = the **reflection tool schemas only**: `remember(content, importance)`
  and `revise_self(identity)`. No world/action tools.
- **prompt framing** is **in-world** — *"Pause and reflect on your life…"* — never
  "manage your memory file." Agents stay unaware they are in a simulation (DD9).

Handling the result:

- `remember(...)` → `MemoryStore.append_memory(...)` (one call per `remember`; the
  model may emit several).
- `revise_self(identity)` → `MemoryStore.write_identity(identity)` **and** rebuild
  `lifecycle_history[0]` (the system turn) from the new identity.
- **Nothing returned** (Probe A reality) → no write, no crash, log at debug. A
  reflection that authors nothing is normal, not an error.

**Costs, stated not hidden:** the reflection call is one extra inference every N
breaths, and because Ollama is single-slot it **evicts the breathing KV cache** →
the *next* breath re-prefills. Acceptable at the proposed `N=12`; tune via the
constant. The action menu loses two tools it never used (Probe A), so normal breaths
get slightly cheaper.

---

## 9. KV-cache discipline (the hard constraint)

The server runs `OLLAMA_FLASH_ATTENTION=1 OLLAMA_KV_CACHE_TYPE=q8_0`. Mutating any
token before the cache frontier ends the cached prefix → a full re-prefill. The
design obeys this:

- The **system turn is byte-stable** across normal breaths (identity only changes
  inside reflection, which already re-prefills).
- Memories are **appended at the tail**, never inserted mid-history.
- Embeddings run on a **separate CPU runtime** (Chroma/MiniLM), so `retrieve()`
  never touches Ollama's chat slot.

§11 encodes the first two as explicit guard tests.

---

## 10. Agent integration

Changes to `agents/runtime.py`, all additive:

1. `Agent.__init__` gains `memory: MemoryStore`. `_load_system_prompt` builds the
   persona from `memory.load_identity()` (seed + self) instead of
   `agent_state.persona`. (`seed.md` is initialized from `agent_state.persona` by
   the `MemoryStore` on first construction, so behavior is preserved on a fresh
   world.)
2. `perceive()` calls `memory.retrieve(query=perception_text, current_breath=
   breath_count, k=RETRIEVAL_K)` and folds the results into the single perception
   `user` turn (one rendering helper, e.g. `_render_memories`).
3. `breathe()` gains the reflection trigger after `execute`. Because `breath_count`
   is incremented in the `finally` *after* the breath body (so during the k-th
   1-indexed breath its value is `k-1`), the trigger is
   `if alive and (breath_count + 1) % REFLECT_EVERY_N_BREATHS == 0: await self.reflect()`
   — this fires on breaths N, 2N, … and never on the first breath.
   `reflect()` builds the isolated messages + reflection tool schemas, calls the
   decider, and applies §8. The reflection's own messages are **not** appended to
   `lifecycle_history` (it is a side-channel); only its *effects* (a written memory,
   a rebuilt system turn) persist.

A new `agents/reflection.py` holds the recap renderer + reflection tool schemas +
the prompt, keeping `runtime.py` focused. A new `memory/` package holds
`MemoryStore`, `MemoryItem`/`Importance`, the `Embedder`/`VectorStore` Protocols,
and the Chroma-backed implementations.

---

## 11. Acceptance tests (the finish line)

Determinism: no live model, no live Ollama; `MockDecider` + a **fake embedder**
(text → deterministic vector) + a fake/temp Chroma; all RNG seeded; fixed clock.

**Scorer (`memory/`):**
1. `recency` dominates: with importance/relevance held equal, a newer memory
   outranks an older one; matches `RECENCY_DECAY` arithmetic exactly.
2. `importance` dominates: a `HIGH` memory outranks a `LOW` one at equal
   recency/relevance — the grudge-beats-similarity property (Probe B).
3. `relevance` dominates: with the fake embedder, the memory closest to the query
   vector ranks first at equal recency/importance.
4. `retrieve(k)` returns at most `k`, correctly ordered.

**Store:**
5. `append_memory` then `retrieve` returns the item; `memory.jsonl` has exactly one
   new line; the vector store has one new entry.
6. `write_identity` is atomic and `load_identity` returns `seed + self`; `seed.md`
   is unchanged across multiple `write_identity` calls.
7. Crash-safety: a `memory.jsonl` with a truncated final line loads all prior items
   and ignores the partial line (no raise).

**Reflection step (`agents/`):**
8. `MockDecider` returning a `remember` call → a `MemoryItem` is persisted with the
   right content/importance/breath.
9. Returning `revise_self` → `identity.md` updated **and** `lifecycle_history[0]`
   rebuilt to include the new self-narrative.
10. Returning no tool calls → no write, no exception (Probe A path).

**Integration (real `WorldState`, mocked decider):**
11. Surfaced memories appear inside the perception `user` turn; history invariants
    hold (no two consecutive `user` turns; every assistant tool-call paired by id).
12. Reflection fires on breath `N` and not on breaths `1..N-1`.

**KV-cache guards:**
13. `lifecycle_history[0]` (system turn) is **byte-identical** across consecutive
    breaths when no `revise_self` occurs.
14. After a breath with surfaced memories, prior turns are unchanged (memories were
    appended at the tail, not inserted).

Target ≥90% coverage on `memory/` and the new `agents/reflection.py`; live-model
reflection behavior is validated by a separate `@pytest.mark.integration` smoke,
excluded from the fast/CI run.

---

## 12. Revisit / open questions (carried forward, not built here)

- **Memory eviction/forgetting.** `memory.jsonl` grows unbounded; `retrieve` is
  top-K so this is fine for a long while. A pruning/forgetting policy (e.g. drop
  persistently low-score items) → 5.5 or Revisit.
- **Salience-/event-triggered reflection.** Foundation uses a fixed cadence; an
  emotionally-salient event (betrayal, death nearby) triggering reflection is a 5.5
  enhancement.
- **Consolidation model choice** (8B self / local-swap / cloud) and the "external
  hand" tension → revisit with the 5.5 compaction engine.
- **Reproducibility of LLM-authored text.** Memory *content* is model output and not
  bit-reproducible across runs even when seeded; the *scoring/retrieval* is
  deterministic. Replay fidelity of authored text is a known limit.
- **DD9 wording of the reflective prompt** — kept strictly in-world; flagged for
  review during implementation.

---

## 13. File manifest

**New**
- `memory/__init__.py`, `memory/store.py` (`MemoryStore`),
  `memory/models.py` (`MemoryItem`, `Importance`),
  `memory/embedding.py` (`Embedder` Protocol + Chroma MiniLM impl),
  `memory/vector_store.py` (`VectorStore` Protocol + Chroma `PersistentClient` impl),
  `memory/scoring.py` (the §7 scorer).
- `agents/reflection.py` (recap renderer, reflection tool schemas, prompt).
- `tests/memory/*_test.py`, `tests/agents/reflection_test.py`, integration smoke.

**Modified**
- `agents/runtime.py` (§10), `core/constants.py` (§7 constants),
  `pyproject.toml` (add `chromadb` runtime dep), `config/` if a `memory_root` knob
  is surfaced, `CLAUDE.md` §8 commands if a memory-clean helper is added.

---

## 14. Changelog note (for `autonomous-agent-world-design.md`)

Record: (a) the write path is a **dedicated reflection step**, not an agent-visible
action tool, justified by the qwen3:8b spike (Probes A/C); (b) the embedding model
is Chroma's local **all-MiniLM-L6-v2**, chosen over an Ollama embed model to avoid
contending with the agent decider on Ollama's sequential backend.
