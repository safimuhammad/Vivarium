/**
 * @fileoverview The map inset: a region's OWN rendered content, projected into its island so the
 * world view shows the same place the region view does (design of record:
 * `docs/frontend/ATLAS_VIEW.md` §3, "Symbol scaling (map zoom only)").
 *
 * Two facts drive this module.
 *
 * 1. **The coastline encloses about a third of the plot.** An island's silhouette is generated from
 *    the region's id, kit, neighbour directions and carrying capacity -- it knows nothing about
 *    what was authored inside. Drawing the region 1:1 and clipping to that silhouette therefore
 *    keeps whatever happens to sit in the middle and throws the rest into the sea. For a kit-art
 *    region that is invisible; for an authored one it is fatal -- Nirvana's river, its timber
 *    bridges and its ponds all run along the plot's north and west margins, so a 1:1 clip deleted
 *    the entire valley and left a featureless meadow. This layer instead **projects the whole plot
 *    into a box fitted to the island's LAND** (`islandMapFit`). Zoomed out you see the same river
 *    you just left; the island is a map of the region rather than a window onto its middle.
 *
 *    Fitting to the land rather than to the land's BOUNDING BOX is the difference between the map
 *    carrying the region's margins and dropping them: the bounding box of a blob is sea wherever
 *    the coast is inset from it, so a plot stretched into it puts its own edges in open water. The
 *    fit is a uniform scale plus a translation -- never a per-axis stretch, never a warp onto the
 *    coastline -- so the region's real proportions survive the trip. What it costs is coverage: the
 *    ring of land outside the fit keeps the island's dressing instead of the map.
 * 2. **A 32 px tree is about 1 % of a 3072 px island** and simply vanishes when the whole world is
 *    in frame. So the region's own sprites are re-drawn over the projection as enlarged map symbols
 *    ({@link MAP_SYMBOL_SCALE}x), **each anchored at its own real position** -- so a wood reads as a
 *    wood, a clearing stays clear, and nothing is ever planted in the river.
 *
 * A third fact was learned the hard way, at native size: **a projection is not yet a map.** Nirvana's
 * river is two or three tiles wide, which at island scale is a couple of device pixels -- and every
 * bank tree, tripled into a map symbol, reached right across it. Honest arithmetic produced a
 * picture with no river in it, which misinforms the viewer exactly as much as inventing one would.
 * So between the projection and the symbols the inset is **generalized** the way a printed map is
 * ({@link generalizeMapInset}): linear features that exist -- the water first, then the roads and
 * the bridges over it -- are given a minimum stroke so they survive the downscale, their paths
 * untouched; a uniform kit field gets back the tone variation it really carries; and no map symbol
 * is planted in, or cast over, the river.
 *
 * The layer fades out as the camera crosses the region threshold, leaving the region's real 1:1
 * scenery -- a map symbol becomes a tree.
 *
 * **The pixels are copied out of the region's already-rasterised terrain and scenery canvases**,
 * never re-fetched from an atlas and never re-derived from a recipe: just the canvases the cache
 * pipeline already produced, plus the rectangles the scenery layer was drawn into. That keeps it
 * entirely clear of Nirvana's authored-scene sidecar (this module never sees a recipe object).
 */

import { unitHash, type MaskRect } from "./islandMask";
import { generalizeMapInset, type GeneralizedInset } from "./mapGeneralization";

/** The most a map symbol is ever enlarged over its own footprint. */
export const MAP_SYMBOL_SCALE = 3.1;

/**
 * The size, in plot pixels, a map symbol is enlarged TOWARD -- a 32 px tile sprite at the full
 * {@link MAP_SYMBOL_SCALE}.
 *
 * Enlargement is capped at this size rather than applied blindly, because "make it big enough to
 * see" is the whole point and a sprite already bigger than this does not need it. Nirvana's
 * authored landmark clusters are 256 px; multiplying THOSE by 3.1 was what turned the world view
 * into a mat of overlapping 800 px blobs with the valley hidden underneath. They now draw once, at
 * their real size, in the projection itself.
 */
export const MAP_SYMBOL_TARGET_PX = 99;

/**
 * The inset raster's sampling rate, expressed as the longest side it would take for a box the size
 * of the whole PLOT. The box the fit chooses sets the raster's SIZE; it never changes its SCALE.
 *
 * Keyed to the plot rather than to the box because the generalization pass downstream is tuned in
 * RASTER pixels, and what a raster pixel is worth ON SCREEN is
 * `sheetScale x plotLongestSide / MAP_INSET_MAX_PX` -- a constant, once the raster is keyed here.
 * So a fit that shrinks the map cannot silently re-scale the minimum stroke under it: a river that
 * reads at one fit still reads at another. (Keying to the box instead holds the raster's CONTENT
 * resolution constant and lets its screen resolution drift, which is the wrong invariant for a pass
 * whose entire job is legibility at a distance.)
 *
 * The island is ~330 screen px with the whole world in frame and the inset has faded out entirely
 * well before it fills the canvas, so 640 is comfortably oversampled at every zoom it is actually
 * visible at -- at a fraction of the memory of rasterising a 3072 px plot.
 */
export const MAP_INSET_MAX_PX = 640;

/** One sprite already rasterised into a region's scenery canvas, in plot-local pixels. */
export interface MapSymbolRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Creates the offscreen surface the inset is drawn into (see `atlasIslandLayers.ts`). */
export type MapSymbolSurfaceFactory = (
  widthPx: number,
  heightPx: number,
) => Readonly<{ canvas: CanvasImageSource; context: CanvasRenderingContext2D }> | null;

/** A built map inset plus the raster size it must be stretched from. */
export interface MapSymbolLayer {
  readonly canvas: CanvasImageSource;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  /** What the cartographic-generalization pass found and did, or `null` when the surface could not
   * be read back (jsdom, or a tainted canvas) and the inset was left as a plain downscale. */
  readonly generalized: GeneralizedInset | null;
}

/** Everything needed to project one region into its island. */
export interface MapInsetInput {
  /** The region's stable id -- the sole seed for the symbol thinning. */
  readonly regionId: string;
  /** The region's already-rasterised layers, drawn in order (terrain, then scenery). */
  readonly content: readonly CanvasImageSource[];
  /** The plot size those canvases cover, in world pixels. */
  readonly contentWidthPx: number;
  readonly contentHeightPx: number;
  /** Where the plot is projected on the island, in plot-local pixels. Its aspect ratio must match
   * the plot's, or the projection stretches (see `islandMapFit`, which guarantees it). */
  readonly plotBox: MaskRect;
  /** Where the region's sprites landed in its scenery canvas, in plot-local pixels. */
  readonly rects: readonly MapSymbolRect[];
  /** Signed distance to the coast, in mask cells (negative inland), at a plot-local point -- used
   * to fade the inset out across the shore band so the island's own beach and coast rim light
   * still read. Omit to fill the whole land box opaquely. */
  readonly shoreDistance?: (localX: number, localY: number) => number;
  readonly surface: MapSymbolSurfaceFactory;
}

/** Inland depth, in mask cells, at which the inset becomes fully opaque. Inside this band the map's
 * own shore dressing (beach, coast rim light) owns the pixels; beyond it, the region does. */
export const MAP_INSET_SHORE_CELLS = 9;

/**
 * How far the inset fades in from its OWN edge, as a fraction of its shorter side.
 *
 * The land-fitted projection no longer reaches the coast on every side: where it does not, the map
 * would otherwise end on a ruled line across the middle of an island, which reads as a sticker
 * rather than as terrain. Fading the last stretch hands those pixels back to the island's dressing
 * and the region's own 1:1 art beneath it, so the map dissolves into its island instead of stopping.
 * Where the fit DOES reach the coast the shore band below is the tighter of the two and wins, so a
 * river still runs out to the waterline.
 */
const MAP_INSET_EDGE_FADE_FRACTION = 0.07;

/** Water fades over a third of that band: a watercourse that dissolves as gently as a meadow does
 * stops reading as a watercourse well before it stops being drawn. */
const MAP_INSET_EDGE_WATER_FRACTION = 0.34;

/** Depth at which the inset starts to appear at all -- just inland of the waterline, so no content
 * is painted over the surf. */
const MAP_INSET_SHORE_START_CELLS = 1;

/**
 * Inland depth, in mask cells, at which the WATER network becomes fully opaque.
 *
 * Water gets a much shallower band than the rest of the inset. Nirvana's river runs along the
 * plot's north margin, which projects onto the island's north coast: under the full nine-cell fade
 * the region's single most distinctive feature dissolved into beach. A river that reaches the
 * waterline reads as a river mouth, which is both what it is and the strongest thing a map can say
 * about a valley. The beach and the coast rim light still own everything else there, so the island
 * still reads as land sitting in water.
 */
export const MAP_INSET_WATER_SHORE_CELLS = 3;

/** The water band fades LINEARLY, where the rest of the inset fades on a square. The square curve
 * is right for content that should dissolve into a beach; it is wrong for a watercourse, which
 * should still be a watercourse at the last pixel before the surf. */
const waterShoreFade = (depth: number): number =>
  Math.max(0, Math.min(1, depth / MAP_INSET_WATER_SHORE_CELLS));

/**
 * How many enlarged symbols an inset of this many pixels carries.
 *
 * Tuned so vegetation reads as woodland at map zoom without becoming a carpet: the previous
 * grove-noise scatter covered ~60 % of the island's land with enlarged sprites, which hid whatever
 * the terrain underneath was trying to say. Because symbols now stand where the region's sprites
 * really are, the same budget clusters into woods and leaves water, roads and clearings alone.
 *
 * Takes the raster size NORMALIZED to {@link MAP_INSET_MAX_PX} on its long side (see the call site),
 * so the budget is a property of the REGION -- how many of its sprites the map carries -- and not of
 * how large a box the land fit happened to leave for it. Keyed to the raw raster instead, a smaller
 * fit would quietly thin the woods: measured, Nirvana East lost one of its four southern clusters.
 */
export function mapInsetSymbolBudget(rasterWidth: number, rasterHeight: number): number {
  return Math.max(24, Math.round((rasterWidth * rasterHeight) / 1_300));
}

/**
 * Builds one region's map inset.
 *
 * The projection is the plot scaled UNIFORMLY into `plotBox` (the caller's fit; both axes share one
 * scale, so the region's proportions are its own). Terrain and scenery are drawn first, smoothed --
 * a 5x downscale of pixel art with nearest-neighbour sampling drops most of what it walks over, and
 * this is a map inset rather than 1:1 art. The enlarged symbols are then drawn unsmoothed on top,
 * each anchored at the bottom-centre of its own projected rect so a tree grows *out of* the spot it
 * really occupies.
 *
 * @param input - The region's id, its rasterised layers and their plot size, the box the plot is
 *   projected into, the sprite rectangles, and a surface factory.
 * @returns The layer, or `null` when there is nothing to draw or no surface can be created.
 */
export function buildRegionMapInset(input: MapInsetInput): MapSymbolLayer | null {
  const { regionId, content, contentWidthPx, contentHeightPx, plotBox, rects, surface } = input;
  if (contentWidthPx <= 0 || contentHeightPx <= 0) return null;
  if (plotBox.width <= 0 || plotBox.height <= 0) return null;
  if (content.length === 0 && rects.length === 0) return null;

  // Sampled against the PLOT, so one raster pixel is worth the same number of SCREEN pixels however
  // small a box the fit chose -- which is what keeps the generalization pass's minimum stroke, tuned
  // in raster px, worth the same width to the eye. See MAP_INSET_MAX_PX.
  const raster = Math.min(1, MAP_INSET_MAX_PX / Math.max(contentWidthPx, contentHeightPx));
  const width = Math.max(1, Math.round(plotBox.width * raster));
  const height = Math.max(1, Math.round(plotBox.height * raster));
  const made = surface(width, height);
  if (made === null) return null;
  const context = made.context;

  // plot pixels -> inset raster pixels
  const scaleX = width / contentWidthPx;
  const scaleY = height / contentHeightPx;

  context.imageSmoothingEnabled = true;
  for (const layer of content) {
    try {
      context.drawImage(layer, 0, 0, contentWidthPx, contentHeightPx, 0, 0, width, height);
    } catch {
      // One unreadable layer cannot fail the whole map; the rest of the inset still draws.
    }
  }
  context.imageSmoothingEnabled = false;

  // Cartographic generalization, before a single map symbol is drawn: the river and the road
  // network are given a minimum stroke so they survive the downscale, and a uniform kit field is
  // given back the tone variation it actually carries (see `world/mapGeneralization.ts`). Failing
  // to read the surface back is not fatal -- the inset then stays a plain honest downscale, which
  // is how it behaved before this pass existed.
  let generalized: GeneralizedInset | null = null;
  try {
    const projected = context.getImageData(0, 0, width, height);
    generalized = generalizeMapInset(projected);
    context.putImageData(projected, 0, 0);
  } catch {
    generalized = null;
  }

  if (rects.length > 0) {
    // Raster pixels per plot pixel OF THE DISPLAYED INSET. Symbol enlargement is expressed against
    // this, not against the raster's own scale, so a symbol keeps the same size on screen however
    // hard the plot had to be squeezed to fit inside its coastline.
    const displayScale = width / plotBox.width;
    // Normalized to the plot, not to the raster: the map carries the same slice of the region's own
    // sprites whatever box the fit chose (see mapInsetSymbolBudget).
    const budgetScale = MAP_INSET_MAX_PX / Math.max(width, height);
    const budget = mapInsetSymbolBudget(width * budgetScale, height * budgetScale);
    // Only sprites that would otherwise be too small to see are re-drawn enlarged; anything already
    // at least the target size is left to the projection, which drew it once at its true size.
    // Then thin by a position hash, which keeps the survivors spatially even -- a wood stays a wood
    // and a clearing stays clear, because every symbol stands where its sprite really stands.
    const boostable = [...rects]
      .filter((rect) => Math.max(rect.width, rect.height) < MAP_SYMBOL_TARGET_PX)
      .sort((left, right) => (right.width * right.height) - (left.width * left.height));
    // "What stands tall enough to be seen from here": the region's larger sprites -- its trees and
    // reed stands -- not its flowers. A generous slice, so the hash thinning below still has enough
    // to draw from to stay spatially even.
    const eligible = boostable.slice(0, Math.max(budget, Math.ceil(boostable.length * 0.45)));
    // Thin to EXACTLY the budget by taking the lowest position hashes: a deterministic uniform
    // sample, so the survivors stay spatially even and the draw cost is a hard cap rather than an
    // average (a probabilistic keep overshoots, and this runs on every island).
    const sampled = eligible.length <= budget
      ? eligible
      : [...eligible]
        .map((rect) => ({ rect, key: unitHash(`${regionId}:keep:${rect.x}:${rect.y}`) }))
        .sort((left, right) => left.key - right.key
          || left.rect.y - right.rect.y
          || left.rect.x - right.rect.x)
        .slice(0, budget)
        .map(({ rect }) => rect);
    const water = generalized?.water ?? null;
    const placed = sampled
      .map((rect) => {
        // Enlarge TOWARD the target rather than by a blind multiple (see MAP_SYMBOL_TARGET_PX).
        const longest = Math.max(1, Math.max(rect.width, rect.height));
        const boost = Math.min(MAP_SYMBOL_SCALE, Math.max(1, MAP_SYMBOL_TARGET_PX / longest));
        // Anchor at the sprite's own base, projected: the point the tree stands on.
        const anchorX = (rect.x + rect.width / 2) * scaleX;
        const anchorY = (rect.y + rect.height) * scaleY;
        const drawWidth = Math.max(1, rect.width * displayScale * boost);
        const drawHeight = Math.max(1, rect.height * displayScale * boost);
        return { rect, anchorX, anchorY, drawWidth, drawHeight };
      })
      // Nothing stands in the river, and nothing looms over it. At 1:1 a reed bed in the shallows
      // is a reed bed; enlarged toward a 99 px map symbol it is a tree-sized blot over the one
      // feature the map most needs to show -- and a bank tree enlarged three times reaches right
      // across the channel it stands beside. A symbol is dropped when either its own base or the
      // body it would cast falls in the widened water. Nothing is lost: at 1:1 every one of them
      // is still exactly where it always was.
      .filter((symbol) => {
        if (water === null) return true;
        const inWater = (x: number, y: number): boolean => {
          const col = Math.round(x);
          const row = Math.round(y);
          if (col < 0 || col >= width || row < 0 || row >= height) return false;
          return water[row * width + col] === 1;
        };
        if (inWater(symbol.anchorX, symbol.anchorY - 1)) return false;
        return !inWater(symbol.anchorX, symbol.anchorY - symbol.drawHeight * 0.45);
      });
    // Depth sort: a symbol further south overlaps one further north, as on the ground.
    placed.sort((left, right) => left.anchorY - right.anchorY);

    const scenery = content[content.length - 1];
    for (const symbol of placed) {
      // contact shadow: what makes a sprite sit ON the ground rather than float above it
      context.globalAlpha = 0.22;
      context.fillStyle = "#1d2a1c";
      context.fillRect(
        Math.round(symbol.anchorX - symbol.drawWidth * 0.3),
        Math.round(symbol.anchorY - symbol.drawHeight * 0.06),
        Math.max(1, Math.round(symbol.drawWidth * 0.6)),
        Math.max(1, Math.round(symbol.drawHeight * 0.13)),
      );
      context.globalAlpha = 1;
      if (scenery === undefined) continue;
      try {
        context.drawImage(
          scenery,
          symbol.rect.x,
          symbol.rect.y,
          symbol.rect.width,
          symbol.rect.height,
          Math.round(symbol.anchorX - symbol.drawWidth / 2),
          Math.round(symbol.anchorY - symbol.drawHeight),
          Math.round(symbol.drawWidth),
          Math.round(symbol.drawHeight),
        );
      } catch {
        // A single unreadable sprite cannot fail the whole map.
      }
    }
  }
  applyShoreFade(context, width, height, plotBox, input.shoreDistance, generalized?.water ?? null);
  return { canvas: made.canvas, sourceWidth: width, sourceHeight: height, generalized };
}

/**
 * Fades the built inset out across the island's shore band AND across its own outer edge, in place.
 *
 * The inset is drawn OVER the island's map dressing, because the dressing's inland relief and value
 * mottle exist to give a monotone kit some texture and simply fog real terrain when there is real
 * terrain to see. Two places are exceptions:
 *
 * - **The shore.** The beach and the coast rim light are what make the silhouette read as land
 *   sitting in water, so the outermost band is handed back to them. The result is a shoreline the
 *   region grows out of rather than a hard disc of content stamped inside a coastline.
 * - **The map's own edge.** The projection is fitted to the island's land, so on the sides where the
 *   land reaches further than the fit does, the inset ends inland. Ending on a ruled line would read
 *   as a sticker; the last stretch is faded so the map dissolves into the island instead.
 *
 * Each pixel takes the TIGHTER of the two, so a fit edge that happens to land on the coast behaves
 * exactly as the shore band alone did.
 *
 * A no-op when no distance function is supplied, or when the surface cannot be read back (a
 * tainted or unimplemented canvas) -- the inset then simply fills its box, which is how it
 * behaved before the fade and is still far better than showing the wrong terrain.
 */
function applyShoreFade(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  plotBox: MaskRect,
  shoreDistance: ((localX: number, localY: number) => number) | undefined,
  water: Uint8Array | null,
): void {
  if (shoreDistance === undefined) return;
  let image: ImageData;
  try {
    image = context.getImageData(0, 0, width, height);
  } catch {
    return;
  }
  const pixels = image.data;
  const span = MAP_INSET_SHORE_CELLS - MAP_INSET_SHORE_START_CELLS;
  const stepX = plotBox.width / width;
  const stepY = plotBox.height / height;
  const edgeBand = Math.max(1, Math.min(width, height) * MAP_INSET_EDGE_FADE_FRACTION);
  const waterBand = Math.max(1, edgeBand * MAP_INSET_EDGE_WATER_FRACTION);
  for (let row = 0; row < height; row += 1) {
    const localY = plotBox.y + (row + 0.5) * stepY;
    const edgeY = Math.min(row + 0.5, height - 0.5 - row);
    for (let col = 0; col < width; col += 1) {
      const index = row * width + col;
      const offset = index * 4;
      const alpha = pixels[offset + 3] as number;
      if (alpha === 0) continue;
      const isWater = water !== null && water[index] === 1;
      const depth = -shoreDistance(plotBox.x + (col + 0.5) * stepX, localY);
      // How far in from the inset's own edge this pixel sits, in raster px.
      const inset = Math.min(edgeY, col + 0.5, width - 0.5 - col);
      const edge = Math.max(0, Math.min(1, inset / (isWater ? waterBand : edgeBand)));
      let fade = isWater ? edge : edge * edge;
      if (isWater) {
        if (depth < MAP_INSET_WATER_SHORE_CELLS) fade = Math.min(fade, waterShoreFade(depth));
      } else if (depth < MAP_INSET_SHORE_CELLS) {
        const shore = depth <= MAP_INSET_SHORE_START_CELLS
          ? 0
          : (depth - MAP_INSET_SHORE_START_CELLS) / span;
        fade = Math.min(fade, shore * shore);
      }
      if (fade >= 1) continue;
      pixels[offset + 3] = Math.round(alpha * fade);
    }
  }
  context.putImageData(image, 0, 0);
}
