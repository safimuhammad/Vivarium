# Layer 1 — Aging + the Private Hearth-Home (Design)

**Date:** 2026-07-01
**Status:** Proposed — carved from the overall design; technical decisions flagged for the reviewer.
**Parent:** `docs/superpowers/specs/2026-07-01-materials-home-overall-design.md`

L1 is the smallest honest slice that makes **materials load-bearing** and lets us *watch*
whether the deplete→home→refuel loop forms, before adding any social/contest complexity.
**In scope:** idle-aging; a private home; a hearth (materials→energy); materials upkeep; decay;
visibility (prompt + live feed). **Out of scope (→ L2):** shared ownership, health, storage vault,
break-in/colonize, ruins.

---

## 1. Aging (idle costs energy)

- A breath is **idle** when its decision made **no tool call** (self-talk or silent rest).
- On an idle breath, deduct a small fixed energy amount from the being (`IDLE_AGING_ENERGY_COST`).
  An **active** breath (any tool call) deducts nothing extra — it already paid the action's cost.
- Never drives energy below 0 (floor, like existing mutations); a being aged to the paralysis
  threshold falls, exactly as with any other depletion (recoverable only by a friend — unchanged).
- **Reuses** the self-talk emission point: the runtime already distinguishes text-only/rest breaths
  from tool breaths (self-talk feature, 2026-06-30). Aging hooks the same branch.

## 2. The private home

### Build
- A new tool `build_home` (no params): if the being does not already own a home and holds
  ≥ `HOME_BUILD_MATERIALS_COST` materials, deduct that materials and create a `Home` owned by the
  being in its **current region**. Returns a natural-language result; emits `home_built` (LOCAL).
- One home per being in L1. Building where you already own a home is `Invalid:`.

### Hearth (recover: materials → energy)  *(key technical decision — see §7)*
- Recovering at home is an **active, elected act** (a tool), NOT passive rest — because passive
  rest is *idle* and therefore ages you. Proposed tool `use_hearth` (or `kindle`): if the being is
  in the region of a home it owns, convert up to `HEARTH_MATERIALS_PER_USE` materials into
  `HEARTH_ENERGY_PER_USE` energy (a fixed conversion, **no minting** — materials are consumed).
  Emits `hearth_used` (LOCAL). Only an ALIVE being can elect it (paralysis stays social).

### Upkeep (materials, on the world-tick)
- Each world-tick, every home draws `HOME_UPKEEP_MATERIALS_PER_TICK` from its **owner's** materials
  (materials is a global per-agent stock, so an absent owner still pays from stockpile — no
  death-spiral). If the owner has enough, integrity is maintained; if not, decay advances (§decay).
- **Cadence must derive from the breath regime** (fast on Gemini, slow on Ollama) — do not let a
  home decay faster than its owner can breathe to refuel it (the mating-timeout 60s→600s lesson).

### Decay (simple loss in L1)
- A home has an `integrity` float. Unpaid upkeep decrements it by `HOME_DECAY_PER_MISSED_TICK`;
  a paid tick holds/refills it (cap at a max). At `integrity ≤ 0` the home **collapses**: removed
  from the world; emits `home_collapsed` (LOCAL). No ruins/scavenge in L1 (→ L2).

## 3. Data model

- New `Home` dataclass (in `world/`): `owner_id: str`, `region: str`, `integrity: float`,
  `built_at: float`. (Forward-compatible: L2 adds stakeholders, health-from-stakeholders, vault.)
- `WorldState` holds homes (e.g. `homes: dict[str, Home]` keyed by owner_id in L1) with mutation
  methods: `build_home`, `remove_home`, `modify_home_integrity`, and a lookup `home_of(agent_id)` /
  `home_in_region(region)`. All sync, in-place (domain pattern §3). Looting/death: if an owner dies,
  L1 leaves the home to decay normally (ownership-on-death handled in L2) — confirm with reviewer.

## 4. Constants (centralize in `core/constants.py`; all tunable dials)

`IDLE_AGING_ENERGY_COST`, `HOME_BUILD_MATERIALS_COST` (bias high → homes rare, competes with
mating), `HEARTH_MATERIALS_PER_USE`, `HEARTH_ENERGY_PER_USE` (output ≤ a sustainable rate),
`HOME_UPKEEP_MATERIALS_PER_TICK`, `HOME_DECAY_PER_MISSED_TICK`, `HOME_MAX_INTEGRITY`.
Stability: hearth energy-per-materials + upkeep must net so a home is a *scarcity response*, not a
strictly-dominant fountain; build cost competes with `MATING_MIN_MATERIALS_CONTRIBUTION`.

## 5. Events & visibility

- Events (LOCAL, so co-located beings perceive): `home_built`, `hearth_used`, `home_collapsed`.
  Aging is a silent per-breath energy tick (no event spam) — surfaced via the being's energy in
  the world-table, not an event.
- **Agent-facing (`WORLD_MECHANICS`, DD9):** add, in-world physics-not-goals prose — idling slowly
  wears you down; you can raise a home where you stand (it costs materials), rest at its hearth to
  turn materials into energy, and it must be kept fed with materials or it crumbles.
- **Observer-facing (the live dashboard = the rich activity feed + world-table):** feed renders
  `home_built` / `hearth_used` / `home_collapsed` distinctly; the world-table shows who owns a home
  and its integrity, and energy makes aging visible. (The isometric map is a separate UI track;
  it renders these same events once it's the live app.)

## 6. Testing (TDD; deterministic — mock decider, seeded RNG, frozen clock)

- Aging: an idle (no-tool) breath deducts `IDLE_AGING_ENERGY_COST`; a tool breath deducts none
  extra; energy floors at 0; aging into paralysis behaves like any depletion.
- Build: success (materials deducted, home created, event emitted); insufficient materials → error,
  no mutation; already-own-a-home → invalid.
- Hearth: converts materials→energy at the fixed rate when at own home; not at home → error;
  paralysed → invalid; **conservation** (energy gained ≤ materials spent × rate; no net-new energy).
- Upkeep/decay on world-tick: paid tick holds integrity; missed tick decrements; collapse at ≤0
  emits `home_collapsed` and removes the home; upkeep draws from owner materials even when absent.
- Every WorldState mutation: success + each failure path. ≥90% coverage on core.

## 7. Open technical decisions (resolve with the Opus reviewer before planning)

1. **Hearth as an active tool vs. auto-on-rest-at-home.** Proposed: an explicit `use_hearth` tool
   (active → doesn't age that breath, converts materials→energy). Confirm this is cleaner than
   special-casing passive rest at home (which would collide with idle-aging).
2. **Homes keyed by owner (one per being) vs. by region/id.** L1 assumes one home per being; confirm
   this is forward-compatible with L2 shared ownership without a painful migration.
3. **Upkeep source & cadence.** Draw from owner's materials each world-tick; derive the effective
   cadence from the breath regime. Confirm the exact tick handling + how "insufficient materials"
   advances decay.
4. **Ownership on death in L1.** Proposed: leave the dead owner's home to decay normally (full
   ownership-on-death is L2). Confirm this doesn't create a ghost/exploit in the interim.
5. **Where aging hooks the breath loop** to reuse the self-talk idle-detection cleanly, without
   double-counting or affecting reflection breaths.

## 8. Reviewer resolutions (Opus tech review, 2026-07-01) — these govern the plan

**Verdict: sound to plan, with the changes below. No conservation holes** (hearth converts, never
mints) provided materials are deducted *before* energy is credited.

**Decisions (resolved):**
1. **Hearth = an active `use_hearth` tool** (not passive rest). Recipe: require `home_of(agent)`
   exists and `home.region == agent.current_position`; `m = min(materials, HEARTH_MATERIALS_PER_USE)`;
   `modify_agent_materials(-m)` **then** `modify_agent_energy(+m * rate)` — bounded by materials
   destroyed. Add a defensive not-ALIVE guard (`execute()` already blocks non-ALIVE tools, keeping
   paralysis social).
2. **Key homes by a stable `home_id`**, `owner_id` as a mutable field (L2 colonize = one field
   write; owner-keying would force painful re-keys). Homes are rare → linear-scan lookups are free.
3. **Upkeep = time-based accrual from the owner's global materials stock**, on the world-tick:
   store `last_upkeep_at`; `owed = HOME_UPKEEP_MATERIALS_PER_SECOND * (now - last_upkeep_at)`. This
   is tick-frequency-*independent* (generalizes the mating 60s→600s lesson) and drawn from stock so
   an absent/slow owner still pays — no death-spiral. Decay advances **only when the owner cannot
   pay** (broke, dead, or swept). Size integrity/decay so collapse-when-broke ≫ slowest breath gap.
4. **Dead/missing owner = cannot-pay → decay → collapse** (confirmed safe: hearth is owner-elected
   so a dead-owner home is inert; combat already loots the owner broke; `modify_agent_materials`
   no-ops for DEAD/missing and returns `False`, so the tick must not assume payment succeeded).
   Explicit tests for dead-owner and swept-owner.
5. **Aging hook** in `breathe()` **right after `_emit_self_talk`, before the reflect gate**, keyed
   on `not decision.tool_calls` (covers self-talk *and* silent rest; reuses the idle signal, not the
   method): `if not decision.tool_calls: self.world.modify_agent_energy(self.agent_id, -IDLE_AGING_ENERGY_COST)`.
   Guards satisfied by placement: ALIVE-only branch; real-decision (`else`) block; mutually exclusive
   with `execute()` work; reflection is a sub-step so never aged; paralysis announced by the
   following `refresh_status`.

**Required changes vs §1–7 above:** key by `home_id` (not owner); time-based upkeep w/ `last_upkeep_at`;
tick treats dead/missing owner as cannot-pay; **all `Home`/`WorldState` mutations are sync &
event-free — the `tick()` orchestrates upkeep/decay and publishes `home_collapsed`** (WorldState has
no bus, same as corpse-decay).

**Known limitation to OBSERVE, not over-tune (important):** aging only bites *literal idle* breaths.
`harvest_resources` and `look_around` cost **no energy** and are tool calls → *active* → never aged.
So an agent can harvest/look forever without aging; aging's real job is only to make self-talk/rest
cost something (consistent with "active = using tools"). Do **not** crank `IDLE_AGING_ENERGY_COST`
to force dynamism — it can't. The hearth's value is *contingent on energy scarcity emerging*
(crowding/local depletion); in an easy world, free harvest dominates and homes may rarely be built —
an acceptable thing to *watch*, per the observe-don't-design ethos.

**Build order:** **aging first** (stands alone, simplest, provides the pressure), then the home.

**Implementation skeleton (the plan must cover):**
- `Home` dataclass (`world/`, `slots=True`, mutable): `home_id, owner_id, region, integrity, built_at, last_upkeep_at`.
- `WorldState` (sync, event-free): `homes: dict[str, Home]` by `home_id`; `build_home`, `remove_home`,
  `modify_home_integrity` (clamp `[0, HOME_MAX_INTEGRITY]`), `home_of(agent_id)`, `home_in_region(region)`, `get_all_homes()`.
- `tick()`: third sweep (after corpse-decay) — accrue upkeep from owner stock, advance decay on
  cannot-pay, collapse at `integrity ≤ 0` (`remove_home` + publish `home_collapsed`), snapshot-then-mutate + deferred-publish like corpse-decay.
- Tools `build_home` (no params) + `use_hearth` — in **both** `BUILTIN_TOOLS` and `TOOL_SCHEMAS`
  (parity test); NL `Error:`/`Invalid:`/success returns.
- Events (LOCAL): `home_built`, `hearth_used`, `home_collapsed` + verbs in `_EVENT_VERBS`. Aging stays silent.
- `WORLD_MECHANICS` prose (DD9): idling wears you down; build a home; rest at the hearth to turn
  materials into energy; feed it materials or it crumbles.
- `render_world_table` gains a homes section (owner + integrity) — observer-facing hard requirement.
- Constants: `IDLE_AGING_ENERGY_COST`, `HOME_BUILD_MATERIALS_COST` (≳ `MATING_MIN_MATERIALS_CONTRIBUTION=30`),
  `HEARTH_MATERIALS_PER_USE`, `HEARTH_ENERGY_PER_USE`/rate, `HOME_UPKEEP_MATERIALS_PER_SECOND`,
  `HOME_DECAY_PER_MISSED_TICK`, `HOME_MAX_INTEGRITY`.
- Tests (beyond §6): tool-breath-does-not-age; aged-into-paralysis emits `agent_paralyzed`;
  dead-owner & swept-owner decay→collapse; hearth partial-burn + exact conservation; tick-frequency
  independence; collapse fires once; `build_home` recomputes `is_hoarding` correctly.
