/**
 * Drives a Chronicle's guided tour: steps through `GuidedTourBeat`s one at a time,
 * pointing the observed region + camera focus + zoom at each beat's acting being
 * (or home/ruin), delivering that beat's cursor, holding long enough to read the
 * performance, and auto-advancing — with manual pause/resume/next for a human
 * reviewer to dwell on anything (`prev` is intentionally disabled; see its own doc
 * comment).
 *
 * This controller assumes it has *exclusive* control of the injected
 * `GuidedTourPlaybackPort`'s delivery pacing for as long as it is active: cursor
 * delivery is a forward-only ratchet, so anything else concurrently calling
 * `deliverThroughCursor` on the same underlying playback (e.g. the Chronicle
 * validation route's own coarse batched auto-play, built for a human to jump
 * between review markers instantly, not to hold a paced per-beat story) would race
 * ahead of this controller's own pacing and defeat the presented-cursor gating
 * below — the beat N caption would then be shown over a *later* (possibly fully
 * delivered) world, not the world as of beat N's cursor. `ChronicleValidationApp`
 * is responsible for pausing that competing auto-play before handing this
 * controller the playback and resuming it after (see the guided-tour report's
 * "Review fixes" section for how this was found and fixed).
 *
 * Three production pacing realities this controller works around, discovered by
 * driving a real build:
 *
 * 1. Regions in this world are observed one at a time
 *    (`ObserverShellRuntime.observeRegion`) and a region's content is not
 *    guaranteed to be laid out/settled the instant it is observed, so this
 *    controller only pays a region-settle delay when a beat's region differs from
 *    the previously observed one — most consecutive beats stay in the same region
 *    and proceed immediately.
 * 2. Delivering a cursor is not the same as it being *presented*: each event plays
 *    a full real-time animated "moment" before the observer's `presentedCursor`
 *    advances, and moments are processed strictly in order. Framing the camera and
 *    starting a beat's read-the-performance hold before that beat's cursor is
 *    actually presented would show the caption for an event the screen hasn't
 *    caught up to yet — so this controller always waits for the presented cursor
 *    to reach a beat's cursor before framing/holding it. The one exception is pure
 *    "dead travel" (`agent_left_region`/`agent_entered_region`): a long cross-region
 *    walk's real-time animation can run to tens of seconds, so those beats flip on
 *    a QA-only reduced-motion override (instant `fade-reposition` instead of a
 *    walked route) for just that one event, restoring it immediately after, so the
 *    tour can cut away rather than making a reviewer sit through the walk.
 * 3. `camera.requestFocus()` doesn't move the camera instantly — Camera2D eases the
 *    center toward a new story target over ~240ms of real animation frames. The
 *    zoom driver's keyboard-anchored zoom presses (see `domZoomDriver.ts`) freeze
 *    whatever center the camera happens to be at the instant they run — reached
 *    live before the ease (or the target's own entity bounds) has caught up, this
 *    freezes the camera on a stale, not-yet-corrected position with *no*
 *    participant on screen. So this controller pays a short `cameraSettleMs` delay
 *    between requesting focus and applying zoom for an ordinary same-region beat.
 * 4. Entering a region the observer hasn't shown yet can stall the production
 *    scene's own settlement well beyond that — a pre-existing, documented,
 *    out-of-scope production performance issue (procedurally-grown region
 *    entry/settlement stalling multiple seconds to tens of seconds; see the
 *    guided-tour report's "Review fixes" section). The QA-only reduced-motion
 *    override (pacing note #2's dead-travel case) shrinks an event's *own*
 *    choreographed walk duration but cannot mask this deeper stall. Racing ahead
 *    of it (this controller's earlier, smaller `cameraSettleMs`) froze the camera
 *    on empty ground for a region-crossing beat with no dead-travel event of its
 *    own to protect it (e.g. C18's `agent_born` at cursor 14, which crosses from
 *    `nirvana` to `warm_springs` mid-story). So a beat whose region differs from
 *    the previous one pays the longer `regionCameraSettleMs` instead, giving the
 *    production scene materially more real time to settle before framing.
 *
 *    IMPORTANT — this is a mitigation, not a guarantee. Direct instrumentation
 *    (the production `debug()` probe's `visibleRegionId`, gated behind
 *    `window.__vivariumEnableProductionDiagnosticsForTest`, not something this
 *    controller can rely on in normal use) measured this specific stall taking
 *    anywhere from under a second up to well past 60s on the *same* C18 fixture
 *    across repeated runs in one browser session — consistent with the original
 *    report's "7-40x" characterization, and apparently unbounded, not just large.
 *    No signal for "has the renderer actually caught up" is observable from
 *    ordinary (non-debug-flag) QA code, so `regionCameraSettleMs` cannot be sized
 *    to guarantee correctness; it only improves the odds for the common case
 *    without making every region-crossing beat wait for the pathological one. A
 *    real fix needs either a production-exposed readiness signal (a production
 *    change, out of scope here) or accepting occasional empty-ground frames on
 *    the rare non-dead-travel beat that both crosses regions *and* lands before
 *    the scene settles.
 *
 * This module is pure orchestration over injected ports (camera, playback,
 * scheduler, zoom, motion) so it is fully unit-testable without a real
 * renderer/DOM/browser.
 */

import type { GuidedTourBeat, GuidedTourFocus } from "./guidedTourBeats";

export interface GuidedTourCameraPort {
  setCameraMode(mode: "story"): void;
  requestFocus(selection: GuidedTourFocus): void;
  observeRegion(regionId: string): void;
}

export interface GuidedTourPlaybackPort {
  deliverThroughCursor(cursor: number): void;
  resume(): void;
  pause(): void;
  getPresentedCursor(): number;
  subscribe(listener: () => void): () => void;
}

export interface GuidedTourScheduler {
  schedule(delayMs: number, callback: () => void): () => void;
}

/** Result of one beat's zoom/fit pass — see `fitToBounds.ts`'s `FitZoomResult`. */
export interface GuidedTourZoomResult {
  /** False when a far-apart pair couldn't all fit even at the widest zoom (see `GuidedTourSnapshot.framingFits`). */
  readonly fits: boolean;
}

export interface GuidedTourZoomDriver {
  zoomToTarget(beat: GuidedTourBeat): GuidedTourZoomResult;
}

/** QA-only reduced-motion override port — see the module doc's pacing note #2. */
export interface GuidedTourMotionPort {
  setReducedMotionOverride(active: boolean): void;
}

export interface GuidedTourControllerOptions {
  readonly beats: readonly GuidedTourBeat[];
  readonly camera: GuidedTourCameraPort;
  readonly playback: GuidedTourPlaybackPort;
  readonly scheduler: GuidedTourScheduler;
  readonly zoom?: GuidedTourZoomDriver;
  readonly motion?: GuidedTourMotionPort;
  /** Delay paid only when a beat's region differs from the last observed one. Default 500ms. */
  readonly regionSettleMs?: number;
  /** Delay between `camera.requestFocus()` and applying zoom, to let the camera's own ease/entity-bounds catch up first. Default 280ms. */
  readonly cameraSettleMs?: number;
  /** Same delay, but for a beat whose region differs from the previous one — see pacing note #4. Default 6000ms. */
  readonly regionCameraSettleMs?: number;
}

export interface GuidedTourSnapshot {
  readonly active: boolean;
  readonly playing: boolean;
  readonly beatIndex: number;
  readonly beat: GuidedTourBeat | null;
  readonly done: boolean;
  /**
   * False when the current beat's participants are spread wider than the camera
   * can show even at the widest zoom (see `fitToBounds.ts`). Still framed with
   * everyone in shot as best as possible — this only flags that legibility may
   * suffer, for the overlay to note.
   */
  readonly framingFits: boolean;
}

export interface GuidedTourController {
  getSnapshot(): GuidedTourSnapshot;
  subscribe(listener: () => void): () => void;
  start(): void;
  pause(): void;
  resume(): void;
  next(): void;
  /**
   * Disabled: cursor delivery (`GuidedTourPlaybackPort.deliverThroughCursor`) is a
   * forward-only ratchet — the underlying world cannot be rewound to an earlier
   * moment. Stepping the beat index backward without also rewinding the world
   * would show an earlier caption over a *later* (or fully delivered) world state,
   * exactly the desync this controller exists to prevent. A no-op, not a silent
   * jump, is the clear affordance: nothing happens, rather than lying.
   */
  prev(): void;
  dispose(): void;
}

const DEFAULT_REGION_SETTLE_MS = 500;
const DEFAULT_CAMERA_SETTLE_MS = 280;
const DEFAULT_REGION_CAMERA_SETTLE_MS = 6_000;

/** Real-wall-clock scheduler for driving a guided tour in the browser. */
export const browserGuidedTourScheduler: GuidedTourScheduler = Object.freeze({
  schedule(delayMs: number, callback: () => void): () => void {
    const handle = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(handle);
  },
});

/** Creates a guided-tour controller. Inactive (no side effects) until `start()`. */
export function createGuidedTourController(
  options: GuidedTourControllerOptions,
): GuidedTourController {
  const { beats, camera, playback, scheduler, zoom, motion } = options;
  const regionSettleMs = options.regionSettleMs ?? DEFAULT_REGION_SETTLE_MS;
  const cameraSettleMs = options.cameraSettleMs ?? DEFAULT_CAMERA_SETTLE_MS;
  const regionCameraSettleMs = options.regionCameraSettleMs ?? DEFAULT_REGION_CAMERA_SETTLE_MS;
  const listeners = new Set<() => void>();
  let active = false;
  let playing = false;
  let done = false;
  let beatIndex = 0;
  let framingFits = true;
  let lastObservedRegion: string | null = null;
  let cancelAdvance: (() => void) | null = null;
  let cancelSettle: (() => void) | null = null;
  let cancelPresentedWait: (() => void) | null = null;
  let cancelCameraSettle: (() => void) | null = null;
  let disposed = false;

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const stopTimers = (): void => {
    cancelAdvance?.();
    cancelAdvance = null;
    cancelSettle?.();
    cancelSettle = null;
    cancelPresentedWait?.();
    cancelPresentedWait = null;
    cancelCameraSettle?.();
    cancelCameraSettle = null;
  };

  const scheduleAdvanceIfPlaying = (beat: GuidedTourBeat): void => {
    if (!playing) return;
    cancelAdvance = scheduler.schedule(beat.holdMs, () => {
      cancelAdvance = null;
      advance();
    });
  };

  const focusAndHold = (beat: GuidedTourBeat, isRegionChange: boolean): void => {
    camera.setCameraMode("story");
    if (beat.focus !== null) camera.requestFocus(beat.focus);
    // See pacing notes #3/#4: give the camera's own ease + entity-bounds
    // registration a moment before applying zoom, so the zoom driver's
    // anchored-at-viewport-center presses (which freeze wherever the camera
    // currently sits) freeze the *correct*, already-arrived position rather than a
    // stale one. A region-crossing beat pays the longer delay, since the
    // production scene's own settlement (not just the camera's ease) can lag well
    // past the ordinary same-region case.
    cancelCameraSettle = scheduler.schedule(
      isRegionChange ? regionCameraSettleMs : cameraSettleMs,
      () => {
        cancelCameraSettle = null;
        framingFits = zoom?.zoomToTarget(beat).fits ?? true;
        scheduleAdvanceIfPlaying(beat);
      },
    );
  };

  const waitForPresented = (cursor: number, onReady: () => void): void => {
    if (playback.getPresentedCursor() >= cursor) {
      onReady();
      return;
    }
    const unsubscribe = playback.subscribe(() => {
      if (playback.getPresentedCursor() < cursor) return;
      cancelPresentedWait = null;
      unsubscribe();
      onReady();
    });
    cancelPresentedWait = unsubscribe;
  };

  const deliverAndWait = (beat: GuidedTourBeat, isRegionChange: boolean): void => {
    motion?.setReducedMotionOverride(beat.isDeadTravel);
    playback.deliverThroughCursor(beat.cursor);
    playback.resume();
    waitForPresented(beat.cursor, () => {
      motion?.setReducedMotionOverride(false);
      focusAndHold(beat, isRegionChange);
    });
  };

  const applyBeat = (): void => {
    const beat = beats[beatIndex];
    if (beat === undefined) return;
    const isRegionChange = beat.region !== lastObservedRegion;
    if (isRegionChange) {
      camera.observeRegion(beat.region);
      // Only mark the region observed once the settle delay actually elapses for
      // THIS beat. If a later jump()/advance() cancels this settle first (e.g. rapid
      // manual stepping), `lastObservedRegion` must stay at its old value so the next
      // beat still re-observes rather than wrongly assuming the switch completed.
      cancelSettle = scheduler.schedule(regionSettleMs, () => {
        cancelSettle = null;
        lastObservedRegion = beat.region;
        deliverAndWait(beat, isRegionChange);
      });
    } else {
      deliverAndWait(beat, isRegionChange);
    }
  };

  const advance = (): void => {
    if (beatIndex >= beats.length - 1) {
      playing = false;
      done = true;
      playback.pause();
      emit();
      return;
    }
    beatIndex += 1;
    applyBeat();
    emit();
  };

  const jump = (nextIndex: number): void => {
    if (!active || disposed) return;
    const clamped = Math.max(0, Math.min(beats.length - 1, nextIndex));
    if (clamped === beatIndex && !done) return;
    stopTimers();
    beatIndex = clamped;
    done = false;
    applyBeat();
    emit();
  };

  return {
    getSnapshot(): GuidedTourSnapshot {
      return Object.freeze({
        active,
        playing,
        beatIndex,
        beat: beats[beatIndex] ?? null,
        done,
        framingFits,
      });
    },
    subscribe(listener): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(): void {
      if (disposed || active || beats.length === 0) return;
      active = true;
      playing = true;
      done = false;
      beatIndex = 0;
      framingFits = true;
      lastObservedRegion = null;
      applyBeat();
      emit();
    },
    pause(): void {
      if (disposed || !active || !playing) return;
      stopTimers();
      playing = false;
      emit();
    },
    resume(): void {
      if (disposed || !active || playing || done) return;
      playing = true;
      const beat = beats[beatIndex];
      if (beat !== undefined) scheduleAdvanceIfPlaying(beat);
      emit();
    },
    next(): void {
      jump(beatIndex + 1);
    },
    // Disabled — see the `GuidedTourController.prev` doc comment. Cursor delivery
    // is forward-only, so stepping the beat index backward cannot be paired with
    // actually rewinding the world; a no-op is the honest affordance.
    prev(): void {},
    dispose(): void {
      if (disposed) return;
      disposed = true;
      stopTimers();
      if (active) {
        playback.pause();
        motion?.setReducedMotionOverride(false);
      }
      active = false;
      playing = false;
      listeners.clear();
    },
  };
}
