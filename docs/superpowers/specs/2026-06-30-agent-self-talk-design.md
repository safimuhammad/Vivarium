# Self-Talk & the Freedom Not to Act — Design

**Date:** 2026-06-30
**Status:** Approved — ready for implementation planning
**Topic:** Let a being *act*, *speak to itself*, or *simply rest* on any breath — no obligation to act every turn — and make the resulting inner voice perceivable.

---

## 1. Motivation

Vivarium's north star is authentic **existence**, not task-solving. A living thing does
not act every single moment — it also muses, and it rests. Today a being is implicitly
pushed to *do* something each breath. This feature restores the freedom to do nothing,
and — because **perception is the product** — makes the thoughts a being voices while
idle observable to the watchers.

This is a *freedom*, not a new communication channel. Self-talk is a being talking with
no obligation to convey anything to anyone: not `speak`, not targeted, not broadcast.

## 2. Current behaviour (grounded in code)

- The breath is `perceive → decide → execute → refresh_status` (`agents/runtime.py:865`).
- `decide()` returns `Decision(text, thinking, tool_calls, …)`. **A decision may carry free
  text with no tool call** — docstring: *"empty [tool_calls] for a plain-text response
  (the loop simply continues)."* `execute([])` already no-ops (`runtime.py:888`).
  → A no-action breath is *mechanically* supported today.
- Two gaps:
  1. **The being is funnelled toward acting.** No hard `tool_choice=required`, but the
     framing plus the `wait` tool (which only returns a *canned* rest phrase and mutates
     nothing) means "voice a thought and take no action" is never offered as a first-class
     choice.
  2. **Free text is invisible.** A no-tool decision's `text` is appended to
     `lifecycle_history` but **emitted nowhere** — no event, no feed — so nobody perceives it.
- Energy is spent **per action** (`GENERIC_ACTION_ENERGY_COST=1.0`, `MOVE_ENERGY_COST=5.0`,
  …); there is no per-breath metabolism, so a no-action breath spends nothing.

## 3. Design

A breath resolves three ways:

1. **Act** — the decision calls a world/communicative tool (`move`, `speak`, `attack`, …).
   Unchanged.
2. **Self-talk** — the decision carries **free text and no tool**. The being voiced a
   thought with no intent to act. The runtime emits a new **`self_talk` event** carrying
   that text.
3. **Rest** — the decision carries neither tool nor meaningful text: a breather. **Left
   silent** — no marker, no event; the being simply breathes.

### 3.1 Self-talk is observable, but routed to no one

- Add `ScopeType.PRIVATE`. A `PRIVATE` event is **logged (JsonlEventLog) and fed
  (FeedEventLog / activity feed), but delivered to no agent inbox.** This keeps self-talk
  on the uniform observability pipeline (so it replays and can drive the UI) while
  guaranteeing no other being perceives it. There is no target, no whisper, no broadcast,
  and no communication cost.
- The **runtime** — not a tool — publishes the `self_talk` event after `decide()` when the
  decision is text-only. The being needs no channel: it simply talks, and the world
  *observes* (as the watchers observe everything).
- The text stays in the being's own `lifecycle_history` (working memory) as it does today,
  so it colours later breaths. It becomes *durable* memory only if the being later reflects
  on it (the normal reflection path). No special memory handling is added.

### 3.2 Framing: offer the freedom

- Adjust the action framing to say, in-world, that the being may **act, speak its mind
  without acting, or simply rest** — so non-action is a genuine offered choice, not an
  omission. No new tool; no channel (per the intent). This is what makes a tool-happy small
  model actually take the breather.

### 3.3 The `wait` tool — retired

- `wait` is redundant for "do nothing," and is **retired**. Its role folds into the
  rest/self-talk freedom, and the free-text path is strictly richer (the being's own words
  vs a canned phrase). Remove the tool, its schema entry, and update affected tests.

## 4. Scope / non-goals

- **Not overhearable.** Self-talk is private interiority; other beings never receive it.
- **Not surfacing hidden `thinking`.** Exposing the model's *action-reasoning* is a
  separate, related idea; out of scope here. This feature surfaces only the being's
  **chosen** words.
- **Resting is free.** No metabolic cost for a breather (decided). This is consistent with
  today's per-action costing; whether to introduce a metabolism later remains a separate
  world-rules decision, out of scope here.

## 5. Observability & the UI

- `self_talk` renders in the activity feed, and in the forthcoming isometric UI as a
  **distinct thought-bubble** (visually separate from `speak`). The self-talk vs speech
  bubbles already sketched in the `H` mockup would be driven by real `self_talk` vs `speak`
  events.

## 6. Resolved decisions

1. **`wait`:** retired (§3.3).
2. **Rest visibility:** silent — a breather emits no marker and no event (§3, item 3).
3. **Event name:** `self_talk`.
4. **Resting cost:** free — no metabolism (§4).

## 7. Testing (determinism: mocked decider, seeded RNG)

- Text-only decision → exactly one `self_talk` PRIVATE event carrying that text; **every
  agent inbox empty** (assert nobody received it); no energy spent.
- Tool decision → no `self_talk` event; normal path.
- Empty decision (no tool, no meaningful text) → silent rest: **no `self_talk` event, no
  marker**.
- Self-talk text is present in `lifecycle_history` after the breath.
- Bus: a `PRIVATE`-scope event is logged + fed but routes to **zero** inboxes.
- `wait` removal: no lingering references in schemas/registry/tests.

## 8. Architecture fit / touch points

- `bus/events.py` — add `ScopeType.PRIVATE`; `bus/` routing — a branch that logs + feeds
  but enqueues to no inbox.
- `agents/runtime.py` — emit `self_talk` after `decide()` on a text-only breath; framing
  string update.
- `tools/builtin/communication.py` + `agents/tool_schemas.py` — remove `wait`.
- No new agent tool; no `WorldState` mutation for self-talk or rest.
