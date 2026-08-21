import { describe, expect, it } from "vitest";

import {
  ASCENT_DURATION_MS,
  ascentTarget,
  coverZoomFor,
  createZoomOutDetentState,
  DESCENT_DURATION_MS,
  DETENT_ARMED_WINDOW_MS,
  DETENT_GESTURE_GAP_MS,
  descentTarget,
  pickRegionAtPoint,
  resolveZoomOutDetent,
  SHORE_TOLERANCE_CELLS,
} from "./worldNavigation";

const RECTS = {
  east: { x: 0, y: 0, width: 400, height: 400 },
  west: { x: 500, y: 0, width: 400, height: 400 },
} as const;

describe("pickRegionAtPoint", () => {
  it("routes through the plot rect when no coastline probe is supplied", () => {
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 10, y: 10 } })).toBe("east");
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 890, y: 399 } })).toBe("west");
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 450, y: 200 } })).toBeNull();
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: -1, y: 200 } })).toBeNull();
  });

  it("rejects open sea inside a plot's bounding box", () => {
    // Land only within 100px of the plot centre; the probe reports cells offshore beyond that.
    const landDistance = (regionId: string, localX: number, localY: number): number => {
      const rect = RECTS[regionId as keyof typeof RECTS];
      const radius = Math.hypot(localX - rect.width / 2, localY - rect.height / 2);
      return (radius - 100) / 8;
    };
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 200, y: 200 }, landDistance })).toBe("east");
    // 148px from the centre is 6 cells offshore -> still within the shore tolerance.
    expect(SHORE_TOLERANCE_CELLS).toBe(6);
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 348, y: 200 }, landDistance })).toBe("east");
    // 20px inside the plot's corner is far out to sea: the rect contains it, the island does not.
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: 20, y: 20 }, landDistance })).toBeNull();
  });

  it("prefers the island a point is plainly over when two plots overlap", () => {
    const overlapping = {
      east: { x: 0, y: 0, width: 400, height: 400 },
      west: { x: 300, y: 0, width: 400, height: 400 },
    };
    const landDistance = (regionId: string, localX: number, localY: number): number => {
      const rect = overlapping[regionId as keyof typeof overlapping];
      return (Math.hypot(localX - rect.width / 2, localY - rect.height / 2) - 150) / 8;
    };
    // x=340 sits in both bounding boxes; it is deep inside east's land and off west's shore.
    expect(pickRegionAtPoint({ rects: overlapping, point: { x: 340, y: 200 }, landDistance })).toBe("east");
    // x=360 has crossed into west's land while still inside east's rect.
    expect(pickRegionAtPoint({ rects: overlapping, point: { x: 660, y: 200 }, landDistance })).toBe("west");
  });

  it("falls back to nearest plot centre for a region with no silhouette", () => {
    const overlapping = {
      east: { x: 0, y: 0, width: 400, height: 400 },
      west: { x: 300, y: 0, width: 400, height: 400 },
    };
    const picked = pickRegionAtPoint({
      rects: overlapping,
      point: { x: 320, y: 200 },
      landDistance: () => null,
    });
    expect(picked).toBe("east");
  });

  it("ignores a non-finite point and non-finite rects", () => {
    expect(pickRegionAtPoint({ rects: RECTS, point: { x: Number.NaN, y: 0 } })).toBeNull();
    expect(pickRegionAtPoint({
      rects: { broken: { x: Number.NaN, y: 0, width: 10, height: 10 } },
      point: { x: 0, y: 0 },
    })).toBeNull();
  });
});

describe("resolveZoomOutDetent", () => {
  it("pins and offers the exit on the first gesture without leaving", () => {
    const first = resolveZoomOutDetent(createZoomOutDetentState(), {
      pressingFloor: true,
      nowMs: 1_000,
    });
    expect(first.leaveRegion).toBe(false);
    expect(first.showHint).toBe(true);
  });

  it("never leaves during one continuous gesture, however many events it fires", () => {
    let state = createZoomOutDetentState();
    let leaves = 0;
    for (let index = 0; index < 40; index += 1) {
      const result = resolveZoomOutDetent(state, {
        pressingFloor: true,
        nowMs: 1_000 + index * (DETENT_GESTURE_GAP_MS - 60),
      });
      state = result.next;
      if (result.leaveRegion) leaves += 1;
    }
    expect(leaves).toBe(0);
  });

  it("leaves on a second, separate gesture inside the armed window", () => {
    const first = resolveZoomOutDetent(createZoomOutDetentState(), {
      pressingFloor: true,
      nowMs: 1_000,
    });
    const released = resolveZoomOutDetent(first.next, { pressingFloor: false, nowMs: 1_200 });
    expect(released.leaveRegion).toBe(false);
    expect(released.showHint).toBe(true);
    const second = resolveZoomOutDetent(released.next, { pressingFloor: true, nowMs: 1_400 });
    expect(second.leaveRegion).toBe(true);
    expect(second.next).toEqual(createZoomOutDetentState());
  });

  it("re-pins instead of leaving once the armed window has expired", () => {
    const first = resolveZoomOutDetent(createZoomOutDetentState(), {
      pressingFloor: true,
      nowMs: 1_000,
    });
    const stale = resolveZoomOutDetent(first.next, {
      pressingFloor: true,
      nowMs: 1_000 + DETENT_ARMED_WINDOW_MS + 1,
    });
    expect(stale.leaveRegion).toBe(false);
    expect(stale.showHint).toBe(true);
  });

  it("drops the hint once the armed window expires with no press", () => {
    const first = resolveZoomOutDetent(createZoomOutDetentState(), {
      pressingFloor: true,
      nowMs: 1_000,
    });
    const later = resolveZoomOutDetent(first.next, {
      pressingFloor: false,
      nowMs: 1_000 + DETENT_ARMED_WINDOW_MS + 1,
    });
    expect(later.showHint).toBe(false);
    expect(later.next).toEqual(createZoomOutDetentState());
  });
});

describe("descentTarget / ascentTarget / coverZoomFor", () => {
  it("descends to the region's own centre at native scale when cover is below it", () => {
    const flight = descentTarget({ x: 100, y: 200, width: 3_072, height: 3_072 }, 1_440, 900);
    expect(flight).toEqual({
      center: { x: 1_636, y: 1_736 },
      zoom: 1,
      durationMs: DESCENT_DURATION_MS,
    });
  });

  it("never descends below the cover zoom for a region smaller than the canvas", () => {
    const flight = descentTarget({ x: 0, y: 0, width: 500, height: 400 }, 1_440, 900);
    expect(flight?.zoom).toBeCloseTo(Math.max(1_440 / 500, 900 / 400), 10);
  });

  it("ascends to the sheet's contain fit, centred on the sheet", () => {
    const flight = ascentTarget({ x: 0, y: 0, width: 8_000, height: 4_000 }, 1_440, 900);
    expect(flight).toEqual({
      center: { x: 4_000, y: 2_000 },
      zoom: 1_440 / 8_000,
      durationMs: ASCENT_DURATION_MS,
    });
  });

  it("returns null rather than a broken flight on degenerate geometry", () => {
    expect(descentTarget({ x: 0, y: 0, width: 0, height: 10 }, 1_440, 900)).toBeNull();
    expect(ascentTarget({ x: 0, y: 0, width: 10, height: 10 }, 0, 900)).toBeNull();
    expect(coverZoomFor({ x: 0, y: 0, width: 10, height: 10 }, Number.NaN, 900)).toBeNull();
  });

  it("cover zoom is the axis MAXIMUM, the zoom at which nothing else can be on screen", () => {
    expect(coverZoomFor({ x: 0, y: 0, width: 1_000, height: 500 }, 1_000, 1_000)).toBe(2);
  });
});
