import {
  CHRONICLE_IDS,
  getChronicleManifest,
  type ChronicleId,
} from "../presentation/fixtures/chronicleCatalog";
import type { AuthoredReviewCue } from "./chronicleValidationModel";

type CueSelector = Readonly<{
  key: string;
  label: string;
  instruction: string;
  kind: "event" | "checkpoint";
  cursor: number;
}>;

const SELECTORS: Readonly<Record<ChronicleId, readonly CueSelector[]>> = Object.freeze({
  C00: [checkpoint("world-overview", "World overview", "Confirm all regions and the settled world overview.", 0)],
  C01: [
    event("departure", "Departure", "Confirm the actor begins the local walk cleanly.", 1),
    event("arrival", "Arrival", "Confirm the actor reaches the authored destination and settles.", 2),
  ],
  C02: edgeCuts("C02", "departure", "First departure", "final-arrival", "Final arrival"),
  C03: edgeCuts("C03", "first-harvest", "First harvest", "settled-transfer", "Settled resources"),
  C04: edgeCuts("C04", "proposal", "Proposal", "birth", "Birth"),
  C05: edgeCuts("C05", "first-branch", "First outcome", "final-branch", "Final outcome"),
  C06: edgeCuts("C06", "foundation", "Foundation", "settled-home", "Settled home"),
  C07: edgeCuts("C07", "breach", "Breach", "theft-settled", "Theft settled"),
  C08: edgeCuts("C08", "contest", "Contest", "colonization", "Colonization"),
  C09: edgeCuts("C09", "collapse", "Collapse", "ruin-settled", "Ruin settled"),
  C10: edgeCuts("C10", "attack", "Attack", "recovery", "Recovery"),
  C11: edgeCuts("C11", "lethal-hit", "Lethal hit", "decay", "Decay"),
  C12: edgeCuts("C12", "journey-start", "Journey start", "journey-end", "Journey end"),
  C13: edgeCuts("C13", "pressure-start", "Pressure start", "pressure-settled", "Pressure settled"),
  C14: [checkpoint("recovery-start", "Recovery start", "Confirm the initial recovery world before stepping phases.", 0)],
  C15: [checkpoint("isolation-start", "Isolation start", "Confirm the Live owner before stepping Archive isolation.", 0)],
  C16: edgeCuts("C16", "pressure-opening", "Pressure opening", "pressure-terminal", "Pressure terminal"),
  C17: edgeCuts("C17", "perception", "Perception", "private-settlement", "Private settlement"),
  C18: [
    event("awakening", "The world wakes", "Confirm the cast gathers, hoards, and speaks as the world opens.", 1),
    event("courtship", "Courtship resolved", "Confirm all three mating branches (rejection, timeout, invalidation) and the successful birth.", 14),
    event("home-contest", "Home built and contested", "Confirm the home's build, hearth, hoard, theft, and colonization.", 25),
    event("violence", "Violence and its aftermath", "Confirm the nonlethal attack and rescue, then the lethal attack, death, and decay.", 30),
    event("closing", "Collapse and closing travel", "Confirm the newborn's own home, its collapse, the scavenging, her first steps, and a private thought.", 38),
  ],
  C19: [
    event("homestead", "The first home rises", "Confirm the home is built, tended at its hearth, banked into a hoard, joined, and left.", 10),
    event("courtship", "A courtship ends in birth", "Confirm the whisper, the gift, the rejected proposal, and the successful birth.", 16),
    event("seizure", "The home is seized", "Confirm the home is breached and stripped, then breached again and claimed.", 20),
    event("mercy", "A gift revives him", "Confirm the strike, the fall, and the gift that revives him.", 24),
    event("aftermath", "The survivor picks the ruins", "Confirm the lethal strike, the decay, the collapse, and the scavenging.", 28),
  ],
});

export const CHRONICLE_REVIEW_CUES: Readonly<Record<ChronicleId, readonly AuthoredReviewCue[]>> =
  Object.freeze(Object.fromEntries(CHRONICLE_IDS.map((id) => [
    id,
    Object.freeze(SELECTORS[id].map((selector) => bindSelector(id, selector))),
  ])) as Record<ChronicleId, readonly AuthoredReviewCue[]>);

/** Returns the immutable authored cuts for one deterministic Chronicle. */
export function reviewCuesFor(id: ChronicleId): readonly AuthoredReviewCue[] {
  return CHRONICLE_REVIEW_CUES[id];
}

function bindSelector(id: ChronicleId, selector: CueSelector): AuthoredReviewCue {
  const manifest = getChronicleManifest(id);
  const authority = selector.kind === "event"
    ? manifest.entries.find(({ cursor }) => cursor === selector.cursor)?.event.timestamp
    : manifest.checkpoints.find(({ checkpoint }) => (
        checkpoint.event_cursor === selector.cursor
      ))?.checkpoint.world_time;
  if (authority === undefined) {
    throw new Error(`${id} review cue ${selector.key} lacks exact fixture authority`);
  }
  return Object.freeze({ ...selector, presentedTime: authority });
}

function event(key: string, label: string, instruction: string, cursor: number): CueSelector {
  return Object.freeze({ key, label, instruction, kind: "event", cursor });
}

function checkpoint(key: string, label: string, instruction: string, cursor: number): CueSelector {
  return Object.freeze({ key, label, instruction, kind: "checkpoint", cursor });
}

function edgeCuts(
  id: ChronicleId,
  firstKey: string,
  firstLabel: string,
  lastKey: string,
  lastLabel: string,
): readonly CueSelector[] {
  const entries = getChronicleManifest(id).entries;
  const firstCursor = entries[0]?.cursor;
  const lastCursor = entries.at(-1)?.cursor;
  if (firstCursor === undefined || lastCursor === undefined) {
    throw new Error(`${id} event review cuts require fixture entries`);
  }
  if (firstCursor === lastCursor) {
    return Object.freeze([
      event(firstKey, firstLabel, `Review ${firstLabel.toLowerCase()}.`, firstCursor),
    ]);
  }
  return Object.freeze([
    event(firstKey, firstLabel, `Review ${firstLabel.toLowerCase()}.`, firstCursor),
    event(lastKey, lastLabel, `Review ${lastLabel.toLowerCase()}.`, lastCursor),
  ]);
}
