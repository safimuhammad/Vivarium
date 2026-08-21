/**
 * Renders the LANDFORM-OBJECT PROOF: a single 1536x1024, native 1:1 crop
 * proving the new `s.mesa`/`s.butte`/`s.outcrop` relief scenery family (see
 * `author-nirvana-east-pilot-art.mjs`'s "landform relief family" section)
 * reads as a RAISED object standing on the ground, not a flat colour patch.
 *
 * This is the ONLY deliverable of the landform-object task - no composition,
 * no `eastScene.ts` changes. It reuses the same raw-RGBA `createSurface` /
 * `loadSurface` / alpha-composited blit / `writePng` machinery
 * `render-nirvana-east-baseline.mjs` and `render-nirvana-east-plates.mjs`
 * already use for headless (no-DOM) Node compositing, reading frame rects
 * and pivots straight out of the authored `atlas.json` - no production scene
 * code is needed since this is one object on a hand-tiled ground plane, not
 * a full region composition.
 *
 * Ground plane: real authored terrain BASE FILLS (`t.hardpan`, `t.salt`,
 * `t.oxide`, `t.gravel`), tiled in a hand-placed patchwork (not a flat colour
 * rectangle) so the desert floor the objects stand on is genuine authored
 * ground, exactly as the brief requires.
 *
 * Placement: the large `s.mesa` stands roughly centred so its cast shadow and
 * cliff face have room to read; `s.butte` and `s.outcrop` stand nearby so all
 * three size tiers can be compared directly. A 3x nearest-neighbour zoom
 * inset of the mesa's cliff-face/talus/shadow junction is composited into
 * the bottom-right corner so the strata and the drop can be judged up close.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/nirvanaEastPilot/assets");
const DEFAULT_OUTPUT = path.resolve(
  REPO_ROOT,
  "docs/frontend/mockups/regions/nirvana-east-pilot/landform-object-proof.png",
);

const TILE = 32;
const CANVAS_WIDTH = 1536;
const CANVAS_HEIGHT = 1024;

// ---------------------------------------------------------------------------
// raw RGBA surface + alpha-composited blit (verbatim technique from
// render-nirvana-east-plates.mjs / render-nirvana-east-baseline.mjs)
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

/** Integer 1:1 (or scaled) source-over blit. */
function blit(surface, image, sx, sy, sw, sh, dx, dy, dw, dh) {
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
}

/** Nearest-neighbour upscale blit - for the zoom inset. */
function blitNearest(surface, image, sx, sy, sw, sh, dx, dy, scale) {
  blit(surface, image, sx, sy, sw, sh, dx, dy, sw * scale, sh * scale);
}

function strokeRect(surface, x, y, w, h, thickness, [r, g, b]) {
  for (let t = 0; t < thickness; t += 1) {
    for (let column = 0; column < w; column += 1) {
      setOpaque(surface, x + column, y + t, r, g, b);
      setOpaque(surface, x + column, y + h - 1 - t, r, g, b);
    }
    for (let row = 0; row < h; row += 1) {
      setOpaque(surface, x + t, y + row, r, g, b);
      setOpaque(surface, x + w - 1 - t, y + row, r, g, b);
    }
  }
}

function setOpaque(surface, x, y, r, g, b) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  surface.data[index] = r;
  surface.data[index + 1] = g;
  surface.data[index + 2] = b;
  surface.data[index + 3] = 255;
}

function copySurface(surface) {
  const copy = createSurface(surface.width, surface.height);
  copy.data.set(surface.data);
  return copy;
}

async function writePng(surface, file) {
  const png = await sharp(
    Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length),
    { raw: { width: surface.width, height: surface.height, channels: 4 } },
  ).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
}

// ---------------------------------------------------------------------------
// entry
// ---------------------------------------------------------------------------

export async function renderLandformObjectProof(outputFile = DEFAULT_OUTPUT) {
  const atlas = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
  const terrainImage = await loadSurface(path.join(ASSET_ROOT, "terrain.png"));
  const sceneryImage = await loadSurface(path.join(ASSET_ROOT, "scenery.png"));

  const terrainFrameById = new Map();
  atlas.terrainGrid.ids.forEach((id, index) => {
    terrainFrameById.set(id, {
      x: (index % atlas.terrainGrid.columns) * atlas.terrainGrid.cell,
      y: Math.floor(index / atlas.terrainGrid.columns) * atlas.terrainGrid.cell,
      width: atlas.terrainGrid.cell,
      height: atlas.terrainGrid.cell,
    });
  });
  const sceneryFrameById = new Map();
  for (const [id, x, y, width, height, pivotX, pivotY] of atlas.sceneryFrames) {
    sceneryFrameById.set(id, { x, y, width, height, pivotX, pivotY });
  }

  const surface = createSurface(CANVAS_WIDTH, CANVAS_HEIGHT);

  // --- ground plane: real authored terrain base fills, painted as a single
  // COHERENT field (mostly hardpan/salt) with soft irregular value-noise
  // patches of oxide and gravel - not hard rectangular zones meeting at
  // straight edges, which reads as a swatch chart rather than real ground.
  const columns = Math.ceil(CANVAS_WIDTH / TILE);
  const rows = Math.ceil(CANVAS_HEIGHT / TILE);
  function hash2(x, y) {
    let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
  }
  function valueNoise(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi);
    const b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1);
    const d = hash2(xi + 1, yi + 1);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  }
  function groundMaterialAt(column, row) {
    const broad = valueNoise(column * 0.075, row * 0.075);
    const fine = valueNoise(column * 0.22 + 41, row * 0.22 + 17);
    const field = broad * 0.72 + fine * 0.28;
    if (field > 0.74) return "salt";
    if (field < 0.24) return "gravel";
    if (field < 0.40) return "oxide";
    return "hardpan";
  }
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const material = groundMaterialAt(column, row);
      const variant = Math.abs(Math.imul(column, 928_371) ^ Math.imul(row, 74_281)) % 8;
      const frame = terrainFrameById.get(`t.${material}.${variant}`);
      blit(
        surface, terrainImage, frame.x, frame.y, frame.width, frame.height,
        column * TILE, row * TILE, TILE, TILE,
      );
    }
  }

  const drawScenery = (id, footX, footY) => {
    const frame = sceneryFrameById.get(id);
    if (frame === undefined) throw new Error(`Missing scenery frame ${id}.`);
    blit(
      surface, sceneryImage, frame.x, frame.y, frame.width, frame.height,
      footX - frame.pivotX, footY - frame.pivotY, frame.width, frame.height,
    );
    return frame;
  };

  // --- placement: mesa roughly centred with room for its shadow/cliff to
  // read; butte and outcrop nearby so the three tiers compare directly.
  const mesaFoot = { x: 620, y: 560 };
  const buttefoot = { x: 950, y: 660 };
  const outcropFoot = { x: 1160, y: 540 };
  const mesaFrame = drawScenery("s.mesa.0", mesaFoot.x, mesaFoot.y);
  drawScenery("s.butte.0", buttefoot.x, buttefoot.y);
  drawScenery("s.outcrop.0", outcropFoot.x, outcropFoot.y);

  // --- 3x nearest-neighbour zoom inset of the mesa's cliff-face / talus /
  // shadow junction, composited into the bottom-right corner. Snapshot the
  // already-composited main surface (ground + mesa together, exactly as the
  // main frame shows it) BEFORE drawing the inset, so the inset is a true
  // zoomed crop of the real picture, not a re-derivation of it.
  const composed = copySurface(surface);
  const insetSourceWidth = 220;
  const insetSourceHeight = 130;
  const insetSourceX = mesaFoot.x - mesaFrame.pivotX + 18;
  const insetSourceY = mesaFoot.y - mesaFrame.pivotY + 118;
  const insetScale = 3;
  const insetWidth = insetSourceWidth * insetScale;
  const insetHeight = insetSourceHeight * insetScale;
  const insetX = CANVAS_WIDTH - insetWidth - 24;
  const insetY = CANVAS_HEIGHT - insetHeight - 24;
  blitNearest(
    surface, composed, insetSourceX, insetSourceY,
    insetSourceWidth, insetSourceHeight, insetX, insetY, insetScale,
  );
  strokeRect(surface, insetX - 4, insetY - 4, insetWidth + 8, insetHeight + 8, 4, [250, 248, 240]);
  strokeRect(surface, insetSourceX - 2, insetSourceY - 2, insetSourceWidth + 4, insetSourceHeight + 4, 2, [250, 248, 240]);

  await mkdir(path.dirname(outputFile), { recursive: true });
  const bytes = await writePng(surface, outputFile);
  return { outputFile, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, bytes };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderLandformObjectProof()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 1)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
