import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProductionCaptureClockFactoryForTest,
  createProductionCaptureRendererTimingForTest,
  registerProductionMountedRunReplacementForTest,
} from "./productionCaptureTestSeam";
import { makeRun, makeWorld } from "../../test/fixtures";

describe("production capture clock test seam", () => {
  afterEach(() => {
    delete window.__vivariumEnableProductionCaptureClockForTest;
    delete window.__vivariumProductionCaptureClockForTest;
    delete window.__vivariumProductionCaptureTerminalForTest;
    delete window.__vivariumProductionMountedRunForTest;
  });

  it("publishes no clock or command surface without the pre-document flag", () => {
    expect(createProductionCaptureClockFactoryForTest()).toBeUndefined();
    expect(window.__vivariumProductionCaptureClockForTest).toBeUndefined();
    expect(registerProductionMountedRunReplacementForTest(vi.fn())).toBeUndefined();
    expect(window.__vivariumProductionMountedRunForTest).toBeUndefined();
  });

  it("owns one flagged mounted-run replacement generation and ignores stale release", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const firstReplace = vi.fn();
    const secondReplace = vi.fn();
    const first = registerProductionMountedRunReplacementForTest(firstReplace)!;
    const second = registerProductionMountedRunReplacementForTest(secondReplace)!;
    const run = makeRun({ run_id: "replacement", event_cursor: 2 });
    const world = makeWorld({ run_id: run.run_id, event_cursor: 2 });

    first.release();
    window.__vivariumProductionMountedRunForTest!.replaceMountedRunForTest(run, world);
    expect(firstReplace).not.toHaveBeenCalled();
    expect(secondReplace).toHaveBeenCalledWith(run, world);

    second.release();
    expect(window.__vivariumProductionMountedRunForTest).toBeUndefined();
  });

  it("advances every opted-in manual session clock to exact frame time", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest();
    const first = timeline!.clockFactory();
    const second = timeline!.clockFactory();
    const atFirstFrame = vi.fn();
    const atSecondFrame = vi.fn();
    first.schedule(1_000 / 30, atFirstFrame);
    second.schedule(2_000 / 30, atSecondFrame);

    window.__vivariumProductionCaptureClockForTest!.advanceTo(1_000 / 30);
    expect(window.__vivariumProductionCaptureClockForTest!.now()).toBe(1_000 / 30);
    expect(atFirstFrame).toHaveBeenCalledOnce();
    expect(atSecondFrame).not.toHaveBeenCalled();

    window.__vivariumProductionCaptureClockForTest!.advanceTo(2_000 / 30);
    expect(atSecondFrame).toHaveBeenCalledOnce();
    expect(window.__vivariumProductionCaptureClockForTest!.pendingCount()).toBe(0);
    const control = window.__vivariumProductionCaptureClockForTest!;
    timeline!.dispose();
    expect(control.pendingCount()).toBe(0);
    expect(window.__vivariumProductionCaptureClockForTest).toBeUndefined();
  });

  it("coordinates Canvas frame and wake callbacks on the same exact timeline", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    const timing = createProductionCaptureRendererTimingForTest()!;
    const frame = vi.fn();
    const wake = vi.fn(() => timing.frameDriver.request(frame));
    timing.wakeScheduler.schedule(1_000 / 30, wake);

    window.__vivariumProductionCaptureClockForTest!.advanceTo(1_000 / 30);
    expect(wake).toHaveBeenCalledOnce();
    expect(frame).toHaveBeenCalledWith(1_000 / 30);

    timing.frameDriver.request(frame);
    const control = window.__vivariumProductionCaptureClockForTest!;
    timeline.dispose();
    expect(control.pendingCount()).toBe(0);
    expect(window.__vivariumProductionCaptureClockForTest).toBeUndefined();
    control.advanceTo(2_000 / 30);
    expect(frame).toHaveBeenCalledOnce();
  });

  it("drains current renderer acceptance before future story time and post-story work after", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    const sessionClock = timeline.clockFactory();
    const timing = timeline.createRendererTiming();
    const control = window.__vivariumProductionCaptureClockForTest!;
    const order: string[] = [];
    let priorFrameAccepted = false;

    timing.wakeScheduler.schedule(0, () => {
      order.push(
        `prior-wake renderer=${timing.wakeScheduler.now()} story=${sessionClock.now()} control=${control.now()}`,
      );
      timing.frameDriver.request((atMs) => {
        priorFrameAccepted = true;
        order.push(
          `prior-frame renderer=${atMs} story=${sessionClock.now()} control=${control.now()}`,
        );
      });
    });
    sessionClock.schedule(100, () => {
      order.push(
        `story story=${sessionClock.now()} control=${control.now()} accepted=${priorFrameAccepted}`,
      );
      timing.wakeScheduler.schedule(100, () => {
        order.push(
          `story-wake renderer=${timing.wakeScheduler.now()} story=${sessionClock.now()} control=${control.now()}`,
        );
        timing.frameDriver.request((atMs) => {
          order.push(
            `story-frame renderer=${atMs} story=${sessionClock.now()} control=${control.now()}`,
          );
        });
      });
    });

    control.advanceTo(100);

    expect(order).toEqual([
      "prior-wake renderer=0 story=0 control=0",
      "prior-frame renderer=0 story=0 control=0",
      "story story=100 control=100 accepted=true",
      "story-wake renderer=100 story=100 control=100",
      "story-frame renderer=100 story=100 control=100",
    ]);
    expect(control.now()).toBe(100);
    expect(sessionClock.now()).toBe(100);
    expect(control.pendingCount()).toBe(0);
    timeline.dispose();
  });

  it("advances only renderer frame and wake callbacks during an isolated quiet probe", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    const sessionClock = timeline.clockFactory();
    const timing = createProductionCaptureRendererTimingForTest()!;
    const sessionTick = vi.fn();
    const frame = vi.fn();
    const wake = vi.fn(() => timing.frameDriver.request(frame));
    sessionClock.schedule(500, sessionTick);
    timing.wakeScheduler.schedule(500, wake);

    window.__vivariumProductionCaptureClockForTest!.advanceRendererTo(500);

    expect(wake).toHaveBeenCalledOnce();
    expect(frame).toHaveBeenCalledWith(500);
    expect(sessionTick).not.toHaveBeenCalled();
    expect(window.__vivariumProductionCaptureClockForTest!.now()).toBe(0);
    timeline.dispose();
  });

  it("does not rewind renderer owners that are ahead of the story timeline", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    const sessionClock = timeline.clockFactory();
    const timing = timeline.createRendererTiming();
    const control = window.__vivariumProductionCaptureClockForTest!;
    const order: string[] = [];

    control.advanceRendererTo(500);
    sessionClock.schedule(100, () => {
      order.push(`story story=${sessionClock.now()} control=${control.now()}`);
      timing.wakeScheduler.schedule(100, () => {
        order.push(`wake renderer=${timing.wakeScheduler.now()}`);
        timing.frameDriver.request((atMs) => order.push(`frame renderer=${atMs}`));
      });
    });

    expect(() => control.advanceTo(100)).not.toThrow();
    expect(order).toEqual([
      "story story=100 control=100",
      "wake renderer=500",
      "frame renderer=500",
    ]);
    expect(control.now()).toBe(100);
    expect(sessionClock.now()).toBe(100);
    expect(timing.wakeScheduler.now()).toBe(500);
    expect(timing.frameDriver.now()).toBe(500);
    timeline.dispose();
  });

  it("starts late Archive clocks at current capture time and removes the command on dispose", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    window.__vivariumProductionCaptureClockForTest!.advanceTo(1_000);

    const archiveClock = timeline.clockFactory();
    expect(archiveClock.now()).toBe(1_000);

    timeline.dispose();
    expect(window.__vivariumProductionCaptureClockForTest).toBeUndefined();
  });

  it("keeps transition-edge acceptance retries on current or exact target media time", () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const timeline = createProductionCaptureClockFactoryForTest()!;
    const timing = timeline.createRendererTiming();
    const observedTimes: number[] = [];
    const requestNext = (): void => {
      timing.frameDriver.request((atMs) => {
        observedTimes.push(atMs);
        if (observedTimes.length < 40) requestNext();
      });
    };
    requestNext();

    const control = window.__vivariumProductionCaptureClockForTest!;
    for (let retry = 0; retry < 64; retry += 1) control.advanceTo(56_400);

    expect(observedTimes).toHaveLength(40);
    expect(observedTimes).toEqual([0, ...Array.from({ length: 39 }, () => 56_400)]);
    expect(control.now()).toBe(56_400);
    timeline.dispose();
  });
});
