import { describe, expect, it } from "vitest";

import {
  createValleyScene,
  walkableComponents,
  type ValleyScene,
} from "../nirvanaValleyPilot/valleyScene";
import {
  computeBridgeOverlay,
  computeSceneStats,
  computeWalkabilityOverlay,
} from "./valleyOverlays";

/**
 * A minimal, hand-built scene the real `createValleyScene` never produces —
 * only the fields the overlay/stat functions actually read are meaningful;
 * the rest are empty so the fixture stays exactly as small as the test needs.
 */
function fixtureScene(options: {
  columns: number;
  rows: number;
  tileSize: number;
  collision: Uint8Array;
  bridges?: ValleyScene["bridges"];
  crossings?: ValleyScene["crossings"];
}): ValleyScene {
  const { columns, rows, tileSize, collision } = options;
  return {
    columns,
    rows,
    tileSize,
    widthPixels: columns * tileSize,
    heightPixels: rows * tileSize,
    tiles: [],
    collision,
    props: [],
    crossings: options.crossings ?? [],
    bridges: options.bridges ?? [],
    cornerMaterials: [],
  };
}

function alphaAt(buffer: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return buffer.data[(y * buffer.width + x) * 4 + 3];
}

function rgbAt(buffer: { width: number; data: Uint8ClampedArray }, x: number, y: number): readonly [number, number, number] {
  const index = (y * buffer.width + x) * 4;
  return [buffer.data[index], buffer.data[index + 1], buffer.data[index + 2]];
}

describe("computeWalkabilityOverlay", () => {
  it("leaves a fully walkable scene fully transparent", () => {
    const scene = fixtureScene({
      columns: 3,
      rows: 3,
      tileSize: 8,
      collision: new Uint8Array(9),
    });
    const overlay = computeWalkabilityOverlay(scene);
    expect(overlay.width).toBe(24);
    expect(overlay.height).toBe(24);
    expect(overlay.data.every((value) => value === 0)).toBe(true);
  });

  it("tints a lone blocked tile's border, hatch, and fill pixels distinctly, and nothing else", () => {
    const collision = new Uint8Array(9);
    collision[4] = 1; // the centre tile of a 3x3 grid, column 1 / row 1
    const scene = fixtureScene({ columns: 3, rows: 3, tileSize: 8, collision });

    const overlay = computeWalkabilityOverlay(scene);

    // The centre tile spans pixels [8,16) on both axes. Every edge is exposed
    // (all four neighbours are walkable), so every border pixel is tinted at
    // the strong border alpha.
    expect(alphaAt(overlay, 8, 8)).toBe(Math.round(0.92 * 255));
    expect(rgbAt(overlay, 8, 8)).toEqual([226, 44, 62]);

    // (local 4,4) is interior and (4+4) % 8 === 0 < 2: hatch alpha.
    expect(alphaAt(overlay, 12, 12)).toBe(Math.round(0.46 * 255));

    // (local 2,2) is interior and (2+2) % 8 === 4, not a hatch pixel: fill alpha.
    expect(alphaAt(overlay, 10, 10)).toBe(Math.round(0.24 * 255));

    // A walkable tile elsewhere on the grid stays fully transparent.
    expect(alphaAt(overlay, 0, 0)).toBe(0);
  });

  it("treats the scene edge as blocked, so a blocked tile at the border has no false-open edge", () => {
    const collision = new Uint8Array(4); // 2x2, all blocked
    collision.fill(1);
    const scene = fixtureScene({ columns: 2, rows: 2, tileSize: 4, collision });
    const overlay = computeWalkabilityOverlay(scene);
    // No neighbour anywhere is walkable (all blocked, and off-grid counts as
    // blocked), so no pixel anywhere qualifies as an exposed border pixel —
    // every tinted pixel is hatch or fill, never the border alpha.
    for (let y = 0; y < overlay.height; y += 1) {
      for (let x = 0; x < overlay.width; x += 1) {
        expect(alphaAt(overlay, x, y)).not.toBe(Math.round(0.92 * 255));
      }
    }
  });
});

describe("computeBridgeOverlay", () => {
  it("highlights only the deck tiles, border pixels brighter than the fill", () => {
    const scene = fixtureScene({
      columns: 3,
      rows: 3,
      tileSize: 4,
      collision: new Uint8Array(9),
      bridges: [{
        id: "test-bridge",
        axis: "north-south",
        deck: [{ column: 1, row: 1 }],
        abutments: [{ column: 1, row: 0 }, { column: 1, row: 2 }],
      }],
    });

    const overlay = computeBridgeOverlay(scene);

    expect(alphaAt(overlay, 4, 4)).toBe(Math.round(0.95 * 255)); // deck tile top-left corner: border
    expect(rgbAt(overlay, 4, 4)).toEqual([255, 196, 60]);
    expect(alphaAt(overlay, 5, 5)).toBe(Math.round(0.55 * 255)); // deck tile interior: fill
    expect(alphaAt(overlay, 0, 0)).toBe(0); // untouched tile elsewhere
  });

  it("draws nothing when the scene has no bridges", () => {
    const scene = fixtureScene({ columns: 2, rows: 2, tileSize: 4, collision: new Uint8Array(4) });
    const overlay = computeBridgeOverlay(scene);
    expect(overlay.data.every((value) => value === 0)).toBe(true);
  });
});

describe("computeSceneStats", () => {
  it("summarises walkable/blocked/crossing/bridge counts from a fixture", () => {
    const collision = new Uint8Array(9);
    collision[0] = 1;
    collision[1] = 1;
    collision[2] = 1;
    collision[3] = 1;
    collision[4] = 1;
    const scene = fixtureScene({
      columns: 3,
      rows: 3,
      tileSize: 8,
      collision,
      crossings: [
        { id: "a", kind: "ford", tiles: [] },
        { id: "b", kind: "bridge", tiles: [] },
      ],
      bridges: [
        { id: "north", axis: "north-south", deck: [{ column: 0, row: 0 }, { column: 0, row: 1 }], abutments: [] },
        {
          id: "south",
          axis: "east-west",
          deck: [{ column: 1, row: 0 }, { column: 1, row: 1 }, { column: 1, row: 2 }],
          abutments: [],
        },
      ],
    });

    const stats = computeSceneStats(scene);

    expect(stats).toEqual({
      totalTiles: 9,
      walkableTiles: 4,
      blockedTiles: 5,
      crossings: 2,
      bridges: 2,
      bridgeDeckTiles: 5,
    });
  });

  it("matches the real pilot scene's structural invariants", () => {
    const scene = createValleyScene();
    const stats = computeSceneStats(scene);

    expect(stats.totalTiles).toBe(scene.columns * scene.rows);
    expect(stats.walkableTiles + stats.blockedTiles).toBe(stats.totalTiles);
    expect(stats.bridges).toBe(scene.bridges.length);
    expect(stats.bridges).toBeGreaterThanOrEqual(3);
    expect(stats.bridgeDeckTiles).toBeGreaterThan(0);
    expect(stats.crossings).toBeGreaterThanOrEqual(stats.bridges);
    // Every walkable tile must be reachable from every other: exactly one
    // walkable connected component, the same invariant `createValleyScene`
    // itself repairs for. This is not re-testing the builder — it is
    // asserting the overlay/stat functions are reading the SAME collision
    // grid the builder guarantees, not a stale or re-derived copy.
    const components = walkableComponents(scene.collision, scene.columns, scene.rows);
    expect(components.length).toBe(1);
    expect(components[0].tiles.length).toBe(stats.walkableTiles);
  });
});
