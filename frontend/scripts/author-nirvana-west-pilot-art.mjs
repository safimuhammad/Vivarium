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
  "../src/qa/nirvanaWestPilot/assets",
);

export const TILE = 32;

// ---------------------------------------------------------------------------
// the frozen material contract - MUST mirror nirvanaWestMaterials.ts exactly
// ---------------------------------------------------------------------------

export const MATERIALS = Object.freeze([
  "ember",
  "emberdim",
  "brine",
  "glass",
  "cinder",
  "slatedark",
  "slate",
  "dust",
  "ash",
  "ashpale",
  "clinker",
  "scree",
  "rime",
  "causeway",
]);

export const MATERIAL_PRIORITY = Object.freeze(
  Object.fromEntries(MATERIALS.map((id, index) => [id, index])),
);

/** The thirteen materials the corner field may sample. `causeway` is not one. */
export const FIELD_MATERIALS = Object.freeze(MATERIALS.slice(0, 13));

/** Ground a body cannot cross. */
export const BLOCKING_MATERIALS = Object.freeze(["ember", "brine", "clinker", "scree", "rime"]);

/** Materials whose interiors read as "void" - a bank tile against these gets a rim line. */
export const VOID_MATERIALS = Object.freeze(["ember", "emberdim", "brine"]);

/** Bank materials that carry an authored rim line against the void family. */
export const RIM_MATERIALS = Object.freeze(["cinder", "ashpale", "clinker"]);

/** The five tonal tiers of one plain, dark to pale - the gradient that hides the 32px lattice. */
export const PLAIN_TIERS = Object.freeze(["cinder", "slatedark", "slate", "dust", "ash", "ashpale"]);

export const BASE_VARIANTS = 8;

/** Transition variants per material - FROZEN by the contract. MUST match the .ts file. */
export const EDGE_VARIANTS_BY_MATERIAL = Object.freeze({
  ember: 1,
  emberdim: 1,
  brine: 1,
  glass: 2,
  cinder: 2,
  slatedark: 1,
  slate: 2,
  dust: 1,
  ash: 2,
  ashpale: 1,
  clinker: 2,
  scree: 1,
  rime: 1,
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
const BRINE = Object.freeze([[16, 12, 26], [23, 18, 35], [32, 26, 44], [42, 36, 56]]);
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
const RIME = Object.freeze([[185, 195, 212], [208, 212, 226], [226, 228, 238], [240, 240, 248]]);
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
  brine: BRINE,
  glass: GLASS,
  cinder: CINDER,
  slatedark: SLATEDARK,
  slate: SLATE,
  dust: DUST,
  ash: ASH,
  ashpale: ASHPALE,
  clinker: CLINKER,
  scree: SCREE,
  rime: RIME,
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
    return step(BRINE, level(BRINE, 0.30 + heat * 0.45));
  }
  // The plates themselves: near-black chilled crust, each plate its own value,
  // with a faint warm underglow only where the vent field is strongest.
  let index = level(BRINE, 0.02 + hash2(facet.nearKey, 3, seed + 111) * 0.30);
  if (hash2(chunky(wx), chunky(wy), seed + 113) > 0.90) index += 1;
  if (vent > 0.72 && joint < 2.3 && hash2(chunky(wx), chunky(wy), seed + 117) > 0.72) {
    return step(seamPalette, 0);
  }
  return step(BRINE, index);
}

/**
 * Dead standing meltwater: near-black and MATTE - a broad low-frequency
 * violet sheen only, no isolated highlights (the pale crystalline crust that
 * "creeps in from the edges" is the rim system's job - see `paintRimTile` -
 * not a speck scattered through the interior, which read as a starfield).
 */
function brinePixel(wx, wy, seed) {
  const swell = fbm(wx * 0.028, wy * 0.028, seed + 101, 3);
  const ripple = fbm(wx * 0.09, wy * 0.09, seed + 109, 2);
  let index = level(BRINE, 0.24 + swell * 0.44 + (ripple - 0.5) * 0.10);
  return step(BRINE, index);
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

/** Crystalline salt-frost crust: blocky, faceted, blue-white, a subtle hard sparkle. */
function rimePixel(wx, wy, seed) {
  const cellSize = 9;
  const facet = angularFacet(wx, wy, seed, cellSize);
  const low = Math.min(facet.nearKey, facet.secondKey);
  const high = Math.max(facet.nearKey, facet.secondKey);
  const welded = hash2(low, high, seed + 161) < 0.55;
  const blockKey = welded ? low : facet.nearKey;
  let index = level(RIME, 0.30 + hash2(blockKey, 7, seed + 157) * 0.55);
  index += facet.localY < -cellSize * 0.18 ? 1 : facet.localY > cellSize * 0.20 ? -1 : 0;
  const joint = facet.second - facet.nearest;
  if (!welded && joint < 1.2) index -= 2;
  if (hash2(chunky(wx), chunky(wy), seed + 163) > 0.94) return step(RIME, 3);
  return step(RIME, index);
}

export function materialPixel(material, wx, wy, seed) {
  switch (material) {
    case "ember":
      return crustPixel(EMBER, wx, wy, seed);
    case "emberdim":
      return crustPixel(EMBERDIM, wx, wy, seed);
    case "brine":
      return brinePixel(wx, wy, seed);
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
    case "rime":
      return rimePixel(wx, wy, seed);
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
  rime: { drop: [1, 1], speck: 0.92 },
  glass: { drop: [1, 1], speck: 0.94 },
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

const SCENERY_SPECS = Object.freeze([
  // THE signature shape: a black silhouette against pale ash.
  { id: "snag", width: 32, height: 72, variants: 4, pivot: [16, 68] },
  { id: "snagtall", width: 28, height: 88, variants: 3, pivot: [14, 84] },
  { id: "snagfallen", width: 56, height: 24, variants: 3, pivot: [28, 21] },
  { id: "stump", width: 24, height: 20, variants: 3, pivot: [12, 18] },
  { id: "slagrock", width: 40, height: 32, variants: 4, pivot: [20, 29] },
  { id: "ashpile", width: 40, height: 24, variants: 4, pivot: [20, 21] },
  { id: "bonestone", width: 24, height: 44, variants: 4, pivot: [12, 41] },
  { id: "ejecta", width: 40, height: 32, variants: 3, pivot: [20, 29] },
  { id: "clinkerchunk", width: 28, height: 20, variants: 3, pivot: [14, 18] },
  { id: "rimecluster", width: 24, height: 20, variants: 3, pivot: [12, 18] },
  { id: "deadbrush", width: 32, height: 28, variants: 3, pivot: [16, 26] },
  { id: "ashripple", width: 32, height: 20, variants: 4, pivot: [16, 18] },
  { id: "glassshard", width: 20, height: 28, variants: 3, pivot: [10, 26] },
  // Last-pass overlay: a faint heat shimmer / thin smoke.
  { id: "emberwisp", width: 40, height: 56, variants: 3, pivot: [20, 50] },
  // The only built thing in the region: a ruin.
  { id: "pylon", width: 40, height: 96, variants: 2, pivot: [20, 92] },
  { id: "slabtilt", width: 28, height: 36, variants: 3, pivot: [14, 33] },
  { id: "dunecrest", width: 48, height: 20, variants: 3, pivot: [24, 18] },
  // Causeway deck: 0/1 EW straight, 2/3 NS straight, 4 EW end, 5 NS end.
  { id: "causeway", width: 32, height: 32, variants: 6, pivot: [16, 31] },

  // --- v2 RUINS -----------------------------------------------------------
  // Frames are much wider and a little taller than the object they hold: the
  // spare room to the RIGHT and BELOW the pivot is where the cast shadow goes.
  // Ruin kit A, "ancient" - catastrophic without asserting industry.
  { id: "monolith", width: 116, height: 132, variants: 3, pivot: [26, 96], ruin: "ancient" },
  { id: "slumpwall", width: 148, height: 96, variants: 3, pivot: [44, 74], ruin: "ancient" },
  { id: "boneforest", width: 144, height: 124, variants: 3, pivot: [33, 94], ruin: "ancient" },
  { id: "ashbarrow", width: 124, height: 60, variants: 3, pivot: [39, 44], ruin: "ancient" },
  // Ruin kit B, "industrial" - the alternative the owner is being asked about.
  { id: "coolingtower", width: 184, height: 176, variants: 2, pivot: [50, 132], ruin: "industrial" },
  { id: "reactorhusk", width: 184, height: 136, variants: 2, pivot: [52, 106], ruin: "industrial" },
  { id: "gantry", width: 164, height: 120, variants: 3, pivot: [22, 88], ruin: "industrial" },
  { id: "stack", width: 176, height: 164, variants: 3, pivot: [28, 124], ruin: "industrial" },
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

function paintBoneStone(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 45_000 + variant * 811;
  const centerX = width / 2;
  const baseY = height - 3;
  const topY = Math.round(height * 0.10);
  for (let y = topY; y <= baseY; y += 1) {
    const t = (y - topY) / Math.max(1, baseY - topY);
    const lean = Math.sin(t * 1.1 + variant) * 1.6;
    const halfWidth = width * 0.30 * (0.55 + (1 - Math.abs(t - 0.5) * 1.1) * 0.5);
    const cx = centerX + lean;
    for (let x = Math.round(cx - halfWidth); x <= cx + halfWidth; x += 1) {
      const across = (x - cx) / Math.max(0.6, halfWidth);
      let index = level(ASHPALE, 0.35 + (1 - Math.abs(across)) * 0.45 - t * 0.20);
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.86) index -= 1;
      put(surface, ox + x, oy + y, step(ASHPALE, index));
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

function paintRimeCluster(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 48_000 + variant * 691;
  const shards = 3 + (variant % 2);
  for (let index = 0; index < shards; index += 1) {
    const baseX = width * (0.20 + hash2(index, variant, seed) * 0.62);
    const baseY = height - 3 - hash2(index, variant, seed + 3) * 3;
    const tipH = 6 + hash2(index, variant, seed + 5) * 8;
    const lean = (hash2(index, variant, seed + 7) - 0.5) * 4;
    for (let s = 0; s < tipH; s += 1) {
      const t = s / tipH;
      const x = Math.round(baseX + lean * t);
      const y = Math.round(baseY - s);
      const halfWidth = Math.max(0.5, (1 - t) * 1.6);
      for (let w = -halfWidth; w <= halfWidth; w += 1) {
        const idx = level(RIME, 0.5 + (1 - t) * 0.4 - Math.abs(w) * 0.1);
        put(surface, ox + Math.round(x + w), oy + y, step(RIME, idx));
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
 * An upthrust slate plate: a flat plate seen edge-on, leaning, with a bright
 * lit top edge, a shaded front face darkening toward the base, a dark
 * shadowed strip on its uphill side, and a cast shadow trailing downhill.
 */
function paintSlabTilt(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 54_000 + variant * 1289;
  const baseY = height - 2;
  const tiltDir = hash2(variant, 1, seed) > 0.5 ? 1 : -1;
  const topX = width * 0.5 + width * (0.14 + hash2(variant, 2, seed) * 0.10) * tiltDir;
  const topY = Math.round(height * (0.10 + hash2(variant, 3, seed) * 0.10));
  const footX = width * 0.5 - width * 0.08 * tiltDir;
  const plateWidth = width * (0.38 + hash2(variant, 4, seed) * 0.12);
  for (let y = topY; y <= baseY; y += 1) {
    const t = (y - topY) / Math.max(1, baseY - topY);
    const cx = topX + (footX - topX) * t;
    const halfWidth = plateWidth * (0.55 + t * 0.45) * 0.5;
    for (let x = Math.round(cx - halfWidth); x <= cx + halfWidth; x += 1) {
      const across = (x - cx) / Math.max(0.6, halfWidth);
      let colour;
      if (Math.abs(across) > 0.80 || y === topY) {
        colour = OUTLINE; // a crisp silhouette edge, readable against any ground
      } else if (y - topY <= 2) {
        colour = SLATE[3]; // the bright lit top edge
      } else if (across < -0.40) {
        colour = SLATE[0]; // the dark shadowed underside face
      } else {
        let index = level(SLATE, 0.34 - t * 0.20);
        if (hash2(chunky(x), chunky(y), seed + 5) > 0.86) index -= 1;
        colour = step(SLATE, index);
      }
      put(surface, ox + x, oy + y, colour);
    }
  }
  for (let s = 0; s < 6; s += 1) {
    const x = Math.round(footX + plateWidth * 0.5 + s);
    veil(surface, ox + x, oy + baseY, ACCENT.shadow, 0.40 - s * 0.06);
  }
}

/** A wind-drift crest: a clean crest line and a shadowed lee, soft not speckled. */
function paintDuneCrest(surface, ox, oy, spec, variant) {
  const { width, height } = spec;
  const seed = 55_000 + variant * 1213;
  const crestY = height * 0.42;
  for (let x = 0; x < width; x += 1) {
    const t = x / width;
    const rise = Math.sin(t * Math.PI) ** 0.7;
    const top = Math.round(crestY - rise * height * 0.36 + (fbm(x * 0.07, variant * 5, seed, 2) - 0.5) * 1.6);
    for (let y = top; y < height; y += 1) {
      const depth = (y - top) / Math.max(1, height - top);
      let index = level(ASH, 0.62 - depth * 0.44 + rise * 0.10);
      if (y - top <= 1) index = level(ASH, 0.95);
      const grain = fbm(chunky(x) * 0.4, chunky(y) * 0.4, seed + 3, 2);
      if (grain > 0.86) index += 1;
      else if (grain < 0.18) index -= 1;
      put(surface, ox + x, oy + y, step(ASH, index));
    }
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
  for (let y = 0; y <= footY && y < scratch.height; y += 1) {
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
const ANIMATED_KINDS = Object.freeze(["ember", "ember-vent", "smoke-anchor", "heat-haze"]);

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
  const drift = Math.sin((phase / ANIMATED_FRAME_COUNT) * TAU) * 4.0;
  paintGlowPool(surface, ox, oy, 16 + drift * 0.8, 25, 12, 6, phase, 0.62);
  paintFlameTongue(surface, ox, oy, 15.5 + drift, 26, 13, 2.6, phase, 3, 1.0);
  paintFlameTongue(surface, ox, oy, 20.5 + drift * 0.6, 27, 8, 1.7, (phase + 2) % 4, 9, 0.86);
  paintFlameTongue(surface, ox, oy, 11.0 + drift * 0.7, 27, 6, 1.4, (phase + 1) % 4, 17, 0.78);
}

/** Kind 1 - `ember-vent`: a real column of fire out of an open vent. */
function paintEmberVentCell(surface, ox, oy, phase) {
  const drift = Math.cos((phase / ANIMATED_FRAME_COUNT) * TAU) * 2.6;
  paintGlowPool(surface, ox, oy, 16 + drift * 0.5, 26, 15, 8, phase, 0.90);
  paintFlameTongue(surface, ox, oy, 16 + drift, 28, 24, 4.4, phase, 5, 1.0);
  paintFlameTongue(surface, ox, oy, 10.5 + drift, 28, 15, 2.6, (phase + 2) % 4, 13, 0.92);
  paintFlameTongue(surface, ox, oy, 22.0 + drift, 28, 17, 2.8, (phase + 3) % 4, 23, 0.94);
  paintFlameTongue(surface, ox, oy, 16.5 + drift, 29, 9, 1.8, (phase + 1) % 4, 31, 0.80);
  // Sparks lifting off the top of the column.
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  for (let s = 0; s < 5; s += 1) {
    const sx = Math.round(16 + Math.sin(t + s * 1.9) * 6 + (hash2(s, 0, 77) - 0.5) * 5);
    const sy = Math.round(6 - (phase + s * 1.3) % 4 + hash2(s, 1, 79) * 4);
    if (sy < 0) continue;
    setPixel(surface, ox + sx, oy + sy, [...FLAME[4], quantiseAlpha(0.7)]);
  }
}

/** Kind 2 - `smoke-anchor`: ash smoke lifting off cooling ground and drifting. */
function paintSmokeCell(surface, ox, oy, phase) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  for (let puff = 0; puff < 4; puff += 1) {
    const life = ((phase + puff) % ANIMATED_FRAME_COUNT) / ANIMATED_FRAME_COUNT;
    const cy = 27 - life * 22;
    const cx = 16 + life * 6 + Math.sin(t + puff * 1.7) * 2.4;
    const r = 3.2 + life * 5.2;
    const alpha = (1 - life) * 0.62;
    for (let y = Math.round(cy - r); y <= cy + r; y += 1) {
      for (let x = Math.round(cx - r * 1.15); x <= cx + r * 1.15; x += 1) {
        const d = Math.hypot((x - cx) / (r * 1.15), (y - cy) / r);
        if (d > 1) continue;
        const lump = fbm(x * 0.34 + puff * 9, y * 0.34, 8801 + puff, 2);
        if (lump < 0.34 + d * 0.4) continue;
        const colour = SMOKE[level(SMOKE, 0.30 + (1 - d) * 0.55 - life * 0.25)];
        setPixel(surface, ox + x, oy + y, [
          colour[0], colour[1], colour[2], quantiseAlpha(alpha * (1 - d * 0.55)),
        ]);
      }
    }
  }
}

/**
 * Kind 3 - `heat-haze`: the air over hot ground, moving.
 *
 * Deliberately almost nothing - a few translucent warm ribbons that slide
 * sideways between frames. Its whole job is that the ground next to a fissure
 * should never be perfectly still, which is a different claim from "there is
 * something here".
 */
function paintHeatHazeCell(surface, ox, oy, phase) {
  const t = (phase / ANIMATED_FRAME_COUNT) * TAU;
  for (let y = 6; y < 28; y += 1) {
    const wob = Math.sin(t + y * 0.30) * 4.2;
    const band = fbm((y + Math.sin(t) * 2) * 0.30, phase * 0.31, 9001, 2);
    if (band < 0.42) continue;
    const halfSpan = 8 + band * 8;
    const cx = 16 + wob;
    for (let x = Math.round(cx - halfSpan); x <= cx + halfSpan; x += 1) {
      const across = Math.abs(x - cx) / halfSpan;
      // Stippled and WIDE rather than a stroke. The first cut was narrow and
      // near-vertical and at 1:1 the placements read as scratches on the
      // ground, which is worse than no haze at all.
      if (hash2(x, y + phase * 31, 9007) > 0.34 * (1 - across ** 2)) continue;
      setPixel(surface, ox + x, oy + y, [...WISP_WARM, ALPHA_LEVELS[1]]);
    }
  }
}

function buildEnvironmentAtlas() {
  const surface = createSurface(ENVIRONMENT_COLUMNS, ENVIRONMENT_ROWS);
  const painters = [paintEmberCell, paintEmberVentCell, paintSmokeCell, paintHeatHazeCell];
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

/** A slab of vitrified ground thrown on end and cracked. */
function paintMonolithBody(scratch, spec, variant) {
  const kit = RUIN_GLASS;
  const seed = 61_000 + variant * 733;
  const baseY = spec.pivot[1];
  const topY = 8 + variant * 5;
  const lean = variant === 1 ? -0.20 : 0.16 + variant * 0.06;
  const baseHalf = 16 + variant * 2;
  const tipHalf = 9.5;
  // The broken crown: a per-column top so the silhouette is torn, not sawn.
  for (let y = baseY; y >= topY; y -= 1) {
    const up = (baseY - y) / (baseY - topY);
    const cx = 26 + (baseY - y) * lean;
    const half = baseHalf + (tipHalf - baseHalf) * up;
    for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
      const across = (x - cx) / half;
      // A torn top edge: this column's own crown height.
      const crown = topY + Math.round(fbm(x * 0.22, variant * 5, seed, 2) * 11);
      if (y < crown) continue;
      let colour;
      if (x <= Math.round(cx - half)) colour = kit.lit;
      else if (x >= Math.round(cx + half)) colour = kit.outline;
      else colour = ruinShade(kit, across, -0.30 - up * 0.25);
      // Conchoidal fractures across the face - this is broken glass, and the
      // fractures are what tell you the slab has thickness.
      const frac = Math.abs(fbm(x * 0.10 + 4, y * 0.16, seed + 31, 2) - 0.5);
      if (frac < 0.020) colour = kit.shade;
      else if (frac < 0.038 && across < 0.1) colour = kit.face;
      if (y <= crown + 1) colour = kit.lit;
      put(scratch, x, y, colour);
    }
  }
  // Broken shards at the foot, so it looks fallen rather than planted.
  for (let s = 0; s < 7; s += 1) {
    const sx = Math.round(26 + (hash2(s, variant, seed + 41) - 0.5) * 42);
    const sw = 2 + Math.round(hash2(s, variant, seed + 43) * 4);
    const sh = 2 + Math.round(hash2(s, variant, seed + 47) * 3);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        put(scratch, sx + x, baseY - y, ruinShade(kit, x / sw - 0.5, -y / sh));
      }
    }
  }
}

/** A run of wall welded into slag: a lit top plane, a shaded face, rubble. */
function paintSlumpWallBody(scratch, spec, variant) {
  const kit = RUIN_EJECTA;
  const seed = 62_000 + variant * 811;
  const baseY = spec.pivot[1];
  const left = 4;
  const right = 4 + 76;
  for (let x = left; x <= right; x += 1) {
    const t = (x - left) / (right - left);
    // A broken profile with a real gap where the wall has fallen through.
    const gap = fbm(x * 0.055, variant * 7, seed + 3, 2);
    if (gap < 0.36 && t > 0.30 && t < 0.52) continue;
    const crest = 30 + Math.round(fbm(x * 0.075, variant * 3, seed, 2) * 28 - t * 8);
    const topY = baseY - crest;
    // Top plane: 3-4 rows of the brightest value, which is what reads as "this
    // has a top" from directly above.
    for (let y = topY; y <= topY + 3; y += 1) {
      put(scratch, x, y, y === topY ? kit.lit : kit.face);
    }
    // The face below the top plane, falling into shadow toward the foot.
    for (let y = topY + 4; y <= baseY; y += 1) {
      const down = (y - topY) / Math.max(1, crest);
      let colour = ruinShade(kit, 0.15, down * 1.5 - 0.4);
      if (hash2(chunky(x), chunky(y), seed + 11) > 0.86) colour = kit.shade;
      // Coursing: this was built in lifts, and the lifts still show.
      if ((y - topY) % 7 === 0 && down < 0.9) colour = kit.shade;
      put(scratch, x, y, colour);
    }
  }
  // Collapse rubble spilling right, where the wall came down.
  for (let s = 0; s < 22; s += 1) {
    const sx = Math.round(right - 10 + hash2(s, variant, seed + 21) * 46);
    const sy = Math.round(baseY - hash2(s, variant, seed + 23) * 9);
    const sw = 2 + Math.round(hash2(s, variant, seed + 27) * 5);
    const sh = 2 + Math.round(hash2(s, variant, seed + 29) * 3);
    for (let y = 0; y < sh; y += 1) {
      for (let x = 0; x < sw; x += 1) {
        put(scratch, sx + x, sy - y, ruinShade(kit, x / sw - 0.5, -y / sh - 0.2));
      }
    }
  }
}

/** A fused stand of bone-white dead trunks - the brief's "dead forest". */
function paintBoneForestBody(scratch, spec, variant) {
  const kit = RUIN_BONE;
  const seed = 63_000 + variant * 877;
  const baseY = spec.pivot[1];
  // The fused mound they stand out of.
  for (let x = 6; x < 60; x += 1) {
    const dome = Math.sin(((x - 6) / 54) * Math.PI) ** 0.7 * 9;
    for (let y = Math.round(baseY - dome); y <= baseY; y += 1) {
      const up = (baseY - y) / Math.max(1, dome);
      put(scratch, x, y, ruinShade(kit, (x - 33) / 27, -up * 0.9 + 0.2, -0.18));
    }
  }
  const trunks = 5 + variant;
  for (let t = 0; t < trunks; t += 1) {
    const rootX = 10 + Math.round(hash2(t, variant, seed) * 44);
    const height = 34 + Math.round(hash2(t, variant, seed + 3) * 42);
    const lean = (hash2(t, variant, seed + 5) - 0.5) * 0.30;
    const half0 = 2.6 + hash2(t, variant, seed + 7) * 1.6;
    const crown = baseY - height;
    for (let y = baseY - 4; y >= crown; y -= 1) {
      const up = (baseY - y) / height;
      const cx = rootX + (baseY - y) * lean;
      const half = Math.max(0.9, half0 * (1 - up * 0.55));
      for (let x = Math.round(cx - half); x <= cx + half; x += 1) {
        const across = (x - cx) / Math.max(0.8, half);
        let colour = ruinShade(kit, across * 1.25, -0.15);
        if (hash2(chunky(x), chunky(y), seed + 11 + t) > 0.90) colour = kit.shade;
        // Charred at the base: the fire that killed them came from below.
        if (up < 0.20 && hash2(x, y, seed + 13) > 0.35) colour = kit.outline;
        else if (up < 0.34 && hash2(x, y, seed + 17) > 0.76) colour = kit.shade;
        put(scratch, x, y, colour);
      }
      // Snapped stubs.
      if (hash2(t, y, seed + 19) > 0.965) {
        const dir = hash2(t, y, seed + 23) > 0.5 ? 1 : -1;
        for (let s = 1; s <= 3 + Math.round(hash2(t, y, seed + 29) * 4); s += 1) {
          put(scratch, Math.round(cx + dir * (half + s)), y - Math.round(s * 0.5),
            dir < 0 ? kit.face : kit.shade);
        }
      }
    }
  }
}

/** A long low berm of fused ejecta - what a blast leaves lying around itself. */
function paintAshBarrowBody(scratch, spec, variant) {
  const kit = RUIN_EJECTA;
  const seed = 64_000 + variant * 641;
  const baseY = spec.pivot[1];
  const left = 3;
  const right = 3 + 72;
  for (let x = left; x <= right; x += 1) {
    const t = (x - left) / (right - left);
    const profile = Math.sin(t * Math.PI) ** 0.55;
    const crest = 8 + profile * (22 + variant * 5)
      + (fbm(x * 0.09, variant * 11, seed, 2) - 0.5) * 8;
    for (let y = Math.round(baseY - crest); y <= baseY; y += 1) {
      const up = (baseY - y) / Math.max(1, crest);
      // The crest catches the key light; the near flank falls away into shadow.
      let colour = ruinShade(kit, 0.10, 0.55 - up * 1.5, -0.06);
      if (up > 0.86) colour = kit.lit;
      if (hash2(chunky(x), chunky(y), seed + 7) > 0.84) colour = kit.shade;
      if (hash2(x, y, seed + 9) > 0.978) colour = kit.outline;
      put(scratch, x, y, colour);
    }
  }
}

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

/** Scenery sheet width. Frames are shelf-packed in spec order. */
const SCENERY_COLUMNS = 640;
const SCENERY_ROWS = 1280;

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
      // Ruins size their own contact pool from their measured footprint and
      // then add a real cast shadow; the generic ellipse would be wrong for
      // them because their frames are mostly shadow room.
      const carriesOwnShadow = spec.id === "causeway" || spec.id === "emberwisp"
        || spec.id === "ashripple" || spec.ruin !== undefined;
      if (!carriesOwnShadow) {
        const [pivotX, pivotY] = spec.pivot;
        paintContactShadow(
          surface, ox, oy, pivotX, pivotY + 2,
          Math.max(5, spec.width * 0.30),
          Math.max(3, spec.height * 0.075),
          0.46,
        );
      }
      switch (spec.id) {
        case "snag":
          paintCharredStanding(surface, ox, oy, spec, variant, false);
          break;
        case "snagtall":
          paintCharredStanding(surface, ox, oy, spec, variant, true);
          break;
        case "snagfallen":
          paintSnagFallen(surface, ox, oy, spec, variant);
          break;
        case "stump":
          paintStump(surface, ox, oy, spec, variant);
          break;
        case "slagrock":
          paintSlagRock(surface, ox, oy, spec, variant);
          break;
        case "ashpile":
          paintAshPile(surface, ox, oy, spec, variant);
          break;
        case "bonestone":
          paintBoneStone(surface, ox, oy, spec, variant);
          break;
        case "ejecta":
          paintEjecta(surface, ox, oy, spec, variant);
          break;
        case "clinkerchunk":
          paintClinkerChunk(surface, ox, oy, spec, variant);
          break;
        case "rimecluster":
          paintRimeCluster(surface, ox, oy, spec, variant);
          break;
        case "deadbrush":
          paintDeadBrush(surface, ox, oy, spec, variant);
          break;
        case "ashripple":
          paintAshRipple(surface, ox, oy, spec, variant);
          break;
        case "glassshard":
          paintGlassShard(surface, ox, oy, spec, variant);
          break;
        case "emberwisp":
          paintEmberWisp(surface, ox, oy, spec, variant);
          break;
        case "pylon":
          paintPylon(surface, ox, oy, spec, variant);
          break;
        case "slabtilt":
          paintSlabTilt(surface, ox, oy, spec, variant);
          break;
        case "dunecrest":
          paintDuneCrest(surface, ox, oy, spec, variant);
          break;
        case "causeway":
          paintCauseway(surface, ox, oy, spec, variant);
          break;
        case "monolith":
          paintRuin(surface, ox, oy, spec, variant, paintMonolithBody, 0.62);
          break;
        case "slumpwall":
          paintRuin(surface, ox, oy, spec, variant, paintSlumpWallBody, 0.58);
          break;
        case "boneforest":
          paintRuin(surface, ox, oy, spec, variant, paintBoneForestBody, 0.56);
          break;
        case "ashbarrow":
          paintRuin(surface, ox, oy, spec, variant, paintAshBarrowBody, 0.50);
          break;
        case "coolingtower":
          paintRuin(surface, ox, oy, spec, variant, paintCoolingTowerBody, 0.66);
          break;
        case "reactorhusk":
          paintRuin(surface, ox, oy, spec, variant, paintReactorHuskBody, 0.64);
          break;
        case "gantry":
          paintRuin(surface, ox, oy, spec, variant, paintGantryBody, 0.56);
          break;
        case "stack":
          paintRuin(surface, ox, oy, spec, variant, paintStackBody, 0.66);
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

export async function authorNirvanaWestPilotArt(outputRoot = DEFAULT_OUTPUT_ROOT) {
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
    sceneryFrames: scenery.records.map((record) => [
      record.id,
      record.rect.x, record.rect.y, record.rect.width, record.rect.height,
      record.pivot.x, record.pivot.y,
    ]),
  };
  await writeFile(path.join(outputRoot, "atlas.json"), `${JSON.stringify(atlas)}\n`, "utf8");
  return { ...atlas, frames: [...terrain.records, ...scenery.records] };
}

const REGION_CEILING = 196_608;
const REGION_TARGET = 145_000;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  authorNirvanaWestPilotArt()
    .then(async (atlas) => {
      const { stat } = await import("node:fs/promises");
      const json = await stat(path.join(DEFAULT_OUTPUT_ROOT, "atlas.json"));
      const art = atlas.images.terrain.bytes + atlas.images.scenery.bytes
        + atlas.images.environment.bytes;
      const total = art + json.size;
      const terrainFrames = atlas.terrainGrid.ids.length;
      const sceneryFrames = atlas.sceneryFrames.length;
      process.stdout.write(
        `authored ${atlas.frames.length} Nirvana West pilot frames`
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
