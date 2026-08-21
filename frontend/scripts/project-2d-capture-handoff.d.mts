export interface CaptureHandoffMotionSource {
  readonly frameIndex: number;
  readonly presentationTimeMs: number;
  readonly cursor: number;
  readonly epochReady: boolean;
  readonly placementHash: string;
  readonly placements: Readonly<Record<string, string>>;
  readonly actors: readonly unknown[];
  readonly focusSelectionKey: string | null;
  readonly camera: unknown;
  readonly regionTransitions: readonly unknown[];
  readonly homes: readonly unknown[];
  readonly recentMarkers: readonly unknown[];
  readonly pathFallbacks: number;
  readonly activeEffects: number;
  readonly activeRegion: Readonly<{ readonly id: string }> | null;
  readonly environments: readonly unknown[];
  readonly rendererPool: unknown;
}

export type ProjectedCaptureHandoffMotion = Readonly<Record<string, unknown>>;

export function projectMotionSamplesForHandoff(
  samples: readonly CaptureHandoffMotionSource[],
): readonly ProjectedCaptureHandoffMotion[];

export function projectRegionTransitionWitness(
  transition: unknown,
  label?: string,
): Readonly<Record<string, unknown>>;

export function projectRepositionMarkersForHandoff(
  markers: readonly unknown[],
  label?: string,
): readonly Readonly<Record<string, unknown>>[];
