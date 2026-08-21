/**
 * Authors the WARM SPRINGS geothermal PILOT tile vocabulary.
 *
 * Sibling of `author-nirvana-valley-pilot-art.mjs`. That file is the template
 * and is never modified; this one copies its proven machinery (the corner-mask
 * Wang alpha field, the shelf packer, the indexed-PNG encoder, the losslessness
 * assertion, the byte report) and replaces the AESTHETICS.
 *
 * What it emits (into `src/qa/warmSpringsPilot/assets/`):
 *   terrain.png  - 104 base fills (13 corner-field materials x 8), 238
 *                  corner-mask transition frames, 84 shoreline / wet-line
 *                  frames on the three bank materials. 426 frames.
 *   scenery.png  - steam plumes, terrace rim faces and corners, the sinter cone
 *                  vent, mud pots, fumaroles, andesite boulders, crust rings,
 *                  tussocks, the tree tiers, flower drifts, reeds, the boardwalk
 *                  kit, sinter steps and driftlogs.
 *   atlas.json   - schema 2, the same compact shape the Nirvana pilot writes:
 *                  a derived `terrainGrid` plus `sceneryFrames` tuples.
 *
 * ---------------------------------------------------------------------------
 * TWO disciplines govern this file. Both were measured on Nirvana.
 * ---------------------------------------------------------------------------
 *
 * 1. TRANSITIONS ARE CORNER-BASED (Wang) WITH A PRIORITY STACK.
 *    Every tile samples the material field at its four CORNERS; the lowest
 *    priority corner material fills the tile, and each higher material is
 *    overlaid with an alpha-cut edge frame keyed by which corners it owns.
 *    Because the alpha field is a bilinear interpolation of the SHARED corner
 *    samples, and the organic perturbation is windowed to zero on the tile
 *    border, the material boundary is CONTINUOUS across tile seams. That
 *    continuity is the whole reason the region revamp exists.
 *
 * 2. EVERY PIXEL IS A FIXED PALETTE ENTRY. NO RAMP INTERPOLATION ANYWHERE.
 *    Lighting, shading and contact shadow are index arithmetic into a
 *    material's fixed colour list - step up, step down - never a blend. Alpha
 *    is quantised to four levels (steam to three of its own). Nirvana's first
 *    pass interpolated and cost 473 KB for what is now 113 KB, and quantising
 *    afterwards was measured to shift pixels by a mean of 42, so it is not a
 *    fix. The only fix is authoring discipline.
 *
 * ---------------------------------------------------------------------------
 * CORNER-BIT CONVENTION - read this before writing scene code.
 * ---------------------------------------------------------------------------
 * The frozen contract's prose says bit2 = SW and bit3 = SE, but it also says
 * twice that the convention IS the Nirvana pilot's and to match that file.
 * Those two statements disagree. This sheet matches NIRVANA, which is what the
 * near-copy painter needs:
 *
 *      1 = NW      2 = NE      4 = SE      8 = SW
 *
 * The atlas declares it as `cornerBits` so the scene never has to guess.
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
  "../src/qa/warmSpringsPilot/assets",
);

export const TILE = 32;

/**
 * Material stack, lowest priority first, exactly as the frozen contract numbers
 * it. `deck` is index 13: the boardwalk. It is NEVER sampled in the corner
 * field and owns no terrain frame - it is the material a tile REPORTS once a
 * boardwalk carries it.
 */
export const MATERIALS = Object.freeze([
  "poolhot",
  "pool",
  "poolrim",
  "sinter",
  "travertine",
  "ochre",
  "mud",
  "shadegrass",
  "grass",
  "sungrass",
  "scrub",
  "reed",
  "rock",
  "deck",
]);

export const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

/** The thirteen materials the corner field may sample. `deck` is not one. */
export const FIELD_MATERIALS = Object.freeze(MATERIALS.slice(0, 13));

/** Materials a body cannot stand on or route through. `deck` carries bodies. */
export const BLOCKING_MATERIALS = Object.freeze([
  "poolhot",
  "pool",
  "poolrim",
  "ochre",
  "mud",
  "scrub",
  "reed",
  "rock",
]);

/** Bank materials that get a dedicated shoreline / wet-line overlay set. */
export const SHORE_MATERIALS = Object.freeze(["sinter", "travertine", "ochre"]);

/** Pool-family materials: the shoreline set is emitted where these are the base. */
export const WATER_MATERIALS = Object.freeze(["poolhot", "pool", "poolrim"]);

/** Tonal tiers of ONE sward. A species that grows on one grows on all three. */
export const GRASS_MATERIALS = Object.freeze(["shadegrass", "grass", "sungrass"]);

/** Eight fills per material - four lets the eye lock onto the repeat. */
const BASE_VARIANTS = 8;

/**
 * Transition variants per material - FROZEN by the contract.
 *
 * Two exist where a long boundary would otherwise repeat one 32px wobble and
 * the boundary is genuinely visible: the pool margin, the sinter apron, the
 * ochre mat's ragged fringe, the reed bed. Between two tonal tiers of one
 * sward the boundary is a single palette step and cannot be seen at 1:1, so
 * one is honestly enough.
 */
const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  poolhot: 1,
  pool: 2,
  poolrim: 1,
  sinter: 2,
  travertine: 1,
  ochre: 2,
  mud: 1,
  shadegrass: 1,
  grass: 1,
  sungrass: 1,
  scrub: 1,
  reed: 2,
  rock: 1,
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
// deterministic noise (verbatim from the Nirvana pilot)
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

/** A contiguous window onto a shared family ramp - the tonal-tier mechanism. */
function windowOf(family, from, to) {
  return Object.freeze(family.slice(from, to + 1));
}

/** Snap a noise coordinate to a 2px cluster: grain, not incompressible speckle. */
function chunky(value) {
  return Math.floor(value * 0.5) * 2;
}

/**
 * A DIRECTIONAL CONTOUR PARAMETER - the machinery behind travertine banding.
 *
 * Slicing a plain noise field at N levels gives blobs, because a noise field
 * has no direction: its level sets are closed islands, which is exactly why the
 * first pass read as camouflage. A deposit's growth lines are not islands, they
 * are long parallel curves that MEANDER.
 *
 * So the parameter is a linear ramp across a FIXED direction, plus a slow noise
 * term that bends it. `pitch` sets the ramp's rate (one band per unit, so 0.34
 * gives a band every ~3px) and `meander` * `sway` bends the bands without ever
 * reversing them. Only band POSITION comes from the low-frequency term; band
 * TONE does not, so a tile's average brightness stays constant.
 *
 * `angle` is a MATERIAL constant, never a per-variant one. Deriving it from the
 * seed - which carries the variant - gave the eight fills eight different band
 * directions, and a sheet laid out from them printed the 32px grid as squares
 * of rotated grain: the same failure the whole exercise exists to remove, just
 * expressed in direction instead of in brightness. With one angle the phase
 * still jumps at a seam, but a phase jump in a banded deposit reads as a
 * natural break in the formation, which is what real travertine does.
 */
function contourOf(wx, wy, seed, pitch, meander, sway, angle) {
  const across = wx * Math.cos(angle) + wy * Math.sin(angle);
  return across * pitch + fbm(wx * meander, wy * meander, seed, 3) * sway;
}

/**
 * The direction the mineral bands run. Sinter and travertine SHARE it: they are
 * one deposit at two ages, so the wet apron's banding and the dry terrace's
 * banding have to lie parallel or the ground reads as two unrelated rocks.
 */
const BAND_ANGLE = 0.40;

/** Four alpha levels. A continuous alpha channel is a photograph too. */
const ALPHA_LEVELS = Object.freeze([0, 88, 172, 255]);

function quantiseAlpha(alpha) {
  return ALPHA_LEVELS[Math.round(clamp01(alpha) * (ALPHA_LEVELS.length - 1))];
}

// ---------------------------------------------------------------------------
// palettes - the contract's fixed lists. The HUE relationships are the identity.
// ---------------------------------------------------------------------------

/**
 * ONE sward ramp, nine tones. Deliberately the same warm olive-green family
 * Nirvana uses: the shared green is what makes these two regions siblings, and
 * ALL of the difference between them lives in the mineral colours.
 */
const SWARD = Object.freeze([
  [61, 82, 39], [74, 97, 48], [87, 112, 58], [100, 126, 68], [114, 140, 78],
  [127, 153, 88], [143, 168, 98], [162, 185, 114], [182, 201, 136],
]);

/** Travertine's warm bands: the every-few-bands accent that makes it read ochre-cream. */
const TRAVERTINE_WARM = Object.freeze([
  [186, 142, 86], [214, 174, 116], [238, 206, 152],
]);

/**
 * Wet stone. A hot pool's edge stains the rock dark and SATURATED - this is
 * the single most beautiful detail in the whole vocabulary and it needs its own
 * colours, because a material's own darkest entry is dark but not saturated.
 */
const WET = Object.freeze({
  sinter: Object.freeze([[92, 94, 84], [118, 118, 104], [148, 146, 126]]),
  travertine: Object.freeze([[72, 58, 38], [98, 80, 54], [126, 106, 74]]),
  ochre: Object.freeze([[52, 24, 8], [80, 38, 12], [108, 54, 16]]),
});

const PALETTES = Object.freeze({
  // Hot pools. Saturated milky cyan, LUMINOUS - a hot spring is bright, not
  // murky, and this is the colour the world map has to see from far away.
  poolhot: Object.freeze([
    [28, 111, 120], [35, 131, 140], [46, 160, 166],
    [70, 188, 187], [116, 214, 205], [168, 232, 220],
  ]),
  pool: Object.freeze([
    [43, 125, 132], [61, 151, 153], [92, 178, 174],
    [133, 203, 195], [178, 224, 213], [214, 240, 229],
  ]),
  poolrim: Object.freeze([
    [124, 184, 180], [159, 205, 196], [192, 223, 211], [220, 236, 224], [240, 245, 234],
  ]),
  // Wet sinter apron: cream white with FAINT banding. Walkable.
  sinter: Object.freeze([
    [157, 145, 121], [182, 169, 142], [206, 192, 162],
    [226, 213, 184], [242, 233, 211], [251, 246, 232],
  ]),
  // Dry terrace stone: the signature texture. Fine concentric BANDS following
  // the contour, 2-4px, palette-stepped, with a warmer band every few.
  travertine: Object.freeze([
    [138, 116, 80], [166, 140, 98], [192, 166, 120],
    [214, 191, 147], [232, 213, 174], [244, 230, 200],
  ]),
  // Rust-orange microbial mat. The loudest colour in the world, and the one no
  // other region has. It is a STAIN that fringes water, not a flat fill.
  ochre: Object.freeze([
    [109, 58, 18], [143, 77, 22], [179, 100, 28],
    [209, 127, 39], [229, 156, 61], [242, 187, 99],
  ]),
  mud: Object.freeze([
    [74, 64, 56], [93, 80, 70], [114, 99, 86], [138, 122, 104], [162, 145, 124],
  ]),
  shadegrass: windowOf(SWARD, 0, 3),
  grass: windowOf(SWARD, 2, 5),
  sungrass: windowOf(SWARD, 4, 8),
  scrub: Object.freeze([
    [36, 54, 26], [47, 69, 34], [59, 83, 44], [72, 98, 54],
  ]),
  reed: Object.freeze([
    [111, 122, 52], [138, 148, 64], [165, 173, 85], [192, 197, 116], [215, 215, 154],
  ]),
  // Dark volcanic andesite - deliberately COOLER and darker than Nirvana's warm
  // rock, so it holds value contrast against the pale sinter.
  rock: Object.freeze([
    [58, 53, 63], [74, 69, 80], [92, 87, 99], [111, 106, 119], [133, 127, 140],
  ]),
});

/** Boardwalk timber. Five fixed colours, no interpolation. */
const DECK = Object.freeze({
  edge: [74, 53, 36],
  seam: [99, 72, 47],
  body: [125, 92, 58],
  lit: [151, 118, 76],
  fresh: [179, 149, 102],
});

/** The colour a deck's shadow drags the water toward. */
const DECK_SHADOW = Object.freeze([14, 34, 38]);

/** Accents. Each is a single fixed colour, never a blend target. */
const ACCENT = Object.freeze({
  crust: [250, 248, 238],
  crustDim: [226, 220, 202],
  shadow: [22, 18, 26],
  twig: [92, 72, 44],
  sulphur: [214, 190, 74],
  sulphurPale: [238, 224, 142],
  flowerWhite: [240, 238, 226],
  flowerYellow: [222, 190, 70],
  flowerPurple: [162, 140, 186],
  flowerPurpleDeep: [110, 96, 142],
  moss: [72, 96, 46],
  lichenPale: [176, 182, 150],
});

const BARK = Object.freeze([
  [34, 28, 18], [56, 46, 30], [80, 66, 42], [106, 88, 56], [134, 112, 72],
]);

const CANOPY_LEAF = Object.freeze([
  [32, 42, 20], [50, 62, 26], [70, 86, 34],
  [96, 112, 44], [128, 144, 58], [166, 180, 82],
]);

/** Deliberately dark: conifers are the value contrast against pale sinter. */
const CONIFER_LEAF = Object.freeze([
  [18, 28, 18], [26, 40, 22], [38, 54, 28],
  [52, 72, 34], [70, 92, 44], [92, 116, 56],
]);

/** Steam is white at three quantised alphas and nothing else. */
const STEAM_BRIGHT = Object.freeze([250, 252, 250]);
const STEAM_DIM = Object.freeze([234, 240, 237]);
const STEAM_ALPHAS = Object.freeze([64, 128, 192]);

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
    case "poolhot":
    case "pool": {
      // Milky, saturated, LUMINOUS. Depth reads as a MOTTLED CORE, never as
      // concentric bands: broad convection swells with pale suspension veils
      // drifting over them, and a few drawn filaments where the water turns.
      // The first pass ran the convection filaments far too hot and the water
      // read as crazed glass. They are now sparse and single-stepped: what
      // carries the surface is the MILK, broad soft veils of suspended mineral
      // drifting over a mottled core.
      // Every frequency here is deliberately HIGH. The second pass ran the
      // convection swell at 0.105 - a ~10px lattice - and each of the eight
      // fills ended up with its own average brightness, so a sheet of water
      // laid out from them showed the 32px lattice as faint squares. That is
      // the exact failure this pilot exists to remove, and it is worth more
      // than the broad soft shapes it costs: broad shape is the job of the
      // material FIELD (poolhot / pool / poolrim), not of a base fill.
      const hot = material === "poolhot";
      const swell = fbm(wx * 0.175, wy * 0.175, seed + 5, 3);
      const curl = fbm(wx * 0.215 + swell * 1.6, wy * 0.200 - swell * 1.4, seed + 17, 3);
      const milk = fbm(wx * 0.195 - curl * 0.9, wy * 0.205 + curl * 0.8, seed + 29, 2);
      let index = level(palette, (hot ? 0.48 : 0.38) + swell * 0.22 + (curl - 0.5) * 0.22);
      if (milk > 0.66) index += 1;
      else if (milk < 0.32) index -= 1;
      const thread = Math.abs(curl - 0.52);
      if (thread < 0.014) index += 1;
      return step(palette, index);
    }
    case "poolrim": {
      // Scalding shallow at the pool edge: near-white, with the sinter bed
      // reading through it and a rare shimmer on 2px clusters.
      const surface = fbm(wx * 0.125, wy * 0.125, seed + 7, 3);
      const bed = fbm(wx * 0.30, wy * 0.30, seed + 43, 2);
      let index = level(palette, 0.40 + surface * 0.46 + (bed - 0.5) * 0.22);
      if (bed > 0.74) return tone(PALETTES.sinter, 0.60 + (bed - 0.74) * 1.2);
      if (hash2(chunky(wx), chunky(wy), seed + 33) > 0.972) index += 1;
      return step(palette, index);
    }
    case "sinter": {
      // Wet sinter apron: the same banded machinery as travertine but FAINT.
      // This is the pale ground the ochre and the pools are read against, so it
      // stays quiet or the whole region turns to noise.
      // FAINT is the specification and it is load-bearing: sinter is the quiet
      // pale ground the ochre and the pools are read against. At full strength
      // the same machinery turned the apron into a contour map and fought the
      // travertine for attention, so here the bands are wider (0.24 pitch, a
      // ~4px band), only one in four takes its own tone, and the lip is a
      // single step rather than a lit-and-shaded pair.
      const raw = contourOf(wx, wy, seed + 9, 0.24, 0.032, 5.5, BAND_ANGLE);
      const band = Math.floor(raw);
      const within = raw - band;
      let index = level(palette, 0.62);
      const pick = hash2(band, 1, seed + 37);
      if (pick > 0.82) index += 1;
      else if (pick < 0.18) index -= 1;
      if (within < 0.20) index += 1;
      // Broad value only at HIGH frequency. A low-frequency term here is what
      // printed the 32px grid on the first pass: a base fill whose average
      // brightness varies over more than a few pixels turns every tile into a
      // patch of its own tone, and the lattice reappears.
      const swell = fbm(wx * 0.15, wy * 0.15, seed + 9, 2);
      if (swell > 0.68) index += 1;
      else if (swell < 0.30) index -= 1;
      const grain = fbm(chunky(wx) * 0.42, chunky(wy) * 0.42, seed + 23, 2);
      if (grain > 0.82) index += 1;
      else if (grain < 0.20) index -= 1;
      return step(palette, index);
    }
    case "travertine": {
      // THE SIGNATURE TEXTURE - the one thing that says Pamukkale rather than
      // sand. `contourOf` is a DIRECTIONAL contour parameter: a linear ramp
      // across the band direction, meandered by a slow noise field. Slicing it
      // at unit intervals puts a band every ~3px that CURVES, so the terrace
      // reads as deposited growth lines rather than as mottle.
      //
      // The base tone is a CONSTANT palette index. All modelling is the band's
      // own: its own tone, a lit upper lip, a shaded lower edge, and roughly one
      // band in five running warm. Any low-frequency luminance term here would
      // give each tile its own average brightness and print the 32px grid.
      // Sway 15 -> 6.5: at full sway the bands curled back on themselves and
      // the stone read as wood grain. Travertine growth lines follow the SLOPE,
      // so they run long and near-parallel and only lean where the terrace does.
      const raw = contourOf(wx, wy, seed + 13, 0.34, 0.028, 6.5, BAND_ANGLE);
      const band = Math.floor(raw);
      const within = raw - band;
      if (hash2(band, 7, seed + 43) > 0.80) {
        const warm = 0.20 + (1 - within) * 0.66;
        return step(TRAVERTINE_WARM, level(TRAVERTINE_WARM, warm));
      }
      let index = level(palette, 0.52);
      const pick = hash2(band, 3, seed + 41);
      index += pick > 0.76 ? 2 : pick > 0.52 ? 1 : pick > 0.24 ? 0 : -1;
      // the band's own relief: its upper lip catches the light, its lower edge
      // is the riser dropping to the next band down
      if (within < 0.24) index += 1;
      else if (within > 0.76) index -= 1;
      if (within > 0.92) index -= 1;
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 47, 2);
      if (grain > 0.84) index += 1;
      else if (grain < 0.18) index -= 1;
      return step(palette, index);
    }
    case "ochre": {
      // Microbial mat. Not a flat orange fill: streaming filaments of living
      // mat over crusted dried patches, so the stain has direction and grain.
      // The HOT inner edge is drawn by the shoreline set (where the mat meets
      // water) and the COOL ragged outer edge by the transition set.
      const mat = fbm(wx * 0.125, wy * 0.125, seed + 51, 3);
      const filament = fbm(wx * 0.255 + mat * 2.4, wy * 0.235 - mat * 2.0, seed + 57, 2);
      let index = level(palette, 0.26 + mat * 0.58 + (filament - 0.5) * 0.40);
      const thread = Math.abs(filament - 0.55);
      if (thread < 0.028) index += 2;
      else if (thread < 0.058) index += 1;
      if (mat < 0.24) index -= 2;
      const grain = fbm(chunky(wx) * 0.50, chunky(wy) * 0.50, seed + 61, 2);
      if (grain > 0.82) index += 1;
      else if (grain < 0.18) index -= 1;
      return step(palette, index);
    }
    case "mud": {
      // Boiling grey mud: a thick skin with bubbles rising through it. Each
      // bubble is a dark mouth with a lit upper rim, on a jittered cell grid,
      // so the surface reads as viscous rather than as a grey noise wash.
      const slop = fbm(wx * 0.10, wy * 0.10, seed + 67, 3);
      const skin = fbm(chunky(wx) * 0.36, chunky(wy) * 0.36, seed + 71, 2);
      let index = level(palette, 0.22 + slop * 0.56 + (skin - 0.5) * 0.22);
      const cellSize = 7;
      let best = -1;
      let bestIndex = index;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const cx = Math.floor(wx / cellSize) + dx;
          const cy = Math.floor(wy / cellSize) + dy;
          if (hash2(cx, cy, seed + 73) < 0.42) continue;
          const jx = (cx + hash2(cx, cy, seed + 79)) * cellSize;
          const jy = (cy + hash2(cx, cy, seed + 83)) * cellSize;
          const radius = 1.7 + hash2(cx, cy, seed + 89) * 1.8;
          const offsetX = wx - jx;
          const offsetY = wy - jy;
          const distance = Math.hypot(offsetX, offsetY * 1.2);
          if (distance > radius) continue;
          const score = radius - distance;
          if (score <= best) continue;
          best = score;
          const relative = distance / radius;
          let bubble = index;
          if (relative > 0.74) bubble += 1;
          else bubble -= 2;
          if (offsetY < -radius * 0.30 && relative > 0.52) bubble += 1;
          bestIndex = bubble;
        }
      }
      if (best >= 0) index = bestIndex;
      return step(palette, index);
    }
    case "shadegrass":
    case "grass":
    case "sungrass": {
      // Deliberately high-frequency only. A base fill must carry NO feature
      // larger than a few pixels or the tile becomes a motif and the grid
      // prints through; all large-scale variation is the three tonal tiers.
      const clump = fbm(wx * 0.20, wy * 0.20, seed + 11, 3);
      const grain = fbm(chunky(wx) * 0.44, chunky(wy) * 0.44, seed + 23, 2);
      let index = level(palette, 0.24 + clump * 0.52 + (grain - 0.5) * 0.34);
      const bladePick = hash2(Math.floor(wx), Math.floor(wy / 3), seed + 37);
      if (bladePick > 0.855) {
        index += hash2(Math.floor(wx), Math.floor(wy), seed + 53) > 0.44 ? 1 : -1;
      }
      if (hash2(chunky(wx), chunky(wy), seed + 57) < 0.14) index -= 1;
      return step(palette, index);
    }
    case "scrub": {
      // Overlapping bush crowns with lit caps and dark gaps, so the patch is a
      // mass of plants and not a flat stain.
      const mass = fbm(wx * 0.17, wy * 0.17, seed + 111, 3);
      const bushX = wx * 0.42;
      const bushY = wy * 0.42;
      const crown = fbm(bushX, bushY, seed + 127, 2);
      const gradient = fbm(bushX, bushY - 0.55, seed + 127, 2) - crown;
      let index = level(palette, 0.04 + mass * 0.28 + crown * 0.44 + gradient * 2.3);
      if (crown < 0.34) index -= 1;
      const twig = hash2(Math.floor(wx), Math.floor(wy), seed + 139);
      if (twig > 0.972) index += 1;
      if (twig < 0.016) return ACCENT.twig;
      return step(palette, index);
    }
    case "reed": {
      // Hot-spring reed bed: standing stubble in 1px strokes at varied heights
      // over a wet mat, with the pool showing through the gaps.
      const wet = fbm(wx * 0.16, wy * 0.16, seed + 61, 3);
      let index = level(palette, 0.06 + wet * 0.42);
      // Every column gets its OWN vertical phase. Sharing one 9px rhythm across
      // the whole bed drew horizontal stripes and the reeds read as matting.
      const column = Math.floor(wx);
      const offset = Math.floor(hash2(column, 0, seed + 71) * 9);
      const row = Math.floor((wy + offset) / 9);
      const stalk = hash2(column, row, seed + 73);
      if (stalk > 0.50) {
        const phase = (((wy + offset) % 9) + 9) % 9;
        const height = 3 + Math.floor(stalk * 6);
        if (phase < height) index = level(palette, 0.54 + (height - phase) * 0.07);
      }
      if (hash2(chunky(wx), chunky(wy), seed + 79) > 0.966) return tone(PALETTES.pool, 0.45);
      return step(palette, index);
    }
    case "rock": {
      // FRACTURED ANDESITE, not paving.
      //
      // The obvious Voronoi-with-a-dark-joint reads as a cobbled street, and it
      // did: an even lattice of similar rounded stones each ringed by mortar is
      // a BUILT surface, and it was the only material on the sheet that looked
      // made rather than broken. Three things fix it.
      //
      //   1. Cells are large and each is squashed and ROTATED by its own random
      //      angle under a Chebyshev metric, so the blocks are irregular
      //      angular quadrilaterals rather than round pebbles.
      //   2. Roughly half of all cell borders are WELDED - no joint, and both
      //      cells take the lower cell's tone. That merges the lattice into
      //      fewer, larger, irregular masses, which is what kills the paving.
      //   3. Long fractures cut ACROSS the cells entirely, so the breaks in the
      //      rock do not all belong to the same grid.
      const cellSize = 17;
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
          const angle = hash2(cx, cy, seed + 91) * Math.PI;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const ux = (wx - jx) * cos + (wy - jy) * sin;
          const uy = -(wx - jx) * sin + (wy - jy) * cos;
          const stretch = 0.66 + hash2(cx, cy, seed + 93) * 0.80;
          const distance = Math.max(Math.abs(ux) / stretch, Math.abs(uy) * stretch);
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
      const low = Math.min(nearKey, secondKey);
      const high = Math.max(nearKey, secondKey);
      const welded = hash2(low, high, seed + 107) < 0.48;
      const blockKey = welded ? low : nearKey;
      let index = level(palette, 0.08 + hash2(blockKey, 3, seed + 97) * 0.52);
      // a fractured facet is not flat: one directional gradient across the block
      index += localY < -cellSize * 0.20 ? 1 : localY > cellSize * 0.22 ? -1 : 0;
      if (localX < -cellSize * 0.28) index += 1;
      const joint = second - nearest;
      if (!welded) {
        if (joint < 1.3) index -= 3;
        else if (joint < 2.4) index -= 1;
      }
      // fractures that ignore the cells entirely
      const fracture = Math.abs(fbm(wx * 0.038, wy * 0.038, seed + 111, 2) - 0.5);
      if (fracture < 0.010) index -= 3;
      else if (fracture < 0.022) index -= 1;
      if (hash2(chunky(wx), chunky(wy), seed + 101) > 0.86) index -= 1;
      else if (hash2(chunky(wx), chunky(wy), seed + 113) > 0.94) index += 1;
      // Life is RARE here: this ground is hot, and the rock is the dark value
      // anchor the pale sinter is read against. A pale mineral bloom in a
      // fracture, very occasionally; nothing that reads as a weeded street.
      if (!welded && joint < 1.4 && fbm(wx * 0.09, wy * 0.09, seed + 103, 2) > 0.90) {
        return ACCENT.lichenPale;
      }
      return step(palette, index);
    }
    default:
      throw new Error(`unknown material ${material}`);
  }
}

// ---------------------------------------------------------------------------
// surface helpers (verbatim from the Nirvana pilot)
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
 * How a material's transition behaves at its own outer edge.
 *
 * `drop` is how many palette steps the rim darkens by (the contact shadow that
 * makes the upper material sit ON the lower one rather than beside it).
 * `speck` is the threshold for detached outliers just beyond the boundary,
 * which stop the seam reading as a drawn line. Ochre is the loud case: its mat
 * has to fringe OUT into whatever it meets with a cool ragged margin, so it
 * both drops further and throws far more specks than anything else.
 */
const EDGE_STYLE = Object.freeze({
  ochre: { drop: [3, 2], speck: 0.72 },
  scrub: { drop: [2, 1], speck: 0.86 },
  reed: { drop: [2, 1], speck: 0.86 },
  shadegrass: { drop: [2, 1], speck: 0.90 },
  grass: { drop: [2, 1], speck: 0.90 },
  sungrass: { drop: [2, 1], speck: 0.90 },
  mud: { drop: [2, 1], speck: 0.84 },
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
        // Scattered outliers just beyond the boundary keep the seam from
        // reading as a drawn line.
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
      // The shade is index arithmetic on the material's OWN list. When a
      // painter returned an off-palette accent (a warm travertine band, moss in
      // a rock joint) there is no index to step from, so the colour stands.
      const at = palette.indexOf(colour);
      const shaded = drop === 0 || at < 0 ? colour : step(palette, at - drop);
      setPixel(surface, originX + x, originY + y, [shaded[0], shaded[1], shaded[2], alpha]);
    }
  }
}

/**
 * One shoreline / wet-line frame: where a hot pool meets sinter, travertine or
 * the ochre mat. This is the single most beautiful detail in the vocabulary.
 *
 * It is laid over the bank's own transition frame and SHARES its seed, so the
 * wet line follows exactly the same contour as the bank edge it belongs to.
 *
 * Bank side  - a dark SATURATED wet band, darkest right at the water, mottled
 *              rather than a uniform kerb. On ochre this inverts: the mat is
 *              HOTTEST where it touches the water and cools inward, which is
 *              what makes the stain read as alive.
 * Water side - a BROKEN pale mineral crust line. Continuous would read as a
 *              cartoon outline scalloped around every pool; broken reads as
 *              deposited crust, and on travertine it grows into small nodules.
 */
function paintShoreTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const palette = WET[material];
  const hotMat = material === "ochre";
  const nodules = material === "travertine";
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      if (field >= 0.505 && field < 0.72) {
        const depth = (field - 0.505) / 0.215;
        const damp = fbm((x + originX) * 0.36, (y + originY) * 0.36, seed + 197, 2);
        let colour;
        if (hotMat) {
          // hot inner fringe: brightest rust at the waterline, cooling inward
          const heat = 0.46 + (1 - depth) * 0.54;
          colour = step(PALETTES.ochre, level(PALETTES.ochre, heat) + (damp > 0.66 ? 1 : -1));
        } else {
          const wetLevel = depth < 0.30 ? 0 : depth < 0.66 ? 1 : 2;
          colour = step(palette, wetLevel + (damp > 0.64 ? 1 : 0));
        }
        setPixel(surface, originX + x, originY + y, [
          colour[0], colour[1], colour[2], depth < 0.82 ? 255 : ALPHA_LEVELS[2],
        ]);
        continue;
      }
      if (field >= 0.42 && field < 0.505) {
        const near = (field - 0.42) / 0.085;
        const broken = fbm((x + originX) * 0.42, (y + originY) * 0.42, seed + 211, 2);
        const bias = nodules ? 0.13 : hotMat ? -0.05 : 0;
        if (broken > 0.62 - near * 0.22 - bias) {
          const bright = broken > 0.78 && near > 0.46;
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
// scenery
// ---------------------------------------------------------------------------

const SCENERY_SPECS = Object.freeze([
  // THE signature element: what says "geothermal" at a glance.
  { id: "steam", width: 96, height: 96, variants: 4, pivot: [48, 88] },
  { id: "steamsmall", width: 48, height: 48, variants: 3, pivot: [24, 44] },
  // The terrace lip. A sinter rim is DEPOSITED, not fractured: rounded, lobed,
  // dripping - nothing like a rock cliff.
  { id: "rimface", width: 32, height: 48, variants: 4, pivot: [16, 40] },
  { id: "rimcornerin", width: 32, height: 48, variants: 2, pivot: [16, 40] },
  { id: "rimcornerout", width: 32, height: 48, variants: 2, pivot: [16, 40] },
  // The vent - hero landmark.
  { id: "sintercone", width: 96, height: 112, variants: 2, pivot: [48, 104] },
  { id: "mudpot", width: 48, height: 48, variants: 3, pivot: [24, 44] },
  { id: "fumarole", width: 48, height: 64, variants: 2, pivot: [24, 60] },
  { id: "boulder", width: 48, height: 48, variants: 3, pivot: [24, 44] },
  { id: "crustring", width: 32, height: 32, variants: 3, pivot: [16, 28] },
  { id: "tussock", width: 32, height: 40, variants: 4, pivot: [16, 37] },
  { id: "shrub", width: 48, height: 48, variants: 3, pivot: [24, 45] },
  { id: "conifer", width: 64, height: 96, variants: 3, pivot: [32, 92] },
  { id: "broadleaf", width: 64, height: 80, variants: 3, pivot: [32, 76] },
  // MASSES, not scattered pixels.
  { id: "flowerdrift", width: 48, height: 32, variants: 3, pivot: [24, 29] },
  { id: "reedclump", width: 32, height: 48, variants: 3, pivot: [16, 45] },
  { id: "reedwater", width: 32, height: 48, variants: 3, pivot: [16, 45] },
  // Boardwalk: tile-sized pieces anchored to the bottom of their own tile.
  { id: "walkh", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "walkv", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "walkpost", width: 32, height: 32, variants: 2, pivot: [16, 31] },
  { id: "walkramph", width: 32, height: 32, variants: 1, pivot: [16, 31] },
  { id: "walkrampv", width: 32, height: 32, variants: 1, pivot: [16, 31] },
  { id: "sinterstep", width: 32, height: 32, variants: 3, pivot: [16, 29] },
  { id: "driftlog", width: 48, height: 24, variants: 2, pivot: [24, 21] },
]);

/**
 * A STEAM plume.
 *
 * Translucent white, quantised alpha only, drifting up and to the right. It has
 * to read as steam and not as a fog blob, so: a narrow dense throat at the vent
 * that fans and dissipates upward, internal curl so the mass has structure, and
 * torn wisps shed on the downwind side near the top. Two colours at three
 * alphas is the whole material.
 */
function paintSteam(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 61_000 + variant * 1487;
  const baseX = width * (0.30 + hash2(variant, 1, seed) * 0.10);
  const drift = width * (0.28 + hash2(variant, 2, seed) * 0.16);
  const lean = 1.15 + hash2(variant, 3, seed) * 0.35;
  for (let y = 0; y < height; y += 1) {
    const t = 1 - y / (height - 1);
    const centerX = baseX + drift * t ** lean;
    const radius = width * (0.055 + 0.40 * t ** 0.72);
    for (let x = 0; x < width; x += 1) {
      const across = (x - centerX) / radius;
      if (Math.abs(across) > 1.35) continue;
      const puff = fbm(x * 0.145 + variant * 17, y * 0.115 - t * 3.4, seed + 3, 3);
      const curl = fbm(x * 0.23 - t * 1.4, y * 0.20 - t * 2.6, seed + 11, 2);
      const tear = fbm(x * 0.36, y * 0.30 - t * 4.0, seed + 19, 2);
      // dense at the throat, thinning and TEARING as it rises
      let density = (1.10 - across * across) * (0.34 + puff * 1.26) * (1.14 - t * 0.62);
      density += (curl - 0.5) * 0.42;
      // wisps shed downwind, on the right-hand margin only
      if (across > 0.72) density -= (across - 0.72) * 1.5;
      // the plume shreds into separate wisps as it dissipates
      if (t > 0.42) density -= (t - 0.42) * 0.62 + (t - 0.42) * (0.62 - tear) * 1.5;
      if (density <= 0.15) continue;
      const alphaLevel = density > 0.50 ? 2 : density > 0.27 ? 1 : 0;
      const colour = density > 0.36 ? STEAM_BRIGHT : STEAM_DIM;
      setPixel(surface, ox + x, oy + y, [
        colour[0], colour[1], colour[2], STEAM_ALPHAS[alphaLevel],
      ]);
    }
  }
}

/**
 * One length of TERRACE RIM.
 *
 * Nirvana's cliff pieces took three iterations to stop reading as a fence and
 * were still its weakest element. A sinter rim is a different object entirely:
 * it is DEPOSITED, so its edge is a run of rounded lobes, each lobe bulging
 * downward and hanging a short dripstone below it, with a bright wet lip on top
 * and a shadow pooled underneath.
 *
 * Continuity: the lobe period always DIVIDES 32, so the scallop phase is zero
 * at both frame edges and consecutive placements join exactly. All the internal
 * texture is keyed to the lobe, not to the frame, so the repeat the eye can see
 * is the ~8-16px lobe rather than the 32px tile.
 *
 * `turn` is 0 for a running face, +1 for an OUTSIDE corner (the rim turns away,
 * two facets meet at a lit arris) and -1 for an INSIDE corner (the facets fold
 * into a shadowed crease).
 */
function paintTerraceRim(surface, ox, oy, spec, variant, turn) {
  const { width, height } = spec;
  const seed = 63_000 + variant * 1601 + (turn + 1) * 379;
  const lobes = [2, 3, 4, 3][variant % 4];
  const period = width / lobes;
  const lipTop = 7;
  const faceHeight = 17 + (variant % 3) * 2;
  const stone = PALETTES.sinter;
  const warm = PALETTES.travertine;

  for (let x = 0; x < width; x += 1) {
    const phase = ((x % period) + period) % period / period;
    const lobeIndex = Math.floor(x / period);
    // The lobe bulges DOWN in its middle and pinches at the joins.
    const lobeSize = 0.62 + hash2(Math.floor(x / period), variant, seed + 11) * 0.85;
    const bulge = Math.sin(Math.PI * phase) ** 0.62 * lobeSize;
    const jitter = (fbm(x * 0.33, variant * 4.3, seed + 17, 2) - 0.5) * 1.6;
    const lipY = lipTop + bulge * 4.2 + jitter;
    // a corner swings the whole rim, so the two facets read as different planes
    const swing = turn === 0
      ? 0
      : (Math.abs(x - width / 2) / (width / 2)) * (turn > 0 ? -4.5 : 4.5);
    const top = lipY + swing;
    const dripExtra = hash2(lobeIndex, variant, seed + 23) > 0.45
      ? bulge * (5 + hash2(lobeIndex, variant, seed + 29) * 7)
      : bulge * 2;
    const foot = top + faceHeight * (0.72 + bulge * 0.38) + dripExtra;
    const facet = turn === 0 ? 0 : (x < width / 2 ? (turn > 0 ? 1 : -1) : (turn > 0 ? -1 : 1));
    const arris = turn > 0 && Math.abs(x - width / 2) < 2;
    const crease = turn < 0 && Math.abs(x - width / 2) < 3;

    // 1. THE WET LIP. Two or three pixels of the palest sinter, wrapping over
    //    the top of the lobe - a deposited rim is always wet where it spills.
    for (let y = Math.round(top) - 2; y <= Math.round(top); y += 1) {
      const bright = y < top - 1 ? stone.length - 1 : stone.length - 2;
      put(surface, ox + x, oy + y, step(stone, bright + facet));
    }

    // 1b. THE OVERHANG. Two pixels of the darkest stone directly under the wet
    //     lip. This is the single strongest relief cue there is - it says the
    //     ground above stands proud of the face below - and its absence is
    //     exactly why the first pass read as a scalloped frieze rather than as
    //     a terrace with a drop under it.
    for (let y = Math.round(top) + 1; y <= Math.round(top) + 2; y += 1) {
      put(surface, ox + x, oy + y, step(stone, 0));
    }

    // 2. THE FACE. Banded across (the deposit's own growth lines) and streaked
    //    down (the drip runnels), shading into the lobe's underside. The face
    //    runs a genuinely dark bottom: a pale face on pale ground has no
    //    silhouette at all at 1:1.
    for (let y = Math.round(top) + 3; y < foot; y += 1) {
      const depth = (y - top) / Math.max(1, foot - top);
      const band = Math.floor((y - top) * 0.62 + hash2(lobeIndex, y, seed + 31) * 0.5);
      let index = level(stone, 0.70 - depth * 0.66);
      index += facet;
      if (band % 3 === 0) index += 1;
      else if (band % 4 === 2) index -= 1;
      // runnels: the water runs down the middle of the lobe and stains it pale
      const runnel = Math.abs(phase - 0.5);
      if (runnel < 0.10) index += 1;
      else if (runnel > 0.42) index -= 1;
      if (depth < 0.18) index -= 2; // still under the lip's overhang
      if (depth > 0.72) index -= 1; // and darkening into its own foot
      if (depth > 0.90) index -= 1;
      if (arris) index += 2;
      if (crease) index -= 2;
      if (hash2(chunky(x), chunky(y), seed + 37) > 0.86) index -= 1;
      // a warm travertine band every few, as on the flat stone
      if (hash2(band, lobeIndex, seed + 41) > 0.80) {
        put(surface, ox + x, oy + y, step(warm, level(warm, 0.30 + (1 - depth) * 0.44)));
        continue;
      }
      put(surface, ox + x, oy + y, step(stone, index));
    }

    // 3. the rounded dripstone tip and the shadow it pools on the ground
    const tip = Math.round(foot);
    put(surface, ox + x, oy + tip, step(stone, 0));
    for (let y = tip + 1; y < Math.min(height, tip + 8); y += 1) {
      const fade = 1 - (y - tip) / 8;
      veil(surface, ox + x, oy + y, ACCENT.shadow, 0.80 * fade * fade);
    }
  }

  // 4. mineral crust flakes at the foot, so the rim sits IN the ground
  for (let index = 0; index < 10; index += 1) {
    const x = Math.round(width * (0.08 + hash2(index, variant, seed + 61) * 0.84));
    const y = Math.round(height * (0.72 + hash2(index, variant, seed + 67) * 0.20));
    put(surface, ox + x, oy + y, step(stone, 2 + Math.floor(hash2(index, variant, seed + 71) * 3)));
    if (hash2(index, variant, seed + 73) > 0.5) {
      put(surface, ox + x + 1, oy + y, step(stone, 1));
    }
  }
}

/**
 * THE SINTER CONE - the vent, and the region's hero landmark.
 *
 * A dome of deposited sinter built as a height field: concentric terraced rings
 * whose lips catch the sky and shade beneath, a scalding pool in the crater
 * with a near-white rim, pale wet runnels spilling down three or four sectors,
 * and ochre mat staining the down-slope apron where the outflow cools.
 */
function paintSinterCone(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 65_000 + variant * 1721;
  const centerX = width / 2;
  const centerY = height - 10 - height * 0.20;
  const radiusX = width * 0.47;
  const radiusY = height * 0.32;
  const rings = 5 + variant;
  const stone = PALETTES.sinter;
  const runnelPhase = hash2(variant, 5, seed) * Math.PI * 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const wobble = (fbm(x * 0.065 + variant * 9, y * 0.065, seed + 3, 3) - 0.5) * 0.26;
      const radius = Math.hypot(dx, dy * 1.06) + wobble;
      if (radius > 1.0) continue;
      const dome = Math.sqrt(Math.max(0, 1 - radius * radius));
      const angle = Math.atan2(dy, dx);

      // the crater: hot water with a near-white scalding rim
      if (radius < 0.15) {
        const boil = fbm(x * 0.32, y * 0.32, seed + 7, 2);
        put(surface, ox + x, oy + y, step(PALETTES.poolhot, level(PALETTES.poolhot, 0.34 + boil * 0.6)));
        continue;
      }
      if (radius < 0.23) {
        put(surface, ox + x, oy + y, step(PALETTES.poolrim, radius < 0.19 ? 4 : 3));
        continue;
      }

      const ringRaw = dome * rings;
      const ring = Math.floor(ringRaw);
      const within = ringRaw - ring;
      // A white mound needs its VALUE range spent on the terrace risers, not on
      // extra pale lines: the first pass drew a growth band and a bright runnel
      // on top of the ring lips and the cone read as a scallop shell. Each ring
      // now gets a lit lip and a genuinely dark riser under it, and nothing
      // else competes.
      let index = level(stone, 0.26 + dome * 0.48);
      if (within > 0.76) index += 2;      // the ring's lip catches the sky
      else if (within < 0.30) index -= 3; // the riser dropping to the ring below
      // key light from the upper left
      index += (dx < -0.18 || dy < -0.30) ? 1 : (dx > 0.34 || dy > 0.44) ? -1 : 0;
      if (hash2(chunky(x), chunky(y), seed + 13) > 0.86) index -= 1;

      // Wet runnels spilling down the flanks: narrow, and only a step brighter
      // than the stone they cross. Anything louder became radial spokes.
      const spill = Math.abs(Math.cos(angle * 3 + runnelPhase));
      if (spill > 0.972 && radius > 0.40) {
        put(surface, ox + x, oy + y, step(stone, index + 1));
        continue;
      }
      // Ochre apron on the lower slope, where the outflow has cooled. Ragged
      // and broken - a clean ring around the foot read as a painted-on collar.
      // Ochre apron: ragged tongues climbing the lower flanks. Confined to the
      // foot it read as a mound standing in a puddle of orange paint; let loose
      // it swallowed the lower half. `spill` is SUBTRACTED, so the mat thins
      // where the hot water actually runs and the runnels stay clean stone
      // channels cut through the stain - which is what the mat does in life.
      if (radius > 0.55 && dy > -0.15) {
        const climb = (radius - 0.55) * 0.95 + Math.max(0, dy) * 0.38 - spill * 0.42;
        const stain = fbm(x * 0.17, y * 0.20, seed + 19, 3) * 1.20 + climb;
        if (stain > 1.10) {
          put(
            surface, ox + x, oy + y,
            step(PALETTES.ochre, level(PALETTES.ochre, 0.16 + stain * 0.44)),
          );
          continue;
        }
      }
      put(surface, ox + x, oy + y, step(stone, index));
    }
  }

  // the mound's own contact shadow, wide and soft
  paintContactShadow(surface, ox, oy, centerX, height - 8, width * 0.42, 5.5, 0.52);
}

/** A boiling MUD POT: a raised grey rim around a pot of bursting mud. */
function paintMudPot(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 67_000 + variant * 1831;
  const palette = PALETTES.mud;
  const centerX = width / 2;
  const centerY = height * 0.58;
  const radiusX = width * 0.44;
  const radiusY = height * 0.34;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const wobble = (fbm(x * 0.13 + variant * 6, y * 0.13, seed + 3, 3) - 0.5) * 0.28;
      const radius = Math.hypot(dx, dy) + wobble;
      if (radius > 1.0) continue;
      if (radius > 0.74) {
        // the splattered rim, thrown up by the bursts and lit on top
        const lit = dy < -0.1 ? 4 : dy > 0.3 ? 1 : 3;
        put(surface, ox + x, oy + y, step(palette, lit - (hash2(x, y, seed + 7) > 0.7 ? 1 : 0)));
        continue;
      }
      put(surface, ox + x, oy + y, materialPixel("mud", x * 1.4 + variant * 31, y * 1.4, seed + 11));
    }
  }
  // a burst: one big bubble caught mid-collapse, with a lit crown
  const burstX = centerX + (hash2(variant, 2, seed) - 0.5) * width * 0.28;
  const burstY = centerY + (hash2(variant, 3, seed) - 0.5) * height * 0.16;
  const burstR = 4 + hash2(variant, 4, seed) * 3;
  for (let y = Math.floor(burstY - burstR); y <= burstY + burstR; y += 1) {
    for (let x = Math.floor(burstX - burstR); x <= burstX + burstR; x += 1) {
      const d = Math.hypot((x - burstX) / burstR, (y - burstY) / (burstR * 0.8));
      if (d > 1) continue;
      const shade = d > 0.78 ? 4 : d > 0.60 ? 3 : y < burstY ? 2 : 0;
      put(surface, ox + x, oy + y, step(palette, shade));
    }
  }
}

/** A FUMAROLE: a small crusted vent with sulphur staining around a dark throat. */
function paintFumarole(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 69_000 + variant * 1913;
  const centerX = width / 2;
  const baseY = height - 6;
  const coneTop = height * 0.30;
  const stone = PALETTES.sinter;
  for (let y = Math.floor(coneTop); y <= baseY; y += 1) {
    const t = (y - coneTop) / (baseY - coneTop);
    const halfWidth = width * (0.10 + 0.34 * t ** 0.85);
    const ragged = (fbm(y * 0.4, variant * 3.1, seed + 3, 2) - 0.5) * 2.4;
    for (let x = Math.round(centerX - halfWidth + ragged); x <= centerX + halfWidth + ragged; x += 1) {
      const across = (x - centerX - ragged) / Math.max(1, halfWidth);
      let index = level(stone, 0.56 - t * 0.24 - across * 0.30);
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.82) index -= 1;
      // sulphur crust ringing the throat and streaking down the lit side
      const sulphury = fbm(x * 0.19, y * 0.19, seed + 11, 2) + (1 - t) * 0.42;
      if (sulphury > 0.86) {
        put(surface, ox + x, oy + y, sulphury > 0.98 ? ACCENT.sulphurPale : ACCENT.sulphur);
        continue;
      }
      put(surface, ox + x, oy + y, step(stone, index));
    }
  }
  // the throat: a dark hole with a bright lip on its upper edge
  const throatY = coneTop + 4;
  for (let y = Math.floor(throatY - 3); y <= throatY + 3; y += 1) {
    for (let x = Math.floor(centerX - 5); x <= centerX + 5; x += 1) {
      const d = Math.hypot((x - centerX) / 5, (y - throatY) / 3);
      if (d > 1) continue;
      if (d > 0.74) {
        put(surface, ox + x, oy + y, y < throatY ? ACCENT.sulphurPale : step(PALETTES.mud, 1));
        continue;
      }
      put(surface, ox + x, oy + y, step(PALETTES.mud, 0));
    }
  }
}

/** A dark andesite BOULDER: angular facets, cool, no warmth anywhere. */
function paintBoulder(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 71_000 + variant * 2003;
  const palette = PALETTES.rock;
  const centerX = width / 2;
  const centerY = height * 0.58;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.42);
      const dy = (y - centerY) / (height * 0.36);
      const wobble = fbm(x * 0.17 + variant * 9, y * 0.17, seed, 3) - 0.5;
      // Chebyshev-blended distance gives an ANGULAR block, not a pebble
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const radius = Math.max(ax, ay) * 0.66 + Math.hypot(dx, dy) * 0.34;
      if (radius > 0.92 + wobble * 0.30) continue;
      const facet = fbm(x * 0.10 + variant * 3, y * 0.14, seed + 7, 2);
      let index = level(palette, 0.30 + facet * 0.44 - dy * 0.42 - dx * 0.18);
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.90) index -= 1;
      const colour = fbm(x * 0.5, y * 0.20, seed + 13, 2) > 0.80
        ? ACCENT.lichenPale
        : step(palette, index);
      put(surface, ox + x, oy + y, colour);
    }
  }
}

/** A CRUST RING: broken concentric rings of mineral deposit lying on the ground. */
function paintCrustRing(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 73_000 + variant * 2111;
  const centerX = width / 2;
  const centerY = height * 0.56;
  const stone = PALETTES.sinter;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.44);
      const dy = (y - centerY) / (height * 0.32);
      const wobble = (fbm(x * 0.18 + variant * 7, y * 0.18, seed, 3) - 0.5) * 0.22;
      const radius = Math.hypot(dx, dy) + wobble;
      if (radius > 1.0) continue;
      const ringRaw = radius * (2.6 + variant * 0.7);
      const ring = Math.floor(ringRaw);
      const within = ringRaw - ring;
      // the rings are BROKEN: crust is deposited, not drawn
      if (hash2(ring, Math.floor(Math.atan2(dy, dx) * 6), seed + 3) < 0.24) continue;
      if (within > 0.62) continue;
      let index = level(stone, 0.58 + (1 - radius) * 0.30);
      if (within < 0.16) index += 1;
      else if (within > 0.48) index -= 2;
      put(surface, ox + x, oy + y, step(stone, index));
    }
  }
}

/** A golden TUSSOCK: a fountain of arching blades with a few seed heads. */
function paintTussock(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 75_000 + variant * 2221;
  const palette = PALETTES.reed;
  const blades = 42 + variant * 10;
  const rootY = height - 3;
  for (let index = 0; index < blades; index += 1) {
    const rootX = width / 2 + (hash2(index, variant, seed) - 0.5) * width * 0.42;
    const length = Math.round(height * (0.44 + hash2(index, variant, seed + 3) * 0.50));
    const arch = (hash2(index, variant, seed + 5) - 0.5) * 13;
    const base = level(palette, 0.22 + hash2(index, variant, seed + 7) * 0.50);
    for (let s = 0; s < length; s += 1) {
      const t = s / length;
      const x = Math.round(rootX + arch * t * t);
      const y = rootY - s;
      put(surface, ox + x, oy + y, step(palette, base + Math.round(t * 2)));
      if (t < 0.5 && hash2(x, y, seed + 11) > 0.55) {
        put(surface, ox + x + 1, oy + y, step(palette, base - 1));
      }
    }
    if (hash2(index, variant, seed + 13) > 0.72) {
      const headY = rootY - length;
      const headX = Math.round(rootX + arch);
      for (let s = 0; s < 3; s += 1) put(surface, ox + headX, oy + headY - s, ACCENT.twig);
    }
  }
}

/** A broadleaf, conifer or shrub canopy: overlapping lobes, lit upper-left cap. */
function paintCanopy(surface, ox, oy, spec, variant, shape) {
  const { width, height } = spec;
  const seed = 77_000 + variant * 271 + spec.id.length * 37;
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
  for (let index = 0; index < shape.lobes; index += 1) {
    const angle = (index / shape.lobes) * Math.PI * 2 + variant * 0.7;
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
        put(
          surface, ox + x, oy + y,
          step(shape.leaf, level(shape.leaf, lit) + (clump > 0.60 ? 1 : clump < 0.40 ? -1 : 0)),
        );
      }
    }
  }
}

const CANOPY_SHAPES = Object.freeze({
  broadleaf: {
    leaf: CANOPY_LEAF,
    tiers: [0.78, 0.90, 1.0],
    crownY: 0.34, radiusX: 0.50, radiusY: 0.36, lobes: 8, lobeSpread: 0.46, lobeSize: 0.66,
    trunkFrom: 0.62, trunkWidth: 2.6, lean: 1.0,
  },
  conifer: {
    leaf: CONIFER_LEAF,
    tiers: [0.76, 0.88, 1.0],
    crownY: 0.38, radiusX: 0.40, radiusY: 0.44, lobes: 6, lobeSpread: 0.30, lobeSize: 0.62,
    trunkFrom: 0.82, trunkWidth: 2.2, lean: 0.4,
  },
  shrub: {
    leaf: CANOPY_LEAF,
    tiers: [0.74, 0.88, 1.0],
    crownY: 0.44, radiusX: 0.48, radiusY: 0.42, lobes: 6, lobeSpread: 0.42, lobeSize: 0.62,
    trunkFrom: 0.88, trunkWidth: 1.8, lean: 0.4,
  },
});

/**
 * A FLOWER DRIFT: a MASS, not scattered pixels. A soft-edged elliptical mound
 * of understorey with several hundred petals of one colourway packed into it,
 * densest at the heart, with the second colour appearing only at the margin.
 */
function paintFlowerDrift(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 79_000 + variant * 719;
  const colourways = [
    [ACCENT.flowerYellow, ACCENT.flowerWhite],
    [ACCENT.flowerWhite, ACCENT.flowerYellow],
    [ACCENT.flowerPurple, ACCENT.flowerPurpleDeep],
  ];
  const [petal, secondary] = colourways[variant % 3];
  const centerX = width / 2;
  const centerY = height * 0.60;
  const radiusX = width * 0.46;
  const radiusY = height * 0.36;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const d = Math.hypot((x - centerX) / radiusX, (y - centerY) / radiusY);
      const edge = fbm(x * 0.18 + variant * 11, y * 0.18, seed, 3);
      if (d > 0.86 + edge * 0.36) continue;
      if (hash2(x, y, seed + 3) > 0.54) continue;
      const lit = 0.30 + (1 - d) * 0.38 + (edge - 0.5) * 0.5;
      put(surface, ox + x, oy + y, step(PALETTES.sungrass, level(PALETTES.sungrass, lit)));
    }
  }
  const count = 420;
  for (let index = 0; index < count; index += 1) {
    const angle = hash2(index, variant, seed + 5) * Math.PI * 2;
    const radius = Math.sqrt(hash2(index, variant, seed + 7));
    const x = Math.round(centerX + Math.cos(angle) * radiusX * radius);
    const y = Math.round(centerY + Math.sin(angle) * radiusY * radius);
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

/** A reed clump. `inWater` gets a broken reflection at the foot, not a shadow. */
function paintReedClump(surface, ox, oy, spec, variant, inWater) {
  const { width, height } = spec;
  const seed = 81_000 + variant * 419 + (inWater ? 97 : 0);
  const palette = PALETTES.reed;
  const stalks = 46 + variant * 8;
  for (let index = 0; index < stalks; index += 1) {
    const baseX = Math.round(width * (0.10 + hash2(index, variant, seed) * 0.80));
    const length = Math.round(height * (0.44 + hash2(index, variant, seed + 3) * 0.52));
    const bend = (hash2(index, variant, seed + 5) - 0.5) * 8;
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
    }
  }
  if (inWater) {
    for (let y = height - 3; y < height; y += 1) {
      for (let x = 2; x < width - 2; x += 1) {
        if (hash2(x, y, seed + 17) > 0.42) continue;
        put(surface, ox + x, oy + y, tone(PALETTES.pool, y === height - 3 ? 0.60 : 0.78));
      }
    }
  }
}

/**
 * One tile of BOARDWALK deck.
 *
 * The cross-section is the world atlas's causeway: two dark boards of rail, a
 * bright board catching the upper-left key light, the plank field, a darker
 * board on the shaded side, two more of rail - and then THE DECK'S OWN SHADOW,
 * laid on the water inside the same tile. That shadow is the whole reason a
 * deck reads as ABOVE the water rather than painted onto it.
 *
 * `vertical` swaps the two axes. The plank rhythm is 4px and the tile is 32px,
 * so boards line up across every seam of a span of any length.
 */
function paintWalkDeck(surface, ox, oy, spec, variant, vertical) {
  const seed = 83_000 + variant * 1117 + (vertical ? 331 : 0);
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across),
      DECK_SHADOW, alpha);
  };
  const size = spec.width;
  for (let along = 0; along < size; along += 1) {
    const plank = Math.floor(along / 4);
    const seam = along % 4 === 0;
    const worn = hash2(plank, variant, seed) > 0.58;
    const peg = along % 8 === 3;
    for (let across = 4; across <= 25; across += 1) {
      let colour;
      if (across <= 5 || across >= 24) colour = DECK.edge;
      else if (across === 6) colour = DECK.lit;
      else if (across === 23) colour = DECK.seam;
      else if (seam) colour = DECK.seam;
      else colour = worn ? DECK.fresh : DECK.body;
      if (across === 7 || across === 22) colour = DECK.edge;
      place(along, across, colour);
    }
    if (peg) {
      place(along, 8, DECK.edge);
      place(along, 21, DECK.edge);
    }
    // the deck's own shadow on the water, cast down-right with the key light
    const falloff = [0.66, 0.52, 0.38, 0.22];
    for (let s = 0; s < falloff.length; s += 1) shade(along, 26 + s, falloff[s]);
    shade(along, 3, 0.30);
    shade(along, 2, 0.14);
  }
}

/** A boardwalk landing: symmetric along travel, so one frame serves both ends. */
function paintWalkRamp(surface, ox, oy, spec, variant, vertical) {
  const seed = 85_000 + variant * 1439;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const size = spec.width;
  for (let along = 0; along < size; along += 1) {
    const middle = 1 - Math.abs(along - (size - 1) / 2) / ((size - 1) / 2);
    const spread = Math.round(middle * 3);
    const from = 4 - spread;
    const to = 25 + spread;
    const nosing = along === 3 || along === size - 4;
    for (let across = Math.max(0, from); across <= Math.min(size - 1, to); across += 1) {
      let colour;
      if (across <= from + 1 || across >= to - 1) colour = DECK.edge;
      else if (across === from + 2) colour = DECK.lit;
      else if (nosing) colour = DECK.fresh;
      else if (along % 5 === 0) colour = DECK.seam;
      else colour = hash2(Math.floor(along / 5), variant, seed) > 0.5 ? DECK.fresh : DECK.body;
      place(along, across, colour);
    }
    // sinter grit trodden off the landing onto the ground beside it
    const grit = tone(PALETTES.sinter, 0.34 + hash2(along, variant, seed + 7) * 0.40);
    for (let bleed = 1; bleed <= 3; bleed += 1) {
      if (hash2(along, bleed, seed + 11) > 0.34 + bleed * 0.14) {
        place(along, Math.max(0, from - bleed), grit);
        place(along, Math.min(size - 1, to + bleed), grit);
      }
    }
    veil(surface, ox + (vertical ? Math.min(size - 1, to + 1) : along),
      oy + (vertical ? along : Math.min(size - 1, to + 1)), DECK_SHADOW, 0.5);
  }
  for (const end of [1, size - 2]) {
    for (let across = 5; across <= 24; across += 1) place(end, across, DECK.edge);
  }
}

/** A handrail upright, laid over a deck tile, with its shadow on the planks. */
function paintWalkPost(surface, ox, oy, spec, variant) {
  const seed = 87_000 + variant * 1553;
  const at = 11 + Math.floor(hash2(variant, 1, seed) * 8);
  for (const across of [6, 23]) {
    const height = across === 6 ? 10 : 8;
    for (let rise = 0; rise < height; rise += 1) {
      for (let width = 0; width < 3; width += 1) {
        const colour = width === 0 ? DECK.lit : width === 2 ? DECK.edge : DECK.body;
        put(surface, ox + at + width, oy + across - rise, colour);
      }
    }
    put(surface, ox + at, oy + across - height, DECK.fresh);
    put(surface, ox + at + 1, oy + across - height, DECK.seam);
    for (let cast = 1; cast <= 5; cast += 1) {
      veil(surface, ox + at + 3 + cast, oy + across + 1, DECK_SHADOW, 0.5 - cast * 0.08);
    }
  }
}

/** A stepping block of sinter: chunky, lit on top, sat in its own shadow. */
function paintSinterStep(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 89_000 + variant * 1009;
  const stone = PALETTES.sinter;
  const centerX = width / 2;
  const centerY = height * 0.52;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.40);
      const dy = (y - centerY) / (height * 0.30);
      const wobble = fbm(x * 0.28 + variant * 4, y * 0.28, seed, 2) - 0.5;
      const radius = Math.max(Math.abs(dx), Math.abs(dy)) * 0.70 + Math.hypot(dx, dy) * 0.30;
      if (radius > 0.92 + wobble * 0.24) continue;
      let index = level(stone, 0.62 - dy * 0.40);
      if (dy > 0.55) index -= 2;
      if (hash2(chunky(x), chunky(y), seed + 3) > 0.84) index -= 1;
      put(surface, ox + x, oy + y, step(stone, index));
    }
  }
}

/** A bleached DRIFTLOG, in sinter's pale tones - everything here is mineral. */
function paintDriftLog(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 91_000 + variant * 811;
  const stone = PALETTES.sinter;
  for (let x = 2; x < width - 2; x += 1) {
    const t = x / width;
    const centerY = height * 0.56 + Math.sin(t * 2.4 + variant) * 2.2;
    const thickness = 2.6 + Math.sin(t * Math.PI) * 2.4;
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      const lit = 0.72 - (dy / thickness) * 0.46 + (fbm(x * 0.5, dy * 0.6, seed, 2) - 0.5) * 0.5;
      put(surface, ox + x, oy + Math.round(centerY + dy), step(stone, level(stone, lit)));
    }
    if (hash2(x, variant, seed + 3) > 0.86) {
      put(surface, ox + x, oy + Math.round(centerY), ACCENT.twig);
    }
  }
}

/** Scenery sheet width. Frames are shelf-packed in spec order. */
const SCENERY_COLUMNS = 480;
const SCENERY_ROWS = 640;

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
      // Every prop except the ones that ARE ground, or carry their own relief,
      // gets a contact shadow FIRST, so the sprite sits in it, not on it.
      const carriesOwnShadow = spec.id.startsWith("rim")
        || spec.id.startsWith("walk")
        || spec.id.startsWith("steam")
        || spec.id === "sintercone"
        || spec.id === "crustring"
        || spec.id === "reedwater";
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = spec.pivot;
        paintContactShadow(
          surface, ox, oy, pivotX, pivotY + 2,
          Math.max(5, spec.width * 0.30),
          Math.max(3, spec.height * 0.075),
          spec.id === "flowerdrift" || spec.id === "tussock" ? 0.28 : 0.46,
        );
      }
      switch (spec.id) {
        case "steam":
        case "steamsmall":
          paintSteam(surface, ox, oy, spec, variant);
          break;
        case "rimface":
          paintTerraceRim(surface, ox, oy, spec, variant, 0);
          break;
        case "rimcornerout":
          paintTerraceRim(surface, ox, oy, spec, variant, 1);
          break;
        case "rimcornerin":
          paintTerraceRim(surface, ox, oy, spec, variant, -1);
          break;
        case "sintercone":
          paintSinterCone(surface, ox, oy, spec, variant);
          break;
        case "mudpot":
          paintMudPot(surface, ox, oy, spec, variant);
          break;
        case "fumarole":
          paintFumarole(surface, ox, oy, spec, variant);
          break;
        case "boulder":
          paintBoulder(surface, ox, oy, spec, variant);
          break;
        case "crustring":
          paintCrustRing(surface, ox, oy, spec, variant);
          break;
        case "tussock":
          paintTussock(surface, ox, oy, spec, variant);
          break;
        case "shrub":
        case "conifer":
        case "broadleaf":
          paintCanopy(surface, ox, oy, spec, variant, CANOPY_SHAPES[spec.id]);
          break;
        case "flowerdrift":
          paintFlowerDrift(surface, ox, oy, spec, variant);
          break;
        case "reedclump":
          paintReedClump(surface, ox, oy, spec, variant, false);
          break;
        case "reedwater":
          paintReedClump(surface, ox, oy, spec, variant, true);
          break;
        case "walkh":
          paintWalkDeck(surface, ox, oy, spec, variant, false);
          break;
        case "walkv":
          paintWalkDeck(surface, ox, oy, spec, variant, true);
          break;
        case "walkpost":
          paintWalkPost(surface, ox, oy, spec, variant);
          break;
        case "walkramph":
          paintWalkRamp(surface, ox, oy, spec, variant, false);
          break;
        case "walkrampv":
          paintWalkRamp(surface, ox, oy, spec, variant, true);
          break;
        case "sinterstep":
          paintSinterStep(surface, ox, oy, spec, variant);
          break;
        case "driftlog":
          paintDriftLog(surface, ox, oy, spec, variant);
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
// output (verbatim from the Nirvana pilot)
// ---------------------------------------------------------------------------

/**
 * Encode a surface as an 8-bit INDEXED PNG, losslessly.
 *
 * Not the same thing as quantisation. `sharp`'s `palette: true` runs
 * libimagequant, which REMAPS colours. Here the palette is not derived, it is
 * DISCOVERED: because every painter chooses a fixed palette entry, the sheet
 * already contains fewer than 256 distinct RGBA tuples, so an exact palette
 * exists and every pixel maps to it with zero error. Overflowing 256 is a hard
 * error - the discipline enforcing itself mechanically.
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

  // Filter NONE: measured on the Nirvana sheet it beats Sub, Up, Paeth and an
  // adaptive per-row choice by 20-26%. Delta filters help photographs; on a
  // palette index they destroy the symbol distribution deflate exploits.
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

export async function authorWarmSpringsPilotArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const terrain = buildTerrainAtlas();
  const scenery = buildSceneryAtlas();
  const terrainInfo = await writeSurface(terrain.surface, path.join(outputRoot, "terrain.png"));
  const sceneryInfo = await writeSurface(scenery.surface, path.join(outputRoot, "scenery.png"));
  const atlas = {
    schema: 2,
    tileSize: TILE,
    region: "warm-springs",
    // The full contract stack, priority order, INCLUDING deck at index 13.
    materials: MATERIALS,
    // The thirteen the corner field may sample. `deck` is never sampled.
    fieldMaterials: FIELD_MATERIALS,
    blockingMaterials: BLOCKING_MATERIALS,
    shoreMaterials: SHORE_MATERIALS,
    waterMaterials: WATER_MATERIALS,
    grassMaterials: GRASS_MATERIALS,
    // Declared, not assumed: the contract's prose and the Nirvana pilot disagree
    // about which bit is SW and which is SE. This sheet is drawn Nirvana's way.
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
    // Terrain frames are a uniform grid - 16 columns of 32px cells, row major -
    // so their rects are DERIVABLE and only the id order is data. A per-frame
    // rect table cost 111 bytes a frame; this costs 19, and metadata counts
    // against the region kit's byte ceiling.
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
  await writeFile(path.join(outputRoot, "atlas.json"), `${JSON.stringify(atlas)}\n`, "utf8");
  return { ...atlas, frames: [...terrain.records, ...scenery.records] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorWarmSpringsPilotArt()
    .then(async (atlas) => {
      const { stat } = await import("node:fs/promises");
      const json = await stat(path.join(DEFAULT_OUTPUT_ROOT, "atlas.json"));
      const art = atlas.images.terrain.bytes + atlas.images.scenery.bytes;
      const total = art + json.size;
      const terrainFrames = atlas.terrainGrid.ids.length;
      const sceneryFrames = atlas.sceneryFrames.length;
      process.stdout.write(
        `authored ${atlas.frames.length} Warm Springs pilot frames`
        + ` (${terrainFrames} terrain + ${sceneryFrames} scenery)\n`
        + `  terrain ${atlas.images.terrain.width}x${atlas.images.terrain.height} `
        + `${atlas.images.terrain.bytes} B, ${atlas.images.terrain.colours} colours, `
        + `${atlas.images.terrain.encoding}\n`
        + `  scenery ${atlas.images.scenery.width}x${atlas.images.scenery.height} `
        + `${atlas.images.scenery.bytes} B, ${atlas.images.scenery.colours} colours, `
        + `${atlas.images.scenery.encoding}\n`
        + `  atlas.json ${json.size} B\n`
        + `  art total ${art} B; +metadata = ${total} B\n`
        + `  target 175000 -> ${(total / 175_000 * 100).toFixed(1)}% used\n`
        + `  region ceiling 196608 -> ${(total / 196_608 * 100).toFixed(1)}% used\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
