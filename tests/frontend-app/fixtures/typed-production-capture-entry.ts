import type { Page } from "@playwright/test";

import type {} from "../../../frontend/src/app/observer2d/productionCaptureTestSeam";

export interface ProductionCaptureEntrySeams {
  readonly clock: boolean;
  readonly mountedRun: boolean;
}

export interface ProductionCaptureClockDriveOptions {
  readonly label: string;
  readonly maxSteps?: number;
  readonly stepMs?: number;
}

/** Routes the Vite application entry through the opt-in production capture bootstrap. */
export async function installTypedProductionCaptureEntry(page: Page): Promise<void> {
  await page.route(/\/src\/main\.tsx(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: 'import "/src/capture/productionCaptureEntry.tsx";\n',
    });
  });
}

/** Reports whether the mounted capture runtime published both required typed controls. */
export async function productionCaptureEntrySeams(
  page: Page,
): Promise<ProductionCaptureEntrySeams> {
  return page.evaluate(() => Object.freeze({
    clock: window.__vivariumProductionCaptureClockForTest !== undefined,
    mountedRun: window.__vivariumProductionMountedRunForTest !== undefined,
  }));
}

/** Advances only captured presentation time until one harness operation settles. */
export async function driveProductionCaptureClockUntilSettled<T>(
  page: Page,
  operation: Promise<T>,
  options: ProductionCaptureClockDriveOptions,
): Promise<T> {
  const maxSteps = options.maxSteps ?? 256;
  const stepMs = options.stepMs ?? 1_000 / 30;
  if (!Number.isInteger(maxSteps) || maxSteps <= 0) {
    throw new RangeError("capture clock maxSteps must be a positive integer");
  }
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new RangeError("capture clock stepMs must be positive and finite");
  }

  const pending = Object.freeze({ kind: "pending" as const });
  const outcome = operation.then(
    (value) => Object.freeze({ kind: "fulfilled" as const, value }),
    (error: unknown) => Object.freeze({ kind: "rejected" as const, error }),
  );
  for (let step = 0; step < maxSteps; step += 1) {
    const current = await Promise.race([outcome, Promise.resolve(pending)]);
    if (current.kind === "fulfilled") return current.value;
    if (current.kind === "rejected") throw current.error;
    await page.evaluate((deltaMs) => {
      const control = window.__vivariumProductionCaptureClockForTest;
      if (control === undefined) throw new Error("manual capture clock is unavailable");
      control.advanceTo(control.now() + deltaMs);
    }, stepMs);
    await settleBrowserTurns(page);
  }

  const terminal = await Promise.race([outcome, Promise.resolve(pending)]);
  if (terminal.kind === "fulfilled") return terminal.value;
  if (terminal.kind === "rejected") throw terminal.error;
  throw new Error(`${options.label} did not settle within ${maxSteps} ManualClock steps`);
}

async function settleBrowserTurns(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const turn = (): Promise<void> => new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (): void => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
    await turn();
    await turn();
  });
}
