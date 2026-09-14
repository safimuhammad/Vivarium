/**
 * PRODUCTION GATEWAY — a run recorded to disk, served as if it were live.
 *
 * The landing page's "watch a recording" entrance needs the **production** 2D
 * observer (`Vivarium2DApp`) to run against a real recorded run with no backend
 * process anywhere. `src/qa/liveReplay/recordedLiveBridge.ts` proved this design
 * as a dev-only QA harness; this module is the same idea rebuilt for `main.tsx`'s
 * runtime closure, which `src/qa/chronicleValidation.closure.test.ts` forbids from
 * containing anything under `src/qa/**` or `src/presentation/fixtures/**`. Nothing
 * here imports from either — the JSONL parsing and the server's hint-resolution
 * port are duplicated locally rather than shared, because sharing would mean
 * importing a QA-owned module into the production closure.
 *
 * Impersonated seams — identical to the QA harness, and no more:
 *   - `LiveApiClient` is an offline bridge over the recording (`createRecordedRunBridge`);
 *     `getEvents` always answers empty because a recording is delivered purely
 *     through the SSE-shaped push path (`dispatch`), never through backfill polling.
 *   - `GET /api/world` answers with the newest REAL recorded checkpoint at or
 *     below the delivered cursor, restamped cursor-forward (`RecordedRun.snapshotAt`),
 *     because a live server's world endpoint is always cursor-forward while the
 *     recorded checkpoint cadence is coarser than the event cadence.
 *   - The checkpoint feed is a no-op (`inertRecordedCheckpointFeed`), isolating the
 *     story queue from checkpoint reconciliation — the QA harness's declared
 *     deviation #1.
 *   - Local recordings retain their terrain seed and model through metadata.json.
 *     Standalone legacy recordings without metadata retain the seed-zero fallback.
 *   - A caller's `runId` is a diagnostic label only. A recording's true identity
 *     is the `run_id` embedded in its first snapshot line; `loadRecordedRun`
 *     discovers it from the data rather than trusting the caller.
 *
 * Everything downstream of `openEventStream` — the presentation session, the
 * renderer, `Vivarium2DApp` itself — is unmodified production code.
 */

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "../client";
import {
  parseWorldSnapshot,
  type EventEnvelope,
  type EventEnvelopeEntry,
  type ResolvedEventHints,
  type RunMetadata,
  type SerializedEvent,
  type WorldSnapshot,
} from "../schemas";
import type { CheckpointFeed } from "../../presentation/CheckpointFeed";

/** Real backend SSE poll cadence (`server/app.py` `sse_poll_interval = 0.25`). */
export const SSE_POLL_MS = 250;

const EVENT_SCOPES = ["local", "global", "targeted", "private"] as const;

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

/** One cursor-ordered live-shaped ingress entry, plus its recorded arrival offset. */
export interface RecordedRunEntry extends EventEnvelopeEntry {
  /** Milliseconds after the first recorded event at which this entry was emitted. */
  readonly offsetMs: number;
}

/** A run recorded to disk, parsed from the two JSONL files a run writes. */
export interface RecordedRun {
  /** The recording's true identity — the `run_id` of its first snapshot, not the caller's label. */
  readonly runId: string;
  /** Cursor-1-based entries in recorded timestamp order. */
  readonly entries: readonly RecordedRunEntry[];
  readonly firstSnapshot: WorldSnapshot;
  readonly run: RunMetadata;
  /** Milliseconds from the first recorded event to the last. */
  readonly spanMs: number;
  /**
   * The newest real recorded checkpoint at or below `cursor`, restamped onto
   * `cursor` and `worldTime` so it reads as a live, cursor-forward `GET /api/world`
   * answer rather than the coarser cadence a checkpoint is actually recorded at.
   */
  snapshotAt(cursor: number, worldTime: number): WorldSnapshot;
}

export interface RecordedRunMetadata {
  readonly seed?: number | null;
  readonly provider?: string | null;
  readonly model?: string | null;
  readonly started_at?: number | null;
}

export interface LoadRecordedRunInput {
  /** A diagnostic label only — see the module docstring. */
  readonly runId: string;
  readonly eventsText: string;
  readonly snapshotsText: string;
  readonly metadata?: RecordedRunMetadata;
}

/** Parses `events.jsonl` + `snapshots.jsonl` text into a replayable recording. */
export function loadRecordedRun(input: LoadRecordedRunInput): RecordedRun {
  const lines = parseJsonl(input.eventsText)
    .map((raw) => parseRecordedEventLine(raw))
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);
  if (lines.length === 0) {
    throw new Error(`recorded run ${input.runId} has no events`);
  }
  const startedAt = lines[0].timestamp;
  const entries: RecordedRunEntry[] = lines.map((line, index) => {
    const event = toSerializedEvent(line);
    return {
      cursor: index + 1,
      event,
      resolved: resolveEventHints(event),
      snapshot_after: null,
      offsetMs: (line.timestamp - startedAt) * 1_000,
    };
  });
  const spanMs = entries[entries.length - 1].offsetMs;

  const snapshotLines = parseJsonl(input.snapshotsText).map((raw) => parseRecordedSnapshotLine(raw));
  const firstLine = snapshotLines[0];
  if (firstLine === undefined) {
    throw new Error(`recorded run ${input.runId} has no snapshots`);
  }
  const runId = firstLine.snapshot.run_id;
  const firstSnapshot = firstLine.snapshot;
  const run = buildRecordedRunMetadata({ runId, snapshot: firstSnapshot, metadata: input.metadata });

  return {
    runId,
    entries,
    firstSnapshot,
    run,
    spanMs,
    snapshotAt(cursor, worldTime): WorldSnapshot {
      // Snapshot lines are assumed to already be in non-decreasing eventCursor
      // order, which is how a real run appends `snapshots.jsonl` — the newest
      // one at or below `cursor` is therefore the last one accepted below.
      let chosen = firstLine;
      for (const record of snapshotLines) {
        if (record.eventCursor <= cursor) chosen = record;
        else break;
      }
      return restampSnapshot(chosen.snapshot, { runId, eventCursor: cursor, worldTime });
    },
  };
}

export interface FetchRecordedRunOptions {
  /** A diagnostic label only — see the module docstring. Defaults to `"recorded"`. */
  readonly runId?: string;
  readonly fetcher?: typeof globalThis.fetch;
}

/** Fetches `<base>/events.jsonl` and `<base>/snapshots.jsonl`. */
export async function fetchRecordedRun(
  base: string,
  options: FetchRecordedRunOptions = {},
): Promise<RecordedRun> {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const trimmedBase = base.replace(/\/$/u, "");
  const [eventsText, snapshotsText, metadata] = await Promise.all([
    fetchText(fetcher, `${trimmedBase}/events.jsonl`),
    fetchText(fetcher, `${trimmedBase}/snapshots.jsonl`),
    trimmedBase.startsWith("/api/recordings/")
      ? fetchMetadata(fetcher, `${trimmedBase}/metadata.json`)
      : Promise.resolve(undefined),
  ]);
  return loadRecordedRun({ runId: options.runId ?? "recorded", eventsText, snapshotsText, metadata });
}

async function fetchMetadata(fetcher: typeof globalThis.fetch, url: string): Promise<RecordedRunMetadata | undefined> {
  const response = await fetcher(url, { cache: "no-store" });
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Recorded run metadata failed: HTTP ${response.status}`);
  const value: unknown = JSON.parse(await response.text());
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid recorded run metadata.");
  }
  const metadata = value as Record<string, unknown>;
  if ((metadata.seed != null && !Number.isSafeInteger(metadata.seed))
    || (metadata.started_at != null && (typeof metadata.started_at !== "number" || !Number.isFinite(metadata.started_at)))
    || (metadata.provider != null && typeof metadata.provider !== "string")
    || (metadata.model != null && typeof metadata.model !== "string")) {
    throw new Error("Invalid recorded run metadata.");
  }
  return metadata as RecordedRunMetadata;
}

async function fetchText(fetcher: typeof globalThis.fetch, url: string): Promise<string> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`recorded run fetch failed for ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

/** A `LiveApiClient` (see `src/app/client.ts`) served entirely from a recording. */
export interface RecordedRunBridge {
  readonly client: LiveApiClient;
  /** Replaces what `GET /api/world` next answers with (defensively cloned). */
  setSnapshot(snapshot: WorldSnapshot): void;
  /** Delivers one live-shaped envelope to the newest open stream, if any. */
  dispatch(envelope: EventEnvelope): Promise<void>;
  /** Delivers the backend's idle keepalive on the newest open stream. */
  heartbeat(worldTime: number, status?: string): void;
  dispose(): void;
}

interface OpenStream {
  readonly handlers: EventStreamHandlers;
  active: boolean;
}

/** Builds the offline `LiveApiClient` the production session will talk to. */
export function createRecordedRunBridge(
  run: RunMetadata,
  firstSnapshot: WorldSnapshot,
): RecordedRunBridge {
  let snapshot = structuredClone(firstSnapshot);
  let disposed = false;
  const streams: OpenStream[] = [];

  const newestActiveStream = (): OpenStream | undefined =>
    [...streams].reverse().find((stream) => stream.active);

  const client: LiveApiClient = {
    getRun: async () => structuredClone(run),
    getWorld: async () => structuredClone(snapshot),
    // A recording is delivered purely through `dispatch` on the push path; there
    // is no backlog to answer through polling `getEvents`.
    getEvents: async (cursor: number) => ({
      schema: 1,
      cursor,
      oldest_cursor: cursor,
      next_cursor: cursor,
      events: [],
      overflow: false,
      snapshot_required: false,
    }),
    openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream {
      const stream: OpenStream = { handlers, active: true };
      streams.push(stream);
      return {
        url: `recorded://events/${run.run_id}?cursor=${cursor}`,
        close: (): void => {
          stream.active = false;
        },
      };
    },
  };

  return {
    client,
    setSnapshot(next): void {
      if (!disposed) snapshot = structuredClone(next);
    },
    async dispatch(envelope): Promise<void> {
      if (disposed) return;
      const stream = newestActiveStream();
      if (stream === undefined) return;
      await Promise.resolve(stream.handlers.onEnvelope(structuredClone(envelope)));
    },
    heartbeat(worldTime, status = "running"): void {
      if (disposed) return;
      newestActiveStream()?.handlers.onHeartbeat?.({ cursor: -1, worldTime, status });
    },
    dispose(): void {
      disposed = true;
      streams.length = 0;
    },
  };
}

/** Progress reported by `RecordedRunDriver` after each delivered batch. */
export interface RecordedRunDriverProgress {
  /** Recorded-time offset reached so far, in milliseconds. */
  readonly atMs: number;
  readonly deliveredCursor: number;
  readonly remaining: number;
}

/**
 * The timer/clock seam `RecordedRunDriver` runs on.
 *
 * Mirrors `BrowserPresentationClockPlatform` (`src/app/observer2d/browserPresentationClock.ts`):
 * production gets a `performance.now()` + `setTimeout` platform, and tests inject
 * a fake one so delivery timing is asserted deterministically, never against a
 * real clock.
 */
export interface RecordedRunDriverPlatform {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (handle: number) => void;
}

export interface RecordedRunDriverOptions {
  readonly recording: RecordedRun;
  readonly bridge: RecordedRunBridge;
  /** Arrival-rate multiplier. 1 (the default) replays at the run's own recorded spacing. */
  readonly rate?: number;
  readonly scheduler?: RecordedRunDriverPlatform;
  /** Called after every delivered batch, with the wall-clock offset reached. */
  readonly onProgress?: (progress: RecordedRunDriverProgress) => void;
  readonly onComplete?: () => void;
}

/** Drives a recording forward at its own recorded wall-clock spacing. */
export interface RecordedRunDriver {
  start(): void;
  stop(): void;
  /** Recorded-time offset reached so far, in milliseconds. */
  atMs(): number;
}

/**
 * Delivers a recording into a `RecordedRunBridge` on real timers, batched on the
 * backend's own SSE poll cadence so downstream story-beat chaining behaves
 * exactly as it does live.
 *
 * `rate` multiplies the ARRIVAL rate only; the presentation clock stays real, so
 * `rate=4` is rate stress rather than fast-forward — production's own speed
 * contract caps at 2x regardless.
 */
export function createRecordedRunDriver(options: RecordedRunDriverOptions): RecordedRunDriver {
  const { entries, spanMs } = options.recording;
  const rate = options.rate !== undefined && options.rate > 0 ? options.rate : 1;
  const platform = options.scheduler ?? browserRecordedRunDriverPlatform();
  const intervalMs = Math.max(16, SSE_POLL_MS / rate);

  let index = 0;
  let startedAt = 0;
  let reached = 0;
  let running = false;
  let handle: number | null = null;

  const scheduleNext = (): void => {
    if (!running) return;
    handle = platform.setTimeout(tick, intervalMs);
  };

  function tick(): void {
    handle = null;
    if (!running) return;
    reached = (platform.now() - startedAt) * rate;
    const batch: RecordedRunEntry[] = [];
    while (index < entries.length && entries[index].offsetMs <= reached) {
      batch.push(entries[index]);
      index += 1;
    }
    if (batch.length > 0) {
      const last = batch[batch.length - 1];
      options.bridge.setSnapshot(
        options.recording.snapshotAt(last.cursor, last.event.timestamp),
      );
      void options.bridge.dispatch(buildEnvelope(batch));
      options.onProgress?.({
        atMs: reached,
        deliveredCursor: last.cursor,
        remaining: entries.length - index,
      });
    }
    if (index >= entries.length && reached > spanMs) {
      running = false;
      options.onComplete?.();
      return;
    }
    scheduleNext();
  }

  return {
    start(): void {
      if (running) return;
      running = true;
      startedAt = platform.now();
      scheduleNext();
    },
    stop(): void {
      running = false;
      if (handle !== null) {
        platform.clearTimeout(handle);
        handle = null;
      }
    },
    atMs: () => reached,
  };
}

/** A checkpoint feed that does nothing, for a recording with no live archive to reconcile against. */
export function inertRecordedCheckpointFeed(): CheckpointFeed {
  return {
    start: () => undefined,
    subscribe: () => () => undefined,
    subscribeFault: () => () => undefined,
    reset: () => undefined,
    diagnostics: () => ({
      disposed: false,
      runId: null,
      lastDeliveredLine: 0,
      polling: false,
      retainedSafeCheckpoints: 0,
      faultCount: 0,
    }),
    dispose: () => undefined,
  };
}

/**
 * Port of the production server's `_resolve_event` (`server/app.py:681`).
 *
 * A recording's raw event lines carry no `resolved` field — the backend computes
 * it just before serving a live envelope. This reproduces that computation
 * exactly, so a recorded envelope carries the identical actor/target/region/
 * amount hints a live one would have.
 */
export function resolveEventHints(event: SerializedEvent): ResolvedEventHints {
  const payload = event.payload;
  const resolved: Record<string, string | number> = {};
  let actorId = firstPayloadValue(payload, ACTOR_PAYLOAD_KEYS);
  if (actorId === null && event.source !== "system" && event.source !== "world") {
    actorId = event.source;
  }
  putIfPresent(resolved, "actor_id", actorId);
  putIfPresent(resolved, "target_id", event.target ?? firstPayloadValue(payload, TARGET_PAYLOAD_KEYS));
  putIfPresent(resolved, "region", event.region ?? payload.region);
  putIfPresent(resolved, "home_id", payload.home_id ?? payload.target_home);
  putIfPresent(resolved, "amount", payload.amount);
  putIfPresent(resolved, "resource_type", payload.resource_type);
  return resolved as ResolvedEventHints;
}

function firstPayloadValue(
  payload: Record<string, unknown>,
  keys: readonly string[],
): string | number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function putIfPresent(
  target: Record<string, string | number>,
  key: string,
  value: unknown,
): void {
  if (typeof value === "string" || typeof value === "number") target[key] = value;
}

interface RecordedEventLine {
  readonly type: string;
  readonly source: string;
  readonly payload: Record<string, unknown>;
  readonly scope: SerializedEvent["scope"];
  readonly region: string | null;
  readonly target: string | null;
  readonly timestamp: number;
}

function toSerializedEvent(line: RecordedEventLine): SerializedEvent {
  return {
    type: line.type,
    source: line.source,
    payload: line.payload,
    scope: line.scope,
    region: line.region,
    target: line.target,
    timestamp: line.timestamp,
  };
}

interface RecordedSnapshotLine {
  readonly eventCursor: number;
  readonly snapshot: WorldSnapshot;
}

function buildRecordedRunMetadata(input: Readonly<{
  runId: string;
  snapshot: WorldSnapshot;
  metadata?: RecordedRunMetadata;
}>): RunMetadata {
  return {
    schema: 1,
    run_id: input.runId,
    seed: input.metadata?.seed ?? 0,
    started_at: input.metadata?.started_at ?? input.snapshot.world_time,
    status: "running",
    event_cursor: input.snapshot.event_cursor,
    world_time: input.snapshot.world_time,
    config_hash: `recorded:${input.runId}`,
    constants: {},
    // Read off the recording rather than invented: the snapshot states the run's
    // default birth words itself, which is what a recording has instead of a
    // live run to ask. Older recordings state none, and their beings each carry
    // their own copy, so nothing is lost either way.
    seed_persona: input.snapshot.seed_persona ?? null,
    provider: input.metadata?.provider ?? "recorded",
    model: input.metadata?.model ?? "recorded",
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

/** Rewrites a real recorded snapshot onto a different cursor/time identity. */
function restampSnapshot(
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

/** Wraps a contiguous run of entries into one live-shaped SSE envelope. */
function buildEnvelope(entries: readonly RecordedRunEntry[]): EventEnvelope {
  const first = entries[0];
  if (first === undefined) {
    throw new Error("cannot build an envelope from zero entries");
  }
  const last = entries[entries.length - 1];
  return {
    schema: 1,
    cursor: Math.max(0, first.cursor - 1),
    oldest_cursor: first.cursor,
    next_cursor: last.cursor,
    events: [...entries],
    overflow: false,
    snapshot_required: false,
  };
}

function browserRecordedRunDriverPlatform(): RecordedRunDriverPlatform {
  return {
    now: () => globalThis.performance.now(),
    setTimeout: (callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

/** Splits JSONL text into parsed records, ignoring blank lines. */
function parseJsonl(text: string): unknown[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

function parseRecordedEventLine(value: unknown): RecordedEventLine {
  const input = objectOf(value, "recorded event line");
  return {
    type: stringOf(input.type, "recorded event line.type"),
    source: stringOf(input.source, "recorded event line.source"),
    payload: objectOf(input.payload, "recorded event line.payload"),
    scope: enumOf(input.scope, EVENT_SCOPES, "recorded event line.scope"),
    region: nullableStringOf(input.region, "recorded event line.region"),
    target: nullableStringOf(input.target, "recorded event line.target"),
    timestamp: numberOf(input.timestamp, "recorded event line.timestamp"),
  };
}

function parseRecordedSnapshotLine(value: unknown): RecordedSnapshotLine {
  const input = objectOf(value, "recorded snapshot line");
  return {
    eventCursor: numberOf(input.event_cursor, "recorded snapshot line.event_cursor"),
    snapshot: parseWorldSnapshot(input.snapshot),
  };
}

function objectOf(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  return value;
}

function nullableStringOf(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return stringOf(value, field);
}

function numberOf(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function enumOf<const T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new Error(`${field} must be one of ${allowed.join(", ")}`);
}
