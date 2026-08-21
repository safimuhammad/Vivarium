import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

test.skip(process.env.VIVARIUM_CAPTURE_2D_SLICE !== "1", "2D slice capture is opt-in.");
test.setTimeout(180_000);

const ROOT = process.cwd();
const EVIDENCE_DIRECTORY = path.resolve(ROOT, "scratchpad/2d-slice-task10-captures");
const MANIFEST_PATH = path.resolve(ROOT, "frontend/dist/.vite/manifest.json");
const MAX_CORE_ART_BYTES = 768 * 1024;
const MAX_ACTIVE_ART_BYTES = Math.floor(1.25 * 1024 * 1024);
const EXPECTED_DECODED_BYTES = 3_440_640;

const ASSETS = [
  { id: "human-body", file: "human-body-atlas.png", width: 672, height: 512, category: "core" },
  { id: "human-face", file: "human-face-atlas.png", width: 384, height: 256, category: "core" },
  { id: "human-held", file: "human-held-atlas.png", width: 384, height: 64, category: "core" },
  { id: "shelter", file: "shelter-slice-atlas.png", width: 640, height: 512, category: "core" },
  { id: "nirvana-tiles", file: "nirvana-tile-atlas.png", width: 256, height: 256, category: "region" },
] as const;

type SceneName = "walk" | "dialogue" | "shelter-build" | "shelter-collapse" | "full-loop";
type ManifestRecord = {
  file: string;
  src?: string;
  imports?: string[];
  dynamicImports?: string[];
  isEntry?: boolean;
  isDynamicEntry?: boolean;
};
type PerformanceEntryEvidence = { name: string; entryType: string; startTime: number; duration: number };
type TaskTiming = { label: string; duration: number };
type BrowserPerformanceEvidence = {
  observerSupported: boolean;
  unsupportedReason: string | null;
  longTasks: PerformanceEntryEvidence[];
  fallbackTasks: TaskTiming[];
};

declare global {
  interface Window {
    __vivariumTask10Performance?: BrowserPerformanceEvidence & { observer?: PerformanceObserver };
  }
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  const signature = buffer.subarray(0, 8).toString("hex");
  if (signature !== "89504e470d0a1a0a" || buffer.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error("Expected a PNG with an IHDR header.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function assetEvidence(manifest: Record<string, ManifestRecord>): Promise<Array<Record<string, unknown>>> {
  return Promise.all(ASSETS.map(async (asset) => {
    const sourcePath = `src/assets/renderer2d/${asset.file}`;
    const diskPath = path.resolve(ROOT, "frontend", sourcePath);
    const [buffer, metadata] = await Promise.all([readFile(diskPath), stat(diskPath)]);
    const dimensions = pngDimensions(buffer);
    expect(dimensions, asset.file).toEqual({ width: asset.width, height: asset.height });
    const manifestEntry = Object.entries(manifest).find(([key, record]) => (
      key === sourcePath || record.src === sourcePath
    ));
    return {
      id: asset.id,
      sourcePath,
      category: asset.category,
      statSize: metadata.size,
      sha256: sha256(buffer),
      width: dimensions.width,
      height: dimensions.height,
      decodedBytes: dimensions.width * dimensions.height * 4,
      delivery: manifestEntry ? "emitted-asset" : "inlined-data-url",
      manifest: manifestEntry ? { key: manifestEntry[0], ...manifestEntry[1] } : null,
    };
  }));
}

function staticClosure(
  manifest: Record<string, ManifestRecord>,
  rootKey: string,
): Array<{ key: string } & ManifestRecord> {
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    const record = manifest[key];
    if (!record) throw new Error(`Manifest static import ${key} has no record.`);
    seen.add(key);
    for (const imported of record.imports ?? []) visit(imported);
  };
  visit(rootKey);
  return [...seen].map((key) => ({ key, ...manifest[key]! }));
}

async function manifestEvidence(manifest: Record<string, ManifestRecord>): Promise<Record<string, unknown>> {
  const canvasEntry = Object.entries(manifest).find(([key, record]) => (
    key === "src/renderer2d/CanvasWorldStage.tsx" || record.src === "src/renderer2d/CanvasWorldStage.tsx"
  ));
  const startupEntry = Object.entries(manifest).find(([, record]) => record.isEntry === true);
  expect(canvasEntry, "CanvasWorldStage manifest entry").toBeDefined();
  expect(startupEntry, "startup manifest entry").toBeDefined();
  const canvasClosure = staticClosure(manifest, canvasEntry![0]);
  const startupClosure = staticClosure(manifest, startupEntry![0]);
  const startupKeys = new Set(startupClosure.map(({ key }) => key));
  const incremental = canvasClosure.filter(({ key }, index) => index === 0 || !startupKeys.has(key));
  const closureBytes = async (closure: Array<{ file: string }>): Promise<number> => (
    (await Promise.all(closure.map(({ file }) => stat(path.resolve(ROOT, "frontend/dist", file)))))
      .reduce((total, item) => total + item.size, 0)
  );
  const forbidden = canvasClosure.filter(({ key, src = "", file }) => (
    /WorldRenderer|(?:^|[/_.-])three(?:[/_.-]|$)|src\/renderer\//i.test(`${key} ${src} ${file}`)
  ));
  expect(forbidden).toEqual([]);
  expect(startupKeys.has(canvasEntry![0]), "Canvas entry must not be a startup static import").toBe(false);
  return {
    canvasEntry: canvasEntry![0],
    startupEntry: startupEntry![0],
    canvasStaticClosure: canvasClosure,
    startupStaticClosure: startupClosure,
    incrementalCanvasClosure: incremental,
    fullBytes: await closureBytes(canvasClosure),
    incrementalBytes: await closureBytes(incremental),
    forbidden3DRecords: forbidden,
    canvasReachableFromStartupStaticImports: startupKeys.has(canvasEntry![0]),
  };
}

async function installPerformanceObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const supported = PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
    const evidence: BrowserPerformanceEvidence & { observer?: PerformanceObserver } = {
      observerSupported: supported,
      unsupportedReason: supported ? null : "PerformanceObserver longtask entry type is unavailable",
      longTasks: [],
      fallbackTasks: [],
    };
    window.__vivariumTask10Performance = evidence;
    if (!supported) return;
    try {
      evidence.observer = new PerformanceObserver((list) => {
        evidence.longTasks.push(...list.getEntries().map((entry) => ({
          name: entry.name,
          entryType: entry.entryType,
          startTime: entry.startTime,
          duration: entry.duration,
        })));
      });
      evidence.observer.observe({ type: "longtask", buffered: true });
    } catch (error) {
      evidence.observerSupported = false;
      evidence.unsupportedReason = error instanceof Error ? error.message : String(error);
    }
  });
}

async function boot(page: Page, scene: SceneName, viewport: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(viewport);
  await page.goto(`/?renderer=2d-slice&scene=${scene}`);
  await page.waitForFunction(() => window.__vivarium2DSlice?.isReady() === true);
  await page.evaluate(() => window.__vivarium2DSlice!.pause());
}

async function setSceneTime(page: Page, scene: SceneName, timeMs: number, advance = false): Promise<void> {
  await page.evaluate(({ nextScene, nextTime, useAdvance }) => {
    const debug = window.__vivarium2DSlice!;
    debug.setScene(nextScene);
    if (useAdvance) debug.advanceBy(nextTime);
    else debug.seek(nextTime);
  }, { nextScene: scene, nextTime: timeMs, useAdvance: advance });
  await page.waitForTimeout(0);
}

async function nativePng(page: Page, scale: 1 | 2): Promise<Buffer> {
  const encoded = await page.evaluate(async (requestedScale) => {
    const image = window.__vivarium2DSlice!.captureLogicalImageData();
    if (image.width !== 512 || image.height !== 288) {
      throw new Error(`Native capture requires 512x288 pixels; received ${image.width}x${image.height}.`);
    }
    const logical = document.createElement("canvas");
    logical.width = image.width;
    logical.height = image.height;
    const logicalContext = logical.getContext("2d")!;
    logicalContext.imageSmoothingEnabled = false;
    logicalContext.putImageData(image, 0, 0);
    const output = document.createElement("canvas");
    output.width = image.width * requestedScale;
    output.height = image.height * requestedScale;
    const outputContext = output.getContext("2d")!;
    outputContext.imageSmoothingEnabled = false;
    outputContext.drawImage(logical, 0, 0, output.width, output.height);
    const blob = await new Promise<Blob>((resolve, reject) => output.toBlob((value) => (
      value ? resolve(value) : reject(new Error("canvas.toBlob returned null"))
    ), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32_768) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
    }
    return btoa(binary);
  }, scale);
  return Buffer.from(encoded, "base64");
}

async function stateEvidence(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const debug = window.__vivarium2DSlice!;
    const canvas = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    const bounds = canvas.getBoundingClientRect();
    return {
      actor: debug.actorState("agent_aster"),
      camera: debug.cameraState(),
      shelter: debug.shelterState("shelter-east"),
      dialogue: {
        speaker: document.querySelector(".slice2d__dialogue strong")?.textContent?.trim() ?? null,
        text: document.querySelector(".slice2d__dialogue-text")?.textContent?.trim() ?? null,
      },
      diagnostics: debug.renderDiagnostics(),
      presentation: {
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
        canvasRect: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      },
    };
  });
}

function expectRecordedFaceDirection(state: Record<string, unknown>): void {
  const actor = state.actor as {
    layers?: { body?: { clipId?: string }; face?: { clipId?: string; sourceRect?: { y?: number } } };
  } | null;
  expect(actor).not.toBeNull();
  const bodyDirection = actor?.layers?.body?.clipId?.match(/_(south|west|north|east)$/)?.[1] ?? "south";
  const rows = { south: 0, west: 1, north: 2, east: 3 } as const;
  expect(actor?.layers?.face?.clipId).toMatch(new RegExp(`_${bodyDirection}$`));
  expect(actor?.layers?.face?.sourceRect?.y).toBe(rows[bodyDirection as keyof typeof rows] * 64);
}

async function visualCompositionEvidence(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(async () => {
    const { deriveDemoRegionMap } = await import("/src/renderer2d/map/regionMap.ts");
    const map = deriveDemoRegionMap(7_113);
    const pathTiles = new Set(map.ground.filter(({ terrain }) => terrain === "pale-path")
      .map(({ tile }) => `${tile.column},${tile.row}`));
    const scenery = map.props.filter(({ kind }) => kind !== "pond");
    const edgeScenery = scenery.filter(({ tile }) => (
      tile.column <= 2 || tile.column >= 13 || tile.row <= 1 || tile.row >= 7
    ));
    const occupiedTiles = map.props.map(({ tile }) => `${tile.column},${tile.row}`);
    const image = window.__vivarium2DSlice!.captureLogicalImageData();
    let nearBlackPixels = 0;
    const colors = new Set<string>();
    for (let index = 0; index < image.data.length; index += 4) {
      const red = image.data[index]!;
      const green = image.data[index + 1]!;
      const blue = image.data[index + 2]!;
      if (red <= 8 && green <= 8 && blue <= 8) nearBlackPixels += 1;
      colors.add(`${red},${green},${blue},${image.data[index + 3]!}`);
    }
    return {
      sceneryCount: scenery.length,
      distinctSceneryKinds: new Set(scenery.map(({ kind }) => kind)).size,
      edgeSceneryCount: edgeScenery.length,
      uniquePropIds: new Set(map.props.map(({ id }) => id)).size,
      uniquePropTiles: new Set(occupiedTiles).size,
      pathOverlap: occupiedTiles.filter((tile) => pathTiles.has(tile)),
      nearBlackPixelRatio: nearBlackPixels / (image.width * image.height),
      distinctRgbaColors: colors.size,
    };
  });
}

async function performanceFixture(page: Page): Promise<Record<string, unknown>> {
  await boot(page, "walk", { width: 1440, height: 900 });
  const cycle = await page.evaluate(() => {
    const debug = window.__vivarium2DSlice!;
    const performanceEvidence = window.__vivariumTask10Performance!;
    performanceEvidence.longTasks.length = 0;
    performanceEvidence.fallbackTasks.length = 0;
    const measure = (label: string, operation: () => void): void => {
      const startedAt = performance.now();
      operation();
      performanceEvidence.fallbackTasks.push({ label, duration: performance.now() - startedAt });
    };

    debug.resume();
    debug.setScene("walk");
    measure("walk:seek", () => debug.seek(800));
    const staticBeforeMovement = debug.renderDiagnostics().staticLayerRebuilds;
    for (let index = 0; index < 32; index += 1) {
      measure(`walk:${index}`, () => debug.advanceBy(50));
    }
    const staticAfterMovement = debug.renderDiagnostics().staticLayerRebuilds;

    debug.setScene("shelter-build");
    measure("build:approach", () => debug.seek(5_900));
    for (let index = 0; index < 36; index += 1) {
      measure(`build:${index}`, () => debug.advanceBy(100));
    }
    debug.setScene("shelter-collapse");
    for (let index = 0; index < 32; index += 1) {
      measure(`collapse:${index}`, () => debug.advanceBy(100));
    }
    debug.setScene("full-loop");
    for (let index = 0; index < 120; index += 1) {
      measure(`full-loop:${index}`, () => debug.advanceBy(100));
    }

    const canvas = document.querySelector<HTMLCanvasElement>(".slice2d__canvas")!;
    canvas.focus();
    for (const key of ["v", "ArrowRight", "+", "ArrowDown", "-", "ArrowLeft", "s"] as const) {
      measure(`camera:${key}`, () => {
        canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        debug.advanceBy(0);
      });
    }
    debug.setScene("full-loop");
    measure("idle:terminal-seek", () => debug.seek(16_000));
    measure("idle:resume", () => debug.resume());
    return {
      staticBeforeMovement,
      staticAfterMovement,
    };
  });
  await page.waitForFunction(() => {
    const debug = window.__vivarium2DSlice!;
    const diagnostics = debug.renderDiagnostics();
    return debug.shelterState("shelter-east")?.phase === "ruin"
      && diagnostics.scheduledFrame === false
      && diagnostics.cadence === "idle";
  });
  await page.waitForTimeout(100);
  const terminal = await page.evaluate(() => {
    const { observer: _observer, ...evidence } = window.__vivariumTask10Performance!;
    const debug = window.__vivarium2DSlice!;
    return {
      performanceEvidence: evidence,
      idle: debug.renderDiagnostics(),
      actor: debug.actorState("agent_aster"),
      camera: debug.cameraState(),
      shelter: debug.shelterState("shelter-east"),
    };
  });
  const performanceEvidence = terminal.performanceEvidence;
  const diagnostics = terminal.idle;
  const maxDraw = Math.max(0, ...diagnostics.drawDurationsMs);
  const maxTask = Math.max(0, ...performanceEvidence.fallbackTasks.map(({ duration }) => duration));
  const maxLongTask = Math.max(0, ...performanceEvidence.longTasks.map(({ duration }) => duration));

  expect(cycle.staticAfterMovement).toBe(cycle.staticBeforeMovement);
  expect(diagnostics.frameCount).toBeGreaterThanOrEqual(230);
  expect(diagnostics.frameCount).toBeLessThanOrEqual(240);
  expect(diagnostics.drawDurationsMs).toHaveLength(diagnostics.frameCount);
  expect(diagnostics.drawP95Ms).toBeLessThanOrEqual(4);
  expect(maxDraw).toBeLessThanOrEqual(50);
  expect(maxTask).toBeLessThanOrEqual(50);
  expect(maxLongTask).toBeLessThanOrEqual(50);
  expect(diagnostics.scheduledFrame).toBe(false);
  expect(diagnostics.cadence).toBe("idle");
  expect(terminal.shelter?.phase).toBe("ruin");
  if (!performanceEvidence.observerSupported) {
    expect(performanceEvidence.unsupportedReason).not.toBeNull();
    expect(performanceEvidence.fallbackTasks.length).toBeGreaterThan(0);
  }
  return {
    ...performanceEvidence,
    drawDurationsMs: diagnostics.drawDurationsMs,
    frameCount: diagnostics.frameCount,
    drawP95Ms: diagnostics.drawP95Ms,
    maxDrawMs: maxDraw,
    maxFallbackTaskMs: maxTask,
    maxLongTaskMs: maxLongTask,
    staticLayerRebuilds: { beforeActorMovement: cycle.staticBeforeMovement, afterActorMovement: cycle.staticAfterMovement },
    terminalIdle: { scheduledFrame: diagnostics.scheduledFrame, cadence: diagnostics.cadence },
  };
}

test("writes deterministic native, responsive, lifecycle, and performance evidence", async ({ page }) => {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Record<string, ManifestRecord>;
  const assets = await assetEvidence(manifest);
  const compressedBytes = assets.reduce((total, asset) => total + Number(asset.statSize), 0);
  const coreBytes = assets.filter((asset) => asset.category === "core")
    .reduce((total, asset) => total + Number(asset.statSize), 0);
  const decodedBytes = assets.reduce((total, asset) => total + Number(asset.decodedBytes), 0);
  expect(coreBytes).toBeLessThanOrEqual(MAX_CORE_ART_BYTES);
  expect(compressedBytes).toBeLessThanOrEqual(MAX_ACTIVE_ART_BYTES);
  expect(decodedBytes).toBe(EXPECTED_DECODED_BYTES);

  const productionManifest = await manifestEvidence(manifest);
  expect(Number(productionManifest.incrementalBytes)).toBeLessThanOrEqual(120 * 1024);
  await installPerformanceObserver(page);

  const responseUrls: string[] = [];
  page.on("response", (response) => responseUrls.push(response.url()));
  const performance = await performanceFixture(page);
  const captures: Array<{
    base: string;
    buffer: Buffer;
    format: "png" | "jpeg";
    scene: SceneName;
    timeMs: number;
    scaleMode: string;
    state: Record<string, unknown>;
  }> = [];

  await boot(page, "full-loop", { width: 1440, height: 900 });
  await setSceneTime(page, "full-loop", 10_500);
  const nativeState = await stateEvidence(page);
  expectRecordedFaceDirection(nativeState);
  const visualComposition = await visualCompositionEvidence(page);
  const native = await nativePng(page, 1);
  expect(await nativePng(page, 1), "native capture must be deterministic within one state").toEqual(native);
  captures.push({ base: "vivarium-2d-slice-native", buffer: native, format: "png", scene: "full-loop", timeMs: 10_500, scaleMode: "logical-native-1x", state: nativeState });
  captures.push({ base: "vivarium-2d-slice-2x", buffer: await nativePng(page, 2), format: "png", scene: "full-loop", timeMs: 10_500, scaleMode: "logical-nearest-neighbor-2x", state: nativeState });

  captures.push({
    base: "vivarium-2d-slice-desktop",
    buffer: await page.screenshot({ type: "jpeg", quality: 92 }),
    format: "jpeg",
    scene: "full-loop",
    timeMs: 10_500,
    scaleMode: "desktop-page-presentation",
    state: await stateEvidence(page),
  });

  await boot(page, "full-loop", { width: 390, height: 844 });
  await setSceneTime(page, "full-loop", 10_500);
  captures.push({
    base: "vivarium-2d-slice-mobile",
    buffer: await page.screenshot({ type: "jpeg", quality: 92 }),
    format: "jpeg",
    scene: "full-loop",
    timeMs: 10_500,
    scaleMode: "mobile-page-crop",
    state: await stateEvidence(page),
  });

  for (const scenario of [
    { base: "vivarium-2d-slice-dialogue", scene: "dialogue" as const, timeMs: 1_200, advance: true, presentation: "page" as const },
    { base: "vivarium-2d-slice-standing", scene: "shelter-build" as const, timeMs: 9_400, advance: false, presentation: "native" as const },
    { base: "vivarium-2d-slice-collapse", scene: "shelter-collapse" as const, timeMs: 2_000, advance: false, presentation: "native" as const },
    { base: "vivarium-2d-slice-ruin", scene: "shelter-collapse" as const, timeMs: 3_250, advance: false, presentation: "native" as const },
  ]) {
    await boot(page, scenario.scene, { width: 1440, height: 900 });
    await setSceneTime(page, scenario.scene, scenario.timeMs, scenario.advance);
    const state = await stateEvidence(page);
    expectRecordedFaceDirection(state);
    const shelter = state.shelter as { phase?: string; collapseCommitCount?: number; visual?: { ruin?: { composition?: string[] } } } | null;
    const dialogue = state.dialogue as { text?: string | null };
    if (scenario.scene === "dialogue") {
      expect(dialogue.text).toBe("The path remembers every footstep.");
    } else if (scenario.base.endsWith("standing")) {
      expect(shelter?.phase).toBe("standing");
    } else if (scenario.base.endsWith("collapse")) {
      expect(shelter?.phase).toBe("collapsing");
      expect(shelter?.collapseCommitCount).toBe(0);
    } else {
      expect(shelter?.phase).toBe("ruin");
      expect(shelter?.collapseCommitCount).toBe(1);
      expect(shelter?.visual?.ruin?.composition).toContain("rubble-full");
    }
    captures.push({
      base: scenario.base,
      buffer: scenario.presentation === "page"
        ? await page.screenshot({ type: "png" })
        : await nativePng(page, 1),
      format: "png",
      scene: scenario.scene,
      timeMs: scenario.timeMs,
      scaleMode: scenario.presentation === "page" ? "desktop-page-dialogue" : "logical-native-1x",
      state,
    });
  }

  const uniqueResponses = [...new Set(responseUrls)].sort();
  const forbiddenResponses = uniqueResponses.filter((url) => (
    /\/src\/renderer\/|\/src\/app\/LivingAtlasApp|node_modules\/@?three|\/three\//i.test(url)
  ));
  expect(forbiddenResponses).toEqual([]);
  const runtimeAssetResponses = uniqueResponses.filter((url) => /renderer2d|(?:human|shelter|nirvana).*-atlas/i.test(url));
  const commonEvidence = {
    assets: {
      exact: assets,
      coreCompressedBytes: coreBytes,
      activeCompressedBytes: compressedBytes,
      decodedRgbaBytes: decodedBytes,
      limits: {
        coreCompressedBytes: MAX_CORE_ART_BYTES,
        activeCompressedBytes: MAX_ACTIVE_ART_BYTES,
        lockedDecodedRgbaBytes: EXPECTED_DECODED_BYTES,
      },
    },
    performance,
    manifest: productionManifest,
    network: { responseUrls: uniqueResponses, runtimeAssetResponses, forbidden3DResponses: forbiddenResponses },
  };

  const runtimeDiagnostics = (captures[0]!.state.diagnostics ?? {}) as Record<string, unknown>;
  expect(visualComposition).toMatchObject({
    sceneryCount: 37,
    distinctSceneryKinds: 15,
    edgeSceneryCount: 32,
    uniquePropIds: 45,
    uniquePropTiles: 45,
    pathOverlap: [],
  });
  expect(Number(visualComposition.nearBlackPixelRatio)).toBeLessThan(0.1);
  // The fixed full-loop frame faces north, whose face plane is intentionally transparent.
  // Source-art tests own the complete palette; this screen-level floor guards terrain and
  // shelter richness without reintroducing colors from the rejected always-front face.
  expect(Number(visualComposition.distinctRgbaColors)).toBeGreaterThan(40);
  expect(runtimeDiagnostics.assetBytesLoaded).toBe(compressedBytes);
  expect(runtimeDiagnostics.decodedAssetBytes).toBe(decodedBytes);
  expect(runtimeDiagnostics.smoothingEnabled).toBe(false);
  expect(runtimeDiagnostics.integerDrawRects).toBe(true);
  expect((runtimeDiagnostics.logicalViewport as { width: number; height: number })).toMatchObject({ width: 512, height: 288 });

  for (const capture of captures) {
    const extension = capture.format === "jpeg" ? "jpeg" : "png";
    const imagePath = path.join(EVIDENCE_DIRECTORY, `${capture.base}.${extension}`);
    const sidecarPath = path.join(EVIDENCE_DIRECTORY, `${capture.base}.json`);
    await writeFile(imagePath, capture.buffer);
    await writeFile(sidecarPath, `${JSON.stringify({
      schemaVersion: 1,
      image: { file: path.basename(imagePath), format: capture.format, bytes: capture.buffer.length, sha256: sha256(capture.buffer) },
      scene: capture.scene,
      timeMs: capture.timeMs,
      scaleMode: capture.scaleMode,
      state: capture.state,
      ...commonEvidence,
      visualComposition,
    }, null, 2)}\n`);
  }

  expect(captures).toHaveLength(8);
  expect(captures.map(({ base }) => base)).toEqual([
    "vivarium-2d-slice-native",
    "vivarium-2d-slice-2x",
    "vivarium-2d-slice-desktop",
    "vivarium-2d-slice-mobile",
    "vivarium-2d-slice-dialogue",
    "vivarium-2d-slice-standing",
    "vivarium-2d-slice-collapse",
    "vivarium-2d-slice-ruin",
  ]);
});
