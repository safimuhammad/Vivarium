import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  validateRuntimeVisualProofCandidate,
  type RuntimeVisualProofCandidate,
} from "./runtime-visual-proof";
import {
  installLivingAtlasFixture,
  livingAtlasRun,
  livingAtlasWorld,
} from "./living-atlas-fixture";

const ROUTE = "/?renderer=2d";
const STAGE_SELECTOR = ".presentation-world-stage";
const OUTPUT_DIRECTORY = resolve("scratchpad/task12-runtime-visual-proof");
const SOURCE_FILES = [
  "tests/frontend-app/runtime-visual-proof.ts",
  "tests/frontend-app/vivarium-2d-runtime-visual-proof.spec.ts",
  "tests/frontend-app/living-atlas-fixture.ts",
  "frontend/src/app/Vivarium2DApp.tsx",
  "frontend/src/app/Vivarium2DApp.css",
  "frontend/src/app/observer2d/LivingAtlas2D.tsx",
  "frontend/src/app/observer2d/SemanticWorldMirror.tsx",
  "frontend/src/renderer2d/camera/Camera2D.ts",
  "frontend/src/renderer2d/production/PresentationWorldStage.tsx",
  "frontend/src/renderer2d/production/PresentationWorldStage.css",
  "frontend/src/renderer2d/production/CanvasPresentationRenderer.ts",
  "frontend/src/renderer2d/production/ProductionSceneGraph.ts",
  "frontend/src/renderer2d/production/maps/biomeKits.ts",
  "frontend/src/renderer2d/production/maps/RegionMapIdentity.ts",
  "frontend/src/renderer2d/production/maps/RegionMapRecipe.ts",
  "frontend/src/renderer2d/production/assets/productionManifest.ts",
  "frontend/src/assets/renderer2d/core/production-core-source.json",
  ...["spring-terraces", "ash-waste", "dry-scrub", "worn-heartland", "neutral-temperate"]
    .flatMap((kit) => [
      `frontend/src/assets/renderer2d/regions/${kit}/pack.json`,
      `frontend/src/assets/renderer2d/regions/${kit}/terrain.png`,
      `frontend/src/assets/renderer2d/regions/${kit}/scenery.png`,
      `frontend/src/assets/renderer2d/regions/${kit}/environment.png`,
      `frontend/src/assets/renderer2d/homes/${kit}/pack.json`,
      `frontend/src/assets/renderer2d/homes/${kit}/components.png`,
      `frontend/src/assets/renderer2d/homes/${kit}/details.png`,
      `frontend/src/assets/renderer2d/homes/${kit}/ruins.png`,
    ]),
] as const;

const KIT_CASES = [
  { regionId: "warm_springs", kit: "spring-terraces", file: "kit-spring.png", waterComponents: [14, 14] },
  { regionId: "ember_reach", kit: "ash-waste", file: "kit-ash.png", waterComponents: [] },
  { regionId: "salt_scrub", kit: "dry-scrub", file: "kit-dry.png", waterComponents: [] },
  { regionId: "mossward", kit: "worn-heartland", file: "kit-worn.png", waterComponents: [] },
  { regionId: "quiet_coast", kit: "neutral-temperate", file: "kit-neutral.png", waterComponents: [10] },
] as const;

interface RuntimeStageProbeSnapshot {
  readonly frameIdentity: Readonly<{
    runId: string;
    sourceKey: string;
    revision: number;
    firstCursor: number;
    lastCursor: number;
  }> | null;
  readonly visibleRegionId: string | null;
  readonly loadingRegionId: string | null;
  readonly postCommit: Readonly<{
    acceptancePending: boolean;
    semanticPending: boolean;
  }>;
  readonly camera: Readonly<{
    mode: "story" | "follow" | "free";
    center: Readonly<{ x: number; y: number }>;
    zoom: number;
    followEntityId: string | null;
    storyTarget: Readonly<{ x: number; y: number; width: number; height: number }> | null;
    safeFrame: Readonly<{ x: number; y: number; width: number; height: number }>;
  }>;
  readonly graph: Readonly<{
    activeRegion: Readonly<{ id: string; recipeIdentityHash: string }> | null;
    actors: readonly Readonly<{
      id: string;
      position: Readonly<{ x: number; y: number }>;
      worldBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
      selected: boolean;
    }>[];
    homes: readonly Readonly<{
      id: string;
      kind: "home" | "ruin";
      kit: string;
      plot: Readonly<{ x: number; y: number }>;
    }>[];
  }>;
}

interface LoadedAssetEvidence {
  readonly path: string;
  readonly status: number;
  readonly contentType: string;
  readonly bytes: number;
  readonly sha256: string;
}

test("rejects the former manual-compositor screenshot proof before runtime evidence is accepted", () => {
  const bypass: RuntimeVisualProofCandidate = {
    origin: "manual-compositor",
    route: "/scratchpad/compositor.html",
    stageSelector: "",
    canvasLabel: "",
    stageReady: false,
    acceptedFrameIdentity: null,
    recipeIdentityMatchesRuntime: false,
    settledByDiagnostics: false,
    screenshotSha256: "0".repeat(64),
  };

  expect(validateRuntimeVisualProofCandidate(bypass)).toEqual([
    "proof origin must be the production Stage/Canvas",
    "proof route must be exact /?renderer=2d",
    "proof must bind .presentation-world-stage",
    "proof must bind the Vivarium world Canvas",
    "production Stage must be ready",
    "accepted frame identity is required",
    "generated recipe identity must match the runtime graph",
    "camera and semantic state must settle through diagnostics",
    "screenshot hash must be a nonzero SHA-256",
  ]);
});

test("real production Stage and Canvas prove five biome kits, structures, and safe Follow framing", async ({ page }) => {
  test.setTimeout(120_000);
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  const browserErrors: string[] = [];
  const loadedAssetTasks: Promise<LoadedAssetEvidence>[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!url.pathname.includes("/src/assets/renderer2d/") || !url.pathname.endsWith(".png")) return;
    loadedAssetTasks.push(response.body().then((bytes) => ({
      path: url.pathname,
      status: response.status(),
      contentType: response.headers()["content-type"] ?? "",
      bytes: bytes.length,
      sha256: sha256(bytes),
    })));
  });
  await page.addInitScript(() => {
    window.__vivariumEnableProductionDiagnosticsForTest = true;
  });
  await installLivingAtlasFixture(page, {
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
    routePath: ROUTE,
  });
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-reduced-motion", "true");

  const canvas = page.getByLabel("Vivarium world");
  await canvas.focus();
  await page.keyboard.press("v");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "free");

  const kitEvidence: Record<string, unknown>[] = [];
  let commonZoom: number | null = null;
  for (const kitCase of KIT_CASES) {
    await page.locator(`.living-atlas-2d__observe[data-region-key="${kitCase.regionId}"]`).click();
    const settled = await waitForDiagnosticSettle(page, kitCase.regionId, "free");
    const recipe = await collectRecipeDiagnostics(page, kitCase.regionId);

    expect(recipe.kit).toBe(kitCase.kit);
    expect(recipe.identityHash).toBe(settled.graphRecipeIdentityHash);
    expect(recipe.pathTiles).toBeGreaterThanOrEqual(80);
    expect(recipe.connectedPathTiles).toBe(recipe.pathTiles);
    expect(recipe.soilTiles).toBe(120);
    expect(recipe.soilComponentSizes).toEqual(Array.from({ length: 24 }, () => 5));
    expect(recipe.waterComponentSizes).toEqual(kitCase.waterComponents);
    expect(recipe.waterTiles).toBe(kitCase.waterComponents.reduce((total, size) => total + size, 0));
    if (kitCase.waterComponents.length > 0) expect(recipe.shoreTiles).toBeGreaterThan(0);
    else expect(recipe.shoreTiles).toBe(0);
    expect(recipe.staticScenery).toBe(192);
    expect(recipe.animatedScenery).toBe(32);
    expect(recipe.sceneryKinds).toEqual(recipe.expectedSceneryKinds);
    expect(recipe.variantFramesByKind.every((entry) => entry.distinctFrames >= 3)).toBe(true);
    expect(recipe.clusterMaxOccupancy).toBeGreaterThanOrEqual(3);
    expect(recipe.openFiveByFiveWindows).toBeGreaterThan(0);
    expect(settled.atlasNodeCount).toBe(8);
    expect(settled.atlasPairOverlaps).toBe(0);
    expect(settled.semanticSubjectCount).toBeGreaterThanOrEqual(1);

    if (commonZoom === null) commonZoom = settled.zoom;
    expect(settled.zoom).toBe(commonZoom);
    const raster = await readCanvasRasterContract(page);
    expect(raster.imageSmoothingEnabled).toBe(false);
    expect(raster.imageRendering).toMatch(/pixelated|crisp-edges/);
    expect(raster.transparentPixels).toBe(0);

    const frame = await captureDeterministicFrame(page, kitCase.file, {
      regionId: kitCase.regionId,
      graphRecipeIdentityHash: settled.graphRecipeIdentityHash,
      recipeHash: recipe.recipeHash,
    });
    expect(validateRuntimeVisualProofCandidate({
      origin: "production-stage-canvas",
      route: ROUTE,
      stageSelector: STAGE_SELECTOR,
      canvasLabel: "Vivarium world",
      stageReady: settled.stageReady,
      acceptedFrameIdentity: settled.frameIdentity,
      recipeIdentityMatchesRuntime: recipe.identityHash === settled.graphRecipeIdentityHash,
      settledByDiagnostics: settled.stableDiagnosticFrames >= 4,
      screenshotSha256: frame.sha256,
    })).toEqual([]);
    kitEvidence.push({ ...kitCase, settled, recipe, raster, frame });
  }

  await observeRegion(page, "warm_springs", "free");
  const waterFocal = await positionWaterWithPublicControls(page, "warm_springs");
  expect(waterFocal.componentTiles).toBe(14);
  expect(waterFocal.shoreTiles).toBeGreaterThan(0);
  expect(waterFocal.fullyInViewport).toBe(true);
  expect(waterFocal.fullyInCameraSafeFrame).toBe(true);
  expect(waterFocal.intersections).toEqual([]);
  expect(waterFocal.viewportTarget.right - waterFocal.viewportTarget.left).toBeGreaterThanOrEqual(320);
  expect(waterFocal.viewportTarget.bottom - waterFocal.viewportTarget.top).toBeGreaterThanOrEqual(240);
  const waterFocalFrame = await captureDeterministicFrame(page, "water-focal-spring.png", {
    regionId: "warm_springs",
    graphRecipeIdentityHash: waterFocal.graphRecipeIdentityHash,
    recipeHash: waterFocal.recipeHash,
  });

  await observeRegion(page, "salt_scrub", "free");
  const standingHomeButton = page.getByRole("region", { name: "World subjects" })
    .getByRole("button", { name: /^Hale's home Status:/ });
  await standingHomeButton.click();
  await page.getByRole("button", { name: "Follow", exact: true }).click();
  const standingHome = await waitForDiagnosticSettle(page, "salt_scrub", "follow");
  expect(standingHome.homeKinds).toContain("home");
  const homeScale = await collectHomeScale(page, "home");
  expect(homeScale.logicalWidth).toBeGreaterThan(32);
  expect(homeScale.logicalHeight).toBeGreaterThan(48);
  expect(homeScale.screenArea).toBeGreaterThan(homeScale.humanScreenArea);
  const standingScreen = await waitForStructureSafeSettle(page, "home");
  expect(standingScreen.fullyInViewport).toBe(true);
  expect(standingScreen.fullyInCameraSafeFrame).toBe(true);
  expect(standingScreen.intersections).toEqual([]);
  const standingFrame = await captureDeterministicFrame(page, "standing-home.png", {
    regionId: "salt_scrub",
    graphRecipeIdentityHash: standingHome.graphRecipeIdentityHash,
  });

  await observeRegion(page, "ember_reach", "free");
  const actor = page.getByRole("region", { name: "World subjects" })
    .getByRole("button", { name: /^Galen Status:/ });
  await actor.click();
  await expect(actor).toHaveAttribute("aria-pressed", "true");
  await canvas.focus();
  await page.keyboard.press("f");
  await expect(page.locator(".vivarium-2d-app")).toHaveAttribute("data-camera-mode", "follow");
  for (let zoom = 0; zoom < 3; zoom += 1) await page.keyboard.press("+");
  const desktopFollow = await waitForSafeFollow(page, "ember_reach", "agent_ember");
  expect(desktopFollow.logicalTarget).toEqual({ width: 67, height: 72 });
  expect(desktopFollow.intersections).toEqual([]);
  const desktopFollowFrame = await captureDeterministicFrame(page, "follow-desktop.png", {
    regionId: "ember_reach",
    graphRecipeIdentityHash: desktopFollow.graphRecipeIdentityHash,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileFollow = await waitForSafeFollow(page, "ember_reach", "agent_ember");
  expect(mobileFollow.logicalTarget).toEqual({ width: 67, height: 72 });
  expect(mobileFollow.intersections).toEqual([]);
  const mobileFollowFrame = await captureDeterministicFrame(page, "follow-mobile.png", {
    regionId: "ember_reach",
    graphRecipeIdentityHash: mobileFollow.graphRecipeIdentityHash,
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await observeRegion(page, "nirvana_west", "free");
  const ruinButton = page.getByRole("region", { name: "World subjects" })
    .getByRole("button", { name: /^Dusk's former home Status:/ });
  await ruinButton.click();
  const ruin = await waitForDiagnosticSettle(page, "nirvana_west", "free");
  expect(ruin.homeKinds).toContain("ruin");
  const ruinScale = await collectHomeScale(page, "ruin");
  expect(ruinScale.logicalWidth).toBeGreaterThan(32);
  expect(ruinScale.logicalHeight).toBeGreaterThan(48);
  expect(ruinScale.screenArea).toBeGreaterThan(ruinScale.humanScreenArea);
  const ruinScreen = await positionStructureWithPublicControls(page, "ruin");
  expect(ruinScreen.fullyInViewport).toBe(true);
  expect(ruinScreen.fullyInCameraSafeFrame).toBe(true);
  expect(ruinScreen.intersections).toEqual([]);
  const ruinFrame = await captureDeterministicFrame(page, "ruin.png", {
    regionId: "nirvana_west",
    graphRecipeIdentityHash: ruin.graphRecipeIdentityHash,
  });

  expect(browserErrors).toEqual([]);
  const loadedAssets = await Promise.all(loadedAssetTasks);
  const uniqueLoadedAssets = [...new Map(loadedAssets.map((asset) => [asset.path, asset])).values()]
    .sort((left, right) => left.path.localeCompare(right.path));
  for (const kitCase of KIT_CASES) {
    for (const file of ["terrain.png", "scenery.png", "environment.png"]) {
      expect(uniqueLoadedAssets.some((asset) => (
        asset.path.includes(`/regions/${kitCase.kit}/`) && asset.path.endsWith(`/${file}`)
      )), `${kitCase.kit}/${file} must be a real loaded response`).toBe(true);
    }
  }
  expect(uniqueLoadedAssets.every((asset) => (
    asset.status === 200 && asset.contentType.startsWith("image/png")
      && asset.bytes > 0 && /^(?!0{64}$)[0-9a-f]{64}$/.test(asset.sha256)
  ))).toBe(true);
  const sourceIdentity = sourceIdentitySha256();
  const sidecar = {
    schema: 1,
    proof: "provider-free-real-production-stage-canvas",
    route: ROUTE,
    fixture: {
      runId: livingAtlasRun.run_id,
      runSeed: livingAtlasRun.seed,
      cursor: livingAtlasWorld.event_cursor,
      worldSha256: sha256(Buffer.from(JSON.stringify(livingAtlasWorld))),
    },
    sourceIdentity,
    loadedAssets: uniqueLoadedAssets,
    commonKitZoom: commonZoom,
    kits: kitEvidence,
    waterFocal: { diagnostics: waterFocal, frame: waterFocalFrame },
    structures: {
      standing: { diagnostics: standingHome, scale: homeScale, screen: standingScreen, frame: standingFrame },
      ruin: { diagnostics: ruin, scale: ruinScale, screen: ruinScreen, followAuthorized: false, frame: ruinFrame },
    },
    follow: {
      desktop: { diagnostics: desktopFollow, frame: desktopFollowFrame },
      mobile: { diagnostics: mobileFollow, frame: mobileFollowFrame },
    },
  };
  const sidecarBytes = Buffer.from(`${JSON.stringify(sidecar, null, 2)}\n`);
  writeFileSync(resolve(OUTPUT_DIRECTORY, "runtime-visual-proof.json"), sidecarBytes);
  test.info().annotations.push({
    type: "runtime visual proof",
    description: `sidecar=${sha256(sidecarBytes)} source=${sourceIdentity.aggregateSha256}`,
  });
});

async function observeRegion(
  page: Page,
  regionId: string,
  cameraMode: "story" | "free",
): Promise<void> {
  await page.locator(`.living-atlas-2d__observe[data-region-key="${regionId}"]`).click();
  await page.waitForFunction(({ stageSelector, expectedRegionId }) => {
    const stage = document.querySelector(stageSelector);
    const snapshot = stage === null
      ? null
      : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
    return stage instanceof HTMLElement
      && stage.dataset.ready === "true"
      && snapshot?.visibleRegionId === expectedRegionId
      && snapshot?.loadingRegionId === null
      && snapshot?.graph?.activeRegion?.id === expectedRegionId
      && snapshot?.postCommit?.acceptancePending === false
      && snapshot?.postCommit?.semanticPending === false;
  }, { stageSelector: STAGE_SELECTOR, expectedRegionId: regionId });
  await page.getByRole("button", {
    name: cameraMode === "story" ? "Story" : "Free",
    exact: true,
  }).click();
  await waitForDiagnosticSettle(page, regionId, cameraMode);
}

async function waitForDiagnosticSettle(
  page: Page,
  regionId: string,
  cameraMode: "story" | "follow" | "free",
): Promise<{
  stageReady: boolean;
  frameIdentity: string;
  graphRecipeIdentityHash: string;
  zoom: number;
  stableDiagnosticFrames: number;
  homeKinds: string[];
  atlasNodeCount: number;
  atlasPairOverlaps: number;
  semanticSubjectCount: number;
}> {
  return page.evaluate(async ({ stageSelector, expectedRegionId, expectedMode }) => {
    const nextFrame = (): Promise<void> => new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    let priorCameraKey = "";
    let stableDiagnosticFrames = 0;
    let lastObserved: unknown = null;
    for (let frame = 0; frame < 360; frame += 1) {
      await nextFrame();
      const stage = document.querySelector<HTMLElement>(stageSelector);
      const snapshot = stage === null
        ? null
        : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
      const identity = snapshot?.frameIdentity;
      const active = snapshot?.graph?.activeRegion;
      const camera = snapshot?.camera;
      const atlasButtons = [...document.querySelectorAll<HTMLElement>(
        ".living-atlas-2d__observe[data-region-key]",
      )];
      const atlasRects = atlasButtons.map((button) => {
        const rect = button.getBoundingClientRect();
        return { key: button.dataset.regionKey ?? "", x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
      let atlasPairOverlaps = 0;
      for (let left = 0; left < atlasRects.length; left += 1) {
        for (let right = left + 1; right < atlasRects.length; right += 1) {
          const first = atlasRects[left]!;
          const second = atlasRects[right]!;
          if (Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x)
            && Math.min(first.y + first.height, second.y + second.height) > Math.max(first.y, second.y)) {
            atlasPairOverlaps += 1;
          }
        }
      }
      const observedButton = atlasButtons.find((button) => button.dataset.regionKey === expectedRegionId);
      const detail = document.querySelector<HTMLElement>(".living-atlas-2d__detail[data-region-key]");
      const semanticSubjectCount = document.querySelectorAll(
        ".semantic-world-mirror button[data-subject-token]",
      ).length;
      const semanticReady = atlasButtons.length === 8
        && atlasPairOverlaps === 0
        && atlasRects.every((rect) => rect.width >= 44 && rect.height >= 44)
        && observedButton?.getAttribute("aria-pressed") === "true"
        && detail?.dataset.regionKey === expectedRegionId
        && semanticSubjectCount >= 1;
      lastObserved = {
        stageReady: stage?.dataset.ready,
        visibleRegionId: snapshot?.visibleRegionId,
        loadingRegionId: snapshot?.loadingRegionId,
        activeRegionId: active?.id,
        frameIdentity: identity,
        postCommit: snapshot?.postCommit,
        cameraMode: camera?.mode,
        camera: camera === undefined ? null : {
          center: camera.center,
          zoom: camera.zoom,
          safeFrame: camera.safeFrame,
        },
        atlasNodeCount: atlasButtons.length,
        atlasPairOverlaps,
        observedRegionId: observedButton?.dataset.regionKey,
        detailedRegionId: detail?.dataset.regionKey,
        semanticSubjectCount,
      };
      const eligible = stage?.dataset.ready === "true"
        && snapshot?.visibleRegionId === expectedRegionId
        && snapshot?.loadingRegionId === null
        && active?.id === expectedRegionId
        && identity !== null && identity !== undefined
        && snapshot?.postCommit?.acceptancePending === false
        && snapshot?.postCommit?.semanticPending === false
        && camera?.mode === expectedMode
        && semanticReady;
      const cameraKey = eligible
        ? JSON.stringify({
            center: camera.center,
            zoom: camera.zoom,
            safe: camera.safeFrame,
            atlasRects,
            observedRegionId: observedButton?.dataset.regionKey,
            detailedRegionId: detail?.dataset.regionKey,
            semanticSubjectCount,
          })
        : "";
      stableDiagnosticFrames = cameraKey !== "" && cameraKey === priorCameraKey
        ? stableDiagnosticFrames + 1
        : cameraKey === "" ? 0 : 1;
      priorCameraKey = cameraKey;
      if (stableDiagnosticFrames < 4) continue;
      return {
        stageReady: true,
        frameIdentity: [
          identity.runId,
          identity.sourceKey,
          identity.revision,
          identity.firstCursor,
          identity.lastCursor,
        ].join(":"),
        graphRecipeIdentityHash: active.recipeIdentityHash,
        zoom: camera.zoom,
        stableDiagnosticFrames,
        homeKinds: snapshot.graph.homes.map((home) => home.kind),
        atlasNodeCount: atlasButtons.length,
        atlasPairOverlaps,
        semanticSubjectCount,
      };
    }
    throw new Error(`production diagnostics did not settle for ${expectedRegionId}/${expectedMode}: ${JSON.stringify(lastObserved)}`);
  }, { stageSelector: STAGE_SELECTOR, expectedRegionId: regionId, expectedMode: cameraMode });
}

async function waitForSafeFollow(
  page: Page,
  regionId: string,
  actorId: string,
): Promise<{
  frameIdentity: string;
  graphRecipeIdentityHash: string;
  stableDiagnosticFrames: number;
  zoom: number;
  logicalTarget: { width: number; height: number };
  viewportTarget: { left: number; top: number; right: number; bottom: number };
  intersections: string[];
}> {
  return page.evaluate(async ({ stageSelector, expectedRegionId, expectedActorId }) => {
    const overlaySelectors = [
      ".observer-hud",
      ".living-atlas-2d",
      ".semantic-world-mirror",
      ".dialogue-now",
      ".observer-edge-triggers",
    ];
    const nextFrame = (): Promise<void> => new Promise((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
    let priorTransform = "";
    let stableDiagnosticFrames = 0;
    let lastObserved: unknown = null;
    for (let frame = 0; frame < 360; frame += 1) {
      await nextFrame();
      const stage = document.querySelector<HTMLElement>(stageSelector);
      const canvas = stage?.querySelector<HTMLCanvasElement>('canvas[aria-label="Vivarium world"]') ?? null;
      const snapshot = stage === null
        ? null
        : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
      const camera = snapshot?.camera;
      const actor = snapshot?.graph.actors.find((candidate) => candidate.id === expectedActorId);
      const target = camera?.storyTarget ?? actor?.worldBounds ?? null;
      const active = snapshot?.graph?.activeRegion;
      lastObserved = {
        stageReady: stage?.dataset.ready,
        visibleRegionId: snapshot?.visibleRegionId,
        loadingRegionId: snapshot?.loadingRegionId,
        activeRegionId: active?.id,
        cameraMode: camera?.mode,
        followEntityId: camera?.followEntityId,
        actor,
        target,
        postCommit: snapshot?.postCommit,
      };
      if (stage?.dataset.ready !== "true" || canvas === null
        || snapshot?.visibleRegionId !== expectedRegionId || snapshot?.loadingRegionId !== null
        || active?.id !== expectedRegionId || camera?.mode !== "follow"
        || camera?.followEntityId !== `agent:${expectedActorId}` || actor?.selected !== true
        || target === null || target === undefined
        || snapshot?.postCommit?.acceptancePending !== false
        || snapshot?.postCommit?.semanticPending !== false) {
        priorTransform = "";
        stableDiagnosticFrames = 0;
        continue;
      }
      const canvasRect = canvas.getBoundingClientRect();
      const scaleX = canvasRect.width / canvas.width;
      const scaleY = canvasRect.height / canvas.height;
      const left = canvasRect.left + ((canvas.width / 2) + ((target.x - camera.center.x) * camera.zoom)) * scaleX;
      const top = canvasRect.top + ((canvas.height / 2) + ((target.y - camera.center.y) * camera.zoom)) * scaleY;
      const right = left + target.width * camera.zoom * scaleX;
      const bottom = top + target.height * camera.zoom * scaleY;
      const targetRect = { left, top, right, bottom };
      const overlayRects = overlaySelectors.flatMap((selector) => {
        const node = document.querySelector<HTMLElement>(selector);
        if (node === null) return [];
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden"
          ? [{ selector, rect }]
          : [];
      });
      const intersections = overlayRects.filter(({ rect }) => (
        Math.min(right, rect.right) > Math.max(left, rect.left)
        && Math.min(bottom, rect.bottom) > Math.max(top, rect.top)
      )).map(({ selector }) => selector);
      const transform = JSON.stringify({ center: camera.center, zoom: camera.zoom, targetRect });
      const fullyVisible = left >= -0.5 && top >= -0.5
        && right <= innerWidth + 0.5 && bottom <= innerHeight + 0.5;
      stableDiagnosticFrames = fullyVisible && intersections.length === 0 && transform === priorTransform
        ? stableDiagnosticFrames + 1
        : fullyVisible && intersections.length === 0 ? 1 : 0;
      priorTransform = transform;
      if (stableDiagnosticFrames < 4) continue;
      const identity = snapshot.frameIdentity;
      return {
        frameIdentity: [
          identity.runId,
          identity.sourceKey,
          identity.revision,
          identity.firstCursor,
          identity.lastCursor,
        ].join(":"),
        graphRecipeIdentityHash: active.recipeIdentityHash,
        stableDiagnosticFrames,
        zoom: camera.zoom,
        logicalTarget: { width: target.width, height: target.height },
        viewportTarget: targetRect,
        intersections,
      };
    }
    throw new Error(`full actor rect never settled safely for ${expectedRegionId}/${expectedActorId}: ${JSON.stringify(lastObserved)}`);
  }, { stageSelector: STAGE_SELECTOR, expectedRegionId: regionId, expectedActorId: actorId });
}

async function collectRecipeDiagnostics(page: Page, regionId: string): Promise<{
  kit: string;
  identityHash: string;
  recipeHash: string;
  pathTiles: number;
  connectedPathTiles: number;
  soilTiles: number;
  soilComponentSizes: number[];
  waterTiles: number;
  waterComponentSizes: number[];
  shoreTiles: number;
  staticScenery: number;
  animatedScenery: number;
  sceneryKinds: string[];
  expectedSceneryKinds: string[];
  variantFramesByKind: Array<{ kind: string; distinctFrames: number }>;
  clusterMaxOccupancy: number;
  openFiveByFiveWindows: number;
}> {
  return page.evaluate(async ({ world, seed, expectedRegionId }) => {
    const identityModule = await import("/src/renderer2d/production/maps/RegionMapIdentity.ts");
    const recipeModule = await import("/src/renderer2d/production/maps/RegionMapRecipe.ts");
    const kitModule = await import("/src/renderer2d/production/maps/biomeKits.ts");
    const rendererModule = await import("/src/renderer2d/production/CanvasPresentationRenderer.ts");
    const manifestModule = await import("/src/renderer2d/production/assets/productionManifest.ts");
    const region = world.regions.find((candidate) => candidate.name === expectedRegionId);
    if (region === undefined) throw new Error(`missing fixture region ${expectedRegionId}`);
    const identity = identityModule.createRegionMapIdentity(seed, region, world.regions);
    const recipe = recipeModule.createRegionMapRecipe(identity);
    const kit = kitModule.getBiomeKit(recipe.kit);
    const pack = manifestModule.PRODUCTION_ASSET_MANIFEST.regions[recipe.kit];
    const count = (mask: Uint8Array): number => [...mask].filter((value) => value === 1).length;
    const componentSizes = (mask: Uint8Array): number[] => {
      const remaining = new Set([...mask].flatMap((value, index) => value === 1 ? [index] : []));
      const sizes: number[] = [];
      while (remaining.size > 0) {
        const start = remaining.values().next().value as number;
        const pending = [start];
        remaining.delete(start);
        let size = 0;
        while (pending.length > 0) {
          const index = pending.pop()!;
          size += 1;
          const column = index % recipe.grid.columns;
          const row = Math.floor(index / recipe.grid.columns);
          for (const [nextColumn, nextRow] of [
            [column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1],
          ]) {
            if (nextColumn < 0 || nextColumn >= recipe.grid.columns
              || nextRow < 0 || nextRow >= recipe.grid.rows) continue;
            const next = nextRow * recipe.grid.columns + nextColumn;
            if (!remaining.delete(next)) continue;
            pending.push(next);
          }
        }
        sizes.push(size);
      }
      return sizes.sort((left, right) => left - right);
    };
    let shoreTiles = 0;
    for (let row = 0; row < recipe.grid.rows; row += 1) {
      for (let column = 0; column < recipe.grid.columns; column += 1) {
        if (rendererModule.terrainRoleAt(recipe, column, row) === "shore") shoreTiles += 1;
      }
    }
    const sceneryKinds = [...new Set(recipe.staticScenery.map((placement) => placement.kind))].sort();
    const expectedSceneryKinds = [...kit.blockingScenery, ...kit.passiveScenery].sort();
    const variantFramesByKind = sceneryKinds.map((kind) => {
      const variants = pack.staticSceneryVariants[kind];
      const frames = new Set(recipe.staticScenery.filter((placement) => placement.kind === kind).map((placement) => {
        const index = rendererModule.sceneryVariantIndex(
          placement.id,
          placement.tile.column,
          placement.tile.row,
          variants.length,
        );
        const frame = variants[index].rect;
        return `${frame.x},${frame.y},${frame.width},${frame.height}`;
      }));
      return { kind, distinctFrames: frames.size };
    });
    const occupied = new Set([
      ...recipe.staticScenery,
      ...recipe.animatedEnvironment,
    ].map((placement) => `${placement.tile.column},${placement.tile.row}`));
    const occupancy = (column: number, row: number, width: number, height: number): number => {
      let total = 0;
      for (let y = row; y < row + height; y += 1) {
        for (let x = column; x < column + width; x += 1) {
          if (occupied.has(`${x},${y}`)) total += 1;
        }
      }
      return total;
    };
    let clusterMaxOccupancy = 0;
    let openFiveByFiveWindows = 0;
    for (let row = 1; row <= recipe.grid.rows - 6; row += 1) {
      for (let column = 1; column <= recipe.grid.columns - 6; column += 1) {
        clusterMaxOccupancy = Math.max(clusterMaxOccupancy, occupancy(column, row, 6, 6));
        if (occupancy(column, row, 5, 5) === 0) openFiveByFiveWindows += 1;
      }
    }
    const pathComponents = componentSizes(recipe.pathMask);
    return {
      kit: recipe.kit,
      identityHash: recipe.identityHash,
      recipeHash: recipeModule.regionMapRecipeHash(recipe),
      pathTiles: count(recipe.pathMask),
      connectedPathTiles: pathComponents[0] ?? 0,
      soilTiles: count(recipe.soilMask),
      soilComponentSizes: componentSizes(recipe.soilMask),
      waterTiles: count(recipe.waterVoidMask),
      waterComponentSizes: componentSizes(recipe.waterVoidMask),
      shoreTiles,
      staticScenery: recipe.staticScenery.length,
      animatedScenery: recipe.animatedEnvironment.length,
      sceneryKinds,
      expectedSceneryKinds,
      variantFramesByKind,
      clusterMaxOccupancy,
      openFiveByFiveWindows,
    };
  }, { world: livingAtlasWorld, seed: livingAtlasRun.seed, expectedRegionId: regionId });
}

async function readCanvasRasterContract(page: Page): Promise<{
  imageSmoothingEnabled: boolean;
  imageRendering: string;
  transparentPixels: number;
}> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="Vivarium world"]');
    if (canvas === null) throw new Error("production Canvas is missing");
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("production Canvas2D context is missing");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparentPixels = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 255) transparentPixels += 1;
    }
    return {
      imageSmoothingEnabled: context.imageSmoothingEnabled,
      imageRendering: getComputedStyle(canvas).imageRendering,
      transparentPixels,
    };
  });
}

interface WaterScreenAudit {
  readonly regionId: string;
  readonly recipeHash: string;
  readonly graphRecipeIdentityHash: string;
  readonly componentTiles: number;
  readonly shoreTiles: number;
  readonly authoredWorldRect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly viewportTarget: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly viewportSafeFrame: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly fullyInViewport: boolean;
  readonly fullyInCameraSafeFrame: boolean;
  readonly intersections: readonly string[];
  readonly zoom: number;
  readonly cameraMode: "story" | "follow" | "free";
}

async function readWaterScreenAudit(page: Page, regionId: string): Promise<WaterScreenAudit> {
  return page.evaluate(async ({ stageSelector, expectedRegionId, world, seed }) => {
    const identityModule = await import("/src/renderer2d/production/maps/RegionMapIdentity.ts");
    const recipeModule = await import("/src/renderer2d/production/maps/RegionMapRecipe.ts");
    const rendererModule = await import("/src/renderer2d/production/CanvasPresentationRenderer.ts");
    const region = world.regions.find((candidate) => candidate.name === expectedRegionId);
    if (region === undefined) throw new Error(`missing fixture region ${expectedRegionId}`);
    const recipe = recipeModule.createRegionMapRecipe(
      identityModule.createRegionMapIdentity(seed, region, world.regions),
    );
    const remaining = new Set([...recipe.waterVoidMask].flatMap((value, index) => value === 1 ? [index] : []));
    const components: number[][] = [];
    while (remaining.size > 0) {
      const start = remaining.values().next().value as number;
      const pending = [start];
      const component: number[] = [];
      remaining.delete(start);
      while (pending.length > 0) {
        const index = pending.pop()!;
        component.push(index);
        const column = index % recipe.grid.columns;
        const row = Math.floor(index / recipe.grid.columns);
        for (const [nextColumn, nextRow] of [
          [column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1],
        ]) {
          if (nextColumn < 0 || nextColumn >= recipe.grid.columns
            || nextRow < 0 || nextRow >= recipe.grid.rows) continue;
          const next = nextRow * recipe.grid.columns + nextColumn;
          if (!remaining.delete(next)) continue;
          pending.push(next);
        }
      }
      components.push(component.sort((left, right) => left - right));
    }
    components.sort((left, right) => (left[0] ?? 0) - (right[0] ?? 0));
    const water = components[0];
    if (water === undefined) throw new Error(`${expectedRegionId} has no authored water component`);
    const waterSet = new Set(water);
    const shore = new Set<number>();
    for (let row = 0; row < recipe.grid.rows; row += 1) {
      for (let column = 0; column < recipe.grid.columns; column += 1) {
        const index = row * recipe.grid.columns + column;
        if (rendererModule.terrainRoleAt(recipe, column, row) !== "shore") continue;
        const touchesComponent = [
          index - recipe.grid.columns,
          index + 1,
          index + recipe.grid.columns,
          index - 1,
        ].some((candidate) => waterSet.has(candidate));
        if (touchesComponent) shore.add(index);
      }
    }
    const columns = water.map((index) => index % recipe.grid.columns);
    const rows = water.map((index) => Math.floor(index / recipe.grid.columns));
    const minColumn = Math.min(...columns);
    const maxColumn = Math.max(...columns);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const target = {
      x: minColumn * 32,
      y: minRow * 32,
      width: (maxColumn - minColumn + 1) * 32,
      height: (maxRow - minRow + 1) * 32,
    };
    const stage = document.querySelector<HTMLElement>(stageSelector);
    const canvas = stage?.querySelector<HTMLCanvasElement>('canvas[aria-label="Vivarium world"]') ?? null;
    const snapshot = stage === null
      ? null
      : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
    if (canvas === null || snapshot === null || snapshot === undefined
      || snapshot.graph.activeRegion?.id !== expectedRegionId) {
      throw new Error(`runtime ${expectedRegionId} geometry is unavailable`);
    }
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const camera = snapshot.camera;
    const left = canvasRect.left + ((canvas.width / 2) + ((target.x - camera.center.x) * camera.zoom)) * scaleX;
    const top = canvasRect.top + ((canvas.height / 2) + ((target.y - camera.center.y) * camera.zoom)) * scaleY;
    const right = left + target.width * camera.zoom * scaleX;
    const bottom = top + target.height * camera.zoom * scaleY;
    const safe = camera.safeFrame;
    const viewportSafeFrame = {
      left: canvasRect.left + safe.x * scaleX,
      top: canvasRect.top + safe.y * scaleY,
      right: canvasRect.left + (safe.x + safe.width) * scaleX,
      bottom: canvasRect.top + (safe.y + safe.height) * scaleY,
    };
    const overlaySelectors = [
      ".observer-hud", ".living-atlas-2d", ".semantic-world-mirror",
      ".dialogue-now", ".observer-edge-triggers",
    ];
    const intersections = overlaySelectors.flatMap((selector) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (node === null) return [];
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return [];
      return Math.min(right, rect.right) > Math.max(left, rect.left)
        && Math.min(bottom, rect.bottom) > Math.max(top, rect.top)
        ? [selector]
        : [];
    });
    return {
      regionId: expectedRegionId,
      recipeHash: recipeModule.regionMapRecipeHash(recipe),
      graphRecipeIdentityHash: snapshot.graph.activeRegion.recipeIdentityHash,
      componentTiles: water.length,
      shoreTiles: shore.size,
      authoredWorldRect: target,
      viewportTarget: { left, top, right, bottom },
      viewportSafeFrame,
      fullyInViewport: left >= -0.5 && top >= -0.5
        && right <= innerWidth + 0.5 && bottom <= innerHeight + 0.5,
      fullyInCameraSafeFrame: left >= viewportSafeFrame.left - 0.5
        && top >= viewportSafeFrame.top - 0.5
        && right <= viewportSafeFrame.right + 0.5
        && bottom <= viewportSafeFrame.bottom + 0.5,
      intersections,
      zoom: camera.zoom,
      cameraMode: camera.mode,
    };
  }, {
    stageSelector: STAGE_SELECTOR,
    expectedRegionId: regionId,
    world: livingAtlasWorld,
    seed: livingAtlasRun.seed,
  });
}

async function positionWaterWithPublicControls(
  page: Page,
  regionId: string,
): Promise<WaterScreenAudit> {
  const canvas = page.getByLabel("Vivarium world");
  await canvas.focus();
  await page.keyboard.press("v");
  for (let operation = 0; operation < 420; operation += 1) {
    const audit = await readWaterScreenAudit(page, regionId);
    const targetWidth = audit.viewportTarget.right - audit.viewportTarget.left;
    const targetHeight = audit.viewportTarget.bottom - audit.viewportTarget.top;
    const safeWidth = audit.viewportSafeFrame.right - audit.viewportSafeFrame.left;
    const safeHeight = audit.viewportSafeFrame.bottom - audit.viewportSafeFrame.top;
    const safelyVisible = audit.fullyInViewport && audit.fullyInCameraSafeFrame
      && audit.intersections.length === 0;
    if (safelyVisible && targetWidth >= 320 && targetHeight >= 240) {
      return waitForWaterSafeSettle(page, regionId);
    }
    let key: "+" | "-" | "ArrowRight" | "ArrowLeft" | "ArrowDown" | "ArrowUp";
    if (targetWidth > safeWidth || targetHeight > safeHeight) key = "-";
    else if ((targetWidth < 320 || targetHeight < 240)
      && targetWidth * 1.25 <= safeWidth && targetHeight * 1.25 <= safeHeight) key = "+";
    else if (audit.viewportTarget.left < audit.viewportSafeFrame.left) key = "ArrowRight";
    else if (audit.viewportTarget.right > audit.viewportSafeFrame.right) key = "ArrowLeft";
    else if (audit.viewportTarget.top < audit.viewportSafeFrame.top) key = "ArrowDown";
    else if (audit.viewportTarget.bottom > audit.viewportSafeFrame.bottom) key = "ArrowUp";
    else if (audit.intersections.includes(".observer-hud")) key = "ArrowUp";
    else if (audit.intersections.includes(".living-atlas-2d")) key = "ArrowLeft";
    else if (audit.intersections.includes(".semantic-world-mirror")) key = "ArrowRight";
    else if (targetWidth * 1.25 <= safeWidth && targetHeight * 1.25 <= safeHeight) key = "+";
    else return waitForWaterSafeSettle(page, regionId);
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
  }
  const finalAudit = await readWaterScreenAudit(page, regionId);
  throw new Error(`public Free controls could not safely frame water: ${JSON.stringify(finalAudit)}`);
}

async function waitForWaterSafeSettle(page: Page, regionId: string): Promise<WaterScreenAudit> {
  let prior = "";
  let stableFrames = 0;
  let last: WaterScreenAudit | null = null;
  for (let frame = 0; frame < 360; frame += 1) {
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
    const audit = await readWaterScreenAudit(page, regionId);
    last = audit;
    const key = JSON.stringify({
      authoredWorldRect: audit.authoredWorldRect,
      viewportTarget: audit.viewportTarget,
      viewportSafeFrame: audit.viewportSafeFrame,
      zoom: audit.zoom,
      mode: audit.cameraMode,
    });
    const width = audit.viewportTarget.right - audit.viewportTarget.left;
    const height = audit.viewportTarget.bottom - audit.viewportTarget.top;
    const eligible = audit.fullyInViewport && audit.fullyInCameraSafeFrame
      && audit.intersections.length === 0 && width >= 320 && height >= 240;
    stableFrames = eligible && key === prior ? stableFrames + 1 : eligible ? 1 : 0;
    prior = key;
    if (stableFrames >= 4) return audit;
  }
  throw new Error(`water focal rect did not settle safely: ${JSON.stringify(last)}`);
}

async function collectHomeScale(page: Page, kind: "home" | "ruin"): Promise<{
  logicalWidth: number;
  logicalHeight: number;
  screenArea: number;
  humanScreenArea: number;
}> {
  return page.evaluate(async ({ stageSelector, expectedKind }) => {
    const manifestModule = await import("/src/renderer2d/production/assets/productionManifest.ts");
    const stage = document.querySelector(stageSelector);
    const snapshot = stage === null
      ? null
      : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
    const home = snapshot?.graph.homes.find((candidate) => candidate.kind === expectedKind);
    if (home === undefined) throw new Error(`runtime graph has no ${expectedKind}`);
    const kits = manifestModule.PRODUCTION_ASSET_MANIFEST.regions;
    const logical = kits[home.kit as keyof typeof kits].homeManifest.logicalBounds;
    const zoom = snapshot.camera.zoom;
    return {
      logicalWidth: logical.width,
      logicalHeight: logical.height,
      screenArea: logical.width * logical.height * zoom * zoom,
      humanScreenArea: 32 * 48 * zoom * zoom,
    };
  }, { stageSelector: STAGE_SELECTOR, expectedKind: kind });
}

interface StructureScreenAudit {
  readonly id: string;
  readonly authoredWorldRect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly boundsSource: "graph plot plus manifest authored frame rect";
  readonly viewportTarget: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly viewportSafeFrame: Readonly<{ left: number; top: number; right: number; bottom: number }>;
  readonly fullyInViewport: boolean;
  readonly fullyInCameraSafeFrame: boolean;
  readonly intersections: readonly string[];
  readonly zoom: number;
  readonly cameraMode: "story" | "follow" | "free";
}

async function readStructureScreenAudit(
  page: Page,
  kind: "home" | "ruin",
): Promise<StructureScreenAudit> {
  return page.evaluate(async ({ stageSelector, expectedKind }) => {
    const manifestModule = await import("/src/renderer2d/production/assets/productionManifest.ts");
    const stage = document.querySelector<HTMLElement>(stageSelector);
    const canvas = stage?.querySelector<HTMLCanvasElement>('canvas[aria-label="Vivarium world"]') ?? null;
    const snapshot = stage === null
      ? null
      : window.__vivariumProductionDiagnosticsForTest?.snapshot(stage) as RuntimeStageProbeSnapshot | null | undefined;
    const home = snapshot?.graph.homes.find((candidate) => candidate.kind === expectedKind);
    if (canvas === null || snapshot === null || snapshot === undefined || home === undefined) {
      throw new Error(`runtime ${expectedKind} geometry is unavailable`);
    }
    const kits = manifestModule.PRODUCTION_ASSET_MANIFEST.regions;
    const homeManifest = kits[home.kit as keyof typeof kits].homeManifest;
    const authoredFrames = Object.values(expectedKind === "ruin"
      ? homeManifest.ruinFrames
      : homeManifest.frames);
    const authoredWidth = Math.max(...authoredFrames.map((frame) => frame.rect.width));
    const authoredHeight = Math.max(...authoredFrames.map((frame) => frame.rect.height));
    const target = {
      x: home.plot.x,
      y: home.plot.y,
      width: authoredWidth,
      height: authoredHeight,
    };
    const canvasRect = canvas.getBoundingClientRect();
    const scaleX = canvasRect.width / canvas.width;
    const scaleY = canvasRect.height / canvas.height;
    const camera = snapshot.camera;
    const left = canvasRect.left + ((canvas.width / 2) + ((target.x - camera.center.x) * camera.zoom)) * scaleX;
    const top = canvasRect.top + ((canvas.height / 2) + ((target.y - camera.center.y) * camera.zoom)) * scaleY;
    const right = left + target.width * camera.zoom * scaleX;
    const bottom = top + target.height * camera.zoom * scaleY;
    const safe = camera.safeFrame;
    const viewportSafeFrame = {
      left: canvasRect.left + safe.x * scaleX,
      top: canvasRect.top + safe.y * scaleY,
      right: canvasRect.left + (safe.x + safe.width) * scaleX,
      bottom: canvasRect.top + (safe.y + safe.height) * scaleY,
    };
    const overlaySelectors = [
      ".observer-hud",
      ".living-atlas-2d",
      ".semantic-world-mirror",
      ".dialogue-now",
      ".observer-edge-triggers",
    ];
    const intersections = overlaySelectors.flatMap((selector) => {
      const node = document.querySelector<HTMLElement>(selector);
      if (node === null) return [];
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden") return [];
      return Math.min(right, rect.right) > Math.max(left, rect.left)
        && Math.min(bottom, rect.bottom) > Math.max(top, rect.top)
        ? [selector]
        : [];
    });
    return {
      id: home.id,
      authoredWorldRect: target,
      boundsSource: "graph plot plus manifest authored frame rect" as const,
      viewportTarget: { left, top, right, bottom },
      viewportSafeFrame,
      fullyInViewport: left >= -0.5 && top >= -0.5
        && right <= innerWidth + 0.5 && bottom <= innerHeight + 0.5,
      fullyInCameraSafeFrame: left >= viewportSafeFrame.left - 0.5
        && top >= viewportSafeFrame.top - 0.5
        && right <= viewportSafeFrame.right + 0.5
        && bottom <= viewportSafeFrame.bottom + 0.5,
      intersections,
      zoom: camera.zoom,
      cameraMode: camera.mode,
    };
  }, { stageSelector: STAGE_SELECTOR, expectedKind: kind });
}

async function positionStructureWithPublicControls(
  page: Page,
  kind: "home" | "ruin",
): Promise<StructureScreenAudit> {
  const canvas = page.getByLabel("Vivarium world");
  await canvas.focus();
  await page.keyboard.press("v");
  for (let operation = 0; operation < 320; operation += 1) {
    const audit = await readStructureScreenAudit(page, kind);
    if (audit.fullyInViewport && audit.fullyInCameraSafeFrame
      && audit.intersections.length === 0) {
      return waitForStructureSafeSettle(page, kind);
    }
    const targetWidth = audit.viewportTarget.right - audit.viewportTarget.left;
    const targetHeight = audit.viewportTarget.bottom - audit.viewportTarget.top;
    const safeWidth = audit.viewportSafeFrame.right - audit.viewportSafeFrame.left;
    const safeHeight = audit.viewportSafeFrame.bottom - audit.viewportSafeFrame.top;
    let key: "-" | "ArrowRight" | "ArrowLeft" | "ArrowDown" | "ArrowUp";
    if (targetWidth > safeWidth || targetHeight > safeHeight) key = "-";
    else if (audit.viewportTarget.left < audit.viewportSafeFrame.left) key = "ArrowRight";
    else if (audit.viewportTarget.right > audit.viewportSafeFrame.right) key = "ArrowLeft";
    else if (audit.viewportTarget.top < audit.viewportSafeFrame.top) key = "ArrowDown";
    else if (audit.viewportTarget.bottom > audit.viewportSafeFrame.bottom) key = "ArrowUp";
    else if (audit.intersections.includes(".observer-hud")) key = "ArrowUp";
    else if (audit.intersections.includes(".living-atlas-2d")) key = "ArrowLeft";
    else if (audit.intersections.includes(".semantic-world-mirror")) key = "ArrowRight";
    else key = "ArrowLeft";
    await page.keyboard.press(key);
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
  }
  const finalAudit = await readStructureScreenAudit(page, kind);
  throw new Error(`public Free controls could not safely frame ${kind}: ${JSON.stringify(finalAudit)}`);
}

async function waitForStructureSafeSettle(
  page: Page,
  kind: "home" | "ruin",
): Promise<StructureScreenAudit> {
  let prior = "";
  let stableFrames = 0;
  let last: StructureScreenAudit | null = null;
  for (let frame = 0; frame < 360; frame += 1) {
    await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
    const audit = await readStructureScreenAudit(page, kind);
    last = audit;
    const key = JSON.stringify({
      authoredWorldRect: audit.authoredWorldRect,
      viewportTarget: audit.viewportTarget,
      viewportSafeFrame: audit.viewportSafeFrame,
      zoom: audit.zoom,
      mode: audit.cameraMode,
    });
    const eligible = audit.fullyInViewport && audit.fullyInCameraSafeFrame
      && audit.intersections.length === 0;
    stableFrames = eligible && key === prior ? stableFrames + 1 : eligible ? 1 : 0;
    prior = key;
    if (stableFrames >= 4) return audit;
  }
  throw new Error(`authored ${kind} rect did not settle safely: ${JSON.stringify(last)}`);
}

async function captureDeterministicFrame(
  page: Page,
  file: string,
  identity: Record<string, unknown>,
): Promise<{
  file: string;
  repeatFile: string;
  bytes: number;
  sha256: string;
  repeatSha256: string;
  hashStable: true;
  identity: Record<string, unknown>;
}> {
  const path = resolve(OUTPUT_DIRECTORY, file);
  const repeatPath = resolve(OUTPUT_DIRECTORY, file.replace(/\.png$/, ".repeat.png"));
  const bytes = await page.screenshot({ path });
  await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame())));
  const repeatedBytes = await page.screenshot({ path: repeatPath });
  const firstHash = sha256(bytes);
  const repeatHash = sha256(repeatedBytes);
  expect(repeatHash, `${file} must remain byte-identical across a reduced-motion runtime frame`)
    .toBe(firstHash);
  return {
    file: basename(path),
    repeatFile: basename(repeatPath),
    bytes: bytes.length,
    sha256: firstHash,
    repeatSha256: repeatHash,
    hashStable: true,
    identity,
  };
}

function sourceIdentitySha256(): {
  files: Array<{ path: string; sha256: string }>;
  aggregateSha256: string;
} {
  const files = SOURCE_FILES.map((path) => ({ path, sha256: sha256(readFileSync(resolve(path))) }));
  return { files, aggregateSha256: sha256(Buffer.from(JSON.stringify(files))) };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
