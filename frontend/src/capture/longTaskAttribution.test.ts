import { afterEach, describe, expect, it, vi } from "vitest";

import {
  classifyCaptureLongTasks,
  recordCaptureProductWork,
  startBrowserLongTaskObservation,
  stopBrowserLongTaskObservation,
  type CaptureLongTaskSample,
  type CaptureProductWorkInterval,
} from "./longTaskAttribution";

describe("capture long-task attribution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as CaptureLongTaskWindow).__vivariumCaptureLongTaskObserver;
    delete (window as CaptureLongTaskWindow).__vivariumCaptureLongTaskObserverStartedAt;
    delete (window as CaptureLongTaskWindow).__vivariumCaptureLongTasks;
  });

  it("does not request buffered long-task history", () => {
    const observed: PerformanceObserverInit[] = [];
    class FakePerformanceObserver {
      observe(options: PerformanceObserverInit): void {
        observed.push(options);
      }

      disconnect(): void {}

      takeRecords(): PerformanceEntryList {
        return [];
      }
    }
    vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);

    startBrowserLongTaskObservation();

    expect(observed).toEqual([{ type: "longtask" }]);
    expect(observed[0]).not.toHaveProperty("buffered");
  });

  it("records one closed product-work interval around the operation", async () => {
    const intervals: CaptureProductWorkInterval[] = [];
    const times = [120, 180];

    const result = await recordCaptureProductWork(
      intervals,
      "scenario-dispatch",
      async () => times.shift()!,
      async () => "settled",
    );

    expect(result).toBe("settled");
    expect(intervals).toEqual([{
      label: "scenario-dispatch",
      startTime: 120,
      endTime: 180,
    }]);
  });

  it("keeps a pre-start 80 ms buffered sample out of product evidence", () => {
    const sample = longTask(20, 80);

    const evidence = classifyCaptureLongTasks(
      { observerStartedAt: 100, samples: [sample] },
      [{ label: "startup", startTime: 0, endTime: 100 }],
    );

    expect(evidence.longTasksMs).toEqual([]);
    expect(evidence.captureInstrumentationLongTasks).toEqual([sample]);
    expect(evidence.longTaskSamples).toEqual([sample]);
  });

  it("retains an 80 ms instrumentation sample without charging the product budget", () => {
    const sample = longTask(200, 80);

    const evidence = classifyCaptureLongTasks(
      { observerStartedAt: 100, samples: [sample] },
      [{ label: "product", startTime: 400, endTime: 500 }],
    );

    expect(evidence.longTasksMs).toEqual([]);
    expect(evidence.captureInstrumentationLongTasks).toEqual([sample]);
  });

  it("charges a fully contained 80 ms product sample to the unchanged budget", () => {
    const sample = longTask(210, 80);

    const evidence = classifyCaptureLongTasks(
      { observerStartedAt: 100, samples: [sample] },
      [{ label: "product", startTime: 200, endTime: 300 }],
    );

    expect(evidence.longTasksMs).toEqual([80]);
    expect(evidence.captureInstrumentationLongTasks).toEqual([]);
  });

  it("fails closed when a long task straddles a product-work boundary", () => {
    expect(() => classifyCaptureLongTasks(
      { observerStartedAt: 100, samples: [longTask(190, 80)] },
      [{ label: "product", startTime: 200, endTime: 300 }],
    )).toThrow(/straddles product-work boundary/i);
  });

  it("takes pending records before disconnect so immediate stop retains the sample", () => {
    const calls: string[] = [];
    const pending = performanceEntry(250, 80);
    const observer = {
      takeRecords(): PerformanceEntryList {
        calls.push("takeRecords");
        return [pending];
      },
      disconnect(): void {
        calls.push("disconnect");
      },
    } as unknown as PerformanceObserver;
    const scope = window as CaptureLongTaskWindow;
    scope.__vivariumCaptureLongTaskObserver = observer;
    scope.__vivariumCaptureLongTaskObserverStartedAt = 200;
    scope.__vivariumCaptureLongTasks = [];

    const observation = stopBrowserLongTaskObservation();

    expect(calls).toEqual(["takeRecords", "disconnect"]);
    expect(observation).toEqual({
      observerStartedAt: 200,
      samples: [{
        startTime: 250,
        duration: 80,
        name: "self",
        attribution: [],
      }],
    });
  });
});

interface CaptureLongTaskWindow extends Window {
  __vivariumCaptureLongTaskObserver?: PerformanceObserver;
  __vivariumCaptureLongTaskObserverStartedAt?: number;
  __vivariumCaptureLongTasks?: CaptureLongTaskSample[];
}

function longTask(startTime: number, duration: number): CaptureLongTaskSample {
  return Object.freeze({
    startTime,
    duration,
    name: "self",
    attribution: Object.freeze([]),
  });
}

function performanceEntry(startTime: number, duration: number): PerformanceEntry {
  return {
    name: "self",
    entryType: "longtask",
    startTime,
    duration,
    toJSON: () => ({ name: "self", entryType: "longtask", startTime, duration }),
  };
}
