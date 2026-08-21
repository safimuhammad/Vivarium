import {
  expect,
  test,
  type CDPSession,
  type Page,
  type Route,
  type TestInfo,
} from "@playwright/test";

const RUN_ID = "retained-heap-run";
const EVENT_COUNT = 4_096;
const LATEST_CHECKPOINT_LINE = 1_025;
const PRESSURE_CYCLE_COUNT = 12;
const CHECKPOINT_PAGE_SIZE = 64;
const EVENT_PAGE_SIZE = 512;
const MEBIBYTE = 1_024 * 1_024;
const MAXIMUM_PRESSURE_OVERHEAD_BYTES = 16 * MEBIBYTE;
const MAXIMUM_SPARSE_PLATEAU_GROWTH_BYTES = 4 * MEBIBYTE;
const MAXIMUM_EMBEDDER_PLATEAU_GROWTH_BYTES = 8 * MEBIBYTE;

const run = {
  schema: 1,
  run_id: RUN_ID,
  seed: 17,
  started_at: 1_783_567_200,
  status: "running",
  event_cursor: EVENT_COUNT,
  world_time: EVENT_COUNT,
  config_hash: "retained-heap",
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

test("retained heap plateaus while replay windows and world density churn", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  let serveDenseWorld = false;
  let worldRequestCount = 0;
  let rawExportRequestCount = 0;
  let checkpointPageRequestCount = 0;
  const checkpointLimits: number[] = [];
  const eventLimits: number[] = [];

  await enableHeapPressureHooks(page);
  await page.route("**/api/run", (route) => fulfillJson(route, run));
  await page.route("**/api/world", (route) => {
    worldRequestCount += 1;
    return fulfillJson(
      route,
      worldAt({
        dense: serveDenseWorld,
        eventCursor: EVENT_COUNT,
        worldTime: EVENT_COUNT + worldRequestCount,
      }),
    );
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
      first_event_cursor: checkpointCursor(1),
      last_event_cursor: EVENT_COUNT,
    },
    bootstrap: {
      event_after: EVENT_COUNT - EVENT_PAGE_SIZE,
      event_limit: EVENT_PAGE_SIZE,
    },
  }));
  await page.route("**/api/replay/checkpoints/latest", (route) => fulfillJson(route, {
    schema: 1,
    run_id: RUN_ID,
    line: LATEST_CHECKPOINT_LINE,
    checkpoint: checkpointAt(LATEST_CHECKPOINT_LINE),
  }));
  await page.route("**/api/replay/checkpoints?*", (route) => {
    checkpointPageRequestCount += 1;
    const url = new URL(route.request().url());
    const before = Number(url.searchParams.get("before"));
    const limit = Number(url.searchParams.get("limit"));
    checkpointLimits.push(limit);
    const firstLine = Math.max(1, before - limit);
    const checkpoints = Array.from(
      { length: Math.max(0, before - firstLine) },
      (_, index) => {
        const line = firstLine + index;
        return { line, checkpoint: checkpointAt(line) };
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
    eventLimits.push(limit);
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

  const firstWindow = await shiftReplayWindow(page);
  expect(firstWindow.optionCount).toBe(CHECKPOINT_PAGE_SIZE);
  await page.getByRole("button", { name: "Close archive", exact: true }).click();
  await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
    "data-stage-source",
    "live",
  );

  for (const dense of [true, false, true, false]) {
    serveDenseWorld = dense;
    await refreshSnapshotAndWaitForRebuild(page);
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const baseline = await retainedState(page, cdp, "baseline");
  const cycles: RetainedState[] = [];
  const replayWindows = [firstWindow];

  for (let index = 0; index < PRESSURE_CYCLE_COUNT; index += 1) {
    await page.getByRole("button", { name: "Open archive — Archive Preserved view", exact: true }).click();
    await expect(page.locator('[data-atlas-surface="archive"]')).toHaveAttribute(
      "data-open",
      "true",
    );
    await expect(page.locator('[data-testid="world-stage"] canvas')).toHaveCount(1);
    replayWindows.push(await shiftReplayWindow(page));
    await page.getByRole("button", { name: "Close archive", exact: true }).click();
    await expect(page.locator('[data-testid="world-stage"]')).toHaveAttribute(
      "data-stage-source",
      "live",
    );
    serveDenseWorld = index % 2 === 0;
    await refreshSnapshotAndWaitForRebuild(page);
    cycles.push(await retainedState(page, cdp, `cycle-${index + 1}`));
  }

  const final = cycles.at(-1);
  if (!final) {
    throw new Error("Heap pressure cycles did not produce a final sample.");
  }
  const sparseCycles = cycles.filter((_, index) => index % 2 === 1);
  const tailAnchor = sparseCycles[0];
  const maximumRetainedHeapBytes = Math.max(...cycles.map((sample) => sample.heap.usedSize));
  const maximumGrowthFromBaselineBytes = maximumRetainedHeapBytes - baseline.heap.usedSize;
  const maximumSparseHeapBytes = Math.max(
    ...sparseCycles.map((sample) => sample.heap.usedSize),
  );
  const maximumSparseGrowthBytes = maximumSparseHeapBytes - tailAnchor.heap.usedSize;
  const tailGrowthBytes = final.heap.usedSize - tailAnchor.heap.usedSize;
  const maximumSparseGeometryCount = Math.max(
    baseline.renderer.rendererInfo.geometries,
    ...cycles
      .filter((_, index) => index % 2 === 1)
      .map((sample) => sample.renderer.rendererInfo.geometries),
  );

  await attachMetrics(testInfo, {
    limitsBytes: {
      maximumPressureOverhead: MAXIMUM_PRESSURE_OVERHEAD_BYTES,
      maximumSparsePlateauGrowth: MAXIMUM_SPARSE_PLATEAU_GROWTH_BYTES,
      maximumEmbedderPlateauGrowth: MAXIMUM_EMBEDDER_PLATEAU_GROWTH_BYTES,
    },
    baseline,
    cycles,
    final,
    replayWindows,
    requests: {
      world: worldRequestCount,
      checkpointPages: checkpointPageRequestCount,
      checkpointLimits,
      eventLimits,
      rawExports: rawExportRequestCount,
    },
    derived: {
      maximumRetainedHeapBytes,
      maximumRetainedHeapMiB: bytesToMiB(maximumRetainedHeapBytes),
      maximumGrowthFromBaselineBytes,
      maximumGrowthFromBaselineMiB: bytesToMiB(maximumGrowthFromBaselineBytes),
      maximumSparseHeapBytes,
      maximumSparseHeapMiB: bytesToMiB(maximumSparseHeapBytes),
      maximumSparseGrowthBytes,
      maximumSparseGrowthMiB: bytesToMiB(maximumSparseGrowthBytes),
      tailGrowthBytes,
      tailGrowthMiB: bytesToMiB(tailGrowthBytes),
      maximumSparseGeometryCount,
    },
  });

  expect(new Set(replayWindows.map((window) => window.firstValue)).size).toBe(
    replayWindows.length,
  );
  expect(replayWindows.every((window) => window.optionCount === CHECKPOINT_PAGE_SIZE)).toBe(true);
  expect(checkpointPageRequestCount).toBe(PRESSURE_CYCLE_COUNT + 1);
  expect(checkpointLimits).toEqual(
    Array.from({ length: PRESSURE_CYCLE_COUNT + 1 }, () => CHECKPOINT_PAGE_SIZE),
  );
  expect(eventLimits.every((limit) => limit === EVENT_PAGE_SIZE)).toBe(true);
  expect(rawExportRequestCount).toBe(0);

  expect(final.optionCount).toBeLessThanOrEqual(320);
  expect(final.domElementCount).toBeLessThanOrEqual(1_500);
  expect(final.dom.nodes).toBeLessThanOrEqual(baseline.dom.nodes + 2_500);
  expect(final.dom.documents).toBeLessThanOrEqual(baseline.dom.documents + 2);
  expect(final.dom.jsEventListeners).toBeLessThanOrEqual(
    baseline.dom.jsEventListeners + 50,
  );
  expect(cycles.every((sample) => sample.optionCount <= 320)).toBe(true);
  expect(cycles.every((sample) => sample.domElementCount <= 1_500)).toBe(true);
  expect(final.renderer.entityObjectCount).toBeLessThanOrEqual(8);
  expect(final.renderer.proposalRootChildCount).toBe(0);
  expect(final.renderer.sceneObjectCount).toBeLessThanOrEqual(
    baseline.renderer.sceneObjectCount + 16,
  );
  expect(maximumSparseGeometryCount).toBeLessThanOrEqual(
    baseline.renderer.rendererInfo.geometries + 24,
  );

  expect(final.renderer.entityRebuildCount).toBeGreaterThanOrEqual(
    baseline.renderer.entityRebuildCount + PRESSURE_CYCLE_COUNT,
  );
  expect(final.renderer.resourceAbundanceRebuildCount).toBeGreaterThanOrEqual(
    baseline.renderer.resourceAbundanceRebuildCount + PRESSURE_CYCLE_COUNT,
  );
  expect(final.renderer.proposalRebuildCount).toBeGreaterThanOrEqual(
    baseline.renderer.proposalRebuildCount + PRESSURE_CYCLE_COUNT,
  );
  expect(final.renderer.disposedProposalGeometryCount).toBeGreaterThan(
    baseline.renderer.disposedProposalGeometryCount,
  );
  expect(final.renderer.disposedProposalMaterialCount).toBeGreaterThan(
    baseline.renderer.disposedProposalMaterialCount,
  );

  expect(maximumGrowthFromBaselineBytes).toBeLessThanOrEqual(
    MAXIMUM_PRESSURE_OVERHEAD_BYTES,
  );
  expect(maximumSparseGrowthBytes).toBeLessThanOrEqual(
    MAXIMUM_SPARSE_PLATEAU_GROWTH_BYTES,
  );
  expect(tailGrowthBytes).toBeLessThanOrEqual(
    MAXIMUM_SPARSE_PLATEAU_GROWTH_BYTES,
  );
  expect(final.heap.embedderHeapUsedSize).toBeLessThanOrEqual(
    tailAnchor.heap.embedderHeapUsedSize + MAXIMUM_EMBEDDER_PLATEAU_GROWTH_BYTES,
  );
  expect(final.heap.backingStorageSize).toBeLessThanOrEqual(
    tailAnchor.heap.backingStorageSize + MAXIMUM_SPARSE_PLATEAU_GROWTH_BYTES,
  );
});

interface HeapUsage {
  usedSize: number;
  totalSize: number;
  embedderHeapUsedSize: number;
  backingStorageSize: number;
}

interface DomCounters {
  documents: number;
  nodes: number;
  jsEventListeners: number;
}

interface ReplayWindowMetric {
  optionCount: number;
  firstValue: string;
  lastValue: string;
}

interface RetainedState {
  label: string;
  heap: HeapUsage;
  dom: DomCounters;
  optionCount: number;
  domElementCount: number;
  renderer: ReturnType<NonNullable<Window["__vivariumWorld"]>["renderBudgetDiagnostics"]>;
}

async function enableHeapPressureHooks(page: Page): Promise<void> {
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
}

async function refreshSnapshotAndWaitForRebuild(page: Page): Promise<void> {
  const before = await liveRendererDiagnostics(page);
  await page.evaluate(async () => {
    const refresh = window.__vivariumLiveRun?.refreshSnapshotForTest;
    if (!refresh) {
      throw new Error("Snapshot refresh test hook is unavailable.");
    }
    await refresh();
  });
  await expect.poll(async () => (
    await liveRendererDiagnostics(page)
  ).dynamicSnapshotUpdateCount).toBe(before.dynamicSnapshotUpdateCount + 1);
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

async function shiftReplayWindow(
  page: Page,
): Promise<ReplayWindowMetric> {
  const selector = page.locator('[data-testid="archive-point-selector"]');
  const previousFirstValue = await selector.locator("option").count() > 0
    ? await selector.locator("option").first().getAttribute("value") ?? ""
    : "";
  await page.locator('[data-testid="archive-load-older"]').click();
  await expect.poll(async () => selector.locator("option").count()).toBe(CHECKPOINT_PAGE_SIZE);
  await expect.poll(async () => (
    selector.locator("option").first().getAttribute("value")
  )).not.toBe(previousFirstValue);
  const values = await selector.locator("option").evaluateAll((options) => options.map((option) => ({
    value: (option as HTMLOptionElement).value,
  })));
  return {
    optionCount: values.length,
    firstValue: values[0]?.value ?? "",
    lastValue: values.at(-1)?.value ?? "",
  };
}

async function retainedState(
  page: Page,
  cdp: CDPSession,
  label: string,
): Promise<RetainedState> {
  await cdp.send("HeapProfiler.collectGarbage");
  await page.waitForTimeout(25);
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage") as HeapUsage;
  const dom = await cdp.send("Memory.getDOMCounters") as DomCounters;
  return {
    label,
    heap,
    dom,
    optionCount: await page.locator("option").count(),
    domElementCount: await page.locator("body *").count(),
    renderer: await liveRendererDiagnostics(page),
  };
}

async function liveRendererDiagnostics(page: Page) {
  return page.evaluate(() => {
    const diagnostics = window.__vivariumWorld?.renderBudgetDiagnostics();
    if (!diagnostics) {
      throw new Error("Live renderer diagnostics are unavailable.");
    }
    return diagnostics;
  });
}

async function attachMetrics(testInfo: TestInfo, metrics: unknown): Promise<void> {
  await testInfo.attach("retained-heap-metrics", {
    contentType: "application/json",
    body: JSON.stringify(metrics, null, 2),
  });
}

function fulfillJson(route: Route, value: unknown): Promise<void> {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(value),
  });
}

function checkpointAt(line: number) {
  const cursor = checkpointCursor(line);
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: line === LATEST_CHECKPOINT_LINE ? "world_tick" : "manual",
    run_id: RUN_ID,
    world_time: line,
    event_cursor: cursor,
    snapshot: worldAt({
      dense: line % 2 === 0,
      eventCursor: cursor,
      worldTime: line,
      archive: true,
    }),
  };
}

function checkpointCursor(line: number): number {
  return EVENT_COUNT - (LATEST_CHECKPOINT_LINE - line) * 2;
}

function eventEntry(cursor: number) {
  return {
    cursor,
    event: {
      type: "speak",
      source: "agent_001",
      payload: { speaker_id: "agent_001", message: `bounded heap event ${cursor}` },
      scope: "local",
      region: "nirvana",
      target: null,
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function worldAt({
  dense,
  eventCursor,
  worldTime,
  archive = false,
}: {
  dense: boolean;
  eventCursor: number;
  worldTime: number;
  archive?: boolean;
}) {
  const agentCount = archive ? (dense ? 6 : 2) : (dense ? 36 : 2);
  const homeCount = archive ? (dense ? 2 : 0) : (dense ? 12 : 0);
  const ruinCount = archive ? 0 : (dense ? 4 : 0);
  const proposalCount = archive ? 0 : (dense ? 8 : 0);
  const agents = Array.from({ length: agentCount }, (_, index) => agentAt(index));
  return {
    schema: 1,
    run_id: RUN_ID,
    world_time: worldTime,
    event_cursor: eventCursor,
    agents,
    regions: regionSnapshots(dense),
    homes: Array.from({ length: homeCount }, (_, index) => homeAt(index, false)),
    ruins: Array.from({ length: ruinCount }, (_, index) => homeAt(index + homeCount, true)),
    pending_proposals: Array.from({ length: proposalCount }, (_, index) => ({
      initiator_id: agents[index * 2].id,
      target_id: agents[index * 2 + 1].id,
      timestamp: worldTime,
      resources: { energy: 8 + index, materials: 4 + index },
    })),
  };
}

function agentAt(index: number) {
  const id = `agent_${String(index + 1).padStart(3, "0")}`;
  return {
    id,
    name: `Observer ${index + 1}`,
    persona: `heap fixture ${index + 1}`,
    position: regionNameAt(index),
    energy: 55 + index,
    materials: 12 + index,
    status: "alive",
    last_mated_at: null,
    offspring_count: index % 3,
    died_at: null,
    home_id: index < 12 ? `home_${String(index + 1).padStart(3, "0")}` : null,
    is_hoarding: index % 7 === 0,
  };
}

function homeAt(index: number, ruined: boolean) {
  const number = index + 1;
  const homeId = `home_${String(number).padStart(3, "0")}`;
  const ownerId = `agent_${String((index % 36) + 1).padStart(3, "0")}`;
  return {
    home_id: homeId,
    owner_id: ownerId,
    region: regionNameAt(index),
    integrity: ruined ? 0 : 76,
    max_integrity: 100,
    built_at: 20,
    last_upkeep_at: 100,
    last_integrity_at: 100,
    stakeholders: ruined ? [] : [ownerId],
    vault_materials: ruined ? 0 : 42 + index,
    status: ruined ? "ruin" : "standing",
    ruined_at: ruined ? 120 : null,
    remnant_materials: ruined ? 24 : 0,
    breachers: [],
    is_hoarding: false,
  };
}

const REGION_NAMES = [
  "nirvana",
  "ember-fields",
  "whispering-woods",
  "stillwater",
] as const;

function regionNameAt(index: number): string {
  return REGION_NAMES[index % REGION_NAMES.length];
}

function regionSnapshots(dense: boolean) {
  return REGION_NAMES.map((name, index) => ({
    name,
    description: `Stable heap fixture region ${index + 1}.`,
    connections: [REGION_NAMES[(index + 1) % REGION_NAMES.length]],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: dense ? 112 - index * 3 : 4 + index,
    current_materials: dense ? 108 - index * 2 : 3 + index,
    max_energy: 120,
    max_materials: 120,
  }));
}

function bytesToMiB(bytes: number): number {
  return Math.round((bytes / MEBIBYTE) * 1_000) / 1_000;
}
