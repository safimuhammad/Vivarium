export interface CaptureLongTaskAttribution {
  readonly name: string;
  readonly entryType: string;
  readonly startTime: number;
  readonly duration: number;
  readonly containerType: string | null;
  readonly containerSrc: string | null;
  readonly containerId: string | null;
  readonly containerName: string | null;
}

export interface CaptureLongTaskSample {
  readonly startTime: number;
  readonly duration: number;
  readonly name: string;
  readonly attribution: readonly CaptureLongTaskAttribution[];
}

export interface CaptureLongTaskObservation {
  readonly observerStartedAt: number;
  readonly samples: readonly CaptureLongTaskSample[];
}

export interface CaptureProductWorkInterval {
  readonly label: string;
  readonly startTime: number;
  readonly endTime: number;
}

export interface CaptureLongTaskEvidence {
  readonly observerStartedAt: number;
  readonly longTaskSamples: readonly CaptureLongTaskSample[];
  readonly productWorkIntervals: readonly CaptureProductWorkInterval[];
  readonly longTasksMs: readonly number[];
  readonly captureInstrumentationLongTasks: readonly CaptureLongTaskSample[];
}

/** Measure one product-work operation in the browser performance time domain. */
export async function recordCaptureProductWork<T>(
  intervals: CaptureProductWorkInterval[],
  label: string,
  now: () => Promise<number>,
  operation: () => Promise<T>,
): Promise<T> {
  const startTime = await now();
  assertFinite(startTime, `product-work interval ${label} start`);
  try {
    return await operation();
  } finally {
    const endTime = await now();
    assertFinite(endTime, `product-work interval ${label} end`);
    if (endTime < startTime) throw new Error(`product-work interval ${label} ends before it starts`);
    const previous = intervals.at(-1);
    if (previous !== undefined && startTime < previous.endTime) {
      throw new Error(`product-work interval ${label} overlaps its predecessor`);
    }
    intervals.push(Object.freeze({ label, startTime, endTime }));
  }
}

interface CaptureLongTaskWindow extends Window {
  __vivariumCaptureLongTaskObserver?: PerformanceObserver;
  __vivariumCaptureLongTaskObserverStartedAt?: number;
  __vivariumCaptureLongTasks?: CaptureLongTaskSample[];
}

/** Start capture-only long-task observation without importing buffered browser history. */
export function startBrowserLongTaskObservation(): void {
  const scope = window as CaptureLongTaskWindow;
  scope.__vivariumCaptureLongTaskObserver?.disconnect();
  scope.__vivariumCaptureLongTasks = [];
  scope.__vivariumCaptureLongTaskObserverStartedAt = performance.now();
  scope.__vivariumCaptureLongTaskObserver = undefined;
  if (typeof PerformanceObserver !== "function") return;

  const append = (entries: readonly PerformanceEntry[]): void => {
    for (const entry of entries) {
      const attributed = entry as PerformanceEntry & {
        readonly attribution?: readonly (PerformanceEntry & {
          readonly containerType?: string;
          readonly containerSrc?: string;
          readonly containerId?: string;
          readonly containerName?: string;
        })[];
      };
      scope.__vivariumCaptureLongTasks!.push({
        startTime: entry.startTime,
        duration: entry.duration,
        name: entry.name,
        attribution: (attributed.attribution ?? []).map((item) => ({
          name: item.name,
          entryType: item.entryType,
          startTime: item.startTime,
          duration: item.duration,
          containerType: item.containerType ?? null,
          containerSrc: item.containerSrc ?? null,
          containerId: item.containerId ?? null,
          containerName: item.containerName ?? null,
        })),
      });
    }
  };
  const observer = new PerformanceObserver((list) => append(list.getEntries()));
  try {
    observer.observe({ type: "longtask" });
    scope.__vivariumCaptureLongTaskObserver = observer;
  } catch {
    observer.disconnect();
  }
}

/** Flush pending long-task records before disconnecting and return the raw observation. */
export function stopBrowserLongTaskObservation(): CaptureLongTaskObservation {
  const scope = window as CaptureLongTaskWindow;
  const observer = scope.__vivariumCaptureLongTaskObserver;
  if (observer !== undefined) {
    for (const entry of observer.takeRecords()) {
      const attributed = entry as PerformanceEntry & {
        readonly attribution?: readonly (PerformanceEntry & {
          readonly containerType?: string;
          readonly containerSrc?: string;
          readonly containerId?: string;
          readonly containerName?: string;
        })[];
      };
      scope.__vivariumCaptureLongTasks!.push({
        startTime: entry.startTime,
        duration: entry.duration,
        name: entry.name,
        attribution: (attributed.attribution ?? []).map((item) => ({
          name: item.name,
          entryType: item.entryType,
          startTime: item.startTime,
          duration: item.duration,
          containerType: item.containerType ?? null,
          containerSrc: item.containerSrc ?? null,
          containerId: item.containerId ?? null,
          containerName: item.containerName ?? null,
        })),
      });
    }
    observer.disconnect();
  }
  scope.__vivariumCaptureLongTaskObserver = undefined;
  return {
    observerStartedAt: scope.__vivariumCaptureLongTaskObserverStartedAt ?? performance.now(),
    samples: scope.__vivariumCaptureLongTasks ?? [],
  };
}

/** Attribute only fully contained samples to product work and fail closed on overlap. */
export function classifyCaptureLongTasks(
  observation: CaptureLongTaskObservation,
  intervals: readonly CaptureProductWorkInterval[],
): CaptureLongTaskEvidence {
  assertFinite(observation.observerStartedAt, "long-task observer start");
  const windows = intervals.map((interval, index) => {
    if (typeof interval.label !== "string" || interval.label.trim() === "") {
      throw new Error(`product-work interval ${index} has no label`);
    }
    assertFinite(interval.startTime, `product-work interval ${interval.label} start`);
    assertFinite(interval.endTime, `product-work interval ${interval.label} end`);
    if (interval.endTime < interval.startTime) {
      throw new Error(`product-work interval ${interval.label} ends before it starts`);
    }
    if (index > 0 && interval.startTime < intervals[index - 1]!.endTime) {
      throw new Error(`product-work interval ${interval.label} overlaps its predecessor`);
    }
    return Object.freeze({ ...interval });
  });
  const samples = observation.samples.map((sample, index) => {
    assertFinite(sample.startTime, `long-task sample ${index} start`);
    assertFinite(sample.duration, `long-task sample ${index} duration`);
    if (sample.duration < 0) throw new Error(`long-task sample ${index} has negative duration`);
    return Object.freeze({
      ...sample,
      attribution: Object.freeze(sample.attribution.map((item) => Object.freeze({ ...item }))),
    });
  });
  const product: CaptureLongTaskSample[] = [];
  const instrumentation: CaptureLongTaskSample[] = [];
  for (const sample of samples) {
    const sampleEnd = sample.startTime + sample.duration;
    if (sampleEnd <= observation.observerStartedAt) {
      instrumentation.push(sample);
      continue;
    }
    if (sample.startTime < observation.observerStartedAt) {
      throw new Error("long task straddles observer-start boundary");
    }
    const containing = windows.find((interval) => (
      sample.startTime >= interval.startTime && sampleEnd <= interval.endTime
    ));
    if (containing !== undefined) {
      product.push(sample);
      continue;
    }
    const overlapping = windows.find((interval) => (
      sample.startTime < interval.endTime && sampleEnd > interval.startTime
    ));
    if (overlapping !== undefined) {
      throw new Error(`long task straddles product-work boundary ${overlapping.label}`);
    }
    instrumentation.push(sample);
  }
  return Object.freeze({
    observerStartedAt: observation.observerStartedAt,
    longTaskSamples: Object.freeze(samples),
    productWorkIntervals: Object.freeze(windows),
    longTasksMs: Object.freeze(product.map(({ duration }) => duration)),
    captureInstrumentationLongTasks: Object.freeze(instrumentation),
  });
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
}
