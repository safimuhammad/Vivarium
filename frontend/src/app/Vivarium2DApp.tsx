import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";

import type {
  CameraMode,
  FrameIdentity,
  ObserverSelection,
  PresentedObserverFrame,
  SafeFrameInsets,
} from "../presentation/contracts";
import {
  PresentationWorldStage,
  type ProductionStageCaptureInjection,
} from "../renderer2d/production/PresentationWorldStage";
import { ArchiveDrawer } from "./observer2d/ArchiveDrawer";
import { resolveObserverLiveness } from "./observer2d/observerLiveness";
import { ChronicleKillfeed } from "./observer2d/chronicleStream/ChronicleKillfeed";
import { StreamGlyph } from "./observer2d/chronicleStream/StreamGlyph";
import {
  parseChronicleBufferMs,
  readChronicleSurfacePreference,
  writeChronicleSurfacePreference,
} from "./observer2d/chronicleStream/chronicleSurfacePreference";
import type { StreamEvent } from "./observer2d/chronicleStream/streamEvent";
import { useChronicleStream } from "./observer2d/chronicleStream/useChronicleStream";
import { DialogueNow } from "./observer2d/DialogueNow";
import { LivingAtlas2D } from "./observer2d/LivingAtlas2D";
import { ObserverHud } from "./observer2d/ObserverHud";
import { RegionArrivalPlaque } from "./observer2d/RegionArrivalPlaque";
import { LiveAnnouncer, type LiveAnnouncement } from "./observer2d/LiveAnnouncer";
import { SemanticWorldMirror } from "./observer2d/SemanticWorldMirror";
import { SelectionInspector } from "./observer2d/SelectionInspector";
import { StoryNow } from "./observer2d/StoryNow";
import {
  createObserverShellRuntime,
  type ObserverArchiveCheckpointKey,
  type ObserverShellRuntime,
  type ObserverShellRuntimeOptions,
  type ObserverShellSnapshot,
} from "./observer2d/observerShellRuntime";
import {
  INITIAL_OBSERVER_OVERLAY_STATE,
  reduceObserverOverlay,
  type ObserverPrimarySurface,
} from "./observer2d/overlayState";
import {
  projectArchiveCatalogue,
  projectChronicle,
  projectDialogueNow,
  projectLivingAtlas,
  projectObserverHud,
  projectSelection,
  projectStoryNow,
  type ArchiveCatalogueProjectionInput,
  type ChronicleView,
  type SelectionView,
  type StoryNowView,
} from "./observer2d/publicViewModels";
import {
  createSemanticWorldStore,
  projectSemanticWorld,
  sameFrameIdentity,
  SemanticSubjectTokenRegistry,
} from "./observer2d/semanticWorld";
import type { RendererSemanticSnapshot } from "../renderer2d/production/semantics";
import { installProductionStageDebugProbe } from "../renderer2d/production/debug";
import type { SharedAtlasPool } from "../renderer2d/production/assets/SharedAtlasPool";
import type { AtlasCommitScheduler } from "../renderer2d/production/AtlasCommitScheduler";

import "./Vivarium2DApp.css";

const PRIMARY_SURFACE_ID = "observer-primary-surface";
const MOBILE_SURFACE_BREAKPOINT = 760;

export interface Vivarium2DAppProps {
  readonly createRuntime?: (options?: ObserverShellRuntimeOptions) => ObserverShellRuntime;
  readonly renderer?: Readonly<{
    atlasPool?: SharedAtlasPool;
    atlasCommitScheduler?: AtlasCommitScheduler;
  }>;
  readonly capture?: Readonly<{
    runtime: NonNullable<ObserverShellRuntimeOptions["capture"]>;
    stage: ProductionStageCaptureInjection;
  }>;
  /**
   * Route-local controls folded into the Chronicle killfeed's transport cluster.
   *
   * The QA chronicle route passes its chronicle picker and review controls here
   * so that its old full-width bottom bar has nowhere left to stretch across the
   * screen. Production passes nothing.
   */
  readonly chronicleSourceControls?: ReactNode;
  /** Killfeed retention window override, in milliseconds. */
  readonly chronicleBufferMs?: number;
}

interface OwnedRuntimeView {
  readonly factory: (() => ObserverShellRuntime) | null;
  readonly runtime: ObserverShellRuntime | null;
  readonly snapshot: ObserverShellSnapshot | null;
}

interface ObserverChromeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ObserverChromeRects {
  readonly hud: ObserverChromeRect | null;
  readonly dialogue: ObserverChromeRect | null;
  readonly triggers: ObserverChromeRect | null;
  readonly drawer: ObserverChromeRect | null;
}

interface FocusReturnRequest {
  readonly preferred: HTMLElement | null;
  readonly fallbackId: string | null;
}

/** Full-viewport, single-frame production observer for the autonomous world. */
export function Vivarium2DApp({
  createRuntime = createObserverShellRuntime,
  capture,
  renderer,
  chronicleSourceControls,
  chronicleBufferMs,
}: Vivarium2DAppProps): ReactElement {
  const appRef = useRef<HTMLElement>(null);
  const debugStateRef = useRef<OwnedRuntimeView["snapshot"]>(null);
  const debugRuntimeRef = useRef<ObserverShellRuntime | null>(null);
  const reactCommitCountRef = useRef(0);
  reactCommitCountRef.current += 1;
  const reducedMotion = useMediaPreference("(prefers-reduced-motion: reduce)");
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;
  const reducedMotionGetter = useCallback(() => reducedMotionRef.current, []);
  const { runtime, snapshot } = useOwnedObserverRuntime(
    createRuntime,
    reducedMotionGetter,
    capture?.runtime,
  );
  debugStateRef.current = snapshot;
  debugRuntimeRef.current = runtime;
  const [overlay, dispatchOverlay] = useReducer(
    reduceObserverOverlay,
    INITIAL_OBSERVER_OVERLAY_STATE,
    (initial) => (readChronicleSurfacePreference()
      ? Object.freeze({ surface: Object.freeze({ kind: "chronicle" as const }) })
      : initial),
  );
  const resolvedBufferMs = chronicleBufferMs
    ?? parseChronicleBufferMs(window.location.search);
  // The killfeed's buffer lives here, above the surface, so a viewer who closes
  // the feed and reopens it does not find the world's recent history erased --
  // and so the collapsed peek can report what happened while it was shut.
  const stream = useChronicleStream({
    frame: snapshot?.frame ?? null,
    chronicle: snapshot?.chronicle ?? null,
    active: overlay.surface.kind === "chronicle",
    ...(resolvedBufferMs === null ? {} : { bufferMs: resolvedBufferMs }),
  });
  const [viewport, setViewport] = useState(() => readViewport());
  const [cameraControl, setCameraControl] = useState<Readonly<{
    accepted: CameraMode;
    requested: CameraMode;
  }>>(() => Object.freeze({ accepted: "story", requested: "story" }));
  const snapshotLineage = snapshot?.frame === null || snapshot?.frame === undefined
    ? null
    : `${snapshot.frame.runId}\u0000${snapshot.frame.sourceKey}`;
  const cameraLineageRef = useRef(snapshotLineage);
  const cameraLineageChanged = snapshotLineage !== null
    && cameraLineageRef.current !== null
    && cameraLineageRef.current !== snapshotLineage;
  const presentedCameraControl = cameraLineageChanged
    ? Object.freeze({ accepted: "story" as const, requested: "story" as const })
    : cameraControl;
  const semanticStore = useMemo(() => createSemanticWorldStore(), []);
  const [shellAnnouncement, setShellAnnouncement] = useState<LiveAnnouncement | null>(null);
  const semanticTokensRef = useRef(new SemanticSubjectTokenRegistry());
  const observedRegionRef = useRef(snapshot?.observedRegionId ?? null);
  observedRegionRef.current = snapshot?.observedRegionId ?? null;
  const openerRef = useRef<HTMLElement | null>(null);
  const pendingFocusReturnRef = useRef<FocusReturnRequest | null>(null);
  const ready = runtime !== null
    && snapshot?.status === "ready"
    && snapshot.frame !== null
    && snapshot.chronicle !== null
    && snapshot.placement !== null
    && snapshot.recipes !== null;
  const narrativeSlotOwner = presentedNarrativeSlotOwner(snapshot);
  const safeFrame = useMeasuredObserverSafeFrame(
    appRef,
    overlay.surface.kind,
    viewport.width,
    viewport.height,
    ready,
    narrativeSlotOwner,
  );

  useEffect(() => {
    const surface = appRef.current;
    if (surface === null) return undefined;
    const registration = installProductionStageDebugProbe(surface, Object.freeze({
      snapshot: () => {
        const current = debugStateRef.current;
        const source = current?.frame?.source ?? null;
        return Object.freeze({
          reactCommitCount: reactCommitCountRef.current,
          stageCount: surface.querySelectorAll(".presentation-world-stage").length,
          liveSessions: debugRuntimeRef.current === null ? 0 : 1,
          archiveSessions: source === "archive" ? 1 : 0,
          source,
          runId: current?.frame?.runId ?? null,
          frameIdentity: current?.frame === null || current?.frame === undefined
            ? null
            : Object.freeze({
                runId: current.frame.runId,
                sourceKey: current.frame.sourceKey,
                firstCursor: current.frame.firstCursor,
                lastCursor: current.frame.lastCursor,
                revision: current.frame.revision,
              }),
          captureFrame: capture === undefined ? null : current?.frame ?? null,
          scene: current?.frame?.scene ?? null,
          presentedCursor: current?.frame?.presentedCursor ?? null,
          archiveStatus: current?.archive.status ?? null,
          session: debugRuntimeRef.current?.diagnostics() ?? null,
          placementGeneration: current?.placementGeneration ?? null,
        });
      },
    }));
    return () => registration.release();
  }, [capture]);

  useEffect(() => {
    const onResize = (): void => setViewport(readViewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (snapshotLineage === null) return;
    const previous = cameraLineageRef.current;
    cameraLineageRef.current = snapshotLineage;
    if (previous === null || previous === snapshotLineage) return;
    setCameraControl(Object.freeze({ accepted: "story", requested: "story" }));
    setShellAnnouncement(null);
  }, [snapshotLineage]);

  useEffect(() => {
    if (snapshot?.status !== "ready") return;
    setCameraControl((current) => current.accepted === snapshot.cameraMode
      || current.requested !== current.accepted
      ? current
      : Object.freeze({ accepted: snapshot.cameraMode, requested: snapshot.cameraMode }));
  }, [snapshot?.cameraMode, snapshot?.status]);

  useEffect(() => {
    const request = pendingFocusReturnRef.current;
    if (request === null) return;
    pendingFocusReturnRef.current = null;
    const target = request.preferred?.isConnected === true
      ? request.preferred
      : request.fallbackId === null
        ? null
        : document.getElementById(request.fallbackId);
    target?.focus();
  }, [overlay.surface.kind]);

  useEffect(() => {
    if (overlay.surface.kind === "closed") return;
    document.getElementById(surfaceHeadingId(overlay.surface.kind))?.focus();
  }, [overlay.surface.kind]);

  useEffect(() => {
    if (overlay.surface.kind === "closed") return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      pendingFocusReturnRef.current = focusReturnRequest(overlay.surface, openerRef.current);
      dispatchOverlay({ type: "escape" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay.surface.kind]);

  useEffect(() => {
    if (overlay.surface.kind === "closed" || viewport.width > MOBILE_SURFACE_BREAKPOINT) {
      return undefined;
    }
    const surface = document.getElementById(PRIMARY_SURFACE_ID);
    if (surface === null) return undefined;
    const onTrapFocus = (event: KeyboardEvent): void => {
      if (event.key !== "Tab" || event.defaultPrevented) return;
      const focusable = focusableElements(surface);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable.at(-1)!;
      const activeIndex = document.activeElement instanceof HTMLElement
        ? focusable.indexOf(document.activeElement)
        : -1;
      if (event.shiftKey && (document.activeElement === first || activeIndex === -1)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || activeIndex === -1)) {
        event.preventDefault();
        first.focus();
      }
    };
    surface.addEventListener("keydown", onTrapFocus);
    return () => surface.removeEventListener("keydown", onTrapFocus);
  }, [overlay.surface.kind, viewport.width]);

  useLayoutEffect(() => {
    const frame = snapshot?.frame;
    if (frame === null || frame === undefined) return;
    const semanticView = semanticStore.getCurrent();
    if (semanticView === null || sameFrameIdentity(semanticView.frameIdentity, frame)) return;
    if (sameLineage(semanticView.frameIdentity, frame)) return;
    if (focusedSubjectToken() !== null) {
      focusWorldCanvas();
      setShellAnnouncement(Object.freeze({
        key: `subject-removed:${frame.sourceKey}:${frame.revision}`,
        message: "The focused world subject is no longer present.",
      }));
    }
    semanticTokensRef.current.clear();
    semanticStore.clear();
  }, [semanticStore, snapshot?.frame]);

  const acceptSemanticSnapshot = useCallback((next: RendererSemanticSnapshot): void => {
    const currentRuntime = debugRuntimeRef.current;
    if (currentRuntime === null) return;
    const selectedFrame = currentRuntime.frameSource.getSnapshot();
    if (!sameFrameIdentity(selectedFrame, next.frameIdentity)) return;
    const currentView = semanticStore.getCurrent();
    if (currentView !== null && !sameLineage(currentView.frameIdentity, next.frameIdentity)) {
      if (focusedSubjectToken() !== null) {
        focusWorldCanvas();
        setShellAnnouncement(Object.freeze({
          key: `subject-removed:${next.frameIdentity.sourceKey}:${next.frameIdentity.revision}`,
          message: "The focused world subject is no longer present.",
        }));
      }
      semanticTokensRef.current.clear();
      semanticStore.clear();
    }
    const projected = projectSemanticWorld(
      selectedFrame,
      next,
      semanticTokensRef.current,
      observedRegionRef.current,
      semanticStore.getCurrent(),
    );
    if (projected === null) return;
    const focusedToken = focusedSubjectToken();
    if (focusedToken !== null
      && !projected.subjects.some((subject) => subject.token === focusedToken)) {
      focusWorldCanvas();
      setShellAnnouncement(Object.freeze({
        key: `subject-removed:${focusedToken}:${selectedFrame.presentedCursor}`,
        message: "The focused world subject is no longer present.",
      }));
    }
    semanticStore.publish(projected);
  }, [semanticStore]);

  const selectSemanticSubject = useCallback((token: string): void => {
    const currentRuntime = debugRuntimeRef.current;
    const next = semanticTokensRef.current.selectionFor(token);
    if (currentRuntime === null || next === null) return;
    currentRuntime.select(next);
    currentRuntime.requestFocus(next);
  }, []);

  const followSemanticSubject = useCallback((token: string): void => {
    const currentRuntime = debugRuntimeRef.current;
    const subject = semanticStore.getCurrent()?.subjects.find(
      (candidate) => candidate.token === token,
    );
    const next = semanticTokensRef.current.selectionFor(token);
    if (currentRuntime === null || subject === undefined || next === null) return;
    currentRuntime.select(next);
    currentRuntime.requestFocus(next);
    if (!subject.canFollow) {
      const currentFrame = currentRuntime.frameSource.getSnapshot();
      setShellAnnouncement(Object.freeze({
        key: `follow-rejected:${token}:${currentFrame.presentedCursor}`,
        message: "Follow requires a visible being or standing home.",
      }));
      return;
    }
    setCameraControl((current) => current.requested === "follow"
      ? current
      : Object.freeze({ ...current, requested: "follow" }));
  }, [semanticStore]);

  if (!ready) {
    return (
      <main ref={appRef} className="vivarium-2d-app vivarium-2d-app--loading" aria-label="Loading the Vivarium">
        <section className="observer-panel vivarium-2d-app__loading-card">
          <span className="observer-kicker">Vivarium</span>
          <p>{snapshot?.status === "error"
            ? "The observer could not reach the world."
            : "The world is coming into view…"}</p>
        </section>
      </main>
    );
  }

  const frame = snapshot.frame;
  const chronicle = snapshot.chronicle;
  const hud = projectObserverHud(frame, snapshot.observedRegionId);
  // Quiet / behind / disconnected / ended. In this world twenty minutes of silence
  // is normal and the sim self-terminates at `duration`, so a single LIVE pill was
  // the difference between watching and reloading.
  const liveness = resolveObserverLiveness(frame);
  const atlas = projectLivingAtlas(frame, chronicle, snapshot.observedRegionId);
  const dialogue = projectDialogueNow(frame, chronicle);
  const chronicleView = projectChronicle(frame, chronicle);
  const storyNow = projectStoryNow(frame, chronicleView);
  const selection = projectSelection(frame, chronicle);
  const archive = projectArchive(snapshot.archive);
  const paused = snapshot.diagnostics?.paused ?? false;
  const speed = snapshot.diagnostics?.speed ?? 1;
  const held = snapshot.diagnostics?.held ?? false;
  const openSurface = (
    surface: Exclude<ObserverPrimarySurface, { kind: "closed" }>,
    opener: HTMLElement | null,
  ): void => {
    openerRef.current = opener;
    if (surface.kind === "chronicle") writeChronicleSurfacePreference(true);
    dispatchOverlay({ type: "open", surface });
  };
  const closeSurface = (): void => {
    if (overlay.surface.kind === "chronicle") writeChronicleSurfacePreference(false);
    pendingFocusReturnRef.current = focusReturnRequest(overlay.surface, openerRef.current);
    dispatchOverlay({ type: "close" });
  };
  const requestCameraMode = (mode: CameraMode): void => {
    setCameraControl((current) => current.requested === mode
      ? current
      : Object.freeze({ ...current, requested: mode }));
  };
  /**
   * The VIEWER chose a place (an Atlas island click).
   *
   * Requesting Free is the point: they asked to look at somewhere, so the story camera must
   * stop dragging them back to wherever the world happens to be talking.
   */
  const observeRegion = (regionId: string): void => {
    runtime.observeRegion(regionId);
    requestCameraMode("free");
  };
  /**
   * The STAGE reported which region is on screen. Not a viewer choice — an announcement.
   *
   * The shell still needs it, so the badge and the chrome name the same place. It must NOT
   * request a camera mode: a run "that opens inside a region opens LATCHED inside it"
   * (`CanvasPresentationRenderer`'s first-sheet scope adoption) publishes a `scope: "region"`
   * navigation state before the viewer has touched anything, and routing that through
   * {@link observeRegion} handed the camera to the viewer at boot — measured live, `frameBeat`
   * then skipped with `viewer-controls-camera` for the entire run and no beat was ever framed,
   * so the legibility grammar never left its low-zoom stud form. Every genuinely
   * viewer-initiated path already claims the camera by itself: `panCamera` and `zoomCamera`
   * call `takeViewerCameraControl`, an island descent calls it directly, and the Atlas click
   * goes through {@link observeRegion} above.
   */
  const syncObservedRegion = (regionId: string): void => {
    runtime.observeRegion(regionId);
  };
  const acceptCameraMode = (mode: CameraMode): void => {
    setCameraControl(Object.freeze({ accepted: mode, requested: mode }));
    runtime.setCameraMode(mode);
  };
  const rejectCameraMode = (mode: CameraMode): void => {
    setCameraControl((current) => current.requested !== mode
      ? current
      : Object.freeze({ ...current, requested: current.accepted }));
    if (mode === "follow") setShellAnnouncement(Object.freeze({
      key: `follow-rejected:${snapshot.frame!.sourceKey}:${snapshot.frame!.presentedCursor}`,
      message: "Follow requires a visible being or standing home.",
    }));
  };

  const selectFromCanvas = (next: ObserverSelection): void => {
    runtime.select(next);
    if (next !== null) openSurface({ kind: "selection" }, worldCanvasElement());
  };
  const inspectRegion = (regionId: string): void => {
    const next = { kind: "region" as const, id: regionId };
    runtime.select(next);
    runtime.requestFocus(next);
    openSurface({ kind: "selection" }, document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
  };
  const openArchive = (opener: HTMLElement | null = document.getElementById("observer-archive-trigger")): void => {
    openSurface({ kind: "archive" }, opener);
    if (snapshot.archive.status === "inactive" || snapshot.archive.status === "error") {
      void runtime.openArchiveCatalogue();
    }
  };

  return (
    <main ref={appRef} className="vivarium-2d-app" data-camera-mode={presentedCameraControl.accepted}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-presented-source={frame.source} data-presented-cursor={frame.presentedCursor}>
      <div className="vivarium-2d-app__world">
        <PresentationWorldStage
          atlasPool={renderer?.atlasPool}
          atlasCommitScheduler={renderer?.atlasCommitScheduler}
          capture={capture?.stage}
          frameSource={runtime.frameSource}
          placement={snapshot.placement}
          recipes={snapshot.recipes}
          frameAcceptance={runtime.frameAcceptance}
          safeFrame={safeFrame}
          reducedMotion={reducedMotion}
          cameraMode={presentedCameraControl.requested}
          focusRequest={snapshot.focusRequest}
          observedRegionId={snapshot.observedRegionId}
          callbacks={{
            onSelectionChange: selectFromCanvas,
            onCameraModeChange: acceptCameraMode,
            onSemanticSnapshot: acceptSemanticSnapshot,
          }}
          onCameraModeRequestRejected={rejectCameraMode}
          regionOrder={atlas.regions.map((region) => region.key)}
          activeMomentId={chronicleView.now?.key ?? null}
          onViewMoment={(momentId) => viewMoment(runtime, chronicleView, momentId)}
          onObserveRegion={syncObservedRegion}
        />
      </div>

      <RegionArrivalPlaque regionName={hud.regionDisplayName} reducedMotion={reducedMotion} />

      {overlay.surface.kind !== "selection" && (
        <SemanticWorldMirror store={semanticStore}
          onSelect={selectSemanticSubject} onFollow={followSemanticSubject} />
      )}

      <div className="observer-top-chrome">
        <ObserverHud view={hud} />

        <nav className="observer-edge-triggers" aria-label="Observer panels">
          <button id="observer-world-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "world"}
            onClick={(event) => openSurface({ kind: "world" }, event.currentTarget)}>World</button>
          <button id="observer-chronicle-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "chronicle"}
            onClick={(event) => openSurface({ kind: "chronicle" }, event.currentTarget)}>Chronicle</button>
          <button id="observer-selection-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "selection"}
            onClick={(event) => openSurface({ kind: "selection" }, event.currentTarget)}>Selection</button>
          <button id="observer-archive-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "archive"}
            onClick={(event) => openArchive(event.currentTarget)}>Archive</button>
        </nav>
      </div>

      {overlay.surface.kind !== "chronicle" && stream.events.length > 0 && (
        <ChroniclePeek
          latest={stream.events.at(-1)!}
          held={stream.diagnostics.eventCount}
          onOpen={(opener) => openSurface({ kind: "chronicle" }, opener)}
        />
      )}

      <DialogueNow
        view={dialogue}
        onFocusSpeaker={(id) => focusAgent(runtime, id)}
        onFocusTarget={(id) => focusAgent(runtime, id)}
      />

      <StoryNow
        view={storyNow}
        dialogueActive={dialogue !== null}
        onViewMoment={(momentId) => viewMoment(runtime, chronicleView, momentId)}
      />

      {overlay.surface.kind !== "closed" && <div id={PRIMARY_SURFACE_ID}
        className="observer-primary-surface" data-surface={overlay.surface.kind}
        role={viewport.width <= MOBILE_SURFACE_BREAKPOINT ? "dialog" : "complementary"}
        aria-modal={viewport.width <= MOBILE_SURFACE_BREAKPOINT ? "true" : undefined}
        aria-labelledby={surfaceHeadingId(overlay.surface.kind)}>
      {overlay.surface.kind === "world" && <WorldDrawer
        hud={hud}
        liveness={liveness}
        atlas={atlas}
        paused={paused}
        speed={speed}
        hold={held}
        cameraMode={presentedCameraControl.accepted}
        onPause={runtime.pause}
        onResume={() => runtime.resume()}
        onSpeedChange={runtime.setSpeed}
        onHoldChange={runtime.holdCurrentMoment}
        onCameraModeChange={requestCameraMode}
        onRetryRecovery={() => void runtime.retryRecovery()}
        onObserveRegion={observeRegion}
        onInspectRegion={inspectRegion}
        onClose={closeSurface}
      />}
      {overlay.surface.kind === "chronicle" && (
        <ChronicleKillfeed
          stream={stream}
          gaps={chronicleView.gaps}
          paused={paused}
          speed={speed}
          onPause={runtime.pause}
          onResume={() => runtime.resume()}
          onSpeedChange={runtime.setSpeed}
          onViewCursor={(cursor) => viewCursor(runtime, chronicleView, cursor)}
          onFocusBeing={(beingId) => focusAgent(runtime, beingId)}
          onOpenArchive={() => openArchive()}
          onClose={closeSurface}
          liveness={liveness}
          notices={frame.notices ?? []}
          onReconnect={() => runtime.reconnectStream()}
          {...(chronicleSourceControls === undefined
            ? {}
            : { sourceControls: chronicleSourceControls })}
        />
      )}
      {overlay.surface.kind === "selection" && (
        <SelectionInspector
          view={selection}
          subjectNavigation={<SemanticWorldMirror store={semanticStore} visuallyHidden={false}
            onSelect={selectSemanticSubject} onFollow={followSemanticSubject} />}
          onFocus={() => focusSelection(runtime, frame.selection, selection, chronicleView)}
          onClear={() => runtime.select(null)}
          onClose={closeSurface}
        />
      )}
      {overlay.surface.kind === "archive" && (
        <ArchiveDrawer
          view={archive.view}
          archiveBound={snapshot.archive.status === "active"}
          onEnterCheckpoint={(key) => {
            const decoded = archive.keys.get(key);
            if (decoded !== undefined) void runtime.enterArchiveCheckpoint(decoded);
          }}
          onLoadOlder={() => { void runtime.loadOlderArchive(); }}
          onReturnLive={runtime.returnToLive}
          onClose={closeSurface}
        />
      )}
      </div>}
      <LiveAnnouncer announcement={shellAnnouncement ?? announceFrame(frame, chronicleView, storyNow)}
        onAnnounced={(key) => setShellAnnouncement((current) => (
          current?.key === key ? null : current
        ))} />
    </main>
  );
}

function readViewport(): Readonly<{ width: number; height: number }> {
  return Object.freeze({ width: window.innerWidth, height: window.innerHeight });
}

export function observerSafeFrame(
  surface: ObserverPrimarySurface["kind"],
  viewportWidth: number,
  viewportHeight: number,
): SafeFrameInsets {
  if (viewportWidth <= MOBILE_SURFACE_BREAKPOINT) {
    return Object.freeze({
      top: 112,
      right: 8,
      bottom: surface === "closed"
        ? 128
        : Math.max(0, Math.round(viewportHeight * 0.48) - 112),
      left: 8,
    });
  }
  const drawer = Math.min(416, viewportWidth * 0.36);
  return Object.freeze({
    top: 64,
    right: surface === "closed" ? 56 : Math.round(drawer) + 20,
    bottom: 176,
    left: 20,
  });
}

/**
 * Derive a rectangular camera-safe area from the chrome that is actually on screen.
 *
 * `stageWidth`/`stageHeight` must be the size of the box `rects` are measured relative
 * to (the app element's own bounding box), NOT necessarily the full browser viewport --
 * those differ whenever something outside the app element already reserves space around
 * it (e.g. the QA chronicle route insets `.vivarium-2d-app` by its own chrome; see
 * `chromeInsets.ts`). Passing the raw viewport size there would double-count that
 * reservation and over-measure the resulting inset.
 */
export function observerSafeFrameFromRects(
  stageWidth: number,
  stageHeight: number,
  surface: ObserverPrimarySurface["kind"],
  rects: ObserverChromeRects,
): SafeFrameInsets {
  const width = Math.max(1, stageWidth);
  const height = Math.max(1, stageHeight);
  const gap = 8;
  const mobile = width <= MOBILE_SURFACE_BREAKPOINT;
  const bottomOf = (rect: ObserverChromeRect | null): number | null => (
    usableChromeRect(rect) ? rect.y + rect.height : null
  );
  const horizontalMobileTriggers = mobile
    && usableChromeRect(rects.triggers)
    && rects.triggers.width >= rects.triggers.height;
  const top = mobile
    ? Math.max(
        bottomOf(rects.hud) ?? 104,
        horizontalMobileTriggers ? (bottomOf(rects.triggers) ?? 0) : 0,
      ) + gap
    : (bottomOf(rects.hud) ?? 56) + gap;
  const bottomBoundary = mobile
    ? Math.min(...[
        rects.dialogue,
        surface === "closed" ? null : rects.drawer,
      ].filter(usableChromeRect).map((rect) => rect.y), height) - gap
    : (usableChromeRect(rects.dialogue) ? rects.dialogue.y : height - 168) - gap;
  const left = mobile
    ? gap
    : 20;
  const rightBoundary = Math.min(...[
    horizontalMobileTriggers
      ? width
      : (usableChromeRect(rects.triggers) ? rects.triggers.x : width - 44),
    !mobile && surface !== "closed" && usableChromeRect(rects.drawer) ? rects.drawer.x : width,
  ]) - gap;
  const clampedTop = clampChromeInset(top, 0, height - 1);
  const clampedLeft = clampChromeInset(left, 0, width - 1);
  const clampedRightBoundary = clampChromeInset(rightBoundary, clampedLeft + 1, width);
  const clampedBottomBoundary = clampChromeInset(bottomBoundary, clampedTop + 1, height);
  return Object.freeze({
    top: clampedTop,
    right: width - clampedRightBoundary,
    bottom: height - clampedBottomBoundary,
    left: clampedLeft,
  });
}

function useMeasuredObserverSafeFrame(
  appRef: RefObject<HTMLElement | null>,
  surfaceKind: ObserverPrimarySurface["kind"],
  viewportWidth: number,
  viewportHeight: number,
  ready: boolean,
  narrativeSlotOwner: "dialogue" | "story" | "empty",
): SafeFrameInsets {
  const fallback = useMemo(() => observerSafeFrame(
    surfaceKind,
    viewportWidth,
    viewportHeight,
  ), [surfaceKind, viewportHeight, viewportWidth]);
  const [measured, setMeasured] = useState<SafeFrameInsets>(fallback);

  useLayoutEffect(() => {
    const app = appRef.current;
    if (!ready || app === null) {
      setMeasured((current) => sameSafeFrame(current, fallback) ? current : fallback);
      return undefined;
    }
    const selectors = Object.freeze({
      hud: ".observer-hud",
      dialogue: ".dialogue-now, .story-now",
      triggers: ".observer-edge-triggers",
      drawer: ".observer-primary-surface .observer-drawer",
    });
    const measure = (): void => {
      const appBounds = app.getBoundingClientRect();
      const measuredRects = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
        const element = app.querySelector<HTMLElement>(selector);
        if (element === null) return [key, null];
        const bounds = element.getBoundingClientRect();
        return [key, {
          x: bounds.left - appBounds.left,
          y: bounds.top - appBounds.top,
          width: bounds.width,
          height: bounds.height,
        }];
      })) as unknown as ObserverChromeRects;
      if (!Object.values(measuredRects).some(usableChromeRect)) {
        setMeasured((current) => sameSafeFrame(current, fallback) ? current : fallback);
        return;
      }
      // Bound the safe frame by the app element's OWN measured box, not the raw browser
      // viewport. `measuredRects` above are already app-local (each rect's `x`/`y` is
      // offset by `appBounds.left`/`appBounds.top`), so the box they must be bounded
      // against has to be that same local frame's size. The two coincide on the plain
      // production route (`.vivarium-2d-app` is `position: fixed; inset: 0`, i.e. always
      // the full viewport) but diverge on the QA chronicle route, where
      // `.chronicle-validation-route .vivarium-2d-app` is inset by the QA chrome's own
      // measured top/bottom height (see `chromeInsets.ts`) -- there, `appBounds.height`
      // is the viewport height *minus* that QA chrome, while `viewportHeight` stays the
      // full window height. Passing the full window height here previously double-counted
      // the QA inset: once by shrinking the rects' own container, and again by measuring
      // the leftover boundary against a height that was never actually available to this
      // app box, over-measuring the bottom inset by the exact size of the QA chrome (e.g.
      // 267px/366px reserved by QA chrome computed as available stage on a 742px/647px-tall
      // stage -- only ~30% of it left as "safe").
      const next = observerSafeFrameFromRects(
        appBounds.width,
        appBounds.height,
        surfaceKind,
        measuredRects,
      );
      setMeasured((current) => sameSafeFrame(current, next) ? current : next);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(app);
    for (const selector of Object.values(selectors)) {
      const element = app.querySelector<HTMLElement>(selector);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [
    appRef,
    fallback,
    narrativeSlotOwner,
    ready,
    surfaceKind,
    viewportHeight,
    viewportWidth,
  ]);

  return measured;
}

function presentedNarrativeSlotOwner(
  snapshot: OwnedRuntimeView["snapshot"],
): "dialogue" | "story" | "empty" {
  if (snapshot?.status !== "ready" || snapshot.frame === null || snapshot.chronicle === null) {
    return "empty";
  }
  if (projectDialogueNow(snapshot.frame, snapshot.chronicle) !== null) return "dialogue";
  const chronicle = projectChronicle(snapshot.frame, snapshot.chronicle);
  return projectStoryNow(snapshot.frame, chronicle) === null ? "empty" : "story";
}

function usableChromeRect(rect: ObserverChromeRect | null): rect is ObserverChromeRect {
  return rect !== null
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    && rect.width > 0
    && rect.height > 0;
}

function clampChromeInset(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? Math.round(value) : minimum));
}

function sameSafeFrame(left: SafeFrameInsets, right: SafeFrameInsets): boolean {
  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left;
}

function useOwnedObserverRuntime(
  factory: (options?: ObserverShellRuntimeOptions) => ObserverShellRuntime,
  reducedMotion: () => boolean,
  capture: ObserverShellRuntimeOptions["capture"],
): OwnedRuntimeView {
  const [owned, setOwned] = useState<OwnedRuntimeView>({
    factory: null,
    runtime: null,
    snapshot: null,
  });

  useEffect(() => {
    let active = true;
    const runtime = factory({ reducedMotion, capture });
    const publish = (): void => {
      if (!active) return;
      setOwned({ factory, runtime, snapshot: runtime.getSnapshot() });
    };
    const unsubscribe = runtime.subscribe(publish);
    publish();
    void runtime.ready.then(publish, publish);
    return () => {
      active = false;
      unsubscribe();
      runtime.dispose();
    };
  }, [capture, factory, reducedMotion]);

  return owned.factory === factory ? owned : { factory: null, runtime: null, snapshot: null };
}

function useMediaPreference(query: string): boolean {
  const [matches, setMatches] = useState(() => (
    typeof window.matchMedia === "function" && window.matchMedia(query).matches
  ));
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function announceFrame(
  frame: PresentedObserverFrame,
  chronicle: ChronicleView,
  storyNow: StoryNowView | null,
): LiveAnnouncement | null {
  if (storyNow?.kind === "checkpoint") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:${frame.revision}:checkpoint:${storyNow.segmentIndex}`,
    message: `${storyNow.title}. ${storyNow.summary}`,
  });
  if (chronicle.now !== null && frame.scene !== null) return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:${frame.presentedCursor}:now:${chronicle.now.key}:${frame.scene.phase}`,
    message: `${chronicle.now.title}. ${chronicle.now.summary}`,
  });
  if (frame.transport.connection === "recovery-paused") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:transport:recovery-paused`,
    message: "World recovery is paused.",
  });
  if (frame.transport.connection === "rejoining") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:transport:rejoining`,
    message: "Rejoining the world.",
  });
  if (frame.transport.connection === "offline" || frame.transport.connection === "error") {
    return Object.freeze({
      key: `${frame.runId}:${frame.sourceKey}:transport:${frame.transport.connection}`,
      message: "The world connection is resting.",
    });
  }
  if (frame.backlog.state === "caught-up") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:backlog:caught-up`,
    message: "Caught up.",
  });
  if (frame.backlog.state === "paused") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:backlog:paused`,
    message: "Story presentation is paused.",
  });
  if (frame.backlog.state === "behind" || frame.backlog.state === "overflow") return Object.freeze({
    key: `${frame.runId}:${frame.sourceKey}:backlog:${frame.backlog.state}`,
    message: "The world moved ahead.",
  });
  return null;
}

function surfaceHeadingId(kind: Exclude<ObserverPrimarySurface["kind"], "closed">): string {
  switch (kind) {
    case "world": return "world-drawer-heading";
    case "chronicle": return "chronicle-drawer-heading";
    case "selection": return "selection-inspector-heading";
    case "archive": return "archive-drawer-heading";
  }
}

function focusReturnRequest(
  surface: ObserverPrimarySurface,
  preferred: HTMLElement | null,
): FocusReturnRequest {
  return Object.freeze({
    preferred,
    fallbackId: surface.kind === "closed" ? null : `observer-${surface.kind}-trigger`,
  });
}

function focusableElements(root: HTMLElement): readonly HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    "button:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
  )];
}

function focusedSubjectToken(): string | null {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement.dataset.subjectToken ?? null
    : null;
}

function focusWorldCanvas(): void {
  worldCanvasElement()?.focus();
}

function worldCanvasElement(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    ".presentation-world-stage__canvas, [aria-label='Vivarium world'], [aria-label='Production world']",
  );
}

function sameLineage(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId && left.sourceKey === right.sourceKey;
}

function projectArchive(state: ObserverShellSnapshot["archive"]): Readonly<{
  view: ReturnType<typeof projectArchiveCatalogue>;
  keys: ReadonlyMap<string, ObserverArchiveCheckpointKey>;
}> {
  const keys = new Map<string, ObserverArchiveCheckpointKey>();
  let input: ArchiveCatalogueProjectionInput;
  switch (state.status) {
    case "loading": input = { state: "loading" }; break;
    case "error": input = { state: "error" }; break;
    case "inactive":
    case "empty": input = { state: "empty" }; break;
    case "ready":
    case "active": {
      const selected = state.status === "active" ? state.selectedKey : null;
      input = {
        state: "ready",
        records: state.checkpoints.map((checkpoint) => {
          const key = encodeArchiveKey(checkpoint.key);
          keys.set(key, checkpoint.key);
          return {
            key,
            worldTime: checkpoint.worldTime,
            eventCursor: checkpoint.eventCursor,
            reason: checkpoint.reason,
            selected: selected !== null && sameArchiveKey(checkpoint.key, selected),
          };
        }),
        hasMore: state.hasMore,
      };
      break;
    }
  }
  return Object.freeze({ view: projectArchiveCatalogue(input), keys });
}

function encodeArchiveKey(key: ObserverArchiveCheckpointKey): string {
  return "lineNumber" in key ? `line:${key.lineNumber}` : `index:${key.index}`;
}

function sameArchiveKey(
  left: ObserverArchiveCheckpointKey,
  right: ObserverArchiveCheckpointKey,
): boolean {
  return "lineNumber" in left
    ? "lineNumber" in right && left.lineNumber === right.lineNumber
    : "index" in right && left.index === right.index;
}

function focusAgent(runtime: ObserverShellRuntime, id: string): void {
  const selection = { kind: "agent" as const, id };
  runtime.select(selection);
  runtime.requestFocus(selection);
}

function viewMoment(
  runtime: ObserverShellRuntime,
  chronicle: ChronicleView,
  momentId: string,
): void {
  runtime.viewMoment(momentId);
  const row = chronicle.now?.key === momentId
    ? chronicle.now
    : chronicle.previous.find((candidate) => candidate.key === momentId) ?? null;
  if (row !== null) {
    runtime.requestFocus({
      kind: "moment",
      id: momentId,
      firstCursor: row.firstCursor,
      lastCursor: row.lastCursor,
    });
  }
}

/**
 * Navigates the world to the moment that carries one event cursor.
 *
 * The killfeed is an event-level surface but the observer's own navigation is
 * moment-level, so a card click resolves to the enclosing moment and then takes
 * the *existing* production path -- `viewMoment` plus a moment focus request --
 * rather than reaching for the camera itself.
 */
function viewCursor(
  runtime: ObserverShellRuntime,
  chronicle: ChronicleView,
  cursor: number,
): void {
  const rows = chronicle.now === null ? chronicle.previous : [chronicle.now, ...chronicle.previous];
  const row = rows.find(
    (candidate) => candidate.firstCursor <= cursor && cursor <= candidate.lastCursor,
  );
  if (row === undefined) return;
  viewMoment(runtime, chronicle, row.key);
}

/**
 * The collapsed peek: a count, a pulse, and the newest glyph.
 *
 * The killfeed is closable because the region is the main course. This is what
 * remains when it is closed -- enough to see that the world is doing something,
 * and one click away from the feed itself.
 */
function ChroniclePeek({
  latest,
  held,
  onOpen,
}: Readonly<{
  latest: StreamEvent;
  held: number;
  onOpen: (opener: HTMLElement) => void;
}>): ReactElement {
  return (
    <button
      type="button"
      className="chronicle-peek"
      style={{ ["--accent" as string]: latest.accent }}
      aria-controls={PRIMARY_SURFACE_ID}
      aria-label={`Open Chronicle. ${held} events held. Latest: ${latest.narration.line}`}
      onClick={(event) => onOpen(event.currentTarget)}
    >
      <span className="chronicle-peek__pulse" aria-hidden="true" />
      <span className="chronicle-peek__glyph" aria-hidden="true">
        <StreamGlyph name={latest.glyph} size={10} />
      </span>
      <b>{held}</b>
    </button>
  );
}

function focusSelection(
  runtime: ObserverShellRuntime,
  selected: ObserverSelection,
  publicSelection: SelectionView | null,
  chronicle: ChronicleView,
): void {
  if (selected !== null) {
    runtime.requestFocus(selected);
    return;
  }
  if (publicSelection?.kind !== "moment") return;
  const row = chronicle.now?.key === publicSelection.key
    ? chronicle.now
    : chronicle.previous.find((candidate) => candidate.key === publicSelection.key) ?? null;
  if (row !== null) runtime.requestFocus({
    kind: "moment",
    id: row.key,
    firstCursor: row.firstCursor,
    lastCursor: row.lastCursor,
  });
}

function WorldDrawer({
  hud,
  liveness,
  atlas,
  paused,
  speed,
  hold,
  cameraMode,
  onPause,
  onResume,
  onSpeedChange,
  onHoldChange,
  onCameraModeChange,
  onRetryRecovery,
  onObserveRegion,
  onInspectRegion,
  onClose,
}: Readonly<{
  hud: ReturnType<typeof projectObserverHud>;
  liveness: ReturnType<typeof resolveObserverLiveness>;
  atlas: ReturnType<typeof projectLivingAtlas>;
  paused: boolean;
  speed: 0.5 | 1 | 1.5 | 2;
  hold: boolean;
  cameraMode: CameraMode;
  onPause: () => void;
  onResume: () => void;
  onSpeedChange: (speed: 0.5 | 1 | 1.5 | 2) => void;
  onHoldChange: (hold: boolean) => void;
  onCameraModeChange: (mode: CameraMode) => void;
  onRetryRecovery: () => void;
  onObserveRegion: (regionId: string) => void;
  onInspectRegion: (regionId: string) => void;
  onClose: () => void;
}>): ReactElement {
  return (
    <section className="observer-panel observer-drawer world-drawer" aria-labelledby="world-drawer-heading">
      <header className="observer-drawer__header">
        <h2 id="world-drawer-heading" tabIndex={-1}>World</h2>
        <button type="button" aria-label="Close World" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        <section className="world-drawer__controls" aria-labelledby="world-playback-heading">
          <h3 id="world-playback-heading">Playback</h3>
          <div className="world-drawer__control-row">
            <button type="button" aria-label={paused ? "Resume story" : "Pause story"}
              onClick={paused ? onResume : onPause}>{paused ? "Resume" : "Pause"}</button>
            <label>
              <span>Speed</span>
              <select aria-label="Story speed" value={speed}
                onChange={(event) => onSpeedChange(parseSpeed(event.currentTarget.value))}>
                <option value="0.5">0.5×</option>
                <option value="1">1×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
            </label>
            <button type="button" aria-pressed={hold} onClick={() => onHoldChange(!hold)}>
              {hold ? "Release Now" : "Hold Now"}
            </button>
          </div>
        </section>

        <fieldset className="world-drawer__camera">
          <legend>Camera</legend>
          <div className="world-drawer__control-row">
            {(["story", "follow", "free"] as const).map((mode) => (
              <button key={mode} type="button" aria-pressed={cameraMode === mode}
                onClick={() => onCameraModeChange(mode)}>{labelCameraMode(mode)}</button>
            ))}
          </div>
        </fieldset>

        <LivingAtlas2D view={atlas} onObserveRegion={onObserveRegion}
          onInspectRegion={onInspectRegion} />

        <section className="world-drawer__diagnostics" aria-labelledby="world-diagnostics-heading">
          <h3 id="world-diagnostics-heading">World status</h3>
          <p>{hud.livingAgents} living {hud.livingAgents === 1 ? "being" : "beings"} in the presented world.</p>
          {hud.unresolvedAgentStatuses > 0 && (
            <p>{hud.unresolvedAgentStatuses} records await a checkpoint.</p>
          )}
          <dl>
            <div><dt>Time</dt><dd>{hud.humanTimeLabel}</dd></div>
            <div>
              <dt>World</dt>
              <dd title={liveness.detail}>{liveness.label}</dd>
            </div>
            <div><dt>Connection</dt><dd>{connectionLabel(hud.connection)}</dd></div>
            <div><dt>Story</dt><dd>{hud.pendingMoments === 0 ? "Caught up" : hud.backlogLabel}</dd></div>
            <div><dt>Shown</dt><dd>{hud.presentedCursor}</dd></div>
            <div><dt>Received</dt><dd>{hud.receivedCursor}</dd></div>
          </dl>
          {hud.connection === "recovery-paused" && hud.retryable && (
            <button type="button" onClick={onRetryRecovery}>Retry world recovery</button>
          )}
        </section>
      </div>
    </section>
  );
}

function parseSpeed(value: string): 0.5 | 1 | 1.5 | 2 {
  const speed = Number(value);
  return speed === 0.5 || speed === 1 || speed === 1.5 || speed === 2 ? speed : 1;
}

function connectionLabel(connection: ReturnType<typeof projectObserverHud>["connection"]): string {
  switch (connection) {
    case "live": return "Live";
    case "connecting": return "Connecting";
    case "rejoining": return "Rejoining";
    case "recovery-paused": return "Recovery paused";
    case "offline": return "Offline";
    case "error": return "Connection resting";
  }
}

function labelCameraMode(mode: CameraMode): string {
  return mode[0].toUpperCase() + mode.slice(1);
}
