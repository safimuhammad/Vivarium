import type { EventEnvelopeEntry } from "../app/schemas";
import type { CheckpointFeedFault } from "./CheckpointFeed";
import type {
  CheckpointFocusTarget,
  ClassifiedCheckpointRecord,
  FrameIdentity,
  PresentationBacklog,
  PresentationGap,
  PresentationIngressFault,
  PresentedSceneView,
  PresentedStagingBeat,
  PresentedUtterance,
  PresentedWorldView,
} from "./contracts";
import { assertValidFrameIdentity } from "./contracts";
import type {
  ConversationStaging,
  ConversationStagingDecision,
} from "./conversationStaging";
import type { StoryMoment } from "./BeatDirector";
import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import type { PresentedEventType } from "./eventPayloads";
import { PresentedWorldModel } from "./PresentedWorldModel";
import {
  SceneSettlementCoordinator,
  ScenePublicationPending,
  type SceneRuntimeProgram,
  type StoryPhase,
} from "./SceneSettlementCoordinator";
import { clamp, type PresentationClock } from "./storyClock";
import { isUtteranceMoment, utterancesFor } from "./utteranceLane";

export type PresentationSpeed = 0.5 | 1 | 1.5 | 2;

export interface PresentationPressureSummary {
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly ambientCount: number;
  readonly majorMomentIds: readonly string[];
  readonly majorDigest: readonly MajorStoryDigestEntry[];
  readonly archiveAvailable: boolean;
}

export interface MajorStoryDigestEntry {
  readonly eventType: PresentedEventType;
  readonly count: number;
}

export interface CheckpointPresentationHold {
  readonly line: number;
  readonly eventCursor: number;
  readonly worldTime: number;
  readonly correctionEntityIds: readonly string[];
  readonly elapsedMs: number;
  readonly durationMs: number;
  readonly remainingMs: number;
  readonly segmentElapsedMs: number;
  readonly segmentDurationMs: number;
  readonly segmentRemainingMs: number;
  readonly focusTarget: CheckpointFocusTarget;
}

export type CheckpointAcceptanceDisposition =
  | "accepted"
  | "ignored"
  | "compacted"
  | "overflow";

export interface CheckpointCompactionDiagnostics {
  readonly count: number;
  readonly newestCompactedDigest: string;
}

export interface CheckpointOverflowDiagnostics {
  readonly line: number;
  readonly digest: string;
}

export interface StoryDirectorSnapshot {
  readonly identity: FrameIdentity;
  readonly ingestedCursor: number;
  readonly presentedCursor: number;
  readonly activeMoment: StoryMoment | null;
  readonly phase: StoryPhase | null;
  readonly activeProgramId: string | null;
  readonly activeScene: PresentedSceneView | null;
  readonly activeSceneToken: number | null;
  /** The overlay lane's rolling window — display-only beats that took no lease. */
  readonly utterances: readonly PresentedUtterance[];
  /** The staging lane's rolling window — conversational approaches, no lease either. */
  readonly staging: readonly PresentedStagingBeat[];
  readonly checkpointHold: CheckpointPresentationHold | null;
  readonly pending: readonly StoryMoment[];
  readonly backlog: PresentationBacklog;
  readonly paused: boolean;
  readonly speed: PresentationSpeed;
  readonly chapters: readonly PresentationGap[];
  readonly pressureSummaries: readonly PresentationPressureSummary[];
}

export interface StoryProgramResolver {
  resolve(moment: StoryMoment): SceneRuntimeProgram;
}

export interface StoryDirectorOptions {
  readonly clock: PresentationClock;
  readonly identity: FrameIdentity;
  readonly model: PresentedWorldModel;
  readonly settlement: SceneSettlementCoordinator;
  readonly programResolver?: StoryProgramResolver;
  readonly maxPendingMoments?: number;
  /** Session-owned recovery must acquire cancellation before the active scene settles. */
  readonly pressureCancellationOwner?: "director" | "recovery-coordinator";
  /**
   * Called once per moment the overlay lane clears without a stage lease.
   *
   * The choreography lane reports a finished moment through the settlement
   * coordinator's `onSettlementComplete`; the overlay lane has no settlement, so
   * this is the equivalent seam. A session uses it to keep the chronicle — and
   * therefore the event feed — lossless: a beat that never occupied a body is
   * still something that happened.
   */
  readonly onUtteranceMoment?: (moment: StoryMoment) => void;
  /**
   * Called once per moment that could not be resolved into a scene.
   *
   * A resolver failure used to THROW out of `startNextIfIdle`, straight into
   * `PresentationIngress`'s deliberate isolation catch — measured: six of eight
   * recorded runs are unparseable by the current renderer and every one of them
   * presented 0 of ~544 moments while the frame still read "live". A silent zero
   * is the worst failure mode a live view has, so an unpresentable moment is now
   * dropped deliberately and reported here.
   */
  readonly onUnpresentableMoment?: (moment: StoryMoment, error: unknown) => void;
  /**
   * Decides whether a directed line brings two beings together first.
   *
   * Optional, and absent everywhere spatial truth is: without it the overlay
   * lane behaves exactly as it did before staging existed — every utterance is
   * raised the instant it is drained and nobody moves. See
   * `conversationStaging.ts`.
   */
  readonly conversationStaging?: ConversationStaging;
}

const DEFAULT_MAX_PENDING = 48;
const MIN_PENDING = 32;
const MAX_RETAINED_SUMMARIES = 32;
const MAX_RETAINED_CHAPTERS = 32;
const MAX_RETAINED_MAJOR_IDS = 32;
const KNOWN_EVENT_TYPES = new Set<string>(EVENT_VISUAL_EVENT_TYPES);
const COLLABORATOR_RETRY_BASE_MS = 100;
const COLLABORATOR_RETRY_MAX_MS = 1_000;
const CHECKPOINT_CORRECTION_HOLD_MS = 800;
const MAX_OWNED_CHECKPOINTS = 64;
const MAX_CHECKPOINT_FOCUS_TARGETS = 3;
/**
 * How many overlay beats a frame carries.
 *
 * The window exists because publication is deduplicated and a frame may be
 * republished; a one-shot delivery could be lost. It is bounded because a
 * backlog draining at once can clear dozens of utterances in a single ingest,
 * and a frame is not an archive. Consumers dedupe on `momentId` + `cursor`, so
 * the only cost of the window is its size.
 */
const MAX_FRAME_UTTERANCES = 24;
/**
 * How much overlay-lane evidence may wait behind one unsettled scene.
 *
 * Deep enough to hold a long scene's worth of a fast run's chatter (a 14-second
 * scene against the measured ~1.7 events/second is ~24), with an order of
 * magnitude of headroom, and bounded so that a stage stuck for any reason
 * cannot turn the lane into an unbounded buffer.
 */
const MAX_DEFERRED_UTTERANCE_EVIDENCE = 256;
/**
 * How many conversational staging beats a frame carries.
 *
 * The window exists for exactly the reason the utterance window does — a frame
 * may be republished and a one-shot delivery could be lost — and is smaller
 * because a staging beat is rarer than a bubble: only a directed line to a
 * co-located being that is not already standing there produces one, and each
 * produces at most three.
 */
const MAX_FRAME_STAGING = 12;
/** The decision a line gets when staging could not make one: raise it, move nobody. */
const UNSTAGED: ConversationStagingDecision = Object.freeze({
  beats: Object.freeze([]),
  outcome: "unplaced",
});

type CheckpointFocusSeed = Omit<
  CheckpointFocusTarget,
  "segmentIndex" | "segmentCount"
>;

interface ActiveCheckpointHold {
  readonly line: number;
  readonly eventCursor: number;
  readonly worldTime: number;
  readonly correctionEntityIds: readonly string[];
  readonly focusTargets: readonly CheckpointFocusSeed[];
  readonly durationMs: number;
  elapsedMs: number;
}

/** Owns the single causal presentation clock and its bounded story queue. */
export class StoryDirector {
  private readonly clock: PresentationClock;
  private readonly listeners = new Set<() => void>();
  private readonly maxPendingMoments: number;
  private readonly pressureCancellationOwner: "director" | "recovery-coordinator";
  private identity: FrameIdentity;
  private model: PresentedWorldModel;
  private settlement: SceneSettlementCoordinator;
  private readonly programResolver: StoryProgramResolver;
  private unsubscribeSettlement: (() => void) | null = null;
  private cancelClock: (() => void) | null = null;
  private ingestedCursor: number;
  private presentedCursor: number;
  private activeMoment: StoryMoment | null = null;
  private activeProgram: SceneRuntimeProgram | null = null;
  private pending: StoryMoment[] = [];
  private chapters: PresentationGap[] = [];
  private pressureSummaries: PresentationPressureSummary[] = [];
  private pendingCheckpoints: ClassifiedCheckpointRecord[] = [];
  private lastAcceptedSafeCheckpointLine = 0;
  private lastAcceptedSafeCheckpointCursor: number | null = null;
  private lastAcceptedSafeCheckpointWorldTime: number | null = null;
  private checkpointCompactionCount = 0;
  private newestCompactedCheckpointDigest: string | null = null;
  private checkpointOverflow: CheckpointOverflowDiagnostics | null = null;
  private checkpointHold: ActiveCheckpointHold | null = null;
  private recoveryRequired = false;
  /** Retryable ingress/checkpoint faults absorbed since construction (observer-only). */
  private retryableIngressFaultCount = 0;
  /** The newest absorbed retryable fault, so "absorbed" never reads as "unnoticed". */
  private lastRetryableIngressFault: Readonly<{ kind: string; line: number | null }> | null = null;
  private paused = false;
  private held = false;
  private speed: PresentationSpeed = 1;
  private sceneElapsedMs = 0;
  private lastWallMs: number;
  private sceneGeneration = 0;
  private disposed = false;
  private pausedSnapshot: StoryDirectorSnapshot | null = null;
  private collaboratorRetryAttempt = 0;
  private readonly onUtteranceMoment: ((moment: StoryMoment) => void) | null;
  private readonly onUnpresentableMoment:
    ((moment: StoryMoment, error: unknown) => void) | null;
  private unpresentableMomentCount = 0;
  private readonly conversationStaging: ConversationStaging | null;
  private utterances: readonly PresentedUtterance[] = Object.freeze([]);
  private staging: readonly PresentedStagingBeat[] = Object.freeze([]);
  /**
  /**
   * The high-water mark of moments taken off the queue and finished.
   *
   * With one lane this was the same number as `presentedCursor`. With two it is
   * not: the overlay lane may clear moments that sit *after* a scene still
   * holding the stage, so what has been consumed can run ahead of what has been
   * presented in order. `presentedCursor` remains the honest watermark —
   * everything at or below it is done — and is derived from this and the active
   * moment, never assigned out of order.
   */
  private doneThroughCursor: number;
  /**
   * Overlay-lane evidence waiting for the stage to settle before it is applied.
   *
   * `PresentedWorldModel.applyEvidence` requires strictly contiguous cursors,
   * and rightly so — it is projecting a world forward, not merging a set. The
   * overlay lane therefore raises its words immediately (a bubble needs no world
   * truth) but holds its evidence until the scene ahead of it commits, and the
   * held entries are flushed in cursor order the instant that happens. The
   * viewer sees the words on time; the world model still only ever moves
   * forward, one cursor at a time.
   */
  private deferredEvidence: EventEnvelopeEntry[] = [];

  constructor(options: StoryDirectorOptions) {
    assertValidFrameIdentity(options.identity);
    const maxPending = options.maxPendingMoments ?? DEFAULT_MAX_PENDING;
    if (!Number.isSafeInteger(maxPending) || maxPending < MIN_PENDING || maxPending > DEFAULT_MAX_PENDING) {
      throw new RangeError("maxPendingMoments must be a safe integer from 32 through 48");
    }
    this.clock = options.clock;
    this.identity = freezeIdentity(options.identity);
    this.model = options.model;
    this.settlement = options.settlement;
    this.pressureCancellationOwner = options.pressureCancellationOwner ?? "director";
    this.onUtteranceMoment = options.onUtteranceMoment ?? null;
    this.onUnpresentableMoment = options.onUnpresentableMoment ?? null;
    this.conversationStaging = options.conversationStaging ?? null;
    this.programResolver = options.programResolver ?? Object.freeze({
      resolve: (moment: StoryMoment) => buildStoryProgram(moment, 1),
    });
    if (!this.settlement.ownsModel(this.model)) {
      throw new Error("settlement coordinator must own the director model");
    }
    this.maxPendingMoments = maxPending;
    this.ingestedCursor = options.identity.lastCursor;
    this.presentedCursor = options.identity.lastCursor;
    this.doneThroughCursor = options.identity.lastCursor;
    this.lastWallMs = this.clock.now();
    this.bindSettlement();
  }

  ingest(moments: readonly StoryMoment[]): void {
    if (this.disposed || moments.length === 0) return;
    const accepted = this.preflightMoments(moments);
    if (accepted.length === 0) return;
    this.pending.push(...accepted);
    this.ingestedCursor = accepted.at(-1)!.lastCursor;
    // The overlay lane runs BEFORE the pressure policy, not after: 93% of a real
    // run is display-only, so a queue measured with utterances still in it is a
    // queue measuring the wrong thing — and dropping a thought to make room for
    // a thought was the mechanism behind six jump-cuts in 222 seconds.
    if (!this.paused && !this.held) this.drainUtterances();
    this.applyPressurePolicy();
    if (!this.paused) this.startNextIfIdle();
    this.emit();
  }

  /** Observer-only bounded ownership counts, including work hidden by a paused view. */
  diagnostics(): Readonly<{
    pendingMoments: number;
    pendingCheckpoints: number;
    ownedCheckpoints: number;
    checkpointQueueLimit: number;
    checkpointCompaction: CheckpointCompactionDiagnostics | null;
    checkpointOverflow: CheckpointOverflowDiagnostics | null;
    retainedChapters: number;
    retainedPressureSummaries: number;
    activeSceneCount: 0 | 1;
    /** Moments dropped because no scene could be resolved for them. */
    unpresentableMoments: number;
    /**
     * Whether both lanes are currently halted awaiting a recovery.
     *
     * Published because this latch, when it stuck, silenced 93% of a live run with no
     * visible signal anywhere — the run simply went quiet. A latch a probe cannot read
     * is a latch nobody can debug.
     */
    recoveryRequired: boolean;
    /** Retryable ingress/checkpoint faults absorbed without demanding a recovery. */
    retryableIngressFaults: number;
    /**
     * Utterance evidence cleared from the queue but not yet contiguous enough to commit.
     *
     * Published because reaching `MAX_DEFERRED_UTTERANCE_EVIDENCE` stops the overlay lane just
     * as hard as `recoveryRequired` does, and with just as little to see from outside.
     */
    deferredUtteranceEvidence: number;
    /** The newest absorbed retryable fault, verbatim, or `null` if there has been none. */
    lastRetryableIngressFault: Readonly<{ kind: string; line: number | null }> | null;
  }> {
    return Object.freeze({
      pendingMoments: this.pending.length,
      unpresentableMoments: this.unpresentableMomentCount,
      recoveryRequired: this.recoveryRequired,
      retryableIngressFaults: this.retryableIngressFaultCount,
      deferredUtteranceEvidence: this.deferredEvidence.length,
      lastRetryableIngressFault: this.lastRetryableIngressFault,
      pendingCheckpoints: this.pendingCheckpoints.length,
      ownedCheckpoints: this.pendingCheckpoints.length + Number(this.checkpointHold !== null),
      checkpointQueueLimit: MAX_OWNED_CHECKPOINTS,
      checkpointCompaction: this.newestCompactedCheckpointDigest === null
        ? null
        : Object.freeze({
            count: this.checkpointCompactionCount,
            newestCompactedDigest: this.newestCompactedCheckpointDigest,
          }),
      checkpointOverflow: this.checkpointOverflow === null
        ? null
        : Object.freeze({ ...this.checkpointOverflow }),
      retainedChapters: this.chapters.length,
      retainedPressureSummaries: this.pressureSummaries.length,
      activeSceneCount: this.activeMoment === null ? 0 : 1,
    });
  }

  /** Internal recovery evidence that continues advancing behind a frozen paused view. */
  pressureState(): Readonly<{
    pending: readonly StoryMoment[];
    pressureSummaries: readonly PresentationPressureSummary[];
  }> {
    return Object.freeze({
      pending: Object.freeze([...this.pending]),
      pressureSummaries: Object.freeze([...this.pressureSummaries]),
    });
  }

  acceptCheckpoint(record: ClassifiedCheckpointRecord): CheckpointAcceptanceDisposition {
    if (this.disposed) return "ignored";
    if (record.safety !== "safe-world-tick") return "ignored";
    if (
      !Number.isSafeInteger(record.line)
      || record.line <= this.lastAcceptedSafeCheckpointLine
      || (
        this.lastAcceptedSafeCheckpointCursor !== null
        && record.checkpoint.event_cursor < this.lastAcceptedSafeCheckpointCursor
      )
      || (
        this.lastAcceptedSafeCheckpointWorldTime !== null
        && record.checkpoint.world_time < this.lastAcceptedSafeCheckpointWorldTime
      )
    ) return "ignored";
    if (this.paused) {
      const compacted = this.pendingCheckpoints.length > 0;
      if (compacted) this.retainCheckpointCompaction(this.pendingCheckpoints);
      this.pendingCheckpoints = [record];
      this.acceptCheckpointIdentity(record);
      return compacted ? "compacted" : "accepted";
    }
    const ownedCount = this.pendingCheckpoints.length + Number(this.checkpointHold !== null);
    if (ownedCount >= MAX_OWNED_CHECKPOINTS) {
      this.checkpointOverflow = Object.freeze({
        line: record.line,
        digest: checkpointDigest(record),
      });
      this.recoveryRequired = true;
      this.emit();
      return "overflow";
    }
    this.pendingCheckpoints.push(record);
    this.acceptCheckpointIdentity(record);
    if (!this.paused) {
      if (this.reconcileCheckpointIfSafe()) this.emit();
    }
    return "accepted";
  }

  /**
   * Records one ingress or checkpoint fault, and decides whether it invalidates the story.
   *
   * **Retryable faults are recorded and nothing else.** A `{ kind: "unavailable",
   * retryable: true }` checkpoint-poll failure means one poll did not answer; the feed
   * reschedules itself (`CheckpointFeed.poll`'s `finally`), and a checkpoint is a
   * *correction* to a stream that is still arriving intact over SSE — losing one does not
   * make the presented world wrong. Demanding a recovery for it was measured, on the
   * recorded run through the production observer, to silence the world permanently:
   * `recoveryRequired` gates {@link drainUtterances}, so the non-blocking overlay lane
   * died, the queue then overflowed every ~40s, `applyPressurePolicy` discarded ~30
   * `speak`s per cycle, and the `queue-overflow` recovery it provoked reset the feed —
   * which re-polled, re-faulted and re-armed the latch. Utterances are 93% of a run, so
   * the whole world stopped speaking and the killfeed drained to `0 shown · 0 held`.
   *
   * A NON-retryable fault (`cursor-gap`, `run-mismatch`, a 413-oversized record) still
   * means evidence is genuinely missing or mis-identified, and still requires recovery.
   *
   * Side effects: retains a chapter for a cursor gap, may request a safe scene
   * cancellation, and may latch `recoveryRequired`. Always emits.
   */
  acceptIngressFault(fault: PresentationIngressFault | CheckpointFeedFault): void {
    if (this.disposed) return;
    if ("retryable" in fault && fault.retryable) {
      this.retryableIngressFaultCount = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.retryableIngressFaultCount + 1,
      );
      this.lastRetryableIngressFault = Object.freeze({ kind: fault.kind, line: fault.line });
      this.emit();
      return;
    }
    if (fault.kind === "cursor-gap" || fault.kind === "run-mismatch") {
      if ("firstMissingCursor" in fault) {
        this.retainChapter(Object.freeze({
          firstCursor: fault.firstMissingCursor,
          lastCursor: fault.lastMissingCursor,
          chapter: "world-moved-ahead" as const,
          archiveAvailable: true,
        }));
      }
    }
    if (this.activeMoment !== null) this.requestSafeCancelWithRetry(`ingress:${fault.kind}`);
    this.recoveryRequired = true;
    this.emit();
  }

  setPaused(paused: boolean): void {
    if (this.disposed || this.paused === paused) return;
    if (paused) {
      this.advanceForControlChange();
      this.compactPendingCheckpointsForPause();
      this.paused = true;
      this.cancelScheduledClock();
      this.pausedSnapshot = this.makeSnapshot();
      this.emit();
      return;
    }
    this.paused = false;
    this.pausedSnapshot = null;
    this.lastWallMs = this.clock.now();
    this.reconcileCheckpointIfSafe();
    this.startNextIfIdle();
    this.scheduleNext();
    this.emit();
  }

  setSpeed(speed: PresentationSpeed): void {
    if (this.disposed || this.speed === speed) return;
    if (![0.5, 1, 1.5, 2].includes(speed)) throw new RangeError("unsupported presentation speed");
    if (!this.paused && !this.held) this.advanceForControlChange();
    this.speed = speed;
    this.lastWallMs = this.clock.now();
    this.scheduleNext();
    this.emit();
  }

  holdCurrentMoment(hold: boolean): void {
    if (this.disposed || this.held === hold) return;
    if (hold && this.activeMoment === null) return;
    if (hold && !this.paused) this.advanceForControlChange();
    this.held = hold;
    this.lastWallMs = this.clock.now();
    if (hold) this.cancelScheduledClock();
    else {
      this.startNextIfIdle();
      this.scheduleNext();
    }
    this.emit();
  }

  resumeAfterAbsence(_choice: "continue-from-summary" | "snap-to-live"): void {
    this.setPaused(false);
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): StoryDirectorSnapshot {
    return this.pausedSnapshot ?? this.makeSnapshot();
  }

  reset(
    identity: FrameIdentity,
    model: PresentedWorldModel,
    settlement: SceneSettlementCoordinator,
  ): void {
    if (this.disposed) return;
    assertValidFrameIdentity(identity);
    if (
      identity.runId === this.identity.runId
      && identity.sourceKey === this.identity.sourceKey
      && identity.revision <= this.identity.revision
    ) throw new Error("reset identity is stale for the active run and source");
    if (!settlement.ownsModel(model)) {
      throw new Error("settlement coordinator must own the reset model");
    }
    if (this.activeMoment !== null && settlement === this.settlement) {
      throw new Error("active reset requires a fresh settlement coordinator");
    }

    this.cancelScheduledClock();
    this.unsubscribeSettlement?.();
    if (settlement !== this.settlement) this.settlement.dispose();
    this.identity = freezeIdentity(identity);
    this.model = model;
    this.settlement = settlement;
    this.ingestedCursor = identity.lastCursor;
    this.presentedCursor = identity.lastCursor;
    this.doneThroughCursor = identity.lastCursor;
    this.utterances = Object.freeze([]);
    this.discardStagedConversation();
    this.deferredEvidence = [];
    this.activeMoment = null;
    this.activeProgram = null;
    this.pending = [];
    this.chapters = [];
    this.pressureSummaries = [];
    this.pendingCheckpoints = [];
    this.lastAcceptedSafeCheckpointLine = 0;
    this.lastAcceptedSafeCheckpointCursor = null;
    this.lastAcceptedSafeCheckpointWorldTime = null;
    this.checkpointCompactionCount = 0;
    this.newestCompactedCheckpointDigest = null;
    this.checkpointOverflow = null;
    this.checkpointHold = null;
    this.recoveryRequired = false;
    this.paused = false;
    this.held = false;
    this.sceneElapsedMs = 0;
    this.collaboratorRetryAttempt = 0;
    this.lastWallMs = this.clock.now();
    this.pausedSnapshot = null;
    this.sceneGeneration += 1;
    this.bindSettlement();
    this.emit();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelScheduledClock();
    this.pendingCheckpoints = [];
    this.checkpointCompactionCount = 0;
    this.newestCompactedCheckpointDigest = null;
    this.checkpointOverflow = null;
    this.checkpointHold = null;
    this.pausedSnapshot = null;
    this.unsubscribeSettlement?.();
    this.unsubscribeSettlement = null;
    this.settlement.dispose();
    this.listeners.clear();
  }

  private preflightMoments(moments: readonly StoryMoment[]): readonly StoryMoment[] {
    let nextCursor = this.ingestedCursor;
    const knownIds = new Set([
      ...(this.activeMoment === null ? [] : [this.activeMoment.id]),
      ...this.pending.map((moment) => moment.id),
    ]);
    const accepted: StoryMoment[] = [];
    for (const moment of moments) {
      validateMoment(moment);
      if (moment.lastCursor <= nextCursor) {
        if (knownIds.has(moment.id)) continue;
        throw new RangeError(`story moment ${moment.id} is stale at cursor ${moment.lastCursor}`);
      }
      if (moment.firstCursor !== nextCursor + 1) {
        throw new RangeError(`expected next story cursor ${nextCursor + 1}, received ${moment.firstCursor}`);
      }
      accepted.push(moment);
      knownIds.add(moment.id);
      nextCursor = moment.lastCursor;
    }
    return accepted;
  }

  private applyPressurePolicy(): void {
    if (this.pending.length <= this.maxPendingMoments) return;
    const removeCount = this.pending.length - this.maxPendingMoments;
    const skipped = this.pending.splice(0, removeCount);
    if (skipped.length === 0) return;
    const majorMoments = skipped.filter((moment) => (
      moment.priority !== "ambient"
      && isPresentedEventType(moment.representative.event.type)
    ));
    const majorMomentIds = majorMoments
      .map((moment) => moment.id)
      .slice(-MAX_RETAINED_MAJOR_IDS);
    const majorDigest = digestMajorMoments(skipped);
    const summary: PresentationPressureSummary = Object.freeze({
      firstCursor: skipped[0].firstCursor,
      lastCursor: skipped.at(-1)!.lastCursor,
      ambientCount: skipped.length - majorMoments.length,
      majorMomentIds: Object.freeze(majorMomentIds),
      majorDigest,
      archiveAvailable: true,
    });
    this.retainPressureSummary(summary);
    this.recoveryRequired = true;
    this.retainChapter(Object.freeze({
      firstCursor: summary.firstCursor,
      lastCursor: summary.lastCursor,
      chapter: this.paused ? "while-away" : "world-moved-ahead",
      archiveAvailable: true,
    }));
    if (
      this.pressureCancellationOwner === "director"
      && this.activeMoment !== null
    ) this.requestSafeCancelWithRetry("presentation-pressure");
  }

  /**
   * Clears every display-only moment at the head of the queue, without a lease.
   *
   * This is the whole of the two-lane split on the queue side. An utterance
   * commits its evidence to the world model, raises its overlay, advances the
   * presented cursor and is gone — in the same tick, with no scene, no
   * settlement handshake and no time on the stage. Draining is a LOOP because
   * 93% of a real run is utterances: a backlog is usually a run of them, and
   * clearing one per stage-idle would only have made the lease cheaper rather
   * than removing it.
   *
   * Cursor contiguity is preserved exactly: the queue is consumed in order, so
   * `presentedCursor` still advances one contiguous moment at a time.
   *
   * Side effects: applies evidence to the world model, replaces the overlay
   * window, advances `presentedCursor`, and calls `onUtteranceMoment` per
   * moment so the session can keep the chronicle lossless.
   */
  private drainUtterances(): boolean {
    // A halted director is about to have its cursor snapped forward by recovery;
    // clearing beats it is about to skip would publish words for a world the
    // viewer is leaving.
    if (this.disposed || this.paused || this.held || this.recoveryRequired) return false;
    if (this.deferredEvidence.length >= MAX_DEFERRED_UTTERANCE_EVIDENCE) return false;
    const raised: PresentedUtterance[] = [];
    const regionOf = (beingId: string): string | null => {
      const agent = this.model.getView().agents
        .find((record) => record.value.id === beingId);
      return agent?.value.position ?? null;
    };
    // The WHOLE queue, not just its head. A physical act waiting for the stage
    // must not hold back the words behind it: that is precisely the queue the
    // single-lane director overflowed, and the reason 319 moments were dropped
    // in 222 seconds. Removal preserves the order of everything left.
    const cleared: StoryMoment[] = [];
    this.pending = this.pending.filter((moment) => {
      if (cleared.length + this.deferredEvidence.length >= MAX_DEFERRED_UTTERANCE_EVIDENCE) return true;
      if (!isUtteranceMoment(moment)) return true;
      cleared.push(moment);
      return false;
    });
    if (cleared.length === 0) return false;
    for (const moment of cleared) {
      this.deferredEvidence.push(...moment.evidence);
      raised.push(...utterancesFor(moment, regionOf));
      this.doneThroughCursor = Math.max(this.doneThroughCursor, moment.lastCursor);
      try {
        this.onUtteranceMoment?.(moment);
      } catch {
        // The chronicle losing one beat must not stop the world advancing.
      }
    }
    this.flushDeferredEvidence();
    this.refreshPresentedCursor();
    if (raised.length > 0) this.raiseUtterances(raised);
    return true;
  }

  /**
   * Raises drained words, bringing two beings together in the same instant.
   *
   * Nothing here is deferred. A same-region directed line flashes its addressee
   * to conversational distance (`conversationStaging.ts`) and the words are
   * published in the very same pass, so the bubble, the evidence, the cursor and
   * the Chronicle entry all land together. The word-delay queue this method used
   * to feed — a monotone release schedule timed against the addressee's walk —
   * was deleted with the walk itself rather than left configured to zero.
   *
   * Side effects: publishes staging beats and appends to the overlay window.
   */
  private raiseUtterances(raised: readonly PresentedUtterance[]): void {
    const staging = this.conversationStaging;
    if (staging !== null) {
      const nowMs = this.clock.now();
      const busyBeingIds = this.occupiedBodies();
      const beats: PresentedStagingBeat[] = [];
      for (const utterance of raised) {
        // A staging decision reads live spatial truth, and spatial truth can be
        // mid-replacement (a recovery swapping the placement generation, a seam
        // with no getters at all). An exception here would leave `drainUtterances`
        // through `ingest` into `PresentationIngress`'s isolation catch — the
        // exact silent-lane death the BUBBLES-FIX comment below documents, where
        // 93% of a run stops appearing and the frame still reads "live". Words
        // must never cost more than the step they were going to be staged with.
        let decided: ConversationStagingDecision;
        try {
          decided = staging.stage({ utterance, busyBeingIds, nowMs });
        } catch {
          decided = UNSTAGED;
        }
        beats.push(...decided.beats);
      }
      if (beats.length > 0) this.publishStaging(beats);
    }
    this.utterances = Object.freeze(
      [...this.utterances, ...raised].slice(-MAX_FRAME_UTTERANCES),
    );
  }

  /**
   * Bodies the active scene owns, and therefore bodies staging must not touch.
   *
   * Every actor named anywhere in the active program — not merely in the phase
   * currently on screen — because a scene that will move a being in its recover
   * phase owns that being now.
   */
  private occupiedBodies(): ReadonlySet<string> {
    const occupied = new Set<string>();
    if (this.activeProgram === null) return occupied;
    for (const phase of this.activeProgram.phases) {
      for (const intent of phase.actorIntents) occupied.add(intent.actorId);
    }
    return occupied;
  }

  /** Appends to the bounded staging window and notifies observers. */
  private publishStaging(beats: readonly PresentedStagingBeat[]): void {
    this.staging = Object.freeze(
      [...this.staging, ...beats].slice(-MAX_FRAME_STAGING),
    );
  }

  /** Forgets the staging lane's state, for a run this director no longer presents. */
  private discardStagedConversation(): void {
    this.staging = Object.freeze([]);
    this.conversationStaging?.reset();
  }

  /**
   * Re-derives the honest watermark: everything at or below it is presented.
   *
   * While a scene holds the stage that is the cursor immediately before it —
   * exactly what the single-lane director reported — because the queue is
   * consumed in order and nothing before the active moment is outstanding. When
   * no scene is active it is everything consumed, overlay lane included. The
   * value is therefore monotone even though the overlay lane can consume
   * moments that sit after a scene which has not settled.
   */
  /**
   * Commits as much held overlay evidence as the world model will contiguously take.
   *
   * `PresentedWorldModel.applyEvidence` projects a world forward one cursor at a
   * time and rejects a gap, which is right. The overlay lane can clear beats
   * that sit after a scene still holding the stage, so what it holds is only
   * ever *eventually* contiguous: this applies the longest run that continues
   * from where the model actually is, and leaves the rest for the moment the
   * scene between them settles.
   */
  private flushDeferredEvidence(): void {
    if (this.deferredEvidence.length === 0) return;
    this.deferredEvidence.sort((left, right) => left.cursor - right.cursor);
    let next = this.model.getView().projectedThroughCursor + 1;
    let count = 0;
    while (count < this.deferredEvidence.length && this.deferredEvidence[count]!.cursor === next) {
      count += 1;
      next += 1;
    }
    if (count === 0) return;
    const ready = this.deferredEvidence.slice(0, count);
    this.deferredEvidence = this.deferredEvidence.slice(count);
    this.model.applyEvidence(ready);
  }

  private refreshPresentedCursor(): void {
    const outstanding = this.activeMoment ?? this.pending[0] ?? null;
    this.presentedCursor = outstanding === null
      ? this.doneThroughCursor
      : Math.min(this.doneThroughCursor, outstanding.firstCursor - 1);
  }

  private startNextIfIdle(): void {
    if (
      this.disposed
      || this.paused
      || this.held
      || this.recoveryRequired
      || this.activeMoment !== null
      || this.checkpointHold !== null
    ) return;
    this.drainUtterances();
    const next = this.pending[0];
    if (next === undefined) {
      this.reconcileCheckpointIfSafe();
      return;
    }
    let program: SceneRuntimeProgram;
    try {
      const resolved = this.programResolver.resolve(next);
      if (resolved === null || typeof resolved !== "object") {
        throw new Error("story program resolver must return a runtime program");
      }
      program = resolved;
    } catch (error) {
      // Drop it and say so. Rethrowing here reaches only an isolation catch, which
      // leaves the moment at the head of the queue forever: the queue fills, every
      // later moment is pressure-dropped, and the frame keeps reading "live".
      this.pending.shift();
      this.doneThroughCursor = Math.max(this.doneThroughCursor, next.lastCursor);
      this.unpresentableMomentCount = Math.min(
        Number.MAX_SAFE_INTEGER,
        this.unpresentableMomentCount + 1,
      );
      this.refreshPresentedCursor();
      try {
        this.onUnpresentableMoment?.(next, error);
      } catch {
        // Fault observers are isolated from the director's own queue ownership.
      }
      this.startNextIfIdle();
      return;
    }
    this.pending.shift();
    this.activeMoment = next;
    this.activeProgram = program;
    this.sceneElapsedMs = 0;
    this.lastWallMs = this.clock.now();
    this.sceneGeneration += 1;
    this.collaboratorRetryAttempt = 0;
    const transactionGeneration = this.sceneGeneration;
    try {
      this.settlement.begin({ moment: next, program }, this.identity);
    } catch (error) {
      if (
        this.sceneGeneration === transactionGeneration
        && this.activeMoment === next
      ) {
        this.pending.unshift(next);
        this.activeMoment = null;
        this.activeProgram = null;
        this.sceneElapsedMs = 0;
        this.sceneGeneration += 1;
      }
      throw error;
    }
    if (
      this.sceneGeneration === transactionGeneration
      && this.activeMoment === next
    ) this.scheduleNext();
  }

  private bindSettlement(): void {
    this.unsubscribeSettlement = this.settlement.subscribe(() => {
      const settled = this.settlement.getSnapshot();
      if (
        this.activeMoment === null
        || settled.momentId !== this.activeMoment.id
        || !settled.consequenceCommitted
        || settled.publishedRevision === null
        || !settled.safeBoundaryAcknowledged
        || !settled.sceneSettled
      ) return;
      const completed = this.activeMoment;
      this.doneThroughCursor = Math.max(this.doneThroughCursor, completed.lastCursor);
      this.activeMoment = null;
      // The settled scene has just moved the model to its own last cursor, which
      // is where held overlay evidence continues from.
      this.flushDeferredEvidence();
      this.refreshPresentedCursor();
      this.activeProgram = null;
      this.sceneElapsedMs = 0;
      this.sceneGeneration += 1;
      this.reconcileCheckpointIfSafe();
      this.startNextIfIdle();
      this.emit();
    });
  }

  private scheduleNext(): void {
    this.cancelScheduledClock();
    if (this.disposed || this.paused || this.held) return;
    if (this.checkpointHold !== null) {
      const remainingMs = checkpointSegmentRemainingMs(this.checkpointHold);
      const generation = this.sceneGeneration;
      this.lastWallMs = this.clock.now();
      const wallDeadline = representableWallDeadline(this.lastWallMs, remainingMs);
      this.cancelClock = this.clock.schedule(wallDeadline, () => this.tick(generation));
      return;
    }
    if (this.activeMoment === null || this.activeProgram === null) return;
    const targets = [
      ...this.activeProgram.phaseWindows
        .map((window) => window.endMs)
        .filter((deadline) => deadline > this.sceneElapsedMs),
    ];
    const runtimeDeadline = this.settlement.nextDeadlineMs();
    if (runtimeDeadline !== null) targets.push(Math.max(this.sceneElapsedMs, runtimeDeadline));
    if (targets.length === 0) return;
    const causalDeadline = Math.min(...targets);
    const currentPhase = phaseAt(this.activeProgram, this.sceneElapsedMs);
    const rate = playbackRate(currentPhase, this.speed);
    const wallDelay = Math.max(0, (causalDeadline - this.sceneElapsedMs) / rate);
    const generation = this.sceneGeneration;
    this.lastWallMs = this.clock.now();
    const wallDeadline = representableWallDeadline(this.lastWallMs, wallDelay);
    this.cancelClock = this.clock.schedule(wallDeadline, () => this.tick(generation));
  }

  private tick(generation: number): void {
    this.cancelClock = null;
    if (this.disposed || this.paused || this.held || generation !== this.sceneGeneration) return;
    try {
      this.advanceToWallNow();
      this.collaboratorRetryAttempt = 0;
    } catch (error) {
      this.scheduleCollaboratorRetry(generation);
      if (error instanceof ScenePublicationPending) return;
      throw error;
    }
    if (generation !== this.sceneGeneration) {
      this.emit();
      return;
    }
    this.scheduleNext();
    this.emit();
  }

  private advanceForControlChange(): void {
    try {
      this.advanceToWallNow();
    } catch (error) {
      if (!(error instanceof ScenePublicationPending)) throw error;
      this.scheduleCollaboratorRetry(this.sceneGeneration);
    }
  }

  private advanceToWallNow(): void {
    if (this.checkpointHold !== null && !this.paused && !this.held) {
      const now = this.clock.now();
      const elapsedWallMs = Math.max(0, now - this.lastWallMs);
      const readableWallMs = Math.min(
        elapsedWallMs,
        checkpointSegmentRemainingMs(this.checkpointHold),
      );
      this.checkpointHold.elapsedMs = Math.min(
        this.checkpointHold.durationMs,
        this.checkpointHold.elapsedMs + readableWallMs,
      );
      this.lastWallMs = now;
      if (this.checkpointHold.elapsedMs >= this.checkpointHold.durationMs) {
        this.checkpointHold = null;
        this.reconcileCheckpointIfSafe();
        this.startNextIfIdle();
      }
      return;
    }
    if (this.activeMoment === null || this.activeProgram === null || this.paused || this.held) {
      this.lastWallMs = this.clock.now();
      return;
    }
    const now = this.clock.now();
    let remainingWallMs = Math.max(0, now - this.lastWallMs);
    while (remainingWallMs > 0 && this.sceneElapsedMs < this.activeProgram.durationMs) {
      const window = phaseWindowAt(this.activeProgram, this.sceneElapsedMs);
      const rate = playbackRate(window.phase, this.speed);
      const causalRemaining = window.endMs - this.sceneElapsedMs;
      const wallToBoundary = causalRemaining / rate;
      if (remainingWallMs < wallToBoundary) {
        this.sceneElapsedMs += remainingWallMs * rate;
        remainingWallMs = 0;
      } else {
        this.sceneElapsedMs = window.endMs;
        remainingWallMs -= wallToBoundary;
      }
    }
    this.lastWallMs = now;
    this.settlement.advance(this.sceneElapsedMs);
  }

  private reconcileCheckpointIfSafe(): boolean {
    let applied = false;
    while (true) {
      const checkpoint = this.pendingCheckpoints[0];
      if (
        checkpoint === undefined
        || this.paused
        || this.activeMoment !== null
        || this.checkpointHold !== null
        || checkpoint.checkpoint.event_cursor > this.presentedCursor
        || this.pending.some((moment) => moment.lastCursor <= checkpoint.checkpoint.event_cursor)
        || this.pending.some((moment) => moment.evidence.some(
          (entry) => entry.event.timestamp < checkpoint.checkpoint.world_time,
        ))
      ) return applied;
      const before = this.model.getView();
      const result = this.model.reconcile(checkpoint);
      if (!result.processed) return applied;
      this.pendingCheckpoints.shift();
      applied = applied || result.applied;
      if (result.applied && result.correctionEntityIds.length > 0) {
        const after = this.model.getView();
        const focusTargets = checkpointFocusTargets(
          before,
          after,
          result.correctionEntityIds,
        );
        this.checkpointHold = {
          line: checkpoint.line,
          eventCursor: checkpoint.checkpoint.event_cursor,
          worldTime: checkpoint.checkpoint.world_time,
          correctionEntityIds: Object.freeze([...result.correctionEntityIds]),
          focusTargets,
          elapsedMs: 0,
          durationMs: CHECKPOINT_CORRECTION_HOLD_MS * focusTargets.length,
        };
        this.lastWallMs = this.clock.now();
        this.sceneGeneration += 1;
        this.scheduleNext();
        return true;
      }
    }
  }

  private cancelScheduledClock(): void {
    this.cancelClock?.();
    this.cancelClock = null;
  }

  private acceptCheckpointIdentity(record: ClassifiedCheckpointRecord): void {
    this.lastAcceptedSafeCheckpointLine = record.line;
    this.lastAcceptedSafeCheckpointCursor = record.checkpoint.event_cursor;
    this.lastAcceptedSafeCheckpointWorldTime = record.checkpoint.world_time;
  }

  private compactPendingCheckpointsForPause(): void {
    if (this.pendingCheckpoints.length <= 1) return;
    const newest = this.pendingCheckpoints.at(-1)!;
    this.retainCheckpointCompaction(this.pendingCheckpoints.slice(0, -1));
    this.pendingCheckpoints = [newest];
  }

  private retainCheckpointCompaction(records: readonly ClassifiedCheckpointRecord[]): void {
    if (records.length === 0) return;
    this.checkpointCompactionCount = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.checkpointCompactionCount + records.length,
    );
    this.newestCompactedCheckpointDigest = checkpointDigest(records.at(-1)!);
  }

  private retainChapter(chapter: PresentationGap): void {
    this.chapters = retainNewest(
      [...this.chapters, chapter],
      MAX_RETAINED_CHAPTERS,
    );
  }

  private retainPressureSummary(summary: PresentationPressureSummary): void {
    const next = [...this.pressureSummaries, summary];
    if (next.length <= MAX_RETAINED_SUMMARIES) {
      this.pressureSummaries = next;
      return;
    }
    const aggregate = mergePressureSummaries(next[0], next[1]);
    this.pressureSummaries = [aggregate, ...next.slice(2)];
  }

  private requestSafeCancelWithRetry(reason: string): void {
    try {
      this.settlement.requestSafeCancel(reason);
    } catch (error) {
      this.scheduleCollaboratorRetry(this.sceneGeneration);
      throw error;
    }
  }

  private scheduleCollaboratorRetry(generation: number): void {
    if (this.disposed || this.cancelClock !== null || this.activeMoment === null) return;
    const boundedAttempt = Math.min(this.collaboratorRetryAttempt, 4);
    const delayMs = Math.min(
      COLLABORATOR_RETRY_BASE_MS * 2 ** boundedAttempt,
      COLLABORATOR_RETRY_MAX_MS,
    );
    this.collaboratorRetryAttempt = Math.min(boundedAttempt + 1, 4);
    this.cancelClock = this.clock.schedule(this.clock.now() + delayMs, () => {
      this.cancelClock = null;
      if (this.disposed || generation !== this.sceneGeneration || this.activeMoment === null) return;
      try {
        this.settlement.advance(this.sceneElapsedMs);
        this.collaboratorRetryAttempt = 0;
        if (generation !== this.sceneGeneration) return;
        this.scheduleNext();
        this.emit();
      } catch (error) {
        this.scheduleCollaboratorRetry(generation);
        if (error instanceof ScenePublicationPending) return;
        throw error;
      }
    });
  }

  private makeSnapshot(): StoryDirectorSnapshot {
    const pending = Object.freeze([...this.pending]);
    const backlogState: PresentationBacklog["state"] = this.paused
      ? "paused"
      : this.pressureSummaries.length > 0
        ? "overflow"
        : pending.length > 0 || this.activeMoment !== null
          ? "behind"
          : "caught-up";
    const backlog: PresentationBacklog = Object.freeze({
      pendingMoments: pending.length,
      firstPendingCursor: pending[0]?.firstCursor ?? null,
      lastPendingCursor: pending.at(-1)?.lastCursor ?? null,
      state: backlogState,
      label: backlogLabel(backlogState, pending.length),
    });
    const activeScene = this.activeProgram === null
      ? null
      : sceneAt(this.activeProgram, this.sceneElapsedMs);
    const settlementSnapshot = this.settlement.getSnapshot();
    const activeSceneToken = this.activeMoment !== null
      && settlementSnapshot.momentId === this.activeMoment.id
      ? settlementSnapshot.sceneToken
      : null;
    const checkpointHold = this.checkpointHold === null
      ? null
      : (() => {
          const previewElapsedMs = checkpointPreviewElapsedMs(
            this.checkpointHold!,
            this.clock.now(),
            this.lastWallMs,
            this.paused || this.held,
          );
          const segmentIndex = checkpointSegmentIndex(this.checkpointHold!, previewElapsedMs);
          const segmentElapsedMs = checkpointSegmentElapsedMs(
            this.checkpointHold!,
            previewElapsedMs,
          );
          const focusSeed = this.checkpointHold!.focusTargets[segmentIndex]!;
          return Object.freeze({
            line: this.checkpointHold.line,
            eventCursor: this.checkpointHold.eventCursor,
            worldTime: this.checkpointHold.worldTime,
            correctionEntityIds: this.checkpointHold.correctionEntityIds,
            elapsedMs: previewElapsedMs,
            durationMs: this.checkpointHold.durationMs,
            remainingMs: Math.max(
              0,
              this.checkpointHold.durationMs - previewElapsedMs,
            ),
            segmentElapsedMs,
            segmentDurationMs: CHECKPOINT_CORRECTION_HOLD_MS,
            segmentRemainingMs: CHECKPOINT_CORRECTION_HOLD_MS - segmentElapsedMs,
            focusTarget: Object.freeze({
              ...focusSeed,
              segmentIndex,
              segmentCount: this.checkpointHold.focusTargets.length,
            }),
          });
        })();
    return Object.freeze({
      identity: this.identity,
      ingestedCursor: this.ingestedCursor,
      presentedCursor: this.presentedCursor,
      activeMoment: this.activeMoment,
      phase: this.activeProgram === null ? null : phaseAt(this.activeProgram, this.sceneElapsedMs),
      activeProgramId: this.activeProgram?.id ?? null,
      activeScene,
      activeSceneToken,
      utterances: this.utterances,
      staging: this.staging,
      checkpointHold,
      pending,
      backlog,
      paused: this.paused,
      speed: this.speed,
      chapters: Object.freeze([...this.chapters]),
      pressureSummaries: Object.freeze([...this.pressureSummaries]),
    });
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A failed observer cannot prevent peers from seeing director state.
      }
    }
  }
}

function checkpointFocusTargets(
  before: PresentedWorldView,
  after: PresentedWorldView,
  correctionEntityIds: readonly string[],
): readonly CheckpointFocusSeed[] {
  const corrections = new Set(correctionEntityIds);
  const visible = [
    ...correctedStructuralTargets(after.homes, "home", corrections),
    ...correctedStructuralTargets(after.ruins, "ruin", corrections),
  ];
  const afterStructuralIds = new Set(
    [...after.homes, ...after.ruins]
      .map(({ value }) => value.home_id)
      .filter((value): value is string => typeof value === "string"),
  );
  const removedByRegion = new Map<string, Set<string>>();
  for (const { value } of [...before.homes, ...before.ruins]) {
    const homeId = value.home_id;
    const regionId = value.region;
    if (
      typeof homeId !== "string"
      || typeof regionId !== "string"
      || !corrections.has(homeId)
      || afterStructuralIds.has(homeId)
    ) continue;
    const regionRemovals = removedByRegion.get(regionId) ?? new Set<string>();
    regionRemovals.add(homeId);
    removedByRegion.set(regionId, regionRemovals);
  }
  const removals = [...removedByRegion]
    .filter(([, ids]) => ids.size > 0)
    .sort(([left], [right]) => compareText(left, right))
    .map(([regionId]): CheckpointFocusSeed => ({
      regionId,
      kind: "region",
      entityId: null,
      removed: true,
    }));
  const structural = [...visible, ...removals].slice(0, MAX_CHECKPOINT_FOCUS_TARGETS);
  if (structural.length > 0) {
    return Object.freeze(structural.map((target) => Object.freeze({ ...target })));
  }

  const regionId = defaultCheckpointFocusRegion(before, after, corrections);
  if (regionId === null) {
    throw new Error("checkpoint correction cannot be presented without a retained region");
  }
  return Object.freeze([Object.freeze({
    regionId,
    kind: "region" as const,
    entityId: null,
    removed: false,
  })]);
}

function correctedStructuralTargets(
  records: PresentedWorldView["homes"],
  kind: "home" | "ruin",
  corrections: ReadonlySet<string>,
): CheckpointFocusSeed[] {
  return records
    .flatMap(({ value }) => {
      const entityId = value.home_id;
      const regionId = value.region;
      return typeof entityId === "string"
        && typeof regionId === "string"
        && corrections.has(entityId)
        ? [{ regionId, kind, entityId, removed: false } satisfies CheckpointFocusSeed]
        : [];
    })
    .sort((left, right) => compareText(left.entityId ?? "", right.entityId ?? "")
      || compareText(left.regionId, right.regionId));
}

function defaultCheckpointFocusRegion(
  before: PresentedWorldView,
  after: PresentedWorldView,
  corrections: ReadonlySet<string>,
): string | null {
  const correctedRegion = [...after.regions]
    .map(({ value }) => value.name)
    .filter((value): value is string => typeof value === "string" && corrections.has(value))
    .sort(compareText)[0];
  if (correctedRegion !== undefined) return correctedRegion;

  for (const view of [after, before]) {
    const correctedAgentRegion = view.agents
      .filter(({ value }) => typeof value.id === "string" && corrections.has(value.id))
      .map(({ value }) => value.position)
      .filter((value): value is string => typeof value === "string")
      .sort(compareText)[0];
    if (correctedAgentRegion !== undefined) return correctedAgentRegion;
  }
  return [...after.regions, ...before.regions]
    .map(({ value }) => value.name)
    .filter((value): value is string => typeof value === "string")
    .sort(compareText)[0] ?? null;
}

function checkpointPreviewElapsedMs(
  hold: ActiveCheckpointHold,
  wallNowMs: number,
  lastWallMs: number,
  frozen: boolean,
): number {
  if (frozen) return hold.elapsedMs;
  const elapsedWallMs = Math.max(0, wallNowMs - lastWallMs);
  return Math.min(
    hold.durationMs,
    hold.elapsedMs + Math.min(elapsedWallMs, checkpointSegmentRemainingMs(hold)),
  );
}

function checkpointSegmentIndex(
  hold: ActiveCheckpointHold,
  elapsedMs = hold.elapsedMs,
): number {
  return Math.min(
    hold.focusTargets.length - 1,
    Math.floor(elapsedMs / CHECKPOINT_CORRECTION_HOLD_MS),
  );
}

function checkpointSegmentElapsedMs(
  hold: ActiveCheckpointHold,
  elapsedMs = hold.elapsedMs,
): number {
  return elapsedMs
    - checkpointSegmentIndex(hold, elapsedMs) * CHECKPOINT_CORRECTION_HOLD_MS;
}

function checkpointSegmentRemainingMs(hold: ActiveCheckpointHold): number {
  return CHECKPOINT_CORRECTION_HOLD_MS - checkpointSegmentElapsedMs(hold);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Returns the exact readable hold duration in milliseconds for visible text. */
export function speechHoldMs(visibleCharacters: number): number {
  if (!Number.isFinite(visibleCharacters) || visibleCharacters < 0) {
    throw new RangeError("visibleCharacters must be a non-negative finite number");
  }
  return clamp(1 + visibleCharacters / 18, 3, 12) * 1_000;
}

/** Builds the deterministic five-phase placeholder program consumed by Task 4 fakes. */
export function buildStoryProgram(moment: StoryMoment, speed: PresentationSpeed): SceneRuntimeProgram {
  if (![0.5, 1, 1.5, 2].includes(speed)) throw new RangeError("unsupported presentation speed");
  const baseTotal = moment.priority === "ambient" ? 1_750 : moment.priority === "featured" ? 3_000 : 3_850;
  const base = {
    enter: baseTotal * 0.15,
    hold: baseTotal * 0.25,
    consequence: baseTotal * 0.20,
    recover: baseTotal * 0.25,
    exit: baseTotal * 0.15,
  };
  const message = visibleMessage(moment);
  const durations: Record<StoryPhase, number> = {
    enter: base.enter / speed,
    hold: message === null ? base.hold : speechHoldMs(message.length),
    consequence: base.consequence,
    recover: base.recover / speed,
    exit: base.exit / speed,
  };
  let cursor = 0;
  const phaseWindows = (["enter", "hold", "consequence", "recover", "exit"] as const).map((phase) => {
    const window = Object.freeze({ phase, startMs: cursor, endMs: cursor + durations[phase] });
    cursor = window.endMs;
    return window;
  });
  const safeCancelMarkers = Object.freeze(["scene-safe", "scene-exit"]);
  const phases = phaseWindows.map((window): PresentedSceneView => Object.freeze({
    momentId: moment.id,
    regionId: focusRegion(moment),
    phase: window.phase,
    focus: moment.focus,
    dialogue: null,
    actorIntents: Object.freeze([]),
    homeIntents: Object.freeze([]),
    effectIntents: Object.freeze([]),
    safeCancelMarkers,
    reducedMotion: false,
  }));
  const holdAt = phaseWindows.find((window) => window.phase === "hold")!.startMs;
  const consequenceAt = phaseWindows.find((window) => window.phase === "consequence")!.startMs;
  const safeAt = phaseWindows.find((window) => window.phase === "recover")!.startMs;
  return Object.freeze({
    id: `story:${moment.id}`,
    phases: Object.freeze(phases),
    phaseWindows: Object.freeze(phaseWindows),
    markers: Object.freeze([
      Object.freeze({ name: "story-contact", atMs: holdAt, order: 0, role: "contact" as const, optional: false }),
      Object.freeze({ name: "consequence-published", atMs: consequenceAt, order: 0, role: "consequence" as const, optional: false }),
      Object.freeze({ name: "scene-safe", atMs: safeAt, order: 0, role: "safe-cancel" as const, optional: false }),
      Object.freeze({ name: "scene-exit", atMs: cursor, order: 0, role: "safe-cancel" as const, optional: false }),
      Object.freeze({ name: "scene-settled", atMs: cursor, order: 1, role: "settle" as const, optional: false }),
    ]),
    durationMs: cursor,
    consequenceMarker: "consequence-published",
    safeCancelMarkers,
  });
}

function validateMoment(moment: StoryMoment): void {
  if (moment.evidence.length === 0) throw new RangeError("story moment evidence must not be empty");
  const expected = Array.from(
    { length: moment.lastCursor - moment.firstCursor + 1 },
    (_, index) => moment.firstCursor + index,
  );
  if (JSON.stringify(moment.evidenceCursors) !== JSON.stringify(expected)) {
    throw new RangeError("story moment evidence must cover its full contiguous cursor range");
  }
  if (moment.evidence.some((entry, index) => entry.cursor !== expected[index])) {
    throw new RangeError("story moment evidence entries must match evidenceCursors");
  }
}

function phaseAt(program: SceneRuntimeProgram, elapsedMs: number): StoryPhase {
  return phaseWindowAt(program, elapsedMs).phase;
}

function sceneAt(program: SceneRuntimeProgram, elapsedMs: number): PresentedSceneView | null {
  const window = phaseWindowAt(program, elapsedMs);
  const index = program.phaseWindows.indexOf(window);
  return program.phases[index] ?? program.phases.find((scene) => scene.phase === window.phase) ?? null;
}

function phaseWindowAt(
  program: SceneRuntimeProgram,
  elapsedMs: number,
): SceneRuntimeProgram["phaseWindows"][number] {
  return program.phaseWindows.find(
    (window) => elapsedMs >= window.startMs && elapsedMs < window.endMs,
  ) ?? program.phaseWindows.at(-1)!;
}

function visibleMessage(moment: StoryMoment): string | null {
  if (moment.representative.event.type !== "speak" && moment.representative.event.type !== "self_talk") return null;
  const message = moment.representative.event.payload.message;
  return typeof message === "string" ? message : null;
}

function focusRegion(moment: StoryMoment): string | null {
  if (moment.focus.kind === "region") return moment.focus.id;
  if (moment.focus.kind === "system") return moment.focus.regionId;
  return moment.representative.resolved.region ?? moment.representative.event.region;
}

function backlogLabel(state: PresentationBacklog["state"], pending: number): string {
  if (state === "caught-up") return "Live";
  if (state === "paused") return "Paused";
  if (state === "overflow") return "The world moved ahead";
  return `${pending} ${pending === 1 ? "moment" : "moments"} behind`;
}

function freezeIdentity(identity: FrameIdentity): FrameIdentity {
  return Object.freeze({ ...identity });
}

function representableWallDeadline(wallNowMs: number, wallDelayMs: number): number {
  const requestedDeadline = wallNowMs + wallDelayMs;
  if (wallDelayMs === 0 || requestedDeadline > wallNowMs) return requestedDeadline;
  const representableStep = Math.max(
    Number.MIN_VALUE,
    Math.abs(wallNowMs) * Number.EPSILON,
  );
  return wallNowMs + representableStep;
}

function digestMajorMoments(
  moments: readonly StoryMoment[],
): readonly MajorStoryDigestEntry[] {
  const counts = new Map<PresentedEventType, number>();
  for (const moment of moments) {
    if (moment.priority === "ambient") continue;
    const candidateType = moment.representative.event.type;
    if (!isPresentedEventType(candidateType)) continue;
    counts.set(candidateType, (counts.get(candidateType) ?? 0) + 1);
  }
  return Object.freeze([...counts].map(([eventType, count]) => Object.freeze({
    eventType,
    count,
  })));
}

function mergePressureSummaries(
  earlier: PresentationPressureSummary,
  later: PresentationPressureSummary,
): PresentationPressureSummary {
  const counts = new Map<PresentedEventType, number>();
  for (const item of [...earlier.majorDigest, ...later.majorDigest]) {
    counts.set(item.eventType, (counts.get(item.eventType) ?? 0) + item.count);
  }
  return Object.freeze({
    firstCursor: earlier.firstCursor,
    lastCursor: later.lastCursor,
    ambientCount: earlier.ambientCount + later.ambientCount,
    majorMomentIds: Object.freeze(
      [...earlier.majorMomentIds, ...later.majorMomentIds].slice(-MAX_RETAINED_MAJOR_IDS),
    ),
    majorDigest: Object.freeze([...counts].map(([eventType, count]) => Object.freeze({
      eventType,
      count,
    }))),
    archiveAvailable: earlier.archiveAvailable || later.archiveAvailable,
  });
}

function isPresentedEventType(value: string): value is PresentedEventType {
  return KNOWN_EVENT_TYPES.has(value);
}

function playbackRate(phase: StoryPhase, speed: PresentationSpeed): number {
  return phase === "enter" || phase === "recover" || phase === "exit" ? speed : 1;
}

function checkpointDigest(record: ClassifiedCheckpointRecord): string {
  return `${record.line}:${record.checkpoint.run_id}:${record.checkpoint.event_cursor}:${record.checkpoint.world_time}`;
}

function retainNewest<T>(values: readonly T[], limit: number): T[] {
  return values.slice(Math.max(0, values.length - limit));
}
