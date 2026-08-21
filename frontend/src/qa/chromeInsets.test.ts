import { describe, expect, it } from "vitest";

import { computeChromeInsets } from "./chromeInsets";

const VIEWPORT_HEIGHT = 900;
const GAP = 10;

describe("computeChromeInsets", () => {
  it("insets the top by the toggle's own edge when the guided tour overlay isn't rendered (off)", () => {
    const result = computeChromeInsets({
      toggleBottom: 56,
      overlayBottom: null,
      barTop: 820,
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result.topInsetPx).toBe(66); // 56 + 10
  });

  it("insets the top by the taller of toggle/overlay when the guided tour is active", () => {
    const result = computeChromeInsets({
      toggleBottom: 56,
      overlayBottom: 160, // multi-line caption, taller than the toggle
      barTop: 820,
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result.topInsetPx).toBe(170); // 160 + 10
  });

  it("still uses the toggle's edge when it happens to be taller than the overlay", () => {
    const result = computeChromeInsets({
      toggleBottom: 200,
      overlayBottom: 90,
      barTop: 820,
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result.topInsetPx).toBe(210); // 200 + 10
  });

  it("insets the bottom by the space between the validation bar's top edge and the viewport bottom", () => {
    const result = computeChromeInsets({
      toggleBottom: 56,
      overlayBottom: null,
      barTop: 820,
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    // (900 - 820) + 10 = 90
    expect(result.bottomInsetPx).toBe(90);
  });

  it("grows the bottom inset when the bar wraps taller (e.g. narrow viewport, more controls per row)", () => {
    const result = computeChromeInsets({
      toggleBottom: 56,
      overlayBottom: null,
      barTop: 540, // bar top starts much higher up because it wrapped to several rows
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result.bottomInsetPx).toBe(370); // (900 - 540) + 10
  });

  it("returns zero insets when no chrome elements are found (defensive)", () => {
    const result = computeChromeInsets({
      toggleBottom: 0,
      overlayBottom: null,
      barTop: null,
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result).toEqual({ topInsetPx: 0, bottomInsetPx: 0 });
  });

  it("never returns a negative bottom inset even if the bar's top somehow exceeds the viewport height", () => {
    const result = computeChromeInsets({
      toggleBottom: 56,
      overlayBottom: null,
      barTop: 950, // below the viewport — shouldn't happen, but must not go negative
      viewportHeight: VIEWPORT_HEIGHT,
      gapPx: GAP,
    });
    expect(result.bottomInsetPx).toBe(10); // max(0, 900-950) + 10 = 10
  });
});
