import type { ChronicleManifest } from "../presentation/fixtures/chronicleCatalog";
import type { ChronicleId } from "../presentation/fixtures/chronicleCatalog";
import type { CompletedRecoveryReceipt } from "../presentation/PresentationSession";
import {
  createChronicleFailureToken,
  projectChronicleReviewManifest,
  type ChroniclePlaybackSpeed,
  type ChronicleReviewManifest,
} from "./chronicleValidationModel";

export interface ChroniclePlaybackSnapshot {
  readonly runId: string;
  readonly source: "live" | "archive";
  readonly sourceKey: string;
  readonly presentedCursor: number;
  readonly presentedTime: number;
}

export interface ChroniclePlayback {
  readonly ready: Promise<void>;
  start(): void;
  getSnapshot(): ChroniclePlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  deliverThroughCursor(cursor: number): void;
  deliverToMarker(marker: ChronicleReviewManifest["markers"][number]): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: ChroniclePlaybackSpeed): void;
  dispose(): void;
}

export interface ValidationScheduler {
  schedule(delayMs: number, callback: () => void): () => void;
}

export type ChronicleScenarioControlId =
  | "c14-gap-413"
  | "c14-overflow"
  | "c14-replace"
  | "c14-stale-reject"
  | "c15-prime-live-2"
  | "c15-enter-archive-2"
  | "c15-hidden-live-4"
  | "c15-return-live-4";

export interface ChronicleScenarioControl {
  readonly id: ChronicleScenarioControlId;
  readonly label: string;
  readonly enabled: boolean;
}

export interface ChronicleScenarioView {
  readonly kind: "C14" | "C15";
  readonly phase: string;
  readonly controls: readonly ChronicleScenarioControl[];
  readonly mechanicEnvelopeCount: 0;
  readonly lastCompletedRecovery: CompletedRecoveryReceipt | null;
}

export interface ChronicleValidationSnapshot {
  readonly chronicle: ChronicleReviewManifest;
  readonly generation: number;
  readonly status: "loading" | "ready" | "complete" | "error" | "disposed";
  readonly error: string | null;
  readonly playing: boolean;
  readonly speed: ChroniclePlaybackSpeed;
  readonly presentedCursor: number;
  readonly presentedTime: number;
  readonly markerIndex: number;
  readonly marker: ChronicleReviewManifest["markers"][number] | null;
  readonly scenario: ChronicleScenarioView | null;
}

export interface ChronicleValidationRuntime {
  readonly ready: Promise<void>;
  getSnapshot(): ChronicleValidationSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  selectChronicle(id: ChronicleId): Promise<void>;
  pause(): void;
  resume(): void;
  setSpeed(speed: ChroniclePlaybackSpeed): void;
  restart(): Promise<void>;
  previousMarker(): Promise<void>;
  nextMarker(): Promise<void>;
  runScenarioPhase(id: ChronicleScenarioControlId): Promise<void>;
  copyFailureToken(viewport: Readonly<{ width: number; height: number }>): string;
  /**
   * Returns the currently installed generation's raw `ChroniclePlayback`, or `null`
   * before the first generation commits / after disposal. Exists so QA-only tooling
   * (the guided tour) can drive precise per-cursor delivery + resume/pause directly,
   * bypassing this runtime's own coarse batched auto-play scheduling.
   */
  getActivePlayback(): ChroniclePlayback | null;
  dispose(): void;
}

export interface ChronicleScenarioDriver {
  getView(): ChronicleScenarioView;
  run(id: ChronicleScenarioControlId): Promise<void>;
  dispose(): void;
}

export interface ChronicleValidationRuntimeOptions {
  readonly initialChronicleId: ChronicleId;
  getManifest(id: ChronicleId): ChronicleManifest;
  createPlayback(input: Readonly<{
    manifest: ChronicleManifest;
    generation: number;
  }>): ChroniclePlayback;
  readonly scheduler: ValidationScheduler;
  createScenario?(manifest: ChronicleManifest): ChronicleScenarioDriver | null;
  readonly generationLifecycle?: ChronicleValidationGenerationLifecycle;
}

export interface ChronicleValidationGenerationLifecycle {
  committed(input: Readonly<{
    manifest: ChronicleManifest;
    generation: number;
    playback: ChroniclePlayback;
  }>): void;
  failed(input: Readonly<{
    manifest: ChronicleManifest;
    generation: number;
    error: unknown;
  }>): void;
}

const SPEEDS = new Set<number>([0.5, 1, 1.5, 2]);
const DELIVERY_BATCH_SIZE = 256;

/** Owns generation-safe Chronicle playback and the external-store QA state. */
export function createChronicleValidationRuntime(
  options: ChronicleValidationRuntimeOptions,
): ChronicleValidationRuntime {
  const listeners = new Set<() => void>();
  let disposed = false;
  let generation = 0;
  let active: Readonly<{
    generation: number;
    manifest: ChronicleManifest;
    playback: ChroniclePlayback;
    unsubscribe: () => void;
    scenario: ChronicleScenarioDriver | null;
  }> | null = null;
  let cancelScheduled: (() => void) | null = null;
  let snapshot!: ChronicleValidationSnapshot;
  let initialReady: Promise<void> = Promise.resolve();

  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const publishPlayback = (candidate: NonNullable<typeof active>): void => {
    if (disposed || active !== candidate || candidate.generation !== generation) return;
    const frame = candidate.playback.getSnapshot();
    snapshot = Object.freeze({
      ...snapshot,
      presentedCursor: frame.presentedCursor,
      presentedTime: frame.presentedTime,
      scenario: candidate.scenario?.getView() ?? null,
    });
    emit();
  };

  const stopSchedule = (): void => {
    cancelScheduled?.();
    cancelScheduled = null;
  };

  const scheduleNext = (candidate: NonNullable<typeof active>): void => {
    stopSchedule();
    if (disposed || active !== candidate || !snapshot.playing) return;
    const terminal = candidate.manifest.expectedFinalCursor;
    if (snapshot.presentedCursor >= terminal) {
      candidate.playback.pause();
      snapshot = Object.freeze({ ...snapshot, status: "complete", playing: false });
      emit();
      return;
    }
    cancelScheduled = options.scheduler.schedule(1_000 / snapshot.speed, () => {
      cancelScheduled = null;
      if (disposed || active !== candidate || !snapshot.playing) return;
      const target = Math.min(
        terminal,
        candidate.playback.getSnapshot().presentedCursor + DELIVERY_BATCH_SIZE,
      );
      candidate.playback.deliverThroughCursor(target);
      publishPlayback(candidate);
      if (target >= terminal) {
        candidate.playback.pause();
        snapshot = Object.freeze({ ...snapshot, status: "complete", playing: false });
        emit();
      } else {
        scheduleNext(candidate);
      }
    });
  };

  const releaseActive = (): void => {
    const cleanupErrors: unknown[] = [];
    try {
      stopSchedule();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const current = active;
    active = null;
    if (current !== null) {
      for (const cleanup of [
        current.unsubscribe,
        () => current.scenario?.dispose(),
        () => current.playback.dispose(),
      ]) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
    }
    if (cleanupErrors.length > 0) throw cleanupFailure(cleanupErrors, "Chronicle release failed");
  };

  const install = (id: ChronicleId): NonNullable<typeof active> => {
    const manifest = options.getManifest(id);
    const chronicle = projectChronicleReviewManifest(manifest);
    const attemptedGeneration = generation + 1;
    const priorSpeed = snapshot?.speed ?? 1;
    const fail = (primary: unknown, cleanupErrors: readonly unknown[] = []): never => {
      active = null;
      generation = attemptedGeneration;
      const failureErrors = [...cleanupErrors];
      try {
        options.generationLifecycle?.failed({
          manifest,
          generation: attemptedGeneration,
          error: primary,
        });
      } catch (error) {
        failureErrors.push(error);
      }
      if (snapshot !== undefined) {
        snapshot = Object.freeze({
          chronicle,
          generation: attemptedGeneration,
          status: "error",
          error: errorMessage(primary),
          playing: false,
          speed: priorSpeed,
          presentedCursor: manifest.initialSnapshot.event_cursor,
          presentedTime: manifest.initialSnapshot.world_time,
          markerIndex: -1,
          marker: null,
          scenario: null,
        });
        emit();
      }
      throw withCleanupErrors(primary, failureErrors, "Chronicle generation install failed");
    };

    try {
      releaseActive();
    } catch (error) {
      return fail(error);
    }

    generation = attemptedGeneration;
    const rollback: Array<() => void> = [];
    try {
      const playback = options.createPlayback({ manifest, generation: attemptedGeneration });
      rollback.push(() => playback.dispose());
      const scenario = options.createScenario?.(manifest) ?? null;
      if (scenario !== null) rollback.push(() => scenario.dispose());
      const candidate: {
        generation: number;
        manifest: ChronicleManifest;
        playback: ChroniclePlayback;
        unsubscribe: () => void;
        scenario: ChronicleScenarioDriver | null;
      } = {
        generation: attemptedGeneration,
        manifest,
        playback,
        unsubscribe: () => undefined,
        scenario,
      };
      const unsubscribe = playback.subscribe(() => publishPlayback(candidate));
      candidate.unsubscribe = unsubscribe;
      rollback.push(unsubscribe);
      const initial = playback.getSnapshot();
      const nextSnapshot: ChronicleValidationSnapshot = Object.freeze({
        chronicle,
        generation: attemptedGeneration,
        status: "loading",
        error: null,
        playing: false,
        speed: priorSpeed,
        presentedCursor: initial.presentedCursor,
        presentedTime: initial.presentedTime,
        markerIndex: -1,
        marker: null,
        scenario: scenario?.getView() ?? null,
      });
      active = candidate;
      snapshot = nextSnapshot;
      options.generationLifecycle?.committed({
        manifest,
        generation: attemptedGeneration,
        playback,
      });
      rollback.length = 0;
      emit();
      return candidate;
    } catch (primary) {
      active = null;
      const cleanupErrors: unknown[] = [];
      for (const cleanup of rollback.reverse()) {
        try {
          cleanup();
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      return fail(primary, cleanupErrors);
    }
  };

  const activate = async (candidate: NonNullable<typeof active>): Promise<void> => {
    try {
      await candidate.playback.ready;
    } catch (error) {
      if (!disposed && active === candidate) {
        snapshot = Object.freeze({
          ...snapshot,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          playing: false,
        });
        emit();
      }
      return;
    }
    if (disposed || active !== candidate || candidate.generation !== generation) return;
    candidate.playback.start();
    if (snapshot.speed !== 1) candidate.playback.setSpeed(snapshot.speed);
    candidate.playback.resume();
    snapshot = Object.freeze({
      ...snapshot,
      status: candidate.manifest.expectedFinalCursor === 0 ? "complete" : "ready",
      error: null,
      playing: candidate.manifest.expectedFinalCursor > 0,
    });
    emit();
    if (snapshot.playing) scheduleNext(candidate);
  };

  const seekMarker = async (index: number): Promise<void> => {
    const current = active;
    if (disposed || current === null) return;
    const marker = snapshot.chronicle.markers[index];
    if (marker === undefined || index === snapshot.markerIndex) return;
    let candidate = current;
    if (marker.cursor < snapshot.presentedCursor) {
      candidate = install(snapshot.chronicle.id);
      await candidate.playback.ready;
      if (disposed || active !== candidate) return;
      candidate.playback.start();
      if (snapshot.speed !== 1) candidate.playback.setSpeed(snapshot.speed);
    }
    stopSchedule();
    candidate.playback.resume();
    candidate.playback.deliverToMarker(marker);
    candidate.playback.pause();
    snapshot = Object.freeze({
      ...snapshot,
      status: marker.cursor >= candidate.manifest.expectedFinalCursor ? "complete" : "ready",
      error: null,
      playing: false,
      presentedCursor: marker.cursor,
      presentedTime: marker.presentedTime,
      markerIndex: index,
      marker,
      scenario: candidate.scenario?.getView() ?? null,
    });
    emit();
  };

  const first = install(options.initialChronicleId);
  let startPromise: Promise<void> | null = null;

  const runtime: ChronicleValidationRuntime = {
    get ready(): Promise<void> { return initialReady; },
    getSnapshot: () => snapshot,
    subscribe(listener): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start(): Promise<void> {
      if (startPromise !== null) return startPromise;
      startPromise = activate(first);
      initialReady = startPromise;
      return startPromise;
    },
    async selectChronicle(id): Promise<void> {
      if (disposed) return;
      const candidate = install(id);
      await activate(candidate);
    },
    pause(): void {
      if (disposed || active === null || !snapshot.playing) return;
      stopSchedule();
      active.playback.pause();
      snapshot = Object.freeze({ ...snapshot, playing: false });
      emit();
    },
    resume(): void {
      if (
        disposed
        || active === null
        || snapshot.playing
        || snapshot.status === "loading"
        || snapshot.status === "error"
        || snapshot.status === "complete"
      ) return;
      active.playback.resume();
      snapshot = Object.freeze({ ...snapshot, playing: true });
      emit();
      scheduleNext(active);
    },
    setSpeed(speed): void {
      if (!SPEEDS.has(speed)) throw new RangeError("Unsupported Chronicle playback speed");
      if (disposed || active === null || speed === snapshot.speed) return;
      active.playback.setSpeed(speed);
      snapshot = Object.freeze({ ...snapshot, speed });
      emit();
      if (snapshot.playing) scheduleNext(active);
    },
    async restart(): Promise<void> {
      if (disposed) return;
      const candidate = install(snapshot.chronicle.id);
      await activate(candidate);
    },
    previousMarker(): Promise<void> {
      return seekMarker(Math.max(0, snapshot.markerIndex - 1));
    },
    nextMarker(): Promise<void> {
      return seekMarker(Math.min(
        snapshot.chronicle.markers.length - 1,
        snapshot.markerIndex + 1,
      ));
    },
    async runScenarioPhase(id): Promise<void> {
      if (disposed || active?.scenario === null || active?.scenario === undefined) return;
      await active.scenario.run(id);
      snapshot = Object.freeze({ ...snapshot, scenario: active.scenario.getView() });
      emit();
    },
    getActivePlayback(): ChroniclePlayback | null {
      return disposed || active === null ? null : active.playback;
    },
    copyFailureToken(viewport): string {
      return createChronicleFailureToken({
        chronicleId: snapshot.chronicle.id,
        cursor: snapshot.presentedCursor,
        presentedTime: snapshot.presentedTime,
        speed: snapshot.speed,
        viewport,
      });
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      let failure: unknown = null;
      try {
        releaseActive();
      } catch (error) {
        failure = error;
      } finally {
        snapshot = Object.freeze({ ...snapshot, status: "disposed", playing: false });
        emit();
        listeners.clear();
      }
      if (failure !== null) throw failure;
    },
  };
  return runtime;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cleanupFailure(errors: readonly unknown[], message: string): unknown {
  if (errors.length === 1) return errors[0];
  return new AggregateError(errors, message, { cause: errors[0] });
}

function withCleanupErrors(
  primary: unknown,
  cleanupErrors: readonly unknown[],
  message: string,
): unknown {
  if (cleanupErrors.length === 0) return primary;
  return new AggregateError([primary, ...cleanupErrors], message, { cause: primary });
}

/** Browser scheduler for human-paced fixture delivery. */
export const browserValidationScheduler: ValidationScheduler = Object.freeze({
  schedule(delayMs: number, callback: () => void): () => void {
    const handle = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(handle);
  },
});
