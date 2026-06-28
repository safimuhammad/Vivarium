# Spec — Sprint 4: Agent Breathing Loop (v2, post-review)

> **Date:** 2026-06-28 · **Status:** REVISED after review team + Safi decisions — for sign-off
> **Author:** Safi (vision) + Claude (design) · reviewed by a 4-agent adversarial team
> **Standards source:** `CLAUDE.md`. Builds on the merged production foundation.
> **Finish condition:** the Acceptance Test Suite (§9) is GREEN (unit, deterministic,
> no live LLM); the live integration smoke (§9.7) runs by hand against Ollama.

---

## 0. What changed from v1 (decisions taken)
- **Descoped to Sprint 6:** agent **death** and **mating enforcement** (min
  contribution / cooldown / max-offspring) — they are multi-agent mechanics a single
  agent can't exercise, and bundling them imported population/extinction failure modes
  prematurely. (The mating *tools* already exist from Phase 3; we just don't add
  enforcement here.)
- **Paralysis = legitimate failure boundary.** No artificial rescue for a lone agent.
  The milestone is: sustain energy homeostasis (harvest vs. drain) for N breaths
  *without* paralyzing. Paralysis ends the run.
- **Observability in-scope:** a thin **append-only event-log sink** (the replay
  record) + structured per-breath trace. Not the dashboard.
- Plus ~20 design corrections from the review (folded throughout; see §2, §5, §7).

## 1. Goal
Make the world **live**: turn the `agents/runtime.py` skeleton into a real breathing
loop — `perceive → decide → execute → sleep` — driving a **single** agent against the
*real* `WorldState`/`EventBus`/`ToolRegistry`, powered by Ollama, with the loop fully
unit-testable via a mock decider. Wire the energy economy (move-cost + paralysis) so
the agent must maintain homeostasis against a self-healing world, and capture every
event to an append-only log.

## 2. Design decisions (settled)
- **DD1 — Decider as injected dependency (Protocol).** `Agent` takes a `Decider`, not a
  model string. `OllamaDecider` (real, integration-only) + `MockDecider` (tests) behind
  `async def decide(messages, tools) -> Decision`. `Agent.__init__` replaces `model:
  str` with `decider: Decider`; `agents/decider.py` exposes `make_default_decider(model)`
  for Sprint 6's runner to build the real one.
- **DD2 — Non-streaming decider core.** One `ollama.chat(model, messages, tools=...)`
  call → `Decision`. Rich live-streaming is a later observation concern. `# pragma: no
  cover` the network body; **pin `ollama`** in `pyproject.toml`.
- **DD3 — Tool schemas with a parity invariant.** `agents/tool_schemas.py` hand-authors
  schema *bodies*, but the schema *set* derives from `tools.builtin.BUILTIN_TOOLS`; a
  test asserts `set(schemas) == set(BUILTIN_TOOLS)`. Enum-valued params (resource types)
  are schema-constrained to enum string values.
- **DD4 — Status: separation by WRITER, not by energy value.** `modify_agent_energy` is
  the SOLE `ALIVE↔PARALYZED` writer: paralyze at `energy ≤ PARALYSIS_ENERGY_THRESHOLD`
  (**including 0.0**); revive to `ALIVE` only from `PARALYZED` when `energy >
  PARALYSIS_ENERGY_THRESHOLD`. It **early-returns on `DEAD`** (terminal — guards the
  Sprint-6 death writer against resurrection). `WorldState` does NOT emit events (it has
  no bus). **Death is Sprint 6** (`attack` will be the sole `DEAD` writer, set *after*
  the drain).
- **DD5 — World-tick is a pure single step + thin driver.** `world/tick.py` exposes
  `tick(world, event_bus) -> None` (regenerate resources + sweep timed-out proposals)
  and a `@pytest.mark.integration` `run_world_tick(..., *, interval)` wrapper. The pure
  step is unit-tested with a fake clock. It is NOT a `WorldState` method (would invert
  the `EventBus → WorldState` dependency).
- **DD6 — Enum param marshaling at the boundary.** Ollama returns JSON (string keys);
  `execute` / the tools coerce `resource_type` / resource keys to `ResourceTypes` before
  use (harvest/transfer already coerce; make it uniform).
- **DD7 — Replay stance.** A free-running tick + agent `sleep` is not *ordering*-
  reproducible across wall-clock runs; **replay is from the append-only event log**, not
  re-simulation. Seeded RNG makes individual outcomes deterministic; the log makes the
  run re-watchable. State this explicitly.
- **DD8 — Mutator caps: regions only.** `modify_region_energy/materials` cap at
  `max_*`. **Agents are NOT capped** (no `max_*` fields, and capping would clip escrow
  refunds and destroy resources). Agent mutators keep the floor-at-0 only.
- **DD9 — System prompt is persona + tool affordances ONLY.** No injected goals,
  survival instructions, or strategy (anti-scripting; agents must not know they're in a
  sim). `agents/prompt.py` owns this.

## 3. Architecture
```
Agent.run(max_breaths=None, pace=...)        # while alive & not paralyzed: breathe(); sleep(pace)
  └─ breathe()
       ├─ perceive()                          # drain inbox + world snapshot -> user msg
       ├─ decide()  ── Decider ── Decision{text, thinking, tool_calls:[ToolCall(id?,name,params)]}
       ├─ execute(tool_calls)                 # await registry.invoke(...) -> result strings
       └─ refresh_status()                    # PARALYZED -> emit agent_paralyzed, stop acting

world/tick.py::tick(world, event_bus)         # regenerate_resources() + proposal-timeout sweep
observability/event_log.py                    # append-only sink; EventBus records every event
```
New modules: `agents/decider.py`, `agents/tool_schemas.py`, `agents/prompt.py`,
`world/tick.py`, `observability/event_log.py`. Changed: `agents/runtime.py`,
`world/world.py` (paralysis/revival + DEAD guard + region caps), `tools/builtin/movement.py`
(move-cost, validate-before-deduct), `bus/event_bus.py` (optional event-log sink +
`unsubscribe`), `tests/conftest.py` (align `MockDecider`/`ToolCall`; `populated_registry`).

## 4. Components
### 4.1 Decider (`agents/decider.py`)
`ToolCall(id: str | None, name: str, params: dict[str, Any])`; `Decision(text: str,
thinking: str, tool_calls: list[ToolCall])`; `class Decider(Protocol): async def
decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision`;
`OllamaDecider(model)` (non-streaming, parses content/thinking/tool_calls; empty
tool_calls on plain text — loop continues); `make_default_decider(model)`.

### 4.2 Perceiver (`Agent.perceive`)
Drain `event_bus.get_events(agent_id)`, order chronologically by timestamp; compose ONE
`user`-role perception message = own state (energy/materials/position/status) + region
snapshot (description, connections, co-located agents, resource levels) + the events.
Avoid double-reporting region state with `look_around`. No meta/sim language. Append to
`lifecycle_history`.

### 4.3 Decide (`Agent.decide`)
Build messages (system prompt via `agents/prompt.py` + `lifecycle_history`) + tool
schemas; `decision = await self.decider.decide(messages, tools)`; **append atomically**
(see 4.4). Return `decision`.

### 4.4 Execute (`Agent.execute`) + history integrity
For each `ToolCall`: `result = await registry.invoke(name, agent_id, coerced_params)`;
append a `tool` message paired to the assistant tool_call **by id**. A `ToolError`
(unknown tool/bad params) is caught, logged, fed back as a `tool` message — loop never
crashes. **History atomicity:** the assistant message + all its tool results are
appended together; if `decide()` raises, the perception `user` msg is rolled back so
history never has two consecutive `user` turns (which breaks chat backends).

### 4.5 Status (`Agent.refresh_status`)
Re-read `agent_state`. On an `ALIVE→PARALYZED` transition, emit a system
`agent_paralyzed` event (the Agent has the bus) and set the loop to stop acting
(paralysis is terminal for this milestone, DD-paralysis). `DEAD` handling is Sprint 6.

### 4.6 Breathe / Run
`breathe()` = perceive → decide → execute → refresh_status; `breath_count += 1`.
`run(max_breaths=None, pace=0.0)` loops `while self.alive and not paralyzed`, `breathe()`
then `await asyncio.sleep(pace)` (skip the trailing sleep when the budget is exhausted).
Per-breath exceptions are logged and the loop continues; a failed `decide` backs off
(don't busy-loop if Ollama is down).

### 4.7 World-tick (`world/tick.py`)
`tick(world, event_bus)`: `world.regenerate_resources()`; then snapshot
`list(world.pending_proposals.items())`, and for each older than
`MATING_PROPOSAL_TIMEOUT_SECONDS` (NEW constant, distinct from cooldown), refund via
`world.remove_proposal(...)` semantics (keep `pending_proposals` and
`pending_proposal_targets` in sync) with **no `await` between read and removal**, then
publish a refund event. `run_world_tick(..., *, interval)` is the integration-only driver.

### 4.8 Event log (`observability/event_log.py`)
`class EventLog(Protocol): def record(self, event: Event) -> None`; `JsonlEventLog(path)`
(append-only JSONL — the replay record) and `InMemoryEventLog` (tests). `EventBus` takes
an optional `event_log` and `record`s every published event at a single capture point.
Add `EventBus.unsubscribe(agent_id)` for clean agent shutdown.

## 5. Energy economy wiring (the homeostasis dials kept for S4)
| Rule | Change | Where |
|------|--------|-------|
| **Move costs energy** | validate existence+adjacency+sufficient energy FIRST; deduct `MOVE_ENERGY_COST` only after `move_agent` succeeds; `Invalid:`/no-charge on failure | `tools/builtin/movement.py` |
| **Paralysis / revival** | `modify_agent_energy` per DD4 (≤ threshold incl. 0.0 → PARALYZED; > threshold from PARALYZED → ALIVE; DEAD early-return) | `world/world.py` |
| **Region caps** | `modify_region_energy/materials` cap at `max_*` (and floor 0) | `world/world.py` |
| **Pre-attack low-energy** | NO special-case in the loop; `attack` already returns `Invalid:` when energy < cost — its own result string is the feedback (uniform dispatch preserved) | (already in `combat.py`) |

Speak already costs energy. The move-drain + speak-drain vs. harvest-gain IS the
single-agent homeostasis loop.

## 6. Determinism & testing
Loop tests inject `MockDecider` (scripted `Decision`s) + the seeded `world`/`fake_clock`
fixtures; **`pace=0`**; no unit test touches Ollama, wall-clock, or global random. The
`world` fixture is refactored to accept the shared `fake_clock` so timeout tests have a
typed `FakeClock` handle. A `populated_registry` fixture calls `register_builtins`. Add
`agents` + `observability` to coverage source; `# pragma: no cover` the `OllamaDecider`
network body so the ≥90% gate stays green; remove `agents.*` from the mypy ignore
(`tests.integration.*` stays ignored). `§9.7` smoke sets `pytestmark =
pytest.mark.integration`.

## 7. Foundation tests to UPDATE (smaller now, post-descope)
- `tests/world/world_test.py`: extend paralysis to the band (energy 3.0, 5.0 →
  PARALYZED; 5.01 → ALIVE; revival from PARALYZED only > threshold); add DEAD-terminal
  guard (`update_agent_status(DEAD)` then `modify_agent_energy(+big)` → stays DEAD);
  change `modify_region_*` "does not cap" → now caps.
- `tests/tools/movement_test.py`: "move charges no energy" → now charges; failed move →
  no charge.
- Review `tests/tools/communication_test.py` & `resources_test.py` for agents driven
  into the paralysis band by the new rule; adjust assertions if status now flips.
- (NO mating-test changes — enforcement descoped to S6.)

## 8. Out of scope (YAGNI)
Death + mating enforcement + dead-agent lifecycle (Sprint 6); memory/RAG (Sprint 5);
multi-agent runner + `scripts/run.py` (Sprint 6); dashboard; orchestrator/council;
identity self-reflection; economy *tuning*.

## 9. Acceptance Test Suite — THE FINISH CONDITION
Done when all unit tests below pass (deterministic, no live LLM) and §9.7 runs by hand.

**9.1 Loop mechanics (MockDecider, pace=0, populated_registry)**
- `breathe()` with a scripted `look_around` → appends a `user` perception, an
  `assistant`, and an id-paired `tool` result; `breath_count == 1`.
- `run(max_breaths=5)` → exactly 5 breaths then exits; no real sleep.
- `Decision` with empty `tool_calls` (plain text) → breath completes, no crash.
- Unknown tool name → caught, fed back as `tool` msg, loop continues.
- A `decide()` that raises → `lifecycle_history` stays well-formed (no double `user`).
- A 2-tool `Decision` → correctly id-paired assistant/tool turns.

**9.2 Perception** — after another agent publishes a LOCAL `speak` in-region, the next
`perceive()` includes it and drains the inbox; perception contains own
energy/materials/position/status and region occupants/connections.

**9.3 Status (paralysis only; death is S6)**
- Drain to exactly 0.0 via `modify_agent_energy` → `PARALYZED` (never DEAD).
- energy 3.0 and 5.0 → `PARALYZED`; 5.01 → `ALIVE`.
- Revive from `PARALYZED` only when fed > threshold.
- `modify_agent_energy` on a `DEAD` agent (set manually) → stays `DEAD` (no resurrection).
- A paralyzed agent's `breathe()` perceives but does NOT decide/execute; `run()` stops;
  an `agent_paralyzed` event is emitted/recorded.

**9.4 Energy economy**
- `move` deducts `MOVE_ENERGY_COST` on success; non-adjacent/insufficient → `Invalid:`,
  energy unchanged, position unchanged.
- `modify_region_energy/materials` cap at `max_*`; agent mutators do NOT cap (floor 0 only).

**9.5 World-tick** — one `tick()` regenerates region resources (capped) by rates; a
`pending_proposal` older than `MATING_PROPOSAL_TIMEOUT_SECONDS` is refunded + removed
(both maps synced), a fresh one left intact; interleaving a `reject` with a `tick` on the
same proposal yields exactly one refund and no exception (snapshot-then-mutate).

**9.6 Event log & schemas**
- Every event published on the bus is `record`ed by the `InMemoryEventLog` in order.
- `set(tool_schemas) == set(BUILTIN_TOOLS)` (parity).
- `EventBus.unsubscribe` removes the inbox; subsequent publishes don't target it.

**9.7 Live integration smoke (`@pytest.mark.integration`, by hand)** — with Ollama up, a
single real agent `run(max_breaths=20)` against the real world **sustains homeostasis
(never paralyzes)**, makes ≥1 valid tool call, mutates the world (position/resources),
and produces a non-empty event log.

## 10. Build plan (after sign-off, TDD, orchestrated by dependency order)
Tests-first per §9, implement until green, gate+commit per phase:
- **P1** scaffolding: `agents/decider.py` (+`Decision`/`ToolCall`), `agents/prompt.py`,
  `agents/tool_schemas.py` (+parity), `observability/event_log.py`, conftest alignment
  (`MockDecider`→async/`Decision`, `populated_registry`, `world`+`fake_clock`).
- **P2** world/tools rules: paralysis/revival + DEAD guard + region caps (update §7
  tests), move-cost, `EventBus` event-log sink + `unsubscribe`, `world/tick.py`,
  `MATING_PROPOSAL_TIMEOUT_SECONDS`.
- **P3** the loop: `perceive/decide/execute/refresh_status/breathe/run` against real
  infra + `MockDecider`; history integrity; `OllamaDecider`.
- **P4** integration smoke + full gate (ruff/mypy/coverage/CI) + finish branch.
