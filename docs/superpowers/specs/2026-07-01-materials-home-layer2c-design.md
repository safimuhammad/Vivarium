# Layer 2c — Break-in / Thieve / Colonize / Ruins (Design)

**Date:** 2026-07-01
**Status:** Proposed — carved from L2 spec §12 (fork 4-6) + carried 2b items; forks flagged for the Opus tech-review.
**Parent:** `docs/superpowers/specs/2026-07-01-materials-home-layer2-design.md` (§12 governs).
**Builds on (merged):** L1 (private hearth-home), 2a (shared ownership + `max_integrity(s)` + pooled upkeep + death lifecycle), 2b (vault + `home_is_hoarding` + deposit/withdraw).

2c is the payoff of the contest layer: homes become **contestable**. A coordinated group can breach a home and either **thieve** its vault or **colonize** it; a fallen home leaves **ruins** to scavenge. This is the slice that gives the world's combat a *territorial purpose*.

## Vision guardrails (binding)
Conservation (materials moved/destroyed, never minted; break-in cost is a pure sink; thieve ≤ vault; ruins remnant < banked); no still-life (a fortress must be breachable — the anti-blob health cap already ensures this); no death-spiral; DD9; emergent-not-scripted; perceivable; **run forever**. Balance: **expected loot < coordinated breach cost for a *typical* vault**, so only a hoard-tier (~300) vault is worth a coordinated breach (mirrors "attacking a hoarder is profitable, a normal being is a loss") — NOT loot<cost for every home (that makes break-in inert).

## 1. The incremental-repair switch (the risky, foundational change)
Today the tick (`world/tick.py`) on a **covered** tick heals integrity straight to `max_integrity(s)` and advances `last_upkeep_at`; on a **missed** tick it subtracts a flat `HOME_DECAY_PER_MISSED_TICK`. Cumulative break-in is impossible against heal-to-full (a breach heals away before the next attempt). 2c switches BOTH halves to **time-based `rate*elapsed`**:
- Covered tick: `modify_home_integrity(home_id, +HOME_REPAIR_PER_SECOND * elapsed)` (clamped to `max_integrity(s)`), pay upkeep, advance `last_upkeep_at`.
- Missed tick: `modify_home_integrity(home_id, -HOME_DECAY_PER_SECOND * elapsed)`, freeze `last_upkeep_at` (arrears).
- This kills tick-frequency coupling (the mating 60→600 trap) AND makes break-in cumulative.
- **MUST NOT regress L1/2a stability:** a funded home under the normal breath cadence must stay at/near `max_integrity(s)` (repair rate ≥ the wear it takes between breaths when funded). *(FORK A: the exact `HOME_REPAIR_PER_SECOND` / `HOME_DECAY_PER_SECOND` values + verifying a funded home stays healthy under the Gemini ~1-3s regime; and whether decay-when-broke still reaches collapse in a sane wall-time.)*

## 2. break_in tool + mechanic
- New tool `break_in(target_home, intent)` (NOT an extension of `attack`). Each call: the raider must be co-located with the target home and NOT a stakeholder of it; drains `BREAKIN_ENERGY_COST` energy + `BREAKIN_MATERIALS_COST` materials from the raider (pure sinks, destroyed); applies `-BREAKIN_INTEGRITY_DAMAGE` via `modify_home_integrity`; records the raider in the home's `breachers` set.
- **Breach** = integrity reaches ≤ 0. Coordination emerges from the math: a lone raider's damage-per-breath < `HOME_REPAIR_PER_SECOND * breath_gap` (the home out-heals them and they burn out); multiple raiders stacking damage inside one repair window make net progress. `Σ(raiders) BREAKIN_INTEGRITY_DAMAGE / breath_gap > HOME_REPAIR_PER_SECOND`.
- First-guess dials: `BREAKIN_INTEGRITY_DAMAGE=25, BREAKIN_ENERGY_COST=15, BREAKIN_MATERIALS_COST=10`. *(FORK B: verify these against `max_integrity` (M(1)=100…M(4)=187.5) + the loot<cost inequality + the coordination threshold vs `HOME_REPAIR_PER_SECOND` — the single most dangerous set of dials, to be validated in the LIVE run.)*
- **THE COMPOSITION QUESTION (FORK C):** how do cumulative attempts + the breach + the thieve/colonize choice fit one tool? Proposed: `break_in(target_home, intent)` carries the raider's `intent` ∈ {thieve, colonize} on every attempt; the attempt whose damage brings integrity ≤ 0 **executes that attempt's intent** atomically (breach + thieve/colonize in one call); pre-breach attempts just damage + cost. Is that the cleanest, or should breach and the thieve/colonize action be separate tools (breach opens a window; a separate `thieve`/`colonize` acts while integrity ≤ 0)? Resolve the interface.

## 3. Thieve / Colonize outcomes
- `breachers: set[str]` on `Home` — add on each `break_in`; **clear when integrity fully repairs** back to `max_integrity(s)` (so a repelled raid resets). *(FORK D: is "fully repaired" the right reset, or a time/decay-based expiry?)*
- **Thieve:** split `vault_materials` equally among the co-located, ALIVE breachers (remainder to the final striker); `Σ splits = vault` (conserved). The looted home is left at integrity ~0 with an emptied vault — a decaying wreck (the tick's decay finishes it → ruin) OR it immediately becomes a ruin. *(FORK E: does thieve immediately ruin the home, or leave it standing-at-0 for the owner to try to save / the tick to collapse?)*
- **Colonize:** the final striker becomes `owner_id`; the co-located ALIVE breachers become the new `stakeholders`; prior owner + stakeholders are evicted; **vault + structure retained** (no resource move → trivially conserved); integrity stays ~0 (the new owners must shore it up immediately or it collapses). 

## 4. Ruins
- `Home` gains `HomeStatus{STANDING, RUIN}` + `ruined_at: float | None` + `remnant_materials: float`. A RUIN stays in `world.homes`, swept after `RUINS_PERSIST_SECONDS` (~120-240, cf. `CORPSE_DECAY_SECONDS=120`) by a tick loop mirroring corpse-decay.
- A home becomes a RUIN on **collapse** (integrity ≤ 0 from unpaid decay) and/or the thieve outcome (per FORK E): `remnant_materials = RUINS_SCAVENGE_FRACTION * (HOME_BUILD_MATERIALS_COST + vault_materials)`; **`RUINS_SCAVENGE_FRACTION` < 1 (hard — conservation; else build→collapse→scavenge farms materials)**. The non-scavenged fraction is the sink.
- `scavenge_ruins(target)` tool: a co-located being draws from `remnant_materials` (like harvesting a region pool; ≤ remnant; deduct-remnant-first then credit personal). Repurpose the current `home_collapsed`→`remove_home` path to create-a-ruin instead.
- **CARRIED from 2b:** `vault_materials` MUST feed the remnant (2b's collapse currently destroys the vault — capture it here).

## 5. Carried 2b items (fold into 2c)
- **Vault → remnant** (above).
- **`(hoarding)` marker** on the world-table for BOTH the homes section AND the agents section (2c reworks the homes table for breachers/status anyway; the table currently shows no hoard markers though `home_is_hoarding`/`is_hoarding` exist). One consistency pass.
- **Raider target-vault perception:** `look_around` currently shows only a being's OWN home vault. Raiders need to perceive a co-located home they could breach (its vault / hoard status) to choose a target. *(FORK F: how much of another's home does a non-stakeholder perceive — vault balance? just hoard-flag? — DD9-safe, physics-framed.)*

## 6. Data model, tools, events
- `Home` += `status: HomeStatus`, `ruined_at: float | None`, `remnant_materials: float`, `breachers: set[str]`.
- WorldState (sync, event-free): `record_breacher`/`clear_breachers`; `colonize_home(home_id, new_owner, new_stakeholders)`; `make_ruin(home_id)` (compute remnant, set RUIN, clear vault/stakeholders as appropriate); `scavenge_ruin(home_id, amount) -> float` (actual scavenged); a stakeholder-independent "home here" lookup for raiders (`standing_home_at(region, exclude_stakeholder=agent)` or similar).
- Tools (both maps, DD9): `break_in`, `scavenge_ruins`. Events (LOCAL): `home_breached`, `home_thieved`, `home_colonized`, `ruins_scavenged`, and the repurposed `home_collapsed`→ruin beat.
- Feed verbs + world-table: status (STANDING/RUIN), breachers, remnant; the `(hoarding)` markers.

## 7. Constants
`HOME_REPAIR_PER_SECOND`, `HOME_DECAY_PER_SECOND` (replacing/deriving from `HOME_DECAY_PER_MISSED_TICK`), `BREAKIN_INTEGRITY_DAMAGE`, `BREAKIN_ENERGY_COST`, `BREAKIN_MATERIALS_COST`, `RUINS_SCAVENGE_FRACTION` (<1), `RUINS_PERSIST_SECONDS`. Asserts: `RUINS_SCAVENGE_FRACTION < 1`.

## 8. Visibility (DD9, in-world)
`WORLD_MECHANICS`: enough beings together can break into a home that is not theirs, at a cost in energy and materials, to take its store or seize it for their own; a home worn to nothing falls to ruin, which any passer-by may pick over. Observer: breach/thieve/colonize/ruin are the dramatic beats the piece exists to show.

## 9. Testing
Every WorldState method (success + edges); break_in (damage accrues, cost is a pure sink, coordination threshold, breach fires at ≤0, non-stakeholder/region guards); thieve (split = vault, conserved); colonize (ownership/stakeholder reassign, priors evicted, vault retained); ruins (make_ruin remnant math, FRACTION<1, scavenge ≤ remnant, sweep after persist); the incremental-repair switch (funded home stays healthy — L1/2a non-regression; broke home decays to collapse; break-in beats repair only when coordinated); the multi-pool conservation property test EXTENDED to include vault + remnant. **LIVE tuning run before merge** (cadence-coupled dials).

## 10. Open questions for the Opus tech-review
A. Incremental-repair rates (`HOME_REPAIR_PER_SECOND`/`HOME_DECAY_PER_SECOND`) + L1/2a non-regression + collapse-in-sane-wall-time — verify against the real `world/tick.py`.
B. Break-in dials vs `max_integrity` + the loot<cost inequality + coordination threshold (the LIVE-run targets).
C. break_in tool interface: intent-on-every-attempt (breach executes it) vs separate breach/thieve/colonize tools.
D. `breachers` reset: full-repair vs time/decay expiry.
E. Does thieve immediately ruin the home, or leave it standing-at-0?
F. Raider perception of a target home (how much a non-stakeholder sees) — DD9-safe.
G. Any conservation hole / still-life / explosion across the contest layer once break-in is live; decomposition of 2c into build tasks (it's large — incremental-repair switch, then break_in+breach, then thieve/colonize, then ruins, then carried items, then visibility).
