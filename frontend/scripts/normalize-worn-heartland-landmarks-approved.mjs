/** Deterministic authoring normalizer for the approved Worn Heartland landmark sheet. */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

const SOURCE_PATH = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved-source.png",
  import.meta.url,
);
const OUTPUT_PATH = new URL(
  "../../scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
  import.meta.url,
);

export const AUTHORING_PATHS = deepFreeze({
  source: SOURCE_PATH.href,
  output: OUTPUT_PATH.href,
});

const MASK = "perimeter-connected-near-white-low-chroma";
const cell = (cellIndex, sourceGrid, crop, targetPivot, fit, sourcePivot) => ({
  cell: cellIndex,
  sourceGrid,
  crop,
  mask: MASK,
  layout: {
    targetPivot,
    fit,
    sourcePivot,
    sourcePivotUnit: "fraction",
  },
});

export const WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC = deepFreeze({
  source: {
    path: "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved-source.png",
    width: 1448,
    height: 1086,
    sha256: "a122477bcc11da82b154e044076cde4f5692b652635fc1b8728ff8514fda507c",
  },
  output: {
    path: "scratchpad/2d-production-art/source/imagegen-concepts/worn-heartland-landmarks-approved.png",
    width: 512,
    height: 256,
    columns: 4,
    rows: 2,
    cellWidth: 128,
    cellHeight: 128,
  },
  palette: {
    outline: "#1c1c24",
    "olive-dark": "#5d633d",
    "olive-mid": "#8f9854",
    "olive-light": "#c2c781",
    "ochre-earth": "#aa8652",
    "worn-beige": "#d6c69a",
    timber: "#6f5035",
    "faded-flower": "#c88d7a",
    "hearth-amber": "#e6a45f",
  },
  normalization: {
    background: { minimumChannel: 235, maximumChroma: 12, connectivity: 4 },
    alphaValues: [0, 255],
    transparentRgba: [0, 0, 0, 0],
    resampling: { kernel: "nearest", aspect: "uniform", dithering: false },
    paletteDistance: "minimum-squared-srgb-then-lexical-token",
  },
  cells: [
    cell(0, [0, 0, 362, 543], [11, 134, 339, 354], [64, 112], "tree-contact", [0.5, 1]),
    cell(1, [362, 0, 362, 543], [13, 132, 330, 354], [64, 112], "tree-contact", [0.5, 1]),
    cell(2, [724, 0, 362, 543], [11, 134, 351, 350], [64, 112], "tree-contact", [0.5, 1]),
    cell(3, [1086, 0, 362, 543], [0, 154, 351, 337], [64, 96], "ground-contact", [0.5, 0.75]),
    cell(4, [0, 543, 362, 543], [14, 27, 326, 356], [64, 96], "ground-contact", [0.5, 0.75]),
    cell(5, [362, 543, 362, 543], [8, 59, 342, 321], [64, 96], "ground-contact", [0.5, 0.75]),
    cell(6, [724, 543, 362, 543], [4, 58, 339, 318], [64, 96], "horizontal-ports", [0.5, 0.75]),
    cell(7, [1086, 543, 362, 543], [15, 14, 317, 378], [64, 96], "vertical-ports", [0.5, 0.75]),
  ],
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isBackgroundPixel(rgba, offset, rule) {
  const red = rgba[offset];
  const green = rgba[offset + 1];
  const blue = rgba[offset + 2];
  const minimum = Math.min(red, green, blue);
  const chroma = Math.max(red, green, blue) - minimum;
  return minimum >= rule.minimumChannel && chroma <= rule.maximumChroma;
}

/** Return 1 for authored pixels and 0 for perimeter-connected background pixels. */
export function perimeterForegroundMask(rgba, width, height, rule) {
  if (rgba.length !== width * height * 4) throw new Error("RGBA dimensions do not match the supplied surface");
  if (rule.connectivity !== 4) throw new Error("Only deterministic four-neighbour flood fill is supported");
  const foreground = new Uint8Array(width * height);
  foreground.fill(1);
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const enqueue = (x, y) => {
    const pixel = y * width + x;
    if (visited[pixel] === 1 || !isBackgroundPixel(rgba, pixel * 4, rule)) return;
    visited[pixel] = 1;
    foreground[pixel] = 0;
    queue[tail] = pixel;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (head < tail) {
    const pixel = queue[head];
    head += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x > 0) enqueue(x - 1, y);
    if (x + 1 < width) enqueue(x + 1, y);
    if (y > 0) enqueue(x, y - 1);
    if (y + 1 < height) enqueue(x, y + 1);
  }
  return foreground;
}

function decodeHex(hex) {
  const bytes = Buffer.from(hex.slice(1), "hex");
  if (bytes.length !== 3) throw new Error(`Expected an opaque RGB palette token, received ${hex}`);
  return [bytes[0], bytes[1], bytes[2], 255];
}

function paletteCandidates(palette) {
  return Object.entries(palette)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([token, hex]) => ({ token, rgba: decodeHex(hex) }));
}

function palettePixel(red, green, blue, candidates) {
  let winner = candidates[0];
  let winnerDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const redDelta = red - candidate.rgba[0];
    const greenDelta = green - candidate.rgba[1];
    const blueDelta = blue - candidate.rgba[2];
    const distance = redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
    if (distance < winnerDistance) {
      winner = candidate;
      winnerDistance = distance;
    }
  }
  return winner.rgba;
}

function maskedPaletteCrop(source, sourceWidth, descriptor, mask, palette, backgroundRule) {
  const [gridX, gridY, gridWidth] = descriptor.sourceGrid;
  const [cropX, cropY, cropWidth, cropHeight] = descriptor.crop;
  const output = Buffer.alloc(cropWidth * cropHeight * 4);
  let preservedLowChromaPixels = 0;
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const gridPixel = (cropY + y) * gridWidth + cropX + x;
      const targetOffset = (y * cropWidth + x) * 4;
      if (mask[gridPixel] === 0) continue;
      const sourceOffset = ((gridY + cropY + y) * sourceWidth + gridX + cropX + x) * 4;
      if (isBackgroundPixel(source, sourceOffset, backgroundRule)) preservedLowChromaPixels += 1;
      const mapped = palettePixel(
        source[sourceOffset],
        source[sourceOffset + 1],
        source[sourceOffset + 2],
        palette,
      );
      output.set(mapped, targetOffset);
    }
  }
  return { data: output, width: cropWidth, height: cropHeight, preservedLowChromaPixels };
}

function uniformPlacement(descriptor, output) {
  const [cropWidth, cropHeight] = descriptor.crop.slice(2);
  let scale;
  if (descriptor.layout.fit === "tree-contact") scale = Math.min(120 / cropWidth, 112 / cropHeight);
  else if (descriptor.layout.fit === "horizontal-ports") scale = 128 / cropWidth;
  else if (descriptor.layout.fit === "vertical-ports") scale = 128 / cropHeight;
  else scale = Math.min(128 / cropWidth, 128 / cropHeight);
  const width = Math.max(1, Math.min(128, Math.round(cropWidth * scale)));
  const height = Math.max(1, Math.min(128, Math.round(cropHeight * scale)));
  const [pivotFractionX, pivotFractionY] = descriptor.layout.sourcePivot;
  const [targetPivotX, targetPivotY] = descriptor.layout.targetPivot;
  const left = Math.round(targetPivotX - width * pivotFractionX);
  const top = Math.round(targetPivotY - height * pivotFractionY);
  const column = descriptor.cell % output.columns;
  const row = Math.floor(descriptor.cell / output.columns);
  return {
    width,
    height,
    left: column * output.cellWidth + left,
    top: row * output.cellHeight + top,
    scale,
  };
}

function extractGrid(source, sourceWidth, sourceGrid) {
  const [left, top, width, height] = sourceGrid;
  const output = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceStart = ((top + y) * sourceWidth + left) * 4;
    source.copy(output, y * width * 4, sourceStart, sourceStart + width * 4);
  }
  return output;
}

function alphaOverOpaqueDestination(atlas, atlasWidth, atlasHeight, sprite, placement) {
  for (let y = 0; y < placement.height; y += 1) {
    const targetY = placement.top + y;
    if (targetY < 0 || targetY >= atlasHeight) continue;
    for (let x = 0; x < placement.width; x += 1) {
      const targetX = placement.left + x;
      if (targetX < 0 || targetX >= atlasWidth) continue;
      const sourceOffset = (y * placement.width + x) * 4;
      if (sprite[sourceOffset + 3] === 0) continue;
      const targetOffset = (targetY * atlasWidth + targetX) * 4;
      sprite.copy(atlas, targetOffset, sourceOffset, sourceOffset + 4);
    }
  }
}

/** Normalize the immutable approved source into the review-only 4x2 authoring candidate. */
export async function buildApprovedWornHeartlandLandmarks(sourceBytes) {
  const spec = WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC;
  if (sha256(sourceBytes) !== spec.source.sha256) throw new Error("Approved Worn Heartland source SHA-256 mismatch");
  const { data: source, info } = await sharp(sourceBytes)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== spec.source.width || info.height !== spec.source.height || info.channels !== 4) {
    throw new Error("Approved Worn Heartland source geometry mismatch");
  }

  const atlas = Buffer.alloc(spec.output.width * spec.output.height * 4);
  const candidates = paletteCandidates(spec.palette);
  const receipts = [];
  for (const descriptor of spec.cells) {
    const grid = extractGrid(source, info.width, descriptor.sourceGrid);
    const mask = perimeterForegroundMask(
      grid,
      descriptor.sourceGrid[2],
      descriptor.sourceGrid[3],
      spec.normalization.background,
    );
    const crop = maskedPaletteCrop(
      source,
      info.width,
      descriptor,
      mask,
      candidates,
      spec.normalization.background,
    );
    const placement = uniformPlacement(descriptor, spec.output);
    const resized = await sharp(crop.data, {
      raw: { width: crop.width, height: crop.height, channels: 4 },
    })
      .resize(placement.width, placement.height, { kernel: sharp.kernel.nearest, fit: "fill" })
      .raw()
      .toBuffer();
    alphaOverOpaqueDestination(atlas, spec.output.width, spec.output.height, resized, placement);
    receipts.push(Object.freeze({
      cell: descriptor.cell,
      width: placement.width,
      height: placement.height,
      left: placement.left % spec.output.cellWidth,
      top: placement.top % spec.output.cellHeight,
      targetPivot: descriptor.layout.targetPivot,
      scaleX: placement.scale,
      scaleY: placement.scale,
      kernel: "nearest",
      preservedLowChromaPixels: crop.preservedLowChromaPixels,
    }));
  }
  const png = await sharp(atlas, {
    raw: { width: spec.output.width, height: spec.output.height, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, effort: 10 }).toBuffer();
  return Object.freeze({ png, receipts: Object.freeze(receipts) });
}

/** Write the single review candidate without promoting it into native/runtime packs. */
export async function writeApprovedWornHeartlandLandmarks() {
  const source = await readFile(SOURCE_PATH);
  const { png } = await buildApprovedWornHeartlandLandmarks(source);
  await writeFile(OUTPUT_PATH, png);
  return Object.freeze({
    output: OUTPUT_PATH.href,
    width: WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC.output.width,
    height: WORN_HEARTLAND_LANDMARK_AUTHORING_SPEC.output.height,
    sha256: sha256(png),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const receipt = await writeApprovedWornHeartlandLandmarks();
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
