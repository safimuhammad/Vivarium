import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProductionStageAnalysis } from "./build-production-stage-analysis.mjs";

const frontendRoot = fileURLToPath(new URL("..", import.meta.url));
const distDir = join(frontendRoot, "dist");
const sourceRoot = join(frontendRoot, "src");
const canvasSource = "src/renderer2d/CanvasWorldStage.tsx";
const productionStageSource = "src/renderer2d/production/PresentationWorldStage.tsx";
const maxInitialJsBytes = 350 * 1024;
const maxAnyJsBytes = 900 * 1024;
const maxCanvasSliceBytes = 120 * 1024;
const maxProductionCanvasBytes = 120 * 1024;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function manifestEntryKeyBySource(manifest, source) {
  const entries = Object.entries(manifest).filter(([key, record]) => (
    key === source || record.src === source
  ));
  if (entries.length !== 1) {
    throw new Error(`Missing unique Vite manifest record for ${source}; found ${entries.length}.`);
  }
  return entries[0][0];
}

function startupEntryKey(manifest) {
  const exact = Object.entries(manifest).filter(([key, record]) => (
    (key === "index.html" || record.src === "index.html") && record.isEntry === true
  ));
  if (exact.length !== 1) {
    throw new Error(`Expected one index.html startup entry in Vite manifest; found ${exact.length}.`);
  }
  return exact[0][0];
}

/** Traverse a manifest root through static imports and optionally dynamic imports. */
export function manifestClosure(manifest, rootKey, { includeDynamic }) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const record = manifest[key];
    if (!record) throw new Error(`Manifest import ${key} has no record.`);
    seen.add(key);
    for (const imported of record.imports ?? []) visit(imported);
    if (includeDynamic) {
      for (const imported of record.dynamicImports ?? []) visit(imported);
    }
  };
  visit(rootKey);
  return [...seen].map((key) => ({ key, ...manifest[key] }));
}

function manifestExecutionClosure(manifest, rootKey, startupKeys) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    const record = manifest[key];
    if (!record) throw new Error(`Manifest import ${key} has no record.`);
    seen.add(key);
    for (const imported of record.imports ?? []) visit(imported);
    if (!startupKeys.has(key) || key === rootKey) {
      for (const imported of record.dynamicImports ?? []) visit(imported);
    }
  };
  visit(rootKey);
  return [...seen].map((key) => ({ key, ...manifest[key] }));
}

function closureFiles(closure) {
  return [...new Set(closure.map(({ file }) => file))].sort();
}

function filesByteSize(files, sizeByFile) {
  return files.reduce((total, file) => {
    const size = sizeByFile.get(file);
    if (size === undefined) throw new Error(`Manifest closure file ${file} is not a built JavaScript asset.`);
    return total + size;
  }, 0);
}

const FORBIDDEN_3D = /WorldRenderer|LivingAtlasApp|ThreeObserverAdapter|CanvasWorldRenderer|CanvasWorldStage|demoScene|(?:^|[/_.-])three(?:[/_.-]|$)|src\/renderer\//i;
const FORBIDDEN_FROZEN = /WorldRenderer|LivingAtlasApp|ThreeObserverAdapter|CanvasWorldRenderer|demoScene|(?:^|[/_.-])three(?:[/_.-]|$)|src\/renderer\//i;
const FORBIDDEN_CHARACTER_PILOT =
  /characterPilot|character-pilot|qa[/\\]characterPilot/i;

/**
 * Reject the isolated character pilot from a production manifest and output tree.
 *
 * @param {Record<string, unknown>} manifest - Fresh Vite production manifest.
 * @param {readonly string[]} outputFiles - Files relative to the production dist root.
 * @returns {void}
 */
export function assertProductionBuildExcludesCharacterPilot(manifest, outputFiles) {
  const manifestViolation = Object.entries(manifest).find(([key, record]) => (
    FORBIDDEN_CHARACTER_PILOT.test(`${key} ${JSON.stringify(record)}`)
  ));
  assert(
    manifestViolation === undefined,
    `Production manifest includes isolated character pilot output: ${manifestViolation?.[0] ?? "unknown"}.`,
  );
  const outputViolation = outputFiles.find((file) => (
    FORBIDDEN_CHARACTER_PILOT.test(file)
  ));
  assert(
    outputViolation === undefined,
    `Production output includes isolated character pilot file: ${outputViolation ?? "unknown"}.`,
  );
}

/** Analyze the exact built production Stage closure against startup and no-Three gates. */
export function analyzeProductionStageClosure({
  manifest,
  sizeByFile,
  stageSource,
  startupKey,
  maxIncrementalBytes,
}) {
  const stageKey = manifestEntryKeyBySource(manifest, stageSource);
  const staticStage = manifestClosure(manifest, stageKey, { includeDynamic: false });
  const startup = manifestClosure(manifest, startupKey, { includeDynamic: false });
  const reachableStage = manifestExecutionClosure(
    manifest,
    stageKey,
    new Set(startup.map(({ key }) => key)),
  );
  assert(
    !startup.some(({ key }) => key === stageKey),
    "Production PresentationWorldStage must not be reachable from startup static imports.",
  );
  const violation = reachableStage.find(({ key, src = "", file }) => (
    FORBIDDEN_3D.test(`${key} ${src} ${file}`)
  ));
  assert(
    violation === undefined,
    `Production 2D manifest closure imports 3D/demo code: ${violation?.key ?? "unknown"}`,
  );
  const fullFiles = closureFiles(staticStage);
  const startupFiles = new Set(closureFiles(startup));
  const rootFile = manifest[stageKey].file;
  const incrementalFiles = fullFiles.filter((file) => file === rootFile || !startupFiles.has(file));
  const fullBytes = filesByteSize(fullFiles, sizeByFile);
  const incrementalBytes = filesByteSize(incrementalFiles, sizeByFile);
  const cssFiles = [...new Set(staticStage.flatMap(({ css = [] }) => css))].sort();
  const artFiles = [...new Set(staticStage.flatMap(({ assets = [] }) => assets))].sort();
  const cssBytes = filesByteSize(cssFiles, sizeByFile);
  const artBytes = filesByteSize(artFiles, sizeByFile);
  assert(
    incrementalBytes <= maxIncrementalBytes,
    `Incremental production Canvas closure exceeds ${maxIncrementalBytes}: ${incrementalBytes}`,
  );
  return Object.freeze({
    stageKey,
    fullBytes,
    incrementalBytes,
    cssBytes,
    artBytes,
    fullFiles: Object.freeze(fullFiles),
    incrementalFiles: Object.freeze(incrementalFiles),
  });
}

function resolveStaticModule(importer, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(importer), specifier);
  const candidates = extname(base)
    ? [base]
    : [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function runtimeSpecifiers(source, { includeDynamic }) {
  const values = [];
  const staticPatterns = [
    /(?:^|\n)\s*import\s+(?!type\b)(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s+(?!type\b)[^"']*?\s+from\s+["']([^"']+)["']/g,
  ];
  for (const pattern of staticPatterns) {
    for (const match of source.matchAll(pattern)) values.push(match[1]);
  }
  if (includeDynamic) {
    for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) values.push(match[1]);
  }
  return values;
}

/** Traverse relative runtime imports from an exact source root. */
export function sourceModuleClosure(root, { includeDynamic }) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !/\.(?:[cm]?[jt]sx?|css)$/.test(file)) return;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    for (const specifier of runtimeSpecifiers(source, { includeDynamic })) {
      const resolved = resolveStaticModule(file, specifier);
      if (resolved) visit(resolved);
    }
  };
  visit(root);
  return [...seen].sort();
}

/** Backward-compatible static-only source traversal. */
export function sourceStaticClosure(root) {
  return sourceModuleClosure(root, { includeDynamic: false });
}

export function assertSourceGraphExcludes3D(root, forbiddenRendererDirectory) {
  const closure = sourceModuleClosure(root, { includeDynamic: true });
  const forbiddenPrefix = `${resolve(forbiddenRendererDirectory)}/`;
  assert(
    !closure.some((file) => resolve(file).startsWith(forbiddenPrefix)),
    "Production 2D source graph imports the 3D renderer.",
  );
  assert(
    !closure.some((file) => /[/\\]app[/\\]LivingAtlasApp\.[cm]?[jt]sx?$/.test(file)),
    "Production 2D source graph imports LivingAtlasApp.",
  );
  for (const file of closure) {
    const source = readFileSync(file, "utf8");
    assert(
      !/(?:from\s+|import\s*(?:\(\s*)?)["']three(?:\/[^"']*)?["']/.test(source),
      `Production 2D source graph imports Three in ${file}.`,
    );
  }
  return closure;
}

/** Reject legacy 3D, demo, and frozen-slice modules from the production Stage graph. */
export function assertProductionSourceGraphExcludes3D(root, forbiddenRendererDirectory) {
  const closure = assertSourceGraphExcludes3D(root, forbiddenRendererDirectory);
  const forbidden = /CanvasWorldStage|CanvasWorldRenderer|demoScene|DEMO_|(?:^|[/\\])actors[/\\]HumanActor|(?:^|[/\\])homes[/\\]ShelterActor|(?:^|[/\\])assets[/\\](?:atlasStore|demoManifest|tileManifest|shelterManifest)|human-body-atlas|human-face-atlas|human-held-atlas|shelter-slice-atlas|nirvana-tile-atlas/i;
  for (const file of closure) {
    const source = readFileSync(file, "utf8");
    assert(
      !FORBIDDEN_CHARACTER_PILOT.test(`${file} ${source}`),
      `Production 2D source graph imports the isolated character pilot in ${file}.`,
    );
    assert(
      !forbidden.test(`${file} ${source}`),
      `Production 2D source graph imports frozen/demo code in ${file}.`,
    );
  }
  return closure;
}

async function readBuildGraph(root) {
  const manifest = JSON.parse(await readFile(join(root, ".vite", "manifest.json"), "utf8"));
  const assetsDir = join(root, "assets");
  const entries = await readdir(assetsDir);
  const builtSizes = await Promise.all(entries.map(async (entry) => ({
    entry,
    size: (await stat(join(assetsDir, entry))).size,
  })));
  const sizes = builtSizes.filter(({ entry }) => entry.endsWith(".js"));
  if (sizes.length === 0) throw new Error("No built JavaScript assets found. Run vite build first.");
  return {
    manifest,
    outputFiles: await listBuildFiles(root),
    sizes,
    sizeByFile: new Map(builtSizes.map(({ entry, size }) => [`assets/${entry}`, size])),
  };
}

async function listBuildFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listBuildFiles(root, path));
    } else if (entry.isFile()) {
      files.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return files.sort();
}

function requiredManifestChunk(manifest, sizeByFile, source, label) {
  const key = manifestEntryKeyBySource(manifest, source);
  const record = manifest[key];
  assert(record.isDynamicEntry === true, `${label} must remain an async chunk.`);
  const size = sizeByFile.get(record.file);
  if (size === undefined) throw new Error(`${label} manifest file ${record.file} is missing.`);
  return { entry: basename(record.file), size };
}

async function runBudgetCheck() {
  const main = await readBuildGraph(distDir);
  assertProductionBuildExcludesCharacterPilot(main.manifest, main.outputFiles);
  const startupKey = startupEntryKey(main.manifest);
  const startupRecord = main.manifest[startupKey];
  const initialSize = main.sizeByFile.get(startupRecord.file);
  if (initialSize === undefined) throw new Error(`Startup manifest file ${startupRecord.file} is missing.`);
  const initial = { entry: basename(startupRecord.file), size: initialSize };
  const renderer = requiredManifestChunk(main.manifest, main.sizeByFile, "src/renderer/WorldRenderer.ts", "WorldRenderer");
  const eventDemo = requiredManifestChunk(main.manifest, main.sizeByFile, "src/app/eventDemoSource.ts", "eventDemoSource");
  const worldPresence = requiredManifestChunk(main.manifest, main.sizeByFile, "src/app/livingAtlas/WorldPresencePanel.tsx", "WorldPresencePanel");
  const oversized = main.sizes.filter(({ size }) => size > maxAnyJsBytes);
  assert(oversized.length === 0, `JavaScript chunk exceeds ${maxAnyJsBytes} bytes: ${oversized.map(({ entry, size }) => `${entry}=${size}`).join(", ")}`);
  assert(initial.size <= maxInitialJsBytes, `Initial app chunk exceeds ${maxInitialJsBytes} bytes: ${initial.entry}=${initial.size}`);
  const indexHtml = await readFile(join(distDir, "index.html"), "utf8");
  for (const chunk of [renderer, eventDemo, worldPresence]) {
    assert(!indexHtml.includes(chunk.entry), `${chunk.entry} must not be a startup modulepreload dependency.`);
  }

  const canvasKey = manifestEntryKeyBySource(main.manifest, canvasSource);
  const canvasClosure = manifestClosure(main.manifest, canvasKey, { includeDynamic: false });
  const startupClosure = manifestClosure(main.manifest, startupKey, { includeDynamic: false });
  const canvasFiles = closureFiles(canvasClosure);
  const startupFiles = new Set(closureFiles(startupClosure));
  const canvasRootFile = main.manifest[canvasKey].file;
  const incrementalCanvasFiles = canvasFiles.filter((file) => file === canvasRootFile || !startupFiles.has(file));
  const canvasFullBytes = filesByteSize(canvasFiles, main.sizeByFile);
  const canvasIncrementalBytes = filesByteSize(incrementalCanvasFiles, main.sizeByFile);
  assert(!startupClosure.some(({ key }) => key === canvasKey), "CanvasWorldStage must not be reachable from startup static imports.");
  assert(canvasIncrementalBytes <= maxCanvasSliceBytes, `Incremental Canvas slice exceeds ${maxCanvasSliceBytes}: ${canvasIncrementalBytes}`);
  assert(!canvasClosure.some(({ key, src = "", file }) => FORBIDDEN_FROZEN.test(`${key} ${src} ${file}`)), "2D closure imports 3D code");
  assertSourceGraphExcludes3D(join(sourceRoot, "renderer2d", "CanvasWorldStage.tsx"), join(sourceRoot, "renderer"));

  const analysis = await buildProductionStageAnalysis();
  let production;
  try {
    const graph = await readBuildGraph(analysis.distDir);
    assertProductionBuildExcludesCharacterPilot(graph.manifest, graph.outputFiles);
    production = analyzeProductionStageClosure({
      manifest: graph.manifest,
      sizeByFile: graph.sizeByFile,
      stageSource: productionStageSource,
      startupKey: startupEntryKey(graph.manifest),
      maxIncrementalBytes: maxProductionCanvasBytes,
    });
  } finally {
    await analysis.cleanup();
  }
  assertProductionSourceGraphExcludes3D(join(sourceRoot, "renderer2d", "production", "PresentationWorldStage.tsx"), join(sourceRoot, "renderer"));

  console.log(
    `Bundle budget ok: initial=${initial.size} bytes, renderer=${renderer.size} bytes, `
      + `eventDemo=${eventDemo.size} bytes, worldPresence=${worldPresence.size} bytes, `
      + `canvasFull=${canvasFullBytes} bytes, canvasIncremental=${canvasIncrementalBytes} bytes, `
      + `productionCanvasFull=${production.fullBytes} bytes, `
      + `productionCanvasIncremental=${production.incrementalBytes} bytes, `
      + `productionCanvasCss=${production.cssBytes} bytes, productionCanvasArt=${production.artBytes} bytes, `
      + `chunks=${main.sizes.length}`,
  );
}

const isCli = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  await runBudgetCheck();
}
