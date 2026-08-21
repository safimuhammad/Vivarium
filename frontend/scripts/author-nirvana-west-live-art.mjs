/**
 * Authors the NIRVANA WEST design-pilot tile vocabulary — the ash-waste /
 * "nuclear wasteland, all but dead" region.
 *
 * Sibling of `author-warm-springs-pilot-art.mjs`, which is the approved
 * template and is never modified. This file copies its proven machinery
 * (the corner-mask Wang alpha field, the shelf packer, the indexed-PNG
 * encoder, the losslessness assertion, the byte report) and replaces the
 * AESTHETICS with the frozen material contract in
 * `src/qa/nirvanaWestPilot/nirvanaWestMaterials.ts`.
 *
 * What it emits (into `src/qa/nirvanaWestPilot/assets/`):
 *   terrain.png  - 104 base fills (13 corner-field materials x 8), 252
 *                  corner-mask transition frames, 84 rim-line frames on the
 *                  three bank materials against the void family. 440 frames.
 *   scenery.png  - charred trunks, slag rock, ash piles, bone-stones, a
 *                  snapped industrial pylon, glass shards, ember-wisp heat
 *                  shimmer and the fused-glass causeway kit.
 *   atlas.json   - schema 2, the same compact shape the Warm Springs pilot
 *                  writes: a derived `terrainGrid` plus `sceneryFrames`.
 *
 * Two disciplines carry over unchanged from the template:
 *
 * 1. TRANSITIONS ARE CORNER-BASED (Wang) WITH A PRIORITY STACK. Every tile
 *    samples the material field at its four CORNERS; the lowest-priority
 *    corner material fills the tile, and each higher material is overlaid
 *    with an alpha-cut edge frame keyed by which corners it owns. The alpha
 *    field (`edgeCoverage`) is windowed to zero on the tile border, so the
 *    boundary is continuous across seams. Do not change `edgeCoverage`.
 *
 * 2. EVERY PIXEL IS A FIXED PALETTE ENTRY. NO RAMP INTERPOLATION ANYWHERE.
 *    Lighting, shading and contact shadow are index arithmetic into a
 *    material's fixed colour list - step up, step down - never a blend.
 *    Alpha is quantised to four levels.
 *
 * CORNER-BIT CONVENTION: 1 = NW, 2 = NE, 4 = SE, 8 = SW. Declared in
 * atlas.json as `cornerBits` so the scene never has to guess.
 *
 * REGION IDENTITY: near-black rubble against bone-pale ash is the highest
 * value-contrast pairing in the world's four regions. `ember` is the one
 * saturated hot accent in the darkest region. Fixed limited palette per
 * material - see the PALETTES block below for the frozen swatches.
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
  "../src/assets/renderer2d/regions/.nirvana-west-v1-staging",
);

export const TILE = 32;

// ---------------------------------------------------------------------------
// the frozen material contract - MUST mirror NirvanaWestMaterials.ts exactly
//
// PRODUCTION EDITION. Differences from the approved pilot vocabulary, all of
// them decided by what composition B actually paints and by the owner's one
// change ("a bit more aggressive on industrialness"):
//
//   REMOVED  `brine` and `rime`. Composition B never emits either material -
//            they belonged to compositions A and C, which were not chosen. The
//            pilot report's own concern #2 asks for exactly this trim at
//            productionisation rather than carrying dead art forever. Removing
//            them returns 44 terrain cells, which is what pays for the two
//            additions below.
//   ADDED    `slab`  - poured concrete foundation apron. WALKABLE.
//   ADDED    `spoil` - tailings / slag-spill staining. WALKABLE.
//
// Both additions are GROUND EVIDENCE, and both are deliberately walkable, which
// is the whole reason they can be as large and as central as they are: a slab
// apron may run straight under a shelter plot without costing it. They are also
// the only RECTANGULAR thing in a region built entirely from fracture and
// noise, and a rectangle is the one shape a wasteland cannot make by itself -
// which is what makes "somebody built here" legible at a glance and, unlike the
// ruins themselves, still legible at island scale.
// ---------------------------------------------------------------------------

export const MATERIALS = Object.freeze([
  "ember",
  "emberdim",
  "glass",
  "cinder",
  "slatedark",
  "slate",
  "dust",
  "ash",
  "ashpale",
  "slab",
  "spoil",
  "clinker",
  "scree",
  "causeway",
]);

export const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

/** The thirteen materials the corner field may sample. `causeway` is not one. */
export const FIELD_MATERIALS = Object.freeze(MATERIALS.slice(0, 13));

/** Ground a body cannot cross. */
export const BLOCKING_MATERIALS = Object.freeze(["ember", "clinker", "scree"]);

/** Materials whose interiors read as "void" - a bank tile against these gets a rim line. */
export const VOID_MATERIALS = Object.freeze(["ember", "emberdim"]);

/** Bank materials that carry an authored rim line against the void family. */
export const RIM_MATERIALS = Object.freeze(["cinder", "ashpale", "clinker"]);

/** The five tonal tiers of one plain, dark to pale - the gradient that hides the 32px lattice. */
export const PLAIN_TIERS = Object.freeze(["cinder", "slatedark", "slate", "dust", "ash", "ashpale"]);

export const BASE_VARIANTS = 8;

/** Transition variants per material - FROZEN by the contract. MUST match the .ts file. */
export const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  ember: 1,
  emberdim: 1,
  glass: 2,
  cinder: 2,
  slatedark: 1,
  slate: 2,
  dust: 1,
  ash: 2,
  ashpale: 1,
  // The two built materials carry TWO transition variants each. They cover the
  // largest contiguous areas in the region after the plains themselves, and a
  // single transition variant on a large area is exactly how a tile lattice
  // becomes visible again.
  slab: 2,
  spoil: 2,
  clinker: 2,
  scree: 1,
  causeway: 0,
});

export function edgeVariantCount(material) {
  return EDGE_VARIANTS_BY_MATERIAL[material] ?? 1;
}

export const RIM_VARIANTS = 2;

/** Masks 1..14; mask 15 is full coverage and reuses the base fill. */
const EDGE_MASKS = Object.freeze(Array.from({ length: 14 }, (_unused, index) => index + 1));

// ---------------------------------------------------------------------------
// deterministic noise (verbatim from the Warm Springs pilot)
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

/** A contiguous window onto a shared family ramp. Unused by any Nirvana West
 * material (every tonal tier keeps its own authored swatches, not a shared
 * ramp) but kept for architectural parity with the template. */
function windowOf(family, from, to) {
  return Object.freeze(family.slice(from, to + 1));
}

/** Snap a noise coordinate to a 2px cluster: grain, not incompressible speckle. */
function chunky(value) {
  return Math.floor(value * 0.5) * 2;
}

/**
 * A DIRECTIONAL CONTOUR PARAMETER (verbatim technique from the template's
 * travertine banding). A linear ramp across a FIXED direction, bent by a slow
 * noise term, sliced at unit intervals - long parallel bands that meander
 * rather than the closed blobs a plain noise field gives.
 */
function contourOf(wx, wy, seed, pitch, meander, sway, angle) {
  const across = wx * Math.cos(angle) + wy * Math.sin(angle);
  return across * pitch + fbm(wx * meander, wy * meander, seed, 3) * sway;
}

/**
 * The direction slate's cleavage runs. A MATERIAL constant, never per-variant
 * - one shared angle keeps the foliation reading as one rock formation across
 * every base fill and every facet fracture, and the ash family runs its wind
 * ripples CROSSWISE to this same angle.
 */
const SLATE_ANGLE = 0.40;

/** Four alpha levels. A continuous alpha channel is a photograph too. */
const ALPHA_LEVELS = Object.freeze([0, 88, 172, 255]);

function quantiseAlpha(alpha) {
  return ALPHA_LEVELS[Math.round(clamp01(alpha) * (ALPHA_LEVELS.length - 1))];
}

// ---------------------------------------------------------------------------
// palettes - fixed swatches, dark to light. NO ramp interpolation anywhere.
// ---------------------------------------------------------------------------

const EMBER = Object.freeze([[122, 42, 58], [176, 58, 68], [228, 81, 74], [244, 113, 79], [255, 154, 92]]);
const EMBERDIM = Object.freeze([[51, 36, 44], [70, 46, 54], [94, 58, 64], [122, 74, 74]]);
/**
 * The COLD CRUST ramp. In the pilot this was the `brine` material's own
 * palette; `brine` is not part of the production vocabulary (composition B
 * never emits it), but `crustPixel` still needs a near-black violet ramp for
 * the welded, no-longer-venting stretches of a fissure floor, which is the
 * thing that gives the fire hot CHANNELS instead of an allover crackle.
 */
const CRUST_COLD = Object.freeze([[16, 12, 26], [23, 18, 35], [32, 26, 44], [42, 36, 56]]);
const GLASS = Object.freeze([[30, 26, 42], [40, 34, 52], [50, 44, 64]]);
/**
 * v2: desaturated off the cyan. v1's crazing was the one COOL-BLUE accent in
 * a violet-and-coral region; it fought the ember for attention and, worse, at
 * 1:1 the isoline shapes curled into little hooks that read as scattered
 * glyphs rather than as cracks in glass. Pale violet-grey, thinner, rarer.
 */
const GLASS_CRAZING = Object.freeze([[92, 96, 118], [136, 138, 158]]);
const CINDER = Object.freeze([[31, 29, 34], [40, 36, 43], [48, 44, 52], [57, 53, 62]]);
const SLATEDARK = Object.freeze([[62, 57, 68], [71, 65, 77], [80, 74, 87], [88, 81, 96]]);
const SLATE = Object.freeze([[94, 86, 102], [102, 94, 111], [111, 102, 121], [120, 110, 130]]);
const DUST = Object.freeze([[122, 113, 134], [135, 126, 147], [148, 138, 158], [161, 150, 171]]);
/**
 * v2: the ash family is WARMED and desaturated off the violet.
 *
 * v1's ash ran to a cold, near-white lilac, and at region scale the aprons read
 * as SNOW DRIFTS - large, bright, cold, cloud-shaped. The difference between
 * snow and ash to the eye is not brightness, it is temperature: ash is warm,
 * grey-bone, dusty. Dropping the top step and pulling the whole family toward
 * bone costs a little luminance range (which the new crack network gives back
 * at the dark end) and buys the single biggest change in what the region IS.
 */
const ASH = Object.freeze([[146, 138, 142], [164, 155, 156], [180, 171, 170], [194, 185, 182]]);
const ASHPALE = Object.freeze([[178, 170, 168], [194, 186, 182], [206, 199, 194], [218, 211, 205]]);
const CLINKER = Object.freeze([[27, 23, 30], [43, 37, 48], [65, 55, 72], [87, 74, 96]]);
const CLINKER_RUST = Object.freeze([107, 74, 94]);
const SCREE = Object.freeze([[47, 43, 52], [68, 62, 75], [94, 85, 104], [120, 109, 133]]);
/**
 * POURED CONCRETE, weathered. Warm-NEUTRAL on purpose: not one step of violet
 * anywhere in the ramp. Every natural material in this region is violet-slate
 * or bone; concrete is the only grey, which is what lets a slab read as
 * manufactured even where its VALUE overlaps `dust` and `ash`.
 */
const SLAB = Object.freeze([
  [96, 96, 94], [116, 116, 112], [136, 135, 130], [156, 155, 148], [176, 174, 166],
]);
/**
 * TAILINGS AND CHEMICAL SPILL. Rust and sulphur, held DARK and desaturated so
 * it never reads as a second hot accent beside `ember`. Its brightest step
 * (116) sits below `ember`'s darkest (122); the two can never be confused.
 */
const SPOIL = Object.freeze([
  [36, 28, 27], [56, 40, 35], [78, 54, 44], [100, 68, 52], [122, 84, 62],
]);
const CAUSEWAY = Object.freeze([[46, 39, 52], [59, 50, 66], [74, 64, 80]]);
const CAUSEWAY_GLEAM = Object.freeze([[143, 184, 196], [208, 230, 236]]);
const OUTLINE = Object.freeze([26, 22, 34]);

/** The bank's dark scorched/heat-stained rim colour, on ground that is not "hot". */
const SCORCH = Object.freeze([[20, 16, 26], [34, 26, 40], [50, 40, 58]]);

/** Heat-shimmer wisp - the last-pass overlay layer. Translucent, quantised alpha only. */
const WISP_BRIGHT = Object.freeze([214, 200, 210]);
const WISP_WARM = Object.freeze([196, 150, 140]);
const WISP_ALPHAS = Object.freeze([64, 128]);

const CAUSEWAY_SHADOW = Object.freeze([10, 8, 14]);

const PALETTES = Object.freeze({
  ember: EMBER,
  emberdim: EMBERDIM,
  glass: GLASS,
  cinder: CINDER,
  slatedark: SLATEDARK,
  slate: SLATE,
  dust: DUST,
  ash: ASH,
  ashpale: ASHPALE,
  slab: SLAB,
  spoil: SPOIL,
  clinker: CLINKER,
  scree: SCREE,
});

/** Accents. Each is a single fixed colour, never a blend target. */
const ACCENT = Object.freeze({
  shadow: OUTLINE,
  crust: ASHPALE[3],
  crustDim: ASHPALE[2],
});

/**
 * The bank's own dark rim ramp. `cinder` is special: it sits right against the
 * fissures it demotes from (`ember` -> `emberdim`, always walkable), so its
 * rim INVERTS the usual cool scorch to a hot fringe - the same move Warm
 * Springs' ochre makes at a pool edge - by stepping through EMBER itself
 * rather than through a dedicated cool ramp.
 */
const RIM_WET = Object.freeze({
  ashpale: SCORCH,
  clinker: SCORCH,
});

// ---------------------------------------------------------------------------
// angular facet field - shared by clinker, scree, rime and the slag scenery
// ---------------------------------------------------------------------------

/**
 * Irregular angular cells: each sample nearest a jittered, ROTATED, stretched
 * cell centre under a Chebyshev/Euclidean blend, so the breakup reads as
 * fractured facets and not round pebbles (the fix Warm Springs' rock needed
 * twice). Returns the nearest/second-nearest distances (their gap is the
 * joint width) plus the local frame so a caller can shade a facet's own tilt.
 */
function angularFacet(px, py, seed, cellSize) {
  let nearest = Infinity;
  let second = Infinity;
  let nearKey = 0;
  let secondKey = 0;
  let localX = 0;
  let localY = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const cx = Math.floor(px / cellSize) + dx;
      const cy = Math.floor(py / cellSize) + dy;
      const jx = (cx + hash2(cx, cy, seed + 83)) * cellSize;
      const jy = (cy + hash2(cx, cy, seed + 89)) * cellSize;
      const angle = hash2(cx, cy, seed + 91) * Math.PI;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const ux = (px - jx) * cos + (py - jy) * sin;
      const uy = -(px - jx) * sin + (py - jy) * cos;
      const stretch = 0.62 + hash2(cx, cy, seed + 93) * 0.85;
      const distance = Math.max(Math.abs(ux) / stretch, Math.abs(uy) * stretch);
      const key = (cx + 2048) * 8192 + (cy + 2048);
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

// ---------------------------------------------------------------------------
// BARRENNESS (v2) - the two fields that make dead ground read as dead
// ---------------------------------------------------------------------------

/**
 * HEAT-DESICCATION CRAZING. The single most important v2 addition.
 *
 * Ground that has been baked and has nothing growing in it does not stay
 * smooth: it splits. This returns a crack DEPTH (0 none, 1 shoulder, 2 the
 * crack itself) from an angular-facet network, gated by an `activation` field
 * so the cracks appear in PATCHES - crazed ground here, scoured-smooth ground
 * a few metres away - rather than as an allover mesh. The allover mesh is
 * exactly the failure the v1 `glass` material was sent back for; barrenness
 * has to be VARIED to read as a place rather than as a texture swatch.
 *
 * FREQUENCY FLOOR: every field here is >= 0.045 (period <= ~22 px). A tile is
 * 32 px and each of the 8 base variants samples a different window of the
 * field, so anything slower than that resolves to a per-variant CONSTANT and
 * paints an 8-tone 32 px checkerboard on the ground - the exact lattice this
 * whole tile system exists to hide. Do not lower these numbers.
 */
function crazing(wx, wy, seed, cellSize, openness) {
  const activation = fbm(wx * 0.095 + 7, wy * 0.095 - 4, seed + 301, 2);
  if (activation < openness) return 0;
  const strength = clamp01((activation - openness) * 5);
  const facet = angularFacet(wx, wy, seed + 307, cellSize);
  const joint = facet.second - facet.nearest;
  if (joint < 0.55 + strength * 0.75) return 2;
  if (joint < 1.6 + strength) return 1;
  return 0;
}

/**
 * SCOUR. Where wind has stripped the ash cover back to the rock beneath, in
 * elongated patches running along the prevailing direction. Returns 0..1
 * ash-cover; low means bare ground shows through. This replaces v1's
 * per-pixel "show-through" flecks, which laid isolated dark SQUARES on the
 * ash and read as dropped litter rather than as ground being uncovered.
 */
function scourCover(wx, wy, seed) {
  const angle = SLATE_ANGLE + Math.PI / 2;
  const ax = wx * Math.cos(angle) + wy * Math.sin(angle);
  const ay = -wx * Math.sin(angle) + wy * Math.cos(angle);
  // Only mildly anisotropic. A strong stretch ratio made every scour patch a
  // long diagonal lane at the same bearing, and 8 tile variants of that read
  // as woven tweed rather than as ground.
  return fbm(ax * 0.062, ay * 0.098, seed + 401, 3);
}

// ---------------------------------------------------------------------------
// per-material pixel painters - every return value is a palette entry
// ---------------------------------------------------------------------------

/**
 * A crust of dark polygonal plates floating on the fissure floor, with hot
 * seams between them. `seamPalette` is EMBER for the molten floor (bright
 * coral seams) and EMBERDIM for the cooled/welded seam (dull maroon) - the
 * SAME crust geometry with the heat gone, per the brief.
 */
function crustPixel(seamPalette, wx, wy, seed) {
  const facet = angularFacet(wx, wy, seed, 11);
  const joint = facet.second - facet.nearest;
  // v2: NOT EVERY SEAM IS OPEN. v1 lit every joint in the network equally, so
  // a fissure floor was a uniform allover coral crackle - a texture rather
  // than a fire. A vent field decides which stretches of the crust are still
  // venting; elsewhere the seam has welded shut and reads as a cold black
  // crack. That gives the floor hot CHANNELS with dead crust between them,
  // which is both what cooling lava looks like and what gives the animated
  // flame layer somewhere specific to belong.
  const vent = fbm(wx * 0.07 + 13, wy * 0.07 - 6, seed + 121, 2);
  if (joint < 1.15) {
    const heat = clamp01(1 - joint / 1.15);
    if (vent > 0.46) {
      const open = clamp01((vent - 0.46) * 3.4);
      return step(seamPalette, level(seamPalette, 0.10 + heat * (0.42 + open * 0.58)));
    }
    // Welded shut: the crack is still there, but it is cold.
    return step(CRUST_COLD, level(CRUST_COLD, 0.30 + heat * 0.45));
  }
  // The plates themselves: near-black chilled crust, each plate its own value,
  // with a faint warm underglow only where the vent field is strongest.
  let index = level(CRUST_COLD, 0.02 + hash2(facet.nearKey, 3, seed + 111) * 0.30);
  if (hash2(chunky(wx), chunky(wy), seed + 113) > 0.90) index += 1;
  if (vent > 0.72 && joint < 2.3 && hash2(chunky(wx), chunky(wy), seed + 117) > 0.72) {
    return step(seamPalette, 0);
  }
  return step(CRUST_COLD, index);
}

/**
 * POURED CONCRETE APRON - the foundation slab of a building that is no longer
 * there, and the hardstanding a plant was laid on.
 *
 * This is the single most legible "somebody built here" cue available at
 * TERRAIN level, and the reason is geometric rather than tonal: it is the only
 * STRAIGHT thing in a region generated entirely from fracture noise. So the
 * work here goes into straightness, not into colour —
 *
 *  - **construction joints** on an orthogonal 16 px grid in world space, one
 *    palette step darker, eroded so roughly half of any joint run survives;
 *  - a **crazing network** over the top (`crazing`, the same field every plain
 *    tier uses) so the concrete reads as broken rather than as a clean floor;
 *  - **aggregate** speckle at 2 px chunks;
 *  - **weathering blotches** at a frequency inside the floor, so a slab is
 *    never one flat tone.
 *
 * The joints deliberately do NOT line up between adjacent tiles: the 8 base
 * variants each sample a different window (`variant * 61.5`), which is exactly
 * how the lattice is hidden everywhere else in this sheet. Real hardstanding is
 * cast in independent bays, so a phase break between bays is correct rather
 * than a compromise.
 *
 * Palette is warm-NEUTRAL: no violet at all. That is what separates it from
 * `slate`/`dust` (violet) and from `ash` (warm but bright and organic) at
 * every scale including the world map.
 */
function slabPixel(wx, wy, seed) {
  const weather = fbm(wx * 0.052, wy * 0.052, seed + 111, 3);
  let index = level(SLAB, 0.34 + weather * 0.52);

  // Aggregate: fine, dense, low contrast. Concrete is a speckled material.
  if (hash2(chunky(wx), chunky(wy), seed + 113) > 0.82) index += 1;
  else if (hash2(chunky(wx), chunky(wy), seed + 117) > 0.86) index -= 1;

  // Construction joints, both axes, 16 px pitch, eroded.
  const jointX = Math.abs(((wx % 16) + 16) % 16);
  const jointY = Math.abs(((wy % 16) + 16) % 16);
  const onJointX = jointX < 1 && hash2(0, chunky(wy), seed + 119) > 0.42;
  const onJointY = jointY < 1 && hash2(chunky(wx), 0, seed + 123) > 0.42;
  if (onJointX || onJointY) index -= 2;

  // Crazing: the slab is broken. Larger cells than the plains use, because a
  // concrete bay cracks into a few big pieces rather than into a fine mesh.
  const crack = crazing(wx, wy, seed + 127, 13, 0.42);
  if (crack === 2) index -= 3;
  else if (crack === 1) index -= 1;

  // Chemical staining bleeding across the pad. Kept to the darkest slab steps
  // rather than given its own hue, so it never becomes a second accent colour.
  const stain = fbm(wx * 0.048 - 13, wy * 0.048 + 5, seed + 131, 3);
  if (stain > 0.78) index -= 2;

  return step(SLAB, index);
}

/**
 * TAILINGS AND SPILL - the ground a works poisoned around itself.
 *
 * Granular lumpy heap material, rust and sulphur brown, run through with darker
 * wet-looking channels where it has slumped and drained. Deliberately DARK and
 * DESATURATED: it has to read as an industrial stain without ever competing
 * with `ember`, which is the region's one saturated hot accent and lives two
 * hundred value points above this.
 *
 * Walkable, like the slab. Both of the added materials are ground evidence, and
 * ground evidence that blocked would cost shelter plots for nothing.
 */
function spoilPixel(wx, wy, seed) {
  const cellSize = 6;
  const facet = angularFacet(wx, wy, seed + 141, cellSize);
  // Lump tone from the facet's own key: a heap is made of clods, not of noise.
  let index = level(SPOIL, 0.24 + hash2(facet.nearKey, 3, seed + 143) * 0.62);

  // Lit top / shaded lee of each clod, keyed upper-left like every raised thing
  // in this world.
  index += facet.localY < -cellSize * 0.16 ? 1 : facet.localY > cellSize * 0.18 ? -1 : 0;

  // Drainage runs: where the spoil has slumped and the fines have washed out.
  const run = contourOf(wx, wy, seed + 147, 0.058, 0.075, 3.4, SLATE_ANGLE + 1.1);
  const inRun = Math.abs(((run % 1) + 1) % 1 - 0.5) < 0.13;
  if (inRun) index -= 2;

  // Sulphur bloom - a few pale grains, never a highlight field.
  if (hash2(chunky(wx), chunky(wy), seed + 149) > 0.955) return step(SPOIL, SPOIL.length - 1);
  if (hash2(chunky(wx), chunky(wy), seed + 151) > 0.88) index -= 1;

  return step(SPOIL, index);
}

/**
 * A vitrified sheet. Near-black DOMINATES - a broad low-frequency sheen only,
 * cut by a SPARSE network of hairline pale cyan-white crazing cracks (~10%
 * coverage). An `activation` field confines the cracks to isolated branching
 * patches with large unbroken black areas between them, rather than an
 * allover mesh.
 */
function glassPixel(wx, wy, seed) {
  const sheen = fbm(wx * 0.045, wy * 0.045, seed + 81, 3);
  let index = level(GLASS, 0.30 + sheen * 0.6);
  const activation = fbm(wx * 0.055 + 3, wy * 0.055 - 9, seed + 79, 2);
  if (activation > 0.74) {
    const crack = fbm(wx * 0.032 + 11, wy * 0.032 - 7, seed + 83, 3);
    const branch = fbm(wx * 0.07 - 5, wy * 0.07 + 3, seed + 89, 2);
    const vein = Math.abs(crack - 0.5) + Math.max(0, Math.abs(branch - 0.5) - 0.30) * 0.5;
    if (vein < 0.005) return GLASS_CRAZING[1];
    if (vein < 0.011) return GLASS_CRAZING[0];
  }
  // Bubbled/frothed vitrification - the ground boiled before it froze.
  const froth = crazing(wx, wy, seed + 93, 7, 0.60);
  if (froth === 2) index -= 1;
  else if (froth === 1) index += 1;
  if (hash2(chunky(wx), chunky(wy), seed + 91) > 0.92) index -= 1;
  return step(GLASS, index);
}

/**
 * Burnt pan. v2: the same near-black mottle and grit, now SPLIT. Baked ground
 * with no root system in it crazes into small plates; here the crack is warm-
 * dark rather than cool, because this is the scorch ring immediately outside a
 * fissure and the splits go down toward the heat. A thin bone-ash dusting
 * catches on the raised plate centres, so the pan reads as burnt EARTH rather
 * than as a dark grey.
 */
function cinderPixel(wx, wy, seed) {
  const mott = fbm(wx * 0.09, wy * 0.09, seed + 61, 3);
  let index = level(CINDER, 0.15 + mott * 0.75);
  const grit = hash2(chunky(wx), chunky(wy), seed + 67);
  if (grit > 0.86) index -= 2;
  else if (grit < 0.12) index += 1;
  const split = crazing(wx, wy, seed + 71, 10, 0.34);
  if (split === 2) return hash2(chunky(wx), chunky(wy), seed + 73) > 0.72 ? SCORCH[1] : SCORCH[0];
  if (split === 1) index -= 2;
  else if (fbm(wx * 0.11, wy * 0.11, seed + 77, 2) > 0.70
    && hash2(chunky(wx), chunky(wy), seed + 79) > 0.86) {
    index += 2;
  }
  if (hash2(Math.floor(wx), Math.floor(wy), seed + 69) > 0.975) return OUTLINE;
  return step(CINDER, index);
}

/**
 * PLATY foliated slate - the anchor material. Fine parallel cleavage lines at
 * ONE fixed shallow angle (`SLATE_ANGLE`, shared by every facet so the ground
 * reads as one broken rock rather than many), STRAIGHT rather than meandering
 * (a small `sway` keeps the stripes from curling into mush), with a wide lit
 * / shaded band pair so the alternating stripes are unmistakable at 1:1, cut
 * by occasional cross-fractures that break the plane into flat angular
 * facets.
 */
function platyPixel(palette, wx, wy, seed) {
  const raw = contourOf(wx, wy, seed + 21, 0.34, 0.012, 0.8, SLATE_ANGLE);
  const band = Math.floor(raw);
  const within = raw - band;
  let index = level(palette, 0.42 + (hash2(band, 3, seed + 27) - 0.5) * 0.60);
  if (within < 0.34) index += 1;
  else if (within > 0.66) index -= 2;
  const fracture = Math.abs(fbm(wx * 0.045, wy * 0.045, seed + 31, 2) - 0.5);
  if (fracture < 0.014) index -= 3;
  else if (fracture < 0.028) index -= 1;
  const grain = hash2(chunky(wx), chunky(wy), seed + 37);
  if (grain > 0.92) index -= 1;
  else if (grain < 0.06) index += 1;
  // v2 BARRENNESS: the plain splits, but only in PATCHES. An allover crack
  // mesh reads as elephant hide and re-flattens the ground into one texture;
  // what makes barren land feel barren is that some of it has split and some
  // of it has been scoured smooth, within sight of each other.
  const split = crazing(wx, wy, seed + 47, 16, 0.62);
  if (split === 2) {
    return hash2(chunky(wx), chunky(wy), seed + 51) > 0.72
      ? SCORCH[2]
      : step(palette, index - 3);
  }
  if (split === 1) {
    return step(palette, hash2(chunky(wx), chunky(wy), seed + 53) > 0.62 ? index + 1 : index - 1);
  }
  return step(palette, index);
}

/**
 * Soft wind-worked ash: SHORT, DISCONTINUOUS ripple runs crosswise to the
 * slate grain - real ash is blown and scoured, not deposited in continuous
 * terrace bands, so a `run` gate breaks the contour into patches and lets it
 * drop out entirely over bare scoured ground. Fine powdery grain, and
 * (dust/ash only) rare bare-slate show-through as small elongated flecks
 * ALONG the ripple direction rather than dropped-on-fabric dots.
 */
function windAshPixel(palette, wx, wy, seed, beneath) {
  const angle = SLATE_ANGLE + Math.PI / 2;
  const raw = contourOf(wx, wy, seed + 41, 0.26, 0.05, 2.6, angle);
  const band = Math.floor(raw);
  const within = raw - band;
  // v2: the run gate is much harder (0.38 -> 0.56) and the ripple contrast
  // doubled. v1's ripples were continuous, evenly spaced and low-contrast,
  // which is what made the ash family read as QUILTING - a stitched duvet.
  // Blown ash is deposited in short broken runs with bare ground between them.
  const run = fbm(wx * 0.058 + Math.cos(angle) * 3, wy * 0.058 + Math.sin(angle) * 3, seed + 59, 2);
  let index = level(palette, 0.50 + (hash2(band, 5, seed + 47) - 0.5) * 0.30);
  if (run > 0.60) {
    if (within < 0.22) index += 1;
    else if (within > 0.76) index -= 1;
  }
  // Powder grain, clustered at 2 px so it is grain rather than static. Ash is
  // a POWDER: this granularity is what stops the tier reading as fabric, and
  // it is deliberately the dominant texture rather than the ripple.
  const powder = fbm(chunky(wx) * 0.34, chunky(wy) * 0.34, seed + 51, 2);
  if (powder > 0.78) index += 1;
  else if (powder < 0.22) index -= 1;
  if (hash2(chunky(wx), chunky(wy), seed + 55) > 0.90) index -= 1;
  // v2 SCOUR: long shallow patches where the wind has thinned the cover back
  // toward the rock, ALONG the ripple direction. It uncovers the tier one step
  // below this one, never the near-black slate - v1 dropped SLATEDARK into
  // ASHPALE and the result read as bird-lime on a clean surface rather than as
  // ground being uncovered. The transition is a two-stage dither so the patch
  // has a frayed edge instead of a cut one.
  // v2 SCOUR, and the lesson that produced its final form: a 32 px tile is too
  // small to hold "a patch of ground the wind has uncovered". Every attempt to
  // reveal the tier BELOW inside a tile - however soft the threshold, however
  // isotropic the field - resolved into small dark blotches repeating on the
  // tile lattice, which read as tweed. Large-scale variety in this system is
  // the FIELD's job (the composition already interleaves ashpale/ash/dust/
  // slate across the plain); a tile's job is grain. So the scour survives only
  // as a thinning of the ash's OWN value, never as a second material.
  if (beneath !== null && scourCover(wx, wy, seed) < 0.34) index -= 2;
  // Even under full cover the ash is not a sheet: it has crusted and the crust
  // has broken. The break is a fine dark hairline with a pale lifted lip.
  const split = crazing(wx, wy, seed + 61, 12, 0.66);
  if (split === 2) return step(palette, index - 3);
  if (split === 1) index += 1;
  return step(palette, index);
}

/**
 * Slag reef and joint rubble: angular fractured blocks, sharp facets, NO
 * mortar joints and NO rounded cobbles. Weld rate is kept low so joints stay
 * visible (a welded lattice was the earlier cobblestone failure), and the
 * facet's own hash spans the FULL palette so adjacent blocks read as
 * genuinely different pieces. A faint rust-violet rime in the recesses.
 */
function clinkerPixel(wx, wy, seed) {
  const facet = angularFacet(wx, wy, seed, 13);
  const low = Math.min(facet.nearKey, facet.secondKey);
  const high = Math.max(facet.nearKey, facet.secondKey);
  const welded = hash2(low, high, seed + 107) < 0.28;
  const blockKey = welded ? low : facet.nearKey;
  let index = level(CLINKER, hash2(blockKey, 3, seed + 97));
  index += facet.localY < -13 * 0.20 ? 1 : facet.localY > 13 * 0.22 ? -1 : 0;
  if (facet.localX < -13 * 0.28) index += 1;
  const joint = facet.second - facet.nearest;
  if (!welded) {
    if (joint < 1.1) index -= 3;
    else if (joint < 2.4) index -= 1;
  }
  if (hash2(chunky(wx), chunky(wy), seed + 101) > 0.88) index -= 1;
  if (!welded && joint < 1.4 && hash2(Math.floor(wx), Math.floor(wy), seed + 103) > 0.90) {
    return CLINKER_RUST;
  }
  return step(CLINKER, index);
}

/** A field of broken slate shards on edge: smaller cells, mostly UNWELDED, dark gaps. */
function screePixel(wx, wy, seed) {
  const cellSize = 8;
  const facet = angularFacet(wx, wy, seed, cellSize);
  const low = Math.min(facet.nearKey, facet.secondKey);
  const high = Math.max(facet.nearKey, facet.secondKey);
  const welded = hash2(low, high, seed + 151) < 0.15;
  const blockKey = welded ? low : facet.nearKey;
  let index = level(SCREE, hash2(blockKey, 5, seed + 131));
  const tiltAcross = facet.localX * Math.cos(SLATE_ANGLE) + facet.localY * Math.sin(SLATE_ANGLE);
  index += tiltAcross < 0 ? 1 : -1;
  const joint = facet.second - facet.nearest;
  if (!welded) {
    if (joint < 1.3) return step(SCREE, 0);
    if (joint < 2.2) index -= 2;
  }
  if (hash2(chunky(wx), chunky(wy), seed + 141) > 0.90) index -= 1;
  return step(SCREE, index);
}

export function materialPixel(material, wx, wy, seed) {
  switch (material) {
    case "ember":
      return crustPixel(EMBER, wx, wy, seed);
    case "emberdim":
      return crustPixel(EMBERDIM, wx, wy, seed);
    case "slab":
      return slabPixel(wx, wy, seed);
    case "spoil":
      return spoilPixel(wx, wy, seed);
    case "glass":
      return glassPixel(wx, wy, seed);
    case "cinder":
      return cinderPixel(wx, wy, seed);
    case "slatedark":
      return platyPixel(SLATEDARK, wx, wy, seed);
    case "slate":
      return platyPixel(SLATE, wx, wy, seed);
    // Each ash tier is a COVER over the tier below it, and the wind scours it
    // back to that tier - never straight to the near-black slate, which is
    // what made v1's show-through read as litter.
    case "dust":
      return windAshPixel(DUST, wx, wy, seed, SLATEDARK);
    case "ash":
      return windAshPixel(ASH, wx, wy, seed, SLATE);
    case "ashpale":
      return windAshPixel(ASHPALE, wx, wy, seed, DUST);
    case "clinker":
      return clinkerPixel(wx, wy, seed);
    case "scree":
      return screePixel(wx, wy, seed);
    default:
      throw new Error(`unknown material ${material}`);
  }
}

// ---------------------------------------------------------------------------
// surface helpers (verbatim from the Warm Springs pilot)
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
 * Corner-mask alpha field. Bit order: 1 = NW, 2 = NE, 4 = SE, 8 = SW.
 * Perturbation is windowed to zero on the tile border, so the boundary joins
 * exactly across tile seams. DO NOT CHANGE.
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

/** The seed for one transition. The rim set MUST reuse it. */
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

const EDGE_STYLE = Object.freeze({
  ember: { drop: [2, 1], speck: 0.80 },
  clinker: { drop: [2, 1], speck: 0.84 },
  scree: { drop: [1, 1], speck: 0.86 },
  glass: { drop: [1, 1], speck: 0.94 },
  // The slab's own edge is a BROKEN CONCRETE EDGE — a hard shoulder with
  // spalled crumbs, not a soft dissolve. It is the one boundary in the region
  // that should look cut rather than grown.
  slab: { drop: [2, 1], speck: 0.78 },
  spoil: { drop: [1, 1], speck: 0.82 },
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
 * One RIM frame: where a bank material meets the void family (ember /
 * emberdim / brine). Laid over the bank's own transition frame and SHARES its
 * seed, so the rim rides exactly the bank's own contour.
 *
 * Bank side  - a dark scorched/heat-stained band, darkest right at the void.
 *              On `cinder` this inverts to a HOT fringe (brightest coral at
 *              the lip, cooling inward) by stepping through EMBER itself -
 *              the same move Warm Springs' ochre makes at a pool edge.
 * Void side  - a BROKEN pale crust line, in the region's palest tone.
 */
function paintRimTile(surface, originX, originY, material, mask, variant) {
  const seed = edgeSeed(material, mask, variant);
  const hot = material === "cinder";
  const palette = hot ? EMBER : RIM_WET[material];
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const field = edgeCoverage(mask, x, y, seed);
      if (field >= 0.505 && field < 0.72) {
        const depth = (field - 0.505) / 0.215;
        const damp = fbm((x + originX) * 0.36, (y + originY) * 0.36, seed + 197, 2);
        let colour;
        if (hot) {
          const heat = 0.46 + (1 - depth) * 0.54;
          colour = step(EMBER, level(EMBER, heat) + (damp > 0.66 ? 1 : -1));
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
        if (broken > 0.62 - near * 0.22) {
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
  for (const material of RIM_MATERIALS) {
    for (const mask of EDGE_MASKS) {
      for (let variant = 0; variant < RIM_VARIANTS; variant += 1) {
        frames.push({
          id: `w.${material}.${mask}.${variant}`,
          kind: "rim",
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
        paintRimTile(surface, originX, originY, frame.material, frame.mask, frame.variant);
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

/**
 * PRODUCTION scenery vocabulary.
 *
 * Retired from the pilot sheet, because composition B with the INDUSTRIAL kit
 * is what shipped and nothing else is reachable:
 *   `bonestone` / `rimecluster` — both gated on adjacency to `rime`, a material
 *       composition B never emits, so both were structurally unplaceable;
 *   `dunecrest` — composition A only;   `slabtilt` — composition C only;
 *   `monolith` / `slumpwall` / `boneforest` / `ashbarrow` — the ANCIENT ruin
 *       kit, which the owner did not choose.
 * Those twelve frame families are what pays for the eight added below.
 *
 * Added for the owner's one change — *"maybe a bit more aggressive on
 * industrialness"*. The governing idea is that industry reads as a COMPLEX,
 * not as a scatter of big objects: a plant is towers beside a turbine hall
 * beside a tank farm, standing on one apron, tied together by pipe runs, with
 * a pylon line walking away from it over the horizon. So the additions are
 * deliberately weighted toward RELATIONSHIP pieces (the tiling `pipeline`,
 * `pipebend`, `fenceline`) and toward ONE piece of overwhelming scale
 * (`coolingtowerbig`), not toward more scattered singletons — a junkyard reads
 * as noise, and the failure mode here is clutter, not restraint.
 */
const SCENERY_SPECS = Object.freeze([
  // THE signature natural shape: a black silhouette against pale ash.
  { id: "snag", width: 32, height: 72, variants: 4, pivot: [16, 68] },
  { id: "snagtall", width: 28, height: 88, variants: 3, pivot: [14, 84] },
  { id: "snagfallen", width: 56, height: 24, variants: 3, pivot: [28, 21] },
  { id: "stump", width: 24, height: 20, variants: 3, pivot: [12, 18] },
  { id: "slagrock", width: 40, height: 32, variants: 4, pivot: [20, 29] },
  { id: "ashpile", width: 40, height: 24, variants: 4, pivot: [20, 21] },
  { id: "ejecta", width: 40, height: 32, variants: 3, pivot: [20, 29] },
  { id: "clinkerchunk", width: 28, height: 20, variants: 3, pivot: [14, 18] },
  { id: "deadbrush", width: 32, height: 28, variants: 3, pivot: [16, 26] },
  { id: "ashripple", width: 32, height: 20, variants: 4, pivot: [16, 18] },
  { id: "glassshard", width: 20, height: 28, variants: 3, pivot: [10, 26] },
  // Last-pass overlay: a faint heat shimmer / thin smoke.
  { id: "emberwisp", width: 40, height: 56, variants: 3, pivot: [20, 50] },
  // Causeway deck: 0/1 EW straight, 2/3 NS straight, 4 EW end, 5 NS end.
  { id: "causeway", width: 32, height: 32, variants: 6, pivot: [16, 31] },

  // --- THE INDUSTRIAL COMPLEX ---------------------------------------------
  // Frames are much wider and a little taller than the object they hold: the
  // spare room to the RIGHT and BELOW the pivot is where the cast shadow goes.
  { id: "pylon", width: 40, height: 96, variants: 2, pivot: [20, 92] },
  { id: "coolingtower", width: 184, height: 176, variants: 2, pivot: [50, 132], ruin: true },
  { id: "reactorhusk", width: 184, height: 136, variants: 2, pivot: [52, 106], ruin: true },
  { id: "gantry", width: 164, height: 120, variants: 3, pivot: [22, 88], ruin: true },
  { id: "stack", width: 176, height: 164, variants: 3, pivot: [28, 124], ruin: true },

  // SCALE CONTRAST. Exactly ONE of these stands in the region, and it is
  // roughly 2.4x the area of the regular tower. The pilot's honest weakness was
  // that every ruin was about the same size, so the plain had verticals but no
  // SKYLINE — nothing that made the others read as small. This is the thing a
  // being walks toward and the thing you see first at 1:1.
  { id: "coolingtowerbig", width: 300, height: 284, variants: 1, pivot: [88, 224], ruin: true },
  // The horizontal counterweight to all those verticals: a long shed with its
  // sawtooth roof fallen in and its portal frames standing open. A plant reads
  // as a plant because it has one of these next to the towers.
  { id: "turbinehall", width: 268, height: 140, variants: 2, pivot: [42, 108], ruin: true },
  { id: "tankfarm", width: 180, height: 128, variants: 3, pivot: [48, 100], ruin: true },
  { id: "conveyor", width: 140, height: 112, variants: 2, pivot: [24, 84], ruin: true },
  { id: "spoilheap", width: 76, height: 48, variants: 3, pivot: [38, 44] },

  // CONNECTIVE TISSUE. These tile at the 32 px grid pitch and are drawn as
  // RUNS, which is what turns three separate structures into one site.
  // pipeline: 0/1 east-west, 2/3 north-south, 4 east-west end, 5 north-south end.
  { id: "pipeline", width: 32, height: 44, variants: 6, pivot: [16, 36] },
  // pipebend: 0 NE, 1 SE, 2 SW, 3 NW (the quadrant the run turns through).
  { id: "pipebend", width: 32, height: 44, variants: 4, pivot: [16, 36] },
  // fenceline: 0/1 east-west, 2/3 north-south. Torn through in places, and
  // NEVER blocking — a perimeter fence that blocked would quarter the region.
  { id: "fenceline", width: 32, height: 40, variants: 4, pivot: [16, 34] },
]);

/**
 * A charred standing trunk - the strongest 1:1 shape in the region. A root
 * flare at the base, a taper, pale ash caught on one windward side, a
 * splintered/jagged snapped top (not a flat cut) with a warm dark core
 * showing in the splits, and 2-3 broken branch stubs at different heights
 * and angles with a snapped warm-core tip.
 */
function paintCharredStanding(surface, ox, oy, spec, variant, slim) {
  const { width, height } = spec;
  const seed = 41_000 + variant * 887 + (slim ? 4001 : 0);
  const palette = CINDER;
  const baseY = height - 2;
  const topY = Math.round(height * (slim ? 0.10 : 0.16) + hash2(variant, 1, seed) * 5);
  const centerX = width / 2 + (hash2(variant, 2, seed) - 0.5) * 3;
  const baseHalf = slim ? 2.4 : 3.8;
  const tipHalf = slim ? 0.9 : 1.3;
  const ashSide = hash2(variant, 9, seed) > 0.5 ? 1 : -1;
  const flareY0 = baseY - 4;

  for (let y = topY; y <= baseY; y += 1) {
    const t = (y - topY) / Math.max(1, baseY - topY);
    const lean = Math.sin(t * 1.3 + variant) * (slim ? 2.8 : 1.8);
    let halfWidth = tipHalf + (baseHalf - tipHalf) * t;
    if (y > flareY0) halfWidth += (y - flareY0) * 0.9;
    const cx = centerX + lean;
    for (let x = Math.floor(cx - halfWidth); x <= cx + halfWidth; x += 1) {
      const across = (x - cx) / Math.max(0.6, halfWidth);
      let index = level(palette, 0.08 + (1 - Math.abs(across)) * 0.40);
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.84) index -= 1;
      let colour = step(palette, index);
      if (Math.sign(across) === ashSide && Math.abs(across) > 0.55 && hash2(x, y, seed + 11) > 0.975) {
        colour = DUST[1];
      }
      put(surface, ox + x, oy + y, colour);
    }
  }

  const splinters = 3 + Math.floor(hash2(variant, 20, seed) * 3);
  for (let s = 0; s < splinters; s += 1) {
    const sx = Math.round(centerX - baseHalf * 0.6 + hash2(s, variant, seed + 23) * baseHalf * 1.2);
    const riseY = topY - Math.round(hash2(s, variant, seed + 27) * (slim ? 6 : 4));
    const shardH = topY - riseY + 1;
    for (let y = riseY; y <= topY; y += 1) {
      const localT = (y - riseY) / Math.max(1, shardH);
      put(surface, ox + sx, oy + y, step(palette, level(palette, 0.05 + localT * 0.3)));
    }
    if (hash2(s, variant, seed + 31) > 0.5) {
      put(surface, ox + sx + (hash2(s, variant, seed + 33) > 0.5 ? 1 : -1), oy + riseY + 1, EMBERDIM[1]);
    }
  }

  const stubs = slim ? 2 : 3;
  for (let index = 0; index < stubs; index += 1) {
    const along = topY + 6 + Math.floor(hash2(variant, index, seed + 13) * Math.max(1, baseY - topY - 14));
    const side = hash2(variant, index, seed + 17) > 0.5 ? 1 : -1;
    const length = 4 + Math.floor(hash2(variant, index, seed + 19) * 5);
    const rise = 0.55 + hash2(variant, index, seed + 21) * 0.5;
    const t0 = (along - topY) / Math.max(1, baseY - topY);
    const cx = centerX + Math.sin(t0 * 1.3 + variant) * (slim ? 2.8 : 1.8);
    for (let s = 0; s < length; s += 1) {
      const x = Math.round(cx + side * s * 0.85);
      const y = along - Math.round(s * rise);
      put(surface, ox + x, oy + y, step(palette, level(palette, 0.10) - (s > length - 2 ? 1 : 0)));
      if (s < length - 2) put(surface, ox + x, oy + y + side, step(palette, level(palette, 0.06)));
    }
    if (hash2(variant, index, seed + 35) > 0.55) {
      const tipX = Math.round(cx + side * (length - 1) * 0.85);
      const tipY = along - Math.round((length - 1) * rise);
      put(surface, ox + tipX, oy + tipY, EMBERDIM[1]);
    }
  }
}

function paintSnagFallen(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 42_000 + variant * 941;
  const palette = CINDER;
  for (let x = 2; x < width - 2; x += 1) {
    const t = x / width;
    const centerY = height * 0.58 + Math.sin(t * 2.2 + variant) * 1.6;
    const thickness = 2.4 + Math.sin(t * Math.PI) * 2.2;
    for (let dy = -thickness; dy <= thickness; dy += 1) {
      const lit = 0.30 - (dy / thickness) * 0.30 + (fbm(x * 0.5, dy * 0.6, seed, 2) - 0.5) * 0.4;
      put(surface, ox + x, oy + Math.round(centerY + dy), step(palette, level(palette, lit)));
    }
    if (hash2(x, variant, seed + 3) > 0.90) {
      put(surface, ox + x, oy + Math.round(centerY - thickness + 1), EMBERDIM[1]);
    }
  }
}

function paintStump(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 43_000 + variant * 967;
  const palette = CINDER;
  const centerX = width / 2;
  const baseY = height - 2;
  const topY = Math.round(height * 0.25);
  for (let y = topY; y <= baseY; y += 1) {
    const t = (y - topY) / Math.max(1, baseY - topY);
    const halfWidth = (width * 0.30) * (0.7 + t * 0.3);
    for (let x = Math.round(centerX - halfWidth); x <= centerX + halfWidth; x += 1) {
      const across = (x - centerX) / Math.max(0.6, halfWidth);
      let index = level(palette, 0.12 + (1 - Math.abs(across)) * 0.30);
      if (hash2(chunky(x), chunky(y), seed) > 0.84) index -= 1;
      put(surface, ox + x, oy + y, step(palette, index));
    }
  }
  for (let x = Math.round(centerX - width * 0.30); x <= centerX + width * 0.30; x += 1) {
    put(surface, ox + x, oy + topY, step(palette, 0));
  }
}

function paintSlagRock(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 57_000 + variant * 1451;
  const centerX = width / 2;
  const centerY = height * 0.58;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / (width * 0.42);
      const dy = (y - centerY) / (height * 0.36);
      const wobble = fbm(x * 0.15 + variant * 9, y * 0.15, seed, 3) - 0.5;
      const radius = Math.max(Math.abs(dx), Math.abs(dy)) * 0.64 + Math.hypot(dx, dy) * 0.36;
      if (radius > 0.92 + wobble * 0.28) continue;
      put(surface, ox + x, oy + y, clinkerPixel(x + variant * 29, y, seed));
    }
  }
}

function paintAshPile(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 44_000 + variant * 733;
  const centerX = width / 2;
  const centerY = height * 0.62;
  const radiusX = width * 0.46;
  const radiusY = height * 0.42;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / radiusX;
      const dy = (y - centerY) / radiusY;
      const wobble = (fbm(x * 0.14 + variant * 7, y * 0.14, seed, 3) - 0.5) * 0.30;
      const radius = Math.hypot(dx, dy) + wobble;
      if (radius > 1.0) continue;
      const dome = Math.sqrt(Math.max(0, 1 - radius * radius));
      let index = level(ASH, 0.30 + dome * 0.55 - dy * 0.20);
      if (hash2(chunky(x), chunky(y), seed + 3) > 0.86) index += 1;
      else if (hash2(chunky(x), chunky(y), seed + 5) < 0.10) index -= 1;
      put(surface, ox + x, oy + y, step(ASH, index));
    }
  }
}


/**
 * A blast-thrown slag block with an ash drift in its lee - a real soft mound
 * trailing from the block, not scattered specks floating over transparency.
 */
function paintEjecta(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 46_000 + variant * 857;
  const centerX = width * 0.40;
  const centerY = height * 0.52;
  const blockRX = width * 0.28;
  const blockRY = height * 0.32;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x - centerX) / blockRX;
      const dy = (y - centerY) / blockRY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 1.0) continue;
      put(surface, ox + x, oy + y, clinkerPixel(x + variant * 19, y, seed));
    }
  }
  const driftX = width * 0.72;
  const driftY = height * 0.72;
  const driftRX = width * 0.34;
  const driftRY = height * 0.30;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ex = (x - centerX) / blockRX;
      const ey = (y - centerY) / blockRY;
      if (Math.max(Math.abs(ex), Math.abs(ey)) <= 1.0) continue;
      const ax = (x - driftX) / driftRX;
      const ay = (y - driftY) / driftRY;
      const wobble = (fbm(x * 0.16 + variant * 7, y * 0.16, seed + 5, 2) - 0.5) * 0.30;
      const radius = Math.hypot(ax, ay) + wobble;
      if (radius > 1.0) continue;
      const dome = Math.sqrt(Math.max(0, 1 - radius * radius));
      put(surface, ox + x, oy + y, windAshPixel(ASH, x + variant * 11, y, seed + 9, null));
      if (dome < 0.55) veil(surface, ox + x, oy + y, ACCENT.shadow, (0.55 - dome) * 0.5);
    }
  }
}

function paintClinkerChunk(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 47_000 + variant * 727;
  const pieces = 2 + (variant % 2);
  for (let piece = 0; piece < pieces; piece += 1) {
    const cx = width * (0.25 + hash2(piece, variant, seed) * 0.5);
    const cy = height * (0.45 + hash2(piece, variant, seed + 3) * 0.4);
    const r = 3 + hash2(piece, variant, seed + 5) * 3;
    for (let y = Math.floor(cy - r); y <= cy + r; y += 1) {
      for (let x = Math.floor(cx - r); x <= cx + r; x += 1) {
        const dx = (x - cx) / r;
        const dy = (y - cy) / r;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 1) continue;
        put(surface, ox + x, oy + y, clinkerPixel(x + piece * 23, y + piece * 11, seed));
      }
    }
  }
}


function paintDeadBrush(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 49_000 + variant * 599;
  const baseX = width / 2;
  const baseY = height - 2;
  const twigs = 10 + variant * 3;
  for (let index = 0; index < twigs; index += 1) {
    const angle = -Math.PI / 2 + (hash2(index, variant, seed) - 0.5) * 1.8;
    const length = 6 + hash2(index, variant, seed + 3) * (height * 0.42);
    let x = baseX + (hash2(index, variant, seed + 5) - 0.5) * width * 0.3;
    let y = baseY;
    for (let s = 0; s < length; s += 1) {
      x += Math.cos(angle) * 0.9 + (hash2(Math.floor(x), Math.floor(y), seed + 7) - 0.5) * 0.4;
      y += Math.sin(angle) * 0.9;
      put(surface, ox + Math.round(x), oy + Math.round(y),
        step(CINDER, 1 + (hash2(index, s, seed + 9) > 0.7 ? 1 : 0)));
    }
  }
}

/**
 * A ground-decal ash ripple: a clean directional drift crest with a lit lip
 * and a shadowed lee, fading out at its left/right edges - not a stippled
 * random-inclusion field.
 */
function paintAshRipple(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 50_000 + variant * 613;
  const crestY = height * (0.44 + hash2(variant, 1, seed) * 0.10);
  const amp = height * 0.24;
  for (let x = 0; x < width; x += 1) {
    const t = x / width;
    const wobble = (fbm(x * 0.08, variant * 6, seed, 2) - 0.5) * 3;
    const crest = crestY - Math.sin(t * Math.PI * (1.3 + (variant % 2) * 0.6)) ** 0.8 * amp + wobble;
    const fade = clamp01(Math.min(x, width - 1 - x) / 4);
    if (fade <= 0) continue;
    for (let y = 0; y < height; y += 1) {
      const rel = y - crest;
      if (rel < -2 || rel > 5) continue;
      let colour = windAshPixel(ASH, x + variant * 31, y, seed, null);
      let alpha = ALPHA_LEVELS[2];
      if (rel < 0) {
        colour = ASH[3];
        alpha = ALPHA_LEVELS[3];
      } else if (rel < 2) {
        alpha = ALPHA_LEVELS[3];
      } else {
        colour = step(ASH, level(ASH, 0.30));
      }
      setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], Math.round(alpha * fade)]);
    }
  }
}

function paintGlassShard(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 51_000 + variant * 571;
  const baseX = width / 2;
  const baseY = height - 2;
  const tipY = Math.round(height * (0.10 + hash2(variant, 1, seed) * 0.14));
  const lean = (hash2(variant, 2, seed) - 0.5) * 5;
  for (let y = tipY; y <= baseY; y += 1) {
    const t = (y - tipY) / Math.max(1, baseY - tipY);
    const halfWidth = Math.max(0.6, width * 0.22 * t);
    const cx = baseX + lean * (1 - t);
    for (let x = Math.round(cx - halfWidth); x <= cx + halfWidth; x += 1) {
      const across = (x - cx) / Math.max(0.6, halfWidth);
      const index = level(GLASS, 0.35 + (1 - Math.abs(across)) * 0.5);
      put(surface, ox + x, oy + y, step(GLASS, index));
    }
  }
  for (let y = tipY + 2; y < baseY - 1; y += 1) {
    if (hash2(y, variant, seed + 11) > 0.55) {
      put(surface, ox + Math.round(baseX + lean * 0.4), oy + y, GLASS_CRAZING[0]);
    }
  }
}

function paintEmberWisp(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 52_000 + variant * 1327;
  const baseX = width * (0.35 + hash2(variant, 1, seed) * 0.3);
  const drift = width * (0.20 + hash2(variant, 2, seed) * 0.22);
  for (let y = 0; y < height; y += 1) {
    const t = 1 - y / (height - 1);
    const centerX = baseX + drift * t ** 1.3;
    const radius = width * (0.03 + 0.16 * t ** 0.8);
    for (let x = 0; x < width; x += 1) {
      const across = (x - centerX) / Math.max(1, radius);
      if (Math.abs(across) > 1.3) continue;
      const puff = fbm(x * 0.16 + variant * 13, y * 0.13 - t * 3.2, seed + 3, 3);
      let density = (1.1 - across * across) * (0.20 + puff * 1.0) * (1.05 - t * 0.7);
      if (t > 0.5) density -= (t - 0.5) * 0.9;
      if (density <= 0.16) continue;
      const alphaLevel = density > 0.42 ? 1 : 0;
      const colour = t < 0.30 ? WISP_WARM : WISP_BRIGHT;
      setPixel(surface, ox + x, oy + y, [colour[0], colour[1], colour[2], WISP_ALPHAS[alphaLevel]]);
    }
  }
}

/**
 * A snapped industrial lattice mast - the only built thing in the region, a
 * ruin. Deliberately ASYMMETRIC: the two legs wobble independently, one leg
 * (randomly chosen) breaks off partway down and ends in a stub angled out,
 * cross-members are irregularly spaced with some missing, and the top is a
 * jagged torn fragment rather than a flat, centred cap.
 */
function paintPylon(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 53_000 + variant * 1471;
  const baseX = width / 2;
  const baseY = height - 3;
  const snapY = Math.round(height * (0.26 + hash2(variant, 1, seed) * 0.18));
  const overallLean = (hash2(variant, 2, seed) - 0.5) * 14;
  const brokenSide = hash2(variant, 3, seed) > 0.5 ? 1 : -1;
  const brokenAt = snapY + Math.round((baseY - snapY) * (0.35 + hash2(variant, 4, seed) * 0.30));
  const wobble = { [-1]: (hash2(variant, -1, seed + 5) - 0.5) * 6, 1: (hash2(variant, 1, seed + 5) - 0.5) * 6 };

  for (const side of [-1, 1]) {
    const legEnd = side === brokenSide ? brokenAt : baseY;
    let stubX = baseX;
    for (let y = snapY; y <= legEnd; y += 1) {
      const t = (y - snapY) / Math.max(1, baseY - snapY);
      const spread = 3 + t * (width * 0.28) + wobble[side] * t;
      const x = Math.round(baseX + side * spread + overallLean * (1 - t));
      stubX = x;
      let index = level(CLINKER, 0.28 + (side > 0 ? 0.1 : -0.1));
      if (hash2(x, y, seed + 7) > 0.85) index -= 1;
      put(surface, ox + x, oy + y, step(CLINKER, index));
      put(surface, ox + x + side, oy + y, step(CLINKER, index - 1)); // a second px of mass, shaded
      if (hash2(x, y, seed + 9) > 0.94) put(surface, ox + x, oy + y, CLINKER_RUST);
    }
    if (side === brokenSide) {
      for (let s = 1; s <= 4; s += 1) {
        const x = stubX + Math.round(side * s * 0.9);
        const y = brokenAt + Math.round(s * 0.5);
        put(surface, ox + x, oy + y, step(CLINKER, 0));
      }
    }
  }

  for (let y = snapY + 3; y < baseY; y += 5 + Math.floor(hash2(y, variant, seed + 11) * 3)) {
    if (y > brokenAt) continue;
    if (hash2(y, variant, seed + 13) > 0.72) continue;
    const t = (y - snapY) / Math.max(1, baseY - snapY);
    const x0 = Math.round(baseX - (3 + t * width * 0.28 + wobble[-1] * t) + overallLean * (1 - t));
    const x1 = Math.round(baseX + (3 + t * width * 0.28 + wobble[1] * t) + overallLean * (1 - t));
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x += 1) {
      put(surface, ox + x, oy + y, step(CLINKER, 1));
    }
  }

  const topX = Math.round(baseX + overallLean);
  for (let s = 0; s < 3; s += 1) {
    const x = topX + Math.round((hash2(s, variant, seed + 15) - 0.5) * 5);
    const y = snapY - Math.round(hash2(s, variant, seed + 17) * 3);
    put(surface, ox + x, oy + y, step(CLINKER, 0));
  }
}



/**
 * One causeway deck piece: a fused-glass bar with a pale gleam down the
 * centre and cracked edges. Variants 0/1 = horizontal straight, 2/3 =
 * vertical straight, 4 = horizontal end/abutment, 5 = vertical end/abutment -
 * the E-W AND N-S kit a crossing needs in both orientations.
 */
function paintCauseway(surface, ox, oy, spec, variant) {
  const size = spec.width;
  const vertical = variant === 2 || variant === 3 || variant === 5;
  const isEnd = variant === 4 || variant === 5;
  const seed = 56_000 + variant * 1063;
  const place = (along, across, rgb) => {
    put(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), rgb);
  };
  const shade = (along, across, alpha) => {
    veil(surface, ox + (vertical ? across : along), oy + (vertical ? along : across), CAUSEWAY_SHADOW, alpha);
  };
  if (!isEnd) {
    for (let along = 0; along < size; along += 1) {
      const crack = hash2(Math.floor(along / 4), variant, seed) > 0.80;
      for (let across = 5; across <= 24; across += 1) {
        let colour;
        if (across <= 6 || across >= 23) colour = CAUSEWAY[0];
        else if (across >= 14 && across <= 17) {
          colour = across === 15 || across === 16 ? CAUSEWAY_GLEAM[1] : CAUSEWAY_GLEAM[0];
        } else if (crack && (across === 9 || across === 20)) colour = CAUSEWAY[0];
        else colour = CAUSEWAY[hash2(along, across, seed + 3) > 0.5 ? 2 : 1];
        place(along, across, colour);
      }
      shade(along, 27, 0.40);
      shade(along, 3, 0.20);
    }
  } else {
    for (let along = 0; along < size; along += 1) {
      const middle = 1 - Math.abs(along - (size - 1) / 2) / ((size - 1) / 2);
      const from = 5 - Math.round(middle * 2);
      const to = 24 + Math.round(middle * 2);
      for (let across = from; across <= to; across += 1) {
        let colour;
        if (across <= from + 1 || across >= to - 1) colour = CAUSEWAY[0];
        else if (across >= 14 && across <= 17) colour = CAUSEWAY_GLEAM[0];
        else colour = CAUSEWAY[1];
        place(along, across, colour);
      }
    }
    for (const end of [1, size - 2]) {
      for (let across = 6; across <= 23; across += 1) place(end, across, CAUSEWAY[0]);
    }
  }
}

// ---------------------------------------------------------------------------
// RUINED STRUCTURES (v2) - illustrated OBJECTS, not terrain colour
//
// The Nirvana East lesson, applied: a terrain tier cannot be tall, so painted
// landforms read as colour patches. What makes a raised thing read as raised in
// a flat top-down view, in order of strength:
//
//   1. A CAST SHADOW ON THE GROUND. This is the cue v1's landforms lacked
//      entirely, and it is the one that does most of the work.
//   2. A lit top surface distinct in value from the ground it stands on.
//   3. Side faces in shadow, BETWEEN the top and the ground.
//   4. An irregular, characterful silhouette.
//
// LIGHT DIRECTION is not a free choice: all four islands sit side by side on
// the world map, so a disagreeing shadow reads as a mistake. Nirvana's shipped
// scenery keys from the UPPER LEFT (`author-nirvana-valley-pilot-art.mjs:1380`,
// `const lit = 0.56 - dy * 1.05 - dx * 0.40` - about 2.6x more top-down than
// side-on) and casts to the lower right (its handrail post throws +2..+6 px
// right and +1 px down for a 9 px post, `:1125-1128`; its deck throws 5 px,
// `:985-991`). SHADOW_DX / SHADOW_DY below are exactly that ratio, and every
// ruin here is lit from the upper left to match.
// ---------------------------------------------------------------------------

/**
 * Ground offset per pixel of height. Nirvana's own throw is ~0.52 : 0.14,
 * measured on a 9 px handrail post; at that ratio a 100 px ruin lays its whole
 * shadow into a 14 px band, which at 1:1 is a smudge rather than a shadow -
 * the first cut of these ruins had a real cast shadow and it was invisible.
 * The BEARING is what has to agree between islands, not the foreshortening, so
 * DX is held and DY opened up until the shadow is a shape you can see.
 */
const SHADOW_DX = 0.52;
const SHADOW_DY = 0.32;

/** Five fixed values per built material: outline / shade / body / face / lit. */
const RUIN_GLASS = Object.freeze({
  outline: [10, 8, 16], shade: [34, 28, 46], body: [64, 55, 82],
  face: [108, 96, 132], lit: [160, 146, 184],
});
const RUIN_BONE = Object.freeze({
  outline: [44, 39, 50], shade: [96, 90, 102], body: [142, 135, 148],
  face: [182, 176, 188], lit: [214, 210, 218],
});
const RUIN_EJECTA = Object.freeze({
  outline: [22, 18, 28], shade: [50, 44, 58], body: [88, 80, 96],
  face: [134, 125, 142], lit: [180, 172, 188],
});
const RUIN_CONCRETE = Object.freeze({
  outline: [20, 17, 25], shade: [56, 50, 62], body: [92, 85, 98],
  face: [130, 123, 136], lit: [166, 159, 170],
});
const RUIN_STEEL = Object.freeze({
  outline: [16, 13, 20], shade: [42, 36, 46], body: [66, 58, 70],
  face: [96, 87, 100], lit: [128, 119, 132],
});
const RUIN_RUST = Object.freeze([116, 66, 58]);

/**
 * Project an object's silhouette onto the ground as a cast shadow.
 *
 * A pixel `rise` px above the foot line lands at `(x + rise*DX, foot + rise*DY)`.
 * Rows are projected as SPANS (min..max opaque x per row) rather than pixel by
 * pixel, so the shadow is a solid coherent shape instead of a dotted trail, and
 * each span is written two rows deep because DY is shallow enough that adjacent
 * source rows collapse onto the same destination row.
 */
function paintCastShadowFrom(target, ox, oy, scratch, footY, strength) {
  const maxRise = Math.max(1, footY);
  // On a very tall object DY is shallow enough that dozens of source rows land
  // on the same destination row, so drawing every row three deep saturates the
  // whole throw into one solid grey slab — which is what the first cut of the
  // hero tower looked like. Sample every other row above ~120 px of rise, which
  // halves the overdraw and lets the shape of the silhouette come back.
  const rowStep = footY > 120 ? 2 : 1;
  for (let y = 0; y <= footY && y < scratch.height; y += rowStep) {
    let lo = -1;
    let hi = -1;
    for (let x = 0; x < scratch.width; x += 1) {
      if (scratch.data[(y * scratch.width + x) * 4 + 3] < 160) continue;
      if (lo < 0) lo = x;
      hi = x;
    }
    if (lo < 0) continue;
    const rise = footY - y;
    const dx = rise * SHADOW_DX;
    const dy = rise * SHADOW_DY;
    const alpha = strength * (1 - (rise / maxRise) * 0.42);
    for (let x = Math.round(lo + dx); x <= Math.round(hi + dx); x += 1) {
      const sy = Math.round(footY + dy);
      veil(target, ox + x, oy + sy, ACCENT.shadow, alpha);
      veil(target, ox + x, oy + sy + 1, ACCENT.shadow, alpha);
      veil(target, ox + x, oy + sy + 2, ACCENT.shadow, alpha * 0.7);
    }
  }
}

/** Copy an object scratch over whatever is already on the sheet. */
function blitScratch(target, ox, oy, scratch) {
  for (let y = 0; y < scratch.height; y += 1) {
    for (let x = 0; x < scratch.width; x += 1) {
      const i = (y * scratch.width + x) * 4;
      if (scratch.data[i + 3] === 0) continue;
      setPixel(target, ox + x, oy + y, [
        scratch.data[i], scratch.data[i + 1], scratch.data[i + 2], scratch.data[i + 3],
      ]);
    }
  }
}

/**
 * Author a ruin: body into a scratch, then a tight contact pool at its real
 * base, then the cast shadow, then the body over both.
 *
 * The contact pool is sized from the object's MEASURED footprint rather than
 * from the frame width, because a ruin frame is mostly empty room reserved for
 * the shadow - the generic `0.30 * width` ellipse the small props use would
 * throw a pool half a tile wider than the thing standing in it.
 */
function paintRuin(surface, ox, oy, spec, variant, body, strength = 0.58) {
  const scratch = createSurface(spec.width, spec.height);
  body(scratch, spec, variant);
  const footY = spec.pivot[1];
  let lo = spec.width;
  let hi = 0;
  for (let y = Math.max(0, footY - 3); y <= footY && y < spec.height; y += 1) {
    for (let x = 0; x < spec.width; x += 1) {
      if (scratch.data[(y * spec.width + x) * 4 + 3] < 160) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  if (hi >= lo) {
    paintContactShadow(
      surface, ox, oy, (lo + hi) / 2, footY + 2,
      Math.max(6, (hi - lo) * 0.60), Math.max(3, (hi - lo) * 0.13), 0.50,
    );
    // The GROUND FOOTPRINT, measured from the object's own body BEFORE its cast
    // shadow is laid down. A ruin frame is mostly reserved shadow room, so a
    // contact rect measured after the shadow would block a tower's worth of
    // empty ground to the lower right. See `measureGroundContact`.
    measuredContact = {
      x: lo,
      y: Math.max(0, footY - 5),
      width: hi - lo + 1,
      height: Math.min(spec.height - Math.max(0, footY - 5), 8),
    };
  }
  paintCastShadowFrom(surface, ox, oy, scratch, footY, strength);
  blitScratch(surface, ox, oy, scratch);
}

/**
 * Shade a point on a raised body from the UPPER-LEFT key.
 * `nx`,`ny` are the local surface normal components (-1 left/up .. +1 right/down).
 */
function ruinShade(kit, nx, ny, extra = 0) {
  const lit = 0.52 - ny * 0.62 - nx * 0.24 + extra;
  const order = [kit.outline, kit.shade, kit.body, kit.face, kit.lit];
  return order[Math.max(0, Math.min(4, Math.round(clamp01(lit) * 4)))];
}

// ---------------------------------------------------------------------------
// ANIMATED ENVIRONMENT (v2) - THE FIRE
//
// This sheet is authored to the PRODUCTION animated-environment contract, byte
// for byte, so productionising it is a copy rather than a port:
//
//   * the sheet is 256 x 128 px = 8 columns x 4 rows of 32 x 32 cells,
//     identical to every shipped `regions/<kit>/environment.png`;
//   * animation kind `i` binds cell `i * 4`, and its FOUR frames are cells
//     `i*4 .. i*4+3` laid out horizontally (`productionManifest.ts:929-932`);
//   * cell -> rect is `x = (cell % 8) * 32, y = floor(cell / 8) * 32`;
//   * `ANIMATED_FRAME_COUNT` is 4 and the default frame duration is 160 ms, so
//     one cycle is 640 ms (`EnvironmentSystem.ts:300`, `productionManifest.ts:570`);
//   * the runtime picks a frame per placement from `(nowMs + phaseSeed % cycle)`,
//     so neighbouring placements are out of step for free and no extra art is
//     needed to stop a line of fire pulsing in unison.
//
// TWO of the four kinds here - `ember` and `smoke-anchor` - are ALREADY declared
// by the shipped `ash-waste` kit (`biomeKits.ts:163`) and need no production
// change at all. `ember-vent` and `heat-haze` are additions; they cost one line
// each in the kind union and in that kit's `animatedKinds`, and they fit in the
// sheet's existing free cells (16 of 32 used here; the environment budget is
// 16 KiB and `ash-waste` currently spends 1,056 B of it).
//
// The frames LOOP: every shape term is driven by `sin`/`cos` of `2*pi*phase/4`,
// so frame 3 hands back to frame 0 without a jump.
// ---------------------------------------------------------------------------

const ENVIRONMENT_COLUMNS = 256;
const ENVIRONMENT_ROWS = 128;
const ENVIRONMENT_CELL = 32;
const ENVIRONMENT_GRID_COLUMNS = 8;
const ANIMATED_FRAME_COUNT = 4;

/** Kind slot order. Index i owns cells i*4 .. i*4+3. */
/**
 * PRODUCTION EDITION: exactly the TWO kinds the shipped `ash-waste` biome kit
 * already declares (`biomeKits.ts` `animatedKinds: ["ember", "smoke-anchor"]`).
 *
 * The pilot authored four (`ember`, `ember-vent`, `smoke-anchor`, `heat-haze`)
 * and its own report called the extra two OPTIONAL — "the two kinds the shipped
 * kit already declares carry most of the read". Shipping only those two is
 * worth a great deal here: it means the kind union, the kit table, the parse
 * allow-list and the region's generic recipe hash are all untouched, and the
 * environment sheet keeps its published 2-kind cell geometry byte for byte, so
 * `pack.json` needs no layout change at all. The blast radius of the fire is
 * then exactly: new pixels, and the pool that draws them.
 *
 * What was `ember-vent` in the pilot is folded into `ember` instead — the ember
 * cells here carry a taller, hotter tongue than the pilot's plain ember did.
 */
const ANIMATED_KINDS = Object.freeze(["ember", "smoke-anchor"]);

/**
 * The flame ramp - the ONLY place in this region that goes past coral into
 * yellow-white. Fire has to out-value everything around it or it reads as
 * painted-on decoration; the region's whole point is that this is the one warm
 * thing in a dead place.
 */
const FLAME = Object.freeze([
  [104, 26, 40], [168, 44, 50], [222, 76, 58],
  [248, 124, 66], [255, 176, 96], [255, 226, 158],
]);

/** Smoke / ash plume - cool, desaturated, translucent only. */
const SMOKE = Object.freeze([[58, 52, 66], [92, 85, 100], [134, 126, 142], [176, 168, 184]]);

const TAU = Math.PI * 2;

/**
 * One flame tongue rising from `(baseX, baseY)`, wavering with `phase`.
 *
 * Drawn as a stack of horizontal spans whose half-width tapers to nothing at
 * the tip and whose centre-line snakes; the core of the tongue is the hottest
 * ramp entry and the shoulders cool outward, which is what makes a 12-20 px
 * shape read as flame rather than as an orange blob.
 */
function paintFlameTongue(surface, ox, oy, baseX, baseY, height, width, phase, seed, hottest) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  const lean = Math.sin(t + seed * 0.7) * 2.2;
  const rise = height * (0.82 + 0.18 * Math.sin(t + seed * 1.3));
  for (let step_ = 0; step_ <= rise; step_ += 1) {
    const up = step_ / Math.max(1, rise);
    const snake = Math.sin(t + up * 3.1 + seed) * up * 2.4 + lean * up;
    const cx = baseX + snake;
    const y = Math.round(baseY - step_);
    // Fat at the base, pinched, then a flickering tip.
    const taper = Math.sin((1 - up) * Math.PI * 0.62 + 0.22);
    const half = Math.max(0, width * taper * (1 - up * 0.35) - up * 0.6);
    if (half <= 0) continue;
    for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
      const across = Math.abs(x - cx) / Math.max(0.7, half);
      // Hot core, cooling to the edge AND cooling toward the tip. The core is
      // deliberately WIDE (a high exponent on `across`) - a one-pixel white
      // filament inside an orange shape reads as a highlight, not as heat.
      let index = level(FLAME, (1 - across ** 2.1 * 0.92) * (1 - up * 0.52) * hottest);
      if (hash2(x, y + phase * 97, seed + 11) > 0.86) index -= 1;
      put(surface, ox + x, oy + y, step(FLAME, index < 1 ? 1 : index));
    }
  }
}

/**
 * The pool of light the fire throws on the ground it stands on.
 *
 * DITHERED, not alpha-ramped. Alpha is quantised to four levels by contract,
 * and a radial falloff through four levels paints three hard concentric rings
 * - at 1:1 that read as a solid orange disc under the flame, which is the
 * single worst thing a glow can look like. So coverage is stippled instead:
 * one dim alpha level, written with a probability equal to the falloff. The
 * eye integrates the stipple into a soft pool and the palette stays bounded.
 */
function paintGlowPool(surface, ox, oy, centerX, footY, radiusX, radiusY, phase, strength) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  const breathe = 0.90 + 0.10 * Math.sin(t);
  const rx = radiusX * breathe;
  const ry = radiusY * breathe;
  for (let y = Math.round(footY - ry); y <= footY + ry; y += 1) {
    for (let x = Math.round(centerX - rx); x <= centerX + rx; x += 1) {
      const d = Math.hypot((x - centerX) / rx, (y - footY) / ry);
      if (d > 1) continue;
      const falloff = (1 - d) ** 1.5 * strength;
      if (hash2(x, y + phase * 61, 8123) > falloff) continue;
      const colour = falloff > 0.62 ? FLAME[4] : falloff > 0.34 ? FLAME[3] : FLAME[2];
      setPixel(surface, ox + x, oy + y, [
        colour[0], colour[1], colour[2], ALPHA_LEVELS[falloff > 0.55 ? 2 : 1],
      ]);
    }
  }
}

/**
 * Kind 0 - `ember`: low flame in a crack, with the light it throws.
 *
 * The whole fire DRIFTS laterally with the phase. That is not decoration: an
 * animated placement is drawn at its tile's origin, so with a fixed flame
 * position every fire in the region lines up on the 32 px lattice and a
 * burning fissure reads as a pegboard. Because neighbouring placements are at
 * different phases (their `phaseSeed` offsets them), a phase-driven drift puts
 * them at different offsets at any given instant and the grid dissolves. It
 * is sinusoidal in `phase`, so the loop still closes.
 */
function paintEmberCell(surface, ox, oy, phase) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  const drift = Math.sin(t) * 4.0;
  /**
   * PRODUCTION EDITION: the four frames now SURGE.
   *
   * The pilot got its variety from having two fire kinds, a tall `ember-vent`
   * beside a low `ember`. Shipping one kind, that variety has to come from
   * somewhere else, and the four frames are the obvious place: `surge` runs
   * 0.72 -> 1.34 -> 1.16 -> 0.78 around the loop, so a single flame genuinely
   * rises and falls instead of only wavering. Because every placement carries
   * its own `phaseSeed`, at any instant some fires along a fissure are at full
   * height and their neighbours are low — which is what the pilot's two kinds
   * bought, without a second kind, a second pool, or a line in the kit table.
   */
  const surge = 1.03 + Math.cos(t + 0.9) * 0.31;
  paintGlowPool(surface, ox, oy, 16 + drift * 0.8, 25, 13 * surge, 6.5 * surge, phase, 0.70);
  paintFlameTongue(surface, ox, oy, 15.5 + drift, 27, 17 * surge, 3.1, phase, 3, 1.0);
  paintFlameTongue(surface, ox, oy, 20.5 + drift * 0.6, 28, 10 * surge, 1.9, (phase + 2) % 4, 9, 0.88);
  paintFlameTongue(surface, ox, oy, 11.0 + drift * 0.7, 28, 8 * surge, 1.6, (phase + 1) % 4, 17, 0.80);
  // Sparks lifting off the crown of the flame, only while it is surging.
  if (surge > 1.05) {
    for (let s = 0; s < 4; s += 1) {
      const sx = Math.round(16 + drift * 0.6 + Math.sin(t + s * 1.9) * 5 + (hash2(s, 0, 77) - 0.5) * 4);
      const sy = Math.round(10 - ((phase + s * 1.3) % 4) + hash2(s, 1, 79) * 3);
      if (sy < 0) continue;
      setPixel(surface, ox + sx, oy + sy, [...FLAME[4], quantiseAlpha(0.7)]);
    }
  }
}

/**
 * Kind 1 - `smoke-anchor`: ash smoke lifting off cooling ground and drifting.
 *
 * PRODUCTION EDITION: pushed, on the pilot report's own concern #4 — *"smoke
 * -anchor is nearly invisible over dark ground. Correct restraint or wasted
 * budget."* It was wasted budget: this region's ground is the darkest in the
 * world, so cool grey smoke at low alpha over near-black slate is nothing at
 * all. Two changes, both physical rather than cosmetic:
 *
 *  - the FIRST puff is lit from below by the fire it is rising off, in the
 *    flame ramp rather than the smoke ramp, so a plume has a hot root;
 *  - the plume is denser and lasts longer up the cell.
 */
function paintSmokeCell(surface, ox, oy, phase) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  for (let puff = 0; puff < 5; puff += 1) {
    const life = ((phase + puff) % ANIMATED_FRAME_COUNT + puff * 0.18)
      / (ANIMATED_FRAME_COUNT + 0.72);
    const cy = 28 - life * 25;
    const cx = 16 + life * 7 + Math.sin(t + puff * 1.7) * 2.6;
    const r = 3.6 + life * 5.8;
    const alpha = (1 - life * 0.86) * 0.78;
    const hotRoot = life < 0.22;
    for (let y = Math.round(cy - r); y <= cy + r; y += 1) {
      for (let x = Math.round(cx - r * 1.15); x <= cx + r * 1.15; x += 1) {
        const d = Math.hypot((x - cx) / (r * 1.15), (y - cy) / r);
        if (d > 1) continue;
        const lump = fbm(x * 0.34 + puff * 9, y * 0.34, 8801 + puff, 2);
        if (lump < 0.26 + d * 0.36) continue;
        const colour = hotRoot
          ? FLAME[level(FLAME, 0.18 + (1 - d) * 0.30)]
          : SMOKE[level(SMOKE, 0.34 + (1 - d) * 0.60 - life * 0.20)];
        setPixel(surface, ox + x, oy + y, [
          colour[0], colour[1], colour[2], quantiseAlpha(alpha * (1 - d * 0.45)),
        ]);
      }
    }
  }
}

function buildEnvironmentAtlas() {
  const surface = createSurface(ENVIRONMENT_COLUMNS, ENVIRONMENT_ROWS);
  const painters = [paintEmberCell, paintSmokeCell];
  ANIMATED_KINDS.forEach((kind, kindIndex) => {
    for (let phase = 0; phase < ANIMATED_FRAME_COUNT; phase += 1) {
      const cell = kindIndex * ANIMATED_FRAME_COUNT + phase;
      const ox = (cell % ENVIRONMENT_GRID_COLUMNS) * ENVIRONMENT_CELL;
      const oy = Math.floor(cell / ENVIRONMENT_GRID_COLUMNS) * ENVIRONMENT_CELL;
      painters[kindIndex](surface, ox, oy, phase);
    }
  });
  return { surface, kinds: ANIMATED_KINDS };
}

// ---------------------------------------------------------------------------
// RUIN KIT A - "ANCIENT": catastrophic and dead, WITHOUT asserting industry
//
// The lore problem this kit exists to avoid: the beings in this world build
// huts out of gathered material and nothing in the simulation has ever claimed
// an industrial past. Ruins as such are already canon (homes decay into ruins),
// but a cooling tower is a claim about what this world used to be. Everything
// here is legible as blasted and vitrified and old, and commits to nothing:
// slabs of fused glass thrown on end, a run of wall welded into slag, stands of
// bone-white dead trunks, and the ejecta berms a blast leaves behind.
// ---------------------------------------------------------------------------





// ---------------------------------------------------------------------------
// RUIN KIT B - "INDUSTRIAL": the alternative, built so the owner can choose
//
// Dramatically stronger and unmistakably a nuclear wasteland - and a claim
// about this world's past that nothing in the simulation has made yet. Built,
// not argued for. See the report's lore question.
// ---------------------------------------------------------------------------

/** A broken cooling-tower stump: waisted shell, torn rim, the inside showing. */
function paintCoolingTowerBody(scratch, spec, variant) {
  const kit = RUIN_CONCRETE;
  const seed = 65_000 + variant * 919;
  const baseY = spec.pivot[1];
  const height = 96 + variant * 10;
  const cx = 50;
  const radiusAt = (up) => 30 - Math.sin(clamp01(up / 0.62) * Math.PI * 0.5) * 12
    + Math.max(0, up - 0.62) * 34;
  for (let y = baseY; y >= baseY - height; y -= 1) {
    const up = (baseY - y) / height;
    const r = radiusAt(up);
    // The torn rim: this column's own top.
    for (let x = Math.round(cx - r); x <= cx + r; x += 1) {
      const across = (x - cx) / r;
      const tear = 0.80 + fbm(x * 0.14, variant * 9, seed, 2) * 0.24;
      if (up > tear) continue;
      let colour;
      if (up > tear - 0.045) {
        // The broken edge itself, and the dark interior seen through it.
        colour = Math.abs(across) < 0.72 ? kit.shade : kit.lit;
        if (Math.abs(across) < 0.52) colour = kit.outline;
      } else {
        colour = ruinShade(kit, across * 1.15, -0.22 - up * 0.2);
      }
      // Lift lines - poured concrete keeps its courses.
      if (Math.round(baseY - y) % 9 === 0 && up < tear - 0.05) {
        colour = Math.abs(across) < 0.6 ? kit.shade : kit.outline;
      }
      // A vertical structural crack running down the shaded side.
      const crack = Math.abs(fbm(across * 5 + 3, y * 0.05, seed + 13, 2) - 0.5);
      if (crack < 0.014 && across > 0.05) colour = kit.outline;
      if (hash2(chunky(x), chunky(y), seed + 17) > 0.90) colour = kit.shade;
      put(scratch, x, y, colour);
    }
  }
  // Spalled concrete and exposed rebar at the foot.
  for (let s = 0; s < 26; s += 1) {
    const sx = Math.round(cx - 34 + hash2(s, variant, seed + 21) * 76);
    const sy = Math.round(baseY - hash2(s, variant, seed + 23) * 7);
    const sw = 2 + Math.round(hash2(s, variant, seed + 27) * 4);
    for (let x = 0; x < sw; x += 1) put(scratch, sx + x, sy, kit.body);
    if (hash2(s, variant, seed + 31) > 0.72) {
      for (let y = 0; y < 4; y += 1) put(scratch, sx, sy - y, RUIN_RUST);
    }
  }
}

/** A split containment dome with its ribs open to the sky. */
function paintReactorHuskBody(scratch, spec, variant) {
  const kit = RUIN_CONCRETE;
  const seed = 66_000 + variant * 967;
  const baseY = spec.pivot[1];
  const cx = 52;
  const R = 40 + variant * 4;
  const H = 70 + variant * 6;
  // The split runs from the crown down the right flank.
  const splitFrom = 0.10;
  const splitTo = 0.52;
  for (let x = cx - R; x <= cx + R; x += 1) {
    const across = (x - cx) / R;
    if (Math.abs(across) > 1) continue;
    const dome = Math.sqrt(Math.max(0, 1 - across * across)) * H;
    const topY = baseY - dome;
    const inSplit = across > splitFrom && across < splitTo;
    for (let y = Math.round(topY); y <= baseY; y += 1) {
      const down = (y - topY) / Math.max(1, dome);
      if (inSplit && down < 0.62) {
        // Through the tear: the dark interior, with ribs crossing it.
        const rib = Math.round((y - topY) / 7) % 2 === 0
          && hash2(chunky(x), chunky(y), seed + 5) > 0.30;
        put(scratch, x, y, rib ? RUIN_STEEL.body : kit.outline);
        continue;
      }
      let colour = ruinShade(kit, across * 0.9, down * 1.35 - 0.75);
      if (y <= topY + 1) colour = kit.lit;
      // Panel seams on the shell.
      if (Math.round((y - topY) / 1) % 11 === 0) colour = kit.shade;
      const seam = Math.abs(((across + 1) * 6) % 1 - 0.5);
      if (seam < 0.045) colour = kit.shade;
      if (hash2(chunky(x), chunky(y), seed + 9) > 0.90) colour = kit.shade;
      put(scratch, x, y, colour);
    }
    // The torn lip of the split catches the light.
    if (Math.abs(across - splitFrom) < 0.02 || Math.abs(across - splitTo) < 0.02) {
      for (let y = Math.round(topY); y < topY + dome * 0.62; y += 1) {
        put(scratch, x, y, kit.lit);
      }
    }
  }
  for (let s = 0; s < 18; s += 1) {
    const sx = Math.round(cx - R + hash2(s, variant, seed + 21) * (R * 2 + 24));
    const sy = Math.round(baseY - hash2(s, variant, seed + 23) * 6);
    const sw = 2 + Math.round(hash2(s, variant, seed + 27) * 5);
    for (let x = 0; x < sw; x += 1) put(scratch, sx + x, sy, kit.shade);
  }
}

/** A collapsed pipe gantry: a snapped lattice mast and the pipe it carried. */
function paintGantryBody(scratch, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 67_000 + variant * 1013;
  const baseY = spec.pivot[1];
  const rootX = 22;
  const height = 52 + variant * 12;
  const lean = 0.30 + variant * 0.12;
  const widthAt = (up) => 9 - up * 4;
  // Two rails plus bracing, snapped short.
  for (let y = baseY; y >= baseY - height; y -= 1) {
    const up = (baseY - y) / height;
    const cx = rootX + (baseY - y) * lean;
    const half = widthAt(up);
    for (const side of [-1, 1]) {
      const x = Math.round(cx + side * half);
      put(scratch, x, y, side < 0 ? kit.face : kit.shade);
      put(scratch, x + (side < 0 ? 1 : -1), y, kit.body);
    }
    // Diagonal bracing every few rows.
    if (Math.round(baseY - y) % 8 === 0) {
      const dir = Math.round((baseY - y) / 8) % 2 === 0 ? 1 : -1;
      for (let s = 0; s <= half * 2; s += 1) {
        put(scratch, Math.round(cx - half + s), y - Math.round(dir * s * 0.4), kit.body);
      }
    }
  }
  // The pipe it used to carry, now lying across the ground, rusted through.
  const pipeY = baseY - 6;
  for (let x = 6; x < 100; x += 1) {
    const sag = Math.sin(((x - 6) / 94) * Math.PI) * 4;
    for (let d = -5; d <= 5; d += 1) {
      const y = Math.round(pipeY + sag + d);
      const nd = d / 5;
      let colour = ruinShade(kit, 0, nd * 1.3);
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.80) colour = RUIN_RUST;
      // A hole rusted through the top of the pipe.
      if (x > 52 && x < 68 && Math.abs(d) < 3) colour = kit.outline;
      put(scratch, x, y, colour);
    }
  }
}

/** A snapped chimney stack - the single tallest silhouette in either kit. */
function paintStackBody(scratch, spec, variant) {
  const kit = RUIN_CONCRETE;
  const seed = 68_000 + variant * 1091;
  const baseY = spec.pivot[1];
  const height = 96 + variant * 12;
  const cx = 28;
  for (let y = baseY; y >= baseY - height; y -= 1) {
    const up = (baseY - y) / height;
    const half = 13 - up * 5;
    for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
      const across = (x - cx) / half;
      // A jagged snap at the top rather than a clean cut.
      const snap = 0.86 + fbm(x * 0.30, variant * 4, seed, 2) * 0.20;
      if (up > snap) continue;
      let colour;
      if (up > snap - 0.035) {
        colour = Math.abs(across) < 0.55 ? kit.outline : kit.lit;
      } else {
        colour = ruinShade(kit, across * 1.2, -0.28);
      }
      // Hazard banding, bleached almost away.
      const bandRow = Math.round(baseY - y);
      if (bandRow % 26 < 5 && up < snap - 0.05 && hash2(x, bandRow, seed + 3) > 0.30) {
        colour = Math.abs(across) < 0.4 ? RUIN_RUST : kit.shade;
      }
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.90) colour = kit.shade;
      put(scratch, x, y, colour);
    }
  }
  // The piece that snapped off, lying to the right.
  const fallY = baseY - 5;
  for (let x = 46; x < 104; x += 1) {
    for (let d = -6; d <= 6; d += 1) {
      const y = fallY + d;
      const nd = d / 6;
      let colour = ruinShade(kit, 0, nd * 1.25 + 0.1);
      if (x > 94) colour = kit.outline;
      if (hash2(chunky(x), chunky(y), seed + 13) > 0.86) colour = kit.shade;
      put(scratch, x, y, colour);
    }
  }
}

// ---------------------------------------------------------------------------
// THE INDUSTRIAL PUSH — the owner's one change
//
// *"maybe a bit more aggressive on industrialness — you can do that when
// applying to the actual thing."*
//
// The pilot proved that a broken cooling tower reads instantly. What it did NOT
// have was a plant: its ruins were all roughly one size and they stood alone,
// so the plain had verticals but no skyline and no sense that the things were
// ever connected to each other. Everything in this block exists to fix exactly
// one of those two faults:
//
//   SCALE      `coolingtowerbig` — one per region, 2.4x the regular tower's
//              area, and deliberately the most INTACT structure in the region
//              so it is unmistakably a cooling tower rather than more rubble.
//              It is what makes everything else read as small.
//   RELATION   `turbinehall` (the horizontal mass a plant is built around),
//              `tankfarm`, `conveyor` — the pieces that, standing together,
//              read as one works rather than three ruins.
//   TISSUE     `pipeline` / `pipebend` / `fenceline` — tiling 32 px pieces
//              drawn as RUNS. A pipe run leaving a building and crossing the
//              plain is the cheapest, most legible industry cue there is, and
//              it is the thing that ties separate sites into one site.
//   EVIDENCE   `spoilheap` — plus the two new TERRAIN materials, `slab` and
//              `spoil`, which do the ground-evidence work at a scale no sprite
//              can (see the PALETTES block).
//
// The restraint that keeps this from becoming a junkyard is that the COUNTS are
// low and the placement is a layout, not a scatter — see
// `NirvanaWestTerrainField.ts`'s complex generator. Legibility is the goal;
// clutter is the failure mode.
// ---------------------------------------------------------------------------

/**
 * THE HERO. A cooling tower at a scale that dominates the region's skyline.
 *
 * Deliberately the most intact structure in Nirvana West. Everything else here
 * is broken, and a landscape of uniformly broken things reads as texture; one
 * nearly-whole silhouette gives the eye something to name, and naming it is
 * what makes the rest read as "the rest of the plant".
 *
 * The detail that does the identifying is not the hyperboloid — it is the ring
 * of ANGLED LEGS at the base with daylight between them. That colonnade is
 * unique to cooling towers and survives at any size.
 */
function paintCoolingTowerBigBody(scratch, spec, variant) {
  const kit = RUIN_CONCRETE;
  const seed = 71_000 + variant * 883;
  const baseY = spec.pivot[1];
  const height = 196;
  const cx = 88;
  const legTop = 30;
  /**
   * The hyperboloid, and getting this curve right is the whole sprite.
   *
   * The first cut used a shallow waist and took a deep bite out of the entire
   * right flank, and at 1:1 it read as a TREE STUMP — a tapering trunk with a
   * split — which in a region full of charred snags is the one thing it must
   * not look like. Three corrections, all about silhouette rather than surface:
   * the base ring is much wider than the waist (66 vs 36), the flare above the
   * waist is stronger and clearly belled, and the broken rim is a SMALL bite
   * confined to the far right rather than a diagonal cut across the whole top.
   * A cooling tower is recognised by its outline; the outline has to be nearly
   * whole for the eye to name it.
   */
  const radiusAt = (up) => (
    up < 0.60
      ? 66 - Math.sin(clamp01(up / 0.60) * Math.PI * 0.5) * 30
      : 36 + ((up - 0.60) / 0.40) ** 1.25 * 22
  );

  for (let y = baseY - legTop; y >= baseY - height; y -= 1) {
    const up = (baseY - y) / height;
    const r = radiusAt(up);
    for (let x = Math.round(cx - r); x <= cx + r; x += 1) {
      const across = (x - cx) / r;
      // ONE bite out of the rim, on the far right only. An evenly ragged top
      // reads as erosion; a single bite reads as something having hit it, and
      // leaves the rest of the bell intact to be recognised.
      // MONOTONIC toward the right edge. A sine bump here cut a notch out of
      // the middle-right and left a thin spike standing at the far edge, which
      // at 1:1 read as a horn growing off the tower.
      const biteAt = clamp01((across - 0.34) / 0.66);
      const bite = 0.985 - biteAt * biteAt * 0.20;
      const tear = bite + (fbm(x * 0.11, variant * 7, seed, 2) - 0.5) * 0.035;
      if (up > tear) continue;
      let colour;
      if (up > tear - 0.018) {
        // The broken lip, and the dark interior seen over it.
        colour = Math.abs(across) < 0.70 ? kit.shade : kit.lit;
        if (Math.abs(across) < 0.46) colour = kit.outline;
      } else {
        colour = ruinShade(kit, across * 1.10, -0.26 - up * 0.16);
      }
      // Lift lines: poured concrete keeps the courses it was cast in, and at
      // this size they are what give the shell its curvature.
      if (Math.round(baseY - y) % 12 === 0 && up < tear - 0.03) {
        colour = Math.abs(across) < 0.55 ? kit.shade : kit.outline;
      }
      // Long weather streaks running down the shell from the rim.
      const streak = fbm(across * 9, 0, seed + 41, 2);
      if (streak > 0.70 && hash2(chunky(x), chunky(y), seed + 43) > 0.55) {
        colour = ruinShade(kit, across * 1.10, -0.02 - up * 0.16);
      }
      const crack = Math.abs(fbm(across * 4 + 2, y * 0.035, seed + 13, 2) - 0.5);
      if (crack < 0.010 && across > 0.34) colour = kit.outline;
      if (hash2(chunky(x), chunky(y), seed + 17) > 0.92) colour = kit.shade;
      put(scratch, x, y, colour);
    }
  }

  // The heavy cornice ring at the very top of the intact bell, and the thicker
  // ring where the shell lands on the legs. Both are real cooling-tower
  // features and both help the eye read the curve as a surface of revolution.
  for (const [level0, thickness] of [[0.985, 3], [legTop / height, 4]]) {
    const y0 = Math.round(baseY - height * level0);
    const r0 = radiusAt(level0);
    for (let x = Math.round(cx - r0); x <= cx + r0; x += 1) {
      const across = (x - cx) / r0;
      if (level0 > 0.9 && across > 0.34) continue;
      for (let d = 0; d < thickness; d += 1) {
        put(scratch, x, y0 + d, d === 0 ? kit.lit : ruinShade(kit, across, 0.1));
      }
    }
  }

  // THE LEG COLONNADE. Angled A-frame legs with real gaps between them, and
  // the tower's dark underside showing through. This is the identifying detail.
  const baseRadius = radiusAt(legTop / height);
  const legs = 9;
  for (let i = 0; i <= legs; i += 1) {
    const t = i / legs;
    const footX = cx - baseRadius - 6 + t * (baseRadius * 2 + 12);
    const topX = cx - baseRadius * 0.92 + t * baseRadius * 1.84;
    for (let y = baseY; y >= baseY - legTop; y -= 1) {
      const k = (baseY - y) / legTop;
      const x = Math.round(footX + (topX - footX) * k);
      const lean = Math.abs(footX - topX) > 2 ? 1 : 0;
      for (let w = -2 - lean; w <= 2 + lean; w += 1) {
        const shade = w < 0 ? kit.face : w > 1 ? kit.shade : kit.body;
        put(scratch, x + w, y, shade);
      }
    }
  }
  // The dark under-tower seen between the legs.
  for (let y = baseY - 2; y >= baseY - legTop + 4; y -= 1) {
    for (let x = Math.round(cx - baseRadius * 0.86); x <= cx + baseRadius * 0.86; x += 1) {
      if (scratch.data[(y * scratch.width + x) * 4 + 3] > 0) continue;
      const gloom = hash2(chunky(x), chunky(y), seed + 51) > 0.86 ? kit.shade : kit.outline;
      put(scratch, x, y, gloom);
    }
  }
  // Spalled concrete and bent rebar around the feet.
  for (let s = 0; s < 44; s += 1) {
    const sx = Math.round(cx - baseRadius - 12 + hash2(s, variant, seed + 21) * (baseRadius * 2 + 24));
    const sy = Math.round(baseY - hash2(s, variant, seed + 23) * 8);
    const sw = 2 + Math.round(hash2(s, variant, seed + 27) * 5);
    for (let x = 0; x < sw; x += 1) put(scratch, sx + x, sy, kit.body);
    if (hash2(s, variant, seed + 31) > 0.70) {
      for (let y = 0; y < 5; y += 1) put(scratch, sx, sy - y, RUIN_RUST);
    }
  }
}

/**
 * A TURBINE HALL: the long horizontal mass every real plant is built around.
 *
 * The pilot's ruins were all towers and masts — verticals. A skyline made only
 * of verticals reads as a forest of posts; what says BUILDING is a long low
 * shed with a repeating roof and a row of windows. So this piece is deliberately
 * the widest thing in the vocabulary and the only one with WINDOWS, which are
 * the single most human-made shape available.
 *
 * The roof is a sawtooth (north-light) profile with its middle bays fallen in,
 * so the portal frames stand open against the sky — a shed that is a ruin, not
 * a shed with a hole.
 */
function paintTurbineHallBody(scratch, spec, variant) {
  const kit = RUIN_CONCRETE;
  const steel = RUIN_STEEL;
  const seed = 72_000 + variant * 941;
  const baseY = spec.pivot[1];
  const left = 10;
  const length = 186 + variant * 14;
  const wallTop = baseY - 44;
  const bays = 7;
  const bayWidth = length / bays;
  // The bays that have lost their roof. Kept CONTIGUOUS: a run of collapse
  // reads as a failure, alternate missing bays read as a pattern.
  const collapseFrom = variant === 0 ? 2 : 3;
  const collapseTo = collapseFrom + 2;

  // The wall, with its panel courses and its row of openings.
  for (let x = left; x < left + length; x += 1) {
    const along = (x - left) / length;
    for (let y = baseY; y >= wallTop; y -= 1) {
      const down = (baseY - y) / 44;
      let colour = ruinShade(kit, 0.15, 0.42 - down * 1.05);
      if (Math.round(baseY - y) % 13 === 0) colour = kit.shade;
      // Window openings: a regular row, most of them dark, a few blown out
      // wider than their frame.
      const bay = Math.floor((x - left) / bayWidth);
      const inBay = ((x - left) % bayWidth) / bayWidth;
      const openWindow = inBay > 0.22 && inBay < 0.78 && down > 0.28 && down < 0.72;
      if (openWindow) {
        const blown = hash2(bay, 0, seed + 61) > 0.55;
        colour = blown && hash2(chunky(x), chunky(y), seed + 63) > 0.70
          ? kit.shade
          : kit.outline;
      }
      if (hash2(chunky(x), chunky(y), seed + 67) > 0.92) colour = kit.shade;
      // The wall is gone where the collapse ran, down to a ragged stub — but
      // what is behind it is the DARK INSIDE of the shed, not a hole. Leaving
      // this transparent made the hall read as a wall with a bite out of it
      // rather than as a building you can see into.
      if (bay >= collapseFrom && bay <= collapseTo && down < 0.55
        && hash2(bay, Math.round(along * 40), seed + 69) > 0.30) {
        const lit = hash2(chunky(x), chunky(y), seed + 77) > 0.88;
        put(scratch, x, y, lit ? kit.shade : kit.outline);
        continue;
      }
      put(scratch, x, y, colour);
    }
  }

  // The sawtooth roof. Each bay is a shallow ramp with a vertical glazed face.
  for (let bay = 0; bay < bays; bay += 1) {
    const x0 = left + bay * bayWidth;
    const collapsed = bay >= collapseFrom && bay <= collapseTo;
    for (let x = Math.round(x0); x < Math.round(x0 + bayWidth); x += 1) {
      const inBay = (x - x0) / bayWidth;
      const ridge = wallTop - 6 - Math.round(inBay * 16);
      if (collapsed) {
        // Open portal frame, with the DARK far wall of the shed behind it.
        // The first cut left this transparent and at 1:1 it read as a hole
        // punched in a wall rather than as a building you can see into.
        for (let y = wallTop; y >= ridge + 2; y -= 1) {
          const lit = hash2(chunky(x), chunky(y), seed + 75) > 0.90;
          put(scratch, x, y, lit ? kit.shade : kit.outline);
        }
        if (Math.abs(inBay - 0.5) < 0.035 || inBay < 0.05) {
          for (let y = wallTop; y >= ridge; y -= 1) put(scratch, x, y, steel.body);
        }
        continue;
      }
      // The SAWTOOTH itself. The sloping deck faces up-left and is therefore
      // LIT; the vertical glazing at the ridge faces the other way and is dark.
      // The first cut ran both at nearly the same value and the roof read as a
      // flat slab with posts on it.
      for (let y = wallTop; y >= ridge; y -= 1) {
        const up = (wallTop - y) / Math.max(1, wallTop - ridge);
        let colour = ruinShade(kit, -0.55, -0.55 - up * 0.34);
        if (up > 0.88) colour = kit.lit;
        if (hash2(chunky(x), chunky(y), seed + 71) > 0.90) colour = kit.shade;
        put(scratch, x, y, colour);
      }
      // The vertical glazed face at the ridge, mostly broken out. Dark, so the
      // saw teeth separate from one another.
      if (inBay > 0.86) {
        for (let y = ridge; y >= ridge - 11; y -= 1) {
          const glazed = hash2(chunky(x), chunky(y), seed + 73) > 0.62;
          put(scratch, x, y, glazed ? steel.shade : kit.outline);
        }
      }
    }
  }

  // Fallen roof rubble heaped inside the collapsed run.
  for (let s = 0; s < 90; s += 1) {
    const sx = Math.round(left + (collapseFrom + hash2(s, variant, seed + 81) * 3) * bayWidth);
    const sy = Math.round(baseY - hash2(s, variant, seed + 83) * 20);
    const sw = 2 + Math.round(hash2(s, variant, seed + 87) * 6);
    for (let x = 0; x < sw; x += 1) {
      put(scratch, sx + x, sy, hash2(s, x, seed + 89) > 0.72 ? steel.body : kit.body);
    }
  }
  // A ground-level apron of spilled debris along the whole frontage.
  for (let s = 0; s < 70; s += 1) {
    const sx = Math.round(left - 4 + hash2(s, variant, seed + 91) * (length + 8));
    const sy = Math.round(baseY + hash2(s, variant, seed + 93) * 3);
    put(scratch, sx, sy, kit.body);
    if (hash2(s, variant, seed + 97) > 0.80) put(scratch, sx + 1, sy, kit.shade);
  }
}

/**
 * A TANK FARM: cylinders on a bund.
 *
 * Cylinders are the second-most legible industrial shape after the cooling
 * tower, and unlike the tower they come in GROUPS — which is exactly the
 * "structures in relationships" the owner asked for, at the scale of one
 * sprite. The bund wall around them is what says the group was engineered
 * rather than dumped.
 *
 * One tank is always split down its side with the spill still stained on the
 * ground beneath it; that is what makes it a ruin instead of a factory.
 */
function paintTankFarmBody(scratch, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 73_000 + variant * 1009;
  const baseY = spec.pivot[1];
  const bundLeft = 8;
  const bundRight = 132;

  // The bund: a low containment wall, drawn first so the tanks stand in it.
  for (let x = bundLeft; x <= bundRight; x += 1) {
    for (let y = baseY; y >= baseY - 9; y -= 1) {
      const down = (baseY - y) / 9;
      let colour = ruinShade(RUIN_CONCRETE, 0.1, 0.5 - down * 1.2);
      // Breached in one place, so the spill had somewhere to go.
      if (x > bundLeft + 74 && x < bundLeft + 92 && down > 0.25
        && hash2(chunky(x), chunky(y), seed + 5) > 0.28) continue;
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.90) colour = RUIN_CONCRETE.shade;
      put(scratch, x, y, colour);
    }
  }

  const tanks = [
    { x: 34, r: 24, h: 62, split: variant !== 1 },
    { x: 82, r: 18, h: 46, split: variant === 1 },
    { x: 114, r: 14, h: 34, split: false },
  ];
  for (const [index, tank] of tanks.entries()) {
    const footY = baseY - 4;
    for (let x = tank.x - tank.r; x <= tank.x + tank.r; x += 1) {
      const across = (x - tank.x) / tank.r;
      if (Math.abs(across) > 1) continue;
      // A vertical cylinder: the top is an ellipse, the side is shaded by
      // |across| with the key upper-left.
      const cap = Math.round(Math.sqrt(Math.max(0, 1 - across * across)) * tank.r * 0.34);
      const topY = footY - tank.h;
      const splitHere = tank.split && across > -0.12 && across < 0.34;
      for (let y = topY - cap; y <= footY; y += 1) {
        const up = (footY - y) / tank.h;
        let colour;
        if (y < topY) {
          // The lid, lit, with a rim.
          colour = ruinShade(kit, across * 0.5, -0.85);
          if (y > topY - 2) colour = kit.shade;
        } else {
          colour = ruinShade(kit, across * 1.15, -0.30);
          // Girth bands: welded courses every 11 px.
          if (Math.round(footY - y) % 11 === 0) colour = kit.shade;
          // Rust blooms running down from the bands.
          if (fbm(x * 0.13, y * 0.09, seed + 11 + index, 2) > 0.66) colour = RUIN_RUST;
        }
        if (splitHere && up < 0.86 && up > 0.06) {
          const tearEdge = Math.abs(across - (-0.12)) < 0.05 || Math.abs(across - 0.34) < 0.05;
          colour = tearEdge ? kit.lit : kit.outline;
        }
        if (hash2(chunky(x), chunky(y), seed + 13 + index) > 0.93) colour = kit.shade;
        put(scratch, x, y, colour);
      }
    }
    // A vertical access ladder on the shaded flank — small, and unmistakably
    // built.
    const ladderX = tank.x + Math.round(tank.r * 0.62);
    for (let y = footY - 3; y >= footY - tank.h + 4; y -= 1) {
      put(scratch, ladderX, y, kit.face);
      if (Math.round(footY - y) % 4 === 0) {
        put(scratch, ladderX + 1, y, kit.face);
        put(scratch, ladderX + 2, y, kit.shade);
      }
    }
  }

  // The spill: a stain running out of the breach, in the SPOIL ramp so the
  // sprite agrees with the terrain material that does the same job.
  for (let s = 0; s < 150; s += 1) {
    const t = hash2(s, variant, seed + 21);
    const sx = Math.round(bundLeft + 70 + t * 62 + hash2(s, 1, seed + 23) * 10);
    const sy = Math.round(baseY - 1 + hash2(s, 2, seed + 27) * 5);
    put(scratch, sx, sy, step(SPOIL, 1 + Math.round(hash2(s, 3, seed + 29) * 2)));
  }
}

/**
 * A CONVEYOR: an inclined belt gantry on trestles.
 *
 * The one piece here that is unambiguously about MOVING something — which is
 * what a works does — and the diagonal it draws is the only strong diagonal in
 * a vocabulary of verticals and horizontals, so it reads immediately as a
 * different kind of thing rather than as another mast.
 */
function paintConveyorBody(scratch, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 74_000 + variant * 1063;
  const baseY = spec.pivot[1];
  const x0 = 12;
  const x1 = 108 + variant * 8;
  const rise = 62 + variant * 6;
  const beltAt = (x) => baseY - 6 - ((x - x0) / (x1 - x0)) * rise;

  // Trestle legs of increasing height, which is what makes the incline read.
  for (const t of [0.08, 0.40, 0.74]) {
    const lx = Math.round(x0 + (x1 - x0) * t);
    const top = Math.round(beltAt(lx)) + 4;
    for (let y = baseY; y >= top; y -= 1) {
      const spread = Math.round((y - top) * 0.13);
      put(scratch, lx - spread, y, kit.face);
      put(scratch, lx + spread, y, kit.shade);
      if (Math.round(baseY - y) % 9 === 0) {
        for (let x = lx - spread; x <= lx + spread; x += 1) put(scratch, x, y, kit.body);
      }
    }
  }

  // The belt housing: a rectangular tube, cross-braced, snapped near the top.
  const snapAt = x0 + (x1 - x0) * (0.82 + variant * 0.06);
  for (let x = x0; x <= x1; x += 1) {
    if (x > snapAt) continue;
    const cy = beltAt(x);
    for (let d = -7; d <= 7; d += 1) {
      const y = Math.round(cy + d);
      const nd = d / 7;
      let colour = ruinShade(kit, 0, nd * 1.25 - 0.15);
      if (Math.abs(d) > 5) colour = kit.body;
      // The open side: you can see the rollers and the belt sagging off them.
      if (Math.abs(d) < 3 && hash2(chunky(x), 0, seed + 5) > 0.40) colour = kit.outline;
      if (Math.abs(d) < 3 && Math.round(x) % 7 === 0) colour = RUIN_RUST;
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.90) colour = kit.shade;
      put(scratch, x, y, colour);
    }
    // Diagonal bracing along the underside.
    if (Math.round(x) % 11 === 0) {
      for (let s = 0; s < 9; s += 1) put(scratch, x + s, Math.round(cy + 7 + s * 0.3), kit.shade);
    }
  }
  // The snapped-off head section, fallen forward off the end.
  const headY = Math.round(beltAt(snapAt));
  for (let s = 0; s < 34; s += 1) {
    const sx = Math.round(snapAt + 2 + hash2(s, variant, seed + 11) * 26);
    const sy = Math.round(headY + 10 + hash2(s, variant, seed + 13) * 26);
    if (sy > baseY) continue;
    for (let w = 0; w < 3; w += 1) {
      put(scratch, sx + w, sy, hash2(s, w, seed + 17) > 0.6 ? RUIN_RUST : kit.body);
    }
  }
  // Spilled material below the run — what the belt was carrying.
  for (let s = 0; s < 120; s += 1) {
    const t = hash2(s, variant, seed + 21);
    const sx = Math.round(x0 + t * (x1 - x0));
    const sy = Math.round(baseY - hash2(s, 1, seed + 23) * 4);
    put(scratch, sx, sy, step(SPOIL, Math.round(hash2(s, 2, seed + 27) * 3)));
  }
}

/**
 * A SPOIL HEAP: tipped tailings, banded by the loads that made it.
 *
 * Ground evidence at sprite scale, and the one prop that carries the `spoil`
 * terrain ramp up off the ground — so a tailings field reads as a field with
 * heaps in it rather than as a stain with unrelated rocks on it.
 */
function paintSpoilHeap(surface, ox, oy, spec, variant) {
  const seed = 75_000 + variant * 1117;
  const { width } = spec;
  const [pivotX, pivotY] = spec.pivot;
  const halfWidth = 30 + variant * 3;
  const height = 26 + variant * 4;
  for (let x = pivotX - halfWidth; x <= pivotX + halfWidth; x += 1) {
    const across = (x - pivotX) / halfWidth;
    if (x < 0 || x >= width) continue;
    // A TIPPED heap, not a hill. Tailings stand at the angle of repose with a
    // flat crest where the tipping ran, so the profile is a trapezoid with
    // straight flanks — the first cut used a smooth dome and at 1:1 it read as
    // a bush, which is the last thing a dead region needs.
    const flank = clamp01((1 - Math.abs(across)) / 0.42);
    const profile = Math.abs(across) < 0.58 ? 1 : flank;
    const crest = Math.round(height * profile
      + (fbm(x * 0.16, variant * 5, seed, 2) - 0.5) * 4);
    for (let y = pivotY; y >= pivotY - crest; y -= 1) {
      const up = (pivotY - y) / Math.max(1, crest);
      let index = level(SPOIL, 0.30 + up * 0.52 - Math.max(0, across) * 0.22);
      // Tipping bands: each load lands as a layer.
      if (Math.round(pivotY - y) % 5 === 0) index -= 1;
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.84) index += 1;
      if (up > 0.92) index += 1;
      put(surface, ox + x, oy + y, step(SPOIL, index));
    }
  }
  // The runoff fan at the toe of the heap.
  for (let s = 0; s < 60; s += 1) {
    const sx = Math.round(pivotX - halfWidth - 3 + hash2(s, variant, seed + 21) * (halfWidth * 2 + 6));
    const sy = Math.round(pivotY + hash2(s, variant, seed + 23) * 3);
    put(surface, ox + sx, oy + sy, step(SPOIL, hash2(s, 1, seed + 27) > 0.5 ? 1 : 0));
  }
}

/**
 * PIPELINE, the connective tissue — and the most important addition here.
 *
 * A single ruin says "something stood here". A pipe run leaving that ruin,
 * crossing four hundred metres of dead ground and arriving at another one says
 * "this was a PLANT" — the relationship is the content, and it costs one 32 px
 * tiling frame family to state.
 *
 * The variants tile at the region's own 32 px pitch:
 *   0, 1  east-west run (two dressings, so a long run is not one sprite
 *         repeated)         2, 3  north-south run        4  east-west end
 *   5  north-south end (a snapped, open pipe mouth).
 *
 * The pipe centre is a FIXED offset in every east-west variant and a fixed
 * column in every north-south variant, so consecutive tiles join exactly. It
 * sits 12 px above the foot line on sleepers, which is why it is drawn but does
 * not block: a half-buried pipe on sleepers is a thing you step over.
 */
function paintPipeline(surface, ox, oy, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 76_000 + variant * 1181;
  const eastWest = variant === 0 || variant === 1 || variant === 4;
  const end = variant >= 4;
  const groundY = spec.pivot[1];
  const pipeY = groundY - 12;
  const pipeX = 16;
  const radius = 5;

  const pipePixel = (along, d, salt) => {
    const nd = d / radius;
    let colour = ruinShade(kit, 0, nd * 1.3 - 0.28);
    // Rust bleeding along the underside of the run.
    if (nd > 0.3 && fbm(along * 0.16, nd * 3, seed + salt, 2) > 0.58) colour = RUIN_RUST;
    if (hash2(chunky(along), chunky(d * 7), seed + salt + 3) > 0.90) colour = kit.shade;
    return colour;
  };

  if (eastWest) {
    const stop = end ? 22 : 32;
    // Sleepers first, so the pipe sits on them.
    for (const sx of [7, 23]) {
      if (sx > stop) continue;
      for (let y = pipeY + radius; y <= groundY; y += 1) {
        for (let w = -2; w <= 2; w += 1) {
          put(surface, ox + sx + w, oy + y, w < 0 ? RUIN_CONCRETE.face : RUIN_CONCRETE.body);
        }
      }
    }
    for (let x = 0; x < stop; x += 1) {
      for (let d = -radius; d <= radius; d += 1) {
        put(surface, ox + x, oy + pipeY + d, pipePixel(x, d, variant));
      }
      // A flange ring: a bolted joint, the detail that says "built in sections".
      if (x === 15 || x === 16) {
        for (let d = -radius - 1; d <= radius + 1; d += 1) {
          put(surface, ox + x, oy + pipeY + d, kit.face);
        }
      }
    }
    if (end) {
      // A snapped, open mouth with the dark bore showing.
      for (let d = -radius; d <= radius; d += 1) {
        const jag = Math.round(hash2(d, variant, seed + 31) * 3);
        for (let x = stop; x < stop + jag; x += 1) {
          put(surface, ox + x, oy + pipeY + d, kit.lit);
        }
      }
      for (let d = -radius + 1; d <= radius - 1; d += 1) {
        put(surface, ox + stop - 1, oy + pipeY + d, kit.outline);
      }
    }
  } else {
    const stop = end ? 24 : spec.height;
    for (let y = 0; y < stop; y += 1) {
      for (let d = -radius; d <= radius; d += 1) {
        put(surface, ox + pipeX + d, oy + y, pipePixel(y, d, variant));
      }
      if (y === 19 || y === 20) {
        for (let d = -radius - 1; d <= radius + 1; d += 1) {
          put(surface, ox + pipeX + d, oy + y, kit.face);
        }
      }
    }
    if (end) {
      for (let d = -radius; d <= radius; d += 1) {
        const jag = Math.round(hash2(d, variant, seed + 37) * 3);
        for (let y = stop; y < stop + jag; y += 1) {
          put(surface, ox + pipeX + d, oy + y, kit.lit);
        }
      }
      for (let d = -radius + 1; d <= radius - 1; d += 1) {
        put(surface, ox + pipeX + d, oy + stop - 1, kit.outline);
      }
    }
  }
}

/**
 * A PIPELINE ELBOW. Variant = the quadrant the run turns through:
 * 0 east+north, 1 east+south, 2 west+south, 3 west+north.
 *
 * Without these a pipe run can only be a straight line, and a straight line
 * across a region reads as a border rather than as plant. A run that turns a
 * corner to reach a building is a run that is going somewhere.
 */
function paintPipeBend(surface, ox, oy, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 77_000 + variant * 1223;
  const groundY = spec.pivot[1];
  const pipeY = groundY - 12;
  const pipeX = 16;
  const radius = 5;
  const east = variant === 0 || variant === 1;
  const north = variant === 0 || variant === 3;

  const draw = (x, y, d) => {
    const nd = d / radius;
    let colour = ruinShade(kit, 0, nd * 1.3 - 0.28);
    if (nd > 0.3 && fbm(x * 0.16, y * 0.16, seed, 2) > 0.58) colour = RUIN_RUST;
    if (hash2(chunky(x), chunky(y), seed + 3) > 0.90) colour = kit.shade;
    put(surface, ox + x, oy + y, colour);
  };

  // The horizontal leg, from the elbow out to the east or west frame edge.
  const hFrom = east ? pipeX : 0;
  const hTo = east ? 32 : pipeX;
  for (let x = hFrom; x < hTo; x += 1) {
    for (let d = -radius; d <= radius; d += 1) draw(x, pipeY + d, d);
  }
  // The vertical leg, from the elbow out to the north or south frame edge.
  const vFrom = north ? 0 : pipeY;
  const vTo = north ? pipeY : spec.height;
  for (let y = vFrom; y < vTo; y += 1) {
    for (let d = -radius; d <= radius; d += 1) draw(pipeX + d, y, d);
  }
  // The elbow casting itself: a fatter, bolted knuckle.
  for (let y = pipeY - radius - 1; y <= pipeY + radius + 1; y += 1) {
    for (let x = pipeX - radius - 1; x <= pipeX + radius + 1; x += 1) {
      const dx = (x - pipeX) / (radius + 1);
      const dy = (y - pipeY) / (radius + 1);
      if (dx * dx + dy * dy > 1) continue;
      const rim = dx * dx + dy * dy > 0.62;
      put(surface, ox + x, oy + y, rim ? kit.face : ruinShade(kit, dx, dy * 1.2 - 0.3));
    }
  }
  // A support pedestal under the knuckle.
  for (let y = pipeY + radius; y <= groundY; y += 1) {
    for (let w = -3; w <= 3; w += 1) {
      put(surface, ox + pipeX + w, oy + y, w < 0 ? RUIN_CONCRETE.face : RUIN_CONCRETE.body);
    }
  }
}

/**
 * PERIMETER FENCING. Variants 0/1 east-west, 2/3 north-south.
 *
 * The quietest piece in the vocabulary and one of the most useful: a fence line
 * is what turns "ruins standing on ground" into "ruins standing INSIDE
 * something". It is drawn torn through in places and it NEVER blocks movement —
 * a perimeter that blocked would quarter the region, and a fence a body cannot
 * step through is not what a fifty-year-dead fence is.
 */
function paintFenceLine(surface, ox, oy, spec, variant) {
  const kit = RUIN_STEEL;
  const seed = 78_000 + variant * 1279;
  const groundY = spec.pivot[1];
  const eastWest = variant === 0 || variant === 1;
  const torn = variant === 1 || variant === 3;
  const postHeight = 18;

  const post = (px, lean) => {
    for (let y = groundY; y >= groundY - postHeight; y -= 1) {
      const up = (groundY - y) / postHeight;
      const x = Math.round(px + up * lean);
      put(surface, ox + x, oy + y, kit.face);
      put(surface, ox + x + 1, oy + y, kit.shade);
    }
  };

  if (eastWest) {
    post(6, torn ? 2.5 : 0);
    post(22, 0);
    // Three wire courses, sagging between the posts, broken where torn.
    for (const [index, offset] of [4, 9, 15].entries()) {
      for (let x = 0; x < 32; x += 1) {
        if (torn && x > 9 && x < 21 && hash2(x, index, seed) > 0.25) continue;
        const sag = Math.sin(((x % 16) / 16) * Math.PI) * (torn ? 3.2 : 1.1);
        const y = Math.round(groundY - postHeight + offset + sag);
        put(surface, ox + x, oy + y, hash2(chunky(x), index, seed + 3) > 0.75
          ? RUIN_RUST : kit.body);
      }
    }
  } else {
    post(15, 0);
    for (const [index, offset] of [4, 9, 15].entries()) {
      for (let y = 0; y < spec.height; y += 1) {
        if (torn && y > 12 && y < 26 && hash2(y, index, seed) > 0.25) continue;
        const x = Math.round(16 - 7 + offset + (hash2(chunky(y), index, seed + 5) - 0.5) * 1.6);
        put(surface, ox + x, oy + y, hash2(chunky(y), index, seed + 7) > 0.75
          ? RUIN_RUST : kit.body);
      }
    }
  }
}

/** Scenery sheet width. Frames are shelf-packed in spec order. */
const SCENERY_COLUMNS = 640;
const SCENERY_ROWS = 1600;

/**
 * The GROUND CONTACT of the frame currently being painted, if the painter
 * measured it itself. `paintRuin` sets this from the object's own body scratch,
 * BEFORE the cast shadow is laid down — a ruin frame is mostly reserved shadow
 * room, and a contact rect that included the shadow would block a tower's worth
 * of ground to its lower right where nothing is standing.
 */
let measuredContact = null;

/**
 * Measure the tiles-worth of ground a frame actually stands on.
 *
 * This is the production half of the per-species footprint problem that BOTH
 * region pilots reported independently: a ruin blocks one tile while being
 * drawn two to five tiles wide, so a being walks through a cooling tower's
 * skirt. The fix is that the ART declares its own footprint and the scene
 * converts it to tiles (`navigation/propFootprints.ts`), which means it can
 * never drift from the picture — re-author a wider tower and the collision
 * widens with it, with no table to keep in sync.
 *
 * The window is the eight rows around the foot line, which is the band a
 * top-down viewer reads as "touching the ground".
 */
function measureGroundContact(scratch, spec) {
  const [pivotX, pivotY] = spec.pivot;
  const from = Math.max(0, pivotY - 5);
  const to = Math.min(scratch.height - 1, pivotY + 2);
  let lo = scratch.width;
  let hi = -1;
  for (let y = from; y <= to; y += 1) {
    for (let x = 0; x < scratch.width; x += 1) {
      if (scratch.data[(y * scratch.width + x) * 4 + 3] < 160) continue;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  if (hi < lo) {
    // Nothing opaque at the foot line: fall back to a single tile under the
    // pivot, which is exactly the pre-footprint behaviour.
    return { x: Math.max(0, pivotX - 6), y: from, width: 12, height: to - from + 1 };
  }
  return { x: lo, y: from, width: hi - lo + 1, height: to - from + 1 };
}

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
      // Every frame is painted into its OWN scratch first, so its ground
      // contact can be measured from the pixels rather than declared in a table
      // that would drift from them. The scratch is then blitted onto the sheet.
      const scratch = createSurface(spec.width, spec.height);
      measuredContact = null;
      // Ruins size their own contact pool from their measured footprint and
      // then add a real cast shadow; the generic ellipse would be wrong for
      // them because their frames are mostly shadow room.
      const carriesOwnShadow = spec.id === "causeway" || spec.id === "emberwisp"
        || spec.id === "ashripple" || spec.id === "pipeline" || spec.id === "pipebend"
        || spec.id === "fenceline" || spec.ruin !== undefined;
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = spec.pivot;
        paintContactShadow(
          scratch, 0, 0, pivotX, pivotY + 2,
          Math.max(5, spec.width * 0.30),
          Math.max(3, spec.height * 0.075),
          0.46,
        );
      }
      switch (spec.id) {
        case "snag":
          paintCharredStanding(scratch, 0, 0, spec, variant, false);
          break;
        case "snagtall":
          paintCharredStanding(scratch, 0, 0, spec, variant, true);
          break;
        case "snagfallen":
          paintSnagFallen(scratch, 0, 0, spec, variant);
          break;
        case "stump":
          paintStump(scratch, 0, 0, spec, variant);
          break;
        case "slagrock":
          paintSlagRock(scratch, 0, 0, spec, variant);
          break;
        case "ashpile":
          paintAshPile(scratch, 0, 0, spec, variant);
          break;
        case "ejecta":
          paintEjecta(scratch, 0, 0, spec, variant);
          break;
        case "clinkerchunk":
          paintClinkerChunk(scratch, 0, 0, spec, variant);
          break;
        case "deadbrush":
          paintDeadBrush(scratch, 0, 0, spec, variant);
          break;
        case "ashripple":
          paintAshRipple(scratch, 0, 0, spec, variant);
          break;
        case "glassshard":
          paintGlassShard(scratch, 0, 0, spec, variant);
          break;
        case "emberwisp":
          paintEmberWisp(scratch, 0, 0, spec, variant);
          break;
        case "pylon":
          paintPylon(scratch, 0, 0, spec, variant);
          break;
        case "causeway":
          paintCauseway(scratch, 0, 0, spec, variant);
          break;
        case "coolingtower":
          paintRuin(scratch, 0, 0, spec, variant, paintCoolingTowerBody, 0.66);
          break;
        case "coolingtowerbig":
          paintRuin(scratch, 0, 0, spec, variant, paintCoolingTowerBigBody, 0.52);
          break;
        case "reactorhusk":
          paintRuin(scratch, 0, 0, spec, variant, paintReactorHuskBody, 0.64);
          break;
        case "gantry":
          paintRuin(scratch, 0, 0, spec, variant, paintGantryBody, 0.56);
          break;
        case "stack":
          paintRuin(scratch, 0, 0, spec, variant, paintStackBody, 0.66);
          break;
        case "turbinehall":
          paintRuin(scratch, 0, 0, spec, variant, paintTurbineHallBody, 0.60);
          break;
        case "tankfarm":
          paintRuin(scratch, 0, 0, spec, variant, paintTankFarmBody, 0.62);
          break;
        case "conveyor":
          paintRuin(scratch, 0, 0, spec, variant, paintConveyorBody, 0.58);
          break;
        case "spoilheap":
          paintSpoilHeap(scratch, 0, 0, spec, variant);
          break;
        case "pipeline":
          paintPipeline(scratch, 0, 0, spec, variant);
          break;
        case "pipebend":
          paintPipeBend(scratch, 0, 0, spec, variant);
          break;
        case "fenceline":
          paintFenceLine(scratch, 0, 0, spec, variant);
          break;
        default:
          throw new Error(`unhandled scenery ${spec.id}`);
      }
      const contact = measuredContact ?? measureGroundContact(scratch, spec);
      blitScratch(surface, ox, oy, scratch);
      records.push({
        id: `s.${spec.id}.${variant}`,
        image: "scenery",
        rect: { x: ox, y: oy, width: spec.width, height: spec.height },
        pivot: { x: spec.pivot[0], y: spec.pivot[1] },
        contact,
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
// output (verbatim from the Warm Springs pilot)
// ---------------------------------------------------------------------------

/**
 * Encode a surface as an 8-bit INDEXED PNG, losslessly. The palette is not
 * derived, it is DISCOVERED: every painter chooses a fixed palette entry, so
 * the sheet already contains fewer than 256 distinct RGBA tuples. Overflowing
 * 256 is a hard error.
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

export async function authorNirvanaWestLiveArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
  await mkdir(outputRoot, { recursive: true });
  const terrain = buildTerrainAtlas();
  const scenery = buildSceneryAtlas();
  const environment = buildEnvironmentAtlas();
  const terrainInfo = await writeSurface(terrain.surface, path.join(outputRoot, "terrain.png"));
  const sceneryInfo = await writeSurface(scenery.surface, path.join(outputRoot, "scenery.png"));
  const environmentInfo = await writeSurface(
    environment.surface,
    path.join(outputRoot, "environment.png"),
  );
  const atlas = {
    schema: 2,
    tileSize: TILE,
    region: "nirvana-west",
    materials: MATERIALS,
    fieldMaterials: FIELD_MATERIALS,
    blockingMaterials: BLOCKING_MATERIALS,
    voidMaterials: VOID_MATERIALS,
    rimMaterials: RIM_MATERIALS,
    plainTiers: PLAIN_TIERS,
    cornerBits: { nw: 1, ne: 2, se: 4, sw: 8 },
    edgeVariants: EDGE_VARIANTS_BY_MATERIAL,
    baseVariants: BASE_VARIANTS,
    rimVariants: RIM_VARIANTS,
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
      environment: {
        file: "environment.png",
        width: environment.surface.width,
        height: environment.surface.height,
        colours: distinctColours(environment.surface),
        ...environmentInfo,
      },
    },
    /**
     * The animated-environment binding, in the PRODUCTION shape: kind `i` owns
     * cells `i*4 .. i*4+3` of an 8-column grid of 32 px cells, four frames at
     * 160 ms each. See the ANIMATED ENVIRONMENT block in this script.
     */
    environmentGrid: {
      image: "environment",
      columns: ENVIRONMENT_GRID_COLUMNS,
      cell: ENVIRONMENT_CELL,
      frameCount: ANIMATED_FRAME_COUNT,
      frameMs: 160,
      kinds: environment.kinds,
    },
    terrainGrid: {
      image: "terrain",
      columns: TERRAIN_COLUMNS,
      cell: TILE,
      ids: terrain.records.map((record) => record.id),
    },
    /**
     * `[id, x, y, w, h, pivotX, pivotY, contactX, contactY, contactW, contactH]`.
     *
     * The last four fields are the PRODUCTION addition: the frame's own measured
     * GROUND CONTACT, in frame-local pixels. It is what
     * `navigation/propFootprints.ts` converts into the tiles a prop blocks, and
     * it is measured from the painted pixels rather than declared in a table, so
     * a re-authored sprite can never disagree with its own collision.
     */
    sceneryFrames: scenery.records.map((record) => [
      record.id,
      record.rect.x, record.rect.y, record.rect.width, record.rect.height,
      record.pivot.x, record.pivot.y,
      record.contact.x, record.contact.y, record.contact.width, record.contact.height,
    ]),
  };
  await writeFile(path.join(outputRoot, "atlas.json"), `${JSON.stringify(atlas)}\n`, "utf8");
  return { ...atlas, frames: [...terrain.records, ...scenery.records] };
}

const REGION_CEILING = 196_608;
const REGION_TARGET = 145_000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorNirvanaWestLiveArt()
    .then(async (atlas) => {
      const { stat } = await import("node:fs/promises");
      const json = await stat(path.join(DEFAULT_OUTPUT_ROOT, "atlas.json"));
      const art = atlas.images.terrain.bytes + atlas.images.scenery.bytes
        + atlas.images.environment.bytes;
      const total = art + json.size;
      const terrainFrames = atlas.terrainGrid.ids.length;
      const sceneryFrames = atlas.sceneryFrames.length;
      process.stdout.write(
        `authored ${atlas.frames.length} Nirvana West PRODUCTION frames`
        + ` (${terrainFrames} terrain + ${sceneryFrames} scenery)\n`
        + `  terrain ${atlas.images.terrain.width}x${atlas.images.terrain.height} `
        + `${atlas.images.terrain.bytes} B, ${atlas.images.terrain.colours} colours, `
        + `${atlas.images.terrain.encoding}\n`
        + `  scenery ${atlas.images.scenery.width}x${atlas.images.scenery.height} `
        + `${atlas.images.scenery.bytes} B, ${atlas.images.scenery.colours} colours, `
        + `${atlas.images.scenery.encoding}\n`
        + `  environment ${atlas.images.environment.width}x${atlas.images.environment.height} `
        + `${atlas.images.environment.bytes} B, ${atlas.images.environment.colours} colours, `
        + `${atlas.images.environment.encoding} `
        + `(${atlas.environmentGrid.kinds.join(", ")})\n`
        + `  atlas.json ${json.size} B\n`
        + `  art total ${art} B; +metadata = ${total} B\n`
        + `  target ${REGION_TARGET} -> ${(total / REGION_TARGET * 100).toFixed(1)}% used\n`
        + `  region ceiling ${REGION_CEILING} -> ${(total / REGION_CEILING * 100).toFixed(1)}% used\n`,
      );
    })
    .catch((error) => {
      process.stderr.write(`${error.stack ?? error}\n`);
      process.exitCode = 1;
    });
}
