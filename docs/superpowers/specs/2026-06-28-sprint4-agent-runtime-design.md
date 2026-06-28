# Spec — Sprint 4: Agent Breathing Loop (+ agreed gameplay rules & world-tick)

> **Date:** 2026-06-28 · **Status:** DRAFT — for review-team vetting, then Safi sign-off
> **Author:** Safi (vision) + Claude (design)
> **Standards source:** `CLAUDE.md`. Builds on the merged production foundation.
> **Finish condition:** the Acceptance Test Suite (§9) is GREEN (unit, deterministic,
> no live LLM) and the live integration smoke (§9.6) runs against Ollama by hand.

---

## 1. Goal

Make the world **live**. Turn the `agents/runtime.py` skeleton into a real
**breathing loop** — `perceive → decide → execute → sleep` — driving a single agent
against the *real* `WorldState`/`EventBus`/`ToolRegistry` (no mocks in production),
powered by a local LLM via Ollama, with the loop itself fully unit-testable via a
mock decider. Fold in the four agreed gameplay rules and a minimal world-tick so the
single agent breathes against a **self-healing** world — the first concrete step
toward the self-sustaining art piece.

This is SPRINT 4 (D2–D5) plus the agreed rule wiring. It does NOT include memory/RAG
(Sprint 5), multi-agent orchestration / main entry point (Sprint 6), the dashboard,
or the orchestrator/council (deferred).

## 2. Design decisions — FLAGGED FOR REVIEW

The review team should pressure-test each of these; they are my recommendations, not
settled.

- **DD1 — Decider as an injected dependency (Protocol).** `Agent` receives a
  `Decider` (not a model string it calls inline). Real `OllamaDecider` + test
  `MockDecider` behind `async def decide(messages, tools) -> Decision`. This changes
  the skeleton `__init__` signature (replaces `model: str` with `decider: Decider`;
  a factory builds the default `OllamaDecider(model)`).
- **DD2 — Non-streaming decider core.** `OllamaDecider` uses a single
  `ollama.chat(model, messages, tools=...)` call and returns a `Decision`. The rich
  live-streaming UI from the Layer-0 prototype is an *observation* concern and belongs
  in a later activity-feed layer, NOT the core loop. (Recommendation; review may
  prefer streaming for latency.)
- **DD3 — Explicit tool schemas.** A `agents/tool_schemas.py` maps built-in tool
  names → Ollama function schemas (params/required), hand-authored for control.
  (Alternative: auto-generate from tool signatures — more magic, deferred.)
- **DD4 — Status logic location.** Paralysis (energy ≤ `PARALYSIS_ENERGY_THRESHOLD`)
  and revival (fed back above it) live in `WorldState.modify_agent_energy` (that is
  where energy changes). **Death** is combat-specific: `attack` sets `DEAD` when the
  target's energy reaches `KILL_ENERGY_THRESHOLD` (0.0). Starvation paralyzes, it does
  not kill (per the design doc).
- **DD5 — World-tick as a separate async task.** A `world_tick()` coroutine
  periodically calls `regenerate_resources()` and sweeps `pending_proposals` for
  timeout-refund. Driven on its own cadence, independent of any agent's pace.
- **DD6 — The gameplay rules CHANGE behavior the foundation pinned.** Several Phase
  2/3 characterization tests asserted the *old* behavior (move costs nothing,
  paralysis only at 0.0, region mutators don't cap). Implementing the rules REQUIRES
  updating those tests to the new contract. This is expected and in-scope; reviewers
  should confirm the list in §7 is complete.

## 3. Architecture (new + changed)

```
Agent.run()                      # while alive: breathe(); sleep(pace)
  └─ breathe()                   # one breath
       ├─ perceive()             # drain inbox + query world -> perception message
       ├─ (skip if PARALYZED)
       ├─ decide()  ── Decider ──┤ OllamaDecider (prod) | MockDecider (tests)
       │                         └─ returns Decision{text, thinking, tool_calls}
       ├─ execute(tool_calls) ── await ToolRegistry.invoke(...) -> result strings
       └─ refresh status         # PARALYZED -> can't act; DEAD -> stop

world_tick()  (separate task)    # regenerate_resources() + proposal-timeout sweep
```

New modules: `agents/decider.py` (`Decider` protocol, `Decision`, `ToolCall`,
`OllamaDecider`), `agents/tool_schemas.py`, `agents/prompt.py` (system-prompt
builder), and a world-tick home (`world/tick.py` or a method — reviewer's call).
Changed: `agents/runtime.py` (the loop), `world/world.py` (paralysis/revival +
cooldown/offspring tracking + mutator caps), `tools/builtin/{movement,combat,mating}.py`
(rule wiring), `tests/conftest.py` (align `MockDecider`/`ToolCall` with `Decision`).

## 4. Components

### 4.1 Decider (`agents/decider.py`)
- `ToolCall(name: str, params: dict[str, Any])` — the canonical decision unit
  (consolidate with conftest's `ToolCall`).
- `Decision(text: str, thinking: str, tool_calls: list[ToolCall])`.
- `class Decider(Protocol): async def decide(self, messages, tools) -> Decision`.
- `OllamaDecider(model: str)` — wraps `ollama.chat`; parses content/thinking/tool
  calls into a `Decision`; on a plain-text (no-tool) response returns an empty
  `tool_calls` (the loop continues — graceful degradation). Integration-tested only.

### 4.2 Perceiver (`Agent.perceive`)
Drain `event_bus.get_events(agent_id)`; compose a natural-language perception of: the
agent's own state (energy, materials, position, status), the current region
(description, connections, co-located agents, resource levels), and the drained
events. Append as a `user`-role message to `lifecycle_history`. The agent must remain
unaware it is in a simulation (no meta language).

### 4.3 Decide (`Agent.decide`)
Build the message list (system prompt via `agents/prompt.py` + `lifecycle_history`) and
the tool schemas; call `self.decider.decide(...)`; append the assistant message
(thinking/content/tool_calls) to `lifecycle_history`; return `decision.tool_calls`.

### 4.4 Execute (`Agent.execute`)
For each `ToolCall`: `result = await self.tool_registry.invoke(name, agent_id, params)`;
append a `tool`-role message with the result string; collect results. A `ToolError`
(unknown tool / bad params) is caught, logged, and turned into a feedback string for
the agent (loop never crashes). Before an `attack`, if attacker energy <
`ATTACK_ENERGY_COST`, inject a warning into context (revisit-list item).

### 4.5 Status lifecycle (`Agent`, after execute)
Re-read `agent_state`. If `PARALYZED`: subsequent breaths only perceive (no
decide/execute) until revived. If `DEAD`: set `self.alive = False` and stop. This is
where paralysis/death surface to the loop.

### 4.6 Breathe / Run (`Agent.breathe`, `Agent.run`)
`breathe()` runs one cycle and increments `breath_count`. `run(max_breaths: int | None
= None)` loops `while self.alive` calling `breathe()` then `await asyncio.sleep(pace)`;
`max_breaths` bounds it for tests. Per-breath exceptions are logged and the loop
continues (graceful degradation).

### 4.7 World-tick (`world_tick`)
`async def world_tick(world, event_bus, *, interval)` (or a `tick(world)` step):
calls `world.regenerate_resources()` and refunds + removes any `pending_proposals`
older than the mating timeout (using `world.now()` vs the proposal timestamp).

## 5. Agreed gameplay-rule wiring

| Rule | Change | Where |
|------|--------|-------|
| **Move costs energy** | `move` checks & deducts `MOVE_ENERGY_COST`; "Invalid:" if too low | `tools/builtin/movement.py` |
| **Death** | `attack` sets target `DEAD` + emits `agent_killed` when energy ≤ `KILL_ENERGY_THRESHOLD` | `tools/builtin/combat.py` |
| **Paralysis / revival** | `modify_agent_energy` sets `PARALYZED` at ≤ `PARALYSIS_ENERGY_THRESHOLD` (and > kill), `ALIVE` again when fed above it | `world/world.py` |
| **Mating enforcement** | enforce `MATING_MIN_*_CONTRIBUTION`, `MATING_COOLDOWN_SECONDS`, `MATING_MAX_OFFSPRING` (needs per-agent last-mating time + offspring count on `WorldState`) | `tools/builtin/mating.py` + `world/world.py` |
| **Mutator caps** (minor) | `modify_agent/region_*` cap at `max_*` (not just floor at 0) | `world/world.py` |

## 6. Determinism & testing strategy
- Loop tests inject `MockDecider` (scripted `Decision`s) + the seeded `world` /
  `fake_clock` fixtures. No unit test touches Ollama or wall-clock/global random.
- `OllamaDecider` and a 1-agent end-to-end breathe are `@pytest.mark.integration`
  (excluded from the default/CI run; run by hand with Ollama up).
- Coverage bar from `CLAUDE.md` §5 (≥90% on touched packages incl. `agents/`; add
  `agents` to the coverage source and remove it from the mypy ignore once real).

## 7. Foundation tests to UPDATE (because the rules change behavior)
- `tests/world/world_test.py`: paralysis-at-0.0 test → ≤ threshold; "modify_region
  does not cap" → now caps; add death/revival cases.
- `tests/tools/movement_test.py`: "move charges no energy" → now charges.
- `tests/tools/mating_test.py`: add min-contribution / cooldown / max-offspring
  rejection cases.
- `tests/tools/combat_test.py`: add kill-threshold → DEAD case.

## 8. Out of scope (YAGNI)
Memory/RAG (Sprint 5); multi-agent runner + `scripts/run.py` (Sprint 6); dashboard;
orchestrator/council; identity self-reflection; economy homeostasis tuning (we wire
the regulators here; *tuning* the numbers is later observation work).

## 9. Acceptance Test Suite — THE FINISH CONDITION

The build is done when all of these (unit, deterministic) pass, plus §9.6 runs by hand.

**9.1 Loop mechanics (MockDecider)**
- `breathe()` once with a scripted `look_around` → a `user` perception msg, an
  `assistant` msg, and a `tool` result msg are appended; `breath_count == 1`.
- `run(max_breaths=5)` with a cycling script → exactly 5 breaths; loop exits.
- A `Decision` with empty `tool_calls` (plain text) → breath completes, no crash.
- `execute` of an unknown tool name → caught, feedback appended, loop continues.

**9.2 Perception**
- After another agent publishes a LOCAL `speak` in the agent's region, the next
  `perceive()` includes that event in the perception message; the inbox is drained.
- Perception includes the agent's own energy/materials/position/status and the
  region's occupants/connections.

**9.3 Status lifecycle**
- Energy driven to ≤ `PARALYSIS_ENERGY_THRESHOLD` → status `PARALYZED`; a paralyzed
  agent's `breathe()` perceives but does NOT decide/execute.
- Feeding a paralyzed agent above threshold → `ALIVE`; it acts again.
- `attack` bringing a target to ≤ `KILL_ENERGY_THRESHOLD` → target `DEAD` +
  `agent_killed` event; a dead agent's `run()` stops (`alive == False`).

**9.4 Gameplay rules**
- `move` deducts `MOVE_ENERGY_COST`; with insufficient energy returns `Invalid:` and
  does not move.
- `initiate_mating` below `MATING_MIN_*` → `Invalid:`; within cooldown → `Invalid:`;
  beyond `MATING_MAX_OFFSPRING` → `Invalid:`.
- `modify_region_energy`/`modify_agent_energy` cap at `max_*`.

**9.5 World-tick**
- One tick regenerates region resources (capped) by the configured rates.
- A `pending_proposal` older than the timeout is refunded to the initiator and
  removed; a fresh one is left intact (driven by `fake_clock`).

**9.6 Live integration smoke (`@pytest.mark.integration`, by hand)**
- With Ollama up, a single real agent `run(max_breaths=10)` against the real world
  completes 10 breaths without crashing, makes ≥1 valid tool call, and mutates the
  world (position or resources change).

## 10. Build plan (after sign-off, TDD)
Tests-first per §9, then implement until green, orchestrated by dependency order:
(a) decider/prompt/tool_schemas + conftest alignment; (b) world rule + status + tick
changes (update foundation tests); (c) the loop (`perceive/decide/execute/breathe/run`);
(d) integration smoke. Claude orchestrates, gates, commits per phase.
