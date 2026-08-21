/**
 * THE UTTERANCE LANE — what displays, separated from what occupies a body.
 *
 * Measured problem (`.superpowers/sdd/live-replay-probe-report.md`): every event
 * booked an exclusive, full-duration lease on a single serial stage. A private
 * thought and a childbirth cost the same lease. Replaying a real 388-event /
 * 222-second / 4-being run through the production session measured **24.06x
 * oversubscription, 16 of 382 moments performed**, and private thoughts alone
 * accounted for **76% of all demanded stage time** — each booking exactly
 * 14,000ms to display a bubble that needs no stage at all.
 *
 * The split (design spec 2026-07-31 §3.1):
 *
 * - **Utterance overlay, non-blocking.** Speech and private thought. The words
 *   appear over the being's head, are readable, and fade on the overlay's own
 *   clock. They do not queue, do not block, and do not stop the being walking
 *   while they are up. Unlimited and concurrent.
 * - **Actor choreography, occupies one body.** Everything else.
 *
 * **Private thoughts stay visible.** This removes the *lease*, never the bubble:
 * the intent built here is byte-identical to the one `selfTalkDefinition` and
 * `speakDefinition` bake into their plans today, including the whisper/spoken/
 * thought variant distinction and the whisper's thread to its listener. The
 * being was already not animated during its own thought (`actorIntents: 0`
 * whenever it is unselected, which is the common case), so nothing is lost.
 *
 * One thing IS given up, deliberately: a same-region targeted speaker no longer
 * physically walks to its listener before speaking. That approach is what made
 * the measured 23.6-second speech scene 23.6 seconds long, and a lane that never
 * occupies a body cannot move one. It is honest — the simulation never said the
 * speaker walked, only that they spoke.
 */

import type { EventEnvelopeEntry } from "../app/schemas";
import type { StoryMoment } from "./BeatDirector";
import type { PresentedUtterance } from "./contracts";
import { parsePresentedEvent } from "./eventPayloads";

/**
 * The event types that display without occupying a body.
 *
 * This is the `communication` choreography family exactly
 * (`choreography/registry.ts` `CHOREOGRAPHY_FAMILY_EVENT_TYPES.communication`),
 * and `utteranceLane.test.ts` pins it against that family so the two cannot
 * drift apart as the 28-event vocabulary grows.
 */
export const UTTERANCE_EVENT_TYPES = Object.freeze(["speak", "self_talk"] as const);

export type UtteranceEventType = (typeof UTTERANCE_EVENT_TYPES)[number];

const UTTERANCE_TYPES = new Set<string>(UTTERANCE_EVENT_TYPES);

/** Whether one event displays only, and never needs a body. */
export function isUtteranceEvent(entry: EventEnvelopeEntry): boolean {
  return UTTERANCE_TYPES.has(entry.event.type);
}

/**
 * Whether a whole moment belongs to the overlay lane.
 *
 * A moment is only display-only when **every** piece of its evidence is: a
 * chained moment that happens to contain a `speak` alongside a physical beat
 * still has a body to move, and must be choreographed.
 */
export function isUtteranceMoment(moment: StoryMoment): boolean {
  return moment.evidence.length > 0 && moment.evidence.every(isUtteranceEvent);
}

/** Where a being currently stands, by region id — read from the presented world. */
export type BeingRegionLookup = (beingId: string) => string | null;

/**
 * Builds the overlay beats one moment publishes.
 *
 * Skips evidence it cannot parse rather than throwing: an unreadable utterance
 * must cost the viewer a bubble, never the run. The caller has already decided
 * this moment does not occupy a body.
 *
 * `regionOf` resolves the same thing `agentRegion(frame, id)` resolves inside
 * the choreography, and is used for the same two decisions: which region the
 * beat belongs to (a private thought's payload carries no region — the backend
 * never stamps one, because the event is routed nowhere), and whether a targeted
 * line is a same-region *whisper* or a *spoken* one heard across a distance.
 */
export function utterancesFor(
  moment: StoryMoment,
  regionOf: BeingRegionLookup,
): readonly PresentedUtterance[] {
  const utterances: PresentedUtterance[] = [];
  for (const entry of moment.evidence) {
    // `parsePresentedEvent` THROWS on a malformed payload rather than reporting
    // it — and six of eight recorded runs carry a legacy payload schema that
    // fails exactly this way (`live-replay-probe-report.md`, Finding A). A lane
    // that let that escape would abort the whole batch's ingest over one
    // unreadable line.
    let parsed;
    try {
      parsed = parsePresentedEvent(entry);
    } catch {
      continue;
    }
    if (!parsed.known) continue;
    const { evidence } = parsed;
    if (evidence.type === "self_talk") {
      utterances.push(Object.freeze({
        momentId: moment.id,
        cursor: entry.cursor,
        beingId: evidence.payload.agent_id,
        targetId: null,
        regionId: regionOf(evidence.payload.agent_id),
        text: evidence.payload.message,
        // A thought is a dashed cloud; the grammar is unchanged.
        variant: "thought",
        eventType: "self_talk",
      }));
      continue;
    }
    if (evidence.type === "speak") {
      const targetId = evidence.payload.target_id;
      // Byte-identical to `speakDefinition`'s own `localTarget` test.
      const localTarget = targetId !== null && regionOf(targetId) === evidence.payload.region;
      utterances.push(Object.freeze({
        momentId: moment.id,
        cursor: entry.cursor,
        beingId: evidence.payload.speaker_id,
        targetId,
        regionId: evidence.payload.region,
        text: evidence.payload.message,
        variant: localTarget ? "whisper" : "spoken",
        eventType: "speak",
      }));
    }
  }
  return Object.freeze(utterances);
}
