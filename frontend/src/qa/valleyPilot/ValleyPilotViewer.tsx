import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import atlasManifest from "../nirvanaValleyPilot/assets/atlas.json";
import {
  createValleyPaintPlan,
  renderValleyPlan,
  type CompactValleyAtlasManifest,
} from "../nirvanaValleyPilot/valleyPainter";
import { createValleyScene, type ValleyScene } from "../nirvanaValleyPilot/valleyScene";
import "./ValleyPilotViewer.css";
import {
  computeBridgeOverlay,
  computeSceneStats,
  computeWalkabilityOverlay,
  type OverlayBuffer,
} from "./valleyOverlays";
import {
  clampCamera,
  initialCamera,
  panBy,
  zoomAroundPoint,
  KEY_PAN_STEP,
  ZOOM_STEP_FACTOR,
  type Camera,
  type PanOffset,
  type ViewportSize,
} from "./viewport";

const TERRAIN_URL = new URL("../nirvanaValleyPilot/assets/terrain.png", import.meta.url).href;
const SCENERY_URL = new URL("../nirvanaValleyPilot/assets/scenery.png", import.meta.url).href;

/**
 * The authored atlas ships as schema-2 (compact) JSON; a plain JSON import's
 * inferred literal type does not carry the tuple shape `createValleyPaintPlan`
 * expects for `sceneryFrames`, so this one cast stands in for it. Nothing
 * about the manifest's CONTENT is asserted here — `createValleyPaintPlan`
 * still validates every frame it looks up, exactly as it does for the Node
 * capture script that proved this same manifest byte-for-byte.
 */
const VALLEY_ATLAS = atlasManifest as unknown as CompactValleyAtlasManifest;

interface LoadedImages {
  readonly terrain: HTMLImageElement;
  readonly scenery: HTMLImageElement;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load valley pilot image: ${source}`));
    image.src = source;
  });
}

function paintOverlayCanvas(canvas: HTMLCanvasElement | null, overlay: OverlayBuffer): void {
  const context = canvas?.getContext("2d") ?? null;
  if (context === null) return;
  context.putImageData(new ImageData(overlay.data, overlay.width, overlay.height), 0, 0);
}

interface DragState {
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly startPan: PanOffset;
}

const PAN_KEYS: Readonly<Record<string, PanOffset>> = {
  ArrowUp: { x: 0, y: KEY_PAN_STEP },
  ArrowDown: { x: 0, y: -KEY_PAN_STEP },
  ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
  ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
};

const ZOOM_IN_KEYS = new Set(["+", "="]);
const ZOOM_OUT_KEYS = new Set(["-", "_"]);

/**
 * Renders the isolated Nirvana river-valley terrain pilot for free
 * look-around: the real painter's art at native scale, a walkability tint
 * toggle, a bridge-deck highlight toggle, and a scene-numbers readout.
 *
 * QA-only. Draws exclusively through `createValleyScene` /
 * `createValleyPaintPlan` / `renderValleyPlan` (the same production-backed
 * pilot modules the Node and browser-canvas capture scripts use) plus this
 * package's own overlay rasterisers; it does not reach into the chronicle or
 * observer runtime.
 */
export function ValleyPilotViewer(): JSX.Element {
  const scene = useMemo<ValleyScene>(() => createValleyScene(), []);
  const plan = useMemo(() => createValleyPaintPlan(scene, VALLEY_ATLAS), [scene]);
  const walkabilityOverlay = useMemo(() => computeWalkabilityOverlay(scene), [scene]);
  const bridgeOverlay = useMemo(() => computeBridgeOverlay(scene), [scene]);
  const stats = useMemo(() => computeSceneStats(scene), [scene]);
  const sceneSize = useMemo(
    () => ({ width: scene.widthPixels, height: scene.heightPixels }),
    [scene],
  );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const walkabilityCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bridgeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const [images, setImages] = useState<LoadedImages | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState<ViewportSize>(sceneSize);
  const [camera, setCamera] = useState<Camera>(() => initialCamera(sceneSize, sceneSize));
  const [showWalkability, setShowWalkability] = useState(false);
  const [showBridges, setShowBridges] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([loadImage(TERRAIN_URL), loadImage(SCENERY_URL)])
      .then(([terrain, scenery]) => {
        if (!active) return;
        setImages({ terrain, scenery });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load the valley pilot assets");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (images === null) return;
    const context = terrainCanvasRef.current?.getContext("2d") ?? null;
    if (context === null) return;
    renderValleyPlan(context, plan, { terrain: images.terrain, scenery: images.scenery });
  }, [images, plan]);

  useEffect(() => {
    paintOverlayCanvas(walkabilityCanvasRef.current, walkabilityOverlay);
  }, [walkabilityOverlay]);

  useEffect(() => {
    paintOverlayCanvas(bridgeCanvasRef.current, bridgeOverlay);
  }, [bridgeOverlay]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry === undefined) return;
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setViewportSize(next);
      setCamera((current) => clampCamera(current, sceneSize, next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [sceneSize]);

  useEffect(() => {
    const element = viewportRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const focal = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const factor = event.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR;
      setCamera((current) => zoomAroundPoint(current, current.zoom * factor, focal, sceneSize, viewportSize));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [sceneSize, viewportSize]);

  const zoomFromCenter = useCallback((factor: number): void => {
    setCamera((current) => zoomAroundPoint(
      current,
      current.zoom * factor,
      { x: viewportSize.width / 2, y: viewportSize.height / 2 },
      sceneSize,
      viewportSize,
    ));
  }, [sceneSize, viewportSize]);

  const resetView = useCallback((): void => {
    setCamera(initialCamera(sceneSize, viewportSize));
  }, [sceneSize, viewportSize]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    event.currentTarget.focus();
    // Pointer capture is a smoothness nicety (keeps delivering move/up events
    // if the pointer leaves the element mid-drag) — never a precondition for
    // the drag itself. Some pointer sources reject it (`NotFoundError: No
    // active pointer with the given id is found`), and a failure here must
    // never abort the gesture: the drag state below still gets set either way.
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Capture is best-effort; the drag proceeds without it.
    }
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: camera.pan,
    };
  }, [camera.pan]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const delta = {
      x: drag.startPan.x + (event.clientX - drag.startClientX),
      y: drag.startPan.y + (event.clientY - drag.startClientY),
    };
    setCamera((current) => clampCamera({ zoom: current.zoom, pan: delta }, sceneSize, viewportSize));
  }, [sceneSize, viewportSize]);

  const endDrag = useCallback((event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Already released, or never captured — nothing to clean up.
    }
    dragRef.current = null;
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const panDelta = PAN_KEYS[event.key];
    if (panDelta !== undefined) {
      event.preventDefault();
      setCamera((current) => panBy(current, panDelta, sceneSize, viewportSize));
      return;
    }
    if (ZOOM_IN_KEYS.has(event.key)) {
      event.preventDefault();
      zoomFromCenter(ZOOM_STEP_FACTOR);
      return;
    }
    if (ZOOM_OUT_KEYS.has(event.key)) {
      event.preventDefault();
      zoomFromCenter(1 / ZOOM_STEP_FACTOR);
    }
  }, [sceneSize, viewportSize, zoomFromCenter]);

  const worldStyle: CSSProperties = {
    width: scene.widthPixels,
    height: scene.heightPixels,
    transform: `translate(${camera.pan.x}px, ${camera.pan.y}px) scale(${camera.zoom})`,
  };

  return (
    <section className="valley-pilot" aria-label="Nirvana valley terrain pilot">
      <div
        ref={viewportRef}
        className="valley-pilot__viewport"
        tabIndex={0}
        role="img"
        aria-label="Pannable, zoomable pixel-art terrain map of the Nirvana river valley"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div className="valley-pilot__world" style={worldStyle}>
          <canvas
            ref={terrainCanvasRef}
            className="valley-pilot__canvas"
            width={scene.widthPixels}
            height={scene.heightPixels}
          />
          <canvas
            ref={walkabilityCanvasRef}
            className="valley-pilot__canvas valley-pilot__canvas--overlay"
            width={scene.widthPixels}
            height={scene.heightPixels}
            style={{ opacity: showWalkability ? 1 : 0 }}
            aria-hidden="true"
          />
          <canvas
            ref={bridgeCanvasRef}
            className="valley-pilot__canvas valley-pilot__canvas--overlay"
            width={scene.widthPixels}
            height={scene.heightPixels}
            style={{ opacity: showBridges ? 1 : 0 }}
            aria-hidden="true"
          />
        </div>
      </div>

      <header className="valley-pilot__identity">
        <p>Terrain pilot</p>
        <h1>Nirvana river valley</h1>
      </header>

      <div className="valley-pilot__hud">
        <div className="valley-pilot__toggles">
          <button
            type="button"
            className="valley-pilot__toggle"
            aria-pressed={showWalkability}
            onClick={() => setShowWalkability((value) => !value)}
          >
            Walkability: {showWalkability ? "on" : "off"}
          </button>
          <button
            type="button"
            className="valley-pilot__toggle"
            aria-pressed={showBridges}
            onClick={() => setShowBridges((value) => !value)}
          >
            Bridges: {showBridges ? "on" : "off"}
          </button>
          <button type="button" className="valley-pilot__toggle" onClick={() => zoomFromCenter(ZOOM_STEP_FACTOR)}>
            Zoom in
          </button>
          <button type="button" className="valley-pilot__toggle" onClick={() => zoomFromCenter(1 / ZOOM_STEP_FACTOR)}>
            Zoom out
          </button>
          <button type="button" className="valley-pilot__toggle" onClick={resetView}>
            Reset view
          </button>
        </div>

        <dl className="valley-pilot__stats">
          <div>
            <dt>Zoom</dt>
            <dd>{Math.round(camera.zoom * 100)}%</dd>
          </div>
          <div>
            <dt>Walkable</dt>
            <dd>{stats.walkableTiles} / {stats.totalTiles}</dd>
          </div>
          <div>
            <dt>Blocked</dt>
            <dd>{stats.blockedTiles}</dd>
          </div>
          <div>
            <dt>Crossings</dt>
            <dd>{stats.crossings}</dd>
          </div>
          <div>
            <dt>Bridges</dt>
            <dd>{stats.bridges} ({stats.bridgeDeckTiles} deck tiles)</dd>
          </div>
        </dl>
      </div>

      <p className="valley-pilot__controls">Drag or arrow keys to pan &middot; wheel or +/- to zoom</p>

      {images === null && loadError === null ? (
        <p className="valley-pilot__loading">Growing the valley…</p>
      ) : null}
      {loadError === null ? null : (
        <p className="valley-pilot__error" role="alert">{loadError}</p>
      )}
    </section>
  );
}
