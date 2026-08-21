import type { Page } from "@playwright/test";

import type { ChronicleProgramBudget } from "../../../frontend/src/capture/chronicleProgramBudget";
import type { ChronicleManifest } from "../../../frontend/src/presentation/fixtures/chronicleCatalog";

const CAPTURE_SETTLEMENT_PADDING_MS = 5_000;
const MAX_BOUNDED_MOMENT_COUNT = 48;

export interface ProductionCaptureFrameCeiling {
  readonly durationMs: number;
  readonly frameCount: number;
  readonly fps: number;
  readonly source: "eventless" | "pressure" | "choreography-maxima" | "bounded-pressure";
}

/**
 * Extend a program ceiling with the remaining consecutive terminal samples.
 *
 * The base ceiling already includes the first sampled frame at or after the
 * program duration, so a witness of N consecutive frames requires N - 1 more
 * capture slots. This preserves the program planner's exact-duration meaning.
 */
export function captureFrameCountWithTerminalWitness(
  baseFrameCount: number,
  requiredConsecutiveSampleCount: number,
): number {
  if (!Number.isSafeInteger(baseFrameCount) || baseFrameCount < 1) {
    throw new RangeError("base frame count must be a positive safe integer");
  }
  if (!Number.isSafeInteger(requiredConsecutiveSampleCount)
    || requiredConsecutiveSampleCount < 1) {
    throw new RangeError("terminal witness sample count must be a positive safe integer");
  }
  const additionalFrames = requiredConsecutiveSampleCount - 1;
  if (baseFrameCount > Number.MAX_SAFE_INTEGER - additionalFrames) {
    throw new RangeError("terminal witness frame count must remain a safe integer");
  }
  return baseFrameCount + additionalFrames;
}

/** Resolve travel capture timing inside Vite's real production module graph. */
export async function productionTravelFrameBudget(
  page: Page,
  manifest: ChronicleManifest,
  fps: number,
): Promise<ChronicleProgramBudget> {
  if (manifest.id !== "C01" && manifest.id !== "C02") {
    throw new Error(`Chronicle ${manifest.id} does not use the exact travel budget`);
  }
  return page.evaluate(async ({ serializedManifest, captureFps }) => {
    const modulePath = "/src/capture/chronicleProgramBudget.ts";
    const capture = await import(/* @vite-ignore */ modulePath) as Readonly<{
      planChronicleProgramBudget(
        value: ChronicleManifest,
        options: Readonly<{ fps: number }>,
      ): ChronicleProgramBudget;
    }>;
    return capture.planChronicleProgramBudget(serializedManifest, { fps: captureFps });
  }, { serializedManifest: manifest, captureFps: fps });
}

/**
 * Bound a non-travel capture with the canonical choreography definitions.
 *
 * Small mechanic Chronicles sum each event definition's certified maximum so
 * route-aware resource, home, ruin, and movement scenes cannot outlive the
 * harness. Pressure fixtures retain their separate bounded-prefix ceiling; the
 * capture loop still exits immediately once the real presentation settles.
 */
export async function productionCaptureFrameCeiling(
  page: Page,
  manifest: ChronicleManifest,
  fps: number,
): Promise<ProductionCaptureFrameCeiling> {
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new RangeError("capture fps must be finite and positive");
  }
  return page.evaluate(async ({ serializedManifest, captureFps, paddingMs, maximumMomentCount }) => {
    const pressureDurationMs = serializedManifest.id === "C13" ? 20_000
      : serializedManifest.id === "C16" ? 40_000
        : 0;
    const boundedMomentDurationMs = Math.min(
      maximumMomentCount,
      Math.max(1, serializedManifest.entries.length),
    ) * 6_400 + paddingMs;

    let source: ProductionCaptureFrameCeiling["source"];
    let durationMs: number;
    if (serializedManifest.entries.length === 0) {
      source = "eventless";
      durationMs = 4_000;
    } else if (serializedManifest.entries.length > maximumMomentCount) {
      source = pressureDurationMs > 0 ? "pressure" : "bounded-pressure";
      durationMs = Math.max(pressureDurationMs, boundedMomentDurationMs);
    } else {
      const modulePath = "/src/presentation/choreography/registry.ts";
      const choreography = await import(/* @vite-ignore */ modulePath) as Readonly<{
        getChoreographyDefinition(
          eventType: string,
        ): Readonly<{ duration: Readonly<{ maxMs: number }> }> | undefined;
      }>;
      source = "choreography-maxima";
      const choreographyDurationMs = serializedManifest.entries.reduce((total, entry) => {
        const definition = choreography.getChoreographyDefinition(entry.event.type);
        if (definition === undefined) {
          throw new Error(
            `Chronicle ${serializedManifest.id} has no choreography definition for ${entry.event.type}`,
          );
        }
        return total + definition.duration.maxMs;
      }, paddingMs);
      durationMs = Math.max(pressureDurationMs, boundedMomentDurationMs, choreographyDurationMs);
    }

    const frameCount = Math.ceil(durationMs * captureFps / 1_000) + 1;
    if (!Number.isSafeInteger(frameCount) || frameCount < 2) {
      throw new RangeError("capture frame ceiling must be a finite safe integer of at least two");
    }
    return { durationMs, frameCount, fps: captureFps, source };
  }, {
    serializedManifest: manifest,
    captureFps: fps,
    paddingMs: CAPTURE_SETTLEMENT_PADDING_MS,
    maximumMomentCount: MAX_BOUNDED_MOMENT_COUNT,
  });
}
