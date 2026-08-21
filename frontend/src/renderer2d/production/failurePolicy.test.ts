import { describe, expect, it } from "vitest";

import {
  clampAbundanceRatio,
  decideAssetFallback,
  decideMarkerFallback,
  decideParticipantFallback,
  decidePathFallback,
  decideRecoveryFallback,
  publicRendererFailure,
} from "./failurePolicy";

describe("production failure policy", () => {
  it.each([
    ["negative", -5, 10, 0],
    ["overflow", 15, 10, 1],
    ["zero maximum", 5, 0, 0],
    ["NaN current", Number.NaN, 10, 0],
    ["positive-infinite current", Number.POSITIVE_INFINITY, 10, 1],
    ["negative-infinite current", Number.NEGATIVE_INFINITY, 10, 0],
    ["NaN maximum", 5, Number.NaN, 0],
    ["infinite maximum", 5, Number.POSITIVE_INFINITY, 0],
  ])("clamps %s abundance with one bounded private diagnostic", (_case, current, maximum, value) => {
    expect(clampAbundanceRatio({
      current,
      maximum,
      code: "invalid-energy-abundance-ratio",
      subjectId: null,
      regionId: "worn",
      occurrence: 1,
    })).toEqual({
      value,
      diagnostic: {
        code: "invalid-energy-abundance-ratio",
        subjectId: null,
        regionId: "worn",
        occurrence: 1,
      },
    });
  });

  it("returns no diagnostic for a valid in-range abundance ratio", () => {
    expect(clampAbundanceRatio({
      current: 4,
      maximum: 10,
      code: "invalid-energy-abundance-ratio",
      subjectId: null,
      regionId: "worn",
      occurrence: 1,
    })).toEqual({ value: 0.4, diagnostic: null });
  });

  it.each([
    ["unknown-region", "neutral-region"],
    ["missing-static-art", "neutral-tile"],
    ["missing-character-art", "person-silhouette"],
  ] as const)("continues %s with the exact authored visual fallback", (failure, fallback) => {
    expect(decideAssetFallback({
      failure,
      subjectId: "subject",
      regionId: "worn",
      occurrence: 1,
    })).toEqual({
      action: "continue",
      fallback,
      diagnostic: {
        code: failure,
        subjectId: "subject",
        regionId: "worn",
        occurrence: 1,
      },
    });
  });

  it.each([
    ["atlas-load", "atlas-generation", "Some world art could not be shown. Retry the world view."],
    ["canvas-init", "canvas-generation", "The world view could not start. Retry the world view."],
  ] as const)("delegates %s to one owned retry with authored redacted copy", (failure, owner, publicMessage) => {
    const decision = decideAssetFallback({
      failure,
      subjectId: null,
      regionId: "worn",
      occurrence: 1,
    });
    expect(decision).toEqual({
      action: "retry",
      owner,
      publicMessage,
      diagnostic: {
        code: failure,
        subjectId: null,
        regionId: "worn",
        occurrence: 1,
      },
    });
    expect(JSON.stringify(decision)).not.toMatch(/\/tmp|stack|https?:|decode failed/i);
  });

  it("uses the nearest reachable path and rejects an unauthorized directed edge", () => {
    expect(decidePathFallback({
      failure: "unreachable-target",
      nearestReachable: true,
      authoritativeEndpointDiffers: true,
      subjectId: "traveler",
      regionId: "worn",
      occurrence: 1,
    })).toMatchObject({ action: "continue", fallback: "nearest-path" });
    expect(decidePathFallback({
      failure: "unauthorized-edge",
      nearestReachable: false,
      authoritativeEndpointDiffers: true,
      subjectId: "traveler",
      regionId: "worn",
      occurrence: 1,
    })).toMatchObject({ action: "reject", reason: "unauthorized-edge" });
  });

  it("falls back to region narration without accepting an invented participant", () => {
    expect(decideParticipantFallback({
      subjectId: "missing-being",
      regionId: "worn",
      occurrence: 1,
    })).toEqual({
      action: "continue",
      fallback: "region-narration",
      diagnostic: {
        code: "missing-participant",
        subjectId: "missing-being",
        regionId: "worn",
        occurrence: 1,
      },
    });
  });

  it("omits an optional visual marker but rejects every required causal marker", () => {
    const optional = decideMarkerFallback({
      markerRole: "optional-effect",
      optional: true,
      subjectId: "spark",
      regionId: "worn",
      occurrence: 1,
    });
    expect(optional).toMatchObject({ action: "continue", fallback: "omit-optional-marker" });
    expect(publicRendererFailure(optional)).toEqual({
      kind: "marker",
      retryable: false,
      publicMessage: "A visual flourish was omitted. The world state remains current.",
    });

    for (const markerRole of ["contact", "consequence", "safe-cancel", "settle"] as const) {
      expect(decideMarkerFallback({
        markerRole,
        optional: false,
        subjectId: markerRole,
        regionId: "worn",
        occurrence: 1,
      })).toMatchObject({ action: "reject", reason: "required-marker-invalid" });
    }
  });

  it("delegates recovery to the existing world owner and never authors a second loop", () => {
    expect(decideRecoveryFallback({
      failure: "world-recovery-retry",
      regionId: null,
      occurrence: 1,
    })).toEqual({
      action: "retry",
      owner: "world-recovery",
      publicMessage: "Retry the paused world when ready.",
      diagnostic: {
        code: "world-recovery-retry",
        subjectId: null,
        regionId: null,
        occurrence: 1,
      },
    });
    expect(decideRecoveryFallback({
      failure: "world-recovery-frozen",
      regionId: null,
      occurrence: 1,
    })).toMatchObject({
      action: "freeze",
      owner: "world-recovery",
      publicMessage: "The world paused here. Retry when ready.",
    });
  });

  it("maps only renderer-owned decisions to public failures", () => {
    expect(publicRendererFailure(decideParticipantFallback({
      subjectId: "missing",
      regionId: "worn",
      occurrence: 1,
    }))).toBeNull();
    expect(publicRendererFailure(decideAssetFallback({
      failure: "atlas-load",
      subjectId: null,
      regionId: null,
      occurrence: 1,
    }))).toEqual({
      kind: "asset",
      retryable: true,
      publicMessage: "Some world art could not be shown. Retry the world view.",
    });
  });
});
