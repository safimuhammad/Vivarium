import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";

import { createCanvasWorldRenderer } from "./CanvasWorldRenderer";
import type { ActorSnapshot } from "./actors/HumanActor";
import type {
  CameraMode,
  CanvasRendererDiagnostics,
  DialogueState,
  EntitySelection,
  SliceCanvasRenderer,
} from "./contracts";
import { installVivarium2DSliceDebug } from "./debug";
import { DEMO_ACTOR_ID, DEMO_SHELTER_ID, type DemoSceneName } from "./demoScene";
import { shelterFeetY, shelterVisualBounds } from "./homes/shelterGeometry";
import type { ShelterSnapshot2D } from "./homes/ShelterActor";
import { hitTest, type HitTarget } from "./interaction/hitTest";
import "./CanvasWorldStage.css";

const ACTOR_SELECTION = { kind: "agent", id: DEMO_ACTOR_ID } as const;
const SHELTER_SELECTION = { kind: "home", id: DEMO_SHELTER_ID } as const;
const CAMERA_PAN_STEP = 32;
const CAMERA_ZOOM_FACTOR = 1.25;
const VALID_SCENES: readonly DemoSceneName[] = [
  "walk",
  "dialogue",
  "shelter-build",
  "shelter-collapse",
  "full-loop",
];

type Readiness = "loading" | "ready" | "unavailable";
type MaterialPhase = "absent" | "building" | "standing" | "collapsing" | "ruin";
type SemanticMirrorState = Readonly<{ actorLabel: string; shelterLabel: string | null }>;

const INITIAL_SEMANTIC_MIRROR: SemanticMirrorState = {
  actorLabel: "Aster — human",
  shelterLabel: null,
};

function routeScene(search: string): DemoSceneName {
  const candidate = new URLSearchParams(search).get("scene");
  return VALID_SCENES.find((scene) => scene === candidate) ?? "full-loop";
}

function visibleDialogueText(dialogue: DialogueState): string {
  return dialogue.text.slice(0, Math.max(0, dialogue.visibleCharacters));
}

function completedDialogueAnnouncement(dialogue: DialogueState): string | null {
  if (!dialogue.hold && dialogue.visibleCharacters < dialogue.text.length) return null;
  return `${dialogue.speakerName} says: ${dialogue.text}`;
}

function materialAnnouncement(phase: MaterialPhase): string | null {
  switch (phase) {
    case "building": return "Shelter construction began.";
    case "standing": return "The east shelter now stands complete.";
    case "collapsing": return "The east shelter began to collapse.";
    case "ruin": return "The east shelter became a ruin.";
    case "absent": return null;
  }
}

function actorSemanticLabel(actor: ActorSnapshot): string {
  if (actor.channels.locomotion === "dead") return `${actor.name} — human, dead`;
  if (actor.channels.locomotion === "prone") return `${actor.name} — human, fallen`;
  if (actor.channels.action === "work") return `${actor.name} — human, building the east shelter`;
  if (actor.channels.action === "speak") return `${actor.name} — human, speaking`;
  if (actor.channels.action === "hurt") return `${actor.name} — human, hurt`;
  if (actor.channels.locomotion === "walk") return `${actor.name} — human, walking toward the east shelter`;
  if (actor.channels.locomotion === "turn") return `${actor.name} — human, turning`;
  if (actor.channels.locomotion === "stop") return `${actor.name} — human, stopping`;
  return `${actor.name} — human, resting`;
}

function shelterSemanticLabel(shelter: ShelterSnapshot2D): string | null {
  switch (shelter.phase) {
    case "absent": return null;
    case "building": return "East shelter — under construction";
    case "standing": return "East shelter — standing with a lit hearth";
    case "collapsing": return "East shelter — collapsing";
    case "ruin": return "East shelter ruins — rubble remains";
  }
}

function applyOverlaySafeFrame(
  renderer: SliceCanvasRenderer,
  canvas: HTMLCanvasElement,
  controls: HTMLElement | null,
  dialogue: HTMLElement | null,
  mirror: HTMLElement | null,
): void {
  if (controls === null || dialogue === null || mirror === null) return;
  const canvasBounds = canvas.getBoundingClientRect();
  if (canvasBounds.width <= 0 || canvasBounds.height <= 0) return;
  const diagnostics = renderer.getDiagnostics();
  const scale = diagnostics.cssScale > 0 ? diagnostics.cssScale : 1;
  const controlsBounds = controls.getBoundingClientRect();
  const dialogueBounds = dialogue.getBoundingClientRect();
  const mirrorBounds = mirror.getBoundingClientRect();
  const topCss = Math.max(0, Math.min(canvasBounds.height, controlsBounds.bottom - canvasBounds.top));
  const firstBottomOverlay = Math.min(dialogueBounds.top, mirrorBounds.top);
  const bottomCss = Math.max(0, Math.min(canvasBounds.height - topCss, canvasBounds.bottom - firstBottomOverlay));
  const logicalHeight = diagnostics.logicalViewport.height;
  const top = Math.min(logicalHeight - 1, Math.ceil(topCss / scale));
  const bottom = Math.min(logicalHeight - top - 1, Math.ceil(bottomCss / scale));
  renderer.setSafeFrame({ top, right: 0, bottom, left: 0 });
}

function actorTarget(renderer: SliceCanvasRenderer): HitTarget | null {
  const actor = renderer.debug().actorState(DEMO_ACTOR_ID);
  return actor === null ? null : {
    selection: ACTOR_SELECTION,
    feetY: actor.position.y,
    worldBounds: {
      x: actor.position.x - 24,
      y: actor.position.y - 61,
      width: 48,
      height: 64,
    },
  };
}

function shelterTarget(renderer: SliceCanvasRenderer): HitTarget | null {
  const shelter = renderer.debug().shelterState(DEMO_SHELTER_ID);
  const bounds = shelter === null ? null : shelterVisualBounds(shelter);
  return shelter === null || bounds === null ? null : {
    selection: SHELTER_SELECTION,
    feetY: shelterFeetY(shelter),
    worldBounds: bounds,
  };
}

/** Owns the React/DOM boundary around one persistent Canvas2D world renderer. */
export function CanvasWorldStage() {
  const stageRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controlsRef = useRef<HTMLElement | null>(null);
  const dialoguePanelRef = useRef<HTMLElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const retryRef = useRef<HTMLButtonElement | null>(null);
  const rendererRef = useRef<SliceCanvasRenderer | null>(null);
  const dialogueRef = useRef<DialogueState | null>(null);
  const materialPhaseRef = useRef<MaterialPhase>("absent");
  const announcementKeyRef = useRef("");
  const diagnosticsKeyRef = useRef("");
  const pendingMaterialRef = useRef<{ readonly key: string; readonly message: string } | null>(null);
  const semanticKeyRef = useRef("");
  const [selection, setSelection] = useState<EntitySelection>(null);
  const [cameraMode, setCameraMode] = useState<CameraMode>("story");
  const [dialogue, setDialogue] = useState<DialogueState | null>(null);
  const [readiness, setReadiness] = useState<Readiness>("loading");
  const [loadFailure, setLoadFailure] = useState<Readonly<{ missingSprites: readonly string[]; message: string }> | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [semanticMirror, setSemanticMirror] = useState<SemanticMirrorState>(INITIAL_SEMANTIC_MIRROR);

  const announce = useCallback((key: string, message: string): void => {
    if (announcementKeyRef.current === key) return;
    announcementKeyRef.current = key;
    setLiveAnnouncement(message);
  }, []);

  useEffect(() => {
    if (readiness === "unavailable") retryRef.current?.focus();
  }, [readiness]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (stage === null || canvas === null) return;

    let cancelled = false;
    let loadFailed = false;
    let ownedRenderer: SliceCanvasRenderer | null = null;
    let removeDebug = (): void => undefined;
    let latestSize = { width: 0, height: 0 };
    const controller = new AbortController();
    setReadiness("loading");
    setLoadFailure(null);
    semanticKeyRef.current = "";
    setSemanticMirror(INITIAL_SEMANTIC_MIRROR);
    const observer = new ResizeObserver((entries) => {
      const stageEntry = entries.find((entry) => entry.target === stage);
      const size = stageEntry?.contentRect;
      if (size !== undefined && size.width > 0 && size.height > 0) {
        latestSize = { width: size.width, height: size.height };
        ownedRenderer?.resize(size.width, size.height);
      }
      if (ownedRenderer !== null) {
        applyOverlaySafeFrame(ownedRenderer, canvas, controlsRef.current, dialoguePanelRef.current, mirrorRef.current);
      }
    });
    observer.observe(stage);
    if (controlsRef.current !== null) observer.observe(controlsRef.current);
    if (dialoguePanelRef.current !== null) observer.observe(dialoguePanelRef.current);
    if (mirrorRef.current !== null) observer.observe(mirrorRef.current);

    const onDialogueChange = (next: DialogueState | null): void => {
      if (cancelled) return;
      dialogueRef.current = next;
      setDialogue(next);
      if (next === null) {
        announcementKeyRef.current = "";
        const pending = pendingMaterialRef.current;
        pendingMaterialRef.current = null;
        if (pending === null) setLiveAnnouncement("");
        else announce(pending.key, pending.message);
        return;
      }
      const message = completedDialogueAnnouncement(next);
      if (message !== null) announce(`dialogue:${next.speakerId}:${next.cursor}:${next.text}`, message);
    };

    const updateSemanticMirror = (): void => {
      if (cancelled || ownedRenderer === null) return;
      const actor = ownedRenderer.debug().actorState(DEMO_ACTOR_ID);
      const shelter = ownedRenderer.debug().shelterState(DEMO_SHELTER_ID);
      const next: SemanticMirrorState = {
        actorLabel: actor === null ? "Aster — human, unavailable" : actorSemanticLabel(actor),
        shelterLabel: shelter === null ? null : shelterSemanticLabel(shelter),
      };
      const key = `${next.actorLabel}\u0000${next.shelterLabel ?? ""}`;
      if (key === semanticKeyRef.current) return;
      semanticKeyRef.current = key;
      setSemanticMirror(next);
    };

    const onDiagnostics = (next: CanvasRendererDiagnostics): void => {
      if (cancelled) return;
      updateSemanticMirror();
      const diagnosticKey = `${next.disposed}:${next.cropMode}:${next.missingSprites.join("|")}`;
      if (diagnosticKey !== diagnosticsKeyRef.current) {
        diagnosticsKeyRef.current = diagnosticKey;
        if (next.missingSprites.length > 0) loadFailed = true;
        setReadiness(next.missingSprites.length > 0
          ? "unavailable"
          : ownedRenderer?.debug().isReady() ? "ready" : "loading");
      }
      const phase = ownedRenderer?.debug().shelterState(DEMO_SHELTER_ID)?.phase as MaterialPhase | undefined;
      if (phase === undefined || phase === materialPhaseRef.current) return;
      materialPhaseRef.current = phase;
      const message = materialAnnouncement(phase);
      if (message === null) {
        pendingMaterialRef.current = null;
      } else if (dialogueRef.current === null) {
        announce(`material:${phase}`, message);
      } else {
        pendingMaterialRef.current = { key: `material:${phase}`, message };
      }
    };

    const create = async (): Promise<void> => {
      try {
        const renderer = await createCanvasWorldRenderer({
          canvas,
          callbacks: {
            onSelect: (next) => { if (!cancelled) setSelection(next); },
            onDialogueChange,
            onCameraModeChange: (next) => { if (!cancelled) setCameraMode(next); },
            onDiagnostics,
            onAssetLoadFailure: (failure) => {
              if (cancelled) return;
              loadFailed = true;
              setLoadFailure(failure);
              setReadiness("unavailable");
            },
          },
          signal: controller.signal,
          reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
          initialScene: routeScene(window.location.search),
        });
        if (cancelled || controller.signal.aborted) {
          if (!renderer.getDiagnostics().disposed) renderer.dispose();
          return;
        }
        ownedRenderer = renderer;
        rendererRef.current = renderer;
        removeDebug = installVivarium2DSliceDebug(renderer.debug());
        updateSemanticMirror();
        if (latestSize.width > 0 && latestSize.height > 0) renderer.resize(latestSize.width, latestSize.height);
        applyOverlaySafeFrame(renderer, canvas, controlsRef.current, dialoguePanelRef.current, mirrorRef.current);
        setCameraMode(renderer.debug().cameraState().mode);
        setReadiness(loadFailed ? "unavailable" : renderer.debug().isReady() ? "ready" : "loading");
        if (loadAttempt > 0) canvas.focus();
      } catch (error: unknown) {
        if (!cancelled && !controller.signal.aborted) {
          setLoadFailure({
            missingSprites: [],
            message: error instanceof Error ? error.message : "Unable to create the world renderer.",
          });
          setReadiness("unavailable");
        }
      }
    };
    void create();

    return (): void => {
      cancelled = true;
      observer.disconnect();
      removeDebug();
      if (rendererRef.current === ownedRenderer) rendererRef.current = null;
      ownedRenderer?.dispose();
      controller.abort();
    };
  }, [announce, loadAttempt]);

  const retryWorld = useCallback((): void => {
    setReadiness("loading");
    setLoadFailure(null);
    setLoadAttempt((current) => current + 1);
  }, []);

  const chooseCameraMode = useCallback((mode: CameraMode): void => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    if (mode === "follow") {
      renderer.setSelection(ACTOR_SELECTION);
      setSelection(ACTOR_SELECTION);
    }
    renderer.setCameraMode(mode);
    setCameraMode(mode);
  }, []);

  const togglePause = useCallback((): void => {
    const debug = rendererRef.current?.debug();
    if (debug === undefined) return;
    if (paused) debug.resume();
    else debug.pause();
    setPaused((current) => !current);
  }, [paused]);

  const restart = useCallback((): void => {
    const debug = rendererRef.current?.debug();
    if (debug === undefined) return;
    debug.restart();
    dialogueRef.current = null;
    pendingMaterialRef.current = null;
    announcementKeyRef.current = "";
    setDialogue(null);
    setLiveAnnouncement("");
    setPaused(false);
  }, []);

  const focusEntity = useCallback((next: Exclude<EntitySelection, null>): void => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    renderer.setSelection(next);
    renderer.focusSelection(next);
    setSelection(next);
    setCameraMode(renderer.debug().cameraState().mode);
  }, []);

  const selectAtPointer = useCallback((event: PointerEvent<HTMLCanvasElement>): void => {
    const renderer = rendererRef.current;
    if (renderer === null) return;
    event.currentTarget.focus();
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const diagnostics = renderer.getDiagnostics();
    const camera = renderer.debug().cameraState();
    const targets = [actorTarget(renderer), shelterTarget(renderer)].filter((target): target is HitTarget => target !== null);
    const next = hitTest({
      pointCss: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      targets,
      cssScale: bounds.width / diagnostics.logicalViewport.width,
      camera: {
        worldToScreen: (world) => ({
          x: (world.x - camera.center.x) * camera.zoom + diagnostics.logicalViewport.width / 2,
          y: (world.y - camera.center.y) * camera.zoom + diagnostics.logicalViewport.height / 2,
        }),
      },
    });
    renderer.setSelection(next);
    setSelection(next);
  }, []);

  const handleCanvasKey = useCallback((event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      togglePause();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      chooseCameraMode("follow");
    } else if (event.key.toLowerCase() === "s" || event.key === "Enter") {
      event.preventDefault();
      chooseCameraMode("story");
    } else if (event.key.toLowerCase() === "v") {
      event.preventDefault();
      chooseCameraMode("free");
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = {
        x: event.key === "ArrowLeft" ? CAMERA_PAN_STEP : event.key === "ArrowRight" ? -CAMERA_PAN_STEP : 0,
        y: event.key === "ArrowUp" ? CAMERA_PAN_STEP : event.key === "ArrowDown" ? -CAMERA_PAN_STEP : 0,
      };
      rendererRef.current?.panCamera(delta);
      setCameraMode(rendererRef.current?.debug().cameraState().mode ?? "free");
    } else if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_") {
      event.preventDefault();
      const renderer = rendererRef.current;
      if (renderer === null) return;
      const viewport = renderer.getDiagnostics().logicalViewport;
      renderer.zoomCamera(
        event.key === "+" || event.key === "=" ? CAMERA_ZOOM_FACTOR : 1 / CAMERA_ZOOM_FACTOR,
        { x: viewport.width / 2, y: viewport.height / 2 },
      );
      setCameraMode(renderer.debug().cameraState().mode);
    }
  }, [chooseCameraMode, togglePause]);

  const handleCanvasWheel = useCallback((event: WheelEvent<HTMLCanvasElement>): void => {
    const renderer = rendererRef.current;
    if (renderer === null || event.deltaY === 0) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewport = renderer.getDiagnostics().logicalViewport;
    renderer.zoomCamera(
      event.deltaY < 0 ? CAMERA_ZOOM_FACTOR : 1 / CAMERA_ZOOM_FACTOR,
      {
        x: (event.clientX - bounds.left) * viewport.width / bounds.width,
        y: (event.clientY - bounds.top) * viewport.height / bounds.height,
      },
    );
    setCameraMode(renderer.debug().cameraState().mode);
  }, []);

  return (
    <main
      ref={stageRef}
      className="slice2d"
      data-testid="vivarium-2d-slice"
      data-ready={readiness === "ready" ? "true" : "false"}
      data-camera-mode={cameraMode}
      aria-busy={readiness === "loading"}
    >
      <canvas
        ref={canvasRef}
        className="slice2d__canvas"
        aria-label="Animated Vivarium region"
        aria-describedby="slice2d-keyboard-help"
        tabIndex={0}
        onPointerDown={selectAtPointer}
        onKeyDown={handleCanvasKey}
        onWheel={handleCanvasWheel}
      />
      <nav ref={controlsRef} aria-label="World view controls" className="slice2d__camera-controls">
        <div className="slice2d__control-group" role="group" aria-label="Camera mode">
          {(["story", "follow", "free"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={cameraMode === mode}
              onClick={() => chooseCameraMode(mode)}
            >
              {mode[0]!.toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <div className="slice2d__control-group" role="group" aria-label="Moment controls">
          <button type="button" aria-pressed={paused} onClick={togglePause}>{paused ? "Resume" : "Pause"}</button>
          <button type="button" onClick={restart}>Restart</button>
        </div>
        <span className="slice2d__readiness" data-state={readiness}>
          {readiness === "ready" ? "World ready" : readiness === "unavailable" ? "World unavailable" : "Preparing world"}
        </span>
        {readiness === "unavailable" ? (
          <div className="slice2d__failure" role="alert">
            <span>
              World unavailable.
              {loadFailure?.missingSprites.length
                ? ` Missing art: ${loadFailure.missingSprites.join(", ")}.`
                : " World art could not be loaded."}
            </span>
            <button ref={retryRef} type="button" onClick={retryWorld}>Retry world</button>
          </div>
        ) : null}
      </nav>
      <section ref={dialoguePanelRef} className="slice2d__dialogue" aria-label="Current moment">
        {dialogue === null ? (
          <p className="slice2d__quiet">The path is quiet.</p>
        ) : (
          <>
            <strong>{dialogue.speakerName}</strong>
            <p className="slice2d__dialogue-text">{visibleDialogueText(dialogue)}</p>
          </>
        )}
        <button type="button" className="slice2d__view-moment" onClick={() => chooseCameraMode("story")}>View moment</button>
      </section>
      <div ref={mirrorRef} className="slice2d__semantic-mirror" aria-label="Entities in view">
        <p id="slice2d-keyboard-help">World view. Press F to follow Aster, S or Enter for Story, V for Free, arrow keys to pan, plus or minus to zoom, and Space to pause.</p>
        <button
          type="button"
          aria-pressed={selection?.kind === "agent" && selection.id === DEMO_ACTOR_ID}
          onClick={() => focusEntity(ACTOR_SELECTION)}
        >
          {semanticMirror.actorLabel}
        </button>
        {semanticMirror.shelterLabel === null ? null : (
          <button
            type="button"
            aria-pressed={selection?.kind === "home" && selection.id === DEMO_SHELTER_ID}
            onClick={() => focusEntity(SHELTER_SELECTION)}
          >
            {semanticMirror.shelterLabel}
          </button>
        )}
      </div>
      <div className="slice2d__live-region" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </div>
    </main>
  );
}
