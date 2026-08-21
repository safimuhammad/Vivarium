/**
 * Composes the review sheets for the Nirvana river-valley pilot's SECOND art
 * pass - the production tile vocabulary (P2).
 *
 * Inputs are the native-scale renders written by `render-nirvana-valley-pilot.mjs
 * --out docs/frontend/mockups/regions/nirvana-pilot-v2`, the FIRST pass's stills
 * in `nirvana-pilot/` (read only, never written), and the approved reference
 * plate. Nothing is redrawn or resampled: every panel is a 1:1 copy of the
 * pixels the real painter produced, because a zoomed crop is not evidence.
 *
 * The sheet that matters is `triptych.png`: reference, old pilot, new pilot, the
 * same window in all three, so the delta is a judgement the owner makes rather
 * than one this script asserts.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const REGIONS = path.resolve(REPO_ROOT, "docs/frontend/mockups/regions");
const OLD_PILOT = path.join(REGIONS, "nirvana-pilot");
const NEW_PILOT = path.join(REGIONS, "nirvana-pilot-v2");
const REFERENCE = path.join(REGIONS, "nirvana-c-river-valley.png");
const ASSETS = path.resolve(FRONTEND_ROOT, "src/qa/nirvanaValleyPilot/assets");

const LABEL_HEIGHT = 34;
const GUTTER = 10;
const BACKGROUND = { r: 16, g: 18, b: 20, alpha: 1 };

function labelSvg(width, text, size = 15) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_HEIGHT}">`
    + `<rect width="${width}" height="${LABEL_HEIGHT}" fill="#101214"/>`
    + `<text x="10" y="23" font-family="Helvetica,Arial,sans-serif" font-size="${size}"`
    + ` fill="#e6e2d8">${escaped}</text></svg>`,
  );
}

async function loadPanel(panel) {
  const source = await readFile(panel.file);
  const buffer = panel.crop
    ? await sharp(source).extract(panel.crop).png().toBuffer()
    : source;
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, label: panel.label };
}

/** Stack labelled panels vertically at 1:1. */
async function stack(panels, outputFile) {
  const loaded = [];
  for (const panel of panels) loaded.push(await loadPanel(panel));
  const width = Math.max(...loaded.map((panel) => panel.width));
  const height = loaded.reduce(
    (total, panel) => total + panel.height + LABEL_HEIGHT + GUTTER,
    GUTTER,
  );
  const composite = [];
  let cursor = GUTTER;
  for (const panel of loaded) {
    composite.push({ input: labelSvg(width, panel.label), left: 0, top: cursor });
    cursor += LABEL_HEIGHT;
    composite.push({ input: panel.buffer, left: 0, top: cursor });
    cursor += panel.height + GUTTER;
  }
  const png = await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: path.basename(outputFile), width, height, bytes: png.length };
}

/** Lay labelled panels out in a row at 1:1, top aligned. */
async function row(panels, outputFile, title = null) {
  const loaded = [];
  for (const panel of panels) loaded.push(await loadPanel(panel));
  const width = loaded.reduce((total, panel) => total + panel.width + GUTTER, GUTTER);
  const titleHeight = title === null ? 0 : LABEL_HEIGHT;
  const height = Math.max(...loaded.map((panel) => panel.height))
    + LABEL_HEIGHT + titleHeight + GUTTER * 2;
  const composite = [];
  if (title !== null) composite.push({ input: labelSvg(width, title), left: 0, top: GUTTER });
  let cursor = GUTTER;
  for (const panel of loaded) {
    composite.push({
      input: labelSvg(panel.width, panel.label, 13),
      left: cursor,
      top: GUTTER + titleHeight,
    });
    composite.push({
      input: panel.buffer,
      left: cursor,
      top: GUTTER + titleHeight + LABEL_HEIGHT,
    });
    cursor += panel.width + GUTTER;
  }
  const png = await sharp({ create: { width, height, channels: 4, background: BACKGROUND } })
    .composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: path.basename(outputFile), width, height, bytes: png.length };
}

// ---------------------------------------------------------------------------
// a 1:1 contact sheet of the authored vocabulary, laid on the real ground fills
// ---------------------------------------------------------------------------

async function rawSheet(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function frameTable(atlas) {
  const frames = new Map();
  const { columns, cell, ids, image } = atlas.terrainGrid;
  ids.forEach((id, index) => {
    frames.set(id, {
      image,
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
  return frames;
}

/**
 * Draw one contact sheet of authored frames, over the material each species
 * actually stands on, so the sprite is judged in the light it will be seen in.
 */
async function contactSheet(groups, outputFile, options = {}) {
  const atlas = JSON.parse(await readFile(path.join(ASSETS, "atlas.json"), "utf8"));
  const frames = frameTable(atlas);
  const sheets = {
    terrain: await rawSheet(path.join(ASSETS, "terrain.png")),
    scenery: await rawSheet(path.join(ASSETS, "scenery.png")),
  };
  const cellSize = options.cell ?? 132;
  const picked = [];
  for (const group of groups) {
    const ids = [...frames.keys()].filter((id) => id.startsWith(`s.${group}.`)).sort();
    for (const id of ids) picked.push({ id, group });
  }
  const columns = Math.min(options.columns ?? 8, picked.length);
  const rows = Math.ceil(picked.length / columns);
  const width = columns * cellSize;
  const height = rows * cellSize;
  const out = Buffer.alloc(width * height * 4);
  const blit = (sheet, sx, sy, sw, sh, dx, dy) => {
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        const tx = dx + x;
        const ty = dy + y;
        if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
        const source = ((sy + y) * sheet.width + (sx + x)) * 4;
        const alpha = sheet.data[source + 3] / 255;
        if (alpha <= 0) continue;
        const target = (ty * width + tx) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          out[target + channel] = Math.round(
            sheet.data[source + channel] * alpha + out[target + channel] * (1 - alpha),
          );
        }
        out[target + 3] = 255;
      }
    }
  };
  const ground = options.ground ?? "t.grass.3";
  const groundFrame = frames.get(ground);
  for (let y = 0; y < height; y += 32) {
    for (let x = 0; x < width; x += 32) {
      blit(sheets.terrain, groundFrame.x, groundFrame.y, 32, 32, x, y);
    }
  }
  picked.forEach((entry, index) => {
    const frame = frames.get(entry.id);
    const centerX = (index % columns) * cellSize + cellSize / 2;
    const footY = Math.floor(index / columns) * cellSize + cellSize - 14;
    blit(
      frame.image === "terrain" ? sheets.terrain : sheets.scenery,
      frame.x, frame.y, frame.w, frame.h,
      Math.round(centerX - frame.px), Math.round(footY - frame.py),
    );
  });
  const png = await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: path.basename(outputFile), width, height, bytes: png.length, frames: picked.length };
}

// ---------------------------------------------------------------------------
// windows. Every one is in WORLD pixels and every panel is 1:1.
// ---------------------------------------------------------------------------

/**
 * The surface window. Deliberately bridge-free in both pilots and chosen where
 * the reference plate shows the same subject - bank, shingle, reeds, sward and
 * a stand of trees - because comparing a bridge against a plate with no bridge
 * in it compares two different things.
 */
const SURFACE = Object.freeze({ width: 512, height: 384 });
const SURFACE_AT = Object.freeze({
  reference: { left: 380, top: 230 },
  pilot: { left: 180, top: 452 },
});

export async function composeNirvanaPilotV2Sheets(outputRoot = NEW_PILOT) {
  await mkdir(outputRoot, { recursive: true });
  const at = (name) => path.join(outputRoot, name);
  const old = (name) => path.join(OLD_PILOT, name);
  const results = {};

  // 1. THE TRIPTYCH - the sheet the owner should look at first.
  results.triptych = await row([
    {
      file: REFERENCE,
      crop: { ...SURFACE_AT.reference, ...SURFACE },
      label: "1. REFERENCE - the approved plate",
    },
    {
      file: old("valley.png"),
      crop: { ...SURFACE_AT.pilot, ...SURFACE },
      label: "2. OLD PILOT - first vocabulary, 390 frames, 473 KB terrain",
    },
    {
      file: at("valley.png"),
      crop: { ...SURFACE_AT.pilot, ...SURFACE },
      label: "3. NEW PILOT - 537 frames, 113 KB terrain",
    },
  ], at("triptych.png"),
  "TRIPTYCH at 1:1, no upscaling, same 512x384 window in both pilots. Left: the plate. Middle: the pilot's first tile set. Right: this pass.");

  // 2. The same three as whole plates, so composition is judged too.
  results.tripytchFull = await stack([
    { file: REFERENCE, label: "REFERENCE - nirvana-c-river-valley.png, 1536x1024" },
    { file: old("valley.png"), label: "OLD PILOT - first vocabulary, same painter, 1536x1024" },
    { file: at("valley.png"), label: "NEW PILOT - production vocabulary, same painter, 1536x1024" },
  ], at("triptych-full.png"));

  // 3. The new plate on its own, and the walkability proof beside it.
  results.structure = await stack([
    { file: at("valley.png"), label: "The valley, native 1536x1024" },
    {
      file: at("valley-walkable.png"),
      label: "The same view with BLOCKED ground tinted red - water, reed beds, thicket,"
        + " the rock ridge, boulders and tree trunks. The bridge decks and the"
        + " diagonal boardwalk stay UNtinted: walkable ground over ground that is not",
    },
    {
      file: at("valley-components.png"),
      label: "Flood fill over the walkability mask - ONE colour means one connected"
        + " walkable region; dark grey is blocked",
    },
  ], at("structure.png"));

  // 4. What the new vocabulary actually buys, window by window, against the plate.
  results.gaps = await row([
    {
      file: REFERENCE,
      crop: { left: 900, top: 430, width: 320, height: 260 },
      label: "reference - sward",
    },
    {
      file: old("valley.png"),
      crop: { left: 60, top: 560, width: 320, height: 260 },
      label: "old - one even sward",
    },
    {
      file: at("valley.png"),
      crop: { left: 60, top: 560, width: 320, height: 260 },
      label: "new - three tonal tiers + drifts",
    },
  ], at("gap-sward.png"),
  "GAP 1 of the pilot's own list: tonal modelling of the sward (1:1)");

  results.shore = await row([
    {
      file: REFERENCE,
      crop: { left: 400, top: 600, width: 320, height: 240 },
      label: "reference - waterline",
    },
    {
      file: old("valley.png"),
      crop: { left: 300, top: 300, width: 320, height: 240 },
      label: "old - transition shadow only",
    },
    {
      file: at("valley.png"),
      crop: { left: 300, top: 300, width: 320, height: 240 },
      label: "new - wet line + broken foam",
    },
  ], at("gap-shoreline.png"),
  "GAP 4: shoreline / wet-line sets per bank material (1:1)");

  results.rock = await row([
    {
      file: REFERENCE,
      crop: { left: 1120, top: 20, width: 400, height: 340 },
      label: "reference - terrace",
    },
    {
      file: old("valley.png"),
      crop: { left: 1136, top: 0, width: 400, height: 340 },
      label: "old - the weakest element",
    },
    {
      file: at("valley.png"),
      crop: { left: 1136, top: 0, width: 400, height: 340 },
      label: "new - rock ridge, scarp faces, corners",
    },
  ], at("gap-rock.png"),
  "GAP 3: cliff / terrace pieces with corners and a rock ground set (1:1)");

  // 5. The authored vocabulary, at 1:1, on the ground each species stands on.
  results.trees = await contactSheet(
    ["willow", "broadleaf", "birch", "conifer", "shrub"],
    at("vocabulary-trees.png"),
    { columns: 8, cell: 132 },
  );
  results.ground = await contactSheet(
    ["reedclump", "reedwater", "flowerdrift", "tuft", "boulder", "outcrop", "cobble", "driftwood"],
    at("vocabulary-ground.png"),
    { columns: 8, cell: 96 },
  );
  results.scarp = await contactSheet(
    ["scarpface", "scarpcornerout", "scarpcornerin", "steppingstone"],
    at("vocabulary-scarp.png"),
    { columns: 6, cell: 104, ground: "t.rock.2" },
  );
  results.bridgeKit = await contactSheet(
    [
      "bridgedeckh", "bridgedeckv", "bridgewornh", "bridgewornv",
      "bridgedeckdne", "bridgedeckdnw", "bridgeramph", "bridgerampv",
      "bridgeposth", "bridgepostv", "bridgearchh", "bridgearchv",
      "bridgepier", "bridgearchpier",
    ],
    at("vocabulary-bridge-kit.png"),
    { columns: 7, cell: 56, ground: "t.water.2" },
  );

  // 6. The bridges in situ, at 1:1 - timber, stone arch, diagonal boardwalk.
  results.bridges = await row([
    {
      file: at("valley.png"),
      crop: { left: 288, top: 16, width: 384, height: 176 },
      label: "north - timber, east-west, wear + posts",
    },
    {
      file: at("valley.png"),
      crop: { left: 832, top: 496, width: 176, height: 304 },
      label: "lower - stone arch",
    },
    {
      file: at("valley.png"),
      crop: { left: 1000, top: 640, width: 288, height: 224 },
      label: "east ford - diagonal boardwalk",
    },
  ], at("bridge-kit-in-situ.png"),
  "GAP 8: bridge additions, in situ at 1:1 - wear states and handrail posts on the timber span,"
  + " a stone-arch causeway, and the diagonal deck on the east ford");

  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  composeNirvanaPilotV2Sheets()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
