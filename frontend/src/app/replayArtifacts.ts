import {
  applyEventEntry,
  applySnapshotCheckpoint,
  createReplayState,
  type ReplayState,
} from "./replayReducer";
import {
  parseWorldSnapshot,
  type EventEnvelopeEntry,
  type ResolvedEventHints,
  type SerializedEvent,
  type WorldSnapshot,
} from "./schemas";

export interface SnapshotCheckpoint {
  schema: 1;
  type: "world_snapshot_checkpoint";
  reason: string;
  run_id: string;
  world_time: number;
  event_cursor: number;
  snapshot: WorldSnapshot;
  lineNumber?: number;
}

export interface CheckpointIndexEntry {
  lineNumber?: number;
  eventCursor: number;
  worldTime: number;
  reason: string;
  runId: string;
}

export type CheckpointIndexSource =
  | SnapshotCheckpoint
  | string
  | {
      line: string;
      lineNumber?: number;
    };

export interface HydratedReplay {
  state: ReplayState;
  appliedEventCount: number;
  skippedBeforeCheckpointCount: number;
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number;
  stopReason: "gap" | "stale" | null;
}

const ACTOR_PAYLOAD_KEYS = [
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

const TARGET_PAYLOAD_KEYS = [
  "target_id",
  "receiver_id",
  "recipient_id",
  "revived_id",
  "victim_id",
  "acceptor_id",
] as const;

const SOURCELESS_EVENT_SOURCES = new Set(["system", "world"]);

export function parseSnapshotCheckpoint(
  value: unknown,
  metadata: { lineNumber?: number } = {},
): SnapshotCheckpoint {
  const input = objectOf(value, "snapshot checkpoint");
  if (input.schema !== 1) {
    throw new Error("snapshot checkpoint must use schema 1");
  }
  if (input.type !== "world_snapshot_checkpoint") {
    throw new Error('snapshot checkpoint type must be "world_snapshot_checkpoint"');
  }

  const snapshot = parseWorldSnapshot(input.snapshot);
  const checkpoint: SnapshotCheckpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: stringOf(input.reason, "checkpoint.reason"),
    run_id: stringOf(input.run_id, "checkpoint.run_id"),
    world_time: numberOf(input.world_time, "checkpoint.world_time"),
    event_cursor: eventCursorOf(input.event_cursor, "checkpoint.event_cursor"),
    snapshot,
  };

  if (metadata.lineNumber !== undefined) {
    checkpoint.lineNumber = lineNumberOf(metadata.lineNumber);
  }

  if (checkpoint.run_id !== snapshot.run_id) {
    throw new Error(
      `checkpoint run_id ${checkpoint.run_id} does not match snapshot run_id ${snapshot.run_id}`,
    );
  }
  if (checkpoint.world_time !== snapshot.world_time) {
    throw new Error(
      `checkpoint world_time ${checkpoint.world_time} does not match snapshot world_time ${snapshot.world_time}`,
    );
  }
  if (checkpoint.event_cursor !== snapshot.event_cursor) {
    throw new Error(
      `checkpoint event_cursor ${checkpoint.event_cursor} does not match snapshot event_cursor ${snapshot.event_cursor}`,
    );
  }

  return checkpoint;
}

export function parseSnapshotCheckpointLine(
  line: string,
  lineNumber?: number,
): SnapshotCheckpoint {
  return parseSnapshotCheckpoint(parseJsonLine(line, "snapshot checkpoint"), {
    lineNumber,
  });
}

export function buildCheckpointIndex(
  sources: readonly CheckpointIndexSource[],
  options: { firstLineNumber?: number } = {},
): CheckpointIndexEntry[] {
  const firstLineNumber = options.firstLineNumber ?? 1;
  return sources.map((source, index) => {
    const checkpoint =
      typeof source === "string"
        ? parseSnapshotCheckpointLine(source, firstLineNumber + index)
        : "line" in source
          ? parseSnapshotCheckpointLine(
              source.line,
              source.lineNumber ?? firstLineNumber + index,
            )
          : source;

    return {
      lineNumber: checkpoint.lineNumber,
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      reason: checkpoint.reason,
      runId: checkpoint.run_id,
    };
  });
}

export function parseReplayEventLine(
  line: string,
  lineNumber: number,
): EventEnvelopeEntry {
  const cursor = lineNumberOf(lineNumber);
  const event = parseSerializedEvent(parseJsonLine(line, "replay event"));
  return {
    cursor,
    event,
    resolved: resolveDurableEventHints(event),
    snapshot_after: null,
  };
}

export function hydrateReplayFromCheckpoint(
  checkpoint: SnapshotCheckpoint,
  events: readonly EventEnvelopeEntry[],
): HydratedReplay {
  let state = applySnapshotCheckpoint(createReplayState(), checkpoint.snapshot);
  let nextExpectedCursor = checkpoint.event_cursor + 1;
  let appliedEventCount = 0;
  let skippedBeforeCheckpointCount = 0;
  let stoppedBeforeCursor: number | null = null;
  let stopReason: HydratedReplay["stopReason"] = null;

  for (const entry of events) {
    if (entry.cursor <= checkpoint.event_cursor) {
      skippedBeforeCheckpointCount += 1;
      continue;
    }

    if (entry.cursor !== nextExpectedCursor) {
      stoppedBeforeCursor = entry.cursor;
      stopReason = entry.cursor > nextExpectedCursor ? "gap" : "stale";
      break;
    }

    state = applyEventEntry(state, entry);
    appliedEventCount += 1;
    nextExpectedCursor += 1;
  }

  return {
    state,
    appliedEventCount,
    skippedBeforeCheckpointCount,
    stoppedBeforeCursor,
    nextExpectedCursor,
    stopReason,
  };
}

function resolveDurableEventHints(event: SerializedEvent): ResolvedEventHints {
  const resolved: ResolvedEventHints = {};
  const actorId =
    firstPayloadString(event.payload, ACTOR_PAYLOAD_KEYS) ??
    sourceActorId(event.source);
  putStringHint(resolved, "actor_id", actorId);
  putStringHint(
    resolved,
    "target_id",
    event.target || firstPayloadString(event.payload, TARGET_PAYLOAD_KEYS),
  );
  putStringHint(
    resolved,
    "region",
    event.region || stringHint(event.payload.region),
  );
  putStringHint(
    resolved,
    "home_id",
    stringHint(event.payload.home_id) || stringHint(event.payload.target_home),
  );
  putNumberHint(resolved, "amount", event.payload.amount);
  putStringHint(resolved, "resource_type", stringHint(event.payload.resource_type));
  return resolved;
}

function parseSerializedEvent(value: unknown): SerializedEvent {
  const input = objectOf(value, "replay event");
  return {
    type: stringOf(input.type, "event.type"),
    source: stringOf(input.source, "event.source"),
    payload: objectOf(input.payload, "event.payload"),
    scope: enumOf(
      input.scope,
      ["local", "global", "targeted", "private"],
      "event.scope",
    ),
    region: nullableStringOf(input.region, "event.region"),
    target: nullableStringOf(input.target, "event.target"),
    timestamp: numberOf(input.timestamp, "event.timestamp"),
  };
}

function parseJsonLine(line: string, label: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`${label} JSONL line is malformed JSON${detail}`);
  }
}

function firstPayloadString(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = stringHint(payload[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function sourceActorId(source: string): string | undefined {
  return SOURCELESS_EVENT_SOURCES.has(source) ? undefined : source;
}

function putStringHint(
  resolved: ResolvedEventHints,
  key: keyof ResolvedEventHints,
  value: string | undefined,
): void {
  if (value !== undefined) {
    resolved[key] = value;
  }
}

function putNumberHint(
  resolved: ResolvedEventHints,
  key: keyof ResolvedEventHints,
  value: unknown,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    resolved[key] = value;
  }
}

function stringHint(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function objectOf(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function nullableStringOf(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  return stringOf(value, label);
}

function numberOf(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function eventCursorOf(value: unknown, label: string): number {
  const cursor = numberOf(value, label);
  if (!Number.isInteger(cursor) || cursor < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return cursor;
}

function lineNumberOf(value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("lineNumber must be a one-based integer");
  }
  return value;
}

function enumOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${label} must be one of ${allowed.join(", ")}`);
}
