# Vivarium Layer 1 — Aging + the Private Hearth-Home Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make materials load-bearing by adding idle-aging (self-talk/rest costs a little energy) and a private home you build, fuel at its hearth (materials→energy, never minting), and must feed with materials or it decays and collapses.

**Architecture:** Event-driven, unchanged. Aging is a direct `WorldState.modify_agent_energy` deduction inside the breathing loop on any idle (no-tool) breath. A new `Home` dataclass lives in `WorldState` keyed by `home_id`; all home mutations are **sync and event-free** — the world-tick orchestrates time-based upkeep/decay and publishes `home_collapsed`, exactly like the existing corpse-decay sweep. Two new closure-signature tools (`build_home`, `use_hearth`) mutate through `WorldState` and publish LOCAL events. Prompt prose (DD9) and the activity feed + world-table make it all perceivable.

**Tech Stack:** Python 3.13, stdlib `dataclasses`/`enum`/`asyncio`, `rich` (feed), `pytest` + `pytest-asyncio` + `pytest-cov`, `ruff`, `mypy --strict`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python 3.13**; modern syntax already in the codebase (`match`, `str | None`, `dict[str, X]`, string `Enum`, `async`/`await`).
- **`mypy --strict` clean** on `core world bus tools config agents observability` and the tests.
- **`ruff check .` clean** and **`ruff format --check .` clean** (imports isort-ordered; no unused imports — import a constant only in the task that first uses it).
- **Google-style docstrings** on every new module, class, and public function — for tools/world methods, document *which world state it mutates and which events it emits*.
- **No `print()` in library code** — use `logging` (the `rich` activity feed is the separate rendering layer).
- **Deterministic tests** (`*_test.py` naming): never call a live LLM/Ollama; all randomness via the injected seeded RNG (`world.rng`); all time via the injected clock (`world.now()` / the `fake_clock` fixture). Use `pytest.approx` for accumulated-float comparisons.
- **Centralize all new dials in `core/constants.py`** (typed `Final`, with a provenance docstring). Tools/world/tick import from there — no magic numbers scattered in tool files.
- **Preserve domain patterns:** tools return natural-language result strings (`"Error: "` precondition/lookup failure, `"Invalid: "` rule violation, or a plain success sentence — never exceptions/booleans); in-place mutation of the mutable `WorldState` singleton; the uniform closure tool signature `async def tool(world, event_bus, agent_id, **params) -> str`; `WorldState` mutations stay **sync and event-free** (the world holds no bus — DD4).
- **DD9 (system prompt):** `WORLD_MECHANICS` describes in-world *physics/consequences only* — no goals, objectives, strategy, survival framing, or language revealing the simulation. New prose must avoid every term in `tests/agents/prompt_test.py::FORBIDDEN_TERMS` (`goal, objective, mission, task, strategy, win, lose, survive, survival, simulation, simulated, score, reward, optimize, optimise, death, die`) and `"you should"`.
- **≥90% coverage on core** (`world/`, `bus/`, `tools/`, `core/`, `agents/`, `observability/`).

### Known limitation to OBSERVE, not over-tune (from the reviewer)

Aging bites **only literal idle** breaths. `harvest_resources` and `look_around` are tool calls that cost no energy → *active* → never aged. Do **not** crank `IDLE_AGING_ENERGY_COST` to force dynamism — it can't. The hearth's value is contingent on energy scarcity emerging (crowding/local depletion); in an easy world, free harvest dominates and homes may rarely be built — an acceptable thing to *watch*.

### New constants (reference — each folded into the task that first needs it)

| Constant | Value | First needed in |
|---|---|---|
| `IDLE_AGING_ENERGY_COST` | `1.0` | Task 1 |
| `HOME_MAX_INTEGRITY` | `100.0` | Task 3 |
| `HOME_UPKEEP_MATERIALS_PER_SECOND` | `0.1` | Task 4 |
| `HOME_DECAY_PER_MISSED_TICK` | `10.0` | Task 4 |
| `HOME_BUILD_MATERIALS_COST` | `80.0` | Task 5 |
| `HEARTH_MATERIALS_PER_USE` | `20.0` | Task 6 |
| `HEARTH_ENERGY_PER_MATERIAL` | `1.0` | Task 6 |

### Final CI gate (run before merge; this is what CI runs)

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

---

## File Structure

- `core/constants.py` — **modify**: add the 7 dials above (typed `Final`, with docstrings), each in the task that first needs it. The single tuned home for world-rule numbers.
- `agents/runtime.py` — **modify**: import `IDLE_AGING_ENERGY_COST`; add the aging hook in `breathe()` right after `await self._emit_self_talk(decision)` and before the reflect gate.
- `world/homes.py` — **create**: the `Home` dataclass (`slots=True`, mutable), one clear responsibility (the home domain record), sibling to `world/agents.py` and `world/regions.py`.
- `world/world.py` — **modify**: `homes: dict[str, Home]` + the sync, event-free home methods.
- `world/tick.py` — **modify**: a fourth sweep (after corpse-decay) — time-based upkeep/decay + collapse, snapshot-then-mutate with a deferred publish.
- `tools/builtin/homes.py` — **create**: `build_home` (Task 5) and `use_hearth` (Task 6), closure signature.
- `tools/builtin/__init__.py` — **modify**: register both tools in `BUILTIN_TOOLS` + `__all__`.
- `agents/tool_schemas.py` — **modify**: add both schemas to `TOOL_SCHEMAS` (the parity test `set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)` guards that both maps are updated together).
- `agents/prompt.py` — **modify**: extend `WORLD_MECHANICS` (DD9 prose for aging + home/hearth/upkeep).
- `observability/activity_feed.py` — **modify**: `_EVENT_VERBS` for the 3 new events; a homes section in `render_world_table`.
- Tests: `tests/agents/runtime_test.py`, `tests/core/constants_test.py`, `tests/world/homes_test.py` (new), `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py` (new), `tests/agents/prompt_test.py`, `tests/observability/activity_feed_test.py`.

---

## Task 1: Idle-aging (a no-tool breath costs a little energy)

Aging stands alone and provides the survival pressure the home answers. It reuses the runtime's existing idle signal (`not decision.tool_calls`, the same branch `_emit_self_talk` keys on).

**Files:**
- Modify: `core/constants.py` (add `IDLE_AGING_ENERGY_COST`)
- Modify: `agents/runtime.py:48-64` (import) and `agents/runtime.py:921-931` (the aging hook in `breathe()`)
- Test: `tests/agents/runtime_test.py`, `tests/core/constants_test.py`

**Interfaces:**
- Consumes: `WorldState.modify_agent_energy(agent_id: str, amount: float) -> bool` (floors energy at 0.0, flips `ALIVE`→`PARALYZED` at `energy <= PARALYSIS_ENERGY_THRESHOLD`, no-ops for `DEAD`, emits nothing); `Agent.breathe`; `Decision.tool_calls: list[ToolCall]`; `Agent.refresh_status` (already emits `agent_paralyzed` on an `ALIVE→PARALYZED` flip).
- Produces: `IDLE_AGING_ENERGY_COST: Final[float] = 1.0`. Behaviour: an idle breath (no tool call — self-talk or silent rest) deducts `IDLE_AGING_ENERGY_COST`; an active breath (any tool call) deducts nothing extra.

- [ ] **Step 1: Write the failing tests** (append to `tests/agents/runtime_test.py`; the file already defines `ADA`, `BORIS`, `_live`, `_wired`, `ScriptedDecider`, imports `Agent`, `MockDecider`, `Decision`, `ToolCall`, `PARALYSIS_ENERGY_THRESHOLD`, `AgentStatus`)

Add `IDLE_AGING_ENERGY_COST` to the existing `from core.constants import (...)` block in that test file, then append:

```python
# ---------------------------------------------------------------------------
# Layer 1: idle-aging (a no-tool breath wears the being down a little)
# ---------------------------------------------------------------------------


async def test_idle_self_talk_breath_deducts_idle_aging_energy(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A text-only (no-tool) breath ages the being by IDLE_AGING_ENERGY_COST."""
    agent = Agent(
        ADA, world, event_bus, populated_registry, MockDecider([Decision(text="Musing.")]), pace=0.0
    )
    before = _live(world, ADA).current_energy
    await agent.breathe()
    assert _live(world, ADA).current_energy == before - IDLE_AGING_ENERGY_COST


async def test_silent_rest_breath_also_ages(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """A blank, no-tool breath (silent rest) ages too — the idle signal is 'no tool call'."""
    agent = Agent(ADA, world, event_bus, populated_registry, MockDecider([Decision()]), pace=0.0)
    before = _live(world, ADA).current_energy
    await agent.breathe()
    assert _live(world, ADA).current_energy == before - IDLE_AGING_ENERGY_COST


async def test_tool_breath_does_not_incur_idle_aging(
    world: WorldState, event_bus: EventBus, populated_registry: ToolRegistry
) -> None:
    """An active breath (a tool call) ages nothing extra — look_around costs no energy."""
    agent = Agent(
        ADA,
        world,
        event_bus,
        populated_registry,
        MockDecider([Decision(tool_calls=[ToolCall("look_around")])]),
        pace=0.0,
    )
    before = _live(world, ADA).current_energy
    await agent.breathe()
    assert _live(world, ADA).current_energy == before  # no idle-aging on an active breath


async def test_idle_breath_that_ages_into_paralysis_emits_agent_paralyzed(
    world: WorldState,
) -> None:
    """An idle breath that ages a being to the paralysis threshold announces the collapse once."""
    bus, registry, log = _wired(world, with_log=True)
    assert log is not None
    ada = _live(world, ADA)
    # Sit her one aging-step above the threshold so a single idle breath fells her.
    target = PARALYSIS_ENERGY_THRESHOLD + IDLE_AGING_ENERGY_COST
    world.modify_agent_energy(ADA, -(ada.current_energy - target))
    assert _live(world, ADA).status is AgentStatus.ALIVE
    agent = Agent(ADA, world, bus, registry, MockDecider([Decision(text="I rest a while.")]), pace=0.0)

    await agent.breathe()

    assert _live(world, ADA).status is AgentStatus.PARALYZED
    paralyzed = [event for event in log.events if event.type == "agent_paralyzed"]
    assert len(paralyzed) == 1  # refresh_status announced the flip exactly once
```

Add the constants test (append to `tests/core/constants_test.py`):

```python
def test_idle_aging_cost_present_and_gentle() -> None:
    """Idle-aging is a small, positive energy cost — a fraction, not a hammer."""
    assert isinstance(constants.IDLE_AGING_ENERGY_COST, float)
    assert 0.0 < constants.IDLE_AGING_ENERGY_COST <= constants.MOVE_ENERGY_COST
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/agents/runtime_test.py -k "idle or silent or tool_breath" tests/core/constants_test.py::test_idle_aging_cost_present_and_gentle -v`
Expected: FAIL — `ImportError`/`AttributeError`: `IDLE_AGING_ENERGY_COST` does not exist; the aging tests fail (energy unchanged / no paralysis).

- [ ] **Step 3: Implement the constant and the aging hook**

Add to `core/constants.py` under the "Action energy costs" section (after `GENERIC_ACTION_ENERGY_COST`):

```python
IDLE_AGING_ENERGY_COST: Final[float] = 1.0
"""Energy an *idle* breath (no tool call — self-talk or silent rest) drains. [design —
2026-07-01, Layer 1].

Aging is the still-life fix: you cannot sit frozen forever for free. Scoped to idle
breaths ONLY (an active breath already paid its action's energy); this is NOT an
always-on metabolism. Gentle by design — from 100 energy it is ~95 idle breaths to the
paralysis threshold. A world-rule dial; retune by observation. NOTE (reviewer): aging
bites only literal idle breaths — free tool calls (harvest/look_around) never age — so do
not crank this to force dynamism; it can't."""
```

In `agents/runtime.py`, add `IDLE_AGING_ENERGY_COST` to the `from core.constants import (...)` block (alphabetically, after `DECIDE_BACKOFF_SECONDS` and before `MATING_COOLDOWN_SECONDS`):

```python
    DECIDE_BACKOFF_SECONDS,
    IDLE_AGING_ENERGY_COST,
    MATING_COOLDOWN_SECONDS,
```

In `agents/runtime.py`, `breathe()` — insert the aging hook between `await self._emit_self_talk(decision)` and the reflect gate. The block becomes:

```python
                    self._last_prompt_tokens = decision.prompt_tokens  # actual-token net
                    await self.execute(decision.tool_calls)
                    await self._emit_self_talk(decision)
                    # Aging: an *idle* breath — one that made no tool call (self-talk or
                    # silent rest) — wears the being down a little. An active breath already
                    # paid its action's energy, so it ages nothing extra. Placed here (right
                    # after _emit_self_talk, before the reflect gate) so it reuses the idle
                    # signal, not the method: mutually exclusive with execute()'s work,
                    # reflection is a sub-step so never ages, and modify_agent_energy floors
                    # at 0 and flips ALIVE->PARALYZED — announced by the trailing
                    # refresh_status (DD4: the world has no bus).
                    if not decision.tool_calls:
                        self.world.modify_agent_energy(self.agent_id, -IDLE_AGING_ENERGY_COST)
                    # breath_count is incremented in the finally below, so during
                    # the k-th (1-indexed) breath it still holds k-1; +1 makes the
                    # reflection fire on breaths N, 2N, ... and never on the first.
                    # Gate on liveness too: a tool call may have paralysed the agent
                    # mid-breath, and a frozen agent must spend no Ollama (neither the
                    # reflection decide nor the recap-authoring one).
                    if self.alive and (self.breath_count + 1) % REFLECT_EVERY_N_BREATHS == 0:
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/agents/runtime_test.py tests/core/constants_test.py -v`
Expected: PASS (all existing + new aging tests green).

- [ ] **Step 5: Commit**

```bash
git add core/constants.py agents/runtime.py tests/agents/runtime_test.py tests/core/constants_test.py
git commit -m "feat(aging): idle (no-tool) breaths cost a little energy (L1)"
```

---

## Task 2: The `Home` dataclass

**Files:**
- Create: `world/homes.py`
- Test: `tests/world/homes_test.py`

**Interfaces:**
- Consumes: nothing (leaf domain record).
- Produces:
  ```python
  @dataclass(slots=True)
  class Home:
      home_id: str
      owner_id: str
      region: str
      integrity: float
      built_at: float
      last_upkeep_at: float
  ```
  Mutable (not frozen); `owner_id` is a plain field so L2 colonize is a single field write.

- [ ] **Step 1: Write the failing test** (`tests/world/homes_test.py`)

```python
"""Tests for the :class:`world.homes.Home` domain record."""

from __future__ import annotations

from world.homes import Home


def test_home_is_constructible_and_mutable() -> None:
    """A Home holds its fields and is mutable in place (a hot-path record, not frozen)."""
    home = Home(
        home_id="home_1",
        owner_id="wanderer_001",
        region="alpha",
        integrity=100.0,
        built_at=1000.0,
        last_upkeep_at=1000.0,
    )
    assert home.home_id == "home_1"
    assert home.owner_id == "wanderer_001"
    assert home.region == "alpha"
    assert home.integrity == 100.0
    assert home.built_at == 1000.0
    assert home.last_upkeep_at == 1000.0
    # Forward-compatible with L2 colonize: owner reassignment is one field write.
    home.owner_id = "wanderer_002"
    home.integrity = 55.0
    assert home.owner_id == "wanderer_002"
    assert home.integrity == 55.0


def test_home_uses_slots() -> None:
    """slots=True: no per-instance __dict__ (small memory/access win, like the peers)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/world/homes_test.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'world.homes'`.

- [ ] **Step 3: Implement `world/homes.py`**

```python
"""Home domain model: the :class:`Home` dataclass.

``Home`` is the single record describing one built home: who owns it, where it
stands, how sound it is, and when it last drew upkeep. It is a stdlib dataclass
with ``slots=True`` for a small memory/access win on the hot path, and is
deliberately **mutable** (NOT frozen): the :class:`~world.world.WorldState`
mutates these records in place (see ``CLAUDE.md`` Section 3). All mutation goes
through :class:`~world.world.WorldState` methods, never by reaching into the fields
directly from outside the world.

Forward-compatible with Layer 2 (shared ownership, health-from-stakeholders, vault):
homes are keyed by a stable ``home_id`` with ``owner_id`` as a plain, reassignable
field, so an L2 colonize is a single field write rather than a painful re-key.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Home:
    """A private home a being has raised in a region.

    A mutable hot-path record; the :class:`~world.world.WorldState` owns and
    mutates instances in place. Not frozen by design.

    Attributes:
        home_id: Stable unique identifier (the world's map key for this home).
        owner_id: Id of the being that owns the home (reassignable — L2 colonize).
        region: Name of the region the home stands in.
        integrity: Structural soundness in ``[0.0, HOME_MAX_INTEGRITY]``; unpaid
            upkeep erodes it and the home collapses at ``<= 0.0``.
        built_at: World-clock time (seconds) the home was raised.
        last_upkeep_at: World-clock time (seconds) upkeep was last drawn; the
            world-tick accrues ``rate * (now - last_upkeep_at)`` materials from the
            owner's stock each step it can pay.
    """

    home_id: str
    owner_id: str
    region: str
    integrity: float
    built_at: float
    last_upkeep_at: float
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/world/homes_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add world/homes.py tests/world/homes_test.py
git commit -m "feat(home): add the Home dataclass (L1)"
```

---

## Task 3: `WorldState` home methods (sync, event-free)

**Files:**
- Modify: `core/constants.py` (add `HOME_MAX_INTEGRITY`)
- Modify: `world/world.py` (import `Home`; `self.homes` in `__init__`; the six methods)
- Test: `tests/world/world_test.py`, `tests/core/constants_test.py`

**Interfaces:**
- Consumes: `Home` (Task 2); `WorldState.now()`.
- Produces (all sync, in-place, emit nothing):
  - attribute `WorldState.homes: dict[str, Home]` (keyed by `home_id`)
  - `build_home(self, home_id: str, owner_id: str, region: str, *, built_at: float, integrity: float) -> bool` — creates+stores a `Home` (`last_upkeep_at` initialised to `built_at`); `False` if `home_id` already exists (no overwrite).
  - `remove_home(self, home_id: str) -> bool`
  - `modify_home_integrity(self, home_id: str, amount: float) -> bool` — clamps to `[0.0, HOME_MAX_INTEGRITY]`; `False` if unknown.
  - `home_of(self, agent_id: str) -> Home | None` — the first home owned by `agent_id` (one per being in L1).
  - `homes_in_region(self, region: str) -> list[Home]`
  - `get_all_homes(self) -> list[Home]`
  - `HOME_MAX_INTEGRITY: Final[float] = 100.0`

- [ ] **Step 1: Write the failing tests** (append to `tests/world/world_test.py`; it already imports `WorldState`, `AgentState`, `AgentStatus`, `Region`, defines `make_agent`, and uses the `world` fixture)

Add `from core.constants import HOME_MAX_INTEGRITY` to the imports, then append:

```python
# ---------------------------------------------------------------------------
# Layer 1: homes (keyed by home_id; sync, event-free)
# ---------------------------------------------------------------------------


def test_new_world_has_no_homes() -> None:
    """A fresh world starts with an empty homes map."""
    assert WorldState().get_all_homes() == []


def test_build_home_adds_a_home_keyed_by_id(world: WorldState) -> None:
    assert (
        world.build_home(
            "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
        )
        is True
    )
    home = world.homes["h1"]
    assert home.owner_id == "wanderer_001"
    assert home.region == "alpha"
    assert home.integrity == HOME_MAX_INTEGRITY
    assert home.built_at == world.now()
    assert home.last_upkeep_at == world.now()  # upkeep clock starts at build time


def test_build_home_rejects_duplicate_id(world: WorldState) -> None:
    assert world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    ) is True
    assert world.build_home(
        "h1", "wanderer_002", "beta", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    ) is False  # no overwrite
    assert world.homes["h1"].owner_id == "wanderer_001"


def test_remove_home(world: WorldState) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.remove_home("h1") is True
    assert "h1" not in world.homes
    assert world.remove_home("h1") is False  # already gone


def test_modify_home_integrity_clamps_to_range(world: WorldState) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=50.0)
    assert world.modify_home_integrity("h1", 1000.0) is True
    assert world.homes["h1"].integrity == HOME_MAX_INTEGRITY  # capped at max
    assert world.modify_home_integrity("h1", -1000.0) is True
    assert world.homes["h1"].integrity == 0.0  # floored at 0
    assert world.modify_home_integrity("missing", 1.0) is False  # unknown home


def test_home_of_finds_the_owners_home(world: WorldState) -> None:
    assert world.home_of("wanderer_001") is None  # none yet
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    home = world.home_of("wanderer_001")
    assert home is not None and home.home_id == "h1"
    assert world.home_of("wanderer_002") is None  # not this being's home


def test_homes_in_region_lists_all_homes_there(world: WorldState) -> None:
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.build_home(
        "h2", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert {h.home_id for h in world.homes_in_region("alpha")} == {"h1", "h2"}
    assert world.homes_in_region("beta") == []


def test_get_all_homes(world: WorldState) -> None:
    assert world.get_all_homes() == []
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert [h.home_id for h in world.get_all_homes()] == ["h1"]
```

Add the constants test (append to `tests/core/constants_test.py`):

```python
def test_home_integrity_dial_present() -> None:
    """The home integrity ceiling exists and is a positive float."""
    assert isinstance(constants.HOME_MAX_INTEGRITY, float)
    assert constants.HOME_MAX_INTEGRITY > 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/world_test.py -k home tests/core/constants_test.py::test_home_integrity_dial_present -v`
Expected: FAIL — `AttributeError`: `WorldState` has no `build_home`/`homes`; `HOME_MAX_INTEGRITY` undefined.

- [ ] **Step 3: Implement the constant and the methods**

Add to `core/constants.py` (a new "Homes (Layer 1)" section after the corpse-decay block):

```python
# ---------------------------------------------------------------------------
# Homes (Layer 1) — build/hearth/upkeep/decay dials
# [design: docs/superpowers/specs/2026-07-01-materials-home-layer1-design.md]
# Game-of-Life dials: first-guess values, tuned by observation. Stability: the
# hearth must not be a strictly-dominant fountain, build cost competes with mating,
# and a home must weather far more than one breath-gap before it collapses.
# ---------------------------------------------------------------------------

HOME_MAX_INTEGRITY: Final[float] = 100.0
"""Upper bound on a home's integrity; a paid tick restores it to this cap. [design —
2026-07-01, Layer 1]."""
```

In `world/world.py`: add `from .homes import Home` to the `from .agents ...` / `from .regions ...` import group, and `from core.constants import HOME_MAX_INTEGRITY` to the `from core.constants import PARALYSIS_ENERGY_THRESHOLD` line (make it a two-name import). In `__init__`, after `self.pending_proposal_targets: dict[str, list[str]] = {}`:

```python
        self.homes: dict[str, Home] = {}
```

Add a `# ---- Home methods ----` section (place it after the Region methods, before/after is fine):

```python
    # ---- Home methods ----

    def build_home(
        self, home_id: str, owner_id: str, region: str, *, built_at: float, integrity: float
    ) -> bool:
        """Create and store a home keyed by ``home_id``.

        Sync and event-free (the world has no bus, DD4): the caller (the
        ``build_home`` tool) publishes ``home_built``. ``last_upkeep_at`` is seeded to
        ``built_at`` so the world-tick's time-based upkeep accrues from the moment of
        building. Mutates :attr:`homes`.

        Args:
            home_id: Stable unique id (also the map key).
            owner_id: Id of the owning being.
            region: Region the home stands in.
            built_at: World-clock time (seconds) it was raised.
            integrity: Initial integrity (typically :data:`HOME_MAX_INTEGRITY`).

        Returns:
            ``True`` if stored; ``False`` if a home with ``home_id`` already exists
            (no overwrite).
        """
        if home_id in self.homes:
            return False
        self.homes[home_id] = Home(
            home_id=home_id,
            owner_id=owner_id,
            region=region,
            integrity=integrity,
            built_at=built_at,
            last_upkeep_at=built_at,
        )
        return True

    def remove_home(self, home_id: str) -> bool:
        """Remove a home from the world. Mutates :attr:`homes`.

        Args:
            home_id: Id of the home to remove.

        Returns:
            ``True`` if it existed and was removed; ``False`` otherwise.
        """
        if home_id in self.homes:
            del self.homes[home_id]
            return True
        return False

    def modify_home_integrity(self, home_id: str, amount: float) -> bool:
        """Add ``amount`` to a home's integrity, clamped to ``[0.0, HOME_MAX_INTEGRITY]``.

        Mirrors :meth:`modify_region_energy`'s clamp discipline (homes are bounded
        above as well as below). Mutates the home's
        :attr:`~world.homes.Home.integrity`.

        Args:
            home_id: Id of the home to modify.
            amount: Signed delta to apply.

        Returns:
            ``True`` if the home exists and was modified; ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.integrity = min(max(home.integrity + amount, 0.0), HOME_MAX_INTEGRITY)
        return True

    def home_of(self, agent_id: str) -> Home | None:
        """Return the home owned by ``agent_id`` (one per being in L1), or ``None``.

        Homes are rare, so a linear scan is free. In L1 a being owns at most one
        home; the first match is returned.

        Args:
            agent_id: Id of the owning being to look up.

        Returns:
            The owned :class:`~world.homes.Home`, or ``None`` if it owns none.
        """
        for home in self.homes.values():
            if home.owner_id == agent_id:
                return home
        return None

    def homes_in_region(self, region: str) -> list[Home]:
        """Return every home standing in ``region`` (empty if none).

        Args:
            region: Region name to filter by.

        Returns:
            A list of homes whose ``region`` matches (a region may hold several,
            one per building being).
        """
        return [home for home in self.homes.values() if home.region == region]

    def get_all_homes(self) -> list[Home]:
        """Return every home as a list.

        Returns:
            A new list of all :class:`~world.homes.Home` instances.
        """
        return list(self.homes.values())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/world_test.py tests/core/constants_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/world.py tests/world/world_test.py tests/core/constants_test.py
git commit -m "feat(home): WorldState home methods keyed by home_id (L1)"
```

---

## Task 4: World-tick upkeep/decay/collapse sweep

A fourth sweep in `tick()` after corpse-decay, following the identical snapshot-then-mutate + deferred-publish pattern. Upkeep is **time-based** (`owed = rate * (now - last_upkeep_at)`, tick-frequency-independent). Decay advances **only when the owner cannot pay** (broke, dead, or swept — missing/`DEAD` owners cannot pay).

**Files:**
- Modify: `core/constants.py` (add `HOME_UPKEEP_MATERIALS_PER_SECOND`, `HOME_DECAY_PER_MISSED_TICK`)
- Modify: `world/tick.py` (module docstring, `tick()` docstring, the new sweep + merged publish)
- Test: `tests/world/tick_test.py`, `tests/core/constants_test.py`

**Interfaces:**
- Consumes: `WorldState.get_all_homes()`, `get_agent(id)`, `modify_agent_materials(id, amount)` (no-ops for `DEAD`/missing, returns `False`), `modify_home_integrity(home_id, amount)`, `remove_home(home_id)`; `Home.{home_id, owner_id, region, integrity, last_upkeep_at}`; `AgentStatus`; `Event`/`ScopeType.LOCAL`; `world.now()`; `HOME_MAX_INTEGRITY`.
- Produces: `HOME_UPKEEP_MATERIALS_PER_SECOND: Final[float] = 0.1`; `HOME_DECAY_PER_MISSED_TICK: Final[float] = 10.0`. Tick behaviour: each home, `owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - home.last_upkeep_at)`; if the owner exists, is not `DEAD`, and holds `>= owed` materials → deduct `owed`, restore integrity to `HOME_MAX_INTEGRITY`, set `last_upkeep_at = now`; else → decrement integrity by `HOME_DECAY_PER_MISSED_TICK` and, at `integrity <= 0.0`, `remove_home` + publish a LOCAL `home_collapsed` (source = `owner_id`, region = the home's region, stamped `now`). New event type: `home_collapsed`.

- [ ] **Step 1: Write the failing tests** (append to `tests/world/tick_test.py`)

Add to that file's imports:
```python
from core.constants import (
    CORPSE_DECAY_SECONDS,
    HOME_DECAY_PER_MISSED_TICK,
    HOME_MAX_INTEGRITY,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
)
from core.rng import make_rng
from tests.conftest import SEED, FakeClock
from world.regions import Region, ResourceTypes
```
(the existing `from core.constants import CORPSE_DECAY_SECONDS, MATING_PROPOSAL_TIMEOUT_SECONDS`, `from tests.conftest import FakeClock`, and `from world.regions import ResourceTypes` lines are replaced/extended as above). Then append:

```python
# ---- Home upkeep / decay / collapse sweep ---------------------------------


def _world_with_home(owner_materials: float) -> tuple[WorldState, EventBus, FakeClock]:
    """A one-region world with a single owner who already owns a home.

    The region has zero regen so only home-upkeep touches the owner's materials,
    isolating the upkeep draw for the frequency-independence assertion.
    """
    clock = FakeClock()
    region = Region(
        name="alpha",
        description="A field.",
        connections=[],
        energy_rate=0.0,
        materials_rate=0.0,
        current_energy=0.0,
        current_materials=0.0,
        max_energy=500.0,
        max_materials=500.0,
    )
    owner = AgentState(
        id="owner_1",
        name="Owner",
        persona="p",
        current_position="alpha",
        current_energy=100.0,
        current_materials=owner_materials,
        status=AgentStatus.ALIVE,
    )
    world = WorldState([region], [owner], rng=make_rng(SEED), clock=clock)
    bus = EventBus(world)
    bus.subscribe("owner_1")
    world.build_home(
        "home_1", "owner_1", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    return world, bus, clock


async def test_tick_paid_upkeep_draws_materials_and_restores_integrity(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A payable tick draws time-based upkeep from the owner and restores integrity."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.modify_home_integrity("home_ada", -40.0)  # a worn home: 100 -> 60
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    mats_before = ada.current_materials
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.home_of("wanderer_001")
    assert home is not None
    assert home.integrity == HOME_MAX_INTEGRITY  # a fed home is restored to sound
    assert ada.current_materials == pytest.approx(
        mats_before - HOME_UPKEEP_MATERIALS_PER_SECOND * 10.0
    )
    assert home.last_upkeep_at == world.now()


async def test_tick_unpaid_upkeep_decays_integrity(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A broke owner cannot pay, so nothing is drawn and the home decays one step."""
    world.build_home(
        "home_boris", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_materials("wanderer_002", -boris.current_materials)  # broke: 0 materials
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.home_of("wanderer_002")
    assert home is not None
    assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_MISSED_TICK
    assert boris.current_materials == 0.0  # nothing drawn from a broke owner


async def test_tick_dead_owner_cannot_pay_decays_and_collapses(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A DEAD owner cannot pay; a home worn to one step from ruin collapses and announces it."""
    world.build_home(
        "home_boris", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    # Wear it to exactly one missed-tick from collapse.
    world.modify_home_integrity("home_boris", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_MISSED_TICK))
    world.kill_agent("wanderer_002")  # owner DEAD -> cannot pay
    event_bus.get_events("wanderer_001")  # drain the co-located witness's inbox
    fake_clock.advance(1.0)

    await tick(world, event_bus)

    assert world.home_of("wanderer_002") is None  # collapsed and removed
    collapsed = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(collapsed) == 1
    assert collapsed[0].scope is ScopeType.LOCAL
    assert collapsed[0].region == "alpha"
    assert collapsed[0].source == "wanderer_002"
    assert collapsed[0].timestamp == world.now()


async def test_tick_swept_owner_missing_decays_and_collapses(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A swept (removed-from-world) owner cannot pay; the home decays to collapse."""
    world.build_home(
        "home_boris",
        "wanderer_002",
        "alpha",
        built_at=world.now(),
        integrity=HOME_DECAY_PER_MISSED_TICK,  # one missed tick from ruin
    )
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    assert world.remove_agent(boris) is True  # corpse fully decayed away earlier
    assert world.get_agent("wanderer_002") is None
    event_bus.get_events("wanderer_001")
    fake_clock.advance(1.0)

    await tick(world, event_bus)

    assert world.home_of("wanderer_002") is None
    collapsed = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(collapsed) == 1


async def test_tick_home_collapse_fires_once(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Collapse is announced exactly once — the removed home cannot re-collapse next tick."""
    world.build_home(
        "home_boris",
        "wanderer_002",
        "alpha",
        built_at=world.now(),
        integrity=HOME_DECAY_PER_MISSED_TICK,
    )
    world.kill_agent("wanderer_002")

    fake_clock.advance(1.0)
    await tick(world, event_bus)
    first = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert len(first) == 1

    fake_clock.advance(1.0)
    await tick(world, event_bus)
    second = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_collapsed"]
    assert second == []
    assert world.home_of("wanderer_002") is None


async def test_tick_home_upkeep_is_frequency_independent() -> None:
    """The same wall-time draws the same upkeep regardless of tick cadence."""
    world_a, bus_a, clock_a = _world_with_home(100.0)
    world_b, bus_b, clock_b = _world_with_home(100.0)

    clock_a.advance(10.0)  # A: one tick after 10 seconds
    await tick(world_a, bus_a)

    for _ in range(10):  # B: ten one-second ticks over the same 10 seconds
        clock_b.advance(1.0)
        await tick(world_b, bus_b)

    owner_a = world_a.get_agent("owner_1")
    owner_b = world_b.get_agent("owner_1")
    assert owner_a is not None and owner_b is not None
    assert owner_a.current_materials == pytest.approx(owner_b.current_materials)
    assert owner_a.current_materials == pytest.approx(
        100.0 - HOME_UPKEEP_MATERIALS_PER_SECOND * 10.0
    )
```

Add the constants test (append to `tests/core/constants_test.py`):

```python
def test_home_upkeep_and_decay_dials_present_and_sane() -> None:
    """Upkeep/decay dials exist; a home weathers many missed ticks before it collapses."""
    assert isinstance(constants.HOME_UPKEEP_MATERIALS_PER_SECOND, float)
    assert constants.HOME_UPKEEP_MATERIALS_PER_SECOND > 0.0
    assert isinstance(constants.HOME_DECAY_PER_MISSED_TICK, float)
    assert 0.0 < constants.HOME_DECAY_PER_MISSED_TICK <= constants.HOME_MAX_INTEGRITY
    # Collapse-when-broke must be far slower than the owner's breath gap (the mating
    # 60s->600s lesson): a home must not crumble between an owner's breaths.
    assert constants.HOME_MAX_INTEGRITY / constants.HOME_DECAY_PER_MISSED_TICK >= 5.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/tick_test.py -k "home or upkeep or collapse or swept or dead" tests/core/constants_test.py::test_home_upkeep_and_decay_dials_present_and_sane -v`
Expected: FAIL — `HOME_UPKEEP_MATERIALS_PER_SECOND`/`HOME_DECAY_PER_MISSED_TICK` undefined; tick performs no home sweep.

- [ ] **Step 3: Implement the constants and the sweep**

Add to `core/constants.py` in the "Homes (Layer 1)" section (after `HOME_MAX_INTEGRITY`):

```python
HOME_UPKEEP_MATERIALS_PER_SECOND: Final[float] = 0.1
"""Materials a home draws from its owner's global stock per second, on the world-tick.
[design — 2026-07-01, Layer 1].

TIME-based (``owed = rate * (now - last_upkeep_at)``), so upkeep is tick-frequency-
INDEPENDENT — the same wall-time draws the same materials whether the tick runs every
1s or every 5s (generalizes the mating 60s->600s lesson). Drawn from stockpile so an
absent/slow owner still pays — no death-spiral (upkeep is materials, never energy)."""

HOME_DECAY_PER_MISSED_TICK: Final[float] = 10.0
"""Integrity a home loses on a world-tick its owner cannot pay upkeep (broke, dead, or
swept). [design — 2026-07-01, Layer 1].

With :data:`HOME_MAX_INTEGRITY` = 100, a home weathers ~10 unpaid ticks before it
collapses — deliberately far longer than an owner's breath gap so it never crumbles
between breaths through no fault of its own. Retune upward if a slow sequential (Ollama)
regime is revived, exactly like ``MATING_PROPOSAL_TIMEOUT_SECONDS``."""
```

In `world/tick.py`:
- Extend the import: `from core.constants import (CORPSE_DECAY_SECONDS, HOME_DECAY_PER_MISSED_TICK, HOME_MAX_INTEGRITY, HOME_UPKEEP_MATERIALS_PER_SECOND, MATING_PROPOSAL_TIMEOUT_SECONDS)`.
- Add a module-docstring bullet after the corpse bullet (`#4. Sweep home upkeep/decay — each home draws time-based upkeep from its owner's global materials stock; a home whose owner cannot pay decays, and collapses (removed + a LOCAL agent_paralyzed-style announcement) at integrity <= 0.`).
- Extend `tick()`'s docstring `Mutates world state:` and `Emits events:` sections to mention the home sweep and the `home_collapsed` LOCAL event.
- Insert the sweep after the corpse-decay `for` loop (after `decay_events` is fully populated) and before the final publish loop, then merge `collapse_events` into that publish:

```python
    # Sweep home upkeep/decay. Each home draws TIME-based upkeep from its owner's global
    # materials stock (tick-frequency-independent: owed = rate * elapsed). A home whose
    # owner cannot pay — broke, DEAD, or swept from the world (modify_agent_materials
    # no-ops for DEAD/missing, so the tick checks affordability itself and never assumes
    # payment) — loses integrity, and at <= 0 collapses: removed and its passing announced
    # LOCALLY. Same snapshot-then-mutate discipline: mutate synchronously, defer the publish.
    collapse_events: list[Event] = []
    for home in list(world.get_all_homes()):
        owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - home.last_upkeep_at)
        owner = world.get_agent(home.owner_id)
        can_pay = (
            owner is not None
            and owner.status is not AgentStatus.DEAD
            and owner.current_materials >= owed
        )
        if can_pay:
            world.modify_agent_materials(home.owner_id, -owed)
            world.modify_home_integrity(home.home_id, HOME_MAX_INTEGRITY)  # a fed home stays sound
            home.last_upkeep_at = now
        else:
            world.modify_home_integrity(home.home_id, -HOME_DECAY_PER_MISSED_TICK)
            if home.integrity <= 0.0:
                region = home.region
                world.remove_home(home.home_id)
                collapse_events.append(
                    Event(
                        type="home_collapsed",
                        source=home.owner_id,
                        payload={"message": f"A home in {region} has crumbled to nothing."},
                        scope=ScopeType.LOCAL,
                        region=region,
                        timestamp=now,
                    )
                )

    # All refunds/removals are done; publishing (the only ``await``) is safe now.
    for event in (*timed_out_events, *decay_events, *collapse_events):
        await event_bus.publish(event)
```

(Delete the pre-existing final publish loop `for event in (*timed_out_events, *decay_events):` — it is replaced by the merged one above.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/tick_test.py tests/core/constants_test.py -v`
Expected: PASS (existing regen/proposal/corpse tests plus the new home tests).

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/tick.py tests/world/tick_test.py tests/core/constants_test.py
git commit -m "feat(home): world-tick upkeep/decay/collapse sweep (L1)"
```

---

## Task 5: The `build_home` tool

**Files:**
- Modify: `core/constants.py` (add `HOME_BUILD_MATERIALS_COST`)
- Create: `tools/builtin/homes.py` (the `build_home` tool)
- Modify: `tools/builtin/__init__.py` (register in `BUILTIN_TOOLS` + `__all__`)
- Modify: `agents/tool_schemas.py` (add the `build_home` schema)
- Test: `tests/tools/homes_test.py`, `tests/core/constants_test.py` (parity is covered by the existing `tests/agents/tool_schemas_test.py`)

**Interfaces:**
- Consumes: `WorldState.{get_agent, home_of, modify_agent_materials, build_home, now, rng}`; `HOME_BUILD_MATERIALS_COST`, `HOME_MAX_INTEGRITY`; `Event`/`ScopeType.LOCAL`.
- Produces: `async def build_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str` (no model params). Deducts `HOME_BUILD_MATERIALS_COST` materials, mints `home_id = f"home_{world.rng.getrandbits(32):08x}"`, stores the home at the being's `current_position` with `integrity=HOME_MAX_INTEGRITY`, publishes LOCAL `home_built` (source = builder, region = current position). `"Invalid: "` if already owns a home or lacks materials (no mutation). `HOME_BUILD_MATERIALS_COST: Final[float] = 80.0`. New event type: `home_built`. Success string starts `"You raise a home here."`.

- [ ] **Step 1: Write the failing tests** (`tests/tools/homes_test.py`)

```python
"""Tests for :mod:`tools.builtin.homes` — ``build_home`` and ``use_hearth``.

``build_home`` sinks materials to raise a private home in the being's region and
emits ``home_built``. ``use_hearth`` burns materials at the being's own home for
energy (a conversion, never a mint) and emits ``hearth_used``. Both report
lookup/precondition failures with ``Error:`` and rule violations with ``Invalid:``.
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import ScopeType
from core.constants import (
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.homes import build_home
from world.agents import is_hoarding
from world.world import WorldState

# ---- build_home -----------------------------------------------------------


async def test_build_home_creates_home_deducts_materials_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST + 10.0

    result = await build_home(world, event_bus, "wanderer_001")

    home = world.home_of("wanderer_001")
    assert home is not None
    assert home.region == "alpha"  # built where the being stands
    assert home.integrity == HOME_MAX_INTEGRITY
    assert ada.current_materials == 10.0  # cost deducted
    built = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_built"]
    assert len(built) == 1
    assert built[0].scope is ScopeType.LOCAL
    assert built[0].region == "alpha"
    assert built[0].source == "wanderer_001"
    assert built[0].timestamp == world.now()
    assert result.startswith("You raise a home here.")


async def test_build_home_insufficient_materials_is_invalid_no_mutation(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST - 1.0

    result = await build_home(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert world.home_of("wanderer_001") is None  # nothing built
    assert ada.current_materials == HOME_BUILD_MATERIALS_COST - 1.0  # nothing spent
    assert event_bus.get_events("wanderer_001") == []  # no event


async def test_build_home_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot build (defensive: the registry also guards this)."""
    result = await build_home(world, event_bus, "ghost")
    assert result.startswith("Error:")
    assert world.get_all_homes() == []


async def test_build_home_when_already_owning_one_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOME_BUILD_MATERIALS_COST * 3
    assert (await build_home(world, event_bus, "wanderer_001")).startswith("You raise a home here.")
    event_bus.get_events("wanderer_001")  # drain
    mats_after_first = ada.current_materials

    result = await build_home(world, event_bus, "wanderer_001")  # second attempt

    assert result.startswith("Invalid:")
    assert len(world.get_all_homes()) == 1  # still just the one
    assert ada.current_materials == mats_after_first  # no extra cost
    assert event_bus.get_events("wanderer_001") == []


async def test_build_home_recomputes_is_hoarding(world: WorldState, event_bus: EventBus) -> None:
    """Sinking materials into a home can drop a being out of hoarding (is_hoarding recomputed)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOARDING_MATERIALS_THRESHOLD  # exactly hoarding on materials
    assert is_hoarding(ada) is True

    await build_home(world, event_bus, "wanderer_001")

    assert ada.current_materials == HOARDING_MATERIALS_THRESHOLD - HOME_BUILD_MATERIALS_COST
    assert is_hoarding(ada) is False  # the build sank enough materials to end the hoard
```

Add the constants test (append to `tests/core/constants_test.py`):

```python
def test_home_build_cost_competes_with_mating() -> None:
    """Build cost is biased high and competes with mating for the same scarce materials."""
    assert isinstance(constants.HOME_BUILD_MATERIALS_COST, float)
    assert constants.HOME_BUILD_MATERIALS_COST >= constants.MATING_MIN_MATERIALS_CONTRIBUTION
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py tests/core/constants_test.py::test_home_build_cost_competes_with_mating -v`
Expected: FAIL — `ModuleNotFoundError: tools.builtin.homes`; `HOME_BUILD_MATERIALS_COST` undefined.

- [ ] **Step 3: Implement the constant, the tool, and the registrations**

Add to `core/constants.py` in the "Homes (Layer 1)" section (after the upkeep/decay dials):

```python
HOME_BUILD_MATERIALS_COST: Final[float] = 80.0
"""Materials to raise a home. [design — 2026-07-01, Layer 1].

Biased HIGH so homes are rare and precious, and it competes with mating (min 30
materials) for the same scarce stock — a nest-vs-child tension. A world-rule dial."""
```

Create `tools/builtin/homes.py`:

```python
"""Home tools: ``build_home`` (raise a private home) and ``use_hearth`` (burn
materials for energy at your home).

Tool functions follow the uniform Vivarium closure signature
``async def tool(world, event_bus, agent_id, **params) -> str`` and return a
natural-language result string for the acting being's LLM (a success sentence,
``"Error: "`` for a lookup/precondition failure, ``"Invalid: "`` for a rule
violation). Home ids route through ``world.rng`` so a run is reproducible from a
seed. All world mutation goes through :class:`~world.world.WorldState` methods; the
tool only orchestrates and publishes the LOCAL event (the world holds no bus, DD4).
"""

from __future__ import annotations

from bus.event_bus import EventBus
from bus.events import Event, ScopeType
from core.constants import HOME_BUILD_MATERIALS_COST, HOME_MAX_INTEGRITY
from world.world import WorldState


async def build_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Raise a private home for the being in its current region.

    Mutates world state:
        * Deducts :data:`~core.constants.HOME_BUILD_MATERIALS_COST` from the being's
          materials, then stores a new home (owned by the being, at its current
          region, integrity :data:`~core.constants.HOME_MAX_INTEGRITY`) via
          :meth:`~world.world.WorldState.build_home`. The home id routes through
          ``world.rng`` so it is reproducible from the seed.

    Emits events:
        * One ``"home_built"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the builder, region = its current position, stamped ``world.now()``) so
          co-located beings perceive the new home.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the building being.

    Returns:
        A success sentence with the materials left; an ``"Error: "`` string if the
        being is unknown; an ``"Invalid: "`` string if it already owns a home or
        lacks the materials (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if world.home_of(agent_id) is not None:
        return "Invalid: You already have a home; you may hold only one."
    if agent.current_materials < HOME_BUILD_MATERIALS_COST:
        return (
            f"Invalid: You lack the materials to build a home "
            f"(need {HOME_BUILD_MATERIALS_COST:.0f}, you have {agent.current_materials})."
        )

    world.modify_agent_materials(agent_id, -HOME_BUILD_MATERIALS_COST)
    home_id = f"home_{world.rng.getrandbits(32):08x}"
    region = agent.current_position
    world.build_home(home_id, agent_id, region, built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    await event_bus.publish(
        Event(
            "home_built",
            agent_id,
            {"message": f"{agent.name} has raised a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return (
        f"You raise a home here. It cost you {HOME_BUILD_MATERIALS_COST:.0f} materials; "
        f"you have {agent.current_materials} left."
    )
```

In `tools/builtin/__init__.py`: add `build_home` to the imports, `__all__`, and `BUILTIN_TOOLS`:

```python
from tools.builtin.homes import build_home
```
```python
__all__ = [
    "BUILTIN_TOOLS",
    "accept_mating",
    "attack",
    "build_home",
    "harvest_resources",
    "initiate_mating",
    "look_around",
    "move",
    "register_builtins",
    "reject_mating",
    "speak",
    "transfer_resource",
]
```
```python
BUILTIN_TOOLS: dict[str, ToolFn] = {
    "attack": attack,
    "speak": speak,
    "move": move,
    "look_around": look_around,
    "harvest_resources": harvest_resources,
    "transfer_resource": transfer_resource,
    "initiate_mating": initiate_mating,
    "reject_mating": reject_mating,
    "accept_mating": accept_mating,
    "build_home": build_home,
}
```

In `agents/tool_schemas.py`: add `HOME_BUILD_MATERIALS_COST` to the `from core.constants import (...)` block, and add the schema entry to `TOOL_SCHEMAS` (keeps `set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)`):

```python
    "build_home": {
        "type": "function",
        "function": {
            "name": "build_home",
            "description": (
                "Raise a home of your own where you stand. It costs "
                f"{HOME_BUILD_MATERIALS_COST:.0f} materials, and you may hold only one home."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py tests/agents/tool_schemas_test.py tests/core/constants_test.py -v`
Expected: PASS (including `test_schema_set_matches_builtin_tools` and `test_every_schema_is_well_formed`).

- [ ] **Step 5: Commit**

```bash
git add core/constants.py tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py tests/core/constants_test.py
git commit -m "feat(home): build_home tool (L1)"
```

---

## Task 6: The `use_hearth` tool (materials → energy, conservation)

**Files:**
- Modify: `core/constants.py` (add `HEARTH_MATERIALS_PER_USE`, `HEARTH_ENERGY_PER_MATERIAL`)
- Modify: `tools/builtin/homes.py` (add `use_hearth`; extend imports)
- Modify: `tools/builtin/__init__.py` (register in `BUILTIN_TOOLS` + `__all__`)
- Modify: `agents/tool_schemas.py` (add the `use_hearth` schema)
- Test: `tests/tools/homes_test.py`, `tests/core/constants_test.py`

**Interfaces:**
- Consumes: `WorldState.{get_agent, home_of, modify_agent_materials, modify_agent_energy, now}`; `Home.region`; `AgentStatus`; `HEARTH_MATERIALS_PER_USE`, `HEARTH_ENERGY_PER_MATERIAL`; `Event`/`ScopeType.LOCAL`.
- Produces: `async def use_hearth(world: WorldState, event_bus: EventBus, agent_id: str) -> str` (no model params). Recipe (conservation): `burned = min(agent.current_materials, HEARTH_MATERIALS_PER_USE)`; `modify_agent_materials(-burned)` **then** `modify_agent_energy(+burned * HEARTH_ENERGY_PER_MATERIAL)`. Defensive ALIVE guard (paralysis stays social). `"Error: "` if no home; `"Invalid: "` if not ALIVE, not at the home's region, or no materials to burn. Publishes LOCAL `hearth_used`. `HEARTH_MATERIALS_PER_USE: Final[float] = 20.0`; `HEARTH_ENERGY_PER_MATERIAL: Final[float] = 1.0`. New event type: `hearth_used`. Success string starts `"You rest at your hearth"`.

- [ ] **Step 1: Write the failing tests** (append to `tests/tools/homes_test.py`)

Extend the imports at the top of the file:
```python
from core.constants import (
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOARDING_MATERIALS_THRESHOLD,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from tools.builtin.homes import build_home, use_hearth
from world.agents import AgentStatus, is_hoarding
```
Then append:

```python
# ---- use_hearth -----------------------------------------------------------


async def test_use_hearth_converts_materials_to_energy_at_own_home(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 50.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    burned = HEARTH_MATERIALS_PER_USE  # 50 > 20 -> burns the per-use cap
    assert ada.current_materials == 50.0 - burned
    assert ada.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    used = [e for e in event_bus.get_events("wanderer_001") if e.type == "hearth_used"]
    assert len(used) == 1
    assert used[0].scope is ScopeType.LOCAL
    assert used[0].region == "alpha"
    assert used[0].timestamp == world.now()
    assert result.startswith("You rest at your hearth")


async def test_use_hearth_partial_burn_conserves_exactly(
    world: WorldState, event_bus: EventBus
) -> None:
    """Fewer materials than the cap burns exactly what's held; energy gained == burned * rate."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 12.0  # < HEARTH_MATERIALS_PER_USE
    ada.current_energy = 40.0

    await use_hearth(world, event_bus, "wanderer_001")

    burned = 12.0
    assert ada.current_materials == 0.0  # all fuel consumed
    assert ada.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    # Conservation: the energy gained is exactly the materials destroyed * rate — no mint.
    assert (ada.current_energy - 40.0) == burned * HEARTH_ENERGY_PER_MATERIAL


async def test_use_hearth_not_at_home_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.move_agent("wanderer_001", "beta") is True  # walk away from the home
    ada.current_materials = 50.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0 and ada.current_energy == 40.0  # nothing converted


async def test_use_hearth_without_a_home_is_error(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 50.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Error:")
    assert ada.current_materials == 50.0


async def test_use_hearth_unknown_agent_is_error(world: WorldState, event_bus: EventBus) -> None:
    """A missing being cannot use a hearth (defensive: the registry also guards this)."""
    result = await use_hearth(world, event_bus, "ghost")
    assert result.startswith("Error:")


async def test_use_hearth_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """Paralysis stays social: a fallen being cannot self-revive at its own hearth."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 50.0
    world.modify_agent_energy("wanderer_001", -(ada.current_energy - 1.0))  # -> PARALYZED
    assert ada.status is AgentStatus.PARALYZED

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0  # no conversion
    assert ada.status is AgentStatus.PARALYZED  # still fallen; only a friend can revive


async def test_use_hearth_with_no_materials_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 0.0
    ada.current_energy = 40.0

    result = await use_hearth(world, event_bus, "wanderer_001")

    assert result.startswith("Invalid:")
    assert ada.current_energy == 40.0  # no energy minted from nothing
```

Add the constants test (append to `tests/core/constants_test.py`):

```python
def test_hearth_dials_present_and_convert_without_minting() -> None:
    """Hearth dials exist; a finite per-material rate converts a real stock, never mints."""
    assert isinstance(constants.HEARTH_MATERIALS_PER_USE, float)
    assert constants.HEARTH_MATERIALS_PER_USE > 0.0
    assert isinstance(constants.HEARTH_ENERGY_PER_MATERIAL, float)
    assert constants.HEARTH_ENERGY_PER_MATERIAL > 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k hearth tests/core/constants_test.py::test_hearth_dials_present_and_convert_without_minting -v`
Expected: FAIL — `ImportError`: `use_hearth` not defined; hearth constants undefined.

- [ ] **Step 3: Implement the constants, the tool, and the registrations**

Add to `core/constants.py` in the "Homes (Layer 1)" section (after `HOME_BUILD_MATERIALS_COST`):

```python
HEARTH_MATERIALS_PER_USE: Final[float] = 20.0
"""Maximum materials a single ``use_hearth`` burns. [design — 2026-07-01, Layer 1]."""

HEARTH_ENERGY_PER_MATERIAL: Final[float] = 1.0
"""Energy produced per material burned at a hearth (the conversion rate). [design —
2026-07-01, Layer 1].

The hearth CONVERTS a real, harvested/upkept stock (materials) into energy — it never
mints energy from nothing: ``energy_gained = burned * this`` and the materials are
destroyed first. Keep it <= a sustainable rate; lower it below 1.0 to burn some fuel as
heat (mirroring how mating burns some of the committed resources). A world-rule dial."""
```

In `tools/builtin/homes.py`, extend the imports and add `use_hearth`:

```python
from core.constants import (
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
from world.agents import AgentStatus
```
(the `from core.constants import HOME_BUILD_MATERIALS_COST, HOME_MAX_INTEGRITY` line is replaced by the grouped import above; add the `from world.agents import AgentStatus` line.) Then append the function:

```python
async def use_hearth(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Rest at the being's own hearth, burning materials to recover energy.

    An active, elected act (a tool) — NOT passive rest — so it does not age the breath
    and only an ALIVE being can choose it (paralysis stays social: a fallen being still
    needs a friend's ``transfer_resource``, never a self-revive at the hearth).

    Recipe (conservation): ``burned = min(materials, HEARTH_MATERIALS_PER_USE)``; the
    materials are DESTROYED first, then the energy they convert to is credited
    (``burned * HEARTH_ENERGY_PER_MATERIAL``), so energy is only ever minted from fuel
    actually consumed.

    Mutates world state:
        * Deducts ``burned`` from the being's materials, then adds
          ``burned * HEARTH_ENERGY_PER_MATERIAL`` to its energy (both via the world's
          flooring methods).

    Emits events:
        * One ``"hearth_used"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the being, region = its current position, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the being resting at its hearth.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being
        is unknown or owns no home; an ``"Invalid: "`` string if it is fallen, not
        where its home stands, or holds no materials to burn (rejected calls mutate
        nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return "Invalid: You are fallen and cannot rest at a hearth; only another being can restore you."
    home = world.home_of(agent_id)
    if home is None:
        return "Error: You have no home here to rest in."
    if home.region != agent.current_position:
        return "Invalid: You are not where your home stands; you can rest at its hearth only there."
    if agent.current_materials <= 0.0:
        return "Invalid: You have no materials to burn at the hearth."

    burned = min(agent.current_materials, HEARTH_MATERIALS_PER_USE)
    world.modify_agent_materials(agent_id, -burned)  # destroy the fuel FIRST (conservation)
    gained = burned * HEARTH_ENERGY_PER_MATERIAL
    world.modify_agent_energy(agent_id, gained)  # THEN credit the energy it converts to
    region = agent.current_position
    await event_bus.publish(
        Event(
            "hearth_used",
            agent_id,
            {"message": f"{agent.name} rests at the hearth, kindling materials into warmth."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return (
        f"You rest at your hearth, burning {burned} materials for {gained} energy. "
        f"Energy: {agent.current_energy}, Materials: {agent.current_materials}."
    )
```

In `tools/builtin/__init__.py`: add `use_hearth`:

```python
from tools.builtin.homes import build_home, use_hearth
```
Add `"use_hearth",` to `__all__` (keep it alphabetically ordered — after `"transfer_resource"`), and add `"use_hearth": use_hearth,` to `BUILTIN_TOOLS`.

In `agents/tool_schemas.py`: add `HEARTH_MATERIALS_PER_USE` to the `from core.constants import (...)` block, and add the schema:

```python
    "use_hearth": {
        "type": "function",
        "function": {
            "name": "use_hearth",
            "description": (
                "Rest at your home's hearth, burning up to "
                f"{HEARTH_MATERIALS_PER_USE:.0f} of your materials to recover energy. "
                "You must be where your home stands."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py tests/agents/tool_schemas_test.py tests/core/constants_test.py -v`
Expected: PASS (parity holds with both new tools in both maps).

- [ ] **Step 5: Commit**

```bash
git add core/constants.py tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py tests/core/constants_test.py
git commit -m "feat(home): use_hearth tool converts materials to energy (L1)"
```

---

## Task 7: `WORLD_MECHANICS` prose (DD9)

Teach the new physics in-world: idling wears you down; you can raise a home, rest at its hearth to turn materials into energy, and must keep feeding it materials or it crumbles. No goals/strategy/simulation language.

**Files:**
- Modify: `agents/prompt.py` (`WORLD_MECHANICS`)
- Test: `tests/agents/prompt_test.py`

**Interfaces:**
- Consumes: `build_system_prompt(persona, tool_names)`, `WORLD_MECHANICS`.
- Produces: `WORLD_MECHANICS` extended with an aging clause and a home/hearth/upkeep bullet — every existing verbatim phrase preserved (`"never compelled to act"`, `"no one but yourself"`), and no `FORBIDDEN_TERMS` introduced.

- [ ] **Step 1: Write the failing test** (append to `tests/agents/prompt_test.py`)

```python
def test_world_mechanics_describes_aging_and_the_home() -> None:
    """The shell teaches L1 physics in-world (DD9): idling wears you down; a home + hearth."""
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    # Aging: stillness has a cost now (the still-life fix), stated as physics not strategy.
    assert "ebbs away" in lowered
    # The home affordances: build, hearth (materials -> energy), feed-or-it-crumbles.
    assert "home" in lowered
    assert "hearth" in lowered
    assert "crumbles" in lowered
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agents/prompt_test.py::test_world_mechanics_describes_aging_and_the_home -v`
Expected: FAIL — `"wears at your energy"` / `"hearth"` / `"crumbles"` not in `WORLD_MECHANICS`.

- [ ] **Step 3: Extend `WORLD_MECHANICS`**

In `agents/prompt.py`, add the home bullet after the gather/hand-to-a-being bullet, and append the aging clause to the final "never compelled to act" bullet (preserving its exact existing phrases). The changed portion of the string literal:

```python
        "- You can gather energy and materials from the land where you stand, and you can hand "
        "some of your own to a being beside you.\n"
        "- Where you stand, you may raise a home of your own if you hold materials enough to "
        "build it. You can rest at its hearth to turn some of your materials into energy. A home "
        "must be kept fed with materials, or in time it crumbles away to nothing.\n"
        "- You can speak to those in your place: say something for everyone there to hear, or "
        "direct it to one being alone so only they hear it.\n"
        "- You can strike a being beside you to drain their energy, though striking costs you "
        "energy too; enough harm will end them.\n"
        "- With a partner in your place who answers your offer, and by each giving up some of "
        "your energy and materials, a new being — a child — comes into the world. This asks "
        "much of you both, and there are limits to how often, and how many times, it can be done.\n"
        "- You are never compelled to act. You may let a moment simply pass and rest, "
        "or turn something over in your own mind — words meant for no one but yourself. Yet "
        "stillness is not free: when you let moment after moment pass without acting, a little "
        "of your energy quietly ebbs away."
```

(Note: the wording is chosen to contain the tested phrase `"ebbs away"` while preserving the existing verbatim phrases `"never compelled to act"` and `"no one but yourself"`, and avoiding every `FORBIDDEN_TERMS` entry and `"you should"`. If you rewrite for smoother prose, keep the exact substrings `"ebbs away"`, `"hearth"`, `"home"`, and `"crumbles"` so the test holds.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/agents/prompt_test.py -v`
Expected: PASS (new test plus the existing `test_prompt_has_no_goal_or_simulation_language`, `test_world_mechanics_grants_the_freedom_not_to_act`, `test_prompt_explains_world_mechanics`).

- [ ] **Step 5: Commit**

```bash
git add agents/prompt.py tests/agents/prompt_test.py
git commit -m "feat(home): WORLD_MECHANICS prose for aging + home/hearth (DD9, L1)"
```

---

## Task 8: Activity-feed verbs + world-table homes section

**Files:**
- Modify: `observability/activity_feed.py` (`_EVENT_VERBS`, `render_world_table`)
- Test: `tests/observability/activity_feed_test.py`

**Interfaces:**
- Consumes: `render_event(event)`, `render_world_table(world)`, `WorldState.get_all_homes()`, `Home.{home_id, owner_id, region, integrity}`.
- Produces: `_EVENT_VERBS` fallbacks for `home_built` / `hearth_used` / `home_collapsed`; a "Homes" sub-table (Home / Owner / Region / Integrity) stacked into the `render_world_table` grid.

- [ ] **Step 1: Write the failing tests** (append to `tests/observability/activity_feed_test.py`)

```python
def test_render_event_home_events_are_human_readable() -> None:
    """Message-less home events fall back to a distinct verb per type."""
    for etype, needle in (
        ("home_built", "raised"),
        ("hearth_used", "hearth"),
        ("home_collapsed", "crumble"),
    ):
        event = Event(etype, "wanderer_001", {}, scope=ScopeType.LOCAL)  # no message -> verb
        assert needle in render_event(event).lower()


def test_render_world_table_shows_homes(world: WorldState) -> None:
    """The world-table gains a homes section showing owner + integrity (observer-facing)."""
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=42.0)
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Homes" in text  # the section title
    assert "home_ada" in text  # the home id (unique to the homes section)
    assert "42.0" in text  # its integrity is visible to the observer
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/observability/activity_feed_test.py -k "home" -v`
Expected: FAIL — the verb fallbacks are absent (`render_event` returns the raw type) and `render_world_table` has no "Homes" section.

- [ ] **Step 3: Implement the verbs and the homes section**

In `observability/activity_feed.py`, add to `_EVENT_VERBS` (e.g. after `"agent_started_hoarding"`):

```python
    "home_built": "raised a home",
    "hearth_used": "rested at the hearth",
    "home_collapsed": "watched a home crumble",
```

In `render_world_table`, after the `regions_table` loop and before `layout = Table.grid(...)`, build the homes sub-table; then add it to the grid:

```python
    homes_table = Table(title="Homes", expand=True)
    homes_table.add_column("Home")
    homes_table.add_column("Owner")
    homes_table.add_column("Region")
    homes_table.add_column("Integrity", justify="right")
    for home in world.get_all_homes():
        homes_table.add_row(
            home.home_id,
            home.owner_id,
            home.region,
            f"{home.integrity:.1f}",
        )

    layout = Table.grid(expand=True)
    layout.add_column()
    layout.add_row(agents_table)
    layout.add_row(regions_table)
    layout.add_row(homes_table)
    return layout
```

(Update the `render_world_table` docstring's "builds two stacked sub-tables" to "three stacked sub-tables … and homes (id/owner/region/integrity)".)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/observability/activity_feed_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add observability/activity_feed.py tests/observability/activity_feed_test.py
git commit -m "feat(home): activity-feed verbs + world-table homes section (L1)"
```

---

## Final verification (before merge)

- [ ] **Run the full CI gate and read the output** (evidence before claiming done)

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

Expected: ruff clean, format clean, mypy clean, all tests pass, coverage ≥ 90%. If `--cov-report=term-missing` flags an uncovered branch in `world/tick.py` (the home sweep), `tools/builtin/homes.py`, or `world/world.py`, add the missing-path test before merging. Merge only on green.

---

## Self-Review (completed against the spec §8 skeleton)

**Spec coverage** — every §8 skeleton item maps to a task:
- `Home` dataclass (`slots`, mutable, 6 fields incl. `last_upkeep_at`) → Task 2.
- `WorldState` `homes` + `build_home`/`remove_home`/`modify_home_integrity` (clamp `[0, HOME_MAX_INTEGRITY]`)/`home_of`/`homes_in_region`/`get_all_homes`, sync & event-free → Task 3.
- `tick()` fourth sweep (upkeep from owner stock, decay on cannot-pay, collapse at `<=0`, snapshot-then-mutate + deferred publish) → Task 4.
- `build_home` + `use_hearth` in BOTH `BUILTIN_TOOLS` and `TOOL_SCHEMAS` (parity test); NL `Error:`/`Invalid:`/success → Tasks 5 & 6.
- LOCAL `home_built`/`hearth_used`/`home_collapsed` + `_EVENT_VERBS`; aging silent → Tasks 4/5/6/8.
- `WORLD_MECHANICS` prose (DD9) → Task 7.
- `render_world_table` homes section (owner + integrity) → Task 8.
- Constants (all 7) → folded into Tasks 1/3/4/5/6.
- Reviewer's extra tests → tool-breath-does-not-age (T1), aged-into-paralysis emits `agent_paralyzed` (T1), dead-owner & swept-owner decay→collapse (T4), hearth partial-burn + exact conservation (T6), tick-frequency independence (T4), collapse-fires-once (T4), `build_home` recomputes `is_hoarding` (T5).
- Resolved decisions baked in verbatim: hearth deducts materials **before** crediting energy (T6); homes keyed by `home_id` (T2/T3); time-based upkeep from owner stock via `last_upkeep_at` (T4); dead/missing owner → cannot-pay → decay (T4); aging keyed on `not decision.tool_calls`, right after `_emit_self_talk`, before the reflect gate (T1); all Home/WorldState mutations sync & event-free with the tick orchestrating + publishing `home_collapsed` (T3/T4).

**Type/name consistency** — verified across tasks: `build_home(home_id, owner_id, region, *, built_at, integrity)`, `modify_home_integrity(home_id, amount)`, `home_of(agent_id) -> Home | None`, `homes_in_region(region) -> list[Home]`, `get_all_homes() -> list[Home]`, `HEARTH_ENERGY_PER_MATERIAL` (used identically in the constant, the tool recipe, and the tests), event type strings (`home_built`/`hearth_used`/`home_collapsed`), and success-string prefixes (`"You raise a home here."` / `"You rest at your hearth"`) are all consistent.

**Resolved spec ambiguities:**
1. **`home_in_region` → `homes_in_region` returning `list[Home]`.** The spec's singular name is misleading: multiple beings can build in one region. Renamed for correctness (a plural list); it has no L1 production consumer beyond its own test (the tools use `home_of`), so the rename is safe.
2. **Hearth rate name.** The spec used three names (`HEARTH_ENERGY_PER_USE`, "rate", `HEARTH_MATERIALS_PER_ENERGY`). The reviewer recipe multiplies materials by the rate (`+m * rate`), i.e. energy-per-material, so the constant is `HEARTH_ENERGY_PER_MATERIAL` and the recipe is `gained = burned * HEARTH_ENERGY_PER_MATERIAL`.
3. **Upkeep vs. decay time-model.** Upkeep *payment* is time-based (`owed = rate * elapsed`, advance `last_upkeep_at` on payment) — the property the "tick-frequency independence" test pins. Decay is a fixed per-tick decrement (`HOME_DECAY_PER_MISSED_TICK`, matching the spec's named constant and its "decrements it by …" prose) applied only on cannot-pay ticks; a paid tick restores integrity to `HOME_MAX_INTEGRITY`. "Cannot pay" means the owner is missing/`DEAD` or holds `< owed` (all-or-nothing per tick — no partial floor-draw, honouring `modify_agent_materials`'s DEAD/missing no-op).
4. **Per-breath home self-perception** is out of scope: the being learns the mechanics via `WORLD_MECHANICS` and perceives home events via the stream; the world-table (observer) shows ownership/integrity. Richer per-breath home status in `_render_perception` is deliberately deferred.
