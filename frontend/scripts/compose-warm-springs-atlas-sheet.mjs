/**
 * Composes the CONTACT SHEET for the Warm Springs pilot tile vocabulary.
 *
 * Nothing here invents art. It reads `src/qa/warmSpringsPilot/assets/` and
 * blits the authored frames at 1:1, because a zoomed crop is not evidence.
 *
 * The transition and shoreline strips are painted with the SAME algorithm the
 * scene painter will use - sample the material field at tile CORNERS, fill with
 * the lowest-priority corner material, overlay every higher material with the
 * corner-mask frame keyed by which corners it owns, then lay the shoreline
 * frame where a bank material meets a pool. So the strips are a real test of
 * seam continuity, not a diagram of one.
 *
 * Sections, top to bottom:
 *   A  BASE MATERIALS   - each of the 13 corner-field materials as a 4x4 patch
 *   B  TRANSITIONS      - one strip per material pair, boundary crossing seams
 *   C  SHORELINE        - the w.* sets on each bank material against both pools
 *   D  SCENERY          - every sprite at 1:1 on a neutral mid-grey field
 *
 * Output: docs/frontend/mockups/regions/warm-springs-pilot/atlas-contact-sheet.png
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const ASSETS = path.resolve(FRONTEND_ROOT, "src/qa/warmSpringsPilot/assets");
const OUTPUT_ROOT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/warm-springs-pilot",
);

const TILE = 32;
const BACKGROUND = [18, 18, 22, 255];
const NEUTRAL = [104, 104, 108, 255];
const LABEL = 20;
const PAD = 12;

// ---------------------------------------------------------------------------
// the same deterministic noise the author uses, so the fields look native
// ---------------------------------------------------------------------------

function hash2(x, y, seed) {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + index * 101);
    norm += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------

function createCanvas(width, height, fill) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = fill[0];
    data[index + 1] = fill[1];
    data[index + 2] = fill[2];
    data[index + 3] = fill[3];
  }
  return { width, height, data };
}

function fillRect(canvas, x0, y0, width, height, fill) {
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue;
      const index = (y * canvas.width + x) * 4;
      canvas.data[index] = fill[0];
      canvas.data[index + 1] = fill[1];
      canvas.data[index + 2] = fill[2];
      canvas.data[index + 3] = fill[3];
    }
  }
}

async function rawSheet(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function blit(canvas, sheet, sx, sy, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= canvas.width || ty >= canvas.height) continue;
      const source = ((sy + y) * sheet.width + (sx + x)) * 4;
      const alpha = sheet.data[source + 3] / 255;
      if (alpha <= 0) continue;
      const target = (ty * canvas.width + tx) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        canvas.data[target + channel] = Math.round(
          sheet.data[source + channel] * alpha + canvas.data[target + channel] * (1 - alpha),
        );
      }
      canvas.data[target + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------------------
// the atlas
// ---------------------------------------------------------------------------

async function loadAtlas() {
  const atlas = JSON.parse(await readFile(path.join(ASSETS, "atlas.json"), "utf8"));
  const frames = new Map();
  const { columns, cell, ids } = atlas.terrainGrid;
  ids.forEach((id, index) => {
    frames.set(id, {
      image: "terrain",
      x: (index % columns) * cell,
      y: Math.floor(index / columns) * cell,
      w: cell,
      h: cell,
      px: 0,
      py: 0,
    });
  });
  for (const [id, x, y, w, h, px, py] of atlas.sceneryFrames) {
    frames.set(id, { image: "scenery", x, y, w, h, px, py });
  }
  const sheets = {
    terrain: await rawSheet(path.join(ASSETS, "terrain.png")),
    scenery: await rawSheet(path.join(ASSETS, "scenery.png")),
  };
  return { atlas, frames, sheets };
}

function drawFrame(canvas, context, id, dx, dy) {
  const frame = context.frames.get(id);
  if (!frame) throw new Error(`missing frame ${id}`);
  blit(canvas, context.sheets[frame.image], frame.x, frame.y, frame.w, frame.h, dx, dy);
}

// ---------------------------------------------------------------------------
// the scene painter, reproduced - this is what makes the strips evidence
// ---------------------------------------------------------------------------

/**
 * Paint a rectangle of tiles from a corner-sampled material field.
 *
 * `cornerAt(gx, gy)` returns the material owning the grid corner. Corners are
 * ordered NW, NE, SE, SW to match the author's bit convention (1, 2, 4, 8).
 */
function paintField(canvas, context, cornerAt, tilesX, tilesY, dx, dy, seed) {
  const { atlas } = context;
  const priority = Object.fromEntries(atlas.materials.map((id, index) => [id, index]));
  const shore = new Set(atlas.shoreMaterials);
  const water = new Set(atlas.waterMaterials);
  const edgeVariants = atlas.edgeVariants;
  for (let ty = 0; ty < tilesY; ty += 1) {
    for (let tx = 0; tx < tilesX; tx += 1) {
      const corners = [
        cornerAt(tx, ty), cornerAt(tx + 1, ty),
        cornerAt(tx + 1, ty + 1), cornerAt(tx, ty + 1),
      ];
      const present = [...new Set(corners)].sort((a, b) => priority[a] - priority[b]);
      const base = present[0];
      const px = dx + tx * TILE;
      const py = dy + ty * TILE;
      drawFrame(canvas, context, `t.${base}.${Math.floor(hash2(tx, ty, seed) * 8)}`, px, py);
      for (const material of present.slice(1)) {
        let mask = 0;
        for (let corner = 0; corner < 4; corner += 1) {
          if (priority[corners[corner]] >= priority[material]) mask |= 1 << corner;
        }
        if (mask === 0) continue;
        const variants = edgeVariants[material] ?? 1;
        const variant = Math.floor(hash2(tx, ty, seed + 17 + priority[material]) * variants);
        if (mask === 15) {
          drawFrame(canvas, context, `t.${material}.${Math.floor(hash2(tx, ty, seed + 3) * 8)}`, px, py);
        } else {
          drawFrame(canvas, context, `e.${material}.${mask}.${variant}`, px, py);
        }
        // the wet line, where a bank material meets a pool
        if (mask !== 15 && shore.has(material) && water.has(base)) {
          const shoreVariant = Math.floor(hash2(tx, ty, seed + 29) * 2);
          drawFrame(canvas, context, `w.${material}.${mask}.${shoreVariant}`, px, py);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// labels
// ---------------------------------------------------------------------------

const labels = [];

function label(text, x, y, size = 13, colour = "#e8e4da") {
  labels.push({ text, x, y, size, colour });
}

function labelLayer(width, height) {
  const parts = labels.map((entry) => {
    const escaped = entry.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    return `<text x="${entry.x}" y="${entry.y}" font-family="Helvetica,Arial,sans-serif"`
      + ` font-size="${entry.size}" fill="${entry.colour}">${escaped}</text>`;
  });
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + parts.join("") + "</svg>",
  );
}

// ---------------------------------------------------------------------------
// sections
// ---------------------------------------------------------------------------

/** Section A: the 13 corner-field materials, each a 4x4 patch of base fills. */
function sectionBases(canvas, context, top) {
  const materials = context.atlas.fieldMaterials;
  const patch = TILE * 4;
  const perRow = 5;
  label("A. BASE MATERIALS - each a 4x4 patch of the eight authored fills, in stack order", PAD, top - 8, 15);
  materials.forEach((material, index) => {
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = PAD + column * (patch + PAD);
    const y = top + row * (patch + LABEL + PAD);
    for (let ty = 0; ty < 4; ty += 1) {
      for (let tx = 0; tx < 4; tx += 1) {
        drawFrame(canvas, context, `t.${material}.${(ty * 4 + tx) % 8}`, x + tx * TILE, y + ty * TILE);
      }
    }
    label(`${index}  ${material}`, x, y + patch + 14, 12);
  });
  const rows = Math.ceil(materials.length / perRow);
  return top + rows * (patch + LABEL + PAD);
}

/**
 * Section B: one strip per material pair. The boundary is a single noise
 * contour sampled at tile CORNERS, so if the alpha field were not continuous
 * across seams the 32px lattice would print through these strips immediately.
 */
const PAIRS = Object.freeze([
  ["pool", "sinter"],
  ["pool", "travertine"],
  ["pool", "ochre"],
  ["poolhot", "poolrim"],
  ["pool", "poolrim"],
  ["sinter", "travertine"],
  ["sinter", "ochre"],
  ["travertine", "ochre"],
  ["ochre", "grass"],
  ["travertine", "grass"],
  ["grass", "sungrass"],
  ["shadegrass", "grass"],
  ["grass", "scrub"],
  ["grass", "rock"],
  ["mud", "grass"],
  ["pool", "reed"],
]);

function sectionTransitions(canvas, context, top) {
  const tilesX = 10;
  const tilesY = 4;
  const width = tilesX * TILE;
  const height = tilesY * TILE;
  const perRow = 3;
  label(
    "B. TRANSITIONS - every pair across a 10x4 tile field. One continuous contour;"
    + " if the corner field broke at a seam the 32px grid would appear here first",
    PAD, top - 8, 15,
  );
  PAIRS.forEach((pair, index) => {
    const [lower, upper] = pair;
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = PAD + column * (width + PAD);
    const y = top + row * (height + LABEL + PAD);
    const seed = 500 + index * 97;
    const cornerAt = (gx, gy) => (
      fbm(gx * 0.30 + 4.1, gy * 0.34 + 1.7, seed, 3) + gx * 0.028 > 0.52 ? upper : lower
    );
    paintField(canvas, context, cornerAt, tilesX, tilesY, x, y, seed);
    label(`${lower}  ->  ${upper}`, x, y + height + 14, 12);
  });
  const rows = Math.ceil(PAIRS.length / perRow);
  return top + rows * (height + LABEL + PAD);
}

/** Section C: the shoreline sets, on each bank material, against both pools. */
const SHORE_CASES = Object.freeze([
  ["pool", "sinter"],
  ["pool", "travertine"],
  ["pool", "ochre"],
  ["poolhot", "sinter"],
  ["poolhot", "travertine"],
  ["poolhot", "ochre"],
]);

function sectionShore(canvas, context, top) {
  const tilesX = 14;
  const tilesY = 5;
  const width = tilesX * TILE;
  const height = tilesY * TILE;
  const perRow = 2;
  label(
    "C. THE WET LINE - w.* shoreline frames laid over the bank's own transition,"
    + " sharing its seed so the wet band follows exactly the same contour",
    PAD, top - 8, 15,
  );
  SHORE_CASES.forEach((pair, index) => {
    const [pool, bank] = pair;
    const column = index % perRow;
    const row = Math.floor(index / perRow);
    const x = PAD + column * (width + PAD);
    const y = top + row * (height + LABEL + PAD);
    const seed = 900 + index * 131;
    const cornerAt = (gx, gy) => (
      fbm(gx * 0.26 + 2.3, gy * 0.40 + 5.9, seed, 3) + gy * 0.045 > 0.50 ? bank : pool
    );
    paintField(canvas, context, cornerAt, tilesX, tilesY, x, y, seed);
    label(`${bank} bank against ${pool}`, x, y + height + 14, 12);
  });
  const rows = Math.ceil(SHORE_CASES.length / perRow);
  return top + rows * (height + LABEL + PAD);
}

/** Section D: every scenery sprite at 1:1 on a neutral mid-grey field. */
function sectionScenery(canvas, context, top) {
  label("D. SCENERY at 1:1 on neutral mid-grey - one row per kind, variants left to right", PAD, top - 8, 15);
  const kinds = [];
  for (const [id, , , w, h] of context.atlas.sceneryFrames) {
    const kind = id.split(".")[1];
    let entry = kinds.find((candidate) => candidate.kind === kind);
    if (!entry) {
      entry = { kind, ids: [], width: w, height: h };
      kinds.push(entry);
    }
    entry.ids.push(id);
  }
  let cursorX = PAD;
  let cursorY = top;
  let shelf = 0;
  const limit = canvas.width - PAD;
  for (const entry of kinds) {
    const groupWidth = entry.ids.length * (entry.width + 6) + 18;
    if (cursorX + groupWidth > limit) {
      cursorX = PAD;
      cursorY += shelf + LABEL + PAD;
      shelf = 0;
    }
    fillRect(canvas, cursorX - 3, cursorY - 3, groupWidth, entry.height + 6, NEUTRAL);
    entry.ids.forEach((id, index) => {
      drawFrame(canvas, context, id, cursorX + index * (entry.width + 6), cursorY);
    });
    label(`s.${entry.kind}  ${entry.width}x${entry.height}`, cursorX, cursorY + entry.height + 14, 12);
    cursorX += groupWidth + PAD;
    shelf = Math.max(shelf, entry.height);
  }
  return cursorY + shelf + LABEL + PAD;
}

// ---------------------------------------------------------------------------

export async function composeWarmSpringsAtlasSheet(outputRoot = OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const context = await loadAtlas();
  labels.length = 0;
  const width = 1120;
  const canvas = createCanvas(width, 5200, BACKGROUND);

  let cursor = 40;
  cursor = sectionBases(canvas, context, cursor) + 34;
  cursor = sectionTransitions(canvas, context, cursor) + 34;
  cursor = sectionShore(canvas, context, cursor) + 34;
  cursor = sectionScenery(canvas, context, cursor) + 20;

  if (cursor > canvas.height) throw new Error(`contact sheet overflow: needs ${cursor}px`);

  const cropped = Buffer.alloc(width * cursor * 4);
  canvas.data.copy(cropped, 0, 0, width * cursor * 4);
  const base = await sharp(cropped, { raw: { width, height: cursor, channels: 4 } })
    .png().toBuffer();
  const png = await sharp(base)
    .composite([{ input: labelLayer(width, cursor), top: 0, left: 0 }])
    .png({ compressionLevel: 9 }).toBuffer();
  const file = path.join(outputRoot, "atlas-contact-sheet.png");
  await writeFile(file, png);
  return { file, width, height: cursor, bytes: png.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  composeWarmSpringsAtlasSheet()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
