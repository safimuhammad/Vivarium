import { expect, test } from "@playwright/test";

import { getChronicleManifest } from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import * as productionChronicleFixture from "./fixtures/production-chronicle-fixture";
import { VIVARIUM_2D_120_EVENTS } from "./fixtures/vivarium-2d-120-events";
import {
  VIVARIUM_2D_4096_ENVELOPES,
} from "./fixtures/vivarium-2d-4096-envelopes";
import { createC16ManualCaptureScenario } from "./fixtures/c16-manual-capture-scenario";
import { drainTerminalObserverUi } from "./fixtures/terminal-observer-ui-drain";
import {
  driveProductionCaptureClockUntilSettled,
  installTypedProductionCaptureEntry,
  productionCaptureEntrySeams,
} from "./fixtures/typed-production-capture-entry";

const C13_FILE = "tests/frontend-app/fixtures/chronicles/data/C13-presentation-backlog-pause-resume.json";
const C02_FILE = "tests/frontend-app/fixtures/chronicles/data/C02-travel-all-regions.json";
const C00_FILE = "tests/frontend-app/fixtures/chronicles/data/C00-world-four-regions-topology.json";
const C14_FILE = "tests/frontend-app/fixtures/chronicles/data/C14-transport-reconnect-checkpoint-recovery.json";
const C15_FILE = "tests/frontend-app/fixtures/chronicles/data/C15-archive-live-isolation.json";
const C16_FILE = "tests/frontend-app/fixtures/chronicles/data/C16-pressure-4096-envelopes.json";
const { installProductionChronicleFixture } = productionChronicleFixture;

test("authors C00 ambient observation from Live cursor 0 through terminal", async ({ page }) => {
  const fixture = await installProductionChronicleFixture(
    page,
    getChronicleManifest("C00"),
    C00_FILE,
  );
  expect(await page.evaluate(() => ({
    captureControl: window.__vivariumProductionCaptureClockForTest !== undefined,
    cursor: document.querySelector(".vivarium-2d-app")
      ?.getAttribute("data-presented-cursor") ?? null,
    stageReady: document.querySelector(".presentation-world-stage")
      ?.getAttribute("data-ready") ?? null,
    alert: document.querySelector("[role='alert']")?.textContent ?? null,
  }))).toEqual({
    captureControl: false,
    cursor: "0",
    stageReady: "true",
    alert: null,
  });
  expect(fixture.scenario.kind).toBe("C00");
  if (fixture.scenario.kind !== "C00") throw new Error("expected C00 scenario");

  fixture.scenario.completeAmbientObservation();

  expect(fixture.scenario.authorityTrace()).toEqual([
    {
      workload: "ambient",
      label: "live-0",
      mechanicFinalCursor: 0,
      selected: {
        source: "live",
        runId: "mock-c00-v1",
        sourceKey: "live:mock-c00-v1",
        cursor: 0,
      },
      live: {
        source: "live",
        runId: "mock-c00-v1",
        sourceKey: "live:mock-c00-v1",
        cursor: 0,
      },
      completed: false,
    },
    expect.objectContaining({
      workload: "ambient",
      label: "terminal-live-0",
      mechanicFinalCursor: 0,
      completed: true,
    }),
  ]);
  await fixture.dispose();
});

test("executes C14 transport recovery, replacement, and stale-source rejection without mechanic events", async ({ page }) => {
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const fixture = await installProductionChronicleFixture(
    page,
    getChronicleManifest("C14"),
    C14_FILE,
  );
  expect(fixture.scenario.kind).toBe("C14");
  if (fixture.scenario.kind !== "C14") throw new Error("expected C14 scenario");
  expect(await productionCaptureEntrySeams(page)).toEqual({
    clock: true,
    mountedRun: true,
  });
  await expect(fixture.scenario.recoverOnceFromOverflow()).rejects.toThrow(/gap\/413/);
  await expect(fixture.scenario.replaceRun()).rejects.toThrow(/gap\/413 and overflow/);
  await expect(fixture.scenario.deliverStaleOldRun()).rejects.toThrow(/replacement setup/);

  await driveProductionCaptureClockUntilSettled(
    page,
    fixture.scenario.recoverFromStreamErrorAndCheckpoint413(),
    { label: "C14 stream-error/checkpoint-413 recovery" },
  );
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "2");
  await driveProductionCaptureClockUntilSettled(
    page,
    fixture.scenario.recoverOnceFromOverflow(),
    { label: "C14 overflow recovery" },
  );
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "3");
  const activeOldRunSource = (await fixture.virtualSseLedger())
    .filter(({ kind }) => kind === "open").at(-1)!;
  expect(activeOldRunSource).toMatchObject({ cursor: 3, disposition: "accepted" });
  const replacement = await fixture.scenario.replaceRun();
  expect(replacement).toEqual({
    previousRunId: "mock-c14-v1",
    replacementRunId: "mock-c14-v1-replacement",
    supersededSourceId: activeOldRunSource.sourceId,
    acceptance: "typed-live-client",
  });
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-source", "live");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "0");
  expect(await mountedProductionIdentity(page)).toMatchObject({
    observerRunId: "mock-c14-v1-replacement",
    observerSourceKey: "live:mock-c14-v1-replacement",
    canvasRunId: "mock-c14-v1-replacement",
    canvasSourceKey: "live:mock-c14-v1-replacement",
  });
  await expect(fixture.scenario.deliverStaleOldRun()).resolves.toBe("rejected");
  expect(await mountedProductionIdentity(page)).toMatchObject({
    observerRunId: "mock-c14-v1-replacement",
    canvasRunId: "mock-c14-v1-replacement",
  });
  expect(fixture.scenario.authorityTrace()).toEqual([
    expect.objectContaining({ label: "old-live-0", mechanicFinalCursor: 0, completed: false }),
    expect.objectContaining({ label: "old-live-2", completed: false }),
    expect.objectContaining({ label: "old-live-3", completed: false }),
    expect.objectContaining({
      label: "replacement-live-0",
      selected: expect.objectContaining({
        runId: "mock-c14-v1-replacement",
        sourceKey: "live:mock-c14-v1-replacement",
        cursor: 0,
      }),
      live: expect.objectContaining({
        runId: "mock-c14-v1-replacement",
        cursor: 0,
      }),
      completed: false,
    }),
    expect.objectContaining({
      workload: "transport-recovery",
      label: "stale-old-run-rejected",
      mechanicFinalCursor: 0,
      completed: true,
    }),
  ]);

  expect(fixture.scenario.records.map(({ label }) => label)).toEqual([
    "cursor-gap",
    "oversized-record-413",
    "run-replacement",
  ]);
  expect(fixture.scenario.records.every(({ mechanicEventsFabricated }) => (
    mechanicEventsFabricated === false
  ))).toBe(true);
  expect(fixture.scenario.records.every(({ evidence }) => (
    evidence.mechanicEnvelopeCount === 0
    && evidence.routeLedgerSequences.length > 0
    && evidence.sseLedgerSequences.length > 0
  ))).toBe(true);
  expect(fixture.scenario.records[0]!.evidence.gapRange).toEqual({ firstCursor: 1, lastCursor: 2 });
  expect(Object.isFrozen(fixture.scenario.records)).toBe(true);
  const frozenGapRange = fixture.scenario.records[0]!.evidence.gapRange;
  expect(Object.isFrozen(frozenGapRange)).toBe(true);
  expect(() => {
    (frozenGapRange as { firstCursor: number }).firstCursor = 99;
  }).toThrow();
  expect(fixture.scenario.records[0]!.evidence.gapRange).toEqual({ firstCursor: 1, lastCursor: 2 });
  expect(fixture.requests.routeLedger.filter(({ status }) => status === 413)).toHaveLength(1);
  const sse = await fixture.virtualSseLedger();
  expect(sse.filter(({ kind }) => kind === "error")).toHaveLength(1);
  expect(sse.filter(({ kind }) => kind === "open").map(({ cursor }) => cursor)).toEqual([0, 2, 3, 0]);
  expect(sse).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "close",
      sourceId: activeOldRunSource.sourceId,
      cursor: 3,
    }),
  ]));
  expect(sse.at(-1)).toMatchObject({
    kind: "envelope",
    sourceId: activeOldRunSource.sourceId,
    sourceRunId: "mock-c14-v1",
    envelopeRunId: null,
    cursor: 99,
    overflow: true,
    snapshotRequired: true,
    eventCount: 0,
    disposition: "forced-stale-callback",
  });
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true, unmatchedRouteCount: 0 });
  expect(terminal.missingScenarioRoutes).toEqual([]);
});

test("keeps C15 Archive cursor 2 isolated while Live advances to and retains cursor 4", async ({ page }) => {
  const fixture = await installProductionChronicleFixture(
    page,
    getChronicleManifest("C15"),
    C15_FILE,
  );
  expect(fixture.scenario.kind).toBe("C15");
  if (fixture.scenario.kind !== "C15") throw new Error("expected C15 scenario");

  await fixture.scenario.primeArchiveCursor();
  await fixture.scenario.enterArchive();
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-source", "archive");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "2");
  await fixture.scenario.advanceLiveWhileArchived();
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "2");
  await fixture.scenario.returnToLive();
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-source", "live");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "4");
  expect(fixture.scenario.authorityTrace()).toEqual([
    expect.objectContaining({ label: "live-0", completed: false }),
    expect.objectContaining({ label: "live-2", completed: false }),
    expect.objectContaining({
      label: "archive-2",
      selected: {
        source: "archive",
        runId: "mock-c15-v1",
        sourceKey: "archive:mock-c15-v1:line-1:window-2-2",
        cursor: 2,
      },
      live: expect.objectContaining({ source: "live", cursor: 2 }),
      completed: false,
    }),
    expect.objectContaining({
      label: "archive-2-live-4",
      selected: expect.objectContaining({ source: "archive", cursor: 2 }),
      live: expect.objectContaining({ source: "live", cursor: 4 }),
      completed: false,
    }),
    expect.objectContaining({
      workload: "archive-live-isolation",
      label: "terminal-live-4",
      mechanicFinalCursor: 0,
      selected: expect.objectContaining({ source: "live", cursor: 4 }),
      live: expect.objectContaining({ source: "live", cursor: 4 }),
      completed: true,
    }),
  ]);

  expect(fixture.scenario.records).toEqual([
    expect.objectContaining({
      label: "archive-live-isolation",
      archiveCursor: 2,
      liveCursor: 4,
      mechanicEventsFabricated: false,
    }),
  ]);
  expect(fixture.requests.routeLedger.map(({ handler }) => handler)).toEqual(expect.arrayContaining([
    "replay-manifest",
    "replay-checkpoint-latest",
    "replay-events-page",
  ]));
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true, unmatchedRouteCount: 0 });
  expect(terminal.missingScenarioRoutes).toEqual([]);
});

test("fails closed when C14/C15 authorship drifts away from zero mechanic envelopes", () => {
  const c14 = getChronicleManifest("C14");
  const drifted = {
    ...c14,
    entries: [getChronicleManifest("C13").entries[0]],
  } as typeof c14;
  expect(() => productionChronicleFixture.validateEventlessScenarioManifest(drifted))
    .toThrow(/zero mechanic entries/);

  const c15 = getChronicleManifest("C15");
  const authorship = c15.expectedTerminal.fixtureAuthorship as Record<string, unknown>;
  expect(() => productionChronicleFixture.validateEventlessScenarioManifest({
    ...c15,
    expectedTerminal: {
      ...c15.expectedTerminal,
      fixtureAuthorship: { ...authorship, mechanicEventsFabricated: true },
    },
  })).toThrow(/mechanicEventsFabricated/);
});

test("accepts only exact read routes and audits mutation, unknown, raw-artifact, and external rejection", async ({ page }) => {
  const fixture = await installProductionChronicleFixture(
    page,
    getChronicleManifest("C14"),
    C14_FILE,
  );

  const acceptedRoutes = [
    "/api/run",
    "/api/world",
    "/api/events?cursor=0",
    "/api/replay/manifest",
    "/api/replay/checkpoints/latest",
    "/api/replay/checkpoints?before=2&limit=64",
    "/api/replay/events?after=0&limit=512",
  ];
  expect(await page.evaluate(async (paths) => Promise.all(paths.map(async (path) => (
    (await fetch(path)).status
  ))), acceptedRoutes)).toEqual([200, 200, 200, 200, 200, 200, 200]);

  const forbiddenMethods = ["POST", "PUT", "PATCH", "DELETE"];
  await page.evaluate(async ({ paths, methods }) => {
    const attempt = async (input: string, init?: RequestInit): Promise<void> => {
      try { await fetch(input, init); } catch { /* fixture rejection is expected */ }
    };
    for (const path of paths) for (const method of methods) await attempt(path, { method });
    await attempt("/api/events?cursor=not-an-integer");
    await attempt("/api/events/stream?cursor=0");
    await attempt("/api/replay/checkpoints?before=2&limit=0");
    await attempt("/api/replay/events?after=-1&limit=512");
    await attempt("/api/replay/artifacts/events");
    await attempt("/api/replay/artifacts/snapshots");
    await attempt("/api/unknown");
    await attempt("https://fixture-external.invalid/probe");
  }, { paths: acceptedRoutes, methods: forbiddenMethods });
  expect(await page.evaluate(() => {
    try {
      new EventSource("/api/events/stream?cursor=not-an-integer");
      return "accepted";
    } catch {
      return "rejected";
    }
  })).toBe("rejected");

  expect(fixture.requests.routeLedger.filter(({ disposition }) => disposition === "rejected"))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ method: "POST", path: "/api/run", handler: "api-reject" }),
      expect.objectContaining({ path: "/api/events?cursor=not-an-integer", handler: "api-reject" }),
      expect.objectContaining({ path: "/api/replay/artifacts/events", handler: "raw-artifact-reject" }),
      expect.objectContaining({ path: "/api/replay/artifacts/snapshots", handler: "raw-artifact-reject" }),
      expect.objectContaining({ path: "/api/unknown", handler: "api-reject" }),
      expect.objectContaining({ path: "/probe", handler: "external-reject" }),
    ]));
  expect(fixture.requests.rawArtifacts).toHaveLength(2);
  expect(fixture.requests.unhandledApi).toEqual(expect.arrayContaining([
    expect.stringContaining("/api/run"),
    expect.stringContaining("/api/events?cursor=not-an-integer"),
    expect.stringContaining("/api/unknown"),
  ]));
  for (const path of acceptedRoutes) for (const method of forbiddenMethods) {
    expect(fixture.requests.routeLedger).toContainEqual(expect.objectContaining({
      method,
      path,
      disposition: "rejected",
    }));
  }
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true, unmatchedRouteCount: 0 });
  expect(terminal.missingAcceptedRoutes).toEqual([]);
  expect(terminal.routeReconciliationErrors).toEqual([]);
});

test("route terminal reconciliation rejects omissions, duplicates, and key mismatches", () => {
  const observed = [{
    requestId: 1,
    sequence: 1,
    method: "GET",
    path: "/api/run",
  }];
  const exact = [{
    requestId: 1,
    sequence: 1,
    handler: "run" as const,
    method: "GET",
    path: "/api/run",
    disposition: "fulfilled" as const,
    status: 200,
  }];
  expect(productionChronicleFixture.reconcileRouteTerminalLedger(observed, exact)).toEqual([]);
  expect(productionChronicleFixture.reconcileRouteTerminalLedger(observed, [])).not.toEqual([]);
  expect(productionChronicleFixture.reconcileRouteTerminalLedger(observed, [...exact, ...exact]))
    .not.toEqual([]);
  expect(productionChronicleFixture.reconcileRouteTerminalLedger(observed, [{
    ...exact[0],
    method: "POST",
    path: "/api/world",
    handler: "world",
    status: 404,
    disposition: "rejected",
  }])).not.toEqual([]);
});

test("keeps C13 on the real production transport through bounded prefix recovery", async ({ page }) => {
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_120_EVENTS, C13_FILE);

  await fixture.dispatchRange(1, 120);

  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "120");
  const accepted = (await fixture.virtualSseLedger()).filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(accepted.map(({ cursor }) => cursor)).toEqual(
    Array.from({ length: 50 }, (_, index) => index + 1),
  );
  expect((await fixture.virtualSseLedger()).filter(({ kind }) => kind === "open").map(({ cursor }) => cursor))
    .toEqual([0, 120]);
  expect(fixture.requests.worldRequests).toBe(2);
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true });
});

test("returns a ManualClock C13 bounded prefix before safe-boundary recovery", async ({ page }) => {
  test.setTimeout(10_000);
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_120_EVENTS, C13_FILE);

  await fixture.dispatchRange(1, 1);
  await page.evaluate(() => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("manual capture clock is unavailable");
    control.advanceTo(11_000 / 30);
  });
  await page.getByRole("button", { name: "Pause story" }).click();

  const dispatch = fixture.dispatchRange(2, 120, { completion: "bounded-prefix" });
  await expect.poll(() => page.evaluate(() => (
    window.__vivariumChronicleActiveStreams?.() ?? -1
  ))).toBe(0);
  expect(Number(await page.locator(".vivarium-2d-app").getAttribute("data-presented-cursor")))
    .toBeLessThan(2);
  await expect(page.locator(".vivarium-2d-app")).toContainText("Received 50");
  await expect(Promise.race([
    dispatch.then(() => "returned" as const),
    new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 500)),
  ])).resolves.toBe("returned");
  const pausedCursor = await page.locator(".vivarium-2d-app").getAttribute("data-presented-cursor");
  const acceptedBeforeRecovery = (await fixture.virtualSseLedger()).filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(acceptedBeforeRecovery.at(-1)?.cursor).toBe(50);
  expect(acceptedBeforeRecovery.some(({ cursor }) => cursor >= 51)).toBe(false);

  // Resume is recorded public intent and a recovery-lock no-op. ManualClock
  // safe-boundary advancement below is the only recovery driver.
  await page.getByRole("button", { name: "Resume story" }).click();
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute(
    "data-presented-cursor",
    pausedCursor!,
  );
  expect(await page.evaluate(() => window.__vivariumChronicleActiveStreams?.() ?? -1)).toBe(0);
  await expect.poll(() => page.evaluate(() => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("manual capture clock is unavailable");
    control.advanceTo(control.now() + 500);
    return document.querySelector(".vivarium-2d-app")?.getAttribute("data-presented-cursor");
  })).toBe("120");
  await expect(page.locator(".vivarium-2d-app")).toContainText("Received 120");
  await expect.poll(() => page.evaluate(() => (
    window.__vivariumChronicleActiveStreams?.() ?? 0
  ))).toBeGreaterThan(0);
  expect((await fixture.virtualSseLedger()).filter(({ kind }) => kind === "open").at(-1)?.cursor)
    .toBe(120);
  expect((await fixture.virtualSseLedger()).filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  )).map(({ cursor }) => cursor)).toEqual(
    Array.from({ length: 50 }, (_, index) => index + 1),
  );

  expect(fixture.requests.worldRequests).toBe(2);
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true });
});

test("keeps default paused C13 dispatch pending until real-time safe-boundary recovery", async ({ page }) => {
  test.setTimeout(10_000);
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_120_EVENTS, C13_FILE);

  await fixture.dispatchRange(1, 1);
  await page.getByRole("button", { name: "Pause story" }).click();
  const dispatch = fixture.dispatchRange(2, 120);
  await expect.poll(() => page.evaluate(() => (
    window.__vivariumChronicleActiveStreams?.() ?? -1
  ))).toBe(0);
  await expect(Promise.race([
    dispatch.then(() => "returned" as const),
    new Promise<"blocked">((resolve) => setTimeout(() => resolve("blocked"), 250)),
  ])).resolves.toBe("blocked");

  // This public intent is a recovery-lock no-op; the ordinary real-time clock
  // reaches the safe boundary and lets the default dispatch await completion.
  await page.getByRole("button", { name: "Resume story" }).click();
  await dispatch;
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "120");
  await fixture.dispose();
});

test("carries C02 through production SSE to exact safe-checkpoint terminal truth", async ({ page }) => {
  test.setTimeout(30_000);
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const manifest = getChronicleManifest("C02");
  const fixture = await installProductionChronicleFixture(page, manifest, C02_FILE);

  expect(manifest.checkpoints).toEqual([
    expect.objectContaining({
      line: 1,
      safety: "safe-world-tick",
      checkpoint: expect.objectContaining({ reason: "world_tick", event_cursor: 20 }),
    }),
  ]);
  await fixture.dispatchRange(1, 20);
  const terminal = await advanceC02ProductionBoundaryUntilTerminal(page);
  const expected = manifest.expectedTerminal.finalSnapshot;

  expect(terminal.observerFrame).toMatchObject({
    runId: "mock-c02-v1",
    sourceKey: "live:mock-c02-v1",
    presentedCursor: 20,
    scene: null,
    world: {
      exactBaseCursor: 20,
      projectedThroughCursor: 20,
      worldTime: 1_800_020_010,
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
  });
  expect(terminal.observerFrame.world.agents).toEqual(expected.agents.map((value) => ({
    completeness: "exact",
    value,
  })));
  expect(terminal.observerFrame.world.regions).toEqual(expected.regions.map((value) => ({
    completeness: "exact",
    value,
  })));
  expect(terminal.session).toMatchObject({
    director: { activeSceneCount: 0, pendingMoments: 0 },
    checkpoint: { lastDeliveredLine: 1, retainedSafeCheckpoints: 1, faultCount: 0 },
  });
  expect(terminal.observerFrameIdentity).toEqual(terminal.canvasFrameIdentity);

  const accepted = (await fixture.virtualSseLedger()).filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(accepted.map(({ cursor, envelope }) => ({ cursor, entries: envelope?.events ?? [] })))
    .toEqual(manifest.entries.map((entry) => ({ cursor: entry.cursor, entries: [entry] })));

  const fixtureTerminal = await fixture.dispose();
  expect(fixtureTerminal).toMatchObject({
    activeStreams: 0,
    balancedSseLifecycle: true,
    unmatchedRouteCount: 0,
    routeReconciliationErrors: [],
  });
  expect(fixtureTerminal.missingScenarioRoutes).toEqual([]);
  expect(await page.evaluate(() => ({
    apps: document.querySelectorAll(".vivarium-2d-app").length,
    stages: document.querySelectorAll(".presentation-world-stage").length,
    canvases: document.querySelectorAll(".presentation-world-stage canvas").length,
    clock: window.__vivariumProductionCaptureClockForTest !== undefined,
    mountedRun: window.__vivariumProductionMountedRunForTest !== undefined,
    rendererCreations: window.__vivariumProductionCaptureTerminalForTest?.rendererCreations ?? -1,
    rendererDisposals: window.__vivariumProductionCaptureTerminalForTest?.rendererDisposals.length ?? -1,
  }))).toEqual({
    apps: 0,
    stages: 0,
    canvases: 0,
    clock: false,
    mountedRun: false,
    rendererCreations: 1,
    rendererDisposals: 1,
  });
});

test("keeps C16 on the real production transport across all max-density recoveries", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_4096_ENVELOPES, C16_FILE);
  const scenario = createC16ManualCaptureScenario(page, fixture);
  await scenario.start();
  for (let frameIndex = 0; frameIndex < 360 && !scenario.snapshot().completed; frameIndex += 1) {
    await scenario.step(frameIndex);
    await page.evaluate(() => {
      const control = window.__vivariumProductionCaptureClockForTest;
      if (control === undefined) throw new Error("manual capture clock is unavailable");
      control.advanceTo(control.now() + 1_000 / 30);
    });
  }
  expect(scenario.snapshot()).toMatchObject({
    completed: true,
    authoritativeCursor: 4_096,
    dispatchedEpochs: 4,
    epochReadyCursors: [1_024, 2_048, 3_072, 4_096],
  });
  const ledger = await fixture.virtualSseLedger();
  expect(ledger.filter(({ kind }) => kind === "open").map(({ cursor }) => cursor))
    .toEqual([0, 1_024, 2_048, 3_072, 4_096]);
  const accepted = ledger.filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(accepted).toHaveLength(200);
  expect(accepted.map(({ cursor }) => cursor)).toEqual([
    ...Array.from({ length: 50 }, (_, index) => index + 1),
    ...Array.from({ length: 50 }, (_, index) => 1_025 + index),
    ...Array.from({ length: 50 }, (_, index) => 2_049 + index),
    ...Array.from({ length: 50 }, (_, index) => 3_073 + index),
  ]);
  await fixture.dispose();
});

test("preinstalls canonical C16 envelopes and crosses measured dispatch with integer bounds only", async ({ page }) => {
  test.setTimeout(60_000);
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_4096_ENVELOPES, C16_FILE);
  const audit = await page.evaluate(async () => {
    const scope = window as typeof window & {
      __vivariumChronicleEnvelopeTableAudit?: () => Promise<Readonly<{
        sourceFixtureSha256: string;
        tableSha256: string;
        envelopeCount: number;
        firstCursor: number;
        lastCursor: number;
        deepFrozen: boolean;
      }>>;
    };
    return scope.__vivariumChronicleEnvelopeTableAudit?.() ?? null;
  });
  expect(audit).toMatchObject({
    sourceFixtureSha256: fixture.fixtureSha256,
    envelopeCount: 4_096,
    firstCursor: 1,
    lastCursor: 4_096,
    deepFrozen: true,
  });
  expect(audit?.tableSha256).toMatch(/^[0-9a-f]{64}$/);

  await page.evaluate(() => {
    const scope = window as typeof window & {
      __vivariumChronicleDispatchRange?: (firstCursor: number, lastCursor: number) => Promise<number>;
      __vivariumMeasuredDispatchArguments?: readonly unknown[];
    };
    const dispatch = scope.__vivariumChronicleDispatchRange;
    if (dispatch === undefined) throw new Error("page-side Chronicle range dispatch is unavailable");
    scope.__vivariumChronicleDispatchRange = async (...args: [number, number]): Promise<number> => {
      scope.__vivariumMeasuredDispatchArguments = structuredClone(args);
      return dispatch(args[0], args[1]);
    };
  });
  await fixture.dispatchRange(1, 3);
  expect(await page.evaluate(() => (
    (window as typeof window & { __vivariumMeasuredDispatchArguments?: readonly unknown[] })
      .__vivariumMeasuredDispatchArguments ?? null
  ))).toEqual([1, 3]);
  const accepted = (await fixture.virtualSseLedger()).filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(accepted.map(({ cursor, envelope }) => ({ cursor, envelope }))).toEqual(
    [1, 2, 3].map((cursor) => ({
      cursor,
      envelope: {
        schema: 1,
        cursor: cursor - 1,
        oldest_cursor: cursor,
        next_cursor: cursor,
        events: [VIVARIUM_2D_4096_ENVELOPES.entries[cursor - 1]],
        overflow: false,
        snapshot_required: false,
      },
    })),
  );
  await expect(page.evaluate(() => (
    window.__vivariumChronicleDispatchRange?.(0, 1)
  ))).rejects.toThrow(/safe positive integer bounds/);
  await expect(page.evaluate(() => (
    window.__vivariumChronicleDispatchRange?.(4_096, 4_097)
  ))).rejects.toThrow(/not installed/);
  await fixture.dispose();
});

test("drives ManualClock C16 through four recovered bounded-prefix epochs", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const fixture = await installProductionChronicleFixture(page, VIVARIUM_2D_4096_ENVELOPES, C16_FILE);
  const scenario = createC16ManualCaptureScenario(page, fixture);
  await scenario.start();

  const pausedMilestones: number[] = [];
  for (let frameIndex = 0; frameIndex < 360 && !scenario.snapshot().completed; frameIndex += 1) {
    await scenario.step(frameIndex);
    try {
      await page.evaluate(() => {
        const control = window.__vivariumProductionCaptureClockForTest;
        if (control === undefined) throw new Error("manual capture clock is unavailable");
        control.advanceTo(control.now() + 1_000 / 30);
      });
    } catch (error) {
      throw new Error(`C16 ManualClock advance failed at frame ${frameIndex}: ${JSON.stringify(scenario.snapshot())}`, {
        cause: error,
      });
    }
    const snapshot = scenario.snapshot();
    if (snapshot.phase === "paused-pressure") pausedMilestones.push(snapshot.authoritativeCursor);
  }

  expect(scenario.snapshot()).toMatchObject({
    phase: "complete",
    authoritativeCursor: 4_096,
    completed: true,
    dispatchedEpochs: 4,
    pausedWitnesses: 1,
    epochReadyCursors: [1_024, 2_048, 3_072, 4_096],
  });
  expect(scenario.snapshot().pausedReadyFrames).toBeGreaterThanOrEqual(2);
  expect(scenario.snapshot().pausedLagFrames).toBeGreaterThanOrEqual(2);
  expect(scenario.snapshot().epochReadyFrames.map(({ cursor }) => cursor))
    .toEqual([1_024, 2_048, 3_072, 4_096]);
  expect(scenario.snapshot().epochReadyFrames.map(({
    cursor,
    activeSceneCount,
    pendingMoments,
  }) => ({ cursor, activeSceneCount, pendingMoments }))).toEqual(
    [1_024, 2_048, 3_072, 4_096].map((cursor) => ({
      cursor,
      activeSceneCount: 0,
      pendingMoments: 0,
    })),
  );
  expect(new Set(scenario.snapshot().epochReadyFrames.map(({ frameIndex }) => frameIndex)).size)
    .toBe(4);
  expect(pausedMilestones).toContain(2_048);
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-cursor", "4096");
  const terminalDrain = await drainTerminalObserverUi(page, 4_096);
  expect(terminalDrain.announcerAfter).toBe("Caught up.");
  expect(terminalDrain.canonicalState).toMatchObject({
    presentedCursor: 4_096,
    ingestedCursor: 4_096,
    canvasLastCursor: 4_096,
    activeSceneCount: 0,
    pendingMoments: 0,
    scenePresent: false,
    identitiesMatch: true,
    acceptancePending: false,
    semanticPending: false,
    settlementComplete: true,
  });
  const terminalPublicBefore = await page.evaluate(() => ({
    clockNowMs: window.__vivariumProductionCaptureClockForTest?.now() ?? -1,
    text: document.body.innerText,
  }));
  await page.evaluate(async () => {
    const control = window.__vivariumProductionCaptureClockForTest;
    if (control === undefined) throw new Error("manual capture clock is unavailable");
    const sessionNowMs = control.now();
    for (let tick = 1; tick <= 15; tick += 1) {
      control.advanceRendererTo(sessionNowMs + tick * 500 / 15);
    }
    await new Promise<void>((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  });
  const terminalPublicAfter = await page.evaluate(() => ({
    clockNowMs: window.__vivariumProductionCaptureClockForTest?.now() ?? -1,
    text: document.body.innerText,
  }));
  expect(terminalPublicAfter.clockNowMs).toBe(terminalPublicBefore.clockNowMs);
  expect(terminalPublicAfter.text).toBe(terminalPublicBefore.text);
  const ledger = await fixture.virtualSseLedger();
  expect(ledger.filter(({ kind }) => kind === "open").map(({ cursor }) => cursor))
    .toEqual([0, 1_024, 2_048, 3_072, 4_096]);
  const accepted = ledger.filter(({ kind, disposition }) => (
    kind === "envelope" && disposition === "accepted"
  ));
  expect(accepted).toHaveLength(200);
  expect(accepted.map(({ cursor }) => cursor)).toEqual([
    ...Array.from({ length: 50 }, (_, index) => index + 1),
    ...Array.from({ length: 50 }, (_, index) => 1_025 + index),
    ...Array.from({ length: 50 }, (_, index) => 2_049 + index),
    ...Array.from({ length: 50 }, (_, index) => 3_073 + index),
  ]);
  await page.locator(".presentation-world-stage canvas").evaluate((canvas) => {
    (canvas as HTMLElement).dataset.lifecycleOwner = "c16-primary-canvas";
  });
  const terminalLiveState = await mountedPersistentProductionState(page);
  const terminalLiveIdentity = await mountedProductionIdentity(page);
  expect(terminalLiveIdentity.canvasLastInternalFailure).toBeNull();
  expect(terminalLiveIdentity.canvasActiveAtlasIds.length).toBeGreaterThan(0);
  expect(terminalLiveState.resourceOwnership).toMatchObject({
    cacheOutstanding: 3,
    cachePeak: 6,
    poolInFlightCount: 0,
    poolWaiterCount: 0,
    poolOverBudget: false,
  });
  await page.locator("#observer-archive-trigger").click();
  await expect(page.getByRole("heading", { name: "Archive", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    (window.__vivariumProductionDiagnosticsForTest?.snapshot(
      document.querySelector(".vivarium-2d-app")!,
    ) as any)?.archiveStatus ?? null
  ))).toBe("ready");
  let archiveResourceOwnership: typeof terminalLiveState.resourceOwnership | null = null;
  for (let cycle = 0; cycle < 25; cycle += 1) {
    await page.locator(".archive-drawer__checkpoints button").first().click();
    await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-source", "archive");
    await expect(page.locator(".presentation-world-stage canvas"))
      .toHaveAttribute("data-lifecycle-owner", "c16-primary-canvas");
    const archivedIdentity = await mountedProductionIdentity(page);
    expect(
      archivedIdentity.canvasLastInternalFailure,
      JSON.stringify(archivedIdentity, null, 2),
    ).toBeNull();
    expect(archivedIdentity).toMatchObject({
      observerSourceKey: expect.stringMatching(/^archive:/),
      canvasSourceKey: expect.stringMatching(/^archive:/),
      canvasVisibleRegionId: terminalLiveIdentity.canvasVisibleRegionId,
      canvasActiveAtlasIds: terminalLiveIdentity.canvasActiveAtlasIds,
    });
    const archivedState = await mountedPersistentProductionState(page);
    expect(archivedState.spatialBinding).toEqual({
      placementRebound: true,
      recipesRebound: true,
    });
    if (archiveResourceOwnership === null) {
      archiveResourceOwnership = archivedState.resourceOwnership;
      expect(archiveResourceOwnership).toMatchObject({
        cacheOutstanding: 3,
        cachePeak: 6,
        poolInFlightCount: 0,
        poolWaiterCount: 0,
        poolOverBudget: false,
      });
      expect(archiveResourceOwnership.poolLeases).toBeGreaterThan(0);
    } else {
      expect(archivedState.resourceOwnership).toEqual(archiveResourceOwnership);
    }
    expect(archivedState).not.toEqual(terminalLiveState);
    await page.locator(".archive-drawer__return").click();
    await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-presented-source", "live");
    await expect(page.locator(".presentation-world-stage canvas"))
      .toHaveAttribute("data-lifecycle-owner", "c16-primary-canvas");
    expect(await mountedProductionIdentity(page)).toMatchObject({
      observerSourceKey: expect.stringMatching(/^live:/),
      canvasSourceKey: expect.stringMatching(/^live:/),
      canvasVisibleRegionId: terminalLiveIdentity.canvasVisibleRegionId,
      canvasActiveAtlasIds: terminalLiveIdentity.canvasActiveAtlasIds,
    });
    const restoredLiveState = await mountedPersistentProductionState(page);
    expect(restoredLiveState.presentedCursor).toBe(terminalLiveState.presentedCursor);
    expect(restoredLiveState.activeSceneCount).toBe(0);
    expect(restoredLiveState.pendingMoments).toBe(0);
    expect(restoredLiveState.observerFrameIdentity)
      .toEqual(restoredLiveState.canvasFrameIdentity);
    expect(restoredLiveState.spatialBinding).toEqual({
      placementRebound: false,
      recipesRebound: false,
    });
    expect(restoredLiveState).toEqual(terminalLiveState);
  }
  const preUnmountRendererDisposals = await page.evaluate(() => (
    window.__vivariumProductionCaptureClockForTest?.rendererDisposals().length ?? -1
  ));
  await page.evaluate(() => {
    const unmount = window.__vivariumProductionCaptureUnmountForTest;
    if (unmount === undefined) throw new Error("capture root unmount control is unavailable");
    unmount();
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = (): void => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  }));
  const rendererLifecycle = await page.evaluate(() => (
    window.__vivariumProductionCaptureTerminalForTest ?? null
  ));
  expect({
    preUnmountRendererDisposals,
    rendererCreations: rendererLifecycle?.rendererCreations ?? -1,
    rendererDisposals: rendererLifecycle?.rendererDisposals.length ?? -1,
  }).toEqual({
    preUnmountRendererDisposals: 0,
    rendererCreations: 1,
    rendererDisposals: 1,
  });
  const terminal = await fixture.dispose();
  expect(terminal).toMatchObject({ activeStreams: 0, balancedSseLifecycle: true });
});

async function mountedProductionIdentity(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    const observer = app === null ? null : accessor?.snapshot(app) as any;
    const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
    return {
      observerRunId: observer?.frameIdentity?.runId ?? null,
      observerSourceKey: observer?.frameIdentity?.sourceKey ?? null,
      canvasRunId: renderer?.frameIdentity?.runId ?? null,
      canvasSourceKey: renderer?.frameIdentity?.sourceKey ?? null,
      canvasLastInternalFailure: structuredClone(renderer?.lastInternalFailure ?? null),
      canvasVisibleRegionId: renderer?.visibleRegionId ?? null,
      canvasActiveAtlasIds: structuredClone(renderer?.pool?.activeAtlasIds ?? []),
    };
  });
}

async function advanceC02ProductionBoundaryUntilTerminal(
  page: import("@playwright/test").Page,
) {
  let lastState: unknown = null;
  for (let step = 0; step < 1_024; step += 1) {
    const state = await page.evaluate(() => {
      const app = document.querySelector(".vivarium-2d-app");
      const stage = document.querySelector(".presentation-world-stage");
      const accessor = window.__vivariumProductionDiagnosticsForTest;
      const observer = app === null ? null : accessor?.snapshot(app) as any;
      const canvas = stage === null ? null : accessor?.snapshot(stage) as any;
      return {
        observerFrame: structuredClone(observer?.captureFrame ?? null),
        observerFrameIdentity: structuredClone(observer?.frameIdentity ?? null),
        canvasFrameIdentity: structuredClone(canvas?.frameIdentity ?? null),
        session: structuredClone(observer?.session ?? null),
      };
    });
    lastState = state;
    if (state.observerFrame?.presentedCursor === 20
      && state.observerFrame.world?.exactBaseCursor === 20
      && state.observerFrame.world?.projectedThroughCursor === 20
      && state.observerFrame.scene === null
      && state.session?.director?.activeSceneCount === 0
      && state.session?.director?.pendingMoments === 0
      && state.session?.checkpoint?.lastDeliveredLine === 1
      && state.session?.checkpoint?.retainedSafeCheckpoints === 1
      && state.observerFrameIdentity?.runId === state.canvasFrameIdentity?.runId
      && state.observerFrameIdentity?.sourceKey === state.canvasFrameIdentity?.sourceKey
      && state.observerFrameIdentity?.revision === state.canvasFrameIdentity?.revision
      && state.observerFrameIdentity?.firstCursor === state.canvasFrameIdentity?.firstCursor
      && state.observerFrameIdentity?.lastCursor === state.canvasFrameIdentity?.lastCursor) {
      return state;
    }
    await page.evaluate(async () => {
      const control = window.__vivariumProductionCaptureClockForTest;
      if (control === undefined) throw new Error("manual capture clock is unavailable");
      control.advanceTo(control.now() + 1_000);
      const turn = (): Promise<void> => new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (): void => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(undefined);
      });
      await turn();
      await turn();
      await turn();
      await turn();
    });
  }
  throw new Error(`C02 production boundary did not reach exact terminal truth: ${JSON.stringify(lastState)}`);
}

/**
 * Captures persistent world truth across Live/Archive selection.
 *
 * Visibility pause/resume intentionally authors new frame revisions and a
 * lineage swap reconstructs renderer instances. Instance ids, activeAction,
 * and revision are therefore renderer/session lifecycle evidence rather than
 * persistent world state.
 */
async function mountedPersistentProductionState(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    const observer = app === null ? null : accessor?.snapshot(app) as any;
    const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
    if (app === null
      || observer === null || observer === undefined
      || renderer === null || renderer === undefined) {
      throw new Error("mounted production state requires observer and Canvas diagnostics");
    }
    const persistentIdentity = (identity: any) => identity === null
      ? null
      : {
          runId: identity.runId,
          sourceKey: identity.sourceKey,
          firstCursor: identity.firstCursor,
          lastCursor: identity.lastCursor,
        };
    return {
      presentedCursor: Number(app.getAttribute("data-presented-cursor")),
      activeSceneCount: Number(observer.session?.director?.activeSceneCount ?? 0),
      pendingMoments: Number(observer.session?.director?.pendingMoments ?? 0),
      observerFrameIdentity: persistentIdentity(observer.frameIdentity),
      canvasFrameIdentity: persistentIdentity(renderer.frameIdentity),
      spatialBinding: { ...renderer.graph.spatialBinding },
      resourceOwnership: {
        poolLeases: renderer.pool.leases,
        poolActiveAtlasIds: [...renderer.pool.activeAtlasIds],
        poolInFlightCount: renderer.pool.inFlightCount,
        poolWaiterCount: renderer.pool.waiterCount,
        poolOverBudget: renderer.pool.overBudget,
        cacheOutstanding: renderer.cache.outstanding,
        cachePeak: renderer.cache.peak,
      },
      actors: (renderer.graph?.actors ?? []).map((actor: any) => ({
        id: actor.id,
        position: actor.position,
        facing: actor.facing,
        worldBounds: actor.worldBounds,
        status: actor.status,
        terminal: actor.terminal,
        selected: actor.selected,
      })),
      homes: (renderer.graph?.homes ?? []).map((home: any) => ({
        id: home.id,
        kind: home.kind,
        status: home.status,
        plot: home.plot,
        door: home.door,
        kit: home.kit,
        remnantMaterials: home.remnantMaterials,
        provisional: home.provisional,
      })),
    };
  });
}
