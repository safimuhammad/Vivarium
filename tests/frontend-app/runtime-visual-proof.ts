export interface RuntimeVisualProofCandidate {
  readonly origin: "manual-compositor" | "production-stage-canvas";
  readonly route: string;
  readonly stageSelector: string;
  readonly canvasLabel: string;
  readonly stageReady: boolean;
  readonly acceptedFrameIdentity: string | null;
  readonly recipeIdentityMatchesRuntime: boolean;
  readonly settledByDiagnostics: boolean;
  readonly screenshotSha256: string;
}

/** Validate whether visual evidence came from the mounted production renderer. */
export function validateRuntimeVisualProofCandidate(
  candidate: RuntimeVisualProofCandidate,
): readonly string[] {
  const errors: string[] = [];
  if (candidate.origin !== "production-stage-canvas") {
    errors.push("proof origin must be the production Stage/Canvas");
  }
  if (candidate.route !== "/?renderer=2d") {
    errors.push("proof route must be exact /?renderer=2d");
  }
  if (candidate.stageSelector !== ".presentation-world-stage") {
    errors.push("proof must bind .presentation-world-stage");
  }
  if (candidate.canvasLabel !== "Vivarium world") {
    errors.push("proof must bind the Vivarium world Canvas");
  }
  if (!candidate.stageReady) errors.push("production Stage must be ready");
  if (candidate.acceptedFrameIdentity === null
    || candidate.acceptedFrameIdentity.trim().length === 0) {
    errors.push("accepted frame identity is required");
  }
  if (!candidate.recipeIdentityMatchesRuntime) {
    errors.push("generated recipe identity must match the runtime graph");
  }
  if (!candidate.settledByDiagnostics) {
    errors.push("camera and semantic state must settle through diagnostics");
  }
  if (!/^(?!0{64}$)[0-9a-f]{64}$/.test(candidate.screenshotSha256)) {
    errors.push("screenshot hash must be a nonzero SHA-256");
  }
  return errors;
}
