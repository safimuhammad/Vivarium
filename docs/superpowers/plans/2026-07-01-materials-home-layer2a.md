# Vivarium Layer 2a — Shared Ownership + Health + Death/Departure Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the private L1 home into *shareable* territory: beings pledge to a home to become **stakeholders** (sharing its upkeep and hearth), a home's integrity ceiling **scales with stakeholder count** (with diminishing returns and an anti-blob ceiling), upkeep is drawn from a **collective pool**, and the **death/departure lifecycle** prunes stakeholders, promotes a new owner, and clamps integrity so no corpse props up a fortress. Collapse still just removes the home (ruins are 2c); a fed home still heals to its (now stakeholder-scaled) ceiling (incremental repair is 2c).

**Architecture:** Event-driven, unchanged. `Home` gains `stakeholders: list[str]` (the builder is owner + first stakeholder). A pure `max_integrity(stakeholder_count)` helper (`world/homes.py`, sibling to `world.agents.is_hoarding`) is the single formula for a home's ceiling; it is wired into BOTH the `WorldState.modify_home_integrity` clamp AND the world-tick repair-target, replacing the flat `HOME_MAX_INTEGRITY` at both sites. New `WorldState` methods (sync, event-free) manage stakeholders; `remove_stakeholder` is the shared prune+promote+clamp primitive used by both the `leave_home` tool and the extended `kill_agent`. The world-tick's home sweep becomes a **collective-pool** draw (owner-first, then by id, all-or-nothing; decay + freeze `last_upkeep_at` when the pool cannot cover). Two new closure-signature tools (`pledge_home`, `leave_home`) mutate through `WorldState` and publish LOCAL events; `use_hearth` widens its eligibility from owner-only to any stakeholder (still burning **personal** materials — the binding conservation invariant). Prompt prose (DD9), the activity feed, and the world-table make it perceivable.

**Tech Stack:** Python 3.13, stdlib `dataclasses`/`enum`/`asyncio`, `rich` (feed), `pytest` + `pytest-asyncio` + `pytest-cov`, `ruff`, `mypy --strict`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python 3.13**; modern syntax already in the codebase (`match`, walrus `:=`, `str | None`, `dict[str, X]`, string `Enum`, `async`/`await`).
- **`mypy --strict` clean** on `core tests world bus tools config agents observability`.
- **`ruff check .` clean** and **`ruff format --check .` clean** (imports isort-ordered; no unused imports — import a constant only in the task that first uses it; no f-string without a placeholder).
- **Google-style docstrings** on every new module, class, and public function — for tools/world methods, document *which world state it mutates and which events it emits*.
- **No `print()` in library code** — use `logging` (the `rich` activity feed is the separate rendering layer).
- **Deterministic tests** (`*_test.py` naming): never call a live LLM/Ollama; all randomness via the injected seeded RNG (`world.rng`); all time via the injected clock (`world.now()` / the `fake_clock` fixture). Use `pytest.approx` for accumulated-float comparisons.
- **Centralize all new dials in `core/constants.py`** (typed `Final`, with a provenance docstring). Tools/world/tick/feed import from there — no magic numbers scattered in tool files.
- **Preserve domain patterns:** tools return natural-language result strings (`"Error: "` precondition/lookup failure, `"Invalid: "` rule violation, or a plain success sentence — never exceptions/booleans); in-place mutation of the mutable `WorldState` singleton; the uniform closure tool signature `async def tool(world, event_bus, agent_id, **params) -> str`; `WorldState` mutations stay **sync and event-free** (the world holds no bus — DD4).
- **DD9 (system prompt):** `WORLD_MECHANICS` describes in-world *physics/consequences only* — no goals, objectives, strategy, survival framing, or language revealing the simulation. New prose must avoid every term in `tests/agents/prompt_test.py::FORBIDDEN_TERMS` (`goal, objective, mission, task, strategy, win, lose, survive, survival, simulation, simulated, score, reward, optimize, optimise, death, die`) and `"you should"`.
- **CONSERVATION (binding — from spec §12):** the hearth burns **PERSONAL materials only**, even when widened to stakeholders (widen the eligibility/lookup, NOT the fuel — a vault-fuelled hearth would be a shared fountain / still-life). No mechanic mints energy; upkeep is a materials sink. (There is no vault in 2a; the full multi-pool conservation *property* test lands with 2b/2c when vaults/remnants exist.)
- **No still-life / anti-blob (spec §12):** health per stakeholder diminishes and is capped at `HOME_HEALTH_CEIL ≤ 2 × HOME_HEALTH_BASE`, so many contestable homes (territory) beat one unraidable mega-commune.
- **≥90% coverage on core** (`world/`, `bus/`, `tools/`, `core/`, `agents/`, `observability/`).

### New constants (reference — each folded into the task that first needs it)

| Constant | Value | First needed in |
|---|---|---|
| `HOME_HEALTH_BASE` | `100.0` | Task 2 |
| `HOME_HEALTH_CEIL` | `200.0` | Task 2 |
| `HOME_HEALTH_DIMINISH` | `0.5` | Task 2 |

No *new* value dials beyond these three; `HOME_MAX_INTEGRITY` (`100.0`), `HOME_UPKEEP_MATERIALS_PER_SECOND` (`0.1`), and `HOME_DECAY_PER_MISSED_TICK` (`10.0`) are reused from L1. `HOME_MAX_INTEGRITY` remains defined (it equals `HOME_HEALTH_BASE` and is still the fresh/solo-home integrity used by `build_home`); it is simply no longer the *clamp ceiling* (that becomes `max_integrity(s)`).

### Health formula (spec §12, fork 2 — GOVERNING)

```
max_integrity(s) = HOME_HEALTH_BASE + (HOME_HEALTH_CEIL - HOME_HEALTH_BASE) * (1 - HOME_HEALTH_DIMINISH ** (s - 1))     for s >= 1
max_integrity(s) = HOME_HEALTH_BASE                                                                                       for s <= 1  (degenerate/empty guard)
```
→ `M(1)=100`, `M(2)=150`, `M(3)=175`, `M(4)=187.5`, asymptotic to (but never reaching) `HOME_HEALTH_CEIL=200`.

### Final CI gate (run before merge; this is what CI runs)

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

---

## File Structure

- `core/constants.py` — **modify**: add `HOME_HEALTH_BASE`/`HOME_HEALTH_CEIL`/`HOME_HEALTH_DIMINISH` (Task 2).
- `world/homes.py` — **modify**: add `Home.stakeholders` field (Task 1) and the pure `max_integrity(stakeholder_count)` helper (Task 2).
- `world/world.py` — **modify**: `build_home` seeds `stakeholders=[owner_id]` (Task 1); `modify_home_integrity` clamps to `max_integrity(len(stakeholders))` (Task 2); new stakeholder methods `add_stakeholder`/`remove_stakeholder`/`is_stakeholder`/`stakeholder_home_of` + accessor `get_home` (Task 3); `kill_agent` prunes/promotes/clamps (Task 5). `home_of` stays owner-only.
- `world/tick.py` — **modify**: the home upkeep/decay sweep becomes a collective-pool draw, healing to `max_integrity(s)` (Task 4).
- `tools/builtin/homes.py` — **modify**: add `pledge_home` (Task 6) and `leave_home` (Task 7); widen `use_hearth` from `home_of` to `stakeholder_home_of` (Task 7).
- `tools/builtin/__init__.py` — **modify**: register `pledge_home` + `leave_home` in `BUILTIN_TOOLS` + `__all__` (Tasks 6, 7).
- `agents/tool_schemas.py` — **modify**: add `pledge_home` + `leave_home` schemas to `TOOL_SCHEMAS` (Tasks 6, 7) — the parity test keeps both maps in lock-step.
- `agents/prompt.py` — **modify**: extend `WORLD_MECHANICS` with the shared-home clause (DD9) (Task 8).
- `observability/activity_feed.py` — **modify**: `_EVENT_VERBS` for `home_joined`/`home_left`; world-table Stakeholders + Health(max) columns (Task 9).
- Tests: `tests/world/homes_test.py`, `tests/world/world_test.py`, `tests/world/tick_test.py`, `tests/tools/homes_test.py`, `tests/agents/prompt_test.py`, `tests/observability/activity_feed_test.py`, `tests/core/constants_test.py`. (Parity is covered by the existing `tests/agents/tool_schemas_test.py`.)

---

## Task 1: `Home.stakeholders` field + builder seeded as owner + first stakeholder

**Files:**
- Modify: `world/homes.py` (add the field)
- Modify: `world/world.py` (`build_home` seeds `stakeholders=[owner_id]`)
- Test: `tests/world/homes_test.py`, `tests/world/world_test.py`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Home.stakeholders: list[str]` — defaults to `[]` (via `field(default_factory=list)`); the *invariant* "builder is owner + first stakeholder" is owned by `WorldState.build_home`, not the dataclass.
  - `WorldState.build_home(...)` now constructs the `Home` with `stakeholders=[owner_id]` (signature unchanged).

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/homes_test.py`:

```python
def test_home_has_stakeholders_defaulting_empty() -> None:
    """A Home carries a mutable stakeholders list, defaulting empty (invariant is the world's)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.stakeholders == []
    home.stakeholders.append("wanderer_002")
    assert home.stakeholders == ["wanderer_002"]


def test_home_still_uses_slots_with_stakeholders() -> None:
    """slots=True holds after adding the list field (no per-instance __dict__)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")
```

Append to `tests/world/world_test.py` (it already imports `HOME_MAX_INTEGRITY` and uses the `world` fixture):

```python
def test_build_home_seeds_owner_as_first_stakeholder(world: WorldState) -> None:
    """The builder is the home's owner AND its first stakeholder (L2 shared-ownership seed)."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.homes["h1"].stakeholders == ["wanderer_001"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/homes_test.py::test_home_has_stakeholders_defaulting_empty tests/world/world_test.py::test_build_home_seeds_owner_as_first_stakeholder -v`
Expected: FAIL — `Home` has no `stakeholders`; `build_home` does not seed it.

- [ ] **Step 3: Implement the field and the seed**

In `world/homes.py`, change the import and add the field (keep the existing module/class docstrings; extend the `Attributes:` list):

```python
from dataclasses import dataclass, field
```

```python
    home_id: str
    owner_id: str
    region: str
    integrity: float
    built_at: float
    last_upkeep_at: float
    stakeholders: list[str] = field(default_factory=list)
```

Add to the class `Attributes:` docstring:

```
        stakeholders: Ids of every being bought into the home (Layer 2). The builder
            is the owner AND the first stakeholder; others join via ``pledge_home``.
            Upkeep is drawn across this pool and the integrity ceiling scales with its
            length (:func:`max_integrity`).
```

In `world/world.py`, `build_home` — pass `stakeholders=[owner_id]` when constructing the `Home`:

```python
        self.homes[home_id] = Home(
            home_id=home_id,
            owner_id=owner_id,
            region=region,
            integrity=integrity,
            built_at=built_at,
            last_upkeep_at=built_at,
            stakeholders=[owner_id],
        )
```

Update the `build_home` docstring to note it seeds the owner as the first stakeholder.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/homes_test.py tests/world/world_test.py -v`
Expected: PASS (existing L1 home tests still green — a defaulted field is backward-compatible).

- [ ] **Step 5: Commit**

```bash
git add world/homes.py world/world.py tests/world/homes_test.py tests/world/world_test.py
git commit -m "feat(home): Home.stakeholders; builder is owner + first stakeholder (L2a)"
```

---

## Task 2: `max_integrity(s)` helper + health constants + `modify_home_integrity` clamp wiring

The single formula for a home's integrity ceiling, wired into the `modify_home_integrity` clamp. (The world-tick repair-target — the second clamp site — is wired in Task 4, where the tick sweep is reworked atomically.)

**Files:**
- Modify: `core/constants.py` (add `HOME_HEALTH_BASE`, `HOME_HEALTH_CEIL`, `HOME_HEALTH_DIMINISH`)
- Modify: `world/homes.py` (add `max_integrity`)
- Modify: `world/world.py` (`modify_home_integrity` clamps to `max_integrity(len(stakeholders))`; drop the now-unused `HOME_MAX_INTEGRITY` import)
- Test: `tests/world/homes_test.py`, `tests/world/world_test.py`

**Interfaces:**
- Consumes: `HOME_HEALTH_BASE`, `HOME_HEALTH_CEIL`, `HOME_HEALTH_DIMINISH`; `Home.stakeholders` (Task 1).
- Produces:
  - `max_integrity(stakeholder_count: int) -> float` (pure; `s<=1 → HOME_HEALTH_BASE`, else the diminishing-returns formula).
  - `WorldState.modify_home_integrity(home_id, amount) -> bool` now clamps to `[0.0, max_integrity(len(home.stakeholders))]`.
  - `HOME_HEALTH_BASE: Final[float] = 100.0`; `HOME_HEALTH_CEIL: Final[float] = 200.0`; `HOME_HEALTH_DIMINISH: Final[float] = 0.5`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/homes_test.py` (add `import pytest` and extend imports):

```python
import pytest

from core.constants import HOME_HEALTH_BASE, HOME_HEALTH_CEIL
from world.homes import Home, max_integrity
```

```python
def test_max_integrity_scales_with_stakeholders_and_is_capped() -> None:
    """M(s) matches the governing formula for s=1..cap and never reaches the ceiling."""
    assert max_integrity(1) == HOME_HEALTH_BASE  # a lone home == the L1 home (100)
    assert max_integrity(2) == 150.0
    assert max_integrity(3) == 175.0
    assert max_integrity(4) == pytest.approx(187.5)
    # Degenerate/empty guard: never a 0-cap, never below base.
    assert max_integrity(0) == HOME_HEALTH_BASE
    # Strictly increasing but always below the anti-blob ceiling — forever.
    assert HOME_HEALTH_BASE < max_integrity(2) < max_integrity(3) < HOME_HEALTH_CEIL
    assert max_integrity(50) < HOME_HEALTH_CEIL
```

Append to `tests/world/world_test.py`:

```python
def test_modify_home_integrity_clamp_scales_with_stakeholders(world: WorldState) -> None:
    """The integrity clamp ceiling grows with stakeholder count (max_integrity), not a flat max."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    # One stakeholder: the ceiling is the L1 max (100).
    assert world.modify_home_integrity("h1", 1000.0) is True
    assert world.homes["h1"].integrity == HOME_MAX_INTEGRITY
    # A second stakeholder lifts the ceiling to M(2)=150 (set directly; add_stakeholder is Task 3).
    world.homes["h1"].stakeholders.append("wanderer_002")
    assert world.modify_home_integrity("h1", 1000.0) is True
    assert world.homes["h1"].integrity == 150.0
    # Clamping is still floored at 0.
    assert world.modify_home_integrity("h1", -1000.0) is True
    assert world.homes["h1"].integrity == 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/homes_test.py::test_max_integrity_scales_with_stakeholders_and_is_capped tests/world/world_test.py::test_modify_home_integrity_clamp_scales_with_stakeholders -v`
Expected: FAIL — `max_integrity` / the health constants do not exist; the clamp still uses the flat `HOME_MAX_INTEGRITY`.

- [ ] **Step 3: Implement the constants, the helper, and the clamp**

Add to `core/constants.py`, in the "Homes (Layer 1)" section (a new sub-section after `HEARTH_ENERGY_PER_MATERIAL`):

```python
# ---------------------------------------------------------------------------
# Homes (Layer 2a) — shared ownership / stakeholder-scaled health
# [design: docs/superpowers/specs/2026-07-01-materials-home-layer2-design.md §12]
# ---------------------------------------------------------------------------

HOME_HEALTH_BASE: Final[float] = 100.0
"""Integrity ceiling of a lone (single-stakeholder) home. [design — 2026-07-01, Layer 2 §12].

Equals :data:`HOME_MAX_INTEGRITY` by design, so a solo home is exactly the L1 home; the
constants test locks ``HOME_HEALTH_BASE == HOME_MAX_INTEGRITY``."""

HOME_HEALTH_CEIL: Final[float] = 200.0
"""Asymptotic integrity ceiling as stakeholders grow. [design — 2026-07-01, Layer 2 §12].

Kept ``<= 2 * HOME_HEALTH_BASE`` (anti-blob): many contestable homes (territory) must beat
one unraidable mega-commune, so communal health has hard diminishing returns and a low cap."""

HOME_HEALTH_DIMINISH: Final[float] = 0.5
"""Diminishing-returns base for stakeholder-scaled health. [design — 2026-07-01, Layer 2 §12].

``max_integrity(s) = BASE + (CEIL-BASE) * (1 - DIMINISH ** (s-1))`` → M(1)=100, M(2)=150,
M(3)=175, M(4)=187.5. Smaller = faster diminishing returns; kept ``<= 0.5``. A world-rule dial."""
```

Add to `world/homes.py` (import the constants and define the helper below the `Home` class):

```python
from core.constants import HOME_HEALTH_BASE, HOME_HEALTH_CEIL, HOME_HEALTH_DIMINISH
```

```python
def max_integrity(stakeholder_count: int) -> float:
    """Return a home's integrity ceiling for a given number of stakeholders.

    Pure (no side effects). A communal home is sounder than a lone shelter, but with
    diminishing returns and a hard ceiling (spec §12, fork 2): a home with more beings
    tending it is harder to wear down, yet no size makes it an unraidable blob. The
    formula asymptotes toward — but never reaches — :data:`~core.constants.HOME_HEALTH_CEIL`::

        max_integrity(s) = BASE + (CEIL - BASE) * (1 - DIMINISH ** (s - 1))   for s >= 1

    A count ``<= 1`` (a lone home, or the degenerate/empty case after the last stakeholder
    departs) returns :data:`~core.constants.HOME_HEALTH_BASE`, so the ceiling is never a
    0-cap and a solo home is exactly the L1 home.

    Args:
        stakeholder_count: The home's number of stakeholders (``len(home.stakeholders)``).

    Returns:
        The integrity ceiling (a float in ``[HOME_HEALTH_BASE, HOME_HEALTH_CEIL)``).
    """
    if stakeholder_count <= 1:
        return HOME_HEALTH_BASE
    return HOME_HEALTH_BASE + (HOME_HEALTH_CEIL - HOME_HEALTH_BASE) * (
        1.0 - HOME_HEALTH_DIMINISH ** (stakeholder_count - 1)
    )
```

In `world/world.py`:
- Change the constants import from `from core.constants import HOME_MAX_INTEGRITY, PARALYSIS_ENERGY_THRESHOLD` to `from core.constants import PARALYSIS_ENERGY_THRESHOLD` (the flat max is no longer the clamp ceiling here).
- Change the homes import from `from .homes import Home` to `from .homes import Home, max_integrity`.
- Rewrite the `modify_home_integrity` clamp line and its docstring:

```python
    def modify_home_integrity(self, home_id: str, amount: float) -> bool:
        """Add ``amount`` to a home's integrity, clamped to ``[0.0, max_integrity(s)]``.

        The upper bound is the home's stakeholder-scaled ceiling
        (:func:`~world.homes.max_integrity` of ``len(stakeholders)``), so a home's soundness
        grows (with diminishing returns) as beings pledge to it and shrinks when they leave.
        Calling with ``amount=0.0`` re-clamps a home DOWN to a freshly reduced ceiling (used
        by :meth:`remove_stakeholder`). Mutates the home's :attr:`~world.homes.Home.integrity`.

        Args:
            home_id: Id of the home to modify.
            amount: Signed delta to apply.

        Returns:
            ``True`` if the home exists and was modified; ``False`` otherwise.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        cap = max_integrity(len(home.stakeholders))
        home.integrity = min(max(home.integrity + amount, 0.0), cap)
        return True
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/homes_test.py tests/world/world_test.py -v`
Expected: PASS. The L1 `test_modify_home_integrity_clamps_to_range` still passes because `max_integrity(1) == HOME_MAX_INTEGRITY == 100`.

- [ ] **Step 5: Commit**

```bash
git add core/constants.py world/homes.py world/world.py tests/world/homes_test.py tests/world/world_test.py
git commit -m "feat(home): max_integrity(s) health formula + stakeholder-scaled clamp (L2a)"
```

---

## Task 3: `WorldState` stakeholder methods (sync, event-free)

The shared primitives for shared ownership. `remove_stakeholder` is the single prune+promote+clamp operation reused by `leave_home` (Task 7) and `kill_agent` (Task 5).

**Files:**
- Modify: `world/world.py` (add the methods in the `# ---- Home methods ----` section)
- Test: `tests/world/world_test.py`

**Interfaces:**
- Consumes: `Home.stakeholders`; `modify_home_integrity` (Task 2).
- Produces (all sync, in-place, emit nothing):
  - `get_home(self, home_id: str) -> Home | None` — accessor (mirrors `get_agent`/`get_region`).
  - `add_stakeholder(self, home_id: str, agent_id: str) -> bool` — idempotent append (no duplicates); `False` only if the home is unknown.
  - `remove_stakeholder(self, home_id: str, agent_id: str) -> bool` — removes `agent_id` from `stakeholders`; if it was the `owner_id` and stakeholders remain, **promotes** the lowest-id survivor to owner; then **clamps** integrity down to the new `max_integrity(s)`. `False` if the home is unknown or `agent_id` is not a stakeholder.
  - `is_stakeholder(self, home_id: str, agent_id: str) -> bool`.
  - `stakeholder_home_of(self, agent_id: str) -> Home | None` — the first home where `agent_id` is a stakeholder (a being belongs to at most one home in practice).

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/world_test.py`:

```python
# ---------------------------------------------------------------------------
# Layer 2a: stakeholders (sync, event-free)
# ---------------------------------------------------------------------------


def test_get_home_returns_home_or_none(world: WorldState) -> None:
    assert world.get_home("h1") is None
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    home = world.get_home("h1")
    assert home is not None and home.home_id == "h1"


def test_add_stakeholder_is_idempotent_no_duplicate(world: WorldState) -> None:
    """A being joins once; a duplicate pledge is a no-op (no double-listing)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    assert world.add_stakeholder("h1", "wanderer_002") is True
    assert world.add_stakeholder("h1", "wanderer_002") is True  # dup -> no-op
    assert world.homes["h1"].stakeholders == ["wanderer_001", "wanderer_002"]  # exactly once
    assert world.add_stakeholder("missing", "wanderer_002") is False  # unknown home


def test_is_stakeholder_and_stakeholder_home_of(world: WorldState) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")
    assert world.is_stakeholder("h1", "wanderer_001") is True  # owner is a stakeholder
    assert world.is_stakeholder("h1", "wanderer_002") is True
    assert world.is_stakeholder("h1", "ghost") is False
    assert world.is_stakeholder("missing", "wanderer_001") is False
    found = world.stakeholder_home_of("wanderer_002")
    assert found is not None and found.home_id == "h1"
    assert world.stakeholder_home_of("ghost") is None


def test_remove_stakeholder_of_nonowner_clamps_down(world: WorldState) -> None:
    """Removing a non-owner stakeholder shrinks the ceiling and clamps integrity down."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")  # [001, 002] -> M(2)=150
    world.modify_home_integrity("h1", 100.0)  # heal up to 150
    assert world.homes["h1"].integrity == 150.0

    assert world.remove_stakeholder("h1", "wanderer_002") is True

    home = world.homes["h1"]
    assert home.stakeholders == ["wanderer_001"]
    assert home.owner_id == "wanderer_001"  # owner unchanged
    assert home.integrity == 100.0  # clamped DOWN to M(1)


def test_remove_stakeholder_of_owner_promotes_lowest_id_survivor(world: WorldState) -> None:
    """Removing the owner promotes the lowest-id remaining stakeholder and clamps."""
    world.add_agent(make_agent("wanderer_003"))
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_003")
    world.add_stakeholder("h1", "wanderer_002")  # stakeholders: [001, 003, 002] -> M(3)=175
    world.modify_home_integrity("h1", 100.0)  # heal up to 175
    assert world.homes["h1"].integrity == 175.0

    assert world.remove_stakeholder("h1", "wanderer_001") is True  # remove the OWNER

    home = world.homes["h1"]
    assert "wanderer_001" not in home.stakeholders
    assert home.owner_id == "wanderer_002"  # promoted: min of {002, 003}
    assert home.integrity == 150.0  # clamped DOWN to M(2)


def test_remove_stakeholder_rejects_unknown_and_nonmember(world: WorldState) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    assert world.remove_stakeholder("h1", "ghost") is False  # not a stakeholder
    assert world.remove_stakeholder("missing", "wanderer_001") is False  # unknown home
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/world_test.py -k "stakeholder or get_home" -v`
Expected: FAIL — `WorldState` has no `add_stakeholder`/`remove_stakeholder`/`is_stakeholder`/`stakeholder_home_of`/`get_home`.

- [ ] **Step 3: Implement the methods**

In `world/world.py`, add to the `# ---- Home methods ----` section (e.g. after `home_of`):

```python
    def get_home(self, home_id: str) -> Home | None:
        """Look up a home by id.

        Args:
            home_id: Home id to look up.

        Returns:
            The :class:`~world.homes.Home`, or ``None`` if unknown.
        """
        return self.homes.get(home_id)

    def add_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Add ``agent_id`` as a stakeholder of a home (idempotent). Mutates :attr:`homes`.

        A being pledges into a home to share its upkeep and hearth. Idempotent: a repeat
        pledge does not double-list the being. Does NOT raise the integrity ceiling for the
        current integrity — the tick heals a paid home up to the new, larger
        :func:`~world.homes.max_integrity` over time.

        Args:
            home_id: Id of the home to join.
            agent_id: Id of the joining being.

        Returns:
            ``True`` if the home exists (whether or not it was a no-op duplicate);
            ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        if agent_id not in home.stakeholders:
            home.stakeholders.append(agent_id)
        return True

    def remove_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Remove ``agent_id`` from a home; promote a new owner if needed; clamp integrity.

        The single prune+promote+clamp primitive shared by voluntary departure
        (:func:`~tools.builtin.homes.leave_home`) and death (:meth:`kill_agent`):

        #. Remove ``agent_id`` from :attr:`~world.homes.Home.stakeholders`.
        #. If it was the ``owner_id`` and stakeholders remain, promote the lowest-id
           survivor to owner (else the home would keep a departed/dead ghost as owner).
        #. Clamp integrity DOWN to the smaller :func:`~world.homes.max_integrity` (a home
           with fewer tenders is softer), via ``modify_home_integrity(home_id, 0.0)``.

        A home whose last stakeholder is removed keeps a (now ownerless-in-practice) owner
        field but has no living payer, so the world-tick decays it to collapse (spec §6).
        Vault/structure removal on collapse is unchanged (ruins are 2c). Mutates
        :attr:`homes`.

        Args:
            home_id: Id of the home to detach from.
            agent_id: Id of the being to remove.

        Returns:
            ``True`` if the home exists and ``agent_id`` was a stakeholder that was removed;
            ``False`` if the home is unknown or ``agent_id`` was not a stakeholder.
        """
        home = self.homes.get(home_id)
        if home is None or agent_id not in home.stakeholders:
            return False
        home.stakeholders.remove(agent_id)
        if agent_id == home.owner_id and home.stakeholders:
            home.owner_id = min(home.stakeholders)
        self.modify_home_integrity(home_id, 0.0)  # re-clamp DOWN to the new, smaller ceiling
        return True

    def is_stakeholder(self, home_id: str, agent_id: str) -> bool:
        """Return whether ``agent_id`` is a stakeholder of a home (pure read).

        Args:
            home_id: Id of the home to check.
            agent_id: Id of the being to check.

        Returns:
            ``True`` if the home exists and ``agent_id`` is in its stakeholders.
        """
        home = self.homes.get(home_id)
        return home is not None and agent_id in home.stakeholders

    def stakeholder_home_of(self, agent_id: str) -> Home | None:
        """Return the home ``agent_id`` holds a stake in (owner or pledged), or ``None``.

        The stakeholder-aware counterpart to the owner-only :meth:`home_of` (which stays
        owner-only for the ``build_home`` "already own one" check). Used by ``use_hearth``
        (rest at the home you share) and ``leave_home`` (the home you can leave). A being
        belongs to at most one home in practice; the first match is returned.

        Args:
            agent_id: Id of the being to look up.

        Returns:
            The :class:`~world.homes.Home` it holds a stake in, or ``None``.
        """
        for home in self.homes.values():
            if agent_id in home.stakeholders:
                return home
        return None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/world_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add world/world.py tests/world/world_test.py
git commit -m "feat(home): WorldState stakeholder methods (add/remove+promote+clamp/is/lookup) (L2a)"
```

---

## Task 4: World-tick collective-pool upkeep + heal-to-`max_integrity(s)`

Rework the L1 single-owner home sweep into a **collective-pool** draw. Payer order is deterministic (owner first when it is still a stakeholder, then the rest by id); the draw is **all-or-nothing** (if the pooled living materials cannot cover `owed`, nothing is drawn); a covered home is healed to `max_integrity(s)` and `last_upkeep_at` advances; an uncovered home decays by `HOME_DECAY_PER_MISSED_TICK` and **freezes** `last_upkeep_at` (arrears accrue). Collapse (integrity `<= 0`) still just removes the home and publishes `home_collapsed` (ruins are 2c).

**Files:**
- Modify: `world/tick.py` (module docstring, `tick()` docstring, the home sweep; imports)
- Test: `tests/world/tick_test.py`

**Interfaces:**
- Consumes: `WorldState.{get_all_homes, get_agent, modify_agent_materials, modify_home_integrity, remove_home}`; `Home.{home_id, owner_id, region, integrity, last_upkeep_at, stakeholders}`; `AgentState`, `AgentStatus`; `max_integrity` (Task 2); `HOME_UPKEEP_MATERIALS_PER_SECOND`, `HOME_DECAY_PER_MISSED_TICK`; `Event`/`ScopeType.LOCAL`; `world.now()`.
- Produces: the home sweep behaviour — for each home, `owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - last_upkeep_at)`; ordered payers `= ([owner] if owner in stakeholders else []) + sorted(other stakeholders)`; living payers exclude `DEAD`/missing; if there is at least one living payer AND `Σ(their materials) >= owed` → draw `owed` across them in order (each pays `min(materials, remaining)`), heal to `max_integrity(len(stakeholders))`, set `last_upkeep_at = now`; else → decay by `HOME_DECAY_PER_MISSED_TICK` with `last_upkeep_at` frozen, and collapse (`remove_home` + LOCAL `home_collapsed`) at `integrity <= 0`. The sweep stays silent per-tick (no upkeep event).

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/tick_test.py` (it already imports `HOME_DECAY_PER_MISSED_TICK`, `HOME_MAX_INTEGRITY`, `HOME_UPKEEP_MATERIALS_PER_SECOND`, `make_rng`, `SEED`, `FakeClock`, `Region`, `AgentState`, `AgentStatus`, `tick`, `WorldState`, `EventBus`, `pytest`):

```python
# ---- Collective-pool home upkeep (L2a) ------------------------------------


def _home_world(*balances: tuple[str, float]) -> tuple[WorldState, EventBus, FakeClock]:
    """A zero-regen one-region world with the given (agent_id, materials) beings in ``alpha``.

    Zero regen isolates the upkeep draw. The first being owns a home (and is its first
    stakeholder); the caller adds the rest as stakeholders as needed.
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
        max_energy=1000.0,
        max_materials=1000.0,
    )
    beings = [
        AgentState(
            id=aid,
            name=aid.title(),
            persona="p",
            current_position="alpha",
            current_energy=100.0,
            current_materials=mats,
            status=AgentStatus.ALIVE,
        )
        for aid, mats in balances
    ]
    world = WorldState([region], beings, rng=make_rng(SEED), clock=clock)
    bus = EventBus(world)
    for aid, _ in balances:
        bus.subscribe(aid)
    world.build_home("h1", balances[0][0], "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    return world, bus, clock


async def test_tick_collective_upkeep_solvent_owner_covers_alone() -> None:
    """A solvent owner covers upkeep alone (draw stops early); a co-stakeholder is untouched."""
    world, bus, clock = _home_world(("owner_1", 100.0), ("wanderer_9", 50.0))
    world.add_stakeholder("h1", "wanderer_9")  # [owner_1, wanderer_9] -> M(2)=150
    clock.advance(10.0)  # owed = 0.1 * 10 = 1.0

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(99.0)  # owner covered all 1.0 (draw broke early)
    assert friend.current_materials == pytest.approx(50.0)  # untouched — never reached
    assert home.integrity == 150.0  # healed to M(2)
    assert home.last_upkeep_at == world.now()  # advanced on a covered tick


async def test_tick_collective_upkeep_draws_across_payers_in_order() -> None:
    """Owed is drawn owner-first, then the next stakeholder covers the remainder; heals to M(2)."""
    world, bus, clock = _home_world(("owner_1", 0.5), ("wanderer_9", 100.0))
    world.add_stakeholder("h1", "wanderer_9")  # [owner_1, wanderer_9] -> M(2)=150
    clock.advance(10.0)  # owed = 1.0

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(0.0)  # owner paid all 0.5 it had
    assert friend.current_materials == pytest.approx(99.5)  # covered the remaining 0.5
    assert home.integrity == 150.0  # healed to M(2)
    assert home.last_upkeep_at == world.now()


async def test_tick_collective_upkeep_none_decays_and_freezes() -> None:
    """When the whole pool cannot cover owed, nothing is drawn, integrity decays, clock freezes."""
    world, bus, clock = _home_world(("owner_1", 0.2), ("wanderer_9", 0.1))
    world.add_stakeholder("h1", "wanderer_9")  # pool = 0.3
    home_before = world.get_home("h1")
    assert home_before is not None
    frozen_at = home_before.last_upkeep_at
    clock.advance(10.0)  # owed = 1.0 > 0.3

    await tick(world, bus)

    owner = world.get_agent("owner_1")
    friend = world.get_agent("wanderer_9")
    home = world.get_home("h1")
    assert owner is not None and friend is not None and home is not None
    assert owner.current_materials == pytest.approx(0.2)  # untouched (all-or-nothing)
    assert friend.current_materials == pytest.approx(0.1)  # untouched
    assert home.integrity == HOME_MAX_INTEGRITY - HOME_DECAY_PER_MISSED_TICK  # decayed one step
    assert home.last_upkeep_at == frozen_at  # frozen: arrears accrue (back-rent)


async def test_tick_ownerless_home_with_no_living_payers_decays_to_collapse() -> None:
    """A home whose only stakeholder left (ghost owner) has no payer, so it decays and collapses."""
    world, bus, clock = _home_world(("owner_1", 100.0))
    world.modify_home_integrity("h1", -(HOME_MAX_INTEGRITY - HOME_DECAY_PER_MISSED_TICK))  # -> 10
    world.remove_stakeholder("h1", "owner_1")  # last stakeholder gone; owner stays ghost
    bus.get_events("owner_1")  # drain
    clock.advance(1.0)

    await tick(world, bus)

    assert world.get_home("h1") is None  # collapsed and removed
    collapsed = [e for e in bus.get_events("owner_1") if e.type == "home_collapsed"]
    assert len(collapsed) == 1
    assert collapsed[0].scope is ScopeType.LOCAL and collapsed[0].region == "alpha"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/tick_test.py -k "collective or ownerless" -v`
Expected: FAIL — the L1 sweep draws from a single owner only; multi-payer draw / all-or-nothing pool / ghost-owner handling do not exist yet.

- [ ] **Step 3: Implement the collective-pool sweep**

In `world/tick.py`:
- Add `from world.homes import max_integrity` (no such import exists yet).
- Change the agents import from `from world.agents import AgentStatus` to `from world.agents import AgentState, AgentStatus` (the draw loop captures the payer's `AgentState`).
- In the `from core.constants import (...)` block, remove `HOME_MAX_INTEGRITY` (no longer used here) and keep `HOME_DECAY_PER_MISSED_TICK`, `HOME_UPKEEP_MATERIALS_PER_SECOND`.
- Update the module docstring's job #4 bullet and `tick()`'s `Mutates world state:` note to describe the **collective-pool** draw (owner-first then by id, all-or-nothing; decay + freeze on shortfall; heal to `max_integrity(s)`).
- Replace the L1 home sweep loop (currently the `for home in list(world.get_all_homes()):` block using a single-owner `can_pay`) with:

```python
    # Sweep home upkeep/decay (COLLECTIVE pool, L2a). owed = rate * elapsed is drawn from the
    # home's living stakeholders in a deterministic order (the owner first when it is still a
    # stakeholder, then the rest by id) — ALL-OR-NOTHING: if the pooled materials cannot cover
    # owed, nothing is drawn, the home loses integrity, and last_upkeep_at is FROZEN so the
    # arrears accrue (back-rent). A covered home is healed to its stakeholder-scaled ceiling
    # max_integrity(s) and last_upkeep_at advances. A departed/ghost owner (owner_id not in
    # stakeholders) never pays. Collapse (<= 0) still just removes the home (ruins are 2c).
    # Same snapshot-then-mutate discipline: mutate synchronously, defer the publish.
    collapse_events: list[Event] = []
    for home in list(world.get_all_homes()):
        owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - home.last_upkeep_at)
        others = sorted(s for s in home.stakeholders if s != home.owner_id)
        ordered = ([home.owner_id] if home.owner_id in home.stakeholders else []) + others
        # Capture the (id, AgentState) of each living payer once — no re-lookup in the draw
        # loop (avoids an unreachable None-guard and keeps mypy happy without a re-narrow).
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
            world.modify_home_integrity(home.home_id, max_integrity(len(home.stakeholders)))
            home.last_upkeep_at = now  # advance only on a covered tick
        else:
            world.modify_home_integrity(home.home_id, -HOME_DECAY_PER_MISSED_TICK)
            # last_upkeep_at is deliberately NOT advanced here (frozen: back-rent accrues).
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
```

(The final `for event in (*timed_out_events, *decay_events, *collapse_events):` publish loop is unchanged.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/tick_test.py -v`
Expected: PASS. The L1 single-owner home tick tests stay green: a lone owner is a one-being pool, so the covered/decayed/collapsed outcomes and frequency-independence are identical.

- [ ] **Step 5: Commit**

```bash
git add world/tick.py tests/world/tick_test.py
git commit -m "feat(home): collective-pool upkeep + heal-to-max_integrity(s) in the world-tick (L2a)"
```

---

## Task 5: Extend `kill_agent` — prune stakeholders, promote owner, clamp integrity

Death must not prop up a fortress. The death writer now detaches the slain being from **every** home it holds a stake in, reusing `remove_stakeholder` (which promotes a survivor to owner and clamps integrity).

**Files:**
- Modify: `world/world.py` (`kill_agent`)
- Test: `tests/world/world_test.py`

**Interfaces:**
- Consumes: `get_all_homes`, `is_stakeholder`, `remove_stakeholder` (Task 3).
- Produces: `kill_agent(agent_id)` additionally prunes `agent_id` from every home's `stakeholders` at kill-time; owner-death-with-survivors promotes the lowest-id survivor; integrity is clamped to the new `max_integrity(s)`. (No new events — the caller still emits `agent_died`; pruning is silent state cleanup, like the existing proposal sweep.)

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/world_test.py`:

```python
def test_kill_agent_prunes_owner_promotes_survivor_and_clamps(world: WorldState) -> None:
    """Killing an owner prunes it, promotes the lowest-id survivor, and clamps integrity down."""
    world.add_agent(make_agent("wanderer_003"))
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_003")
    world.add_stakeholder("h1", "wanderer_002")  # [001, 003, 002] -> M(3)=175
    world.modify_home_integrity("h1", 100.0)  # heal up to 175
    assert world.homes["h1"].integrity == 175.0

    assert world.kill_agent("wanderer_001") is True  # kill the OWNER

    home = world.homes["h1"]
    assert "wanderer_001" not in home.stakeholders  # pruned at kill-time
    assert home.owner_id == "wanderer_002"  # promoted: min survivor
    assert home.integrity == 150.0  # clamped DOWN to M(2)


def test_kill_agent_prunes_nonowner_stakeholder_and_clamps(world: WorldState) -> None:
    """Killing a non-owner stakeholder prunes + clamps but leaves the owner unchanged."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")  # [001, 002] -> M(2)=150
    world.modify_home_integrity("h1", 100.0)  # heal up to 150

    assert world.kill_agent("wanderer_002") is True  # non-owner

    home = world.homes["h1"]
    assert "wanderer_002" not in home.stakeholders
    assert home.owner_id == "wanderer_001"  # unchanged
    assert home.integrity == 100.0  # clamped to M(1)


def test_kill_agent_sole_owner_leaves_ownerless_decaying_home(world: WorldState) -> None:
    """A slain sole owner is pruned; the home keeps a ghost owner and will decay via the tick."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)

    assert world.kill_agent("wanderer_001") is True

    home = world.homes["h1"]
    assert home.stakeholders == []  # no one left to pay
    assert home.owner_id == "wanderer_001"  # ghost owner (dead) — the tick decays the home out
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/world_test.py -k "kill_agent and (prune or sole)" -v`
Expected: FAIL — `kill_agent` does not touch `stakeholders`.

- [ ] **Step 3: Implement the prune/promote/clamp**

In `world/world.py`, `kill_agent` — insert the home-prune loop just before the final `return True` (after the proposal sweeps), and extend the docstring:

```python
        # Prune the dead being from every home it holds a stake in (else a corpse keeps
        # propping up a fortress). remove_stakeholder promotes a surviving stakeholder to
        # owner on an owner's death and clamps integrity down to the smaller max_integrity(s).
        for home in list(self.get_all_homes()):
            if self.is_stakeholder(home.home_id, agent_id):
                self.remove_stakeholder(home.home_id, agent_id)
        return True
```

Add to the `kill_agent` docstring (`Mutates ...` section): "and, for every home the agent holds a stake in, removes it from the home's ``stakeholders`` — promoting the lowest-id survivor to owner if it owned the home and stakeholders remain, and clamping the home's integrity down to the new :func:`~world.homes.max_integrity`."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/world_test.py -v`
Expected: PASS (existing `kill_agent` proposal-refund tests still green — the prune loop no-ops for homeless agents).

- [ ] **Step 5: Commit**

```bash
git add world/world.py tests/world/world_test.py
git commit -m "feat(home): kill_agent prunes stakeholders, promotes owner, clamps integrity (L2a)"
```

---

## Task 6: The `pledge_home` tool

A co-located, living being joins a home in its region as a stakeholder.

**Files:**
- Modify: `tools/builtin/homes.py` (add `pledge_home`)
- Modify: `tools/builtin/__init__.py` (register in `BUILTIN_TOOLS` + `__all__`)
- Modify: `agents/tool_schemas.py` (add the `pledge_home` schema)
- Test: `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `WorldState.{get_agent, get_home, stakeholder_home_of, add_stakeholder, now}`; `AgentStatus`; `Event`/`ScopeType.LOCAL`.
- Produces: `async def pledge_home(world: WorldState, event_bus: EventBus, agent_id: str, home_id: str) -> str`. Adds the being to the home's stakeholders and publishes LOCAL `home_joined` (source = pledger, region = the home's region). `"Error: "` if the being or the home is unknown; `"Invalid: "` if the being is fallen, not co-located with the home, or already belongs to a home. New event type: `home_joined`. Success string starts `"You pledge yourself to this home"`.

> **Resolved ambiguity — targeting.** `pledge_home` takes an explicit `home_id` (mirroring how `attack`/`transfer_resource`/mating take a target id), which is unambiguous when a region holds several homes and forward-compatible with 2c colonize. Surfacing home ids to the *agent* per-breath (via `look_around`/perception) is out of this slice's file scope and is deferred (L1 shipped homes without per-breath self-perception on the same rationale); the world-table + feed surface ids to the observer today.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/homes_test.py` (extend the top imports to add `pledge_home` and, if not already present, `AgentStatus`):

```python
from tools.builtin.homes import build_home, pledge_home, use_hearth
```

```python
# ---- pledge_home ----------------------------------------------------------


async def test_pledge_home_joins_as_stakeholder_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert world.is_stakeholder("h1", "wanderer_002") is True
    joined = [e for e in event_bus.get_events("wanderer_002") if e.type == "home_joined"]
    assert len(joined) == 1
    assert joined[0].scope is ScopeType.LOCAL
    assert joined[0].region == "alpha"
    assert joined[0].source == "wanderer_002"
    assert joined[0].timestamp == world.now()
    assert result.startswith("You pledge yourself to this home")


async def test_pledge_home_unknown_home_is_error(world: WorldState, event_bus: EventBus) -> None:
    result = await pledge_home(world, event_bus, "wanderer_002", "nope")
    assert result.startswith("Error:")


async def test_pledge_home_not_co_located_is_invalid(world: WorldState, event_bus: EventBus) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    assert world.move_agent("wanderer_002", "beta") is True  # walk away

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_pledge_home_when_already_in_a_home_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.build_home("h2", "wanderer_002", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")  # already owns h2

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False


async def test_pledge_home_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    boris = world.get_agent("wanderer_002")
    assert boris is not None
    world.modify_agent_energy("wanderer_002", -(boris.current_energy - 1.0))  # -> PARALYZED
    assert boris.status is AgentStatus.PARALYZED

    result = await pledge_home(world, event_bus, "wanderer_002", "h1")

    assert result.startswith("Invalid:")
    assert world.is_stakeholder("h1", "wanderer_002") is False
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k pledge -v`
Expected: FAIL — `pledge_home` is not defined.

- [ ] **Step 3: Implement the tool and its registrations**

In `tools/builtin/homes.py`, append `pledge_home` (the `AgentStatus`/`Event`/`ScopeType` imports already exist from L1):

```python
async def pledge_home(world: WorldState, event_bus: EventBus, agent_id: str, home_id: str) -> str:
    """Pledge the being to a home where it stands, joining it as a stakeholder.

    A shared home is tended by many: a pledged being shares the home's upkeep (the tick
    draws upkeep across all stakeholders) and gains hearth access (``use_hearth``). Joining
    also raises the home's integrity ceiling (:func:`~world.homes.max_integrity`), so a
    well-peopled home is harder to wear down.

    Mutates world state:
        * Adds the being to the home's :attr:`~world.homes.Home.stakeholders` via
          :meth:`~world.world.WorldState.add_stakeholder`.

    Emits events:
        * One ``"home_joined"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source = the
          pledger, region = the home's region, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the pledging being.
        home_id: Id of the home (in the being's place) to join.

    Returns:
        A success sentence; an ``"Error: "`` string if the being or the home is unknown;
        an ``"Invalid: "`` string if the being is fallen, not where the home stands, or
        already belongs to a home (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return "Invalid: You are fallen and cannot pledge to a home; only another being can restore you."
    home = world.get_home(home_id)
    if home is None:
        return "Error: There is no such home here to pledge to."
    if home.region != agent.current_position:
        return "Invalid: You are not where that home stands; you can only join a home in your place."
    if world.stakeholder_home_of(agent_id) is not None:
        return "Invalid: You already belong to a home; you may share only one."

    world.add_stakeholder(home_id, agent_id)
    region = agent.current_position
    await event_bus.publish(
        Event(
            "home_joined",
            agent_id,
            {"message": f"{agent.name} has pledged to a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return (
        "You pledge yourself to this home; you now share its keep and may rest at its hearth. "
        f"{len(home.stakeholders)} beings tend it now."
    )
```

In `tools/builtin/__init__.py`: add `pledge_home` to the `from tools.builtin.homes import ...` line, to `__all__` (keep alphabetical — after `"move"`), and to `BUILTIN_TOOLS`:

```python
from tools.builtin.homes import build_home, pledge_home, use_hearth
```
```python
    "pledge_home": pledge_home,
```

In `agents/tool_schemas.py`, add the schema (keeps `set(TOOL_SCHEMAS) == set(BUILTIN_TOOLS)`):

```python
    "pledge_home": {
        "type": "function",
        "function": {
            "name": "pledge_home",
            "description": (
                "Pledge yourself to a home where you stand, joining it so you share its "
                "upkeep and may rest at its hearth. A home tended by more beings stands sounder."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "home_id": {
                        "type": "string",
                        "description": "Id of the home in your place to join.",
                    },
                },
                "required": ["home_id"],
            },
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py tests/agents/tool_schemas_test.py -v`
Expected: PASS (parity holds with `pledge_home` in both maps).

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py
git commit -m "feat(home): pledge_home tool — join a co-located home as a stakeholder (L2a)"
```

---

## Task 7: The `leave_home` tool + widen `use_hearth` to stakeholders

Voluntary departure (prune/promote/clamp, reusing `remove_stakeholder`) and the eligibility widening that lets any stakeholder use the hearth — still burning **PERSONAL** materials (the binding conservation invariant).

**Files:**
- Modify: `tools/builtin/homes.py` (add `leave_home`; change `use_hearth` lookup)
- Modify: `tools/builtin/__init__.py` (register `leave_home`)
- Modify: `agents/tool_schemas.py` (add the `leave_home` schema)
- Test: `tests/tools/homes_test.py`

**Interfaces:**
- Consumes: `WorldState.{get_agent, stakeholder_home_of, remove_stakeholder, now}` (leave); `WorldState.stakeholder_home_of` replaces `home_of` in `use_hearth`.
- Produces:
  - `async def leave_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str` (no model params). Removes the being from the home it holds a stake in (prune + promote owner + clamp integrity), publishes LOCAL `home_left` (source = leaver, region = the home's region). `"Error: "` if the being is unknown or belongs to no home. New event type: `home_left`. Success string starts `"You give up your place"`.
  - `use_hearth` now looks up the home via `stakeholder_home_of(agent_id)` (any stakeholder, not just the owner). Fuel is unchanged: `burned = min(agent.current_materials, HEARTH_MATERIALS_PER_USE)` from the being's **own** materials.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/homes_test.py` (extend the import to add `leave_home`):

```python
from tools.builtin.homes import build_home, leave_home, pledge_home, use_hearth
```

```python
# ---- leave_home -----------------------------------------------------------


async def test_leave_home_departs_prunes_and_emits_event(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")
    event_bus.get_events("wanderer_002")  # drain

    result = await leave_home(world, event_bus, "wanderer_002")

    assert world.is_stakeholder("h1", "wanderer_002") is False  # pruned
    left = [e for e in event_bus.get_events("wanderer_002") if e.type == "home_left"]
    assert len(left) == 1
    assert left[0].scope is ScopeType.LOCAL and left[0].region == "alpha"
    assert result.startswith("You give up your place")


async def test_leave_home_owner_departs_promotes_and_clamps(
    world: WorldState, event_bus: EventBus
) -> None:
    """An owner leaving promotes the survivor and clamps integrity — same rule as death."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")  # [001, 002] -> M(2)=150
    world.modify_home_integrity("h1", 100.0)  # heal up to 150

    await leave_home(world, event_bus, "wanderer_001")  # owner leaves

    home = world.get_home("h1")
    assert home is not None
    assert home.owner_id == "wanderer_002"  # promoted
    assert home.integrity == 100.0  # clamped to M(1)


async def test_leave_home_when_not_in_a_home_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    result = await leave_home(world, event_bus, "wanderer_002")
    assert result.startswith("Error:")


# ---- use_hearth widened to stakeholders -----------------------------------


async def test_use_hearth_works_for_nonowner_stakeholder_and_burns_personal_materials(
    world: WorldState, event_bus: EventBus
) -> None:
    """A pledged (non-owner) stakeholder may hearth; it burns their OWN materials (conservation)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("h1", "wanderer_002")  # Boris is a stakeholder, not the owner
    boris = world.get_agent("wanderer_002")
    ada = world.get_agent("wanderer_001")
    assert boris is not None and ada is not None
    boris.current_materials = 50.0
    boris.current_energy = 40.0
    ada.current_materials = 5.0  # the OWNER's stock must be untouched
    ada.current_energy = 5.0

    result = await use_hearth(world, event_bus, "wanderer_002")

    burned = HEARTH_MATERIALS_PER_USE
    assert boris.current_materials == 50.0 - burned  # burned from Boris's own stock
    assert boris.current_energy == 40.0 + burned * HEARTH_ENERGY_PER_MATERIAL
    assert ada.current_materials == 5.0 and ada.current_energy == 5.0  # owner untouched (no vault fuel)
    used = [e for e in event_bus.get_events("wanderer_002") if e.type == "hearth_used"]
    assert len(used) == 1
    assert result.startswith("You rest at your hearth")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k "leave_home or nonowner_stakeholder" -v`
Expected: FAIL — `leave_home` is undefined; `use_hearth` still uses `home_of` (owner-only), so a non-owner stakeholder gets `"Error: ..."`.

- [ ] **Step 3: Implement `leave_home` and widen `use_hearth`**

In `tools/builtin/homes.py`, change the `use_hearth` home lookup from owner-only to stakeholder-aware (one line + the docstring/comment), leaving the fuel logic untouched:

```python
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to rest in."
```

Update `use_hearth`'s docstring opening to reflect the widening (still personal fuel):

```
    """Rest at the hearth of a home the being shares, burning materials to recover energy.

    Any stakeholder (owner or pledged) may use the hearth (widened from L1's owner-only).
    The fuel is unchanged: it burns the being's OWN materials (conservation — a shared home
    is never a vault-fuelled fountain).
    ...
```

Append `leave_home`:

```python
async def leave_home(world: WorldState, event_bus: EventBus, agent_id: str) -> str:
    """Give up the being's stake in the home it shares (voluntary departure).

    The being renounces its place: it stops sharing the home's upkeep and loses hearth
    access. Departure follows the same rule as death — if the leaver owned the home and
    other stakeholders remain, the lowest-id survivor is promoted to owner; the home's
    integrity is clamped down to the smaller :func:`~world.homes.max_integrity`. A home
    whose last stakeholder leaves is left ownerless-in-practice and decays via the world-tick
    (spec §6). The vault/structure is unaffected (no vault in 2a; ruins are 2c).

    Mutates world state:
        * Removes the being from the home's :attr:`~world.homes.Home.stakeholders`,
          promoting a new owner and clamping integrity, via
          :meth:`~world.world.WorldState.remove_stakeholder`.

    Emits events:
        * One ``"home_left"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source = the
          leaver, region = the home's region, stamped ``world.now()``).

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the departing being.

    Returns:
        A success sentence; an ``"Error: "`` string if the being is unknown or belongs to
        no home (rejected calls mutate nothing).
    """
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You do not belong to any home to leave."

    region = home.region
    world.remove_stakeholder(home.home_id, agent_id)  # prune + promote owner + clamp integrity
    await event_bus.publish(
        Event(
            "home_left",
            agent_id,
            {"message": f"{agent.name} has left a home in {region}."},
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=world.now(),
        )
    )
    return "You give up your place in this home; its keep and hearth are no longer yours."
```

In `tools/builtin/__init__.py`: add `leave_home` to the `from tools.builtin.homes import ...` line (keep the names sorted: `build_home, leave_home, pledge_home, use_hearth`), to `__all__` (alphabetical — after `"initiate_mating"`), and to `BUILTIN_TOOLS`:

```python
    "leave_home": leave_home,
```

In `agents/tool_schemas.py`, add the schema:

```python
    "leave_home": {
        "type": "function",
        "function": {
            "name": "leave_home",
            "description": (
                "Give up your place in the home you share; you no longer share its upkeep "
                "or rest at its hearth."
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py tests/agents/tool_schemas_test.py -v`
Expected: PASS (existing owner-only `use_hearth` tests still green — an owner is always a stakeholder, so `stakeholder_home_of` matches `home_of` for owners; parity holds with both new tools registered).

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py
git commit -m "feat(home): leave_home tool + widen use_hearth to any stakeholder (personal fuel) (L2a)"
```

---

## Task 8: `WORLD_MECHANICS` prose (DD9) — a home can be shared

Teach the new physics in-world: a home can be shared (pledge to join, or leave), and a well-peopled home is harder to wear down. No goals/strategy/simulation language.

**Files:**
- Modify: `agents/prompt.py` (`WORLD_MECHANICS`)
- Test: `tests/agents/prompt_test.py`

**Interfaces:**
- Consumes: `build_system_prompt`, `WORLD_MECHANICS`.
- Produces: `WORLD_MECHANICS` extended with a shared-home clause — every existing verbatim phrase preserved (`"ebbs away"`, `"never compelled to act"`, `"no one but yourself"`, `"crumbles"`), and no `FORBIDDEN_TERMS` (or `"you should"`) introduced.

- [ ] **Step 1: Write the failing test**

Append to `tests/agents/prompt_test.py`:

```python
def test_world_mechanics_describes_sharing_a_home() -> None:
    """L2a physics (DD9): a home can be shared — pledge to join it, or leave it; sharing hardens it."""
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "pledge" in lowered  # you may join another's home
    assert "share" in lowered  # sharing its keep + hearth
    assert "sounder" in lowered or "wear down" in lowered  # health scales with stakeholders
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agents/prompt_test.py::test_world_mechanics_describes_sharing_a_home -v`
Expected: FAIL — `"pledge"` / `"sounder"` not yet in `WORLD_MECHANICS`.

- [ ] **Step 3: Extend `WORLD_MECHANICS`**

In `agents/prompt.py`, insert a new bullet immediately AFTER the existing home bullet (`"- Where you stand, you may raise a home ... crumbles away to nothing.\n"`) and before the speak bullet:

```python
        "- A home need not be yours alone: where you stand, you may pledge yourself to "
        "another's home to share its keep and its hearth, or give up a place you share. The "
        "more beings who tend a home together, the sounder it stands and the harder it is to "
        "wear down.\n"
```

(The wording contains the tested substrings `"pledge"`, `"share"`, `"sounder"`, and `"wear down"` while introducing no `FORBIDDEN_TERMS` and no `"you should"`, and it leaves the existing verbatim phrases untouched. If you smooth the prose, keep those exact substrings so the test holds.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/agents/prompt_test.py -v`
Expected: PASS (new test plus the existing DD9 / freedom-not-to-act / aging-and-home tests).

- [ ] **Step 5: Commit**

```bash
git add agents/prompt.py tests/agents/prompt_test.py
git commit -m "feat(home): WORLD_MECHANICS prose for shared homes (DD9, L2a)"
```

---

## Task 9: Activity-feed verbs + world-table Stakeholders/Health(max) columns

**Files:**
- Modify: `observability/activity_feed.py` (`_EVENT_VERBS`, `render_world_table`)
- Test: `tests/observability/activity_feed_test.py`

**Interfaces:**
- Consumes: `render_event`, `render_world_table`, `WorldState.get_all_homes`, `Home.{home_id, owner_id, region, integrity, stakeholders}`, `max_integrity` (Task 2).
- Produces: `_EVENT_VERBS` fallbacks for `home_joined` / `home_left`; the homes sub-table gains a **Stakeholders** column (count) and its integrity column becomes a **Health** column showing `integrity/max_integrity(s)` so an observer sees both the current soundness and the stakeholder-scaled ceiling.

- [ ] **Step 1: Write the failing tests**

Append to `tests/observability/activity_feed_test.py` (add `from core.constants import HOME_MAX_INTEGRITY`):

```python
def test_render_event_shared_home_events_are_human_readable() -> None:
    """Message-less shared-home events fall back to a distinct verb per type."""
    for etype, needle in (("home_joined", "joined"), ("home_left", "left")):
        event = Event(etype, "wanderer_002", {}, scope=ScopeType.LOCAL)  # no message -> verb
        assert needle in render_event(event).lower()


def test_render_world_table_shows_stakeholders_and_scaled_health(world: WorldState) -> None:
    """The homes section surfaces stakeholder count + integrity/max (observer-facing)."""
    from rich.console import Console

    world.build_home("home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY)
    world.add_stakeholder("home_ada", "wanderer_002")  # 2 stakeholders -> ceiling 150
    world.modify_home_integrity("home_ada", 1000.0)  # heal up to 150
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Stakeholders" in text  # the new column
    assert "Health" in text  # integrity/max column header
    assert "2" in text  # stakeholder count
    assert "150.0" in text  # the stakeholder-scaled ceiling M(2)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/observability/activity_feed_test.py -k "shared_home or stakeholders_and_scaled" -v`
Expected: FAIL — the verb fallbacks are absent; the homes table has no Stakeholders column and shows a flat integrity.

- [ ] **Step 3: Implement the verbs and the columns**

In `observability/activity_feed.py`:
- Add the `max_integrity` import: `from world.homes import max_integrity`.
- Add to `_EVENT_VERBS` (e.g. after `"home_collapsed"`):

```python
    "home_joined": "joined a home",
    "home_left": "left a home",
```

- Replace the homes sub-table build in `render_world_table` with the Stakeholders + Health columns:

```python
    homes_table = Table(title="Homes", expand=True)
    homes_table.add_column("Home")
    homes_table.add_column("Owner")
    homes_table.add_column("Region")
    homes_table.add_column("Stakeholders", justify="right")
    homes_table.add_column("Health", justify="right")
    for home in world.get_all_homes():
        cap = max_integrity(len(home.stakeholders))
        homes_table.add_row(
            home.home_id,
            home.owner_id,
            home.region,
            str(len(home.stakeholders)),
            f"{home.integrity:.1f}/{cap:.1f}",
        )
```

(Update the `render_world_table` docstring's homes-columns note to "id/owner/region/stakeholders/health".)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/observability/activity_feed_test.py -v`
Expected: PASS (the L1 `test_render_world_table_shows_homes` stays green: `"home_ada"` and `"42.0"` still appear — the latter as the `42.0/100.0` health cell).

- [ ] **Step 5: Commit**

```bash
git add observability/activity_feed.py tests/observability/activity_feed_test.py
git commit -m "feat(home): feed verbs + world-table stakeholders/health(max) columns (L2a)"
```

---

## Task 10: Constants-ordering asserts (anti-blob + L1-parity invariants)

Lock the cross-constant relationships the health formula relies on, so a future retune that breaks the anti-blob or L1-parity guarantees fails CI.

**Files:**
- Test: `tests/core/constants_test.py`

**Interfaces:**
- Consumes: `HOME_HEALTH_BASE`, `HOME_HEALTH_CEIL`, `HOME_HEALTH_DIMINISH`, `HOME_MAX_INTEGRITY` (all from Task 2).
- Produces: an invariant-lock test.

- [ ] **Step 1: Write the test**

Append to `tests/core/constants_test.py`:

```python
def test_home_health_constants_present_and_honor_anti_blob() -> None:
    """The stakeholder-health dials exist and lock the anti-blob / L1-parity invariants (spec §12)."""
    assert isinstance(constants.HOME_HEALTH_BASE, float)
    assert isinstance(constants.HOME_HEALTH_CEIL, float)
    assert isinstance(constants.HOME_HEALTH_DIMINISH, float)
    # A lone home is exactly the L1 home.
    assert constants.HOME_HEALTH_BASE == constants.HOME_MAX_INTEGRITY
    # Anti-blob: the ceiling is at most 2x base (many contestable homes > one mega-fortress).
    assert constants.HOME_HEALTH_CEIL <= 2 * constants.HOME_HEALTH_BASE
    assert constants.HOME_HEALTH_BASE < constants.HOME_HEALTH_CEIL
    # Diminishing returns in (0, 0.5].
    assert 0.0 < constants.HOME_HEALTH_DIMINISH <= 0.5
```

- [ ] **Step 2: Run the test**

Run: `pytest tests/core/constants_test.py::test_home_health_constants_present_and_honor_anti_blob -v`
Expected: PASS given Task 2's values. This test is a guard-lock: it would FAIL had Task 2 set `HOME_HEALTH_CEIL > 2 * HOME_HEALTH_BASE`, `HOME_HEALTH_BASE != HOME_MAX_INTEGRITY`, or `HOME_HEALTH_DIMINISH > 0.5` — pinning the anti-blob and L1-parity relationships against future retuning.

- [ ] **Step 3: Commit**

```bash
git add tests/core/constants_test.py
git commit -m "test(home): lock anti-blob + L1-parity health-constant invariants (L2a)"
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

Expected: ruff clean, format clean, mypy clean, all tests pass, coverage ≥ 90%. If `--cov-report=term-missing` flags an uncovered branch in `world/tick.py` (the collective-pool sweep — e.g. the ghost-owner-not-in-stakeholders branch, or the multi-payer draw loop), `world/world.py` (`remove_stakeholder` promotion / clamp), or `tools/builtin/homes.py` (`pledge_home`/`leave_home` guards), add the missing-path test before merging. Merge only on green.

---

## Self-Review (against spec §12 — 2a DECOMPOSITION + governing resolutions)

**Spec §12 coverage** — every 2a item maps to a task:
- `Home.stakeholders` (builder = owner + first stakeholder) → Task 1.
- Pure `max_integrity(s)` (formula + `HOME_HEALTH_BASE/CEIL/DIMINISH`) wired into the `modify_home_integrity` clamp (Task 2) AND the tick repair-target (Task 4); clamp DOWN on stakeholder loss → `remove_stakeholder` (Task 3), exercised by leave (Task 7) + kill (Task 5).
- `WorldState` sync/event-free `add_stakeholder`/`remove_stakeholder`(+promote+clamp)/`is_stakeholder` + stakeholder-aware `stakeholder_home_of` (+ `get_home`); `home_of` kept owner-only for the build check → Task 3.
- Tick collective-pool upkeep (owner-first then by id, all-or-nothing; decay + freeze `last_upkeep_at`; silent) → Task 4.
- `kill_agent` prune-at-kill-time / promote-owner-on-owner-death-with-survivors / clamp → Task 5.
- `pledge_home` (Task 6), `leave_home` + widen `use_hearth` to any stakeholder with PERSONAL-materials fuel (Task 7); each new tool in BOTH `BUILTIN_TOOLS` + `TOOL_SCHEMAS` (parity test) with DD9 schema text.
- LOCAL `home_joined` / `home_left`; feed verbs + world-table Stakeholders/Health(max) → Tasks 6/7/9.
- `WORLD_MECHANICS` DD9 shared-home prose → Task 8.
- Constants + ordering asserts (`HOME_HEALTH_BASE == HOME_MAX_INTEGRITY`, `HOME_HEALTH_CEIL <= 2*HOME_HEALTH_BASE`) → Tasks 2 + 10.
- Collapse still just removes (ruins 2c); heal-to-`max_integrity(s)` retained (incremental repair 2c) → Task 4.

**Reviewer's must-have tests** — all present: `max_integrity` at s=1..cap (T2); dup-stakeholder no-op (T3); collective-pool solvent-covers / partial-across-payers / none→decay+freeze (T4); kill prunes + promotes owner + clamps (T5); leave_home same prune/promote/clamp (T7); widened `use_hearth` works for a non-owner stakeholder and still burns personal materials, owner stock untouched (T7).

**Type/name consistency** — verified across tasks: `max_integrity(stakeholder_count: int) -> float`; `add_stakeholder`/`remove_stakeholder`/`is_stakeholder`(`home_id, agent_id`); `stakeholder_home_of`/`get_home`(id); tools `pledge_home(..., home_id)` / `leave_home(...)`; events `home_joined`/`home_left`; success prefixes `"You pledge yourself to this home"` / `"You give up your place"`; constants `HOME_HEALTH_BASE/CEIL/DIMINISH` used identically in the constant, the helper, and the tests.

**Resolved spec ambiguities:**
1. **`max_integrity` domain.** The formula is defined for `s >= 1`; `s <= 1` (a lone home, or the empty case after the last stakeholder departs) returns `HOME_HEALTH_BASE`, so the ceiling is never a degenerate `0`/negative cap. Locked by the T2 test (`max_integrity(0) == base`).
2. **Payer set derivation.** The spec's `[owner]+stakeholders` assumes the owner is a stakeholder (the build invariant). The tick derives payers as *owner-first only when it is still a stakeholder*, then the remaining stakeholders by id — so a promoted-away/ghost owner (owner_id no longer in stakeholders) never pays, and a sole-owner departure/death leaves the home with no living payer → it decays to collapse (spec §6). Locked by T4's ownerless-home test.
3. **All-or-nothing collective draw.** "draw … until covered; else decay+freeze" is implemented as: pre-sum the living pool; if `>= owed`, draw across payers in order; otherwise draw nothing, decay, and freeze `last_upkeep_at` (matching L1's all-or-nothing + back-rent). Locked by T4's none→decay+freeze test.
4. **`remove_stakeholder` is the shared prune/promote/clamp primitive.** Both `leave_home` (T7) and `kill_agent` (T5) call it, so departure and death share one implementation (DRY); promotion targets the lowest-id (`min`) survivor.
5. **`pledge_home` targets by `home_id`** (unambiguous with multiple homes per region; matches the attack/transfer/mating targeting pattern). Per-breath agent-facing discoverability of home ids (`look_around`/perception) is out of this slice's file scope and deferred (L1 shipped homes without per-breath self-perception on the same rationale); the world-table + feed surface ids to the observer now.
6. **Conservation in 2a** is guarded by the widened-`use_hearth` test (burns personal materials only; owner stock untouched — no vault fountain) and the upkeep-as-pure-sink assertions; the comprehensive multi-pool conservation *property* test (agents + regions + vaults + remnants) lands with 2b/2c when vaults/remnants exist (spec §12).
