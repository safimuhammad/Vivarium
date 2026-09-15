import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactElement,
} from "react";

import { Vivarium2DApp, type Vivarium2DAppProps } from "../app/Vivarium2DApp";
import type { ObserverShellRuntime } from "../app/observer2d/observerShellRuntime";
import { getChronicleManifest } from "../presentation/fixtures/chronicleCatalog";
import type { ProductionChronicleQaOwner } from "./chronicleValidationProduction";
import { ChronicleValidationBar } from "./ChronicleValidationBar";
import { computeChromeInsets } from "./chromeInsets";
// `domZoomDriver`'s exports are deliberately no longer imported: the guided tour no longer
// drives zoom (see the `zoom`-port comment in the controller wiring below).
import { deriveGuidedTourBeats } from "./guidedTour/guidedTourBeats";
import {
  browserGuidedTourScheduler,
  createGuidedTourController,
  type GuidedTourController,
  type GuidedTourSnapshot,
} from "./guidedTour/guidedTourController";
import { GuidedTourOverlay } from "./guidedTour/GuidedTourOverlay";

import "./guidedTour/GuidedTour.css";

/** Extra breathing room, in CSS px, added beyond a chrome element's own measured edge. */
const INSET_GAP_PX = 10;

export interface ChronicleValidationAppProps {
  readonly owner: ProductionChronicleQaOwner;
  readonly copyText?: (value: string) => Promise<void>;
  readonly readViewport?: () => Readonly<{ width: number; height: number }>;
  readonly WorldApp?: ComponentType<{
    readonly createRuntime: () => ProductionChronicleQaOwner["observerRuntime"];
    readonly renderer?: Vivarium2DAppProps["renderer"];
  }>;
}

const IDLE_GUIDED_TOUR_SNAPSHOT: GuidedTourSnapshot = Object.freeze({
  active: false,
  playing: false,
  beatIndex: 0,
  beat: null,
  done: false,
  framingFits: true,
});

/** Composes the exact production observer with route-local validation controls. */
export function ChronicleValidationApp({
  owner,
  copyText,
  readViewport,
  WorldApp = Vivarium2DApp,
}: ChronicleValidationAppProps): ReactElement {
  const binding = useSyncExternalStore(
    owner.subscribeObserverBinding,
    owner.getObserverBinding,
    owner.getObserverBinding,
  );
  const borrowedRuntime = useMemo(
    () => binding === null ? null : borrowObserverRuntime(binding.observerRuntime),
    [binding],
  );
  const createRuntime = useMemo(
    () => borrowedRuntime === null ? null : () => borrowedRuntime,
    [borrowedRuntime],
  );

  const routeRef = useRef<HTMLDivElement>(null);
  const guidedTourControllerRef = useRef<GuidedTourController | null>(null);
  const [guidedTourEnabled, setGuidedTourEnabled] = useState(false);
  const [guidedTourSnapshot, setGuidedTourSnapshot] = useState<GuidedTourSnapshot>(
    IDLE_GUIDED_TOUR_SNAPSHOT,
  );

  // Own one guided-tour controller per enabled session. QA-only: this drives the
  // exact same ChroniclePlayback + ObserverShellRuntime camera surface production
  // code already exposes, it does not reach into renderer/canvas internals.
  //
  // Turning the tour on always restarts the active chronicle to a fresh cursor-0
  // generation first: the default route auto-plays on load/select, so by the time a
  // reviewer flips this toggle the underlying stream may already be anywhere up to
  // fully delivered, and `ChroniclePlayback.deliverThroughCursor` is a forward-only
  // ratchet that cannot rewind. A guided tour promises the whole story from the
  // beginning, so it earns that promise itself rather than depending on when it was
  // switched on.
  useEffect(() => {
    if (!guidedTourEnabled) {
      setGuidedTourSnapshot(IDLE_GUIDED_TOUR_SNAPSHOT);
      return undefined;
    }
    let cancelled = false;
    let controller: GuidedTourController | null = null;
    let unsubscribe: (() => void) | null = null;
    let pausedOuterAutoplay = false;
    void (async () => {
      await owner.validationRuntime.restart();
      if (cancelled) return;
      // `ChronicleValidationRuntime` keeps its own coarse batched auto-play running
      // after `restart()` (built so a reviewer can jump straight to any review
      // marker, not to hold a paced per-beat story) — it independently keeps
      // calling `deliverThroughCursor` on a real-time schedule, racing ahead of (and
      // never yielding to) this controller's own per-beat pacing below. Left
      // running, every chronicle used by this route delivers its entire event
      // stream within its first ~1-second tick, so by the time this guided tour
      // reaches beat 2 the world has *already* silently jumped to its fully
      // delivered end state regardless of which beat is captioned — turning the
      // tour into exactly the "camera+caption move across an already-finished
      // world" bug this exists to prevent (see the guided-tour report's "Review
      // fixes" section for the live HUD evidence). Pausing it here hands this
      // controller *exclusive* control of delivery pacing for as long as the tour
      // is active; `resume()` on cleanup hands it back for the plain
      // Play/Pause-Chronicle flow.
      owner.validationRuntime.pause();
      pausedOuterAutoplay = true;
      const playback = owner.validationRuntime.getActivePlayback();
      if (playback === null) {
        setGuidedTourEnabled(false);
        return;
      }
      const chronicleId = owner.validationRuntime.getSnapshot().chronicle.id;
      const beats = deriveGuidedTourBeats(getChronicleManifest(chronicleId));
      controller = createGuidedTourController({
        beats,
        camera: owner.observerRuntime,
        playback: {
          deliverThroughCursor: (cursor) => playback.deliverThroughCursor(cursor),
          resume: () => playback.resume(),
          pause: () => playback.pause(),
          getPresentedCursor: () => playback.getSnapshot().presentedCursor,
          subscribe: (listener) => playback.subscribe(listener),
        },
        scheduler: browserGuidedTourScheduler,
        // NO `zoom` PORT, deliberately. The tour used to fit a beat's participants itself, by
        // firing synthetic "-"x10/"+"xN keydowns at the production canvas (`domZoomDriver`).
        // Two things were wrong with that, both measured live against C19:
        //
        // 1. Its "reset to MIN_ZOOM first" baseline was false. While a region sheet is active
        //    the camera's zoom FLOOR is the sheet-derived `minZoom` (~0.29 for the five-region
        //    sheet, vs. the assumed 0.5), so ten "-" presses bottomed out on the whole-atlas
        //    view and the following "+" presses were computed from the wrong baseline. That is
        //    the "reverts to world-sheet zoom by beat ~11" the approach-movement report saw:
        //    the tour was doing it to itself, every beat.
        // 2. Synthetic keydowns are indistinguishable from a reviewer's, so they took viewer
        //    framing authority away from the reviewer once per beat.
        //
        // Framing now belongs to the production beat director (`CanvasPresentationRenderer`'s
        // `frameBeat`), which fits the whole cast on the overlay's own clock and yields to the
        // viewer. The tour keeps pacing, region observation and cursor delivery -- its actual
        // job -- and `framingFits` falls back to its `true` default. `domZoomDriver` is left in
        // place, unused by this wiring, as the tested record of that approach.
        motion: { setReducedMotionOverride: (active) => owner.setReducedMotionOverride(active) },
      });
      guidedTourControllerRef.current = controller;
      const activeController = controller;
      unsubscribe = activeController.subscribe(() => setGuidedTourSnapshot(activeController.getSnapshot()));
      activeController.start();
      setGuidedTourSnapshot(activeController.getSnapshot());
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      controller?.dispose();
      if (guidedTourControllerRef.current === controller) guidedTourControllerRef.current = null;
      if (pausedOuterAutoplay) owner.validationRuntime.resume();
    };
  }, [guidedTourEnabled, owner]);

  // Docks the QA chrome (guided-tour toggle + overlay, validation bar) outside the
  // production world app's box instead of overlaying it — see
  // chronicleValidation.css's `.chronicle-validation-route .vivarium-2d-app`
  // override, which reads these two CSS custom properties. Measured, not
  // hardcoded: the guided-tour overlay only exists while a tour is active, and
  // its own height varies with caption length and the framing note (see
  // `fitToBounds.ts`'s `fits: false` case) — a fixed pixel budget would either
  // waste space most of the time or clip on a long caption.
  useEffect(() => {
    const route = routeRef.current;
    if (route === null) return undefined;

    const measure = (): void => {
      const toggle = route.querySelector<HTMLElement>(".guided-tour-toggle");
      const overlay = route.querySelector<HTMLElement>(".guided-tour-overlay");
      const bar = route.querySelector<HTMLElement>(".chronicle-validation-bar");
      const { topInsetPx, bottomInsetPx } = computeChromeInsets({
        toggleBottom: toggle?.getBoundingClientRect().bottom ?? 0,
        overlayBottom: overlay === null ? null : overlay.getBoundingClientRect().bottom,
        barTop: bar === null ? null : bar.getBoundingClientRect().top,
        viewportHeight: window.innerHeight,
        gapPx: INSET_GAP_PX,
      });
      route.style.setProperty("--qa-top-inset", `${topInsetPx}px`);
      route.style.setProperty("--qa-bottom-inset", `${bottomInsetPx}px`);
    };

    measure();
    window.addEventListener("resize", measure);
    // Matches the guard Vivarium2DApp.tsx already uses for its own layout
    // measurement effect: ResizeObserver isn't implemented in the jsdom test
    // environment (or older browsers) — degrade to the window-resize listener
    // (and the just-ran initial `measure()`) rather than throwing.
    if (typeof ResizeObserver !== "function") {
      return () => window.removeEventListener("resize", measure);
    }
    const resizeObserver = new ResizeObserver(measure);
    for (const selector of [".guided-tour-toggle", ".guided-tour-overlay", ".chronicle-validation-bar"]) {
      const element = route.querySelector<HTMLElement>(selector);
      if (element !== null) resizeObserver.observe(element);
    }
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [guidedTourSnapshot]);

  // Space = pause/resume, arrows = step. Captured at the window so it wins over the
  // production canvas's own arrow-key pan handler (PresentationWorldStage.tsx).
  useEffect(() => {
    if (!guidedTourEnabled) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const controller = guidedTourControllerRef.current;
      if (controller === null) return;
      if (event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        const { playing, done } = controller.getSnapshot();
        if (playing) controller.pause();
        else if (!done) controller.resume();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        controller.next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        controller.prev();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [guidedTourEnabled]);

  return (
    <div ref={routeRef} className="chronicle-validation-route">
      {binding === null || createRuntime === null ? null : (
        <WorldApp
          key={`chronicle-generation-${binding.generation}`}
          createRuntime={createRuntime}
          {...(owner.rendererAtlasPool === undefined
            && owner.rendererAtlasCommitScheduler === undefined
            ? {}
            : {
                renderer: {
                  ...(owner.rendererAtlasPool === undefined
                    ? {}
                    : { atlasPool: owner.rendererAtlasPool }),
                  ...(owner.rendererAtlasCommitScheduler === undefined
                    ? {}
                    : { atlasCommitScheduler: owner.rendererAtlasCommitScheduler }),
                },
              })}
        />
      )}
      <label className="guided-tour-toggle">
        <input
          type="checkbox"
          checked={guidedTourEnabled}
          onChange={(event) => setGuidedTourEnabled(event.currentTarget.checked)}
        />
        <span>Guided tour</span>
      </label>
      <GuidedTourOverlay snapshot={guidedTourSnapshot} />
      <ChronicleValidationBar
        runtime={owner.validationRuntime}
        {...(copyText === undefined ? {} : { copyText })}
        {...(readViewport === undefined ? {} : { readViewport })}
      />
    </div>
  );
}

function borrowObserverRuntime(raw: ObserverShellRuntime): ObserverShellRuntime {
  let disposed = false;
  const borrowed: ObserverShellRuntime = {
    ready: raw.ready,
    frameSource: raw.frameSource,
    frameAcceptance: raw.frameAcceptance,
    subscribe: (listener) => raw.subscribe(listener),
    getSnapshot: () => raw.getSnapshot(),
    diagnostics: () => raw.diagnostics(),
    select: (selection) => raw.select(selection),
    pause: () => raw.pause(),
    resume: (choice) => raw.resume(choice),
    setSpeed: (speed) => raw.setSpeed(speed),
    holdCurrentMoment: (hold) => raw.holdCurrentMoment(hold),
    viewMoment: (momentId) => raw.viewMoment(momentId),
    viewCursor: (cursor) => raw.viewCursor(cursor),
    replayCursor: (cursor) => raw.replayCursor(cursor),
    retryRecovery: () => raw.retryRecovery(),
    reconnectStream: () => raw.reconnectStream(),
    setCameraMode: (mode) => raw.setCameraMode(mode),
    requestFocus: (selection) => raw.requestFocus(selection),
    observeRegion: (regionId) => raw.observeRegion(regionId),
    openArchiveCatalogue: () => raw.openArchiveCatalogue(),
    loadOlderArchive: () => raw.loadOlderArchive(),
    enterArchiveCheckpoint: (key) => raw.enterArchiveCheckpoint(key),
    enterArchive: (window) => raw.enterArchive(window),
    returnToLive: () => raw.returnToLive(),
    dispose(): void {
      if (disposed) return;
      disposed = true;
    },
  };
  return Object.freeze(borrowed);
}
