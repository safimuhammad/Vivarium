import {
  createManualPresentationClock,
  type ManualPresentationClock,
} from "../../presentation/fixtures/ManualPresentationClock";
import type { PresentationClock } from "../../presentation/storyClock";
import type { FrameDriver, WakeScheduler } from "../../renderer2d/contracts";
import type { AtlasCommitScheduler } from "../../renderer2d/production/AtlasCommitScheduler";
import type { RunMetadata, WorldSnapshot } from "../schemas";
import {
  createCheckpointFeed,
  type CheckpointFeed,
  type CheckpointFeedScheduler,
} from "../../presentation/CheckpointFeed";
import {
  extractProductionDialogueNowWitness,
  type ReadingHoldWitness,
} from "../../capture/readingHoldDuration";

declare global {
  interface Window {
    __vivariumEnableProductionCaptureClockForTest?: boolean;
    __vivariumProductionCaptureClockForTest?: ProductionCaptureClockControl;
    __vivariumProductionCaptureTerminalForTest?: Readonly<{
      rendererCreations: number;
      rendererDisposals: readonly ProductionCaptureRendererDisposal[];
    }>;
    __vivariumProductionCaptureUnmountForTest?: () => void;
    __vivariumProductionMountedRunForTest?: ProductionMountedRunControl;
    __vivariumProductionDialogueNowWitnessForTest?: () => ReadingHoldWitness | null;
  }
}

export interface ProductionCaptureClockControl {
  now(): number;
  advanceTo(presentationTimeMs: number): void;
  advanceRendererTo(presentationTimeMs: number): void;
  pendingCount(): number;
  rendererDisposals(): readonly ProductionCaptureRendererDisposal[];
}

export interface ProductionCaptureRendererDisposal {
  readonly before: unknown;
  readonly after: unknown;
}

export interface ProductionCaptureTimelineBinding {
  readonly clockFactory: () => PresentationClock;
  readonly checkpointFeedFactory: () => CheckpointFeed;
  createRendererTiming(): ProductionCaptureRendererTiming;
  recordRendererDisposal(before: unknown, after: unknown): void;
  dispose(): void;
}

export interface ProductionCaptureRendererTiming {
  readonly frameDriver: FrameDriver;
  readonly wakeScheduler: WakeScheduler;
  readonly atlasCommitScheduler: AtlasCommitScheduler;
}

export interface ProductionMountedRunControl {
  replaceMountedRunForTest(run: RunMetadata, snapshot: WorldSnapshot): void;
}

export interface ProductionMountedRunRegistration {
  release(): void;
}

interface ManualFrameDriver extends FrameDriver {
  advanceTo(presentationTimeMs: number): void;
  pendingCount(): number;
  dispose(): void;
}

interface ManualWakeScheduler extends WakeScheduler {
  advanceTo(presentationTimeMs: number): void;
  pendingCount(): number;
  dispose(): void;
}

let activeTimeline: Readonly<{
  createRendererTiming(): ProductionCaptureRendererTiming;
  recordRendererDisposal(before: unknown, after: unknown): void;
}> | null = null;
let activeMountedRunRegistration: Readonly<{
  token: object;
  control: ProductionMountedRunControl;
}> | null = null;

/** Registers one generation-owned mounted replacement callback for opted-in capture only. */
export function registerProductionMountedRunReplacementForTest(
  replaceRun: (run: RunMetadata, snapshot: WorldSnapshot) => void,
): ProductionMountedRunRegistration | undefined {
  if (
    typeof window === "undefined"
    || window.__vivariumEnableProductionCaptureClockForTest !== true
  ) {
    if (typeof window !== "undefined" && activeMountedRunRegistration === null) {
      delete window.__vivariumProductionMountedRunForTest;
    }
    return undefined;
  }
  const token = Object.freeze({});
  const control: ProductionMountedRunControl = Object.freeze({
    replaceMountedRunForTest(run: RunMetadata, snapshot: WorldSnapshot): void {
      if (activeMountedRunRegistration?.token !== token) return;
      replaceRun(run, snapshot);
    },
  });
  activeMountedRunRegistration = Object.freeze({ token, control });
  window.__vivariumProductionMountedRunForTest = control;
  let released = false;
  return Object.freeze({
    release(): void {
      if (released) return;
      released = true;
      if (activeMountedRunRegistration?.token !== token) return;
      activeMountedRunRegistration = null;
      if (window.__vivariumProductionMountedRunForTest === control) {
        delete window.__vivariumProductionMountedRunForTest;
      }
    },
  });
}

/**
 * Creates the opt-in deterministic clock factory used only by production capture tests.
 *
 * The ordinary production route publishes no control surface and continues to use the
 * browser clock. A pre-document flag is required before the observer runtime is created.
 */
export function createProductionCaptureClockFactoryForTest():
  ProductionCaptureTimelineBinding | undefined {
  if (
    typeof window === "undefined"
    || window.__vivariumEnableProductionCaptureClockForTest !== true
  ) {
    if (typeof window !== "undefined") {
      delete window.__vivariumProductionCaptureClockForTest;
      delete window.__vivariumProductionDialogueNowWitnessForTest;
    }
    return undefined;
  }

  const clocks: ManualPresentationClock[] = [];
  const frameDrivers: ManualFrameDriver[] = [];
  const rendererWakeSchedulers: ManualWakeScheduler[] = [];
  const checkpointWakeSchedulers: ManualWakeScheduler[] = [];
  const rendererDisposals: ProductionCaptureRendererDisposal[] = [];
  let rendererCreations = 0;
  let timelineNowMs = 0;
  let disposed = false;
  const timeline = Object.freeze({
    createRendererTiming(): ProductionCaptureRendererTiming {
      rendererCreations += 1;
      const frameDriver = createManualFrameDriver(timelineNowMs);
      const wakeScheduler = createManualWakeScheduler(timelineNowMs);
      const atlasCommitScheduler: AtlasCommitScheduler = Object.freeze({
        schedule: (callback: () => void) => wakeScheduler.schedule(wakeScheduler.now(), callback),
        cancel: (handle: number) => wakeScheduler.cancel(handle),
      });
      if (disposed) {
        frameDriver.dispose();
        wakeScheduler.dispose();
      } else {
        frameDrivers.push(frameDriver);
        rendererWakeSchedulers.push(wakeScheduler);
      }
      return Object.freeze({ frameDriver, wakeScheduler, atlasCommitScheduler });
    },
    recordRendererDisposal(before: unknown, after: unknown): void {
      rendererDisposals.push(Object.freeze({ before, after }));
      window.__vivariumProductionCaptureTerminalForTest = Object.freeze({
        rendererCreations,
        rendererDisposals: Object.freeze([...rendererDisposals]),
      });
    },
  });
  activeTimeline = timeline;
  const drainRendererTiming = (presentationTimeMs: number): void => {
    for (const scheduler of rendererWakeSchedulers) {
      scheduler.advanceTo(Math.max(presentationTimeMs, scheduler.now()));
    }
    for (const driver of frameDrivers) {
      driver.advanceTo(Math.max(presentationTimeMs, driver.now()));
    }
  };
  const control: ProductionCaptureClockControl = Object.freeze({
    now(): number {
      return timelineNowMs;
    },
    advanceTo(presentationTimeMs: number): void {
      if (!Number.isFinite(presentationTimeMs) || presentationTimeMs < 0) {
        throw new RangeError("capture presentationTimeMs must be non-negative and finite");
      }
      if (disposed) return;
      if (presentationTimeMs < timelineNowMs) {
        throw new RangeError("capture presentation clock cannot move backwards");
      }
      drainRendererTiming(timelineNowMs);
      timelineNowMs = presentationTimeMs;
      for (const clock of clocks) clock.advanceTo(presentationTimeMs);
      for (const scheduler of checkpointWakeSchedulers) scheduler.advanceTo(presentationTimeMs);
      drainRendererTiming(presentationTimeMs);
    },
    advanceRendererTo(presentationTimeMs: number): void {
      if (!Number.isFinite(presentationTimeMs) || presentationTimeMs < 0) {
        throw new RangeError("capture renderer presentationTimeMs must be non-negative and finite");
      }
      if (disposed) return;
      if (presentationTimeMs < timelineNowMs) {
        throw new RangeError("capture renderer clock cannot move behind the presentation timeline");
      }
      drainRendererTiming(presentationTimeMs);
    },
    pendingCount(): number {
      if (disposed) return 0;
      return clocks.reduce((count, clock) => count + clock.pendingCount(), 0)
        + frameDrivers.reduce((count, driver) => count + driver.pendingCount(), 0)
        + rendererWakeSchedulers.reduce((count, scheduler) => count + scheduler.pendingCount(), 0)
        + checkpointWakeSchedulers.reduce((count, scheduler) => count + scheduler.pendingCount(), 0);
    },
    rendererDisposals(): readonly ProductionCaptureRendererDisposal[] {
      return Object.freeze([...rendererDisposals]);
    },
  });
  window.__vivariumProductionCaptureClockForTest = control;
  const readDialogueNowWitness = (): ReadingHoldWitness | null => (
    extractProductionDialogueNowWitness(document)
  );
  window.__vivariumProductionDialogueNowWitnessForTest = readDialogueNowWitness;

  return Object.freeze({
    clockFactory(): PresentationClock {
      const clock = createManualPresentationClock({ initialNowMs: timelineNowMs });
      if (disposed) clock.dispose();
      else clocks.push(clock);
      return clock;
    },
    checkpointFeedFactory(): CheckpointFeed {
      const wakeScheduler = createManualWakeScheduler(timelineNowMs);
      if (disposed) wakeScheduler.dispose();
      else checkpointWakeSchedulers.push(wakeScheduler);
      const scheduler: CheckpointFeedScheduler = {
        schedule(delayMs, callback) {
          const handle = wakeScheduler.schedule(wakeScheduler.now() + delayMs, () => {
            void callback();
          });
          return Object.freeze({ cancel: () => wakeScheduler.cancel(handle) });
        },
      };
      return createCheckpointFeed({ scheduler });
    },
    createRendererTiming(): ProductionCaptureRendererTiming {
      return timeline.createRendererTiming();
    },
    recordRendererDisposal(before: unknown, after: unknown): void {
      timeline.recordRendererDisposal(before, after);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const clock of clocks) clock.dispose();
      for (const driver of frameDrivers) driver.dispose();
      for (const scheduler of rendererWakeSchedulers) scheduler.dispose();
      for (const scheduler of checkpointWakeSchedulers) scheduler.dispose();
      clocks.length = 0;
      frameDrivers.length = 0;
      rendererWakeSchedulers.length = 0;
      checkpointWakeSchedulers.length = 0;
      if (activeTimeline === timeline) activeTimeline = null;
      if (window.__vivariumProductionCaptureClockForTest === control) {
        delete window.__vivariumProductionCaptureClockForTest;
      }
      if (window.__vivariumProductionDialogueNowWitnessForTest === readDialogueNowWitness) {
        delete window.__vivariumProductionDialogueNowWitnessForTest;
      }
      window.__vivariumProductionCaptureTerminalForTest = Object.freeze({
        rendererCreations,
        rendererDisposals: Object.freeze([...rendererDisposals]),
      });
    },
  });
}

/** Returns coordinated renderer timing only while the opt-in capture runtime is active. */
export function createProductionCaptureRendererTimingForTest():
  ProductionCaptureRendererTiming | undefined {
  return activeTimeline?.createRendererTiming();
}

/** Retains the production renderer's own before/after-dispose diagnostics for capture. */
export function recordProductionCaptureRendererDisposalForTest(
  before: unknown,
  after: unknown,
): void {
  activeTimeline?.recordRendererDisposal(before, after);
}

function createManualFrameDriver(initialNowMs: number): ManualFrameDriver {
  let nowMs = initialNowMs;
  let nextHandle = 1;
  let disposed = false;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    request(callback): number {
      if (disposed) return 0;
      const handle = nextHandle++;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle): void {
      callbacks.delete(handle);
    },
    now(): number {
      return nowMs;
    },
    advanceTo(presentationTimeMs): void {
      if (disposed) return;
      if (presentationTimeMs < nowMs) throw new RangeError("capture frame clock cannot move backwards");
      nowMs = presentationTimeMs;
      const due = [...callbacks.entries()];
      for (const [handle] of due) callbacks.delete(handle);
      for (const [, callback] of due) callback(nowMs);
    },
    pendingCount: () => callbacks.size,
    dispose(): void {
      disposed = true;
      callbacks.clear();
    },
  };
}

function createManualWakeScheduler(initialNowMs: number): ManualWakeScheduler {
  let nowMs = initialNowMs;
  let nextHandle = 1;
  let disposed = false;
  const callbacks = new Map<number, Readonly<{ atMs: number; callback: () => void }>>();
  return {
    schedule(atMs, callback): number {
      if (!Number.isFinite(atMs)) throw new RangeError("capture wake time must be finite");
      if (disposed) return 0;
      const handle = nextHandle++;
      callbacks.set(handle, Object.freeze({ atMs: Math.max(nowMs, atMs), callback }));
      return handle;
    },
    cancel(handle): void {
      callbacks.delete(handle);
    },
    now(): number {
      return nowMs;
    },
    advanceTo(presentationTimeMs): void {
      if (disposed) return;
      if (presentationTimeMs < nowMs) throw new RangeError("capture wake clock cannot move backwards");
      nowMs = presentationTimeMs;
      let executed = 0;
      while (true) {
        const due = [...callbacks.entries()]
          .filter(([, task]) => task.atMs <= nowMs)
          .sort((left, right) => left[1].atMs - right[1].atMs || left[0] - right[0]);
        if (due.length === 0) break;
        for (const [handle, task] of due) {
          callbacks.delete(handle);
          task.callback();
          executed += 1;
          if (executed > 10_000) throw new Error("capture wake clock exceeded callback budget");
        }
      }
    },
    pendingCount: () => callbacks.size,
    dispose(): void {
      disposed = true;
      callbacks.clear();
    },
  };
}
