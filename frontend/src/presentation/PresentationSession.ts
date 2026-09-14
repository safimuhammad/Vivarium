import type { LiveApiClient, EventStream } from "../app/client";
import { classifyRunAcceptance } from "../app/client";
import type { ReplayPresentationWindow } from "../app/replayArtifactClient";
import type {
  EventEnvelope,
  RunMetadata,
  WorldSnapshot,
} from "../app/schemas";
import { RUN_STATUSES } from "../app/schemas";
import {
  createCanonicalWorldStore,
  type CanonicalWorldStore,
} from "./CanonicalWorldStore";
import { BeatDirector, type StoryMoment } from "./BeatDirector";
import type {
  CheckpointFeed,
  CheckpointFeedDiagnostics,
  CheckpointFeedFault,
} from "./CheckpointFeed";
import {
  type FrameIdentity,
  type MomentAnchor,
  type ObserverSelection,
  type PresentedObserverFrame,
  type PresentationGap,
  type PresentationIngressSnapshot,
  type PresentationLiveness,
  type PresentationNotice,
  type PresentationSource,
  type PresentedSceneView,
} from "./contracts";
import {
  createPresentationFrameSink,
  type PresentationFrameAcceptanceTracker,
  type PresentationFrameSink,
} from "./PresentationFrameSink";
import { createPresentationIngress, type PresentationIngress } from "./PresentationIngress";
import { PresentedWorldModel } from "./PresentedWorldModel";
import type { PresentedHoardThresholds } from "./PresentedEventProjector";
import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import type { PresentedEventType } from "./eventPayloads";
import {
  createRecoveryCoordinator,
  type RecoveryCoordinator,
  type RecoveryCoordinatorState,
  type RecoveryDigest,
  type RecoveryPlacementPort,
  type PreparedRecoveryPlacement,
  type PreparedRecoveryPlacementPort,
  type RecoveryPublication,
  type RecoveryPublicationReceipt,
  type RecoveryReason,
} from "./RecoveryCoordinator";
import {
  SceneSettlementCoordinator,
  ScenePublicationPending,
  type SceneRuntimePort,
} from "./SceneSettlementCoordinator";
import {
  selectPresentedChronicle,
  type PresentedChronicleWindow,
  type RedactedUpcomingMoment,
  type SanitizedChronicleData,
} from "./selectors";
import {
  StoryDirector,
  type PresentationSpeed,
  type StoryDirectorSnapshot,
} from "./StoryDirector";
import type { PresentationClock } from "./storyClock";
import { createConversationStaging } from "./conversationStaging";
import type { PlacementLedgerSnapshot } from "../renderer2d/production/placement/PlacementLedger";
import type { PlacementGenerationOwner } from "../renderer2d/production/placement/PlacementGeneration";
import type { RegionMapRecipeV1 } from "../renderer2d/production/maps/RegionMapRecipe";
import { createChoreographyProgramResolver } from "./choreography/registry";

export interface PresentationControls {
  pause(): void;
  resume(choice?: "continue-from-summary" | "snap-to-live"): void;
  setSpeed(speed: PresentationSpeed): void;
  holdCurrentMoment(hold: boolean): void;
  viewMoment(momentId: string): void;
  /**
   * Views the moment that carries one event cursor.
   *
   * The Chronicle feed is an EVENT-level surface while navigation is
   * moment-level, so the shell resolves a clicked card against the rows it was
   * given and falls through to here when it finds none. Only the session still
   * knows which moments it keeps, so it is the one layer that can tell a viewer
   * honestly that the moment they clicked is gone rather than doing nothing.
   */
  viewCursor(cursor: number): void;
}

export interface PresentationSessionReset {
  readonly runId: string;
  readonly sourceKey: string;
  readonly snapshot: WorldSnapshot;
  readonly revision: number;
}

export interface PresentationSessionDiagnostics {
  readonly disposed: boolean;
  readonly paused: boolean;
  readonly speed: PresentationSpeed;
  readonly held: boolean;
  readonly hidden: boolean;
  readonly recovery: RecoveryCoordinatorState;
  readonly lastCompletedRecovery: CompletedRecoveryReceipt | null;
  readonly settlement: ReturnType<SceneSettlementCoordinator["getSnapshot"]> | null;
  readonly ingress: PresentationIngressSnapshot & Readonly<{
    lifetimeAcceptedCount: number;
    lifetimeDuplicateCount: number;
    /** Accepted batches the director refused. Non-zero means presentation has stopped. */
    refusedBatchCount: number;
    lastRefusedBatch:
      Readonly<{ firstCursor: number; lastCursor: number; reason: string }> | null;
  }>;
  readonly director: Readonly<{
    pendingMoments: number;
    /** Moments dropped because no scene could be resolved for them. */
    unpresentableMoments: number;
    checkpointHold: StoryDirectorSnapshot["checkpointHold"];
    framePublicationSerial: number;
    retainedChapters: number;
    retainedPressureSummaries: number;
    activeSceneCount: 0 | 1;
    /** Whether BOTH story lanes are halted awaiting a recovery. */
    recoveryRequired: boolean;
    /** Retryable ingress/checkpoint faults absorbed without demanding a recovery. */
    retryableIngressFaults: number;
    lastRetryableIngressFault: Readonly<{ kind: string; line: number | null }> | null;
    /** Utterance evidence held back waiting for a contiguous cursor run. */
    deferredUtteranceEvidence: number;
  }>;
  readonly chronicle: Readonly<{
    previous: number;
    upcoming: number;
    gaps: number;
  }>;
  readonly checkpoint: CheckpointFeedDiagnostics;
}

export interface CompletedRecoveryReceipt {
  readonly reason: RecoveryReason;
  readonly digest: RecoveryDigest;
  readonly snappedCursor: number;
}

export interface PresentationSession {
  readonly source: PresentationSource;
  readonly ready: Promise<void>;
  subscribe(listener: () => void): () => void;
  getFrame(): PresentedObserverFrame;
  getChronicle(): PresentedChronicleWindow;
  controls(): PresentationControls;
  reset(input: PresentationSessionReset): void;
  select(selection: ObserverSelection): void;
  retryRecovery(): Promise<void>;
  diagnostics(): PresentationSessionDiagnostics;
  setHidden(hidden: boolean): void;
  acceptRunMetadata(run: RunMetadata): void;
  replaceRun(run: RunMetadata, snapshot: WorldSnapshot): void;
  reconnectStream(): void;
  getPlacementGeneration(): PlacementGenerationOwner | null;
  dispose(): void;
}

export interface PresentationSessionBinding {
  bind(session: PresentationSession): void;
  subscribe(listener: () => void): () => void;
  getFrame(): PresentedObserverFrame;
  dispose(): void;
}

export interface LivePresentationSessionOptions {
  readonly clientFactory: () => LiveApiClient;
  readonly clockFactory: () => PresentationClock;
  readonly runtimeFactory: () => SceneRuntimePort;
  readonly checkpointFeedFactory: () => CheckpointFeed;
  readonly placementFactory: (snapshot: WorldSnapshot) => PlacementGenerationOwner;
  readonly choreography: PresentationChoreographySpatialContext & {
    readonly getPlacementOwnerId: () => symbol;
  };
  readonly frameAcceptance: PresentationFrameAcceptanceTracker;
}

export interface ArchivePresentationSessionOptions {
  readonly window: ReplayPresentationWindow;
  readonly clockFactory: () => PresentationClock;
  readonly runtimeFactory: () => SceneRuntimePort;
  readonly choreography: PresentationChoreographySpatialContext;
  readonly frameAcceptance: PresentationFrameAcceptanceTracker;
}

export interface LegacyLivePresentationSessionTestOptions {
  readonly clientFactory: () => LiveApiClient;
  readonly clockFactory: () => PresentationClock;
  readonly runtimeFactory: () => SceneRuntimePort;
  readonly checkpointFeedFactory: () => CheckpointFeed;
  readonly placementFactory: (snapshot: WorldSnapshot) => PreparedRecoveryPlacementPort;
  readonly choreography?: PresentationChoreographySpatialContext;
  readonly frameAcceptance?: PresentationFrameAcceptanceTracker;
}

export interface LegacyArchivePresentationSessionTestOptions {
  readonly window: ReplayPresentationWindow;
  readonly clockFactory: () => PresentationClock;
  readonly runtimeFactory: () => SceneRuntimePort;
  readonly choreography?: PresentationChoreographySpatialContext;
  readonly frameAcceptance?: PresentationFrameAcceptanceTracker;
}

export interface PresentationChoreographySpatialContext {
  readonly getPlacement?: () => PlacementLedgerSnapshot;
  readonly getRecipes?: () => ReadonlyMap<string, RegionMapRecipeV1>;
  readonly reducedMotion?: () => boolean;
  readonly compactResourceRouting?: () => boolean;
}

export interface SceneExecutionTokenAllocator {
  resolve(generation: number, localToken: number | null): number | null;
}

/** Allocate collision-free session tokens without encoding local-token width assumptions. */
export function createSceneExecutionTokenAllocator(): SceneExecutionTokenAllocator {
  let serial = 0;
  let retainedKey: string | null = null;
  let retainedSerial: number | null = null;
  return {
    resolve(generation, localToken): number | null {
      if (localToken === null) return null;
      if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new RangeError("scene generation must be a non-negative safe integer");
      }
      if (!Number.isSafeInteger(localToken) || localToken < 0) {
        throw new RangeError("local scene token must be a non-negative safe integer");
      }
      const key = `${generation}:${localToken}`;
      if (key === retainedKey) return retainedSerial;
      serial += 1;
      if (!Number.isSafeInteger(serial)) throw new RangeError("session scene token allocator exhausted");
      retainedKey = key;
      retainedSerial = serial;
      return serial;
    },
  };
}

interface NarrativeOwners {
  readonly model: PresentedWorldModel;
  readonly settlement: SceneSettlementCoordinator;
  readonly director: StoryDirector;
  readonly recovery: RecoveryCoordinator | null;
  readonly unsubscribeDirector: () => void;
}

interface HiddenEvidenceDigest {
  firstCursor: number;
  lastCursor: number;
  momentCount: number;
  ambientCount: number;
  majorCounts: Map<PresentedEventType, number>;
}

interface PendingConsequencePublication {
  readonly narrativeGeneration: number;
  readonly momentId: string;
  readonly frame: PresentedObserverFrame;
  /** How many times this consequence has been offered to Canvas without a receipt. */
  readonly offers: number;
}

const MAX_PREVIOUS_MOMENTS = 48;
const MAX_GAPS = 32;
/**
 * How many times one consequence frame is offered to Canvas before the barrier
 * gives up on its receipt.
 *
 * The receipt is only ever produced by Canvas COMMITTING the frame, and this
 * session holds every other publication while a receipt is outstanding — so a
 * Canvas that declines once (a stage generation swap, an unavailable region, a
 * superseded region load) would otherwise be able to stop the world forever.
 * Measured on the live-replay route before this bound existed: 150s frozen,
 * 122 consecutive throws, 48 moments queued, chrome still reading LIVE.
 *
 * Offers are driven by `StoryDirector`'s collaborator retry (100ms doubling to a
 * 1000ms cap), so eight offers is roughly five seconds of trying — long enough
 * that a merely slow Canvas is never failed open, short enough that a watcher
 * sees the world resume rather than a still frame.
 */
const MAX_CONSEQUENCE_RECEIPT_OFFERS = 8;
/** Bounded, so a forever-running session cannot accumulate notices without limit. */
const MAX_RETAINED_NOTICES = 8;

/**
 * What a viewer is told when the moment they clicked has left the Chronicle.
 *
 * The Chronicle keeps {@link MAX_PREVIOUS_MOMENTS} settled moments; the feed's
 * own event buffer outlives that, so a rewound feed can offer a card whose
 * moment is already gone. Naming the Archive matters -- the run still has it,
 * this view simply no longer does.
 */
const FORGOTTEN_MOMENT_NOTICE
  = "That moment has left the Chronicle. The Archive still holds it.";

/**
 * What a viewer is told when the moment they clicked happened nowhere.
 *
 * A system beat with no region -- "the world wakes" -- is about the whole world
 * rather than a place in it, so there is no view to fly to. Saying so beats a
 * click that appears to do nothing.
 */
const PLACELESS_MOMENT_NOTICE
  = "That moment belongs to the whole world, not to a place the view can travel to.";
/**
 * Backoff for reopening a dropped stream and for un-latching a frozen recovery.
 *
 * Both were terminal before: a stream error closed the transport and published
 * "offline" and that was all (`reconnectStream` had zero production callers), and
 * a `frozen-retry` latch could only be left by a HUD button. A server restart, a
 * proxy timeout or a laptop sleep ended the live view until the page was reloaded.
 * Unbounded attempts on purpose — a piece meant to run forever must keep trying —
 * but capped, so a long outage is one request every 15s, not a spin.
 */
const REJOIN_BACKOFF_BASE_MS = 1_000;
const REJOIN_BACKOFF_MAX_MS = 15_000;
const REJOIN_BACKOFF_MAX_STEPS = 4;
const PRESENTED_EVENT_TYPES = new Set<string>(EVENT_VISUAL_EVENT_TYPES);

/** Creates the sole direct-transport presentation owner for one live run. */
export function createLivePresentationSession(
  options: LivePresentationSessionOptions,
): PresentationSession {
  return new OwnedPresentationSession("live", options);
}

/** Explicit legacy-program seam for deterministic Task 5 tests; never use in production. */
export function createLegacyLivePresentationSessionForTests(
  options: LegacyLivePresentationSessionTestOptions,
): PresentationSession {
  return new OwnedPresentationSession("live", options);
}

/** Creates an isolated Archive owner from one exact checkpoint and contiguous window. */
export function createArchivePresentationSession(
  options: ArchivePresentationSessionOptions,
): PresentationSession {
  return new OwnedPresentationSession("archive", options);
}

/** Explicit legacy-program seam for deterministic Task 5 Archive tests only. */
export function createLegacyArchivePresentationSessionForTests(
  options: LegacyArchivePresentationSessionTestOptions,
): PresentationSession {
  return new OwnedPresentationSession("archive", options);
}

/** Creates one selected frame-store binding without copying session state. */
export function createPresentationSessionBinding(
  initial: PresentationSession,
): PresentationSessionBinding {
  let disposed = false;
  let generation = 0;
  let selected = initial;
  let live = initial.source === "live" ? initial : null;
  let liveRunId = live?.getFrame().runId ?? null;
  let unsubscribeSelected: (() => void) | null = null;
  let unsubscribeLive: (() => void) | null = null;
  const listeners = new Set<() => void>();
  let notifying = false;
  let pending = 0;

  const emit = (): void => {
    pending += 1;
    if (notifying || disposed) return;
    notifying = true;
    try {
      while (pending > 0 && !disposed) {
        pending -= 1;
        for (const listener of [...listeners]) {
          if (disposed) break;
          try {
            listener();
          } catch {
            // A failed consumer cannot hide a newer selected frame from peers.
          }
        }
      }
    } finally {
      notifying = false;
    }
  };

  const bindSelected = (session: PresentationSession): void => {
    generation += 1;
    const candidate = generation;
    unsubscribeSelected?.();
    selected = session;
    unsubscribeSelected = session.subscribe(() => {
      if (!disposed && candidate === generation && selected === session) emit();
    });
  };

  const watchLive = (session: PresentationSession | null): void => {
    unsubscribeLive?.();
    unsubscribeLive = null;
    live = session;
    liveRunId = session?.getFrame().runId ?? null;
    if (session === null || session === selected) return;
    unsubscribeLive = session.subscribe(() => {
      if (disposed || live !== session) return;
      const nextRunId = session.getFrame().runId;
      if (nextRunId === liveRunId) return;
      liveRunId = nextRunId;
      selected.dispose();
      bindSelected(session);
      watchLive(session);
      session.setHidden(false);
      emit();
    });
  };

  bindSelected(initial);
  if (live !== null) watchLive(live);

  return {
    bind(session): void {
      if (disposed || session === selected) return;
      const previous = selected;
      bindSelected(session);
      if (previous.source === "live") {
        watchLive(previous);
        previous.setHidden(true);
      }
      if (session.source === "live") {
        watchLive(session);
        session.setHidden(false);
      }
      emit();
    },
    subscribe(listener): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getFrame(): PresentedObserverFrame {
      return selected.getFrame();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      unsubscribeSelected?.();
      unsubscribeLive?.();
      unsubscribeSelected = null;
      unsubscribeLive = null;
      listeners.clear();
      pending = 0;
    },
  };
}

class OwnedPresentationSession implements PresentationSession {
  readonly source: PresentationSource;
  readonly ready: Promise<void>;
  private readonly clock: PresentationClock;
  private readonly runtimeFactory: () => SceneRuntimePort;
  private readonly client: LiveApiClient | null;
  private readonly placementFactory: ((snapshot: WorldSnapshot) => PreparedRecoveryPlacementPort) | null;
  private placement: RecoveryPlacementPort;
  private placementOwner: PlacementGenerationOwner | null = null;
  private readonly choreography: PresentationChoreographySpatialContext | null;
  private readonly frameAcceptance: PresentationFrameAcceptanceTracker | null;
  private readonly feed: CheckpointFeed | null;
  private readonly listeners = new Set<() => void>();
  private canonical: CanonicalWorldStore = createCanonicalWorldStore();
  private ingress: PresentationIngress = createPresentationIngress();
  private sink: PresentationFrameSink = createPresentationFrameSink();
  private owners: NarrativeOwners | null = null;
  private stream: EventStream | null = null;
  private run: RunMetadata | null = null;
  private sourceKey = "uninitialized";
  private frame: PresentedObserverFrame | null = null;
  private selection: ObserverSelection = null;
  private previous: StoryMoment[] = [];
  private gaps: PresentationGap[] = [];
  private recoveryPromise: Promise<void> | null = null;
  private recoverySnapshot: WorldSnapshot | null = null;
  private recoveryLocked = false;
  private recoveryChronicle: PresentedChronicleWindow | null = null;
  private generation = 0;
  private narrativeGeneration = 0;
  private readonly sceneTokenAllocator = createSceneExecutionTokenAllocator();
  private hidden = false;
  private hiddenStartCursor: number | null = null;
  private hiddenEvidence: HiddenEvidenceDigest | null = null;
  private held = false;
  private speed: PresentationSpeed = 1;
  private disposed = false;
  private notifying = false;
  private pendingNotifications = 0;
  private lifetimeAcceptedCount = 0;
  private lifetimeDuplicateCount = 0;
  private lastCompletedRecovery: CompletedRecoveryReceipt | null = null;
  private lastPublicationKey: string | null = null;
  private lastPublicationWorld: PresentedObserverFrame["world"] | null = null;
  private pendingConsequencePublication: PendingConsequencePublication | null = null;
  private notices: readonly PresentationNotice[] = [];
  private lastSignalAtMs: number | null = null;
  private lastSignalWasHeartbeat = false;
  private heartbeatWorldTime: number | null = null;
  private connectionState: PresentedObserverFrame["transport"]["connection"] = "live";
  private connectionRetryable = false;
  private rejoinAttempt = 0;
  private cancelRejoin: (() => void) | null = null;
  private frozenRetryAttempt = 0;
  private cancelFrozenRetry: (() => void) | null = null;
  private runReplacementPending = false;
  private runReplacementAttempt = 0;
  private cancelRunReplacementRetry: (() => void) | null = null;
  private readonly controlPort: PresentationControls;
  private unsubscribeIngress: (() => void) | null = null;
  /** Accepted evidence batches the director refused, e.g. for a cursor discontinuity. */
  private refusedBatchCount = 0;
  /** The newest refused batch, verbatim, so "refused" never reads as "nothing happened". */
  private lastRefusedBatch:
    Readonly<{ firstCursor: number; lastCursor: number; reason: string }> | null = null;
  private unsubscribeCheckpoint: (() => void) | null = null;
  private unsubscribeCheckpointFault: (() => void) | null = null;

  constructor(
    source: "live",
    options: LivePresentationSessionOptions,
  );
  constructor(
    source: "archive",
    options: ArchivePresentationSessionOptions,
  );
  constructor(
    source: "live",
    options: LegacyLivePresentationSessionTestOptions,
  );
  constructor(
    source: "archive",
    options: LegacyArchivePresentationSessionTestOptions,
  );
  constructor(
    source: "live" | "archive",
    options:
      | LivePresentationSessionOptions
      | ArchivePresentationSessionOptions
      | LegacyLivePresentationSessionTestOptions
      | LegacyArchivePresentationSessionTestOptions,
  ) {
    this.source = source;
    this.clock = options.clockFactory();
    this.runtimeFactory = options.runtimeFactory;
    this.choreography = options.choreography ?? null;
    this.frameAcceptance = options.frameAcceptance ?? null;
    if (source === "live") {
      const live = options as LivePresentationSessionOptions | LegacyLivePresentationSessionTestOptions;
      this.client = live.clientFactory();
      this.feed = live.checkpointFeedFactory();
      this.placementFactory = live.placementFactory;
      this.placement = { replaceFromSnapshot: () => undefined };
      this.bindFeed();
      this.ready = this.initializeLive();
    } else {
      const archive = options as ArchivePresentationSessionOptions | LegacyArchivePresentationSessionTestOptions;
      this.client = null;
      this.feed = null;
      this.placementFactory = null;
      this.placement = { replaceFromSnapshot: () => undefined };
      this.initializeArchive(archive.window);
      this.ready = Promise.resolve();
    }
    this.controlPort = Object.freeze<PresentationControls>({
      pause: () => {
        if (!this.recoveryLocked) this.owners?.director.setPaused(true);
      },
      resume: (choice: "continue-from-summary" | "snap-to-live" = "continue-from-summary") => {
        if (this.recoveryLocked) return;
        if (choice === "snap-to-live" && this.source === "live") {
          if (this.ingress.getSnapshot().ingestedCursor <= this.getFrame().lastCursor) {
            this.owners?.director.resumeAfterAbsence(choice);
            return;
          }
          const activeScene = this.owners?.settlement.getSnapshot().sceneToken !== null;
          void this.triggerRecovery("hidden-tab", this.digestThroughIngestedCursor());
          if (activeScene) this.owners?.director.resumeAfterAbsence(choice);
          return;
        }
        this.owners?.director.resumeAfterAbsence(choice);
      },
      setSpeed: (speed: PresentationSpeed) => {
        if (this.recoveryLocked) return;
        this.speed = speed;
        this.owners?.director.setSpeed(speed);
        this.publishObserverFrame();
      },
      holdCurrentMoment: (hold: boolean) => {
        if (this.recoveryLocked) return;
        this.held = hold;
        this.owners?.director.holdCurrentMoment(hold);
        this.publishObserverFrame();
      },
      viewMoment: (momentId: string) => {
        if (!this.recoveryLocked) this.viewMoment(momentId);
      },
      viewCursor: (cursor: number) => {
        if (!this.recoveryLocked) this.viewCursor(cursor);
      },
    });
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getFrame(): PresentedObserverFrame {
    if (this.frame === null) throw new Error("presentation session is not ready");
    return this.frame;
  }

  getChronicle(): PresentedChronicleWindow {
    if (this.recoveryLocked && this.recoveryChronicle !== null) {
      return this.recoveryChronicle;
    }
    const frame = this.getFrame();
    return selectPresentedChronicle(frame, this.rawChronicle());
  }

  controls(): PresentationControls {
    return this.controlPort;
  }

  reset(input: PresentationSessionReset): void {
    if (input.runId !== input.snapshot.run_id) {
      throw new Error("reset runId must match snapshot run_id");
    }
    if (
      this.frame !== null
      && input.runId === this.frame.runId
      && input.sourceKey === this.frame.sourceKey
      && input.revision <= this.frame.revision
    ) throw new Error("reset revision must advance for the active run and source");
    this.installSnapshot({
      run: this.run?.run_id === input.runId ? this.run : syntheticRun(input.snapshot),
      snapshot: input.snapshot,
      sourceKey: input.sourceKey,
      revision: input.revision,
      openStream: this.source === "live",
      resetFeed: true,
    });
  }

  select(selection: ObserverSelection): void {
    if (this.disposed || this.recoveryLocked || sameSelection(this.selection, selection)) return;
    this.selection = selection === null ? null : structuredClone(selection);
    this.publishObserverFrame();
  }

  retryRecovery(): Promise<void> {
    if (this.disposed || this.owners?.recovery === null || this.owners === null) {
      return Promise.resolve();
    }
    const candidate = this.generation;
    const recovery = this.owners.recovery;
    const before = recovery.getSnapshot();
    const retry = recovery.retry();
    if (recovery.getSnapshot() !== before) this.emit();
    return retry.then(
      () => {
        const completed = recovery.getSnapshot().status === "complete";
        this.finishRecovery(candidate);
        if (!completed && this.isCurrent(candidate)) this.emit();
      },
      (error: unknown) => {
        if (this.isCurrent(candidate)) this.emit();
        throw error;
      },
    );
  }

  diagnostics(): PresentationSessionDiagnostics {
    const director = this.owners?.director.getSnapshot();
    const directorDiagnostics = this.owners?.director.diagnostics();
    const chronicle = this.rawChronicle();
    const ingress = this.ingress.getSnapshot();
    return Object.freeze({
      disposed: this.disposed,
      paused: director?.paused ?? false,
      speed: this.speed,
      held: this.held,
      hidden: this.hidden,
      recovery: this.owners?.recovery?.getSnapshot() ?? Object.freeze({ status: "idle" }),
      lastCompletedRecovery: this.lastCompletedRecovery,
      settlement: this.owners?.settlement.getSnapshot() ?? null,
      ingress: Object.freeze({
        ...ingress,
        lifetimeAcceptedCount: this.lifetimeAcceptedCount,
        lifetimeDuplicateCount: this.lifetimeDuplicateCount,
        refusedBatchCount: this.refusedBatchCount,
        lastRefusedBatch: this.lastRefusedBatch,
      }),
      director: Object.freeze({
        pendingMoments: directorDiagnostics?.pendingMoments ?? 0,
        unpresentableMoments: directorDiagnostics?.unpresentableMoments ?? 0,
        checkpointHold: director?.checkpointHold ?? null,
        framePublicationSerial: this.sink.getSnapshot().publicationSerial,
        retainedChapters: directorDiagnostics?.retainedChapters ?? 0,
        retainedPressureSummaries: directorDiagnostics?.retainedPressureSummaries ?? 0,
        activeSceneCount: directorDiagnostics?.activeSceneCount ?? 0,
        recoveryRequired: directorDiagnostics?.recoveryRequired ?? false,
        retryableIngressFaults: directorDiagnostics?.retryableIngressFaults ?? 0,
        lastRetryableIngressFault: directorDiagnostics?.lastRetryableIngressFault ?? null,
        deferredUtteranceEvidence: directorDiagnostics?.deferredUtteranceEvidence ?? 0,
      }),
      chronicle: Object.freeze({
        previous: chronicle.previous.length,
        upcoming: chronicle.upcoming.length,
        gaps: chronicle.gaps.length,
      }),
      checkpoint: this.feed?.diagnostics() ?? Object.freeze({
        disposed: this.disposed,
        runId: null,
        lastDeliveredLine: 0,
        polling: false,
        retainedSafeCheckpoints: 0,
        faultCount: 0,
      }),
    });
  }

  setHidden(hidden: boolean): void {
    if (this.disposed || this.hidden === hidden || this.source !== "live") return;
    this.hidden = hidden;
    if (this.recoveryLocked) {
      if (hidden) this.hiddenStartCursor = this.getFrame().ingestedCursor;
      else this.hiddenEvidence = null;
      return;
    }
    if (hidden) {
      this.hiddenStartCursor = this.getFrame().ingestedCursor;
      if (this.recoveryPromise === null) this.owners?.director.setPaused(true);
      this.hiddenEvidence = this.pendingHiddenEvidence();
      return;
    }
    if (this.recoveryPromise !== null) {
      this.hiddenEvidence = null;
      this.owners?.director.setPaused(false);
      return;
    }
    const pressureDigest = this.hiddenPressureDigest();
    if (pressureDigest !== null) {
      void this.triggerRecovery("hidden-tab", pressureDigest);
      return;
    }
    this.owners?.director.setPaused(false);
    this.publishWhileAwayGap();
  }

  acceptRunMetadata(run: RunMetadata): void {
    if (this.disposed) return;
    if (this.run === null) {
      this.run = structuredClone(run);
      this.canonical.acceptRun(run);
      return;
    }
    if (classifyRunAcceptance(this.run.run_id, run.run_id) === "replacement") {
      throw new Error("changed run metadata requires replaceRun with exact snapshot truth");
    }
    this.run = structuredClone(run);
    this.canonical.acceptRun(run);
  }

  replaceRun(run: RunMetadata, snapshot: WorldSnapshot): void {
    this.installSnapshot({
      run,
      snapshot,
      sourceKey: `${this.source}:${run.run_id}`,
      revision: (this.frame?.revision ?? 0) + 1,
      openStream: this.source === "live",
      resetFeed: true,
    });
  }

  reconnectStream(): void {
    if (
      this.disposed
      || this.recoveryLocked
      || this.source !== "live"
      || this.frame === null
    ) return;
    const recovery = this.owners?.recovery?.getSnapshot();
    if (recovery !== undefined && recovery.status !== "idle" && recovery.status !== "complete") {
      return;
    }
    // An explicit reconnect supersedes the pending automatic one and starts its
    // backoff over: a watcher pressing the button is asking for "now", not "in 8s".
    this.cancelRejoin?.();
    this.cancelRejoin = null;
    this.rejoinAttempt = 0;
    this.openStream(this.frame.ingestedCursor, this.generation);
  }

  getPlacementGeneration(): PlacementGenerationOwner | null {
    return this.placementOwner;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lastCompletedRecovery = null;
    this.generation += 1;
    this.cancelScheduledRejoin();
    this.closeStream();
    this.teardownNarrative();
    this.unsubscribeIngress?.();
    this.unsubscribeCheckpoint?.();
    this.unsubscribeCheckpointFault?.();
    this.unsubscribeIngress = null;
    this.unsubscribeCheckpoint = null;
    this.unsubscribeCheckpointFault = null;
    this.ingress.dispose();
    this.feed?.dispose();
    this.sink.dispose();
    this.frameAcceptance?.dispose();
    this.placement.dispose?.();
    this.placementOwner = null;
    this.listeners.clear();
    this.pendingNotifications = 0;
  }

  private async initializeLive(): Promise<void> {
    const candidate = this.generation;
    try {
      const run = await this.client!.getRun();
      if (!this.isCurrent(candidate)) return;
      const snapshot = await this.client!.getWorld();
      if (!this.isCurrent(candidate)) return;
      this.installSnapshot({
        run,
        snapshot,
        sourceKey: `live:${run.run_id}`,
        revision: 1,
        openStream: true,
        resetFeed: false,
        preserveGeneration: true,
      });
    } catch (error) {
      if (this.frame !== null && this.isCurrent(candidate)) {
        this.publishObserverFrame("error", true);
      } else if (this.isCurrent(candidate)) {
        throw error;
      }
    }
  }

  private initializeArchive(window: ReplayPresentationWindow): void {
    validateArchiveWindow(window);
    this.installSnapshot({
      run: syntheticRun(window.snapshot),
      snapshot: window.snapshot,
      sourceKey: window.sourceKey,
      revision: 1,
      openStream: false,
      resetFeed: false,
      preserveGeneration: true,
    });
    if (window.entries.length > 0) {
      this.ingress.onEnvelopeAccepted({
        schema: 1,
        cursor: window.firstCursor,
        oldest_cursor: window.entries[0].cursor,
        next_cursor: window.entries.at(-1)!.cursor,
        events: [...window.entries],
        overflow: false,
        snapshot_required: false,
      });
    }
  }

  private installSnapshot(input: Readonly<{
    run: RunMetadata;
    snapshot: WorldSnapshot;
    sourceKey: string;
    revision: number;
    openStream: boolean;
    resetFeed: boolean;
    preserveGeneration?: boolean;
  }>): void {
    if (this.disposed) return;
    if (input.run.run_id !== input.snapshot.run_id) {
      throw new Error("run metadata and snapshot must share run identity");
    }
    if (
      this.frame !== null
      && input.run.run_id === this.frame.runId
      && input.snapshot.event_cursor < this.frame.presentedCursor
    ) throw new RangeError("same-run reset cannot move behind presented truth");
    const rawNextPlacement = this.placementFactory === null
      ? null
      : this.placementFactory(structuredClone(input.snapshot));
    const nextPlacement = rawNextPlacement === null
      ? null
      : wrapPlacement(
          rawNextPlacement,
          (snapshot) => {
            this.recoverySnapshot = structuredClone(snapshot);
          },
        );
    const nextPlacementOwner = isPlacementGenerationOwner(rawNextPlacement)
      ? rawNextPlacement
      : null;
    if (
      nextPlacementOwner !== null
      && this.choreography !== null
      && hasPlacementOwnerId(this.choreography)
      && this.choreography.getPlacementOwnerId() !== nextPlacementOwner.ownerId
    ) {
      nextPlacementOwner.dispose();
      throw new Error("choreography and recovery must share one placement generation owner");
    }
    if (!input.preserveGeneration) this.generation += 1;
    this.lastCompletedRecovery = null;
    const candidate = this.generation;
    this.cancelScheduledRejoin();
    this.rejoinAttempt = 0;
    this.frozenRetryAttempt = 0;
    this.runReplacementPending = false;
    this.runReplacementAttempt = 0;
    this.closeStream();
    this.frameAcceptance?.clear();
    this.lastPublicationKey = null;
    this.lastPublicationWorld = null;
    this.recoveryPromise = null;
    this.recoverySnapshot = null;
    this.clearRecoveryFreeze();
    this.teardownNarrative();
    if (nextPlacement !== null) {
      this.placement.dispose?.();
      this.placement = nextPlacement;
      this.placementOwner = nextPlacementOwner;
    }
    this.unsubscribeIngress?.();
    this.ingress.dispose();
    this.ingress = createPresentationIngress();
    this.canonical = createCanonicalWorldStore();
    this.sink.dispose();
    this.sink = createPresentationFrameSink();
    this.run = structuredClone(input.run);
    this.sourceKey = input.sourceKey;
    this.selection = null;
    this.previous = [];
    this.gaps = [];
    this.notices = [];
    this.connectionState = "live";
    this.connectionRetryable = false;
    this.lastSignalAtMs = null;
    this.lastSignalWasHeartbeat = false;
    this.heartbeatWorldTime = null;
    this.hidden = false;
    this.hiddenStartCursor = null;
    this.hiddenEvidence = null;
    this.held = false;
    this.speed = 1;
    this.canonical.acceptRun(input.run);
    this.canonical.acceptSnapshot(input.snapshot);
    this.ingress.reset({
      runId: input.run.run_id,
      sourceKey: input.sourceKey,
      cursor: input.snapshot.event_cursor,
    });
    this.bindIngress();
    const identity: FrameIdentity = {
      runId: input.run.run_id,
      sourceKey: input.sourceKey,
      revision: input.revision,
      firstCursor: input.snapshot.event_cursor,
      lastCursor: input.snapshot.event_cursor,
    };
    this.buildNarrative(input.snapshot, identity);
    this.publishObserverFrame("live", false, identity);
    if (this.feed !== null) {
      if (input.resetFeed) this.feed.reset({ runId: input.run.run_id, sourceKey: input.sourceKey });
      else this.feed.start({ runId: input.run.run_id, sourceKey: input.sourceKey });
    }
    if (input.openStream && this.isCurrent(candidate)) {
      this.openStream(input.snapshot.event_cursor, candidate);
    }
  }

  private buildNarrative(snapshot: WorldSnapshot, identity: FrameIdentity): void {
    this.narrativeGeneration += 1;
    const model = new PresentedWorldModel(snapshot, identity, thresholdsFrom(this.run));
    const runtime = this.runtimeFactory();
    let director!: StoryDirector;
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: (moment, consequenceScene) => {
        const pending = this.pendingConsequencePublication;
        if (pending !== null) {
          const retained = this.sink.getSnapshot().frame;
          if (
            pending.narrativeGeneration !== this.narrativeGeneration
            || pending.momentId !== moment.id
            || retained === null
            || !sameFrameIdentity(retained, pending.frame)
            || retained.scene?.momentId !== pending.momentId
            || retained.scene.phase !== "consequence"
          ) {
            throw new Error("consequence frame was not retained at its exact revision");
          }
          if (this.frameAcceptance !== null && !this.frameAcceptance.accepts(retained)) {
            // Only a Canvas COMMIT produces the receipt, and this session holds every
            // other publication while one is outstanding — so re-reading the receipt
            // can wait forever. Offer the consequence again instead, at a fresh
            // revision, which is the one thing that gives Canvas another commit.
            if (pending.offers < MAX_CONSEQUENCE_RECEIPT_OFFERS) {
              this.pendingConsequencePublication = null;
              this.offerConsequenceFrame(moment, consequenceScene, model, director, pending.offers);
              throw new ScenePublicationPending();
            }
            // Bounded: a Canvas that will not sign must not be able to stop the world.
            // Settle without the receipt and say so — a frozen stage proves nothing.
            this.retainNotice({
              kind: "canvas-receipt",
              detail: "The view did not confirm a moment was drawn; the story moved on without it.",
              firstCursor: moment.firstCursor,
              lastCursor: moment.lastCursor,
              count: 1,
            });
          }
          this.pendingConsequencePublication = null;
          return retained.revision;
        }
        const accepted = this.offerConsequenceFrame(moment, consequenceScene, model, director, 0);
        if (this.frameAcceptance !== null && !this.frameAcceptance.accepts(accepted)) {
          throw new ScenePublicationPending();
        }
        this.pendingConsequencePublication = null;
        return accepted.revision;
      },
      onSettlementComplete: (moment) => {
        this.previous = [...this.previous, structuredClone(moment)].slice(-MAX_PREVIOUS_MOMENTS);
        if (this.recoveryLocked) director.setPaused(true);
      },
    });
    const programResolver = this.choreography === null ? undefined : createChoreographyProgramResolver({
      getFrame: () => this.getFrame(),
      getPlacement: this.placementOwner === null
        ? requireSpatialGetter(this.choreography.getPlacement, "placement")
        : () => this.placementOwner!.snapshot(),
      getRecipes: this.placementOwner === null
        ? requireSpatialGetter(this.choreography.getRecipes, "recipes")
        : () => this.placementOwner!.recipes(),
      reducedMotion: this.choreography.reducedMotion ?? (() => false),
      compactResourceRouting: this.choreography.compactResourceRouting,
      // Optional: no fixture-only `PresentationChoreographySpatialContext` caller supplies this
      // (matching `ProductionSceneCommandResolverOptions`'s own optional-and-permissive default),
      // so it is only wired when a real generation owner -- and therefore a real live
      // `PlacementLedger` -- backs this session.
      ...(this.placementOwner === null
        ? {}
        : { getNavigationGrid: (regionId: string) => this.placementOwner!.current().navigationGridFor(regionId) }),
    });
    // Conversational staging needs the same spatial truth choreography does --
    // where a being stands, and what the region's ground and structures allow --
    // so it is wired from exactly the same getters, and is simply absent when a
    // session has none. Without it the overlay lane behaves as it always has.
    const conversationStaging = this.choreography === null
      ? undefined
      : createConversationStaging({
        getPlacement: this.placementOwner === null
          ? requireSpatialGetter(this.choreography.getPlacement, "placement")
          : () => this.placementOwner!.snapshot(),
        getRecipes: this.placementOwner === null
          ? requireSpatialGetter(this.choreography.getRecipes, "recipes")
          : () => this.placementOwner!.recipes(),
        reducedMotion: this.choreography.reducedMotion ?? (() => false),
      });
    director = new StoryDirector({
      clock: this.clock,
      identity,
      model,
      settlement,
      pressureCancellationOwner: "recovery-coordinator",
      // The overlay lane has no settlement handshake, so it reports here what
      // `onSettlementComplete` reports for the choreography lane. Without this
      // the chronicle -- and therefore the event feed -- would silently lose
      // 93% of a real run the moment those beats stopped taking a stage lease.
      onUtteranceMoment: (moment) => {
        this.previous = [...this.previous, structuredClone(moment)].slice(-MAX_PREVIOUS_MOMENTS);
      },
      // Six of eight recorded runs are unparseable by the current renderer, and the
      // failure was silent: the throw reached `PresentationIngress`'s isolation catch,
      // the queue filled, and the frame still read "live" with 0 of 544 moments
      // performed. A silent zero is the worst failure mode a live view has.
      onUnpresentableMoment: (moment) => {
        this.retainNotice({
          kind: "unpresentable-moment",
          detail: "Some of what happened could not be staged and was skipped.",
          firstCursor: moment.firstCursor,
          lastCursor: moment.lastCursor,
          count: 1,
        });
      },
      ...(programResolver === undefined ? {} : { programResolver }),
      ...(conversationStaging === undefined ? {} : { conversationStaging }),
    });
    if (this.speed !== 1) director.setSpeed(this.speed);
    if (this.hidden) director.setPaused(true);
    const recovery = this.client === null ? null : createRecoveryCoordinator({
      client: this.client,
      model,
      placement: this.placement,
      settlement: {
        requestSafeCancel: (reason) => settlement.requestSafeCancel(reason),
        subscribe: (listener) => settlement.subscribe(listener),
        getSnapshot: () => settlement.getSnapshot(),
      },
      publication: {
        currentFrame: () => this.getFrame(),
        publishRecovery: (publication) => this.publishRecovery(publication),
      },
      getActiveIdentity: () => this.getFrame(),
    });
    const unsubscribeDirector = director.subscribe(() => this.publishObserverFrame());
    this.owners = { model, settlement, director, recovery, unsubscribeDirector };
  }

  /**
   * Publishes one consequence frame at a fresh revision and arms the receipt barrier.
   *
   * Mutates `this.pendingConsequencePublication` (which in turn holds every other
   * publication, see `publishObserverFrame`) and publishes through the sink. Used
   * both for the first offer and for every re-offer, because re-offering at a new
   * revision is the ONLY thing that gives Canvas another chance to commit — and a
   * commit is the only thing that produces the receipt the barrier waits for.
   *
   * @param offers How many offers of this same consequence have already been made.
   * @returns The frame the sink retained, at the exact revision published.
   */
  private offerConsequenceFrame(
    moment: StoryMoment,
    consequenceScene: PresentedSceneView,
    model: PresentedWorldModel,
    director: StoryDirector,
    offers: number,
  ): PresentedObserverFrame {
    const revision = this.nextRevision();
    // A re-offer is byte-identical to the offer before it apart from the revision,
    // and `semanticPublicationKey` deliberately ignores revision — so without this
    // the dedup would swallow every re-offer and the barrier could never be met.
    this.lastPublicationKey = null;
    this.publishObserverFrame(undefined, undefined, {
      ...this.getFrame(),
      revision,
      firstCursor: moment.firstCursor,
      lastCursor: moment.lastCursor,
    }, consequenceScene, model, director, true);
    const accepted = this.sink.getSnapshot().frame;
    if (
      accepted === null
      || accepted.runId !== this.run?.run_id
      || accepted.sourceKey !== this.sourceKey
      || accepted.revision !== revision
      || accepted.firstCursor !== moment.firstCursor
      || accepted.lastCursor !== moment.lastCursor
      || accepted.scene?.momentId !== moment.id
      || accepted.scene.phase !== "consequence"
    ) {
      throw new Error("consequence frame was not retained at its exact revision");
    }
    this.pendingConsequencePublication = Object.freeze({
      narrativeGeneration: this.narrativeGeneration,
      momentId: moment.id,
      frame: accepted,
      offers: offers + 1,
    });
    return accepted;
  }

  /**
   * The evidence a watcher needs to tell quiet from behind from gone from over.
   *
   * `runStatus` comes from `/api/run`; the signal fields are stamped by the stream
   * (events or the backend's 15s `heartbeat`). No derivation happens here — the
   * chrome owns the reading, this owns the facts.
   */
  private livenessState(): PresentationLiveness {
    return Object.freeze({
      runStatus: this.run?.status ?? "running",
      lastSignalAtMs: this.lastSignalAtMs,
      lastSignalWasHeartbeat: this.lastSignalWasHeartbeat,
      heartbeatWorldTime: this.heartbeatWorldTime,
    });
  }

  /**
   * Records one absorbed-but-loud fault, merging repeats of the same kind.
   *
   * Mutates `this.notices`. Never publishes on its own — the caller is always
   * mid-publication, and a notice riding the next frame is what makes it visible.
   */
  private retainNotice(notice: PresentationNotice): void {
    const existing = this.notices.find((retained) => retained.kind === notice.kind);
    const merged: PresentationNotice = existing === undefined ? notice : {
      kind: notice.kind,
      detail: notice.detail,
      firstCursor: existing.firstCursor ?? notice.firstCursor,
      lastCursor: notice.lastCursor ?? existing.lastCursor,
      count: existing.count + notice.count,
    };
    this.notices = Object.freeze([
      ...this.notices.filter((retained) => retained.kind !== notice.kind),
      Object.freeze(merged),
    ].slice(-MAX_RETAINED_NOTICES));
  }

  private teardownNarrative(): void {
    this.pendingConsequencePublication = null;
    const owners = this.owners;
    this.owners = null;
    if (owners === null) return;
    owners.unsubscribeDirector();
    owners.recovery?.dispose();
    owners.director.dispose();
    owners.model.dispose();
  }

  private bindIngress(): void {
    this.unsubscribeIngress = this.ingress.subscribe((batch) => {
      if (this.disposed || batch.runId !== this.run?.run_id || batch.sourceKey !== this.sourceKey) return;
      this.lifetimeAcceptedCount += batch.entries.length;
      const moments = new BeatDirector().group(batch.entries);
      const pressureCountBefore = this.owners?.director.diagnostics().retainedPressureSummaries ?? 0;
      if (this.hidden) this.accumulateHiddenEvidence(moments);
      // `ingest` throws on a cursor discontinuity, and this callback runs inside
      // `PresentationIngress`'s deliberate observer-isolation catch -- so an unguarded throw is
      // DISCARDED while `lifetimeAcceptedCount` above keeps climbing. Measured live: that read
      // as a healthy transport over a presentation that had stopped for good. The refusal is now
      // counted and named. It is not rethrown: the isolation catch would only eat it again.
      try {
        this.owners?.director.ingest(moments);
      } catch (error) {
        this.refusedBatchCount = Math.min(Number.MAX_SAFE_INTEGER, this.refusedBatchCount + 1);
        this.lastRefusedBatch = Object.freeze({
          firstCursor: batch.firstCursor,
          lastCursor: batch.lastCursor,
          reason: error instanceof Error ? error.message : String(error),
        });
        this.emit();
        return;
      }
      const pressureCountAfter = this.owners?.director.diagnostics().retainedPressureSummaries ?? 0;
      if (!this.hidden && pressureCountAfter > pressureCountBefore) {
        const digest = this.visiblePressureDigest();
        if (digest !== null) void this.triggerRecovery("queue-overflow", digest);
      }
    });
  }

  private bindFeed(): void {
    if (this.feed === null) return;
    this.unsubscribeCheckpoint = this.feed.subscribe((record) => {
      if (
        this.disposed
        || this.recoveryLocked
        || record.checkpoint.run_id !== this.run?.run_id
      ) return;
      this.ingress.onCheckpointAccepted(record);
      const disposition = this.owners?.director.acceptCheckpoint(record);
      if (disposition === "overflow") {
        void this.triggerRecovery("queue-overflow", this.digestAfterFrame());
      }
    });
    this.unsubscribeCheckpointFault = this.feed.subscribeFault((fault) => {
      if (this.disposed || this.recoveryLocked) return;
      if (fault.kind === "run-mismatch") {
        this.beginRunReplacement();
      } else if (fault.kind === "oversized-record") {
        void this.triggerRecovery("checkpoint-413", this.digestAfterFrame());
      } else {
        this.owners?.director.acceptIngressFault(fault);
      }
    });
  }

  private openStream(cursor: number, candidate: number): void {
    if (this.client === null || !this.isCurrent(candidate)) return;
    this.closeStream();
    let opened: EventStream | null = null;
    opened = this.client.openEventStream(cursor, {
      onEnvelope: async (envelope) => {
        if (!this.isCurrent(candidate) || this.stream !== opened) return;
        await this.acceptEnvelope(envelope, candidate);
      },
      onHeartbeat: (heartbeat) => {
        if (!this.isCurrent(candidate) || this.stream !== opened) return;
        this.lastSignalAtMs = this.clock.now();
        this.lastSignalWasHeartbeat = true;
        this.heartbeatWorldTime = heartbeat.worldTime;
        this.rejoinAttempt = 0;
        // The keepalive reports the run's own lifecycle, which is the only way a
        // watcher learns a run ENDED while they were watching: the sim
        // self-terminates at `duration` and `/api/run` is fetched once, at join.
        if (this.run !== null && isRunStatus(heartbeat.status) && heartbeat.status !== this.run.status) {
          this.run = { ...this.run, status: heartbeat.status };
        }
        this.publishObserverFrame("live", false);
      },
      onError: () => {
        if (!this.isCurrent(candidate) || this.stream !== opened) return;
        this.closeStream();
        this.publishObserverFrame("offline", true);
        this.scheduleRejoin(candidate);
      },
    });
    this.stream = opened;
    this.publishObserverFrame("live", false);
  }

  /**
   * Reopens a dropped stream after a capped exponential backoff.
   *
   * Mutates `rejoinAttempt`/`cancelRejoin` and, on the scheduled turn, reopens the
   * transport at the cursor already ingested. Nothing is re-fetched: a stream error
   * is a transport fact, not a world fact, and a rejoin at the same cursor either
   * resumes cleanly or reports overflow, which the recovery path already owns.
   */
  private scheduleRejoin(candidate: number): void {
    if (this.disposed || this.client === null || this.source !== "live") return;
    if (this.cancelRejoin !== null || this.recoveryLocked) return;
    const step = Math.min(this.rejoinAttempt, REJOIN_BACKOFF_MAX_STEPS);
    this.rejoinAttempt = step + 1;
    const delayMs = Math.min(REJOIN_BACKOFF_BASE_MS * 2 ** step, REJOIN_BACKOFF_MAX_MS);
    this.cancelRejoin = this.clock.schedule(this.clock.now() + delayMs, () => {
      this.cancelRejoin = null;
      if (!this.isCurrent(candidate) || this.recoveryLocked || this.stream !== null) return;
      const cursor = this.frame?.transport.ingestedCursor ?? this.frame?.lastCursor;
      if (cursor === undefined) return;
      this.publishObserverFrame("rejoining", true);
      this.openStream(cursor, candidate);
    });
  }

  private cancelScheduledRejoin(): void {
    this.cancelRejoin?.();
    this.cancelRejoin = null;
    this.cancelFrozenRetry?.();
    this.cancelFrozenRetry = null;
    this.cancelRunReplacementRetry?.();
    this.cancelRunReplacementRetry = null;
  }

  /**
   * Freezes the old run while resolving the checkpoint feed's changed identity.
   *
   * A run-mismatch stops checkpoint polling, while an existing SSE connection can
   * keep heartbeating its old stopped simulation forever. The session therefore
   * owns discovering and installing the replacement, including transient failures.
   */
  private beginRunReplacement(): void {
    if (this.client === null || this.source !== "live" || this.runReplacementPending) return;
    this.runReplacementPending = true;
    this.cancelScheduledRejoin();
    this.closeStream();
    const candidate = this.generation;
    this.publishObserverFrame("recovery-paused", true);
    if (!this.isCurrent(candidate) || !this.runReplacementPending) return;
    this.beginRecoveryFreeze();
    this.owners?.director.setPaused(true);
    void this.refreshRunReplacement(candidate);
  }

  /** Installs only matching replacement truth; retries races and failures with capped backoff. */
  private async refreshRunReplacement(candidate: number): Promise<void> {
    const client = this.client;
    if (client === null || !this.isCurrent(candidate) || !this.runReplacementPending) return;
    try {
      const run = await client.getRun();
      if (!this.isCurrent(candidate)) return;
      if (run.run_id !== this.run?.run_id) {
        const world = await client.getWorld();
        if (!this.isCurrent(candidate)) return;
        if (world.run_id === run.run_id) {
          this.replaceRun(run, world);
          return;
        }
      }
    } catch {
      // Retry failed requests or replacement preparation while this attempt still owns the session.
    }
    if (!this.isCurrent(candidate) || !this.runReplacementPending) return;
    const step = Math.min(this.runReplacementAttempt, REJOIN_BACKOFF_MAX_STEPS);
    this.runReplacementAttempt = step + 1;
    const delayMs = Math.min(REJOIN_BACKOFF_BASE_MS * 2 ** step, REJOIN_BACKOFF_MAX_MS);
    this.cancelRunReplacementRetry = this.clock.schedule(this.clock.now() + delayMs, () => {
      this.cancelRunReplacementRetry = null;
      void this.refreshRunReplacement(candidate);
    });
  }

  /**
   * Un-latches a `frozen-retry` recovery after a capped exponential backoff.
   *
   * Mutates `frozenRetryAttempt`/`cancelFrozenRetry`; on the scheduled turn it
   * re-fetches `/api/run` before retrying, because recovery only ever re-fetched
   * `/api/world` — so a run that restarted under the observer left it frozen
   * forever and the HUD's own retry button failed identically.
   */
  private scheduleFrozenRetry(candidate: number): void {
    if (this.disposed || this.client === null || this.source !== "live") return;
    if (this.cancelFrozenRetry !== null) return;
    const step = Math.min(this.frozenRetryAttempt, REJOIN_BACKOFF_MAX_STEPS);
    this.frozenRetryAttempt = step + 1;
    const delayMs = Math.min(REJOIN_BACKOFF_BASE_MS * 2 ** step, REJOIN_BACKOFF_MAX_MS);
    this.cancelFrozenRetry = this.clock.schedule(this.clock.now() + delayMs, () => {
      this.cancelFrozenRetry = null;
      if (!this.isCurrent(candidate)) return;
      if (this.owners?.recovery?.getSnapshot().status !== "frozen-retry") return;
      void this.retryFrozenRecovery(candidate);
    });
  }

  /** Re-reads run metadata, adopts a new run if there is one, then retries once. */
  private async retryFrozenRecovery(candidate: number): Promise<void> {
    const client = this.client;
    if (client === null) return;
    try {
      const run = await client.getRun();
      if (!this.isCurrent(candidate)) return;
      if (run.run_id !== this.run?.run_id) {
        const world = await client.getWorld();
        if (!this.isCurrent(candidate) || world.run_id !== run.run_id) return;
        this.frozenRetryAttempt = 0;
        this.replaceRun(run, world);
        return;
      }
      // Same run, but its lifecycle may have moved on while we were frozen.
      this.run = structuredClone(run);
    } catch {
      if (this.isCurrent(candidate)) this.scheduleFrozenRetry(candidate);
      return;
    }
    try {
      await this.retryRecovery();
    } catch {
      // A rejected retry is reported through the coordinator's own state below.
    }
    if (!this.isCurrent(candidate)) return;
    if (this.owners?.recovery?.getSnapshot().status === "frozen-retry") {
      this.scheduleFrozenRetry(candidate);
    } else {
      this.frozenRetryAttempt = 0;
    }
  }

  private async acceptEnvelope(envelope: EventEnvelope, candidate: number): Promise<void> {
    if (!this.isCurrent(candidate)) return;
    // Any envelope proves the socket is alive and the world is speaking, so it both
    // stamps liveness and clears the rejoin backoff a previous drop had wound up.
    this.lastSignalAtMs = this.clock.now();
    this.lastSignalWasHeartbeat = false;
    this.rejoinAttempt = 0;
    if (envelope.overflow || envelope.snapshot_required) {
      this.closeStream();
      await this.triggerRecovery("queue-overflow", this.digestFromEnvelope(envelope));
      return;
    }
    const ingressBefore = this.ingress.getSnapshot();
    const faultsBefore = ingressBefore.gaps.length;
    this.lifetimeDuplicateCount += envelope.events.filter(
      ({ cursor }) => cursor <= ingressBefore.ingestedCursor,
    ).length;
    this.ingress.onEnvelopeAccepted(envelope);
    const ingressAfter = this.ingress.getSnapshot();
    this.canonical.acceptEnvelope(envelope);
    const faults = ingressAfter.gaps.slice(faultsBefore);
    const gap = faults.find((fault) => fault.kind === "cursor-gap");
    if (gap !== undefined) {
      await this.triggerRecovery("cursor-gap", {
        skipped: {
          firstCursor: this.getFrame().lastCursor + 1,
          lastCursor: Math.max(gap.lastMissingCursor, this.getFrame().lastCursor + 1),
        },
        majorMoments: [],
        compressedAmbientCount: Math.max(1, gap.lastMissingCursor - gap.firstMissingCursor + 1),
      });
      return;
    }
    this.publishObserverFrame("live", false);
  }

  private triggerRecovery(reason: RecoveryReason, digest: RecoveryDigest): Promise<void> {
    if (this.disposed || this.owners?.recovery === null || this.owners === null) {
      return Promise.resolve();
    }
    if (this.recoveryPromise !== null) return this.recoveryPromise;
    // Say so BEFORE freezing. A recovery closes the transport and stops publishing;
    // measured, that left the chrome reading "Caught up / live" for 185s while 265
    // envelopes went into a void. The freeze must land on an honest frame.
    this.publishObserverFrame("recovery-paused", true);
    this.cancelScheduledRejoin();
    this.beginRecoveryFreeze();
    this.closeStream();
    if (this.held) {
      this.held = false;
      this.owners.director.holdCurrentMoment(false);
    }
    const resumeForSafeBoundary = this.owners.director.getSnapshot().paused
      && this.owners.settlement.getSnapshot().sceneToken !== null;
    const candidate = this.generation;
    const input = {
      reason,
      digest: normalizeDigest(digest, this.getFrame()),
      identity: identityOf(this.getFrame()),
    };
    const recovery = this.owners.recovery;
    const before = recovery.getSnapshot();
    const attempt = recovery.recover(input);
    if (recovery.getSnapshot() !== before) this.emit();
    const pending = attempt.then(
      () => {
        const recoveryState = recovery.getSnapshot();
        const completed = recoveryState.status === "complete";
        if (completed && this.isCurrent(candidate)) {
          this.lastCompletedRecovery = completedRecoveryReceipt(reason, recoveryState);
        }
        this.finishRecovery(candidate);
        if (!completed && this.isCurrent(candidate)) this.emit();
        this.rescheduleFrozenRetryIfLatched(candidate);
      },
      () => {
        if (this.isCurrent(candidate)) this.emit();
        this.rescheduleFrozenRetryIfLatched(candidate);
      },
    ).finally(() => {
      if (this.recoveryPromise === pending) this.recoveryPromise = null;
    });
    this.recoveryPromise = pending;
    if (resumeForSafeBoundary) this.owners.director.setPaused(false);
    return pending;
  }

  /** Arms the un-latch clock whenever a recovery attempt left the session frozen. */
  private rescheduleFrozenRetryIfLatched(candidate: number): void {
    if (!this.isCurrent(candidate)) return;
    if (this.owners?.recovery?.getSnapshot().status !== "frozen-retry") return;
    this.scheduleFrozenRetry(candidate);
  }

  private finishRecovery(candidate: number): void {
    if (!this.isCurrent(candidate) || this.owners?.recovery === null || this.owners === null) return;
    const recovery = this.owners.recovery.getSnapshot();
    if (recovery.status !== "complete") return;
    const snapshot = this.recoverySnapshot;
    if (snapshot === null || snapshot.run_id !== this.run?.run_id) return;
    const recoveredIdentity = identityOf(this.getFrame());
    this.canonical.acceptSnapshot(snapshot);
    this.ingress.reset({ runId: snapshot.run_id, sourceKey: this.sourceKey, cursor: snapshot.event_cursor });
    this.feed?.reset({ runId: snapshot.run_id, sourceKey: this.sourceKey });
    this.recoverySnapshot = null;
    this.teardownNarrative();
    this.buildNarrative(snapshot, recoveredIdentity);
    this.openStream(snapshot.event_cursor, candidate);
    this.clearRecoveryFreeze();
    this.emit();
  }

  private publishRecovery(publication: RecoveryPublication): RecoveryPublicationReceipt {
    if (this.disposed) return { status: "rejected", publicationSerial: 0 };
    const beforeSerial = this.sink.getSnapshot().publicationSerial;
    const serial = this.sink.publish(publication.frame);
    const accepted = this.sink.getSnapshot().frame;
    if (accepted !== null) this.frame = accepted;
    this.emit();
    const retained = this.sink.getSnapshot();
    if (serial === beforeSerial) {
      return { status: "rejected", publicationSerial: Math.max(1, serial) };
    }
    this.gaps = retainGap(this.gaps, publication.gap);
    this.refreshRecoveryChronicle();
    if (retained.frame !== null && sameFrameIdentity(retained.frame, publication.frame)) {
      this.lastPublicationWorld = publication.frame.world;
      this.lastPublicationKey = semanticPublicationKey(publication.frame);
      return {
        status: "committed",
        publicationSerial: serial,
        identity: identityOf(retained.frame),
      };
    }
    return { status: "superseded", publicationSerial: serial };
  }

  private publishObserverFrame(
    connection?: PresentedObserverFrame["transport"]["connection"],
    retryable?: boolean,
    identityOverride?: FrameIdentity,
    sceneOverride?: PresentedSceneView | null,
    modelOverride?: PresentedWorldModel,
    directorOverride?: StoryDirector,
    recoveryAuthorized = false,
  ): void {
    if (this.disposed || this.owners === null && (modelOverride === undefined || directorOverride === undefined)) return;
    if (this.recoveryLocked && !recoveryAuthorized) return;
    // Transport is OWNED, not re-asserted per publication. It used to default to
    // "live" on every call, so the director's own `subscribe(() => publish())` — which
    // fires on every scene tick — silently repainted a dead socket as live within
    // milliseconds of `onError` publishing "offline". Only a caller with real evidence
    // about the transport passes a value; everyone else keeps what is true.
    if (connection !== undefined) {
      this.connectionState = connection;
      this.connectionRetryable = retryable ?? false;
    }
    // A consequence frame is retained at an EXACT revision until Canvas accepts
    // it, and acceptance is a frame later. The overlay lane publishes whenever
    // words arrive, which since the two-lane split can be inside that window —
    // and a frame published there replaces the retained one and fails the
    // barrier ("consequence frame was not retained at its exact revision").
    // Nothing is lost by waiting: the frame carries a rolling window of the
    // newest utterances, so the next publication still raises them.
    if (this.pendingConsequencePublication !== null && identityOverride === undefined) return;
    const model = modelOverride ?? this.owners!.model;
    const director = directorOverride ?? this.owners!.director;
    const directorState = director.getSnapshot();
    const settlementState = this.owners?.settlement.getSnapshot();
    if (
      identityOverride === undefined
      && this.recoveryPromise !== null
      && settlementState?.consequenceCommitted === true
      && settlementState.publishedRevision !== null
      && settlementState.publishedRevision === this.frame?.revision
    ) return;
    let identity = identityOverride ?? {
      ...identityOfOrInitial(this.frame, directorState.identity),
      revision: this.nextRevision(),
    };
    const active = directorState.activeMoment;
    if (
      identityOverride === undefined
      && active !== null
      && (identity.firstCursor !== active.firstCursor || identity.lastCursor !== active.lastCursor)
    ) {
      identity = {
        ...identity,
        firstCursor: active.firstCursor,
        lastCursor: active.lastCursor,
      };
    }
    const rawScene = sceneOverride !== undefined
      ? sceneOverride
      : directorState.activeScene;
    const scene = rawScene === null
      ? null
      : attachSceneExecution(
          rawScene,
          this.sceneTokenAllocator.resolve(
            this.narrativeGeneration,
            directorState.activeSceneToken,
          ),
          directorState.activeProgramId,
          presentedEventType(directorState.activeMoment?.representative.event.type),
        );
    const next: PresentedObserverFrame = {
      ...identity,
      source: this.source,
      ingestedCursor: this.source === "live"
        ? Math.max(directorState.ingestedCursor, this.ingress.getSnapshot().ingestedCursor)
        : directorState.ingestedCursor,
      presentedCursor: directorState.presentedCursor,
      world: model.getView(),
      scene,
      utterances: directorState.utterances,
      staging: directorState.staging,
      checkpointFocus: directorState.checkpointHold?.focusTarget ?? null,
      selection: this.selection,
      backlog: directorState.backlog,
      transport: {
        connection: this.source === "archive" ? "offline" : this.connectionState,
        ingestedCursor: this.source === "live"
          ? Math.max(directorState.ingestedCursor, this.ingress.getSnapshot().ingestedCursor)
          : directorState.ingestedCursor,
        retryable: this.connectionRetryable,
      },
      notices: this.notices,
      liveness: this.livenessState(),
      ...(this.run === null ? {} : { inference: { provider: this.run.provider, model: this.run.model } }),
    };
    const publicationKey = semanticPublicationKey(next);
    if (
      this.lastPublicationWorld === next.world
      && this.lastPublicationKey === publicationKey
    ) return;
    this.sink.publish(next);
    const accepted = this.sink.getSnapshot().frame;
    if (accepted !== null && sameFrameIdentity(accepted, next)) {
      this.frame = accepted;
      this.lastPublicationWorld = next.world;
      this.lastPublicationKey = publicationKey;
    }
    if (recoveryAuthorized) this.refreshRecoveryChronicle();
    this.emit();
  }

  private rawChronicle(): SanitizedChronicleData {
    const state = this.owners?.director.getSnapshot();
    const upcoming: RedactedUpcomingMoment[] = (state?.pending ?? [])
      .filter((moment) => isPendingMomentVisible(moment, this.selection))
      .map((moment) => ({
        sequence: moment.firstCursor,
        regionId: regionFor(moment),
        urgency: moment.priority,
      }));
    return {
      now: state?.activeMoment ?? null,
      previous: this.previous,
      upcoming,
      gaps: this.gaps,
    };
  }

  /**
   * Takes the viewer to one moment: selects it, and anchors it in the world.
   *
   * Selecting used to be ALL this did, which is why every Chronicle card that
   * was not the moment on stage was a dead click -- the renderer's only way to
   * resolve a moment focus was against the scene it was playing right then. The
   * selection now carries a {@link MomentAnchor}: where the moment happened, and
   * whether it is still the live edge. That is presentation knowledge (only this
   * object still holds the moment), so this is where it is resolved.
   *
   * Mutates the selection and, when the moment cannot be reached, `notices`.
   * Publishes an observer frame either way -- a viewer who clicked and got
   * nothing is the exact defect this path exists to end.
   */
  private viewMoment(momentId: string): void {
    const active = this.owners?.director.getSnapshot().activeMoment ?? null;
    const moment = [active, ...this.previous]
      .find((candidate) => candidate?.id === momentId) ?? null;
    if (moment === null) {
      this.publishUnreachableMoment(FORGOTTEN_MOMENT_NOTICE, null, null);
      return;
    }
    const anchor = momentAnchor(moment, active, this.previous);
    if (!anchor.atLiveEdge && anchor.entity === null && anchor.regionId === null) {
      this.publishUnreachableMoment(
        PLACELESS_MOMENT_NOTICE,
        moment.firstCursor,
        moment.lastCursor,
      );
    } else if (this.retireUnreachableMoment()) {
      // The retirement has to reach the viewer even when the selection itself
      // does not change -- clicking the same card twice -- which `select`
      // deduplicates away before it would publish anything.
      this.publishObserverFrame();
    }
    this.select({
      kind: "moment",
      id: moment.id,
      firstCursor: moment.firstCursor,
      lastCursor: moment.lastCursor,
      anchor,
    });
  }

  /**
   * Resolves one event cursor to the moment that carries it, and views it.
   *
   * Reached only when the shell's own Chronicle rows did not cover the cursor --
   * a card whose moment has already been evicted. Says so rather than returning
   * silently, because a dead click with no explanation is indistinguishable from
   * a broken one.
   *
   * Mutates the selection or `notices`; publishes an observer frame.
   */
  private viewCursor(cursor: number): void {
    const active = this.owners?.director.getSnapshot().activeMoment ?? null;
    const moment = [active, ...this.previous].find((candidate) => candidate !== null
      && candidate.firstCursor <= cursor && cursor <= candidate.lastCursor) ?? null;
    if (moment === null) {
      this.publishUnreachableMoment(FORGOTTEN_MOMENT_NOTICE, cursor, cursor);
      return;
    }
    this.viewMoment(moment.id);
  }

  /** Retains the unreachable-moment notice and publishes it on its own frame. */
  private publishUnreachableMoment(
    detail: string,
    firstCursor: number | null,
    lastCursor: number | null,
  ): void {
    if (this.disposed) return;
    this.retainNotice({ kind: "unreachable-moment", detail, firstCursor, lastCursor, count: 1 });
    this.publishObserverFrame();
  }

  /**
   * Drops the unreachable-moment notice once a later request has succeeded.
   *
   * The other two notice kinds count faults the run absorbed and are meant to
   * accumulate; this one describes the click a viewer just made, so leaving it
   * standing over a navigation that worked would be its own small lie.
   */
  private retireUnreachableMoment(): boolean {
    if (!this.notices.some((notice) => notice.kind === "unreachable-moment")) return false;
    this.notices = Object.freeze(
      this.notices.filter((notice) => notice.kind !== "unreachable-moment"),
    );
    return true;
  }

  private publishWhileAwayGap(): void {
    const first = this.hiddenStartCursor === null ? null : this.hiddenStartCursor + 1;
    const last = this.frame?.ingestedCursor ?? null;
    this.hiddenStartCursor = null;
    if (first === null || last === null || first > last) return;
    this.gaps = retainGap(this.gaps, {
      firstCursor: first,
      lastCursor: last,
      chapter: "while-away",
      archiveAvailable: true,
    });
    this.emit();
  }

  private digestFromEnvelope(envelope: EventEnvelope): RecoveryDigest {
    const firstCursor = this.getFrame().lastCursor + 1;
    const lastCursor = Math.max(firstCursor, envelope.next_cursor, envelope.oldest_cursor);
    return {
      skipped: { firstCursor, lastCursor },
      majorMoments: [],
      compressedAmbientCount: lastCursor - firstCursor + 1,
    };
  }

  private digestAfterFrame(): RecoveryDigest {
    const cursor = this.getFrame().lastCursor + 1;
    return {
      skipped: { firstCursor: cursor, lastCursor: cursor },
      majorMoments: [],
      compressedAmbientCount: 1,
    };
  }

  private digestThroughIngestedCursor(): RecoveryDigest {
    const firstCursor = this.getFrame().lastCursor + 1;
    const lastCursor = Math.max(firstCursor, this.ingress.getSnapshot().ingestedCursor);
    return {
      skipped: { firstCursor, lastCursor },
      majorMoments: [],
      compressedAmbientCount: lastCursor - firstCursor + 1,
    };
  }

  private hiddenPressureDigest(): RecoveryDigest | null {
    const hidden = this.hiddenEvidence;
    this.hiddenEvidence = null;
    if (hidden === null || hidden.momentCount <= 48) return null;
    const firstCursor = this.getFrame().lastCursor + 1;
    const lastCursor = Math.max(firstCursor, hidden.lastCursor);
    return {
      skipped: { firstCursor, lastCursor },
      majorMoments: [...hidden.majorCounts].map(([type, count]) => ({ type, count })),
      compressedAmbientCount: hidden.ambientCount,
    };
  }

  private pendingHiddenEvidence(): HiddenEvidenceDigest | null {
    const state = this.owners?.director.getSnapshot();
    if (state === undefined) return null;
    const presentedCursor = this.getFrame().lastCursor;
    let digest: HiddenEvidenceDigest | null = null;
    for (const summary of state.pressureSummaries) {
      if (summary.firstCursor <= presentedCursor) continue;
      digest ??= {
        firstCursor: summary.firstCursor,
        lastCursor: summary.lastCursor,
        momentCount: 0,
        ambientCount: 0,
        majorCounts: new Map<PresentedEventType, number>(),
      };
      digest.lastCursor = Math.max(digest.lastCursor, summary.lastCursor);
      digest.ambientCount += summary.ambientCount;
      digest.momentCount += summary.ambientCount;
      for (const item of summary.majorDigest) {
        digest.majorCounts.set(
          item.eventType,
          (digest.majorCounts.get(item.eventType) ?? 0) + item.count,
        );
        digest.momentCount += item.count;
      }
    }
    const pending = state.pending.filter((moment) => moment.lastCursor > presentedCursor);
    if (pending.length > 0) {
      digest ??= {
        firstCursor: pending[0].firstCursor,
        lastCursor: pending[0].lastCursor,
        momentCount: 0,
        ambientCount: 0,
        majorCounts: new Map<PresentedEventType, number>(),
      };
      this.accumulateMomentsInto(digest, pending);
    }
    return digest;
  }

  private visiblePressureDigest(): RecoveryDigest | null {
    const state = this.owners?.director.pressureState();
    if (state === undefined || state.pressureSummaries.length === 0) return null;
    const majorCounts = new Map<PresentedEventType, number>();
    let compressedAmbientCount = 0;
    for (const summary of state.pressureSummaries) {
      compressedAmbientCount += summary.ambientCount;
      for (const item of summary.majorDigest) {
        majorCounts.set(item.eventType, (majorCounts.get(item.eventType) ?? 0) + item.count);
      }
    }
    for (const moment of state.pending) {
      if (moment.priority === "ambient") {
        compressedAmbientCount += 1;
        continue;
      }
      const type = moment.representative.event.type;
      if (!PRESENTED_EVENT_TYPES.has(type)) {
        compressedAmbientCount += 1;
        continue;
      }
      const typed = type as PresentedEventType;
      majorCounts.set(typed, (majorCounts.get(typed) ?? 0) + 1);
    }
    const firstCursor = this.getFrame().lastCursor + 1;
    const lastCursor = Math.max(firstCursor, this.ingress.getSnapshot().ingestedCursor);
    return {
      skipped: { firstCursor, lastCursor },
      majorMoments: [...majorCounts].map(([type, count]) => ({ type, count })),
      compressedAmbientCount,
    };
  }

  private accumulateHiddenEvidence(moments: readonly StoryMoment[]): void {
    const presentedCursor = this.getFrame().lastCursor;
    const unpresented = moments.filter((moment) => moment.lastCursor > presentedCursor);
    if (unpresented.length === 0) return;
    const existing = this.hiddenEvidence;
    const digest: HiddenEvidenceDigest = existing ?? {
      firstCursor: unpresented[0].firstCursor,
      lastCursor: unpresented[0].lastCursor,
      momentCount: 0,
      ambientCount: 0,
      majorCounts: new Map<PresentedEventType, number>(),
    };
    this.accumulateMomentsInto(digest, unpresented);
    this.hiddenEvidence = digest;
  }

  private accumulateMomentsInto(
    digest: HiddenEvidenceDigest,
    moments: readonly StoryMoment[],
  ): void {
    for (const moment of moments) {
      digest.lastCursor = moment.lastCursor;
      digest.momentCount += 1;
      if (moment.priority === "ambient") {
        digest.ambientCount += 1;
        continue;
      }
      const type = moment.representative.event.type;
      if (!PRESENTED_EVENT_TYPES.has(type)) {
        digest.ambientCount += 1;
        continue;
      }
      const typed = type as PresentedEventType;
      digest.majorCounts.set(typed, (digest.majorCounts.get(typed) ?? 0) + 1);
    }
  }

  private beginRecoveryFreeze(): void {
    this.recoveryLocked = true;
    this.recoveryChronicle = selectPresentedChronicle(
      this.getFrame(),
      this.rawChronicle(),
    );
  }

  private refreshRecoveryChronicle(): void {
    if (!this.recoveryLocked || this.frame === null) return;
    this.recoveryChronicle = selectPresentedChronicle(
      this.frame,
      this.rawChronicle(),
    );
  }

  private clearRecoveryFreeze(): void {
    this.recoveryLocked = false;
    this.recoveryChronicle = null;
  }

  private closeStream(): void {
    this.stream?.close();
    this.stream = null;
  }

  private nextRevision(): number {
    const next = (this.frame?.revision ?? 0) + 1;
    if (!Number.isSafeInteger(next)) throw new RangeError("presentation revision overflow");
    return next;
  }

  private isCurrent(candidate: number): boolean {
    return !this.disposed && candidate === this.generation;
  }

  private emit(): void {
    this.pendingNotifications += 1;
    if (this.notifying || this.disposed) return;
    this.notifying = true;
    try {
      while (this.pendingNotifications > 0 && !this.disposed) {
        this.pendingNotifications -= 1;
        for (const listener of [...this.listeners]) {
          if (this.disposed) break;
          try {
            listener();
          } catch {
            // One consumer cannot prevent peers from observing the selected frame.
          }
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

function completedRecoveryReceipt(
  reason: RecoveryReason,
  recovery: Extract<RecoveryCoordinatorState, { status: "complete" }>,
): CompletedRecoveryReceipt {
  return Object.freeze({
    reason,
    digest: Object.freeze({
      skipped: Object.freeze({ ...recovery.digest.skipped }),
      majorMoments: Object.freeze(recovery.digest.majorMoments.map((moment) => (
        Object.freeze({ ...moment })
      ))),
      compressedAmbientCount: recovery.digest.compressedAmbientCount,
    }),
    snappedCursor: recovery.snappedCursor,
  });
}

function wrapPlacement(
  placement: RecoveryPlacementPort,
  onSnapshot: (snapshot: WorldSnapshot) => void,
): RecoveryPlacementPort {
  if ("prepareFromSnapshot" in placement) {
    const snapshots = new Map<PreparedRecoveryPlacement, WorldSnapshot>();
    return {
      prepareFromSnapshot(snapshot): PreparedRecoveryPlacement {
        const prepared = placement.prepareFromSnapshot(snapshot);
        snapshots.set(prepared, structuredClone(snapshot));
        return prepared;
      },
      commitPrepared(prepared): void {
        placement.commitPrepared(prepared);
        const snapshot = snapshots.get(prepared);
        if (snapshot !== undefined) onSnapshot(snapshot);
      },
      rollbackPrepared(prepared): void {
        placement.rollbackPrepared(prepared);
        snapshots.delete(prepared);
      },
      dispose(): void {
        snapshots.clear();
        placement.dispose?.();
      },
    };
  }
  return {
    replaceFromSnapshot(snapshot): void {
      placement.replaceFromSnapshot(snapshot);
      onSnapshot(snapshot);
    },
    dispose(): void {
      placement.dispose?.();
    },
  };
}

function isPlacementGenerationOwner(
  placement: PreparedRecoveryPlacementPort | null,
): placement is PlacementGenerationOwner {
  return placement !== null
    && "ownerId" in placement
    && typeof placement.ownerId === "symbol"
    && "current" in placement
    && typeof placement.current === "function"
    && "snapshot" in placement
    && typeof placement.snapshot === "function"
    && "recipes" in placement
    && typeof placement.recipes === "function";
}

function requireSpatialGetter<T>(
  getter: (() => T) | undefined,
  label: string,
): () => T {
  if (getter === undefined) throw new Error(`legacy ${label} getter is required`);
  return getter;
}

function hasPlacementOwnerId(
  context: PresentationChoreographySpatialContext,
): context is PresentationChoreographySpatialContext & {
  getPlacementOwnerId(): symbol;
} {
  return "getPlacementOwnerId" in context
    && typeof context.getPlacementOwnerId === "function";
}

function thresholdsFrom(run: RunMetadata | null): PresentedHoardThresholds | undefined {
  if (run === null) return undefined;
  const energy = run.constants.hoarding_energy_threshold;
  const materials = run.constants.hoarding_materials_threshold;
  if (
    typeof energy !== "number"
    || !Number.isFinite(energy)
    || energy < 0
    || typeof materials !== "number"
    || !Number.isFinite(materials)
    || materials < 0
  ) return undefined;
  return {
    hoarding_energy_threshold: energy,
    hoarding_materials_threshold: materials,
  };
}

function syntheticRun(snapshot: WorldSnapshot): RunMetadata {
  return {
    schema: 1,
    run_id: snapshot.run_id,
    seed: 0,
    started_at: snapshot.world_time,
    status: "stopped",
    event_cursor: snapshot.event_cursor,
    world_time: snapshot.world_time,
    config_hash: "presentation-session",
    constants: {},
    // A recorded or fixture run is watched with no `/api/run` at all, so the run's
    // default birth words come from the snapshot, which states them itself.
    seed_persona: snapshot.seed_persona ?? null,
    provider: "presentation-session",
    model: "presentation-session",
    context_window: null,
    timing: {},
    artifacts: {
      events: "",
      usage: "",
      snapshots: "",
      memory_root: "",
    },
  };
}

/**
 * Where a moment happened and whether it is still the present tense.
 *
 * `focus` is the moment's own subject as the director resolved it, so an agent
 * / home / ruin focus gives an exact anchor and a region or system focus gives
 * only the place. `regionFor` already knows how to read a place out of every
 * focus kind and out of the representative event, so it is reused verbatim.
 */
function momentAnchor(
  moment: StoryMoment,
  activeMoment: StoryMoment | null,
  previous: readonly StoryMoment[],
): MomentAnchor {
  const focus = moment.focus;
  const entity = focus.kind === "agent" || focus.kind === "home" || focus.kind === "ruin"
    ? Object.freeze({ kind: focus.kind, id: focus.id })
    : null;
  return Object.freeze({
    entity,
    regionId: regionFor(moment),
    atLiveEdge: activeMoment === null
      ? newestMomentId(previous) === moment.id
      : activeMoment.id === moment.id,
  });
}

/**
 * The newest moment the Chronicle still keeps, by the same ordering the shell's
 * own "latest" cue uses: furthest cursor first, then time, then start.
 */
function newestMomentId(previous: readonly StoryMoment[]): string | null {
  return previous.reduce<StoryMoment | null>((current, moment) => {
    if (current === null) return moment;
    if (moment.lastCursor !== current.lastCursor) {
      return moment.lastCursor > current.lastCursor ? moment : current;
    }
    return moment.firstCursor > current.firstCursor ? moment : current;
  }, null)?.id ?? null;
}

function regionFor(moment: StoryMoment): string | null {
  if (moment.focus.kind === "region") return moment.focus.id;
  if (moment.focus.kind === "system") return moment.focus.regionId;
  return moment.representative.resolved.region ?? moment.representative.event.region;
}

function retainGap(
  gaps: readonly PresentationGap[],
  gap: PresentationGap,
): PresentationGap[] {
  const duplicate = gaps.some((candidate) => (
    candidate.firstCursor === gap.firstCursor
    && candidate.lastCursor === gap.lastCursor
    && candidate.chapter === gap.chapter
  ));
  return duplicate ? [...gaps] : [...gaps, Object.freeze({ ...gap })].slice(-MAX_GAPS);
}

function identityOf(frame: PresentedObserverFrame): FrameIdentity {
  return {
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  };
}

function sameFrameIdentity(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function isRunStatus(value: string): value is RunMetadata["status"] {
  return (RUN_STATUSES as readonly string[]).includes(value);
}

function semanticPublicationKey(frame: PresentedObserverFrame): string {
  return JSON.stringify({
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
    source: frame.source,
    ingestedCursor: frame.ingestedCursor,
    presentedCursor: frame.presentedCursor,
    exactBaseCursor: frame.world.exactBaseCursor,
    projectedThroughCursor: frame.world.projectedThroughCursor,
    worldTime: frame.world.worldTime,
    scene: frame.scene,
    // The overlay lane can be the ONLY thing that changed between two frames --
    // a being speaking while nothing holds the stage -- and a frame deduplicated
    // away is a bubble never raised.
    utterances: (frame.utterances ?? []).map((utterance) => `${utterance.momentId}:${utterance.cursor}`),
    // Same argument as the overlay lane above: a conversational approach can be
    // the ONLY thing that changed between two frames -- a being setting off
    // toward whoever just addressed it, while the words themselves are still
    // waiting for its feet -- and a frame deduplicated away is a walk never taken.
    staging: (frame.staging ?? []).map((beat) => beat.id),
    checkpointFocus: frame.checkpointFocus ?? null,
    selection: frame.selection,
    backlog: frame.backlog,
    transport: frame.transport,
    // A newly-raised notice, or a run that just ended, can be the ONLY thing that
    // changed between two frames -- and a deduplicated frame is a silent failure.
    notices: frame.notices ?? [],
    liveness: frame.liveness ?? null,
    inference: frame.inference ?? null,
  });
}

function attachSceneExecution(
  scene: PresentedSceneView,
  sceneToken: number | null,
  programId: string | null,
  eventType: PresentedEventType | null,
): PresentedSceneView {
  if (sceneToken === null || programId === null) return scene;
  return {
    ...scene,
    execution: {
      sceneToken,
      programId,
      ...(eventType === null ? {} : { eventType }),
    },
  };
}

function presentedEventType(value: string | undefined): PresentedEventType | null {
  return value !== undefined && PRESENTED_EVENT_TYPES.has(value)
    ? value as PresentedEventType
    : null;
}

function identityOfOrInitial(
  frame: PresentedObserverFrame | null,
  fallback: FrameIdentity,
): FrameIdentity {
  return frame === null ? { ...fallback } : identityOf(frame);
}

function normalizeDigest(
  digest: RecoveryDigest,
  frame: PresentedObserverFrame,
): RecoveryDigest {
  const firstCursor = frame.lastCursor + 1;
  const lastCursor = Math.max(firstCursor, digest.skipped.lastCursor);
  const span = lastCursor - firstCursor + 1;
  const majorCount = digest.majorMoments.reduce((total, item) => total + item.count, 0);
  const compressedAmbientCount = Math.max(
    majorCount === 0 ? 1 : 0,
    Math.min(digest.compressedAmbientCount, span - Math.min(majorCount, span)),
  );
  return {
    skipped: { firstCursor, lastCursor },
    majorMoments: digest.majorMoments,
    compressedAmbientCount,
  };
}

function sameSelection(left: ObserverSelection, right: ObserverSelection): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Whether a pending (not-yet-"now") story moment is queued visibly for the
 * viewer, ahead of it becoming `chronicle.now`.
 *
 * OWNER DECISION (Safi, 2026-07-25) -- "SELF_TALK RENDERS OPENLY", recorded in
 * `.superpowers/sdd/progress.md`. This is the second, independent gate on the
 * same policy as `isMomentVisible` in `presentation/selectors.ts` (already
 * reversed there): `ScopeType.PRIVATE` only means other **beings** never
 * perceive a thought (`self_talk` is never routed to another agent's inbox).
 * The **viewer is not a being**, so a pending private self-talk moment is no
 * longer withheld from the `upcoming` queue (and, downstream, the Chronicle
 * Drawer / Atlas queued-importance pips) while awaiting a matching selection.
 *
 * The prior selection-matching gate is retained in history here, rather than
 * deleted silently, so a later reader does not "restore" it as a regression
 * fix. `selection` is intentionally still accepted (unused) so callers and
 * the exported signature stay stable if a future, genuinely-hidden pending
 * category needs this same evaluation point.
 */
export function isPendingMomentVisible(
  _moment: StoryMoment,
  _selection: ObserverSelection,
): boolean {
  return true;
}

function validateArchiveWindow(window: ReplayPresentationWindow): void {
  if (!Number.isSafeInteger(window.checkpointIndex) || window.checkpointIndex < 0) {
    throw new RangeError("Archive checkpoint index must be a non-negative safe integer");
  }
  if (
    window.checkpointLineNumber !== null
    && (
      !Number.isSafeInteger(window.checkpointLineNumber)
      || window.checkpointLineNumber < 1
    )
  ) throw new RangeError("Archive checkpoint line must be null or a positive safe integer");
  if (
    !Number.isFinite(window.checkpointWorldTime)
    || window.checkpointWorldTime !== window.snapshot.world_time
  ) throw new Error("Archive checkpoint time must equal snapshot world time");
  if (
    !Number.isSafeInteger(window.firstCursor)
    || window.firstCursor < 0
    || window.firstCursor !== window.snapshot.event_cursor
  ) throw new Error("Archive first cursor must equal the exact snapshot cursor");
  if (!Number.isSafeInteger(window.lastCursor) || window.lastCursor < window.firstCursor) {
    throw new RangeError("Archive last cursor must be a safe integer at or after the first");
  }

  let expectedCursor = window.firstCursor + 1;
  for (const entry of window.entries) {
    if (entry.cursor !== expectedCursor) {
      throw new RangeError("Archive entries must form an exact contiguous suffix");
    }
    expectedCursor += 1;
  }
  const expectedLast = window.entries.at(-1)?.cursor ?? window.firstCursor;
  if (window.lastCursor !== expectedLast) {
    throw new Error("Archive last cursor must equal the final suffix cursor");
  }
  const checkpointIdentity = window.checkpointLineNumber === null
    ? `index-${window.checkpointIndex}`
    : `line-${window.checkpointLineNumber}`;
  const expectedSource = `archive:${encodeURIComponent(window.snapshot.run_id)}:${checkpointIdentity}:window-${window.firstCursor}-${window.lastCursor}`;
  if (window.sourceKey !== expectedSource) {
    throw new Error("Archive sourceKey must exactly match checkpoint and window identity");
  }
}
