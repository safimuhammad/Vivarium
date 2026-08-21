/**
 * Loads a real chronicle fixture and resolves it into `JourneyEvent`s.
 *
 * The events are the fixtures' own: this module drains `createFixtureTransport`
 * — the same transport the chronicle QA route replays through — and then
 * enriches each entry with the legibility grammar (`EVENT_LEGIBILITY_MAP`), the
 * visual catalogue, resolved names, and the salience/state metadata the five
 * directions read. Nothing is fabricated; only *arrival timing* is the pilot's
 * (see `journeySchedule.ts`), because the fixtures carry three distinct
 * timestamps across 37 entries and therefore encode no pacing of their own.
 */

import type { EventEnvelope, RunMetadata, WorldSnapshot } from "../../app/schemas";
import { getEventVisualMetadata } from "../../events/eventVisualCatalog";
import {
  EVENT_LEGIBILITY_MAP,
  overlayMappingFor,
  type OverlayGlyph,
  type OverlayKind,
} from "../../presentation/eventLegibilityMap";
import type { PresentedEventType } from "../../presentation/eventPayloads";
import {
  getChronicleManifest,
  type ChronicleId,
} from "../../presentation/fixtures/chronicleCatalog";
import { createFixtureTransport } from "../../presentation/fixtures/FixtureTransport";
import {
  identityHue,
  OVERLAY_FAMILY_ACCENT,
} from "../../renderer2d/production/environment/bubbleGrammar";
import { narrateJourneyEvent } from "./journeyNarrator";
import { BASE_SALIENCE, ROUTINE_CEILING, stateChangesFor } from "./journeySalience";
import type {
  JourneyBeing,
  JourneyEvent,
  JourneyHome,
  JourneyRegion,
  JourneyStream,
  JourneyStreamId,
} from "./journeyTypes";

/** `warm_springs` -> `Warm Springs`. Mirrors observer2d's private helper. */
export function regionLabelOf(id: string | null | undefined): string | null {
  if (id === null || id === undefined || id.length === 0) return null;
  return id
    .split(/[_-]+/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Where each region sits on the pilot's world plate, and how it is tinted.
 *
 * Positions follow MAP.md's archipelago reading (a centre, a refuge to the
 * south, two thin marches east and west); tints follow each region's own
 * `description` string in the fixture snapshot.
 */
const REGION_PLATE: Readonly<Record<string, { x: number; y: number; ground: string; rim: string }>> =
  Object.freeze({
    nirvana: { x: 0.5, y: 0.29, ground: "#5d6b45", rim: "#7d8c5c" },
    nirvana_east: { x: 0.845, y: 0.47, ground: "#7a6c46", rim: "#9a8a5c" },
    nirvana_west: { x: 0.155, y: 0.6, ground: "#4f4d48", rim: "#6b675f" },
    warm_springs: { x: 0.5, y: 0.775, ground: "#3f7370", rim: "#5c9b96" },
  });

const FALLBACK_PLATE = { x: 0.5, y: 0.5, ground: "#55584a", rim: "#75786a" } as const;

const STREAM_TITLES: Readonly<Record<JourneyStreamId, string>> = Object.freeze({
  C18: "Grand tour · all 28 kinds · four regions · five beings",
  C19: "Two beings · one region · a life and a death",
});

interface DrainedFixture {
  readonly snapshot: WorldSnapshot;
  readonly entries: readonly EventEnvelope["events"][number][];
}

/** Drain a manifest through the real fixture transport, in emission order. */
function drainFixture(id: ChronicleId): DrainedFixture {
  const manifest = getChronicleManifest(id);
  let snapshot: WorldSnapshot | null = null;
  const entries: EventEnvelope["events"][number][] = [];
  const transport = createFixtureTransport({
    onRunAccepted: (_metadata: RunMetadata): void => undefined,
    onSnapshotAccepted: (accepted: WorldSnapshot): void => {
      snapshot = accepted;
    },
    onEnvelopeAccepted: (envelope: EventEnvelope): void => {
      entries.push(...envelope.events);
    },
    onCheckpointAccepted: (): void => undefined,
  });
  transport.start(manifest);
  transport.deliverAll();
  transport.dispose();
  if (snapshot === null) {
    throw new Error(`fixture ${id} produced no snapshot`);
  }
  return { snapshot, entries };
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
 * Actor id, correcting the two resolved-hint quirks the fixtures carry:
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
  return candidate !== null && candidate === actorId && type !== "agent_born" ? null : candidate;
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
  return out;
}

/**
 * The one presentation promotion the legibility map defers to the resolver:
 * a same-region targeted line is a whisper, a broadcast is speech.
 */
function kindFor(type: string, targetId: string | null): OverlayKind {
  const mapping = EVENT_LEGIBILITY_MAP[type as PresentedEventType];
  if (type === "speak" && targetId !== null) return "whisper";
  return mapping.kind;
}

function glyphFor(kind: OverlayKind, mapped: OverlayGlyph | null): OverlayGlyph {
  if (mapped !== null) return mapped;
  return kind === "thought" ? "ellipsis" : "quote";
}

/** Load one chronicle fixture and resolve every entry. */
export function loadJourneyStream(id: JourneyStreamId): JourneyStream {
  const { snapshot, entries } = drainFixture(id);

  const names = new Map<string, string>();
  const beings: JourneyBeing[] = [];
  for (const agent of snapshot.agents) {
    names.set(agent.id, agent.name);
    beings.push({
      id: agent.id,
      name: agent.name,
      hue: identityHue(agent.id),
      startRegion: agent.position,
      bornAtCursor: 0,
    });
  }
  for (const entry of entries) {
    if (entry.event.type !== "agent_born") continue;
    const childId = readString(entry.event.payload, "child_id");
    const childName = readString(entry.event.payload, "child_name");
    if (childId === null) continue;
    names.set(childId, childName ?? "a new being");
    if (!beings.some((being) => being.id === childId)) {
      beings.push({
        id: childId,
        name: childName ?? "a new being",
        hue: identityHue(childId),
        startRegion: entry.event.region ?? snapshot.regions[0]?.name ?? "nirvana",
        bornAtCursor: entry.cursor,
      });
    }
  }
  const nameOf = (beingId: string): string => names.get(beingId) ?? "someone";

  const regions: JourneyRegion[] = snapshot.regions.map((region) => {
    const plate = REGION_PLATE[region.name] ?? FALLBACK_PLATE;
    return {
      id: region.name,
      label: regionLabelOf(region.name) ?? region.name,
      description: region.description,
      x: plate.x,
      y: plate.y,
      ground: plate.ground,
      rim: plate.rim,
      connections: region.connections,
    };
  });

  const homes: JourneyHome[] = [];
  for (const home of [...snapshot.homes, ...snapshot.ruins]) {
    homes.push({ id: home.home_id, regionId: home.region, firstCursor: 0 });
  }

  const events: JourneyEvent[] = [];
  for (const entry of entries) {
    const type = entry.event.type;
    const mapping = overlayMappingFor(type);
    const catalog = getEventVisualMetadata(type);
    if (mapping === undefined || catalog === undefined) continue;

    const payload = entry.event.payload;
    const actorId = actorIdFor(type, payload, entry.resolved.actor_id ?? null);
    const targetId = targetIdFor(type, payload, entry.resolved.target_id ?? null, actorId);
    const regionId = entry.resolved.region ?? entry.event.region ?? readString(payload, "region");
    const homeId = entry.resolved.home_id ?? readString(payload, "home_id");
    const kind = kindFor(type, targetId);
    const presented = type as PresentedEventType;

    if (homeId !== null && !homes.some((home) => home.id === homeId)) {
      homes.push({ id: homeId, regionId: regionId ?? "nirvana", firstCursor: entry.cursor });
    }

    const narration = narrateJourneyEvent({
      type,
      payload,
      actorName: actorId === null ? null : nameOf(actorId),
      targetName: targetId === null ? null : nameOf(targetId),
      regionLabel: regionLabelOf(regionId),
      nameOf,
    });

    const base = BASE_SALIENCE[presented] ?? 30;
    events.push({
      id: `${id}:${entry.cursor}`,
      cursor: entry.cursor,
      type: presented,
      mapping,
      catalog,
      kind,
      glyph: glyphFor(kind, mapping.glyph),
      family: mapping.family,
      tier: mapping.tier,
      accent: OVERLAY_FAMILY_ACCENT[mapping.family],
      actorId,
      actorName: actorId === null ? null : nameOf(actorId),
      actorHue: actorId === null ? null : identityHue(actorId),
      targetId,
      targetName: targetId === null ? null : nameOf(targetId),
      targetHue: targetId === null ? null : identityHue(targetId),
      regionId: regionId ?? null,
      regionLabel: regionLabelOf(regionId),
      homeId,
      narration,
      quoteTotalChars:
        narration.quote === null ? null : (readString(payload, "message") ?? narration.quote).length,
      participants: participantsFor(type, payload, actorId, targetId),
      foldKey: `${type}:${regionId ?? "-"}`,
      baseSalience: base,
      routine: base <= ROUTINE_CEILING,
      stateChange: stateChangesFor(presented, {
        actorId,
        targetId,
        homeId,
        payload,
        regionLabel: regionLabelOf(regionId),
        nameOf,
      }),
      atMs: 0,
      payload,
      resolved: entry.resolved as Readonly<Record<string, unknown>>,
      wallTimestamp: typeof entry.event.timestamp === "number" ? entry.event.timestamp : null,
      scope: entry.event.scope,
      source: entry.event.source,
    });
  }

  return {
    id,
    runId: snapshot.run_id,
    title: STREAM_TITLES[id],
    events,
    beings,
    regions,
    homes,
  };
}
