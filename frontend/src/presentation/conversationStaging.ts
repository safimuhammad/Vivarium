/**
 * CONVERSATIONAL STAGING — beings talking to each other stand together, at once.
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
 * **Revision (Safi, 2026-08-26), after watching the walk live:**
 *
 * > *"make them flash step to appear close when addressing or talking to each
 * > other, given they are in the same region."*
 *
 * The first build of this lane walked the addressee over and held the words
 * back for the walk — up to four seconds of a silent screen after a line had
 * already reached the feed. That is now gone. Same region + directed speech
 * means the addressee **appears** at conversational distance immediately and
 * the line lands with it.
 *
 * **The four decisions, owner-made, implemented exactly:**
 *
 * 1. **Same region, directed speech: flash step.** The ADDRESSEE arrives at
 *    conversational distance of the speaker at once and both turn to face each
 *    other. The speaker does not move, so the words stay anchored where they
 *    were emitted.
 * 2. **The words are never held.** Every decision this module makes is
 *    instantaneous; there is no delay channel left to hold them on.
 * 3. **It must read as deliberate.** The flash is performed with the piece's
 *    existing vanish-and-appear language, not a jump cut: the beat resolves to
 *    a `reposition` primitive whose reason drives the actors' 180ms fade-out /
 *    180ms fade-in ({@link CONVERSATION_FLASH_STEP_MS}) — the same fade a
 *    region transition's `fade-reposition` performs. A being visibly dissolves
 *    where it stood and resolves where it is spoken to.
 * 4. **Cross-region: do NOTHING spatial.** Nobody moves and nothing is drawn
 *    between them. The bubble's `[to <Name>]` tag carries the connection on its
 *    own. This is the honest reading — they really are far apart.
 *
 * The destination is unchanged from the walking build: still the endpoint of a
 * route resolved by `resolveLegalContactRoute` against the region's real ground
 * and structures, so a flash can no more drop a being into the river than a
 * walk could. Only the traversal is removed.
 *
 * ---
 *
 * **Revision (Safi, 2026-08-27): the distance must clear the BUBBLES.**
 *
 * > *"Overlap is tolerable but at first the system itself should keep them
 * > apart so that their bubbles don't collide. If that even fails then it's the
 * > fallback not a first choice."*
 *
 * The flash was landing the addressee on the nearest legal tile — one tile,
 * 32 px — because it borrowed `INTERACTION_CONTACT_TOLERANCE_PX`, the distance
 * a body needs to strike or hand over an object. A sentence needs far more room
 * than a body: a speech bubble is centred on the crown of the being that said
 * it and, for the length these beings actually speak at, is around 189 world px
 * wide — six tiles, four times the distance they were being staged at. So a
 * pair wore each other's words for the whole exchange. That is the collision the
 * owner was watching, and it was systematic rather than occasional — it happened
 * every single time two beings talked.
 *
 * The lane now measures the bubble and stands them a bubble apart
 * ({@link CONVERSATION_BUBBLE_CLEARANCE_PX}, rounded up to the tile a body can
 * actually stand on), and asks the route resolver for the FARTHEST legal tile
 * inside that band rather than the nearest. Prevention is first; the renderer's
 * crowd solver, which lifts and shifts a bubble to clear the ones already down,
 * is second; a drawn overlap is the last resort and is counted rather than
 * hidden.
 *
 * ---
 *
 * **Why this is nearly stateless, and why that is the point.**
 *
 * The rule is geometric, re-read per line: *are they already within
 * conversational distance?* If yes, nothing is staged. That single test answers
 * three of the hard cases on its own:
 *
 * - **Rapid back-and-forth.** After the first flash the two are inside the
 *   together band, so lines two through five stage nothing and move nobody. They stay together
 *   for as long as the exchange lasts because nothing pulls them apart — beings
 *   in this world never move on their own; only a beat moves them.
 * - **The hold.** There is no hold timer, because there is nothing to hold.
 *   Standing still is the default state of a body nobody has commanded.
 * - **The part.** Nothing is glued. The pair is not a tracked entity at all;
 *   the moment any beat moves either body they are apart, and the next directed
 *   line re-reads the geometry from scratch.
 *
 * The one piece of state that IS kept is {@link ConversationStaging}'s memo of
 * where it has just flashed a being to, and it exists for exactly one reason:
 * the placement ledger's anchor is refreshed when a being *settles*
 * (`SpatialDirector.syncArrivalPoint`, driven for this lane by the scene
 * graph's `conversation-flash` sync), and that happens a renderer tick later
 * than the decision. Without the memo, a burst of lines resolved inside one
 * ingest would all read the same stale "far away" point and all flash again.
 *
 * The memo retires on **evidence, not on a clock**: it remembers the ledger
 * point it was made against, and the moment the ledger reads anything else the
 * being has genuinely moved and the memo is dropped. A deadline would have been
 * wrong here — a flash produces no walk to time, and the ledger's own refresh
 * is the only honest signal that the world has caught up.
 *
 * ---
 *
 * **What is deliberately NOT staged**, each falling back to the cross-region
 * behaviour — the words land immediately, tagged, and nobody moves:
 *
 * - **The addressee is not rendered** (unmounted region art, not yet placed).
 *   Fail soft; a bubble is never worth an invented body.
 * - **The addressee's body belongs to the active scene.** Choreography owns one
 *   body at a time and this lane must never fight it for one.
 * - **The addressee was flashed a moment ago.** Two beings addressing the same
 *   third in quick succession must not make it strobe between them. The first
 *   flash stands for as long as it is still playing
 *   ({@link CONVERSATION_FLASH_STEP_MS}); the second line's words simply land
 *   where they are.
 * - **No legal route reaches the speaker**, or the region's recipe is unknown.
 * - **Reduced motion.** Less animation, never less information.
 */

import {
  contactPointTile,
  conversationalContactCandidates,
  homeExclusionsForRegion,
  resolveLegalContactRoute,
} from "./choreography/interactionContact";
import { TILE_SIZE } from "../renderer2d/map/regionMap";
import {
  PARAGRAPH_MESSAGE_CHARS,
  textBubbleWidthForLengthPx,
} from "../renderer2d/production/environment/bubbleGrammar";
import type { PlacementLedgerSnapshot } from "../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../renderer2d/production/maps/RegionMapRecipe";
import type {
  Direction4,
  PresentedStagingBeat,
  PresentedUtterance,
  Vec2,
} from "./contracts";

/**
 * The world px two conversing beings must be apart for their bubbles to clear.
 *
 * DERIVED from the drawn grammar, never picked: a speech bubble is centred on
 * its speaker's crown, so two speakers clear when the gap between them covers
 * half of each bubble — one whole bubble width. `textBubbleWidthForLengthPx`
 * builds that bubble and measures it, so this number moves if the font, the
 * padding or the measure band ever moves, the way `speechLifetime.ts` made the
 * bubble and the scene clock share one source instead of drifting apart.
 *
 * **The length it is asked for is the whole argument.** A bubble's width is a
 * function of the message, so "one bubble width" needs a message to mean
 * anything, and the two obvious answers are both wrong:
 *
 * - The NARROWEST form (`minColumns`) is 123 px, four tiles. It looks principled
 *   and it fails in practice: measured over 275 real lines from a recorded run,
 *   it clears **4.7%** of them. Beings in this world do not speak in remarks.
 * - The WIDEST form (`maxColumns`) is 275 px, nine tiles, and would march two
 *   beings most of a screen apart to say "yes".
 *
 * {@link PARAGRAPH_MESSAGE_CHARS} is the honest middle, and it is not a fitted
 * number: it is the grammar's own last length rung — where the type has already
 * hit its floor and a longer message can only grow the box — and it lands within
 * four characters of that same corpus's MEDIAN message. The grammar's idea of
 * "long" and the world's actual speech agree, so the distance is read off the
 * grammar rather than off any one run.
 *
 * It is scale-invariant where it matters. Chrome is blitted at
 * `bubbleScale(zoom) = clamp(round(zoom), 1, 4)`, so at every integer camera
 * zoom the bubble covers this same span of WORLD px; the requirement is the
 * same at the story framing (zoom 2) as at zoom 1. Below zoom 1 the blit scale
 * has bottomed out at 1 and cannot shrink further, so the bubble covers more and
 * more world as the camera pulls out and two of them will eventually touch. That
 * is the accepted fallback, not a failure of the derivation: past the floor, no
 * separation short of absurd clears them.
 */
export const CONVERSATION_BUBBLE_CLEARANCE_PX
  = textBubbleWidthForLengthPx("speech", PARAGRAPH_MESSAGE_CHARS);

/**
 * How close two beings must already be for nobody to move — and the farthest a
 * flash step may put them.
 *
 * The clearance rounded UP to a whole tile, because a body only ever stands on a
 * tile centre: it is the nearest standing distance that actually clears
 * {@link CONVERSATION_BUBBLE_CLEARANCE_PX} rather than falling a few px short of
 * it. One number does both jobs on purpose. `conversationalContactCandidates`
 * offers no tile beyond it and `stage` calls anything within it *together*, so a
 * being that has just been stepped here reads as together on the very next line
 * and an exchange never strobes.
 *
 * **This is deliberately no longer `INTERACTION_CONTACT_TOLERANCE_PX`.** That
 * 1.5-tile number is a BODY distance — where a strike lands, where a gift is
 * handed over — and it is still exactly right for those. It was wrong for
 * conversation for one reason the constant's own note anticipated and got
 * backwards: two beings at 48 px do not have room for the chrome they are
 * about to produce. A strike is 22 px of body; a sentence is a bubble several
 * times wider. Combat, gifts and handovers keep the old distance untouched.
 *
 * The cost is honest and visible, and it is the one thing here worth arguing
 * about: a talking pair now stands **six tiles** apart rather than one and a
 * half. It still reads as a conversation — they turn to face each other, a
 * dotted thread runs between them, they are the only two bodies in that stretch
 * of ground, and both their lines are legible instead of stacked — but it is
 * *across a clearing*, not shoulder to shoulder. Measured on a recorded run's
 * real lines, this is what it buys: at the story framing the placement solver
 * falls back to an overlap on 4.1% of frames instead of 17.6%, and one step
 * further out, 0%.
 */
export const CONVERSATION_TOGETHER_PX
  = Math.ceil(CONVERSATION_BUBBLE_CLEARANCE_PX / TILE_SIZE) * TILE_SIZE;

/**
 * How long one flash step is visibly in progress, in milliseconds.
 *
 * Two 180ms fade phases — `FALLBACK_FADE_PHASE_MS` out, then in — which is the
 * actors' existing vanish-and-appear duration and the reason this beat reads as
 * a deliberate step rather than a dropped frame. Kept in numeric lockstep with
 * `LayeredHumanActor.ts` / `SpriteSheetHumanActor.ts` by convention (and pinned
 * by `conversationStaging.test.ts`) rather than by import, so the presentation
 * layer never depends downward on a renderer constant.
 *
 * The words do NOT wait for it. It is used here for one thing only: a being
 * whose flash is still playing is not flashed somewhere else.
 */
export const CONVERSATION_FLASH_STEP_MS = 360;

/**
 * Hard ceiling on flashed-standing memos remembered at once.
 *
 * Each entry retires on its own evidence — the ledger moving off the point it
 * was made against — so this only ever matters if a pathological run flashed
 * more beings than a region holds without any of them settling. A lane that
 * stages proximity must not become an unbounded map.
 */
const MAX_FLASHED_STANDING = 64;

/** Why one directed line was or was not staged. Diagnostic only; never causal. */
export type ConversationStagingOutcome =
  | "not-directed"
  | "cross-region"
  | "unplaced"
  | "already-together"
  | "reduced-motion"
  | "listener-busy"
  | "flash-pending"
  | "no-route"
  | "flash-step";

/** Everything one staging decision needs, and nothing that could vary per call site. */
export interface ConversationStagingInput {
  readonly utterance: PresentedUtterance;
  /**
   * Bodies the active choreography scene already owns.
   *
   * Empty when no scene holds the stage. A being in this set is never staged
   * over — choreography owns one body at a time.
   */
  readonly busyBeingIds: ReadonlySet<string>;
  /** Presentation-clock reading, never wall time read here. */
  readonly nowMs: number;
}

/**
 * One resolved decision: what to publish, right now.
 *
 * There is deliberately no delay and no second, later batch of beats. Both
 * existed to time a walk the words waited on; the flash step lands with the
 * line, so a decision is a single, immediate publication or nothing at all.
 */
export interface ConversationStagingDecision {
  /**
   * Published immediately, in order: the flash step, then the two turns.
   *
   * The order is load-bearing — a `face` resolved before the body has been
   * repositioned would aim the addressee from where it no longer stands.
   */
  readonly beats: readonly PresentedStagingBeat[];
  readonly outcome: ConversationStagingOutcome;
}

/** Spatial truth, read fresh per decision — never captured at construction. */
export interface ConversationStagingOptions {
  readonly getPlacement: () => PlacementLedgerSnapshot;
  readonly getRecipes: () => ReadonlyMap<string, RegionMapRecipeV1>;
  readonly reducedMotion: () => boolean;
}

/** Decides whether one directed line brings two beings together, and where. */
export interface ConversationStaging {
  stage(input: ConversationStagingInput): ConversationStagingDecision;
  /** Forgets every flashed-standing memo. Called when a run is replaced or reset. */
  reset(): void;
}

/** Where this lane last put a being, and the ledger reading that memo is valid against. */
interface FlashedStanding {
  readonly regionId: string;
  readonly destination: Vec2;
  /**
   * The ledger's own point for this being at the instant the flash was staged.
   *
   * The memo is valid only while the ledger still reads exactly this. Anything
   * else means the world has caught up (or the being has moved on), and the
   * ledger is once again the better answer.
   */
  readonly ledgerPoint: Vec2;
  readonly stagedAtMs: number;
}

const NOTHING: readonly PresentedStagingBeat[] = Object.freeze([]);

function decision(
  outcome: ConversationStagingOutcome,
): ConversationStagingDecision {
  return Object.freeze({ beats: NOTHING, outcome });
}

function samePoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
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
 * header: it remembers where it has just flashed a being to, and forgets that
 * the moment the placement ledger disagrees with the reading the memo was made
 * against.
 */
export function createConversationStaging(
  options: ConversationStagingOptions,
): ConversationStaging {
  const flashed = new Map<string, FlashedStanding>();

  const remember = (beingId: string, memo: FlashedStanding): void => {
    flashed.set(beingId, memo);
    // Insertion order, oldest first out. Retirement is by evidence; the cap only
    // guards against a pathological burst outrunning it.
    while (flashed.size > MAX_FLASHED_STANDING) {
      const oldest = flashed.keys().next();
      if (oldest.done) break;
      flashed.delete(oldest.value);
    }
  };

  /**
   * Where a being effectively stands: a still-valid flash destination, else the
   * ledger — dropping the memo as soon as the ledger has moved off it.
   */
  const standingPoint = (
    beingId: string,
    regionId: string,
    ledgerPoint: Vec2,
  ): Vec2 => {
    const memo = flashed.get(beingId);
    if (memo === undefined) return ledgerPoint;
    if (memo.regionId !== regionId || !samePoint(memo.ledgerPoint, ledgerPoint)) {
      flashed.delete(beingId);
      return ledgerPoint;
    }
    return memo.destination;
  };

  return Object.freeze({
    reset(): void {
      flashed.clear();
    },

    stage(input: ConversationStagingInput): ConversationStagingDecision {
      const { utterance, busyBeingIds, nowMs } = input;
      const listenerId = utterance.targetId;
      if (utterance.eventType !== "speak" || listenerId === null) {
        return decision("not-directed");
      }
      // A being cannot step to itself. The backend has never published such a
      // line, and staging one would author a zero-length move.
      if (listenerId === utterance.beingId) return decision("not-directed");

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
      const inFlight = flashed.get(listenerId);
      if (inFlight !== undefined && nowMs - inFlight.stagedAtMs < CONVERSATION_FLASH_STEP_MS) {
        return decision("flash-pending");
      }

      const recipes = options.getRecipes();
      const recipe = recipes.get(regionId);
      if (recipe === undefined) return decision("no-route");
      // Farthest-first within the together band, not the nearest-first ordering
      // every other beat uses: a talking pair needs the room its bubbles will
      // occupy, and everything the ordering offers is still close enough that
      // the next line of the exchange stages nothing.
      const route = resolveLegalContactRoute(
        listenerAt,
        speakerAt,
        recipe,
        homeExclusionsForRegion(placement, recipes, regionId),
        conversationalContactCandidates(
          contactPointTile(speakerAt),
          speakerAt,
          CONVERSATION_TOGETHER_PX,
        ),
      );
      if (route.status !== "reached" || route.waypoints.length < 2) {
        return decision("no-route");
      }

      // The route is resolved and then thrown away except for where it ENDS.
      // That endpoint is the whole legality argument: it is a point the
      // region's own ground and structures already admitted a body to.
      const destination = Object.freeze({ ...route.waypoints.at(-1)! });
      remember(listenerId, Object.freeze({
        regionId,
        destination,
        ledgerPoint: Object.freeze({ ...listenerPlacement.point }),
        stagedAtMs: nowMs,
      }));

      const key = `${utterance.momentId}:${utterance.cursor}`;
      const beats: PresentedStagingBeat[] = [
        Object.freeze({
          id: `${key}:flash-step`,
          kind: "flash-step" as const,
          beingId: listenerId,
          regionId,
          to: destination,
        }),
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
        beats.push(Object.freeze({
          id: `${key}:face-listener`,
          kind: "face" as const,
          beingId: utterance.beingId,
          regionId,
          facing: conversationalFacing(speakerAt, destination),
        }));
      }

      return Object.freeze({
        beats: Object.freeze(beats),
        outcome: "flash-step",
      });
    },
  });
}
