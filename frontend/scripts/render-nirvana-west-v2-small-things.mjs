/**
 * The "small thing first" plates for the Nirvana West v2 pilot.
 *
 * Before a whole region of burning fissures and ruined structures is worth
 * looking at, ONE of each has to survive being looked at on its own at 1:1. If
 * a single fissure does not read as burning and a single ruin does not read as
 * raised, a region full of them will not either.
 *
 * Produces, into `docs/frontend/mockups/regions/nirvana-west-pilot/`:
 *   v2-small-fire.png            one fissure, 1:1, at all FOUR animation
 *                                phases stacked - the loop, frame by frame
 *   v2-small-fire.gif            the same four frames as a 160 ms loop
 *   v2-small-ruin-ancient.png    every ruin of the "ancient" kit standing on
 *                                real region ground at 1:1, shadows included
 *   v2-small-ruin-industrial.png the same for the "industrial" kit
 *
 * The fire plate is CROPPED OUT OF the fire strip the plate script already
 * writes, so it is by construction the same pixels the region plate has rather
 * than a second rendering path that could flatter itself.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPO_ROOT = path.resolve(FRONTEND_ROOT, "..");
const PLATES = path.resolve(REPO_ROOT, "docs/frontend/mockups/regions/nirvana-west-pilot");
const ASSET_ROOT = path.join(FRONTEND_ROOT, "src/qa/nirvanaWestPilot/assets");

/** Where in the 1536x1024 detail crop the burning fissure sits. */
const FIRE_CROP = { left: 96, top: 496, width: 512, height: 496 };
/** The fire strip's own geometry, as `render-nirvana-west-plates.mjs` writes it. */
const STRIP_GUTTER = 8;
const DETAIL = { width: 1536, height: 1024 };

const GUTTER = 10;
const BACKDROP = [10, 8, 14];

async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function createSurface(width, height, fill = BACKDROP) {
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = fill[0];
    data[index * 4 + 1] = fill[1];
    data[index * 4 + 2] = fill[2];
    data[index * 4 + 3] = 255;
  }
  return { data, width, height };
}

function blit(target, source, sx, sy, sw, sh, dx, dy) {
  for (let y = 0; y < sh; y += 1) {
    const ty = dy + y;
    if (ty < 0 || ty >= target.height) continue;
    for (let x = 0; x < sw; x += 1) {
      const tx = dx + x;
      if (tx < 0 || tx >= target.width) continue;
      const s = ((sy + y) * source.width + sx + x) * 4;
      const alpha = source.data[s + 3] / 255;
      if (alpha <= 0) continue;
      const t = (ty * target.width + tx) * 4;
      const destinationAlpha = target.data[t + 3] / 255;
      const outAlpha = alpha + destinationAlpha * (1 - alpha);
      for (let channel = 0; channel < 3; channel += 1) {
        target.data[t + channel] = Math.round(
          (source.data[s + channel] * alpha
            + target.data[t + channel] * destinationAlpha * (1 - alpha)) / outAlpha,
        );
      }
      target.data[t + 3] = Math.round(outAlpha * 255);
    }
  }
}

const write = async (surface, file) => {
  const png = await sharp(
    Buffer.from(surface.data.buffer, surface.data.byteOffset, surface.data.length),
    { raw: { width: surface.width, height: surface.height, channels: 4 } },
  ).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, png);
  return png.length;
};

// ---------------------------------------------------------------------------
// the fire: four phases of one fissure, cropped out of the region's own strip
// ---------------------------------------------------------------------------

async function renderSmallFire(outputRoot) {
  const strip = await loadRaw(path.join(PLATES, "b-ember-rift-fire-strip.png"));
  const quadrant = [
    { x: 0, y: 0 },
    { x: DETAIL.width + STRIP_GUTTER, y: 0 },
    { x: 0, y: DETAIL.height + STRIP_GUTTER },
    { x: DETAIL.width + STRIP_GUTTER, y: DETAIL.height + STRIP_GUTTER },
  ];
  const { width: cw, height: ch } = FIRE_CROP;
  const sheet = createSurface(cw * 2 + GUTTER, ch * 2 + GUTTER);
  const frames = [];
  quadrant.forEach((origin, phase) => {
    const sx = origin.x + FIRE_CROP.left;
    const sy = origin.y + FIRE_CROP.top;
    blit(sheet, strip, sx, sy, cw, ch, (phase % 2) * (cw + GUTTER), Math.floor(phase / 2) * (ch + GUTTER));
    const frame = createSurface(cw, ch);
    blit(frame, strip, sx, sy, cw, ch, 0, 0);
    frames.push(frame);
  });
  const bytes = await write(sheet, path.join(outputRoot, "v2-small-fire.png"));

  // The same four frames as a real 640 ms loop, so the motion can be SEEN
  // rather than inferred from four stills.
  const tall = Buffer.concat(frames.map((frame) => Buffer.from(
    frame.data.buffer, frame.data.byteOffset, frame.data.length,
  )));
  const gif = await sharp(tall, { raw: { width: cw, height: ch * frames.length, channels: 4 }, pageHeight: ch })
    .gif({ loop: 0, delay: 160 }).toBuffer();
  await writeFile(path.join(outputRoot, "v2-small-fire.gif"), gif);
  return { png: bytes, gif: gif.length, crop: FIRE_CROP };
}

// ---------------------------------------------------------------------------
// the ruins: every variant standing on REAL region ground at 1:1
// ---------------------------------------------------------------------------

const RUIN_KITS = {
  ancient: [
    "monolith.0", "monolith.1", "monolith.2", "slumpwall.0", "slumpwall.2",
    "boneforest.0", "boneforest.2", "ashbarrow.0", "ashbarrow.2",
  ],
  industrial: [
    "coolingtower.0", "coolingtower.1", "reactorhusk.0", "reactorhusk.1",
    "gantry.0", "gantry.2", "stack.0", "stack.2", "pylon.0",
  ],
};

/** A plain, fissure-free patch of the real B plate, used as the backdrop. */
const GROUND_CROP = { left: 1856, top: 320, width: 2000, height: 560 };

async function renderSmallRuins(outputRoot) {
  const atlas = JSON.parse(await readFile(path.join(ASSET_ROOT, "atlas.json"), "utf8"));
  const scenery = await loadRaw(path.join(ASSET_ROOT, "scenery.png"));
  const plate = await loadRaw(path.join(PLATES, "b-ember-rift.png"));
  const frames = new Map(atlas.sceneryFrames.map((frame) => [frame[0], frame]));

  const written = {};
  for (const [kit, list] of Object.entries(RUIN_KITS)) {
    const width = Math.min(GROUND_CROP.width, plate.width - GROUND_CROP.left);
    const height = GROUND_CROP.height;
    const surface = createSurface(width, height);
    blit(surface, plate, GROUND_CROP.left, GROUND_CROP.top, width, height, 0, 0);
    let cursor = 10;
    const footY = Math.round(height * 0.78);
    for (const key of list) {
      const frame = frames.get(`s.${key}`);
      if (frame === undefined) throw new Error(`missing ruin frame s.${key}`);
      const [, fx, fy, fw, fh, , py] = frame;
      blit(surface, scenery, fx, fy, fw, fh, cursor, footY - py);
      // Advance by the OBJECT, not the frame: ruin frames carry a wide empty
      // margin for their shadow, and spacing on frame width would scatter them.
      cursor += Math.round(fw * 0.62) + 6;
    }
    written[kit] = await write(surface, path.join(outputRoot, `v2-small-ruin-${kit}.png`));
  }
  return written;
}

export async function renderNirvanaWestV2SmallThings(outputRoot = PLATES) {
  await mkdir(outputRoot, { recursive: true });
  const fire = await renderSmallFire(outputRoot);
  const ruins = await renderSmallRuins(outputRoot);
  return { outputRoot, fire, ruins };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  renderNirvanaWestV2SmallThings()
    .then((result) => process.stdout.write(`${JSON.stringify(result, null, 1)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
