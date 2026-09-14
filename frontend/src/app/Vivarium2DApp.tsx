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
import { FollowShortcuts } from "./observer2d/FollowShortcuts";
import { ObserverControls } from "./observer2d/ObserverControls";
import { FollowSubjectControl } from "./observer2d/FollowSubjectControl";
import {
  advanceFollow,
  followableAgentKeys,
  FOLLOW_OFF,
  FOLLOW_RELEASED,
  projectFollowRoster,
  readFollowSubject,
  requestFollow,
  type FollowOutcome,
  type FollowRosterView,
  type FollowSubjectReading,
  type FollowState,
  type FollowTickInput,
} from "./observer2d/followSubject";
import { RunStopControl } from "./observer2d/RunStopControl";
import { resolveObserverLiveness } from "./observer2d/observerLiveness";
import { resolveRunStatus, useRunStopController } from "./observer2d/runStopController";
import type { RunLifecycleCapability } from "./observer2d/runStopController";
import { ChronicleKillfeed, type ChronicleFeedFilter } from "./observer2d/chronicleStream/ChronicleKillfeed";
import {
  parseChronicleBufferMs,
  readChronicleSurfacePreference,
  writeChronicleSurfacePreference,
} from "./observer2d/chronicleStream/chronicleSurfacePreference";
import { useChronicleStream } from "./observer2d/chronicleStream/useChronicleStream";
import { DialogueNow } from "./observer2d/DialogueNow";
import { LivingAtlas2D } from "./observer2d/LivingAtlas2D";
import { ObserverHud } from "./observer2d/ObserverHud";
import { RegionArrivalPlaque } from "./observer2d/RegionArrivalPlaque";
import { LiveAnnouncer, type LiveAnnouncement } from "./observer2d/LiveAnnouncer";
import { SemanticWorldMirror } from "./observer2d/SemanticWorldMirror";
import { SelectionInspector } from "./observer2d/SelectionInspector";
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
import "./QuietObservatory.css";
import "./ObserverDrawers.css";

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
  /**
   * Permission to end this run, granted by whoever started it.
   *
   * Injected rather than imported, and narrowed to two methods, because the
   * observer's own import closure must contain no request verb and no endpoint
   * (`Vivarium2DApp.closure.test.ts` proves it recursively). The gateway owns a
   * run from its first breath to its last and is what hands this down; a
   * fixture, a recording or a capture is handed nothing and grows no control.
   */
  readonly runLifecycle?: RunLifecycleCapability;
  /**
   * Where a viewer goes once the run they were watching is confirmed over.
   *
   * The observer reports the ending; it does not decide what follows. It cannot:
   * it does not know whether it was reached from the gateway (which never
   * navigated — the live world is a state inside it) or from the `?renderer=2d`
   * deep link (which is a route). So the surface that mounted it owns the
   * destination, and a surface that passes nothing simply stays on the ended
   * world reading "Ended" — which is what a recording or a QA route wants.
   *
   * Called at most once, and only after `GET /api/run` itself reports a terminal
   * status for a stop this viewer asked for. A refused stop, or a world still
   * winding down, leaves the viewer exactly where they are.
   */
  readonly onRunEnded?: () => void;
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
  readonly dock?: ObserverChromeRect | null;
}

interface FocusReturnRequest {
  readonly preferred: HTMLElement | null;
  readonly fallbackId: string | null;
}

/**
 * Everything the follow machine reads from one render of the shell.
 *
 * The two fields it does NOT hold — which beings the renderer is currently able
 * to follow, and the clock — are gathered at tick time instead: the first lives
 * in the semantic store, which publishes on its own schedule rather than React's,
 * and the second must be read when the tick runs, not when the render did.
 */
type FollowShellInputs = Omit<FollowTickInput, "followableKeys" | "nowMs">;

/** How long an ended pursuit keeps saying why, before the status line is clean again. */
const FOLLOW_NOTICE_MS = 9_000;

/**
 * What the camera is following when the follow control did not choose it.
 *
 * `follow` predates this control: clicking a being (or a standing home) on the
 * canvas and pressing `F`, or the World drawer's Follow button, both reach it
 * without going through a pursuit. A home cannot be offered in a roster of
 * BEINGS, so naming it here is what stops the control from reading `Automatic`
 * while the camera is demonstrably locked onto something.
 */
function heldCameraSubjectName(
  cameraMode: CameraMode,
  reading: FollowSubjectReading,
  selection: SelectionView | null,
): string | null {
  if (cameraMode !== "follow" || reading.key !== null) return null;
  if (selection === null || (selection.kind !== "home" && selection.kind !== "agent")) return null;
  return selection.title;
}

/** Full-viewport, single-frame production observer for the autonomous world. */
export function Vivarium2DApp({
  createRuntime = createObserverShellRuntime,
  capture,
  renderer,
  chronicleSourceControls,
  chronicleBufferMs,
  runLifecycle,
  onRunEnded,
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
    active: overlay.surface.kind === "chronicle" || overlay.surface.kind === "closed",
    ...(resolvedBufferMs === null ? {} : { bufferMs: resolvedBufferMs }),
  });
  const [chronicleSeenCursor, setChronicleSeenCursor] = useState(0);
  useEffect(() => {
    if (overlay.surface.kind !== "chronicle") return;
    setChronicleSeenCursor(stream.events.at(-1)?.cursor ?? 0);
  }, [overlay.surface.kind, stream.events]);
  const [chronicleFilter, setChronicleFilter] = useState<ChronicleFeedFilter>("world");
  const [viewport, setViewport] = useState(() => readViewport());
  const [cameraControl, setCameraControl] = useState<Readonly<{
    accepted: CameraMode;
    requested: CameraMode;
  }>>(() => Object.freeze({ accepted: "story", requested: "story" }));
  /**
   * Whether the VIEWER is steering, and the serial that hands the camera back.
   *
   * Both live up here because the reading belongs in the HUD, which is the one
   * surface always on screen. The serial is not a mode: a viewer zoom takes
   * camera authority without changing the mode, so a `story` mode request would
   * be deduplicated to nothing before it reached the renderer — the defect that
   * made the retired stage pill inert for anyone who had only zoomed.
   */
  const [viewerControlsCamera, setViewerControlsCamera] = useState(false);
  const [resumeStorySerial, setResumeStorySerial] = useState(0);
  /**
   * WHO the camera is on — the viewer's own choice, and the pursuit that serves it.
   *
   * Kept here rather than in the renderer because the choice spans the whole
   * world while the renderer only ever holds one region: reaching a being in
   * another region means observing that region, waiting for its art, and only
   * then asking the camera for `follow`. `followStateRef` mirrors the state so
   * the tick can read it without being re-created on every transition, and
   * `followNotice` is the VISIBLE half of an ending — the polite announcer is
   * screen-reader-only, and "the being you were following died" is exactly the
   * kind of thing a watcher must be able to see.
   */
  const [followState, setFollowState] = useState<FollowState>(FOLLOW_OFF);
  const [followNotice, setFollowNotice] = useState<LiveAnnouncement | null>(null);
  const followStateRef = useRef<FollowState>(FOLLOW_OFF);
  const followInputsRef = useRef<FollowShellInputs | null>(null);
  const followNoticeSerialRef = useRef(0);
  const [, setFollowPulse] = useState(0);
  /**
   * The latch request handed to the stage, and the selection it will announce back.
   *
   * A serial because a re-latch cannot be said as a camera mode — see
   * `followRequest` on `PresentationWorldStage`. The ref remembers which
   * selection this shell asked for, so the announcement it provokes is not
   * mistaken for a viewer clicking the world and does not pop the Selection
   * drawer over the being they just asked to watch.
   */
  const [followRequest, setFollowRequest] = useState<Readonly<{
    serial: number;
    selection: Exclude<ObserverSelection, null>;
  }> | null>(null);
  const followSelectionRef = useRef<string | null>(null);
  const followRequestSerialRef = useRef(0);
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
  // A run can only be stopped where there IS one. Recordings, fixtures and the
  // capture harness all present the same shell over a source that has no server
  // behind it, and must never grow a button that reaches for one.
  const runStop = useRunStopController({
    enabled: snapshot?.frame?.source === "live",
    ...(runLifecycle === undefined ? {} : { client: runLifecycle }),
    ...(onRunEnded === undefined ? {} : { onEnded: onRunEnded }),
  });
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
    setViewerControlsCamera(false);
    setShellAnnouncement(null);
    // A new run's HUD must not still be naming the previous run's being.
    followStateRef.current = FOLLOW_OFF;
    setFollowState(FOLLOW_OFF);
    setFollowNotice(null);
    setChronicleSeenCursor(0);
    setChronicleFilter("world");
    setFollowRequest(null);
    followSelectionRef.current = null;
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

  /**
   * The world as the follow machine must see it, right now.
   *
   * Null before the shell is ready. The two fields that are not carried on the
   * render's own `followInputsRef` are gathered here: who the renderer can
   * actually follow (the semantic store publishes on its own schedule, not
   * React's) and the clock (read when the tick runs, not when the render did).
   *
   * Side effects: none.
   */
  const followTickInput = useCallback((): FollowTickInput | null => {
    const inputs = followInputsRef.current;
    if (inputs === null) return null;
    return {
      ...inputs,
      followableKeys: followableAgentKeys(
        semanticStore.getCurrent()?.subjects ?? [],
        (token) => semanticTokensRef.current.selectionFor(token),
      ),
      nowMs: Date.now(),
    };
  }, [semanticStore]);

  /**
   * Do the one thing a transition asks for, and record where the pursuit now is.
   *
   * Side effects: may observe a region, may select/focus a being and request the
   * `follow` camera mode, or may hand framing back to the director with a notice.
   */
  const applyFollowOutcome = useCallback((outcome: FollowOutcome): void => {
    const currentRuntime = debugRuntimeRef.current;
    if (currentRuntime === null) return;
    if (outcome.state !== followStateRef.current) {
      followStateRef.current = outcome.state;
      setFollowState(outcome.state);
    }
    switch (outcome.effect.kind) {
      case "observe-region":
        // Deliberately NOT the shell's own `observeRegion`, which also requests
        // Free framing: that is what an Atlas click MEANS ("I chose a place").
        // Here the viewer chose a BEING, and handing the camera to themselves on
        // the way to that being would defeat the pursuit.
        currentRuntime.observeRegion(outcome.effect.regionKey);
        break;
      case "engage": {
        // NOT `runtime.select` + a camera-mode request. That reaches the renderer
        // as a frame-borne selection, which never re-aims a camera that is
        // already following somebody else, and as a `follow` request that every
        // dedup drops as unchanged. The stage's latch does both jobs in one call
        // and announces the selection back the way a canvas click does.
        const agentKey = outcome.effect.agentKey;
        followSelectionRef.current = agentKey;
        setFollowRequest(Object.freeze({
          serial: ++followRequestSerialRef.current,
          selection: { kind: "agent" as const, id: agentKey },
        }));
        break;
      }
      case "abandon": {
        setFollowRequest(null);
        followSelectionRef.current = null;
        followNoticeSerialRef.current += 1;
        const ending = Object.freeze({
          key: `follow-ended:${followNoticeSerialRef.current}`,
          message: outcome.effect.notice,
        });
        setFollowNotice(ending);
        setShellAnnouncement(ending);
        // The serial, never a mode request: a viewer who took the camera by
        // zooming is still nominally in `follow`, and every mode-based dedup
        // between here and the renderer would swallow a plain `story` request.
        setResumeStorySerial((serial) => serial + 1);
        break;
      }
      default:
        break;
    }
  }, []);

  /**
   * Advance the pursuit against the world as it now is, and do the one thing it asks.
   *
   * Called after EVERY render (the machine is idempotent, so an unchanged world
   * returns the identical state and no effect), plus once more when a pursuit's
   * arrival deadline falls due. Never called straight from the renderer's own
   * semantic callback: `select()` republishes the observer frame synchronously,
   * which would re-enter the renderer mid-publication. That path bumps a pulse
   * and lets this run in the ordinary effect instead.
   *
   * Side effects: see {@link applyFollowOutcome}.
   */
  const runFollowTick = useCallback((): void => {
    const input = followTickInput();
    if (input === null) return;
    applyFollowOutcome(advanceFollow(followStateRef.current, input));
  }, [applyFollowOutcome, followTickInput]);

  // Idempotent, and cheap: one map lookup against a machine that returns its own
  // state object when nothing moved. Running it unconditionally is what lets a
  // death, a border crossing, and a hand-driven Follow all be noticed by one path.
  useEffect(() => {
    runFollowTick();
  });

  useEffect(() => {
    if (followState.kind !== "waiting") return undefined;
    const handle = window.setTimeout(
      () => runFollowTick(),
      Math.max(0, followState.deadlineMs - Date.now()) + 1,
    );
    return () => window.clearTimeout(handle);
  }, [followState, runFollowTick]);

  useEffect(() => {
    if (followNotice === null) return undefined;
    const handle = window.setTimeout(() => setFollowNotice(null), FOLLOW_NOTICE_MS);
    return () => window.clearTimeout(handle);
  }, [followNotice]);

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
    // A pursuit waiting for its being to come into view is waiting for exactly
    // this publication. Bumping a pulse re-runs the tick from an ordinary effect
    // rather than from inside the renderer's own callback.
    if (followStateRef.current.kind !== "off") setFollowPulse((pulse) => pulse + 1);
  }, [semanticStore]);

  const resolveShortcutAgentKey = useCallback((token: string): string | null => {
    const selected = semanticTokensRef.current.selectionFor(token);
    return selected?.kind === "agent" ? selected.id : null;
  }, []);

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
  const recorded = frame.source !== "live" || frame.inference?.provider === "fixture";
  const chronicle = snapshot.chronicle;
  const hud = projectObserverHud(frame, snapshot.observedRegionId);
  /**
   * What this run IS, from the two places that can know.
   *
   * The frame's own status rides the SSE heartbeat and is the fresher of the two
   * while the stream is alive; `runStop.confirmedStatus` is the only source left
   * once the stream closes, which is exactly what a stop causes. The more
   * terminal one wins, so a run that ended cannot go on reading as one that is
   * merely offline.
   */
  const runStatus = resolveRunStatus(frame.liveness?.runStatus ?? null, runStop.confirmedStatus);
  // Quiet / behind / disconnected / ended. In this world twenty minutes of silence
  // is normal and the sim self-terminates at `duration`, so a single LIVE pill was
  // the difference between watching and reloading.
  const liveness = resolveObserverLiveness(frame, runStatus);
  const atlas = projectLivingAtlas(frame, chronicle, snapshot.observedRegionId);
  /**
   * The whole world's living beings, offered as the camera's possible subjects.
   *
   * Region names come from the Atlas so both surfaces call a place the same
   * thing, and a being is only offered when this build has art mounted for where
   * they are — the dropdown must not contain a destination the camera cannot go.
   */
  const mountedRecipes = snapshot.recipes;
  const followRoster: FollowRosterView = projectFollowRoster(
    frame,
    new Map(atlas.regions.map((region) => [region.key, region.displayName] as const)),
    (regionKey) => mountedRecipes.has(regionKey),
  );
  followInputsRef.current = {
    roster: followRoster,
    observedRegionKey: snapshot.observedRegionId,
    cameraMode: presentedCameraControl.accepted,
    selectedSubject: frame.selection?.kind === "agent" || frame.selection?.kind === "home"
      ? { kind: frame.selection.kind, id: frame.selection.id }
      : null,
  };
  const followReading = readFollowSubject(followState);
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
  /**
   * Hand the camera back to the story director.
   *
   * A serial bump rather than a mode request, on purpose: see
   * `resumeStorySerial` on `PresentationWorldStage`. A viewer who took the
   * camera by zooming is still nominally in `story` mode, so every mode-based
   * dedup between here and the renderer would swallow the request.
   */
  const requestCameraMode = (mode: CameraMode): void => {
    setCameraControl((current) => current.requested === mode
      ? current
      : Object.freeze({ ...current, requested: mode }));
  };
  /**
   * Stop a shell-owned pursuit before a manual camera gesture publishes its
   * synchronous runtime update. `FOLLOW_RELEASED` blocks the still-accepted
   * Follow mode from immediately adopting the selection again.
   */
  const releaseFollowPursuit = (): void => {
    followStateRef.current = FOLLOW_RELEASED;
    setFollowState(FOLLOW_RELEASED);
    setFollowRequest(null);
    followSelectionRef.current = null;
    setFollowNotice(null);
  };
  /**
   * A zoom is a manual camera gesture even though it deliberately preserves the nominal mode.
   *
   * Only a pursuit still waiting for its subject is cancelled here. Once Follow has latched, zoom
   * remains the existing viewer-authority gesture and the HUD continues to name that subject.
   */
  const releasePendingFollowPursuit = (): void => {
    if (followStateRef.current.kind !== "waiting") return;
    releaseFollowPursuit();
  };
  /**
   * The VIEWER chose a place (an Atlas island click).
   *
   * Requesting Free is the point: they asked to look at somewhere, so the story camera must
   * stop dragging them back to wherever the world happens to be talking.
   */
  const observeRegion = (regionId: string): void => {
    // `runtime.observeRegion` republishes synchronously. Release first, or its
    // follow tick sees the old active pursuit and immediately asks for the
    // followed being's old region before the Free request can be accepted.
    releaseFollowPursuit();
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
    if (mode !== "follow") return;
    setFollowRequest(null);
    followSelectionRef.current = null;
    // The renderer refused: whatever the shell asked for is not something the
    // camera can latch onto. A pursuit that stayed named here would be claiming
    // to follow a being the camera never reached.
    const pursued = followStateRef.current;
    if (pursued.kind !== "off") {
      followStateRef.current = FOLLOW_RELEASED;
      setFollowState(FOLLOW_RELEASED);
      followNoticeSerialRef.current += 1;
      setFollowNotice(Object.freeze({
        key: `follow-refused:${followNoticeSerialRef.current}`,
        message: `${pursued.name} could not be followed. Auto framing resumed.`,
      }));
      setResumeStorySerial((serial) => serial + 1);
    }
    setShellAnnouncement(Object.freeze({
      key: `follow-rejected:${snapshot.frame!.sourceKey}:${snapshot.frame!.presentedCursor}`,
      message: "Follow requires a visible being or standing home.",
    }));
  };

  /**
   * The viewer picked a being to follow.
   *
   * Begins a pursuit rather than a camera request: the chosen being may be in a
   * region whose art is not up yet, and the renderer resolves `follow` only
   * against what it is currently rendering.
   */
  const chooseFollowSubject = (agentKey: string): void => {
    const input = followTickInput();
    if (input === null) return;
    setFollowNotice(null);
    applyFollowOutcome(requestFollow(agentKey, input));
  };
  /**
   * The viewer chose Automatic. Ends the pursuit and hands framing back.
   *
   * The same serial the framing control drives, for the same reason: a viewer
   * who took the camera by zooming is still nominally in whatever mode they
   * were in, so only the serial is guaranteed to arrive.
   */
  const releaseFollowSubject = (): void => {
    // RELEASED, not merely off: the camera is still nominally in `follow` until
    // the renderer accepts the story request below, and a plain `off` would let
    // the machine re-adopt the very being this press walked away from.
    releaseFollowPursuit();
    setResumeStorySerial((serial) => serial + 1);
  };

  const selectFromCanvas = (next: ObserverSelection): void => {
    runtime.select(next);
    // A follow the viewer asked for from the HUD announces a selection too, and
    // it must not throw the Selection drawer over the being they chose to watch.
    const asked = followSelectionRef.current;
    followSelectionRef.current = null;
    if (asked !== null && next?.kind === "agent" && next.id === asked) return;
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

  const followCameraChoice = (): void => {
    if (selection?.kind === "home") {
      releaseFollowPursuit();
      requestCameraMode("follow");
      return;
    }
    const chosen = followReading.key
      ?? (frame.selection?.kind === "agent" ? frame.selection.id : null)
      ?? followRoster.candidates.find((being) => being.regionKey === snapshot.observedRegionId)?.key
      ?? followRoster.candidates[0]?.key;
    if (chosen !== undefined && chosen !== null) chooseFollowSubject(chosen);
  };
  const cameraControls = (withTransport: boolean): ReactElement => <ObserverControls
    mode={presentedCameraControl.accepted}
    viewerControlled={viewerControlsCamera}
    followAvailable={followRoster.candidates.length > 0 || selection?.kind === "home"}
    onAuto={releaseFollowSubject}
    onFollow={followCameraChoice}
    onFree={() => { releaseFollowPursuit(); requestCameraMode("free"); }}
    subjectControl={<FollowSubjectControl
      candidates={followRoster.candidates}
      subject={followReading}
      heldSubjectName={heldCameraSubjectName(presentedCameraControl.accepted, followReading, selection)}
      notice={followNotice?.message ?? null}
      onFollow={chooseFollowSubject}
      onRelease={releaseFollowSubject}
    />}
    {...(withTransport ? { transport: { paused, liveness, onPause: runtime.pause, onResume: () => runtime.resume() } } : {})}
  />;

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
            onCameraAuthorityChange: setViewerControlsCamera,
            onSemanticSnapshot: acceptSemanticSnapshot,
          }}
          followRequest={followRequest}
          onManualCameraGesture={releasePendingFollowPursuit}
          resumeStorySerial={resumeStorySerial}
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
        <ObserverHud view={hud} liveness={liveness} controls={<>
          {frame.source === "live" && runLifecycle !== undefined && <RunStopControl
            status={runStatus}
            requested={runStop.requested || runStop.sending}
            error={runStop.error}
            onStop={runStop.requestStop}
          />}
        </>} />

        <nav className="observer-edge-triggers" aria-label="Observer panels">
          <span className="observer-model-badge" title={!recorded
            ? frame.inference?.model ?? "Model identity unavailable"
            : "Recorded world; no live model inference"}>
            {recorded ? "Recorded world"
              : frame.inference?.provider === "mlx" ? (frame.inference.model.toLowerCase().includes("qwen") ? "Qwen · Local" : "MLX · Local")
              : frame.inference?.provider === "gemini" ? "Gemini · API"
              : frame.inference?.provider === "ollama" ? "Ollama" : "World"}
          </span>
          <button id="observer-world-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "world"}
            onClick={(event) => openSurface({ kind: "world" }, event.currentTarget)}>World</button>
          <button id="observer-chronicle-trigger" type="button" aria-label="Chronicle" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "chronicle"}
            onClick={(event) => openSurface({ kind: "chronicle" }, event.currentTarget)}>Chronicle
            {overlay.surface.kind !== "chronicle" && stream.events.some((event) => event.cursor > chronicleSeenCursor)
              && <span className="observer-unread-count">{stream.events.filter((event) => event.cursor > chronicleSeenCursor).length}<span className="observer-unread-count__suffix"> new</span></span>}
          </button>
          <button id="observer-selection-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "selection"}
            onClick={(event) => openSurface({ kind: "selection" }, event.currentTarget)}>Selection</button>
          <button id="observer-archive-trigger" type="button" aria-controls={PRIMARY_SURFACE_ID}
            aria-expanded={overlay.surface.kind === "archive"}
            onClick={(event) => openArchive(event.currentTarget)}>Archive</button>
        </nav>
      </div>

      {overlay.surface.kind === "closed" && <section className="observer-panel observer-dock"
        aria-label="Scene controls">
        <DialogueNow
          view={dialogue}
          onFocusSpeaker={chooseFollowSubject}
          onFocusTarget={chooseFollowSubject}
        />
        <div className="observer-dock__beings" aria-label="Beings to follow">
          <span className="observer-control-label">In view &amp; active · {hud.regionDisplayName}</span>
          <button type="button" onClick={(event) => openSurface({ kind: "world" }, event.currentTarget)}>
            Beings · {hud.livingAgents}
          </button>
        </div>
        <FollowShortcuts
          frameIdentity={frame}
          store={semanticStore}
          resolveAgentKey={resolveShortcutAgentKey}
          roster={followRoster}
          events={stream.events}
          nowMs={stream.clockMs}
          followedKey={followReading.key}
          observedRegionKey={snapshot.observedRegionId}
          onFollow={chooseFollowSubject}
        />
        {cameraControls(true)}
      </section>}

      {overlay.surface.kind !== "closed" && <div id={PRIMARY_SURFACE_ID}
        className="observer-primary-surface" data-surface={overlay.surface.kind}
        role={viewport.width <= MOBILE_SURFACE_BREAKPOINT ? "dialog" : "complementary"}
        aria-modal={viewport.width <= MOBILE_SURFACE_BREAKPOINT ? "true" : undefined}
        aria-labelledby={surfaceHeadingId(overlay.surface.kind)}>
      {overlay.surface.kind === "world" && <WorldDrawer
        hud={hud}
        cameraControls={cameraControls(false)}
        liveness={liveness}
        atlas={atlas}
        paused={paused}
        speed={speed}
        hold={held}
        onPause={runtime.pause}
        onResume={() => runtime.resume()}
        onSpeedChange={runtime.setSpeed}
        onHoldChange={runtime.holdCurrentMoment}
        onRetryRecovery={() => void runtime.retryRecovery()}
        onObserveRegion={observeRegion}
        onInspectRegion={inspectRegion}
        onClose={closeSurface}
      />}
      {overlay.surface.kind === "chronicle" && (
        <ChronicleKillfeed
          stream={stream}
          filter={chronicleFilter}
          onFilterChange={setChronicleFilter}
          nearbyRegionId={snapshot.observedRegionId}
          followingBeingId={followReading.key}
          onStopFollowing={releaseFollowSubject}
          cameraControls={cameraControls(false)}
          gaps={chronicleView.gaps}
          paused={paused}
          speed={speed}
          onPause={runtime.pause}
          onResume={() => runtime.resume()}
          onSpeedChange={runtime.setSpeed}
          onViewCursor={(cursor) => viewCursor(runtime, chronicleView, cursor)}
          onFocusBeing={chooseFollowSubject}
          onOpenArchive={() => openArchive()}
          onClose={closeSurface}
          activeMomentRange={chronicleView.now === null ? null : {
            firstCursor: chronicleView.now.firstCursor,
            lastCursor: chronicleView.now.lastCursor,
          }}
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
          controls={cameraControls(true)}
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
          controls={cameraControls(true)}
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
    bottom: surface === "closed" ? 176 : 16,
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
  const dock = usableChromeRect(rects.dock ?? null) ? rects.dock! : rects.dialogue;
  const mobile = width <= MOBILE_SURFACE_BREAKPOINT;
  const bottomOf = (rect: ObserverChromeRect | null): number | null => (
    usableChromeRect(rect) ? rect.y + rect.height : null
  );
  const horizontalMobileTriggers = usableChromeRect(rects.triggers)
    && rects.triggers.width >= rects.triggers.height;
  const top = mobile
    ? Math.max(
        bottomOf(rects.hud) ?? 104,
        horizontalMobileTriggers ? (bottomOf(rects.triggers) ?? 0) : 0,
      ) + gap
    : Math.max(bottomOf(rects.hud) ?? 56, horizontalMobileTriggers ? (bottomOf(rects.triggers) ?? 0) : 0) + gap;
  const bottomBoundary = mobile
    ? Math.min(...[
        surface === "closed" ? dock : null,
        surface === "closed" ? null : rects.drawer,
      ].filter(usableChromeRect).map((rect) => rect.y), height) - gap
    : (surface === "closed"
        ? usableChromeRect(dock) ? dock.y : height - 168
        : height - gap) - gap;
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
  narrativeSlotOwner: "dialogue" | "empty",
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
      dialogue: ".dialogue-now",
      dock: ".observer-dock",
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

/**
 * Who owns the bottom narrative slot on this frame.
 *
 * Only dialogue does, now. The slot used to be shared with the NOW card, which
 * was retired (owner direction, Safi, 2026-08-22) because it duplicated the
 * Chronicle feed's job; the reading survives because the safe-frame measurement
 * has to be re-bound whenever the element it measures appears or disappears.
 */
function presentedNarrativeSlotOwner(
  snapshot: OwnedRuntimeView["snapshot"],
): "dialogue" | "empty" {
  if (snapshot?.status !== "ready" || snapshot.frame === null || snapshot.chronicle === null) {
    return "empty";
  }
  return projectDialogueNow(snapshot.frame, snapshot.chronicle) === null ? "empty" : "dialogue";
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
  // No row means the moment has already left the rows this shell was given. The
  // presentation is the only layer that still knows what it keeps, so the click
  // falls through to it -- which either finds the moment or SAYS it cannot,
  // instead of the silent return that made an evicted card a dead click.
  if (row === undefined) {
    runtime.viewCursor(cursor);
    return;
  }
  viewMoment(runtime, chronicle, row.key);
}

/**
 * The collapsed peek: a count, a pulse, and the newest glyph.
 *
 * The killfeed is closable because the region is the main course. This is what
 * remains when it is closed -- enough to see that the world is doing something,
 * and one click away from the feed itself.
 */
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
  cameraControls,
  liveness,
  atlas,
  paused,
  speed,
  hold,
  onPause,
  onResume,
  onSpeedChange,
  onHoldChange,
  onRetryRecovery,
  onObserveRegion,
  onInspectRegion,
  onClose,
}: Readonly<{
  hud: ReturnType<typeof projectObserverHud>;
  cameraControls: ReactNode;
  liveness: ReturnType<typeof resolveObserverLiveness>;
  atlas: ReturnType<typeof projectLivingAtlas>;
  paused: boolean;
  speed: 0.5 | 1 | 1.5 | 2;
  hold: boolean;
  onPause: () => void;
  onResume: () => void;
  onSpeedChange: (speed: 0.5 | 1 | 1.5 | 2) => void;
  onHoldChange: (hold: boolean) => void;
  onRetryRecovery: () => void;
  onObserveRegion: (regionId: string) => void;
  onInspectRegion: (regionId: string) => void;
  onClose: () => void;
}>): ReactElement {
  return (
    <section className="observer-panel observer-drawer observer-drawer--quiet world-drawer" aria-labelledby="world-drawer-heading">
      <header className="observer-drawer__header">
        <div className="observer-drawer__title">
          <h2 id="world-drawer-heading" tabIndex={-1}>World</h2>
          <p className="observer-drawer__subtitle">Explore regions. Find your next moment.</p>
        </div>
        <button type="button" aria-label="Close World" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        <div className="world-drawer__overview" aria-label="World overview">
          <div><strong>{hud.livingAgents}</strong><span>living beings</span></div>
          <div><strong>{atlas.regions.length}</strong><span>regions</span></div>
          <div className="world-drawer__state"><span className="observer-kicker">World</span><strong title={liveness.detail}>{liveness.label}</strong></div>
        </div>
        <div className="observer-drawer__camera">{cameraControls}</div>

        <LivingAtlas2D view={atlas} onObserveRegion={onObserveRegion}
          onInspectRegion={onInspectRegion} />

        <section className="world-drawer__controls" aria-labelledby="world-playback-heading">
          <h3 id="world-playback-heading">Playback</h3>
          <div className="world-drawer__control-row">
            <button type="button" aria-label={paused ? "Resume view" : "Pause view"}
              onClick={paused ? onResume : onPause}>{paused ? "Resume view" : "Pause view"}</button>
            <label>
              <span>Speed</span>
              <select aria-label="View speed" value={speed}
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
          <p className="observer-drawer__hint">Pause your view, or hold the current moment on screen.</p>
        </section>

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
            <div><dt>View</dt><dd>{hud.pendingMoments === 0 ? "Caught up" : hud.backlogLabel}</dd></div>
          </dl>
          <details className="world-drawer__technical">
            <summary>Event delivery</summary>
            <dl>
              <div><dt>Shown</dt><dd>{hud.presentedCursor}</dd></div>
              <div><dt>Received</dt><dd>{hud.receivedCursor}</dd></div>
            </dl>
          </details>
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
