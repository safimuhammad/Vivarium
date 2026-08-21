/**
 * TEMPORARY EXPERIMENT HARNESS -- live-replay probe (measurement, not a feature).
 *
 * Drives the exact production Live presentation stack behind `/?renderer=2d`
 * (`createProductionObserverSession` -> `createLivePresentationSession` ->
 * `PresentationSession` -> `StoryDirector` -> `SceneExecutor`) from a recorded
 * backend run, at that run's own recorded wall-clock spacing.
 *
 * Nothing here changes production code. The only impersonated seams are the two
 * the QA chronicle harness already impersonates:
 *   - `LiveApiClient` (an offline bridge, exactly like `OfflineLiveBridge`)
 *   - the canvas frame-acceptance callback (exactly like
 *     `chronicleValidationProduction.ts:590`)
 * plus a deterministic `PresentationClock` so 360 recorded seconds can be
 * advanced exactly rather than waited out.
 */

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "../../app/client";
import { createProductionObserverSession } from "../../app/observer2d/createProductionObserverSession";
import type {
  EventEnvelope,
  EventEnvelopeEntry,
  RunMetadata,
  WorldSnapshot,
} from "../../app/schemas";
import { BeatDirector, type StoryMoment } from "../../presentation/BeatDirector";
import type { CheckpointFeed } from "../../presentation/CheckpointFeed";
import {
  createManualPresentationClock,
  type ManualPresentationClock,
} from "../../presentation/fixtures/ManualPresentationClock";
import { envelopeForBatch } from "./recordedRun";

/** Real backend SSE poll cadence (`server/app.py:74` `sse_poll_interval = 0.25`). */
export const SSE_POLL_MS = 250;

export interface PerformedMoment {
  readonly momentId: string;
  readonly representativeType: string;
  readonly priority: string;
  readonly evidenceTypes: readonly string[];
  readonly startMs: number;
  endMs: number;
}

export interface QueuedMoment {
  readonly momentId: string;
  readonly representativeType: string;
  readonly priority: string;
  readonly evidenceTypes: readonly string[];
  readonly messageLength: number;
}

export interface RecoveryObservation {
  readonly atMs: number;
  readonly presentedCursor: number;
  readonly ingestedCursor: number;
}

export interface QueueDepthSample {
  readonly atMs: number;
  readonly pending: number;
  readonly backlogState: string;
}

export interface ProbeResult {
  readonly runLabel: string;
  readonly eventsDelivered: number;
  readonly momentsQueued: number;
  readonly momentsPerformed: number;
  readonly momentsDroppedOrStranded: number;
  readonly pendingAtEnd: number;
  /** Wall time the paced pass spent letting the tail play out past the recording. */
  readonly tailDrainMs: number;
  readonly wallClockMs: number;
  readonly totalStageMs: number;
  readonly stageMsByType: Readonly<Record<string, number>>;
  readonly performedCountByType: Readonly<Record<string, number>>;
  readonly queuedCountByType: Readonly<Record<string, number>>;
  readonly recoveries: readonly RecoveryObservation[];
  readonly queueDepth: readonly QueueDepthSample[];
  readonly firstOverflowMs: number | null;
  readonly steadyOverflowMs: number | null;
  readonly chapters: number;
  readonly finalBacklogState: string;
  readonly finalBacklogLabel: string;
  readonly finalTransport: string;
  readonly performed: readonly PerformedMoment[];
  readonly queued: readonly QueuedMoment[];
  readonly selfTalkStageEvidence: SelfTalkStageEvidence | null;
  readonly streamsOpened: number;
  readonly streamsClosed: number;
  readonly streamOpenCursors: readonly number[];
  readonly undeliveredEnvelopes: number;
  readonly activeStreamAtEnd: boolean;
  readonly finalRecoveryStatus: string;
  readonly lastCompletedRecovery: unknown;
  readonly ingestedCursorAtEnd: number;
  readonly presentedCursorAtEnd: number;
}

/** Runtime proof of what a `self_talk` scene actually puts on the stage. */
export interface SelfTalkStageEvidence {
  readonly momentId: string;
  readonly focus: string;
  readonly messageLength: number;
  readonly selection: string;
  readonly phase: string;
  readonly actorIntents: number;
  readonly effectIntents: number;
  readonly effectKinds: readonly string[];
  readonly homeIntents: number;
  readonly dialogueFromScene: string | null;
  readonly dialogueVisibleCharacters: number | null;
  readonly regionId: string | null;
}

function noopCheckpointFeed(): CheckpointFeed {
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

interface RecordedBridge {
  readonly client: LiveApiClient;
  worldFetchCount(): number;
  setSnapshot(snapshot: WorldSnapshot): void;
  dispatch(envelope: EventEnvelope): Promise<void>;
  hasStream(): boolean;
  streamsOpened(): number;
  streamsClosed(): number;
  undeliveredEnvelopes(): number;
  openLog(): readonly number[];
  dispose(): void;
}

function createRecordedBridge(
  run: RunMetadata,
  initialSnapshot: WorldSnapshot,
): RecordedBridge {
  let snapshot = structuredClone(initialSnapshot);
  let worldFetches = 0;
  let disposed = false;
  const streams: Array<{ handlers: EventStreamHandlers; active: boolean }> = [];
  const openCursors: number[] = [];
  let undelivered = 0;
  const client: LiveApiClient = {
    getRun: async () => structuredClone(run),
    getWorld: async () => {
      worldFetches += 1;
      return structuredClone(snapshot);
    },
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
      openCursors.push(cursor);
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
    worldFetchCount: () => worldFetches,
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
    hasStream: () => streams.some((candidate) => candidate.active),
    streamsOpened: () => streams.length,
    streamsClosed: () => streams.filter((candidate) => !candidate.active).length,
    undeliveredEnvelopes: () => undelivered,
    openLog: () => [...openCursors],
    dispose: () => {
      disposed = true;
      streams.length = 0;
    },
  };
}

function representativeType(moment: StoryMoment): string {
  return moment.representative.event.type;
}

function messageLength(moment: StoryMoment): number {
  const message = moment.representative.event.payload.message;
  return typeof message === "string" ? message.length : 0;
}

async function flush(passes = 6): Promise<void> {
  for (let index = 0; index < passes; index += 1) await Promise.resolve();
}

export interface ProbeOptions {
  readonly runLabel: string;
  readonly run: RunMetadata;
  readonly snapshot: WorldSnapshot;
  readonly entries: readonly EventEnvelopeEntry[];
  readonly offsetsMs: readonly number[];
  /**
   * `"paced"` delivers at the run's own recorded spacing (the real experiment).
   * `"demand"` delivers the same batches but waits for the stage to go idle
   * between them, measuring how much scene time the run actually demands.
   */
  readonly mode: "paced" | "demand";
  /**
   * What `GET /api/world` returns at the given already-delivered cursor. A live
   * server always answers with the CURRENT world, so this must be cursor-forward.
   */
  readonly recoverySnapshotAt?: (cursor: number, worldTime: number) => WorldSnapshot;
  /** Capture stage evidence for the first `self_talk` moment that reaches hold. */
  readonly captureSelfTalk?: boolean;
  readonly demandBudgetMs?: number;
  /**
   * How long the paced pass keeps the clock running after the recording ends.
   *
   * A recording stops; a world does not. Without this, every moment still on
   * the stage or queued at the last recorded millisecond is counted as
   * "stranded", which conflates *permanently behind and growing* with *a tail
   * still playing out*. Bounded, and reported separately as `tailDrainMs`.
   */
  readonly settleTailMs?: number;
}

/** Runs one recorded run through the production Live session and measures it. */
export async function runLiveReplayProbe(options: ProbeOptions): Promise<ProbeResult> {
  const clock: ManualPresentationClock = createManualPresentationClock({
    initialNowMs: 0,
    maxCallbacksPerAdvance: 200_000,
  });
  const bridge = createRecordedBridge(options.run, options.snapshot);
  const bundle = createProductionObserverSession({
    clientFactory: () => bridge.client,
    clockFactory: () => clock,
    checkpointFeedFactory: noopCheckpointFeed,
  });
  const session = bundle.session;

  const performed: PerformedMoment[] = [];
  const performedById = new Map<string, PerformedMoment>();
  const queued: QueuedMoment[] = [];
  const queuedById = new Map<string, QueuedMoment>();
  const recoveries: RecoveryObservation[] = [];
  const queueDepth: QueueDepthSample[] = [];
  let selfTalkEvidence: SelfTalkStageEvidence | null = null;
  let activeMomentId: string | null = null;
  let lastWorldFetches = 0;

  const closeActive = (): void => {
    if (activeMomentId === null) return;
    const record = performedById.get(activeMomentId);
    if (record !== undefined) record.endMs = clock.now();
    activeMomentId = null;
  };

  const onFrame = (): void => {
    const frame = session.getFrame();
    bundle.frameAcceptance.markAccepted(frame);
    const sceneMomentId = frame.scene?.momentId ?? null;
    if (sceneMomentId !== activeMomentId) {
      closeActive();
      if (sceneMomentId !== null) {
        const meta = queuedById.get(sceneMomentId);
        const record: PerformedMoment = {
          momentId: sceneMomentId,
          representativeType: meta?.representativeType ?? "unknown",
          priority: meta?.priority ?? "unknown",
          evidenceTypes: meta?.evidenceTypes ?? [],
          startMs: clock.now(),
          endMs: clock.now(),
        };
        performed.push(record);
        performedById.set(sceneMomentId, record);
        activeMomentId = sceneMomentId;
      }
    }
    if (activeMomentId !== null) {
      const record = performedById.get(activeMomentId);
      if (record !== undefined) record.endMs = clock.now();
    }
    if (
      options.captureSelfTalk === true
      && selfTalkEvidence === null
      && frame.scene !== null
      && frame.scene.phase === "hold"
      && queuedById.get(frame.scene.momentId)?.representativeType === "self_talk"
    ) {
      const meta = queuedById.get(frame.scene.momentId)!;
      selfTalkEvidence = {
        momentId: frame.scene.momentId,
        focus: JSON.stringify(frame.scene.focus),
        messageLength: meta.messageLength,
        selection: frame.selection === null ? "none" : JSON.stringify(frame.selection),
        phase: frame.scene.phase,
        actorIntents: frame.scene.actorIntents.length,
        effectIntents: frame.scene.effectIntents.length,
        effectKinds: frame.scene.effectIntents.map((intent) => intent.kind),
        homeIntents: frame.scene.homeIntents.length,
        dialogueFromScene: frame.scene.dialogue?.text ?? null,
        dialogueVisibleCharacters: frame.scene.dialogue?.visibleCharacters ?? null,
        regionId: frame.scene.regionId,
      };
    }
  };

  const unsubscribe = session.subscribe(onFrame);
  await session.ready;
  await flush();
  onFrame();
  lastWorldFetches = bridge.worldFetchCount();

  const sampleRecovery = (): void => {
    const fetches = bridge.worldFetchCount();
    if (fetches <= lastWorldFetches) return;
    const frame = session.getFrame();
    for (let index = lastWorldFetches; index < fetches; index += 1) {
      recoveries.push({
        atMs: clock.now(),
        presentedCursor: frame.presentedCursor,
        ingestedCursor: frame.ingestedCursor,
      });
    }
    lastWorldFetches = fetches;
  };

  const deliver = async (batch: readonly EventEnvelopeEntry[]): Promise<void> => {
    if (batch.length === 0) return;
    const grouped = new BeatDirector().group([...batch]);
    for (const moment of grouped) {
      if (queuedById.has(moment.id)) continue;
      const record: QueuedMoment = {
        momentId: moment.id,
        representativeType: representativeType(moment),
        priority: moment.priority,
        evidenceTypes: moment.evidence.map((entry) => entry.event.type),
        messageLength: messageLength(moment),
      };
      queued.push(record);
      queuedById.set(moment.id, record);
    }
    if (options.recoverySnapshotAt !== undefined) {
      const last = batch[batch.length - 1];
      bridge.setSnapshot(options.recoverySnapshotAt(last.cursor, last.event.timestamp));
    }
    await bridge.dispatch(envelopeForBatch(batch));
    await flush();
    sampleRecovery();
  };

  let tailDrainMs = 0;
  let firstOverflowMs: number | null = null;
  let steadyOverflowMs: number | null = null;
  let consecutiveOverflowSamples = 0;

  const sampleQueue = (): void => {
    const frame = session.getFrame();
    const pending = session.diagnostics().director.pendingMoments;
    queueDepth.push({
      atMs: clock.now(),
      pending,
      backlogState: frame.backlog.state,
    });
    if (frame.backlog.state === "overflow" || pending >= 48) {
      if (firstOverflowMs === null) firstOverflowMs = clock.now();
      consecutiveOverflowSamples += 1;
      if (consecutiveOverflowSamples >= 8 && steadyOverflowMs === null) {
        steadyOverflowMs = clock.now();
      }
    } else {
      consecutiveOverflowSamples = 0;
    }
  };

  if (options.mode === "paced") {
    const span = options.offsetsMs[options.offsetsMs.length - 1];
    let cursorIndex = 0;
    for (let tick = 0; clock.now() <= span + SSE_POLL_MS * 4; tick += 1) {
      const target = tick * SSE_POLL_MS;
      clock.advanceTo(target);
      await flush();
      sampleRecovery();
      const batch: EventEnvelopeEntry[] = [];
      while (
        cursorIndex < options.entries.length
        && options.offsetsMs[cursorIndex] <= target
      ) {
        batch.push(options.entries[cursorIndex]);
        cursorIndex += 1;
      }
      await deliver(batch);
      sampleQueue();
      if (cursorIndex >= options.entries.length && clock.now() >= span) break;
    }
    // Let the wall clock reach the recorded span exactly.
    if (clock.now() < span) {
      clock.advanceTo(span);
      await flush();
      sampleRecovery();
      sampleQueue();
    }
    // Then, optionally, let the tail play out: the recording stopped, the world
    // would not have. Anything still queued here is mid-performance, not lost.
    const tailBudget = options.settleTailMs ?? 0;
    const tailStart = clock.now();
    while (clock.now() - tailStart < tailBudget) {
      const diagnostics = session.diagnostics().director;
      if (diagnostics.pendingMoments === 0 && diagnostics.activeSceneCount === 0) break;
      clock.advanceBy(250);
      await flush(2);
      sampleRecovery();
      sampleQueue();
    }
    tailDrainMs = clock.now() - tailStart;
  } else {
    const budget = options.demandBudgetMs ?? 60 * 60 * 1_000;
    let index = 0;
    while (index < options.entries.length) {
      // Group by the same SSE poll window so BeatDirector chains identically.
      const windowStart = options.offsetsMs[index];
      const batch: EventEnvelopeEntry[] = [];
      while (
        index < options.entries.length
        && options.offsetsMs[index] < windowStart + SSE_POLL_MS
      ) {
        batch.push(options.entries[index]);
        index += 1;
      }
      await deliver(batch);
      for (let guard = 0; guard < 20_000; guard += 1) {
        const diagnostics = session.diagnostics().director;
        if (diagnostics.pendingMoments === 0 && diagnostics.activeSceneCount === 0) break;
        clock.advanceBy(100);
        await flush(2);
        if (clock.now() > budget) throw new Error("demand pass exceeded its budget");
      }
      sampleQueue();
    }
  }

  closeActive();
  const frame = session.getFrame();
  const chronicle = session.getChronicle();
  const pendingAtEnd = session.diagnostics().director.pendingMoments;

  const stageMsByType: Record<string, number> = {};
  const performedCountByType: Record<string, number> = {};
  let totalStageMs = 0;
  for (const record of performed) {
    const duration = Math.max(0, record.endMs - record.startMs);
    totalStageMs += duration;
    stageMsByType[record.representativeType] =
      (stageMsByType[record.representativeType] ?? 0) + duration;
    performedCountByType[record.representativeType] =
      (performedCountByType[record.representativeType] ?? 0) + 1;
  }
  const queuedCountByType: Record<string, number> = {};
  for (const record of queued) {
    queuedCountByType[record.representativeType] =
      (queuedCountByType[record.representativeType] ?? 0) + 1;
  }

  const result: ProbeResult = {
    runLabel: options.runLabel,
    eventsDelivered: options.entries.length,
    momentsQueued: queued.length,
    momentsPerformed: performed.length,
    momentsDroppedOrStranded: queued.length - performed.length - pendingAtEnd,
    pendingAtEnd,
    tailDrainMs,
    wallClockMs: clock.now(),
    totalStageMs,
    stageMsByType,
    performedCountByType,
    queuedCountByType,
    recoveries,
    queueDepth,
    firstOverflowMs,
    steadyOverflowMs,
    chapters: chronicle.gaps.length,
    finalBacklogState: frame.backlog.state,
    finalBacklogLabel: frame.backlog.label,
    finalTransport: frame.transport.connection,
    performed,
    queued,
    selfTalkStageEvidence: selfTalkEvidence,
    streamsOpened: bridge.streamsOpened(),
    streamsClosed: bridge.streamsClosed(),
    streamOpenCursors: bridge.openLog(),
    undeliveredEnvelopes: bridge.undeliveredEnvelopes(),
    activeStreamAtEnd: bridge.hasStream(),
    finalRecoveryStatus: session.diagnostics().recovery.status,
    lastCompletedRecovery: session.diagnostics().lastCompletedRecovery,
    ingestedCursorAtEnd: frame.ingestedCursor,
    presentedCursorAtEnd: frame.presentedCursor,
  };

  unsubscribe();
  bundle.dispose();
  bridge.dispose();
  clock.dispose();
  return result;
}
