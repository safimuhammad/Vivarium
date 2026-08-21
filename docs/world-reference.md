# Vivarium — World Reference (for UI builders)

**Date:** 2026-07-03 · **Snapshot:** after frontend Layer 2c event enrichment.
**Purpose:** A single, code-verified reference for anyone building a UI/visualizer for the Vivarium world — the world model, every agent action, the full event stream (the UI's data feed), the data shapes, the dials, the replay format, and the mechanics that run without any agent. Everything here was extracted directly from source; where a value or behavior matters, the file is cited.

> **What Vivarium is (one paragraph).** An open-ended multi-agent art piece: LLM-powered beings that *exist* — perceive locally, remember, talk, gather, build homes, share, mate, and (rarely) fight — with no goals, scripts, or win condition. It is meant to be *watched*, like Conway's Game of Life with cognition. The UI's job is to make what unfolds **perceivable**. The world is driven by an append-only **event stream**; the UI is fundamentally an event renderer over an isometric (or other) map.

---

## Table of contents

1. [The world model](#1-the-world-model)
2. [Data shapes the UI renders](#2-data-shapes-the-ui-renders)
3. [Actions — the 17 agent tools](#3-actions--the-17-agent-tools)
4. [The event stream (the UI's data feed)](#4-the-event-stream-the-uis-data-feed)
5. [Ambient mechanics — the world-tick](#5-ambient-mechanics--the-world-tick)
6. [How a being acts — the breathing loop & perception](#6-how-a-being-acts--the-breathing-loop--perception)
7. [Constants & dials](#7-constants--dials)
8. [Derived quantities & formulas](#8-derived-quantities--formulas)
9. [Observability & replay format](#9-observability--replay-format)
10. [UI guidance & gotchas](#10-ui-guidance--gotchas)
11. [Appendix: code map & known doc-drift](#11-appendix-code-map--known-doc-drift)

---

## 1. The world model

- **Regions** — named places on a graph. Movement is only along a region's `connections` (adjacency). Each region holds two regenerating resource pools (energy, materials), each capped. Perception is **local**: a being senses only its own region.
- **Two resources:**
  - **Energy** — the life/action currency. Every meaningful action spends it. At/below `PARALYSIS_ENERGY_THRESHOLD` (5.0) a being is **PARALYZED** (can't act; only another being's energy transfer revives it). It is a *closed* economy — the only inflow is region regeneration (harvested from the land); the hearth *converts* materials→energy but never mints.
  - **Materials** — the substance of the home economy: build cost, hearth fuel, home upkeep, the vault store, mating commitments, and raid loot. Harvested, transferable, storable, lootable.
- **Beings (agents)** — each has energy, materials, a position, a lifecycle status, a persona/identity, and reproduction bookkeeping. They run asynchronously at their own pace (see §6).
- **Homes** — built with materials; can be **shared** (stakeholders), hold a **vault** of materials, be **contested** (broken into → thieved or colonized), and fall into **ruins**. (Layers 1–2c.)

**Emergent character (important for UI tone).** Across many live runs the world exhibits a strong **cooperative attractor**: beings harvest, share (reviving paralyzed peers), build and *co-tend* homes, and reproduce. Combat and break-ins are **built and functional but rarely chosen** — even beings authored as violent raiders were reshaped into caretakers. So the UI's common beats are movement, speech, homes forming, hearths, births, and rescues; combat/raids/ruins are rare, dramatic punctuation. Design the UI to make cooperation legible and beautiful, and to spotlight the rare conflict beats when they happen.

---

## 2. Data shapes the UI renders

All four core records are `@dataclass(slots=True)` and **mutable** (the world mutates them in place). Sources: `world/agents.py`, `world/regions.py`, `world/homes.py`, `bus/events.py`.

### AgentState (`world/agents.py`)


| Field               | Type          | Default | Meaning                                                         |
| ------------------- | ------------- | ------- | --------------------------------------------------------------- |
| `id`                | `str`         | —       | Stable unique id, `"{category}_{suffix}"` (e.g. `wanderer_001`) |
| `name`              | `str`         | —       | Display name                                                    |
| `persona`           | `str`         | —       | Free-text identity (where "wanting" lives; drives behavior)     |
| `current_position`  | `str`         | —       | Region name the being occupies                                  |
| `current_energy`    | `float`       | —       | Energy; floored at 0, **uncapped**                              |
| `current_materials` | `float`       | —       | Materials; floored at 0, uncapped                               |
| `status`            | `AgentStatus` | —       | `ALIVE` / `PARALYZED` / `DEAD`                                  |
| `last_mated_at`     | `float|None`  | `None`  | World-time of last completed mating (cooldown)                  |
| `offspring_count`   | `int`         | `0`     | Children parented (cap `MATING_MAX_OFFSPRING`=5)                |
| `died_at`           | `float|None`  | `None`  | World-time of death (drives corpse decay)                       |


`AgentStatus`: `ALIVE="alive"`, `PARALYZED="paralyzed"` (energy ≤ 5.0; can't act, revivable by a transfer), `DEAD="dead"` (terminal; corpse lingers `CORPSE_DECAY_SECONDS` then is swept).

### Region (`world/regions.py`)


| Field                                  | Type        | Meaning                           |
| -------------------------------------- | ----------- | --------------------------------- |
| `name`                                 | `str`       | Unique region name (map key)      |
| `description`                          | `str`       | Human-readable description        |
| `connections`                          | `list[str]` | Adjacent regions (movement edges) |
| `energy_rate` / `materials_rate`       | `float`     | Added per regeneration tick       |
| `current_energy` / `current_materials` | `float`     | Pool level, clamped `[0, max]`    |
| `max_energy` / `max_materials`         | `float`     | Pool caps                         |


`ResourceTypes`: `ENERGY="energy"`, `MATERIALS="materials"`.

### Home (`world/homes.py`)


| Field               | Type         | Default    | Meaning                                                                   |
| ------------------- | ------------ | ---------- | ------------------------------------------------------------------------- |
| `home_id`           | `str`        | —          | Unique id (map key), e.g. `home_1a2b3c4d`                                 |
| `owner_id`          | `str`        | —          | Owner (reassignable via colonize / owner-death promotion)                 |
| `region`            | `str`        | —          | Region it stands in                                                       |
| `integrity`         | `float`      | —          | Soundness, `[0, max_integrity(len(stakeholders))]`; collapses at ≤0       |
| `built_at`          | `float`      | —          | World-time raised                                                         |
| `last_upkeep_at`    | `float`      | —          | Arrears clock; **freezes on a missed (unpaid) tick**                      |
| `stakeholders`      | `list[str]`  | `[]`       | Beings bought in (owner is first). Drives health ceiling + upkeep pool    |
| `vault_materials`   | `float`      | `0.0`      | Shared materials store; counts toward home hoarding; loot target          |
| `last_integrity_at` | `float`      | `0.0`      | Repair/decay clock; **advances every tick** (prevents decay acceleration) |
| `status`            | `HomeStatus` | `STANDING` | `STANDING` / `RUIN`                                                       |
| `ruined_at`         | `float|None` | `None`     | World-time it fell to ruin (drives ruin sweep)                            |
| `remnant_materials` | `float`      | `0.0`      | Scavengeable materials of a ruin (meaningless while STANDING)             |
| `breachers`         | `set[str]`   | `∅`        | Beings currently breaking in (thieve-split / colonize pool)               |


`HomeStatus`: `STANDING="standing"`, `RUIN="ruin"`.

### Event (`bus/events.py`) — the atom the UI consumes


| Field       | Type            | Default | Meaning                                                                                         |
| ----------- | --------------- | ------- | ----------------------------------------------------------------------------------------------- |
| `type`      | `str`           | —       | Event kind (e.g. `"attack"`, `"home_built"`)                                                    |
| `source`    | `str`           | —       | Emitting agent id — **or a sentinel** (`"system"`, `"world"`); *not always the actor* (see §10) |
| `payload`   | `dict[str,Any]` | —       | Always includes `message` as display fallback; mechanic events also include structured ids, resources, amounts, balances, and lifecycle fields for UI reducers |
| `scope`     | `ScopeType`     | —       | Routing (below)                                                                                 |
| `region`    | `str|None`      | `None`  | LOCAL target region (None → source's region)                                                    |
| `target`    | `str|None`      | `None`  | TARGETED recipient; also used on some LOCAL events as a *directed-line hint*                    |
| `timestamp` | `float`         | now     | World-clock seconds (drives replay ordering)                                                    |


`ScopeType` (routing done by `bus/event_bus.py::publish`): `LOCAL="local"` (agents in `region`), `GLOBAL="global"` (all), `TARGETED="targeted"` (the one `target`), `PRIVATE="private"` (**no** inbox — logged/feed-visible only; used by self-talk). Every event that routes without error is also written to the log/feed sink — so PRIVATE, empty-region LOCAL, and unrouted TARGETED events are all still **recorded** (visible to the UI) even when they reached zero inboxes.

---

## 3. Actions — the 17 agent tools

Canonical list: `tools/builtin/__init__.py::BUILTIN_TOOLS`. Agent-facing param shapes + descriptions: `agents/tool_schemas.py` (kept in lock-step by a parity test). Signature: `async def tool(world, event_bus, agent_id, **params) -> str`. Every tool returns a natural-language string to the agent: `Error:` (lookup/precondition failure), `Invalid:` (rule violation), or a plain success sentence. Costs are in `core/constants.py`.

**The 17:** `move`, `look_around`, `speak`, `harvest_resources`, `transfer_resource`, `initiate_mating`, `reject_mating`, `accept_mating`, `attack`, `build_home`, `use_hearth`, `pledge_home`, `leave_home`, `deposit_to_home`, `withdraw_from_home`, `break_in`, `scavenge_ruins`.


| Tool                   | Params                                       | Cost                                                                    | Effect (state Δ)                                                                                                                                                                                                                                                                                  | Event(s) emitted                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **move**               | `destination`                                | 5 energy                                                                | position → destination (must be adjacent + energy≥5)                                                                                                                                                                                                                                              | `agent_left_region` (origin), `agent_entered_region` (dest) — both LOCAL                                                                                                                                  |
| **look_around**        | —                                            | free                                                                    | none (pure read)                                                                                                                                                                                                                                                                                  | none                                                                                                                                                                                                      |
| **speak**              | `message`, `target?`                         | 0.5 energy                                                              | none                                                                                                                                                                                                                                                                                              | `speak` — TARGETED if `target` (whisper) else LOCAL                                                                                                                                                       |
| **harvest_resources**  | `resource_type`, `amount`                    | free                                                                    | region pool −amount → agent +amount                                                                                                                                                                                                                                                               | `resource_changed` (LOCAL); `agent_started_hoarding` if it crosses a hoard threshold                                                                                                                      |
| **transfer_resource**  | `target`, `resource_type`, `amount`          | free (moves amount)                                                     | sender −amount → receiver +amount (co-located; receiver not DEAD)                                                                                                                                                                                                                                 | `resource_transferred` (LOCAL, `target`=receiver); `agent_recovered` if it revives a PARALYZED receiver; `agent_started_hoarding` if receiver crosses                                                     |
| **initiate_mating**    | `target`, `message`, `resources`             | escrows ≥50 energy + ≥30 materials                                      | deducts commitment; stores pending proposal                                                                                                                                                                                                                                                       | `mating_initiated` (TARGETED)                                                                                                                                                                             |
| **reject_mating**      | `target`(=initiator), `message`              | free                                                                    | refunds initiator; drops proposal                                                                                                                                                                                                                                                                 | `mating_rejected` (TARGETED→initiator)                                                                                                                                                                    |
| **accept_mating**      | `target`(=initiator), `message`(unused)      | matches the escrow                                                      | spawns a child (ALIVE, at acceptor's region, persona=GENESIS_SEED, resources = each parent's contribution ×1.6); records mating for both                                                                                                                                                          | `agent_born` (LOCAL, `source`=**child**); or `mating_proposal_invalidated` (TARGETED) if the initiator went stale                                                                                         |
| **attack**             | `target`                                     | 15 energy                                                               | target −20 energy; **lethal** if target already PARALYZED or drops <0 → loots ALL victim energy+materials, victim DEAD                                                                                                                                                                            | non-lethal → `attack` (LOCAL, `target`=victim); lethal → `agent_died` (LOCAL, `source`=**victim**, payload `killer`/`looted_energy`/`looted_materials`); + `agent_paralyzed` if the blow flips the target |
| **build_home**         | —                                            | 80 materials                                                            | new home in current region (owner=sole stakeholder, integrity 100); one home per being                                                                                                                                                                                                            | `home_built` (LOCAL)                                                                                                                                                                                      |
| **use_hearth**         | —                                            | burns ≤20 of own materials                                              | own materials −burned → own energy +burned (1:1); must be ALIVE, at a STANDING home you stake                                                                                                                                                                                                     | `hearth_used` (LOCAL); `agent_started_hoarding` if energy crosses                                                                                                                                         |
| **pledge_home**        | `home_id`                                    | free                                                                    | join a co-located STANDING home as a stakeholder (at most one home per being)                                                                                                                                                                                                                     | `home_joined` (LOCAL); silent no-op if already yours                                                                                                                                                      |
| **leave_home**         | —                                            | free                                                                    | remove your stake; if you were owner, lowest-id survivor promoted; ceiling re-clamps                                                                                                                                                                                                              | `home_left` (LOCAL)                                                                                                                                                                                       |
| **deposit_to_home**    | `amount`                                     | free (moves amount)                                                     | personal materials −amount → home `vault_materials` +amount (must stake a STANDING home, be there)                                                                                                                                                                                                | `home_started_hoarding` **only** if the vault crosses 300 (else no event)                                                                                                                                 |
| **withdraw_from_home** | `amount`                                     | free (moves amount)                                                     | vault −amount → personal +amount (amount ≤ vault)                                                                                                                                                                                                                                                 | **none** (silent by design)                                                                                                                                                                               |
| **break_in**           | `target_home`, `intent`(`thieve`|`colonize`) | **15 energy + 10 materials, pure sink (destroyed), paid every attempt** | integrity −25; records breacher. On the blow that drives integrity ≤0 (**breach**): `thieve`→split whole vault among co-located ALIVE breachers, home stays STANDING at ~0; `colonize`→striker becomes owner, homeless co-located ALIVE breachers become stakeholders, priors evicted, vault kept | non-breach → none; breach → `home_breached` (LOCAL) **plus** `home_thieved` or `home_colonized`                                                                                                           |
| **scavenge_ruins**     | `target_home`, `amount`                      | free (moves amount)                                                     | ruin `remnant_materials` −taken → personal +taken (capped at remnant; any co-located ALIVE being)                                                                                                                                                                                                 | `ruins_scavenged` (LOCAL)                                                                                                                                                                                 |


**Status gating quirks worth knowing:** `speak`, `use_hearth`, `pledge_home`, `deposit_to_home`, `withdraw_from_home`, `break_in`, `scavenge_ruins` explicitly require **ALIVE**. `harvest_resources`, `move`, `attack`, `leave_home`, `transfer_resource` (as sender) do **not** check status (a paralyzed being is usually blocked only by the energy cost). `transfer_resource` allows a **PARALYZED receiver** (that's the revival path) but not a DEAD one. Mating tools do **not** enforce co-location (unlike attack/transfer) — see §10.

**Mating `target` asymmetry:** in `initiate_mating`, `target` = who you propose to. In `reject_mating`/`accept_mating`, `target` = the *original initiator* (you are responding). Track this to draw the right relationship.

---

## 4. The event stream (the UI's data feed)

**28 distinct event types.** Every event carries `payload["message"]` as a
ready-to-render fallback. The frontend must use the structured payload fields below
for mechanics and treat prose as display text only.

### Lifecycle


| type              | scope | source          | region/target             | payload keys beyond `message` | meaning                                                                  |
| ----------------- | ----- | --------------- | ------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `agent_born`      | LOCAL | **the newborn** | region=birth (acceptor's) | `child_id`, `child_name`, `parent_ids`, `initiator_id`, `acceptor_id`, `region`, `committed_resources`, `child_resources`, `offspring_multiplier` | a child was born |
| `agent_died`      | LOCAL | **the victim**  | region=death              | `victim_id`, `victim_name`, `killer_id`, `killer`, `region`, `attack_damage`, `attack_energy_cost`, `victim_was_paralyzed`, `looted_energy`, `looted_materials` | a lethal attack; killer looted all |
| `agent_decayed`   | LOCAL | the corpse's id | region=last               | `agent_id`, `agent_name`, `region`, `died_at`, `decayed_at` | a DEAD body was swept after `CORPSE_DECAY_SECONDS` (world-tick) |
| `agent_paralyzed` | LOCAL | `**"system"**`  | region=agent's            | `agent_id`, `region`, `trigger`, `energy`; attack-caused events also include `victim_id`, `attacker_id` | a being flipped ALIVE→PARALYZED (from an attack, or its own costs/aging) |
| `agent_recovered` | LOCAL | the feeder      | target=revived            | `giver_id`, `recipient_id`, `revived_id`, `region`, `resource_type`, `amount`, `giver_energy`, `revived_energy` | an energy transfer revived a PARALYZED being |


### Movement & communication


| type                   | scope             | source  | region/target             | payload keys beyond `message` | meaning                                                      |
| ---------------------- | ----------------- | ------- | ------------------------- | ----------------------------- | ------------------------------------------------------------ |
| `agent_left_region`    | LOCAL             | mover   | region=origin             | `agent_id`, `from_region`, `to_region`, `move_energy_cost`, `agent_energy` | a being left (heard by those left behind) |
| `agent_entered_region` | LOCAL             | mover   | region=dest               | `agent_id`, `from_region`, `to_region`, `move_energy_cost`, `agent_energy` | a being arrived (heard by those present) |
| `speak`                | LOCAL or TARGETED | speaker | target=whisperee (if any) | `speaker_id`, `target_id`, `region`, `speak_energy_cost` | said aloud (LOCAL) or whispered (TARGETED) |
| `self_talk`            | **PRIVATE**       | thinker | —                         | `agent_id` | a private thought (no tool call); logged/feed only, no inbox |


### Resources


| type                     | scope | source      | region/target   | payload keys beyond `message` | meaning                                                                                         |
| ------------------------ | ----- | ----------- | --------------- | ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `resource_changed`       | LOCAL | harvester   | region          | `agent_id`, `region`, `resource_type`, `amount`, `agent_energy`, `agent_materials`, `region_energy`, `region_materials` | harvested energy/materials from the land |
| `resource_transferred`   | LOCAL | sender      | target=receiver | `sender_id`, `receiver_id`, `region`, `resource_type`, `amount`, `sender_energy`, `sender_materials`, `receiver_energy`, `receiver_materials` | gave resources to a co-located being |
| `agent_started_hoarding` | LOCAL | the crosser | region          | `agent_id`, `region`, `energy`, `materials` | crossed a hoard threshold (500 energy or 300 materials) — **crossing only**, no "stopped" event |


### Mating


| type                          | scope    | source    | target    | payload keys beyond `message` | meaning                                                    |
| ----------------------------- | -------- | --------- | --------- | ----------------------------- | ---------------------------------------------------------- |
| `mating_initiated`            | TARGETED | proposer  | proposee  | `initiator_id`, `target_id`, `resources`, `proposal_timestamp`, `initiator_energy`, `initiator_materials` | a proposal with escrowed resources |
| `mating_rejected`             | TARGETED | rejecter  | initiator | `rejecter_id`, `initiator_id`, `target_id`, `resources_refunded` | proposal declined, escrow refunded |
| `mating_proposal_invalidated` | TARGETED | initiator | initiator | `initiator_id`, `target_id`, `reason`, `resources_refunded` | at accept-time the initiator was ineligible; auto-refunded |
| `mating_proposal_timeout`     | TARGETED | initiator | initiator | `initiator_id`, `target_id`, `reason`, `resources_refunded` | proposal expired (world-tick), escrow refunded |
| *(`agent_born`)*              | —        | —         | —         | —       | successful acceptance → see Lifecycle                      |


### Combat


| type             | scope | source   | target | payload keys beyond `message` | meaning                       |
| ---------------- | ----- | -------- | ------ | ----------------------------- | ----------------------------- |
| `attack`         | LOCAL | attacker | victim | `attacker_id`, `victim_id`, `region`, `damage`, `attack_energy_cost`, `attacker_energy`, `victim_energy` | a non-lethal hit (−20 energy) |
| *(`agent_died`)* | —     | —        | —      | —       | a lethal hit → see Lifecycle  |


### Home / hearth / vault


| type                    | scope | source           | region    | payload keys beyond `message` | meaning                                        |
| ----------------------- | ----- | ---------------- | --------- | ----------------------------- | ---------------------------------------------- |
| `home_built`            | LOCAL | builder          | builder's | `home_id`, `target_home`, `builder_id`, `owner_id`, `region`, `materials_cost`, `integrity`, `stakeholders` | a home was raised |
| `hearth_used`           | LOCAL | rester           | agent's   | `agent_id`, `home_id`, `target_home`, `region`, `materials_burned`, `energy_gained`, `agent_energy`, `agent_materials` | burned materials→energy at a hearth |
| `home_joined`           | LOCAL | pledger          | home's    | `agent_id`, `home_id`, `target_home`, `owner_id`, `region`, `stakeholders`, `integrity`, `max_integrity` | joined a home as stakeholder |
| `home_left`             | LOCAL | leaver           | home's    | `agent_id`, `home_id`, `target_home`, `previous_owner_id`, `owner_id`, `region`, `previous_stakeholders`, `stakeholders`, `integrity`, `max_integrity` | gave up a home stake |
| `home_started_hoarding` | LOCAL | depositor        | home's    | `home_id`, `target_home`, `agent_id`, `region`, `vault_materials` | a vault crossed 300 materials |
| `home_collapsed`        | LOCAL | **former owner** | home's    | `home_id`, `target_home`, `owner_id`, `region`, `stakeholders`, `integrity`, `vault_materials`, `remnant_materials`, `ruined_at` | a STANDING home decayed to a RUIN (world-tick) |


### Contest / ruins


| type              | scope | source    | region | payload keys beyond `message` | meaning                                                                   |
| ----------------- | ----- | --------- | ------ | ----------------------------- | ------------------------------------------------------------------------- |
| `home_breached`   | LOCAL | raider    | home's | `home_id`, `target_home`, `breacher_id`, `intent`, `region`, `breachers`, `energy_cost`, `materials_cost`, `integrity_damage`, `integrity` | a break-in blow drove integrity ≤0 (always followed by thieved/colonized) |
| `home_thieved`    | LOCAL | striker   | home's | `home_id`, `target_home`, `breacher_id`, `intent`, `region`, `recipients`, `loot`, `loot_shares`, `vault_materials`, `integrity` | breach + `intent=thieve`: vault split among breachers |
| `home_colonized`  | LOCAL | striker   | home's | `home_id`, `target_home`, `breacher_id`, `intent`, `region`, `previous_owner_id`, `previous_stakeholders`, `new_owner_id`, `new_stakeholders`, `vault_materials`, `integrity` | breach + `intent=colonize`: home seized |
| `ruins_scavenged` | LOCAL | scavenger | ruin's | `agent_id`, `home_id`, `target_home`, `region`, `resource_type`, `amount`, `remnant_materials`, `agent_materials` | materials drawn from a ruin's remnant |


### System


| type                 | scope  | source    | payload keys beyond `message` | meaning                                                       |
| -------------------- | ------ | --------- | ----------------------------- | ------------------------------------------------------------- |
| `simulation_started` | GLOBAL | `"world"` | `run_id`, `agent_count`, `world_time` | one per run, before any breath (no `simulation_ended` exists) |


**Chained events (one tool → several events):** `move` → 2; `attack` → `attack`/`agent_died` **+ optional** `agent_paralyzed`; `harvest`/`transfer`/`use_hearth` → primary **+ optional** `agent_started_hoarding`; `deposit_to_home` → **only optional** `home_started_hoarding`; `break_in` breach → `home_breached` **+** one of `home_thieved`/`home_colonized`.

---

## 5. Ambient mechanics — the world-tick

`world/tick.py::run_world_tick` runs `tick()` every `**--world-tick-interval` (default 5.0s)**, resiliently (a bad tick is logged and skipped). These are **not** agent actions — render them as ambient world events. Time is measured via `world.now()` (injectable clock). Order within one tick (each job snapshots then mutates; all event publishes deferred to the end):

1. **Resource regeneration** — every region gains `energy_rate`/`materials_rate` (clamped to caps). *No event.*
2. **Mating-proposal timeout sweep** — proposals older than `MATING_PROPOSAL_TIMEOUT_SECONDS` (45s) refund the initiator + drop. → `mating_proposal_timeout`.
3. **Corpse-decay sweep** — DEAD agents with `died_at` older than `CORPSE_DECAY_SECONDS` (120s) are removed. → `agent_decayed`.
4. **Home upkeep / repair / decay / collapse** (STANDING homes only; RUIN skipped):
  - `owed = 0.1 × (now − last_upkeep_at)` drawn from the stakeholder pool (owner first, then by id; only living stakeholders count; **all-or-nothing**).
  - **Covered:** repair `+10 × (now − last_integrity_at)` (clamped to `max_integrity(stakeholders)`); if it reaches the ceiling, **clear breachers** (a repelled raid resets); advance `last_upkeep_at`.
  - **Not covered:** decay `−2 × (now − last_integrity_at)`; `last_upkeep_at` stays frozen (arrears). At integrity ≤0 → `make_ruin` (remnant = `0.5 × (80 + vault)`, vault zeroed, stakeholders/breachers cleared, status RUIN). → `home_collapsed`.
  - `last_integrity_at` advances **every** tick regardless.
5. **Ruin sweep** — RUINs older than `RUINS_PERSIST_SECONDS` (120s) are removed. *No event* (perceivable only as the ruin disappearing from the world-table).

---

## 6. How a being acts — the breathing loop & perception

Each being runs its own async loop (`agents/runtime.py`): **perceive → (compact if needed) → decide → execute → self-talk/aging → (reflect) → refresh_status**, then `sleep(pace)`. Self-paced; **temporal asymmetry** is a feature (fast vs. slow thinkers). Today the asymmetry comes from the serialized Ollama decider (one at a time) or per-breath cost; the Gemini path runs agents concurrently. Default `--pace` = 1.0s applied to all.

- **A breath resolves as** an *action* (a tool call), *self-talk* (free text, no tool → PRIVATE `self_talk` event, free), or *silent rest* (nothing).
- **Idle-aging:** any breath with **no tool call** (self-talk or silent rest) drains `IDLE_AGING_ENERGY_COST` (1.0) energy — the "stagnation isn't free" rule. Active breaths already paid their action's cost.
- **Reflection:** every `REFLECT_EVERY_N_BREATHS` (12) breaths, an isolated step lets the being `remember` a memory or `revise_self` (rewrite its identity) — **GENESIS_SEED self-authorship**. This is why a seeded persona reshapes over time.
- **Perception (`perceive()`)** surfaces, each breath: the being's own id/energy/materials/position/status, a low-energy attack warning, reproduction state (offspring count, cooldown), the region (description, paths, co-located beings via `describe_agent_brief`, pool levels + regen), standing mating offers (re-shown every breath until answered), and the drained inbox events. Co-located beings render as e.g. `Mae [id: wanderer_002] (energy 88.0, materials 45.0)` with `(fallen)`/`(dead)`/`(hoarding)` markers.
- **PARALYZED** beings keep looping but only drain their inbox (no inference) — revivable by another's transfer. **DEAD** stops the loop.

The system prompt = `persona` + the verbatim shared `WORLD_MECHANICS` physics text + the tool list. **DD9:** the shared shell describes only physics/consequences — never goals, strategy, survival advice, or that it's a simulation. All "wanting" lives in the persona. (Full `WORLD_MECHANICS` text: `agents/prompt.py`.)

---

## 7. Constants & dials

All in `core/constants.py`. Values a UI may display or threshold on.

**Action costs:** `MOVE_ENERGY_COST`=5.0 · `SPEAK_ENERGY_COST`=0.5 · `ATTACK_ENERGY_COST`=15.0 · `ATTACK_DAMAGE`=20.0 · `GENERIC_ACTION_ENERGY_COST`=1.0 *(defined, not yet charged)*.
**Aging:** `IDLE_AGING_ENERGY_COST`=1.0.
**Death/paralysis:** `KILL_ENERGY_THRESHOLD`=0.0 · `PARALYSIS_ENERGY_THRESHOLD`=5.0 · `CORPSE_DECAY_SECONDS`=120.0.
**Hearth:** `HEARTH_MATERIALS_PER_USE`=20.0 · `HEARTH_ENERGY_PER_MATERIAL`=1.0.
**Home build/health:** `HOME_BUILD_MATERIALS_COST`=80.0 · `HOME_MAX_INTEGRITY`=100.0 · `HOME_HEALTH_BASE`=100.0 · `HOME_HEALTH_CEIL`=200.0 (kept ≤ 2×base — anti-blob) · `HOME_HEALTH_DIMINISH`=0.5.
**Home upkeep/repair/decay (time-based):** `HOME_UPKEEP_MATERIALS_PER_SECOND`=0.1 · `HOME_REPAIR_PER_SECOND`=10.0 · `HOME_DECAY_PER_SECOND`=2.0 (broke M1 home collapses in ~50s).
**Break-in:** `BREAKIN_INTEGRITY_DAMAGE`=25.0 · `BREAKIN_ENERGY_COST`=15.0 · `BREAKIN_MATERIALS_COST`=10.0 (both pure sinks). Net progress needs >2 break-ins per 5s window.
**Ruins:** `RUINS_SCAVENGE_FRACTION`=0.5 (must be <1 — no farm) · `RUINS_PERSIST_SECONDS`=120.0.
**Hoarding thresholds:** `HOARDING_ENERGY_THRESHOLD`=500.0 · `HOARDING_MATERIALS_THRESHOLD`=300.0 (also the home-vault hoard line).
**Mating:** `MATING_MIN_ENERGY_CONTRIBUTION`=50.0 · `MATING_MIN_MATERIALS_CONTRIBUTION`=30.0 · `MATING_COOLDOWN_SECONDS`=300.0 · `MATING_PROPOSAL_TIMEOUT_SECONDS`=45.0 · `MATING_MAX_OFFSPRING`=5 · `MATING_OFFSPRING_MULTIPLIER`=1.6 (= `MATING_CHILD_SHARE` 0.8 × 2).
**Runtime:** `REFLECT_EVERY_N_BREATHS`=12 · `DECIDE_BACKOFF_SECONDS`=1.0 · world-tick interval + pace are CLI params (defaults 5.0s / 1.0s), not constants. `MOVE_DURATION_SECONDS`=2.0 *(defined, not yet enforced)*.
*(Memory/compaction dials also exist — `RETRIEVAL_K`, `MEMORY_RESIDENT_CAP`, context-window/compaction budgets — mostly irrelevant to a UI; see `core/constants.py` if needed.)*

---

## 8. Derived quantities & formulas

**Home max integrity vs. stakeholders** (`world/homes.py::max_integrity`):
`max_integrity(s) = 100 + 100 × (1 − 0.5^(s−1))` for s≥1 (s≤1 → 100).


| stakeholders | max integrity |
| ------------ | ------------- |
| 1            | 100.0         |
| 2            | 150.0         |
| 3            | 175.0         |
| 4            | 187.5         |
| 5            | 193.75        |
| 6            | 196.875       |


Asymptotes to 200 (never reaches it in practice; two 3-stakeholder homes out-defend one 6-stakeholder blob — the anti-blob property).

**Hoarding:** agent hoards if `energy ≥ 500 OR materials ≥ 300`; a home hoards if `vault_materials ≥ 300`. (OR is deliberate — either pile is notable.)

**Break-in coordination:** a home repairs +50 integrity per covered 5s window; each break-in does −25 with no mid-window healing, so **>2 break-ins per window** are needed for net progress against a funded home — plus each attempt's 15+10 pure-sink cost self-limits lone raiders. Only a hoard-tier (~300) vault repays a coordinated breach.

---

## 9. Observability & replay format

The UI has two data sources, both fed by the same event stream (`observability/event_log.py`):

### Replay: `run_<seed>.jsonl` (one JSON object per line)

```json
{"type": "...", "source": "...", "payload": {...}, "scope": "local|global|targeted|private", "region": "... or null", "target": "... or null", "timestamp": 1234.5}
```

This is the complete, durable event record and the primary input for an event-timeline
replay UI. Exact world-state replay also uses `snapshots_<seed>.jsonl` because several
mechanics are silent in the event stream (withdrawal, regeneration, upkeep draws,
non-breach break-in damage, and ruin sweep). Both files are written under `--run-dir`
(default `runs/`). A sibling `usage_<seed>.jsonl` logs per-decision token cost
`{timestamp, agent_id, model, kind("breath"|"reflection"), prompt_tokens,
completion_tokens}` (operator metric; never an event).

### Snapshot checkpoints: `snapshots_<seed>.jsonl`

Each line is strict JSON (non-finite floats are rejected) and wraps the full Layer 2b
snapshot body:

```json
{
  "schema": 1,
  "type": "world_snapshot_checkpoint",
  "reason": "world_tick",
  "run_id": "seed-7-...",
  "world_time": 1234.5,
  "event_cursor": 42,
  "snapshot": {
    "schema": 1,
    "run_id": "seed-7-...",
    "world_time": 1234.5,
    "event_cursor": 42,
    "agents": [],
    "regions": [],
    "homes": [],
    "ruins": [],
    "pending_proposals": []
  }
}
```

`reason` is `world_tick`, `manual`, or `event:<event_type>`. The runner writes a
checkpoint after `simulation_started` and other configured structural events, and
after every world-tick heartbeat. `RunContext.to_metadata(...).artifacts.snapshots`
exposes the checkpoint path for the future live API.

### Live: `FeedEventLog` ring buffer (default 512 events) — browser callers should use `read_events(cursor)` for `requested_cursor`, `oldest_cursor`, `next_cursor`, `events`, `overflow`, and `snapshot_required`. `oldest_cursor` is the earliest request cursor that can be read without loss, not the one-based cursor printed on the oldest retained event. The legacy terminal helper `new_events(cursor) → (events, new_cursor)` still exists and silently resumes at the oldest retained event if the buffer overflowed.

### Live API server: `server/app.py`

The browser-facing server runs the same simulation loops as `scripts/run.py`
inside a FastAPI/Uvicorn app without the terminal activity feed.

- `GET /api/run` returns `RunContext.to_metadata(...)`: run id, seed, status,
  world time, current event cursor, constants, and artifact paths including
  `run_<seed>.jsonl`, `usage_<seed>.jsonl`, and `snapshots_<seed>.jsonl`.
- `GET /api/world` returns the authoritative snapshot from
  `observability/snapshot.py`.
- `GET /api/events?cursor=N` returns the retained feed envelope with
  `cursor`, `oldest_cursor`, `next_cursor`, `overflow`, and `snapshot_required`.
  Each event entry is wrapped as `{cursor, event, resolved, snapshot_after}` so a
  client can animate with the feed cursor and avoid prose parsing for common
  actor/target/region/home/resource fields.
- `GET /api/events/stream?cursor=N` emits the same envelope as server-sent
  events. If `snapshot_required` is true, fetch `/api/world` and resume from that
  snapshot's `event_cursor`. The server also accepts `once=true` for a one-shot
  SSE contract smoke test.

### Reference rendering (the terminal `render_world_table`, `observability/activity_feed.py`) — a proven UI layout:

- **Agents table:** ID · Status · Energy · Materials (+ `(hoarding)`) · Region. Title shows total/alive/fallen/dead counts.
- **Regions table:** Region · Energy · Materials.
- **Homes table:** Home · Owner · Region · Status · Stakeholders · Health (`integrity/max`) · Vault (+ `(hoarding)`) · Breachers · Remnant (`—` if STANDING).

### Event → verb rendering (`render_event`): show `payload["message"]` if present (it always is today), prefixed `[{source}]`; `self_talk` renders as `[{source}] 💭 {message}`. A fallback verb map (`_EVENT_VERBS`) exists for message-less events — **but note it has 5 stale keys** (`harvest`, `move`, `look_around`, `mating_proposed`, `mating_accepted` — not real event types) and is missing `simulation_started`/`mating_proposal_timeout`/`mating_proposal_invalidated`. A UI should build its own verb/icon map keyed on the **real 28 types** in §4, use structured payload fields for mechanics, and reserve `message` for display fallback.

### Run artifacts & CLI (`scripts/run.py`)

`python scripts/run.py --provider {ollama|gemini} --seed N --duration S --pace P --world-tick-interval T --run-dir DIR`. Providers: `ollama` (local, serialized) / `gemini` (hosted, concurrent, large context). Writes `run_<seed>.jsonl` + `usage_<seed>.jsonl` + per-agent memory dirs. Emits `simulation_started` first; ends on duration/SIGINT/all-dead/collapse (no end event — infer from the run stopping).

---

## 10. UI guidance & gotchas

**Rendering model.** Treat the run as a timeline of events over a map of regions with beings and homes. Replaying `run_<seed>.jsonl` in `timestamp` order and updating per-being position (from `agent_entered_region`) + per-home state (from `home_built`/`home_started_hoarding`/`home_collapsed`/`home_breached`/etc.) gives a useful event replay. Exact world reproduction requires snapshots because silent mechanics are not represented as events. The shipped isometric replay (`scratchpad/ui_mockups/H-e2e.html`, a Canvas engine with Kenney art driven by a converted event log) remains a working visual reference, but the live frontend must use snapshots as truth.

**Gotchas (from the code):**

1. `**source` ≠ actor for four types.** `agent_died`.source = the **victim** (actor is `payload.killer_id`, with legacy `payload.killer` also present); `agent_paralyzed`.source = `"system"`; `home_collapsed`.source = the **former owner** and `payload.home_id` names the home; `simulation_started`.source = `"world"`.
2. `**target` on LOCAL events is a directed-line hint,** not routing: `attack` (→victim), `resource_transferred` (→receiver), `agent_recovered` (→revived), and `speak` when a whisper. Use it to draw an arrow between two beings even though the event was region-wide.
3. **Chained events** (§4) — group them into one visual beat (e.g. move = depart+arrive; lethal attack = strike + death + loot; breach = breached + thieved/colonized).
4. **Crossing-only hoard events.** `agent_started_hoarding`/`home_started_hoarding` fire once on the up-crossing; there's no "stopped hoarding." For a persistent "is hoarding now?" indicator, threshold the live values (≥500 energy / ≥300 materials / ≥300 vault) rather than tracking the event.
5. **Silent state changes** the UI must read from state, not events: `withdraw_from_home` (no event), the ruin sweep (no event — the ruin just vanishes), region regeneration (no event), and per-tick upkeep draws (no event — only the eventual `home_collapsed`).
6. **PRIVATE self-talk** is in the log/feed but reached no one in-world — render it as interiority (a thought bubble), distinct from `speak`.
7. **Health bar** for a home = `integrity / max_integrity(len(stakeholders))` (the max grows with stakeholders — see §8). A being's energy has no cap; a sensible bar is energy/100 clamped, with a red zone ≤ paralysis (5) and a gold "hoarding" state ≥ 500.
8. **Tone:** conflict is rare (see §1). Make homes, sharing, births, and rescues the visual heart; treat combat/breach/ruin as rare, high-drama punctuation.

---

## 11. Appendix: code map & known doc-drift

**Where things live:** actions → `tools/builtin/*.py` (+ `tools/registry.py`, `agents/tool_schemas.py`); events → `bus/events.py`, `bus/event_bus.py`, emitted across `tools/builtin/`*, `world/tick.py`, `agents/runtime.py`, `scripts/run.py`; data model → `world/agents.py`, `world/regions.py`, `world/homes.py`, `world/world.py`; constants → `core/constants.py`; observability/replay → `observability/*`; the run → `scripts/run.py`; the physics text → `agents/prompt.py`. Design intent: `docs/superpowers/specs/2026-07-01-materials-home-*.md` and `autonomous-agent-world-design.md` (§Changelog).

**Known doc-drift (code comments, not behavior — verified against runtime):**

- `KILL_ENERGY_THRESHOLD`'s docstring says "no death logic exists" — **stale**; death is live (`combat.py`, since Sprint 6).
- `AgentStatus.PARALYZED` / `ResourceTypes.ENERGY` docstrings say "at 0.0 energy" — the enforced threshold is **≤ 5.0** (`PARALYSIS_ENERGY_THRESHOLD`).
- `GENERIC_ACTION_ENERGY_COST` and `MOVE_DURATION_SECONDS` are defined but **not yet enforced** anywhere.
- The feed's `_EVENT_VERBS` has 5 stale/wrong keys and 3 missing real types (§9) — don't port it verbatim.

*This document is a snapshot of the Layer 2d checkpoint state on 2026-07-03. If mechanics change, update it alongside the design-doc changelog.*
