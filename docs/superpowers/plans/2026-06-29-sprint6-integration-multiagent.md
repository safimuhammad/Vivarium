# Sprint 6 — Integration & Multi-Agent: Implementation Plan

> **For agentic workers:** Implement task-by-task with TDD (write the failing test, make
> it pass, refactor, commit). Steps use `- [ ]` checkboxes. Spec:
> `docs/superpowers/specs/2026-06-29-sprint6-integration-multiagent-design.md`.

**Goal:** Wire the existing subsystems into a runnable multi-agent simulation: a CLI
entry point that spawns 4–5 agents breathing concurrently over one serialized Ollama,
with a live `rich` terminal activity feed, fixed so the world can't collapse from
paralysis, with a combat death mechanic, EventBus cleanup, and graceful shutdown — then
a 30-min run with emergent behavior.

**Architecture:** Event-driven; agents act only through tools → WorldState mutation +
EventBus. One shared `WorldState`/`EventBus`/`SerializingDecider`. The runner gathers
each `agent.run()`, the `run_world_tick` driver, and the activity-feed renderer, with a
single shutdown path.

**Tech Stack:** Python 3.13, asyncio, `rich` (new runtime dep), pytest + pytest-asyncio,
mypy --strict, ruff, Ollama/qwen3 (live only).

## Global Constraints (apply to every task)
- Strict typing (`mypy --strict` clean on `agents/ core/ world/ bus/ tools/ observability/
  config/ scripts/`); modern syntax (`X | None`, `list[X]`). Google docstrings on every
  public surface, documenting world-state mutated + events emitted.
- No `print()` in library code (stdlib `logging` via `core.logging.get_logger(__name__)`);
  `bench/` and `scripts/` may render via `rich`.
- All randomness through the injected `world.rng`; timestamps via `world.now()`. Tests are
  deterministic: mocked decider, seeded RNG, no live model (live tests are
  `@pytest.mark.integration`, excluded from the fast run).
- Tool signature convention is fixed: `async def tool(world, event_bus, agent_id, **params) -> str`,
  returning a natural-language string (`"Error: …"` / `"Invalid: …"` / success sentence).
- Tool results are perception strings — keep them rich; never convert to exceptions/bools.
- Test files are named `*_test.py`. Run the fast suite with `python -m pytest -q -m "not integration"`.
- Constants live in `core/constants.py`; import, don't inline magic numbers.

## Shared interfaces produced this sprint (contracts for parallel tasks)
- `WorldState.kill_agent(agent_id: str) -> bool` (T2): set DEAD + sweep the agent's pending
  proposals (abandon escrow if initiator; refund the live initiator if the dead agent was a
  target). Returns `True` if the agent existed.
- Event `"agent_died"`: `scope=GLOBAL`, `source=victim_id`, `payload={"message": ...,
  "killer": attacker_id}`, `timestamp=world.now()` (emitted by `attack`, T3).
- Event `"agent_recovered"`: `scope=LOCAL`, `source=feeder_id`, `target=revived_id`,
  `payload={"message": ...}`, `timestamp=world.now()` (emitted by `transfer_resource`, T4).
- `SerializingDecider(inner: Decider, lock: asyncio.Lock | None = None)` implementing
  `Decider` (T8).
- `FeedEventLog(maxlen: int = 512)` + `CompositeEventLog(*logs: EventLog)` (T6).
- `observability.activity_feed.render_event(event: Event) -> str`,
  `render_world_table(world: WorldState) -> rich.table.Table`,
  `run_activity_feed(feed, world, console, *, refresh_interval, should_stop) -> None` (T7).
- `scripts/run.py`: `build_simulation(...)`, `run_simulation(...)`, `main(argv)` (T9).

---

### Task 1 — Paralysis-loop fix (the collapse bug)

**Files:** Modify `agents/runtime.py` (`refresh_status`, `_can_continue`, `breathe`).
Test: `tests/agents/runtime_test.py`.

**Interfaces:** Consumes `AgentStatus`, `world.modify_agent_energy`, `event_bus.get_events`.
Produces the behavior: a PARALYZED agent's loop continues; only DEAD terminates; a
paralyzed breath only drains the inbox.

- [ ] **Step 1 — failing tests.** Add to `tests/agents/runtime_test.py`:
```python
async def test_paralyzed_agent_loop_continues_and_only_drains(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A PARALYZED agent keeps _can_continue True, takes no action, and drains its inbox."""
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    # Drive ADA to paralysis directly via the world (sole status writer).
    world.modify_agent_energy(ADA, -(world.get_agent(ADA).current_energy - 1.0))  # ~1 energy
    assert world.get_agent(ADA).status is AgentStatus.PARALYZED
    history_len_before = len(agent.lifecycle_history)

    # Put an event in ADA's inbox; a paralyzed breath should drain (not append) it.
    await event_bus.publish(Event("speak", BEN, {"message": "hi"}, scope=ScopeType.LOCAL,
                                  region=world.get_agent(ADA).current_position))
    await agent.breathe()

    assert agent._can_continue(None) is True            # paralysis is NOT terminal
    assert len(agent.lifecycle_history) == history_len_before  # no perceive-append
    assert event_bus.get_events(ADA) == []              # inbox was drained
    assert agent.breath_count == 1


async def test_dead_agent_loop_terminates(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.update_agent_status(ADA, AgentStatus.DEAD)
    assert agent._can_continue(None) is False


async def test_revived_agent_acts_again(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """Fed back above the threshold, a previously-paralyzed agent decides and acts."""
    decider = MockDecider([Decision(tool_calls=[ToolCall("look_around")]),
                           Decision(tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    world.modify_agent_energy(ADA, -(world.get_agent(ADA).current_energy - 1.0))
    await agent.breathe()                                # paralyzed: drains only
    world.modify_agent_energy(ADA, 50.0)                 # fed -> revives ALIVE
    await agent.breathe()                                # now acts
    assert any(m["role"] == "assistant" for m in agent.lifecycle_history)
```
- [ ] **Step 2 — run, expect FAIL** (`_can_continue` returns False when paralyzed today; paralyzed breath appends a perception). `python -m pytest tests/agents/runtime_test.py -k "paralyzed or dead_agent or revived" -q`
- [ ] **Step 3 — implement.** In `agents/runtime.py`:
  - `refresh_status`: in the ALIVE→PARALYZED branch, keep `await self._announce_paralysis(agent_state)` but remove `self._stopped = True`. Keep the `elif ... DEAD: self._stopped = True`.
  - `_can_continue`: change `if self._stopped or not self.alive:` → `if self._stopped or self._status() is AgentStatus.DEAD:`.
  - `breathe`: restructure so the full path is ALIVE-only and a non-ALIVE breath only drains:
```python
previous_status = self._status()
try:
    if previous_status is AgentStatus.ALIVE:
        await self.perceive()
        await self._ensure_context_budget(COMPACTION_TRIGGER_TOKENS)
        self._last_decide_failed = False
        decision = await self.decide()
        if decision is None:
            self._last_decide_failed = True
        else:
            self._last_prompt_tokens = decision.prompt_tokens
            await self.execute(decision.tool_calls)
            if (self.breath_count + 1) % REFLECT_EVERY_N_BREATHS == 0:
                await self.reflect()
                await self._ensure_context_budget(COMPACTION_TARGET_TOKENS)
    else:
        # Paralyzed: keep the loop alive to be revived; drain the inbox so the queue
        # stays bounded (events are missed while incapacitated). No Ollama, no append.
        self.event_bus.get_events(self.agent_id)
    await self.refresh_status(previous_status)
finally:
    self.breath_count += 1
```
  (Note: `self._last_decide_failed = False` moves inside the ALIVE branch; a paralyzed breath is not a failed decide.)
- [ ] **Step 4 — run, expect PASS.** Re-run the -k selection, then the whole runtime file.
- [ ] **Step 5 — commit.** `git add -A && git commit -m "fix(sprint6-T1): paralysis is recoverable — loop survives, only drains while frozen"`

---

### Task 2 — `WorldState.kill_agent` + escrow cleanup

**Files:** Modify `world/world.py`. Test: `tests/world/world_test.py`.

**Interfaces:** Produces `kill_agent(agent_id: str) -> bool`. Consumes `update_agent_status`,
`modify_agent_energy`/`modify_agent_materials`, `remove_proposal`, `pending_proposals`,
`pending_proposal_targets`, `ResourceTypes`.

- [ ] **Step 1 — failing tests:**
```python
def test_kill_agent_sets_dead(world: WorldState) -> None:
    assert world.kill_agent("wanderer_001") is True
    assert world.get_agent("wanderer_001").status is AgentStatus.DEAD
    assert world.kill_agent("nope") is False

def test_kill_initiator_abandons_escrow_and_removes_proposal(world: WorldState) -> None:
    world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 50.0})
    before = world.get_agent("wanderer_002").current_energy
    world.kill_agent("wanderer_001")
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert "wanderer_002" not in world.get_proposed_targets("wanderer_001")
    assert world.get_agent("wanderer_002").current_energy == before  # nobody refunded

def test_kill_target_refunds_live_initiator(world: WorldState) -> None:
    initiator = world.get_agent("wanderer_001")
    world.add_proposal("wanderer_001", "wanderer_002", {ResourceTypes.ENERGY: 50.0,
                                                        ResourceTypes.MATERIALS: 30.0})
    e0, m0 = initiator.current_energy, initiator.current_materials
    world.kill_agent("wanderer_002")  # target dies -> live initiator refunded
    assert world.get_agent_proposals("wanderer_001", "wanderer_002") == {}
    assert initiator.current_energy == e0 + 50.0
    assert initiator.current_materials == m0 + 30.0
```
- [ ] **Step 2 — run, expect FAIL** (`kill_agent` undefined). `python -m pytest tests/world/world_test.py -k kill -q`
- [ ] **Step 3 — implement** in `world/world.py`:
```python
def kill_agent(self, agent_id: str) -> bool:
    """Mark an agent DEAD and clean up its pending mating proposals.

    The sole death writer (Sprint 6). Sets status to DEAD, then sweeps proposals:
    where the dead agent is the *initiator*, the proposal is removed and its escrow is
    abandoned (not refunded to a corpse); where the dead agent is a *target*, the
    proposal is removed and the still-live initiator's escrow is refunded immediately
    (rather than waiting for the world-tick timeout sweep). Emits no event (the caller
    emits ``agent_died``).

    Args:
        agent_id: Id of the agent to kill.

    Returns:
        ``True`` if the agent existed (and is now DEAD); ``False`` otherwise.
    """
    if agent_id not in self.agents:
        return False
    self.agents[agent_id].status = AgentStatus.DEAD
    # Initiator died: drop its proposals, abandon escrow.
    for target in list(self.get_proposed_targets(agent_id)):
        self.remove_proposal(agent_id, target)
    # Target died: refund the live initiator, drop the proposal.
    for (initiator_id, target_id), proposal in list(self.pending_proposals.items()):
        if target_id != agent_id:
            continue
        for resource_type, quantity in proposal["resources"].items():
            if resource_type is ResourceTypes.ENERGY:
                self.modify_agent_energy(initiator_id, quantity)
            elif resource_type is ResourceTypes.MATERIALS:
                self.modify_agent_materials(initiator_id, quantity)
        self.remove_proposal(initiator_id, target_id)
    return True
```
  (Iterate a `list(...)` copy since `remove_proposal` mutates the dicts mid-loop.)
- [ ] **Step 4 — run, expect PASS.** Re-run; then full `tests/world/`.
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T2): WorldState.kill_agent + escrow cleanup (single death writer)"`

---

### Task 3 — Death model in `attack` (Safi's "Both")

**Files:** Modify `tools/builtin/combat.py`. Test: `tests/tools/combat_test.py`.
**Interfaces:** Consumes `world.kill_agent` (T2), `ATTACK_DAMAGE`, `KILL_ENERGY_THRESHOLD`,
`AgentStatus`. Emits `agent_died` GLOBAL.

- [ ] **Step 1 — failing tests** (cover all four outcomes incl. the 0.0 boundary):
```python
async def test_attack_kills_paralyzed_target(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_002", -96.0)  # 100 -> 4.0 => PARALYZED
    assert world.get_agent("wanderer_002").status is AgentStatus.PARALYZED
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    assert world.get_agent("wanderer_002").status is AgentStatus.DEAD
    died = [e for e in event_bus.get_events("wanderer_001") if e.type == "agent_died"]
    assert died and died[0].scope is ScopeType.GLOBAL and died[0].source == "wanderer_002"

async def test_attack_overshoot_kills(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_002", -80.0)  # 100 -> 20.0; 20 - 30 < 0 => DEAD
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    assert world.get_agent("wanderer_002").status is AgentStatus.DEAD

async def test_attack_exact_zero_paralyzes_not_kills(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_002", -70.0)  # 100 -> 30.0; 30 - 30 == 0.0, NOT < 0
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")
    t = world.get_agent("wanderer_002")
    assert t.status is AgentStatus.PARALYZED and t.current_energy == 0.0

async def test_attack_nonlethal_damages_only(world, event_bus) -> None:
    await attack(world, event_bus, "wanderer_001", target="wanderer_002")  # 100 -> 70
    assert world.get_agent("wanderer_002").status is AgentStatus.ALIVE
```
- [ ] **Step 2 — run, expect FAIL.** `python -m pytest tests/tools/combat_test.py -k "kill or overshoot or exact_zero or nonlethal" -q`
- [ ] **Step 3 — implement** in `attack`, replacing the target-damage block. After the
  existing validation and `world.modify_agent_energy(attacker, -ATTACK_ENERGY_COST)`:
```python
target_was_paralyzed = target_agent.status is AgentStatus.PARALYZED
overshoots = target_agent.current_energy - ATTACK_DAMAGE < KILL_ENERGY_THRESHOLD
if target_was_paralyzed or overshoots:
    world.kill_agent(target_agent.id)
    death_payload = {
        "message": (f"{target_agent.name} (ID:{target_agent.id}) was slain by "
                    f"{attacker_agent.name} (ID:{attacker_agent.id})."),
        "killer": attacker_agent.id,
    }
    await event_bus.publish(Event("agent_died", target_agent.id, death_payload,
                                  scope=ScopeType.GLOBAL, timestamp=world.now()))
    return (f"You struck down {target_agent.name}|ID{target_agent.id}.\n"
            f" Energy remaining: {attacker_agent.current_energy}")
world.modify_agent_energy(target_agent.id, -ATTACK_DAMAGE)
# ... existing "attack" LOCAL event + success-sentence return unchanged ...
```
  Import `KILL_ENERGY_THRESHOLD` from `core.constants`. Keep the existing already-dead guard
  at the top (`if target_agent.status is AgentStatus.DEAD: return "Invalid: ... already dead"`).
- [ ] **Step 4 — run, expect PASS.** Re-run; then full `tests/tools/combat_test.py`.
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T3): combat death — finishing-blow + overshoot ('Both'), agent_died GLOBAL"`

---

### Task 4 — `agent_recovered` on feeding (`transfer_resource`)

**Files:** Modify `tools/builtin/resources.py`. Test: `tests/tools/resources_test.py`.
**Interfaces:** Consumes `AgentStatus`. Emits `agent_recovered` LOCAL (source=feeder).

- [ ] **Step 1 — failing tests:**
```python
async def test_transfer_energy_revives_emits_agent_recovered(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_002", -96.0)  # -> PARALYZED at 4.0
    await transfer_resource(world, event_bus, "wanderer_001", target="wanderer_002",
                            resource_type=ResourceTypes.ENERGY, amount=10.0)  # 4 -> 14 > 5
    t = world.get_agent("wanderer_002")
    assert t.status is AgentStatus.ALIVE
    recovered = [e for e in event_bus.get_events("wanderer_002") if e.type == "agent_recovered"]
    assert recovered and recovered[0].scope is ScopeType.LOCAL
    assert recovered[0].source == "wanderer_001" and recovered[0].target == "wanderer_002"

async def test_transfer_not_enough_to_revive_no_event(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_002", -98.0)  # -> 2.0 PARALYZED
    await transfer_resource(world, event_bus, "wanderer_001", target="wanderer_002",
                            resource_type=ResourceTypes.ENERGY, amount=1.0)  # 2 -> 3, still <=5
    assert world.get_agent("wanderer_002").status is AgentStatus.PARALYZED
    assert not any(e.type == "agent_recovered" for e in event_bus.get_events("wanderer_002"))

async def test_transfer_to_alive_no_recovered_event(world, event_bus) -> None:
    await transfer_resource(world, event_bus, "wanderer_001", target="wanderer_002",
                            resource_type=ResourceTypes.ENERGY, amount=10.0)
    assert not any(e.type == "agent_recovered" for e in event_bus.get_events("wanderer_002"))
```
- [ ] **Step 2 — run, expect FAIL.** `python -m pytest tests/tools/resources_test.py -k "revive or recover or to_alive" -q`
- [ ] **Step 3 — implement** in `transfer_resource`, around the energy credit:
```python
if req_resource == ResourceTypes.ENERGY:
    was_paralyzed = receiver_agent.status is AgentStatus.PARALYZED
    world.modify_agent_energy(sender_agent.id, -quantity)
    world.modify_agent_energy(receiver_agent.id, quantity)
    if was_paralyzed and receiver_agent.status is AgentStatus.ALIVE:
        recover_payload = {"message": (f"{sender_agent.name} revived {receiver_agent.name} "
                                       f"(ID:{receiver_agent.id}).")}
        await event_bus.publish(Event("agent_recovered", sender_agent.id, recover_payload,
                                      scope=ScopeType.LOCAL, target=receiver_agent.id,
                                      timestamp=world.now()))
else:
    world.modify_agent_materials(sender_agent.id, -quantity)
    world.modify_agent_materials(receiver_agent.id, quantity)
# ... existing resource_transferred event + return unchanged ...
```
- [ ] **Step 4 — run, expect PASS.** Re-run; then full `tests/tools/resources_test.py`.
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T4): agent_recovered LOCAL event when feeding revives a paralyzed agent"`

---

### Task 5 — Revisit-List items (speak guard, attack warning, abort-on-paralyze)

**Files:** Modify `tools/builtin/communication.py` (`speak`), `agents/runtime.py`
(`_render_perception`, `execute`). Tests: `tests/tools/communication_test.py`,
`tests/agents/runtime_test.py`.
**Interfaces:** Consumes `AgentStatus`, `ATTACK_ENERGY_COST`, `PARALYSIS_ENERGY_THRESHOLD`.

- [ ] **Step 1 — failing tests:**
```python
# communication_test.py
async def test_speak_blocked_when_paralyzed(world, event_bus) -> None:
    world.modify_agent_energy("wanderer_001", -96.0)  # PARALYZED
    out = await speak(world, event_bus, "wanderer_001", message="hello")
    assert out.startswith("Invalid:")
    assert not event_bus.get_events("wanderer_001")  # nothing published

# runtime_test.py
def test_low_energy_attack_warning_in_perception(world, event_bus, populated_registry) -> None:
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.modify_agent_energy(ADA, -(world.get_agent(ADA).current_energy - 8.0))  # 8 energy
    text = agent._render_perception([])
    assert "⚠" in text and "paralyzed" in text.lower()

async def test_execute_aborts_remaining_calls_when_paralyzed_midbreath(
    world, event_bus, populated_registry
) -> None:
    """If a tool call paralyzes the agent, later calls in the same breath are skipped."""
    # speak costs 0.5; drive ADA to 5.5 so the first speak -> 5.0 => PARALYZED.
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider(), pace=0.0)
    world.modify_agent_energy(ADA, -(world.get_agent(ADA).current_energy - 5.5))
    await agent.execute([ToolCall("speak", {"message": "one"}),
                         ToolCall("speak", {"message": "two"})])
    speaks = [e for e in event_bus.get_events_all_regions() if e.type == "speak"] \
        if hasattr(event_bus, "get_events_all_regions") else None
    # Assert the second call produced a skipped tool message:
    tool_msgs = [m for m in agent.lifecycle_history if m["role"] == "tool"]
    assert any("could not act" in m["content"].lower() or "paralyzed" in m["content"].lower()
               for m in tool_msgs)
```
  (If `get_events_all_regions` doesn't exist, drop that line — assert only on the tool messages.)
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement:**
  - `speak`: after fetching `agent_state`, add `if agent_state.status is not AgentStatus.ALIVE: return "Invalid: You are paralyzed and cannot speak."` (before mutation/publish).
  - `_render_perception`: after the energy line, when `agent_state.status is AgentStatus.ALIVE and agent_state.current_energy < ATTACK_ENERGY_COST + PARALYSIS_ENERGY_THRESHOLD`, append a warning line: `f"- ⚠️ Your energy is {agent_state.current_energy}; attacking costs {ATTACK_ENERGY_COST} — you would be paralyzed."`.
  - `execute`: at the top of the loop, if the agent is no longer ALIVE, append a skipped-`tool` message for the remaining call and `continue` (don't invoke):
```python
for index, tool_call in enumerate(tool_calls):
    call_id = self._call_id(tool_call, index)
    if self._status() is not AgentStatus.ALIVE:
        result = f"You could not act ({tool_call.name!r}): you are no longer able to."
    elif tool_call.name == RECALL_TOOL_NAME:
        result = self._recall(tool_call.params)
    else:
        ...  # existing invoke path
    self.lifecycle_history.append({"role": "tool", "tool_call_id": call_id,
                                   "tool_name": tool_call.name, "content": result})
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T5): revisit items — speak paralysis guard, low-energy attack warning, abort-on-paralyze"`

---

### Task 6 — `FeedEventLog` + `CompositeEventLog`

**Files:** Modify `observability/event_log.py`. Test: `tests/observability/event_log_test.py`.
**Interfaces:** Both implement the `EventLog` protocol (`record(event) -> None`).
`FeedEventLog.new_events(cursor: int) -> tuple[list[Event], int]`. `CompositeEventLog(*logs)`.

- [ ] **Step 1 — failing tests:**
```python
def _ev(i: int) -> Event:
    return Event(f"t{i}", "src", {"message": str(i)}, scope=ScopeType.GLOBAL)

def test_composite_fans_out_to_all_sinks() -> None:
    a, b = InMemoryEventLog(), InMemoryEventLog()
    comp = CompositeEventLog(a, b)
    comp.record(_ev(1))
    assert len(a.events) == 1 and len(b.events) == 1

def test_feed_cursor_returns_only_new() -> None:
    feed = FeedEventLog(maxlen=10)
    feed.record(_ev(1)); feed.record(_ev(2))
    new, cursor = feed.new_events(0)
    assert [e.type for e in new] == ["t1", "t2"] and cursor == 2
    feed.record(_ev(3))
    new2, cursor2 = feed.new_events(cursor)
    assert [e.type for e in new2] == ["t3"] and cursor2 == 3

def test_feed_ring_buffer_bounds_and_cursor_resumes_after_overflow() -> None:
    feed = FeedEventLog(maxlen=2)
    for i in range(5):
        feed.record(_ev(i))           # only t3,t4 retained; count == 5
    new, cursor = feed.new_events(0)  # cursor behind the buffer -> resume from oldest kept
    assert [e.type for e in new] == ["t3", "t4"] and cursor == 5
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** in `observability/event_log.py`:
```python
from collections import deque

class CompositeEventLog:
    """An EventLog that fans `record` out to several sinks (e.g. JSONL + live feed)."""
    def __init__(self, *logs: EventLog) -> None:
        self._logs: tuple[EventLog, ...] = logs
    def record(self, event: Event) -> None:
        for log in self._logs:
            log.record(event)

class FeedEventLog:
    """A bounded in-memory EventLog the activity feed polls by a monotonic cursor.

    Keeps the last ``maxlen`` events plus a monotonic total count. A renderer polls
    `new_events(cursor)`; if the cursor is behind the retained window (ring-buffer
    overflow) it resumes from the oldest retained event and silently skips dropped ones
    (acceptable for a live view — the JSONL log is the complete record).
    """
    def __init__(self, maxlen: int = 512) -> None:
        self._buf: deque[Event] = deque(maxlen=maxlen)
        self._count: int = 0
    def record(self, event: Event) -> None:
        self._buf.append(event)
        self._count += 1
    def new_events(self, cursor: int) -> tuple[list[Event], int]:
        retained = len(self._buf)
        oldest = self._count - retained           # absolute index of buf[0]
        start = max(cursor, oldest)
        events = list(self._buf)[start - oldest:] if start < self._count else []
        return events, self._count
```
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T6): FeedEventLog (cursor) + CompositeEventLog fan-out"`

---

### Task 7 — Activity feed (`rich`) + console wiring

**Files:** Create `observability/activity_feed.py`; modify `core/logging.py` (rich console
option). Tests: `tests/observability/activity_feed_test.py`. Add `rich` to deps (T10 declares
it; importing here is fine once installed — `pip install rich` if needed for local runs).
**Interfaces:** `render_event(event) -> str`, `render_world_table(world) -> rich.table.Table`,
`run_activity_feed(feed, world, console, *, refresh_interval, should_stop) -> None`.

- [ ] **Step 1 — failing tests** (pure renderers are unit-testable; the live loop is not):
```python
def test_render_event_human_readable() -> None:
    e = Event("agent_died", "wanderer_002", {"message": "X was slain by Y", "killer": "wanderer_001"},
              scope=ScopeType.GLOBAL)
    line = render_event(e)
    assert "slain" in line.lower() or "died" in line.lower()

def test_render_event_falls_back_to_type() -> None:
    e = Event("mystery", "src", {}, scope=ScopeType.GLOBAL)  # no message
    assert "mystery" in render_event(e)

def test_render_world_table_lists_agents_and_regions(world: WorldState) -> None:
    table = render_world_table(world)            # returns a rich.table.Table
    from rich.console import Console
    text = "".join(seg.text for seg in Console().render(table))
    assert "wanderer_001" in text
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `observability/activity_feed.py`:
  - `render_event(event)`: prefer `event.payload.get("message")`; else a templated line per
    `event.type`; always prefix with the source. Pure, no I/O.
  - `render_world_table(world)`: build a `rich.table.Table` with agent rows
    (id/status/energy/materials/position) and a region section (name/energy/materials).
  - `run_activity_feed(feed, world, console, *, refresh_interval=2.0, should_stop)`: an async
    loop using `rich.live.Live(console=console)`; each tick poll `feed.new_events(cursor)`,
    append rendered lines to a bounded display deque, and re-render `[events_panel,
    world_table]`; sleep `refresh_interval`; exit when `should_stop()` returns True. Mark the
    loop body `# pragma: no cover` (integration-only); unit tests cover the pure renderers.
  - In `core/logging.py`, add `configure_rich_logging(console) -> None` that installs a
    single `rich.logging.RichHandler(console=console)` on the root logger (replacing
    handlers), so logs and the Live view share one `Console(stderr=True)`.
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T7): rich activity feed (renderers + live loop) + shared stderr console"`

---

### Task 8 — `SerializingDecider`

**Files:** Modify `agents/decider.py`. Test: `tests/agents/decider_test.py`.
**Interfaces:** `SerializingDecider(inner: Decider, lock: asyncio.Lock | None = None)`
implements `Decider`.

- [ ] **Step 1 — failing tests:**
```python
async def test_serializing_decider_never_overlaps() -> None:
    inflight = 0; max_seen = 0
    class _Probe:
        async def decide(self, messages, tools) -> Decision:
            nonlocal inflight, max_seen
            inflight += 1; max_seen = max(max_seen, inflight)
            await asyncio.sleep(0.01)
            inflight -= 1
            return Decision(text="ok")
    dec = SerializingDecider(_Probe())
    await asyncio.gather(*[dec.decide([], []) for _ in range(5)])
    assert max_seen == 1                       # strictly serialized

async def test_serializing_decider_releases_on_error() -> None:
    class _Boom:
        async def decide(self, messages, tools) -> Decision:
            raise RuntimeError("boom")
    dec = SerializingDecider(_Boom())
    with pytest.raises(RuntimeError):
        await dec.decide([], [])
    assert not dec._lock.locked()              # context manager released it
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** in `agents/decider.py`:
```python
class SerializingDecider:
    """Wrap a Decider so only one decision runs at a time (the single-Ollama constraint).

    The model serves requests sequentially; concurrent agent decisions would thunder-herd
    and cascade timeouts. A shared lock makes "sequential inference, pseudo-parallel via
    asyncio" explicit. `async with` guarantees release on timeout/cancel/exception.
    """
    def __init__(self, inner: Decider, lock: asyncio.Lock | None = None) -> None:
        self._inner = inner
        self._lock = lock or asyncio.Lock()
    async def decide(self, messages: list[dict[str, Any]], tools: list[dict[str, Any]]) -> Decision:
        async with self._lock:
            return await self._inner.decide(messages, tools)
```
  Optionally extend `make_default_decider` with `serialize: bool = False` (the runner wraps
  explicitly, so keep the factory simple).
- [ ] **Step 4 — run, expect PASS.**
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T8): SerializingDecider — one agent thinks at a time over the shared Ollama"`

---

### Task 9 — Runner `scripts/run.py`

**Files:** Create `scripts/run.py`, `scripts/__init__.py` (if needed). Test:
`tests/scripts/run_test.py`.
**Interfaces:** `build_simulation(config_path, *, seed, model, memory_root, run_dir, decider=None)
-> Simulation` (a dataclass bundling world, bus, agents, feed_log, decider); `run_simulation(
sim, *, pace, duration, world_tick_interval, refresh_interval) -> None`; `main(argv=None) -> int`.

- [ ] **Step 1 — failing tests** (mocked decider; no live model; tiny duration):
```python
async def test_runner_smoke_runs_and_shuts_down(tmp_path) -> None:
    sim = build_simulation("config/world.yaml", seed=7, model="mock",
                           memory_root=tmp_path/"mem", run_dir=tmp_path/"runs",
                           decider=MockDecider([Decision(tool_calls=[ToolCall("look_around")])]*200))
    await run_simulation(sim, pace=0.0, duration=0.3, world_tick_interval=0.05,
                         refresh_interval=0.05)
    assert any(a.breath_count > 0 for a in sim.agents)        # agents breathed
    assert sim.feed_log.new_events(0)[1] > 0                  # events recorded
    for a in sim.agents:                                      # inboxes freed at shutdown
        assert a.agent_id not in sim.bus.agent_queues

async def test_runner_stops_when_all_dead(tmp_path) -> None:
    sim = build_simulation("config/world.yaml", seed=7, model="mock",
                           memory_root=tmp_path/"mem", run_dir=tmp_path/"runs",
                           decider=MockDecider([Decision()]*50))
    for a in sim.agents:                                      # pre-kill everyone
        sim.world.kill_agent(a.agent_id)
    await run_simulation(sim, pace=0.0, duration=5.0, world_tick_interval=0.05,
                         refresh_interval=0.05)               # returns fast, not at duration
```
- [ ] **Step 2 — run, expect FAIL.**
- [ ] **Step 3 — implement** `scripts/run.py`:
  - `build_simulation`: `world = load_config(config_path, seed=seed)`; `feed = FeedEventLog()`;
    `jsonl = JsonlEventLog(run_dir / f"run_{seed}.jsonl")`; `bus = EventBus(world,
    event_log=CompositeEventLog(jsonl, feed))`; `registry = ToolRegistry(world, bus);
    register_builtins(registry)`; `inner = decider or make_default_decider(model)`;
    `decider = inner if isinstance(inner, SerializingDecider) else SerializingDecider(inner)`;
    build one `Agent` per `world.get_all_agents()` with `FileMemoryStore(id, memory_root, ...)`;
    return the `Simulation` bundle. (Agents subscribe to the bus in `Agent.__init__`.)
  - `run_simulation`: create tasks: `run_agent(a)` per agent (awaits `a.run(pace=pace)`, then
    `bus.unsubscribe(a.agent_id)` in a `finally`); `run_world_tick(world, bus,
    interval=world_tick_interval)`; `run_activity_feed(feed, world, console, refresh_interval,
    should_stop)`; plus a `collapse_watch` task that cancels the run after N consecutive ticks
    with zero ALIVE agents. Wrap the agent gather in `asyncio.timeout(duration)`. One `finally`
    cleanup path: cancel outstanding tasks, unsubscribe all, render a final summary, flush logs.
    Funnel SIGINT (via `asyncio` signal handler or `KeyboardInterrupt`) and timeout through it.
  - `main(argv)`: argparse (`--config --seed --model --pace --duration --world-tick-interval
    --memory-root --run-dir`); `configure_rich_logging(console)`; `asyncio.run(run_simulation(
    build_simulation(...), ...))`; return 0.
  - Use `# pragma: no cover` on the live `main`/signal glue; the two tests cover
    `build_simulation` + `run_simulation` with a mock decider and tiny duration.
- [ ] **Step 4 — run, expect PASS.** Then full fast suite.
- [ ] **Step 5 — commit.** `git commit -am "feat(sprint6-T9): scripts/run.py — multi-agent runner, collapse watch, one shutdown path"`

---

### Task 10 — `pyproject.toml` tooling migration

**Files:** Create `pyproject.toml`; keep `requirements.txt` (or note it as generated). Update
`CLAUDE.md §8` commands if needed.
**Interfaces:** none (tooling). Declares `rich` as a runtime dep.

- [ ] **Step 1 — write `pyproject.toml`** with: `[project]` (name, version, `requires-python =
  ">=3.13"`, runtime deps incl. `ollama`, `chromadb`, `pyyaml`, `pydantic`, `rich`),
  `[project.optional-dependencies] dev` (pytest, pytest-asyncio, pytest-cov, mypy, ruff,
  pre-commit), `[tool.pytest.ini_options]` (`python_files = "*_test.py"`, `asyncio_mode =
  "auto"`, `markers = ["integration: live-model tests"]`, `addopts = "-m 'not integration'"`),
  `[tool.ruff]` (line-length 100, lint rules matching current), `[tool.mypy]` (`strict = true`,
  the packages), `[tool.coverage.run]`.
- [ ] **Step 2 — verify the gates run via pyproject:** `python -m pytest -q` (fast subset via
  addopts), `mypy --strict agents core world bus tools observability config scripts`,
  `ruff check .`. Expected: all green.
- [ ] **Step 3 — add a `.pre-commit-config.yaml`** running ruff + mypy + fast pytest.
- [ ] **Step 4 — commit.** `git commit -am "build(sprint6-T10): pyproject.toml tooling migration + rich dep + pre-commit"`

---

### Task 11 (F4) — Live integration run & tuning (validation, not unit code)

**Files:** add `tests/integration/sprint6_smoke_test.py` (`@pytest.mark.integration`).
- [ ] **Step 1** — write a short live smoke (`@pytest.mark.integration`): build the sim with
  the real decider, 4–5 agents, `duration≈120s`, assert it runs without crashing, the feed
  records events, and at least one agent acted.
- [ ] **Step 2** — run it: `python -m pytest -m integration tests/integration/sprint6_smoke_test.py -q`
  (needs Ollama + qwen3). Fix any crash.
- [ ] **Step 3** — full 30-min run by hand: `python -m scripts.run --duration 1800 --seed 7`.
  Watch the feed. Capture the JSONL replay.
- [ ] **Step 4** — if the world collapses/explodes, tune `core/constants.py` dials (regen
  rates, action/attack costs/damage, pace) and re-run; record before/after in
  `docs/superpowers/benchmarks/2026-06-29-sprint6-run.md`. Note ≥1 emergent behavior.
- [ ] **Step 5** — commit the smoke test + the run notes.

---

## Build order / parallelism for the implementation team
- **Wave 1 (parallel):** T10 (tooling), T1 (runtime paralysis), T2 (kill_agent), T4
  (agent_recovered), T6 (feed logs), T8 (SerializingDecider). T5 touches runtime + a tool
  (coordinate with T1 on `runtime.py` — same file, different methods; sequence T1 then T5 if
  using worktrees that would conflict).
- **Wave 2:** T3 (needs T2), T7 (needs T6).
- **Wave 3:** T9 (needs T1–T8). Then T11/F4.
- After every task: `python -m pytest -q -m "not integration"`, `mypy --strict`, `ruff check`.

## Self-review notes (done)
- Every spec §5 file is covered by a task (resources.py→T4; combat.py→T3; communication.py +
  runtime→T1/T5; world.py→T2; event_log.py→T6; activity_feed.py→T7; decider.py→T8;
  logging.py→T7; run.py→T9; pyproject→T10).
- Death model test includes the 0.0 boundary (T3). Escrow cleanup tested (T2). agent_recovered
  three cases (T4). All-dead/all-paralyzed termination tested (T9). Paralyzed-breath drain
  tested (T1).
