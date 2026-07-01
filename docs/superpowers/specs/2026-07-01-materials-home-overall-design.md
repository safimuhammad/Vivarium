# Materials as Purpose — Aging, Hearths & Homes (Overall Design)

**Date:** 2026-07-01
**Status:** Approved (design locked with Safi; world-aware design review folded in)
**Scope:** The full multi-layer vision. Each layer gets its own carved-out spec + plan + build.

---

## 1. Problem & goal

The world has two resources, **energy** and **materials**. Energy is the sole driver — every
action (move, speak, attack, mate) costs it; 0 energy = paralysis. **Materials is nearly inert**:
its only sink is mating (a parent commits ≥30 materials, inherited by offspring, which then do
nothing with it), and hoarding is *flagged* at ≥300 but has no mechanical effect.

**Goal:** make materials a real, load-bearing part of the world's dynamics — not by adding a third
resource, but by giving the existing materials resource a genuine purpose: **homes** you build,
fuel, and (later) contest, plus **aging** that makes stagnation cost something.

## 2. Vision guardrails (non-negotiable — this is an art piece, not a game)

From `CLAUDE.md` §1 and the world-aware design review (2026-07-01):

- **Conservation — the home must NEVER mint energy.** Energy is a closed economy (it lives only in
  region pools, capped, ~0.6/tick regen, and moves via harvest/transfer/loot). A home that
  "regenerates energy" would be a materials→structure→infinite-energy converter → runaway
  *explosion* (a forbidden pole). Instead the home **converts stored materials → energy** (a
  hearth). Materials is the fuel; energy stays conserved.
- **No still-life.** Avoid mechanics that reward freezing in place (the *other* forbidden pole).
  Addressed by aging-when-idle (§4).
- **No death-spiral.** Upkeep is paid in **materials, not energy**, so an absent/wandering owner
  loses stockpile, not the ability to act.
- **Emergent, not scripted.** Any deaths come from a being failing to sustain itself, never a
  scripted purge (honours the no-scripted-population-control stance).
- **Visible incentives (DD9).** Every mechanic is described *in-world* in `WORLD_MECHANICS` — the
  physics and consequences, never goals/strategy/optimisation, never language revealing the sim.
  Beings can only *choose* to build if they're told building exists.
- **Perception is the product.** Homes and aging must be surfaced in the activity feed and the
  isometric UI — a mechanic no one can watch is Life with the screen off.

## 3. The two resources (reframed)

- **Energy** — life/action currency; conserved; harvested from the land; spent on actions and on
  idle-aging; recovered *only* by harvesting or by burning materials at a hearth.
- **Materials** — now the **substance of the home economy**: build cost + hearth fuel + upkeep +
  (L2) vault contents + raid loot. Still harvested, transferable, and looted on death.

## 4. Aging (the survival pressure) — Layer 1

A being's breath resolves as **act** (uses a tool), **self-talk**, or **silent rest** (the last two
were shipped 2026-06-30). Aging:

- **Idle breaths (self-talk or rest — no tool) drain a small fraction of energy.** Active breaths
  (tool use) do not — they already cost energy.
- Rationale: you can't sit frozen forever for free; stagnation slowly wears you down, so the world
  keeps moving on its own. This is the direct fix for the still-life risk homes would otherwise
  create.
- This is the **metabolism the self-talk spec explicitly deferred** ("resting is free… metabolism
  is a separate decision later") — now decided, deliberately, scoped to *idle* only.
- Gentle ("a fraction, not too much"); exact amount is a tuned dial.

## 5. The Home

### Layer 1 — the sustainable private home
- **Build:** spend materials to raise a home at the being's location (bias the cost high → homes are
  rare, precious, and compete with mating for the same scarce materials — a nest-vs-child tension).
- **Hearth (recover):** resting *inside your home* converts your **stored materials → energy** (no
  minting). This is the home's payoff and the answer to aging.
- **Upkeep:** the home consumes **materials** on a cadence; feed it or it decays.
- **Decay:** unpaid upkeep erodes the home; in L1 it simply collapses and is gone (ruins are L2).
- **Private only** in L1.

### Layer 2 — the contest layer (one interlocking system)
- **Shared ownership:** other beings pledge upkeep to buy in and share the hearth.
- **Health/integrity:** scales with stakeholders + upkeep — a communal home is a fortress, a lone
  shelter is soft. Use **diminishing returns / a size ceiling** so multiple contestable homes
  (territory) beat one invincible mega-commune (avoids the "one giant fortress" still-life).
- **Storage vault:** beings bank materials/energy in the home. Vault contents **count toward
  hoarding** (`is_hoarding`) and are perceivable — no laundering — and are contestable.
- **Break-in:** a coordinated group whose *combined* force exceeds the home's health can breach it,
  spending **energy + materials** to do so; then the raiders **choose**: **thieve** (loot the vault)
  or **colonize** (seize ownership). Tune breach cost so expected loot < coordinated breach cost
  (mirrors `ATTACK_ENERGY_COST` deliberately > per-hit value), or raiding becomes the dominant
  economy → war of extinction.
- **Ruins:** a decayed/breached home leaves ruins scavengeable for a *fraction* of the banked
  materials (conserved — scavenged ≤ banked, like combat loot).

## 6. Interaction guardrails (from the review)

- **Paralysis stays social.** Hearth recovery is the *elected* act of resting (only an ALIVE being
  can choose it) — a paralysed being still needs a friend's `transfer_resource`. The home never
  auto-revives.
- **Ownership on death (L2):** define how a slain owner's home behaves (heritable / claimable /
  ruins) so it meshes with the 120s corpse-decay window and doesn't become an immortal ghost.
- **Cadence discipline:** upkeep/decay run on the world-tick but must be derived from the *breath
  regime* (fast on concurrent Gemini, slow on sequential Ollama) — see the mating-timeout
  60s→600s cautionary tale — or homes decay between an owner's breaths through no fault of theirs.
- **No broad metabolism.** Aging is scoped to *idle* breaths only; we are NOT adding an always-on
  metabolism.

## 7. Dials (centralize in `core/constants.py`; tune from runs)

L1: `IDLE_AGING_ENERGY_COST` (small), `HOME_BUILD_MATERIALS_COST` (high → rare),
`HEARTH_MATERIALS_PER_ENERGY` (conversion rate), `HOME_UPKEEP_MATERIALS_PER_TICK`, `HOME_DECAY_*`.
L2: `HOME_HEALTH_PER_STAKEHOLDER` (diminishing), `BREAKIN_ENERGY_COST`, `BREAKIN_MATERIALS_COST`,
vault/ruins fractions.
**Stability relationship:** hearth energy output over time must not exceed sustainable materials
throughput (region regen), and build cost must compete with mating — else homes distort the economy.

## 8. Visibility requirements (both are hard requirements)

- **Agent-facing:** `WORLD_MECHANICS` (system prompt) describes, in-world (DD9): idling slowly
  wears you down; you can build a home, rest there to turn materials into energy, and must keep
  feeding it materials or it crumbles. (Plus L2 concepts when built.)
- **Observer-facing:** the activity feed and the isometric map surface homes (build / upkeep /
  decay / L2 breach) and aging (a being visibly declining as it stagnates).

## 9. Build order & done-condition

L1 (aging + private hearth-home) → observe a run → L2 (contest layer) → observe → **e2e**: a run
where beings build, fuel, age, and contest homes, watched on the map. Each layer: spec → plan →
subagent-built (Sonnet impl / Opus review) → green CI → merge → self-wake to the next.

## Provenance
- Brainstormed + locked with Safi 2026-07-01.
- World-aware design review 2026-07-01 flipped **energy-mint → materials-hearth**, **upkeep →
  materials**, corrected the **layering**, and adopted **aging-when-idle** as the still-life fix.
