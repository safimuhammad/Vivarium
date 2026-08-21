import { describe, expect, it } from "vitest";

import {
  MIN_AGENT_SEPARATION_PX,
  homeRouteExclusionRects,
  spreadCoincidentTargets,
  syncArrivalPoint,
} from "./SpatialDirector";
import { PlacementLedger } from "./PlacementLedger";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import { productionRectsOverlap } from "../productionGeometry";
import type { AgentSnapshot, RegionSnapshot } from "../../../app/schemas";

describe("SpatialDirector.syncArrivalPoint", () => {
  it("delegates to PlacementLedger.updateAgentPoint so a completed walk refreshes the ledger's anchor", () => {
    const regions = [makeRegion("alpha", [])];
    const recipes = regions.map((region) => createRegionMapRecipe(createRegionMapIdentity(3, region, regions)));
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [agent(0, "alpha")] });
    const before = ledger.snapshot().agents.get("agent_000")!.point;
    const arrived = { x: before.x + 64, y: before.y };
    syncArrivalPoint(ledger, "agent_000", arrived);
    expect(ledger.snapshot().agents.get("agent_000")!.point).toEqual(arrived);
  });
});

describe("SpatialDirector.homeRouteExclusionRects", () => {
  it("excludes every home's footprint (margined) except its door threshold, across multiple homes", () => {
    const homes = [{ plot: { x: 0, y: 0 } }, { plot: { x: 500, y: 500 } }];
    const rects = homeRouteExclusionRects(homes);
    // A wall point of each home is excluded.
    expect(rects.some((rect) => productionRectsOverlap(rect, { x: 5, y: 5, width: 1, height: 1 }))).toBe(true);
    expect(rects.some((rect) => productionRectsOverlap(rect, { x: 505, y: 505, width: 1, height: 1 }))).toBe(true);
    // Far from both homes is clear.
    expect(rects.some((rect) => productionRectsOverlap(rect, { x: 250, y: 250, width: 1, height: 1 }))).toBe(false);
  });

  it("returns no rects for no homes", () => {
    expect(homeRouteExclusionRects([])).toEqual([]);
  });
});

describe("SpatialDirector.spreadCoincidentTargets", () => {
  const alwaysLegal = (): boolean => true;

  it("leaves a single, non-colliding target untouched", () => {
    const targets = new Map([["a", { x: 10, y: 10 }]]);
    const result = spreadCoincidentTargets(targets, alwaysLegal);
    expect(result.get("a")).toEqual({ x: 10, y: 10 });
  });

  it("leaves distinct, well-separated targets untouched", () => {
    const targets = new Map([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 1000, y: 1000 }],
    ]);
    const result = spreadCoincidentTargets(targets, alwaysLegal);
    expect(result.get("a")).toEqual({ x: 0, y: 0 });
    expect(result.get("b")).toEqual({ x: 1000, y: 1000 });
  });

  it("spreads two participants sharing an identical target onto distinct legal points", () => {
    const shared = { x: 400, y: 300 };
    const targets = new Map([
      ["raider_a", shared],
      ["raider_b", shared],
    ]);
    const result = spreadCoincidentTargets(targets, alwaysLegal);
    const pointA = result.get("raider_a")!;
    const pointB = result.get("raider_b")!;
    expect(pointA).not.toEqual(pointB);
    // At least one of the two keeps the true anchor (e.g. the primary actor
    // stays exactly at the home's door); the other is displaced.
    expect([pointA, pointB]).toContainEqual(shared);
    // The two resolved points clear the standing-envelope separation gap.
    const horizontalGap = Math.abs(pointA.x - pointB.x);
    const verticalGap = Math.abs(pointA.y - pointB.y);
    expect(horizontalGap >= MIN_AGENT_SEPARATION_PX.x || verticalGap >= MIN_AGENT_SEPARATION_PX.y).toBe(true);
  });

  it("is deterministic: the same input always spreads the same way, independent of map insertion order", () => {
    const shared = { x: 100, y: 100 };
    const forward = new Map([["z_agent", shared], ["a_agent", shared]]);
    const backward = new Map([["a_agent", shared], ["z_agent", shared]]);
    const left = spreadCoincidentTargets(forward, alwaysLegal);
    const right = spreadCoincidentTargets(backward, alwaysLegal);
    expect(left.get("a_agent")).toEqual(right.get("a_agent"));
    expect(left.get("z_agent")).toEqual(right.get("z_agent"));
  });

  it("spreads a larger group (e.g. a multi-raider home breach) onto that many distinct legal points", () => {
    const door = { x: 200, y: 200 };
    const targets = new Map([
      ["raider_1", door],
      ["raider_2", door],
      ["raider_3", door],
      ["raider_4", door],
      ["raider_5", door],
    ]);
    const result = spreadCoincidentTargets(targets, alwaysLegal);
    const points = [...result.values()];
    const keys = new Set(points.map((point) => `${point.x},${point.y}`));
    expect(keys.size).toBe(5);
  });

  it("skips illegal ring candidates and falls back to the original target when no legal slot exists", () => {
    const shared = { x: 0, y: 0 };
    const targets = new Map([["a", shared], ["b", shared]]);
    const result = spreadCoincidentTargets(targets, () => false);
    // With no legal ring slot at all, the displaced participant keeps its
    // original (overlapping) target rather than vanishing from the map.
    expect(result.size).toBe(2);
    expect([...result.values()]).toEqual([shared, shared]);
  });

  it("treats near-but-not-identical targets closer than a standing envelope as coincident too", () => {
    const targets = new Map([
      ["a", { x: 100, y: 100 }],
      ["b", { x: 105, y: 100 }], // well within MIN_AGENT_SEPARATION_PX.x
    ]);
    const result = spreadCoincidentTargets(targets, alwaysLegal);
    const pointA = result.get("a")!;
    const pointB = result.get("b")!;
    const horizontalGap = Math.abs(pointA.x - pointB.x);
    const verticalGap = Math.abs(pointA.y - pointB.y);
    expect(horizontalGap >= MIN_AGENT_SEPARATION_PX.x || verticalGap >= MIN_AGENT_SEPARATION_PX.y).toBe(true);
  });
});

function makeRegion(name: string, connections: string[]): RegionSnapshot {
  return {
    name, connections, description: "test region",
    energy_rate: 1, materials_rate: 1, current_energy: 50, current_materials: 50,
    max_energy: 100, max_materials: 100,
  };
}

function agent(index: number, position: string): AgentSnapshot {
  return {
    id: `agent_${index.toString().padStart(3, "0")}`, name: `Agent ${index}`, persona: "",
    position, energy: 20, materials: 10, status: "alive", last_mated_at: null,
    offspring_count: 0, died_at: null, home_id: null, is_hoarding: false,
  };
}
