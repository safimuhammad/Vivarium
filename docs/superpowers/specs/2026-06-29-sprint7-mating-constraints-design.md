# Sprint 7 — Mating constraints (the explosion guard) — design

> Status: drafted autonomously; reviewer-gated. This **enforces already-locked design-doc
> rules** (autonomous-agent-world-design.md §514-522) that the code centralised as constants
> but deliberately left unenforced. It introduces no new simulation *meaning*.

## 1. Problem & Goal

Sprint 7's spawn-watcher made reproduction real (offspring breathe), removing a collapse
vector. But mating is currently free of the doc's limits, so it opens the opposite failure —
**population explosion** (and, via the single serialized Ollama, quiet throughput collapse).
The design doc locks four mating rules; the tool enforces none of them (see the `mating.py`
module docstring, which flags this as deferred debt):

| Rule | Constant | Value |
|---|---|---|
| Min energy contribution | `MATING_MIN_ENERGY_CONTRIBUTION` | 50.0 |
| Min materials contribution | `MATING_MIN_MATERIALS_CONTRIBUTION` | 30.0 |
| Cooldown between matings | `MATING_COOLDOWN_SECONDS` | 300.0 |
| Max offspring per agent | `MATING_MAX_OFFSPRING` | 5 |

**Goal:** enforce these four rules so the world "neither collapses nor explodes" — making
mating costly (minimums), throttled (cooldown), and bounded (per-agent offspring cap), exactly
as the doc specifies. The doc's note "Max offspring per agent (prevents population explosion)"
confirms the per-agent cap is the intended explosion guard; there is no global population cap
to invent.

## 2. Scope

**In:**
- Enforce the **minimum contributions** in `initiate_mating` (both energy ≥ 50 *and* materials
  ≥ 30 must be committed). `accept_mating` forces the acceptor to match the proposal, so a
  proposal that meets the minimums guarantees both parents do.
- Enforce the **cooldown**: an agent that has mated within `MATING_COOLDOWN_SECONDS` cannot
  initiate or accept a new mating.
- Enforce the **per-agent offspring cap**: an agent that already has `MATING_MAX_OFFSPRING`
  offspring cannot initiate or accept a new mating.
- The per-agent state both rules need: two new `AgentState` fields, mutated only through new
  `WorldState` methods (the architecture's mutation rule).

**Out:**
- Global population cap (not a locked rule; the per-agent cap is the doc's explosion guard).
- LLM persona infusion for offspring; mating-child-share refactor (`MATING_CHILD_SHARE` vs
  `MATING_OFFSPRING_MULTIPLIER` already numerically equivalent) — separate, not this change.
- Tuning the constant *values* — that's F4. This change only enforces them.

## 3. Design

### 3.1 Per-agent state (`world/agents.py`)
Add two defaulted fields to `AgentState` (defaults keep every existing construction site —
config loader, conftest, offspring minting — working unchanged):

```python
last_mated_at: float | None = None   # world-clock time of this agent's last completed mating
offspring_count: int = 0             # offspring this agent has parented (caps at MATING_MAX_OFFSPRING)
```

`slots=True` is retained (defaulted fields are fine with slots).

### 3.2 WorldState mutators (`world/world.py`)
Per the architecture (all mutation flows through `WorldState` methods, never field pokes):

```python
def record_mating(self, agent_id: str, when: float) -> bool:
    """Stamp an agent's last-mating time and increment its offspring count.
    Returns True if the agent exists. Called for BOTH parents on a completed mating."""
```

A read helper keeps the cooldown logic in one place:

```python
def is_on_mating_cooldown(self, agent_id: str, now: float, cooldown: float) -> bool:
    """True if the agent mated less than `cooldown` seconds before `now`."""
```

(`offspring_count` is read directly off the agent for the cap check — no mutator needed for a read.)

### 3.3 Enforcement points (`tools/builtin/mating.py`)
All checks return the conventional agent-facing `"Invalid: ..."` string and mutate nothing.

`initiate_mating` (after the existing agent-lookup + `_clean_committed_resources`, before the
escrow deduction):
1. **Cooldown:** if `world.is_on_mating_cooldown(initiator, world.now(), MATING_COOLDOWN_SECONDS)`
   → `"Invalid: You mated too recently; you must wait before mating again."`
2. **Offspring cap:** if `initiator.offspring_count >= MATING_MAX_OFFSPRING`
   → `"Invalid: You have reached the maximum number of offspring."`
3. **Minimums:** committed energy < `MATING_MIN_ENERGY_CONTRIBUTION` or committed materials <
   `MATING_MIN_MATERIALS_CONTRIBUTION` (a missing type counts as 0) →
   `"Invalid: A mating proposal must commit at least 50 energy and 30 materials."`

`accept_mating` (after looking up the proposal + before consuming contributions): apply the
**same cooldown and offspring-cap checks to the acceptor**. The minimums are already guaranteed
(the acceptor matches a proposal that passed the minimums at initiate time).

On a **completed** mating (just before/after `world.add_agent(offspring)` in `accept_mating`):
`world.record_mating(initiator_id, now)` and `world.record_mating(acceptor_id, now)` — both
parents go on cooldown and have their offspring count incremented, with `now = world.now()`.

### 3.4 Interaction with existing behaviour
- **Escrow/refund unaffected:** checks happen before the initiator's deduction (initiate) or
  before consuming the acceptor's contribution (accept); a rejected call mutates nothing, so the
  two-phase escrow and the world-tick timeout-refund are untouched.
- **Offspring start clean:** a newborn's `last_mated_at=None`, `offspring_count=0` (defaults), so
  it can mate once it meets the rules — generations continue.
- **Reproducibility:** cooldown uses `world.now()` (the injected clock), so it is deterministic in
  tests (frozen clock) and replayable.

## 4. Components & files
- `world/agents.py`: two defaulted `AgentState` fields + docstring.
- `world/world.py`: `record_mating`, `is_on_mating_cooldown`.
- `tools/builtin/mating.py`: cooldown + cap + minimum checks in `initiate_mating`; cooldown + cap
  checks in `accept_mating`; `record_mating` for both parents on completion. Update the module
  docstring (these rules are now enforced, not deferred).
- Tests: `tests/world/world_test.py` (the two mutators), `tests/tools/mating_test.py` (each new
  rejection path + the happy path + cooldown/cap state transitions). **Existing mating tests that
  commit < the minimums (or only one resource type) must be updated to commit ≥50 energy and ≥30
  materials**, or they will now (correctly) be rejected.

## 5. Testing (TDD, deterministic, no live model)
- `record_mating` stamps time + increments count; missing agent → False.
- `is_on_mating_cooldown`: just-mated → True; after `now` advances past the cooldown → False;
  never-mated (`last_mated_at is None`) → False.
- `initiate_mating` rejects: below-energy-minimum, below-materials-minimum, missing-a-type;
  on cooldown; at offspring cap. Each asserts `"Invalid:"`, no escrow deduction, no event.
- `accept_mating` rejects an acceptor on cooldown / at cap (no consumption, no `agent_born`).
- Happy path: a proposal meeting all rules completes, spawns the offspring, AND stamps both
  parents (`offspring_count == 1`, `last_mated_at == world.now()`, both now on cooldown).
- A second immediate mating attempt by a just-mated parent is rejected by cooldown.

## 6. Gates (reproduce CI exactly before merge)
`ruff check .` · `ruff format --check .` ·
`mypy core tests world bus tools config agents observability` ·
`pytest --cov=... --cov-fail-under=90`. Then push, watch CI green, merge, confirm main green.

## 7. Risks
- **Breaking existing tests** that mate with sub-minimum contributions — expected; update them to
  realistic (≥minimum) commitments. This is the main implementation chore.
- **Cooldown/clock in tests:** must use the frozen `fake_clock` and advance it to exercise both
  sides of the cooldown boundary; never wall-clock.
- **Does enforcing minimums starve mating?** 50 energy + 30 materials is a real cost; combined
  with the spawn-watcher this is the intended balance (costly, throttled, capped). Whether the
  values are *right* is an F4 tuning question, explicitly out of scope here.
