# Sprint 6 — Integration & Multi-Agent: Design Spec

> Status: approved design (Safi-gated death decision resolved; reviewer-grounded).
> Date: 2026-06-29. Supersedes the forward-looking "persistence/death/cleanup" note in
> the rolling checkpoint — the canonical Sprint 6 is SPRINTS.md F1–F4.

## 1. Problem & Goal

Everything for a multi-agent run exists in isolation (breathing loop, world, tools,
bus, memory, world-tick) but nothing ties them together. Sprint 6 is **integration**:
press play and watch 4–5 agents live concurrently through the shared world, observably,
for 30+ minutes, without the world collapsing (mass paralysis/extinction) or exploding
(runaway population/resources). This is the vision's "set initial conditions, press
play, perceive" milestone (CLAUDE.md §1).

**Success (SPRINTS.md F1–F4):** 4–5 agents run concurrently for 30+ minutes through the
shared world; their activity is observable live in the terminal; at least one emergent
behavior is observed; the run is reproducible from a seed and replayable from a log.

## 2. Scope

**In:**
- **F1** — `scripts/run.py`: the entry point that assembles the world and runs everything.
- **F2** — `SerializingDecider`: serialize the single Ollama across agents.
- **F3** — `observability/activity_feed.py`: a live `rich` terminal activity feed.
- **F4** — the 30-min run: observe, fix crashes, tune world-rule constants.
- **Stability** — the paralysis-loop fix (the collapse bug), the death mechanic
  (Safi-decided model), EventBus orphaned-queue cleanup, graceful shutdown.
- **Revisit List** — speak paralysis guard; low-energy warning before attack.
- **Tooling** — `pyproject.toml` migration (ruff, mypy, pre-commit, pytest discovery),
  per CLAUDE.md §4/§8 ("arrives with Sprint 6 / the tooling upgrade").

**Deferred (named debt, not silent):**
- **Offspring-breathing spawn-watcher — Sprint 7, run-forever #1 (added post-review).**
  `accept_mating` adds an offspring to the world, but `run_simulation` builds the breathing
  tasks once at start, so newborns never breathe — they are inert ALIVE entities. Reproduction
  is the spec's counterweight to lethal combat (§3.3/§8); without breathing offspring the
  integrated world can only shrink → heat-death. Building a dynamic spawn-watcher is net-new
  functionality and gets its own review-heavy spec→plan→review cycle. Interim: the collapse-watch
  reasons about the *breathing set* only, so inert offspring cannot mask a collapse or hang an
  all-paralyzed run.
- Enforcing `MATING_MIN_ENERGY_CONTRIBUTION` / `MATING_MIN_MATERIALS_CONTRIBUTION` — wait
  for an F4 tuning signal (cheap reproduction must balance the lethal death model).
- Cross-restart **state persistence** (WorldState save/restore) — Sprint 7. This is a
  first-class run-forever requirement in CLAUDE.md §1; the JSONL log is replay/research
  data, **not** state restore. Recorded here as known debt.
- Web dashboard — out of scope (terminal feed only).
- God / council orchestrator — deferred & Safi-gated (do not build).

## 3. The energy / paralysis / death model (the run-forever crux)

This is the heart of the sprint. The locked design doc says: *"Starvation: depleting
energy = paralysis (can't act), not death. Can be fed by others."* The current code has
a collapse bug: `refresh_status()` sets `_stopped = True` on ALIVE→PARALYZED, and
`_can_continue()` returns False when `not self.alive`, so a paralyzed agent's loop ends
**permanently** and can never be revived even after another agent feeds it. In a
multi-agent run agents would drop out one by one → collapse.

### 3.1 Paralysis (recoverable, not terminal)
- Energy floors at 0.0 (never negative from action costs). At `energy <= 5.0` an ALIVE
  agent becomes PARALYZED (existing `WorldState.modify_agent_energy` logic — unchanged).
- A PARALYZED agent **keeps its loop alive** (so it can be revived by others) but a
  paralyzed breath does **nothing but drain its inbox** — no perceive-append, no decide,
  no execute, no compaction. Draining (`event_bus.get_events(agent_id)`, discarded) keeps
  the queue bounded; freezing the history avoids both unbounded perception growth and the
  illegal *consecutive user turns* that perceiving-without-deciding would create; and it
  spends **zero Ollama** on a frozen agent (so it can't starve the alive ones). On revival
  the next breath sees `previous_status is ALIVE` and perceives fresh, resuming cleanly
  (the prior turn was a `tool` turn, so the new perception user turn is legal).
- Recovery is **only** by another agent feeding it via `transfer_resource` →
  `modify_agent_energy(+amount)` → revives to ALIVE at `energy > 5.0` (existing logic).
- **Loop fix (three changes):**
  1. `refresh_status()`: on ALIVE→PARALYZED, still emit `agent_paralyzed` but do **not**
     set `_stopped = True`; only DEAD is terminal.
  2. `_can_continue()`: terminate on `self._status() is AgentStatus.DEAD` (not `not self.alive`).
  3. `breathe()`: restructure so the ALIVE branch does the full path (perceive →
     `_ensure_context_budget` → decide → execute → reflect); a non-ALIVE breath only
     drains the inbox. `_ensure_context_budget`/`compact` therefore run **only** for ALIVE
     agents (a frozen agent's history doesn't grow, so it needs no budget check).
- **`agent_recovered` event:** when a feeding `transfer_resource` lifts a target
  PARALYZED→ALIVE, emit a LOCAL `agent_recovered` event so nearby agents perceive the
  revival (perception is the product). `source = feeder_id` (the agent calling
  `transfer_resource`), consistent with the existing `resource_transferred` event in that
  same tool; co-location is already enforced by the tool's same-region check, so LOCAL
  routing lands correctly. Implemented in `tools/builtin/resources.py` (see §5): capture
  the target's status before/after the energy credit and emit only on the flip.

### 3.2 Death (Safi-decided: "Both")
Death is a **combat-only** outcome (starvation never kills). On resolving an `attack` on
a target:
- If the target is **already PARALYZED** when hit → **DEAD** (finishing blow); OR
- If the hit **overshoots below the kill threshold**: `target.energy − ATTACK_DAMAGE <
  KILL_ENERGY_THRESHOLD` (i.e. `< 0.0`) → **DEAD**;
- Otherwise apply damage normally via `modify_agent_energy(-ATTACK_DAMAGE)` (which may
  paralyze if the result lands `<= 5.0`).
- Death is written in **one place**: a new `WorldState.kill_agent(agent_id)` setter the
  attack tool calls; `modify_agent_energy`'s existing DEAD-guard (early-return) is the
  backstop. The attack tool emits an `agent_died` **GLOBAL** event (the whole world feels
  a death). The DEAD `AgentState` is **retained** as a record (corpse), not removed from
  `world.agents`.
- **Escrow cleanup on death (`kill_agent` also does this, synchronously):** sweep
  `pending_proposals` for the dying agent so escrow is not silently lost to the DEAD-guard.
  For a proposal where the dead agent is the **initiator**, remove it and abandon the
  escrowed resources (they die with the agent — they are not refunded to a corpse). For a
  proposal where the dead agent is the **target**, remove it and refund the (still-live)
  initiator's escrow immediately via `modify_agent_energy`/`modify_agent_materials`, rather
  than waiting for the world-tick timeout sweep. These are sync state corrections; no
  per-refund event is emitted (the `agent_died` GLOBAL event already narrates the death).
- Consequence: with `ATTACK_DAMAGE = 30`, any target under ~30 energy dies to a hit, and
  any paralyzed agent attacked dies. This is intentionally lethal (Safi's choice); F4
  tunes regen/cost/damage if it collapses.

### 3.3 Why this can't collapse from starvation
Regions self-heal (`regenerate_resources` each world-tick); an ALIVE agent sustains by
harvesting; a fallen agent is paralyzed (not dead) and can be fed back. Death requires an
*attacker*, so the world cannot heat-death purely from starvation. Population turnover
comes from combat death balanced by (cheap, unminimumed) reproduction — tuned in F4.

## 4. Architecture

```
scripts/run.py  (F1)
  load_config(world.yaml, seed) -> WorldState (seeded RNG + injected clock)
  EventBus(world, event_log = CompositeEventLog[JsonlEventLog(runs/run_<ts>.jsonl), FeedEventLog])
  ToolRegistry + register_builtins
  decider = SerializingDecider(OllamaDecider(model))          # F2 — one shared instance
  agents  = [ Agent(id, world, bus, registry, decider, pace, memory=FileMemoryStore(id,...)) ... ]
  for a in agents: bus.subscribe(a.id)
  tasks = gather(
      *[ run_agent(a) for a in agents ],     # each agent.run(); on exit, bus.unsubscribe(a.id)
      run_world_tick(world, bus, interval),  # existing driver: regen + mating-timeout sweep
      run_activity_feed(feed_log, world),    # F3 — rich.Live renderer
  )
  graceful shutdown on SIGINT: cancel tasks, drain/flush logs, render final summary
```

All agents share one `world`, one `bus`, one `decider`. The world-tick and feed are
independent asyncio tasks. `--duration` bounds the run with an `asyncio.timeout` (or a
sentinel task that cancels the gather). **Shutdown is one path:** SIGINT, `--duration`
expiry, and the all-paralyzed/all-dead collapse check all funnel through the same
`finally` cleanup (cancel tasks, unsubscribe agents, drain/flush logs, render the final
summary) so teardown is identical however the run ends.

### 4.1 F2 — `SerializingDecider` (agents/decider.py)
A decorator implementing the `Decider` protocol, wrapping an inner decider with a shared
`asyncio.Lock`:
```python
class SerializingDecider:
    def __init__(self, inner: Decider, lock: asyncio.Lock | None = None) -> None:
        self._inner = inner
        self._lock = lock or asyncio.Lock()
    async def decide(self, messages, tools) -> Decision:
        async with self._lock:               # one agent thinks at a time; releases on cancel/timeout
            return await self._inner.decide(messages, tools)
```
- `async with` is mandatory (a manual acquire/release leaks the lock on timeout/cancel →
  global deadlock). The lock is created on the running loop (lazily in `__init__` is fine
  since the runner constructs it inside `asyncio.run`).
- Does **not** undermine temporal asymmetry: `pace` governs inter-breath sleep, not think
  time; a fast-pace agent simply queues for the lock more often and still gets more turns
  over a long run.

### 4.2 F3 — activity feed (observability/)
- **`FeedEventLog`** (observability/event_log.py): an `EventLog` with an in-memory ring
  buffer + a monotonic counter so a renderer can poll only new events. Bounded (drop
  oldest) so a 30-min run can't grow it unbounded. **Cursor contract:** the renderer polls
  deltas by the monotonic count; if the buffer overflowed since the last poll the renderer
  simply resumes from the oldest retained event and may miss dropped events — acceptable
  for a live view (the JSONL log is the complete record).
- **`CompositeEventLog`** (observability/event_log.py): an `EventLog` that fans `record()`
  out to several logs (here: `JsonlEventLog` for replay + `FeedEventLog` for the live
  view). EventBus already takes a single `event_log`; the composite needs **no bus
  change**.
- **`activity_feed.py`**: `run_activity_feed(feed_log, world, console)` drives a
  `rich.Live` with two panels — (1) a scrolling, human-readable event stream
  (`render_event(event) -> str`, e.g. `"wanderer_001 harvested 12 energy in warm_springs"`),
  (2) a compact world table (per-agent status/energy/materials/position; per-region
  resources). Refresh capped at every 2–5s to avoid CPU pressure; observer only, never
  mutates the world.
- **Terminal coordination:** one `rich.Console(stderr=True)`; `rich.Live(console=...)` and
  `logging` via `rich.logging.RichHandler(console=...)` share it so log lines and the
  live view don't garble each other. Configured in `core/logging.py` / the runner.

### 4.3 EventBus cleanup
When an agent's `run()` task exits (DEAD or stopped), the runner calls
`bus.unsubscribe(agent_id)` to free the orphaned inbox queue. Done **after** the task
ends (not mid-breath) so no in-flight delivery is dropped. EventBus already skips
unsubscribed agents on publish.

### 4.4 Revisit List
- **(a) speak paralysis guard:** in `execute()`, if the agent becomes PARALYZED partway
  through a multi-tool breath, abort the remaining queued tool calls (don't let a
  paralyzed agent keep acting that breath). `speak` itself returns an `Invalid:` string if
  invoked while not ALIVE.
- **(b) low-energy attack warning:** in perception rendering, when the agent's energy is
  below `ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD`, inject a warning so the model
  can decide knowingly (e.g. `"⚠️ Your energy is 8.0; attacking costs 10.0 — you would be
  paralyzed."`).
- (c) mating-proposal timeout sweep — already implemented (world/tick.py); no change.

### 4.5 Tooling migration
`pyproject.toml` becomes the single source of project config: runtime vs dev deps,
`ruff` (lint+format), `mypy`/strict, `pytest` with `python_files = *_test.py` and the
`integration` marker, coverage config, and a `pre-commit` config running lint+type+fast
tests. Migrate off bare `requirements.txt` (keep a thin one or generate from the project
deps). `rich` becomes a declared runtime dependency.

## 5. Components & files

| File | Responsibility |
|--|--|
| `scripts/run.py` (new) | F1 assembly + lifecycle + CLI (`--model --seed --pace --duration --config --out`) + graceful shutdown; an internal `run_agent(agent)` wrapper that awaits `agent.run()` then `bus.unsubscribe(agent.id)` in a `finally` |
| `agents/decider.py` (edit) | add `SerializingDecider` |
| `agents/runtime.py` (edit) | paralysis-loop fix (`refresh_status`, `_can_continue`); compaction gate on ALIVE; (b) low-energy attack warning in perception; (a) abort remaining tool calls when paralyzed mid-breath |
| `world/world.py` (edit) | `kill_agent(agent_id)` setter; emit/signal `agent_recovered` on PARALYZED→ALIVE (event emission may live in the caller/tool to keep mutations sync — see note) |
| `tools/builtin/combat.py` (edit) | death resolution ("Both" model) + `agent_died` GLOBAL event |
| `tools/builtin/resources.py` (edit) | in `transfer_resource`, after `modify_agent_energy(receiver, +qty)` capture receiver status before/after; on PARALYZED→ALIVE flip publish `agent_recovered` LOCAL (source=feeder) |
| `tools/builtin/communication.py` (edit) | speak paralysis guard |
| `observability/event_log.py` (edit) | `FeedEventLog`, `CompositeEventLog` |
| `observability/activity_feed.py` (new) | `render_event`, `run_activity_feed`, world-table render |
| `core/logging.py` (edit) | rich `Console(stderr=True)` + `RichHandler` wiring |
| `pyproject.toml` (new) | tooling + deps migration |

**Note on `agent_recovered` / `agent_died` and the sync/async split:** `WorldState`
mutations are sync; events are published async via the bus. Keep state mutation sync and
emit the event from the async caller (the tool or the runner) right after the mutation,
mirroring how existing tools mutate-then-publish. `kill_agent` sets status; the attack
tool publishes `agent_died`. For `agent_recovered`, the feeding tool (`transfer_resource`)
checks whether the target's status flipped to ALIVE and publishes the LOCAL event.

## 6. Testing (TDD; deterministic, no live model)

- **Paralysis-loop fix:** an agent driven to PARALYZED keeps `_can_continue()` True;
  feeding it (energy > 5) returns it to action; a DEAD agent stops. Mocked decider,
  seeded RNG.
- **Death model ("Both"):** attack on a PARALYZED target → DEAD + `agent_died`; attack
  overshooting below 0 → DEAD; attack landing in **[0,5]** → PARALYZED (include the exact
  boundary: pre-hit energy 30.0 → post-hit 0.0, since `30.0 − 30.0 = 0.0` is NOT `< 0.0`,
  so it survives as PARALYZED, *not* DEAD); attack landing > 5 → ALIVE. Assert single death
  writer + DEAD-guard backstop.
- **Escrow cleanup on death:** killing a proposal **initiator** removes the proposal and
  abandons its escrow (no refund to the corpse); killing a proposal **target** removes the
  proposal and refunds the live initiator immediately (energy + materials credited back).
- **`agent_recovered`:** `transfer_resource` lifting a PARALYZED receiver above 5.0 → one
  `agent_recovered` LOCAL event (source = feeder) to the region; a transfer that leaves the
  receiver PARALYZED → no event; a transfer to an already-ALIVE receiver → no event.
- **SerializingDecider:** two concurrent `decide()` calls never overlap (instrument the
  inner with an in-flight counter); lock releases on inner exception/timeout (no
  deadlock).
- **EventBus cleanup:** unsubscribe after run frees the queue; publishes post-death are
  skipped.
- **FeedEventLog / CompositeEventLog:** composite fans out to all sinks; feed offset
  cursor yields only-new events; ring buffer bounds size.
- **Revisit items:** speak while paralyzed → `Invalid:`; low-energy perception contains
  the warning; paralyzed mid-breath aborts remaining tool calls.
- **Runner smoke (mocked decider):** assemble world + N agents + tick + feed, run a few
  breaths, assert no crash, agents act, feed records events, shutdown cancels cleanly.
- **Live (F4, `@pytest.mark.integration`, excluded from CI fast run):** real qwen3,
  4–5 agents, short bounded run; plus the full 30-min observation run by hand.

Target ≥90% coverage on new/changed core logic. All RNG seeded; clock injectable.

## 7. F4 — the run & tuning protocol
1. Short bounded live run (e.g. 5 min) to shake out crashes and Ollama-serialization
   behavior.
2. Full 30-min run; observe the activity feed; capture the JSONL replay.
3. If the world collapses (mass death/paralysis) or explodes (runaway pop/resources),
   tune the world-rule constants in `core/constants.py` (regen rates, action/attack
   costs/damage, pace) — the Game-of-Life dials — and re-run. Record before/after.
4. Note at least one emergent behavior (an alliance, a feeding, a feud, a migration).

## 8. Risks
- **Lethality (Safi's "Both") may cause fast collapse** with 4–5 agents — mitigated by
  cheap reproduction (no mating minimums) + F4 tuning; the death model itself is a tuned
  dial, not fixed.
- **All-agents-paralyzed deadlock:** if every agent is PARALYZED simultaneously (a combat
  wave) with no ALIVE agent left to feed anyone, the loops keep perceiving but nothing can
  progress — an infinite perceive-only spin. Mitigation: the runner tracks consecutive
  world-ticks with zero ALIVE agents and, after a threshold (e.g. 3 ticks), logs a WARNING
  and shuts down cleanly (the ecology has collapsed — an observable outcome, not a hang).
  `--duration` is also always set as a backstop. (A fully-DEAD world ends naturally: every
  `run()` exits on DEAD.)
- **Ollama throughput:** serialization means N agents share one model; per-agent breath
  cadence slows with N. Acceptable for 4–5; `pace` and N are tuning knobs.
- **rich + logging garble:** mitigated by the shared stderr console + RichHandler.
- **Feed performance:** capped refresh + bounded ring buffer.
