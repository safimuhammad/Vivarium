import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

const NORMALIZER = new URL(
  "./normalize-worn-heartland-landmarks-approved.mjs",
  import.meta.url,
);

test("the approved Worn Heartland landmark normalizer is a dedicated authoring script", async () => {
  await assert.doesNotReject(access(NORMALIZER));
});

const SOURCE = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved-source.png",
  import.meta.url,
);
const OUTPUT = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
  import.meta.url,
);
const RUNTIME_ATLAS = new URL(
  "../src/assets/renderer2d/regions/worn-heartland/landmarks.png",
  import.meta.url,
);
const NATIVE_ATLAS = new URL(
  "../../scratchpad/2d-production-art/source/native/regions/worn-heartland/landmarks.png",
  import.meta.url,
);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rgbaKey = (red, green, blue, alpha = 255) => `${red},${green},${blue},${alpha}`;

function assertDeepFrozen(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) assertDeepFrozen(child, seen);
}

function cellOffset(cell, x, y, width = 512, cellWidth = 128, cellHeight = 128) {
  const originX = cell % 4 * cellWidth;
  const originY = Math.floor(cell / 4) * cellHeight;
  return ((originY + y) * width + originX + x) * 4;
}

test("authoring authority is immutable and closes source grid, crop, mask, layout, pivots, and palette", async () => {
  const {
    WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC: spec,
  } = await import(NORMALIZER);

  assertDeepFrozen(spec);
  assert.deepEqual(spec.source, {
    path: "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved-source.png",
    width: 1448,
    height: 1086,
    sha256: "a122477bcc11da82b154e044076cde4f5692b652635fc1b8728ff8514fda507c",
  });
  assert.deepEqual(spec.output, {
    path: "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
    width: 512,
    height: 256,
    columns: 4,
    rows: 2,
    cellWidth: 128,
    cellHeight: 128,
  });
  assert.deepEqual(spec.palette, {
    outline: "#1c1c24",
    "olive-dark": "#5d633d",
    "olive-mid": "#8f9854",
    "olive-light": "#c2c781",
    "ochre-earth": "#aa8652",
    "worn-beige": "#d6c69a",
    timber: "#6f5035",
    "faded-flower": "#c88d7a",
    "hearth-amber": "#e6a45f",
  });
  assert.equal(spec.cells.length, 8);
  assert.deepEqual(spec.cells.map(({ cell, sourceGrid, crop, mask, layout }) => ({
    cell,
    sourceGrid,
    crop,
    mask,
    targetPivot: layout.targetPivot,
    fit: layout.fit,
  })), [
    { cell: 0, sourceGrid: [0, 0, 362, 543], crop: [11, 134, 339, 354], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 112], fit: "tree-contact" },
    { cell: 1, sourceGrid: [362, 0, 362, 543], crop: [13, 132, 330, 354], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 112], fit: "tree-contact" },
    { cell: 2, sourceGrid: [724, 0, 362, 543], crop: [11, 134, 351, 350], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 112], fit: "tree-contact" },
    { cell: 3, sourceGrid: [1086, 0, 362, 543], crop: [0, 154, 351, 337], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 96], fit: "ground-contact" },
    { cell: 4, sourceGrid: [0, 543, 362, 543], crop: [14, 27, 326, 356], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 96], fit: "ground-contact" },
    { cell: 5, sourceGrid: [362, 543, 362, 543], crop: [8, 59, 342, 321], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 96], fit: "ground-contact" },
    { cell: 6, sourceGrid: [724, 543, 362, 543], crop: [4, 58, 339, 318], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 96], fit: "horizontal-ports" },
    { cell: 7, sourceGrid: [1086, 543, 362, 543], crop: [15, 14, 317, 378], mask: "perimeter-connected-near-white-low-chroma", targetPivot: [64, 96], fit: "vertical-ports" },
  ]);
  assert.deepEqual(spec.normalization, {
    background: { minimumChannel: 235, maximumChroma: 12, connectivity: 4 },
    alphaValues: [0, 255],
    transparentRgba: [0, 0, 0, 0],
    resampling: { kernel: "nearest", aspect: "uniform", dithering: false },
    paletteDistance: "minimum-squared-srgb-then-lexical-token",
  });
});

test("perimeter flood fill removes connected checkerboard while preserving enclosed white flowers", async () => {
  const { perimeterForegroundMask } = await import(NORMALIZER);
  const width = 7;
  const height = 7;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const paint = (x, y, color) => {
    const offset = (y * width + x) * 4;
    rgba.set(color, offset);
  };
  const outline = [28, 28, 36, 255];
  for (let x = 2; x <= 4; x += 1) {
    paint(x, 2, outline);
    paint(x, 4, outline);
  }
  paint(2, 3, outline);
  paint(4, 3, outline);
  paint(3, 3, [252, 252, 250, 255]);

  const mask = perimeterForegroundMask(rgba, width, height, {
    minimumChannel: 235,
    maximumChroma: 12,
    connectivity: 4,
  });

  assert.equal(mask[0], 0, "perimeter checkerboard is removed");
  assert.equal(mask[3 * width + 3], 1, "enclosed low-chroma flower remains authored");
  assert.equal(mask[2 * width + 3], 1, "flower outline remains authored");
});

test("normalization produces a deterministic hard-alpha palette-closed 4x2 atlas", async () => {
  const {
    WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC: spec,
    buildApprovedWornHeartlandLandmarks,
  } = await import(NORMALIZER);
  const source = await readFile(SOURCE);
  const first = await buildApprovedWornHeartlandLandmarks(source);
  const second = await buildApprovedWornHeartlandLandmarks(source);

  assert.equal(sha256(source), spec.source.sha256);
  assert.equal(sha256(first.png), sha256(second.png));
  assert.deepEqual(first.receipts, second.receipts);
  const { data, info } = await sharp(first.png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual({ width: info.width, height: info.height, channels: info.channels }, {
    width: 512,
    height: 256,
    channels: 4,
  });

  const allowed = new Set(Object.values(spec.palette).map((hex) => {
    const bytes = Buffer.from(hex.slice(1), "hex");
    return rgbaKey(bytes[0], bytes[1], bytes[2]);
  }));
  const alphaValues = new Set();
  const opaqueColors = new Set();
  for (let offset = 0; offset < data.length; offset += 4) {
    alphaValues.add(data[offset + 3]);
    if (data[offset + 3] === 0) {
      assert.deepEqual([...data.subarray(offset, offset + 4)], [0, 0, 0, 0]);
      continue;
    }
    opaqueColors.add(rgbaKey(data[offset], data[offset + 1], data[offset + 2]));
  }
  assert.deepEqual([...alphaValues].sort((left, right) => left - right), [0, 255]);
  assert.equal([...opaqueColors].every((color) => allowed.has(color)), true);
  assert.ok(opaqueColors.size >= 7, "the named palette remains expressive after deterministic mapping");
  assert.ok(first.receipts.every(({ scaleX, scaleY, kernel }) => scaleX === scaleY && kernel === "nearest"));
  assert.ok(first.receipts.reduce((sum, receipt) => sum + receipt.preservedLowChromaPixels, 0) > 0);
});

test("route shoulder cells meet their ports and cell zero has one centered trunk", async () => {
  const {
    WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC: spec,
    buildApprovedWornHeartlandLandmarks,
  } = await import(NORMALIZER);
  const { png } = await buildApprovedWornHeartlandLandmarks(await readFile(SOURCE));
  const { data } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const opaqueAt = (cell, x, y) => data[cellOffset(cell, x, y) + 3] === 255;
  assert.ok(Array.from({ length: 128 }, (_, y) => y).some((y) => opaqueAt(6, 0, y)));
  assert.ok(Array.from({ length: 128 }, (_, y) => y).some((y) => opaqueAt(6, 127, y)));
  assert.ok(Array.from({ length: 128 }, (_, x) => x).some((x) => opaqueAt(7, x, 0)));
  assert.ok(Array.from({ length: 128 }, (_, x) => x).some((x) => opaqueAt(7, x, 127)));

  const timberHex = spec.palette.timber;
  const timber = Buffer.from(timberHex.slice(1), "hex");
  const trunkPixels = [];
  for (let y = 52; y <= 111; y += 1) {
    for (let x = 28; x <= 100; x += 1) {
      const offset = cellOffset(0, x, y);
      if (data[offset] === timber[0] && data[offset + 1] === timber[1] && data[offset + 2] === timber[2]) {
        trunkPixels.push({ x, y });
      }
    }
  }
  assert.ok(trunkPixels.length >= 120, "cell zero retains a substantial single trunk");
  const centerX = trunkPixels.reduce((sum, pixel) => sum + pixel.x, 0) / trunkPixels.length;
  assert.ok(centerX >= 57 && centerX <= 71, `cell zero trunk center ${centerX} must stay near its pivot`);
});

test("the writer has one closed destination and leaves native/runtime atlases byte-identical", async () => {
  const {
    AUTHORING_PATHS,
    writeApprovedWornHeartlandLandmarks,
  } = await import(NORMALIZER);
  assert.deepEqual(AUTHORING_PATHS, { source: SOURCE.href, output: OUTPUT.href });
  assert.equal(Object.isFrozen(AUTHORING_PATHS), true);
  const before = {
    native: sha256(await readFile(NATIVE_ATLAS)),
    runtime: sha256(await readFile(RUNTIME_ATLAS)),
  };
  const receipt = await writeApprovedWornHeartlandLandmarks();
  assert.equal(receipt.output, OUTPUT.href);
  assert.equal(receipt.width, 512);
  assert.equal(receipt.height, 256);
  assert.equal(receipt.sha256, sha256(await readFile(OUTPUT)));
  assert.deepEqual({
    native: sha256(await readFile(NATIVE_ATLAS)),
    runtime: sha256(await readFile(RUNTIME_ATLAS)),
  }, before);
});
