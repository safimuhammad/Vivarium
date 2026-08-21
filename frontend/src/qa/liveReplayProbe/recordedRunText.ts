/**
 * QA HARNESS — the environment-free half of the recorded-run loader.
 *
 * `recordedRun.ts` reads a `runs/*.jsonl` off disk, which only Node can do. The
 * *parsing* is identical in a browser, and the browser is where a recorded run
 * has to be driven if anyone is going to look at it. Everything that does not
 * need a filesystem lives here so the two harnesses share one parser and one
 * port of the server's `_resolve_event` — a second copy of that port would be a
 * second thing to keep faithful.
 */

import type {
  EventEnvelope,
  EventEnvelopeEntry,
  ResolvedEventHints,
  RunMetadata,
  SerializedEvent,
  WorldSnapshot,
} from "../../app/schemas";

export interface RecordedEventLine {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly scope: string;
  readonly region: string | null;
  readonly target: string | null;
  readonly timestamp: number;
}

export interface RecordedRun {
  /** Cursor-1-based entries in recorded timestamp order. */
  readonly entries: readonly EventEnvelopeEntry[];
  /** Milliseconds after the first recorded event at which each entry was emitted. */
  readonly offsetsMs: readonly number[];
  readonly spanMs: number;
}

export interface RecordedSnapshotRecord {
  readonly line: number;
  readonly eventCursor: number;
  readonly snapshot: WorldSnapshot;
}

export interface LoadRecordedRunOptions {
  /** Event types dropped before cursors are assigned (used for the no-self_talk arm). */
  readonly excludeTypes?: readonly string[];
}

const ACTOR_KEYS = [
  "actor_id",
  "attacker_id",
  "sender_id",
  "giver_id",
  "builder_id",
  "breacher_id",
  "speaker_id",
  "initiator_id",
  "rejecter_id",
  "agent_id",
  "killer_id",
] as const;

const TARGET_KEYS = [
  "target_id",
  "receiver_id",
  "recipient_id",
  "revived_id",
  "victim_id",
  "acceptor_id",
] as const;

/** Splits JSONL text into parsed records, ignoring blank lines. */
export function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function firstPayload(
  payload: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null) return value;
  }
  return null;
}

function putIfPresent(
  target: Record<string, string | number | undefined>,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;
  if (typeof value === "string" || typeof value === "number") target[key] = value;
}

/** Port of the production server's `_resolve_event` (`server/app.py:591`). */
export function resolveEventHints(event: SerializedEvent): ResolvedEventHints {
  const payload = event.payload;
  const resolved: Record<string, string | number | undefined> = {};
  let actorId = firstPayload(payload, ACTOR_KEYS);
  if (actorId === null && event.source !== "system" && event.source !== "world") {
    actorId = event.source;
  }
  putIfPresent(resolved, "actor_id", actorId);
  putIfPresent(
    resolved,
    "target_id",
    event.target ?? firstPayload(payload, TARGET_KEYS),
  );
  putIfPresent(resolved, "region", event.region ?? payload.region);
  putIfPresent(resolved, "home_id", payload.home_id ?? payload.target_home);
  putIfPresent(resolved, "amount", payload.amount);
  putIfPresent(resolved, "resource_type", payload.resource_type);
  return resolved as ResolvedEventHints;
}

function toSerializedEvent(line: RecordedEventLine): SerializedEvent {
  const scope = line.scope === "local"
    || line.scope === "global"
    || line.scope === "targeted"
    || line.scope === "private"
    ? line.scope
    : "global";
  return {
    type: line.type,
    source: line.source,
    payload: line.payload,
    scope,
    region: line.region,
    target: line.target,
    timestamp: line.timestamp,
  };
}

/** Parses recorded `events.jsonl` text into cursor-ordered live ingress entries. */
export function parseRecordedRun(
  text: string,
  label: string,
  options: LoadRecordedRunOptions = {},
): RecordedRun {
  const exclude = new Set(options.excludeTypes ?? []);
  const lines = (parseJsonl(text) as RecordedEventLine[])
    .filter((line) => !exclude.has(line.type))
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);
  if (lines.length === 0) throw new Error(`recorded run ${label} has no events`);
  const startedAt = lines[0].timestamp;
  const entries: EventEnvelopeEntry[] = [];
  const offsetsMs: number[] = [];
  lines.forEach((line, index) => {
    const event = toSerializedEvent(line);
    entries.push({
      cursor: index + 1,
      event,
      resolved: resolveEventHints(event),
      snapshot_after: null,
    });
    offsetsMs.push((line.timestamp - startedAt) * 1_000);
  });
  return {
    entries,
    offsetsMs,
    spanMs: offsetsMs[offsetsMs.length - 1],
  };
}

/** Parses recorded `snapshots.jsonl` text of real `world_snapshot_checkpoint` records. */
export function parseRecordedSnapshots(text: string): readonly RecordedSnapshotRecord[] {
  return (parseJsonl(text) as Array<{
    event_cursor: number;
    snapshot: WorldSnapshot;
  }>).map((record, index) => ({
    line: index + 1,
    eventCursor: record.event_cursor,
    snapshot: record.snapshot,
  }));
}

/** Rewrites a real recorded snapshot onto a different run identity/cursor. */
export function restampSnapshot(
  snapshot: WorldSnapshot,
  input: Readonly<{ runId: string; eventCursor: number; worldTime: number }>,
): WorldSnapshot {
  return {
    ...structuredClone(snapshot),
    run_id: input.runId,
    event_cursor: input.eventCursor,
    world_time: input.worldTime,
  };
}

/** Builds live `RunMetadata` for a recorded run. */
export function recordedRunMetadata(input: Readonly<{
  runId: string;
  seed: number;
  snapshot: WorldSnapshot;
  model: string;
}>): RunMetadata {
  return {
    schema: 1,
    run_id: input.runId,
    seed: input.seed,
    started_at: input.snapshot.world_time,
    status: "running",
    event_cursor: input.snapshot.event_cursor,
    world_time: input.snapshot.world_time,
    config_hash: `recorded:${input.runId}`,
    constants: {},
    seed_persona: null,
    provider: "gemini",
    model: input.model,
    context_window: null,
    timing: {},
    artifacts: {
      events: "recorded",
      usage: "recorded",
      snapshots: "recorded",
      memory_root: "recorded",
    },
  };
}

/** Wraps a contiguous run of entries into one live SSE envelope. */
export function envelopeForBatch(
  entries: readonly EventEnvelopeEntry[],
): EventEnvelope {
  if (entries.length === 0) throw new Error("cannot build an empty envelope");
  return {
    schema: 1,
    cursor: Math.max(0, entries[0].cursor - 1),
    oldest_cursor: entries[0].cursor,
    next_cursor: entries[entries.length - 1].cursor,
    events: [...entries],
    overflow: false,
    snapshot_required: false,
  };
}
