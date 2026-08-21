import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

import {
  LIVING_ATLAS_CAPTURE_CURSOR,
  installLivingAtlasFixture,
  livingAtlasRecoveryEnvelope,
  livingAtlasStoryEnvelope,
  livingAtlasWorld,
} from "./living-atlas-fixture";

test.skip(process.env.VIVARIUM_CAPTURE_TASK8 !== "1", "Task8 capture is opt-in.");
test.setTimeout(180_000);

const SHOT_DIRECTORY = path.resolve("docs/frontend/mockups/shots");
const REGION_NAMES = livingAtlasWorld.regions.map(({ name }) => name);
const FOUR_REGION_NAMES = ["nirvana", "nirvana_east", "nirvana_west", "warm_springs"];
const FOUR_REGION_NAME_SET = new Set(FOUR_REGION_NAMES);
const FOUR_REGION_CONNECTIONS: Readonly<Record<string, readonly string[]>> = {
  nirvana: ["warm_springs", "nirvana_east", "nirvana_west"],
  nirvana_east: ["warm_springs", "nirvana"],
  nirvana_west: ["warm_springs", "nirvana"],
  warm_springs: ["nirvana_west", "nirvana_east", "nirvana"],
};
const fourRegionWorld = {
  ...livingAtlasWorld,
  agents: livingAtlasWorld.agents.filter(({ position }) => FOUR_REGION_NAME_SET.has(position)),
  regions: livingAtlasWorld.regions
    .filter(({ name }) => FOUR_REGION_NAME_SET.has(name))
    .map((region) => ({
      ...region,
      connections: [...(FOUR_REGION_CONNECTIONS[region.name] ?? [])],
    })),
  homes: livingAtlasWorld.homes.filter(({ region }) => FOUR_REGION_NAME_SET.has(region)),
  ruins: livingAtlasWorld.ruins.filter(({ region }) => FOUR_REGION_NAME_SET.has(region)),
};
const mysticCaptureWorld = {
  ...fourRegionWorld,
  agents: fourRegionWorld.agents.map((agent) => (
    agent.id === "agent_weary"
      ? { ...agent, position: "warm_springs", home_id: null }
      : agent
  )),
  homes: fourRegionWorld.homes.map((home) => ({
    ...home,
    owner_id: "agent_healthy",
    stakeholders: ["agent_healthy"],
  })),
};
const PHASES = {
  day: { phase: 0.4, key: "day" },
  golden: { phase: 0.14, key: "golden-hour" },
  night: { phase: 0.92, key: "night" },
} as const;

interface CaptureOptions {
  expectedCursor?: number;
  expectedQuality?: "full" | "reduced" | "tour";
  expectedSurface?: "world" | "chronicle" | "selection" | "archive" | null;
  expectedTopologyFallback?: boolean;
  clip?: { x: number; y: number; width: number; height: number };
  focusedAgentId?: string;
  allowLockedScrollExtent?: boolean;
  extra?: Record<string, unknown>;
}

async function twoStableFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => (
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  )));
}

async function setPhase(
  page: Page,
  phase: number,
  key: "day" | "golden-hour" | "night",
): Promise<void> {
  await page.evaluate((value) => window.__vivariumWorld?.setObserverVisualPhaseForTest(value), phase);
  await page.waitForFunction(({ expectedPhase, expectedKey }) => {
    const atmosphere = window.__vivariumWorld?.atmosphereState();
    return atmosphere?.phaseSource === "test-override"
      && atmosphere.key === expectedKey
      && Math.abs(atmosphere.phase - expectedPhase) < 1e-8;
  }, { expectedPhase: phase, expectedKey: key });
}

async function captureDiagnostics(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const debug = window.__vivariumWorld;
    if (!debug) {
      throw new Error("The Living Atlas renderer debug handle is unavailable.");
    }
    const scrolling = document.scrollingElement;
    const openSurface = document.querySelector<HTMLElement>('[data-atlas-surface][data-open="true"]');
    const visibleLeafSelectors = [
      ".top-hud .brand-mark",
      ".top-hud .hud-chip",
      ".top-hud .connection-pill",
      ".atlas-edge-copy strong",
      ".atlas-edge-copy small",
      ".story-ribbon-label",
      ".story-ribbon-detail",
      ".atlas-surface-head h2",
      ".atlas-surface-head p",
      ".viv-region-label",
    ];
    const clippedCopy = visibleLeafSelectors.flatMap((selector) => (
      Array.from(document.querySelectorAll<HTMLElement>(selector)).flatMap((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          rect.width <= 0
          || rect.height <= 0
          || style.display === "none"
          || style.visibility === "hidden"
        ) {
          return [];
        }
        return (
          element.scrollWidth > element.clientWidth + 1
          || element.scrollHeight > element.clientHeight + 1
        ) ? [{
          selector,
          text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        }] : [];
      })
    ));
    const budget = debug.renderBudgetDiagnostics();
    const agentIds = Array.from(document.querySelectorAll<HTMLElement>("[data-agent-id]"))
      .map((node) => node.dataset.agentId)
      .filter((id): id is string => Boolean(id));
    const fixtureAgentIds = [
      "agent_healthy",
      "agent_weary",
      "agent_fallen",
      "agent_dead",
      "agent_moss",
      "agent_coast",
      "agent_ember",
      "agent_salt",
    ];
    const diagnosticsAgentIds = [...new Set([...fixtureAgentIds, ...agentIds])];
    return {
      source: document.querySelector(".observatory")?.getAttribute("data-source") ?? "unknown",
      run: window.__vivariumLiveRun?.diagnostics(),
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      stageSource: document.querySelector('[data-testid="world-stage"]')?.getAttribute("data-stage-source"),
      canvasCount: document.querySelectorAll('[data-testid="world-stage"] canvas').length,
      openSurface: openSurface?.dataset.atlasSurface ?? null,
      openSurfaceCount: document.querySelectorAll('[data-atlas-surface][data-open="true"]').length,
      documentOverflow: {
        x: scrolling ? scrolling.scrollWidth - scrolling.clientWidth : 0,
        y: scrolling ? scrolling.scrollHeight - scrolling.clientHeight : 0,
        scrollLeft: scrolling?.scrollLeft ?? 0,
        scrollTop: scrolling?.scrollTop ?? 0,
        bodyOverflow: getComputedStyle(document.body).overflow,
        observatoryOverflow: getComputedStyle(document.querySelector<HTMLElement>(".observatory")!).overflow,
        stageOverflow: getComputedStyle(document.querySelector<HTMLElement>('[data-testid="world-stage"]')!).overflow,
      },
      clippedCopy,
      layoutHash: debug.atlasLayoutHash(),
      topology: debug.atlasTopologyDiagnostics(),
      camera: debug.cameraState(),
      atmosphere: debug.atmosphereState(),
      motion: debug.motionMode(),
      scenery: debug.sceneryDiagnostics(),
      budget,
      canvasVariance: debug.sampleCanvasPixels(),
      activeEffects: debug.activeEffects(),
      appliedEventCursors: debug.appliedEventCursors(),
      agents: Object.fromEntries(diagnosticsAgentIds.flatMap((id) => {
        const state = debug.agentVisualState(id);
        return state ? [[id, state]] : [];
      })),
      homes: {
        home_001: debug.homeVisualState("home_001"),
        home_002: debug.homeVisualState("home_002"),
        home_old: debug.homeVisualState("home_old"),
      },
    };
  });
}

async function assertStableFrame(page: Page): Promise<void> {
  await page.waitForFunction(() => new Promise<boolean>((resolve) => {
    const debug = window.__vivariumWorld;
    const live = window.__vivariumLiveRun;
    const before = {
      camera: debug?.cameraState(),
      cursor: live?.diagnostics().eventCursor,
      snapshotCursor: live?.diagnostics().lastAcceptedSnapshotCursor,
    };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const after = {
        camera: debug?.cameraState(),
        cursor: live?.diagnostics().eventCursor,
        snapshotCursor: live?.diagnostics().lastAcceptedSnapshotCursor,
      };
      const beforeTarget = before.camera?.target ?? [];
      const afterTarget = after.camera?.target ?? [];
      const targetDelta = Math.max(0, ...beforeTarget.map((value, index) => (
        Math.abs(value - (afterTarget[index] ?? value))
      )));
      const distanceDelta = Math.abs((before.camera?.distance ?? 0) - (after.camera?.distance ?? 0));
      resolve(
        before.cursor === after.cursor
        && before.snapshotCursor === after.snapshotCursor
        && targetDelta <= 0.001
        && distanceDelta <= 0.001
      );
    }));
  }));
}

async function stableFocusedAgentFrame(
  page: Page,
  agentId: string,
): Promise<Record<string, any>> {
  return page.evaluate((id) => {
    const debug = window.__vivariumWorld;
    const camera = window.__viv?.camera;
    const canvas = document.querySelector<HTMLElement>('[data-testid="vivarium-world-canvas"]');
    const state = debug?.agentVisualState(id);
    if (!camera || !canvas || !state) {
      throw new Error(`Focused capture geometry is unavailable for ${id}.`);
    }
    let visualRoot: any = null;
    window.__viv?.scene.traverse((object: any) => {
      if (object.userData?.kind === "agent" && object.userData?.id === id) {
        visualRoot = object.getObjectByName("mystic-visual");
      }
    });
    if (!visualRoot) {
      throw new Error(`Mystic visual root is unavailable for ${id}.`);
    }
    visualRoot.updateWorldMatrix(true, true);
    camera.updateMatrixWorld(true);
    const rect = canvas.getBoundingClientRect();
    const projected: Array<{ x: number; y: number }> = [];
    visualRoot.traverse((object: any) => {
      if (!object.isMesh || !object.visible || !object.geometry) return;
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      if (!bounds) return;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            const point = bounds.min.clone().set(x, y, z);
            object.localToWorld(point);
            point.project(camera);
            projected.push({
              x: rect.left + ((point.x + 1) / 2) * rect.width,
              y: rect.top + ((-point.y + 1) / 2) * rect.height,
            });
          }
        }
      }
    });
    if (projected.length === 0) {
      throw new Error(`Mystic projected bounds are empty for ${id}.`);
    }
    const bounds = {
      left: Math.min(...projected.map(({ x }) => x)),
      right: Math.max(...projected.map(({ x }) => x)),
      top: Math.min(...projected.map(({ y }) => y)),
      bottom: Math.max(...projected.map(({ y }) => y)),
    };
    return {
      agentId: id,
      state,
      bounds: {
        ...bounds,
        width: bounds.right - bounds.left,
        height: bounds.bottom - bounds.top,
        centerX: (bounds.left + bounds.right) / 2,
        centerY: (bounds.top + bounds.bottom) / 2,
      },
      viewport: { width: innerWidth, height: innerHeight },
    };
  }, agentId);
}

function assertDiagnosticCaps(
  diagnostics: Record<string, any>,
  options: CaptureOptions,
): void {
  expect(diagnostics.canvasCount).toBe(1);
  expect(diagnostics.canvasVariance).toBeGreaterThan(20);
  expect(diagnostics.topology).toMatchObject({
    fallback: options.expectedTopologyFallback ?? false,
    asymmetricEdges: [],
  });
  expect(diagnostics.documentOverflow.x).toBeLessThanOrEqual(1);
  if (diagnostics.documentOverflow.y > 1) {
    expect(options.allowLockedScrollExtent).toBe(true);
    expect(diagnostics.documentOverflow).toMatchObject({
      scrollLeft: 0,
      scrollTop: 0,
      bodyOverflow: "hidden",
      observatoryOverflow: "hidden",
      stageOverflow: "hidden",
    });
  } else {
    expect(diagnostics.documentOverflow.y).toBeLessThanOrEqual(1);
  }
  expect(diagnostics.clippedCopy).toEqual([]);
  expect(diagnostics.openSurfaceCount).toBe(options.expectedSurface ? 1 : 0);
  expect(diagnostics.openSurface).toBe(options.expectedSurface ?? null);
  if (options.expectedCursor !== undefined) {
    expect(diagnostics.run.lastAcceptedSnapshotCursor).toBe(LIVING_ATLAS_CAPTURE_CURSOR);
    expect(diagnostics.run.eventCursor).toBe(options.expectedCursor);
  }
  if (options.expectedQuality) {
    expect(diagnostics.scenery.quality).toBe(options.expectedQuality);
  }
  expect(diagnostics.scenery.recipeVersion).toBe(1);
  expect(
    diagnostics.scenery.visibleInstanceCount + diagnostics.scenery.maskedInstanceCount,
  ).toBe(diagnostics.scenery.instanceCount);
  expect(diagnostics.scenery.dynamicClearanceApplyCount).toBeGreaterThan(0);
  expect(diagnostics.budget.activeEffectCount).toBeLessThanOrEqual(
    diagnostics.budget.maxActiveEffectCount,
  );
  expect(diagnostics.budget.stateOwnedPointLightCount).toBeLessThanOrEqual(
    diagnostics.budget.maxStateOwnedPointLights,
  );
  const persistentLightCount = diagnostics.budget.globalLightCount
    + diagnostics.budget.stateOwnedPointLightCount;
  expect(diagnostics.budget.sceneLightCount).toBeGreaterThanOrEqual(persistentLightCount);
  expect(diagnostics.budget.sceneLightCount - persistentLightCount).toBeLessThanOrEqual(
    diagnostics.budget.activeEffectCount,
  );
  const regionCount = Object.keys(diagnostics.scenery.regionArchetypes).length;
  const sceneryCap = options.expectedQuality === "tour" ? 14 : options.expectedQuality === "reduced" ? 28 : 48;
  const crossingCap = options.expectedQuality === "tour" ? 36 : options.expectedQuality === "reduced" ? 72 : 128;
  expect(diagnostics.scenery.instanceCount).toBeLessThanOrEqual(regionCount * sceneryCap + crossingCap);
  for (const state of Object.values<any>(diagnostics.agents)) {
    expect(state.visual.meshCount).toBeLessThanOrEqual(14);
    expect(state.visual.objectCount).toBeLessThanOrEqual(18);
    expect(state.visual.lightCount).toBeLessThanOrEqual(1);
  }
  for (const ruin of Object.values<any>(diagnostics.homes).filter((state: any) => state?.ruined)) {
    expect(ruin.ownedLightCount).toBe(0);
  }
}

async function captureJpeg(
  page: Page,
  testInfo: TestInfo,
  name: string,
  options: CaptureOptions = {},
): Promise<Record<string, any>> {
  await assertStableFrame(page);
  const focusedAgentCapture = options.focusedAgentId
    ? await stableFocusedAgentFrame(page, options.focusedAgentId)
    : null;
  const resolvedClip = focusedAgentCapture
    ? agentClip({
        screen: {
          x: focusedAgentCapture.bounds.centerX,
          y: focusedAgentCapture.bounds.centerY,
        },
      }, focusedAgentCapture.viewport)
    : options.clip;
  if (focusedAgentCapture && resolvedClip) {
    const margin = 24;
    expect(focusedAgentCapture.state.screenHeight).toBeGreaterThanOrEqual(120);
    expect(focusedAgentCapture.bounds.width).toBeGreaterThan(40);
    expect(focusedAgentCapture.bounds.height).toBeGreaterThan(40);
    expect(focusedAgentCapture.bounds.left).toBeGreaterThanOrEqual(resolvedClip.x + margin);
    expect(focusedAgentCapture.bounds.right).toBeLessThanOrEqual(
      resolvedClip.x + resolvedClip.width - margin,
    );
    expect(focusedAgentCapture.bounds.top).toBeGreaterThanOrEqual(resolvedClip.y + margin);
    expect(focusedAgentCapture.bounds.bottom).toBeLessThanOrEqual(
      resolvedClip.y + resolvedClip.height - margin,
    );
    expect(
      Math.max(focusedAgentCapture.bounds.width, focusedAgentCapture.bounds.height)
      / resolvedClip.width,
    ).toBeGreaterThanOrEqual(0.2);
  }
  const diagnostics = await captureDiagnostics(page) as Record<string, any>;
  assertDiagnosticCaps(diagnostics, options);
  if (focusedAgentCapture && resolvedClip) {
    const finalAgent = diagnostics.agents[focusedAgentCapture.agentId];
    expect(finalAgent).toBeTruthy();
    expect(Math.hypot(
      finalAgent.screen.x - focusedAgentCapture.state.screen.x,
      finalAgent.screen.y - focusedAgentCapture.state.screen.y,
    )).toBeLessThanOrEqual(1);
    expect(Math.abs(finalAgent.screen.x - (resolvedClip.x + resolvedClip.width / 2)))
      .toBeLessThanOrEqual(80);
    expect(Math.abs(finalAgent.screen.y - (resolvedClip.y + resolvedClip.height / 2)))
      .toBeLessThanOrEqual(80);
  }
  const jpegPath = path.join(SHOT_DIRECTORY, `${name}.jpeg`);
  const jsonPath = path.join(SHOT_DIRECTORY, `${name}.json`);
  fs.mkdirSync(SHOT_DIRECTORY, { recursive: true });
  await page.screenshot({
    path: jpegPath,
    type: "jpeg",
    quality: 90,
    fullPage: resolvedClip === undefined,
    clip: resolvedClip,
  });
  const bytes = fs.readFileSync(jpegPath);
  expect(bytes.byteLength).toBeGreaterThan(resolvedClip ? 5_000 : 10_000);
  const sidecar = {
    artifact: path.relative(process.cwd(), jpegPath),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    jpegQuality: 90,
    capture: resolvedClip ? { kind: "clip", clip: resolvedClip } : { kind: "full-page" },
    ...diagnostics,
    ...options.extra,
    ...(focusedAgentCapture ? { focusedAgentCapture } : {}),
  };
  fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
  await testInfo.attach(`${name}-diagnostics`, {
    path: jsonPath,
    contentType: "application/json",
  });
  return sidecar;
}

async function openSurface(page: Page, kind: "chronicle" | "world" | "archive"): Promise<void> {
  const accessibleName = {
    world: "Open world — World Beings & land",
    chronicle: "Open chronicle — Chronicle Living memory",
    archive: "Open archive — Archive Preserved view",
  }[kind];
  await page.getByRole("button", { name: accessibleName, exact: true }).click();
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute(
    "data-atlas-surface",
    kind,
  );
}

async function focusAgent(page: Page, agentId: string): Promise<Record<string, any>> {
  expect(await page.evaluate((id) => {
    (window as any).__livingAtlasFocusHandleForCapture = window.__vivariumWorld;
    return window.__vivariumWorld?.focusAgent(id);
  }, agentId)).toBe(true);
  await page.waitForFunction((id) => (
    window.__vivariumWorld !== (window as any).__livingAtlasFocusHandleForCapture
    &&
    (window.__vivariumWorld?.agentVisualState(id)?.screenHeight ?? 0) >= 120
    && (window.__vivariumWorld?.cameraState().distance ?? Number.POSITIVE_INFINITY) <= 9.1
    && Math.abs((window.__vivariumWorld?.agentVisualState(id)?.screen?.x ?? -10_000) - innerWidth / 2) < 260
    && Math.abs((window.__vivariumWorld?.agentVisualState(id)?.screen?.y ?? -10_000) - innerHeight / 2) < 220
  ), agentId);
  await twoStableFrames(page);
  const state = await page.evaluate((id) => window.__vivariumWorld?.agentVisualState(id), agentId);
  if (!state?.screen) {
    throw new Error(`Focused mystic ${agentId} has no projected screen position.`);
  }
  return state;
}

function agentClip(
  state: Record<string, any>,
  viewport = { width: 1440, height: 900 },
): { x: number; y: number; width: number; height: number } {
  const size = 440;
  return {
    x: Math.max(0, Math.min(viewport.width - size, state.screen.x - size / 2)),
    y: Math.max(0, Math.min(viewport.height - size, state.screen.y - size / 2)),
    width: size,
    height: size,
  };
}

async function frameTopology(page: Page): Promise<Record<string, any>> {
  return page.evaluate((regionNames) => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="vivarium-world-canvas"]');
    if (!canvas) throw new Error("Capture canvas is missing.");
    const canvasRect = canvas.getBoundingClientRect();
    const hud = document.querySelector<HTMLElement>(".top-hud")?.getBoundingClientRect();
    const edge = document.querySelector<HTMLElement>(".atlas-edge-controls")?.getBoundingClientRect();
    const ribbon = document.querySelector<HTMLElement>(".story-ribbon")?.getBoundingClientRect();
    const usable = {
      left: canvasRect.left + 8,
      top: Math.max(canvasRect.top + 8, (hud?.bottom ?? canvasRect.top) + 8),
      right: Math.min(canvasRect.right - 8, (edge?.left ?? canvasRect.right) - 8),
      bottom: Math.min(canvasRect.bottom - 8, (ribbon?.top ?? canvasRect.bottom) - 8),
    };
    const points = regionNames.map((name) => ({ name, point: window.__vivariumWorld?.screenPointForRegion(name) }));
    const crossings: Array<{ name: string; x: number; y: number }> = [];
    window.__viv?.scene.traverse((object) => {
      if (!object.name?.startsWith("crossing:")) return;
      const point = object.position.clone();
      object.getWorldPosition(point);
      point.project(window.__viv.camera);
      crossings.push({
        name: object.name,
        x: canvasRect.left + ((point.x + 1) / 2) * canvasRect.width,
        y: canvasRect.top + ((-point.y + 1) / 2) * canvasRect.height,
      });
    });
    const inside = (point: { x: number; y: number } | null | undefined): boolean => Boolean(
      point
      && point.x >= usable.left
      && point.x <= usable.right
      && point.y >= usable.top
      && point.y <= usable.bottom
    );
    const finite = points.flatMap(({ point }) => point ? [point] : []);
    const bounds = {
      left: Math.min(...finite.map(({ x }) => x)),
      right: Math.max(...finite.map(({ x }) => x)),
      top: Math.min(...finite.map(({ y }) => y)),
      bottom: Math.max(...finite.map(({ y }) => y)),
    };
    const occupancy = Math.max(
      (bounds.right - bounds.left) / Math.max(1, usable.right - usable.left),
      (bounds.bottom - bounds.top) / Math.max(1, usable.bottom - usable.top),
    );
    return {
      usable,
      points,
      crossings,
      occupancy,
      allCentroidsInside: points.every(({ point }) => inside(point)),
      allCrossingsInside: crossings.every(inside),
    };
  }, REGION_NAMES);
}

async function fogVisibilityState(
  page: Page,
  regionNames: readonly string[] = REGION_NAMES,
): Promise<Record<string, any>> {
  return page.evaluate((regionNames) => {
    const camera = window.__viv?.camera;
    const fog = window.__viv?.scene.fog;
    if (!camera || !fog || !("near" in fog) || !("far" in fog)) {
      throw new Error("The linear observer fog state is unavailable.");
    }
    camera.updateMatrixWorld(true);
    const smoothstep = (minimum: number, maximum: number, value: number): number => {
      const ratio = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-6, maximum - minimum)));
      return ratio * ratio * (3 - 2 * ratio);
    };
    const regions = regionNames.map((name) => {
      const world = window.__vivariumWorld?.worldPointForRegion(name);
      if (!world) throw new Error(`Region ${name} has no world centroid.`);
      const point = camera.position.clone().set(
        world.x,
        window.__viv.terrainHeight(world.x, world.z),
        world.z,
      );
      const view = point.clone().applyMatrix4(camera.matrixWorldInverse);
      const viewDepth = Math.max(0, -view.z);
      return {
        name,
        world: { x: point.x, y: point.y, z: point.z },
        cameraDistance: camera.position.distanceTo(point),
        viewDepth,
        fogFactor: smoothstep(fog.near, fog.far, viewDepth),
        screen: window.__vivariumWorld?.screenPointForRegion(name),
      };
    });
    return {
      phase: window.__vivariumWorld?.atmosphereState(),
      camera: {
        position: camera.position.toArray(),
        target: window.__viv?.controls.target.toArray(),
        distance: camera.position.distanceTo(window.__viv.controls.target),
        far: camera.far,
      },
      fog: { near: fog.near, far: fog.far },
      regions,
      minimumFogFactor: Math.min(...regions.map(({ fogFactor }) => fogFactor)),
      maximumFogFactor: Math.max(...regions.map(({ fogFactor }) => fogFactor)),
    };
  }, regionNames);
}

async function captureResponsive(
  context: BrowserContext,
  testInfo: TestInfo,
  name: string,
  viewport: { width: number; height: number },
): Promise<Record<string, any>> {
  const page = await context.newPage();
  try {
    await installLivingAtlasFixture(page, { viewport });
    await setPhase(page, PHASES.day.phase, PHASES.day.key);
    const topology = await frameTopology(page);
    expect(topology.allCentroidsInside).toBe(true);
    expect(topology.allCrossingsInside).toBe(true);
    if (viewport.width <= 390) {
      expect(topology.occupancy).toBeGreaterThanOrEqual(0.45);
      expect(topology.occupancy).toBeLessThanOrEqual(0.75);
    }
    return await captureJpeg(page, testInfo, name, {
      expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
      expectedQuality: "full",
      expectedSurface: null,
      extra: { topologyFrame: topology },
    });
  } finally {
    await page.close();
  }
}

test("initial atlas fog keeps four-region depth and every eight-region centroid readable", async ({ page, context }, testInfo) => {
  await installLivingAtlasFixture(page, { viewport: { width: 1440, height: 900 } });
  const eightRegionStates: Record<string, any>[] = [];
  for (const phase of [PHASES.day, PHASES.night]) {
    await setPhase(page, phase.phase, phase.key);
    eightRegionStates.push(await fogVisibilityState(page));
  }
  const fourRegionPage = await context.newPage();
  const fourRegionStates: Record<string, any>[] = [];
  try {
    await installLivingAtlasFixture(fourRegionPage, {
      viewport: { width: 1440, height: 900 },
      world: fourRegionWorld as typeof livingAtlasWorld,
    });
    for (const phase of [PHASES.day, PHASES.night]) {
      await setPhase(fourRegionPage, phase.phase, phase.key);
      fourRegionStates.push(await fogVisibilityState(fourRegionPage, FOUR_REGION_NAMES));
    }
  } finally {
    await fourRegionPage.close();
  }
  await testInfo.attach("eight-region-fog-visibility", {
    contentType: "application/json",
    body: JSON.stringify(eightRegionStates, null, 2),
  });
  await testInfo.attach("four-region-fog-visibility", {
    contentType: "application/json",
    body: JSON.stringify(fourRegionStates, null, 2),
  });
  for (const state of fourRegionStates) {
    expect(state.fog.near).toBeGreaterThanOrEqual(80);
    expect(state.fog.far).toBeGreaterThanOrEqual(210);
    expect(state.maximumFogFactor).toBeLessThanOrEqual(0.72);
    expect(state.maximumFogFactor - state.minimumFogFactor).toBeGreaterThanOrEqual(0.08);
  }
  for (const state of eightRegionStates) {
    expect(
      state.maximumFogFactor,
      `${state.phase.key} centroid fog ${JSON.stringify(state)}`,
    ).toBeLessThanOrEqual(0.72);
  }
});

test("Task8 captures deterministic Living Atlas evidence and mystic state truth", async ({ page, context }, testInfo) => {
  await installLivingAtlasFixture(page, { viewport: { width: 1440, height: 900 } });
  const initialHash = await page.evaluate(() => window.__vivariumWorld?.atlasLayoutHash());
  expect(initialHash).toBeTruthy();

  await setPhase(page, PHASES.day.phase, PHASES.day.key);
  const day = await captureJpeg(page, testInfo, "living-atlas-desktop-day", {
    expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
    expectedQuality: "full",
    expectedSurface: null,
  });
  expect(day.scenery.regionArchetypes).toMatchObject({
    nirvana_west: "ash_waste",
    warm_springs: "spring_terraces",
    nirvana_east: "dry_scrub",
    nirvana: "worn_heartland",
    quiet_coast: "neutral_temperate",
  });

  await setPhase(page, PHASES.golden.phase, PHASES.golden.key);
  const golden = await captureJpeg(page, testInfo, "living-atlas-desktop-golden-hour", {
    expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
    expectedQuality: "full",
    expectedSurface: null,
  });
  await setPhase(page, PHASES.night.phase, PHASES.night.key);
  const night = await captureJpeg(page, testInfo, "living-atlas-desktop-night", {
    expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
    expectedQuality: "full",
    expectedSurface: null,
  });
  for (const later of [golden, night]) {
    expect(later.layoutHash).toBe(day.layoutHash);
    expect(later.camera).toEqual(day.camera);
    expect(later.run.eventCursor).toBe(day.run.eventCursor);
    expect(later.scenery.recipeHash).toBe(day.scenery.recipeHash);
    expect(later.scenery.rebuildCount).toBe(day.scenery.rebuildCount);
    expect(later.budget.entityRebuildCount).toBe(day.budget.entityRebuildCount);
  }

  await setPhase(page, PHASES.golden.phase, PHASES.golden.key);
  const labelHidingStyle = await page.addStyleTag({
    content: ".viv-region-label { display: none !important; }",
  });
  await captureJpeg(page, testInfo, "living-atlas-desktop-full-quality", {
    expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
    expectedQuality: "full",
    expectedSurface: null,
    extra: { labels: "capture-only hidden", biomeReview: "silhouette and scenery only" },
  });
  await labelHidingStyle.evaluate((style) => style.remove());

  await setPhase(page, PHASES.day.phase, PHASES.day.key);
  const healthy = await focusAgent(page, "agent_healthy");
  expect(healthy.visual.semanticParts).toEqual(expect.arrayContaining([
    "under-robe",
    "open-cloak-left",
    "open-cloak-right",
    "deep-cowl",
    "shadow-face",
    "open-palm",
    "hand-flame",
  ]));
  expect(healthy.screenHeight).toBeGreaterThanOrEqual(120);
  const selectionPoint = await page.evaluate(() => window.__vivariumWorld?.screenPointForAgent("agent_healthy"));
  if (!selectionPoint) throw new Error("Healthy mystic selection point is missing.");
  await page.mouse.click(selectionPoint.x, selectionPoint.y);
  await expect(page.locator('[data-atlas-surface][data-open="true"]')).toHaveAttribute(
    "data-atlas-surface",
    "selection",
  );
  const selectionSafe = await page.evaluate(() => {
    const point = window.__vivariumWorld?.screenPointForAgent("agent_healthy");
    const surface = document.querySelector<HTMLElement>('[data-atlas-surface][data-open="true"]')?.getBoundingClientRect();
    return { point, surface: surface ? { left: surface.left, top: surface.top, right: surface.right, bottom: surface.bottom } : null };
  });
  expect(selectionSafe.point.x).toBeLessThan(selectionSafe.surface.left);
  await captureJpeg(page, testInfo, "living-atlas-selection", {
    expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
    expectedQuality: "full",
    expectedSurface: "selection",
    allowLockedScrollExtent: true,
    extra: { selectedAgent: "agent_healthy", safeFrame: selectionSafe },
  });
  await page.keyboard.press("Escape");

  const chroniclePage = await context.newPage();
  try {
    await installLivingAtlasFixture(chroniclePage, { viewport: { width: 1440, height: 900 } });
    await setPhase(chroniclePage, PHASES.day.phase, PHASES.day.key);
    await chroniclePage.evaluate((body) => window.__vivariumDispatchCaptureEvent?.(body), livingAtlasStoryEnvelope);
    await chroniclePage.waitForFunction((cursor) => (
      window.__vivariumLiveRun?.diagnostics().eventCursor === cursor
    ), livingAtlasStoryEnvelope.next_cursor);
    await openSurface(chroniclePage, "chronicle");
    await expect(chroniclePage.locator('.chronicle [data-event-kind="event"]')).toHaveCount(3);
    const chronicleCursors = await chroniclePage.locator('.chronicle [data-event-kind="event"]').evaluateAll((nodes) => (
      nodes.map((node) => Number(node.getAttribute("data-event-cursor")))
    ));
    expect(chronicleCursors).toEqual([43, 42, 41]);
    await captureJpeg(chroniclePage, testInfo, "living-atlas-chronicle", {
      expectedCursor: livingAtlasStoryEnvelope.next_cursor,
      expectedQuality: "full",
      expectedSurface: "chronicle",
      extra: { chronicleCursors, intendedEventEffects: [41, 42, 43] },
    });
  } finally {
    await chroniclePage.close();
  }

  const mysticPage = await context.newPage();
  try {
    await installLivingAtlasFixture(mysticPage, {
      viewport: { width: 1440, height: 900 },
      world: mysticCaptureWorld as typeof livingAtlasWorld,
    });
    await setPhase(mysticPage, PHASES.day.phase, PHASES.day.key);
    const galleryHealthy = await focusAgent(mysticPage, "agent_healthy");
    expect(galleryHealthy.visual.semanticParts).toEqual(expect.arrayContaining([
      "under-robe",
      "open-cloak-left",
      "open-cloak-right",
      "deep-cowl",
      "shadow-face",
      "open-palm",
      "hand-flame",
    ]));
    const selectedBeingLabelStyle = await mysticPage.addStyleTag({
      content: ".viv-region-label { display: none !important; }",
    });
    await captureJpeg(mysticPage, testInfo, "living-atlas-selected-being", {
      expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
      expectedQuality: "full",
      expectedSurface: null,
      allowLockedScrollExtent: true,
      extra: {
        selectedAgent: "agent_healthy",
        projectedHeight: galleryHealthy.screenHeight,
        labels: "capture-only hidden for silhouette evidence",
        fixtureKind: "truthful four-region mystic gallery",
      },
    });
    await selectedBeingLabelStyle.evaluate((style) => style.remove());

    for (const [name, agentId, expectedFlame, lightActive] of [
      ["healthy", "agent_healthy", "healthy", true],
      ["weary", "agent_weary", "weary", true],
      ["fallen", "agent_fallen", "fallen", false],
      ["dead", "agent_dead", "dead", false],
    ] as const) {
      const state = await focusAgent(mysticPage, agentId);
      expect(state.visual.flameState).toBe(expectedFlame);
      expect(state.visual.flameLightActive).toBe(lightActive);
      expect(Math.abs(state.screen.x - 720)).toBeLessThan(260);
      expect(Math.abs(state.screen.y - 450)).toBeLessThan(220);
      await captureJpeg(mysticPage, testInfo, `living-atlas-mystic-${name}`, {
        expectedCursor: LIVING_ATLAS_CAPTURE_CURSOR,
        expectedQuality: "full",
        expectedSurface: null,
        allowLockedScrollExtent: true,
        focusedAgentId: agentId,
        extra: {
          mysticState: name,
          agentId,
          agentTruth: state,
          fixtureKind: "truthful four-region mystic gallery",
        },
      });
    }
  } finally {
    await mysticPage.close();
  }

  const revivePage = await context.newPage();
  try {
    await installLivingAtlasFixture(revivePage, {
      viewport: { width: 1440, height: 900 },
      world: mysticCaptureWorld as typeof livingAtlasWorld,
    });
    await setPhase(revivePage, PHASES.day.phase, PHASES.day.key);
    const fallen = await focusAgent(revivePage, "agent_fallen");
    expect(fallen.visual.flameState).toBe("fallen");
    await revivePage.evaluate((body) => window.__vivariumDispatchCaptureEvent?.(body), livingAtlasRecoveryEnvelope);
    await revivePage.waitForFunction(() => window.__vivariumWorld?.activeEffects().some((effect) => (
      effect.eventType === "agent_recovered"
      && effect.summary?.kind === "agent-recovered-relight"
      && effect.summary.phase === "flame-catching"
      && effect.summary.progress >= 0.42
      && effect.summary.progress <= 0.68
    )));
    const revived = await revivePage.evaluate(() => ({
      agent: window.__vivariumWorld?.agentVisualState("agent_fallen"),
      effect: window.__vivariumWorld?.activeEffects().find((entry) => (
        entry.eventType === "agent_recovered"
        && entry.summary?.kind === "agent-recovered-relight"
      )),
    }));
    expect(revived.agent.visual.flameState).toBe("fallen");
    expect(revived.effect.summary.targetStateMutated).toBe(false);
    expect(revived.effect.summary).toMatchObject({
      kind: "agent-recovered-relight",
      phase: "flame-catching",
      relightCue: true,
      resourceStream: true,
    });
    const palm = revived.agent.semanticWorldPoints["open-palm"];
    expect(palm).toBeTruthy();
    for (const anchoredPoint of [
      revived.effect.summary.streamToWorld,
      revived.effect.summary.proxyFlameWorld,
      revived.effect.summary.relightLightWorld,
    ]) {
      expect(Math.hypot(
        anchoredPoint[0] - palm.x,
        anchoredPoint[1] - palm.y,
        anchoredPoint[2] - palm.z,
      )).toBeLessThan(0.01);
    }
    await captureJpeg(revivePage, testInfo, "living-atlas-mystic-revived", {
      expectedCursor: livingAtlasRecoveryEnvelope.next_cursor,
      expectedQuality: "full",
      expectedSurface: null,
      focusedAgentId: "agent_fallen",
      allowLockedScrollExtent: true,
      extra: {
        mysticState: "revived-transient",
        durableSnapshotState: "paralyzed/fallen",
        recoveryEffect: revived.effect,
      },
    });
  } finally {
    await revivePage.close();
  }

  await captureResponsive(context, testInfo, "living-atlas-tablet", { width: 1024, height: 768 });
  await captureResponsive(context, testInfo, "living-atlas-short", { width: 1498, height: 265 });
  await captureResponsive(context, testInfo, "living-atlas-mobile", { width: 390, height: 844 });

  const tourPage = await context.newPage();
  try {
    await tourPage.setViewportSize({ width: 1440, height: 900 });
    await tourPage.emulateMedia({ reducedMotion: "no-preference" });
    await tourPage.goto("/?source=event-demo");
    await tourPage.waitForFunction(() => (
      window.__vivariumWorld?.isReady === true
      && window.__vivariumLiveRun?.diagnostics().eventCursor >= 4
      && window.__vivariumWorld.sceneryDiagnostics().quality === "tour"
    ));
    await tourPage.addStyleTag({ content: ".viv-region-label { display: none !important; }" });
    await captureJpeg(tourPage, testInfo, "living-atlas-desktop-tour-quality", {
      expectedQuality: "tour",
      expectedSurface: null,
      extra: {
        comparisonKind: "public event-demo tour frame",
        directSameCameraComparator: false,
        caveat: "The public tour source is continuous and uses its own four-region fixture.",
      },
    });
  } finally {
    await tourPage.close();
  }

  const stateNames = ["healthy", "weary", "fallen", "revived", "dead"];
  const contactPage = await context.newPage();
  try {
    await contactPage.setViewportSize({ width: 1220, height: 560 });
    const panels = stateNames.map((state) => {
      const file = path.join(SHOT_DIRECTORY, `living-atlas-mystic-${state}.jpeg`);
      const data = fs.readFileSync(file).toString("base64");
      return `<figure><img alt="${state} mystic" src="data:image/jpeg;base64,${data}"><figcaption>${state}</figcaption></figure>`;
    }).join("");
    await contactPage.setContent(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width"><style>
      *{box-sizing:border-box}html,body{margin:0;background:#090d0e;color:#ede4d2;font-family:Inter,system-ui,sans-serif}
      main{width:1220px;height:560px;padding:22px;background:radial-gradient(circle at 50% 0,#1b2a29,#090d0e 60%)}
      h1{margin:0 0 16px;color:#d6b96f;font:600 22px Georgia,serif;letter-spacing:.08em;text-transform:uppercase}
      section{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}figure{margin:0;border:1px solid rgba(214,185,111,.35);border-radius:14px;overflow:hidden;background:#0d1516}
      img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}figcaption{padding:10px;text-align:center;color:#d6b96f;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    </style></head><body><main><h1>One flame, five truths</h1><section>${panels}</section></main></body></html>`);
    await twoStableFrames(contactPage);
    const contactPath = path.join(SHOT_DIRECTORY, "living-atlas-mystic-contact-sheet.jpeg");
    await contactPage.screenshot({ path: contactPath, type: "jpeg", quality: 90, fullPage: true });
    const bytes = fs.readFileSync(contactPath);
    const contactSidecar = {
      artifact: path.relative(process.cwd(), contactPath),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      jpegQuality: 90,
      sourceFrames: stateNames.map((state) => `living-atlas-mystic-${state}.jpeg`),
      construction: "Playwright contact sheet from separately asserted originals",
    };
    const contactJsonPath = path.join(SHOT_DIRECTORY, "living-atlas-mystic-contact-sheet.json");
    fs.writeFileSync(contactJsonPath, `${JSON.stringify(contactSidecar, null, 2)}\n`, "utf8");
    await testInfo.attach("living-atlas-mystic-contact-sheet-diagnostics", {
      path: contactJsonPath,
      contentType: "application/json",
    });
  } finally {
    await contactPage.close();
  }

  expect(await page.evaluate(() => window.__vivariumWorld?.atlasLayoutHash())).toBe(initialHash);
});
