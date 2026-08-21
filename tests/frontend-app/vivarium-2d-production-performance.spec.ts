import { expect, test, type CDPSession, type Page, type TestInfo } from "@playwright/test";

import {
  installProductionChronicleFixture,
  type ProductionChronicleFixture,
} from "./fixtures/production-chronicle-fixture";
import {
  VIVARIUM_2D_120_EVENTS,
} from "./fixtures/vivarium-2d-120-events";
import {
  VIVARIUM_2D_4096_CHECKPOINT_CURSORS,
  VIVARIUM_2D_4096_ENVELOPES,
} from "./fixtures/vivarium-2d-4096-envelopes";

const C13_FILE = "tests/frontend-app/fixtures/chronicles/data/C13-presentation-backlog-pause-resume.json";
const C16_FILE = "tests/frontend-app/fixtures/chronicles/data/C16-pressure-4096-envelopes.json";
const MEBIBYTE = 1_024 * 1_024;
// One active region owns exactly three static Canvas caches: terrain,
// scenery, and the continuation matte used beyond authored map edges.
const ACTIVE_REGION_CACHE_OWNERS = 3;
const ARCHIVE_CYCLES = boundedArchiveCycles(process.env.VIVARIUM_A13_ARCHIVE_CYCLES);

test("C13 production 2D preserves readable causal presentation under a 120-envelope burst", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const fixture = await installProductionChronicleFixture(
    page,
    VIVARIUM_2D_120_EVENTS,
    C13_FILE,
  );
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.pool.inFlightCount, {
    timeout: 10_000,
  }).toBe(0);
  await startLongTaskObserver(page);

  await fixture.dispatchRange(1, 1);
  await expect(page.getByLabel("Now")).toBeVisible();
  await expect(page.locator("[data-dialogue-copy]")).toContainText("pressure-C13-0000");
  await page.getByRole("button", { name: "Pause story" }).click();
  const paused = await pressureSnapshot(page);
  expect(paused.observer.session.director.activeSceneCount).toBe(1);
  expect(paused.observer.session.ingress.lifetimeAcceptedCount).toBe(1);
  expect(paused.publicText).toContain("Received 1");
  expect(paused.publicText).not.toContain("pressure-C13-0119");

  const recoveryPhases: Array<{ name: string; at: number; snapshot: any }> = [];
  recoveryPhases.push(await timedPressureSnapshot(page, "before-dispatch"));
  await fixture.dispatchRange(2, 120);
  recoveryPhases.push(await timedPressureSnapshot(page, "dispatch-returned"));
  const acceptedPrefixCount = (
    await pressureSnapshot(page)
  ).observer.session.ingress.lifetimeAcceptedCount;
  expect(acceptedPrefixCount).toBeGreaterThan(1);
  expect(acceptedPrefixCount).toBeLessThan(120);
  recoveryPhases.push(await timedPressureSnapshot(page, "ingress-accepted"));
  await expect.poll(async () => Number(
    await page.locator(".vivarium-2d-app").getAttribute("data-presented-cursor"),
  )).toBe(120);
  recoveryPhases.push(await timedPressureSnapshot(page, "recovery-presented"));
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.pool.inFlightCount, {
    timeout: 10_000,
  }).toBe(0);
  recoveryPhases.push(await timedPressureSnapshot(page, "assets-settled"));

  await clickElement(page, "#observer-chronicle-trigger");
  await expect(page.getByRole("heading", { name: "Chronicle", exact: true })).toBeVisible();
  await expect(page.locator(".chronicle-drawer__gap")).toHaveCount(1);
  await expect(page.locator(".chronicle-drawer__gap")).toContainText("Shown range 2–120");
  await clickElement(page, "[aria-label='Close Chronicle']");

  const final = await pressureSnapshot(page);
  const longTasks = await stopLongTaskObserver(page);
  const longAnimationFrames = await readLongAnimationFrames(page);
  const drawP95Ms = percentile(final.renderer.draw.samplesMs, 0.95);
  const maximumLongTaskMs = Math.max(0, ...longTasks.map(({ duration }) => duration));
  await attach(testInfo, "c13-production-performance", {
    fixtureSha256: fixture.fixtureSha256,
    paused,
    recoveryPhases,
    final,
    drawP95Ms,
    longTasks,
    longAnimationFrames,
    requests: fixture.requests,
  });
  expect(final.observer).toMatchObject({
    stageCount: 1,
    liveSessions: 1,
    archiveSessions: 0,
    source: "live",
    session: {
      disposed: false,
      ingress: {
        ingestedCursor: 120,
        acceptedCount: 0,
        lifetimeAcceptedCount: acceptedPrefixCount,
        lifetimeDuplicateCount: 0,
        gaps: [],
      },
      director: { pendingMoments: 0, activeSceneCount: 0 },
      chronicle: { upcoming: 0, gaps: 1 },
    },
  });
  expect(final.publicText).toContain("Received 120");
  expect(final.publicText).not.toContain("pressure-C13-0119");
  expect(final.renderer.graph.activeEffects).toBeLessThanOrEqual(
    final.renderer.graph.environments.reduce(
      (capacity, environment) => capacity
        + environment.diagnostics.capacities.smoke
        + environment.diagnostics.capacities.footsteps,
      final.renderer.graph.transients.length,
    ),
  );
  expect(final.renderer.pool).toMatchObject({ inFlightCount: 0, waiterCount: 0, overBudget: false });
  expect(final.renderer.cache.outstanding).toBe(ACTIVE_REGION_CACHE_OWNERS);
  expect(drawP95Ms).toBeLessThanOrEqual(4);
  expect(final.renderer.draw.maxMs).toBeLessThanOrEqual(50);
  expect(maximumLongTaskMs).toBeLessThanOrEqual(50);
  expect(fixture.requests.worldRequests).toBe(2);
  expect(fixture.requests.external).toEqual([]);
  expect(fixture.requests.unhandledApi).toEqual([]);
  expect(fixture.requests.rawArtifacts).toEqual([]);
  expect(fixture.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);

});

test("C16 production 2D plateaus through 4096 envelopes, recovery, density and Archive churn", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  expect(VIVARIUM_2D_4096_ENVELOPES.entries).toHaveLength(4_096);
  expect(VIVARIUM_2D_4096_ENVELOPES.checkpoints.map(({ checkpoint }) => (
    checkpoint.event_cursor
  ))).toEqual(VIVARIUM_2D_4096_CHECKPOINT_CURSORS);
  const terminal = VIVARIUM_2D_4096_ENVELOPES.checkpoints.at(-1)!.checkpoint.snapshot;
  expect(terminal.agents).toHaveLength(256);
  expect(terminal.homes).toHaveLength(128);

  const fixture = await installProductionChronicleFixture(
    page,
    VIVARIUM_2D_4096_ENVELOPES,
    C16_FILE,
  );
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.pool.inFlightCount, {
    timeout: 10_000,
  }).toBe(0);
  const ingestionBaseline = await pressureSnapshot(page);
  expect(ingestionBaseline.observer.session.ingress.ingestedCursor).toBe(0);
  expect(ingestionBaseline.renderer.draw.maxMs).toBeLessThanOrEqual(50);
  await startLongTaskObserver(page);
  const ingestionPhases: Array<{ name: string; at: number }> = [
    await markPressurePhase(page, "observer-started"),
  ];
  const placements = new Map<string, string>();
  const pressureStages: any[] = [];
  const acceptedPrefixCounts: number[] = [];
  let lifetimeAcceptedCount = 0;
  let firstCursor = 1;
  for (const cursor of VIVARIUM_2D_4096_CHECKPOINT_CURSORS) {
    ingestionPhases.push(await markPressurePhase(page, `dispatch-${firstCursor}-${cursor}-start`));
    await fixture.dispatchRange(firstCursor, cursor);
    ingestionPhases.push(await markPressurePhase(page, `dispatch-${firstCursor}-${cursor}-returned`));
    await expect.poll(async () => Number(
      await page.locator(".vivarium-2d-app").getAttribute("data-presented-cursor"),
    ), { timeout: 20_000 }).toBe(cursor);
    ingestionPhases.push(await markPressurePhase(page, `cursor-${cursor}-presented`));
    await expect.poll(async () => (await pressureSnapshot(page)).renderer.pool.inFlightCount, {
      timeout: 10_000,
    }).toBe(0);
    ingestionPhases.push(await markPressurePhase(page, `cursor-${cursor}-assets-settled`));
    const sample = await pressureSnapshot(page);
    ingestionPhases.push(await markPressurePhase(page, `cursor-${cursor}-snapshot-complete`));
    assertAppendStablePlacements(sample.renderer.graph, placements);
    const nextLifetimeAcceptedCount = Number(
      sample.observer.session.ingress.lifetimeAcceptedCount,
    );
    const acceptedPrefixCount = nextLifetimeAcceptedCount - lifetimeAcceptedCount;
    expect(acceptedPrefixCount).toBeGreaterThan(48);
    expect(acceptedPrefixCount).toBeLessThan(cursor - firstCursor + 1);
    acceptedPrefixCounts.push(acceptedPrefixCount);
    lifetimeAcceptedCount = nextLifetimeAcceptedCount;
    expect(sample.observer.session.ingress).toMatchObject({
      ingestedCursor: cursor,
      acceptedCount: 0,
      lifetimeAcceptedCount,
      lifetimeDuplicateCount: 0,
      gaps: [],
    });
    expect(sample.observer.session.chronicle.gaps).toBe(pressureStages.length + 1);
    expect(sample.observer.session.director.pendingMoments).toBeLessThanOrEqual(48);
    expect(sample.observer.session.chronicle.previous).toBeLessThanOrEqual(48);
    expect(sample.observer.session.chronicle.upcoming).toBeLessThanOrEqual(48);
    expect(sample.observer.session.checkpoint.retainedSafeCheckpoints).toBeLessThanOrEqual(64);
    expect(sample.renderer.graph.ownership.actors.outstanding).toBe(sample.renderer.graph.actors.length);
    expect(sample.renderer.graph.ownership.homes.outstanding).toBe(sample.renderer.graph.homes.length);
    expect(sample.renderer.pool).toMatchObject({ inFlightCount: 0, waiterCount: 0, overBudget: false });
    pressureStages.push(sample);
    firstCursor = cursor + 1;
  }

  await fixture.dispatchOverflow(4_100);
  ingestionPhases.push(await markPressurePhase(page, "overflow-4100-dispatched"));
  await expect.poll(async () => (await pressureSnapshot(page)).observer.session.recovery.status)
    .toMatch(/idle|complete/);
  const afterGap = await pressureSnapshot(page);
  ingestionPhases.push(await markPressurePhase(page, "overflow-4100-snapshot-complete"));
  expect(afterGap.observer.session.ingress).toMatchObject({
    ingestedCursor: 4_100,
    acceptedCount: 0,
    lifetimeAcceptedCount,
    lifetimeDuplicateCount: 0,
    gaps: [],
  });
  expect(afterGap.observer.session.chronicle.gaps).toBe(5);
  expect(await page.evaluate(() => window.__vivariumChronicleActiveStreams?.())).toBe(1);
  const ingestionLongTasks = await stopLongTaskObserver(page);
  const ingestionLongAnimationFrames = await readLongAnimationFrames(page);

  const cdp = await page.context().newCDPSession(page);
  await setPageHidden(page, true);
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.scheduler)
    .toMatchObject({ hidden: true, rafScheduled: false, wakeScheduled: false });
  const baseline = await retainedState(page, cdp);
  await setPageHidden(page, false);
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.scheduler.hidden)
    .toBe(false);
  await clickElement(page, "#observer-archive-trigger");
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect.poll(async () => (await pressureSnapshot(page)).observer.archiveStatus).toBe("ready");
  const archiveBaseline = await pressureSnapshot(page);
  expect(archiveBaseline.observer).toMatchObject({ source: "live", archiveSessions: 0 });
  expect(archiveBaseline.renderer.pool).toMatchObject({
    inFlightCount: 0,
    waiterCount: 0,
    overBudget: false,
  });
  await startLongTaskObserver(page);
  const archivePhases: Array<{ name: string; at: number }> = [
    await markPressurePhase(page, "archive-observer-started"),
  ];
  let archiveWindow: any = null;
  for (let cycle = 0; cycle < ARCHIVE_CYCLES; cycle += 1) {
    archivePhases.push(await markPressurePhase(page, `archive-${cycle}-enter-start`));
    await clickElement(page, ".archive-drawer__checkpoints button");
    await page.waitForFunction(() => (
      document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-source") === "archive"
      && document.querySelectorAll(".presentation-world-stage").length === 1
      && document.querySelectorAll(".presentation-world-stage canvas").length === 1
      && document.querySelector(".presentation-world-stage")?.getAttribute("data-ready") === "true"
    ));
    archivePhases.push(await markPressurePhase(page, `archive-${cycle}-enter-ready`));
    if (cycle === ARCHIVE_CYCLES - 1) archiveWindow = await pressureSnapshot(page);
    archivePhases.push(await markPressurePhase(page, `archive-${cycle}-return-start`));
    await clickElement(page, ".archive-drawer__return");
    await page.waitForFunction(() => (
      document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-source") === "live"
      && document.querySelector(".presentation-world-stage")?.getAttribute("data-ready") === "true"
    ));
    archivePhases.push(await markPressurePhase(page, `archive-${cycle}-return-ready`));
  }
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.pool.inFlightCount, {
    timeout: 10_000,
  }).toBe(0);
  const archiveLongTasks = await stopLongTaskObserver(page);
  const archiveLongAnimationFrames = await readLongAnimationFrames(page);
  await setPageHidden(page, true);
  await expect.poll(async () => (await pressureSnapshot(page)).renderer.scheduler)
    .toMatchObject({ hidden: true, rafScheduled: false, wakeScheduled: false });
  const tail = await retainedState(page, cdp);
  const final = await pressureSnapshot(page);
  if (archiveWindow === null) throw new Error("Archive draw window was not captured");
  const drawWindows = [
    ...pressureStages.map((sample, index) => ({
      name: `pressure-${VIVARIUM_2D_4096_CHECKPOINT_CURSORS[index]}`,
      draw: sample.renderer.draw,
    })),
    { name: "after-gap", draw: afterGap.renderer.draw },
    { name: "archive", draw: archiveWindow.renderer.draw },
    { name: "final", draw: final.renderer.draw },
  ].map(({ name, draw }) => ({
    name,
    count: draw.count as number,
    maxMs: draw.maxMs as number,
    p95Ms: percentile(draw.samplesMs as number[], 0.95),
    samplesMs: draw.samplesMs as number[],
  }));
  const allDrawSamples = drawWindows.flatMap(({ samplesMs }) => samplesMs);
  const drawP95Ms = percentile(allDrawSamples, 0.95);
  const drawSampleCount = allDrawSamples.length;
  const maximumIngestionLongTaskMs = Math.max(
    0,
    ...ingestionLongTasks.map(({ duration }) => duration),
  );
  const maximumArchiveLongTaskMs = Math.max(
    0,
    ...archiveLongTasks.map(({ duration }) => duration),
  );
  await attach(testInfo, "c16-production-pressure", {
    fixtureSha256: fixture.fixtureSha256,
    ingestionBaseline,
    archiveBaseline,
    pressureStages,
    acceptedPrefixCounts,
    afterGap,
    baseline,
    tail,
    final,
    drawP95Ms,
    drawSampleCount,
    drawWindows,
    ingestionPhases,
    ingestionLongTasks,
    ingestionLongAnimationFrames,
    archiveLongTasks,
    archiveLongAnimationFrames,
    archivePhases,
    requests: fixture.requests,
    gcSupported: true,
  });
  console.info("C16_PERFORMANCE_METRICS", JSON.stringify({
    drawP95Ms,
    drawMaximumMs: Math.max(0, ...drawWindows.map(({ maxMs }) => maxMs)),
    maximumIngestionLongTaskMs,
    maximumArchiveLongTaskMs,
    ingestionLongTaskCount: ingestionLongTasks.length,
    archiveLongTaskCount: archiveLongTasks.length,
    topIngestionScripts: topLongAnimationFrameScripts(ingestionLongAnimationFrames),
    topArchiveScripts: topLongAnimationFrameScripts(archiveLongAnimationFrames),
    caches: {
      ingestionBaseline: ingestionBaseline.renderer.cache,
      archiveBaseline: archiveBaseline.renderer.cache,
      archiveWindow: archiveWindow.renderer.cache,
      final: final.renderer.cache,
    },
  }));

  expect(final.observer).toMatchObject({ stageCount: 1, liveSessions: 1, archiveSessions: 0, source: "live" });
  expect(final.renderer.scheduler).toMatchObject({
    hidden: true,
    rafScheduled: false,
    wakeScheduled: false,
  });
  expect(final.renderer.cache.outstanding).toBe(ACTIVE_REGION_CACHE_OWNERS);
  expect(final.renderer.cache).toMatchObject({
    created: archiveBaseline.renderer.cache.created,
    disposed: archiveBaseline.renderer.cache.disposed,
    outstanding: ACTIVE_REGION_CACHE_OWNERS,
    lastRebuildReason: "region",
  });
  expect(final.renderer.staticLayerRebuilds).toBe(archiveBaseline.renderer.staticLayerRebuilds);
  expect(final.renderer.pool).toMatchObject({ inFlightCount: 0, waiterCount: 0, overBudget: false });
  expect(tail.heap.usedSize - baseline.heap.usedSize).toBeLessThanOrEqual(4 * MEBIBYTE);
  expect(tail.heap.embedderHeapUsedSize - baseline.heap.embedderHeapUsedSize).toBeLessThanOrEqual(8 * MEBIBYTE);
  expect(tail.heap.backingStorageSize - baseline.heap.backingStorageSize).toBeLessThanOrEqual(4 * MEBIBYTE);
  expect(tail.dom.nodes).toBeLessThanOrEqual(baseline.dom.nodes + 500);
  expect(tail.dom.jsEventListeners).toBeLessThanOrEqual(baseline.dom.jsEventListeners + 25);
  expect(drawSampleCount).toBeGreaterThan(0);
  expect(drawP95Ms).toBeLessThanOrEqual(4);
  for (const window of drawWindows) {
    expect(window.maxMs, `${window.name} raw draw max`).toBeLessThanOrEqual(50);
  }
  expect(maximumIngestionLongTaskMs).toBeLessThanOrEqual(50);
  expect(maximumArchiveLongTaskMs).toBeLessThanOrEqual(50);
  expect(fixture.requests.external).toEqual([]);
  expect(fixture.requests.unhandledApi).toEqual([]);
  expect(fixture.requests.rawArtifacts).toEqual([]);

});

async function pressureSnapshot(page: Page): Promise<any> {
  return page.evaluate(async () => {
    const stage = document.querySelector(".presentation-world-stage");
    const app = document.querySelector(".vivarium-2d-app");
    if (stage === null || app === null) throw new Error("production 2D surfaces are unavailable");
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    let renderer = accessor?.snapshot(stage) ?? null;
    let observer = accessor?.snapshot(app) ?? null;
    if (accessor === undefined) {
      const debug = await import("/src/renderer2d/production/debug.ts");
      renderer = debug.getProductionStageDebugProbe(stage)?.snapshot() ?? null;
      observer = debug.getProductionStageDebugProbe(app)?.snapshot() ?? null;
    }
    if (renderer === null || observer === null) throw new Error("production diagnostics are unavailable");
    return { renderer, observer, publicText: document.body.innerText };
  });
}

async function timedPressureSnapshot(page: Page, name: string) {
  const snapshot = await pressureSnapshot(page);
  const at = await page.evaluate(() => performance.now());
  return { name, at, snapshot };
}

async function startLongTaskObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const scope = window as typeof window & {
      __vivariumLongTasks?: Array<{
        startTime: number;
        duration: number;
        name: string;
        attribution: readonly Readonly<{
          name: string;
          containerType: string;
          containerName: string;
          containerId: string;
          containerSrc: string;
        }>[];
      }>;
      __vivariumLongTaskObserver?: PerformanceObserver;
      __vivariumLongAnimationFrames?: unknown[];
      __vivariumLongAnimationFrameObserver?: PerformanceObserver;
      __vivariumRecordLongAnimationFrames?: (entries: readonly PerformanceEntry[]) => void;
    };
    scope.__vivariumLongTasks = [];
    if (typeof PerformanceObserver === "undefined") return;
    scope.__vivariumLongTaskObserver = new PerformanceObserver((list) => {
      scope.__vivariumLongTasks!.push(...list.getEntries().map((entry) => {
        const timing = entry as PerformanceEntry & {
          attribution?: readonly Readonly<{
            name: string;
            containerType: string;
            containerName: string;
            containerId: string;
            containerSrc: string;
          }>[];
        };
        return {
          startTime: timing.startTime,
          duration: timing.duration,
          name: timing.name,
          attribution: (timing.attribution ?? []).map((attribution) => ({ ...attribution })),
        };
      }));
    });
    scope.__vivariumLongTaskObserver.observe({ entryTypes: ["longtask"] });
    scope.__vivariumLongAnimationFrames = [];
    scope.__vivariumRecordLongAnimationFrames = (entries): void => {
      scope.__vivariumLongAnimationFrames!.push(...entries.map((entry) => {
        const frame = entry as PerformanceEntry & {
          blockingDuration?: number;
          renderStart?: number;
          styleAndLayoutStart?: number;
          scripts?: readonly Readonly<{
            duration?: number;
            forcedStyleAndLayoutDuration?: number;
            invoker?: string;
            pauseDuration?: number;
            sourceCharPosition?: number;
            sourceFunctionName?: string;
            sourceURL?: string;
          }>[];
        };
        return {
          startTime: frame.startTime,
          duration: frame.duration,
          blockingDuration: frame.blockingDuration ?? 0,
          renderStart: frame.renderStart ?? 0,
          styleAndLayoutStart: frame.styleAndLayoutStart ?? 0,
          scripts: (frame.scripts ?? []).map((script) => ({
            duration: script.duration ?? 0,
            forcedStyleAndLayoutDuration: script.forcedStyleAndLayoutDuration ?? 0,
            invoker: script.invoker ?? "",
            pauseDuration: script.pauseDuration ?? 0,
            sourceCharPosition: script.sourceCharPosition ?? -1,
            sourceFunctionName: script.sourceFunctionName ?? "",
            sourceURL: script.sourceURL ?? "",
          })),
        };
      }));
    };
    scope.__vivariumLongAnimationFrameObserver = new PerformanceObserver((list) => {
      scope.__vivariumRecordLongAnimationFrames!(list.getEntries());
    });
    scope.__vivariumLongAnimationFrameObserver.observe({ type: "long-animation-frame" });
  });
}

async function stopLongTaskObserver(page: Page) {
  return page.evaluate(() => {
    const scope = window as typeof window & {
      __vivariumLongTasks?: Array<{
        startTime: number;
        duration: number;
        name: string;
        attribution: readonly Readonly<{
          name: string;
          containerType: string;
          containerName: string;
          containerId: string;
          containerSrc: string;
        }>[];
      }>;
      __vivariumLongTaskObserver?: PerformanceObserver;
      __vivariumLongAnimationFrames?: unknown[];
      __vivariumLongAnimationFrameObserver?: PerformanceObserver;
      __vivariumRecordLongAnimationFrames?: (entries: readonly PerformanceEntry[]) => void;
    };
    scope.__vivariumLongTasks?.push(...(scope.__vivariumLongTaskObserver?.takeRecords() ?? [])
      .map((entry) => {
        const timing = entry as PerformanceEntry & {
          attribution?: readonly Readonly<{
            name: string;
            containerType: string;
            containerName: string;
            containerId: string;
            containerSrc: string;
          }>[];
        };
        return {
          startTime: timing.startTime,
          duration: timing.duration,
          name: timing.name,
          attribution: (timing.attribution ?? []).map((attribution) => ({ ...attribution })),
        };
      }));
    scope.__vivariumLongTaskObserver?.disconnect();
    scope.__vivariumRecordLongAnimationFrames?.(
      scope.__vivariumLongAnimationFrameObserver?.takeRecords() ?? [],
    );
    scope.__vivariumLongAnimationFrameObserver?.disconnect();
    return scope.__vivariumLongTasks ?? [];
  });
}

async function readLongAnimationFrames(page: Page): Promise<readonly unknown[]> {
  return page.evaluate(() => {
    const scope = window as typeof window & { __vivariumLongAnimationFrames?: unknown[] };
    return scope.__vivariumLongAnimationFrames ?? [];
  });
}

async function markPressurePhase(page: Page, name: string): Promise<{ name: string; at: number }> {
  return { name, at: await page.evaluate((phaseName) => {
    performance.mark(`vivarium:${phaseName}`);
    return performance.now();
  }, name) };
}

function percentile(samples: readonly number[], quantile: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]!;
}

function boundedArchiveCycles(value: string | undefined): number {
  if (value === undefined) return 25;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 25) {
    throw new Error("VIVARIUM_A13_ARCHIVE_CYCLES must be an integer from 1 through 25");
  }
  return parsed;
}

function topLongAnimationFrameScripts(entries: readonly unknown[]): readonly Readonly<{
  duration: number;
  forcedStyleAndLayoutDuration: number;
  sourceCharPosition: number;
  sourceFunctionName: string;
  sourceURL: string;
}>[] {
  const scripts: Array<{
    duration: number;
    forcedStyleAndLayoutDuration: number;
    sourceCharPosition: number;
    sourceFunctionName: string;
    sourceURL: string;
  }> = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const candidates = (entry as { scripts?: unknown }).scripts;
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (candidate === null || typeof candidate !== "object") continue;
      const script = candidate as Record<string, unknown>;
      scripts.push({
        duration: typeof script.duration === "number" ? script.duration : 0,
        forcedStyleAndLayoutDuration: typeof script.forcedStyleAndLayoutDuration === "number"
          ? script.forcedStyleAndLayoutDuration
          : 0,
        sourceCharPosition: typeof script.sourceCharPosition === "number"
          ? script.sourceCharPosition
          : -1,
        sourceFunctionName: typeof script.sourceFunctionName === "string"
          ? script.sourceFunctionName
          : "",
        sourceURL: typeof script.sourceURL === "string" ? script.sourceURL : "",
      });
    }
  }
  return scripts.sort((left, right) => right.duration - left.duration).slice(0, 5);
}

function assertAppendStablePlacements(graph: any, retained: Map<string, string>): void {
  for (const actor of graph.actors) {
    const key = `actor:${actor.id}`;
    const value = `${actor.position.x},${actor.position.y}`;
    expect(retained.get(key) ?? value).toBe(value);
    retained.set(key, value);
  }
  for (const home of graph.homes) {
    const key = `home:${home.id}`;
    const value = `${home.plot.x},${home.plot.y}:${home.door.x},${home.door.y}`;
    expect(retained.get(key) ?? value).toBe(value);
    retained.set(key, value);
  }
}

async function retainedState(page: Page, cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const heap = await cdp.send("Runtime.getHeapUsage") as {
    usedSize: number;
    totalSize: number;
    embedderHeapUsedSize: number;
    backingStorageSize: number;
  };
  const dom = await cdp.send("Memory.getDOMCounters") as {
    documents: number;
    nodes: number;
    jsEventListeners: number;
  };
  return { heap, dom };
}

async function setPageHidden(page: Page, hidden: boolean): Promise<void> {
  await page.evaluate((nextHidden) => {
    Object.defineProperty(document, "hidden", { configurable: true, value: nextHidden });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: nextHidden ? "hidden" : "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

async function clickElement(page: Page, selector: string): Promise<void> {
  await page.evaluate((value) => {
    const element = document.querySelector<HTMLElement>(value);
    if (element === null) throw new Error(`missing click target ${value}`);
    element.click();
  }, selector);
}

async function attach(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  await testInfo.attach(name, {
    contentType: "application/json",
    body: JSON.stringify(value, null, 2),
  });
}
