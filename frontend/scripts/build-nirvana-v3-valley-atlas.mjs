/**
 * Publishes the Nirvana v3 production atlas: the approved river-valley tile
 * vocabulary (authored by `author-nirvana-valley-pilot-art.mjs`) PLUS the
 * production frames that must keep working (`build-nirvana-v2-pilot-atlas.mjs`'s
 * road/swale/ford terrain and its 18 landmark sprites), so a region can move
 * onto the valley material set without breaking anything that already
 * addresses those ids.
 *
 * This script does not modify either source script. It COPIES the palette
 * tables and pixel painters it needs out of both (per the pilot's own doc
 * comment, it "mostly runs at import time", so importing it would re-run the
 * whole pilot build as a side effect - copying is the only clean option) and
 * adds two things of its own:
 *
 *   1. Twenty-four production terrain frames (road/swale/ford) re-drawn with
 *      the valley's fixed palette discipline instead of production v2's
 *      `TERRAIN_PALETTE`, so a dirt track and a dry gully read as part of the
 *      valley rather than as a patch from another region. Their ids are read
 *      straight out of the CURRENT `nirvana-v2/atlas.json` and preserved
 *      verbatim - this script never hand-copies that id list, so it cannot
 *      silently drop or rename one.
 *   2. Eighteen landmark sprites, decoded pixel-exact out of the CURRENT
 *      `nirvana-v2/landmarks.png` and re-packed into the new scenery sheet.
 *      These are BLITTED, never redrawn - the source art is already approved
 *      production art, and the job here is packing, not painting.
 *
 * Emits exactly `terrain.png`, `scenery.png`, `atlas.json` and publishes them
 * atomically into a content-addressed generation directory under
 * `frontend/src/assets/renderer2d/regions/.nirvana-v3-generations/<fingerprint>/`,
 * with a symlink swapped over `frontend/src/assets/renderer2d/regions/nirvana-v3`
 * - the same scheme `build-nirvana-v2-pilot-atlas.mjs` uses for `nirvana-v2`.
 * `nirvana-v2` itself and its generations directory are never read for
 * writing, only `landmarks.png` and `atlas.json` are read from it.
 */

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "../..");
const V2_REGION_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "frontend/src/assets/renderer2d/regions/nirvana-v2",
);
const V2_ATLAS_JSON_PATH = path.join(V2_REGION_DIRECTORY, "atlas.json");
const V2_LANDMARKS_PNG_PATH = path.join(V2_REGION_DIRECTORY, "landmarks.png");
const DEFAULT_OUTPUT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "frontend/src/assets/renderer2d/regions/nirvana-v3",
);

/**
 * `activeCompressedBytes["worn-heartland"]` from
 * `frontend/src/renderer2d/production/assets/productionManifest.ts`, read via
 * a throwaway vitest probe of `PRODUCTION_ASSET_MANIFEST.budgets` on the date
 * this script was authored: `coreCompressedBytes` (411,692) +
 * `regionCompressedBytes["worn-heartland"]` (140,729) = 552,421. Hardcoded
 * rather than imported because this is a plain Node `.mjs` build script and
 * `productionManifest.ts` is TypeScript with its own asset-graph imports; the
 * number is reporting-only (Ceiling B math below), never behavior.
 */
const WORN_HEARTLAND_ACTIVE_COMPRESSED_BYTES = 552_421;
const REGION_COMPRESSED_MAX = 196_608;
const ACTIVE_COMPRESSED_MAX = 1_310_720;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---------------------------------------------------------------------------
// Copied verbatim from author-nirvana-valley-pilot-art.mjs (palette discipline)
// ---------------------------------------------------------------------------

const TILE = 32;

const MATERIALS = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "gravel",
  "silt",
  "shadegrass",
  "grass",
  "sungrass",
  "meadow",
  "thicket",
  "reed",
  "rock",
]);

const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

const BLOCKING_MATERIALS = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "thicket",
  "reed",
  "rock",
]);

const SHORE_MATERIALS = Object.freeze(["gravel", "silt", "reed"]);

const BASE_VARIANTS = 8;

/**
 * `rock: 1` and `thicket: 1` are this script's own cuts, not the pilot's: see
 * the Ceiling A budget note below `buildNirvanaV3ValleyAtlas` for the measured
 * byte table that justifies them. Everything else here matches the pilot file
 * exactly.
 */
const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  shadegrass: 1,
  grass: 1,
  sungrass: 1,
  meadow: 1,
  rock: 1,
  thicket: 1,
});
const DEFAULT_EDGE_VARIANTS = 2;
/**
 * `1`, not the pilot's `2`: this script's own cut (see the Ceiling A budget
 * note below `buildNirvanaV3ValleyAtlas`). Adding the 24 production terrain
 * frames and the 18 landmark sprites pushes the region kit over its
 * 196,608-byte ceiling at full pilot fidelity; halving the shoreline variant
 * set plus the rock and thicket edge-transition variant sets is the smallest
 * *comfortably safe* combination tested (a smaller cut - shoreline + thicket
 * alone - also clears the ceiling but by only 31 bytes, too thin a margin to
 * rely on). See that comment for the full measured candidate table.
 */
const SHORE_VARIANTS = 1;

function edgeVariantCount(material) {
  return EDGE_VARIANTS_BY_MATERIAL[material] ?? DEFAULT_EDGE_VARIANTS;
}
const EDGE_MASKS = Object.freeze(
  Array.from({ length: 14 }, (_unused, index) => index + 1),
);

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

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function tone(palette, t) {
  const index = Math.round(clamp01(t) * (palette.length - 1));
  return palette[index];
}

function step(palette, index) {
  return palette[index < 0 ? 0 : index >= palette.length ? palette.length - 1 : index];
}

function level(palette, t) {
  return Math.round(clamp01(t) * (palette.length - 1));
}

function windowOf(family, from, to) {
  return Object.freeze(family.slice(from, to + 1));
}

function chunky(value) {
  return Math.floor(value * 0.5) * 2;
}

const ALPHA_LEVELS = Object.freeze([0, 88, 172, 255]);

function quantiseAlpha(alpha) {
  return ALPHA_LEVELS[Math.round(clamp01(alpha) * (ALPHA_LEVELS.length - 1))];
}

const SWARD = Object.freeze([
  [46, 52, 28], [58, 64, 32], [70, 76, 36], [84, 90, 40],
  [98, 104, 45], [113, 118, 51], [129, 133, 58], [147, 148, 66],
  [166, 161, 78], [186, 175, 95], [205, 191, 118], [222, 208, 148],
]);

const RIVER = Object.freeze([
  [46, 66, 60], [56, 79, 71], [66, 91, 80], [78, 102, 89], [92, 115, 100],
  [110, 133, 120], [134, 156, 144], [166, 186, 178], [206, 222, 216],
]);

const PALETTES = Object.freeze({
  deepwater: windowOf(RIVER, 0, 4),
  water: windowOf(RIVER, 1, 6),
  shallow: windowOf(RIVER, 3, 8),
  gravel: Object.freeze([
    [86, 84, 66], [110, 107, 84], [136, 132, 106],
    [164, 159, 128], [192, 187, 154], [220, 216, 188],
  ]),
  silt: Object.freeze([
    [54, 54, 40], [72, 72, 54], [92, 90, 68],
    [112, 109, 84], [134, 130, 102], [158, 152, 122],
  ]),
  shadegrass: windowOf(SWARD, 1, 6),
  grass: windowOf(SWARD, 4, 9),
  sungrass: windowOf(SWARD, 6, 11),
  meadow: windowOf(SWARD, 5, 10),
  thicket: Object.freeze([
    [26, 32, 18], [36, 44, 22], [46, 55, 26],
    [58, 68, 31], [72, 84, 38], [92, 104, 48],
  ]),
  reed: Object.freeze([
    [62, 70, 36], [86, 94, 44], [112, 118, 52],
    [140, 144, 62], [172, 170, 80], [206, 198, 112],
  ]),
  rock: Object.freeze([
    [62, 60, 50], [88, 84, 70], [114, 109, 90], [140, 134, 110],
    [168, 160, 132], [196, 187, 154], [222, 212, 178],
  ]),
});

const SCARP_ROCK = Object.freeze([
  [42, 40, 28], [64, 60, 38], [88, 80, 44], [114, 103, 52],
  [142, 127, 64], [174, 155, 86], [206, 186, 118],
]);

const ACCENT = Object.freeze({
  foam: [228, 238, 232],
  glint: [246, 250, 246],
  twig: [96, 80, 50],
  berry: [162, 88, 62],
  lichen: [110, 124, 58],
  moss: [86, 104, 52],
  flowerWhite: [238, 240, 228],
  flowerYellow: [214, 186, 64],
  flowerPurple: [158, 138, 186],
  flowerPurpleDeep: [108, 96, 140],
  shadow: [26, 32, 20],
});

const BARK = Object.freeze([
  [34, 28, 18], [56, 46, 30], [80, 66, 42], [106, 88, 56], [134, 112, 72],
]);

const BIRCH_BARK = Object.freeze([
  [72, 70, 58], [124, 122, 106], [176, 178, 160], [214, 216, 200], [240, 242, 228],
]);

const WILLOW_LEAF = Object.freeze([
  [42, 50, 26], [62, 72, 32], [88, 98, 40],
  [118, 126, 52], [156, 160, 70], [196, 192, 102],
]);

const CANOPY_LEAF = Object.freeze([
  [32, 42, 20], [50, 62, 26], [70, 86, 34],
  [96, 112, 44], [128, 144, 58], [166, 180, 82],
]);

const CONIFER_LEAF = Object.freeze([
  [20, 30, 18], [30, 44, 22], [42, 58, 28],
  [56, 76, 34], [74, 96, 44], [98, 122, 58],
]);

function materialPixel(material, wx, wy, seed) {
  const palette = PALETTES[material];
  switch (material) {
    case "shadegrass":
    case "grass":
    case "sungrass":
    case "meadow": {
      const clump = fbm(wx * 0.20, wy * 0.20, seed + 11, 3);
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 23, 2);
      let index = level(palette, 0.22 + clump * 0.52 + (grain - 0.5) * 0.36);
      const bladePick = hash2(Math.floor(wx), Math.floor(wy / 3), seed + 37);
      if (bladePick > 0.855) {
        index += hash2(Math.floor(wx), Math.floor(wy), seed + 53) > 0.44 ? 2 : -2;
      }
      if (hash2(chunky(wx), chunky(wy), seed + 57) < 0.14) index -= 1;
      if (material === "meadow") {
        const flower = hash2(Math.floor(wx), Math.floor(wy), seed + 71);
        if (flower > 0.944) {
          const kind = hash2(Math.floor(wy), Math.floor(wx), seed + 89);
          return kind > 0.72
            ? ACCENT.flowerPurple
            : kind > 0.34 ? ACCENT.flowerYellow : ACCENT.flowerWhite;
        }
        if (flower > 0.905) index += 2;
      }
      return step(palette, index);
    }
    case "thicket": {
      const mass = fbm(wx * 0.12, wy * 0.12, seed + 111, 3);
      const bushX = wx * 0.42;
      const bushY = wy * 0.42;
      const crown = fbm(bushX, bushY, seed + 127, 2);
      const gradient = fbm(bushX, bushY - 0.55, seed + 127, 2) - crown;
      let index = level(palette, 0.10 + mass * 0.26 + crown * 0.34 + gradient * 1.9);
      if (crown < 0.36) index -= 2;
      const twig = hash2(Math.floor(wx), Math.floor(wy), seed + 139);
      if (twig > 0.965) index += 2;
      if (twig < 0.02) return ACCENT.twig;
      if (hash2(Math.floor(wx), Math.floor(wy), seed + 149) > 0.991) return ACCENT.berry;
      return step(palette, index);
    }
    case "deepwater":
    case "water": {
      const deep = material === "deepwater";
      const swell = fbm(wx * 0.085, wy * 0.085, seed + 5, 3);
      const drift = fbm(wx * 0.17 + swell * 1.8, wy * 0.13 - swell * 1.4, seed + 17, 2);
      let index = level(palette, (deep ? 0.18 : 0.34) + swell * 0.36 + (drift - 0.5) * 0.26);
      const thread = Math.abs(drift - 0.54);
      if (thread < 0.024) index += deep ? 1 : 2;
      if (!deep) {
        const bed = fbm(wx * 0.24, wy * 0.24, seed + 43, 2);
        if (bed > 0.70) return tone(PALETTES.gravel, 0.10 + (bed - 0.70) * 0.9);
      }
      if (hash2(chunky(wx), chunky(wy), seed + 33) > 0.982) index += 1;
      return step(palette, index);
    }
    case "shallow": {
      const surface = fbm(wx * 0.11, wy * 0.11, seed + 7, 3);
      const bed = fbm(wx * 0.26, wy * 0.26, seed + 43, 2);
      const index = level(palette, 0.30 + surface * 0.38 + (bed - 0.5) * 0.28);
      if (bed > 0.60) return tone(PALETTES.gravel, 0.22 + (bed - 0.60) * 1.1);
      const crest = Math.abs(surface - 0.70);
      if (crest < 0.014) return ACCENT.foam;
      if (crest < 0.032) return step(palette, palette.length - 1);
      return step(palette, index);
    }
    case "gravel": {
      const field = fbm(wx * 0.34, wy * 0.34, seed + 13, 3);
      let index = level(palette, 0.18 + field * 0.34);
      const cellSize = 3;
      let best = -1;
      let bestTone = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = Math.floor(wx / cellSize) + dx;
          const cy = Math.floor(wy / cellSize) + dy;
          const jx = (cx + hash2(cx, cy, seed + 67)) * cellSize;
          const jy = (cy + hash2(cx, cy, seed + 71)) * cellSize;
          const radius = 1.1 + hash2(cx, cy, seed + 73) * 1.5;
          const offsetX = wx - jx;
          const offsetY = wy - jy;
          const distance = Math.hypot(offsetX, offsetY * 1.25);
          if (distance > radius) continue;
          const shade = 0.42 - (offsetY / radius) * 0.36 - (offsetX / radius) * 0.20
            + hash2(cx, cy, seed + 79) * 0.34;
          const score = radius - distance;
          if (score > best) {
            best = score;
            bestTone = shade;
          }
        }
      }
      if (best >= 0) index = level(palette, bestTone);
      return step(palette, index);
    }
    case "silt": {
      const field = fbm(wx * 0.17, wy * 0.17, seed + 19, 4);
      const fine = fbm(chunky(wx) * 0.42, chunky(wy) * 0.42, seed + 29, 2);
      const index = level(palette, 0.20 + field * 0.58 + (fine - 0.5) * 0.18);
      if (hash2(chunky(wx), chunky(wy), seed + 47) > 0.92) {
        return tone(PALETTES.gravel, 0.42);
      }
      return step(palette, index);
    }
    case "reed": {
      // A reed bed is a mass of stalks, not a hatch. The first authoring rendered it as
      // one: every stalk sat in its own pixel column, dead vertical, and started on a
      // rigid 9-pixel ruling (`wy / 9`, `wy % 9`) shared by the whole bed — so a large
      // slack-water bed read as flat green corduroy at 1:1, the weakest element on the
      // plate. Four changes break the repetition, all inside the SIX existing reed
      // palette entries: no new colours, no new frames, no atlas layout change.
      //
      //  1. `bank` — a slow field that carries broad light and shadow passages across
      //     the bed, the same tonal modelling the sward tiers already have.
      //  2. `lean` — a slow shear on the sampled column, so stalks curve instead of
      //     standing in perfectly straight one-pixel files.
      //  3. per-column `period` and `offset` — each column keeps its own stalk spacing
      //     and its own starting phase, which destroys the shared horizontal ruling.
      //  4. density follows `bank`, so the bed opens into thin water and closes into
      //     thickets instead of holding one uniform coverage everywhere.
      const wet = fbm(wx * 0.14, wy * 0.14, seed + 61, 3);
      const bank = fbm(wx * 0.037, wy * 0.031, seed + 101, 3);
      let index = level(palette, 0.02 + wet * 0.30 + (bank - 0.5) * 0.40);
      const lean = (fbm(wx * 0.05, wy * 0.045, seed + 97, 2) - 0.5) * 3.4;
      const column = Math.floor(wx + lean);
      const period = 7 + Math.floor(hash2(column, 0, seed + 93) * 6);
      const offset = Math.floor(hash2(column, 1, seed + 91) * period);
      const shifted = wy + offset;
      const band = Math.floor(shifted / period);
      const stalk = hash2(column, band, seed + 73);
      const density = 0.60 - (bank - 0.5) * 0.52;
      if (stalk > density) {
        const phase = ((shifted % period) + period) % period;
        const height = 3 + Math.floor(stalk * (period - 2));
        if (phase < height) {
          index = level(
            palette,
            0.40 + (height - phase) * 0.05 + (bank - 0.5) * 0.44,
          );
          // A seed head catches the light at the very tip of the taller stalks.
          if (phase === height - 1 && stalk > 0.86) index = palette.length - 1;
        }
      }
      if (hash2(chunky(wx), chunky(wy), seed + 79) > 0.966) return tone(RIVER, 0.55);
      return step(palette, index);
    }
    case "rock": {
      const cellSize = 13;
      let nearest = Infinity;
      let second = Infinity;
      let slab = 0;
      let offsetX = 0;
      let offsetY = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = Math.floor(wx / cellSize) + dx;
          const cy = Math.floor(wy / cellSize) + dy;
          const jx = (cx + hash2(cx, cy, seed + 83)) * cellSize;
          const jy = (cy + hash2(cx, cy, seed + 89)) * cellSize;
          const ax = Math.abs(wx - jx);
          const ay = Math.abs(wy - jy);
          const distance = Math.max(ax, ay) * 0.72 + (ax + ay) * 0.28;
          if (distance < nearest) {
            second = nearest;
            nearest = distance;
            slab = hash2(cx, cy, seed + 97);
            offsetX = (wx - jx) / cellSize;
            offsetY = (wy - jy) / cellSize;
          } else if (distance < second) {
            second = distance;
          }
        }
      }
      let index = level(palette, 0.28 + slab * 0.52);
      index += offsetY < -0.22 || offsetX < -0.30 ? 1 : offsetY > 0.24 ? -1 : 0;
      const joint = second - nearest;
      if (joint < 1.0) index -= 3;
      else if (joint < 1.9) index -= 1;
      if (hash2(chunky(wx), chunky(wy), seed + 101) > 0.93) index -= 1;
      const moss = fbm(wx * 0.13, wy * 0.13, seed + 103, 3);
      if (joint < 2.4 && moss > 0.50) return ACCENT.moss;
      if (moss > 0.72) return step(PALETTES.shadegrass, level(PALETTES.shadegrass, moss));
      if (moss < 0.30) return ACCENT.lichen;
      return step(palette, index);
    }
    default:
      throw new Error(`unknown material ${material}`);
  }
}

function createSurface(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function setPixel(surface, x, y, rgba) {
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  surface.data[index] = rgba[0];
  surface.data[index + 1] = rgba[1];
  surface.data[index + 2] = rgba[2];
  surface.data[index + 3] = rgba[3];
}

function put(surface, x, y, rgb) {
  setPixel(surface, x, y, [rgb[0], rgb[1], rgb[2], 255]);
}

function veil(surface, x, y, rgb, alpha) {
  const quantised = quantiseAlpha(alpha);
  if (quantised === 0) return;
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  if (surface.data[index + 3] >= quantised && surface.data[index + 3] > 0) {
    if (surface.data[index + 3] === 255) return;
  }
  surface.data[index] = rgb[0];
  surface.data[index + 1] = rgb[1];
  surface.data[index + 2] = rgb[2];
  surface.data[index + 3] = Math.max(surface.data[index + 3], quantised);
}

function paintContactShadow(surface, ox, oy, centerX, footY, radiusX, radiusY, strength) {
  for (let y = Math.floor(footY - radiusY); y <= footY + radiusY; y += 1) {
    for (let x = Math.floor(centerX - radiusX); x <= centerX + radiusX; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - footY) / radiusY;
      const distance = Math.hypot(dx, dy);
      if (distance > 1) continue;
      veil(surface, ox + x, oy + y, ACCENT.shadow, strength * (1 - distance) ** 1.6);
    }
  }
}

function paintBaseTile(surface, originX, originY, material, variant) {
  const seed = 1000 + MATERIAL_PRIORITY[material] * 977 + variant * 313;
  const offsetX = variant * 61.5;
  const offsetY = variant * 137.25;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      put(surface, originX + x, originY + y, materialPixel(material, x + offsetX, y + offsetY, seed));
    }
  }
}

function edgeCoverage(mask, x, y, seed) {
  const u = (x + 0.5) / TILE;
  const v = (y + 0.5) / TILE;
  const nw = (mask & 1) !== 0 ? 1 : 0;
  const ne = (mask & 2) !== 0 ? 1 : 0;
  const se = (mask & 4) !== 0 ? 1 : 0;
  const sw = (mask & 8) !== 0 ? 1 : 0;
  const top = nw * (1 - u) + ne * u;
  const bottom = sw * (1 - u) + se * u;
  const bilinear = top * (1 - v) + bottom * v;
  const window = Math.sin(Math.PI * u) * Math.sin(Math.PI * v);
  const wobble = (fbm(x * 0.28 + seed * 0.13, y * 0.28 + seed * 0.29, seed, 3) - 0.5);
  return bilinear + wobble * 0.62 * window;
}

function edgeSeed(material, mask, variant) {
  return 4000 + MATERIAL_PRIORITY[material] * 811 + mask * 53 + variant * 2029;
}

function edgeOffsets(material, mask, variant) {
  const priority = MATERIAL_PRIORITY[material];
  return [
    17.5 + priority * 23 + mask * 3.5 + variant * 91.25,
    43.25 + priority * 31 + mask * 5.5 + variant * 57.75,
  ];
}

function paintEdgeTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const [offsetX, offsetY] = edgeOffsets(material, mask, variant);
  const palette = PALETTES[material];
  const grassy = material === "shadegrass" || material === "grass"
    || material === "sungrass" || material === "meadow" || material === "reed";
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      const alpha = quantiseAlpha(smoothstep(0.42, 0.60, field));
      if (alpha === 0) {
        if (field > 0.24) {
          const speck = hash2(x + originX, y + originY, seed + 131);
          if (speck > 0.90 + (0.42 - field) * 0.6) {
            const colour = materialPixel(material, x + offsetX, y + offsetY, seed);
            setPixel(surface, originX + x, originY + y, [
              colour[0], colour[1], colour[2], ALPHA_LEVELS[2],
            ]);
          }
        }
        continue;
      }
      const colour = materialPixel(material, x + offsetX, y + offsetY, seed);
      const rim = 1 - smoothstep(0.60, 0.80, field);
      const drop = rim > 0.62 ? (grassy ? 2 : 1) : rim > 0.24 ? 1 : 0;
      const shaded = drop === 0
        ? colour
        : step(palette, Math.max(0, palette.indexOf(colour) < 0 ? 0 : palette.indexOf(colour) - drop));
      setPixel(surface, originX + x, originY + y, [shaded[0], shaded[1], shaded[2], alpha]);
    }
  }
}

function paintShoreTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const [offsetX, offsetY] = edgeOffsets(material, mask, variant);
  const palette = PALETTES[material];
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      if (field >= 0.505 && field < 0.70) {
        const depth = (field - 0.505) / 0.195;
        const damp = fbm((x + originX) * 0.36, (y + originY) * 0.36, seed + 197, 2);
        const level0 = depth < 0.34 ? 0 : depth < 0.72 ? 1 : 2;
        const wet = step(palette, level0 + (damp > 0.62 ? 1 : 0));
        setPixel(surface, originX + x, originY + y, [
          wet[0], wet[1], wet[2], depth < 0.80 ? 255 : ALPHA_LEVELS[2],
        ]);
        continue;
      }
      if (field >= 0.44 && field < 0.505) {
        const near = (field - 0.44) / 0.065;
        const broken = fbm((x + originX) * 0.42, (y + originY) * 0.42, seed + 211, 2);
        if (broken > 0.62 - near * 0.20) {
          const foamy = broken > 0.80 && near > 0.55;
          const colour = foamy ? ACCENT.foam : tone(RIVER, 0.80);
          setPixel(surface, originX + x, originY + y, [
            colour[0], colour[1], colour[2], foamy ? ALPHA_LEVELS[3] : ALPHA_LEVELS[2],
          ]);
        }
      }
    }
  }
}

function terrainFrameLayout() {
  const frames = [];
  for (const material of MATERIALS) {
    for (let variant = 0; variant < BASE_VARIANTS; variant += 1) {
      frames.push({ id: `t.${material}.${variant}`, kind: "base", material, variant });
    }
  }
  for (const material of MATERIALS) {
    if (MATERIAL_PRIORITY[material] === 0) continue;
    for (const mask of EDGE_MASKS) {
      for (let variant = 0; variant < edgeVariantCount(material); variant += 1) {
        frames.push({
          id: `e.${material}.${mask}.${variant}`,
          kind: "edge",
          material,
          mask,
          variant,
        });
      }
    }
  }
  for (const material of SHORE_MATERIALS) {
    for (const mask of EDGE_MASKS) {
      for (let variant = 0; variant < SHORE_VARIANTS; variant += 1) {
        frames.push({
          id: `w.${material}.${mask}.${variant}`,
          kind: "shore",
          material,
          mask,
          variant,
        });
      }
    }
  }
  return frames;
}

const TERRAIN_COLUMNS = 16;

const SCENERY_SPECS = Object.freeze([
  { id: "willow", width: 112, height: 118, variants: 6, pivot: [56, 110] },
  { id: "birch", width: 72, height: 106, variants: 6, pivot: [36, 100] },
  { id: "broadleaf", width: 88, height: 94, variants: 8, pivot: [44, 88] },
  { id: "conifer", width: 60, height: 96, variants: 5, pivot: [30, 92] },
  { id: "shrub", width: 48, height: 48, variants: 6, pivot: [24, 45] },
  { id: "reedclump", width: 44, height: 84, variants: 6, pivot: [22, 80] },
  { id: "reedwater", width: 44, height: 84, variants: 4, pivot: [22, 80] },
  { id: "boulder", width: 44, height: 36, variants: 5, pivot: [22, 33] },
  { id: "outcrop", width: 40, height: 30, variants: 4, pivot: [20, 27] },
  { id: "cobble", width: 20, height: 14, variants: 4, pivot: [10, 12] },
  { id: "flowerdrift", width: 56, height: 40, variants: 6, pivot: [28, 37] },
  { id: "tuft", width: 24, height: 18, variants: 4, pivot: [12, 16] },
  { id: "driftwood", width: 48, height: 20, variants: 2, pivot: [24, 17] },
  { id: "scarpface", width: 88, height: 54, variants: 4, pivot: [44, 48] },
  { id: "scarpcornerout", width: 48, height: 46, variants: 2, pivot: [24, 41] },
  { id: "scarpcornerin", width: 48, height: 46, variants: 2, pivot: [24, 41] },
  { id: "steppingstone", width: 26, height: 16, variants: 3, pivot: [13, 13] },
  { id: "bridgedeckh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgedeckv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgepier", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgewornh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgewornv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgedeckdne", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgedeckdnw", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgeramph", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgerampv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgeposth", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgepostv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgearchh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgearchv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgearchpier", width: 32, height: 32, variants: 2, pivot: [16, 31] },
]);

const BRIDGE_TIMBER = Object.freeze({
  edge: [88, 64, 42],
  seam: [116, 84, 52],
  body: [152, 112, 70],
  worn: [172, 132, 84],
  lit: [192, 147, 92],
  fresh: [214, 180, 130],
});

const BRIDGE_STONE = Object.freeze({
  outline: [48, 44, 36],
  shade: [78, 72, 58],
  body: [112, 104, 86],
  face: [138, 129, 106],
  lit: [174, 164, 136],
});

const BRIDGE_SHADOW = Object.freeze([12, 20, 24]);

function paintBridgeDeck(surface, ox, oy, spec, variant, vertical, wear = false) {
  const seed = 27_000 + variant * 1117 + (wear ? 733 : 0);
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across),
      BRIDGE_SHADOW, alpha);
  };
  const size = spec.width;
  const missing = wear ? 3 + Math.floor(hash2(variant, 5, seed) * 3) : -1;
  const replaced = wear ? 1 + Math.floor(hash2(variant, 9, seed) * 6) : -1;

  for (let along = 0; along < size; along += 1) {
    const plank = Math.floor(along / 4);
    const seam = along % 4 === 0;
    const worn = hash2(plank, variant, seed) > 0.62;
    const peg = along % 8 === 3;
    if (plank === missing) {
      for (const across of [3, 4, 25, 26]) place(along, across, BRIDGE_TIMBER.edge);
      place(along, 5, BRIDGE_TIMBER.lit);
      place(along, 24, BRIDGE_TIMBER.seam);
      for (let s = 0; s < 5; s += 1) shade(along, 27 + s, [0.66, 0.54, 0.40, 0.26, 0.13][s]);
      continue;
    }
    for (let across = 3; across <= 26; across += 1) {
      let colour;
      if (across <= 4 || across >= 25) colour = BRIDGE_TIMBER.edge;
      else if (across === 5) colour = BRIDGE_TIMBER.lit;
      else if (across === 24) colour = BRIDGE_TIMBER.seam;
      else if (seam) colour = BRIDGE_TIMBER.seam;
      else if (plank === replaced) colour = BRIDGE_TIMBER.fresh;
      else colour = worn ? BRIDGE_TIMBER.worn : BRIDGE_TIMBER.body;
      if (across === 6 || across === 23) colour = BRIDGE_TIMBER.edge;
      if (wear && !seam && plank !== replaced && across >= 13 && across <= 17) {
        colour = BRIDGE_TIMBER.worn;
      }
      place(along, across, colour);
    }
    if (peg) {
      place(along, 7, BRIDGE_TIMBER.edge);
      place(along, 22, BRIDGE_TIMBER.edge);
    }
    if (wear && hash2(along, variant, seed + 3) > 0.45) {
      place(along, 25, ACCENT.moss);
      if (hash2(along, variant, seed + 5) > 0.6) place(along, 24, ACCENT.moss);
    }
    const falloff = [0.66, 0.54, 0.40, 0.26, 0.13];
    for (let s = 0; s < falloff.length; s += 1) shade(along, 27 + s, falloff[s]);
    shade(along, 2, 0.30);
    shade(along, 1, 0.14);
  }
}

function paintBridgeDeckDiagonal(surface, ox, oy, spec, variant, rising) {
  const seed = 31_000 + variant * 1327 + (rising ? 17 : 0);
  const size = spec.width;
  const half = 10;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const across = rising ? (x + y - size + 1) / Math.SQRT2 : (x - y) / Math.SQRT2;
      const along = rising ? (x - y) / Math.SQRT2 : (x + y - size + 1) / Math.SQRT2;
      const distance = Math.abs(across);
      if (distance > half + 5) continue;
      if (distance > half) {
        const shadowSide = rising ? across > 0 : across > 0;
        if (shadowSide) {
          veil(surface, ox + x, oy + y, BRIDGE_SHADOW, 0.66 - (distance - half) * 0.13);
        }
        continue;
      }
      const plank = Math.floor((along + 64) / 4);
      const seam = Math.abs(((along + 64) % 4)) < 1;
      const worn = hash2(plank, variant, seed) > 0.62;
      let colour;
      if (distance > half - 2) colour = BRIDGE_TIMBER.edge;
      else if (distance > half - 3) colour = across < 0 ? BRIDGE_TIMBER.lit : BRIDGE_TIMBER.seam;
      else if (distance > half - 4) colour = BRIDGE_TIMBER.edge;
      else if (seam) colour = BRIDGE_TIMBER.seam;
      else colour = worn ? BRIDGE_TIMBER.body : BRIDGE_TIMBER.seam;
      if (plank % 2 === 0 && distance < 2) colour = BRIDGE_TIMBER.edge;
      put(surface, ox + x, oy + y, colour);
    }
  }
}

function paintBridgeRamp(surface, ox, oy, spec, variant, vertical) {
  const seed = 33_000 + variant * 1439;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const size = spec.width;
  for (let along = 0; along < size; along += 1) {
    const middle = 1 - Math.abs(along - (size - 1) / 2) / ((size - 1) / 2);
    const spread = Math.round(middle * 3);
    const from = 3 - spread;
    const to = 26 + spread;
    const nosing = along === 3 || along === size - 4;
    for (let across = Math.max(0, from); across <= Math.min(size - 1, to); across += 1) {
      let colour;
      if (across <= from + 1 || across >= to - 1) colour = BRIDGE_TIMBER.edge;
      else if (across === from + 2) colour = BRIDGE_TIMBER.lit;
      else if (nosing) colour = BRIDGE_TIMBER.fresh;
      else if (along % 5 === 0) colour = BRIDGE_TIMBER.seam;
      else {
        colour = hash2(Math.floor(along / 5), variant, seed) > 0.5
          ? BRIDGE_TIMBER.worn
          : BRIDGE_TIMBER.body;
      }
      place(along, across, colour);
    }
    const silt = tone(PALETTES.silt, 0.30 + hash2(along, variant, seed + 7) * 0.34);
    for (let bleed = 1; bleed <= 3; bleed += 1) {
      if (hash2(along, bleed, seed + 11) > 0.34 + bleed * 0.14) {
        place(along, Math.max(0, from - bleed), silt);
        place(along, Math.min(size - 1, to + bleed), silt);
      }
    }
    veil(surface, ox + (vertical ? Math.min(size - 1, to + 1) : along),
      oy + (vertical ? along : Math.min(size - 1, to + 1)), BRIDGE_SHADOW, 0.5);
  }
  for (const end of [1, size - 2]) {
    for (let across = 4; across <= 25; across += 1) place(end, across, BRIDGE_TIMBER.edge);
  }
  for (let along = 0; along < 6; along += 1) {
    for (const end of [along, size - 1 - along]) {
      place(end, 4, BRIDGE_TIMBER.edge);
      place(end, 25, BRIDGE_TIMBER.edge);
    }
  }
}

function paintBridgePost(surface, ox, oy, spec, variant, vertical) {
  const seed = 35_000 + variant * 1553;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across),
      BRIDGE_SHADOW, alpha);
  };
  const at = 12 + Math.floor(hash2(variant, 1, seed) * 6);
  for (const across of [5, 24]) {
    const height = across === 5 ? 9 : 8;
    for (let rise = 0; rise < height; rise += 1) {
      for (let width = 0; width < 3; width += 1) {
        const colour = width === 0
          ? BRIDGE_TIMBER.lit
          : width === 2 ? BRIDGE_TIMBER.edge : BRIDGE_TIMBER.body;
        place(at + width, across - rise, colour);
      }
    }
    place(at, across - height, BRIDGE_TIMBER.fresh);
    place(at + 1, across - height, BRIDGE_TIMBER.worn);
    for (let cast = 1; cast <= 5; cast += 1) shade(at + 3 + cast, across + 1, 0.5 - cast * 0.08);
  }
}

function paintBridgeArch(surface, ox, oy, spec, variant, vertical) {
  const seed = 37_000 + variant * 1667;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across),
      BRIDGE_SHADOW, alpha);
  };
  for (let along = 0; along < spec.width; along += 1) {
    const block = Math.floor(along / 7);
    const joint = along % 7 === 0;
    for (let across = 2; across <= 27; across += 1) {
      let colour;
      if (across <= 3) colour = across === 2 ? BRIDGE_STONE.lit : BRIDGE_STONE.face;
      else if (across === 4) colour = BRIDGE_STONE.shade;
      else if (across >= 26) colour = BRIDGE_STONE.shade;
      else if (across === 25) colour = BRIDGE_STONE.outline;
      else {
        const pick = hash2(block, across, seed);
        colour = across >= 13 && across <= 17
          ? BRIDGE_STONE.lit
          : pick > 0.62 ? BRIDGE_STONE.face : BRIDGE_STONE.body;
      }
      if (joint && across > 4 && across < 25) colour = BRIDGE_STONE.shade;
      place(along, across, colour);
    }
    const falloff = [0.68, 0.54, 0.38, 0.22];
    for (let s = 0; s < falloff.length; s += 1) shade(along, 28 + s, falloff[s]);
    shade(along, 1, 0.28);
  }
}

function paintBridgePier(surface, ox, oy, spec, variant, springing = false) {
  const { width } = spec;
  const seed = 29_000 + variant * 1229 + (springing ? 401 : 0);
  const left = 1;
  const right = 28;
  const top = 1;
  const bottom = 28;

  paintContactShadow(surface, ox, oy, (left + right) / 2, bottom + 2, 13.5, 4.6, 0.58);

  const courseHeight = 7;
  for (let y = top; y <= bottom; y += 1) {
    const course = Math.floor((y - top) / courseHeight);
    const stagger = course % 2 === 0 ? 0 : 5;
    for (let x = left; x <= right; x += 1) {
      const outline = x === left || x === right || y === top || y === bottom;
      const jointRow = (y - top) % courseHeight === 0;
      const jointColumn = (x - left + stagger) % 10 === 0;
      const stone = Math.floor((x - left + stagger) / 10) * 7 + course;
      const pick = hash2(stone, variant, seed);
      let colour = pick > 0.66
        ? BRIDGE_STONE.face
        : pick > 0.30 ? BRIDGE_STONE.body : BRIDGE_STONE.shade;
      if (y <= top + 2) colour = BRIDGE_STONE.lit;
      else if (x <= left + 1) colour = BRIDGE_STONE.face;
      else if (y >= bottom - 3 || x >= right - 2) colour = BRIDGE_STONE.shade;
      if (jointRow || jointColumn) colour = BRIDGE_STONE.shade;
      if (outline) colour = BRIDGE_STONE.outline;
      if (springing && !outline) {
        const dx = (x - (left + right) / 2) / 11;
        const dy = (bottom - y) / 15;
        if (dx * dx + dy * dy < 1 && y > top + 8) colour = BRIDGE_STONE.outline;
      }
      if (!outline && hash2(x, y, seed + 7) > 0.92) colour = BRIDGE_STONE.lit;
      put(surface, ox + x, oy + y, colour);
    }
  }

  for (let index = 0; index < 11; index += 1) {
    const x = Math.round(width * (0.04 + hash2(index, variant, seed + 11) * 0.92));
    const y = Math.round(bottom + hash2(index, variant, seed + 13) * 3.4);
    const colour = index % 2 === 0 ? BRIDGE_STONE.body : BRIDGE_STONE.face;
    put(surface, ox + x, oy + y, colour);
    if (hash2(index, variant, seed + 17) > 0.5) {
      put(surface, ox + x + 1, oy + y, colour);
      put(surface, ox + x, oy + y - 1, BRIDGE_STONE.lit);
    }
  }
}

function paintWillow(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 41_000 + variant * 1783;
  const tier = [0.76, 0.88, 1.0, 0.80, 0.94, 1.0][variant % 6];
  const centerX = width / 2 + (hash2(variant, 1, seed) - 0.5) * 8;
  const footY = height - 6;
  const crownY = footY - height * 0.58 * tier;
  const crownRX = width * 0.42 * tier;
  const crownRY = height * 0.26 * tier;

  const leaders = 2 + (variant % 2);
  for (let leader = 0; leader < leaders; leader += 1) {
    const spreadAt = footY - height * 0.16 * tier;
    const tipX = centerX + (leader - (leaders - 1) / 2) * crownRX * 0.62;
    const tipY = crownY + crownRY * 0.5;
    for (let y = footY; y >= tipY; y -= 1) {
      const t = (footY - y) / Math.max(1, footY - tipY);
      const x = y > spreadAt
        ? centerX + (hash2(0, y, seed) - 0.5) * 1.2
        : centerX + (tipX - centerX) * ((spreadAt - y) / Math.max(1, spreadAt - tipY)) ** 0.8;
      const halfWidth = Math.max(0.6, (y > spreadAt ? 3.4 : 2.2) * (1 - t * 0.72) * tier);
      for (let dx = -Math.ceil(halfWidth); dx <= Math.ceil(halfWidth); dx += 1) {
        if (Math.abs(dx) > halfWidth) continue;
        const shade = dx < -halfWidth * 0.3 ? 4 : dx > halfWidth * 0.4 ? 1 : 3;
        put(surface, ox + Math.round(x) + dx, oy + y, step(BARK, shade));
      }
    }
  }

  const hemBase = crownY + crownRY * 0.30;
  for (let x = Math.round(centerX - crownRX * 1.08); x <= centerX + crownRX * 1.08; x += 1) {
    const across = (x - centerX) / crownRX;
    if (Math.abs(across) > 1.08) continue;
    const profile = Math.cos(across * 1.34) ** 0.8;
    const jitter = fbm(x * 0.42 + variant * 13, 0.5, seed + 7, 3) - 0.5;
    const hemTop = hemBase + Math.abs(across) * crownRY * 0.34;
    const hem = hemTop + (height * 0.36 * tier) * profile * (0.74 + jitter * 0.62);
    if (hem <= hemTop) continue;
    const strand = hash2(x, variant, seed + 11);
    const base = strand > 0.72 ? 4 : strand > 0.34 ? 3 : 2;
    const sway = Math.round((hash2(x, variant, seed + 13) - 0.5) * 1.6);
    for (let y = Math.round(hemTop); y < hem; y += 1) {
      const t = (y - hemTop) / Math.max(1, hem - hemTop);
      let index = base;
      if (t > 0.78) index += 1;
      if (hash2(x, Math.floor(y / 3), seed + 17) > 0.80) index -= 1;
      if (t > 0.90 && hash2(x, y, seed + 19) > 0.55) continue;
      put(surface, ox + x + Math.round(sway * t), oy + y, step(WILLOW_LEAF, index));
    }
  }

  for (let y = Math.floor(crownY - crownRY * 1.3); y <= crownY + crownRY * 1.1; y += 1) {
    for (let x = Math.floor(centerX - crownRX * 1.15); x <= centerX + crownRX * 1.15; x += 1) {
      const dx = (x - centerX) / crownRX;
      const dy = (y - crownY) / crownRY;
      const lobe = fbm(x * 0.16 + variant * 7, y * 0.22, seed + 3, 3);
      const radius = Math.hypot(dx, dy * (dy < 0 ? 0.94 : 1.6));
      if (radius > 0.80 + lobe * 0.34) continue;
      const lit = 0.54 - dy * 0.80 - dx * 0.26 + (fbm(x * 0.4, y * 0.4, seed + 5, 2) - 0.5) * 0.62;
      put(surface, ox + x, oy + y, step(WILLOW_LEAF, level(WILLOW_LEAF, lit)));
    }
  }

  for (let y = Math.round(crownY + crownRY * 0.5); y < crownY + crownRY * 1.1; y += 1) {
    for (let x = Math.round(centerX - crownRX * 0.8); x < centerX + crownRX * 0.8; x += 1) {
      if (hash2(x, y, seed + 23) > 0.46) continue;
      const index = (oy + y) * surface.width + (ox + x);
      if (surface.data[index * 4 + 3] === 0) continue;
      put(surface, ox + x, oy + y, WILLOW_LEAF[0]);
    }
  }
}

function paintCanopy(surface, ox, oy, spec, variant, shape) {
  const { width, height } = spec;
  const seed = 9000 + variant * 271 + spec.id.length * 37;
  const centerX = width / 2;
  const tier = shape.tiers[variant % shape.tiers.length];
  const crownY = height * shape.crownY * (0.94 + tier * 0.10);
  const radiusX = width * shape.radiusX * tier;
  const radiusY = height * shape.radiusY * tier;
  const trunkTop = crownY + radiusY * shape.trunkFrom;
  for (let y = Math.floor(trunkTop); y < height - 2; y += 1) {
    const taper = 1 + (y - trunkTop) / Math.max(1, height - trunkTop) * 1.2;
    const halfWidth = shape.trunkWidth * taper * tier;
    const lean = Math.sin((y / height) * 2.2 + variant) * shape.lean;
    for (let x = Math.floor(centerX - halfWidth + lean); x <= centerX + halfWidth + lean; x += 1) {
      const t = (x - (centerX + lean)) / Math.max(0.6, halfWidth);
      put(surface, ox + x, oy + y, step(BARK, level(BARK, 0.34 + (1 - Math.abs(t)) * 0.5)));
    }
  }
  const lobes = shape.lobes;
  for (let index = 0; index < lobes; index += 1) {
    const angle = (index / lobes) * Math.PI * 2 + variant * 0.7;
    const lobeX = centerX + Math.cos(angle) * radiusX * shape.lobeSpread;
    const lobeY = crownY + Math.sin(angle) * radiusY * shape.lobeSpread * 0.7;
    const lobeRX = radiusX * shape.lobeSize;
    const lobeRY = radiusY * shape.lobeSize;
    for (let y = Math.floor(lobeY - lobeRY); y <= lobeY + lobeRY; y += 1) {
      for (let x = Math.floor(lobeX - lobeRX); x <= lobeX + lobeRX; x += 1) {
        const dx = (x - lobeX) / lobeRX;
        const dy = (y - lobeY) / lobeRY;
        const dist = Math.hypot(dx, dy);
        const edge = fbm(x * 0.20 + index * 13, y * 0.20 + index * 7, seed, 3);
        if (dist > 0.72 + edge * 0.42) continue;
        const lit = 0.56 - dy * 1.05 - dx * 0.40
          + (fbm(x * 0.42, y * 0.42, seed + 41, 3) - 0.5) * 0.62;
        const clump = fbm(x * 0.26 + index * 5, y * 0.26 + index * 3, seed + 43, 2);
        put(surface, ox + x, oy + y, step(shape.leaf, level(shape.leaf, lit) + (clump > 0.60 ? 1 : clump < 0.40 ? -1 : 0)));
      }
    }
  }
}

function paintBirch(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 11_000 + variant * 313;
  const trunks = 2 + (variant % 3);
  for (let index = 0; index < trunks; index += 1) {
    const baseX = Math.round(width * (0.22 + index * 0.22 + hash2(index, variant, seed) * 0.10));
    const top = Math.round(height * (0.10 + hash2(index, variant, seed + 3) * 0.14));
    for (let y = top; y < height - 3; y += 1) {
      const lean = Math.round(Math.sin(y * 0.02 + index) * 2.0);
      for (let dx = -2; dx <= 2; dx += 1) {
        const shade = dx <= -1 ? 1 : dx >= 2 ? 0 : 4;
        const colour = hash2(baseX + dx, y, seed + 7) > 0.93
          ? BIRCH_BARK[0]
          : step(BIRCH_BARK, shade);
        put(surface, ox + baseX + dx + lean, oy + y, colour);
      }
    }
  }
  for (let y = 0; y < height * 0.62; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width / 2) / (width * 0.52);
      const dy = (y - height * 0.26) / (height * 0.30);
      const dist = Math.hypot(dx, dy);
      const edge = fbm(x * 0.24, y * 0.24, seed + 11, 3);
      if (dist > 0.60 + edge * 0.62) continue;
      const clump = fbm(x * 0.30, y * 0.30, seed + 17, 2);
      if (hash2(x, y, seed + 13) > 0.34 + clump * 0.42) continue;
      const lit = 0.54 - dy * 0.78 - dx * 0.30 + (edge - 0.5) * 0.8;
      put(surface, ox + x, oy + y, step(CANOPY_LEAF, level(CANOPY_LEAF, lit) + 1));
    }
  }
}

function paintReedClump(surface, ox, oy, spec, variant, inWater) {
  const { width, height } = spec;
  const seed = 13_000 + variant * 419 + (inWater ? 97 : 0);
  const palette = PALETTES.reed;
  const stalks = 54 + variant * 8;
  for (let index = 0; index < stalks; index += 1) {
    const baseX = Math.round(width * (0.10 + hash2(index, variant, seed) * 0.80));
    const length = Math.round(height * (0.42 + hash2(index, variant, seed + 3) * 0.54));
    const bend = (hash2(index, variant, seed + 5) - 0.5) * 9;
    const base = level(palette, 0.20 + hash2(index, variant, seed + 7) * 0.56);
    for (let s = 0; s < length; s += 1) {
      const t = s / length;
      const y = height - 3 - s;
      const x = Math.round(baseX + bend * t * t);
      put(surface, ox + x, oy + y, step(palette, base + Math.round(t * 2)));
      if (t < 0.55 && hash2(x, y, seed + 11) > 0.48) {
        put(surface, ox + x + 1, oy + y, step(palette, base - 1));
      }
    }
    if (hash2(index, variant, seed + 13) > 0.58) {
      const headY = height - 3 - length;
      const headX = Math.round(baseX + bend);
      for (let s = 0; s < 4; s += 1) put(surface, ox + headX, oy + headY - s, ACCENT.twig);
      put(surface, ox + headX + 1, oy + headY - 1, ACCENT.twig);
    }
  }
  if (inWater) {
    for (let y = height - 3; y < height; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        if (hash2(x, y, seed + 17) > 0.42) continue;
        put(surface, ox + x, oy + y, tone(RIVER, y === height - 3 ? 0.72 : 0.86));
      }
    }
  }
}

function paintBoulder(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 15_000 + variant * 523;
  const palette = PALETTES.rock;
  const cx = width / 2;
  const cy = height * 0.56;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / (width * 0.46);
      const dy = (y - cy) / (height * 0.46);
      const wobble = fbm(x * 0.16 + variant * 9, y * 0.16, seed, 3) - 0.5;
      if (Math.hypot(dx, dy) > 0.94 + wobble * 0.36) continue;
      const lit = 0.60 - dy * 0.62 - dx * 0.30 + (fbm(x * 0.3, y * 0.3, seed + 7, 3) - 0.5) * 0.55;
      const colour = fbm(x * 0.5, y * 0.18, seed + 11, 2) > 0.70
        ? ACCENT.lichen
        : step(palette, level(palette, lit));
      put(surface, ox + x, oy + y, colour);
    }
  }
  for (let x = 2; x < width - 2; x += 1) {
    const span = Math.sin((x / width) * Math.PI);
    if (span < 0.25) continue;
    veil(surface, ox + x, oy + height - 2, ACCENT.shadow, 0.44 * span);
    veil(surface, ox + x, oy + height - 1, ACCENT.shadow, 0.24 * span);
  }
}

function paintScatter(surface, ox, oy, spec, variant, palette, density, tall) {
  const { width, height } = spec;
  const seed = 17_000 + variant * 617 + spec.id.length * 41;
  for (let index = 0; index < density; index += 1) {
    const bx = Math.round(width * (0.08 + hash2(index, variant, seed) * 0.84));
    const by = Math.round(height * (0.45 + hash2(index, variant, seed + 3) * 0.50));
    const length = 2 + Math.round(hash2(index, variant, seed + 5) * tall);
    const bend = (hash2(index, variant, seed + 7) - 0.5) * 2.2;
    const base = level(palette, 0.28 + hash2(index, variant, seed + 9) * 0.42);
    for (let s = 0; s < length; s += 1) {
      const t = s / Math.max(1, length);
      put(
        surface,
        ox + Math.round(bx + bend * t),
        oy + by - s,
        step(palette, base + Math.round(t * 2)),
      );
    }
  }
}

function paintFlowerDrift(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 19_000 + variant * 719;
  const dense = variant < 3;
  const colourways = [
    [ACCENT.flowerYellow, ACCENT.flowerWhite],
    [ACCENT.flowerWhite, ACCENT.flowerYellow],
    [ACCENT.flowerPurple, ACCENT.flowerPurpleDeep],
  ];
  const [petal, secondary] = colourways[variant % 3];
  const cx = width / 2;
  const cy = height * 0.62;
  const rx = width * (dense ? 0.44 : 0.48);
  const ry = height * (dense ? 0.34 : 0.30);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      const edge = fbm(x * 0.18 + variant * 11, y * 0.18, seed, 3);
      if (d > 0.86 + edge * 0.36) continue;
      if (hash2(x, y, seed + 3) > 0.52) continue;
      const lit = 0.30 + (1 - d) * 0.36 + (edge - 0.5) * 0.5;
      put(surface, ox + x, oy + y, step(PALETTES.meadow, level(PALETTES.meadow, lit)));
    }
  }
  const count = dense ? 460 : 330;
  for (let index = 0; index < count; index += 1) {
    const angle = hash2(index, variant, seed + 5) * Math.PI * 2;
    const radius = Math.sqrt(hash2(index, variant, seed + 7));
    const x = Math.round(cx + Math.cos(angle) * rx * radius);
    const y = Math.round(cy + Math.sin(angle) * ry * radius);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const colour = radius > 0.74 && hash2(index, variant, seed + 9) > 0.5 ? secondary : petal;
    put(surface, ox + x, oy + y, colour);
    if (radius < 0.82 && hash2(index, variant, seed + 11) > 0.30) {
      put(surface, ox + x + 1, oy + y, colour);
    }
    if (radius < 0.52 && hash2(index, variant, seed + 13) > 0.42) {
      put(surface, ox + x, oy + y - 1, colour);
    }
  }
}

function paintDriftwood(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 21_000 + variant * 811;
  const palette = PALETTES.gravel;
  for (let x = 2; x < width - 2; x += 1) {
    const t = x / width;
    const centerY = height * 0.58 + Math.sin(t * 2.4 + variant) * 2.4;
    const thickness = 3 + Math.sin(t * Math.PI) * 2.6;
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      const lit = 0.72 - (dy / thickness) * 0.5 + (fbm(x * 0.5, dy * 0.6, seed, 2) - 0.5) * 0.5;
      put(surface, ox + x, oy + Math.round(centerY + dy), step(palette, level(palette, lit)));
    }
  }
}

function paintScarp(surface, ox, oy, spec, variant, turn) {
  const { width, height } = spec;
  const seed = 23_000 + variant * 907 + (turn + 1) * 313;
  const palette = SCARP_ROCK;
  const faceTop = height * 0.16;
  const faceHeight = height * (0.44 + hash2(0, variant, seed) * 0.10);

  for (let x = 0; x < width; x += 1) {
    const fromEnd = Math.min(x, width - 1 - x) / (width * 0.16);
    const taper = clamp01(fromEnd) ** 0.45;
    if (taper <= 0.02) continue;

    const swing = turn === 0
      ? 0
      : (Math.abs(x - width / 2) / (width / 2)) * (turn > 0 ? -5 : 5);
    const ragged = (fbm(x * 0.24, variant * 3.7, seed + 17, 3) - 0.5) * 3.4;
    const lip = faceTop + ragged + swing + (1 - taper) * faceHeight * 0.5;
    const foot = lip + faceHeight * taper
      + (fbm(x * 0.18, variant * 5.1, seed + 23, 2) - 0.5) * 4.0;

    for (let y = Math.round(lip) - 2; y < lip + 1; y += 1) {
      put(surface, ox + x, oy + y, palette[0]);
    }

    const group = Math.floor(x / 17);
    const columnWidth = 8 + Math.floor(hash2(group, variant, seed + 37) * 9);
    const columnStart = group * 17 + Math.floor(hash2(group, variant, seed + 39) * 5);
    const inColumn = ((x - columnStart) % columnWidth + columnWidth) % columnWidth;
    const columnTone = level(palette, 0.18 + hash2(Math.floor(x / columnWidth), variant, seed + 41) * 0.24);
    const catchesLight = hash2(Math.floor(x / columnWidth), variant, seed + 43) > 0.58;
    const facet = turn === 0 ? 0 : (x < width / 2 ? (turn > 0 ? 1 : -1) : (turn > 0 ? -1 : 1));
    const arris = turn !== 0 && Math.abs(x - width / 2) < 2;
    for (let y = Math.round(lip) + 1; y < foot; y += 1) {
      const depth = (y - lip) / Math.max(1, foot - lip);
      let index = columnTone + facet;
      if (inColumn === 0 && catchesLight) index += 1;
      else if (inColumn >= columnWidth - 2) index -= 1;
      if (depth < 0.18) index -= 1;
      if (depth > 0.70) index -= 1;
      if (hash2(chunky(x), chunky(y), seed + 47) > 0.72) index -= 1;
      else if (hash2(chunky(x), chunky(y), seed + 53) > 0.88) index += 1;
      if (arris) index = columnTone + 2;
      if (turn < 0 && Math.abs(x - width / 2) < 3) index = columnTone - 2;
      const damp = fbm(x * 0.20, y * 0.20, seed + 59, 3);
      put(surface, ox + x, oy + y, damp > 0.84 ? ACCENT.lichen : step(palette, index));
    }

    for (let y = Math.round(foot); y < Math.min(height, foot + 6); y += 1) {
      const fade = 1 - (y - foot) / 6;
      veil(surface, ox + x, oy + y, ACCENT.shadow, 0.58 * fade * fade * taper);
    }
  }

  for (let index = 0; index < 22; index += 1) {
    const x = Math.round(width * (0.10 + hash2(index, variant, seed + 61) * 0.80));
    const y = Math.round(height * (0.68 + hash2(index, variant, seed + 67) * 0.26));
    const colour = step(PALETTES.rock, level(PALETTES.rock, 0.22 + hash2(index, variant, seed + 71) * 0.46));
    put(surface, ox + x, oy + y, colour);
    if (hash2(index, variant, seed + 73) > 0.5) put(surface, ox + x + 1, oy + y, colour);
    if (hash2(index, variant, seed + 79) > 0.7) {
      put(surface, ox + x, oy + y - 1, step(PALETTES.rock, PALETTES.rock.length - 1));
    }
  }
}

function paintSteppingStone(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 25_000 + variant * 1009;
  const palette = PALETTES.rock;
  const cx = width / 2;
  const cy = height * 0.54;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - cx) / (width * 0.46);
      const dy = (y - cy) / (height * 0.44);
      const wobble = fbm(x * 0.3 + variant * 4, y * 0.3, seed, 2) - 0.5;
      if (Math.hypot(dx, dy) > 0.92 + wobble * 0.30) continue;
      const lit = 0.66 - dy * 0.5 + (fbm(x * 0.5, y * 0.5, seed + 3, 2) - 0.5) * 0.5;
      put(surface, ox + x, oy + y, step(palette, level(palette, lit)));
    }
  }
  for (let x = 1; x < width - 1; x += 1) {
    veil(surface, ox + x, oy + height - 1, ACCENT.shadow, 0.34);
  }
}

const CANOPY_SHAPES = Object.freeze({
  broadleaf: {
    leaf: CANOPY_LEAF,
    tiers: [0.72, 0.82, 0.91, 1.0, 0.76, 0.86, 0.95, 1.0],
    crownY: 0.32, radiusX: 0.50, radiusY: 0.34, lobes: 8, lobeSpread: 0.46, lobeSize: 0.66,
    trunkFrom: 0.62, trunkWidth: 3.0, lean: 1.0,
  },
  conifer: {
    leaf: CONIFER_LEAF,
    tiers: [0.74, 0.84, 0.92, 1.0, 0.79],
    crownY: 0.38, radiusX: 0.40, radiusY: 0.44, lobes: 6, lobeSpread: 0.30, lobeSize: 0.62,
    trunkFrom: 0.82, trunkWidth: 2.4, lean: 0.4,
  },
  shrub: {
    leaf: CANOPY_LEAF,
    tiers: [0.70, 0.84, 1.0, 0.76, 0.92, 1.0],
    crownY: 0.44, radiusX: 0.48, radiusY: 0.42, lobes: 6, lobeSpread: 0.42, lobeSize: 0.62,
    trunkFrom: 0.88, trunkWidth: 1.8, lean: 0.4,
  },
});

/**
 * Dispatch one procedural scenery sprite by spec id - copied from
 * `buildSceneryAtlas`'s inline switch in the pilot script, unchanged.
 */
function paintSceneryProcedural(surface, ox, oy, spec, variant) {
  switch (spec.id) {
    case "willow":
      paintWillow(surface, ox, oy, spec, variant);
      break;
    case "broadleaf":
    case "conifer":
    case "shrub":
      paintCanopy(surface, ox, oy, spec, variant, CANOPY_SHAPES[spec.id]);
      break;
    case "birch":
      paintBirch(surface, ox, oy, spec, variant);
      break;
    case "reedclump":
      paintReedClump(surface, ox, oy, spec, variant, false);
      break;
    case "reedwater":
      paintReedClump(surface, ox, oy, spec, variant, true);
      break;
    case "boulder":
    case "cobble":
    case "outcrop":
      paintBoulder(surface, ox, oy, spec, variant);
      break;
    case "flowerdrift":
      paintFlowerDrift(surface, ox, oy, spec, variant);
      break;
    case "tuft":
      paintScatter(surface, ox, oy, spec, variant, PALETTES.sungrass, 30, 8);
      break;
    case "driftwood":
      paintDriftwood(surface, ox, oy, spec, variant);
      break;
    case "scarpface":
      paintScarp(surface, ox, oy, spec, variant, 0);
      break;
    case "scarpcornerout":
      paintScarp(surface, ox, oy, spec, variant, 1);
      break;
    case "scarpcornerin":
      paintScarp(surface, ox, oy, spec, variant, -1);
      break;
    case "steppingstone":
      paintSteppingStone(surface, ox, oy, spec, variant);
      break;
    case "bridgedeckh":
      paintBridgeDeck(surface, ox, oy, spec, variant, false, false);
      break;
    case "bridgedeckv":
      paintBridgeDeck(surface, ox, oy, spec, variant, true, false);
      break;
    case "bridgewornh":
      paintBridgeDeck(surface, ox, oy, spec, variant, false, true);
      break;
    case "bridgewornv":
      paintBridgeDeck(surface, ox, oy, spec, variant, true, true);
      break;
    case "bridgedeckdne":
      paintBridgeDeckDiagonal(surface, ox, oy, spec, variant, true);
      break;
    case "bridgedeckdnw":
      paintBridgeDeckDiagonal(surface, ox, oy, spec, variant, false);
      break;
    case "bridgeramph":
      paintBridgeRamp(surface, ox, oy, spec, variant, false);
      break;
    case "bridgerampv":
      paintBridgeRamp(surface, ox, oy, spec, variant, true);
      break;
    case "bridgeposth":
      paintBridgePost(surface, ox, oy, spec, variant, false);
      break;
    case "bridgepostv":
      paintBridgePost(surface, ox, oy, spec, variant, true);
      break;
    case "bridgearchh":
      paintBridgeArch(surface, ox, oy, spec, variant, false);
      break;
    case "bridgearchv":
      paintBridgeArch(surface, ox, oy, spec, variant, true);
      break;
    case "bridgepier":
      paintBridgePier(surface, ox, oy, spec, variant, false);
      break;
    case "bridgearchpier":
      paintBridgePier(surface, ox, oy, spec, variant, true);
      break;
    default:
      throw new Error(`unhandled scenery ${spec.id}`);
  }
}

/**
 * Encode a surface as an 8-bit INDEXED PNG, losslessly. Copied verbatim from
 * `author-nirvana-valley-pilot-art.mjs` - see that file's doc comment for why
 * `sharp`'s `palette: true` quantiser is never used here.
 */
function encodeIndexedPng(surface) {
  const { width, height, data } = surface;
  const keyOf = (index) => (
    ((data[index] << 24) | (data[index + 1] << 16) | (data[index + 2] << 8) | data[index + 3]) >>> 0
  );
  const seen = new Map();
  for (let index = 0; index < data.length; index += 4) {
    const key = keyOf(index);
    if (!seen.has(key)) {
      seen.set(key, [data[index], data[index + 1], data[index + 2], data[index + 3]]);
    }
  }
  if (seen.size > 256) {
    throw new Error(
      `palette discipline broken: ${seen.size} distinct RGBA values, 256 is the ceiling`,
    );
  }
  const entries = [...seen.entries()].sort((left, right) => {
    const [, a] = left;
    const [, b] = right;
    if (a[3] !== b[3]) return a[3] - b[3];
    const luma = (c) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
    return luma(a) - luma(b);
  });
  const indexOfKey = new Map(entries.map(([key], index) => [key, index]));

  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      raw[rowStart + x] = indexOfKey.get(keyOf((y * width + x) * 4));
    }
  }

  const chunk = (type, body) => {
    const out = Buffer.allocUnsafe(body.length + 12);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 4, "latin1");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 3;
  const plte = Buffer.alloc(entries.length * 3);
  const trns = Buffer.alloc(entries.length);
  entries.forEach(([, colour], index) => {
    plte[index * 3] = colour[0];
    plte[index * 3 + 1] = colour[1];
    plte[index * 3 + 2] = colour[2];
    trns[index] = colour[3];
  });
  const opaqueOnly = entries.every(([, colour]) => colour[3] === 255);
  const idat = deflateSync(raw, { level: 9, memLevel: 9, strategy: 0 });
  return {
    png: Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("PLTE", plte),
      ...(opaqueOnly ? [] : [chunk("tRNS", trns)]),
      chunk("IDAT", idat),
      chunk("IEND", Buffer.alloc(0)),
    ]),
    colours: entries.length,
  };
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb8_8320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = -1;
  for (let index = 0; index < buffer.length; index += 1) {
    c = CRC_TABLE[(c ^ buffer[index]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * Encode a sheet with the strict pilot discipline: indexed encoder only,
 * hard-fails if the sheet ever exceeds 256 distinct RGBA values. Used for
 * `terrain.png`, which this script's own design keeps well under that ceiling
 * (the 24 recoloured production frames reuse existing gravel/silt/grass
 * palette entries, adding zero new colours) - so a failure here is a real bug,
 * not an expected fallback path. Returns the encoded buffer; the caller is
 * responsible for writing it to disk (via the atomic publish step below).
 */
async function encodeSurfaceStrict(surface, label) {
  const raw = { raw: { width: surface.width, height: surface.height, channels: 4 } };
  const rgba = await sharp(Buffer.from(surface.data), raw)
    .png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  const indexed = encodeIndexedPng(surface);
  const png = indexed.png.length < rgba.length ? indexed.png : rgba;
  const encoding = indexed.png.length < rgba.length ? "indexed8" : "rgba8";
  await assertLossless(surface, png, label);
  return {
    png,
    bytes: png.length,
    encoding,
    rgbaBytes: rgba.length,
    indexedBytes: indexed.png.length,
    paletteDisciplineBroken: null,
    sha256: sha256(png),
  };
}

/**
 * Encode a sheet, preferring the lossless indexed encoder but falling back to
 * a normal truecolour (non-palette) PNG if the sheet has grown past 256
 * distinct RGBA values - which the 18 blitted landmark sprites can do to
 * `scenery.png`, since they were never authored under this palette's
 * discipline. The fallback is still lossless (sharp's non-palette PNG path is
 * always exact); only the indexed encoder's stricter 256-colour ceiling is
 * relaxed. Returns the encoded buffer; the caller writes it to disk.
 */
async function encodeSurfaceWithFallback(surface, label) {
  const raw = { raw: { width: surface.width, height: surface.height, channels: 4 } };
  const rgba = await sharp(Buffer.from(surface.data), raw)
    .png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  let indexed = null;
  let paletteDisciplineBroken = null;
  try {
    indexed = encodeIndexedPng(surface);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.startsWith("palette discipline broken")) throw error;
    paletteDisciplineBroken = message;
  }
  const preferIndexed = indexed !== null && indexed.png.length < rgba.length;
  const png = preferIndexed ? indexed.png : rgba;
  const encoding = preferIndexed ? "indexed8" : "rgba8";
  await assertLossless(surface, png, label);
  return {
    png,
    bytes: png.length,
    encoding,
    rgbaBytes: rgba.length,
    indexedBytes: indexed ? indexed.png.length : null,
    paletteDisciplineBroken,
    sha256: sha256(png),
  };
}

/** Decode `png` and assert it reproduces `surface.data` byte for byte. */
async function assertLossless(surface, png, label) {
  const back = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let index = 0; index < surface.data.length; index += 4) {
    if (surface.data[index + 3] === 0) {
      if (back[index + 3] !== 0) throw new Error(`${label}: alpha lost at ${index}`);
      continue;
    }
    for (let channel = 0; channel < 4; channel += 1) {
      if (surface.data[index + channel] !== back[index + channel]) {
        throw new Error(`${label}: encoder is not lossless at byte ${index + channel}`);
      }
    }
  }
}

function distinctColours(surface) {
  const seen = new Set();
  for (let index = 0; index < surface.data.length; index += 4) {
    if (surface.data[index + 3] === 0) continue;
    seen.add(
      (surface.data[index] << 24) | (surface.data[index + 1] << 16)
      | (surface.data[index + 2] << 8) | surface.data[index + 3],
    );
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// Copied (pure geometry, unchanged) from build-nirvana-v2-pilot-atlas.mjs
// ---------------------------------------------------------------------------

/** Expand a route mask outward by `radius` cells - road shoulders, swale banks. */
function dilate(mask, radius) {
  const result = new Uint8Array(mask.length);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      for (let dy = -radius; dy <= radius && result[y * TILE + x] === 0; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const nearX = x + dx;
          const nearY = y + dy;
          if (
            nearX >= 0 &&
            nearY >= 0 &&
            nearX < TILE &&
            nearY < TILE &&
            mask[nearY * TILE + nearX] !== 0
          ) {
            result[y * TILE + x] = 1;
            break;
          }
        }
      }
    }
  }
  return result;
}

/** A tile-local road/swale channel mask for the given cardinal `connections`. */
function routeMask(connections, variant, halfWidth = 7, centerRadius = 10) {
  const connected = new Set(connections);
  const mask = new Uint8Array(TILE * TILE);
  const wave = (position) => [0, 0, 1, 0, -1, 0, 1, -1][Math.floor(position / 4) % 8];
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const centerX = 15.5 + wave(y + variant);
      const centerY = 15.5 + wave(x + variant * 2);
      const central = (x - 15.5) ** 2 + (y - 15.5) ** 2 <= centerRadius ** 2;
      const north = connected.has("N") && y <= 16 && Math.abs(x - centerX) <= halfWidth;
      const east = connected.has("E") && x >= 15 && Math.abs(y - centerY) <= halfWidth;
      const south = connected.has("S") && y >= 15 && Math.abs(x - centerX) <= halfWidth;
      const west = connected.has("W") && x <= 16 && Math.abs(y - centerY) <= halfWidth;
      if (central || north || east || south || west) mask[y * TILE + x] = 1;
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// NEW: valley-recoloured road/swale/ford (this script's own contribution)
// ---------------------------------------------------------------------------

// Every one of these six tones is an existing PALETTES.gravel / PALETTES.silt
// entry, already painted somewhere on the terrain sheet by the base/edge/shore
// frames above - so recolouring the 24 production frames from the valley
// palette adds ZERO new distinct colours to terrain.png.
const VALLEY_ROAD_TREAD = step(PALETTES.gravel, 2);
const VALLEY_ROAD_TREAD_LIGHT = step(PALETTES.gravel, 4);
const VALLEY_ROAD_SHOULDER = step(PALETTES.silt, 2);
const VALLEY_SWALE_BED = step(PALETTES.silt, 1);
const VALLEY_SWALE_BED_LIGHT = step(PALETTES.silt, 3);
const VALLEY_SWALE_BANK = step(PALETTES.gravel, 1);

/**
 * A worn dirt-track tile on the valley's own sward.
 *
 * Same route geometry as production v2's `roadCell` (copied `routeMask` /
 * `dilate`, unchanged), recoloured: the background is the exact grass base
 * fill (`paintBaseTile("grass", ...)`, the same pixels a `t.grass.<variant>`
 * frame would carry) instead of v2's `TERRAIN_PALETTE.worn`/`shiftedColor`
 * jitter, and the tread/shoulder are fixed gravel/silt palette entries instead
 * of the arbitrary-RGB `TERRAIN_PALETTE.road` constants - so the whole frame
 * stays inside the fixed-palette discipline the rest of the sheet follows.
 */
function paintValleyRoadTile(surface, originX, originY, connections, variant) {
  paintBaseTile(surface, originX, originY, "grass", variant);
  const route = routeMask(connections, variant);
  const shoulder = dilate(route, 2);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const pixel = y * TILE + x;
      if (route[pixel]) {
        const grain = (x * 11 + y * 17 + variant * 13) % 41;
        put(surface, originX + x, originY + y, grain < 2 ? VALLEY_ROAD_TREAD_LIGHT : VALLEY_ROAD_TREAD);
      } else if (shoulder[pixel]) {
        put(surface, originX + x, originY + y, VALLEY_ROAD_SHOULDER);
      }
    }
  }
}

/** A dry silt/gravel gully tile - the valley's swale, same geometry as v2's `swaleCell`. */
function paintValleySwaleTile(surface, originX, originY, connections, variant) {
  paintBaseTile(surface, originX, originY, "grass", variant);
  const channel = routeMask(connections, variant + 3, 6, 8);
  const bank = dilate(channel, 2);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const pixel = y * TILE + x;
      if (channel[pixel]) {
        const grain = (x * 7 + y * 19 + variant * 5) % 37;
        put(surface, originX + x, originY + y, grain < 3 ? VALLEY_SWALE_BED_LIGHT : VALLEY_SWALE_BED);
      } else if (bank[pixel]) {
        put(surface, originX + x, originY + y, VALLEY_SWALE_BANK);
      }
    }
  }
}

/** Where a dirt track fords a dry gully - same geometry as v2's `fordCell`. */
function paintValleyFordTile(surface, originX, originY, roadConnections, swaleConnections, variant) {
  paintBaseTile(surface, originX, originY, "grass", variant);
  const channel = routeMask(swaleConnections, variant + 3, 6, 8);
  const bank = dilate(channel, 2);
  const road = routeMask(roadConnections, variant);
  const roadShoulder = dilate(road, 1);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const pixel = y * TILE + x;
      if (road[pixel]) {
        const plank = Math.floor((roadConnections.includes("N") ? y : x) / 4) % 2;
        put(surface, originX + x, originY + y, plank === 0 ? VALLEY_ROAD_TREAD : VALLEY_ROAD_TREAD_LIGHT);
      } else if (roadShoulder[pixel]) {
        put(surface, originX + x, originY + y, VALLEY_ROAD_SHOULDER);
      } else if (channel[pixel]) {
        put(surface, originX + x, originY + y, VALLEY_SWALE_BED);
      } else if (bank[pixel]) {
        put(surface, originX + x, originY + y, VALLEY_SWALE_BANK);
      }
    }
  }
}

/** The exact literal order the task spec requires for the 24 surviving terrain ids. */
const PRODUCTION_TERRAIN_ORDER = Object.freeze([
  "terrain.road.isolated",
  "terrain.road.end.n", "terrain.road.end.e", "terrain.road.end.s", "terrain.road.end.w",
  "terrain.road.straight.ns", "terrain.road.straight.ew",
  "terrain.road.corner.ne", "terrain.road.corner.se", "terrain.road.corner.sw", "terrain.road.corner.nw",
  "terrain.road.tee.n", "terrain.road.tee.e", "terrain.road.tee.s", "terrain.road.tee.w",
  "terrain.road.cross",
  "terrain.swale.straight.ns", "terrain.swale.straight.ew",
  "terrain.swale.corner.ne", "terrain.swale.corner.se", "terrain.swale.corner.sw", "terrain.swale.corner.nw",
  "terrain.ford.ns", "terrain.ford.ew",
]);

/** The two ground frame prefixes being retired in favour of the valley material vocabulary. */
const RETIRED_TERRAIN_PREFIXES = Object.freeze(["terrain.grass.", "terrain.garden."]);

function perpendicularPair(connections) {
  const set = new Set(connections);
  if (set.has("N") && set.has("S")) return ["E", "W"];
  if (set.has("E") && set.has("W")) return ["N", "S"];
  throw new Error(`cannot infer a perpendicular swale crossing for connections ${JSON.stringify(connections)}`);
}

/**
 * Read the CURRENT `nirvana-v2/atlas.json` and split its frame table into the
 * 24 production terrain frames that must survive (never hand-copied - if v2's
 * id list ever drifts, this throws instead of silently omitting one) and the
 * 18 landmark frames to re-pack byte for byte.
 */
async function readV2Manifest() {
  const raw = await readFile(V2_ATLAS_JSON_PATH, "utf8");
  const manifest = JSON.parse(raw);
  const terrainFrames = manifest.frames.filter((frame) => frame.image === "terrain");
  const landmarkFrames = manifest.frames.filter((frame) => frame.image === "landmarks");
  const survivingTerrainFrames = terrainFrames.filter(
    (frame) => !RETIRED_TERRAIN_PREFIXES.some((prefix) => frame.id.startsWith(prefix)),
  );
  if (survivingTerrainFrames.length !== 24) {
    throw new Error(
      `expected 24 surviving production terrain frames in nirvana-v2/atlas.json; found ${survivingTerrainFrames.length}`,
    );
  }
  if (landmarkFrames.length !== 18) {
    throw new Error(
      `expected 18 landmark frames in nirvana-v2/atlas.json; found ${landmarkFrames.length}`,
    );
  }
  const byId = new Map(survivingTerrainFrames.map((frame) => [frame.id, frame]));
  const orderedProductionTerrainDefs = PRODUCTION_TERRAIN_ORDER.map((id, index) => {
    const frame = byId.get(id);
    if (!frame) throw new Error(`nirvana-v2/atlas.json is missing expected production terrain id ${id}`);
    const extraIndex = index;
    if (id.startsWith("terrain.road.")) {
      return { id, kind: "road", connections: frame.connections ?? [], extraIndex };
    }
    if (id.startsWith("terrain.swale.")) {
      return { id, kind: "swale", connections: frame.connections ?? [], extraIndex };
    }
    if (id.startsWith("terrain.ford.")) {
      const roadConnections = frame.connections ?? [];
      return {
        id,
        kind: "ford",
        roadConnections,
        swaleConnections: perpendicularPair(roadConnections),
        extraIndex,
      };
    }
    throw new Error(`unrecognised production terrain id ${id}`);
  });
  if (byId.size !== orderedProductionTerrainDefs.length) {
    throw new Error("nirvana-v2/atlas.json has surviving terrain ids not covered by PRODUCTION_TERRAIN_ORDER");
  }
  return { orderedProductionTerrainDefs, landmarkFrames };
}

// ---------------------------------------------------------------------------
// terrain sheet: pilot's 432 frames + this script's 24 recoloured frames
// ---------------------------------------------------------------------------

function buildTerrainAtlasV3(productionTerrainDefs) {
  const pilotFrames = terrainFrameLayout();
  const frames = [...pilotFrames, ...productionTerrainDefs];
  const columns = TERRAIN_COLUMNS;
  const rows = Math.ceil(frames.length / columns);
  const surface = createSurface(columns * TILE, rows * TILE);
  frames.forEach((frame, index) => {
    const originX = (index % columns) * TILE;
    const originY = Math.floor(index / columns) * TILE;
    switch (frame.kind) {
      case "base":
        paintBaseTile(surface, originX, originY, frame.material, frame.variant);
        break;
      case "edge":
        paintEdgeTile(surface, originX, originY, frame.material, frame.mask, frame.variant);
        break;
      case "shore":
        paintShoreTile(surface, originX, originY, frame.material, frame.mask, frame.variant);
        break;
      case "road":
        paintValleyRoadTile(surface, originX, originY, frame.connections, frame.extraIndex);
        break;
      case "swale":
        paintValleySwaleTile(surface, originX, originY, frame.connections, frame.extraIndex);
        break;
      case "ford":
        paintValleyFordTile(
          surface, originX, originY, frame.roadConnections, frame.swaleConnections, frame.extraIndex,
        );
        break;
      default:
        throw new Error(`unhandled terrain frame kind ${frame.kind}`);
    }
  });
  return {
    surface,
    ids: frames.map((frame) => frame.id),
    columns,
    rows,
    pilotFrameCount: pilotFrames.length,
    productionFrameCount: productionTerrainDefs.length,
  };
}

// ---------------------------------------------------------------------------
// scenery sheet: pilot's 105 frames + 18 blitted landmark sprites
// ---------------------------------------------------------------------------

const SCENERY_COLUMNS = 672;

/** Left-to-right, wrap-on-overflow shelf packer - identical semantics to the pilot's inline loop. */
function packShelf(items, columns) {
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  const placed = [];
  for (const item of items) {
    if (cursorX + item.width > columns) {
      cursorX = 0;
      cursorY += shelfHeight;
      shelfHeight = 0;
    }
    placed.push({ ...item, ox: cursorX, oy: cursorY });
    cursorX += item.width;
    shelfHeight = Math.max(shelfHeight, item.height);
  }
  return { placed, totalHeight: cursorY + shelfHeight };
}

/** Pixel-exact copy of one rectangle from a decoded source raw buffer into `surface`. */
function blitLandmark(surface, ox, oy, sourceData, sourceWidth, rect) {
  for (let y = 0; y < rect.height; y += 1) {
    for (let x = 0; x < rect.width; x += 1) {
      const sourceIndex = ((rect.y + y) * sourceWidth + (rect.x + x)) * 4;
      setPixel(surface, ox + x, oy + y, [
        sourceData[sourceIndex],
        sourceData[sourceIndex + 1],
        sourceData[sourceIndex + 2],
        sourceData[sourceIndex + 3],
      ]);
    }
  }
}

async function buildSceneryAtlasV3(landmarkFrames) {
  const proceduralItems = [];
  for (const spec of SCENERY_SPECS) {
    for (let variant = 0; variant < spec.variants; variant += 1) {
      proceduralItems.push({
        kind: "scenery",
        id: `s.${spec.id}.${variant}`,
        width: spec.width,
        height: spec.height,
        pivot: { x: spec.pivot[0], y: spec.pivot[1] },
        spec,
        variant,
      });
    }
  }
  const landmarkItems = landmarkFrames.map((frame) => ({
    kind: "landmark",
    id: frame.id,
    width: frame.rect.width,
    height: frame.rect.height,
    pivot: { x: frame.pivot.x, y: frame.pivot.y },
    sourceRect: frame.rect,
  }));
  const items = [...proceduralItems, ...landmarkItems];
  const { placed, totalHeight } = packShelf(items, SCENERY_COLUMNS);
  const surface = createSurface(SCENERY_COLUMNS, totalHeight);

  const landmarksSource = await readFile(V2_LANDMARKS_PNG_PATH);
  const { data: landmarkRaw, info: landmarkInfo } = await sharp(landmarksSource)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (const item of placed) {
    if (item.kind === "scenery") {
      const carriesOwnShadow = item.spec.id.startsWith("scarp")
        || item.spec.id === "steppingstone"
        || item.spec.id === "reedwater"
        || item.spec.id.startsWith("bridge");
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = item.spec.pivot;
        paintContactShadow(
          surface,
          item.ox,
          item.oy,
          pivotX,
          pivotY + 2,
          Math.max(5, item.spec.width * 0.30),
          Math.max(3, item.spec.height * 0.070),
          item.spec.id === "tuft" || item.spec.id === "flowerdrift" ? 0.28 : 0.46,
        );
      }
      paintSceneryProcedural(surface, item.ox, item.oy, item.spec, item.variant);
    } else {
      blitLandmark(surface, item.ox, item.oy, landmarkRaw, landmarkInfo.width, item.sourceRect);
    }
  }

  return {
    surface,
    records: placed.map((item) => ({
      id: item.id, ox: item.ox, oy: item.oy, width: item.width, height: item.height, pivot: item.pivot,
    })),
    proceduralFrameCount: proceduralItems.length,
    landmarkFrameCount: landmarkItems.length,
  };
}

// ---------------------------------------------------------------------------
// atomic, content-addressed publication - copied from build-nirvana-v2-pilot-atlas.mjs
// ---------------------------------------------------------------------------

function generationFingerprint(files) {
  const digest = createHash("sha256");
  for (const { name, bytes } of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    digest.update(name);
    digest.update("\0");
    digest.update(String(bytes.byteLength));
    digest.update("\0");
    digest.update(bytes);
  }
  return digest.digest("hex");
}

async function pathMetadata(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

async function publishAtomically(files, outputDirectory) {
  const expectedNames = ["atlas.json", "scenery.png", "terrain.png"];
  const names = files.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error(`Nirvana v3 publication requires exactly ${expectedNames.join(", ")}`);
  }

  const outputParent = path.dirname(outputDirectory);
  const outputName = path.basename(outputDirectory);
  const generationsDirectory = path.join(outputParent, `.${outputName}-generations`);
  await mkdir(outputParent, { recursive: true });

  const currentOutput = await pathMetadata(outputDirectory);
  if (currentOutput !== null && !currentOutput.isSymbolicLink()) {
    throw new Error(
      `Atomic Nirvana v3 publication requires ${outputDirectory} to be absent or a symbolic link; `
      + "migrate the legacy directory before publishing.",
    );
  }

  await mkdir(generationsDirectory, { recursive: true });
  const stagedGeneration = await mkdtemp(path.join(generationsDirectory, ".staging-"));
  let stagedGenerationOwned = true;
  let stagedLinkDirectory = null;
  try {
    await Promise.all(files.map(({ name, bytes }) => (
      writeFile(path.join(stagedGeneration, name), bytes, { flag: "wx" })
    )));

    const generationDirectory = path.join(generationsDirectory, generationFingerprint(files));
    try {
      await rename(stagedGeneration, generationDirectory);
      stagedGenerationOwned = false;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EEXIST", "ENOTEMPTY"].includes(error.code)) {
        throw error;
      }
      const existingGeneration = await pathMetadata(generationDirectory);
      if (existingGeneration === null || !existingGeneration.isDirectory()) throw error;
    }

    stagedLinkDirectory = await mkdtemp(path.join(outputParent, `.${outputName}-link-`));
    const stagedLink = path.join(stagedLinkDirectory, "current");
    await symlink(path.relative(outputParent, generationDirectory), stagedLink, "dir");
    await rename(stagedLink, outputDirectory);
    return generationDirectory;
  } finally {
    if (stagedGenerationOwned) {
      await rm(stagedGeneration, { recursive: true, force: true });
    }
    if (stagedLinkDirectory !== null) {
      await rm(stagedLinkDirectory, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// top-level build
// ---------------------------------------------------------------------------

/**
 * Ceiling A (region kit, 196,608 B) budget-cut record.
 *
 * At full pilot fidelity (`SHORE_VARIANTS: 2`, no per-material overrides
 * beyond the pilot's own grass-family ones) plus the 24 production terrain
 * frames and 18 landmark sprites, the region kit measured 207,454 B
 * (105.52%) - over by 10,846 B. Candidates measured by temporarily varying
 * this script's own constants and re-running (never touching the pilot
 * file's `BASE_VARIANTS` / `EDGE_VARIANTS_BY_MATERIAL` / `SHORE_VARIANTS`):
 *
 *   cut                                   frames removed   region kit    vs 196,608 B
 *   (none - full pilot fidelity)          -                207,454 B     +10,846 B (over)
 *   shore 2->1 (gravel/silt/reed)         -42              201,165 B     +4,557 B (over)
 *   + rock edge 2->1                     -14 (-56 total)   196,984 B     +376 B (over)
 *   + gravel edge 2->1 instead of rock   -14 (-56 total)   196,954 B     +346 B (over)
 *   + water edge 2->1 instead of rock    -14 (-56 total)   197,439 B     +831 B (over)
 *   + shallow edge 2->1 instead of rock  -14 (-56 total)   197,413 B     +805 B (over)
 *   + silt edge 2->1 instead of rock     -14 (-56 total)   198,042 B     +1,434 B (over)
 *   + reed edge 2->1 instead of rock     -14 (-56 total)   197,177 B     +569 B (over)
 *   + thicket edge 2->1 instead of rock  -14 (-56 total)   196,577 B     -31 B (UNDER, 31 B margin)
 *   + a single base-variant 8->7 trim on any one material, on top of
 *     shore+rock (-57 total)              -1               197,0xx-197,4xx B  still over (tried all 7
 *                                                                               non-grass-family materials;
 *                                                                               none close the gap - a
 *                                                                               single frame's removal just
 *                                                                               reflows the grid and the net
 *                                                                               saving is noise-level)
 *   shore 2->1 + rock edge 2->1
 *     + thicket edge 2->1 (APPLIED)       -70              192,579 B     -4,029 B (UNDER, 2.05% headroom)
 *
 * `shore + thicket` alone is technically the *smallest* cut that clears the
 * ceiling, but by only 31 bytes - not a margin worth relying on. This script
 * applies `shore + rock + thicket` instead: still cuts nothing beyond
 * variant *counts* (never resolution, never the palette discipline), removes
 * only 70 of the pilot's 432 terrain frames (all of it in the least
 * plate-critical materials - shoreline repeat variety, rock-face repeat
 * variety, thicket-margin repeat variety), and lands at 97.95% with a real
 * (~4 KB) buffer against future drift.
 */

/**
 * Build and atomically publish the Nirvana v3 valley atlas.
 *
 * Mutates the filesystem: writes `terrain.png`, `scenery.png` and
 * `atlas.json` into a new content-addressed generation directory under
 * `<outputDirectory's parent>/.<outputDirectory's name>-generations/` and
 * swaps `outputDirectory` to a symlink pointing at it (see
 * `publishAtomically`). Never touches `nirvana-v2` or its generations
 * directory - only reads `nirvana-v2/atlas.json` and `nirvana-v2/landmarks.png`.
 *
 * @param {{ outputDirectory?: string }} [options]
 * @returns {Promise<object>} A report object: the published manifest plus
 *   byte-table and budget-ceiling figures for the region-kit (Ceiling A) and
 *   shared-active-atlas (Ceiling B) budgets.
 */
export async function buildNirvanaV3ValleyAtlas({
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
} = {}) {
  const resolvedOutputDirectory = path.resolve(outputDirectory);
  const { orderedProductionTerrainDefs, landmarkFrames } = await readV2Manifest();

  const terrain = buildTerrainAtlasV3(orderedProductionTerrainDefs);
  const scenery = await buildSceneryAtlasV3(landmarkFrames);

  const terrainEncoded = await encodeSurfaceStrict(terrain.surface, "terrain.png");
  const sceneryEncoded = await encodeSurfaceWithFallback(scenery.surface, "scenery.png");

  const atlas = {
    schema: 2,
    tileSize: TILE,
    materials: MATERIALS,
    blockingMaterials: BLOCKING_MATERIALS,
    shoreMaterials: SHORE_MATERIALS,
    images: {
      terrain: {
        file: "terrain.png",
        width: terrain.surface.width,
        height: terrain.surface.height,
        compressedBytes: terrainEncoded.bytes,
        decodedBytes: terrain.surface.width * terrain.surface.height * 4,
        sha256: terrainEncoded.sha256,
        colours: distinctColours(terrain.surface),
        encoding: terrainEncoded.encoding,
      },
      scenery: {
        file: "scenery.png",
        width: scenery.surface.width,
        height: scenery.surface.height,
        compressedBytes: sceneryEncoded.bytes,
        decodedBytes: scenery.surface.width * scenery.surface.height * 4,
        sha256: sceneryEncoded.sha256,
        colours: distinctColours(scenery.surface),
        encoding: sceneryEncoded.encoding,
        ...(sceneryEncoded.paletteDisciplineBroken
          ? { paletteDisciplineBroken: sceneryEncoded.paletteDisciplineBroken }
          : {}),
      },
    },
    terrainGrid: {
      image: "terrain",
      columns: terrain.columns,
      cell: TILE,
      ids: terrain.ids,
    },
    sceneryFrames: scenery.records.map((record) => [
      record.id, record.ox, record.oy, record.width, record.height, record.pivot.x, record.pivot.y,
    ]),
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(atlas)}\n`, "utf8");

  const files = [
    { name: "terrain.png", bytes: terrainEncoded.png },
    { name: "scenery.png", bytes: sceneryEncoded.png },
    { name: "atlas.json", bytes: manifestBytes },
  ];
  const generationDirectory = await publishAtomically(files, resolvedOutputDirectory);

  const artBytes = terrainEncoded.bytes + sceneryEncoded.bytes;
  const regionKitBytes = artBytes + manifestBytes.byteLength;
  const activeBytes = WORN_HEARTLAND_ACTIVE_COMPRESSED_BYTES + artBytes;

  return {
    generationDirectory,
    outputDirectory: resolvedOutputDirectory,
    atlas,
    files: {
      terrain: { bytes: terrainEncoded.bytes, sha256: terrainEncoded.sha256, encoding: terrainEncoded.encoding },
      scenery: {
        bytes: sceneryEncoded.bytes,
        sha256: sceneryEncoded.sha256,
        encoding: sceneryEncoded.encoding,
        paletteDisciplineBroken: sceneryEncoded.paletteDisciplineBroken,
      },
      atlasJson: { bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
    },
    frameCounts: {
      terrainPilot: terrain.pilotFrameCount,
      terrainProduction: terrain.productionFrameCount,
      terrainTotal: terrain.ids.length,
      terrainColumns: terrain.columns,
      terrainRows: terrain.rows,
      terrainWidth: terrain.surface.width,
      terrainHeight: terrain.surface.height,
      sceneryPilot: scenery.proceduralFrameCount,
      sceneryLandmark: scenery.landmarkFrameCount,
      sceneryTotal: scenery.records.length,
      sceneryWidth: scenery.surface.width,
      sceneryHeight: scenery.surface.height,
    },
    ceilingA: {
      bytes: regionKitBytes,
      max: REGION_COMPRESSED_MAX,
      percent: (regionKitBytes / REGION_COMPRESSED_MAX) * 100,
    },
    ceilingB: {
      bytes: activeBytes,
      max: ACTIVE_COMPRESSED_MAX,
      percent: (activeBytes / ACTIVE_COMPRESSED_MAX) * 100,
      wornHeartlandActiveCompressedBytes: WORN_HEARTLAND_ACTIVE_COMPRESSED_BYTES,
    },
  };
}

function outputDirectoryFromArguments(arguments_) {
  if (arguments_.length === 0) return DEFAULT_OUTPUT_DIRECTORY;
  if (arguments_.length !== 2 || arguments_[0] !== "--output-dir" || !arguments_[1]) {
    throw new Error("Usage: build-nirvana-v3-valley-atlas.mjs [--output-dir <directory>]");
  }
  return path.resolve(arguments_[1]);
}

function printReport(result) {
  const fc = result.frameCounts;
  const lines = [
    `published: ${path.relative(REPOSITORY_ROOT, result.generationDirectory)}`,
    `symlink:   ${path.relative(REPOSITORY_ROOT, result.outputDirectory)}`,
    "",
    "byte table:",
    `  terrain.png   ${String(result.files.terrain.bytes).padStart(8)} B  sha256=${result.files.terrain.sha256}`,
    `  scenery.png   ${String(result.files.scenery.bytes).padStart(8)} B  sha256=${result.files.scenery.sha256}`
      + (result.files.scenery.paletteDisciplineBroken ? "  [RGBA fallback: indexed encoder overflowed 256 colours]" : ""),
    `  atlas.json    ${String(result.files.atlasJson.bytes).padStart(8)} B  sha256=${result.files.atlasJson.sha256}`,
    "",
    `frames: terrain ${fc.terrainTotal} (pilot ${fc.terrainPilot} + production ${fc.terrainProduction}), `
      + `scenery ${fc.sceneryTotal} (pilot ${fc.sceneryPilot} + landmark ${fc.sceneryLandmark})`,
    `terrain grid: ${fc.terrainColumns} columns x ${fc.terrainRows} rows, ${fc.terrainWidth}x${fc.terrainHeight}px`,
    `scenery sheet: ${fc.sceneryWidth}x${fc.sceneryHeight}px`,
    "",
    `Ceiling A (region kit, ${REGION_COMPRESSED_MAX} B): ${result.ceilingA.bytes} B `
      + `= ${result.ceilingA.percent.toFixed(2)}%`,
    `Ceiling B (active atlas, ${ACTIVE_COMPRESSED_MAX} B): `
      + `${result.ceilingB.wornHeartlandActiveCompressedBytes} (worn-heartland) + ${result.files.terrain.bytes} `
      + `(terrain.png) + ${result.files.scenery.bytes} (scenery.png) = ${result.ceilingB.bytes} B `
      + `= ${result.ceilingB.percent.toFixed(2)}%`,
  ];
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputDirectory = outputDirectoryFromArguments(process.argv.slice(2));
  buildNirvanaV3ValleyAtlas({ outputDirectory })
    .then((result) => {
      printReport(result);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
