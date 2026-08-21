/**
 * The killfeed's bounded, checkpoint-anchored event buffer.
 *
 * ## Why this module exists
 *
 * The design pilot re-derived the world by replaying **from cursor 0** — O(all
 * history since the beginning of the world) — which cannot survive a world built
 * to run forever (`.superpowers/sdd/event-journey-pilot-report.md`, Round 2 §4).
 * The mechanism to fix it already existed and was being thrown away: the
 * transport contract carries periodic `world_snapshot_checkpoint` records, and
 * `PresentedWorldModel` already reconciles them into every frame. A frame's
 * `world.exactBaseCursor` **is** the cursor of the newest checkpoint folded in,
 * and `world.agents`/`homes`/`ruins` at that instant are exact.
 *
 * So this buffer keeps two bounded rings:
 *
 * - **events**, resolved once at arrival and stamped on the feed clock;
 * - **world anchors**, one per distinct `exactBaseCursor` — a checkpoint-exact
 *   presence and standing-condition baseline.
 *
 * Re-deriving the world at any playhead is then "seek the newest anchor at or
 * below the playhead's cursor, replay forward only from there". Replay work is
 * bounded by the *checkpoint interval*, never by the age of the run — proven by
 * `streamBuffer.test.ts`'s 400-event case, which never walks more than 50.
 *
 * ## The bill, measured on the real fixtures
 *
 * One event entry is ~502 B of JSON (703 B max); one world anchor is the
 * checkpoint's own 5–6 KB for four or five beings. At a generous world-wide rate
 * of one event per second with a checkpoint each 60 s, a ten-minute retention
 * window costs about 1 MB and an hour about 6 MB. {@link diagnostics} reports the
 * real figure so this is never again an assertion.
 *
 * Retention is bounded in *time*, not in count, and is configurable
 * ({@link DEFAULT_STREAM_BUFFER_MS}, overridable per instance). One anchor at or
 * below the oldest retained event is always kept, so a viewer who scrubs to the
 * very floor of the buffer can still be shown a truthful world.
 */

import type { EventEnvelopeEntry } from "../../schemas";
import type { PresentedWorldView } from "../../../presentation/contracts";
import type { EntityIdDenylist } from "../publicCopy";
import {
  createStreamNameRegistry,
  toStreamEvent,
  type StreamEvent,
  type StreamNameRegistry,
} from "./streamEvent";
import {
  standingConditions,
  type StandingCondition,
  type StreamStateChange,
} from "./streamSalience";

/** Retention window for the rewind buffer. Minutes, never days. */
export const DEFAULT_STREAM_BUFFER_MS = 90_000;

/** Who is where, and what still stands — the world as a card can talk about it. */
export interface StreamPresence {
  /** Being id to the region it currently stands in. */
  readonly region: ReadonlyMap<string, string>;
  /** Beings whose bodies lie in the world, dead but not yet taken. */
  readonly gone: ReadonlySet<string>;
  /** Beings not (or no longer) in the world at all: unborn, or decayed away. */
  readonly absent: ReadonlySet<string>;
  /** Homes standing. */
  readonly built: ReadonlySet<string>;
  /** Homes fallen to ruin. */
  readonly ruined: ReadonlySet<string>;
  /** Cursor of the checkpoint anchor this derivation started from. */
  readonly anchorCursor: number;
  /** How many buffered events were replayed forward from that anchor. */
  readonly replayedEventCount: number;
}

/** What {@link ChronicleStreamBuffer.ingest} needs from one presented frame. */
export interface StreamIngestInput {
  /** The frame's source key; a change resets the buffer to a new run. */
  readonly sourceKey: string;
  readonly world: PresentedWorldView;
  /** Every event entry the chronicle window currently carries, any order. */
  readonly entries: readonly EventEnvelopeEntry[];
  /** Opaque identifiers the surface must never print; see `publicCopy`. */
  readonly deniedIds: EntityIdDenylist;
}

/** The buffer's own memory and bounding report. */
export interface StreamBufferDiagnostics {
  readonly eventCount: number;
  readonly anchorCount: number;
  readonly anchorCursors: readonly number[];
  /** Events that have aged out of the retention window since the run began. */
  readonly evictedCount: number;
  readonly eventBytes: number;
  readonly anchorBytes: number;
  readonly approxBytes: number;
  readonly bufferMs: number;
  readonly nameCount: number;
}

/** A bounded, checkpoint-anchored view of one run's recent history. */
export interface ChronicleStreamBuffer {
  /** Folds one presented frame's evidence and exact world into the buffer. */
  ingest(input: StreamIngestInput): void;
  /** Retained events, oldest first. */
  getEvents(): readonly StreamEvent[];
  /** Feed-clock position of the newest event received — the live edge. */
  getLiveMs(): number;
  /** Feed-clock position of the oldest retained event — the buffer floor. */
  getFloorMs(): number;
  /** Events that have aged out and are no longer held. */
  getEvictedCount(): number;
  /** Resolves a being id to a display name the world has revealed. */
  nameOf(id: string): string;
  /** The world as it stood at `throughCursor`, anchored on a checkpoint. */
  derivePresence(throughCursor: number): StreamPresence;
  /** The standing conditions true at `throughCursor`, anchored on a checkpoint. */
  deriveStanding(throughCursor: number): readonly StandingCondition[];
  /** The newest event at or before `atMs`, or null when the buffer starts later. */
  cursorAt(atMs: number): number;
  diagnostics(): StreamBufferDiagnostics;
}

export interface ChronicleStreamBufferOptions {
  /** Monotonic feed clock, in milliseconds. Injected so tests are deterministic. */
  readonly now: () => number;
  /** Retention window. Defaults to {@link DEFAULT_STREAM_BUFFER_MS}. */
  readonly bufferMs?: number;
}

interface WorldAnchor {
  readonly exactBaseCursor: number;
  readonly atMs: number;
  readonly presence: BaselinePresence;
  readonly standing: readonly StandingCondition[];
  readonly bytes: number;
}

interface BaselinePresence {
  readonly region: ReadonlyMap<string, string>;
  readonly gone: ReadonlySet<string>;
  readonly absent: ReadonlySet<string>;
  readonly built: ReadonlySet<string>;
  readonly ruined: ReadonlySet<string>;
}

/**
 * Creates one run-scoped killfeed buffer.
 *
 * Side effects: none outside its own closure. It neither subscribes to nor
 * mutates any world state; callers push frames into {@link ChronicleStreamBuffer.ingest}.
 */
export function createChronicleStreamBuffer(
  options: ChronicleStreamBufferOptions,
): ChronicleStreamBuffer {
  const bufferMs = options.bufferMs ?? DEFAULT_STREAM_BUFFER_MS;
  if (!Number.isFinite(bufferMs) || bufferMs <= 0) {
    throw new RangeError("chronicle stream bufferMs must be a positive finite number");
  }

  let sourceKey: string | null = null;
  let names: StreamNameRegistry = createStreamNameRegistry();
  let events: StreamEvent[] = [];
  let anchors: WorldAnchor[] = [];
  let seenCursors = new Set<number>();
  let evictedCount = 0;
  /**
   * High-water mark of everything that has aged out.
   *
   * The chronicle window keeps re-offering its whole set of moments on every
   * frame, so without this an event that had already left the buffer would be
   * taken back and re-stamped with a *current* arrival time — putting an old
   * cursor at the head of the feed clock and, observed in the browser, turning a
   * burst heading into "17 IN -65.8S". A buffer that is a window on the recent
   * past must refuse the past it has already let go.
   */
  let retiredThroughCursor = -1;
  let liveMs = 0;
  let eventBytes = 0;

  const reset = (nextSourceKey: string): void => {
    sourceKey = nextSourceKey;
    names = createStreamNameRegistry();
    events = [];
    anchors = [];
    seenCursors = new Set<number>();
    evictedCount = 0;
    retiredThroughCursor = -1;
    liveMs = options.now();
    eventBytes = 0;
  };

  const retainAnchor = (world: PresentedWorldView, atMs: number): void => {
    const newest = anchors.at(-1);
    if (newest !== undefined && newest.exactBaseCursor >= world.exactBaseCursor) return;
    anchors.push(anchorFrom(world, atMs, names));
  };

  const evict = (): void => {
    const floor = liveMs - bufferMs;
    if (events.length === 0 || (events[0]?.atMs ?? 0) >= floor) return;
    const kept: StreamEvent[] = [];
    for (const event of events) {
      if (event.atMs >= floor) {
        kept.push(event);
        continue;
      }
      evictedCount += 1;
      eventBytes -= approximateEventBytes(event);
      seenCursors.delete(event.cursor);
      retiredThroughCursor = Math.max(retiredThroughCursor, event.cursor);
    }
    events = kept;
    // Keep exactly one anchor at or below the oldest retained event, plus every
    // anchor above it. Without that floor anchor a viewer who scrubs to the edge
    // of the buffer would have nothing truthful to re-derive from.
    const oldestCursor = events[0]?.cursor ?? Number.POSITIVE_INFINITY;
    let floorIndex = 0;
    for (let index = 0; index < anchors.length; index += 1) {
      if ((anchors[index]?.exactBaseCursor ?? 0) <= oldestCursor) floorIndex = index;
      else break;
    }
    anchors = anchors.slice(floorIndex);
  };

  return {
    ingest(input: StreamIngestInput): void {
      if (sourceKey !== input.sourceKey) reset(input.sourceKey);
      const atMs = options.now();
      liveMs = Math.max(liveMs, atMs);
      retainAnchor(input.world, atMs);

      let appended = false;
      for (const entry of [...input.entries].sort((left, right) => left.cursor - right.cursor)) {
        if (seenCursors.has(entry.cursor) || entry.cursor <= retiredThroughCursor) continue;
        const resolved = toStreamEvent(entry, {
          sourceKey: input.sourceKey,
          names,
          atMs,
          deniedIds: input.deniedIds,
        });
        if (resolved === null) continue;
        seenCursors.add(entry.cursor);
        events.push(resolved);
        eventBytes += approximateEventBytes(resolved);
        appended = true;
      }
      if (appended) events.sort((left, right) => left.cursor - right.cursor);
      evict();
    },

    getEvents: () => events,
    getLiveMs: () => liveMs,
    getFloorMs: () => events[0]?.atMs ?? liveMs,
    getEvictedCount: () => evictedCount,
    nameOf: (id) => names.nameOf(id),

    derivePresence(throughCursor: number): StreamPresence {
      const anchor = anchorAtOrBefore(anchors, throughCursor);
      const baseline = anchor?.presence ?? emptyBaseline();
      const region = new Map(baseline.region);
      const gone = new Set(baseline.gone);
      const absent = new Set(baseline.absent);
      const built = new Set(baseline.built);
      const ruined = new Set(baseline.ruined);
      const from = anchor?.exactBaseCursor ?? -1;
      let replayed = 0;
      for (const event of events) {
        if (event.cursor <= from) continue;
        if (event.cursor > throughCursor) break;
        replayed += 1;
        applyPresence(event, { region, gone, absent, built, ruined });
      }
      return Object.freeze({
        region,
        gone,
        absent,
        built,
        ruined,
        anchorCursor: anchor?.exactBaseCursor ?? 0,
        replayedEventCount: replayed,
      });
    },

    deriveStanding(throughCursor: number): readonly StandingCondition[] {
      const anchor = anchorAtOrBefore(anchors, throughCursor);
      const from = anchor?.exactBaseCursor ?? -1;
      const run = events.filter(
        (event) => event.cursor > from && event.cursor <= throughCursor,
      );
      return standingConditions(run, anchor?.standing ?? []);
    },

    cursorAt(atMs: number): number {
      let cursor = 0;
      for (const event of events) {
        if (event.atMs > atMs) break;
        cursor = event.cursor;
      }
      return cursor;
    },

    diagnostics(): StreamBufferDiagnostics {
      const anchorBytes = anchors.reduce((total, anchor) => total + anchor.bytes, 0);
      return Object.freeze({
        eventCount: events.length,
        anchorCount: anchors.length,
        anchorCursors: Object.freeze(anchors.map((anchor) => anchor.exactBaseCursor)),
        evictedCount,
        eventBytes,
        anchorBytes,
        approxBytes: eventBytes + anchorBytes,
        bufferMs,
        nameCount: names.size,
      });
    },
  };
}

function anchorAtOrBefore(
  anchors: readonly WorldAnchor[],
  cursor: number,
): WorldAnchor | null {
  let found: WorldAnchor | null = null;
  for (const anchor of anchors) {
    if (anchor.exactBaseCursor > cursor) break;
    found = anchor;
  }
  return found ?? anchors[0] ?? null;
}

function emptyBaseline(): BaselinePresence {
  return {
    region: new Map(),
    gone: new Set(),
    absent: new Set(),
    built: new Set(),
    ruined: new Set(),
  };
}

interface MutablePresence {
  readonly region: Map<string, string>;
  readonly gone: Set<string>;
  readonly absent: Set<string>;
  readonly built: Set<string>;
  readonly ruined: Set<string>;
}

/** Applies one event's spatial consequence. Mirrors the world's own rules. */
function applyPresence(event: StreamEvent, into: MutablePresence): void {
  switch (event.type) {
    case "agent_entered_region":
      if (event.actorId !== null && event.regionId !== null) {
        into.region.set(event.actorId, event.regionId);
      }
      break;
    // The newborn is this event's actor: the new life is its subject.
    case "agent_born":
      if (event.actorId !== null) {
        into.absent.delete(event.actorId);
        if (event.regionId !== null) into.region.set(event.actorId, event.regionId);
      }
      break;
    case "agent_died":
      if (event.targetId !== null) into.gone.add(event.targetId);
      break;
    case "agent_decayed":
      if (event.actorId !== null) {
        into.gone.delete(event.actorId);
        into.absent.add(event.actorId);
      }
      break;
    case "home_built":
      if (event.homeId !== null) into.built.add(event.homeId);
      break;
    case "home_collapsed":
      if (event.homeId !== null) {
        into.ruined.add(event.homeId);
        into.built.delete(event.homeId);
      }
      break;
    case "hearth_used":
    case "home_breached":
    case "home_thieved":
    case "home_joined":
    case "home_started_hoarding":
      if (event.homeId !== null && !into.ruined.has(event.homeId)) into.built.add(event.homeId);
      break;
    default:
      break;
  }
}

/**
 * Builds one checkpoint-exact anchor from a reconciled world view.
 *
 * Every standing condition the eight-key table can express is readable directly
 * from checkpoint truth — a paralyzed being is *fallen*, a dead one is *gone*, a
 * home with breachers stands *breached*, a hoarding vault *hoards*, a ruin is a
 * *ruin*, and a pending proposal is an *asking*. That is what makes the anchor a
 * true baseline rather than a partial one.
 */
function anchorFrom(
  world: PresentedWorldView,
  atMs: number,
  names: StreamNameRegistry,
): WorldAnchor {
  const region = new Map<string, string>();
  const gone = new Set<string>();
  const absent = new Set<string>();
  const built = new Set<string>();
  const ruined = new Set<string>();
  const standing: StandingCondition[] = [];
  const condition = (
    change: Omit<StreamStateChange, "op">,
    regionId: string | null,
  ): void => {
    standing.push(Object.freeze({
      key: change.key,
      subjectKind: change.subjectKind,
      subjectId: change.subjectId,
      label: change.label,
      tag: change.tag,
      severity: change.severity,
      sinceMs: atMs,
      sourceEventId: `anchor:${world.exactBaseCursor}:${change.key}:${change.subjectId}`,
      regionId,
    }));
  };

  for (const record of world.agents) {
    const id = record.value.id;
    if (typeof id !== "string" || id.length === 0) continue;
    const name = record.value.name;
    if (typeof name === "string" && name.length > 0) names.remember(id, name);
    const displayName = names.nameOf(id);
    const position = typeof record.value.position === "string" ? record.value.position : null;
    if (position !== null) region.set(id, position);
    const where = position === null ? "" : ` at ${titleCase(position)}`;
    switch (record.value.status) {
      case "paralyzed":
        condition({
          key: "fallen",
          subjectKind: "being",
          subjectId: id,
          tag: "fallen",
          label: `${displayName} lies fallen${where}.`,
          severity: "grave",
        }, position);
        break;
      case "dead":
        gone.add(id);
        condition({
          key: "gone",
          subjectKind: "being",
          subjectId: id,
          tag: "gone",
          label: `${displayName}'s body lies${where}.`,
          severity: "grave",
        }, position);
        break;
      default:
        break;
    }
    if (record.value.is_hoarding === true) {
      condition({
        key: "hoarding",
        subjectKind: "being",
        subjectId: id,
        tag: "hoarding",
        label: `${displayName} is hoarding${where}.`,
        severity: "notable",
      }, position);
    }
    // Deliberately NOT seeded from a checkpoint: a checkpoint knows every
    // being's `home_id`, so seeding `household` would put a chip on the strip
    // for every settled being at all times -- the ordinary state of a healthy
    // world, which is precisely what an annunciator must not shout about. The
    // transition (`home_joined` / `home_left`) still raises and clears it while
    // it is news.
  }

  const homes = world.exactHomes ?? world.homes.map((record) => record.value);
  for (const home of homes) {
    const id = home.home_id;
    if (typeof id !== "string" || id.length === 0) continue;
    built.add(id);
    const homeRegion = typeof home.region === "string" ? home.region : null;
    const where = homeRegion === null ? "" : ` at ${titleCase(homeRegion)}`;
    if (Array.isArray(home.breachers) && home.breachers.length > 0) {
      condition({
        key: "breached",
        subjectKind: "home",
        subjectId: id,
        tag: "wall open",
        label: `A home${where} stands breached.`,
        severity: "grave",
      }, homeRegion);
    }
    if (home.is_hoarding === true) {
      condition({
        key: "vault",
        subjectKind: "home",
        subjectId: id,
        tag: "vault hoarding",
        label: `A vault${where} is hoarding.`,
        severity: "notable",
      }, homeRegion);
    }
  }

  const ruins = world.exactRuins ?? world.ruins.map((record) => record.value);
  for (const ruin of ruins) {
    const id = ruin.home_id;
    if (typeof id !== "string" || id.length === 0) continue;
    ruined.add(id);
    built.delete(id);
    const ruinRegion = typeof ruin.region === "string" ? ruin.region : null;
    condition({
      key: "ruin",
      subjectKind: "home",
      subjectId: id,
      tag: "ruin",
      label: `A ruin lies${ruinRegion === null ? "" : ` at ${titleCase(ruinRegion)}`}.`,
      severity: "notable",
    }, ruinRegion);
  }

  for (const proposal of world.pendingProposals) {
    const initiator = proposal.initiator_id;
    const acceptor = proposal.target_id;
    if (typeof initiator !== "string" || typeof acceptor !== "string") continue;
    condition({
      key: "asking",
      subjectKind: "pair",
      subjectId: [initiator, acceptor].sort().join("~"),
      tag: "asking",
      label: `${names.nameOf(initiator)} waits on ${names.nameOf(acceptor)}.`,
      severity: "notable",
    }, region.get(initiator) ?? null);
  }

  return {
    exactBaseCursor: world.exactBaseCursor,
    atMs,
    presence: { region, gone, absent, built, ruined },
    standing: Object.freeze(standing),
    bytes: approximateAnchorBytes(world),
  };
}

function titleCase(id: string): string {
  return id
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Approximate retained size of one event, in bytes.
 *
 * The payload dominates; everything else on a `StreamEvent` is a small fixed set
 * of strings and references into shared frozen tables. Doubling the JSON length
 * is the customary rough conversion from serialized to in-memory size for
 * string-heavy records, and it is labelled *approximate* wherever it is shown.
 */
function approximateEventBytes(event: StreamEvent): number {
  return (JSON.stringify(event.payload)?.length ?? 0) * 2 + 320;
}

/** Approximate retained size of one world anchor, in bytes. */
function approximateAnchorBytes(world: PresentedWorldView): number {
  const records = world.agents.length
    + world.homes.length
    + world.ruins.length
    + (world.exactHomes?.length ?? 0)
    + (world.exactRuins?.length ?? 0)
    + world.pendingProposals.length;
  return records * 320 + 256;
}
