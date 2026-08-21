/**
 * Shared vocabulary for the live-event-journey design pilot.
 *
 * The pilot compares five *directions* for one surface — the thing a watcher
 * reads while the world runs — under two *conditions* (a burst and a lull).
 * Everything here is derived from real chronicle fixtures; nothing is invented.
 */

import type { ReactNode } from "react";
import type { EventVisualMetadata } from "../../events/eventVisualCatalog";
import type {
  OverlayFamily,
  OverlayGlyph,
  OverlayKind,
  OverlayMappingEntry,
  OverlayTier,
} from "../../presentation/eventLegibilityMap";
import type { PresentedEventType } from "../../presentation/eventPayloads";
import type { Narration } from "./journeyNarrator";

/** The directions under comparison. */
export type JourneyDirection =
  /**
   * The owner's chosen blend: COMPLETE's single ongoing stream and its
   * timestamps, wording and burst headings, wearing REGIONS' cards and rupture
   * breakout. One column, no lanes.
   */
  | "stream"
  /** The owner's combination of curated + complete: cards in per-region lanes. */
  | "regions"
  | "curated"
  | "complete"
  | "threaded"
  | "map-first"
  | "chronicle";

/** The two viewing conditions each direction must survive. */
export type JourneyCondition = "burst" | "lull";

/** Which chronicle fixture supplies the stream. */
export type JourneyStreamId = "C18" | "C19";

/**
 * A standing condition — the half of the world a decaying feed loses.
 *
 * Aviation's Master Caution: the annunciation is transient, the condition is
 * not. Several canonical events are state *transitions*, not moments.
 */
export type JourneyConditionKey =
  | "fallen"
  | "hoarding"
  | "asking"
  | "gone"
  | "vault"
  | "breached"
  | "ruin"
  | "household";

export type JourneySubjectKind = "being" | "home" | "pair";

export interface JourneyStateChange {
  readonly op: "set" | "clear";
  readonly key: JourneyConditionKey;
  readonly subjectKind: JourneySubjectKind;
  /** Being id, home id, or `${a}~${b}` for a pair. */
  readonly subjectId: string;
  /** Rail copy, in-world voice. */
  readonly label: string;
  /** Short rail tag: two or three words. */
  readonly tag: string;
  readonly severity: "grave" | "notable" | "quiet";
}

/** One real fixture event, resolved into everything any direction needs. */
export interface JourneyEvent {
  readonly id: string;
  readonly cursor: number;
  readonly type: PresentedEventType;
  readonly mapping: OverlayMappingEntry;
  readonly catalog: EventVisualMetadata;
  /** Silhouette after the resolver's one promotion: targeted speech is a whisper. */
  readonly kind: OverlayKind;
  readonly glyph: OverlayGlyph;
  readonly family: OverlayFamily;
  readonly tier: OverlayTier;
  readonly accent: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly actorHue: string | null;
  readonly targetId: string | null;
  readonly targetName: string | null;
  readonly targetHue: string | null;
  readonly regionId: string | null;
  readonly regionLabel: string | null;
  readonly homeId: string | null;
  readonly narration: Narration;
  /**
   * Full length of the being's own words, when it had any. With
   * `narration.quote.length` this gives BUBBLE_UI.md §2's fullness bar: the
   * size of a being's inner life, visible without reading a word.
   */
  readonly quoteTotalChars: number | null;
  /** Every being this event is about, actor first. Drives the threaded lanes. */
  readonly participants: readonly string[];
  /** Aggregation key for burst collapsing and count folding. */
  readonly foldKey: string;
  /** Base salience before decay, 0..100. */
  readonly baseSalience: number;
  /** Routine enough to fold into a count rather than a row. */
  readonly routine: boolean;
  readonly stateChange: readonly JourneyStateChange[];
  /** Wall position on the journey clock, in ms, for the active condition. */
  readonly atMs: number;
  /**
   * The event's own raw payload, exactly as the fixture transport delivered it.
   *
   * Carried so the "what exactly happened" drawer can show the simulation's
   * actual figures instead of a richer story than the sim emits. Nothing else
   * reads it; the narrator's prose remains the only viewer-facing voice.
   */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The transport's resolved hints (actor/target/region/home), unmodified. */
  readonly resolved: Readonly<Record<string, unknown>>;
  /** The fixture's own wall timestamp, epoch seconds as the sim emitted it. */
  readonly wallTimestamp: number | null;
  /** Who could perceive this event: the bus scope the sim published it under. */
  readonly scope: string;
  /** The sim-side emitter (tool or subsystem) named in the envelope. */
  readonly source: string;
}

/** A loaded fixture, resolved and ready to schedule. */
export interface JourneyStream {
  readonly id: JourneyStreamId;
  readonly runId: string;
  readonly title: string;
  readonly events: readonly JourneyEvent[];
  readonly beings: readonly JourneyBeing[];
  readonly regions: readonly JourneyRegion[];
  readonly homes: readonly JourneyHome[];
}

/**
 * A PLACE the observer has asked to look at, framed **as it is now**.
 *
 * There is deliberately no "moment" here. A live world has no past to navigate
 * to: the simulation only ever runs forward, and scrubbing exists in this pilot
 * solely because a chronicle is a replay. Designing the primary interaction
 * around rewinding would be designing for the test harness. So a card's target
 * is the *place*, which persists after its moment does — the broken home, the
 * ruin, the vault, the hearth — and what you get is the aftermath.
 */
export interface JourneyPlaceFocus {
  readonly regionId: string | null;
  readonly homeId: string | null;
  /** The card that sent us here, so the lens can name what happened. */
  readonly sourceEventId: string;
}

/**
 * The viewer's playhead over a bounded client-side buffer — the livestream model.
 *
 * The simulation only ever runs forward; the *viewer* is what moves. Already
 * received events sit in a buffer, the playhead reads over them, and LIVE is a
 * jump back to the leading edge — exactly a livestream's DVR window. The buffer
 * is bounded on purpose: this world is meant to run forever, so retention is
 * measured in minutes, not in days.
 */
export interface JourneyPlayhead {
  /** Where the viewer is reading, journey ms. */
  readonly nowMs: number;
  /** The leading edge — where the world has actually got to. */
  readonly liveMs: number;
  /** How far behind the edge the viewer is, journey ms. Zero at the edge. */
  readonly behindMs: number;
  readonly atLive: boolean;
  /** Retention window. Events older than `liveMs - bufferMs` are gone. */
  readonly bufferMs: number;
  /** The oldest journey ms still held. Scrubbing clamps here. */
  readonly floorMs: number;
  /** True when the playhead is sitting on the buffer floor. */
  readonly atFloor: boolean;
  /** Move the playhead and resume playing forward from there. */
  goTo(ms: number): void;
  /** Jump — not fast-forward — back to the leading edge. */
  goLive(): void;
}

/** What every direction receives. Identical inputs; several readings. */
export interface DirectionProps {
  readonly stream: JourneyStream;
  readonly events: readonly JourneyEvent[];
  readonly delivered: readonly JourneyEvent[];
  readonly nowMs: number;
  readonly speed: number;
  readonly condition: JourneyCondition;
  readonly focusEventId: string | null;
  readonly onFocusEvent: (id: string | null) => void;
  /** Journey ms at which the viewer looked away, or null. */
  readonly lastSeenMs: number | null;
  /** Journey ms at which they came back — the catch-up window's close. */
  readonly returnedAtMs: number | null;
  readonly away: boolean;
  /** The shared world plate, already wired. Directions place it as they wish. */
  readonly world: ReactNode;
  /** The place currently framed on the world plate, present tense. */
  readonly placeFocus: JourneyPlaceFocus | null;
  readonly onFocusPlace: (place: JourneyPlaceFocus | null) => void;
  /** The being the plate is currently following to wherever it now stands. */
  readonly followBeingId: string | null;
  readonly onFollowBeing: (beingId: string | null) => void;
  readonly playhead: JourneyPlayhead;
}

export interface JourneyBeing {
  readonly id: string;
  readonly name: string;
  readonly hue: string;
  /** Region at t=0, or the region it is born into. */
  readonly startRegion: string;
  /** Cursor at which it first exists; 0 for the founding cast. */
  readonly bornAtCursor: number;
}

export interface JourneyRegion {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Normalised centre in the world plate, 0..1. */
  readonly x: number;
  readonly y: number;
  readonly ground: string;
  readonly rim: string;
  readonly connections: readonly string[];
}

export interface JourneyHome {
  readonly id: string;
  readonly regionId: string;
  /** Cursor at which it first appears in the stream. */
  readonly firstCursor: number;
}
