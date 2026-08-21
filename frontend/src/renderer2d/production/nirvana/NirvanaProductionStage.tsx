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

import { createSharedAtlasPool, type SharedAtlasPool } from "../assets/SharedAtlasPool";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../assets/productionManifest";
import {
  NIRVANA_ATLAS_PROFILE,
  createNirvanaProductionManifest,
} from "./NirvanaAssetProfile";
import { createNirvanaAtlasAssets, type NirvanaAtlasAssets } from "./NirvanaAtlas";
import {
  clampNirvanaCamera,
  createNirvanaPaintPlan,
  renderNirvanaPaintPlan,
  type NirvanaCamera,
} from "./NirvanaPainter";
import { createNirvanaRegion, type NirvanaRegionV2 } from "./NirvanaRegionV2";
import {
  NIRVANA_ROOT_CAMERA_START,
  createNirvanaRootChunk,
} from "./NirvanaRootChunk";
import "./NirvanaProductionStage.css";

const VIEWPORT = Object.freeze({ width: 960, height: 540 });
const PAN_STEP = 48;

interface DragState {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly cameraX: number;
  readonly cameraY: number;
}

interface OwnedAtlasBundle {
  readonly assets: NirvanaAtlasAssets;
  release(): void;
}

/** Render the production-owned Nirvana scenery and camera, with no simulation actors. */
export function NirvanaProductionStage(): JSX.Element {
  const region = useMemo<NirvanaRegionV2>(
    () => createNirvanaRegion(createNirvanaRootChunk()),
    [],
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [assets, setAssets] = useState<NirvanaAtlasAssets | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [camera, setCamera] = useState<NirvanaCamera>(() => clampNirvanaCamera(
    region,
    {
      x: NIRVANA_ROOT_CAMERA_START.x - VIEWPORT.width / 2,
      y: NIRVANA_ROOT_CAMERA_START.y - VIEWPORT.height / 2,
      ...VIEWPORT,
    },
  ));
  const paintPlan = useMemo(() => (
    assets === null
      ? null
      : createNirvanaPaintPlan(region, assets, "nirvana-v2:standalone")
  ), [assets, region]);

  useEffect(() => {
    let active = true;
    let disposed = false;
    const controller = new AbortController();
    let pool: SharedAtlasPool;
    try {
      const manifest = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);
      pool = createSharedAtlasPool({ manifest });
    } catch {
      setLoadError(true);
      return () => {
        active = false;
        dragRef.current = null;
        controller.abort();
      };
    }

    const owned = new Map<string, ProductionAssetLease<ImageBitmap>>();
    const disposeOwned = (): void => {
      if (disposed) return;
      disposed = true;
      controller.abort();
      for (const lease of owned.values()) lease.release();
      owned.clear();
      pool.dispose();
    };

    void acquireAtlasBundle(pool, controller, owned, () => disposed).then((bundle) => {
      if (!active || disposed) {
        bundle.release();
        return;
      }
      setAssets(bundle.assets);
    }).catch((error: unknown) => {
      disposeOwned();
      if (active && !isAbortError(error)) setLoadError(true);
    });

    return () => {
      active = false;
      dragRef.current = null;
      disposeOwned();
    };
  }, []);

  useEffect(() => {
    if (assets === null || paintPlan === null) return;
    const context = canvasRef.current?.getContext("2d");
    if (context === null || context === undefined) return;
    renderNirvanaPaintPlan(context, region, assets, camera, paintPlan);
  }, [assets, camera, paintPlan, region]);

  const moveCamera = useCallback((x: number, y: number): void => {
    setCamera((current) => clampNirvanaCamera(region, { ...current, x, y }));
  }, [region]);

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
    const scaleX = VIEWPORT.width / Math.max(1, bounds.width);
    const scaleY = VIEWPORT.height / Math.max(1, bounds.height);
    moveCamera(
      drag.cameraX + (drag.clientX - event.clientX) * scaleX,
      drag.cameraY + (drag.clientY - event.clientY) * scaleY,
    );
  }, [moveCamera]);

  const endPointerDrag = useCallback((event: PointerEvent<HTMLCanvasElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
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

  const clearPointerDrag = useCallback((): void => {
    dragRef.current = null;
  }, []);

  return (
    <section className="nirvana-production" aria-label="Nirvana production scenery">
      <div className="nirvana-production__frame">
        <canvas
          ref={canvasRef}
          className="nirvana-production__canvas"
          width={VIEWPORT.width}
          height={VIEWPORT.height}
          tabIndex={0}
          role="img"
          aria-label="Pannable pixel-art terrain map of Nirvana"
          aria-describedby="nirvana-production-instructions"
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onLostPointerCapture={clearPointerDrag}
        />

        <header className="nirvana-production__identity">
          <p>Worn heartland</p>
          <h1>Nirvana</h1>
        </header>

        <p
          id="nirvana-production-instructions"
          className="nirvana-production__instructions"
        >
          Drag the map · WASD or arrow keys
        </p>

        {assets === null && !loadError ? (
          <p className="nirvana-production__status">Growing Nirvana…</p>
        ) : null}
        {loadError ? (
          <p className="nirvana-production__status" role="alert">
            Unable to load the Nirvana scenery atlases.
          </p>
        ) : null}
      </div>
    </section>
  );
}

async function acquireAtlasBundle(
  pool: SharedAtlasPool,
  controller: AbortController,
  owned: Map<string, ProductionAssetLease<ImageBitmap>>,
  isDisposed: () => boolean,
): Promise<OwnedAtlasBundle> {
  const ids = [
    NIRVANA_ATLAS_PROFILE.terrainAtlasId,
    NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
  ] as const;

  await Promise.all(ids.map(async (id) => {
    const lease = await pool.acquire(id, controller.signal);
    if (isDisposed()) {
      lease.release();
      return;
    }
    owned.set(id, lease);
  }));

  if (isDisposed()) throw new DOMException("Aborted", "AbortError");
  const terrain = owned.get(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
  const scenery = owned.get(NIRVANA_ATLAS_PROFILE.sceneryAtlasId);
  if (terrain === undefined || scenery === undefined) {
    throw new Error("Nirvana atlas bundle is incomplete");
  }
  let released = false;
  return Object.freeze({
    assets: createNirvanaAtlasAssets(
      terrain.value,
      scenery.value,
      NIRVANA_ATLAS_PROFILE,
    ),
    release(): void {
      if (released) return;
      released = true;
      terrain.release();
      scenery.release();
      owned.clear();
    },
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
