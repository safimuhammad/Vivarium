/**
 * @fileoverview The world-view navigation model: how a viewer gets INTO a region, how they get
 * back OUT, and which island they are pointing at.
 *
 * The model is a **place latch**, not a zoom threshold. Before this module the world/region
 * regime was a pure function of the camera's zoom value (`zoom >= lodSnapshotZoom` inside
 * `Camera2D`), which has two fatal properties: there is no state, so there is no hysteresis — one
 * wheel notch across the value flips the regime — and the value itself is a CONTAIN fit, so the
 * archipelago is already on screen around the region before the regime even changes. Between them
 * that is the reported defect: *"when I zoom back it takes me out of the region and shows me other
 * regions as well."*
 *
 * So the regime becomes an explicit scope the viewer owns:
 *
 * - `"region"` — inside a place. The zoom floor is that region's own COVER zoom (the zoom at which
 *   its plot fills the canvas), so no gesture can reveal a neighbour, and zooming out simply pins
 *   at the floor. Leaving is a deliberate act: the {@link resolveZoomOutDetent} step-out, the Esc
 *   key, or the stage's "world view" control.
 * - `"world"` — the archipelago. The floor is the whole sheet's contain fit; the camera roams the
 *   sheet; islands are hoverable and clickable.
 *
 * Both transitions are animated (see {@link descentTarget} / {@link ascentTarget}) because the
 * atlas design asks for "descending into a place rather than switching screens"
 * (`docs/frontend/ATLAS_VIEW.md`, plate `06-descent-into-nirvana`).
 *
 * Pure and time-injected throughout (`nowMs` is supplied by the caller), matching
 * `regionFocusFollow.ts` and `Camera2D.update(deltaMs)`: no `Date.now()`, no `Math.random()`, no
 * rendering imports.
 */

/** Which regime the world view is in. Owned by the viewer, never inferred from a zoom value. */
export type WorldViewScope = "world" | "region";

/** An axis-aligned rect in whatever single coordinate frame the caller is working in. */
export interface NavigationRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in the same frame as the rects handed to the same call. */
export interface NavigationPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Signed distance from a plot-LOCAL point to that region's own coastline, in mask CELLS
 * (negative on land, positive at sea) — i.e. `maskDistanceAtLocal`. `null` when the region has no
 * silhouette at all, which makes the pick fall back to plain rect containment.
 */
export type RegionLandDistance = (
  regionId: string,
  localX: number,
  localY: number,
) => number | null;

export interface RegionPickInput {
  /** Every region's plot rect, keyed by region id, in one shared frame. */
  readonly rects: Readonly<Record<string, NavigationRect>>;
  /** The point to resolve, in that same frame. */
  readonly point: NavigationPoint;
  /** Coastline probe; see {@link RegionLandDistance}. */
  readonly landDistance?: RegionLandDistance;
  /**
   * How far offshore, in mask cells, still counts as pointing at that island. A few cells of slack
   * keeps the surf and the beach clickable (they are visibly part of the island) without making
   * open sea a target.
   */
  readonly shoreToleranceCells?: number;
}

/**
 * Default offshore slack for a pick, in mask cells (a cell is a quarter tile, `MASK_CELL_PX`).
 * Covers the surf/foam bands that are visibly part of the island's shore.
 */
export const SHORE_TOLERANCE_CELLS = 6;

/**
 * Which region a pointer is pointing at.
 *
 * **Routing is through the plot RECT, exactly as documented** for `regionAtPoint` — the island
 * mask is a portrait drawn inside the rect, not the region's footprint, so it must never be the
 * thing that decides *which region a coordinate belongs to*. What the coastline is allowed to do
 * here is REFINE and REJECT: among the (possibly overlapping) rects that contain the point, the
 * island whose own coastline the point is nearest wins, and a point that is well out to sea inside
 * some plot's bounding box resolves to nothing rather than to that plot. That is the honest way to
 * make hover and click "feel like they respect the coastline": the decision is still the rect's,
 * the silhouette only says whether the viewer is plainly pointing at that island's land.
 *
 * A region with no mask (no `landDistance`, or `null` for it) falls back to nearest-plot-centre,
 * i.e. exactly `regionAtPoint`'s tie-break, so behaviour degrades rather than disappearing.
 *
 * @returns The region id, or `null` for open sea / outside every plot.
 */
export function pickRegionAtPoint(input: RegionPickInput): string | null {
  const { point, rects } = input;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const tolerance = Number.isFinite(input.shoreToleranceCells ?? Number.NaN)
    ? Math.max(0, input.shoreToleranceCells as number)
    : SHORE_TOLERANCE_CELLS;
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  let bestIsCoastal = false;
  for (const id of Object.keys(rects).sort()) {
    const rect = rects[id];
    if (rect === undefined || !finiteRect(rect)) continue;
    if (point.x < rect.x || point.x >= rect.x + rect.width
      || point.y < rect.y || point.y >= rect.y + rect.height) continue;
    const distance = input.landDistance?.(id, point.x - rect.x, point.y - rect.y) ?? null;
    if (distance !== null && Number.isFinite(distance)) {
      if (distance > tolerance) continue;
      // A coastline answer always beats a centre-distance answer, and among coastline answers the
      // nearest (most deeply inland) one wins.
      if (!bestIsCoastal || distance < bestScore) {
        best = id;
        bestScore = distance;
        bestIsCoastal = true;
      }
      continue;
    }
    if (bestIsCoastal) continue;
    const centreDistance = Math.hypot(
      point.x - (rect.x + rect.width / 2),
      point.y - (rect.y + rect.height / 2),
    );
    if (centreDistance < bestScore) {
      best = id;
      bestScore = centreDistance;
    }
  }
  return best;
}

/**
 * Carried across {@link resolveZoomOutDetent} calls.
 *
 * `pinnedAtMs` is when the CURRENT zoom-out gesture first pressed against the region floor;
 * `null` while no gesture is pressing.
 */
export interface ZoomOutDetentState {
  readonly pinnedAtMs: number | null;
  readonly lastPressMs: number | null;
}

/**
 * Two zoom-out events closer together than this are one continuous gesture (a trackpad pinch is a
 * stream of dozens of wheel events; a held `-` key auto-repeats). The detent must never be tripped
 * by the tail of the gesture that reached the floor, or "zoom out a little too far" would eject
 * the viewer again — the whole defect.
 */
export const DETENT_GESTURE_GAP_MS = 160;

/**
 * How long the armed detent remembers that the viewer already pressed against the floor. A second
 * gesture after this has expired just re-pins (and re-shows the affordance) instead of leaving, so
 * a stale press from a minute ago can never eject anyone.
 */
export const DETENT_ARMED_WINDOW_MS = 2_500;

export interface ZoomOutDetentInput {
  /** True when the camera is already sitting on the region floor and cannot zoom out further. */
  readonly pressingFloor: boolean;
  /** Monotonic running time supplied by the caller. */
  readonly nowMs: number;
}

export interface ZoomOutDetentResult {
  readonly next: ZoomOutDetentState;
  /** True on the deliberate SECOND gesture: the viewer means to leave the region. */
  readonly leaveRegion: boolean;
  /** True while the affordance ("zoom out again to leave") should be on screen. */
  readonly showHint: boolean;
}

export function createZoomOutDetentState(): ZoomOutDetentState {
  return { pinnedAtMs: null, lastPressMs: null };
}

/**
 * The step-out detent: zooming out inside a region pins at the floor and *offers* the exit; a
 * second, separate zoom-out gesture takes it.
 *
 * Called once per zoom intent. `pressingFloor` false (the viewer is zooming in, or still has room
 * to zoom out) is not a reset — the arming window is what expires the offer — it only ends the
 * current gesture, so pinch-out → release → pinch-out reads as two gestures and leaves, while one
 * long pinch-out never does.
 */
export function resolveZoomOutDetent(
  state: ZoomOutDetentState,
  input: ZoomOutDetentInput,
): ZoomOutDetentResult {
  const { nowMs } = input;
  const armedSince = state.pinnedAtMs;
  const armedIsLive = armedSince !== null && nowMs - armedSince <= DETENT_ARMED_WINDOW_MS;
  if (!input.pressingFloor) {
    return {
      next: { pinnedAtMs: armedIsLive ? armedSince : null, lastPressMs: null },
      leaveRegion: false,
      showHint: armedIsLive,
    };
  }
  const continuingGesture = state.lastPressMs !== null
    && nowMs - state.lastPressMs < DETENT_GESTURE_GAP_MS;
  if (continuingGesture) {
    return {
      next: { pinnedAtMs: armedIsLive ? armedSince : nowMs, lastPressMs: nowMs },
      leaveRegion: false,
      showHint: true,
    };
  }
  if (armedIsLive) {
    return { next: createZoomOutDetentState(), leaveRegion: true, showHint: false };
  }
  return {
    next: { pinnedAtMs: nowMs, lastPressMs: nowMs },
    leaveRegion: false,
    showHint: true,
  };
}

/** A camera destination for an animated scope change. */
export interface NavigationFlight {
  readonly center: NavigationPoint;
  readonly zoom: number;
  readonly durationMs: number;
}

/**
 * Arrival zoom floor for a descent. `1` is the pixel art's own scale — arriving at the region's
 * bare cover zoom would land a viewer on a half-size world, which is not "arriving on the island".
 */
export const DESCENT_ARRIVAL_ZOOM = 1;

/** Ceiling for a descent's arrival zoom: a small region covers the canvas at a high zoom, and
 * slamming to 4x on arrival reads as a jump cut rather than a landing. */
export const DESCENT_MAX_ARRIVAL_ZOOM = 2;

/** How long a descent takes. Long enough to read as falling toward a place, short enough that a
 * viewer who clicked twice is not waiting. */
export const DESCENT_DURATION_MS = 900;

/** How long an ascent takes. Shorter than a descent: pulling back is a retreat, not a reveal. */
export const ASCENT_DURATION_MS = 620;

/**
 * The camera destination that lands a viewer INSIDE `rect`.
 *
 * Zoom is the region's own COVER fit (`max` of the axis ratios — the zoom at which its plot fills
 * the canvas and no neighbour can be on screen), raised to at least {@link DESCENT_ARRIVAL_ZOOM}
 * and capped at {@link DESCENT_MAX_ARRIVAL_ZOOM}, but never below cover: covering the canvas is
 * the property that makes the arrival an arrival.
 */
export function descentTarget(
  rect: NavigationRect,
  viewportWidth: number,
  viewportHeight: number,
  durationMs: number = DESCENT_DURATION_MS,
): NavigationFlight | null {
  const cover = coverZoomFor(rect, viewportWidth, viewportHeight);
  if (cover === null) return null;
  const zoom = Math.max(cover, Math.min(DESCENT_MAX_ARRIVAL_ZOOM, DESCENT_ARRIVAL_ZOOM));
  return {
    center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    zoom,
    durationMs: Math.max(0, durationMs),
  };
}

/**
 * The camera destination that shows the WHOLE archipelago: the sheet's contain fit, centred on the
 * sheet. This is the one place "back to world" is defined, so the badge control, the Esc key and
 * the zoom-out detent all land in exactly the same view.
 */
export function ascentTarget(
  bounds: NavigationRect,
  viewportWidth: number,
  viewportHeight: number,
  durationMs: number = ASCENT_DURATION_MS,
): NavigationFlight | null {
  if (!finiteRect(bounds) || bounds.width <= 0 || bounds.height <= 0) return null;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0
    || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  const zoom = Math.min(viewportWidth / bounds.width, viewportHeight / bounds.height);
  if (!Number.isFinite(zoom) || zoom <= 0) return null;
  return {
    center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    zoom,
    durationMs: Math.max(0, durationMs),
  };
}

/**
 * The zoom at which `rect` COVERS the viewport — the world-view floor for a region the viewer is
 * inside, and the latch point on the way in. `null` on degenerate input.
 *
 * Deliberately the same quantity the renderer's own `atlasCoverZoom` uses to dissolve the map
 * dressing, so "the atlas has nothing left to say" and "the viewer is inside the region" are the
 * same moment rather than two nearby ones.
 */
export function coverZoomFor(
  rect: NavigationRect,
  viewportWidth: number,
  viewportHeight: number,
): number | null {
  if (!finiteRect(rect) || rect.width <= 0 || rect.height <= 0) return null;
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0
    || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  const cover = Math.max(viewportWidth / rect.width, viewportHeight / rect.height);
  return Number.isFinite(cover) && cover > 0 ? cover : null;
}

function finiteRect(rect: NavigationRect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y)
    && Number.isFinite(rect.width) && Number.isFinite(rect.height);
}
