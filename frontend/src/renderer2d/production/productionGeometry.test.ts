import { describe, expect, it } from "vitest";

import { BEING_CHIBI_GEOMETRY } from "./actors/beingChibiAtlas";
import {
  HOME_FOOTPRINT_EXCLUSION_MARGIN_PX,
  IDLE_HUMAN_VISUAL_ENVELOPE,
  SHELTER_DOOR_CLEARANCE,
  SHELTER_RENDER_FOOTPRINT,
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
  homeFootprintExclusionRects,
  productionRectsOverlap,
  subtractRect,
} from "./productionGeometry";

describe("productionGeometry", () => {
  it("publishes the chibi sprite's full-frame feet-relative envelope (22x48, feet 11,46)", () => {
    // `SpriteSheetHumanActor` (Task 5) blits one whole 22x48 `core-being-chibi`
    // frame per draw, feet-anchored at (11,46) — unlike the retired
    // `LayeredHumanActor`'s 48x64/feet(24,61) layer composite, there is no
    // separate "with held forms" overlay that extends past the frame (the
    // chibi atlas has no held-item frames), so idle and standing envelopes
    // are identical: the frame's own bounds relative to its feet anchor.
    expect(BEING_CHIBI_GEOMETRY.frameWidth).toBe(22);
    expect(BEING_CHIBI_GEOMETRY.frameHeight).toBe(48);
    expect(BEING_CHIBI_GEOMETRY.feet).toEqual({ x: 11, y: 46 });

    const expected = { left: -11, top: -46, right: 11, bottom: 2, width: 22, height: 48 };
    expect(IDLE_HUMAN_VISUAL_ENVELOPE).toEqual(expected);
    expect(STANDING_HUMAN_VISUAL_ENVELOPE).toEqual(expected);
  });

  it("projects the half-open measured envelope from the actor's feet", () => {
    expect(feetAnchoredVisualRect({ x: 400, y: 300 })).toEqual({
      x: 389,
      y: 254,
      width: 22,
      height: 48,
    });
  });
});

describe("subtractRect", () => {
  it("covers the outer rect exactly minus a fully-contained hole, via up to 4 bands", () => {
    const outer = { x: 0, y: 0, width: 128, height: 128 };
    const hole = { x: 49, y: 57, width: 30, height: 48 };
    const bands = subtractRect(outer, hole);

    // Every band is inside the outer rect and clear of the hole.
    for (const band of bands) {
      expect(band.x).toBeGreaterThanOrEqual(outer.x);
      expect(band.y).toBeGreaterThanOrEqual(outer.y);
      expect(band.x + band.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(band.y + band.height).toBeLessThanOrEqual(outer.y + outer.height);
      expect(productionRectsOverlap(band, hole)).toBe(false);
    }

    // The bands' total area plus the hole's area reconstructs the outer rect's area
    // (true only when the hole is fully interior and bands are non-overlapping, which
    // this door-clearance-shaped case satisfies).
    const bandArea = bands.reduce((sum, band) => sum + band.width * band.height, 0);
    expect(bandArea + hole.width * hole.height).toBe(outer.width * outer.height);

    // No two bands overlap each other.
    for (let i = 0; i < bands.length; i += 1) {
      for (let j = i + 1; j < bands.length; j += 1) {
        expect(productionRectsOverlap(bands[i]!, bands[j]!)).toBe(false);
      }
    }

    // A point deep inside the hole (the door threshold) is not covered by any band.
    const insideHole = { x: 60, y: 80, width: 1, height: 1 };
    expect(bands.some((band) => productionRectsOverlap(band, insideHole))).toBe(false);

    // A point in the wall area away from the door IS covered by some band.
    const insideWall = { x: 10, y: 10, width: 1, height: 1 };
    expect(bands.some((band) => productionRectsOverlap(band, insideWall))).toBe(true);
  });

  it("returns the outer rect unchanged when the hole has no area", () => {
    const outer = { x: 5, y: 5, width: 20, height: 20 };
    const bands = subtractRect(outer, { x: 10, y: 10, width: 0, height: 0 });
    expect(bands).toEqual([outer]);
  });
});

describe("homeFootprintExclusionRects", () => {
  it("excludes the home's rendered footprint (expanded by the margin) except its door threshold", () => {
    const plot = { x: 200, y: 300 };
    const rects = homeFootprintExclusionRects(plot);

    // The door threshold itself, and a point just inside it, are NOT excluded --
    // choreography routes a being to stand exactly there for every home-interaction beat.
    const doorCenter = {
      x: plot.x + SHELTER_DOOR_CLEARANCE.x + SHELTER_DOOR_CLEARANCE.width / 2,
      y: plot.y + SHELTER_DOOR_CLEARANCE.y + SHELTER_DOOR_CLEARANCE.height / 2,
    };
    const doorPointRect = { ...doorCenter, width: 1, height: 1 };
    expect(rects.some((rect) => productionRectsOverlap(rect, doorPointRect))).toBe(false);

    // A point on the building's roof/wall, away from the door, IS excluded.
    const roofPointRect = { x: plot.x + 10, y: plot.y + 10, width: 1, height: 1 };
    expect(rects.some((rect) => productionRectsOverlap(rect, roofPointRect))).toBe(true);

    // The margin extends exclusion beyond the raw 128x128 render rect: a point just
    // outside the raw footprint, but within the margin, is still excluded.
    const justBeyondFootprint = {
      x: plot.x + SHELTER_RENDER_FOOTPRINT.width + Math.floor(HOME_FOOTPRINT_EXCLUSION_MARGIN_PX / 2),
      y: plot.y + 40,
      width: 1,
      height: 1,
    };
    expect(rects.some((rect) => productionRectsOverlap(rect, justBeyondFootprint))).toBe(true);

    // Far outside both the footprint and its margin is clear.
    const farAway = { x: plot.x + 400, y: plot.y + 400, width: 1, height: 1 };
    expect(rects.some((rect) => productionRectsOverlap(rect, farAway))).toBe(false);
  });

  it("is deterministic and margin-configurable", () => {
    const plot = { x: 0, y: 0 };
    const wide = homeFootprintExclusionRects(plot, 20);
    const narrow = homeFootprintExclusionRects(plot, 2);
    const probe = { x: -10, y: 40, width: 1, height: 1 };
    expect(wide.some((rect) => productionRectsOverlap(rect, probe))).toBe(true);
    expect(narrow.some((rect) => productionRectsOverlap(rect, probe))).toBe(false);
    expect(homeFootprintExclusionRects(plot, 20)).toEqual(wide);
  });
});
