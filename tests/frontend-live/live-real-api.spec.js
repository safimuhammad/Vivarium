const { test, expect } = require('@playwright/test');

const {
  API_PATHS,
  LIVE_RUN_EVENT_TYPES,
  triggerMechanicsBurst,
  fetchWorldSnapshot,
  expectMechanicsWorldAftermath,
  expectMechanicsReplayArtifacts,
  expectMechanicsBurstVisible,
  expectMechanicsSelectedInspectorAfterBurst,
  expectMechanicsSelectedRegionAfterBurst,
  expectMechanicsSelectedStructuresAfterBurst,
  expectMechanicsRetainedDensityAfterBubblesExpire,
  expectNoBannedObserverCopy,
  expectNoLiveDiagnosticCopy,
} = require('./live-mechanics-helpers');

const {
  buildRawRunMetadataBannedCopy,
  expectNoRawRunMetadataCopy,
  expectRunConstants,
} = require('./live-common-helpers');

test('production app observes the real deterministic live API and SSE stream', async ({ page, request }) => {
  const apiRequests = [];
  const failedRequests = [];
  const responseStatuses = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      apiRequests.push(`${url.pathname}${url.search}`);
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
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

  await page.addInitScript(() => {
    window.__vivariumEnableSnapshotRefreshForTest = true;
  });
  // Same stale half as its built sibling: this spec and the landing/config gateway
  // shipped in one commit (74f5e8f), so it asserted bare `/` is the live world while
  // `/` had just become the gateway. It hangs on `isReady` otherwise. Name the live
  // surface; every assertion below is unchanged and still exercises the real API.
  await page.goto('/?renderer=living-atlas');

  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
  await expect(page.getByTestId('world-stage')).toBeVisible();
  await expect(page.locator('.connection-pill')).toHaveAttribute('data-live-state', 'live');

  await page.waitForFunction(() => {
    const diagnostics = window.__vivariumLiveRun?.diagnostics?.();
    return Boolean(
      diagnostics &&
        diagnostics.connection === 'live' &&
        diagnostics.stream.active &&
        diagnostics.stream.url?.includes('/api/events/stream?cursor=') &&
        diagnostics.lastAcceptedSnapshotCursor !== null,
    );
  });

  await page.getByRole('button', { name: 'Open chronicle — Chronicle Living memory', exact: true }).click();
  await expect(page.locator('.chronicle')).toContainText('springs are awake', {
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Open archive — Archive Preserved view', exact: true }).click();
  await expect(page.locator('.timeline-strip')).toContainText('ready', {
    timeout: 15000,
  });
  await expect(page.locator('.archive-chronicle')).toBeVisible({
    timeout: 15000,
  });
  await page.waitForFunction(() => {
    const rows = Array.from(document.querySelectorAll('.timeline-strip dl'));
    const previewRow = rows.find((row) => row.querySelector('dt')?.textContent?.trim() === 'Preview');
    const text = previewRow?.querySelector('dd')?.textContent?.trim() ?? '';
    return text.startsWith('ready ') || text.startsWith('metadata ') || text === 'none' || text === 'error';
  }, null, {
    timeout: 15000,
  });
  await page.getByRole('button', { name: 'Close archive', exact: true }).click();
  await expect(page.getByTestId('world-stage')).toHaveAttribute('data-stage-source', 'live');
  await page.getByRole('button', { name: 'Open chronicle — Chronicle Living memory', exact: true }).click();

  const runEnvelope = await expectRunConstants(request);
  const rawRunMetadataBannedCopy = Object.freeze(
    buildRawRunMetadataBannedCopy(runEnvelope.body),
  );
  await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
  const beforeMechanicsWorld = await fetchWorldSnapshot(page);
  const mechanicsBurst = await triggerMechanicsBurst(page);
  await expectMechanicsBurstVisible(page, mechanicsBurst);
  await expectMechanicsSelectedRegionAfterBurst(page, mechanicsBurst);
  await expectMechanicsSelectedInspectorAfterBurst(page, mechanicsBurst);
  const afterMechanicsWorld = await fetchWorldSnapshot(page);
  expectMechanicsWorldAftermath(beforeMechanicsWorld, afterMechanicsWorld, mechanicsBurst);
  await expectMechanicsReplayArtifacts(page, mechanicsBurst);
  await expectMechanicsSelectedStructuresAfterBurst(page, mechanicsBurst);
  await expectMechanicsRetainedDensityAfterBubblesExpire(page, mechanicsBurst);
  for (const viewport of [
    { name: 'mobile', size: { width: 390, height: 844 } },
    { name: 'low-height desktop', size: { width: 1440, height: 650 } },
  ]) {
    await test.step(`${viewport.name} retained mechanics density`, async () => {
      await page.setViewportSize(viewport.size);
      await expectMechanicsRetainedDensityAfterBubblesExpire(page, mechanicsBurst);
    });
  }

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

  await page.getByRole('button', { name: 'Open archive — Archive Preserved view', exact: true }).click();

  const browserState = await page.evaluate(() => ({
    mockEventSourceGlobals: Object.keys(window)
      .filter((key) => key.startsWith('__vivariumMockEventSource')),
    diagnostics: window.__vivariumLiveRun?.diagnostics?.() ?? null,
    stagePixels: window.__vivariumWorld?.sampleCanvasPixels?.() ?? 0,
    stageCursors: Array.from(window.__vivariumWorld?.appliedEventCursors?.() ?? []),
    stageSource: document.querySelector('[data-testid="world-stage"]')?.getAttribute('data-stage-source'),
    canvasCount: document.querySelectorAll('[data-testid="world-stage"] canvas').length,
    previewHandlePresent: '__vivariumPreviewWorld' in window,
    archiveText: document.querySelector('.timeline-strip')?.textContent ?? '',
    previewTimeline: (() => {
      const rows = Array.from(document.querySelectorAll('.timeline-strip dl'));
      const previewRow = rows.find((row) => row.querySelector('dt')?.textContent?.trim() === 'Preview');
      return previewRow?.querySelector('dd')?.textContent?.trim() ?? '';
    })(),
    previewPanel: {
      count: document.querySelectorAll('.replay-preview').length,
      mode: document.querySelector('.replay-preview')?.getAttribute('data-replay-mode') ?? null,
      status: document.querySelector('.replay-preview')?.getAttribute('data-replay-entry-status') ?? null,
      exactness: document.querySelector('.replay-preview')?.getAttribute('data-replay-exactness') ?? null,
    },
    controls: {
      liveButtons: document.querySelectorAll('.live-status-strip button').length,
      timelineButtons: document.querySelectorAll('.timeline-strip button').length,
      archiveButtons: document.querySelectorAll('.archive-chronicle button').length,
      replayButtons: document.querySelectorAll('.replay-preview button').length,
      worldButtons: document.querySelectorAll('.world-stage button').length,
      seekCopy: /\b(Seek|Scrub|Playback)\b/i.test(document.body.innerText),
    },
  }));

  expect(browserState.mockEventSourceGlobals).toEqual([]);
  expect(browserState.diagnostics).toMatchObject({
    connection: 'live',
    stream: {
      active: true,
    },
    needsSnapshot: false,
  });
  expect(browserState.diagnostics.stream.url).toContain('/api/events/stream?cursor=');
  expect(browserState.diagnostics.eventCursor).toBeGreaterThan(0);
  expect(browserState.diagnostics.lastAcceptedSnapshotCursor).toBeGreaterThan(0);
  expect(browserState.stagePixels).toBeGreaterThan(20);
  expect(browserState.canvasCount).toBe(1);
  expect(browserState.previewHandlePresent).toBe(false);
  expect(browserState.archiveText).toContain('Archive');
  expect(browserState.archiveText).toContain('Proof');
  expect(browserState.archiveText).toContain('Preview');
  expect(browserState.previewTimeline).toMatch(/^(ready|metadata) /);
  if (browserState.previewTimeline.includes(', exact')) {
    expect(browserState.previewPanel).toMatchObject({
      count: 1,
      mode: 'archive-preview',
      status: 'ready',
      exactness: 'exact',
    });
    expect(browserState.stageSource).toBe('archive');
    expect(browserState.stageCursors.length).toBeGreaterThan(0);
  } else {
    expect(browserState.previewTimeline).toContain('+');
    expect(browserState.previewPanel).toMatchObject({
      count: 0,
      mode: null,
      status: null,
      exactness: null,
    });
    expect(browserState.stageSource).toBe('live');
  }
  expect(browserState.controls).toEqual({
    liveButtons: 0,
    timelineButtons: 1,
    archiveButtons: 0,
    replayButtons: 0,
    worldButtons: 0,
    seekCopy: false,
  });
  expect(eventsEnvelope.ok).toBe(true);
  expect(eventsEnvelope.status).toBe(200);
  expect(eventsEnvelope.body.schema).toBe(1);
  expect(eventsEnvelope.body.events.length).toBeGreaterThan(0);
  expect(eventsEnvelope.body.events.map((entry) => entry.event.type))
    .toEqual(expect.arrayContaining(LIVE_RUN_EVENT_TYPES));

  expect(failedRequests).toEqual([]);
  for (const path of API_PATHS) {
    const requested = path === '/api/events'
      ? eventsEnvelope.body.events.length > 0
      : apiRequests.some((requestPath) => requestPath.startsWith(path));
    expect(requested).toBe(true);
  }
  expect(responseStatuses.every(({ status }) => status >= 200 && status < 300)).toBe(true);
  await expectNoLiveDiagnosticCopy(page);
  await expectNoBannedObserverCopy(page);
  await expectNoRawRunMetadataCopy(page, rawRunMetadataBannedCopy);
});
