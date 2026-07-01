# Self-Talk & the Freedom Not to Act — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a being *act*, *speak to itself*, or *simply rest* on any breath — no forced action — and make the self-talk perceivable (logged + fed) without delivering it to any other being.

**Architecture:** A no-tool breath is already mechanically supported (`execute([])` no-ops). We add a new routing scope `ScopeType.PRIVATE` (logged by the sink, delivered to no inbox); the runtime publishes a `self_talk` PRIVATE event after `decide()` when the breath produced free text and no tool call; the system-prompt framing is loosened to offer the freedom in-world; the `wait` tool is retired; and the activity feed renders `self_talk` distinctly.

**Tech Stack:** Python 3.13, asyncio, pytest + pytest-asyncio (`asyncio_mode=auto`), `rich` (feed), mypy `--strict`, ruff.

## Global Constraints

- Python 3.13; modern typing only (`str | None`, `list[X]`, `dict[str, Any]`).
- `mypy --strict` clean; new code must type-check.
- `ruff check .` and `ruff format --check .` clean.
- Google-style docstrings on every module/class/public function, including `-> None`.
- All randomness via injected seeded RNG (`world.rng`); never global `random`.
- No `print()` in library code; use a module logger.
- Tool functions return natural-language strings; infrastructure raises typed exceptions.
- Tests are deterministic: `MockDecider`, seeded rng, frozen clock; `*_test.py` naming.
- ≥90% coverage on core packages (`world/ bus/ tools/ core/ agents/ observability/`).
- CI gate to reproduce before merge, verbatim:
  `ruff check .` · `ruff format --check .` ·
  `mypy core tests world bus tools config agents observability` ·
  `pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90`

## File Structure

- `bus/events.py` — add `ScopeType.PRIVATE` (enum value + docstring).
- `bus/event_bus.py` — route `PRIVATE`: no inbox delivery; still logged at the single capture point.
- `agents/runtime.py` — `_emit_self_talk(decision)` helper + call it in `breathe()`; ensure `Event`/`ScopeType` imported.
- `agents/prompt.py` — add the freedom to `WORLD_MECHANICS`.
- `tools/builtin/communication.py` — remove `wait` + `WAIT_PHRASES`; fix module docstring.
- `tools/builtin/__init__.py` — remove `wait` from import, `__all__`, `BUILTIN_TOOLS`.
- `agents/tool_schemas.py` — remove the `"wait"` schema entry.
- `observability/activity_feed.py` — render `self_talk` distinctly.
- Tests: `tests/bus/event_bus_test.py`, `tests/agents/runtime_test.py`, `tests/agents/prompt_test.py`, `tests/tools/communication_test.py`, `tests/observability/activity_feed_test.py`.

---

### Task 1: `ScopeType.PRIVATE` — logged, delivered to no inbox

**Files:**
- Modify: `bus/events.py` (enum `ScopeType`, ~line 39-41; docstring ~32-37)
- Modify: `bus/event_bus.py` (routing `match`, ~line 132-162; module docstring ~11-14)
- Test: `tests/bus/event_bus_test.py`

**Interfaces:**
- Produces: `ScopeType.PRIVATE` (value `"private"`). A `PRIVATE`-scoped `Event` routes to **zero** inboxes and **is** recorded by the attached `event_log` sink.

- [ ] **Step 1: Write the failing test** — append to `tests/bus/event_bus_test.py` (reuses the file's `bus_world` fixture and agents `a1`/`a2`/`b1`; `InMemoryEventLog` is already imported there):

```python
async def test_private_routes_to_no_inbox_but_is_recorded(bus_world: WorldState) -> None:
    """PRIVATE reaches no inbox (not even the source), yet is still recorded (observable)."""
    log = InMemoryEventLog()
    event_bus = EventBus(bus_world, event_log=log)
    for agent in bus_world.get_all_agents():
        event_bus.subscribe(agent.id)
    event = Event(
        type="self_talk",
        source="a1",
        payload={"message": "just musing"},
        scope=ScopeType.PRIVATE,
    )
    await event_bus.publish(event)
    assert event_bus.get_events("a1") == []  # not even the source hears it
    assert event_bus.get_events("a2") == []
    assert event_bus.get_events("b1") == []
    assert log.events == [event]  # but it is observable in the log/feed
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pytest tests/bus/event_bus_test.py::test_private_routes_to_no_inbox_but_is_recorded -v`
Expected: FAIL — `AttributeError: PRIVATE` (enum member does not exist yet), or an `EventBusError` "unknown scope".

- [ ] **Step 3: Add the enum value** in `bus/events.py` — extend `ScopeType` and its docstring:

```python
    LOCAL = "local"
    GLOBAL = "global"
    TARGETED = "targeted"
    PRIVATE = "private"  # interiority: recorded/fed for the watchers, delivered to no inbox
```

Add to the class docstring's Attributes:

```
        PRIVATE: Delivered to no agent inbox at all. Still recorded by the event
            log sink (so it replays and shows in the feed) — a being's self-talk,
            perceivable by the watchers but heard by no other being.
```

- [ ] **Step 4: Route it** in `bus/event_bus.py` — add a case before `case _:` in the `match event.scope` block (`InMemoryEventLog` note: `PRIVATE` intentionally delivers to nobody; the existing single capture point at the end of `publish` still records it):

```python
            case ScopeType.PRIVATE:
                pass  # interiority: no inbox delivery; the capture point below still logs it
            case _:
```

Update the module docstring's scope list (~line 11-14) to add:
`* ``PRIVATE`` -- to no inbox; recorded by the log sink only (self-talk).`

- [ ] **Step 5: Run the test and the whole bus suite**

Run: `pytest tests/bus/ -v`
Expected: PASS (new test green; all existing routing tests still green).

- [ ] **Step 6: Commit**

```bash
git add bus/events.py bus/event_bus.py tests/bus/event_bus_test.py
git commit -m "feat(bus): add ScopeType.PRIVATE — logged but routed to no inbox"
```

---

### Task 2: Runtime emits `self_talk` on a text-only breath

**Files:**
- Modify: `agents/runtime.py` (add `_emit_self_talk`; call it in `breathe()`; ensure `Event`/`ScopeType` imported)
- Test: `tests/agents/runtime_test.py`

**Interfaces:**
- Consumes: `ScopeType.PRIVATE` (Task 1); `Decision(text, tool_calls, …)`; `self.event_bus.publish`, `self.world.now()`, `self.agent_id`.
- Produces: `Agent._emit_self_talk(self, decision: Decision) -> None`. On a text-only breath (`decision.text.strip()` truthy **and** `decision.tool_calls` empty) it publishes one `self_talk` `PRIVATE` event with `payload={"message": <stripped text>}`; otherwise emits nothing. Costs no energy.

- [ ] **Step 1: Write the failing tests** — append to `tests/agents/runtime_test.py` (this file already builds agents as `Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)` and imports `Decision`, `ToolCall`, `MockDecider`; add imports `from bus.event_bus import EventBus`, `from bus.events import ScopeType`, `from observability.event_log import InMemoryEventLog` if not already present):

```python
async def test_text_only_breath_emits_private_self_talk(world, populated_registry) -> None:
    """A breath with words but no tool call publishes one PRIVATE self_talk event, free."""
    log = InMemoryEventLog()
    event_bus = EventBus(world, event_log=log)
    event_bus.subscribe(ADA.id)
    decider = MockDecider([Decision(text="  I wonder what lies past the hills.  ")])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)
    energy_before = world.get_agent(ADA.id).current_energy

    await agent.breathe()

    self_talks = [e for e in log.events if e.type == "self_talk"]
    assert len(self_talks) == 1
    assert self_talks[0].scope is ScopeType.PRIVATE
    assert self_talks[0].payload["message"] == "I wonder what lies past the hills."
    assert event_bus.get_events(ADA.id) == []  # delivered to no one, not even itself
    assert world.get_agent(ADA.id).current_energy == energy_before  # self-talk is free


async def test_acting_breath_emits_no_self_talk(world, populated_registry) -> None:
    """A breath that calls a tool is an action, not self-talk — no self_talk event."""
    log = InMemoryEventLog()
    event_bus = EventBus(world, event_log=log)
    event_bus.subscribe(ADA.id)
    decider = MockDecider([Decision(text="Let me look.", tool_calls=[ToolCall("look_around")])])
    agent = Agent(ADA, world, event_bus, populated_registry, decider, pace=0.0)

    await agent.breathe()

    assert [e for e in log.events if e.type == "self_talk"] == []


async def test_resting_breath_emits_nothing(world, populated_registry) -> None:
    """A blank breath is a silent rest: no self_talk event, no marker."""
    log = InMemoryEventLog()
    event_bus = EventBus(world, event_log=log)
    event_bus.subscribe(ADA.id)
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider([Decision()]), pace=0.0)

    await agent.breathe()

    assert [e for e in log.events if e.type == "self_talk"] == []
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `pytest tests/agents/runtime_test.py -k "self_talk or resting_breath" -v`
Expected: FAIL — `test_text_only_breath_emits_private_self_talk` fails (no `self_talk` event emitted); the other two pass trivially (nothing emitted yet).

- [ ] **Step 3: Implement the helper** in `agents/runtime.py`. First ensure the import exists near the other `bus` imports:

```python
from bus.events import Event, ScopeType
```

Add the method (place it just below `execute`):

```python
    async def _emit_self_talk(self, decision: Decision) -> None:
        """Publish a private ``self_talk`` event when a breath voiced a thought and took no action.

        A being may resolve a breath by simply speaking its mind — free text with no
        tool call — rather than acting. That utterance is perceivable (recorded by the
        log sink, shown in the feed) but routed to **no** other being: it is not
        communication and costs nothing. Nothing is emitted when the breath took an
        action (``decision.tool_calls`` non-empty) or was a silent rest (blank text).

        Args:
            decision: The just-made decision for this breath.

        Side effects:
            Publishes one ``"self_talk"`` :class:`~bus.events.Event`
            (:attr:`~bus.events.ScopeType.PRIVATE`, stamped ``world.now()``) when
            ``decision`` is text-only; otherwise none.
        """
        if decision.tool_calls or not decision.text.strip():
            return
        await self.event_bus.publish(
            Event(
                type="self_talk",
                source=self.agent_id,
                payload={"message": decision.text.strip()},
                scope=ScopeType.PRIVATE,
                timestamp=self.world.now(),
            )
        )
```

- [ ] **Step 4: Call it in `breathe()`** — in the `else` branch, right after `await self.execute(decision.tool_calls)`:

```python
                    await self.execute(decision.tool_calls)
                    await self._emit_self_talk(decision)
```

- [ ] **Step 5: Run the tests**

Run: `pytest tests/agents/runtime_test.py -k "self_talk or resting_breath" -v`
Expected: PASS (all three).

- [ ] **Step 6: Commit**

```bash
git add agents/runtime.py tests/agents/runtime_test.py
git commit -m "feat(agents): emit a private self_talk event on a text-only breath"
```

---

### Task 3: Framing — grant the freedom not to act, in-world

**Files:**
- Modify: `agents/prompt.py` (`WORLD_MECHANICS`)
- Test: `tests/agents/prompt_test.py`

**Interfaces:**
- Produces: `WORLD_MECHANICS` now states, in-world, that a being may rest or think to itself instead of acting. No goals, no strategy, no simulation language (DD9 constraint preserved).

- [ ] **Step 1: Write the failing test** — append to `tests/agents/prompt_test.py` (imports `WORLD_MECHANICS` from `agents.prompt`):

```python
def test_world_mechanics_grants_the_freedom_not_to_act() -> None:
    """The being is told, in-world, that it may rest or think to itself — not only act."""
    text = WORLD_MECHANICS
    assert "never compelled to act" in text
    assert "no one but yourself" in text
    # DD9: still no goals / strategy / simulation language.
    lowered = text.lower()
    for banned in ("simulation", "goal", "objective", "mission", "optimi", "you should"):
        assert banned not in lowered
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pytest tests/agents/prompt_test.py::test_world_mechanics_grants_the_freedom_not_to_act -v`
Expected: FAIL — the freedom phrases are not present yet.

- [ ] **Step 3: Add the freedom line** to `WORLD_MECHANICS` in `agents/prompt.py` — append one bullet to the string (after the mating bullet, before the closing `)`):

```python
        "\n- You are never compelled to act. You may let a moment simply pass and rest, "
        "or turn something over in your own mind — words meant for no one but yourself."
```

- [ ] **Step 4: Run the prompt suite**

Run: `pytest tests/agents/prompt_test.py -v`
Expected: PASS (new test green; existing prompt tests — including the no-forbidden-words checks — still green).

- [ ] **Step 5: Commit**

```bash
git add agents/prompt.py tests/agents/prompt_test.py
git commit -m "feat(prompt): grant the in-world freedom to rest or think to oneself"
```

---

### Task 4: Retire the `wait` tool

**Files:**
- Modify: `tools/builtin/communication.py` (remove `wait` + `WAIT_PHRASES`; fix module docstring)
- Modify: `tools/builtin/__init__.py` (import, `__all__`, `BUILTIN_TOOLS`)
- Modify: `agents/tool_schemas.py` (remove `"wait"` entry, ~line 47-54)
- Test: `tests/tools/communication_test.py` (remove wait tests, add a retirement assertion), `tests/agents/runtime_test.py` (swap `ToolCall("wait")` usages)

**Interfaces:**
- Produces: `wait` no longer exists in `BUILTIN_TOOLS` or `TOOL_SCHEMAS`. The tool-schema parity invariant `set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)` still holds.

- [ ] **Step 1: Write the failing retirement test** — append to `tests/tools/communication_test.py`:

```python
def test_wait_tool_is_retired() -> None:
    """`wait` is gone from both the tool registry set and the schema set (kept in lock-step)."""
    from agents.tool_schemas import TOOL_SCHEMAS
    from tools.builtin import BUILTIN_TOOLS

    assert "wait" not in BUILTIN_TOOLS
    assert "wait" not in TOOL_SCHEMAS
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pytest tests/tools/communication_test.py::test_wait_tool_is_retired -v`
Expected: FAIL — `wait` is still present in both.

- [ ] **Step 3: Remove `wait` from `tools/builtin/communication.py`** — delete the `WAIT_PHRASES` tuple (lines ~17-26) and the entire `async def wait(...)` function (lines ~95-116). Change the module docstring's first line from:

```python
"""Communication tools: ``speak`` (broadcast/whisper) and ``wait`` (rest).
```
to:
```python
"""Communication tool: ``speak`` (broadcast to a region, or whisper to one being).
```

- [ ] **Step 4: Remove `wait` from `tools/builtin/__init__.py`** — three edits:
  - `from tools.builtin.communication import speak, wait` → `from tools.builtin.communication import speak`
  - remove the `"wait",` line from `__all__`
  - remove the `"wait": wait,` entry from `BUILTIN_TOOLS`

- [ ] **Step 5: Remove the `"wait"` schema** from `agents/tool_schemas.py` — delete the entire `"wait": { ... },` block (lines ~47-54).

- [ ] **Step 6: Fix tests that referenced `wait`** — in `tests/agents/runtime_test.py`, replace every `ToolCall("wait")` with `ToolCall("look_around")` (a real, side-effect-free tool that remains registered). In `tests/tools/communication_test.py`, delete any `wait`-specific tests (e.g. tests asserting a `WAIT_PHRASES` phrase is returned).

- [ ] **Step 7: Run the affected suites + the parity test**

Run: `pytest tests/tools/ tests/agents/ -v`
Expected: PASS — `test_wait_tool_is_retired` green, the schema/registry parity test green, no lingering `wait` references.

- [ ] **Step 8: Confirm no stray references remain**

Run: `grep -rn "wait" tools/ agents/ tests/tools/ tests/agents/ | grep -viE "await|waiting for|# "`
Expected: no matches referencing the retired tool.

- [ ] **Step 9: Commit**

```bash
git add tools/builtin/communication.py tools/builtin/__init__.py agents/tool_schemas.py \
        tests/tools/communication_test.py tests/agents/runtime_test.py
git commit -m "refactor(tools): retire the wait tool — resting is now a framing freedom"
```

---

### Task 5: Render `self_talk` distinctly in the activity feed

**Files:**
- Modify: `observability/activity_feed.py` (`_EVENT_VERBS`, `render_event`)
- Test: `tests/observability/activity_feed_test.py`

**Interfaces:**
- Consumes: a `self_talk` `Event` with `payload["message"]`.
- Produces: `render_event(self_talk_event)` returns `"[<source>] 💭 <message>"` (a private-thought register, visually distinct from `speak`).

- [ ] **Step 1: Write the failing test** — append to `tests/observability/activity_feed_test.py` (imports `render_event`, `Event`, `ScopeType`):

```python
def test_render_self_talk_reads_as_a_private_thought() -> None:
    """A self_talk event renders in a distinct thought register, not like speech."""
    event = Event(
        type="self_talk",
        source="a1",
        payload={"message": "I wonder what lies past the hills."},
        scope=ScopeType.PRIVATE,
    )
    assert render_event(event) == "[a1] 💭 I wonder what lies past the hills."
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `pytest tests/observability/activity_feed_test.py::test_render_self_talk_reads_as_a_private_thought -v`
Expected: FAIL — currently renders `[a1] I wonder what lies past the hills.` (no 💭 marker).

- [ ] **Step 3: Add the fallback verb** to `_EVENT_VERBS` in `observability/activity_feed.py`:

```python
    "self_talk": "murmured a private thought",
```

- [ ] **Step 4: Special-case `render_event`** — insert before the existing `body = ...` line:

```python
    message = event.payload.get("message")
    if event.type == "self_talk":
        body = f"💭 {message}" if message else _EVENT_VERBS["self_talk"]
        return f"[{event.source}] {body}"
    body = str(message) if message else _EVENT_VERBS.get(event.type, event.type)
    return f"[{event.source}] {body}"
```

- [ ] **Step 5: Run the feed suite**

Run: `pytest tests/observability/activity_feed_test.py -v`
Expected: PASS (new test green; existing render tests still green).

- [ ] **Step 6: Commit**

```bash
git add observability/activity_feed.py tests/observability/activity_feed_test.py
git commit -m "feat(feed): render self_talk as a distinct private thought"
```

---

## Final Verification (run before opening the PR)

- [ ] Reproduce the full CI gate set and read the output:

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

Expected: all green; coverage ≥ 90% on core packages; the touched files show no new `missing` lines.

- [ ] (Optional, manual) Run a short live session and watch the feed for `💭` self-talk lines and quiet (rest) breaths:
  `python scripts/run.py --provider gemini --breaths 12` (or the current documented entry point).

## Spec Coverage Check

- Freedom to not act (act / self-talk / rest) → Tasks 2 (self-talk + rest emit-nothing) + 3 (framing offers it).
- Self-talk observable but routed to no one (`ScopeType.PRIVATE`, logged + fed) → Task 1 + Task 2 + Task 5.
- Runtime (not a tool) publishes self_talk → Task 2.
- Retire `wait`; resting free → Task 4 (retire) + Task 2 (asserts no energy spent) + Task 3 (framing).
- Self-talk stays in `lifecycle_history`; no special memory handling → unchanged (`decide()` already appends the assistant `content`); no task needed.
- Not overhearable / not surfacing hidden `thinking` → out of scope; nothing emits `thinking`, PRIVATE reaches no inbox (Task 1 test asserts it).
