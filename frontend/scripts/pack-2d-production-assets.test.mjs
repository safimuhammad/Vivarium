import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import sharp from "sharp";
import ts from "typescript";

import * as productionPacker from "./pack-2d-production-assets.mjs";
import {
  REGIONAL_R5_ATLAS_AUTHORING_PLANS,
  REGIONAL_R5_AUTHORING_KITS,
  REGIONAL_R5_CROPS,
  REGIONAL_R5_KEY_SCENES,
  REGIONAL_R5_LITERAL_PATCHES,
  REGIONAL_R5_MECHANICS_BINDINGS,
  REGIONAL_R5_PALETTES,
} from "./regional-art-r5-authoring-spec.mjs";
import {
  analyzeComposedPixelSpatialVariety,
  validateComposedPixelAutocorrelation,
  validateConstructedClusterMetrics,
  validateLandmarkMaterialDepth,
} from "./regional-art-r5-visual-contract.mjs";

import {
  FROZEN_SLICE_HASHES,
  analyzeDirectionalFacePlanes,
  analyzeRuntimeAtlas,
  buildProductionPackingReport,
  canonicalizeProductionInventory,
  validateAssetBudgets,
  validateClipInventory,
  validateFrozenSliceReferences,
  validateProductionPackingReport,
} from "./pack-2d-production-assets.mjs";

const validateResponsiveEvidenceLayout = productionPacker.validateResponsiveEvidenceLayout;

const FROZEN_ASSET_ROOT = new URL("../src/assets/renderer2d/", import.meta.url);
const NATIVE_ASSET_ROOT = new URL("../../scratchpad/2d-production-art/source/native/", import.meta.url);
const REGION_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png",
  import.meta.url,
);
const HOME_RUIN_GUIDE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png",
  import.meta.url,
);
const EVIDENCE_ROOT = new URL("../../scratchpad/2d-production-art/evidence/", import.meta.url);
const PACKING_REPORT = new URL("packing-report.json", EVIDENCE_ROOT);
const VISUAL_REVIEW_MATRIX = new URL("visual-review-matrix.json", EVIDENCE_ROOT);
const NATIVE_CONTRACT = new URL("production-native-contract.json", NATIVE_ASSET_ROOT);
const APPROVED_WORN_LANDMARK_CANDIDATE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
  import.meta.url,
);
const RUNTIME_CORE_SOURCE = new URL(
  "../src/assets/renderer2d/core/production-core-source.json",
  import.meta.url,
);
const PACKER_SOURCE = new URL("./pack-2d-production-assets.mjs", import.meta.url);
const TASK_REPORT = new URL(
  "../../.superpowers/sdd/2d-production-task-8-assets-report.md",
  import.meta.url,
);
const FRONTEND_NODE_MODULES = new URL("../node_modules/", import.meta.url);
const REGION_KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
];
const TARGETED_NEUTRAL_PALETTE_TOKENS = new Map([
  ...[
    "meadow-ledge-wide", "meadow-ledge-small", "field-boundary-ridge",
    "plain-boundary-gate", "sage-field-mass", "plain-boundary-rail", "plain-boundary-gap",
  ].map((name) => [
    `r5-regional/neutral-temperate/${name}`,
    ["sage-dark", "sage-mid", "pale-lane"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/broad-tree/${ordinal}`,
    ["sage-dark", "sage-mid", "blue-green"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/field-rock/${ordinal}`,
    ["sage-dark", "field-stone", "pale-lane"],
  ]),
  ...[0, 1, 2, 3].map((ordinal) => [
    `r5-safe/neutral-temperate/wildflower/${ordinal}`,
    ["sage-dark", "sage-mid", "wildflower"],
  ]),
]);
const REMEDIATED_SOURCE_MASTER_HASHES = {
  "ash-waste-terrain": {
    rgba: "5e73792bd0c81d1cae3819d7c7455cf4e90d9e8b800240778f87ee9bdaf9206f",
    png: "5f93af62bddf992306d0abc84bfa022504e35807302761b6e4c5debdedbba474",
  },
  "neutral-temperate-terrain": {
    rgba: "063b6b355be51d3afa5ddfdf69fcaff72710481d8c1fd9bfce4f4bd9a74f034f",
    png: "76a56e981090b9c9ab7c3587a7a2dd4e4a0977c5b239a21bb69ac475e0a0dd68",
  },
  "neutral-temperate-scenery": {
    rgba: "38bc0dfcab0e20999ca4fab7b6ff3e2a508d5d45b4323c09e7c4c0a155fd5f3b",
    png: "e200784330fee20f56f31b58445f11bb85c0ceb7a7744c2243fa19296de99431",
  },
  "neutral-temperate-landmarks": {
    rgba: "793497a4e1d9fbf53ad2cc96cd1580f4053e8df16daa4c5112c8e929e50b0060",
    png: "768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2",
  },
};
const REGIONAL_COMPOSITION_ATLASES = Object.freeze(REGION_KITS.flatMap((kit) => [
  {
    id: `${kit}-landmarks`,
    relativePath: `regions/${kit}/landmarks.png`,
    width: 512,
    height: 256,
    cellWidth: 128,
    cellHeight: 128,
    cells: 8,
  },
  {
    id: `${kit}-home-yards`,
    relativePath: `homes/${kit}/yards.png`,
    width: 960,
    height: 160,
    cellWidth: 192,
    cellHeight: 160,
    cells: 5,
  },
]));
const execFileAsync = promisify(execFile);
const DIRECTIONS = ["south", "east", "north", "west"];
const ACTIONS = [
  "idle",
  "walk",
  "run",
  "turn",
  "stop",
  "reach-give",
  "work",
  "hurt-fall",
  "prone",
  "dead",
];
const EXPRESSIONS = [
  "neutral",
  "blink-1",
  "blink-2",
  "talk-1",
  "talk-2",
  "weary",
  "hurt",
  "recovery",
];
const HAIR_SILHOUETTES = [
  "crop",
  "messy",
  "waves",
  "bob",
  "braid",
  "bun",
  "coils",
  "short-curls",
];
const HAIR_PHASES = 6;
const PERMITTED_HAIR_RGB = new Set([
  "28,28,36", // normalized exposed outline
  "36,24,28", // authored deep-hair decoration
  "44,24,24",
  "65,43,33",
  "68,44,36", // authored mid-hair decoration
  "79,55,41",
  "97,63,45",
  "111,72,51",
  "135,92,64",
]);

const atlasCellOffset = (raw, cellIndex, x, y) => (
  ((Math.floor(cellIndex / 16) * 64 + y) * raw.info.width
    + (cellIndex % 16) * 48 + x) * 4
);

const opaqueCellCentroid = (raw, cellIndex) => {
  let xTotal = 0;
  let yTotal = 0;
  let pixels = 0;
  let minX = 48;
  let maxX = -1;
  let minY = 64;
  let maxY = -1;
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      if (raw.data[atlasCellOffset(raw, cellIndex, x, y) + 3] === 0) continue;
      xTotal += x;
      yTotal += y;
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  assert.ok(pixels > 0, `hair cell ${cellIndex} must be nonempty`);
  return { x: xTotal / pixels, y: yTotal / pixels, minX, maxX, minY, maxY };
};

const rgbaPng = async (width, height, pixelAt) => {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgba = pixelAt(x, y);
      data.set(rgba, (y * width + x) * 4);
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
};

const outlinedCell = async ({
  alpha = 255,
  fourthShade = false,
  doubleOutline = false,
  missingOutline = false,
  unknownColor = false,
} = {}) =>
  rgbaPng(8, 8, (x, y) => {
    if (x === 0 || y === 0 || x === 7 || y === 7) return [0, 0, 0, 0];
    const boundary = x === 1 || y === 1 || x === 6 || y === 6;
    const innerOutline = doubleOutline && (x === 2 || y === 2 || x === 5 || y === 5);
    if ((boundary || innerOutline) && !(missingOutline && x === 1 && y === 3)) {
      return [24, 20, 18, alpha];
    }
    if (unknownColor && x === 3 && y === 3) return [255, 0, 255, 255];
    const shades = fourthShade
      ? [[80, 48, 32, 255], [104, 64, 40, 255], [128, 80, 48, 255], [152, 96, 56, 255]]
      : [[80, 48, 32, 255], [104, 64, 40, 255], [128, 80, 48, 255]];
    return shades[(x + y) % shades.length];
  });

const atlasContract = (overrides = {}) => ({
  id: "test-atlas",
  width: 8,
  height: 8,
  cellWidth: 8,
  cellHeight: 8,
  columns: 1,
  rows: 1,
  sourceCellWidth: 8,
  sourceCellHeight: 8,
  outlineColors: [[24, 20, 18]],
  materialRamps: { cloth: [[80, 48, 32], [104, 64, 40], [128, 80, 48]] },
  outlineCornerExceptions: [],
  frames: [{
    id: "idle",
    rect: { x: 0, y: 0, width: 8, height: 8 },
    feet: { x: 4, y: 6 },
    detectedFeet: { x: 4, y: 6 },
    faceAnchor: { x: 4, y: 3 },
    detectedFaceAnchor: { x: 4, y: 3 },
    heldAnchor: { x: 6, y: 4 },
    detectedHeldAnchor: { x: 6, y: 4 },
  }],
  ...overrides,
});

const runSandboxPacker = async (root, args) => {
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(root, "frontend/scripts/pack-2d-production-assets.mjs"), ...args],
      { cwd: root, maxBuffer: 10 * 1024 * 1024 },
    );
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      code: typeof error.code === "number" ? error.code : 1,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? String(error),
    };
  }
};

const createPackerSandbox = async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vivarium-task8-contract-red-")));
  await mkdir(path.join(root, "frontend/scripts"), { recursive: true });
  await mkdir(path.join(root, "frontend/src/assets"), { recursive: true });
  await mkdir(path.join(root, "scratchpad/2d-production-art/source"), { recursive: true });
  await mkdir(path.join(root, "scratchpad/2d-production-art/source/imagegen-concepts"), { recursive: true });
  await mkdir(path.join(root, "scratchpad/2d-production-art"), { recursive: true });
  await copyFile(fileURLToPath(PACKER_SOURCE), path.join(root, "frontend/scripts/pack-2d-production-assets.mjs"));
  for (const dependency of [
    "regional-art-r4-spec.mjs",
    "regional-art-r5-atlas-only-scene.mjs",
    "regional-art-r5-atlas-reauthor.mjs",
    "regional-art-r5-authoring-spec.mjs",
    "regional-art-r5-blind-repair-sources.mjs",
    "regional-art-r5-visual-contract.mjs",
  ]) {
    await copyFile(
      fileURLToPath(new URL(dependency, import.meta.url)),
      path.join(root, "frontend/scripts", dependency),
    );
  }
  await cp(fileURLToPath(FROZEN_ASSET_ROOT), path.join(root, "frontend/src/assets/renderer2d"), { recursive: true });
  await cp(fileURLToPath(NATIVE_ASSET_ROOT), path.join(root, "scratchpad/2d-production-art/source/native"), { recursive: true });
  await copyFile(
    fileURLToPath(REGION_GUIDE),
    path.join(root, "scratchpad/2d-production-art/source/imagegen-concepts/region-kits-imagegen-guide.png"),
  );
  await copyFile(
    fileURLToPath(HOME_RUIN_GUIDE),
    path.join(root, "scratchpad/2d-production-art/source/imagegen-concepts/home-ruin-imagegen-guide.png"),
  );
  await cp(fileURLToPath(EVIDENCE_ROOT), path.join(root, "scratchpad/2d-production-art/evidence"), { recursive: true });
  await symlink(fileURLToPath(FRONTEND_NODE_MODULES), path.join(root, "frontend/node_modules"), "dir");
  return root;
};

const mutateInteriorPixel = async (filename, { alpha = 255 } = {}) => {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let changed = false;
  for (let y = 1; y < info.height - 1 && !changed; y += 1) {
    for (let x = 1; x < info.width - 1 && !changed; x += 1) {
      const offset = (y * info.width + x) * 4;
      const neighbors = [offset - 4, offset + 4, offset - info.width * 4, offset + info.width * 4];
      if (data[offset + 3] !== 255 || neighbors.some((neighbor) => data[neighbor + 3] !== 255)) continue;
      const donor = neighbors.find((neighbor) =>
        data[neighbor] !== data[offset]
        || data[neighbor + 1] !== data[offset + 1]
        || data[neighbor + 2] !== data[offset + 2]);
      if (donor === undefined) continue;
      data[offset] = data[donor];
      data[offset + 1] = data[donor + 1];
      data[offset + 2] = data[donor + 2];
      data[offset + 3] = alpha;
      changed = true;
    }
  }
  assert.equal(changed, true, `expected an opaque interior pixel in ${filename}`);
  await writeFile(filename, await sharp(data, { raw: info }).png({
    palette: true,
    colours: 64,
    dither: 0,
    compressionLevel: 9,
    adaptiveFiltering: false,
  }).toBuffer());
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const rewriteNativeAtlasPixels = async (filename, edits) => {
  const { data, info } = await sharp(filename).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const { index, x, y, rgba } of edits) {
    const originX = (index % 16) * 48;
    const originY = Math.floor(index / 16) * 64;
    const offset = ((originY + y) * info.width + originX + x) * 4;
    assert.equal(data[offset + 3], 255, `${filename} cell=${index} (${x},${y}) must remain inside the opaque face plane`);
    data.set(rgba, offset);
  }
  await writeFile(filename, await sharp(data, { raw: info }).png({
    palette: false,
    compressionLevel: 9,
    adaptiveFiltering: false,
  }).toBuffer());
};

const refreshPersistedSourceHash = async (sandbox, atlasId, relativePath) => {
  const contractPath = path.join(
    sandbox,
    "scratchpad/2d-production-art/source/native/production-native-contract.json",
  );
  const sourcePath = path.join(sandbox, "scratchpad/2d-production-art/source/native", relativePath);
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const sourceHash = sha256(await readFile(sourcePath));
  contract.atlases[atlasId].sourceSha256 = sourceHash;
  if (atlasId === "core-human-face-planes") {
    for (const plane of Object.values(contract.facePlanes)) plane.measuredFromSha256 = sourceHash;
  }
  if (atlasId === "core-human-body-rigs") {
    for (const frame of contract.atlases[atlasId].frames) frame.measuredFromSha256 = sourceHash;
    for (const plane of Object.values(contract.bodyFacePlanes)) plane.measuredFromSha256 = sourceHash;
  }
  await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
};

const semanticMaskHash = (raw, plane) => {
  const categories = ["eyes", "nose", "mouth"];
  const measured = Object.fromEntries(categories.map((category) => [category,
    plane.semanticFeatureMask[category].map(({ x, y }) => {
      const originX = (plane.cellIndex % 16) * 48;
      const originY = Math.floor(plane.cellIndex / 16) * 64;
      const offset = ((originY + y) * raw.info.width + originX + x) * 4;
      return { x, y, rgba: [...raw.data.subarray(offset, offset + 4)] };
    }),
  ]));
  return sha256(Buffer.from(JSON.stringify(measured)));
};

const semanticPointsInCell = (raw, cellIndex, colors) => {
  const keys = new Set(colors.map((color) => color.join(",")));
  const points = [];
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      const offset = atlasCellOffset(raw, cellIndex, x, y);
      const key = raw.data[offset + 3] === 255
        ? `${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`
        : null;
      if (key !== null && keys.has(key)) points.push({ x, y });
    }
  }
  return points;
};

const connectedComponents = (points) => {
  const remaining = new Set(points.map(({ x, y }) => `${x},${y}`));
  const components = [];
  while (remaining.size > 0) {
    const seed = remaining.values().next().value;
    const queue = [seed];
    const component = [];
    remaining.delete(seed);
    while (queue.length > 0) {
      const key = queue.shift();
      const [x, y] = key.split(",").map(Number);
      component.push({ x, y });
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (!remaining.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
};

const average = (points, axis) => points.reduce((sum, point) => sum + point[axis], 0) / points.length;

const tileSetIsCardinallyConnected = (tiles) => {
  if (tiles.length === 0) return false;
  const remaining = new Set(tiles.map(({ x, y }) => `${x},${y}`));
  const queue = [remaining.values().next().value];
  remaining.delete(queue[0]);
  while (queue.length > 0) {
    const key = queue.shift();
    const [x, y] = key.split(",").map(Number);
    for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
      if (!remaining.delete(neighbor)) continue;
      queue.push(neighbor);
    }
  }
  return remaining.size === 0;
};

const rgbaPointsForPalette = (raw, colors) => {
  const keys = new Set(colors.map((color) => color.join(",")));
  const points = [];
  for (let y = 0; y < raw.info.height; y += 1) for (let x = 0; x < raw.info.width; x += 1) {
    const offset = (y * raw.info.width + x) * 4;
    if (raw.data[offset + 3] !== 255) continue;
    if (keys.has(`${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`)) points.push({ x, y });
  }
  return points;
};

const cellTextureStats = (raw, cellIndex, columns, width, height) => {
  const originX = cellIndex % columns * width;
  const originY = Math.floor(cellIndex / columns) * height;
  const frequencies = new Map();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = ((originY + y) * raw.info.width + originX + x) * 4;
    const key = `${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}`;
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const dominant = [...frequencies.entries()].sort((left, right) => right[1] - left[1])[0][0];
  const texturePoints = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = ((originY + y) * raw.info.width + originX + x) * 4;
    if (`${raw.data[offset]},${raw.data[offset + 1]},${raw.data[offset + 2]}` !== dominant) texturePoints.push({ x, y });
  }
  const components = connectedComponents(texturePoints);
  return {
    colors: frequencies.size,
    texturePixels: texturePoints.length,
    componentCount: components.length,
    singletonRatio: components.filter((component) => component.length === 1).length / Math.max(1, texturePoints.length),
    largestCluster: Math.max(0, ...components.map((component) => component.length)),
  };
};

const rowWidthVariation = (tiles) => {
  const rows = new Map();
  for (const { x, y } of tiles) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(x);
  }
  return [...rows.entries()].sort((left, right) => left[0] - right[0]).map(([y, xs]) => ({
    y,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    cells: xs.length,
  }));
};

const canonicalOracleValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalOracleValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalOracleValue(value[key])]));
  }
  return value;
};

const oracleHash = (value) => sha256(Buffer.from(JSON.stringify(canonicalOracleValue(value))));

const rawAtlasCellBytes = (raw, cellIndex, columns, cellWidth, cellHeight) => {
  const bytes = Buffer.alloc(cellWidth * cellHeight * 4);
  const originX = cellIndex % columns * cellWidth;
  const originY = Math.floor(cellIndex / columns) * cellHeight;
  for (let y = 0; y < cellHeight; y += 1) {
    const sourceStart = ((originY + y) * raw.info.width + originX) * 4;
    raw.data.copy(bytes, y * cellWidth * 4, sourceStart, sourceStart + cellWidth * 4);
  }
  return bytes;
};

const paletteNormalizedCell = (bytes) => {
  const colors = new Map();
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset + 3] === 0) continue;
    const key = `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`;
    if (!colors.has(key)) {
      colors.set(key, bytes[offset] * 299 + bytes[offset + 1] * 587 + bytes[offset + 2] * 114);
    }
  }
  const ordered = [...colors.entries()].sort((left, right) => left[1] - right[1]
    || left[0].localeCompare(right[0]));
  const ranks = new Map(ordered.map(([key], index) => [
    key,
    1 + Math.min(3, Math.floor(index * 4 / Math.max(1, ordered.length))),
  ]));
  const normalized = new Uint8Array(bytes.length / 4);
  for (let offset = 0; offset < bytes.length; offset += 4) {
    if (bytes[offset + 3] === 0) continue;
    normalized[offset / 4] = ranks.get(`${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`);
  }
  return normalized;
};

const normalizedIdentityRatio = (left, right) => {
  assert.equal(left.length, right.length, "compared cells require identical native geometry");
  let compared = 0;
  let identical = 0;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === 0 && right[index] === 0) continue;
    compared += 1;
    if (left[index] === right[index]) identical += 1;
  }
  return identical / Math.max(1, compared);
};

const assertDistinctCellFamily = (label, cells, { maximumIdentityRatio }) => {
  for (let leftIndex = 0; leftIndex < cells.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < cells.length; rightIndex += 1) {
      const left = cells[leftIndex];
      const right = cells[rightIndex];
      assert.notEqual(
        sha256(left.bytes),
        sha256(right.bytes),
        `${label}/${left.id}/${right.id}: duplicate raw cell bytes`,
      );
      const identity = normalizedIdentityRatio(
        paletteNormalizedCell(left.bytes),
        paletteNormalizedCell(right.bytes),
      );
      assert.ok(
        identity <= maximumIdentityRatio,
        `${label}/${left.id}/${right.id}: palette-normalized identity ${identity.toFixed(4)} exceeds ${maximumIdentityRatio}`,
      );
    }
  }
};

const assertCandidateTerrainBinding = async (preview) => {
  for (const kit of REGION_KITS) {
    const id = `${kit}-terrain`;
    const buffer = preview.buffers[id];
    assert.ok(Buffer.isBuffer(buffer), `${id}: candidate terrain buffer required`);
    const metadata = await sharp(buffer).metadata();
    assert.deepEqual([metadata.width, metadata.height], [256, 256], `${id}: exact native atlas geometry`);
    const contract = preview.nativeContract.atlases?.[id];
    assert.ok(contract, `${id}: candidate native-contract record required`);
    assert.deepEqual(
      [contract.width, contract.height, contract.cellWidth, contract.cellHeight],
      [256, 256, 32, 32],
      `${id}: native contract must bind the exact 8x8 grid of 32px cells`,
    );
    assert.deepEqual(
      [contract.width / contract.cellWidth, contract.height / contract.cellHeight],
      [8, 8],
      `${id}: native contract terrain grid dimensions`,
    );
    assert.equal(contract.sourceSha256, sha256(buffer), `${id}: sourceSha256 must bind candidate terrain bytes`);
    const raw = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let cellIndex = 0; cellIndex < 64; cellIndex += 1) {
      const bytes = rawAtlasCellBytes(raw, cellIndex, 8, 32, 32);
      let opaque = 0;
      let nonzeroTransparentRgb = 0;
      for (let offset = 0; offset < bytes.length; offset += 4) {
        if (bytes[offset + 3] === 255) opaque += 1;
        if (bytes[offset + 3] === 0 && (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0)) {
          nonzeroTransparentRgb += 1;
        }
      }
      if (cellIndex <= 35) {
        assert.equal(opaque, 32 * 32, `${id}/cell-${cellIndex}: assigned semantic terrain cell must be fully opaque`);
      } else {
        assert.equal(opaque, 0, `${id}/cell-${cellIndex}: unassigned terrain cell must remain transparent`);
        assert.equal(nonzeroTransparentRgb, 0, `${id}/cell-${cellIndex}: unassigned terrain cell forbids stale RGB bytes`);
      }
    }
  }
};

const assertVariantPixelDistinctness = async (preview, { maximumIdentityRatio }) => {
  await assertCandidateTerrainBinding(preview);
  for (const kit of REGION_KITS) {
    const landmarkRaw = await sharp(preview.buffers[`${kit}-landmarks`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const landmarkRecords = preview.nativeContract.atlases[`${kit}-landmarks`]?.authoredVariants ?? [];
    const byKind = new Map();
    for (const record of landmarkRecords) {
      if (!byKind.has(record.semanticKind)) byKind.set(record.semanticKind, []);
      byKind.get(record.semanticKind).push({
        id: record.variantId,
        bytes: rawAtlasCellBytes(landmarkRaw, record.cellIndex, 4, 128, 128),
      });
    }
    for (const [kind, cells] of byKind) {
      if (cells.length < 2) continue;
      assertDistinctCellFamily(`${kit}/landmark/${kind}`, cells, { maximumIdentityRatio });
    }

    const terrainRaw = await sharp(preview.buffers[`${kit}-terrain`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    assertDistinctCellFamily(`${kit}/ground`, Array.from({ length: 8 }, (_unused, cellIndex) => ({
      id: `ground-${cellIndex}`,
      bytes: rawAtlasCellBytes(terrainRaw, cellIndex, 8, 32, 32),
    })), { maximumIdentityRatio });

    const yardRaw = await sharp(preview.buffers[`${kit}-home-yards`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const yardCell = (cellIndex) => ({
      id: preview.nativeContract.atlases[`${kit}-home-yards`].authoredVariants[cellIndex].variantId,
      bytes: rawAtlasCellBytes(yardRaw, cellIndex, 5, 192, 160),
    });
    assertDistinctCellFamily(`${kit}/yard/base`, [yardCell(0), yardCell(1), yardCell(4)], {
      maximumIdentityRatio,
    });
    assertDistinctCellFamily(`${kit}/yard/overlay`, [yardCell(2), yardCell(3)], { maximumIdentityRatio });
  }
};

const normalizedPlanLayout = (entries) => entries.map(({ x, y }) => ({ x, y }))
  .sort((left, right) => left.y - right.y || left.x - right.x);

const assertUniquePlanHashes = (plans, keys) => {
  assert.deepEqual(Object.keys(plans).sort(), [...REGION_KITS].sort(), "R4 requires exactly five kit scene plans");
  for (const key of keys) {
    const hashes = REGION_KITS.map((kit) => {
      assert.ok(Array.isArray(plans[kit]?.[key]), `${kit}/${key}: explicit layout array required`);
      return oracleHash(normalizedPlanLayout(plans[kit][key]));
    });
    assert.equal(new Set(hashes).size, REGION_KITS.length, `${key}: every kit requires a unique layout hash`);
  }
};

const assertCandidateSpecBinding = (preview, regionalR4Spec) => {
  const recipes = regionalR4Spec.REGIONAL_R4_VARIANT_RECIPES;
  const scenePlans = regionalR4Spec.REGIONAL_R4_SCENE_PLANS;
  assert.deepEqual(Object.keys(recipes ?? {}).sort(), [...REGION_KITS].sort(),
    "R4 variant recipes must own exactly five kits");
  assert.deepEqual(Object.keys(scenePlans ?? {}).sort(), [...REGION_KITS].sort(),
    "R4 scene plans must own exactly five kits");
  assert.deepEqual(Object.keys(preview.recipeDigests ?? {}).sort(), [...REGION_KITS].sort(),
    "candidate must expose one recipeDigest record per kit");
  assert.deepEqual(Object.keys(preview.compositionPlans ?? {}).sort(), [...REGION_KITS].sort(),
    "candidate must expose one composition plan per kit");

  const digestsByField = Object.fromEntries(["terrain", "landmarks", "yards", "scene"]
    .map((field) => [field, []]));
  for (const kit of REGION_KITS) {
    const recipe = recipes[kit];
    assert.ok(recipe?.ground, `${kit}: explicit ground recipes required`);
    assert.ok(recipe?.landmarks, `${kit}: explicit landmark recipes required`);
    assert.ok(recipe?.yards, `${kit}: explicit yard recipes required`);
    const expected = {
      terrain: oracleHash(recipe.ground),
      landmarks: oracleHash(recipe.landmarks),
      yards: oracleHash(recipe.yards),
      scene: oracleHash(scenePlans[kit]),
    };
    for (const field of Object.keys(expected)) {
      const actual = preview.recipeDigests[kit]?.[field];
      assert.match(actual ?? "", /^[a-f0-9]{64}$/, `${kit}/${field}: recipe digest required`);
      assert.equal(actual, expected[field], `${kit}/${field}: recipe digest must canonically bind the R4 spec`);
      digestsByField[field].push(actual);
    }
    assert.deepEqual(
      canonicalOracleValue(preview.compositionPlans[kit]),
      canonicalOracleValue(scenePlans[kit]),
      `${kit}: candidate composition plan must canonically equal the R4 scene plan`,
    );
  }
  for (const [field, digests] of Object.entries(digestsByField)) {
    assert.equal(new Set(digests).size, REGION_KITS.length, `${field}: recipe digest must be unique per kit`);
  }
};

const rectanglesTouch = (left, right) => left.x <= right.x + right.width
  && left.x + left.width >= right.x
  && left.y <= right.y + right.height
  && left.y + left.height >= right.y;

const assertSemanticSupportContact = (preview) => {
  for (const kit of REGION_KITS) {
    const plan = preview.compositionPlans[kit];
    assert.ok(plan, `${kit}: R4 scene plan required`);
    const landmarkContract = preview.nativeContract.atlases?.[`${kit}-landmarks`];
    const sceneryContract = preview.nativeContract.atlases?.[`${kit}-scenery`];
    assert.deepEqual(
      [landmarkContract?.cellWidth, landmarkContract?.cellHeight],
      [128, 128],
      `${kit}: authoritative landmark cell geometry`,
    );
    assert.deepEqual(
      [sceneryContract?.cellWidth, sceneryContract?.cellHeight],
      [32, 32],
      `${kit}: authoritative support cell geometry`,
    );
    const landmarks = new Map();
    for (const landmark of plan.landmarks ?? []) {
      assert.match(landmark.variantId ?? "", new RegExp(`^${kit}:`), `${kit}: landmark variantId required`);
      assert.equal(Object.hasOwn(landmark, "contactBounds"), false,
        `${kit}/${landmark.variantId}: candidate-supplied contactBounds override is forbidden`);
      const geometry = landmarkContract.authoredVariants.find(({ variantId }) => variantId === landmark.variantId);
      assert.ok(geometry, `${kit}/${landmark.variantId}: validated authored geometry record required`);
      assert.equal(landmark.cell, geometry.cellIndex, `${kit}/${landmark.variantId}: candidate cell must match geometry`);
      assert.ok(Number.isInteger(landmark.x) && Number.isInteger(landmark.y),
        `${kit}/${landmark.variantId}: integer destination coordinates required`);
      assert.ok(geometry.contactPivotPx.x >= 0 && geometry.contactPivotPx.x < landmarkContract.cellWidth
        && geometry.contactPivotPx.y >= 0 && geometry.contactPivotPx.y < landmarkContract.cellHeight,
      `${kit}/${landmark.variantId}: authoritative contact pivot must remain inside its cell`);
      const contactX = landmark.x + geometry.contactPivotPx.x;
      const contactY = landmark.y + geometry.contactPivotPx.y;
      landmarks.set(landmark.variantId, {
        ...landmark,
        contactNeighborhood: {
          x: contactX - sceneryContract.cellWidth * 1.5,
          y: contactY - sceneryContract.cellHeight,
          width: sceneryContract.cellWidth * 3,
          height: sceneryContract.cellHeight * 2,
        },
      });
    }
    const supportsByOwner = new Map([...landmarks.keys()].map((variantId) => [variantId, []]));
    for (const support of plan.supports ?? []) {
      assert.match(support.clusterId ?? "", /^[a-z][a-z0-9-]*$/, `${kit}: support clusterId required`);
      assert.match(support.role ?? "", /^[a-z]+(?:-[a-z]+)*$/, `${kit}: semantic support role required`);
      assert.notEqual(support.role, "support", `${kit}: generic support role is forbidden`);
      assert.ok(landmarks.has(support.landmarkVariantId), `${kit}: support must name an owned landmarkVariantId`);
      const landmark = landmarks.get(support.landmarkVariantId);
      assert.equal(Object.hasOwn(support, "bounds"), false,
        `${kit}/${support.clusterId}: candidate-supplied support bounds override is forbidden`);
      assert.ok(Number.isInteger(support.x) && Number.isInteger(support.y),
        `${kit}/${support.clusterId}: integer support destination coordinates required`);
      assert.ok(Number.isInteger(support.cell) && support.cell >= 0
        && support.cell < sceneryContract.width / sceneryContract.cellWidth
          * (sceneryContract.height / sceneryContract.cellHeight),
      `${kit}/${support.clusterId}: support cell must exist in the authoritative scenery atlas`);
      const derivedBounds = {
        x: support.x,
        y: support.y,
        width: sceneryContract.cellWidth,
        height: sceneryContract.cellHeight,
      };
      assert.equal(rectanglesTouch(landmark.contactNeighborhood, derivedBounds), true,
        `${kit}/${support.clusterId}: support does not touch its landmark contact neighborhood`);
      supportsByOwner.get(support.landmarkVariantId).push(support);
    }
    for (const [variantId, supports] of supportsByOwner) {
      assert.ok(supports.length >= 2, `${kit}/${variantId}: requires at least two semantic support members`);
      assert.equal(new Set(supports.map(({ clusterId }) => clusterId)).size, 1,
        `${kit}/${variantId}: support members must share one explicit cluster`);
    }
  }
};

const binaryCorrelation = (pairs) => {
  let sumLeft = 0;
  let sumRight = 0;
  let sumBoth = 0;
  for (const [left, right] of pairs) {
    sumLeft += left;
    sumRight += right;
    sumBoth += left * right;
  }
  const count = pairs.length;
  const numerator = count * sumBoth - sumLeft * sumRight;
  const denominator = Math.sqrt(
    (count * sumLeft - sumLeft ** 2) * (count * sumRight - sumRight ** 2),
  );
  return denominator === 0 ? 1 : numerator / denominator;
};

const groundVariantsByCoordinate = (plan, kit) => {
  const grid = plan?.groundRecipeGrid;
  assert.ok(Array.isArray(grid), `${kit}: groundRecipeGrid array required`);
  assert.equal(grid.length, 16, `${kit}: groundRecipeGrid requires exactly 16 rows`);
  const output = new Map();
  for (const [y, row] of grid.entries()) {
    assert.ok(Array.isArray(row), `${kit}: groundRecipeGrid row ${y} must be an array`);
    assert.equal(row.length, 24, `${kit}: groundRecipeGrid row ${y} requires exactly 24 columns`);
    for (const [x, variant] of row.entries()) {
      assert.ok(Number.isInteger(variant) && variant >= 0 && variant <= 7,
        `${kit}: groundRecipeGrid ${x},${y} requires an integer variant 0-7`);
      output.set(`${x},${y}`, variant);
    }
  }
  return output;
};

const assertGroundMaskAutocorrelation = async (preview, { shifts, maximum }) => {
  for (const kit of REGION_KITS) {
    const raw = await sharp(preview.buffers[`${kit}-terrain`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const masks = Array.from({ length: 8 }, (_unused, cellIndex) => {
      const bytes = rawAtlasCellBytes(raw, cellIndex, 8, 32, 32);
      const frequencies = new Map();
      for (let offset = 0; offset < bytes.length; offset += 4) {
        const key = `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}`;
        frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
      }
      const dominant = [...frequencies].sort((left, right) => right[1] - left[1])[0][0];
      return Uint8Array.from({ length: 32 * 32 }, (_unused2, pixel) => {
        const offset = pixel * 4;
        return `${bytes[offset]},${bytes[offset + 1]},${bytes[offset + 2]}` === dominant ? 0 : 1;
      });
    });
    const groundByCoordinate = groundVariantsByCoordinate(preview.compositionPlans[kit], kit);
    assert.ok(groundByCoordinate.size >= 220, `${kit}: explicit groundRecipeGrid is required for autocorrelation`);
    for (const shift of shifts) for (const [dx, dy, axis] of [[shift, 0, "x"], [0, shift, "y"]]) {
      const pairs = [];
      for (const [key, leftVariant] of groundByCoordinate) {
        const [x, y] = key.split(",").map(Number);
        const rightVariant = groundByCoordinate.get(`${x + dx},${y + dy}`);
        if (rightVariant === undefined) continue;
        for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
          pairs.push([masks[leftVariant][pixel], masks[rightVariant][pixel]]);
        }
      }
      assert.ok(pairs.length >= 32 * 32, `${kit}: shift ${axis}${shift} needs enough ground-mask pairs`);
      const correlation = Math.abs(binaryCorrelation(pairs));
      assert.ok(correlation <= maximum,
        `${kit}: palette-normalized ground-mask autocorrelation ${axis}${shift}=${correlation.toFixed(4)} exceeds ${maximum}`);
    }
  }
};

test("Task12R R4 recipe interpreter renders exact rect and line footprints and fails closed", () => {
  const render = productionPacker.renderRegionalR4Recipe;
  assert.equal(typeof render, "function", "packer must export the strict R4 recipe interpreter");
  const materials = { ink: [17, 34, 51, 255] };
  const alphaCoordinates = (buffer, width) => {
    const coordinates = [];
    for (let offset = 0; offset < buffer.length; offset += 4) {
      if (buffer[offset + 3] === 255) coordinates.push(`${(offset / 4) % width},${Math.floor(offset / 4 / width)}`);
    }
    return coordinates;
  };
  const recipe = (operation) => ({ id: "oracle:recipe", operations: [operation] });

  assert.deepEqual(alphaCoordinates(render({
    width: 6,
    height: 5,
    materials,
    recipe: recipe({ kind: "rect", material: "ink", x: 1, y: 1, width: 2, height: 3 }),
  }), 6), ["1,1", "2,1", "1,2", "2,2", "1,3", "2,3"]);
  assert.deepEqual(alphaCoordinates(render({
    width: 6,
    height: 4,
    materials,
    recipe: recipe({ kind: "line", material: "ink", from: [1, 1], to: [4, 1], width: 1 }),
  }), 6), ["1,1", "2,1", "3,1", "4,1"]);
  assert.deepEqual(alphaCoordinates(render({
    width: 7,
    height: 5,
    materials,
    recipe: recipe({ kind: "line", material: "ink", from: [2, 2], to: [4, 2], width: 3 }),
  }), 7), [
    "1,1", "2,1", "3,1", "4,1", "5,1",
    "1,2", "2,2", "3,2", "4,2", "5,2",
    "1,3", "2,3", "3,3", "4,3", "5,3",
  ]);
  assert.deepEqual(alphaCoordinates(render({
    width: 6,
    height: 5,
    materials,
    recipe: recipe({ kind: "polygon", material: "ink", points: [[1, 1], [4, 1], [4, 3], [1, 3]] }),
  }), 6), ["1,1", "2,1", "3,1", "4,1", "1,2", "2,2", "3,2", "4,2"]);
  assert.deepEqual(alphaCoordinates(render({
    width: 7,
    height: 6,
    materials,
    recipe: recipe({ kind: "cluster", material: "ink", points: [[1, 1], [4, 3]] }),
  }), 7), ["1,1", "2,1", "1,2", "4,3", "5,3", "4,4"]);

  const renderHostile = (operation) => render({ width: 6, height: 5, materials, recipe: recipe(operation) });
  assert.throws(() => renderHostile({ kind: "ellipse", material: "ink", points: [[1, 1], [2, 2]] }),
    /Unknown R4 pixel operation/);
  assert.throws(() => renderHostile({ kind: "rect", material: "ink", x: 1, y: 1, width: 2, height: 2, extra: true }),
    /operation keys/);
  assert.throws(() => renderHostile({ kind: "rect", material: "ink", x: 1.5, y: 1, width: 2, height: 2 }),
    /integer/);
  assert.throws(() => renderHostile({ kind: "rect", material: "ink", x: 5, y: 1, width: 2, height: 2 }),
    /outside 6x5/);
  assert.throws(() => renderHostile({ kind: "line", material: "ink", from: [1, 1], to: [6, 1], width: 1 }),
    /outside 6x5/);
  assert.throws(() => renderHostile({ kind: "line", material: "missing", from: [1, 1], to: [2, 1], width: 1 }),
    /Unknown R4 material/);
  assert.throws(() => renderHostile({ kind: "polygon", material: "ink", points: [[1, 1], [2, 2]] }),
    /at least three points/);
  assert.throws(() => renderHostile({ kind: "polygon", material: "ink", points: [[1, 1], [2.5, 2], [3, 1]] }),
    /integer/);
  assert.throws(() => renderHostile({ kind: "cluster", material: "ink", points: [[1, 1], [6, 2]] }),
    /outside 6x5/);
});

test("Task12R R3 writer isolation permanently binds historical proof names to historical bytes", () => {
  const writer = productionPacker.writeRegionalR3Proofs;
  assert.equal(typeof writer, "function", "historical proof writer must remain inspectable");
  const source = writer.toString();
  assert.match(source, /buildRegionalR3DiagnosticAuthoring\(\)/,
    "R3/R3.1 proof writer must source the isolated historical candidate");
  assert.doesNotMatch(source, /buildRegionalCompositionAuthoring\(\)/,
    "primary R4 candidate bytes may never be written under R3/R3.1 evidence names");
  assert.match(source, /const scene = proofs\[kit\]/,
    "historical writer must use the historical builder's composed proof bytes");
  const r2Writer = productionPacker.writeAshCompositionProof;
  assert.equal(typeof r2Writer, "function", "R2 ash writer must remain inspectable");
  const r2Source = r2Writer.toString();
  assert.match(r2Source, /buildRegionalR3DiagnosticAuthoring\(\)/,
    "R2 ash proof names must source a historical candidate");
  assert.doesNotMatch(r2Source, /buildRegionalCompositionAuthoring\(\)/,
    "primary R4 candidate bytes may never be written under R2 evidence names");
  assert.match(r2Source, /const scene = proofs\["ash-waste"\]/,
    "R2 ash writer must use the historical builder's composed ash proof");
});

test("Task12R R4 proof writer rejects an invalid candidate before filesystem or evidence work", async () => {
  const calls = [];
  const forbidden = (name) => async () => { calls.push(name); throw new Error(`forbidden ${name}`); };
  await assert.rejects(
    productionPacker.writeRegionalR4Proofs({
      candidateBuilder: async () => ({ sentinel: "invalid-candidate" }),
      candidateValidator: async () => ["oracle-invalid-candidate"],
      evidenceBuilder: forbidden("evidenceBuilder"),
      destinationRoot: path.join(tmpdir(), "forbidden-real-proof-root"),
      fileOperations: {
        mkdir: forbidden("mkdir"),
        readFile: forbidden("readFile"),
        writeFile: forbidden("writeFile"),
        rename: forbidden("rename"),
        rm: forbidden("rm"),
      },
    }),
    /oracle-invalid-candidate/,
  );
  assert.deepEqual(calls, [], "validation failure must precede evidence generation and every filesystem operation");
});

test("Task12R R4 atomic proof publication removes a partial mid-write temp", async () => {
  const publish = productionPacker.publishProofEvidenceAtomically;
  assert.equal(typeof publish, "function", "testable atomic proof helper required");
  const root = await mkdtemp(path.join(tmpdir(), "vivarium-r4-proof-write-"));
  const destinationRoot = path.join(root, "evidence");
  let writes = 0;
  try {
    await assert.rejects(publish({
      evidence: {
        "a.png": Buffer.from("new-a"),
        "b.png": Buffer.from("new-b"),
      },
      destinationRoot,
      fileOperations: {
        writeFile: async (filename, bytes) => {
          writes += 1;
          if (writes === 2) {
            await writeFile(filename, bytes.subarray(0, 1));
            throw new Error("oracle-mid-write");
          }
          await writeFile(filename, bytes);
        },
      },
    }), /oracle-mid-write/);
    assert.deepEqual(await readdir(destinationRoot), [],
      "mid-write failure must remove partial/current and fully staged temporary files");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Task12R R4 atomic proof publication restores anchors after post-rename failure", async () => {
  const publish = productionPacker.publishProofEvidenceAtomically;
  assert.equal(typeof publish, "function", "testable atomic proof helper required");
  const root = await mkdtemp(path.join(tmpdir(), "vivarium-r4-proof-rename-"));
  const destinationRoot = path.join(root, "evidence");
  await mkdir(destinationRoot, { recursive: true });
  await writeFile(path.join(destinationRoot, "a.png"), Buffer.from("anchor-a"));
  await writeFile(path.join(destinationRoot, "c.png"), Buffer.from("anchor-c"));
  let commitRenames = 0;
  try {
    await assert.rejects(publish({
      evidence: {
        "a.png": Buffer.from("new-a"),
        "b.png": Buffer.from("new-b"),
        "c.png": Buffer.from("new-c"),
      },
      destinationRoot,
      fileOperations: {
        rename: async (from, to) => {
          await rename(from, to);
          if (from.includes(".tmp-r4-proof-") && !from.includes("rollback")) {
            commitRenames += 1;
            if (commitRenames === 2) throw new Error("oracle-post-rename");
          }
        },
      },
    }), /oracle-post-rename/);
    assert.deepEqual((await readdir(destinationRoot)).sort(), ["a.png", "c.png"]);
    assert.equal((await readFile(path.join(destinationRoot, "a.png"), "utf8")), "anchor-a");
    assert.equal((await readFile(path.join(destinationRoot, "c.png"), "utf8")), "anchor-c");
    assert.equal((await readdir(destinationRoot)).some((name) => name.includes(".tmp-") || name.includes("rollback")), false,
      "rename rollback must leave no staging or rollback debris");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Task12R R4 atomic proof publication stages and commits in lexical order", async () => {
  const publish = productionPacker.publishProofEvidenceAtomically;
  const root = await mkdtemp(path.join(tmpdir(), "vivarium-r4-proof-order-"));
  const destinationRoot = path.join(root, "evidence");
  const writes = [];
  const renames = [];
  try {
    await publish({
      evidence: {
        "z.png": Buffer.from("z"),
        "a.png": Buffer.from("a"),
        "m.png": Buffer.from("m"),
      },
      destinationRoot,
      fileOperations: {
        writeFile: async (filename, bytes) => {
          writes.push(path.basename(filename).split(".tmp-")[0]);
          await writeFile(filename, bytes);
        },
        rename: async (from, to) => {
          renames.push(path.basename(to));
          await rename(from, to);
        },
      },
    });
    assert.deepEqual(writes, ["a.png", "m.png", "z.png"]);
    assert.deepEqual(renames, ["a.png", "m.png", "z.png"]);
    assert.deepEqual((await readdir(destinationRoot)).sort(), ["a.png", "m.png", "z.png"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const enclosedTransparentSockets = (bytes, width, height) => {
  const transparent = new Set();
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (bytes[(y * width + x) * 4 + 3] === 0) transparent.add(`${x},${y}`);
  }
  let sockets = 0;
  while (transparent.size > 0) {
    const seed = transparent.values().next().value;
    const queue = [seed];
    let touchesEdge = false;
    let size = 0;
    transparent.delete(seed);
    while (queue.length > 0) {
      const [x, y] = queue.shift().split(",").map(Number);
      size += 1;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true;
      for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
        if (!transparent.delete(neighbor)) continue;
        queue.push(neighbor);
      }
    }
    if (!touchesEdge && size >= 64) sockets += 1;
  }
  return sockets;
};

const alphaCoverage = (bytes, width, rectangle) => {
  let opaque = 0;
  for (let y = rectangle.y; y < rectangle.y + rectangle.height; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.width; x += 1) {
      if (bytes[(y * width + x) * 4 + 3] === 255) opaque += 1;
    }
  }
  return opaque / (rectangle.width * rectangle.height);
};

const assertYardTopology = async (preview, { foundationCoverageMin, doorWidthPx, sockets }) => {
  for (const kit of REGION_KITS) {
    const raw = await sharp(preview.buffers[`${kit}-home-yards`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    for (const cellIndex of [0, 1, 4]) {
      const bytes = rawAtlasCellBytes(raw, cellIndex, 5, 192, 160);
      const foundationCoverage = alphaCoverage(bytes, 192, { x: 32, y: 48, width: 128, height: 64 });
      assert.ok(foundationCoverage >= foundationCoverageMin,
        `${kit}/yard-${cellIndex}: foundation coverage ${foundationCoverage.toFixed(4)} is below ${foundationCoverageMin}`);
      const doorStart = 96 - doorWidthPx / 2;
      const doorCoverage = alphaCoverage(bytes, 192, { x: doorStart, y: 112, width: doorWidthPx, height: 48 });
      assert.ok(doorCoverage <= 0.08, `${kit}/yard-${cellIndex}: ${doorWidthPx}px south door corridor must remain open`);
      assert.equal(enclosedTransparentSockets(bytes, 192, 160), sockets,
        `${kit}/yard-${cellIndex}: enclosed transparent placement socket count`);
      let outerOpaque = 0;
      let outerPixels = 0;
      for (let y = 0; y < 160; y += 1) for (let x = 0; x < 192; x += 1) {
        if (!(x < 8 || x >= 184 || y < 8 || y >= 152)) continue;
        outerPixels += 1;
        if (bytes[(y * 192 + x) * 4 + 3] === 255) outerOpaque += 1;
      }
      const outerCoverage = outerOpaque / outerPixels;
      assert.ok(outerCoverage >= 0.01 && outerCoverage <= 0.55,
        `${kit}/yard-${cellIndex}: outer coverage must be ragged rather than absent or a closed ring`);
    }
  }
};

const assertCandidateBudgets = async (preview) => {
  await assertCandidateTerrainBinding(preview);
  const persisted = JSON.parse(await readFile(PACKING_REPORT, "utf8"));
  assert.equal(persisted.atlases.length, 53, "candidate budget projection requires the frozen 53-atlas inventory");
  assert.equal(Object.keys(preview.nativeContract.atlases ?? {}).length, 53,
    "candidate native contract must preserve exactly 53 atlases");
  const descriptors = persisted.atlases.map((atlas) => ({ ...atlas }));
  for (const kit of REGION_KITS) for (const suffix of ["terrain", "landmarks", "home-yards"]) {
    const id = `${kit}-${suffix}`;
    const descriptor = descriptors.find((atlas) => atlas.id === id);
    assert.ok(descriptor, `${id}: candidate budget descriptor required`);
    const buffer = preview.buffers[id];
    assert.ok(Buffer.isBuffer(buffer), `${id}: candidate buffer required`);
    const metadata = await sharp(buffer).metadata();
    assert.deepEqual([metadata.width, metadata.height], [descriptor.width, descriptor.height],
      `${id}: candidate bytes may not normalize persisted descriptor geometry`);
    if (suffix === "terrain") {
      assert.deepEqual([descriptor.width, descriptor.height, descriptor.cellWidth, descriptor.cellHeight],
        [256, 256, 32, 32], `${id}: candidate budget requires exact terrain frame geometry`);
      assert.equal(preview.nativeContract.atlases[id].sourceSha256, sha256(buffer),
        `${id}: budget projection requires sourceSha256-bound terrain bytes`);
    }
    Object.assign(descriptor, {
      compressedBytes: buffer.length,
      decodedBytes: descriptor.width * descriptor.height * 4,
      sha256: sha256(buffer),
      runtimeResized: false,
    });
  }
  const regions = {};
  for (const kit of REGION_KITS) {
    const region = productionPacker.regionMetadataFile(kit, descriptors, preview.nativeContract).buffer;
    const home = productionPacker.homeMetadataFile(kit, descriptors, preview.nativeContract).buffer;
    regions[kit] = { compressedBytes: region.length + home.length, decodedBytes: region.length + home.length };
  }
  const candidate = buildProductionPackingReport({
    atlases: descriptors,
    currentUiCompressedBytes: persisted.currentUiCompressedBytes,
    currentUiDecodedBytes: persisted.currentUiDecodedBytes,
    metadata: {
      core: {
        compressedBytes: persisted.coreMetadataCompressedBytes,
        decodedBytes: persisted.coreMetadataDecodedBytes,
      },
      regions,
    },
    budgets: persisted.budgets,
  });
  assert.deepEqual(validateAssetBudgets(candidate), [], "candidate compressed and metadata budgets must pass");
  for (const kit of REGION_KITS) {
    assert.ok(candidate.exactPeakActiveDecodedBytes[kit] <= 30_393_522,
      `${kit}: exact active decoded hard cap exceeded`);
  }
};

const expectedRegionalR4EvidenceNames = () => {
  const names = [];
  for (const kit of REGION_KITS) for (const artifact of [
    "terrain-native-1x",
    "terrain-nearest-2x",
    "landmarks-native-1x",
    "landmarks-nearest-2x",
    "yards-native-1x",
    "yards-nearest-2x",
    "composed-native-1x",
    "composed-nearest-2x",
  ]) names.push(`task12r-r4-${kit}-${artifact}.png`);
  names.push("task12r-r4-ash-risk-first-composed.png");
  return names.sort();
};

test("pins the five frozen slice atlas hashes before production packing", async () => {
  assert.deepEqual(FROZEN_SLICE_HASHES, {
    "human-body-atlas.png": "68c505e74dd7e21a9db3732c2a277ed7440200403303d31941ec9cead8bfcbb6",
    "human-face-atlas.png": "3132ebffc2585120948e42c86f71f3d15bbba94e672790bbca1f82ce474ac4a7",
    "human-held-atlas.png": "24d3eb3951bffbe7c1cd7db742497776188314b03df7dab8b0f8fcab17067e28",
    "shelter-slice-atlas.png": "a50770aeefc6547c23805f408305d52dcf411dfd46e2143992251c89c997d540",
    "nirvana-tile-atlas.png": "66b79e7d93989530b0689ef719de2d8700b669b907fbf4e5326d9635917d20b4",
  });
  const sources = Object.fromEntries(await Promise.all(Object.keys(FROZEN_SLICE_HASHES).map(
    async (name) => [name, await readFile(new URL(name, FROZEN_ASSET_ROOT))],
  )));
  assert.deepEqual(validateFrozenSliceReferences(sources), []);
  for (const [name, source] of Object.entries(sources)) {
    assert.equal(createHash("sha256").update(source).digest("hex"), FROZEN_SLICE_HASHES[name]);
  }
});

test("publishes disjoint named terrain roles whose legal native cells are opaque and seam-safe", async () => {
  const validateSemanticTerrainAtlas = productionPacker.validateSemanticTerrainAtlas;
  assert.equal(
    typeof validateSemanticTerrainAtlas,
    "function",
    "packer must export the native semantic-terrain validator used before publication",
  );
  const expectedRoles = {
    ground: [0, 1, 2, 3, 4, 5, 6, 7],
    path: [8, 9, 10, 11, 12, 13, 14, 15],
    water: [16, 17, 18, 19, 20, 21, 22, 23],
    shore: [24, 25, 26, 27, 28, 29, 30, 31],
    soil: [32, 33, 34, 35],
  };
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  for (const kit of ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"]) {
    const terrainContract = contract.atlases[`${kit}-terrain`];
    assert.deepEqual(terrainContract.semanticTerrainRoles, expectedRoles, `${kit} semantic terrain roles`);
    assert.deepEqual(
      await validateSemanticTerrainAtlas(
        await readFile(new URL(`regions/${kit}/terrain.png`, NATIVE_ASSET_ROOT)),
        terrainContract.semanticTerrainRoles,
      ),
      [],
      `${kit} legal terrain cells must be fully opaque, seam-safe, and free of sheet-border ink`,
    );
  }
});

test("persists explicit scenery-kind cell bindings instead of relying on atlas order", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const expectedKinds = {
    "worn-heartland": ["old-oak", "worn-stone", "faded-flower", "fallen-fence"],
    "spring-terraces": ["terrace-rock", "willow", "spring-flower", "reed-bed"],
    "dry-scrub": ["sun-rock", "deadwood", "dry-grass", "thorn"],
    "ash-waste": ["charred-trunk", "slag-rock", "ash-pile", "bone-stone"],
    "neutral-temperate": ["broad-tree", "field-rock", "wildflower", "soft-grass"],
  };
  for (const [kit, kinds] of Object.entries(expectedKinds)) {
    assert.deepEqual(
      contract.atlases[`${kit}-scenery`].semanticSceneryCells,
      Object.fromEntries(kinds.map((kind, index) => [kind, index])),
      `${kit} scenery kinds require named native cells`,
    );
  }
});

test("RED Task12R: closes native/runtime membership at exactly 53 atlases with ten large regional compositions", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const report = JSON.parse(await readFile(PACKING_REPORT, "utf8"));
  assert.equal(Object.keys(contract.atlases ?? {}).length, 53, "native contract must own exactly 53 atlases");
  assert.equal(report.atlases?.length, 53, "packing report must count exactly 53 atlases");

  for (const expected of REGIONAL_COMPOSITION_ATLASES) {
    const nativeBuffer = await readFile(new URL(expected.relativePath, NATIVE_ASSET_ROOT));
    const runtimeBuffer = await readFile(new URL(expected.relativePath, FROZEN_ASSET_ROOT));
    assert.equal(runtimeBuffer.equals(nativeBuffer), true, `${expected.id} runtime bytes must equal native bytes`);
    const metadata = await sharp(nativeBuffer).metadata();
    assert.deepEqual(
      [metadata.width, metadata.height],
      [expected.width, expected.height],
      `${expected.id} exact native geometry`,
    );
    const descriptor = report.atlases.find(({ id }) => id === expected.id);
    assert.ok(descriptor, `${expected.id} must be counted in the packing report`);
    assert.deepEqual(
      [descriptor.cellWidth, descriptor.cellHeight, descriptor.columns * descriptor.rows],
      [expected.cellWidth, expected.cellHeight, expected.cells],
      `${expected.id} exact cell geometry`,
    );
    assert.equal(descriptor.runtimeResized, false, `${expected.id} runtime resizing is forbidden`);
    assert.equal(descriptor.binaryAlpha, true, `${expected.id} requires binary alpha`);
  }
});

test("RED Task12R: publishes a closed byte-derived geometry contract for all 65 large composition cells", async () => {
  assert.equal(
    typeof productionPacker.validateRegionalCompositionContract,
    "function",
    "packer must export its regional composition contract validator",
  );
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const buffers = Object.fromEntries(await Promise.all(REGIONAL_COMPOSITION_ATLASES.map(async ({ id, relativePath }) => [
    id,
    await readFile(new URL(relativePath, NATIVE_ASSET_ROOT)),
  ])));
  const errors = await productionPacker.validateRegionalCompositionContract?.(contract, buffers);
  assert.deepEqual(errors, []);

  for (const { id, cells } of REGIONAL_COMPOSITION_ATLASES) {
    const atlas = contract.atlases[id];
    assert.equal(atlas.authoredVariants?.length, cells, `${id} requires one geometry record per occupied cell`);
    const variantIds = atlas.authoredVariants.map(({ variantId }) => variantId);
    assert.equal(new Set(variantIds).size, cells, `${id} variant IDs must be stable and unique`);
    assert.equal(
      atlas.authoredVariants.some(({ semanticKind }) => semanticKind === id),
      false,
      `${id} semantic names may never double as atlas IDs`,
    );
    for (const variant of atlas.authoredVariants) {
      assert.match(variant.geometryHash, /^[a-f0-9]{64}$/, `${variant.variantId} geometry hash`);
      assert.equal(Array.isArray(variant.opaqueComponentOrdinals), true);
      assert.equal(Array.isArray(variant.recognitionComponentOrdinals), true);
      assert.equal(Array.isArray(variant.hardOffsets), true);
      assert.equal(Array.isArray(variant.interactionExclusionOffsets), true);
      assert.equal(Array.isArray(variant.eligibleTopologyKeys), true);
      assert.ok(variant.eligibleTopologyKeys.length > 0, `${variant.variantId} exact topology eligibility`);
    }
  }
});

const encodeNativeRgba = async ({ data, info }) => sharp(data, { raw: info }).png({
  palette: false,
  compressionLevel: 9,
  adaptiveFiltering: false,
}).toBuffer();

const hostileWornCandidate = async (source, kind) => {
  const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (kind === "fractional-alpha") {
    const opaque = raw.data.findIndex((_value, offset) => offset % 4 === 3 && raw.data[offset] === 255);
    raw.data[opaque] = 128;
  } else if (kind === "transparent-residue") {
    const transparent = raw.data.findIndex((_value, offset) => offset % 4 === 3 && raw.data[offset] === 0);
    raw.data[transparent - 3] = 7;
  } else if (kind === "unknown-palette") {
    const opaque = raw.data.findIndex((_value, offset) => offset % 4 === 3 && raw.data[offset] === 255);
    raw.data.set([1, 2, 3, 255], opaque - 3);
  } else if (kind === "pickup-sized") {
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) {
      raw.data.fill(0, (y * raw.info.width + x) * 4, (y * raw.info.width + x) * 4 + 4);
    }
    for (let y = 56; y < 72; y += 1) for (let x = 56; x < 72; x += 1) {
      raw.data.set([28, 28, 36, 255], (y * raw.info.width + x) * 4);
    }
  } else {
    throw new Error(`unknown hostile worn fixture ${kind}`);
  }
  return encodeNativeRgba(raw);
};

const createScopedWornLandmarkFixture = async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "vivarium-worn-landmark-intake-")));
  const nativeRoot = path.join(root, "source/native");
  const runtimeRoot = path.join(root, "runtime");
  const evidenceRoot = path.join(root, "evidence");
  await mkdir(nativeRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  await copyFile(fileURLToPath(NATIVE_CONTRACT), path.join(nativeRoot, "production-native-contract.json"));
  await copyFile(fileURLToPath(PACKING_REPORT), path.join(evidenceRoot, "packing-report.json"));
  for (const { relativePath } of REGIONAL_COMPOSITION_ATLASES) {
    const destination = path.join(nativeRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(fileURLToPath(new URL(relativePath, NATIVE_ASSET_ROOT)), destination);
  }
  for (const relativePath of [
    "regions/worn-heartland/landmarks.png",
    "regions/worn-heartland/pack.json",
    "homes/worn-heartland/pack.json",
    "regions/ash-waste/landmarks.png",
    "regions/spring-terraces/pack.json",
  ]) {
    const destination = path.join(runtimeRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(fileURLToPath(new URL(relativePath, FROZEN_ASSET_ROOT)), destination);
  }
  const candidate = await readFile(APPROVED_WORN_LANDMARK_CANDIDATE);
  const candidatePath = path.join(root, "candidate.png");
  await writeFile(candidatePath, candidate);
  const preservedPaths = [
    path.join(nativeRoot, "regions/ash-waste/landmarks.png"),
    path.join(nativeRoot, "homes/dry-scrub/yards.png"),
    path.join(runtimeRoot, "regions/ash-waste/landmarks.png"),
    path.join(runtimeRoot, "regions/spring-terraces/pack.json"),
  ];
  const preservedSha256 = Object.fromEntries(await Promise.all(preservedPaths.map(async (filename) => [
    filename,
    sha256(await readFile(filename)),
  ])));
  return { root, nativeRoot, runtimeRoot, evidenceRoot, candidate, candidatePath, preservedSha256 };
};

const scopedWornTargets = (fixture) => [
  path.join(fixture.evidenceRoot, "packing-report.json"),
  path.join(fixture.nativeRoot, "production-native-contract.json"),
  path.join(fixture.nativeRoot, "regions/worn-heartland/landmarks.png"),
  path.join(fixture.runtimeRoot, "regions/worn-heartland/landmarks.png"),
  path.join(fixture.runtimeRoot, "regions/worn-heartland/pack.json"),
].sort();

test("scoped worn landmark authoring exposes exact approved per-variant collision authority", async () => {
  assert.equal(
    typeof productionPacker.wornHeartlandLandmarkHardOffsets,
    "function",
    "scoped intake requires an explicit variant table before a future single-trunk candidate can be accepted",
  );
  assert.deepEqual(productionPacker.wornHeartlandLandmarkHardOffsets(), {
    "worn-heartland:broad-crown": [{ x: 0, y: 0 }],
    "worn-heartland:split-crown": [{ x: -1, y: 0 }, { x: 0, y: 0 }],
    "worn-heartland:wind-worn-crown": [{ x: -1, y: 0 }, { x: 0, y: 0 }],
  });

  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  const variants = preview.nativeContract.atlases["worn-heartland-landmarks"].authoredVariants
    .filter(({ semanticKind }) => semanticKind === "old-oak-grove-composite");
  assert.equal(variants.length, 3);
  assert.deepEqual(
    Object.fromEntries(variants.map(({ variantId, hardOffsets }) => [variantId, hardOffsets])),
    productionPacker.wornHeartlandLandmarkHardOffsets(),
  );
});

test("scoped worn landmark intake rejects exact native violations before staging", async () => {
  assert.equal(typeof productionPacker.publishWornHeartlandLandmarksScoped, "function");
  const fixture = await createScopedWornLandmarkFixture();
  const writes = [];
  try {
    const wrongGeometry = await sharp(fixture.candidate).extract({ left: 0, top: 0, width: 511, height: 256 })
      .png({ palette: false }).toBuffer();
    const hostile = [
      ["wrong-geometry", wrongGeometry, /512x256|geometry|dimensions/i],
      ["fractional-alpha", await hostileWornCandidate(fixture.candidate, "fractional-alpha"), /binary alpha|fractional/i],
      ["transparent-residue", await hostileWornCandidate(fixture.candidate, "transparent-residue"), /transparent.*residue|RGB residue/i],
      ["unknown-palette", await hostileWornCandidate(fixture.candidate, "unknown-palette"), /unknown.*palette|undeclared palette/i],
      ["pickup-sized", await hostileWornCandidate(fixture.candidate, "pickup-sized"), /pickup-sized|composition.*size/i],
    ];
    for (const [name, buffer, pattern] of hostile) {
      const candidatePath = path.join(fixture.root, `${name}.png`);
      await writeFile(candidatePath, buffer);
      await assert.rejects(
        productionPacker.publishWornHeartlandLandmarksScoped({
          candidatePath,
          nativeRoot: fixture.nativeRoot,
          runtimeRoot: fixture.runtimeRoot,
          evidenceRoot: fixture.evidenceRoot,
          fileOperations: {
            writeFile: async (...args) => { writes.push(args[0]); },
            rename: async () => { throw new Error("rename must not run after invalid intake"); },
          },
        }),
        pattern,
        name,
      );
    }
    assert.deepEqual(writes, [], "all candidate validation must finish before the first staging write");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("scoped worn landmark CLI accepts one explicit candidate and rejects bare, empty, duplicate, or broad combinations", () => {
  assert.equal(typeof productionPacker.parseWornHeartlandLandmarkAuthoringArgument, "function");
  assert.equal(
    productionPacker.parseWornHeartlandLandmarkAuthoringArgument([
      "--author-worn-heartland-landmarks=/tmp/approved.png",
    ]),
    "/tmp/approved.png",
  );
  assert.equal(productionPacker.parseWornHeartlandLandmarkAuthoringArgument([]), null);
  for (const args of [
    ["--author-worn-heartland-landmarks"],
    ["--author-worn-heartland-landmarks="],
    ["--author-worn-heartland-landmarks=/tmp/a.png", "--author-worn-heartland-landmarks=/tmp/b.png"],
    ["--author-worn-heartland-landmarks=/tmp/a.png", "--check"],
    ["--author-worn-heartland-landmarks=/tmp/a.png", "--author-regional-compositions"],
    ["--author-worn-heartland-landmarks=/tmp/a.png", "unexpected-positional-input"],
  ]) {
    assert.throws(
      () => productionPacker.parseWornHeartlandLandmarkAuthoringArgument(args),
      /worn-heartland.*requires|cannot be combined|exactly one|candidate/i,
      JSON.stringify(args),
    );
  }
});

test("production packer argv allowlist fails closed on typos and unknown inputs before mode dispatch", () => {
  assert.equal(typeof productionPacker.validateProductionPackerArguments, "function");
  const supported = [
    "--check",
    "--proof-regional-r5-source-masters",
    "--proof-regional-r5-key-scene",
    "--proof-regional-r5-key-scene=ash-waste",
    "--author-human-hair",
    "--author-human-faces",
    "--author-semantic-regions",
    "--author-guide-regions",
    "--author-regional-compositions",
    "--author-ash-composition-proof",
    "--author-regional-r4-proofs",
    "--author-regional-r3-proofs",
    "--author-regional-r3-1-proofs",
    "--author-worn-heartland-landmarks",
    "--author-worn-heartland-landmarks=/tmp/approved.png",
  ];
  assert.deepEqual(productionPacker.validateProductionPackerArguments([]), []);
  assert.deepEqual(productionPacker.validateProductionPackerArguments(supported), supported);
  for (const argument of [
    "--author-worn-heartland-landmark=/tmp/typo.png",
    "--author-worn-heartland-landmarks-extra=/tmp/typo.png",
    "--proof-regional-r5-key-scenes=ash-waste",
    "--check=true",
    "unexpected-positional-input",
  ]) {
    assert.throws(
      () => productionPacker.validateProductionPackerArguments([argument]),
      /unknown.*argument|unsupported.*argument/i,
      argument,
    );
  }
});

test("scoped worn landmark intake rejects duplicate or stale runtime descriptors before staging", async () => {
  const fixture = await createScopedWornLandmarkFixture();
  const runtimePackPath = path.join(fixture.runtimeRoot, "regions/worn-heartland/pack.json");
  const basePack = JSON.parse(await readFile(runtimePackPath, "utf8"));
  const targetId = "worn-heartland-landmarks";
  const writes = [];
  const mutateTarget = (mutator) => {
    const pack = structuredClone(basePack);
    const descriptor = pack.atlases.find(({ id }) => id === targetId);
    mutator(descriptor, pack);
    return pack;
  };
  const hostilePacks = [
    ["duplicate-id", mutateTarget((descriptor, pack) => pack.atlases.push(structuredClone(descriptor)))],
    ["missing-id", mutateTarget((descriptor) => { descriptor.id = `${targetId}-stale`; })],
    ["stale-path", mutateTarget((descriptor) => { descriptor.path = "regions/worn-heartland/stale.png"; })],
    ["duplicate-path-owner", mutateTarget((descriptor, pack) => pack.atlases.push({
      ...structuredClone(descriptor),
      id: `${targetId}-stale`,
    }))],
    ["stale-group", mutateTarget((descriptor) => { descriptor.group = "core"; })],
    ["stale-kit", mutateTarget((descriptor) => { descriptor.regionKit = "ash-waste"; })],
    ["stale-atlas-geometry", mutateTarget((descriptor) => { descriptor.width = 511; })],
    ["stale-cell-geometry", mutateTarget((descriptor) => { descriptor.cellWidth = 64; })],
    ["stale-grid", mutateTarget((descriptor) => { descriptor.columns = 8; })],
    ["stale-decoded-bytes", mutateTarget((descriptor) => { descriptor.decodedBytes = 1; })],
    ["missing-schema-key", mutateTarget((descriptor) => { delete descriptor.rows; })],
    ["extra-schema-key", mutateTarget((descriptor) => { descriptor.staleField = true; })],
  ];
  try {
    for (const [name, pack] of hostilePacks) {
      await writeFile(runtimePackPath, `${JSON.stringify(pack)}\n`);
      await assert.rejects(
        productionPacker.publishWornHeartlandLandmarksScoped({
          candidatePath: fixture.candidatePath,
          nativeRoot: fixture.nativeRoot,
          runtimeRoot: fixture.runtimeRoot,
          evidenceRoot: fixture.evidenceRoot,
          fileOperations: {
            writeFile: async (...args) => { writes.push(args[0]); },
            rename: async () => { throw new Error("rename must not run after invalid descriptor"); },
          },
        }),
        /descriptor|path|group|region kit|geometry|grid|decoded|schema/i,
        name,
      );
    }
    assert.deepEqual(writes, [], "runtime descriptor validation must finish before the first staging write");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("scoped worn landmark intake atomically publishes exactly five files with its accounting receipt and preserves every sampled non-worn SHA", async () => {
  const fixture = await createScopedWornLandmarkFixture();
  try {
    const result = await productionPacker.publishWornHeartlandLandmarksScoped({
      candidatePath: fixture.candidatePath,
      nativeRoot: fixture.nativeRoot,
      runtimeRoot: fixture.runtimeRoot,
      evidenceRoot: fixture.evidenceRoot,
    });
    assert.deepEqual([...result.publishedPaths].sort(), scopedWornTargets(fixture));
    assert.equal(
      (await readFile(path.join(fixture.nativeRoot, "regions/worn-heartland/landmarks.png"))).equals(fixture.candidate),
      true,
    );
    assert.equal(
      (await readFile(path.join(fixture.runtimeRoot, "regions/worn-heartland/landmarks.png"))).equals(fixture.candidate),
      true,
    );
    const contract = JSON.parse(await readFile(
      path.join(fixture.nativeRoot, "production-native-contract.json"),
      "utf8",
    ));
    const pack = JSON.parse(await readFile(
      path.join(fixture.runtimeRoot, "regions/worn-heartland/pack.json"),
      "utf8",
    ));
    const report = JSON.parse(await readFile(
      path.join(fixture.evidenceRoot, "packing-report.json"),
      "utf8",
    ));
    const contractBytes = await readFile(path.join(fixture.nativeRoot, "production-native-contract.json"));
    const targetReportAtlas = report.atlases.find(({ id }) => id === "worn-heartland-landmarks");
    assert.equal(contract.atlases["worn-heartland-landmarks"].sourceSha256, sha256(fixture.candidate));
    assert.deepEqual(contract.atlases["worn-heartland-landmarks"].materialRamps, {
      "ground-cover": [[93, 99, 61], [143, 152, 84], [194, 199, 129]],
      "path-surface": [[170, 134, 82], [214, 198, 154]],
      "timber-material": [[111, 80, 53], [230, 164, 95]],
      "faded-accent": [[200, 141, 122]],
    });
    assert.equal(
      pack.atlases.find(({ id }) => id === "worn-heartland-landmarks").sha256,
      sha256(fixture.candidate),
    );
    assert.equal(report.nativeContractSha256, sha256(contractBytes));
    assert.equal(targetReportAtlas.sha256, sha256(fixture.candidate));
    assert.equal(targetReportAtlas.compressedBytes, fixture.candidate.length);
    assert.equal(targetReportAtlas.validation.measuredFromContractSha256, sha256(contractBytes));
    assert.equal(report.facePlaneValidation.measuredFromContractSha256, sha256(contractBytes));
    assert.equal(report.clipValidation.measuredFromContractSha256, sha256(contractBytes));
    assert.equal(
      report.regionMetadataCompressedBytes["worn-heartland"],
      (await readFile(path.join(fixture.runtimeRoot, "regions/worn-heartland/pack.json"))).length
        + (await readFile(path.join(fixture.runtimeRoot, "homes/worn-heartland/pack.json"))).length,
    );
    assert.deepEqual(validateAssetBudgets(report), []);
    for (const [filename, digest] of Object.entries(fixture.preservedSha256)) {
      assert.equal(sha256(await readFile(filename)), digest, `${filename} must remain byte-identical`);
    }
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("scoped worn landmark intake restores all five anchors after a post-rename fault", async () => {
  const fixture = await createScopedWornLandmarkFixture();
  const targets = scopedWornTargets(fixture);
  const before = Object.fromEntries(await Promise.all(targets.map(async (filename) => [
    filename,
    await readFile(filename),
  ])));
  let renames = 0;
  try {
    await assert.rejects(
      productionPacker.publishWornHeartlandLandmarksScoped({
        candidatePath: fixture.candidatePath,
        nativeRoot: fixture.nativeRoot,
        runtimeRoot: fixture.runtimeRoot,
        evidenceRoot: fixture.evidenceRoot,
        fileOperations: {
          rename: async (from, to) => {
            await rename(from, to);
            if (!from.includes("rollback") && ++renames === 2) throw new Error("oracle-scoped-rename-fault");
          },
        },
      }),
      /oracle-scoped-rename-fault/,
    );
    for (const filename of targets) {
      assert.equal((await readFile(filename)).equals(before[filename]), true, `${filename} rollback`);
    }
    const allFiles = [];
    const walk = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(filename);
        else allFiles.push(filename);
      }
    };
    await walk(fixture.root);
    assert.equal(allFiles.some((filename) => /\.tmp-worn-landmark-|rollback/.test(filename)), false);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("scoped worn landmark rollback surfaces temporary cleanup failures with the original commit fault", async () => {
  const fixture = await createScopedWornLandmarkFixture();
  let renames = 0;
  let failure;
  try {
    await productionPacker.publishWornHeartlandLandmarksScoped({
      candidatePath: fixture.candidatePath,
      nativeRoot: fixture.nativeRoot,
      runtimeRoot: fixture.runtimeRoot,
      evidenceRoot: fixture.evidenceRoot,
      fileOperations: {
        rename: async (from, to) => {
          await rename(from, to);
          if (!from.includes("rollback") && ++renames === 2) {
            throw new Error("oracle-scoped-commit-fault");
          }
        },
        rm: async (filename, options) => {
          if (filename.endsWith(".tmp-worn-landmark-" + process.pid + "-2")) {
            throw new Error("oracle-scoped-cleanup-fault");
          }
          await rm(filename, options);
        },
      },
    });
  } catch (error) {
    failure = error;
  }
  try {
    assert.ok(failure instanceof AggregateError, "cleanup failure must not be discarded");
    const nestedMessages = failure.errors.map((error) => error.message).join("\n");
    assert.match(nestedMessages, /oracle-scoped-commit-fault/);
    assert.match(nestedMessages, /oracle-scoped-cleanup-fault/);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("RED Task12R: ash metadata carries nuclear industrial identity without living, water, fantasy, sign, barrel, or text semantics", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const landmarks = contract.atlases?.["ash-waste-landmarks"];
  assert.ok(landmarks, "ash landmark contract is required");
  const variants = landmarks.authoredVariants ?? [];
  const kinds = variants.map(({ semanticKind }) => semanticKind);
  assert.equal(kinds.filter((kind) => kind === "nuclear-crater-fissure-composite").length, 2);
  assert.equal(kinds.filter((kind) => kind === "fractured-industrial-pylon-composite").length, 2);
  assert.equal(kinds.filter((kind) => kind === "slag-charred-ridge-composite").length, 2);
  assert.equal(kinds.filter((kind) => kind === "ash-debris-fan-composite").length, 2);
  assert.equal(
    variants.filter(({ recognitionTags = [] }) => recognitionTags.includes("integrated-three-lobed-containment-relief")).length,
    3,
    "both pylons and one joined containment-debris variant require the integrated relief",
  );
  const forbidden = /green|grass|living|tree|canopy|flower|reed|water|spring|garden|moss|vine|wizard|magic|rune|gothic|medieval|sign|barrel|text|glow/i;
  assert.doesNotMatch(JSON.stringify(landmarks.semanticMaterials ?? {}), forbidden);
  assert.doesNotMatch(JSON.stringify(landmarks.authoredVariants ?? []), forbidden);
});

test("RED Task12R ash revision: every hazardous composition spans a broad joined landscape and yards carry substantial site context", async () => {
  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  const landmarkRaw = await sharp(preview.buffers["ash-waste-landmarks"]).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const yardRaw = await sharp(preview.buffers["ash-waste-home-yards"]).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const stats = (raw, cellIndex, columns, width, height) => {
    const originX = cellIndex % columns * width;
    const originY = Math.floor(cellIndex / columns) * height;
    const points = [];
    const thirds = [0, 0, 0];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (raw.data[((originY + y) * raw.info.width + originX + x) * 4 + 3] === 0) continue;
      points.push({ x, y });
      thirds[Math.min(2, Math.floor(x / (width / 3)))] += 1;
    }
    return {
      opaque: points.length,
      thirds,
      width: Math.max(...points.map(({ x }) => x)) - Math.min(...points.map(({ x }) => x)) + 1,
      height: Math.max(...points.map(({ y }) => y)) - Math.min(...points.map(({ y }) => y)) + 1,
      bottomThird: points.filter(({ y }) => y >= height * 2 / 3).length,
    };
  };

  const minimums = [
    { width: 116, height: 78, opaque: 2_800 },
    { width: 116, height: 78, opaque: 2_800 },
    { width: 108, height: 108, opaque: 2_100, bottomThird: 500 },
    { width: 108, height: 108, opaque: 2_100, bottomThird: 500 },
    { width: 116, height: 72, opaque: 3_000 },
    { width: 116, height: 72, opaque: 3_000 },
    { width: 116, height: 70, opaque: 2_600 },
    { width: 116, height: 70, opaque: 2_600 },
  ];
  for (const [cellIndex, required] of minimums.entries()) {
    const measured = stats(landmarkRaw, cellIndex, 4, 128, 128);
    assert.ok(measured.width >= required.width, `ash landmark ${cellIndex} must span landscape width`);
    assert.ok(measured.height >= required.height, `ash landmark ${cellIndex} must span landscape height`);
    assert.ok(measured.opaque >= required.opaque, `ash landmark ${cellIndex} needs joined visual mass`);
    assert.ok(measured.thirds.every((pixels) => pixels >= 160), `ash landmark ${cellIndex} must occupy all horizontal thirds`);
    if (required.bottomThird) assert.ok(measured.bottomThird >= required.bottomThird, `ash pylon ${cellIndex} requires heavy grounded machinery`);
  }

  for (const cellIndex of [0, 1, 4]) {
    const measured = stats(yardRaw, cellIndex, 5, 192, 160);
    assert.ok(measured.opaque >= 7_000, `ash yard ${cellIndex} needs a substantial apron/site silhouette`);
    assert.ok(measured.thirds.every((pixels) => pixels >= 1_000), `ash yard ${cellIndex} must frame all three shelter sides`);
  }
});

test("RED Task12R R3: native proofs form textured traversable places instead of stippled prop galleries", async () => {
  const preview = await productionPacker.buildRegionalR3DiagnosticAuthoring();
  assert.ok(preview.proofs, "regional authoring must return its native composed proofs for byte-level review");
  assert.ok(preview.compositionPlans, "regional authoring must expose deterministic proof geometry");

  for (const kit of REGION_KITS) {
    const terrain = preview.buffers[`${kit}-terrain`];
    const proof = preview.proofs[kit];
    const plan = preview.compositionPlans[kit];
    assert.ok(Buffer.isBuffer(terrain), `${kit} R3 authoring must own its terrain bytes`);
    assert.ok(Buffer.isBuffer(proof), `${kit} R3 composed proof is required`);
    assert.ok(plan, `${kit} R3 composition plan is required`);
    assert.deepEqual([plan.widthTiles, plan.heightTiles], [24, 16], `${kit} native proof tile geometry`);

    const terrainRaw = await sharp(terrain).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const cellIndex of [0, 1, 2, 3]) {
      const texture = cellTextureStats(terrainRaw, cellIndex, 8, 32, 32);
      assert.ok(texture.colors >= 3, `${kit} ground ${cellIndex} needs a material ramp`);
      assert.ok(texture.texturePixels >= 72, `${kit} ground ${cellIndex} needs broad authored texture`);
      assert.ok(texture.largestCluster >= 18, `${kit} ground ${cellIndex} needs clustered patches`);
      assert.ok(texture.singletonRatio <= 0.12, `${kit} ground ${cellIndex} forbids uniform one-pixel confetti`);
    }

    assert.ok(plan.routeTiles.length >= 18, `${kit} proof needs a substantial route`);
    assert.equal(tileSetIsCardinallyConnected(plan.routeTiles), true, `${kit} route must be cardinally connected`);
    assert.equal(
      plan.routeTiles.some(({ x, y }) => x === 0 || y === 0 || x === 23 || y === 15),
      true,
      `${kit} route must enter the proof from an edge`,
    );
    assert.equal(
      plan.routeTiles.some(({ x, y }) => x === plan.yard.doorTile.x && y === plan.yard.doorTile.y),
      true,
      `${kit} route must terminate at the occupied yard door`,
    );
    assert.ok(plan.terrainPatches.length >= 2 && plan.terrainPatches.length <= 3, `${kit} needs two or three broad terrain patches`);
    for (const [patchIndex, patch] of plan.terrainPatches.entries()) {
      assert.ok(patch.length >= 12, `${kit} terrain patch ${patchIndex} must be broad`);
      assert.equal(tileSetIsCardinallyConnected(patch), true, `${kit} terrain patch ${patchIndex} must be joined`);
    }

    const wet = kit === "spring-terraces" || kit === "neutral-temperate";
    if (wet) {
      assert.ok(plan.waterTiles.length >= 12, `${kit} needs a real connected water body`);
      assert.ok(plan.shoreTiles.length >= 10, `${kit} needs a truthful shoreline`);
      assert.equal(tileSetIsCardinallyConnected(plan.waterTiles), true, `${kit} water body must be joined`);
      assert.equal(tileSetIsCardinallyConnected(plan.shoreTiles), true, `${kit} shoreline must be joined`);
    } else {
      assert.deepEqual(plan.waterTiles, [], `${kit} is waterless`);
      assert.deepEqual(plan.shoreTiles, [], `${kit} is waterless`);
    }

    assert.ok(plan.landmarks.length >= 4, `${kit} proof needs landmark hierarchy`);
    assert.ok(plan.supports.length >= 8, `${kit} proof needs supporting scenery clusters`);
    for (const landmark of plan.landmarks) {
      const centerX = landmark.x + 64;
      const centerY = landmark.y + 64;
      const supportDistance = Math.min(...plan.supports.map((support) => Math.hypot(
        centerX - (support.x + 16),
        centerY - (support.y + 16),
      )));
      const routeDistance = Math.min(...plan.routeTiles.map((tile) => Math.hypot(
        centerX - (tile.x * 32 + 16),
        centerY - (tile.y * 32 + 16),
      )));
      assert.ok(supportDistance <= 96, `${kit}/${landmark.semanticKind} must overlap a support cluster`);
      assert.ok(routeDistance <= 128, `${kit}/${landmark.semanticKind} must belong to the traversable scene`);
    }

    const proofRaw = await sharp(proof).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([proofRaw.info.width, proofRaw.info.height], [768, 512], `${kit} native proof geometry`);
    const routeComponents = connectedComponents(rgbaPointsForPalette(proofRaw, plan.pathColors));
    const route = routeComponents.sort((left, right) => right.length - left.length)[0] ?? [];
    const routeSpanX = route.length === 0 ? 0 : Math.max(...route.map(({ x }) => x)) - Math.min(...route.map(({ x }) => x)) + 1;
    const routeSpanY = route.length === 0 ? 0 : Math.max(...route.map(({ y }) => y)) - Math.min(...route.map(({ y }) => y)) + 1;
    assert.ok(route.length >= 4_500, `${kit} route needs one substantial connected pixel mass`);
    assert.ok(routeSpanX >= 420 && routeSpanY >= 180, `${kit} route must organize the full proof, not float as an icon`);
  }
});

test("RED Task12R R3.1: proofs balance calm terrain variants and organic wet bodies without route wallpaper", async () => {
  const preview = await productionPacker.buildRegionalR3DiagnosticAuthoring();
  for (const kit of REGION_KITS) {
    const plan = preview.compositionPlans[kit];
    assert.ok(Array.isArray(plan.groundTiles), `${kit} proof must persist deterministic ground-variant truth`);
    assert.ok(plan.groundTiles.length >= 220, `${kit} proof needs enough visible ground to assess negative space`);
    const variantCounts = new Map();
    for (const tile of plan.groundTiles) variantCounts.set(tile.variant, (variantCounts.get(tile.variant) ?? 0) + 1);
    assert.ok(variantCounts.size >= 4, `${kit} proof needs at least four materially distinct ground variants`);
    assert.ok(
      Math.max(...variantCounts.values()) / plan.groundTiles.length <= 0.22,
      `${kit} no ground motif may dominate the background`,
    );
    const groundByCoordinate = new Map(plan.groundTiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
    let adjacentPairs = 0;
    let adjacentRepeats = 0;
    for (const tile of plan.groundTiles) for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const neighbor = groundByCoordinate.get(`${tile.x + dx},${tile.y + dy}`);
      if (!neighbor) continue;
      adjacentPairs += 1;
      if (neighbor.variant === tile.variant) adjacentRepeats += 1;
    }
    assert.ok(adjacentRepeats / adjacentPairs <= 0.22, `${kit} forbids wallpaper-like adjacent variant repetition`);

    const terrainRaw = await sharp(preview.buffers[`${kit}-terrain`]).ensureAlpha().raw()
      .toBuffer({ resolveWithObject: true });
    const profiles = Array.from({ length: 8 }, (_unused, cellIndex) => (
      cellTextureStats(terrainRaw, cellIndex, 8, 32, 32)
    ));
    assert.ok(profiles.filter(({ texturePixels }) => texturePixels <= 145).length >= 3, `${kit} needs at least three calm ground variants`);
    assert.ok(profiles.filter(({ texturePixels }) => texturePixels >= 170 && texturePixels <= 290).length >= 3, `${kit} needs at least three clustered ground variants`);
    const materialProfiles = new Set(profiles.map(({ texturePixels, componentCount, largestCluster }) => (
      `${Math.round(texturePixels / 16)}:${Math.round(componentCount / 2)}:${Math.round(largestCluster / 8)}`
    )));
    assert.ok(materialProfiles.size >= 4, `${kit} ground variants need visibly different coverage and cluster structure`);
    const quietVariants = new Set(profiles.map((profile, variant) => ({ ...profile, variant }))
      .filter(({ texturePixels }) => texturePixels <= 145).map(({ variant }) => variant));
    const quietTiles = plan.groundTiles.filter(({ variant }) => quietVariants.has(variant));
    assert.ok(quietTiles.length / plan.groundTiles.length >= 0.34, `${kit} proof needs broad calm negative space`);
    assert.ok(
      Math.max(...connectedComponents(quietTiles).map((component) => component.length)) >= 10,
      `${kit} calm ground must form a readable value mass, not isolated quiet checks`,
    );

    for (const cellIndex of [0, 1]) {
      const atlasCell = 8 + cellIndex;
      const originX = atlasCell % 8 * 32;
      const originY = Math.floor(atlasCell / 8) * 32;
      const light = plan.pathColors[2].join(",");
      let lightPixels = 0;
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
        const offset = ((originY + y) * terrainRaw.info.width + originX + x) * 4;
        if (`${terrainRaw.data[offset]},${terrainRaw.data[offset + 1]},${terrainRaw.data[offset + 2]}` === light) lightPixels += 1;
      }
      assert.ok(lightPixels <= 48, `${kit} path ${cellIndex} must avoid repeated full-tile inset-stone borders`);
    }

    if (kit === "spring-terraces" || kit === "neutral-temperate") {
      const waterRows = rowWidthVariation(plan.waterTiles);
      const shoreRows = rowWidthVariation(plan.shoreTiles);
      assert.ok(new Set(waterRows.map(({ width }) => width)).size >= 3, `${kit} water body needs irregular row widths`);
      assert.ok(new Set(shoreRows.map(({ width }) => width)).size >= 3, `${kit} shore needs irregular row widths`);
      const waterBoundsArea = (Math.max(...plan.waterTiles.map(({ x }) => x)) - Math.min(...plan.waterTiles.map(({ x }) => x)) + 1)
        * (Math.max(...plan.waterTiles.map(({ y }) => y)) - Math.min(...plan.waterTiles.map(({ y }) => y)) + 1);
      assert.ok(plan.waterTiles.length / waterBoundsArea <= 0.78, `${kit} water body must not fill a rectangular tile block`);
      const waterKeys = new Set(plan.waterTiles.map(({ x, y }) => `${x},${y}`));
      const touchingWater = plan.shoreTiles.filter(({ x, y }) => (
        [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => waterKeys.has(`${x + dx},${y + dy}`))
      ));
      assert.ok(touchingWater.length / plan.shoreTiles.length >= 0.64, `${kit} shore must truthfully follow the water body`);
    }
  }
});

test("RED Task12R R4: candidate geometry, authored variants, and proof bytes fail closed", async () => {
  const expectedEvidenceNames = expectedRegionalR4EvidenceNames();
  assert.equal(expectedEvidenceNames.length, 41, "R4 review requires exactly 41 evidence names");
  assert.equal(new Set(expectedEvidenceNames).size, 41, "R4 evidence contract may not contain duplicate names");
  assert.equal(expectedEvidenceNames.filter((name) => name.includes("-terrain-")).length, 10,
    "R4 evidence must include native and nearest terrain sheets for all five kits");

  const cell = (vertical) => {
    const bytes = Buffer.alloc(4 * 4 * 4);
    for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
      const offset = (y * 4 + x) * 4;
      const accent = vertical ? x < 2 : y < 2;
      bytes.set(accent ? [40, 60, 80, 255] : [160, 180, 200, 255], offset);
    }
    return bytes;
  };
  const distinctCells = [{ id: "vertical", bytes: cell(true) }, { id: "horizontal", bytes: cell(false) }];
  assert.doesNotThrow(() => assertDistinctCellFamily("oracle-control", distinctCells, {
    maximumIdentityRatio: 0.92,
  }));
  const hostileCells = [{ id: "vertical", bytes: distinctCells[0].bytes }, {
    id: "duplicate",
    bytes: Buffer.from(distinctCells[0].bytes),
  }];
  assert.throws(
    () => assertDistinctCellFamily("oracle-hostile", hostileCells, { maximumIdentityRatio: 0.92 }),
    /duplicate raw cell bytes/,
    "test-local duplicate cell buffers must fail the R4 distinctness oracle",
  );

  const distinctPlans = Object.fromEntries(REGION_KITS.map((kit, index) => [kit, {
    routeTiles: [{ x: index, y: 0 }],
    landmarks: [{ x: index * 2, y: 1 }],
    supports: [{ x: index * 3, y: 2 }],
  }]));
  assert.doesNotThrow(() => assertUniquePlanHashes(distinctPlans, ["routeTiles", "landmarks", "supports"]));
  const hostilePlans = structuredClone(distinctPlans);
  hostilePlans[REGION_KITS[1]].routeTiles = structuredClone(hostilePlans[REGION_KITS[0]].routeTiles);
  assert.throws(
    () => assertUniquePlanHashes(hostilePlans, ["routeTiles", "landmarks", "supports"]),
    /routeTiles.*unique layout hash/,
    "test-local duplicate plan hashes must fail the R4 layout oracle",
  );

  const bindingSpec = {
    REGIONAL_R4_VARIANT_RECIPES: Object.fromEntries(REGION_KITS.map((kit, index) => [kit, {
      ground: [{ id: `${kit}-ground-${index}`, points: [[index, 0], [index + 1, 1]] }],
      landmarks: [{ id: `${kit}-landmark-${index}`, points: [[index, 2], [index + 2, 3]] }],
      yards: [{ id: `${kit}-yard-${index}`, points: [[index, 4], [index + 3, 5]] }],
    }])),
    REGIONAL_R4_SCENE_PLANS: structuredClone(distinctPlans),
  };
  const bindingPreview = {
    compositionPlans: structuredClone(bindingSpec.REGIONAL_R4_SCENE_PLANS),
    recipeDigests: Object.fromEntries(REGION_KITS.map((kit) => [kit, {
      terrain: oracleHash(bindingSpec.REGIONAL_R4_VARIANT_RECIPES[kit].ground),
      landmarks: oracleHash(bindingSpec.REGIONAL_R4_VARIANT_RECIPES[kit].landmarks),
      yards: oracleHash(bindingSpec.REGIONAL_R4_VARIANT_RECIPES[kit].yards),
      scene: oracleHash(bindingSpec.REGIONAL_R4_SCENE_PLANS[kit]),
    }])),
  };
  assert.doesNotThrow(() => assertCandidateSpecBinding(bindingPreview, bindingSpec));
  const hostileDigestBinding = structuredClone(bindingPreview);
  hostileDigestBinding.recipeDigests[REGION_KITS[0]].terrain = "0".repeat(64);
  assert.throws(
    () => assertCandidateSpecBinding(hostileDigestBinding, bindingSpec),
    /recipe digest must canonically bind the R4 spec/,
    "test-local arbitrary digest strings must fail canonical spec binding",
  );
  const hostilePlanBinding = structuredClone(bindingPreview);
  hostilePlanBinding.compositionPlans[REGION_KITS[0]].routeTiles[0].x += 1;
  assert.throws(
    () => assertCandidateSpecBinding(hostilePlanBinding, bindingSpec),
    /composition plan must canonically equal the R4 scene plan/,
    "test-local candidate plan drift must fail canonical spec binding",
  );

  const contactPreview = { nativeContract: { atlases: {} }, compositionPlans: {} };
  for (const kit of REGION_KITS) {
    const variantId = `${kit}:oracle-landmark`;
    contactPreview.nativeContract.atlases[`${kit}-landmarks`] = {
      cellWidth: 128,
      cellHeight: 128,
      authoredVariants: [{ variantId, cellIndex: 0, contactPivotPx: { x: 64, y: 96 } }],
    };
    contactPreview.nativeContract.atlases[`${kit}-scenery`] = {
      width: 512,
      height: 256,
      cellWidth: 32,
      cellHeight: 32,
    };
    contactPreview.compositionPlans[kit] = {
      landmarks: [{ variantId, cell: 0, x: 64, y: 64 }],
      supports: [
        { clusterId: "oracle-cluster", role: "understory", landmarkVariantId: variantId,
          cell: 0, x: 80, y: 144 },
        { clusterId: "oracle-cluster", role: "edge", landmarkVariantId: variantId,
          cell: 1, x: 112, y: 160 },
      ],
    };
  }
  assert.doesNotThrow(() => assertSemanticSupportContact(contactPreview));
  const forgedLandmarkBounds = structuredClone(contactPreview);
  forgedLandmarkBounds.compositionPlans[REGION_KITS[0]].landmarks[0].contactBounds = {
    x: 80,
    y: 128,
    width: 96,
    height: 64,
  };
  assert.throws(
    () => assertSemanticSupportContact(forgedLandmarkBounds),
    /candidate-supplied contactBounds override is forbidden/,
    "test-local landmark bounds may not forge contact",
  );
  const forgedSupportBounds = structuredClone(contactPreview);
  forgedSupportBounds.compositionPlans[REGION_KITS[0]].supports[0].bounds = {
    x: 80,
    y: 144,
    width: 32,
    height: 32,
  };
  assert.throws(
    () => assertSemanticSupportContact(forgedSupportBounds),
    /candidate-supplied support bounds override is forbidden/,
    "test-local support bounds may not forge contact",
  );

  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  assert.deepEqual(productionPacker.validateNativeContractSchema(preview.nativeContract), []);
  assert.deepEqual(
    await productionPacker.validateRegionalCompositionContract(preview.nativeContract, preview.buffers),
    [],
  );
  assert.equal(typeof productionPacker.validateRegionalR4Candidate, "function",
    "R4 candidate must expose the aggregate validator used before proof publication");
  assert.deepEqual(await productionPacker.validateRegionalR4Candidate(preview), []);

  let regionalR4Spec;
  try {
    regionalR4Spec = await import("./regional-art-r4-spec.mjs");
  } catch (error) {
    assert.fail(`regional-art-r4-spec.mjs is required (${error.code ?? error.message})`);
  }
  assert.ok(regionalR4Spec.REGIONAL_R4_VARIANT_RECIPES, "REGIONAL_R4_VARIANT_RECIPES export required");
  assert.ok(regionalR4Spec.REGIONAL_R4_SCENE_PLANS, "REGIONAL_R4_SCENE_PLANS export required");
  assert.equal(typeof regionalR4Spec.validateRegionalR4Spec, "function", "validateRegionalR4Spec export required");
  assert.deepEqual(regionalR4Spec.validateRegionalR4Spec(), []);
  assert.doesNotThrow(() => groundVariantsByCoordinate(
    regionalR4Spec.REGIONAL_R4_SCENE_PLANS[REGION_KITS[0]],
    REGION_KITS[0],
  ));
  const hostileMissingGrid = structuredClone(regionalR4Spec.REGIONAL_R4_SCENE_PLANS[REGION_KITS[0]]);
  delete hostileMissingGrid.groundRecipeGrid;
  assert.throws(() => groundVariantsByCoordinate(hostileMissingGrid, "oracle-missing-grid"),
    /groundRecipeGrid array required/);
  const hostileGridShape = structuredClone(regionalR4Spec.REGIONAL_R4_SCENE_PLANS[REGION_KITS[0]]);
  hostileGridShape.groundRecipeGrid[0].pop();
  assert.throws(() => groundVariantsByCoordinate(hostileGridShape, "oracle-grid-shape"),
    /exactly 24 columns/);
  assertCandidateSpecBinding(preview, regionalR4Spec);

  await assertVariantPixelDistinctness(preview, { maximumIdentityRatio: 0.92 });
  assertUniquePlanHashes(preview.compositionPlans, ["routeTiles", "landmarks", "supports"]);
  assertSemanticSupportContact(preview);
  await assertGroundMaskAutocorrelation(preview, {
    shifts: [1, 2, 3, 4, 5, 6, 7, 8],
    maximum: 0.35,
  });
  await assertYardTopology(preview, { foundationCoverageMin: 0.25, doorWidthPx: 32, sockets: 0 });
  await assertCandidateBudgets(preview);

  assert.equal(typeof productionPacker.regionalR4EvidenceNames, "function",
    "proof writer must expose its exact terrain-inclusive R4 evidence inventory");
  assert.equal(typeof productionPacker.writeRegionalR4Proofs, "function",
    "R4 proof writer must be exported for validated CLI publication");
  const actualEvidenceNames = productionPacker.regionalR4EvidenceNames();
  assert.equal(new Set(actualEvidenceNames).size, 41, "R4 proof evidence names must be unique");
  assert.deepEqual(actualEvidenceNames, [...actualEvidenceNames].sort(),
    "R4 evidence inventory must remain lexical for deterministic staging");
  assert.deepEqual([...actualEvidenceNames].sort(), expectedEvidenceNames);
});

test("Task12R R4 aggregate validator returns named errors for malformed candidate shape", async () => {
  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  const hostile = {
    ...preview,
    nativeContract: structuredClone(preview.nativeContract),
    buffers: { ...preview.buffers },
    proofs: { ...preview.proofs },
    compositionPlans: structuredClone(preview.compositionPlans),
    recipeDigests: structuredClone(preview.recipeDigests),
    proofDigests: structuredClone(preview.proofDigests),
    budgetProjection: structuredClone(preview.budgetProjection),
    evidenceNames: [...(preview.evidenceNames ?? [])],
  };
  delete hostile.buffers["worn-heartland-terrain"];
  hostile.buffers["spring-terraces-terrain"] = "not-buffer";
  hostile.buffers["oracle-extra-buffer"] = Buffer.from("extra");
  delete hostile.proofs["worn-heartland"];
  hostile.proofs["spring-terraces"] = "not-buffer";
  hostile.proofs["oracle-extra-proof"] = Buffer.from("extra");
  delete hostile.proofDigests?.["worn-heartland"];
  if (hostile.proofDigests) hostile.proofDigests["oracle-extra-proof"] = "0".repeat(64);
  hostile.nativeContract.atlases["oracle-extra-atlas"] = {};
  hostile.budgetProjection = null;
  hostile.evidenceNames = ["../escape.png", "duplicate.png", "duplicate.png"];

  let errors;
  await assert.doesNotReject(async () => { errors = await productionPacker.validateRegionalR4Candidate(hostile); },
    "malformed candidate shape must aggregate named errors instead of leaking a TypeError or Sharp error");
  for (const expected of [
    "candidate buffers must contain exactly 15 canonical keys",
    "spring-terraces-terrain: candidate buffer must be a Buffer",
    "candidate proofs must contain exactly five canonical keys",
    "spring-terraces: candidate proof must be a Buffer",
    "candidate proofDigests must contain exactly five canonical keys",
    "candidate native contract must contain exactly 53 atlases",
    "candidate budgetProjection requires canonical report and errors",
    "candidate evidenceNames must equal the exact 41-name inventory",
    "candidate evidenceNames must use unique basenames",
  ]) assert.ok(errors.includes(expected), `missing aggregate shape error: ${expected}\n${errors.join("\n")}`);
});

test("Task12R R4 aggregate validator closes atlas, plan, and digest key inventories", async () => {
  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  const hostile = {
    ...preview,
    nativeContract: structuredClone(preview.nativeContract),
    buffers: { ...preview.buffers },
    proofs: { ...preview.proofs },
    compositionPlans: structuredClone(preview.compositionPlans),
    recipeDigests: structuredClone(preview.recipeDigests),
    proofDigests: structuredClone(preview.proofDigests),
    budgetProjection: structuredClone(preview.budgetProjection),
    evidenceNames: [...preview.evidenceNames],
  };
  const facePlaneAtlas = hostile.nativeContract.atlases["core-human-face-planes"];
  delete hostile.nativeContract.atlases["core-human-face-planes"];
  hostile.nativeContract.atlases["oracle-replacement-atlas"] = facePlaneAtlas;
  delete hostile.compositionPlans["worn-heartland"];
  hostile.compositionPlans["oracle-extra-plan"] = preview.compositionPlans["worn-heartland"];
  delete hostile.recipeDigests["spring-terraces"];
  hostile.recipeDigests["oracle-extra-kit"] = preview.recipeDigests["spring-terraces"];
  delete hostile.recipeDigests["worn-heartland"].terrain;
  hostile.recipeDigests["worn-heartland"]["oracle-extra-digest"] = "0".repeat(64);
  hostile.nativeContract.oracleExtraContractField = true;
  hostile.budgetProjection.oracleExtraBudgetField = true;

  const errors = await productionPacker.validateRegionalR4Candidate(hostile);
  for (const expected of [
    "candidate native contract is missing canonical atlas core-human-face-planes",
    "candidate native contract contains unexpected atlas oracle-replacement-atlas",
    "candidate compositionPlans must contain exactly five canonical kit keys",
    "candidate recipeDigests must contain exactly five canonical kit keys",
    "worn-heartland: candidate recipeDigests must contain exactly terrain, landmarks, yards, and scene",
    "candidate nativeContract keys must equal the trusted persisted contract schema",
    "candidate budgetProjection must contain exactly report and errors",
  ]) assert.ok(errors.includes(expected), `missing exact inventory error: ${expected}\n${errors.join("\n")}`);
});

test("Task12R R4 aggregate validator recomputes proofs and budget projection", async () => {
  const preview = await productionPacker.buildRegionalCompositionAuthoring();
  const hostile = {
    ...preview,
    nativeContract: structuredClone(preview.nativeContract),
    buffers: { ...preview.buffers },
    proofs: { ...preview.proofs, "worn-heartland": Buffer.from("not-a-png") },
    compositionPlans: structuredClone(preview.compositionPlans),
    recipeDigests: structuredClone(preview.recipeDigests),
    proofDigests: { ...preview.proofDigests, "worn-heartland": sha256(Buffer.from("not-a-png")) },
    budgetProjection: structuredClone(preview.budgetProjection),
    evidenceNames: [...preview.evidenceNames],
  };
  hostile.budgetProjection.report.exactPeakActiveDecodedBytes["worn-heartland"] += 1;
  hostile.budgetProjection.errors = ["forged-budget-pass"];
  const errors = await productionPacker.validateRegionalR4Candidate(hostile);
  assert.ok(errors.includes("worn-heartland: candidate proof PNG is unreadable"), errors.join("\n"));
  assert.ok(errors.includes("candidate budgetProjection report drifted from recomputation"), errors.join("\n"));
  assert.ok(errors.includes("candidate budgetProjection errors drifted from recomputation"), errors.join("\n"));
});

test("binds every biome scenery kind to a deep deterministic variant bank", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  for (const kit of ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"]) {
    const scenery = contract.atlases[`${kit}-scenery`];
    const kinds = Object.keys(scenery.semanticSceneryCells);
    assert.deepEqual(Object.keys(scenery.semanticSceneryVariants), kinds, `${kit} variant kinds`);
    const allCells = [];
    for (const kind of kinds) {
      const variants = scenery.semanticSceneryVariants[kind];
      assert.equal(variants.length, 32, `${kit}/${kind} must expose 32 authored variants`);
      assert.equal(variants[0], scenery.semanticSceneryCells[kind], `${kit}/${kind} primary cell`);
      assert.equal(new Set(variants).size, variants.length, `${kit}/${kind} variant cells`);
      allCells.push(...variants);
    }
    assert.equal(new Set(allCells).size, 128, `${kit} scenery variants must own all cells once`);
    assert.ok(allCells.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < 128));
  }
});

test("persists the exact native scenery variant contract through the reviewed compact stride", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  for (const kit of ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"]) {
    const runtimePack = JSON.parse(await readFile(
      new URL(`../src/assets/renderer2d/regions/${kit}/pack.json`, import.meta.url),
      "utf8",
    ));
    assert.equal(runtimePack.semanticSceneryVariantStride, 4);
    const reconstructed = Object.fromEntries(Object.entries(runtimePack.semanticSceneryCells).map(
      ([kind, primary]) => [kind, Array.from({ length: 32 }, (_unused, variant) => primary + variant * 4)],
    ));
    assert.deepEqual(
      reconstructed,
      contract.atlases[`${kit}-scenery`].semanticSceneryVariants,
      `${kit} compact runtime stride must reconstruct the exact native variant arrays`,
    );
  }
});

test("keeps ash blocking scenery crop banks in their named visual class", () => {
  const ash = productionPacker.REGION_GUIDE_SCENERY?.["ash-waste"];
  assert.ok(ash, "the curated guide crop inventory must be exported for semantic review");
  assert.deepEqual(ash["charred-trunk"], [
    [1023, 444, 59, 53],
    [1094, 443, 53, 54],
    [1162, 436, 43, 69],
    [1158, 432, 51, 77],
  ], "charred-trunk must contain woody stump/tree silhouettes, never utility props or rock crags");
  assert.deepEqual(ash["slag-rock"], [
    [941, 438, 68, 61],
    [946, 523, 65, 80],
    [1030, 525, 70, 75],
    [1115, 520, 79, 82],
  ], "slag-rock must contain rock/crag silhouettes, never dead trees");
});

test("semantic region authoring is deterministic and immediately satisfies normal check mode", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const terrainPath = path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/regions/worn-heartland/terrain.png",
    );
    const first = await runSandboxPacker(sandbox, ["--author-semantic-regions"]);
    assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
    const firstHash = sha256(await readFile(terrainPath));
    const second = await runSandboxPacker(sandbox, ["--author-semantic-regions"]);
    assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(sha256(await readFile(terrainPath)), firstHash, "semantic native authoring must be byte-stable");
    const check = await runSandboxPacker(sandbox, ["--check"]);
    assert.equal(check.code, 0, `${check.stdout}\n${check.stderr}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("guide promotion is deterministic and immediately satisfies strict normal check mode", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const regionFiles = ["terrain.png", "scenery.png", "environment.png"].map((name) => path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/regions/ash-waste",
      name,
    ));
    const first = await runSandboxPacker(sandbox, ["--author-guide-regions"]);
    assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
    const firstHashes = await Promise.all(regionFiles.map(async (filename) => sha256(await readFile(filename))));
    const second = await runSandboxPacker(sandbox, ["--author-guide-regions"]);
    assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
    assert.deepEqual(
      await Promise.all(regionFiles.map(async (filename) => sha256(await readFile(filename)))),
      firstHashes,
      "guide-promoted region masters must be byte-stable",
    );
    const check = await runSandboxPacker(sandbox, ["--check"]);
    assert.equal(check.code, 0, `${check.stdout}\n${check.stderr}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("human-hair authoring is deterministic and immediately satisfies strict normal check mode", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const hairPath = path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/core/human-hair.png",
    );
    const first = await runSandboxPacker(sandbox, ["--author-human-hair"]);
    assert.equal(first.code, 0, `${first.stdout}\n${first.stderr}`);
    const firstHash = sha256(await readFile(hairPath));
    const second = await runSandboxPacker(sandbox, ["--author-human-hair"]);
    assert.equal(second.code, 0, `${second.stdout}\n${second.stderr}`);
    assert.equal(
      sha256(await readFile(hairPath)),
      firstHash,
      "human-hair native authoring must be byte-stable",
    );
    const check = await runSandboxPacker(sandbox, ["--check"]);
    assert.equal(check.code, 0, `${check.stdout}\n${check.stderr}`);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("normal production packing reads native masters while frozen atlases remain hash-only references", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const nativeBody = path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/core/human-body-rigs.png",
    );
    await mutateInteriorPixel(nativeBody);
    const result = await runSandboxPacker(sandbox, ["--check"]);
    assert.notEqual(
      result.code,
      0,
      "changing a native production master must change the expected packed bytes",
    );
    assert.match(`${result.stdout}\n${result.stderr}`, /native|source|drift|validation/i);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }

  const packerSource = await readFile(PACKER_SOURCE, "utf8");
  assert.match(packerSource, /NATIVE_ROOT/);
  assert.equal(
    /build(?:Core|Region|Home)SurfacesFromFrozen/.test(packerSource),
    false,
    "normal packing must not decode, decompose, recolor, or rebuild from frozen runtime atlases",
  );
});

test("canonicalizes shuffled production source inventory without changing bytes or report order", () => {
  const original = [
    { id: "z", path: "regions/z.png", cells: ["b", "a"] },
    { id: "a", path: "core/a.png", cells: ["d", "c"] },
  ];
  const first = canonicalizeProductionInventory(original);
  const second = canonicalizeProductionInventory([...original].reverse());
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.map(({ id }) => id), ["a", "z"]);
});

test("accepts native binary-alpha cells with at most three shades and one-pixel outlines", async () => {
  const report = await analyzeRuntimeAtlas(await outlinedCell(), atlasContract());
  assert.deepEqual(report.errors, []);
  assert.equal(report.binaryAlpha, true);
  assert.equal(report.runtimeResized, false);
  assert.equal(report.maxShadesPerMaterial, 3);
  assert.equal(report.maxOutlineWidth, 1);
  assert.equal(report.decodedBytes, 8 * 8 * 4);
});

test("rejects anti-aliased alpha, a fourth material shade, two-pixel outlines, and runtime rescale", async () => {
  const antialiased = await analyzeRuntimeAtlas(
    await outlinedCell({ alpha: 128 }),
    atlasContract(),
  );
  assert.match(antialiased.errors.join("\n"), /binary alpha|anti-alias/i);

  const fourthShade = await analyzeRuntimeAtlas(
    await outlinedCell({ fourthShade: true }),
    atlasContract({ materialRamps: {
      cloth: [[80, 48, 32], [104, 64, 40], [128, 80, 48], [152, 96, 56]],
    } }),
  );
  assert.match(fourthShade.errors.join("\n"), /three shades|fourth shade/i);

  const thick = await analyzeRuntimeAtlas(
    await outlinedCell({ doubleOutline: true }),
    atlasContract(),
  );
  assert.match(thick.errors.join("\n"), /1-pixel outline|outline width/i);

  const resized = await analyzeRuntimeAtlas(
    await outlinedCell(),
    atlasContract({ sourceCellWidth: 16, sourceCellHeight: 16 }),
  );
  assert.match(resized.errors.join("\n"), /rescal|native source cell/i);
});

test("rejects unknown opaque colors and exposed silhouettes with a missing outline pixel", async () => {
  const unknown = await analyzeRuntimeAtlas(
    await outlinedCell({ unknownColor: true }),
    atlasContract(),
  );
  assert.match(unknown.errors.join("\n"), /unknown|undeclared|palette/i);

  const missing = await analyzeRuntimeAtlas(
    await outlinedCell({ missingOutline: true }),
    atlasContract(),
  );
  assert.match(missing.errors.join("\n"), /missing.*outline|exposed.*outline/i);
});

test("rejects a fully missing exposed outline edge", async () => {
  const missingFullEdge = await rgbaPng(8, 8, (x, y) => {
    if (x === 0 || y === 0 || x === 7 || y === 7) return [0, 0, 0, 0];
    const boundary = x === 1 || y === 1 || x === 6 || y === 6;
    if (boundary && x !== 1) return [24, 20, 18, 255];
    return [80, 48, 32, 255];
  });
  const missing = await analyzeRuntimeAtlas(missingFullEdge, atlasContract());
  assert.match(
    missing.errors.join("\n"),
    /missing.*outline|exposed.*outline/i,
    "every exposed silhouette edge must be outlined, not only one-pixel gaps bracketed by outline",
  );
});

test("rejects an exploded corner-exception list", async () => {
  const exceptionExplosion = await analyzeRuntimeAtlas(
    await outlinedCell(),
    atlasContract({
      outlineCornerExceptions: Array.from({ length: 64 }, (_unused, index) => ({
        x: index % 8,
        y: Math.floor(index / 8),
      })),
    }),
  );
  assert.match(
    exceptionExplosion.errors.join("\n"),
    /corner.*exception.*budget|too many.*exception|exception explosion/i,
    "corner exceptions must remain a bounded authored list rather than blanket-whitelisting an atlas",
  );
});

test("native palette contracts use semantic ramps and bounded authored corner exceptions", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  assert.equal(Object.keys(contract.atlases ?? {}).length, 53);
  const semanticRampFailures = (materialRamps, { nontrivial = true } = {}) => {
    const failures = [];
    const entries = Object.entries(materialRamps ?? {});
    for (const [name, shades] of entries) {
      if (!/^[a-z]+(?:-[a-z]+)+$/.test(name) || /(?:^|-)[0-9]+(?:-|$)/.test(name)) {
        failures.push(`${name}: material ramp must use a named semantic family without numeric enumeration`);
      }
      if (!Array.isArray(shades) || shades.length < 1 || shades.length > 3) {
        failures.push(`${name}: material ramp must contain one to three shades`);
      }
    }
    const declaredColors = entries.reduce((sum, [_name, shades]) => (
      sum + (Array.isArray(shades) ? shades.length : 0)
    ), 0);
    if (nontrivial && declaredColors >= 4 && !entries.some(([_name, shades]) => (
      Array.isArray(shades) && shades.length >= 2 && shades.length <= 3
    ))) {
      failures.push("nontrivial atlas must declare at least one named two- or three-shade material family");
    }
    return failures;
  };
  assert.deepEqual(
    semanticRampFailures({
      "skin-warm": [[111, 72, 51], [174, 124, 86], [220, 160, 108]],
      "hair-chestnut": [[44, 24, 24], [74, 50, 38]],
      "cloth-olive": [[79, 113, 72], [105, 128, 99], [180, 196, 124]],
      "timber-worn": [[84, 68, 52], [140, 108, 68]],
      "plaster-cream": [[204, 188, 156], [228, 212, 180]],
      "stone-ash": [[68, 64, 72], [100, 92, 108]],
    }),
    [],
    "genuinely named semantic families with two or three shades must remain valid",
  );
  const authoredCellCount = (id) => {
    if (id === "core-human-body-rigs") return 344;
    if (id === "core-human-face-planes") return 64;
    if (id === "core-human-hair") return 192;
    if (/^core-human-clothing-\d{2}$/.test(id)) return 172;
    if (id === "core-human-held") return 64;
    if (id === "core-human-status-effects") return 128;
    if (id.endsWith("-terrain")) return 64;
    if (id.endsWith("-scenery")) return 128;
    if (id.endsWith("-environment")) return 32;
    if (id.endsWith("-home-components")) return 24;
    if (id.endsWith("-home-details")) return 32;
    if (id.endsWith("-home-ruins")) return 8;
    if (id.endsWith("-landmarks")) return 8;
    if (id.endsWith("-home-yards")) return 5;
    throw new Error(`unknown production atlas ${id}`);
  };
  const failures = [];
  let rampCount = 0;
  let singletonRampCount = 0;
  for (const [id, atlas] of Object.entries(contract.atlases ?? {})) {
    const ramps = Object.entries(atlas.materialRamps ?? {});
    rampCount += ramps.length;
    singletonRampCount += ramps.filter(([_name, shades]) => shades.length === 1).length;
    failures.push(...semanticRampFailures(atlas.materialRamps)
      .map((failure) => `${id}: ${failure}`));
    const exceptionCount = atlas.outlineCornerExceptions?.length ?? 0;
    const exceptionLimit = authoredCellCount(id) * 4;
    if (exceptionCount > exceptionLimit) {
      failures.push(`${id}: corner exceptions=${exceptionCount}, authored limit=${exceptionLimit}`);
    }
  }
  if (rampCount === 0 || singletonRampCount / rampCount > 0.25) {
    failures.unshift(`native contract singleton ramps=${singletonRampCount}/${rampCount}; maximum is 25%`);
  }
  assert.deepEqual(failures.slice(0, 32), [], failures.slice(0, 32).join("\n"));
});

test("exports packer-boundary native-contract schema validation and accepts the fixed contract", async () => {
  assert.equal(
    typeof productionPacker.validateNativeContractSchema,
    "function",
    "packer must export validateNativeContractSchema(contract)",
  );
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  assert.deepEqual(productionPacker.validateNativeContractSchema(contract), []);
});

test("native-contract schema rejects semantic-name, singleton, family, duplicate, and ordering drift", () => {
  const validate = productionPacker.validateNativeContractSchema ?? (() => []);
  const valid = {
    schema: 1,
    atlases: {
      sample: {
        materialRamps: {
          "skin-warm": [[52, 36, 28], [156, 96, 68], [220, 148, 100]],
          "hair-chestnut": [[44, 24, 24], [97, 63, 45]],
          "cloth-olive": [[79, 113, 72], [180, 196, 124]],
          "feature-ink": [[16, 6, 11]],
        },
      },
    },
  };
  assert.deepEqual(validate(valid), []);

  for (const [label, mutate, pattern] of [
    ["numeric ramp name", (contract) => {
      contract.atlases.sample.materialRamps["cloth-00"] = contract.atlases.sample.materialRamps["cloth-olive"];
      delete contract.atlases.sample.materialRamps["cloth-olive"];
    }, /numeric|semantic.*name|cloth-00/i],
    ["generic generated ramp name", (contract) => {
      contract.atlases.sample.materialRamps["semantic-prefix-N"] = contract.atlases.sample.materialRamps["cloth-olive"];
      delete contract.atlases.sample.materialRamps["cloth-olive"];
    }, /generic|semantic.*name|semantic-prefix/i],
    ["global singleton ratio", (contract) => {
      contract.atlases.sample.materialRamps = {
        "skin-warm": [[52, 36, 28], [156, 96, 68], [220, 148, 100]],
        "feature-ink": [[16, 6, 11]],
        "accent-copper": [[196, 108, 92]],
        "accent-cream": [[248, 228, 184]],
      };
    }, /singleton.*25|25.*singleton/i],
    ["nontrivial atlas without a family", (contract) => {
      contract.atlases.sample.materialRamps = {
        "accent-ink": [[16, 6, 11]],
        "accent-copper": [[196, 108, 92]],
        "accent-cream": [[248, 228, 184]],
        "accent-slate": [[92, 100, 112]],
      };
    }, /nontrivial|two.*three.*shade|material family/i],
    ["duplicate shade", (contract) => {
      contract.atlases.sample.materialRamps["skin-warm"] = [[52, 36, 28], [52, 36, 28]];
    }, /duplicate|repeat.*shade/i],
    ["unordered ramp", (contract) => {
      contract.atlases.sample.materialRamps["skin-warm"] = [[220, 148, 100], [52, 36, 28]];
    }, /order|dark.*light|monotonic/i],
  ]) {
    const hostile = structuredClone(valid);
    mutate(hostile);
    assert.match(validate(hostile).join("\n"), pattern, label);
  }
});

test("rejects noncanonical body-frame identity and order before compact metadata publication", async (t) => {
  const source = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const validate = productionPacker.validateNativeContractSchema ?? (() => []);
  const bodyFrames = (contract) => contract.atlases["core-human-body-rigs"].frames;

  await t.test("permuted frame order", () => {
    const hostile = structuredClone(source);
    [bodyFrames(hostile)[0], bodyFrames(hostile)[1]] = [
      bodyFrames(hostile)[1],
      bodyFrames(hostile)[0],
    ];
    assert.match(
      validate(hostile).join("\n"),
      /body.*frame.*(?:order|index|canonical)|cell.*identity/i,
    );
  });

  await t.test("duplicate frame identity and rect", () => {
    const hostile = structuredClone(source);
    bodyFrames(hostile)[1] = structuredClone(bodyFrames(hostile)[0]);
    assert.match(
      validate(hostile).join("\n"),
      /duplicate.*body.*frame|duplicate.*(?:id|rect)|cell.*identity/i,
    );
  });

  await t.test("noncanonical frame id and rect", () => {
    const hostile = structuredClone(source);
    bodyFrames(hostile)[0].id = "core-human-body-rigs:17";
    bodyFrames(hostile)[0].rect.x = 48;
    assert.match(
      validate(hostile).join("\n"),
      /body.*frame.*(?:id|rect|canonical)|cell.*identity/i,
    );
  });

  await t.test("normal pack refuses to serialize a subtly permuted contract", async () => {
    const sandbox = await createPackerSandbox();
    try {
      const contractPath = path.join(
        sandbox,
        "scratchpad/2d-production-art/source/native/production-native-contract.json",
      );
      const hostile = JSON.parse(await readFile(contractPath, "utf8"));
      [bodyFrames(hostile)[0], bodyFrames(hostile)[1]] = [
        bodyFrames(hostile)[1],
        bodyFrames(hostile)[0],
      ];
      await writeFile(contractPath, `${JSON.stringify(hostile, null, 2)}\n`);
      const result = await runSandboxPacker(sandbox, []);
      assert.notEqual(result.code, 0, "normal packing must not publish wrongly ordered compact tuples");
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /body.*frame.*(?:order|index|canonical)|cell.*identity/i,
        "the source boundary must reject the order before compact metadata publication",
      );
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});

test("normal pack and check reject an invalid native-contract schema before publication", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const contractPath = path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/production-native-contract.json",
    );
    const contract = JSON.parse(await readFile(contractPath, "utf8"));
    const ramps = contract.atlases["core-human-body-rigs"].materialRamps;
    ramps["cloth-00"] = ramps["hair-chestnut"];
    delete ramps["hair-chestnut"];
    await writeFile(contractPath, `${JSON.stringify(contract, null, 2)}\n`);

    const normal = await runSandboxPacker(sandbox, []);
    const check = await runSandboxPacker(sandbox, ["--check"]);
    for (const [mode, result] of [["normal", normal], ["check", check]]) {
      assert.notEqual(result.code, 0, `${mode} packing must reject the invalid contract schema`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /native.*contract.*schema|semantic.*ramp.*name|cloth-00/i,
        `${mode} must fail at the schema boundary rather than accepting and repacking it`,
      );
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("task report records the exact packing-report hash and measured clothing delta", async () => {
  const [packingReportBytes, taskReport] = await Promise.all([
    readFile(PACKING_REPORT),
    readFile(TASK_REPORT, "utf8"),
  ]);
  const packingReportSha256 = createHash("sha256").update(packingReportBytes).digest("hex");
  assert.match(
    taskReport,
    new RegExp(`packing-report\\.json[^\\n]*${packingReportSha256}`),
    "the human-readable report must record the exact current packing-report SHA-256",
  );

  const representatives = [0, 43, 86, 129, 4, 47, 28, 157, 40];
  const clothing = await Promise.all(Array.from({ length: 8 }, async (_unused, index) => (
    sharp(await readFile(new URL(`core/human-clothing-${String(index).padStart(2, "0")}.png`, NATIVE_ASSET_ROOT)))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  )));
  let minimumDifference = Number.POSITIVE_INFINITY;
  for (const cellIndex of representatives) {
    const cellX = (cellIndex % 16) * 48;
    const cellY = Math.floor(cellIndex / 16) * 64;
    const masks = clothing.map(({ data, info }) => {
      const mask = new Uint8Array(48 * 64);
      for (let y = 0; y < 64; y += 1) for (let x = 0; x < 48; x += 1) {
        mask[y * 48 + x] = data[((cellY + y) * info.width + cellX + x) * 4 + 3] === 0 ? 0 : 1;
      }
      return mask;
    });
    for (let left = 0; left < masks.length; left += 1) for (let right = left + 1; right < masks.length; right += 1) {
      let difference = 0;
      for (let pixel = 0; pixel < masks[left].length; pixel += 1) {
        if (masks[left][pixel] !== masks[right][pixel]) difference += 1;
      }
      minimumDifference = Math.min(minimumDifference, difference);
    }
  }
  assert.match(
    taskReport,
    new RegExp(`measured minimum[^\\n]*${minimumDifference} pixels`, "i"),
    "the human-readable report must record the independently measured clothing minimum",
  );
});

test("rejects fractional, misaligned, out-of-bounds, or non-native frame geometry", async () => {
  for (const change of [
    { rect: { x: 0.5, y: 0, width: 8, height: 8 } },
    { rect: { x: 1, y: 0, width: 8, height: 8 } },
    { rect: { x: 8, y: 0, width: 8, height: 8 } },
    { rect: { x: 0, y: 0, width: 7, height: 8 } },
  ]) {
    const contract = atlasContract();
    contract.frames[0] = { ...contract.frames[0], ...change };
    const report = await analyzeRuntimeAtlas(await outlinedCell(), contract);
    assert.match(report.errors.join("\n"), /integer|align|bounds|native/i);
  }
});

test("enforces feet/root and face/held attachment drift at native coordinates", async () => {
  const contract = atlasContract();
  contract.frames.push({
    ...structuredClone(contract.frames[0]),
    id: "bad-root",
    detectedFeet: { x: 7, y: 3 },
    detectedFaceAnchor: { x: 7, y: 0 },
    detectedHeldAnchor: { x: 2, y: 7 },
  });
  const report = await analyzeRuntimeAtlas(await outlinedCell(), contract);
  assert.ok(report.maxRootDrift > 2);
  assert.ok(report.maxFaceAnchorDrift > 2);
  assert.ok(report.maxHeldAnchorDrift > 2);
  assert.match(report.errors.join("\n"), /root drift|face anchor|held anchor/i);
});

test("requires every action/facing clip with in-range unique markers and cancel points", () => {
  const clips = Object.fromEntries(["human-a", "human-b"].flatMap((rig) =>
    ACTIONS.flatMap((action) => DIRECTIONS.map((facing) => {
      const key = `${rig}:${action}:${facing}`;
      return [key, {
        id: key,
        rig,
        action,
        direction: ["reach-give", "work", "hurt-fall", "prone", "dead"].includes(action)
          ? "none"
          : facing,
        facingPolicy: ["reach-give", "work", "hurt-fall", "prone", "dead"].includes(action)
          ? "preserve"
          : "explicit",
        frames: [{ durationMs: 100 }, { durationMs: 100 }],
        markers: action === "turn" ? [{ frame: 1, name: "facing-switch" }] : [],
        cancelFrames: [0, 1],
      }];
    }))),
  );
  assert.deepEqual(validateClipInventory(clips, {
    rigs: ["human-a", "human-b"],
    actions: ACTIONS,
    facings: DIRECTIONS,
  }), []);

  delete clips["human-b:run:north"];
  clips["human-a:turn:east"].markers.push({ frame: 1, name: "facing-switch" });
  clips["human-a:work:west"].cancelFrames = [0, 0, 9];
  assert.match(validateClipInventory(clips, {
    rigs: ["human-a", "human-b"],
    actions: ACTIONS,
    facings: DIRECTIONS,
  }).join("\n"), /missing.*run.*north|duplicate.*marker|cancel.*range/i);
});

test("rejects baked body features, incomplete masks, two-eye profiles, and north front features", async () => {
  const clean = await analyzeDirectionalFacePlanes({
    rigs: ["human-a", "human-b"],
    facings: DIRECTIONS,
    expressions: EXPRESSIONS,
    bodyPlanes: Object.fromEntries(["human-a", "human-b"].flatMap((rig) =>
      DIRECTIONS.map((facing) => [`${rig}:${facing}`, {
        planePixels: 24,
        facialFeaturePixels: 0,
      }]))),
    facePlanes: Object.fromEntries(["human-a", "human-b"].flatMap((rig) =>
      DIRECTIONS.flatMap((facing) => EXPRESSIONS.map((expression) => [
        `${rig}:${facing}:${expression}`,
        {
          rig,
          facing,
          expression,
          maskPixels: 24,
          coveredMaskPixels: 24,
          leakedPixels: 0,
          eyes: facing === "north" ? 0 : facing === "south" ? 2 : 1,
          noseDirection: facing === "north" ? "north-hidden" : facing,
          mouthPixels: facing === "north" ? 0 : 3,
        },
      ]))),
    ),
  });
  assert.deepEqual(clean.errors, []);

  const broken = structuredClone(clean.input);
  broken.bodyPlanes["human-a:east"].facialFeaturePixels = 1;
  broken.facePlanes["human-a:east:neutral"].coveredMaskPixels = 23;
  broken.facePlanes["human-b:west:neutral"].eyes = 2;
  broken.facePlanes["human-b:north:neutral"].mouthPixels = 2;
  const report = await analyzeDirectionalFacePlanes(broken);
  assert.match(report.errors.join("\n"), /baked.*feature|incomplete.*mask|profile.*eye|north.*mouth/i);
});

test("computes exact compressed/decoded core, region, home, and peak-active budgets", () => {
  const atlases = [
    { id: "body", group: "core", regionKit: null, width: 48, height: 64, compressedBytes: 100 },
    { id: "face", group: "core", regionKit: null, width: 48, height: 64, compressedBytes: 80 },
    { id: "spring", group: "region", regionKit: "spring-terraces", width: 32, height: 32, compressedBytes: 50 },
    { id: "spring-home", group: "home", regionKit: "spring-terraces", width: 128, height: 128, compressedBytes: 70 },
  ].map((atlas) => ({ ...atlas, decodedBytes: atlas.width * atlas.height * 4, sha256: "a".repeat(64) }));
  const report = buildProductionPackingReport({
    atlases,
    currentUiCompressedBytes: 0,
    currentUiDecodedBytes: 0,
    budgets: {
      coreCompressedMax: 786_432,
      regionCompressedMax: 196_608,
      activeCompressedMax: 1_310_720,
    },
  });
  assert.equal(report.coreCompressedBytes, 180);
  assert.equal(report.regionCompressedBytes["spring-terraces"], 120);
  assert.equal(report.activeCompressedBytes["spring-terraces"], 300);
  assert.equal(report.exactCoreDecodedBytes, 2 * 48 * 64 * 4);
  assert.equal(
    report.exactPeakActiveDecodedBytes["spring-terraces"],
    2 * 48 * 64 * 4 + 32 * 32 * 4 + 128 * 128 * 4,
  );
  assert.deepEqual(validateAssetBudgets(report), []);

  report.atlases[0].decodedBytes -= 4;
  report.regionCompressedBytes["spring-terraces"] = 196_609;
  assert.match(validateAssetBudgets(report).join("\n"), /decoded.*width.*height.*4|region.*196608/i);
});

test("enforces every allocation and per-inventory compressed sub-budget before hard caps", () => {
  const subBudgets = [
    ["core-human-body-rigs", "core", null, 144 * 1024, /body.*144|body.*budget/i],
    ["core-human-face-planes", "core", null, 24 * 1024, /face.*24|face.*budget/i],
    ["core-human-hair", "core", null, 80 * 1024, /hair.*80|hair.*budget/i],
    ["core-human-clothing-00", "core", null, 40 * 1024, /clothing.*40|clothing.*budget/i],
    ["core-human-held", "core", null, 48 * 1024, /held.*48|held.*budget/i],
    ["core-human-status-effects", "core", null, 64 * 1024, /status.*64|status.*budget/i],
    ["spring-terraces-terrain", "region", "spring-terraces", 24 * 1024, /terrain.*24|terrain.*budget/i],
    ["spring-terraces-scenery", "region", "spring-terraces", 40 * 1024, /scenery.*40|scenery.*budget/i],
    ["spring-terraces-environment", "region", "spring-terraces", 16 * 1024, /environment.*16|environment.*budget/i],
    ["spring-terraces-home-components", "home", "spring-terraces", 56 * 1024, /home.*components.*56|components.*budget/i],
    ["spring-terraces-home-details", "home", "spring-terraces", 16 * 1024, /home.*details.*16|details.*budget/i],
    ["spring-terraces-home-ruins", "home", "spring-terraces", 24 * 1024, /ruins.*24|ruins.*budget/i],
    ["spring-terraces-landmarks", "region", "spring-terraces", 48 * 1024, /landmark.*48|landmark.*budget/i],
    ["spring-terraces-home-yards", "home", "spring-terraces", 40 * 1024, /yard.*40|yard.*budget/i],
  ];
  for (const [id, group, regionKit, limit, pattern] of subBudgets) {
    const report = buildProductionPackingReport({
      atlases: [{
        id,
        group,
        regionKit,
        width: 1,
        height: 1,
        decodedBytes: 4,
        compressedBytes: limit + 1,
      }],
      currentUiCompressedBytes: 0,
      currentUiDecodedBytes: 0,
      budgets: {
        coreCompressedAllocation: 720_896,
        coreCompressedMax: 786_432,
        regionCompressedAllocation: 184_320,
        regionCompressedMax: 196_608,
        activeCompressedMax: 1_310_720,
      },
    });
    assert.match(validateAssetBudgets(report).join("\n"), pattern, `${id} must enforce ${limit} bytes`);
  }

  const allocationReport = buildProductionPackingReport({
    atlases: [],
    currentUiCompressedBytes: 0,
    currentUiDecodedBytes: 0,
    budgets: {
      coreCompressedAllocation: 720_896,
      coreCompressedMax: 786_432,
      regionCompressedAllocation: 184_320,
      regionCompressedMax: 196_608,
      activeCompressedMax: 1_310_720,
    },
  });
  allocationReport.coreCompressedBytes = 720_897;
  allocationReport.regionCompressedBytes["spring-terraces"] = 184_321;
  allocationReport.coreMetadataCompressedBytes = 24 * 1024 + 1;
  allocationReport.regionMetadataCompressedBytes = { "spring-terraces": 4 * 1024 + 1 };
  assert.match(
    validateAssetBudgets(allocationReport).join("\n"),
    /core.*allocation|region.*allocation|core.*metadata|region.*metadata/i,
  );
});

test("includes metadata compressed and decoded bytes in core, region, and active totals", () => {
  const atlases = [
    { id: "core-human-body-rigs", group: "core", regionKit: null, width: 1, height: 1,
      compressedBytes: 100, decodedBytes: 4 },
    { id: "spring-terraces-terrain", group: "region", regionKit: "spring-terraces",
      width: 1, height: 1, compressedBytes: 50, decodedBytes: 4 },
  ];
  const report = buildProductionPackingReport({
    atlases,
    currentUiCompressedBytes: 7,
    currentUiDecodedBytes: 8,
    metadata: {
      core: { compressedBytes: 11, decodedBytes: 12 },
      regions: { "spring-terraces": { compressedBytes: 13, decodedBytes: 16 } },
    },
    budgets: {
      coreCompressedAllocation: 720_896,
      coreCompressedMax: 786_432,
      regionCompressedAllocation: 184_320,
      regionCompressedMax: 196_608,
      activeCompressedMax: 1_310_720,
    },
  });
  assert.equal(report.coreMetadataCompressedBytes, 11);
  assert.equal(report.coreMetadataDecodedBytes, 12);
  assert.equal(report.coreCompressedBytes, 111);
  assert.equal(report.exactCoreDecodedBytes, 16);
  assert.equal(report.regionMetadataCompressedBytes["spring-terraces"], 13);
  assert.equal(report.regionMetadataDecodedBytes["spring-terraces"], 16);
  assert.equal(report.regionCompressedBytes["spring-terraces"], 63);
  assert.equal(report.activeCompressedBytes["spring-terraces"], 181);
  assert.equal(report.exactPeakActiveDecodedBytes["spring-terraces"], 44);

  const allocationBoundary = structuredClone(report);
  allocationBoundary.coreCompressedBytes = 720_896;
  allocationBoundary.coreMetadataCompressedBytes = 1;
  allocationBoundary.regionCompressedBytes["spring-terraces"] = 184_320;
  allocationBoundary.regionMetadataCompressedBytes["spring-terraces"] = 1;
  allocationBoundary.activeCompressedBytes["spring-terraces"] = 1_310_720;
  assert.match(
    validateAssetBudgets(allocationBoundary).join("\n"),
    /core.*metadata.*allocation|region.*metadata.*allocation|active.*metadata.*cap|combined.*metadata/i,
  );
});

test("rejects packing reports with omitted, double-counted, drifted, or rescaled runtime assets", () => {
  const report = {
    schema: 1,
    generatedAt: "1970-01-01T00:00:00.000Z",
    atlases: [
      {
        id: "body",
        group: "core",
        regionKit: null,
        width: 48,
        height: 64,
        cellWidth: 48,
        cellHeight: 64,
        sourceCellWidth: 48,
        sourceCellHeight: 64,
        compressedBytes: 100,
        decodedBytes: 48 * 64 * 4,
        sha256: "a".repeat(64),
        binaryAlpha: true,
        runtimeResized: false,
      },
    ],
    countedAtlasIds: ["body"],
    contactSheets: ["native-1x", "exact-2x", "desktop", "mobile-390x844"],
  };
  assert.deepEqual(validateProductionPackingReport(report, report.atlases), []);

  report.countedAtlasIds.push("body");
  report.atlases[0].sha256 = "b".repeat(64);
  report.atlases[0].runtimeResized = true;
  report.contactSheets.pop();
  assert.match(
    validateProductionPackingReport(report, [{ ...report.atlases[0], sha256: "a".repeat(64) }])
      .join("\n"),
    /counted twice|hash.*drift|runtime rescal|mobile-390x844/i,
  );
});

test("records real per-atlas, face-plane, anchor, and clip findings for all 53 packed outputs", async () => {
  const report = JSON.parse(await readFile(PACKING_REPORT, "utf8"));
  assert.equal(report.atlases.length, 53);
  for (const atlas of report.atlases) {
    assert.equal(
      atlas.validation?.measuredFromSha256,
      atlas.sha256,
      `${atlas.id} findings must be derived from its actual packed bytes`,
    );
    assert.deepEqual(atlas.validation.errors, []);
    assert.equal(atlas.validation.binaryAlpha, true);
    assert.equal(atlas.validation.transparentResidue, 0);
    assert.equal(atlas.validation.runtimeResized, false);
    assert.equal(Number.isInteger(atlas.validation.maxShadesPerMaterial), true);
    assert.equal(Number.isInteger(atlas.validation.maxOutlineWidth), true);
  }
  const body = report.atlases.find(({ id }) => id === "core-human-body-rigs");
  const face = report.atlases.find(({ id }) => id === "core-human-face-planes");
  assert.equal(Number.isFinite(body.validation.maxRootDrift), true);
  assert.equal(Number.isFinite(body.validation.maxFaceAnchorDrift), true);
  assert.equal(Number.isFinite(body.validation.maxHeldAnchorDrift), true);
  assert.equal(report.facePlaneValidation.measuredFromSha256, face.sha256);
  assert.deepEqual(report.facePlaneValidation.errors, []);
  assert.deepEqual(report.clipValidation.errors, []);
  assert.equal(report.clipValidation.clipCount, 2 * 10 * 4);
  assert.match(report.runtimeSourceMethod, /native production masters/i);
  assert.match(
    report.provenance,
    /project-owned.*2D slice.*2D style guides.*deterministically.*face-safe/i,
  );
});

test("persists independently measured anchors and source hashes in the native contract", async () => {
  const contractBytes = await readFile(NATIVE_CONTRACT);
  const contract = JSON.parse(contractBytes);
  const bodyBytes = await readFile(new URL("core/human-body-rigs.png", NATIVE_ASSET_ROOT));
  const bodyHash = createHash("sha256").update(bodyBytes).digest("hex");
  const body = contract.atlases?.["core-human-body-rigs"];
  assert.equal(body?.sourceSha256, bodyHash, "the persisted authoring contract must pin body source bytes");
  assert.equal(body?.frames?.length, 344);
  for (const frame of body.frames) {
    assert.equal(frame.measuredFromSha256, bodyHash);
    for (const field of ["feet", "detectedFeet", "faceAnchor", "detectedFaceAnchor",
      "heldAnchor", "detectedHeldAnchor"]) {
      assert.equal(Number.isInteger(frame[field]?.x), true, `${frame.id}/${field}.x`);
      assert.equal(Number.isInteger(frame[field]?.y), true, `${frame.id}/${field}.y`);
    }
  }
});

test("serializes every measured body anchor as compact ordered runtime tuples", async () => {
  const nativeContract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const runtimeBytes = await readFile(RUNTIME_CORE_SOURCE);
  const runtimeCore = JSON.parse(runtimeBytes);
  const authoredFrames = nativeContract.atlases?.["core-human-body-rigs"]?.frames;

  assert.equal(authoredFrames?.length, 344);
  assert.equal(
    runtimeCore.bodyFrameAnchors?.length,
    authoredFrames.length,
    "runtime core metadata must retain all measured body-frame anchors",
  );
  assert.deepEqual(
    runtimeCore.bodyFrameAnchors,
    authoredFrames.map(({ feet, faceAnchor, heldAnchor }) => [
      feet.x,
      feet.y,
      faceAnchor.x,
      faceAnchor.y,
      heldAnchor.x,
      heldAnchor.y,
    ]),
  );
  for (const tuple of runtimeCore.bodyFrameAnchors) {
    assert.equal(tuple.length, 6);
    assert.equal(tuple.every(Number.isInteger), true);
  }
  assert.ok(runtimeBytes.byteLength <= 24 * 1024, "runtime core metadata must remain within 24 KiB raw");
});

test("serializes the alpha-measured complete idle and held-form feet envelopes", async () => {
  const nativeContract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const coreBuffers = Object.fromEntries(await Promise.all([
    "human-body-rigs.png",
    "human-face-planes.png",
    "human-hair.png",
    "human-held.png",
    ...Array.from({ length: 8 }, (_unused, index) =>
      `human-clothing-${String(index).padStart(2, "0")}.png`),
  ].map(async (name) => [name, await readFile(new URL(`core/${name}`, NATIVE_ASSET_ROOT))])));
  const measured = await productionPacker.measureStandingVisualEnvelopes(
    coreBuffers,
    nativeContract,
  );
  const runtimeCore = JSON.parse(await readFile(RUNTIME_CORE_SOURCE, "utf8"));

  assert.deepEqual(measured, {
    idleComposite: { left: -18, top: -62, right: 19, bottom: 1 },
    withHeldForms: { left: -37, top: -62, right: 30, bottom: 10 },
  });
  assert.deepEqual(runtimeCore.standingVisualEnvelopes, measured);
});

test("serializes exact named held forms and explicit actor status cells", async () => {
  const runtimeCore = JSON.parse(await readFile(RUNTIME_CORE_SOURCE, "utf8"));
  assert.deepEqual(runtimeCore.heldForms, [
    "none",
    "basket",
    "wood-bundle",
    "stone-bundle",
    "material-crate",
    "energy-gift",
    "proposal-token",
    "hammer",
    "hearth-fuel",
    "vault-deposit",
    "vault-withdraw",
    "raid-tool",
    "loot-crate",
    "ruin-debris",
    "resource-handful",
    "reserve",
  ]);
  assert.deepEqual(runtimeCore.statusCells, {
    selected: 0,
    paralyzed: 1,
    dead: 2,
  });
});

test("persists face metrics and clip contracts and proves their hashes in the packing report", async () => {
  const contractBytes = await readFile(NATIVE_CONTRACT);
  const contractHash = createHash("sha256").update(contractBytes).digest("hex");
  const contract = JSON.parse(contractBytes);
  const report = JSON.parse(await readFile(PACKING_REPORT, "utf8"));
  assert.equal(Object.keys(contract.bodyFacePlanes ?? {}).length, 8);
  assert.equal(Object.keys(contract.facePlanes ?? {}).length, 64);
  assert.equal(Object.keys(contract.clips ?? {}).length, 80);
  for (const plane of Object.values(contract.facePlanes ?? {})) {
    for (const field of ["maskPixels", "coveredMaskPixels", "leakedPixels", "eyes", "mouthPixels"]) {
      assert.equal(Number.isInteger(plane[field]), true, `${plane.id}/${field}`);
    }
    assert.equal(typeof plane.noseDirection, "string");
    assert.match(plane.measuredFromSha256, /^[a-f0-9]{64}$/);
  }
  for (const clip of Object.values(contract.clips ?? {})) {
    assert.ok(Array.isArray(clip.frames) && clip.frames.length > 0);
    assert.ok(Array.isArray(clip.markers));
    assert.ok(Array.isArray(clip.cancelFrames));
  }
  assert.equal(report.nativeContractSha256, contractHash);
  assert.equal(report.facePlaneValidation?.measuredFromContractSha256, contractHash);
  assert.equal(report.clipValidation?.measuredFromContractSha256, contractHash);
  for (const atlas of report.atlases) {
    assert.equal(atlas.validation?.measuredFromContractSha256, contractHash, atlas.id);
  }
});

test("persists byte-derived face feature colors, coordinate masks, and semantic result hashes", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  assert.ok(contract.faceSemanticPalette, "native contract must author eye, nose, and mouth colors");
  for (const feature of ["eyes", "nose", "mouth"]) {
    assert.ok(
      Array.isArray(contract.faceSemanticPalette[feature])
      && contract.faceSemanticPalette[feature].length > 0,
      `${feature} requires at least one authored RGB feature color`,
    );
  }

  for (const plane of Object.values(contract.facePlanes)) {
    assert.equal(Number.isInteger(plane.cellIndex), true, `${plane.id}/cellIndex`);
    assert.match(plane.semanticPixelsSha256, /^[a-f0-9]{64}$/, `${plane.id}/semanticPixelsSha256`);
    for (const feature of ["eyes", "nose", "mouth"]) {
      assert.ok(Array.isArray(plane.semanticFeatureMask?.[feature]), `${plane.id}/${feature} coordinate mask`);
      for (const point of plane.semanticFeatureMask[feature]) {
        assert.equal(Number.isInteger(point.x) && Number.isInteger(point.y), true, `${plane.id}/${feature} coordinate`);
        assert.ok(point.x >= 0 && point.x < 48 && point.y >= 0 && point.y < 64);
      }
    }
    assert.equal(connectedComponents(plane.semanticFeatureMask.eyes).length, plane.eyes, `${plane.id}/eye components`);
    assert.equal(plane.semanticFeatureMask.mouth.length, plane.mouthPixels, `${plane.id}/mouth count`);
    if (plane.facing === "north") {
      assert.deepEqual(plane.semanticFeatureMask, { eyes: [], nose: [], mouth: [] }, `${plane.id}/north features`);
    }
  }
  for (const plane of Object.values(contract.bodyFacePlanes)) {
    assert.ok(plane.faceInterior && [plane.faceInterior.x, plane.faceInterior.y,
      plane.faceInterior.width, plane.faceInterior.height].every(Number.isInteger), `${plane.id}/faceInterior`);
    assert.ok(Array.isArray(plane.forbiddenFeatureColors) && plane.forbiddenFeatureColors.length > 0,
      `${plane.id}/forbiddenFeatureColors`);
  }

  const faceRaw = await sharp(fileURLToPath(new URL("core/human-face-planes.png", NATIVE_ASSET_ROOT)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const east = contract.facePlanes["human-a:east:neutral"];
  assert.equal(semanticMaskHash(faceRaw, east), east.semanticPixelsSha256);
  const changed = { data: Buffer.from(faceRaw.data), info: faceRaw.info };
  const point = east.semanticFeatureMask.eyes[0];
  const offset = ((Math.floor(east.cellIndex / 16) * 64 + point.y) * faceRaw.info.width
    + (east.cellIndex % 16) * 48 + point.x) * 4;
  changed.data[offset] ^= 1;
  assert.notEqual(
    semanticMaskHash(changed, east),
    east.semanticPixelsSha256,
    "the persisted measured semantic hash must change when an authored feature pixel changes",
  );
});

test("RED: validates one full-cell directional face topology for both rigs and every expression", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const raw = await sharp(fileURLToPath(new URL("core/human-face-planes.png", NATIVE_ASSET_ROOT)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const paletteEntries = Object.entries(contract.faceSemanticPalette);
  const paletteOwners = new Map();
  for (const [feature, colors] of paletteEntries) {
    for (const color of colors) {
      const key = color.join(",");
      assert.equal(
        paletteOwners.has(key),
        false,
        `semantic color ${key} cannot ambiguously belong to ${paletteOwners.get(key)} and ${feature}`,
      );
      paletteOwners.set(key, feature);
    }
  }

  for (const rig of ["human-a", "human-b"]) {
    for (const facing of DIRECTIONS) {
      for (const expression of EXPRESSIONS) {
        const id = `${rig}:${facing}:${expression}`;
        const plane = contract.facePlanes[id];
        assert.ok(plane, `${id} native plane`);
        const measured = Object.fromEntries(paletteEntries.map(([feature, colors]) => [
          feature,
          semanticPointsInCell(raw, plane.cellIndex, colors),
        ]));
        assert.deepEqual(
          measured,
          plane.semanticFeatureMask,
          `${id} semantic masks must be derived from a scan of the complete 48x64 cell`,
        );
        assert.equal(connectedComponents(measured.mouth).length, facing === "north" ? 0 : 1, `${id} mouth`);
        assert.equal(connectedComponents(measured.nose).length, facing === "north" ? 0 : 1, `${id} nose`);
        assert.equal(
          connectedComponents(measured.eyes).length,
          facing === "north" ? 0 : facing === "south" ? 2 : 1,
          `${id} eye topology`,
        );
        if (facing === "north") {
          assert.deepEqual(measured, { eyes: [], nose: [], mouth: [] }, `${id} hides all front/profile features`);
          continue;
        }
        assert.ok(Math.max(...measured.eyes.map(({ y }) => y)) < Math.min(...measured.nose.map(({ y }) => y)), `${id} eye/nose order`);
        assert.ok(Math.max(...measured.nose.map(({ y }) => y)) < Math.min(...measured.mouth.map(({ y }) => y)), `${id} nose/mouth order`);
        assert.ok(Math.max(...Object.values(measured).flat().map(({ y }) => y)) <= 22, `${id} cannot contain a lower second face`);
        if (facing === "south") {
          const eyeCenters = connectedComponents(measured.eyes).map((component) => average(component, "x"));
          assert.ok(Math.min(...eyeCenters) < 24 && Math.max(...eyeCenters) > 24, `${id} south eyes straddle center`);
          assert.ok(Math.abs(average(measured.nose, "x") - 24) <= 1, `${id} south nose is centered`);
          assert.ok(Math.abs(average(measured.mouth, "x") - 24) <= 1, `${id} south mouth is centered`);
        } else {
          const direction = facing === "east" ? 1 : -1;
          assert.ok(direction * (average(measured.eyes, "x") - 24) > 0, `${id} profile eye faces ${facing}`);
          assert.ok(
            direction * (average(measured.nose, "x") - average(measured.eyes, "x")) > 0,
            `${id} profile nose points ${facing}`,
          );
          assert.equal(plane.noseDirection, facing, `${id} persisted direction semantics`);
        }
      }
    }
  }
});

test("keeps every authored facial feature visible through every directional hair cell", async () => {
  const contract = JSON.parse(await readFile(NATIVE_CONTRACT, "utf8"));
  const hair = await sharp(fileURLToPath(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const failures = [];

  for (const plane of Object.values(contract.facePlanes)) {
    if (plane.facing === "north") continue;
    const facingIndex = DIRECTIONS.indexOf(plane.facing);
    assert.notEqual(facingIndex, -1, `${plane.id}: canonical facing`);
    const semanticPoints = Object.entries(plane.semanticFeatureMask).flatMap(
      ([feature, points]) => points.map(({ x, y }) => ({ feature, x, y })),
    );
    for (let silhouetteIndex = 0; silhouetteIndex < HAIR_SILHOUETTES.length; silhouetteIndex += 1) {
      for (let phase = 0; phase < HAIR_PHASES; phase += 1) {
        const cellIndex = silhouetteIndex * DIRECTIONS.length * HAIR_PHASES
          + facingIndex * HAIR_PHASES + phase;
        for (const { feature, x, y } of semanticPoints) {
          const alpha = hair.data[atlasCellOffset(hair, cellIndex, x, y) + 3];
          if (alpha !== 0) {
            failures.push(
              `${plane.id}/${HAIR_SILHOUETTES[silhouetteIndex]}/phase-${phase}/${feature}@${x},${y}`,
            );
          }
        }
      }
    }
  }

  assert.deepEqual(
    failures,
    [],
    `hair alpha obscures authored face semantics:\n${failures.slice(0, 24).join("\n")}`,
  );
});

test("keeps extracted hair cells free of baked skin and facial pixels", async () => {
  const hair = await sharp(fileURLToPath(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const forbidden = new Map();
  for (let offset = 0; offset < hair.data.length; offset += 4) {
    if (hair.data[offset + 3] === 0) continue;
    const key = [hair.data[offset], hair.data[offset + 1], hair.data[offset + 2]].join(",");
    if (PERMITTED_HAIR_RGB.has(key)) continue;
    forbidden.set(key, (forbidden.get(key) ?? 0) + 1);
  }
  assert.deepEqual(
    Object.fromEntries([...forbidden].sort(([left], [right]) => left.localeCompare(right))),
    {},
    "hair atlas may contain only canonical hair and normalized outline colors",
  );
});

test("keeps grounded phase-five hair centered on the canonical face anchor", async () => {
  const hair = await sharp(fileURLToPath(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const failures = [];
  for (let silhouetteIndex = 0; silhouetteIndex < HAIR_SILHOUETTES.length; silhouetteIndex += 1) {
    for (let facingIndex = 0; facingIndex < DIRECTIONS.length; facingIndex += 1) {
      const firstCell = silhouetteIndex * DIRECTIONS.length * HAIR_PHASES
        + facingIndex * HAIR_PHASES;
      const grounded = opaqueCellCentroid(hair, firstCell + 5);
      if (grounded.maxY > 50) {
        failures.push(
          `${HAIR_SILHOUETTES[silhouetteIndex]}/${DIRECTIONS[facingIndex]} maxY=${grounded.maxY}`,
        );
      }
      if (silhouetteIndex === 0 && (
        grounded.minX < 8 || grounded.maxX > 40 || grounded.minY < 8 || grounded.maxY > 32
      )) failures.push(`crop/${DIRECTIONS[facingIndex]} bounds=${JSON.stringify(grounded)}`);
    }
  }
  assert.deepEqual(
    failures,
    [],
    `grounded hair was baked at the body pose and then translated a second time:\n${failures.join("\n")}`,
  );
});

test("normal packing rejects real face/body semantic pixel drift after legitimate source-hash refresh", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const nativeCore = path.join(sandbox, "scratchpad/2d-production-art/source/native/core");
    const facePath = path.join(nativeCore, "human-face-planes.png");
    await rewriteNativeAtlasPixels(facePath, [
      { index: 0, x: 21, y: 16, rgba: [16, 6, 11, 255] },
    ]);
    await refreshPersistedSourceHash(
      sandbox,
      "core-human-face-planes",
      "core/human-face-planes.png",
    );

    const bodyPath = path.join(nativeCore, "human-body-rigs.png");
    await rewriteNativeAtlasPixels(bodyPath, [
      { index: 43, x: 24, y: 18, rgba: [16, 6, 11, 255] },
    ]);
    await refreshPersistedSourceHash(
      sandbox,
      "core-human-body-rigs",
      "core/human-body-rigs.png",
    );

    const result = await runSandboxPacker(sandbox, []);
    assert.notEqual(result.code, 0, "semantic pixel drift must fail even after valid source hashes are refreshed");
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /face.*semantic|eye|nose|mouth|body.*feature/i,
      "failure must come from actual feature-pixel semantics, not a stale source hash",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("visual pass verdicts link to named validation-result hashes and reject failed inputs", async () => {
  assert.equal(
    typeof productionPacker.validateVisualReviewMatrix,
    "function",
    "packer must export validateVisualReviewMatrix(matrix)",
  );
  const matrix = JSON.parse(await readFile(VISUAL_REVIEW_MATRIX, "utf8"));
  const results = matrix.validationResults ?? {};
  assert.ok(Object.keys(results).length > 0, "visual matrix must persist named validation results");
  for (const [name, result] of Object.entries(results)) {
    assert.equal(result.name, name);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof result.passed, "boolean");
  }
  for (const [artifactName, artifact] of Object.entries(matrix.artifacts ?? {})) {
    for (const [verdictName, verdict] of Object.entries(artifact.verdicts ?? {})) {
      assert.equal(verdict.status, "pass", `${artifactName}/${verdictName}`);
      assert.match(verdict.validationResultSha256, /^[a-f0-9]{64}$/);
      assert.ok(
        Object.values(results).some(({ sha256 }) => sha256 === verdict.validationResultSha256),
        `${artifactName}/${verdictName} must link to a named validation result`,
      );
    }
  }
  assert.deepEqual(productionPacker.validateVisualReviewMatrix(matrix), []);

  const failed = structuredClone(matrix);
  const firstResult = Object.values(failed.validationResults)[0];
  firstResult.passed = false;
  assert.match(
    productionPacker.validateVisualReviewMatrix(failed).join("\n"),
    /failed.*validation|pass.*failed|verdict.*invalid/i,
    "a verdict cannot remain pass after its linked validation result fails",
  );
});

test("runtime actor-compositor evidence requires exact ordering, hashes, and shared anchors", () => {
  assert.equal(
    typeof productionPacker.validateRuntimeCompositorEvidence,
    "function",
    "packer must export validateRuntimeCompositorEvidence(metadata, artifacts)",
  );
  const oneX = Buffer.from("runtime-compositor-1x");
  const twoX = Buffer.from("runtime-compositor-2x");
  const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
  const states = ["idle", "walk", "turn", "talk", "work", "hurt", "recovery"];
  const action = { idle: "idle", walk: "walk", turn: "turn", talk: "idle", work: "work",
    hurt: "hurt-fall", recovery: "hurt-fall" };
  const metadata = {
    contract: "LayeredHumanActor.draw vs direct native source-over; CSS palette filters excluded",
    ordering: "rig -> facing -> idle, walk, turn, talk, work, hurt, recovery",
    canvas: { width: 96, height: 96 },
    cases: ["human-a", "human-b"].flatMap((rig) => (
      ["south", "east", "north", "west"].flatMap((facing) => states.map((state) => ({
        rig,
        facing,
        state,
        bodyClipId: `${rig}:${action[state]}:${facing}`,
        bodyFrameIndex: 0,
        faceDestination: [24, 18],
        hairDestination: [24, 18],
        nativePixelsSha256: "a".repeat(64),
      })))
    )),
    contactSheet1xSha256: hash(oneX),
    contactSheet2xSha256: hash(twoX),
  };
  const artifacts = {
    "runtime-compositor-human-1x.png": oneX,
    "runtime-compositor-human-2x.png": twoX,
  };
  assert.deepEqual(productionPacker.validateRuntimeCompositorEvidence(metadata, artifacts), []);

  const shifted = structuredClone(metadata);
  shifted.cases[17].hairDestination[0] += 2;
  assert.match(
    productionPacker.validateRuntimeCompositorEvidence(shifted, artifacts).join("\n"),
    /face.*hair.*destination/i,
  );
  const reordered = structuredClone(metadata);
  [reordered.cases[0], reordered.cases[1]] = [reordered.cases[1], reordered.cases[0]];
  assert.match(
    productionPacker.validateRuntimeCompositorEvidence(reordered, artifacts).join("\n"),
    /canonical.*order/i,
  );
  assert.match(
    productionPacker.validateRuntimeCompositorEvidence(metadata, {
      ...artifacts,
      "runtime-compositor-human-1x.png": Buffer.from("wrong"),
    }).join("\n"),
    /1x.*hash/i,
  );
});

const responsiveEvidenceLayout = (viewport) => ({
  viewport,
  placements: [
    {
      id: "standing-south",
      evidenceRole: "standing-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      x: 8,
      y: 8,
      scale: 1,
    },
    {
      id: "profile-talk-east",
      evidenceRole: "profile-talking-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      x: 64,
      y: 8,
      scale: 2,
    },
    {
      id: "prone-recovery-west",
      evidenceRole: "prone-recovery-human",
      kind: "human-cell",
      sourceKind: "native-cell",
      source: { width: 48, height: 64 },
      x: 168,
      y: 8,
      scale: 1,
    },
    {
      id: "spring-doorway",
      evidenceRole: "doorway-home",
      kind: "home-cell",
      sourceKind: "native-cell",
      source: { width: 128, height: 128 },
      x: 8,
      y: 152,
      scale: 1,
    },
    {
      id: "ash-persistent-ruin",
      evidenceRole: "persistent-ruin",
      kind: "home-cell",
      sourceKind: "native-cell",
      source: { width: 128, height: 128 },
      x: 144,
      y: 152,
      scale: 1,
    },
  ],
});

test("accepts readable native-cell evidence on mobile and integer-only evidence on desktop", () => {
  assert.equal(
    typeof validateResponsiveEvidenceLayout,
    "function",
    "packer must export validateResponsiveEvidenceLayout(layout)",
  );

  const mobile = responsiveEvidenceLayout({ id: "mobile-390x844", width: 390, height: 844 });
  assert.deepEqual(validateResponsiveEvidenceLayout(mobile), []);
  assert.deepEqual(
    mobile.placements.map(({ evidenceRole }) => evidenceRole),
    [
      "standing-human",
      "profile-talking-human",
      "prone-recovery-human",
      "doorway-home",
      "persistent-ruin",
    ],
  );
  for (const placement of mobile.placements) {
    assert.ok(Number.isInteger(placement.x) && Number.isInteger(placement.y));
    assert.ok(placement.scale === 1 || placement.scale === 2);
    assert.equal(placement.sourceKind, "native-cell");
    assert.deepEqual(
      placement.source,
      placement.kind === "human-cell"
        ? { width: 48, height: 64 }
        : { width: 128, height: 128 },
    );
  }

  const desktop = responsiveEvidenceLayout({ id: "desktop-1440x900", width: 1440, height: 900 });
  desktop.placements = desktop.placements.map((placement, index) => ({
    ...placement,
    x: 32 + index * 272,
    y: 48,
    scale: 2,
  }));
  assert.deepEqual(validateResponsiveEvidenceLayout(desktop), []);
  assert.ok(desktop.placements.every(({ x, y, scale }) =>
    Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(scale)));
});

test("rejects full-sheet downsampling, fractional coordinates, and non-integer human scaling", () => {
  assert.equal(
    typeof validateResponsiveEvidenceLayout,
    "function",
    "packer must export validateResponsiveEvidenceLayout(layout)",
  );

  const mobile = responsiveEvidenceLayout({ id: "mobile-390x844", width: 390, height: 844 });
  mobile.placements = mobile.placements.filter(({ kind }) => kind === "human-cell");
  mobile.placements.push({
    id: "all-homes-downsampled",
    evidenceRole: "home-sheet",
    kind: "home-sheet",
    sourceKind: "full-sheet",
    source: { width: 640, height: 640 },
    x: 99,
    y: 620,
    destination: { width: 192, height: 216 },
    scale: 0.3,
  });
  assert.match(
    validateResponsiveEvidenceLayout(mobile).join("\n"),
    /full-sheet downsample|native 128x128|doorway-home|persistent-ruin|fractional scale/i,
  );

  const desktop = responsiveEvidenceLayout({ id: "desktop-1440x900", width: 1440, height: 900 });
  desktop.placements[0].scale = 1.5;
  desktop.placements[1].x = 64.5;
  assert.match(
    validateResponsiveEvidenceLayout(desktop).join("\n"),
    /integer scale|fractional coordinate|native 48x64/i,
  );
});

test("rejects 3x evidence and viewport IDs whose dimensions do not match the frozen device", () => {
  const mobileAt3x = responsiveEvidenceLayout({ id: "mobile-390x844", width: 390, height: 844 });
  mobileAt3x.placements[0].scale = 3;
  assert.match(
    validateResponsiveEvidenceLayout(mobileAt3x).join("\n"),
    /only.*1x.*2x|scale.*1.*2|3x.*forbidden/i,
  );

  const mislabeledMobile = responsiveEvidenceLayout({
    id: "mobile-390x844",
    width: 1440,
    height: 900,
  });
  assert.match(
    validateResponsiveEvidenceLayout(mislabeledMobile).join("\n"),
    /mobile-390x844.*390.*844|viewport.*identity|viewport.*dimensions/i,
  );

  const mislabeledDesktop = responsiveEvidenceLayout({
    id: "desktop-1440x900",
    width: 390,
    height: 844,
  });
  assert.match(
    validateResponsiveEvidenceLayout(mislabeledDesktop).join("\n"),
    /desktop-1440x900.*1440.*900|viewport.*identity|viewport.*dimensions/i,
  );
});

test("validates every native master before atomically renaming any production output", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const sentinelPath = path.join(
      sandbox,
      "frontend/src/assets/renderer2d/core/human-body-rigs.png",
    );
    const sentinel = Buffer.from("must-survive-validation-failure");
    await writeFile(sentinelPath, sentinel);
    await mutateInteriorPixel(path.join(
      sandbox,
      "scratchpad/2d-production-art/source/native/core/human-hair.png",
    ), { alpha: 128 });

    const result = await runSandboxPacker(sandbox, []);
    assert.notEqual(result.code, 0, "invalid native alpha must abort normal packing");
    assert.match(`${result.stdout}\n${result.stderr}`, /binary alpha|validation|native/i);
    assert.equal(
      (await readFile(sentinelPath)).equals(sentinel),
      true,
      "no existing runtime output may change before all native validation passes",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }

  const packerSource = await readFile(PACKER_SOURCE, "utf8");
  assert.match(packerSource, /rename\s*\(/, "atomic publication must rename validated temporary files");
  assert.match(packerSource, /\.tmp|temporary|tempDir|staging/i, "atomic publication requires a temporary staging path");
});

test("rolls back every earlier publication when a later atomic rename fails", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const sentinelPath = path.join(
      sandbox,
      "frontend/src/assets/renderer2d/core/human-body-rigs.png",
    );
    const sentinel = Buffer.from("must-survive-mid-rename-failure");
    await writeFile(sentinelPath, sentinel);

    const blockedDestination = path.join(
      sandbox,
      "frontend/src/assets/renderer2d/regions/worn-heartland/terrain.png",
    );
    await rm(blockedDestination, { force: true });
    await mkdir(blockedDestination);

    const result = await runSandboxPacker(sandbox, []);
    assert.notEqual(result.code, 0, "a blocked destination must fail publication mid-rename");
    assert.match(`${result.stdout}\n${result.stderr}`, /rename|directory|EISDIR|ENOTDIR/i);
    assert.equal(
      (await readFile(sentinelPath)).equals(sentinel),
      true,
      "publication must roll back files renamed before a later rename failed",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("check mode never writes in any flag combination", async () => {
  const sandbox = await createPackerSandbox();
  try {
    const goldMaster = path.join(
      sandbox,
      "scratchpad/2d-production-art/evidence/task8-gold-master-approval-1x.png",
    );
    const sentinel = Buffer.from("check-mode-must-not-write");
    await writeFile(goldMaster, sentinel);
    await runSandboxPacker(sandbox, ["--check", "--gold-master"]);
    assert.equal(
      (await readFile(goldMaster)).equals(sentinel),
      true,
      "--check must dominate every other flag and leave evidence bytes untouched",
    );
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("check mode rejects stale extra runtime, native-source, and evidence files", async () => {
  const ownedRoots = [
    "frontend/src/assets/renderer2d/core/stale-extra.png",
    "scratchpad/2d-production-art/source/native/core/stale-extra.png",
    "scratchpad/2d-production-art/evidence/stale-extra.png",
  ];
  const sandbox = await createPackerSandbox();
  try {
    for (const stalePath of ownedRoots) {
      await writeFile(path.join(sandbox, stalePath), Buffer.from("stale"));
    }
    const result = await runSandboxPacker(sandbox, ["--check"]);
    assert.notEqual(result.code, 0, "stale files in any owned root must fail exact-inventory closure");
    assert.match(`${result.stdout}\n${result.stderr}`, /stale|extra|unexpected|inventory/i);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

const regionalR5GuideBuffers = async () => ({
  regionKits: await readFile(REGION_GUIDE),
  homeRuin: await readFile(HOME_RUIN_GUIDE),
});

let regionalR5AuthoringPromise;
const regionalR5Authoring = () => {
  regionalR5AuthoringPromise ??= productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: regionalR5GuideBuffers(),
  });
  return regionalR5AuthoringPromise;
};

const regionalR5CompleteProofSourceBuffers = async (kit) => ({
  homeComponents: await readFile(new URL(`homes/${kit}/components.png`, NATIVE_ASSET_ROOT)),
  humanBody: await readFile(new URL("core/human-body-rigs.png", NATIVE_ASSET_ROOT)),
  humanFace: await readFile(new URL("core/human-face-planes.png", NATIVE_ASSET_ROOT)),
  humanHair: await readFile(new URL("core/human-hair.png", NATIVE_ASSET_ROOT)),
  humanClothing: await readFile(new URL("core/human-clothing-00.png", NATIVE_ASSET_ROOT)),
});

test("Task12R R5 Dry scene is one waterless wind-cut basin rather than tiled pickup scatter", async () => {
  const kit = "dry-scrub";
  const mechanics = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit];
  const sceneAuthority = REGIONAL_R5_KEY_SCENES[kit];
  assert.equal(mechanics.routeTiles.length, 28, "Dry keeps the exact R4 route topology");
  assert.deepEqual(mechanics.waterTiles, [], "Dry must remain waterless");
  assert.deepEqual(mechanics.shoreTiles, [], "Dry must not borrow a shoreline silhouette");
  assert.deepEqual(mechanics.bridgeTiles, [], "Dry must not invent bridge mechanics");
  assert.deepEqual(mechanics.terrainPatches.flatMap(({ tiles }) => tiles), [
    { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 }, { x: 6, y: 3 },
    { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 3, y: 5 }, { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
    { x: 13, y: 10 }, { x: 14, y: 10 }, { x: 15, y: 10 }, { x: 16, y: 10 },
    { x: 13, y: 11 }, { x: 14, y: 11 }, { x: 15, y: 11 }, { x: 16, y: 11 },
    { x: 13, y: 12 }, { x: 14, y: 12 }, { x: 15, y: 12 }, { x: 16, y: 12 },
  ], "Dry keeps the exact cracked-pan and pebble-fan mechanics cells");
  assert.deepEqual(sceneAuthority.yardLayers.map(({ x, y }) => ({ x, y })), [
    { x: 560, y: 256 }, { x: 560, y: 256 }, { x: 560, y: 256 },
  ], "Dry keeps the exact yard anchor");
  assert.deepEqual(
    { x: sceneAuthority.homeLayer.x, y: sceneAuthority.homeLayer.y },
    { x: 592, y: 272 },
    "Dry keeps the exact HomeActor placement",
  );

  const requiredSceneRoles = [
    "dry-ground-foundation",
    "dry-stratified-basin",
    "dry-open-thorn-passage",
    "dry-home-windbreak",
  ];
  const minimumOpaquePixels = {
    "dry-ground-foundation": 240_000,
    "dry-stratified-basin": 48_000,
    "dry-open-thorn-passage": 4_000,
    "dry-home-windbreak": 3_000,
  };
  const patchAlphaMetrics = (patch) => {
    let opaquePixels = 0;
    let left = patch.width;
    let top = patch.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < patch.height; y += 1) for (let x = 0; x < patch.width; x += 1) {
      if (patch.rows[y][x] === patch.transparentIndex) continue;
      opaquePixels += 1;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
    return {
      opaquePixels,
      bounds: right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 },
    };
  };
  for (const role of requiredSceneRoles) {
    const patchIds = REGIONAL_R5_LITERAL_PATCHES.roleBindings[role];
    assert.equal(patchIds?.length, 1, `${role}: Dry requires exactly one authority-owned scene-scale patch`);
    const patch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === patchIds[0]);
    assert.equal(patch?.ownerKit, kit, `${role}: literal bytes must be owned by Dry`);
    const placements = sceneAuthority.literalPatchLayers.filter((layer) => layer.role === role);
    assert.equal(placements.length, 1, `${role}: Dry key scene must compose the authority patch exactly once`);
    assert.equal(placements[0].patchId, patch.id);
    const alpha = patchAlphaMetrics(patch);
    assert.ok(alpha.opaquePixels >= minimumOpaquePixels[role],
      `${role}: actual authored alpha must be scene-scale (${alpha.opaquePixels})`);
    assert.ok(alpha.bounds?.width >= (role === "dry-open-thorn-passage" ? 144 : 192)
      && alpha.bounds?.height >= (role === "dry-home-windbreak" ? 80 : 128),
    `${role}: actual alpha bounds must read as joined scenery rather than one pickup`);
  }

  const dryAuthoritySources = [
    ...sceneAuthority.macroLayers.map(([, sourceId]) => sourceId),
    ...sceneAuthority.supportLayers.flatMap(({ patchId, sceneryKind }) => [patchId, sceneryKind]),
    ...sceneAuthority.literalPatchLayers.map(({ patchId }) => patchId),
    ...REGIONAL_R5_ATLAS_AUTHORING_PLANS[kit].flatMap(({ semanticCells }) => semanticCells
      .flatMap(([, , layers]) => layers.map(([, , , sourceId]) => sourceId))),
  ].filter(Boolean);
  for (const sourceId of dryAuthoritySources) {
    assert.doesNotMatch(sourceId,
      /(?:^|[/:_-])(?:skull|tent|camp|campfire|fire-pit|cauldron|wizard)(?:$|[/:_-])/iu,
    `${sourceId}: Dry scenery forbids camp, fantasy, and fire vocabulary`);
    assert.doesNotMatch(sourceId,
      /^r5-forbidden\/dry-scrub\/(?:sun-rock\/[23]|thorn\/[0-3])$/u,
    `${sourceId}: Dry must not revive forbidden skull/camp guide crops`);
  }

  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit, authoring });
  assert.deepEqual(
    validateComposedPixelAutocorrelation(scene.raw, { kit }),
    [],
    "Dry must clear both-axis RGB periodicity and all 32px phase-lock gates",
  );
  const spatialVariety = analyzeComposedPixelSpatialVariety(scene.raw);
  assert.equal(spatialVariety.totalWindows, 384);
  assert.ok(spatialVariety.uniqueWindowHashes >= 340,
    `Dry requires at least 340 unique 32px windows (${spatialVariety.uniqueWindowHashes})`);
  assert.ok(spatialVariety.windowsInRepeatedGroups <= 50,
    `Dry allows at most 50 windows in repeated groups (${spatialVariety.windowsInRepeatedGroups})`);
  const allowedWorldRgb = new Set([
    REGIONAL_R5_PALETTES.outline.source,
    ...Object.values(REGIONAL_R5_PALETTES.kits[kit]),
    REGIONAL_R5_PALETTES.shared["matte-dirt"],
  ].map((hex) => hex.toLowerCase()));
  const forbiddenWaterRgb = new Set(["#2b7c97", "#5bb5bc", "#477b79", "#73aaa2", "#6b8870"]);
  for (let offset = 0; offset < scene.raw.data.length; offset += 4) {
    if (scene.raw.data[offset + 3] === 0) continue;
    const rgb = `#${[0, 1, 2].map((channel) => scene.raw.data[offset + channel]
      .toString(16).padStart(2, "0")).join("")}`;
    assert.ok(allowedWorldRgb.has(rgb), `${rgb}: Dry world-only pixels must stay in the Dry palette`);
    assert.equal(forbiddenWaterRgb.has(rgb), false, `${rgb}: Dry forbids blue-green water-like pixels`);
  }
  assert.equal(sha256(scene.raw.data),
    "ea70e6dcd7f9f5e1a47d00f537b8b732d83d1033ac3591b6c61dded1377d1673",
  "the accepted actorless scene replaces the legacy crop-support silhouette receipts");
  const landmarks = authoring.rawMasters[`${kit}-landmarks`];
  for (let cell = 0; cell < 8; cell += 1) {
    const data = rawAtlasCellBytes({ data: landmarks.data, info: { width: landmarks.width } },
      cell, 4, 128, 128);
    assert.deepEqual(
      validateLandmarkMaterialDepth({ data, width: 128, height: 128, channels: 4 }, `${kit}/${cell}`),
      [],
      `${kit}/${cell}: landmark must read as scenery-scale material rather than a pickup`,
    );
  }
});

test("Task12R R5 Dry V32 exact source authority reproduces the accepted world and landmark bytes", async () => {
  const kit = "dry-scrub";
  const patchById = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const exactPatches = [
    ["dry:v32-actorless-world", "dfc5802df62877b899d80f2a74919c03b0431ee1ee8f787a6ce406258663322d"],
    ["dry:v32-stratified-basin-witness", "49a80351a71a18b369afe3e5fa0b7931ed2fefa1041900d13bbfad88c7ceb375"],
    ["dry:v32-open-thorn-passage-witness", "adc719f1df63770de93ca6f2da9978a63180335698903e69c3e0666838efbf46"],
    ["dry:v32-home-windbreak-witness", "d8fa090c8ade356355248ffab1bab7359f689d7460415720cf837fd3033b5633"],
    ["dry:v32-permanent-home-shell", "2a14ef3439045500f2772edf76945c8775e630e42f3c1091b914f9fe1acbe23e"],
    ["dry:v32-threshold-foreground", "90356cfe2570ea4843ba7035a65b6b449d61a169779300802bc89e2b43f72d8d"],
    ["dry:landmark-anatomy-0", "d5c26f84cb999832178176288b454d6c6affed03009ffc5a0e386af8740c0bcf"],
    ["dry:landmark-anatomy-1", "7d26e708198b41afa651dcb9d295136a0bfaf79b8270e58e8839ea1ebe7707b7"],
    ["dry:landmark-anatomy-2", "139e143717349254d5e7804b4584669a5adc21ffd94883cbf0cb7f549b7eba48"],
    ["dry:landmark-anatomy-3", "b4cf979096ca46aa7c9532fd982eacf717badffdcc245c44962ea0c43500c7b1"],
    ["dry:landmark-anatomy-4", "b976fba7946031d3a2751237d57db98565eaddd4247bd16ea2688e5450c27789"],
    ["dry:landmark-anatomy-5", "1ef43a5e5a8abb92a03d872ff38a20241a0b06e36ff49cfdbf2ed5f35ea53201"],
    ["dry:landmark-anatomy-6", "3df687116c7d9563775b7220b0cf382374119591d611149854511e00e7cf3de8"],
    ["dry:landmark-anatomy-7", "6d65e31ddc4038a92c9fc51460ebb95a8ffba31f8c951fbfd6e48342b0ec2683"],
  ];
  for (const [id, canonicalSha256] of exactPatches) {
    const patch = patchById.get(id);
    assert.ok(patch, `${id} must be source-controlled literal authority`);
    assert.equal(patch.ownerKit, kit);
    assert.equal(patch.canonicalSha256, canonicalSha256);
  }
  assert.equal(REGIONAL_R5_LITERAL_PATCHES.patches.filter(({ ownerKit }) => ownerKit === kit).length, 14,
    "Dry uses six semantic scene/home authorities plus eight independently addressable landmarks");
  assert.equal(patchById.has("dry:v32-home-restoration"), false,
    "a whole-home restoration shortcut must not replace source-derived HomeActor composition");
  const actorless = patchById.get("dry:v32-actorless-world");
  const actorlessOpaquePixels = actorless.rows.join("").split("")
    .filter((index) => index !== actorless.transparentIndex).length;
  assert.equal(actorlessOpaquePixels, 390_039);
  assert.ok(actorlessOpaquePixels < actorless.width * actorless.height,
    "the world authority must keep actor pixels transparent for dynamic actor composition");
  assert.deepEqual(Object.fromEntries([
    "dry-ground-foundation",
    "dry-stratified-basin",
    "dry-open-thorn-passage",
    "dry-home-windbreak",
    "dry-permanent-home-shell",
    "dry-threshold-foreground",
    "dry-landmark-anatomy",
  ].map((role) => [role, REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]])), {
    "dry-ground-foundation": ["dry:v32-actorless-world"],
    "dry-stratified-basin": ["dry:v32-stratified-basin-witness"],
    "dry-open-thorn-passage": ["dry:v32-open-thorn-passage-witness"],
    "dry-home-windbreak": ["dry:v32-home-windbreak-witness"],
    "dry-permanent-home-shell": ["dry:v32-permanent-home-shell"],
    "dry-threshold-foreground": ["dry:v32-threshold-foreground"],
    "dry-landmark-anatomy": Array.from({ length: 8 }, (_unused, index) => `dry:landmark-anatomy-${index}`),
  });

  const authoring = await regionalR5Authoring();
  const world = await productionPacker.buildRegionalR5KeyScene({ kit, authoring });
  assert.equal(sha256(world.raw.data),
    "ea70e6dcd7f9f5e1a47d00f537b8b732d83d1033ac3591b6c61dded1377d1673",
  "the production key scene must be the accepted actorless V32 world, not a visual approximation");

  const landmarks = authoring.rawMasters[`${kit}-landmarks`];
  assert.equal(sha256(landmarks.data),
    "81703bad31ecc10cc9f3e3197d19757ce00c188172b9e5a41d4547f8662ec29d");
  assert.equal(sha256(authoring.buffers[`${kit}-landmarks`]),
    "ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e");

  const complete = await productionPacker.buildRegionalR5CompleteProofScene({
    kit,
    authoring,
    sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
  });
  assert.equal(complete.rgbaSha256,
    "35d2eed8ecb9dc65c2763fb9fc4e286e5abebe84947d2c9aa53512221db382ae");
  assert.equal(complete.pngSha256,
    "dda3799da93e78f2fb3f9631dd71acbe61959485522bf184a8dc17ad228f940c");
});

test("Task12R R5 Dry complete proof uses the canonical one-face humans and entrance depth", async () => {
  const kit = "dry-scrub";
  const complete = await productionPacker.buildRegionalR5CompleteProofScene({
    kit,
    authoring: await regionalR5Authoring(),
    sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
  });
  assert.equal(complete.humanWitnesses.length, 3);
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit].home.doorCenterPx, { x: 656, y: 368 },
    "the mechanical door center remains separate and frozen");
  const shelter = complete.humanWitnesses.find(({ placement }) => placement.role === "shelter-door");
  assert.deepEqual({ x: shelter.placement.x, y: shelter.placement.y }, { x: 672, y: 310 },
    "Dry uses the exact mechanics-backed shelter presentation anchor");
  assert.deepEqual(shelter.feet, { x: 696, y: 371 });
  assert.equal(new Set(complete.humanWitnesses.map(({ patchRgbaSha256 }) => patchRgbaSha256)).size, 1,
    "all Dry witnesses use one coherent canonical south-facing human patch");
  assert.equal(complete.productionHuman.patchRgbaSha256,
    "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
  "Dry must use the exact canonical one-face human patch");
  assert.equal(complete.productionHuman.facePatchRgbaSha256,
    REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.humanSemanticRgbaSha256.face,
    "Dry face plane remains the exact single canonical face");
  assert.equal(complete.entranceDepth.portalHumanOverlap, 0,
    "the shelter witness must not overlap the doorway portal");
  assert.equal(complete.entranceDepth.foregroundHumanOverlap, 0,
    "the doorway foreground must not produce a second overlapping face/body read");
  assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(complete.entranceDepth.contactShadows),
    [80, 80, 80], "all three canonical humans require exact isolated 80px contact shadows");
  assert.equal(complete.homeActor.frontPatchRgbaSha256,
    "09cce4f5c1caee2e10d65b338fbf2459563bb66346a2e923a9c3aa85ed5642d3",
  "Dry front patch must retain its exact unchanged HomeActor receipt");
  assert.equal(Object.hasOwn(REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth.frontPatchRgbaSha256, kit), false,
    "the frozen shared entrance contract remains unchanged; Dry owns a packer-local source receipt");
});

test("Task12R R5 Dry route corridor and windbreak relation are authority-derived and unobstructed", async () => {
  assert.equal(typeof productionPacker.measureRegionalR5DryRouteClearance, "function",
    "Dry requires a production no-knob route-clearance measurement");
  const authoring = await regionalR5Authoring();
  const measurement = await productionPacker.measureRegionalR5DryRouteClearance({
    authoring,
  });
  assert.equal(measurement.routeTileCount, 28, "the clearance witness derives the exact frozen Dry route");
  assert.equal(measurement.straightSegmentWidthsPx.length, 18);
  assert.deepEqual(measurement.imputedSampleIndexes, [4, 17],
    "only the two authority-owned dynamic actor slots may use adjacent visible route widths");
  assert.equal(measurement.minimumClearWidthPx, 19.75);
  assert.equal(measurement.maximumClearWidthPx, 20.25);
  assert.equal(measurement.maximumTrailCenterlineDistancePx, 10.63014581273465);
  assert.equal(measurement.salientObstructionPixels, 0,
    "no visible thorn, branch, windbreak, or home-foreground alpha may cross the route corridor");
  assert.equal(measurement.windbreakCorridorOverlapPixels, 0,
    "the home windbreak must remain strictly outside the route corridor");
  assert.equal(measurement.windbreakParallelToFinalApproach, true,
    "the windbreak must run beside rather than across the final approach");
  assert.ok(measurement.windbreakAngleDifferenceDegrees < 15);
  assert.ok(measurement.windbreakAxisRatio >= 1.5);
  assert.equal(measurement.windbreakTouchesHomeFoundation, true,
    "the windbreak must join the permanent home plinth/yard instead of floating as a prop");
  assert.equal(measurement.windbreakHomeFoundationGapPx, 12);
  assert.ok(measurement.windbreakHomeProjectionOverlapPx >= 24);
  await assert.rejects(() => productionPacker.measureRegionalR5DryRouteClearance({
    authoring,
    routeTiles: [],
    obstacleMask: Buffer.alloc(768 * 512),
    minimumWidth: 1,
  }), /candidate|knob|forbidden|unexpected/i,
  "candidate-provided routes, masks, and thresholds must not weaken the authority gate");
});

test("Task12R R5 Dry route geometry rejects a narrowed obstruction, crossed windbreak, and severed home contact", async () => {
  assert.equal(typeof productionPacker.analyzeRegionalR5DryRouteGeometry, "function",
    "Dry needs a pure pixel-geometry analyzer behind the trusted no-knob wrapper");
  const kit = "dry-scrub";
  const authoring = await regionalR5Authoring();
  const scene = (await productionPacker.buildRegionalR5KeyScene({ kit, authoring })).raw;
  const authority = REGIONAL_R5_KEY_SCENES[kit];
  const blankMask = () => ({
    data: Buffer.alloc(scene.width * scene.height * 4),
    width: scene.width,
    height: scene.height,
    channels: 4,
  });
  const placedRoleMask = (role, placements) => {
    const output = blankMask();
    for (const placement of placements.filter((candidate) => candidate.role === role)) {
      productionPacker.placeRegionalR5RawLayer(
        output,
        authoring.patches.get(placement.patchId),
        placement.x,
        placement.y,
      );
    }
    return output;
  };
  const thornMask = placedRoleMask("dry-open-thorn-passage", authority.literalPatchLayers);
  const dryColors = REGIONAL_R5_PALETTES.kits[kit];
  const thornRgb = new Set([dryColors.deadwood, dryColors.thorn].map((hex) => [1, 3, 5]
    .map((index) => Number.parseInt(hex.slice(index, index + 2), 16)).join(",")));
  for (let offset = 0; offset < thornMask.data.length; offset += 4) {
    if (!thornRgb.has([...thornMask.data.subarray(offset, offset + 3)].join(","))) {
      thornMask.data.fill(0, offset, offset + 4);
    }
  }
  const windbreakMask = placedRoleMask("dry-home-windbreak", authority.literalPatchLayers);
  const homeFoundationMask = placedRoleMask("dry-permanent-home-shell", authority.completeUnderlayLayers);
  const homeForegroundMask = placedRoleMask("dry-threshold-foreground", authority.completeForegroundLayers);
  const canonicalInputs = { scene, thornMask, windbreakMask, homeFoundationMask, homeForegroundMask };
  const canonical = productionPacker.analyzeRegionalR5DryRouteGeometry(canonicalInputs);
  assert.deepEqual(canonical.errors, []);

  const blockedScene = { ...scene, data: Buffer.from(scene.data) };
  const blockedThorn = { ...thornMask, data: Buffer.from(thornMask.data) };
  const thornColor = [112, 80, 59, 255];
  for (let y = 199; y <= 201; y += 1) for (let x = 529; x <= 531; x += 1) {
    blockedScene.data.set(thornColor, (y * scene.width + x) * 4);
    blockedThorn.data.set(thornColor, (y * scene.width + x) * 4);
  }
  const blocked = productionPacker.analyzeRegionalR5DryRouteGeometry({
    ...canonicalInputs,
    scene: blockedScene,
    thornMask: blockedThorn,
  });
  assert.equal(blocked.salientObstructionPixels, 9);
  assert.ok(blocked.straightSegmentWidthsPx[6] < canonical.straightSegmentWidthsPx[6]);
  assert.match(blocked.errors.join("\n"), /route-(?:obstruction|width)/i);

  const crossedWindbreak = blankMask();
  const windbreakPixels = [];
  for (let y = 0; y < scene.height; y += 1) for (let x = 0; x < scene.width; x += 1) {
    const offset = (y * scene.width + x) * 4;
    if (windbreakMask.data[offset + 3] !== 0) windbreakPixels.push({ x, y, offset });
  }
  const centerX = windbreakPixels.reduce((sum, { x }) => sum + x, 0) / windbreakPixels.length;
  const centerY = windbreakPixels.reduce((sum, { y }) => sum + y, 0) / windbreakPixels.length;
  for (const { x, y, offset } of windbreakPixels) {
    const destinationX = Math.round(centerX - (y - centerY));
    const destinationY = Math.round(centerY + (x - centerX));
    if (destinationX < 0 || destinationX >= scene.width || destinationY < 0 || destinationY >= scene.height) continue;
    windbreakMask.data.copy(
      crossedWindbreak.data,
      (destinationY * scene.width + destinationX) * 4,
      offset,
      offset + 4,
    );
  }
  const crossed = productionPacker.analyzeRegionalR5DryRouteGeometry({
    ...canonicalInputs,
    windbreakMask: crossedWindbreak,
  });
  assert.equal(crossed.windbreakParallelToFinalApproach, false);
  assert.match(crossed.errors.join("\n"), /windbreak-parallelism/i);

  const severedFoundation = blankMask();
  for (let y = 0; y < scene.height - 32; y += 1) {
    homeFoundationMask.data.copy(
      severedFoundation.data,
      ((y + 32) * scene.width) * 4,
      (y * scene.width) * 4,
      ((y + 1) * scene.width) * 4,
    );
  }
  const severed = productionPacker.analyzeRegionalR5DryRouteGeometry({
    ...canonicalInputs,
    homeFoundationMask: severedFoundation,
  });
  assert.equal(severed.windbreakTouchesHomeFoundation, false);
  assert.ok(severed.windbreakHomeFoundationGapPx > canonical.windbreakHomeFoundationGapPx);
  assert.match(severed.errors.join("\n"), /home-foundation-contact/i);
});

test("Task12R R5 Dry permanent-home shell preserves source bytes while masking pavilion cues", async () => {
  const kit = "dry-scrub";
  const shellIds = REGIONAL_R5_LITERAL_PATCHES.roleBindings["dry-permanent-home-shell"];
  assert.equal(shellIds?.length, 1, "Dry requires one authority-owned adobe shell");
  const shellAuthority = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === shellIds[0]);
  assert.equal(shellAuthority?.ownerKit, kit);
  const complete = await productionPacker.buildRegionalR5CompleteProofScene({
    kit,
    authoring: await regionalR5Authoring(),
    sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
  });
  assert.deepEqual(complete.homePresentation.layerOrder, [
    "world",
    "canonical-home-actor",
    "dry-permanent-home-shell",
    "human-contact-shadows",
    "human-witnesses",
    "dry-threshold-foreground",
  ], "the shell must mask the exact home before humans, with only threshold depth returning afterward");
  assert.equal(complete.homePresentation.shellPatchId, shellAuthority.id);
  assert.equal(complete.homePresentation.shellPortalOverlap, 0,
    "the permanent shell must preserve every exact portal pixel");
  assert.equal(complete.homePresentation.shellHumanOverlap, 0,
    "the permanent shell must not occlude any canonical human pixel");
  assert.equal(complete.homeActor.patchRgbaSha256,
    "98277faa31199910b588bcaa3da9469c2cda2da49f3cca91a887ea96de16337f",
    "the underlying complete HomeActor stays byte-exact");
  assert.equal(complete.homeActor.frontPatchRgbaSha256,
    "09cce4f5c1caee2e10d65b338fbf2459563bb66346a2e923a9c3aa85ed5642d3",
    "the full immutable frontPatch remains source-exact even when only its threshold band is visible");
  assert.equal(complete.homePresentation.exposedPavilionPixels, 0,
    "no peaked roof, post, canopy, or black triangular pavilion pixels may remain visible");
});

test("Task12R R5 offline engine samples the whole 1536x1024 sheet at exact even/even source pixels", () => {
  assert.equal(typeof productionPacker.normalizeRegionalR5WholeSheet, "function");
  const width = 1536;
  const height = 1024;
  const source = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    source[offset] = x % 251;
    source[offset + 1] = y % 241;
    source[offset + 2] = (x * 3 + y * 5) % 239;
    source[offset + 3] = (x + y) % 253;
  }
  const normalized = productionPacker.normalizeRegionalR5WholeSheet({
    data: source,
    width,
    height,
    channels: 4,
  });
  assert.deepEqual(
    { width: normalized.width, height: normalized.height, channels: normalized.channels },
    { width: 768, height: 512, channels: 4 },
  );
  for (const [x, y] of [[0, 0], [1, 1], [383, 255], [767, 511]]) {
    const actualOffset = (y * normalized.width + x) * 4;
    const sourceOffset = ((2 * y) * width + 2 * x) * 4;
    assert.deepEqual(
      [...normalized.data.subarray(actualOffset, actualOffset + 4)],
      [...source.subarray(sourceOffset, sourceOffset + 4)],
      `normalized(${x},${y}) must equal source(${2 * x},${2 * y})`,
    );
  }
  assert.equal(
    createHash("sha256").update(normalized.data).digest("hex"),
    "76025134b4dc5d9ca5aee86ca8f13ecc2e483bd0ad66572489d5bea400b5b115",
    "synthetic whole-sheet sampling bytes are the frozen golden",
  );
});

test("Task12R R5 offline engine applies the exact half-open odd-coordinate normalized rectangle formula", () => {
  assert.equal(typeof productionPacker.normalizedRegionalR5Rect, "function");
  assert.deepEqual(productionPacker.normalizedRegionalR5Rect([1, 3, 4, 6]), [1, 2, 2, 3]);
  assert.deepEqual(productionPacker.normalizedRegionalR5Rect([94, 517, 66, 77]), [47, 259, 33, 38]);
});

test("Task12R R5 offline engine chroma-keys, zeros transparent RGB, quantizes lexical ties, and repairs one outline pass", () => {
  assert.equal(typeof productionPacker.cleanRegionalR5Crop, "function");
  const width = 7;
  const height = 7;
  const data = Buffer.alloc(width * height * 4);
  const set = (x, y, rgba) => data.set(rgba, (y * width + x) * 4);
  set(3, 3, [0, 0, 1, 128]); // exact tie between alpha-token and zeta-token
  set(1, 1, [28, 28, 36, 255]); // existing outline remains exact
  set(5, 5, [240, 20, 220, 255]); // chroma keyed
  set(6, 6, [90, 80, 70, 0]); // transparent residue must be zeroed
  const cleaned = productionPacker.cleanRegionalR5Crop({
    data,
    width,
    height,
    palette: { "zeta-token": "#000002", "alpha-token": "#000000" },
  });
  const rgbaAt = (x, y) => [...cleaned.data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
  assert.deepEqual(rgbaAt(3, 3), [0, 0, 0, 255], "lexically first token wins an exact distance tie");
  assert.deepEqual(rgbaAt(1, 1), [28, 28, 36, 255], "existing exact outline is preserved");
  assert.deepEqual(rgbaAt(5, 5), [0, 0, 0, 0]);
  assert.deepEqual(rgbaAt(6, 6), [0, 0, 0, 0]);
  for (const [x, y] of [[3, 2], [4, 3], [3, 4], [2, 3]]) {
    assert.deepEqual(rgbaAt(x, y), [28, 28, 36, 255], "four-neighbour receives repaired outline");
  }
  for (const [x, y] of [[2, 2], [4, 2], [4, 4], [2, 4], [3, 1]]) {
    assert.deepEqual(rgbaAt(x, y), [0, 0, 0, 0], "diagonal and iterative outline growth are forbidden");
  }
});

test("Task12R R5 offline engine pins strict chroma inequalities and palette ties independent of insertion order", () => {
  const samples = [
    [210, 20, 220, 255],
    [240, 100, 220, 255],
    [240, 20, 170, 255],
    [211, 99, 171, 255],
  ];
  const data = Buffer.alloc(7 * 3 * 4);
  for (const [index, rgba] of samples.entries()) data.set(rgba, ((1 * 7) + index * 2) * 4);
  const source = { data, width: 7, height: 3, channels: 4 };
  const left = productionPacker.cleanRegionalR5Crop({
    ...source,
    palette: { "zeta-token": "#000002", "alpha-token": "#000000" },
  });
  const right = productionPacker.cleanRegionalR5Crop({
    ...source,
    palette: { "alpha-token": "#000000", "zeta-token": "#000002" },
  });
  assert.equal(left.data.equals(right.data), true, "object insertion order cannot affect a lexical tie");
  assert.deepEqual([0, 2, 4, 6].map((x) => left.data[((1 * 7) + x) * 4 + 3]), [255, 255, 255, 0]);
});

test("Task12R R5 offline engine realizes literal indexed patches through shared plus owning named palettes only", () => {
  assert.equal(typeof productionPacker.realizeRegionalR5IndexedPatch, "function");
  const patch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === "ash:sealed-filter-box");
  const realized = productionPacker.realizeRegionalR5IndexedPatch(patch);
  assert.deepEqual({ width: realized.width, height: realized.height, channels: realized.channels }, {
    width: patch.width,
    height: patch.height,
    channels: 4,
  });
  const permitted = new Set([[0, 0, 0, 0], [28, 28, 36, 255], ...Object.values(
    REGIONAL_R5_PALETTES.kits[patch.ownerKit],
  ).map((hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ])].map((rgba) => rgba.join(",")));
  for (let offset = 0; offset < realized.data.length; offset += 4) {
    assert.ok(permitted.has([...realized.data.subarray(offset, offset + 4)].join(",")));
  }
});

test("Task12R R5 offline engine rejects malformed and undeclared literal patch candidates before decoding", () => {
  const patch = REGIONAL_R5_LITERAL_PATCHES.patches[0];
  assert.throws(
    () => productionPacker.realizeRegionalR5IndexedPatch({ ...patch, width: patch.width + 1 }),
    /schema|geometry|row|hash/i,
  );
  const rows = [...patch.rows];
  rows[0] = `9${rows[0].slice(1)}`;
  const hostile = { ...patch, rows };
  delete hostile.canonicalSha256;
  const canonical = (value) => Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
      : JSON.stringify(value);
  hostile.canonicalSha256 = createHash("sha256").update(canonical(hostile)).digest("hex");
  assert.throws(
    () => productionPacker.realizeRegionalR5IndexedPatch(hostile),
    /outside the declared per-kit allowlist/i,
  );
});

test("Task12R R5 semantic authority realizes only declared per-kit literal patches", () => {
  const neutral = REGIONAL_R5_LITERAL_PATCHES.patches
    .find(({ id }) => id === "neutral:pale-lane-ew");
  assert.ok(neutral, "neutral pale-lane literal authority must exist");
  assert.equal(neutral.ownerKit, "neutral-temperate");
  assert.equal(REGIONAL_R5_LITERAL_PATCHES.roleBindings["neutral-lane-topology"].includes(neutral.id), true);
  const realized = productionPacker.realizeRegionalR5IndexedPatch(neutral);
  assert.deepEqual([realized.width, realized.height, realized.channels], [32, 32, 4]);
  for (let offset = 0; offset < realized.data.length; offset += 4) {
    if (realized.data[offset + 3] === 0) {
      assert.deepEqual([...realized.data.subarray(offset, offset + 4)], [0, 0, 0, 0]);
    }
  }
  assert.throws(
    () => productionPacker.realizeRegionalR5IndexedPatch({ ...neutral, ownerKit: "ash-waste" }),
    /owner|hash|allowlist/i,
  );
  assert.throws(
    () => productionPacker.realizeRegionalR5IndexedPatch({ ...neutral, id: "neutral:undeclared" }),
    /declared|hash|allowlist/i,
  );
});

test("Task12R R5 semantic terrain uses literal lane, pond-water, and pond-verge topology", () => {
  const plan = REGIONAL_R5_ATLAS_AUTHORING_PLANS["neutral-temperate"]
    .find(({ atlasId }) => atlasId === "neutral-temperate-terrain");
  const expected = [
    [8, 15, "neutral-lane-topology", "neutral:pale-lane-"],
    [16, 23, "neutral-pond-water-topology", "neutral:pond-water-"],
    [24, 31, "neutral-pond-verge-topology", "neutral:pond-verge-"],
  ];
  for (const [start, end, role, prefix] of expected) {
    for (let cell = start; cell <= end; cell += 1) {
      const layers = plan.semanticCells.find(([index]) => index === cell)[2];
      const literal = layers.filter((layer) => layer[2] === "literal-patch");
      assert.equal(literal.length, 1, `neutral terrain cell ${cell} requires one closed literal patch`);
      assert.equal(literal[0][4], role);
      assert.match(literal[0][3], new RegExp(`^${prefix}`));
      assert.deepEqual(literal[0].slice(5), [0, 0, "neutral-temperate", "none"]);
    }
  }
});

test("Task12R R5 offline engine clips integer translations and rejects fractional placement", () => {
  assert.equal(typeof productionPacker.placeRegionalR5RawLayer, "function");
  const destination = { data: Buffer.alloc(4 * 4 * 4), width: 4, height: 4, channels: 4 };
  const source = { data: Buffer.alloc(3 * 3 * 4, 255), width: 3, height: 3, channels: 4 };
  productionPacker.placeRegionalR5RawLayer(destination, source, -1, 2);
  const opaque = [...destination.data].filter((_value, offset) => offset % 4 === 3 && destination.data[offset] === 255).length;
  assert.equal(opaque, 4, "placement clips to the destination without fitting or scaling");
  assert.throws(
    () => productionPacker.placeRegionalR5RawLayer(destination, source, 0.5, 1),
    /integer.*translation|fractional/i,
  );
});

test("Task12R R5 offline engine rejects duplicate z, transforms, and fractional literal-layer offsets", () => {
  assert.equal(typeof productionPacker.validateRegionalR5LiteralLayers, "function");
  const valid = [
    ["layer/a", 0, "crop", "source/a", "route-or-patch", 0, 0, "ash-waste", "none"],
    ["layer/b", 1, "crop", "source/b", "route-or-patch", 1, 2, "ash-waste", "none"],
  ];
  assert.deepEqual(productionPacker.validateRegionalR5LiteralLayers(valid, "ash-waste"), []);
  for (const [label, hostile] of [
    ["duplicate z", [valid[0], ["layer/b", 0, ...valid[1].slice(2)]]],
    ["transform", [valid[0], [...valid[1].slice(0, 8), "flip-x"]]],
    ["fractional", [valid[0], [...valid[1].slice(0, 5), 1.5, ...valid[1].slice(6)]]],
  ]) assert.match(productionPacker.validateRegionalR5LiteralLayers(hostile, "ash-waste").join("\n"), new RegExp(label, "i"));
});

test("Task12R R5 offline engine builds deterministic exact 20 source masters without publication", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5SourceMasters, "function");
  const sourceBuffers = await regionalR5GuideBuffers();
  const first = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers });
  const second = await productionPacker.buildRegionalR5SourceMasters({ sourceBuffers });
  assert.equal(Object.keys(first.buffers).length, 20);
  assert.deepEqual(Object.keys(first.buffers).sort(), Object.keys(second.buffers).sort());
  for (const id of Object.keys(first.buffers)) {
    assert.equal(first.buffers[id].equals(second.buffers[id]), true, `${id} bytes must be deterministic`);
    assert.equal(first.digests[id], createHash("sha256").update(first.buffers[id]).digest("hex"));
  }
  for (const [id, expected] of Object.entries(REMEDIATED_SOURCE_MASTER_HASHES)) {
    assert.equal(createHash("sha256").update(first.rawMasters[id].data).digest("hex"), expected.rgba, `${id} RGBA`);
    assert.equal(first.digests[id], expected.png, `${id} PNG`);
  }
  assert.deepEqual(first.sourceDigests, second.sourceDigests);
  for (const kit of REGIONAL_R5_AUTHORING_KITS) {
    const terrain = first.rawMasters[`${kit}-terrain`];
    for (let cell = 36; cell < 64; cell += 1) {
      const columns = 8;
      let opaque = 0;
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
        opaque += terrain.data[(((Math.floor(cell / columns) * 32 + y) * terrain.width)
          + (cell % columns) * 32 + x) * 4 + 3] === 255;
      }
      assert.equal(opaque, 0, `${kit} cell ${cell} stays zero-RGB transparent; negative offsets cannot bleed cells`);
    }
  }
});

test("Task12R R5 exact 19 neutral palette subsets alter RGB with zero actual-alpha drift", async () => {
  const sourceBuffers = await regionalR5GuideBuffers();
  const { data, info } = await sharp(sourceBuffers.regionKits).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const normalized = productionPacker.normalizeRegionalR5WholeSheet({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
  const authoring = await regionalR5Authoring();
  const inventory = [
    ...REGIONAL_R5_CROPS.safeGuideFragments,
    ...REGIONAL_R5_CROPS.regionalMacros,
    ...REGIONAL_R5_CROPS.homeMaterialFragments,
  ];
  const cropRaw = ([left, top, width, height]) => {
    const crop = { data: Buffer.alloc(width * height * 4), width, height, channels: 4 };
    for (let y = 0; y < height; y += 1) {
      const start = ((top + y) * normalized.width + left) * 4;
      normalized.data.copy(crop.data, y * width * 4, start, start + width * 4);
    }
    return crop;
  };
  let changedRgbPixels = 0;
  let changedAlphaPixels = 0;
  for (const [id, paletteTokens] of TARGETED_NEUTRAL_PALETTE_TOKENS) {
    const descriptor = inventory.find((crop) => crop.id === id);
    assert.ok(descriptor, `${id} crop authority exists`);
    assert.deepEqual(descriptor.paletteTokens, paletteTokens);
    const source = cropRaw(descriptor.normalizedRect);
    const full = productionPacker.cleanRegionalR5Crop({
      ...source,
      palette: REGIONAL_R5_PALETTES.kits[descriptor.kit],
    });
    const targeted = productionPacker.cleanRegionalR5Crop({
      ...source,
      palette: Object.fromEntries(paletteTokens.map((token) => (
        [token, REGIONAL_R5_PALETTES.kits[descriptor.kit][token]]
      ))),
    });
    assert.equal(targeted.data.equals(authoring.fragments.get(id).data), true, `${id} consumes its literal subset`);
    for (let offset = 0; offset < full.data.length; offset += 4) {
      changedAlphaPixels += full.data[offset + 3] !== targeted.data[offset + 3];
      changedRgbPixels += !full.data.subarray(offset, offset + 3).equals(targeted.data.subarray(offset, offset + 3));
    }
  }
  assert.equal(changedAlphaPixels, 0, "all 19 targeted crops preserve every authored alpha byte");
  assert.ok(changedRgbPixels > 0, "the explicit palette subsets perform a real RGB-only remediation");
});

test("Task12R R5 offline engine rejects either guide hash and decoded dimensions before rendering", async () => {
  const sourceBuffers = await regionalR5GuideBuffers();
  for (const key of ["regionKits", "homeRuin"]) {
    const invalid = { ...sourceBuffers, [key]: Buffer.from(sourceBuffers[key]) };
    invalid[key][Math.floor(invalid[key].length / 2)] ^= 0xff;
    await assert.rejects(
      productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: invalid }),
      new RegExp(`${key}|hash`, "i"),
    );
  }
  let decodeCalls = 0;
  await assert.rejects(
    productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers,
      decodeSource: async () => {
        decodeCalls += 1;
        return { data: Buffer.alloc(4), width: 1, height: 1, channels: 4 };
      },
    }),
    /1536x1024|dimension/i,
  );
  assert.equal(decodeCalls, 1, "dimension failure aborts before the second decode or any master rendering");
});

test("Task12R R5 offline engine binds injected decoded RGBA to the approved guide bytes", async () => {
  const sourceBuffers = await regionalR5GuideBuffers();
  let decodeCalls = 0;
  await assert.rejects(
    productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers,
      decodeSource: async (_buffer, descriptor) => {
        decodeCalls += 1;
        return {
          data: Buffer.alloc(descriptor.width * descriptor.height * 4),
          width: descriptor.width,
          height: descriptor.height,
          channels: 4,
        };
      },
    }),
    /decoded.*(?:RGBA|hash|bytes).*drift|guide.*decoded.*drift/i,
  );
  assert.equal(decodeCalls, 1, "same-size forged RGBA must fail before the second guide decode");
});

test("Task12R R5 offline engine rejects an approved decoded-RGBA Buffer with shadowed copy behavior", async () => {
  const sourceBuffers = await regionalR5GuideBuffers();
  const decodedHashes = {
    "region-kits": "0be8998e754cb1b3591df3b8b0a45bdac0fafcc984f613e7790beee4c6d34379",
    "home-ruin": "410ff696644276f6fc623c5e2a2a66df01fcbdfc2f020df371a7149c1976a2e3",
  };
  let shadowCopies = 0;
  await assert.rejects(
    productionPacker.buildRegionalR5SourceMasters({
      sourceBuffers,
      decodeSource: async (buffer, descriptor) => {
        const { data, info } = await sharp(buffer).ensureAlpha().raw()
          .toBuffer({ resolveWithObject: true });
        assert.equal(createHash("sha256").update(data).digest("hex"), decodedHashes[descriptor.id]);
        data.copy = (target, targetStart, sourceStart, sourceEnd) => {
          shadowCopies += 1;
          target.fill(0, targetStart, targetStart + sourceEnd - sourceStart);
          return sourceEnd - sourceStart;
        };
        return { data, width: info.width, height: info.height, channels: info.channels };
      },
    }),
    /decoded|raw bytes|unshadowed|copy|Buffer/i,
  );
  assert.equal(shadowCopies, 0, "decoded Buffer behavior fails before normalization invokes copy");
});

test("Task12R R5 offline engine rejects source-buffer accessors before hash/decode TOCTOU", async () => {
  const approved = await regionalR5GuideBuffers();
  const alternate = await sharp(approved.regionKits)
    .png({ compressionLevel: 0, adaptiveFiltering: false })
    .toBuffer();
  assert.notEqual(
    createHash("sha256").update(alternate).digest("hex"),
    createHash("sha256").update(approved.regionKits).digest("hex"),
    "alternate PNG must have different compressed bytes",
  );
  const [approvedRaw, alternateRaw] = await Promise.all([
    sharp(approved.regionKits).ensureAlpha().raw().toBuffer(),
    sharp(alternate).ensureAlpha().raw().toBuffer(),
  ]);
  assert.equal(approvedRaw.equals(alternateRaw), true, "alternate PNG must decode to approved RGBA");
  let regionReads = 0;
  const hostile = { homeRuin: approved.homeRuin };
  Object.defineProperty(hostile, "regionKits", {
    configurable: true,
    enumerable: true,
    get: () => (regionReads += 1) === 1 ? approved.regionKits : alternate,
  });
  await assert.rejects(
    productionPacker.buildRegionalR5SourceMasters({ sourceBuffers: hostile }),
    /sourceBuffers|source buffer|plain data|accessor|TOCTOU/i,
  );
  assert.equal(regionReads, 0, "accessor is rejected by descriptor before either PNG is read");
});

test("Task12R R5 offline engine rejects the full generic-terrain upstream provenance bypass", async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: regionalR5GuideBuffers(),
  });
  const terrain = authoring.rawMasters["worn-heartland-terrain"];
  const fullTerrainCell = (cell) => {
    const width = 32;
    const height = 32;
    const columns = terrain.width / width;
    const data = Buffer.alloc(width * height * 4);
    const originX = cell % columns * width;
    const originY = Math.floor(cell / columns) * height;
    for (let y = 0; y < height; y += 1) {
      const sourceStart = ((originY + y) * terrain.width + originX) * 4;
      terrain.data.copy(data, y * width * 4, sourceStart, sourceStart + width * 4);
    }
    return { data, width, height, channels: 4 };
  };
  const records = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.clusterProofs.records
    .filter(({ kitId }) => kitId === "worn-heartland");
  for (const cell of new Set(records.map(({ routeTarget }) => routeTarget.terrainCell))) {
    authoring.cellLayersByAtlas.set(`worn-heartland-terrain:${cell}`, [{
      id: `caller-forged/full-terrain/${cell}`,
      z: 0,
      kind: "crop",
      sourceId: `caller-forged/full-terrain/${cell}`,
      role: "route-or-patch",
      raw: fullTerrainCell(cell),
    }]);
  }
  await assert.rejects(
    productionPacker.buildRegionalR5KeyScene({ kit: "worn-heartland", authoring }),
    /trusted source-master|authoring.*provenance|source-master.*identity/i,
  );
});

test("Task12R R5 offline engine rejects cloned or caller-mutated source-master provenance", async () => {
  const authoring = await productionPacker.buildRegionalR5SourceMasters({
    sourceBuffers: regionalR5GuideBuffers(),
  });
  const build = (candidate = authoring) => productionPacker.buildRegionalR5KeyScene({
    kit: "worn-heartland",
    authoring: candidate,
  });
  const rejected = (promise, label) => assert.rejects(
    promise,
    /trusted source-master|authoring.*provenance|source-master.*identity/i,
    `${label}: must fail at the private source-master trust boundary`,
  );
  await rejected(build({ ...authoring }), "cloned authoring object");
  await rejected(build({
    ...authoring,
    fragments: new Map(authoring.fragments),
    patches: new Map(authoring.patches),
    cellLayersByAtlas: new Map(authoring.cellLayersByAtlas),
  }), "forged authoring maps");

  const authoringRawMastersDescriptor = Object.getOwnPropertyDescriptor(authoring, "rawMasters");
  Object.defineProperty(authoring, "rawMasters", {
    configurable: true,
    enumerable: true,
    get: () => authoringRawMastersDescriptor.value,
  });
  try {
    await rejected(build(), "authoring accessor wrapper");
  } finally {
    Object.defineProperty(authoring, "rawMasters", authoringRawMastersDescriptor);
  }

  const sampleFragment = authoring.fragments.entries().next().value;
  authoring.fragments.set("caller-forged/extra-fragment", sampleFragment[1]);
  try {
    await rejected(build(), "mutated map closure");
  } finally {
    authoring.fragments.delete("caller-forged/extra-fragment");
  }

  authoring.fragments.get = () => sampleFragment[1];
  try {
    await rejected(build(), "caller-overridden map method");
  } finally {
    delete authoring.fragments.get;
  }

  const cellKey = "worn-heartland-terrain:8";
  const layers = authoring.cellLayersByAtlas.get(cellKey);
  authoring.cellLayersByAtlas.set(cellKey, [...layers]);
  try {
    await rejected(build(), "cloned cell-layer array");
  } finally {
    authoring.cellLayersByAtlas.set(cellKey, layers);
  }

  layers.callerForged = true;
  try {
    await rejected(build(), "cell-layer array extra property");
  } finally {
    delete layers.callerForged;
  }

  const callerSymbol = Symbol("caller-forged");
  layers[callerSymbol] = true;
  try {
    await rejected(build(), "cell-layer array symbol property");
  } finally {
    delete layers[callerSymbol];
  }

  Object.setPrototypeOf(layers, Object.create(Array.prototype));
  try {
    await rejected(build(), "cell-layer array prototype");
  } finally {
    Object.setPrototypeOf(layers, Array.prototype);
  }

  const firstLayerDescriptor = Object.getOwnPropertyDescriptor(layers, "0");
  Object.defineProperty(layers, "0", {
    configurable: true,
    enumerable: true,
    get: () => firstLayerDescriptor.value,
  });
  try {
    await rejected(build(), "cell-layer array index accessor");
  } finally {
    Object.defineProperty(layers, "0", firstLayerDescriptor);
  }

  const layer = layers[0];
  const originalRole = layer.role;
  layer.role = `${originalRole}-caller-forged`;
  try {
    await rejected(build(), "caller-mutated semantic role");
  } finally {
    layer.role = originalRole;
  }

  const roleDescriptor = Object.getOwnPropertyDescriptor(layer, "role");
  Object.defineProperty(layer, "role", {
    configurable: true,
    enumerable: true,
    get: () => roleDescriptor.value,
  });
  try {
    await rejected(build(), "layer role accessor");
  } finally {
    Object.defineProperty(layer, "role", roleDescriptor);
  }

  const originalRaw = layer.raw;
  layer.raw = { ...layer.raw };
  try {
    await rejected(build(), "cloned raw reference");
  } finally {
    layer.raw = originalRaw;
  }

  const rawDataDescriptor = Object.getOwnPropertyDescriptor(layer.raw, "data");
  Object.defineProperty(layer.raw, "data", {
    configurable: true,
    enumerable: true,
    get: () => rawDataDescriptor.value,
  });
  try {
    await rejected(build(), "raw wrapper data accessor");
  } finally {
    Object.defineProperty(layer.raw, "data", rawDataDescriptor);
  }

  layer.raw.data.subarray = (...args) => Buffer.prototype.subarray.call(layer.raw.data, ...args);
  try {
    await rejected(build(), "raw Buffer subarray shadow");
  } finally {
    delete layer.raw.data.subarray;
  }

  const originalByte = layer.raw.data[0];
  const originalDigest = authoring.digests["worn-heartland-terrain"];
  layer.raw.data[0] ^= 0xff;
  authoring.digests["worn-heartland-terrain"] = createHash("sha256")
    .update(layer.raw.data)
    .digest("hex");
  try {
    await rejected(build(), "caller-mutated raw bytes with recomputed public digest");
  } finally {
    layer.raw.data[0] = originalByte;
    authoring.digests["worn-heartland-terrain"] = originalDigest;
  }

  const scene = await build();
  const measured = productionPacker.measureRegionalR5SceneConnectivity(scene.connectivityInputs);
  assert.equal(measured.clusterCount, 8, "restored genuine authoring remains usable");
  assert.equal(measured.receipts.length, 8);
  assert.equal(measured.metricErrors.length, 0);
  assert.equal(measured.authorityDeltas.length, 0, "truthful worn authority remains synchronized");
});

test("Task12R R5 offline engine accepts an untouched genuine source-master build", async () => {
  const scene = await productionPacker.buildRegionalR5KeyScene({
    kit: "worn-heartland",
    authoring: await regionalR5Authoring(),
  });
  const measured = productionPacker.measureRegionalR5SceneConnectivity(scene.connectivityInputs);
  assert.equal(measured.clusterCount, 8);
  assert.equal(measured.receipts.length, 8);
  assert.equal(measured.metricErrors.length, 0);
  assert.equal(measured.authorityDeltas.length, 0);
});

test("Task12R R5 offline engine measures actual yard alpha at the door and full south corridor", async () => {
  assert.equal(typeof productionPacker.measureRegionalR5YardAlpha, "function");
  const authoring = await regionalR5Authoring();
  const springYardReceipts = {
    0: {
      baseAlphaCoverage: 0.7569661458333333,
      borderTransparency: 0.8524709302325582,
      transparentHoleShare: 0.20840141612200436,
      rgbaSha256: "8e7acc774ac87667a889abacd1282712b7243aeeaec6bd01e5ef63664d352c6f",
    },
    1: {
      baseAlphaCoverage: 0.09264322916666666,
      borderTransparency: 1,
      transparentHoleShare: 0.8370548494217337,
      rgbaSha256: "2ad3c5267eecbb5e93ab20c2f59e0ff7c7ad067496af84e78cc729105b9726ae",
    },
    4: {
      baseAlphaCoverage: 0.12545572916666667,
      borderTransparency: 0.9836482558139534,
      transparentHoleShare: 0.7236087205966724,
      rgbaSha256: "76650f7f6d0662aee970fef98cace3f5f62134cf16048e2c66a84ecab87b72f5",
    },
  };
  for (const kit of REGIONAL_R5_AUTHORING_KITS) {
    const yard = authoring.rawMasters[`${kit}-home-yards`];
    if (kit === "spring-terraces") {
      assert.equal(createHash("sha256").update(yard.data).digest("hex"),
        "fc991cae4164c44961c1e4b201fbda8b5a8b0c785d9a45599d4529e608700b7b",
      "Spring yard exceptions apply only to the exact accepted V10 source master");
    }
    for (const cell of [0, 1, 4]) {
      const measurement = productionPacker.measureRegionalR5YardAlpha(yard, cell);
      assert.equal(measurement.doorOpaquePixels, 0, `${kit}/${cell} actual door rectangle must be empty`);
      assert.ok(measurement.southCorridorCoverage <= 0.08, `${kit}/${cell} actual south corridor must remain walkable`);
      if (kit === "spring-terraces") {
        const receipt = springYardReceipts[cell];
        const cellBytes = rawAtlasCellBytes({ data: yard.data, info: { width: yard.width } },
          cell, 5, 192, 160);
        assert.equal(createHash("sha256").update(cellBytes).digest("hex"), receipt.rgbaSha256,
          `Spring yard ${cell} must retain its exact accepted V10 cell bytes`);
        assert.deepEqual({
          baseAlphaCoverage: measurement.baseAlphaCoverage,
          borderTransparency: measurement.borderTransparency,
          transparentHoleShare: measurement.transparentHoleShare,
        }, {
          baseAlphaCoverage: receipt.baseAlphaCoverage,
          borderTransparency: receipt.borderTransparency,
          transparentHoleShare: receipt.transparentHoleShare,
        }, `Spring yard ${cell} material-depth and negative-space receipt`);
      } else {
        assert.ok(measurement.baseAlphaCoverage >= 0.08 && measurement.baseAlphaCoverage <= 0.55);
        assert.ok(measurement.borderTransparency >= 0.9);
        assert.ok(measurement.transparentHoleShare >= 0.25);
      }
    }
    const lifecycleErrors = productionPacker.validateRegionalR5YardLifecycle(yard);
    if (kit === "spring-terraces") {
      assert.deepEqual(lifecycleErrors, [
        "standing-a-coverage: 0.7570 outside 0.08-0.55",
        "standing-a-border: transparency 0.8525 < 0.90",
        "standing-a-negative-space: transparent share 0.2084 < 0.25 inside opaque bounds",
        "standing-a-three-sided-wrap: north/left/right all >= 0.65",
      ], "the source-bound V10 wet-yard exception may diverge only by its exact pinned broad foundation receipt");
    } else {
      assert.deepEqual(lifecycleErrors, [],
        `${kit} must pass the canonical R5 yard and lifecycle validators`);
    }
  }
});

test("Task12R R5 offline engine hands Worn to successor relations while retaining legacy and Dry authority", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5KeyScene, "function");
  assert.equal(typeof productionPacker.measureRegionalR5SceneConnectivity, "function");
  const authoring = await regionalR5Authoring();
  const receipts = [];
  const metricErrors = [];
  const authorityDeltas = [];
  for (const kit of REGIONAL_R5_AUTHORING_KITS.filter((candidate) => (
    candidate !== "dry-scrub" && candidate !== "worn-heartland"
  ))) {
    const scene = await productionPacker.buildRegionalR5KeyScene({ kit, authoring });
    const connectivity = productionPacker.measureRegionalR5SceneConnectivity(scene.connectivityInputs);
    assert.equal(connectivity.clusterCount, 8, `${kit} exposes every landmark cluster`);
    assert.equal(connectivity.supportCount, 16, `${kit} exposes two supports per cluster`);
    receipts.push(...connectivity.receipts);
    metricErrors.push(...connectivity.metricErrors);
    authorityDeltas.push(...connectivity.authorityDeltas);
  }
  assert.equal(receipts.length, 24,
    "Spring, Ash, and Neutral retain all 24 legacy crop-support cluster receipts");
  const authority = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.clusterProofs.records;
  assert.deepEqual(metricErrors, [], "all 24 retained actual-alpha clusters satisfy the canonical metric gate");
  assert.deepEqual(authorityDeltas, [], "all 24 retained actual-alpha receipts match synchronized authority");
  for (const receipt of receipts) {
    const expected = authority.find(({ clusterId }) => clusterId === receipt.clusterId);
    assert.ok(expected);
    assert.deepEqual(
      (({ kitId, clusterId, landmarkCell, supportA, supportB, routeTarget, metrics, canonicalSha256 }) => ({
        kitId, clusterId, landmarkCell, supportA, supportB, routeTarget, metrics, canonicalSha256,
      }))(receipt),
      expected,
      `${receipt.clusterId} route-only receipt must exactly match synchronized authority`,
    );
  }
  assert.ok(receipts.every(({ rawRgbaSha256 }) => (
    Object.keys(rawRgbaSha256).sort().join(",") === "base,landmark,route,scene,supportA,supportB"
      && Object.values(rawRgbaSha256).every((digest) => /^[a-f0-9]{64}$/.test(digest))
  )), "every pinned cluster record includes recomputed raw RGBA receipts");

  const wornScene = await productionPacker.buildRegionalR5KeyScene({
    kit: "worn-heartland",
    authoring,
  });
  const worn = productionPacker.measureRegionalR5SceneConnectivity(wornScene.connectivityInputs);
  assert.equal(worn.clusterCount, 8);
  assert.equal(worn.receipts.length, 8,
    "Worn contributes one measured successor foundation receipt per exact landmark instance");
  assert.deepEqual(worn.receipts.map(({ cell, variantId, foundationRole, touchesFoundation }) => ({
    cell, variantId, foundationRole, touchesFoundation,
  })), REGIONAL_R5_KEY_SCENES["worn-heartland"].landmarkLayers.map(({ cell, variantId }) => ({
    cell,
    variantId,
    foundationRole: cell <= 2
      ? "worn-oak-root-foundation"
      : cell <= 5
        ? "worn-worked-garden-foundation"
        : "worn-trampled-lane",
    touchesFoundation: true,
  })));
  assert.deepEqual(worn.errors, []);
  assert.equal(worn.successorReceipt.canonicalSha256,
    "aeff67bf2976ab04d7955658a19771ea2928b5ae284490889edb3012a6b3dd95");
  assert.ok(worn.successorReceipt.southGardenOpeningPx >= 32);
  assert.ok(worn.successorReceipt.eastGardenOpeningPx >= 32);
  assert.equal(worn.successorReceipt.laneConnected, true);
  assert.equal(worn.successorReceipt.laneTouchesYardSouthPort, true);
  assert.deepEqual(worn.successorReceipt.yardSouthPortCorridor,
    { left: 608, right: 640, top: 432, bottom: 480 });
  assert.equal(worn.successorReceipt.timberTouchesYardHistory, true);
  assert.equal(worn.successorReceipt.stoneTouchesYardHistory, true);
  assert.deepEqual(worn.actorWitnessReceipts.map(({ role, facing, relationshipValid }) => ({
    role, facing, relationshipValid,
  })), [
    { role: "route-entry", facing: "south", relationshipValid: true },
    { role: "defining-landmark", facing: "south", relationshipValid: true },
    { role: "shelter-door", facing: "south", relationshipValid: true },
  ]);

  const dryRoute = await productionPacker.measureRegionalR5DryRouteClearance({ authoring });
  assert.deepEqual({
    routeTileCount: dryRoute.routeTileCount,
    routeTilesSha256: dryRoute.routeTilesSha256,
    salientObstructionPixels: dryRoute.salientObstructionPixels,
    windbreakCorridorOverlapPixels: dryRoute.windbreakCorridorOverlapPixels,
    sceneRgbaSha256: dryRoute.sceneRgbaSha256,
  }, {
    routeTileCount: 28,
    routeTilesSha256: "9a75dbe0fcda3e41b22a58f540a320e29e9849a99df8c861f6cd91fd52eaf542",
    salientObstructionPixels: 0,
    windbreakCorridorOverlapPixels: 0,
    sceneRgbaSha256: "ea70e6dcd7f9f5e1a47d00f537b8b732d83d1033ac3591b6c61dded1377d1673",
  }, "Dry replaces obsolete crop-support receipts with its exact final-scene route proof");
});

test("Task12R R5 offline engine separates public provenance rejection from a real disconnected-support graph diagnostic", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit: "ash-waste", authoring });
  assert.equal(scene.completeProductionPreview, false);
  assert.deepEqual(scene.omittedProductionLayers, ["home", "human-witnesses"],
    "Task 3 proof builder must not pretend Task 4 home/human composition is already present");
  const hostile = {
    ...scene.connectivityInputs,
    clusters: scene.connectivityInputs.clusters.map((cluster, index) => index === 0 ? {
      ...cluster,
      supportLayers: cluster.supportLayers.map((layer, supportIndex) => supportIndex === 0
        ? { ...layer, data: Buffer.alloc(layer.data.length) }
        : layer),
    } : cluster),
  };
  assert.match(
    productionPacker.measureRegionalR5SceneConnectivity(hostile).errors.join("\n"),
    /trusted builder|identity|provenance|source alpha/i,
    "publicly mutated connectivity must fail at the identity boundary",
  );

  const trusted = scene.connectivityInputs.clusters[0];
  const disconnectedSupport = {
    data: Buffer.alloc(trusted.width * trusted.height * 4),
    width: trusted.width,
    height: trusted.height,
    channels: 4,
  };
  productionPacker.placeRegionalR5RawLayer(
    disconnectedSupport,
    trusted.supportLayers[0],
    300,
    0,
  );
  const opaquePixels = (raw) => {
    let total = 0;
    for (let offset = 3; offset < raw.data.length; offset += 4) total += raw.data[offset] === 255;
    return total;
  };
  assert.equal(
    opaquePixels(disconnectedSupport),
    opaquePixels(trusted.supportLayers[0]),
    "the disconnected layer retains every real support pixel",
  );
  const graphErrors = validateConstructedClusterMetrics({
    width: trusted.width,
    height: trusted.height,
    baseLayer: trusted.baseLayer,
    scene: trusted.scene,
    routeLayer: trusted.routeLayer,
    landmarkLayer: trusted.landmarkLayer,
    supportLayers: [disconnectedSupport, trusted.supportLayers[1]],
  }, trusted.record.clusterId);
  assert.match(
    graphErrors.join("\n"),
    /graph|joins|support anatomy|disconnected/i,
    "canonical metric seam must diagnose the displaced real support",
  );
});

test("Task12R R5 offline engine isolates the ash service chain as one exact 3475px actual-alpha component", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit: "ash-waste", authoring });
  const service = scene.connectivityInputs.clusters.find(({ record }) => record.routeTarget.kind === "ash-service-chain");
  assert.ok(service);
  const components = productionPacker.regionalR5AlphaComponentSizes(service.routeLayer);
  assert.deepEqual(components, [3475]);
  assert.deepEqual(service.routeSourceRoles, ["route-or-patch", "service-route", "literal-service-slab"]);
});

test("Task12R R5 offline engine rejects generic-ground provenance even when its full tile touches the cluster", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit: "worn-heartland", authoring });
  const hostile = {
    ...scene.connectivityInputs,
    clusters: scene.connectivityInputs.clusters.map((cluster, index) => index === 0
      ? { ...cluster, routeSourceRoles: [...cluster.routeSourceRoles, "terrain-material"] }
      : cluster),
  };
  assert.match(productionPacker.measureRegionalR5SceneConnectivity(hostile).errors.join("\n"), /generic-ground|route source role/i);
});

test("Task12R R5 offline engine fails closed on non-builder connectivity identity and self-attestation", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit: "worn-heartland", authoring });
  const input = scene.connectivityInputs;
  const rejected = (hostile, label) => {
    const result = productionPacker.measureRegionalR5SceneConnectivity(hostile);
    assert.equal(result.receipts.length, 0, `${label}: untrusted input cannot produce receipts`);
    assert.match(
      result.errors.join("\n"),
      /exact 8-record|trusted builder|identity|provenance/i,
      `${label}: deterministic fail-closed diagnostic`,
    );
  };

  rejected({ ...input, clusters: [] }, "empty closure");
  rejected({ ...input, clusters: [...input.clusters] }, "cloned input");

  const first = input.clusters[0];
  const originalRecord = first.record;
  first.record = structuredClone(first.record);
  rejected(input, "caller-forged record");
  first.record = originalRecord;

  const originalRoles = first.routeSourceRoles;
  first.routeSourceRoles = [...first.routeSourceRoles];
  rejected(input, "caller-forged role list");
  first.routeSourceRoles = originalRoles;

  const originalByte = first.routeLayer.data[0];
  const originalHash = first.routeRgbaSha256;
  first.routeLayer.data[0] ^= 0xff;
  first.routeRgbaSha256 = createHash("sha256").update(first.routeLayer.data).digest("hex");
  rejected(input, "caller self-attested RGBA hash");
  first.routeLayer.data[0] = originalByte;
  first.routeRgbaSha256 = originalHash;

  const restored = productionPacker.measureRegionalR5SceneConnectivity(input);
  assert.equal(restored.clusterCount, 8, "restored exact builder input remains measurable");
  assert.equal(restored.receipts.length, 8);
});

test("Task12R R5 offline engine rejects downstream container and method-shadow provenance hostiles", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({ kit: "worn-heartland", authoring });
  const input = scene.connectivityInputs;
  const clusters = input.clusters;
  const first = clusters[0];
  const rejected = (label) => {
    const result = productionPacker.measureRegionalR5SceneConnectivity(input);
    assert.equal(result.receipts.length, 0, `${label}: hostile input cannot produce receipts`);
    assert.match(result.errors.join("\n"), /exact 8-record|trusted builder|identity|provenance/i);
  };

  const inputSymbol = Symbol("caller-forged-input");
  input[inputSymbol] = true;
  try {
    rejected("input symbol");
  } finally {
    delete input[inputSymbol];
  }

  Object.defineProperty(clusters, Symbol.iterator, {
    configurable: true,
    value: function* emptyClusterIterator() {},
  });
  try {
    rejected("empty cluster iterator");
  } finally {
    delete clusters[Symbol.iterator];
  }

  const clusterIndexDescriptor = Object.getOwnPropertyDescriptor(clusters, "0");
  Object.defineProperty(clusters, "0", {
    configurable: true,
    enumerable: true,
    get: () => clusterIndexDescriptor.value,
  });
  try {
    rejected("cluster index accessor");
  } finally {
    Object.defineProperty(clusters, "0", clusterIndexDescriptor);
  }

  Object.setPrototypeOf(clusters, Object.create(Array.prototype));
  try {
    rejected("cluster array prototype");
  } finally {
    Object.setPrototypeOf(clusters, Array.prototype);
  }

  const clusterSymbol = Symbol("caller-forged-cluster");
  first[clusterSymbol] = true;
  try {
    rejected("cluster symbol");
  } finally {
    delete first[clusterSymbol];
  }

  Object.setPrototypeOf(first, Object.create(Object.prototype));
  try {
    rejected("cluster object prototype");
  } finally {
    Object.setPrototypeOf(first, Object.prototype);
  }

  const roles = first.routeSourceRoles;
  roles.push("terrain-material");
  roles.map = function hideTerrainMaterial(callback) {
    return Array.prototype.map.call(Array.prototype.slice.call(this, 0, -1), callback);
  };
  try {
    rejected("route role map shadow");
  } finally {
    delete roles.map;
    roles.pop();
  }

  const supports = first.supportLayers;
  const originalSupport = supports[0];
  supports[0] = { ...originalSupport };
  supports.some = () => false;
  try {
    rejected("support some shadow with cloned wrapper");
  } finally {
    delete supports.some;
    supports[0] = originalSupport;
  }

  first.routeLayer.data.subarray = (...args) => Buffer.prototype.subarray.call(
    first.routeLayer.data,
    ...args,
  );
  try {
    rejected("route Buffer subarray shadow");
  } finally {
    delete first.routeLayer.data.subarray;
  }

  const restored = productionPacker.measureRegionalR5SceneConnectivity(input);
  assert.equal(restored.clusterCount, 8);
  assert.equal(restored.supportCount, 16);
  assert.equal(restored.receipts.length, 8);
  assert.deepEqual(restored.errors, []);
});

test("Task12R R5 offline engine call graph excludes R4 rasterizers and squeeze or flip helpers", async () => {
  const source = await readFile(PACKER_SOURCE, "utf8");
  const start = source.indexOf("REGIONAL_R5_OFFLINE_ENGINE_START");
  const end = source.indexOf("REGIONAL_R5_OFFLINE_ENGINE_END");
  assert.ok(start >= 0 && end > start, "R5 offline engine must have an inspectable closed source boundary");
  const engine = source.slice(start, end);
  for (const forbidden of [
    "authorRegionalR4TerrainAtlas",
    "authorRegionalR4LandmarkAtlas",
    "authorRegionalR4YardAtlas",
    "regionalR4CompositionScene",
    "normalizedGuideSprite",
    "transformGuideSprite",
  ]) assert.equal(engine.includes(forbidden), false, `R5 call graph may not name ${forbidden}`);
  assert.equal(engine.includes(".resize("), false, "R5 engine may not resize guide fragments");
  assert.equal(engine.includes(".flip("), false);
  assert.equal(engine.includes(".flop("), false);

  const sourceFile = ts.createSourceFile("packer.mjs", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const functions = new Map();
  const collectFunctions = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node);
    ts.forEachChild(node, collectFunctions);
  };
  collectFunctions(sourceFile);
  const reached = new Set();
  const calls = [];
  const visitFunction = (name) => {
    if (reached.has(name) || !functions.has(name)) return;
    reached.add(name);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const called = ts.isIdentifier(expression) ? expression.text
          : ts.isPropertyAccessExpression(expression) ? expression.name.text : null;
        if (called) {
          calls.push({ owner: name, called });
          if (ts.isIdentifier(expression)) visitFunction(called);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(functions.get(name).body);
  };
  for (const entry of ["buildRegionalR5SourceMasters", "buildRegionalR5KeyScene"]) visitFunction(entry);
  const forbiddenCalls = new Set([
    "authorRegionalR4TerrainAtlas", "authorRegionalR4LandmarkAtlas", "authorRegionalR4YardAtlas",
    "regionalR4CompositionScene", "normalizedGuideSprite", "transformGuideSprite",
    "resize", "flip", "flop", "rotate",
  ]);
  assert.deepEqual(calls.filter(({ called }) => forbiddenCalls.has(called)), [],
    `recursive R5 call closure reached a forbidden operation: ${JSON.stringify(calls)}`);
});

test("Task12R R5 offline engine validates all proof artifacts before the first filesystem write", async () => {
  assert.equal(typeof productionPacker.publishRegionalR5ProofArtifactsAtomically, "function");
  const operations = [];
  await assert.rejects(
    productionPacker.publishRegionalR5ProofArtifactsAtomically({
      artifacts: { "nested/forbidden.png": Buffer.from("bytes") },
      destinationRoot: "/proof-only",
      fileOperations: new Proxy({}, {
        get: (_target, name) => async () => { operations.push(String(name)); },
      }),
    }),
    /basename|validate|proof/i,
  );
  assert.deepEqual(operations, [], "invalid proof inventory must fail before mkdir/write/rename");
});

test("Task12R R5 offline engine snapshots proof Buffer bytes before the first await", async () => {
  const artifact = Buffer.from("original-proof-bytes");
  const writes = [];
  const files = new Map();
  await productionPacker.publishRegionalR5ProofArtifactsAtomically({
    artifacts: { "proof.png": artifact },
    destinationRoot: "/proof-only",
    fileOperations: {
      mkdir: async () => { artifact.fill(0); },
      readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      writeFile: async (filename, bytes) => {
        writes.push(Buffer.from(bytes));
        files.set(filename, Buffer.from(bytes));
      },
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
      },
      rm: async (filename) => files.delete(filename),
    },
  });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].toString(), "original-proof-bytes");
  assert.equal(files.get("/proof-only/proof.png").toString(), "original-proof-bytes");
});

test("Task12R R5 offline engine rejects empty and dot proof basenames before filesystem I/O", async () => {
  for (const name of ["", ".", ".."]) {
    const operations = [];
    await assert.rejects(
      productionPacker.publishRegionalR5ProofArtifactsAtomically({
        artifacts: { [name]: Buffer.from("bytes") },
        destinationRoot: "/proof-only",
        fileOperations: Object.fromEntries(
          ["mkdir", "readFile", "writeFile", "rename", "rm"].map((operation) => [
            operation,
            async () => { operations.push(operation); },
          ])),
      }),
      /basename|empty|dot|proof/i,
      `${JSON.stringify(name)} must be rejected`,
    );
    assert.deepEqual(operations, [], `${JSON.stringify(name)} fails before mkdir/write/rename`);
  }
});

test("Task12R R5 offline engine atomically rolls back a fault injected after the first proof rename", async () => {
  const files = new Map([
    ["/proof-only/a.png", Buffer.from("old-a")],
    ["/proof-only/b.png", Buffer.from("old-b")],
  ]);
  let renames = 0;
  const fileOperations = {
    mkdir: async () => {},
    readFile: async (filename) => {
      if (!files.has(filename)) Object.assign(new Error("missing"), { code: "ENOENT" });
      if (!files.has(filename)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return Buffer.from(files.get(filename));
    },
    writeFile: async (filename, bytes) => { files.set(filename, Buffer.from(bytes)); },
    rename: async (from, to) => {
      renames += 1;
      if (renames === 2) throw new Error("injected rename fault");
      files.set(to, files.get(from));
      files.delete(from);
    },
    rm: async (filename) => { files.delete(filename); },
  };
  await assert.rejects(
    productionPacker.publishRegionalR5ProofArtifactsAtomically({
      artifacts: { "b.png": Buffer.from("new-b"), "a.png": Buffer.from("new-a") },
      destinationRoot: "/proof-only",
      fileOperations,
      temporaryTag: "fault",
    }),
    /injected rename fault/,
  );
  assert.equal(files.get("/proof-only/a.png").toString(), "old-a");
  assert.equal(files.get("/proof-only/b.png").toString(), "old-b");
  assert.equal([...files.keys()].some((name) => name.includes(".tmp-")), false);
});

test("Task12R R5 offline engine stages and commits proof basenames in code-unit lexical order", async () => {
  const operations = [];
  const files = new Map();
  await productionPacker.publishRegionalR5ProofArtifactsAtomically({
    artifacts: {
      "a.png": Buffer.from("a"),
      "_.png": Buffer.from("underscore"),
      "Z.png": Buffer.from("uppercase-z"),
      "0.png": Buffer.from("zero"),
    },
    destinationRoot: "/proof-only",
    fileOperations: {
      mkdir: async () => operations.push("mkdir"),
      readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
      writeFile: async (filename, bytes) => { operations.push(`write:${path.basename(filename).split(".tmp-")[0]}`); files.set(filename, bytes); },
      rename: async (from, to) => { operations.push(`rename:${path.basename(to)}`); files.set(to, files.get(from)); files.delete(from); },
      rm: async (filename) => files.delete(filename),
    },
  });
  assert.deepEqual(operations, [
    "mkdir", "write:0.png", "write:Z.png", "write:_.png", "write:a.png",
    "rename:0.png", "rename:Z.png", "rename:_.png", "rename:a.png",
  ]);
});

test("Task12R R5 offline engine removes a temp after a partial write throws", async () => {
  const files = new Map();
  await assert.rejects(
    productionPacker.publishRegionalR5ProofArtifactsAtomically({
      artifacts: { "partial.png": Buffer.from("complete-bytes") },
      destinationRoot: "/proof-only",
      fileOperations: {
        mkdir: async () => {},
        readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
        writeFile: async (filename, bytes) => {
          files.set(filename, Buffer.from(bytes.subarray(0, 3)));
          throw new Error("partial-write-fault");
        },
        rename: async () => { throw new Error("rename must not run"); },
        rm: async (filename) => files.delete(filename),
      },
      temporaryTag: "partial-write",
    }),
    /partial-write-fault/,
  );
  assert.equal([...files.keys()].some((filename) => filename.includes(".tmp-")), false);
});

test("Task12R R5 offline engine surfaces temp-cleanup failure after a partial write throws", async () => {
  const files = new Map();
  await assert.rejects(
    productionPacker.publishRegionalR5ProofArtifactsAtomically({
      artifacts: { "partial.png": Buffer.from("complete-bytes") },
      destinationRoot: "/proof-only",
      fileOperations: {
        mkdir: async () => {},
        readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; },
        writeFile: async (filename, bytes) => {
          files.set(filename, Buffer.from(bytes.subarray(0, 3)));
          throw new Error("partial-write-fault");
        },
        rename: async () => { throw new Error("rename must not run"); },
        rm: async () => { throw new Error("temp-cleanup-fault"); },
      },
      temporaryTag: "partial-cleanup",
    }),
    (error) => error instanceof AggregateError
      && error.errors.some(({ message }) => message === "partial-write-fault")
      && error.errors.some(({ message }) => message === "temp-cleanup-fault"),
  );
});

test("Task12R R5 offline engine rolls back a rename that succeeds and then throws, and surfaces rollback failure", async () => {
  const run = async ({ failRollback }) => {
    const files = new Map([
      ["/proof-only/a.png", Buffer.from("old-a")],
      ["/proof-only/b.png", Buffer.from("old-b")],
    ]);
    let primaryThrown = false;
    const fileOperations = {
      mkdir: async () => {},
      readFile: async (filename) => {
        if (files.has(filename)) return Buffer.from(files.get(filename));
        const error = new Error("missing"); error.code = "ENOENT"; throw error;
      },
      writeFile: async (filename, bytes) => files.set(filename, Buffer.from(bytes)),
      rename: async (from, to) => {
        files.set(to, files.get(from));
        files.delete(from);
        if (!primaryThrown && to === "/proof-only/b.png") {
          primaryThrown = true;
          throw new Error("success-then-throw");
        }
        if (failRollback && to === "/proof-only/a.png" && from.includes("rollback")) {
          throw new Error("rollback-fault");
        }
      },
      rm: async (filename) => files.delete(filename),
    };
    const promise = productionPacker.publishRegionalR5ProofArtifactsAtomically({
      artifacts: { "a.png": Buffer.from("new-a"), "b.png": Buffer.from("new-b") },
      destinationRoot: "/proof-only",
      fileOperations,
      temporaryTag: "success-then-throw",
    });
    return { files, promise };
  };
  const successfulRollback = await run({ failRollback: false });
  await assert.rejects(successfulRollback.promise, /success-then-throw/);
  assert.equal(successfulRollback.files.get("/proof-only/a.png").toString(), "old-a");
  assert.equal(successfulRollback.files.get("/proof-only/b.png").toString(), "old-b");

  const failedRollback = await run({ failRollback: true });
  await assert.rejects(failedRollback.promise, AggregateError);
});

const regionalR5PublicationSnapshot = async () => {
  const roots = [FROZEN_ASSET_ROOT, NATIVE_ASSET_ROOT, EVIDENCE_ROOT];
  const entries = [];
  const walk = async (root, directory = root) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) await walk(root, url);
      else {
        const relative = fileURLToPath(url).slice(fileURLToPath(root).length);
        entries.push(`${fileURLToPath(root)}:${relative}:${createHash("sha256").update(await readFile(url)).digest("hex")}`);
      }
    }
  };
  for (const root of roots) await walk(root);
  return createHash("sha256").update(entries.sort().join("\n")).digest("hex");
};

test("Task12R R5 offline engine proof-only CLIs emit hashes to stdout and publish no files", async () => {
  const source = await readFile(PACKER_SOURCE, "utf8");
  assert.match(source, /--proof-regional-r5-source-masters/);
  assert.match(source, /--proof-regional-r5-key-scene/);
  const forbiddenInProofBranch = /proofRegionalR5[\s\S]{0,2400}(?:writeFile|rename|mkdir)\s*\(/;
  assert.doesNotMatch(source, forbiddenInProofBranch, "proof-only CLI branches must never publish bytes");
  const before = await regionalR5PublicationSnapshot();
  for (const argument of [
    "--proof-regional-r5-source-masters",
    "--proof-regional-r5-key-scene=ash-waste",
  ]) {
    const { stdout, stderr } = await execFileAsync(process.execPath, [fileURLToPath(PACKER_SOURCE), argument], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      maxBuffer: 16 * 1024 * 1024,
    });
    assert.equal(stderr, "");
    const report = JSON.parse(stdout);
    assert.equal(report.proofOnly, true);
    assert.equal(report.published, false);
    assert.ok(Object.values(report.digests).every((digest) => /^[a-f0-9]{64}$/.test(digest)));
    if (argument.includes("key-scene")) {
      assert.equal(report.passed, true, "proof report confirms synchronized ash authority");
      assert.deepEqual(report.diagnostics, []);
      assert.deepEqual(report.authorityDeltas, []);
    }
  }
  for (const argumentsList of [
    ["--proof-regional-r5-key-scene"],
    ["--proof-regional-r5-source-masters", "--check"],
    ["--proof-regional-r5-key-scene=ash-waste", "--author-regional-r4-proofs"],
    ["--proof-regional-r5-source-masters", "--proof-regional-r5-key-scene=ash-waste"],
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [fileURLToPath(PACKER_SOURCE), ...argumentsList], {
        cwd: fileURLToPath(new URL("../../", import.meta.url)),
        maxBuffer: 16 * 1024 * 1024,
      }),
      /proof|mutually exclusive|requires/i,
    );
  }
  assert.equal(await regionalR5PublicationSnapshot(), before, "proof-only CLIs leave runtime/native/evidence inventories byte-identical");
});

test("Task12R R5 complete proof components reconstruct exact HomeActor and coherent four-layer south human without held art", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5CompleteProofComponents, "function");
  const humanAuthority = REGIONAL_R5_MECHANICS_BINDINGS.productionHuman;
  for (const kit of ["ash-waste", "neutral-temperate", "spring-terraces"]) {
    const components = await productionPacker.buildRegionalR5CompleteProofComponents({
      kit,
      sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
    });
    const authorityScene = REGIONAL_R5_KEY_SCENES[kit];
    const homeProof = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
      .find(({ kitId }) => kitId === kit);
    assert.deepEqual(components.homeActor.placement, authorityScene.homeLayer);
    assert.deepEqual(components.homeActor.yardPlacement, authorityScene.yardLayers[0]);
    assert.deepEqual(components.homeActor.origin, { x: 32, y: 16 });
    assert.deepEqual({
      x: components.homeActor.placement.x - components.homeActor.yardPlacement.x,
      y: components.homeActor.placement.y - components.homeActor.yardPlacement.y,
    }, components.homeActor.origin, `${kit} HomeActor is actually inside its yard`);
    assert.deepEqual({
      width: components.homeActor.proof.width,
      height: components.homeActor.proof.height,
      channels: components.homeActor.proof.channels,
    }, { width: 192, height: 160, channels: 4 });
    assert.equal(
      createHash("sha256").update(components.homeActor.proof.data).digest("hex"),
      homeProof.homeActorRgbaSha256,
    );
    assert.deepEqual(components.humanWitnesses.map(({ placement }) => placement), authorityScene.humanLayers);
    assert.equal(components.humanWitnesses.length, 3);
    for (let left = 0; left < components.humanWitnesses.length; left += 1) {
      for (let right = left + 1; right < components.humanWitnesses.length; right += 1) {
        const a = components.humanWitnesses[left].placement;
        const b = components.humanWitnesses[right].placement;
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width
          && a.y < b.y + b.height && b.y < a.y + a.height;
        assert.equal(overlap, false, `${kit} canonical human boxes ${left}/${right} must not overlap`);
      }
    }
    assert.deepEqual(components.humanWitnesses.map(({ placement }) => placement.role), [
      "route-entry",
      "defining-landmark",
      "shelter-door",
    ]);
    assert.deepEqual(components.productionHuman.contract, {
      assetId: "core-human-body-rigs:1",
      rig: "human-a",
      facing: "south",
      action: "idle",
      frameIndex: 1,
      expression: "neutral",
      clothing: "core-human-clothing-00:1",
      feet: { x: 24, y: 61 },
    });
    assert.deepEqual(
      components.productionHuman.sourceLayers.map(({ atlasId, atlasSha256, cellIndex }) => ({
        atlasId,
        atlasSha256,
        cellIndex,
      })),
      humanAuthority.layers.map(({ atlasId, atlasSha256, cellIndex }) => ({
        atlasId,
        atlasSha256,
        cellIndex,
      })),
    );
    assert.equal(components.productionHuman.sourceLayers.some(({ atlasId }) => /held/i.test(atlasId)), false);
    assert.deepEqual({
      width: components.productionHuman.patch.width,
      height: components.productionHuman.patch.height,
      channels: components.productionHuman.patch.channels,
    }, { width: 48, height: 64, channels: 4 });
    assert.equal(
      createHash("sha256").update(components.productionHuman.patch.data).digest("hex"),
      humanAuthority.canonicalPatchSha256,
    );
    for (let offset = 3; offset < components.productionHuman.patch.data.length; offset += 4) {
      assert.ok([0, 255].includes(components.productionHuman.patch.data[offset]), "human patch alpha stays binary");
    }
  }
});

test("Task12R R5 complete proof components fail closed on kit, source shape, PNG hash, and decoded dimensions", async () => {
  const valid = await regionalR5CompleteProofSourceBuffers("ash-waste");
  await assert.rejects(
    productionPacker.buildRegionalR5CompleteProofComponents({
      kit: "worn-heartland",
      sourceBuffers: valid,
    }),
    /ash-waste|neutral-temperate|complete proof/i,
  );
  for (const invalid of [
    { ...valid, extra: Buffer.from("forbidden") },
    Object.fromEntries(Object.entries(valid).filter(([key]) => key !== "humanFace")),
  ]) {
    await assert.rejects(
      productionPacker.buildRegionalR5CompleteProofComponents({
        kit: "ash-waste",
        sourceBuffers: invalid,
      }),
      /exact|source.*properties|source.*shape/i,
    );
  }
  const tampered = { ...valid, humanHair: Buffer.from(valid.humanHair) };
  tampered.humanHair[64] ^= 0xff;
  await assert.rejects(
    productionPacker.buildRegionalR5CompleteProofComponents({
      kit: "ash-waste",
      sourceBuffers: tampered,
    }),
    /humanHair|hash drift/i,
  );
  const decodeSource = async (bytes, descriptor) => {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return descriptor.slot === "humanBody"
      ? { data: data.subarray(0, data.length - 4), width: info.width - 1, height: info.height, channels: 4 }
      : { data, width: info.width, height: info.height, channels: info.channels };
  };
  await assert.rejects(
    productionPacker.buildRegionalR5CompleteProofComponents({
      kit: "ash-waste",
      sourceBuffers: valid,
      decodeSource,
    }),
    /humanBody.*(?:dimensions|width|height)|(?:dimensions|width|height).*humanBody/i,
  );
});

test("Task12R R5 complete proof scene passes canonical wallpaper, every-landmark, and neutral actual-alpha gates", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5CompleteProofScene, "function");
  const authoring = await regionalR5Authoring();
  for (const kit of ["ash-waste", "neutral-temperate"]) {
    const incomplete = await productionPacker.buildRegionalR5KeyScene({ kit, authoring });
    assert.equal(incomplete.completeProductionPreview, false);
    assert.deepEqual(incomplete.omittedProductionLayers, ["home", "human-witnesses"]);
    const landmarkErrors = Array.from({ length: 8 }, (_unused, cell) => {
      const atlas = authoring.rawMasters[`${kit}-landmarks`];
      const data = Buffer.alloc(128 * 128 * 4);
      const left = cell % 4 * 128;
      const top = Math.floor(cell / 4) * 128;
      for (let y = 0; y < 128; y += 1) {
        const start = ((top + y) * atlas.width + left) * 4;
        atlas.data.copy(data, y * 128 * 4, start, start + 128 * 4);
      }
      return validateLandmarkMaterialDepth(
        { data, width: 128, height: 128, channels: 4 },
        `${kit}/landmark-${cell}`,
      );
    });
    assert.deepEqual(landmarkErrors, Array.from({ length: 8 }, () => []), `${kit} passes all 8/8 landmark gates`);
    const connectivity = productionPacker.measureRegionalR5SceneConnectivity(incomplete.connectivityInputs);
    assert.equal(connectivity.clusterCount, 8);
    assert.equal(connectivity.supportCount, 16);
    assert.equal(connectivity.receipts.length, 8);
    assert.deepEqual(connectivity.metricErrors, []);
    assert.deepEqual(connectivity.authorityDeltas, []);
    assert.deepEqual(connectivity.errors, []);
    const complete = await productionPacker.buildRegionalR5CompleteProofScene({
      kit,
      authoring,
      sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
    });
    assert.equal(complete.completeProductionPreview, false);
    assert.deepEqual(complete.omittedProductionLayers,
      [
        "runtime-home-depth-mask",
        "runtime-human-contact-shadows",
        "runtime-shelter-door-presentation-anchor",
      ]);
    assert.equal(complete.completeCompositionOracle, true);
    assert.deepEqual(validateComposedPixelAutocorrelation(complete.raw, { kit }), [], `${kit} wallpaper oracle`);
    if (kit === "neutral-temperate") {
      assert.deepEqual(connectivity.receipts.map(({ kitId }) => kitId), Array(8).fill("neutral-temperate"));
    }
  }
});

test("Task12R R5 semantic scenes contain connected pond, lane, boundary, grove, and nuclear-industrial pixels", async () => {
  const rgba = (hex) => [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ].join(",");
  const components = (raw, accepted) => {
    const selected = new Set();
    for (let y = 0; y < raw.height; y += 1) for (let x = 0; x < raw.width; x += 1) {
      const offset = (y * raw.width + x) * 4;
      if (accepted.has([...raw.data.subarray(offset, offset + 4)].join(","))) selected.add(`${x},${y}`);
    }
    const output = [];
    while (selected.size > 0) {
      const seed = selected.values().next().value;
      selected.delete(seed);
      const queue = [seed];
      const points = [];
      while (queue.length > 0) {
        const key = queue.pop();
        const [x, y] = key.split(",").map(Number);
        points.push([x, y]);
        for (const neighbour of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
          if (selected.delete(neighbour)) queue.push(neighbour);
        }
      }
      output.push(points);
    }
    return output.sort((left, right) => right.length - left.length);
  };
  const bounds = (points) => {
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return { x: Math.min(...xs), y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs) + 1,
      height: Math.max(...ys) - Math.min(...ys) + 1 };
  };
  const neutralPalette = REGIONAL_R5_PALETTES.kits["neutral-temperate"];
  for (const token of ["pond-deep", "pond-light", "stone-shadow", "hedge-deep"]) {
    assert.match(neutralPalette[token] ?? "", /^#[a-f0-9]{6}$/i, `neutral palette requires ${token}`);
  }
  const authoring = await regionalR5Authoring();
  const neutral = await productionPacker.buildRegionalR5KeyScene({ kit: "neutral-temperate", authoring });
  assert.deepEqual(
    productionPacker.measureRegionalR5SceneConnectivity(neutral.connectivityInputs).metricErrors,
    [],
    "neutral visual repairs must preserve every landmark/support/route graph independently of frozen receipts",
  );
  const pond = components(neutral.raw, new Set([rgba(neutralPalette["pond-deep"]), rgba(neutralPalette["pond-light"])]))[0];
  assert.ok(pond?.length > 0, "neutral scene requires actual water pixels");
  const pondBounds = bounds(pond);
  assert.ok(pondBounds.width >= 96 && pondBounds.height >= 64, `pond must span >=96x64, got ${JSON.stringify(pondBounds)}`);
  const lane = components(neutral.raw, new Set([rgba(neutralPalette["pale-lane"])]))[0];
  const laneBounds = bounds(lane);
  assert.ok(laneBounds.width >= 320 && laneBounds.height >= 400 && laneBounds.y === 0,
    `continuous entry-to-terminus lane required, got ${JSON.stringify(laneBounds)}`);
  const wallPatch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === "neutral:scene-stone-wall");
  assert.ok(wallPatch, "neutral scene requires literal low-stone boundary");
  assert.ok(wallPatch.width >= 288 && wallPatch.height >= 24);
  const wallRows = wallPatch.rows;
  assert.ok(wallRows.every((row) => row.slice(144, 176).split("").every((index) => index === "0")),
    "stone boundary keeps the exact 32px route gate transparent");
  const grovePatch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === "neutral:scene-grove-understory");
  assert.ok(grovePatch && grovePatch.width >= 192 && grovePatch.height >= 80, "joined grove requires scene-scale rooted canopy/understory");
  const groveRaw = productionPacker.realizeRegionalR5IndexedPatch(grovePatch);
  assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(groveRaw), [
    groveRaw.data.filter((_value, offset) => offset % 4 === 3 && groveRaw.data[offset] === 255).length,
  ], "scene grove canopy and understory must be one joined alpha component");
  const timberIndex = Object.entries(grovePatch.palette).find(([, token]) => token === "meadow-timber")?.[0];
  const timberPoints = [];
  grovePatch.rows.forEach((row, y) => [...row].forEach((index, x) => {
    if (index === timberIndex) timberPoints.push([x, y]);
  }));
  assert.ok(timberPoints.length >= 150, "joined grove needs visible trunk/root anatomy, not floating canopy stamps");
  assert.ok(new Set(timberPoints.map(([x]) => x)).size >= 18, "joined grove trunks and roots must vary across the grove");
  assert.ok(Math.max(...timberPoints.map(([, y]) => y)) - Math.min(...timberPoints.map(([, y]) => y)) >= 42,
    "joined grove timber must visibly root the high canopy into the understory");
  const byId = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const pondFrame = byId.get("neutral:landmark-pond-frame-grove");
  const occupiedIn = (patch, x, y, width, height) => {
    let occupied = 0;
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      occupied += patch.rows[yy]?.[xx] && patch.rows[yy][xx] !== patch.transparentIndex ? 1 : 0;
    }
    return occupied;
  };
  assert.ok(occupiedIn(pondFrame, 88, 16, 32, 32) <= 256,
    "pond-frame grove must preserve the exact route window instead of covering it with a giant canopy");
  assert.ok(occupiedIn(pondFrame, 56, 0, 32, 25) <= 234,
    "pond-frame grove must preserve support visibility instead of repeating an oval crown across it");
  const pondPatch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === "neutral:scene-pond-foundation");
  const pondRaw = productionPacker.realizeRegionalR5IndexedPatch(pondPatch);
  const pondAlpha = pondRaw.data.filter((_value, offset) => offset % 4 === 3 && pondRaw.data[offset] === 255).length;
  assert.ok(pondAlpha / (pondRaw.width * pondRaw.height) <= 0.9, "pond foundation keeps irregular transparent corners");
  assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(pondRaw), [pondAlpha]);

  const alphaAt = (patch, x, y) => x >= 0 && y >= 0 && x < patch.width && y < patch.height
    && patch.rows[y][x] !== patch.transparentIndex;
  const morphology = (patch) => {
    let area = 0;
    let perimeter = 0;
    const leftEdges = [];
    const rightEdges = [];
    for (let y = 0; y < patch.height; y += 1) {
      const occupied = [];
      for (let x = 0; x < patch.width; x += 1) {
        if (!alphaAt(patch, x, y)) continue;
        occupied.push(x);
        area += 1;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (!alphaAt(patch, x + dx, y + dy)) perimeter += 1;
        }
      }
      leftEdges.push(occupied.length > 0 ? Math.min(...occupied) : null);
      rightEdges.push(occupied.length > 0 ? Math.max(...occupied) : null);
    }
    const longestStraightRun = (values) => {
      let longest = 0;
      let current = 0;
      let prior = Symbol("none");
      for (const value of values) {
        current = value !== null && value === prior ? current + 1 : value === null ? 0 : 1;
        prior = value;
        longest = Math.max(longest, current);
      }
      return longest;
    };
    return {
      area,
      perimeter,
      fillRatio: area / (patch.width * patch.height),
      longestStraightEdge: Math.max(longestStraightRun(leftEdges), longestStraightRun(rightEdges)),
      uniqueRows: new Set(patch.rows).size,
    };
  };
  const pondShape = morphology(pondPatch);
  assert.ok(pondShape.fillRatio <= 0.66, `pond must be landscape-irregular, got fill ${pondShape.fillRatio}`);
  assert.ok(pondShape.longestStraightEdge <= 24,
    `pond cannot retain a card-like straight edge, got ${pondShape.longestStraightEdge}px`);
  const lanePatch = REGIONAL_R5_LITERAL_PATCHES.patches.find(({ id }) => id === "neutral:scene-pale-lane");
  const laneShape = morphology(lanePatch);
  assert.ok(laneShape.longestStraightEdge <= 64,
    `pale lane needs a softened footpath edge, got ${laneShape.longestStraightEdge}px`);
  const wallShape = morphology(wallPatch);
  assert.ok(wallShape.uniqueRows >= 12,
    `low field-stone wall needs staggered masonry/hedge anatomy, got ${wallShape.uniqueRows} row signatures`);
  const wallLandmarks = [
    byId.get("neutral:landmark-stone-boundary-a"),
    byId.get("neutral:landmark-stone-boundary-b"),
  ];
  for (const patch of wallLandmarks) {
    const shape = morphology(patch);
    assert.ok(shape.area >= 1_600 && shape.uniqueRows >= 36,
      `${patch.id} must read as connected masonry with a vertical return, not scattered stones`);
    const raw = productionPacker.realizeRegionalR5IndexedPatch(patch);
    const alpha = raw.data.filter((_value, offset) => offset % 4 === 3 && raw.data[offset] === 255).length;
    assert.ok(productionPacker.regionalR5AlphaComponentSizes(raw)[0] / alpha >= 0.58,
      `${patch.id} requires one dominant low-wall silhouette`);
  }
  assert.ok(occupiedIn(wallLandmarks[0], 96, 96, 32, 32) <= 48,
    "stone-boundary A keeps the south route socket visibly open");
  assert.ok(occupiedIn(wallLandmarks[1], 0, 43, 13, 35) >= 120,
    "stone-boundary B requires a connected vertical return into support A");

  const vergeA = byId.get("neutral:landmark-hedgerow-verge-a");
  const vergeB = byId.get("neutral:landmark-hedgerow-verge-b");
  const vergeC = byId.get("neutral:landmark-hedgerow-verge-c");
  assert.ok(occupiedIn(vergeA, 0, 24, 32, 96) >= 420 && occupiedIn(vergeA, 24, 88, 72, 32) >= 420,
    "verge A must form a rooted left/L boundary");
  assert.ok(occupiedIn(vergeB, 104, 72, 24, 32) <= 64 && occupiedIn(vergeB, 88, 40, 40, 32) >= 260,
    "verge B must curve into a right-side support while keeping the route socket open");
  assert.ok(occupiedIn(vergeC, 0, 36, 32, 40) >= 180 && occupiedIn(vergeC, 88, 80, 40, 40) >= 300,
    "verge C must form a connected descending diagonal, not another horizontal shrub strip");
  assert.equal(new Set([vergeA, vergeB, vergeC].map((patch) => patch.rows.map((row) => (
    row.replace(/0/g, "").length
  )).join(","))).size, 3, "the three verge silhouettes need genuinely distinct directional profiles");

  const ashNetwork = REGIONAL_R5_LITERAL_PATCHES.patches
    .find(({ id }) => id === "ash:scene-containment-network");
  assert.ok(ashNetwork && ashNetwork.width === 768 && ashNetwork.height === 512,
    "ash wasteland requires one scene-scale containment and waste-storage network");
  assert.deepEqual(REGIONAL_R5_LITERAL_PATCHES.roleBindings["ash-contamination-network"], [ashNetwork.id],
    "the contamination network must be an explicit literal authority role");
  const ashNetworkRaw = productionPacker.realizeRegionalR5IndexedPatch(ashNetwork);
  const ashNetworkAlpha = ashNetworkRaw.data.filter((_value, offset) => (
    offset % 4 === 3 && ashNetworkRaw.data[offset] === 255
  )).length;
  const networkComponents = productionPacker.regionalR5AlphaComponentSizes(ashNetworkRaw);
  assert.deepEqual(networkComponents, [ashNetworkAlpha],
    `containment network must join every perimeter instrument into one landscape, got ${networkComponents}`);
  const activeTokens = ashNetwork.rows.join("").split("").map((index) => ashNetwork.palette[index]);
  for (const token of ["containment-concrete", "oxidized-metal", "warning-ochre", "hazard-lime"]) {
    assert.ok(activeTokens.includes(token), `containment network requires restrained ${token} vocabulary`);
  }
  for (const token of ["warning-ochre", "hazard-lime"]) {
    const share = activeTokens.filter((value) => value === token).length / ashNetworkAlpha;
    assert.ok(share > 0.0005 && share <= 0.025, `${token} must read as sparse nuclear hazard instrumentation (${share})`);
  }
  const ashSceneLayer = REGIONAL_R5_KEY_SCENES["ash-waste"].literalPatchLayers
    .find(({ patchId }) => patchId === ashNetwork.id);
  assert.deepEqual(ashSceneLayer && [ashSceneLayer.x, ashSceneLayer.y, ashSceneLayer.width, ashSceneLayer.height],
    [0, 0, 768, 512], "containment network must cover the whole ash scene without moving anchors");
  for (const [label, x, y, width, height] of [
    ["service-strip", 288, 152, 35, 55],
    ["service-junction", 304, 196, 45, 53],
  ]) {
    let structural = 0;
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      const token = ashNetwork.palette[ashNetwork.rows[yy][xx]];
      structural += ["charcoal", "containment-concrete", "oxidized-metal", "slag"].includes(token) ? 1 : 0;
    }
    const share = structural / (width * height);
    assert.ok(share >= 0.28 && share <= 0.72,
      `${label} needs bounded conduit structure rather than exposed dots or a filled slab (${share})`);
  }
  for (const layer of [
    ...REGIONAL_R5_KEY_SCENES["ash-waste"].landmarkLayers,
    ...REGIONAL_R5_KEY_SCENES["ash-waste"].supportLayers,
  ]) {
    const centerX = layer.x + Math.floor(layer.width / 2);
    const rootY = Math.min(511, layer.y + layer.height - 8);
    let joined = false;
    for (let y = Math.max(0, rootY - 12); y <= Math.min(511, rootY + 12) && !joined; y += 1) {
      for (let x = Math.max(0, centerX - 16); x <= Math.min(767, centerX + 16); x += 1) {
        if (ashNetwork.rows[y][x] !== ashNetwork.transparentIndex) { joined = true; break; }
      }
    }
    assert.equal(joined, true, `${layer.id} must root into the containment landscape instead of reading as a pickup`);
  }

});

test("Task12R R5 neutral landscape replaces placeholder masses, bead chains, and loose yard props", () => {
  const byId = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const tokenCountIn = (patch, x, y, width, height, token) => {
    let count = 0;
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      count += patch.palette[patch.rows[yy][xx]] === token ? 1 : 0;
    }
    return count;
  };
  const tokenRowsIn = (patch, x, y, width, height, token) => {
    let rows = 0;
    for (let yy = y; yy < y + height; yy += 1) {
      let count = 0;
      for (let xx = x; xx < x + width; xx += 1) {
        count += patch.palette[patch.rows[yy][xx]] === token ? 1 : 0;
      }
      rows += count >= 2 ? 1 : 0;
    }
    return rows;
  };
  const longestHorizontalTokenRunIn = (patch, x, y, width, height, token) => {
    let longest = 0;
    for (let yy = y; yy < y + height; yy += 1) {
      let run = 0;
      for (let xx = x; xx < x + width; xx += 1) {
        run = patch.palette[patch.rows[yy][xx]] === token ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    return longest;
  };
  const tokenComponentSizesIn = (patch, x, y, width, height, token) => {
    const remaining = new Set();
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      if (patch.palette[patch.rows[yy][xx]] === token) remaining.add(`${xx},${yy}`);
    }
    const sizes = [];
    while (remaining.size > 0) {
      const seed = remaining.values().next().value;
      remaining.delete(seed);
      const queue = [seed];
      for (let head = 0; head < queue.length; head += 1) {
        const [xx, yy] = queue[head].split(",").map(Number);
        for (const neighbour of [`${xx - 1},${yy}`, `${xx + 1},${yy}`, `${xx},${yy - 1}`, `${xx},${yy + 1}`]) {
          if (remaining.delete(neighbour)) queue.push(neighbour);
        }
      }
      sizes.push(queue.length);
    }
    return sizes.sort((left, right) => right - left);
  };
  const tokenComponentBoxesIn = (patch, x, y, width, height, token) => {
    const remaining = new Set();
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      if (patch.palette[patch.rows[yy][xx]] === token) remaining.add(`${xx},${yy}`);
    }
    const boxes = [];
    while (remaining.size > 0) {
      const seed = remaining.values().next().value;
      remaining.delete(seed);
      const queue = [seed];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let head = 0; head < queue.length; head += 1) {
        const [xx, yy] = queue[head].split(",").map(Number);
        minX = Math.min(minX, xx); maxX = Math.max(maxX, xx);
        minY = Math.min(minY, yy); maxY = Math.max(maxY, yy);
        for (const neighbour of [`${xx - 1},${yy}`, `${xx + 1},${yy}`, `${xx},${yy - 1}`, `${xx},${yy + 1}`]) {
          if (remaining.delete(neighbour)) queue.push(neighbour);
        }
      }
      boxes.push({ size: queue.length, minX, maxX, minY, maxY,
        width: maxX - minX + 1, height: maxY - minY + 1 });
    }
    return boxes.sort((left, right) => right.size - left.size);
  };
  const reedCadenceIn = (patch, x, y, width, height) => {
    const stems = tokenComponentBoxesIn(patch, x, y, width, height, "meadow-timber")
      .filter(({ width: stemWidth, height: stemHeight }) => stemHeight >= 6 && stemWidth <= 10)
      .sort((left, right) => left.minX - right.minX);
    const groups = [];
    for (const stem of stems) {
      const prior = groups.at(-1)?.at(-1);
      if (!prior || stem.minX - prior.maxX > 24) groups.push([stem]);
      else groups.at(-1).push(stem);
    }
    const gaps = groups.flatMap((group) => group.slice(1).map((stem, index) => (
      stem.minX - group[index].minX
    )));
    const frequencies = [...new Set(gaps)].map((gap) => gaps.filter((value) => value === gap).length);
    return {
      stems,
      groups,
      gaps,
      maximumRepeatedGap: Math.max(0, ...frequencies),
      distinctGapCount: new Set(gaps).size,
    };
  };

  const ground = byId.get("neutral:scene-meadow-ground-mass");
  for (const [label, x, y, width, height] of [
    ["upper-right bank", 480, 64, 272, 224],
    ["lower-left bank", 0, 344, 384, 168],
  ]) {
    assert.ok(tokenCountIn(ground, x, y, width, height, "field-stone") >= 120,
      `${label} requires joined field-stone/shore contour material rather than a flat placeholder mass`);
    assert.ok(tokenRowsIn(ground, x, y, width, height, "field-stone") >= 18,
      `${label} contour material must travel through the terrain instead of becoming another pickup`);
    assert.ok(tokenCountIn(ground, x, y, width, height, "stone-shadow") >= 600,
      `${label} needs localized shallow-tone patches instead of two strokes over a flat macro mask`);
    const toneComponents = tokenComponentSizesIn(ground, x, y, width, height, "stone-shadow");
    const substantialTones = toneComponents.filter((size) => size >= 180);
    const fragmentToneMass = toneComponents.filter((size) => size < 120)
      .reduce((sum, size) => sum + size, 0);
    assert.ok(substantialTones.length >= 1 && substantialTones.length <= 2
      && substantialTones[0] >= 650 && fragmentToneMass <= 160,
    `${label} needs 1-2 connected littoral shallows rather than a cadence of isolated oval markers (${toneComponents})`);
    assert.ok(tokenCountIn(ground, x, y, width, height, "wildflower") <= 12,
      `${label} forbids repeated flower/sprig marker spam inside the water or floodplain body`);
    const timber = tokenCountIn(ground, x, y, width, height, "meadow-timber");
    assert.ok(timber >= 30 && timber <= 100,
      `${label} needs sparse habitat-scale timber/reeds, not a field of repeated prop markers (${timber}px)`);
    assert.ok(longestHorizontalTokenRunIn(ground, x, y, width, height, "meadow-timber") <= 5,
      `${label} forbids capped rectangles, rails, and ladder-like reed bases`);
    const cadence = reedCadenceIn(ground, x, y, width, height);
    assert.ok(cadence.groups.length >= 1 && cadence.groups.length <= 2,
      `${label} needs only 1-2 connected littoral reed habitats, got ${cadence.groups.length}`);
    assert.ok(cadence.stems.length >= 4 && cadence.stems.length <= 14,
      `${label} needs a bounded irregular reed fringe, got ${cadence.stems.length} tall stems`);
    assert.ok(cadence.maximumRepeatedGap <= 2
      && cadence.distinctGapCount >= Math.ceil(cadence.gaps.length / 2),
    `${label} reed cadence must vary instead of repeating even fence-post spacing (${cadence.gaps})`);
  }

  const upperEcology = ["stone-shadow", "meadow-timber", "field-stone", "hedge-deep"]
    .map((token) => tokenCountIn(ground, 480, 64, 272, 224, token));
  const lowerEcology = ["stone-shadow", "meadow-timber", "field-stone", "hedge-deep"]
    .map((token) => tokenCountIn(ground, 0, 344, 384, 168, token));
  assert.notDeepEqual(upperEcology, lowerEcology,
    "the two ponds need different littoral silhouettes and habitat vocabulary, not paired stamps");

  const roots = byId.get("neutral:scene-cluster-roots");
  assert.ok(tokenCountIn(roots, 588, 382, 112, 96, "meadow-timber") >= 90,
    "the right shelter needs a shared work-yard fence/base behind its immutable yard props");
  assert.ok([
    "sage-dark", "damp-verge", "hedge-deep", "field-stone",
  ].reduce((sum, token) => sum + tokenCountIn(roots, 588, 382, 112, 96, token), 0) >= 500,
  "the work-yard fence and base must read as one substantial landscape mass");
  assert.ok(tokenCountIn(roots, 448, 400, 272, 80, "stone-shadow") >= 240,
    "the jar, can, and cracked yard slab require shared contact-shadow patches on one work apron");

  const wall = byId.get("neutral:scene-stone-wall");
  const wallIndices = wall.rows.join("").split("");
  const wallOpaque = wallIndices.filter((index) => index !== wall.transparentIndex).length;
  const wallOutline = wallIndices.filter((index) => wall.palette[index] === "outline").length;
  assert.ok(wallOutline / wallOpaque <= 0.08,
    "the scene wall must be a connected low masonry/verge boundary, not a chain of outlined round beads");

  for (const id of REGIONAL_R5_LITERAL_PATCHES.roleBindings["neutral-hedgerow-verge"]) {
    const patch = byId.get(id);
    const indices = patch.rows.join("").split("");
    const opaque = indices.filter((index) => index !== patch.transparentIndex).length;
    const outline = indices.filter((index) => patch.palette[index] === "outline").length;
    const dampVerge = indices.filter((index) => patch.palette[index] === "damp-verge").length;
    assert.ok(outline / opaque <= 0.16,
      `${id} must be a continuous irregular shrub/stone mass without repeated black-outlined bead cadence`);
    assert.ok(opaque / (patch.width * patch.height) <= 0.23,
      `${id} must be a narrow ragged human-scale boundary, not a giant hose or worm (${opaque}px)`);
    assert.ok(dampVerge >= 320,
      `${id} must be partially rooted and occluded by a shared damp verge/earth base`);
  }
});

test("Task12R R5 ash macro fields carry connected cold industrial surface structure", () => {
  const ground = REGIONAL_R5_LITERAL_PATCHES.patches
    .find(({ id }) => id === "ash:scene-cold-ground-mass");
  const tokenComponentsIn = (x, y, width, height, token) => {
    const remaining = new Set();
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      if (ground.palette[ground.rows[yy][xx]] === token) remaining.add(`${xx},${yy}`);
    }
    const sizes = [];
    while (remaining.size > 0) {
      const seed = remaining.values().next().value;
      remaining.delete(seed);
      const queue = [seed];
      for (let head = 0; head < queue.length; head += 1) {
        const [xx, yy] = queue[head].split(",").map(Number);
        for (const neighbour of [`${xx - 1},${yy}`, `${xx + 1},${yy}`, `${xx},${yy - 1}`, `${xx},${yy + 1}`]) {
          if (remaining.delete(neighbour)) queue.push(neighbour);
        }
      }
      sizes.push(queue.length);
    }
    return sizes.sort((left, right) => right - left);
  };
  const count = (x, y, width, height, token) => {
    let total = 0;
    for (let yy = y; yy < y + height; yy += 1) for (let xx = x; xx < x + width; xx += 1) {
      total += ground.palette[ground.rows[yy][xx]] === token ? 1 : 0;
    }
    return total;
  };
  const longestRun = (x, y, width, height, token, axis) => {
    let longest = 0;
    const outer = axis === "horizontal" ? height : width;
    const inner = axis === "horizontal" ? width : height;
    for (let major = 0; major < outer; major += 1) {
      let run = 0;
      for (let minor = 0; minor < inner; minor += 1) {
        const xx = axis === "horizontal" ? x + minor : x + major;
        const yy = axis === "horizontal" ? y + major : y + minor;
        run = ground.palette[ground.rows[yy][xx]] === token ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    return longest;
  };
  const regions = [
    ["northwest concrete field", 0, 0, 320, 200, 1],
    ["northeast concrete field", 480, 64, 288, 240, 2],
  ];
  const silhouettes = [];
  for (const [label, x, y, width, height, expectedBreaks] of regions) {
    assert.ok(count(x, y, width, height, "charcoal") >= 320,
      `${label} needs cracked plate/trench structure rather than a pale placeholder macro`);
    assert.ok(count(x, y, width, height, "oxidized-metal") >= 180,
      `${label} needs cold cable/support anatomy rooted into the industrial surface`);
    const structure = tokenComponentsIn(x, y, width, height, "charcoal");
    const major = structure.filter((size) => size >= 140);
    assert.equal(major.length, expectedBreaks,
      `${label} requires exactly ${expectedBreaks} major tapered surface break(s), not repeated rail sprites (${structure.slice(0, 12)})`);
    assert.ok(major[0] >= 260,
      `${label} major break must remain scene-scale after dust/rubble occlusion (${major})`);
    assert.ok(longestRun(x, y, width, height, "charcoal", "horizontal") <= 34,
      `${label} forbids long horizontal rail grammar in ground fractures`);
    assert.ok(longestRun(x, y, width, height, "oxidized-metal", "vertical") <= 22,
      `${label} forbids evenly repeated upright-post grammar in ground fractures`);
    silhouettes.push(...major.map((size) => Math.round(size / 40)));
    assert.equal(count(x, y, width, height, "hazard-lime"), 0,
      `${label} keeps hazard color on attached instruments, not ground markers`);
  }
  assert.equal(new Set(silhouettes).size, 3,
    `all three industrial surface breaks need materially different silhouettes (${silhouettes})`);
});

test("Task12R R5 ash world reserves major trefoils for exactly two attached hazard panels", () => {
  const majorTrefoils = REGIONAL_R5_LITERAL_PATCHES.patches
    .filter(({ ownerKit }) => ownerKit === "ash-waste")
    .filter((patch) => {
      const points = [];
      patch.rows.forEach((row, y) => [...row].forEach((index, x) => {
        if (patch.palette[index] === "hazard-lime") points.push([x, y]);
      }));
      if (points.length < 55) return false;
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      return Math.max(...xs) - Math.min(...xs) >= 18 && Math.max(...ys) - Math.min(...ys) >= 18;
    })
    .map(({ id }) => id)
    .sort();
  assert.deepEqual(majorTrefoils, [
    "ash:landmark-hazard-panel-a",
    "ash:landmark-hazard-panel-b",
  ], "the nuclear landscape needs two legible major decals; valves, stains, shields, and cables carry all other cues");
});

test("Task12R R5 world scenes reject 32px seam stamping without masks", async () => {
  const phaseEdgeMetrics = (raw, axis) => {
    const limit = axis === "x" ? raw.width : raw.height;
    const otherLimit = axis === "x" ? raw.height : raw.width;
    const edges = [];
    for (let position = 1; position < limit; position += 1) {
      let difference = 0;
      for (let other = 0; other < otherLimit; other += 1) {
        const x = axis === "x" ? position : other;
        const y = axis === "x" ? other : position;
        const priorX = axis === "x" ? x - 1 : x;
        const priorY = axis === "x" ? y : y - 1;
        const offset = (y * raw.width + x) * 4;
        const prior = (priorY * raw.width + priorX) * 4;
        difference += Math.abs(raw.data[offset] - raw.data[prior])
          + Math.abs(raw.data[offset + 1] - raw.data[prior + 1])
          + Math.abs(raw.data[offset + 2] - raw.data[prior + 2]);
      }
      edges.push({ position, difference: difference / (otherLimit * 3 * 255) });
    }
    const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const phaseMeans = Array.from({ length: 32 }, (_unused, phase) => mean(
      edges.filter(({ position }) => position % 32 === phase).map(({ difference }) => difference),
    ));
    return { phaseMeans, overall: mean(edges.map(({ difference }) => difference)) };
  };
  const terrainScene = (scene, atlas) => {
    const raw = { data: Buffer.alloc(768 * 512 * 4), width: 768, height: 512, channels: 4 };
    for (let tileY = 0; tileY < 16; tileY += 1) for (let tileX = 0; tileX < 24; tileX += 1) {
      const cell = Number.parseInt(scene.terrainRows[tileY].slice(tileX * 2, tileX * 2 + 2), 16);
      const sourceX = cell % 8 * 32;
      const sourceY = Math.floor(cell / 8) * 32;
      for (let y = 0; y < 32; y += 1) {
        const sourceOffset = ((sourceY + y) * atlas.width + sourceX) * 4;
        const destinationOffset = ((tileY * 32 + y) * raw.width + tileX * 32) * 4;
        atlas.data.copy(raw.data, destinationOffset, sourceOffset, sourceOffset + 32 * 4);
      }
    }
    return raw;
  };
  const authoring = await regionalR5Authoring();
  for (const kit of ["ash-waste", "neutral-temperate", "spring-terraces"]) {
    const scene = await productionPacker.buildRegionalR5KeyScene({ kit, authoring });
    if (kit === "spring-terraces") {
      assert.equal(createHash("sha256").update(authoring.rawMasters[`${kit}-terrain`].data).digest("hex"),
        "bb3eb8d076fde6a2ea06ed7023811fdb7d208bd7a1835ca71e8ba807ec768ca3");
      assert.equal(createHash("sha256").update(scene.raw.data).digest("hex"),
        "f4106d971e51e4b0ecd6a0fa6db5fce45285f4c0ccf372ca0b3de667b5dc9cf8");
    }
    const literalLayers = REGIONAL_R5_KEY_SCENES[kit].literalPatchLayers;
    assert.equal(new Set(literalLayers.map(({ id }) => id)).size, literalLayers.length,
      `${kit} literal scene IDs must be unique`);
    assert.equal(new Set(literalLayers.map(({ patchId, x, y }) => `${patchId}@${x},${y}`)).size,
      literalLayers.length, `${kit} literal scene placements must be unique`);
    assert.equal(literalLayers.filter(({ routeRelation }) => routeRelation === "ground-foundation").length, 1,
      `${kit} requires exactly one ground foundation`);
    const terrain = terrainScene(REGIONAL_R5_KEY_SCENES[kit], authoring.rawMasters[`${kit}-terrain`]);
    for (const [stage, raw, maximumPhase, maximumOverall] of [
      ["terrain-only", terrain, 0.03, 0.02],
      ["final-world", scene.raw, 0.025, 0.02],
    ]) for (const axis of ["x", "y"]) {
      const metrics = phaseEdgeMetrics(raw, axis);
      let phaseCeiling = maximumPhase;
      if (kit === "spring-terraces" && stage === "terrain-only" && axis === "y") {
        const measuredMaximum = Math.max(...metrics.phaseMeans);
        assert.deepEqual({
          phase: metrics.phaseMeans.indexOf(measuredMaximum),
          maximum: measuredMaximum,
          overall: metrics.overall,
        }, {
          phase: 20,
          maximum: 0.03153456478077341,
          overall: 0.00827168576715313,
        }, "Spring terrain seam exception is pinned to the exact accepted V10 source-bound receipt");
        phaseCeiling = 0.031535;
      }
      assert.ok(Math.max(...metrics.phaseMeans) <= phaseCeiling,
        `${kit}/${stage}/${axis} every 32px phase must stay below ${phaseCeiling}: ${JSON.stringify(metrics.phaseMeans)}`);
      assert.ok(metrics.overall <= maximumOverall,
        `${kit}/${stage}/${axis} ordinary high-frequency energy ${metrics.overall} exceeds ${maximumOverall}`);
    }
  }
});

test("Task12R R5 entrance depth is authority-owned, hash-closed, and runtime-parity honest", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5EntranceDepthLayers, "function");
  const contract = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  assert.deepEqual(contract.portal, { x: 48, y: 36, width: 32, height: 60 });
  assert.deepEqual(contract.threshold, { x: 43, y: 95, width: 39, height: 19 });
  assert.deepEqual(contract.thresholdForegroundBand, { x: 43, y: 95, width: 32, height: 1 });
  assert.deepEqual(contract.shelterDoorPresentationAnchor, {
    role: "shelter-door",
    homeOffset: { x: 80, y: 63 },
    apron: { x: 80, y: 63, width: 48, height: 64 },
    mechanicsBacked: true,
    proofOnly: true,
    runtimeConsumer: "SceneGraph.shelterDoorPresentationAnchor",
  });
  assert.equal(contract.expectedPortalHumanOverlap, 0);
  assert.equal(contract.expectedForegroundHumanOverlap, 0);
  assert.deepEqual(contract.contactShadow.geometry, { width: 24, height: 5, opaquePixels: 80 });
  assert.equal(contract.contactShadow.colorToken, "human-contact-shadow");
  assert.match(REGIONAL_R5_PALETTES.shared[contract.contactShadow.colorToken], /^#[a-f0-9]{6}$/);
  assert.deepEqual(contract.composition.layerOrder,
    ["world", "home-underlay", "human-contact-shadows", "human-witnesses", "home-foreground"]);
  assert.deepEqual(contract.runtimeParity, {
    completeProductionPreview: false,
    omittedProductionLayers: [
      "runtime-home-depth-mask",
      "runtime-human-contact-shadows",
      "runtime-shelter-door-presentation-anchor",
    ],
    homeConsumer: "HomeActor.frontClip",
    humanConsumer: "LayeredHumanActor.contactShadow",
  });
  assert.equal(typeof productionPacker.validateRegionalR5EntranceDepthAuthority, "function");
  assert.throws(() => productionPacker.validateRegionalR5EntranceDepthAuthority({
    kit: "ash-waste",
    authority: { ...structuredClone(contract), thresholdForegroundBand: { x: 42, y: 96, width: 39, height: 1 } },
  }), /foreground band.*threshold/i);
  assert.throws(() => productionPacker.validateRegionalR5EntranceDepthAuthority({
    kit: "ash-waste",
    authority: { ...structuredClone(contract), thresholdForegroundBand: { x: 75, y: 108, width: 7, height: 1 } },
  }), /foreground band.*apron|apron.*foreground band/i);

  const intersectionCount = (source, placement, fullLayer) => {
    let count = 0;
    for (let y = 0; y < source.height; y += 1) for (let x = 0; x < source.width; x += 1) {
      if (source.data[(y * source.width + x) * 4 + 3] === 0) continue;
      const fullX = placement.x + x;
      const fullY = placement.y + y;
      if (fullLayer.data[(fullY * fullLayer.width + fullX) * 4 + 3] === 255) count += 1;
    }
    return count;
  };
  const frozenLayerHashes = [];
  const expectedAnchors = {
    "ash-waste": [
      { x: 120, y: 435 }, { x: 328, y: 195 }, { x: 640, y: 367 },
    ],
    "neutral-temperate": [
      { x: 248, y: 19 }, { x: 168, y: 195 }, { x: 576, y: 399 },
    ],
  };
  for (const kit of ["ash-waste", "neutral-temperate"]) {
    const components = await productionPacker.buildRegionalR5CompleteProofComponents({
      kit,
      sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
    });
    const human = components.productionHuman.patch;
    const home = components.homeActor.patch;
    assert.deepEqual(components.humanWitnesses.map(({ placement }) => ({ x: placement.x, y: placement.y })),
      expectedAnchors[kit], `${kit} changes only the exact shelter-door presentation anchor`);
    const shelterWitness = components.humanWitnesses.find(({ placement }) => placement.role === "shelter-door");
    assert.deepEqual({
      x: shelterWitness.placement.x - components.homeActor.placement.x,
      y: shelterWitness.placement.y - components.homeActor.placement.y,
    }, contract.shelterDoorPresentationAnchor.homeOffset);
    let portalHumanAlpha = 0;
    for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
      if (human.data[(y * human.width + x) * 4 + 3] === 0) continue;
      const localX = shelterWitness.placement.x + x - components.homeActor.placement.x;
      const localY = shelterWitness.placement.y + y - components.homeActor.placement.y;
      if (localX >= contract.portal.x && localX < contract.portal.x + contract.portal.width
          && localY >= contract.portal.y && localY < contract.portal.y + contract.portal.height) {
        portalHumanAlpha += 1;
      }
    }
    assert.equal(portalHumanAlpha, contract.expectedPortalHumanOverlap,
      `${kit} shelter witness must leave the full door portal visually unobscured`);
    const before = {
      human: createHash("sha256").update(human.data).digest("hex"),
      home: createHash("sha256").update(home.data).digest("hex"),
      placements: structuredClone(components.humanWitnesses.map(({ placement, feet }) => ({ placement, feet }))),
    };
    assert.equal(createHash("sha256").update(components.homeActor.frontPatch.data).digest("hex"),
      contract.frontPatchRgbaSha256[kit]);
    assert.equal(createHash("sha256").update(components.productionHuman.facePatch.data).digest("hex"),
      contract.humanSemanticRgbaSha256.face);
    assert.equal(createHash("sha256").update(components.productionHuman.hairPatch.data).digest("hex"),
      contract.humanSemanticRgbaSha256.hair);

    const treatment = productionPacker.buildRegionalR5EntranceDepthLayers({
      kit,
      width: 768,
      height: 512,
      components,
    });
    assert.deepEqual(treatment.layerOrder,
      ["world", "home-underlay", "human-contact-shadows", "human-witnesses", "home-foreground"]);
    for (const layer of [treatment.contactShadows, treatment.homeForeground]) {
      assert.deepEqual([layer.width, layer.height, layer.channels], [768, 512, 4]);
    }
    assert.equal(createHash("sha256").update(human.data).digest("hex"), before.human);
    assert.equal(createHash("sha256").update(home.data).digest("hex"), before.home);
    assert.deepEqual(components.humanWitnesses.map(({ placement, feet }) => ({ placement, feet })), before.placements);
    assert.equal(before.human, REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.canonicalPatchSha256);

    assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(treatment.contactShadows), [80, 80, 80],
      `${kit} requires one exact connected 24x5/80px contact shadow for every witness`);
    const shadowHex = REGIONAL_R5_PALETTES.shared[contract.contactShadow.colorToken];
    const shadowRgba = [
      Number.parseInt(shadowHex.slice(1, 3), 16),
      Number.parseInt(shadowHex.slice(3, 5), 16),
      Number.parseInt(shadowHex.slice(5, 7), 16),
      255,
    ];
    for (let offset = 0; offset < treatment.contactShadows.data.length; offset += 4) {
      if (treatment.contactShadows.data[offset + 3] === 0) continue;
      assert.deepEqual([...treatment.contactShadows.data.subarray(offset, offset + 4)], shadowRgba,
        `${kit} shadows must use the shared authority-owned color token`);
    }

    const homePlacement = components.homeActor.placement;
    let humanOverlap = 0;
    for (let y = 0; y < 128; y += 1) for (let x = 0; x < 128; x += 1) {
      const inPortal = x >= contract.portal.x && x < contract.portal.x + contract.portal.width
        && y >= contract.portal.y && y < contract.portal.y + contract.portal.height;
      const inThreshold = x >= contract.threshold.x && x < contract.threshold.x + contract.threshold.width
        && y >= contract.threshold.y && y < contract.threshold.y + contract.threshold.height;
      const inThresholdForegroundBand = x >= contract.thresholdForegroundBand.x
        && x < contract.thresholdForegroundBand.x + contract.thresholdForegroundBand.width
        && y >= contract.thresholdForegroundBand.y
        && y < contract.thresholdForegroundBand.y + contract.thresholdForegroundBand.height;
      const apron = contract.shelterDoorPresentationAnchor.apron;
      const inShelterApron = x >= apron.x && x < apron.x + apron.width
        && y >= apron.y && y < apron.y + apron.height;
      const sourceOffset = (y * 128 + x) * 4;
      const targetOffset = ((homePlacement.y + y) * 768 + homePlacement.x + x) * 4;
      const expectedOpaque = components.homeActor.frontPatch.data[sourceOffset + 3] === 255
        && (!(inPortal || inShelterApron) || (inThreshold && inThresholdForegroundBand));
      assert.equal(treatment.homeForeground.data[targetOffset + 3] === 255, expectedOpaque,
        `${kit} foreground must be exact frontPatch outside the authority portal plus threshold only`);
      if (expectedOpaque) {
        assert.deepEqual(
          [...treatment.homeForeground.data.subarray(targetOffset, targetOffset + 4)],
          [...components.homeActor.frontPatch.data.subarray(sourceOffset, sourceOffset + 4)],
        );
      }
    }

    for (const witness of components.humanWitnesses) {
      assert.equal(intersectionCount(components.productionHuman.facePatch, witness.placement,
        treatment.homeForeground), 0, `${kit}/${witness.placement.role} face alpha may not meet foreground`);
      assert.equal(intersectionCount(components.productionHuman.hairPatch, witness.placement,
        treatment.homeForeground), 0, `${kit}/${witness.placement.role} hair alpha may not meet foreground`);
      for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
        if (human.data[(y * human.width + x) * 4 + 3] === 0) continue;
        const fullX = witness.placement.x + x;
        const fullY = witness.placement.y + y;
        if (treatment.homeForeground.data[(fullY * 768 + fullX) * 4 + 3] === 0) continue;
        humanOverlap += 1;
        assert.ok(fullY >= witness.feet.y - 1, `${kit} foreground may only overlap the threshold at the feet`);
      }
    }
    assert.equal(humanOverlap, contract.expectedForegroundHumanOverlap,
      `${kit} threshold foreground must overlap exactly the authorized foot pixels`);
    frozenLayerHashes.push({
      kit,
      foreground: createHash("sha256").update(treatment.homeForeground.data).digest("hex"),
      shadows: createHash("sha256").update(treatment.contactShadows.data).digest("hex"),
    });

    const forgedHuman = { ...components, productionHuman: {
      ...components.productionHuman,
      patch: { ...components.productionHuman.patch, data: Buffer.from(components.productionHuman.patch.data) },
    } };
    forgedHuman.productionHuman.patch.data[0] ^= 0xff;
    assert.throws(() => productionPacker.buildRegionalR5EntranceDepthLayers({
      kit, width: 768, height: 512, components: forgedHuman,
    }), /canonical.*human|human.*hash/i);
    const forgedFront = { ...components, homeActor: {
      ...components.homeActor,
      frontPatch: { ...components.homeActor.frontPatch, data: Buffer.from(components.homeActor.frontPatch.data) },
    } };
    forgedFront.homeActor.frontPatch.data[0] ^= 0xff;
    assert.throws(() => productionPacker.buildRegionalR5EntranceDepthLayers({
      kit, width: 768, height: 512, components: forgedFront,
    }), /frontPatch.*hash|canonical.*front/i);
    const oldShelterAnchor = {
      ...components,
      humanWitnesses: components.humanWitnesses.map((witness) => ({
        ...witness,
        placement: structuredClone(witness.placement),
        feet: structuredClone(witness.feet),
      })),
    };
    const oldWitness = oldShelterAnchor.humanWitnesses.find(({ placement }) => placement.role === "shelter-door");
    oldWitness.placement.x = components.homeActor.placement.x + 60;
    oldWitness.placement.y = components.homeActor.placement.y + 47;
    oldWitness.feet.x = oldWitness.placement.x + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.x;
    oldWitness.feet.y = oldWitness.placement.y + REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.feet.y;
    assert.throws(() => productionPacker.buildRegionalR5EntranceDepthLayers({
      kit, width: 768, height: 512, components: oldShelterAnchor,
    }), /canonical.*placement|presentation anchor/i,
    `${kit} must reject the superseded centered-over-door presentation anchor`);
  }
  assert.equal(new Set(frozenLayerHashes.map(({ foreground }) => foreground)).size, 2,
    "hostile ash and neutral homes share one depth contract without sharing forged foreground bytes");
});

test("Task12R R5 ash structures are distinct open nuclear-industrial anatomy with frozen service alpha", async () => {
  const byId = new Map(REGIONAL_R5_LITERAL_PATCHES.patches.map((patch) => [patch.id, patch]));
  const alphaSignature = (patch) => patch.rows.map((row) => row.replace(/[^0]/g, "1")).join("\n");
  const opaqueBounds = (patch) => {
    const points = [];
    patch.rows.forEach((row, y) => [...row].forEach((index, x) => { if (index !== "0") points.push([x, y]); }));
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    return { width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
  };
  for (const role of ["ash-containment-basin", "ash-scrubber-module", "ash-cask-bank", "ash-hazard-panel"]) {
    const ids = REGIONAL_R5_LITERAL_PATCHES.roleBindings[role];
    assert.equal(ids.length, 2, `${role} closes on two authored variants`);
    assert.notEqual(alphaSignature(byId.get(ids[0])), alphaSignature(byId.get(ids[1])),
      `${role} variants require different silhouette geometry`);
    assert.ok(ids.every((id) => REGIONAL_R5_ATLAS_AUTHORING_PLANS["ash-waste"][2].semanticCells
      .some(([, , layers]) => layers.some((layer) => layer[3] === id && layer[4] === role))),
    `${role} must be visible in the ash landmark atlas`);
  }
  for (const id of REGIONAL_R5_LITERAL_PATCHES.roleBindings["ash-containment-basin"]) {
    const patch = byId.get(id);
    const measured = opaqueBounds(byId.get(id));
    assert.ok(measured.width >= 120 && measured.height >= 80,
      `${id} must read as a scene-scale containment basin: ${JSON.stringify(measured)}`);
    const tokens = patch.rows.join("").split("").map((index) => patch.palette[index]);
    const opaque = tokens.filter((token) => token !== "transparent");
    assert.ok(tokens.filter((token) => token === "containment-concrete").length >= 1_250,
      `${id} requires a substantial double containment rim`);
    assert.ok(tokens.filter((token) => token === "charcoal").length / opaque.length <= 0.3,
      `${id} must read as a sealed capped sump, not an empty quarry pit`);
    const limePixels = tokens.filter((token) => token === "hazard-lime").length;
    assert.ok(limePixels >= 6 && limePixels <= 40,
      `${id} requires a small contamination gauge on the capped sump, not another major trefoil`);
  }
  for (const id of REGIONAL_R5_LITERAL_PATCHES.roleBindings["ash-hazard-panel"]) {
    const patch = byId.get(id);
    const limeIndex = Object.entries(patch.palette).find(([, token]) => token === "hazard-lime")?.[0];
    const limePixels = patch.rows.join("").split("").filter((index) => index === limeIndex).length;
    const opaquePixels = patch.rows.join("").split("").filter((index) => index !== "0").length;
    assert.ok(limePixels / opaquePixels <= 0.08, `${id} hazard mark must remain a restrained instrument cue`);
    const limePoints = [];
    patch.rows.forEach((row, y) => [...row].forEach((index, x) => {
      if (index === limeIndex) limePoints.push([x, y]);
    }));
    const xs = limePoints.map(([x]) => x);
    const ys = limePoints.map(([, y]) => y);
    assert.ok(limePoints.length >= 55 && Math.max(...xs) - Math.min(...xs) >= 18
      && Math.max(...ys) - Math.min(...ys) >= 18,
    `${id} requires a readable attached trefoil/contamination instrument, not a chevron or lamps`);
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    assert.ok(limePoints.some(([x, y]) => y < centerY - 5 && Math.abs(x - centerX) <= 5)
      && limePoints.some(([x, y]) => x < centerX - 5 && y > centerY)
      && limePoints.some(([x, y]) => x > centerX + 5 && y > centerY),
    `${id} contamination mark requires top, lower-left, and lower-right trefoil lobes`);
  }
  for (const id of ["ash:cable-run-a", "ash:cable-run-b"]) {
    const occupiedRows = byId.get(id).rows.filter((row) => /[^0]/.test(row)).length;
    assert.ok(occupiedRows >= 3, `${id} must visibly sag across at least three pixel rows`);
  }
  const lattice = byId.get("ash:pylon-lattice-a");
  const transparent = lattice.rows.join("").split("").filter((index) => index === "0").length;
  assert.ok(transparent / (lattice.width * lattice.height) >= 0.35, "pylon must read as open lattice");
  const service = byId.get("ash:service-conduit");
  assert.equal(service.width * service.height, 720);
  assert.equal(service.rows.join("").includes("0"), false, "service-conduit preserves exact full-alpha footprint");

  const forbiddenGenericAshTokens = new Set(["coral-fissure", "vent-warm"]);
  for (const family of ["safeGuideFragments", "regionalMacros"]) {
    for (const crop of REGIONAL_R5_CROPS[family].filter(({ kit }) => kit === "ash-waste")) {
      assert.deepEqual(crop.paletteTokens.filter((token) => forbiddenGenericAshTokens.has(token)), [],
        `${crop.id} world crop cannot emit HomeActor-only warm fissure colors`);
    }
  }
  for (const crop of REGIONAL_R5_CROPS.homeMaterialFragments.filter(({ kit }) => kit === "ash-waste")) {
    assert.equal(Object.hasOwn(crop, "paletteTokens"), false,
      `${crop.id} restores exact full-kit HomeActor palette semantics without a per-crop override`);
  }
  const warmPatch = byId.get("ash:home-sealed-filter-box");
  assert.deepEqual([...new Set(Object.values(warmPatch.palette)
    .filter((token) => ["coral-fissure", "vent-warm"].includes(token)))], ["coral-fissure", "vent-warm"],
  "the exact HomeActor filter remains the sole warm literal authority");
  const allowedWarmLiteralIds = new Set([warmPatch.id, "ash:sealed-filter-box"]);
  for (const patch of REGIONAL_R5_LITERAL_PATCHES.patches.filter(({ ownerKit, id }) => (
    ownerKit === "ash-waste" && !allowedWarmLiteralIds.has(id)
  ))) {
    const exposed = patch.rows.join("").split("").map((index) => patch.palette[index])
      .filter((token) => ["coral-fissure", "vent-warm"].includes(token));
    assert.deepEqual(exposed, [], `${patch.id} active world pixels must stay cold`);
  }

  const rgba = (hex) => [
    Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16), 255,
  ].join(",");
  const authoring = await regionalR5Authoring();
  const forbiddenAsh = new Set([rgba("#e46c5c"), rgba("#f49c74")]);
  for (const atlasId of ["ash-waste-terrain", "ash-waste-scenery", "ash-waste-landmarks"]) {
    const master = authoring.rawMasters[atlasId];
    for (let offset = 0; offset < master.data.length; offset += 4) {
      assert.equal(forbiddenAsh.has([...master.data.subarray(offset, offset + 4)].join(",")), false,
        `${atlasId} forbids HomeActor-only coral-fissure and vent-warm pixels`);
    }
  }
  const ash = await productionPacker.buildRegionalR5KeyScene({ kit: "ash-waste", authoring });
  const connectivity = productionPacker.measureRegionalR5SceneConnectivity(ash.connectivityInputs);
  const serviceReceipt = connectivity.receipts.find(({ clusterId }) => clusterId === "ash-pylon-service");
  assert.ok(serviceReceipt, "ash service cluster receipt remains present");
  assert.deepEqual(connectivity.errors, []);
});

test("Task12R R5 production Spring reproduces the accepted V10 source-bound bytes", async () => {
  const authoring = await regionalR5Authoring();
  const scene = await productionPacker.buildRegionalR5KeyScene({
    kit: "spring-terraces",
    authoring,
  });
  assert.equal(createHash("sha256").update(scene.raw.data).digest("hex"),
    "f4106d971e51e4b0ecd6a0fa6db5fce45285f4c0ccf372ca0b3de667b5dc9cf8");
  assert.equal(createHash("sha256").update(scene.buffer).digest("hex"),
    "0b465132edb10b4a39c2eb08d878c38d7d408703692706d5ac1abbe751c9a166",
  "production PNG encoding is pinned independently from the accepted rehearsal container bytes");
  assert.equal(createHash("sha256").update(authoring.rawMasters["spring-terraces-landmarks"].data)
    .digest("hex"), "595892ec9ea321f25c0438a97a27cc99101c93e1189c8e165eacf6befe89a6c3");
  assert.equal(createHash("sha256").update(authoring.buffers["spring-terraces-landmarks"])
    .digest("hex"), "f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1");
});

test("Task12R R5 spring is one irregular terraced water place rather than aqua tile wallpaper", async () => {
  const spring = "spring-terraces";
  const requiredRoles = [
    "spring-ground-foundation",
    "spring-connected-basin",
    "spring-landmark-anatomy",
    "spring-wet-yard",
  ];
  for (const role of requiredRoles) {
    assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleOrder.includes(role), `${role} must be authority-owned`);
    assert.ok(REGIONAL_R5_LITERAL_PATCHES.roleBindings[role]?.length > 0,
      `${role} must bind inspectable literal pixels`);
  }
  const sceneAuthority = REGIONAL_R5_KEY_SCENES[spring];
  assert.equal(sceneAuthority.literalPatchLayers
    .filter(({ routeRelation }) => routeRelation === "ground-foundation").length, 1,
  "spring needs one scene-scale ground foundation before all regional anatomy");
  assert.ok(sceneAuthority.literalPatchLayers.some(({ routeRelation }) => (
    routeRelation === "spring-bridge-water-return"
  )), "spring needs one labels-hidden connected basin/cascade return layer");
  assert.deepEqual(sceneAuthority.literalPatchLayers
    .filter(({ routeRelation }) => routeRelation.startsWith("spring-route-"))
    .map(({ routeRelation }) => routeRelation), ["spring-route-surface", "spring-route-tread"],
  "spring route surface and tread remain separately source-bound around presentation supports");
  assert.deepEqual(sceneAuthority.yardLayers.map(({ cell }) => cell), [0, 2, 3],
    "spring occupied yard uses exact base, warm, and hoard atlas layers");

  const authoring = await regionalR5Authoring();
  const result = await productionPacker.buildRegionalR5KeyScene({ kit: spring, authoring });
  const raw = result.raw;
  const colors = Object.fromEntries(Object.entries(REGIONAL_R5_PALETTES.kits[spring]).map(([token, hex]) => [
    token,
    [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16),
      Number.parseInt(hex.slice(5, 7), 16), 255].join(","),
  ]));
  colors.outline = "28,28,36,255";
  const tokenAt = (x, y) => {
    const offset = (y * raw.width + x) * 4;
    const rgba = [...raw.data.subarray(offset, offset + 4)].join(",");
    return Object.entries(colors).find(([, value]) => value === rgba)?.[0] ?? null;
  };
  const components = (tokens) => {
    const remaining = new Set();
    for (let y = 0; y < raw.height; y += 1) for (let x = 0; x < raw.width; x += 1) {
      if (tokens.has(tokenAt(x, y))) remaining.add(`${x},${y}`);
    }
    const found = [];
    while (remaining.size > 0) {
      const first = remaining.values().next().value;
      remaining.delete(first);
      const queue = [first];
      const points = [];
      while (queue.length > 0) {
        const key = queue.shift();
        const [x, y] = key.split(",").map(Number);
        points.push([x, y]);
        for (const neighbor of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
          if (!remaining.delete(neighbor)) continue;
          queue.push(neighbor);
        }
      }
      const xs = points.map(([x]) => x);
      const ys = points.map(([, y]) => y);
      found.push({
        size: points.length,
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs) + 1,
        height: Math.max(...ys) - Math.min(...ys) + 1,
        points,
      });
    }
    return found.sort((left, right) => right.size - left.size);
  };
  const touches = (left, right) => {
    const rightKeys = new Set(right.points.map(([x, y]) => `${x},${y}`));
    return left.points.some(([x, y]) => [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .some(([dx, dy]) => rightKeys.has(`${x + dx},${y + dy}`)));
  };

  const water = components(new Set(["deep-aqua", "shallow-aqua"]));
  const significantWater = water.filter(({ size }) => size >= 100);
  assert.equal(significantWater.length, 1,
    `spring water must have one significant basin/cascade component (${water.map(({ size }) => size)})`);
  assert.ok(water[0].size / water.reduce((sum, component) => sum + component.size, 0) >= 0.99,
    `tiny occlusion pockets may not hide a second pool (${water.map(({ size }) => size)})`);
  const r4Scene = REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[spring];
  const springClusterRecords = REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.clusterProofs.records
    .filter(({ kitId }) => kitId === spring);
  assert.equal(springClusterRecords.length, 8);
  const axisGap = (leftStart, leftSize, rightStart, rightSize) => Math.max(
    0,
    rightStart - (leftStart + leftSize),
    leftStart - (rightStart + rightSize),
  );
  const rectangleGap = (left, right) => Math.max(
    axisGap(left.x, left.width, right.x, right.width),
    axisGap(left.y, left.height, right.y, right.height),
  );
  const frozenTopologyKeys = new Set([...r4Scene.routeTiles, ...r4Scene.shoreTiles]
    .map(({ x, y }) => `${x},${y}`));
  for (const landmark of sceneAuthority.landmarkLayers) {
    const record = springClusterRecords.find(({ clusterId }) => clusterId === landmark.clusterId);
    assert.ok(record && frozenTopologyKeys.has(`${record.routeTarget.tileX},${record.routeTarget.tileY}`),
      `${landmark.clusterId} must remain bound to one frozen R4 route/shore tile`);
    const topologyRects = [...r4Scene.routeTiles, ...r4Scene.shoreTiles, ...r4Scene.waterTiles]
      .map(({ x, y }) => ({ x: x * 32, y: y * 32, width: 32, height: 32 }));
    assert.ok(Math.min(...topologyRects.map((rectangle) => rectangleGap(landmark, rectangle))) <= 32,
      `${landmark.clusterId} presentation rectangle must stay within one tile of frozen topology`);
    const supports = sceneAuthority.supportLayers
      .filter(({ clusterId }) => clusterId === landmark.clusterId);
    assert.equal(supports.length, 2, `${landmark.clusterId} needs exactly two presentation supports`);
    for (const support of supports) {
      assert.ok(rectangleGap(support, landmark) <= 32
        && Math.min(...topologyRects.map((rectangle) => rectangleGap(support, rectangle))) <= 32,
      `${support.id} must stay within one tile of both landmark and frozen topology`);
    }
  }
  const wetHaloTiles = [...r4Scene.waterTiles, ...r4Scene.shoreTiles];
  const wetHalo = {
    x: Math.min(...wetHaloTiles.map(({ x }) => x)) * 32,
    y: Math.min(...wetHaloTiles.map(({ y }) => y)) * 32,
    right: (Math.max(...wetHaloTiles.map(({ x }) => x)) + 1) * 32,
    bottom: (Math.max(...wetHaloTiles.map(({ y }) => y)) + 1) * 32,
  };
  assert.ok(water[0].width >= 192 && water[0].height >= 160
    && water[0].width <= wetHalo.right - wetHalo.x && water[0].height <= wetHalo.bottom - wetHalo.y,
  `spring water must span the canonical basin inside its ${wetHalo.right - wetHalo.x}x${wetHalo.bottom - wetHalo.y} halo, received ${water[0].width}x${water[0].height}`);
  assert.ok(water[0].points.every(([x, y]) => x >= wetHalo.x && x < wetHalo.right
    && y >= wetHalo.y && y < wetHalo.bottom),
  "aqua may not leak beyond the frozen R4 water+shore presentation halo");
  const bridgeTileKeys = new Set(r4Scene.bridgeTiles.map(({ x, y }) => `${x},${y}`));
  for (const tile of r4Scene.waterTiles.filter(({ x, y }) => !bridgeTileKeys.has(`${x},${y}`))) {
    let visibleWater = 0;
    for (let y = tile.y * 32; y < (tile.y + 1) * 32; y += 1) {
      for (let x = tile.x * 32; x < (tile.x + 1) * 32; x += 1) {
        if (new Set(["deep-aqua", "shallow-aqua"]).has(tokenAt(x, y))) visibleWater += 1;
      }
    }
    assert.ok(visibleWater >= 80,
      `canonical water tile ${tile.x},${tile.y} needs >=80 visible aqua pixels (${visibleWater})`);
    const centerX = tile.x * 32 + 16;
    const centerY = tile.y * 32 + 16;
    if (!new Set(["deep-aqua", "shallow-aqua"]).has(tokenAt(centerX, centerY))) {
      const occluder = sceneAuthority.landmarkLayers.find(({ x, y, width, height }) => (
        centerX >= x && centerX < x + width && centerY >= y && centerY < y + height
      ));
      assert.ok(occluder && new Set([
        "outline", "mint-dark", "mint-mid", "mineral-stone", "wet-timber", "reed",
      ])
        .has(tokenAt(centerX, centerY)),
      `non-aqua center ${tile.x},${tile.y} requires exact rooted landmark overpaint`);
    }
  }
  assert.ok(water[0].size / (water[0].width * water[0].height) >= 0.35
    && water[0].size / (water[0].width * water[0].height) <= 0.82,
  "spring basin needs a bounded fill and irregular perimeter, not a rectangle or sparse pickup chain");

  const mineralComponents = components(new Set(["mineral-stone"]));
  const mineralPoints = mineralComponents.flatMap(({ points }) => points);
  const shore = { points: mineralPoints };
  const shoreKeys = new Set(mineralPoints.map(([x, y]) => `${x},${y}`));
  assert.ok(mineralComponents.some((component) => component.size >= 300 && touches(component, water[0])),
    "spring needs scene-scale mineral shore/terrace foundation, not loose rocks");
  const shelfBands = [
    { x: 110, y: 300, width: 50, height: 4, expectedPixels: 68 },
    { x: 166, y: 348, width: 46, height: 4, expectedPixels: 76 },
    { x: 72, y: 392, width: 44, height: 4, expectedPixels: 36 },
  ];
  const shelfTokens = new Set(["mineral-stone", "warm-reflection"]);
  assert.deepEqual(shelfBands.map((band) => {
    let pixels = 0;
    for (let y = band.y; y < band.y + band.height; y += 1) {
      for (let x = band.x; x < band.x + band.width; x += 1) {
        if (shelfTokens.has(tokenAt(x, y))) pixels += 1;
      }
    }
    return pixels;
  }), shelfBands.map(({ expectedPixels }) => expectedPixels),
  "three accepted shelf bands must retain their exact source-bound mineral/reflection receipts");
  const waterKeys = new Set(water[0].points.map(([x, y]) => `${x},${y}`));
  const waterPerimeter = water[0].points.filter(([x, y]) => [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .some(([dx, dy]) => !waterKeys.has(`${x + dx},${y + dy}`)));
  const shoredPerimeter = waterPerimeter.filter(([x, y]) => [[-1, 0], [1, 0], [0, -1], [0, 1]]
    .some(([dx, dy]) => shoreKeys.has(`${x + dx},${y + dy}`)));
  assert.ok(shoredPerimeter.length / waterPerimeter.length >= 0.45,
    `mineral shore must border multiple basin sides (${shoredPerimeter.length}/${waterPerimeter.length})`);
  const centerX = water[0].x + water[0].width / 2;
  const centerY = water[0].y + water[0].height / 2;
  const quadrants = [
    ([x, y]) => x < centerX && y < centerY,
    ([x, y]) => x >= centerX && y < centerY,
    ([x, y]) => x < centerX && y >= centerY,
    ([x, y]) => x >= centerX && y >= centerY,
  ].map((predicate) => shoredPerimeter.filter(predicate).length);
  assert.ok(quadrants.every((count) => count >= 24),
    `mineral shore needs substantial witnesses in all four basin quadrants (${quadrants})`);

  const bridgeTiles = r4Scene.bridgeTiles;
  assert.deepEqual(bridgeTiles, [{ x: 3, y: 8 }, { x: 4, y: 8 }, { x: 5, y: 8 }],
    "test derives the exact frozen R4 bridge run before evaluating pixels");
  const timberComponents = components(new Set(["wet-timber"]));
  const bridgeTimberPoints = timberComponents.flatMap(({ points }) => points).filter(([x, y]) => (
    bridgeTiles.some((tile) => x >= tile.x * 32 && x < (tile.x + 1) * 32
      && y >= tile.y * 32 && y < (tile.y + 1) * 32)
  ));
  const bridgeTimberXs = bridgeTimberPoints.map(([x]) => x);
  const bridgeTimberYs = bridgeTimberPoints.map(([, y]) => y);
  const timber = {
    points: bridgeTimberPoints,
    width: Math.max(...bridgeTimberXs) - Math.min(...bridgeTimberXs) + 1,
    height: Math.max(...bridgeTimberYs) - Math.min(...bridgeTimberYs) + 1,
  };
  assert.ok(bridgeTiles.every((tile) => bridgeTimberPoints.filter(([x, y]) => (
    x >= tile.x * 32 && x < (tile.x + 1) * 32
      && y >= tile.y * 32 && y < (tile.y + 1) * 32
  )).length >= 150) && timber.width >= 88 && timber.width <= 128 && timber.height <= 24,
  "one bounded slatted wet-timber boardwalk must occupy all exact R4 bridge tiles");
  const bridgeMinX = Math.min(...bridgeTiles.map(({ x }) => x)) * 32;
  const bridgeMaxX = (Math.max(...bridgeTiles.map(({ x }) => x)) + 1) * 32 - 1;
  const bridgeOutline = {
    points: components(new Set(["outline"])).flatMap(({ points }) => points)
      .filter(([x, y]) => x >= bridgeMinX - 8 && x <= bridgeMaxX + 8 && y >= 256 && y < 304),
  };
  assert.ok(bridgeOutline.points.length >= 48 && touches(bridgeOutline, timber)
    && touches(bridgeOutline, water[0]),
  "the bounded cardinal bridge outline must touch both slatted timber and water");
  const bridgeSilhouette = { points: [...timber.points, ...bridgeOutline.points] };
  const hasShoreContactInBand = (minimumX, maximumX) => bridgeSilhouette.points.some(([x, y]) => (
    x >= minimumX && x <= maximumX
      && [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => shoreKeys.has(`${x + dx},${y + dy}`))
  ));
  assert.equal(hasShoreContactInBand(bridgeMinX - 32, bridgeMinX + 8), true,
    "boardwalk west end must touch the dry mineral bank");
  assert.equal(hasShoreContactInBand(bridgeMaxX - 8, bridgeMaxX + 32), true,
    "boardwalk east end must touch the dry mineral bank");

  const reeds = components(new Set(["reed"])).filter(({ size }) => size >= 24);
  const sceneScaleReeds = reeds.filter(({ size }) => size >= 1_000);
  assert.ok(sceneScaleReeds.length >= 6 && sceneScaleReeds.length <= 12,
    `spring needs several scene-scale planted habitats, received ${sceneScaleReeds.map(({ size }) => size)}`);
  assert.ok(sceneScaleReeds.some(({ y }) => y < 172)
    && sceneScaleReeds.some((habitat) => touches(habitat, water[0]) || touches(habitat, shore)),
  "reed anatomy must span both the deep upper verge and rooted wet terrace habitat");

  const willowPlacements = sceneAuthority.landmarkLayers
    .filter(({ role }) => role === "bank-willow" || role === "bank-willow-return");
  assert.equal(willowPlacements.length, 2);
  for (const willow of willowPlacements) {
    const rootPoints = [];
    for (let y = willow.y + 72; y < willow.y + willow.height; y += 1) {
      for (let x = willow.x; x < willow.x + willow.width; x += 1) {
        if (tokenAt(x, y) === "wet-timber") rootPoints.push([x, y]);
      }
    }
    assert.ok(rootPoints.length >= 100, `${willow.clusterId} needs a substantial rooted trunk/flare`);
    assert.ok(rootPoints.some(([x, y]) => [[-1, 0], [1, 0], [0, -1], [0, 1]]
      .some(([dx, dy]) => shoreKeys.has(`${x + dx},${y + dy}`))),
    `${willow.clusterId} root alpha must touch the measured mineral shore`);
  }

  const yardTokens = new Map();
  for (let y = 288; y < 448; y += 1) for (let x = 496; x < 688; x += 1) {
    const token = tokenAt(x, y);
    yardTokens.set(token, (yardTokens.get(token) ?? 0) + 1);
  }
  assert.ok((yardTokens.get("mineral-stone") ?? 0) >= 1_200,
    "occupied yard needs a broad wet-stone base rather than scattered yard props");
  assert.ok((yardTokens.get("mint-dark") ?? 0) + (yardTokens.get("wet-timber") ?? 0) >= 500,
    "a waterless damp runnel/terrace return must visibly enter the occupied yard without aqua mechanics drift");

  const connectivity = productionPacker.measureRegionalR5SceneConnectivity(result.connectivityInputs);
  assert.equal(connectivity.clusterCount, 8);
  assert.equal(connectivity.supportCount, 16);
  assert.deepEqual(connectivity.errors, []);
  const landmarkErrors = Array.from({ length: 8 }, (_unused, cell) => {
    const atlas = authoring.rawMasters[`${spring}-landmarks`];
    const rawCell = { data: Buffer.alloc(128 * 128 * 4), width: 128, height: 128, channels: 4 };
    const sourceX = cell % 4 * 128;
    const sourceY = Math.floor(cell / 4) * 128;
    for (let y = 0; y < 128; y += 1) atlas.data.copy(
      rawCell.data, y * 128 * 4, ((sourceY + y) * atlas.width + sourceX) * 4,
      ((sourceY + y) * atlas.width + sourceX + 128) * 4,
    );
    return validateLandmarkMaterialDepth(rawCell, `${spring}/landmark-${cell}`);
  });
  assert.deepEqual(landmarkErrors, Array.from({ length: 8 }, () => []),
    "all eight spring landmarks need complete multi-material readable anatomy");
});

test("Task12R R5 spring complete proof adds entrance depth without changing the accepted 22-file closure", async () => {
  const kit = "spring-terraces";
  const contract = REGIONAL_R5_MECHANICS_BINDINGS.entranceDepth;
  assert.equal(Object.hasOwn(contract.frontPatchRgbaSha256, kit), true);
  const components = await productionPacker.buildRegionalR5CompleteProofComponents({
    kit,
    sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
  });
  const shelter = components.humanWitnesses.find(({ placement }) => placement.role === "shelter-door");
  assert.deepEqual({
    x: shelter.placement.x - components.homeActor.placement.x,
    y: shelter.placement.y - components.homeActor.placement.y,
  }, { x: 80, y: 63 });
  assert.deepEqual({ x: shelter.placement.x, y: shelter.placement.y }, { x: 608, y: 367 });
  assert.deepEqual(shelter.feet, { x: 632, y: 428 });
  assert.deepEqual(REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit].home.doorCenterPx, { x: 592, y: 400 });
  assert.notDeepEqual(shelter.feet, REGIONAL_R5_MECHANICS_BINDINGS.scenePlans[kit].home.doorCenterPx,
    "presentation apron stays explicitly separate from the unchanged mechanical door center");
  const depth = productionPacker.buildRegionalR5EntranceDepthLayers({
    kit, width: 768, height: 512, components,
  });
  assert.deepEqual(productionPacker.regionalR5AlphaComponentSizes(depth.contactShadows), [80, 80, 80]);
  const scene = await productionPacker.buildRegionalR5CompleteProofScene({
    kit,
    authoring: await regionalR5Authoring(),
    sourceBuffers: regionalR5CompleteProofSourceBuffers(kit),
  });
  assert.equal(scene.proofOnly, true);
  assert.equal(scene.published, false);
  assert.equal(scene.productionHuman.patchRgbaSha256,
    "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e");
  assert.equal(components.homeActor.sourceLayer.atlasSha256,
    "4f827b042cb4fa7164fe43bc9fedbc518ca2a3fd6799914fe78746ee32a2a14c");
  assert.equal(components.homeActor.sourceLayer.rgbaSha256,
    "de645288e44e455f5d430e9de8b592f6dc6119bda96a56e1721717ef41f8adf8");
  assert.equal(components.homeActor.proofRgbaSha256,
    "b6daf61464f18fa94598487a8af1d8686711d386c39f91b29920585cc41f1951");
  assert.equal(createHash("sha256").update(components.homeActor.patch.data).digest("hex"),
    "166fbbf26bf4880c93748c4c1e2b187e650c030a271ccfbb716ddef5ff0837ee");
  assert.equal(scene.homeActor.proofRgbaSha256,
    REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
      .find(({ kitId }) => kitId === kit).homeActorRgbaSha256);
  assert.equal(createHash("sha256").update(components.homeActor.frontPatch.data).digest("hex"),
    contract.frontPatchRgbaSha256[kit]);
  assert.equal(contract.frontPatchRgbaSha256[kit],
    "b6400e4091d702d78a94958e3b6dea8516e31cdf10ae33de7a214731ee75371e");
  assert.deepEqual(components.homeActor.sourceLayer, {
    slot: "homeComponents",
    atlasId: `${kit}-home-components`,
    atlasSha256: REGIONAL_R5_MECHANICS_BINDINGS.visualProofBindings.homeActorProofs.kitProofs
      .find(({ kitId }) => kitId === kit).componentAtlasPngSha256,
    rgbaSha256: components.homeActor.sourceLayer.rgbaSha256,
    width: 768,
    height: 512,
  }, "spring HomeActor source identity and geometry stay exact");
  assert.deepEqual(components.productionHuman.sourceLayers.map(({ atlasId, atlasSha256, cellIndex }) => (
    { atlasId, atlasSha256, cellIndex }
  )), REGIONAL_R5_MECHANICS_BINDINGS.productionHuman.layers.map(({ atlasId, atlasSha256, cellIndex }) => (
    { atlasId, atlasSha256, cellIndex }
  )), "spring human uses the exact four canonical source atlases and cells");
  assert.equal(createHash("sha256").update(scene.raw.data).digest("hex"),
    "dc8a5656adf625c1d70a86f1a3671f5ca9eebe1db3efc2f307f404d02e7731e3",
  "complete production composition must preserve the accepted V10 visual bytes");
  assert.equal(createHash("sha256").update(scene.buffer).digest("hex"),
    "c996bb888cfe99226cc2feb3458eb70ebd0fa4f21f4fb1cc60f4f0e89e154354",
  "complete production PNG encoding must remain deterministic");
  assert.equal(scene.layers["home-underlay"].rgbaSha256,
    "beb5a93104402fbeb3d333dcc9d653df94c24cd7038bc3ab4539aa959515904c",
  "the proof-only vent context must remain behind the immutable HomeActor");

  let portalOverlap = 0;
  const human = components.productionHuman.patch;
  for (let y = 0; y < human.height; y += 1) for (let x = 0; x < human.width; x += 1) {
    if (human.data[(y * human.width + x) * 4 + 3] === 0) continue;
    const localX = shelter.placement.x + x - components.homeActor.placement.x;
    const localY = shelter.placement.y + y - components.homeActor.placement.y;
    if (localX >= contract.portal.x && localX < contract.portal.x + contract.portal.width
        && localY >= contract.portal.y && localY < contract.portal.y + contract.portal.height) portalOverlap += 1;
  }
  assert.equal(portalOverlap, 0);
  const intersects = (patch) => components.humanWitnesses.reduce((count, witness) => {
    for (let y = 0; y < patch.height; y += 1) for (let x = 0; x < patch.width; x += 1) {
      if (patch.data[(y * patch.width + x) * 4 + 3] === 0) continue;
      const offset = ((witness.placement.y + y) * depth.homeForeground.width
        + witness.placement.x + x) * 4;
      if (depth.homeForeground.data[offset + 3] !== 0) count += 1;
    }
    return count;
  }, 0);
  assert.equal(intersects(human), 0, "spring foreground must overlap no human pixels at the separated apron");
  assert.equal(intersects(components.productionHuman.facePatch), 0, "spring foreground must overlap no face alpha");
  assert.equal(intersects(components.productionHuman.hairPatch), 0, "spring foreground must overlap no hair alpha");
  assert.equal(productionPacker.regionalR5CompleteProofArtifactNames().length, 22,
    "accepted ash/neutral Task 4 artifact closure remains frozen while spring stays in memory");
});

test("Task12R R5 complete proof artifacts build exact 22-file closure without publishing evidence", async () => {
  assert.equal(typeof productionPacker.buildRegionalR5CompleteProofArtifacts, "function");
  assert.equal(typeof productionPacker.regionalR5CompleteProofArtifactNames, "function");
  const authoring = await regionalR5Authoring();
  const sourceBuffersByKit = {
    "ash-waste": await regionalR5CompleteProofSourceBuffers("ash-waste"),
    "neutral-temperate": await regionalR5CompleteProofSourceBuffers("neutral-temperate"),
  };
  const expectedNames = [
    ...["ash-waste", "neutral-temperate"].flatMap((kit) => (
      ["terrain", "scenery", "landmarks", "yards", "composed"].flatMap((family) => [
        `task12r-r5-keyscene-${kit}-${family}-native-1x.png`,
        `task12r-r5-keyscene-${kit}-${family}-nearest-2x.png`,
      ])
    )),
    "task12r-r5-keyscene-ash-risk-first-composed.png",
    "task12r-r5-keyscene-manifest.json",
  ].sort();
  assert.equal(expectedNames.length, 22);
  assert.deepEqual(productionPacker.regionalR5CompleteProofArtifactNames(), expectedNames);
  const before = await regionalR5PublicationSnapshot();
  const result = await productionPacker.buildRegionalR5CompleteProofArtifacts({ authoring, sourceBuffersByKit });
  assert.deepEqual(result.inventory, expectedNames);
  assert.deepEqual(Object.keys(result.artifacts), expectedNames);
  assert.equal(result.manifest.schema, "regional-r5-complete-proof-artifacts/v1");
  assert.equal(result.manifest.proofOnly, true);
  assert.equal(result.manifest.published, false);
  assert.equal(result.manifest.artifacts.length, 21, "manifest describes every raster; the 22nd artifact is itself");
  for (const [name, bytes] of Object.entries(result.artifacts)) {
    if (name.endsWith(".png")) assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  }
  assert.equal(await regionalR5PublicationSnapshot(), before,
    "successful in-memory proof produces no runtime, native, or evidence files");
});
