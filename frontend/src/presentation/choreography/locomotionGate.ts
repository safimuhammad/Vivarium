/**
 * DISTANCE-GATED LOCOMOTION — walk if it is near, cut if it is not.
 *
 * Owner decision (Safi, 2026-07-31):
 *
 * > *"For some event, if the distance is too much, you can make them disappear
 * > and appear in that spot. If it feels like they are in close vicinity, then
 * > we can make them walk."*
 *
 * Routing, not talking, is what made scenes unbounded. Measured on a real
 * 388-event run: one `resource_changed` leased the stage for **56.5 seconds**
 * and one `agent_entered_region` for **45**, because `routeAwareTiming` stretches
 * a scene's enter and consequence phases to cover the actor's walk
 * (`lifecycleMovementCommunicationResource.ts`), and a walk across a region at
 * the production gait of 48 px/s takes as long as it takes. Nothing else in the
 * system had an unbounded cost.
 *
 * So: within a near threshold the being walks — movement reads, proximity is
 * legible, it is the good case. Beyond it the being cuts: it fades out where it
 * stood and fades in at the destination, using the reposition primitive the
 * actor already has. This is honest. The simulation never said the being
 * walked, only that it acted.
 *
 * **The threshold is a visual judgement, not a formula.** It was set by watching
 * all four regions with the feed open and asking, of each walk, whether it read
 * as "crossing the room" or as "trudging across the county". See
 * `WALK_MAX_DISTANCE_PX`.
 *
 * ---
 *
 * **The second primitive: truncate-then-walk (`boundLocomotion`).**
 *
 * One walk may not be cut away and may not be left unbounded either: the
 * departure half of a region transition. It carries a transactional contract —
 * the renderer retains the traveller, commits the destination at the
 * consequence marker and reconciles the arrival across the region change — so a
 * being that blinked to its own gate would have left a region without ever
 * being seen to. Measured on the real recording: those two departures walked
 * 1,521 px and 1,506 px, ~31 seconds each, **42% of everything the stage still
 * demanded** after the two-lane split.
 *
 * So the middle is elided instead of the whole: the being is cut to a point on
 * its own certified route, `WALK_MAX_DISTANCE_PX` back from the gate, and walks
 * that last stretch in. The departure is still *seen*. What is elided is the
 * traverse — which, by exactly the argument that justified the distance gate
 * above, says nothing the departure does not say better.
 */

import type { ActorVisualIntent, Vec2 } from "../contracts";

/** The production map's tile edge, in pixels (`renderer2d/map/regionMap.ts`). */
const TILE_PX = 32;

/**
 * How far a being will walk before the beat cuts instead.
 *
 * **Tuned by eye, at native size, against all four regions.** Ten tiles is a
 * little over six seconds at the production gait of 48 px/s: far enough that
 * crossing a Nirvana clearing, walking the length of a Warm Springs terrace, or
 * stepping between two neighbouring homes all still read as *going somewhere*,
 * and short enough that no walk becomes the beat. Beyond it the walk stops
 * carrying information — a being trudging for twenty seconds across the Nirvana
 * East playa says nothing the arrival does not say better, and it costs the
 * stage the whole time.
 *
 * Measured against the same run this was tuned on: it removes the 56.5s
 * `resource_changed` and both ~45s region arrivals, and leaves every
 * neighbourly approach walking.
 */
export const WALK_MAX_DISTANCE_PX = TILE_PX * 10;

/** What a route should do when it is performed. */
export type LocomotionMode = "walk" | "cut";

/** Total path length of a route, in pixels, following its waypoints. */
export function routeDistancePx(waypoints: readonly Vec2[]): number {
  let distance = 0;
  for (let index = 1; index < waypoints.length; index += 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    distance += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return distance;
}

/**
 * Whether a route is near enough to walk.
 *
 * A route with fewer than two waypoints is nothing to travel and stays a walk —
 * the callers' own "did we find a route at all" checks already handle that case,
 * and turning a zero-length route into a cut would fade a being out and back in
 * where it already stood.
 */
export function locomotionFor(waypoints: readonly Vec2[]): LocomotionMode {
  if (waypoints.length < 2) return "walk";
  return routeDistancePx(waypoints) <= WALK_MAX_DISTANCE_PX ? "walk" : "cut";
}

/**
 * Rewrites a walk that is too long into a cut.
 *
 * Returns the intent unchanged unless it is a `move` whose route exceeds the
 * threshold, in which case it becomes a `fade-reposition` to the same
 * destination, facing the same way, carrying the same marker. The marker is
 * deliberately preserved: it is what the settlement handshake and the renderer's
 * command binding key on, so a cut beat still commits at exactly the point in
 * the timeline the walking one would have.
 *
 * Dropping the waypoints is also what collapses the scene's duration:
 * `movementBudgetMs` only stretches a phase to cover intents of kind `move`
 * carrying two or more waypoints, so a cut beat falls back to its definition's
 * own base timing.
 */
export function gateLocomotion(intent: ActorVisualIntent): ActorVisualIntent {
  if (intent.kind !== "move") return intent;
  const waypoints = intent.waypoints ?? [];
  if (locomotionFor(waypoints) === "walk") return intent;
  const destination = intent.target ?? waypoints.at(-1) ?? null;
  if (destination === null) return intent;
  return {
    actorId: intent.actorId,
    kind: "fade-reposition",
    repositionReason: "distance-cut",
    target: { x: destination.x, y: destination.y },
    ...(intent.facing === undefined ? {} : { facing: intent.facing }),
    marker: intent.marker,
  };
}

/** A route reduced to the part worth watching, and the point it was cut to. */
export interface TruncatedApproach {
  /**
   * The waypoint the being is cut to before walking `waypoints`, or `null` when
   * the whole route was short enough to walk and nothing was elided.
   */
  readonly cutFrom: Readonly<{ x: number; y: number }> | null;
  /**
   * A contiguous **suffix** of the route handed in, ending exactly where it
   * ended. Never longer than the budget, and never shorter than one segment.
   */
  readonly waypoints: readonly Vec2[];
}

/**
 * Reduce a route to its final `maxDistancePx`, cutting to one of its own waypoints.
 *
 * Two properties do all the work, and both are asserted in `locomotionGate.test.ts`:
 *
 * 1. **The cut origin is an existing waypoint**, never an interpolated point.
 *    The scene graph accepts a `reposition` only to a point whose standing
 *    envelope clears every home footprint and tall landmark and whose tile is
 *    open ground; `presentationRouteIsClear` already swept *every* waypoint's
 *    envelope, and `firstBlockedGroundTile` already checked every waypoint's
 *    tile, when it accepted the untruncated route. Inheriting a waypoint
 *    therefore inherits its legality — the truncation asserts nothing new about
 *    the map, which is why it cannot put a being inside a wall.
 * 2. **At least one segment always survives.** A departure truncated all the way
 *    onto its own gate would be a teleport wearing a walk's marker, and the
 *    contract this primitive exists to protect is precisely that the being is
 *    *seen* arriving at the gate. So the cut index is clamped one short of the
 *    end even when the budget is zero.
 *
 * @param waypoints The full certified route. Returned untouched when there is
 *   nothing to travel or the whole thing already fits.
 * @param maxDistancePx Path-length budget for the visible tail.
 * @returns The visible tail and the waypoint it starts from (or `null`).
 */
export function truncateApproach(
  waypoints: readonly Vec2[],
  maxDistancePx: number,
): TruncatedApproach {
  if (waypoints.length < 2) return { cutFrom: null, waypoints };
  // Walk backwards from the gate, keeping the last index whose remaining tail
  // still fits. `lastIndex - 1` is the floor: one segment always survives.
  const lastIndex = waypoints.length - 1;
  let cutIndex = lastIndex - 1;
  let tail = 0;
  for (let index = lastIndex; index > 0; index -= 1) {
    const from = waypoints[index - 1]!;
    const to = waypoints[index]!;
    const next = tail + Math.hypot(to.x - from.x, to.y - from.y);
    if (next > maxDistancePx) break;
    tail = next;
    cutIndex = index - 1;
  }
  if (cutIndex === 0) return { cutFrom: null, waypoints };
  return { cutFrom: waypoints[cutIndex]!, waypoints: waypoints.slice(cutIndex) };
}

/**
 * Bounds a walk that may not be cut away, by eliding its middle.
 *
 * The counterpart to {@link gateLocomotion}: that one asks *walk or cut*, this
 * one answers *walk the part that carries the contract, elide the rest*. Applied
 * to the departure half of a region transition and nowhere else — see this
 * module's header for why that walk is different from every other one.
 *
 * Returns the intent unchanged unless it is a `move` carrying a route longer
 * than {@link WALK_MAX_DISTANCE_PX}. Otherwise the same intent comes back with
 * its waypoints reduced to the visible tail and a `cutFrom` declaring where the
 * being is placed first. Kind, marker, target and facing are all preserved: the
 * scene still commits at exactly the point in its timeline it always did, and
 * `movementBudgetMs` — which reads `waypoints` — collapses the phase on its own.
 */
export function boundLocomotion(intent: ActorVisualIntent): ActorVisualIntent {
  if (intent.kind !== "move") return intent;
  const waypoints = intent.waypoints ?? [];
  if (waypoints.length < 2) return intent;
  const truncated = truncateApproach(waypoints, WALK_MAX_DISTANCE_PX);
  if (truncated.cutFrom === null) return intent;
  return {
    ...intent,
    waypoints: truncated.waypoints,
    cutFrom: { x: truncated.cutFrom.x, y: truncated.cutFrom.y },
  };
}
