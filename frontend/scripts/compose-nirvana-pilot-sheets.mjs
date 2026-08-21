/**
 * Composes the review sheets for the Nirvana river-valley pilot.
 *
 * Inputs are the native-scale renders already written by
 * `render-nirvana-valley-pilot.mjs` and `capture-nirvana-valley-pilot.mjs`.
 * Nothing is redrawn or resampled: every panel is a 1:1 copy, so what the owner
 * judges is exactly what the painter produced.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_ROOT, "../..");
const PILOT_DIR = path.resolve(REPO_ROOT, "docs/frontend/mockups/regions/nirvana-pilot");
const REFERENCE = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/nirvana-c-river-valley.png",
);

const LABEL_HEIGHT = 34;
const GUTTER = 10;
const BACKGROUND = { r: 16, g: 18, b: 20, alpha: 1 };

function labelSvg(width, text) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${LABEL_HEIGHT}">`
    + `<rect width="${width}" height="${LABEL_HEIGHT}" fill="#101214"/>`
    + `<text x="10" y="23" font-family="Helvetica,Arial,sans-serif" font-size="15"`
    + ` fill="#e6e2d8">${escaped}</text></svg>`,
  );
}

/** Stack labelled panels vertically at 1:1. */
async function stack(panels, outputFile) {
  const loaded = [];
  for (const panel of panels) {
    const buffer = await readFile(panel.file);
    const meta = await sharp(buffer).metadata();
    loaded.push({ buffer, width: meta.width, height: meta.height, label: panel.label });
  }
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
  const png = await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: outputFile, width, height, bytes: png.length };
}

/** Place labelled 1:1 crops side by side. */
async function sideBySide(panels, crop, outputFile) {
  const composite = [];
  const width = panels.length * crop.width + (panels.length + 1) * GUTTER;
  const height = crop.height + LABEL_HEIGHT + GUTTER * 2;
  let cursor = GUTTER;
  for (const panel of panels) {
    const buffer = await sharp(await readFile(panel.file)).extract({
      left: panel.left ?? crop.left,
      top: panel.top ?? crop.top,
      width: crop.width,
      height: crop.height,
    }).toBuffer();
    composite.push({ input: labelSvg(crop.width, panel.label), left: cursor, top: GUTTER });
    composite.push({ input: buffer, left: cursor, top: GUTTER + LABEL_HEIGHT });
    cursor += crop.width + GUTTER;
  }
  const png = await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: outputFile, width, height, bytes: png.length };
}

/**
 * Load one panel, optionally taking a 1:1 crop of it. No resampling ever
 * happens: a crop is a copy of the pixels the painter produced.
 */
async function loadPanel(panel) {
  const source = await readFile(panel.file);
  const buffer = panel.crop
    ? await sharp(source).extract(panel.crop).toBuffer()
    : source;
  const meta = await sharp(buffer).metadata();
  return { buffer, width: meta.width, height: meta.height, label: panel.label };
}

/** Stack labelled panels of any size vertically at 1:1. */
async function stackPanels(panels, outputFile) {
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
  const png = await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: outputFile, width, height, bytes: png.length };
}

/** Lay labelled panels of any size out in a row at 1:1, top aligned. */
async function rowPanels(panels, outputFile, title = null) {
  const loaded = [];
  for (const panel of panels) loaded.push(await loadPanel(panel));
  const width = loaded.reduce((total, panel) => total + panel.width + GUTTER, GUTTER);
  const titleHeight = title === null ? 0 : LABEL_HEIGHT;
  const height = Math.max(...loaded.map((panel) => panel.height))
    + LABEL_HEIGHT + titleHeight + GUTTER * 2;
  const composite = [];
  if (title !== null) {
    composite.push({ input: labelSvg(width, title), left: 0, top: GUTTER });
  }
  let cursor = GUTTER;
  for (const panel of loaded) {
    composite.push({
      input: labelSvg(panel.width, panel.label),
      left: cursor,
      top: GUTTER + titleHeight,
    });
    composite.push({ input: panel.buffer, left: cursor, top: GUTTER + titleHeight + LABEL_HEIGHT });
    cursor += panel.width + GUTTER;
  }
  const png = await sharp({
    create: { width, height, channels: 4, background: BACKGROUND },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(outputFile, png);
  return { file: outputFile, width, height, bytes: png.length };
}

/** 1:1 windows onto each authored bridge, in world pixels. */
const BRIDGE_CROPS = Object.freeze({
  north: { left: 192, top: 32, width: 640, height: 192 },
  northTight: { left: 288, top: 32, width: 384, height: 192 },
  island: { left: 608, top: 224, width: 192, height: 256 },
  lower: { left: 832, top: 512, width: 192, height: 288 },
});

/** The world-atlas causeway the valley bridges are meant to belong to. */
const ATLAS_BRIDGE = Object.freeze({
  file: path.resolve(REPO_ROOT, "docs/frontend/mockups/atlas-impl/01-world-four-islands.png"),
  crop: { left: 832, top: 516, width: 72, height: 330 },
});

export async function composeNirvanaPilotSheets(pilotDir = PILOT_DIR) {
  const at = (name) => path.join(pilotDir, name);
  const results = {};

  results.beforeAfter = await stack([
    {
      file: at("nirvana-current-baseline.png"),
      label: "BEFORE - Nirvana today, production painter, root chunk at 1:1"
        + " (two flat ground tones, hard 32px boundaries, stepped road and swale)",
    },
    {
      file: at("valley.png"),
      label: "AFTER - river-valley pilot, same painter primitives, same 1536x1024"
        + " (transition sets, curved river, clustered vegetation)",
    },
  ], at("before-after.png"));

  results.referenceVsPilot = await stack([
    { file: REFERENCE, label: "REFERENCE - approved direction, nirvana-c-river-valley.png" },
    { file: at("valley.png"), label: "PILOT - rendered by the tile pipeline at 1:1" },
  ], at("reference-vs-pilot.png"));

  results.structure = await stack([
    { file: at("valley.png"), label: "The valley" },
    {
      file: at("valley-walkable.png"),
      label: "The same view with BLOCKED ground tinted red"
        + " - water, reed beds, thicket, cliff terrace, boulders and tree trunks."
        + " The three bridge decks stay UNtinted: walkable ground over water that is not",
    },
    {
      file: at("valley-components.png"),
      label: "Flood fill over the walkability mask - ONE colour means one connected"
        + " walkable region; dark grey is blocked",
    },
  ], at("structure.png"));

  // The pilot window deliberately avoids every bridge: this sheet judges
  // SURFACE against a reference plate that has no bridges in it, so a span
  // crossing the crop would compare two different things.
  results.detailBank = await sideBySide([
    { file: REFERENCE, label: "reference - bank, shingle, reeds" },
    { file: at("valley.png"), label: "pilot - bank, shingle, reeds", left: 180, top: 452 },
  ], { left: 380, top: 230, width: 700, height: 470 }, at("detail-bank.png"));

  results.detailGrid = await sideBySide([
    {
      file: at("nirvana-current-baseline.png"),
      label: "before - the 32px grid is directly legible",
      left: 120,
      top: 420,
    },
    {
      file: at("valley.png"),
      label: "after - no tile boundary survives",
      left: 860,
      top: 120,
    },
  ], { left: 0, top: 0, width: 560, height: 420 }, at("detail-grid.png"));

  results.bridges = await stackPanels([
    {
      file: at("valley.png"),
      crop: BRIDGE_CROPS.north,
      label: "1 - THE BRIDGE at 1:1 - plank deck, rails, pegs, stone abutments, shadow on the water",
    },
    {
      file: at("valley-walkable.png"),
      crop: BRIDGE_CROPS.north,
      label: "2 - THE SAME TILES, blocked ground tinted red. The deck is UNtinted: walkable",
    },
    {
      file: at("valley-path.png"),
      crop: BRIDGE_CROPS.north,
      label: "3 - THE REAL NAVIGATOR, west bank to east bank. Big markers are ON the deck (7 of 7)",
    },
  ], at("bridges.png"));

  results.bridgeSites = await rowPanels([
    {
      ...ATLAS_BRIDGE,
      label: "atlas",
    },
    {
      file: at("valley.png"),
      crop: BRIDGE_CROPS.northTight,
      label: "north-plank (7 deck tiles)",
    },
    {
      file: at("valley.png"),
      crop: BRIDGE_CROPS.island,
      label: "island (4)",
    },
    {
      file: at("valley.png"),
      crop: BRIDGE_CROPS.lower,
      label: "lower (5)",
    },
  ], at("bridge-sites.png"),
  "Three bridges, three reaches of the river, beside the world-atlas causeway they belong to (1:1)");

  results.bridgePath = await stackPanels([
    {
      file: at("valley-path.png"),
      label: "The real findNavigationPath, run bank to bank over each of the three bridges."
        + " Nothing is drawn by hand: the production navigator was handed the pilot's collision"
        + " grid and two bank endpoints, and this is the route it returned",
    },
  ], at("bridge-path.png"));

  return results;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  composeNirvanaPilotSheets()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
