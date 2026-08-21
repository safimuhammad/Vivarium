import { describe, expect, it } from "vitest";

import { findNavigationPath, type NavigationGrid } from "./navigation";
import {
  applyWrapSeams,
  deriveWrapSeamCandidates,
  openDeclaredWrapSeams,
  wrapSeamViolations,
  type WrapSeam,
} from "./wrapSeams";

describe("wrap seams", () => {
  it("opens a declared seam only when BOTH sides were walkable", () => {
    const columns = 6;
    const rows = 5;
    const reference = new Uint8Array(columns * rows);
    reference[2 * columns + columns - 1] = 1; // east side of the row-2 pair is not ground
    const collision = closedRim(columns, rows);

    const opened = openDeclaredWrapSeams(collision, reference, columns, rows, [
      { axis: "x", negativeEdgeTile: { column: 0, row: 1 }, positiveEdgeTile: { column: 5, row: 1 } },
      { axis: "x", negativeEdgeTile: { column: 0, row: 2 }, positiveEdgeTile: { column: 5, row: 2 } },
    ]);

    expect(opened).toHaveLength(1);
    expect(opened[0]!.negativeEdgeTile).toEqual({ column: 0, row: 1 });
    expect(collision[1 * columns + 0]).toBe(0);
    expect(collision[1 * columns + 5]).toBe(0);
    expect(collision[2 * columns + 0]).toBe(1);
  });

  it("refuses a declared seam that touches a corner or is not reciprocal", () => {
    const columns = 6;
    const rows = 5;
    const reference = new Uint8Array(columns * rows);
    const collision = closedRim(columns, rows);
    const illegal: readonly WrapSeam[] = [
      { axis: "x", negativeEdgeTile: { column: 0, row: 0 }, positiveEdgeTile: { column: 5, row: 0 } },
      { axis: "x", negativeEdgeTile: { column: 0, row: 1 }, positiveEdgeTile: { column: 5, row: 3 } },
      { axis: "y", negativeEdgeTile: { column: 0, row: 0 }, positiveEdgeTile: { column: 0, row: 4 } },
    ];
    expect(openDeclaredWrapSeams(collision, reference, columns, rows, illegal)).toEqual([]);
    expect(collision.every((value) => value === 1 || value === 0)).toBe(true);
    expect(wrapSeamViolations({ columns, rows, collision, topology: "toroidal" })).toEqual([]);
  });

  it("derives one central seam per axis whose inland neighbours are already walkable", () => {
    const columns = 9;
    const rows = 9;
    const collision = closedRim(columns, rows);
    const seams = deriveWrapSeamCandidates(collision, columns, rows);
    expect(seams).toEqual([
      { axis: "x", negativeEdgeTile: { column: 0, row: 4 }, positiveEdgeTile: { column: 8, row: 4 } },
      { axis: "y", negativeEdgeTile: { column: 4, row: 0 }, positiveEdgeTile: { column: 4, row: 8 } },
    ]);
  });

  it("skips an axis whose inland edge is walled, and honours a forbidden mask", () => {
    const columns = 7;
    const rows = 7;
    const collision = closedRim(columns, rows);
    for (let row = 0; row < rows; row += 1) collision[row * columns + 1] = 1; // west inland wall
    const water = new Uint8Array(columns * rows);
    for (let column = 0; column < columns; column += 1) water[column] = 1; // north rim is water
    const seams = deriveWrapSeamCandidates(collision, columns, rows, [water]);
    expect(seams).toEqual([]);
  });

  it("reports the exact rim tiles that break the boundary contract", () => {
    const columns = 5;
    const rows = 5;
    const collision = closedRim(columns, rows);
    collision[2 * columns + 0] = 0; // west open, east still closed
    collision[0] = 0; // a corner

    expect(wrapSeamViolations({ columns, rows, collision, topology: "toroidal" }))
      .toEqual([
        { tile: { column: 0, row: 0 }, reason: "corner-open" },
        { tile: { column: 0, row: 2 }, reason: "partner-blocked" },
      ]);
    expect(wrapSeamViolations({ columns, rows, collision }).map(({ reason }) => reason))
      .toEqual(["bounded-rim-open", "bounded-rim-open"]);
  });

  it("makes the wrapped route strictly shorter than the long way round", () => {
    const columns = 21;
    const rows = 5;
    const collision = closedRim(columns, rows);
    const seams = deriveWrapSeamCandidates(collision, columns, rows);
    applyWrapSeams(collision, columns, rows, seams);
    const bounded: NavigationGrid = { columns, rows, collision };
    const torus: NavigationGrid = { columns, rows, collision, topology: "toroidal" };
    expect(wrapSeamViolations(torus)).toEqual([]);

    const start = { column: 1, row: 2 };
    const goal = { column: columns - 2, row: 2 };
    const around = findNavigationPath(bounded, { start, goal });
    const across = findNavigationPath(torus, { start, goal });
    expect(around.status).toBe("reached");
    expect(across.status).toBe("reached");
    expect(around.tiles).toHaveLength(19);
    // Seam route: (1,2) -> (0,2) -> (20,2) -> (19,2). Four tiles, three steps.
    expect(across.tiles).toHaveLength(4);
    expect(across.tiles).toContainEqual({ column: 0, row: 2 });
    expect(across.tiles).toContainEqual({ column: columns - 1, row: 2 });
  });
});

/** A grid whose interior is open ground and whose entire outer ring is hard collision. */
function closedRim(columns: number, rows: number): Uint8Array {
  const collision = new Uint8Array(columns * rows);
  for (let column = 0; column < columns; column += 1) {
    collision[column] = 1;
    collision[(rows - 1) * columns + column] = 1;
  }
  for (let row = 0; row < rows; row += 1) {
    collision[row * columns] = 1;
    collision[row * columns + columns - 1] = 1;
  }
  return collision;
}
