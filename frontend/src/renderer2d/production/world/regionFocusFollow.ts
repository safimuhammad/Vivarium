/**
 * @fileoverview Pure hysteresis for "camera focus drives the live-rendered region" (Task Z3,
 * `docs/superpowers/plans/2026-07-24-world-sheet-camera.md`; orchestrator decision on Z2's open
 * question: moving the camera over a region and zooming in must bring that region to full live
 * detail).
 *
 * `regionAtPoint` (see `regionSheetLayout.ts`) already resolves which plot the camera centre
 * geometrically sits over, on every frame. Wiring that value directly into "which region is
 * live" would thrash: a camera centre that sits near a plot boundary can flicker between two
 * region ids (or the gutter, which resolves to `null`) from one frame to the next as the camera
 * eases, and each flicker would otherwise trigger a full region reload (new atlas acquisition,
 * new static cache). This module adds a minimum dwell time -- the SAME geometric candidate must
 * be the answer for `FOCUS_FOLLOW_DWELL_MS` running milliseconds, uninterrupted -- before a
 * switch is actually recommended. Any interruption (a different candidate, a gutter frame, or
 * dropping below the LOD/snapshot promotion zoom, `lodSnapshotZoom`) resets the timer for
 * whatever candidate is live afterward; it does not merely pause an already-accumulated dwell.
 *
 * Pure and time-injected (no `Date.now()`/`performance.now()` inside): the caller supplies
 * `nowMs` each call, exactly like `Camera2D.update(deltaMs)`'s pattern for testable, deterministic
 * time in this codebase.
 */

/** Carried across calls; opaque to callers beyond constructing the initial value. */
export interface FocusFollowState {
  readonly candidateRegionId: string | null;
  readonly candidateSinceMs: number;
}

export interface ResolveFocusFollowInput {
  /** `regionAtPoint(sheet, cameraCentreInSheetSpace)` for the current frame; `null` in the gutter. */
  readonly geometricFocusRegionId: string | null;
  /** The camera's current zoom. */
  readonly zoom: number;
  /**
   * The zoom below which the geometric focus is not eagerly promoted to the live-rendered region
   * (`deriveSheetZoomBounds`'s `lodSnapshotZoom`) -- i.e. the world view, where the camera can
   * roam over every plot without reloading each one it passes over.
   */
  readonly lodSnapshotZoom: number;
  /** The region currently being rendered live (`visibleRegionId`). */
  readonly currentVisibleRegionId: string | null;
  /** Monotonic running time in milliseconds, supplied by the caller. */
  readonly nowMs: number;
}

export interface ResolveFocusFollowResult {
  /** The next `FocusFollowState` to carry into the following call. */
  readonly next: FocusFollowState;
  /** A region id to switch the live region to, or `null` if no switch is recommended this call. */
  readonly switchToRegionId: string | null;
}

/**
 * Minimum uninterrupted dwell time, in milliseconds, before a geometric focus candidate is
 * recommended as the new live region. Matches the scale of the camera's own cross-threshold ease
 * (`CAMERA_EASE_MS` in `Camera2D.ts`) so a focus switch does not fire mid-ease, before the camera
 * has visually settled into the new region.
 */
export const FOCUS_FOLLOW_DWELL_MS = 240;

/** The initial state for a freshly created renderer: no pending candidate. */
export function createFocusFollowState(): FocusFollowState {
  return { candidateRegionId: null, candidateSinceMs: 0 };
}

function cleared(nowMs: number): ResolveFocusFollowResult {
  return { next: { candidateRegionId: null, candidateSinceMs: nowMs }, switchToRegionId: null };
}

/**
 * Advances the focus-follow hysteresis by one frame and decides whether the live region should
 * switch.
 *
 * Never recommends a switch below `lodSnapshotZoom` (the world view, where the camera can freely
 * roam over every plot without eagerly reloading each one it passes over), when the geometric
 * focus is the gutter (`null`), or when it already equals `currentVisibleRegionId` (nothing to
 * do). Otherwise accumulates dwell time for a stable candidate and recommends switching once it
 * has held for at least {@link FOCUS_FOLLOW_DWELL_MS}.
 *
 * @param state - The previous call's {@link ResolveFocusFollowResult.next}, or
 *   {@link createFocusFollowState}'s value on the first call.
 * @param input - This frame's camera/geometry snapshot.
 * @returns The next state to carry forward, and a region id to switch to (or `null`).
 */
export function resolveFocusFollow(
  state: FocusFollowState,
  input: ResolveFocusFollowInput,
): ResolveFocusFollowResult {
  const { geometricFocusRegionId, zoom, lodSnapshotZoom, currentVisibleRegionId, nowMs } = input;
  if (zoom < lodSnapshotZoom) return cleared(nowMs);
  if (geometricFocusRegionId === null) return cleared(nowMs);
  if (geometricFocusRegionId === currentVisibleRegionId) return cleared(nowMs);

  if (state.candidateRegionId !== geometricFocusRegionId) {
    return {
      next: { candidateRegionId: geometricFocusRegionId, candidateSinceMs: nowMs },
      switchToRegionId: null,
    };
  }

  const dwelledMs = nowMs - state.candidateSinceMs;
  if (dwelledMs >= FOCUS_FOLLOW_DWELL_MS) {
    return {
      next: { candidateRegionId: geometricFocusRegionId, candidateSinceMs: nowMs },
      switchToRegionId: geometricFocusRegionId,
    };
  }
  return { next: state, switchToRegionId: null };
}
