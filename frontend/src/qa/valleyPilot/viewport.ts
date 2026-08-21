/**
 * Pure pan/zoom camera math for the valley pilot viewer.
 *
 * The viewer paints the whole scene once, at native pixel scale, onto stacked
 * canvases; panning and zooming are a CSS `translate(...) scale(...)` over
 * that fixed raster rather than a redraw. This module owns the arithmetic
 * that keeps the camera inside the scene's bounds. The viewer has full
 * authority over the camera at all times — nothing here or in the component
 * ever moves the camera except a direct user action (drag, wheel, key, or
 * button), and every entry point below is a pure function of its inputs.
 */

/** Smallest zoom the viewer allows (the whole 1536×1024 valley shrunk down). */
export const MIN_ZOOM = 0.25;

/** Largest zoom the viewer allows (close inspection of individual tiles). */
export const MAX_ZOOM = 6;

/** Multiplicative step applied per wheel notch or +/- key press. */
export const ZOOM_STEP_FACTOR = 1.25;

/** Screen pixels panned per arrow-key press, at any zoom level. */
export const KEY_PAN_STEP = 64;

export interface SceneSize {
  readonly width: number;
  readonly height: number;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface PanOffset {
  readonly x: number;
  readonly y: number;
}

/** The camera's full state: zoom factor plus the CSS-pixel pan translate. */
export interface Camera {
  readonly zoom: number;
  readonly pan: PanOffset;
}

/** Clamp a zoom factor to the viewer's supported range. Non-finite input floors to the minimum. */
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * Clamp one pan axis so the scaled scene never leaves a gap on one edge with
 * canvas run off the other. When the scaled scene is smaller than the
 * viewport on this axis, it is centered and panning is disabled — there is
 * nothing to pan to, the whole scene is already visible.
 */
function clampAxis(offset: number, scaledSceneExtent: number, viewportExtent: number): number {
  if (scaledSceneExtent <= viewportExtent) {
    return (viewportExtent - scaledSceneExtent) / 2;
  }
  const minOffset = viewportExtent - scaledSceneExtent;
  return Math.min(0, Math.max(minOffset, offset));
}

/** Clamp a pan offset (CSS pixels) to the scene's bounds at the given zoom. */
export function clampPan(
  pan: PanOffset,
  zoom: number,
  scene: SceneSize,
  viewport: ViewportSize,
): PanOffset {
  return {
    x: clampAxis(pan.x, scene.width * zoom, viewport.width),
    y: clampAxis(pan.y, scene.height * zoom, viewport.height),
  };
}

/** Clamp a full camera (zoom, then pan against the resulting scale) to the scene's bounds. */
export function clampCamera(camera: Camera, scene: SceneSize, viewport: ViewportSize): Camera {
  const zoom = clampZoom(camera.zoom);
  return { zoom, pan: clampPan(camera.pan, zoom, scene, viewport) };
}

/** The default camera: native scale, clamped into the current viewport. */
export function initialCamera(scene: SceneSize, viewport: ViewportSize): Camera {
  return clampCamera({ zoom: 1, pan: { x: 0, y: 0 } }, scene, viewport);
}

/** Pan by a screen-pixel delta (e.g. a drag delta or an arrow-key step), clamped. */
export function panBy(
  camera: Camera,
  delta: PanOffset,
  scene: SceneSize,
  viewport: ViewportSize,
): Camera {
  return clampCamera(
    { zoom: camera.zoom, pan: { x: camera.pan.x + delta.x, y: camera.pan.y + delta.y } },
    scene,
    viewport,
  );
}

/**
 * Zoom to `nextZoom`, keeping the world point currently under `focal` (a
 * viewport-relative screen point — the cursor, or the viewport centre for a
 * keyboard/button zoom) fixed on screen, then clamp the result. Returns the
 * same camera instance when the requested zoom clamps to the current zoom,
 * so callers can skip redundant renders.
 */
export function zoomAroundPoint(
  camera: Camera,
  nextZoom: number,
  focal: PanOffset,
  scene: SceneSize,
  viewport: ViewportSize,
): Camera {
  const clampedNext = clampZoom(nextZoom);
  if (clampedNext === camera.zoom) return camera;
  const worldX = (focal.x - camera.pan.x) / camera.zoom;
  const worldY = (focal.y - camera.pan.y) / camera.zoom;
  const pan = {
    x: focal.x - worldX * clampedNext,
    y: focal.y - worldY * clampedNext,
  };
  return clampCamera({ zoom: clampedNext, pan }, scene, viewport);
}
