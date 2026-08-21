export const C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES: readonly [30, 36, 42, 48] =
  Object.freeze([30, 36, 42, 48]);

// C15 owns a CheckpointFeed whose first repeat occurs at frame 30 / 1,000 ms.
// Keep its recovery mutations between poll boundaries so resetting the feed
// cannot abort an otherwise successful fixture request during certification.
export const C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES: readonly [31, 37, 43, 49] =
  Object.freeze([31, 37, 43, 49]);

export interface EventlessCaptureOperation {
  readonly startFrame: number;
  run(): Promise<unknown>;
}

export interface EventlessCaptureOperationDriver {
  step(frameIndex: number): void;
  settle(): Promise<void>;
}

export interface EventlessCaptureSchedulerState {
  readonly dirty?: unknown;
  readonly rafScheduled?: unknown;
  readonly wakeScheduled?: unknown;
  readonly nextDeadlineMs?: unknown;
  readonly reason?: unknown;
}

interface ActiveOperation {
  status: "pending" | "fulfilled" | "rejected";
  error: unknown;
  settlement: Promise<void>;
}

/** Drive ordered clock-dependent capture operations without leaving background work. */
export function createEventlessCaptureOperationDriver(
  operations: readonly EventlessCaptureOperation[],
): EventlessCaptureOperationDriver {
  validateOperations(operations);
  let operationIndex = 0;
  let active: ActiveOperation | null = null;

  return Object.freeze({
    step(frameIndex: number): void {
      if (!Number.isInteger(frameIndex) || frameIndex < 0) {
        throw new Error("eventless capture frame index must be a non-negative integer");
      }
      if (active?.status === "rejected") throw active.error;
      if (active?.status === "fulfilled") {
        active = null;
        operationIndex += 1;
        // Do not start another overdue operation until the completed authority
        // phase has occupied one whole observed capture frame.
        return;
      }
      if (active !== null || operationIndex >= operations.length
        || frameIndex < operations[operationIndex]!.startFrame) return;

      const state: ActiveOperation = {
        status: "pending",
        error: null,
        settlement: Promise.resolve(),
      };
      active = state;
      try {
        state.settlement = operations[operationIndex]!.run().then(
          () => { state.status = "fulfilled"; },
          (error: unknown) => {
            state.status = "rejected";
            state.error = error;
          },
        );
      } catch (error: unknown) {
        state.status = "rejected";
        state.error = error;
        throw error;
      }
    },

    async settle(): Promise<void> {
      const current = active;
      if (current === null) return;
      await current.settlement;
      if (current.status === "rejected") throw current.error;
    },
  });
}

/** Run product work to settlement before invoking capture diagnostics or screenshots. */
export async function runSettledEventlessCaptureFrame<T>(
  driver: EventlessCaptureOperationDriver,
  frameIndex: number,
  runProductWork: (productWork: () => Promise<void>) => Promise<void>,
  advanceAndSettle: () => Promise<void>,
  settleAfterOperation: () => Promise<void>,
  captureDiagnostics: () => Promise<T>,
): Promise<T> {
  await runProductWork(async () => {
    driver.step(frameIndex);
    await advanceAndSettle();
    await driver.settle();
    await settleAfterOperation();
  });
  return captureDiagnostics();
}

/** Flush post-operation renderer work at the same media time before diagnostics. */
export async function runSameTimeSettledEventlessCaptureFrame<T>(
  driver: EventlessCaptureOperationDriver,
  frameIndex: number,
  exactTimeMs: number,
  runProductWork: (productWork: () => Promise<void>) => Promise<void>,
  advanceAndSettleAt: (exactTimeMs: number) => Promise<void>,
  flushAfterOperationAt: (exactTimeMs: number) => Promise<void>,
  captureDiagnostics: () => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(exactTimeMs) || exactTimeMs < 0) {
    throw new Error("eventless capture exact time must be a finite non-negative number");
  }
  return runSettledEventlessCaptureFrame(
    driver,
    frameIndex,
    runProductWork,
    () => advanceAndSettleAt(exactTimeMs),
    () => flushAfterOperationAt(exactTimeMs),
    captureDiagnostics,
  );
}

/** Accept quiescent eventless evidence, including a legitimate future ambient wake. */
export function eventlessCaptureSchedulerIsQuiescent(
  scheduler: EventlessCaptureSchedulerState | null | undefined,
  presentationTimeMs: number,
): boolean {
  if (!Number.isFinite(presentationTimeMs) || presentationTimeMs < 0
    || scheduler?.dirty !== false || scheduler.rafScheduled !== false) return false;
  if (scheduler.wakeScheduled === false) {
    return scheduler.nextDeadlineMs === null && scheduler.reason === null;
  }
  return scheduler.wakeScheduled === true
    && scheduler.reason === "graph-deadline"
    && typeof scheduler.nextDeadlineMs === "number"
    && Number.isFinite(scheduler.nextDeadlineMs)
    && scheduler.nextDeadlineMs > presentationTimeMs;
}

function validateOperations(operations: readonly EventlessCaptureOperation[]): void {
  let previousStartFrame = -1;
  operations.forEach((operation, index) => {
    if (!Number.isInteger(operation.startFrame) || operation.startFrame < 0) {
      throw new Error(`eventless capture operation ${index} has an invalid start frame`);
    }
    if (operation.startFrame < previousStartFrame) {
      throw new Error("eventless capture operations must be ordered by start frame");
    }
    previousStartFrame = operation.startFrame;
  });
}
