/**
 * One canonical world event, resolved into everything a killfeed card needs.
 *
 * The killfeed reads the same raw evidence the world renderer does — the
 * `EventEnvelopeEntry` records carried on every `StoryMoment` — so the surface is
 * architecturally identical in a live run and in a chronicle replay. Nothing
 * here is fixture-specific: the only inputs are an envelope entry, a name
 * registry, and the feed clock.
 *
 * The shared vocabulary (`EVENT_LEGIBILITY_MAP`, `OVERLAY_FAMILY_ACCENT`,
 * `identityHue`) is read, never redefined, so a card and the world's own overlay
 * mark for the same event carry the same glyph in the same accent.
 */

import type { EventEnvelopeEntry } from "../../schemas";
import { getEventVisualMetadata, type EventVisualMetadata } from "../../../events/eventVisualCatalog";
import {
  EVENT_LEGIBILITY_MAP,
  overlayMappingFor,
  type OverlayFamily,
  type OverlayGlyph,
  type OverlayKind,
  type OverlayMappingEntry,
  type OverlayTier,
} from "../../../presentation/eventLegibilityMap";
import type { PresentedEventType } from "../../../presentation/eventPayloads";
import {
  safePublicCopy,
  safePublicEntityName,
  type EntityIdDenylist,
} from "../publicCopy";
import {
  identityHue,
  OVERLAY_FAMILY_ACCENT,
} from "../../../renderer2d/production/environment/bubbleGrammar";
import { narrateStreamEvent, type Narration } from "./streamNarrator";
import {
  BASE_SALIENCE,
  CARD_POSTURE,
  NOTABLE_FLOOR,
  stateChangesFor,
  type CardPosture,
  type StreamStateChange,
} from "./streamSalience";

/** One resolved event, ready to render as a card and to replay into presence. */
export interface StreamEvent {
  /** Stable identity: the run's source key plus the event's own cursor. */
  readonly id: string;
  readonly cursor: number;
  readonly type: PresentedEventType;
  readonly mapping: OverlayMappingEntry;
  readonly catalog: EventVisualMetadata;
  /** Silhouette after the one presentation promotion: targeted speech whispers. */
  readonly kind: OverlayKind;
  readonly glyph: OverlayGlyph;
  readonly family: OverlayFamily;
  readonly tier: OverlayTier;
  readonly accent: string;
  readonly posture: CardPosture;
  /** True for the minority of cards that earn the taller treatment. */
  readonly notable: boolean;
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
  /** Every being the event is about, actor first, de-duplicated. */
  readonly participants: readonly string[];
  readonly baseSalience: number;
  readonly stateChange: readonly StreamStateChange[];
  /**
   * Feed-clock position, in milliseconds since the killfeed first observed this
   * run. This — not the payload's wall timestamp — is the honest clock for a
   * surface that reads "how long ago did this arrive on my screen", and it
   * behaves identically live and in replay. The fixtures carry only three
   * distinct wall timestamps across 37 entries and so encode no pacing at all.
   */
  readonly atMs: number;
  /** The event's own raw payload, exactly as the transport delivered it. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The fixture's own wall timestamp, epoch seconds, as the sim emitted it. */
  readonly wallTimestamp: number | null;
  /** Who could perceive this event: the bus scope the sim published it under. */
  readonly scope: string;
  /** The sim-side emitter (tool or subsystem) named in the envelope. */
  readonly source: string;
}

/** Resolves being ids to display names, accumulating as the world reveals them. */
export interface StreamNameRegistry {
  /** A display name, or a safe fallback for an id the world has not named. */
  nameOf(id: string): string;
  /** Records a name the world has just revealed. Later names win. */
  remember(id: string, name: string): void;
  /** How many names are held — reported in the buffer's memory diagnostics. */
  readonly size: number;
}

/** Creates an empty, mutable being-name registry. */
export function createStreamNameRegistry(): StreamNameRegistry {
  const names = new Map<string, string>();
  return {
    nameOf: (id) => names.get(id) ?? "someone",
    remember: (id, name) => {
      if (id.length > 0 && name.length > 0) names.set(id, name);
    },
    get size(): number {
      return names.size;
    },
  };
}

/** `warm_springs` -> `Warm Springs`; null passes through. */
export function regionLabelOf(id: string | null | undefined): string | null {
  if (id === null || id === undefined || id.length === 0) return null;
  return id
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Three-character region tag for the card's meta line: `WSP`, `NIR`, `NEA`. */
export function regionTag(regionId: string | null): string {
  if (regionId === null) return "···";
  const parts = regionId.split("_");
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 3).toUpperCase();
  return `${(parts[0] ?? "").slice(0, 1)}${(parts[1] ?? "").slice(0, 2)}`.toUpperCase();
}

function readString(source: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringArray(
  source: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Actor id, correcting the two resolved-hint quirks the transport carries:
 * `agent_paralyzed` resolves its actor to `"system"`, and `agent_died` resolves
 * both actor and target to the victim while the killer lives in the payload.
 */
function actorIdFor(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  resolvedActor: string | null,
): string | null {
  switch (type) {
    case "agent_paralyzed":
      return readString(payload, "attacker_id") ?? readString(payload, "agent_id");
    case "agent_died":
      return readString(payload, "killer_id") ?? readString(payload, "victim_id");
    case "agent_born":
      return readString(payload, "child_id") ?? readString(payload, "initiator_id");
    case "home_collapsed":
      return readString(payload, "owner_id");
    case "simulation_started":
      return null;
    default:
      return resolvedActor === "system" || resolvedActor === "world" ? null : resolvedActor;
  }
}

function targetIdFor(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  resolvedTarget: string | null,
  actorId: string | null,
): string | null {
  const candidate = ((): string | null => {
    switch (type) {
      case "agent_paralyzed":
        return readString(payload, "victim_id") ?? readString(payload, "agent_id");
      case "agent_died":
        return readString(payload, "victim_id");
      // The newborn IS the row's subject; naming it twice reads as an act
      // done to itself.
      case "agent_born":
        return null;
      case "agent_recovered":
        return readString(payload, "revived_id") ?? readString(payload, "recipient_id");
      case "mating_rejected":
        return readString(payload, "initiator_id");
      default:
        return resolvedTarget;
    }
  })();
  return candidate !== null && candidate === actorId ? null : candidate;
}

/** Every being the event is about, actor first, de-duplicated. */
function participantsFor(
  type: string,
  payload: Readonly<Record<string, unknown>>,
  actorId: string | null,
  targetId: string | null,
): readonly string[] {
  const out: string[] = [];
  const push = (value: string | null): void => {
    if (value !== null && value !== "system" && value !== "world" && !out.includes(value)) {
      out.push(value);
    }
  };
  push(actorId);
  push(targetId);
  switch (type) {
    case "agent_born":
      for (const parent of readStringArray(payload, "parent_ids")) push(parent);
      break;
    case "home_thieved":
      for (const person of readStringArray(payload, "recipients")) push(person);
      break;
    case "home_breached":
      for (const person of readStringArray(payload, "breachers")) push(person);
      break;
    case "home_built":
    case "home_joined":
    case "home_left":
      push(readString(payload, "owner_id"));
      break;
    case "home_colonized":
      push(readString(payload, "previous_owner_id"));
      push(readString(payload, "new_owner_id"));
      break;
    default:
      break;
  }
  return Object.freeze(out);
}

/**
 * The one presentation promotion the legibility map defers to the resolver: a
 * same-region targeted line is a whisper, a broadcast is speech.
 */
function kindFor(type: PresentedEventType, targetId: string | null): OverlayKind {
  if (type === "speak" && targetId !== null) return "whisper";
  return EVENT_LEGIBILITY_MAP[type].kind;
}

function glyphFor(kind: OverlayKind, mapped: OverlayGlyph | null): OverlayGlyph {
  if (mapped !== null) return mapped;
  return kind === "thought" ? "ellipsis" : "quote";
}

/** Harvests every display name this entry reveals, so later cards can use it. */
export function rememberNamesFrom(
  entry: EventEnvelopeEntry,
  registry: StreamNameRegistry,
): void {
  const payload = entry.event.payload;
  const pairs: readonly (readonly [string, string])[] = [
    ["child_id", "child_name"],
    ["victim_id", "victim_name"],
    ["agent_id", "agent_name"],
  ];
  for (const [idKey, nameKey] of pairs) {
    const id = readString(payload, idKey);
    const name = readString(payload, nameKey);
    if (id !== null && name !== null) registry.remember(id, name);
  }
}

/** Everything {@link toStreamEvent} needs beyond the entry itself. */
export interface StreamEventContext {
  /** Distinguishes runs so two chronicles cannot collide on cursor alone. */
  readonly sourceKey: string;
  readonly names: StreamNameRegistry;
  /** Feed-clock milliseconds at which this event was first presented. */
  readonly atMs: number;
  /**
   * Opaque entity identifiers this surface must never print.
   *
   * The killfeed narrates raw evidence, so it is held to exactly the same public
   * copy contract as every other observer surface: every name and every sentence
   * is passed through `publicCopy`, which rejects infrastructure detail, filesystem
   * paths, and both denylisted and id-shaped strings.
   */
  readonly deniedIds: EntityIdDenylist;
}

/**
 * Resolves one envelope entry into a renderable, replayable {@link StreamEvent}.
 *
 * Returns null for an entry whose type is outside the canonical 28 — the
 * killfeed shows every event the world *has a vocabulary for* and silently
 * ignores anything it cannot name, rather than rendering a blank card.
 *
 * Side effects: none beyond `context.names.remember` for names this entry
 * reveals (see {@link rememberNamesFrom}).
 */
export function toStreamEvent(
  entry: EventEnvelopeEntry,
  context: StreamEventContext,
): StreamEvent | null {
  const type = entry.event.type;
  const mapping = overlayMappingFor(type);
  const catalog = getEventVisualMetadata(type);
  if (mapping === undefined || catalog === undefined) return null;

  rememberNamesFrom(entry, context.names);

  const presented = type as PresentedEventType;
  const payload = entry.event.payload;
  const actorId = actorIdFor(type, payload, entry.resolved.actor_id ?? null);
  const targetId = targetIdFor(type, payload, entry.resolved.target_id ?? null, actorId);
  const regionId = entry.resolved.region
    ?? entry.event.region
    ?? readString(payload, "region");
  const homeId = entry.resolved.home_id ?? readString(payload, "home_id");
  const kind = kindFor(presented, targetId);
  const regionLabel = regionLabelOf(regionId);
  const nameOf = (id: string): string =>
    safePublicEntityName(context.deniedIds, context.names.nameOf(id));

  const narrated = narrateStreamEvent({
    type,
    payload,
    actorName: actorId === null ? null : nameOf(actorId),
    targetName: targetId === null ? null : nameOf(targetId),
    regionLabel,
    nameOf,
  });
  const narration: Narration = Object.freeze({
    verb: narrated.verb,
    line: safePublicCopy(narrated.line, "Something happened.", context.deniedIds),
    detail: narrated.detail === null
      ? null
      : safePublicCopy(narrated.detail, "", context.deniedIds) || null,
    quote: narrated.quote === null
      ? null
      : safePublicCopy(narrated.quote, "", context.deniedIds) || null,
  });

  const baseSalience = BASE_SALIENCE[presented] ?? 30;
  return Object.freeze({
    id: `${context.sourceKey}:${entry.cursor}`,
    cursor: entry.cursor,
    type: presented,
    mapping,
    catalog,
    kind,
    glyph: glyphFor(kind, mapping.glyph),
    family: mapping.family,
    tier: mapping.tier,
    accent: OVERLAY_FAMILY_ACCENT[mapping.family],
    posture: CARD_POSTURE[presented] ?? "progress",
    notable: mapping.tier === "knell"
      || mapping.tier === "strike"
      || baseSalience >= NOTABLE_FLOOR,
    actorId,
    actorName: actorId === null ? null : nameOf(actorId),
    actorHue: actorId === null ? null : identityHue(actorId),
    targetId,
    targetName: targetId === null ? null : nameOf(targetId),
    targetHue: targetId === null ? null : identityHue(targetId),
    regionId: regionId ?? null,
    regionLabel,
    homeId,
    narration,
    participants: participantsFor(type, payload, actorId, targetId),
    baseSalience,
    stateChange: stateChangesFor(presented, {
      actorId,
      targetId,
      homeId,
      payload,
      regionLabel,
      nameOf,
    }),
    atMs: context.atMs,
    payload,
    wallTimestamp: typeof entry.event.timestamp === "number" ? entry.event.timestamp : null,
    scope: entry.event.scope,
    source: entry.event.source,
  });
}
