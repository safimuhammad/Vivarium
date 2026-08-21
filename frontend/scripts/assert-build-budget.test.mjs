import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  analyzeProductionStageClosure,
  assertProductionSourceGraphExcludes3D,
  assertSourceGraphExcludes3D,
  manifestClosure,
  sourceModuleClosure,
  sourceStaticClosure,
} from "./assert-build-budget.mjs";
import * as buildBudget from "./assert-build-budget.mjs";

const frontendDirectory = fileURLToPath(new URL("..", import.meta.url));

test("reports manifest-derived full and incremental Canvas closure bytes", () => {
  const output = execFileSync(process.execPath, ["scripts/assert-build-budget.mjs"], {
    cwd: frontendDirectory,
    encoding: "utf8",
  });

  assert.match(output, /canvasFull=\d+ bytes/);
  assert.match(output, /canvasIncremental=\d+ bytes/);
  assert.match(output, /productionCanvasFull=\d+ bytes/);
  assert.match(output, /productionCanvasIncremental=\d+ bytes/);
});

test("production Stage arithmetic subtracts startup shared files, deduplicates, and retains its root", () => {
  const { manifest, sizes } = syntheticManifest();
  const result = analyzeProductionStageClosure({
    manifest,
    sizeByFile: sizes,
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
    startupKey: "index.html",
    maxIncrementalBytes: 50,
  });

  assert.equal(result.fullBytes, 60);
  assert.equal(result.incrementalBytes, 50);
  assert.equal(result.cssBytes, 7);
  assert.equal(result.artBytes, 11);
  assert.deepEqual(result.incrementalFiles, ["assets/helper.js", "assets/stage.js"]);
});

test("production Stage budget rejects one byte over 122880", () => {
  const { manifest, sizes } = syntheticManifest();
  sizes.set("assets/stage.js", 122_861);
  assert.throws(() => analyzeProductionStageClosure({
    manifest,
    sizeByFile: sizes,
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
    startupKey: "index.html",
    maxIncrementalBytes: 122_880,
  }), /122880.*122881|122881.*122880/);
});

test("production Stage must have an exact manifest source and remain outside startup", () => {
  const missing = syntheticManifest();
  delete missing.manifest["stage-entry"];
  assert.throws(() => analyzeProductionStageClosure({
    manifest: missing.manifest,
    sizeByFile: missing.sizes,
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
    startupKey: "index.html",
    maxIncrementalBytes: 122_880,
  }), /Missing.*PresentationWorldStage/);

  const reachable = syntheticManifest();
  reachable.manifest["index.html"].imports.push("stage-entry");
  assert.throws(() => analyzeProductionStageClosure({
    manifest: reachable.manifest,
    sizeByFile: reachable.sizes,
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
    startupKey: "index.html",
    maxIncrementalBytes: 122_880,
  }), /must not be reachable from startup/i);
});

test("budget closure is static while no-Three closure follows dynamic imports", () => {
  const { manifest } = syntheticManifest();
  assert.deepEqual(
    manifestClosure(manifest, "stage-entry", { includeDynamic: false }).map(({ key }) => key),
    ["stage-entry", "shared", "helper"],
  );
  assert.deepEqual(
    manifestClosure(manifest, "stage-entry", { includeDynamic: true }).map(({ key }) => key),
    ["stage-entry", "shared", "helper", "lazy"],
  );

  manifest.lazy.src = "src/renderer/WorldRenderer.ts";
  assert.throws(() => analyzeProductionStageClosure({
    manifest,
    sizeByFile: syntheticManifest().sizes,
    stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
    startupKey: "index.html",
    maxIncrementalBytes: 122_880,
  }), /3D|WorldRenderer/);
});

test("rooted source traversal follows relative dynamic imports and rejects hidden Three", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vivarium-canvas-closure-"));
  const root = join(directory, "CanvasWorldStage.js");
  const helper = join(directory, "helper.js");
  try {
    await writeFile(root, 'void import("./helper.js");\n');
    await writeFile(helper, 'void import("three");\n');

    assert.deepEqual(sourceModuleClosure(root, { includeDynamic: false }), [root]);
    assert.deepEqual(sourceModuleClosure(root, { includeDynamic: true }), [root, helper].sort());
    assert.deepEqual(sourceStaticClosure(root), [root]);
    assert.throws(() => assertSourceGraphExcludes3D(root, join(directory, "renderer")), /Three/i);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production source traversal rejects a dynamically hidden frozen-slice module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vivarium-production-closure-"));
  const root = join(directory, "PresentationWorldStage.js");
  const frozen = join(directory, "CanvasWorldStage.js");
  try {
    await writeFile(root, 'void import("./CanvasWorldStage.js");\n');
    await writeFile(frozen, "export const legacy = true;\n");
    assert.throws(
      () => assertProductionSourceGraphExcludes3D(root, join(directory, "renderer")),
      /CanvasWorldStage|frozen|demo/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("production build closure rejects every character-pilot manifest and output surface", () => {
  assert.equal(
    typeof buildBudget.assertProductionBuildExcludesCharacterPilot,
    "function",
    "build gate must expose its character-pilot closure assertion for synthetic tests",
  );
  const assertProductionBuildExcludesCharacterPilot =
    buildBudget.assertProductionBuildExcludesCharacterPilot;
  const clean = syntheticManifest();
  assert.doesNotThrow(() => assertProductionBuildExcludesCharacterPilot(
    clean.manifest,
    [
      ".vite/manifest.json",
      "index.html",
      "assets/start.js",
      "assets/stage.js",
      "assets/stage.png",
    ],
  ));

  const manifestSource = syntheticManifest();
  manifestSource.manifest["pilot-entry"] = {
    file: "assets/isolated-qa.js",
    src: "src/qa/characterPilot/entry.tsx",
    isEntry: true,
  };
  assert.throws(
    () => assertProductionBuildExcludesCharacterPilot(manifestSource.manifest, ["index.html"]),
    /character pilot.*manifest|manifest.*character pilot/i,
  );

  const manifestAsset = syntheticManifest();
  manifestAsset.manifest["stage-entry"].assets.push(
    "assets/character-pilot-body-deadbeef.png",
  );
  assert.throws(
    () => assertProductionBuildExcludesCharacterPilot(manifestAsset.manifest, ["index.html"]),
    /character pilot.*manifest|manifest.*character pilot/i,
  );

  for (const output of [
    "character-pilot.html",
    "assets/character-pilot-held-deadbeef.png",
  ]) {
    assert.throws(
      () => assertProductionBuildExcludesCharacterPilot(clean.manifest, [
        "index.html",
        output,
      ]),
      /character pilot.*output|output.*character pilot/i,
    );
  }
});

test("production source traversal rejects a dynamically hidden character-pilot module", async () => {
  const directory = await mkdtemp(join(tmpdir(), "vivarium-production-pilot-closure-"));
  const production = join(directory, "production");
  const pilot = join(directory, "qa", "characterPilot");
  const root = join(production, "PresentationWorldStage.js");
  const entry = join(pilot, "entry.js");
  try {
    await mkdir(production, { recursive: true });
    await mkdir(pilot, { recursive: true });
    await writeFile(root, 'void import("../qa/characterPilot/entry.js");\n');
    await writeFile(entry, "export const isolatedPilot = true;\n");
    assert.throws(
      () => assertProductionSourceGraphExcludes3D(root, join(directory, "renderer")),
      /character.?pilot|isolated pilot/i,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function syntheticManifest() {
  const manifest = {
    "index.html": { file: "assets/start.js", src: "index.html", isEntry: true, imports: ["shared"] },
    shared: { file: "assets/shared.js", src: "src/shared.ts" },
    "stage-entry": {
      file: "assets/stage.js",
      src: "src/renderer2d/production/PresentationWorldStage.tsx",
      isEntry: true,
      imports: ["shared", "helper", "helper"],
      dynamicImports: ["lazy"],
      css: ["assets/stage.css"],
      assets: ["assets/stage.png"],
    },
    helper: { file: "assets/helper.js", src: "src/renderer2d/production/helper.ts" },
    lazy: { file: "assets/lazy.js", src: "src/renderer2d/production/lazy.ts" },
  };
  return {
    manifest,
    sizes: new Map([
      ["assets/start.js", 5],
      ["assets/shared.js", 10],
      ["assets/stage.js", 30],
      ["assets/helper.js", 20],
      ["assets/lazy.js", 40],
      ["assets/stage.css", 7],
      ["assets/stage.png", 11],
    ]),
  };
}
