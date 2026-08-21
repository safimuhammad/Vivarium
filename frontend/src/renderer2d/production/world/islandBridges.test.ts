import { describe, expect, it } from "vitest";

import { computeBridgeSpans, nearestCoastPoints, spansCrossingForeignLand } from "./islandBridges";
import {
  buildIslandMask,
  islandCoastPoints,
  pointInIslandMask,
  type IslandMask,
  type IslandPoint,
} from "./islandMask";
import {
  computeRegionSheet,
  packRegionSheet,
  type RegionAdjacency,
  type RegionExtent,
  type SheetRect,
} from "./regionSheetLayout";

describe("nearestCoastPoints", () => {
  it("picks the true minimum-distance pair between two coastlines", () => {
    const left: readonly IslandPoint[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }];
    const right: readonly IslandPoint[] = [{ x: 40, y: 0 }, { x: 12, y: 1 }, { x: 30, y: 20 }];
    const nearest = nearestCoastPoints(left, right);
    expect(nearest.a).toEqual({ x: 10, y: 0 });
    expect(nearest.b).toEqual({ x: 12, y: 1 });
    expect(nearest.lengthPx).toBeCloseTo(Math.hypot(2, 1), 10);
  });

  it("is symmetric in distance regardless of argument order", () => {
    const left: readonly IslandPoint[] = [{ x: 0, y: 0 }, { x: 3, y: 4 }];
    const right: readonly IslandPoint[] = [{ x: 20, y: 20 }, { x: 9, y: 12 }];
    expect(nearestCoastPoints(left, right).lengthPx)
      .toBeCloseTo(nearestCoastPoints(right, left).lengthPx, 10);
  });

  it("throws for an empty coastline on either side", () => {
    expect(() => nearestCoastPoints([], [{ x: 0, y: 0 }])).toThrow(RangeError);
    expect(() => nearestCoastPoints([{ x: 0, y: 0 }], [])).toThrow(RangeError);
  });
});

describe("computeBridgeSpans", () => {
  const coasts: Readonly<Record<string, readonly IslandPoint[]>> = {
    a: [{ x: 0, y: 0 }, { x: 20, y: 0 }],
    b: [{ x: 100, y: 0 }, { x: 120, y: 0 }],
    c: [{ x: 0, y: 400 }, { x: 20, y: 400 }],
  };
  const coastFor = (id: string): readonly IslandPoint[] | null => coasts[id] ?? null;

  it("builds one span per adjacency edge, anchored at each island's own nearest coast points", () => {
    const spans = computeBridgeSpans(coastFor, [["a", "b"]]);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.a).toEqual({ x: 20, y: 0 });
    expect(spans[0]?.b).toEqual({ x: 100, y: 0 });
    expect(spans[0]?.lengthPx).toBeCloseTo(80, 10);
  });

  it("dedupes symmetric pairs (a,b) and (b,a) into a single span", () => {
    expect(computeBridgeSpans(coastFor, [["a", "b"], ["b", "a"]])).toHaveLength(1);
  });

  it("skips self-pairs and edges naming an unknown region", () => {
    expect(computeBridgeSpans(coastFor, [["a", "a"], ["a", "atlantis"]])).toHaveLength(0);
  });

  it("promotes the single longest crossing to a stone causeway", () => {
    const spans = computeBridgeSpans(coastFor, [["a", "b"], ["a", "c"]]);
    const byPair = new Map(spans.map((span) => [`${span.regionA}|${span.regionB}`, span]));
    expect(byPair.get("a|b")?.kind).toBe("plank");
    expect(byPair.get("a|c")?.kind).toBe("causeway");
  });

  it("is order-independent: shuffled/duplicated adjacency yields the identical span set", () => {
    const forward = computeBridgeSpans(coastFor, [["a", "b"], ["a", "c"]]);
    const shuffled = computeBridgeSpans(coastFor, [["c", "a"], ["b", "a"], ["a", "b"]]);
    expect(shuffled).toEqual(forward);
  });

  it("skips an edge whose region has no coastline yet, without throwing", () => {
    expect(computeBridgeSpans((id) => (id === "a" ? coasts["a"] as readonly IslandPoint[] : null), [["a", "b"]]))
      .toHaveLength(0);
  });

  it("returns no spans for empty adjacency", () => {
    expect(computeBridgeSpans(coastFor, [])).toHaveLength(0);
  });
});

describe("integration: the real production archipelago", () => {
  const EXTENTS: readonly RegionExtent[] = [
    { id: "nirvana", widthPx: 96 * 32, heightPx: 96 * 32 },
    { id: "nirvana_east", widthPx: 48 * 32, heightPx: 48 * 32 },
    { id: "nirvana_west", widthPx: 48 * 32, heightPx: 48 * 32 },
    { id: "warm_springs", widthPx: 64 * 32, heightPx: 64 * 32 },
  ];
  const KITS: Readonly<Record<string, string>> = {
    nirvana: "worn-heartland",
    nirvana_east: "dry-scrub",
    nirvana_west: "ash-waste",
    warm_springs: "spring-terraces",
  };
  /** The real `config/world.yaml` adjacency: K4 minus the east<->west edge. */
  const ADJACENCY: RegionAdjacency = [
    ["nirvana", "warm_springs"],
    ["nirvana", "nirvana_east"],
    ["nirvana", "nirvana_west"],
    ["warm_springs", "nirvana_east"],
    ["warm_springs", "nirvana_west"],
  ];
  /** Masks are built at quarter extent (fast) and every plot-local coordinate scaled back up. */
  const SCALE = 4;
  const masks = new Map<string, IslandMask>(EXTENTS.map((extent) => [extent.id, buildIslandMask({
    regionId: extent.id,
    kit: KITS[extent.id] ?? "neutral-temperate",
    widthPx: extent.widthPx / SCALE,
    heightPx: extent.heightPx / SCALE,
    capeAngles: [],
    fill: 0.86,
  })]));

  const base = computeRegionSheet(EXTENTS, ADJACENCY);
  const sheet = packRegionSheet(base, ADJACENCY, (id) => {
    const mask = masks.get(id);
    return mask === undefined
      ? null
      : islandCoastPoints(mask, 4).map((point) => ({ x: point.x * SCALE, y: point.y * SCALE }));
  });
  const coastFor = (id: string): readonly IslandPoint[] | null => {
    const mask = masks.get(id);
    const rect = sheet.rects[id];
    if (mask === undefined || rect === undefined) return null;
    return islandCoastPoints(mask, 2)
      .map((point) => ({ x: rect.x + point.x * SCALE, y: rect.y + point.y * SCALE }));
  };
  const landAt = (regionId: string, point: IslandPoint): boolean => {
    const mask = masks.get(regionId);
    const rect = sheet.rects[regionId];
    if (mask === undefined || rect === undefined) return false;
    return pointInIslandMask(mask, (point.x - rect.x) / SCALE, (point.y - rect.y) / SCALE);
  };
  const spans = computeBridgeSpans(coastFor, ADJACENCY);

  it("draws exactly the 5 real crossings, with the documented non-adjacent pair absent", () => {
    expect(spans).toHaveLength(5);
    const pairs = spans.map((span) => `${span.regionA}|${span.regionB}`);
    expect(pairs).not.toContain("nirvana_east|nirvana_west");
  });

  it("NO span passes over a third island's land -- the ring embedding's own invariant", () => {
    // Under the single-ring adjacency-cycle embedding every island sits on the ring and the
    // interior is empty, so this holds by construction. The check exists so that a future layout
    // change cannot silently reintroduce the hub-and-satellite hazard (a satellite-to-satellite
    // chord passing straight through the hub island).
    const offenders = spansCrossingForeignLand(spans, EXTENTS.map((extent) => extent.id), landAt);
    expect(offenders.map((span) => `${span.regionA}|${span.regionB}`)).toEqual([]);
  });

  it("no two crossings cross each other", () => {
    const crosses = (
      p1: IslandPoint, p2: IslandPoint, p3: IslandPoint, p4: IslandPoint,
    ): boolean => {
      const orient = (a: IslandPoint, b: IslandPoint, c: IslandPoint): number =>
        Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
      const d1 = orient(p3, p4, p1);
      const d2 = orient(p3, p4, p2);
      const d3 = orient(p1, p2, p3);
      const d4 = orient(p1, p2, p4);
      return d1 !== d2 && d3 !== d4 && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
    };
    for (let i = 0; i < spans.length; i += 1) {
      for (let j = i + 1; j < spans.length; j += 1) {
        const left = spans[i]!;
        const right = spans[j]!;
        const sharesEnd = left.regionA === right.regionA || left.regionA === right.regionB
          || left.regionB === right.regionA || left.regionB === right.regionB;
        if (sharesEnd) continue;
        expect(crosses(left.a, left.b, right.a, right.b)).toBe(false);
      }
    }
  });

  it("keeps every crossing short relative to the sheet (real nearest coasts, not centre lines)", () => {
    const diagonal = Math.hypot(sheet.bounds.width, sheet.bounds.height);
    for (const span of spans) expect(span.lengthPx).toBeLessThan(diagonal * 0.4);
  });

  it("anchors every crossing on the two islands' own coastlines", () => {
    for (const span of spans) {
      for (const [regionId, point] of [[span.regionA, span.a], [span.regionB, span.b]] as const) {
        const rect = sheet.rects[regionId] as SheetRect;
        expect(point.x).toBeGreaterThanOrEqual(rect.x);
        expect(point.x).toBeLessThanOrEqual(rect.x + rect.width);
        expect(landAt(regionId, point)).toBe(true);
      }
    }
  });

  it("reports an offender when a span IS run through a third island (the check really checks)", () => {
    const nirvana = sheet.rects["nirvana"] as SheetRect;
    const through = {
      regionA: "nirvana_east",
      regionB: "nirvana_west",
      a: { x: nirvana.x - 400, y: nirvana.y + nirvana.height / 2 },
      b: { x: nirvana.x + nirvana.width + 400, y: nirvana.y + nirvana.height / 2 },
      lengthPx: nirvana.width + 800,
      kind: "plank" as const,
    };
    expect(spansCrossingForeignLand([through], EXTENTS.map((extent) => extent.id), landAt))
      .toHaveLength(1);
  });
});
