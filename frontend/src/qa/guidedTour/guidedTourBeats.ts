/**
 * Pure derivation of a "guided tour" beat list from a Chronicle fixture.
 *
 * The Chronicle validation QA route can already play a fixture end-to-end, but at
 * default framing a human reviewer sees tiny distant sprites, an off-center camera,
 * sub-second effects, no event labels, and long dead-travel gaps. This module turns
 * one Chronicle's raw entries into an ordered list of watchable "beats" — one per
 * fixture entry, each carrying the region to observe, the being/home/ruin to focus
 * the camera on, a human caption, and how long to hold on the beat — so a QA-only
 * guided-tour controller (see `guidedTourController.ts`) can drive the observer
 * shell/camera through the whole Chronicle without a human hand on the wheel.
 *
 * This module reads only `ChronicleManifest` data (no live app/runtime state), so
 * every beat is a deterministic, unit-testable function of the fixture.
 */

import type { ChronicleManifest } from "../../presentation/fixtures/chronicleCatalog";
import type { EventEnvelopeEntry } from "../../app/schemas";

/** What the guided-tour camera should center on for one beat. */
export interface GuidedTourFocus {
  readonly kind: "agent" | "home" | "ruin";
  readonly id: string;
}

/** One watchable step of a guided tour: one fixture entry, fully described for humans. */
export interface GuidedTourBeat {
  readonly index: number;
  readonly total: number;
  readonly cursor: number;
  readonly presentedTime: number;
  readonly type: string;
  readonly region: string;
  readonly focus: GuidedTourFocus | null;
  readonly participants: string;
  /** Every named participant's display name (source, target, and payload-array roles), in narrative order. */
  readonly participantNames: readonly string[];
  readonly watchLine: string;
  readonly holdMs: number;
  readonly isDeadTravel: boolean;
  readonly caption: string;
}

const DEFAULT_HOLD_MS = 3_000;
const DEAD_TRAVEL_HOLD_MS = 1_200;
const DEAD_TRAVEL_TYPES = new Set(["agent_left_region", "agent_entered_region"]);

/** Authored "what to watch" line + named participants for one C18 cursor. */
interface AuthoredBeatContent {
  readonly participantIds: readonly string[];
  readonly watchLine: string;
}

// Authored directly against docs/frontend/EVENT_PERFORMANCE_MATRIX.md's "Rendered
// performance" column plus the C18 fixture's own story beats (Joe/Mae/Dick/Allen/
// Martha). Keyed by cursor because several event types repeat with distinct
// narrative meaning in C18 (four mating_initiated branches, two home_built, two
// home_breached, two home_collapsed) and a generic per-type line would flatten that.
const C18_BEAT_CONTENT: Readonly<Record<number, AuthoredBeatContent>> = Object.freeze({
  1: { participantIds: [], watchLine: "the world wakes as the cast gathers" },
  2: { participantIds: ["wanderer_001"], watchLine: "Joe harvests energy at the springs" },
  3: { participantIds: ["wanderer_001"], watchLine: "Joe harvests materials at the springs" },
  4: { participantIds: ["wanderer_001"], watchLine: "Joe sits atop a hoard — watch the hoarding badge appear" },
  5: { participantIds: ["wanderer_003"], watchLine: "Dick speaks aloud to the region" },
  6: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick turns to whisper to Allen" },
  7: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick proposes to Allen — watch the mutual turn and the proposal arc (about to be rejected)" },
  8: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen rejects Dick's proposal — refunded resources arc back" },
  9: { participantIds: ["wanderer_003", "wanderer_002"], watchLine: "Dick proposes to distant Mae (about to time out)" },
  10: { participantIds: ["wanderer_003", "wanderer_002"], watchLine: "Dick's proposal to Mae times out — the refund token fades" },
  11: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick tries Allen once more (about to be invalidated)" },
  12: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick's second proposal is invalidated — he's no longer eligible to mate" },
  13: { participantIds: ["wanderer_004", "wanderer_002"], watchLine: "Allen proposes to Mae — this is the one that succeeds" },
  14: { participantIds: ["wanderer_004", "wanderer_002", "wisdom_de34"], watchLine: "Martha is born beside her parents in warm_springs" },
  15: { participantIds: ["wanderer_001"], watchLine: "Joe raises a home, stage by stage — foundation to door" },
  16: { participantIds: ["wanderer_002"], watchLine: "Mae pledges to Joe's home" },
  17: { participantIds: ["wanderer_001"], watchLine: "Joe rests at the hearth, kindling materials into warmth" },
  18: { participantIds: ["wanderer_001"], watchLine: "the home sits on a great store of materials — watch the hoard badge" },
  19: { participantIds: ["wanderer_002"], watchLine: "Mae leaves the home" },
  20: { participantIds: ["wanderer_002"], watchLine: "Mae departs warm_springs for nirvana" },
  21: { participantIds: ["wanderer_002"], watchLine: "Mae arrives in nirvana" },
  22: { participantIds: ["wanderer_002"], watchLine: "Mae breaks into a home to thieve" },
  23: { participantIds: ["wanderer_002", "wanderer_004"], watchLine: "Mae and Allen strip the home's vault — watch the labeled loot arcs" },
  24: { participantIds: ["wanderer_004"], watchLine: "Allen breaks into a home to colonize" },
  25: { participantIds: ["wanderer_004", "wanderer_002"], watchLine: "Allen and Mae seize ownership of the home" },
  26: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick attacks Allen — watch the knockback and camera shake" },
  27: { participantIds: ["wanderer_004"], watchLine: "Allen collapses, paralyzed" },
  28: { participantIds: ["wanderer_002", "wanderer_004"], watchLine: "Mae revives Allen" },
  29: { participantIds: ["wanderer_002", "wanderer_004"], watchLine: "Mae sends Allen energy — both turn to face each other" },
  30: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen kills Dick — the lethal blow" },
  31: { participantIds: ["wisdom_de34"], watchLine: "Martha raises a home of her own — foundation to door, with no one to keep it" },
  32: { participantIds: ["wanderer_003"], watchLine: "Dick's remains return to the earth" },
  33: { participantIds: ["wanderer_003"], watchLine: "Dick's former home crumbles to ruin" },
  34: { participantIds: ["wisdom_de34"], watchLine: "Martha's home crumbles to ruin" },
  35: { participantIds: ["wanderer_001"], watchLine: "Joe picks materials from the ruins" },
  36: { participantIds: ["wisdom_de34"], watchLine: "Martha's private thought — only visible because she's selected" },
  37: { participantIds: ["wisdom_de34"], watchLine: "Martha departs warm_springs for nirvana_east" },
  38: { participantIds: ["wisdom_de34"], watchLine: "Martha arrives in nirvana_east — the tour's final step" },
});

// Authored against the C19 fixture's own 28 entries
// (tests/frontend-app/fixtures/chronicles/data/C19-two-beings.json) plus
// docs/frontend/EVENT_PERFORMANCE_MATRIX.md's "Rendered performance" column. C19 is
// the primary two-being demonstration chronicle (Dick/Allen, one region — no
// cross-region travel, so none of C18's dead-travel or region-settlement beats
// apply here): every line describes the on-screen PERFORMANCE, not the event name,
// naming Dick or Allen (and Angela once she's born at cursor 16) directly. Keyed by
// cursor for the same reason as C18 — several event types repeat with distinct
// narrative meaning (two `mating_initiated`, two `home_breached`, a gift that is
// both a `resource_transferred` and, moments later, the literal transfer backing
// `agent_recovered`).
const C19_BEAT_CONTENT: Readonly<Record<number, AuthoredBeatContent>> = Object.freeze({
  1: { participantIds: ["wanderer_003"], watchLine: "Dick speaks aloud to the region — watch the dialogue bubble and speech arc as he declares he'll stay and build" },
  2: { participantIds: ["wanderer_004"], watchLine: "Allen's private thought — select him to see the thought bubble: he's already eyeing a home of his own" },
  3: { participantIds: ["wanderer_003"], watchLine: "Dick gathers energy at the springs — watch him walk to the patch and work" },
  4: { participantIds: ["wanderer_003"], watchLine: "Dick gathers materials too — one more haul before he crosses the hoarding line" },
  5: { participantIds: ["wanderer_003"], watchLine: "Dick crosses the hoarding threshold — watch the hoarding badge settle over him" },
  6: { participantIds: ["wanderer_003"], watchLine: "Dick raises a home — watch him work at the frame until the walls stand" },
  7: { participantIds: ["wanderer_003"], watchLine: "Dick tends his own hearth — watch the reach gesture at the door as materials kindle into warmth" },
  8: { participantIds: ["wanderer_003"], watchLine: "The vault fills past its threshold — watch the hoard badge appear over the home itself" },
  9: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen pledges to Dick's home — watch him walk to the door and step inside" },
  10: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen leaves the home just as quickly — watch him step back out the door" },
  11: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen turns to whisper to Dick — watch him orient toward Dick before he speaks; the words are private, the turn is not" },
  12: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen hands Dick a gift of materials — watch both turn to face each other as the particle passes between them" },
  13: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen proposes to Dick — watch the mutual turn and the proposal arc (this first ask is about to be refused)" },
  14: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick turns him down — watch the refund arc carry Allen's committed resources back to him" },
  15: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen asks again, in earnest — the same proposal arc, this time about to succeed" },
  16: { participantIds: ["wanderer_004", "wanderer_003", "wanderer_3ff6"], watchLine: "Angela is born at Dick's side — watch her sprite fade in beside him, already full-sized" },
  17: { participantIds: ["wanderer_004"], watchLine: "Allen breaks into the home he once shared — watch him work at the door as the walls flash with damage" },
  18: { participantIds: ["wanderer_004"], watchLine: "Allen strips the vault bare — watch the labeled loot arc carry all 300 materials to him" },
  19: { participantIds: ["wanderer_004"], watchLine: "Allen breaks in a second time, now to claim the home outright — the same work-and-damage beat replays" },
  20: { participantIds: ["wanderer_004"], watchLine: "Allen claims the home as his own — watch the claim mark settle over the walls Dick once raised" },
  21: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen strikes Dick — watch the recoil and the red flash" },
  22: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick collapses, paralyzed — watch him crumple into the pulsing prone tint" },
  23: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "Allen kneels to revive Dick — watch the prone tint fade and lift as he recovers" },
  24: { participantIds: ["wanderer_004", "wanderer_003"], watchLine: "The same gift registers as a resource transfer too — watch both turn fully to face each other as the energy arcs across" },
  25: { participantIds: ["wanderer_003", "wanderer_004"], watchLine: "Dick lands the lethal blow — watch Allen fall and stay down, tinted and rotated where he lies" },
  26: { participantIds: ["wanderer_004"], watchLine: "Allen's remains return to the earth — watch the dust rise as his corpse is swept from the world" },
  27: { participantIds: ["wanderer_004"], watchLine: "Allen's home falls: with no living stakeholder the world lets it go — watch the vignette wash and the walls swap to ruin" },
  28: { participantIds: ["wanderer_003"], watchLine: "Dick, the sole survivor, picks over the ruins — watch him work the wreckage and reach for what's left" },
});

// Registry of every chronicle with hand-authored beat content, keyed by chronicle
// id. Adding a new chronicle's authored content means adding one entry here — no
// new `manifest.id === "..."` branch in `deriveGuidedTourBeats` itself. A chronicle
// absent from this map (or a cursor absent from its table) falls through to
// `genericWatchLine` below; the payload-driven `allParticipantIds` scan still runs
// for every chronicle regardless, so participant completeness never depends on
// whether a chronicle has authored prose.
const CHRONICLE_BEAT_CONTENT: Readonly<Record<string, Readonly<Record<number, AuthoredBeatContent>>>> =
  Object.freeze({
    C18: C18_BEAT_CONTENT,
    C19: C19_BEAT_CONTENT,
  });

/** Derives the full, ordered, watchable guided-tour beat list for one Chronicle. */
export function deriveGuidedTourBeats(manifest: ChronicleManifest): readonly GuidedTourBeat[] {
  const nameById = buildNameIndex(manifest);
  const regionByCursor = computeRegionByCursor(manifest);
  const total = manifest.entries.length;
  return manifest.entries.map((entry, position) => {
    const region = regionByCursor.get(entry.cursor) ?? "";
    const focus = focusFor(entry, nameById);
    const content = CHRONICLE_BEAT_CONTENT[manifest.id]?.[entry.cursor];
    // Union the authored (narrative-ordered) list, when one exists, with everything
    // resolvable straight from the event's own fields — the authored table is
    // hand-curated prose and has proven incomplete (e.g. C18 cursors 22/24's
    // co-breacher was missing from hand-authored content until this was added; see
    // the guided-tour report's "Review fixes" section). The payload scan is the
    // source of truth for *completeness*; the authored list only supplies nicer
    // narrative ordering when both agree.
    const participantIds = mergeParticipantIds(
      content?.participantIds,
      allParticipantIds(entry, nameById),
    );
    const watchLine = content?.watchLine ?? genericWatchLine(entry);
    const isDeadTravel = DEAD_TRAVEL_TYPES.has(entry.event.type);
    const index = position + 1;
    return Object.freeze({
      index,
      total,
      cursor: entry.cursor,
      presentedTime: entry.event.timestamp,
      type: entry.event.type,
      region,
      focus,
      participants: formatParticipants(participantIds, nameById),
      participantNames: participantIds.map((id) => nameById.get(id) ?? id),
      watchLine,
      holdMs: isDeadTravel ? DEAD_TRAVEL_HOLD_MS : DEFAULT_HOLD_MS,
      isDeadTravel,
      caption: `beat ${index}/${total} — ${entry.event.type} · ${region || "(unresolved region)"}`,
    });
  });
}

/** Maps every agent ID known by the end of the Chronicle to its display name. */
function buildNameIndex(manifest: ChronicleManifest): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const agent of manifest.initialSnapshot.agents) names.set(agent.id, agent.name);
  for (const entry of manifest.entries) {
    if (entry.event.type !== "agent_born") continue;
    const childId = entry.resolved.actor_id;
    const childName = stringField(entry.event.payload, "child_name");
    if (childId !== undefined && childName !== null) names.set(childId, childName);
  }
  return names;
}

/**
 * Resolves the region to observe for every cursor in cursor order.
 *
 * Prefers the fixture's own authoritative `resolved.region` hint. Several
 * TARGETED/PRIVATE-scoped event types (the mating courtship chain, `self_talk`)
 * carry no region at all — for those this walks a simulated per-agent position
 * map (seeded from the initial snapshot, updated on `agent_entered_region` and
 * `agent_born`) to find where the acting being currently stands. Any cursor that
 * still can't resolve a region (only `simulation_started`, which has no agent
 * actor) is backfilled from the nearest following resolved beat, so no beat is
 * ever left pointed at an empty/unresolved region.
 */
function computeRegionByCursor(manifest: ChronicleManifest): ReadonlyMap<number, string> {
  const positions = new Map<string, string>(
    manifest.initialSnapshot.agents.map((agent) => [agent.id, agent.position]),
  );
  const regionByCursor = new Map<number, string | null>();

  for (const entry of manifest.entries) {
    const region = entry.resolved.region
      ?? lookupPosition(positions, entry.resolved.actor_id)
      ?? lookupPosition(positions, entry.resolved.target_id)
      ?? null;
    regionByCursor.set(entry.cursor, region);
    if (region === null) continue;
    if (entry.event.type === "agent_entered_region" || entry.event.type === "agent_born") {
      const subjectId = entry.resolved.actor_id;
      if (subjectId !== undefined) positions.set(subjectId, region);
    }
  }

  let carry: string | null = null;
  const resolved = new Map<number, string>();
  for (let index = manifest.entries.length - 1; index >= 0; index -= 1) {
    const entry = manifest.entries[index]!;
    const region = regionByCursor.get(entry.cursor) ?? null;
    if (region !== null) {
      carry = region;
      resolved.set(entry.cursor, region);
    } else {
      resolved.set(entry.cursor, carry ?? "");
    }
  }
  return resolved;
}

function lookupPosition(positions: ReadonlyMap<string, string>, id: string | undefined): string | null {
  if (id === undefined) return null;
  return positions.get(id) ?? null;
}

/**
 * Resolves the camera-focus subject for one beat.
 *
 * Structure events with no living actor on screen (`home_collapsed`, whose only
 * choreography is a vignette + ruin-sprite swap, per EVENT_PERFORMANCE_MATRIX.md
 * A6) focus the ruin/home site itself rather than a stale or absent actor.
 * `simulation_started` has no actor at all, so it has no focus (the establishing
 * shot stays wherever the camera already is). Every other event focuses the acting
 * being (`resolved.actor_id`), falling back to `resolved.target_id` when the actor
 * isn't a known agent (e.g. `agent_paralyzed`'s `source: "system"` breath-trigger
 * path) or, for `agent_born`, the accepting parent (the newborn's own sprite fades
 * in mid-choreography and may not exist yet the instant the beat starts).
 */
function focusFor(
  entry: EventEnvelopeEntry,
  nameById: ReadonlyMap<string, string>,
): GuidedTourFocus | null {
  if (entry.event.type === "simulation_started") return null;
  if (entry.event.type === "home_collapsed") {
    const homeId = entry.resolved.home_id;
    return homeId === undefined ? null : { kind: "ruin", id: homeId };
  }
  if (entry.event.type === "agent_born") {
    const acceptorId = stringField(entry.event.payload, "acceptor_id");
    if (acceptorId !== null && nameById.has(acceptorId)) return { kind: "agent", id: acceptorId };
  }
  const actorId = entry.resolved.actor_id;
  if (actorId !== undefined && nameById.has(actorId)) return { kind: "agent", id: actorId };
  const targetId = entry.resolved.target_id;
  if (targetId !== undefined && nameById.has(targetId)) return { kind: "agent", id: targetId };
  return null;
}

// Every event-payload field that can name an agent participant beyond
// `resolved.actor_id`/`resolved.target_id` — singular IDs and the ID arrays used
// by paired/group choreography (mating, birth, combat, transfers, and home
// contest's collective staging: build/join/leave/breach/thieve/colonize). This
// list is not invented: it is exactly the set of payload fields
// `homeContestSystem.ts` and `lifecycleMovementCommunicationResource.ts` (G2's own
// production choreography) read to stage participants for these event types —
// e.g. `home_colonized` stages `new_owner_id`/`new_stakeholders` but deliberately
// *not* `previous_owner_id`/`previous_stakeholders` (those back a text diagnostic
// only, the dispossessed former owner isn't staged as present), so this resolver
// doesn't stage them as bounding-box participants either. Kept as a flat allowlist
// (rather than a per-event-type map) because it costs nothing to check a field
// that isn't present, and a new event type that reuses an existing field name is
// picked up automatically.
const PARTICIPANT_ID_FIELDS: readonly string[] = [
  "agent_id", "builder_id", "owner_id", "new_owner_id",
  "breacher_id", "attacker_id", "killer_id", "victim_id",
  "giver_id", "recipient_id", "sender_id", "receiver_id",
  "initiator_id", "acceptor_id", "child_id", "speaker_id",
];
const PARTICIPANT_ID_ARRAY_FIELDS: readonly string[] = [
  "parent_ids", "stakeholders", "breachers", "recipients", "new_stakeholders",
];

/**
 * Resolves every named agent participant for one event: `resolved.actor_id` and
 * `resolved.target_id` first (narrative-primary), then every other known
 * participant-id field or id-array field present in the raw event payload. Only
 * IDs that resolve to a known agent name are kept — this is what filters out
 * unrelated payload fields (home IDs, resource type strings, free-text messages)
 * without needing a per-event-type field map.
 */
function allParticipantIds(
  entry: EventEnvelopeEntry,
  nameById: ReadonlyMap<string, string>,
): readonly string[] {
  const ids: string[] = [entry.resolved.actor_id, entry.resolved.target_id]
    .filter((id): id is string => id !== undefined);
  const payload = entry.event.payload;
  for (const field of PARTICIPANT_ID_FIELDS) {
    const value = payload[field];
    if (typeof value === "string") ids.push(value);
  }
  for (const field of PARTICIPANT_ID_ARRAY_FIELDS) {
    const value = payload[field];
    if (!Array.isArray(value)) continue;
    for (const item of value) if (typeof item === "string") ids.push(item);
  }
  return [...new Set(ids)].filter((id) => nameById.has(id));
}

/** Unions an optional authored (narrative-ordered) ID list with the payload-resolved set, authored order first. */
function mergeParticipantIds(
  authored: readonly string[] | undefined,
  resolved: readonly string[],
): readonly string[] {
  const ordered = [...(authored ?? []), ...resolved];
  return [...new Set(ordered)];
}

function genericWatchLine(entry: EventEnvelopeEntry): string {
  return `${entry.event.type.replaceAll("_", " ")} at ${entry.resolved.region ?? "an unresolved region"}`;
}

function formatParticipants(ids: readonly string[], nameById: ReadonlyMap<string, string>): string {
  const names = ids.map((id) => nameById.get(id) ?? id);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} → ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

function stringField(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}
