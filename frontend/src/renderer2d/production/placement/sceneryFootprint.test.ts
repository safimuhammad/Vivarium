import { describe, expect, it } from "vitest";

import {
  deriveSceneryFootprintGeometry,
  sceneryFootprintTiles,
  sceneryFootprintTilesForFoot,
  SceneryFootprintError,
  singleTileFootprint,
  type SceneryContactModel,
  type SceneryFootprintExtent,
  type SceneryFrameGeometry,
} from "./sceneryFootprint";

/** The authored Nirvana East mesa: 512x384, pivot (256,306), the approved pilot tier. */
const MESA_FRAME: SceneryFrameGeometry = { width: 512, height: 384, pivotX: 256, pivotY: 306 };
const BUTTE_FRAME: SceneryFrameGeometry = { width: 288, height: 224, pivotX: 144, pivotY: 179 };
const OUTCROP_FRAME: SceneryFrameGeometry = { width: 160, height: 128, pivotX: 80, pivotY: 102 };

/** Cap centre 0.245 + wall height 0.30 = 0.545 of the frame height. */
const MESA_CONTACT: SceneryContactModel = {
  shape: "ellipse",
  centerXFraction: 0.44,
  centerYFraction: 0.545,
  halfWidthFraction: 0.34,
  halfHeightFraction: 0.205,
  shrink: 0.92,
};

const TORUS: SceneryFootprintExtent = {
  columns: 96,
  rows: 96,
  tileSize: 32,
  topology: "toroidal",
};
const BOUNDED: SceneryFootprintExtent = { columns: 96, rows: 96, tileSize: 32 };

describe("deriveSceneryFootprintGeometry", () => {
  it("reproduces the approved Nirvana East pilot's hand-derived tier table", () => {
    // The pilot contract's own by-hand arithmetic, quoted in eastScene.ts:
    //   mesa 5.00/2.26/-0.96/-3.02, butte 2.81/1.32/-0.54/-1.76, outcrop 1.56/0.76/-0.30/-1.01
    const cases = [
      { frame: MESA_FRAME, expected: [5.00, 2.26, -0.96, -3.02] },
      { frame: BUTTE_FRAME, expected: [2.81, 1.32, -0.54, -1.76] },
      { frame: OUTCROP_FRAME, expected: [1.56, 0.76, -0.30, -1.01] },
    ] as const;
    for (const { frame, expected } of cases) {
      const geometry = deriveSceneryFootprintGeometry(frame, MESA_CONTACT, 32);
      expect(geometry.halfColumns).toBeCloseTo(expected[0], 1);
      expect(geometry.halfRows).toBeCloseTo(expected[1], 1);
      expect(geometry.offsetColumns).toBeCloseTo(expected[2], 1);
      expect(geometry.offsetRows).toBeCloseTo(expected[3], 1);
    }
  });

  it("scales with the art, because the contact model is declared in fractions", () => {
    const small = deriveSceneryFootprintGeometry(
      { width: 256, height: 192, pivotX: 128, pivotY: 153 },
      MESA_CONTACT,
      32,
    );
    const large = deriveSceneryFootprintGeometry(MESA_FRAME, MESA_CONTACT, 32);
    expect(large.halfColumns).toBeCloseTo(small.halfColumns * 2, 6);
    expect(large.halfRows).toBeCloseTo(small.halfRows * 2, 6);
  });

  it("shrinks the contact region below the drawn silhouette", () => {
    const shrunk = deriveSceneryFootprintGeometry(MESA_FRAME, MESA_CONTACT, 32);
    const full = deriveSceneryFootprintGeometry(
      MESA_FRAME,
      { ...MESA_CONTACT, shrink: 1 },
      32,
    );
    expect(shrunk.halfColumns).toBeLessThan(full.halfColumns);
    expect(shrunk.halfColumns).toBeCloseTo(full.halfColumns * 0.92, 6);
  });

  it("rejects non-finite and non-positive geometry rather than emitting NaN tiles", () => {
    expect(() => deriveSceneryFootprintGeometry({ ...MESA_FRAME, width: 0 }, MESA_CONTACT, 32))
      .toThrow(SceneryFootprintError);
    expect(() => deriveSceneryFootprintGeometry(MESA_FRAME, MESA_CONTACT, 0))
      .toThrow(SceneryFootprintError);
    expect(() => deriveSceneryFootprintGeometry(
      MESA_FRAME,
      { ...MESA_CONTACT, halfWidthFraction: 0 },
      32,
    )).toThrow(SceneryFootprintError);
    expect(() => deriveSceneryFootprintGeometry(
      { ...MESA_FRAME, pivotX: Number.NaN },
      MESA_CONTACT,
      32,
    )).toThrow(SceneryFootprintError);
  });
});

describe("sceneryFootprintTilesForFoot", () => {
  it("blocks MANY tiles for a mesa, not one — the defect this module removes", () => {
    const tiles = sceneryFootprintTilesForFoot(
      { footColumn: 48, footRow: 48 },
      MESA_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    // ~11 x 5 tiles of ellipse, per the pilot report's own measurement.
    expect(tiles.length).toBeGreaterThan(30);
    const columns = tiles.map((tile) => tile.column);
    const rows = tiles.map((tile) => tile.row);
    expect(Math.max(...columns) - Math.min(...columns) + 1).toBeGreaterThanOrEqual(9);
    expect(Math.max(...rows) - Math.min(...rows) + 1).toBeGreaterThanOrEqual(4);
  });

  it("sizes tiers in order: mesa wider than butte wider than outcrop", () => {
    const at = (frame: SceneryFrameGeometry): number => sceneryFootprintTilesForFoot(
      { footColumn: 48, footRow: 48 },
      frame,
      MESA_CONTACT,
      TORUS,
    ).length;
    expect(at(MESA_FRAME)).toBeGreaterThan(at(BUTTE_FRAME));
    expect(at(BUTTE_FRAME)).toBeGreaterThan(at(OUTCROP_FRAME));
  });

  it("centres the footprint on the drawn mass, not on the foot pivot", () => {
    const tiles = sceneryFootprintTilesForFoot(
      { footColumn: 48, footRow: 48 },
      MESA_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    const rows = tiles.map((tile) => tile.row);
    // offsetRows is about -3, so the contact sits ABOVE the foot anchor.
    const meanRow = rows.reduce((total, row) => total + row, 0) / rows.length;
    expect(meanRow).toBeLessThan(48);
    expect(meanRow).toBeGreaterThan(42);
  });

  it("wraps in TILE units on a torus — never in pixels (the pilot's round-1 bug)", () => {
    const tiles = sceneryFootprintTilesForFoot(
      { footColumn: 1, footRow: 48 },
      MESA_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    expect(tiles.every((tile) => tile.column >= 0 && tile.column < 96)).toBe(true);
    expect(tiles.some((tile) => tile.column > 90)).toBe(true);
    expect(tiles.some((tile) => tile.column < 5)).toBe(true);
    // A pixel-period bug would land the wrapped tiles somewhere unrelated to column 0.
    expect(tiles.every((tile) => tile.column < 8 || tile.column > 88)).toBe(true);
  });

  it("never returns a duplicate tile when an object wraps onto itself", () => {
    const tiles = sceneryFootprintTilesForFoot(
      { footColumn: 0, footRow: 0 },
      MESA_FRAME,
      MESA_CONTACT,
      { columns: 8, rows: 8, tileSize: 32, topology: "toroidal" },
    );
    const keys = new Set(tiles.map((tile) => `${tile.column},${tile.row}`));
    expect(keys.size).toBe(tiles.length);
    expect(tiles.every((tile) => tile.column < 8 && tile.row < 8)).toBe(true);
  });

  it("clips instead of wrapping on a bounded grid", () => {
    const tiles = sceneryFootprintTilesForFoot(
      { footColumn: 1, footRow: 48 },
      MESA_FRAME,
      MESA_CONTACT,
      BOUNDED,
    );
    expect(tiles.every((tile) => tile.column >= 0 && tile.column < 96)).toBe(true);
    expect(tiles.some((tile) => tile.column > 90)).toBe(false);
  });

  it("supports a RECT contact for boxy objects such as ruins and tower bases", () => {
    const rect = sceneryFootprintTilesForFoot(
      { footColumn: 48, footRow: 48 },
      MESA_FRAME,
      { ...MESA_CONTACT, shape: "rect" },
      TORUS,
    );
    const ellipse = sceneryFootprintTilesForFoot(
      { footColumn: 48, footRow: 48 },
      MESA_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    // Same extents; a rect fills its corners and an ellipse does not.
    expect(rect.length).toBeGreaterThan(ellipse.length);
    const rectKeys = new Set(rect.map((tile) => `${tile.column},${tile.row}`));
    for (const tile of ellipse) expect(rectKeys.has(`${tile.column},${tile.row}`)).toBe(true);
  });

  it("is translation-equivariant on the torus", () => {
    const key = (tiles: readonly { column: number; row: number }[], dc: number): string => (
      [...tiles.map((tile) => `${(tile.column - dc + 96) % 96},${tile.row}`)].sort().join(" ")
    );
    const home = sceneryFootprintTilesForFoot(
      { footColumn: 40, footRow: 40 },
      BUTTE_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    const shifted = sceneryFootprintTilesForFoot(
      { footColumn: 70, footRow: 40 },
      BUTTE_FRAME,
      MESA_CONTACT,
      TORUS,
    );
    expect(key(shifted, 30)).toBe(key(home, 0));
  });
});

describe("sceneryFootprintTiles", () => {
  it("selects a tile by its CENTRE, matching the ground-terrain feet rule", () => {
    const tiles = sceneryFootprintTiles(
      10.5,
      10.5,
      { halfColumns: 0.4, halfRows: 0.4, offsetColumns: 0, offsetRows: 0 },
      TORUS,
    );
    expect(tiles).toEqual([{ column: 10, row: 10 }]);
  });

  it("returns nothing when the contact region covers no tile centre", () => {
    const tiles = sceneryFootprintTiles(
      10.0,
      10.0,
      { halfColumns: 0.2, halfRows: 0.2, offsetColumns: 0, offsetRows: 0 },
      TORUS,
    );
    expect(tiles).toEqual([]);
  });
});

describe("singleTileFootprint", () => {
  it("wraps a small prop's one tile on a torus", () => {
    expect(singleTileFootprint({ footColumn: -1, footRow: 97 }, TORUS))
      .toEqual([{ column: 95, row: 1 }]);
  });

  it("drops an out-of-region prop on a bounded grid", () => {
    expect(singleTileFootprint({ footColumn: -1, footRow: 5 }, BOUNDED)).toEqual([]);
  });
});
