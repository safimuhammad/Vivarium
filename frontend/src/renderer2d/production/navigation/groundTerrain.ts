/**
 * @fileoverview The seam by which GROUND terrain reaches movement legality.
 *
 * A world contains two completely different kinds of "you may not be here",
 * and the pilot proved — twice — that collapsing them into one instrument
 * breaks the world:
 *
 *   - **Objects** (home footprints, tall scenic landmarks) are things a body
 *     would OCCLUDE or collide with in the picture. Their correct instrument
 *     is a rendered-rect test against the being's whole standing envelope
 *     (`presentationPointIsClear` / `presentationRouteIsClear`), because the
 *     question really is "would this body overlap that structure".
 *
 *   - **Ground** (water, cliff, thicket, boulders, a bridge deck) is terrain a
 *     body merely may not put its FEET on. Its correct instrument is the tile
 *     the feet land in — `grid.collision` — and nothing else.
 *
 * Using the object instrument on ground is not a conservative approximation,
 * it is a different rule. `STANDING_HUMAN_VISUAL_ENVELOPE` is 22x48 anchored
 * 46px ABOVE the feet, so a full-tile terrain exclusion rect rejects every
 * walkable tile that has blocked ground to its NORTH. Measured on the river
 * valley pilot: 151 of 827 walkable tiles (18%), every one explained by a
 * north neighbour, zero unexplained — in a river valley that forbids the whole
 * south bank. Worse, it makes a bridge's usability depend on its ORIENTATION:
 * the pilot's east–west bridge loses 6 of its 7 deck tiles and its bank-to-bank
 * route becomes `unreachable`, while two north–south bridges are untouched
 * purely because each of their deck tiles has another deck tile above it.
 * See `.superpowers/sdd/nirvana-pilot-report.md` §4 and "Bridges" §B4.
 *
 * So: **ground terrain composes into `grid.collision`** ({@link
 * composeGroundTerrainCollision}), and every consumer that already honours
 * collision — `findNavigationPath`, `PlacementLedger`'s `isOpenTile`,
 * `contactTileIsOpen`, `homeContestSystem` — honours terrain for free. The one
 * consumer that did NOT was the scene graph's apply-time move/reposition gate,
 * which tested only rect exclusions; {@link groundTerrainRouteIsOpen} and
 * {@link groundTerrainPointIsOpen} are what it now asks instead for ground.
 *
 * Terrain-as-rects remains valid as a DIAGNOSTIC in exactly one direction —
 * it must never call a blocked tile clear (zero false-opens, proven on the
 * pilot scene) — and {@link groundTerrainCollisionViolations} is the invariant
 * check that a declared ground mask really did reach collision, the same shape
 * as the existing `waterVoidMask => collision` recipe invariant.
 */

import type { Vec2 } from "../../contracts";
import type { TileCoord } from "../../map/regionMap";
import { navigationTileForFeet } from "../productionGeometry";
import { navigationTileIndex, wrapNavigationTile, type NavigationGrid } from "./navigation";

/**
 * One layer of ground a body may not stand on, row-major, `1` = blocked.
 *
 * Deliberately shaped like the recipe masks that already exist
 * (`waterVoidMask`, `pathMask`, `soilMask`) so a region's terrain authoring can
 * publish its blocking materials as one of these and compose it into collision
 * without inventing a second geometry vocabulary.
 */
export interface GroundTerrainMask {
  readonly columns: number;
  readonly rows: number;
  readonly blocked: Uint8Array;
}

/**
 * The tile whose area contains an exact feet point.
 *
 * Delegates to `productionGeometry.navigationTileForFeet` rather than
 * re-deriving the projection: two answers to "which tile is this body standing
 * in" is the exact class of defect this seam exists to remove.
 */
export function groundTerrainTileForPoint(point: Vec2): TileCoord {
  return navigationTileForFeet(point);
}

/**
 * True when a tile is inside the grid and its ground is unblocked.
 *
 * On a toroidal grid the tile is first canonicalised, so a being mid-crossing — whose
 * unrolled route waypoints legitimately sit outside the region rect — is judged against
 * the ground it is actually standing on rather than being called "off the map".
 */
export function groundTerrainTileIsOpen(grid: NavigationGrid, tile: TileCoord): boolean {
  const candidate = wrapNavigationTile(grid, tile);
  if (candidate.column < 0 || candidate.row < 0
    || candidate.column >= grid.columns || candidate.row >= grid.rows) {
    return false;
  }
  return grid.collision[navigationTileIndex(grid, candidate)] === 0;
}

/** True when the tile a body's feet would land in is open ground. */
export function groundTerrainPointIsOpen(grid: NavigationGrid, point: Vec2): boolean {
  return groundTerrainTileIsOpen(grid, groundTerrainTileForPoint(point));
}

/**
 * The first waypoint whose DESTINATION TILE is blocked ground, or `null` when
 * a whole authored route stays on open ground.
 *
 * The mover's own current tile is deliberately NOT tested: a being that has
 * somehow ended up standing somewhere it should not be must still be able to
 * walk OUT rather than be stranded there forever — the same exemption
 * `exclusionAwareGrid` already makes for its mover tile.
 *
 * Every waypoint is treated as the destination of its own segment, which is
 * exact rather than approximate for the routes production actually authors:
 * `findNavigationPath` emits `tiles.map(tileCenter)` — one waypoint per tile,
 * cardinally adjacent — so "every waypoint tile is open" is precisely "every
 * tile of the route is open". No swept envelope is involved, which is the
 * whole point: the envelope's 46px overhead is what forbade the south bank.
 *
 * @param grid - The active region's navigation grid.
 * @param waypoints - The authored route, in exact feet pixels.
 * @returns The first blocked destination tile, or `null` if the route is clear.
 */
export function firstBlockedGroundTile(
  grid: NavigationGrid,
  waypoints: readonly Vec2[],
): TileCoord | null {
  for (const waypoint of waypoints) {
    const tile = groundTerrainTileForPoint(waypoint);
    if (!groundTerrainTileIsOpen(grid, tile)) return tile;
  }
  return null;
}

/** True when every destination tile on an authored route is open ground. */
export function groundTerrainRouteIsOpen(
  grid: NavigationGrid,
  waypoints: readonly Vec2[],
): boolean {
  return firstBlockedGroundTile(grid, waypoints) === null;
}

/**
 * Route one or more ground-terrain masks into a collision buffer.
 *
 * This is the seam itself: terrain authoring declares which ground blocks, and
 * the result is a `grid.collision` buffer — never an exclusion-rect list. The
 * composition is a union (a tile blocked by ANY layer is blocked) and never
 * re-opens a tile the base collision already closed, so a mask can only ever
 * be conservative with respect to the grid it is composed onto.
 *
 * @param base - The collision buffer to compose onto; not mutated.
 * @param masks - The ground layers to union in.
 * @returns A new collision buffer, row-major, `1` = blocked.
 * @throws If any mask's dimensions disagree with the base grid.
 */
export function composeGroundTerrainCollision(
  base: NavigationGrid,
  masks: readonly GroundTerrainMask[],
): Uint8Array {
  const collision = Uint8Array.from(base.collision);
  for (const mask of masks) {
    if (mask.columns !== base.columns || mask.rows !== base.rows
      || mask.blocked.length !== base.columns * base.rows) {
      throw new Error("ground terrain mask dimensions must match the navigation grid");
    }
    for (let index = 0; index < collision.length; index += 1) {
      if (mask.blocked[index] !== 0) collision[index] = 1;
    }
  }
  return collision;
}

/**
 * Every tile a ground mask declares blocked that the grid's collision does NOT
 * — i.e. terrain that never reached the seam and would therefore be walked
 * straight through.
 *
 * The exact shape of the pre-existing `waterVoidMask => collision` recipe
 * invariant, generalised so any authored ground layer can be held to it.
 *
 * @returns The offending tiles in row-major order; empty when the invariant holds.
 */
export function groundTerrainCollisionViolations(
  grid: NavigationGrid,
  mask: GroundTerrainMask,
): readonly TileCoord[] {
  if (mask.columns !== grid.columns || mask.rows !== grid.rows
    || mask.blocked.length !== grid.columns * grid.rows) {
    throw new Error("ground terrain mask dimensions must match the navigation grid");
  }
  const violations: TileCoord[] = [];
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      const index = row * grid.columns + column;
      if (mask.blocked[index] !== 0 && grid.collision[index] !== 1) {
        violations.push({ column, row });
      }
    }
  }
  return violations;
}
