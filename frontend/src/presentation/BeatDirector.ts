import type { EventEnvelopeEntry } from "../app/schemas";
import {
  EVENT_VISUAL_CATALOG,
  type EventVisualEventType,
  type EventVisualPriority,
} from "../events/eventVisualCatalog";
import type { StoryFocus } from "./contracts";

export type StoryChainKind =
  | "single"
  | "travel"
  | "gift-recovery"
  | "resource-hoard"
  | "strike-fall"
  | "breach-theft"
  | "breach-claim";

export interface StoryMoment {
  readonly id: string;
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly evidenceCursors: readonly number[];
  readonly evidence: readonly EventEnvelopeEntry[];
  readonly representative: EventEnvelopeEntry;
  readonly chainKind: StoryChainKind;
  readonly priority: EventVisualPriority;
  readonly focus: StoryFocus;
  readonly afterContext?: StoryChainKind;
}

interface GroupMatch {
  readonly count: number;
  readonly chainKind: Exclude<StoryChainKind, "single">;
  readonly representativeIndex: number;
}

/** Turns ordered event evidence into lossless, contiguous causal moments. */
export class BeatDirector {
  group(input: readonly EventEnvelopeEntry[]): readonly StoryMoment[] {
    const entries = normalizeEntries(input);
    const moments: StoryMoment[] = [];
    for (let index = 0; index < entries.length;) {
      const match = matchAt(entries, index);
      const evidence = entries.slice(index, index + (match?.count ?? 1));
      const chainKind = match?.chainKind ?? "single";
      const representative = evidence[match?.representativeIndex ?? 0];
      moments.push(createMoment(evidence, representative, chainKind));
      index += evidence.length;
    }
    return Object.freeze(moments);
  }
}

function normalizeEntries(input: readonly EventEnvelopeEntry[]): readonly EventEnvelopeEntry[] {
  const byCursor = new Map<number, EventEnvelopeEntry>();
  for (const entry of input) {
    if (!Number.isSafeInteger(entry.cursor) || entry.cursor < 0) {
      throw new RangeError("story evidence cursor must be a non-negative safe integer");
    }
    const existing = byCursor.get(entry.cursor);
    if (existing !== undefined) {
      if (stableSerialize(existing) !== stableSerialize(entry)) {
        throw new Error(`conflicting evidence for cursor ${entry.cursor}`);
      }
      continue;
    }
    byCursor.set(entry.cursor, structuredClone(entry));
  }
  return [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
}

function matchAt(entries: readonly EventEnvelopeEntry[], index: number): GroupMatch | null {
  const first = entries[index];
  const second = entries[index + 1];
  if (second === undefined || second.cursor !== first.cursor + 1) return null;

  if (isTravel(first, second)) return { count: 2, chainKind: "travel", representativeIndex: 1 };
  if (isRecoveryGift(first, second)) return { count: 2, chainKind: "gift-recovery", representativeIndex: 0 };
  if (isResourceHoard(first, second)) return { count: 2, chainKind: "resource-hoard", representativeIndex: 1 };
  if (isStrikeFall(first, second)) return { count: 2, chainKind: "strike-fall", representativeIndex: 1 };
  if (isHomeContest(first, second, "home_thieved")) return { count: 2, chainKind: "breach-theft", representativeIndex: 1 };
  if (isHomeContest(first, second, "home_colonized")) return { count: 2, chainKind: "breach-claim", representativeIndex: 1 };
  return null;
}

function isTravel(left: EventEnvelopeEntry, right: EventEnvelopeEntry): boolean {
  return left.event.type === "agent_left_region"
    && right.event.type === "agent_entered_region"
    && actor(left) === actor(right)
    && payloadString(left, "from_region") === payloadString(right, "from_region")
    && payloadString(left, "to_region") === payloadString(right, "to_region");
}

function isRecoveryGift(left: EventEnvelopeEntry, right: EventEnvelopeEntry): boolean {
  return left.event.type === "agent_recovered"
    && right.event.type === "resource_transferred"
    && actor(left) === actor(right)
    && target(left) === target(right)
    && payloadString(left, "resource_type") === payloadString(right, "resource_type")
    && payloadNumber(left, "amount") === payloadNumber(right, "amount");
}

function isResourceHoard(left: EventEnvelopeEntry, right: EventEnvelopeEntry): boolean {
  if (!["resource_changed", "resource_transferred", "hearth_used"].includes(left.event.type)) return false;
  if (right.event.type !== "agent_started_hoarding") return false;
  const recipient = payloadString(left, "receiver_id", "recipient_id", "agent_id") ?? actor(left);
  return recipient === (payloadString(right, "agent_id") ?? actor(right)) && region(left) === region(right);
}

function isStrikeFall(left: EventEnvelopeEntry, right: EventEnvelopeEntry): boolean {
  if (left.event.type !== "attack" || right.event.type !== "agent_paralyzed") return false;
  const attacker = payloadString(left, "attacker_id") ?? actor(left);
  const victim = payloadString(left, "victim_id") ?? target(left);
  return attacker === (payloadString(right, "attacker_id") ?? actor(right))
    && victim === (payloadString(right, "agent_id", "victim_id") ?? target(right));
}

function isHomeContest(
  left: EventEnvelopeEntry,
  right: EventEnvelopeEntry,
  terminal: "home_thieved" | "home_colonized",
): boolean {
  return left.event.type === "home_breached"
    && right.event.type === terminal
    && home(left) !== null
    && home(left) === home(right);
}

function createMoment(
  evidence: readonly EventEnvelopeEntry[],
  representative: EventEnvelopeEntry,
  chainKind: StoryChainKind,
): StoryMoment {
  const firstCursor = evidence[0].cursor;
  const lastCursor = evidence.at(-1)!.cursor;
  const moment: StoryMoment = {
    id: `${firstCursor}:${lastCursor}:${chainKind}`,
    firstCursor,
    lastCursor,
    evidenceCursors: Object.freeze(evidence.map((entry) => entry.cursor)),
    evidence: Object.freeze(evidence),
    representative,
    chainKind,
    priority: strongestPriority(evidence),
    focus: focusFor(representative),
    ...(chainKind === "single" ? {} : { afterContext: chainKind }),
  };
  return Object.freeze(moment);
}

function strongestPriority(evidence: readonly EventEnvelopeEntry[]): EventVisualPriority {
  const rank: Record<EventVisualPriority, number> = { ambient: 0, featured: 1, drama: 2 };
  let priority: EventVisualPriority = "ambient";
  for (const entry of evidence) {
    const metadata = EVENT_VISUAL_CATALOG[entry.event.type as EventVisualEventType];
    if (metadata !== undefined && rank[metadata.priority] > rank[priority]) priority = metadata.priority;
  }
  return priority;
}

function focusFor(entry: EventEnvelopeEntry): StoryFocus {
  const homeId = entry.resolved.home_id ?? payloadString(entry, "home_id", "target_home");
  if (homeId !== undefined && homeId !== null) return { kind: "home", id: homeId };
  const actorId = actor(entry);
  if (actorId !== null && actorId !== "system" && actorId !== "world") return { kind: "agent", id: actorId };
  const regionId = region(entry);
  if (regionId !== null) return { kind: "region", id: regionId };
  return { kind: "system", regionId: null };
}

function actor(entry: EventEnvelopeEntry): string | null {
  return entry.resolved.actor_id ?? payloadString(
    entry,
    "actor_id",
    "attacker_id",
    "sender_id",
    "giver_id",
    "builder_id",
    "breacher_id",
    "speaker_id",
    "initiator_id",
    "agent_id",
    "killer_id",
  ) ?? entry.event.source ?? null;
}

function target(entry: EventEnvelopeEntry): string | null {
  return entry.resolved.target_id ?? payloadString(
    entry,
    "target_id",
    "receiver_id",
    "recipient_id",
    "revived_id",
    "victim_id",
    "acceptor_id",
  ) ?? entry.event.target;
}

function region(entry: EventEnvelopeEntry): string | null {
  return entry.resolved.region ?? payloadString(entry, "region", "from_region") ?? entry.event.region;
}

function home(entry: EventEnvelopeEntry): string | null {
  return entry.resolved.home_id ?? payloadString(entry, "home_id", "target_home") ?? null;
}

function payloadString(entry: EventEnvelopeEntry, ...keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = entry.event.payload[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function payloadNumber(entry: EventEnvelopeEntry, key: string): number | undefined {
  const value = entry.event.payload[key];
  return typeof value === "number" ? value : undefined;
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
