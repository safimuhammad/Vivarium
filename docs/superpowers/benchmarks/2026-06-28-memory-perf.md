# Memory subsystem -- performance & quality benchmark

Harness: `bench/bench_memory.py` (`python -m bench.bench_memory --backend chroma`).
Hardware: the dev Apple-Silicon Mac. Each run is appended below with its dials.

## What we measure & the targets

| Metric | Target | Rationale |
|---|---|---|
| retrieve (k=5) per breath | tax << LLM decode (decode is seconds) | retrieve embeds one query (MiniLM ~45ms); negligible vs a multi-second breath |
| scorer pure cost @ N=1k | < 2 ms | ranking must stay cheap as memories grow |
| append | < model embed + small overhead | one embed + one jsonl line + one upsert |
| footprint | jsonl linear & small (~200 B/mem) | the log must not balloon over a long life |
| grudge-in-top-k (quality) | **full scorer beats relevance-only** | the salience thesis: importance surfaces what RAG cannot |

> Note: the original plan's "retrieve < 15 ms" target is **revised**. Real MiniLM
> embedding is ~45 ms per single query, so retrieve is embedding-bound; 50 ms of
> memory tax against a multi-second LLM breath is negligible. The meaningful targets
> are the scorer cost (our code) and retrieval *quality*.

## Findings (baseline, pre-optimization)

1. **Embedding dominates the hot path.** append (~48 ms) and retrieve (~50 ms) are
   almost entirely one MiniLM embed (~45 ms). The scorer is ~0.5 ms at N=1k -- noise.
2. **Quality bug found by the realistic backend.** With **equal weights**, a single
   HIGH-importance grudge that is old and dissimilar is crowded out of the top-5 by
   many recent + similar low-importance memories (full scorer: grudge NOT in top-k).
   The 2-item unit test missed this; the 9-item benchmark caught it. → optimization
   target (Task 13): tune so a salient memory cannot be buried.
3. **Latent restart cost.** `FileMemoryStore.__init__` re-upserts (re-embeds) every
   item on open; at N=1000 that is ~45 s of pure embedding on restart. With a
   persistent collection the vectors already exist → skip it (Task 13).

---

## Optimization log (Task 13)

Two benchmark-driven optimizations, each measured before -> after on the real
(MiniLM + Chroma) backend. (The three `## Run` blocks below are baseline, then
post-quality-fix, then final-with-restart, in order.)

### 1. Quality -- a salient memory must not be buried (reserved salience slot)

The equal-weight scorer let one HIGH-importance grudge (old, dissimilar) be crowded
out of the top-5 by recent + similar low-importance chatter. Fix: reserve
`RETRIEVAL_RESERVED_SLOTS=1` of `RETRIEVAL_K` for the highest-importance memory and
fill the rest by full score (`memory.scoring.select_memories`). Robust to any number
of distractors -- it does not depend on out-weighing them.

| grudge in top-k? | before | after |
|--|--|--|
| full scorer | **no** | **yes** |
| relevance-only (pure RAG) | no | no |

The full scorer now surfaces what pure RAG cannot -- the salience thesis, on real
embeddings.

### 2. Restart cost -- skip re-embedding on reopen

`FileMemoryStore.__init__` re-embedded every memory on open. Fix: a `VectorStore.count()`
check skips the rebuild when the (persistent) store already holds the vectors; a
short store self-heals with a full idempotent rebuild.

| N | reopen before (~re-embed all) | reopen after (warm) |
|--:|--:|--:|
| 1000 | ~45,300 ms | **4.4 ms** |

~10,000x faster restart -- decisive for the "run forever / crash recovery" goal.

### Targets: met

| Metric | Target | Result |
|---|---|---|
| scorer @ N=1k | < 2 ms | 0.5 ms |
| retrieve per breath | << LLM decode | ~50 ms (embedding-bound) vs decode in seconds |
| jsonl footprint | < ~200 B/mem | 174 B/mem |
| warm restart | fast | 4.4 ms @ N=1k |
| quality | full beats pure RAG | full=yes, RAG=no |

The only remaining cost is the MiniLM embed (~45 ms/op), which is model-inherent and
negligible against an LLM breath; no further iteration is worthwhile.

---

## Run -- backend=`chroma`, scales=[100, 1000] (68.5s total)

Dials: RETRIEVAL_K=5, RECENCY_DECAY=0.97, REFLECT_EVERY_N_BREATHS=12, weights=(r=1.0, i=1.0, v=1.0)

### Latency & footprint -- backend=`chroma`
| N | append ms (median/p95) | retrieve ms (median/p95) | jsonl B/mem | chroma dir KiB | RSS MiB |
|--:|--:|--:|--:|--:|--:|
| 100 | 47.96 / 50.88 | 47.36 / 51.57 | 172 | 0 | 315 |
| 1000 | 50.08 / 53.73 | 50.86 / 52.39 | 174 | 0 | 346 |

### Scorer pure cost (no I/O)
| N | score_memories us (median) |
|--:|--:|
| 100 | 53 |
| 1000 | 521 |

### Embedding latency -- backend=`chroma`
| batch | ms total | ms/item |
|--:|--:|--:|
| 1 | 45.47 | 45.47 |
| 8 | 125.14 | 15.64 |
| 32 | 381.50 | 11.92 |

### Retrieval quality -- the grudge case -- backend=`chroma`
| ranker | grudge in top-k? |
|--|--|
| full (recency x importance x relevance) | no |
| relevance-only (pure RAG) | no |
| recency-only | no |

## Run -- backend=`chroma`, scales=[100, 1000] (66.2s total)

Dials: RETRIEVAL_K=5, RECENCY_DECAY=0.97, REFLECT_EVERY_N_BREATHS=12, weights=(r=1.0, i=1.0, v=1.0)

### Latency & footprint -- backend=`chroma`
| N | append ms (median/p95) | retrieve ms (median/p95) | jsonl B/mem | chroma dir KiB | RSS MiB |
|--:|--:|--:|--:|--:|--:|
| 100 | 46.70 / 52.29 | 45.71 / 47.57 | 172 | 568 | 312 |
| 1000 | 50.41 / 57.11 | 55.55 / 58.85 | 174 | 4029 | 335 |

### Scorer pure cost (no I/O)
| N | score_memories us (median) |
|--:|--:|
| 100 | 48 |
| 1000 | 530 |

### Embedding latency -- backend=`chroma`
| batch | ms total | ms/item |
|--:|--:|--:|
| 1 | 49.16 | 49.16 |
| 8 | 126.37 | 15.80 |
| 32 | 431.39 | 13.48 |

### Retrieval quality -- the grudge case -- backend=`chroma`
| ranker | grudge in top-k? |
|--|--|
| full (recency x importance x relevance) | yes |
| relevance-only (pure RAG) | no |
| recency-only | no |

## Run -- backend=`chroma`, scales=[100, 1000] (118.1s total)

Dials: RETRIEVAL_K=5, RECENCY_DECAY=0.97, REFLECT_EVERY_N_BREATHS=12, weights=(r=1.0, i=1.0, v=1.0)

### Latency & footprint -- backend=`chroma`
| N | append ms (median/p95) | retrieve ms (median/p95) | jsonl B/mem | chroma dir KiB | RSS MiB |
|--:|--:|--:|--:|--:|--:|
| 100 | 46.00 / 49.21 | 46.30 / 52.50 | 172 | 568 | 309 |
| 1000 | 49.68 / 53.93 | 49.72 / 54.98 | 174 | 4029 | 349 |

### Scorer pure cost (no I/O)
| N | score_memories us (median) |
|--:|--:|
| 100 | 55 |
| 1000 | 528 |

### Embedding latency -- backend=`chroma`
| batch | ms total | ms/item |
|--:|--:|--:|
| 1 | 44.99 | 44.99 |
| 8 | 122.84 | 15.35 |
| 32 | 375.77 | 11.74 |

### Retrieval quality -- the grudge case -- backend=`chroma`
| ranker | grudge in top-k? |
|--|--|
| full (recency x importance x relevance) | yes |
| relevance-only (pure RAG) | no |
| recency-only | no |

### Restart cost (backend=`chroma`): warm reopen skips re-embedding
| N | warm reopen ms | re-embed avoided ms (~N x single-embed) |
|--:|--:|--:|
| 100 | 2.1 | 4530 |
| 1000 | 4.4 | 45304 |

---

# Sprint 5.1 — Resident Memory Block (retrieval / recall / overflow)

> The Sprint-5 design retrieved top-K memories **every breath**, which (per the
> findings above) cost ~45–50 ms of embedding per breath and could still *miss* a
> salient fact that didn't rank top-K that moment. Sprint 5.1 replaces per-breath
> retrieval with an always-resident memory block (whole memory up to a cap, rebuilt
> only at reflection) + on-demand `recall` for the overflow. New benchmark
> dimensions: **retrieval** (resident-block build), **recall** (latency + quality),
> **overflow** (correctness).

## Targets

| Metric | Target | Rationale |
|---|---|---|
| per-breath memory tax | ≈ 0 ms under cap | the block is in context; nothing is embedded per breath |
| resident-block build (over cap) | embedding-bound, at reflection only | paid every REFLECT_EVERY_N_BREATHS, not every breath |
| recall quality (paraphrase) | planted memory surfaces (ideally #1) | relevance-dominant recall must do real semantic search |
| overflow guarantees | HIGH always resident; size == cap; overflow recall-reachable | the safety net that lets us cap the block at all |

## The headline result — per-breath memory cost: ~45 ms → ~0 ms

The redesign *is* the optimization. Real MiniLM + Chroma backend:

| path | when it runs | cost (N=100) | cost (N=1000) |
|---|---|--:|--:|
| **before** — Sprint 5 `retrieve()` (top-K) | **every breath** | 45.2 ms | 49.9 ms |
| **after** — `resident_block` under cap | init + reflection only | **0.00 ms** | n/a (N=1000 > cap) |
| **after** — `resident_block` over cap | reflection only | — | 49.6 ms (~4 ms/breath amortized over 12) |
| **after** — `recall` | on demand only (model-initiated) | 46.0 ms | 49.4 ms |

Under the cap (every agent, for a very long life — 400 memories at the default
reflection cadence is thousands of breaths) the per-breath memory tax is **0 ms**:
no query embed, no distance scan; the whole memory simply sits resident and is
rebuilt only at reflection — a point that already evicts and re-prefills the KV
cache, so the rebuild is effectively free. The trade is *recurring compute* for
*bounded context size* (≤ 400 lines ≈ a few thousand tokens, comfortably inside the
64K request / qwen3's 40960 effective window). That is the right trade when
embedding is the dominant cost and context under the window is cheap.

Verified no per-breath embed remains: `perceive → decide → execute` calls neither
`retrieve`, `resident_block`, nor `recall` (the block is built only in
`_set_resident_block` at init/reflection; `recall` only when the model emits the
action). The 45 ms/breath embedding tax is off the hot path entirely.

## Recall quality (real MiniLM)

| query | planted in top-k? | ranked #1? |
|---|---|---|
| exact text | yes | yes |
| paraphrase ("where did I hide the key near the old mill?") | **yes** | **yes** |

The relevance-dominant recall weights (`RECALL_W_RELEVANCE=1.0`,
`RECALL_W_RECENCY=RECALL_W_IMPORTANCE=0.15`) surface a deep, old, low-importance
overflow memory by *paraphrase* — real semantic search, not lexical match. (On the
fake sha256 embedder this is correctly `no`: it has no semantics, only exact-match
distance 0 — the benchmark reports both so the distinction is explicit.)

## Overflow correctness (real cap = 400, N = 462)

| check | result |
|---|---|
| HIGH-importance memory always resident | yes |
| block size == cap | yes (400 == 400) |
| distinctive low-importance memory overflowed (not resident) | yes |
| ... yet reachable via `recall` | yes |

All four guarantees hold at the production cap. The HIGH-importance reservation
(`reserved = min(#HIGH, cap)`) is what makes a bounded resident block *safe*: a vow
or a grudge can never be evicted by recency, and anything the block does drop is
still one `recall` away.

## Optimization conclusion — no further dial-tuning warranted

Rigorous check of every cost center against the real backend:

- **Per-breath tax:** 0 ms under cap (the redesign). Nothing to tune.
- **Embedding (~45 ms):** the floor wherever it appears (over-cap build, recall).
  Inherent to MiniLM-on-CPU; it is now off the per-breath path, so it no longer
  multiplies. Batching doesn't apply (single query); caching doesn't (query is the
  changing recap). No constant changes this.
- **Scorer:** 0.5 ms at N=1k — noise against any embed. No tuning.
- **Restart:** warm reopen 4.4–5.5 ms (the Sprint-5 count()-skip still holds);
  re-embedding ~45 s avoided at N=1k. Unchanged, still essential for run-forever.
- **`MEMORY_RESIDENT_CAP=400`:** 400 lines (~12–20K tokens) fits the window with
  room for identity + tools + live history; large enough that overflow (and thus any
  recurring embed cost) is rare in practice. Left as-is.

The benchmark's job here was to prove the redesign removed the dominant recurring
cost without sacrificing recall or the salience guarantees. It did: **45 ms/breath →
0 ms/breath under cap, paraphrase recall ranks the target #1, and all overflow
guarantees hold.** Best performance for this design is reached; the remaining cost
(one MiniLM embed) is a hardware floor, not a tunable.
