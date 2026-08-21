import { describe, expect, it } from "vitest";

import { BEING_PALETTE_VARIANTS, type BeingPaletteVariant } from "../actors/beingPalette";
import {
  BEING_MARK_COLOR_BY_VARIANT,
  MARK_RADIUS_PX,
  beingMarkColor,
  markScatterPoint,
} from "./regionMarkPlacement";

const RECT = { width: 800, height: 600 };

describe("markScatterPoint", () => {
  it("is deterministic: the same id and rect always produce the same point", () => {
    const first = markScatterPoint("wanderer_001", RECT);
    const second = markScatterPoint("wanderer_001", RECT);
    expect(second).toEqual(first);
  });

  it("differs between distinct ids (no universal collision)", () => {
    const a = markScatterPoint("wanderer_001", RECT);
    const b = markScatterPoint("wanderer_002", RECT);
    expect(a).not.toEqual(b);
  });

  it("stays strictly inside the rect, respecting the mark radius margin", () => {
    for (const id of ["a", "b", "c", "wanderer_017", "z-agent-99"]) {
      const point = markScatterPoint(id, RECT);
      expect(point.x).toBeGreaterThanOrEqual(MARK_RADIUS_PX);
      expect(point.x).toBeLessThanOrEqual(RECT.width - MARK_RADIUS_PX);
      expect(point.y).toBeGreaterThanOrEqual(MARK_RADIUS_PX);
      expect(point.y).toBeLessThanOrEqual(RECT.height - MARK_RADIUS_PX);
    }
  });

  it("degrades to the rect centre when the rect is too small to hold the margin on an axis", () => {
    const tiny = { width: 4, height: 4 };
    const point = markScatterPoint("wanderer_001", tiny);
    expect(point).toEqual({ x: 2, y: 2 });
  });

  it("throws for a non-finite or non-positive rect dimension", () => {
    expect(() => markScatterPoint("a", { width: 0, height: 10 })).toThrow(RangeError);
    expect(() => markScatterPoint("a", { width: 10, height: Number.NaN })).toThrow(RangeError);
  });

  it("produces a scatter, not a single clustered point, across many ids", () => {
    const points = Array.from({ length: 64 }, (_unused, index) => markScatterPoint(`agent-${index}`, RECT));
    const uniqueX = new Set(points.map((point) => point.x));
    const uniqueY = new Set(points.map((point) => point.y));
    expect(uniqueX.size).toBeGreaterThan(1);
    expect(uniqueY.size).toBeGreaterThan(1);
  });
});

describe("beingMarkColor", () => {
  it("returns a distinct, valid CSS hex color for every named palette variant", () => {
    const colors = BEING_PALETTE_VARIANTS.map((variant) => beingMarkColor(variant));
    for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(new Set(colors).size).toBe(BEING_PALETTE_VARIANTS.length);
  });

  it("BEING_MARK_COLOR_BY_VARIANT covers every BeingPaletteVariant with the same values beingMarkColor returns", () => {
    for (const variant of BEING_PALETTE_VARIANTS) {
      expect(BEING_MARK_COLOR_BY_VARIANT[variant]).toBe(beingMarkColor(variant));
    }
    expect(Object.keys(BEING_MARK_COLOR_BY_VARIANT).sort()).toEqual([...BEING_PALETTE_VARIANTS].sort());
  });

  it("rejects a variant outside the known set", () => {
    expect(() => beingMarkColor("not-a-variant" as BeingPaletteVariant)).toThrow();
  });
});
