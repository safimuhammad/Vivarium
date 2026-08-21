import {
  PRODUCTION_ASSET_MANIFEST,
  PRODUCTION_FACINGS,
  PRODUCTION_RIG_IDS,
  requireHumanClip,
} from "../../renderer2d/production/assets/productionManifest";

type RoutePoint = Readonly<{ x: number; y: number }>;

/**
 * Ceiling (ms) for a choreography definition's route-bearing scene duration
 * (`duration.maxMs`) and, for definitions that additionally enforce a
 * "reject this route as physically staged past this budget" cutoff (see
 * `physicalRouteTiming` in `bondCombat.ts`), for that cutoff too.
 *
 * FAILURE MODE THIS PREVENTS: a ceiling tuned against hand-placed unit
 * fixtures (agents 1-2 tiles apart) reads as "plenty of margin" in review,
 * but the live placement pipeline (`PlacementLedger.stagingPlacement`)
 * hashes every agent to its own staging anchor at least `STAGING_POINT_STEP`
 * (71px) apart -- routinely 160px+ (5 tiles) in practice. Any definition
 * whose worst-case realistic route budget can exceed a too-tight ceiling
 * silently falls back to `physical: false`, even though both participants
 * are genuinely co-located, on-screen, and a legal contact route was found,
 * and renders the "remote/absent participant" portrait placeholder directly
 * on top of the very-much-present participant's own body.
 *
 * This exact class of bug has already shipped twice:
 *   1. G1 finding F2 (`resource_transferred`, see `.superpowers/sdd/g1-report.md`)
 *      -- fixed by raising `duration.maxMs` 4_000 -> 120_000.
 *   2. mating-box-fix (`mating_initiated`/`mating_rejected`, see
 *      `.superpowers/sdd/mating-box-fix-report.md`) -- fixed by raising both
 *      `duration.maxMs` and `physicalRouteTiming`'s `maximumDurationMs`
 *      8_000 -> 120_000.
 *
 * Any new (or newly route-bearing) choreography definition MUST import and
 * reuse this constant for its duration ceiling / route-timing cutoff instead
 * of inventing its own number, so a third incident of this class cannot
 * happen again.
 */
export const CONTACT_ROUTE_MAX_MS = 120_000;

const CERTIFIED_PRESENTATION_HZ = 30;
const CERTIFIED_FRAME_MS = Math.ceil(1_000 / CERTIFIED_PRESENTATION_HZ);
const PRODUCTION_TURN_DURATION_MS = Math.max(...PRODUCTION_RIG_IDS.flatMap((rig) =>
  PRODUCTION_FACINGS.map((facing) => requireHumanClip(
    PRODUCTION_ASSET_MANIFEST,
    rig,
    "turn",
    facing,
  ).frames.reduce((total, frame) => total + frame.durationMs, 0))));

/** Counts the worst-case initial and direction-changing turns in a cardinal route. */
export function conservativeProductionRouteTurnCount(waypoints: readonly RoutePoint[]): number {
  if (waypoints.length < 2) return 0;
  let priorDirection: "north" | "east" | "south" | "west" | null = null;
  let turns = 1;
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (dx === 0 && dy === 0) continue;
    const next = Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0 ? "east" : "west"
      : dy >= 0 ? "south" : "north";
    if (priorDirection !== null && next !== priorDirection) turns += 1;
    priorDirection = next;
  }
  return turns;
}

/**
 * Returns a certified upper budget for production actor traversal at the 30 Hz floor.
 *
 * The actor separates position changes from phase changes. Each conservative turn may
 * therefore consume a stationary turn-start and turn-completion sample, while final
 * arrival consumes one stationary endpoint-stop sample.
 */
export function certifiedProductionRouteBudgetMs(
  waypoints: readonly RoutePoint[],
  speedPixelsPerSecond: number,
): number {
  if (!Number.isFinite(speedPixelsPerSecond) || speedPixelsPerSecond <= 0) {
    throw new Error("Production route speed must be finite and positive.");
  }
  if (waypoints.length < 2) return 0;
  let distance = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    distance += Math.hypot(to.x - from.x, to.y - from.y);
  }
  const turns = conservativeProductionRouteTurnCount(waypoints);
  return Math.ceil(
    distance / speedPixelsPerSecond * 1_000
      + turns * PRODUCTION_TURN_DURATION_MS
      + (turns * 2 + 1) * CERTIFIED_FRAME_MS,
  );
}
