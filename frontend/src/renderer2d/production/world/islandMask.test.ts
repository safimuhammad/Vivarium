import { describe, expect, it, vi } from "vitest";

import {
  buildIslandMask,
  islandArchetypeForKit,
  islandCoastPoints,
  islandContourLoops,
  islandFillFraction,
  islandLandAnchor,
  islandLandBox,
  islandLandPoints,
  islandMapFit,
  maskDistanceAtLocal,
  pointInIslandMask,
  MASK_CELL_PX,
  MAP_FIT_MARGIN_FRACTION,
  MAP_FIT_MARGIN_ON_LAND,
  MAP_FIT_MIN_SPAN,
  type IslandMask,
  type IslandMaskInput,
} from "./islandMask";

const PRODUCTION_KITS: Readonly<Record<string, string>> = {
  nirvana: "worn-heartland",
  nirvana_east: "dry-scrub",
  nirvana_west: "ash-waste",
  warm_springs: "spring-terraces",
};

function maskFor(overrides: Partial<IslandMaskInput> = {}): IslandMask {
  return buildIslandMask({
    regionId: "nirvana",
    kit: "worn-heartland",
    widthPx: 1_024,
    heightPx: 1_024,
    capeAngles: [],
    fill: 0.86,
    ...overrides,
  });
}

function landCells(mask: IslandMask): number {
  let count = 0;
  for (let index = 0; index < mask.land.length; index += 1) if (mask.land[index] === 1) count += 1;
  return count;
}

function connectedComponents(mask: IslandMask): number {
  const seen = new Uint8Array(mask.land.length);
  let components = 0;
  const stack: number[] = [];
  for (let start = 0; start < mask.land.length; start += 1) {
    if (mask.land[start] !== 1 || seen[start] === 1) continue;
    components += 1;
    stack.push(start);
    seen[start] = 1;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      const col = at % mask.cols;
      const row = Math.floor(at / mask.cols);
      const neighbours = [
        col > 0 ? at - 1 : -1,
        col < mask.cols - 1 ? at + 1 : -1,
        row > 0 ? at - mask.cols : -1,
        row < mask.rows - 1 ? at + mask.cols : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] === 1 || mask.land[next] !== 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
  }
  return components;
}

/** Total coastline length in cells -- the perimeter of the land set. */
function coastlineCells(mask: IslandMask): number {
  let edges = 0;
  const isLand = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < mask.cols && row < mask.rows && mask.land[row * mask.cols + col] === 1;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      if (!isLand(col, row)) continue;
      if (!isLand(col, row - 1)) edges += 1;
      if (!isLand(col, row + 1)) edges += 1;
      if (!isLand(col - 1, row)) edges += 1;
      if (!isLand(col + 1, row)) edges += 1;
    }
  }
  return edges;
}

describe("buildIslandMask -- determinism", () => {
  it("is a pure function of its inputs: the same region always yields the identical land grid", () => {
    const first = maskFor();
    const second = maskFor();
    expect(Array.from(second.land)).toEqual(Array.from(first.land));
    expect(Array.from(second.dist)).toEqual(Array.from(first.dist));
  });

  it("never invokes Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    try {
      for (const [regionId, kit] of Object.entries(PRODUCTION_KITS)) {
        maskFor({ regionId, kit, capeAngles: [0.4, 2.1] });
      }
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("produces a distinct silhouette per region id", () => {
    const nirvana = maskFor({ regionId: "nirvana" });
    const springs = maskFor({ regionId: "warm_springs", kit: "spring-terraces" });
    expect(Array.from(springs.land)).not.toEqual(Array.from(nirvana.land));
  });

  it("gives each archetype its own shape character, not one shape at four sizes", () => {
    const ratios = Object.entries(PRODUCTION_KITS).map(([regionId, kit]) => {
      const mask = maskFor({ regionId, kit });
      return landCells(mask) / (mask.cols * mask.rows);
    });
    // the long ragged spit and the fractured waste must not fill their plot like the plump refuge
    expect(Math.max(...ratios) - Math.min(...ratios)).toBeGreaterThan(0.05);
  });

  it("maps every production kit to its own archetype, unknown kits to the neutral one", () => {
    expect(islandArchetypeForKit("worn-heartland")).toBe("worn_heartland");
    expect(islandArchetypeForKit("spring-terraces")).toBe("spring_terraces");
    expect(islandArchetypeForKit("dry-scrub")).toBe("dry_scrub");
    expect(islandArchetypeForKit("ash-waste")).toBe("ash_waste");
    expect(islandArchetypeForKit("something-new")).toBe("neutral_temperate");
  });
});

describe("buildIslandMask -- the shape the rejected method could not make", () => {
  it("is NOT star-shaped from its own centroid: rays leave the land and re-enter it", () => {
    // The whole point of the multi-lobe smooth-min field. A single-centre r(theta) polygon is
    // star-shaped from its centre BY CONSTRUCTION, so this property is exactly what proves each
    // island has genuine bays/necks rather than a wobbled circle. Measured on the four real
    // production regions at their real 96x96-tile extent, with their real neighbour directions.
    const CAPES: Readonly<Record<string, readonly number[]>> = {
      nirvana: [0, 2.1, -2.1],
      nirvana_east: [1.6, 3.0],
      nirvana_west: [-1.6, 3.0],
      warm_springs: [0.5, 2.6, -1.2],
    };
    for (const [regionId, kit] of Object.entries(PRODUCTION_KITS)) {
      const mask = maskFor({
        regionId,
        kit,
        widthPx: 3_072,
        heightPx: 3_072,
        capeAngles: CAPES[regionId] as readonly number[],
      });
      let centroidX = 0;
      let centroidY = 0;
      let cells = 0;
      for (let row = 0; row < mask.rows; row += 1) {
        for (let col = 0; col < mask.cols; col += 1) {
          if (mask.land[row * mask.cols + col] !== 1) continue;
          centroidX += col;
          centroidY += row;
          cells += 1;
        }
      }
      centroidX = (centroidX / cells) * mask.cell;
      centroidY = (centroidY / cells) * mask.cell;

      let reentrantRays = 0;
      const maxRadius = Math.max(mask.cols, mask.rows) * mask.cell;
      for (let step = 0; step < 720; step += 1) {
        const angle = (step / 720) * Math.PI * 2;
        let transitions = 0;
        let previous = pointInIslandMask(mask, centroidX, centroidY);
        for (let radius = mask.cell; radius < maxRadius; radius += mask.cell / 2) {
          const inside = pointInIslandMask(
            mask,
            centroidX + Math.cos(angle) * radius,
            centroidY + Math.sin(angle) * radius,
          );
          if (inside !== previous) transitions += 1;
          previous = inside;
        }
        // A star-shaped silhouette has exactly ONE land->sea transition along every ray.
        if (transitions > 1) reentrantRays += 1;
      }
      expect(reentrantRays, `${regionId} has no bay a star-shaped outline could not make`)
        .toBeGreaterThan(0);
    }
  });

  it("keeps exactly one landmass -- no confetti islands, after the cleanup pass", () => {
    for (const [regionId, kit] of Object.entries(PRODUCTION_KITS)) {
      expect(connectedComponents(maskFor({ regionId, kit }))).toBe(1);
    }
  });

  it("grows a cape toward every real neighbour: the island's arms point at its bridges", () => {
    const easternLand = (mask: IslandMask): number => {
      let count = 0;
      for (let row = 0; row < mask.rows; row += 1) {
        for (let col = Math.floor(mask.cols * 0.72); col < mask.cols; col += 1) {
          if (mask.land[row * mask.cols + col] === 1) count += 1;
        }
      }
      return count;
    };
    const withoutCape = maskFor({ regionId: "nirvana_east", kit: "dry-scrub", capeAngles: [] });
    const withCape = maskFor({ regionId: "nirvana_east", kit: "dry-scrub", capeAngles: [0] });
    expect(easternLand(withCape)).toBeGreaterThan(easternLand(withoutCape));
  });
});

describe("buildIslandMask -- growth stability (Nirvana's toroidal growth)", () => {
  const base = maskFor({ regionId: "nirvana", widthPx: 1_024, heightPx: 1_024 });
  const grown = maskFor({ regionId: "nirvana", widthPx: 1_536, heightPx: 1_536 });

  it("keeps the island's own fill fraction when the region's extent grows", () => {
    const baseRatio = landCells(base) / (base.cols * base.rows);
    const grownRatio = landCells(grown) / (grown.cols * grown.rows);
    expect(Math.abs(grownRatio - baseRatio)).toBeLessThan(0.06);
  });

  it("gives a bigger island MORE coastline, not stretched coastline", () => {
    // Wavelengths are fixed in TILES, so coast grain is constant: perimeter grows faster than the
    // pure geometric 1.5x a rescaled silhouette would give.
    expect(coastlineCells(grown) / coastlineCells(base)).toBeGreaterThan(1.4);
  });

  it("still resolves to exactly one landmass at the grown extent", () => {
    expect(connectedComponents(grown)).toBe(1);
  });

  it("rejects a non-positive or non-finite extent", () => {
    expect(() => maskFor({ widthPx: 0 })).toThrow(RangeError);
    expect(() => maskFor({ heightPx: Number.NaN })).toThrow(RangeError);
  });
});

describe("the signed distance field", () => {
  const mask = maskFor();

  it("is negative on land and positive at sea, on the same grid as the land mask", () => {
    for (let index = 0; index < mask.land.length; index += 1) {
      if (mask.land[index] === 1) expect(mask.dist[index] as number).toBeLessThan(0);
      else expect(mask.dist[index] as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("samples in plot-local pixels, and reads +Infinity outside the plot", () => {
    expect(maskDistanceAtLocal(mask, -1, 10)).toBe(Number.POSITIVE_INFINITY);
    expect(maskDistanceAtLocal(mask, 10, mask.rows * MASK_CELL_PX + 5)).toBe(Number.POSITIVE_INFINITY);
    expect(maskDistanceAtLocal(mask, (mask.cols * MASK_CELL_PX) / 2, (mask.rows * MASK_CELL_PX) / 2))
      .toBeLessThan(0);
  });

  it("agrees with the O(1) land lookup everywhere", () => {
    for (let row = 0; row < mask.rows; row += 4) {
      for (let col = 0; col < mask.cols; col += 4) {
        const inside = pointInIslandMask(mask, (col + 0.5) * mask.cell, (row + 0.5) * mask.cell);
        expect(inside).toBe(mask.land[row * mask.cols + col] === 1);
      }
    }
  });
});

describe("coast points, contours and land scatter", () => {
  const mask = maskFor();

  it("puts every coast point within the waterline band it claims", () => {
    const points = islandCoastPoints(mask);
    expect(points.length).toBeGreaterThan(20);
    for (const point of points) {
      const distance = maskDistanceAtLocal(mask, point.x, point.y);
      expect(distance).toBeLessThanOrEqual(0);
      expect(distance).toBeGreaterThanOrEqual(-1.8);
    }
  });

  it("traces closed rectilinear coastline loops on the mask's own lattice", () => {
    const loops = islandContourLoops(mask);
    expect(loops.length).toBeGreaterThan(0);
    const outer = loops[0] as ReadonlyArray<{ x: number; y: number }>;
    expect(outer.length).toBeGreaterThan(8);
    for (const point of outer) {
      expect(point.x % MASK_CELL_PX).toBe(0);
      expect(point.y % MASK_CELL_PX).toBe(0);
    }
    // every step is axis-aligned (a stair-step on the art's own grid, not a vector curve)
    for (let index = 0; index < outer.length; index += 1) {
      const a = outer[index] as { x: number; y: number };
      const b = outer[(index + 1) % outer.length] as { x: number; y: number };
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it("never scatters a mark into the sea", () => {
    const points = islandLandPoints(mask, "being:wanderer_001", 40, 4);
    expect(points.length).toBe(40);
    for (const point of points) {
      expect(maskDistanceAtLocal(mask, point.x, point.y)).toBeLessThan(-4);
    }
  });

  it("scatters deterministically for the same seed and differently for different seeds", () => {
    expect(islandLandPoints(mask, "a", 8, 4)).toEqual(islandLandPoints(mask, "a", 8, 4));
    expect(islandLandPoints(mask, "b", 8, 4)).not.toEqual(islandLandPoints(mask, "a", 8, 4));
  });

  it("drops marks rather than faking them when no cell is deep enough inland", () => {
    expect(islandLandPoints(mask, "x", 3, 10_000)).toEqual([]);
  });

  it("anchors a region's name below its own southernmost coast", () => {
    const anchor = islandLandAnchor(mask);
    expect(anchor.cells).toBeGreaterThan(0);
    expect(anchor.southY).toBeGreaterThan(0);
    expect(anchor.centroidX).toBeGreaterThan(0);
    expect(anchor.centroidX).toBeLessThan(mask.cols * mask.cell);
  });
});

describe("islandFillFraction", () => {
  it("earns the richest region the broadest island and the poorest a small rock", () => {
    expect(islandFillFraction(260, 260)).toBeCloseTo(0.96, 5);
    expect(islandFillFraction(60, 260)).toBeLessThan(islandFillFraction(140, 260));
    expect(islandFillFraction(0, 260)).toBeCloseTo(0.5, 5);
  });

  it("degrades to a sane middle rather than throwing on a degenerate world", () => {
    expect(islandFillFraction(10, 0)).toBeGreaterThan(0.5);
    expect(islandFillFraction(Number.NaN, 100)).toBeGreaterThan(0.5);
  });
});

describe("islandLandBox", () => {
  it("bounds every land cell, so content drawn to fill it covers the whole island", () => {
    const mask = maskFor();
    const box = islandLandBox(mask);
    for (let row = 0; row < mask.rows; row += 1) {
      for (let col = 0; col < mask.cols; col += 1) {
        if (mask.land[row * mask.cols + col] !== 1) continue;
        const x = col * mask.cell;
        const y = row * mask.cell;
        expect(x).toBeGreaterThanOrEqual(box.x);
        expect(y).toBeGreaterThanOrEqual(box.y);
        expect(x).toBeLessThan(box.x + box.width);
        expect(y).toBeLessThan(box.y + box.height);
      }
    }
  });

  it("is tight: the box is smaller than the plot, which is why a 1:1 clip loses the margins", () => {
    const mask = maskFor({ fill: 0.7 });
    const box = islandLandBox(mask);
    expect(box.width).toBeLessThan(mask.cols * mask.cell);
    expect(box.height).toBeLessThan(mask.rows * mask.cell);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });

  it("degrades to the whole plot for a mask with no land at all", () => {
    const empty = { cols: 4, rows: 3, cell: MASK_CELL_PX, land: new Uint8Array(12), dist: new Float32Array(12) };
    expect(islandLandBox(empty)).toEqual({ x: 0, y: 0, width: 4 * MASK_CELL_PX, height: 3 * MASK_CELL_PX });
  });
});

describe("islandMapFit", () => {
  /** The land fraction of the fit's own margin band -- what the fit exists to keep on land. */
  function marginOnLand(mask: IslandMask, fit: ReturnType<typeof islandMapFit>): number {
    const band = Math.min(fit.width, fit.height) * MAP_FIT_MARGIN_FRACTION;
    let on = 0;
    let total = 0;
    for (let row = 0; row < mask.rows; row += 1) {
      for (let col = 0; col < mask.cols; col += 1) {
        const x = (col + 0.5) * mask.cell;
        const y = (row + 0.5) * mask.cell;
        if (x < fit.x || y < fit.y || x >= fit.x + fit.width || y >= fit.y + fit.height) continue;
        const inner = x >= fit.x + band && y >= fit.y + band
          && x < fit.x + fit.width - band && y < fit.y + fit.height - band;
        if (inner) continue;
        total += 1;
        if (mask.land[row * mask.cols + col] === 1) on += 1;
      }
    }
    return total === 0 ? 1 : on / total;
  }

  it("keeps the plot's own margins on land -- the whole point of fitting the land, not its box", () => {
    const mask = maskFor({ fill: 0.6 });
    const fit = islandMapFit(mask, 1_024, 1_024);
    expect(marginOnLand(mask, fit)).toBeGreaterThanOrEqual(MAP_FIT_MARGIN_ON_LAND);
    // ...where the bounding box does NOT: that is the defect being fixed.
    expect(marginOnLand(mask, islandLandBox(mask))).toBeLessThan(MAP_FIT_MARGIN_ON_LAND);
  });

  it("scales UNIFORMLY: the fit carries the plot's aspect ratio exactly, at any aspect", () => {
    const mask = maskFor({ fill: 0.6 });
    for (const [w, h] of [[1_024, 1_024], [1_536, 1_024], [1_024, 2_048]] as const) {
      const fit = islandMapFit(mask, w, h);
      expect(fit.width / fit.height).toBeCloseTo(w / h, 6);
    }
  });

  it("lies inside the island's land box, and is smaller than it", () => {
    const mask = maskFor({ fill: 0.6 });
    const fit = islandMapFit(mask, 1_024, 1_024);
    const box = islandLandBox(mask);
    expect(fit.x).toBeGreaterThanOrEqual(box.x);
    expect(fit.y).toBeGreaterThanOrEqual(box.y);
    expect(fit.x + fit.width).toBeLessThanOrEqual(box.x + box.width);
    expect(fit.y + fit.height).toBeLessThanOrEqual(box.y + box.height);
    expect(fit.width).toBeLessThan(box.width);
  });

  it("takes the whole plot when the whole plot is land -- it only shrinks when it must", () => {
    const cols = 32;
    const rows = 32;
    const solid: IslandMask = {
      cols,
      rows,
      cell: MASK_CELL_PX,
      land: new Uint8Array(cols * rows).fill(1),
      dist: new Float32Array(cols * rows).fill(-8),
    };
    const fit = islandMapFit(solid, cols * MASK_CELL_PX, rows * MASK_CELL_PX);
    expect(fit).toEqual({ x: 0, y: 0, width: cols * MASK_CELL_PX, height: rows * MASK_CELL_PX });
  });

  it("is deterministic, and degrades to the land box for an empty mask or a degenerate plot", () => {
    const mask = maskFor({ fill: 0.6 });
    expect(islandMapFit(mask, 1_024, 1_024)).toEqual(islandMapFit(mask, 1_024, 1_024));
    const empty = { cols: 4, rows: 3, cell: MASK_CELL_PX, land: new Uint8Array(12), dist: new Float32Array(12) };
    // No land at all: the cover of the (whole-plot) land box, still at the plot's aspect.
    const none = islandMapFit(empty, 512, 512);
    expect(none.width).toBeCloseTo(none.height, 6);
    expect(none.width).toBeGreaterThanOrEqual(4 * MASK_CELL_PX);
    // A degenerate plot has no aspect to preserve, so the land box is the only honest answer.
    expect(islandMapFit(mask, 0, 1_024)).toEqual(islandLandBox(mask));
  });

  it("holds the contract for every production silhouette: margins on land, or full cover", () => {
    // One rule, four very different shapes. Either the island had a map-sized rect in it -- in which
    // case the plot's margins land on land -- or it did not, and the map covers the whole island the
    // way it did before this fit existed. Never a per-axis stretch, either way.
    for (const [regionId, kit] of Object.entries(PRODUCTION_KITS)) {
      const mask = maskFor({ regionId, kit, widthPx: 3_072, heightPx: 3_072, fill: 0.86 });
      const fit = islandMapFit(mask, 3_072, 3_072);
      const box = islandLandBox(mask);
      expect(fit.width / fit.height).toBeCloseTo(1, 6);
      const fitted = fit.height >= box.height * MAP_FIT_MIN_SPAN * 0.999
        && marginOnLand(mask, fit) >= MAP_FIT_MARGIN_ON_LAND;
      const covers = fit.x <= box.x + 1e-6 && fit.y <= box.y + 1e-6
        && fit.x + fit.width >= box.x + box.width - 1e-6
        && fit.y + fit.height >= box.y + box.height - 1e-6;
      expect(fitted || covers).toBe(true);
    }
  });

  it("falls back to the uniform COVER of the land box, never to a per-axis stretch", () => {
    // A cross: no rectangle of any size has its margins on land, so the fit must give up -- and what
    // it gives back still has to be square for a square plot.
    const cols = 40;
    const rows = 40;
    const land = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const arm = (col >= 17 && col < 23) || (row >= 17 && row < 23);
        if (arm) land[row * cols + col] = 1;
      }
    }
    const cross: IslandMask = { cols, rows, cell: MASK_CELL_PX, land, dist: new Float32Array(cols * rows) };
    const plot = cols * MASK_CELL_PX;
    const fit = islandMapFit(cross, plot, plot);
    const box = islandLandBox(cross);
    expect(fit.width).toBeCloseTo(fit.height, 6);
    expect(fit.width).toBeGreaterThanOrEqual(box.width - 1e-6);
    expect(fit.height).toBeGreaterThanOrEqual(box.height - 1e-6);
  });
});
