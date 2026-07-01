# Vivarium Layer 2b — The Storage Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a home a shared, materials-only **storage vault** stakeholders can bank into and draw back out. A stakeholder co-located at its home moves materials from its **personal** stock into the home's vault (`deposit_to_home`) and back out again (`withdraw_from_home`) — always **moving**, never minting. A vault heavy with materials makes the *home* (not the depositor) the visible hoard: `home_is_hoarding(home) = vault_materials >= HOARDING_MATERIALS_THRESHOLD`, and the crossing publishes a LOCAL `home_started_hoarding` event (mirroring the per-agent hoard-crossing announce) so co-located beings perceive the new raid target — no laundering. Per-deposit/withdraw operations are otherwise **silent** (surfaced via the vault column + `look_around`, not feed spam). The energy economy is untouched: the vault is materials-only (the hearth already gives energy liquidity).

**Architecture:** Event-driven, unchanged. `Home` gains one field, `vault_materials: float = 0.0` (materials-only — there is **no** energy vault). Two new `WorldState` methods (sync, event-free — the world holds no bus, DD4) move the vault balance: `deposit_to_home_vault(home_id, amount)` (credit, floored at 0) and `withdraw_from_home_vault(home_id, amount)` (debit, floored at 0 and capped at the balance). A pure `home_is_hoarding(home) -> bool` predicate lives in `world/homes.py` as a sibling of `max_integrity` and a mirror of `world.agents.is_hoarding` (a pure predicate on the domain object, not a WorldState method). Two new closure-signature tools in `tools/builtin/homes.py` — `deposit_to_home` and `withdraw_from_home` — reuse `use_hearth`'s guard chain (exists → ALIVE → `stakeholder_home_of` → region match → sufficiency) and the conservation discipline (**deduct the source FIRST, then credit the destination**, so a floor can never mint). `deposit_to_home` mirrors `_announce_if_started_hoarding` via a new `_announce_if_home_started_hoarding` helper (snapshot the home's hoard state **before** the credit, announce the crossing **after**); `withdraw_from_home` is fully silent (a withdrawal only lowers the vault, so no crossing is possible). Both tools are registered in **both** `BUILTIN_TOOLS` and `TOOL_SCHEMAS` (the existing parity test keeps the maps in lock-step). Perception: `WORLD_MECHANICS` gains a DD9 vault clause, `look_around` shows a co-located being its own home's vault, the world-table gains a **Vault** column, and the feed learns the `home_started_hoarding` verb.

**Tech Stack:** Python 3.13, stdlib `dataclasses`/`enum`/`asyncio`, `rich` (feed), `pytest` + `pytest-asyncio` + `pytest-cov`, `ruff`, `mypy --strict`.

## Global Constraints

Every task's requirements implicitly include this section.

- **Python 3.13**; modern syntax already in the codebase (`match`, walrus `:=`, `str | None`, `dict[str, X]`, string `Enum`, `async`/`await`).
- **`mypy --strict` clean** on `core tests world bus tools config agents observability`.
- **`ruff check .` clean** and **`ruff format --check .` clean** (imports isort-ordered; no unused imports — import a constant/symbol only in the task that first uses it; no f-string without a placeholder).
- **Google-style docstrings** on every new module, class, and public function — for tools and world methods, document *which world state it mutates and which events it emits*.
- **No `print()` in library code** — use `logging` (the `rich` activity feed is the separate rendering layer).
- **Deterministic tests** (`*_test.py` naming): never call a live LLM/Ollama; all randomness via the injected seeded RNG (`world.rng`); all time via the injected clock (`world.now()` / the `fake_clock` fixture). Use `pytest.approx` for accumulated-float comparisons.
- **Constants in `core/constants.py`** (typed `Final`, provenance docstring). **2b adds NO new dial** — it reuses the existing `HOARDING_MATERIALS_THRESHOLD` (`300.0`) as the vault hoard threshold, and the vault is uncapped (materials, floored only — like an agent's `current_materials`). Do not scatter magic numbers into tool files.
- **Preserve domain patterns:** tools return natural-language result strings (`"Error: "` precondition/lookup failure, `"Invalid: "` rule violation, or a plain success sentence — never exceptions/booleans); in-place mutation of the mutable `WorldState` singleton; the uniform closure tool signature `async def tool(world, event_bus, agent_id, **params) -> str`; `WorldState` mutations stay **sync and event-free** (events are published by *tools*/the tick, never by `WorldState`).
- **DD9 (system prompt):** `WORLD_MECHANICS` describes in-world *physics/consequences only* — no goals, objectives, strategy, survival framing, or language revealing the simulation. New prose must avoid every term in `tests/agents/prompt_test.py::FORBIDDEN_TERMS` (`goal, objective, mission, task, strategy, win, lose, survive, survival, simulation, simulated, score, reward, optimize, optimise, death, die`) and the phrase `"you should"`.
- **CONSERVATION (binding — spec §12, fork 3 + CONSERVATION INVARIANTS):**
  - deposit = personal → vault: **deduct personal FIRST** (`modify_agent_materials(agent_id, -amount)`), **then** credit the vault (`deposit_to_home_vault`).
  - withdraw = vault → personal: **deduct the vault FIRST** (`withdraw_from_home_vault`), **then** credit personal (`modify_agent_materials(agent_id, +amount)`).
  - **Nothing is minted.** Both tools reject an over-request (`amount > source balance`) *before* any mutation, so the credited amount always equals the debited amount (a floor-at-0 can never silently create a delta). **Energy is untouched** — the vault is materials-only.
- **No still-life / no laundering (spec §12):** vault contents count toward hoarding at the **home** level; depositing moves the hoard-signal from agent → home (a raid target), it never hides it.
- **BUILTIN_TOOLS / TOOL_SCHEMAS parity:** every new tool is added to **both** maps in the same task; `tests/agents/tool_schemas_test.py::test_schema_set_matches_builtin_tools` (existing) enforces it.
- **≥90% coverage on core** (`world/`, `bus/`, `tools/`, `core/`, `agents/`, `observability/`).

### New constants

**None.** 2b reuses `HOARDING_MATERIALS_THRESHOLD` (`core/constants.py:304`, `300.0`) as the vault hoard threshold and adds no vault cap. `constants_test.py` is unchanged by this slice.

### Conservation model (spec §12, fork 3 — GOVERNING)

```
vault is materials-only (no energy vault; the hearth supplies energy liquidity)

deposit(amount):   personal -= amount   THEN   vault += amount     (reject if amount > personal)
withdraw(amount):  vault    -= amount    THEN   personal += amount  (reject if amount > vault)

INVARIANT: total materials (Σ agents.current_materials + Σ regions.current_materials
           + Σ homes.vault_materials) is unchanged by any deposit or withdraw;
           total energy is unchanged by any deposit or withdraw.

home_is_hoarding(home) := home.vault_materials >= HOARDING_MATERIALS_THRESHOLD   (300.0)
```

### Deposit/withdraw event policy (spec §12 resolution — GOVERNING)

Per-deposit and per-withdraw operations emit **no plain event** — the vault balance is surfaced through the world-table **Vault** column and `look_around`, not through feed spam (§12: "surface via the vault column, not feed spam"; §8 marked `home_deposit`/`home_withdraw` as "(maybe)"). The **only** vault event is the hoard-crossing: `deposit_to_home` publishes exactly one LOCAL `home_started_hoarding` when a deposit lifts the vault from below to at/above the threshold (never again while already hoarding, and never on a withdrawal — a "stopped hoarding" event is not emitted, mirroring the per-agent `agent_started_hoarding`, which only ever announces the *start* crossing).

### Final CI gate (run before merge; this is what CI runs)

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

---

## File Structure

- `world/homes.py` — **modify**: add `Home.vault_materials: float = 0.0` (last field, defaulted) (Task 1) and the pure `home_is_hoarding(home)` predicate (Task 1).
- `world/world.py` — **modify**: add `deposit_to_home_vault` + `withdraw_from_home_vault` methods in the "Home methods" section (Task 2). `build_home` needs **no change** — the new field is defaulted, so a freshly built home has `vault_materials == 0.0` automatically.
- `tools/builtin/homes.py` — **modify**: add `deposit_to_home` (Task 3) + `withdraw_from_home` (Task 4) tools and the `_announce_if_home_started_hoarding` helper (Task 3).
- `tools/builtin/__init__.py` — **modify**: register `deposit_to_home` (Task 3) + `withdraw_from_home` (Task 4) in `BUILTIN_TOOLS` + `__all__`.
- `agents/tool_schemas.py` — **modify**: add `deposit_to_home` (Task 3) + `withdraw_from_home` (Task 4) schemas to `TOOL_SCHEMAS`.
- `agents/prompt.py` — **modify**: extend `WORLD_MECHANICS` with the vault clause (DD9) (Task 5).
- `tools/builtin/movement.py` — **modify**: `look_around` shows a co-located being its own home's vault (Task 6).
- `observability/activity_feed.py` — **modify**: `_EVENT_VERBS` for `home_started_hoarding`; world-table **Vault** column (Task 7).
- Tests: `tests/world/homes_test.py`, `tests/world/world_test.py`, `tests/tools/homes_test.py`, `tests/agents/prompt_test.py`, `tests/tools/movement_test.py`, `tests/observability/activity_feed_test.py`. (Parity is covered by the existing `tests/agents/tool_schemas_test.py`.)

---

## Task 1: `Home.vault_materials` field + `home_is_hoarding(home)` predicate

The whole `world/homes.py` surface for the vault: one defaulted data field and one pure predicate (a sibling of `max_integrity`, mirroring `world.agents.is_hoarding`). `build_home` constructs the `Home` without this argument, so the default flows through untouched.

**Files:**
- Modify: `world/homes.py` (add the field; add `home_is_hoarding`)
- Test: `tests/world/homes_test.py`, `tests/world/world_test.py`

**Interfaces:**
- Consumes: `core.constants.HOARDING_MATERIALS_THRESHOLD` (existing, `300.0`).
- Produces:
  - `Home.vault_materials: float = 0.0` — the home's shared, materials-only store; last field, defaulted (positional construction and `stakeholders=` construction both keep working).
  - `world.homes.home_is_hoarding(home: Home) -> bool` — pure; returns `home.vault_materials >= HOARDING_MATERIALS_THRESHOLD`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/homes_test.py` (it already imports `Home` and `max_integrity`; add the two new imports):

```python
from core.constants import HOARDING_MATERIALS_THRESHOLD
from world.homes import home_is_hoarding


def test_home_has_vault_defaulting_zero() -> None:
    """A Home carries a materials-only vault balance, defaulting to 0.0."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert home.vault_materials == 0.0
    home.vault_materials += 25.0
    assert home.vault_materials == 25.0


def test_home_still_uses_slots_with_vault() -> None:
    """slots=True holds after adding the vault field (no per-instance __dict__)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    assert not hasattr(home, "__dict__")


def test_home_is_hoarding_below_threshold_is_false() -> None:
    """A vault below the materials threshold is not a hoard."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD - 0.01
    assert home_is_hoarding(home) is False


def test_home_is_hoarding_at_threshold_is_true() -> None:
    """At exactly the threshold the home counts as hoarding (>=, inclusive)."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD
    assert home_is_hoarding(home) is True


def test_home_is_hoarding_above_threshold_is_true() -> None:
    """A vault above the threshold is a hoard."""
    home = Home("h", "o", "r", 1.0, 2.0, 3.0)
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD + 50.0
    assert home_is_hoarding(home) is True
```

Append to `tests/world/world_test.py` (it already imports `HOME_MAX_INTEGRITY` and uses the `world` fixture):

```python
def test_build_home_starts_with_empty_vault(world: WorldState) -> None:
    """A freshly built home has an empty (0.0) vault — the field default flows through."""
    world.build_home(
        "h1", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.homes["h1"].vault_materials == 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/homes_test.py tests/world/world_test.py::test_build_home_starts_with_empty_vault -v`
Expected: FAIL — `Home` has no `vault_materials`; `world.homes.home_is_hoarding` does not exist (`ImportError`).

- [ ] **Step 3: Implement the field and the predicate**

In `world/homes.py`, extend the import line and add the field as the **last** dataclass field (keep the existing module/class docstrings; extend the `Attributes:` list):

```python
from core.constants import (
    HOARDING_MATERIALS_THRESHOLD,
    HOME_HEALTH_BASE,
    HOME_HEALTH_CEIL,
    HOME_HEALTH_DIMINISH,
)
```

```python
    home_id: str
    owner_id: str
    region: str
    integrity: float
    built_at: float
    last_upkeep_at: float
    stakeholders: list[str] = field(default_factory=list)
    vault_materials: float = 0.0
```

Add to the class `Attributes:` docstring:

```
        vault_materials: The home's shared, materials-only store (Layer 2b). Stakeholders
            bank materials in via ``deposit_to_home`` and draw them out via
            ``withdraw_from_home``; the balance counts toward hoarding at the HOME level
            (:func:`home_is_hoarding`). There is no energy vault (the hearth supplies energy).
```

Add the predicate at module level (below `max_integrity`), mirroring `world.agents.is_hoarding`:

```python
def home_is_hoarding(home: Home) -> bool:
    """Return whether a home's vault holds a hoard of materials.

    Pure (no side effects). The vault counts toward hoarding at the HOME level (spec §12,
    fork 3): banking materials into a home moves the hoard-signal from the depositor to the
    home (a raid target) rather than hiding it — no laundering. Reuses the same materials
    dial as the per-agent :func:`~world.agents.is_hoarding`, so a home and a being are judged
    against one threshold.

    Args:
        home: The home whose vault to inspect.

    Returns:
        ``True`` if ``home.vault_materials`` is at or above
        :data:`~core.constants.HOARDING_MATERIALS_THRESHOLD`.
    """
    return home.vault_materials >= HOARDING_MATERIALS_THRESHOLD
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/homes_test.py tests/world/world_test.py -v`
Expected: PASS (existing L1/2a home tests still green — a defaulted field is backward-compatible; positional `Home(...)` construction is unaffected).

- [ ] **Step 5: Commit**

```bash
git add world/homes.py tests/world/homes_test.py tests/world/world_test.py
git commit -m "feat(home): Home.vault_materials + home_is_hoarding predicate (L2b)"
```

---

## Task 2: `WorldState.deposit_to_home_vault` / `withdraw_from_home_vault`

The sync, event-free world-layer primitives that move the vault balance. Both floor at 0.0 (like `modify_agent_materials`); `withdraw_from_home_vault` additionally caps the debit at the balance so it is safe standalone. Conservation between personal stock and the vault is orchestrated by the *tools* (Tasks 3–4), which reject over-requests before calling these.

**Files:**
- Modify: `world/world.py` (add both methods in the "Home methods" section, e.g. after `remove_stakeholder`)
- Test: `tests/world/world_test.py`

**Interfaces:**
- Consumes: `self.homes` (existing).
- Produces:
  - `WorldState.deposit_to_home_vault(self, home_id: str, amount: float) -> bool` — `home.vault_materials = max(home.vault_materials + amount, 0.0)`; `True` if the home exists, else `False`.
  - `WorldState.withdraw_from_home_vault(self, home_id: str, amount: float) -> bool` — `home.vault_materials = max(home.vault_materials - amount, 0.0)` (so a debit larger than the balance leaves exactly `0.0`, never negative); `True` if the home exists, else `False`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/world/world_test.py`:

```python
def test_deposit_to_home_vault_credits_balance(world: WorldState) -> None:
    """Depositing raises the vault; an unknown home is a no-op False."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=50.0)
    assert world.deposit_to_home_vault("h1", 40.0) is True
    assert world.homes["h1"].vault_materials == 40.0
    assert world.deposit_to_home_vault("h1", 10.0) is True  # accumulates
    assert world.homes["h1"].vault_materials == 50.0
    assert world.deposit_to_home_vault("missing", 5.0) is False  # unknown home


def test_withdraw_from_home_vault_debits_balance(world: WorldState) -> None:
    """Withdrawing lowers the vault; an unknown home is a no-op False."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=50.0)
    world.deposit_to_home_vault("h1", 40.0)
    assert world.withdraw_from_home_vault("h1", 15.0) is True
    assert world.homes["h1"].vault_materials == 25.0
    assert world.withdraw_from_home_vault("missing", 5.0) is False  # unknown home


def test_withdraw_from_home_vault_caps_at_balance_and_floors_at_zero(world: WorldState) -> None:
    """A debit larger than the balance empties the vault to exactly 0.0 (never negative)."""
    world.build_home("h1", "wanderer_001", "alpha", built_at=world.now(), integrity=50.0)
    world.deposit_to_home_vault("h1", 30.0)
    assert world.withdraw_from_home_vault("h1", 1000.0) is True
    assert world.homes["h1"].vault_materials == 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/world/world_test.py -k "home_vault" -v`
Expected: FAIL — `WorldState` has no `deposit_to_home_vault` / `withdraw_from_home_vault`.

- [ ] **Step 3: Implement the two methods**

In `world/world.py`, in the "Home methods" section (e.g. immediately after `remove_stakeholder`):

```python
    def deposit_to_home_vault(self, home_id: str, amount: float) -> bool:
        """Add ``amount`` to a home's vault, flooring at 0.0. Sync and event-free.

        The vault is the home's shared, materials-only store (Layer 2b). This is a pure
        credit: the caller (the ``deposit_to_home`` tool) is responsible for deducting the
        matching materials from the depositor FIRST (conservation — nothing is minted). The
        world holds no bus (DD4), so no event is emitted here. Mutates the home's
        :attr:`~world.homes.Home.vault_materials`.

        Args:
            home_id: Id of the home whose vault to credit.
            amount: Materials to add (floored at 0.0 defensively).

        Returns:
            ``True`` if the home exists and was credited; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.vault_materials = max(home.vault_materials + amount, 0.0)
        return True

    def withdraw_from_home_vault(self, home_id: str, amount: float) -> bool:
        """Subtract ``amount`` from a home's vault, capped at the balance (floored at 0.0).

        Sync and event-free (DD4). A debit larger than the current balance empties the vault
        to exactly ``0.0`` rather than going negative, so the method is safe standalone; the
        caller (the ``withdraw_from_home`` tool) additionally rejects an over-request before
        crediting the withdrawer, so the amount debited here always equals the amount credited
        to personal stock (conservation — nothing is minted). Mutates the home's
        :attr:`~world.homes.Home.vault_materials`.

        Args:
            home_id: Id of the home whose vault to debit.
            amount: Materials to remove (capped at the balance; result floored at 0.0).

        Returns:
            ``True`` if the home exists and was debited; ``False`` if the home is unknown.
        """
        home = self.homes.get(home_id)
        if home is None:
            return False
        home.vault_materials = max(home.vault_materials - amount, 0.0)
        return True
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/world/world_test.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add world/world.py tests/world/world_test.py
git commit -m "feat(world): deposit/withdraw home-vault methods (L2b)"
```

---

## Task 3: `deposit_to_home` tool + hoard-crossing announcement + registration + schema

A stakeholder co-located at its home moves materials from **personal stock → the vault** (deduct personal first, then credit the vault). On the crossing into a home-level hoard, publish exactly one LOCAL `home_started_hoarding`, mirroring `_announce_if_started_hoarding` (snapshot before, announce after). Per-deposit operations are otherwise silent.

**Files:**
- Modify: `tools/builtin/homes.py` (add `_announce_if_home_started_hoarding` + `deposit_to_home`; extend imports)
- Modify: `tools/builtin/__init__.py` (register in `BUILTIN_TOOLS` + `__all__`)
- Modify: `agents/tool_schemas.py` (add the `deposit_to_home` schema)
- Test: `tests/tools/homes_test.py` (+ existing parity test)

**Interfaces:**
- Consumes: `WorldState.get_agent`, `WorldState.stakeholder_home_of`, `WorldState.modify_agent_materials`, `WorldState.deposit_to_home_vault`; `world.homes.home_is_hoarding`; `world.agents.AgentStatus`; `tools.builtin.resources._coerce_positive_amount`; `bus.events.Event`/`ScopeType`.
- Produces:
  - `tools.builtin.homes._announce_if_home_started_hoarding(event_bus: EventBus, home: Home, *, was_hoarding: bool, source: str, region: str, timestamp: float) -> None` — publishes one LOCAL `home_started_hoarding` iff `not was_hoarding and home_is_hoarding(home)`.
  - `tools.builtin.homes.deposit_to_home(world: WorldState, event_bus: EventBus, agent_id: str, amount: float) -> str`
  - `"deposit_to_home"` entry in `BUILTIN_TOOLS`, `__all__`, and `TOOL_SCHEMAS`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/homes_test.py` (extend its imports: add `home_is_hoarding` from `world.homes` and `deposit_to_home` from `tools.builtin.homes`):

```python
# ---- deposit_to_home --------------------------------------------------------


async def test_deposit_to_home_moves_personal_to_vault_conserving(
    world: WorldState, event_bus: EventBus
) -> None:
    """A deposit moves materials personal -> vault, exactly (personal down == vault up)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 40.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert ada.current_materials == 60.0  # personal down 40
    assert home.vault_materials == 40.0  # vault up 40 (conserved: same 40 moved)
    # Silent per-deposit: no home_started_hoarding (well below threshold) and no plain event.
    assert [e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"] == []
    assert result.startswith("You set")


async def test_deposit_to_home_cannot_deposit_more_than_personal(
    world: WorldState, event_bus: EventBus
) -> None:
    """Requesting more than the being holds is Invalid and mutates nothing (no mint)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 10.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 25.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 10.0  # untouched
    assert home.vault_materials == 0.0  # nothing minted into the vault
    assert event_bus.get_events("wanderer_001") == []


async def test_deposit_to_home_crossing_threshold_announces_once(
    world: WorldState, event_bus: EventBus
) -> None:
    """A deposit that lifts the vault to/over the hoard threshold emits one home_started_hoarding.

    A second deposit while ALREADY hoarding must NOT re-announce (mirrors the per-agent
    was_hoarding snapshot: only the crossing is announced).
    """
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    home = world.get_home("home_ada")
    assert home is not None
    home.vault_materials = HOARDING_MATERIALS_THRESHOLD - 10.0  # just below
    ada.current_materials = 100.0
    assert home_is_hoarding(home) is False

    await deposit_to_home(world, event_bus, "wanderer_001", 20.0)  # crosses to +10 over

    assert home.vault_materials == HOARDING_MATERIALS_THRESHOLD + 10.0
    assert home_is_hoarding(home) is True
    started = [
        e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"
    ]
    assert len(started) == 1
    assert started[0].scope is ScopeType.LOCAL
    assert started[0].region == "alpha"
    assert started[0].timestamp == world.now()

    # Deposit again while already hoarding -> no second announcement.
    await deposit_to_home(world, event_bus, "wanderer_001", 20.0)
    started_again = [
        e for e in event_bus.get_events("wanderer_001") if e.type == "home_started_hoarding"
    ]
    assert started_again == []


async def test_deposit_to_home_not_at_home_region_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A stakeholder standing away from its home cannot deposit (region check)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    assert world.move_agent("wanderer_001", "beta") is True  # walk away from the home
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0  # nothing moved


async def test_deposit_to_home_non_stakeholder_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """A being that stakes no home (co-located with another's home or not) cannot deposit."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    boris = world.get_agent("wanderer_002")  # in alpha, but NOT a stakeholder of home_ada
    assert boris is not None
    boris.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_002", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Error:")
    assert boris.current_materials == 100.0 and home.vault_materials == 0.0


async def test_deposit_to_home_while_paralyzed_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    """A fallen being cannot tend its home's store (mirrors use_hearth's ALIVE guard)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0
    world.modify_agent_energy("wanderer_001", -(ada.current_energy - 1.0))  # -> PARALYZED
    assert ada.status is AgentStatus.PARALYZED

    result = await deposit_to_home(world, event_bus, "wanderer_001", 20.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0


async def test_deposit_to_home_unknown_agent_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    """A missing being cannot deposit (defensive: the registry also guards this)."""
    result = await deposit_to_home(world, event_bus, "ghost", 20.0)
    assert result.startswith("Error:")


async def test_deposit_to_home_non_positive_amount_is_rejected(
    world: WorldState, event_bus: EventBus
) -> None:
    """A zero/negative amount is rejected before any mutation (shared amount coercion)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0

    result = await deposit_to_home(world, event_bus, "wanderer_001", -5.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert ada.current_materials == 100.0 and home.vault_materials == 0.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k deposit -v`
Expected: FAIL — `deposit_to_home` does not exist (`ImportError`).

- [ ] **Step 3: Implement the helper, the tool, and register it**

In `tools/builtin/homes.py`, extend the imports (add `home_is_hoarding` and the amount coercer; keep the existing `_announce_if_started_hoarding` import and `HOARDING`-free constant list):

```python
from tools.builtin.resources import _announce_if_started_hoarding, _coerce_positive_amount
from world.agents import AgentStatus, is_hoarding
from world.homes import Home, home_is_hoarding
from world.world import WorldState
```

Add the announcement helper (mirrors `resources._announce_if_started_hoarding`) — place it near the top of the module, below the imports:

```python
async def _announce_if_home_started_hoarding(
    event_bus: EventBus,
    home: Home,
    *,
    was_hoarding: bool,
    source: str,
    region: str,
    timestamp: float,
) -> None:
    """Publish a LOCAL ``home_started_hoarding`` event iff this deposit crossed the threshold.

    The home-level mirror of :func:`~tools.builtin.resources._announce_if_started_hoarding`:
    a vault that becomes a hoard by a deposit is announced once, the moment it crosses, so
    co-located beings perceive the new raid target (spec §12, fork 3 — the hoard-signal moves
    agent -> home, no laundering). Does nothing if the home was already hoarding or is still
    below the threshold. Only the crossing is announced (there is no "stopped hoarding" event).

    Args:
        event_bus: The bus the event is published to.
        home: The credited home (its ``vault_materials`` already reflects the deposit).
        was_hoarding: Whether the home was hoarding *before* the deposit.
        source: Id of the being that made the deposit (the event's source).
        region: Region to scope the LOCAL announcement to.
        timestamp: World-clock stamp for the event.

    Returns:
        None.
    """
    if was_hoarding or not home_is_hoarding(home):
        return
    await event_bus.publish(
        Event(
            "home_started_hoarding",
            source,
            {
                "message": (
                    f"The home {home.home_id} in {region} is now sitting on a great store "
                    f"of materials (vault {home.vault_materials})."
                )
            },
            scope=ScopeType.LOCAL,
            region=region,
            timestamp=timestamp,
        )
    )
```

Add the tool (after `leave_home`):

```python
async def deposit_to_home(
    world: WorldState, event_bus: EventBus, agent_id: str, amount: float
) -> str:
    """Bank materials from the being's personal stock into its home's shared vault.

    A stakeholder standing where its home stands moves ``amount`` materials from its own
    holding into the home's vault. Conserved (spec §12): the materials are deducted from the
    being FIRST, then credited to the vault — the same amount moved, nothing minted. The vault
    is materials-only; energy is untouched.

    Mutates world state:
        * Deducts ``amount`` from the being's materials
          (:meth:`~world.world.WorldState.modify_agent_materials`), then adds it to the home's
          vault (:meth:`~world.world.WorldState.deposit_to_home_vault`).

    Emits events:
        * One ``"home_started_hoarding"`` event (:attr:`~bus.events.ScopeType.LOCAL`, source =
          the depositor, region = the home's region, stamped ``world.now()``) **only** when this
          deposit lifts the vault from below to at/above
          :data:`~core.constants.HOARDING_MATERIALS_THRESHOLD` (see
          :func:`~world.homes.home_is_hoarding`). Per-deposit operations are otherwise silent —
          the balance is surfaced via the vault column and ``look_around``.

    Args:
        world: The live world state.
        event_bus: The bus the resulting event is published to.
        agent_id: Id of the depositing being.
        amount: Materials to move from personal stock into the vault.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being is
        unknown or belongs to no home; an ``"Invalid: "`` string if the amount is not a
        positive number, the being is fallen, it is not where its home stands, or it lacks
        that many materials (rejected calls mutate nothing).
    """
    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot tend a home's store; "
            "only another being can restore you."
        )
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to store materials in."
    if home.region != agent.current_position:
        return "Invalid: You are not where your home stands; you can add to its store only there."
    if agent.current_materials < quantity:
        return (
            f"Invalid: You do not have {quantity} materials to store "
            f"(you hold {agent.current_materials})."
        )

    # Snapshot the home's hoard state BEFORE any mutation so we announce only the crossing
    # (mirrors harvest_resources/use_hearth). A deposit only raises the vault, so the vault
    # can only cross UP into hoarding.
    was_hoarding = home_is_hoarding(home)

    world.modify_agent_materials(agent_id, -quantity)  # deduct the source FIRST (conservation)
    world.deposit_to_home_vault(home.home_id, quantity)  # THEN credit the vault
    await _announce_if_home_started_hoarding(
        event_bus,
        home,
        was_hoarding=was_hoarding,
        source=agent_id,
        region=home.region,
        timestamp=world.now(),
    )
    return (
        f"You set {quantity} materials into your home's store. It now holds "
        f"{home.vault_materials} materials; you hold {agent.current_materials}."
    )
```

In `tools/builtin/__init__.py`, import and register `deposit_to_home` (add to the `from tools.builtin.homes import ...` line, to `__all__`, and to `BUILTIN_TOOLS`):

```python
from tools.builtin.homes import (
    build_home,
    deposit_to_home,
    leave_home,
    pledge_home,
    use_hearth,
)
```

```python
    "build_home": build_home,
    "use_hearth": use_hearth,
    "pledge_home": pledge_home,
    "leave_home": leave_home,
    "deposit_to_home": deposit_to_home,
```

(and add `"deposit_to_home",` to `__all__` in alphabetical position).

In `agents/tool_schemas.py`, add the schema to `TOOL_SCHEMAS` (after `leave_home`):

```python
    "deposit_to_home": {
        "type": "function",
        "function": {
            "name": "deposit_to_home",
            "description": (
                "Set some of your own materials into the shared store of the home you share, "
                "where you stand. What you set aside stays in the home's keeping until you "
                "draw it back out. A home grown heavy with a great store draws notice."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "How many materials to set into the home's store.",
                    },
                },
                "required": ["amount"],
            },
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py -k deposit tests/agents/tool_schemas_test.py -v`
Expected: PASS — the deposit tests pass and `test_schema_set_matches_builtin_tools` stays green (both maps gained `deposit_to_home`).

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py
git commit -m "feat(tools): deposit_to_home + home hoard-crossing announce (L2b)"
```

---

## Task 4: `withdraw_from_home` tool + registration + schema + conservation property test

The reverse flow: a stakeholder co-located at its home moves materials from **the vault → personal stock** (deduct the vault first, then credit personal). A withdrawal only lowers the vault, so it can never cross into hoarding — it is fully silent. This task also lands the multi-pool **conservation property test** (deferred from 2a until vaults exist).

**Files:**
- Modify: `tools/builtin/homes.py` (add `withdraw_from_home`)
- Modify: `tools/builtin/__init__.py` (register in `BUILTIN_TOOLS` + `__all__`)
- Modify: `agents/tool_schemas.py` (add the `withdraw_from_home` schema)
- Test: `tests/tools/homes_test.py` (+ existing parity test)

**Interfaces:**
- Consumes: `WorldState.get_agent`, `WorldState.stakeholder_home_of`, `WorldState.withdraw_from_home_vault`, `WorldState.modify_agent_materials`; `world.agents.AgentStatus`; `tools.builtin.resources._coerce_positive_amount`.
- Produces:
  - `tools.builtin.homes.withdraw_from_home(world: WorldState, event_bus: EventBus, agent_id: str, amount: float) -> str`
  - `"withdraw_from_home"` entry in `BUILTIN_TOOLS`, `__all__`, and `TOOL_SCHEMAS`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/homes_test.py` (add `withdraw_from_home` to the `tools.builtin.homes` import):

```python
# ---- withdraw_from_home -----------------------------------------------------


async def test_withdraw_from_home_moves_vault_to_personal_conserving(
    world: WorldState, event_bus: EventBus
) -> None:
    """A withdrawal moves materials vault -> personal, exactly (vault down == personal up)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 60.0)
    ada.current_materials = 10.0

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 25.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert home.vault_materials == 35.0  # vault down 25
    assert ada.current_materials == 35.0  # personal up 25 (conserved: same 25 moved)
    assert event_bus.get_events("wanderer_001") == []  # withdrawal is silent
    assert result.startswith("You draw")


async def test_withdraw_from_home_cannot_withdraw_more_than_vault(
    world: WorldState, event_bus: EventBus
) -> None:
    """Requesting more than the vault holds is Invalid and mutates nothing (no mint)."""
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 30.0)
    ada.current_materials = 10.0

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 50.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 30.0  # untouched
    assert ada.current_materials == 10.0  # nothing minted to personal


async def test_withdraw_from_home_not_at_home_region_is_invalid(
    world: WorldState, event_bus: EventBus
) -> None:
    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    assert world.move_agent("wanderer_001", "beta") is True  # walk away

    result = await withdraw_from_home(world, event_bus, "wanderer_001", 10.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Invalid:")
    assert home.vault_materials == 40.0  # nothing moved


async def test_withdraw_from_home_non_stakeholder_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 40.0)
    boris = world.get_agent("wanderer_002")  # co-located, not a stakeholder
    assert boris is not None
    boris.current_materials = 5.0

    result = await withdraw_from_home(world, event_bus, "wanderer_002", 10.0)

    home = world.get_home("home_ada")
    assert home is not None
    assert result.startswith("Error:")
    assert home.vault_materials == 40.0 and boris.current_materials == 5.0


async def test_withdraw_from_home_unknown_agent_is_error(
    world: WorldState, event_bus: EventBus
) -> None:
    result = await withdraw_from_home(world, event_bus, "ghost", 10.0)
    assert result.startswith("Error:")


async def test_deposit_then_withdraw_conserves_total_materials_and_energy(
    world: WorldState, event_bus: EventBus
) -> None:
    """The single most valuable test: vault ops MOVE materials, never mint; energy is untouched.

    Totals are summed across agents + regions + home vaults. A deposit then a withdrawal
    leaves both the world's total materials AND its total energy exactly where they started
    (region regen is not run here, so the sums are strictly invariant).
    """

    def total_materials(w: WorldState) -> float:
        return (
            sum(a.current_materials for a in w.get_all_agents())
            + sum(r.current_materials for r in w.get_all_regions())
            + sum(h.vault_materials for h in w.get_all_homes())
        )

    def total_energy(w: WorldState) -> float:
        return sum(a.current_energy for a in w.get_all_agents()) + sum(
            r.current_energy for r in w.get_all_regions()
        )

    ada = world.get_agent("wanderer_001")
    assert ada is not None
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    ada.current_materials = 100.0
    materials_before = total_materials(world)
    energy_before = total_energy(world)

    await deposit_to_home(world, event_bus, "wanderer_001", 40.0)
    await withdraw_from_home(world, event_bus, "wanderer_001", 15.0)

    assert total_materials(world) == pytest.approx(materials_before)  # nothing minted/lost
    assert total_energy(world) == pytest.approx(energy_before)  # vault is materials-only
```

Ensure `import pytest` is present at the top of `tests/tools/homes_test.py` (add it if not already there).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/homes_test.py -k "withdraw or conserves_total" -v`
Expected: FAIL — `withdraw_from_home` does not exist (`ImportError`).

- [ ] **Step 3: Implement the tool and register it**

In `tools/builtin/homes.py`, add the tool (after `deposit_to_home`):

```python
async def withdraw_from_home(
    world: WorldState, event_bus: EventBus, agent_id: str, amount: float
) -> str:
    """Draw materials from the being's home vault back into its personal stock.

    A stakeholder standing where its home stands moves ``amount`` materials from the home's
    vault into its own holding. Conserved (spec §12): the materials are deducted from the vault
    FIRST, then credited to the being — the same amount moved, nothing minted. You cannot draw
    out more than the vault holds. The vault is materials-only; energy is untouched.

    Mutates world state:
        * Deducts ``amount`` from the home's vault
          (:meth:`~world.world.WorldState.withdraw_from_home_vault`), then adds it to the being's
          materials (:meth:`~world.world.WorldState.modify_agent_materials`).

    Emits events:
        * None. A withdrawal only lowers the vault, so it can never cross into a hoard; per-op
          withdrawals are silent (the balance is surfaced via the vault column and
          ``look_around``).

    Args:
        world: The live world state.
        event_bus: Unused; present for the uniform tool signature.
        agent_id: Id of the withdrawing being.
        amount: Materials to move from the vault into personal stock.

    Returns:
        A success sentence with the new balances; an ``"Error: "`` string if the being is
        unknown or belongs to no home; an ``"Invalid: "`` string if the amount is not a
        positive number, the being is fallen, it is not where its home stands, or the vault
        holds fewer than that many materials (rejected calls mutate nothing).
    """
    quantity = _coerce_positive_amount(amount)
    if isinstance(quantity, str):
        return quantity
    agent = world.get_agent(agent_id)
    if agent is None:
        return f"Error: Cannot find Agent {agent_id} in the world."
    if agent.status is not AgentStatus.ALIVE:
        return (
            "Invalid: You are fallen and cannot tend a home's store; "
            "only another being can restore you."
        )
    home = world.stakeholder_home_of(agent_id)
    if home is None:
        return "Error: You have no home here to draw materials from."
    if home.region != agent.current_position:
        return "Invalid: You are not where your home stands; you can draw from its store only there."
    if quantity > home.vault_materials:
        return (
            f"Invalid: Your home's store holds only {home.vault_materials} materials; "
            f"you cannot draw {quantity}."
        )

    world.withdraw_from_home_vault(home.home_id, quantity)  # deduct the source FIRST (conservation)
    world.modify_agent_materials(agent_id, quantity)  # THEN credit personal stock
    return (
        f"You draw {quantity} materials from your home's store. It now holds "
        f"{home.vault_materials} materials; you hold {agent.current_materials}."
    )
```

In `tools/builtin/__init__.py`, import and register `withdraw_from_home` (add to the `from tools.builtin.homes import ...` block, to `__all__`, and to `BUILTIN_TOOLS`):

```python
from tools.builtin.homes import (
    build_home,
    deposit_to_home,
    leave_home,
    pledge_home,
    use_hearth,
    withdraw_from_home,
)
```

```python
    "deposit_to_home": deposit_to_home,
    "withdraw_from_home": withdraw_from_home,
```

(and add `"withdraw_from_home",` to `__all__` in alphabetical position).

In `agents/tool_schemas.py`, add the schema to `TOOL_SCHEMAS` (after `deposit_to_home`):

```python
    "withdraw_from_home": {
        "type": "function",
        "function": {
            "name": "withdraw_from_home",
            "description": (
                "Draw some materials back out of the shared store of the home you share, "
                "where you stand, into your own holding. You cannot draw out more than the "
                "home's store holds."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "amount": {
                        "type": "number",
                        "description": "How many materials to draw out of the home's store.",
                    },
                },
                "required": ["amount"],
            },
        },
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/homes_test.py tests/agents/tool_schemas_test.py -v`
Expected: PASS — withdrawal + conservation tests pass; the parity test stays green (both maps gained `withdraw_from_home`).

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/homes.py tools/builtin/__init__.py agents/tool_schemas.py tests/tools/homes_test.py
git commit -m "feat(tools): withdraw_from_home + vault conservation property test (L2b)"
```

---

## Task 5: `WORLD_MECHANICS` vault clause (DD9)

Teach the being, in-world, that the home it shares can hold a common store it may bank into and draw back out, and that a home heavy with a great store is noticeable. Physics/consequence only — no goals, strategy, or simulation language.

**Files:**
- Modify: `agents/prompt.py` (extend `WORLD_MECHANICS`)
- Test: `tests/agents/prompt_test.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WORLD_MECHANICS` gains one bullet, inserted after the shared-home bullet and before the "speak" bullet.

- [ ] **Step 1: Write the failing test**

Append to `tests/agents/prompt_test.py`:

```python
def test_world_mechanics_describes_the_home_vault() -> None:
    """L2b physics (DD9): a shared home can hold a store you bank into and draw back out.

    A home heavy with a great store is noticeable (the no-laundering / raid-target signal),
    stated as physics, not goals or strategy.
    """
    from agents.prompt import WORLD_MECHANICS

    lowered = WORLD_MECHANICS.lower()
    assert "store" in lowered  # a home can hold a common store
    assert "draw" in lowered  # you may draw materials back out
    assert "notice" in lowered  # a heavy store draws notice (perceivable, no laundering)
    # DD9 still holds: no goals / strategy / simulation language slipped in.
    for banned in FORBIDDEN_TERMS:
        assert banned not in lowered
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pytest tests/agents/prompt_test.py::test_world_mechanics_describes_the_home_vault -v`
Expected: FAIL — `WORLD_MECHANICS` has no "store"/"draw"/"notice" clause.

- [ ] **Step 3: Implement the prose**

In `agents/prompt.py`, insert a bullet into `WORLD_MECHANICS` immediately **after** the shared-home bullet (`"...a little less than the last.\n"`) and **before** the "speak" bullet (`"- You can speak to those in your place..."`):

```python
        "- A home you share can hold a common store of materials: where you stand, you may "
        "set some of your own into its keeping, and draw them back out again at need. A home "
        "grown heavy with a great store is a thing others notice.\n"
```

(Verify no `FORBIDDEN_TERMS` and no `"you should"` appear in the added line — "store", "keeping", "draw", "need", "heavy", "great store", "notice" are all clear.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/agents/prompt_test.py -v`
Expected: PASS — the new test passes and every existing DD9/`FORBIDDEN_TERMS` test stays green.

- [ ] **Step 5: Commit**

```bash
git add agents/prompt.py tests/agents/prompt_test.py
git commit -m "feat(prompt): DD9 world-mechanics clause for the home vault (L2b)"
```

---

## Task 6: `look_around` shows a co-located being its own home's vault

Perception for the depositor: when a being stands where its home stands, `look_around` shows that home's vault balance so it can manage its store. (Others perceive a heavy vault via the world-table and the `home_started_hoarding` event; a co-located being's own store is shown here.)

**Files:**
- Modify: `tools/builtin/movement.py` (`look_around`)
- Test: `tests/tools/movement_test.py`

**Interfaces:**
- Consumes: `WorldState.stakeholder_home_of` (existing).
- Produces: `look_around`'s returned dashboard gains a "Your home here| ..." line when the being holds a stake in a home in its current region.

- [ ] **Step 1: Write the failing tests**

Append to `tests/tools/movement_test.py` (add `from core.constants import HOME_MAX_INTEGRITY` to its imports):

```python
async def test_look_around_shows_own_home_vault_when_co_located(
    world: WorldState, event_bus: EventBus
) -> None:
    """A stakeholder standing at its home sees its vault balance in look_around."""
    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 120.0)

    result = await look_around(world, event_bus, "wanderer_001")

    assert "store" in result.lower()  # the home-store line is present
    assert "120.0" in result  # the vault balance is visible to the being


async def test_look_around_without_a_co_located_home_shows_no_vault_line(
    world: WorldState, event_bus: EventBus
) -> None:
    """A being that stakes no home in its region gets no home-store line."""
    result = await look_around(world, event_bus, "wanderer_002")
    assert "your home here" not in result.lower()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/tools/movement_test.py -k look_around_shows_own_home_vault -v`
Expected: FAIL — `look_around` shows no vault line.

- [ ] **Step 3: Implement the vault line**

In `tools/builtin/movement.py`, `look_around` — before the `return`, compute the home line, and add it to the returned f-string. Full updated tail of the function:

```python
    others = "; ".join(
        describe_agent_brief(agent) for agent in agents_nearby if agent.id != agent_id
    )
    # Show the being its OWN home's vault when it stands where that home stands (L2b): the
    # depositor perceives its store here; others perceive a heavy vault via the world-table
    # and the home_started_hoarding announcement.
    home = world.stakeholder_home_of(agent_id)
    home_line = ""
    if home is not None and home.region == agent_state.current_position:
        home_line = f"Your home here| its store holds {home.vault_materials} materials\n"
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
    )
```

Update the `look_around` docstring's "Returns:" to note it also reports a co-located being its own home's vault.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/tools/movement_test.py -v`
Expected: PASS (existing `look_around` tests still green — the extra line only appears when the being stakes a co-located home).

- [ ] **Step 5: Commit**

```bash
git add tools/builtin/movement.py tests/tools/movement_test.py
git commit -m "feat(tools): look_around shows a co-located being its home's vault (L2b)"
```

---

## Task 7: Activity feed — `home_started_hoarding` verb + world-table Vault column

Observer-facing perception: the feed learns a fallback verb for `home_started_hoarding`, and the world-table's homes section gains a **Vault** column so a run can be watched for banking + hoarding.

**Files:**
- Modify: `observability/activity_feed.py` (`_EVENT_VERBS`; `render_world_table` homes section)
- Test: `tests/observability/activity_feed_test.py`

**Interfaces:**
- Consumes: `Home.vault_materials` (existing after Task 1).
- Produces:
  - `_EVENT_VERBS["home_started_hoarding"]` fallback template.
  - `render_world_table` homes table gains a "Vault" column showing `f"{home.vault_materials:.1f}"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/observability/activity_feed_test.py`:

```python
def test_render_event_home_started_hoarding_is_human_readable() -> None:
    """A message-less home_started_hoarding falls back to a distinct verb (not the raw type)."""
    event = Event("home_started_hoarding", "home_ada", {}, scope=ScopeType.LOCAL)
    assert "great store" in render_event(event).lower()


def test_render_world_table_shows_vault_column(world: WorldState) -> None:
    """The homes section surfaces each home's vault balance (observer-facing)."""
    from rich.console import Console

    world.build_home(
        "home_ada", "wanderer_001", "alpha", built_at=world.now(), integrity=HOME_MAX_INTEGRITY
    )
    world.deposit_to_home_vault("home_ada", 120.0)
    table = render_world_table(world)
    text = "".join(seg.text for seg in Console(width=200).render(table))

    assert "Vault" in text  # the new column header
    home_rows = [line for line in text.splitlines() if "home_ada" in line]
    assert len(home_rows) == 1
    assert "120.0" in home_rows[0]  # the vault balance appears IN the home's row
```

Extend the existing zero-homes test (`test_render_world_table_homes_section_renders_cleanly_with_zero_homes`) to also assert the new header renders with no rows — add:

```python
    assert "Vault" in text  # new column header still present with zero homes
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pytest tests/observability/activity_feed_test.py -k "vault or home_started_hoarding" -v`
Expected: FAIL — no `home_started_hoarding` verb; no "Vault" column.

- [ ] **Step 3: Implement the verb and the column**

In `observability/activity_feed.py`, add to `_EVENT_VERBS` (near the other `home_*`/hoarding entries):

```python
    "agent_started_hoarding": "started hoarding",
    "home_started_hoarding": "began to hold a great store",
```

In `render_world_table`, add the "Vault" column to `homes_table` (after "Health") and pass the cell in `add_row`:

```python
    homes_table.add_column("Home")
    homes_table.add_column("Owner")
    homes_table.add_column("Region")
    homes_table.add_column("Stakeholders", justify="right")
    homes_table.add_column("Health", justify="right")
    homes_table.add_column("Vault", justify="right")
    for home in world.get_all_homes():
        cap = max_integrity(len(home.stakeholders))
        homes_table.add_row(
            home.home_id,
            home.owner_id,
            home.region,
            str(len(home.stakeholders)),
            f"{home.integrity:.1f}/{cap:.1f}",
            f"{home.vault_materials:.1f}",
        )
```

Update the `render_world_table` docstring's homes-tuple to `(id/owner/region/stakeholders/health/vault)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pytest tests/observability/activity_feed_test.py -v`
Expected: PASS (existing homes/table tests still green — added a column, existing substring assertions hold).

- [ ] **Step 5: Commit**

```bash
git add observability/activity_feed.py tests/observability/activity_feed_test.py
git commit -m "feat(observability): home vault column + home_started_hoarding verb (L2b)"
```

---

## Final verification (run before declaring 2b done)

Run the exact CI gate and read the output (evidence before assertions):

```bash
ruff check .
ruff format --check .
mypy core tests world bus tools config agents observability
pytest --cov=world --cov=bus --cov=tools --cov=config --cov=core --cov=agents --cov=observability --cov-report=term-missing --cov-fail-under=90
```

All four must pass green. Then merge autonomously on green (per the standing merge policy) and self-wake to slice **2c — break-in + thieve + colonize + ruins** (the next §12 sub-slice), which introduces `break_in`, incremental time-based repair/decay, `breachers`, breach → thieve(split)/colonize, and ruins (state + `scavenge_ruins`), and extends the conservation property test with the ruins remnant pool.

## 2b done-condition checklist (spec §12, fork 3)

- [ ] `Home.vault_materials: float = 0.0` (materials-only; no energy vault).
- [ ] `WorldState.deposit_to_home_vault` / `withdraw_from_home_vault` (sync, event-free; floor at 0; withdraw capped at balance).
- [ ] `home_is_hoarding(home) = vault_materials >= HOARDING_MATERIALS_THRESHOLD` (reuses the existing dial).
- [ ] `deposit_to_home` — personal → vault (deduct-personal-first), `home_started_hoarding` LOCAL on the crossing (once; not again while hoarding); otherwise silent.
- [ ] `withdraw_from_home` — vault → personal (deduct-vault-first, capped at the vault); fully silent.
- [ ] Both tools: `use_hearth`-style guards (exists/ALIVE/stakeholder-home/region); NL Error/Invalid/success; registered in BOTH `BUILTIN_TOOLS` + `TOOL_SCHEMAS`; DD9 schema prose.
- [ ] Conservation: nothing minted; energy untouched; deduct-source-first — with a multi-pool conservation property test.
- [ ] `WORLD_MECHANICS` DD9 vault clause (store / bank-in / draw-out / noticeable).
- [ ] Visibility: `look_around` shows a co-located being its own home's vault; world-table **Vault** column; feed verb for `home_started_hoarding`.
- [ ] Green CI (ruff + format + mypy + pytest cov ≥ 90).
