/**
 * Authors the NIRVANA EAST red-desert PILOT tile vocabulary.
 *
 * Sibling of `author-warm-springs-pilot-art.mjs`, which is itself the proven
 * copy of `author-nirvana-valley-pilot-art.mjs`. This file reuses that same
 * machinery verbatim (the corner-mask Wang alpha field, the indexed8 PNG
 * encoder, the losslessness assertion, the byte report, the shelf-packed
 * scenery atlas) and replaces only the AESTHETICS for the frozen contract at
 * `scratchpad/nirvana-east-contract.md` (sections 3-6).
 *
 * What it emits (into `src/qa/nirvanaEastPilot/assets/`):
 *   terrain.png  - 104 base fills (13 corner-field materials x 8), 266
 *                  corner-mask transition frames (edge-variant counts frozen
 *                  by the contract table, 19 total x 14 masks), 84 shoreline
 *                  / salt-efflorescence frames on the three bank materials
 *                  (salt, hardpan, oxide). 454 frames.
 *   scenery.png  - the 13 prop kinds in section 6 of the contract: thornbush,
 *                  deadwood, mesquite, boulder, hoodoo, saltbush, bunchgrass,
 *                  cracks, bones, saltrime, pebbles, dustdevil, plank.
 *   atlas.json   - schema 2, the compact shape Warm Springs and Nirvana write.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY: iron-oxide RED + bone-WHITE salt + charcoal desert varnish.
 * ---------------------------------------------------------------------------
 * Nirvana is green + blue. Warm Springs is cream + ochre + turquoise. This
 * region takes RED, and has to survive both a 1:1 look AND a heavily
 * downsampled world-map island (measured: `dry_scrub` gives Nirvana East the
 * SMALLEST island of the four regions, ~1/4-1/3 the land area of its
 * siblings, with 50-70% of the plot cropped by the coastline at map scale -
 * see the mid-task addendum). So the three colour poles - `oxide`/`redsand`
 * (dark saturated red), `salt` (bright cool white) and `gravel` (near-
 * charcoal) - are pushed to maximum LUMA and SATURATION separation from each
 * other, while tonal spread WITHIN one material stays modest (grain, not
 * contrast), exactly the opposite emphasis of a single-material ramp.
 *
 * Two disciplines carried over unchanged from Warm Springs (both measured on
 * Nirvana's first pass, both load-bearing, see that file's header for the
 * full account):
 *   1. Transitions are CORNER-based (Wang) with a priority stack, so the
 *      material boundary is a bilinear field sampled at shared tile corners -
 *      continuous across every seam by construction.
 *   2. Every pixel is a FIXED PALETTE ENTRY. No ramp interpolation anywhere;
 *      shading is index arithmetic into a material's own fixed colour list.
 *
 * CORNER-BIT CONVENTION: 1 = NW, 2 = NE, 4 = SE, 8 = SW - the Nirvana / Warm
 * Springs convention, declared in `atlas.json` as `cornerBits` so the scene
 * module never has to guess.
 */

import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_ROOT = path.resolve(
  MODULE_ROOT,
  "../src/qa/nirvanaEastPilot/assets",
);

export const TILE = 32;

/**
 * Material stack, lowest priority first - exactly the contract's numbering
 * (section 4). `plank` is index 13: the causeway deck. It is NEVER sampled in
 * the corner field and owns no terrain frame - it is the material a tile
 * REPORTS once a plank causeway carries it.
 */
export const MATERIALS = Object.freeze([
  "brine",
  "brinerim",
  "salt",
  "hardpan",
  "sand",
  "redsand",
  "oxide",
  "gravel",
  "dustgrass",
  "thorn",
  "mesa",
  "scarp",
  "slot",
  "plank",
]);

export const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

/** The thirteen materials the corner field may sample. `plank` is not one. */
export const FIELD_MATERIALS = Object.freeze(MATERIALS.slice(0, 13));

/** Materials a body cannot stand on or route through - contract section 4. */
export const BLOCKING_MATERIALS = Object.freeze([
  "brine",
  "brinerim",
  "thorn",
  "mesa",
  "scarp",
  "slot",
]);

/** Bank materials that get a dedicated shoreline / salt-efflorescence set. */
export const SHORE_MATERIALS = Object.freeze(["salt", "hardpan", "oxide"]);

/** Water-family materials: the shoreline set is emitted where these are base. */
export const WATER_MATERIALS = Object.freeze(["brine", "brinerim"]);

/** Tonal tiers of one desert floor, sharing prop ecology. */
export const GROUND_FAMILY = Object.freeze([
  "sand",
  "redsand",
  "oxide",
  "hardpan",
  "gravel",
]);

/** The mesa / scarp / slot rock-relief family. */
export const CLIFF_FAMILY = Object.freeze(["mesa", "scarp", "slot"]);

/** Eight fills per material - frozen by the contract. */
const BASE_VARIANTS = 8;

/**
 * Transition variants per material - FROZEN by the contract table (section 4
 * "edge variants" column). Sum = 19, so 19 x 14 masks = 266 edge frames.
 */
const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  brine: 2,
  brinerim: 1,
  salt: 2,
  hardpan: 2,
  sand: 1,
  redsand: 2,
  oxide: 2,
  gravel: 1,
  dustgrass: 1,
  thorn: 2,
  mesa: 1,
  scarp: 1,
  slot: 1,
});
const SHORE_VARIANTS = 2;

/** Transition variants authored for one material. */
export function edgeVariantCount(material) {
  return EDGE_VARIANTS_BY_MATERIAL[material] ?? 1;
}

/** Masks 1..14; mask 15 is full coverage and reuses the base fill. */
const EDGE_MASKS = Object.freeze(
  Array.from({ length: 14 }, (_unused, index) => index + 1),
);

// ---------------------------------------------------------------------------
// deterministic noise (verbatim from the Warm Springs / Nirvana pilots)
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

export function fbm(x, y, seed, octaves = 4) {
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

/** Signed angular distance from `b` to `a`, wrapped into (-PI, PI]. */
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------------------
// palette discipline
// ---------------------------------------------------------------------------

/** Choose a palette entry by NORMALISED position. Never blends between two. */
function tone(palette, t) {
  const index = Math.round(clamp01(t) * (palette.length - 1));
  return palette[index];
}

/** Choose a palette entry by index, clamped. Lighting is index arithmetic. */
function step(palette, index) {
  return palette[index < 0 ? 0 : index >= palette.length ? palette.length - 1 : index];
}

/** Index for a normalised position, so painters can shade by stepping. */
function level(palette, t) {
  return Math.round(clamp01(t) * (palette.length - 1));
}

/** Snap a noise coordinate to a 2px cluster: grain, not incompressible speckle. */
function chunky(value) {
  return Math.floor(value * 0.5) * 2;
}

/**
 * A DIRECTIONAL CONTOUR PARAMETER - the machinery behind redsand's wind
 * ripples and scarp's sedimentary banding. See `author-warm-springs-pilot-art.mjs`
 * for the full derivation: a linear ramp across a fixed direction plus a slow
 * noise term that bends it, so the level sets are long meandering curves
 * instead of closed blobs. `angle` is a MATERIAL constant - never derived
 * from the variant seed - or the eight base fills print the 32px lattice as
 * squares of rotated grain.
 */
function contourOf(wx, wy, seed, pitch, meander, sway, angle) {
  const across = wx * Math.cos(angle) + wy * Math.sin(angle);
  return across * pitch + fbm(wx * meander, wy * meander, seed, 3) * sway;
}

/**
 * Jittered-cell Voronoi metric shared by the cellular materials (salt's
 * polygon crack plates, hardpan's desiccation cracks, oxide's angular chips,
 * gravel's pebble lag). Plain Euclidean cells (`angular: false`) already ARE
 * irregular convex polygons, which is exactly what a dry-lake crack network
 * needs with no further distortion. `angular: true` rotates and stretches
 * each cell under a Chebyshev-leaning metric - the Warm Springs `rock` fix
 * for cells reading as ROUND, PAVED cobbles instead of broken rock.
 */
function voronoiCell(wx, wy, cellSize, seed, options = {}) {
  const { angular = false } = options;
  let nearest = Infinity;
  let second = Infinity;
  let nearKey = 0;
  let secondKey = 0;
  let localX = 0;
  let localY = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = Math.floor(wx / cellSize) + dx;
      const cy = Math.floor(wy / cellSize) + dy;
      const jx = (cx + hash2(cx, cy, seed + 83)) * cellSize;
      const jy = (cy + hash2(cx, cy, seed + 89)) * cellSize;
      let ux = wx - jx;
      let uy = wy - jy;
      let distance;
      if (angular) {
        const angle = hash2(cx, cy, seed + 91) * Math.PI;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rx = ux * cos + uy * sin;
        const ry = -ux * sin + uy * cos;
        const stretch = 0.70 + hash2(cx, cy, seed + 93) * 0.70;
        distance = Math.max(Math.abs(rx) / stretch, Math.abs(ry) * stretch);
        ux = rx;
        uy = ry;
      } else {
        distance = Math.hypot(ux, uy);
      }
      const key = (cx + 512) * 4096 + (cy + 512);
      if (distance < nearest) {
        second = nearest;
        secondKey = nearKey;
        nearest = distance;
        nearKey = key;
        localX = ux;
        localY = uy;
      } else if (distance < second) {
        second = distance;
        secondKey = key;
      }
    }
  }
  return { nearest, second, nearKey, secondKey, localX, localY };
}

/** Wind-ripple / sediment-band direction constants - MATERIAL constants. */
const SAND_ANGLE = 0.30;
const REDSAND_ANGLE = -0.34;
/** Near-vertical gradient => near-HORIZONTAL contour bands (see derivation
 * above `contourOf`): this is what keeps scarp reading as sedimentary rock
 * rather than as a fence of vertical slats. */
const SCARP_ANGLE = 1.22;

/** Four alpha levels. A continuous alpha channel is a photograph too. */
const ALPHA_LEVELS = Object.freeze([0, 88, 172, 255]);

function quantiseAlpha(alpha) {
  return ALPHA_LEVELS[Math.round(clamp01(alpha) * (ALPHA_LEVELS.length - 1))];
}

// ---------------------------------------------------------------------------
// palettes - the identity lives here. See the file header for the addendum
// that reshaped this section: oxide/redsand (dark saturated red), salt
// (bright cool white) and gravel (near-charcoal) are the three POLES and are
// pushed to maximum luma/saturation separation from each other; the spread
// WITHIN one material stays modest so the field still reads as one surface.
// ---------------------------------------------------------------------------

const PALETTES = Object.freeze({
  // Bitter salt water: dead, opaque, mineral-milky pale jade-white - NOT the
  // saturated cyan of Warm Springs' pools, NOT Nirvana's blue river. Muted on
  // purpose; the rust bleed (below) is what breaks the flatness.
  brine: Object.freeze([
    [100, 110, 94], [126, 136, 116], [152, 160, 140],
    [176, 182, 162], [200, 204, 186], [222, 224, 208],
  ]),
  // Shallow crusted brine: near-white with a pink/salmon halophile flush.
  brinerim: Object.freeze([
    [168, 150, 146], [192, 174, 166], [212, 196, 186], [228, 214, 204], [240, 230, 220],
  ]),
  // POLE 1: bone-white salt crust. Pushed bright and COOL (desaturated, not
  // the warm cream of Warm Springs' sinter/travertine) so it holds a clean
  // luma ceiling against the red pole even after a 5-bit island downsample.
  salt: Object.freeze([
    [188, 186, 182], [204, 202, 196], [218, 216, 208],
    [230, 228, 220], [240, 238, 230], [250, 249, 244],
  ]),
  // Pale pink-cream dried clay - a calm mid-tone between salt and the reds.
  hardpan: Object.freeze([
    [214, 186, 172], [224, 198, 184], [233, 209, 196], [241, 220, 208], [248, 232, 222],
  ]),
  // The existing #f0c880 warm sand, kept as a mid-tone, gentle ripples.
  sand: Object.freeze([
    [188, 150, 96], [206, 168, 110], [222, 184, 120],
    [240, 200, 128], [246, 212, 150], [250, 224, 172],
  ]),
  // Deep rust-red aeolian sand. Genuinely RED, not tan - the wind-ripple
  // banding (below) is the signature texture, echoing travertine's role in
  // Warm Springs.
  redsand: Object.freeze([
    [128, 34, 20], [152, 48, 26], [176, 66, 36],
    [196, 88, 50], [212, 112, 70], [226, 138, 96],
  ]),
  // POLE 2: dark iron-oxide mudstone / desert pavement. Pushed dark and hard
  // saturated red - geological, not soil-brown - to hold maximum separation
  // from `salt` at every scale.
  oxide: Object.freeze([
    [58, 14, 10], [82, 20, 14], [108, 28, 18],
    [134, 40, 24], [158, 54, 32], [180, 70, 42],
  ]),
  // POLE 3: charcoal desert-varnish lag gravel. Pushed genuinely near-black,
  // not mid grey-brown, so the region has three well-separated poles (dark
  // red, bright white, near-black) rather than one beige mass at map scale.
  gravel: Object.freeze([
    [14, 12, 11], [24, 20, 18], [36, 31, 27],
    [50, 43, 37], [66, 57, 49], [84, 73, 63],
  ]),
  // Bleached khaki/olive bunchgrass - the faintest possible tie to the green
  // Nirvana family, kept deliberately desaturated.
  dustgrass: Object.freeze([
    [124, 120, 82], [144, 140, 98], [164, 160, 116], [182, 178, 136], [200, 196, 156],
  ]),
  // Dark grey-olive/khaki-grey thorn scrub, dry and hard-silhouetted. Pulled
  // NEUTRAL (R >= G, not G-dominant) so it reads as desert scrub, not lawn.
  thorn: Object.freeze([
    [40, 38, 34], [56, 53, 47], [74, 70, 62], [92, 88, 78], [110, 106, 94],
  ]),
  // Mesa caprock: banded red, harder and LIGHTER than scarp.
  mesa: Object.freeze([
    [132, 52, 34], [156, 70, 46], [178, 92, 62],
    [198, 114, 84], [216, 140, 108], [230, 166, 136],
  ]),
  // Scarp: cliff face + talus, darker red-brown than mesa, strong banding.
  scarp: Object.freeze([
    [62, 20, 14], [86, 32, 20], [110, 46, 28],
    [134, 62, 38], [156, 82, 52], [176, 102, 68],
  ]),
  // Slot canyon: near-black core, one warm lit lip tone at the far end.
  slot: Object.freeze([
    [8, 6, 6], [16, 12, 10], [26, 20, 16], [40, 32, 26], [58, 46, 38], [128, 84, 58],
  ]),
});

/** Deeper accent bands within redsand's ripples - its own "tonally varied". */
const REDSAND_DEEP = Object.freeze([[96, 22, 14], [116, 32, 18], [136, 44, 24]]);

/** Salt's crack joints: pinkish-grey, distinct from the white plates. */
const SALT_JOINT = Object.freeze([[140, 120, 112], [160, 140, 130], [178, 158, 146]]);

/** Rust bleeding in from brine's edges - "over red mud". */
const RUST_STAIN = Object.freeze([[92, 46, 28], [118, 62, 38], [142, 80, 50]]);

/**
 * The shoreline set: a bright white broken salt-efflorescence bloom hugging
 * brine's contour (from `ACCENT.crust`/`crustDim`, shared below), with a
 * darker WET-stained band just inside it, per bank material.
 */
const WET = Object.freeze({
  salt: Object.freeze([[110, 92, 88], [138, 118, 110], [164, 144, 134]]),
  hardpan: Object.freeze([[96, 66, 54], [122, 88, 72], [148, 110, 90]]),
  oxide: Object.freeze([[40, 14, 10], [62, 24, 16], [86, 38, 24]]),
});

/** Accents. Each is a single fixed colour, never a blend target. */
const ACCENT = Object.freeze({
  shadow: [16, 10, 8],
  crust: [250, 248, 240],
  crustDim: [220, 210, 196],
  varnish: [22, 18, 16],
  twig: [54, 40, 26],
  spine: [196, 188, 164],
  flush: [222, 160, 150],
  iridescent: [206, 204, 214],
});

const BLEACHWOOD = Object.freeze([
  [50, 42, 34], [76, 64, 52], [104, 90, 74], [136, 120, 100], [168, 152, 130], [196, 182, 160],
]);
const SILVER = Object.freeze([
  [128, 132, 120], [150, 154, 140], [172, 176, 160], [192, 196, 180], [210, 212, 198],
]);
// Desaturated grey-olive haze - NOT Nirvana's lush leaf-green. A desert
// mesquite's foliage is fine and open, not a solid canopy mass.
const MESQUITE_LEAF = Object.freeze([
  [42, 44, 34], [58, 60, 46], [76, 78, 60], [94, 96, 76], [114, 114, 92], [136, 134, 110],
]);
const THORN_BARK = Object.freeze([
  [26, 20, 14], [44, 34, 24], [64, 50, 36], [86, 68, 50], [110, 88, 66],
]);
const BONE = Object.freeze([
  [200, 190, 164], [218, 208, 184], [232, 224, 204], [242, 236, 222],
]);
const DUST_BRIGHT = Object.freeze([224, 206, 176]);
const DUST_DIM = Object.freeze([200, 182, 152]);
const DUST_ALPHAS = Object.freeze([56, 108]);

/** Causeway plank timber, bleached by sun rather than water. */
const PLANK = Object.freeze({
  edge: [54, 40, 28],
  seam: [76, 56, 38],
  body: [100, 76, 52],
  lit: [126, 98, 68],
  fresh: [150, 120, 86],
});
/** The colour a plank's shadow drags the ground toward - warm, not water-cool. */
const PLANK_SHADOW = Object.freeze([40, 18, 14]);

// ---------------------------------------------------------------------------
// per-material pixel painters - every return value is a palette entry
// ---------------------------------------------------------------------------

/**
 * Paint one opaque material pixel.
 * `wx`/`wy` are noise-space coordinates (already carrying the variant offset).
 */
function materialPixel(material, wx, wy, seed) {
  const palette = PALETTES[material];
  switch (material) {
    case "brine": {
      // Water is the ONE material in this sheet that must be SMOOTH: every
      // other material here is granular, and that granularity is exactly
      // what makes water read as water by contrast. No per-pixel noise, no
      // grain, no filament network - just a handful of LARGE soft tonal
      // zones (a low-frequency field only, one broad octave) and a single
      // soft rust stain bleeding in from one side.
      const swell = fbm(wx * 0.095, wy * 0.095, seed + 5, 2);
      let index = level(palette, 0.48 + (swell - 0.5) * 0.30);
      const stain = fbm(wx * 0.085, wy * 0.078, seed + 71, 2);
      if (stain > 0.76) {
        const t = clamp01((stain - 0.76) / 0.16);
        return step(RUST_STAIN, t > 0.62 ? 1 : 0);
      }
      return step(palette, index);
    }
    case "brinerim": {
      const surface = fbm(wx * 0.14, wy * 0.14, seed + 7, 3);
      const bed = fbm(wx * 0.30, wy * 0.30, seed + 43, 2);
      if (bed > 0.76) return tone(PALETTES.salt, 0.42 + (bed - 0.76) * 1.4);
      const flush = hash2(chunky(wx), chunky(wy), seed + 51);
      if (flush > 0.965) return ACCENT.iridescent;
      if (flush > 0.90) return ACCENT.flush;
      let index = level(palette, 0.42 + surface * 0.42 + (bed - 0.5) * 0.2);
      return step(palette, index);
    }
    case "salt": {
      // THE SIGNATURE TEXTURE: the Bonneville/Badwater polygon crack network.
      // A plain Voronoi cell already IS a convex polygon, so no rotation or
      // stretch is needed here (that trick is for materials that must NOT
      // look laid-out, which a crack network legitimately does). Each cell is
      // a raised plate: brightest at its crown, a subtle rim shade approaching
      // the joint, and the joint itself is a distinct pinkish-grey - never
      // just a darker step of the white, or it reads as dirt rather than salt.
      const cell = voronoiCell(wx, wy, 15, seed + 3);
      const joint = cell.second - cell.nearest;
      const grain = fbm(chunky(wx) * 0.42, chunky(wy) * 0.42, seed + 23, 2);
      if (joint < 0.9) return step(SALT_JOINT, 0);
      if (joint < 1.7) return step(SALT_JOINT, joint < 1.3 ? 1 : 2);
      let index = level(palette, 0.58 + hash2(cell.nearKey, 3, seed + 97) * 0.34);
      if (cell.nearest < 2.2) index += 1; // the plate's own crown catches light
      if (grain > 0.86) index += 1;
      else if (grain < 0.14) index -= 1;
      return step(palette, index);
    }
    case "hardpan": {
      // Fine desiccation cracks, smoother than salt: no raised-plate crown,
      // thinner hairline joints, lower contrast overall.
      const cell = voronoiCell(wx, wy, 10, seed + 5);
      const joint = cell.second - cell.nearest;
      const grain = fbm(chunky(wx) * 0.40, chunky(wy) * 0.40, seed + 27, 2);
      let index = level(palette, 0.50 + hash2(cell.nearKey, 3, seed + 101) * 0.30);
      if (joint < 0.55) index -= 3;
      else if (joint < 1.15) index -= 1;
      if (grain > 0.85) index += 1;
      else if (grain < 0.15) index -= 1;
      return step(palette, index);
    }
    case "sand": {
      // The calm mid-tone: short, LOW-CONTRAST ripple dashes. A first pass
      // ran continuous full-tile-height crests at one global angle and it
      // read as WOOD GRAIN, printing the 32px lattice everywhere the grain
      // direction disagreed between two variants. The fix (measured against
      // `oxide`, which stayed quiet and tiled invisibly): break every crest
      // into short segments, jitter the direction locally, and keep the
      // lit/shade swing to a single palette step.
      const jitter = (fbm(wx * 0.08, wy * 0.08, seed + 91, 2) - 0.5) * 0.8;
      const angle = SAND_ANGLE + jitter;
      const raw = contourOf(wx, wy, seed + 13, 0.20, 0.05, 2.0, angle);
      const band = Math.floor(raw);
      const within = raw - band;
      const along = wx * Math.sin(angle) - wy * Math.cos(angle);
      const dash = hash2(Math.floor(along / 7), band, seed + 63);
      let index = level(palette, 0.50);
      const pick = hash2(band, 3, seed + 19);
      index += pick > 0.74 ? 1 : pick < 0.26 ? -1 : 0;
      if (dash > 0.40) {
        if (within < 0.26) index += 1;
        else if (within > 0.80) index -= 1;
      }
      const grain = fbm(chunky(wx) * 0.40, chunky(wy) * 0.40, seed + 31, 2);
      if (grain > 0.84) index += 1;
      else if (grain < 0.16) index -= 1;
      return step(palette, index);
    }
    case "redsand": {
      // THE SIGNATURE TEXTURE: fine wind ripples. Same anti-wood-grain fix as
      // `sand` (broken dashes, locally jittered direction, single-step
      // contrast) plus a RARE deep-rust freckle instead of a periodic band
      // swap - the swap was the loudest contributor to the striped look.
      const jitter = (fbm(wx * 0.085, wy * 0.085, seed + 91, 2) - 0.5) * 0.9;
      const angle = REDSAND_ANGLE + jitter;
      const raw = contourOf(wx, wy, seed + 17, 0.30, 0.05, 2.4, angle);
      const band = Math.floor(raw);
      const within = raw - band;
      const along = wx * Math.sin(angle) - wy * Math.cos(angle);
      const dash = hash2(Math.floor(along / 6), band, seed + 63);
      let index = level(palette, 0.44);
      const pick = hash2(band, 3, seed + 19);
      index += pick > 0.72 ? 1 : pick < 0.30 ? -1 : 0;
      if (dash > 0.35) {
        if (within < 0.22) index += 1; // the ripple's lit crest
        else if (within > 0.82) index -= 1; // its shaded trough
      }
      const grain = fbm(chunky(wx) * 0.46, chunky(wy) * 0.46, seed + 41, 2);
      if (grain > 0.85) index += 1;
      else if (grain < 0.15) index -= 1;
      if (hash2(chunky(wx), chunky(wy), seed + 77) > 0.965) {
        return step(REDSAND_DEEP, level(REDSAND_DEEP, 0.30 + grain * 0.5));
      }
      return step(palette, index);
    }
    case "oxide": {
      // Fine angular chips of dark maroon-red desert pavement, with scattered
      // charcoal varnish flecks. `angular: true` gives irregular quadrilateral
      // chips rather than round pebbles - the Warm Springs `rock` lesson.
      const cell = voronoiCell(wx, wy, 8, seed + 7, { angular: true });
      const joint = cell.second - cell.nearest;
      let index = level(palette, 0.26 + hash2(cell.nearKey, 3, seed + 97) * 0.50);
      index += cell.localY < -2 ? 1 : cell.localY > 2 ? -1 : 0;
      if (joint < 1.0) index -= 2;
      const varnish = hash2(chunky(wx), chunky(wy), seed + 61);
      if (varnish > 0.94) return ACCENT.varnish;
      const grain = fbm(chunky(wx) * 0.46, chunky(wy) * 0.46, seed + 71, 2);
      if (grain > 0.85) index += 1;
      else if (grain < 0.15) index -= 1;
      return step(palette, index);
    }
    case "gravel": {
      // Dense charcoal varnish lag, tight packed, with occasional lighter
      // chips - the third colour pole, kept genuinely near-black.
      const cell = voronoiCell(wx, wy, 6, seed + 9, { angular: true });
      const joint = cell.second - cell.nearest;
      let index = level(palette, 0.16 + hash2(cell.nearKey, 3, seed + 97) * 0.46);
      if (hash2(cell.nearKey, 9, seed + 103) > 0.90) index += 3;
      if (joint < 0.7) index -= 2;
      return step(palette, index);
    }
    case "dustgrass": {
      // Sparse bleached blades over sand - deliberately sparser than a Warm
      // Springs sward: this is the faintest possible tie to green Nirvana.
      const clump = fbm(wx * 0.20, wy * 0.20, seed + 11, 3);
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 23, 2);
      let index = level(palette, 0.28 + clump * 0.40 + (grain - 0.5) * 0.30);
      const bladePick = hash2(Math.floor(wx), Math.floor(wy / 3), seed + 37);
      if (bladePick > 0.90) {
        index += hash2(Math.floor(wx), Math.floor(wy), seed + 53) > 0.44 ? 1 : -1;
      }
      return step(palette, index);
    }
    case "thorn": {
      // Overlapping spiky crowns, dry and hard-silhouetted.
      const mass = fbm(wx * 0.17, wy * 0.17, seed + 111, 3);
      const bushX = wx * 0.42;
      const bushY = wy * 0.42;
      const crown = fbm(bushX, bushY, seed + 127, 2);
      const gradient = fbm(bushX, bushY - 0.55, seed + 127, 2) - crown;
      let index = level(palette, 0.04 + mass * 0.26 + crown * 0.42 + gradient * 2.2);
      if (crown < 0.34) index -= 1;
      const twig = hash2(Math.floor(wx), Math.floor(wy), seed + 139);
      if (twig > 0.975) return ACCENT.spine;
      if (twig < 0.016) return ACCENT.twig;
      return step(palette, index);
    }
    case "mesa": {
      // The caprock seen from ABOVE: a fractured pavement of angular joint-
      // blocks, not a banded cliff face (that band-fibre approach printed a
      // 32px lattice - see `scarp`'s note). Same trusted cellular discipline
      // as `oxide`, tuned larger and lighter: a lit block crown, a dark joint
      // line, quiet isotropic grain. No directional structure anywhere.
      const cell = voronoiCell(wx, wy, 15, seed + 3, { angular: true });
      const joint = cell.second - cell.nearest;
      let index = level(palette, 0.56 + hash2(cell.nearKey, 3, seed + 97) * 0.34);
      if (cell.nearest < 3.2) index += 1; // the block's own lit crown
      if (joint < 1.2) index -= 3; // the dark joint line
      else if (joint < 2.4) index -= 1;
      const grain = fbm(chunky(wx) * 0.40, chunky(wy) * 0.40, seed + 41, 2);
      if (grain > 0.87) index += 1;
      else if (grain < 0.15) index -= 1;
      return step(palette, index);
    }
    case "scarp": {
      // THE RISK MATERIAL: must read as eroded rock, never a fence - and, it
      // turns out, never wood grain either. A first pass ran a smooth
      // contoured gradient and it read as carved timber, printing the 32px
      // lattice everywhere two variants' grain direction disagreed. Real
      // strata are DISTINCT HARD-EDGED BEDS of differing tone, not a
      // continuous fibre, so each band now takes ONE FLAT tone (no
      // within-band gradient at all) and the direction is locally jittered
      // so no straight line survives more than a few pixels.
      // The jitter must oscillate SEVERAL times across one 32px tile, not
      // once - a slow (near tile-period) jitter makes each tile settle on
      // its own near-constant sub-angle, which is a lattice by another name.
      const jitter = (fbm(wx * 0.09, wy * 0.09, seed + 91, 2) - 0.5) * 0.70;
      const raw = contourOf(wx, wy, seed + 13, 0.155, 0.016, 2.2, SCARP_ANGLE + jitter);
      const band = Math.floor(raw);
      const bandTone = hash2(band, 7, seed + 19);
      let index = level(palette, 0.26 + bandTone * 0.46);
      // talus / rubble breaking every bed - the anti-fence, anti-lattice texture
      const rubble = fbm(chunky(wx) * 0.55, chunky(wy) * 0.55, seed + 53, 2);
      if (rubble > 0.80) index -= 2;
      else if (rubble < 0.16) index += 1;
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 61, 2);
      if (grain > 0.84) index -= 1;
      else if (grain < 0.14) index += 1;
      return step(palette, index);
    }
    case "slot": {
      // A shadowed fissure: near-black, with a SINGLE thin lit lip along one
      // edge and a soft falloff into black - nothing else. Two prior passes
      // (parallel streaks, then scattered lit pockets) both read as texture
      // - wood grain, then a starfield. The fix is to stop texturing it: one
      // smooth periodic band (so it tiles with no seam) and quiet grain only.
      const cycle = (Math.cos(wy * (Math.PI * 2) / 32) + 1) / 2;
      let index = level(palette, 0.04 + cycle * cycle * 0.32);
      const grain = fbm(chunky(wx) * 0.35, chunky(wy) * 0.35, seed + 41, 2);
      if (grain > 0.90) index -= 1;
      return step(palette, index);
    }
    default:
      throw new Error(`unknown material ${material}`);
  }
}

// ---------------------------------------------------------------------------
// surface helpers (verbatim from the Warm Springs / Nirvana pilots)
// ---------------------------------------------------------------------------

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

/** Lay a quantised-alpha pixel of ONE fixed colour. Shadows and cast relief only. */
function veil(surface, x, y, rgb, alpha) {
  const quantised = quantiseAlpha(alpha);
  if (quantised === 0) return;
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  if (surface.data[index + 3] === 255) return;
  surface.data[index] = rgb[0];
  surface.data[index + 1] = rgb[1];
  surface.data[index + 2] = rgb[2];
  surface.data[index + 3] = Math.max(surface.data[index + 3], quantised);
}

/** Soft elliptical contact shadow at a sprite's foot, cast down-right. */
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

/**
 * A WIDE-BLEED elliptical cast shadow, for the landform family's much bigger
 * ground bleed (1.5-2 tiles beyond the silhouette per the brief). Deliberately
 * NOT `paintContactShadow`'s falloff: `strength * (1-d)^1.6` quantised into
 * only 4 alpha levels rounds to ZERO once distance exceeds ~36% of the
 * nominal radius - fine for a small prop's tight foot shadow, but it means a
 * radius sized for a wide bleed renders as an invisible shadow with an
 * effective radius smaller than the rock itself (measured while debugging
 * this exact painter). A near-linear falloff keeps roughly two-thirds of the
 * nominal radius visibly above the quantisation floor instead.
 *
 * `frameWidth`/`frameHeight` clip the loop to the sprite's OWN local frame -
 * required here (unlike `paintContactShadow`'s small, tightly-fitted radii)
 * because a wide-bleed radius sized for a 1.5-2 tile ground skirt can easily
 * exceed the local frame bounds. `veil` only bounds-checks against the whole
 * SHARED atlas canvas, so an unclipped overflow silently bleeds into
 * whatever neighbouring sprite is shelf-packed just below/beside this one -
 * exactly what happened here before this clip was added (measured: mesa's
 * ambient wash painted a stray grey sliver into the outcrop/butte row).
 */
function paintLandformShadow(surface, ox, oy, frameWidth, frameHeight, centerX, footY, radiusX, radiusY, strength) {
  const yMin = Math.max(0, Math.floor(footY - radiusY));
  const yMax = Math.min(frameHeight - 1, Math.ceil(footY + radiusY));
  const xMin = Math.max(0, Math.floor(centerX - radiusX));
  const xMax = Math.min(frameWidth - 1, Math.ceil(centerX + radiusX));
  for (let y = yMin; y <= yMax; y += 1) {
    for (let x = xMin; x <= xMax; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - footY) / radiusY;
      const distance = Math.hypot(dx, dy);
      if (distance > 1) continue;
      veil(surface, ox + x, oy + y, ACCENT.shadow, strength * (1 - distance) ** 0.65);
    }
  }
}

// ---------------------------------------------------------------------------
// terrain frames
// ---------------------------------------------------------------------------

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

/**
 * Corner-mask alpha field.
 * Bit order: 1 = NW, 2 = NE, 4 = SE, 8 = SW.
 * Perturbation is windowed to zero on the tile border, so the boundary joins
 * exactly across tile seams and the material edge reads as one continuous curve.
 */
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

/** The seed for one transition. The shoreline set MUST reuse it. */
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

/**
 * How a material's transition behaves at its own outer edge - `drop` steps
 * the rim darker (the contact shadow that seats the upper material ON the
 * lower one), `speck` throws detached outliers just beyond the boundary so
 * the seam does not read as a drawn line.
 */
const EDGE_STYLE = Object.freeze({
  thorn: { drop: [2, 1], speck: 0.86 },
  dustgrass: { drop: [2, 1], speck: 0.90 },
  oxide: { drop: [1, 1], speck: 0.85 },
  gravel: { drop: [1, 1], speck: 0.88 },
  brine: { drop: [1, 1], speck: 0.92 },
  brinerim: { drop: [1, 1], speck: 0.92 },
  mesa: { drop: [2, 1], speck: 0.82 }, // the rim of loose blocks
  scarp: { drop: [2, 2], speck: 0.76 }, // the talus fan at the foot
});
const DEFAULT_EDGE_STYLE = Object.freeze({ drop: [1, 1], speck: 0.90 });

function paintEdgeTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const [offsetX, offsetY] = edgeOffsets(material, mask, variant);
  const palette = PALETTES[material];
  const style = EDGE_STYLE[material] ?? DEFAULT_EDGE_STYLE;
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      const alpha = quantiseAlpha(smoothstep(0.42, 0.60, field));
      if (alpha === 0) {
        if (field > 0.22) {
          const speck = hash2(x + originX, y + originY, seed + 131);
          if (speck > style.speck + (0.42 - field) * 0.6) {
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
      const drop = rim > 0.62 ? style.drop[0] : rim > 0.24 ? style.drop[1] : 0;
      const at = palette.indexOf(colour);
      const shaded = drop === 0 || at < 0 ? colour : step(palette, at - drop);
      setPixel(surface, originX + x, originY + y, [shaded[0], shaded[1], shaded[2], alpha]);
    }
  }
}

/**
 * One shoreline / salt-efflorescence frame: where brine or brinerim meets
 * salt, hardpan or oxide. Laid over the bank's own transition frame and
 * SHARING its seed, so the crust ring follows exactly the same contour the
 * bank edge was cut with - Warm Springs' "single most beautiful detail"
 * lesson, applied here as a bright broken mineral bloom (from `ACCENT.crust`
 * / `crustDim`) with a darker wet-stained band just inside it.
 */
function paintShoreTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const palette = WET[material];
  const nodules = material === "salt";
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      if (field >= 0.505 && field < 0.72) {
        const depth = (field - 0.505) / 0.215;
        const damp = fbm((x + originX) * 0.36, (y + originY) * 0.36, seed + 197, 2);
        const wetLevel = depth < 0.30 ? 0 : depth < 0.66 ? 1 : 2;
        const colour = step(palette, wetLevel + (damp > 0.64 ? 1 : 0));
        setPixel(surface, originX + x, originY + y, [
          colour[0], colour[1], colour[2], depth < 0.82 ? 255 : ALPHA_LEVELS[2],
        ]);
        continue;
      }
      if (field >= 0.40 && field < 0.515) {
        const near = (field - 0.40) / 0.115;
        const broken = fbm((x + originX) * 0.42, (y + originY) * 0.42, seed + 211, 2);
        const bias = nodules ? 0.16 : 0.06;
        // The salt-efflorescence bloom: pushed to wider coverage and a
        // brighter bias than Warm Springs' crust ring, since this is the
        // region's second identity texture and it read too faint at 1:1.
        if (broken > 0.50 - near * 0.26 - bias) {
          const bright = broken > 0.68 && near > 0.30;
          const colour = bright ? ACCENT.crust : ACCENT.crustDim;
          setPixel(surface, originX + x, originY + y, [
            colour[0], colour[1], colour[2], bright ? ALPHA_LEVELS[3] : ALPHA_LEVELS[2],
          ]);
        }
      }
    }
  }
}

export function terrainFrameLayout() {
  const frames = [];
  for (const material of FIELD_MATERIALS) {
    for (let variant = 0; variant < BASE_VARIANTS; variant += 1) {
      frames.push({ id: `t.${material}.${variant}`, kind: "base", material, variant });
    }
  }
  for (const material of FIELD_MATERIALS) {
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

/** Terrain sheet width in cells. Frame rects are derived from this. */
export const TERRAIN_COLUMNS = 16;

function buildTerrainAtlas() {
  const frames = terrainFrameLayout();
  const columns = TERRAIN_COLUMNS;
  const rows = Math.ceil(frames.length / columns);
  const surface = createSurface(columns * TILE, rows * TILE);
  const records = [];
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
      default:
        paintShoreTile(surface, originX, originY, frame.material, frame.mask, frame.variant);
        break;
    }
    records.push({
      id: frame.id,
      image: "terrain",
      rect: { x: originX, y: originY, width: TILE, height: TILE },
      pivot: { x: 0, y: 0 },
    });
  });
  return { surface, records };
}

// ---------------------------------------------------------------------------
// scenery - the thirteen prop kinds of contract section 6, PLUS the new
// `mesa`/`butte`/`outcrop` landform-object family appended at the end (the
// "raised object, not a colour patch" proof - see the landform section
// below `paintPlank`). Not yet part of the frozen contract table; additive,
// so it does not renumber or reshape anything the contract already promised.
// ---------------------------------------------------------------------------

const SCENERY_SPECS = Object.freeze([
  { id: "thornbush", width: 40, height: 44, variants: 4, pivot: [20, 41] },
  { id: "deadwood", width: 36, height: 56, variants: 3, pivot: [18, 53] },
  { id: "mesquite", width: 56, height: 76, variants: 3, pivot: [28, 72] },
  { id: "boulder", width: 44, height: 40, variants: 4, pivot: [22, 37] },
  { id: "hoodoo", width: 32, height: 84, variants: 3, pivot: [16, 80] },
  { id: "saltbush", width: 32, height: 28, variants: 4, pivot: [16, 26] },
  { id: "bunchgrass", width: 24, height: 32, variants: 4, pivot: [12, 30] },
  { id: "cracks", width: 32, height: 32, variants: 4, pivot: [16, 29] },
  { id: "bones", width: 24, height: 18, variants: 3, pivot: [12, 16] },
  { id: "saltrime", width: 32, height: 24, variants: 3, pivot: [16, 22] },
  { id: "pebbles", width: 32, height: 20, variants: 4, pivot: [16, 18] },
  // The dustdevil is Nirvana East's steam pass: faint, wispy, tall, drawn
  // LAST over everything, regardless of foot anchor.
  { id: "dustdevil", width: 64, height: 88, variants: 2, pivot: [32, 84] },
  { id: "plank", width: 32, height: 32, variants: 6, pivot: [16, 31] },
  // The landform relief family - see the `paintLandform` section below
  // `paintPlank` for the full rationale. One variant per tier; pivot X is
  // frame-center (the existing single-shape props' own convention - see
  // `boulder`/`thornbush`/`hoodoo` above); pivot Y sits at the object's
  // ground-contact point, roughly where the cliff meets its talus apron,
  // NOT at the very bottom of the frame - the frame is deliberately larger
  // than the rock itself to leave room for the shadow/talus bleed.
  { id: "mesa", width: 512, height: 384, variants: 1, pivot: [256, 306] },
  { id: "butte", width: 288, height: 224, variants: 3, pivot: [144, 179] },
  { id: "outcrop", width: 160, height: 128, variants: 4, pivot: [80, 102] },
]);

/** Dark olive-grey thorn scrub: jagged radiating branches over a low crown. */
function paintThornbush(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 61_000 + variant * 1487;
  const baseX = width / 2;
  const baseY = height - 4;
  const branches = 10 + variant * 2;
  for (let index = 0; index < branches; index += 1) {
    const angle = -Math.PI * 0.72 + (index / branches) * Math.PI * 1.44
      + (hash2(index, variant, seed) - 0.5) * 0.30;
    const length = height * (0.48 + hash2(index, variant, seed + 3) * 0.42);
    const jag = 3 + Math.floor(hash2(index, variant, seed + 5) * 3);
    let x = baseX;
    let y = baseY;
    for (let segment = 0; segment < jag; segment += 1) {
      const t = (segment + 1) / jag;
      const wobble = (hash2(index, segment, seed + 7) - 0.5) * 5;
      const nx = baseX + Math.cos(angle) * length * t + wobble * (1 - t);
      const ny = baseY + Math.sin(angle) * length * t * 0.62;
      const steps = Math.max(1, Math.round(Math.hypot(nx - x, ny - y)));
      for (let s = 0; s <= steps; s += 1) {
        const px = Math.round(x + (nx - x) * (s / steps));
        const py = Math.round(y + (ny - y) * (s / steps));
        put(surface, ox + px, oy + py, step(PALETTES.thorn, level(PALETTES.thorn, 0.30 + (1 - t) * 0.5)));
      }
      x = nx;
      y = ny;
    }
    if (hash2(index, variant, seed + 11) > 0.55) {
      put(surface, ox + Math.round(x), oy + Math.round(y), ACCENT.spine);
    }
  }
  for (let y = Math.round(baseY - height * 0.30); y < baseY; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - baseX) / (width * 0.38);
      const dy = (y - (baseY - height * 0.14)) / (height * 0.22);
      const d = Math.hypot(dx, dy);
      const edge = fbm(x * 0.30 + variant * 9, y * 0.30, seed + 13, 2);
      if (d > 0.70 + edge * 0.34) continue;
      if (hash2(x, y, seed + 17) > 0.46) continue;
      const lit = 0.18 + (1 - d) * 0.38 + (edge - 0.5) * 0.3;
      put(surface, ox + x, oy + y, step(PALETTES.thorn, level(PALETTES.thorn, lit)));
    }
  }
}

/** A bleached fallen trunk / standing snag with broken branch stubs. */
function paintDeadwood(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 62_000 + variant * 1301;
  const baseX = width / 2;
  const baseY = height - 3;
  const lean = (hash2(variant, 1, seed) - 0.5) * 6;
  const top = height * (0.10 + hash2(variant, 2, seed) * 0.08);
  for (let y = Math.floor(top); y < baseY; y += 1) {
    const t = (y - top) / (baseY - top);
    const taper = 1.4 + (1 - t) * 1.7;
    const cx = baseX + lean * t;
    for (let dx = -taper; dx <= taper; dx += 1) {
      const shade = level(BLEACHWOOD, 0.28 + (1 - Math.abs(dx) / taper) * 0.52 - t * 0.10);
      put(surface, ox + Math.round(cx + dx), oy + y, step(BLEACHWOOD, shade));
    }
    if (hash2(Math.floor(y / 3), variant, seed + 5) > 0.80) {
      const stubSide = hash2(y, variant, seed + 7) > 0.5 ? 1 : -1;
      const stubLen = 3 + Math.floor(hash2(y, variant, seed + 9) * 4);
      for (let s = 1; s <= stubLen; s += 1) {
        put(surface, ox + Math.round(cx + taper * stubSide + s * stubSide * 0.7),
          oy + y - Math.floor(s * 0.4), step(BLEACHWOOD, 2));
      }
    }
  }
  for (let dx = -5; dx <= 5; dx += 1) {
    put(surface, ox + Math.round(baseX + lean + dx * 0.6), oy + baseY,
      step(BLEACHWOOD, Math.abs(dx) > 3 ? 0 : 1));
  }
}

/**
 * Mesquite: the region's only canopy - and it must read as DESERT, not as
 * Nirvana's lush lollipop tree. A real mesquite is sparse and open-crowned:
 * you see through it. So the crown is WIDE and FLAT (not round), built from
 * many small separate leaf clusters with real gaps between them rather than
 * one solid filled lobe, over a dark, visibly crooked trunk.
 */
function paintMesquite(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 63_000 + variant * 1409;
  const centerX = width / 2;
  const crownY = height * 0.32;
  const radiusX = width * 0.48;
  const radiusY = height * 0.22;
  const lean = (hash2(variant, 8, seed) - 0.5) * 6;
  const trunkTop = crownY + radiusY * 0.55;
  for (let y = Math.floor(trunkTop); y < height - 2; y += 1) {
    const t = (y - trunkTop) / Math.max(1, height - trunkTop);
    const taper = 1.3 + (1 - t) * 1.1;
    const kink = Math.sin(t * 3.4 + variant * 1.7) * 3.2 + lean * t;
    for (let x = Math.floor(centerX - taper + kink); x <= centerX + taper + kink; x += 1) {
      const tt = (x - (centerX + kink)) / Math.max(0.6, taper);
      put(surface, ox + x, oy + y, step(THORN_BARK, level(THORN_BARK, 0.14 + (1 - Math.abs(tt)) * 0.34)));
    }
  }
  const clusters = 26;
  for (let index = 0; index < clusters; index += 1) {
    const angle = hash2(index, variant, seed + 3) * Math.PI * 2;
    const spread = Math.sqrt(hash2(index, variant, seed + 5));
    const cx = centerX + Math.cos(angle) * radiusX * spread;
    const cy = crownY + Math.sin(angle) * radiusY * spread * 0.9;
    const r = 3 + hash2(index, variant, seed + 7) * 3;
    const clusterLit = (hash2(index, 9, seed + 13) - 0.5) * 0.3;
    for (let y = Math.floor(cy - r); y <= cy + r; y += 1) {
      for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        if (hash2(x, y, seed + 11) > 0.42) continue; // the haze: mostly gaps
        const lit = 0.30 + (1 - d) * 0.34 + clusterLit;
        put(surface, ox + x, oy + y, step(MESQUITE_LEAF, level(MESQUITE_LEAF, lit)));
      }
    }
  }
}

/**
 * Red sandstone erratic, varnish-streaked. A first pass computed the streak
 * position from `x` alone (constant down every column), which produced even
 * parallel full-height dark bands - a barrel with hoops, not a rock. Streaks
 * now come from real 2D noise so they MEANDER and taper, and the block is
 * squat (wider than tall) with a small apron of its own broken-off debris.
 */
function paintBoulder(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 64_000 + variant * 1523;
  const palette = PALETTES.mesa;
  const centerX = width / 2;
  const centerY = height * 0.52;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.46);
      const dy = (y - centerY) / (height * 0.32);
      const wobble = fbm(x * 0.15 + variant * 9, y * 0.15, seed, 3) - 0.5;
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const radius = Math.max(ax, ay) * 0.60 + Math.hypot(dx, dy) * 0.40;
      if (radius > 0.90 + wobble * 0.30) continue;
      const facet = fbm(x * 0.11 + variant * 3, y * 0.13, seed + 7, 2);
      let index = level(palette, 0.22 + facet * 0.44 - dy * 0.38 - dx * 0.14);
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.90) index -= 1;
      const drip = fbm(x * 0.14 + variant * 11, y * 0.11, seed + 19, 3);
      if (drip > 0.70 && dy < 0.55) {
        const fade = Math.max(0, 0.55 - dy) / 0.55;
        put(surface, ox + x, oy + y, step(PALETTES.gravel, fade > 0.5 ? 2 : 1));
        continue;
      }
      put(surface, ox + x, oy + y, step(palette, index));
    }
  }
  for (let index = 0; index < 6; index += 1) {
    const x = Math.round(centerX + (hash2(index, variant, seed + 23) - 0.5) * width * 0.8);
    const y = Math.round(height * 0.82 + hash2(index, variant, seed + 27) * height * 0.14);
    put(surface, ox + x, oy + y, step(PALETTES.gravel, 1 + Math.floor(hash2(index, variant, seed + 29) * 2)));
  }
}

/**
 * A slender eroded pinnacle. A first pass gave it a symmetric disc capstone
 * on a perfectly centred, evenly-tapered neck and it read as a mushroom or a
 * goblet. A real hoodoo is an irregular stack of beds: the neck sits
 * OFF-CENTRE under the cap (so the overhang is stronger on one side), tapers
 * UNEVENLY rather than smoothly, and the same banding continues from the
 * neck up into the underside of the cap - one eroded column, not two parts.
 */
function paintHoodoo(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 65_000 + variant * 1601;
  const neckCenterX = width * (0.42 + hash2(variant, 9, seed) * 0.16);
  const capCenterX = width * (0.50 + (hash2(variant, 10, seed) - 0.5) * 0.20);
  const capTopY = height * (0.06 + hash2(variant, 11, seed) * 0.04);
  const capBottomY = capTopY + height * 0.20;
  const capHalfW = width * (0.30 + variant * 0.02);
  const neckTopY = capBottomY - height * 0.03;
  const neckBaseY = height - 6;
  const neckTopW = width * 0.15;
  const neckBaseW = width * 0.23;

  for (let y = Math.floor(capTopY); y < capBottomY; y += 1) {
    const t = (y - capTopY) / (capBottomY - capTopY);
    // narrow rounded top, bulging near the base of the cap - the overhang
    const bulge = Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.62);
    const rx = capHalfW * (0.50 + bulge * 0.62);
    const wobble = (fbm(y * 0.30, variant * 4, seed, 2) - 0.5) * 3;
    for (let x = Math.round(capCenterX - rx + wobble); x <= capCenterX + rx + wobble; x += 1) {
      const across = (x - capCenterX - wobble) / rx;
      const band = Math.floor(y * 0.35 + hash2(Math.floor(y / 2), variant, seed + 3) * 0.5);
      let index = level(PALETTES.mesa, 0.62 - t * 0.18 - Math.abs(across) * 0.22);
      if (band % 3 === 0) index += 1;
      if (t < 0.15) index += 1;
      put(surface, ox + x, oy + y, step(PALETTES.mesa, index));
    }
  }
  for (let y = Math.floor(neckTopY); y < neckBaseY; y += 1) {
    const t = (y - neckTopY) / (neckBaseY - neckTopY);
    const unevenTaper = 1 + (fbm(y * 0.15, variant * 5, seed + 7, 2) - 0.5) * 0.6;
    const halfW = ((neckTopW + (neckBaseW - neckTopW) * t) / 2) * unevenTaper;
    const wobble = (fbm(y * 0.22, variant * 5, seed + 3, 3) - 0.5) * 3.2;
    const cx = neckCenterX + wobble;
    for (let x = Math.round(cx - halfW); x <= cx + halfW; x += 1) {
      const across = (x - cx) / Math.max(1, halfW);
      const band = Math.floor(y * 0.30 + hash2(Math.floor(y / 3), variant, seed + 7) * 0.6);
      let index = level(PALETTES.scarp, 0.26 + (1 - Math.abs(across)) * 0.30);
      index += band % 3 === 0 ? 1 : band % 4 === 2 ? -1 : 0;
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.88) index -= 1;
      put(surface, ox + x, oy + y, step(PALETTES.scarp, index));
    }
  }
  for (let index = 0; index < 8; index += 1) {
    const x = Math.round(neckCenterX + (hash2(index, variant, seed + 13) - 0.5) * width * 0.7);
    const y = Math.round(neckBaseY + hash2(index, variant, seed + 17) * 4);
    put(surface, ox + x, oy + y, step(PALETTES.scarp, 1 + Math.floor(hash2(index, variant, seed + 19) * 2)));
  }
}

/** A pale silver-grey low bush - saltbush, non-blocking. */
function paintSaltbush(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 66_000 + variant * 1697;
  const centerX = width / 2;
  const centerY = height * 0.62;
  const radiusX = width * 0.46;
  const radiusY = height * 0.40;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const edge = fbm(x * 0.26 + variant * 9, y * 0.26, seed, 3);
      const d = Math.hypot(dx, dy);
      if (d > 0.72 + edge * 0.34) continue;
      if (hash2(x, y, seed + 3) > 0.52) continue;
      const lit = 0.24 + (1 - d) * 0.42 + (edge - 0.5) * 0.4;
      put(surface, ox + x, oy + y, step(SILVER, level(SILVER, lit)));
    }
  }
}

/** A bleached khaki bunchgrass tussock. */
function paintBunchgrass(surface, ox, oy, spec, variant) {
  const { height } = spec;
  const seed = 67_000 + variant * 1783;
  const palette = PALETTES.dustgrass;
  const blades = 20 + variant * 5;
  const rootY = height - 2;
  for (let index = 0; index < blades; index += 1) {
    const rootX = spec.width / 2 + (hash2(index, variant, seed) - 0.5) * spec.width * 0.5;
    const length = Math.round(height * (0.42 + hash2(index, variant, seed + 3) * 0.50));
    const arch = (hash2(index, variant, seed + 5) - 0.5) * 7;
    const base = level(palette, 0.24 + hash2(index, variant, seed + 7) * 0.50);
    for (let s = 0; s < length; s += 1) {
      const t = s / length;
      const x = Math.round(rootX + arch * t * t);
      const y = rootY - s;
      put(surface, ox + x, oy + y, step(palette, base + Math.round(t * 2)));
    }
  }
}

/** Polygon crack decal for the salt / hardpan ground - a transparent stamp. */
function paintCracks(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 68_000 + variant * 1861;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cell = voronoiCell(x, y, 10 + variant * 2, seed + 5);
      const joint = cell.second - cell.nearest;
      if (joint < 0.9) {
        const bright = hash2(cell.nearKey, cell.secondKey, seed + 9) > 0.5;
        const colour = bright ? SALT_JOINT[2] : SALT_JOINT[0];
        setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], bright ? 220 : 190]);
      }
    }
  }
}

/** Sun-bleached bone / horn: a simple curved capsule shape. */
function paintBones(surface, ox, oy, spec, variant) {
  const { width } = spec;
  const seed = 71_000 + variant * 2111;
  const centerY = spec.height * 0.6;
  const curve = (hash2(variant, 1, seed) - 0.5) * 4;
  for (let x = 2; x < width - 2; x += 1) {
    const t = x / width;
    const y = centerY + Math.sin(t * Math.PI) * curve;
    const thickness = 1.4 + Math.sin(t * Math.PI) * 1.6 + (x < 4 || x > width - 5 ? 1.4 : 0);
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      const lit = 0.55 - (dy / thickness) * 0.4;
      put(surface, ox + x, oy + Math.round(y + dy), step(BONE, level(BONE, lit)));
    }
  }
  paintContactShadow(surface, ox, oy, width / 2, centerY + 3, width * 0.36, 2.4, 0.30);
}

/** White efflorescence bloom decal for open ground - scattered translucent patches. */
function paintSaltrime(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 69_000 + variant * 1949;
  const centerX = width / 2;
  const centerY = height * 0.56;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.48);
      const dy = (y - centerY) / (height * 0.42);
      const d = Math.hypot(dx, dy);
      const bloom = fbm(x * 0.30 + variant * 7, y * 0.30, seed, 3);
      if (d > 0.90 || bloom < 0.42 + d * 0.30) continue;
      const bright = bloom > 0.66;
      const colour = bright ? ACCENT.crust : ACCENT.crustDim;
      setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], bright ? 235 : 190]);
    }
  }
}

/** Varnish pebble scatter decal. */
function paintPebbles(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 70_000 + variant * 2027;
  const count = 14 + variant * 3;
  for (let index = 0; index < count; index += 1) {
    const x = Math.round(hash2(index, variant, seed) * width);
    const y = Math.round(height * 0.3 + hash2(index, variant, seed + 3) * height * 0.65);
    const r = 1 + Math.floor(hash2(index, variant, seed + 5) * 2);
    const shade = level(PALETTES.gravel, 0.16 + hash2(index, variant, seed + 7) * 0.6);
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.hypot(dx, dy) > r) continue;
        put(surface, ox + x + dx, oy + y + dy, step(PALETTES.gravel, shade + (dy < 0 ? 1 : 0)));
      }
    }
  }
}

/** Faint wispy ochre-white dust plume, drawn LAST over everything. */
function paintDustdevil(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 72_000 + variant * 2213;
  const baseX = width * (0.32 + hash2(variant, 1, seed) * 0.10);
  const drift = width * (0.18 + hash2(variant, 2, seed) * 0.14);
  const lean = 1.05 + hash2(variant, 3, seed) * 0.30;
  for (let y = 0; y < height; y += 1) {
    const t = 1 - y / (height - 1);
    const centerX = baseX + drift * t ** lean;
    const radius = width * (0.05 + 0.30 * t ** 0.78);
    for (let x = 0; x < width; x += 1) {
      const across = (x - centerX) / radius;
      if (Math.abs(across) > 1.3) continue;
      const puff = fbm(x * 0.15 + variant * 17, y * 0.12 - t * 3.0, seed + 3, 3);
      const curl = fbm(x * 0.24 - t * 1.3, y * 0.20 - t * 2.4, seed + 11, 2);
      let density = (1.08 - across * across) * (0.28 + puff * 1.10) * (1.05 - t * 0.55);
      density += (curl - 0.5) * 0.36;
      if (across > 0.66) density -= (across - 0.66) * 1.4;
      if (t > 0.45) density -= (t - 0.45) * 0.7;
      if (density <= 0.16) continue;
      const alphaLevel = density > 0.48 ? 1 : 0;
      const colour = density > 0.36 ? DUST_BRIGHT : DUST_DIM;
      setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], DUST_ALPHAS[alphaLevel]]);
    }
  }
}

/**
 * One plank causeway piece. Six variants cover both axes and the ends:
 * 0/1 = horizontal straight, 2/3 = vertical straight, 4 = horizontal end,
 * 5 = vertical end - a single `s.plank.<v>` kind, per the frozen prop list.
 */
function paintPlank(surface, ox, oy, spec, variant) {
  const size = spec.width;
  const vertical = variant === 2 || variant === 3 || variant === 5;
  const isEnd = variant === 4 || variant === 5;
  const seed = 73_000 + variant * 977;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), PLANK_SHADOW, alpha);
  };
  if (!isEnd) {
    for (let along = 0; along < size; along += 1) {
      const plank = Math.floor(along / 4);
      const seamLine = along % 4 === 0;
      const worn = hash2(plank, variant, seed) > 0.58;
      for (let across = 5; across <= 24; across += 1) {
        let colour;
        if (across <= 6 || across >= 23) colour = PLANK.edge;
        else if (across === 7) colour = PLANK.lit;
        else if (seamLine) colour = PLANK.seam;
        else colour = worn ? PLANK.fresh : PLANK.body;
        place(along, across, colour);
      }
      shade(along, 26, 0.40);
      shade(along, 27, 0.24);
      shade(along, 3, 0.20);
    }
  } else {
    // The pier terminus. A first pass bulged the width symmetrically at the
    // MIDDLE of the strip, which - with no adjoining straight piece for
    // context - reads as a barrel, not a plank. The deck now stays full
    // width for most of its length and narrows to a single rounded cap at
    // ONE end only, like a causeway simply stopping.
    const capZone = size - 7;
    for (let along = 0; along < size; along += 1) {
      let from = 5;
      let to = 24;
      if (along >= capZone) {
        const t = (along - capZone) / (size - 1 - capZone);
        const shrink = Math.round(t * 7);
        from = 5 + shrink;
        to = 24 - shrink;
      }
      for (let across = from; across <= to; across += 1) {
        let colour;
        if (across <= from + 1 || across >= to - 1) colour = PLANK.edge;
        else if (along % 5 === 0) colour = PLANK.seam;
        else colour = hash2(Math.floor(along / 5), variant, seed) > 0.5 ? PLANK.fresh : PLANK.body;
        place(along, across, colour);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// landform relief family - s.mesa / s.butte / s.outcrop  (PASS 2)
//
// Pass 1 answered the ARCHITECTURE question (the owner's "I don't understand
// what it is trying to depict"): the camera is flat top-down, so a mesa drawn
// as a terrain colour-tier is flat BY CONSTRUCTION. Landforms therefore live
// on the scenery layer as authored OBJECTS, and with a cast shadow, a lit
// cap, a strata band and a talus fan the object genuinely read as RAISED.
// That result is kept intact here and must not regress.
//
// Pass 1's remaining fault, and this pass's whole job: it read as a BOULDER
// or a loaf, not a MESA. Five named defects, five targeted fixes:
//
//  1. THE TOP WAS DOMED. A mesa's defining feature is a FLAT top - a table.
//     Pass 1 shaded the cap with a full-width directional gradient
//     (`lit = 0.48 - (dx+dy)*0.34`), which is the shading of a SPHERE. A
//     level plane under a distant key light is UNIFORMLY lit, so the cap is
//     now one near-constant tone; what breaks its flatness is jointing and a
//     whisper of low-frequency bench tone, never a radial ramp.
//  2. THE SIDES WERE ROUNDED. A mesa has near-VERTICAL cliff walls and the
//     cap/wall transition is an EDGE, not a curve. There is now a hard rim:
//     a bright 2-3 px caprock lip on the sun-facing (upper-left) contour, a
//     hard dark step on the shaded contour, and a near-black overhang line
//     across the top 3 rows of the wall. That rim line is what tells the eye
//     "this is a cliff top seen from above".
//  3. THE STRATA WERE A RIBBON AT THE BASE. The cap plan was 3x taller than
//     the wall, so the banding was a hem. The proportions are inverted: the
//     cap plan is ~0.38 H and the wall is 0.28-0.36 H, so the beds run the
//     FULL height of the exposed wall - nine hard-edged beds (buff ledge,
//     shadow recess, red bed, cream marl stringer, deep-red mudstone, a
//     sage-green shale band, and three lower reds) of DIFFERING thickness.
//  4. THE SILHOUETTE WAS A SOFT BLOB. The old per-sector radius offset gives
//     arcs with radial jumps - a notched circle, still round. The cap plan is
//     now a hand-authored 15-vertex POLYGON: straight edges meeting at
//     corners, a re-entrant side canyon biting in from the east, a second
//     notch in the south-west, and a promontory spur - rock breaks along
//     joints, it does not melt. A chunky 2 px noise rides on the boundary
//     distance so the edge is ragged rather than vector-clean, at an
//     amplitude far too small to round a corner.
//  5. THE CAP READ AS MUD-CRAZING. Pass 1 used `voronoiCell(..., 15, ...)` -
//     the SAME cell size as the `salt` ground and only 1.5x the `hardpan`
//     ground, so cap and floor were the same material and the object looked
//     like a lump of the floor. The cap is now a JOINTED BLOCK LATTICE: two
//     straight through-going joint sets at fixed angles (pitch ~0.085 W, so
//     3-4x the ground's crazing at every tier), ~18 % of joint segments
//     missing so it never reads as a printed grid, one flat tone per block.
//
// KEPT UNCHANGED, because they are the reason the object reads at all: the
// wide soft cast shadow falling DOWN-AND-RIGHT, the talus/scree fan seating
// the foot, the three size tiers, and the light convention - key light
// UPPER-LEFT, shadow down-and-right, verified against the shipped Nirvana
// valley art (`author-nirvana-valley-pilot-art.mjs`: "contact shadow at a
// sprite's foot, cast down-right to match the key light"). All four islands
// sit side by side on the world map; disagreeing shadows read as wrong.
//
// The lattice-plus-bed construction is also the cheap one: long constant
// runs across a row and a column-constant flute pattern are exactly what
// indexed8 PNG filtering collapses, where pass 1's per-pixel `fbm` grain and
// 15 px crazing were near-incompressible. Flatter, blockier and more correct
// pull the same direction, as they did once already in pass 1.
// ---------------------------------------------------------------------------

/**
 * The cap plan-view outlines, in NORMALISED frame coordinates (x right, y down,
 * roughly within [-1, 1]). Hand-authored rather than generated: a generator that
 * is irregular enough to look eroded is also irregular enough to look organic,
 * and the difference between "faceted rock" and "blob" is exactly where the
 * corners are.
 *
 * **Why there are four of them, and why plan 0 is untouched.** A single plan
 * shipped in production, and the landform infill then raised outcrops from 31 to
 * ~40 with 7-10 of them threading the settled band — so the repetition became
 * MORE visible than the approved plate's, not less, and it shows worst exactly
 * where the small tiers cluster. Every plan below shares the authored discipline
 * (long straight runs, corners with real angles, exactly ONE deep re-entrant
 * canyon per plan, and no fussy small-scale wiggle) so the family still reads as
 * one KIND of rock at every size; what differs is the silhouette a glance reads.
 *
 * `LANDFORM_PLANS[0]` is byte-for-byte the plan the owner approved across two
 * rounds. Every tier's variant 0 therefore still draws exactly the object that
 * won that gate — the new plans are strictly additive frames.
 */
const LANDFORM_PLANS = Object.freeze([
  // 0 — THE APPROVED PLAN. Long straight runs, one re-entrant side canyon on
  // the east flank, one notch in the south-west, a promontory spur down-left.
  Object.freeze([
    [-1.00, 0.02], // west point
    [-0.74, -0.72], // long straight run up to the north-west shoulder
    [-0.12, -0.99], // north point
    [0.28, -0.60], // -- shallow embayment in the north edge
    [0.70, -0.86],
    [0.99, -0.22], // east corner
    [0.60, 0.12], // -- the ONE deep side canyon, biting in from the east
    [0.93, 0.54], // -- and back out
    [0.46, 0.93], // south-east corner
    [-0.12, 0.99], // long straight southern run
    [-0.34, 0.50], // -- one modest notch, no more
    [-0.74, 0.78],
    [-0.94, 0.32],
  ]),
  // 1 — THE RIDGE. Leaner and longer, with a BLUNT SQUARED east end (two near
  // vertical runs meeting a straight wall) and its one deep canyon biting up
  // from the SOUTH instead of in from the east. Reads at a glance as a longer
  // table seen end-on, which is the silhouette plan 0 never makes.
  Object.freeze([
    [-1.00, -0.24], // west point
    [-0.58, -0.92], // hard corner up to the north-west shoulder
    [0.30, -0.96], // LONG straight northern run, no mid-vertex to round it
    [0.98, -0.40], // hard corner into the squared east end
    [1.00, 0.34], // -- and a straight blunt east wall down to the lower corner
    [0.52, 0.74],
    [0.34, 0.42], // -- the ONE canyon, biting up from the south
    [0.06, 0.88], // -- and back out
    [-0.46, 0.96], // south-west corner
    [-0.88, 0.50], // long straight run back to the west point
  ]),
  // 2 — THE ANVIL. Broad and blocky: four long straight walls, a CHIPPED
  // north-west corner (a cut, not a point) and its one deep canyon on the WEST
  // flank, so the eye reads the bite on the opposite side from plan 0's.
  Object.freeze([
    [-0.72, -0.94], // chipped north-west corner
    [0.34, -0.98], // long straight northern run
    [0.96, -0.62], // north-east bevel
    [0.98, 0.44], // straight east wall
    [0.58, 0.96], // south-east bevel
    [-0.30, 1.00], // long straight southern run
    [-0.66, 0.62],
    [-0.26, 0.34], // -- the ONE deep canyon, biting in from the west
    [-0.62, 0.02], // -- and back out
    [-1.00, -0.36], // west point
  ]),
  // 3 — THE WEDGE. Tapering: wide at the south-east, narrowing to a real point
  // in the north-west. Its one re-entrant is a shallow notch on the east flank
  // and its southern run carries a square step, so the whole plan is
  // asymmetric along the OTHER diagonal from plan 0.
  Object.freeze([
    [-0.98, -0.62], // the narrow north-west point
    [-0.34, -0.72],
    [0.28, -0.44], // long straight run down to the east
    [0.86, -0.06],
    [0.52, 0.24], // -- shallow notch in the east flank
    [0.98, 0.52], // -- and back out
    [0.44, 0.94], // wide south-east corner
    [-0.06, 0.66], // -- a square step in the southern run
    [-0.28, 0.98],
    [-0.80, 0.60],
    [-0.92, 0.02],
  ]),
]);

/** How many distinct cap plans the landform family carries. */
const LANDFORM_PLAN_COUNT = LANDFORM_PLANS.length;

/**
 * Blow the normalised plan for `variant` up into absolute frame pixels.
 *
 * Variants beyond the authored plan count wrap, so a tier may declare fewer
 * variants than there are plans (the mesa tier does) without any tier ever
 * addressing a plan that does not exist.
 */
function landformPolygon(centerX, centerY, radiusX, radiusY, variant) {
  const plan = LANDFORM_PLANS[variant % LANDFORM_PLAN_COUNT];
  return plan.map(([nx, ny]) => [centerX + nx * radiusX, centerY + ny * radiusY]);
}

/**
 * Ray-cast inside test plus the distance to (and outward normal of) the
 * nearest polygon edge, all in frame pixels. Returns `inside`, `edge` (the
 * unsigned pixel distance to the boundary) and the unit outward normal
 * `nx`/`ny` - which is what lets the rim be lit on the sun-facing contour
 * and dark on the shaded one without any reference to the centroid.
 */
function polygonProbe(polygon, px, py) {
  let inside = false;
  let best = Infinity;
  let bestX = 0;
  let bestY = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py)) {
      const cross = xi + ((py - yi) / (yj - yi)) * (xj - xi);
      if (px < cross) inside = !inside;
    }
    const ex = xj - xi;
    const ey = yj - yi;
    const lengthSquared = ex * ex + ey * ey;
    let t = lengthSquared > 0 ? ((px - xi) * ex + (py - yi) * ey) / lengthSquared : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (xi + t * ex);
    const dy = py - (yi + t * ey);
    const distance = Math.hypot(dx, dy);
    if (distance < best) {
      best = distance;
      bestX = dx;
      bestY = dy;
    }
  }
  const sign = inside ? -1 : 1;
  const scale = best > 1e-6 ? sign / best : 0;
  return { inside, edge: best, nx: bestX * scale, ny: bestY * scale };
}

/**
 * The exposed cliff wall's stratigraphy, top to foot. `t` is the bed's
 * NORMALISED tone within its own palette and `thickness` its share of the
 * wall height (the shares sum to 1). Beds of visibly DIFFERENT thickness are
 * most of what separates real sedimentary section from a striped awning; the
 * thin cream marl stringer and the sage-green shale band are the two that do
 * the most work, because neither is a shade of red.
 */
const CLIFF_BEDS = Object.freeze([
  { palette: PALETTES.mesa, t: 0.60, thickness: 0.11 }, // buff caprock ledge
  { palette: PALETTES.scarp, t: 0.12, thickness: 0.05 }, // shadowed recess beneath it
  { palette: PALETTES.redsand, t: 0.62, thickness: 0.12 }, // red sandstone
  { palette: PALETTES.oxide, t: 0.62, thickness: 0.08 },
  { palette: PALETTES.hardpan, t: 0.00, thickness: 0.035 }, // cream marl stringer
  { palette: PALETTES.redsand, t: 0.38, thickness: 0.15 },
  { palette: PALETTES.dustgrass, t: 0.10, thickness: 0.045 }, // sage-green shale
  { palette: PALETTES.scarp, t: 0.52, thickness: 0.16 },
  { palette: PALETTES.oxide, t: 0.34, thickness: 0.13 },
  { palette: PALETTES.scarp, t: 0.22, thickness: 0.12 },
]);

/** Cumulative bed boundaries, computed once. */
const CLIFF_BED_EDGES = (() => {
  const edges = [];
  let sum = 0;
  for (const bed of CLIFF_BEDS) {
    sum += bed.thickness;
    edges.push(sum);
  }
  return Object.freeze(edges);
})();

/** The two through-going joint-set directions on the caprock. Fixed. */
const CAP_JOINT_ANGLE_A = 0.34;
const CAP_JOINT_ANGLE_B = -1.19;

/**
 * A flat-topped, cliff-walled, stratified mesa standing on the ground.
 * Painted back-to-front:
 *
 *  1. the wide soft cast shadow, bled down-and-right on the bare ground;
 *  2. the talus / scree fan spilling from the wall's foot, wider to the
 *     lower-right, grading scarp -> redsand -> hardpan in colour AND alpha
 *     so it blends optically with whatever ground tile ends up underneath;
 *  3. the cliff wall - nine hard-edged sedimentary beds running the FULL
 *     wall height, darkening toward the foot, with a near-black overhang
 *     line under the caprock and sparse vertical erosion flutes;
 *  4. a second wider, softer ambient shadow wash, so the down-right bias
 *     still reads past the talus's own (right-biased) reach;
 *  5. the FLAT cap, painted last so its silhouette cleanly caps everything
 *     beneath: a jointed block lattice at one near-constant tone, a bright
 *     hard caprock lip on the sun-facing contour, a hard dark step on the
 *     shaded contour, and a thin dark outline just outside the northern
 *     contour standing in for the far rim we cannot see.
 *
 * All three size tiers share this one painter, parameterised only by
 * `spec.width`/`spec.height`, so the family reads as one kind at every size.
 */
function paintLandform(surface, ox, oy, spec, variant) {
  const { width: W, height: H } = spec;
  const seed = 80_000 + variant * 3011;

  // Proportions. The wall is now nearly as tall as the cap plan is deep -
  // pass 1 had the cap 3x the wall, which is what made the strata a hem.
  // The plan's anisotropy is deliberately kept below ~1:0.45: squash it
  // harder and every authored CORNER flattens into an arc no matter how
  // angular the polygon is in normalised space (measured - the first
  // 1:0.40 attempt read as an ellipse with one notch).
  const capCenterX = W * 0.44;
  const capCenterY = H * 0.245;
  const capRadiusX = W * 0.34;
  const capRadiusY = H * 0.205;
  const polygon = landformPolygon(capCenterX, capCenterY, capRadiusX, capRadiusY, variant);
  const roughAmplitude = Math.max(1.4, Math.min(3.2, W * 0.006));

  // --- pass 1: probe the cap band once and cache it. Signed distance
  // (negative OUTSIDE, positive INSIDE) plus the unit outward normal.
  const bandTop = Math.max(0, Math.floor(capCenterY - capRadiusY - roughAmplitude - 3));
  const bandBottom = Math.min(H - 1, Math.ceil(capCenterY + capRadiusY + roughAmplitude + 3));
  const bandRows = bandBottom - bandTop + 1;
  const signedGrid = new Float32Array(bandRows * W);
  const normalXGrid = new Float32Array(bandRows * W);
  const normalYGrid = new Float32Array(bandRows * W);
  const columnTop = new Array(W).fill(null);
  const columnBottom = new Array(W).fill(null);
  for (let y = bandTop; y <= bandBottom; y += 1) {
    const row = (y - bandTop) * W;
    for (let x = 0; x < W; x += 1) {
      const probe = polygonProbe(polygon, x + 0.5, y + 0.5);
      // A CHUNKY (2 px) low-frequency perturbation of the boundary distance:
      // enough to make the edge ragged like broken rock, far too small to
      // round a corner or soften a straight run.
      const rough = (fbm(chunky(x) * 0.115, chunky(y) * 0.115, seed + 13, 2) - 0.5)
        * 2 * roughAmplitude;
      const signed = (probe.inside ? probe.edge : -probe.edge) - rough;
      signedGrid[row + x] = signed;
      normalXGrid[row + x] = probe.nx;
      normalYGrid[row + x] = probe.ny;
      if (signed > 0) {
        if (columnTop[x] === null) columnTop[x] = y;
        columnBottom[x] = y;
      }
    }
  }

  // --- the wall's BUTTRESS FACETS. The single fix for the fault that
  // survived the first attempt at this pass: a wall whose only horizontal
  // variation is a smooth foot curve reads as the side of a CYLINDER, and a
  // cylinder with horizontal bands reads as a LAYER CAKE. A real cliff is
  // quarried by its vertical joint set into projecting buttresses and
  // recessed alcoves, so the wall is a row of near-vertical FACETS, each
  // with its own orientation (hence its own flat tone), its own foot depth,
  // and a hard dark joint line where it meets its neighbour. That is what
  // makes a banded wall read as rock rather than as icing.
  const facetWidth = Math.max(7, W * 0.042);
  function facetAt(x) {
    const drift = fbm(x * 0.011, 900, seed + 307, 2) * 0.7;
    return Math.floor(x / facetWidth + drift);
  }
  const facetToneCache = new Map();
  function facetTone(index) {
    let value = facetToneCache.get(index);
    if (value === undefined) {
      const roll = hash2(index, 5, seed + 311);
      // Skewed dark: most of a south-facing wall is in shadow, and only the
      // occasional facet turns far enough west to catch the key light.
      value = roll > 0.80 ? 1 : roll > 0.52 ? 0 : roll > 0.24 ? -1 : -2;
      facetToneCache.set(index, value);
    }
    return value;
  }

  /**
   * Wall height at column `x`. Stepped PER FACET rather than smoothly
   * interpolated, so the foot line is a scalloped row of buttresses; taller
   * to the lower-right, per the 3/4 cheat.
   */
  function wallHeightAt(x) {
    const rightBias = clamp01(((x - capCenterX) / (capRadiusX * 1.4)) * 0.5 + 0.5);
    const index = facetAt(x);
    const jitter = 0.90 + hash2(index, 41, seed + 71) * 0.24;
    return H * 0.30 * jitter * (0.92 + rightBias * 0.20);
  }

  const wallFoot = new Array(W).fill(null);
  let footMaxY = 0;
  for (let x = 0; x < W; x += 1) {
    if (columnBottom[x] === null) continue;
    const foot = columnBottom[x] + 1 + wallHeightAt(x);
    wallFoot[x] = foot;
    if (foot > footMaxY) footMaxY = foot;
  }

  // Dilate the foot line sideways, further to the right, so the talus fan
  // spills wider on the lower-right.
  const spillLeft = Math.max(2, Math.round(W * 0.035));
  const spillRight = Math.max(4, Math.round(W * 0.14));
  const dilatedFoot = new Array(W).fill(null);
  for (let x = 0; x < W; x += 1) {
    let maxFoot = null;
    for (let dx = -spillLeft; dx <= spillRight; dx += 1) {
      const xi = x + dx;
      if (xi < 0 || xi >= W) continue;
      const value = wallFoot[xi];
      if (value === null) continue;
      if (maxFoot === null || value > maxFoot) maxFoot = value;
    }
    dilatedFoot[x] = maxFoot;
  }

  // --- (1) cast shadow, on the bare ground, painted FIRST. Anchored to the
  // cap's own SYMMETRIC centre (never the measured silhouette bbox, which
  // the promontory skews left) so the down-RIGHT bias is guaranteed
  // regardless of silhouette asymmetry - key light is upper-left everywhere
  // in this region and in the shipped valley art, so the shadow falls
  // down-and-right, full stop.
  const shadowRadiusX = Math.max(26, capRadiusX * 1.12);
  const shadowRadiusY = Math.max(18, H * 0.145);
  const shadowCenterX = capCenterX + capRadiusX * 0.34;
  const shadowCenterY = footMaxY + shadowRadiusY * 0.26;
  paintLandformShadow(
    surface, ox, oy, W, H,
    shadowCenterX, shadowCenterY, shadowRadiusX, shadowRadiusY, 0.34,
  );

  // --- (2) talus / scree fan ------------------------------------------------
  // Colour is sampled on a CHUNKY 2 px lattice rather than per pixel: the fan
  // is a rubble field, not a dither, and 2x2 constant blocks cost a quarter
  // of the entropy for a read that is if anything coarser and more rock-like.
  const talusReach = Math.max(11, H * 0.105);
  for (let x = 0; x < W; x += 1) {
    const foot = dilatedFoot[x];
    if (foot === null) continue;
    const rightBias = clamp01(((x - capCenterX) / (capRadiusX * 1.4)) * 0.5 + 0.5);
    const reach = talusReach * (0.55 + rightBias * 0.85);
    // Never let a single column's fan START far above the general foot band:
    // a column just past the silhouette's edge can inherit a much deeper
    // `foot` from a neighbour during dilation, which without this floor
    // paints an isolated vertical sliver instead of a wide low spill.
    const yStart = Math.max(Math.floor(foot), Math.floor(footMaxY - H * 0.05));
    const yEnd = Math.min(H - 1, Math.ceil(foot + reach));
    for (let y = yStart; y <= yEnd; y += 1) {
      const t = clamp01((y - foot) / reach);
      const density = 1 - t;
      if (hash2(chunky(x), chunky(y), seed + 777) > density * 0.96 + 0.04) continue;
      // Scree is rock that fell off the wall above it, so it is dark and red,
      // not pale: a first pass graded it into `hardpan` too early and the fan
      // read as pale confetti scattered at the foot rather than as rubble.
      const paletteSet = t < 0.58 ? PALETTES.scarp : PALETTES.redsand;
      const colour = step(
        paletteSet,
        level(paletteSet, 0.14 + hash2(chunky(x), chunky(y), seed + 13) * 0.42),
      );
      const alpha = quantiseAlpha((1 - t) * 0.82);
      if (alpha === 0) continue;
      setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], alpha]);
    }
  }

  // --- (3) the cliff wall: NEAR-VERTICAL, and banded over its FULL height.
  for (let x = 0; x < W; x += 1) {
    if (columnBottom[x] === null) continue;
    const wallTop = columnBottom[x] + 1;
    const wallHeight = wallHeightAt(x);
    const wallEnd = Math.min(H, wallTop + wallHeight);
    const facetIndex = facetAt(x);
    const facetStep = facetTone(facetIndex);
    // A recessed facet is set BACK, so its beds sit a little lower on screen
    // and a projecting one a little higher. Small, but it is what stops the
    // beds reading as one continuous printed ribbon across the whole wall.
    const facetOffset = (hash2(facetIndex, 23, seed + 313) - 0.5) * 0.05;
    // The vertical joint line where this facet meets the one to its left.
    const jointColumn = facetAt(x - 1) !== facetIndex;
    // The bed boundaries wobble by a few percent of the wall height, on a
    // chunky column lattice - real beds are not ruler-straight, but they ARE
    // continuous, so the wobble is slow and shared between neighbours.
    const bedShift = facetOffset + (fbm(chunky(x) * 0.055, 0, seed + 601, 2) - 0.5) * 0.04;
    // Sparse vertical erosion flutes WITHIN a facet. Column-constant by
    // construction, which is both what a drainage flute looks like and what
    // the PNG `Up` filter collapses to almost nothing.
    const flute = hash2(Math.floor(x / 3), 7, seed + 211);
    const fluteStep = flute > 0.88 ? -1 : flute < 0.09 ? 1 : 0;
    for (let y = wallTop; y < wallEnd; y += 1) {
      const depth = clamp01((y - wallTop) / Math.max(1, wallHeight));
      const shifted = clamp01(depth + bedShift);
      let bedIndex = CLIFF_BEDS.length - 1;
      for (let i = 0; i < CLIFF_BED_EDGES.length; i += 1) {
        if (shifted < CLIFF_BED_EDGES[i]) { bedIndex = i; break; }
      }
      const bed = CLIFF_BEDS[bedIndex];
      let index = level(bed.palette, bed.t);
      index -= Math.round(depth * 1.3); // the foot sits in its own shadow
      index += facetStep;
      index += fluteStep;
      if (jointColumn) index -= 2;
      // The overhang line: the caprock projects, and the first rows under it
      // are in hard shadow. THIS is the edge that says "cliff top", and it is
      // deliberately near-black rather than merely dark.
      if (y - wallTop < 3) {
        put(surface, ox + x, oy + y, step(PALETTES.scarp, y - wallTop === 0 ? 0 : 1));
        continue;
      }
      put(surface, ox + x, oy + y, step(bed.palette, index));
    }
  }

  // --- (4) a second, wider, softer ambient shadow wash - painted AFTER the
  // talus so a clearly down-RIGHT dark ground band survives past the
  // rubble's own reach (the talus is itself right-biased and would otherwise
  // visually cannibalise the shadow's right side).
  paintLandformShadow(
    surface, ox, oy, W, H,
    shadowCenterX + capRadiusX * 0.10, shadowCenterY + shadowRadiusY * 0.15,
    shadowRadiusX * 1.20, shadowRadiusY * 1.15, 0.20,
  );

  // --- (5) the FLAT cap, painted last so it cleanly caps the layers beneath.
  const jointPitchA = Math.max(15, W * 0.095);
  const jointPitchB = Math.max(13, W * 0.068);
  const capBase = level(PALETTES.mesa, 0.62);
  const cosA = Math.cos(CAP_JOINT_ANGLE_A);
  const sinA = Math.sin(CAP_JOINT_ANGLE_A);
  const cosB = Math.cos(CAP_JOINT_ANGLE_B);
  const sinB = Math.sin(CAP_JOINT_ANGLE_B);
  for (let y = bandTop; y <= bandBottom; y += 1) {
    const row = (y - bandTop) * W;
    for (let x = 0; x < W; x += 1) {
      const signed = signedGrid[row + x];
      const normalX = normalXGrid[row + x];
      const normalY = normalYGrid[row + x];
      // Just OUTSIDE the northern contour: a thin dark outline standing in
      // for the far cliff rim, which the 3/4 cheat hides behind the cap. It
      // is what gives the bright caprock lip something to read against.
      if (signed <= 0) {
        if (signed > -2.2 && normalX + normalY < -0.15) {
          put(surface, ox + x, oy + y, step(PALETTES.scarp, 1));
        }
        continue;
      }
      const sunFacing = normalX + normalY < -0.22;
      // A LEVEL PLANE IS UNIFORMLY LIT. The only broad tonal movement on the
      // cap is a whisper of low-frequency bench tone - one palette step at
      // the very most - never a radial ramp, which is what domed pass 1.
      const bench = fbm(x * 0.012, y * 0.020, seed + 401, 2);
      let index = capBase + (bench > 0.72 ? 1 : bench < 0.28 ? -1 : 0);
      // Jointed block lattice: two through-going joint sets, each block one
      // flat tone. The joint lines BEND (a large wobble at a low frequency)
      // and a third of every joint's segments are simply absent, because a
      // clean evenly-spaced parallel lattice reads as TILED PAVING - which
      // is a built surface, and this whole family's failure mode is looking
      // built or looking organic rather than looking geological.
      const wobbleA = (fbm(x * 0.014, y * 0.014, seed + 31, 2) - 0.5) * 0.62;
      const wobbleB = (fbm(x * 0.014 + 11, y * 0.014 + 7, seed + 37, 2) - 0.5) * 0.62;
      const rawA = (x * cosA + y * sinA) / jointPitchA + wobbleA;
      const rawB = (x * cosB + y * sinB) / jointPitchB + wobbleB;
      const blockA = Math.floor(rawA);
      const blockB = Math.floor(rawB);
      const blockTone = hash2(blockA, blockB, seed + 97);
      index += blockTone > 0.86 ? 1 : blockTone < 0.18 ? -1 : 0;
      const onJointA = rawA - blockA < 1.35 / jointPitchA
        && hash2(blockA, blockB * 7 + 3, seed + 51) > 0.34;
      const onJointB = rawB - blockB < 1.35 / jointPitchB
        && hash2(blockA * 5 + 1, blockB, seed + 57) > 0.34;
      if (onJointA || onJointB) index -= 3;
      // THE RIM - the single cue that separates "cliff top seen from above"
      // from "boulder". Hard, 2-3 px, and it flips sign around the object:
      // sun catching the lip on the upper-left contour, the cap edge turning
      // into its own shadow on the lower-right.
      if (signed < 2.6) {
        index = sunFacing ? PALETTES.mesa.length - 1 : 1;
      } else if (signed < 5.5 && !sunFacing) {
        index -= 1;
      }
      put(surface, ox + x, oy + y, step(PALETTES.mesa, index));
    }
  }
}

/** Scenery sheet width. Frames are shelf-packed in spec order. */
const SCENERY_COLUMNS = 528;
// 1,464 rows is the packer's exact `usedHeight` once the landform tiers carry their
// authored plan variants (mesa 1, butte 3, outcrop 4). Trimmed to the byte: the tail
// beyond the last shelf is transparent, so it costs almost nothing compressed, but it
// costs width*height*4 of decoded RGBA at runtime for as long as the sheet is resident.
const SCENERY_ROWS = 1464;

function buildSceneryAtlas() {
  const surface = createSurface(SCENERY_COLUMNS, SCENERY_ROWS);
  const records = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (const spec of SCENERY_SPECS) {
    for (let variant = 0; variant < spec.variants; variant += 1) {
      if (cursorX + spec.width > SCENERY_COLUMNS) {
        cursorX = 0;
        cursorY += shelfHeight;
        shelfHeight = 0;
      }
      const ox = cursorX;
      const oy = cursorY;
      const carriesOwnShadow = spec.id === "cracks" || spec.id === "saltrime"
        || spec.id === "pebbles" || spec.id === "plank" || spec.id === "dustdevil"
        || spec.id === "bones" || spec.id === "mesa" || spec.id === "butte"
        || spec.id === "outcrop";
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = spec.pivot;
        paintContactShadow(
          surface, ox, oy, pivotX, pivotY + 2,
          Math.max(5, spec.width * 0.30),
          Math.max(3, spec.height * 0.075),
          0.44,
        );
      }
      switch (spec.id) {
        case "thornbush":
          paintThornbush(surface, ox, oy, spec, variant);
          break;
        case "deadwood":
          paintDeadwood(surface, ox, oy, spec, variant);
          break;
        case "mesquite":
          paintMesquite(surface, ox, oy, spec, variant);
          break;
        case "boulder":
          paintBoulder(surface, ox, oy, spec, variant);
          break;
        case "hoodoo":
          paintHoodoo(surface, ox, oy, spec, variant);
          break;
        case "saltbush":
          paintSaltbush(surface, ox, oy, spec, variant);
          break;
        case "bunchgrass":
          paintBunchgrass(surface, ox, oy, spec, variant);
          break;
        case "cracks":
          paintCracks(surface, ox, oy, spec, variant);
          break;
        case "bones":
          paintBones(surface, ox, oy, spec, variant);
          break;
        case "saltrime":
          paintSaltrime(surface, ox, oy, spec, variant);
          break;
        case "pebbles":
          paintPebbles(surface, ox, oy, spec, variant);
          break;
        case "dustdevil":
          paintDustdevil(surface, ox, oy, spec, variant);
          break;
        case "plank":
          paintPlank(surface, ox, oy, spec, variant);
          break;
        case "mesa":
        case "butte":
        case "outcrop":
          paintLandform(surface, ox, oy, spec, variant);
          break;
        default:
          throw new Error(`unhandled scenery ${spec.id}`);
      }
      records.push({
        id: `s.${spec.id}.${variant}`,
        image: "scenery",
        rect: { x: ox, y: oy, width: spec.width, height: spec.height },
        pivot: { x: spec.pivot[0], y: spec.pivot[1] },
      });
      cursorX += spec.width;
      shelfHeight = Math.max(shelfHeight, spec.height);
    }
  }
  const usedHeight = cursorY + shelfHeight;
  if (usedHeight > surface.height) {
    throw new Error(`scenery atlas overflow: needs ${usedHeight}px`);
  }
  return { surface, records, usedHeight };
}

// ---------------------------------------------------------------------------
// output (verbatim from the Warm Springs / Nirvana pilots)
// ---------------------------------------------------------------------------

/**
 * Encode a surface as an 8-bit INDEXED PNG, losslessly. Not quantisation: the
 * palette is not derived, it is DISCOVERED, because every painter above
 * chose a fixed palette entry, so the sheet already contains fewer than 256
 * distinct RGBA tuples and every pixel maps to it with zero error.
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

/** Write a sheet with the SMALLER encoder, and prove it decodes back exactly. */
async function writeSurface(surface, file) {
  const raw = { raw: { width: surface.width, height: surface.height, channels: 4 } };
  const rgba = await sharp(Buffer.from(surface.data), raw)
    .png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  const indexed = encodeIndexedPng(surface);
  const png = indexed.png.length < rgba.length ? indexed.png : rgba;
  const encoding = indexed.png.length < rgba.length ? "indexed8" : "rgba8";
  const back = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let index = 0; index < surface.data.length; index += 4) {
    if (surface.data[index + 3] === 0) {
      if (back[index + 3] !== 0) throw new Error(`${file}: alpha lost at ${index}`);
      continue;
    }
    for (let channel = 0; channel < 4; channel += 1) {
      if (surface.data[index + channel] !== back[index + channel]) {
        throw new Error(`${file}: encoder is not lossless at byte ${index + channel}`);
      }
    }
  }
  await writeFile(file, png);
  return {
    bytes: png.length,
    encoding,
    rgbaBytes: rgba.length,
    indexedBytes: indexed.png.length,
    sha256: createHash("sha256").update(png).digest("hex"),
  };
}

/** Count the distinct RGBA tuples on a sheet - the palette discipline's proof. */
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

export async function authorNirvanaEastPilotArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const terrain = buildTerrainAtlas();
  const scenery = buildSceneryAtlas();
  const terrainInfo = await writeSurface(terrain.surface, path.join(outputRoot, "terrain.png"));
  const sceneryInfo = await writeSurface(scenery.surface, path.join(outputRoot, "scenery.png"));
  const atlas = {
    schema: 2,
    tileSize: TILE,
    region: "nirvana-east",
    materials: MATERIALS,
    fieldMaterials: FIELD_MATERIALS,
    blockingMaterials: BLOCKING_MATERIALS,
    shoreMaterials: SHORE_MATERIALS,
    waterMaterials: WATER_MATERIALS,
    groundFamily: GROUND_FAMILY,
    cliffFamily: CLIFF_FAMILY,
    cornerBits: { nw: 1, ne: 2, se: 4, sw: 8 },
    edgeVariants: EDGE_VARIANTS_BY_MATERIAL,
    baseVariants: BASE_VARIANTS,
    shoreVariants: SHORE_VARIANTS,
    images: {
      terrain: {
        file: "terrain.png",
        width: terrain.surface.width,
        height: terrain.surface.height,
        colours: distinctColours(terrain.surface),
        ...terrainInfo,
      },
      scenery: {
        file: "scenery.png",
        width: scenery.surface.width,
        height: scenery.surface.height,
        colours: distinctColours(scenery.surface),
        ...sceneryInfo,
      },
    },
    terrainGrid: {
      image: "terrain",
      columns: TERRAIN_COLUMNS,
      cell: TILE,
      ids: terrain.records.map((record) => record.id),
    },
    sceneryFrames: scenery.records.map((record) => [
      record.id,
      record.rect.x, record.rect.y, record.rect.width, record.rect.height,
      record.pivot.x, record.pivot.y,
    ]),
  };
  await writeFile(path.join(outputRoot, "atlas.json"), `${JSON.stringify(atlas)}\n`, "utf8");
  return { ...atlas, frames: [...terrain.records, ...scenery.records] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorNirvanaEastPilotArt()
    .then(async (atlas) => {
      const { stat } = await import("node:fs/promises");
      const json = await stat(path.join(DEFAULT_OUTPUT_ROOT, "atlas.json"));
      const art = atlas.images.terrain.bytes + atlas.images.scenery.bytes;
      const total = art + json.size;
      const terrainFrames = atlas.terrainGrid.ids.length;
      const sceneryFrames = atlas.sceneryFrames.length;
      process.stdout.write(
        `authored ${atlas.frames.length} Nirvana East pilot frames`
        + ` (${terrainFrames} terrain + ${sceneryFrames} scenery)\n`
        + `  terrain ${atlas.images.terrain.width}x${atlas.images.terrain.height} `
        + `${atlas.images.terrain.bytes} B, ${atlas.images.terrain.colours} colours, `
        + `${atlas.images.terrain.encoding}\n`
        + `  scenery ${atlas.images.scenery.width}x${atlas.images.scenery.height} `
        + `${atlas.images.scenery.bytes} B, ${atlas.images.scenery.colours} colours, `
        + `${atlas.images.scenery.encoding}\n`
        + `  atlas.json ${json.size} B\n`
        + `  art total ${art} B; +metadata = ${total} B\n`
        + `  target 145000 -> ${(total / 145_000 * 100).toFixed(1)}% used\n`
        + `  region ceiling 196608 -> ${(total / 196_608 * 100).toFixed(1)}% used\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
