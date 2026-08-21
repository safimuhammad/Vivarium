import { describe, expect, it } from "vitest";

import { computeFitZoom, computeZoomPressPlan } from "./fitToBounds";

const VIEWPORT = { viewportWidthPx: 800, viewportHeightPx: 600 };
const ZOOM_RANGE = { minZoom: 0.5, maxZoom: 4 };
const TILE_SIZE_PX = 32;

describe("computeFitZoom", () => {
  it("clamps to maxZoom for zero positions (nothing to fit around)", () => {
    expect(computeFitZoom({ positions: [], tileSizePx: TILE_SIZE_PX, ...VIEWPORT, ...ZOOM_RANGE }))
      .toEqual({ zoom: 4, fits: true });
  });

  it("clamps to maxZoom for a single participant (unchanged single-actor behavior)", () => {
    expect(computeFitZoom({
      positions: [{ column: 10, row: 10 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    })).toEqual({ zoom: 4, fits: true });
  });

  it("clamps to maxZoom for two adjacent tiles (still fits at max zoom)", () => {
    const result = computeFitZoom({
      positions: [{ column: 10, row: 10 }, { column: 11, row: 10 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    expect(result.zoom).toBe(4);
    expect(result.fits).toBe(true);
  });

  it("zooms out to fit two participants spread far apart", () => {
    // 40-tile horizontal span + 2*2 padding tiles = 44 tiles wide -> 44*32=1408px world.
    // idealZoom = 800/1408 ~= 0.568, comfortably inside [0.5, 4].
    const result = computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 40, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    expect(result.zoom).toBeCloseTo(800 / ((40 + 4) * TILE_SIZE_PX), 5);
    expect(result.zoom).toBeLessThan(4);
    expect(result.zoom).toBeGreaterThan(0.5);
    expect(result.fits).toBe(true);
  });

  it("uses the tighter of width/height fit for a diagonally spread pair", () => {
    // Wide viewport (800x600) but positions spread more in rows than columns.
    const result = computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 2, row: 30 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    const widthFit = 800 / ((2 + 4) * TILE_SIZE_PX);
    const heightFit = 600 / ((30 + 4) * TILE_SIZE_PX);
    expect(heightFit).toBeLessThan(widthFit);
    expect(result.zoom).toBeCloseTo(heightFit, 5);
  });

  it("reports fits:false and clamps to minZoom when the pair is too far apart to ever fit", () => {
    const result = computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 500, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    expect(result.zoom).toBe(0.5);
    expect(result.fits).toBe(false);
  });

  it("is order-independent for the same pair of positions", () => {
    const forward = computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 40, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    const backward = computeFitZoom({
      positions: [{ column: 40, row: 0 }, { column: 0, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    expect(backward.zoom).toBe(forward.zoom);
  });

  it("extends the bounding box across three or more participants", () => {
    const result = computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 10, row: 0 }, { column: 40, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      ...VIEWPORT,
      ...ZOOM_RANGE,
    });
    // Span is still governed by the two extremes (0 and 40), the middle one is inside it.
    expect(result.zoom).toBeCloseTo(800 / ((40 + 4) * TILE_SIZE_PX), 5);
  });

  it("degrades to maxZoom when viewport/tile size inputs are non-positive (defensive)", () => {
    expect(computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 40, row: 0 }],
      tileSizePx: 0,
      viewportWidthPx: 800,
      viewportHeightPx: 600,
      ...ZOOM_RANGE,
    })).toEqual({ zoom: 4, fits: true });
    expect(computeFitZoom({
      positions: [{ column: 0, row: 0 }, { column: 40, row: 0 }],
      tileSizePx: TILE_SIZE_PX,
      viewportWidthPx: 0,
      viewportHeightPx: 600,
      ...ZOOM_RANGE,
    })).toEqual({ zoom: 4, fits: true });
  });
});

describe("computeZoomPressPlan", () => {
  const BASE = {
    minZoom: 0.5,
    maxZoom: 4,
    zoomInFactor: 1.25,
    resetPresses: 10,
    maxZoomOvershootPresses: 7,
  };

  it("reuses the exact overshoot count for the max-zoom (single-actor) target", () => {
    expect(computeZoomPressPlan({ ...BASE, targetZoom: 4 })).toEqual({
      resetPresses: 10,
      zoomInPresses: 7,
    });
  });

  it("floors the step count so the achieved zoom never exceeds the target", () => {
    const plan = computeZoomPressPlan({ ...BASE, targetZoom: 0.568 });
    const achieved = BASE.minZoom * BASE.zoomInFactor ** plan.zoomInPresses;
    expect(achieved).toBeLessThanOrEqual(0.568 + 1e-9);
    // One more press would exceed the target (proves flooring, not just any small count).
    const oneMore = BASE.minZoom * BASE.zoomInFactor ** (plan.zoomInPresses + 1);
    expect(oneMore).toBeGreaterThan(0.568);
  });

  it("requires zero '+' presses when the target is already at (or below) minZoom", () => {
    expect(computeZoomPressPlan({ ...BASE, targetZoom: 0.5 })).toEqual({
      resetPresses: 10,
      zoomInPresses: 0,
    });
    expect(computeZoomPressPlan({ ...BASE, targetZoom: 0.3 })).toEqual({
      resetPresses: 10,
      zoomInPresses: 0,
    });
  });

  it("always returns the same resetPresses regardless of target (deterministic baseline)", () => {
    expect(computeZoomPressPlan({ ...BASE, targetZoom: 1 }).resetPresses).toBe(10);
    expect(computeZoomPressPlan({ ...BASE, targetZoom: 4 }).resetPresses).toBe(10);
  });
});
