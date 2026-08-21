/**
 * QA HARNESS — a recorded backend run, presented as a live one.
 *
 * The measurement probe (`src/qa/liveReplayProbe/`) proved what a real run does
 * to the presentation stage, but it runs headless: it can count moments and it
 * cannot be looked at. This is the same bridge in a browser, so a real recording
 * can be driven through the **production** observer — real canvas, real art,
 * real killfeed — and watched.
 *
 * The impersonated seams are exactly the probe's, and no more:
 *   - `LiveApiClient` is an offline bridge over the recording (the QA chronicle
 *     route's `OfflineLiveBridge` does the same thing for a fixture);
 *   - `GET /api/world` answers with the newest REAL recorded checkpoint at or
 *     below the delivered cursor, restamped cursor-forward, because a live
 *     server's world endpoint is always cursor-forward while the recorded
 *     checkpoint cadence is one per ~6.5 events;
 *   - the checkpoint feed is a no-op, isolating the story queue from checkpoint
 *     reconciliation.
 *
 * Everything downstream of `openEventStream` is production code.
 */

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "../../app/client";
import type {
  EventEnvelope,
  EventEnvelopeEntry,
  RunMetadata,
  WorldSnapshot,
} from "../../app/schemas";
import type { CheckpointFeed } from "../../presentation/CheckpointFeed";
import {
  envelopeForBatch,
  parseRecordedRun,
  parseRecordedSnapshots,
  recordedRunMetadata,
  restampSnapshot,
  type RecordedRun,
  type RecordedSnapshotRecord,
} from "../liveReplayProbe/recordedRunText";

/** Real backend SSE poll cadence (`server/app.py:74` `sse_poll_interval = 0.25`). */
export const SSE_POLL_MS = 250;

export interface RecordedBridge {
  readonly client: LiveApiClient;
  setSnapshot(snapshot: WorldSnapshot): void;
  dispatch(envelope: EventEnvelope): Promise<void>;
  /** Delivers the backend's idle keepalive on the newest active stream. */
  heartbeat(worldTime: number, status?: string): void;
  /** Fails the newest active stream, exactly as a dropped SSE socket does. */
  dropStream(): void;
  streamsOpened(): number;
  activeStreams(): number;
  undeliveredEnvelopes(): number;
  dispose(): void;
}

/** A `CheckpointFeed` that never emits — the probe's declared deviation #1. */
export function inertCheckpointFeed(): CheckpointFeed {
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

/** Builds the offline `LiveApiClient` the production session will talk to. */
export function createRecordedBridge(
  run: RunMetadata,
  initialSnapshot: WorldSnapshot,
): RecordedBridge {
  let snapshot = structuredClone(initialSnapshot);
  let disposed = false;
  const streams: Array<{ handlers: EventStreamHandlers; active: boolean }> = [];
  let undelivered = 0;
  const client: LiveApiClient = {
    getRun: async () => structuredClone(run),
    getWorld: async () => structuredClone(snapshot),
    getEvents: async (cursor: number) => ({
      schema: 1,
      cursor,
      oldest_cursor: cursor,
      next_cursor: cursor,
      events: [],
      overflow: false,
      snapshot_required: false,
    }),
    openEventStream: (cursor: number, handlers: EventStreamHandlers): EventStream => {
      const record = { handlers, active: true };
      streams.push(record);
      return {
        url: `recorded://events/${run.run_id}?cursor=${cursor}`,
        close: (): void => {
          record.active = false;
        },
      };
    },
  };
  return {
    client,
    setSnapshot: (next) => {
      if (!disposed) snapshot = structuredClone(next);
    },
    dispatch: async (envelope) => {
      if (disposed) return;
      const stream = [...streams].reverse().find((candidate) => candidate.active);
      if (stream === undefined) {
        undelivered += 1;
        return;
      }
      await Promise.resolve(stream.handlers.onEnvelope(structuredClone(envelope)));
    },
    heartbeat: (worldTime, status = "running") => {
      if (disposed) return;
      const stream = [...streams].reverse().find((candidate) => candidate.active);
      stream?.handlers.onHeartbeat?.({ cursor: -1, worldTime, status });
    },
    dropStream: () => {
      if (disposed) return;
      const stream = [...streams].reverse().find((candidate) => candidate.active);
      if (stream === undefined) return;
      stream.active = false;
      stream.handlers.onError?.(new Error("recorded stream dropped"));
    },
    streamsOpened: () => streams.length,
    activeStreams: () => streams.filter((candidate) => candidate.active).length,
    undeliveredEnvelopes: () => undelivered,
    dispose: () => {
      disposed = true;
      streams.length = 0;
    },
  };
}

export interface LoadedRecording {
  readonly runId: string;
  readonly run: RunMetadata;
  readonly firstSnapshot: WorldSnapshot;
  readonly recorded: RecordedRun;
  readonly snapshots: readonly RecordedSnapshotRecord[];
  /** The newest real checkpoint at or below `cursor`, restamped cursor-forward. */
  snapshotAt(cursor: number, worldTime: number): WorldSnapshot;
}

/** Parses one recording's two JSONL texts into everything the bridge needs. */
export function loadRecording(input: Readonly<{
  runId: string;
  eventsText: string;
  snapshotsText: string;
  model?: string;
}>): LoadedRecording {
  const recorded = parseRecordedRun(input.eventsText, input.runId);
  const snapshots = parseRecordedSnapshots(input.snapshotsText);
  const first = snapshots[0];
  if (first === undefined) throw new Error(`recording ${input.runId} has no snapshots`);
  const runId = first.snapshot.run_id;
  const firstSnapshot = first.snapshot;
  return {
    runId,
    run: recordedRunMetadata({
      runId,
      seed: 0,
      snapshot: firstSnapshot,
      model: input.model ?? "recorded",
    }),
    firstSnapshot,
    recorded,
    snapshots,
    snapshotAt: (cursor, worldTime) => {
      let chosen = first;
      for (const record of snapshots) {
        if (record.eventCursor <= cursor) chosen = record;
        else break;
      }
      return restampSnapshot(chosen.snapshot, { runId, eventCursor: cursor, worldTime });
    },
  };
}

export interface ReplayDriverOptions {
  readonly recording: LoadedRecording;
  readonly bridge: RecordedBridge;
  /** Arrival-rate multiplier. 1 replays at the run's own recorded spacing. */
  readonly rate: number;
  /** Called after every delivered batch, with the wall-clock offset reached. */
  readonly onProgress?: (input: Readonly<{
    atMs: number;
    deliveredCursor: number;
    remaining: number;
  }>) => void;
  readonly onComplete?: () => void;
}

export interface ReplayDriver {
  start(): void;
  stop(): void;
  /** Recorded-time offset reached so far, in milliseconds. */
  atMs(): number;
}

/**
 * Delivers a recording into the bridge on real timers, batched on the backend's
 * own SSE poll cadence so `BeatDirector` chains exactly as it does live.
 *
 * `rate` multiplies the ARRIVAL rate only; the presentation clock stays real, so
 * `rate=4` is rate stress rather than fast-forward — which is the point, since
 * production's own speed contract caps at 2x.
 */
export function createReplayDriver(options: ReplayDriverOptions): ReplayDriver {
  const { entries, offsetsMs, spanMs } = options.recording.recorded;
  const rate = options.rate > 0 ? options.rate : 1;
  let index = 0;
  let startedAt = 0;
  let handle: ReturnType<typeof setInterval> | null = null;
  let reached = 0;

  const tick = (): void => {
    reached = (performance.now() - startedAt) * rate;
    const batch: EventEnvelopeEntry[] = [];
    while (index < entries.length && (offsetsMs[index] ?? Infinity) <= reached) {
      batch.push(entries[index]!);
      index += 1;
    }
    if (batch.length > 0) {
      const last = batch[batch.length - 1]!;
      options.bridge.setSnapshot(
        options.recording.snapshotAt(last.cursor, last.event.timestamp),
      );
      void options.bridge.dispatch(envelopeForBatch(batch));
      options.onProgress?.({
        atMs: reached,
        deliveredCursor: last.cursor,
        remaining: entries.length - index,
      });
    }
    if (index >= entries.length && reached > spanMs) {
      options.onComplete?.();
      if (handle !== null) clearInterval(handle);
      handle = null;
    }
  };

  return {
    start: (): void => {
      if (handle !== null) return;
      startedAt = performance.now();
      handle = setInterval(tick, Math.max(16, SSE_POLL_MS / rate));
    },
    stop: (): void => {
      if (handle !== null) clearInterval(handle);
      handle = null;
    },
    atMs: () => reached,
  };
}
