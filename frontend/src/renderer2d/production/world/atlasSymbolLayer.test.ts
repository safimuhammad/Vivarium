import { describe, expect, it, vi } from "vitest";

import {
  buildRegionMapInset,
  mapInsetSymbolBudget,
  MAP_INSET_MAX_PX,
  MAP_SYMBOL_SCALE,
  MAP_SYMBOL_TARGET_PX,
  type MapSymbolRect,
} from "./atlasSymbolLayer";
import { buildIslandMask, islandMapFit, maskDistanceAtLocal } from "./islandMask";

type DrawCall = Readonly<{
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}>;

interface Recorder {
  readonly surface: (w: number, h: number) => Readonly<{
    canvas: CanvasImageSource;
    context: CanvasRenderingContext2D;
  }> | null;
  readonly draws: DrawCall[];
  readonly size: { width: number; height: number };
  readonly smoothing: boolean[];
  readonly getImageData: ReturnType<typeof vi.fn>;
  readonly putImageData: ReturnType<typeof vi.fn>;
}

/**
 * A recording 2D context: most assertions here are about draw calls, not pixels.
 *
 * `water` paints a horizontal band of river-coloured pixels into whatever the surface is read
 * back as, on a meadow-coloured ground -- enough for the cartographic-generalization pass to have
 * something real to classify.
 */
function recorder(
  options: Readonly<{
    readable?: boolean;
    water?: Readonly<{ fromRow: number; toRow: number }>;
  }> = {},
): Recorder {
  const draws: DrawCall[] = [];
  const smoothing: boolean[] = [];
  const size = { width: 0, height: 0 };
  const canvas = { __canvas: true } as unknown as CanvasImageSource;
  const band = options.water;
  const readBack = (w: number, h: number): ImageData => {
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    if (band !== undefined) {
      for (let row = 0; row < h; row += 1) {
        const isWater = row >= band.fromRow * h && row < band.toRow * h;
        for (let col = 0; col < w; col += 1) {
          const offset = (row * w + col) * 4;
          data[offset] = isWater ? 80 : 150;
          data[offset + 1] = isWater ? 112 : 160;
          data[offset + 2] = isWater ? 124 : 90;
          data[offset + 3] = 255;
        }
      }
    }
    return { data, width: w, height: h } as ImageData;
  };
  const getImageData = options.readable === false
    ? vi.fn(() => { throw new Error("tainted"); })
    : vi.fn((_x: number, _y: number, w: number, h: number) => readBack(w, h));
  const putImageData = vi.fn();
  return {
    draws,
    size,
    smoothing,
    getImageData,
    putImageData,
    surface: (width, height) => {
      size.width = width;
      size.height = height;
      const context = {
        set imageSmoothingEnabled(value: boolean) { smoothing.push(value); },
        get imageSmoothingEnabled() { return smoothing[smoothing.length - 1] ?? false; },
        globalAlpha: 1,
        fillStyle: "",
        fillRect: vi.fn(),
        putImageData,
        getImageData,
        drawImage: vi.fn((...args: unknown[]) => {
          if (args.length === 9) {
            const [, sx, sy, sw, sh, dx, dy, dw, dh] = args as [unknown, ...number[]];
            draws.push({ sx: sx!, sy: sy!, sw: sw!, sh: sh!, dx: dx!, dy: dy!, dw: dw!, dh: dh! });
          }
        }),
      } as unknown as CanvasRenderingContext2D;
      return { canvas, context };
    },
  };
}

const TERRAIN = { __terrain: true } as unknown as CanvasImageSource;
const SCENERY = { __scenery: true } as unknown as CanvasImageSource;

const PLOT = 3_072;
/** A land-fitted projection box, at the plot's own aspect: Nirvana's real fit, measured. */
const PLOT_BOX = { x: 1_064, y: 616, width: 1_472, height: 1_472 } as const;
/** Raster pixels per plot pixel: keyed to the PLOT, so the fit never re-scales the raster. */
const RASTER = MAP_INSET_MAX_PX / PLOT;

function inset(
  rects: readonly MapSymbolRect[],
  overrides: Partial<Parameters<typeof buildRegionMapInset>[0]> = {},
  rec: Recorder = recorder(),
): Readonly<{ layer: ReturnType<typeof buildRegionMapInset>; rec: Recorder }> {
  const layer = buildRegionMapInset({
    regionId: "nirvana",
    content: [TERRAIN, SCENERY],
    contentWidthPx: PLOT,
    contentHeightPx: PLOT,
    plotBox: PLOT_BOX,
    rects,
    surface: rec.surface,
    ...overrides,
  });
  return { layer, rec };
}

function tree(x: number, y: number, size = 32): MapSymbolRect {
  return { x, y, width: size, height: size };
}

describe("buildRegionMapInset", () => {
  it("samples the raster against the PLOT, so a smaller fit does not re-scale it", () => {
    const { layer, rec } = inset([]);
    expect(layer).not.toBeNull();
    expect(rec.size.width).toBe(Math.round(PLOT_BOX.width * RASTER));
    expect(rec.size.height).toBe(Math.round(PLOT_BOX.height * RASTER));
    expect(layer?.sourceWidth).toBe(rec.size.width);
    expect(layer?.sourceHeight).toBe(rec.size.height);
    // Same plot, a box half the size: half the raster, and the SAME plot pixels per raster pixel --
    // which is what keeps the generalization pass downstream tuned in raster px meaningful.
    const half = inset([], { plotBox: { x: 0, y: 0, width: 736, height: 736 } }).rec;
    expect(half.size.width).toBe(Math.round(736 * RASTER));
    expect(half.size.width / 736).toBeCloseTo(rec.size.width / PLOT_BOX.width, 2);
  });

  it("caps the raster at MAP_INSET_MAX_PX -- the fit can never exceed the plot", () => {
    const { rec } = inset([], { plotBox: { x: 0, y: 0, width: PLOT, height: PLOT } });
    expect(rec.size.width).toBe(MAP_INSET_MAX_PX);
    expect(rec.size.height).toBe(MAP_INSET_MAX_PX);
  });

  it("never rasterises above its own box for a tiny plot", () => {
    const small = { x: 0, y: 0, width: 200, height: 180 } as const;
    const { rec } = inset([], { plotBox: small, contentWidthPx: 200, contentHeightPx: 180 });
    expect(rec.size.width).toBe(200);
    expect(rec.size.height).toBe(180);
  });

  it("projects the WHOLE plot into the fit -- the defect this layer exists to fix", () => {
    // Nirvana's river runs along the plot's north and west margins. A 1:1 clip to the coastline
    // discards them; the projection must map plot (0,0)-(3072,3072) onto the whole raster.
    const { rec } = inset([]);
    const content = rec.draws.filter((call) => call.sw === PLOT && call.sh === PLOT);
    expect(content).toHaveLength(2);
    for (const call of content) {
      expect(call).toMatchObject({ sx: 0, sy: 0, dx: 0, dy: 0 });
      expect(call.dw).toBe(rec.size.width);
      expect(call.dh).toBe(rec.size.height);
    }
  });

  it("draws terrain first and scenery second, smoothed, then symbols unsmoothed", () => {
    const { rec } = inset([tree(1_500, 1_500)]);
    expect(rec.smoothing[0]).toBe(true);
    expect(rec.smoothing.at(-1)).toBe(false);
  });

  it("anchors every symbol at its own real position, not a noise scatter", () => {
    const rects = [tree(0, 0), tree(PLOT - 32, PLOT - 32)];
    const { rec } = inset(rects);
    const symbols = rec.draws.filter((call) => call.sw === 32);
    expect(symbols).toHaveLength(2);
    // North-west sprite stays north-west; south-east sprite stays south-east.
    const [first, second] = [...symbols].sort((a, b) => a.dx - b.dx);
    expect(first!.dx).toBeLessThan(rec.size.width * 0.25);
    expect(second!.dx).toBeGreaterThan(rec.size.width * 0.5);
    expect(first!.dy).toBeLessThan(rec.size.height * 0.25);
    expect(second!.dy).toBeGreaterThan(rec.size.height * 0.5);
    // Anchored on the sprite's own base: the symbol's bottom edge sits at the projected foot of
    // the rect it came from, so enlarging it grows the tree upward rather than sliding it.
    const foot = (0 + 32) * (rec.size.height / PLOT);
    // Within a raster pixel: the draw rounds the top edge and the height independently.
    expect(Math.abs(first!.dy + first!.dh - foot)).toBeLessThanOrEqual(1.5);
  });

  it("leaves a clearing clear: no symbol is drawn where the region has no sprite", () => {
    // One dense wood in the north-west quadrant only.
    const rects: MapSymbolRect[] = [];
    for (let index = 0; index < 200; index += 1) {
      rects.push(tree(100 + (index % 20) * 30, 100 + Math.floor(index / 20) * 30));
    }
    const { rec } = inset(rects);
    const symbols = rec.draws.filter((call) => call.sw === 32);
    expect(symbols.length).toBeGreaterThan(0);
    // Every symbol lands in the north-west quadrant, because that is where the wood really is.
    for (const symbol of symbols) {
      expect(symbol.dx).toBeLessThan(rec.size.width * 0.5);
      expect(symbol.dy).toBeLessThan(rec.size.height * 0.5);
    }
  });

  it("enlarges a small sprite toward the target size but never past MAP_SYMBOL_SCALE", () => {
    const { rec } = inset([tree(1_500, 1_500, 32)]);
    const symbol = rec.draws.find((call) => call.sw === 32);
    const displayScale = rec.size.width / PLOT_BOX.width;
    expect(symbol?.dw).toBe(Math.round(32 * displayScale * MAP_SYMBOL_SCALE));
    expect(symbol!.dw / 32).toBeLessThanOrEqual(displayScale * MAP_SYMBOL_SCALE + 1);
  });

  it("does NOT enlarge a sprite already at or above the target size", () => {
    // Nirvana's authored landmark clusters are 256 px; blindly tripling them was the carpet that
    // hid the valley. They must not be re-drawn as symbols at all.
    const big = MAP_SYMBOL_TARGET_PX + 1;
    const { rec } = inset([tree(1_500, 1_500, big)]);
    expect(rec.draws.some((call) => call.sw === big)).toBe(false);
  });

  it("caps symbol count at the area budget, normalized to the plot rather than to the fit", () => {
    const rects: MapSymbolRect[] = [];
    for (let index = 0; index < 4_000; index += 1) {
      rects.push(tree((index * 71) % PLOT, (index * 137) % PLOT));
    }
    const { rec } = inset(rects);
    const scale = MAP_INSET_MAX_PX / Math.max(rec.size.width, rec.size.height);
    const budget = mapInsetSymbolBudget(rec.size.width * scale, rec.size.height * scale);
    const symbols = rec.draws.filter((call) => call.sw === 32);
    expect(symbols.length).toBeLessThanOrEqual(budget);
    expect(symbols.length).toBeGreaterThan(budget * 0.5);
    // The same region in a HALF-SIZE fit carries the same map symbols -- the budget is a property of
    // the region, not of how much room its coastline left.
    const smaller = inset(rects, { plotBox: { x: 0, y: 0, width: 736, height: 736 } }).rec;
    const smallerSymbols = smaller.draws.filter((call) => call.sw === 32);
    expect(smallerSymbols.length).toBe(symbols.length);
  });

  it("is deterministic: the same region and rects yield the same symbol placement", () => {
    const rects: MapSymbolRect[] = [];
    for (let index = 0; index < 900; index += 1) {
      rects.push(tree((index * 71) % PLOT, (index * 137) % PLOT));
    }
    const first = inset(rects).rec.draws.filter((call) => call.sw === 32);
    const second = inset(rects).rec.draws.filter((call) => call.sw === 32);
    expect(second).toEqual(first);
  });

  it("fades the inset out across the shore band so the island's beach still reads", () => {
    const rec = recorder();
    const mask = buildIslandMask({
      regionId: "nirvana",
      kit: "worn-heartland",
      widthPx: PLOT,
      heightPx: PLOT,
      capeAngles: [],
      fill: 0.86,
    });
    const fit = islandMapFit(mask, PLOT, PLOT);
    buildRegionMapInset({
      regionId: "nirvana",
      content: [TERRAIN, SCENERY],
      contentWidthPx: PLOT,
      contentHeightPx: PLOT,
      plotBox: fit,
      rects: [],
      shoreDistance: (x, y) => maskDistanceAtLocal(mask, x, y),
      surface: rec.surface,
    });
    // Two read-backs now: the cartographic-generalization pass reads the projection before the
    // symbols are drawn, the shore fade reads the finished inset. Both write what they read.
    expect(rec.getImageData).toHaveBeenCalledTimes(2);
    expect(rec.putImageData).toHaveBeenCalledTimes(2);
    const faded = rec.putImageData.mock.calls.at(-1)![0] as ImageData;
    const alphaAt = (col: number, row: number): number =>
      faded.data[(row * faded.width + col) * 4 + 3] as number;
    // Opaque deep inland, transparent right at the waterline corner of the land box.
    expect(alphaAt(Math.floor(faded.width / 2), Math.floor(faded.height / 2))).toBeGreaterThan(200);
    expect(alphaAt(0, 0)).toBe(0);
  });

  it("still produces a layer when the surface cannot be read back", () => {
    const rec = recorder({ readable: false });
    const { layer } = inset([tree(100, 100)], { shoreDistance: () => -50 }, rec);
    expect(layer).not.toBeNull();
    // No generalization is possible without a read-back; the inset stays a plain honest downscale
    // and every symbol still draws, exactly as it behaved before the pass existed.
    expect(layer?.generalized).toBeNull();
    expect(rec.draws.some((call) => call.sw === 32)).toBe(true);
  });

  it("plants no map symbol in the river -- and none looming over it", () => {
    // A raster whose top third is water. Sprites there are real (reed beds, bank trees), but
    // enlarged toward a 99 px map symbol they blot out the one feature the map most needs.
    const rec = recorder({ water: { fromRow: 0, toRow: 0.35 } });
    const rects = [
      tree(1_500, 200),    // stands in the water
      tree(1_500, 1_100),  // stands just below it, but a 3.1x symbol reaches back over the channel
      tree(1_500, 2_600),  // deep in the meadow
    ];
    const { layer } = inset(rects, {}, rec);
    expect(layer?.generalized).not.toBeNull();
    expect(layer!.generalized!.waterPx).toBeGreaterThan(0);
    const symbols = rec.draws.filter((call) => call.sw === 32);
    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.dy).toBeGreaterThan(rec.size.height * 0.6);
  });

  it("lets the river run to the waterline while the rest of the inset dissolves into the beach", () => {
    const rec = recorder({ water: { fromRow: 0, toRow: 0.35 } });
    // A coast three cells away everywhere: inside the nine-cell inset band, outside the water's.
    inset([], { shoreDistance: () => -3 }, rec);
    const faded = rec.putImageData.mock.calls.at(-1)![0] as ImageData;
    const alphaAt = (col: number, row: number): number =>
      faded.data[(row * faded.width + col) * 4 + 3] as number;
    const water = alphaAt(Math.floor(faded.width / 2), Math.floor(faded.height * 0.15));
    const land = alphaAt(Math.floor(faded.width / 2), Math.floor(faded.height * 0.8));
    expect(water).toBe(255);
    expect(land).toBeLessThan(120);
  });

  it("dissolves at its own edge, so a land-fitted map never ends on a ruled line", () => {
    const rec = recorder({ water: { fromRow: 0, toRow: 0.35 } });
    // Deep inland everywhere: the shore band cannot fire, so this is the map edge alone.
    inset([], { shoreDistance: () => -50 }, rec);
    const faded = rec.putImageData.mock.calls.at(-1)![0] as ImageData;
    const alphaAt = (col: number, row: number): number =>
      faded.data[(row * faded.width + col) * 4 + 3] as number;
    const mid = Math.floor(faded.height * 0.6);
    expect(alphaAt(Math.floor(faded.width / 2), mid)).toBe(255);
    expect(alphaAt(0, mid)).toBe(0);
    expect(alphaAt(2, mid)).toBeLessThan(alphaAt(Math.floor(faded.width * 0.06), mid));
    // Water crosses its own edge far more sharply than meadow does: a watercourse that dissolves as
    // gently as a field stops reading as a watercourse long before it stops being drawn.
    const edgeIn = Math.round(faded.width * 0.04);
    const waterRow = Math.floor(faded.height * 0.2);
    expect(alphaAt(edgeIn, waterRow)).toBeGreaterThan(alphaAt(edgeIn, mid));
  });

  it("returns null when there is nothing to draw, or no surface", () => {
    expect(inset([], { content: [] }).layer).toBeNull();
    expect(inset([], { plotBox: { x: 0, y: 0, width: 0, height: 10 } }).layer).toBeNull();
    expect(inset([], { contentWidthPx: 0 }).layer).toBeNull();
    expect(buildRegionMapInset({
      regionId: "nirvana",
      content: [TERRAIN],
      contentWidthPx: PLOT,
      contentHeightPx: PLOT,
      plotBox: PLOT_BOX,
      rects: [],
      surface: () => null,
    })).toBeNull();
  });

  it("survives an unreadable content layer or sprite without failing the whole map", () => {
    const rec = recorder();
    const base = rec.surface;
    let calls = 0;
    const failing: typeof base = (w, h) => {
      const made = base(w, h);
      if (made === null) return null;
      const original = made.context.drawImage.bind(made.context);
      (made.context as unknown as { drawImage: unknown }).drawImage = (...args: unknown[]) => {
        calls += 1;
        if (calls === 1) throw new Error("decode failed");
        return (original as (...a: unknown[]) => void)(...args);
      };
      return made;
    };
    const { layer } = inset([tree(500, 500)], {}, { ...rec, surface: failing });
    expect(layer).not.toBeNull();
  });
});

describe("mapInsetSymbolBudget", () => {
  it("scales with raster area and never drops below a readable floor", () => {
    expect(mapInsetSymbolBudget(1, 1)).toBe(24);
    expect(mapInsetSymbolBudget(640, 640)).toBeGreaterThan(mapInsetSymbolBudget(320, 320));
  });
});
