import { describe, expect, it } from "vitest";

import type { TileCoord } from "../../map/regionMap";

import {
  connectNavigationEndpoints,
  findNavigationPath,
  navigationTileDistance,
  navigationTileIndex,
  wrapNavigationPoint,
  wrapNavigationTile,
  type NavigationGrid,
} from "./navigation";

describe("production navigation", () => {
  it("chooses deterministic north/east/south/west routes", () => {
    const grid = openGrid(5, 5);
    expect(findNavigationPath(grid, { start: { column: 2, row: 2 }, goal: { column: 3, row: 1 } }).tiles).toEqual([
      { column: 2, row: 2 }, { column: 2, row: 1 }, { column: 3, row: 1 },
    ]);
  });

  it("never crosses hard obstacles but treats occupants as a soft cost", () => {
    const grid = openGrid(5, 3);
    grid.collision[navigationTileIndex(grid, { column: 2, row: 1 })] = 1;
    const soft = new Set([navigationTileIndex(grid, { column: 1, row: 0 })]);
    const route = findNavigationPath(grid, { start: { column: 0, row: 1 }, goal: { column: 4, row: 1 }, softOccupied: soft });
    expect(route.status).toBe("reached");
    expect(route.tiles.every((tile) => grid.collision[navigationTileIndex(grid, tile)] === 0)).toBe(true);
    expect(route.tiles).not.toContainEqual({ column: 1, row: 0 });
  });

  it("crosses a soft occupant when it is the only legal corridor", () => {
    const grid = openGrid(4, 1);
    const occupied = new Set([navigationTileIndex(grid, { column: 2, row: 0 })]);
    expect(findNavigationPath(grid, { start: { column: 0, row: 0 }, goal: { column: 3, row: 0 }, softOccupied: occupied })).toMatchObject({
      status: "reached",
      tiles: [{ column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 }, { column: 3, row: 0 }],
    });
  });

  it("returns an explicit deterministic nearest-reachable fallback diagnostic", () => {
    const grid = openGrid(5, 5);
    const goal = { column: 2, row: 2 };
    for (const tile of [{ column: 2, row: 1 }, { column: 3, row: 2 }, { column: 2, row: 3 }, { column: 1, row: 2 }]) {
      grid.collision[navigationTileIndex(grid, tile)] = 1;
    }
    const route = findNavigationPath(grid, { start: { column: 0, row: 0 }, goal });
    expect(route.status).toBe("nearest");
    expect(route.tiles.at(-1)).toEqual({ column: 2, row: 0 });
    expect(route.diagnostic).toEqual({ code: "goal-unreachable", requestedGoal: goal, resolvedGoal: { column: 2, row: 0 } });
  });

  it("rejects invalid starts and bounds searches with a safe fallback", () => {
    const grid = openGrid(8, 8);
    expect(findNavigationPath(grid, { start: { column: -1, row: 0 }, goal: { column: 0, row: 0 } })).toMatchObject({
      status: "unreachable", tiles: [], diagnostic: { code: "invalid-start" },
    });
    expect(findNavigationPath(grid, { start: { column: 0, row: 0 }, goal: { column: 7, row: 7 }, maxVisited: 3 })).toMatchObject({
      status: "nearest", diagnostic: { code: "search-budget-exhausted" },
    });
  });

  it("joins exact non-centered feet endpoints through their reachable cells without snapping", () => {
    const grid = openGrid(4, 2);
    const route = findNavigationPath(grid, {
      start: { column: 1, row: 1 },
      goal: { column: 3, row: 1 },
    });
    const exactStart = { x: 33, y: 63 };
    const exactGoal = { x: 127, y: 33 };

    expect(connectNavigationEndpoints(grid, route, { start: exactStart, goal: exactGoal })).toEqual([
      exactStart,
      { x: 48, y: 48 },
      { x: 80, y: 48 },
      { x: 112, y: 48 },
      exactGoal,
    ]);
    expect(connectNavigationEndpoints(grid, route, { start: { x: 32, y: 31 } })).toBeNull();
  });

  it("uses a direct exact segment when both endpoints occupy the same navigation cell", () => {
    const grid = openGrid(2, 2);
    const route = findNavigationPath(grid, {
      start: { column: 1, row: 1 },
      goal: { column: 1, row: 1 },
    });
    expect(connectNavigationEndpoints(grid, route, {
      start: { x: 33, y: 33 },
      goal: { x: 63, y: 63 },
    })).toEqual([{ x: 33, y: 33 }, { x: 63, y: 63 }]);
  });
});

describe("toroidal navigation", () => {
  it("leaves a bounded grid exactly as it was — no wrap, plain Manhattan heuristic", () => {
    const grid = openGrid(9, 1);
    expect(navigationTileDistance(grid, { column: 0, row: 0 }, { column: 8, row: 0 })).toBe(8);
    expect(findNavigationPath(grid, {
      start: { column: 0, row: 0 },
      goal: { column: 8, row: 0 },
    }).tiles).toHaveLength(9);
    expect(wrapNavigationTile(grid, { column: -1, row: 0 })).toEqual({ column: -1, row: 0 });
    expect(findNavigationPath(grid, {
      start: { column: -1, row: 0 },
      goal: { column: 0, row: 0 },
    })).toMatchObject({ status: "unreachable", diagnostic: { code: "invalid-start" } });
  });

  it("steps across the west/east seam and takes the short way round", () => {
    const grid = openTorus(9, 1);
    const route = findNavigationPath(grid, {
      start: { column: 0, row: 0 },
      goal: { column: 8, row: 0 },
    });
    expect(route.status).toBe("reached");
    // Two tiles, one step: west off column 0 lands on column 8 — not nine tiles the long way.
    expect(route.tiles).toEqual([{ column: 0, row: 0 }, { column: 8, row: 0 }]);
    expect(navigationTileDistance(grid, { column: 0, row: 0 }, { column: 8, row: 0 })).toBe(1);
  });

  it("steps across the north/south seam too", () => {
    const grid = openTorus(1, 7);
    expect(findNavigationPath(grid, {
      start: { column: 0, row: 0 },
      goal: { column: 0, row: 6 },
    }).tiles).toEqual([{ column: 0, row: 0 }, { column: 0, row: 6 }]);
  });

  it("refuses the seam when the far edge is blocked, and never routes to nowhere", () => {
    const grid = openTorus(9, 1);
    grid.collision[navigationTileIndex(grid, { column: 8, row: 0 })] = 1;
    const route = findNavigationPath(grid, {
      start: { column: 0, row: 0 },
      goal: { column: 7, row: 0 },
    });
    expect(route.status).toBe("reached");
    // The wrapped neighbour is closed, so the only route is the long way east.
    expect(route.tiles).toHaveLength(8);
    expect(route.tiles.every((tile) => grid.collision[navigationTileIndex(grid, tile)] === 0)).toBe(true);
  });

  it("emits CONTINUOUS waypoints across a seam so the crossing is drawable", () => {
    const grid = openTorus(9, 1);
    const route = findNavigationPath(grid, {
      start: { column: 1, row: 0 },
      goal: { column: 8, row: 0 },
    });
    expect(route.tiles).toEqual([
      { column: 1, row: 0 }, { column: 0, row: 0 }, { column: 8, row: 0 },
    ]);
    // Tiles stay canonical; the waypoints walk off the west edge to x < 0 instead of
    // teleporting 7 tiles east. Every consecutive pair is exactly one tile apart.
    expect(route.waypoints).toEqual([{ x: 48, y: 16 }, { x: 16, y: 16 }, { x: -16, y: 16 }]);
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const previous = route.waypoints[index - 1]!;
      const current = route.waypoints[index]!;
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(32);
    }
    expect(wrapNavigationPoint(grid, route.waypoints.at(-1)!)).toEqual({ x: 272, y: 16 });
  });

  it("carries the exact goal connector onto the same periodic copy as the route", () => {
    const grid = openTorus(9, 1);
    const route = findNavigationPath(grid, {
      start: { column: 1, row: 0 },
      goal: { column: 8, row: 0 },
    });
    const joined = connectNavigationEndpoints(grid, route, {
      start: { x: 40, y: 20 },
      goal: { x: 280, y: 20 },
    });
    // 280 is the canonical goal on column 8; it must be emitted as -8, one continuous
    // step past the seam, or the last segment would jump the whole region width back.
    expect(joined).toEqual([
      { x: 40, y: 20 }, { x: 48, y: 16 }, { x: 16, y: 16 }, { x: -16, y: 16 }, { x: -8, y: 20 },
    ]);
  });

  it("keeps the wrapped heuristic ADMISSIBLE and the search OPTIMAL over a random sweep", () => {
    // Admissibility is what makes a wrapped A* trustworthy: h must never exceed the true
    // remaining cost, or the search silently returns a non-optimal path. Proved here
    // against exhaustive breadth-first ground truth on the same toroidal grids.
    const random = lcg(20260727);
    let checkedPairs = 0;
    let seamCrossings = 0;
    for (let trial = 0; trial < 40; trial += 1) {
      const columns = 5 + Math.floor(random() * 6);
      const rows = 4 + Math.floor(random() * 5);
      const grid = openTorus(columns, rows);
      for (let index = 0; index < grid.collision.length; index += 1) {
        if (random() < 0.18) grid.collision[index] = 1;
      }
      const start = { column: Math.floor(random() * columns), row: Math.floor(random() * rows) };
      if (grid.collision[navigationTileIndex(grid, start)] !== 0) continue;
      const truth = breadthFirstCosts(grid, start);
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const goal = { column, row };
          const trueCost = truth.get(`${column},${row}`);
          if (trueCost === undefined) continue;
          checkedPairs += 1;
          // (1) admissible: the heuristic never over-estimates.
          expect(navigationTileDistance(grid, start, goal)).toBeLessThanOrEqual(trueCost);
          // (2) optimal: A* returns a route of exactly the true minimum step count.
          const route = findNavigationPath(grid, { start, goal });
          expect(route.status).toBe("reached");
          expect(route.tiles).toHaveLength(trueCost + 1);
          for (let index = 1; index < route.tiles.length; index += 1) {
            const previous = route.tiles[index - 1]!;
            const current = route.tiles[index]!;
            const stepped = navigationTileDistance(grid, previous, current);
            expect(stepped).toBe(1);
            if (Math.abs(previous.column - current.column) > 1
              || Math.abs(previous.row - current.row) > 1) {
              seamCrossings += 1;
            }
          }
        }
      }
    }
    expect(checkedPairs).toBeGreaterThan(500);
    expect(seamCrossings).toBeGreaterThan(0);
  });
});

function openGrid(columns: number, rows: number): NavigationGrid {
  return { columns, rows, collision: new Uint8Array(columns * rows) };
}

function openTorus(columns: number, rows: number): NavigationGrid {
  return { columns, rows, collision: new Uint8Array(columns * rows), topology: "toroidal" };
}

/** Ground truth: breadth-first step counts over the SAME topology, obstacles included. */
function breadthFirstCosts(grid: NavigationGrid, start: TileCoord): Map<string, number> {
  const costs = new Map<string, number>([[`${start.column},${start.row}`, 0]]);
  const queue: TileCoord[] = [start];
  const toroidal = grid.topology === "toroidal";
  for (let head = 0; head < queue.length; head += 1) {
    const tile = queue[head]!;
    const cost = costs.get(`${tile.column},${tile.row}`)!;
    for (const delta of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      let column = tile.column + delta[0];
      let row = tile.row + delta[1];
      if (toroidal) {
        column = ((column % grid.columns) + grid.columns) % grid.columns;
        row = ((row % grid.rows) + grid.rows) % grid.rows;
      } else if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) {
        continue;
      }
      if (grid.collision[row * grid.columns + column] !== 0) continue;
      const key = `${column},${row}`;
      if (costs.has(key)) continue;
      costs.set(key, cost + 1);
      queue.push({ column, row });
    }
  }
  return costs;
}

/** Deterministic 32-bit LCG so the sweep below is reproducible without a seed library. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
