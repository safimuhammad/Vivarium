/**
 * Proves the Nirvana river-valley pilot's walkability mask is REAL: it is
 * exactly what the production route-finder, scene-graph move veto, and
 * placement ledger would act on -- not a picture that merely looks
 * walkable.
 *
 * Every assertion below runs the actual production functions
 * (`findNavigationPath`, `presentationPointIsClear`, `presentationRouteIsClear`,
 * `exclusionAwareGrid`, `navigationTileForFeet`, `shelterRenderRect`) against
 * `createValleyScene()`'s output. None of these tests is a smoke test: each
 * one is written so a real defect in the mask, in the terrain-exclusion-rect
 * derivation, or in the scene's material/prop bookkeeping fails it loudly,
 * with the offending tiles reported.
 */

import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import { findNavigationPath } from "../../renderer2d/production/navigation/navigation";
import {
  navigationTileForFeet,
  presentationPointIsClear,
  presentationRouteIsClear,
  shelterRenderRect,
} from "../../renderer2d/production/productionGeometry";
import { exclusionAwareGrid } from "../../presentation/choreography/interactionContact";
import { BLOCKING_VALLEY_MATERIALS } from "./valleyMaterials";
import {
  createValleyScene,
  walkableComponents,
  type ValleyBridge,
  type ValleyScene,
  type ValleyTileRef,
} from "./valleyScene";
import {
  homePlotIsClear,
  legalStandingPoints,
  terrainExclusionRects,
  toNavigationGrid,
  walkablePoints,
} from "./valleyWalkability";

// ---------------------------------------------------------------------------
// shared fixture (createValleyScene is pure/deterministic -- see the
// "determinism" suite at the bottom, which re-calls it fresh to prove that)
// ---------------------------------------------------------------------------

const scene: ValleyScene = createValleyScene();
const grid = toNavigationGrid(scene);
const exclusions = terrainExclusionRects(scene);

const walkableTiles: TileCoord[] = [];
const blockedTiles: TileCoord[] = [];
for (let row = 0; row < scene.rows; row += 1) {
  for (let column = 0; column < scene.columns; column += 1) {
    const index = row * scene.columns + column;
    (scene.collision[index] === 0 ? walkableTiles : blockedTiles).push({ column, row });
  }
}

const blockingPropTiles = new Set<string>();
for (const prop of scene.props) {
  if (prop.blocks) blockingPropTiles.add(tileKey(prop.tile));
}

function tileKey(tile: Readonly<{ column: number; row: number }>): string {
  return `${tile.column},${tile.row}`;
}

/** Deterministic (seed-based, no `Math.random`) pick from a non-empty array. */
function deterministicPick<T>(values: readonly T[], seed: number): T {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return values[h % values.length];
}

function extremeWalkableTile(score: (tile: TileCoord) => number): TileCoord {
  return walkableTiles.reduce((best, tile) => (score(tile) > score(best) ? tile : best));
}

console.info(
  `[valleyWalkability] tiles: ${scene.columns * scene.rows} total, ` +
  `${walkableTiles.length} walkable, ${blockedTiles.length} blocked; ` +
  `terrainExclusionRects: ${exclusions.length} merged rects.`,
);

interface OverRejection {
  readonly column: number;
  readonly row: number;
  /** Whether the tile directly north (row - 1) is blocked; `false` at row 0 (no north neighbour). */
  readonly northBlocked: boolean;
}

/**
 * Walkable tiles (`scene.collision === 0`) whose centre nonetheless fails
 * `presentationPointIsClear` against the terrain exclusion rects: Seam B's
 * over-rejection of Seam A. Computed once and shared between proof 5b
 * (which proves every over-rejection is explained by a blocked north
 * neighbour) and proof 6' (which proves `exclusionAwareGrid` closes exactly
 * this set and nothing else).
 */
function computeWalkableOverRejections(): readonly OverRejection[] {
  const overRejections: OverRejection[] = [];
  for (let row = 0; row < scene.rows; row += 1) {
    for (let column = 0; column < scene.columns; column += 1) {
      const index = row * scene.columns + column;
      if (scene.collision[index] !== 0) continue;
      if (presentationPointIsClear(tileCenter({ column, row }), exclusions)) continue;
      const northBlocked = row > 0 && scene.collision[(row - 1) * scene.columns + column] === 1;
      overRejections.push({ column, row, northBlocked });
    }
  }
  return overRejections;
}

const walkableOverRejections = computeWalkableOverRejections();

// ---------------------------------------------------------------------------
// Proof 1 -- connectivity
// ---------------------------------------------------------------------------

describe("connectivity", () => {
  it("has exactly one walkable component, with zero walkable tiles outside it", () => {
    const components = walkableComponents(scene.collision, scene.columns, scene.rows);
    expect(components).toHaveLength(1);
    expect(components[0]?.tiles.length ?? -1).toBe(walkableTiles.length);
  });

  it("the exported walkablePoints matches this suite's own independently-derived walkable tile set", () => {
    const points = walkablePoints(scene);
    expect(points.length).toBe(walkableTiles.length);
    for (const tile of walkableTiles.slice(0, 25)) {
      expect(points).toContainEqual(tileCenter(tile));
    }
  });
});

// ---------------------------------------------------------------------------
// Proof 2 -- every walkable cell reaches every other, via the real navigator
// ---------------------------------------------------------------------------

const CORNER_TILES: readonly TileCoord[] = [
  extremeWalkableTile((tile) => -(tile.column + tile.row)), // north-west-most
  extremeWalkableTile((tile) => tile.column - tile.row), // north-east-most
  extremeWalkableTile((tile) => tile.row - tile.column), // south-west-most
  extremeWalkableTile((tile) => tile.column + tile.row), // south-east-most
];

function cornerPairs(): ReadonlyArray<readonly [TileCoord, TileCoord]> {
  const pairs: Array<readonly [TileCoord, TileCoord]> = [];
  for (let i = 0; i < CORNER_TILES.length; i += 1) {
    for (let j = i + 1; j < CORNER_TILES.length; j += 1) {
      pairs.push([CORNER_TILES[i], CORNER_TILES[j]]);
    }
  }
  return pairs;
}

function hashSelectedPairs(count: number): ReadonlyArray<readonly [TileCoord, TileCoord]> {
  const pairs: Array<readonly [TileCoord, TileCoord]> = [];
  for (let i = 0; i < count; i += 1) {
    const start = deterministicPick(walkableTiles, i * 2 + 1);
    const goal = deterministicPick(walkableTiles, i * 2 + 200);
    pairs.push([start, goal]);
  }
  return pairs;
}

describe("full connectivity via the real navigator", () => {
  it("findNavigationPath reaches between the 4 extreme corners (6 pairs) and 40 deterministic sampled walkable pairs, staying entirely on walkable tiles", () => {
    const samples = [...cornerPairs(), ...hashSelectedPairs(40)];
    const failures: Array<{
      start: TileCoord;
      goal: TileCoord;
      status: string;
      pathLength: number;
      offMaskTiles: TileCoord[];
    }> = [];
    for (const [start, goal] of samples) {
      const result = findNavigationPath(grid, { start, goal });
      const offMaskTiles = result.tiles.filter(
        (tile) => scene.collision[tile.row * scene.columns + tile.column] !== 0,
      );
      if (result.status !== "reached" || result.tiles.length === 0 || offMaskTiles.length > 0) {
        failures.push({
          start,
          goal,
          status: result.status,
          pathLength: result.tiles.length,
          offMaskTiles,
        });
      }
    }
    expect({ sampleCount: samples.length, failures: failures.slice(0, 10), failureCount: failures.length })
      .toEqual({ sampleCount: samples.length, failures: [], failureCount: 0 });
  });
});

// ---------------------------------------------------------------------------
// Proof 3 -- the river is genuinely crossed
// ---------------------------------------------------------------------------

describe("river crossing", () => {
  it("a path exists from the west bank to the east bank and passes through an authored crossing tile", () => {
    const west = extremeWalkableTile((tile) => -tile.column);
    const east = extremeWalkableTile((tile) => tile.column);
    const result = findNavigationPath(grid, { start: west, goal: east });
    expect(result.status).toBe("reached");

    const crossingTileKeys = new Set(
      scene.crossings.flatMap((crossing) => crossing.tiles.map((tile) => tileKey(tile))),
    );
    const crossingTilesOnPath = result.tiles.filter((tile) => crossingTileKeys.has(tileKey(tile)));
    expect(crossingTilesOnPath.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Proof 4 -- mask matches the art
// ---------------------------------------------------------------------------

describe("mask matches the art", () => {
  it("collision[i] === 1 iff the tile's material is blocking OR a blocking prop stands on it", () => {
    const mismatches: Array<{
      column: number;
      row: number;
      material: string;
      blockingMaterial: boolean;
      blockingProp: boolean;
      collision: number;
    }> = [];
    for (const tile of scene.tiles) {
      const index = tile.row * scene.columns + tile.column;
      const blockingMaterial = BLOCKING_VALLEY_MATERIALS.includes(tile.material);
      const blockingProp = blockingPropTiles.has(tileKey(tile));
      const expected = blockingMaterial || blockingProp ? 1 : 0;
      const actual = scene.collision[index];
      if (actual !== expected) {
        mismatches.push({
          column: tile.column,
          row: tile.row,
          material: tile.material,
          blockingMaterial,
          blockingProp,
          collision: actual,
        });
      }
    }
    expect({ total: mismatches.length, sample: mismatches.slice(0, 15) }).toEqual({ total: 0, sample: [] });
  });
});

// ---------------------------------------------------------------------------
// Proof 5' -- no false-open (Seam B may be stricter than Seam A, never laxer)
// ---------------------------------------------------------------------------
//
// SUPERSEDES the original "seam A / seam B agreement" proof, which asserted
// full equivalence between `scene.collision` and `presentationPointIsClear`.
// That equivalence is the wrong invariant: `STANDING_HUMAN_VISUAL_ENVELOPE` is
// 22x48px, anchored 46px ABOVE the feet point -- 1.5 tiles of sprite hang
// over whatever is directly north of a standing body. Applied to dense,
// single-row-thick GROUND terrain (a riverbank), that makes
// `presentationPointIsClear` over-reject every walkable tile with blocked
// ground to its north. That is not a mask defect; it is evidence that
// rect-based envelope vetoing is the wrong instrument for ground-plane
// terrain (right for discrete OBJECTS like homes, which a body must not
// visually stand inside/behind). Terrain walkability lives on
// `grid.collision` (Seam A), already honoured by `findNavigationPath` and
// `PlacementLedger`.
//
// What must still hold, unconditionally: the rect layer may be STRICTER than
// the collision grid, but must never be LAXER -- it must never call a truly
// blocked tile "clear". That is proof 5a below. Proof 5b turns the
// over-rejection from a vague worry into a measured, fully-explained number.
describe("no false-open (Seam B may be stricter than Seam A, never laxer)", () => {
  it("(5a) every tile presentationPointIsClear reports open is genuinely walkable in scene.collision", () => {
    const falseOpens: Array<{ column: number; row: number }> = [];
    for (let row = 0; row < scene.rows; row += 1) {
      for (let column = 0; column < scene.columns; column += 1) {
        const clear = presentationPointIsClear(tileCenter({ column, row }), exclusions);
        if (clear && scene.collision[row * scene.columns + column] !== 0) {
          falseOpens.push({ column, row });
        }
      }
    }
    expect(falseOpens).toEqual([]);
  });

  it("(5b) measures the rect test's over-rejection of walkable tiles, and proves every one is fully explained by a blocked north neighbour", () => {
    console.info(
      `[valleyWalkability] presentationPointIsClear over-rejects ${walkableOverRejections.length} ` +
      `of ${walkableTiles.length} walkable tiles (the 46px-overhead standing-envelope effect).`,
    );
    const unexplained = walkableOverRejections.filter((entry) => !entry.northBlocked);
    expect({ overRejectionCount: walkableOverRejections.length, unexplained }).toEqual({
      overRejectionCount: walkableOverRejections.length,
      unexplained: [],
    });
    // The phenomenon must actually occur in this scene (real riverbank
    // terrain), or the "fully explained" proof above would be vacuous.
    expect(walkableOverRejections.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Proof 6' -- exclusionAwareGrid never opens anything, and its overclosures
// are exactly proof 5's measured over-rejection set
// ---------------------------------------------------------------------------

describe("exclusionAwareGrid never opens anything, and closes exactly the over-rejection set", () => {
  it("no blocked cell becomes open, and every newly-closed cell is exactly proof 5's over-rejection set", () => {
    const excluded = exclusionAwareGrid(grid, exclusions);
    const falseOpensInGrid: Array<{ column: number; row: number }> = [];
    const newlyClosed: Array<{ column: number; row: number }> = [];
    for (let row = 0; row < scene.rows; row += 1) {
      for (let column = 0; column < scene.columns; column += 1) {
        const index = row * scene.columns + column;
        const before = grid.collision[index];
        const after = excluded.collision[index];
        if (before === 1 && after === 0) falseOpensInGrid.push({ column, row });
        if (before === 0 && after === 1) newlyClosed.push({ column, row });
      }
    }
    expect(falseOpensInGrid).toEqual([]);

    const sortKey = (tile: { column: number; row: number }): string =>
      `${tile.row.toString().padStart(4, "0")}:${tile.column.toString().padStart(4, "0")}`;
    const sortedNewlyClosed = [...newlyClosed].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const sortedOverRejections = walkableOverRejections
      .map(({ column, row }) => ({ column, row }))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    console.info(`[valleyWalkability] exclusionAwareGrid newly closes ${newlyClosed.length} cells.`);
    expect(sortedNewlyClosed).toEqual(sortedOverRejections);
  });
});

// ---------------------------------------------------------------------------
// Proof 7 -- no being can be placed on blocked ground
// ---------------------------------------------------------------------------

function isOpenNavigationTile(feetTile: TileCoord): boolean {
  return feetTile.column >= 0 && feetTile.row >= 0
    && feetTile.column < scene.columns && feetTile.row < scene.rows
    && scene.collision[feetTile.row * scene.columns + feetTile.column] === 0;
}

describe("placement legality mirrors PlacementLedger's exact predicate", () => {
  it("every walkable tile centre maps to an open navigation tile", () => {
    const rejectedWalkable = walkableTiles.filter((tile) => !isOpenNavigationTile(navigationTileForFeet(tileCenter(tile))));
    expect(rejectedWalkable).toEqual([]);
  });

  it("legalStandingPoints is non-empty and every legal standing point is on an open navigation tile", () => {
    const legalPoints = legalStandingPoints(scene);
    expect(legalPoints.length).toBeGreaterThan(0);
    console.info(`[valleyWalkability] legalStandingPoints: ${legalPoints.length} of ${walkableTiles.length} walkable tile centres.`);
    const illegal = legalPoints.filter((point) => !isOpenNavigationTile(navigationTileForFeet(point)));
    expect(illegal).toEqual([]);
  });

  it("every BLOCKED tile centre is rejected by the placement predicate", () => {
    const accepted = blockedTiles.filter((tile) => isOpenNavigationTile(navigationTileForFeet(tileCenter(tile))));
    expect(accepted).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Proof 8' -- routes: legal-to-legal is clear, legal-to-blocked is not, and
// the real navigator's grid-level route guarantee holds (the guarantee
// production actually relies on for terrain -- see proof 5' / 6').
// ---------------------------------------------------------------------------

function sampleStride(length: number, target: number): number {
  return Math.max(1, Math.floor(length / target));
}

describe("routes are clear, not just points", () => {
  const legalTileKeys = new Set(
    legalStandingPoints(scene).map((point) => tileKey(navigationTileForFeet(point))),
  );

  it("(8a) presentationRouteIsClear is true for a deterministic sample of adjacent tile pairs where BOTH tiles are legal standing points", () => {
    const legalAdjacentPairs: Array<[Vec2, Vec2]> = [];
    const deltas = [{ column: 1, row: 0 }, { column: 0, row: 1 }] as const;
    for (const tile of walkableTiles) {
      if (!legalTileKeys.has(tileKey(tile))) continue;
      for (const delta of deltas) {
        const neighbour = { column: tile.column + delta.column, row: tile.row + delta.row };
        if (neighbour.column >= scene.columns || neighbour.row >= scene.rows) continue;
        if (!legalTileKeys.has(tileKey(neighbour))) continue;
        legalAdjacentPairs.push([tileCenter(tile), tileCenter(neighbour)]);
      }
    }
    const sample = legalAdjacentPairs.filter(
      (_, index) => index % sampleStride(legalAdjacentPairs.length, 40) === 0,
    );
    expect(sample.length).toBeGreaterThan(0);

    const notClear = sample.filter(([a, b]) => !presentationRouteIsClear(a, [b], exclusions));
    expect({ sampleSize: sample.length, notClearCount: notClear.length, notClearSample: notClear.slice(0, 10) })
      .toEqual({ sampleSize: sample.length, notClearCount: 0, notClearSample: [] });
  });

  it("(8b) presentationRouteIsClear is false for a deterministic sample of walkable-to-blocked adjacent pairs", () => {
    const walkableBlockedPairs: Array<[Vec2, Vec2]> = [];
    const deltas = [{ column: 1, row: 0 }, { column: 0, row: 1 }] as const;
    for (const tile of walkableTiles) {
      for (const delta of deltas) {
        const neighbour = { column: tile.column + delta.column, row: tile.row + delta.row };
        if (neighbour.column >= scene.columns || neighbour.row >= scene.rows) continue;
        const index = neighbour.row * scene.columns + neighbour.column;
        if (scene.collision[index] === 0) continue;
        walkableBlockedPairs.push([tileCenter(tile), tileCenter(neighbour)]);
      }
    }
    const sample = walkableBlockedPairs.filter(
      (_, index) => index % sampleStride(walkableBlockedPairs.length, 40) === 0,
    );
    expect(sample.length).toBeGreaterThan(0);

    const wronglyClear = sample.filter(([a, b]) => presentationRouteIsClear(a, [b], exclusions));
    expect({ sampleSize: sample.length, wronglyClearCount: wronglyClear.length })
      .toEqual({ sampleSize: sample.length, wronglyClearCount: 0 });
  });

  it("(8c) the real findNavigationPath lands every step of sampled long paths on an open cell -- the grid-level route guarantee production relies on for terrain", () => {
    const samples: Array<readonly [TileCoord, TileCoord]> = [];
    for (let i = 0; i < 20; i += 1) {
      samples.push([
        deterministicPick(walkableTiles, i * 3 + 501),
        deterministicPick(walkableTiles, i * 3 + 907),
      ]);
    }
    const longPaths = samples
      .map(([start, goal]) => findNavigationPath(grid, { start, goal }))
      .filter((result) => result.status === "reached" && result.tiles.length >= 15);
    expect(longPaths.length).toBeGreaterThan(0);

    const offMask = longPaths.flatMap((result) =>
      result.tiles.filter((tile) => scene.collision[tile.row * scene.columns + tile.column] !== 0));
    expect(offMask).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Proof 9 -- no home may be placed on blocked ground
// ---------------------------------------------------------------------------

describe("home plot legality", () => {
  it("reports a useful number of clear 128x128 home plots, and every reported-clear plot's full footprint is walkable", () => {
    let clearCount = 0;
    const violations: Array<{ column: number; row: number }> = [];
    for (let row = 0; row < scene.rows; row += 1) {
      for (let column = 0; column < scene.columns; column += 1) {
        const tile = { column, row };
        if (!homePlotIsClear(scene, tile)) continue;
        clearCount += 1;

        const rect = shelterRenderRect(tile);
        const minColumn = Math.floor(rect.x / scene.tileSize);
        const maxColumn = Math.floor((rect.x + rect.width - 1) / scene.tileSize);
        const minRow = Math.floor(rect.y / scene.tileSize);
        const maxRow = Math.floor((rect.y + rect.height - 1) / scene.tileSize);
        for (let r = minRow; r <= maxRow; r += 1) {
          for (let c = minColumn; c <= maxColumn; c += 1) {
            if (c < 0 || r < 0 || c >= scene.columns || r >= scene.rows || scene.collision[r * scene.columns + c] !== 0) {
              violations.push({ column, row });
            }
          }
        }
      }
    }
    console.info(`[valleyWalkability] clear 128x128 home plots: ${clearCount} of ${scene.columns * scene.rows} candidate anchor tiles.`);
    expect({ violations: violations.slice(0, 15), violationCount: violations.length, hasAnyClearPlot: clearCount > 0 })
      .toEqual({ violations: [], violationCount: 0, hasAnyClearPlot: true });
  });

  // Clearing-derived sub-assertion intentionally SKIPPED: the authored
  // CLEARINGS centres (`docs`-free, source-only constant in valleyScene.ts)
  // are not part of the public `ValleyScene` contract -- there is no field
  // exposing them, and hardcoding their pixel coordinates here would violate
  // the same rule this suite otherwise follows ("derive from the scene, not
  // from private authoring literals"). Per the task's own rule ("if not
  // derivable, skip that sub-assertion rather than faking it"), this
  // per-clearing check is omitted rather than approximated.
});

// ---------------------------------------------------------------------------
// Proof 10 -- determinism
// ---------------------------------------------------------------------------

describe("determinism", () => {
  it("createValleyScene() called twice yields identical collision arrays, prop lists, and crossings", () => {
    const a = createValleyScene();
    const b = createValleyScene();
    expect(Array.from(a.collision)).toEqual(Array.from(b.collision));
    expect(a.props).toEqual(b.props);
    expect(a.crossings).toEqual(b.crossings);
  });
});

// ---------------------------------------------------------------------------
// Proof 11 -- legal standing points are plentiful and well spread
// ---------------------------------------------------------------------------
//
// The stricter, honest predicate (proof 5'/6' establish it is stricter than
// the collision mask along riverbank edges) must not collapse to a handful of
// usable tiles crammed into one corner of the map -- a being population needs
// room to actually live in this valley.
describe("legal standing points are plentiful and well spread", () => {
  it("at least 500 legal standing points exist, spanning at least 3 of the 4 map quadrants", () => {
    const legalPoints = legalStandingPoints(scene);
    expect(legalPoints.length).toBeGreaterThanOrEqual(500);

    const halfWidth = scene.widthPixels / 2;
    const halfHeight = scene.heightPixels / 2;
    const quadrants = new Set<string>();
    for (const point of legalPoints) {
      const quadrant = `${point.x < halfWidth ? "west" : "east"}-${point.y < halfHeight ? "north" : "south"}`;
      quadrants.add(quadrant);
    }
    console.info(
      `[valleyWalkability] legalStandingPoints: ${legalPoints.length}; quadrants covered: ${[...quadrants].sort().join(", ")}.`,
    );
    expect(quadrants.size).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Proof 12 -- BRIDGES: a deck is walkable ground laid over blocked water, and
// the real navigator crosses the river ON it
// ---------------------------------------------------------------------------
//
// A ford and a line of stepping stones read as "you can probably get across
// here". A bridge reads as "people cross here". Structurally it is also the
// sharpest test this pilot can put to its own claim that the terrain is real
// rather than painted: a deck tile is walkable while the water immediately
// around it is not, and nothing about that is decorative -- if the mask were a
// picture, the navigator would refuse to step onto it.
//
// Nothing below is hardcoded against the authored spans. Every endpoint, deck
// tile and abutment is read off `scene.bridges`, which the scene derives from
// the same material field the art is derived from.

const bridges: readonly ValleyBridge[] = scene.bridges;

function deckKeys(bridge: ValleyBridge): Set<string> {
  return new Set(bridge.deck.map((tile) => tileKey(tile)));
}

/**
 * The furthest walkable tile within `reach` of an abutment, walking INLAND
 * along the bridge's own axis: a real place on that bank a being could stand,
 * far enough back that a bank-to-bank route is a journey and not one step.
 */
function inlandEndpoint(bridge: ValleyBridge, abutment: ValleyTileRef, reach: number): TileCoord {
  const nearestDeck = bridge.deck.reduce((best, candidate) => {
    const bestDistance = Math.hypot(best.column - abutment.column, best.row - abutment.row);
    const distance = Math.hypot(candidate.column - abutment.column, candidate.row - abutment.row);
    return distance < bestDistance ? candidate : best;
  });
  const stepColumn = Math.sign(abutment.column - nearestDeck.column);
  const stepRow = Math.sign(abutment.row - nearestDeck.row);
  let endpoint: TileCoord = { column: abutment.column, row: abutment.row };
  for (let step = 1; step <= reach; step += 1) {
    const candidate = {
      column: abutment.column + stepColumn * step,
      row: abutment.row + stepRow * step,
    };
    if (candidate.column < 0 || candidate.row < 0) break;
    if (candidate.column >= scene.columns || candidate.row >= scene.rows) break;
    if (scene.collision[candidate.row * scene.columns + candidate.column] === 1) break;
    endpoint = candidate;
  }
  return endpoint;
}

function bankToBank(bridge: ValleyBridge): { start: TileCoord; goal: TileCoord } {
  return {
    start: inlandEndpoint(bridge, bridge.abutments[0], 6),
    goal: inlandEndpoint(bridge, bridge.abutments[1], 6),
  };
}

describe("bridges", () => {
  it("(12a) three bridges span the river, and the ford and stepping-stone crossings are kept alongside them", () => {
    const kinds = new Map<string, number>();
    for (const crossing of scene.crossings) {
      kinds.set(crossing.kind, (kinds.get(crossing.kind) ?? 0) + 1);
    }
    console.info(
      `[valleyWalkability] crossings: ${[...kinds].map(([kind, count]) => `${count} ${kind}`).join(", ")}; `
      + `bridges: ${bridges.map((bridge) => `${bridge.id} (${bridge.axis}, ${bridge.deck.length} deck tiles)`).join("; ")}.`,
    );
    expect(bridges).toHaveLength(3);
    expect(kinds.get("bridge")).toBe(3);
    // mixed crossing types: the valley must not read as uniformly bridged
    expect(kinds.get("ford")).toBeGreaterThanOrEqual(1);
    expect(kinds.get("stepping-stones")).toBeGreaterThanOrEqual(1);
    // every bridge is a real span, not a one-tile hop
    for (const bridge of bridges) {
      expect(bridge.deck.length).toBeGreaterThanOrEqual(4);
      expect(bridge.abutments).toHaveLength(2);
    }
  });

  it("(12b) every deck tile is WALKABLE, reports the material `deck`, and spans ground that is blocking water", () => {
    const faults: Array<{
      bridge: string;
      tile: string;
      collision: number;
      material: string;
      bridgeDeck: boolean;
      deckOver: string | null;
      base: string;
    }> = [];
    const waterFamily = ["deepwater", "water", "shallow"];
    for (const bridge of bridges) {
      for (const ref of bridge.deck) {
        const index = ref.row * scene.columns + ref.column;
        const tile = scene.tiles[index];
        const spansBlockedGround = tile.deckOver !== null
          && BLOCKING_VALLEY_MATERIALS.includes(tile.deckOver);
        const paintedAsRiver = waterFamily.includes(tile.base);
        if (
          scene.collision[index] !== 0
          || tile.material !== "deck"
          || !tile.bridgeDeck
          || !spansBlockedGround
          || !paintedAsRiver
        ) {
          faults.push({
            bridge: bridge.id,
            tile: tileKey(ref),
            collision: scene.collision[index],
            material: tile.material,
            bridgeDeck: tile.bridgeDeck,
            deckOver: tile.deckOver,
            base: tile.base,
          });
        }
      }
    }
    const deckTileCount = bridges.reduce((total, bridge) => total + bridge.deck.length, 0);
    console.info(
      `[valleyWalkability] ${deckTileCount} bridge-deck tiles, every one walkable over water that is still painted beneath it.`,
    );
    expect({ faults, deckTileCount }).toEqual({ faults: [], deckTileCount });

    // and both abutments are walkable bank tiles the deck actually touches
    const abutmentFaults: string[] = [];
    for (const bridge of bridges) {
      const deck = deckKeys(bridge);
      for (const abutment of bridge.abutments) {
        const index = abutment.row * scene.columns + abutment.column;
        const touchesDeck = [
          { column: abutment.column + 1, row: abutment.row },
          { column: abutment.column - 1, row: abutment.row },
          { column: abutment.column, row: abutment.row + 1 },
          { column: abutment.column, row: abutment.row - 1 },
        ].some((neighbour) => deck.has(tileKey(neighbour)));
        if (scene.collision[index] !== 0 || !touchesDeck || scene.tiles[index].bridgeDeck) {
          abutmentFaults.push(`${bridge.id}:${tileKey(abutment)}`);
        }
      }
    }
    expect(abutmentFaults).toEqual([]);
  });

  it("(12c) THE CROSSING PROOF -- the real findNavigationPath, bank to bank, returns a route that traverses this bridge's deck tiles", () => {
    const results: Array<{
      bridge: string;
      start: TileCoord;
      goal: TileCoord;
      status: string;
      steps: number;
      deckTilesOnPath: number;
      deckTiles: number;
      offMask: number;
    }> = [];
    for (const bridge of bridges) {
      const { start, goal } = bankToBank(bridge);
      const result = findNavigationPath(grid, { start, goal });
      const deck = deckKeys(bridge);
      results.push({
        bridge: bridge.id,
        start,
        goal,
        status: result.status,
        steps: result.tiles.length,
        deckTilesOnPath: result.tiles.filter((tile) => deck.has(tileKey(tile))).length,
        deckTiles: bridge.deck.length,
        offMask: result.tiles.filter(
          (tile) => scene.collision[tile.row * scene.columns + tile.column] !== 0,
        ).length,
      });
    }
    for (const result of results) {
      console.info(
        `[valleyWalkability] ${result.bridge}: ${result.start.column},${result.start.row} -> `
        + `${result.goal.column},${result.goal.row} = ${result.status} in ${result.steps} tiles, `
        + `${result.deckTilesOnPath}/${result.deckTiles} of them ON the deck.`,
      );
    }
    // Not "a path exists" -- the returned path must actually run along the
    // deck, every deck tile of it, and never leave the walkable mask.
    expect(results.map((result) => ({
      bridge: result.bridge,
      status: result.status,
      crossedOnDeck: result.deckTilesOnPath === result.deckTiles,
      offMask: result.offMask,
    }))).toEqual(bridges.map((bridge) => ({
      bridge: bridge.id,
      status: "reached",
      crossedOnDeck: true,
      offMask: 0,
    })));
  });

  it("(12d) each bridge is load-bearing: closing only its own deck tiles severs or lengthens the same bank-to-bank route", () => {
    const findings: Array<{
      bridge: string;
      withBridge: number;
      withoutBridge: string;
      loadBearing: boolean;
    }> = [];
    for (const bridge of bridges) {
      const { start, goal } = bankToBank(bridge);
      const withBridge = findNavigationPath(grid, { start, goal });

      const closed = Uint8Array.from(scene.collision);
      for (const ref of bridge.deck) closed[ref.row * scene.columns + ref.column] = 1;
      const withoutBridge = findNavigationPath(
        { columns: scene.columns, rows: scene.rows, collision: closed },
        { start, goal },
      );

      const loadBearing = withoutBridge.status !== "reached"
        || withoutBridge.tiles.length > withBridge.tiles.length;
      findings.push({
        bridge: bridge.id,
        withBridge: withBridge.tiles.length,
        withoutBridge: withoutBridge.status === "reached"
          ? `${withoutBridge.tiles.length} tiles`
          : withoutBridge.status,
        loadBearing,
      });
    }
    for (const finding of findings) {
      console.info(
        `[valleyWalkability] ${finding.bridge}: ${finding.withBridge} tiles with the bridge, `
        + `${finding.withoutBridge} without it.`,
      );
    }
    expect(findings.filter((finding) => !finding.loadBearing)).toEqual([]);
  });

  it("(12e) terrain-as-exclusion-rects would make an east-west bridge unusable -- the same overhead-envelope defect that forbids the south bank", () => {
    const excluded = exclusionAwareGrid(grid, exclusions);
    const report: Array<{
      bridge: string;
      axis: string;
      deckTiles: number;
      rejectedByRectTest: number;
      closedByExclusionGrid: number;
      deckTilesOnRoute: number;
      routeStatus: string;
    }> = [];
    for (const bridge of bridges) {
      const deck = deckKeys(bridge);
      const rejected = bridge.deck.filter(
        (ref) => !presentationPointIsClear(tileCenter(ref), exclusions),
      ).length;
      const closed = bridge.deck.filter(
        (ref) => excluded.collision[ref.row * scene.columns + ref.column] === 1,
      ).length;
      const { start, goal } = bankToBank(bridge);
      const route = findNavigationPath(excluded, { start, goal });
      report.push({
        bridge: bridge.id,
        axis: bridge.axis,
        deckTiles: bridge.deck.length,
        rejectedByRectTest: rejected,
        closedByExclusionGrid: closed,
        deckTilesOnRoute: route.tiles.filter((tile) => deck.has(tileKey(tile))).length,
        routeStatus: route.status,
      });
    }
    for (const entry of report) {
      console.info(
        `[valleyWalkability] ${entry.bridge} (${entry.axis}) under terrain-as-rects: `
        + `${entry.rejectedByRectTest}/${entry.deckTiles} deck tiles rejected, `
        + `${entry.closedByExclusionGrid} closed by exclusionAwareGrid, route = ${entry.routeStatus} `
        + `with ${entry.deckTilesOnRoute} deck tiles used.`,
      );
    }

    const eastWest = report.filter((entry) => entry.axis === "east-west");
    const northSouth = report.filter((entry) => entry.axis === "north-south");
    // The phenomenon must actually occur, or the proof would be vacuous.
    expect(eastWest.length).toBeGreaterThan(0);

    // An east-west span lies broadside to the overhead envelope: every deck
    // tile whose north neighbour is open water is called blocked, the deck is
    // severed, and the route cannot use a single plank of the bridge.
    expect(eastWest.map((entry) => ({
      bridge: entry.bridge,
      deckSevered: entry.closedByExclusionGrid > 0,
      deckTilesOnRoute: entry.deckTilesOnRoute,
    }))).toEqual(eastWest.map((entry) => ({
      bridge: entry.bridge,
      deckSevered: true,
      deckTilesOnRoute: 0,
    })));

    // And the sharpest part of the finding: a north-south span is untouched,
    // because each of its deck tiles has ANOTHER deck tile to the north. The
    // rect model's verdict on a bridge therefore depends on which way the
    // bridge points - which is exactly the evidence that the instrument is
    // wrong for ground-plane terrain, not that the bridges are.
    expect(northSouth.length).toBeGreaterThan(0);
    expect(northSouth.map((entry) => ({
      bridge: entry.bridge,
      closedByExclusionGrid: entry.closedByExclusionGrid,
    }))).toEqual(northSouth.map((entry) => ({
      bridge: entry.bridge,
      closedByExclusionGrid: 0,
    })));
  });
});
