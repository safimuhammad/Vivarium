import { describe, expect, it } from "vitest";

import {
  arrowPanDelta,
  CLICK_MAX_DURATION_MS,
  DRAG_DEAD_ZONE_CSS,
  isClickGesture,
  wheelNavigationIntent,
} from "./WorldNavigationInput";

const BASE_WHEEL = {
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  viewportWidth: 400,
  viewportHeight: 300,
  anchorCss: { x: 120, y: 80 },
} as const;

describe("arrowPanDelta", () => {
  it.each([
    ["ArrowRight", { x: -32, y: 0 }],
    ["ArrowLeft", { x: 32, y: 0 }],
    ["ArrowUp", { x: 0, y: 32 }],
    ["ArrowDown", { x: 0, y: -32 }],
  ] as const)("maps %s to the grabbed-content convention", (key, deltaCss) => {
    expect(arrowPanDelta(key)).toEqual({ kind: "pan", deltaCss });
  });

  it("supports a finite custom keyboard step and rejects unsupported input", () => {
    expect(arrowPanDelta("ArrowRight", 12)).toEqual({
      kind: "pan",
      deltaCss: { x: -12, y: 0 },
    });
    expect(arrowPanDelta("Enter")).toBeNull();
    expect(arrowPanDelta("ArrowRight", Number.NaN)).toBeNull();
    expect(arrowPanDelta("ArrowRight", 0)).toBeNull();
  });
});

describe("wheelNavigationIntent", () => {
  it("maps a two-axis pixel wheel gesture to grabbed-content panning", () => {
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaX: 12,
      deltaY: -20,
    })).toEqual({
      kind: "pan",
      deltaCss: { x: -12, y: 20 },
    });
  });

  it("normalizes wheel lines to CSS pixels", () => {
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaX: 2,
      deltaY: -3,
      deltaMode: 1,
    })).toEqual({
      kind: "pan",
      deltaCss: { x: -32, y: 48 },
    });
  });

  it("normalizes wheel pages independently against each viewport axis", () => {
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaX: 0.5,
      deltaY: -0.5,
      deltaMode: 2,
    })).toEqual({
      kind: "pan",
      deltaCss: { x: -200, y: 150 },
    });
  });

  it("caps each pan axis to one viewport per event", () => {
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaX: 10_000,
      deltaY: -10_000,
    })).toEqual({
      kind: "pan",
      deltaCss: { x: -400, y: 300 },
    });
  });

  it("maps control-wheel to anchored exponential zoom with safe bounds", () => {
    const zoom = wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaY: 100,
      ctrlKey: true,
    });
    expect(zoom).toEqual({
      kind: "zoom",
      factor: expect.any(Number),
      anchorCss: { x: 120, y: 80 },
    });
    expect(zoom?.kind === "zoom" ? zoom.factor : Number.NaN)
      .toBeCloseTo(Math.exp(-0.2));

    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaY: -10_000,
      ctrlKey: true,
    })).toEqual({
      kind: "zoom",
      factor: 1.25,
      anchorCss: { x: 120, y: 80 },
    });
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaY: 10_000,
      ctrlKey: true,
    })).toEqual({
      kind: "zoom",
      factor: 0.8,
      anchorCss: { x: 120, y: 80 },
    });
  });

  it("clamps the zoom factor after unit normalization rather than capping by viewport height", () => {
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      deltaY: 1_000,
      ctrlKey: true,
      viewportHeight: 40,
    })).toEqual({
      kind: "zoom",
      factor: 0.8,
      anchorCss: { x: 120, y: 80 },
    });
  });

  it("returns null for empty, malformed, or unsupported wheel input", () => {
    expect(wheelNavigationIntent(BASE_WHEEL)).toBeNull();
    expect(wheelNavigationIntent({ ...BASE_WHEEL, deltaX: Number.NaN })).toBeNull();
    expect(wheelNavigationIntent({ ...BASE_WHEEL, deltaY: Number.POSITIVE_INFINITY })).toBeNull();
    expect(wheelNavigationIntent({ ...BASE_WHEEL, viewportWidth: 0, deltaY: 1 })).toBeNull();
    expect(wheelNavigationIntent({ ...BASE_WHEEL, viewportHeight: -1, deltaY: 1 })).toBeNull();
    expect(wheelNavigationIntent({ ...BASE_WHEEL, deltaMode: 3, deltaY: 1 })).toBeNull();
    expect(wheelNavigationIntent({
      ...BASE_WHEEL,
      anchorCss: { x: Number.NaN, y: 80 },
      deltaY: 1,
    })).toBeNull();
  });

  describe("isClickGesture", () => {
    it("treats a short, nearly stationary press as a click", () => {
      expect(isClickGesture({ travelledCss: 0, heldMs: 40, dragged: false })).toBe(true);
      expect(isClickGesture({
        travelledCss: DRAG_DEAD_ZONE_CSS,
        heldMs: CLICK_MAX_DURATION_MS,
        dragged: false,
      })).toBe(true);
    });

    it("is not a click once the press panned, travelled far, or was held", () => {
      expect(isClickGesture({ travelledCss: 0, heldMs: 10, dragged: true })).toBe(false);
      expect(isClickGesture({
        travelledCss: DRAG_DEAD_ZONE_CSS + 0.1,
        heldMs: 10,
        dragged: false,
      })).toBe(false);
      expect(isClickGesture({
        travelledCss: 0,
        heldMs: CLICK_MAX_DURATION_MS + 1,
        dragged: false,
      })).toBe(false);
    });

    it("rejects malformed samples", () => {
      expect(isClickGesture({ travelledCss: Number.NaN, heldMs: 10, dragged: false })).toBe(false);
      expect(isClickGesture({ travelledCss: 1, heldMs: Number.NaN, dragged: false })).toBe(false);
    });
  });
});
