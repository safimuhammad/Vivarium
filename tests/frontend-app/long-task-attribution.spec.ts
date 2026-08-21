import { expect, test, type Page } from "@playwright/test";

import {
  classifyCaptureLongTasks,
  recordCaptureProductWork,
  startBrowserLongTaskObservation,
  stopBrowserLongTaskObservation,
  type CaptureLongTaskSample,
  type CaptureProductWorkInterval,
} from "../../frontend/src/capture/longTaskAttribution";

test("real Long Tasks exclude pre-start work and separate instrumentation from product work", async ({ page }) => {
  await page.goto("about:blank");
  expect(await page.evaluate(() => PerformanceObserver.supportedEntryTypes.includes("longtask")))
    .toBe(true);

  const beforeStart = await runBusyLoop(page, 80);
  await page.waitForTimeout(20);
  await page.evaluate(startBrowserLongTaskObservation);

  const outsideProduct = await runBusyLoop(page, 80);
  const productWorkIntervals: CaptureProductWorkInterval[] = [];
  let insideProduct: BrowserWorkSpan | undefined;
  await recordCaptureProductWork(
    productWorkIntervals,
    "actual-product-busy-loop",
    () => page.evaluate(() => performance.now()),
    async () => {
      insideProduct = await runBusyLoop(page, 80);
    },
  );
  await page.waitForTimeout(50);

  const evidence = classifyCaptureLongTasks(
    await page.evaluate(stopBrowserLongTaskObservation),
    productWorkIntervals,
  );
  const preStartSample = evidence.longTaskSamples.find((sample) => overlaps(sample, beforeStart));
  const outsideSample = evidence.captureInstrumentationLongTasks.find(
    (sample) => overlaps(sample, outsideProduct),
  );
  const productSample = evidence.longTaskSamples.find(
    (sample) => overlaps(sample, insideProduct!),
  );

  expect(preStartSample, "non-buffered observation must exclude the pre-start 80 ms task")
    .toBeUndefined();
  if (outsideSample === undefined || productSample === undefined) {
    throw new Error(`missing actual Long Task sample: ${JSON.stringify({
      beforeStart,
      outsideProduct,
      insideProduct,
      evidence,
    })}`);
  }
  expect(
    outsideSample.duration,
    `outside 80 ms task must remain as instrumentation evidence: ${JSON.stringify(evidence)}`,
  ).toBeGreaterThanOrEqual(70);
  expect(
    productSample.duration,
    `inside 80 ms task must remain as raw evidence: ${JSON.stringify(evidence)}`,
  ).toBeGreaterThanOrEqual(70);
  expect(evidence.longTasksMs).toEqual([productSample.duration]);
  expect(evidence.captureInstrumentationLongTasks).toContain(outsideSample);
  expect(evidence.captureInstrumentationLongTasks).not.toContain(productSample);
});

interface BrowserWorkSpan {
  readonly startTime: number;
  readonly endTime: number;
}

async function runBusyLoop(page: Page, durationMs: number): Promise<BrowserWorkSpan> {
  return page.evaluate((duration) => new Promise<BrowserWorkSpan>((resolve) => {
    setTimeout(() => {
      const startTime = performance.now();
      while (performance.now() - startTime < duration) {
        // Intentionally occupy one browser main-thread task beyond the 50 ms threshold.
      }
      resolve({ startTime, endTime: performance.now() });
    }, 0);
  }), durationMs);
}

function overlaps(sample: CaptureLongTaskSample, span: BrowserWorkSpan): boolean {
  return sample.startTime < span.endTime && sample.startTime + sample.duration > span.startTime;
}
