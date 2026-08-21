/**
 * The Nirvana West torus wrap proof.
 *
 * Every region in this world now wraps (`RegionMapRecipe.ts`'s
 * `REGION_WALK_TOPOLOGY = "toroidal"`, `navigation.ts`'s `NavigationTopology`):
 * a being who walks off the west edge reappears on the east edge, and the same
 * on the north/south axis. Declaring the topology is not, by itself, proof the
 * ART agrees — a material field authored without the wrap in mind can show a
 * hard seam where the west edge fails to continue into the east edge.
 *
 * This script is the visual proof. Per composition it renders the REAL
 * painter output once (same mechanism as `render-nirvana-west-plates.mjs`:
 * Vite SSR loading the pilot's TypeScript, a hand-rolled raw-RGBA
 * `CanvasRenderingContext2D`, `sharp` for PNG in/out), tiles that single
 * 3072x3072 plate 2x2 (6144x6144), downsamples to 1536x1536 (each copy lands
 * at 768px), and draws a THIN 1px marker line along the two interior seams —
 * a findability aid only. The point of the check is that, apart from the
 * marker line itself, the seam should be invisible: material should read as
 * continuous across it, exactly as it does everywhere else in the tiling.
 *
 * It also prints, per composition, whatever seam-verification numbers the
 * scene/walkability modules expose. Three sources are tried, in order, and
 * whichever exist are reported:
 *   1. `nirvanaWestScene.ts`'s `verifyToroidalSeam(scene)`, if it exists —
 *      the name this deliverable was specified against.
 *   2. `nirvanaWestWalkability.ts`'s `torusReport(scene)`, if it exists —
 *      the shape every sibling pilot (Nirvana East) actually shipped
 *      (`seamMismatchNS/EW`, `wrapOpeningsNS/EW`).
 *   3. A grid-level check computed directly here with the PRODUCTION
 *      `wrapSeamViolations` (`navigation/wrapSeams.ts`) against a
 *      `topology: "toroidal"` navigation grid built from the scene's own
 *      collision buffer — independent of what either module names its own
 *      check, so this script always prints SOMETHING concrete.
 *
 * Usage:  node scripts/render-nirvana-west-wrap-check.mjs [--out DIR]
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { createServer } from "vite";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const DEFAULT_OUTPUT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/nirvana-west-pilot",
);

const PILOT = "/src/qa/nirvanaWestPilot";
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/nirvanaWestPilot/assets");

const DOWNSAMPLE_SIZE = 1536;
const MARKER_COLOUR = [90, 240, 255];
const LABEL_HEIGHT = 30;

const LABELS = {
  "a-ashfall-drifts": "A — Ashfall Drifts",
  "b-ember-rift": "B — Ember Rift",
  "c-shattered-pavement": "C — Shattered Pavement",
};

// ---------------------------------------------------------------------------
// raw RGBA surface + the minimal 2D context the production draw op needs
// (identical to render-nirvana-west-plates.mjs)
// ---------------------------------------------------------------------------

function createSurface(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

async function loadSurface(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}

function createContext(surface) {
  return {
    imageSmoothingEnabled: false,
    canvas: { width: surface.width, height: surface.height },
    surface,
    drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
      const stepX = sw / dw;
      const stepY = sh / dh;
      for (let row = 0; row < dh; row += 1) {
        const targetY = dy + row;
        if (targetY < 0 || targetY >= surface.height) continue;
        const sourceY = sy + Math.floor(row * stepY);
        if (sourceY < 0 || sourceY >= image.height) continue;
        for (let column = 0; column < dw; column += 1) {
          const targetX = dx + column;
          if (targetX < 0 || targetX >= surface.width) continue;
          const sourceX = sx + Math.floor(column * stepX);
          if (sourceX < 0 || sourceX >= image.width) continue;
          const source = (sourceY * image.width + sourceX) * 4;
          const alpha = image.data[source + 3] / 255;
          if (alpha <= 0) continue;
          const target = (targetY * surface.width + targetX) * 4;
          if (alpha >= 1) {
            surface.data[target] = image.data[source];
            surface.data[target + 1] = image.data[source + 1];
            surface.data[target + 2] = image.data[source + 2];
            surface.data[target + 3] = 255;
            continue;
          }
          const destinationAlpha = surface.data[target + 3] / 255;
          const outAlpha = alpha + destinationAlpha * (1 - alpha);
          for (let channel = 0; channel < 3; channel += 1) {
            surface.data[target + channel] = Math.round(
              (image.data[source + channel] * alpha
                + surface.data[target + channel] * destinationAlpha * (1 - alpha)) / outAlpha,
            );
          }
          surface.data[target + 3] = Math.round(outAlpha * 255);
        }
      }
    },
    clearRect() {},
  };
}

function blend(surface, x, y, colour, alpha) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    surface.data[index + channel] = Math.round(
      colour[channel] * alpha + surface.data[index + channel] * (1 - alpha),
    );
  }
  surface.data[index + 3] = 255;
}

/** Paste `source` onto `dest` at (x, y), 1:1, opaque. */
function paste(dest, source, x, y) {
  for (let row = 0; row < source.height; row += 1) {
    const targetY = y + row;
    if (targetY < 0 || targetY >= dest.height) continue;
    for (let column = 0; column < source.width; column += 1) {
      const targetX = x + column;
      if (targetX < 0 || targetX >= dest.width) continue;
      const sourceIndex = (row * source.width + column) * 4;
      const targetIndex = (targetY * dest.width + targetX) * 4;
      dest.data[targetIndex] = source.data[sourceIndex];
      dest.data[targetIndex + 1] = source.data[sourceIndex + 1];
      dest.data[targetIndex + 2] = source.data[sourceIndex + 2];
      dest.data[targetIndex + 3] = 255;
    }
  }
}

/** sharp-backed box downsample: exact, and avoids a hand-rolled averaging loop over 36M px. */
async function downsampleSurface(surface, targetWidth, targetHeight) {
  const buffer = Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length);
  const { data, info } = await sharp(buffer, {
    raw: { width: surface.width, height: surface.height, channels: 4 },
  })
    .resize(targetWidth, targetHeight, { kernel: "lanczos3" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    width: info.width,
    height: info.height,
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
  };
}

async function writePng(surface, file) {
  const png = await sharp(
    Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length),
    { raw: { width: surface.width, height: surface.height, channels: 4 } },
  ).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

function labelSvg(width, height, text, fontSize = 14) {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return Buffer.from(
    `<svg width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#101017"/>`
    + `<text x="10" y="${Math.round(height / 2) + 5}" font-family="Helvetica,Arial,sans-serif" `
    + `font-size="${fontSize}" fill="#e6e2d8">${escaped}</text></svg>`,
  );
}

/**
 * Tile a 3072x3072 plate 2x2 (6144x6144), downsample to `DOWNSAMPLE_SIZE`
 * square (each copy lands at DOWNSAMPLE_SIZE/2 = 768px), then mark the two
 * interior seams with a single-pixel guide line — a findability aid only.
 * If the art wraps cleanly, material either side of the line should read as
 * continuous; the line's own pixel is the only thing that should be visible.
 */
async function buildWrapPlate(plate) {
  const tiled = createSurface(plate.width * 2, plate.height * 2);
  paste(tiled, plate, 0, 0);
  paste(tiled, plate, plate.width, 0);
  paste(tiled, plate, 0, plate.height);
  paste(tiled, plate, plate.width, plate.height);
  const shrunk = await downsampleSurface(tiled, DOWNSAMPLE_SIZE, DOWNSAMPLE_SIZE);
  const seamX = Math.round((plate.width / tiled.width) * shrunk.width);
  const seamY = Math.round((plate.height / tiled.height) * shrunk.height);
  for (let y = 0; y < shrunk.height; y += 1) blend(shrunk, seamX, y, MARKER_COLOUR, 0.7);
  for (let x = 0; x < shrunk.width; x += 1) blend(shrunk, x, seamY, MARKER_COLOUR, 0.7);
  return shrunk;
}

async function writePngWithCaption(surface, caption, file) {
  const buffer = Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length);
  const panel = await sharp(buffer, {
    raw: { width: surface.width, height: surface.height, channels: 4 },
  }).png().toBuffer();
  const png = await sharp({
    create: {
      width: surface.width,
      height: surface.height + LABEL_HEIGHT,
      channels: 4,
      background: { r: 16, g: 16, b: 22, alpha: 1 },
    },
  }).composite([
    { input: panel, left: 0, top: 0 },
    { input: labelSvg(surface.width, LABEL_HEIGHT, caption), left: 0, top: surface.height },
  ]).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

/** The three per-composition wrap plates, side by side, each labelled. */
async function writeCombinedWrapCheck(panels, file) {
  const gap = 14;
  const width = panels.reduce((sum, panel) => sum + panel.surface.width + gap, gap);
  const height = Math.max(...panels.map((panel) => panel.surface.height)) + LABEL_HEIGHT + gap * 2;
  const composite = [];
  let left = gap;
  for (const panel of panels) {
    composite.push({ input: labelSvg(panel.surface.width, LABEL_HEIGHT, panel.label), left, top: gap });
    const buffer = Buffer.from(
      panel.surface.data.buffer, panel.surface.data.byteOffset, panel.surface.data.length,
    );
    const panelPng = await sharp(buffer, {
      raw: { width: panel.surface.width, height: panel.surface.height, channels: 4 },
    }).png().toBuffer();
    composite.push({ input: panelPng, left, top: gap + LABEL_HEIGHT });
    left += panel.surface.width + gap;
  }
  const png = await sharp({
    create: { width, height, channels: 4, background: { r: 10, g: 10, b: 14, alpha: 1 } },
  }).composite(composite).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

// ---------------------------------------------------------------------------
// seam verification — try every source the scene/walkability modules might
// expose, plus an independent grid-level check computed here.
// ---------------------------------------------------------------------------

function toroidalGridFromScene(scene) {
  return { columns: scene.columns, rows: scene.rows, collision: scene.collision, topology: "toroidal" };
}

function reportSeamVerification(scene, sceneModule, walkModule, wrapSeamsModule) {
  const report = {};

  if (typeof sceneModule.verifyToroidalSeam === "function") {
    report.verifyToroidalSeam = sceneModule.verifyToroidalSeam(scene);
  }
  if (typeof walkModule.torusReport === "function") {
    report.torusReport = walkModule.torusReport(scene);
  }
  if (typeof wrapSeamsModule.wrapSeamViolations === "function") {
    const violations = wrapSeamsModule.wrapSeamViolations(toroidalGridFromScene(scene));
    const byReason = {};
    for (const violation of violations) {
      byReason[violation.reason] = (byReason[violation.reason] ?? 0) + 1;
    }
    report.wrapSeamViolations = { count: violations.length, byReason, sample: violations.slice(0, 8) };
  }
  return report;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderNirvanaWestWrapCheck(outputRoot = DEFAULT_OUTPUT) {
  const server = await createServer({
    root: FRONTEND_ROOT,
    configFile: path.join(FRONTEND_ROOT, "vite.config.ts"),
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "warn",
  });
  try {
    const sceneModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestScene.ts`);
    const painterModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestPainter.ts`);
    const walkModule = await server.ssrLoadModule(`${PILOT}/nirvanaWestWalkability.ts`);
    const wrapSeamsModule = await server.ssrLoadModule(
      "/src/renderer2d/production/navigation/wrapSeams.ts",
    );

    const manifest = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
    const terrain = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
    const scenery = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));
    const environment = await loadSurface(path.join(ASSET_ROOT, "environment.png"));
    await mkdir(outputRoot, { recursive: true });

    const panels = [];
    const summaries = [];
    for (const id of sceneModule.NIRVANA_WEST_COMPOSITION_IDS) {
      const scene = sceneModule.createNirvanaWestScene(id);
      // The wrap proof renders the FULL plan, animated layer included: a
      // seam check that skips the moving content proves nothing about the
      // moving content. (Animation cannot break a seam by construction - a
      // placement's destination is its own 32 px tile rect and never spills
      // past it - but the plate is the evidence, not the argument.)
      const plan = painterModule.createNirvanaWestFullPaintPlan(scene, manifest);
      const surface = createSurface(scene.widthPixels, scene.heightPixels);
      painterModule.renderNirvanaWestFullPlan(
        createContext(surface), plan, { terrain, scenery, environment }, { x: 0, y: 0 }, 0, false,
      );

      const wrapImage = await buildWrapPlate(surface);
      const seamVerification = reportSeamVerification(scene, sceneModule, walkModule, wrapSeamsModule);

      const caption = `${id} — 2x2 torus wrap check (interior seams marked)`;
      const bytes = await writePngWithCaption(
        wrapImage, caption, path.join(outputRoot, `${id}-wrap.png`),
      );

      panels.push({ surface: wrapImage, label: LABELS[id] ?? id });
      summaries.push({ composition: id, bytes, seamVerification });
      process.stdout.write(`rendered ${id}-wrap.png (${bytes} bytes)\n`);
      process.stdout.write(`${JSON.stringify(seamVerification, null, 1)}\n`);
    }

    const combinedBytes = await writeCombinedWrapCheck(
      panels, path.join(outputRoot, "wrap-check.png"),
    );
    process.stdout.write(`rendered wrap-check.png (${combinedBytes} bytes)\n`);

    return { outputRoot, combinedBytes, summaries };
  } finally {
    await server.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIndex = process.argv.indexOf("--out");
  renderNirvanaWestWrapCheck(outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : DEFAULT_OUTPUT)
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
