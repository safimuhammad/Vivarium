/**
 * @fileoverview The atlas's per-island raster layers (design of record:
 * `docs/frontend/ATLAS_VIEW.md` §3, proven in `docs/frontend/mockups/atlas-impl/02-coast-closeup.png`).
 *
 * Three offscreen layers per island, all derived from the ONE signed distance field
 * (`islandMask.ts`) so every band follows the same wiggles for free:
 *
 * 1. **shadow** -- the island's own shadow falling SE into the water, so land reads as sitting
 *    *above* the sea rather than pasted onto it.
 * 2. **water** -- breaking surf, foam, bright shallows and the dithered shelf break. This is what
 *    makes an island SIT IN water. Its palette comes from the time-of-day light.
 * 3. **dressing** -- everything laid over the region's own terrain art inside the coastline: the
 *    biome's beach bands, a broad inland brighten, two-octave value mottle, NW rim-light / SE
 *    coast-shade from the distance-field gradient, and the vitality wash that makes a starving
 *    region look *drier*.
 *
 * **Layers are rasterised at MASK-CELL resolution and drawn scaled up by `mask.cell` with image
 * smoothing off.** Every band in the reference implementation paints a solid `cell x cell` block,
 * so a nearest-neighbour upscale is pixel-identical to rasterising at plot resolution -- at 1/64th
 * the memory and time. A 96x96-tile region costs a 384x384 layer instead of a 3072x3072 one.
 *
 * Bands are dithered into each other with a 4x4 Bayer matrix and wobbled by a low-frequency noise,
 * so no contour is a clean offset curve.
 *
 * Deterministic throughout: every scatter and wobble is seeded from the region id. No `Math.random`.
 */

import {
  coastNormalAt,
  makeValueNoise,
  unitHash,
  type IslandMask,
  type IslandPoint,
} from "./islandMask";
import type { AtlasLight } from "./atlasLight";

/** Per-biome beach and coastal rock, so each island's waterline is its own place. */
export interface CoastPalette {
  readonly sand: string;
  readonly sandDark: string;
  readonly rock: string;
  readonly rockLit: string;
}

const COAST_PALETTES: Readonly<Record<string, CoastPalette>> = Object.freeze({
  "worn-heartland": { sand: "#dcc493", sandDark: "#b39a68", rock: "#7d7768", rockLit: "#a49d8b" },
  "spring-terraces": { sand: "#eadfc4", sandDark: "#c3b493", rock: "#8f8a7d", rockLit: "#b7b2a2" },
  "dry-scrub": { sand: "#e2bd80", sandDark: "#b5904f", rock: "#8a7a63", rockLit: "#ab9a80" },
  "ash-waste": { sand: "#b0a5a4", sandDark: "#867a7c", rock: "#6b6167", rockLit: "#8d838a" },
  "neutral-temperate": { sand: "#dfcda0", sandDark: "#b09b73", rock: "#7f7b6d", rockLit: "#a5a191" },
});

/** The biome's own beach/boulder palette; unknown kits fall back to the neutral one. */
export function coastPaletteForKit(kit: string): CoastPalette {
  return COAST_PALETTES[kit] ?? (COAST_PALETTES["neutral-temperate"] as CoastPalette);
}

/** Creates an offscreen raster surface, or `null` when none can be created (e.g. a test
 * environment with no canvas implementation -- the atlas then degrades to sea + terrain rather
 * than throwing). */
export type AtlasSurfaceFactory = (
  widthPx: number,
  heightPx: number,
) => Readonly<{ canvas: CanvasImageSource; context: CanvasRenderingContext2D }> | null;

/** One island's rasterised layers. Each is drawn at `mask.cols * mask.cell` x
 * `mask.rows * mask.cell` (i.e. scaled up by `mask.cell`), with smoothing off. */
export interface IslandLayers {
  readonly shadow: CanvasImageSource | null;
  readonly water: CanvasImageSource | null;
  readonly dressing: CanvasImageSource | null;
}

/** Ordered-dither threshold; keeps the bands reading as pixel art rather than as gradients. */
const BAYER: readonly (readonly number[])[] = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function dither(col: number, row: number, amount: number): boolean {
  return amount * 16 > (BAYER[row & 3] as readonly number[])[col & 3]!;
}

function parseHex(value: string): readonly [number, number, number] {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

type Rgba = readonly [number, number, number, number];

/** Rasterises one per-cell painter into a mask-resolution RGBA surface. */
function cellLayer(
  mask: IslandMask,
  surface: AtlasSurfaceFactory,
  paint: (distance: number, col: number, row: number) => Rgba | null,
): CanvasImageSource | null {
  const made = surface(mask.cols, mask.rows);
  if (made === null) return null;
  let image: ImageData;
  try {
    image = made.context.createImageData(mask.cols, mask.rows);
  } catch {
    return null;
  }
  const pixels = image.data;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      const out = paint(mask.dist[row * mask.cols + col] as number, col, row);
      if (out === null) continue;
      const offset = (row * mask.cols + col) * 4;
      pixels[offset] = out[0];
      pixels[offset + 1] = out[1];
      pixels[offset + 2] = out[2];
      pixels[offset + 3] = out[3];
    }
  }
  made.context.putImageData(image, 0, 0);
  return made.canvas;
}

/** Source-over composite of one straight-alpha colour onto an accumulator. */
function over(dst: [number, number, number, number], src: Rgba): void {
  const sa = src[3] / 255;
  if (sa <= 0) return;
  const da = dst[3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA <= 0) {
    dst[0] = 0; dst[1] = 0; dst[2] = 0; dst[3] = 0;
    return;
  }
  dst[0] = (src[0] * sa + dst[0] * da * (1 - sa)) / outA;
  dst[1] = (src[1] * sa + dst[1] * da * (1 - sa)) / outA;
  dst[2] = (src[2] * sa + dst[2] * da * (1 - sa)) / outA;
  dst[3] = outA * 255;
}

/**
 * Builds the island's shadow into the water. A soft distance ramp rather than a blurred hard mask:
 * same read, no filter dependency, and deterministic in a headless build.
 */
export function buildShadowLayer(
  mask: IslandMask,
  surface: AtlasSurfaceFactory,
  light: AtlasLight,
): CanvasImageSource | null {
  return cellLayer(mask, surface, (distance) => {
    if (distance > 7) return null;
    const falloff = distance <= 1.5 ? 1 : Math.max(0, 1 - (distance - 1.5) / 5.5);
    const alpha = Math.round(255 * light.shadowA * falloff * falloff);
    return alpha > 2 ? [2, 22, 30, alpha] : null;
  });
}

/**
 * Builds the water contour bands around the island: breaking surf, foam, bright shallows and the
 * dithered shelf break, each wobbled by a low-frequency noise so no contour is a clean offset
 * curve. Thresholds are in cells (a quarter tile each).
 */
export function buildWaterLayer(
  mask: IslandMask,
  surface: AtlasSurfaceFactory,
  light: AtlasLight,
  regionId: string,
): CanvasImageSource | null {
  const shelf = parseHex(light.shelf);
  const shallow = parseHex(light.shallow);
  const foam = parseHex(light.foam);
  const surf = parseHex(light.surf);
  const wobble = makeValueNoise(`${regionId}:surf`);
  return cellLayer(mask, surface, (distance, col, row) => {
    if (distance <= 0) return null;
    const edge = distance + (wobble(col / 9, row / 9) - 0.5) * 2.6;
    if (edge < 1.5) return [surf[0], surf[1], surf[2], 244];
    if (edge < 3.2) return [foam[0], foam[1], foam[2], 255];
    if (edge < 5) return dither(col, row, 0.5) ? [foam[0], foam[1], foam[2], 220] : null;
    if (edge < 10.5) return [shallow[0], shallow[1], shallow[2], 255];
    if (edge < 14) return dither(col, row, 0.66) ? [shallow[0], shallow[1], shallow[2], 240] : null;
    if (edge < 21) return [shelf[0], shelf[1], shelf[2], 252];
    if (edge < 26) return dither(col, row, 0.45) ? [shelf[0], shelf[1], shelf[2], 205] : null;
    return null;
  });
}

/**
 * Builds everything that lies OVER the region's own terrain art inside the coastline, composited
 * into one layer so it can be drawn in a single blit:
 *
 * - **beach**, in the biome's own sand, its width varying along the coast so there are wide
 *   strands and narrow rocky necks;
 * - **relief**, a broad inland brighten quadratic in depth -- without it the island reads as a
 *   paint bucket rather than a landform;
 * - **mottle**, two octaves of low-frequency value variation, so a monotone kit reads as ground
 *   with weather on it;
 * - **rim light**, NW brighten / SE darken from the distance field's own gradient;
 * - **vitality**, a warm-grey wash whose strength is the region's real `current/max` energy ratio.
 *   A depleted region looks drier, not colour-coded. This is the map's real information payload.
 */
export function buildDressingLayer(
  mask: IslandMask,
  surface: AtlasSurfaceFactory,
  regionId: string,
  kit: string,
  vitality: number,
): CanvasImageSource | null {
  const palette = coastPaletteForKit(kit);
  const sand = parseHex(palette.sand);
  const sandDark = parseHex(palette.sandDark);
  const beachNoise = makeValueNoise(`${regionId}:beach`);
  const mottleCoarse = makeValueNoise(`${regionId}:mottle1`);
  const mottleFine = makeValueNoise(`${regionId}:mottle2`);
  const dryness = Math.max(0, 0.85 - Math.max(0, Math.min(1, vitality))) * 0.42;
  return cellLayer(mask, surface, (distance, col, row) => {
    if (distance >= 0) return null;
    const accumulator: [number, number, number, number] = [0, 0, 0, 0];

    // beach
    const depth = -distance + (beachNoise(col / 11, row / 11) - 0.5) * 4.5;
    if (depth < 1.5) over(accumulator, [255, 250, 232, 255]);
    else if (depth < 4) over(accumulator, [sand[0], sand[1], sand[2], 255]);
    else if (depth < 6) over(accumulator, [sand[0], sand[1], sand[2], dither(col, row, 0.8) ? 250 : 130]);
    else if (depth < 8) over(accumulator, [sandDark[0], sandDark[1], sandDark[2], dither(col, row, 0.62) ? 215 : 70]);
    else if (depth < 10.5) over(accumulator, [sandDark[0], sandDark[1], sandDark[2], dither(col, row, 0.3) ? 155 : 0]);

    // inland relief
    const inland = Math.min(1, -distance / 46);
    const reliefAlpha = Math.round(70 * inland * inland);
    if (reliefAlpha > 2) over(accumulator, [255, 246, 216, reliefAlpha]);

    // value mottle
    const value = (mottleCoarse(col / 26, row / 26) - 0.5) * 1.35
      + (mottleFine(col / 8, row / 8) - 0.5) * 0.55;
    if (value > 0.1) {
      over(accumulator, [255, 244, 206, Math.round(Math.min(1, (value - 0.1) * 3.6) * 58)]);
    } else if (value < -0.1) {
      over(accumulator, [30, 44, 34, Math.round(Math.min(1, (-value - 0.1) * 3.6) * 62)]);
    }

    // coast rim light (NW lit, SE shaded)
    if (distance >= -5) {
      const normal = coastNormalAt(mask, col, row);
      if (normal !== null) {
        const lit = -(normal[0] * 0.7071 + normal[1] * 0.7071);
        const falloff = 1 - Math.min(1, -distance / 5);
        if (lit > 0.25) over(accumulator, [255, 250, 224, Math.round(165 * Math.min(1, lit) * falloff)]);
        else if (lit < -0.25) over(accumulator, [22, 34, 40, Math.round(150 * Math.min(1, -lit) * falloff)]);
      }
    }

    // vitality wash
    if (dryness > 0.002) over(accumulator, [120, 104, 74, Math.round(255 * dryness)]);

    if (accumulator[3] < 1) return null;
    return [
      Math.round(accumulator[0]),
      Math.round(accumulator[1]),
      Math.round(accumulator[2]),
      Math.round(accumulator[3]),
    ];
  });
}

/** Builds all three layers for one island. */
export function buildIslandLayers(input: Readonly<{
  mask: IslandMask;
  surface: AtlasSurfaceFactory;
  light: AtlasLight;
  regionId: string;
  kit: string;
  vitality: number;
}>): IslandLayers {
  return Object.freeze({
    shadow: buildShadowLayer(input.mask, input.surface, input.light),
    water: buildWaterLayer(input.mask, input.surface, input.light, input.regionId),
    dressing: buildDressingLayer(input.mask, input.surface, input.regionId, input.kit, input.vitality),
  });
}

/** One coastal boulder: where it sits (plot-local pixels) and how big it is relative to the base
 * boulder size. */
export interface CoastalBoulder {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * Deterministic boulder scatter over an island's own waterline cells -- the detail that sells a
 * coast. Boulders are drawn in the biome's own rock colours (see {@link coastPaletteForKit}).
 *
 * @param mask - The region's rasterised silhouette.
 * @param regionId - Seed for the scatter.
 * @param density - One boulder per this many eligible coast cells (a hash modulus). Defaults
 *   to `26`, the reference implementation's value.
 * @returns Boulder positions in plot-local pixels, in row-major (deterministic) order.
 */
export function coastalBoulders(
  mask: IslandMask,
  regionId: string,
  density = 26,
): readonly CoastalBoulder[] {
  const boulders: CoastalBoulder[] = [];
  const modulus = Math.max(2, Math.floor(density));
  for (let row = 1; row < mask.rows - 1; row += 1) {
    for (let col = 1; col < mask.cols - 1; col += 1) {
      const distance = mask.dist[row * mask.cols + col] as number;
      if (distance > 0.4 || distance < -2.4) continue;
      if (Math.floor(unitHash(`${regionId}:rock:${col}:${row}`) * 4_294_967_296) % modulus !== 0) continue;
      boulders.push({
        x: col * mask.cell,
        y: row * mask.cell,
        scale: 0.8 + (Math.floor(unitHash(`${regionId}:rs:${col}:${row}`) * 4_294_967_296) % 5) * 0.09,
      });
    }
  }
  return boulders;
}

/**
 * Sparse wave ticks over open water -- the sea is never a flat colour, and the frame is never
 * dead. Positions are hashed from their own world coordinates, so they are stable under panning
 * and identical between runs.
 *
 * @param bounds - The world-space rect to fill with ticks.
 * @param stepPx - Lattice spacing in world pixels (the caller scales this by the camera zoom so
 *   the ticks keep a constant size on screen).
 * @param distanceAt - Signed distance to the nearest island, in world pixels, or `null` for open
 *   sea far from every island.
 * @returns Wave tick draw commands, in lattice order.
 */
export function seaWaveTicks(
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  stepPx: number,
  distanceAt: (x: number, y: number) => number,
): ReadonlyArray<Readonly<{ x: number; y: number; lengthPx: number; alpha: number; double: boolean }>> {
  const ticks: Array<Readonly<{ x: number; y: number; lengthPx: number; alpha: number; double: boolean }>> = [];
  const step = Math.max(4, stepPx);
  const startX = Math.floor(bounds.x / step) * step;
  const startY = Math.floor(bounds.y / step) * step;
  const endX = bounds.x + bounds.width;
  const endY = bounds.y + bounds.height;
  for (let y = startY; y < endY; y += step) {
    for (let x = startX; x < endX; x += step) {
      const key = `w:${Math.round(x)}:${Math.round(y)}`;
      const roll = unitHash(key);
      if (roll > 0.42) continue;
      const jitterX = x + Math.floor(unitHash(`wx:${Math.round(x)}:${Math.round(y)}`) * step);
      const jitterY = y + Math.floor(unitHash(`wy:${Math.round(x)}:${Math.round(y)}`) * step);
      const near = distanceAt(jitterX, jitterY);
      if (near < step * 0.85) continue;
      ticks.push({
        x: jitterX,
        y: jitterY,
        lengthPx: near < step * 10 ? step * 0.42 : step * 0.31,
        alpha: near < step * 8.5 ? 0.42 : 0.22,
        double: roll < 0.16,
      });
    }
  }
  return ticks;
}

/** Convenience: the plot-local pixel size the layers must be drawn at. */
export function islandLayerSize(mask: IslandMask): IslandPoint {
  return { x: mask.cols * mask.cell, y: mask.rows * mask.cell };
}
