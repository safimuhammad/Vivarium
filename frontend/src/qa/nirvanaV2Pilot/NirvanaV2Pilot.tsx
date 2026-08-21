import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type JSX,
  type PointerEvent,
} from "react";

import "./NirvanaV2Pilot.css";
import {
  clampNirvanaV2Camera,
  createNirvanaV2AtlasAssets,
  renderNirvanaV2Scene,
  type NirvanaV2AtlasAssets,
  type NirvanaV2Camera,
} from "./renderer";
import {
  NIRVANA_V2_DEFAULT_VIEWPORT,
  createNirvanaV2PilotScene,
} from "./scene";

const TERRAIN_URL = new URL(
  "../../assets/renderer2d/regions/nirvana-v3/terrain.png",
  import.meta.url,
).href;
const SCENERY_URL = new URL(
  "../../assets/renderer2d/regions/nirvana-v3/scenery.png",
  import.meta.url,
).href;
const PAN_STEP = 48;

interface DragState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly cameraX: number;
  readonly cameraY: number;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load Nirvana atlas image: ${source}`));
    image.src = source;
  });
}

/** Renders the isolated, atlas-composed Nirvana scenery approval pilot. */
export function NirvanaV2Pilot(): JSX.Element {
  const scene = useMemo(() => createNirvanaV2PilotScene(), []);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [assets, setAssets] = useState<NirvanaV2AtlasAssets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [camera, setCamera] = useState<NirvanaV2Camera>(() => clampNirvanaV2Camera(scene, {
    x: scene.cameraStart.x - NIRVANA_V2_DEFAULT_VIEWPORT.width / 2,
    y: scene.cameraStart.y - NIRVANA_V2_DEFAULT_VIEWPORT.height / 2,
    width: NIRVANA_V2_DEFAULT_VIEWPORT.width,
    height: NIRVANA_V2_DEFAULT_VIEWPORT.height,
  }));

  useEffect(() => {
    let active = true;
    Promise.all([loadImage(TERRAIN_URL), loadImage(SCENERY_URL)])
      .then(([terrainImage, sceneryImage]) => {
        if (!active) return;
        setAssets(createNirvanaV2AtlasAssets(terrainImage, sceneryImage));
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load Nirvana atlases");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (assets === null) return;
    const context = canvasRef.current?.getContext("2d");
    if (context === null || context === undefined) return;
    renderNirvanaV2Scene(context, scene, assets, camera);
  }, [assets, camera, scene]);

  const moveCamera = useCallback((x: number, y: number): void => {
    setCamera((current) => clampNirvanaV2Camera(scene, { ...current, x, y }));
  }, [scene]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      cameraX: camera.x,
      cameraY: camera.y,
    };
  }, [camera]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const scaleX = NIRVANA_V2_DEFAULT_VIEWPORT.width / Math.max(1, bounds.width);
    const scaleY = NIRVANA_V2_DEFAULT_VIEWPORT.height / Math.max(1, bounds.height);
    moveCamera(
      drag.cameraX + (drag.clientX - event.clientX) * scaleX,
      drag.cameraY + (drag.clientY - event.clientY) * scaleY,
    );
  }, [moveCamera]);

  const endPointerDrag = useCallback((event: PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
  }, []);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLCanvasElement>): void => {
    const movement: Readonly<Record<string, readonly [number, number]>> = {
      ArrowUp: [0, -PAN_STEP],
      w: [0, -PAN_STEP],
      W: [0, -PAN_STEP],
      ArrowRight: [PAN_STEP, 0],
      d: [PAN_STEP, 0],
      D: [PAN_STEP, 0],
      ArrowDown: [0, PAN_STEP],
      s: [0, PAN_STEP],
      S: [0, PAN_STEP],
      ArrowLeft: [-PAN_STEP, 0],
      a: [-PAN_STEP, 0],
      A: [-PAN_STEP, 0],
    };
    const delta = movement[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    moveCamera(camera.x + delta[0], camera.y + delta[1]);
  }, [camera, moveCamera]);

  return (
    <section className="nirvana-v2-pilot" aria-label="Nirvana atlas pilot">
      <div className="nirvana-v2-pilot__game-frame">
        <canvas
          ref={canvasRef}
          className="nirvana-v2-pilot__canvas"
          width={NIRVANA_V2_DEFAULT_VIEWPORT.width}
          height={NIRVANA_V2_DEFAULT_VIEWPORT.height}
          tabIndex={0}
          role="img"
          aria-label="Pannable pixel-art terrain map of Nirvana"
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
        />

        <header className="nirvana-v2-pilot__identity">
          <p>Worn heartland</p>
          <h1>Nirvana</h1>
        </header>

        <p className="nirvana-v2-pilot__source">
          Tile atlas pilot <span aria-hidden="true">·</span> 48 × 32 cells
        </p>
        <p className="nirvana-v2-pilot__controls">Drag the map · WASD or arrow keys</p>

        {assets === null && loadError === null ? (
          <p className="nirvana-v2-pilot__loading">Growing Nirvana…</p>
        ) : null}
        {loadError === null ? null : (
          <p className="nirvana-v2-pilot__error" role="alert">{loadError}</p>
        )}
      </div>
    </section>
  );
}
