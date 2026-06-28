# Spec — Production Foundation (Vivarium)

> **Date:** 2026-06-27 · **Status:** Approved (build via Approach A, TDD)
> **Author:** Safi (vision) + Claude (design/build)
> **Standards source:** `CLAUDE.md` (this spec defers to it for all code/test standards)

---

## 1. Context & goal

Vivarium is a never-ending generative art piece (Game-of-Life lineage); the first
goal is a **self-sustaining, god-less world** that runs forever. Before building the
agent runtime (Sprint 4) on top of it, we are raising the existing infra
(`world/`, `bus/`, `tools/`, `config/`) from prototype quality to **production
quality** and locking its correctness under an automated test suite.

The infra works today but was written at the old "simple solo-coding" bar: no tests,
no docstrings, no validation, `print`-and-swallow error handling, loose typing,
scattered constants. This pass fixes all of that **without changing observable
behavior** (except where the new behavior is explicitly specified below).

This is the **first orchestrated component**. It establishes the rails (test +
lint + type + CI) that every later component depends on.

## 2. Approach — A: Characterize → Refactor → Enforce

Refactoring working-but-untested code risks silently breaking correct behavior, so
order matters:

1. Stand up tooling so checks can run.
2. **Write tests first** — pin current correct behavior (characterization) AND encode
   the new production-bar behavior (typed exceptions, config validation, determinism).
3. **Refactor each module** until the suite is green and `mypy --strict` is clean.
4. **Enforce** going forward with pre-commit + GitHub Actions CI.

Per-module, subagents follow strict TDD: write the failing tests, then write/refactor
the code until those tests pass. Characterization tests are green immediately;
new-bar tests start red and drive the refactor.

## 3. Scope

**In scope:** `world/`, `bus/`, `tools/` (registry + all builtin), `config/`; new
cross-cutting `core/` package; full test suite; tooling (`pyproject.toml`, ruff,
mypy, pytest, coverage, pre-commit, CI).

**Out of scope (YAGNI — do NOT build):** agent runtime logic (`agents/runtime.py`,
Sprint 4); memory service; orchestrator/council (deferred per vision); dashboard;
economy/homeostasis tuning; any repo restructure toward the design-doc target layout
beyond adding `core/` and the `tests/` package.

## 4. Design decisions (settled)

| Decision | Choice |
|----------|--------|
| Data modeling | Domain state (`WorldState`, `AgentState`, `Region`, `Event`) stays **stdlib dataclasses**, mutable, `slots=True`. Not frozen (hot path). |
| Validation | **Pydantic v2 at the config boundary ONLY** — validate `world.yaml`, then convert validated config → domain dataclasses. No Pydantic in the hot path. |
| Determinism seam | Introduce an injectable, seedable RNG + clock now. `WorldState` holds `rng: random.Random` and `clock: Callable[[], float]` (defaults: unseeded `Random()`, `time.time`) and exposes `now() -> float`. All randomness (mating naming/Faker, any choices) and all `Event` timestamps flow through these. Loader accepts an optional `seed`. |
| Error handling | Two layers. **Agent-facing** (tool *logic* results): natural-language strings, standardized prefixes — success = plain sentence; lookup/precondition failure = `"Error: …"`; rule violation = `"Invalid: …"`. **Infrastructure** (registry/bus/loader): raise typed exceptions + log; never `print`-and-swallow. |
| Exceptions | `core/exceptions.py`: `VivariumError(Exception)` base; `WorldStateError`, `EventBusError`, `ToolError`, `ConfigError`. |
| Constants | `core/constants.py`: all world-rule numbers from `autonomous-agent-world-design.md` §"World Rules" (action/move/speak/attack costs, attack damage, kill/paralysis thresholds, mating minimums/cooldown/max-offspring/child-share, hoarding thresholds). Tools import from here; remove local definitions (e.g. `ATTACK_ENERGY` in `combat.py`). |
| Logging | `core/logging.py` with `configure_logging()` + `get_logger(__name__)` (stdlib `logging`). Library modules log via module loggers. `rich` reserved for the future activity-feed renderer — not library logging. |
| Test naming | Keep `*_test.py` (configure pytest `python_files = *_test.py`). |
| Coverage | ≥90% line coverage on `world/`, `bus/`, `tools/`, `config/`, `core/`. CI fails below threshold. |
| CI | GitHub Actions (`.github/workflows/ci.yml`): ruff check + ruff format --check + mypy + pytest(+cov, excluding integration). Python 3.13. |

## 5. Component design

### 5.1 `core/` (new package — shared contracts)
- `core/exceptions.py` — exception hierarchy above.
- `core/constants.py` — world-rule constants (single source).
- `core/logging.py` — logging configuration + `get_logger`.
- `core/rng.py` (or fold into a small `SimContext`) — helper to build a seeded
  `random.Random` and a clock; used by the loader/`WorldState`.

### 5.2 `world/`
- `regions.py` / `agents.py` — dataclasses gain `slots=True`, full type hints,
  Google docstrings, `| None` defaults (no bare `= None` on typed fields).
- `world.py` — full typing + docstrings on all methods (documenting what each mutates).
  Add `rng`/`clock`/`now()`. `regenerate_resources()` keeps current flat behavior but
  **must cap at `max_energy`/`max_materials`** (verify/lock current cap behavior under
  test). Infra-invalid operations may raise `WorldStateError` where appropriate, but
  query/mutation methods that return `bool` keep their current contract unless a test
  proves otherwise (characterize first).

### 5.3 `bus/`
- `events.py` — `Event` dataclass: full typing, `slots=True`, `scope`/`region`/`target`
  typed with `| None`; timestamp sourced from the injected clock (not module `time`)
  when created by tools.
- `event_bus.py` — typed; docstrings; `subscribe`/`publish`/`get_events` keep behavior;
  replace any silent failure with typed exception + log; routing (LOCAL region-scoped,
  GLOBAL all, TARGETED single) unchanged and fully tested.

### 5.4 `tools/`
- `registry.py` — **replace** `except Exception: print(...)` with: log via module
  logger and raise `ToolError` (wrapping the cause) for infrastructure failures;
  unknown tool name → `ToolError`. Tool *logic* failures still return result strings.
  Full typing (`Callable` signature for registered tools), docstrings.
- `builtin/*` — import constants from `core/constants`; standardize result-string
  prefixes; full typing + docstrings (each tool documents state mutated + events
  emitted); route randomness through `world.rng`. Preserve all current logic,
  especially **mating escrow math** (deduct → accept/reject → refund/spawn, child
  share) — characterize before touching.

### 5.5 `config/`
- Pydantic v2 schema models (`RegionConfig`, `AgentConfig`, `WorldConfig`) validating
  `world.yaml` with clear errors on malformed/missing fields and unknown enum values.
- `loader.py` — parse YAML → validate via schema → convert to domain dataclasses →
  build `WorldState` (passing optional `seed`). Raise `ConfigError` on failure.

## 6. Testing strategy

- `tests/` becomes a package mirroring source: `tests/world/`, `tests/bus/`,
  `tests/tools/`, `tests/config/`, `tests/core/`, plus `tests/integration/` for the
  existing live-Ollama prototypes (`breathing_test.py`, `ollama_latency_test.py`),
  marked `@pytest.mark.integration` and excluded from the default/CI run.
- `tests/conftest.py` — fixtures: fresh `WorldState` (seeded rng + fake clock),
  `EventBus`, `ToolRegistry`, a fake/fixed clock, a mock decider. **No unit test calls
  live Ollama or uses wall-clock/global random.**
- Coverage per module per `CLAUDE.md` §5: every `WorldState` mutation (success + each
  failure/edge); every tool (valid call, each precondition failure, correct event
  emitted on the bus, correct state delta); event routing isolation; mating escrow
  incl. refund; config validation success + each failure; determinism (same seed →
  same sequence).
- `pytest` config: `python_files = *_test.py`, `asyncio_mode = auto`,
  `addopts = -m "not integration"`, coverage on the core packages with `fail_under`.

## 7. Implementation plan (phased subagent orchestration)

Claude orchestrates; verifies at each gate before proceeding.

- **Phase 1 — Rails & shared contracts (1 agent, sequential).** `pyproject.toml`
  (deps split, tool configs), `core/` modules, `tests/` package + `conftest.py`
  fixtures, `.pre-commit-config.yaml`, `.github/workflows/ci.yml`. Move the two
  existing prototypes to `tests/integration/` and mark them.
  **Gate:** `ruff`, `mypy`, `pytest` all run (empty/collected); `core/` imports clean.
- **Phase 2 — `world/` TDD (1 agent, sequential — locks the interface).** Tests first
  (characterization + rng/clock + regen cap), then refactor `world/*` until green +
  mypy clean. **Gate:** Claude reviews the final `WorldState` interface (rng/clock,
  signatures) before fan-out.
- **Phase 3 — `bus/`, `tools/`, `config/` TDD (3 agents, parallel).** Each writes its
  tests first, then refactors only its own module + `tests/<pkg>/` until green. Agents
  must NOT edit `core/` or another module's files — if a shared change seems needed,
  report back. **Gate:** each module green + mypy clean.
- **Phase 4 — Integration & enforcement (Claude + 1 agent).** Run full suite + mypy +
  ruff repo-wide; fix cross-module fallout; confirm coverage gate and CI config.
  **Gate:** everything green; commit.

## 8. Risks & mitigations

- *Silently breaking working behavior* → characterization tests written/green before
  any refactor (Approach A).
- *Interface coupling (bus/tools/config depend on world)* → world refactored and its
  interface frozen in Phase 2 before the Phase 3 fan-out.
- *Parallel file conflicts* → Phase 3 modules touch disjoint files; agents restricted
  to their module + test dir; shared files owned by Phase 1.
- *Scope creep* → §3 out-of-scope list is explicit; agents told foundation-only.

## 9. Success criteria

- [ ] Full unit suite green; `mypy --strict` clean on `core/`, `world/`, `bus/`,
  `tools/`, `config/`; `ruff check` + `ruff format --check` clean.
- [ ] ≥90% coverage on core packages; CI passes on GitHub Actions.
- [ ] Observable behavior preserved (characterization tests green); new behavior
  (typed exceptions, config validation, seeded determinism) covered by tests.
- [ ] Same seed reproduces the same event sequence (determinism demonstrated by test).
- [ ] `regenerate_resources` behavior (incl. cap) locked under test.
- [ ] No `print` in library code; constants centralized in `core/constants.py`.
