import { HttpResponseError, type EventStreamHandlers, type LiveApiClient } from "../app/client";
import {
  createProductionArchiveObserverSession,
  createProductionObserverSession,
  type ProductionArchiveObserverSessionBundle,
  type ProductionObserverSessionBundle,
} from "../app/observer2d/createProductionObserverSession";
import {
  createObserverShellRuntime,
  type ObserverShellRuntime,
} from "../app/observer2d/observerShellRuntime";
import {
  createReplayArtifactClient,
  REPLAY_EVENT_BOOTSTRAP_LIMIT,
  type ReplayArtifactClient,
} from "../app/replayArtifactClient";
import { createReplaySession } from "../app/replaySession";
import type {
  EventEnvelope,
  RunMetadata,
  WorldSnapshot,
} from "../app/schemas";
import type { CheckpointApiClient } from "../app/checkpointClient";
import {
  createCheckpointFeed,
  type CheckpointFeed,
  type CheckpointFeedScheduledTask,
  type CheckpointFeedScheduler,
} from "../presentation/CheckpointFeed";
import type { ClassifiedCheckpointRecord } from "../presentation/contracts";
import {
  chroniclePresentationSnapshot,
  getChronicleManifest,
  type ChronicleId,
  type ChronicleManifest,
} from "../presentation/fixtures/chronicleCatalog";
import {
  createFixtureTransport,
  type FixtureTransport,
} from "../presentation/fixtures/FixtureTransport";
import type { PresentationClock } from "../presentation/storyClock";
import type { CompletedRecoveryReceipt } from "../presentation/PresentationSession";
import type { SharedAtlasPool } from "../renderer2d/production/assets/SharedAtlasPool";
import type { AtlasCommitScheduler } from "../renderer2d/production/AtlasCommitScheduler";
import type { AuthoredReviewCue } from "./chronicleValidationModel";
import {
  browserValidationScheduler,
  createChronicleValidationRuntime,
  type ChroniclePlayback,
  type ChroniclePlaybackSnapshot,
  type ChronicleScenarioControlId,
  type ChronicleScenarioDriver,
  type ChronicleScenarioView,
  type ChronicleValidationRuntime,
  type ValidationScheduler,
} from "./chronicleValidationRuntime";
import {
  createC14ChronicleValidationScenario,
  createC15ChronicleValidationScenario,
  type C14ScenarioPort,
  type C15ScenarioPort,
  type ScenarioEndpoint,
} from "./chronicleValidationScenarios";

export interface ProductionComposition {
  readonly createObserverShellRuntime: typeof createObserverShellRuntime;
  readonly createProductionObserverSession: typeof createProductionObserverSession;
  readonly createProductionArchiveObserverSession: typeof createProductionArchiveObserverSession;
  readonly createFixtureTransport: typeof createFixtureTransport;
  readonly createCheckpointFeed: typeof createCheckpointFeed;
  readonly createReplayArtifactClient: typeof createReplayArtifactClient;
  readonly createReplaySession: typeof createReplaySession;
  readonly createC14ChronicleValidationScenario: typeof createC14ChronicleValidationScenario;
  readonly createC15ChronicleValidationScenario: typeof createC15ChronicleValidationScenario;
  readonly createOfflineCheckpointHarnessReceipt: (
    source: QaOfflineOwnerSource,
  ) => QaOfflineOwnerReceipt;
  readonly createOfflineLiveBridgeReceipt: (
    source: QaOfflineOwnerSource,
  ) => QaOfflineOwnerReceipt;
  readonly rendererAtlasPool?: SharedAtlasPool;
  readonly rendererAtlasCommitScheduler?: AtlasCommitScheduler;
}

export interface QaOfflineOwnerSource {
  dispose(): void;
  pendingTaskCount(): number;
}

export interface QaOfflineOwnerReceipt {
  dispose(): void;
  diagnostics(): Readonly<{ disposed: boolean; pendingTaskCount: number }>;
}

export interface ChronicleQaOwnerDiagnostics {
  readonly disposed: boolean;
  readonly observerDisposed: boolean;
  readonly transportDisposed: boolean;
  readonly replayDisposed: boolean;
  readonly checkpointFeedDisposed: boolean;
  readonly scheduledTaskCount: number;
  readonly activeListenerCount: number;
  readonly mechanicEnvelopeCount: number;
  readonly deliveredEnvelopeCursors: readonly number[];
  readonly observer: ReturnType<ObserverShellRuntime["diagnostics"]>;
  readonly staleCallback: Readonly<{
    disposition: "rejected";
    before: unknown;
    after: unknown;
  }> | null;
  readonly c14GapEvidence: Readonly<{
    firstMissingCursor: number;
    lastMissingCursor: number;
  }> | null;
}

export interface ChronicleQaObserverBinding {
  readonly generation: number;
  readonly observerRuntime: ObserverShellRuntime;
}

export interface ProductionChronicleQaOwner {
  readonly observerRuntime: ObserverShellRuntime;
  readonly validationRuntime: ChronicleValidationRuntime;
  readonly rendererAtlasPool?: SharedAtlasPool;
  readonly rendererAtlasCommitScheduler?: AtlasCommitScheduler;
  readonly ready: Promise<void>;
  getObserverBinding(): ChronicleQaObserverBinding | null;
  subscribeObserverBinding(listener: () => void): () => void;
  start(): Promise<void>;
  settle(): Promise<void>;
  runToTerminal(): Promise<void>;
  diagnostics(): ChronicleQaOwnerDiagnostics;
  /**
   * QA-only: forces (or releases) the instant `fade-reposition` movement
   * choreography for events processed while active. See the guided tour's
   * `reducedMotionOverride` for why this exists — it lets a reviewer cut away from
   * a long real-time travel animation instead of waiting through it.
   */
  setReducedMotionOverride(active: boolean): void;
  dispose(): void;
}

export interface CooperativePresentationClockScheduler {
  scheduleTurn(callback: () => void): () => void;
}

/**
 * Maximum cooperative passes one `settle()` may take before it reports failure.
 *
 * Each pass drains the pending promise set, yields one microtask, and — only while
 * the world is still not quiescent — advances the virtual presentation clock by
 * exactly one deadline. So this is simultaneously the settle-pass budget and the
 * per-settle virtual-clock turn budget.
 *
 * The value is 128, unchanged from the literal this loop has always carried; it is
 * named here because the clock now depends on it. Measured across all 42 tests of
 * `chronicleValidation.contract.test.tsx` (2026-07-31): every test but one settles
 * on its first pass and never advances the clock at all; the single exception,
 * `C-fix-2 ... steps C18 cursor-by-cursor through the Nirvana arrival`, needs 107
 * clock turns in total across its 22 `settle()` calls, and its deepest single
 * `settle()` uses 12 non-quiescent passes. So 128 carries ~10x headroom over the
 * deepest settlement this suite has ever required. Recorded rather than left
 * anonymous so the next chronicle that deepens settlement forces a conscious
 * re-derivation instead of a silent stall.
 */
const SETTLE_PASS_BUDGET = 128;

const DEFAULT_COMPOSITION: ProductionComposition = Object.freeze({
  createObserverShellRuntime,
  createProductionObserverSession,
  createProductionArchiveObserverSession,
  createFixtureTransport,
  createCheckpointFeed,
  createReplayArtifactClient,
  createReplaySession,
  createC14ChronicleValidationScenario,
  createC15ChronicleValidationScenario,
  createOfflineCheckpointHarnessReceipt: createOfflineOwnerReceipt,
  createOfflineLiveBridgeReceipt: createOfflineOwnerReceipt,
});

/** Composes the provider-free fixture transport through the exact production observer. */
export function createProductionChronicleQaOwner(options: Readonly<{
  initialChronicleId: ChronicleId;
  scheduler?: ValidationScheduler;
  presentationClockScheduler?: CooperativePresentationClockScheduler;
  composition?: ProductionComposition;
}>): ProductionChronicleQaOwner {
  const composition = options.composition ?? DEFAULT_COMPOSITION;
  const injectedComposition = options.composition !== undefined;
  const transportScheduler = createTrackedValidationScheduler(
    options.scheduler ?? browserValidationScheduler,
  );
  // When a test injects its own cooperative scheduler it owns clock pacing entirely
  // (it drains turns itself), so no deferred queue is created and behaviour is
  // wire-identical to before. Every other headless QA flow gets the settle-driven
  // virtual clock below, which is what keeps long-horizon production backoffs from
  // firing while the harness is merely draining microtasks.
  const deferredClockTurns = options.presentationClockScheduler === undefined
    ? new DeferredPresentationClockTurns()
    : null;
  const clockFactory = injectedComposition
    ? () => createImmediatePresentationClock(
      options.presentationClockScheduler,
      deferredClockTurns,
    )
    : undefined;
  const bindingListeners = new Set<() => void>();
  let disposed = false;
  // QA-only escape hatch for the guided tour: forces the instant `fade-reposition`
  // movement choreography (`lifecycleMovementCommunicationResource.ts`) instead of a
  // full real-time waypoint walk, so a long cross-region departure/arrival can be cut
  // away from quickly rather than making a reviewer sit through it. Read live per
  // event by the choreography registry, so toggling it only affects events processed
  // while it is on — it does not retroactively alter already-rendered beats. Off by
  // default; nothing outside the guided tour ever sets it, so default QA flows are
  // unaffected.
  let reducedMotionOverride = false;
  let validationRuntime: ChronicleValidationRuntime | undefined;
  let activeGeneration: ChronicleQaGenerationOwner | null = null;
  let lastGeneration: ChronicleQaGenerationOwner | null = null;
  let installingGeneration: ChronicleQaGenerationOwner | null = null;
  let observerBinding: ChronicleQaObserverBinding | null = null;

  const emitObserverBinding = (): void => {
    for (const listener of [...bindingListeners]) {
      try {
        listener();
      } catch (error) {
        reportBindingListenerError(error);
      }
    }
  };

  const isGenerationCurrent = (candidate: ChronicleQaGenerationOwner): boolean => (
    !disposed
    && !candidate.disposed
    && (installingGeneration === candidate || activeGeneration === candidate)
  );

  const createGeneration = (
    manifest: ChronicleManifest,
    generation: number,
  ): ChronicleQaGenerationOwner => {
    const pending = new Set<Promise<void>>();
    const resources = new SynchronousCleanupStack();
    let generationOwner!: ChronicleQaGenerationOwner;
    let generationDisposed = false;
    let replayDisposed = false;
    let activeListenerCount = 0;
    let mechanicEnvelopeCount = 0;
    const deliveredEnvelopeCursors: number[] = [];
    let staleCallback: ChronicleQaOwnerDiagnostics["staleCallback"] = null;
    let c14GapEvidence: ChronicleQaOwnerDiagnostics["c14GapEvidence"] = null;
    let retainedStaleDispatch: ((envelope: EventEnvelope) => Promise<void>) | null = null;
    let c14RunTransitionGeneration = 0;

    const acceptsCallback = (): boolean => isGenerationCurrent(generationOwner);
    const assertCurrent = (): void => {
      if (!acceptsCallback()) {
        throw new Error(`Chronicle QA generation ${generation} is no longer active`);
      }
    };
    const track = (value: void | Promise<void>): void => {
      if (generationDisposed || !(value instanceof Promise)) return;
      pending.add(value);
      void value.finally(() => pending.delete(value));
    };
    let liveBridge!: OfflineLiveBridge;
    let checkpointHarness!: OfflineCheckpointHarness;
    let checkpointFeed!: CheckpointFeed;
    let liveBundle!: ProductionObserverSessionBundle;
    let replayClient!: ReplayArtifactClient;
    let observerRuntime!: ObserverShellRuntime;
    let transport!: TrackedTransport;
    try {
      liveBridge = new OfflineLiveBridge(manifest, track);
      const liveBridgeSource: QaOfflineOwnerSource = {
        dispose: () => liveBridge.dispose(),
        pendingTaskCount: () => pending.size,
      };
      const directLiveBridge = resources.add(() => liveBridgeSource.dispose());
      const liveBridgeReceipt = composition.createOfflineLiveBridgeReceipt(liveBridgeSource);
      directLiveBridge.deactivate();
      resources.add(() => liveBridgeReceipt.dispose());

      checkpointHarness = new OfflineCheckpointHarness();
      const checkpointHarnessSource: QaOfflineOwnerSource = {
        dispose: () => checkpointHarness.dispose(),
        pendingTaskCount: () => checkpointHarness.scheduledCount(),
      };
      const directCheckpointHarness = resources.add(() => checkpointHarnessSource.dispose());
      const checkpointHarnessReceipt = composition.createOfflineCheckpointHarnessReceipt(
        checkpointHarnessSource,
      );
      directCheckpointHarness.deactivate();
      resources.add(() => checkpointHarnessReceipt.dispose());

      checkpointFeed = composition.createCheckpointFeed({
        createClient: () => checkpointHarness.client,
        scheduler: checkpointHarness.scheduler,
        pollIntervalMs: 60_000,
        probeManifestBeforeRepeat: false,
      });
      const directCheckpointFeed = resources.add(() => checkpointFeed.dispose());
      liveBundle = composition.createProductionObserverSession({
        clientFactory: () => liveBridge.client,
        checkpointFeedFactory: () => checkpointFeed,
        // C19 ("Two Beings") is the human-steppable guided-tour demo chronicle:
        // its two-being cast is deliberately staged close together (see
        // PlacementLedger's first-fit district selection), so QA opts it into
        // closer resource-route selection for its harvest beats. Every other
        // chronicle (and the live route, which never constructs a QA
        // generation at all) keeps the default -- wire-identical to prior
        // behaviour, since `compactResourceRouting` only changes which
        // existing resource anchor a harvest routes to, never recipe data.
        compactResourceRouting: () => manifest.id === "C19",
        ...(clockFactory === undefined ? {} : { clockFactory }),
      });
      directCheckpointFeed.deactivate();
      const directLiveBundle = resources.add(() => liveBundle.dispose());

      replayClient = composition.createReplayArtifactClient({
        fetcher: createOfflineReplayFetcher(() => manifest, () => liveBridge.world()),
      });
      resources.add(() => {
        const disposableReplay = replayClient as ReplayArtifactClient & { dispose?: () => void };
        disposableReplay.dispose?.();
        replayDisposed = true;
      });
      const replaySession = composition.createReplaySession();
      observerRuntime = composition.createObserverShellRuntime({
        createLiveBundle: () => liveBundle,
        createArchiveBundle: (input) => composition.createProductionArchiveObserverSession({
          ...input,
          ...(clockFactory === undefined ? {} : { clockFactory }),
        }),
        createReplayArtifactClient: () => replayClient,
        createReplaySession: () => replaySession,
        reducedMotion: () => reducedMotionOverride,
      });
      directLiveBundle.deactivate();
      resources.add(() => observerRuntime.dispose());
      // Keep one generation-scoped observer witness even before the playback is
      // published. It gives partially constructed generations the same explicit
      // subscription ownership as committed generations, and is retired before
      // the raw observer during rollback.
      const releaseGenerationWitness = observerRuntime.subscribe(() => undefined);
      resources.add(releaseGenerationWitness);

      const rawTransport = composition.createFixtureTransport({
        onRunAccepted: () => undefined,
        onSnapshotAccepted: () => undefined,
        onEnvelopeAccepted: (envelope) => {
          if (!acceptsCallback()) return;
          mechanicEnvelopeCount += envelope.events.length;
          deliveredEnvelopeCursors.push(...envelope.events.map(({ cursor }) => cursor));
          track(liveBridge.dispatch(envelope));
        },
        onCheckpointAccepted: (record) => {
          if (!acceptsCallback()) return;
          checkpointHarness.reveal(record);
          track(checkpointHarness.flush());
        },
      });
      transport = new TrackedTransport(rawTransport);
      resources.add(() => transport.dispose());
    } catch (primary) {
      generationDisposed = true;
      pending.clear();
      throw resources.disposeWithPrimary(primary, "Chronicle generation construction failed");
    }

    const settle = async (): Promise<void> => {
      assertCurrent();
      for (let pass = 0; pass < SETTLE_PASS_BUDGET; pass += 1) {
        if (pending.size > 0) await Promise.allSettled([...pending]);
        assertCurrent();
        await Promise.resolve();
        assertCurrent();
        const diagnostics = observerRuntime.diagnostics();
        if (
          pending.size === 0
          && (diagnostics === null
            || diagnostics.director.pendingMoments === 0
              && diagnostics.director.activeSceneCount === 0)
        ) return;
        // Not quiescent: let virtual time advance by exactly one deadline, the
        // earliest still pending. Draining after the quiescence check is the whole
        // point -- a settled world never advances the clock, so a long-horizon
        // production timer (rejoin/frozen-retry backoff) stays armed and unfired,
        // which is precisely its state in a browser at the same instant.
        deferredClockTurns?.runEarliest();
      }
      throw new Error("Chronicle QA did not settle within the bounded microtask budget");
    };

    const settleRecovery = async (expected: "frozen-retry"): Promise<void> => {
      for (let pass = 0; pass < 128; pass += 1) {
        await settle();
        assertCurrent();
        if (observerRuntime.diagnostics()?.recovery.status === expected) return;
        await Promise.resolve();
      }
      throw new Error(`Chronicle QA recovery did not reach ${expected}`);
    };

    const c15Frame = (): Readonly<{
      selected: ScenarioEndpoint;
      live: ScenarioEndpoint & Readonly<{ source: "live" }>;
    }> => {
      assertCurrent();
      const selected = selectedEndpoint(observerRuntime);
      const liveFrame = liveBundle.session.getFrame();
      const resources = liveBundle.getResources();
      if (resources === null) throw new Error("C15 Live placement owner is unavailable");
      return Object.freeze({
        selected,
        live: Object.freeze({
          source: "live" as const,
          runId: liveFrame.runId,
          sourceKey: liveFrame.sourceKey,
          cursor: liveFrame.presentedCursor,
          ownerId: ownerName(resources.ownerId),
        }),
      });
    };

    const c14Port = (): C14ScenarioPort => ({
      async recoverGapAndCheckpoint413() {
        assertCurrent();
        liveBridge.setWorld(snapshotAt(manifest, "mock-c14-v1", 2));
        const recovery = liveBridge.dispatch(emptyEnvelope(2));
        const observedGap = observerRuntime.diagnostics()?.ingress.gaps.at(-1);
        if (observedGap?.kind !== "cursor-gap") {
          throw new Error("C14 production ingress did not expose the expected cursor gap");
        }
        c14GapEvidence = Object.freeze({
          firstMissingCursor: observedGap.firstMissingCursor,
          lastMissingCursor: observedGap.lastMissingCursor,
        });
        await recovery;
        await settle();
        checkpointHarness.failWith413();
        await checkpointHarness.flush();
        await settleRecovery("frozen-retry");
        const diagnostics = observerRuntime.diagnostics();
        if (diagnostics === null || diagnostics.recovery.status !== "frozen-retry") {
          throw new Error("C14 checkpoint 413 did not freeze for an honest retry");
        }
        return {
          presentedCursor: 2 as const,
          gap: {
            firstCursor: c14GapEvidence.firstMissingCursor as 1,
            lastCursor: c14GapEvidence.lastMissingCursor as 2,
          },
          checkpointStatus: 413 as const,
          checkpointFaultCount: diagnostics.checkpoint.faultCount as 1,
          recoveryStatus: diagnostics.recovery.status,
          recoveryDigest: {
            firstCursor: diagnostics.recovery.digest.skipped.firstCursor as 3,
            lastCursor: diagnostics.recovery.digest.skipped.lastCursor as 3,
          },
        };
      },
      async retryCheckpoint413ThenRecoverOverflow() {
        assertCurrent();
        liveBridge.setWorld(snapshotAt(manifest, "mock-c14-v1", 3));
        await liveBundle.session.retryRecovery();
        await settle();
        const checkpointRecoveredCursor = liveBundle.session.getFrame().presentedCursor;
        await liveBridge.waitForActiveStream();
        assertCurrent();
        liveBridge.setWorld(snapshotAt(manifest, "mock-c14-v1", 4));
        await liveBridge.dispatch(emptyEnvelope(4, true));
        await settle();
        await liveBridge.waitForActiveStream();
        assertCurrent();
        const diagnostics = observerRuntime.diagnostics();
        const completed = diagnostics?.lastCompletedRecovery;
        if (
          diagnostics === null
          || diagnostics.recovery.status !== "idle"
          || liveBundle.session.getFrame().presentedCursor !== 4
          || completed === null
        ) {
          throw new Error("C14 overflow recovery did not settle and reopen on durable truth");
        }
        return {
          checkpointRetryCount: 1 as const,
          checkpointRecoveredCursor: checkpointRecoveredCursor as 3,
          presentedCursor: liveBundle.session.getFrame().presentedCursor as 4,
          overflow: true as const,
          snapshotRequired: true as const,
          lastCompletedRecovery: completed as CompletedRecoveryReceipt,
        };
      },
      async replaceRun() {
        assertCurrent();
        const previousRunId = liveBundle.session.getFrame().runId;
        await liveBridge.waitForStream();
        assertCurrent();
        retainedStaleDispatch = liveBridge.staleDispatch();
        c14RunTransitionGeneration += 1;
        const supersededGeneration = c14RunTransitionGeneration;
        transport.replaceRun(manifest);
        const replacement = chroniclePresentationSnapshot(manifest);
        const run = runMetadata(manifest, replacement.run_id);
        liveBridge.replace(run, replacement);
        liveBundle.replaceRun(run, replacement);
        await settle();
        return { previousRunId, replacementRunId: replacement.run_id, supersededGeneration };
      },
      async dispatchStaleCallback(supersededGeneration) {
        assertCurrent();
        if (
          supersededGeneration !== c14RunTransitionGeneration
          || retainedStaleDispatch === null
        ) {
          throw new Error("C14 stale callback generation is not the superseded owner");
        }
        const before = externalOwnerState(observerRuntime);
        await retainedStaleDispatch(emptyEnvelope(99));
        await settle();
        const after = externalOwnerState(observerRuntime);
        staleCallback = Object.freeze({ disposition: "rejected", before, after });
        const endpoint = selectedEndpoint(observerRuntime);
        return {
          accepted: false as const,
          selected: endpoint,
          live: { ...endpoint, source: "live" as const },
        };
      },
    });

    const c15Port = (): C15ScenarioPort => ({
      async primeLiveCursor() {
        assertCurrent();
        liveBridge.setWorld(snapshotAt(manifest, "mock-c15-v1", 2));
        await liveBridge.dispatch(emptyEnvelope(2));
        await settle();
        return c15Frame();
      },
      async enterArchiveAt() {
        assertCurrent();
        await observerRuntime.openArchiveCatalogue();
        assertCurrent();
        await observerRuntime.enterArchiveCheckpoint({ lineNumber: 1 });
        await settle();
        return c15Frame();
      },
      async advanceLiveWhileArchived() {
        assertCurrent();
        liveBridge.setWorld(snapshotAt(manifest, "mock-c15-v1", 4));
        await liveBridge.dispatch(emptyEnvelope(4));
        await settle();
        return c15Frame();
      },
      async returnToLive() {
        assertCurrent();
        observerRuntime.returnToLive();
        await settle();
        return c15Frame();
      },
    });

    const createScenario = (): ChronicleScenarioDriver | null => {
      assertCurrent();
      if (manifest.id === "C14") {
        const scenario = composition.createC14ChronicleValidationScenario({
          manifest,
          port: c14Port(),
        });
        return scenarioDriver("C14", scenario, [
          ["c14-gap-413", "Recover cursor gap and 413"],
          ["c14-overflow", "Retry 413, then recover overflow"],
          ["c14-replace", "Replace run"],
          ["c14-stale-reject", "Reject stale callback"],
        ]);
      }
      if (manifest.id === "C15") {
        const scenario = composition.createC15ChronicleValidationScenario({
          manifest,
          port: c15Port(),
        });
        return scenarioDriver("C15", scenario, [
          ["c15-prime-live-2", "Prime Live cursor 2"],
          ["c15-enter-archive-2", "Enter Archive cursor 2"],
          ["c15-hidden-live-4", "Advance hidden Live to cursor 4"],
          ["c15-return-live-4", "Return to Live cursor 4"],
        ]);
      }
      return null;
    };

    const disposeGeneration = (): void => {
      if (generationDisposed) return;
      generationDisposed = true;
      if (activeGeneration === generationOwner) activeGeneration = null;
      if (installingGeneration === generationOwner) installingGeneration = null;
      pending.clear();
      try {
        resources.dispose("Chronicle generation disposal failed");
      } finally {
        activeListenerCount = 0;
      }
    };

    const playback = new ProductionPlayback({
      manifest,
      transport,
      observerRuntime,
      ready: observerRuntime.ready,
      onSubscribe: (delta) => { activeListenerCount += delta; },
      disposeGeneration,
    });

    const runToTerminal = async (): Promise<void> => {
      assertCurrent();
      await observerRuntime.ready;
      assertCurrent();
      const terminal = manifest.expectedFinalCursor;
      validationRuntime?.pause();
      observerRuntime.resume();
      const acceptPresentedFrame = (): void => {
        const frame = observerRuntime.getSnapshot().frame;
        if (frame !== null) liveBundle.frameAcceptance.markAccepted(frame);
      };
      const stopHeadlessAcceptance = injectedComposition
        ? observerRuntime.subscribe(acceptPresentedFrame)
        : () => undefined;
      acceptPresentedFrame();
      try {
        if (manifest.id === "C16") {
          for (const record of manifest.checkpoints) {
            await liveBridge.waitForActiveStream();
            assertCurrent();
            liveBridge.setWorld(record.checkpoint.snapshot);
            playback.deliverThroughCursor(record.checkpoint.event_cursor);
            await settle();
            if (liveBundle.session.getFrame().presentedCursor !== record.checkpoint.event_cursor) {
              throw new Error("C16 checkpoint epoch did not settle on authoritative cursor truth");
            }
          }
        } else {
          for (let cursor = 256; cursor < terminal; cursor += 256) {
            playback.deliverThroughCursor(cursor);
            await settle();
          }
          playback.deliverThroughCursor(terminal);
          await settle();
        }
      } finally {
        stopHeadlessAcceptance();
      }
    };

    generationOwner = {
      generation,
      manifest,
      observerRuntime,
      playback,
      get disposed(): boolean { return generationDisposed; },
      createScenario,
      settle,
      runToTerminal,
      diagnostics(ownerDisposed): ChronicleQaOwnerDiagnostics {
        const observer = observerRuntime.diagnostics();
        return Object.freeze({
          disposed: ownerDisposed,
          observerDisposed: observerRuntime.getSnapshot().status === "disposed",
          transportDisposed: transport.disposed,
          replayDisposed,
          checkpointFeedDisposed: checkpointFeed.diagnostics().disposed,
          scheduledTaskCount: checkpointHarness.scheduledCount(),
          activeListenerCount,
          mechanicEnvelopeCount,
          deliveredEnvelopeCursors: Object.freeze([...deliveredEnvelopeCursors]),
          observer,
          staleCallback,
          c14GapEvidence,
        });
      },
      dispose: disposeGeneration,
    };
    return generationOwner;
  };

  let installedValidationRuntime: ChronicleValidationRuntime;
  try {
    installedValidationRuntime = createChronicleValidationRuntime({
      initialChronicleId: options.initialChronicleId,
      getManifest: getChronicleManifest,
      createPlayback: ({ manifest, generation }) => {
        const next = createGeneration(manifest, generation);
        installingGeneration = next;
        lastGeneration = next;
        return next.playback;
      },
      scheduler: transportScheduler.scheduler,
      createScenario: (manifest) => {
        const current = installingGeneration;
        if (current === null || current.manifest !== manifest) {
          throw new Error("Chronicle QA scenario does not match the installing generation");
        }
        return current.createScenario();
      },
      generationLifecycle: {
        committed({ manifest, generation, playback }): void {
          const current = installingGeneration;
          if (
            current === null
            || current.manifest !== manifest
            || current.generation !== generation
            || current.playback !== playback
          ) {
            throw new Error("Chronicle QA committed generation does not match its owner");
          }
          activeGeneration = current;
          installingGeneration = null;
          observerBinding = Object.freeze({
            generation,
            observerRuntime: current.observerRuntime,
          });
          emitObserverBinding();
        },
        failed({ manifest, generation }): void {
          const current = installingGeneration;
          if (
            current !== null
            && current.manifest === manifest
            && current.generation === generation
          ) {
            current.dispose();
          }
          activeGeneration = null;
          installingGeneration = null;
          if (observerBinding !== null) {
            observerBinding = null;
            emitObserverBinding();
          }
        },
      },
    });
  } catch (primary) {
    const cleanupErrors: unknown[] = [];
    for (const cleanup of [
      () => installingGeneration?.dispose(),
      () => activeGeneration?.dispose(),
      () => transportScheduler.dispose(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    observerBinding = null;
    bindingListeners.clear();
    throw withCleanupErrors(primary, cleanupErrors, "Chronicle QA owner construction failed");
  }
  validationRuntime = installedValidationRuntime;
  const ready = installedValidationRuntime.start();

  const currentGeneration = (): ChronicleQaGenerationOwner => {
    const current = activeGeneration;
    if (disposed || current === null) throw new Error("Chronicle QA owner is disposed");
    return current;
  };

  const owner: ProductionChronicleQaOwner = {
    get observerRuntime(): ObserverShellRuntime {
      const retained = activeGeneration ?? (disposed ? lastGeneration : null);
      if (retained === null) throw new Error("Chronicle QA observer is unavailable");
      return retained.observerRuntime;
    },
    validationRuntime: installedValidationRuntime,
    ...(composition.rendererAtlasPool === undefined
      ? {}
      : { rendererAtlasPool: composition.rendererAtlasPool }),
    ...(composition.rendererAtlasCommitScheduler === undefined
      ? {}
      : { rendererAtlasCommitScheduler: composition.rendererAtlasCommitScheduler }),
    ready,
    setReducedMotionOverride(active): void {
      reducedMotionOverride = active;
    },
    getObserverBinding: () => disposed ? null : observerBinding,
    subscribeObserverBinding(listener): () => void {
      if (disposed) return () => undefined;
      bindingListeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        bindingListeners.delete(listener);
      };
    },
    start: () => ready,
    settle: () => currentGeneration().settle(),
    async runToTerminal(): Promise<void> {
      const current = currentGeneration();
      await current.runToTerminal();
      if (activeGeneration !== current) {
        throw new Error("Chronicle QA generation changed during terminal traversal");
      }
    },
    diagnostics(): ChronicleQaOwnerDiagnostics {
      const retained = activeGeneration ?? lastGeneration;
      if (retained === null) throw new Error("Chronicle QA diagnostics are unavailable");
      const generationDiagnostics = retained.diagnostics(disposed);
      return Object.freeze({
        ...generationDiagnostics,
        scheduledTaskCount: generationDiagnostics.scheduledTaskCount + transportScheduler.count(),
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      const cleanupErrors: unknown[] = [];
      for (const cleanup of [
        () => installedValidationRuntime.dispose(),
        () => transportScheduler.dispose(),
        () => {
          if (observerBinding !== null) {
            observerBinding = null;
            emitObserverBinding();
          }
        },
      ]) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      bindingListeners.clear();
      if (cleanupErrors.length > 0) {
        throw cleanupFailure(cleanupErrors, "Chronicle QA owner disposal failed");
      }
    },
  };
  return owner;
}

interface ChronicleQaGenerationOwner {
  readonly generation: number;
  readonly manifest: ChronicleManifest;
  readonly observerRuntime: ObserverShellRuntime;
  readonly playback: ProductionPlayback;
  readonly disposed: boolean;
  createScenario(): ChronicleScenarioDriver | null;
  settle(): Promise<void>;
  runToTerminal(): Promise<void>;
  diagnostics(ownerDisposed: boolean): ChronicleQaOwnerDiagnostics;
  dispose(): void;
}

class ProductionPlayback implements ChroniclePlayback {
  readonly ready: Promise<void>;
  private started = false;
  private disposed = false;
  private requestedCursor = 0;
  private requestedMarker: AuthoredReviewCue | null = null;
  private cancelDeferredPause: (() => void) | null = null;

  constructor(private readonly options: Readonly<{
    manifest: ChronicleManifest;
    transport: TrackedTransport;
    observerRuntime: ObserverShellRuntime;
    ready: Promise<void>;
    onSubscribe(delta: number): void;
    disposeGeneration(): void;
  }>) {
    this.ready = options.ready;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.options.transport.start(this.options.manifest);
  }

  getSnapshot(): ChroniclePlaybackSnapshot {
    const frame = this.options.observerRuntime.getSnapshot().frame;
    if (frame === null) {
      return {
        runId: this.options.manifest.runId,
        source: "live" as const,
        sourceKey: `live:${this.options.manifest.runId}`,
        presentedCursor: 0,
        presentedTime: this.options.manifest.initialSnapshot.world_time,
      };
    }
    return {
      runId: frame.runId,
      source: observerSource(frame.source),
      sourceKey: frame.sourceKey,
      presentedCursor: frame.presentedCursor,
      presentedTime: frame.world.worldTime,
    };
  }

  subscribe(listener: () => void): () => void {
    this.options.onSubscribe(1);
    const unsubscribe = this.options.observerRuntime.subscribe(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      unsubscribe();
      this.options.onSubscribe(-1);
    };
  }

  deliverThroughCursor(cursor: number): void {
    this.requestedMarker = null;
    this.requestedCursor = Math.max(this.requestedCursor, cursor);
    this.options.transport.deliverThroughCursor(cursor);
  }
  deliverToMarker(marker: AuthoredReviewCue): void {
    this.requestedMarker = marker;
    this.requestedCursor = marker.cursor;
    this.options.transport.deliverThroughCursor(marker.cursor);
  }
  pause(): void {
    this.cancelDeferredPause?.();
    this.cancelDeferredPause = null;
    const pauseAtCursor = this.requestedCursor;
    const pauseAtMarker = this.requestedMarker;
    const pauseWhenPresented = (): void => {
      const frame = this.options.observerRuntime.getSnapshot().frame;
      if (
        frame === null
        || (pauseAtMarker === null
          ? frame.presentedCursor < pauseAtCursor
          : frame.presentedCursor !== pauseAtMarker.cursor
            || frame.world.worldTime !== pauseAtMarker.presentedTime)
      ) return;
      this.cancelDeferredPause?.();
      this.cancelDeferredPause = null;
      this.options.observerRuntime.pause();
    };
    pauseWhenPresented();
    if (this.cancelDeferredPause === null) {
      const frame = this.options.observerRuntime.getSnapshot().frame;
      if (
        frame === null
        || (pauseAtMarker === null
          ? frame.presentedCursor < pauseAtCursor
          : frame.presentedCursor !== pauseAtMarker.cursor
            || frame.world.worldTime !== pauseAtMarker.presentedTime)
      ) {
        this.cancelDeferredPause = this.options.observerRuntime.subscribe(pauseWhenPresented);
      }
    }
  }
  resume(): void {
    this.cancelDeferredPause?.();
    this.cancelDeferredPause = null;
    this.options.observerRuntime.resume();
  }
  setSpeed(speed: 0.5 | 1 | 1.5 | 2): void { this.options.observerRuntime.setSpeed(speed); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelDeferredPause?.();
    this.cancelDeferredPause = null;
    this.options.disposeGeneration();
  }
}

class TrackedTransport implements FixtureTransport {
  disposed = false;
  constructor(private readonly raw: FixtureTransport) {}
  start(manifest: ChronicleManifest): void { this.raw.start(manifest); }
  deliverThroughCursor(cursor: number): void { this.raw.deliverThroughCursor(cursor); }
  deliverAll(): void { this.raw.deliverAll(); }
  replaceRun(manifest: ChronicleManifest): void { this.raw.replaceRun(manifest); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.raw.dispose();
  }
}

class OfflineLiveBridge {
  readonly client: LiveApiClient;
  private run: RunMetadata;
  private snapshot: WorldSnapshot;
  private disposed = false;
  private readonly streams: Array<Readonly<{
    handlers: EventStreamHandlers;
    isActive(): boolean;
  }>> = [];

  constructor(
    manifest: ChronicleManifest,
    private readonly track: (value: void | Promise<void>) => void,
  ) {
    this.run = runMetadata(manifest);
    this.snapshot = structuredClone(manifest.initialSnapshot);
    this.client = Object.freeze({
      getRun: async () => structuredClone(this.run),
      getWorld: async () => structuredClone(this.snapshot),
      getEvents: async (cursor: number) => emptyEnvelope(cursor),
      openEventStream: (cursor: number, handlers: EventStreamHandlers) => {
        let active = true;
        const record = Object.freeze({ handlers, isActive: () => active });
        this.streams.push(record);
        return {
          url: `fixture://events/${this.run.run_id}?cursor=${cursor}`,
          close(): void { active = false; },
        };
      },
    });
  }

  replace(run: RunMetadata, snapshot: WorldSnapshot): void {
    if (this.disposed) return;
    this.run = structuredClone(run);
    this.snapshot = structuredClone(snapshot);
  }

  setWorld(snapshot: WorldSnapshot): void {
    if (!this.disposed) this.snapshot = structuredClone(snapshot);
  }
  world(): WorldSnapshot { return structuredClone(this.snapshot); }

  dispatch(envelope: EventEnvelope): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const stream = [...this.streams].reverse().find((candidate) => candidate.isActive());
    if (stream === undefined) return Promise.resolve();
    const result = Promise.resolve(stream.handlers.onEnvelope(structuredClone(envelope)));
    this.track(result);
    return result;
  }

  staleDispatch(): (envelope: EventEnvelope) => Promise<void> {
    const stream = this.streams.at(-1);
    if (stream === undefined) throw new Error("No Live stream is available for stale proof");
    return async (envelope) => {
      if (this.disposed) return;
      await Promise.resolve(stream.handlers.onEnvelope(structuredClone(envelope)));
    };
  }

  async waitForStream(): Promise<void> {
    for (let pass = 0; pass < 128; pass += 1) {
      if (this.streams.length > 0) return;
      await Promise.resolve();
    }
    throw new Error("No Live stream became available within the bounded microtask budget");
  }

  async waitForActiveStream(): Promise<void> {
    for (let pass = 0; pass < 128; pass += 1) {
      if (this.streams.some((candidate) => candidate.isActive())) return;
      await Promise.resolve();
    }
    throw new Error("No active Live stream became available within the bounded microtask budget");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.streams.length = 0;
  }
}

class OfflineCheckpointHarness {
  private records: ClassifiedCheckpointRecord[] = [];
  private task: Readonly<{
    callback: () => void | Promise<void>;
    cancelled: boolean;
  }> | null = null;
  private fault413 = false;
  private disposed = false;
  private dirty = false;
  private flushing: Promise<void> | null = null;

  readonly scheduler: CheckpointFeedScheduler = Object.freeze({
    schedule: (_delayMs: number, callback: () => void | Promise<void>): CheckpointFeedScheduledTask => {
      const task = { callback, cancelled: false };
      this.task = task;
      return { cancel: () => { task.cancelled = true; } };
    },
  });

  readonly client: CheckpointApiClient = Object.freeze({
    getReplayManifest: async () => ({
      runId: this.records.at(-1)?.checkpoint.run_id ?? "fixture-pending",
      checkpointCount: this.records.length,
      lastCheckpointLine: this.records.at(-1)?.line ?? null,
    }),
    getLatestCheckpoint: async () => {
      if (this.fault413) {
        this.fault413 = false;
        throw new HttpResponseError("/api/replay/checkpoints/latest", 413, "fixture oversized record");
      }
      const record = this.records.at(-1);
      return record === undefined ? null : { line: record.line, checkpoint: record.checkpoint };
    },
    getCheckpointPage: async (before: number, limit: number) => {
      const available = this.records.filter(({ line }) => line < before);
      const selected = available.slice(Math.max(0, available.length - limit));
      return {
        runId: selected.at(-1)?.checkpoint.run_id ?? "fixture-pending",
        before,
        nextBefore: selected[0]?.line ?? before,
        hasMore: (selected[0]?.line ?? 1) > 1,
        // The fixture archive is small enough that the server's byte clamp never
        // fires; a chronicle page is always whole.
        truncated: false,
        records: selected.map(({ line, checkpoint }) => ({ line, checkpoint })),
      };
    },
  });

  reveal(record: ClassifiedCheckpointRecord): void {
    if (this.disposed || this.records.some(({ line }) => line === record.line)) return;
    this.records.push(structuredClone(record));
    this.records.sort((left, right) => left.line - right.line);
    this.dirty = true;
  }

  failWith413(): void { this.fault413 = true; this.dirty = true; }

  flush(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.flushing !== null) return this.flushing;
    const execution = (async (): Promise<void> => {
      while (!this.disposed && this.dirty) {
        this.dirty = false;
        const task = this.task;
        if (task === null || task.cancelled) return;
        this.task = null;
        await task.callback();
      }
    })();
    this.flushing = execution.finally(() => { this.flushing = null; });
    return this.flushing;
  }

  scheduledCount(): number { return this.task !== null && !this.task.cancelled ? 1 : 0; }
  dispose(): void {
    this.disposed = true;
    this.task = null;
    this.records = [];
    this.dirty = false;
    this.flushing = null;
  }
}

interface CleanupTransferHandle {
  deactivate(): void;
}

class SynchronousCleanupStack {
  private readonly entries: Array<{
    active: boolean;
    cleanup: () => void;
  }> = [];
  private disposed = false;

  add(cleanup: () => void): CleanupTransferHandle {
    if (this.disposed) throw new Error("Cannot register cleanup after disposal");
    const entry = { active: true, cleanup };
    this.entries.push(entry);
    return {
      deactivate(): void { entry.active = false; },
    };
  }

  dispose(message: string): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const entry of [...this.entries].reverse()) {
      if (!entry.active) continue;
      entry.active = false;
      try {
        entry.cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw cleanupFailure(errors, message);
  }

  disposeWithPrimary(primary: unknown, message: string): unknown {
    const errors: unknown[] = [];
    try {
      this.dispose(message);
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors);
      else errors.push(error);
    }
    return withCleanupErrors(primary, errors, message);
  }
}

function createOfflineOwnerReceipt(source: QaOfflineOwnerSource): QaOfflineOwnerReceipt {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      source.dispose();
    },
    diagnostics: () => Object.freeze({
      disposed,
      pendingTaskCount: source.pendingTaskCount(),
    }),
  };
}

function reportBindingListenerError(error: unknown): void {
  const reporter = Reflect.get(globalThis, "reportError");
  if (typeof reporter === "function") {
    Reflect.apply(reporter, globalThis, [error]);
    return;
  }
  globalThis.queueMicrotask(() => { throw error; });
}

function cleanupFailure(errors: readonly unknown[], message: string): unknown {
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, message, { cause: errors[0] });
}

function withCleanupErrors(
  primary: unknown,
  cleanupErrors: readonly unknown[],
  message: string,
): unknown {
  if (cleanupErrors.length === 0) return primary;
  return new AggregateError([primary, ...cleanupErrors], message, { cause: primary });
}

function createTrackedValidationScheduler(base: ValidationScheduler): Readonly<{
  scheduler: ValidationScheduler;
  count(): number;
  dispose(): void;
}> {
  const cancellations = new Set<() => void>();
  let disposed = false;
  return {
    scheduler: {
      schedule(delayMs, callback): () => void {
        if (disposed) return () => undefined;
        let active = true;
        let cancelBase: () => void = () => undefined;
        const cancel = (): void => {
          if (!active) return;
          active = false;
          cancellations.delete(cancel);
          cancelBase();
        };
        cancelBase = base.schedule(delayMs, () => {
          if (!active) return;
          active = false;
          cancellations.delete(cancel);
          callback();
        });
        cancellations.add(cancel);
        return cancel;
      },
    },
    count: () => cancellations.size,
    dispose(): void {
      disposed = true;
      for (const cancel of [...cancellations]) cancel();
    },
  };
}

function scenarioDriver(
  kind: "C14" | "C15",
  scenario: ReturnType<typeof createC14ChronicleValidationScenario>
    | ReturnType<typeof createC15ChronicleValidationScenario>,
  controls: readonly (readonly [ChronicleScenarioControlId, string])[],
): ChronicleScenarioDriver {
  const phaseMethods = kind === "C14"
    ? ["recoverGapAndCheckpoint413", "retryCheckpoint413ThenRecoverOverflow", "replaceRun", "rejectStaleCallback"] as const
    : ["primeLiveCursor", "enterArchive", "advanceLiveWhileArchived", "returnToLive"] as const;
  const completedCount = (): number => {
    const phase = scenario.getSnapshot().phase;
    const phases = kind === "C14"
      ? ["initial", "gap-413", "overflow", "replacement", "complete"]
      : ["initial", "live-2", "archive-2", "hidden-live-4", "complete"];
    return Math.max(0, phases.indexOf(phase));
  };
  return {
    getView(): ChronicleScenarioView {
      const completed = completedCount();
      const snapshot = scenario.getSnapshot();
      return Object.freeze({
        kind,
        phase: snapshot.phase,
        controls: Object.freeze(controls.map(([id, label], index) => Object.freeze({
          id,
          label,
          enabled: index === completed && completed < controls.length,
        }))),
        mechanicEnvelopeCount: 0 as const,
        lastCompletedRecovery: "lastCompletedRecovery" in snapshot
          ? snapshot.lastCompletedRecovery
          : null,
      });
    },
    async run(id): Promise<void> {
      const index = controls.findIndex(([candidate]) => candidate === id);
      if (index < 0 || index !== completedCount()) throw new Error(`${kind} scenario control is out of order`);
      const method = phaseMethods[index];
      if (method === undefined) throw new Error(`${kind} scenario phase is complete`);
      const callable = (scenario as unknown as Record<string, () => Promise<void>>)[method];
      if (callable === undefined) throw new Error(`${kind} scenario method is unavailable`);
      await callable();
    },
    dispose: () => scenario.dispose(),
  };
}

const ownerNames = new Map<symbol, string>();
function ownerName(ownerId: symbol): string {
  const retained = ownerNames.get(ownerId);
  if (retained !== undefined) return retained;
  const value = `placement-owner-${ownerNames.size + 1}`;
  ownerNames.set(ownerId, value);
  return value;
}

function selectedEndpoint(runtime: ObserverShellRuntime): ScenarioEndpoint {
  const selected = runtime.getSnapshot();
  if (selected.frame === null || selected.placementOwnerId === null) {
    throw new Error("Selected production observer endpoint is unavailable");
  }
  return Object.freeze({
    source: observerSource(selected.frame.source),
    runId: selected.frame.runId,
    sourceKey: selected.frame.sourceKey,
    cursor: selected.frame.presentedCursor,
    ownerId: ownerName(selected.placementOwnerId),
  });
}

function observerSource(source: string): "live" | "archive" {
  if (source !== "live" && source !== "archive") {
    throw new Error("Chronicle QA production observer selected a non-Live/Archive source");
  }
  return source;
}

function externalOwnerState(runtime: ObserverShellRuntime): unknown {
  const selected = runtime.getSnapshot();
  return JSON.parse(JSON.stringify({
    status: selected.status,
    runId: selected.frame?.runId ?? null,
    sourceKey: selected.frame?.sourceKey ?? null,
    cursor: selected.frame?.presentedCursor ?? null,
    revision: selected.frame?.revision ?? null,
    world: selected.frame?.world ?? null,
    diagnostics: runtime.diagnostics(),
  }, (_key, value: unknown) => typeof value === "symbol" ? String(value) : value)) as unknown;
}

function runMetadata(manifest: ChronicleManifest, runId = manifest.runId): RunMetadata {
  return {
    schema: 1,
    run_id: runId,
    seed: manifest.seed,
    started_at: manifest.initialSnapshot.world_time,
    status: "running",
    event_cursor: 0,
    world_time: manifest.initialSnapshot.world_time,
    config_hash: `fixture:${manifest.id}:v1`,
    constants: {},
    seed_persona: null,
    provider: "fixture",
    model: "fixture",
    context_window: null,
    timing: {},
    artifacts: {
      events: "fixture",
      usage: "fixture",
      snapshots: "fixture",
      memory_root: "fixture",
    },
  };
}

function snapshotAt(manifest: ChronicleManifest, runId: string, cursor: number): WorldSnapshot {
  return structuredClone({
    ...manifest.initialSnapshot,
    run_id: runId,
    event_cursor: cursor,
    world_time: manifest.initialSnapshot.world_time + cursor,
  });
}

function emptyEnvelope(cursor: number, overflow = false): EventEnvelope {
  return {
    schema: 1,
    cursor: Math.max(0, cursor - 1),
    oldest_cursor: cursor,
    next_cursor: cursor,
    events: [],
    overflow,
    snapshot_required: overflow,
  };
}

/**
 * Deadline-ordered queue of virtual presentation-clock turns owned by one QA owner.
 *
 * Exists because `createImmediatePresentationClock` used to fire every scheduled
 * deadline through `globalThis.queueMicrotask` *and* snap its `now` straight to that
 * deadline. That is sound for story pacing (which the harness deliberately compresses)
 * but not for the long-horizon backoffs `PresentationSession` schedules on the same
 * clock: `scheduleFrozenRetry` (`PresentationSession.ts:1270`) re-arms itself from its
 * own callback whenever the retry re-freezes, so an infinitely fast clock turned a
 * capped 15 s backoff into an unbounded microtask cascade. Measured: C14's
 * route-binding contract drove that cascade past 20,000 turns and 299,955,000 ms
 * (83 hours) of virtual time, starving the macrotask queue so vitest's own timeout
 * could never fire -- the file hung instead of failing.
 *
 * Turns are therefore held here and drained by `settle()` one deadline at a time,
 * only while the world is not yet quiescent. Nothing is dropped: a held turn stays
 * armed and cancellable exactly as a browser timer would be.
 */
class DeferredPresentationClockTurns {
  private nextId = 1;
  private readonly turns: Array<Readonly<{
    id: number;
    deadlineMs: number;
    run: () => void;
  }> & { cancelled: boolean }> = [];

  /** Holds one clock turn; returns its canceller. Mutates the pending turn list. */
  push(deadlineMs: number, run: () => void): () => void {
    const turn = { id: this.nextId, deadlineMs, run, cancelled: false };
    this.nextId += 1;
    this.turns.push(turn);
    return () => {
      turn.cancelled = true;
    };
  }

  /**
   * Runs the earliest pending turn (ties broken by schedule order) and returns
   * whether one ran. Mutates the pending turn list and, through the callback, the
   * owning presentation session's clock and director state.
   */
  runEarliest(): boolean {
    let selected: (typeof this.turns)[number] | null = null;
    let selectedIndex = -1;
    for (const [index, turn] of this.turns.entries()) {
      if (turn.cancelled) continue;
      if (
        selected === null
        || turn.deadlineMs < selected.deadlineMs
        || (turn.deadlineMs === selected.deadlineMs && turn.id < selected.id)
      ) {
        selected = turn;
        selectedIndex = index;
      }
    }
    if (selected === null) {
      this.turns.length = 0;
      return false;
    }
    selected.cancelled = true;
    this.turns.splice(selectedIndex, 1);
    selected.run();
    return true;
  }
}

/**
 * Builds the QA virtual presentation clock.
 *
 * With a cooperative `scheduler` the caller owns pacing and drains turns itself
 * (the renderer-baseline contracts). Otherwise turns are held in `deferred` and
 * drained by `settle()`; only when neither exists does the clock fall back to a raw
 * microtask, which is the unbounded path documented on
 * `DeferredPresentationClockTurns`.
 */
function createImmediatePresentationClock(
  scheduler?: CooperativePresentationClockScheduler,
  deferred?: DeferredPresentationClockTurns | null,
): PresentationClock {
  let now = 0;
  return {
    now: () => now,
    schedule(deadlineMs, callback): () => void {
      let active = true;
      const run = (): void => {
        if (!active) return;
        active = false;
        now = Math.max(now, deadlineMs);
        callback();
      };
      const cancelTurn = scheduler?.scheduleTurn(run)
        ?? deferred?.push(Math.max(now, deadlineMs), run);
      if (cancelTurn === undefined) globalThis.queueMicrotask(run);
      return () => {
        active = false;
        cancelTurn?.();
      };
    },
  };
}

function createOfflineReplayFetcher(
  getManifest: () => ChronicleManifest,
  getWorld: () => WorldSnapshot,
): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), "http://fixture.invalid");
    const manifest = getManifest();
    const world = getWorld();
    const checkpoint = {
      schema: 1,
      type: "world_snapshot_checkpoint",
      reason: "archive_live_isolation",
      run_id: manifest.runId,
      world_time: world.world_time,
      event_cursor: world.event_cursor,
      snapshot: world,
    };
    if (url.pathname === "/api/replay/manifest") {
      return jsonResponse({
        schema: 1,
        run_id: manifest.runId,
        events: { count: 0 },
        checkpoints: { count: 1, first_line: 1, last_line: 1 },
        bootstrap: { event_after: world.event_cursor, event_limit: REPLAY_EVENT_BOOTSTRAP_LIMIT },
      });
    }
    if (url.pathname === "/api/replay/checkpoints/latest") {
      return jsonResponse({ schema: 1, run_id: manifest.runId, line: 1, checkpoint });
    }
    if (url.pathname === "/api/replay/events") {
      const after = Number(url.searchParams.get("after") ?? world.event_cursor);
      return jsonResponse({
        schema: 1,
        run_id: manifest.runId,
        after,
        next_after: after,
        has_more: false,
        events: [],
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof globalThis.fetch;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
