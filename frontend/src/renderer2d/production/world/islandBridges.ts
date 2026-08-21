/**
 * @fileoverview Deterministic plank/causeway bridge spans between adjacent regions' islands
 * (design of record: `docs/frontend/ATLAS_VIEW.md` §4).
 *
 * Anchors each bridge at the two islands' own nearest COAST CELLS -- read off the rasterised
 * silhouette (`islandMask.ts`'s `islandCoastPoints`), never a polygon vertex, a rect corner, or an
 * arbitrary region-centre line -- so a bridge reads as a short, purposeful crossing that lands on
 * real ground at both ends. The single longest crossing is promoted to a stone causeway: variety
 * that reads as history rather than decoration.
 *
 * Pure geometry: no canvas, no recipe, no rendering imports. The caller supplies each region's
 * already-resolved coast points (in shared sheet space) and the adjacency edges to bridge.
 *
 * {@link spansCrossingForeignLand} closes the layout's one known hazard as an assertable
 * invariant: under the ring embedding (`regionSheetLayout.ts`) no chord can pass through a third
 * island, because every island sits on the ring and the interior is empty. The check exists to
 * keep it that way.
 */

import type { IslandPoint } from "./islandMask";

/** Which kind of crossing a span is drawn as. */
export type BridgeKind = "plank" | "causeway";

/** One bridge, anchored at the two islands' own nearest coast cells. */
export interface BridgeSpan {
  readonly regionA: string;
  readonly regionB: string;
  readonly a: IslandPoint;
  readonly b: IslandPoint;
  readonly lengthPx: number;
  /** `"causeway"` for the single longest crossing on the sheet, `"plank"` for every other. */
  readonly kind: BridgeKind;
}

/**
 * Finds the closest pair of points between two coastlines. Brute force over every point pair; the
 * caller is expected to hand in a strided sample of coast cells (see `islandMask.ts`'s
 * `islandCoastPoints`), which keeps this a few thousand comparisons per bridge. Ties break toward
 * the first pair found in iteration order; since both inputs' own orders are deterministic, the
 * result never varies between calls for the same inputs.
 *
 * @param coastA - The first island's coast points, in shared sheet space.
 * @param coastB - The second island's coast points, in shared sheet space.
 * @returns The nearest point on each coastline, and the distance between them.
 * @throws {RangeError} If either coastline is empty.
 */
export function nearestCoastPoints(
  coastA: readonly IslandPoint[],
  coastB: readonly IslandPoint[],
): Readonly<{ a: IslandPoint; b: IslandPoint; lengthPx: number }> {
  if (coastA.length === 0 || coastB.length === 0) {
    throw new RangeError("nearestCoastPoints: both coastlines must have at least one point.");
  }
  let bestA = coastA[0] as IslandPoint;
  let bestB = coastB[0] as IslandPoint;
  let bestSquared = Number.POSITIVE_INFINITY;
  for (const a of coastA) {
    for (const b of coastB) {
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const squared = dx * dx + dy * dy;
      if (squared < bestSquared) {
        bestSquared = squared;
        bestA = a;
        bestB = b;
      }
    }
  }
  return { a: bestA, b: bestB, lengthPx: Math.sqrt(bestSquared) };
}

/**
 * Resolves a region id to its island's coast points in shared sheet space, or `null` if it is
 * currently unknown/undrawable (e.g. no mask built yet for that region).
 */
export type CoastForRegion = (regionId: string) => readonly IslandPoint[] | null;

/**
 * Builds one {@link BridgeSpan} per adjacency edge whose both endpoints have a known coastline,
 * deduplicating symmetric pairs (`a,b` and `b,a`) and skipping self-pairs and edges naming an
 * unresolvable region -- so callers can pass a raw connections list (e.g. `config/world.yaml`'s
 * per-region `connections` arrays, which list every edge from both ends) in directly without
 * pre-cleaning it.
 *
 * @param coastFor - Resolves a region id to its coast points, in shared sheet space.
 * @param adjacency - Pairs of adjacent region ids, in any order, possibly duplicated/reversed.
 * @returns One span per unique, resolvable adjacency edge, in a stable order (sorted by the pair's
 *   own two ids, ascending) -- independent of the order `adjacency` was supplied in. The single
 *   longest span is marked `"causeway"`; ties break toward the earlier span in that stable order.
 */
export function computeBridgeSpans(
  coastFor: CoastForRegion,
  adjacency: ReadonlyArray<readonly [string, string]>,
): readonly BridgeSpan[] {
  const seenPairKeys = new Set<string>();
  const uniquePairs: Array<readonly [string, string]> = [];
  for (const [rawA, rawB] of adjacency) {
    if (rawA === rawB) continue;
    const [a, b] = rawA < rawB ? [rawA, rawB] : [rawB, rawA];
    const key = `${a}|${b}`;
    if (seenPairKeys.has(key)) continue;
    seenPairKeys.add(key);
    uniquePairs.push([a, b]);
  }
  uniquePairs.sort(([aLeft, bLeft], [aRight, bRight]) => {
    if (aLeft !== aRight) return aLeft < aRight ? -1 : 1;
    if (bLeft !== bRight) return bLeft < bRight ? -1 : 1;
    return 0;
  });

  const spans: BridgeSpan[] = [];
  for (const [regionA, regionB] of uniquePairs) {
    const coastA = coastFor(regionA);
    const coastB = coastFor(regionB);
    if (coastA === null || coastB === null || coastA.length === 0 || coastB.length === 0) continue;
    const nearest = nearestCoastPoints(coastA, coastB);
    spans.push({
      regionA,
      regionB,
      a: nearest.a,
      b: nearest.b,
      lengthPx: nearest.lengthPx,
      kind: "plank",
    });
  }
  let longestIndex = -1;
  let longest = -1;
  spans.forEach((span, index) => {
    if (span.lengthPx > longest) {
      longest = span.lengthPx;
      longestIndex = index;
    }
  });
  if (longestIndex >= 0) {
    spans[longestIndex] = { ...(spans[longestIndex] as BridgeSpan), kind: "causeway" };
  }
  return spans;
}

/** Whether a point, in shared sheet space, sits on a given region's LAND. */
export type LandAtSheetPoint = (regionId: string, point: IslandPoint) => boolean;

/**
 * The layout invariant, as an assertable check: **no bridge span may pass over a third island's
 * land.** Samples each span at a fixed cadence (deterministic; endpoints excluded, since a span
 * legitimately touches its own two coasts) and reports every span that crosses a region other than
 * its own two endpoints.
 *
 * Under the single-ring adjacency-cycle embedding this returns empty by construction -- every
 * island sits on the ring, every chord passes through the empty centre. The check exists so that a
 * future layout change cannot silently reintroduce the hazard.
 *
 * @param spans - The spans to check.
 * @param regionIds - Every region on the sheet (the potential "third islands").
 * @param landAt - Whether a sheet-space point is on a given region's land.
 * @param samples - How many interior points to test per span. Defaults to `96`.
 * @returns Every offending span, in input order (empty when the invariant holds).
 */
export function spansCrossingForeignLand(
  spans: readonly BridgeSpan[],
  regionIds: readonly string[],
  landAt: LandAtSheetPoint,
  samples = 96,
): readonly BridgeSpan[] {
  const offenders: BridgeSpan[] = [];
  const steps = Math.max(2, Math.floor(samples));
  for (const span of spans) {
    let crosses = false;
    for (let index = 1; index < steps && !crosses; index += 1) {
      const t = index / steps;
      const point = {
        x: span.a.x + (span.b.x - span.a.x) * t,
        y: span.a.y + (span.b.y - span.a.y) * t,
      };
      for (const regionId of regionIds) {
        if (regionId === span.regionA || regionId === span.regionB) continue;
        if (landAt(regionId, point)) {
          crosses = true;
          break;
        }
      }
    }
    if (crosses) offenders.push(span);
  }
  return offenders;
}
