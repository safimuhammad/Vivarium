import { describe, expect, it } from "vitest";

import type { RegionAdjacency, RegionExtent, RegionSheet, SheetRect } from "./regionSheetLayout";
import { GUTTER_PX, computeRegionSheet, packRegionSheet, regionAtPoint } from "./regionSheetLayout";
import { buildIslandMask, islandCoastPoints, pointInIslandMask, type IslandPoint } from "./islandMask";

/**
 * Representative extents for the four production regions (`config/world.yaml`), expressed as
 * pixels the way `CanvasPresentationRenderer.describeStaticSceneTarget` derives them
 * (`recipe.grid.columns * TILE_SIZE`, `recipe.grid.rows * TILE_SIZE` with `TILE_SIZE = 32`).
 * Nirvana's three toroidal growth tiers are 96x96 -> 96x128 -> 144x128 tiles; the other three
 * regions do not (yet) grow and are given smaller placeholder extents standing in for their
 * generic biome kits.
 */
const NIRVANA_TIER_1: RegionExtent = { id: "nirvana", widthPx: 96 * 32, heightPx: 96 * 32 };
const NIRVANA_TIER_2: RegionExtent = { id: "nirvana", widthPx: 96 * 32, heightPx: 128 * 32 };
const NIRVANA_TIER_3: RegionExtent = { id: "nirvana", widthPx: 144 * 32, heightPx: 128 * 32 };
const NIRVANA_EAST: RegionExtent = { id: "nirvana_east", widthPx: 48 * 32, heightPx: 48 * 32 };
const NIRVANA_WEST: RegionExtent = { id: "nirvana_west", widthPx: 48 * 32, heightPx: 48 * 32 };
const WARM_SPRINGS: RegionExtent = { id: "warm_springs", widthPx: 64 * 32, heightPx: 64 * 32 };

const FOUR_REGIONS_TIER_1: readonly RegionExtent[] =
  [NIRVANA_TIER_1, NIRVANA_EAST, NIRVANA_WEST, WARM_SPRINGS];

/** The real `config/world.yaml` adjacency, flattened to pairs. `nirvana_east` and `nirvana_west`
 * are deliberately NOT connected -- there is no bridge between them. */
const REAL_ADJACENCY: RegionAdjacency = [
  ["nirvana", "warm_springs"],
  ["nirvana", "nirvana_east"],
  ["nirvana", "nirvana_west"],
  ["warm_springs", "nirvana_east"],
  ["warm_springs", "nirvana_west"],
];

const KITS: Readonly<Record<string, string>> = {
  nirvana: "worn-heartland",
  nirvana_east: "dry-scrub",
  nirvana_west: "ash-waste",
  warm_springs: "spring-terraces",
};

function rectsOverlap(a: SheetRect, b: SheetRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width
    && a.y < b.y + b.height && b.y < a.y + a.height;
}

function assertNoOverlaps(sheet: RegionSheet): void {
  const rects = Object.values(sheet.rects);
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      expect(rectsOverlap(rects[i] as SheetRect, rects[j] as SheetRect)).toBe(false);
    }
  }
}

/** Gap between two plots' ISLAND circles -- the clearance the ring solve actually guarantees (an
 * island fills ~0.86 of its plot's larger half-extent; see `ISLAND_RADIUS_FRACTION`). */
function islandCircleGap(a: SheetRect, b: SheetRect): number {
  const centerA = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  const centerB = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const radiusA = (Math.max(a.width, a.height) / 2) * 0.86;
  const radiusB = (Math.max(b.width, b.height) / 2) * 0.86;
  return Math.hypot(centerA.x - centerB.x, centerA.y - centerB.y) - radiusA - radiusB;
}

/** Real masks for the four production regions, at a coarse extent so the suite stays fast. */
function productionMasks(
  extents: readonly RegionExtent[],
  scale = 0.25,
): ReadonlyMap<string, ReturnType<typeof buildIslandMask>> {
  const masks = new Map<string, ReturnType<typeof buildIslandMask>>();
  for (const extent of extents) {
    masks.set(extent.id, buildIslandMask({
      regionId: extent.id,
      kit: KITS[extent.id] ?? "neutral-temperate",
      widthPx: extent.widthPx * scale,
      heightPx: extent.heightPx * scale,
      capeAngles: [],
      fill: 0.86,
    }));
  }
  return masks;
}

describe("computeRegionSheet -- the ring embedding", () => {
  it("places every region's own pixel extent into its plot rect (size preserved, never stretched)", () => {
    const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    for (const extent of FOUR_REGIONS_TIER_1) {
      const rect = sheet.rects[extent.id] as SheetRect;
      expect(rect.width).toBe(extent.widthPx);
      expect(rect.height).toBe(extent.heightPx);
    }
  });

  it("is deterministic: relative input order never changes the resulting layout", () => {
    const forward = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    const reversed = computeRegionSheet([...FOUR_REGIONS_TIER_1].reverse(), [...REAL_ADJACENCY].reverse());
    expect(reversed.rects).toEqual(forward.rects);
    expect(reversed.ringOrder).toEqual(forward.ringOrder);
  });

  it("is deterministic: calling it twice with the same input yields the same result", () => {
    expect(computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY))
      .toEqual(computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY));
  });

  it("walks the real adjacency graph into the diamond that puts the MISSING edge on the diagonal", () => {
    const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    expect(sheet.ringOrder).toEqual(["nirvana", "nirvana_east", "warm_springs", "nirvana_west"]);
    // nirvana_east and nirvana_west -- the one pair with no bridge -- sit opposite each other.
    const index = (id: string): number => sheet.ringOrder.indexOf(id);
    const half = sheet.ringOrder.length / 2;
    expect(Math.abs(index("nirvana_east") - index("nirvana_west"))).toBe(half);
  });

  it("puts every region ON the ring, leaving the centre empty -- so no chord can cross an island", () => {
    const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    const centerX = sheet.bounds.width / 2;
    const centerY = sheet.bounds.height / 2;
    const radii = Object.values(sheet.rects).map((rect) => Math.hypot(
      rect.x + rect.width / 2 - centerX,
      rect.y + rect.height / 2 - centerY,
    ));
    // nothing sits at the middle: the smallest ring radius is a real distance from the centre
    expect(Math.min(...radii)).toBeGreaterThan(0.2 * Math.min(sheet.bounds.width, sheet.bounds.height));
    // and no plot COVERS the centre
    for (const rect of Object.values(sheet.rects)) {
      const covers = centerX >= rect.x && centerX < rect.x + rect.width
        && centerY >= rect.y && centerY < rect.y + rect.height;
      expect(covers).toBe(false);
    }
  });

  it("reports the most-connected region as the hub, ties broken toward the ascending-first id", () => {
    expect(computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY).hubId).toBe("nirvana");
    const tied = computeRegionSheet(
      [{ id: "b", widthPx: 100, heightPx: 100 }, { id: "a", widthPx: 100, heightPx: 100 }],
      [["a", "b"]],
    );
    expect(tied.hubId).toBe("a");
  });

  it("produces non-overlapping plots for the four production regions", () => {
    assertNoOverlaps(computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY));
  });

  it("produces non-overlapping plots for irregular region counts (1, 2, 3, 5)", () => {
    const pool: RegionExtent[] = [
      { id: "a", widthPx: 3_072, heightPx: 3_072 },
      { id: "b", widthPx: 1_536, heightPx: 2_048 },
      { id: "c", widthPx: 2_048, heightPx: 1_024 },
      { id: "d", widthPx: 1_024, heightPx: 1_024 },
      { id: "e", widthPx: 4_096, heightPx: 2_048 },
    ];
    for (const count of [1, 2, 3, 5]) {
      assertNoOverlaps(computeRegionSheet(pool.slice(0, count)));
    }
  });

  it("spreads a two-region sheet horizontally (the camera's own pan tests depend on it)", () => {
    const sheet = computeRegionSheet([
      { id: "spring", widthPx: 3_072, heightPx: 3_072 },
      { id: "worn", widthPx: 3_072, heightPx: 3_072 },
    ]);
    const spring = sheet.rects["spring"] as SheetRect;
    const worn = sheet.rects["worn"] as SheetRect;
    expect(Math.abs(spring.x - worn.x)).toBeGreaterThan(Math.abs(spring.y - worn.y));
  });

  it("guarantees at least GUTTER_PX of sea between ring-adjacent regions' island circles", () => {
    const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    const order = sheet.ringOrder;
    for (let index = 0; index < order.length; index += 1) {
      const a = sheet.rects[order[index] as string] as SheetRect;
      const b = sheet.rects[order[(index + 1) % order.length] as string] as SheetRect;
      expect(islandCircleGap(a, b)).toBeGreaterThanOrEqual(GUTTER_PX - 1);
    }
  });

  it("derives bounds as the union of every plot plus a sea margin, anchored at the origin", () => {
    const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    expect(sheet.bounds.x).toBe(0);
    expect(sheet.bounds.y).toBe(0);
    let maxX = 0;
    let maxY = 0;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (const rect of Object.values(sheet.rects)) {
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
    }
    expect(minX).toBeGreaterThan(0);
    expect(minY).toBeGreaterThan(0);
    expect(sheet.bounds.width).toBeGreaterThanOrEqual(maxX);
    expect(sheet.bounds.height).toBeGreaterThanOrEqual(maxY);
  });

  it("rejects an empty region id", () => {
    expect(() => computeRegionSheet([{ id: "", widthPx: 10, heightPx: 10 }])).toThrow();
  });

  it("rejects duplicate region ids", () => {
    expect(() => computeRegionSheet([
      { id: "a", widthPx: 10, heightPx: 10 },
      { id: "a", widthPx: 20, heightPx: 20 },
    ])).toThrow();
  });

  it("rejects a non-positive or non-finite extent", () => {
    expect(() => computeRegionSheet([{ id: "a", widthPx: 0, heightPx: 10 }])).toThrow();
    expect(() => computeRegionSheet([{ id: "a", widthPx: 10, heightPx: Number.NaN }])).toThrow();
  });

  it("returns an empty sheet for an empty region list", () => {
    const sheet = computeRegionSheet([]);
    expect(sheet.rects).toEqual({});
    expect(sheet.hubId).toBeNull();
    expect(sheet.ringOrder).toEqual([]);
    expect(sheet.bounds).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it("ignores adjacency edges naming an unknown region, a self-pair, or a reversed duplicate", () => {
    const clean = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
    const noisy = computeRegionSheet(FOUR_REGIONS_TIER_1, [
      ...REAL_ADJACENCY,
      ["nirvana", "nirvana"],
      ["nirvana", "atlantis"],
      ["warm_springs", "nirvana"],
    ]);
    expect(noisy.rects).toEqual(clean.rects);
  });

  it("never touches (clones, mutates, or reads beyond id/widthPx/heightPx) its input objects", () => {
    const reads: string[] = [];
    const spy = new Proxy(NIRVANA_TIER_1, {
      get(target, property, receiver) {
        if (typeof property === "string") reads.push(property);
        return Reflect.get(target, property, receiver);
      },
      set() {
        throw new Error("computeRegionSheet must never mutate its input");
      },
    });
    computeRegionSheet([spy, NIRVANA_EAST], [["nirvana", "nirvana_east"]]);
    expect(new Set(reads)).toEqual(new Set(["id", "widthPx", "heightPx"]));
  });

  describe("growth stability", () => {
    it("keeps every region's identity and ring position when nirvana grows, reflowing only distances", () => {
      const tier1 = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
      for (const grown of [NIRVANA_TIER_2, NIRVANA_TIER_3]) {
        const sheet = computeRegionSheet(
          [grown, NIRVANA_EAST, NIRVANA_WEST, WARM_SPRINGS],
          REAL_ADJACENCY,
        );
        expect(sheet.ringOrder).toEqual(tier1.ringOrder);
        expect(sheet.hubId).toBe(tier1.hubId);
        expect(Object.keys(sheet.rects).sort()).toEqual(Object.keys(tier1.rects).sort());
        assertNoOverlaps(sheet);
        // the grown region really does swell in place
        expect((sheet.rects["nirvana"] as SheetRect).width).toBe(grown.widthPx);
        expect((sheet.rects["nirvana"] as SheetRect).height).toBe(grown.heightPx);
        // nobody else's own size changed
        expect((sheet.rects["warm_springs"] as SheetRect).width)
          .toBe((tier1.rects["warm_springs"] as SheetRect).width);
      }
    });
  });
});

describe("packRegionSheet -- the land-gap contraction", () => {
  const masks = productionMasks(FOUR_REGIONS_TIER_1);
  const coastFor = (id: string): readonly IslandPoint[] | null => {
    const mask = masks.get(id);
    if (mask === undefined) return null;
    // plot-local coast points, rescaled back to the FULL plot the sheet uses
    return islandCoastPoints(mask, 4).map((point) => ({ x: point.x * 4, y: point.y * 4 }));
  };
  const base = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
  const packed = packRegionSheet(base, REAL_ADJACENCY, coastFor);

  it("pulls the archipelago together so the crossings are short and purposeful", () => {
    const spread = (sheet: RegionSheet): number => Math.max(sheet.bounds.width, sheet.bounds.height);
    expect(spread(packed)).toBeLessThan(spread(base));
  });

  it("never lets two COASTLINES touch, even where two bounding plots may overlap", () => {
    // The contraction is bounded by real land, not by bounding boxes (see `packRegionSheet`).
    const ids = FOUR_REGIONS_TIER_1.map((extent) => extent.id);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i] as string;
        const b = ids[j] as string;
        const rectA = packed.rects[a] as SheetRect;
        const rectB = packed.rects[b] as SheetRect;
        const coastA = (coastFor(a) as readonly IslandPoint[])
          .map((point) => ({ x: rectA.x + point.x, y: rectA.y + point.y }));
        const coastB = (coastFor(b) as readonly IslandPoint[])
          .map((point) => ({ x: rectB.x + point.x, y: rectB.y + point.y }));
        let gap = Number.POSITIVE_INFINITY;
        for (const p of coastA) {
          for (const q of coastB) gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y));
        }
        expect(gap).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic", () => {
    expect(packRegionSheet(base, REAL_ADJACENCY, coastFor)).toEqual(packed);
  });

  it("keeps every region's own extent and identity", () => {
    for (const extent of FOUR_REGIONS_TIER_1) {
      const rect = packed.rects[extent.id] as SheetRect;
      expect(rect.width).toBe(extent.widthPx);
      expect(rect.height).toBe(extent.heightPx);
    }
    expect(packed.ringOrder).toEqual(base.ringOrder);
  });

  it("reflows sanely when Nirvana GROWS: same ring, same neighbours, coasts still clear", () => {
    // Nirvana's real toroidal growth tiers (96x96 -> 96x128 -> 144x128 tiles, and the authored
    // 192x160 the production growth policy reaches at ~300 population/built pressure). The map
    // must swell in place: no island swaps position or identity, the ring widens, the crossings
    // re-anchor, and no two coastlines ever touch.
    const GROWN: readonly RegionExtent[] = [
      { id: "nirvana", widthPx: 192 * 32, heightPx: 160 * 32 },
      NIRVANA_EAST,
      NIRVANA_WEST,
      WARM_SPRINGS,
    ];
    const grownMasks = productionMasks(GROWN);
    const grownCoast = (id: string): readonly IslandPoint[] | null => {
      const mask = grownMasks.get(id);
      if (mask === undefined) return null;
      return islandCoastPoints(mask, 4).map((point) => ({ x: point.x * 4, y: point.y * 4 }));
    };
    const grownBase = computeRegionSheet(GROWN, REAL_ADJACENCY);
    const grownPacked = packRegionSheet(grownBase, REAL_ADJACENCY, grownCoast);

    expect(grownPacked.ringOrder).toEqual(packed.ringOrder);
    expect(grownPacked.hubId).toBe(packed.hubId);
    // Nirvana really did swell, and nobody else's extent moved.
    expect((grownPacked.rects["nirvana"] as SheetRect).width).toBe(192 * 32);
    expect((grownPacked.rects["warm_springs"] as SheetRect).width)
      .toBe((packed.rects["warm_springs"] as SheetRect).width);
    // The archipelago got bigger, not rearranged: the cyclic order of the islands around the
    // archipelago's own centre is identical, so nothing crossed over anything else.
    const cyclicOrder = (sheet: RegionSheet): readonly string[] => {
      const centreX = sheet.bounds.width / 2;
      const centreY = sheet.bounds.height / 2;
      return Object.entries(sheet.rects)
        .map(([id, rect]) => ({
          id,
          angle: Math.atan2(rect.y + rect.height / 2 - centreY, rect.x + rect.width / 2 - centreX),
        }))
        .sort((left, right) => left.angle - right.angle)
        .map(({ id }) => id);
    };
    const rotate = (order: readonly string[], first: string): readonly string[] => {
      const at = order.indexOf(first);
      return [...order.slice(at), ...order.slice(0, at)];
    };
    expect(rotate(cyclicOrder(grownPacked), "nirvana"))
      .toEqual(rotate(cyclicOrder(packed), "nirvana"));
    // and no two coastlines touch at the grown extent either
    const ids = GROWN.map((extent) => extent.id);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = ids[i] as string;
        const b = ids[j] as string;
        const rectA = grownPacked.rects[a] as SheetRect;
        const rectB = grownPacked.rects[b] as SheetRect;
        const coastA = (grownCoast(a) as readonly IslandPoint[])
          .map((point) => ({ x: rectA.x + point.x, y: rectA.y + point.y }));
        const coastB = (grownCoast(b) as readonly IslandPoint[])
          .map((point) => ({ x: rectB.x + point.x, y: rectB.y + point.y }));
        let gap = Number.POSITIVE_INFINITY;
        for (const p of coastA) {
          for (const q of coastB) gap = Math.min(gap, Math.hypot(p.x - q.x, p.y - q.y));
        }
        expect(gap, `${a}/${b} coastlines collided at the grown extent`).toBeGreaterThan(0);
      }
    }
  });

  it("returns the sheet unchanged when fewer than two regions have coastlines", () => {
    expect(packRegionSheet(base, REAL_ADJACENCY, () => null)).toBe(base);
    expect(packRegionSheet(computeRegionSheet([NIRVANA_TIER_1]), [], coastFor))
      .toEqual(computeRegionSheet([NIRVANA_TIER_1]));
  });
});

describe("regionAtPoint", () => {
  const sheet = computeRegionSheet(FOUR_REGIONS_TIER_1, REAL_ADJACENCY);
  const nirvana = sheet.rects["nirvana"] as SheetRect;

  it("resolves a point over a region's plot to that region", () => {
    expect(regionAtPoint(sheet, {
      x: nirvana.x + nirvana.width / 2,
      y: nirvana.y + nirvana.height / 2,
    })).toBe("nirvana");
  });

  it("routes hit-testing through the RECT, not the island silhouette", () => {
    // The silhouette is a PORTRAIT of the region at map zoom, not its walkable footprint. A camera
    // centre drifting into a bay (or a plot corner) must still resolve to the region it is plainly
    // over -- see `docs/frontend/ATLAS_VIEW.md` §9.
    const corner = { x: nirvana.x + 2, y: nirvana.y + 2 };
    const mask = buildIslandMask({
      regionId: "nirvana",
      kit: "worn-heartland",
      widthPx: nirvana.width,
      heightPx: nirvana.height,
      capeAngles: [],
      fill: 0.86,
    });
    expect(pointInIslandMask(mask, corner.x - nirvana.x, corner.y - nirvana.y)).toBe(false);
    expect(regionAtPoint(sheet, corner)).toBe("nirvana");
  });

  it("returns null for a point in the open sea between plots", () => {
    expect(regionAtPoint(sheet, { x: sheet.bounds.width / 2, y: sheet.bounds.height / 2 })).toBeNull();
  });

  it("returns null for a point outside the sheet bounds entirely", () => {
    expect(regionAtPoint(sheet, { x: -10_000, y: -10_000 })).toBeNull();
  });

  it("returns null for an empty sheet", () => {
    expect(regionAtPoint(computeRegionSheet([]), { x: 0, y: 0 })).toBeNull();
  });
});
