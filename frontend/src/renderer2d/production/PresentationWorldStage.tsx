import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";

import type {
  ObserverRendererCallbacks,
  ObserverRendererFailure,
  ObserverRendererPort,
  WorldNavigationState,
} from "../../presentation/rendererPort";
import type {
  CameraMode,
  FrameIdentity,
  ObserverSelection,
  PresentedObserverFrame,
  SafeFrameInsets,
} from "../../presentation/contracts";
import type { PresentationFrameAcceptanceTracker } from "../../presentation/PresentationFrameSink";
import {
  installProductionStageDebugProbe,
  type ProductionStageDebugRegistration,
} from "./debug";
import type { RegionMapRecipeV1 } from "./maps/RegionMapRecipe";
import type { PlacementLedger } from "./placement/PlacementLedger";
import type { SharedAtlasPool } from "./assets/SharedAtlasPool";
import type { ProductionSceneSignal } from "./ProductionSceneBridge";
import type { ProductionCanvasSceneRendererOptions } from "./ProductionCanvasSceneFactory";
import type { AtlasCommitScheduler } from "./AtlasCommitScheduler";
import type { RendererSemanticSnapshot } from "./semantics";
import {
  arrowPanDelta,
  DRAG_DEAD_ZONE_CSS,
  isClickGesture,
  wheelNavigationIntent,
} from "./input/WorldNavigationInput";

import "./PresentationWorldStage.css";

export interface PresentationFrameSource {
  getSnapshot(): PresentedObserverFrame;
  subscribe(listener: () => void): () => void;
}

export interface PresentationWorldStageProps {
  readonly frameSource: PresentationFrameSource;
  readonly placement: PlacementLedger;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1> | readonly RegionMapRecipeV1[];
  readonly atlasPool?: SharedAtlasPool;
  readonly atlasCommitScheduler?: AtlasCommitScheduler;
  readonly capture?: ProductionStageCaptureInjection;
  readonly callbacks?: ObserverRendererCallbacks;
  readonly safeFrame?: SafeFrameInsets;
  readonly reducedMotion?: boolean;
  readonly frameAcceptance?: Pick<PresentationFrameAcceptanceTracker, "markAccepted">;
  readonly onSceneSignals?: (signals: readonly ProductionSceneSignal[]) => void;
  readonly cameraMode?: CameraMode;
  readonly focusRequest?: Readonly<{
    serial: number;
    selection: Exclude<ObserverSelection, null>;
  }> | null;
  readonly observedRegionId?: string | null;
  /**
   * Monotonic "give the camera back to the director" request.
   *
   * A serial rather than a mode, because a shell cannot express this as a mode
   * change: a viewer ZOOM takes camera authority without altering the camera
   * mode (see `CanvasPresentationRenderer.zoomCamera`), so the mode still reads
   * `story` and every dedup between a shell and the renderer swallows a `story`
   * request — this file's own `requestCameraMode` returns early on an unchanged
   * mode, and a shell that mirrors the mode does the same. That is why the
   * retired "Resume story framing" badge was inert for a viewer who had only
   * zoomed. Bumping a serial cannot be deduplicated, and the effect it drives
   * calls the renderer's `setCameraMode("story")` directly — the one entry point
   * that knows a same-mode request still releases viewer authority.
   *
   * Increase it to ask; never decrease it.
   */
  readonly resumeStorySerial?: number;
  /**
   * Monotonic "latch the camera onto this subject" request.
   *
   * A serial and a selection rather than a camera mode, because a mode cannot
   * express a RE-latch: while the camera is already following, every dedup
   * between a shell and the renderer — this file's `requestCameraMode`, and
   * `CanvasPresentationRenderer.setCameraMode` itself — drops an unchanged
   * `follow`, and a frame-borne selection change never re-aims the camera
   * (`applyFrame` assigns the selection; only `setSelection` applies the follow
   * intent). Without this, choosing a second being while following a first left
   * the camera parked on the first one's last known bounds.
   *
   * `setSelection` is the single call that does both jobs: it re-latches a live
   * follow on the spot, and it is what a first `follow` request then resolves
   * against. It publishes `onSelectionChange`, so the shell owns the selection
   * exactly as it does for a canvas click.
   *
   * Increase it to ask; never decrease it.
   */
  readonly followRequest?: Readonly<{
    serial: number;
    selection: Exclude<ObserverSelection, null>;
  }> | null;
  readonly onCameraModeRequestRejected?: (mode: CameraMode) => void;
  readonly regionOrder?: readonly string[];
  readonly activeMomentId?: string | null;
  readonly onViewMoment?: (momentId: string) => void;
  readonly onObserveRegion?: (regionId: string) => void;
  readonly onSemanticSnapshot?: (snapshot: RendererSemanticSnapshot) => void;
}

export interface ProductionStageCaptureInjection {
  createRendererTiming(): Pick<
    ProductionCanvasSceneRendererOptions,
    "frameDriver" | "wakeScheduler" | "atlasCommitScheduler"
  > | undefined;
  recordRendererDisposal(before: unknown, after: unknown): void;
}

const ZERO_SAFE_FRAME: SafeFrameInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const productionCanvasSceneFactoryPromise = import("./ProductionCanvasSceneFactory");

interface StageObserverControls {
  renderer: ObserverRendererPort;
  acceptedCameraMode: CameraMode;
  requestedCameraMode: CameraMode;
  pendingCameraMode: CameraMode | null;
  frameAccepted: boolean;
  focusSerial: number;
  observedRegionId: string | null;
}

/** Own one route-independent production Canvas renderer lifetime. */
export function PresentationWorldStage(props: PresentationWorldStageProps): ReactElement {
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<ObserverRendererPort | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const subscribedSourceRef = useRef<PresentationFrameSource | null>(null);
  const sourceRef = useRef(props.frameSource);
  const callbacksRef = useRef(props.callbacks);
  const cameraModeRequestRejectedRef = useRef(props.onCameraModeRequestRejected);
  const safeFrameRef = useRef(props.safeFrame ?? ZERO_SAFE_FRAME);
  const reducedMotionRef = useRef(props.reducedMotion ?? false);
  const cameraModeRef = useRef(props.cameraMode);
  const observedRegionIdRef = useRef(props.observedRegionId ?? null);
  const latestFocusRequestRef = useRef(props.focusRequest ?? null);
  const regionOrderRef = useRef(props.regionOrder ?? []);
  const activeMomentIdRef = useRef(props.activeMomentId ?? null);
  const onViewMomentRef = useRef(props.onViewMoment);
  const onObserveRegionRef = useRef(props.onObserveRegion);
  const onSemanticSnapshotRef = useRef(props.onSemanticSnapshot);
  const resumeStorySerialRef = useRef(props.resumeStorySerial ?? 0);
  const followSerialRef = useRef(props.followRequest?.serial ?? 0);
  const restoreCanvasFocusRef = useRef(false);
  const highestFocusSerialRef = useRef(props.focusRequest?.serial ?? Number.NEGATIVE_INFINITY);
  const controlsRef = useRef<StageObserverControls | null>(null);
  const [generation, setGeneration] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  /**
   * True while the VIEWER owns the camera. Rendered as the release affordance below: automatic
   * framing yielding silently, with no way back and no sign it had stopped, is the defect this
   * state exists to make visible.
   */
  const [viewerControlsCamera, setViewerControlsCamera] = useState(false);
  /**
   * What the world view is showing. Drives the two navigation affordances the viewer needs and
   * previously had neither of: the explicit way BACK to the world from inside a region, and the
   * step-out hint while pressed against the region's zoom floor.
   */
  const [navigation, setNavigation] = useState<WorldNavigationState | null>(null);

  sourceRef.current = props.frameSource;
  callbacksRef.current = props.callbacks;
  cameraModeRequestRejectedRef.current = props.onCameraModeRequestRejected;
  safeFrameRef.current = props.safeFrame ?? ZERO_SAFE_FRAME;
  reducedMotionRef.current = props.reducedMotion ?? false;
  cameraModeRef.current = props.cameraMode;
  observedRegionIdRef.current = props.observedRegionId ?? null;
  regionOrderRef.current = props.regionOrder ?? [];
  activeMomentIdRef.current = props.activeMomentId ?? null;
  onViewMomentRef.current = props.onViewMoment;
  onObserveRegionRef.current = props.onObserveRegion;
  onSemanticSnapshotRef.current = props.onSemanticSnapshot;
  if (props.focusRequest === null) {
    latestFocusRequestRef.current = null;
  } else if (props.focusRequest !== undefined
    && props.focusRequest.serial > highestFocusSerialRef.current) {
    highestFocusSerialRef.current = props.focusRequest.serial;
    latestFocusRequestRef.current = props.focusRequest;
  }

  const subscribe = (renderer: ObserverRendererPort, source: PresentationFrameSource): void => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    subscribedSourceRef.current = source;
    const publishLatest = (): void => {
      if (rendererRef.current === renderer && subscribedSourceRef.current === source) {
        renderer.updatePresentation(source.getSnapshot());
      }
    };
    unsubscribeRef.current = source.subscribe(publishLatest);
    publishLatest();
  };

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer !== null && subscribedSourceRef.current !== props.frameSource) {
      subscribe(renderer, props.frameSource);
    }
  }, [props.frameSource]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer !== null) renderer.setSafeFrame(props.safeFrame ?? ZERO_SAFE_FRAME);
  }, [props.safeFrame]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (controls === null || !controls.frameAccepted || props.cameraMode === undefined
      || controls.requestedCameraMode === props.cameraMode) return;
    requestCameraMode(controls, props.cameraMode, cameraModeRequestRejectedRef.current);
  }, [props.cameraMode]);

  useEffect(() => {
    const controls = controlsRef.current;
    const request = latestFocusRequestRef.current;
    if (controls === null || !controls.frameAccepted
      || request === null || request.serial <= controls.focusSerial) return;
    controls.renderer.focusSelection(request.selection);
    controls.focusSerial = request.serial;
  }, [props.focusRequest]);

  useEffect(() => {
    const controls = controlsRef.current;
    const regionId = props.observedRegionId ?? null;
    if (controls === null || !controls.frameAccepted
      || regionId === null || controls.observedRegionId === regionId) return;
    controls.renderer.observeRegion(regionId);
    controls.observedRegionId = regionId;
  }, [props.observedRegionId]);

  useEffect(() => {
    const controls = controlsRef.current;
    const request = props.followRequest ?? null;
    if (controls === null || !controls.frameAccepted || request === null
      || request.serial <= followSerialRef.current) return;
    followSerialRef.current = request.serial;
    // Selection first: it re-latches a follow that is already running, and it is
    // what the mode request below resolves against when one is not.
    controls.renderer.setSelection(request.selection);
    requestCameraMode(controls, "follow", cameraModeRequestRejectedRef.current);
  }, [props.followRequest]);

  useEffect(() => {
    const controls = controlsRef.current;
    const serial = props.resumeStorySerial ?? 0;
    if (controls === null || !controls.frameAccepted
      || serial <= resumeStorySerialRef.current) return;
    resumeStorySerialRef.current = serial;
    resumeStoryFraming(controls);
  }, [props.resumeStorySerial]);

  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return undefined;
    setReady(false);
    const canvas = document.createElement("canvas");
    canvas.className = "presentation-world-stage__canvas";
    canvas.setAttribute("aria-label", "Vivarium world");
    canvas.setAttribute("aria-describedby", "world-keyboard-help");
    canvas.tabIndex = 0;
    stage.prepend(canvas);
    const controller = new AbortController();
    let cancelled = false;
    let installed: ObserverRendererPort | null = null;
    let observer: ResizeObserver | null = null;
    let debugRegistration: ProductionStageDebugRegistration | null = null;
    let activeDrag: Readonly<{
      pointerId: number;
      clientX: number;
      clientY: number;
      /** Where the press started, so a click can be told apart from a drag. */
      originX: number;
      originY: number;
      startedAtMs: number;
      /** True once the press has left the dead zone and become a pan. */
      panning: boolean;
    }> | null = null;
    const isActiveGeneration = (): boolean => (
      !cancelled && installed !== null && rendererRef.current === installed
    );
    const onKeyDown = (event: KeyboardEvent): void => {
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted) return;
      if (handleCanvasKey(
        event,
        canvas,
        controls,
        sourceRef.current.getSnapshot(),
        regionOrderRef.current,
        activeMomentIdRef.current,
        onViewMomentRef.current,
        onObserveRegionRef.current,
        cameraModeRequestRejectedRef.current,
      )) event.preventDefault();
    };
    /**
     * Escape — the keyboard half of "leaving a region is a deliberate act", and the SINGLE definition
     * of it. Bound to the window rather than the canvas because bound to the canvas it was inert
     * until the viewer had clicked the canvas first: a keyboard affordance that needed a mouse.
     *
     * It yields to anything that owns Escape itself, detected from ARIA rather than from knowledge of
     * a particular shell: an open modal or dialog, and any surface a trigger reports as expanded --
     * that is how a drawer keeps its own Escape-to-close. It also yields while text is being edited,
     * where Escape means "revert this field". Everything else, at any focus and at none, is ours.
     */
    const onWindowKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted) return;
      if (document.querySelector(
        "[aria-modal='true'], dialog[open], [aria-controls][aria-expanded='true']",
      ) !== null) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable
        || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement)) return;
      controls.renderer.exitToWorldView?.();
      event.preventDefault();
    };
    const onWheel = (event: WheelEvent): void => {
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted) return;
      const bounds = canvas.getBoundingClientRect();
      const intent = wheelNavigationIntent({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        deltaMode: event.deltaMode,
        ctrlKey: event.ctrlKey,
        viewportWidth: bounds.width,
        viewportHeight: bounds.height,
        anchorCss: {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        },
      });
      if (intent === null) return;
      if (intent.kind === "pan") {
        controls.renderer.panCamera(intent.deltaCss);
        requestCameraMode(controls, "free", cameraModeRequestRejectedRef.current);
      } else {
        controls.renderer.zoomCamera(intent.factor, intent.anchorCss);
      }
      event.preventDefault();
    };
    const clearActiveDrag = (): number | null => {
      if (activeDrag === null) return null;
      const pointerId = activeDrag.pointerId;
      activeDrag = null;
      canvas.classList.remove("presentation-world-stage__canvas--dragging");
      return pointerId;
    };
    const releaseActiveDrag = (): void => {
      const pointerId = clearActiveDrag();
      if (pointerId !== null) releasePointerCapture(canvas, pointerId);
    };
    const canvasPoint = (event: PointerEvent): Readonly<{ x: number; y: number }> => {
      const bounds = canvas.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const onPointerDown = (event: PointerEvent): void => {
      canvas.focus({ preventScroll: true });
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted
        || !event.isPrimary || event.button !== 0 || activeDrag !== null) return;
      canvas.setPointerCapture?.(event.pointerId);
      activeDrag = {
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        originX: event.clientX,
        originY: event.clientY,
        startedAtMs: event.timeStamp,
        panning: false,
      };
    };
    const onPointerMove = (event: PointerEvent): void => {
      const drag = activeDrag;
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted) return;
      if (drag === null || drag.pointerId !== event.pointerId) {
        // No press in progress: this is a hover. The world view answers it (island rim light, name
        // and live readout); at region scope the renderer ignores it.
        if (drag === null) controls.renderer.hoverAt?.(canvasPoint(event));
        return;
      }
      const deltaCss = {
        x: event.clientX - drag.clientX,
        y: event.clientY - drag.clientY,
      };
      const travelled = Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY);
      // Dead zone: below it the press is still a candidate CLICK, so nothing pans. Once crossed,
      // the pan starts from the ORIGIN (not from the last sample), so no motion is swallowed.
      if (!drag.panning && travelled <= DRAG_DEAD_ZONE_CSS) {
        activeDrag = { ...drag, clientX: event.clientX, clientY: event.clientY };
        return;
      }
      const panDelta = drag.panning
        ? deltaCss
        : { x: event.clientX - drag.originX, y: event.clientY - drag.originY };
      activeDrag = {
        ...drag,
        clientX: event.clientX,
        clientY: event.clientY,
        panning: true,
      };
      if (panDelta.x === 0 && panDelta.y === 0) return;
      canvas.classList.add("presentation-world-stage__canvas--dragging");
      controls.renderer.panCamera(panDelta);
      requestCameraMode(controls, "free", cameraModeRequestRejectedRef.current);
      event.preventDefault();
    };
    const onPointerEnd = (event: PointerEvent): void => {
      const drag = activeDrag;
      if (drag?.pointerId !== event.pointerId) return;
      const controls = controlsRef.current;
      const click = event.type === "pointerup" && isClickGesture({
        travelledCss: Math.hypot(event.clientX - drag.originX, event.clientY - drag.originY),
        heldMs: event.timeStamp - drag.startedAtMs,
        dragged: drag.panning,
      });
      releaseActiveDrag();
      // A click on an island descends into it. A double-click arrives as two clicks; the second is
      // inert because the first already latched the region scope, so both gestures do one thing.
      if (click && controls !== null && controls.frameAccepted) {
        const point = canvasPoint(event);
        controls.renderer.enterRegionAt?.(point);
        // Selection is the other half of the SAME completed click, and it belongs here rather than on
        // the renderer's own canvas press: this is the only place that knows the press never left the
        // dead zone above, so a drag-pan can no longer select the being it started on and pop the
        // Selection drawer over the frame. A click that launched a descent selects nothing -- the
        // renderer declines while that flight is in the air.
        controls.renderer.selectAt?.(point);
      }
    };
    const onPointerLeave = (): void => {
      const controls = controlsRef.current;
      if (cancelled || controls === null || !controls.frameAccepted) return;
      controls.renderer.hoverAt?.(null);
    };
    const onLostPointerCapture = (event: PointerEvent): void => {
      if (activeDrag?.pointerId === event.pointerId) clearActiveDrag();
    };
    canvas.addEventListener("keydown", onKeyDown);
    window.addEventListener("keydown", onWindowKeyDown);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerEnd);
    canvas.addEventListener("pointercancel", onPointerEnd);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("lostpointercapture", onLostPointerCapture);

    const reportFailure = (next: ObserverRendererFailure): void => {
      if (cancelled) return;
      if (controlsRef.current?.pendingCameraMode === "follow"
        && next.kind === "path"
        && next.publicMessage === "Choose a being or home before following.") return;
      callbacksRef.current?.onFailure?.(next);
      if (next.kind === "marker" && next.retryable === false) return;
      setFailure(next.publicMessage);
      setReady(false);
    };
    const callbacks: ObserverRendererCallbacks = {
      onSelectionChange: (selection) => {
        if (isActiveGeneration()) callbacksRef.current?.onSelectionChange?.(selection);
      },
      onBeatActivate: (momentId) => {
        if (isActiveGeneration()) callbacksRef.current?.onBeatActivate?.(momentId);
      },
      onCameraModeChange: (mode) => {
        if (!isActiveGeneration()) return;
        const controls = controlsRef.current;
        if (controls !== null) {
          controls.acceptedCameraMode = mode;
          controls.requestedCameraMode = mode;
          controls.pendingCameraMode = null;
        }
        callbacksRef.current?.onCameraModeChange?.(mode);
      },
      onCameraAuthorityChange: (viewerControlled) => {
        if (!isActiveGeneration()) return;
        setViewerControlsCamera(viewerControlled);
        callbacksRef.current?.onCameraAuthorityChange?.(viewerControlled);
      },
      onWorldNavigationChange: (state) => {
        if (!isActiveGeneration()) return;
        setNavigation(state);
        // The cursor is the cheapest hover affordance there is, and the one a viewer looks for
        // first. Listed before `--dragging` in the stylesheet so a grab still wins while dragging.
        canvas.classList.toggle(
          "presentation-world-stage__canvas--over-island",
          state.hoveredRegionId !== null,
        );
        // The viewer now chooses the place, so the shell has to be told which one -- otherwise the
        // chrome keeps naming the region the STORY is playing in while the badge names the region the
        // viewer flew into, and the two contradict each other on screen. Only region scope reports:
        // at world scope the viewer is above the whole archipelago and has chosen nothing.
        const controls = controlsRef.current;
        if (state.scope === "region" && state.regionId !== null
          && controls !== null && controls.frameAccepted
          && controls.observedRegionId !== state.regionId) {
          controls.observedRegionId = state.regionId;
          onObserveRegionRef.current?.(state.regionId);
        }
        callbacksRef.current?.onWorldNavigationChange?.(state);
      },
      onDiagnostics: (value) => {
        if (isActiveGeneration()) callbacksRef.current?.onDiagnostics?.(value);
      },
      onFailure: reportFailure,
      onSemanticSnapshot: (snapshot: RendererSemanticSnapshot) => {
        const controls = controlsRef.current;
        if (controls?.renderer !== installed || !controls.frameAccepted
          || !sameFrameIdentity(snapshot.frameIdentity, sourceRef.current.getSnapshot())) return;
        callbacksRef.current?.onSemanticSnapshot?.(snapshot);
        onSemanticSnapshotRef.current?.(snapshot);
      },
    };
    const frameAcceptance: Pick<PresentationFrameAcceptanceTracker, "markAccepted"> = {
      markAccepted(frame): void {
        if (cancelled || installed === null || rendererRef.current !== installed) return;
        props.frameAcceptance?.markAccepted(frame);
        const controls = controlsRef.current;
        if (controls?.renderer !== installed || !isCurrentSourceFrame(sourceRef.current, frame)) return;
        controls.frameAccepted = true;
        setReady(true);
        restoreDurableObserverControls(
          controls,
          cameraModeRef.current,
          observedRegionIdRef.current,
          latestFocusRequestRef.current,
          cameraModeRequestRejectedRef.current,
        );
      },
    };
    const captureTiming = props.capture?.createRendererTiming();
    const rendererOptions: ProductionCanvasSceneRendererOptions = {
      canvas,
      callbacks,
      diagnosticsEnabled: () => callbacksRef.current?.onDiagnostics !== undefined,
      signal: controller.signal,
      placement: props.placement,
      recipes: props.recipes,
      // Task Z3: the world-sheet LOD (gutter, non-focused region snapshots, being marks,
      // camera-focus-follows-into-a-live-switch) is real production behaviour, not a pilot --
      // this is the one call site that turns it on. Every other renderer construction site
      // (unit tests) leaves it at its `false` default, matching the pre-Z3 single-region render.
      worldSheetSnapshots: true,
      ...(props.atlasPool === undefined ? {} : { atlasPool: props.atlasPool }),
      ...(props.atlasCommitScheduler === undefined
        ? {}
        : { atlasCommitScheduler: props.atlasCommitScheduler }),
      reducedMotion: reducedMotionRef.current,
      frameAcceptance,
      onSceneSignals: props.onSceneSignals,
      ...(captureTiming ?? {}),
    };

    void productionCanvasSceneFactoryPromise.then(({ createProductionCanvasSceneRenderer }) => (
        createProductionCanvasSceneRenderer(rendererOptions)
      )).then((renderer) => {
      if (cancelled) {
        disposeIfActive(renderer);
        return;
      }
      if (rendererIsDisposed(renderer)) {
        reportFailure({
          kind: "canvas",
          retryable: true,
          publicMessage: "The world renderer could not be started.",
        });
        return;
      }
      installed = renderer;
      rendererRef.current = renderer;
      if (hasCanvasDebug(renderer)) {
        debugRegistration = installProductionStageDebugProbe(stage, Object.freeze({
          snapshot: () => renderer.debug(),
        }));
      }
      const controls: NonNullable<typeof controlsRef.current> = {
        renderer,
        acceptedCameraMode: "story",
        requestedCameraMode: "story",
        pendingCameraMode: null,
        frameAccepted: false,
        focusSerial: Number.NEGATIVE_INFINITY,
        observedRegionId: null,
      };
      controlsRef.current = controls;
      renderer.setSafeFrame(safeFrameRef.current);
      subscribe(renderer, sourceRef.current);
      observer = new ResizeObserver((entries) => {
        if (cancelled || rendererRef.current !== renderer) return;
        const rect = entries[0]?.contentRect;
        if (rect !== undefined && Number.isFinite(rect.width) && rect.width > 0
          && Number.isFinite(rect.height) && rect.height > 0) {
          renderer.resize(rect.width, rect.height);
        }
      });
      observer.observe(stage);
      if (restoreCanvasFocusRef.current) {
        restoreCanvasFocusRef.current = false;
        canvas.focus({ preventScroll: true });
      }
      setFailure(null);
    }).catch(() => {
      reportFailure({
        kind: "canvas",
        retryable: true,
        publicMessage: "The world renderer could not be started.",
      });
    });

    return () => {
      restoreCanvasFocusRef.current = document.activeElement === canvas;
      releaseActiveDrag();
      cancelled = true;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      subscribedSourceRef.current = null;
      observer?.disconnect();
      observer = null;
      debugRegistration?.release();
      debugRegistration = null;
      if (rendererRef.current === installed) rendererRef.current = null;
      if (controlsRef.current?.renderer === installed) controlsRef.current = null;
      if (installed !== null) {
        const before = hasCanvasDebug(installed) ? installed.debug() : null;
        disposeIfActive(installed);
        const after = hasCanvasDebug(installed) ? installed.debug() : null;
        props.capture?.recordRendererDisposal(before, after);
      }
      controller.abort();
      canvas.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", onWindowKeyDown);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerEnd);
      canvas.removeEventListener("pointercancel", onPointerEnd);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("lostpointercapture", onLostPointerCapture);
      canvas.remove();
    };
  }, [generation, props.atlasCommitScheduler, props.atlasPool, props.capture, props.placement, props.recipes, props.frameAcceptance, props.onSceneSignals, props.reducedMotion]);

  const leaveRegion = (): void => {
    const controls = controlsRef.current;
    if (controls === null || !controls.frameAccepted) return;
    controls.renderer.exitToWorldView?.();
  };

  const insideRegion = navigation !== null && navigation.scope === "region";

  return (
    <div
      ref={stageRef}
      className="presentation-world-stage"
      data-ready={ready ? "true" : "false"}
      data-viewer-camera={viewerControlsCamera ? "true" : "false"}
      data-world-scope={navigation?.scope ?? "unknown"}
      data-hovered-region={navigation?.hoveredRegionId ?? ""}
    >
      {insideRegion ? (
        <p
          className="presentation-world-stage__region-exit"
          data-exit-offered={navigation.exitOffered ? "true" : "false"}
          role="status"
        >
          <span>
            {navigation.exitOffered
              ? `Zoom out again to leave ${navigation.regionName ?? "this region"}`
              : `Inside ${navigation.regionName ?? "a region"}`}
          </span>
          <button type="button" onClick={leaveRegion}>
            World view (Esc)
          </button>
        </p>
      ) : null}
      {failure !== null ? (
        <section className="presentation-world-stage__failure" role="alert">
          <p>{failure}</p>
          <button type="button" onClick={() => setGeneration((value) => value + 1)}>
            Retry world
          </button>
        </section>
      ) : null}
    </div>
  );
}

function handleCanvasKey(
  event: KeyboardEvent,
  canvas: HTMLCanvasElement,
  controls: StageObserverControls,
  frame: PresentedObserverFrame,
  regionOrder: readonly string[],
  activeMomentId: string | null,
  onViewMoment: ((momentId: string) => void) | undefined,
  onObserveRegion: ((regionId: string) => void) | undefined,
  onCameraRejected: ((mode: CameraMode) => void) | undefined,
): boolean {
  const key = event.key.toLowerCase();
  // Escape is deliberately absent here: it is owned once, at the window (see `onWindowKeyDown`), so
  // it works before the canvas has ever been touched and cannot fire twice for one press.
  if (key === "s") {
    resumeStoryFraming(controls);
    return true;
  }
  if (key === "f") {
    const selection = frame.selection;
    if (selection?.kind !== "agent" && selection?.kind !== "home") {
      onCameraRejected?.("follow");
      return true;
    }
    requestCameraMode(controls, "follow", onCameraRejected);
    return true;
  }
  if (key === "v") {
    requestCameraMode(controls, "free", onCameraRejected);
    return true;
  }
  if (key === "m") {
    if (activeMomentId !== null) onViewMoment?.(activeMomentId);
    requestCameraMode(controls, "story", onCameraRejected);
    return true;
  }
  const pan = arrowPanDelta(event.key);
  if (pan !== null) {
    controls.renderer.panCamera(pan.deltaCss);
    requestCameraMode(controls, "free", onCameraRejected);
    return true;
  }
  if (["+", "="].includes(event.key) || ["-", "_"].includes(event.key)) {
    const bounds = canvas.getBoundingClientRect();
    controls.renderer.zoomCamera(["+", "="].includes(event.key) ? 1.25 : 0.8, {
      x: bounds.width / 2,
      y: bounds.height / 2,
    });
    return true;
  }
  if (regionOrder.length === 0) return false;
  const currentRegion = controls.observedRegionId ?? frame.scene?.regionId ?? regionOrder[0]!;
  const currentIndex = Math.max(0, regionOrder.indexOf(currentRegion));
  const target = event.key === "["
    ? regionOrder[(currentIndex - 1 + regionOrder.length) % regionOrder.length]
    : event.key === "]"
      ? regionOrder[(currentIndex + 1) % regionOrder.length]
      : event.key === "Home" ? regionOrder[0]
        : event.key === "End" ? regionOrder.at(-1) : undefined;
  if (target === undefined) return false;
  controls.renderer.observeRegion(target);
  controls.observedRegionId = target;
  onObserveRegion?.(target);
  return true;
}

function sameFrameIdentity(
  left: FrameIdentity,
  right: PresentedObserverFrame,
): boolean {
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function restoreDurableObserverControls(
  controls: StageObserverControls,
  cameraMode: CameraMode | undefined,
  observedRegionId: string | null,
  focusRequest: PresentationWorldStageProps["focusRequest"],
  onCameraRejected: ((mode: CameraMode) => void) | undefined,
): void {
  if (cameraMode !== undefined && controls.requestedCameraMode !== cameraMode) {
    requestCameraMode(controls, cameraMode, onCameraRejected);
  }
  if (observedRegionId !== null && controls.observedRegionId !== observedRegionId) {
    controls.renderer.observeRegion(observedRegionId);
    controls.observedRegionId = observedRegionId;
  }
  if (focusRequest !== null && focusRequest !== undefined
    && focusRequest.serial > controls.focusSerial) {
    controls.renderer.focusSelection(focusRequest.selection);
    controls.focusSerial = focusRequest.serial;
  }
}

function isCurrentSourceFrame(
  source: PresentationFrameSource,
  accepted: PresentedObserverFrame,
): boolean {
  const current = source.getSnapshot();
  return current.runId === accepted.runId
    && current.sourceKey === accepted.sourceKey
    && current.revision === accepted.revision
    && current.firstCursor === accepted.firstCursor
    && current.lastCursor === accepted.lastCursor;
}

/**
 * Give the camera back to the director, whatever mode it is nominally in.
 *
 * The renderer's `setCameraMode("story")` is the single explicit release (see
 * `releaseViewerCameraControl`) and it already knows that a same-mode request
 * still releases viewer authority. This helper exists because everything
 * *between* the viewer and that method deduplicates on the mode, and a viewer
 * who took the camera by zooming never changed the mode — so a `story` request
 * from a shell or from the S key was dropped before it arrived, stranding them.
 * Both callers therefore skip {@link requestCameraMode} and speak to the
 * renderer directly.
 *
 * Side effects: releases viewer camera authority in the renderer, which
 * publishes `onCameraAuthorityChange(false)` and `onCameraModeChange("story")`.
 */
function resumeStoryFraming(controls: StageObserverControls): void {
  controls.requestedCameraMode = "story";
  controls.pendingCameraMode = null;
  controls.renderer.setCameraMode("story");
}

function requestCameraMode(
  controls: StageObserverControls,
  mode: CameraMode,
  onRejected: ((mode: CameraMode) => void) | undefined,
): void {
  controls.requestedCameraMode = mode;
  if (controls.acceptedCameraMode === mode) return;
  controls.pendingCameraMode = mode;
  controls.renderer.setCameraMode(mode);
  if (controls.pendingCameraMode !== mode) return;
  controls.pendingCameraMode = null;
  controls.requestedCameraMode = controls.acceptedCameraMode;
  onRejected?.(mode);
}

function rendererIsDisposed(renderer: ObserverRendererPort): boolean {
  try {
    return renderer.diagnostics().disposed;
  } catch {
    return false;
  }
}

function disposeIfActive(renderer: ObserverRendererPort): void {
  if (!rendererIsDisposed(renderer)) renderer.dispose();
}

function releasePointerCapture(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.releasePointerCapture?.(pointerId);
  } catch (error: unknown) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
  }
}

function hasCanvasDebug(
  renderer: ObserverRendererPort,
): renderer is ObserverRendererPort & { debug(): unknown } {
  return "debug" in renderer && typeof renderer.debug === "function";
}
