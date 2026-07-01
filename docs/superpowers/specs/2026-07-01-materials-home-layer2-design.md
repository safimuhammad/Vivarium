# Layer 2 — The Contest Layer (Design)

**Date:** 2026-07-01
**Status:** Proposed — carved from the overall design §5; technical forks flagged for the Opus tech-review.
**Parent:** `docs/superpowers/specs/2026-07-01-materials-home-overall-design.md`
**Builds on (L1, merged):** `Home{home_id, owner_id, region, integrity, built_at, last_upkeep_at}`; `WorldState.homes` + methods; time-based materials upkeep + decay/collapse in the world-tick; `build_home` + `use_hearth` tools; feed verbs + world-table homes section.

L2 turns a private shelter into **contestable, shareable territory** — the layer that gives the world's combat a *purpose*. It is one interlocking system (shared ownership ↔ health ↔ vault ↔ break-in ↔ ruins), but may build/merge in sub-slices (see §Open decisions).

## Vision guardrails (unchanged, binding)
Conservation (no minted energy; materials moved/destroyed, never created); no still-life (don't reward one invincible mega-commune → diminishing-returns on health); no death-spiral; DD9 (in-world prose, no goals/sim-language); emergent-not-scripted; perceivable (feed + world-table). Balance so **expected raid loot < coordinated breach cost** (mirrors `ATTACK_ENERGY_COST` > per-hit value) or raiding becomes a war of extinction.

## 1. Shared ownership / stakeholders
- `Home` gains `stakeholders: list[str]` (the builder is the first). A being co-located at a home may **pledge** to join it (new tool, e.g. `pledge_home`): it becomes a stakeholder — shares upkeep and gains hearth access.
- `use_hearth` (L1, owner-only) widens to **any stakeholder**.
- Upkeep (L1 drew from the single owner) now draws across stakeholders. *(FORK 1: model.)*

## 2. Health / integrity that scales with stakeholders
- The home's **max integrity** scales with stakeholder count (a communal home is a fortress; a lone shelter is soft), with **diminishing returns / a ceiling** so many contestable homes (territory) beat one unraidable blob. *(FORK 2: exact formula.)*
- Integrity is the L1 decay meter AND the break-in target.

## 3. Storage vault
- `Home` gains a shared vault (bank materials — and energy? *(FORK 3a)*). Tools to **deposit/withdraw** for stakeholders at the home.
- **Vault contents count toward hoarding** and are perceivable (no laundering) — but the vault is shared, so *whose* hoard? *(FORK 3b: per-depositor attribution vs the home itself being flagged as a hoard.)*
- Vault is what thieves loot.

## 4. Break-in (coordinated; costs energy + materials; thieve or colonize)
- A new tool (e.g. `break_in`) lets a being assault a home it is co-located with but not a stakeholder of. Proposed mechanic: each attempt deals damage to the home's integrity and **costs the raider energy + materials**; when integrity hits 0 the home is **breached**. A lone raider can't out-damage upkeep-repair + their own mounting cost before burning out (combat is already tuned so lone aggression self-limits) — so breaching a healthy (multi-stakeholder) home *requires a coordinated group*. *(FORK 4: is this a new `break_in` tool dealing integrity damage, or an extension of `attack` targeting a home? How is "combined force" accumulated — cumulative integrity damage over a window, vs a simultaneous quorum?)*
- On breach, the raiders **choose**:
  - **Thieve** — loot the vault. *(FORK 5a: distribution — the breacher takes it, or split among co-located raiders?)*
  - **Colonize** — seize ownership. *(FORK 5b: transfer to whom — the breaching coalition become the new stakeholders, or the final striker becomes sole owner? Existing stakeholders evicted.)*
- Balance: breach cost (energy+materials) must exceed expected loot. *(FORK 4 balance — the single most dangerous dial.)*

## 5. Ruins
- A home that **collapses** (unpaid decay, L1) or is **breached-and-abandoned** leaves **ruins**: scavengeable for a *fraction* of what was banked (build materials + vault remnant), conserved (scavenged ≤ banked). *(FORK 6: ruins as a new lightweight entity vs a flag on the Home; scavenge tool; how long ruins persist; do they occupy the region.)*

## 6. Death & departure of stakeholders
- A dead being is removed from any `stakeholders`. A home whose **last** stakeholder dies/leaves has no one to pay upkeep → decays → collapses → ruins (reuses the L1 cannot-pay path). *(FORK 7: confirm this is the whole ownership-on-death rule for L2, meshing with 120s corpse-decay + combat looting.)*

## 7. Data model (extend L1 `Home`, forward-compatibly)
- `Home` gains: `stakeholders: list[str]`, a max-integrity that derives from stakeholders (stored or computed), vault fields. New `WorldState` methods (sync, event-free): add/remove stakeholder, deposit/withdraw vault, compute max-integrity, damage-integrity (already have `modify_home_integrity`), create/scavenge ruins. The tick + tools orchestrate + publish events.

## 8. Tools & events
- Tools (each in BOTH `BUILTIN_TOOLS` + `TOOL_SCHEMAS`; NL Error/Invalid/success; DD9 schema descriptions): `pledge_home`, `deposit_to_home` / `withdraw_from_home`, `break_in`, `scavenge_ruins`. Widen `use_hearth` to stakeholders.
- Events (LOCAL): `home_joined`, `home_deposit`/`home_withdraw` (maybe), `home_breached` (+thieve/colonize outcome), `home_colonized`, `ruins_scavenged`. Add feed verbs; extend the world-table (stakeholders, health, vault).

## 9. Constants (centralize; tune from runs)
`HOME_HEALTH_BASE`, `HOME_HEALTH_PER_STAKEHOLDER` (+ diminishing factor/ceiling), `BREAKIN_ENERGY_COST`, `BREAKIN_MATERIALS_COST`, `BREAKIN_INTEGRITY_DAMAGE`, vault caps (if any), `RUINS_SCAVENGE_FRACTION`, `RUINS_PERSIST_SECONDS`. Relationship: expected vault loot < coordinated breach cost; health-per-stakeholder diminishes.

## 10. Visibility (hard requirements)
- Agent-facing: extend `WORLD_MECHANICS` (DD9) — a home can be shared (pledge to join, share its keep, use its hearth); a home holds a store you can bank into; a well-kept, well-peopled home is hard to breach; enough beings together can break into another's home to take its stores or seize it; a fallen home leaves ruins to pick over.
- Observer-facing: world-table shows stakeholders + health + vault; feed renders the new events (breach/colonize/scavenge are the dramatic beats the piece exists to show).

## 11. Open decisions for the Opus tech-review (resolve before planning)
1. **Shared-upkeep model** (FORK 1): equal per-stakeholder share (broke share → decay) vs a collective draw from any solvent stakeholder. Which best yields emergent free-rider drama without a death-spiral?
2. **Health formula** (FORK 2): concrete diminishing-returns/ceiling shape.
3. **Vault** (FORK 3): materials-only or materials+energy? How vault contents count toward `is_hoarding` without a laundering loophole (per-depositor vs home-flagged).
4. **Break-in mechanic** (FORK 4): new `break_in` tool dealing cumulative integrity damage (costs energy+materials/attempt) vs extending `attack`; how "coordinated group" emerges from the math; the balance inequality.
5. **Thieve/colonize outcomes** (FORK 5): loot distribution; ownership transfer target; eviction of prior stakeholders.
6. **Ruins** (FORK 6): entity vs flag; scavenge tool; persistence; conservation of scavenged materials.
7. **Death/departure** (FORK 7): confirm the last-stakeholder→ruins rule + corpse-decay interaction.
8. **Decomposition:** should L2 ship as ONE PR or sub-slices (e.g. 2a shared-ownership+health, 2b vault, 2c break-in+colonize+ruins)? Each should be independently observable.
9. Any conservation hole or still-life/explosion risk across the whole contest layer; dangerous dials.
