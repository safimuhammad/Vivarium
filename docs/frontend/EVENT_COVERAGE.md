# Vivarium Frontend Event Coverage

**Date:** 2026-07-07.
**Purpose:** Current UI coverage matrix for the 28 event types in
`docs/world-reference.md`. This tracks which UI layer makes each event perceivable
and which test path protects the contract.

## Coverage Legend

- `Presentation`: `frontend/src/app/eventPresentation.ts` has observer-facing
  label/detail copy. `frontend/src/app/eventPresentation.test.ts` covers all 28
  world-reference event types.
- `Beat`: `frontend/src/events/beatDirector.ts` groups chained mechanics when a
  later event is the better visual representative. `pass-through` means the event
  is eligible to present directly.
- `Renderer`: `frontend/src/renderer/WorldRenderer.ts` maps the event to visual
  grammar. `special` means an explicit choreography or effect branch exists.
  `bubble` means the event presents through bubble/pulse/arc primitives; many
  bubble paths also have named diagnostics rather than only generic summaries.
- `App QA`: `tests/frontend-app/world-renderer.spec.js` includes browser semantic
  fixtures and asserts the burst plus low-frequency fixture catalogs cover every
  world-reference event type.
- `Deterministic live`: `tests/frontend-live/live-mechanics-helpers.js` forces
  event coverage through the deterministic FastAPI HTTP/SSE harness, real runtime
  or builtin-tool paths, replay artifacts, retained-density assertions, and
  renderer summary diagnostics. `simulation_started` is asserted from the startup
  feed rather than the mechanics route window.

## Matrix

| Event type | Presentation | Beat | Renderer | App QA | Deterministic live |
| --- | --- | --- | --- | --- | --- |
| `agent_born` | yes | pass-through | special bond birth | yes | yes |
| `agent_decayed` | yes | pass-through | special life transition | yes | yes |
| `agent_died` | yes | grouped with attack/paralysis | special life transition | yes | yes |
| `agent_entered_region` | yes | movement winner | bubble movement arc | yes | yes |
| `agent_left_region` | yes | grouped into entered | bubble movement arc when standalone | yes | yes |
| `agent_paralyzed` | yes | grouped with attack/death | special life transition | yes | yes |
| `agent_recovered` | yes | grouped with transfer | special relight | yes | yes |
| `agent_started_hoarding` | yes | groups harvest/transfer/hearth | special hoard bubble/shimmer | yes | yes |
| `attack` | yes | grouped into death/paralysis | bubble combat arc plus impact summary when standalone | yes | yes |
| `hearth_used` | yes | groups into hoarding | special shelter use plus hearth ember | yes | yes |
| `home_breached` | yes | grouped into theft/colonize | special standalone breach bubble/shock | yes | yes |
| `home_built` | yes | pass-through | special scaffold/build | yes | yes |
| `home_collapsed` | yes | pass-through | special collapse/ruin preview | yes | yes |
| `home_colonized` | yes | breach terminal | special colonize raid | yes | yes |
| `home_joined` | yes | pass-through | special membership join | yes | yes |
| `home_left` | yes | pass-through | special membership leave | yes | yes |
| `home_started_hoarding` | yes | pass-through | special vault hoard | yes | yes |
| `home_thieved` | yes | breach terminal | special theft raid | yes | yes |
| `mating_initiated` | yes | pass-through | special bond offer | yes | yes |
| `mating_proposal_invalidated` | yes | pass-through | special broken bond/refund | yes | yes |
| `mating_proposal_timeout` | yes | pass-through | special lapsed bond/refund | yes | yes |
| `mating_rejected` | yes | pass-through | special declined bond/refund | yes | yes |
| `resource_changed` | yes | groups into hoarding | special harvest motes | yes | yes |
| `resource_transferred` | yes | grouped with recovery/hoarding | bubble resource arc plus resource-transfer diagnostics when standalone | yes | yes |
| `ruins_scavenged` | yes | pass-through | special ruin scavenge | yes | yes |
| `self_talk` | yes | pass-through | bubble thought plus thought-wisp summary | yes | yes |
| `simulation_started` | yes | pass-through | passive startup bubble/system pulse | yes | yes |
| `speak` | yes | pass-through | bubble speech plus targeted leader-line diagnostics | yes | yes |

## Current Proof Surfaces

- App-shell semantic coverage remains complete for the current 28-event catalog:
  presentation copy, event medallions, renderer specs, and browser semantic
  fixtures all cover the same world-reference set. The live-unit drift guard now
  cross-checks this matrix against the production app semantic fixture catalog
  without importing or executing the Playwright spec, and against the
  observer-facing presentation coverage catalog without importing or executing
  the Vitest spec. It also cross-checks event visual/medallion metadata coverage
  through TypeScript AST key extraction without coupling to exact glyph/accent,
  icon, or label values. The Beat column is cross-checked against explicit
  beat director groupable/participant event-type catalogs and implementation
  event-type references without coupling to payload prose, cursor numbers, or
  timing values. The Renderer column is cross-checked against explicit renderer
  grammar catalogs, `visualSpecFor()` event cases, special-effect/life-transition
  implementation branches, bespoke bubble-summary branches, production
  summary-kind literals, and renderer-facing app-spec summary catalogs without
  coupling to geometry, colors, animation timings, CSS classes, or visible copy.
  The deterministic live renderer summary diagnostic kind pools are also
  cross-checked against the explicit renderer summary-kind catalogs without
  importing browser runtime code, and deterministic required-tail summary pairs
  are validated against renderer event and summary grammar catalogs. Browser
  renderer raw-summary field assertions and deterministic live renderer
  diagnostics raw-field banlists are also cross-checked, as are renderer summary
  tuple and tuple-array field catalogs, mutation-boundary invariants, generic
  carrier identity invariants, and motion-mode invariants.
- Deterministic dev and built live smokes prove all 28 event types through real
  HTTP/SSE. The mechanics route window forces 27 event types through real runtime,
  builtin-tool, or world-tick emitters; `simulation_started` is asserted from the
  startup feed. Long-window proposal timeout, corpse decay, and home collapse use
  test-only timestamp aging, but the events still publish through the normal bus,
  replay log, and checkpoint sinks.
- Renderer diagnostics now distinguish generic visible bubble summaries from
  bespoke choreography. Remaining non-bespoke visible bubbles expose sanitized
  `generic-event-bubble` summaries instead of missing summaries, while movement,
  speech, thought, resource transfer, hoarding, startup, life transitions, bond
  lifecycle, home/hearth, raid, theft, colonize, collapse, and ruin-scavenge events
  have explicit summary grammar.
- External real-provider smoke is intentionally not an event-taxonomy coverage
  test. It proves a real provider run reaches generic observer surfaces without
  deterministic mechanics helpers: live event presentation, cursor correlation,
  renderer freshness, retained World pulse/Now cue presentation after bubble
  expiry, raw-copy hygiene, and static guard protection against fake provenance.
- Grouped beat chains now expose compact passive context on retained World pulse,
  Now cue, and selected Focus pulse surfaces while keeping the hidden grouped rows
  hidden. The app/browser coverage asserts breach-theft, strike-death,
  gift-recovery, hearth-hoard, breach-claim, and movement crossing windows through
  observer-facing chain metadata rather than duplicating hidden rows or transient
  bubble effects.
- Active CSS2D world bubbles now expose the same compact chain context on the
  representative visual beat, including DOM/debug metadata for chain
  kind/count/window/text. Browser coverage proves manual QA debug injection,
  camera/viewport bubble re-layout, breach/theft, attack/death, and movement
  crossing bubbles without adding controls, re-showing hidden grouped rows, or
  leaking raw payload prose.
- Archive/history rows now expose the same compact chain context on grouped
  representatives, including breach/theft, attack/death, and movement crossing
  windows loaded from replay artifacts. Browser coverage proves archive windows
  count visible representatives, keep hidden grouped rows out of the DOM, and
  avoid controls, dialogs, raw ids, provider/model metadata, prompts, and payload
  prose.
- Selected inspector recent-summary pills now expose compact chain context on
  grouped representatives with `data-event-chain-*` metadata and bounded visible
  chain copy. Browser coverage proves selected being/home/region summaries for
  crossing, breach/claim, breach/theft, shared/hearth hoard, and strike/death
  chains while hidden rows remain hidden, and standalone ruin summaries stay
  chain-free.
- Selected inspector recent-summary pills now expose compact event detail
  metadata/copy on visible representatives with `data-event-detail-kind/text` and
  bounded `.event-summary-detail` copy. Browser coverage proves speech, movement,
  home claim, ruin scavenge, hoard, death, theft, and startup/system selected
  summaries while full selected speech/thought prose remains in the main detail
  paragraph, grouped-chain copy stays independent, and hidden grouped rows stay
  suppressed.
- Selected inspector recent-summary coverage now includes direct mobile and
  narrow desktop proof for compact detail, grouped-chain copy, full selected
  speech/thought paragraphs, and selected-history gap rows together. Gap rows are
  asserted to remain passive without event/detail/chain/icon metadata, hidden
  grouped rows remain suppressed, compact/full-prose rows do not clip, and no
  seek/playback controls or raw observer copy appear.
- Deterministic dev and built live smokes now carry selected-structure proof for
  home/shelter/raid mechanics into the real-transport path. The live helper
  derives Joe's generated home, thieve-breach/theft, colonize-breach/claim,
  vault-hoard, and ruin-scavenge cursors from real `/api/events`, refreshes the
  app from real `/api/world`, clicks rendered home/ruin points, and proves
  selected Focus pulse plus selected recent summaries expose compact detail and
  grouped-chain metadata/copy for build, hearth/shelter, join/leave, theft,
  claim, vault hoard, and ruin scavenge while hidden `home_breached` rows remain
  suppressed.
- Deterministic dev and built live smokes now also carry selected-region proof
  for the mixed Warm Springs story into the real-transport path. The live helper
  derives exact regional speech, movement crossing, home build/hearth,
  breach/theft, breach/claim, Joe+Mae birth, ruin scavenge, corpse decay, home
  collapse, Joe-to-Mae strike/paralysis, and Joe-to-Dick death cursors from real
  `/api/events`, clicks the rendered Warm Springs region path, and proves
  selected region summaries expose compact detail and grouped-chain metadata/copy
  while hidden `attack`, movement departure, and `home_breached` rows remain
  suppressed.
- Selected-region proof now includes targeted bond lifecycle events that are
  regionless at the event level but region-relevant through participant snapshot
  positions. The deterministic dev and built live smokes derive exact Joe/Mae and
  Dick/Allen `mating_initiated`, `mating_rejected`,
  `mating_proposal_invalidated`, and `mating_proposal_timeout` cursors from real
  `/api/events`, refresh the real `/api/world` snapshot, select Warm Springs
  through rendered region hit testing, and prove offer, refusal, invalidation,
  timeout, and accepted-offer rows in the selected-region trail while hidden
  grouped regional rows remain hidden. Route-mocked app coverage proves private
  `self_talk` and truly regionless rows remain out of selected-region trails.
- Dense selected-region app coverage now stress-tests the 160-row trail across
  desktop, mobile, and low-height desktop. The route-mocked production app proof
  keeps exact mixed-story representatives readable and ordered for speech,
  structures, shelter, movement crossing, breach/theft, combat/paralysis, birth,
  ruin scavenge, decay, collapse, and targeted bond lifecycle rows, while hidden
  grouped rows and private regionless self-talk stay out.

## Drift Rules

- When `docs/world-reference.md` adds, removes, or renames an event type, update
  `eventPresentation.ts`, `eventPresentation.test.ts`,
  `frontend/src/events/beatDirector.ts`,
  `frontend/src/events/beatDirector.test.ts`,
  `frontend/src/events/eventVisualCatalog.ts`,
  `frontend/src/events/eventVisualCatalog.test.ts`,
  `frontend/src/renderer/WorldRenderer.ts` renderer grammar/summary catalogs,
  `tests/frontend-app/world-renderer.spec.js`,
  `tests/frontend-live/live-mechanics-helpers.js`, and this matrix in the same
  implementation pass.
- Do not use fallback verb-map comments or stale terminal-renderer keys as the
  event source of truth. The canonical event set is the 28-type catalog in
  `docs/world-reference.md` plus the emitted JSONL/live feed.
- Keep deterministic event-set assertions in the deterministic helpers. External
  real-provider smoke should stay provider-agnostic and must not force exact event
  types, scripted phrases, mechanics counts, route mocks, fake rows, or test-only
  routes.

## Recommended Next Slices

1. **No active implementation layer - frontend ready for Safi/user review.**
   Layer 129 established the provider-safe real-event baseline, Layer 130 made
   passive retained World pulse/Now cue surfaces show compact details for speech,
   death, theft, birth, decay, ruin, colonize, and quiet world beats, and Layer 131
   made grouped live-beat chain context visible on passive retained surfaces.
   Layer 132 extended that context to active CSS2D world bubbles, and Layer 133
   extended it to archive/history representatives. Layer 134 extended grouped
   chain context to selected inspector recent-summary pills. Layer 135 carried
   structured compact-detail metadata/copy into those selected summaries. Layer
   136 added direct mobile/narrow selected-inspector proof for compact detail,
   grouped-chain copy, full prose, and passive gap rows. Layer 137 carried the
   selected-inspector proof into deterministic real-transport browser smokes for
   Mae's real Joe-to-Mae `attack -> agent_paralyzed` chain, deriving cursors from
   `/api/events` and preserving the external provider boundary. Layer 138 carried
   selected-structure proof for house building, shelter/hearth use, breach/raid,
   theft, colonize, vault hoard, and ruin-scavenge into deterministic dev/built
   real-transport smokes. Layer 139 carried selected-region proof for the mixed
   Warm Springs story into deterministic dev/built real-transport smokes:
   speech, shelter/home, raid/theft/claim, birth/life, death/paralysis, collapse,
   decay, and ruin representatives stay coherent in the selected region trail
   while hidden grouped rows stay hidden and the external real-provider smoke
   remains generic and provider-safe. Layer 140 closed the remaining
   selected-region bond gap by adding a structured participant-position relevance
   rule for targeted bond lifecycle events, proving regionless offer, refusal,
   invalidation, timeout, and accepted-offer rows through deterministic dev/built
   real transport, and using route-mocked app coverage for private/truly
   regionless selected-region exclusion. Layer 141 added a dense 160-row
   selected-region browser proof across desktop, mobile, and low-height desktop,
   tightened that proof after review with exact responsive scroll ownership plus
   private and non-private truly regionless exclusion, fixed the app-browser
   low-height Focus pulse latest-row clipping it exposed, and hardened dense
   bubble-lane timing around the asserted drama representatives. Layer 142 refreshed the full local proof
   stack after that work: frontend unit, frontend-live unit/static, production
   build, production app browser, deterministic dev live, and deterministic
   built live passed. The refresh found one remaining retained low-height Focus
   pulse latest-row clipping case, now fixed with a 34px low-height floor.
   Layer 143 audited the frontend loop end condition against the approved vision,
   world-reference mechanics, replay boundary, and proof matrix. The audit found
   no active implementation gap: live transport, all 28 events, selected trails,
   house/shelter/raid/theft/contest/life/bond surfaces, archive/replay passive
   checkpoint preview, responsive zoom/click focus, raw-copy hygiene, and
   provider boundaries are covered. The Layer 143 reviewer found no blocker, so
   stop the autonomous frontend implementation loop and hand the UI to Safi for
   live review. Carve a new implementation layer only for a concrete future
   reviewer or user-found gap.
2. **Future event-catalog changes.** Treat any new world event type as a full
   contract change: update world reference, event presentation, medallion metadata,
   renderer grammar, app QA fixtures, deterministic live coverage, and this doc
   before claiming UI parity.
