/**
 * @fileoverview Cartographic generalization for the world-view map inset.
 *
 * A map is a legible abstraction, not a photographic downscale. Every printed map on earth draws
 * its rivers and roads wider than true scale, because a feature rendered below the eye's
 * legibility threshold is not "honest" -- it is simply **absent**, which misinforms the viewer
 * exactly as much as inventing one would. Nirvana's river is 2-3 tiles wide; projected into its
 * island it is a couple of device pixels, and a bank tree enlarged into a map symbol erases it
 * outright. The valley that is the whole point of the region did not read at map zoom.
 *
 * This module implements the one rule that separates generalization from lying:
 *
 * - **Linear features that EXIST get a minimum stroke width** so they survive the downscale. Only
 *   the width is exaggerated; the path stays exactly where the region put it. Features already
 *   wide enough are left untouched -- the widening is applied to the *thin* parts of a mask only
 *   ({@link minimumStroke}), which is the classic minimum-dimension operator.
 * - **Areal features stay honest.** Nothing is scattered, no density is invented, no material is
 *   painted where another one is. A uniform field stays a uniform field; the only thing done to it
 *   is to amplify the tone variation it already carries ({@link FIELD_TONE_TARGET}) up to the
 *   threshold where the eye can see it, the same way relief maps exaggerate vertical scale.
 *
 * Everything here reads the inset raster the cache pipeline already produced -- an `ImageData` of
 * pixels that were drawn from the region's own terrain and scenery canvases. It never sees a
 * recipe, a chunk, or an authored-scene sidecar, and it cannot: its entire input is one
 * `ImageData` plus numbers.
 */

/** Radius, in inset-raster pixels, that a WATER feature is guaranteed to be thick to.
 *
 * A stroke of `2r+1 = 7` raster px. The inset is drawn into the island's land box, which at map
 * zoom (whole world in frame) is roughly a third of the raster's own size, so this lands at ~2.5
 * device px -- the point at which a line stops being a suggestion and reads as a river. Tuned by
 * eye against the real archipelago, not derived. */
export const MAP_WATER_STROKE_RADIUS_PX = 3;

/** Radius, in inset-raster pixels, for ROADS, paths, bridges and the other neutral linework.
 *
 * One less than water: roads should read as the finer of the two networks, and a road already
 * survives the downscale better than a river does because it is high-contrast against grass. */
export const MAP_LINE_STROKE_RADIUS_PX = 2;

/** Radius, in inset-raster pixels, used to decide what a river flows AROUND rather than over.
 *
 * A timber bridge, a reed bed or an islet is a non-water hole enclosed by water. Widening the
 * river must not swallow them -- a bridge over a bold river is one of the strongest reads a map
 * has. Anything the morphological closing at this radius encloses is preserved. Sized to span
 * Nirvana's bridge decks (~64 plot px, ~13 raster px across). */
export const MAP_WATER_ENCLOSURE_RADIUS_PX = 7;

/** Luma standard deviation a uniform field's own tone variation is amplified toward. */
export const FIELD_TONE_TARGET = 5.5;

/** The most a uniform field's tone variation is ever amplified. Past this the amplifier is
 * lifting quantisation noise rather than material, and the field stops reading as a material. */
export const FIELD_TONE_MAX_GAIN = 2.2;

/** Manhattan RGB separation a thin linear feature is pushed to hold against its field.
 *
 * `nirvana_east`'s paths sit ~24 apart from its sand and are invisible; `warm_springs`'s sit ~76
 * apart from its grass and read fine. Pushing toward a common target boosts the first and leaves
 * the second alone -- the exaggeration goes where the deficit is. */
export const LINE_CONTRAST_TARGET = 62;

/** The most a linear feature's colour is ever pushed away from its field. */
export const LINE_CONTRAST_MAX_GAIN = 2.4;

/**
 * Luma separation the water network is pushed to hold against the land immediately around it.
 *
 * Width is only half of legibility. At the size an island is drawn with the whole world in frame,
 * the eye resolves shapes by LUMINANCE, and Nirvana's river sits ~35 luma below its own wooded
 * banks -- enough to see at 1:1, not enough to see at a tenth of that. Pushing the water further
 * along the direction it already differs in (never into a new hue) is the colour twin of the
 * minimum stroke: the feature is real and where it always was, it is just drawn at the strength a
 * map draws water. Tuned by eye against the archipelago.
 */
export const WATER_CONTRAST_TARGET = 54;

/** The most the water is ever pushed away from its banks. */
export const WATER_CONTRAST_MAX_GAIN = 1.9;

/** Radius, in raster pixels, of the band of land sampled to find "what the water sits against". */
const WATER_SURROUND_RADIUS_PX = 6;

/** Fraction of the raster above which a "water" classification is read as the region's own
 * material rather than as water. A purple-grey or slate kit is cool-hued everywhere; widening
 * "water" there would repaint the whole island. */
const WATER_MATERIAL_FRACTION = 0.4;

/** Fraction of the raster the modal colour must cover for the region to count as a uniform field
 * -- the regime in which "everything that is not the field" is a meaningful feature mask. */
const UNIFORM_FIELD_FRACTION = 0.3;

/** Manhattan RGB distance from the modal colour past which a pixel is not the field material.
 *
 * Measured, not guessed: a kit field's own dither reaches ~11 +/- 9 away from its mode, and its
 * paths sit at 24-76. Set inside that gap. Lower and the map fills with confetti; higher and
 * `nirvana_east`'s barely-there paths drop out. What is caught this side of the gap is then
 * despeckled and size-filtered below, and pushed to a common contrast so the faint ones read. */
const FIELD_TOLERANCE = 34;

/** Manhattan RGB distance from the modal colour past which a pixel is not even field-adjacent,
 * and so is excluded from the tone amplification (sprites must not be amplified). */
const FIELD_AMPLIFY_TOLERANCE = 44;

/** Smallest connected run of pixels treated as a feature rather than as the material's dither. */
const MIN_FEATURE_PX = 32;

/** Alpha above which an inset pixel counts as drawn content. */
const OPAQUE_ALPHA = 8;

/** What the generalization pass found, for the caller to keep drawing against. */
export interface GeneralizedInset {
  /** 1 where the widened water network stands, in raster pixels. Used to keep map symbols out of
   * the river, and to let the river run to the waterline instead of dissolving in the shore
   * band. */
  readonly water: Uint8Array;
  /** True when the region reads as one uniform material (a kit region) rather than as authored
   * terrain. Reported for diagnostics; the pass has already acted on it. */
  readonly uniformField: boolean;
  /** How much the field's own tone variation was amplified (1 = untouched). */
  readonly fieldToneGain: number;
  /** How far the water was pushed from its banks, as a multiple of its real separation
   * (1 = untouched). */
  readonly waterContrastGain: number;
  /** Raster pixels of water before and after the minimum stroke. */
  readonly waterPx: number;
  readonly widenedWaterPx: number;
  /** Raster pixels of linework before and after the minimum stroke. */
  readonly linePx: number;
  readonly widenedLinePx: number;
  /** Raster pixels of river crossings (bridge decks, causeways) before and after their stroke. */
  readonly crossingPx: number;
  readonly widenedCrossingPx: number;
}

/** An empty result, for the paths where there is nothing to generalize. */
const emptyResult = (length: number): GeneralizedInset => ({
  water: new Uint8Array(length),
  uniformField: false,
  fieldToneGain: 1,
  waterContrastGain: 1,
  waterPx: 0,
  widenedWaterPx: 0,
  linePx: 0,
  widenedLinePx: 0,
  crossingPx: 0,
  widenedCrossingPx: 0,
});

/**
 * Dilates a binary mask by a square structuring element of the given radius, in place-safe form.
 *
 * Separable and O(pixels) per axis regardless of radius: each 1-D pass sweeps once forward and
 * once back recording the distance to the nearest set pixel, then keeps everything within the
 * radius. That keeps the whole generalization pass linear in the raster size.
 *
 * @param mask - Source mask, 1 = set.
 * @param width - Raster width in pixels.
 * @param height - Raster height in pixels.
 * @param radius - Dilation radius in pixels; `<= 0` returns a copy.
 * @returns A new mask; the input is not modified.
 */
export function dilateMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  const out = new Uint8Array(mask);
  if (radius <= 0 || width <= 0 || height <= 0) return out;
  const far = width + height + radius + 1;
  const distance = new Int32Array(width * height);
  // horizontal
  for (let row = 0; row < height; row += 1) {
    const base = row * width;
    let last = -far;
    for (let col = 0; col < width; col += 1) {
      if (out[base + col] === 1) last = col;
      distance[base + col] = col - last;
    }
    last = far * 2;
    for (let col = width - 1; col >= 0; col -= 1) {
      if (out[base + col] === 1) last = col;
      const right = last - col;
      const index = base + col;
      if (right < (distance[index] as number)) distance[index] = right;
    }
    for (let col = 0; col < width; col += 1) {
      out[base + col] = (distance[base + col] as number) <= radius ? 1 : 0;
    }
  }
  // vertical
  for (let col = 0; col < width; col += 1) {
    let last = -far;
    for (let row = 0; row < height; row += 1) {
      if (out[row * width + col] === 1) last = row;
      distance[row * width + col] = row - last;
    }
    last = far * 2;
    for (let row = height - 1; row >= 0; row -= 1) {
      if (out[row * width + col] === 1) last = row;
      const up = last - row;
      const index = row * width + col;
      if (up < (distance[index] as number)) distance[index] = up;
    }
    for (let row = 0; row < height; row += 1) {
      const index = row * width + col;
      out[index] = (distance[index] as number) <= radius ? 1 : 0;
    }
  }
  return out;
}

/** Erodes a binary mask by a square structuring element -- the dual of {@link dilateMask}. */
export function erodeMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
): Uint8Array {
  if (radius <= 0) return new Uint8Array(mask);
  const inverted = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) inverted[index] = mask[index] === 1 ? 0 : 1;
  const grown = dilateMask(inverted, width, height, radius);
  const out = new Uint8Array(mask.length);
  for (let index = 0; index < mask.length; index += 1) out[index] = grown[index] === 1 ? 0 : 1;
  return out;
}

/**
 * The minimum-dimension operator: guarantees every part of `mask` is at least `2 * radius + 1`
 * pixels thick, **without touching the parts that already are**.
 *
 * `opening = dilate(erode(mask))` keeps only what survives the structuring element -- the thick
 * parts. Whatever the opening drops is, by definition, thinner than the threshold; that residue
 * (and only it) is dilated back. A lake keeps its shoreline; a two-pixel creek becomes a stroke
 * you can see. The path is unchanged in either case: dilation is symmetric about the original
 * pixels, so the feature's centreline does not move.
 *
 * @param mask - The feature mask.
 * @param width - Raster width.
 * @param height - Raster height.
 * @param radius - Half the minimum stroke, in raster pixels.
 * @param bounds - Optional mask the result is confined to (the inset's own opaque area), so a
 *   widened feature never spills into pixels the map does not own.
 * @returns A new mask.
 */
export function minimumStroke(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  bounds?: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(mask);
  if (radius <= 0) return out;
  const opened = dilateMask(erodeMask(mask, width, height, radius), width, height, radius);
  const thin = new Uint8Array(mask.length);
  let thinCount = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1 && opened[index] !== 1) {
      thin[index] = 1;
      thinCount += 1;
    }
  }
  if (thinCount === 0) return out;
  const grown = dilateMask(thin, width, height, radius);
  for (let index = 0; index < mask.length; index += 1) {
    if (grown[index] !== 1) continue;
    if (bounds !== undefined && bounds[index] !== 1) continue;
    out[index] = 1;
  }
  return out;
}

/**
 * Drops isolated speckle from a classified mask WITHOUT thinning what survives.
 *
 * The obvious denoise -- a morphological opening -- is exactly wrong here: a two-pixel creek or a
 * one-pixel path does not survive an erosion, and those are precisely the features this module
 * exists to save. Instead each pass keeps only pixels with at least `minNeighbours` of their eight
 * neighbours set. A line is stable under that rule (an interior pixel of even a one-pixel line has
 * two neighbours along it); a lone dither pixel has none, and a two- or three-pixel clump erodes
 * over successive passes.
 *
 * @param mask - Classified mask, modified in place.
 * @param width - Raster width.
 * @param height - Raster height.
 * @param minNeighbours - How many of the eight neighbours a pixel must keep.
 * @param passes - How many times to apply the rule.
 * @returns The number of set pixels remaining.
 */
export function despeckleMask(
  mask: Uint8Array,
  width: number,
  height: number,
  minNeighbours: number,
  passes: number,
): number {
  let remaining = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const previous = new Uint8Array(mask);
    remaining = 0;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * width + col;
        if (previous[index] !== 1) continue;
        let neighbours = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            const nextRow = row + dy;
            const nextCol = col + dx;
            if (nextCol < 0 || nextCol >= width || nextRow < 0 || nextRow >= height) continue;
            if (previous[nextRow * width + nextCol] === 1) neighbours += 1;
          }
        }
        if (neighbours < minNeighbours) mask[index] = 0;
        else remaining += 1;
      }
    }
  }
  return remaining;
}

/**
 * Deletes 4-connected components smaller than `minSize` from a classified mask, in place.
 *
 * This is the guard that lets the classifiers be generous. A kit field's ground tile carries a
 * regular dither -- a scatter of one- and two-pixel cells a shade off the material -- and a
 * threshold loose enough to catch `nirvana_east`'s barely-there paths necessarily catches that
 * dither too. Un-guarded, the minimum stroke would then turn every speck of dither into a
 * five-pixel blob and cover the island in confetti. A real feature is a connected RUN of pixels;
 * noise is not.
 *
 * @param mask - Classified mask, modified in place.
 * @param width - Raster width.
 * @param height - Raster height.
 * @param minSize - Smallest component kept, in pixels.
 * @returns The number of set pixels remaining.
 */
export function dropSmallComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  minSize: number,
): number {
  const seen = new Uint8Array(mask.length);
  const stack = new Int32Array(mask.length);
  const component = new Int32Array(mask.length);
  let remaining = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] !== 1 || seen[start] === 1) continue;
    let top = 0;
    let size = 0;
    stack[top += 1] = start;
    seen[start] = 1;
    while (top > 0) {
      const index = stack[top -= 1] as number;
      component[size += 1] = index;
      const col = index % width;
      const row = (index - col) / width;
      for (let side = 0; side < 4; side += 1) {
        const nextCol = col + (side === 0 ? -1 : side === 1 ? 1 : 0);
        const nextRow = row + (side === 2 ? -1 : side === 3 ? 1 : 0);
        if (nextCol < 0 || nextCol >= width || nextRow < 0 || nextRow >= height) continue;
        const other = nextRow * width + nextCol;
        if (mask[other] !== 1 || seen[other] === 1) continue;
        seen[other] = 1;
        stack[top += 1] = other;
      }
    }
    if (size >= minSize) {
      remaining += size;
      continue;
    }
    for (let member = 1; member <= size; member += 1) mask[component[member] as number] = 0;
  }
  return remaining;
}

/**
 * Whether the three-tap mean of the pixels along one axis reads as water.
 *
 * The classifier looks along an axis rather than at the bare pixel, and takes whichever axis
 * speaks loudest. That is the one filter which separates a real feature from a material's dither
 * without destroying the feature.
 *
 * A kit's ground tile carries a one-pixel-period dither -- a scatter of cells a shade off the
 * material -- whose amplitude is comparable to that of the very features the map needs to find. A
 * bare-pixel threshold tight enough to catch a two-pixel creek catches the dither too, and the
 * minimum stroke then turns every speck into a five-pixel blob of confetti. An isotropic blur
 * would suppress the dither, but it suppresses the creek just as hard. A DIRECTIONAL mean does
 * not: a watercourse is coherent along its own axis, so the three taps that lie along it agree and
 * it comes through at full strength, while an isolated speck is averaged with two neighbours that
 * disagree and falls to a third of its amplitude. The colours PAINTED are always the raster's own
 * -- only the decision is filtered.
 *
 * @param pixels - Source RGBA data.
 * @param width - Raster width.
 * @param height - Raster height.
 * @param col - Pixel column.
 * @param row - Pixel row.
 * @param vertical - Look down the column rather than along the row.
 * @returns True when the mean along that axis is a chromatic cool colour.
 */
function readsAsWaterAlong(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  col: number,
  row: number,
  vertical: boolean,
): boolean {
  let red = 0;
  let green = 0;
  let blue = 0;
  let taps = 0;
  for (let step = -1; step <= 1; step += 1) {
    const otherCol = vertical ? col : col + step;
    const otherRow = vertical ? row + step : row;
    if (otherCol < 0 || otherCol >= width || otherRow < 0 || otherRow >= height) continue;
    const offset = (otherRow * width + otherCol) * 4;
    red += pixels[offset] as number;
    green += pixels[offset + 1] as number;
    blue += pixels[offset + 2] as number;
    taps += 1;
  }
  red /= taps;
  green /= taps;
  blue /= taps;
  const max = Math.max(red, green, blue);
  if (max < 16) return false;
  if ((max - Math.min(red, green, blue)) / max < 0.18) return false;
  const hue = hueOf(red, green, blue);
  return hue >= 150 && hue <= 255;
}

/** Hue in degrees for one RGB triple, or `-1` when the pixel has no chroma at all. */
const hueOf = (red: number, green: number, blue: number): number => {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const chroma = max - min;
  if (chroma === 0) return -1;
  let hue: number;
  if (max === red) hue = ((green - blue) / chroma + 6) % 6;
  else if (max === green) hue = (blue - red) / chroma + 2;
  else hue = (red - green) / chroma + 4;
  return hue * 60;
};

/**
 * Fills `target \ source` with the colour of the nearest `source` pixel, so a widened feature
 * carries the feature's own palette rather than a flat invented one.
 *
 * Runs `passes` rounds of 4-neighbour averaging from a snapshot of the previous round, which is
 * both direction-free and enough to cover a dilation of that radius.
 */
const growFeatureColour = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  source: Uint8Array,
  target: Uint8Array,
  passes: number,
): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(pixels);
  const have = new Uint8Array(source);
  for (let pass = 0; pass < passes; pass += 1) {
    // Only pixels already settled BEFORE this pass may be read, which makes the fill
    // direction-free without copying the colour buffer: this pass never writes to them.
    const frozen = new Uint8Array(have);
    let filled = 0;
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * width + col;
        if (target[index] !== 1 || have[index] === 1) continue;
        let red = 0;
        let green = 0;
        let blue = 0;
        let count = 0;
        for (let side = 0; side < 4; side += 1) {
          const nextCol = col + (side === 0 ? -1 : side === 1 ? 1 : 0);
          const nextRow = row + (side === 2 ? -1 : side === 3 ? 1 : 0);
          if (nextCol < 0 || nextCol >= width || nextRow < 0 || nextRow >= height) continue;
          const other = nextRow * width + nextCol;
          if (frozen[other] !== 1) continue;
          red += out[other * 4] as number;
          green += out[other * 4 + 1] as number;
          blue += out[other * 4 + 2] as number;
          count += 1;
        }
        if (count === 0) continue;
        out[index * 4] = Math.round(red / count);
        out[index * 4 + 1] = Math.round(green / count);
        out[index * 4 + 2] = Math.round(blue / count);
        out[index * 4 + 3] = 255;
        have[index] = 1;
        filled += 1;
      }
    }
    if (filled === 0) break;
  }
  return out;
};

/** The raster's modal colour (quantised to 8 levels per channel) and how much of it there is.
 */
const modalColour = (
  pixels: Uint8ClampedArray,
  opaque: Uint8Array,
): Readonly<{ red: number; green: number; blue: number; fraction: number }> => {
  const bins = new Int32Array(32 * 32 * 32);
  let total = 0;
  for (let index = 0; index < opaque.length; index += 1) {
    if (opaque[index] !== 1) continue;
    const red = (pixels[index * 4] as number) >> 3;
    const green = (pixels[index * 4 + 1] as number) >> 3;
    const blue = (pixels[index * 4 + 2] as number) >> 3;
    bins[(red << 10) | (green << 5) | blue] += 1;
    total += 1;
  }
  if (total === 0) return { red: 0, green: 0, blue: 0, fraction: 0 };
  let best = 0;
  let bestCount = 0;
  for (let bin = 0; bin < bins.length; bin += 1) {
    const count = bins[bin] as number;
    if (count > bestCount) {
      bestCount = count;
      best = bin;
    }
  }
  return {
    red: ((best >> 10) & 31) << 3,
    green: ((best >> 5) & 31) << 3,
    blue: (best & 31) << 3,
    fraction: bestCount / total,
  };
};

/**
 * Generalizes one built map inset, in place.
 *
 * Runs immediately after the region's terrain and scenery have been projected into the island and
 * BEFORE the map symbols are drawn, so that (a) the widened river is what the symbols stand
 * beside, and (b) the caller can keep symbols out of the water entirely.
 *
 * Order of operations, and why:
 * 1. Classify **water** by hue -- cool, chromatic pixels. Guarded by
 *    {@link WATER_MATERIAL_FRACTION} so a slate or heather kit is never mistaken for a flooded
 *    island. Opened by one pixel first, which deletes dither speckle without moving a shoreline.
 * 2. Find the region's **modal material**. A kit region is one colour over most of its plot; an
 *    authored region is not. That single number decides which linework detector is meaningful.
 * 3. Classify **linework**: on a uniform field, everything that is not the field; on authored
 *    terrain, the neutral greys -- cobbled roads, stone, bridge piers.
 * 4. **Amplify the field's own tone** toward {@link FIELD_TONE_TARGET}, but only on pixels that
 *    are the field material. This invents nothing: it scales each pixel's real deviation from the
 *    material's mean. A flat kit gets its true mottle back; authored terrain, already well past
 *    the target, is untouched.
 * 5. Apply the **minimum stroke** to water and to linework, and repaint the widened pixels with
 *    the feature's own colour. Water yields to anything it encloses (bridges, reed beds, islets)
 *    and to the linework, so a road crossing a river still crosses it.
 *
 * @param image - The inset raster. Its `data` is mutated in place.
 * @returns What was found, including the widened water mask the caller needs.
 */
export function generalizeMapInset(image: ImageData): GeneralizedInset {
  const width = image.width;
  const height = image.height;
  const count = width * height;
  if (count <= 0) return emptyResult(Math.max(0, count));
  const pixels = image.data;

  const opaque = new Uint8Array(count);
  let opaqueCount = 0;
  for (let index = 0; index < count; index += 1) {
    if ((pixels[index * 4 + 3] as number) > OPAQUE_ALPHA) {
      opaque[index] = 1;
      opaqueCount += 1;
    }
  }
  if (opaqueCount === 0) return emptyResult(count);

  // ---- 1. water, classified along whichever axis speaks loudest (see `readsAsWaterAlong`)
  let rawWater = new Uint8Array(count);
  let rawWaterCount = 0;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      if (opaque[index] !== 1) continue;
      if (!readsAsWaterAlong(pixels, width, height, col, row, false)
        && !readsAsWaterAlong(pixels, width, height, col, row, true)) continue;
      rawWater[index] = 1;
      rawWaterCount += 1;
    }
  }
  if (rawWaterCount > WATER_MATERIAL_FRACTION * opaqueCount) {
    rawWater = new Uint8Array(count);
    rawWaterCount = 0;
  }
  // Dither speckle in a cool-toned kit is not a lake -- but an erosion would delete the creeks
  // this module exists to save, so speckle goes by neighbour count instead.
  const water = rawWater;
  if (rawWaterCount > 0) {
    despeckleMask(water, width, height, 2, 2);
    dropSmallComponents(water, width, height, MIN_FEATURE_PX);
  }
  let waterPx = 0;
  for (let index = 0; index < count; index += 1) {
    if (water[index] === 1 && opaque[index] === 1) waterPx += 1;
    else water[index] = 0;
  }

  // ---- 2. the region's own material
  const field = modalColour(pixels, opaque);
  const uniformField = field.fraction >= UNIFORM_FIELD_FRACTION;

  // ---- 3. linework
  const rawLine = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (opaque[index] !== 1 || water[index] === 1) continue;
    const red = pixels[index * 4] as number;
    const green = pixels[index * 4 + 1] as number;
    const blue = pixels[index * 4 + 2] as number;
    if (uniformField) {
      const distance = Math.abs(red - field.red)
        + Math.abs(green - field.green)
        + Math.abs(blue - field.blue);
      if (distance > FIELD_TOLERANCE) rawLine[index] = 1;
    } else {
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      if (max - min < 30 && max > 60 && max < 235) rawLine[index] = 1;
    }
  }
  const line = rawLine;
  if (waterPx > 0) {
    // A river's own bank is not a road. The directional means straddle the waterline and read as
    // "not the field material" there, which would ring every channel in linework and -- worse --
    // block the river's own widening, since water yields to linework.
    const bank = dilateMask(water, width, height, 2);
    for (let index = 0; index < count; index += 1) if (bank[index] === 1) line[index] = 0;
  }
  despeckleMask(line, width, height, 2, 2);
  dropSmallComponents(line, width, height, MIN_FEATURE_PX);
  let linePx = 0;
  for (let index = 0; index < count; index += 1) {
    if (line[index] === 1 && opaque[index] === 1 && water[index] !== 1) linePx += 1;
    else line[index] = 0;
  }

  // ---- 4. the field's own tone, amplified to where the eye can see it
  let fieldToneGain = 1;
  if (uniformField) {
    let sum = 0;
    let sumSquares = 0;
    let samples = 0;
    const channelSum = [0, 0, 0];
    const isFieldPixel = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      if (opaque[index] !== 1 || water[index] === 1 || line[index] === 1) continue;
      const red = pixels[index * 4] as number;
      const green = pixels[index * 4 + 1] as number;
      const blue = pixels[index * 4 + 2] as number;
      const distance = Math.abs(red - field.red)
        + Math.abs(green - field.green)
        + Math.abs(blue - field.blue);
      if (distance > FIELD_AMPLIFY_TOLERANCE) continue;
      isFieldPixel[index] = 1;
      const luma = red * 0.3 + green * 0.59 + blue * 0.11;
      sum += luma;
      sumSquares += luma * luma;
      channelSum[0] += red;
      channelSum[1] += green;
      channelSum[2] += blue;
      samples += 1;
    }
    if (samples > 512) {
      const mean = sum / samples;
      const variance = Math.max(0, sumSquares / samples - mean * mean);
      const deviation = Math.sqrt(variance);
      if (deviation > 0.4) {
        fieldToneGain = Math.min(FIELD_TONE_MAX_GAIN, Math.max(1, FIELD_TONE_TARGET / deviation));
      }
      if (fieldToneGain > 1.001) {
        // Amplify about the field's own MEAN, not its modal bin: scaling deviations about the mean
        // leaves the material's average colour exactly where the region put it, so the island's
        // tone never shifts -- only the variation inside it grows.
        const centre = [
          (channelSum[0] as number) / samples,
          (channelSum[1] as number) / samples,
          (channelSum[2] as number) / samples,
        ];
        for (let index = 0; index < count; index += 1) {
          if (isFieldPixel[index] !== 1) continue;
          for (let channel = 0; channel < 3; channel += 1) {
            const base = centre[channel] as number;
            const value = pixels[index * 4 + channel] as number;
            pixels[index * 4 + channel] = Math.round(base + (value - base) * fieldToneGain);
          }
        }
      }
    }
  }

  // ---- 5. minimum stroke
  const widenedWater = waterPx === 0
    ? water
    : minimumStroke(water, width, height, MAP_WATER_STROKE_RADIUS_PX, opaque);
  const widenedLine = linePx === 0
    ? line
    : minimumStroke(line, width, height, MAP_LINE_STROKE_RADIUS_PX, opaque);

  // What the river flows around rather than over: bridges, reed beds, islets.
  const enclosed = waterPx === 0
    ? new Uint8Array(count)
    : erodeMask(
      dilateMask(water, width, height, MAP_WATER_ENCLOSURE_RADIUS_PX),
      width,
      height,
      MAP_WATER_ENCLOSURE_RADIUS_PX,
    );

  const waterStamp = new Uint8Array(count);
  let widenedWaterPx = 0;
  for (let index = 0; index < count; index += 1) {
    if (widenedWater[index] !== 1) continue;
    widenedWaterPx += 1;
    if (water[index] !== 1) {
      // A pixel the widening would ADD. It yields to whatever the river flows around or under:
      // anything the closing encloses (a bridge deck, a reed bed, an islet) and any linework.
      if (enclosed[index] === 1 || widenedLine[index] === 1) continue;
    }
    waterStamp[index] = 1;
  }
  const lineStamp = new Uint8Array(count);
  let widenedLinePx = 0;
  for (let index = 0; index < count; index += 1) {
    if (widenedLine[index] !== 1) continue;
    widenedLinePx += 1;
    // A road never repaints the river it crosses: the deck itself is preserved by the enclosure
    // test above, and the water either side of it belongs to the water.
    if (water[index] === 1) continue;
    lineStamp[index] = 1;
  }

  if (waterPx > 0) {
    const painted = growFeatureColour(
      pixels,
      width,
      height,
      water,
      waterStamp,
      MAP_WATER_STROKE_RADIUS_PX + 1,
    );
    for (let index = 0; index < count; index += 1) {
      if (waterStamp[index] !== 1 || water[index] === 1) continue;
      pixels[index * 4] = painted[index * 4] as number;
      pixels[index * 4 + 1] = painted[index * 4 + 1] as number;
      pixels[index * 4 + 2] = painted[index * 4 + 2] as number;
      pixels[index * 4 + 3] = 255;
    }
  }

  // The colour half of the minimum stroke: water is moved further along the direction it already
  // differs from its own banks in, until it holds WATER_CONTRAST_TARGET luma of separation. A
  // translation, not a recolour -- every ripple, weed bed and depth shade inside the river keeps
  // its exact relationship to every other, and the hue family never changes.
  let waterContrastGain = 1;
  if (waterPx > 0) {
    const surround = dilateMask(waterStamp, width, height, WATER_SURROUND_RADIUS_PX);
    const waterSum = [0, 0, 0];
    const bankSum = [0, 0, 0];
    let waterSamples = 0;
    let bankSamples = 0;
    for (let index = 0; index < count; index += 1) {
      if (opaque[index] !== 1) continue;
      const target = waterStamp[index] === 1 ? waterSum : (surround[index] === 1 ? bankSum : null);
      if (target === null) continue;
      target[0] += pixels[index * 4] as number;
      target[1] += pixels[index * 4 + 1] as number;
      target[2] += pixels[index * 4 + 2] as number;
      if (waterStamp[index] === 1) waterSamples += 1;
      else bankSamples += 1;
    }
    if (waterSamples > 64 && bankSamples > 64) {
      const offset = [
        (waterSum[0] as number) / waterSamples - (bankSum[0] as number) / bankSamples,
        (waterSum[1] as number) / waterSamples - (bankSum[1] as number) / bankSamples,
        (waterSum[2] as number) / waterSamples - (bankSum[2] as number) / bankSamples,
      ];
      const separation = Math.abs(
        (offset[0] as number) * 0.3 + (offset[1] as number) * 0.59 + (offset[2] as number) * 0.11,
      );
      if (separation > 1) {
        waterContrastGain = Math.min(
          WATER_CONTRAST_MAX_GAIN,
          Math.max(1, WATER_CONTRAST_TARGET / separation),
        );
      }
      if (waterContrastGain > 1.001) {
        const push = waterContrastGain - 1;
        for (let index = 0; index < count; index += 1) {
          if (waterStamp[index] !== 1) continue;
          for (let channel = 0; channel < 3; channel += 1) {
            const value = pixels[index * 4 + channel] as number;
            pixels[index * 4 + channel] = Math.round(value + (offset[channel] as number) * push);
          }
        }
      }
    }
  }

  // What crosses the river. A timber bridge deck is a linear feature in exactly the sense the
  // river is -- it exists, it is one tile wide, and below the legibility threshold it is simply
  // gone. Two crossings on a bold channel is the difference between "there is water up there" and
  // "that is a river valley with a road over it". The widening is confined to the river and its
  // own footprint, so a bridge never grows out into the meadow it lands in.
  let crossingPx = 0;
  let widenedCrossingPx = 0;
  if (waterPx > 0) {
    // Eroded, so only what is genuinely INSIDE the channel counts. The closing also smooths shallow
    // notches in the river's own outer bank, and a grass notch is not a bridge.
    const inside = erodeMask(enclosed, width, height, 2);
    const crossing = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      if (opaque[index] !== 1 || water[index] === 1 || inside[index] !== 1) continue;
      crossing[index] = 1;
      crossingPx += 1;
    }
    if (crossingPx > 0) {
      const bounds = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) {
        bounds[index] = (widenedWater[index] === 1 || crossing[index] === 1) ? 1 : 0;
      }
      const widened = minimumStroke(
        crossing,
        width,
        height,
        MAP_LINE_STROKE_RADIUS_PX,
        bounds,
      );
      for (let index = 0; index < count; index += 1) if (widened[index] === 1) widenedCrossingPx += 1;
      const painted = growFeatureColour(
        pixels,
        width,
        height,
        crossing,
        widened,
        MAP_LINE_STROKE_RADIUS_PX + 1,
      );
      for (let index = 0; index < count; index += 1) {
        if (widened[index] !== 1 || crossing[index] === 1) continue;
        pixels[index * 4] = painted[index * 4] as number;
        pixels[index * 4 + 1] = painted[index * 4 + 1] as number;
        pixels[index * 4 + 2] = painted[index * 4 + 2] as number;
        pixels[index * 4 + 3] = 255;
      }
    }
  }

  if (linePx > 0) {
    const painted = growFeatureColour(
      pixels,
      width,
      height,
      line,
      lineStamp,
      MAP_LINE_STROKE_RADIUS_PX + 1,
    );
    // Only THIN linework earns a contrast push -- a sprite cluster is already legible and pushing
    // it just turns the map garish. Measured on the thin set so the push tracks the real deficit.
    const thinLine = new Uint8Array(count);
    const openedLine = dilateMask(
      erodeMask(line, width, height, MAP_LINE_STROKE_RADIUS_PX),
      width,
      height,
      MAP_LINE_STROKE_RADIUS_PX,
    );
    let separation = 0;
    let thinCount = 0;
    for (let index = 0; index < count; index += 1) {
      if (lineStamp[index] !== 1 || openedLine[index] === 1) continue;
      thinLine[index] = 1;
      separation += Math.abs((painted[index * 4] as number) - field.red)
        + Math.abs((painted[index * 4 + 1] as number) - field.green)
        + Math.abs((painted[index * 4 + 2] as number) - field.blue);
      thinCount += 1;
    }
    const contrastGain = !uniformField || thinCount === 0
      ? 1
      : Math.min(
        LINE_CONTRAST_MAX_GAIN,
        Math.max(1, LINE_CONTRAST_TARGET / Math.max(1, separation / thinCount)),
      );
    for (let index = 0; index < count; index += 1) {
      if (lineStamp[index] !== 1) continue;
      const push = thinLine[index] === 1 ? contrastGain : 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const base = channel === 0 ? field.red : channel === 1 ? field.green : field.blue;
        const value = painted[index * 4 + channel] as number;
        pixels[index * 4 + channel] = push === 1
          ? value
          : Math.round(base + (value - base) * push);
      }
      pixels[index * 4 + 3] = 255;
    }
  }

  return {
    water: waterStamp,
    uniformField,
    fieldToneGain,
    waterContrastGain,
    waterPx,
    widenedWaterPx,
    linePx,
    widenedLinePx,
    crossingPx,
    widenedCrossingPx,
  };
}
