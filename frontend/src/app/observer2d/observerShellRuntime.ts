import {
  createReplayArtifactClient,
  type ReplayArtifactClient,
  type ReplayArtifacts,
  type ReplayPresentationWindow,
} from "../replayArtifactClient";
import {
  createHistoricalReplayPresentationWindow,
  createReplaySession,
  type ReplaySession,
} from "../replaySession";
import type { SnapshotCheckpoint } from "../replayArtifacts";
import {
  createPresentationSessionBinding,
  type PresentationControls,
  type PresentationSession,
  type PresentationSessionBinding,
  type PresentationSessionDiagnostics,
} from "../../presentation/PresentationSession";
import type { PresentationFrameAcceptanceTracker } from "../../presentation/PresentationFrameSink";
import type { PresentedChronicleWindow } from "../../presentation/selectors";
import type {
  CameraMode,
  ObserverSelection,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import { PlacementLedger } from "../../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import {
  createProductionArchiveObserverSession,
  createProductionObserverSession,
  type ObserverPlacementResources,
  type ProductionArchiveObserverSessionBundle,
  type ProductionObserverSessionBundle,
} from "./createProductionObserverSession";
import type { PresentationClock } from "../../presentation/storyClock";
import type { CheckpointFeed } from "../../presentation/CheckpointFeed";

export type ObserverArchiveCheckpointKey =
  | Readonly<{ lineNumber: number }>
  | Readonly<{ index: number }>;

export interface ObserverArchiveCheckpoint {
  readonly key: ObserverArchiveCheckpointKey;
  readonly eventCursor: number;
  readonly worldTime: number;
  readonly reason: string;
}

export type ObserverArchiveState =
  | Readonly<{ status: "inactive" }>
  | Readonly<{ status: "loading" }>
  | Readonly<{
      status: "ready";
      checkpoints: readonly ObserverArchiveCheckpoint[];
      hasMore: boolean;
    }>
  | Readonly<{ status: "empty"; hasMore: false }>
  | Readonly<{
      status: "active";
      sourceKey: string;
      checkpoints: readonly ObserverArchiveCheckpoint[];
      hasMore: boolean;
      selectedKey: ObserverArchiveCheckpointKey | null;
    }>
  | Readonly<{ status: "error" }>;

export interface ObserverFocusRequest {
  readonly serial: number;
  readonly selection: Exclude<ObserverSelection, null>;
}

export interface ObserverShellSnapshot {
  readonly status: "loading" | "ready" | "error" | "disposed";
  readonly frame: PresentedObserverFrame | null;
  readonly chronicle: PresentedChronicleWindow | null;
  readonly controls: PresentationControls | null;
  readonly diagnostics: PresentationSessionDiagnostics | null;
  readonly placement: PlacementLedger | null;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1> | null;
  readonly placementOwnerId: symbol | null;
  readonly placementGeneration: number | null;
  readonly cameraMode: CameraMode;
  readonly observedRegionId: string | null;
  readonly focusRequest: ObserverFocusRequest | null;
  readonly archive: ObserverArchiveState;
  readonly error: "live-unavailable" | "archive-unavailable" | null;
}

export interface PresentationFrameSource {
  getSnapshot(): PresentedObserverFrame;
  subscribe(listener: () => void): () => void;
}

export interface ObserverShellRuntimeOptions {
  readonly reducedMotion?: () => boolean;
  readonly createLiveBundle?: (
    options: Readonly<{ reducedMotion: () => boolean }>,
  ) => ProductionObserverSessionBundle;
  readonly createArchiveBundle?: (
    options: Readonly<{
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }>,
  ) => ProductionArchiveObserverSessionBundle;
  readonly createBinding?: (initial: PresentationSession) => PresentationSessionBinding;
  readonly createReplayArtifactClient?: () => ReplayArtifactClient;
  readonly createReplaySession?: () => ReplaySession;
  readonly capture?: ObserverShellCaptureInjection;
}

export interface ObserverShellCaptureInjection {
  readonly clockFactory: () => PresentationClock;
  readonly checkpointFeedFactory: () => CheckpointFeed;
  registerMountedRunReplacement(
    replaceRun: (run: import("../schemas").RunMetadata, snapshot: import("../schemas").WorldSnapshot) => void,
  ): Readonly<{ release(): void }> | undefined;
  dispose(): void;
}

export interface ObserverShellRuntime {
  readonly ready: Promise<void>;
  readonly frameSource: PresentationFrameSource;
  readonly frameAcceptance: Pick<PresentationFrameAcceptanceTracker, "markAccepted">;
  subscribe(listener: () => void): () => void;
  getSnapshot(): ObserverShellSnapshot;
  diagnostics(): PresentationSessionDiagnostics | null;
  select(selection: ObserverSelection): void;
  pause(): void;
  resume(choice?: "continue-from-summary" | "snap-to-live"): void;
  setSpeed(speed: 0.5 | 1 | 1.5 | 2): void;
  holdCurrentMoment(hold: boolean): void;
  viewMoment(momentId: string): void;
  /**
   * Views the moment carrying one event cursor, when the shell's own Chronicle
   * rows no longer cover it.
   *
   * The last resort behind a Chronicle card click: the presentation is the only
   * layer that still knows which moments it keeps, so it either finds the
   * moment or says, on the frame, that it cannot.
   */
  viewCursor(cursor: number): void;
  /**
   * Restores an authoritative spatial card into an isolated historical archive
   * session. Returns false when the bounded recording cannot prove that state,
   * so callers can retain ordinary Chronicle focus behavior.
   */
  replayCursor(cursor: number): Promise<boolean>;
  retryRecovery(): Promise<void>;
  reconnectStream(): void;
  setCameraMode(mode: CameraMode): void;
  requestFocus(selection: Exclude<ObserverSelection, null>): void;
  observeRegion(regionId: string): void;
  openArchiveCatalogue(): Promise<void>;
  loadOlderArchive(): Promise<void>;
  enterArchiveCheckpoint(key: ObserverArchiveCheckpointKey): Promise<void>;
  enterArchive(window: ReplayPresentationWindow): Promise<void>;
  returnToLive(): void;
  dispose(): void;
}

/**
 * Re-attaches the anchor the presentation resolved for a moment.
 *
 * The shell names a moment by id and cursor range; WHERE that moment happened is
 * presentation knowledge, and it rides on the selection `viewMoment` published a
 * moment earlier on the very same click. Without it the renderer can only
 * resolve a moment focus against the scene it is playing right now, which is
 * exactly what made every past Chronicle card a silent dead click.
 *
 * Pure: takes the request and the frame's current selection, returns the request
 * to publish. Never widens a request the caller already anchored, and never
 * borrows an anchor from a DIFFERENT moment.
 */
export function anchoredSelection(
  selection: Exclude<ObserverSelection, null>,
  presented: ObserverSelection,
): Exclude<ObserverSelection, null> {
  if (selection.kind !== "moment" || selection.anchor !== undefined) return selection;
  if (presented === null || presented.kind !== "moment"
    || presented.id !== selection.id || presented.anchor === undefined) return selection;
  return Object.freeze({ ...selection, anchor: presented.anchor });
}

interface ActiveArchive {
  readonly bundle: ProductionArchiveObserverSessionBundle;
  readonly sourceKey: string;
}

interface InFlightCataloguePage {
  readonly generation: number;
  readonly artifacts: ReplayArtifacts;
  readonly promise: Promise<void>;
}

type SelectedArchiveCheckpointIdentity =
  | Readonly<{ kind: "line"; lineNumber: number }>
  | Readonly<{ kind: "checkpoint"; digest: string }>;

const INITIAL_SNAPSHOT: ObserverShellSnapshot = Object.freeze({
  status: "loading",
  frame: null,
  chronicle: null,
  controls: null,
  diagnostics: null,
  placement: null,
  recipes: null,
  placementOwnerId: null,
  placementGeneration: null,
  cameraMode: "story",
  observedRegionId: null,
  focusRequest: null,
  archive: Object.freeze({ status: "inactive" }),
  error: null,
});

/** Owns the one selected Live/Archive observer binding and app-local observer controls. */
export function createObserverShellRuntime(
  options: ObserverShellRuntimeOptions = {},
): ObserverShellRuntime {
  const reducedMotion = options.reducedMotion ?? (() => false);
  const captureTimeline = options.capture;
  const live = options.createLiveBundle === undefined
    ? createProductionObserverSession(captureTimeline === undefined
      ? { reducedMotion }
      : {
          reducedMotion,
          clockFactory: captureTimeline.clockFactory,
          checkpointFeedFactory: captureTimeline.checkpointFeedFactory,
        })
    : options.createLiveBundle({ reducedMotion });
  const createArchive = options.createArchiveBundle
    ?? ((input) => createProductionArchiveObserverSession(captureTimeline === undefined
      ? input
      : { ...input, clockFactory: captureTimeline.clockFactory }));
  const createBinding = options.createBinding ?? createPresentationSessionBinding;
  const replayClient = (options.createReplayArtifactClient ?? createReplayArtifactClient)();
  const makeReplaySession = options.createReplaySession ?? createReplaySession;
  const listeners = new Set<() => void>();
  const acceptanceBySource = new Map<string, PresentationFrameAcceptanceTracker>();
  let binding: PresentationSessionBinding | null = null;
  let unsubscribeBinding: (() => void) | null = null;
  let unsubscribeLiveIdentity: (() => void) | null = null;
  let archive: ActiveArchive | null = null;
  let snapshot = INITIAL_SNAPSHOT;
  let disposed = false;
  const mountedRunRegistration = captureTimeline?.registerMountedRunReplacement(
    (run, world): void => {
      if (!disposed) live.replaceRun(run, world);
    },
  );
  let lifecycleGeneration = 0;
  let archiveGeneration = 0;
  let catalogueGeneration = 0;
  let catalogueRunId: string | null = null;
  let catalogueArtifacts: ReplayArtifacts | null = null;
  let cataloguePageRequest: InFlightCataloguePage | null = null;
  // Assigned before fetching a Chronicle card's artifacts. It represents the
  // latest navigation intent, so an older slow card can never bind after a
  // newer card or a Return to Live.
  let replayRequestGeneration = 0;
  let selectedArchiveCheckpointIdentity: SelectedArchiveCheckpointIdentity | null = null;
  let rebindingToLive = false;
  let liveSourceKey: string | null = null;
  let liveIdentity: Readonly<{ runId: string; sourceKey: string }> | null = null;
  let focusSerial = 0;
  let cameraMode: CameraMode = "story";
  let observedRegionId: string | null = null;
  let focusRequest: ObserverFocusRequest | null = null;
  let archiveState: ObserverArchiveState = Object.freeze({ status: "inactive" });
  let error: ObserverShellSnapshot["error"] = null;
  let notifying = false;
  let pendingNotifications = 0;
  const spatialBridge = createSelectedSpatialBridge();

  const emit = (): void => {
    pendingNotifications += 1;
    if (notifying || disposed) return;
    notifying = true;
    try {
      while (pendingNotifications > 0 && !disposed) {
        pendingNotifications -= 1;
        for (const listener of [...listeners]) {
          if (disposed) break;
          try {
            listener();
          } catch {
            // One observer cannot prevent peers from seeing the retained frame.
          }
        }
      }
    } finally {
      notifying = false;
    }
  };

  const selectedSession = (frame: PresentedObserverFrame): PresentationSession => (
    archive !== null && frame.sourceKey === archive.sourceKey
      ? archive.bundle.session
      : live.session
  );

  const refresh = (): void => {
    if (disposed || binding === null) return;
    const frame = binding.getFrame();
    if (
      frame.source === "live"
      && catalogueRunId !== null
      && catalogueRunId !== frame.runId
    ) {
      catalogueGeneration += 1;
      catalogueRunId = null;
      catalogueArtifacts = null;
      archiveState = Object.freeze({ status: "inactive" });
    }
    if (
      archive !== null
      && frame.source === "live"
      && !rebindingToLive
    ) {
      detachArchive(true);
    }
    const session = selectedSession(frame);
    const resources = frame.source === "archive" && archive !== null
      ? archive.bundle.getResources()
      : live.getResources();
    if (resources !== null) spatialBridge.select(resources);
    snapshot = Object.freeze({
      status: resources === null ? "loading" : "ready",
      frame,
      chronicle: session.getChronicle(),
      controls: session.controls(),
      diagnostics: session.diagnostics(),
      placement: resources === null ? null : spatialBridge.placement,
      recipes: resources === null ? null : spatialBridge.recipes,
      placementOwnerId: resources?.ownerId ?? null,
      placementGeneration: resources?.generation ?? null,
      cameraMode,
      observedRegionId,
      focusRequest,
      archive: archiveState,
      error,
    });
    emit();
  };

  const publishLocalState = (): void => {
    if (disposed) return;
    if (binding === null) {
      snapshot = Object.freeze({
        ...snapshot,
        cameraMode,
        observedRegionId,
        focusRequest,
        archive: archiveState,
        error,
      });
      emit();
      return;
    }
    refresh();
  };

  const registerLiveSource = (frame: PresentedObserverFrame): void => {
    if (liveSourceKey !== null && liveSourceKey !== frame.sourceKey) {
      acceptanceBySource.delete(liveSourceKey);
    }
    liveSourceKey = frame.sourceKey;
    acceptanceBySource.set(frame.sourceKey, live.frameAcceptance);
  };

  function detachArchive(sessionAlreadyDisposed: boolean): void {
    const retained = archive;
    if (retained === null) return;
    archive = null;
    selectedArchiveCheckpointIdentity = null;
    acceptanceBySource.delete(retained.sourceKey);
    archiveState = Object.freeze({ status: "inactive" });
    retained.bundle.dispose({ sessionAlreadyDisposed });
  }

  const enterArchiveWindow = async (
    window: ReplayPresentationWindow,
    selectedKey: ObserverArchiveCheckpointKey | null = null,
    selectedIdentity: SelectedArchiveCheckpointIdentity | null = null,
    requestIsCurrent?: () => boolean,
  ): Promise<void> => {
    if (disposed || binding === null || requestIsCurrent?.() === false) return;
    const liveFrame = live.session.getFrame();
    const acceptedLiveIdentity = Object.freeze({
      runId: liveFrame.runId,
      sourceKey: liveFrame.sourceKey,
    });
    if (window.snapshot.run_id !== liveFrame.runId) {
      error = "archive-unavailable";
      archiveState = Object.freeze({ status: "error" });
      publishLocalState();
      return;
    }
    const seed = live.getRunSeed(liveFrame.runId);
    const liveResources = live.getResources();
    if (seed === null || liveResources === null) {
      error = "archive-unavailable";
      archiveState = Object.freeze({ status: "error" });
      publishLocalState();
      return;
    }
    const retainedArchive = archive;
    const retainedArchiveState = archiveState;
    const request = archiveGeneration + 1;
    archiveGeneration = request;
    archiveState = Object.freeze({ status: "loading" });
    error = null;
    publishLocalState();

    let next: ProductionArchiveObserverSessionBundle | null = null;
    try {
      next = createArchive({
        window,
        runSeed: seed,
        recipes: liveResources.recipes,
        reducedMotion,
      });
      await next.session.ready;
    } catch {
      next?.dispose();
      if (!disposed && request === archiveGeneration && requestIsCurrent?.() !== false) {
        archiveState = retainedArchive === null
          ? Object.freeze({ status: "error" })
          : retainedArchiveState;
        error = "archive-unavailable";
        publishLocalState();
      }
      return;
    }
    if (
      disposed
      || request !== archiveGeneration
      || binding === null
      || archive !== retainedArchive
      || requestIsCurrent?.() === false
    ) {
      next.dispose();
      return;
    }
    const currentLiveFrame = live.session.getFrame();
    const currentLiveResources = live.getResources();
    const currentSeed = live.getRunSeed(acceptedLiveIdentity.runId);
    if (
      currentLiveFrame.runId !== acceptedLiveIdentity.runId
      || currentLiveFrame.sourceKey !== acceptedLiveIdentity.sourceKey
      || currentLiveResources === null
      || currentLiveResources.ownerId !== liveResources.ownerId
      || currentLiveResources.generation !== liveResources.generation
      || currentLiveResources.recipes !== liveResources.recipes
      || currentSeed !== seed
    ) {
      next.dispose();
      archiveState = retainedArchive === null
        ? Object.freeze({ status: "error" })
        : retainedArchiveState;
      error = "archive-unavailable";
      publishLocalState();
      return;
    }
    // A card request fetches its retained artifacts asynchronously. A watcher
    // can pause, change speed, or hold the current view in the same click turn
    // before this fresh archive owner is ready. Carry those controls across
    // before binding so its route clock starts with the viewer's actual choice.
    copyViewerControls(selectedSession(binding.getFrame()), next.session);
    const archiveFrame = next.session.getFrame();
    archive = { bundle: next, sourceKey: archiveFrame.sourceKey };
    selectedArchiveCheckpointIdentity = selectedIdentity;
    acceptanceBySource.set(archiveFrame.sourceKey, next.frameAcceptance);
    archiveState = activeArchiveState(archiveFrame.sourceKey, selectedKey);
    binding.bind(next.session);
    if (retainedArchive !== null) {
      acceptanceBySource.delete(retainedArchive.sourceKey);
      retainedArchive.bundle.dispose();
    }
    refresh();
  };

  const handleLiveIdentity = (): void => {
    if (disposed || binding === null) return;
    const frame = live.session.getFrame();
    const changed = liveIdentity !== null && (
      liveIdentity.runId !== frame.runId || liveIdentity.sourceKey !== frame.sourceKey
    );
    liveIdentity = Object.freeze({ runId: frame.runId, sourceKey: frame.sourceKey });
    registerLiveSource(frame);
    if (!changed) return;
    replayRequestGeneration += 1;
    cameraMode = "story";
    observedRegionId = null;
    focusRequest = null;
    archiveGeneration += 1;
    catalogueGeneration += 1;
    catalogueRunId = null;
    catalogueArtifacts = null;
    archiveState = Object.freeze({ status: "inactive" });
    error = null;
    if (archive !== null) {
      rebindingToLive = true;
      binding.bind(live.session);
      rebindingToLive = false;
      detachArchive(false);
    }
    refresh();
  };

  const candidate = lifecycleGeneration;
  const ready = live.session.ready.then(
    () => {
      if (disposed || candidate !== lifecycleGeneration) return;
      binding = createBinding(live.session);
      const initial = binding.getFrame();
      liveIdentity = Object.freeze({ runId: initial.runId, sourceKey: initial.sourceKey });
      registerLiveSource(initial);
      unsubscribeBinding = binding.subscribe(() => {
        if (disposed || binding === null) return;
        const frame = binding.getFrame();
        if (frame.source === "live") {
          const changed = liveIdentity !== null && (
            liveIdentity.runId !== frame.runId || liveIdentity.sourceKey !== frame.sourceKey
          );
          if (changed) {
            handleLiveIdentity();
            return;
          }
          registerLiveSource(frame);
        }
        refresh();
      });
      unsubscribeLiveIdentity = live.session.subscribe(handleLiveIdentity);
      refresh();
    },
    () => {
      if (disposed || candidate !== lifecycleGeneration) return;
      error = "live-unavailable";
      snapshot = Object.freeze({
        ...snapshot,
        status: "error",
        archive: archiveState,
        error,
      });
      emit();
    },
  );

  return {
    ready,
    frameSource: Object.freeze({
      getSnapshot(): PresentedObserverFrame {
        if (snapshot.frame === null) throw new Error("observer frame source is not ready");
        return snapshot.frame;
      },
      subscribe(listener: () => void): () => void {
        if (disposed) return () => undefined;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
    frameAcceptance: Object.freeze({
      markAccepted(frame): void {
        if (disposed) return;
        acceptanceBySource.get(frame.sourceKey)?.markAccepted(frame);
      },
    }),
    subscribe(listener): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    diagnostics(): PresentationSessionDiagnostics | null {
      if (
        disposed
        || binding === null
        || snapshot.status !== "ready"
        || snapshot.frame === null
      ) return null;
      return selectedSession(snapshot.frame).diagnostics();
    },
    select(selection): void {
      if (binding === null || disposed) return;
      selectedSession(binding.getFrame()).select(selection);
    },
    pause(): void { currentControls(binding, archive, live)?.pause(); },
    resume(choice): void { currentControls(binding, archive, live)?.resume(choice); },
    setSpeed(speed): void {
      const controls = currentControls(binding, archive, live);
      if (controls === null) return;
      controls.setSpeed(speed);
      // Speed is shell diagnostics, not a field in the semantic frame key. A
      // session may therefore retain its frame without notifying us even though
      // its diagnostics changed; refresh so controlled observer UI stays honest.
      if (snapshot.diagnostics?.speed !== speed) refresh();
    },
    holdCurrentMoment(hold): void {
      const controls = currentControls(binding, archive, live);
      if (controls === null) return;
      controls.holdCurrentMoment(hold);
      // Holding changes diagnostics even when the session retains its semantic
      // frame. Publish the control state immediately, as we do for speed.
      if (snapshot.diagnostics?.held !== hold) refresh();
    },
    viewMoment(momentId): void {
      currentControls(binding, archive, live)?.viewMoment(momentId);
    },
    viewCursor(cursor): void {
      currentControls(binding, archive, live)?.viewCursor(cursor);
    },
    async replayCursor(cursor): Promise<boolean> {
      if (!Number.isSafeInteger(cursor) || cursor < 0 || disposed || binding === null) {
        return false;
      }
      const request = replayRequestGeneration + 1;
      replayRequestGeneration = request;
      const superseded = (): boolean => disposed || replayRequestGeneration !== request;
      const liveFrame = live.session.getFrame();
      const acceptedLiveIdentity = Object.freeze({
        runId: liveFrame.runId,
        sourceKey: liveFrame.sourceKey,
      });
      let artifacts = catalogueArtifacts;
      if (artifacts === null || catalogueRunId !== acceptedLiveIdentity.runId) {
        try {
          artifacts = await replayClient.fetchForRun(acceptedLiveIdentity.runId);
        } catch {
          // A newer card or Return to Live already owns the viewer's intent.
          // Report this as handled so the stale click cannot fall through to a
          // moment focus against whichever world happens to be selected now.
          return superseded();
        }
      }
      if (superseded()) return true;
      if (
        live.session.getFrame().runId !== acceptedLiveIdentity.runId
        || live.session.getFrame().sourceKey !== acceptedLiveIdentity.sourceKey
      ) return true;
      if (
        (artifacts.runId !== undefined && artifacts.runId !== acceptedLiveIdentity.runId)
        || artifacts.checkpoints.some((checkpoint) => checkpoint.run_id !== acceptedLiveIdentity.runId)
      ) return false;
      const window = createHistoricalReplayPresentationWindow(artifacts, cursor);
      if (window === null || window.snapshot.run_id !== acceptedLiveIdentity.runId) return false;
      if (superseded()) return true;
      // Keep the exact source around for archive return/re-entry, but do not
      // surface an Archive loading/error state for a card that later falls back.
      if (catalogueArtifacts === null || catalogueRunId !== acceptedLiveIdentity.runId) {
        catalogueArtifacts = artifacts;
        catalogueRunId = acceptedLiveIdentity.runId;
      }
      await enterArchiveWindow(
        window,
        null,
        null,
        () => !disposed && replayRequestGeneration === request,
      );
      if (superseded()) return true;
      return archive?.sourceKey === window.sourceKey;
    },
    retryRecovery(): Promise<void> {
      if (binding === null || disposed) return Promise.resolve();
      return selectedSession(binding.getFrame()).retryRecovery();
    },
    reconnectStream(): void {
      if (binding === null || disposed) return;
      selectedSession(binding.getFrame()).reconnectStream();
    },
    setCameraMode(mode): void {
      if (disposed || mode === cameraMode) return;
      cameraMode = mode;
      publishLocalState();
    },
    requestFocus(selection): void {
      if (disposed) return;
      focusSerial += 1;
      focusRequest = Object.freeze({
        serial: focusSerial,
        selection: structuredClone(anchoredSelection(
          selection,
          binding === null ? null : binding.getFrame().selection,
        )),
      });
      publishLocalState();
    },
    observeRegion(regionId): void {
      if (disposed || regionId.trim() === "" || observedRegionId === regionId) return;
      observedRegionId = regionId;
      publishLocalState();
    },
    async openArchiveCatalogue(): Promise<void> {
      if (disposed || binding === null || archive !== null) return;
      const liveFrame = live.session.getFrame();
      const request = catalogueGeneration + 1;
      catalogueGeneration = request;
      catalogueRunId = liveFrame.runId;
      catalogueArtifacts = null;
      archiveState = Object.freeze({ status: "loading" });
      error = null;
      publishLocalState();
      try {
        const artifacts = await replayClient.fetchForRun(liveFrame.runId);
        if (!catalogueRequestIsCurrent(request, liveFrame.runId)) return;
        installCatalogue(artifacts, liveFrame.runId);
      } catch {
        if (!catalogueRequestIsCurrent(request, liveFrame.runId)) return;
        catalogueArtifacts = null;
        archiveState = Object.freeze({ status: "error" });
        error = "archive-unavailable";
        publishLocalState();
      }
    },
    loadOlderArchive(): Promise<void> {
      if (
        disposed
        || binding === null
        || catalogueArtifacts === null
        || catalogueRunId === null
        || !catalogueArtifacts.hasOlderCheckpoints
      ) return Promise.resolve();
      const prior = catalogueArtifacts;
      const acceptedRunId = catalogueRunId;
      if (
        cataloguePageRequest !== null
        && cataloguePageRequest.generation === catalogueGeneration
        && cataloguePageRequest.artifacts === prior
      ) return cataloguePageRequest.promise;
      const request = catalogueGeneration + 1;
      catalogueGeneration = request;
      if (archive === null) archiveState = Object.freeze({ status: "loading" });
      error = null;
      publishLocalState();
      let fetched: Promise<ReplayArtifacts>;
      try {
        fetched = replayClient.fetchOlderArtifacts(prior);
      } catch {
        if (catalogueRequestIsCurrent(request, acceptedRunId)) {
          if (archive === null) archiveState = Object.freeze({ status: "error" });
          error = "archive-unavailable";
          publishLocalState();
        }
        return Promise.resolve();
      }
      let owned!: InFlightCataloguePage;
      const promise = fetched.then(
        (artifacts) => {
          if (!catalogueRequestIsCurrent(request, acceptedRunId)) return;
          installCatalogue(artifacts, acceptedRunId);
        },
        () => {
          if (!catalogueRequestIsCurrent(request, acceptedRunId)) return;
          if (archive === null) archiveState = Object.freeze({ status: "error" });
          error = "archive-unavailable";
          publishLocalState();
        },
      ).finally(() => {
        if (cataloguePageRequest === owned) cataloguePageRequest = null;
      });
      owned = { generation: request, artifacts: prior, promise };
      cataloguePageRequest = owned;
      return promise;
    },
    async enterArchiveCheckpoint(key): Promise<void> {
      replayRequestGeneration += 1;
      if (
        disposed
        || catalogueArtifacts === null
        || catalogueRunId === null
        || !catalogueContainsKey(catalogueArtifacts, key)
      ) return;
      const request = catalogueGeneration;
      const acceptedRunId = catalogueRunId;
      const selectedIdentity = checkpointIdentityForKey(catalogueArtifacts, key);
      if (selectedIdentity === null) return;
      const replaySession = makeReplaySession();
      const restored = replaySession.restore(catalogueArtifacts, key);
      const window = replaySession.getPresentationWindow();
      if (
        restored.status !== "ready"
        || window === null
        || window.snapshot.run_id !== acceptedRunId
        || !catalogueRequestIsCurrent(request, acceptedRunId)
      ) {
        if (catalogueRequestIsCurrent(request, acceptedRunId)) {
          archiveState = Object.freeze({ status: "error" });
          error = "archive-unavailable";
          publishLocalState();
        }
        return;
      }
      await enterArchiveWindow(window, key, selectedIdentity);
    },
    enterArchive(window): Promise<void> {
      replayRequestGeneration += 1;
      return enterArchiveWindow(window);
    },
    returnToLive(): void {
      // Even before an archive binds, this cancels a slow card request.
      replayRequestGeneration += 1;
      if (disposed || binding === null || archive === null) return;
      archiveGeneration += 1;
      selectedArchiveCheckpointIdentity = null;
      rebindingToLive = true;
      binding.bind(live.session);
      rebindingToLive = false;
      detachArchive(false);
      if (
        catalogueArtifacts !== null
        && catalogueRunId === live.session.getFrame().runId
      ) {
        archiveState = catalogueArtifacts.checkpoints.length === 0
          ? Object.freeze({ status: "empty", hasMore: false })
          : Object.freeze({
              status: "ready",
              checkpoints: catalogueCheckpoints(catalogueArtifacts),
              hasMore: Boolean(catalogueArtifacts.hasOlderCheckpoints),
            });
      }
      error = null;
      refresh();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      lifecycleGeneration += 1;
      archiveGeneration += 1;
      replayRequestGeneration += 1;
      catalogueGeneration += 1;
      catalogueRunId = null;
      catalogueArtifacts = null;
      selectedArchiveCheckpointIdentity = null;
      unsubscribeBinding?.();
      unsubscribeLiveIdentity?.();
      unsubscribeBinding = null;
      unsubscribeLiveIdentity = null;
      binding?.dispose();
      binding = null;
      detachArchive(false);
      acceptanceBySource.clear();
      mountedRunRegistration?.release();
      live.dispose();
      captureTimeline?.dispose();
      spatialBridge.clear();
      listeners.clear();
      pendingNotifications = 0;
      snapshot = Object.freeze({
        ...snapshot,
        status: "disposed",
        placement: null,
        recipes: null,
        placementOwnerId: null,
        placementGeneration: null,
        archive: Object.freeze({ status: "inactive" }),
      });
    },
  };

  function catalogueRequestIsCurrent(request: number, runId: string): boolean {
    return !disposed
      && request === catalogueGeneration
      && catalogueRunId === runId
      && live.session.getFrame().runId === runId;
  }

  function installCatalogue(artifacts: ReplayArtifacts, runId: string): void {
    if (
      artifacts.runId !== undefined && artifacts.runId !== runId
      || artifacts.checkpoints.some((checkpoint) => checkpoint.run_id !== runId)
    ) {
      catalogueArtifacts = null;
      archiveState = Object.freeze({ status: "error" });
      error = "archive-unavailable";
      publishLocalState();
      return;
    }
    catalogueArtifacts = artifacts;
    error = null;
    if (archive !== null && archiveState.status === "active") {
      archiveState = activeArchiveState(
        archive.sourceKey,
        remapSelectedCheckpointKey(artifacts, selectedArchiveCheckpointIdentity),
      );
      publishLocalState();
      return;
    }
    if (artifacts.checkpoints.length === 0) {
      archiveState = Object.freeze({ status: "empty", hasMore: false });
      publishLocalState();
      return;
    }
    archiveState = Object.freeze({
      status: "ready",
      checkpoints: catalogueCheckpoints(artifacts),
      hasMore: Boolean(artifacts.hasOlderCheckpoints),
    });
    publishLocalState();
  }

  function activeArchiveState(
    sourceKey: string,
    selectedKey: ObserverArchiveCheckpointKey | null,
  ): ObserverArchiveState {
    const retained = catalogueArtifacts;
    const validSelected = selectedKey === null ? null : copyCheckpointKey(selectedKey);
    return Object.freeze({
      status: "active",
      sourceKey,
      checkpoints: retained === null ? Object.freeze([]) : catalogueCheckpoints(retained),
      hasMore: retained === null ? false : Boolean(retained.hasOlderCheckpoints),
      selectedKey: validSelected,
    });
  }
}

interface SelectedSpatialBridge {
  readonly placement: PlacementLedger;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  select(resources: ObserverPlacementResources): void;
  clear(): void;
}

/** Keep renderer-facing spatial identities stable while atomically selecting exact source data. */
function createSelectedSpatialBridge(): SelectedSpatialBridge {
  const released = Object.freeze({
    ownerId: Symbol("released-spatial-owner"),
    generation: 0,
    placement: PlacementLedger.reconstruct([], { agents: [], homes: [] }),
    recipes: new Map<string, RegionMapRecipeV1>(),
  }) satisfies ObserverPlacementResources;
  let selected: ObserverPlacementResources = released;
  const placement = new Proxy({} as PlacementLedger, {
    get(_target, property): unknown {
      const target = selected.placement;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(): boolean {
      return false;
    },
  });
  let recipes!: ReadonlyMap<string, RegionMapRecipeV1>;
  recipes = Object.freeze({
    get size(): number {
      return selected.recipes.size;
    },
    get(key: string): RegionMapRecipeV1 | undefined {
      return selected.recipes.get(key);
    },
    has(key: string): boolean {
      return selected.recipes.has(key);
    },
    entries(): MapIterator<[string, RegionMapRecipeV1]> {
      return selected.recipes.entries();
    },
    keys(): MapIterator<string> {
      return selected.recipes.keys();
    },
    values(): MapIterator<RegionMapRecipeV1> {
      return selected.recipes.values();
    },
    forEach(
      callback: (value: RegionMapRecipeV1, key: string, map: ReadonlyMap<string, RegionMapRecipeV1>) => void,
      thisArg?: unknown,
    ): void {
      selected.recipes.forEach((value, key) => callback.call(thisArg, value, key, recipes));
    },
    [Symbol.iterator](): MapIterator<[string, RegionMapRecipeV1]> {
      return selected.recipes[Symbol.iterator]();
    },
    [Symbol.toStringTag]: "Map",
  });
  return Object.freeze({
    placement,
    recipes,
    select(resources: ObserverPlacementResources): void {
      selected = resources;
    },
    clear(): void {
      selected = released;
    },
  });
}

function copyViewerControls(
  from: PresentationSession,
  to: PresentationSession,
): void {
  const source = from.diagnostics();
  const controls = to.controls();
  controls.setSpeed(source.speed);
  if (source.held) controls.holdCurrentMoment(true);
  if (source.paused) controls.pause();
}

function currentControls(
  binding: PresentationSessionBinding | null,
  archive: ActiveArchive | null,
  live: ProductionObserverSessionBundle,
): PresentationControls | null {
  if (binding === null) return null;
  const frame = binding.getFrame();
  return archive !== null && frame.sourceKey === archive.sourceKey
    ? archive.bundle.session.controls()
    : live.session.controls();
}

function catalogueContainsKey(
  artifacts: ReplayArtifacts,
  key: ObserverArchiveCheckpointKey,
): boolean {
  if ("lineNumber" in key) {
    return artifacts.checkpoints.some((checkpoint) => checkpoint.lineNumber === key.lineNumber);
  }
  return Number.isSafeInteger(key.index)
    && key.index >= 0
    && artifacts.checkpoints[key.index] !== undefined
    && artifacts.checkpoints[key.index]!.lineNumber === undefined;
}

function catalogueCheckpoints(
  artifacts: ReplayArtifacts,
): readonly ObserverArchiveCheckpoint[] {
  return Object.freeze(artifacts.checkpoints.map((checkpoint, index) => Object.freeze({
    key: checkpoint.lineNumber === undefined
      ? Object.freeze({ index })
      : Object.freeze({ lineNumber: checkpoint.lineNumber }),
    eventCursor: checkpoint.event_cursor,
    worldTime: checkpoint.world_time,
    reason: publicCheckpointReason(checkpoint.reason),
  })));
}

function copyCheckpointKey(
  key: ObserverArchiveCheckpointKey,
): ObserverArchiveCheckpointKey {
  return "lineNumber" in key
    ? Object.freeze({ lineNumber: key.lineNumber })
    : Object.freeze({ index: key.index });
}

function checkpointIdentityForKey(
  artifacts: ReplayArtifacts,
  key: ObserverArchiveCheckpointKey,
): SelectedArchiveCheckpointIdentity | null {
  if ("lineNumber" in key) {
    return artifacts.checkpoints.some((checkpoint) => checkpoint.lineNumber === key.lineNumber)
      ? Object.freeze({ kind: "line", lineNumber: key.lineNumber })
      : null;
  }
  const checkpoint = artifacts.checkpoints[key.index];
  if (checkpoint === undefined || checkpoint.lineNumber !== undefined) return null;
  return Object.freeze({ kind: "checkpoint", digest: checkpointDigest(checkpoint) });
}

function remapSelectedCheckpointKey(
  artifacts: ReplayArtifacts,
  identity: SelectedArchiveCheckpointIdentity | null,
): ObserverArchiveCheckpointKey | null {
  if (identity === null) return null;
  if (identity.kind === "line") {
    return Object.freeze({ lineNumber: identity.lineNumber });
  }
  const index = artifacts.checkpoints.findIndex(
    (checkpoint) => checkpointDigest(checkpoint) === identity.digest,
  );
  if (index < 0) return null;
  const checkpoint = artifacts.checkpoints[index]!;
  return checkpoint.lineNumber === undefined
    ? Object.freeze({ index })
    : Object.freeze({ lineNumber: checkpoint.lineNumber });
}

function checkpointDigest(checkpoint: SnapshotCheckpoint): string {
  return JSON.stringify([
    checkpoint.run_id,
    checkpoint.event_cursor,
    checkpoint.world_time,
    checkpoint.reason,
    checkpoint.snapshot,
  ]);
}

function publicCheckpointReason(reason: string): string {
  switch (reason.trim().toLowerCase()) {
    case "manual":
      return "Saved moment";
    case "world_tick":
    case "periodic":
      return "World checkpoint";
    case "shutdown":
    case "final":
      return "Run pause";
    case "recovery":
      return "Recovery checkpoint";
    default:
      return "World checkpoint";
  }
}
