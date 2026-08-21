import { describe, expect, it } from "vitest";

import {
  certifiedProductionRouteBudgetMs,
  conservativeProductionRouteTurnCount,
} from "./productionLocomotionTiming";

describe("production locomotion timing", () => {
  it("rejects a collision-open multi-turn route that distance-only timing would admit", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: 48, y: 32 },
      { x: 96, y: 32 },
      { x: 96, y: 16 },
    ] as const;

    const distanceOnlyMs = 144 / 48 * 1_000;
    expect(distanceOnlyMs).toBeLessThan(3_100);
    expect(conservativeProductionRouteTurnCount(route)).toBe(4);
    expect(certifiedProductionRouteBudgetMs(route, 48)).toBeGreaterThan(3_100);
  });

  it("charges two stationary boundary ticks per turn and one endpoint stop tick", () => {
    const straight = [{ x: 0, y: 0 }, { x: 48, y: 0 }] as const;
    const bent = [...straight, { x: 48, y: 48 }] as const;
    const certifiedFrameMs = Math.ceil(1_000 / 30);

    expect(conservativeProductionRouteTurnCount(straight)).toBe(1);
    expect(conservativeProductionRouteTurnCount(bent)).toBe(2);
    expect(certifiedProductionRouteBudgetMs(bent, 48) - certifiedProductionRouteBudgetMs(straight, 48))
      .toBeGreaterThanOrEqual(1_000 + 2 * certifiedFrameMs);
  });

  it("returns zero for a route without a traversable segment", () => {
    expect(certifiedProductionRouteBudgetMs([], 48)).toBe(0);
    expect(certifiedProductionRouteBudgetMs([{ x: 4, y: 8 }], 48)).toBe(0);
  });

  it("rejects a non-positive or non-finite speed at the boundary", () => {
    const route = [{ x: 0, y: 0 }, { x: 16, y: 0 }] as const;
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => certifiedProductionRouteBudgetMs(route, speed)).toThrow(
        "Production route speed must be finite and positive.",
      );
    }
  });
});
