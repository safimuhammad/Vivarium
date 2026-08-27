/**
 * @fileoverview SpatialDirector — the single owner of spatial truth for the
 * 2D production renderer.
 *
 * The simulation backend only ever tells the frontend a REGION and an
 * ACTION; it never publishes a position. Every screen coordinate a being or
 * structure occupies is therefore invented by the frontend, and until this
 * module existed that invention was scattered: `PlacementLedger` allocated
 * a being's very first region-entry anchor by hash and then treated it as
 * permanent for the rest of its stay, while each choreography family
 * (`presentation/choreography/{bondCombat,lifecycleMovementCommunicationResource,homeContestSystem}.ts`)
 * independently re-derived "where is the other participant" from that same
 * stale anchor and independently decided how close to stand -- with no
 * shared notion of a structure's footprint or of two participants
 * converging on one point.
 *
 * SpatialDirector does not replace any of that: choreography still owns
 * WHAT happens (which agents act, on which target, for which event), and
 * `PlacementLedger` still owns the allocation ledger itself. SpatialDirector
 * is the layer in between, consumed by `ProductionSceneGraph.ts` and
 * `ProductionSceneCommandResolver.ts` (both renderer-owned, not
 * choreography-owned), that:
 *
 * 1. Keeps the ledger's per-agent anchor fresh against actors' true
 *    rendered positions once a walk genuinely completes
 *    ({@link syncArrivalPoint}) -- so every later choreography read of
 *    `context.placement.agents.get(id)?.point` is truth, not a stale
 *    region-entry hash.
 * 2. Derives the exclusion geometry that keeps bodies off of / from
 *    routing through a structure's rendered footprint, while leaving its
 *    door threshold open for legitimate home-interaction beats
 *    ({@link homeRouteExclusionRects}).
 * 3. Resolves the one thing no single choreography family owns: multiple
 *    distinct participants whose independently-computed targets coincide
 *    or crowd one another (a home-contest event's whole supporting cast
 *    converging on one door pixel; two independently-staged beings landing
 *    too close together), by spreading them onto a small deterministic
 *    ring so no two bodies ever render on the same spot
 *    ({@link spreadCoincidentTargets}).
 */

import type { Rect, Vec2 } from "../../contracts";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../map/regionMap";
import { stableHash } from "../maps/directedTopology";
import {
  STANDING_HUMAN_VISUAL_ENVELOPE,
  homeFootprintExclusionRects,
  presentationPointIsClear,
} from "../productionGeometry";
import type { PlacementLedger } from "./PlacementLedger";

/**
 * Minimum axis-aligned gap (px) two beings must keep so their standing
 * envelopes never overlap -- the same footprint + readability gap
 * `PlacementLedger`'s own allocation-time separation check uses.
 */
export const MIN_AGENT_SEPARATION_PX: Readonly<{ x: number; y: number }> = Object.freeze({
  x: STANDING_HUMAN_VISUAL_ENVELOPE.width + 4,
  y: STANDING_HUMAN_VISUAL_ENVELOPE.height + 4,
});

/**
 * Refresh `placement`'s recorded anchor for `actorId` to `point`.
 *
 * Call this whenever a `ProductionActorSignal` of kind `"arrived"` is
 * observed for that actor (a route genuinely completed) -- see
 * `PlacementLedger.updateAgentPoint`'s own doc comment for the full
 * rationale. This wrapper exists so every call site names *why* it is
 * touching the ledger (an arrival, the one moment a being's true position
 * is authoritatively known and settled) rather than reaching into
 * `PlacementLedger` directly for an unrelated reason.
 */
export function syncArrivalPoint(placement: PlacementLedger, actorId: string, point: Vec2): void {
  placement.updateAgentPoint(actorId, point);
}

/**
 * Exclusion rects a choreographed route or ad hoc reposition must clear so
 * a being never renders on top of / inside a home's walls or roof. Each
 * home's door threshold stays open -- every home-interaction choreography
 * beat (hearth, build, loot, join/leave, breach, scavenge, ...)
 * deliberately routes its actor to stand exactly there. Feed the result
 * into `presentationRouteIsClear`/`presentationPointIsClear`
 * (`ProductionSceneGraph.ts`) alongside any scenic-landmark exclusions.
 */
export function homeRouteExclusionRects(
  homes: Iterable<Readonly<{ plot: Vec2 }>>,
): readonly Rect[] {
  const rects: Rect[] = [];
  for (const home of homes) rects.push(...homeFootprintExclusionRects(home.plot));
  return rects;
}

/**
 * The distance (px) at which two beings already read as "in an interaction"
 * and no approach walk is authored.
 *
 * One tile is the world's unit of personal space: the measured standing
 * envelope is 22 px wide, so two beings on orthogonally adjacent tile centres
 * (32 px apart) stand shoulder-to-shoulder -- arm's length. This tolerance is
 * 1.5 tiles so that a DIAGONALLY adjacent pair (32*sqrt2 = 45.3 px) also
 * counts as already in contact and is not made to shuffle sideways for
 * nothing.
 *
 * It is a BODY distance: where a strike lands, where a gift changes hands,
 * where two bodies read as touching. Combat, handovers and every other
 * two-participant beat share it, and should.
 *
 * **Conversation no longer does** (2026-08-27). It once did, on the argument
 * that "a larger conversational distance would be more polite and completely
 * illegible, because the beat director must frame both parties and every extra
 * tile of separation costs the zoom the overlay grammar needs to draw its full
 * form." Both halves of that turned out to be wrong. The grammar draws its
 * words at every zoom now, so pulling the frame wider costs smaller type rather
 * than the text; and a sentence is not a body — a speech bubble is several
 * times wider than the 22 px envelope, so a pair staged at arm's length wore
 * each other's words. `conversationStaging.CONVERSATION_TOGETHER_PX` measures
 * the bubble instead. Nothing here changed; only conversation left.
 */
export const INTERACTION_CONTACT_TOLERANCE_PX = TILE_SIZE * 1.5;

/** Maximum ring radius (in tiles) searched for a legal standing tile beside an anchor. */
const CONTACT_SEARCH_RADIUS_TILES = 4;

function pointKey(point: Vec2): string {
  return `${point.x},${point.y}`;
}

/**
 * Candidate tiles to stand on when interacting with whatever occupies
 * `anchor`, nearest first.
 *
 * Ring 1 is the four orthogonal neighbours (true adjacency, the interaction
 * distance every two-participant beat wants), then the four diagonals, then
 * successively wider rings. Wider rings exist only so that a target standing
 * somewhere a visitor legally cannot reach -- most importantly a being in a
 * home's doorway, whose whole 140 px footprint exclusion is off-limits --
 * still produces the closest legal standing spot in front of them instead of
 * no approach at all.
 *
 * SIDE BY SIDE FIRST -- east, west, then south, then north. Bodies are drawn
 * in feet-Y order, so a visitor standing NORTH of the other party is drawn
 * behind them and disappears almost entirely behind their sprite (measured:
 * at 32 px separation only the approaching being's hair stays visible), while
 * standing SOUTH hides the person being acted on. Shoulder to shoulder keeps
 * both bodies wholly visible and gives the clearest left/right facing, which
 * is the entire point of walking over there. North remains available as a last
 * resort so a target hemmed in on three sides is still reachable.
 *
 * Ordering is otherwise deterministic (ring, then E/W/S/N, then the diagonals)
 * so the same fixture always stages the same way.
 */
export function contactTileCandidates(anchor: TileCoord): readonly TileCoord[] {
  const candidates: TileCoord[] = [];
  for (let ring = 1; ring <= CONTACT_SEARCH_RADIUS_TILES; ring += 1) {
    candidates.push(
      { column: anchor.column + ring, row: anchor.row },
      { column: anchor.column - ring, row: anchor.row },
      { column: anchor.column, row: anchor.row + ring },
      { column: anchor.column, row: anchor.row - ring },
      { column: anchor.column + ring, row: anchor.row + ring },
      { column: anchor.column - ring, row: anchor.row + ring },
      { column: anchor.column + ring, row: anchor.row - ring },
      { column: anchor.column - ring, row: anchor.row - ring },
    );
  }
  return candidates;
}

/**
 * The nearest tile centre at or beside `anchor` on which a being may legally
 * stand -- collision-open per `isTileOpen` AND clear of every exclusion rect
 * (so never inside a home's walls).
 *
 * `anchor` itself is offered first: a home's door threshold is deliberately
 * carved out of its exclusion, so a legitimate door-standing beat keeps its
 * authored point whenever that point genuinely admits a body. When it does
 * not -- which is the live case for the shipped 128 px shelter, whose door
 * point sits 7 px too high for the measured 48 px standing envelope -- the
 * search steps outward and returns the closest legal spot in front of the
 * structure instead. Returns `null` only when nothing within
 * {@link CONTACT_SEARCH_RADIUS_TILES} is legal.
 */
export function nearestLegalStandingPoint(
  anchor: Vec2,
  exclusions: readonly Rect[],
  isTileOpen: (tile: TileCoord) => boolean,
): Vec2 | null {
  const anchorTile = { column: Math.floor(anchor.x / TILE_SIZE), row: Math.floor(anchor.y / TILE_SIZE) };
  if (isTileOpen(anchorTile) && presentationPointIsClear(anchor, exclusions)) return { ...anchor };
  for (const tile of contactTileCandidates(anchorTile)) {
    if (!isTileOpen(tile)) continue;
    const point = tileCenter(tile);
    if (presentationPointIsClear(point, exclusions)) return point;
  }
  return null;
}

function tooClose(left: Vec2, right: Vec2): boolean {
  return Math.abs(left.x - right.x) < MIN_AGENT_SEPARATION_PX.x
    && Math.abs(left.y - right.y) < MIN_AGENT_SEPARATION_PX.y;
}

/** Union-find grouping of every actor id whose target is too close to another's, transitively. */
function groupByProximity(targets: ReadonlyMap<string, Vec2>): Array<Array<readonly [string, Vec2]>> {
  const entries = [...targets.entries()];
  const parent = new Map<string, string>(entries.map(([id]) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (left: string, right: string): void => {
    const rootLeft = find(left);
    const rootRight = find(right);
    if (rootLeft !== rootRight) parent.set(rootLeft, rootRight);
  };
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (tooClose(entries[left]![1], entries[right]![1])) union(entries[left]![0], entries[right]![0]);
    }
  }
  const groups = new Map<string, Array<readonly [string, Vec2]>>();
  for (const entry of entries) {
    const root = find(entry[0]);
    const list = groups.get(root);
    if (list) list.push(entry);
    else groups.set(root, [entry]);
  }
  return [...groups.values()];
}

/** A ring of at least `count` deterministic candidate offsets around a shared anchor, nearest ring first. */
function ringOffsets(count: number): readonly Vec2[] {
  const radius = Math.max(MIN_AGENT_SEPARATION_PX.x, MIN_AGENT_SEPARATION_PX.y);
  const offsets: Vec2[] = [];
  let ring = 1;
  while (offsets.length < count) {
    const step = radius * ring;
    offsets.push(
      { x: step, y: 0 },
      { x: -step, y: 0 },
      { x: 0, y: step },
      { x: 0, y: -step },
      { x: step, y: step },
      { x: -step, y: step },
      { x: step, y: -step },
      { x: -step, y: -step },
    );
    ring += 1;
  }
  return offsets;
}

/**
 * Redistribute actor targets that would otherwise coincide (or crowd within
 * less than a standing envelope's gap of each other) onto a small
 * deterministic ring around their shared anchor, so no two distinct actors
 * are ever asked to stand on the same pixel.
 *
 * Choreography computes each participant's target independently (see the
 * file header); a group event where several supporting-cast members all
 * converge on one home's door, or two beings independently staged close
 * together, can legally produce two or more identical or overlapping raw
 * targets. This is the single place that notices and spreads them,
 * deterministically (by agent id, so the same fixture always produces the
 * same on-screen layout regardless of map iteration order).
 *
 * Within a colliding group, the member with the lowest {@link stableHash}
 * of its id keeps the group's original anchor point untouched (e.g. the
 * primary actor stays exactly at the home's door); every other member is
 * displaced onto the nearest legal ring point around that anchor.
 *
 * `isLegal` gates each candidate ring point (typically: inside the
 * region's bounds, on a collision-open tile, clear of every home's
 * exclusion rects). A participant whose group has no legal ring slot left
 * keeps its original (possibly overlapping) target rather than being
 * dropped from the result -- overlap is a lesser visual defect than a
 * participant silently vanishing from the scene.
 */
export function spreadCoincidentTargets(
  targets: ReadonlyMap<string, Vec2>,
  isLegal: (point: Vec2) => boolean,
): ReadonlyMap<string, Vec2> {
  const resolved = new Map<string, Vec2>();
  for (const group of groupByProximity(targets)) {
    if (group.length < 2) {
      const [id, point] = group[0]!;
      resolved.set(id, point);
      continue;
    }
    const ordered = [...group].sort(([leftId], [rightId]) => stableHash(leftId) - stableHash(rightId));
    const [anchorId, anchor] = ordered[0]!;
    resolved.set(anchorId, anchor);
    const taken = new Set<string>([pointKey(anchor)]);
    const ring = ringOffsets(ordered.length - 1);
    for (let index = 1; index < ordered.length; index += 1) {
      const [id, originalPoint] = ordered[index]!;
      const candidate = ring
        .map((offset) => ({ x: anchor.x + offset.x, y: anchor.y + offset.y }))
        .find((point) => !taken.has(pointKey(point)) && isLegal(point));
      if (candidate) {
        taken.add(pointKey(candidate));
        resolved.set(id, candidate);
      } else {
        resolved.set(id, originalPoint);
      }
    }
  }
  return resolved;
}
