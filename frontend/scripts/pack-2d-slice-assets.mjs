import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";
import tileInventory from "../shared/tile-inventory.json" with { type: "json" };

const PNG = { palette: true, colours: 128, dither: 0, compressionLevel: 9 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const SOURCE_PROFILES = Object.freeze({
  body: { label: "body", width: 1536, height: 1024, rows: 7, posesPerRow: 10, sha256: "ac4ac195879eda9ca0b4454a9ffa526668c0ecc0a2b31dbab9b650dc7a5ebb0c" },
  face: { label: "face", width: 1536, height: 1024, columns: 8, sha256: "badb14b7d996c4ce6e08ff773786380418db856f3b10af4916151f6878cbd910" },
  held: { label: "held", width: 1774, height: 887, columns: 8, sha256: "2b595933ff742636ded1c14537e9c25eafe62506bfcf152751833f1fdb9fadfa" },
  tiles: { label: "tile", width: 1254, height: 1254, columns: 8, rows: 8, sha256: "ceff45732c9b0749764abffec3d2a3c50d75533d81e7905151428657be47538d" },
  shelter: { label: "shelter", width: 1254, height: 1254, columns: 5, rows: 4, guideInset: 9, regularRows: 3, finalBreaks: [0, 250, 500, 855, 1254] },
});
const ATLAS_SPECS = Object.freeze({
  "nirvana-tile-atlas.png": { width: 256, height: 256, cellWidth: 32, cellHeight: 32, columns: 8, rows: 8, expectedEmpty: [63], gutter: 0 },
  "human-body-atlas.png": { width: 672, height: 512, cellWidth: 48, cellHeight: 64, columns: 14, rows: 8,
    expectedEmpty: [
      ...Array.from({ length: 3 }, (_unused, row) => Array.from({ length: 4 }, (_blank, column) => (row + 4) * 14 + column + 10)).flat(),
      ...Array.from({ length: 14 }, (_unused, column) => 7 * 14 + column),
    ], gutter: 1 },
  "human-face-atlas.png": { width: 384, height: 256, cellWidth: 48, cellHeight: 64, columns: 8, rows: 4,
    expectedEmpty: Array.from({ length: 8 }, (_unused, column) => 16 + column), gutter: 1 },
  "human-held-atlas.png": { width: 384, height: 64, cellWidth: 48, cellHeight: 64, columns: 8, rows: 1, expectedEmpty: [0, 7], gutter: 1 },
  "shelter-slice-atlas.png": { width: 640, height: 512, cellWidth: 128, cellHeight: 128, columns: 5, rows: 4, expectedEmpty: [19], gutter: 2 },
});

export const TILE_INVENTORY = Object.freeze([...tileInventory]);

const encode = (pipeline) => pipeline.png(PNG).toBuffer();
const blank = (width, height) => sharp({ create: { width, height, channels: 4, background: TRANSPARENT } }).png().toBuffer();

async function stitch(cells, columns, cellWidth, cellHeight) {
  if (cells.length === 0 || cells.length % columns !== 0) throw new Error("Atlas cells must fill a complete grid");
  const rows = cells.length / columns;
  return encode(sharp({ create: { width: columns * cellWidth, height: rows * cellHeight, channels: 4, background: TRANSPARENT } }).composite(
    cells.map((input, index) => ({ input, left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight })),
  ));
}

async function assertDimensions(source, [expectedWidth, expectedHeight], label) {
  const metadata = await sharp(source).metadata();
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new Error(`Unexpected ${label} source dimensions ${metadata.width}x${metadata.height}; expected ${expectedWidth}x${expectedHeight}`);
  }
  return metadata;
}

function assertReviewedSource(source, profile) {
  const actual = createHash("sha256").update(source).digest("hex");
  if (actual !== profile.sha256) throw new Error(`Unexpected reviewed ${profile.label} source fingerprint ${actual}; expected ${profile.sha256}`);
}

const profileDimensions = (profile) => [profile.width, profile.height];

async function gridCells(source, grid, outputWidth, outputHeight, cropWidth = grid.cellWidth) {
  await assertDimensions(source, [grid.columns * grid.cellWidth, grid.rows * grid.cellHeight], "strict-grid");
  if (cropWidth > grid.cellWidth || cropWidth / grid.cellHeight !== outputWidth / outputHeight) throw new Error("Source crop aspect ratio does not match native output");
  const cells = [];
  const offsetX = Math.floor((grid.cellWidth - cropWidth) / 2);
  for (let row = 0; row < grid.rows; row += 1) for (let column = 0; column < grid.columns; column += 1) {
    cells.push(await encode(sharp(source).extract({ left: column * grid.cellWidth + offsetX, top: row * grid.cellHeight, width: cropWidth, height: grid.cellHeight }).resize(outputWidth, outputHeight, { kernel: "nearest" })));
  }
  return cells;
}

export async function packTileAtlas(source, grid) {
  return stitch(await gridCells(source, grid, 32, 32), grid.columns, 32, 32);
}

export async function packHumanLayers({ bodySource, faceSource, heldSource, bodyGrid, overlayGrid, faceGrid = overlayGrid }) {
  const body = await stitch(await gridCells(bodySource, bodyGrid, 48, 64, 96), bodyGrid.columns, 48, 64);
  const face = await stitch(await gridCells(faceSource, faceGrid, 48, 64), faceGrid.columns, 48, 64);
  const held = await stitch(await gridCells(heldSource, overlayGrid, 48, 64), overlayGrid.columns, 48, 64);
  return { body, face, held };
}

export async function packShelterAtlas(source, grid = { columns: 5, rows: 4, cellWidth: 256, cellHeight: 256 }) {
  return stitch(await gridCells(source, grid, 128, 128), grid.columns, 128, 128);
}

const normalizedChromaDistance = (red, green, blue) => {
  const scale = Math.max(red, green, blue);
  return scale === 0 ? Number.POSITIVE_INFINITY : Math.hypot(red / scale - 1, green / scale, blue / scale - 1);
};
const isChromaResidue = (red, green, blue) => Math.max(red, blue) >= 50 && normalizedChromaDistance(red, green, blue) <= 0.43;

export async function scanChromaResidue(source) {
  const { data } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let count = 0;
  const samples = [];
  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] > 8 && isChromaResidue(data[index], data[index + 1], data[index + 2])) {
      count += 1;
      if (samples.length < 8) samples.push([data[index], data[index + 1], data[index + 2], data[index + 3]]);
    }
  }
  return { count, samples };
}

export async function cleanupChroma(source) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const removed = new Uint8Array(info.width * info.height);
  for (let index = 0; index < data.length; index += 4) {
    const red = data[index]; const green = data[index + 1]; const blue = data[index + 2];
    if (isChromaResidue(red, green, blue)) {
      data[index] = 0; data[index + 1] = 0; data[index + 2] = 0; data[index + 3] = 0; removed[index / 4] = 1;
    }
  }
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const pixel = y * info.width + x; const index = pixel * 4;
    if (data[index + 3] === 0) continue;
    let adjacentToKey = false;
    for (let dy = -1; dy <= 1 && !adjacentToKey; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nearX = x + dx; const nearY = y + dy;
      if (nearX >= 0 && nearY >= 0 && nearX < info.width && nearY < info.height && removed[nearY * info.width + nearX]) { adjacentToKey = true; break; }
    }
    if (!adjacentToKey) continue;
    const red = data[index]; const green = data[index + 1]; const blue = data[index + 2]; const distance = normalizedChromaDistance(red, green, blue);
    if (distance > 0.43 && distance <= 0.58) {
      const spill = Math.max(0, Math.min(red, blue) - green);
      data[index] = Math.max(green, red - spill);
      data[index + 2] = Math.max(green, blue - spill);
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function alphaBounds(source) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1; let pixels = 0;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    if (data[(y * info.width + x) * 4 + 3] <= 8) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); pixels += 1;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1, pixels };
}

async function alphaComponents(source) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const visited = new Uint8Array(info.width * info.height); const components = [];
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const seed = y * info.width + x;
    if (visited[seed] || data[seed * 4 + 3] <= 8) continue;
    const stack = [seed]; const pixels = []; visited[seed] = 1;
    let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1;
    while (stack.length) {
      const pixel = stack.pop(); const py = Math.floor(pixel / info.width); const px = pixel % info.width;
      pixels.push(pixel); minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nearX = px + dx; const nearY = py + dy;
        if (nearX < 0 || nearY < 0 || nearX >= info.width || nearY >= info.height) continue;
        const near = nearY * info.width + nearX;
        if (visited[near] || data[near * 4 + 3] <= 8) continue;
        visited[near] = 1; stack.push(near);
      }
    }
    components.push({ pixels, bounds: { minX, minY, maxX, maxY, width: maxX - minX + 1, height: maxY - minY + 1 } });
  }
  components.sort((left, right) => right.pixels.length - left.pixels.length);
  return { data, info, components };
}

async function removeDetachedUpperComponents(source, label) {
  const { data, info, components } = await alphaComponents(source);
  const main = components[0];
  if (!main) throw new Error(`${label} unexpectedly contains no connected artwork`);
  for (const component of components.slice(1)) {
    if (component.bounds.maxY >= main.bounds.minY) continue;
    for (const pixel of component.pixels) {
      const offset = pixel * 4;
      data[offset] = 0; data[offset + 1] = 0; data[offset + 2] = 0; data[offset + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function normalizedCell(source, rect, width, height, padding = 4, alignBottom = false, label = "cell") {
  const metadata = await sharp(source).metadata();
  if (!metadata.width || !metadata.height || rect.left < 0 || rect.top < 0 || rect.width <= 0 || rect.height <= 0
    || rect.left + rect.width > metadata.width || rect.top + rect.height > metadata.height) throw new Error(`${label} extraction is outside source geometry`);
  const cropped = await sharp(source).extract(rect).png().toBuffer();
  const bounds = await alphaBounds(cropped);
  if (!bounds) throw new Error(`${label} unexpectedly contains no artwork`);
  const trimmed = await sharp(cropped).extract({ left: bounds.minX, top: bounds.minY, width: bounds.width, height: bounds.height }).png().toBuffer();
  const innerWidth = width - padding * 2; const innerHeight = height - padding * 2;
  const scale = Math.min(innerWidth / bounds.width, innerHeight / bounds.height);
  const targetWidth = Math.max(1, Math.round(bounds.width * scale)); const targetHeight = Math.max(1, Math.round(bounds.height * scale));
  const resized = await sharp(trimmed).resize(targetWidth, targetHeight, { kernel: "nearest" }).png().toBuffer();
  return encode(sharp({ create: { width, height, channels: 4, background: TRANSPARENT } }).composite([{
    input: resized, left: Math.floor((width - targetWidth) / 2), top: alignBottom ? height - padding - targetHeight : Math.floor((height - targetHeight) / 2),
  }]));
}

async function alignFeet(source, targetX = 48, targetY = 123) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let maxY = -1; let overallMinX = info.width; let overallMaxX = -1;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) if (data[(y * info.width + x) * 4 + 3] > 8) {
    maxY = y; overallMinX = Math.min(overallMinX, x); overallMaxX = Math.max(overallMaxX, x);
  }
  if (maxY < 0) throw new Error("Body cell unexpectedly contains no artwork");
  let minX = info.width; let maxX = -1;
  for (let y = Math.max(0, maxY - 4); y <= maxY; y += 1) for (let x = 0; x < info.width; x += 1) if (data[(y * info.width + x) * 4 + 3] > 8) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
  }
  let shiftX = Math.round(targetX - (minX + maxX) / 2); const shiftY = targetY - maxY;
  shiftX = Math.max(4 - overallMinX, Math.min(info.width - 5 - overallMaxX, shiftX));
  const output = Buffer.alloc(data.length);
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
    const toX = x + shiftX; const toY = y + shiftY;
    if (toX < 0 || toY < 0 || toX >= info.width || toY >= info.height) continue;
    data.copy(output, (toY * info.width + toX) * 4, (y * info.width + x) * 4, (y * info.width + x + 1) * 4);
  }
  return sharp(output, { raw: info }).png().toBuffer();
}

async function detectBodyRects(source, profile) {
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = [];
  for (let row = 0; row < profile.rows; row += 1) {
    const top = Math.floor(row * info.height / profile.rows); const bottom = Math.floor((row + 1) * info.height / profile.rows);
    const activeColumns = [];
    for (let x = 0; x < info.width; x += 1) {
      let occupied = 0;
      for (let y = top; y < bottom; y += 1) if (data[(y * info.width + x) * 4 + 3] > 8) occupied += 1;
      if (occupied > 2) activeColumns.push(x);
    }
    const groups = [];
    for (const x of activeColumns) {
      const last = groups.at(-1);
      if (!last || x - last[1] > 8) groups.push([x, x]); else last[1] = x;
    }
    if (groups.length !== profile.posesPerRow) throw new Error(`Expected ${profile.posesPerRow} body poses in source row ${row}; found ${groups.length}`);
    rows.push(groups.map(([left, right]) => ({ left: Math.max(0, left - 8), top, width: Math.min(info.width, right + 9) - Math.max(0, left - 8), height: bottom - top })));
  }
  return rows;
}

export async function repairProductionBody(source) {
  const profile = SOURCE_PROFILES.body;
  await assertDimensions(source, profileDimensions(profile), profile.label);
  assertReviewedSource(source, profile);
  const alpha = await cleanupChroma(source);
  const sourceRects = await detectBodyRects(alpha, profile);
  const sourceCell = async (row, column) => {
    const label = `body row ${row} source pose ${column}`; const rect = sourceRects[row][column];
    const cropped = await sharp(alpha).extract(rect).png().toBuffer();
    const filtered = await removeDetachedUpperComponents(cropped, label);
    return alignFeet(await normalizedCell(filtered, {
      left: 0, top: 0, width: rect.width, height: rect.height,
    }, 96, 128, 3, true, label));
  };
  const reauthor = async (input, mode, facingRow) => {
    const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const output = Buffer.alloc(data.length); const sign = facingRow === 1 ? -1 : 1;
    for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) {
      const sourceOffset = (y * info.width + x) * 4;
      if (data[sourceOffset + 3] <= 8) continue;
      let dx = 0; let dy = 0;
      if (mode === "breath" && y >= 28 && y < 92) dy = -2;
      if (mode === "gait" && y >= 82) dx = sign * 2;
      if (mode === "turn" && y < 94) dx = sign * 2;
      if (mode === "turn-back" && y < 82) dx = -sign * 2;
      if (mode === "brake" && y < 98) { dx = -sign * 2; dy = 1; }
      if (mode === "settle" && y < 72) { dx = sign * 2; dy = 2; }
      const targetX = x + dx; const targetY = y + dy;
      if (targetX < 0 || targetY < 0 || targetX >= info.width || targetY >= info.height) continue;
      data.copy(output, (targetY * info.width + targetX) * 4, sourceOffset, sourceOffset + 4);
    }
    return sharp(output, { raw: info }).png().toBuffer();
  };
  const plans = [
    [0, 1, 9, [0, "breath"], 2, 3, 4, 5, 6, 7, 8, [8, "turn"], [4, "brake"], [9, "settle"]],
    [0, 1, 5, [0, "breath"], 2, 3, 4, 7, 9, [2, "gait"], 6, [6, "turn"], 8, [8, "settle"]],
    [0, 1, 9, [0, "breath"], 2, 3, 4, 5, 6, 7, 8, [8, "turn"], [4, "brake"], [9, "settle"]],
    [5, 6, 7, [5, "breath"], 1, 2, 3, 4, 8, [1, "gait"], [7, "turn"], [6, "turn-back"], 9, [9, "settle"]],
  ];
  const cells = [];
  for (let row = 0; row < 8; row += 1) for (let column = 0; column < 14; column += 1) {
    if (row === 7 || (row >= 4 && column >= 10)) { cells.push(await blank(128, 128)); continue; }
    let content;
    if (row < 4) {
      const entry = plans[row][column]; const sourceColumn = Array.isArray(entry) ? entry[0] : entry;
      content = await sourceCell(row, sourceColumn);
      if (Array.isArray(entry)) content = await reauthor(content, entry[1], row);
    } else {
      const sourceColumn = row === 4 ? [5, 6, 7, 5, 6, 7, 5, 6, 7, 5][column] : column;
      content = await sourceCell(row, sourceColumn);
    }
    cells.push(await encode(sharp({ create: { width: 128, height: 128, channels: 4, background: TRANSPARENT } }).composite([{ input: content, left: 16, top: 0 }])));
  }
  return stitch(cells, 14, 128, 128);
}

async function authoredCell(source, rect, { maxWidth, maxHeight, centerX = 48, bottomY = 96, label }) {
  const crop = await sharp(source).extract(rect).png().toBuffer();
  const bounds = await alphaBounds(crop);
  if (!bounds) throw new Error(`${label} contains no reviewed artwork`);
  const trimmed = await sharp(crop).extract({ left: bounds.minX, top: bounds.minY, width: bounds.width, height: bounds.height }).png().toBuffer();
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale)); const height = Math.max(1, Math.round(bounds.height * scale));
  const resized = await sharp(trimmed).resize(width, height, { kernel: "nearest" }).png().toBuffer();
  const left = Math.max(0, Math.min(96 - width, Math.round(centerX - width / 2))); const top = Math.max(0, Math.min(128 - height, bottomY - height));
  return encode(sharp({ create: { width: 96, height: 128, channels: 4, background: TRANSPARENT } }).composite([{ input: resized, left, top }]));
}

const FACE_SOURCE_X = [[42, 197], [227, 383], [415, 569], [600, 757], [784, 939], [967, 1122], [1160, 1321], [1341, 1497]];
const FACE_EXPRESSIONS = ["neutral", "blink_1", "blink_2", "talk_1", "talk_2", "weary", "hurt", "recovery"];
const FACE_DIRECTIONS = ["south", "west", "north", "east"];
const HELD_SOURCE_RECTS = [
  { left: 307, top: 358, width: 154, height: 174 }, { left: 531, top: 358, width: 151, height: 174 },
  { left: 747, top: 363, width: 162, height: 160 }, { left: 976, top: 316, width: 117, height: 203 },
  { left: 1166, top: 312, width: 134, height: 210 }, { left: 1377, top: 390, width: 136, height: 126 },
];

const FACE_COLORS = {
  skin: [243, 173, 110, 255], shadow: [222, 151, 96, 255], ink: [16, 6, 11, 255], light: [248, 228, 184, 255],
};

function authoredFaceRaw(expression, direction) {
  const pixels = Buffer.alloc(48 * 64 * 4);
  const pixel = (x, y, color) => {
    if (x < 0 || x >= 48 || y < 0 || y >= 64) return;
    pixels.set(color, (y * 48 + x) * 4);
  };
  const horizontal = (x, y, width, color) => { for (let offset = 0; offset < width; offset += 1) pixel(x + offset, y, color); };
  if (direction === "north") return pixels;

  if (direction === "south") {
    for (let y = 20; y <= 28; y += 1) {
      const inset = y === 20 || y === 28 ? 1 : 0;
      horizontal(18 + inset, y, 12 - inset * 2, y >= 27 ? FACE_COLORS.shadow : FACE_COLORS.skin);
    }
    pixel(20, 21, FACE_COLORS.shadow); pixel(27, 21, FACE_COLORS.shadow);
    if (expression === "blink_1" || expression === "blink_2") {
      horizontal(20, 23, 3, FACE_COLORS.ink); horizontal(25, 23, 3, FACE_COLORS.ink);
    } else {
      pixel(21, expression === "weary" ? 24 : 23, FACE_COLORS.ink);
      pixel(26, expression === "weary" ? 24 : 23, FACE_COLORS.ink);
      if (expression !== "hurt") { pixel(21, 22, FACE_COLORS.light); pixel(26, 22, FACE_COLORS.light); }
    }
    if (expression === "hurt") {
      pixel(20, 22, FACE_COLORS.ink); pixel(22, 24, FACE_COLORS.ink);
      pixel(22, 22, FACE_COLORS.ink); pixel(20, 24, FACE_COLORS.ink);
    }
    if (expression === "talk_1") horizontal(23, 26, 2, FACE_COLORS.ink);
    else if (expression === "talk_2") { horizontal(22, 26, 4, FACE_COLORS.ink); horizontal(23, 27, 2, FACE_COLORS.ink); }
    else if (expression === "weary" || expression === "hurt") horizontal(22, 27, 4, FACE_COLORS.ink);
    else if (expression === "recovery") { pixel(22, 26, FACE_COLORS.ink); horizontal(23, 27, 3, FACE_COLORS.ink); }
    else horizontal(22, 26, 4, FACE_COLORS.ink);
    return pixels;
  }

  for (let y = 20; y <= 28; y += 1) {
    const inset = y === 20 || y === 28 ? 1 : 0;
    horizontal(17 + inset, y, 7 - inset, y >= 27 ? FACE_COLORS.shadow : FACE_COLORS.skin);
  }
  pixel(16, 24, FACE_COLORS.skin);
  if (expression === "blink_1" || expression === "blink_2") horizontal(18, 23, 3, FACE_COLORS.ink);
  else {
    pixel(19, expression === "weary" ? 24 : 23, FACE_COLORS.ink);
    if (expression !== "hurt") pixel(19, 22, FACE_COLORS.light);
  }
  if (expression === "hurt") { pixel(18, 22, FACE_COLORS.ink); pixel(20, 24, FACE_COLORS.ink); pixel(20, 22, FACE_COLORS.ink); pixel(18, 24, FACE_COLORS.ink); }
  if (expression === "talk_2") { horizontal(17, 26, 3, FACE_COLORS.ink); pixel(18, 27, FACE_COLORS.ink); }
  else if (expression === "talk_1") horizontal(17, 26, 2, FACE_COLORS.ink);
  else if (expression === "weary" || expression === "hurt") horizontal(18, 27, 3, FACE_COLORS.ink);
  else horizontal(17, 26, 3, FACE_COLORS.ink);
  return pixels;
}

async function faceCellFromSource(source, index, direction) {
  const [left, right] = FACE_SOURCE_X[index];
  if (right <= left || !(await alphaBounds(source))) throw new Error(`face expression ${index} contains no reviewed artwork`);
  const expression = FACE_EXPRESSIONS[index];
  const authoredDirection = direction === "east" ? "west" : direction;
  const raw = authoredFaceRaw(expression, authoredDirection);
  const native = sharp(raw, { raw: { width: 48, height: 64, channels: 4 } });
  const oriented = direction === "east" ? native.flop() : native;
  return encode(oriented.resize(96, 128, { kernel: "nearest" }));
}

async function heldCellFromSource(source, index) {
  if (index === 0 || index === 7) return blank(96, 128);
  const centers = [48, 48, 48, 78, 75, 61]; const bottoms = [124, 124, 124, 116, 116, 124]; const heights = [60, 60, 60, 56, 58, 60];
  return authoredCell(source, HELD_SOURCE_RECTS[index - 1], {
    maxWidth: 68, maxHeight: heights[index - 1], centerX: centers[index - 1], bottomY: bottoms[index - 1], label: `held object ${index}`,
  });
}

export async function repairProductionOverlay(kind, source) {
  if (kind !== "face" && kind !== "held") throw new Error(`Unknown overlay kind ${kind}`);
  const profile = SOURCE_PROFILES[kind];
  await assertDimensions(source, profileDimensions(profile), profile.label);
  assertReviewedSource(source, profile);
  const cleaned = await cleanupChroma(source);
  if (!(await alphaBounds(cleaned))) throw new Error(`${kind} source unexpectedly contains no artwork`);
  const cells = kind === "face"
    ? await Promise.all(FACE_DIRECTIONS.flatMap((direction) => FACE_EXPRESSIONS.map((_expression, index) => faceCellFromSource(cleaned, index, direction))))
    : await Promise.all(Array.from({ length: 8 }, (_, index) => heldCellFromSource(cleaned, index)));
  return stitch(cells, 8, 96, 128);
}

const TERRAIN_X = [21, 185, 346, 507, 667, 827, 988];
const TERRAIN_Y = [18, 179, 335, 481];
const terrainRect = (row, column) => ({ left: TERRAIN_X[column] + 7, top: TERRAIN_Y[row] + 7, width: 128, height: row === 2 ? 112 : 122 });
const TRANSITION_DIRECTIONS = [["E", "W"], ["N", "S"], ["N", "E"], ["E", "S"], ["S", "W"], ["W", "N"], ["N", "E", "S", "W"], []];

async function terrainTexture(source, rect) {
  return sharp(source).extract(rect).resize(32, 32, { kernel: "nearest" }).ensureAlpha().raw().toBuffer();
}

const organicMask = (directions, variant) => {
  const mask = new Uint8Array(32 * 32); const has = (direction) => directions.includes(direction);
  const wave = (position) => position <= 1 || position >= 30 ? 0 : [0, 1, 0, -1, 0, 0, 1, -1][Math.floor(position / 3) % 8];
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const dx = x - 15.5; const dy = y - 15.5; const wobble = ((x * 7 + y * 11 + variant * 13) % 17) < 4 ? 0.8 : 0;
    let inside = dx * dx / (7.2 + wobble) ** 2 + dy * dy / (6.8 + wobble) ** 2 <= 1;
    if (has("N") && y <= 17 && Math.abs(x - (15.5 + wave(y))) <= (y < 2 ? 4.5 : 5.3)) inside = true;
    if (has("S") && y >= 14 && Math.abs(x - (15.5 + wave(31 - y))) <= (y > 29 ? 4.5 : 5.3)) inside = true;
    if (has("W") && x <= 17 && Math.abs(y - (15.5 + wave(x))) <= (x < 2 ? 4.5 : 5.3)) inside = true;
    if (has("E") && x >= 14 && Math.abs(y - (15.5 + wave(31 - x))) <= (x > 29 ? 4.5 : 5.3)) inside = true;
    if (inside) mask[y * 32 + x] = 255;
  }
  return mask;
};

const dilateMask = (mask, radius = 1) => {
  const output = new Uint8Array(mask.length);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    for (let dy = -radius; dy <= radius && !output[y * 32 + x]; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const px = x + dx; const py = y + dy;
      if (px >= 0 && py >= 0 && px < 32 && py < 32 && mask[py * 32 + px]) { output[y * 32 + x] = 255; break; }
    }
  }
  return output;
};

function copyPixel(to, toPixel, from, fromPixel) { from.copy(to, toPixel * 4, fromPixel * 4, fromPixel * 4 + 4); }

async function organicTransitionCell(ground, material, rim, directions, variant, rimWidth = 1) {
  const inner = organicMask(directions, variant); const outer = dilateMask(inner, rimWidth); const output = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
    const pixel = y * 32 + x; const shifted = ((y + variant * 3) % 32) * 32 + ((x + variant * 5) % 32);
    copyPixel(output, pixel, inner[pixel] ? material : outer[pixel] ? rim : ground, shifted);
  }
  const edgePixel = (x, y, direction) => {
    const lateral = direction === "E" || direction === "W" ? y : x; const connected = directions.includes(direction);
    const portal = connected && lateral >= 10 && lateral <= 21; const innerPortal = connected && lateral >= 11 && lateral <= 20;
    const source = innerPortal ? material : portal ? rim : ground; const sourcePixel = (direction === "E" || direction === "W") ? lateral * 32 + 16 : 16 * 32 + lateral;
    copyPixel(output, y * 32 + x, source, sourcePixel);
  };
  for (let i = 0; i < 32; i += 1) { edgePixel(0, i, "W"); edgePixel(31, i, "E"); edgePixel(i, 0, "N"); edgePixel(i, 31, "S"); }
  return encode(sharp(output, { raw: { width: 32, height: 32, channels: 4 } }));
}

const PROP_RECTS = [
  { left: 364, top: 805, width: 97, height: 98 }, { left: 686, top: 803, width: 82, height: 103 },
  { left: 181, top: 1113, width: 72, height: 72 }, { left: 31, top: 1114, width: 101, height: 74 },
  { left: 43, top: 660, width: 93, height: 93 }, { left: 189, top: 644, width: 124, height: 117 },
  { left: 829, top: 633, width: 111, height: 139 }, { left: 992, top: 633, width: 130, height: 147 },
  { left: 221, top: 812, width: 53, height: 88 }, { left: 979, top: 816, width: 87, height: 89 },
  { left: 745, top: 1141, width: 91, height: 51 }, { left: 61, top: 956, width: 40, height: 83 },
  { left: 568, top: 951, width: 140, height: 90 }, { left: 193, top: 936, width: 40, height: 108 },
  { left: 415, top: 956, width: 84, height: 85 }, { left: 764, top: 959, width: 86, height: 81 },
  { left: 921, top: 959, width: 137, height: 86 }, { left: 568, top: 951, width: 140, height: 90 },
  { left: 921, top: 959, width: 137, height: 86 }, { left: 415, top: 956, width: 84, height: 85 },
  { left: 568, top: 951, width: 140, height: 90 }, { left: 745, top: 1141, width: 91, height: 51 },
  { left: 31, top: 1114, width: 101, height: 74 }, { left: 21, top: 335, width: 146, height: 127 },
  { left: 830, top: 799, width: 97, height: 107 }, { left: 346, top: 481, width: 137, height: 136 },
  { left: 67, top: 816, width: 54, height: 83 },
];

export async function repairProductionTiles(source) {
  const profile = SOURCE_PROFILES.tiles;
  await assertDimensions(source, profileDimensions(profile), profile.label);
  assertReviewedSource(source, profile);
  const cleaned = await cleanupChroma(source); if (!(await alphaBounds(cleaned))) throw new Error("tile source unexpectedly contains no artwork");
  const [ground, pathTexture, waterTexture, shoreTexture] = await Promise.all([
    terrainTexture(cleaned, terrainRect(0, 0)), terrainTexture(cleaned, { left: 700, top: 211, width: 70, height: 70 }),
    terrainTexture(cleaned, { left: 40, top: 497, width: 110, height: 105 }), terrainTexture(cleaned, { left: 1020, top: 500, width: 82, height: 100 }),
  ]);
  const native = [];
  for (let index = 0; index < 8; index += 1) {
    const cell = index < 7 ? await encode(sharp(cleaned).extract(terrainRect(0, index)).resize(32, 32, { kernel: "nearest" })) : await encode(sharp(cleaned).extract(terrainRect(0, 0)).flop().resize(32, 32, { kernel: "nearest" }));
    native.push(cell);
  }
  for (let variant = 0; variant < 8; variant += 1) native.push(await organicTransitionCell(ground, pathTexture, shoreTexture, TRANSITION_DIRECTIONS[variant], variant));
  for (let variant = 0; variant < 8; variant += 1) native.push(await organicTransitionCell(ground, waterTexture, shoreTexture, TRANSITION_DIRECTIONS[variant], variant + 8));
  for (let variant = 0; variant < 8; variant += 1) native.push(await organicTransitionCell(ground, waterTexture, shoreTexture, TRANSITION_DIRECTIONS[variant], variant + 16, 2));
  for (let index = 0; index < 4; index += 1) native.push(await encode(sharp(cleaned).extract(terrainRect(2, index)).resize(32, 32, { kernel: "nearest" })));
  for (const [offset, rect] of PROP_RECTS.entries()) {
    if (offset >= 27) break;
    native.push(await normalizedCell(cleaned, rect, 32, 32, 2, true, `tile prop ${TILE_INVENTORY[36 + offset]}`));
  }
  native.push(await blank(32, 32));
  if (native.length !== 64) throw new Error(`Reviewed tile inventory produced ${native.length} cells; expected 64`);
  const cells = await Promise.all(native.map((cell) => sharp(cell).resize(128, 128, { kernel: "nearest" }).png().toBuffer()));
  return stitch(cells, 8, 128, 128);
}

export async function repairProductionShelter(source) {
  const profile = SOURCE_PROFILES.shelter;
  await assertDimensions(source, profileDimensions(profile), profile.label);
  const alpha = await cleanupChroma(source); const cells = []; const regularHeight = Math.floor(profile.height * profile.regularRows / profile.rows);
  for (let row = 0; row < profile.regularRows; row += 1) for (let column = 0; column < profile.columns; column += 1) {
    const left = Math.floor(column * profile.width / profile.columns); const right = Math.floor((column + 1) * profile.width / profile.columns);
    const top = Math.floor(row * regularHeight / profile.regularRows); const bottom = Math.floor((row + 1) * regularHeight / profile.regularRows);
    cells.push(await normalizedCell(alpha, { left: left + profile.guideInset, top: top + profile.guideInset, width: right - left - profile.guideInset * 2, height: bottom - top - profile.guideInset * 2 }, 256, 256, 10, false, `shelter row ${row} column ${column}`));
  }
  const last = profile.finalBreaks.slice(0, -1).map((left, index) => [left, profile.finalBreaks[index + 1]]);
  for (const [index, [left, right]] of last.entries()) cells.push(await normalizedCell(alpha, { left: left + profile.guideInset, top: regularHeight + profile.guideInset, width: right - left - profile.guideInset * 2, height: profile.height - regularHeight - profile.guideInset * 2 }, 256, 256, 10, false, `shelter final row ${index}`));
  cells.push(await blank(256, 256));
  return stitch(cells, 5, 256, 256);
}

export async function validateOccupancy(atlas, { cellWidth, cellHeight, columns, rows, frameIndices, gutter = 0, expectedEmpty = [] }) {
  const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== columns * cellWidth || info.height !== rows * cellHeight) throw new Error("Atlas dimensions do not match its cell grid");
  if (!Number.isInteger(gutter) || gutter < 0 || gutter * 2 >= Math.min(cellWidth, cellHeight)) throw new Error("Cell gutter must be a non-negative integer smaller than half the cell");
  const selected = frameIndices ?? Array.from({ length: columns * rows }, (_, index) => index);
  const expectedEmptySet = new Set(expectedEmpty); const anchors = []; const cells = []; const overflowFrames = []; const unexpectedOccupied = []; const unexpectedEmpty = [];
  for (const frameIndex of selected) {
    const row = Math.floor(frameIndex / columns); const column = frameIndex % columns;
    if (row < 0 || row >= rows || column < 0 || column >= columns) throw new Error(`Frame index ${frameIndex} is outside the ${columns}x${rows} atlas grid`);
    let minX = cellWidth; let minY = cellHeight; let maxX = -1; let maxY = -1; let occupiedPixels = 0; let overflow = false;
    for (let y = 0; y < cellHeight; y += 1) for (let x = 0; x < cellWidth; x += 1) {
      const alpha = data[((row * cellHeight + y) * info.width + column * cellWidth + x) * 4 + 3];
      if (alpha <= 8) continue;
      occupiedPixels += 1; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x < gutter || y < gutter || x >= cellWidth - gutter || y >= cellHeight - gutter) overflow = true;
    }
    if (overflow) overflowFrames.push(frameIndex);
    if (expectedEmptySet.has(frameIndex) && occupiedPixels > 0) unexpectedOccupied.push(frameIndex);
    if (!expectedEmptySet.has(frameIndex) && occupiedPixels === 0) unexpectedEmpty.push(frameIndex);
    cells.push({ frame: frameIndex, occupied: occupiedPixels > 0, pixels: occupiedPixels, bounds: occupiedPixels > 0 ? { minX, minY, maxX, maxY } : null, gutter, overflow });
    if (maxY >= 0) {
      let minFootX = cellWidth; let maxFootX = -1;
      for (let y = Math.max(0, maxY - 3); y <= maxY; y += 1) for (let x = 0; x < cellWidth; x += 1) {
        if (data[((row * cellHeight + y) * info.width + column * cellWidth + x) * 4 + 3] > 8) { minFootX = Math.min(minFootX, x); maxFootX = Math.max(maxFootX, x); }
      }
      anchors.push({ frame: frameIndex, x: (minFootX + maxFootX) / 2, y: maxY });
    }
  }
  const reference = anchors[0] ?? { x: 0, y: 0 };
  const maxFeetDrift = anchors.reduce((max, point) => Math.max(max, Math.abs(point.x - reference.x), Math.abs(point.y - reference.y)), 0);
  const chroma = await scanChromaResidue(atlas);
  return { alphaBleed: chroma.count > 0, chromaResidue: chroma, cellOverflow: overflowFrames.length > 0, maxFeetDrift, anchors, cells, overflowFrames, unexpectedOccupied, unexpectedEmpty };
}

const rgbaEdge = async (atlas, frame, side, columns = 8, cellWidth = 32, cellHeight = 32) => {
  const { data, info } = await sharp(atlas).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const row = Math.floor(frame / columns); const column = frame % columns; const edge = [];
  if (side === "east" || side === "west") for (let y = 0; y < cellHeight; y += 1) {
    const x = side === "east" ? cellWidth - 1 : 0; const offset = ((row * cellHeight + y) * info.width + column * cellWidth + x) * 4; edge.push(...data.subarray(offset, offset + 4));
  } else for (let x = 0; x < cellWidth; x += 1) {
    const y = side === "south" ? cellHeight - 1 : 0; const offset = ((row * cellHeight + y) * info.width + column * cellWidth + x) * 4; edge.push(...data.subarray(offset, offset + 4));
  }
  return Buffer.from(edge);
};

export async function validateTransitionSeams(atlas) {
  const pairs = [
    [8, "east", 8, "west", "path horizontal"], [9, "north", 9, "south", "path vertical"], [10, "east", 8, "west", "path corner east"], [10, "north", 9, "south", "path corner north"],
    [16, "east", 16, "west", "water horizontal"], [17, "north", 17, "south", "water vertical"], [18, "east", 16, "west", "water corner east"], [18, "north", 17, "south", "water corner north"],
    [24, "east", 24, "west", "shore horizontal"], [25, "north", 25, "south", "shore vertical"], [26, "east", 24, "west", "shore corner east"], [26, "north", 25, "south", "shore corner north"],
  ];
  const issues = [];
  for (const [a, sideA, b, sideB, label] of pairs) if (!(await rgbaEdge(atlas, a, sideA)).equals(await rgbaEdge(atlas, b, sideB))) issues.push(label);
  return { issues, pairs: pairs.map(([a, sideA, b, sideB, label]) => ({ a, sideA, b, sideB, label })) };
}

async function atlasCell(atlas, index, columns, cellWidth, cellHeight) {
  return sharp(atlas).extract({ left: (index % columns) * cellWidth, top: Math.floor(index / columns) * cellHeight, width: cellWidth, height: cellHeight }).png().toBuffer();
}

async function artCellMetrics(cell, frame) {
  const { data, info } = await sharp(cell).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set(); const rowSpans = []; const columnSpans = []; let occupied = 0;
  for (let y = 0; y < info.height; y += 1) {
    let first = info.width; let last = -1;
    for (let x = 0; x < info.width; x += 1) { const offset = (y * info.width + x) * 4; if (data[offset + 3] <= 8) continue; occupied += 1; first = Math.min(first, x); last = Math.max(last, x); colors.add(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`); }
    if (last >= 0) rowSpans.push(last - first + 1);
  }
  for (let x = 0; x < info.width; x += 1) {
    let first = info.height; let last = -1;
    for (let y = 0; y < info.height; y += 1) if (data[(y * info.width + x) * 4 + 3] > 8) { first = Math.min(first, y); last = Math.max(last, y); }
    if (last >= 0) columnSpans.push(last - first + 1);
  }
  const bounds = await alphaBounds(cell); const rectangleArea = bounds ? bounds.width * bounds.height : 0;
  return { frame, bounds, occupied, colors: colors.size, fillRatio: rectangleArea ? occupied / rectangleArea : 0,
    distinctRowSpans: new Set(rowSpans).size, distinctColumnSpans: new Set(columnSpans).size,
    sha256: createHash("sha256").update(await sharp(cell).ensureAlpha().raw().toBuffer()).digest("hex") };
}

export async function validateDirectionalBodyInventory(bodyAtlas) {
  const frameCounts = { idle: 4, walk: 6, turn: 2, stop: 2 };
  const occupancy = await validateOccupancy(bodyAtlas, {
    cellWidth: 48, cellHeight: 64, columns: 14, rows: 8,
    frameIndices: Array.from({ length: 56 }, (_unused, index) => index), gutter: 1,
  });
  const issues = []; const detachedUpperComponents = []; const idleMainHeights = [];
  let minimumAlphaDelta = Number.POSITIVE_INFINITY;
  for (let row = 0; row < 4; row += 1) {
    const images = await Promise.all(Array.from({ length: 14 }, (_unused, column) => atlasCell(bodyAtlas, row * 14 + column, 14, 48, 64)));
    const cells = await Promise.all(images.map((cell) => sharp(cell).ensureAlpha().raw().toBuffer()));
    const hashes = cells.map((cell) => createHash("sha256").update(cell).digest("hex"));
    if (new Set(hashes).size !== 14) issues.push(`direction row ${row} reuses a body frame`);
    for (const [column, image] of images.entries()) {
      const components = (await alphaComponents(image)).components; const main = components[0];
      if (!main) continue;
      if (column === 0) idleMainHeights.push(main.bounds.height);
      for (const component of components.slice(1)) {
        if (component.pixels.length >= 8 && component.bounds.maxY < main.bounds.minY) {
          detachedUpperComponents.push({ frame: row * 14 + column, pixels: component.pixels.length, bounds: component.bounds });
        }
      }
    }
    for (let left = 0; left < cells.length; left += 1) for (let right = left + 1; right < cells.length; right += 1) {
      let alphaDelta = 0;
      for (let offset = 3; offset < cells[left].length; offset += 4) if (cells[left][offset] !== cells[right][offset]) alphaDelta += 1;
      minimumAlphaDelta = Math.min(minimumAlphaDelta, alphaDelta);
    }
  }
  if (minimumAlphaDelta < 16) issues.push(`directional poses differ by only ${minimumAlphaDelta} alpha pixels`);
  if (occupancy.cellOverflow) issues.push(`directional body cells overflow their native gutters: ${occupancy.overflowFrames.join(",")}`);
  if (occupancy.unexpectedEmpty.length) issues.push(`directional body cells are empty: ${occupancy.unexpectedEmpty.join(",")}`);
  if (occupancy.maxFeetDrift > 2) issues.push(`directional feet drift ${occupancy.maxFeetDrift} exceeds two pixels`);
  const maxIdleHeightDrift = idleMainHeights.length > 0 ? Math.max(...idleMainHeights) - Math.min(...idleMainHeights) : Number.POSITIVE_INFINITY;
  if (detachedUpperComponents.length) issues.push(`directional body cells contain ${detachedUpperComponents.length} detached upper components`);
  if (maxIdleHeightDrift > 2) issues.push(`directional idle body height drift ${maxIdleHeightDrift} exceeds two pixels`);
  return {
    issues, frameCounts, distinctFramesPerDirection: 14, minimumAlphaDelta,
    maxFeetDrift: occupancy.maxFeetDrift, anchors: occupancy.anchors,
    detachedUpperComponents, idleMainHeights, maxIdleHeightDrift,
  };
}

export async function validateHeldInventory(heldAtlas) {
  const labels = ["basket", "wood-bundle", "stone-bundle", "hammer-raised", "hammer-contact", "reach-hand"]; const cells = [];
  for (let frame = 1; frame <= 6; frame += 1) cells.push(await artCellMetrics(await atlasCell(heldAtlas, frame, 8, 48, 64), frame));
  const issues = [];
  for (const [index, cell] of cells.entries()) {
    if (!cell.bounds || cell.colors < 7) issues.push(`${labels[index]} lacks an outline and multi-shade material ramp`);
    if (cell.fillRatio > 0.9 || cell.distinctRowSpans < 3 || cell.distinctColumnSpans < 3) issues.push(`${labels[index]} collapsed to rectangle/bar geometry`);
  }
  if (new Set(cells.map((cell) => cell.sha256)).size !== cells.length) issues.push("held object silhouettes are not unique");
  return { issues, labels, cells };
}

export async function validateTileArt(atlas) {
  const issues = []; const transitionCells = []; const representativeCells = [];
  for (const frame of [8, 10, 16, 18, 24, 26]) {
    const metrics = await artCellMetrics(await atlasCell(atlas, frame, 8, 32, 32), frame); transitionCells.push(metrics);
    if (metrics.colors < 4) issues.push(`${TILE_INVENTORY[frame]} lacks source-derived terrain/rim shades`);
  }
  for (const frame of [36, 38, 40, 42, 45, 46, 60]) {
    const metrics = await artCellMetrics(await atlasCell(atlas, frame, 8, 32, 32), frame); representativeCells.push(metrics);
    if (metrics.colors < 3) issues.push(`${TILE_INVENTORY[frame]} lacks outline and material shades`);
    if (metrics.fillRatio > 0.92 || metrics.distinctRowSpans < 3 || metrics.distinctColumnSpans < 3) issues.push(`${TILE_INVENTORY[frame]} collapsed to placeholder geometry`);
  }
  if (atlas.length < 8_000) issues.push(`tile atlas encoded size ${atlas.length} indicates visual-detail collapse`);
  return { issues, transitionCells, representativeCells, sourcePalette: 15, encodedBytes: atlas.length };
}

export async function composeTerrainProof(atlas) {
  const width = 320; const height = 192; const composites = [];
  for (let y = 0; y < 6; y += 1) for (let x = 0; x < 10; x += 1) composites.push({ input: await atlasCell(atlas, (x + y * 3) % 8, 8, 32, 32), left: x * 32, top: y * 32 });
  const placed = [
    [8, 0, 2], [8, 1, 2], [10, 2, 2], [9, 2, 3], [9, 2, 4],
    [23, 6, 0], [16, 7, 0], [16, 8, 0], [18, 9, 0], [17, 6, 1], [23, 7, 1], [23, 8, 1], [17, 9, 1],
    [26, 6, 2], [24, 7, 2], [24, 8, 2], [27, 9, 2],
    [40, 0, 0], [41, 4, 0], [42, 5, 3], [43, 9, 4], [36, 1, 1], [37, 4, 4], [38, 3, 1], [39, 8, 4], [45, 0, 4], [46, 5, 5], [60, 9, 3], [61, 7, 1],
  ];
  for (const [frame, x, y] of placed) composites.push({ input: await atlasCell(atlas, frame, 8, 32, 32), left: x * 32, top: y * 32 });
  return encode(sharp({ create: { width, height, channels: 4, background: TRANSPARENT } }).composite(composites));
}

export async function validateDirectionalFaceInventory(faceAtlas) {
  const metadata = await sharp(faceAtlas).metadata();
  const issues = [];
  if (metadata.width !== 384 || metadata.height !== 256) {
    issues.push(`directional face atlas must be 384x256, received ${metadata.width}x${metadata.height}`);
    return { issues, cells: [], northOpaquePixels: 0, mirroredProfiles: false };
  }
  const cells = [];
  let northOpaquePixels = 0;
  for (const [row, direction] of FACE_DIRECTIONS.entries()) for (const [column, expression] of FACE_EXPRESSIONS.entries()) {
    const cell = await atlasCell(faceAtlas, row * 8 + column, 8, 48, 64);
    const bounds = await alphaBounds(cell);
    const raw = await sharp(cell).ensureAlpha().raw().toBuffer();
    let opaquePixels = 0;
    for (let offset = 3; offset < raw.length; offset += 4) if (raw[offset] > 8) opaquePixels += 1;
    cells.push({ direction, expression, bounds, opaquePixels });
    if (direction === "north") {
      northOpaquePixels += opaquePixels;
      if (opaquePixels > 0) issues.push(`north/${expression} must be transparent, found ${opaquePixels} opaque pixels`);
    } else if (!bounds) {
      issues.push(`${direction}/${expression} contains no facial features`);
    } else if (bounds.width > 14 || bounds.height > 12 || bounds.pixels > 120) {
      issues.push(`${direction}/${expression} is a full-head-sized overlay (${bounds.width}x${bounds.height}, ${bounds.pixels} pixels)`);
    }
  }
  let mirroredProfiles = true;
  for (let column = 0; column < FACE_EXPRESSIONS.length; column += 1) {
    const [west, east] = await Promise.all([
      atlasCell(faceAtlas, 8 + column, 8, 48, 64),
      atlasCell(faceAtlas, 24 + column, 8, 48, 64),
    ]);
    const [mirrored, eastRaw] = await Promise.all([
      sharp(west).flop().ensureAlpha().raw().toBuffer(),
      sharp(east).ensureAlpha().raw().toBuffer(),
    ]);
    if (!mirrored.equals(eastRaw)) {
      mirroredProfiles = false;
      issues.push(`west/east ${FACE_EXPRESSIONS[column]} profiles are not exact mirrors`);
    }
  }
  return { issues, cells, northOpaquePixels, mirroredProfiles };
}

export async function composeDirectionalFaceProof(bodyAtlas, faceAtlas) {
  const expressionColumns = [0, 2, 4];
  const composites = [];
  for (let row = 0; row < FACE_DIRECTIONS.length; row += 1) for (let column = 0; column < expressionColumns.length; column += 1) {
    const [body, face] = await Promise.all([
      atlasCell(bodyAtlas, row * 14, 14, 48, 64),
      atlasCell(faceAtlas, row * 8 + expressionColumns[column], 8, 48, 64),
    ]);
    composites.push(await encode(sharp({ create: { width: 48, height: 64, channels: 4, background: TRANSPARENT } }).composite([
      { input: body }, { input: face },
    ])));
  }
  return stitch(composites, 3, 48, 64);
}

export async function validateOverlayAlignment(bodyAtlas, faceAtlas, heldAtlas) {
  const [body, face, held] = await Promise.all([atlasCell(bodyAtlas, 0, 14, 48, 64), atlasCell(faceAtlas, 0, 8, 48, 64), atlasCell(heldAtlas, 1, 8, 48, 64)]);
  const [bodyBounds, faceBounds, heldBounds] = await Promise.all([alphaBounds(body), alphaBounds(face), alphaBounds(held)]);
  const issues = [];
  if (!bodyBounds || !faceBounds || !heldBounds) issues.push("composite proof requires body, face, and held pixels");
  if (faceBounds && (faceBounds.width > 20 || faceBounds.height > 20 || faceBounds.minY > 30 || faceBounds.maxY >= 34)) issues.push("face overlay exceeds the shared head-space anchor");
  if (heldBounds && (heldBounds.width > 34 || heldBounds.height > 30 || heldBounds.pixels > 750)) issues.push("held overlay obscures the actor body");
  const heldInventory = await validateHeldInventory(heldAtlas); issues.push(...heldInventory.issues);
  const bodyFrames = [0, 0, 0, 56, 57, 58]; const composites = []; const heldFrames = [];
  const faceRaw = await sharp(face).ensureAlpha().raw().toBuffer();
  for (let frame = 1; frame <= 6; frame += 1) {
    const [pose, object] = await Promise.all([atlasCell(bodyAtlas, bodyFrames[frame - 1], 14, 48, 64), atlasCell(heldAtlas, frame, 8, 48, 64)]);
    const heldRaw = await sharp(object).ensureAlpha().raw().toBuffer(); let faceIntersection = 0;
    for (let pixel = 0; pixel < 48 * 64; pixel += 1) if (faceRaw[pixel * 4 + 3] > 8 && heldRaw[pixel * 4 + 3] > 8) faceIntersection += 1;
    if (faceIntersection) issues.push(`held frame ${frame} intersects face by ${faceIntersection} pixels`);
    const proof = await encode(sharp({ create: { width: 48, height: 64, channels: 4, background: TRANSPARENT } }).composite([{ input: pose }, { input: face }, { input: object }]));
    composites.push(proof); heldFrames.push({ frame, faceIntersection, metrics: heldInventory.cells[frame - 1] });
  }
  const composite = await stitch(composites, 6, 48, 64);
  return { issues, bodyBounds, faceBounds, heldBounds, heldFrames, composite };
}

const labelSvg = (width, text) => Buffer.from(`<svg width="${width}" height="28" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202634"/><text x="8" y="19" fill="#f4eedf" font-family="sans-serif" font-size="14">${text.replaceAll("&", "and")}</text></svg>`);

export async function writeContactSheet(items) {
  const nativeX = 16; const doubleX = 720; const mobileX = 2100; const width = 2506; const height = 4800;
  const composites = [
    { input: labelSvg(640, "Native 1x - complete inventory"), left: nativeX, top: 8 },
    { input: labelSvg(1280, "Exact 2x - nearest neighbour"), left: doubleX, top: 8 },
    { input: labelSvg(390, "Mobile 390x844 - complete inventory"), left: mobileX, top: 8 },
    { input: await encode(sharp({ create: { width: 390, height: 844, channels: 4, background: "#9dad59" } })), left: mobileX, top: 40 },
  ];
  let nativeY = 48; let doubleY = 48; let mobileY = 72; const mobileInventory = {};
  for (const item of items) {
    const meta = await sharp(item.buffer).metadata();
    if (!meta.width || !meta.height) throw new Error(`${item.label} has no image geometry`);
    composites.push({ input: labelSvg(Math.min(640, meta.width), `${item.label} (${item.columns ?? 1}x${item.rows ?? 1})`), left: nativeX, top: nativeY });
    composites.push({ input: item.buffer, left: nativeX, top: nativeY + 28 });
    composites.push({ input: labelSvg(Math.min(1280, meta.width * 2), `${item.label} exact 2x`), left: doubleX, top: doubleY });
    composites.push({ input: await encode(sharp(item.buffer).resize(meta.width * 2, meta.height * 2, { kernel: "nearest" })), left: doubleX, top: doubleY + 28 });
    const scale = item.mobileScale ?? 1; const mobileWidth = Math.max(1, Math.round(meta.width * scale)); const mobileHeight = Math.max(1, Math.round(meta.height * scale));
    composites.push({ input: labelSvg(Math.min(330, mobileWidth), item.label), left: mobileX + 30, top: mobileY });
    composites.push({ input: await encode(sharp(item.buffer).resize(mobileWidth, mobileHeight, { kernel: "nearest" })), left: mobileX + 30, top: mobileY + 28 });
    mobileInventory[item.label] = (item.columns ?? 1) * (item.rows ?? 1);
    nativeY += meta.height + 44; doubleY += meta.height * 2 + 44; mobileY += mobileHeight + 34;
  }
  if (nativeY > height || doubleY > height || mobileY > 884) throw new Error(`Contact sheet inventory does not fit: native=${nativeY}, double=${doubleY}, mobile=${mobileY}`);
  const buffer = await encode(sharp({ create: { width, height, channels: 4, background: "#151b26" } }).composite(composites));
  return { buffer, panels: ["Native 1x", "Exact 2x", "Mobile 390x844"], mobileInventory };
}

export async function buildValidationReport(outputs, overlayAlignment, sheet, transitionSeams) {
  const atlases = {};
  for (const [name, buffer] of outputs) {
    const spec = ATLAS_SPECS[name]; if (!spec) throw new Error(`Unknown runtime atlas ${name}`);
    const metadata = await sharp(buffer).metadata();
    if (metadata.width !== spec.width || metadata.height !== spec.height) throw new Error(`${name} has ${metadata.width}x${metadata.height}; expected ${spec.width}x${spec.height}`);
    const occupancy = await validateOccupancy(buffer, spec);
    const chroma = await scanChromaResidue(buffer);
    atlases[name] = { width: metadata.width, height: metadata.height, compressedBytes: buffer.length, decodedBytes: metadata.width * metadata.height * 4,
      chromaResidue: chroma.count, alphaBleed: occupancy.alphaBleed, cellOverflow: occupancy.cellOverflow, overflowFrames: occupancy.overflowFrames,
      unexpectedOccupied: occupancy.unexpectedOccupied, unexpectedEmpty: occupancy.unexpectedEmpty, maxFeetDrift: occupancy.maxFeetDrift, anchors: occupancy.anchors };
  }
  const walkFrames = [4, 5, 6, 7, 8, 9, 18, 19, 20, 21, 22, 23, 32, 33, 34, 35, 36, 37, 46, 47, 48, 49, 50, 51];
  const humanBody = outputs.find(([name]) => name === "human-body-atlas.png")?.[1];
  const humanHeld = outputs.find(([name]) => name === "human-held-atlas.png")?.[1];
  const humanFace = outputs.find(([name]) => name === "human-face-atlas.png")?.[1];
  const tileAtlas = outputs.find(([name]) => name === "nirvana-tile-atlas.png")?.[1];
  const walk = await validateOccupancy(humanBody, { ...ATLAS_SPECS["human-body-atlas.png"], frameIndices: walkFrames, expectedEmpty: [] });
  const directionalBody = await validateDirectionalBodyInventory(humanBody);
  const directionalFace = await validateDirectionalFaceInventory(humanFace);
  const heldArt = await validateHeldInventory(humanHeld); const tileArt = await validateTileArt(tileAtlas);
  const totals = Object.values(atlases).reduce((sum, item) => ({ compressedBytes: sum.compressedBytes + item.compressedBytes, decodedBytes: sum.decodedBytes + item.decodedBytes }), { compressedBytes: 0, decodedBytes: 0 });
  const failures = [];
  for (const [name, item] of Object.entries(atlases)) {
    if (item.chromaResidue) failures.push(`${name}: chroma residue ${item.chromaResidue}`);
    if (item.cellOverflow) failures.push(`${name}: cell overflow`);
    if (item.unexpectedOccupied.length || item.unexpectedEmpty.length) failures.push(`${name}: inventory mismatch`);
  }
  if (walk.maxFeetDrift > 2) failures.push(`walk feet drift ${walk.maxFeetDrift}`);
  failures.push(...directionalBody.issues, ...directionalFace.issues, ...overlayAlignment.issues, ...heldArt.issues, ...tileArt.issues, ...transitionSeams.issues.map((issue) => `tile seam: ${issue}`));
  return { generatedAt: new Date(0).toISOString(), nativeScaling: "all runtime outputs prepacked at native cell size; nearest-neighbour only", atlases, totals,
    walkFeetAnchors: walk.anchors, maxWalkFeetDrift: walk.maxFeetDrift, directionalBody, directionalFace,
    overlayAlignment: { issues: overlayAlignment.issues, bodyBounds: overlayAlignment.bodyBounds, faceBounds: overlayAlignment.faceBounds, heldBounds: overlayAlignment.heldBounds },
    sourceProvenance: Object.fromEntries(["body", "tiles", "face", "held"].map((name) => [name, {
      sha256: SOURCE_PROFILES[name].sha256,
      dimensions: profileDimensions(SOURCE_PROFILES[name]),
      method: name === "face"
        ? "exact reviewed-source fingerprint plus deterministic direction-aware native facial-feature authoring"
        : "exact reviewed-source fingerprint plus deterministic nearest-neighbour crop/composition",
    }])),
    tileInventory: TILE_INVENTORY, transitionSeams, tileArt, heldArt, contactSheet: { panels: sheet.panels, mobileInventory: sheet.mobileInventory }, failures, passed: failures.length === 0 };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const sourceDir = path.join(root, "scratchpad/2d-slice-art-source"); const outputDir = path.join(root, "frontend/src/assets/renderer2d");
  await mkdir(outputDir, { recursive: true });
  const [tileRaw, bodyRaw, faceRaw, heldRaw, shelterRaw] = await Promise.all([
    readFile(path.join(sourceDir, "nirvana-tiles-source.png")), readFile(path.join(sourceDir, "human-body-source-raw.png")),
    readFile(path.join(sourceDir, "human-face-source-raw.png")), readFile(path.join(sourceDir, "human-held-source-raw.png")), readFile(path.join(sourceDir, "shelter-components-source-raw.png")),
  ]);
  const [strictBody, strictFace, strictHeld, strictTiles, strictShelter] = await Promise.all([
    repairProductionBody(bodyRaw), repairProductionOverlay("face", faceRaw), repairProductionOverlay("held", heldRaw), repairProductionTiles(tileRaw), repairProductionShelter(shelterRaw),
  ]);
  const human = await packHumanLayers({ bodySource: strictBody, faceSource: strictFace, heldSource: strictHeld,
    bodyGrid: { columns: 14, rows: 8, cellWidth: 128, cellHeight: 128 },
    faceGrid: { columns: 8, rows: 4, cellWidth: 96, cellHeight: 128 },
    overlayGrid: { columns: 8, rows: 1, cellWidth: 96, cellHeight: 128 } });
  const tiles = await packTileAtlas(strictTiles, { columns: 8, rows: 8, cellWidth: 128, cellHeight: 128 });
  const shelter = await packShelterAtlas(strictShelter);
  const outputs = [["nirvana-tile-atlas.png", tiles], ["human-body-atlas.png", human.body], ["human-face-atlas.png", human.face], ["human-held-atlas.png", human.held], ["shelter-slice-atlas.png", shelter]];
  const overlayAlignment = await validateOverlayAlignment(human.body, human.face, human.held);
  const transitionSeams = await validateTransitionSeams(tiles);
  const terrainProof = await composeTerrainProof(tiles);
  const directionalFaceProof = await composeDirectionalFaceProof(human.body, human.face);
  const sheetItems = [
    { label: "tiles-labeled-in-report", buffer: tiles, columns: 8, rows: 8, mobileScale: 0.25 },
    { label: "human-body-all-frames", buffer: human.body, columns: 14, rows: 8, mobileScale: 0.25 },
    { label: "human-face-all-frames", buffer: human.face, columns: 8, rows: 4, mobileScale: 0.25 },
    { label: "human-held-all-frames", buffer: human.held, columns: 8, rows: 1, mobileScale: 0.5 },
    { label: "shelter-all-components", buffer: shelter, columns: 5, rows: 4, mobileScale: 0.25 },
    { label: "all-held-composite-proofs", buffer: overlayAlignment.composite, columns: 6, rows: 1, mobileScale: 0.5 },
    { label: "directional-face-composite-proofs", buffer: directionalFaceProof, columns: 3, rows: 4, mobileScale: 0.15 },
    { label: "terrain-prop-style-proof", buffer: terrainProof, columns: 10, rows: 6, mobileScale: 0.25 },
  ];
  const sheet = await writeContactSheet(sheetItems);
  const report = await buildValidationReport(outputs, overlayAlignment, sheet, transitionSeams);
  if (!report.passed) throw new Error(`Runtime art validation failed:\n${report.failures.join("\n")}`);
  await Promise.all(outputs.map(([name, buffer]) => writeFile(path.join(outputDir, name), buffer)));
  await Promise.all([
    writeFile(path.join(sourceDir, "runtime-contact-sheet.png"), sheet.buffer),
    writeFile(path.join(sourceDir, "runtime-validation-report.json"), `${JSON.stringify(report, null, 2)}\n`),
  ]);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
