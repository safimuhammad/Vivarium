import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";
import { REGIONAL_R4_SCENE_PLANS } from "./regional-art-r4-spec.mjs";

import {
  R5_FORBIDDEN_GUIDE_CROPS,
  R5_GUIDE_SOURCES,
  R5_ASH_FORBIDDEN_RGB,
  R5_PRODUCTION_HUMAN_CONTRACT,
  R5_PURE_GROUND_TILE_CONTRACTS,
  R5_REQUIRED_HUMAN_WITNESS_ROLES,
  R5_STABLE_DIAGNOSTIC_NAMES,
  R5_SYNTHETIC_TRUSTED_SOURCE_ROWS,
  analyzeAshIndustrialWitnesses,
  analyzeComposedPixelAutocorrelation,
  analyzeSyntheticComposedPixelAutocorrelation,
  analyzeConstructedCluster,
  analyzeLandmarkMaterialDepth,
  analyzeOverlayVisibility,
  analyzeLifecycleOverlayComposites,
  analyzeYardCell,
  analyzeYardLifecycle,
  createTrustedSourceRegistry,
  validateAshIndustrialWitnesses,
  validateAshIndustrialMetrics,
  validateAshSourceRoleOrder,
  validateComposedPixelAutocorrelation,
  validateConstructedCluster,
  validateConstructedClusterMetrics,
  validateLandmarkMaterialDepth,
  validateOverlayVisibility,
  validateLifecycleOverlayComposites,
  validateLifecycleOverlayMetrics,
  validateProductionHumanWitnesses,
  validateRegionalR5VisualSet,
  validateSyntheticComposedPixelAutocorrelation,
  validateSyntheticAshIndustrialControl,
  validateSyntheticConstructedClusterControl,
  validateSyntheticLifecycleOverlayControl,
  validateSyntheticProductionHumanControl,
  validateYardCell,
  validateYardLifecycle,
} from "./regional-art-r5-visual-contract.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EVIDENCE = path.join(ROOT, "scratchpad/2d-production-art/evidence");
const rgba = (width, height, paint = [0, 0, 0, 0]) => {
  const data = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = paint[0];
    data[offset + 1] = paint[1];
    data[offset + 2] = paint[2];
    data[offset + 3] = paint[3];
  }
  return { data, width, height };
};
const setPixel = (image, x, y, color) => {
  const offset = (y * image.width + x) * 4;
  image.data.set(color, offset);
};
const fillRect = (image, x, y, width, height, color) => {
  for (let py = y; py < y + height; py += 1) for (let px = x; px < x + width; px += 1) {
    if (px >= 0 && py >= 0 && px < image.width && py < image.height) setPixel(image, px, py, color);
  }
};
const mask = (width, height, points = []) => {
  const data = new Uint8Array(width * height);
  for (const [x, y] of points) data[y * width + x] = 1;
  return { data, width, height };
};
const rectMask = (width, height, x, y, w, h) => {
  const points = [];
  for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) points.push([px, py]);
  return mask(width, height, points);
};
const lineMask = (width, height, points) => mask(width, height, points);
const cardinalComponentCount = (value) => {
  const seen = new Uint8Array(value.data.length);
  let count = 0;
  for (let seed = 0; seed < value.data.length; seed += 1) {
    if (value.data[seed] === 0 || seen[seed] !== 0) continue;
    count += 1;
    const queue = [seed];
    seen[seed] = 1;
    while (queue.length > 0) {
      const index = queue.shift();
      const x = index % value.width;
      for (const neighbor of [index - 1, index + 1, index - value.width, index + value.width]) {
        if (neighbor < 0 || neighbor >= value.data.length || seen[neighbor] !== 0 || value.data[neighbor] === 0) continue;
        if (neighbor === index - 1 && x === 0 || neighbor === index + 1 && x === value.width - 1) continue;
        seen[neighbor] = 1;
        queue.push(neighbor);
      }
    }
  }
  return count;
};
const layerFromMask = (value, color) => {
  const image = rgba(value.width, value.height);
  for (let pixel = 0; pixel < value.data.length; pixel += 1) {
    if (value.data[pixel] === 0) continue;
    image.data.set(color, pixel * 4);
  }
  return image;
};
const compositeLayer = (scene, layer) => {
  for (let pixel = 0; pixel < layer.width * layer.height; pixel += 1) {
    if (layer.data[pixel * 4 + 3] === 0) continue;
    layer.data.copy(scene.data, pixel * 4, pixel * 4, pixel * 4 + 4);
  }
};
const decode = async (file) => {
  const decoded = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: decoded.data, width: decoded.info.width, height: decoded.info.height };
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const loadCanonicalProductionHuman = async () => {
  const layers = [];
  for (const binding of R5_PRODUCTION_HUMAN_CONTRACT.layers) {
    const bytes = await readFile(path.join(ROOT, binding.path));
    assert.equal(sha256(bytes), binding.atlasSha256, binding.atlasId);
    layers.push(await sharp(bytes).extract({
      left: binding.cellIndex % 16 * 48,
      top: Math.floor(binding.cellIndex / 16) * 64,
      width: 48,
      height: 64,
    }).png().toBuffer());
  }
  const raw = await sharp({ create: { width: 48, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(layers.map((input) => ({ input })))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: raw.data, width: raw.info.width, height: raw.info.height };
};

const syntheticClusterSourcePng = async () => {
  const atlas = rgba(128, 64);
  fillRect(atlas, 0, 0, 96, 8, [142, 127, 91, 255]);
  fillRect(atlas, 0, 16, 28, 28, [113, 92, 64, 255]);
  fillRect(atlas, 32, 16, 10, 12, [87, 112, 73, 255]);
  fillRect(atlas, 48, 16, 9, 12, [76, 103, 69, 255]);
  return sharp(atlas.data, { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
};

const syntheticAshSourcePng = async (layers, width, height) => {
  const atlas = rgba(width * layers.length, height);
  for (const [cell, layer] of layers.entries()) for (let y = 0; y < height; y += 1) {
    layer.data.copy(atlas.data, ((y * atlas.width) + cell * width) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return sharp(atlas.data, { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
};

const syntheticLifecycleSourcePng = async (input) => {
  const layers = [
    input.terrain,
    ...input.baseLayers,
    input.homeActor,
    input.warmOverlay,
    input.hoardOverlay,
    ...input.warmComposites,
    ...input.hoardComposites,
  ];
  const width = 192;
  const height = 160;
  const atlas = rgba(width * layers.length, height);
  for (const [cell, layer] of layers.entries()) for (let y = 0; y < height; y += 1) {
    layer.data.copy(atlas.data, ((y * atlas.width) + cell * width) * 4, y * width * 4, (y + 1) * width * 4);
  }
  return sharp(atlas.data, { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
};

const syntheticHumanSourcePng = async (background, occluder) => {
  const atlas = rgba(1536, 512);
  for (const [cell, layer] of [background, occluder].entries()) for (let y = 0; y < 512; y += 1) {
    layer.data.copy(atlas.data, ((y * atlas.width) + cell * 768) * 4, y * 768 * 4, (y + 1) * 768 * 4);
  }
  return sharp(atlas.data, { raw: { width: atlas.width, height: atlas.height, channels: 4 } })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();
};
const pngBytes = async (image) => sharp(image.data, { raw: { width: image.width, height: image.height, channels: 4 } })
  .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false }).toBuffer();

function validLandmark() {
  const image = rgba(128, 128);
  fillRect(image, 30, 76, 68, 38, [48, 52, 58, 255]);
  fillRect(image, 38, 62, 52, 20, [91, 83, 68, 255]);
  fillRect(image, 46, 48, 36, 18, [139, 117, 82, 255]);
  fillRect(image, 54, 38, 20, 14, [197, 168, 103, 255]);
  fillRect(image, 42, 82, 10, 26, [189, 126, 72, 255]);
  fillRect(image, 75, 82, 10, 26, [116, 148, 112, 255]);
  return image;
}

function validIrregularYard() {
  const image = rgba(192, 160);
  fillRect(image, 24, 56, 52, 58, [89, 72, 51, 255]);
  fillRect(image, 116, 82, 52, 46, [82, 96, 62, 255]);
  fillRect(image, 35, 126, 38, 18, [151, 119, 70, 255]);
  fillRect(image, 128, 44, 28, 24, [118, 94, 61, 255]);
  return image;
}

function uYard() {
  const image = rgba(192, 160);
  fillRect(image, 26, 30, 140, 18, [98, 78, 57, 255]);
  fillRect(image, 26, 30, 18, 105, [98, 78, 57, 255]);
  fillRect(image, 148, 30, 18, 105, [98, 78, 57, 255]);
  return image;
}

function periodicScene(period) {
  const cell = 32;
  const width = cell * 18;
  const height = cell * 12;
  const image = rgba(width, height, [40, 44, 48, 255]);
  for (let ty = 0; ty < height / cell; ty += 1) for (let tx = 0; tx < width / cell; tx += 1) {
    const key = (tx % period) + (ty % period) * period;
    const color = [32 + key * 7 % 191, 48 + key * 11 % 173, 64 + key * 13 % 157, 255];
    fillRect(image, tx * cell, ty * cell, cell, cell, color);
    fillRect(image, tx * cell + key % 13, ty * cell + key % 11, 3, 3, [220, 190, 120, 255]);
  }
  return image;
}

function irregularScene() {
  const image = rgba(576, 384, [61, 72, 65, 255]);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const broad = x < 170 + Math.floor(28 * Math.sin(y / 43)) ? 0 : y < 190 + Math.floor(35 * Math.cos(x / 57)) ? 1 : 2;
    const blockNoise = (Math.floor(x / 4) * 131 + Math.floor(y / 4) * 197) % 211 === 0;
    const noise = blockNoise ? 14 : 0;
    const palettes = [[61, 72, 65], [83, 88, 67], [70, 75, 82]];
    const base = palettes[broad];
    setPixel(image, x, y, [base[0] + noise, base[1] + noise, base[2] + noise, 255]);
  }
  return image;
}

function shuffledTileMotifScene() {
  const cell = 32;
  const columns = 18;
  const rows = 12;
  const image = rgba(columns * cell, rows * cell, [40, 44, 48, 255]);
  for (let ty = 0; ty < rows; ty += 1) for (let tx = 0; tx < columns; tx += 1) {
    const shuffled = (tx * 71 + ty * 113 + tx * ty * 17) % 197;
    const base = [35 + shuffled % 83, 48 + shuffled * 3 % 91, 55 + shuffled * 5 % 89, 255];
    fillRect(image, tx * cell, ty * cell, cell, cell, base);
    fillRect(image, tx * cell + 7, ty * cell + 9, 12, 4, [214, 177, 98, 255]);
    fillRect(image, tx * cell + 11, ty * cell + 5, 4, 13, [214, 177, 98, 255]);
  }
  return image;
}

function saltedIrregularScene() {
  const image = irregularScene();
  for (let y = 2; y < image.height; y += 6) for (let x = 2; x < image.width; x += 6) {
    setPixel(image, x, y, [219, 71 + x % 31, 87 + y % 29, 255]);
  }
  return image;
}

function singletonSaltProductionScene() {
  const image = rgba(768, 512);
  for (let tileY = 0; tileY < 16; tileY += 1) for (let tileX = 0; tileX < 24; tileX += 1) {
    const seed = (tileX * 73 + tileY * 151 + tileX * tileY * 29) % 197;
    const base = [35 + seed % 91, 46 + seed * 3 % 97, 55 + seed * 5 % 89, 255];
    fillRect(image, tileX * 32, tileY * 32, 32, 32, base);
    const phase = (tileX * 347 + tileY * 593 + tileX * tileY * 181) % 1024;
    setPixel(image, tileX * 32 + phase % 32, tileY * 32 + Math.floor(phase / 32), [241, 91, 113, 255]);
  }
  return image;
}

test("R5 pins both untracked guide sheets by exact path, dimensions, and SHA-256", async () => {
  assert.deepEqual(R5_GUIDE_SOURCES, Object.freeze({
    regionKits: Object.freeze({
      path: "scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
      width: 1536,
      height: 1024,
      sha256: "2d4aa7c04e7af2c123a34f854ae896eef5babf7e56344a7750014adf07335913",
      repositoryVersioned: false,
    }),
    homeRuin: Object.freeze({
      path: "scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
      width: 1536,
      height: 1024,
      sha256: "a8d83b04d092cfd03400c7541ee6003b73ed0426270a1a5b7b0170966c411b48",
      repositoryVersioned: false,
    }),
  }));
  for (const source of Object.values(R5_GUIDE_SOURCES)) {
    const bytes = await readFile(path.join(ROOT, source.path));
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, source.width);
    assert.equal(metadata.height, source.height);
    assert.equal(sha256(bytes), source.sha256);
  }
});

test("R5 freezes exactly the 13 semantically contradictory guide crops", () => {
  assert.deepEqual(R5_FORBIDDEN_GUIDE_CROPS, Object.freeze([
    "spring-terraces/willow[3]",
    "spring-terraces/reed-bed[2]",
    "spring-terraces/reed-bed[3]",
    "dry-scrub/sun-rock[2]",
    "dry-scrub/sun-rock[3]",
    "dry-scrub/thorn[0]",
    "dry-scrub/thorn[1]",
    "dry-scrub/thorn[2]",
    "dry-scrub/thorn[3]",
    "neutral-temperate/soft-grass[0]",
    "neutral-temperate/soft-grass[1]",
    "neutral-temperate/soft-grass[2]",
    "neutral-temperate/soft-grass[3]",
  ]));
  assert.equal(new Set(R5_FORBIDDEN_GUIDE_CROPS).size, 13);
});

test("trusted source registries recursively freeze authority hashes, inventory, cells, and destinations", () => {
  const mutableRow = {
    assetId: "future-task2-row",
    pngSha256: "png-authority",
    baseRgbaSha256: "base-authority",
    sceneRgbaSha256: "scene-authority",
    width: 32,
    height: 32,
    sceneWidth: 32,
    sceneHeight: 32,
    layerInventory: ["cell"],
    roleInventory: ["support"],
    layers: [{
      id: "cell",
      role: "support",
      rect: { x: 0, y: 0, width: 32, height: 32 },
      destination: { x: 0, y: 0 },
      rgbaSha256: "cell-authority",
    }],
  };
  const registry = createTrustedSourceRegistry([["future", mutableRow]]);
  assert.equal(Object.isFrozen(registry), true);
  assert.equal(Object.isFrozen(registry.future), true);
  assert.equal(Object.isFrozen(registry.future.layers), true);
  assert.equal(Object.isFrozen(registry.future.layers[0]), true);
  assert.equal(Object.isFrozen(registry.future.layers[0].rect), true);
  assert.equal(Object.isFrozen(registry.future.layers[0].destination), true);
  for (const mutate of [
    () => { mutableRow.pngSha256 = "changed"; },
    () => { mutableRow.baseRgbaSha256 = "changed"; },
    () => { mutableRow.sceneRgbaSha256 = "changed"; },
    () => { mutableRow.layerInventory[0] = "changed"; },
    () => { mutableRow.layers[0].rgbaSha256 = "changed"; },
    () => { mutableRow.layers[0].rect.x = 9; },
    () => { mutableRow.layers[0].destination.x = 9; },
  ]) assert.throws(mutate, TypeError);
  assert.deepEqual({
    png: registry.future.pngSha256,
    base: registry.future.baseRgbaSha256,
    scene: registry.future.sceneRgbaSha256,
    cell: registry.future.layers[0].rgbaSha256,
    rectX: registry.future.layers[0].rect.x,
    destinationX: registry.future.layers[0].destination.x,
  }, { png: "png-authority", base: "base-authority", scene: "scene-authority", cell: "cell-authority", rectX: 0, destinationX: 0 });
  assert.equal(Object.values(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS).every((row) => Object.isFrozen(row) && Object.isFrozen(row.layers)), true);
  assert.deepEqual(R5_SYNTHETIC_TRUSTED_SOURCE_ROWS["synthetic-ash"].roleInventory, [
    "pylon-lattice", "cable-run", "containment-relief", "service-slab",
  ]);

  const callableRow = function callableAuthorityRow() {};
  Object.assign(callableRow, {
    pngSha256: "callable-png-authority",
    layerInventory: ["cell"],
    roleInventory: ["support"],
    layers: [{
      id: "cell",
      role: "support",
      rect: { x: 0, y: 0, width: 1, height: 1 },
      destination: { x: 0, y: 0 },
      rgbaSha256: "callable-cell-authority",
    }],
  });
  assert.throws(() => {
    const vulnerableRegistry = createTrustedSourceRegistry([["callable", callableRow]]);
    vulnerableRegistry.callable.pngSha256 = "mutated";
    vulnerableRegistry.callable.layers[0].destination.x = 99;
  }, /plain authority data/);

  let accessorInvocations = 0;
  const accessorRow = {};
  Object.defineProperty(accessorRow, "pngSha256", {
    enumerable: true,
    get() {
      accessorInvocations += 1;
      return "getter-backed-authority";
    },
  });
  assert.throws(
    () => createTrustedSourceRegistry([["accessor-row", accessorRow]]),
    /plain authority data/,
  );
  const accessorDescriptor = { id: "cell", role: "support" };
  Object.defineProperty(accessorDescriptor, "destination", {
    enumerable: true,
    get() {
      accessorInvocations += 1;
      return { x: 0, y: 0 };
    },
  });
  assert.throws(
    () => createTrustedSourceRegistry([["accessor-descriptor", { layers: [accessorDescriptor] }]]),
    /plain authority data/,
  );
  assert.equal(accessorInvocations, 0, "authority accessors must be rejected without invoking getters");

  const customPrototypeRow = Object.assign(Object.create({ inheritedAuthority: true }), { pngSha256: "custom" });
  const customPrototypeDescriptor = Object.assign(Object.create({ inheritedDescriptor: true }), { id: "cell", role: "support" });
  const customPrototypeRect = Object.assign(Object.create({ inheritedRect: true }), { x: 0, y: 0, width: 1, height: 1 });
  const customPrototypeDestination = Object.assign(Object.create({ inheritedDestination: true }), { x: 0, y: 0 });
  for (const [label, nonPlainRow] of [
    ["date-row", new Date(0)],
    ["map-row", new Map([["pngSha256", "map"]])],
    ["custom-prototype-row", customPrototypeRow],
    ["non-plain-descriptor", { layers: [customPrototypeDescriptor] }],
    ["non-plain-rect", { layers: [{ rect: customPrototypeRect }] }],
    ["non-plain-destination", { layers: [{ destination: customPrototypeDestination }] }],
  ]) {
    assert.throws(
      () => createTrustedSourceRegistry([[label, nonPlainRow]]),
      /plain authority data/,
      label,
    );
  }

  const canonicalAsh = R5_SYNTHETIC_TRUSTED_SOURCE_ROWS["synthetic-ash"];
  const permutedIndices = [1, 0, 2, 3];
  const jointlyPermutedAsh = createTrustedSourceRegistry([["permuted-ash", {
    ...canonicalAsh,
    roleInventory: permutedIndices.map((index) => canonicalAsh.roleInventory[index]),
    layers: permutedIndices.map((index) => canonicalAsh.layers[index]),
  }]])["permuted-ash"];
  assert.match(
    validateAshSourceRoleOrder(jointlyPermutedAsh, jointlyPermutedAsh.layers).join("\n"),
    /oracle-owned pylon\/cable\/containment\/service role order/,
  );
});

test("R5 owns exact any-intersection pure-ground sets, digests, and all 16 pair counts", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(R5_PURE_GROUND_TILE_CONTRACTS).map(([kit, contract]) => [kit, contract.eligibleTileIndices.length])), {
    "worn-heartland": 266,
    "spring-terraces": 268,
    "dry-scrub": 254,
    "ash-waste": 277,
    "neutral-temperate": 268,
  });
  const exact = {
    "worn-heartland": { digest: "ec4aa5de18d62430494d4bf48a17f72091befdc3d60f165e4e1eb0ec35eebcd4", x: [232,216,196,176,161,143,126,114], y: [219,185,156,130,108,100,86,76] },
    "spring-terraces": { digest: "ee196e8bf1c3779d2eb237f1c42ad86d1a9d04bd11a05c4390ac1d63f1362ad6", x: [233,206,186,169,153,147,137,128], y: [215,171,139,114,98,91,89,80] },
    "dry-scrub": { digest: "b81c33e16f18164b9dfdcd0efbf341b89ff04ff1df1def5912093c6e6632a417", x: [225,200,179,161,157,149,143,132], y: [210,173,136,126,116,108,98,88] },
    "ash-waste": { digest: "756a6b7e1aeb9c57077fa8cf876a93ffe3ccbb00b865f17db2cf385c92c2ca77", x: [241,215,196,177,169,157,141,131], y: [232,191,158,127,105,93,89,85] },
    "neutral-temperate": { digest: "8ee9ee50bbda1b0beb6eba29ffe6b3228726cfaf57a49c9308cbf2cc9b19cf82", x: [234,204,178,158,144,126,115,104], y: [226,194,164,138,116,100,87,81] },
  };
  for (const contract of Object.values(R5_PURE_GROUND_TILE_CONTRACTS)) {
    assert.equal(contract.columns, 24);
    assert.equal(contract.rows, 16);
    assert.equal(Object.isFrozen(contract), true);
    assert.equal(Object.isFrozen(contract.eligibleTileIndices), true);
    assert.equal(new Set(contract.eligibleTileIndices).size, contract.eligibleTileIndices.length);
  }
  for (const [kit, expected] of Object.entries(exact)) {
    const contract = R5_PURE_GROUND_TILE_CONTRACTS[kit];
    assert.equal(sha256(Buffer.from(JSON.stringify(contract.eligibleTileIndices))), expected.digest);
    assert.deepEqual(contract.shiftPairCounts.x, expected.x);
    assert.deepEqual(contract.shiftPairCounts.y, expected.y);
    const plan = REGIONAL_R4_SCENE_PLANS[kit];
    const excludedTiles = new Set([
      ...plan.routeTiles, ...plan.waterTiles, ...plan.shoreTiles, ...plan.bridgeTiles,
      ...plan.terrainPatches.flatMap(({ tiles }) => tiles),
    ].map(({ x, y }) => y * 24 + x));
    const rectangles = [
      ...plan.landmarks.map(({ x, y }) => ({ x, y, width: 128, height: 128 })),
      ...plan.supports.map(({ x, y }) => ({ x, y, width: 32, height: 32 })),
      { x: plan.yard.originPx.x, y: plan.yard.originPx.y, width: 192, height: 160 },
    ];
    const derived = [];
    for (let y = 0; y < 16; y += 1) for (let x = 0; x < 24; x += 1) {
      const index = y * 24 + x;
      const tile = { x: x * 32, y: y * 32, width: 32, height: 32 };
      const intersects = rectangles.some((rect) => tile.x < rect.x + rect.width && tile.x + 32 > rect.x
        && tile.y < rect.y + rect.height && tile.y + 32 > rect.y);
      if (!excludedTiles.has(index) && !intersects) derived.push(index);
    }
    assert.deepEqual(contract.eligibleTileIndices, derived, `${kit} strict half-open intersections`);
  }
});

test("landmark material-depth control accepts anatomy and rejects flat, two-color, and confetti cells", () => {
  const valid = validLandmark();
  const metrics = analyzeLandmarkMaterialDepth(valid);
  assert.ok(metrics.opaqueColorCount >= 4);
  assert.ok(metrics.significantColorCount >= 3);
  assert.ok(metrics.silhouetteWidth >= 64);
  assert.ok(metrics.silhouetteHeight >= 48);
  assert.deepEqual(validateLandmarkMaterialDepth(valid), []);
  const frequencies = new Map();
  for (let offset = 0; offset < valid.data.length; offset += 4) {
    if (valid.data[offset + 3] === 0) continue;
    const key = [...valid.data.subarray(offset, offset + 4)].join(",");
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const opaquePixels = [...frequencies.values()].reduce((sum, count) => sum + count, 0);
  assert.equal(metrics.dominantColorShare, Math.max(...frequencies.values()) / opaquePixels);

  const flat = rgba(128, 128);
  fillRect(flat, 28, 60, 72, 58, [78, 68, 61, 255]);
  assert.match(validateLandmarkMaterialDepth(flat).join("\n"), /landmark-material-depth: opaque colors/);

  const twoColor = rgba(128, 128);
  fillRect(twoColor, 28, 60, 72, 58, [78, 68, 61, 255]);
  fillRect(twoColor, 45, 70, 38, 24, [126, 109, 84, 255]);
  assert.match(validateLandmarkMaterialDepth(twoColor).join("\n"), /landmark-material-depth: opaque colors/);

  const confetti = validLandmark();
  for (let y = 8; y < 120; y += 4) for (let x = 8; x < 120; x += 4) {
    setPixel(confetti, x, y, [230, 40 + x % 90, 90 + y % 80, 255]);
  }
  assert.match(validateLandmarkMaterialDepth(confetti).join("\n"), /landmark-material-depth: tiny component share/);
  const padded = validLandmark();
  setPixel(padded, 1, 1, [210, 90, 80, 255]);
  const paddedMetrics = analyzeLandmarkMaterialDepth(padded);
  assert.equal(paddedMetrics.silhouetteWidth, metrics.silhouetteWidth);
  assert.equal(paddedMetrics.silhouetteHeight, metrics.silhouetteHeight);
  const horizontalSlab = rgba(128, 128);
  fillRect(horizontalSlab, 8, 70, 112, 48, [78, 68, 61, 255]);
  fillRect(horizontalSlab, 20, 78, 26, 20, [126, 109, 84, 255]);
  fillRect(horizontalSlab, 50, 78, 26, 20, [162, 133, 91, 255]);
  fillRect(horizontalSlab, 80, 78, 26, 20, [93, 118, 83, 255]);
  assert.match(validateLandmarkMaterialDepth(horizontalSlab).join("\n"), /landmark-material-depth: implausible silhouette orientation/);
  const detachedSlab = validLandmark();
  fillRect(detachedSlab, 4, 2, 116, 32, [48, 52, 58, 255]);
  const detachedMetrics = analyzeLandmarkMaterialDepth(detachedSlab);
  assert.ok(detachedMetrics.connectedSilhouetteShare < 0.55);
  assert.match(validateLandmarkMaterialDepth(detachedSlab).join("\n"), /landmark-material-depth: largest alpha component share/);
  const aggregateColors = rgba(128, 128);
  fillRect(aggregateColors, 30, 50, 64, 64, [78, 68, 61, 255]);
  fillRect(aggregateColors, 40, 60, 20, 20, [126, 109, 84, 255]);
  fillRect(aggregateColors, 70, 60, 20, 20, [162, 133, 91, 255]);
  fillRect(aggregateColors, 4, 4, 12, 12, [93, 118, 83, 255]);
  assert.equal(analyzeLandmarkMaterialDepth(aggregateColors).significantColorCount, 4);
});

test("full composed-pixel oracle rejects exact 32px periods 2 through 8 and accepts irregular masses", () => {
  const syntheticControl = "all-ground-18x12";
  for (let period = 2; period <= 8; period += 1) {
    const metrics = analyzeSyntheticComposedPixelAutocorrelation(periodicScene(period), syntheticControl);
    const witness = metrics.shifts.find(({ axis, multiple }) => axis === "x" && multiple === period);
    assert.equal(witness?.autocorrelation, 1, `period ${period}`);
    assert.match(validateSyntheticComposedPixelAutocorrelation(periodicScene(period), syntheticControl).join("\n"), new RegExp(`terrain-rgb-periodicity: x${period}=`));
  }
  const metrics = analyzeSyntheticComposedPixelAutocorrelation(irregularScene(), syntheticControl);
  assert.ok(metrics.maximumTileResidualAutocorrelation <= 0.28, `${metrics.maximumTileResidualAutocorrelation}`);
  assert.ok(metrics.p32 <= 0.1, `${metrics.p32}`);
  assert.deepEqual(validateSyntheticComposedPixelAutocorrelation(irregularScene(), syntheticControl), []);
});

test("phase-locked motif gate rejects shuffled tiles even when broad material colors decorrelate", () => {
  const syntheticControl = "all-ground-18x12";
  const metrics = analyzeSyntheticComposedPixelAutocorrelation(shuffledTileMotifScene(), syntheticControl);
  assert.ok(metrics.p32 > 0.1 || metrics.maximumTileResidualAutocorrelation > 0.28, JSON.stringify(metrics));
  assert.match(validateSyntheticComposedPixelAutocorrelation(shuffledTileMotifScene(), syntheticControl).join("\n"), /terrain-(?:rgb-periodicity|phase-locked-motif)/);
  assert.match(validateSyntheticComposedPixelAutocorrelation(saltedIrregularScene(), syntheticControl).join("\n"), /terrain-accent-speckle/);
  assert.match(validateComposedPixelAutocorrelation(shuffledTileMotifScene(), {
    kit: "worn-heartland",
    candidateEligibleTileMask: new Array(216).fill(false),
  }).join("\n"), /trusted-ground-mask: candidate masks are forbidden/);
  assert.match(validateComposedPixelAutocorrelation(shuffledTileMotifScene(), {
    kit: "worn-heartland",
    maximumAutocorrelation: 1,
  }).join("\n"), /candidate thresholds or denominators are forbidden/);
  const forgedContract = Object.freeze({ columns: 18, rows: 12, eligibleTileIndices: Object.freeze([0, 1]) });
  assert.match(validateComposedPixelAutocorrelation(irregularScene(), { trustedGroundContract: forgedContract }).join("\n"), /trusted-ground-mask: caller contracts are forbidden/);
  assert.match(validateComposedPixelAutocorrelation(irregularScene(), { syntheticControl }).join("\n"), /trusted-ground-mask: synthetic controls are forbidden on production validation/);
  assert.match(validateComposedPixelAutocorrelation(irregularScene(), { kit: "worn-heartland", maxMultiple: 7 }).join("\n"), /candidate analysis knobs are forbidden/);
  assert.match(validateComposedPixelAutocorrelation(irregularScene(), { kit: "worn-heartland", cellSize: 16 }).join("\n"), /candidate analysis knobs are forbidden/);
});

test("yard geometry accepts an irregular apron and rejects a three-sided U, blocked corridor, socket, and bad coverage", () => {
  const valid = validIrregularYard();
  const metrics = analyzeYardCell(valid);
  assert.ok(metrics.alphaCoverage >= 0.08 && metrics.alphaCoverage <= 0.55);
  assert.ok(metrics.borderTransparency >= 0.9);
  assert.ok(metrics.corridorCoverage <= 0.08);
  assert.equal(metrics.threeSidedWrap, false);
  assert.equal(metrics.enclosedSocketCount, 0);
  assert.deepEqual(validateYardCell(valid), []);

  assert.match(validateYardCell(uYard()).join("\n"), /yard-three-sided-wrap/);
  const corridor = validIrregularYard();
  fillRect(corridor, 80, 112, 32, 48, [99, 78, 51, 255]);
  assert.match(validateYardCell(corridor).join("\n"), /yard-corridor/);
  const doorBlocked = validIrregularYard();
  fillRect(doorBlocked, 80, 96, 32, 16, [99, 78, 51, 255]);
  assert.match(validateYardCell(doorBlocked).join("\n"), /yard-door-clearance/);
  const socket = rgba(192, 160);
  fillRect(socket, 50, 50, 92, 12, [99, 78, 51, 255]);
  fillRect(socket, 50, 50, 12, 70, [99, 78, 51, 255]);
  fillRect(socket, 130, 50, 12, 70, [99, 78, 51, 255]);
  fillRect(socket, 50, 108, 92, 12, [99, 78, 51, 255]);
  assert.match(validateYardCell(socket).join("\n"), /yard-enclosed-socket/);
  assert.match(validateYardCell(rgba(192, 160)).join("\n"), /yard-coverage/);
  const exactProjection = rgba(192, 160);
  fillRect(exactProjection, 16, 16, 32, 128, [98, 78, 57, 255]);
  fillRect(exactProjection, 144, 16, 32, 128, [98, 78, 57, 255]);
  fillRect(exactProjection, 32, 50, 128, 16, [98, 78, 57, 255]);
  assert.equal(analyzeYardCell(exactProjection).threeSidedWrap, true);
  assert.match(validateYardCell(exactProjection).join("\n"), /yard-three-sided-wrap/);
  const disconnectedProjectionBands = rgba(192, 160);
  fillRect(disconnectedProjectionBands, 48, 0, 96, 48, [98, 78, 57, 255]);
  fillRect(disconnectedProjectionBands, 0, 60, 48, 84, [98, 78, 57, 255]);
  fillRect(disconnectedProjectionBands, 144, 60, 48, 84, [98, 78, 57, 255]);
  assert.equal(analyzeYardCell(disconnectedProjectionBands).threeSidedWrap, false);
  const harmlessSocket = validIrregularYard();
  fillRect(harmlessSocket, 8, 8, 32, 4, [99, 78, 51, 255]);
  fillRect(harmlessSocket, 8, 36, 32, 4, [99, 78, 51, 255]);
  fillRect(harmlessSocket, 8, 8, 4, 32, [99, 78, 51, 255]);
  fillRect(harmlessSocket, 36, 8, 4, 32, [99, 78, 51, 255]);
  assert.deepEqual(validateYardCell(harmlessSocket), []);
});

test("yard lifecycle states require exact open door topology and material-object symmetric differences", () => {
  const baseA = validIrregularYard();
  const baseB = validIrregularYard();
  fillRect(baseB, 130, 132, 30, 20, [173, 128, 71, 255]);
  const ruin = validIrregularYard();
  fillRect(ruin, 24, 56, 20, 40, [0, 0, 0, 0]);
  fillRect(ruin, 18, 118, 28, 12, [72, 65, 59, 255]);
  const value = analyzeYardLifecycle({ baseA, baseB, ruin });
  assert.ok(value.baseABAlphaSymmetricDifference >= 0.08);
  assert.ok(value.baseRuinAlphaSymmetricDifference >= 0.12);
  assert.ok(value.baseBRuinAlphaSymmetricDifference >= 0.12);
  assert.equal(value.states.every((state) => state.corridorConnectedToSouth && state.enclosedHoleCount === 0), true);
  assert.deepEqual(validateYardLifecycle({ baseA, baseB, ruin }), []);

  const tintOnly = { ...baseA, data: Buffer.from(baseA.data) };
  for (let offset = 0; offset < tintOnly.data.length; offset += 4) if (tintOnly.data[offset + 3] > 0) tintOnly.data[offset] = Math.min(255, tintOnly.data[offset] + 30);
  assert.match(validateYardLifecycle({ baseA, baseB: tintOnly, ruin }).join("\n"), /yard-state-symmetric-difference: standing-a\/standing-b/);
  assert.match(validateYardLifecycle({ baseA, baseB, ruin: baseA }).join("\n"), /yard-state-symmetric-difference: standing-a\/ruin/);
});

test("overlay control requires a localized, visible connected object rather than invisible or confetti pixels", () => {
  const visible = rgba(192, 160);
  fillRect(visible, 34, 100, 18, 12, [232, 168, 71, 255]);
  fillRect(visible, 40, 94, 6, 6, [255, 220, 109, 255]);
  const metrics = analyzeOverlayVisibility(visible);
  assert.ok(metrics.alphaCoverage > 0.005 && metrics.alphaCoverage < 0.2);
  assert.ok(metrics.largestComponentPixels >= 32);
  assert.deepEqual(validateOverlayVisibility(visible), []);

  assert.match(validateOverlayVisibility(rgba(192, 160)).join("\n"), /overlay-visibility/);
  const confetti = rgba(192, 160);
  for (let i = 0; i < 48; i += 1) setPixel(confetti, 8 + i * 17 % 175, 8 + i * 29 % 143, [255, 180, 70, 255]);
  assert.match(validateOverlayVisibility(confetti).join("\n"), /overlay-connectivity/);
});

test("lifecycle overlays are byte-visible localized objects over terrain, both bases, and HomeActor", async () => {
  const width = 192;
  const height = 160;
  const terrain = rgba(width, height, [68, 79, 62, 255]);
  const baseA = validIrregularYard();
  const baseB = validIrregularYard();
  fillRect(baseB, 142, 70, 16, 14, [178, 132, 76, 255]);
  const homeActor = rgba(width, height);
  fillRect(homeActor, 66, 54, 62, 58, [91, 70, 52, 255]);
  fillRect(homeActor, 82, 84, 28, 28, [132, 88, 61, 255]);
  const warmOverlay = rgba(width, height);
  fillRect(warmOverlay, 46, 104, 14, 10, [232, 151, 55, 255]);
  fillRect(warmOverlay, 50, 98, 6, 8, [255, 214, 92, 255]);
  fillRect(warmOverlay, 64, 100, 4, 10, [232, 151, 55, 255]);
  const hoardOverlay = rgba(width, height);
  fillRect(hoardOverlay, 132, 100, 20, 13, [189, 139, 71, 255]);
  fillRect(hoardOverlay, 138, 92, 8, 8, [225, 184, 104, 255]);
  const flatten = (base, overlay) => {
    const scene = { ...terrain, data: Buffer.from(terrain.data) };
    for (const layer of [base, overlay, homeActor]) compositeLayer(scene, layer);
    return scene;
  };
  const input = {
    terrain,
    baseLayers: [baseA, baseB],
    homeActor,
    warmOverlay,
    hoardOverlay,
    warmComposites: [flatten(baseA, warmOverlay), flatten(baseB, warmOverlay)],
    hoardComposites: [flatten(baseA, hoardOverlay), flatten(baseB, hoardOverlay)],
  };
  const metrics = analyzeLifecycleOverlayComposites(input);
  assert.ok(metrics.warm.every((value) => value.deltaPixels >= 32 && value.deltaShare <= 0.2 && value.rms >= 24));
  assert.ok(metrics.hoard.every((value) => value.deltaPixels >= 32 && value.deltaShare <= 0.2 && value.rms >= 24));
  assert.ok(metrics.warmHoardIoU <= 0.35);
  const sourcePngBytes = await syntheticLifecycleSourcePng(input);
  const terrainAuthority = rgba(256, 256, [68, 79, 62, 255]);
  const composedAuthority = rgba(768, 512, [33, 44, 55, 255]);
  const baselineA = { ...terrain, data: Buffer.from(terrain.data) };
  for (const layer of [baseA, homeActor]) compositeLayer(baselineA, layer);
  for (let y = 0; y < 160; y += 1) {
    baselineA.data.copy(composedAuthority.data, ((160 + y) * 768 + 128) * 4, y * 192 * 4, (y + 1) * 192 * 4);
  }
  const yardsAuthority = rgba(width * 5, height);
  for (const [cell, layer] of [baseA, baseB, warmOverlay, hoardOverlay].entries()) {
    for (let y = 0; y < height; y += 1) {
      layer.data.copy(yardsAuthority.data, ((y * yardsAuthority.width) + cell * width) * 4, y * width * 4, (y + 1) * width * 4);
    }
  }
  const authorityInput = {
    sourcePngBytes,
    terrainSourcePngBytes: await pngBytes(terrainAuthority),
    homeActorSourcePngBytes: await pngBytes(homeActor),
    topLevelTerrain: terrainAuthority,
    topLevelHomeActor: homeActor,
    yards: yardsAuthority,
    composedScene: composedAuthority,
  };
  assert.deepEqual(await validateSyntheticLifecycleOverlayControl(authorityInput), []);
  const wrongTerrainAuthority = Buffer.from(authorityInput.terrainSourcePngBytes);
  wrongTerrainAuthority[wrongTerrainAuthority.length - 8] ^= 1;
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, terrainSourcePngBytes: wrongTerrainAuthority })).join("\n"), /terrain-source-reconstruction-mismatch/);
  const wrongHomeAuthority = Buffer.from(authorityInput.homeActorSourcePngBytes);
  wrongHomeAuthority[wrongHomeAuthority.length - 8] ^= 1;
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, homeActorSourcePngBytes: wrongHomeAuthority })).join("\n"), /home-actor-source-reconstruction-mismatch/);
  const wrongTopTerrain = { ...terrainAuthority, data: Buffer.from(terrainAuthority.data) };
  setPixel(wrongTopTerrain, 255, 255, [67, 79, 62, 255]);
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, topLevelTerrain: wrongTopTerrain })).join("\n"), /terrain-source-binding-mismatch/);
  const wrongTopHomeActor = { ...homeActor, data: Buffer.from(homeActor.data) };
  setPixel(wrongTopHomeActor, 66, 54, [90, 70, 52, 255]);
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, topLevelHomeActor: wrongTopHomeActor })).join("\n"), /home-actor-binding-mismatch/);
  const wrongYards = { ...yardsAuthority, data: Buffer.from(yardsAuthority.data) };
  setPixel(wrongYards, 130, 132, [172, 128, 71, 255]);
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, yards: wrongYards })).join("\n"), /lifecycle-yard-binding-mismatch/);
  const wrongFullComposed = { ...composedAuthority, data: Buffer.from(composedAuthority.data) };
  setPixel(wrongFullComposed, 0, 0, [32, 44, 55, 255]);
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, composedScene: wrongFullComposed })).join("\n"), /lifecycle-composed-binding-mismatch/);
  const wrongReviewedCrop = { ...composedAuthority, data: Buffer.from(composedAuthority.data) };
  setPixel(wrongReviewedCrop, 128, 160, [255, 0, 0, 255]);
  assert.match((await validateSyntheticLifecycleOverlayControl({ ...authorityInput, composedScene: wrongReviewedCrop })).join("\n"), /lifecycle-composed-crop-mismatch/);
  for (const requiredAuthority of ["topLevelTerrain", "topLevelHomeActor", "yards", "composedScene"]) {
    const missingAuthority = { ...authorityInput };
    delete missingAuthority[requiredAuthority];
    assert.notDeepEqual(await validateSyntheticLifecycleOverlayControl(missingAuthority), [], requiredAuthority);
  }
  assert.match((await validateLifecycleOverlayComposites(input)).join("\n"), /lifecycle-source-descriptor-missing/);

  const invisible = rgba(width, height);
  assert.match(validateLifecycleOverlayMetrics({
    ...input,
    warmOverlay: invisible,
    warmComposites: [flatten(baseA, invisible), flatten(baseB, invisible)],
  }).join("\n"), /overlay-composite-delta: warm/);
  const repaint = rgba(width, height, [160, 73, 52, 255]);
  assert.match(validateLifecycleOverlayMetrics({
    ...input,
    warmOverlay: repaint,
    warmComposites: [flatten(baseA, repaint), flatten(baseB, repaint)],
  }).join("\n"), /overlay-localization: warm/);
  assert.match(validateLifecycleOverlayMetrics({
    ...input,
    hoardOverlay: warmOverlay,
    hoardComposites: input.warmComposites,
  }).join("\n"), /overlay-semantic-separation/);
  const forged = { ...input.warmComposites[0], data: Buffer.from(input.warmComposites[0].data) };
  setPixel(forged, 3, 3, [255, 0, 0, 255]);
  assert.match(validateLifecycleOverlayMetrics({ ...input, warmComposites: [forged, input.warmComposites[1]] }).join("\n"), /overlay-exact-flatten/);
  const wrongOrder = (base, overlay) => {
    const scene = { ...terrain, data: Buffer.from(terrain.data) };
    for (const layer of [base, homeActor, overlay]) compositeLayer(scene, layer);
    return scene;
  };
  assert.match(validateLifecycleOverlayMetrics({
    ...input,
    warmComposites: [wrongOrder(baseA, warmOverlay), wrongOrder(baseB, warmOverlay)],
  }).join("\n"), /overlay-exact-flatten/);
});

test("constructed-cluster control accepts source-bound joined supports and rejects isolated pickup scatter", async () => {
  const width = 96;
  const height = 72;
  const landmark = rectMask(width, height, 36, 18, 28, 28);
  const supportA = rectMask(width, height, 26, 28, 10, 12);
  const supportB = rectMask(width, height, 58, 43, 9, 12);
  const route = rectMask(width, height, 0, 53, width, 8);
  const landmarkLayer = layerFromMask(landmark, [113, 92, 64, 255]);
  const supportLayers = [layerFromMask(supportA, [87, 112, 73, 255]), layerFromMask(supportB, [76, 103, 69, 255])];
  const routeLayer = layerFromMask(route, [142, 127, 91, 255]);
  const scene = rgba(width, height, [55, 69, 57, 255]);
  for (const layer of [routeLayer, landmarkLayer, ...supportLayers]) compositeLayer(scene, layer);
  const baseLayer = rgba(width, height, [55, 69, 57, 255]);
  const valid = { width, height, baseLayer, scene, landmarkLayer, supportLayers, routeLayer };
  const metrics = analyzeConstructedCluster(valid);
  assert.ok(metrics.joinedToLandmarkCount >= 1);
  assert.ok(metrics.joinedToRouteCount >= 1);
  assert.ok(metrics.saliencyComponentCount <= 2);
  assert.ok(metrics.negativeWalkableShare >= 0.3);
  assert.match((await validateConstructedCluster(valid)).join("\n"), /cluster-source-descriptor-missing/);
  for (const inheritedKit of ["constructor", "toString", "__proto__"]) {
    assert.deepEqual(await validateConstructedCluster({ ...valid, kit: inheritedKit }), ["cluster-source-descriptor-missing: no reviewed R5 scenery source contract"]);
  }
  assert.deepEqual(await validateConstructedCluster({ kit: "worn-heartland", landmarkLayer: { data: new Uint8Array(1), width: 1, height: 1 } }), ["cluster-source-descriptor-missing: no reviewed R5 scenery source contract"]);
  const sourcePngBytes = await syntheticClusterSourcePng();
  assert.deepEqual(await validateSyntheticConstructedClusterControl({ baseLayer, scene, sourcePngBytes }), []);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene })).join("\n"), /cluster-source-byte-missing/);
  const mutatedSource = Buffer.from(sourcePngBytes);
  mutatedSource[mutatedSource.length - 8] ^= 1;
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene, sourcePngBytes: mutatedSource })).join("\n"), /cluster-source-digest-mismatch/);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene, sourcePngBytes, sourceDescriptors: [] })).join("\n"), /candidate source descriptors are forbidden/);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene, sourcePngBytes, landmarkLayer })).join("\n"), /candidate layers and inventory are forbidden/);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene, sourcePngBytes, layerInventory: [] })).join("\n"), /candidate layers and inventory are forbidden/);
  const sourceBoundMismatch = { ...scene, data: Buffer.from(scene.data) };
  setPixel(sourceBoundMismatch, 1, 1, [255, 0, 0, 255]);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer, scene: sourceBoundMismatch, sourcePngBytes })).join("\n"), /cluster-scene-authority-mismatch/);
  const forgedBase = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  const forgedSceneTogether = { ...scene, data: Buffer.from(scene.data) };
  setPixel(forgedBase, 1, 1, [1, 2, 3, 255]);
  setPixel(forgedSceneTogether, 1, 1, [1, 2, 3, 255]);
  assert.match((await validateSyntheticConstructedClusterControl({ baseLayer: forgedBase, scene: forgedSceneTogether, sourcePngBytes })).join("\n"), /cluster-(?:base|scene)-authority-mismatch/);

  const pickups = [
    rectMask(width, height, 4, 5, 3, 3),
    rectMask(width, height, 82, 8, 3, 3),
    rectMask(width, height, 8, 62, 3, 3),
    rectMask(width, height, 84, 62, 3, 3),
  ];
  const pickupLayers = pickups.map((value) => layerFromMask(value, [205, 172, 83, 255]));
  const scatteredScene = rgba(width, height, [55, 69, 57, 255]);
  for (const layer of [routeLayer, landmarkLayer, ...pickupLayers]) compositeLayer(scatteredScene, layer);
  const scattered = { width, height, baseLayer, scene: scatteredScene, landmarkLayer, supportLayers: pickupLayers, routeLayer };
  assert.match(validateConstructedClusterMetrics(scattered).join("\n"), /pickup-scatter/);
  const forged = { ...valid, supportLayers: valid.supportLayers.map((layer) => ({ ...layer, data: Buffer.alloc(layer.data.length) })) };
  assert.match(validateConstructedClusterMetrics(forged).join("\n"), /cluster-exact-flatten/);
  const legacyCandidateMasks = { ...valid, landmarkMask: landmark, routeMask: route };
  assert.match(validateConstructedClusterMetrics(legacyCandidateMasks).join("\n"), /candidate masks, thresholds, or denominators are forbidden/);
  const malformedLandmark = { ...valid, landmarkLayer: { width, height, data: new Uint8Array(3) } };
  assert.doesNotThrow(() => validateConstructedClusterMetrics(malformedLandmark));
  assert.match(validateConstructedClusterMetrics(malformedLandmark).join("\n"), /cluster-layer-binding: landmarkLayer/);

  const paddedSupport = { ...supportLayers[0], data: Buffer.from(supportLayers[0].data) };
  setPixel(paddedSupport, 2, 2, [87, 112, 73, 255]);
  const paddedScene = { ...scene, data: Buffer.from(scene.data) };
  setPixel(paddedScene, 2, 2, [87, 112, 73, 255]);
  assert.match(validateConstructedClusterMetrics({ ...valid, scene: paddedScene, supportLayers: [paddedSupport, supportLayers[1]] }).join("\n"), /support anatomy disconnected/);

  const farSupportMask = rectMask(width, height, 18, 28, 10, 12);
  const farSupport = layerFromMask(farSupportMask, [87, 112, 73, 255]);
  const farScene = rgba(width, height, [55, 69, 57, 255]);
  for (const layer of [routeLayer, landmarkLayer, farSupport, supportLayers[1]]) compositeLayer(farScene, layer);
  assert.match(validateConstructedClusterMetrics({ ...valid, scene: farScene, supportLayers: [farSupport, supportLayers[1]] }).join("\n"), /cluster-graph/);

  const genericGround = layerFromMask(rectMask(width, height, 0, 0, width, 40), [72, 88, 63, 255]);
  const groundScene = rgba(width, height, [55, 69, 57, 255]);
  for (const layer of [routeLayer, landmarkLayer, genericGround, supportLayers[1]]) compositeLayer(groundScene, layer);
  assert.match(validateConstructedClusterMetrics({ ...valid, scene: groundScene, supportLayers: [genericGround, supportLayers[1]] }).join("\n"), /generic-ground support/);
  assert.match(validateConstructedClusterMetrics({ ...valid, saliencyDenominator: 999999 }).join("\n"), /candidate masks, thresholds, or denominators are forbidden/);
  assert.match((await validateConstructedCluster({ ...valid, sourceDescriptors: [] })).join("\n"), /cluster-source-descriptor-missing|candidate/);
  const thinSupport = layerFromMask(rectMask(width, height, 35, 26, 1, 48), [87, 112, 73, 255]);
  const thinScene = rgba(width, height, [55, 69, 57, 255]);
  for (const layer of [routeLayer, landmarkLayer, thinSupport, supportLayers[1]]) compositeLayer(thinScene, layer);
  assert.match(validateConstructedClusterMetrics({ ...valid, scene: thinScene, supportLayers: [thinSupport, supportLayers[1]] }).join("\n"), /cluster-support-anatomy/);
});

test("ash identity requires source-bound connected pylon, cable, trefoil containment, and service structures", async () => {
  const width = 144;
  const height = 112;
  const pylonPoints = [];
  for (let y = 8; y <= 94; y += 1) {
    pylonPoints.push([32, y], [96, y]);
    if (y < 80 && y % 12 < 2) for (let x = 32; x <= 96; x += 1) pylonPoints.push([x, y]);
  }
  for (let i = 0; i <= 64; i += 1) {
    pylonPoints.push([32 + i, 16 + i], [96 - i, 16 + i]);
    if (i < 64) pylonPoints.push([33 + i, 16 + i], [95 - i, 16 + i]);
  }
  for (let y = 88; y <= 96; y += 1) for (let x = 26; x <= 38; x += 1) pylonPoints.push([x, y]);
  for (let y = 88; y <= 96; y += 1) for (let x = 90; x <= 102; x += 1) pylonPoints.push([x, y]);
  const cablePoints = [];
  for (let x = 8; x <= 136; x += 1) cablePoints.push([x, 12 + Math.floor((x - 8) / 24) % 2]);
  const reliefPoints = [];
  for (const [x, y, w, h] of [[101,36,12,12],[111,48,12,12],[101,60,12,12],[105,47,12,14],[97,52,10,4]]) {
    for (let py = y; py < y + h; py += 1) for (let px = x; px < x + w; px += 1) reliefPoints.push([px, py]);
  }
  const witnessMasks = [lineMask(width, height, pylonPoints), lineMask(width, height, cablePoints), lineMask(width, height, reliefPoints), rectMask(width, height, 8, 96, 128, 10)];
  const types = ["pylon-lattice", "cable-run", "containment-relief", "service-slab"];
  const witnesses = witnessMasks.map((value, index) => ({ type: types[index], layer: layerFromMask(value, [80 + index * 25, 72 + index * 18, 67 + index * 9, 255]) }));
  const baseLayer = rgba(width, height, [43, 42, 48, 255]);
  const scene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  for (const witness of witnesses) compositeLayer(scene, witness.layer);
  const input = { width, height, baseLayer, scene, witnesses };
  const metrics = analyzeAshIndustrialWitnesses(input);
  assert.equal(metrics.requiredTypeCount, 4);
  assert.ok(metrics.structurallyValidCount >= 4);
  assert.match((await validateAshIndustrialWitnesses(input)).join("\n"), /ash-source-descriptor-missing/);
  for (const inheritedKit of ["constructor", "toString", "__proto__"]) {
    assert.deepEqual(await validateAshIndustrialWitnesses({ ...input, kit: inheritedKit }), ["ash-source-descriptor-missing: no reviewed R5 ash raster source contract"]);
  }
  assert.deepEqual(await validateAshIndustrialWitnesses({ kit: "ash-waste", witnesses: [{ layer: { data: new Uint8Array(1), width: 1, height: 1 } }] }), ["ash-source-descriptor-missing: no reviewed R5 ash raster source contract"]);
  const sourcePngBytes = await syntheticAshSourcePng(witnesses.map(({ layer }) => layer), width, height);
  assert.deepEqual(await validateSyntheticAshIndustrialControl({ baseLayer, scene, sourcePngBytes }), []);
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene })).join("\n"), /ash-source-byte-missing/);
  const mutatedSource = Buffer.from(sourcePngBytes);
  mutatedSource[mutatedSource.length - 8] ^= 1;
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene, sourcePngBytes: mutatedSource })).join("\n"), /ash-source-digest-mismatch/);
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene, sourcePngBytes, sourceDescriptors: [] })).join("\n"), /candidate source descriptors are forbidden/);
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene, sourcePngBytes, witnesses })).join("\n"), /candidate layers and inventory are forbidden/);
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene, sourcePngBytes, layerInventory: [] })).join("\n"), /candidate layers and inventory are forbidden/);
  const sourceBoundMismatch = { ...scene, data: Buffer.from(scene.data) };
  setPixel(sourceBoundMismatch, 1, 1, [255, 0, 0, 255]);
  assert.match((await validateSyntheticAshIndustrialControl({ baseLayer, scene: sourceBoundMismatch, sourcePngBytes })).join("\n"), /ash-scene-authority-mismatch/);

  const decorative = witnesses.map((witness) => {
    const value = rectMask(width, height, 4, 4, 3, 3);
    return { ...witness, layer: layerFromMask(value, [90, 80, 70, 255]) };
  });
  assert.match(validateAshIndustrialMetrics({ width, height, baseLayer, scene, witnesses: decorative }).join("\n"), /ash-structural-preflight/);
  assert.match(validateAshIndustrialMetrics({ width, height, baseLayer, scene, witnesses: [] }).join("\n"), /ash-structural-preflight/);
  const forged = { ...input, witnesses: witnesses.map((witness) => ({ ...witness, layer: rgba(width, height) })) };
  assert.match(validateAshIndustrialMetrics(forged).join("\n"), /ash-exact-flatten|ash-omit-one/);
  const malformed = { ...input, witnesses: [{ ...witnesses[0], layer: { width, height, data: new Uint8Array(3) } }] };
  assert.doesNotThrow(() => validateAshIndustrialMetrics(malformed));
  assert.match(validateAshIndustrialMetrics(malformed).join("\n"), /ash-structural-preflight: malformed witness layer/);
  const livingLayer = { ...witnesses[2].layer, data: Buffer.from(witnesses[2].layer.data) };
  const livingPixel = witnessMasks[2].data.findIndex((value) => value === 1);
  livingLayer.data.set([...R5_ASH_FORBIDDEN_RGB[0], 255], livingPixel * 4);
  const livingScene = { ...scene, data: Buffer.from(scene.data) };
  livingScene.data.set([...R5_ASH_FORBIDDEN_RGB[0], 255], livingPixel * 4);
  const livingWitnesses = witnesses.map((witness, index) => index === 2 ? { ...witness, layer: livingLayer } : witness);
  assert.match(validateAshIndustrialMetrics({ ...input, scene: livingScene, witnesses: livingWitnesses }).join("\n"), /ash-forbidden-living-water-palette/);
  const omittedScene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  for (const witness of witnesses.slice(1)) compositeLayer(omittedScene, witness.layer);
  assert.match(validateAshIndustrialMetrics({ ...input, scene: omittedScene }).join("\n"), /ash-exact-flatten/);
  const isolatedRelief = layerFromMask(rectMask(width, height, 104, 42, 30, 34), [130, 108, 85, 255]);
  const isolatedScene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  for (const layer of [witnesses[0].layer, witnesses[1].layer, isolatedRelief, witnesses[3].layer]) compositeLayer(isolatedScene, layer);
  assert.match(validateAshIndustrialMetrics({ ...input, scene: isolatedScene, witnesses: [witnesses[0], witnesses[1], { type: "containment-relief", layer: isolatedRelief }, witnesses[3]] }).join("\n"), /farther than one pixel from its brace/);
  const diagonalPylonPoints = [];
  for (let i = 0; i < 82; i += 1) diagonalPylonPoints.push([24 + Math.floor(i * 64 / 81), 8 + i], [88 - Math.floor(i * 64 / 81), 8 + i]);
  const diagonalPylon = layerFromMask(lineMask(width, height, diagonalPylonPoints), [80, 72, 67, 255]);
  assert.equal(analyzeAshIndustrialWitnesses({ ...input, witnesses: [{ type: "pylon-lattice", layer: diagonalPylon }, ...witnesses.slice(1)] }).witnesses[0].structurallyValid, false);
  const closeFootPoints = [];
  for (let y = 8; y <= 82; y += 1) {
    closeFootPoints.push([32, y], [96, y]);
    if (y < 80 && y % 12 < 2) for (let x = 32; x <= 96; x += 1) closeFootPoints.push([x, y]);
  }
  for (let i = 0; i <= 64; i += 1) {
    closeFootPoints.push([32 + i, 16 + i], [96 - i, 16 + i]);
    if (i < 64) closeFootPoints.push([33 + i, 16 + i], [95 - i, 16 + i]);
  }
  for (let x = 32; x <= 49; x += 1) closeFootPoints.push([x, 82]);
  for (let x = 65; x <= 96; x += 1) closeFootPoints.push([x, 82]);
  for (let y = 82; y <= 90; y += 1) closeFootPoints.push([49, y], [65, y]);
  for (let y = 88; y <= 96; y += 1) for (let x = 44; x <= 54; x += 1) closeFootPoints.push([x, y]);
  for (let y = 88; y <= 96; y += 1) for (let x = 60; x <= 70; x += 1) closeFootPoints.push([x, y]);
  const closeFeetMask = lineMask(width, height, closeFootPoints);
  assert.equal(cardinalComponentCount(closeFeetMask), 1);
  const closeFeetLayer = layerFromMask(closeFeetMask, [80, 72, 67, 255]);
  assert.equal(analyzeAshIndustrialWitnesses({ ...input, witnesses: [{ type: "pylon-lattice", layer: closeFeetLayer }, ...witnesses.slice(1)] }).witnesses[0].structurallyValid, false);
  const disconnectedCable = layerFromMask(lineMask(width, height, Array.from({ length: 100 }, (_unused, x) => [x + 20, 2])), [105, 90, 76, 255]);
  const cableScene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  for (const layer of [witnesses[0].layer, disconnectedCable, witnesses[2].layer, witnesses[3].layer]) compositeLayer(cableScene, layer);
  assert.match(validateAshIndustrialMetrics({ ...input, scene: cableScene, witnesses: [witnesses[0], { type: "cable-run", layer: disconnectedCable }, witnesses[2], witnesses[3]] }).join("\n"), /cable is not connected/);
  const detachedService = layerFromMask(rectMask(width, height, 8, 102, 128, 10), [155, 126, 94, 255]);
  const serviceScene = { ...baseLayer, data: Buffer.from(baseLayer.data) };
  for (const layer of [witnesses[0].layer, witnesses[1].layer, witnesses[2].layer, detachedService]) compositeLayer(serviceScene, layer);
  assert.match(validateAshIndustrialMetrics({ ...input, scene: serviceScene, witnesses: [witnesses[0], witnesses[1], witnesses[2], { type: "service-slab", layer: detachedService }] }).join("\n"), /service slab is not connected/);
  for (const color of [[68,68,84],[100,92,108],[124,116,132],[184,76,76],[228,108,92],[244,156,116]]) {
    const paletteBase = rgba(width, height, [...color, 255]);
    const paletteScene = { ...paletteBase, data: Buffer.from(paletteBase.data) };
    for (const witness of witnesses) compositeLayer(paletteScene, witness.layer);
    assert.equal(analyzeAshIndustrialWitnesses({ ...input, baseLayer: paletteBase, scene: paletteScene }).unauthorizedColors.includes(color.join(",")), false);
  }
  const unknownBase = rgba(width, height, [1, 2, 3, 255]);
  const unknownScene = { ...unknownBase, data: Buffer.from(unknownBase.data) };
  for (const witness of witnesses) compositeLayer(unknownScene, witness.layer);
  assert.match(validateAshIndustrialMetrics({ ...input, baseLayer: unknownBase, scene: unknownScene }).join("\n"), /colors outside exact ash allowlist/);
});

test("key-scene human witnesses require all three roles and byte-visible production 48x64 humans", async () => {
  assert.deepEqual(R5_REQUIRED_HUMAN_WITNESS_ROLES, Object.freeze(["route-entry", "defining-landmark", "shelter-door"]));
  const human = await loadCanonicalProductionHuman();
  assert.equal(sha256(human.data), R5_PRODUCTION_HUMAN_CONTRACT.canonicalPatchSha256);
  const backgroundScene = rgba(768, 512, [70, 82, 68, 255]);
  const scene = { ...backgroundScene, data: Buffer.from(backgroundScene.data) };
  const positions = [[24, 83], [72, 99], [600, 371]];
  for (const [ox, oy] of positions) for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
    const offset = (y * human.width + x) * 4;
    if (human.data[offset + 3] === 0) continue;
    setPixel(scene, ox + x, oy + y, [...human.data.subarray(offset, offset + 4)]);
  }
  const input = { backgroundScene, scene, human, kit: "worn-heartland" };
  const clearOccluder = rgba(768, 512);
  const clearSourcePngBytes = await syntheticHumanSourcePng(backgroundScene, clearOccluder);
  const trustedInput = { scene, human, kit: "worn-heartland", controlId: "clear", sourcePngBytes: clearSourcePngBytes };
  assert.deepEqual(await validateSyntheticProductionHumanControl(trustedInput), []);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, witnesses: [{ role: "route-entry", x: 25, y: 83 }] })).join("\n"), /candidate backgrounds, occlusion, descriptors, and positions are forbidden/);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, occlusionMask: mask(48, 64) })).join("\n"), /candidate backgrounds, occlusion, descriptors, and positions are forbidden/);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, positions })).join("\n"), /candidate backgrounds, occlusion, descriptors, and positions are forbidden/);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, backgroundPatch: backgroundScene })).join("\n"), /candidate backgrounds, occlusion, descriptors, and positions are forbidden/);
  const erased = { ...scene, data: Buffer.from(scene.data) };
  fillRect(erased, positions[0][0], positions[0][1], 48, 64, [70, 82, 68, 255]);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: erased })).join("\n"), /post-human-mismatch/);
  const wrongHuman = { ...human, data: Buffer.from(human.data) };
  setPixel(wrongHuman, 20, 12, [255, 0, 0, 255]);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, human: wrongHuman })).join("\n"), /RGBA digest mismatch/);
  const hiddenScene = { ...scene, data: Buffer.from(scene.data) };
  fillRect(hiddenScene, positions[0][0], positions[0][1], 48, 54, [70, 82, 68, 255]);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: hiddenScene })).join("\n"), /post-human-mismatch/);
  const lightlyOccluded = { ...scene, data: Buffer.from(scene.data) };
  let hiddenOpaque = 0;
  for (let pixel = 0; pixel < human.width * human.height && hiddenOpaque < 24; pixel += 1) {
    if (human.data[pixel * 4 + 3] === 0) continue;
    const x = pixel % 48;
    const y = Math.floor(pixel / 48);
    setPixel(lightlyOccluded, positions[0][0] + x, positions[0][1] + y, [70, 82, 68, 255]);
    hiddenOpaque += 1;
  }
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: lightlyOccluded })).join("\n"), /post-human-mismatch/);
  const trustedOccluder = rgba(768, 512);
  let trustedOccludedPixels = 0;
  for (let pixel = 0; pixel < human.width * human.height && trustedOccludedPixels < 24; pixel += 1) {
    if (human.data[pixel * 4 + 3] === 0) continue;
    const x = pixel % 48;
    const y = Math.floor(pixel / 48);
    setPixel(trustedOccluder, positions[0][0] + x, positions[0][1] + y, [126, 92, 64, 255]);
    trustedOccludedPixels += 1;
  }
  const trustedOccludedScene = { ...scene, data: Buffer.from(scene.data) };
  compositeLayer(trustedOccludedScene, trustedOccluder);
  const occludedSourcePngBytes = await syntheticHumanSourcePng(backgroundScene, trustedOccluder);
  assert.deepEqual(await validateSyntheticProductionHumanControl({
    scene: trustedOccludedScene,
    human,
    kit: "worn-heartland",
    controlId: "occluded",
    sourcePngBytes: occludedSourcePngBytes,
  }), []);
  const extraFace = { ...scene, data: Buffer.from(scene.data) };
  for (const [x, y] of [[8, 11], [39, 11], [7, 14]]) setPixel(extraFace, positions[0][0] + x, positions[0][1] + y, [79, 45, 36, 255]);
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: extraFace })).join("\n"), /post-human-mismatch/);
  const forgedBackground = { ...backgroundScene, data: Buffer.from(backgroundScene.data) };
  const forgedScene = { ...scene, data: Buffer.from(scene.data) };
  for (const [x, y] of [[8, 11], [39, 11], [7, 14]]) {
    setPixel(forgedBackground, positions[0][0] + x, positions[0][1] + y, [79, 45, 36, 255]);
    setPixel(forgedScene, positions[0][0] + x, positions[0][1] + y, [79, 45, 36, 255]);
  }
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, backgroundScene: forgedBackground, scene: forgedScene })).join("\n"), /candidate backgrounds/);
  const extraHuman = { ...scene, data: Buffer.from(scene.data) };
  for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
    const offset = (y * human.width + x) * 4;
    if (human.data[offset + 3] > 0) setPixel(extraHuman, 300 + x, 300 + y, [...human.data.subarray(offset, offset + 4)]);
  }
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: extraHuman })).join("\n"), /post-human-mismatch/);
  const movedScene = { ...backgroundScene, data: Buffer.from(backgroundScene.data) };
  for (const [index, [ox, oy]] of positions.entries()) {
    const mx = index === 0 ? ox + 1 : ox;
    for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
      const offset = (y * human.width + x) * 4;
      if (human.data[offset + 3] > 0) setPixel(movedScene, mx + x, oy + y, [...human.data.subarray(offset, offset + 4)]);
    }
  }
  assert.match((await validateSyntheticProductionHumanControl({ ...trustedInput, scene: movedScene })).join("\n"), /human-role-anchor/);
  assert.match((await validateProductionHumanWitnesses(input)).join("\n"), /human-source-descriptor-missing/);
  for (const inheritedKit of ["constructor", "toString", "__proto__"]) {
    assert.deepEqual(await validateProductionHumanWitnesses({ ...input, kit: inheritedKit }), ["human-source-descriptor-missing: no reviewed R5 scene source contract"]);
  }
});

test("the 20 current R4 native-1x proofs remain a named negative fixture", async (context) => {
  const kits = ["ash-waste", "dry-scrub", "neutral-temperate", "spring-terraces", "worn-heartland"];
  const summary = {};
  for (const kit of kits) await context.test(kit, async () => {
    const assets = {};
    for (const family of ["terrain", "landmarks", "yards", "composed"]) {
      assets[family] = await decode(path.join(EVIDENCE, `task12r-r4-${kit}-${family}-native-1x.png`));
    }
    const result = await validateRegionalR5VisualSet({ kit, ...assets, scenery: rgba(512, 256), keySceneContract: null });
    assert.deepEqual(result.metrics.wallpaper.shifts.filter(({ axis }) => axis === "x").map(({ tilePairs }) => tilePairs), R5_PURE_GROUND_TILE_CONTRACTS[kit].shiftPairCounts.x);
    assert.deepEqual(result.metrics.wallpaper.shifts.filter(({ axis }) => axis === "y").map(({ tilePairs }) => tilePairs), R5_PURE_GROUND_TILE_CONTRACTS[kit].shiftPairCounts.y);
    const joined = result.errors.join("\n");
    assert.match(joined, new RegExp(`cluster-not-pixel-connected: ${kit}/actual-composed-pickup-scatter`), `${kit}: actual composed gate missing`);
    for (const required of ["landmark-flat-material", "terrain-phase-locked-motif", "yard-three-sided-wrap", "yard-overlay-not-visible", "cluster-not-pixel-connected", "production-human-witness-missing"]) {
      assert.match(joined, new RegExp(required), `${kit}: ${joined}`);
    }
    if (result.metrics.wallpaper.maximumTileResidualAutocorrelation > 0.28) assert.match(joined, /terrain-rgb-periodicity/);
    if (kit === "ash-waste") assert.match(joined, /ash-industrial-raster-witness-missing/);
    summary[kit] = {
      flatLandmarkCells: result.metrics.landmark.filter((value) => value.opaqueColorCount < 4).length,
      wallpaper: {
        raw: Number(result.metrics.wallpaper.maximumAutocorrelation.toFixed(4)),
        residual: Number(result.metrics.wallpaper.maximumTileResidualAutocorrelation.toFixed(4)),
        p32: Number(result.metrics.wallpaper.p32.toFixed(4)),
      },
      yardWrapStates: result.metrics.yards.filter((value) => value.threeSidedWrap).length,
      overlayCoverage: result.metrics.overlays.map((value) => Number(value.alphaCoverage.toFixed(6))),
      pickupComponents: result.metrics.pixelScatter.pickupComponents,
      pickupComponentShare: Number(result.metrics.pixelScatter.pickupComponentShare.toFixed(4)),
    };
  });
  context.diagnostic(`R4 metrics ${JSON.stringify(summary)}`);
});

test("regional visual aggregate is fail-closed, invokes coupled evidence, and uses only closed stable diagnostics", async () => {
  assert.deepEqual(R5_STABLE_DIAGNOSTIC_NAMES, [
    "landmark-flat-material",
    "terrain-rgb-periodicity",
    "terrain-phase-locked-motif",
    "yard-three-sided-wrap",
    "yard-overlay-not-visible",
    "cluster-not-pixel-connected",
    "ash-industrial-raster-witness-missing",
    "production-human-witness-missing",
  ]);
  const hostileProxy = new Proxy({}, { get() { throw new Error("hostile getter"); } });
  const malformedCases = [undefined, null, [], "ash-waste", {}, Object.create(null), hostileProxy, { kit: 7 }, { kit: "ash-waste" }, {
    kit: "ash-waste",
    terrain: { width: 1, height: 1, data: new Uint8Array(3) },
    landmarks: null,
    yards: null,
    composed: null,
    keySceneContract: { lifecycleOverlays: 42 },
  }];
  for (const candidate of malformedCases) {
    await assert.doesNotReject(() => validateRegionalR5VisualSet(candidate));
    const malformedResult = await validateRegionalR5VisualSet(candidate);
    assert.ok(malformedResult && Array.isArray(malformedResult.errors));
    assert.ok(malformedResult.metrics && typeof malformedResult.metrics === "object");
    for (const error of malformedResult.errors) {
      assert.ok(R5_STABLE_DIAGNOSTIC_NAMES.some((name) => error.startsWith(`${name}:`)), error);
    }
  }

  const assets = {};
  for (const family of ["terrain", "landmarks", "yards", "composed"]) {
    assets[family] = await decode(path.join(EVIDENCE, `task12r-r4-ash-waste-${family}-native-1x.png`));
  }
  const result = await validateRegionalR5VisualSet({
    kit: "ash-waste",
    ...assets,
    keySceneContract: { lifecycleOverlays: { terrain: null } },
  });
  const joined = result.errors.join("\n");
  for (const name of R5_STABLE_DIAGNOSTIC_NAMES) {
    assert.match(joined, new RegExp(name));
  }
  assert.match(joined, /yard-overlay-not-visible: ash-waste\/coupled-composites-invalid/);
  assert.match(joined, /cluster-not-pixel-connected: ash-waste\/top-level-scenery-missing/);
  const unrelatedSidecar = await validateRegionalR5VisualSet({
    kit: "ash-waste",
    ...assets,
    scenery: rgba(512, 256, [1, 2, 3, 255]),
    keySceneContract: { clusterWitness: { scene: rgba(768, 512, [9, 8, 7, 255]) } },
  });
  assert.match(unrelatedSidecar.errors.join("\n"), /cluster-not-pixel-connected: ash-waste\/cluster-sidecar-composed-mismatch/);
  for (const error of result.errors) assert.ok(R5_STABLE_DIAGNOSTIC_NAMES.some((name) => error.startsWith(`${name}:`)), error);
  for (const oldAlias of ["landmark-material-depth", "terrain-accent-speckle", "yard-coverage", "pickup-scatter", "ash-structural-preflight", "human-scale-witness"]) {
    assert.equal(result.errors.some((error) => error.startsWith(`${oldAlias}:`)), false, oldAlias);
  }

  const salt = singletonSaltProductionScene();
  assert.deepEqual(validateComposedPixelAutocorrelation(salt, { kit: "worn-heartland" }).map((error) => error.split(":")[0]), ["terrain-accent-speckle"]);
  const saltAssets = {};
  for (const family of ["terrain", "landmarks", "yards"]) {
    saltAssets[family] = await decode(path.join(EVIDENCE, `task12r-r4-worn-heartland-${family}-native-1x.png`));
  }
  const saltAggregate = await validateRegionalR5VisualSet({ kit: "worn-heartland", ...saltAssets, scenery: rgba(512, 256), composed: salt, keySceneContract: null });
  assert.match(saltAggregate.errors.join("\n"), /terrain-phase-locked-motif: worn-heartland/);
  const tinyTerrainAggregate = await validateRegionalR5VisualSet({
    kit: "worn-heartland",
    ...saltAssets,
    terrain: rgba(1, 1, [68, 79, 62, 255]),
    scenery: rgba(512, 256),
    composed: salt,
    keySceneContract: null,
  });
  assert.match(tinyTerrainAggregate.errors.join("\n"), /terrain-rgb-periodicity: worn-heartland\/top-level-terrain-authority-mismatch/);
});
