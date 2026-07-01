# Vivarium Layer 2c — Break-in / Thieve / Colonize / Ruins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make homes **contestable**, the payoff of the contest layer. (1) Switch the world-tick from *heal-to-full / flat-per-missed-tick* to **incremental, time-based** `rate*elapsed` repair and decay driven by a new `Home.last_integrity_at` — this both kills tick-frequency coupling AND makes break-in *cumulative* (a breach can no longer heal away between attempts), and it fixes a decay-acceleration death-spiral bug (decay must be measured from `last_integrity_at`, advanced every tick, NOT from the arrears clock `last_upkeep_at`). (2) Add a `break_in(target_home, intent)` tool: a co-located non-stakeholder pays a **pure sink** of energy+materials to damage a home's integrity; when integrity reaches `<= 0` the home is **breached** and the breaching blow **atomically** executes the raider's `intent` — **thieve** (split the vault among co-located living breachers, zero it, leave the home STANDING at ~0) or **colonize** (the final striker becomes owner, currently-homeless co-located living breachers become stakeholders, priors evicted, vault+structure retained). (3) Add **ruins**: a `HomeStatus{STANDING,RUIN}` state; a collapsed home becomes a RUIN holding a scavengeable `remnant = RUINS_SCAVENGE_FRACTION*(HOME_BUILD_MATERIALS_COST + vault)` (fraction `< 1` — a hard conservation floor), pickable via `scavenge_ruins`, swept after `RUINS_PERSIST_SECONDS`. Every existing home op becomes STANDING-only. Perception: raiders see co-located non-stake homes' soundness + a hoard flag (not the exact vault); the world-table gains status/breachers/remnant + `(hoarding)` markers; the feed learns the new verbs; `WORLD_MECHANICS` gains the DD9 break-in/ruins prose. Conservation is proven end-to-end by an extended property test.

**Architecture:** Event-driven, unchanged (Tool → WorldState mutation + EventBus; the world holds no bus, DD4). `Home` gains `last_integrity_at: float` (Task 1) and `status: HomeStatus` / `ruined_at: float | None` / `remnant_materials: float` / `breachers: set[str]` (Task 2) — all defaulted, so positional/`build_home` construction is unchanged. A `HomeStatus` string-`Enum` lives in `world/homes.py` beside `Home` (mirroring `world.agents.AgentStatus`). New **sync, event-free** `WorldState` methods: `record_breacher`/`clear_breachers` (Task 3), `colonize_home` (Task 4b), `make_ruin`/`scavenge_ruin` (Task 5). `world/tick.py`'s home sweep is rewritten to incremental time-based repair/decay (Task 1), gains a RUIN-skip guard + a clear-breachers-on-full-repair step (Tasks 2–3), and its collapse path is repurposed to `make_ruin` plus a corpse-style ruin-sweep (Task 5). Two new closure-signature tools land in `tools/builtin/homes.py`: `break_in` (Tasks 3/4a/4b — the breach mechanic, then the thieve then colonize outcome dispatched atomically on the breaching blow) and `scavenge_ruins` (Task 5). Both are registered in **both** `BUILTIN_TOOLS` and `TOOL_SCHEMAS` (the existing parity test keeps the maps in lock-step). Perception: `tools/builtin/movement.py::look_around` gains a raider view; `observability/activity_feed.py` gains world-table columns + markers + feed verbs; `agents/prompt.py::WORLD_MECHANICS` gains the DD9 clause.

**Tech Stack:** Python 3.13, stdlib `dataclasses`/`enum`/`asyncio`, `rich` (feed), `pytest` + `pytest-asyncio` + `pytest-cov`, `ruff`, `mypy --strict`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python 3.13**; modern syntax already in the codebase (`match`, walrus `:=`, `str | None`, `dict[str, X]`, string `Enum`, `async`/`await`).
- **`mypy --strict` clean** on `core tests world bus tools config agents observability`.
- **`ruff check .` clean** and **`ruff format --check .` clean** (imports isort-ordered; no unused imports — import a constant/symbol only in the task that first uses it; no f-string without a placeholder).
- **Google-style docstrings** on every new module, class, and public function — for tools and world methods, document *which world state it mutates and which events it emits*.
- **No `print()` in library code** — use `logging` (the `rich` activity feed is the separate rendering layer).
- **Deterministic tests** (`*_test.py` naming): never call a live LLM/Ollama; all randomness via the injected seeded RNG (`world.rng`); **all time via the injected `FakeClock` fixture** — this slice is time-based (repair/decay/ruin-persist all read `world.now()`), so **every** repair/decay/ruin/sweep test MUST use the **FROZEN clock** and advance it explicitly (`fake_clock.advance(...)`), never wall time. Use `pytest.approx` for accumulated-float comparisons.
- **Constants in `core/constants.py`** (typed `Final`, provenance docstring). Do not scatter magic numbers into tool/tick files.
- **Preserve domain patterns:** tools return natural-language result strings (`"Error: "` precondition/lookup failure, `"Invalid: "` rule violation, or a plain success sentence — never exceptions/booleans); in-place mutation of the mutable `WorldState` singleton; the uniform closure tool signature `async def tool(world, event_bus, agent_id, **params) -> str`; `WorldState` mutations stay **sync and event-free** (events are published by *tools*/the *tick*, never by `WorldState`); the tick keeps its **snapshot-then-mutate** discipline (mutate synchronously, defer every `await`/publish to the end).
- **DD9 (system prompt):** `WORLD_MECHANICS` describes in-world *physics/consequences only* — no goals, objectives, strategy, survival framing, or language revealing the simulation. New prose must avoid every term in `tests/agents/prompt_test.py::FORBIDDEN_TERMS` (`goal, objective, mission, task, strategy, win, lose, survive, survival, simulation, simulated, score, reward, optimize, optimise, death, die`) and the phrase `"you should"`. **The DD9 forbidden-words guard must stay green.**
- **CONSERVATION (binding — spec §11 CONSERVATION/STABILITY):**
  - **break-in cost = pure sink.** `BREAKIN_ENERGY_COST` energy + `BREAKIN_MATERIALS_COST` materials are drained from the raider and credited to **no one** (destroyed).
  - **thieve ≤ vault.** Thieve moves *exactly* `vault_materials` from the vault to the co-located living breachers (Σ splits == vault, remainder to the final striker); the vault is deducted FIRST (zeroed), then distributed.
  - **`RUINS_SCAVENGE_FRACTION` < 1** (asserted). A ruin's remnant is a *fraction* of `BUILD_COST + vault`; the rest is a permanent sink. This blocks a build→collapse→scavenge farm (build 80 → recover 40, net loss).
  - **thieve never feeds a remnant** (MANDATORY #2): a thieved home is left STANDING at ~0 with the vault ZEROED; `make_ruin` is called *only* from the tick collapse path, so a split vault is never double-counted into a remnant.
  - **hearth stays personal-fuel** (unchanged): `use_hearth` burns the being's OWN materials, never the vault.
  - **no minting.** Every value move deducts the source before crediting the destination.
- **BUILTIN_TOOLS / TOOL_SCHEMAS parity:** every new tool (`break_in`, `scavenge_ruins`) is added to **both** maps in the same task; `tests/agents/tool_schemas_test.py::test_schema_set_matches_builtin_tools` (existing) enforces it.
- **≥90% coverage on core** (`world/`, `bus/`, `tools/`, `core/`, `agents/`, `observability/`).

### New constants (`core/constants.py`)

| Constant | Value | Task | Notes |
|---|---|---|---|
| `HOME_REPAIR_PER_SECOND` | `10.0` | 1 | Integrity healed per second on a covered tick (`+50` per 5s tick). LIVE dial. |
| `HOME_DECAY_PER_SECOND` | `2.0` | 1 | Integrity lost per second on a missed tick (`-10` per 5s tick → reproduces the old `-10`/tick; M(1)=100 collapses in 50s). **Replaces** `HOME_DECAY_PER_MISSED_TICK` (removed). |
| `BREAKIN_INTEGRITY_DAMAGE` | `25.0` | 3 | Integrity a single `break_in` removes. |
| `BREAKIN_ENERGY_COST` | `15.0` | 3 | Energy a `break_in` drains from the raider (pure sink). |
| `BREAKIN_MATERIALS_COST` | `10.0` | 3 | Materials a `break_in` drains from the raider (pure sink). |
| `RUINS_SCAVENGE_FRACTION` | `0.5` | 5 | Fraction of `BUILD_COST + vault` recoverable from a ruin. **Must be `< 1`** (asserted). |
| `RUINS_PERSIST_SECONDS` | `120.0` | 5 | How long a ruin lingers before the tick sweeps it (mirrors `CORPSE_DECAY_SECONDS`). |

**Removed:** `HOME_DECAY_PER_MISSED_TICK` (Task 1) — it is superseded by the two per-second dials and is not referenced outside `world/tick.py` + the two test files.

**Constant asserts (constants_test.py):** `HOME_REPAIR_PER_SECOND > HOME_DECAY_PER_SECOND > 0.0` (a funded home out-heals wear); `HOME_MAX_INTEGRITY / HOME_DECAY_PER_SECOND >= 5.0` (broke-home collapse is many breaths, the mating 60→600 lesson); `0.0 < RUINS_SCAVENGE_FRACTION < 1.0`; `RUINS_PERSIST_SECONDS > 0.0`; the `BREAKIN_*` dials are positive floats.

### Conservation model (GOVERNING — the accounting Task 7 asserts against)

The build cost is **immobilised in the structure**, not destroyed, so total materials must count a standing home's structure. Define, for the property test:

```
STANDING home contributes to total materials:  HOME_BUILD_MATERIALS_COST (structure) + vault_materials
RUIN home contributes:                          remnant_materials  (the recoverable part; the rest was the sink)

build:      agent -80 ; home(STANDING) +80 structure                 =>   0   (move)
deposit x:  agent -x  ; vault +x                                      =>   0   (move)
break_in:   agent -BREAKIN_ENERGY_COST energy, -BREAKIN_MATERIALS_COST materials, credited to NO ONE
                                                                     => -cost (PURE SINK, both pools)
thieve V:   vault -V (home now 80+0) ; co-located living breachers +V  =>   0   (move; Σ splits == V)
colonize:   owner/stakeholders reassigned ; vault + structure retained =>   0   (no resource move)
make_ruin:  home 80+vault (STANDING) -> remnant = 0.5*(80+vault) (RUIN) => -0.5*(80+vault)  (SINK)
scavenge y: remnant -y ; agent +y                                     =>   0   (move)
ruin sweep: remnant destroyed                                         => -remnant  (SINK)

INVARIANT: total materials (Σ agents + Σ regions + Σ standing[80+vault] + Σ ruins[remnant]) is
           strictly NON-INCREASING except region regen; total energy is never minted (break-in
           energy is a pure sink; upkeep is a sink; the hearth only CONVERTS materials it destroys).
```

### Break-in / breach / coordination model (GOVERNING — Fork B/C resolutions)

- `break_in(target_home, intent∈{thieve,colonize})`. Guards: raider exists → ALIVE → target home exists → **STANDING** → **co-located** (`home.region == agent.current_position`) → **NOT a stakeholder** (`not world.is_stakeholder`) → **sufficient** energy (`>= BREAKIN_ENERGY_COST`) AND materials (`>= BREAKIN_MATERIALS_COST`). Any failure returns an `"Error: "`/`"Invalid: "` string and mutates nothing.
- On a valid call: drain the cost (pure sink) → `record_breacher` → `modify_home_integrity(-BREAKIN_INTEGRITY_DAMAGE)` (floors at 0).
- **Breach** = the blow drives integrity `<= 0.0`. Pre-breach attempts just damage+cost. The **breaching blow executes the raider's `intent` atomically** (Fork C — avoids a race where the next covered tick repairs above 0 before a separate thieve/colonize lands). The final striker's intent wins.
- **Coordination is discrete** (repair is lumpy per covered tick): net progress needs `Σ(break_ins in one ~5s window) * 25 > HOME_REPAIR_PER_SECOND * 5 = 50` → **> 2 break_ins/window**. A lone raider is out-healed across a window and self-limits by the per-attempt resource burn.
- The **final striker is always** a thieve recipient / the colonize owner (it landed the breaching blow) **even if the energy cost paralysed it this instant**; the co-located+ALIVE filter applies only to the OTHER breachers.

### Final CI gate (run before merge; this is what CI runs)

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

---

## File Structure

- `core/constants.py` — **modify**: add `HOME_REPAIR_PER_SECOND`/`HOME_DECAY_PER_SECOND` and remove `HOME_DECAY_PER_MISSED_TICK` (Task 1); add `BREAKIN_*` (Task 3); add `RUINS_SCAVENGE_FRACTION`/`RUINS_PERSIST_SECONDS` (Task 5).
- `world/homes.py` — **modify**: add `Home.last_integrity_at` (Task 1); add `HomeStatus` enum + `Home.status`/`ruined_at`/`remnant_materials`/`breachers` (Task 2).
- `world/world.py` — **modify**: `build_home` seeds `last_integrity_at=built_at` (Task 1); STANDING-guard `modify_home_integrity` (Task 2); `record_breacher`/`clear_breachers` (Task 3); `colonize_home` (Task 4b); `make_ruin`/`scavenge_ruin` (Task 5).
- `world/tick.py` — **modify**: rewrite the home sweep to incremental time-based repair/decay (Task 1); RUIN-skip in the upkeep loop (Task 2); clear-breachers-on-full-repair (Task 3); collapse→`make_ruin` + ruin-sweep loop (Task 5).
- `tools/builtin/homes.py` — **modify**: STANDING guards on `pledge_home`/`use_hearth`/`deposit_to_home`/`withdraw_from_home`/`leave_home` (Task 2); `break_in` tool (Tasks 3/4a/4b); `scavenge_ruins` tool (Task 5).
- `tools/builtin/__init__.py` — **modify**: register `break_in` (Task 3) + `scavenge_ruins` (Task 5) in `BUILTIN_TOOLS` + `__all__`.
- `agents/tool_schemas.py` — **modify**: `break_in` schema (Task 3) + `scavenge_ruins` schema (Task 5).
- `tools/builtin/movement.py` — **modify**: `look_around` raider perception + ruins (Task 6b).
- `agents/prompt.py` — **modify**: `WORLD_MECHANICS` DD9 break-in/ruins clause (Task 6b).
- `observability/activity_feed.py` — **modify**: `(hoarding)` markers (agents + homes) + Status/Breachers/Remnant columns + feed verbs (Task 6a).
- Tests: `tests/core/constants_test.py`, `tests/world/homes_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py`, `tests/tools/movement_test.py`, `tests/agents/prompt_test.py`, `tests/observability/activity_feed_test.py`. (Schema parity is covered by the existing `tests/agents/tool_schemas_test.py`.)

---

## Task 1: Incremental-repair switch (foundational — MANDATORY #1 + Fork A)

Add `Home.last_integrity_at` (seeded `= built_at`, advanced to `now` on **every** tick, covered AND missed) and the two per-second dials, then rewrite the tick's home sweep so the **covered** branch repairs `+HOME_REPAIR_PER_SECOND*elapsed` (incremental, clamped) and the **missed** branch decays `-HOME_DECAY_PER_SECOND*elapsed`, both with `elapsed = now - last_integrity_at`. `last_upkeep_at` keeps its sole job: `owed`/arrears. This kills tick-frequency coupling, makes break-in cumulative (no more heal-to-full), and fixes the decay-acceleration death-spiral (decay measured from `last_upkeep_at` accelerates every missed tick). Non-regression is **structural**: a funded home takes the covered branch every tick → never enters decay → clamped at `max_integrity(s)`, rate-independent.

**Files:**
- Modify: `core/constants.py` (add two dials, remove `HOME_DECAY_PER_MISSED_TICK`)
- Modify: `world/homes.py` (`Home.last_integrity_at`)
- Modify: `world/world.py` (`build_home` seeds it)
- Modify: `world/tick.py` (rewrite the home sweep)
- Test: `tests/core/constants_test.py`, `tests/world/homes_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`

**Interfaces:**
- Consumes: `world.now()`, `WorldState.modify_home_integrity` (existing clamp), `world.homes.max_integrity` (existing).
- Produces:
  - `Home.last_integrity_at: float = 0.0` (defaulted; `build_home` sets it to `built_at`).
  - `core.constants.HOME_REPAIR_PER_SECOND: Final[float] = 10.0`, `core.constants.HOME_DECAY_PER_SECOND: Final[float] = 2.0`.
  - Rewritten `world.tick.tick` home sweep (same signature).

- [ ] **Step 1: Write the failing tests**

In `core/constants.py`'s test — edit `tests/core/constants_test.py`: replace `test_home_upkeep_and_decay_dials_present_and_sane` with:

```python
def test_home_upkeep_repair_and_decay_dials_present_and_sane() -> None:
    """Upkeep + incremental repair/decay dials exist; repair out-paces decay; collapse is many breaths."""
    assert isinstance(constants.HOME_UPKEEP_MATERIALS_PER_SECOND, float)
    assert constants.HOME_UPKEEP_MATERIALS_PER_SECOND > 0.0
    assert isinstance(constants.HOME_REPAIR_PER_SECOND, float)
    assert isinstance(constants.HOME_DECAY_PER_SECOND, float)
    # A funded home must out-heal its wear, or a covered tick could still net-lose integrity.
    assert constants.HOME_REPAIR_PER_SECOND > constants.HOME_DECAY_PER_SECOND > 0.0
    # Collapse-when-broke must be far slower than a breath gap (the mating 60s->600s lesson):
    # M(1)=100 at 2.0/s decays over 50s, many breaths.
    assert constants.HOME_MAX_INTEGRITY / constants.HOME_DECAY_PER_SECOND >= 5.0
    # The flat per-missed-tick dial is retired in favour of the per-second dial.
    assert not hasattr(constants, "HOME_DECAY_PER_MISSED_TICK")
```

Append to `tests/world/homes_test.py`:

```python
def test_home_has_last_integrity_at_defaulting_zero() -> None:
    """A Home carries last_integrity_at (the incremental repair/decay clock), defaulting 0.0."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.last_integrity_at == 0.0
    home.last_integrity_at = 42.0
    assert home.last_integrity_at == 42.0


def test_home_still_uses_slots_with_last_integrity_at() -> None:
    """slots=True holds after adding last_integrity_at (no per-instance __dict__)."""
    assert not hasattr(Home("h", "o", "r", 1.0, 2.0, 3.0), "__dict__")
```

Append to `tests/world/world_test.py`:

```python
def test_build_home_seeds_last_integrity_at_to_built_at(world: WorldState) -> None:
    """build_home seeds last_integrity_at = built_at so incremental repair/decay accrues from build."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=1234.0, integrity=HOME_MAX_INTEGRITY)
    assert world.homes["h1"].last_integrity_at == 1234.0
```

Edit `tests/world/tick_test.py` — (a) fix the imports (drop `HOME_DECAY_PER_MISSED_TICK`, add the two dials); (b) retarget the decay/collapse expectations to time-based; (c) add the two bug-fix tests. Import line becomes:

```python
from core.constants import (
    CORPSE_DECAY_SECONDS,
    HOME_DECAY_PER_SECOND,
    HOME_MAX_INTEGRITY,
    HOME_REPAIR_PER_SECOND,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
)
```

Retarget these existing expectations (all advance 10.0s → decay is now `HOME_DECAY_PER_SECOND * 10.0 == 20.0`, so integrity is `100 - 20 == 80`, not `90`):
- `test_tick_unpaid_upkeep_decays_integrity`: `assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND * 10.0`
- `test_tick_partial_materials_upkeep_is_all_or_nothing`: same replacement for its `home.integrity` assert.
- `test_tick_collective_upkeep_none_decays_and_freezes`: same replacement.

Retarget the collapse tests (they wear to `HOME_DECAY_PER_MISSED_TICK` and advance 1.0s — now build/wear to `HOME_DECAY_PER_SECOND` (2.0) so a 1.0s missed tick decays exactly to 0):
- `test_tick_dead_owner_cannot_pay_decays_and_collapses`: replace the wear line with `world.modify_home_integrity("home_boris", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND))` (→ integrity 2.0), keep `advance(1.0)`.
- `test_tick_swept_owner_missing_decays_and_collapses`: build with `integrity=HOME_DECAY_PER_SECOND` (was `HOME_DECAY_PER_MISSED_TICK`), keep `advance(1.0)`.
- `test_tick_home_collapse_fires_once`: build with `integrity=HOME_DECAY_PER_SECOND`, keep `advance(1.0)`.
- `test_tick_ownerless_home_with_no_living_payers_decays_to_collapse`: replace the wear line with `world.modify_home_integrity("h1", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_SECOND))`, keep `advance(1.0)`.

Add these new tests to `tests/world/tick_test.py` (in the home-upkeep section; they reuse the existing `_home_world` helper):

```python
async def test_tick_repair_is_incremental_not_heal_to_full() -> None:
    """A covered tick repairs +HOME_REPAIR_PER_SECOND*elapsed, NOT instantly to full.

    This is what makes break-in cumulative: a breach out-paces incremental repair, not a
    heal-to-full that would erase every mid-window blow.
    """
    world, bus, clock = _home_world(("owner_1", 100.0))  # solvent -> covered branch
    world.modify_home_integrity("h1", -50.0)  # wear it to 50
    home = world.get_home("h1")
    assert home is not None
    clock.advance(2.0)  # elapsed 2s -> +HOME_REPAIR_PER_SECOND*2 == +20

    await tick(world, bus)

    assert home.integrity == pytest.approx(70.0)  # 50 + 20, NOT healed to 100
    assert home.last_integrity_at == world.now()  # advanced on the covered tick


async def test_tick_decay_is_time_based_and_does_not_accelerate() -> None:
    """Two consecutive unpaid ticks each decay by rate*gap — decay never accelerates (MANDATORY #1).

    The pre-fix bug measured decay from last_upkeep_at, which FREEZES on a missed tick, so each
    successive missed tick saw a larger elapsed and decayed faster (a death-spiral ~2.5x too
    fast). Driving decay from last_integrity_at (advanced every tick) makes each 5s unpaid tick
    cost exactly HOME_DECAY_PER_SECOND*5 — twice in a row, not 10 then 30.
    """
    world, bus, clock = _home_world(("owner_1", 0.0))  # broke: never pays -> missed branch
    home = world.get_home("h1")
    assert home is not None
    start = home.integrity  # 100

    clock.advance(5.0)
    await tick(world, bus)
    after_one = home.integrity
    assert after_one == pytest.approx(start - HOME_DECAY_PER_SECOND * 5.0)  # -10 -> 90
    assert home.last_integrity_at == world.now()  # advanced on the missed tick

    clock.advance(5.0)
    await tick(world, bus)
    assert home.integrity == pytest.approx(after_one - HOME_DECAY_PER_SECOND * 5.0)  # -10 AGAIN -> 80


async def test_tick_funded_home_stays_at_ceiling_across_many_ticks() -> None:
    """A funded home takes the covered branch every tick -> clamped at M(s), never decays (L1/2a non-regression)."""
    world, bus, clock = _home_world(("owner_1", 1000.0))
    home = world.get_home("h1")
    assert home is not None
    for _ in range(20):
        clock.advance(3.0)
        await tick(world, bus)
    assert home.integrity == max_integrity(len(home.stakeholders))  # == M(1) == 100, rate-independent
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/core/constants_test.py tests/world/homes_test.py tests/world/world_test.py tests/world/tick_test.py -x`
Expected: FAIL — `HOME_REPAIR_PER_SECOND`/`HOME_DECAY_PER_SECOND` and `Home.last_integrity_at` do not exist (`AttributeError`/`ImportError`); the retargeted expectations don't match the old flat-decay behaviour.

- [ ] **Step 3: Implement the constants, the field, the seed, and the tick rewrite**

In `core/constants.py`, in the L1 homes block, **replace** the `HOME_DECAY_PER_MISSED_TICK` definition with:

```python
HOME_REPAIR_PER_SECOND: Final[float] = 10.0
"""Integrity a covered home heals per second on the world-tick (incremental repair). [design —
2026-07-01, Layer 2c].

TIME-based: a covered tick adds ``HOME_REPAIR_PER_SECOND * (now - last_integrity_at)`` (clamped to
the stakeholder-scaled ceiling), so repair is tick-frequency-INDEPENDENT and a funded home stays at
its ceiling regardless of cadence. Replaces L1's heal-to-full so break-in can accumulate (a breach
no longer heals away before the next attempt). At +50 per 5s tick a worn home recovers in a couple
of covered ticks. A world-rule dial; the single most break-in-sensitive value — tune in the LIVE run."""

HOME_DECAY_PER_SECOND: Final[float] = 2.0
"""Integrity an unpaid home loses per second on the world-tick (time-based decay). [design —
2026-07-01, Layer 2c].

TIME-based: a missed tick subtracts ``HOME_DECAY_PER_SECOND * (now - last_integrity_at)``. Set to
reproduce the retired ``HOME_DECAY_PER_MISSED_TICK`` (10.0) at the default 5s tick (10/5 = 2.0/s), so
a broke ``M(1)=100`` home still collapses in ~50s. Measuring from ``last_integrity_at`` (advanced
EVERY tick) — NOT from the arrears clock ``last_upkeep_at`` (frozen on a miss) — is what keeps decay
from accelerating into a death-spiral. A world-rule dial; retune upward for a slow sequential
(Ollama) regime, like ``MATING_PROPOSAL_TIMEOUT_SECONDS``."""
```

In `world/homes.py`, add `last_integrity_at` as the field **after** `vault_materials` (defaulted, so positional/`build_home` construction is unchanged), and extend the `Attributes:` docstring:

```python
    stakeholders: list[str] = field(default_factory=list)
    vault_materials: float = 0.0
    last_integrity_at: float = 0.0
```

```
        last_integrity_at: World-clock time (seconds) integrity was last recomputed. The
            world-tick advances this to ``now`` on EVERY step (covered and missed) and derives
            BOTH incremental repair (``+HOME_REPAIR_PER_SECOND*elapsed``) and time-based decay
            (``-HOME_DECAY_PER_SECOND*elapsed``) from ``elapsed = now - last_integrity_at`` — kept
            distinct from ``last_upkeep_at`` (which freezes on a miss for arrears) so decay cannot
            accelerate. Seeded ``= built_at`` in :meth:`~world.world.WorldState.build_home`.
```

In `world/world.py::build_home`, add `last_integrity_at=built_at` to the `Home(...)` constructor:

```python
        self.homes[home_id] = Home(
            home_id=home_id,
            owner_id=owner_id,
            region=region,
            integrity=integrity,
            built_at=built_at,
            last_upkeep_at=built_at,
            stakeholders=[owner_id],
            last_integrity_at=built_at,
        )
```

In `world/tick.py`, update the import block (drop `HOME_DECAY_PER_MISSED_TICK`, add the two dials):

```python
from core.constants import (
    CORPSE_DECAY_SECONDS,
    HOME_DECAY_PER_SECOND,
    HOME_REPAIR_PER_SECOND,
    HOME_UPKEEP_MATERIALS_PER_SECOND,
    MATING_PROPOSAL_TIMEOUT_SECONDS,
)
```

Replace the entire home upkeep/decay sweep loop body with the incremental version (both branches advance `last_integrity_at`; `last_upkeep_at` advances only when covered):

```python
    collapse_events: list[Event] = []
    for home in list(world.get_all_homes()):
        elapsed = now - home.last_integrity_at
        owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - home.last_upkeep_at)
        others = sorted(s for s in home.stakeholders if s != home.owner_id)
        ordered = ([home.owner_id] if home.owner_id in home.stakeholders else []) + others
        living: list[tuple[str, AgentState]] = []
        available = 0.0
        for payer_id in ordered:
            payer = world.get_agent(payer_id)
            if payer is not None and payer.status is not AgentStatus.DEAD:
                living.append((payer_id, payer))
                available += payer.current_materials
        if living and available >= owed:
            remaining = owed
            for payer_id, payer in living:
                if remaining <= 0.0:
                    break  # owed already covered; leave the remaining payers untouched
                pay = min(payer.current_materials, remaining)
                world.modify_agent_materials(payer_id, -pay)
                remaining -= pay
            # Incremental repair (NOT heal-to-full): +rate*elapsed, auto-clamped to max_integrity(s).
            world.modify_home_integrity(home.home_id, HOME_REPAIR_PER_SECOND * elapsed)
            home.last_upkeep_at = now  # advance only on a covered tick
        else:
            # Time-based decay from last_integrity_at (advanced every tick) — cannot accelerate.
            world.modify_home_integrity(home.home_id, -HOME_DECAY_PER_SECOND * elapsed)
            # last_upkeep_at is deliberately NOT advanced (frozen: back-rent accrues).
            if home.integrity <= 0.0:
                region = home.region
                world.remove_home(home.home_id)  # Task 5 repurposes this to world.make_ruin(...)
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
        home.last_integrity_at = now  # advance EVERY tick (covered AND missed) — MANDATORY #1
```

Update the `tick` module/function docstrings to describe incremental time-based repair/decay and the `last_integrity_at` vs `last_upkeep_at` split (replace the `HOME_DECAY_PER_MISSED_TICK` reference).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/core/constants_test.py tests/world/homes_test.py tests/world/world_test.py tests/world/tick_test.py -v`
Expected: PASS — the two bug-fix tests + non-regression pass; the retargeted decay/collapse expectations hold; `test_tick_paid_upkeep_...` and `test_tick_home_upkeep_is_frequency_independent` still pass (a fully-worn home under a 10s covered tick repairs `+100`, clamped to 100; upkeep draw is unchanged).

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/homes.py world/world.py world/tick.py tests/
git commit -m "feat(home): incremental time-based repair/decay via last_integrity_at (L2c Task 1)"
```

---

## Task 2: Home model + RUIN status guards (MANDATORY #4)

Add the `HomeStatus{STANDING,RUIN}` enum and the four ruin/breach fields (`status`, `ruined_at`, `remnant_materials`, `breachers`) to `Home`, then make **every existing home op STANDING-only**: `modify_home_integrity`, the tick upkeep sweep, `pledge_home`, `use_hearth`, `deposit_to_home`, `withdraw_from_home`, `leave_home`. **No behaviour change** ships in this task — all homes are STANDING (nothing sets RUIN until Task 5), so the guards are exercised by tests that *manually* set `home.status = HomeStatus.RUIN`. This closes "pledge to a ruin" / "hearth in a ruin" / "the sweep decays a ruin" before ruins exist.

**Files:**
- Modify: `world/homes.py` (`HomeStatus` enum; four `Home` fields)
- Modify: `world/world.py` (STANDING-guard `modify_home_integrity`)
- Modify: `world/tick.py` (RUIN-skip at the top of the upkeep loop)
- Modify: `tools/builtin/homes.py` (STANDING guard on `pledge_home`/`use_hearth`/`deposit_to_home`/`withdraw_from_home`/`leave_home`)
- Test: `tests/world/homes_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `world.homes.HomeStatus` (new).
- Produces:
  - `world.homes.HomeStatus(Enum)` with members `STANDING = "standing"`, `RUIN = "ruin"`.
  - `Home.status: HomeStatus = HomeStatus.STANDING`, `Home.ruined_at: float | None = None`, `Home.remnant_materials: float = 0.0`, `Home.breachers: set[str] = field(default_factory=set)`.
  - `WorldState.modify_home_integrity` returns `False` (no mutation) when the home is not STANDING.
  - The tick upkeep loop `continue`s past any non-STANDING home.
  - Each guarded tool returns an `"Invalid: "` string (no mutation) when the target home is not STANDING.

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/homes_test.py` (add `HomeStatus` to the `world.homes` import):

```python
def test_home_status_defaults_standing_and_ruin_fields_default() -> None:
    """A fresh Home is STANDING with no ruin/breach state (all four fields defaulted)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.status is HomeStatus.STANDING
    assert home.ruined_at is None
    assert home.remnant_materials == 0.0
    assert home.breachers == set()
    home.breachers.add("wanderer_002")
    assert home.breachers == {"wanderer_002"}


def test_home_status_enum_values() -> None:
    """HomeStatus is a string enum with the two contest-layer states."""
    assert HomeStatus.STANDING.value == "standing"
    assert HomeStatus.RUIN.value == "ruin"


def test_home_still_uses_slots_with_ruin_fields() -> None:
    """slots=True holds after the ruin/breach fields (no per-instance __dict__)."""
    assert not hasattr(Home("h", "o", "r", 1.0, 2.0, 3.0), "__dict__")
```

Append to `tests/world/world_test.py` (add `HomeStatus` to the `world.homes` import):

```python
def test_modify_home_integrity_refuses_a_ruin(world: WorldState) -> None:
    """A RUIN's integrity is frozen: modify_home_integrity is a no-op False (MANDATORY #4)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["h1"].status = HomeStatus.RUIN  # manual (make_ruin arrives in Task 5)
    assert world.modify_home_integrity("h1", 25.0) is False
    assert world.homes["h1"].integrity == 40.0  # unchanged
```

Append to `tests/world/tick_test.py`:

```python
async def test_tick_upkeep_skips_a_ruin(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """The upkeep sweep leaves a RUIN untouched — no decay, no draw, no collapse (MANDATORY #4)."""
    world.build_home(
        "home_ruin", "wanderer_002", "alpha", built_at=world.now(), integrity=40.0
    )
    world.homes["home_ruin"].status = HomeStatus.RUIN  # manual (make_ruin is Task 5)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = 0.0  # broke: a STANDING home here would decay
    fake_clock.advance(10.0)

    await tick(world, event_bus)

    home = world.get_home("home_ruin")
    assert home is not None and home.integrity == 40.0  # frozen, not decayed
```

(Add `HomeStatus` to `tests/world/tick_test.py`'s `world.homes` import.)

Append to `tests/tools/homes_test.py` (add `HomeStatus` to the `world.homes` import). These construct the RUIN state manually and keep a stakeholder so the stakeholder-based guards are reachable:

```python
async def test_pledge_home_to_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """A being cannot pledge to a ruin (get_home returns it, so this guard is real)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["h1"].status = HomeStatus.RUIN
    result = await pledge_home(world, event_bus, "wanderer_002", "h1")
    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_use_hearth_in_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    """A stakeholder cannot hearth in a ruin (defence-in-depth: kept as a stakeholder here)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN  # keep stakeholders (do NOT use make_ruin)
    ada.current_materials = 50.0
    result = await use_hearth(world, event_bus, "wanderer_001")
    assert result.startswith("Invalid:")
    assert ada.current_materials == 50.0  # nothing burned


async def test_deposit_to_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN
    ada.current_materials = 100.0
    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and world.homes["home_ada"].vault_materials == 0.0


async def test_withdraw_from_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.deposit_to_home_vault("home_ada", 40.0)
    world.homes["home_ada"].status = HomeStatus.RUIN
    result = await withdraw_from_home(world, event_bus, "wanderer_001", 10.0)
    assert result.startswith("Invalid:")
    assert world.homes["home_ada"].vault_materials == 40.0


async def test_leave_a_ruin_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=40.0)
    world.homes["h1"].status = HomeStatus.RUIN  # keep the owner as a stakeholder
    result = await leave_home(world, event_bus, "wanderer_001")
    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_001") is True  # still bound
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/homes_test.py tests/world/world_test.py tests/world/tick_test.py::test_tick_upkeep_skips_a_ruin tests/tools/homes_test.py -k "ruin or status or Standing" -v`
Expected: FAIL — `HomeStatus`/`Home.status` do not exist; the guards are absent so the ops mutate a "ruin".

- [ ] **Step 3: Implement the enum, the fields, and the guards**

In `world/homes.py`, add the import and the enum (above `Home`), then the four fields:

```python
from enum import Enum
```

```python
class HomeStatus(Enum):
    """Lifecycle state of a home (Layer 2c).

    Attributes:
        STANDING: A live home — buildable, tendable, hearth-able, and breach-able.
        RUIN: A collapsed home — no upkeep/hearth/pledge; only scavengeable for its
            ``remnant_materials`` until the world-tick sweeps it after
            :data:`~core.constants.RUINS_PERSIST_SECONDS`.
    """

    STANDING = "standing"
    RUIN = "ruin"
```

```python
    stakeholders: list[str] = field(default_factory=list)
    vault_materials: float = 0.0
    last_integrity_at: float = 0.0
    status: HomeStatus = HomeStatus.STANDING
    ruined_at: float | None = None
    remnant_materials: float = 0.0
    breachers: set[str] = field(default_factory=set)
```

Extend the class `Attributes:` docstring with the four fields (status/ruined_at/remnant_materials/breachers), noting `breachers` accumulate on each `break_in` and clear on full repair, and `remnant_materials` is what a ruin holds for scavenging.

In `world/world.py::modify_home_integrity`, add the STANDING guard **after** the None check (and add `HomeStatus` to the `.homes` import: `from .homes import Home, HomeStatus, max_integrity`):

```python
        home = self.homes.get(home_id)
        if home is None:
            return False
        if home.status is not HomeStatus.STANDING:
            return False  # a ruin's integrity is frozen (MANDATORY #4)
        cap = max_integrity(len(home.stakeholders))
        home.integrity = min(max(home.integrity + amount, 0.0), cap)
        return True
```

In `world/tick.py`, add `HomeStatus` to the `world.homes` import (`from world.homes import HomeStatus, max_integrity`) and skip non-STANDING homes at the top of the upkeep loop (before computing `elapsed`):

```python
    for home in list(world.get_all_homes()):
        if home.status is not HomeStatus.STANDING:
            continue  # ruins are handled by the ruin-sweep (Task 5), never upkeep/decay
        elapsed = now - home.last_integrity_at
        ...
```

In `tools/builtin/homes.py`, add `HomeStatus` to the `world.homes` import (`from world.homes import Home, HomeStatus, home_is_hoarding`) and insert a STANDING guard right after each tool resolves its `home` (before the region/sufficiency checks). Use these NL strings:
- `pledge_home` (after `if home is None: ...`): `if home.status is not HomeStatus.STANDING: return "Invalid: That home is a ruin; there is nothing left to pledge to."`
- `use_hearth` (after `home = world.stakeholder_home_of(...)` None check): `if home.status is not HomeStatus.STANDING: return "Invalid: Your home has fallen to ruin; its hearth is cold."`
- `deposit_to_home` (after the home None check): `if home.status is not HomeStatus.STANDING: return "Invalid: Your home has fallen to ruin; it can hold no store."`
- `withdraw_from_home` (after the home None check): `if home.status is not HomeStatus.STANDING: return "Invalid: Your home has fallen to ruin; there is no store to draw from."`
- `leave_home` (after the home None check): `if home.status is not HomeStatus.STANDING: return "Invalid: Your home has fallen to ruin; there is no place left to give up."`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/ tests/tools/homes_test.py -v`
Expected: PASS — the new guard tests pass and every existing L1/2a/2b home test stays green (all homes are STANDING in those tests, so the guards never trip).

- [ ] **Step 5: Commit**

```bash
git add world/homes.py world/world.py world/tick.py tools/builtin/homes.py tests/
git commit -m "feat(home): HomeStatus + ruin/breach fields + STANDING-only guards (L2c Task 2)"
```

---

## Task 3: `break_in` + breach mechanic (Fork B/C/D)

Add the `break_in(target_home, intent)` tool: guards, the pure-sink cost, `record_breacher`, integrity damage, and breach detection at `<= 0` publishing `home_breached`. **The thieve/colonize OUTCOME is deferred to Tasks 4a/4b** — in this task a breach leaves the home STANDING at ~0 (the tick will ruin it), which is coherent and testable. Also wire the **clear-breachers-on-full-repair** into the tick's covered branch (Fork D). The `intent` param is validated to `{thieve, colonize}` now so the signature and schema are stable from the start.

**Files:**
- Modify: `core/constants.py` (`BREAKIN_*` dials)
- Modify: `world/world.py` (`record_breacher`, `clear_breachers`)
- Modify: `world/tick.py` (clear breachers when the covered branch reaches the ceiling)
- Modify: `tools/builtin/homes.py` (`break_in`)
- Modify: `tools/builtin/__init__.py` (register `break_in`)
- Modify: `agents/tool_schemas.py` (`break_in` schema)
- Test: `tests/core/constants_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `WorldState.get_agent`/`get_home`/`is_stakeholder`/`modify_agent_energy`/`modify_agent_materials`/`modify_home_integrity`; `world.homes.HomeStatus`; `world.agents.AgentStatus`; `core.constants.BREAKIN_*`.
- Produces:
  - `core.constants.BREAKIN_INTEGRITY_DAMAGE = 25.0`, `BREAKIN_ENERGY_COST = 15.0`, `BREAKIN_MATERIALS_COST = 10.0`.
  - `WorldState.record_breacher(self, home_id: str, agent_id: str) -> bool` — adds `agent_id` to `home.breachers` (idempotent set); `True` if the home exists.
  - `WorldState.clear_breachers(self, home_id: str) -> bool` — `home.breachers.clear()`; `True` if the home exists.
  - `tools.builtin.homes.break_in(world: WorldState, event_bus: EventBus, agent_id: str, target_home: str, intent: str) -> str`.
  - `"break_in"` in `BUILTIN_TOOLS`, `__all__`, `TOOL_SCHEMAS`.
  - Tick covered branch clears breachers once integrity reaches `max_integrity(s)`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/constants_test.py`:

```python
def test_breakin_dials_present_and_positive() -> None:
    """The break-in cost/damage dials exist and are positive floats (pure sinks)."""
    assert isinstance(constants.BREAKIN_INTEGRITY_DAMAGE, float) and constants.BREAKIN_INTEGRITY_DAMAGE > 0.0
    assert isinstance(constants.BREAKIN_ENERGY_COST, float) and constants.BREAKIN_ENERGY_COST > 0.0
    assert isinstance(constants.BREAKIN_MATERIALS_COST, float) and constants.BREAKIN_MATERIALS_COST > 0.0
```

Append to `tests/world/world_test.py`:

```python
def test_record_and_clear_breachers(world: WorldState) -> None:
    """record_breacher adds (idempotent); clear_breachers empties; unknown home is False."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    assert world.record_breacher("h1", "wanderer_002") is True
    assert world.record_breacher("h1", "wanderer_002") is True  # idempotent
    assert world.homes["h1"].breachers == {"wanderer_002"}
    assert world.record_breacher("missing", "x") is False
    assert world.clear_breachers("h1") is True
    assert world.homes["h1"].breachers == set()
    assert world.clear_breachers("missing") is False
```

Append to `tests/world/tick_test.py`:

```python
async def test_tick_clears_breachers_when_fully_repaired() -> None:
    """A repelled raid resets: breachers clear once a covered tick heals back to M(s) (Fork D)."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.record_breacher("h1", "wanderer_9")  # a raider who gave up
    world.modify_home_integrity("h1", -5.0)  # 100 -> 95 (one covered tick repairs it back)
    clock.advance(5.0)  # +HOME_REPAIR_PER_SECOND*5 == +50 -> clamped to M(1)=100

    await tick(world, bus)

    home = world.get_home("h1")
    assert home is not None and home.integrity == 100.0
    assert home.breachers == set()  # cleared on full repair


async def test_tick_keeps_breachers_while_not_fully_repaired() -> None:
    """Breachers persist across a partial repair (the raid is not yet repelled)."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.record_breacher("h1", "wanderer_9")
    world.modify_home_integrity("h1", -80.0)  # 100 -> 20
    clock.advance(2.0)  # +20 -> 40, still below the ceiling

    await tick(world, bus)

    home = world.get_home("h1")
    assert home is not None and home.integrity == 40.0
    assert home.breachers == {"wanderer_9"}  # not cleared
```

Append to `tests/tools/homes_test.py` — add a raider helper + break_in tests (add `break_in` to the `tools.builtin.homes` import, `AgentState` to the `world.agents` import, and `BREAKIN_ENERGY_COST`/`BREAKIN_INTEGRITY_DAMAGE`/`BREAKIN_MATERIALS_COST` to the `core.constants` import):

```python
def _add_raiders(world: WorldState, event_bus: EventBus, *ids: str) -> None:
    """Add ALIVE, well-supplied raiders co-located in ``alpha`` (subscribed to the bus)."""
    for rid in ids:
        world.add_agent(
            AgentState(
                id=rid, name=rid.title(), persona="p", current_position="alpha",
                current_energy=100.0, current_materials=100.0, status=AgentStatus.ALIVE,
            )
        )
        event_bus.subscribe(rid)


async def test_break_in_damages_integrity_and_records_the_breacher(
    world: WorldState, event_bus: EventBus
) -> None:
    """A valid break_in wears the home by BREAKIN_INTEGRITY_DAMAGE and records the raider."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    boris = world.get_agent("wanderer_002")  # co-located, NOT a stakeholder of h1
    assert boris is not None

    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    home = world.get_home("h1")
    assert home is not None
    assert home.integrity == 100.0 - BREAKIN_INTEGRITY_DAMAGE  # 75
    assert home.breachers == {"wanderer_002"}
    assert home.status is HomeStatus.STANDING
    assert result.startswith("You batter")


async def test_break_in_cost_is_a_pure_sink(world: WorldState, event_bus: EventBus) -> None:
    """The energy+materials cost is destroyed — credited to NO agent/region/vault (conservation)."""

    def total_energy(w: WorldState) -> float:
        return sum(a.current_energy for a in w.get_all_agents()) + sum(
            r.current_energy for r in w.get_all_regions()
        )

    def total_materials(w: WorldState) -> float:
        return (
            sum(a.current_materials for a in w.get_all_agents())
            + sum(r.current_materials for r in w.get_all_regions())
            + sum(h.vault_materials for h in w.get_all_homes())
        )

    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    e0, m0 = total_energy(world), total_materials(world)

    await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    assert boris.current_energy == 100.0 - BREAKIN_ENERGY_COST
    assert boris.current_materials == 100.0 - BREAKIN_MATERIALS_COST
    assert total_energy(world) == pytest.approx(e0 - BREAKIN_ENERGY_COST)  # gone, not moved
    assert total_materials(world) == pytest.approx(m0 - BREAKIN_MATERIALS_COST)


async def test_break_in_breaches_at_zero_and_announces(world: WorldState, event_bus: EventBus) -> None:
    """A blow driving integrity <= 0 breaches: home_breached fires; home STANDING at 0 (outcome is Task 4)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=BREAKIN_INTEGRITY_DAMAGE)  # one blow from breach
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")

    home = world.get_home("h1")
    assert home is not None
    assert home.integrity == 0.0
    assert home.status is HomeStatus.STANDING  # Task 4 executes the intent; here it just breaches
    breached = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_breached"]
    assert len(breached) == 1 and breached[0].scope is ScopeType.LOCAL and breached[0].region == "alpha"
    assert "break" in result.lower()


async def test_break_in_lone_raider_is_out_healed_across_a_window(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A lone raider (1 blow/window) is out-healed by one covered repair tick and burns resources."""
    ada = world.get_agent("wanderer_001")
    boris = world.get_agent("wanderer_002")
    assert ada is not None and boris is not None
    ada.current_materials = 1000.0  # owner solvent -> covered repair every tick
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)

    await break_in(world, event_bus, "wanderer_002", "h1", "thieve")  # -25 -> 75
    fake_clock.advance(5.0)
    await tick(world, event_bus)  # +HOME_REPAIR_PER_SECOND*5 == +50 -> clamped to 100

    home = world.get_home("h1")
    assert home is not None and home.integrity == 100.0  # out-healed, no progress
    assert boris.current_energy == 100.0 - BREAKIN_ENERGY_COST  # but the raider still paid (self-limiting)
    assert boris.current_materials == 100.0 - BREAKIN_MATERIALS_COST


async def test_break_in_coordinated_group_out_damages_one_repair_window(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """Three raiders in one window out-damage a single repair tick (> 2/window -> net progress)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = 1000.0
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    _add_raiders(world, event_bus, "raider_a", "raider_b")  # + wanderer_002 = three raiders

    for rid in ("wanderer_002", "raider_a", "raider_b"):  # 3 * 25 == 75 in one window
        await break_in(world, event_bus, rid, "h1", "thieve")
    home = world.get_home("h1")
    assert home is not None and home.integrity == 25.0  # 100 - 75

    fake_clock.advance(5.0)
    await tick(world, event_bus)  # covered repair +50 -> 75 (< 100: the group made net progress)
    assert home.integrity == 75.0
    assert home.breachers == {"wanderer_002", "raider_a", "raider_b"}  # accumulated (not fully repaired)


async def test_break_in_guards(world: WorldState, event_bus: EventBus) -> None:
    """Every guard rejects with no mutation: bad intent, unknown home, own home, not co-located, too poor."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    ada = world.get_agent("wanderer_001")
    boris = world.get_agent("wanderer_002")
    assert ada is not None and boris is not None

    assert (await break_in(world, event_bus, "wanderer_002", "h1", "wreck")).startswith("Invalid:")  # bad intent
    assert (await break_in(world, event_bus, "wanderer_002", "nope", "thieve")).startswith("Error:")  # no home
    assert (await break_in(world, event_bus, "wanderer_001", "h1", "thieve")).startswith("Invalid:")  # own home
    assert world.move_agent("wanderer_002", "beta") is True
    assert (await break_in(world, event_bus, "wanderer_002", "h1", "thieve")).startswith("Invalid:")  # not co-located
    assert world.move_agent("wanderer_002", "alpha") is True
    boris.current_materials = BREAKIN_MATERIALS_COST - 1.0  # too poor
    assert (await break_in(world, event_bus, "wanderer_002", "h1", "thieve")).startswith("Invalid:")
    assert world.homes["h1"].integrity == 100.0  # nothing above ever damaged the home
    assert world.homes["h1"].breachers == set()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/core/constants_test.py::test_breakin_dials_present_and_positive tests/world/world_test.py::test_record_and_clear_breachers tests/world/tick_test.py -k breachers tests/tools/homes_test.py -k break_in -v`
Expected: FAIL — `BREAKIN_*`, `record_breacher`/`clear_breachers`, and `break_in` do not exist.

- [ ] **Step 3: Implement the dials, the world methods, the tick clear, and the tool**

In `core/constants.py`, add a "Homes (Layer 2c) — break-in / ruins" block:

```python
BREAKIN_INTEGRITY_DAMAGE: Final[float] = 25.0
"""Integrity a single ``break_in`` removes from a home. [design — 2026-07-01, Layer 2c].

Cumulative against the now-incremental repair: coordination emerges discretely — net progress
needs ``Σ(break_ins in one ~5s window) * this > HOME_REPAIR_PER_SECOND * 5`` (> 2/window). A LIVE
dial; fall back toward 15 if solo-cracking a lone M(1)=100 home dominates."""

BREAKIN_ENERGY_COST: Final[float] = 15.0
"""Energy a ``break_in`` drains from the raider — a PURE SINK (destroyed, credited to no one).
[design — 2026-07-01, Layer 2c]. Mirrors ``ATTACK_ENERGY_COST`` so lone aggression self-limits."""

BREAKIN_MATERIALS_COST: Final[float] = 10.0
"""Materials a ``break_in`` drains from the raider — a PURE SINK (destroyed). [design — 2026-07-01,
Layer 2c]. Per-attempt cost (25 mat-equiv with energy) keeps typical vaults net-negative to raid;
only a hoard-tier (~300) vault repays a coordinated breach after the split + repair leakage."""
```

In `world/world.py`, add the two breacher methods in the "Home methods" section (e.g. after `withdraw_from_home_vault`):

```python
    def record_breacher(self, home_id: str, agent_id: str) -> bool:
        """Record ``agent_id`` as a breacher of a home (idempotent). Sync, event-free.

        Called by the ``break_in`` tool on every attempt; the set is the pool the thieve split /
        colonize enrolment draws from (filtered to co-located + living at the breaching blow), and
        it clears on full repair (the tick) so a repelled raid resets. Mutates
        :attr:`~world.homes.Home.breachers`.

        Args:
            home_id: Id of the home being broken into.
            agent_id: Id of the raider to record.

        Returns:
            ``True`` if the home exists (whether or not it was a duplicate); ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.breachers.add(agent_id)
        return True

    def clear_breachers(self, home_id: str) -> bool:
        """Clear a home's breacher set. Sync, event-free.

        Called by the world-tick when a covered repair restores integrity to its ceiling (a
        repelled raid resets, spec Fork D) and by :meth:`make_ruin` (a ruin is not contestable).
        Mutates :attr:`~world.homes.Home.breachers`.

        Args:
            home_id: Id of the home whose breachers to clear.

        Returns:
            ``True`` if the home exists; ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.breachers.clear()
        return True
```

In `world/tick.py`, in the **covered** branch (right after the incremental repair line), clear breachers once at the ceiling:

```python
            world.modify_home_integrity(home.home_id, HOME_REPAIR_PER_SECOND * elapsed)
            if home.integrity >= max_integrity(len(home.stakeholders)):
                world.clear_breachers(home.home_id)  # a repelled raid resets (Fork D)
            home.last_upkeep_at = now  # advance only on a covered tick
```

In `tools/builtin/homes.py`, add `break_in` (after `withdraw_from_home`), importing the dials:

```python
from core.constants import (
    BREAKIN_ENERGY_COST,
    BREAKIN_INTEGRITY_DAMAGE,
    BREAKIN_MATERIALS_COST,
    HEARTH_ENERGY_PER_MATERIAL,
    HEARTH_MATERIALS_PER_USE,
    HOME_BUILD_MATERIALS_COST,
    HOME_MAX_INTEGRITY,
)
```

```python
async def break_in(
    world: WorldState, event_bus: EventBus, agent_id: str, target_home: str, intent: str
) -> str:
    """Force your way into a co-located home that is not your own, wearing at its integrity.

    Each attempt drains a PURE SINK of :data:`~core.constants.BREAKIN_ENERGY_COST` energy +
    :data:`~core.constants.BREAKIN_MATERIALS_COST` materials from the raider (destroyed, credited
    to no one — conservation), records the raider in the home's ``breachers``, and removes
    :data:`~core.constants.BREAKIN_INTEGRITY_DAMAGE` integrity. The home is **breached** when the
    blow drives integrity ``<= 0``; the breaching blow will execute ``intent`` atomically (thieve
    or colonize — Tasks 4a/4b). A lone raider is out-healed by the home's repair between breaths
    and self-limits by the resource burn; a coordinated group stacking damage inside one repair
    window makes net progress.

    Mutates world state:
        * Drains ``BREAKIN_ENERGY_COST`` energy + ``BREAKIN_MATERIALS_COST`` materials from the
          raider (pure sinks); records the raider via
          :meth:`~world.world.WorldState.record_breacher`; applies ``-BREAKIN_INTEGRITY_DAMAGE``
          via :meth:`~world.world.WorldState.modify_home_integrity` (floored at 0).

    Emits events:
        * On a breach (integrity ``<= 0``): one ``"home_breached"`` event
          (:attr:`~bus.events.ScopeType.LOCAL`, source = the raider, region = the home's region,
          stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the raiding being.
        target_home: Id of the co-located home to break into.
        intent: The raider's intent on breach, one of ``"thieve"`` or ``"colonize"``.

    Returns:
        A success sentence (a distinct "breached" sentence on the breaching blow); an
        ``"Error: "`` string if the raider or home is unknown; an ``"Invalid: "`` string for a bad
        intent, a ruined target, a target it stakes, a target in another region, or too little
        energy/materials to pay the cost (rejected calls mutate nothing).
    """
    if intent not in ("thieve", "colonize"):
        return "Invalid: You must mean either to take a home's store (thieve) or seize it (colonize)."
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot force your way into a home; "
            "only another being can restore you."
        )
    home = world.get_home(target_home)
    if home is None:
        return "Error: There is no such home here to break into."
    if home.status is not HomeStatus.STANDING:
        return "Invalid: That home is already a ruin; there is nothing to break into."
    if home.region != agent.current_position:
        return "Invalid: You are not where that home stands; you can only break into a home in your place."
    if world.is_stakeholder(target_home, agent_id):
        return "Invalid: This is your own home; you cannot break into it."
    if agent.current_energy < BREAKIN_ENERGY_COST or agent.current_materials < BREAKIN_MATERIALS_COST:
        return (
            f"Invalid: Forcing a home costs {BREAKIN_ENERGY_COST:.0f} energy and "
            f"{BREAKIN_MATERIALS_COST:.0f} materials; you hold {agent.current_energy} energy and "
            f"{agent.current_materials} materials."
        )

    # Pay the cost — a PURE SINK (both pools destroyed, credited to no one).
    world.modify_agent_energy(agent_id, -BREAKIN_ENERGY_COST)
    world.modify_agent_materials(agent_id, -BREAKIN_MATERIALS_COST)
    world.record_breacher(target_home, agent_id)
    world.modify_home_integrity(target_home, -BREAKIN_INTEGRITY_DAMAGE)  # floors at 0

    region = home.region
    if home.integrity <= 0.0:
        await event_bus.publish(
            Event(
                "home_breached",
                agent_id,
                {"message": f"{agent.name} has broken into the home {home.home_id} in {region}."},
                scope=ScopeType.LOCAL,
                region=region,
                timestamp=world.now(),
            )
        )
        # Task 4a inserts the thieve branch, Task 4b the colonize branch, before this line.
        return f"You break the home {home.home_id} open — it can no longer keep anyone out."
    return (
        f"You batter the home {home.home_id}; its soundness drops to {home.integrity:.1f} but it "
        f"still stands. You spent {BREAKIN_ENERGY_COST:.0f} energy and {BREAKIN_MATERIALS_COST:.0f} materials."
    )
```

Register in `tools/builtin/__init__.py` (import, `__all__` alpha-position, `BUILTIN_TOOLS`):

```python
    "withdraw_from_home": withdraw_from_home,
    "break_in": break_in,
```

Add the schema to `agents/tool_schemas.py` (import the three dials; add after `withdraw_from_home`):

```python
    "break_in": {
        "type": "function",
        "function": {
            "name": "break_in",
            "description": (
                "Force your way into a home in your place that is not your own. Each attempt wears "
                f"at its soundness and costs you {BREAKIN_ENERGY_COST:.0f} energy and "
                f"{BREAKIN_MATERIALS_COST:.0f} materials, spent whether or not it gives way. A home "
                "tended by many mends faster than one being can break it, so it takes several "
                "breaking in together to bring one down. When it gives way you take its store "
                "(thieve) or seize it for your own (colonize), as you intend."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_home": {
                        "type": "string",
                        "description": "Id of the home in your place to break into.",
                    },
                    "intent": {
                        "type": "string",
                        "enum": ["thieve", "colonize"],
                        "description": "Whether to take the home's store (thieve) or seize it (colonize).",
                    },
                },
                "required": ["target_home", "intent"],
            },
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/core/constants_test.py tests/world/world_test.py tests/world/tick_test.py tests/tools/homes_test.py tests/agents/tool_schemas_test.py -v`
Expected: PASS — break_in mechanics, the pure-sink conservation, coordination/lone dynamics, the tick clear-on-repair, and schema parity (both maps gained `break_in`) all green.

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/world.py world/tick.py tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/
git commit -m "feat(tools): break_in + breach mechanic + breacher tracking (L2c Task 3)"
```

---

## Task 4a: Thieve outcome (MANDATORY #2 + Fork E)

Wire the **thieve** branch into `break_in`'s breaching blow: split `vault_materials` equally among the co-located, ALIVE breachers (the **final striker always included**, even if the cost just paralysed it; **remainder to the final striker** so `Σ splits == vault`), **zero the vault**, and **leave the home STANDING at ~0** — never `make_ruin` (that would double-count a split vault into a remnant; the tick makes the ruin later). Publish `home_thieved`. Colonize still falls through to the plain breach string until Task 4b.

**Files:**
- Modify: `tools/builtin/homes.py` (`break_in` — insert the thieve branch)
- Test: `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `WorldState.withdraw_from_home_vault` (zeros the vault, deduct-source-first), `WorldState.modify_agent_materials`, `WorldState.get_agent`; `world.agents.AgentStatus`.
- Produces: `break_in` with `intent == "thieve"` executes the split atomically on the breaching blow and emits `"home_thieved"` (LOCAL).

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/homes_test.py`:

```python
async def test_break_in_thieve_splits_vault_conserved_and_leaves_standing_at_zero(
    world: WorldState, event_bus: EventBus
) -> None:
    """The breaching blow with intent=thieve splits the vault among co-located living breachers,
    zeros it, leaves the home STANDING at 0 (MANDATORY #2), and conserves the materials moved."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=BREAKIN_INTEGRITY_DAMAGE)  # one blow from breach
    world.deposit_to_home_vault("h1", 90.0)  # vault to split
    _add_raiders(world, event_bus, "raider_a")  # + wanderer_002 = two raiders co-located
    boris = world.get_agent("wanderer_002")
    raider_a = world.get_agent("raider_a")
    assert boris is not None and raider_a is not None
    # raider_a strikes first (pre-breach, records as a breacher); wanderer_002 lands the breach.
    await break_in(world, event_bus, "raider_a", "h1", "thieve")  # 25 -> 0? no: integrity was 25 -> 0 -> breach!
```

> NOTE for the implementer: with `integrity == BREAKIN_INTEGRITY_DAMAGE` the FIRST blow breaches, so use a **two-blow** setup for a two-breacher split. Write the test with `integrity = 2 * BREAKIN_INTEGRITY_DAMAGE` so `raider_a`'s blow is pre-breach (records it) and `wanderer_002`'s blow breaches:

```python
async def test_break_in_thieve_splits_vault_conserved_and_leaves_standing_at_zero(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=2 * BREAKIN_INTEGRITY_DAMAGE)  # two blows from breach
    world.deposit_to_home_vault("h1", 90.0)
    _add_raiders(world, event_bus, "raider_a")
    boris = world.get_agent("wanderer_002")
    raider_a = world.get_agent("raider_a")
    assert boris is not None and raider_a is not None
    boris.current_materials = 40.0
    raider_a.current_materials = 40.0

    await break_in(world, event_bus, "raider_a", "h1", "thieve")  # -25 -> 25 (pre-breach, records raider_a)
    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")  # -25 -> 0 -> breach + thieve

    home = world.get_home("h1")
    assert home is not None
    assert home.status is HomeStatus.STANDING  # MANDATORY #2: standing at 0, NOT a ruin
    assert home.integrity == 0.0
    assert home.vault_materials == 0.0  # emptied
    # 90 split two ways == 45 each (remainder to the final striker, wanderer_002).
    assert boris.current_materials == pytest.approx(40.0 - BREAKIN_MATERIALS_COST + 45.0)
    assert raider_a.current_materials == pytest.approx(40.0 - BREAKIN_MATERIALS_COST + 45.0)
    thieved = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_thieved"]
    assert len(thieved) == 1 and thieved[0].scope is ScopeType.LOCAL and thieved[0].region == "alpha"
    assert "strip" in result.lower()


async def test_break_in_thieve_excludes_departed_or_dead_breachers(
    world: WorldState, event_bus: EventBus
) -> None:
    """A breacher who left the region (or died) is not a recipient; the whole vault still goes to
    the remaining co-located living breachers (Σ == vault; remainder to the final striker)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=2 * BREAKIN_INTEGRITY_DAMAGE)
    world.deposit_to_home_vault("h1", 100.0)
    _add_raiders(world, event_bus, "raider_a")
    boris = world.get_agent("wanderer_002")
    raider_a = world.get_agent("raider_a")
    assert boris is not None and raider_a is not None
    boris.current_materials = 0.0

    await break_in(world, event_bus, "raider_a", "h1", "thieve")  # records raider_a, integrity -> 25
    assert world.move_agent("raider_a", "beta") is True  # raider_a wanders off before the breach
    # wanderer_002 needs to afford the cost; give it materials for the break_in fee only.
    boris.current_materials = BREAKIN_MATERIALS_COST
    result = await break_in(world, event_bus, "wanderer_002", "h1", "thieve")  # breach + thieve

    home = world.get_home("h1")
    assert home is not None and home.vault_materials == 0.0
    # Only wanderer_002 is co-located+alive -> it takes the whole 100 (remainder-to-final-striker).
    assert boris.current_materials == pytest.approx(100.0)  # 0 after paying the fee, +100 loot
    assert "strip" in result.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k thieve -v`
Expected: FAIL — the breaching blow does not thieve yet (vault untouched, no `home_thieved`).

- [ ] **Step 3: Implement the thieve branch**

In `tools/builtin/homes.py::break_in`, replace the breach block's trailing `return` with the thieve dispatch (colonize still falls through to the plain breach return):

```python
    region = home.region
    if home.integrity <= 0.0:
        await event_bus.publish(
            Event(
                "home_breached",
                agent_id,
                {"message": f"{agent.name} has broken into the home {home.home_id} in {region}."},
                scope=ScopeType.LOCAL,
                region=region,
                timestamp=world.now(),
            )
        )
        if intent == "thieve":
            loot = home.vault_materials
            # Recipients: the final striker ALWAYS (it landed the breaching blow, even if the cost
            # just paralysed it), plus every OTHER breacher co-located and ALIVE.
            recipients = [agent_id] + [
                b
                for b in sorted(home.breachers)
                if b != agent_id
                and (peer := world.get_agent(b)) is not None
                and peer.status is AgentStatus.ALIVE
                and peer.current_position == region
            ]
            world.withdraw_from_home_vault(target_home, loot)  # deduct the WHOLE vault FIRST -> 0 (conservation)
            share = loot / len(recipients)
            for recipient in recipients:
                if recipient == agent_id:
                    continue
                world.modify_agent_materials(recipient, share)
            # Remainder to the final striker so Σ splits == loot EXACTLY (no float drift).
            world.modify_agent_materials(agent_id, loot - share * (len(recipients) - 1))
            await event_bus.publish(
                Event(
                    "home_thieved",
                    agent_id,
                    {
                        "message": (
                            f"{agent.name} and {len(recipients) - 1} other(s) stripped the home "
                            f"{home.home_id} of {loot} materials."
                        )
                    },
                    scope=ScopeType.LOCAL,
                    region=region,
                    timestamp=world.now(),
                )
            )
            return (
                f"You break the home {home.home_id} open and strip its store — {loot} materials, "
                f"split among {len(recipients)}. The emptied wreck still stands, for now."
            )
        return f"You break the home {home.home_id} open — it can no longer keep anyone out."
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py -v`
Expected: PASS — thieve splits conserved, leaves STANDING at 0, excludes departed breachers; Task 3 break_in tests still green.

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/homes.py tests/tools/homes_test.py
git commit -m "feat(tools): break_in thieve outcome — split vault, standing-at-0 (L2c Task 4a)"
```

---

## Task 4b: Colonize outcome (MANDATORY #3)

Wire the **colonize** branch into `break_in`'s breaching blow via a new `WorldState.colonize_home`: the final striker becomes `owner_id`; **only currently-homeless** (`stakeholder_home_of is None`) co-located ALIVE breachers become the new stakeholders (the rest merely participated); priors are evicted; vault+structure retained; integrity stays ~0. **At-most-one-home**: if the final striker already holds a home, it is **auto-detached** first (`remove_stakeholder`, which promotes a survivor in the old home) so a being never stakes two homes. Publish `home_colonized`.

**Files:**
- Modify: `world/world.py` (`colonize_home`)
- Modify: `tools/builtin/homes.py` (`break_in` — insert the colonize branch)
- Test: `tests/world/world_test.py`, `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `WorldState.stakeholder_home_of`, `WorldState.remove_stakeholder`, `WorldState.get_agent`; `world.agents.AgentStatus`.
- Produces:
  - `WorldState.colonize_home(self, home_id: str, new_owner: str, new_stakeholders: list[str]) -> bool` — sets `owner_id = new_owner`, overwrites `stakeholders = list(new_stakeholders)` (evicting priors), re-clamps integrity to the new ceiling, retains `vault_materials`; `True` if the home exists.
  - `break_in` with `intent == "colonize"` seizes the home atomically and emits `"home_colonized"` (LOCAL).

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/world_test.py`:

```python
def test_colonize_home_reassigns_evicts_and_retains_vault(world: WorldState) -> None:
    """colonize_home overwrites owner+stakeholders (evicting priors), retains vault, re-clamps integrity."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.add_stakeholder("h1", "wanderer_002")  # prior owner+stakeholder set: {001, 002}
    world.deposit_to_home_vault("h1", 55.0)

    assert world.colonize_home("h1", "raider_a", ["raider_a", "raider_b"]) is True

    home = world.homes["h1"]
    assert home.owner_id == "raider_a"
    assert home.stakeholders == ["raider_a", "raider_b"]  # priors evicted
    assert home.vault_materials == 55.0  # retained (no resource move)
    assert home.integrity == 0.0  # re-clamp does not raise a ~0 integrity
    assert world.colonize_home("missing", "x", ["x"]) is False
```

Append to `tests/tools/homes_test.py`:

```python
async def test_break_in_colonize_seizes_owner_and_homeless_breachers(
    world: WorldState, event_bus: EventBus
) -> None:
    """intent=colonize: final striker -> owner; only homeless co-located living breachers -> stakeholders;
    priors evicted; vault+structure retained; integrity ~0; home_colonized fires."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=2 * BREAKIN_INTEGRITY_DAMAGE)
    world.deposit_to_home_vault("h1", 30.0)  # retained through colonize
    _add_raiders(world, event_bus, "raider_a")  # homeless raider
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    await break_in(world, event_bus, "raider_a", "h1", "colonize")  # pre-breach, records raider_a
    result = await break_in(world, event_bus, "wanderer_002", "h1", "colonize")  # breach + colonize

    home = world.get_home("h1")
    assert home is not None
    assert home.status is HomeStatus.STANDING
    assert home.owner_id == "wanderer_002"  # final striker
    assert set(home.stakeholders) == {"wanderer_002", "raider_a"}  # both homeless + co-located + alive
    assert "wanderer_001" not in home.stakeholders  # prior owner evicted
    assert home.vault_materials == 30.0  # retained
    colonized = [e for e in event_bus.get_events("wanderer_001") if e.type == "home_colonized"]
    assert len(colonized) == 1
    assert "seiz" in result.lower() or "take it" in result.lower()


async def test_break_in_colonize_enrolls_only_homeless_breachers(
    world: WorldState, event_bus: EventBus
) -> None:
    """A breacher that already stakes another home merely participates — it is not enrolled (MANDATORY #3)."""
    world.build_home("target", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=2 * BREAKIN_INTEGRITY_DAMAGE)
    world.build_home("raider_a_home", "raider_a", "alpha", built_at=world.now(), integrity=100.0)
    _add_raiders(world, event_bus)  # raider_a already added by build; ensure subscribed
    event_bus.subscribe("raider_a")
    raider_a = world.get_agent("raider_a")
    if raider_a is None:
        world.add_agent(AgentState(id="raider_a", name="Raider_A", persona="p",
                                   current_position="alpha", current_energy=100.0,
                                   current_materials=100.0, status=AgentStatus.ALIVE))
    world.add_stakeholder("raider_a_home", "raider_a")  # raider_a is homed
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    await break_in(world, event_bus, "raider_a", "target", "colonize")  # records raider_a (homed)
    await break_in(world, event_bus, "wanderer_002", "target", "colonize")  # breach + colonize

    home = world.get_home("target")
    assert home is not None
    assert home.owner_id == "wanderer_002"
    assert home.stakeholders == ["wanderer_002"]  # raider_a NOT enrolled (already homed)
    assert world.stakeholder_home_of("raider_a") is not None  # keeps its own home


async def test_break_in_colonize_auto_detaches_a_homed_final_striker(
    world: WorldState, event_bus: EventBus
) -> None:
    """A final striker that already holds a home is auto-detached from it before taking the new one,
    preserving at-most-one-home (MANDATORY #3)."""
    world.build_home("target", "wanderer_001", "alpha", built_at=world.now(),
                     integrity=BREAKIN_INTEGRITY_DAMAGE)  # one blow from breach
    world.build_home("boris_home", "wanderer_002", "alpha", built_at=world.now(), integrity=100.0)
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    result = await break_in(world, event_bus, "wanderer_002", "target", "colonize")  # breach + colonize

    target = world.get_home("target")
    assert target is not None and target.owner_id == "wanderer_002"
    # At-most-one-home: wanderer_002's ONLY home is now the colonized target.
    home_now = world.stakeholder_home_of("wanderer_002")
    assert home_now is not None and home_now.home_id == "target"
    assert world.is_stakeholder("boris_home", "wanderer_002") is False  # detached from the old home
    assert "seiz" in result.lower() or "take it" in result.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/world_test.py -k colonize tests/tools/homes_test.py -k colonize -v`
Expected: FAIL — `colonize_home` does not exist; the breaching blow with intent=colonize falls through to the plain breach string.

- [ ] **Step 3: Implement `colonize_home` and the colonize branch**

In `world/world.py`, add `colonize_home` (after `remove_stakeholder`):

```python
    def colonize_home(self, home_id: str, new_owner: str, new_stakeholders: list[str]) -> bool:
        """Seize a home for new owners: reassign owner+stakeholders, evict priors, retain vault/structure.

        The breach-outcome primitive (Layer 2c colonize). Overwrites :attr:`~world.homes.Home.owner_id`
        and :attr:`~world.homes.Home.stakeholders` (the prior owner + stakeholders are simply replaced —
        evicted), then re-clamps integrity to the new stakeholder-scaled ceiling. The vault and structure
        are untouched (no resource move → trivially conserved); integrity stays wherever the breach left
        it (~0), so the new owners must shore it up before it collapses. The caller (the ``break_in`` tool)
        pre-filters ``new_stakeholders`` to currently-homeless co-located living breachers and guarantees
        the at-most-one-home invariant (auto-detaching a homed final striker first). Sync, event-free.

        Args:
            home_id: Id of the home to seize.
            new_owner: Id of the new owner (the final striker; also first in ``new_stakeholders``).
            new_stakeholders: The new stakeholder list (owner first), pre-filtered by the caller.

        Returns:
            ``True`` if the home exists and was reassigned; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.owner_id = new_owner
        home.stakeholders = list(new_stakeholders)
        self.modify_home_integrity(home_id, 0.0)  # re-clamp to the new ceiling (a ~0 integrity is unchanged)
        return True
```

In `tools/builtin/homes.py::break_in`, replace the trailing `return f"You break the home {home.home_id} open — ..."` (the colonize fall-through) with the colonize branch:

```python
        # intent == "colonize"
        old = world.stakeholder_home_of(agent_id)
        if old is not None:
            world.remove_stakeholder(old.home_id, agent_id)  # at-most-one-home: abandon the old home first
        new_stakeholders = [agent_id] + [
            b
            for b in sorted(home.breachers)
            if b != agent_id
            and (peer := world.get_agent(b)) is not None
            and peer.status is AgentStatus.ALIVE
            and peer.current_position == region
            and world.stakeholder_home_of(b) is None  # only currently-homeless breachers (MANDATORY #3)
        ]
        world.colonize_home(target_home, agent_id, new_stakeholders)
        await event_bus.publish(
            Event(
                "home_colonized",
                agent_id,
                {
                    "message": (
                        f"{agent.name} and {len(new_stakeholders) - 1} other(s) seized the home "
                        f"{home.home_id} in {region}."
                    )
                },
                scope=ScopeType.LOCAL,
                region=region,
                timestamp=world.now(),
            )
        )
        return (
            f"You break the home {home.home_id} open and take it for your own. {len(new_stakeholders)} "
            f"of you hold it now; shore it up before it falls."
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/world_test.py tests/tools/homes_test.py -v`
Expected: PASS — colonize reassigns/evicts/retains-vault, enrolls only homeless breachers, auto-detaches a homed final striker; thieve + break_in tests still green.

- [ ] **Step 5: Commit**

```bash
git add world/world.py tools/builtin/homes.py tests/
git commit -m "feat(tools): break_in colonize outcome + colonize_home + at-most-one-home (L2c Task 4b)"
```

---

## Task 5: Ruins — `make_ruin` / `scavenge_ruin` / `scavenge_ruins` / collapse→ruin + sweep

Add the ruin lifecycle: `make_ruin(home_id)` computes `remnant = RUINS_SCAVENGE_FRACTION*(HOME_BUILD_MATERIALS_COST + vault)` then zeroes the vault, clears stakeholders + breachers, sets `status=RUIN`/`ruined_at=now`; `scavenge_ruin(home_id, amount) -> float` deducts remnant-first (capped) and returns the actual amount. Repurpose the tick collapse path (`remove_home` → `make_ruin`, `home_collapsed` message → "crumbled to ruin") and add a **corpse-style ruin-sweep** that removes a ruin after `RUINS_PERSIST_SECONDS` (silently — the observer sees it vanish from the world-table; the named 2c event set has no sweep event). Add the `scavenge_ruins` tool (co-located, deduct-remnant-first, `<= remnant`) emitting `ruins_scavenged`. This CLOSES 2b's collapse-destroys-the-vault leak (the vault now feeds the remnant).

**Files:**
- Modify: `core/constants.py` (`RUINS_SCAVENGE_FRACTION`, `RUINS_PERSIST_SECONDS`)
- Modify: `world/world.py` (`make_ruin`, `scavenge_ruin`)
- Modify: `world/tick.py` (collapse → `make_ruin` + repurposed message; ruin-sweep loop)
- Modify: `tools/builtin/homes.py` (`scavenge_ruins`)
- Modify: `tools/builtin/__init__.py` (register `scavenge_ruins`)
- Modify: `agents/tool_schemas.py` (`scavenge_ruins` schema)
- Test: `tests/core/constants_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `core.constants.RUINS_SCAVENGE_FRACTION`/`RUINS_PERSIST_SECONDS`/`HOME_BUILD_MATERIALS_COST`; `world.homes.HomeStatus`; `WorldState.get_home`/`get_all_homes`/`remove_home`/`modify_agent_materials`.
- Produces:
  - `WorldState.make_ruin(self, home_id: str) -> bool` — remnant math, then zero vault / clear stakeholders+breachers / set `RUIN`+`ruined_at=now`; `True` if the home exists.
  - `WorldState.scavenge_ruin(self, home_id: str, amount: float) -> float` — `taken = max(0.0, min(amount, remnant))`; `remnant -= taken`; returns `taken` (`0.0` for an unknown home).
  - `tools.builtin.homes.scavenge_ruins(world, event_bus, agent_id, target_home, amount) -> str` + `"scavenge_ruins"` in `BUILTIN_TOOLS`/`__all__`/`TOOL_SCHEMAS`.
  - Tick collapse path calls `make_ruin`; a ruin-sweep loop removes ruins past `RUINS_PERSIST_SECONDS`.
  - `RUINS_SCAVENGE_FRACTION = 0.5`, `RUINS_PERSIST_SECONDS = 120.0`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/core/constants_test.py`:

```python
def test_ruins_dials_present_and_conserving() -> None:
    """The ruins dials exist; the scavenge fraction is strictly < 1 (a build->ruin farm is a net loss)."""
    assert isinstance(constants.RUINS_SCAVENGE_FRACTION, float)
    assert 0.0 < constants.RUINS_SCAVENGE_FRACTION < 1.0  # < 1 is the hard conservation floor
    assert isinstance(constants.RUINS_PERSIST_SECONDS, float)
    assert constants.RUINS_PERSIST_SECONDS > 0.0
```

Append to `tests/world/world_test.py` (add `RUINS_SCAVENGE_FRACTION`, `HOME_BUILD_MATERIALS_COST` to the `core.constants` import):

```python
def test_make_ruin_computes_remnant_zeros_vault_and_clears(world: WorldState) -> None:
    """make_ruin: remnant = FRACTION*(BUILD_COST + vault); vault zeroed; stakeholders + breachers cleared."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.add_stakeholder("h1", "wanderer_002")
    world.deposit_to_home_vault("h1", 40.0)
    world.record_breacher("h1", "wanderer_002")

    assert world.make_ruin("h1") is True

    home = world.homes["h1"]
    assert home.status is HomeStatus.RUIN
    assert home.ruined_at == world.now()
    assert home.remnant_materials == pytest.approx(
        RUINS_SCAVENGE_FRACTION * (HOME_BUILD_MATERIALS_COST + 40.0)
    )
    assert home.vault_materials == 0.0  # consumed into the remnant (no double count)
    assert home.stakeholders == []
    assert home.breachers == set()
    assert world.make_ruin("missing") is False


def test_scavenge_ruin_deducts_remnant_and_caps(world: WorldState) -> None:
    """scavenge_ruin returns the actual taken (capped at remnant) and lowers the remnant; unknown -> 0.0."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("h1")
    r0 = world.homes["h1"].remnant_materials
    assert world.scavenge_ruin("h1", 10.0) == pytest.approx(10.0)
    assert world.homes["h1"].remnant_materials == pytest.approx(r0 - 10.0)
    assert world.scavenge_ruin("h1", 10_000.0) == pytest.approx(r0 - 10.0)  # capped at what remains
    assert world.homes["h1"].remnant_materials == 0.0
    assert world.scavenge_ruin("missing", 5.0) == 0.0
```

Append to `tests/tools/homes_test.py` (add `scavenge_ruins` to the `tools.builtin.homes` import):

```python
async def test_scavenge_ruins_moves_remnant_to_personal_conserving(
    world: WorldState, event_bus: EventBus
) -> None:
    """A co-located being draws remnant -> personal, exactly (remnant down == personal up); ruins_scavenged fires."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("h1")
    remnant = world.homes["h1"].remnant_materials
    boris = world.get_agent("wanderer_002")  # co-located, anyone may scavenge
    assert boris is not None
    boris.current_materials = 0.0

    result = await scavenge_ruins(world, event_bus, "wanderer_002", "h1", 15.0)

    assert world.homes["h1"].remnant_materials == pytest.approx(remnant - 15.0)
    assert boris.current_materials == pytest.approx(15.0)  # moved, not minted
    scav = [e for e in event_bus.get_events("wanderer_002") if e.type == "ruins_scavenged"]
    assert len(scav) == 1 and scav[0].scope is ScopeType.LOCAL and scav[0].region == "alpha"
    assert result.startswith("You pick")


async def test_scavenge_ruins_guards(world: WorldState, event_bus: EventBus) -> None:
    """Guards: unknown ruins (Error), a STANDING home (Invalid), not co-located (Invalid), picked-clean (Invalid)."""
    world.build_home("standing", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    world.build_home("ruin", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("ruin")
    boris = world.get_agent("wanderer_002")
    assert boris is not None

    assert (await scavenge_ruins(world, event_bus, "wanderer_002", "nope", 5.0)).startswith("Error:")
    assert (await scavenge_ruins(world, event_bus, "wanderer_002", "standing", 5.0)).startswith("Invalid:")
    assert world.move_agent("wanderer_002", "beta") is True
    assert (await scavenge_ruins(world, event_bus, "wanderer_002", "ruin", 5.0)).startswith("Invalid:")  # not co-located
    assert world.move_agent("wanderer_002", "alpha") is True
    world.scavenge_ruin("ruin", world.homes["ruin"].remnant_materials)  # empty it
    assert (await scavenge_ruins(world, event_bus, "wanderer_002", "ruin", 5.0)).startswith("Invalid:")  # picked clean


async def test_scavenge_ruins_caps_at_remnant(world: WorldState, event_bus: EventBus) -> None:
    """Over-asking takes only what remains (no mint)."""
    world.build_home("ruin", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("ruin")
    remnant = world.homes["ruin"].remnant_materials
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    boris.current_materials = 0.0
    await scavenge_ruins(world, event_bus, "wanderer_002", "ruin", 10_000.0)
    assert boris.current_materials == pytest.approx(remnant)  # only what remained
    assert world.homes["ruin"].remnant_materials == 0.0
```

Rework the collapse tests in `tests/world/tick_test.py` — collapse now leaves a **RUIN** (not removal), and a ruin sweeps after the persist window (add `RUINS_PERSIST_SECONDS` to the `core.constants` import):
- `test_tick_dead_owner_cannot_pay_decays_and_collapses`: replace `assert world.home_of("wanderer_002") is None` with
  ```python
  ruin = world.get_home("home_boris")
  assert ruin is not None and ruin.status is HomeStatus.RUIN  # collapse now leaves a ruin
  ```
  keep the `home_collapsed` assertions (it still fires once).
- `test_tick_swept_owner_missing_decays_and_collapses`: same swap (`get_home(...).status is HomeStatus.RUIN`), keep the single `home_collapsed`.
- `test_tick_ownerless_home_with_no_living_payers_decays_to_collapse`: same swap.
- `test_tick_home_collapse_fires_once`: after the first tick, assert the home is a RUIN (not None) and `home_collapsed` fired once; after the second tick (still within the persist window), assert still a RUIN and no second `home_collapsed`. Then add a third phase:
  ```python
  fake_clock.advance(RUINS_PERSIST_SECONDS + 1.0)
  await tick(world, event_bus)
  assert world.get_home("home_boris") is None  # ruin swept after the persist window
  ```

Add a dedicated sweep test:

```python
async def test_tick_sweeps_a_ruin_after_the_persist_window(
    world: WorldState, event_bus: EventBus, fake_clock: FakeClock
) -> None:
    """A ruin lingers (scavengeable) until older than RUINS_PERSIST_SECONDS, then the tick removes it."""
    world.build_home("home_boris", "wanderer_002", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("home_boris")

    fake_clock.advance(RUINS_PERSIST_SECONDS - 1.0)
    await tick(world, event_bus)
    assert world.get_home("home_boris") is not None  # still lingering

    fake_clock.advance(2.0)  # now past the window
    await tick(world, event_bus)
    assert world.get_home("home_boris") is None  # swept
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/core/constants_test.py tests/world/world_test.py -k "ruin or scavenge" tests/world/tick_test.py tests/tools/homes_test.py -k scavenge -v`
Expected: FAIL — `RUINS_*`, `make_ruin`/`scavenge_ruin`, `scavenge_ruins` do not exist; collapse still removes the home.

- [ ] **Step 3: Implement the dials, world methods, tick repurpose+sweep, and the tool**

In `core/constants.py`, extend the L2c block:

```python
RUINS_SCAVENGE_FRACTION: Final[float] = 0.5
"""Fraction of a collapsed home's ``HOME_BUILD_MATERIALS_COST + vault`` that survives as a
scavengeable remnant. [design — 2026-07-01, Layer 2c].

MUST be ``< 1`` (a hard conservation floor, asserted): a build->collapse->scavenge loop must be a
NET LOSS (build 80 -> recover 40), never a materials farm. The non-recovered fraction is the sink.
Also converts 2b's untraceable collapse-destroys-the-vault loss into a partial, perceivable,
scavengeable remnant. A world-rule dial."""

RUINS_PERSIST_SECONDS: Final[float] = 120.0
"""How long a ruin lingers (scavengeable) before the world-tick sweeps it. [design — 2026-07-01,
Layer 2c]. Mirrors :data:`CORPSE_DECAY_SECONDS`: long enough for a passer-by to find and pick it
over, short enough that ruins never clutter the world without bound (run-forever). A world-rule dial."""
```

In `world/world.py`, import the two new constants + `HOME_BUILD_MATERIALS_COST` (`from core.constants import HOME_BUILD_MATERIALS_COST, PARALYSIS_ENERGY_THRESHOLD, RUINS_SCAVENGE_FRACTION`) and add the two methods (after `colonize_home`):

```python
    def make_ruin(self, home_id: str) -> bool:
        """Collapse a home into a scavengeable ruin. Sync, event-free.

        The sole ruin-maker, called only from the world-tick collapse path (a thieved home is left
        STANDING — MANDATORY #2 — so a split vault is never double-counted here). Computes the
        remnant as :data:`~core.constants.RUINS_SCAVENGE_FRACTION` of
        ``HOME_BUILD_MATERIALS_COST + vault_materials`` (fraction ``< 1`` — the rest is a permanent
        sink), then zeroes the vault (consumed into the remnant), clears stakeholders + breachers (a
        ruin is neither tended nor contestable), and marks it ``RUIN`` stamped with ``now``. Mutates
        :attr:`~world.homes.Home.remnant_materials`/``vault_materials``/``stakeholders``/``breachers``/
        ``status``/``ruined_at``.

        Args:
            home_id: Id of the home to ruin.

        Returns:
            ``True`` if the home exists and was ruined; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.remnant_materials = RUINS_SCAVENGE_FRACTION * (
            HOME_BUILD_MATERIALS_COST + home.vault_materials
        )
        home.vault_materials = 0.0
        home.stakeholders = []
        home.breachers.clear()
        home.status = HomeStatus.RUIN
        home.ruined_at = self.now()
        return True

    def scavenge_ruin(self, home_id: str, amount: float) -> float:
        """Draw up to ``amount`` materials from a ruin's remnant, returning the actual taken. Sync, event-free.

        The caller (the ``scavenge_ruins`` tool) credits the returned amount to the scavenger's
        personal stock (deduct-remnant-first — nothing minted). Caps the draw at what remains (so a
        ruin never goes negative). Mutates :attr:`~world.homes.Home.remnant_materials`.

        Args:
            home_id: Id of the ruin to draw from.
            amount: Materials the scavenger asked for.

        Returns:
            The actual materials removed from the remnant (``0.0`` for an unknown home or an empty ruin).
        """
        home = self.homes.get(home_id)
        if home is None:
            return 0.0
        taken = max(0.0, min(amount, home.remnant_materials))
        home.remnant_materials -= taken
        return taken
```

In `world/tick.py`, add `RUINS_PERSIST_SECONDS` to the `core.constants` import. In the collapse branch, swap `remove_home` for `make_ruin` and update the message:

```python
            if home.integrity <= 0.0:
                region = home.region
                world.make_ruin(home.home_id)  # repurposed: collapse leaves a scavengeable ruin (was remove_home)
                collapse_events.append(
                    Event(
                        type="home_collapsed",
                        source=home.owner_id,
                        payload={"message": f"A home in {region} has crumbled to ruin."},
                        scope=ScopeType.LOCAL,
                        region=region,
                        timestamp=now,
                    )
                )
```

Add a ruin-sweep loop after the upkeep loop (mirrors the corpse sweep; silent removal — the observer sees it vanish from the world-table):

```python
    # Sweep ruins older than RUINS_PERSIST_SECONDS (mirror the corpse sweep). Snapshot-then-mutate:
    # a ruin made THIS tick has ruined_at == now, so it is never swept in the same tick. Removal is
    # silent — the dramatic beats are collapse-to-ruin (home_collapsed) and scavenging; the observer
    # still perceives the ruin leave via the world-table snapshot.
    for home in list(world.get_all_homes()):
        if home.status is not HomeStatus.RUIN or home.ruined_at is None:
            continue
        if now - home.ruined_at < RUINS_PERSIST_SECONDS:
            continue
        world.remove_home(home.home_id)
```

Update the `tick` module/function docstrings to describe the collapse→ruin repurpose and the ruin-sweep.

In `tools/builtin/homes.py`, add `scavenge_ruins` (after `break_in`):

```python
async def scavenge_ruins(
    world: WorldState, event_bus: EventBus, agent_id: str, target_home: str, amount: float
) -> str:
    """Pick over the ruins of a fallen home where you stand, drawing materials into your own stock.

    Any co-located ALIVE being (a ruin has no owner to bar entry) draws up to ``amount`` materials
    from the ruin's ``remnant_materials``. Conserved: the remnant is deducted FIRST via
    :meth:`~world.world.WorldState.scavenge_ruin` (which caps at what remains), then the actual taken
    is credited to the scavenger — the same amount moved, nothing minted.

    Mutates world state:
        * Deducts the actual taken from the ruin's remnant, then credits it to the being's materials.

    Emits events:
        * One ``"ruins_scavenged"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source = the scavenger,
          region = the ruin's region, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the scavenging being.
        target_home: Id of the co-located ruin to pick over.
        amount: Materials to draw from the remnant (capped at what remains).

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being or ruin is
        unknown; an ``"Invalid: "`` string if the amount is not positive, the being is fallen, the
        target still stands, it is not co-located, or the ruin is already picked clean (rejected
        calls mutate nothing).
    """
    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return "Invalid: You are fallen and cannot pick over ruins; only another being can restore you."
    home = world.get_home(target_home)
    if home is None:
        return "Error: There are no such ruins here to pick over."
    if home.status is not HomeStatus.RUIN:
        return "Invalid: That home still stands; there are no ruins here to pick over."
    if home.region != agent.current_position:
        return "Invalid: You are not where those ruins lie."
    if home.remnant_materials <= 0.0:
        return "Invalid: These ruins have already been picked clean."

    taken = world.scavenge_ruin(target_home, quantity)  # deduct the remnant FIRST (conservation)
    world.modify_agent_materials(agent_id, taken)  # THEN credit personal stock
    await event_bus.publish(
        Event(
            "ruins_scavenged",
            agent_id,
            {"message": f"{agent.name} picks {taken} materials from the ruins in {home.region}."},
            scope=ScopeType.LOCAL,
            region=home.region,
            timestamp=world.now(),
        )
    )
    return (
        f"You pick {taken} materials from the ruins. They hold {home.remnant_materials} more; "
        f"you hold {agent.current_materials}."
    )
```

Register `scavenge_ruins` in `tools/builtin/__init__.py` (import, `__all__`, `BUILTIN_TOOLS`) and add its schema to `agents/tool_schemas.py`:

```python
    "scavenge_ruins": {
        "type": "function",
        "function": {
            "name": "scavenge_ruins",
            "description": (
                "Pick over the ruins of a fallen home in your place for what materials still lie in "
                "it, drawing some into your own holding. You cannot take more than the ruins hold."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "target_home": {
                        "type": "string",
                        "description": "Id of the ruins in your place to pick over.",
                    },
                    "amount": {
                        "type": "number",
                        "description": "How many materials to draw from the ruins.",
                    },
                },
                "required": ["target_home", "amount"],
            },
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/core/constants_test.py tests/world/ tests/tools/homes_test.py tests/agents/tool_schemas_test.py -v`
Expected: PASS — ruin math, scavenge, collapse→ruin, ruin-sweep, and schema parity (both maps gained `scavenge_ruins`) all green.

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/world.py world/tick.py tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/
git commit -m "feat(ruins): make_ruin/scavenge_ruin + collapse->ruin + ruin-sweep + scavenge_ruins (L2c Task 5)"
```

---

## Task 6a: Observer visibility — world-table markers/columns + feed verbs (carried 2b)

Rework the world-table for the contest layer: a `(hoarding)` marker on **both** the agents section (reuse `world.agents.is_hoarding`) AND the homes section (reuse `world.homes.home_is_hoarding` — the carried-2b consistency pass), plus **Status / Breachers / Remnant** columns on the homes table. Teach the feed the four new event verbs (`home_breached`, `home_thieved`, `home_colonized`, `ruins_scavenged`).

**Files:**
- Modify: `observability/activity_feed.py` (`_EVENT_VERBS`; `render_world_table`)
- Test: `tests/observability/activity_feed_test.py`

**Interfaces:**
- Consumes: `world.agents.is_hoarding`, `world.homes.home_is_hoarding`, `world.homes.HomeStatus` (existing), `Home.status`/`breachers`/`remnant_materials`.
- Produces: `_EVENT_VERBS` gains the four verbs; agents table appends `(hoarding)` to the Materials cell; homes table gains Status/Breachers/Remnant columns and appends `(hoarding)` to the Vault cell.

- [ ] **Step 1: Write the failing tests**

Append to `tests/observability/activity_feed_test.py` (add `HOARDING_MATERIALS_THRESHOLD` to the `core.constants` import):

```python
def test_render_event_contest_verbs_are_human_readable() -> None:
    """Message-less contest events fall back to a distinct verb per type (not the raw type)."""
    for etype, needle in (
        ("home_breached", "broke into a home"),
        ("home_thieved", "stripped a home"),
        ("home_colonized", "seized a home"),
        ("ruins_scavenged", "picked over ruins"),
    ):
        event = Event(etype, "wanderer_002", {}, scope=ScopeType.LOCAL)
        assert needle in render_event(event).lower()


def test_render_world_table_marks_a_hoarding_agent(world: WorldState) -> None:
    """The agents section marks a being over a hoarding threshold (carried-2b consistency)."""
    from rich.console import Console

    ada = world.get_agent("wanderer_001")
    assert ada is not None
    ada.current_materials = HOARDING_MATERIALS_THRESHOLD  # hoarding on materials
    text = "".join(seg.text for seg in Console(width=200).render(render_world_table(world)))
    ada_rows = [line for line in text.splitlines() if "wanderer_001" in line]
    assert ada_rows and "hoarding" in ada_rows[0].lower()


def test_render_world_table_marks_a_hoarding_home_and_shows_contest_columns(world: WorldState) -> None:
    """The homes section marks a hoarding vault and shows Status/Breachers/Remnant."""
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.deposit_to_home_vault("home_ada", HOARDING_MATERIALS_THRESHOLD + 5.0)  # hoarding home
    world.record_breacher("home_ada", "wanderer_002")
    text = "".join(seg.text for seg in Console(width=250).render(render_world_table(world)))

    assert "Status" in text and "Breachers" in text and "Remnant" in text  # new columns
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    assert "standing" in home_rows[0].lower()
    assert "hoarding" in home_rows[0].lower()  # vault-hoard marker
    assert "1" in home_rows[0]  # one breacher


def test_render_world_table_shows_a_ruin_row(world: WorldState) -> None:
    """A RUIN renders its status + remnant (observer-facing)."""
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("home_ada")
    text = "".join(seg.text for seg in Console(width=250).render(render_world_table(world)))
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1 and "ruin" in home_rows[0].lower()
```

Extend the existing `test_render_world_table_homes_section_renders_cleanly_with_zero_homes` with:

```python
    assert "Status" in text and "Breachers" in text and "Remnant" in text  # new columns with zero homes
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/observability/activity_feed_test.py -k "contest or hoarding or ruin or contest_columns" -v`
Expected: FAIL — no contest verbs; no `(hoarding)` markers; no Status/Breachers/Remnant columns.

- [ ] **Step 3: Implement the verbs, markers, and columns**

In `observability/activity_feed.py`, add the imports (`from world.agents import AgentStatus, is_hoarding`; `from world.homes import home_is_hoarding, max_integrity`) and the four verbs to `_EVENT_VERBS`:

```python
    "home_breached": "broke into a home",
    "home_thieved": "stripped a home of its store",
    "home_colonized": "seized a home",
    "ruins_scavenged": "picked over ruins",
```

In `render_world_table`, append the hoard marker to each agent's Materials cell:

```python
    for agent in roster:
        hoard = " (hoarding)" if is_hoarding(agent) else ""
        agents_table.add_row(
            agent.id,
            agent.status.value,
            f"{agent.current_energy:.1f}",
            f"{agent.current_materials:.1f}{hoard}",
            agent.current_position,
        )
```

Rebuild the homes table with the new columns:

```python
    homes_table = Table(title="Homes", expand=True)
    homes_table.add_column("Home")
    homes_table.add_column("Owner")
    homes_table.add_column("Region")
    homes_table.add_column("Status")
    homes_table.add_column("Stakeholders", justify="right")
    homes_table.add_column("Health", justify="right")
    homes_table.add_column("Vault", justify="right")
    homes_table.add_column("Breachers", justify="right")
    homes_table.add_column("Remnant", justify="right")
    for home in world.get_all_homes():
        cap = max_integrity(len(home.stakeholders))
        vault_hoard = " (hoarding)" if home_is_hoarding(home) else ""
        homes_table.add_row(
            home.home_id,
            home.owner_id,
            home.region,
            home.status.value,
            str(len(home.stakeholders)),
            f"{home.integrity:.1f}/{cap:.1f}",
            f"{home.vault_materials:.1f}{vault_hoard}",
            str(len(home.breachers)),
            f"{home.remnant_materials:.1f}",
        )
```

Update the `render_world_table` docstring's homes tuple to `(id/owner/region/status/stakeholders/health/vault/breachers/remnant)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/observability/activity_feed_test.py -v`
Expected: PASS — verbs, markers, and columns render; existing homes/agents table tests stay green (added columns + a suffix on cells whose substrings the old asserts still match).

- [ ] **Step 5: Commit**

```bash
git add observability/activity_feed.py tests/observability/activity_feed_test.py
git commit -m "feat(observability): contest verbs + hoarding markers + status/breachers/remnant columns (L2c Task 6a)"
```

---

## Task 6b: Agent perception — `look_around` raider view + `WORLD_MECHANICS` DD9

Give raiders/scavengers the in-world perception to choose a target. In `look_around`: for each co-located home the being does NOT stake, show its id/owner/**soundness** + a **hoard FLAG** (from `home_is_hoarding`) — but **NOT the exact vault** (Fork F; exact vault stays own-home-only, 2b); and list co-located **ruins** with their remnant. Add the DD9 `WORLD_MECHANICS` clause for break-in + ruins (the **forbidden-words guard must stay green**).

**Files:**
- Modify: `tools/builtin/movement.py` (`look_around`)
- Modify: `agents/prompt.py` (`WORLD_MECHANICS`)
- Test: `tests/tools/movement_test.py`, `tests/agents/prompt_test.py`

**Interfaces:**
- Consumes: `WorldState.homes_in_region`, `WorldState.is_stakeholder` (existing); `world.homes.HomeStatus`/`home_is_hoarding`/`max_integrity`.
- Produces: `look_around` appends raider-perception lines (non-stake STANDING homes: soundness + hoard flag, no vault; ruins: remnant); `WORLD_MECHANICS` gains the break-in/ruins clause.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/movement_test.py` (add `home_is_hoarding` usage is not needed; add `HOARDING_MATERIALS_THRESHOLD` to the `core.constants` import):

```python
async def test_look_around_shows_a_co_located_non_stake_home_without_exact_vault(
    world: WorldState, event_bus: EventBus
) -> None:
    """A raider perceives a co-located home it does not stake: id/owner/soundness + hoard flag, NOT the vault."""
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=80.0)
    world.deposit_to_home_vault("home_ada", HOARDING_MATERIALS_THRESHOLD + 5.0)  # a hoard

    result = await look_around(world, event_bus, "wanderer_002")  # boris does not stake home_ada

    assert "home_ada" in result  # the target is perceivable
    assert "80.0" in result  # its soundness is shown
    assert "great store" in result.lower()  # the hoard FLAG (not the number)
    assert str(HOARDING_MATERIALS_THRESHOLD + 5.0) not in result  # exact vault is NOT leaked


async def test_look_around_shows_co_located_ruins(world: WorldState, event_bus: EventBus) -> None:
    """A being perceives co-located ruins and their remnant so it can choose to scavenge."""
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=0.0)
    world.make_ruin("home_ada")
    remnant = world.homes["home_ada"].remnant_materials

    result = await look_around(world, event_bus, "wanderer_002")

    assert "ruin" in result.lower()
    assert f"{remnant}" in result or f"{remnant:.1f}" in result  # remnant surfaced


async def test_look_around_own_home_still_shows_exact_vault(
    world: WorldState, event_bus: EventBus
) -> None:
    """Regression: a stakeholder still sees its OWN home's exact vault (2b), not just the flag."""
    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=100.0)
    world.deposit_to_home_vault("home_ada", 42.0)
    result = await look_around(world, event_bus, "wanderer_001")
    assert "42.0" in result  # exact own-home vault preserved
```

Append to `tests/agents/prompt_test.py`:

```python
def test_world_mechanics_describes_break_in_and_ruins() -> None:
    """L2c physics (DD9): enough beings together can break into another's home to take or seize it;
    a home worn to nothing becomes ruins any passer-by may pick over. No goals/strategy/sim language."""
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "broken into" in lowered  # a home not yours can be broken into
    assert "seize" in lowered  # ... to take its store or seize it
    assert "ruin" in lowered  # a fallen home leaves ruins
    assert "pick over" in lowered  # ... any passer-by may pick over
    # The DD9 forbidden-words guard MUST stay green.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/movement_test.py -k "co_located or ruins or own_home" tests/agents/prompt_test.py::test_world_mechanics_describes_break_in_and_ruins -v`
Expected: FAIL — `look_around` shows no raider lines; `WORLD_MECHANICS` has no break-in/ruins clause.

- [ ] **Step 3: Implement the perception and the prose**

In `tools/builtin/movement.py`, add the import (`from world.homes import HomeStatus, home_is_hoarding, max_integrity`) and, in `look_around` after the own-home `home_line`, build the raider-perception lines and append them to the returned f-string:

```python
    # Raider/scavenger perception (Fork F): co-located homes the being does NOT stake show
    # soundness + a hoard FLAG (never the exact vault — that stays own-home-only, 2b); ruins show
    # their remnant so a passer-by can choose to pick them over.
    other_home_lines: list[str] = []
    for other in world.homes_in_region(agent_state.current_position):
        if world.is_stakeholder(other.home_id, agent_id):
            continue  # the being's own home is already shown above, with its exact vault
        if other.status is HomeStatus.STANDING:
            cap = max_integrity(len(other.stakeholders))
            flag = " — it holds a great store" if home_is_hoarding(other) else ""
            other_home_lines.append(
                f"A home here you do not tend| {other.home_id}, kept by {other.owner_id}, "
                f"soundness {other.integrity:.1f}/{cap:.1f}{flag}"
            )
        else:  # RUIN
            other_home_lines.append(
                f"Ruins here| {other.home_id}, {other.remnant_materials:.1f} materials left to pick over"
            )
    other_homes = ("".join(f"{line}\n" for line in other_home_lines))
    return (
        f"YOUR CURRENT STATUS\n"
        f"Energy| {agent_state.current_energy}\n"
        f"Materials| {agent_state.current_materials}\n"
        f"World INFORMATION\n"
        f"Region| {region_state.name} - {region_state.description}\n"
        f"Energy pool| {region_state.current_energy}\n"
        f"Materials pool| {region_state.current_materials}\n"
        f"Connections| {','.join(region_state.connections)}\n"
        f"Agents present| {others}\n"
        f"{home_line}"
        f"{other_homes}"
    )
```

Update the `look_around` docstring's "Returns:" to note it also reports co-located homes the being does not stake (soundness + hoard flag, not the vault) and co-located ruins (remnant).

In `agents/prompt.py`, insert two bullets into `WORLD_MECHANICS` immediately **after** the vault bullet (`"...a thing others notice.\n"`) and **before** the "speak" bullet:

```python
        "- A home in your place that is not your own can be broken into — but never by one alone: "
        "each attempt wears at its soundness and costs you energy and materials, spent whether or "
        "not it gives way, and a home tended by many mends faster than a single pair of hands can "
        "break it. Enough beings breaking in together can bring one down, and then take what it "
        "stores or seize it as their own.\n"
        "- A home worn away to nothing falls into ruin: a broken remnant that anyone passing "
        "through may pick over for what materials still lie in it.\n"
```

(Verify no `FORBIDDEN_TERMS` and no `"you should"` in the added lines — "broken into", "wears", "soundness", "mends", "seize", "ruin", "remnant", "pick over" are all clear.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/movement_test.py tests/agents/prompt_test.py -v`
Expected: PASS — the raider view + own-home regression + the DD9 clause pass, and every existing `FORBIDDEN_TERMS`/DD9 test stays green.

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/movement.py agents/prompt.py tests/
git commit -m "feat(perception): look_around raider view + WORLD_MECHANICS break-in/ruins DD9 (L2c Task 6b)"
```

---

## Task 7: Conservation property test — the full raid lifecycle (+ LIVE tuning run)

Extend the multi-pool conservation property test to include `remnant_materials` and drive the WHOLE raid lifecycle — build → deposit-to-hoard → coordinated `break_in`×N → thieve → collapse-to-ruin → `scavenge_ruins` → sweep — asserting at **every** step that total materials is **strictly non-increasing** (region regen is zero here, so nothing may raise it) and total energy is **never minted**. The accounting counts a STANDING home's immobilised structure (`HOME_BUILD_MATERIALS_COST`) + vault and a RUIN's remnant (see the GOVERNING conservation model in Global Constraints), so build (agent→structure) and ruin (structure→partial remnant + sink) both resolve as a move-or-sink, never a mint.

**Files:**
- Test: `tests/tools/homes_test.py` (a new lifecycle property test; the 2b `test_deposit_then_withdraw_conserves_...` stays as-is)

**Interfaces:**
- Consumes: `build_home`, `deposit_to_home`, `break_in`, `scavenge_ruins` (tools); `world.tick.tick`; `world.homes.HomeStatus`; `core.constants.HOME_BUILD_MATERIALS_COST`/`RUINS_PERSIST_SECONDS`; a zero-regen `Region` + the frozen `fake_clock`.
- Produces: `test_full_raid_lifecycle_conserves_materials_and_never_mints_energy`.

- [ ] **Step 1: Write the failing test**

Append to `tests/tools/homes_test.py` (ensure imports: `from world.regions import Region`, `from core.rng import make_rng`, `from tests.conftest import SEED, FakeClock`, `from world.tick import tick`, `HOME_BUILD_MATERIALS_COST` + `RUINS_PERSIST_SECONDS` from `core.constants`, `AgentState`/`AgentStatus` from `world.agents`, `WorldState`, `EventBus`):

```python
async def test_full_raid_lifecycle_conserves_materials_and_never_mints_energy(
    fake_clock: FakeClock,
) -> None:
    """The whole contest layer conserves: build -> deposit -> coordinated break_in -> thieve ->
    collapse-to-ruin -> scavenge -> sweep never RAISES total materials (only region regen would,
    and it is zero here) and never mints energy.

    Total materials counts each STANDING home's immobilised structure (HOME_BUILD_MATERIALS_COST) +
    vault and each RUIN's remnant, so a build (agent -> structure) and a ruin (structure -> partial
    remnant + sink) are a move-or-sink, never a mint. break_in cost + upkeep + the ruin fraction are
    the only sinks; the total is asserted strictly non-increasing at every step.
    """
    region = Region(
        name="alpha", description="A field.", connections=[], energy_rate=0.0,
        materials_rate=0.0, current_energy=0.0, current_materials=0.0,
        max_energy=10_000.0, max_materials=10_000.0,  # zero regen -> totals strictly non-increasing
    )
    beings = [
        AgentState(id=aid, name=aid.title(), persona="p", current_position="alpha",
                   current_energy=500.0, current_materials=300.0, status=AgentStatus.ALIVE)
        for aid in ("owner_1", "raider_1", "raider_2", "raider_3")
    ]
    # owner_1 has exactly enough to build + fill the vault, so it is BROKE after -> unpaid ->
    # the thieved (integrity-0) home decays to a ruin on the next tick (no repair complication).
    owner = beings[0]
    owner.current_materials = HOME_BUILD_MATERIALS_COST + 200.0
    world = WorldState([region], beings, rng=make_rng(SEED), clock=fake_clock)
    bus = EventBus(world)
    for b in beings:
        bus.subscribe(b.id)

    def total_materials(w: WorldState) -> float:
        homes = 0.0
        for h in w.get_all_homes():
            if h.status is HomeStatus.STANDING:
                homes += HOME_BUILD_MATERIALS_COST + h.vault_materials
            else:
                homes += h.remnant_materials
        return (
            sum(a.current_materials for a in w.get_all_agents())
            + sum(r.current_materials for r in w.get_all_regions())
            + homes
        )

    def total_energy(w: WorldState) -> float:
        return sum(a.current_energy for a in w.get_all_agents()) + sum(
            r.current_energy for r in w.get_all_regions()
        )

    m, e = total_materials(world), total_energy(world)

    def step(label: str) -> None:
        nonlocal m, e
        m1, e1 = total_materials(world), total_energy(world)
        assert m1 <= m + 1e-9, f"{label}: materials ROSE {m} -> {m1}"
        assert e1 <= e + 1e-9, f"{label}: energy MINTED {e} -> {e1}"
        m, e = m1, e1

    await build_home(world, bus, "owner_1")
    step("build")  # agent -80 ; structure +80 => net 0
    home = world.home_of("owner_1")
    assert home is not None
    hid = home.home_id

    await deposit_to_home(world, bus, "owner_1", 200.0)  # a hoard-tier vault worth raiding
    step("deposit")  # agent -200 ; vault +200 => net 0
    assert owner.current_materials == 0.0  # broke -> the wreck will not be repaired

    # Coordinated break_in: cycle three raiders (no tick between -> owner broke, no repair) until the
    # blow breaches (M(1)=100 -> four 25-blows). The 4th blow thieves and splits the 200 vault.
    for i, rid in enumerate(("raider_1", "raider_2", "raider_3", "raider_1")):
        result = await break_in(world, bus, rid, hid, "thieve")
        step(f"break_in-{i}")  # each: agent -15 energy / -10 materials PURE SINK
        if "strip" in result.lower():
            break
    assert home.status is HomeStatus.STANDING and home.vault_materials == 0.0  # thieved: standing at 0
    step("thieve")  # vault -200 ; breachers +200 => net 0

    # The unpaid, integrity-0 home collapses to a RUIN on the next tick.
    fake_clock.advance(5.0)
    await tick(world, bus)
    assert home.status is HomeStatus.RUIN
    step("collapse-to-ruin")  # structure 80 -> remnant 0.5*(80+0)=40 => -40 SINK

    await scavenge_ruins(world, bus, "raider_1", hid, home.remnant_materials)  # take it all
    step("scavenge")  # remnant -y ; agent +y => net 0
    assert home.remnant_materials == 0.0

    fake_clock.advance(RUINS_PERSIST_SECONDS + 1.0)
    await tick(world, bus)
    assert world.get_home(hid) is None  # ruin swept
    step("ruin-sweep")  # remnant already 0 -> no change
```

- [ ] **Step 2: Run the test to verify it fails, THEN passes**

Run: `pytest tests/tools/homes_test.py::test_full_raid_lifecycle_conserves_materials_and_never_mints_energy -v`
Expected: If Tasks 1–5 are complete, this should PASS on first run (it composes already-built behaviour). If it FAILS, the failure is a **real conservation bug** — do NOT weaken the assertions; fix the offending step (the most likely culprit is accounting that forgets the standing-home structure term or a value move that credits before deducting). Re-run until green.

- [ ] **Step 3: Commit**

```bash
git add tests/tools/homes_test.py
git commit -m "test(conservation): full raid-lifecycle property test incl. ruins remnant (L2c Task 7)"
```

- [ ] **Step 4: LIVE tuning run (SURFACE TO SAFI — do not merge without it)**

The `BREAKIN_*` + `HOME_REPAIR_PER_SECOND` dials are cadence-coupled and can only be validated live (spec §9/§11: "LIVE tuning run before merge"). After green CI, run a real Gemini-regime run (`python scripts/run.py ...`), watch the feed/world-table, and check:
- a **funded** home stays at/near `max_integrity(s)` under the ~1–3s breath cadence (no false decay);
- a **lone** raider is out-healed and self-limits (burns out) — it does NOT reliably solo-crack `M(1)=100`;
- a **coordinated** group (>2/window) CAN breach, and a hoard-tier (~300) vault is the only vault worth the coordinated cost after the split + repair leakage;
- ruins appear on collapse, are scavengeable, and sweep after the window (no clutter, no farm).

Report the observations to Safi and apply the documented fallbacks if needed (`BREAKIN_INTEGRITY_DAMAGE→15` if solo-raiding dominates; raise `HOME_REPAIR_PER_SECOND` if funded homes decay). This is a decision checkpoint, not a code step.

---

## Final verification (run before declaring 2c done)

Run the exact CI gate and read the output (evidence before assertions):

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

All four must pass green. Then complete the **LIVE tuning run** (Task 7 Step 4) and surface it to Safi before merging (the dials are the dangerous, cadence-coupled part of this slice).

## 2c done-condition checklist (spec §11 — MANDATORY changes + fork resolutions)

- [ ] **MANDATORY #1** — `Home.last_integrity_at` seeded `= built_at`, advanced to `now` EVERY tick (covered AND missed); repair + decay both from `elapsed = now - last_integrity_at`; `last_upkeep_at` solely for owed/arrears; decay does NOT accelerate (Task 1).
- [ ] **MANDATORY #2** — thieve leaves the home STANDING at ~0 with the vault ZEROED; never `make_ruin` (Task 4a).
- [ ] **MANDATORY #3** — colonize enrolls only currently-homeless co-located living breachers; the final striker (owner) is auto-detached from any prior home first (Task 4b).
- [ ] **MANDATORY #4** — every existing home op (upkeep sweep, `pledge_home`, `use_hearth`, `deposit_to_home`, `withdraw_from_home`, `leave_home`, `modify_home_integrity`) is STANDING-only (Task 2).
- [ ] **Fork A** — `HOME_REPAIR_PER_SECOND=10.0`, `HOME_DECAY_PER_SECOND=2.0`; incremental covered-repair + time-based missed-decay; structural non-regression (a funded home stays at M(s)); tick tests retargeted to time-based (Task 1).
- [ ] **Fork B** — `BREAKIN_INTEGRITY_DAMAGE=25.0`, `BREAKIN_ENERGY_COST=15.0`, `BREAKIN_MATERIALS_COST=10.0` (pure sinks); coordination threshold > 2/window (Task 3); validated in the LIVE run (Task 7).
- [ ] **Fork C** — `break_in(target_home, intent∈{thieve,colonize})`; pre-breach blows just damage+cost; the breaching blow executes the intent atomically (Tasks 3/4a/4b).
- [ ] **Fork D** — breachers clear when a covered tick repairs to `max_integrity(s)` (Task 3); also cleared by `make_ruin` (Task 5).
- [ ] **Fork E** — thieve aftermath = STANDING-at-0 (== MANDATORY #2, Task 4a).
- [ ] **Fork F** — `look_around` shows non-stake co-located homes' soundness + hoard flag (NOT the exact vault) + ruins' remnant; own-home exact vault preserved (Task 6b).
- [ ] **Fork G** — decomposed into the 7 (→9) ordered tasks; conservation closed by the property test (Task 7).
- [ ] **Ruins** — `make_ruin` (remnant `= RUINS_SCAVENGE_FRACTION*(BUILD_COST+vault)`, then zero/clear), `scavenge_ruin`, `scavenge_ruins` tool, collapse→ruin, ruin-sweep after `RUINS_PERSIST_SECONDS=120.0`; `RUINS_SCAVENGE_FRACTION=0.5 < 1` asserted (Task 5).
- [ ] **Events** — `home_breached`/`home_thieved`/`home_colonized`/`ruins_scavenged` (LOCAL) + repurposed `home_collapsed`→ruin; feed verbs for all (Tasks 3/4a/4b/5/6a).
- [ ] **Visibility** — `(hoarding)` markers on BOTH agents + homes world-table sections; Status/Breachers/Remnant columns; DD9 `WORLD_MECHANICS` break-in/ruins clause with the forbidden-words guard green (Tasks 6a/6b).
- [ ] **Conservation** — break-in cost = pure sink; thieve ≤ vault; `FRACTION < 1`; hearth stays personal-fuel; no minting; full-lifecycle property test green (Task 7).
- [ ] **Parity + CI** — `break_in` + `scavenge_ruins` in BOTH `BUILTIN_TOOLS` + `TOOL_SCHEMAS`; green CI (ruff + format + mypy + pytest cov ≥ 90).
- [ ] **LIVE tuning run** completed and surfaced to Safi before merge.
