import type { EventEnvelopeEntry } from "../app/schemas";

export const DEFAULT_GROUPING_WINDOW_MS = 500;
const GROUPING_CURSOR_WINDOW = 2;

export const BEAT_DIRECTOR_GROUPABLE_EVENT_TYPES = [
  "agent_left_region",
  "attack",
  "resource_changed",
  "resource_transferred",
  "agent_recovered",
  "agent_died",
  "agent_paralyzed",
  "agent_started_hoarding",
  "hearth_used",
  "home_breached",
] as const;

export const BEAT_DIRECTOR_PARTICIPANT_EVENT_TYPES = [
  "agent_left_region",
  "agent_entered_region",
  "attack",
  "agent_died",
  "agent_paralyzed",
  "resource_transferred",
  "agent_recovered",
  "agent_started_hoarding",
  "home_breached",
  "home_thieved",
  "home_colonized",
  "resource_changed",
  "hearth_used",
] as const;

const BEAT_DIRECTOR_GROUPABLE_EVENT_TYPE_SET = new Set<string>(
  BEAT_DIRECTOR_GROUPABLE_EVENT_TYPES,
);

export interface BeatDirectorOptions {
  groupingWindowMs?: number;
}

export interface BeatDrainResult {
  visualBeats: EventEnvelopeEntry[];
  visualBeatGroups: Array<{
    visual: EventEnvelopeEntry;
    entries: EventEnvelopeEntry[];
    skipped: EventEnvelopeEntry[];
  }>;
  handledCursors: number[];
  pendingCount: number;
  nextFlushInMs: number | null;
}

interface BufferedBeat {
  entry: EventEnvelopeEntry;
  receivedAtMs: number;
}

interface GroupedBeat {
  visual: EventEnvelopeEntry;
  skip: EventEnvelopeEntry[];
}

export class BeatDirector {
  private readonly groupingWindowMs: number;
  private readonly buffer = new Map<number, BufferedBeat>();

  constructor(options: BeatDirectorOptions = {}) {
    this.groupingWindowMs = options.groupingWindowMs ?? DEFAULT_GROUPING_WINDOW_MS;
  }

  enqueue(entries: EventEnvelopeEntry[], receivedAtMs = Date.now()): void {
    for (const entry of entries) {
      if (!this.buffer.has(entry.cursor)) {
        this.buffer.set(entry.cursor, { entry, receivedAtMs });
      }
    }
  }

  advanceCursor(cursor: number): void {
    for (const key of [...this.buffer.keys()]) {
      if (key <= cursor) {
        this.buffer.delete(key);
      }
    }
  }

  clear(): void {
    this.buffer.clear();
  }

  pendingCount(): number {
    return this.buffer.size;
  }

  drain(nowMs = Date.now(), { flush = false }: { flush?: boolean } = {}): BeatDrainResult {
    const ordered = [...this.buffer.values()].sort((left, right) => left.entry.cursor - right.entry.cursor);
    const visualBeats: EventEnvelopeEntry[] = [];
    const visualBeatGroups: BeatDrainResult["visualBeatGroups"] = [];
    const handledCursors: number[] = [];
    const removeCursors = new Set<number>();

    for (const buffered of ordered) {
      const entry = buffered.entry;
      if (removeCursors.has(entry.cursor)) {
        continue;
      }
      const candidates = ordered
        .map((candidate) => candidate.entry)
        .filter((candidate) => candidate.cursor !== entry.cursor && !removeCursors.has(candidate.cursor));
      const grouped = groupedVisualBeat(entry, candidates, this.groupingWindowMs);
      if (grouped) {
        visualBeats.push(grouped.visual);
        visualBeatGroups.push({
          visual: grouped.visual,
          entries: [grouped.visual, ...grouped.skip].sort((left, right) => left.cursor - right.cursor),
          skipped: [...grouped.skip].sort((left, right) => left.cursor - right.cursor),
        });
        removeCursors.add(grouped.visual.cursor);
        for (const skip of grouped.skip) {
          handledCursors.push(skip.cursor);
          removeCursors.add(skip.cursor);
        }
        continue;
      }
      if (canWaitForPartner(entry) && !flush && nowMs - buffered.receivedAtMs < this.groupingWindowMs) {
        continue;
      }
      visualBeats.push(entry);
      visualBeatGroups.push({
        visual: entry,
        entries: [entry],
        skipped: [],
      });
      removeCursors.add(entry.cursor);
    }

    for (const cursor of removeCursors) {
      this.buffer.delete(cursor);
    }

    return {
      visualBeats,
      visualBeatGroups,
      handledCursors,
      pendingCount: this.buffer.size,
      nextFlushInMs: this.nextFlushInMs(nowMs),
    };
  }

  nextFlushInMs(nowMs = Date.now()): number | null {
    let next: number | null = null;
    for (const buffered of this.buffer.values()) {
      const delay = Math.max(0, this.groupingWindowMs - (nowMs - buffered.receivedAtMs));
      next = next === null ? delay : Math.min(next, delay);
    }
    return next;
  }
}

function groupedVisualBeat(
  entry: EventEnvelopeEntry,
  candidates: EventEnvelopeEntry[],
  groupingWindowMs: number,
): GroupedBeat | null {
  switch (entry.event.type) {
    case "agent_left_region": {
      const arrival = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        candidate.event.type === "agent_entered_region" &&
        eventActor(candidate) === eventActor(entry) &&
        eventPayloadString(candidate, "from_region") === eventPayloadString(entry, "from_region") &&
        eventPayloadString(candidate, "to_region") === eventPayloadString(entry, "to_region")
      ));
      return arrival ? { visual: arrival, skip: [entry] } : null;
    }
    case "attack": {
      const attacker = eventPayloadString(entry, "attacker_id") ?? eventActor(entry);
      const victim = eventPayloadString(entry, "victim_id") ?? eventTarget(entry);
      const death = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        candidate.event.type === "agent_died" &&
        (eventPayloadString(candidate, "killer_id", "killer") ?? eventActor(candidate)) === attacker &&
        (eventPayloadString(candidate, "victim_id") ?? eventTarget(candidate)) === victim
      ));
      if (death) {
        return {
          visual: death,
          skip: [
            entry,
            ...candidates.filter((candidate) => (
              inWindow(entry, candidate, groupingWindowMs) &&
              candidate.event.type === "agent_paralyzed" &&
              (eventPayloadString(candidate, "agent_id", "victim_id") ?? eventTarget(candidate)) === victim
            )),
          ],
        };
      }
      const paralyzed = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        candidate.event.type === "agent_paralyzed" &&
        (eventPayloadString(candidate, "attacker_id") ?? eventActor(candidate)) === attacker &&
        (eventPayloadString(candidate, "agent_id", "victim_id") ?? eventTarget(candidate)) === victim
      ));
      return paralyzed ? { visual: paralyzed, skip: [entry] } : null;
    }
    case "resource_transferred": {
      const recovered = findRecoveryPartner(entry, candidates, groupingWindowMs);
      if (recovered) {
        return { visual: recovered, skip: [entry] };
      }
      const hoarding = findAgentHoardingPartner(entry, candidates, groupingWindowMs);
      return hoarding ? { visual: hoarding, skip: [entry] } : null;
    }
    case "agent_recovered": {
      const transfer = findRecoveryPartner(entry, candidates, groupingWindowMs);
      return transfer ? { visual: entry, skip: [transfer] } : null;
    }
    case "agent_died": {
      const victim = eventPayloadString(entry, "victim_id") ?? eventTarget(entry) ?? eventSourceAgent(entry);
      const paralyzed = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        candidate.event.type === "agent_paralyzed" &&
        (eventPayloadString(candidate, "agent_id", "victim_id") ?? eventTarget(candidate)) === victim
      ));
      return paralyzed ? { visual: entry, skip: [paralyzed] } : null;
    }
    case "agent_paralyzed": {
      const victim = eventPayloadString(entry, "agent_id", "victim_id") ?? eventTarget(entry);
      const death = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        candidate.event.type === "agent_died" &&
        (eventPayloadString(candidate, "victim_id") ?? eventTarget(candidate) ?? eventSourceAgent(candidate)) === victim
      ));
      return death ? { visual: death, skip: [entry] } : null;
    }
    case "home_breached": {
      const homeId = eventHome(entry);
      const terminal = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        (candidate.event.type === "home_thieved" || candidate.event.type === "home_colonized") &&
        eventHome(candidate) === homeId
      ));
      return terminal ? { visual: terminal, skip: [entry] } : null;
    }
    case "resource_changed": {
      const hoarding = findAgentHoardingPartner(entry, candidates, groupingWindowMs);
      return hoarding ? { visual: hoarding, skip: [entry] } : null;
    }
    case "agent_started_hoarding": {
      const primary = candidates.find((candidate) => (
        inWindow(entry, candidate, groupingWindowMs) &&
        (candidate.event.type === "resource_changed" ||
          candidate.event.type === "resource_transferred" ||
          candidate.event.type === "hearth_used") &&
        sameAgentHoardingSubject(entry, candidate)
      ));
      return primary ? { visual: entry, skip: [primary] } : null;
    }
    case "hearth_used": {
      const hoarding = findAgentHoardingPartner(entry, candidates, groupingWindowMs);
      return hoarding ? { visual: hoarding, skip: [entry] } : null;
    }
    default:
      return null;
  }
}

function findRecoveryPartner(
  entry: EventEnvelopeEntry,
  candidates: EventEnvelopeEntry[],
  groupingWindowMs: number,
): EventEnvelopeEntry | undefined {
  const giver = eventPayloadString(entry, "sender_id", "giver_id") ?? eventActor(entry);
  const receiver = eventPayloadString(entry, "receiver_id", "recipient_id", "revived_id") ?? eventTarget(entry);
  const resourceType = eventResourceType(entry);
  const amount = eventAmount(entry);
  if (resourceType === undefined || amount === undefined) {
    return undefined;
  }
  const partnerType = entry.event.type === "agent_recovered" ? "resource_transferred" : "agent_recovered";
  return candidates.find((candidate) => (
    inWindow(entry, candidate, groupingWindowMs) &&
    candidate.event.type === partnerType &&
    (eventPayloadString(candidate, "sender_id", "giver_id") ?? eventActor(candidate)) === giver &&
    (eventPayloadString(candidate, "receiver_id", "recipient_id", "revived_id") ?? eventTarget(candidate)) === receiver &&
    eventResourceType(candidate) === resourceType &&
    eventAmount(candidate) === amount
  ));
}

function findAgentHoardingPartner(
  entry: EventEnvelopeEntry,
  candidates: EventEnvelopeEntry[],
  groupingWindowMs: number,
): EventEnvelopeEntry | undefined {
  return candidates.find((candidate) => (
    inWindow(entry, candidate, groupingWindowMs) &&
    candidate.event.type === "agent_started_hoarding" &&
    sameAgentHoardingSubject(candidate, entry)
  ));
}

function sameAgentHoardingSubject(
  hoarding: EventEnvelopeEntry,
  primary: EventEnvelopeEntry,
): boolean {
  const hoarder = eventPayloadString(hoarding, "agent_id") ?? eventActor(hoarding);
  const primaryActor =
    eventPayloadString(primary, "agent_id", "receiver_id", "recipient_id", "revived_id") ??
    eventTarget(primary) ??
    eventActor(primary);
  return hoarder === primaryActor && eventRegion(hoarding) === eventRegion(primary);
}

function canWaitForPartner(entry: EventEnvelopeEntry): boolean {
  return BEAT_DIRECTOR_GROUPABLE_EVENT_TYPE_SET.has(entry.event.type);
}

function inWindow(
  left: EventEnvelopeEntry,
  right: EventEnvelopeEntry,
  groupingWindowMs: number,
): boolean {
  return (
    Math.abs(left.cursor - right.cursor) <= GROUPING_CURSOR_WINDOW &&
    Math.abs(left.event.timestamp - right.event.timestamp) * 1000 <= groupingWindowMs
  );
}

function eventActor(entry: EventEnvelopeEntry): string | undefined {
  return eventResolvedString(entry, "actor_id") ?? eventSourceAgent(entry);
}

function eventTarget(entry: EventEnvelopeEntry): string | undefined {
  return (
    eventResolvedString(entry, "target_id") ??
    entry.event.target ??
    eventPayloadString(entry, "target_id", "target", "receiver_id", "recipient_id", "revived_id", "victim_id")
  );
}

function eventHome(entry: EventEnvelopeEntry): string | undefined {
  return eventResolvedString(entry, "home_id") ?? eventPayloadString(entry, "home_id", "target_home");
}

function eventRegion(entry: EventEnvelopeEntry): string | undefined {
  return eventResolvedString(entry, "region") ?? entry.event.region ?? eventPayloadString(entry, "region");
}

function eventResourceType(entry: EventEnvelopeEntry): string | undefined {
  return eventResolvedString(entry, "resource_type") ?? eventPayloadString(entry, "resource_type");
}

function eventAmount(entry: EventEnvelopeEntry): number | undefined {
  const resolved = entry.resolved.amount;
  if (typeof resolved === "number" && Number.isFinite(resolved)) {
    return resolved;
  }
  const payload = entry.event.payload.amount;
  return typeof payload === "number" && Number.isFinite(payload) ? payload : undefined;
}

function eventResolvedString(entry: EventEnvelopeEntry, key: string): string | undefined {
  const value = entry.resolved[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function eventPayloadString(entry: EventEnvelopeEntry, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry.event.payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function eventSourceAgent(entry: EventEnvelopeEntry): string | undefined {
  const { source } = entry.event;
  return source && source !== "system" && source !== "world" ? source : undefined;
}
