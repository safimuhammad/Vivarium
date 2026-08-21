/**
 * Pure math for framing multiple guided-tour participants in one camera shot.
 *
 * The production camera's story-mode framing (`Camera2D`'s `"story-target"` intent,
 * see `renderer2d/camera/Camera2D.ts`) only accepts a single named entity
 * (agent/home/ruin) as its target through the QA-reachable observer API
 * (`ObserverSelection` in `presentation/contracts.ts` is `{kind, id}` — no raw
 * bounding box). This module does not add one — no production file changes here.
 * Instead, the guided tour keeps its existing single-entity `camera.requestFocus()`
 * call (see `guidedTourController.ts`) and widens the ZOOM level so every named
 * participant's tile position, not just the focused entity's, falls inside the
 * visible viewport. This module is the pure geometry: given participants' tile
 * positions and the viewport size, compute the zoom that fits them all (with
 * padding), and the exact "+"/"-" keypress counts (dispatched by
 * `domZoomDriver.ts`) needed to reach that zoom deterministically from *any*
 * starting zoom.
 */

export interface TilePosition {
  readonly column: number;
  readonly row: number;
}

export interface FitZoomInput {
  readonly positions: readonly TilePosition[];
  readonly viewportWidthPx: number;
  readonly viewportHeightPx: number;
  readonly tileSizePx: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  /** Extra tiles of breathing room added to each side of the span. Default 2. */
  readonly paddingTiles?: number;
}

export interface FitZoomResult {
  /** The zoom level to land on — always within `[minZoom, maxZoom]`. */
  readonly zoom: number;
  /**
   * False when the participants are spread wider than the viewport can show even
   * at `minZoom` — the frame still includes everyone the camera can (zoom is
   * clamped, not cropped further), but a reviewer should be told not everyone may
   * read clearly at this remove.
   */
  readonly fits: boolean;
}

const DEFAULT_PADDING_TILES = 2;

/**
 * Computes the zoom that frames every position with padding, clamped to the
 * camera's own zoom range. Zero or one position (nothing to fit around, or a
 * single participant) always resolves to `maxZoom` — the existing single-actor
 * behavior, unchanged.
 */
export function computeFitZoom(input: FitZoomInput): FitZoomResult {
  const { positions, viewportWidthPx, viewportHeightPx, tileSizePx, minZoom, maxZoom } = input;
  const padding = input.paddingTiles ?? DEFAULT_PADDING_TILES;
  if (
    positions.length < 2
    || !(viewportWidthPx > 0)
    || !(viewportHeightPx > 0)
    || !(tileSizePx > 0)
  ) {
    return Object.freeze({ zoom: maxZoom, fits: true });
  }
  const columns = positions.map((position) => position.column);
  const rows = positions.map((position) => position.row);
  const spanColumns = Math.max(...columns) - Math.min(...columns);
  const spanRows = Math.max(...rows) - Math.min(...rows);
  const worldWidthPx = (spanColumns + padding * 2) * tileSizePx;
  const worldHeightPx = (spanRows + padding * 2) * tileSizePx;
  const idealZoom = Math.min(viewportWidthPx / worldWidthPx, viewportHeightPx / worldHeightPx);
  if (!Number.isFinite(idealZoom)) return Object.freeze({ zoom: maxZoom, fits: true });
  const zoom = Math.min(maxZoom, Math.max(minZoom, idealZoom));
  return Object.freeze({ zoom, fits: idealZoom >= minZoom });
}

export interface ZoomPressPlanInput {
  readonly targetZoom: number;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly zoomInFactor: number;
  /** "-" presses guaranteed to clamp to `minZoom` from even `maxZoom`. */
  readonly resetPresses: number;
  /** "+" presses guaranteed to clamp to `maxZoom` from even `minZoom` (the single-actor path). */
  readonly maxZoomOvershootPresses: number;
}

export interface ZoomPressPlan {
  /** "-" presses to reach the known `minZoom` baseline from any starting zoom. */
  readonly resetPresses: number;
  /** "+" presses from that baseline toward (never past) the target zoom. */
  readonly zoomInPresses: number;
}

/**
 * Plans the exact keypress sequence to reach `targetZoom` deterministically
 * regardless of the camera's current (unknown-to-QA) zoom: first reset to
 * `minZoom` (enough "-" presses to clamp there from even `maxZoom`), then step
 * "+" a computed number of times. When the target is the max zoom (the ordinary
 * single-participant case) this reuses the existing proven overshoot-then-clamp
 * count so that beat's framing is byte-for-byte unchanged. Otherwise steps are
 * floored so the achieved zoom never exceeds the target — safe for a fit
 * computation, since discrete zoom steps must never crop a participant back out
 * of frame to compensate.
 */
export function computeZoomPressPlan(input: ZoomPressPlanInput): ZoomPressPlan {
  const { targetZoom, minZoom, maxZoom, zoomInFactor, resetPresses, maxZoomOvershootPresses } = input;
  if (targetZoom >= maxZoom) {
    return Object.freeze({ resetPresses, zoomInPresses: maxZoomOvershootPresses });
  }
  const ratio = targetZoom / minZoom;
  const raw = ratio <= 1 ? 0 : Math.log(ratio) / Math.log(zoomInFactor);
  const zoomInPresses = Number.isFinite(raw)
    ? Math.min(maxZoomOvershootPresses, Math.max(0, Math.floor(raw)))
    : 0;
  return Object.freeze({ resetPresses, zoomInPresses });
}
