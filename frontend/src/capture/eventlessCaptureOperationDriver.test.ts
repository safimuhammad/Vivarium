import { describe, expect, it, vi } from "vitest";

import {
  C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES,
  C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES,
  createEventlessCaptureOperationDriver,
  eventlessCaptureSchedulerIsQuiescent,
  runSameTimeSettledEventlessCaptureFrame,
  runSettledEventlessCaptureFrame,
} from "./eventlessCaptureOperationDriver";

describe("eventless capture operation driver", () => {
  it("accepts only idle scheduling or a legitimate future ambient graph wake", () => {
    const exactTimeMs = 1_000;
    expect(eventlessCaptureSchedulerIsQuiescent({
      dirty: false,
      rafScheduled: false,
      wakeScheduled: false,
      nextDeadlineMs: null,
      reason: null,
    }, exactTimeMs)).toBe(true);
    expect(eventlessCaptureSchedulerIsQuiescent({
      dirty: false,
      rafScheduled: false,
      wakeScheduled: true,
      nextDeadlineMs: 1_250,
      reason: "graph-deadline",
    }, exactTimeMs)).toBe(true);

    const rejected = [
      { dirty: false, rafScheduled: false, wakeScheduled: true, nextDeadlineMs: 1_000, reason: "graph-deadline" },
      { dirty: false, rafScheduled: false, wakeScheduled: true, nextDeadlineMs: 999, reason: "graph-deadline" },
      { dirty: false, rafScheduled: false, wakeScheduled: true, nextDeadlineMs: 1_250, reason: "post-commit-retry" },
      { dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: 1_250, reason: null },
      { dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, reason: "graph-deadline" },
      { dirty: true, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, reason: null },
      { dirty: false, rafScheduled: true, wakeScheduled: false, nextDeadlineMs: null, reason: null },
    ];
    rejected.forEach((scheduler) => {
      expect(eventlessCaptureSchedulerIsQuiescent(scheduler, exactTimeMs)).toBe(false);
    });
  });

  it("flushes renderer work at the same exact time after operation settlement before diagnostics", async () => {
    const operationCanFinish = deferred<void>();
    const order: string[] = [];
    let clockMs = 0;
    let rendererDirty = false;
    const driver = createEventlessCaptureOperationDriver([{
      startFrame: 30,
      run: async () => {
        order.push("operation-start");
        await operationCanFinish.promise;
        rendererDirty = true;
        order.push("operation-settled-dirty");
      },
    }]);

    await runSameTimeSettledEventlessCaptureFrame(
      driver,
      30,
      1_000,
      async (productWork) => productWork(),
      async (exactTimeMs) => {
        clockMs = exactTimeMs;
        order.push(`initial-advance:${exactTimeMs}`);
        operationCanFinish.resolve();
      },
      async (exactTimeMs) => {
        expect(exactTimeMs).toBe(clockMs);
        expect(rendererDirty).toBe(true);
        expect(eventlessCaptureSchedulerIsQuiescent({
          dirty: rendererDirty,
          rafScheduled: true,
          wakeScheduled: false,
          nextDeadlineMs: null,
          reason: null,
        }, exactTimeMs)).toBe(false);
        rendererDirty = false;
        order.push(`same-time-flush:${exactTimeMs}`);
      },
      async () => {
        expect(rendererDirty).toBe(false);
        expect(eventlessCaptureSchedulerIsQuiescent({
          dirty: rendererDirty,
          rafScheduled: false,
          wakeScheduled: false,
          nextDeadlineMs: null,
          reason: null,
        }, clockMs)).toBe(true);
        order.push("diagnostics-idle");
      },
    );

    expect(clockMs).toBe(1_000);
    expect(order).toEqual([
      "operation-start",
      "initial-advance:1000",
      "operation-settled-dirty",
      "same-time-flush:1000",
      "diagnostics-idle",
    ]);
  });

  it("keeps C15 recovery mutations away from exact checkpoint-feed poll boundaries", () => {
    expect(C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES).toEqual([30, 36, 42, 48]);
    expect(C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES).toEqual([31, 37, 43, 49]);
    for (const frameIndex of C15_EVENTLESS_CAPTURE_OPERATION_START_FRAMES) {
      const exactTimeMs = frameIndex * 1_000 / 30;
      expect(exactTimeMs % 1_000).not.toBe(0);
    }
  });

  it("starts C14 clock-dependent eventless work at the first 1000 ms poll frame", async () => {
    expect(C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES).toEqual([30, 36, 42, 48]);
    const pollReached = deferred<void>();
    const order: string[] = [];
    let clockMs = 0;
    const driver = createEventlessCaptureOperationDriver([{
      startFrame: C14_EVENTLESS_CAPTURE_OPERATION_START_FRAMES[0],
      run: async () => {
        order.push("operation-start");
        await pollReached.promise;
        order.push("operation-settled");
      },
    }]);
    const runFrame = async (frameIndex: number): Promise<void> => {
      const exactTimeMs = frameIndex * 1_000 / 30;
      await runSettledEventlessCaptureFrame(
        driver,
        frameIndex,
        async (productWork) => productWork(),
        async () => {
          clockMs = exactTimeMs;
          order.push(`clock-${frameIndex}:${clockMs}`);
          if (clockMs >= 1_000) pollReached.resolve();
        },
        async () => { order.push(`post-settle-${frameIndex}`); },
        async () => { order.push(`diagnostics-${frameIndex}`); },
      );
    };

    await runFrame(29);
    expect(clockMs).toBeCloseTo(966.667, 3);
    expect(order).not.toContain("operation-start");

    await runFrame(30);
    expect(clockMs).toBe(1_000);
    expect(order.indexOf("operation-start")).toBeLessThan(order.indexOf("clock-30:1000"));
    expect(order.indexOf("clock-30:1000")).toBeLessThan(order.indexOf("operation-settled"));
    expect(order.indexOf("operation-settled")).toBeLessThan(order.indexOf("diagnostics-30"));
  });

  it("keeps capture diagnostics outside the product interval until the active operation settles", async () => {
    const operation = deferred<void>();
    const order: string[] = [];
    const driver = createEventlessCaptureOperationDriver([{
      startFrame: 12,
      run: async () => {
        order.push("operation-start");
        await operation.promise;
        order.push("operation-settled");
      },
    }]);
    const diagnostics = vi.fn(async () => {
      order.push("diagnostics");
      return "observed";
    });

    const frame = runSettledEventlessCaptureFrame(
      driver,
      12,
      async (productWork) => {
        order.push("product-open");
        await productWork();
        order.push("product-closed");
      },
      async () => { order.push("clock-settled"); },
      async () => { order.push("post-operation-settled"); },
      diagnostics,
    );
    await Promise.resolve();

    expect(diagnostics).not.toHaveBeenCalled();
    expect(order).toEqual(["product-open", "operation-start", "clock-settled"]);

    operation.resolve();
    await expect(frame).resolves.toBe("observed");
    expect(order).toEqual([
      "product-open",
      "operation-start",
      "clock-settled",
      "operation-settled",
      "post-operation-settled",
      "product-closed",
      "diagnostics",
    ]);
  });

  it("propagates operation rejection without running capture diagnostics", async () => {
    const failure = new Error("eventless operation failed");
    const operation = deferred<void>();
    const diagnostics = vi.fn(async () => "must-not-run");
    const driver = createEventlessCaptureOperationDriver([{
      startFrame: 0,
      run: () => operation.promise,
    }]);

    const frame = runSettledEventlessCaptureFrame(
      driver,
      0,
      async (productWork) => productWork(),
      async () => undefined,
      async () => undefined,
      diagnostics,
    );
    operation.reject(failure);

    await expect(frame).rejects.toBe(failure);
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("holds a fulfilled phase for one complete observed frame before starting an overdue operation", async () => {
    const starts: string[] = [];
    const driver = createEventlessCaptureOperationDriver([
      { startFrame: 0, run: async () => { starts.push("first"); } },
      { startFrame: 0, run: async () => { starts.push("second"); } },
    ]);

    driver.step(0);
    await driver.settle();
    driver.step(1);
    expect(starts).toEqual(["first"]);

    driver.step(2);
    await driver.settle();
    expect(starts).toEqual(["first", "second"]);
  });

  it("never starts a later due operation while the current operation remains pending", async () => {
    const first = deferred<void>();
    const starts: string[] = [];
    const driver = createEventlessCaptureOperationDriver([
      {
        startFrame: 0,
        run: async () => {
          starts.push("first");
          await first.promise;
        },
      },
      { startFrame: 1, run: async () => { starts.push("second"); } },
    ]);

    driver.step(0);
    driver.step(1);
    driver.step(100);
    expect(starts).toEqual(["first"]);

    first.resolve();
    await driver.settle();
    driver.step(101);
    expect(starts).toEqual(["first"]);
    driver.step(102);
    await driver.settle();
    expect(starts).toEqual(["first", "second"]);
  });
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}
