export interface ManualPresentationClock {
  now(): number;
  schedule(deadlineMs: number, callback: () => void): () => void;
  advanceBy(deltaMs: number): void;
  advanceTo(deadlineMs: number): void;
  pendingCount(): number;
  dispose(): void;
}

export interface ManualPresentationClockOptions {
  readonly initialNowMs?: number;
  readonly maxCallbacksPerAdvance?: number;
}

interface ScheduledCallback {
  readonly id: number;
  readonly deadlineMs: number;
  readonly callback: () => void;
  cancelled: boolean;
}

const DEFAULT_MAX_CALLBACKS_PER_ADVANCE = 10_000;

/** Creates a deterministic, explicitly advanced presentation clock. */
export function createManualPresentationClock(
  options: ManualPresentationClockOptions = {},
): ManualPresentationClock {
  let currentTime = options.initialNowMs ?? 0;
  const maxCallbacks = options.maxCallbacksPerAdvance
    ?? DEFAULT_MAX_CALLBACKS_PER_ADVANCE;
  assertFinite(currentTime, "initialNowMs");
  if (currentTime < 0) throw new RangeError("initialNowMs must be non-negative");
  if (!Number.isSafeInteger(maxCallbacks) || maxCallbacks <= 0) {
    throw new RangeError("maxCallbacksPerAdvance must be a positive safe integer");
  }

  let disposed = false;
  let nextId = 1;
  let scheduled: ScheduledCallback[] = [];

  const nextDue = (targetTime: number): ScheduledCallback | null => {
    let selected: ScheduledCallback | null = null;
    for (const task of scheduled) {
      if (task.cancelled || task.deadlineMs > targetTime) continue;
      if (
        selected === null
        || task.deadlineMs < selected.deadlineMs
        || (task.deadlineMs === selected.deadlineMs && task.id < selected.id)
      ) {
        selected = task;
      }
    }
    return selected;
  };

  const advanceTo = (deadlineMs: number): void => {
    assertFinite(deadlineMs, "deadlineMs");
    if (deadlineMs < currentTime) {
      throw new RangeError("manual clock cannot move backwards");
    }
    if (disposed) return;

    let executed = 0;
    try {
      while (!disposed) {
        const task = nextDue(deadlineMs);
        if (task === null) break;
        if (executed >= maxCallbacks) {
          currentTime = Math.max(currentTime, deadlineMs);
          throw new Error(
            `manual clock exceeded ${maxCallbacks} callbacks in one advance`,
          );
        }
        task.cancelled = true;
        currentTime = Math.max(currentTime, task.deadlineMs);
        executed += 1;
        task.callback();
      }
      if (!disposed) currentTime = Math.max(currentTime, deadlineMs);
    } finally {
      compactCancelled();
    }
  };

  const compactCancelled = (): void => {
    scheduled = scheduled.filter((task) => !task.cancelled);
  };

  return {
    now(): number {
      return currentTime;
    },
    schedule(deadlineMs, callback): () => void {
      assertFinite(deadlineMs, "deadlineMs");
      if (disposed) return () => undefined;
      const task: ScheduledCallback = {
        id: nextId,
        deadlineMs: Math.max(currentTime, deadlineMs),
        callback,
        cancelled: false,
      };
      nextId += 1;
      scheduled.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    advanceBy(deltaMs): void {
      assertFinite(deltaMs, "deltaMs");
      if (deltaMs < 0) {
        throw new RangeError("deltaMs must be a non-negative finite number");
      }
      advanceTo(currentTime + deltaMs);
    },
    advanceTo,
    pendingCount(): number {
      return disposed
        ? 0
        : scheduled.reduce((count, task) => count + Number(!task.cancelled), 0);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      scheduled = [];
    },
  };
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be a finite number`);
}
