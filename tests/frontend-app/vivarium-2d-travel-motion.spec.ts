import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { parseChronicleManifest } from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import { installProductionChronicleFixture } from "./fixtures/production-chronicle-fixture";
import { productionTravelFrameBudget } from "./fixtures/production-chronicle-budget";
import { installTypedProductionCaptureEntry } from "./fixtures/typed-production-capture-entry";

const FPS = 30;
const TERMINAL_CONFIRMATION_FRAMES = 2;
const TRAVELER_ID = "wanderer_003";
const C02_PATH = path.resolve(
  "tests/frontend-app/fixtures/chronicles/data/C02-travel-all-regions.json",
);
const C02 = parseChronicleManifest(JSON.parse(readFileSync(C02_PATH, "utf8")));
const EXPECTED_REGION_CHAIN = Object.freeze([
  "nirvana",
  "nirvana_east",
  "warm_springs",
  "nirvana_west",
  "nirvana",
  "warm_springs",
  "nirvana_east",
  "nirvana",
  "nirvana_west",
  "warm_springs",
  "nirvana",
]);

for (const viewport of [
  { name: "desktop", width: 1_440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
] as const) {
  test(`C02 ${viewport.name} keeps every real travel displacement moving-to-moving`, async ({ page }) => {
    test.setTimeout(10 * 60 * 1_000);
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.__vivariumEnableProductionCaptureClockForTest = true;
      window.__vivariumEnableProductionDiagnosticsForTest = true;
    });
    await installTypedProductionCaptureEntry(page);
    const fixture = await installProductionChronicleFixture(page, C02, C02_PATH);
    try {
      await fixture.dispatchRange(1, C02.expectedFinalCursor);
      const budget = await productionTravelFrameBudget(page, C02, FPS);
      expect(budget).toMatchObject({
        durationMs: 844_124,
        frameCount: 25_325,
        fps: FPS,
        programCount: 20,
        transactionCount: 10,
      });
      const regionChain: string[] = [];
      const violations: MotionViolation[] = [];
      const missingTravelFrames: number[] = [];
      const actorInstanceIds = new Set<number>();
      const displacementByLeg = Array.from({ length: 10 }, () => 0);
      let prior: MotionSample | null = null;
      let displacementCount = 0;
      let stableTerminalFrames = 0;
      let firstTerminalFrame: number | null = null;

      for (let frameIndex = 0;
        frameIndex < budget.frameCount + TERMINAL_CONFIRMATION_FRAMES;
        frameIndex += 1) {
        const sample = await sampleMotionFrame(page, frameIndex);
        if (sample.regionId !== null && regionChain.at(-1) !== sample.regionId) {
          regionChain.push(sample.regionId);
        }
        if (sample.actor !== null) actorInstanceIds.add(sample.actor.instanceId);
        if (sample.activeSceneCount === 1
          && sample.cursor >= 0
          && sample.cursor < C02.expectedFinalCursor
          && sample.actor === null
          && missingTravelFrames.length < 20) {
          missingTravelFrames.push(sample.frameIndex);
        }
        if (prior?.regionId === sample.regionId && prior.actor !== null && sample.actor !== null) {
          const dx = sample.actor.x - prior.actor.x;
          const dy = sample.actor.y - prior.actor.y;
          if (Math.hypot(dx, dy) > 1e-9) {
            displacementCount += 1;
            const priorLeg = Math.floor(prior.cursor / 2);
            const currentLeg = Math.floor(sample.cursor / 2);
            if (priorLeg === currentLeg
              && sample.cursor >= 0
              && sample.cursor < C02.expectedFinalCursor) {
              displacementByLeg[currentLeg] += 1;
            }
            const expectedFacing = Math.abs(dx) >= Math.abs(dy)
              ? dx > 0 ? "east" : "west"
              : dy > 0 ? "south" : "north";
            if (prior.actor.activeAction !== "moving"
              || sample.actor.activeAction !== "moving"
              || prior.actor.facing !== expectedFacing
              || sample.actor.facing !== expectedFacing) {
              violations.push({
                beforeFrame: prior.frameIndex,
                afterFrame: sample.frameIndex,
                dx,
                dy,
                expectedFacing,
                before: prior.actor,
                after: sample.actor,
              });
            }
          }
        }
        if (sample.terminalSettled && firstTerminalFrame === null) firstTerminalFrame = frameIndex;
        stableTerminalFrames = sample.terminalSettled ? stableTerminalFrames + 1 : 0;
        prior = sample;
        if (stableTerminalFrames >= 3) break;
      }

      expect(stableTerminalFrames, "C02 must visibly settle within its certified travel budget")
        .toBeGreaterThanOrEqual(3);
      expect(firstTerminalFrame).not.toBeNull();
      expect(firstTerminalFrame!).toBeLessThan(budget.frameCount);
      expect(regionChain).toEqual(EXPECTED_REGION_CHAIN);
      expect(displacementCount).toBeGreaterThan(20_000);
      expect(displacementByLeg.every((count) => count > 0), displacementByLeg.join(","))
        .toBe(true);
      expect(missingTravelFrames).toEqual([]);
      expect([...actorInstanceIds]).toHaveLength(1);
      expect(prior?.graphOwnership).toMatchObject({
        created: 4,
        disposed: 2,
        outstanding: 2,
        peak: 4,
      });
      expect(prior?.graphRejections).toEqual({
        invalid: 0,
        stale: 0,
        foreignLineage: 0,
        malformedRecords: 0,
      });
      expect(prior?.pathFallbacks).toBe(0);
      expect(prior?.rendererDisposals).toBe(0);
      expect(violations).toEqual([]);
    } finally {
      const terminal = await fixture.dispose();
      expect(fixture.requests.external).toEqual([]);
      expect(fixture.requests.rawArtifacts).toEqual([]);
      expect(fixture.requests.unhandledApi).toEqual([]);
      expect(terminal.activeStreams).toBe(0);
      expect(terminal.balancedSseLifecycle).toBe(true);
      expect(terminal.unmatchedRouteCount).toBe(0);
      expect(terminal.missingScenarioRoutes).toEqual([]);
      expect(terminal.routeReconciliationErrors).toEqual([]);
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
    }
  });
}

interface MotionActorSample {
  readonly instanceId: number;
  readonly x: number;
  readonly y: number;
  readonly facing: string;
  readonly activeAction: string | null;
}

interface OwnershipSample {
  readonly created: number;
  readonly disposed: number;
  readonly outstanding: number;
  readonly peak: number;
}

interface RejectionSample {
  readonly invalid: number;
  readonly stale: number;
  readonly foreignLineage: number;
  readonly malformedRecords: number;
}

interface MotionSample {
  readonly frameIndex: number;
  readonly cursor: number;
  readonly regionId: string | null;
  readonly actor: MotionActorSample | null;
  readonly activeSceneCount: number;
  readonly graphOwnership: OwnershipSample | null;
  readonly graphRejections: RejectionSample | null;
  readonly pathFallbacks: number;
  readonly rendererDisposals: number;
  readonly terminalSettled: boolean;
}

interface MotionViolation {
  readonly beforeFrame: number;
  readonly afterFrame: number;
  readonly dx: number;
  readonly dy: number;
  readonly expectedFacing: string;
  readonly before: MotionActorSample;
  readonly after: MotionActorSample;
}

async function sampleMotionFrame(page: Page, frameIndex: number): Promise<MotionSample> {
  return page.evaluate(async ({ exactTimeMs, observedFrameIndex, travelerId, finalCursor }) => {
    const control = window.__vivariumProductionCaptureClockForTest;
    const diagnostics = window.__vivariumProductionDiagnosticsForTest;
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    if (control === undefined || diagnostics === undefined || app === null || stage === null) {
      throw new Error("production motion probe surfaces are unavailable");
    }
    control.advanceTo(exactTimeMs);
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

    const observer = diagnostics.snapshot(app) as any;
    const renderer = diagnostics.snapshot(stage) as any;
    if (observer === null || renderer === null) {
      throw new Error("production motion diagnostics are unavailable");
    }
    const actor = renderer.graph?.actors?.find((candidate: any) => candidate.id === travelerId);
    const presentedCursor = Number(app.getAttribute("data-presented-cursor") ?? 0);
    const canvasCursor = Number(renderer.frameIdentity?.lastCursor ?? 0);
    const activeSceneCount = Number(observer.session?.director?.activeSceneCount ?? 1);
    const pendingMoments = Number(observer.session?.director?.pendingMoments ?? 1);
    const sceneSettled = observer.session?.settlement === null
      || observer.session?.settlement?.sceneToken === null
      || observer.session?.settlement?.sceneSettled === true;
    return {
      frameIndex: observedFrameIndex,
      cursor: presentedCursor,
      regionId: typeof renderer.graph?.activeRegion?.id === "string"
        ? renderer.graph.activeRegion.id
        : null,
      actor: actor === undefined ? null : {
        instanceId: Number(actor.instanceId),
        x: Number(actor.position.x),
        y: Number(actor.position.y),
        facing: String(actor.facing),
        activeAction: actor.activeAction === null ? null : String(actor.activeAction),
      },
      activeSceneCount,
      graphOwnership: renderer.graph?.ownership?.actors ?? null,
      graphRejections: renderer.graph?.rejections ?? null,
      pathFallbacks: Number(renderer.graph?.pathFallbacks ?? -1),
      rendererDisposals: control.rendererDisposals().length,
      terminalSettled: presentedCursor === finalCursor
        && canvasCursor === finalCursor
        && activeSceneCount === 0
        && pendingMoments === 0
        && sceneSettled,
    };
  }, {
    exactTimeMs: frameIndex * 1_000 / FPS,
    observedFrameIndex: frameIndex,
    travelerId: TRAVELER_ID,
    finalCursor: C02.expectedFinalCursor,
  });
}
