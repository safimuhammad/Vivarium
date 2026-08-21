/**
 * Adapters that connect the Nirvana river-valley PILOT scene to the exact
 * PRODUCTION consumers of a terrain walkability mask.
 *
 * `valleyScene.ts` derives one `collision` mask (row-major, 1 = blocked) that
 * is already shaped like the production `NavigationGrid`. That fact alone
 * does not prove the mask is real: it has to be the SAME mask the real
 * route-finder, the real scene-graph move veto, and the real placement
 * ledger would act on. This module supplies the two adapters production
 * code cannot infer on its own:
 *
 *   - `toNavigationGrid` — the pilot scene as a `NavigationGrid`, so
 *     `findNavigationPath` runs on it unmodified.
 *   - `terrainExclusionRects` — the same mask expressed as merged rects, so
 *     `presentationPointIsClear` / `presentationRouteIsClear` /
 *     `exclusionAwareGrid` (the renderer's rect-based move veto, "Seam B")
 *     can be asked the same question the collision grid answers ("Seam A").
 *
 * `valleyWalkability.test.ts` is the proof that both seams agree.
 */

import type { Rect, Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import {
  feetAnchoredVisualRect,
  presentationPointIsClear,
  shelterRenderRect,
} from "../../renderer2d/production/productionGeometry";
import type { ValleyScene } from "./valleyScene";

/**
 * Adapt the pilot scene's collision mask to the production `NavigationGrid`
 * shape.
 *
 * No copy is made of the collision buffer: the grid is a read-only view
 * over the scene's own `Uint8Array`, exactly as a real `RegionMapRecipeV1`
 * exposes its `grid` field.
 *
 * @param scene - The pilot valley scene.
 * @returns A `NavigationGrid` usable directly by `findNavigationPath`.
 */
export function toNavigationGrid(scene: ValleyScene): NavigationGrid {
  return {
    columns: scene.columns,
    rows: scene.rows,
    collision: scene.collision,
  };
}

interface RowRun {
  readonly row: number;
  readonly columnStart: number;
  /** Exclusive. */
  readonly columnEnd: number;
}

/**
 * Merge every blocked tile in the scene's collision mask into a small set of
 * maximal axis-aligned rects, in world pixels.
 *
 * `exclusionAwareGrid` (the production Seam-B consumer) is O(tiles x rects):
 * a naive one-rect-per-blocked-tile list would be pathological for a
 * terrain-dense scene like this valley. The merge is two greedy passes,
 * deterministic and independent of iteration order:
 *
 *   1. Per row, contiguous runs of blocked columns become one rect each
 *      (height one tile).
 *   2. Row-rects that share an identical column span and occupy adjacent
 *      rows are stacked into one taller rect.
 *
 * The result is not a globally-optimal maximal-rectangle decomposition, but
 * it is exact (its pixel union is identical to the blocked-tile union) and
 * small enough for `exclusionAwareGrid` to walk cheaply.
 *
 * @param scene - The pilot valley scene.
 * @returns The merged exclusion rects, sorted by (y, x) for determinism.
 */
export function terrainExclusionRects(scene: ValleyScene): readonly Rect[] {
  const { columns, rows, tileSize, collision } = scene;

  const rowRuns: RowRun[] = [];
  for (let row = 0; row < rows; row += 1) {
    let runStart: number | null = null;
    for (let column = 0; column <= columns; column += 1) {
      const blocked = column < columns && collision[row * columns + column] === 1;
      if (blocked && runStart === null) {
        runStart = column;
      } else if (!blocked && runStart !== null) {
        rowRuns.push({ row, columnStart: runStart, columnEnd: column });
        runStart = null;
      }
    }
  }

  const runsBySpan = new Map<string, RowRun[]>();
  for (const run of rowRuns) {
    const key = `${run.columnStart}:${run.columnEnd}`;
    const bucket = runsBySpan.get(key);
    if (bucket === undefined) runsBySpan.set(key, [run]);
    else bucket.push(run);
  }

  const rects: Rect[] = [];
  for (const bucket of runsBySpan.values()) {
    const sorted = [...bucket].sort((left, right) => left.row - right.row);
    let index = 0;
    while (index < sorted.length) {
      const start = sorted[index];
      let end = start;
      let next = index + 1;
      while (next < sorted.length && sorted[next].row === end.row + 1) {
        end = sorted[next];
        next += 1;
      }
      rects.push({
        x: start.columnStart * tileSize,
        y: start.row * tileSize,
        width: (start.columnEnd - start.columnStart) * tileSize,
        height: (end.row - start.row + 1) * tileSize,
      });
      index = next;
    }
  }

  return rects.sort((left, right) => left.y - right.y || left.x - right.x);
}

/**
 * The centre point, in world pixels, of every walkable tile.
 *
 * @param scene - The pilot valley scene.
 * @returns One `Vec2` per tile whose collision value is 0, in row-major
 *   scan order.
 */
export function walkablePoints(scene: ValleyScene): readonly Vec2[] {
  const points: Vec2[] = [];
  for (let row = 0; row < scene.rows; row += 1) {
    for (let column = 0; column < scene.columns; column += 1) {
      if (scene.collision[row * scene.columns + column] === 0) {
        points.push(tileCenter({ column, row }));
      }
    }
  }
  return points;
}

/**
 * Walkable tile centres that additionally satisfy the full standing-body
 * envelope test production placement uses.
 *
 * This is the stricter, honest predicate: a tile can be "walkable" by the
 * bare collision mask yet still be illegal to stand on once the complete
 * rendered body envelope (not just the feet point) is checked against the
 * terrain exclusion rects and against the world bounds.
 *
 * @param scene - The pilot valley scene.
 * @returns Every walkable tile centre whose standing envelope clears every
 *   terrain exclusion rect and stays inside the scene's pixel bounds.
 */
export function legalStandingPoints(scene: ValleyScene): readonly Vec2[] {
  const exclusions = terrainExclusionRects(scene);
  const legal: Vec2[] = [];
  for (const point of walkablePoints(scene)) {
    if (!presentationPointIsClear(point, exclusions)) continue;
    const envelope = feetAnchoredVisualRect(point);
    if (
      envelope.x < 0
      || envelope.y < 0
      || envelope.x + envelope.width > scene.widthPixels
      || envelope.y + envelope.height > scene.heightPixels
    ) continue;
    legal.push(point);
  }
  return legal;
}

/**
 * True iff every tile spanned by the real 128x128 shelter render footprint
 * at `plotTile` is walkable in the scene's collision mask.
 *
 * Uses the production `shelterRenderRect` unmodified, so the footprint's
 * true origin (the render rect starts at the plot tile's CENTRE, not its
 * top-left corner) is exactly what production would place.
 *
 * @param scene - The pilot valley scene.
 * @param plotTile - The candidate shelter plot's anchor tile.
 * @returns Whether every tile the footprint's pixels touch is in bounds and
 *   unblocked.
 */
export function homePlotIsClear(scene: ValleyScene, plotTile: TileCoord): boolean {
  const rect = shelterRenderRect(plotTile);
  const minColumn = Math.floor(rect.x / scene.tileSize);
  const maxColumn = Math.floor((rect.x + rect.width - 1) / scene.tileSize);
  const minRow = Math.floor(rect.y / scene.tileSize);
  const maxRow = Math.floor((rect.y + rect.height - 1) / scene.tileSize);

  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      if (column < 0 || row < 0 || column >= scene.columns || row >= scene.rows) return false;
      if (scene.collision[row * scene.columns + column] === 1) return false;
    }
  }
  return true;
}
