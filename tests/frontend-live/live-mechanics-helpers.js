const { expect } = require('@playwright/test');

const {
  fetchWorldSnapshot,
  fetchJsonlArtifact,
  byField,
  expectNoBannedObserverCopy,
  expectNoLiveDiagnosticCopy,
} = require('./live-common-helpers');

const {
  LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES,
  validateMechanicsRendererSummaryDiagnostics,
} = require('./live-renderer-summary-diagnostics');

const API_PATHS = [
  '/api/run',
  '/api/world',
  '/api/events',
  '/api/events/stream',
  '/api/test/mechanics/run',
  '/api/replay/artifacts/events',
  '/api/replay/artifacts/snapshots',
];

const MECHANICS_EVENT_MIN_COUNTS = Object.freeze({
  speak: 1,
  self_talk: 1,
  resource_transferred: 1,
  agent_recovered: 1,
  home_built: 1,
  home_joined: 1,
  home_left: 1,
  hearth_used: 1,
  resource_changed: 2,
  agent_started_hoarding: 1,
  agent_left_region: 1,
  agent_entered_region: 1,
  home_breached: 2,
  home_thieved: 1,
  home_colonized: 1,
  home_started_hoarding: 1,
  ruins_scavenged: 1,
  mating_initiated: 5,
  mating_rejected: 1,
  mating_proposal_invalidated: 1,
  agent_born: 2,
  mating_proposal_timeout: 1,
  agent_decayed: 1,
  home_collapsed: 1,
  attack: 1,
  agent_paralyzed: 1,
  agent_died: 1,
});
const MECHANICS_EVENT_TYPES = Object.keys(MECHANICS_EVENT_MIN_COUNTS).sort();
const LIVE_RUN_EVENT_TYPES = [
  'simulation_started',
  ...MECHANICS_EVENT_TYPES,
];
const MECHANICS_TOOL_NAMES = [
  'speak',
  'transfer_resource',
  'build_home',
  'pledge_home',
  'leave_home',
  'use_hearth',
  'harvest_resources',
  'harvest_resources',
  'move',
  'break_in',
  'break_in',
  'deposit_to_home',
  'scavenge_ruins',
  'initiate_mating',
  'reject_mating',
  'initiate_mating',
  'initiate_mating',
  'accept_mating',
  'accept_mating',
  'initiate_mating',
  'accept_mating',
  'initiate_mating',
  'attack',
  'attack',
];
const STRUCTURAL_MECHANICS_REASON_MIN_COUNTS = Object.freeze({
  'event:agent_recovered': 1,
  'event:home_built': 1,
  'event:home_joined': 1,
  'event:home_left': 1,
  'event:home_breached': 2,
  'event:home_thieved': 1,
  'event:home_colonized': 1,
  'event:home_started_hoarding': 1,
  'event:ruins_scavenged': 1,
  'event:mating_initiated': 5,
  'event:mating_rejected': 1,
  'event:mating_proposal_invalidated': 1,
  'event:agent_born': 2,
  'event:mating_proposal_timeout': 1,
  'event:agent_decayed': 1,
  'event:home_collapsed': 1,
  'event:agent_paralyzed': 1,
  'event:agent_died': 1,
});
const STRUCTURAL_MECHANICS_REASONS = Object.keys(STRUCTURAL_MECHANICS_REASON_MIN_COUNTS).sort();
const MECHANICS_CHRONICLE_ROWS = [];
function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function expectMinimumCounts(values, expectedCounts, label) {
  const actualCounts = countValues(values);
  for (const [value, minimum] of Object.entries(expectedCounts)) {
    expect(
      actualCounts[value] ?? 0,
      `${label} should include at least ${minimum} ${value} row(s)`,
    ).toBeGreaterThanOrEqual(minimum);
  }
}

function findJoeWarmSpringsHome(snapshot) {
  const joe = byField(snapshot.agents ?? [], 'id', 'wanderer_001');
  const joeHome = (snapshot.homes ?? []).find((home) => (
    home.owner_id === 'wanderer_001' &&
    home.region === 'warm_springs' &&
    home.stakeholders?.includes('wanderer_001')
  ));
  return { joe, joeHome };
}

function expectThievedJoeHomeAftermath(snapshot) {
  const { joe, joeHome } = findJoeWarmSpringsHome(snapshot);
  expect(joe).toBeTruthy();
  expect(joeHome).toBeTruthy();
  expect(joe.home_id).toBe(joeHome.home_id);
  expect(joeHome.status).toBe('standing');
  expect(joeHome.vault_materials).toBe(0);
  expect(Number.isFinite(joeHome.integrity)).toBe(true);
  expect(Number.isFinite(joeHome.max_integrity)).toBe(true);
  expect(joeHome.integrity).toBeGreaterThanOrEqual(0);
  expect(joeHome.integrity).toBeLessThanOrEqual(joeHome.max_integrity);
  expect(joeHome.breachers).toContain('wanderer_003');
  return joeHome;
}

function expectMechanicsTheftReplayProof(mechanicsEventRows, mechanicsSnapshotRows) {
  const thieveBreachEvent = mechanicsEventRows.find((row) => (
    row.type === 'home_breached' &&
    row.region === 'warm_springs' &&
    row.payload?.intent === 'thieve' &&
    row.payload?.breacher_id === 'wanderer_003' &&
    row.payload?.region === 'warm_springs' &&
    row.payload?.integrity === 0 &&
    row.payload?.breachers?.includes('wanderer_003')
  ));
  expect(
    thieveBreachEvent,
    'mechanics replay events should include the deterministic thieve breach',
  ).toBeTruthy();

  const breachedHomeId = thieveBreachEvent.payload.home_id;
  const thievedEvent = mechanicsEventRows.find((row) => (
    row.type === 'home_thieved' &&
    row.region === 'warm_springs' &&
    row.payload?.home_id === breachedHomeId &&
    row.payload?.intent === 'thieve' &&
    row.payload?.breacher_id === 'wanderer_003' &&
    row.payload?.region === 'warm_springs' &&
    row.payload?.vault_materials === 0 &&
    row.payload?.integrity === 0 &&
    row.payload?.loot?.materials > 0 &&
    row.payload?.recipients?.includes('wanderer_003')
  ));
  expect(
    thievedEvent,
    'mechanics replay events should include the deterministic home theft',
  ).toBeTruthy();
  expect(
    thievedEvent.cursor,
    'deterministic home theft should be recorded after the thieve breach',
  ).toBeGreaterThan(thieveBreachEvent.cursor);

  const thievedCheckpoint = mechanicsSnapshotRows.find((row) => (
    row.reason === 'event:home_thieved' &&
    row.event_cursor === thievedEvent.cursor
  ));
  expect(
    thievedCheckpoint,
    'mechanics replay snapshots should include the home_thieved checkpoint',
  ).toBeTruthy();

  const snapshot = thievedCheckpoint.snapshot;
  const { joe, joeHome } = findJoeWarmSpringsHome(snapshot);
  expect(joe).toBeTruthy();
  expect(joeHome).toBeTruthy();
  expect(joe.home_id).toBe(breachedHomeId);
  expect(joeHome.home_id).toBe(breachedHomeId);
  expect(joeHome.status).toBe('standing');
  expect(joeHome.vault_materials).toBe(0);
  expect(joeHome.integrity).toBe(0);
  expect(joeHome.breachers).toContain('wanderer_003');
}

async function triggerMechanicsBurst(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/test/mechanics/run', {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  });
}

function expectMechanicsWorldAftermath(beforeWorld, afterWorld, burst) {
  expect(beforeWorld.ok).toBe(true);
  expect(beforeWorld.status).toBe(200);
  expect(afterWorld.ok).toBe(true);
  expect(afterWorld.status).toBe(200);
  expect(afterWorld.body.schema).toBe(1);
  expect(afterWorld.body.event_cursor).toBeGreaterThanOrEqual(burst.body.end_cursor);

  const beforeWarmSprings = byField(beforeWorld.body.regions, 'name', 'warm_springs');
  const afterWarmSprings = byField(afterWorld.body.regions, 'name', 'warm_springs');
  expect(beforeWarmSprings).toBeTruthy();
  expect(afterWarmSprings).toBeTruthy();
  expect(afterWarmSprings.current_energy).toBeLessThan(beforeWarmSprings.current_energy);

  const joe = byField(afterWorld.body.agents, 'id', 'wanderer_001');
  const mae = byField(afterWorld.body.agents, 'id', 'wanderer_002');
  const dick = byField(afterWorld.body.agents, 'id', 'wanderer_003');
  expect(joe).toMatchObject({
    id: 'wanderer_001',
    position: 'warm_springs',
    status: 'alive',
  });
  expect(mae).toMatchObject({
    id: 'wanderer_002',
    position: 'warm_springs',
    status: 'paralyzed',
  });
  expect(mae.energy).toBeLessThanOrEqual(5);
  expect(dick).toMatchObject({
    id: 'wanderer_003',
    position: 'warm_springs',
    status: 'dead',
  });

  expectThievedJoeHomeAftermath(afterWorld.body);

  const colonizedHome = byField(afterWorld.body.homes, 'home_id', 'test_colonize_home');
  expect(colonizedHome).toMatchObject({
    owner_id: 'wanderer_003',
    region: 'warm_springs',
    status: 'standing',
  });
  expect(colonizedHome.vault_materials).toBeGreaterThanOrEqual(300);

  const scavengedRuin = byField(afterWorld.body.ruins, 'home_id', 'test_ruin_home');
  expect(scavengedRuin).toMatchObject({
    owner_id: 'wanderer_002',
    region: 'warm_springs',
    status: 'ruin',
  });
  expect(scavengedRuin.remnant_materials).toBeGreaterThan(0);

  const collapsedRuin = byField(afterWorld.body.ruins, 'home_id', 'test_collapse_home');
  expect(collapsedRuin).toMatchObject({
    owner_id: 'wanderer_004',
    region: 'warm_springs',
    status: 'ruin',
  });
  expect(collapsedRuin.remnant_materials).toBeGreaterThan(0);
  expect(byField(afterWorld.body.agents, 'id', 'test_decayed_agent')).toBeUndefined();
  expect(afterWorld.body.agents.length).toBeGreaterThan(beforeWorld.body.agents.length);
  expect(afterWorld.body.pending_proposals).toEqual([]);
}

async function expectMechanicsReplayArtifacts(page, burst) {
  const eventsArtifact = await fetchJsonlArtifact(page, '/api/replay/artifacts/events');
  expect(eventsArtifact.ok).toBe(true);
  expect(eventsArtifact.status).toBe(200);
  expect(eventsArtifact.contentType).toContain('application/x-ndjson');
  const mechanicsEventRows = eventsArtifact.rows.filter((row) => (
    row.cursor > burst.body.start_cursor && row.cursor <= burst.body.end_cursor
  ));
  const mechanicsEventTypes = mechanicsEventRows.map((row) => row.type);
  expect(uniqueSorted(mechanicsEventTypes)).toEqual(MECHANICS_EVENT_TYPES);
  expectMinimumCounts(mechanicsEventTypes, MECHANICS_EVENT_MIN_COUNTS, 'mechanics replay events');

  const snapshotsArtifact = await fetchJsonlArtifact(page, '/api/replay/artifacts/snapshots');
  expect(snapshotsArtifact.ok).toBe(true);
  expect(snapshotsArtifact.status).toBe(200);
  expect(snapshotsArtifact.contentType).toContain('application/x-ndjson');
  const mechanicsSnapshotRows = snapshotsArtifact.rows.filter((row) => (
    row.event_cursor > burst.body.start_cursor && row.event_cursor <= burst.body.end_cursor
  ));
  const mechanicsStructuralReasons = mechanicsSnapshotRows
    .map((row) => row.reason)
    .filter((reason) => STRUCTURAL_MECHANICS_REASONS.includes(reason));
  expect(uniqueSorted(mechanicsStructuralReasons)).toEqual(STRUCTURAL_MECHANICS_REASONS);
  expectMinimumCounts(
    mechanicsStructuralReasons,
    STRUCTURAL_MECHANICS_REASON_MIN_COUNTS,
    'mechanics replay structural snapshots',
  );

  expectMechanicsTheftReplayProof(mechanicsEventRows, mechanicsSnapshotRows);

  const paralyzedCheckpoint = [...mechanicsSnapshotRows]
    .reverse()
    .find((row) => row.reason === 'event:agent_paralyzed');
  expect(paralyzedCheckpoint).toBeTruthy();
  const snapshot = paralyzedCheckpoint.snapshot;
  const mae = byField(snapshot.agents, 'id', 'wanderer_002');
  const joeHome = snapshot.homes.find((home) => home.owner_id === 'wanderer_001');
  expect(mae.status).toBe('paralyzed');
  expect(snapshot.pending_proposals).toEqual([]);
  expect(joeHome.vault_materials).toBe(0);
  expect(joeHome.breachers).toContain('wanderer_003');
}

async function expectMechanicsBurstVisible(page, burst) {
  expect(burst.ok).toBe(true);
  expect(burst.status).toBe(200);
  expect(burst.body.schema).toBe(1);
  expect(burst.body.tools.map((tool) => tool.tool)).toEqual(MECHANICS_TOOL_NAMES);
  expect(burst.body.tools.every((tool) => tool.ok)).toBe(true);
  expect(uniqueSorted(burst.body.event_types)).toEqual(MECHANICS_EVENT_TYPES);
  expectMinimumCounts(
    burst.body.event_types,
    MECHANICS_EVENT_MIN_COUNTS,
    'mechanics burst event types',
  );
  expect(burst.body.end_cursor).toBeGreaterThan(burst.body.start_cursor);

  await page.waitForFunction((endCursor) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return (diagnostics?.eventCursor ?? 0) >= endCursor;
  }, burst.body.end_cursor, { timeout: 15000 });

  await expectMechanicsRendererSummaryDiagnostics(page, burst);

  for (const row of MECHANICS_CHRONICLE_ROWS) {
    await expect(page.locator('.chronicle')).toContainText(row, { timeout: 15000 });
  }
}

async function expectMechanicsSelectedInspectorAfterBurst(page, burst) {
  expect(burst.ok).toBe(true);
  expect(burst.status).toBe(200);
  expect(burst.body.end_cursor).toBeGreaterThan(burst.body.start_cursor);

  await page.waitForFunction((endCursor) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return (diagnostics?.eventCursor ?? 0) >= endCursor;
  }, burst.body.end_cursor, { timeout: 15000 });

  const chain = findMechanicsParalysisChain(
    await fetchMechanicsWindowEvents(page, burst),
    burst.body,
  );

  await openMechanicsWorldSurface(page);
  const maeRow = page.locator('.presence-rail .agent-row').filter({
    has: page.locator('.agent-name', { hasText: /^Mae$/ }),
  });
  await expect(maeRow).toHaveCount(1, { timeout: 10000 });
  await expect(maeRow).toBeVisible();
  await maeRow.click();

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toBeVisible();
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'wanderer_002', {
    timeout: 10000,
  });
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'agent_paralyzed');
  await expect(focusPulse).toHaveAttribute(
    'data-focus-retained-event-cursor',
    String(chain.paralyzedCursor),
  );

  const focusLatest = focusPulse.locator('[data-focus-pulse-latest="true"]');
  await expect(focusLatest).toBeVisible();
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-type', 'agent_paralyzed');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-cursor', String(chain.paralyzedCursor));
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-kind', 'life-fallen');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-text', 'Mae falls');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-kind', 'strike-fall');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-count', '2');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-window', chain.chainWindow);
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-text', 'after strike');
  await expect(focusLatest.locator('.focus-pulse-latest-copy')).toBeVisible();
  await expect(focusLatest.locator('.focus-pulse-latest-copy small')).toBeVisible();
  await expect(focusLatest.locator('.focus-pulse-latest-copy small')).toHaveText('Mae falls');
  await expect(focusLatest.locator('.focus-pulse-latest-copy em')).toBeVisible();
  await expect(focusLatest.locator('.focus-pulse-latest-copy em')).toHaveText('after strike');

  const selectedParalysis = page.locator(
    `.inspector-recent .event-summary[data-event-type="agent_paralyzed"][data-event-cursor="${chain.paralyzedCursor}"]`,
  );
  await expect(selectedParalysis).toBeVisible({ timeout: 10000 });
  await expect(selectedParalysis).toHaveAttribute('data-event-detail-kind', 'life-fallen');
  await expect(selectedParalysis).toHaveAttribute('data-event-detail-text', 'Mae falls');
  await expect(selectedParalysis).toHaveAttribute('data-event-chain-kind', 'strike-fall');
  await expect(selectedParalysis).toHaveAttribute('data-event-chain-count', '2');
  await expect(selectedParalysis).toHaveAttribute('data-event-chain-window', chain.chainWindow);
  await expect(selectedParalysis).toHaveAttribute('data-event-chain-text', 'after strike');
  await expect(selectedParalysis.locator('.event-summary-detail')).toHaveText('Mae falls');
  await expect(selectedParalysis.locator('.event-summary-chain')).toHaveText('after strike');
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="attack"][data-event-cursor="${chain.attackCursor}"]`,
  )).toHaveCount(0);

  const state = await collectMechanicsRetainedDensityState(
    page,
    burst,
    await collectArchiveDataAttributes(page),
  );
  const failures = validateMechanicsSelectedInspectorState(state);
  expect(
    failures,
    formatMechanicsSelectedInspectorStateFailure(failures, state),
  ).toEqual([]);
}

async function expectMechanicsSelectedRegionAfterBurst(page, burst) {
  expect(burst.ok).toBe(true);
  expect(burst.status).toBe(200);
  expect(burst.body.end_cursor).toBeGreaterThan(burst.body.start_cursor);

  await page.waitForFunction((endCursor) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return (diagnostics?.eventCursor ?? 0) >= endCursor;
  }, burst.body.end_cursor, { timeout: 15000 });

  const trail = findMechanicsRegionTrail(
    await fetchMechanicsWindowEvents(page, burst),
    burst.body,
  );

  await waitForMechanicsSnapshotApplied(page, burst, 'selected-region targeted bond relevance');
  await selectMechanicsRegion(page, 'warm_springs');

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toBeVisible();
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'region');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', 'warm_springs');
  await expect(focusPulse).toHaveAttribute('data-focus-retention-state', 'retained');
  await expect(focusPulse.locator('[data-focus-group="bond"]')).toBeVisible();

  const focusLatest = focusPulse.locator('[data-focus-pulse-latest="true"]');
  await expect(focusLatest).toBeVisible();
  await expect(focusLatest).not.toHaveAttribute('data-focus-pulse-event-type', 'none');
  await expect(focusLatest).not.toHaveAttribute('data-focus-pulse-detail-kind', 'none');

  await expectSelectedEventSummary(page, {
    cursor: trail.rejectedOfferCursor,
    type: 'mating_initiated',
    detailKind: 'bond-call',
    detailText: 'to Mae',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.rejectedCursor,
    type: 'mating_rejected',
    detailKind: 'bond-refused',
    detailText: 'Mae turns away',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.invalidatedOfferCursor,
    type: 'mating_initiated',
    detailKind: 'bond-call',
    detailText: 'to Mae',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.invalidatedCursor,
    type: 'mating_proposal_invalidated',
    detailKind: 'bond-faded',
    detailText: 'bond thread fades',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.timeoutOfferCursor,
    type: 'mating_initiated',
    detailKind: 'bond-call',
    detailText: 'to Allen',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.timeoutCursor,
    type: 'mating_proposal_timeout',
    detailKind: 'bond-faded',
    detailText: 'bond thread fades',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.acceptedOfferCursor,
    type: 'mating_initiated',
    detailKind: 'bond-call',
    detailText: 'to Mae',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.speechCursor,
    type: 'speak',
    detailKind: 'open-speech',
    detailText: 'heard in warm springs',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.deathCursor,
    type: 'agent_died',
    detailKind: 'death',
    detailText: 'felled by Joe',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.paralyzedCursor,
    type: 'agent_paralyzed',
    detailKind: 'life-fallen',
    detailText: 'Mae falls',
    chainKind: 'strike-fall',
    chainCount: 2,
    chainWindow: trail.paralysisChainWindow,
    chainText: 'after strike',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.collapsedCursor,
    type: 'home_collapsed',
    detailKind: 'home-crumbled',
    detailText: 'hearth crumbles',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.decayedCursor,
    type: 'agent_decayed',
    detailKind: 'decay',
    detailText: 'Faded Witness returns',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.birthCursor,
    type: 'agent_born',
    detailKind: 'birth',
    detailText: 'child of Joe and Mae',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.colonizedCursor,
    type: 'home_colonized',
    detailKind: 'home-seized',
    detailText: 'Dick claims the hearth',
    chainKind: 'breach-claim',
    chainCount: 2,
    chainWindow: trail.colonizeChainWindow,
    chainText: 'after breach',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.thievedCursor,
    type: 'home_thieved',
    detailKind: 'theft',
    detailText: `${formatMechanicsResourceCount(trail.theftMaterials)} materials taken`,
    chainKind: 'breach-theft',
    chainCount: 2,
    chainWindow: trail.theftChainWindow,
    chainText: 'after breach',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.scavengeCursor,
    type: 'ruins_scavenged',
    detailKind: 'ruin-scavenge',
    detailText: `${formatMechanicsResourceCount(trail.scavengeMaterials)} materials gathered`,
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.movementEnteredCursor,
    type: 'agent_entered_region',
    detailKind: 'movement-arrival',
    detailText: 'from nirvana',
    chainKind: 'crossing',
    chainCount: 2,
    chainWindow: trail.movementChainWindow,
    chainText: 'crossing complete',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.hearthCursor,
    type: 'hearth_used',
    detailKind: 'shelter-taken',
    detailText: 'Joe takes shelter',
  }, { timeout: 2500 });
  await expectSelectedEventSummary(page, {
    cursor: trail.buildCursor,
    type: 'home_built',
    detailKind: 'home-raised',
    detailText: 'Joe raises shelter',
  }, { timeout: 2500 });
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="home_breached"][data-event-cursor="${trail.thieveBreachCursor}"]`,
  )).toHaveCount(0);
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="home_breached"][data-event-cursor="${trail.colonizeBreachCursor}"]`,
  )).toHaveCount(0);
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="attack"][data-event-cursor="${trail.attackCursor}"]`,
  )).toHaveCount(0);
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="agent_left_region"][data-event-cursor="${trail.movementLeftCursor}"]`,
  )).toHaveCount(0);
  await expect(page.locator('.focus-pulse button, .focus-pulse select')).toHaveCount(0);
  await expect(page.locator('.focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]')).toHaveCount(0);
  await expect(page.locator('.inspector-recent button')).toHaveCount(0);
  await expect(page.locator('.inspector-recent dialog')).toHaveCount(0);
  await expect(page.locator('.inspector-recent [role="dialog"]')).toHaveCount(0);
}

async function expectMechanicsSelectedStructuresAfterBurst(page, burst) {
  expect(burst.ok).toBe(true);
  expect(burst.status).toBe(200);
  expect(burst.body.end_cursor).toBeGreaterThan(burst.body.start_cursor);

  await page.waitForFunction((endCursor) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return (diagnostics?.eventCursor ?? 0) >= endCursor;
  }, burst.body.end_cursor, { timeout: 15000 });

  const structure = findMechanicsStructureChains(
    await fetchMechanicsWindowEvents(page, burst),
    burst.body,
  );

  await waitForMechanicsStructuresMaterialized(page, burst, structure);
  await focusMechanicsRegion(page, 'warm_springs');
  await expectSelectedJoeHomeTrail(page, structure);
  await expectSelectedColonizedHomeTrail(page, structure);
  await expectSelectedRuinTrail(page, structure);
}

async function waitForMechanicsStructuresMaterialized(page, burst, structure) {
  await waitForMechanicsSnapshotApplied(page, burst, 'selected structures');

  await page.waitForFunction(({ endCursor, homeIds }) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    if ((diagnostics?.lastAcceptedSnapshotCursor ?? 0) < endCursor) {
      return false;
    }
    return homeIds.every((homeId) => {
      const point = window.__vivariumWorld?.screenPointForHome?.(homeId);
      return Boolean(
        point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y)
      );
    });
  }, {
    endCursor: burst.body.end_cursor,
    homeIds: [
      structure.joeHomeId,
      structure.colonizeHomeId,
      structure.ruinHomeId,
    ],
  }, { timeout: 35000 });
}

async function waitForMechanicsSnapshotApplied(page, burst, label) {
  const refresh = await page.evaluate(async (endCursor) => {
    const liveRun = window.__vivariumLiveRun;
    if (!liveRun?.refreshSnapshotForTest) {
      return {
        ok: false,
        reason: 'missing-refresh-hook',
        before: liveRun?.diagnostics?.() ?? null,
        after: null,
      };
    }
    const before = liveRun.diagnostics();
    await liveRun.refreshSnapshotForTest();
    const after = liveRun.diagnostics();
    return {
      ok: (
        after.lastSnapshotRefresh.status === 'applied' &&
        (after.lastAcceptedSnapshotCursor ?? 0) >= endCursor
      ),
      reason: after.lastSnapshotRefresh.status,
      before,
      after,
    };
  }, burst.body.end_cursor);
  expect(
    refresh.ok,
    `mechanics live smoke should apply a fresh world snapshot for ${label}: ${JSON.stringify(refresh)}`,
  ).toBe(true);
}

async function expectSelectedJoeHomeTrail(page, structure) {
  await selectMechanicsHome(page, structure.joeHomeId, { focusKind: 'home' });

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'home_thieved');
  await expect(focusPulse).toHaveAttribute(
    'data-focus-retained-event-cursor',
    String(structure.thievedCursor),
  );

  const focusLatest = focusPulse.locator('[data-focus-pulse-latest="true"]');
  await expect(focusLatest).toBeVisible();
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-type', 'home_thieved');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-cursor', String(structure.thievedCursor));
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-kind', 'theft');
  await expect(focusLatest).toHaveAttribute(
    'data-focus-pulse-detail-text',
    `${formatMechanicsResourceCount(structure.theftMaterials)} materials taken`,
  );
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-kind', 'breach-theft');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-count', '2');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-window', structure.theftChainWindow);
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-chain-text', 'after breach');
  await expect(focusLatest.locator('.focus-pulse-latest-copy small')).toHaveText(
    `${formatMechanicsResourceCount(structure.theftMaterials)} materials taken`,
  );
  await expect(focusLatest.locator('.focus-pulse-latest-copy em')).toHaveText('after breach');

  await expectSelectedEventSummary(page, {
    cursor: structure.thievedCursor,
    type: 'home_thieved',
    detailKind: 'theft',
    detailText: `${formatMechanicsResourceCount(structure.theftMaterials)} materials taken`,
    chainKind: 'breach-theft',
    chainCount: 2,
    chainWindow: structure.theftChainWindow,
    chainText: 'after breach',
  });
  await expectSelectedEventSummary(page, {
    cursor: structure.hearthCursor,
    type: 'hearth_used',
    detailKind: 'shelter-taken',
    detailText: 'Joe takes shelter',
  });
  await expectSelectedEventSummary(page, {
    cursor: structure.leftCursor,
    type: 'home_left',
    detailKind: 'shelter-left',
    detailText: 'Mae leaves the hearth',
  });
  await expectSelectedEventSummary(page, {
    cursor: structure.joinedCursor,
    type: 'home_joined',
    detailKind: 'shelter-joined',
    detailText: 'Mae joins the hearth',
  });
  await expectSelectedEventSummary(page, {
    cursor: structure.buildCursor,
    type: 'home_built',
    detailKind: 'home-raised',
    detailText: 'Joe raises shelter',
  });
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="home_breached"][data-event-cursor="${structure.thieveBreachCursor}"]`,
  )).toHaveCount(0);
}

async function expectSelectedColonizedHomeTrail(page, structure) {
  await selectMechanicsHome(page, structure.colonizeHomeId, { focusKind: 'home' });

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'home_started_hoarding');
  await expect(focusPulse).toHaveAttribute(
    'data-focus-retained-event-cursor',
    String(structure.hoardCursor),
  );

  const focusLatest = focusPulse.locator('[data-focus-pulse-latest="true"]');
  await expect(focusLatest).toBeVisible();
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-type', 'home_started_hoarding');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-cursor', String(structure.hoardCursor));
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-kind', 'vault-hoard');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-text', 'vault grows heavy');

  await expectSelectedEventSummary(page, {
    cursor: structure.hoardCursor,
    type: 'home_started_hoarding',
    detailKind: 'vault-hoard',
    detailText: 'vault grows heavy',
  });
  await expectSelectedEventSummary(page, {
    cursor: structure.colonizedCursor,
    type: 'home_colonized',
    detailKind: 'home-seized',
    detailText: 'Dick claims the hearth',
    chainKind: 'breach-claim',
    chainCount: 2,
    chainWindow: structure.colonizeChainWindow,
    chainText: 'after breach',
  });
  await expect(page.locator(
    `.inspector-recent .event-summary[data-event-type="home_breached"][data-event-cursor="${structure.colonizeBreachCursor}"]`,
  )).toHaveCount(0);
}

async function expectSelectedRuinTrail(page, structure) {
  await selectMechanicsHome(page, structure.ruinHomeId, { focusKind: 'ruin' });

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  await expect(focusPulse).toHaveAttribute('data-focus-retained-event-type', 'ruins_scavenged');
  await expect(focusPulse).toHaveAttribute(
    'data-focus-retained-event-cursor',
    String(structure.scavengeCursor),
  );

  const focusLatest = focusPulse.locator('[data-focus-pulse-latest="true"]');
  await expect(focusLatest).toBeVisible();
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-type', 'ruins_scavenged');
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-event-cursor', String(structure.scavengeCursor));
  await expect(focusLatest).toHaveAttribute('data-focus-pulse-detail-kind', 'ruin-scavenge');
  await expect(focusLatest).toHaveAttribute(
    'data-focus-pulse-detail-text',
    `${formatMechanicsResourceCount(structure.scavengeMaterials)} materials gathered`,
  );

  await expectSelectedEventSummary(page, {
    cursor: structure.scavengeCursor,
    type: 'ruins_scavenged',
    detailKind: 'ruin-scavenge',
    detailText: `${formatMechanicsResourceCount(structure.scavengeMaterials)} materials gathered`,
  });
}

async function focusMechanicsRegion(page, regionName) {
  const focused = await page.evaluate((name) => (
    window.__vivariumWorld?.focusRegion?.(name) ?? false
  ), regionName);
  expect(focused, `mechanics live smoke should focus ${regionName}`).toBe(true);
}

async function selectMechanicsRegion(page, regionName) {
  await focusMechanicsRegion(page, regionName);

  await page.waitForFunction((name) => {
    const point = window.__vivariumWorld?.screenPointForRegion?.(name);
    const stage = document.querySelector('[data-testid="world-stage"]')?.getBoundingClientRect();
    return Boolean(
      point &&
        stage &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= stage.left &&
        point.x <= stage.right &&
        point.y >= stage.top &&
        point.y <= stage.bottom
      );
  }, regionName, { timeout: 10000 });

  const selected = await clickMechanicsRegionUntilSelected(page, regionName);
  expect(
    selected,
    `mechanics live smoke should select rendered region ${regionName}`,
  ).toBe(true);
  await expect(page.locator('.inspector strong')).toHaveText('warm springs');
}

async function clickMechanicsRegionUntilSelected(page, regionName) {
  const offsets = [
    [0, 0],
    [-90, 0],
    [90, 0],
    [0, -70],
    [0, 70],
    [-120, -45],
    [120, -45],
    [-120, 45],
    [120, 45],
  ];
  for (const [dx, dy] of offsets) {
    const point = await page.evaluate((name) => window.__vivariumWorld?.screenPointForRegion?.(name), regionName);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector('[data-testid="world-stage"] canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        return;
      }
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }));
      canvas.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        clientX: x,
        clientY: y,
      }));
    }, { x: point.x + dx, y: point.y + dy });
    const selected = await page.waitForFunction((name) => {
      const pulse = document.querySelector('[data-testid="selected-focus-activity-pulse"]');
      return (
        pulse?.getAttribute('data-focus-selection-kind') === 'region' &&
        pulse?.getAttribute('data-focus-selection-id') === name
      );
    }, regionName, { timeout: 500 }).then(() => true).catch(() => false);
    if (selected) {
      return true;
    }
  }
  return false;
}

async function selectMechanicsHome(page, homeId, { focusKind }) {
  const focused = await page.evaluate((id) => (
    window.__vivariumWorld?.focusHome?.(id) ?? false
  ), homeId);
  expect(focused, `mechanics live smoke should focus home ${homeId}`).toBe(true);

  await page.waitForFunction((id) => {
    const point = window.__vivariumWorld?.screenPointForHome?.(id);
    const stage = document.querySelector('[data-testid="world-stage"]')?.getBoundingClientRect();
    return Boolean(
      point &&
        stage &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= stage.left &&
        point.x <= stage.right &&
        point.y >= stage.top &&
        point.y <= stage.bottom
      );
  }, homeId, { timeout: 10000 });

  const focusPulse = page.getByTestId('selected-focus-activity-pulse');
  const selected = await clickMechanicsHomeUntilSelected(page, homeId);
  expect(
    selected,
    `mechanics live smoke should select rendered home ${homeId}`,
  ).toBe(true);
  await expect(focusPulse).toBeVisible();
  await expect(focusPulse).toHaveAttribute('data-focus-state', 'active');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-kind', 'home');
  await expect(focusPulse).toHaveAttribute('data-focus-selection-id', homeId, {
    timeout: 10000,
  });
  await expect(focusPulse).toHaveAttribute('data-focus-kind', focusKind);
}

async function clickMechanicsHomeUntilSelected(page, homeId) {
  const offsets = [
    [0, 0],
    [-18, 0],
    [18, 0],
    [0, -18],
    [0, 18],
    [-24, -14],
    [24, -14],
    [-24, 14],
    [24, 14],
    [-36, 0],
    [36, 0],
  ];
  for (const [dx, dy] of offsets) {
    const point = await page.evaluate((id) => window.__vivariumWorld?.screenPointForHome?.(id), homeId);
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      continue;
    }
    await page.mouse.click(point.x + dx, point.y + dy);
    const selected = await page.waitForFunction((id) => (
      document
        .querySelector('[data-testid="selected-focus-activity-pulse"]')
        ?.getAttribute('data-focus-selection-id') === id
    ), homeId, { timeout: 500 }).then(() => true).catch(() => false);
    if (selected) {
      return true;
    }
  }
  return false;
}

async function expectSelectedEventSummary(page, expected, options = {}) {
  const timeout = options.timeout ?? 10000;
  const summary = page.locator(
    `.inspector-recent .event-summary[data-event-type="${expected.type}"][data-event-cursor="${expected.cursor}"]`,
  );
  await expect(summary).toBeVisible({ timeout });
  await expect(summary).toHaveAttribute('data-event-detail-kind', expected.detailKind);
  await expect(summary).toHaveAttribute('data-event-detail-text', expected.detailText);
  await expect(summary.locator('.event-summary-detail')).toHaveText(expected.detailText);
  if (expected.chainKind) {
    await expect(summary).toHaveAttribute('data-event-chain-kind', expected.chainKind);
    await expect(summary).toHaveAttribute('data-event-chain-count', String(expected.chainCount));
    await expect(summary).toHaveAttribute('data-event-chain-window', expected.chainWindow);
    await expect(summary).toHaveAttribute('data-event-chain-text', expected.chainText);
    await expect(summary.locator('.event-summary-chain')).toHaveText(expected.chainText);
  } else {
    await expect(summary).toHaveAttribute('data-event-chain-kind', 'none');
    await expect(summary).toHaveAttribute('data-event-chain-count', '0');
    await expect(summary).toHaveAttribute('data-event-chain-window', 'none');
    await expect(summary).toHaveAttribute('data-event-chain-text', 'none');
    await expect(summary.locator('.event-summary-chain')).toHaveCount(0);
  }
}

async function expectMechanicsRetainedDensityAfterBubblesExpire(page, burst) {
  expect(burst.ok).toBe(true);
  expect(burst.status).toBe(200);
  expect(burst.body.end_cursor).toBeGreaterThan(burst.body.start_cursor);

  const archiveAttributesBeforeExpiry = await collectArchiveDataAttributes(page);
  await openMechanicsChronicleSurface(page);

  await page.waitForFunction(({ startCursor, endCursor }) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    const world = window.__vivariumWorld;
    if (
      !diagnostics ||
      !world?.activeEffects ||
      !world?.renderedEventCursors ||
      (diagnostics.eventCursor ?? 0) < endCursor
    ) {
      return false;
    }

    const mechanicsBubbleCount = Array.from(document.querySelectorAll('.viv-event-bubble'))
      .filter((bubble) => {
        const cursor = Number(bubble.getAttribute('data-event-cursor'));
        return Number.isFinite(cursor) && cursor > startCursor && cursor <= endCursor;
      }).length;
    const mechanicsBubbleEffects = world.activeEffects().filter((effect) => {
      const cursor = Number(effect.bubble?.cursor);
      return Number.isFinite(cursor) && cursor > startCursor && cursor <= endCursor;
    }).length;
    const chronicleRows = Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]'));
    const mechanicsRows = chronicleRows.filter((row) => {
      const cursor = Number(row.getAttribute('data-event-cursor'));
      return (
        Number.isFinite(cursor) &&
        cursor > startCursor &&
        cursor <= endCursor &&
        Boolean(row.getAttribute('data-event-type')) &&
        Boolean(row.getAttribute('data-event-group')) &&
        Boolean(row.getAttribute('data-event-tone'))
      );
    });
    const renderedCursors = new Set(world.renderedEventCursors());
    const renderedMechanicsRow = mechanicsRows.some((row) => (
      renderedCursors.has(Number(row.getAttribute('data-event-cursor')))
    ));
    const livePulse = document.querySelector('[data-testid="live-pulse"]');
    const liveNow = document.querySelector('[data-testid="live-now"]');
    return (
      diagnostics.connection === 'live' &&
      diagnostics.stream?.active === true &&
      mechanicsBubbleCount === 0 &&
      mechanicsBubbleEffects === 0 &&
      mechanicsRows.length > 0 &&
      renderedMechanicsRow &&
      livePulse?.getAttribute('data-pulse-retention-state') === 'retained' &&
      livePulse?.getAttribute('data-pulse-retained-event-cursor') !== 'none' &&
      livePulse?.getAttribute('data-pulse-retained-event-type') !== 'none' &&
      liveNow?.getAttribute('data-now-retention-state') === 'retained' &&
      liveNow?.getAttribute('data-now-retained-event-cursor') !== 'none' &&
      liveNow?.getAttribute('data-now-retained-event-type') !== 'none'
    );
  }, {
    startCursor: burst.body.start_cursor,
    endCursor: burst.body.end_cursor,
  }, { timeout: 20000 });

  const chronicleState = await collectMechanicsRetainedDensityState(
    page,
    burst,
    archiveAttributesBeforeExpiry,
  );

  await focusMechanicsRegion(page, 'warm_springs');
  const selectionPoint = await page.evaluate(() => {
    for (const agentId of ['wanderer_001', 'wanderer_002', 'wanderer_003']) {
      const point = window.__vivariumWorld?.screenPointForAgent?.(agentId);
      if (
        point &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.y >= 0 &&
        point.x <= window.innerWidth &&
        point.y <= window.innerHeight
      ) {
        return { agentId, x: point.x, y: point.y };
      }
    }
    return null;
  });
  if (selectionPoint) {
    await page.mouse.click(selectionPoint.x, selectionPoint.y);
  } else {
    await openMechanicsWorldSurface(page);
    const maeRow = page.locator('.presence-rail .agent-row').filter({
      has: page.locator('.agent-name', { hasText: /^Mae$/ }),
    });
    await expect(maeRow).toHaveCount(1, { timeout: 10000 });
    await maeRow.click();
  }

  await page.waitForFunction(() => {
    const focusPulse = document.querySelector('[data-testid="selected-focus-activity-pulse"]');
    return (
      focusPulse?.getAttribute('data-focus-retention-state') === 'retained' &&
      focusPulse?.getAttribute('data-focus-retained-event-cursor') !== 'none' &&
      focusPulse?.getAttribute('data-focus-retained-event-type') !== 'none' &&
      focusPulse.querySelector('[data-focus-pulse-latest="true"]')
    );
  }, null, { timeout: 10000 });

  const selectionState = await collectMechanicsRetainedDensityState(
    page,
    burst,
    archiveAttributesBeforeExpiry,
  );
  const state = {
    ...selectionState,
    chronicleRows: chronicleState.chronicleRows,
    mechanicsRows: chronicleState.mechanicsRows,
    renderedEventCursors: chronicleState.renderedEventCursors,
    recentRenderedEventBeats: chronicleState.recentRenderedEventBeats,
    livePulse: chronicleState.livePulse,
    liveNow: chronicleState.liveNow,
    controls: {
      ...selectionState.controls,
      chronicle: chronicleState.controls.chronicle,
      livePulse: chronicleState.controls.livePulse,
      liveNow: chronicleState.controls.liveNow,
    },
    clipIssues: [...chronicleState.clipIssues, ...selectionState.clipIssues],
    retainedCopyLeaks: [
      ...chronicleState.retainedCopyLeaks,
      ...selectionState.retainedCopyLeaks,
    ],
  };
  const failures = validateMechanicsRetainedDensityState(state);
  expect(
    failures,
    formatMechanicsRetainedDensityFailure(failures, state),
  ).toEqual([]);
  await expectNoLiveDiagnosticCopy(page);
  await expectNoBannedObserverCopy(page);
}

async function openMechanicsWorldSurface(page) {
  const surface = page.locator('[data-atlas-surface]');
  if (await surface.getAttribute('data-atlas-surface') === 'world') {
    return;
  }
  await page.getByRole('button', { name: 'Open world — World Beings & land', exact: true }).click();
  await expect(surface).toHaveAttribute('data-atlas-surface', 'world');
  await expect(surface).toHaveAttribute('data-open', 'true');
}

async function openMechanicsChronicleSurface(page) {
  const surface = page.locator('[data-atlas-surface]');
  if (await surface.getAttribute('data-atlas-surface') === 'chronicle') {
    return;
  }
  await page.getByRole('button', { name: 'Open chronicle — Chronicle Living memory', exact: true }).click();
  await expect(surface).toHaveAttribute('data-atlas-surface', 'chronicle');
  await expect(surface).toHaveAttribute('data-open', 'true');
}

async function expectMechanicsRendererSummaryDiagnostics(page, burst) {
  await page.waitForFunction(({ endCursor, requiredSummaries }) => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    const appliedCursors = Array.from(window.__vivariumWorld?.appliedEventCursors?.() ?? []);
    const effects = window.__vivariumWorld?.activeEffects?.() ?? [];
    const requiredReady = requiredSummaries.every(({ eventType, kind }) => (
      effects.some((effect) => effect.eventType === eventType && effect.summary?.kind === kind)
    ));
    return (
      (diagnostics?.eventCursor ?? 0) >= endCursor &&
      appliedCursors.includes(endCursor) &&
      requiredReady
    );
  }, {
    endCursor: burst.body.end_cursor,
    requiredSummaries: LIVE_RENDERER_REQUIRED_TAIL_SUMMARIES,
  }, { timeout: 15000 });

  const diagnostics = await page.evaluate(() => {
    const world = window.__vivariumWorld;
    const effects = world?.activeEffects?.() ?? [];
    return {
      liveRunCursor: window.__vivariumLiveRun?.diagnostics?.().eventCursor ?? null,
      motionMode: world?.motionMode?.() ?? null,
      appliedCursors: Array.from(world?.appliedEventCursors?.() ?? []),
      effects: effects.map((effect) => ({
        eventType: effect.eventType,
        group: effect.group,
        hasBubble: Boolean(effect.bubble),
        summary: effect.summary ?? null,
      })),
    };
  });
  const summaryFailures = validateMechanicsRendererSummaryDiagnostics(
    diagnostics,
    burst.body.end_cursor,
  );
  expect(summaryFailures, summaryFailures.join('\n')).toEqual([]);
}

async function collectArchiveDataAttributes(page) {
  return page.evaluate(() => {
    const archive = document.querySelector('[data-testid="archive-chronicle"]');
    if (!archive) return null;
    return Object.fromEntries(
      Array.from(archive.attributes)
        .filter((attribute) => attribute.name.startsWith('data-archive-'))
        .map((attribute) => [attribute.name, attribute.value]),
    );
  });
}

async function collectMechanicsRetainedDensityState(page, burst, archiveAttributesBeforeExpiry) {
  return page.evaluate(({ startCursor, endCursor, archiveBefore }) => {
    const visible = (node) => {
      if (!node) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const attr = (node, name) => node?.getAttribute(name) ?? '';
    const toNumber = (value) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };
    const rowState = (row) => ({
      cursor: toNumber(row.getAttribute('data-event-cursor')),
      type: row.getAttribute('data-event-type') ?? '',
      group: row.getAttribute('data-event-group') ?? '',
      tone: row.getAttribute('data-event-tone') ?? '',
      visible: visible(row),
      textLength: (row.textContent || '').replace(/\s+/g, ' ').trim().length,
    });
    const retainedTextSelectors = [
      '.chronicle .event-row-header',
      '.chronicle .event-type',
      '.chronicle .event-group',
      '.chronicle .event-row time',
      '.chronicle .live-pulse-head',
      '.chronicle .live-pulse-head b',
      '.chronicle .live-pulse-footer span',
      '.chronicle .live-pulse-latest',
      '.chronicle .live-pulse-latest span',
      '.chronicle .live-now-head',
      '.chronicle .live-now-head b',
      '.chronicle .live-now-cue',
      '.chronicle .live-now-slot',
      '.chronicle .live-now-cue b',
      '.inspector .focus-pulse-head',
      '.inspector .focus-pulse-head b',
      '.inspector .focus-pulse-head em',
      '.inspector .focus-pulse-latest',
      '.inspector .focus-pulse-latest-copy',
      '.inspector .focus-pulse-latest-copy span',
      '.inspector .focus-pulse-latest-copy small',
      '.inspector .focus-pulse-latest em',
      '.inspector-recent .event-summary-detail',
      '.inspector-recent .event-summary-chain',
      '.inspector-recent .event-summary-header',
      '.inspector-recent .event-summary p',
    ];
    const retainedAttributes = [
      'data-pulse-retained-event-label',
      'data-pulse-event-label',
      'data-pulse-detail-text',
      'data-pulse-chain-text',
      'data-now-retained-event-label',
      'data-now-label',
      'data-now-detail',
      'data-now-detail-text',
      'data-now-chain-text',
      'data-focus-retained-event-label',
      'data-focus-pulse-event-label',
      'data-focus-pulse-detail-text',
      'data-focus-pulse-chain-text',
      'data-event-detail-text',
      'data-event-chain-text',
    ];
    const retainedAttributeSelector = retainedAttributes.map((name) => `[${name}]`).join(',');
    const copyPattern = /agent_|home_|simulation|provider|model|run_|llm|npc|spawn|prompt/i;
    const clipIssues = [];
    for (const selector of retainedTextSelectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!visible(node)) {
          clipIssues.push(`${selector}: hidden`);
          continue;
        }
        if (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1) {
          clipIssues.push(`${selector}: clipped`);
        }
      }
    }
    const retainedCopyLeaks = Array.from(document.querySelectorAll(retainedAttributeSelector))
      .flatMap((node) => retainedAttributes.map((attribute) => node.getAttribute(attribute)).filter(Boolean))
      .filter((value) => copyPattern.test(value));

    const livePulse = document.querySelector('[data-testid="live-pulse"]');
    const livePulseLatest = livePulse?.querySelector('.live-pulse-latest') ?? null;
    const liveNow = document.querySelector('[data-testid="live-now"]');
    const nowCues = Array.from(liveNow?.querySelectorAll('.live-now-cue') ?? []);
    const focusPulse = document.querySelector('[data-testid="selected-focus-activity-pulse"]');
    const focusPulseLatest = focusPulse?.querySelector('[data-focus-pulse-latest="true"]') ?? null;
    const inspectorRecent = document.querySelector('.inspector-recent');
    const inspectorEventRows = Array.from(
      inspectorRecent?.querySelectorAll('.event-summary[data-event-kind="event"]') ?? [],
    ).map((row) => {
      const detail = row.querySelector('.event-summary-detail');
      const chain = row.querySelector('.event-summary-chain');
      return {
        ...rowState(row),
        detailKind: attr(row, 'data-event-detail-kind'),
        detailText: attr(row, 'data-event-detail-text'),
        detailVisible: visible(detail),
        detailDomCount: row.querySelectorAll('.event-summary-detail').length,
        chainKind: attr(row, 'data-event-chain-kind'),
        chainCount: toNumber(attr(row, 'data-event-chain-count')),
        chainWindow: attr(row, 'data-event-chain-window'),
        chainText: attr(row, 'data-event-chain-text'),
        chainVisible: visible(chain),
        chainDomCount: row.querySelectorAll('.event-summary-chain').length,
        medallionCount: row.querySelectorAll('.event-medallion').length,
      };
    });
    const inspectorGapRows = Array.from(
      inspectorRecent?.querySelectorAll('.event-summary[data-event-kind="gap"]') ?? [],
    ).map((row) => {
      const eventAttributeNames = [
        'data-event-type',
        'data-event-group',
        'data-event-tone',
        'data-event-cursor',
        'data-event-detail-kind',
        'data-event-detail-text',
        'data-event-chain-kind',
        'data-event-chain-text',
        'data-event-icon',
        'data-event-icon-label',
        'data-event-medallion-label',
        'data-event-priority',
        'data-event-accent',
      ];
      return {
        visible: visible(row),
        textLength: (row.textContent || '').replace(/\s+/g, ' ').trim().length,
        eventAttributeCount: eventAttributeNames.filter((name) => row.hasAttribute(name)).length,
        detailDomCount: row.querySelectorAll('.event-summary-detail').length,
        chainDomCount: row.querySelectorAll('.event-summary-chain').length,
        medallionCount: row.querySelectorAll('.event-medallion').length,
      };
    });
    const chronicleRows = Array.from(document.querySelectorAll('.chronicle [data-event-kind="event"]')).map(rowState);
    const recentRenderedEventBeats = window.__vivariumWorld?.recentRenderedEventBeats?.() ?? [];
    const activeEffects = window.__vivariumWorld?.activeEffects?.() ?? [];
    return {
      startCursor,
      endCursor,
      diagnostics: window.__vivariumLiveRun?.diagnostics?.() ?? null,
      activeBubbleCount: Array.from(document.querySelectorAll('.viv-event-bubble'))
        .filter((bubble) => {
          const cursor = toNumber(bubble.getAttribute('data-event-cursor'));
          return cursor !== null && cursor > startCursor && cursor <= endCursor;
        }).length,
      totalActiveBubbleCount: document.querySelectorAll('.viv-event-bubble').length,
      activeBubbleEffectCount: activeEffects.filter((effect) => {
        const cursor = toNumber(effect.bubble?.cursor);
        return cursor !== null && cursor > startCursor && cursor <= endCursor;
      }).length,
      totalActiveBubbleEffectCount: activeEffects.filter((effect) => effect.bubble).length,
      chronicleRows,
      mechanicsRows: chronicleRows.filter((row) => (
        row.cursor !== null &&
        row.cursor > startCursor &&
        row.cursor <= endCursor
      )),
      renderedEventCursors: (window.__vivariumWorld?.renderedEventCursors?.() ?? [])
        .map(toNumber)
        .filter((cursor) => cursor !== null),
      recentRenderedEventBeats: recentRenderedEventBeats.map((beat) => ({
        cursor: toNumber(beat?.cursor),
        eventType: beat?.eventType ?? '',
        hasBubble: beat?.hasBubble === true,
      })),
      livePulse: {
        state: attr(livePulse, 'data-pulse-retention-state'),
        cursor: toNumber(attr(livePulse, 'data-pulse-retained-event-cursor')),
        type: attr(livePulse, 'data-pulse-retained-event-type'),
        visible: visible(livePulse),
        latestVisible: visible(livePulseLatest),
        latestCursor: toNumber(attr(livePulseLatest, 'data-pulse-event-cursor')),
        latestType: attr(livePulseLatest, 'data-pulse-event-type'),
      },
      liveNow: {
        state: attr(liveNow, 'data-now-retention-state'),
        cursor: toNumber(attr(liveNow, 'data-now-retained-event-cursor')),
        type: attr(liveNow, 'data-now-retained-event-type'),
        visible: visible(liveNow),
        cues: nowCues.map((cue) => ({
          cursor: toNumber(attr(cue, 'data-now-cursor')),
          type: attr(cue, 'data-now-event-type'),
          visible: visible(cue),
        })),
      },
      focusPulse: {
        state: attr(focusPulse, 'data-focus-retention-state'),
        cursor: toNumber(attr(focusPulse, 'data-focus-retained-event-cursor')),
        type: attr(focusPulse, 'data-focus-retained-event-type'),
        visible: visible(focusPulse),
        latestVisible: visible(focusPulseLatest),
        latestCursor: toNumber(attr(focusPulseLatest, 'data-focus-pulse-event-cursor')),
        latestType: attr(focusPulseLatest, 'data-focus-pulse-event-type'),
      },
      selectedInspector: {
        visible: visible(inspectorRecent),
        eventRows: inspectorEventRows,
        gapRows: inspectorGapRows,
      },
      controls: {
        chronicle: document.querySelectorAll('.chronicle button:not(.event-row-action), .chronicle select, .chronicle dialog, .chronicle [role="dialog"], .chronicle [role="button"]:not(.event-row-action)').length,
        livePulse: document.querySelectorAll('.live-pulse button, .live-pulse select, .live-pulse dialog, .live-pulse [role="dialog"], .live-pulse [role="button"]').length,
        liveNow: document.querySelectorAll('.live-now button, .live-now select, .live-now dialog, .live-now [role="dialog"], .live-now [role="button"]').length,
        focusPulse: document.querySelectorAll('.focus-pulse button, .focus-pulse select, .focus-pulse dialog, .focus-pulse [role="dialog"], .focus-pulse [role="button"]').length,
        inspectorRecent: document.querySelectorAll('.inspector-recent button, .inspector-recent select, .inspector-recent dialog, .inspector-recent [role="dialog"], .inspector-recent [role="button"]').length,
        seekCopy: /\b(Seek|Scrub|Playback)\b/i.test(document.body.innerText),
      },
      clipIssues,
      retainedCopyLeaks,
      archive: {
        before: archiveBefore,
        after: (() => {
          const archive = document.querySelector('[data-testid="archive-chronicle"]');
          if (!archive) return null;
          return Object.fromEntries(
            Array.from(archive.attributes)
              .filter((attribute) => attribute.name.startsWith('data-archive-'))
              .map((attribute) => [attribute.name, attribute.value]),
          );
        })(),
      },
    };
  }, {
    startCursor: burst.body.start_cursor,
    endCursor: burst.body.end_cursor,
    archiveBefore: archiveAttributesBeforeExpiry,
  });
}

function validateMechanicsRetainedDensityState(state) {
  const failures = [];
  const eventCursor = Number(state?.diagnostics?.eventCursor);
  const startCursor = Number(state?.startCursor);
  const endCursor = Number(state?.endCursor);

  if (state?.diagnostics?.connection !== 'live') {
    failures.push('live diagnostics should report a live connection');
  }
  if (state?.diagnostics?.stream?.active !== true) {
    failures.push('live SSE stream should remain active');
  }
  if (!Number.isFinite(eventCursor) || eventCursor < endCursor) {
    failures.push('live event cursor should reach the mechanics burst end cursor');
  }
  if (state?.activeBubbleCount !== 0 || state?.activeBubbleEffectCount !== 0) {
    failures.push('active world bubbles should expire before retained-density proof');
  }

  const mechanicsRows = Array.isArray(state?.mechanicsRows) ? state.mechanicsRows : [];
  if (mechanicsRows.length === 0) {
    failures.push('chronicle should retain at least one visible mechanics event row');
  }
  if (!mechanicsRows.some((row) => row.visible && row.type && row.group && row.tone && row.textLength > 0)) {
    failures.push('retained mechanics chronicle rows should stay visible and well-formed');
  }

  const renderedCursors = new Set((Array.isArray(state?.renderedEventCursors)
    ? state.renderedEventCursors
    : []).filter((cursor) => Number.isFinite(cursor)));
  const renderedMechanicsRow = mechanicsRows.some((row) => (
    row.visible === true &&
    Number.isFinite(row.cursor) &&
    renderedCursors.has(row.cursor)
  ));
  if (!renderedMechanicsRow) {
    failures.push('renderer rendered cursor memory should retain a mechanics burst event row');
  }

  validateRetainedSurface(failures, 'World pulse', state?.livePulse, {
    latestCursorKey: 'latestCursor',
    latestTypeKey: 'latestType',
  });
  validateLiveNowSurface(failures, state?.liveNow);
  validateRetainedSurface(failures, 'Focus pulse', state?.focusPulse, {
    latestCursorKey: 'latestCursor',
    latestTypeKey: 'latestType',
  });

  const controls = state?.controls ?? {};
  for (const [surface, count] of Object.entries(controls)) {
    if (surface === 'seekCopy') {
      if (count === true) failures.push('retained live smoke should not expose seek/scrub/playback copy');
      continue;
    }
    if (count !== 0) {
      failures.push(`${surface} should not introduce controls or dialogs`);
    }
  }

  if (Array.isArray(state?.clipIssues) && state.clipIssues.length > 0) {
    failures.push('retained live surfaces should not clip important labels');
  }
  if (Array.isArray(state?.retainedCopyLeaks) && state.retainedCopyLeaks.length > 0) {
    failures.push('retained live surface attributes should not expose backend/raw vocabulary');
  }
  if (JSON.stringify(state?.archive?.before ?? null) !== JSON.stringify(state?.archive?.after ?? null)) {
    failures.push('archive chronicle metadata should not mutate during retained-density expiry wait');
  }

  return failures;
}

function validateRetainedSurface(failures, label, surface, keys) {
  if (surface?.visible !== true) {
    failures.push(`${label} should stay visible`);
  }
  if (surface?.state !== 'retained') {
    failures.push(`${label} should expose retained state`);
  }
  if (!Number.isFinite(surface?.cursor) || surface.cursor <= 0 || !surface?.type || surface.type === 'none') {
    failures.push(`${label} should expose retained cursor/type metadata`);
  }
  if (surface?.latestVisible !== true) {
    failures.push(`${label} latest retained row should stay visible`);
  }
  if (surface?.cursor !== surface?.[keys.latestCursorKey] || surface?.type !== surface?.[keys.latestTypeKey]) {
    failures.push(`${label} parent retained metadata should match latest row metadata`);
  }
}

function validateLiveNowSurface(failures, surface) {
  if (surface?.visible !== true) {
    failures.push('Now cue surface should stay visible');
  }
  if (surface?.state !== 'retained') {
    failures.push('Now cue surface should expose retained state');
  }
  if (!Number.isFinite(surface?.cursor) || surface.cursor <= 0 || !surface?.type || surface.type === 'none') {
    failures.push('Now cue surface should expose retained cursor/type metadata');
  }
  const matchingCue = (surface?.cues ?? []).some((cue) => (
    cue.visible === true &&
    cue.cursor === surface.cursor &&
    cue.type === surface.type
  ));
  if (!matchingCue) {
    failures.push('Now retained metadata should match a visible cue');
  }
}

function validateMechanicsSelectedInspectorState(state) {
  const failures = [];
  validateSelectedInspectorRecentSurface(failures, state?.selectedInspector, {
    startCursor: Number(state?.startCursor),
    endCursor: Number(state?.endCursor),
  });
  return failures;
}

function validateSelectedInspectorRecentSurface(failures, surface, cursorWindow) {
  if (surface?.visible !== true) {
    failures.push('selected inspector recent trail should stay visible');
  }

  const startCursor = Number(cursorWindow?.startCursor);
  const endCursor = Number(cursorWindow?.endCursor);
  const eventRows = Array.isArray(surface?.eventRows) ? surface.eventRows : [];
  const mechanicsRows = eventRows.filter((row) => (
    Number.isFinite(row?.cursor) &&
    Number.isFinite(startCursor) &&
    Number.isFinite(endCursor) &&
    row.cursor > startCursor &&
    row.cursor <= endCursor
  ));

  if (mechanicsRows.length === 0) {
    failures.push('selected inspector recent trail should retain at least one mechanics event summary');
  }
  if (!mechanicsRows.some((row) => (
    row.visible === true &&
    row.type &&
    row.group &&
    row.tone &&
    row.textLength > 0 &&
    row.medallionCount > 0
  ))) {
    failures.push('selected inspector mechanics summaries should stay visible and well-formed');
  }
  if (!mechanicsRows.some((row) => (
    row.detailKind &&
    row.detailKind !== 'none' &&
    row.detailText &&
    row.detailText !== 'none' &&
    row.detailVisible === true &&
    row.detailDomCount === 1
  ))) {
    failures.push('selected inspector should expose compact detail on a retained mechanics summary');
  }
  if (!mechanicsRows.some((row) => (
    row.chainKind &&
    row.chainKind !== 'none' &&
    row.chainText &&
    row.chainText !== 'none' &&
    row.chainWindow &&
    row.chainWindow !== 'none' &&
    Number(row.chainCount) > 1 &&
    row.chainVisible === true &&
    row.chainDomCount === 1
  ))) {
    failures.push('selected inspector should expose grouped-chain copy on a retained mechanics summary');
  }

  const gapRows = Array.isArray(surface?.gapRows) ? surface.gapRows : [];
  if (gapRows.some((row) => (
    row.eventAttributeCount > 0 ||
    row.detailDomCount > 0 ||
    row.chainDomCount > 0 ||
    row.medallionCount > 0
  ))) {
    failures.push('selected inspector gap rows should stay passive and metadata-free');
  }
}

async function fetchMechanicsWindowEvents(page, burst) {
  const envelope = await page.evaluate(async (cursor) => {
    const response = await fetch(`/api/events?cursor=${cursor}`, {
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  }, burst.body.start_cursor);
  expect(envelope.ok).toBe(true);
  expect(envelope.status).toBe(200);
  expect(envelope.body.schema).toBe(1);
  expect(Array.isArray(envelope.body.events)).toBe(true);
  return envelope.body.events;
}

function findMechanicsParalysisChain(events, burstBody) {
  const startCursor = Number(burstBody?.start_cursor);
  const endCursor = Number(burstBody?.end_cursor);
  const mechanicsEvents = (Array.isArray(events) ? events : [])
    .filter((entry) => (
      Number.isFinite(Number(entry?.cursor)) &&
      Number(entry.cursor) > startCursor &&
      Number(entry.cursor) <= endCursor
    ))
    .sort((left, right) => Number(left.cursor) - Number(right.cursor));
  const paralyzed = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'agent_paralyzed' &&
    eventMentionsAgent(entry, 'wanderer_002')
  ));
  expect(
    paralyzed,
    'mechanics events should include Mae paralysis within the deterministic burst window',
  ).toBeTruthy();

  const attack = [...mechanicsEvents].reverse().find((entry) => (
    Number(entry?.cursor) < Number(paralyzed.cursor) &&
    entry?.event?.type === 'attack' &&
    eventHasActor(entry, 'wanderer_001') &&
    eventHasTarget(entry, 'wanderer_002')
  ));
  expect(
    attack,
    'mechanics events should include Joe attacking Mae before the paralysis event',
  ).toBeTruthy();

  return {
    attackCursor: Number(attack.cursor),
    paralyzedCursor: Number(paralyzed.cursor),
    chainWindow: `${Number(attack.cursor)}-${Number(paralyzed.cursor)}`,
  };
}

function findMechanicsStructureChains(events, burstBody) {
  const mechanicsEvents = sortedMechanicsEvents(events, burstBody);
  const built = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_built' &&
    entry.event.payload?.builder_id === 'wanderer_001' &&
    entry.event.payload?.owner_id === 'wanderer_001' &&
    entry.event.payload?.region === 'warm_springs' &&
    typeof entry.event.payload?.home_id === 'string'
  ));
  expect(
    built,
    'mechanics events should include Joe building a deterministic warm-springs home',
  ).toBeTruthy();

  const joeHomeId = built.event.payload.home_id;
  const joined = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_joined' &&
    eventHomeId(entry) === joeHomeId &&
    entry.event.payload?.agent_id === 'wanderer_002'
  ));
  expect(
    joined,
    'mechanics events should include Mae joining Joe home',
  ).toBeTruthy();

  const left = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_left' &&
    eventHomeId(entry) === joeHomeId &&
    entry.event.payload?.agent_id === 'wanderer_002'
  ));
  expect(
    left,
    'mechanics events should include Mae leaving Joe home',
  ).toBeTruthy();

  const hearth = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'hearth_used' &&
    eventHomeId(entry) === joeHomeId &&
    entry.event.payload?.agent_id === 'wanderer_001'
  ));
  expect(
    hearth,
    'mechanics events should include Joe taking shelter at his hearth',
  ).toBeTruthy();

  const thieveBreach = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_breached' &&
    eventHomeId(entry) === joeHomeId &&
    entry.event.payload?.intent === 'thieve' &&
    entry.event.payload?.breacher_id === 'wanderer_003'
  ));
  expect(
    thieveBreach,
    'mechanics events should include Dick breaching Joe home to thieve',
  ).toBeTruthy();

  const thieved = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(thieveBreach.cursor) &&
    entry?.event?.type === 'home_thieved' &&
    eventHomeId(entry) === joeHomeId &&
    entry.event.payload?.intent === 'thieve' &&
    entry.event.payload?.breacher_id === 'wanderer_003' &&
    entry.event.payload?.recipients?.includes('wanderer_003') &&
    Number(entry.event.payload?.loot?.materials) > 0
  ));
  expect(
    thieved,
    'mechanics events should include Joe home theft after the thieve breach',
  ).toBeTruthy();

  const colonizeBreach = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_breached' &&
    eventHomeId(entry) === 'test_colonize_home' &&
    entry.event.payload?.intent === 'colonize' &&
    entry.event.payload?.breacher_id === 'wanderer_003'
  ));
  expect(
    colonizeBreach,
    'mechanics events should include Dick breaching the colonize test home',
  ).toBeTruthy();

  const colonized = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(colonizeBreach.cursor) &&
    entry?.event?.type === 'home_colonized' &&
    eventHomeId(entry) === 'test_colonize_home' &&
    entry.event.payload?.intent === 'colonize' &&
    entry.event.payload?.breacher_id === 'wanderer_003' &&
    entry.event.payload?.new_owner_id === 'wanderer_003'
  ));
  expect(
    colonized,
    'mechanics events should include test home colonization after the colonize breach',
  ).toBeTruthy();

  const hoard = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_started_hoarding' &&
    eventHomeId(entry) === 'test_colonize_home' &&
    entry.event.payload?.agent_id === 'wanderer_003' &&
    Number(entry.event.payload?.vault_materials) >= 300
  ));
  expect(
    hoard,
    'mechanics events should include the colonized home vault crossing hoard threshold',
  ).toBeTruthy();
  expect(
    Number(hoard.cursor),
    'mechanics home hoard should be recorded after colonization',
  ).toBeGreaterThan(Number(colonized.cursor));

  const scavenge = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'ruins_scavenged' &&
    eventHomeId(entry) === 'test_ruin_home' &&
    entry.event.payload?.agent_id === 'wanderer_003' &&
    entry.event.payload?.resource_type === 'materials' &&
    Number(entry.event.payload?.amount) > 0
  ));
  expect(
    scavenge,
    'mechanics events should include Dick scavenging the test ruin',
  ).toBeTruthy();

  return {
    joeHomeId,
    buildCursor: Number(built.cursor),
    joinedCursor: Number(joined.cursor),
    leftCursor: Number(left.cursor),
    hearthCursor: Number(hearth.cursor),
    thieveBreachCursor: Number(thieveBreach.cursor),
    thievedCursor: Number(thieved.cursor),
    theftMaterials: Number(thieved.event.payload.loot.materials),
    theftChainWindow: `${Number(thieveBreach.cursor)}-${Number(thieved.cursor)}`,
    colonizeHomeId: 'test_colonize_home',
    colonizeBreachCursor: Number(colonizeBreach.cursor),
    colonizedCursor: Number(colonized.cursor),
    colonizeChainWindow: `${Number(colonizeBreach.cursor)}-${Number(colonized.cursor)}`,
    hoardCursor: Number(hoard.cursor),
    ruinHomeId: 'test_ruin_home',
    scavengeCursor: Number(scavenge.cursor),
    scavengeMaterials: Number(scavenge.event.payload.amount),
  };
}

function findMechanicsRegionTrail(events, burstBody) {
  const mechanicsEvents = sortedMechanicsEvents(events, burstBody);
  const structure = findMechanicsStructureChains(events, burstBody);
  const paralysis = findMechanicsParalysisChain(events, burstBody);

  const speech = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'speak' &&
    eventHasActor(entry, 'wanderer_001') &&
    eventRegionName(entry) === 'warm_springs' &&
    entry.event.payload?.message === 'The deterministic springs are awake.'
  ));
  expect(
    speech,
    'mechanics events should include Joe speaking in warm_springs',
  ).toBeTruthy();

  const birth = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'agent_born' &&
    eventRegionName(entry) === 'warm_springs' &&
    entry.event.payload?.parent_ids?.includes('wanderer_001') &&
    entry.event.payload?.parent_ids?.includes('wanderer_002')
  ));
  expect(
    birth,
    'mechanics events should include Joe and Mae birth in warm_springs',
  ).toBeTruthy();

  const rejectedOffer = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'mating_initiated' &&
    eventHasActor(entry, 'wanderer_001') &&
    eventHasTarget(entry, 'wanderer_002') &&
    entry.event.payload?.initiator_id === 'wanderer_001' &&
    entry.event.payload?.target_id === 'wanderer_002' &&
    entry.event.payload?.message === 'A deterministic test proposal.'
  ));
  expect(
    rejectedOffer,
    'mechanics events should include Joe regionless offer to Mae before rejection',
  ).toBeTruthy();
  expectRegionlessTargetedBond(rejectedOffer, 'Joe-to-Mae rejected offer');

  const rejected = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(rejectedOffer.cursor) &&
    entry?.event?.type === 'mating_rejected' &&
    eventHasActor(entry, 'wanderer_002') &&
    entry.event.payload?.rejecter_id === 'wanderer_002' &&
    entry.event.payload?.initiator_id === 'wanderer_001'
  ));
  expect(
    rejected,
    'mechanics events should include Mae regionless rejection of Joe offer',
  ).toBeTruthy();
  expectRegionlessTargetedBond(rejected, 'Mae rejection of Joe offer');

  const invalidatedOffer = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(rejected.cursor) &&
    entry?.event?.type === 'mating_initiated' &&
    eventHasActor(entry, 'wanderer_001') &&
    eventHasTarget(entry, 'wanderer_002') &&
    entry.event.payload?.initiator_id === 'wanderer_001' &&
    entry.event.payload?.target_id === 'wanderer_002' &&
    entry.event.payload?.message === 'A deterministic proposal that will fall through.'
  ));
  expect(
    invalidatedOffer,
    'mechanics events should include Joe regionless offer to Mae before invalidation',
  ).toBeTruthy();
  expectRegionlessTargetedBond(invalidatedOffer, 'Joe-to-Mae invalidated offer');

  const invalidated = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(invalidatedOffer.cursor) &&
    entry?.event?.type === 'mating_proposal_invalidated' &&
    eventHasActor(entry, 'wanderer_001') &&
    entry.event.payload?.initiator_id === 'wanderer_001' &&
    entry.event.payload?.target_id === 'wanderer_002' &&
    entry.event.payload?.reason === 'initiator_ineligible'
  ));
  expect(
    invalidated,
    'mechanics events should include Joe regionless invalidated offer to Mae',
  ).toBeTruthy();
  expectRegionlessTargetedBond(invalidated, 'Joe-to-Mae invalidated offer close');

  const acceptedOffer = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(invalidated.cursor) &&
    Number(entry?.cursor) < Number(birth.cursor) &&
    entry?.event?.type === 'mating_initiated' &&
    eventHasActor(entry, 'wanderer_001') &&
    eventHasTarget(entry, 'wanderer_002') &&
    entry.event.payload?.initiator_id === 'wanderer_001' &&
    entry.event.payload?.target_id === 'wanderer_002' &&
    entry.event.payload?.message === 'A deterministic accepted proposal.'
  ));
  expect(
    acceptedOffer,
    'mechanics events should include Joe regionless accepted offer to Mae before birth',
  ).toBeTruthy();
  expectRegionlessTargetedBond(acceptedOffer, 'Joe-to-Mae accepted offer');

  const timeoutOffer = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'mating_initiated' &&
    eventHasActor(entry, 'wanderer_003') &&
    eventHasTarget(entry, 'wanderer_004') &&
    entry.event.payload?.initiator_id === 'wanderer_003' &&
    entry.event.payload?.target_id === 'wanderer_004' &&
    entry.event.payload?.message === 'A deterministic proposal that will lapse.'
  ));
  expect(
    timeoutOffer,
    'mechanics events should include Dick regionless offer to Allen before timeout',
  ).toBeTruthy();
  expectRegionlessTargetedBond(timeoutOffer, 'Dick-to-Allen timeout offer');

  const timeout = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(timeoutOffer.cursor) &&
    entry?.event?.type === 'mating_proposal_timeout' &&
    eventHasActor(entry, 'wanderer_003') &&
    entry.event.payload?.initiator_id === 'wanderer_003' &&
    entry.event.payload?.target_id === 'wanderer_004' &&
    entry.event.payload?.reason === 'timeout'
  ));
  expect(
    timeout,
    'mechanics events should include Dick regionless offer timeout with Allen',
  ).toBeTruthy();
  expectRegionlessTargetedBond(timeout, 'Dick-to-Allen timeout close');

  const left = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'agent_left_region' &&
    eventHasActor(entry, 'wanderer_003') &&
    entry.event.payload?.from_region === 'nirvana' &&
    entry.event.payload?.to_region === 'warm_springs'
  ));
  expect(
    left,
    'mechanics events should include Dick departing toward warm_springs',
  ).toBeTruthy();

  const entered = mechanicsEvents.find((entry) => (
    Number(entry?.cursor) > Number(left.cursor) &&
    entry?.event?.type === 'agent_entered_region' &&
    eventHasActor(entry, 'wanderer_003') &&
    eventRegionName(entry) === 'warm_springs' &&
    entry.event.payload?.from_region === 'nirvana' &&
    entry.event.payload?.to_region === 'warm_springs'
  ));
  expect(
    entered,
    'mechanics events should include Dick arriving in warm_springs after departure',
  ).toBeTruthy();

  const decayed = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'agent_decayed' &&
    eventRegionName(entry) === 'warm_springs' &&
    entry.event.payload?.agent_id === 'test_decayed_agent' &&
    entry.event.payload?.agent_name === 'Faded Witness'
  ));
  expect(
    decayed,
    'mechanics events should include the deterministic corpse decay in warm_springs',
  ).toBeTruthy();

  const collapsed = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'home_collapsed' &&
    eventRegionName(entry) === 'warm_springs' &&
    eventHomeId(entry) === 'test_collapse_home'
  ));
  expect(
    collapsed,
    'mechanics events should include the deterministic home collapse in warm_springs',
  ).toBeTruthy();

  const death = mechanicsEvents.find((entry) => (
    entry?.event?.type === 'agent_died' &&
    eventRegionName(entry) === 'warm_springs' &&
    entry.event.payload?.victim_id === 'wanderer_003' &&
    entry.event.payload?.killer_id === 'wanderer_001'
  ));
  expect(
    death,
    'mechanics events should include Joe killing Dick in warm_springs',
  ).toBeTruthy();
  expect(
    Number(death.cursor),
    'mechanics death should be recorded after Mae paralysis',
  ).toBeGreaterThan(paralysis.paralyzedCursor);

  return {
    ...structure,
    speechCursor: Number(speech.cursor),
    movementLeftCursor: Number(left.cursor),
    movementEnteredCursor: Number(entered.cursor),
    movementChainWindow: `${Number(left.cursor)}-${Number(entered.cursor)}`,
    rejectedOfferCursor: Number(rejectedOffer.cursor),
    rejectedCursor: Number(rejected.cursor),
    invalidatedOfferCursor: Number(invalidatedOffer.cursor),
    invalidatedCursor: Number(invalidated.cursor),
    acceptedOfferCursor: Number(acceptedOffer.cursor),
    timeoutOfferCursor: Number(timeoutOffer.cursor),
    timeoutCursor: Number(timeout.cursor),
    birthCursor: Number(birth.cursor),
    decayedCursor: Number(decayed.cursor),
    collapsedCursor: Number(collapsed.cursor),
    attackCursor: paralysis.attackCursor,
    paralyzedCursor: paralysis.paralyzedCursor,
    paralysisChainWindow: paralysis.chainWindow,
    deathCursor: Number(death.cursor),
  };
}

function sortedMechanicsEvents(events, burstBody) {
  const startCursor = Number(burstBody?.start_cursor);
  const endCursor = Number(burstBody?.end_cursor);
  return (Array.isArray(events) ? events : [])
    .filter((entry) => (
      Number.isFinite(Number(entry?.cursor)) &&
      Number(entry.cursor) > startCursor &&
      Number(entry.cursor) <= endCursor
    ))
    .sort((left, right) => Number(left.cursor) - Number(right.cursor));
}

function eventHomeId(entry) {
  const event = entry?.event ?? {};
  const payload = event.payload ?? {};
  return payload.home_id ?? payload.target_home ?? event.target;
}

function eventRegionName(entry) {
  const event = entry?.event ?? {};
  const payload = event.payload ?? {};
  const resolved = entry?.resolved ?? {};
  return resolved.region ?? event.region ?? payload.region ?? payload.to_region ?? payload.from_region;
}

function formatMechanicsResourceCount(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return String(value);
  if (Number.isInteger(numberValue)) return String(numberValue);
  return String(numberValue);
}

function eventMentionsAgent(entry, agentId) {
  const event = entry?.event ?? {};
  const payload = event.payload ?? {};
  const values = [
    event.source,
    event.target,
    payload.agent_id,
    payload.actor_id,
    payload.attacker_id,
    payload.source_id,
    payload.target,
    payload.target_id,
    payload.victim_id,
  ];
  return values.includes(agentId);
}

function eventHasActor(entry, agentId) {
  const event = entry?.event ?? {};
  const payload = event.payload ?? {};
  return [
    event.source,
    payload.actor_id,
    payload.attacker_id,
    payload.source_id,
  ].includes(agentId);
}

function eventHasTarget(entry, agentId) {
  const event = entry?.event ?? {};
  const payload = event.payload ?? {};
  return [
    event.target,
    payload.agent_id,
    payload.target,
    payload.target_id,
    payload.victim_id,
  ].includes(agentId);
}

function expectRegionlessTargetedBond(entry, label) {
  expect(
    eventRegionName(entry),
    `${label} should rely on participant snapshot positions rather than an event region`,
  ).toBeUndefined();
}

function formatMechanicsSelectedInspectorStateFailure(failures, state) {
  const summary = failures.length > 0
    ? failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';
  return [
    'Expected deterministic Mae selected inspector to retain mechanics compact detail and grouped-chain copy.',
    'Failures:',
    summary,
    `Selected inspector: ${selectedInspectorSummary(state?.selectedInspector)} range=${summarizeCursorRange(state?.selectedInspector?.eventRows?.map((row) => row.cursor))}`,
    `Controls: ${JSON.stringify(state?.controls ?? {})}`,
    `Clip issues: ${(state?.clipIssues ?? []).slice(0, 5).join('; ') || 'none'}`,
  ].join('\n');
}

function formatMechanicsRetainedDensityFailure(failures, state) {
  const summary = failures.length > 0
    ? failures.map((failure) => `- ${failure}`).join('\n')
    : '- none';
  const mechanicsCursorRange = summarizeCursorRange(state?.mechanicsRows?.map((row) => row.cursor));
  const renderedCursorRange = summarizeCursorRange(state?.recentRenderedEventBeats?.map((beat) => beat.cursor));
  const renderedMemoryRange = summarizeCursorRange(state?.renderedEventCursors);
  const selectedInspectorRange = summarizeCursorRange(
    state?.selectedInspector?.eventRows?.map((row) => row.cursor),
  );
  return [
    'Expected deterministic live mechanics burst to retain dense post-expiry live surfaces.',
    'Failures:',
    summary,
    `Cursors: start=${state?.startCursor ?? 'none'} end=${state?.endCursor ?? 'none'} live=${state?.diagnostics?.eventCursor ?? 'none'}`,
    `Mechanics bubbles: dom=${state?.activeBubbleCount ?? 'none'} effects=${state?.activeBubbleEffectCount ?? 'none'}`,
    `Total bubbles: dom=${state?.totalActiveBubbleCount ?? 'none'} effects=${state?.totalActiveBubbleEffectCount ?? 'none'}`,
    `Chronicle: rows=${state?.chronicleRows?.length ?? 0} mechanicsRows=${state?.mechanicsRows?.length ?? 0} mechanicsRange=${mechanicsCursorRange}`,
    `Renderer recent range: ${renderedCursorRange}`,
    `Renderer memory range: ${renderedMemoryRange}`,
    `World pulse: ${surfaceSummary(state?.livePulse)}`,
    `Now: ${surfaceSummary(state?.liveNow)}`,
    `Focus pulse: ${surfaceSummary(state?.focusPulse)}`,
    `Selected inspector: ${selectedInspectorSummary(state?.selectedInspector)} range=${selectedInspectorRange}`,
    `Controls: ${JSON.stringify(state?.controls ?? {})}`,
    `Clip issues: ${(state?.clipIssues ?? []).slice(0, 5).join('; ') || 'none'}`,
    `Archive stable: ${JSON.stringify(state?.archive?.before ?? null) === JSON.stringify(state?.archive?.after ?? null)}`,
  ].join('\n');
}

function surfaceSummary(surface) {
  if (!surface) return 'missing';
  return `state=${surface.state ?? 'none'} cursor=${surface.cursor ?? 'none'} type=${surface.type ?? 'none'} visible=${surface.visible === true}`;
}

function selectedInspectorSummary(surface) {
  if (!surface) return 'missing';
  const eventRows = Array.isArray(surface.eventRows) ? surface.eventRows : [];
  const gapRows = Array.isArray(surface.gapRows) ? surface.gapRows : [];
  const detailRows = eventRows.filter((row) => row.detailKind && row.detailKind !== 'none').length;
  const chainRows = eventRows.filter((row) => row.chainKind && row.chainKind !== 'none').length;
  return `visible=${surface.visible === true} events=${eventRows.length} gaps=${gapRows.length} detailRows=${detailRows} chainRows=${chainRows}`;
}

function summarizeCursorRange(values) {
  const cursors = (values ?? []).filter((cursor) => Number.isFinite(cursor));
  if (cursors.length === 0) return 'none';
  return `${Math.min(...cursors)}..${Math.max(...cursors)} count=${cursors.length}`;
}

module.exports = {
  API_PATHS,
  MECHANICS_EVENT_TYPES,
  MECHANICS_EVENT_MIN_COUNTS,
  LIVE_RUN_EVENT_TYPES,
  MECHANICS_TOOL_NAMES,
  STRUCTURAL_MECHANICS_REASONS,
  STRUCTURAL_MECHANICS_REASON_MIN_COUNTS,
  MECHANICS_CHRONICLE_ROWS,
  triggerMechanicsBurst,
  fetchWorldSnapshot,
  fetchJsonlArtifact,
  byField,
  expectThievedJoeHomeAftermath,
  expectMechanicsTheftReplayProof,
  expectMechanicsWorldAftermath,
  expectMechanicsReplayArtifacts,
  expectMechanicsBurstVisible,
  expectMechanicsSelectedInspectorAfterBurst,
  expectMechanicsSelectedRegionAfterBurst,
  expectMechanicsSelectedStructuresAfterBurst,
  expectMechanicsRetainedDensityAfterBubblesExpire,
  expectMechanicsRendererSummaryDiagnostics,
  expectNoBannedObserverCopy,
  expectNoLiveDiagnosticCopy,
  _test: {
    findMechanicsParalysisChain,
    findMechanicsRegionTrail,
    findMechanicsStructureChains,
    formatMechanicsRetainedDensityFailure,
    validateMechanicsSelectedInspectorState,
    validateMechanicsRetainedDensityState,
  },
};
