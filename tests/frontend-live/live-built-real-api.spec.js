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
  fetchJsonlArtifact,
} = require('./live-common-helpers');

test('built frontend observes the real deterministic live API and SSE stream', async ({ page, request }) => {
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
  // Name the live surface explicitly. Bare `/` is the landing/configuration
  // gateway by design -- a viewer sets initial conditions and presses "Let's go
  // live" -- so the root route no longer mounts the world. This spec was added
  // in the same commit that made the gateway the default, shipping both facts at
  // once; it is the stale half. Every assertion below is unchanged: this is the
  // real live API + SSE path, not the canned `?source=event-demo` client.
  const documentResponse = await page.goto('/?renderer=living-atlas');
  expect(documentResponse?.ok()).toBe(true);

  await page.waitForFunction(() => window.__vivariumWorld?.isReady === true);
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
  await expect(page.getByTestId('archive-chronicle')).toBeVisible({
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
  await page.waitForFunction(() => performance.getEntriesByType('resource')
    .some((entry) => new URL(entry.name, location.href).pathname.includes('/assets/WorldRenderer-')), null, {
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
  const quiescentWorld = await fetchWorldSnapshot(page);
  expect(quiescentWorld.body.event_cursor).toBe(mechanicsBurst.body.end_cursor);

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

  // Whole-run event vocabulary, read from the DURABLE archive rather than the live
  // feed. `/api/events` is backed by a ring buffer (`ServerSettings.feed_maxlen`,
  // 512), so `?cursor=0` does not mean "since the beginning" -- it means "since the
  // oldest event still retained", which the envelope reports as `oldest_cursor` with
  // `overflow: true`. Locally the whole run fits and the two sources look identical;
  // on a runner they do not, and asserting the vocabulary against the feed made this
  // spec fail in CI run 32543802379 with a `Received` list of nothing but `speak`.
  //
  // Measured against the harness this spec runs (`tests/frontend_live/live_api_server.py`,
  // 4 breathing agents, 120s of run duration): the buffer overflows ~70s in, well
  // inside the run's own lifetime and long before a software-rasterising runner has
  // crawled from page load to here. The burst survives eviction only because
  // `/api/test/mechanics/run` quiesces the breathing loop, so nothing is appended
  // after it; `simulation_started`, emitted at cursor 1, does not. That is the whole
  // failure: one true event, correctly forgotten by a live feed that is meant to
  // forget. Raising `feed_maxlen` would only move the wrap later, and any value loses
  // to a longer run.
  //
  // `/api/replay/artifacts/events` is the lossless sink of the same `CompositeEventLog`
  // (`scripts/run.py`) -- every event, in order, no bound -- streamed whole as NDJSON,
  // so there is no page to walk and no page budget to silently truncate against
  // (`/api/replay/events` has both). The SSE stream is the other candidate and is
  // rejected for the same reason the feed is: the client subscribes at the snapshot's
  // cursor, so the union of what it observes can never contain the run's opening
  // events.
  const runEventArtifact = await fetchJsonlArtifact(page, '/api/replay/artifacts/events');

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
    builtAssets: {
      scripts: Array.from(document.scripts).map((node) => new URL(node.src, location.href).pathname),
      styles: Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map((node) => new URL(node.href, location.href).pathname),
      resources: performance.getEntriesByType('resource')
        .map((entry) => new URL(entry.name, location.href).pathname),
      viteClient: performance.getEntriesByType('resource')
        .some((entry) => new URL(entry.name, location.href).pathname.includes('/@vite/client')),
    },
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
  expect(browserState.diagnostics.eventCursor).toBeGreaterThan(0);
  expect(browserState.diagnostics.lastAcceptedSnapshotCursor).toBeGreaterThan(0);
  expect(browserState.stagePixels).toBeGreaterThan(20);
  expect(browserState.canvasCount).toBe(1);
  expect(browserState.previewHandlePresent).toBe(false);
  expect(browserState.builtAssets.scripts.some((asset) => /^\/assets\/index-.*\.js$/.test(asset))).toBe(true);
  expect(browserState.builtAssets.styles.some((asset) => /^\/assets\/index-.*\.css$/.test(asset))).toBe(true);
  expect(browserState.builtAssets.resources.some((asset) => /^\/assets\/WorldRenderer-.*\.js$/.test(asset))).toBe(true);
  expect(browserState.builtAssets.viteClient).toBe(false);
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
    earlierPointButtons: 1,
    archiveButtons: 0,
    replayButtons: 0,
    worldButtons: 0,
    seekCopy: false,
  });
  expect(eventsEnvelope.ok).toBe(true);
  expect(eventsEnvelope.status).toBe(200);
  expect(eventsEnvelope.body.schema).toBe(1);
  expect(eventsEnvelope.body.events.length).toBeGreaterThan(0);
  expect(runEventArtifact.ok).toBe(true);
  expect(runEventArtifact.status).toBe(200);
  expect(runEventArtifact.contentType).toContain('application/x-ndjson');
  // The durable sink can never hold less than the forgetful one -- it is written first
  // and never evicts -- so this pins the archive as a superset of the feed rather than
  // a stale or empty file that would make the vocabulary assertion below vacuous.
  expect(runEventArtifact.rows.length).toBeGreaterThanOrEqual(eventsEnvelope.body.events.length);
  expect(runEventArtifact.rows.map((row) => row.type))
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

// Root-route coverage. The spec above deliberately names `?renderer=living-atlas`
// because bare `/` is the landing/configuration gateway. That makes the root
// route untested by this file unless it is asserted here -- and it regressed
// once already, silently, when the gateway became the default and this suite
// kept pointing at `/`. Pin both halves so neither can drift alone.
test('the built root route serves the gateway, not the world', async ({ page }) => {
  const documentResponse = await page.goto('/');
  expect(documentResponse?.ok()).toBe(true);

  await expect(page.locator('.gateway')).toBeVisible();
  expect(await page.evaluate(() => window.__vivariumWorld === undefined)).toBe(true);
});
