import type { CameraMode, Rect, SafeFrameInsets, Vec2 } from "../contracts";
import {
  nearestPeriodicCoordinate,
  type RegionPresentationTopology,
  wrapCoordinate,
} from "./RegionPresentationTopology";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 4;

/**
 * Ceiling for a `fit` story target's derived zoom.
 *
 * Two contact-range beings occupy a rect small enough that a plain contain-fit would clamp at
 * {@link MAX_ZOOM}, far tighter than the art is authored for. 2x is where the legibility
 * grammar's screen-space blit reaches its full (non-stud) form, so it is the honest ceiling for
 * automatic framing; the viewer can still zoom past it by hand.
 */
export const STORY_FIT_MAX_ZOOM = 2;

const CAMERA_EASE_MS = 240;
const FOLLOW_DEAD_ZONE_RATIO = 0.4;
const ZERO_INSETS: SafeFrameInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export type CameraIntent =
  | {
      readonly type: "story-target";
      readonly target: Rect;
      readonly entityId?: string;
      /**
       * Fit the camera's zoom so the WHOLE target rect is inside the beat frame (see
       * `beatFrame()`), instead of keeping the viewer's `preferredZoom` and only re-centring.
       * Used for beat framing, where `target` is the union of every participant's bounds: a
       * two-being beat is only legible when both beings are on screen at once.
       */
      readonly fit?: boolean;
    }
  | { readonly type: "follow"; readonly entityId: string }
  | { readonly type: "free-pan"; readonly deltaCss: Vec2 }
  | { readonly type: "zoom"; readonly factor: number; readonly anchorCss: Vec2 }
  | {
      /**
       * A VIEWER-initiated animated move to a centre AND a zoom at once — the descent into a
       * region and the ascent back to the world view (see
       * `production/world/worldNavigation.ts`).
       *
       * Deliberately not gated by {@link Camera2DPort.setViewerControl}: this intent only ever
       * exists because the viewer asked for it (a click on an island, Esc, the world-view
       * control), so refusing it under viewer authority would mean refusing the viewer. It is
       * also the only intent that eases ZOOM — every other zoom in this module is a step —
       * because a place you fall toward reads differently from a place you cut to.
       */
      readonly type: "fly-to";
      readonly center: Vec2;
      readonly zoom: number;
      readonly durationMs: number;
    }
  | { readonly type: "return-story" };

export interface Camera2DOptions {
  readonly width: number;
  readonly height: number;
  readonly initialCenter?: Vec2;
  readonly initialZoom?: number;
  readonly safeFrame?: SafeFrameInsets;
  readonly reducedMotion?: boolean;
}

export interface CameraSnapshot {
  readonly mode: CameraMode;
  readonly topology: RegionPresentationTopology;
  readonly center: Vec2;
  readonly zoom: number;
  /**
   * True while the VIEWER owns framing (see {@link Camera2DPort.setViewerControl}). Every
   * automatic re-framing path is inert while this is set; only an explicit release
   * (`return-story`) hands framing back.
   */
  readonly viewerControlled: boolean;
  readonly followEntityId: string | null;
  readonly storyEntityId: string | null;
  readonly storyTarget: Rect | null;
  readonly guidedTarget: Rect | null;
  readonly pendingStoryEntityId: string | null;
  readonly pendingStoryTarget: Rect | null;
  readonly safeFrame: Rect;
  readonly followDeadZone: Rect;
  readonly rasterOrigin: Vec2;
  readonly worldBounds: Rect | null;
  /**
   * True exactly while a viewer-initiated `fly-to` (see {@link CameraIntent}) is animating --
   * i.e. this module's own internal flight state is active.
   *
   * Narrower than `!isSettled()`, which is also `false` during an ordinary story/follow centre
   * ease that is not a flight at all. Callers that mean "is a fly-to specifically still in the
   * air right now" (e.g. a descent/ascent landing latch) should read this instead of `isSettled`.
   * Callers that mean "is the camera doing ANYTHING right now, flight or plain ease" (e.g. "keep
   * rendering while the camera is moving") still want `isSettled()`.
   */
  readonly flying: boolean;
}

export interface CameraCheckpoint {
  readonly width: number;
  readonly height: number;
  readonly zoom: number;
  readonly preferredZoom: number;
  readonly center: Vec2;
  readonly viewerControlled: boolean;
  readonly mode: CameraMode;
  readonly topology: RegionPresentationTopology;
  readonly followEntityId: string | null;
  readonly storyEntityId: string | null;
  readonly storyTarget: Rect | null;
  readonly pendingStoryEntityId: string | null;
  readonly pendingStoryTarget: Rect | null;
  readonly worldBounds: Rect | null;
  readonly requestedSafeInsets: SafeFrameInsets;
  readonly desiredCenter: Vec2;
  readonly easeStartCenter: Vec2;
  readonly easeElapsedMs: number;
  readonly entityBounds: readonly (readonly [string, Rect])[];
}

/**
 * Checkpoint shape emitted before presentation topology (and, later, viewer control) became
 * explicit. Restoring one leaves the camera under the director's authority, which is what a
 * pre-authority checkpoint meant.
 */
export type LegacyCameraCheckpoint = Omit<CameraCheckpoint, "topology" | "viewerControlled"> & {
  readonly topology?: RegionPresentationTopology;
  readonly viewerControlled?: boolean;
};

/**
 * A region-sheet clamp view for the observer camera, expressed in the SAME local coordinate
 * frame as `worldBounds` (i.e. the caller has already translated sheet-space rects relative to
 * the observed region's own placement on the sheet).
 *
 * While set, `bounds` and `focusedRect` supersede `worldBounds`/`topology` for center clamping
 * and for the "cover the world" zoom floor: below `lodSnapshotZoom` the camera clamps to `bounds`
 * (world view, all regions); at/above it, the camera clamps to `focusedRect` (region view). This
 * always clamps -- it never wraps, regardless of `topology` -- which is how the observer's
 * toroidal wrap is retired at the camera layer (agent placement/hit-testing keep using
 * `wrapCoordinate` independently of the camera; see `RegionPresentationTopology.wrapCoordinate`).
 */
export interface CameraRegionSheet {
  readonly bounds: Rect;
  readonly focusedRect: Rect;
  /**
   * The contain-fit zoom below which the focused region stops filling the viewport.
   *
   * Named for its LIVE role: the navigation model's scope latch (`SheetScopePreference`
   * `"world"`/`"region"`) now drives the actual world/region clamp regime, so this value's only
   * remaining production use is deciding when a viewer's camera is close enough to a region to
   * promote it from a snapshot to the live-rendered detail level (see
   * `production/world/regionFocusFollow.ts`). It still serves as the regime-boundary fallback for
   * the `"auto"` scope (see `SheetScopePreference`), which production never actually uses -- it
   * always latches an explicit scope as soon as a sheet is installed -- but other, simpler camera
   * consumers that never adopt the latch still fall through to it.
   */
  readonly lodSnapshotZoom: number;
  readonly minZoom: number;
  /**
   * The zoom at which `focusedRect` COVERS the viewport (`max` of the axis ratios, vs.
   * `lodSnapshotZoom`'s `min`) — the zoom floor while the sheet scope is `"region"`.
   *
   * This is the number that makes "inside a region" mean what a viewer thinks it means: below it
   * the region no longer fills the canvas, so sea and neighbouring islands are on screen. Optional
   * for backward compatibility; `lodSnapshotZoom` is the fallback, which is the pre-scope behaviour.
   */
  readonly coverZoom?: number;
}

/**
 * What decides the world/region clamp regime.
 *
 * - `"auto"` (default) — the pre-existing behaviour: the regime is derived from the zoom value
 *   (`zoom >= lodSnapshotZoom`). Kept as the default so every call site that does not own a
 *   navigation model behaves exactly as it did.
 * - `"world"` / `"region"` — the regime is a STATE the viewer owns, and no zoom value can flip it.
 *   This is what closes "zooming out a little too far ejects me from the region": leaving becomes a
 *   deliberate act (see `production/world/worldNavigation.ts`) instead of a threshold crossing.
 */
export type SheetScopePreference = "auto" | "world" | "region";

export interface Camera2DPort {
  /** Applies a camera-level intent after the renderer resolves Follow to its selected entity ID. */
  apply(intent: CameraIntent): void;
  update(deltaMs: number): void;
  setEntityBounds(entityId: string, bounds: Rect | null): void;
  setWorldBounds(bounds: Rect | null, topology?: RegionPresentationTopology): void;
  /**
   * Installs or clears the sheet-aware clamp described by {@link CameraRegionSheet}. Pass `null`
   * to fall back to plain `worldBounds`/`topology` clamping (the pre-existing single-region
   * behaviour, unchanged).
   */
  setRegionSheet(sheet: CameraRegionSheet | null): void;
  /**
   * Hands framing authority to the viewer (`true`) or back to the director (`false`).
   *
   * This is the camera's half of the viewer-authority arbiter: while it is `true` EVERY
   * automatic framing path in this module is inert -- the per-frame story/follow
   * re-destination in {@link Camera2DPort.update}, the re-framing every bounds/viewport/safe
   * -frame setter used to perform, and an incoming `story-target` intent (which is parked as
   * *pending* instead of moving the camera). Structural clamping (world/sheet bounds and the
   * zoom floor) still applies, because that is safety, not framing.
   *
   * Only an explicit `return-story` intent clears it from inside this module; the renderer is
   * expected to call it with `true` on viewer pan/zoom/mode changes. Nothing here decides
   * *what counts* as viewer intent -- that policy lives with the caller.
   */
  setViewerControl(active: boolean): void;
  /**
   * Latches the world/region clamp regime instead of deriving it from the zoom value.
   *
   * See {@link SheetScopePreference}. Ignored while no region sheet is installed (the preference is
   * remembered and applies as soon as one is). Setting `"region"` raises the zoom floor to the
   * focused region's cover zoom, so an existing zoom below it is lifted to it — that is the point:
   * inside a region, "zoomed out past the region" is not a state the camera can be in.
   */
  setSheetScope(scope: SheetScopePreference): void;
  /**
   * Translates the camera's own centre by `delta`, without re-framing anything.
   *
   * This is a COORDINATE-FRAME change, not a framing decision, which is why it is not gated by
   * viewer authority: the observer camera works in the observed region's local frame, so when the
   * observed region changes the same world point has new local coordinates, and shifting the centre
   * by the difference is what keeps the viewer looking at what they were already looking at. Not
   * doing it is a silent teleport.
   */
  rebaseLocalFrame(delta: Vec2): void;
  /** The zoom floor in force right now (sheet/world/region derived). */
  minimumZoom(): number;
  setSafeFrame(insets: SafeFrameInsets): void;
  setViewport(width: number, height: number): void;
  checkpoint(): CameraCheckpoint;
  restore(checkpoint: CameraCheckpoint | LegacyCameraCheckpoint): void;
  worldToScreen(world: Vec2): Vec2;
  screenToWorld(screen: Vec2): Vec2;
  isSettled(): boolean;
  snapshot(): CameraSnapshot;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteVec2(value: Vec2): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y);
}

function finiteRect(rect: Rect): boolean {
  return Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && Number.isFinite(rect.x + rect.width)
    && Number.isFinite(rect.y + rect.height);
}

function normalizedInsets(insets: SafeFrameInsets): SafeFrameInsets | null {
  if (![insets.top, insets.right, insets.bottom, insets.left].every(Number.isFinite)) return null;
  return {
    top: Math.max(0, insets.top),
    right: Math.max(0, insets.right),
    bottom: Math.max(0, insets.bottom),
    left: Math.max(0, insets.left),
  };
}

function samePosition(first: Vec2, second: Vec2): boolean {
  return Math.abs(first.x - second.x) <= 1e-9 && Math.abs(first.y - second.y) <= 1e-9;
}

function cloneRect(rect: Rect | null): Rect | null {
  return rect === null ? null : { ...rect };
}

function rectCenter(rect: Rect): Vec2 {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isPresentationTopology(value: unknown): value is RegionPresentationTopology {
  return value === "bounded" || value === "toroidal";
}

/** Safety floor under a sheet-derived zoom, independent of the single-region `MIN_ZOOM`: the
 * world view is expected to need zooming out further than any one region ever did. */
const SHEET_ZOOM_FLOOR = 0.001;

/**
 * Derives the world-view minimum zoom and the region's LOD/snapshot promotion zoom from the
 * sheet's and the focused region's pixel extents vs. the viewport, instead of hardcoding them.
 *
 * Both are "contain" fits (`Math.min` of the two axis ratios), so the whole rect is guaranteed
 * to be visible without ever revealing space beyond it:
 * - `minZoom` is the zoom at which the ENTIRE SHEET (every region plus gutters) fits inside the
 *   viewport -- the floor below which the world view would have to show space beyond the sheet.
 *   Because the sheet is normally much larger than any one region, this is typically lower than
 *   the single-region `MIN_ZOOM`, which is why it is derived per-viewport rather than reusing
 *   that constant.
 * - `lodSnapshotZoom` is the zoom at which the FOCUSED region's own rect fills the viewport: below
 *   it, the region no longer fills the screen (neighbouring plots or gutter would show), so the
 *   camera should show the whole sheet instead; at/above it, the region already meets or exceeds
 *   the viewport, so bounding pan to just that region is meaningful.
 *
 * Both results are clamped into `[SHEET_ZOOM_FLOOR, MAX_ZOOM]` and fall back to `MIN_ZOOM` on
 * degenerate (non-finite, non-positive) input, so the camera never receives a zero, negative, or
 * non-finite zoom regardless of what the caller passes.
 */
export function deriveSheetZoomBounds(
  sheetBounds: Rect,
  focusedRect: Rect,
  viewportWidth: number,
  viewportHeight: number,
): Readonly<{ lodSnapshotZoom: number; minZoom: number; coverZoom: number }> {
  const viewportValid = Number.isFinite(viewportWidth) && viewportWidth > 0
    && Number.isFinite(viewportHeight) && viewportHeight > 0;
  const containZoom = (rect: Rect): number => {
    if (!viewportValid || !finiteRect(rect) || rect.width <= 0 || rect.height <= 0) return MIN_ZOOM;
    const fit = Math.min(viewportWidth / rect.width, viewportHeight / rect.height);
    return Number.isFinite(fit) ? clamp(fit, SHEET_ZOOM_FLOOR, MAX_ZOOM) : MIN_ZOOM;
  };
  const coverZoom = (rect: Rect): number => {
    if (!viewportValid || !finiteRect(rect) || rect.width <= 0 || rect.height <= 0) return MIN_ZOOM;
    const cover = Math.max(viewportWidth / rect.width, viewportHeight / rect.height);
    return Number.isFinite(cover) ? clamp(cover, SHEET_ZOOM_FLOOR, MAX_ZOOM) : MIN_ZOOM;
  };
  return {
    minZoom: containZoom(sheetBounds),
    lodSnapshotZoom: containZoom(focusedRect),
    /**
     * The zoom at which the focused region COVERS the viewport — `max` of the axis ratios where
     * `lodSnapshotZoom` is `min`. Between the two, the region has stopped filling the canvas while
     * still being the clamp target, which is exactly the band where a viewer "inside" a region can
     * see its neighbours. It is the region-scope zoom floor.
     */
    coverZoom: coverZoom(focusedRect),
  };
}

/** Creates an isolated viewer-owned camera for one logical Canvas2D viewport. */
export function createCamera(options: Camera2DOptions): Camera2DPort {
  let width = finitePositive(options.width, 1);
  let height = finitePositive(options.height, 1);
  let zoom = clamp(finitePositive(options.initialZoom ?? 1, 1), MIN_ZOOM, MAX_ZOOM);
  let preferredZoom = zoom;
  const requestedInitialCenter = options.initialCenter ?? { x: 0, y: 0 };
  let center: Vec2 = finiteVec2(requestedInitialCenter)
    && Number.isFinite(requestedInitialCenter.x * zoom)
    && Number.isFinite(requestedInitialCenter.y * zoom)
    ? { ...requestedInitialCenter }
    : { x: 0, y: 0 };
  let mode: CameraMode = "story";
  let viewerControlled = false;
  let topology: RegionPresentationTopology = "bounded";
  let followEntityId: string | null = null;
  let storyEntityId: string | null = null;
  let storyTarget: Rect | null = null;
  /** Whether the active `storyTarget` was requested with `fit` (see {@link CameraIntent}). */
  let storyTargetFit = false;
  let pendingStoryEntityId: string | null = null;
  let pendingStoryTarget: Rect | null = null;
  let worldBounds: Rect | null = null;
  let regionSheet: CameraRegionSheet | null = null;
  let sheetScope: SheetScopePreference = "auto";
  let flight: {
    fromCenter: Vec2;
    fromZoom: number;
    toCenter: Vec2;
    toZoom: number;
    elapsedMs: number;
    durationMs: number;
  } | null = null;
  let requestedSafeInsets: SafeFrameInsets = normalizedInsets(options.safeFrame ?? ZERO_INSETS) ?? ZERO_INSETS;
  let desiredCenter: Vec2 = { ...center };
  let easeStartCenter: Vec2 = { ...center };
  let easeElapsedMs = CAMERA_EASE_MS;
  const entityBounds = new Map<string, Rect>();
  const reducedMotion = options.reducedMotion ?? false;

  function validRegionSheet(sheet: CameraRegionSheet): boolean {
    return finiteRect(sheet.bounds) && sheet.bounds.width > 0 && sheet.bounds.height > 0
      && finiteRect(sheet.focusedRect) && sheet.focusedRect.width > 0 && sheet.focusedRect.height > 0
      && Number.isFinite(sheet.lodSnapshotZoom) && sheet.lodSnapshotZoom > 0
      && Number.isFinite(sheet.minZoom) && sheet.minZoom > 0
      && (sheet.coverZoom === undefined
        || (Number.isFinite(sheet.coverZoom) && sheet.coverZoom > 0));
  }

  /**
   * True when the focused region's own rect (not the whole sheet) is the active clamp target.
   *
   * A latched {@link SheetScopePreference} answers this outright — that is what makes the regime a
   * state a viewer owns rather than a threshold a gesture can trip. `"auto"` keeps the original
   * zoom-derived answer.
   */
  function sheetRegimeIsFocused(atZoom: number): boolean {
    if (regionSheet === null) return false;
    if (sheetScope === "region") return true;
    if (sheetScope === "world") return false;
    return atZoom >= regionSheet.lodSnapshotZoom;
  }

  /** The zoom floor while a region sheet is installed: the region's cover zoom inside a region
   * (no gesture may reveal a neighbour), the whole sheet's contain fit in the world view. */
  function sheetFloorZoom(): number {
    const sheet = regionSheet as CameraRegionSheet;
    if (sheetScope !== "region") return sheet.minZoom;
    return Math.max(sheet.minZoom, sheet.coverZoom ?? sheet.lodSnapshotZoom);
  }

  /** The rect the camera is currently clamped to while a region sheet is active: the whole sheet
   * below threshold (world view), or just the focused region's rect at/above it (region view). */
  function activeSheetRect(): Rect {
    return sheetRegimeIsFocused(zoom) ? regionSheet!.focusedRect : regionSheet!.bounds;
  }

  function clampCenterToRect(value: Vec2, bounds: Rect): Vec2 {
    const halfWidth = width / (2 * zoom);
    const halfHeight = height / (2 * zoom);
    const minimumX = bounds.x + halfWidth;
    const maximumX = bounds.x + bounds.width - halfWidth;
    const minimumY = bounds.y + halfHeight;
    const maximumY = bounds.y + bounds.height - halfHeight;
    return {
      x: minimumX <= maximumX
        ? clamp(value.x, minimumX, maximumX)
        : bounds.x + bounds.width / 2,
      y: minimumY <= maximumY
        ? clamp(value.y, minimumY, maximumY)
        : bounds.y + bounds.height / 2,
    };
  }

  function minimumCoverZoom(): number {
    if (regionSheet !== null) return clamp(sheetFloorZoom(), SHEET_ZOOM_FLOOR, MAX_ZOOM);
    if (topology === "toroidal") return MIN_ZOOM;
    if (worldBounds === null) return MIN_ZOOM;
    return Math.min(MAX_ZOOM, Math.max(
      MIN_ZOOM,
      width / worldBounds.width,
      height / worldBounds.height,
    ));
  }

  /** The zoom floor to enforce right now. While a region sheet is active it always applies
   * (sheet-derived, independent of camera mode); otherwise it matches the pre-existing
   * behaviour: the "cover the world" floor only in Free mode, plain `MIN_ZOOM` elsewhere. */
  function effectiveMinimumZoom(): number {
    if (regionSheet !== null) return minimumCoverZoom();
    return mode === "free" ? minimumCoverZoom() : MIN_ZOOM;
  }

  function constrainFreeCenter(value: Vec2): Vec2 {
    if (regionSheet !== null) return clampCenterToRect(value, activeSheetRect());
    if (worldBounds === null) return { ...value };
    if (topology === "toroidal") {
      return {
        x: wrapCoordinate(value.x, worldBounds.x, worldBounds.width),
        y: wrapCoordinate(value.y, worldBounds.y, worldBounds.height),
      };
    }
    return clampCenterToRect(value, worldBounds);
  }

  function activeGuidedTarget(): Rect | null {
    if (mode === "story") return storyTarget;
    if (mode !== "follow" || followEntityId === null) return null;
    return entityBounds.get(followEntityId) ?? null;
  }

  function constrainGuidedCenter(value: Vec2, target: Rect): Vec2 {
    if (regionSheet === null) {
      if (worldBounds === null) return { ...value };
      if (topology === "toroidal") return constrainFreeCenter(value);
    }
    const strict = constrainFreeCenter(value);
    const frame = activeFramingRect();
    const minimumX = target.x + target.width - (frame.x + frame.width - width / 2) / zoom;
    const maximumX = target.x - (frame.x - width / 2) / zoom;
    const minimumY = target.y + target.height - (frame.y + frame.height - height / 2) / zoom;
    const maximumY = target.y - (frame.y - height / 2) / zoom;
    return {
      x: minimumX <= maximumX ? clamp(strict.x, minimumX, maximumX) : strict.x,
      y: minimumY <= maximumY ? clamp(strict.y, minimumY, maximumY) : strict.y,
    };
  }

  function constrainCenter(value: Vec2): Vec2 {
    if (mode === "free") return constrainFreeCenter(value);
    // Viewer authority: keeping a guided target inside the safe frame is FRAMING, not safety, so it
    // must yield with every other automatic framing path. Measured live before this line existed: a
    // viewer's click-descent into another island was dragged back across the sea, because the story
    // target left behind in the old region was still being kept on screen by this constraint -- and
    // since `setRegionSheet` re-constrains every frame, it undid the arrival again and again.
    // Structural clamping (sheet/world bounds, zoom floor) still applies below.
    if (viewerControlled) return constrainFreeCenter(value);
    const target = activeGuidedTarget();
    return target === null ? constrainFreeCenter(value) : constrainGuidedCenter(value, target);
  }

  function constrainCameraState(): void {
    center = constrainCenter(center);
    desiredCenter = constrainCenter(desiredCenter);
    easeStartCenter = constrainCenter(easeStartCenter);
  }

  function normalizeToroidalState(bounds: Rect): Readonly<{
    center: Vec2;
    desiredCenter: Vec2;
    easeStartCenter: Vec2;
  }> | null {
    try {
      return {
        center: {
          x: wrapCoordinate(center.x, bounds.x, bounds.width),
          y: wrapCoordinate(center.y, bounds.y, bounds.height),
        },
        desiredCenter: {
          x: wrapCoordinate(desiredCenter.x, bounds.x, bounds.width),
          y: wrapCoordinate(desiredCenter.y, bounds.y, bounds.height),
        },
        easeStartCenter: {
          x: wrapCoordinate(easeStartCenter.x, bounds.x, bounds.width),
          y: wrapCoordinate(easeStartCenter.y, bounds.y, bounds.height),
        },
      };
    } catch {
      return null;
    }
  }

  function effectiveInsets(): SafeFrameInsets {
    const top = clamp(requestedSafeInsets.top, 0, Math.max(0, height - 1));
    const left = clamp(requestedSafeInsets.left, 0, Math.max(0, width - 1));
    const right = clamp(requestedSafeInsets.right, 0, Math.max(0, width - left - 1));
    const bottom = clamp(requestedSafeInsets.bottom, 0, Math.max(0, height - top - 1));
    return { top, right, bottom, left };
  }

  function safeFrame(): Rect {
    const safeInsets = effectiveInsets();
    return {
      x: safeInsets.left,
      y: safeInsets.top,
      width: width - safeInsets.left - safeInsets.right,
      height: height - safeInsets.top - safeInsets.bottom,
    };
  }

  /**
   * The rect a FITTED (beat) target is fitted into and centred on.
   *
   * Deliberately NOT the safe frame. The safe frame is a *centring* guarantee -- keep the subject
   * clear of overlaid chrome -- and in the real shell its measured bottom inset is large enough
   * that the safe band is only ~30% of the stage height. Fitting a beat into that band forces
   * every beat below the zoom at which the legibility grammar can even draw its full (non-stud)
   * form, which is the illegibility this framing exists to fix.
   *
   * So a beat frame keeps the TOP inset -- that is where the grammar's chrome hangs, above the
   * anchor's head, and clipping it would defeat the point -- and the horizontal insets, but takes
   * the full height below. What may pass under a bottom panel is ground, not chrome.
   */
  function beatFrame(): Rect {
    const safeInsets = effectiveInsets();
    return {
      x: safeInsets.left,
      y: safeInsets.top,
      width: Math.max(1, width - safeInsets.left - safeInsets.right),
      height: Math.max(1, height - safeInsets.top),
    };
  }

  /** The frame the active guided target is fitted into and centred on. */
  function activeFramingRect(): Rect {
    return storyTargetFit ? beatFrame() : safeFrame();
  }

  function followDeadZone(): Rect {
    const frame = safeFrame();
    const deadWidth = frame.width * FOLLOW_DEAD_ZONE_RATIO;
    const deadHeight = frame.height * FOLLOW_DEAD_ZONE_RATIO;
    return {
      x: frame.x + (frame.width - deadWidth) / 2,
      y: frame.y + (frame.height - deadHeight) / 2,
      width: deadWidth,
      height: deadHeight,
    };
  }

  function setDestination(destination: Vec2): boolean {
    if (!finiteVec2(destination)) return false;
    const constrained = constrainCenter(destination);
    if (samePosition(desiredCenter, constrained)) {
      if (reducedMotion) center = { ...desiredCenter };
      return true;
    }
    easeStartCenter = { ...center };
    easeElapsedMs = 0;
    desiredCenter = constrained;
    if (reducedMotion) {
      center = { ...constrained };
      easeStartCenter = { ...constrained };
      easeElapsedMs = CAMERA_EASE_MS;
    }
    return true;
  }

  function setTrackedDestination(destination: Vec2): boolean {
    if (!finiteVec2(destination)) return false;
    const constrained = constrainCenter(destination);
    if (samePosition(desiredCenter, constrained)) {
      if (reducedMotion) center = { ...desiredCenter };
      return true;
    }
    if (easeElapsedMs >= CAMERA_EASE_MS) {
      easeStartCenter = { ...center };
      easeElapsedMs = 0;
    }
    desiredCenter = constrained;
    if (reducedMotion) {
      center = { ...constrained };
      easeStartCenter = { ...constrained };
      easeElapsedMs = CAMERA_EASE_MS;
    }
    return true;
  }

  function freezeDestination(): void {
    desiredCenter = { ...center };
    easeStartCenter = { ...center };
    easeElapsedMs = CAMERA_EASE_MS;
  }

  function storyDestination(target: Rect): Vec2 | null {
    const targetCenter = rectCenter(target);
    // A fitted beat centres on its beat frame; an ordinary story target still centres on the
    // safe frame, exactly as before.
    const frameCenter = rectCenter(activeFramingRect());
    const destination = {
      x: targetCenter.x - (frameCenter.x - width / 2) / zoom,
      y: targetCenter.y - (frameCenter.y - height / 2) / zoom,
    };
    return finiteVec2(destination) ? destination : null;
  }

  function canRefreshGuidedDestination(
    bounds: Rect,
    candidateCenter: Vec2,
    candidateZoom: number,
  ): boolean {
    try {
      if (mode === "story" && storyTarget !== null) {
        const targetCenter = rectCenter(storyTarget);
        const frameCenter = rectCenter(activeFramingRect());
        const destination = {
          x: targetCenter.x - (frameCenter.x - width / 2) / candidateZoom,
          y: targetCenter.y - (frameCenter.y - height / 2) / candidateZoom,
        };
        if (finiteVec2(destination)) {
          wrapCoordinate(destination.x, bounds.x, bounds.width);
          wrapCoordinate(destination.y, bounds.y, bounds.height);
        }
      } else if (mode === "follow" && followEntityId !== null) {
        const trackedBounds = entityBounds.get(followEntityId);
        if (trackedBounds !== undefined) {
          const target = rectCenter(trackedBounds);
          const presentedTarget = {
            x: nearestPeriodicCoordinate(target.x, candidateCenter.x, bounds.x, bounds.width),
            y: nearestPeriodicCoordinate(target.y, candidateCenter.y, bounds.y, bounds.height),
          };
          const screen = {
            x: (presentedTarget.x - candidateCenter.x) * candidateZoom + width / 2,
            y: (presentedTarget.y - candidateCenter.y) * candidateZoom + height / 2,
          };
          const deadZone = followDeadZone();
          const clampedScreen = {
            x: clamp(screen.x, deadZone.x, deadZone.x + deadZone.width),
            y: clamp(screen.y, deadZone.y, deadZone.y + deadZone.height),
          };
          const destination = {
            x: candidateCenter.x + (screen.x - clampedScreen.x) / candidateZoom,
            y: candidateCenter.y + (screen.y - clampedScreen.y) / candidateZoom,
          };
          if (finiteVec2(destination)) {
            wrapCoordinate(destination.x, bounds.x, bounds.width);
            wrapCoordinate(destination.y, bounds.y, bounds.height);
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The zoom at which `target` is entirely inside the safe frame, clamped into
   * `[effectiveMinimumZoom(), STORY_FIT_MAX_ZOOM]`. Falls back to the viewer's
   * `preferredZoom` on degenerate geometry so a malformed target can never blank the view.
   */
  function containZoomForTarget(target: Rect): number {
    const frame = beatFrame();
    if (!finiteRect(target) || target.width <= 0 || target.height <= 0
      || frame.width <= 0 || frame.height <= 0) return preferredZoom;
    const fit = Math.min(frame.width / target.width, frame.height / target.height);
    if (!Number.isFinite(fit) || fit <= 0) return preferredZoom;
    return clamp(fit, effectiveMinimumZoom(), STORY_FIT_MAX_ZOOM);
  }

  function prepareStoryDestination(target: Rect, fit = false): Vec2 | null {
    const nextZoom = fit ? containZoomForTarget(target) : preferredZoom;
    if (nextZoom !== zoom) {
      zoom = nextZoom;
      constrainCameraState();
    }
    // A fitted frame IS the viewer's zoom until they change it: leaving `preferredZoom`
    // behind would let the next unfitted story beat (or any structural change) snap the
    // camera back to a zoom nothing on screen was framed for.
    if (fit) preferredZoom = nextZoom;
    return storyDestination(target);
  }

  /**
   * Re-issue whatever guided (story/follow) destination is active after a STRUCTURAL change
   * -- new world bounds, a new region sheet, a new safe frame, a resize.
   *
   * Inert while the viewer holds framing authority: this is the single place the four setters
   * used to independently re-frame from, and it is exactly the silent override the arbiter
   * exists to stop. Clamping still runs at each call site; only re-framing is suppressed.
   */
  function reframeGuidedDestination(): void {
    if (viewerControlled) return;
    if (mode === "story" && storyTarget !== null) {
      const destination = prepareStoryDestination(storyTarget, storyTargetFit);
      if (destination !== null) setDestination(destination);
    } else if (mode === "follow") refreshFollowDestination();
  }

  function refreshFollowDestination(): void {
    // Viewer authority: Follow is an automatic framing mode, so its per-frame re-centring is
    // one of the overrides that must yield until the viewer explicitly releases the camera.
    if (viewerControlled || followEntityId === null) return;
    const bounds = entityBounds.get(followEntityId);
    if (bounds === undefined) return;
    const nextZoom = preferredZoom;
    if (nextZoom !== zoom) {
      zoom = nextZoom;
      constrainCameraState();
    }
    const target = rectCenter(bounds);
    const screen = worldToScreen(target);
    const deadZone = followDeadZone();
    const clampedScreen = {
      x: clamp(screen.x, deadZone.x, deadZone.x + deadZone.width),
      y: clamp(screen.y, deadZone.y, deadZone.y + deadZone.height),
    };
    setDestination({
      x: center.x + (screen.x - clampedScreen.x) / zoom,
      y: center.y + (screen.y - clampedScreen.y) / zoom,
    });
  }

  function refreshStoryDestination(): void {
    // Viewer authority: the story director's per-frame re-centring on its focused entity is
    // the loudest of the silent overrides -- it must yield until an explicit release.
    //
    // A FITTED target is also skipped: it frames a whole cast, so collapsing it back onto the
    // one entity that happens to be named would undo the co-framing on the very next tick. Its
    // owner (the renderer's beat director) re-issues it as participants move.
    if (viewerControlled || storyTargetFit || storyEntityId === null) return;
    const bounds = entityBounds.get(storyEntityId);
    if (bounds === undefined) return;
    storyTarget = { ...bounds };
    storyTargetFit = false;
    const destination = prepareStoryDestination(bounds);
    if (destination !== null) setTrackedDestination(destination);
  }

  /** Snaps straight to a `fly-to` destination (reduced motion, or a zero-length flight). */
  function arriveAt(destinationCenter: Vec2, destinationZoom: number): void {
    zoom = clamp(destinationZoom, effectiveMinimumZoom(), MAX_ZOOM);
    preferredZoom = zoom;
    center = constrainCenter(destinationCenter);
    freezeDestination();
  }

  /**
   * Advances an in-flight descent/ascent by one frame.
   *
   * Zoom and centre are eased TOGETHER on one smoothstep so the move reads as a single fall rather
   * than a pan plus a zoom. `preferredZoom` is carried along on every step because the structural
   * setters (`setRegionSheet` runs every single frame in the production renderer) re-derive `zoom`
   * from `preferredZoom`; leaving it behind would have the sheet fight the flight.
   */
  function advanceFlight(deltaMs: number): void {
    const active = flight as NonNullable<typeof flight>;
    active.elapsedMs = Math.min(active.durationMs, active.elapsedMs + deltaMs);
    const linear = active.durationMs <= 0 ? 1 : active.elapsedMs / active.durationMs;
    const progress = linear * linear * (3 - 2 * linear);
    const nextZoom = active.fromZoom + (active.toZoom - active.fromZoom) * progress;
    const nextCenter = {
      x: active.fromCenter.x + (active.toCenter.x - active.fromCenter.x) * progress,
      y: active.fromCenter.y + (active.toCenter.y - active.fromCenter.y) * progress,
    };
    if (!Number.isFinite(nextZoom) || !finiteVec2(nextCenter)) {
      flight = null;
      freezeDestination();
      return;
    }
    zoom = clamp(nextZoom, effectiveMinimumZoom(), MAX_ZOOM);
    preferredZoom = zoom;
    center = constrainCenter(nextCenter);
    freezeDestination();
    if (active.elapsedMs >= active.durationMs) flight = null;
  }

  function worldToScreen(world: Vec2): Vec2 {
    if (!finiteVec2(world)) return { x: width / 2, y: height / 2 };
    const presentedWorld = topology === "toroidal" && worldBounds !== null
      ? {
          x: nearestPeriodicCoordinate(world.x, center.x, worldBounds.x, worldBounds.width),
          y: nearestPeriodicCoordinate(world.y, center.y, worldBounds.y, worldBounds.height),
        }
      : world;
    const screen = {
      x: (presentedWorld.x - center.x) * zoom + width / 2,
      y: (presentedWorld.y - center.y) * zoom + height / 2,
    };
    return finiteVec2(screen) ? screen : { x: width / 2, y: height / 2 };
  }

  function screenToWorld(screen: Vec2): Vec2 {
    if (!finiteVec2(screen)) return { ...center };
    const world = {
      x: center.x + (screen.x - width / 2) / zoom,
      y: center.y + (screen.y - height / 2) / zoom,
    };
    if (!finiteVec2(world)) return { ...center };
    if (topology === "toroidal" && worldBounds !== null) {
      return {
        x: wrapCoordinate(world.x, worldBounds.x, worldBounds.width),
        y: wrapCoordinate(world.y, worldBounds.y, worldBounds.height),
      };
    }
    return world;
  }

  return {
    apply(intent): void {
      switch (intent.type) {
        case "story-target": {
          if (!finiteRect(intent.target)) break;
          const entityId = intent.entityId?.trim() || null;
          // Viewer authority: while the viewer is driving, a story target is REMEMBERED, not
          // obeyed -- exactly as it already was in free/follow mode. The parked target is what
          // an explicit `return-story` release then frames, so releasing lands on the current
          // beat instead of wherever the camera was when the viewer took over.
          if (mode === "story" && !viewerControlled) {
            storyEntityId = entityId;
            storyTarget = cloneRect(intent.target);
            storyTargetFit = intent.fit === true;
            const destination = prepareStoryDestination(intent.target, storyTargetFit);
            if (destination === null) break;
            setDestination(destination);
          } else {
            pendingStoryEntityId = entityId;
            pendingStoryTarget = cloneRect(intent.target);
          }
          break;
        }
        case "follow": {
          mode = "follow";
          followEntityId = intent.entityId;
          freezeDestination();
          refreshFollowDestination();
          break;
        }
        case "free-pan": {
          if (!finiteVec2(intent.deltaCss)) break;
          mode = "free";
          followEntityId = null;
          // Grabbing the view mid-descent wins: the viewer's newest gesture is the truth.
          flight = null;
          zoom = Math.max(preferredZoom, effectiveMinimumZoom());
          constrainCameraState();
          const nextCenter = {
            x: center.x - intent.deltaCss.x / zoom,
            y: center.y - intent.deltaCss.y / zoom,
          };
          if (!finiteVec2(nextCenter)) break;
          center = constrainCenter(nextCenter);
          freezeDestination();
          break;
        }
        case "zoom": {
          if (!Number.isFinite(intent.factor) || intent.factor <= 0 || !finiteVec2(intent.anchorCss)) break;
          // Same rule as a pan: a zoom mid-flight is the viewer overriding their own descent.
          flight = null;
          const anchoredWorld = screenToWorld(intent.anchorCss);
          const wasFocusedRegime = sheetRegimeIsFocused(zoom);
          const minimumZoom = effectiveMinimumZoom();
          const nextZoom = clamp(zoom * intent.factor, minimumZoom, MAX_ZOOM);
          const nextCenter = {
            x: anchoredWorld.x - (intent.anchorCss.x - width / 2) / nextZoom,
            y: anchoredWorld.y - (intent.anchorCss.y - height / 2) / nextZoom,
          };
          if (!finiteVec2(nextCenter)) break;
          zoom = nextZoom;
          preferredZoom = nextZoom;
          if (regionSheet !== null && !wasFocusedRegime && sheetRegimeIsFocused(nextZoom)) {
            // Crossing from world view into region view: the focused rect can lie anywhere
            // within the (much larger) sheet the camera was just free to roam, so glide the
            // centre into its new clamp via the standard ease instead of snapping to it.
            setDestination(nextCenter);
          } else {
            // Region -> world crossings (and same-regime zooms) never need easing: the sheet
            // bounds always contain the focused rect, so a centre already valid for the smaller
            // rect stays valid for the bigger one -- there is nothing to glide.
            center = constrainCenter(nextCenter);
            freezeDestination();
          }
          break;
        }
        case "fly-to": {
          if (!finiteVec2(intent.center) || !Number.isFinite(intent.zoom) || intent.zoom <= 0) break;
          if (!Number.isFinite(intent.durationMs) || intent.durationMs <= 0 || reducedMotion) {
            flight = null;
            arriveAt(intent.center, intent.zoom);
            break;
          }
          flight = {
            fromCenter: { ...center },
            fromZoom: zoom,
            toCenter: { ...intent.center },
            toZoom: intent.zoom,
            elapsedMs: 0,
            durationMs: intent.durationMs,
          };
          // The first step lands on this frame so a viewer sees the flight begin on the click,
          // not on the next animation tick.
          freezeDestination();
          break;
        }
        case "return-story": {
          mode = "story";
          followEntityId = null;
          // An explicit hand-back to the director cancels a viewer flight: the two are opposite
          // requests, and letting a stale flight keep writing the centre would fight the beat.
          flight = null;
          // The ONE release affordance: returning to story mode is the explicit request that
          // hands framing back to the director. Nothing else clears viewer control.
          viewerControlled = false;
          if (pendingStoryTarget !== null) {
            storyEntityId = pendingStoryEntityId;
            storyTarget = pendingStoryTarget;
            storyTargetFit = false;
            pendingStoryEntityId = null;
            pendingStoryTarget = null;
          }
          if (storyTarget !== null) {
            const destination = prepareStoryDestination(storyTarget, storyTargetFit);
            if (destination !== null) setDestination(destination);
          }
          break;
        }
      }
    },

    update(deltaMs): void {
      if (!Number.isFinite(deltaMs) || deltaMs <= 0 || reducedMotion) return;
      // A flight owns both centre and zoom for its whole duration, so it runs BEFORE (and instead
      // of) the guided re-destination and the centre ease: a descent must not be re-aimed by the
      // story director mid-fall.
      if (flight !== null) {
        advanceFlight(deltaMs);
        return;
      }
      if (mode === "story") refreshStoryDestination();
      if (mode === "follow") refreshFollowDestination();
      if (samePosition(center, desiredCenter)) {
        center = { ...desiredCenter };
        easeElapsedMs = CAMERA_EASE_MS;
        return;
      }
      easeElapsedMs = Math.min(CAMERA_EASE_MS, easeElapsedMs + deltaMs);
      const linear = easeElapsedMs / CAMERA_EASE_MS;
      const progress = linear * linear * (3 - 2 * linear);
      const easedDestination = topology === "toroidal" && worldBounds !== null
        ? {
            x: nearestPeriodicCoordinate(
              desiredCenter.x,
              easeStartCenter.x,
              worldBounds.x,
              worldBounds.width,
            ),
            y: nearestPeriodicCoordinate(
              desiredCenter.y,
              easeStartCenter.y,
              worldBounds.y,
              worldBounds.height,
            ),
          }
        : desiredCenter;
      const nextCenter = {
        x: easeStartCenter.x * (1 - progress) + easedDestination.x * progress,
        y: easeStartCenter.y * (1 - progress) + easedDestination.y * progress,
      };
      if (!finiteVec2(nextCenter)) {
        freezeDestination();
        return;
      }
      center = constrainCenter(
        easeElapsedMs === CAMERA_EASE_MS ? desiredCenter : nextCenter,
      );
    },

    setEntityBounds(entityId, bounds): void {
      if (bounds === null) {
        entityBounds.delete(entityId);
        if (mode === "follow" && followEntityId === entityId) freezeDestination();
      } else {
        if (!finiteRect(bounds)) return;
        entityBounds.set(entityId, { ...bounds });
        // The bounds ledger itself stays current under viewer control (an explicit release
        // must land on where the tracked entity is NOW); only the re-framing it triggers is
        // gated, inside the two refresh helpers.
        if (mode === "story" && storyEntityId === entityId) refreshStoryDestination();
        if (mode === "follow" && followEntityId === entityId) refreshFollowDestination();
      }
    },

    setWorldBounds(bounds, nextTopology): void {
      if (nextTopology !== undefined && !isPresentationTopology(nextTopology)) return;
      if (bounds === null) {
        worldBounds = null;
        if (nextTopology !== undefined) topology = nextTopology;
        return;
      }
      if (!finiteRect(bounds) || bounds.width <= 0 || bounds.height <= 0) return;
      const candidateTopology = nextTopology ?? topology;
      const toroidalState = candidateTopology === "toroidal"
        ? normalizeToroidalState(bounds)
        : null;
      if (
        candidateTopology === "toroidal"
        && (
          toroidalState === null
          || !canRefreshGuidedDestination(bounds, toroidalState.center, preferredZoom)
        )
      ) {
        return;
      }
      worldBounds = { ...bounds };
      topology = candidateTopology;
      if (toroidalState !== null) {
        center = toroidalState.center;
        desiredCenter = toroidalState.desiredCenter;
        easeStartCenter = toroidalState.easeStartCenter;
      }
      zoom = mode === "free" || regionSheet !== null
        ? Math.max(preferredZoom, effectiveMinimumZoom())
        : preferredZoom;
      constrainCameraState();
      reframeGuidedDestination();
    },

    setRegionSheet(sheet): void {
      if (sheet === null) {
        if (regionSheet === null) return;
        regionSheet = null;
      } else {
        if (!validRegionSheet(sheet)) return;
        regionSheet = {
          bounds: { ...sheet.bounds },
          focusedRect: { ...sheet.focusedRect },
          lodSnapshotZoom: sheet.lodSnapshotZoom,
          minZoom: sheet.minZoom,
          ...(sheet.coverZoom === undefined ? {} : { coverZoom: sheet.coverZoom }),
        };
      }
      zoom = mode === "free" || regionSheet !== null
        ? Math.max(preferredZoom, effectiveMinimumZoom())
        : preferredZoom;
      constrainCameraState();
      reframeGuidedDestination();
    },

    setViewerControl(active): void {
      if (typeof active !== "boolean" || viewerControlled === active) return;
      viewerControlled = active;
      // Taking control freezes the camera exactly where the viewer left it: any in-flight
      // director ease would otherwise keep gliding to a destination the viewer just overrode.
      if (active) freezeDestination();
    },

    setSheetScope(scope): void {
      if (scope !== "auto" && scope !== "world" && scope !== "region") return;
      if (sheetScope === scope) return;
      sheetScope = scope;
      if (regionSheet === null) return;
      // Entering region scope raises the floor to the region's cover zoom; leaving it lowers the
      // floor and widens the clamp. Both are structural, so both re-run the same reconciliation
      // every other structural setter does.
      zoom = Math.max(zoom, effectiveMinimumZoom());
      preferredZoom = Math.max(preferredZoom, effectiveMinimumZoom());
      constrainCameraState();
    },

    rebaseLocalFrame(delta): void {
      if (!finiteVec2(delta)) return;
      if (delta.x === 0 && delta.y === 0) return;
      const shift = (value: Vec2): Vec2 => ({ x: value.x + delta.x, y: value.y + delta.y });
      const shifted = shift(center);
      if (!finiteVec2(shifted)) return;
      center = shifted;
      desiredCenter = shift(desiredCenter);
      easeStartCenter = shift(easeStartCenter);
      if (flight !== null) {
        flight.fromCenter = shift(flight.fromCenter);
        flight.toCenter = shift(flight.toCenter);
      }
      if (storyTarget !== null) {
        storyTarget = {
          x: storyTarget.x + delta.x,
          y: storyTarget.y + delta.y,
          width: storyTarget.width,
          height: storyTarget.height,
        };
      }
      constrainCameraState();
    },

    minimumZoom: () => effectiveMinimumZoom(),

    setSafeFrame(insets): void {
      const nextInsets = normalizedInsets(insets);
      if (nextInsets === null) return;
      requestedSafeInsets = nextInsets;
      reframeGuidedDestination();
      constrainCameraState();
    },

    setViewport(nextWidth, nextHeight): void {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0 || !Number.isFinite(nextHeight) || nextHeight <= 0) return;
      width = nextWidth;
      height = nextHeight;
      zoom = mode === "free" || regionSheet !== null
        ? Math.max(preferredZoom, effectiveMinimumZoom())
        : preferredZoom;
      reframeGuidedDestination();
      constrainCameraState();
    },

    worldToScreen,
    screenToWorld,
    checkpoint(): CameraCheckpoint {
      return {
        width,
        height,
        zoom,
        preferredZoom,
        center: { ...center },
        viewerControlled,
        mode,
        topology,
        followEntityId,
        storyEntityId,
        storyTarget: cloneRect(storyTarget),
        pendingStoryEntityId,
        pendingStoryTarget: cloneRect(pendingStoryTarget),
        worldBounds: cloneRect(worldBounds),
        requestedSafeInsets: { ...requestedSafeInsets },
        desiredCenter: { ...desiredCenter },
        easeStartCenter: { ...easeStartCenter },
        easeElapsedMs,
        entityBounds: [...entityBounds].map(([id, bounds]) => [id, { ...bounds }] as const),
      };
    },
    restore(checkpoint): void {
      width = checkpoint.width;
      height = checkpoint.height;
      zoom = checkpoint.zoom;
      preferredZoom = checkpoint.preferredZoom;
      center = { ...checkpoint.center };
      // A pre-authority checkpoint carries no flag; restoring one leaves the camera with the
      // director, which is what such a checkpoint meant when it was taken.
      viewerControlled = checkpoint.viewerControlled === true;
      mode = checkpoint.mode;
      topology = isPresentationTopology(checkpoint.topology) ? checkpoint.topology : "bounded";
      followEntityId = checkpoint.followEntityId;
      storyEntityId = checkpoint.storyEntityId;
      storyTarget = cloneRect(checkpoint.storyTarget);
      // Fit is a per-beat framing decision the beat director re-issues every frame, so a
      // restored checkpoint deliberately starts unfitted rather than carrying a stale fit.
      storyTargetFit = false;
      pendingStoryEntityId = checkpoint.pendingStoryEntityId;
      pendingStoryTarget = cloneRect(checkpoint.pendingStoryTarget);
      worldBounds = cloneRect(checkpoint.worldBounds);
      requestedSafeInsets = { ...checkpoint.requestedSafeInsets };
      desiredCenter = { ...checkpoint.desiredCenter };
      easeStartCenter = { ...checkpoint.easeStartCenter };
      easeElapsedMs = checkpoint.easeElapsedMs;
      entityBounds.clear();
      for (const [id, bounds] of checkpoint.entityBounds) entityBounds.set(id, { ...bounds });
    },
    isSettled: () => flight === null
      && easeElapsedMs >= CAMERA_EASE_MS && samePosition(center, desiredCenter),

    snapshot(): CameraSnapshot {
      const rasterX = Math.round(width / 2 - center.x * zoom);
      const rasterY = Math.round(height / 2 - center.y * zoom);
      return {
        mode,
        topology,
        center: { ...center },
        zoom,
        viewerControlled,
        followEntityId,
        storyEntityId,
        storyTarget: cloneRect(storyTarget),
        guidedTarget: cloneRect(activeGuidedTarget()),
        pendingStoryEntityId,
        pendingStoryTarget: cloneRect(pendingStoryTarget),
        safeFrame: safeFrame(),
        followDeadZone: followDeadZone(),
        rasterOrigin: {
          x: Number.isFinite(rasterX) ? rasterX : 0,
          y: Number.isFinite(rasterY) ? rasterY : 0,
        },
        worldBounds: cloneRect(worldBounds),
        flying: flight !== null,
      };
    },
  };
}
