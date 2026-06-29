# Transcript compaction — never-overflow benchmark (Sprint 5.5)

Harness: `bench/bench_compaction.py`. The owner's one acceptance bar: **the assembled
prompt never exceeds the model's context window** (qwen3:8b = 40,960 tokens, prompt +
generation counted together). This doc records the evidence.

## The guarantee, in two parts

1. **Synthetic (property at scale).** Drive an agent for hundreds of breaths with
   realistic and worst-case turn sizes; assert the peak *estimated* prompt stays under
   `PROMPT_BUDGET_TOKENS` (34,816 = window − 6,144 generation reserve) on every breath.
2. **Estimator is conservative.** The synthetic proof assumes the estimate never
   *under*-counts the real prompt. `estimate_tokens` counts the **whole serialized
   message structure** — every `content`, every hidden `thinking` field, every
   `tool_calls` arguments blob, plus the tool schemas — and divides by
   `CHARS_PER_TOKEN = 3.5`. Real English tokenizes at ~4 chars/token; dividing by 3.5
   (smaller) **over**-counts, and counting JSON keys/punctuation that the chat template
   doesn't emit over-counts further. So the estimate is conservative by construction;
   the live mode (`--mode live`) confirms `estimate ≥ prompt_eval_count` against real
   qwen3 output.

## Synthetic results (`python -m bench.bench_compaction --mode synthetic`)

Dials: `MODEL_CONTEXT=40960`, `PROMPT_BUDGET=34816`, `TRIGGER=24371`, `TARGET=17408`,
`KEEP_RECENT=8`, `CHARS_PER_TOKEN=3.5`, `RECAP_RESERVE=512`.

| breaths | thinking/turn | peak prompt (est) | % of window | mean prompt | final turns | compactions | verdict |
|--:|--:|--:|--:|--:|--:|--:|--|
| 400 | ~750 tok | 24,825 | 61% | 19,511 | 56 | 64 | **PASS** |
| 500 | ~1,250 tok | 25,282 | 62% | 20,734 | 38 | 112 | **PASS** |
| 1000 | ~2,000 tok | 26,762 | 65% | 20,860 | 32 | 259 | **PASS** |

**Reading it:** the peak sits just above `TRIGGER` (24,371) — compaction fires at the
trigger and the prompt grows by at most one breath before the next breath compacts
again, so the peak is `trigger + one breath`, never near the 40,960 ceiling. The
transcript is **pinned at ~32–56 turns regardless of run length** — it does not grow
with time. Bigger per-turn thinking just means *more frequent* compaction, not a
bigger peak. This is the run-forever property: an agent can breathe indefinitely and
the prompt is bounded for all time.

## Why the peak can't exceed the budget (trace)

`_ensure_context_budget` runs every breath before `decide()`:

1. If the estimate exceeds the target (or the last *actual* `prompt_eval_count`
   exceeded the 90%-of-budget hard-safety net), `compact()` evicts the oldest whole
   breath-groups down toward the target — **mechanically, before** the recap LLM call,
   so a failed/slow recap model still leaves the transcript bounded.
2. `_enforce_prompt_budget` then *guarantees* the estimate is ≤ budget: it shrinks the
   recap, then the in-context memory block, then drops oldest breath-groups — each
   loop terminating (geometric shrink; ≥1-turn floor, safe because the generation
   reserve caps any single turn far below the budget).

The recap itself is bounded at authoring to `RECAP_RESERVE`, so the cumulative
summary cannot grow across compactions.

## Optimization note

This is already at the efficient frontier for the bar: peak ≈ `TRIGGER + one breath`.
Raising `TRIGGER`/`TARGET` would retain more verbatim context (fewer compactions) at a
higher peak; the current 0.70/0.50 split keeps the peak at ~65% of the window with
comfortable headroom for generation and estimator error — the right trade when the
acceptance bar is *never overflow*. No further tuning warranted unless a longer live
run shows the estimator drifting (the hard-safety net would catch that regardless).

## Live mode (estimator conservativeness) — measured on real qwen3:8b

`python -m bench.bench_compaction --mode live --breaths 8` runs real qwen3 breaths and
prints per-breath `estimate` vs the model-reported `prompt_eval_count`, asserting
`estimate ≥ actual`. **Result: PASS on every breath, by a wide margin.**

| breath | estimate | actual `prompt_eval_count` | est ≥ actual? |
|--:|--:|--:|--|
| 0 | 1,553 | 1,130 | yes |
| 1 | 3,055 | 1,367 | yes |
| 2 | 3,774 | 1,533 | yes |
| 3 | 4,427 | 1,767 | yes |
| 4 | 5,587 | 1,937 | yes |
| 5 | 6,520 | 2,174 | yes |
| 6 | 8,037 | 2,411 | yes |
| 7 | 9,049 | 2,578 | yes |

Peak actual prompt: 2,578 tokens (6% of the window) over 8 breaths.

**Reading it:** the estimate runs ~1.4–3.5× the real `prompt_eval_count` and the gap
*widens* with transcript size. This confirms the analytical argument empirically: the
estimate over-counts by both the 3.5 chars/token divisor and the serialized JSON
structure (keys, punctuation, `thinking` fields, the tool schemas) that the chat
template does not all emit as real tokens. The estimator never under-counts on real
qwen3, so the synthetic proof (which assumes `estimate ≥ actual`) holds against reality.
The hard-safety net keys off the real `prompt_eval_count` regardless, as the runtime
backstop if a future model ever tokenizes more densely than this margin absorbs.

## The never-overflow guarantee is now closed on BOTH sides

The window counts prompt + generation together. This sprint bounds **both**:

- **Prompt side:** compaction keeps the estimate under `TRIGGER`/`TARGET`; the floor
  net (`_enforce_prompt_budget`) then *guarantees* the estimate ≤ `PROMPT_BUDGET`,
  degrading in order — shrink recap → shrink memory block → drop oldest breath-groups →
  shrink surviving turns newest-first (system turn last). The only irreducible floor is
  the tool schemas themselves; if they alone exceeded the budget the agent logs
  `CRITICAL` rather than silently overflow (a misconfiguration that cannot occur with
  the current ~handful of small schemas).
- **Generation side:** `OllamaDecider` sets `num_predict = GENERATION_RESERVE_TOKENS`
  (6,144), so the model can never generate past the reserve. `PROMPT_BUDGET` = window −
  reserve, so `prompt + generation ≤ window` by construction.
