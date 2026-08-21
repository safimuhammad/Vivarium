/**
 * Authors the Nirvana river-valley PILOT tile vocabulary.
 *
 * The pilot owns its assets end to end. Production atlases under
 * `src/assets/renderer2d/**` are never read or written by this author, and the
 * locked `nirvana-v2` generation is untouched.
 *
 * What it emits (into `src/qa/nirvanaValleyPilot/assets/`):
 *   terrain.png  - 32px material base fills, a corner-mask transition set, and
 *                  a shoreline (wet-line) set per bank material, so materials
 *                  interlock instead of butting at hard tile borders and the
 *                  water meets the bank the way the reference plate does.
 *   scenery.png  - willows, trees in size tiers, scarp faces with corners,
 *                  flower-drift masses, reed clumps standing in water, boulders,
 *                  and the bridge kit (timber, stone arch, ramps, posts, wear).
 *   atlas.json   - frame table in the same schema the production Nirvana atlas
 *                  uses (schema/tileSize/images/frames[{id,image,rect,pivot}]).
 *
 * ---------------------------------------------------------------------------
 * TWO disciplines govern this file. Both exist for measured reasons.
 * ---------------------------------------------------------------------------
 *
 * 1. TRANSITIONS ARE CORNER-BASED (Wang) WITH A PRIORITY STACK.
 *    Every tile samples the material field at its four CORNERS; the lowest
 *    priority corner material fills the tile, and each higher material is
 *    overlaid with an alpha-cut edge frame keyed by which corners it owns.
 *    Because the alpha field is a bilinear interpolation of the shared corner
 *    samples, and the organic perturbation is windowed to zero on the tile
 *    border, the material boundary is CONTINUOUS across tile seams - which is
 *    precisely what stops the eye from reading the 32px grid.
 *
 * 2. EVERY PIXEL IS A FIXED PALETTE ENTRY. NO RAMP INTERPOLATION ANYWHERE.
 *    The first pass of this pilot interpolated continuous ramps, so the PNG was
 *    effectively a photograph: 473 KB against production's 4.3 KB, and palette
 *    quantisation afterwards was measured to shift pixels by a mean of 42. The
 *    fix is authoring discipline, not compression: each material owns a fixed
 *    list of colours and every painter chooses an INDEX into it. Lighting,
 *    shading and contact shadow are index arithmetic (step up, step down), not
 *    blending. Alpha is quantised to four levels for the same reason.
 *    The whole terrain sheet therefore contains a few dozen distinct colours,
 *    which both compresses properly and reads MORE like the reference plate's
 *    controlled palette, not less.
 *
 * Palettes are sampled from `docs/frontend/mockups/regions/nirvana-c-river-valley.png`
 * by colour-family k-means, so the world is the reference's warm yellow-olive
 * with sage-teal water rather than a generic lime-and-slate.
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
  "../src/qa/nirvanaValleyPilot/assets",
);

export const TILE = 32;

/**
 * Material stack, lowest priority first. A tile is filled with the lowest
 * priority material among its four corners; everything above is an edge overlay.
 *
 * `shadegrass` / `grass` / `sungrass` are three TONAL TIERS of one sward, not
 * three species: they share a single twelve-tone ramp through overlapping
 * windows, so the meadow carries the reference's broad lit and shadowed
 * passages while remaining one continuous surface.
 */
export const MATERIALS = Object.freeze([
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

export const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

/** Materials a body cannot stand on or route through. */
export const BLOCKING_MATERIALS = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "thicket",
  "reed",
  "rock",
]);

/** Bank materials that get a dedicated shoreline / wet-line overlay set. */
export const SHORE_MATERIALS = Object.freeze(["gravel", "silt", "reed"]);

/** Water-family materials: the shoreline set is emitted where these are the base. */
export const WATER_MATERIALS = Object.freeze(["deepwater", "water", "shallow"]);

/**
 * Eight fills per material. Four was not enough: with a large open sward the
 * eye locks onto the repeat and the 32px lattice reappears - the exact failure
 * this pilot exists to remove.
 */
const BASE_VARIANTS = 8;

/**
 * Transition variants per material, and the reason they differ.
 *
 * Two variants per mask exist so a LONG boundary does not repeat one 32px
 * wobble - the 32px rhythm this pilot exists to remove. That only matters where
 * the boundary is visible: a waterline, a shingle edge, a thicket margin, a
 * scarp foot. Between two TONAL TIERS of the same sward the boundary is a
 * single palette step, and its shape cannot be seen at 1:1 at all, so one
 * variant is honestly enough - and the four grass-family materials are the most
 * common transitions on the plate, so this is where the bytes actually are.
 * Measured saving: 56 frames, ~14 KB, no visible difference.
 */
const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  shadegrass: 1,
  grass: 1,
  sungrass: 1,
  meadow: 1,
});
const DEFAULT_EDGE_VARIANTS = 2;
const SHORE_VARIANTS = 2;

/** Transition variants authored for one material. */
export function edgeVariantCount(material) {
  return EDGE_VARIANTS_BY_MATERIAL[material] ?? DEFAULT_EDGE_VARIANTS;
}
/** Masks 1..14; mask 15 is full coverage and reuses the base fill. */
const EDGE_MASKS = Object.freeze(
  Array.from({ length: 14 }, (_unused, index) => index + 1),
);

// ---------------------------------------------------------------------------
// deterministic noise
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

// ---------------------------------------------------------------------------
// palette discipline
// ---------------------------------------------------------------------------

/**
 * Choose a palette entry by NORMALISED position. This is the only way a colour
 * ever enters the sheet: `t` selects an entry, it never blends between two.
 */
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

/** A contiguous window onto a shared family ramp - the tonal-tier mechanism. */
function windowOf(family, from, to) {
  return Object.freeze(family.slice(from, to + 1));
}

/**
 * Snap a noise coordinate to a 2px cluster.
 *
 * Single-pixel noise is white noise: it is what made the first pass read as
 * speckle rather than surface (the pilot report's own complaint against its
 * sward) AND it is incompressible, so it was paying twice. Sampling the fine
 * detail on 2x2 blocks gives the texture a deliberate pixel-art grain, halves
 * the entropy, and moves the surface toward the reference's smooth painterly
 * value modelling instead of away from it.
 */
function chunky(value) {
  return Math.floor(value * 0.5) * 2;
}

/** Four alpha levels. A continuous alpha channel is a photograph too. */
const ALPHA_LEVELS = Object.freeze([0, 88, 172, 255]);

function quantiseAlpha(alpha) {
  return ALPHA_LEVELS[Math.round(clamp01(alpha) * (ALPHA_LEVELS.length - 1))];
}

// ---------------------------------------------------------------------------
// palettes - k-means sampled from the approved reference plate
// ---------------------------------------------------------------------------

/**
 * ONE sward ramp, twelve tones, deep cool shade to warm sunlit ochre. The
 * reference's brightest grass is (223,208,151) - nearly ochre - and its
 * deepest is (55,60,30); the pilot's first pass topped out 40 values short of
 * that, which is why its meadow read as an even green mat.
 */
const SWARD = Object.freeze([
  [46, 52, 28], [58, 64, 32], [70, 76, 36], [84, 90, 40],
  [98, 104, 45], [113, 118, 51], [129, 133, 58], [147, 148, 66],
  [166, 161, 78], [186, 175, 95], [205, 191, 118], [222, 208, 148],
]);

/** ONE water ramp, nine tones of the reference's sage-teal - not slate blue. */
const RIVER = Object.freeze([
  [46, 66, 60], [56, 79, 71], [66, 91, 80], [78, 102, 89], [92, 115, 100],
  [110, 133, 120], [134, 156, 144], [166, 186, 178], [206, 222, 216],
]);

const PALETTES = Object.freeze({
  // Water depth is a WINDOW onto one family, so the river never bands.
  deepwater: windowOf(RIVER, 0, 4),
  water: windowOf(RIVER, 1, 6),
  shallow: windowOf(RIVER, 3, 8),
  // Pale grey-tan shingle. Warm tan read as a towpath; the reference's pebbles
  // are near-neutral (157,157,140) rising to (238,240,228).
  gravel: Object.freeze([
    [86, 84, 66], [110, 107, 84], [136, 132, 106],
    [164, 159, 128], [192, 187, 154], [220, 216, 188],
  ]),
  silt: Object.freeze([
    [54, 54, 40], [72, 72, 54], [92, 90, 68],
    [112, 109, 84], [134, 130, 102], [158, 152, 122],
  ]),
  // The three tonal tiers of the sward, plus the flower-bearing meadow.
  // The windows sit one step higher than the first pass. Measured against the
  // plate: the reference's grass runs (55,60,30) to (223,208,151) and reads
  // WARM; a window starting at index 0 put the whole sward a value below it and
  // the plate read cool and heavy beside the reference.
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
  // Stony GROUND: pale warm grey slabs. The reference's terrace tops are pale
  // and neutral (its near-neutral family runs (157,157,140) to (238,240,228));
  // the warm ochre belongs on the vertical FACES, which is what SCARP_ROCK is
  // for. Painting the flat rock ochre and columnar - the first pass - made the
  // terrace read as stacked bamboo.
  rock: Object.freeze([
    [62, 60, 50], [88, 84, 70], [114, 109, 90], [140, 134, 110],
    [168, 160, 132], [196, 187, 154], [222, 212, 178],
  ]),
});

/** Warm ochre columnar rock, straight off the reference's terrace FACES. */
const SCARP_ROCK = Object.freeze([
  [42, 40, 28], [64, 60, 38], [88, 80, 44], [114, 103, 52],
  [142, 127, 64], [174, 155, 86], [206, 186, 118],
]);

/** Accents. Each is a single fixed colour, never a blend target. */
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

/** Willow foliage: its own six tones so the fronds can run bright at the tips. */
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
    case "shadegrass":
    case "grass":
    case "sungrass":
    case "meadow": {
      // Deliberately high-frequency only. A base fill must carry NO feature
      // larger than a few pixels, or the tile becomes a recognisable motif and
      // the grid prints through. All large-scale variation is carried by the
      // material field (the three tonal tiers) and by the props.
      const clump = fbm(wx * 0.20, wy * 0.20, seed + 11, 3);
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 23, 2);
      let index = level(palette, 0.22 + clump * 0.52 + (grain - 0.5) * 0.36);
      // Blade strokes: sparse 1px vertical catchlights over a 2px-clustered
      // understorey, as index steps rather than blends. These are STRUCTURE -
      // drawn marks - which is why they survive where speckle was removed.
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
      // Scrub read from above: overlapping bush crowns with lit caps and dark
      // gaps, so the patch is a mass of plants and not a flat stain.
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
      // Water is a SMOOTH surface: broad soft value shapes with a few drawn
      // current lines. Dense per-pixel noise made the first passes read as
      // television static rather than a river.
      const swell = fbm(wx * 0.085, wy * 0.085, seed + 5, 3);
      const drift = fbm(wx * 0.17 + swell * 1.8, wy * 0.13 - swell * 1.4, seed + 17, 2);
      let index = level(palette, (deep ? 0.18 : 0.34) + swell * 0.36 + (drift - 0.5) * 0.26);
      // current lines: thin bright filaments strung along the drift field
      const thread = Math.abs(drift - 0.54);
      if (thread < 0.024) index += deep ? 1 : 2;
      // The bed reads through the shallower film - this is what makes the
      // river translucent rather than an opaque slab.
      if (!deep) {
        const bed = fbm(wx * 0.24, wy * 0.24, seed + 43, 2);
        if (bed > 0.70) return tone(PALETTES.gravel, 0.10 + (bed - 0.70) * 0.9);
      }
      // Sparkle: on 2px clusters, RARE, and the pale end of the river's own
      // ramp rather than near-white. The first pass put a bright single-pixel
      // glint on 1.6% of the water and it read as snow on the river - as well as
      // being pure incompressible noise.
      // No white specks on the open river at all: foam belongs where the water
      // breaks, which is the `shallow` riffle, not the middle of a pool.
      if (hash2(chunky(wx), chunky(wy), seed + 33) > 0.982) index += 1;
      return step(palette, index);
    }
    case "shallow": {
      // A riffle: the same smooth surface with the gravel bed reading through
      // it as soft rounded shapes rather than pixel confetti, and broken white
      // water where the water runs over the shallowest stones.
      const surface = fbm(wx * 0.11, wy * 0.11, seed + 7, 3);
      const bed = fbm(wx * 0.26, wy * 0.26, seed + 43, 2);
      const index = level(palette, 0.30 + surface * 0.38 + (bed - 0.5) * 0.28);
      if (bed > 0.60) return tone(PALETTES.gravel, 0.22 + (bed - 0.60) * 1.1);
      // broken white water only on the crest of a riffle, never as a band
      const crest = Math.abs(surface - 0.70);
      if (crest < 0.014) return ACCENT.foam;
      if (crest < 0.032) return step(palette, palette.length - 1);
      return step(palette, index);
    }
    case "gravel": {
      // Shingle you can count: individual jittered pebbles, each with a lit cap
      // and a shaded underside, over a damp matrix. A noise wash alone reads as
      // a dirt road, which is what the bank looked like before.
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
          // light from the upper left across the pebble's own curvature
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
      const wet = fbm(wx * 0.14, wy * 0.14, seed + 61, 3);
      let index = level(palette, 0.08 + wet * 0.36);
      // standing stubble: 1px vertical strokes at varied heights
      const column = Math.floor(wx);
      const stalk = hash2(column, Math.floor(wy / 9), seed + 73);
      if (stalk > 0.52) {
        const phase = ((wy % 9) + 9) % 9;
        const height = 3 + Math.floor(stalk * 6);
        if (phase < height) index = level(palette, 0.56 + (height - phase) * 0.06);
      }
      if (hash2(chunky(wx), chunky(wy), seed + 79) > 0.966) return tone(RIVER, 0.55);
      return step(palette, index);
    }
    case "rock": {
      // Rock PAVEMENT seen from above: irregular angular slabs with thin dark
      // joints, each slab taking its own tone with a lit upper-left edge and a
      // shaded lower-right one, and moss creeping into the joints. Columns and
      // bedding belong on a vertical face - drawing them on flat ground made the
      // terrace read as a woven basket, which is exactly the note the pilot's
      // rock has attracted three times now.
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
          // Chebyshev-ish distance gives ANGULAR slabs rather than round pebbles.
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
      // the slab's own facet: light from the upper left across its surface
      index += offsetY < -0.22 || offsetX < -0.30 ? 1 : offsetY > 0.24 ? -1 : 0;
      const joint = second - nearest;
      if (joint < 1.0) index -= 3;
      else if (joint < 1.9) index -= 1;
      // a cracked slab, and grit collecting in the low corners
      if (hash2(chunky(wx), chunky(wy), seed + 101) > 0.93) index -= 1;
      // Turf and moss colonising the joints and the low corners, so stony ground
      // reads as ground rather than as paving.
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

// ---------------------------------------------------------------------------
// surface helpers
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

/**
 * Lay a quantised-alpha pixel of ONE fixed colour. Used for shadows and cast
 * relief only: colour never blends, so the sheet's colour count stays bounded
 * while the composite still reads soft.
 */
function veil(surface, x, y, rgb, alpha) {
  const quantised = quantiseAlpha(alpha);
  if (quantised === 0) return;
  if (x < 0 || y < 0 || x >= surface.width || y >= surface.height) return;
  const index = (y * surface.width + x) * 4;
  if (surface.data[index + 3] >= quantised && surface.data[index + 3] > 0) {
    // something already occupies this pixel more strongly; leave it alone
    if (surface.data[index + 3] === 255) return;
  }
  surface.data[index] = rgb[0];
  surface.data[index + 1] = rgb[1];
  surface.data[index + 2] = rgb[2];
  surface.data[index + 3] = Math.max(surface.data[index + 3], quantised);
}

/**
 * Soft elliptical contact shadow at a sprite's foot, cast down-right to match
 * the upper-left key light used by every canopy. Without this the props float
 * and the whole plate reads flat, which was the clearest gap against the
 * reference at 1:1.
 */
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

/**
 * The seed for one transition. The shoreline set MUST reuse it, or its wet line
 * would follow a different contour than the bank edge it belongs to.
 */
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
        // Scattered outliers just beyond the boundary keep the seam from
        // reading as a drawn line - a few detached specks of the upper
        // material land on the lower one.
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
      // Contact shadow just inside the boundary: the upper material sits ON the
      // lower one rather than beside it. One or two palette steps down, never
      // a blend.
      const rim = 1 - smoothstep(0.60, 0.80, field);
      const drop = rim > 0.62 ? (grassy ? 2 : 1) : rim > 0.24 ? 1 : 0;
      const shaded = drop === 0
        ? colour
        : step(palette, Math.max(0, palette.indexOf(colour) < 0 ? 0 : palette.indexOf(colour) - drop));
      setPixel(surface, originX + x, originY + y, [shaded[0], shaded[1], shaded[2], alpha]);
    }
  }
}

/**
 * One shoreline / wet-line frame.
 *
 * The reference plate has a distinct darker wet band where water meets bank and
 * a pale broken line of foam on the water side of it; the pilot's first pass
 * only had the transition's contact shadow, so the two materials met without a
 * waterline. This frame draws that band and nothing else - it is laid over the
 * bank's own transition frame, sharing its seed so it follows the SAME contour.
 */
function paintShoreTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const [offsetX, offsetY] = edgeOffsets(material, mask, variant);
  const palette = PALETTES[material];
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      // Bank side of the contour: a damp, darker lip three to five pixels deep,
      // darkest right at the water. This - not the foam - is what the reference
      // actually reads as a waterline, and it is where the weight belongs.
      if (field >= 0.505 && field < 0.70) {
        const depth = (field - 0.505) / 0.195;
        // Mottled, not a uniform two-tone band: a flat band of the palette's
        // darkest tones read as a kerb laid along the water.
        const damp = fbm((x + originX) * 0.36, (y + originY) * 0.36, seed + 197, 2);
        const level0 = depth < 0.34 ? 0 : depth < 0.72 ? 1 : 2;
        const wet = step(palette, level0 + (damp > 0.62 ? 1 : 0));
        setPixel(surface, originX + x, originY + y, [
          wet[0], wet[1], wet[2], depth < 0.80 ? 255 : ALPHA_LEVELS[2],
        ]);
        continue;
      }
      // Water side: a BROKEN wash of the pale end of the river's own ramp, with
      // only occasional foam. A continuous bright line here read as a cartoon
      // outline scalloped around every reach of the river - the single loudest
      // fault of the first pass at 1:1.
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

export function terrainFrameLayout() {
  const frames = [];
  for (const material of MATERIALS) {
    for (let variant = 0; variant < BASE_VARIANTS; variant += 1) {
      frames.push({ id: `t.${material}.${variant}`, kind: "base", material, variant });
    }
  }
  for (const material of MATERIALS) {
    if (MATERIAL_PRIORITY[material] === 0) continue; // deep water is always the base
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
// scenery
// ---------------------------------------------------------------------------

const SCENERY_SPECS = Object.freeze([
  // Willows: the reference's signature. Six individuals in three size tiers.
  { id: "willow", width: 112, height: 118, variants: 6, pivot: [56, 110] },
  { id: "birch", width: 72, height: 106, variants: 6, pivot: [36, 100] },
  { id: "broadleaf", width: 88, height: 94, variants: 8, pivot: [44, 88] },
  { id: "conifer", width: 60, height: 96, variants: 5, pivot: [30, 92] },
  { id: "shrub", width: 48, height: 48, variants: 6, pivot: [24, 45] },
  { id: "reedclump", width: 44, height: 84, variants: 6, pivot: [22, 80] },
  // Reeds standing IN the water at the margin, with a reflection at the foot.
  { id: "reedwater", width: 44, height: 84, variants: 4, pivot: [22, 80] },
  { id: "boulder", width: 44, height: 36, variants: 5, pivot: [22, 33] },
  { id: "outcrop", width: 40, height: 30, variants: 4, pivot: [20, 27] },
  { id: "cobble", width: 20, height: 14, variants: 4, pivot: [10, 12] },
  // Flower MASSES, not scattered pixels.
  { id: "flowerdrift", width: 56, height: 40, variants: 6, pivot: [28, 37] },
  { id: "tuft", width: 24, height: 18, variants: 4, pivot: [12, 16] },
  { id: "driftwood", width: 48, height: 20, variants: 2, pivot: [24, 17] },
  // The scarp: a running face plus outside and inside corners, so a terrace
  // can turn instead of running in one direction until it stops.
  { id: "scarpface", width: 88, height: 54, variants: 4, pivot: [44, 48] },
  { id: "scarpcornerout", width: 48, height: 46, variants: 2, pivot: [24, 41] },
  { id: "scarpcornerin", width: 48, height: 46, variants: 2, pivot: [24, 41] },
  { id: "steppingstone", width: 26, height: 16, variants: 3, pivot: [13, 13] },
  // Bridges. Tile-sized pieces anchored to the bottom of their own tile, so a
  // run of deck segments joins seamlessly across a span of any length.
  { id: "bridgedeckh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgedeckv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgepier", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  // Wear states: a replaced pale plank, a missing board with water showing
  // through, moss on the shaded side, a worn centre line.
  { id: "bridgewornh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgewornv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  // Diagonal spans - the largest remaining bridge gap.
  { id: "bridgedeckdne", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgedeckdnw", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  // Bridgehead ramps: the landing that sells the join at 1:1.
  { id: "bridgeramph", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgerampv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  // Handrail uprights, with the post shadow falling across the deck.
  { id: "bridgeposth", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgepostv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  // The stone causeway the world atlas also carries.
  { id: "bridgearchh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgearchv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "bridgearchpier", width: 32, height: 32, variants: 2, pivot: [16, 31] },
]);

/**
 * Bridge timber, read straight off the approved world atlas
 * (`docs/frontend/mockups/atlas-impl/01-world-four-islands.png`) so the plank
 * causeways at world zoom and the plank bridges in the valley are the same
 * object seen from two distances.
 *
 * Deliberately a FIXED five-colour palette with no ramp interpolation - the
 * discipline this whole sheet now follows.
 */
const BRIDGE_TIMBER = Object.freeze({
  edge: [88, 64, 42],
  seam: [116, 84, 52],
  body: [152, 112, 70],
  worn: [172, 132, 84],
  lit: [192, 147, 92],
  fresh: [214, 180, 130],
});

/** Abutment stone: the atlas's grey blocks, pulled into the valley's rock family. */
const BRIDGE_STONE = Object.freeze({
  outline: [48, 44, 36],
  shade: [78, 72, 58],
  body: [112, 104, 86],
  face: [138, 129, 106],
  lit: [174, 164, 136],
});

/** The colour a deck's shadow drags the water toward. */
const BRIDGE_SHADOW = Object.freeze([12, 20, 24]);

/**
 * One tile of bridge deck.
 *
 * The cross-section is the atlas causeway's, pixel for pixel: two dark boards
 * of rail, a bright board catching the upper-left key light, the plank field,
 * a darker board on the shaded side, two more of rail - and then the deck's
 * shadow, laid on the water inside the same tile, which is what makes the deck
 * read as ABOVE the river instead of painted onto it.
 *
 * `vertical` swaps the two axes, so the same cross-section serves an east-west
 * causeway (rails north and south, planks running across the travel direction)
 * and a north-south one (rails west and east). The plank rhythm is 4px and the
 * tile is 32px, so the boards line up across every seam of a span.
 *
 * `wear` adds the states an inhabited bridge acquires: one pale replaced plank,
 * one missing board with the river showing through, moss on the shaded rail,
 * and a trodden pale line down the centre.
 */
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
      // the board is gone: rails survive, the river shows through
      for (const across of [3, 4, 25, 26]) place(along, across, BRIDGE_TIMBER.edge);
      place(along, 5, BRIDGE_TIMBER.lit);
      place(along, 24, BRIDGE_TIMBER.seam);
      for (let step = 0; step < 5; step += 1) shade(along, 27 + step, [0.66, 0.54, 0.40, 0.26, 0.13][step]);
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
      // the rails throw a one-pixel shadow onto the boards beside them
      if (across === 6 || across === 23) colour = BRIDGE_TIMBER.edge;
      // the trodden centre line of a used bridge
      if (wear && !seam && plank !== replaced && across >= 13 && across <= 17) {
        colour = BRIDGE_TIMBER.worn;
      }
      place(along, across, colour);
    }
    // iron pegs holding the boards to the stringers
    if (peg) {
      place(along, 7, BRIDGE_TIMBER.edge);
      place(along, 22, BRIDGE_TIMBER.edge);
    }
    // moss creeping along the shaded rail
    if (wear && hash2(along, variant, seed + 3) > 0.45) {
      place(along, 25, ACCENT.moss);
      if (hash2(along, variant, seed + 5) > 0.6) place(along, 24, ACCENT.moss);
    }
    // the deck's own shadow on the water, cast down-right with the key light
    const falloff = [0.66, 0.54, 0.40, 0.26, 0.13];
    for (let step = 0; step < falloff.length; step += 1) shade(along, 27 + step, falloff[step]);
    // and a thin one on the lit side too, so the deck has a lip rather than
    // sitting flush with the surface
    shade(along, 2, 0.30);
    shade(along, 1, 0.14);
  }
}

/**
 * One tile of DIAGONAL deck.
 *
 * `rising` runs south-west to north-east; otherwise north-west to south-east.
 * The band is 24px across the tile's diagonal, so consecutive diagonal tiles
 * meet corner to corner with no gap and the rails read as one continuous line.
 * Boards run perpendicular to travel, exactly as on the axis-aligned pieces.
 */
function paintBridgeDeckDiagonal(surface, ox, oy, spec, variant, rising) {
  const seed = 31_000 + variant * 1327 + (rising ? 17 : 0);
  const size = spec.width;
  const half = 10;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // signed distance across the diagonal centre line, and position along it
      const across = rising ? (x + y - size + 1) / Math.SQRT2 : (x - y) / Math.SQRT2;
      const along = rising ? (x - y) / Math.SQRT2 : (x + y - size + 1) / Math.SQRT2;
      const distance = Math.abs(across);
      if (distance > half + 5) continue;
      if (distance > half) {
        // the shadow the deck throws onto the water, on the down-right side
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

/**
 * A bridgehead LANDING: the join where the deck meets the bank.
 *
 * Deliberately symmetric along the travel axis, because a bridge has two ends
 * and the blit has no mirror: the same frame serves the near and far bridgehead.
 * It carries the cut stringer ends at both edges, a bright nosing board where
 * the deck's level breaks, the handrail returning into a short post at each end,
 * and trodden silt spilling off the sides onto the bank. Before this the deck
 * simply stopped under the abutment block, which is the join the pilot report
 * named as missing at 1:1.
 */
function paintBridgeRamp(surface, ox, oy, spec, variant, vertical) {
  const seed = 33_000 + variant * 1439;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const size = spec.width;
  for (let along = 0; along < size; along += 1) {
    // Symmetric: 0 at both ends, 1 in the middle of the landing.
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
    // trodden silt spilling off the sides of the landing onto the bank
    const silt = tone(PALETTES.silt, 0.30 + hash2(along, variant, seed + 7) * 0.34);
    for (let bleed = 1; bleed <= 3; bleed += 1) {
      if (hash2(along, bleed, seed + 11) > 0.34 + bleed * 0.14) {
        place(along, Math.max(0, from - bleed), silt);
        place(along, Math.min(size - 1, to + bleed), silt);
      }
    }
    // the stringer's shadow under the shaded lip
    veil(surface, ox + (vertical ? Math.min(size - 1, to + 1) : along),
      oy + (vertical ? along : Math.min(size - 1, to + 1)), BRIDGE_SHADOW, 0.5);
  }
  // the handrail returning into its post at BOTH ends of the landing
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

/**
 * A handrail upright, laid over a deck tile.
 *
 * Two posts (one per rail), each with a lit left edge, plus the shadow each
 * throws across the planks. The rails on the deck frames are flat boards; these
 * are what give a bridge a silhouette above its own surface.
 */
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
    // the cap, and the shadow the post lays along the deck
    place(at, across - height, BRIDGE_TIMBER.fresh);
    place(at + 1, across - height, BRIDGE_TIMBER.worn);
    for (let cast = 1; cast <= 5; cast += 1) shade(at + 3 + cast, across + 1, 0.5 - cast * 0.08);
  }
}

/**
 * A stone-arch causeway tile: the grey variant the world atlas also carries.
 *
 * Two courses of parapet with staggered joints, a packed-stone road between
 * them, a lit cap on the upstream parapet, and the arch's shadow on the water.
 */
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
        // the road: packed stone, paler down the trodden middle
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

/**
 * A stone abutment: the block the deck lands on, set into the bank.
 *
 * Squat, outlined, lit from the upper left, with two or three block joints, a
 * soft contact shadow, and rubble spilling at its foot - the same grey blocks
 * that terminate every causeway on the world atlas. `springing` cuts the arch's
 * spring line into the face, for the stone variant.
 */
function paintBridgePier(surface, ox, oy, spec, variant, springing = false) {
  const { width } = spec;
  const seed = 29_000 + variant * 1229 + (springing ? 401 : 0);
  const left = 1;
  const right = 28;
  const top = 1;
  const bottom = 28;

  // contact shadow first, so the block is set into it rather than onto it
  paintContactShadow(surface, ox, oy, (left + right) / 2, bottom + 2, 13.5, 4.6, 0.58);

  // masonry: courses of individual stones with 1px joints, each stone taking
  // its own tone, so the block reads as built rather than as a grey slab
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
      // key light from the upper left, across the whole block
      if (y <= top + 2) colour = BRIDGE_STONE.lit;
      else if (x <= left + 1) colour = BRIDGE_STONE.face;
      else if (y >= bottom - 3 || x >= right - 2) colour = BRIDGE_STONE.shade;
      if (jointRow || jointColumn) colour = BRIDGE_STONE.shade;
      if (outline) colour = BRIDGE_STONE.outline;
      // the arch springing: a curved void cut into the lower face
      if (springing && !outline) {
        const dx = (x - (left + right) / 2) / 11;
        const dy = (bottom - y) / 15;
        if (dx * dx + dy * dy < 1 && y > top + 8) colour = BRIDGE_STONE.outline;
      }
      if (!outline && hash2(x, y, seed + 7) > 0.92) colour = BRIDGE_STONE.lit;
      put(surface, ox + x, oy + y, colour);
    }
  }

  // rubble spilling at the foot, the way the atlas piles stones around a
  // bridgehead - it stops the block reading as a dropped-in rectangle
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

/**
 * A WILLOW, hand-authored.
 *
 * The reference's willows are the plate's signature: a warm trunk splitting
 * into two or three leaders, a wide crown whose top catches the sun, and long
 * frond curtains that arc outward and hang, individually legible, with paler
 * tips. The pilot's first pass built them from procedural lobes plus strands
 * and they read as willows only at a glance.
 *
 * Six individuals in three size tiers, so a stand is never one sprite stamped
 * repeatedly. Everything is a WILLOW_LEAF or BARK palette index; no blending.
 */
function paintWillow(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 41_000 + variant * 1783;
  const tier = [0.76, 0.88, 1.0, 0.80, 0.94, 1.0][variant % 6];
  const centerX = width / 2 + (hash2(variant, 1, seed) - 0.5) * 8;
  const footY = height - 6;
  const crownY = footY - height * 0.58 * tier;
  const crownRX = width * 0.42 * tier;
  const crownRY = height * 0.26 * tier;

  // --- trunk and leaders -------------------------------------------------
  const leaders = 2 + (variant % 2);
  for (let leader = 0; leader < leaders; leader += 1) {
    const spreadAt = footY - height * 0.16 * tier;
    const tipX = centerX + (leader - (leaders - 1) / 2) * crownRX * 0.62;
    const tipY = crownY + crownRY * 0.5;
    for (let y = footY; y >= tipY; y -= 1) {
      const t = (footY - y) / Math.max(1, footY - tipY);
      // one bole to the split, then the leaders fan out
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

  // --- THE FROND CURTAIN, drawn as a MASS ---------------------------------
  // The reference's willow is not a canopy with hair: the hanging fronds are a
  // continuous body of foliage, striated vertically, with a ragged hem and paler
  // tips. Drawing them as separate 1px strands - the first pass - gave a
  // mushroom with a comb-over at 1:1. So the curtain is filled column by column
  // between the crown's underside and a hem contour, and the vertical structure
  // comes from striation INSIDE the mass.
  const hemBase = crownY + crownRY * 0.30;
  for (let x = Math.round(centerX - crownRX * 1.08); x <= centerX + crownRX * 1.08; x += 1) {
    const across = (x - centerX) / crownRX;
    if (Math.abs(across) > 1.08) continue;
    // Longest just outboard of the trunk, shortest at the silhouette's edges.
    const profile = Math.cos(across * 1.34) ** 0.8;
    const jitter = fbm(x * 0.42 + variant * 13, 0.5, seed + 7, 3) - 0.5;
    const hemTop = hemBase + Math.abs(across) * crownRY * 0.34;
    const hem = hemTop + (height * 0.36 * tier) * profile * (0.74 + jitter * 0.62);
    if (hem <= hemTop) continue;
    // Striation: each column of the curtain takes its own tone, and every third
    // or fourth column drops a step, which is what reads as hanging fronds.
    const strand = hash2(x, variant, seed + 11);
    const base = strand > 0.72 ? 4 : strand > 0.34 ? 3 : 2;
    const sway = Math.round((hash2(x, variant, seed + 13) - 0.5) * 1.6);
    for (let y = Math.round(hemTop); y < hem; y += 1) {
      const t = (y - hemTop) / Math.max(1, hem - hemTop);
      let index = base;
      if (t > 0.78) index += 1; // the tips catch the light
      if (hash2(x, Math.floor(y / 3), seed + 17) > 0.80) index -= 1;
      // the curtain thins into gaps at the very hem
      if (t > 0.90 && hash2(x, y, seed + 19) > 0.55) continue;
      put(surface, ox + x + Math.round(sway * t), oy + y, step(WILLOW_LEAF, index));
    }
  }

  // --- crown: a billowing dome, lit on top, dark underneath ---------------
  for (let y = Math.floor(crownY - crownRY * 1.3); y <= crownY + crownRY * 1.1; y += 1) {
    for (let x = Math.floor(centerX - crownRX * 1.15); x <= centerX + crownRX * 1.15; x += 1) {
      const dx = (x - centerX) / crownRX;
      const dy = (y - crownY) / crownRY;
      const lobe = fbm(x * 0.16 + variant * 7, y * 0.22, seed + 3, 3);
      // a dome that billows upward: rounder above, flatter below
      const radius = Math.hypot(dx, dy * (dy < 0 ? 0.94 : 1.6));
      if (radius > 0.80 + lobe * 0.34) continue;
      // key light upper-left: the cap is the brightest thing in the sprite
      const lit = 0.54 - dy * 0.80 - dx * 0.26 + (fbm(x * 0.4, y * 0.4, seed + 5, 2) - 0.5) * 0.62;
      put(surface, ox + x, oy + y, step(WILLOW_LEAF, level(WILLOW_LEAF, lit)));
    }
  }

  // --- deep shade where the crown meets the curtain ----------------------
  for (let y = Math.round(crownY + crownRY * 0.5); y < crownY + crownRY * 1.1; y += 1) {
    for (let x = Math.round(centerX - crownRX * 0.8); x < centerX + crownRX * 0.8; x += 1) {
      if (hash2(x, y, seed + 23) > 0.46) continue;
      const index = (oy + y) * surface.width + (ox + x);
      if (surface.data[index * 4 + 3] === 0) continue;
      put(surface, ox + x, oy + y, WILLOW_LEAF[0]);
    }
  }
}

/**
 * A broadleaf, conifer or shrub canopy.
 *
 * Overlapping lobes so the silhouette is never an ellipse, a lit upper-left cap,
 * and a size tier taken from the variant index so a stand reads as a stand of
 * individuals. Every pixel is a palette index.
 */
function paintCanopy(surface, ox, oy, spec, variant, shape) {
  const { width, height } = spec;
  const seed = 9000 + variant * 271 + spec.id.length * 37;
  const centerX = width / 2;
  const tier = shape.tiers[variant % shape.tiers.length];
  const crownY = height * shape.crownY * (0.94 + tier * 0.10);
  const radiusX = width * shape.radiusX * tier;
  const radiusY = height * shape.radiusY * tier;
  // trunk
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
  // crown: several overlapping lobes so the silhouette is not an ellipse
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
        // Light comes from the upper left, as in the reference plate, and the
        // modelling is deliberately STRONGER than the first pass: a crown needs
        // a lit cap and a genuinely dark underside or it reads as a flat blob on
        // a stick, which is what these did at 1:1.
        const lit = 0.56 - dy * 1.05 - dx * 0.40
          + (fbm(x * 0.42, y * 0.42, seed + 41, 3) - 0.5) * 0.62;
        // clumped foliage: leaf masses read as masses, not as an even wash
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
  // airy foliage above the trunks
  for (let y = 0; y < height * 0.62; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - width / 2) / (width * 0.52);
      const dy = (y - height * 0.26) / (height * 0.30);
      const dist = Math.hypot(dx, dy);
      const edge = fbm(x * 0.24, y * 0.24, seed + 11, 3);
      if (dist > 0.60 + edge * 0.62) continue;
      // Airy, but not absent: at 0.62 the first pass left the trunks reading as
      // a fence of bare white poles.
      const clump = fbm(x * 0.30, y * 0.30, seed + 17, 2);
      if (hash2(x, y, seed + 13) > 0.34 + clump * 0.42) continue;
      const lit = 0.54 - dy * 0.78 - dx * 0.30 + (edge - 0.5) * 0.8;
      put(surface, ox + x, oy + y, step(CANOPY_LEAF, level(CANOPY_LEAF, lit) + 1));
    }
  }
}

/**
 * A reed clump: dense blades fanning from one root, with seed heads.
 *
 * `inWater` draws the version that stands at the margin - a broken reflection
 * band at the foot instead of a contact shadow, which is how the reference's
 * reeds sit in the shallows.
 */
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
    // seed head: a short dark spike above the blade
    if (hash2(index, variant, seed + 13) > 0.58) {
      const headY = height - 3 - length;
      const headX = Math.round(baseX + bend);
      for (let s = 0; s < 4; s += 1) put(surface, ox + headX, oy + headY - s, ACCENT.twig);
      put(surface, ox + headX + 1, oy + headY - 1, ACCENT.twig);
    }
  }
  if (inWater) {
    // a broken reflection instead of a shadow: the reeds stand in the river
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
  // contact shadow so it sits in the ground
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

/**
 * A flower drift MASS.
 *
 * The reference reads its flowers as drifts - broad patches of yellow, white or
 * lavender covering ground - where the pilot's first pass scattered single
 * pixels and read as noise. This is a soft-edged elliptical mass of a green
 * understorey with 140-220 petals of ONE colourway packed into it, plus a
 * scatter of the second colour at the margin, so the drift has a centre.
 */
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

  // understorey first: a low mound of leaves so the petals sit ON something
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
  // Petals: packed in the centre, thinning at the rim - a MASS, not confetti.
  // 210 read as a pale wisp at 1:1; a drift in the reference plate is a solid
  // patch of colour you can see from across the plate.
  const count = dense ? 460 : 330;
  for (let index = 0; index < count; index += 1) {
    const angle = hash2(index, variant, seed + 5) * Math.PI * 2;
    const radius = Math.sqrt(hash2(index, variant, seed + 7));
    const x = Math.round(cx + Math.cos(angle) * rx * radius);
    const y = Math.round(cy + Math.sin(angle) * ry * radius);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const colour = radius > 0.74 && hash2(index, variant, seed + 9) > 0.5 ? secondary : petal;
    put(surface, ox + x, oy + y, colour);
    // two-pixel heads through most of the drift, three in its heart
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

/**
 * A SCARP piece: one length of the terrace edge, drawn as the reference draws
 * it - a grassy lip that overhangs a columnar rock face, tight vertical joints,
 * lit column arrises, horizontal bedding, rubble at the foot, and the shadow
 * the whole thing throws on the ground below.
 *
 * `turn` is 0 for a running face, +1 for an OUTSIDE corner (the terrace turns
 * away from the viewer, so two facets meet at a bright vertical arris) and -1
 * for an INSIDE corner (the facets recede into a shadowed crease). Corners were
 * the missing pieces: without them a terrace can only run in one direction
 * until it stops, which is exactly why the pilot's read as a fence.
 */
function paintScarp(surface, ox, oy, spec, variant, turn) {
  const { width, height } = spec;
  const seed = 23_000 + variant * 907 + (turn + 1) * 313;
  const palette = SCARP_ROCK;
  const faceTop = height * 0.16;
  const faceHeight = height * (0.44 + hash2(0, variant, seed) * 0.10);

  for (let x = 0; x < width; x += 1) {
    // Ends taper to NOTHING. This is the difference between a terrace and a row
    // of objects: three earlier passes drew a full-height face across the whole
    // frame, so every 32px placement along the margin read as one more box in a
    // line. A ragged, vanishing end lets neighbouring segments grow into each
    // other and the eye follows one broken rock break instead.
    const fromEnd = Math.min(x, width - 1 - x) / (width * 0.16);
    const taper = clamp01(fromEnd) ** 0.45;
    if (taper <= 0.02) continue;

    // The break's height follows a noise contour, never a drawn line. On a
    // corner it also swings, so the two facets read as different planes.
    const swing = turn === 0
      ? 0
      : (Math.abs(x - width / 2) / (width / 2)) * (turn > 0 ? -5 : 5);
    const ragged = (fbm(x * 0.24, variant * 3.7, seed + 17, 3) - 0.5) * 3.4;
    const lip = faceTop + ragged + swing + (1 - taper) * faceHeight * 0.5;
    const foot = lip + faceHeight * taper
      + (fbm(x * 0.18, variant * 5.1, seed + 23, 2) - 0.5) * 4.0;

    // 1. THE OVERHANG. Two pixels of near-black under the lip is the single
    //    strongest rock-break cue there is: it says the ground above stands
    //    proud of the face below. No grass cap is drawn - the ground behind the
    //    scarp is already painted by the terrain layer, and a painted-on cap is
    //    what gave the earlier passes their "crate lid".
    for (let y = Math.round(lip) - 2; y < lip + 1; y += 1) {
      put(surface, ox + x, oy + y, palette[0]);
    }

    // 2. THE FACE. Broad, irregular flutes - three to six across the frame, not
    //    a picket of eight - with LOW contrast between them. A bright arris on
    //    every column is what made the earlier pass read as a palisade of poles;
    //    here only some flutes catch light, and none catches much.
    const group = Math.floor(x / 17);
    const columnWidth = 8 + Math.floor(hash2(group, variant, seed + 37) * 9);
    const columnStart = group * 17 + Math.floor(hash2(group, variant, seed + 39) * 5);
    const inColumn = ((x - columnStart) % columnWidth + columnWidth) % columnWidth;
    const columnTone = level(palette, 0.18 + hash2(Math.floor(x / columnWidth), variant, seed + 41) * 0.24);
    const catchesLight = hash2(Math.floor(x / columnWidth), variant, seed + 43) > 0.58;
    // a corner's two facets take different light
    const facet = turn === 0 ? 0 : (x < width / 2 ? (turn > 0 ? 1 : -1) : (turn > 0 ? -1 : 1));
    const arris = turn !== 0 && Math.abs(x - width / 2) < 2;
    for (let y = Math.round(lip) + 1; y < foot; y += 1) {
      const depth = (y - lip) / Math.max(1, foot - lip);
      let index = columnTone + facet;
      if (inColumn === 0 && catchesLight) index += 1;
      else if (inColumn >= columnWidth - 2) index -= 1;
      if (depth < 0.18) index -= 1; // still in the overhang's shadow
      if (depth > 0.70) index -= 1; // and darkening into its own foot
      // fluting and weathering inside the flute, at 2px so it reads as stone
      if (hash2(chunky(x), chunky(y), seed + 47) > 0.72) index -= 1;
      else if (hash2(chunky(x), chunky(y), seed + 53) > 0.88) index += 1;
      if (arris) index = columnTone + 2;
      if (turn < 0 && Math.abs(x - width / 2) < 3) index = columnTone - 2;
      const damp = fbm(x * 0.20, y * 0.20, seed + 59, 3);
      put(surface, ox + x, oy + y, damp > 0.84 ? ACCENT.lichen : step(palette, index));
    }

    // 3. the shadow pooling on the ground below, fading to nothing
    for (let y = Math.round(foot); y < Math.min(height, foot + 6); y += 1) {
      const fade = 1 - (y - foot) / 6;
      veil(surface, ox + x, oy + y, ACCENT.shadow, 0.58 * fade * fade * taper);
    }
  }

  // 4. rubble spilling from the foot, in the pale GROUND rock so it reads as
  //    fallen stone lying on the ground rather than as more of the face
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
    // Eight individuals across four size tiers. The spread matters: the first
    // pass ran 0.74-1.08 of one radius and a stand read as one sprite stamped
    // eight times.
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

function buildSceneryAtlas() {
  const columns = 672;
  const surface = createSurface(columns, 800);
  const records = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (const spec of SCENERY_SPECS) {
    for (let variant = 0; variant < spec.variants; variant += 1) {
      if (cursorX + spec.width > columns) {
        cursorX = 0;
        cursorY += shelfHeight;
        shelfHeight = 0;
      }
      const ox = cursorX;
      const oy = cursorY;
      // Every prop except the ones that ARE ground gets a contact shadow first,
      // so the sprite is drawn sitting in it rather than on top of it.
      const carriesOwnShadow = spec.id.startsWith("scarp")
        || spec.id === "steppingstone"
        || spec.id === "reedwater"
        || spec.id.startsWith("bridge");
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = spec.pivot;
        paintContactShadow(
          surface,
          ox,
          oy,
          pivotX,
          pivotY + 2,
          Math.max(5, spec.width * 0.30),
          Math.max(3, spec.height * 0.070),
          spec.id === "tuft" || spec.id === "flowerdrift" ? 0.28 : 0.46,
        );
      }
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
  return { surface, records };
}

// ---------------------------------------------------------------------------
// output
// ---------------------------------------------------------------------------

/**
 * Encode a surface as an 8-bit INDEXED PNG, losslessly.
 *
 * This is the other half of the palette discipline, and it is not the same
 * thing as quantisation. `sharp`'s `palette: true` runs libimagequant, which
 * REMAPS colours: measured on this very sheet it shifted pixels by up to 113 -
 * the same failure the pilot report recorded at 256 colours. Here the palette
 * is not derived, it is DISCOVERED: because every painter chooses a fixed
 * palette entry, the sheet already contains fewer than 256 distinct RGBA
 * tuples, so an exact palette exists and every pixel maps to it with zero
 * error. Overflowing 256 is a hard error - that is the discipline enforcing
 * itself mechanically rather than by good intentions.
 *
 * Entries are ordered by alpha then luminance so that adjacent tones get
 * adjacent indices, which is what lets the PNG row filters turn a tonal ramp
 * into small deltas.
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

  // --- scanlines, one byte per pixel, filter NONE --------------------------
  // Measured on this sheet: filter None beats Sub, Up and Paeth by 20-26% and
  // beats an adaptive per-row choice outright. Delta filters help photographs,
  // where neighbouring values are close; on a palette index they destroy the
  // symbol distribution deflate is trying to exploit.
  const raw = Buffer.alloc(height * (width + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width + 1) + 1;
    for (let x = 0; x < width; x += 1) {
      raw[rowStart + x] = indexOfKey.get(keyOf((y * width + x) * 4));
    }
  }

  // --- chunks -------------------------------------------------------------
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // colour type: indexed
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
 * Write a sheet, choosing whichever encoder is SMALLER, and prove the result
 * decodes back to exactly the pixels that were authored.
 */
async function writeSurface(surface, file) {
  const raw = { raw: { width: surface.width, height: surface.height, channels: 4 } };
  const rgba = await sharp(Buffer.from(surface.data), raw)
    .png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  const indexed = encodeIndexedPng(surface);
  const png = indexed.png.length < rgba.length ? indexed.png : rgba;
  const encoding = indexed.png.length < rgba.length ? "indexed8" : "rgba8";
  // Losslessness is asserted, not assumed: decode and compare byte for byte.
  const back = await sharp(png).ensureAlpha().raw().toBuffer();
  for (let index = 0; index < surface.data.length; index += 4) {
    // A fully transparent pixel's RGB is not observable; compare alpha only.
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

export async function authorNirvanaValleyPilotArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const terrain = buildTerrainAtlas();
  const scenery = buildSceneryAtlas();
  const terrainInfo = await writeSurface(terrain.surface, path.join(outputRoot, "terrain.png"));
  const sceneryInfo = await writeSurface(scenery.surface, path.join(outputRoot, "scenery.png"));
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
    // Terrain frames are a uniform grid - 16 columns of 32px cells in row-major
    // order - so their rects are DERIVABLE and only the id order is data. A
    // per-frame rect table cost 111 bytes a frame; this costs 19, and it is the
    // same addressing production already uses (`terrainFramesByRole` stores a
    // cell index, not a rectangle). Metadata counts against the region kit's
    // byte ceiling, so this is real budget, not tidiness.
    terrainGrid: {
      image: "terrain",
      columns: TERRAIN_COLUMNS,
      cell: TILE,
      ids: terrain.records.map((record) => record.id),
    },
    // Scenery is shelf-packed at many sizes, so it keeps explicit rects - as
    // compact tuples: [id, x, y, width, height, pivotX, pivotY].
    sceneryFrames: scenery.records.map((record) => [
      record.id,
      record.rect.x, record.rect.y, record.rect.width, record.rect.height,
      record.pivot.x, record.pivot.y,
    ]),
  };
  // Compact, not indented: indentation costs a third of the size for nothing.
  await writeFile(path.join(outputRoot, "atlas.json"), `${JSON.stringify(atlas)}\n`, "utf8");
  return { ...atlas, frames: [...terrain.records, ...scenery.records] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorNirvanaValleyPilotArt()
    .then(async (atlas) => {
      const { stat } = await import("node:fs/promises");
      const json = await stat(path.join(DEFAULT_OUTPUT_ROOT, "atlas.json"));
      const art = atlas.images.terrain.bytes + atlas.images.scenery.bytes;
      process.stdout.write(
        `authored ${atlas.frames.length} pilot frames\n`
        + `  terrain ${atlas.images.terrain.width}x${atlas.images.terrain.height} `
        + `${atlas.images.terrain.bytes} B, ${atlas.images.terrain.colours} colours\n`
        + `  scenery ${atlas.images.scenery.width}x${atlas.images.scenery.height} `
        + `${atlas.images.scenery.bytes} B, ${atlas.images.scenery.colours} colours\n`
        + `  art total ${art} B; +metadata ${json.size} B = ${art + json.size} B\n`
        + `  region ceiling 196608 -> ${((art + json.size) / 196_608 * 100).toFixed(1)}% used\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
