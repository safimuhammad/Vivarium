import { describe, expect, it } from "vitest";

import {
  nearestPeriodicCoordinate,
  wrapCoordinate,
} from "./RegionPresentationTopology";

describe("wrapCoordinate", () => {
  it("uses positive modulo for negative values and values multiple extents away", () => {
    expect(wrapCoordinate(-1, 0, 10)).toBe(9);
    expect(wrapCoordinate(-31, 0, 10)).toBe(9);
    expect(wrapCoordinate(31, 0, 10)).toBe(1);
  });

  it("normalizes into a nonzero-origin interval and maps the exact upper edge to its origin", () => {
    expect(wrapCoordinate(31, 5, 10)).toBe(11);
    expect(wrapCoordinate(15, 5, 10)).toBe(5);
    expect(wrapCoordinate(5, 5, 10)).toBe(5);
  });

  it.each([
    [Number.NaN, 0, 10],
    [0, Number.POSITIVE_INFINITY, 10],
    [0, 0, Number.NaN],
    [0, 0, Number.POSITIVE_INFINITY],
    [0, 0, 0],
    [0, 0, -1],
  ])("rejects malformed periodic intervals (%s, %s, %s)", (value, origin, extent) => {
    expect(() => wrapCoordinate(value, origin, extent)).toThrow();
  });
});

describe("nearestPeriodicCoordinate", () => {
  it("chooses the shortest signed displacement across either seam", () => {
    expect(nearestPeriodicCoordinate(2, 98, 0, 100)).toBe(102);
    expect(nearestPeriodicCoordinate(98, 2, 0, 100)).toBe(-2);
  });

  it("breaks exact half-circumference ties toward the positive periodic copy", () => {
    expect(nearestPeriodicCoordinate(50, 0, 0, 100)).toBe(50);
    expect(nearestPeriodicCoordinate(0, 50, 0, 100)).toBe(100);
  });

  it("accepts values multiple extents away and respects nonzero origins", () => {
    expect(nearestPeriodicCoordinate(205, 10, 0, 100)).toBe(5);
    expect(nearestPeriodicCoordinate(-195, 108, 5, 100)).toBe(105);
  });

  it.each([
    [Number.NaN, 0, 0, 10],
    [0, Number.NEGATIVE_INFINITY, 0, 10],
    [0, 0, Number.POSITIVE_INFINITY, 10],
    [0, 0, 0, 0],
    [0, 0, 0, -10],
  ])("rejects malformed periodic inputs (%s, %s, %s, %s)", (
    value,
    reference,
    origin,
    extent,
  ) => {
    expect(() => nearestPeriodicCoordinate(value, reference, origin, extent)).toThrow();
  });
});
