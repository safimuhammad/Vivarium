# Sprint 7 — Offspring-breathing spawn-watcher (design)

> Status: drafted autonomously (autonomous build loop); reviewer-gated in lieu of a live
> Safi design conversation. The feature *completes* already-designed functionality
> (reproduction as the counterweight to combat death, Sprint 6 spec §3.3/§8); it does not
> introduce a new simulation mechanic.

## 1. Problem & Goal

`accept_mating` already spawns an offspring `AgentState` into the world via
`world.add_agent`, but `run_simulation` builds its breathing `run()` tasks **once** at start
from `get_all_agents()`. So a newborn is an inert, ALIVE-status entity that never
`perceive → decide → execute`. Reproduction is the spec's named counterweight to lethal
combat; without breathing offspring the integrated world can only shrink → heat-death, which
violates the run-forever north star (CLAUDE.md §1).

**Goal:** when a new agent appears in the world during a run, it automatically begins
breathing — built like any other agent, subscribed to the bus, driven by a `run()` task,
tracked by the shutdown path, and counted by the liveness watchers — so a lineage can carry
the world forward indefinitely.

## 2. Scope

**In:**
- A **spawn-watcher** background task in `run_simulation` that detects new agents and launches
  their breathing loops.
- An **agent factory** (`spawn_agent`) on the `Simulation` bundle so an offspring is built
  with the same registry / serialized decider / per-agent memory wiring as the initial agents.
- A **termination-model adjustment** so (a) offspring keep the run alive (the run does not end
  just because the *initial* agents died) and (b) the run still ends correctly when the whole
  breathing set is truly collapsed.
- Dynamic offspring tasks folded into the **single shutdown path** (cancel + unsubscribe).

**Out / deferred:**
- LLM-based persona infusion for offspring (still the concatenated-parents persona — separate).
- Mating minimums / cooldown / max-offspring enforcement (existing named debt; an F4 tuning
  signal, not this change).
- Cross-restart persistence (Sprint 7 separately; this is in-process only).

## 3. Design

### 3.1 Detection — poll, not event
The watcher polls `world.get_all_agents()` every `world_tick_interval` seconds, diffing ids
against a `known: set[str]` seeded with the initial agents' ids. Any id not in `known` is a
newborn.

*Why poll, not subscribe to `agent_born`:* the EventBus delivers into per-agent inboxes; the
runner is not an agent with an inbox, so consuming `agent_born` would require a bus change.
Polling `get_all_agents()` is O(N) over a handful of agents, needs no bus change, and matches
the existing world-tick / collapse-watch polling pattern. The world is the source of truth.

### 3.2 The agent factory
`build_simulation` currently builds each initial agent inline (FileMemoryStore + vector store +
`Agent(...)`). Extract that into a closure stored on the `Simulation` bundle:

```python
spawn_agent: Callable[[AgentState], Agent]
```

It captures `world`, `bus`, `registry`, the shared serialized `decider`, `memory_root`, and
the `vector_store_factory`, and builds an `Agent(state.id, world, bus, registry, decider,
pace=0.0, memory=FileMemoryStore(...))` — identical to the initial-agent construction (so
there is exactly one place that knows how to wire an agent). `Agent.__init__` subscribes it to
the bus, so the factory never subscribes separately. The initial-agent loop in
`build_simulation` is refactored to call this same factory (DRY).

### 3.3 Launch + tracking
On finding a newborn id, the watcher (no `await` between the read and the appends, so the
mutations are atomic w.r.t. other cooperatively-scheduled tasks):
1. builds the agent via `spawn_agent(state)` (subscribes it),
2. appends it to `sim.agents` (so the breathing set / liveness watch see it),
3. creates `asyncio.create_task(run_agent(agent), name=f"agent:{id}")` and appends the task to
   the **shared, growing** `agent_tasks` list,
4. adds the id to `known`.

`run_agent` is the existing wrapper that unsubscribes the agent's inbox in its `finally`.

`sim.agents` is read by liveness counting and the shutdown unsubscribe loop; both iterate it
with no `await` inside the loop, so a concurrent append cannot corrupt an in-flight iteration
(cooperative scheduling). To be safe the watcher appends as a single statement.

### 3.4 Termination model (the real design point)
Today two mechanisms end a run (besides `--duration` / signal):
- `_watch_agents_done`: `await gather(*agent_tasks)` on the **fixed** initial list → stop when
  all initial agents' tasks finish.
- `_collapse_watch`: `_count_alive(world, sim.agents) == 0` for `COLLAPSE_ZERO_ALIVE_TICKS`.

With dynamic offspring, `_watch_agents_done` on the *initial* list is **wrong**: all initial
agents could die while offspring breathe on — gathering the fixed list would set `stop`
prematurely and kill a living lineage. The chosen fix **replaces `_watch_agents_done` with a
poll-based liveness watch over the breathing set** (and folds the collapse logic in):

`_liveness_watch(world, sim.agents, stop, *, interval)` polls every `interval`:
- Let `present` = agents in `sim.agents` that still exist in the world and are not DEAD
  (i.e. ALIVE or PARALYZED). If `present == 0` → **all real agents are dead/gone → stop
  immediately** (the world has genuinely ended; this is the old all-dead path, now over the
  dynamic set).
- Else let `alive = _count_alive(world, sim.agents)` (ALIVE only). If `alive == 0` for
  `COLLAPSE_ZERO_ALIVE_TICKS` consecutive polls → **collapsed (all paralyzed, none can be
  fed) → stop** (the old collapse path).

This is a single poller that (a) lets offspring keep the run alive — a world with even one
ALIVE/feedable agent continues — and (b) still terminates a dead or wedged world. It removes
the fixed-list `gather` entirely, so dynamic tasks are handled uniformly. (`run_forever`
intent: a lineage that keeps producing live agents runs indefinitely, exactly as the art-piece
wants — generations carrying the world forward.)

> Reviewer question to confirm: is "the run continues as long as any agent is ALIVE or
> revivable" the right run-forever semantics? Per CLAUDE.md §1 (a world that neither collapses
> nor explodes, run indefinitely) the answer is yes — the run should outlive any individual.

### 3.5 Shutdown path
The spawn-watcher is a background task; the existing `finally` already cancels
`(*agent_tasks, *background_tasks)` and unsubscribes `sim.agents`. For dynamic correctness:
- The watcher checks `stop.is_set()` at the top of each poll and **does not spawn during
  teardown**.
- The `finally` cancels the spawn-watcher; then cancels every task in the (now-final)
  `agent_tasks` list (which includes offspring); then unsubscribes every agent in
  `sim.agents` (includes offspring). Because the watcher appends to these same shared
  collections before `stop`, the `finally` sees all spawned tasks/agents.
- Order: set `stop` → cancel the spawn-watcher first (so no new task is created mid-teardown)
  → cancel agent + remaining background tasks → `gather(..., return_exceptions=True)` →
  unsubscribe all `sim.agents`. (One cancel per task; no double-cancel.)

## 4. Components & files
- `scripts/run.py`:
  - `Simulation` gains `spawn_agent: Callable[[AgentState], Agent]`.
  - `build_simulation`: extract per-agent construction into the factory; build initial agents
    through it.
  - new `_spawn_watch(world, sim, run_agent, agent_tasks, known, stop, *, interval)`.
  - replace `_watch_agents_done` with `_liveness_watch` (poll-based, over `sim.agents`).
  - `run_simulation`: seed `known`, start the spawn-watch + liveness-watch, fold offspring
    tasks into the shutdown.
- No changes to `world/`, `bus/`, `tools/` (offspring are ordinary agents; `accept_mating`
  already emits `agent_born`).

## 5. Testing (TDD, deterministic, no live model)
- **Offspring breathes:** build a sim; mid-run inject a new agent via `world.add_agent` (or
  drive `accept_mating`); assert within a few ticks the newborn has `breath_count > 0` and is
  subscribed (`id in bus.agent_queues`).
- **Run survives initial-agent death via a living offspring:** kill all initial agents but add
  one ALIVE offspring that breathes; assert the run does NOT stop early (continues to a short
  `--duration`), proving offspring keep it alive.
- **Truly-dead world still stops fast:** all agents (initial + any offspring) DEAD → liveness
  watch stops immediately (well under `--duration`).
- **All-paralyzed still collapses:** existing collapse semantics preserved over the dynamic set
  (the Sprint 6 inert-offspring test still passes — inert offspring are ALIVE so they keep it
  alive only if they actually breathe; pure inert injection without the watcher is no longer a
  case, since the watcher now makes them breathe).
- **Shutdown unsubscribes offspring:** after a run with a spawned offspring, its inbox is freed.
- **Factory parity:** an offspring built by the factory has the same memory wiring (a recall
  tool offered, etc.) as an initial agent.
- All existing `run_test.py` tests keep passing (the collapse-watch test is re-expressed: the
  watcher now breathes injected agents, so the "inert offspring" scenario is replaced by a
  "dead world stops" / "offspring keeps alive" pair).

## 6. Gates (must reproduce CI exactly before merge)
`ruff check .`, `ruff format --check .`,
`mypy core tests world bus tools config agents observability`,
`pytest --cov=... --cov-fail-under=90`. Then push, watch CI green, merge, confirm main green.

## 7. Risks
- **Race at teardown** (watcher spawns during shutdown): mitigated by the `stop.is_set()`
  check + cancelling the watcher first.
- **List mutation during iteration**: mitigated — all readers iterate without `await` inside
  the loop (cooperative scheduling makes the append atomic w.r.t. them).
- **Unbounded population (explosion)**: out of scope here, but note it — mating minimums /
  max-offspring (existing debt) are the explosion guard; the spawn-watcher itself adds no cap.
  Flag for F4 tuning so the world neither collapses nor explodes.
