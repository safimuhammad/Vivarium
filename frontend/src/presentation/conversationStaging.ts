/**
 * CONVERSATIONAL STAGING — beings talking to each other stand together.
 *
 * Owner observation (Safi, 2026-08-22):
 *
 * > *"I saw that if two characters are speaking to each other then the frontend
 * > should show them standing side by side to each other because they're
 * > talking. This one was showing them far apart, which is not correct. I know
 * > in the backend it doesn't show you the distances. That's what the frontend
 * > has to compute."*
 *
 * He is right about the architecture. The simulation publishes a REGION and an
 * ACTION and never a position, so proximity during a conversation is entirely a
 * frontend decision — and until now the frontend declined to make it. The
 * two-lane split (`utteranceLane.ts`) deliberately gave up the speaker's
 * approach walk, because that walk was what made a measured speech scene 23.6
 * seconds long. That trade bought back the stage; it also left two beings
 * addressing each other from opposite ends of a region.
 *
 * This module buys the proximity back WITHOUT buying back the lease.
 *
 * ---
 *
 * **The three decisions, owner-made, implemented exactly:**
 *
 * 1. **Same region, directed speech: walk together, hold, then part.** The
 *    ADDRESSEE walks to conversational distance of the speaker and both turn to
 *    face each other. The speaker does not move, so the words stay anchored
 *    where they were emitted.
 * 2. **The words land ON ARRIVAL.** The bubble is held back for exactly the
 *    approach's certified route budget — the same
 *    `certifiedProductionRouteBudgetMs` every choreographed walk is timed by —
 *    and released when the two are together. A fast exchange may therefore lag
 *    the feed by up to one approach; that was the owner's explicit choice over
 *    speaking-immediately-and-walking-during.
 * 3. **Cross-region: do NOTHING spatial.** Nobody moves and nothing is drawn
 *    between them. The bubble's `to <Name>` tag carries the connection on its
 *    own. This is the honest reading — they really are far apart.
 *
 * ---
 *
 * **Why this is nearly stateless, and why that is the point.**
 *
 * The rule is geometric, re-read per line: *are they already within
 * conversational distance?* If yes, nothing is staged and the words land at
 * once. That single test answers three of the hard cases on its own:
 *
 * - **Rapid back-and-forth.** After the first approach the two are adjacent, so
 *   lines two through five stage nothing and re-walk nothing. They stay
 *   together for as long as the exchange lasts because nothing pulls them
 *   apart — beings in this world never move on their own; only a beat moves
 *   them.
 * - **The hold.** There is no hold timer, because there is nothing to hold.
 *   Standing still is the default state of a body nobody has commanded.
 * - **The part.** Nothing is glued. The pair is not a tracked entity at all;
 *   the moment any beat moves either body they are apart, and the next directed
 *   line re-reads the geometry from scratch.
 *
 * The one piece of state that IS kept is the set of approaches currently in
 * flight ({@link ConversationStaging} `pending`), and it exists for exactly one
 * reason: the placement ledger's anchor is only refreshed when a walk completes
 * (`SpatialDirector.syncArrivalPoint`), so a burst of lines resolved inside one
 * ingest would otherwise all read the same stale "far away" point and all stage
 * their own walk. A pending approach's destination stands in for the ledger's
 * point until it lands.
 *
 * ---
 *
 * **What is deliberately NOT staged**, each falling back to the cross-region
 * behaviour — the words land immediately, tagged, and nobody moves:
 *
 * - **The addressee is not rendered** (unmounted region art, not yet placed).
 *   Fail soft; a bubble is never worth an invented body.
 * - **The addressee's body belongs to the active scene.** Choreography owns one
 *   body at a time and this lane must never fight it for one. Note this is a
 *   correctness guard, not a liveness one: a staging walk cannot deadlock
 *   against a scene in any case, because a later `move` supersedes an earlier
 *   route in place at the actor (`LayeredHumanActor.apply`) and settlement is
 *   marker-driven, never renderer-driven.
 * - **The addressee is already walking to someone else.** Two beings addressing
 *   the same third in quick succession must not make it ping-pong. The first
 *   approach stands; the second line's words simply land where they are.
 * - **No legal route reaches the speaker**, or the region's recipe is unknown.
 * - **Reduced motion.** Less animation, never less information.
 *
 * ---
 *
 * **The one judgement call: how far is worth walking.**
 *
 * `WALK_MAX_DISTANCE_PX` (320px) is the existing threshold for *choreographed*
 * walks, and it is tuned against a different cost — a walk that leases the
 * stage. This lane leases nothing, so that cost is gone; what replaces it is
 * the viewer's own patience, because the words wait for the walk. 320px at the
 * production gait is over six seconds of silence before a line appears. So the
 * visible approach is bounded much tighter, and a longer route is not cut away
 * (a conversation that begins with a teleport is a lie) but TRUNCATED with the
 * existing `truncateApproach` primitive: the addressee is placed on a point of
 * its own certified route, {@link CONVERSATION_APPROACH_MAX_PX} back, and walks
 * the last stretch in. Legality is inherited, exactly as it is for the
 * departure half of a region transition.
 */

import {
  certifiedProductionRouteBudgetMs,
} from "./choreography/productionLocomotionTiming";
import {
  homeExclusionsForRegion,
  resolveLegalContactRoute,
} from "./choreography/interactionContact";
import { truncateApproach } from "./choreography/locomotionGate";
import { INTERACTION_CONTACT_TOLERANCE_PX } from "../renderer2d/production/placement/SpatialDirector";
import type { PlacementLedgerSnapshot } from "../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../renderer2d/production/maps/RegionMapRecipe";
import type {
  Direction4,
  PresentedStagingBeat,
  PresentedUtterance,
  Vec2,
} from "./contracts";

/**
 * How close two beings must already be for the words to land with no walk.
 *
 * Reused, not invented: `INTERACTION_CONTACT_TOLERANCE_PX` (1.5 tiles, 48px) is
 * already the distance at which every two-participant beat in the world — a
 * strike, a gift, a proposal — considers the parties to be *at* each other, and
 * the same number is what `resolveLegalContactRoute`'s nearest-first candidate
 * ordering lands an approach on. Using a second, private notion of "together"
 * would let a being walk to a spot the rest of the system already calls close
 * enough, or refuse to when it is not.
 */
export const CONVERSATION_TOGETHER_PX = INTERACTION_CONTACT_TOLERANCE_PX;

/**
 * The longest stretch of an approach that is actually walked, in pixels.
 *
 * Four tiles — under three seconds at the production gait, including the
 * certified turn and frame slop. This is the number that decides how long a
 * viewer stares at a silent screen after a line has already reached the feed,
 * because {@link ConversationStagingDecision.delayMs} is derived from it, so it
 * is bounded by patience rather than by the stage-cost argument that set
 * `WALK_MAX_DISTANCE_PX` at ten tiles. Anything longer is truncated onto its
 * own route rather than skipped, so the approach still reads as *coming over*
 * however far apart they started.
 */
export const CONVERSATION_APPROACH_MAX_PX = 128;

/**
 * The gait an approach is walked and timed at, in pixels per second.
 *
 * The production walk, identical to the value the command resolver stamps on
 * every `move` primitive and to the one `movementBudgetMs` budgets against. A
 * different number here would make the words land before or after the feet.
 */
export const CONVERSATION_GAIT_PX_PER_SECOND = 48;

/**
 * Hard ceiling on in-flight approaches remembered at once.
 *
 * Entries retire on their own arrival deadline, so this only ever matters if a
 * pathological run staged more concurrent approaches than a region has beings.
 * A lane that stages proximity must not become an unbounded map.
 */
const MAX_PENDING_APPROACHES = 64;

/** Why one directed line was or was not staged. Diagnostic only; never causal. */
export type ConversationStagingOutcome =
  | "not-directed"
  | "cross-region"
  | "unplaced"
  | "already-together"
  | "reduced-motion"
  | "listener-busy"
  | "approach-pending"
  | "no-route"
  | "approach";

/** Everything one staging decision needs, and nothing that could vary per call site. */
export interface ConversationStagingInput {
  readonly utterance: PresentedUtterance;
  /**
   * Bodies the active choreography scene already owns.
   *
   * Empty when no scene holds the stage. A being in this set is never staged
   * over — see the module header for why this is a correctness guard rather
   * than a liveness one.
   */
  readonly busyBeingIds: ReadonlySet<string>;
  /** Presentation-clock reading, never wall time read here. */
  readonly nowMs: number;
}

/** One resolved decision: what to publish now, what to publish with the words, and when. */
export interface ConversationStagingDecision {
  /** Published immediately — the approach walk, if there is one. */
  readonly beats: readonly PresentedStagingBeat[];
  /** Published at the same instant the words are, once the two are together. */
  readonly arrivalBeats: readonly PresentedStagingBeat[];
  /** How long the words wait. Always `0` unless an approach was staged. */
  readonly delayMs: number;
  readonly outcome: ConversationStagingOutcome;
}

/** Spatial truth, read fresh per decision — never captured at construction. */
export interface ConversationStagingOptions {
  readonly getPlacement: () => PlacementLedgerSnapshot;
  readonly getRecipes: () => ReadonlyMap<string, RegionMapRecipeV1>;
  readonly reducedMotion: () => boolean;
}

/** Decides whether one directed line brings two beings together, and how. */
export interface ConversationStaging {
  stage(input: ConversationStagingInput): ConversationStagingDecision;
  /** Forgets every in-flight approach. Called when a run is replaced or reset. */
  reset(): void;
}

/** An approach already on its way, standing in for a ledger anchor that is stale. */
interface PendingApproach {
  readonly regionId: string;
  readonly destination: Vec2;
  readonly arrivesAtMs: number;
}

const NOTHING: readonly PresentedStagingBeat[] = Object.freeze([]);

function decision(
  outcome: ConversationStagingOutcome,
): ConversationStagingDecision {
  return Object.freeze({
    beats: NOTHING,
    arrivalBeats: NOTHING,
    delayMs: 0,
    outcome,
  });
}

/**
 * The cardinal a being turns to look at a point.
 *
 * Mirrors `directionFor` in `ProductionSceneCommandResolver.ts` exactly, which
 * is the function every scene-authored `orient` is resolved through. Kept as
 * four lines here rather than exported across the layer boundary, and pinned by
 * `conversationStaging.test.ts` so the two cannot drift into disagreeing about
 * which way a being is looking.
 */
export function conversationalFacing(from: Vec2, to: Vec2): Direction4 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

/** Straight-line separation between two standing points, in pixels. */
export function conversationalDistancePx(from: Vec2, to: Vec2): number {
  return Math.hypot(to.x - from.x, to.y - from.y);
}

/**
 * Builds the conversational staging rule over live spatial truth.
 *
 * The returned object is stateful only in the sense documented in the module
 * header: it remembers approaches that have not landed yet, and forgets each
 * one the instant its certified budget elapses.
 */
export function createConversationStaging(
  options: ConversationStagingOptions,
): ConversationStaging {
  const pending = new Map<string, PendingApproach>();

  const prune = (nowMs: number): void => {
    for (const [beingId, approach] of pending) {
      if (approach.arrivesAtMs <= nowMs) pending.delete(beingId);
    }
    // Retirement is by deadline; the cap only guards against a pathological
    // burst outrunning it. Oldest-first, because a Map iterates in insertion
    // order and the oldest approach is the one closest to having landed.
    while (pending.size > MAX_PENDING_APPROACHES) {
      const oldest = pending.keys().next();
      if (oldest.done) break;
      pending.delete(oldest.value);
    }
  };

  /** Where a being effectively stands: its in-flight destination, else the ledger. */
  const standingPoint = (
    beingId: string,
    regionId: string,
    ledgerPoint: Vec2,
  ): Vec2 => {
    const approach = pending.get(beingId);
    return approach !== undefined && approach.regionId === regionId
      ? approach.destination
      : ledgerPoint;
  };

  return Object.freeze({
    reset(): void {
      pending.clear();
    },

    stage(input: ConversationStagingInput): ConversationStagingDecision {
      const { utterance, busyBeingIds, nowMs } = input;
      const listenerId = utterance.targetId;
      if (utterance.eventType !== "speak" || listenerId === null) {
        return decision("not-directed");
      }
      // A being cannot walk to itself. The backend has never published such a
      // line, and staging one would author a zero-length route.
      if (listenerId === utterance.beingId) return decision("not-directed");
      prune(nowMs);

      const placement = options.getPlacement();
      const speakerPlacement = placement.agents.get(utterance.beingId);
      const listenerPlacement = placement.agents.get(listenerId);
      // Fail soft, and fail the SAME way a cross-region line fails: an addressee
      // that is not on stage has no body to bring anywhere, and the tag already
      // carries who was spoken to.
      if (speakerPlacement === undefined || listenerPlacement === undefined) {
        return decision("unplaced");
      }
      const regionId = speakerPlacement.regionId;
      if (listenerPlacement.regionId !== regionId) return decision("cross-region");

      const speakerAt = standingPoint(utterance.beingId, regionId, speakerPlacement.point);
      const listenerAt = standingPoint(listenerId, regionId, listenerPlacement.point);
      if (conversationalDistancePx(listenerAt, speakerAt) <= CONVERSATION_TOGETHER_PX) {
        return decision("already-together");
      }
      if (options.reducedMotion()) return decision("reduced-motion");
      if (busyBeingIds.has(listenerId)) return decision("listener-busy");
      if (pending.has(listenerId)) return decision("approach-pending");

      const recipes = options.getRecipes();
      const recipe = recipes.get(regionId);
      if (recipe === undefined) return decision("no-route");
      const route = resolveLegalContactRoute(
        listenerAt,
        speakerAt,
        recipe,
        homeExclusionsForRegion(placement, recipes, regionId),
      );
      if (route.status !== "reached" || route.waypoints.length < 2) {
        return decision("no-route");
      }

      const truncated = truncateApproach(route.waypoints, CONVERSATION_APPROACH_MAX_PX);
      const waypoints = truncated.waypoints.map((point) => Object.freeze({ ...point }));
      const destination = waypoints.at(-1)!;
      const delayMs = certifiedProductionRouteBudgetMs(
        waypoints,
        CONVERSATION_GAIT_PX_PER_SECOND,
      );
      pending.set(listenerId, Object.freeze({
        regionId,
        destination,
        arrivesAtMs: nowMs + delayMs,
      }));

      const key = `${utterance.momentId}:${utterance.cursor}`;
      const arrivalBeats: PresentedStagingBeat[] = [
        Object.freeze({
          id: `${key}:face-speaker`,
          kind: "face" as const,
          beingId: listenerId,
          regionId,
          facing: conversationalFacing(destination, speakerAt),
        }),
      ];
      // The speaker turns too — but only if nothing else owns its body. A being
      // mid-scene keeps whatever facing its scene gave it.
      if (!busyBeingIds.has(utterance.beingId)) {
        arrivalBeats.push(Object.freeze({
          id: `${key}:face-listener`,
          kind: "face" as const,
          beingId: utterance.beingId,
          regionId,
          facing: conversationalFacing(speakerAt, destination),
        }));
      }

      return Object.freeze({
        beats: Object.freeze([
          Object.freeze({
            id: `${key}:approach`,
            kind: "approach" as const,
            beingId: listenerId,
            regionId,
            waypoints: Object.freeze(waypoints),
            ...(truncated.cutFrom === null
              ? {}
              : { cutFrom: Object.freeze({ ...truncated.cutFrom }) }),
          }),
        ]),
        arrivalBeats: Object.freeze(arrivalBeats),
        delayMs,
        outcome: "approach",
      });
    },
  });
}
