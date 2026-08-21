import { expect, test, type Page, type Route } from "@playwright/test";

const RUN_ID = "perf-run";
const EVENT_COUNT = 600;
const LATEST_CHECKPOINT_LINE = 80;

const run = {
  schema: 1,
  run_id: RUN_ID,
  seed: 7,
  started_at: 1_782_948_044.1,
  status: "running",
  event_cursor: EVENT_COUNT,
  world_time: 600,
  config_hash: "perf",
  constants: {},
  provider: "ollama",
  model: "qwen3:8b",
  context_window: null,
  timing: { pace: 0, duration: 10, world_tick_interval: 1, refresh_interval: 15 },
  artifacts: {
    events: "events.jsonl",
    usage: "usage.jsonl",
    snapshots: "snapshots.jsonl",
    memory_root: "memory",
  },
};

const liveWorld = worldAt(EVENT_COUNT, 600);

test("bounded replay and renderers stay bounded across repeated snapshots", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  let worldRequestCount = 0;
  let rawExportRequestCount = 0;
  let serveResourceChange = false;

  await page.addInitScript(() => {
    (window as typeof window & { __vivariumEnableSnapshotRefreshForTest?: boolean })
      .__vivariumEnableSnapshotRefreshForTest = true;
    class QuietEventSource extends EventTarget {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSED = 2;
      readonly CONNECTING = 0;
      readonly OPEN = 1;
      readonly CLOSED = 2;
      readonly url: string;
      readonly withCredentials = false;
      readyState = QuietEventSource.CONNECTING;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string | URL) {
        super();
        this.url = String(url);
        queueMicrotask(() => {
          this.readyState = QuietEventSource.OPEN;
          this.onopen?.(new Event("open"));
        });
      }

      close(): void {
        this.readyState = QuietEventSource.CLOSED;
      }
    }
    Object.defineProperty(window, "EventSource", {
      configurable: true,
      value: QuietEventSource,
    });
  });

  await page.route("**/api/run", (route) => fulfillJson(route, run));
  await page.route("**/api/world", (route) => {
    worldRequestCount += 1;
    return fulfillJson(route, serveResourceChange ? resourceChangedWorld() : liveWorld);
  });
  await page.route("**/api/events?cursor=*", (route) => fulfillJson(route, {
    schema: 1,
    cursor: EVENT_COUNT,
    oldest_cursor: EVENT_COUNT,
    next_cursor: EVENT_COUNT,
    events: [],
    overflow: false,
    snapshot_required: false,
  }));
  await page.route("**/api/replay/artifacts/**", (route) => {
    rawExportRequestCount += 1;
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/replay/manifest", (route) => fulfillJson(route, {
    schema: 1,
    run_id: RUN_ID,
    events: { count: EVENT_COUNT, first_cursor: 1, last_cursor: EVENT_COUNT },
    checkpoints: {
      count: LATEST_CHECKPOINT_LINE,
      first_line: 1,
      last_line: LATEST_CHECKPOINT_LINE,
      first_event_cursor: EVENT_COUNT,
      last_event_cursor: EVENT_COUNT,
    },
    bootstrap: { event_after: 88, event_limit: 512 },
  }));
  await page.route("**/api/replay/checkpoints/latest", (route) => fulfillJson(route, {
    schema: 1,
    run_id: RUN_ID,
    line: LATEST_CHECKPOINT_LINE,
    checkpoint: checkpointAt(LATEST_CHECKPOINT_LINE, EVENT_COUNT),
  }));
  await page.route("**/api/replay/checkpoints?*", (route) => {
    const url = new URL(route.request().url());
    const before = Number(url.searchParams.get("before"));
    const limit = Number(url.searchParams.get("limit"));
    const firstLine = Math.max(1, before - limit);
    const checkpoints = Array.from(
      { length: Math.max(0, before - firstLine) },
      (_, index) => {
        const line = firstLine + index;
        return { line, checkpoint: checkpointAt(line, EVENT_COUNT) };
      },
    );
    return fulfillJson(route, {
      schema: 1,
      run_id: RUN_ID,
      before,
      next_before: checkpoints[0]?.line ?? before,
      has_more: firstLine > 1,
      checkpoints,
    });
  });
  await page.route("**/api/replay/events?*", (route) => {
    const url = new URL(route.request().url());
    const after = Number(url.searchParams.get("after"));
    const limit = Number(url.searchParams.get("limit"));
    const last = Math.min(EVENT_COUNT, after + limit);
    return fulfillJson(route, {
      schema: 1,
      run_id: RUN_ID,
      after,
      next_after: last,
      has_more: last < EVENT_COUNT,
      events: Array.from(
        { length: Math.max(0, last - after) },
        (_, index) => eventEntry(after + index + 1),
      ),
    });
  });

  await page.goto("/");
  await expect(page.locator('[data-testid="vivarium-world-canvas"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Open archive — Archive Preserved view", exact: true }).click();
  await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
    "data-stage-source",
    "archive",
  );
  await expect(page.locator('[data-testid="world-stage"] canvas')).toHaveCount(1);
  await expect(page.locator('[data-testid="archive-load-older"]')).toBeVisible();
  await expect.poll(() => worldRequestCount).toBe(1);
  expect(rawExportRequestCount).toBe(0);

  await expect.poll(async () => page.evaluate(() => (
    window.__vivariumWorld?.sampleCanvasPixels() ?? 0
  ))).toBeGreaterThan(0);
  const archivePixels = await page.evaluate(() => (
    window.__vivariumWorld?.sampleCanvasPixels() ?? 0
  ));

  expect(await overlappingPanelPairs(page)).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("perf-desktop.png"), fullPage: true });

  const firstArchiveFrameSample = await rendererDiagnostics(page);
  await page.waitForTimeout(600);
  const secondArchiveFrameSample = await rendererDiagnostics(page);
  const archiveFrameDelta = secondArchiveFrameSample.frameCount - firstArchiveFrameSample.frameCount;
  expect(secondArchiveFrameSample.renderMode).toBe("demand");
  expect(archiveFrameDelta).toBe(0);
  expect(secondArchiveFrameSample.frameScheduled).toBe(false);

  await page.getByRole("button", { name: "Close archive", exact: true }).click();
  await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
    "data-stage-source",
    "live",
  );
  const firstFrameSample = await rendererDiagnostics(page);
  await page.waitForTimeout(600);
  const secondFrameSample = await rendererDiagnostics(page);
  const liveFrameDelta = secondFrameSample.frameCount - firstFrameSample.frameCount;
  expect(liveFrameDelta).toBeGreaterThan(0);
  expect(liveFrameDelta).toBeLessThanOrEqual(38);
  expect(secondFrameSample.renderMode).toBe("live");
  expect(secondFrameSample.frameScheduled).toBe(true);

  await page.evaluate(() => {
    const scope = window as typeof window & {
      __vivariumPerfLongTasks?: number[];
      __vivariumPerfLongTaskObserver?: PerformanceObserver;
    };
    scope.__vivariumPerfLongTasks = [];
    if (typeof PerformanceObserver === "undefined") {
      return;
    }
    scope.__vivariumPerfLongTaskObserver = new PerformanceObserver((list) => {
      scope.__vivariumPerfLongTasks?.push(
        ...list.getEntries().map((entry) => entry.duration),
      );
    });
    scope.__vivariumPerfLongTaskObserver.observe({ entryTypes: ["longtask"] });
  });
  const beforeRefresh = await rendererDiagnostics(page);
  const refreshDurations = await page.evaluate(async () => {
    const debug = window.__vivariumLiveRun;
    if (!debug?.refreshSnapshotForTest) {
      throw new Error("Snapshot refresh test hook is unavailable.");
    }
    const durations: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const startedAt = performance.now();
      await debug.refreshSnapshotForTest();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      durations.push(performance.now() - startedAt);
    }
    return durations;
  });
  const afterRefresh = await rendererDiagnostics(page);
  expect(worldRequestCount).toBe(6);
  expect(afterRefresh.staticRebuildCount).toBe(beforeRefresh.staticRebuildCount);
  expect(afterRefresh.dynamicSnapshotUpdateCount).toBe(
    beforeRefresh.dynamicSnapshotUpdateCount + 5,
  );
  expect(afterRefresh.resourceColorRebuildCount).toBe(
    beforeRefresh.resourceColorRebuildCount,
  );
  expect(afterRefresh.entityRebuildCount).toBe(beforeRefresh.entityRebuildCount);
  expect(afterRefresh.proposalRebuildCount).toBe(beforeRefresh.proposalRebuildCount);
  expect(Math.max(...refreshDurations)).toBeLessThanOrEqual(50);
  const longTasks = await page.evaluate(() => (
    window as typeof window & { __vivariumPerfLongTasks?: number[] }
  ).__vivariumPerfLongTasks ?? []);
  expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(50);

  serveResourceChange = true;
  const beforeResourceChange = await rendererDiagnostics(page);
  const resourceRefreshDuration = await page.evaluate(async () => {
    const debug = window.__vivariumLiveRun;
    if (!debug?.refreshSnapshotForTest) {
      throw new Error("Snapshot refresh test hook is unavailable.");
    }
    const startedAt = performance.now();
    await debug.refreshSnapshotForTest();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return performance.now() - startedAt;
  });
  const afterResourceChange = await rendererDiagnostics(page);
  expect(worldRequestCount).toBe(7);
  expect(afterResourceChange.staticRebuildCount).toBe(
    beforeResourceChange.staticRebuildCount,
  );
  expect(afterResourceChange.resourceColorRebuildCount).toBe(
    beforeResourceChange.resourceColorRebuildCount + 1,
  );
  expect(afterResourceChange.resourceAbundanceRebuildCount).toBe(
    beforeResourceChange.resourceAbundanceRebuildCount + 1,
  );
  expect(afterResourceChange.entityRebuildCount).toBe(
    beforeResourceChange.entityRebuildCount,
  );
  expect(afterResourceChange.proposalRebuildCount).toBe(
    beforeResourceChange.proposalRebuildCount,
  );
  expect(resourceRefreshDuration).toBeLessThanOrEqual(50);

  await page.getByRole("button", { name: "Open archive — Archive Preserved view", exact: true }).click();
  await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
    "data-stage-source",
    "archive",
  );
  await page.locator('[data-testid="archive-load-older"]').click();
  await expect(page.locator('[data-testid="archive-point-selector"] option')).toHaveCount(64);
  await expect(page.locator('[data-testid="archive-load-older"]')).toBeVisible();
  const optionCount = await page.locator("option").count();
  const domElementCount = await page.locator("body *").count();
  expect(optionCount).toBeLessThanOrEqual(320);
  expect(domElementCount).toBeLessThanOrEqual(1_500);
  expect(rawExportRequestCount).toBe(0);

  await page.waitForTimeout(300);
  const idlePreview = await rendererDiagnostics(page);
  await page.waitForTimeout(300);
  const laterPreview = await rendererDiagnostics(page);
  expect(laterPreview.frameCount).toBe(idlePreview.frameCount);
  expect(laterPreview.frameScheduled).toBe(false);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const mobilePixels = await page.evaluate(() => window.__vivariumWorld?.sampleCanvasPixels() ?? 0);
  expect(mobilePixels).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("perf-mobile.png"), fullPage: true });

  await page.getByRole("button", { name: "Close archive", exact: true }).click();
  await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
    "data-stage-source",
    "live",
  );
  await page.waitForFunction(() => (
    window.__vivariumWorld?.isReady === true
    && window.__vivariumWorld.renderBudgetDiagnostics().renderMode === "live"
  ));

  const denseBurstMetrics = await page.evaluate(async ({ eventCount, firstCursor }) => {
    const debug = window.__vivariumWorld;
    if (!debug) {
      throw new Error("World renderer diagnostics are unavailable.");
    }
    const longTasks: Array<{ startTime: number; duration: number }> = [];
    const observer = typeof PerformanceObserver === "undefined"
      ? null
      : new PerformanceObserver((list) => {
          longTasks.push(...list.getEntries().map((entry) => ({
            startTime: entry.startTime,
            duration: entry.duration,
          })));
        });
    observer?.observe({ entryTypes: ["longtask"] });
    const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
    let layoutRectReadCount = 0;
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      layoutRectReadCount += 1;
      return originalGetBoundingClientRect.call(this);
    };
    const eventDurations: number[] = [];
    const frameRectReadCounts: number[] = [];
    let enqueueDurationMs = 0;
    const burstStartedAt = performance.now();
    const rendererBefore = debug.renderBudgetDiagnostics();
    const milestones: Record<string, number> = { burstStartedAt };
    try {
      for (let index = 0; index < eventCount; index += 1) {
        const cursor = firstCursor + index;
        const eventStartedAt = performance.now();
        debug.applyEventBeat({
          cursor,
          event: {
            type: "speak",
            source: "agent_001",
            payload: {
              speaker_id: "agent_001",
              message: `Dense bounded beat ${cursor}`,
            },
            scope: "local",
            region: "nirvana",
            target: null,
            timestamp: cursor,
          },
          resolved: { actor_id: "agent_001", region: "nirvana" },
          snapshot_after: null,
        });
        eventDurations.push(performance.now() - eventStartedAt);
      }
      enqueueDurationMs = performance.now() - burstStartedAt;
      milestones.enqueueFinishedAt = performance.now();
      let previousRectReadCount = layoutRectReadCount;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      milestones.firstAnimationFrameAt = performance.now();
      frameRectReadCounts.push(layoutRectReadCount - previousRectReadCount);
      previousRectReadCount = layoutRectReadCount;
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      milestones.secondAnimationFrameAt = performance.now();
      frameRectReadCounts.push(layoutRectReadCount - previousRectReadCount);
    } finally {
      Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    milestones.afterSettleAt = performance.now();
    longTasks.push(...(observer?.takeRecords().map((entry) => ({
      startTime: entry.startTime,
      duration: entry.duration,
    })) ?? []));
    observer?.disconnect();
    const sortedDurations = eventDurations.toSorted((left, right) => left - right);
    const p95Index = Math.min(sortedDurations.length - 1, Math.ceil(sortedDurations.length * 0.95) - 1);
    return {
      activeEffectCount: debug.effectLifecycleDiagnostics().activeEffectCount,
      appliedDenseCursorCount: debug.appliedEventCursors()
        .filter((cursor) => cursor >= firstCursor).length,
      culledEffectCount: debug.effectLifecycleDiagnostics().culledEffectCount,
      enqueueDurationMs,
      eventP95Ms: sortedDurations[p95Index] ?? 0,
      layoutRectReadCount,
      maximumLayoutRectReadsPerFrame: Math.max(0, ...frameRectReadCounts),
      maximumLongTaskDurationMs: Math.max(0, ...longTasks.map((entry) => entry.duration)),
      longTasks,
      milestones,
      rendererBefore,
      rendererAfter: debug.renderBudgetDiagnostics(),
      atmosphere: debug.atmosphereState(),
    };
  }, { eventCount: 96, firstCursor: EVENT_COUNT + 1 });
  expect(denseBurstMetrics.activeEffectCount).toBeLessThanOrEqual(96);
  expect(denseBurstMetrics.appliedDenseCursorCount).toBe(96);
  expect(denseBurstMetrics.culledEffectCount).toBeGreaterThan(0);
  expect(denseBurstMetrics.eventP95Ms).toBeLessThanOrEqual(8);
  expect(denseBurstMetrics.maximumLayoutRectReadsPerFrame).toBeLessThanOrEqual(250);
  expect(
    denseBurstMetrics.maximumLongTaskDurationMs,
    JSON.stringify(denseBurstMetrics),
  ).toBeLessThanOrEqual(50);

  await testInfo.attach("performance-metrics", {
    contentType: "application/json",
    body: JSON.stringify({
      liveFrameDelta,
      liveFramesPerSecond: liveFrameDelta / 0.6,
      archiveFrameDelta,
      liveRendererInfo: secondFrameSample.rendererInfo,
      idleArchiveRendererInfo: laterPreview.rendererInfo,
      repeatedRefreshDurationsMs: refreshDurations,
      maximumRepeatedRefreshDurationMs: Math.max(...refreshDurations),
      resourceRefreshDurationMs: resourceRefreshDuration,
      denseBurstMetrics,
      maximumLongTaskDurationMs: Math.max(0, ...longTasks),
      staticRebuildCountBefore: beforeRefresh.staticRebuildCount,
      staticRebuildCountAfter: afterResourceChange.staticRebuildCount,
      dynamicSnapshotUpdateCountBefore: beforeRefresh.dynamicSnapshotUpdateCount,
      dynamicSnapshotUpdateCountAfter: afterResourceChange.dynamicSnapshotUpdateCount,
      entityRebuildCountBefore: beforeRefresh.entityRebuildCount,
      entityRebuildCountAfter: afterResourceChange.entityRebuildCount,
      resourceAbundanceRebuildCountBefore:
        beforeRefresh.resourceAbundanceRebuildCount,
      resourceAbundanceRebuildCountAfter:
        afterResourceChange.resourceAbundanceRebuildCount,
      optionCount,
      domElementCount,
      desktopArchivePixels: archivePixels,
      mobileLivePixels: mobilePixels,
      rawExportRequestCount,
    }, null, 2),
  });
});

async function rendererDiagnostics(page: Page) {
  return page.evaluate(() => {
    const diagnostics = window.__vivariumWorld?.renderBudgetDiagnostics();
    if (!diagnostics) {
      throw new Error("Renderer diagnostics are unavailable.");
    }
    return diagnostics;
  });
}

async function overlappingPanelPairs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selectors = [".top-hud", ".presence-rail", ".chronicle", ".inspector"];
    const entries = selectors.flatMap((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element || element.offsetParent === null) {
        return [];
      }
      return [{ selector, rect: element.getBoundingClientRect() }];
    });
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
        const left = entries[leftIndex];
        const right = entries[rightIndex];
        const width = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const height = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (width > 1 && height > 1) {
          overlaps.push(`${left.selector}:${right.selector}`);
        }
      }
    }
    return overlaps;
  });
}

function fulfillJson(route: Route, value: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function checkpointAt(line: number, eventCursor: number) {
  const snapshot = worldAt(eventCursor, eventCursor);
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: line === LATEST_CHECKPOINT_LINE ? "world_tick" : "manual",
    run_id: RUN_ID,
    world_time: snapshot.world_time,
    event_cursor: eventCursor,
    snapshot,
  };
}

function eventEntry(cursor: number) {
  return {
    cursor,
    event: {
      type: "speak",
      source: "agent_001",
      payload: { speaker_id: "agent_001", message: `bounded event ${cursor}` },
      scope: "local",
      region: "nirvana",
      target: null,
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function worldAt(eventCursor: number, worldTime: number) {
  return {
    schema: 1,
    run_id: RUN_ID,
    world_time: worldTime,
    event_cursor: eventCursor,
    agents: [{
      id: "agent_001",
      name: "Aster",
      persona: "observer",
      position: "nirvana",
      energy: 84,
      materials: 22,
      status: "alive",
      last_mated_at: null,
      offspring_count: 0,
      died_at: null,
      home_id: null,
      is_hoarding: false,
    }],
    regions: [{
      name: "nirvana",
      description: "A bounded performance fixture.",
      connections: [],
      energy_rate: 0.2,
      materials_rate: 0.2,
      current_energy: 60,
      current_materials: 60,
      max_energy: 120,
      max_materials: 120,
    }],
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
}

function resourceChangedWorld() {
  return {
    ...liveWorld,
    regions: liveWorld.regions.map((region) => ({
      ...region,
      current_energy: region.current_energy - 5,
      current_materials: region.current_materials + 5,
    })),
  };
}
