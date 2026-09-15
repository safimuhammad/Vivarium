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
 * Recorded transport seams:
 *   - `LiveApiClient` is an offline bridge over the recording (`createRecordedRunBridge`);
 *     `getEvents` always answers empty because a recording is delivered purely
 *     through the SSE-shaped push path (`dispatch`), never through backfill polling.
 *   - `GET /api/world` answers with the newest REAL recorded checkpoint at or
 *     below the delivered cursor and recorded time, restamped cursor-forward
 *     (`RecordedRun.snapshotAt`) so a coarse checkpoint never leaks future state.
 *   - Later real checkpoints enter the normal production reconciliation path at
 *     their original world times through a per-session feed
 *     (`createRecordedCheckpointFeedHub`).
 *   - Exact `simulation_stopped` and `run_stopped` checkpoints are quiescent
 *     terminal truth: they use that safe reconciliation channel without altering
 *     their persisted reason. Other manual checkpoints remain archival only.
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
import type {
  CheckpointFeed,
  CheckpointFeedDiagnostics,
  CheckpointFeedFault,
} from "../../presentation/CheckpointFeed";
import type {
  ClassifiedCheckpointRecord,
  LiveCutSafety,
} from "../../presentation/contracts";
import {
  reconcileReplaySelectorAfterArtifactShift,
  type ReplayArtifactClient,
  type ReplayArtifacts,
} from "../replayArtifactClient";
import type { SnapshotCheckpoint } from "../replayArtifacts";

/** Real backend SSE poll cadence (`server/app.py` `sse_poll_interval = 0.25`). */
export const SSE_POLL_MS = 250;

const EVENT_SCOPES = ["local", "global", "targeted", "private"] as const;
const RECORDED_QUIESCENT_FINAL_REASONS = new Set(["simulation_stopped", "run_stopped"]);

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
  /** Milliseconds after the initial recorded checkpoint at which this entry was emitted. */
  readonly offsetMs: number;
}

/** A run recorded to disk, parsed from the two JSONL files a run writes. */
export interface RecordedRun {
  /** The recording's true identity — the `run_id` of its first snapshot, not the caller's label. */
  readonly runId: string;
  /** Cursor-1-based entries in recorded timestamp order. */
  readonly entries: readonly RecordedRunEntry[];
  /** Exact checkpoint records in their append order. */
  readonly checkpoints: readonly SnapshotCheckpoint[];
  readonly firstSnapshot: WorldSnapshot;
  readonly run: RunMetadata;
  /** Exact world time at which playback can truthfully finish. */
  readonly endWorldTime: number;
  /** Milliseconds from the initial checkpoint to the final recorded event or checkpoint. */
  readonly spanMs: number;
  /**
   * The newest real recorded checkpoint at or below both `cursor` and
   * `worldTime`, restamped onto the requested identity so it reads as a live,
   * cursor-forward `GET /api/world` answer rather than the coarser cadence a
   * checkpoint is actually recorded at.
   */
  snapshotAt(cursor: number, worldTime: number): WorldSnapshot;
  /**
   * Exact recording-owned event/checkpoint material for historical card replay.
   * Optional so an older caller that only supplies the live bridge retains the
   * existing focus-only behavior instead of borrowing a different run's API.
   */
  replayArtifacts?(): ReplayArtifacts;
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
  const snapshotLines = parseJsonl(input.snapshotsText).map((raw) => parseRecordedSnapshotLine(raw));
  const firstLine = snapshotLines[0];
  if (firstLine === undefined) {
    throw new Error(`recorded run ${input.runId} has no snapshots`);
  }
  const lines = parseJsonl(input.eventsText)
    .map((raw) => parseRecordedEventLine(raw))
    .slice()
    .sort((left, right) => left.timestamp - right.timestamp);
  const startedAt = firstLine.snapshot.world_time;
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
  const runId = firstLine.snapshot.run_id;
  if (snapshotLines.some((line) => line.snapshot.run_id !== runId)) {
    throw new Error(`recorded run ${input.runId} contains multiple snapshot run identities`);
  }
  const firstSnapshot = firstLine.snapshot;
  const run = buildRecordedRunMetadata({ runId, snapshot: firstSnapshot, metadata: input.metadata });
  const checkpoints = snapshotLines.map((line, index): SnapshotCheckpoint => ({
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: line.reason,
    run_id: runId,
    world_time: line.snapshot.world_time,
    event_cursor: line.snapshot.event_cursor,
    snapshot: structuredClone(line.snapshot),
    lineNumber: index + 1,
  }));
  const lastRecordedEventTime = entries[entries.length - 1]?.event.timestamp ?? startedAt;
  const endWorldTime = Math.max(
    lastRecordedEventTime,
    checkpoints[checkpoints.length - 1]!.world_time,
  );
  const spanMs = Math.max(0, (endWorldTime - startedAt) * 1_000);

  return {
    runId,
    entries,
    checkpoints,
    firstSnapshot,
    run,
    endWorldTime,
    spanMs,
    snapshotAt(cursor, worldTime): WorldSnapshot {
      // A checkpoint may share the final event cursor while being written later
      // by the world heartbeat or stop path. It is not legal bridge truth for an
      // earlier delivered event, even though its cursor is equal. Choose only a
      // checkpoint the recording had actually reached in both dimensions.
      let chosen: RecordedSnapshotLine | null = null;
      for (const record of snapshotLines) {
        if (record.eventCursor > cursor || record.snapshot.world_time > worldTime) continue;
        if (chosen === null || record.snapshot.world_time >= chosen.snapshot.world_time) {
          chosen = record;
        }
      }
      if (chosen === null) {
        throw new RangeError(`recorded run ${runId} has no checkpoint at cursor ${cursor} and time ${worldTime}`);
      }
      return restampSnapshot(chosen.snapshot, { runId, eventCursor: cursor, worldTime });
    },
    replayArtifacts(): ReplayArtifacts {
      return recordedReplayArtifacts(runId, entries, checkpoints);
    },
  };
}

/**
 * Creates the artifact client for a saved run from the recording itself.
 *
 * This intentionally never falls through to `/api/replay`: that endpoint names
 * whatever live run happens to be active, which is not authority for a saved
 * recording. Callers with an old bridge-only `RecordedRun` receive `null` and
 * retain their focus-only Chronicle click instead.
 */
export function createRecordedReplayArtifactClient(
  recording: RecordedRun,
): ReplayArtifactClient | null {
  if (recording.replayArtifacts === undefined) return null;
  const base = recording.replayArtifacts();
  if (base.runId !== recording.runId) return null;
  const copy = (): ReplayArtifacts => structuredClone(base);
  return {
    fetchArtifacts: async () => copy(),
    fetchForRun: async (expectedRunId) => {
      if (expectedRunId !== recording.runId) {
        throw new Error(`recorded replay belongs to ${recording.runId}, not ${expectedRunId}`);
      }
      return copy();
    },
    fetchOlderArtifacts: async () => copy(),
    reconcileSelector: async (previous, next, selector) => (
      reconcileReplaySelectorAfterArtifactShift(previous, next, selector)
    ),
    exportEvents: async () => copy().events,
    exportSnapshots: async () => copy().checkpoints,
    fetchEvents: async () => copy().events,
    fetchSnapshots: async () => copy().checkpoints,
  };
}

function recordedReplayArtifacts(
  runId: string,
  entries: readonly RecordedRunEntry[],
  checkpoints: readonly SnapshotCheckpoint[],
): ReplayArtifacts {
  return {
    runId,
    events: entries.map((entry) => structuredClone(entry)),
    checkpoints: checkpoints.map((checkpoint) => structuredClone(checkpoint)),
    checkpointIndex: checkpoints.map((checkpoint) => ({
      lineNumber: checkpoint.lineNumber,
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      reason: checkpoint.reason,
      runId: checkpoint.run_id,
    })),
    eventTotalCount: entries.length,
    checkpointTotalCount: checkpoints.length,
    firstCheckpointLine: checkpoints[0]?.lineNumber ?? null,
    nextCheckpointBefore: null,
    hasOlderCheckpoints: false,
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

/** Advances recording time for one or more session-owned checkpoint feeds. */
export interface RecordedCheckpointTimeline {
  advanceTo(worldTime: number): void;
}

export interface RecordedRunDriverOptions {
  readonly recording: RecordedRun;
  readonly bridge: RecordedRunBridge;
  /** Exact checkpoints delivered through the production reconciliation path. */
  readonly checkpointFeed?: RecordedCheckpointTimeline;
  /** Arrival-rate multiplier. 1 (the default) replays at the run's own recorded spacing. */
  readonly rate?: number;
  readonly scheduler?: RecordedRunDriverPlatform;
  /** Called after every delivered batch, with the wall-clock offset reached. */
  readonly onProgress?: (progress: RecordedRunDriverProgress) => void;
  /** Called only after the final recorded checkpoint time is reached. */
  readonly onComplete?: (worldTime: number) => void;
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

  // The initial bridge world is the first exact checkpoint. Its cursor already
  // includes this many recorded events, so replaying them would duplicate old
  // evidence after the world has started from its resulting state.
  let index = Math.min(entries.length, Math.max(0, options.recording.firstSnapshot.event_cursor));
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
    const reachedWorldTime = options.recording.firstSnapshot.world_time + reached / 1_000;
    options.checkpointFeed?.advanceTo(reachedWorldTime);
    if (index >= entries.length && reached >= spanMs) {
      const terminal = options.recording.checkpoints[options.recording.checkpoints.length - 1];
      if (terminal !== undefined && terminal.world_time === options.recording.endWorldTime) {
        options.bridge.setSnapshot(terminal.snapshot);
      }
      running = false;
      options.onComplete?.(options.recording.endWorldTime);
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

/** A recording-owned checkpoint feed advanced by the replay driver’s real timeline. */
export interface RecordedCheckpointFeed extends CheckpointFeed, RecordedCheckpointTimeline {
  /** Delivers each undispatched checkpoint at or before its original world time. */
  advanceTo(worldTime: number): void;
}

/**
 * Owns the recording timeline while each production session owns and disposes
 * its own feed. This keeps a StrictMode probe from closing the survivor's feed,
 * and lets a later session catch up from the timeline it joins.
 */
export interface RecordedCheckpointFeedHub extends RecordedCheckpointTimeline {
  createFeed(): RecordedCheckpointFeed;
  dispose(): void;
}

/**
 * Supplies exact recorded checkpoints to the ordinary production reconciliation
 * path. The first checkpoint is already the bridge's initial world, so this feed
 * begins after it and never substitutes a later snapshot for an earlier event.
 */
export function createRecordedCheckpointFeed(recording: RecordedRun): RecordedCheckpointFeed {
  let disposed = false;
  let runId: string | null = null;
  let sourceKey: string | null = null;
  let nextIndex = 1;
  let lastDeliveredLine = recording.checkpoints[0]?.lineNumber ?? 0;
  let retainedSafeCheckpoints = 0;
  let requestedWorldTime: number | null = null;
  const listeners = new Set<(record: ClassifiedCheckpointRecord) => void>();
  const faultListeners = new Set<(fault: CheckpointFeedFault) => void>();

  const deliver = (record: ClassifiedCheckpointRecord): void => {
    for (const listener of [...listeners]) {
      if (disposed || runId === null || sourceKey === null) return;
      try {
        listener(record);
      } catch {
        // A view listener cannot block delivery to its peers or the replay clock.
      }
    }
  };

  const advanceTo = (worldTime: number): void => {
    if (disposed) return;
    requestedWorldTime = requestedWorldTime === null
      ? worldTime
      : Math.max(requestedWorldTime, worldTime);
    if (runId === null || sourceKey === null) return;
    while (nextIndex < recording.checkpoints.length) {
      const checkpoint = recording.checkpoints[nextIndex]!;
      if (checkpoint.world_time > requestedWorldTime) return;
      nextIndex += 1;
      lastDeliveredLine = checkpoint.lineNumber ?? nextIndex;
      const safety = classifyRecordedCheckpointSafety(checkpoint);
      if (safety === "safe-world-tick") retainedSafeCheckpoints += 1;
      deliver({
        line: checkpoint.lineNumber ?? nextIndex,
        checkpoint: structuredClone(checkpoint),
        safety,
      });
    }
  };

  const reset = (identity: { runId: string; sourceKey: string }): void => {
    if (disposed) return;
    if (identity.runId !== recording.runId) {
      throw new Error(`recorded checkpoint feed belongs to ${recording.runId}, not ${identity.runId}`);
    }
    if (identity.sourceKey.trim() === "") {
      throw new Error("recorded checkpoint feed source key must not be empty");
    }
    runId = identity.runId;
    sourceKey = identity.sourceKey;
    nextIndex = 1;
    lastDeliveredLine = recording.checkpoints[0]?.lineNumber ?? 0;
    retainedSafeCheckpoints = 0;
    if (requestedWorldTime !== null) advanceTo(requestedWorldTime);
  };

  return {
    start: reset,
    reset,
    subscribe(listener): () => void {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    subscribeFault(listener): () => void {
      if (!disposed) faultListeners.add(listener);
      return () => { faultListeners.delete(listener); };
    },
    advanceTo,
    diagnostics(): CheckpointFeedDiagnostics {
      return {
        disposed,
        runId,
        lastDeliveredLine,
        polling: false,
        retainedSafeCheckpoints,
        faultCount: 0,
      };
    },
    dispose(): void {
      disposed = true;
      runId = null;
      sourceKey = null;
      listeners.clear();
      faultListeners.clear();
    },
  };
}

/** Creates independent session feeds coordinated by one recorded-time timeline. */
export function createRecordedCheckpointFeedHub(recording: RecordedRun): RecordedCheckpointFeedHub {
  let disposed = false;
  let reachedWorldTime = recording.firstSnapshot.world_time;
  const feeds = new Set<RecordedCheckpointFeed>();

  return {
    createFeed(): RecordedCheckpointFeed {
      const inner = createRecordedCheckpointFeed(recording);
      let released = false;
      const feed: RecordedCheckpointFeed = {
        start: (identity) => inner.start(identity),
        reset: (identity) => inner.reset(identity),
        subscribe: (listener) => inner.subscribe(listener),
        subscribeFault: (listener) => inner.subscribeFault(listener),
        advanceTo: (worldTime) => inner.advanceTo(worldTime),
        diagnostics: () => inner.diagnostics(),
        dispose: () => {
          if (released) return;
          released = true;
          feeds.delete(feed);
          inner.dispose();
        },
      };
      if (disposed) {
        feed.dispose();
      } else {
        feeds.add(feed);
        // `createRecordedCheckpointFeed` retains a requested time before its
        // session starts, then emits the exact prefix after it subscribes.
        feed.advanceTo(reachedWorldTime);
      }
      return feed;
    },
    advanceTo(worldTime): void {
      if (disposed) return;
      reachedWorldTime = Math.max(reachedWorldTime, worldTime);
      for (const feed of [...feeds]) feed.advanceTo(reachedWorldTime);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const feed of [...feeds]) feed.dispose();
    },
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

function classifyRecordedCheckpointSafety(checkpoint: SnapshotCheckpoint): LiveCutSafety {
  if (
    checkpoint.reason === "world_tick"
    || RECORDED_QUIESCENT_FINAL_REASONS.has(checkpoint.reason)
  ) return "safe-world-tick";
  if (checkpoint.reason.startsWith("event:")) return "archive-event";
  return "archive-manual";
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
  readonly reason: string;
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
    reason: stringOf(input.reason, "recorded snapshot line.reason"),
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
