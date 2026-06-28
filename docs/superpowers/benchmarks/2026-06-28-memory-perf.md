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
