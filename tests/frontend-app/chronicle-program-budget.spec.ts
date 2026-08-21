import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { getChronicleManifest } from "../../frontend/src/presentation/fixtures/chronicleCatalog";
import {
  captureFrameCountWithTerminalWitness,
  productionCaptureFrameCeiling,
  productionTravelFrameBudget,
} from "./fixtures/production-chronicle-budget";
import { installProductionChronicleFixture } from "./fixtures/production-chronicle-fixture";
import { installTypedProductionCaptureEntry } from "./fixtures/typed-production-capture-entry";

const FIXTURE_ROOT = path.resolve("tests/frontend-app/fixtures/chronicles/data");

test("bounds route-aware mechanic Chronicles from canonical choreography maxima", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const c03 = getChronicleManifest("C03");
  const fixture = await installProductionChronicleFixture(
    page,
    c03,
    path.join(FIXTURE_ROOT, "C03-resources-harvest-hoard-transfer.json"),
  );
  expect(await page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const diagnostics = window.__vivariumProductionDiagnosticsForTest;
    const stageDebug = stage === null ? null : diagnostics?.snapshot(stage) as any;
    return {
      captureControl: window.__vivariumProductionCaptureClockForTest !== undefined,
      now: window.__vivariumProductionCaptureClockForTest?.now() ?? -1,
      cursor: app?.getAttribute("data-presented-cursor") ?? null,
      stageReady: stage?.getAttribute("data-ready") ?? null,
      alert: document.querySelector("[role='alert']")?.textContent ?? null,
      internalFailure: structuredClone(stageDebug?.lastInternalFailure ?? null),
    };
  })).toEqual({
    captureControl: true,
    now: 0,
    cursor: "0",
    stageReady: "true",
    alert: null,
    internalFailure: null,
  });
  expect(pageErrors).toEqual([]);

  await expect(productionCaptureFrameCeiling(page, c03, 30)).resolves.toEqual({
    durationMs: 129_000,
    frameCount: 3_871,
    fps: 30,
    source: "choreography-maxima",
  });
  await expect(productionCaptureFrameCeiling(page, getChronicleManifest("C13"), 30)).resolves.toEqual({
    durationMs: 312_200,
    frameCount: 9_367,
    fps: 30,
    source: "pressure",
  });

  await fixture.dispose();
});

test("loads exact travel budgets through the browser production module graph", async ({ page }) => {
  await page.addInitScript(() => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
  });
  await installTypedProductionCaptureEntry(page);
  const c02 = getChronicleManifest("C02");
  const fixture = await installProductionChronicleFixture(
    page,
    c02,
    path.join(FIXTURE_ROOT, "C02-travel-all-regions.json"),
  );

  await expect(productionTravelFrameBudget(page, getChronicleManifest("C01"), 30))
    .resolves.toMatchObject({
      durationMs: 90_936,
      frameCount: 2_730,
      programCount: 2,
      transactionCount: 1,
    });
  await expect(productionTravelFrameBudget(page, c02, 30)).resolves.toMatchObject({
    durationMs: 844_124,
    frameCount: 25_325,
    programCount: 20,
    transactionCount: 10,
  });

  await fixture.dispose();
});

test("reserves exactly the consecutive terminal witness tail above the exact travel budget", () => {
  const c01BaseFrameCount = 2_730;
  const c02BaseFrameCount = 25_325;
  const requiredTerminalSamples = 3;

  expect(captureFrameCountWithTerminalWitness(
    c01BaseFrameCount,
    requiredTerminalSamples,
  )).toBe(2_732);
  expect(captureFrameCountWithTerminalWitness(
    c02BaseFrameCount,
    requiredTerminalSamples,
  )).toBe(25_327);
  expect(captureFrameCountWithTerminalWitness(c01BaseFrameCount, 1))
    .toBe(c01BaseFrameCount);

  const firstTerminalFrameIndex = c01BaseFrameCount - 1;
  const captureFrameCount = captureFrameCountWithTerminalWitness(
    c01BaseFrameCount,
    requiredTerminalSamples,
  );
  expect(captureFrameCount - firstTerminalFrameIndex).toBe(requiredTerminalSamples);
  expect((captureFrameCount - 1) - firstTerminalFrameIndex)
    .toBe(requiredTerminalSamples - 1);

  expect(() => captureFrameCountWithTerminalWitness(0, requiredTerminalSamples))
    .toThrow(/base frame count/i);
  expect(() => captureFrameCountWithTerminalWitness(c01BaseFrameCount, 0))
    .toThrow(/sample count/i);
  expect(() => captureFrameCountWithTerminalWitness(Number.MAX_SAFE_INTEGER, 2))
    .toThrow(/safe integer/i);
});

test("drains delayed terminal UI before the reduced static-zero probe", () => {
  const source = readFileSync(
    path.resolve("tests/frontend-app/vivarium-2d-production-capture.spec.ts"),
    "utf8",
  );
  const reducedProbeStart = source.indexOf("async function runIndependentReducedMotionProbe(");
  const reducedProbeEnd = source.indexOf("async function runIndependentCadenceProbe(");
  const reducedProbe = source.slice(reducedProbeStart, reducedProbeEnd);
  const drain = reducedProbe.indexOf(
    "await drainTerminalObserverUi(page, captureScenario.terminal);",
  );
  const staticProbe = reducedProbe.indexOf(
    "await runTerminalStaticZeroProbe(page, captureScenario.terminal)",
  );

  expect(reducedProbeStart).toBeGreaterThanOrEqual(0);
  expect(reducedProbeEnd).toBeGreaterThan(reducedProbeStart);
  expect(drain).toBeGreaterThanOrEqual(0);
  expect(staticProbe).toBeGreaterThan(drain);
});
