import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { flushSync } from "react-dom";

import { LayeredHumanActor } from
  "../../renderer2d/production/actors/LayeredHumanActor";
import {
  acquireCharacterPilotBundle,
  CHARACTER_PILOT_AGENT_ID,
  CHARACTER_PILOT_APPEARANCE,
  type CharacterPilotBundle,
} from "./pilotManifest";
import {
  createCharacterPilotTimeline,
  type CharacterPilotTimeline,
  type PilotFrame,
  type PilotMilestone,
} from "./PilotTimeline";
import {
  presentPilotFrame,
  type PilotPresentation,
} from "./pilotPresentation";
import "./CharacterPilotStage.css";

export interface PilotFrameDriver {
  request(callback: FrameRequestCallback): number;
  cancel(handle: number): void;
  now(): number;
}

interface CharacterPilotBridge {
  seek(milestone: PilotMilestone): Promise<void>;
  restart(): Promise<void>;
  snapshot(): PilotFrame;
}

declare global {
  interface Window {
    __VIVARIUM_CHARACTER_PILOT__?: Readonly<CharacterPilotBridge>;
  }
}

interface CharacterPilotStageProps {
  readonly frameDriver?: PilotFrameDriver;
}

interface EffectOwner {
  active: boolean;
}

interface RuntimeGeneration {
  readonly owner: EffectOwner;
  readonly controller: AbortController;
  active: boolean;
  cleaned: boolean;
  bundle: CharacterPilotBundle | null;
  actor: LayeredHumanActor | null;
  timeline: CharacterPilotTimeline | null;
  frame: PilotFrame | null;
  bridge: Readonly<CharacterPilotBridge> | null;
  canvas: HTMLCanvasElement | null;
  contextLostListener: ((event: Event) => void) | null;
  rafHandle: number | null;
  previousTimestamp: number | null;
}

type RuntimeState = "loading" | "ready" | "failed";

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 288;
const PLAQUE_WIDTH = 244;
const PLAQUE_HEIGHT = 32;
const PLAQUE_X = (CANVAS_WIDTH - PLAQUE_WIDTH) / 2;
const PLAQUE_Y = 4;
const PLAQUE_TEXT_X = CANVAS_WIDTH / 2;
const PILOT_START = Object.freeze({ x: 226, y: 102 });
const FAILURE_COPY = "The character pilot could not be started.";
const BRIDGE_NAME = "__VIVARIUM_CHARACTER_PILOT__";
const INITIAL_PRESENTATION: PilotPresentation = Object.freeze({
  beatNumber: 1,
  action: "Standing idle",
  facing: "forward",
  primary: "1 / 6 · Standing idle",
  secondary: "Facing forward",
  accessible: "Beat 1 of 6. Standing idle. Facing forward.",
});
const GROUND_FLECKS = Object.freeze([
  [18, 22, 2, 1, "#9da65e"] as const,
  [76, 44, 1, 2, "#b0b871"] as const,
  [132, 26, 2, 2, "#9ca45d"] as const,
  [188, 70, 1, 1, "#b3ba73"] as const,
  [252, 34, 2, 1, "#98a15b"] as const,
  [316, 62, 1, 2, "#b1b96f"] as const,
  [382, 28, 2, 2, "#9ba35c"] as const,
  [454, 54, 1, 1, "#b4bb74"] as const,
  [46, 126, 1, 2, "#b3ba72"] as const,
  [108, 104, 2, 1, "#9ba45d"] as const,
  [164, 158, 1, 1, "#b1b970"] as const,
  [344, 136, 2, 1, "#9ca45d"] as const,
  [406, 112, 1, 2, "#b2b970"] as const,
  [480, 166, 2, 1, "#99a25b"] as const,
  [28, 232, 2, 2, "#99a25c"] as const,
  [96, 260, 1, 1, "#b2b970"] as const,
  [178, 222, 2, 1, "#9ca45d"] as const,
  [300, 250, 1, 2, "#b3ba72"] as const,
  [388, 224, 2, 1, "#99a25b"] as const,
  [468, 264, 1, 1, "#b2ba71"] as const,
]);

const DEFAULT_FRAME_DRIVER: PilotFrameDriver = Object.freeze({
  request(callback: FrameRequestCallback): number {
    return window.requestAnimationFrame(callback);
  },
  cancel(handle: number): void {
    window.cancelAnimationFrame(handle);
  },
  now(): number {
    return performance.now();
  },
});

const STALE_BRIDGE_ERROR = "The character pilot bridge is stale.";

function presentationKey(presentation: PilotPresentation): string {
  return [
    presentation.beatNumber,
    presentation.action,
    presentation.facing,
  ].join("|");
}

function paintStage(
  context: CanvasRenderingContext2D,
  actor: LayeredHumanActor,
  presentation: PilotPresentation,
): void {
  context.imageSmoothingEnabled = false;
  try {
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = "#a6ad63";
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    for (const [x, y, width, height, color] of GROUND_FLECKS) {
      context.fillStyle = color;
      context.fillRect(x, y, width, height);
    }
    context.fillStyle = "#8d8258";
    context.fillRect(242, 89, 20, 12);
    actor.draw(context);

    context.fillStyle = "#262329";
    context.fillRect(PLAQUE_X, PLAQUE_Y, PLAQUE_WIDTH, PLAQUE_HEIGHT);
    context.strokeStyle = "#78663e";
    context.lineWidth = 2;
    context.strokeRect(PLAQUE_X, PLAQUE_Y, PLAQUE_WIDTH, PLAQUE_HEIGHT);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "bold 9px monospace";
    context.fillStyle = "#f2e5bd";
    context.fillText(presentation.primary, PLAQUE_TEXT_X, 14);
    context.font = "8px monospace";
    context.fillStyle = "#c3a861";
    context.fillText(presentation.secondary, PLAQUE_TEXT_X, 27);
  } finally {
    context.imageSmoothingEnabled = false;
  }
}

function assertPilotFrame(frame: PilotFrame): void {
  if (frame.actor.artFallback !== null) {
    throw new Error("The character pilot rejected an art fallback.");
  }
}

function createGeneration(owner: EffectOwner): RuntimeGeneration {
  return {
    owner,
    controller: new AbortController(),
    active: true,
    cleaned: false,
    bundle: null,
    actor: null,
    timeline: null,
    frame: null,
    bridge: null,
    canvas: null,
    contextLostListener: null,
    rafHandle: null,
    previousTimestamp: null,
  };
}

/** Render the isolated, generation-owned six-beat character motion pilot. */
export function CharacterPilotStage({
  frameDriver = DEFAULT_FRAME_DRIVER,
}: CharacterPilotStageProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<EffectOwner | null>(null);
  const generationRef = useRef<RuntimeGeneration | null>(null);
  const latestFrameRef = useRef<PilotFrame | null>(null);
  const presentationKeyRef = useRef(presentationKey(INITIAL_PRESENTATION));
  const playingRef = useRef(true);
  const scheduleRef = useRef<(generation: RuntimeGeneration) => void>(() => {});
  const restartRef = useRef<(generation: RuntimeGeneration) => Promise<void>>(
    async () => {
      throw new Error(STALE_BRIDGE_ERROR);
    },
  );

  const [runtimeState, setRuntimeState] = useState<RuntimeState>("loading");
  const [playing, setPlaying] = useState(true);
  const [presentation, setPresentation] = useState<PilotPresentation>(
    INITIAL_PRESENTATION,
  );

  const isCurrent = useCallback((generation: RuntimeGeneration): boolean => (
    generation.active
    && generation.owner.active
    && generationRef.current === generation
  ), []);

  const cancelFrame = useCallback((generation: RuntimeGeneration): void => {
    if (generation.rafHandle !== null) {
      frameDriver.cancel(generation.rafHandle);
      generation.rafHandle = null;
    }
    generation.previousTimestamp = null;
  }, [frameDriver]);

  const cleanupGeneration = useCallback((generation: RuntimeGeneration): void => {
    if (generation.cleaned) return;
    generation.cleaned = true;
    generation.active = false;
    cancelFrame(generation);
    if (
      generation.canvas !== null
      && generation.contextLostListener !== null
    ) {
      generation.canvas.removeEventListener(
        "contextlost",
        generation.contextLostListener,
      );
      generation.contextLostListener = null;
      generation.canvas = null;
    }
    if (
      generation.bridge !== null
      && window.__VIVARIUM_CHARACTER_PILOT__ === generation.bridge
    ) {
      delete window.__VIVARIUM_CHARACTER_PILOT__;
    }
    generation.controller.abort();
    if (generation.timeline !== null) {
      generation.timeline.dispose();
    } else {
      generation.actor?.dispose();
    }
    generation.bundle?.release();
    if (generationRef.current === generation) generationRef.current = null;
  }, [cancelFrame]);

  const commitPresentation = useCallback((
    generation: RuntimeGeneration,
    frame: PilotFrame,
    next: PilotPresentation,
    synchronous: boolean,
  ): void => {
    if (!isCurrent(generation)) return;
    generation.frame = frame;
    latestFrameRef.current = frame;
    const nextKey = presentationKey(next);
    if (nextKey === presentationKeyRef.current) return;
    presentationKeyRef.current = nextKey;
    if (synchronous) {
      flushSync(() => setPresentation(next));
    } else {
      setPresentation(next);
    }
  }, [isCurrent]);

  const failGeneration = useCallback((
    generation: RuntimeGeneration,
    _error: unknown,
  ): void => {
    if (!isCurrent(generation)) return;
    cleanupGeneration(generation);
    playingRef.current = false;
    flushSync(() => {
      setPlaying(false);
      setRuntimeState("failed");
    });
  }, [cleanupGeneration, isCurrent]);

  const scheduleGeneration = useCallback((generation: RuntimeGeneration): void => {
    if (
      !isCurrent(generation)
      || !playingRef.current
      || generation.timeline === null
      || generation.actor === null
      || generation.rafHandle !== null
    ) {
      return;
    }
    const handle = frameDriver.request((timestamp) => {
      if (generation.rafHandle !== handle) return;
      generation.rafHandle = null;
      if (
        !isCurrent(generation)
        || !playingRef.current
        || generation.timeline === null
        || generation.actor === null
      ) {
        return;
      }
      try {
        const deltaSeconds = generation.previousTimestamp === null
          ? 0
          : Math.max(0, timestamp - generation.previousTimestamp) / 1_000;
        generation.previousTimestamp = timestamp;
        const frame = generation.timeline.advance(deltaSeconds, timestamp);
        assertPilotFrame(frame);
        const context = canvasRef.current?.getContext("2d");
        if (context === null || context === undefined) {
          throw new Error("The character pilot lost its 2D context.");
        }
        const next = presentPilotFrame(frame);
        paintStage(context, generation.actor, next);
        commitPresentation(generation, frame, next, false);
        scheduleRef.current(generation);
      } catch (error) {
        failGeneration(generation, error);
      }
    });
    generation.rafHandle = handle;
  }, [commitPresentation, failGeneration, frameDriver, isCurrent]);
  scheduleRef.current = scheduleGeneration;

  const launchGeneration = useCallback(async (
    owner: EffectOwner,
    shouldPlay: boolean,
  ): Promise<void> => {
    const generation = createGeneration(owner);
    generationRef.current = generation;
    let lateBundle: CharacterPilotBundle | null = null;
    try {
      lateBundle = await acquireCharacterPilotBundle(generation.controller.signal);
      if (!isCurrent(generation)) {
        lateBundle.release();
        lateBundle = null;
        throw new Error(STALE_BRIDGE_ERROR);
      }
      generation.bundle = lateBundle;
      lateBundle = null;

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (canvas === null || context === null || context === undefined) {
        throw new Error("The character pilot requires a 2D context.");
      }
      const actor = new LayeredHumanActor({
        id: CHARACTER_PILOT_AGENT_ID,
        name: "Pilot",
        position: PILOT_START,
        facing: "south",
        manifest: generation.bundle.manifest,
        atlasLeases: generation.bundle.leases,
        appearance: CHARACTER_PILOT_APPEARANCE,
        paletteMode: "authored",
      });
      generation.actor = actor;
      const timeline = createCharacterPilotTimeline(actor);
      generation.timeline = timeline;
      const frame = timeline.seek("front-idle");
      assertPilotFrame(frame);
      const next = presentPilotFrame(frame);
      paintStage(context, actor, next);
      commitPresentation(generation, frame, next, false);
      const contextLostListener = (event: Event): void => {
        if (!isCurrent(generation)) return;
        event.preventDefault();
        failGeneration(
          generation,
          new Error("The character pilot Canvas context was lost."),
        );
      };
      generation.canvas = canvas;
      generation.contextLostListener = contextLostListener;
      canvas.addEventListener("contextlost", contextLostListener);

      let bridge!: Readonly<CharacterPilotBridge>;
      const assertBridgeCurrent = (): void => {
        if (
          !isCurrent(generation)
          || generation.bridge !== bridge
          || window.__VIVARIUM_CHARACTER_PILOT__ !== bridge
        ) {
          throw new Error(STALE_BRIDGE_ERROR);
        }
      };
      bridge = Object.freeze({
        async seek(milestone: PilotMilestone): Promise<void> {
          assertBridgeCurrent();
          playingRef.current = false;
          cancelFrame(generation);
          try {
            const sought = generation.timeline!.seek(milestone);
            assertPilotFrame(sought);
            const soughtPresentation = presentPilotFrame(sought);
            paintStage(context, generation.actor!, soughtPresentation);
            if (!isCurrent(generation)) throw new Error(STALE_BRIDGE_ERROR);
            flushSync(() => setPlaying(false));
            commitPresentation(generation, sought, soughtPresentation, true);
          } catch (error) {
            failGeneration(generation, error);
            throw error;
          }
        },
        async restart(): Promise<void> {
          assertBridgeCurrent();
          await restartRef.current(generation);
        },
        snapshot(): PilotFrame {
          assertBridgeCurrent();
          const current = latestFrameRef.current;
          if (current === null || generation.frame !== current) {
            throw new Error(STALE_BRIDGE_ERROR);
          }
          return current;
        },
      });
      generation.bridge = bridge;
      Object.defineProperty(window, BRIDGE_NAME, {
        configurable: true,
        enumerable: false,
        writable: false,
        value: bridge,
      });
      playingRef.current = shouldPlay;
      flushSync(() => {
        setPlaying(shouldPlay);
        setRuntimeState("ready");
      });
      if (shouldPlay) scheduleRef.current(generation);
    } catch (error) {
      lateBundle?.release();
      if (isCurrent(generation)) failGeneration(generation, error);
      throw error;
    }
  }, [
    cancelFrame,
    commitPresentation,
    failGeneration,
    isCurrent,
  ]);

  const restartGeneration = useCallback(async (
    generation: RuntimeGeneration,
  ): Promise<void> => {
    if (!isCurrent(generation)) throw new Error(STALE_BRIDGE_ERROR);
    const { owner } = generation;
    const shouldPlay = playingRef.current;
    cleanupGeneration(generation);
    flushSync(() => setRuntimeState("loading"));
    await launchGeneration(owner, shouldPlay);
  }, [cleanupGeneration, isCurrent, launchGeneration]);
  restartRef.current = restartGeneration;

  useEffect(() => {
    const owner: EffectOwner = { active: true };
    ownerRef.current = owner;
    queueMicrotask(() => {
      if (!owner.active) return;
      void launchGeneration(owner, playingRef.current).catch(() => {});
    });
    return () => {
      owner.active = false;
      if (ownerRef.current === owner) ownerRef.current = null;
      const generation = generationRef.current;
      if (generation?.owner === owner) cleanupGeneration(generation);
    };
  }, [cleanupGeneration, launchGeneration]);

  useEffect(() => {
    if (runtimeState === "failed") alertRef.current?.focus();
  }, [runtimeState]);

  const togglePlaying = useCallback((): void => {
    if (runtimeState !== "ready") return;
    const generation = generationRef.current;
    if (generation === null || !isCurrent(generation)) return;
    if (playingRef.current) {
      playingRef.current = false;
      cancelFrame(generation);
      setPlaying(false);
      return;
    }
    playingRef.current = true;
    generation.previousTimestamp = null;
    setPlaying(true);
    scheduleRef.current(generation);
  }, [cancelFrame, isCurrent, runtimeState]);

  const restart = useCallback((): void => {
    if (runtimeState !== "ready") return;
    const generation = generationRef.current;
    if (generation === null) return;
    void restartRef.current(generation).catch(() => {});
  }, [runtimeState]);

  const controlsDisabled = runtimeState !== "ready";

  return (
    <div className="character-pilot">
      <section className="character-pilot__frame" aria-label="Character pilot stage">
        <canvas
          ref={canvasRef}
          className="character-pilot__canvas"
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          role="img"
          aria-label="Animated character movement pilot"
          aria-describedby="character-pilot-instructions character-pilot-status"
        />
      </section>
      <div className="character-pilot__controls" aria-label="Character pilot controls">
        <button
          type="button"
          disabled={controlsDisabled}
          onClick={togglePlaying}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" disabled={controlsDisabled} onClick={restart}>
          Restart
        </button>
        <span className="character-pilot__beat">
          {presentation.primary}
        </span>
      </div>
      <p id="character-pilot-instructions" className="character-pilot__visually-hidden">
        A six-beat character animation with playback and restart controls.
      </p>
      <p
        id="character-pilot-status"
        className="character-pilot__visually-hidden"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {presentation.accessible}
      </p>
      {runtimeState === "failed" ? (
        <div
          ref={alertRef}
          className="character-pilot__failure"
          role="alert"
          tabIndex={-1}
        >
          {FAILURE_COPY}
        </div>
      ) : null}
    </div>
  );
}
