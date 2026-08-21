import type { ObserverRendererFailure } from "../../presentation/rendererPort";

export interface ProductionFailureDiagnostic {
  readonly code: string;
  readonly subjectId: string | null;
  readonly regionId: string | null;
  readonly occurrence: number;
}

export type ProductionFailureDecision =
  | Readonly<{
      action: "continue";
      fallback:
        | "neutral-region"
        | "neutral-tile"
        | "person-silhouette"
        | "nearest-path"
        | "omit-optional-marker"
        | "region-narration";
      diagnostic: ProductionFailureDiagnostic;
    }>
  | Readonly<{
      action: "retry";
      owner: "atlas-generation" | "world-recovery" | "canvas-generation";
      publicMessage: string;
      diagnostic: ProductionFailureDiagnostic;
    }>
  | Readonly<{
      action: "freeze";
      owner: "world-recovery";
      publicMessage: string;
      diagnostic: ProductionFailureDiagnostic;
    }>
  | Readonly<{
      action: "reject";
      reason: "required-marker-invalid" | "unauthorized-edge" | "stale-identity";
      diagnostic: ProductionFailureDiagnostic;
    }>;

interface DiagnosticInput {
  readonly subjectId: string | null;
  readonly regionId: string | null;
  readonly occurrence: number;
}

export interface AbundanceRatioInput extends DiagnosticInput {
  readonly current: number;
  readonly maximum: number;
  readonly code: "invalid-energy-abundance-ratio" | "invalid-materials-abundance-ratio";
}

export type AssetFallbackInput = DiagnosticInput & Readonly<{
  failure:
    | "unknown-region"
    | "missing-static-art"
    | "missing-character-art"
    | "atlas-load"
    | "canvas-init";
}>;

export type PathFallbackInput = DiagnosticInput & Readonly<{
  failure: "unreachable-target" | "unauthorized-edge" | "stale-identity";
  nearestReachable: boolean;
  authoritativeEndpointDiffers: boolean;
}>;

export type ParticipantFallbackInput = DiagnosticInput;

export type MarkerFailureRole =
  | "contact"
  | "consequence"
  | "safe-cancel"
  | "optional-effect"
  | "settle";

export type MarkerFallbackInput = DiagnosticInput & Readonly<{
  markerRole: MarkerFailureRole;
  optional: boolean;
}>;

export type RecoveryFallbackInput = Omit<DiagnosticInput, "subjectId"> & Readonly<{
  failure: "world-recovery-retry" | "world-recovery-frozen";
}>;

const PUBLIC_COPY = Object.freeze({
  atlas: "Some world art could not be shown. Retry the world view.",
  canvas: "The world view could not start. Retry the world view.",
  optionalMarker: "A visual flourish was omitted. The world state remains current.",
  path: "A route could not be shown exactly. The world state remains current.",
  recoveryRetry: "Retry the paused world when ready.",
  recoveryFrozen: "The world paused here. Retry when ready.",
});

/** Clamp presentation-only abundance while retaining one bounded private diagnostic. */
export function clampAbundanceRatio(input: AbundanceRatioInput): Readonly<{
  value: number;
  diagnostic: ProductionFailureDiagnostic | null;
}> {
  const diagnostic = validateDiagnostic(input.code, input);
  const valid = Number.isFinite(input.current)
    && Number.isFinite(input.maximum)
    && input.maximum > 0
    && input.current >= 0
    && input.current <= input.maximum;
  if (valid) return Object.freeze({ value: input.current / input.maximum, diagnostic: null });

  const value = !Number.isFinite(input.maximum) || input.maximum <= 0 || Number.isNaN(input.current)
    ? 0
    : input.current === Number.POSITIVE_INFINITY || input.current > input.maximum
      ? 1
      : 0;
  return Object.freeze({ value, diagnostic });
}

/** Select an authored presentation fallback or delegate retry to the existing asset owner. */
export function decideAssetFallback(input: AssetFallbackInput): ProductionFailureDecision {
  const diagnostic = validateDiagnostic(input.failure, input);
  switch (input.failure) {
    case "unknown-region":
      return freezeDecision({ action: "continue", fallback: "neutral-region", diagnostic });
    case "missing-static-art":
      return freezeDecision({ action: "continue", fallback: "neutral-tile", diagnostic });
    case "missing-character-art":
      return freezeDecision({ action: "continue", fallback: "person-silhouette", diagnostic });
    case "atlas-load":
      return freezeDecision({
        action: "retry",
        owner: "atlas-generation",
        publicMessage: PUBLIC_COPY.atlas,
        diagnostic,
      });
    case "canvas-init":
      return freezeDecision({
        action: "retry",
        owner: "canvas-generation",
        publicMessage: PUBLIC_COPY.canvas,
        diagnostic,
      });
  }
}

/** Preserve legal nearest-route presentation or reject topology/identity violations. */
export function decidePathFallback(input: PathFallbackInput): ProductionFailureDecision {
  if (input.failure === "unauthorized-edge") {
    return freezeDecision({
      action: "reject",
      reason: "unauthorized-edge",
      diagnostic: validateDiagnostic("unauthorized-edge", input),
    });
  }
  if (input.failure === "stale-identity" || !input.nearestReachable) {
    return freezeDecision({
      action: "reject",
      reason: "stale-identity",
      diagnostic: validateDiagnostic("stale-identity", input),
    });
  }
  return freezeDecision({
    action: "continue",
    fallback: "nearest-path",
    diagnostic: validateDiagnostic(
      input.authoritativeEndpointDiffers ? "nearest-path-reposition-required" : "nearest-path",
      input,
    ),
  });
}

/** Focus the resolved region/system instead of manufacturing a missing physical subject. */
export function decideParticipantFallback(
  input: ParticipantFallbackInput,
): ProductionFailureDecision {
  return freezeDecision({
    action: "continue",
    fallback: "region-narration",
    diagnostic: validateDiagnostic("missing-participant", input),
  });
}

/** Omit only a declared optional flourish; reject every required causal marker. */
export function decideMarkerFallback(input: MarkerFallbackInput): ProductionFailureDecision {
  if (input.optional && input.markerRole === "optional-effect") {
    return freezeDecision({
      action: "continue",
      fallback: "omit-optional-marker",
      diagnostic: validateDiagnostic("optional-marker-unavailable", input),
    });
  }
  return freezeDecision({
    action: "reject",
    reason: "required-marker-invalid",
    diagnostic: validateDiagnostic("required-marker-invalid", input),
  });
}

/** Delegate recovery ownership without issuing fetches, clocks, or retry loops. */
export function decideRecoveryFallback(input: RecoveryFallbackInput): ProductionFailureDecision {
  const diagnostic = validateDiagnostic(input.failure, { ...input, subjectId: null });
  return input.failure === "world-recovery-retry"
    ? freezeDecision({
        action: "retry",
        owner: "world-recovery",
        publicMessage: PUBLIC_COPY.recoveryRetry,
        diagnostic,
      })
    : freezeDecision({
        action: "freeze",
        owner: "world-recovery",
        publicMessage: PUBLIC_COPY.recoveryFrozen,
        diagnostic,
      });
}

/** Project only renderer-owned policy decisions into fixed, redacted public failures. */
export function publicRendererFailure(
  decision: ProductionFailureDecision,
): ObserverRendererFailure | null {
  if (decision.action === "retry") {
    if (decision.owner === "atlas-generation") {
      return Object.freeze({ kind: "asset", retryable: true, publicMessage: decision.publicMessage });
    }
    if (decision.owner === "canvas-generation") {
      return Object.freeze({ kind: "canvas", retryable: true, publicMessage: decision.publicMessage });
    }
    return null;
  }
  if (decision.action === "continue" && decision.fallback === "omit-optional-marker") {
    return Object.freeze({ kind: "marker", retryable: false, publicMessage: PUBLIC_COPY.optionalMarker });
  }
  if (decision.action === "continue" && decision.fallback === "nearest-path") {
    return Object.freeze({ kind: "path", retryable: false, publicMessage: PUBLIC_COPY.path });
  }
  if (decision.action === "reject" && decision.reason === "unauthorized-edge") {
    return Object.freeze({ kind: "path", retryable: false, publicMessage: PUBLIC_COPY.path });
  }
  return null;
}

function validateDiagnostic(
  code: string,
  input: DiagnosticInput,
): ProductionFailureDiagnostic {
  if (code.trim().length === 0) throw new Error("failure diagnostic code must not be empty");
  if (!Number.isSafeInteger(input.occurrence) || input.occurrence <= 0) {
    throw new RangeError("failure diagnostic occurrence must be a positive safe integer");
  }
  return Object.freeze({
    code,
    subjectId: input.subjectId,
    regionId: input.regionId,
    occurrence: input.occurrence,
  });
}

function freezeDecision<T extends ProductionFailureDecision>(decision: T): T {
  return Object.freeze(decision);
}
