/**
 * P1 — THE COLLISION SEAM, proven on the pilot's own scenes.
 *
 * `valleyWalkability.test.ts` (22 proofs, unchanged) established two failure
 * modes of feeding GROUND terrain to the scene graph as exclusion rects:
 *
 *   - the SOUTH BANK is forbidden — the standing envelope hangs 46px above the
 *     feet, so every walkable tile with blocked ground to its NORTH is rejected
 *     (151 of 827 walkable tiles, every one explained by a north neighbour);
 *   - a bridge's usability depends on its ORIENTATION — the east–west span
 *     loses 6 of 7 deck tiles and its bank-to-bank route becomes `unreachable`,
 *     while the two north–south spans are untouched.
 *
 * This suite proves both failures DISAPPEAR under the shipped seam
 * (`renderer2d/production/navigation/groundTerrain.ts`, consulted by
 * `ProductionSceneGraph.applySceneCommands`' move/reposition gate), that the
 * safety-critical direction still holds (zero false-opens — nothing walks
 * through water), and that OBJECT exclusions (home footprints, scenic
 * landmarks) keep their existing rect treatment.
 *
 * Every function under test is the real production one. Nothing here is a
 * re-implementation of the seam.
 */

import { describe, expect, it } from "vitest";
import type { Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import { findNavigationPath } from "../../renderer2d/production/navigation/navigation";
import {
  composeGroundTerrainCollision,
  firstBlockedGroundTile,
  groundTerrainCollisionViolations,
  groundTerrainPointIsOpen,
  groundTerrainRouteIsOpen,
  groundTerrainTileIsOpen,
} from "../../renderer2d/production/navigation/groundTerrain";
import {
  homeFootprintExclusionRects,
  presentationPointIsClear,
  presentationRouteIsClear,
} from "../../renderer2d/production/productionGeometry";
import { exclusionAwareGrid } from "../../presentation/choreography/interactionContact";
import { BLOCKING_VALLEY_MATERIALS } from "./valleyMaterials";
import {
  createValleyScene,
  type ValleyBridge,
  type ValleyScene,
  type ValleyTileRef,
} from "./valleyScene";
import {
  homePlotIsClear,
  terrainExclusionRects,
  toNavigationGrid,
} from "./valleyWalkability";

// ---------------------------------------------------------------------------
// Shared fixture: the pilot's own scene, its collision grid, and the SAME
// merged terrain exclusion rects the 22 existing proofs measured.
// ---------------------------------------------------------------------------

const scene: ValleyScene = createValleyScene();
const grid = toNavigationGrid(scene);
const terrainRects = terrainExclusionRects(scene);

function tileKey(tile: Readonly<{ column: number; row: number }>): string {
  return `${tile.column},${tile.row}`;
}

const walkableTiles: TileCoord[] = [];
const blockedTiles: TileCoord[] = [];
for (let row = 0; row < scene.rows; row += 1) {
  for (let column = 0; column < scene.columns; column += 1) {
    const target = scene.collision[row * scene.columns + column] === 0 ? walkableTiles : blockedTiles;
    target.push({ column, row });
  }
}

/** Every walkable tile the RECT instrument refuses, with the reason measured. */
const rectOverRejections = walkableTiles
  .filter((tile) => !presentationPointIsClear(tileCenter(tile), terrainRects))
  .map((tile) => ({
    ...tile,
    northBlocked: tile.row > 0
      && scene.collision[(tile.row - 1) * scene.columns + tile.column] === 1,
  }));

// ---------------------------------------------------------------------------
// S1 — THE SOUTH BANK. The rect instrument's over-rejections vanish.
// ---------------------------------------------------------------------------

describe("S1 the south-bank rejection disappears under the collision seam", () => {
  it("every walkable tile terrain-as-rects refuses is ACCEPTED by the destination-tile check", () => {
    const stillRefused = rectOverRejections.filter(
      (tile) => !groundTerrainPointIsOpen(grid, tileCenter(tile)),
    );
    console.info(
      `[terrainSeam] terrain-as-rects refuses ${rectOverRejections.length} of `
      + `${walkableTiles.length} walkable tiles (${
        (rectOverRejections.length / walkableTiles.length * 100).toFixed(1)
      }%); every one has a blocked north neighbour. `
      + `Under the destination-tile seam ${rectOverRejections.length - stillRefused.length} `
      + `of ${rectOverRejections.length} are accepted, ${stillRefused.length} still refused.`,
    );
    // The phenomenon must occur, or the proof would be vacuous.
    expect(rectOverRejections.length).toBeGreaterThan(0);
    // ...and it must be entirely the overhead-envelope effect, not a mask bug.
    expect(rectOverRejections.filter((tile) => !tile.northBlocked)).toEqual([]);
    // The seam recovers ALL of them.
    expect(stillRefused).toEqual([]);
  });

  it("a whole south-bank walk is legal under the seam and illegal under the rects", () => {
    // The longest east–west run of walkable tiles that sits directly below
    // blocked ground: a real south bank, chosen from the scene rather than
    // hardcoded.
    let best: { row: number; from: number; to: number } | null = null;
    for (let row = 1; row < scene.rows; row += 1) {
      let runStart: number | null = null;
      for (let column = 0; column <= scene.columns; column += 1) {
        const onBank = column < scene.columns
          && scene.collision[row * scene.columns + column] === 0
          && scene.collision[(row - 1) * scene.columns + column] === 1;
        if (onBank && runStart === null) runStart = column;
        else if (!onBank && runStart !== null) {
          if (best === null || column - runStart > best.to - best.from + 1) {
            best = { row, from: runStart, to: column - 1 };
          }
          runStart = null;
        }
      }
    }
    expect(best, "the scene contains a south bank").not.toBeNull();
    const bank = best!;
    const waypoints: Vec2[] = [];
    for (let column = bank.from; column <= bank.to; column += 1) {
      waypoints.push(tileCenter({ column, row: bank.row }));
    }
    console.info(
      `[terrainSeam] south bank: row ${bank.row}, columns ${bank.from}-${bank.to} `
      + `(${waypoints.length} tiles), every tile with blocked ground directly north.`,
    );
    expect(waypoints.length).toBeGreaterThan(1);

    // Terrain-as-rects forbids the whole walk...
    expect(presentationRouteIsClear(waypoints[0], waypoints.slice(1), terrainRects)).toBe(false);
    // ...and forbids standing on EVERY tile of it.
    expect(waypoints.filter((point) => presentationPointIsClear(point, terrainRects))).toEqual([]);
    // The shipped seam allows the whole walk.
    expect(groundTerrainRouteIsOpen(grid, waypoints)).toBe(true);
    expect(firstBlockedGroundTile(grid, waypoints)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S2 — BRIDGE ORIENTATION. A bridge's usability stops depending on its axis.
// ---------------------------------------------------------------------------

const bridges: readonly ValleyBridge[] = scene.bridges;

function deckKeys(bridge: ValleyBridge): Set<string> {
  return new Set(bridge.deck.map(tileKey));
}

/** The furthest walkable tile within `reach` of an abutment, walking inland. */
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

describe("S2 bridge usability stops depending on orientation", () => {
  it("every bridge crosses under the seam, and the rect model's axis asymmetry is gone", () => {
    const rectGrid = exclusionAwareGrid(grid, terrainRects);
    const report = bridges.map((bridge) => {
      const deck = deckKeys(bridge);
      const { start, goal } = bankToBank(bridge);

      // Seam A — the shipped seam. The real navigator over `grid.collision`,
      // then the real destination-tile gate over the route it returned.
      const seamRoute = findNavigationPath(grid, { start, goal });
      const seamDeckTiles = seamRoute.tiles.filter((tile) => deck.has(tileKey(tile))).length;
      const seamGateAccepts = groundTerrainRouteIsOpen(grid, seamRoute.waypoints);

      // Seam B — terrain as exclusion rects, the model this task replaces.
      const rectRoute = findNavigationPath(rectGrid, { start, goal });
      return {
        bridge: bridge.id,
        axis: bridge.axis,
        deckTiles: bridge.deck.length,
        seamStatus: seamRoute.status,
        seamDeckTiles,
        seamGateAccepts,
        rectStatus: rectRoute.status,
        rectDeckTiles: rectRoute.tiles.filter((tile) => deck.has(tileKey(tile))).length,
        rectDeckRejected: bridge.deck.filter(
          (ref) => !presentationPointIsClear(tileCenter(ref), terrainRects),
        ).length,
      };
    });
    for (const entry of report) {
      console.info(
        `[terrainSeam] ${entry.bridge} (${entry.axis}, ${entry.deckTiles} deck tiles): `
        + `SEAM route=${entry.seamStatus} deckUsed=${entry.seamDeckTiles} gate=${
          entry.seamGateAccepts ? "accepts" : "REFUSES"
        } | RECTS route=${entry.rectStatus} deckUsed=${entry.rectDeckTiles} `
        + `deckRejected=${entry.rectDeckRejected}/${entry.deckTiles}.`,
      );
    }

    const eastWest = report.filter((entry) => entry.axis === "east-west");
    const northSouth = report.filter((entry) => entry.axis === "north-south");
    // Both axes must be present, or the asymmetry proof is vacuous.
    expect(eastWest.length).toBeGreaterThan(0);
    expect(northSouth.length).toBeGreaterThan(0);

    // The failure being repaired: under rects the east–west span is severed
    // and unusable, while a north–south span is untouched.
    expect(eastWest.map((entry) => ({
      bridge: entry.bridge,
      rectDeckSevered: entry.rectDeckRejected > 0,
      rectDeckTiles: entry.rectDeckTiles,
    }))).toEqual(eastWest.map((entry) => ({
      bridge: entry.bridge,
      rectDeckSevered: true,
      rectDeckTiles: 0,
    })));
    expect(northSouth.map((entry) => entry.rectDeckRejected))
      .toEqual(northSouth.map(() => 0));

    // The repair: under the shipped seam EVERY bridge, on EITHER axis, is
    // reached, uses all of its own deck tiles, and is accepted by the gate.
    expect(report.map((entry) => ({
      bridge: entry.bridge,
      seamStatus: entry.seamStatus,
      seamDeckTiles: entry.seamDeckTiles,
      seamGateAccepts: entry.seamGateAccepts,
    }))).toEqual(report.map((entry) => ({
      bridge: entry.bridge,
      seamStatus: "reached",
      seamDeckTiles: entry.deckTiles,
      seamGateAccepts: true,
    })));
  });

  it("no deck tile is refused by the destination-tile gate, on either axis", () => {
    const refused = bridges.flatMap((bridge) => bridge.deck
      .filter((ref) => !groundTerrainTileIsOpen(grid, ref))
      .map((ref) => `${bridge.id}:${tileKey(ref)}`));
    const deckTiles = bridges.reduce((total, bridge) => total + bridge.deck.length, 0);
    console.info(`[terrainSeam] ${deckTiles} deck tiles, ${refused.length} refused by the seam.`);
    expect(deckTiles).toBeGreaterThan(0);
    expect(refused).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S3 — ZERO FALSE-OPENS still holds. Nothing walks through water.
// ---------------------------------------------------------------------------

describe("S3 the safety-critical direction is unchanged", () => {
  it("the seam refuses every blocked tile, as a point and as a route destination", () => {
    const falseOpens = blockedTiles.filter((tile) => {
      const point = tileCenter(tile);
      return groundTerrainPointIsOpen(grid, point) || groundTerrainRouteIsOpen(grid, [point]);
    });
    console.info(
      `[terrainSeam] ${blockedTiles.length} blocked tiles, ${falseOpens.length} false-opens `
      + `under the seam.`,
    );
    expect(blockedTiles.length).toBeGreaterThan(0);
    expect(falseOpens).toEqual([]);
  });

  it("a route that ends in the river is refused, and the refusal names the offending tile", () => {
    // A walkable bank tile orthogonally adjacent to blocked water: the
    // shortest possible illegal step, derived from the scene.
    let bank: TileCoord | null = null;
    let water: TileCoord | null = null;
    for (const tile of walkableTiles) {
      const neighbours = [
        { column: tile.column, row: tile.row - 1 },
        { column: tile.column + 1, row: tile.row },
        { column: tile.column, row: tile.row + 1 },
        { column: tile.column - 1, row: tile.row },
      ];
      const blockedNeighbour = neighbours.find((candidate) =>
        candidate.column >= 0 && candidate.row >= 0
        && candidate.column < scene.columns && candidate.row < scene.rows
        && scene.collision[candidate.row * scene.columns + candidate.column] === 1);
      if (blockedNeighbour !== undefined) {
        bank = tile;
        water = blockedNeighbour;
        break;
      }
    }
    expect(bank, "the scene has a bank tile beside blocked ground").not.toBeNull();
    const waypoints = [tileCenter(bank!), tileCenter(water!)];
    expect(groundTerrainRouteIsOpen(grid, waypoints)).toBe(false);
    expect(firstBlockedGroundTile(grid, waypoints)).toEqual(water);
    // And the mover's own tile is never the reason: standing where he already
    // stands is always legal, so nobody can be stranded.
    expect(groundTerrainRouteIsOpen(grid, [tileCenter(bank!)])).toBe(true);
  });

  it("the rect instrument remains a valid diagnostic: it never calls a blocked tile clear", () => {
    const falseOpens = blockedTiles.filter(
      (tile) => presentationPointIsClear(tileCenter(tile), terrainRects),
    );
    expect(falseOpens).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S4 — OBJECTS keep the rect instrument. The two halves stay separate.
// ---------------------------------------------------------------------------

describe("S4 home footprints and landmarks keep their exclusion-rect treatment", () => {
  it("a home footprint still refuses a standing point the ground seam calls open", () => {
    // A plot on open ground, so the only thing that can refuse the tiles under
    // the house is the OBJECT instrument. `homePlotIsClear` is the pilot's own
    // predicate over the real `shelterRenderRect`, so the footprint geometry
    // stays single-authority.
    const plotTile = walkableTiles.find((tile) => homePlotIsClear(scene, tile));
    expect(plotTile, "the scene has a clear 128x128 plot").toBeDefined();
    const plot = tileCenter(plotTile!);
    const exclusions = homeFootprintExclusionRects(plot);
    expect(exclusions.length).toBeGreaterThan(0);

    // The middle of the roof: open GROUND, refused as an OBJECT.
    const underRoof = { x: plot.x + 16, y: plot.y + 16 };
    expect(groundTerrainPointIsOpen(grid, underRoof)).toBe(true);
    expect(presentationPointIsClear(underRoof, exclusions)).toBe(false);

    // The door threshold is still carved out of the object exclusion, as it
    // always has been -- found by search rather than hardcoded, so the
    // production door geometry stays the single authority.
    let doorPoint: Vec2 | null = null;
    for (let dy = 0; dy < 128 && doorPoint === null; dy += 1) {
      for (let dx = 0; dx < 128; dx += 1) {
        const candidate = { x: plot.x + dx, y: plot.y + dy };
        if (presentationPointIsClear(candidate, exclusions)) {
          doorPoint = candidate;
          break;
        }
      }
    }
    expect(doorPoint, "the door threshold stays open on the object path").not.toBeNull();
    console.info(
      `[terrainSeam] home plot at (${plot.x}, ${plot.y}): ${exclusions.length} object rects; `
      + `roof refused by the object instrument, ground seam neutral, door open at `
      + `(${doorPoint!.x}, ${doorPoint!.y}).`,
    );
  });
});

// ---------------------------------------------------------------------------
// S5 — THE SEAM ITSELF. Ground terrain composes into `grid.collision`.
// ---------------------------------------------------------------------------

describe("S5 ground terrain reaches grid.collision, byte for byte", () => {
  it("composing the pilot's blocking materials reproduces the scene's own collision buffer", () => {
    const blockingMaterials = new Set<string>(BLOCKING_VALLEY_MATERIALS);
    const blocked = new Uint8Array(scene.columns * scene.rows);
    for (const tile of scene.tiles) {
      const index = tile.row * scene.columns + tile.column;
      if (blockingMaterials.has(tile.material)) blocked[index] = 1;
    }
    // Blocking props (tree trunks, boulders) are ground too.
    for (const prop of scene.props) {
      if (prop.blocks) blocked[prop.tile.row * scene.columns + prop.tile.column] = 1;
    }
    const mask = { columns: scene.columns, rows: scene.rows, blocked };
    const empty = {
      columns: scene.columns,
      rows: scene.rows,
      collision: new Uint8Array(scene.columns * scene.rows),
    };
    const composed = composeGroundTerrainCollision(empty, [mask]);
    expect([...composed]).toEqual([...scene.collision]);
    // And the invariant holds against the scene's own grid: no declared
    // blocking ground failed to reach collision.
    expect(groundTerrainCollisionViolations(grid, mask)).toEqual([]);
  });

  it("the invariant BITES: a blocking layer left out of collision is reported", () => {
    const blocked = new Uint8Array(scene.columns * scene.rows);
    const openTile = walkableTiles[0];
    blocked[openTile.row * scene.columns + openTile.column] = 1;
    const violations = groundTerrainCollisionViolations(
      grid,
      { columns: scene.columns, rows: scene.rows, blocked },
    );
    expect(violations).toEqual([openTile]);
  });

  it("composition is a union that never re-opens ground the base grid already closed", () => {
    const emptyMask = {
      columns: scene.columns,
      rows: scene.rows,
      blocked: new Uint8Array(scene.columns * scene.rows),
    };
    expect([...composeGroundTerrainCollision(grid, [emptyMask])]).toEqual([...scene.collision]);
    expect(() => composeGroundTerrainCollision(grid, [{
      columns: scene.columns + 1,
      rows: scene.rows,
      blocked: new Uint8Array((scene.columns + 1) * scene.rows),
    }])).toThrow(/dimensions must match/i);
  });
});
