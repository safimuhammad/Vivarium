# Memory subsystem — fresh end-to-end benchmark (current Gemini-era setup)

Re-run of `bench/bench_memory.py --backend chroma` and `bench/bench_compaction.py`
on 2026-06-30, after the move to the hosted Gemini decider + the full-context
directive. Compares against the 2026-06-28 Sprint-5 baseline.

## Verdict

**The memory subsystem is healthy and unchanged — no regression.** Memory operations
are decider-independent (embeddings are local MiniLM regardless of Gemini/Ollama), so
the Sprint-5 numbers and optimizations carry over intact. The one actionable finding is
NOT in the memory subsystem itself — it is the **compaction context window, hardcoded
to Ollama's 40 960 tokens while Gemini offers ~1 000 000** (see below).

## Memory subsystem numbers (chroma + MiniLM, scales 100 / 1000)

| metric | current (2026-06-30) | baseline (2026-06-28) | note |
|---|---|---|---|
| append | ~49–52 ms | ~48 ms | one MiniLM embed (~47 ms) + jsonl + upsert |
| retrieve (k=5) | ~47–52 ms | ~50 ms | embedding-bound (one query embed) |
| resident-block, **under cap** | **~0 ms** | ~0 ms | whole-memory-resident; the per-breath tax in our runs |
| resident-block, over cap (N=1000) | ~52 ms | ~50 ms | one query embed + scan |
| recall (k=5) | ~49–52 ms | ~50 ms | embedding-bound |
| scorer pure (N=1000) | ~0.5 ms | ~0.5 ms | negligible |
| restart warm-reopen (N=1000) | **5.9 ms** | ~4–6 ms | skips ~47 s of re-embedding |
| embedding | 1:47 / 8:16 / 32:12 ms/item | same | batching amortizes |

Quality (chroma): salience scorer surfaces the planted grudge that pure-RAG and
pure-recency both miss; recall finds a planted memory by exact text **and paraphrase**;
overflow correctness holds (HIGH always resident, block==cap, overflowed item still
recallable).

**Takeaway:** the hot path is one MiniLM embed (~47 ms) per embed-needing op; while an
agent holds < `MEMORY_RESIDENT_CAP` (400) memories — the case in every run so far — the
per-breath memory cost is **~0 ms**. Nothing to optimize here; the Sprint-5 wins
(resident block, skip-reembed restart, salience scorer) are intact under Gemini.

## The finding: compaction is mis-tuned for Gemini's window

`bench_compaction.py` (synthetic 400 breaths):

```
PROMPT_BUDGET=34816, window=40960, trigger=24371
peak estimated prompt: 25322 tok (62% of the 40960 window)
compactions performed: 51   ·   final history turns: 47
PASS: never-overflow guarantee holds
```

`MODEL_CONTEXT_TOKENS = 40960` is **Ollama/qwen3's** window. Under the hosted Gemini
model (~1 M window) this means:

- Agents compact their lived history at **~24 K tokens** — i.e. they use **~2.4 % of
  the available context** and discard the rest into the recap.
- Confirmed in the live runs: run-6 averaged ~15.4 K input tokens/decision (25.6 M in /
  1 660 decisions) — sitting under the 24 K trigger, compacting repeatedly.
- This directly contradicts the standing directive to **"use the full 1 M window."**
  We are throwing away ~96 % of the context the model offers.

**This is the optimization the benchmark surfaces.** It is a *config/architecture*
change (make the context window provider/model-aware), not a memory-subsystem speedup.
The trade-off is cost: prompt cost scales ~linearly with context size (the input-token
spend we measured at ~340:1 in:out), so a larger window means richer in-context memory
at higher $/breath. The exact target is a dial for Safi to set (see the decision raised
alongside this report).
