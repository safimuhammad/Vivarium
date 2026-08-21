const { test, expect } = require('@playwright/test');
const { resolveRealLiveTimeoutBudget } = require('./real-live-timeout-budget');

const {
  buildRawRunMetadataBannedCopy,
  fetchWorldSnapshot,
  fetchJsonlArtifact,
  expectLiveEventPresentation,
  expectLiveRetainedSurfacePresentation,
  expectLiveRendererFreshness,
  formatLiveEventCursorCorrelationFailure,
  expectNoBannedObserverCopy,
  expectNoLiveDiagnosticCopy,
  expectNoRawRunMetadataCopy,
} = require('./live-common-helpers');

const REAL_LIVE_ENABLED = process.env.VIVARIUM_REAL_LIVE === '1';
const FRONTEND_URL = process.env.VIVARIUM_REAL_LIVE_FRONTEND_URL || '';
const API_URL = process.env.VIVARIUM_REAL_LIVE_API_URL || '';
const REAL_LIVE_TIMEOUT_BUDGET = resolveRealLiveTimeoutBudget();
const REAL_LIVE_TIMEOUT_MS = REAL_LIVE_TIMEOUT_BUDGET.proofTimeoutMs;

const CORE_API_PATHS = [
  '/api/run',
  '/api/world',
  '/api/events',
  '/api/events/stream',
];
const REPLAY_ARTIFACT_PATHS = [
  '/api/replay/artifacts/events',
  '/api/replay/artifacts/snapshots',
];
const FORBIDDEN_TEST_API_NAMESPACE = /^\/api\/test(?:\/|$)/;

test.skip(
  !REAL_LIVE_ENABLED || !FRONTEND_URL,
  'Set VIVARIUM_REAL_LIVE=1 and VIVARIUM_REAL_LIVE_FRONTEND_URL to run the external real-provider smoke.',
);

test('external real-provider frontend observes a live sim without deterministic harnesses', async ({
  page,
  request,
}) => {
  const apiRequests = [];
  const failedRequests = [];
  const responseStatuses = [];

  page.on('request', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push(`${url.pathname}${url.search}`);
    }
  });
  page.on('requestfailed', (requestEvent) => {
    const url = new URL(requestEvent.url());
    if (url.pathname.startsWith('/api/')) {
      failedRequests.push(`${url.pathname}${url.search}`);
    }
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/')) {
      responseStatuses.push({
        path: `${url.pathname}${url.search}`,
        status: response.status(),
      });
    }
  });

  const documentResponse = await page.goto('/');
  expect(documentResponse?.ok()).toBe(true);

  await expect(page.getByTestId('world-stage')).toBeVisible();
  await expect(page.getByTestId('live-status-strip')).toBeVisible();
  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true, null, {
    timeout: REAL_LIVE_TIMEOUT_MS,
  });
  await page.waitForFunction(() => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return Boolean(
      diagnostics &&
        diagnostics.connection === 'live' &&
        diagnostics.stream.active &&
        diagnostics.stream.url?.includes('/api/events/stream?cursor=') &&
        diagnostics.eventCursor > 0 &&
        diagnostics.lastAcceptedSnapshotCursor !== null,
    );
  }, null, { timeout: REAL_LIVE_TIMEOUT_MS });

  const runEnvelope = await page.evaluate(async () => {
    const response = await fetch('/api/run', {
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  });
  expect(runEnvelope.ok).toBe(true);
  expect(runEnvelope.status).toBe(200);
  expect(runEnvelope.body.schema).toBe(1);
  expect(runEnvelope.body.run_id).toBeTruthy();

  const rawRunMetadataBannedCopy = Object.freeze(
    buildRawRunMetadataBannedCopy(runEnvelope.body),
  );
  await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);

  if (API_URL) {
    const directRunResponse = await request.get(`${API_URL.replace(/\/$/, '')}/api/run`, {
      headers: { Accept: 'application/json' },
    });
    expect(directRunResponse.ok()).toBe(true);
    const directRun = await directRunResponse.json();
    expect(directRun.schema).toBe(1);
    expect(directRun.run_id).toBe(runEnvelope.body.run_id);
  }

  const worldEnvelope = await fetchWorldSnapshot(page);
  expect(worldEnvelope.ok).toBe(true);
  expect(worldEnvelope.status).toBe(200);
  expect(worldEnvelope.body.schema).toBe(1);
  expect(worldEnvelope.body.run_id).toBe(runEnvelope.body.run_id);
  expect(worldEnvelope.body.event_cursor).toBeGreaterThan(0);
  expect(worldEnvelope.body.agents.length).toBeGreaterThan(0);
  expect(worldEnvelope.body.regions.length).toBeGreaterThan(0);

  const presentationState = await expectLiveEventPresentation(page, {
    timeout: REAL_LIVE_TIMEOUT_MS,
  });
  await expectLiveRendererFreshness(page, presentationState, {
    timeout: REAL_LIVE_TIMEOUT_MS,
  });
  await expectLiveRetainedSurfacePresentation(page, {
    timeout: REAL_LIVE_TIMEOUT_MS,
  });

  const eventsEnvelope = await page.evaluate(async () => {
    const response = await fetch('/api/events?cursor=0', {
      headers: { Accept: 'application/json' },
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json(),
    };
  });
  expect(eventsEnvelope.ok).toBe(true);
  expect(eventsEnvelope.status).toBe(200);
  expect(eventsEnvelope.body.schema).toBe(1);
  expect(eventsEnvelope.body.next_cursor).toBeGreaterThan(0);
  expect(eventsEnvelope.body.events.length).toBeGreaterThan(0);
  const apiEventCursors = eventsEnvelope.body.events
    .map((entry) => entry.cursor)
    .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
  const apiEventCursorSet = new Set(apiEventCursors);
  const presentedChronicleCursors = presentationState.chronicleRows
    .map((row) => row.cursor)
    .filter((cursor) => Number.isFinite(cursor) && cursor > 0);
  expect(
    presentedChronicleCursors.some((cursor) => apiEventCursorSet.has(cursor)),
    formatLiveEventCursorCorrelationFailure({
      apiEventCursors,
      presentedChronicleCursors,
    }),
  ).toBe(true);

  for (const artifactPath of REPLAY_ARTIFACT_PATHS) {
    const artifact = await fetchJsonlArtifact(page, artifactPath);
    expect([200, 404]).toContain(artifact.status);
    if (artifact.ok) {
      expect(artifact.contentType).toContain('application/x-ndjson');
      expect(Array.isArray(artifact.rows)).toBe(true);
    }
  }

  const browserState = await page.evaluate(() => ({
    mockEventSourceGlobals: Object.keys(window)
      .filter((key) => key.startsWith('__vivariumMockEventSource')),
    diagnostics: window.__vivariumLiveRun?.diagnostics?.() ?? null,
    livePixels: window.__vivariumWorld?.sampleCanvasPixels?.() ?? 0,
    liveStatus: document.querySelector('[data-testid="live-status-strip"]')?.getAttribute('data-live-state'),
    timelineText: document.querySelector('.timeline-strip')?.textContent ?? '',
    controls: {
      liveButtons: document.querySelectorAll('.live-status-strip button').length,
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
      earlierPointButtons: document.querySelectorAll('[data-testid="archive-load-older"]').length,
      archiveButtons: document.querySelectorAll('.archive-chronicle button').length,
      replayButtons: document.querySelectorAll('.replay-preview button').length,
      worldButtons: document.querySelectorAll('.world-stage button').length,
      seekCopy: /\b(Seek|Scrub|Playback)\b/i.test(document.body.innerText),
    },
  }));

  expect(browserState.mockEventSourceGlobals).toEqual([]);
  expect(browserState.diagnostics).toMatchObject({
    connection: 'live',
    stream: { active: true },
    needsSnapshot: false,
  });
  expect(browserState.diagnostics.stream.url).toContain('/api/events/stream?cursor=');
  expect(browserState.diagnostics.eventCursor).toBeGreaterThan(0);
  expect(browserState.diagnostics.lastAcceptedSnapshotCursor).toBeGreaterThanOrEqual(0);
  expect(browserState.livePixels).toBeGreaterThan(20);
  expect(browserState.liveStatus).toBe('live');
  expect(browserState.timelineText).toContain('Live tail');
  expect(browserState.controls).toEqual({
    liveButtons: 0,
    timelineButtons: 1,
    earlierPointButtons: 1,
    archiveButtons: 0,
    replayButtons: 0,
    worldButtons: 0,
    seekCopy: false,
  });

  expect(failedRequests.filter((path) => isCoreApiPath(path))).toEqual([]);
  const failedCoreStatuses = responseStatuses.filter(({ path, status }) => (
    isCoreApiPath(path) && (status < 200 || status >= 300)
  ));
  expect(failedCoreStatuses).toEqual([]);
  for (const path of CORE_API_PATHS) {
    expect(apiRequests.some((requestPath) => requestPath.startsWith(path))).toBe(true);
  }
  expect(apiRequests.some((path) => FORBIDDEN_TEST_API_NAMESPACE.test(path))).toBe(false);

  await expectNoLiveDiagnosticCopy(page);
  await expectNoBannedObserverCopy(page);
  await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
});

function isCoreApiPath(path) {
  return CORE_API_PATHS.some((apiPath) => path.startsWith(apiPath));
}
