/**
 * Who is where, and what still stands there.
 *
 * Both the world plate and the region lanes need the same truth — where each
 * being currently is, which bodies are still lying about, which homes stand and
 * which are rubble — so it is computed once, here, by replaying the delivered
 * events over the opening snapshot.
 */

import type { JourneyEvent, JourneyStream } from "./journeyTypes";

export interface Presence {
  /** being id -> region id it currently stands in. */
  readonly region: ReadonlyMap<string, string>;
  /** Beings whose bodies lie in the world, dead but not yet taken. */
  readonly gone: ReadonlySet<string>;
  /** Beings not (or no longer) in the world at all: unborn, or decayed away. */
  readonly absent: ReadonlySet<string>;
  /** Homes standing. */
  readonly built: ReadonlySet<string>;
  /** Homes fallen to ruin. */
  readonly ruined: ReadonlySet<string>;
}

/** Replay the delivered stream into the world's current arrangement. */
export function buildPresence(
  stream: JourneyStream,
  delivered: readonly JourneyEvent[],
): Presence {
  const region = new Map<string, string>();
  const gone = new Set<string>();
  const absent = new Set<string>();
  const built = new Set<string>();
  const ruined = new Set<string>();

  for (const being of stream.beings) {
    region.set(being.id, being.startRegion);
    if (being.bornAtCursor > 0) absent.add(being.id);
  }

  for (const event of delivered) {
    switch (event.type) {
      case "agent_entered_region":
        if (event.actorId !== null && event.regionId !== null) {
          region.set(event.actorId, event.regionId);
        }
        break;
      // The newborn is this event's actor: the new life is its subject.
      case "agent_born":
        if (event.actorId !== null) {
          absent.delete(event.actorId);
          if (event.regionId !== null) region.set(event.actorId, event.regionId);
        }
        break;
      case "agent_died":
        if (event.targetId !== null) gone.add(event.targetId);
        break;
      case "agent_decayed":
        if (event.actorId !== null) {
          gone.delete(event.actorId);
          absent.add(event.actorId);
        }
        break;
      case "home_built":
        if (event.homeId !== null) built.add(event.homeId);
        break;
      case "home_collapsed":
        if (event.homeId !== null) {
          ruined.add(event.homeId);
          built.delete(event.homeId);
        }
        break;
      case "hearth_used":
      case "home_breached":
      case "home_thieved":
      case "home_joined":
      case "home_started_hoarding":
        if (event.homeId !== null && !ruined.has(event.homeId)) built.add(event.homeId);
        break;
      default:
        break;
    }
  }

  return { region, gone, absent, built, ruined };
}

/** Where a standing condition belongs on the board, or null when it is nowhere. */
export function regionForSubject(
  subjectKind: "being" | "home" | "pair",
  subjectId: string,
  fallbackRegion: string | null,
  presence: Presence,
  stream: JourneyStream,
): string | null {
  if (fallbackRegion !== null) return fallbackRegion;
  if (subjectKind === "being") return presence.region.get(subjectId) ?? null;
  if (subjectKind === "home") {
    return stream.homes.find((home) => home.id === subjectId)?.regionId ?? null;
  }
  // A pair: an asking has no region of its own; put it where the asker stands.
  const first = subjectId.split("~")[0];
  return first === undefined ? null : (presence.region.get(first) ?? null);
}
