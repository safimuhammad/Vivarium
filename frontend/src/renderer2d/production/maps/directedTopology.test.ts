import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import {
  buildDirectedRegionEdges,
  createRegionGates,
  isTravelAuthorized,
} from "./directedTopology";

const oneWay: RegionSnapshot[] = [
  makeRegion("alpha", ["beta"]),
  makeRegion("beta", []),
];

describe("directed topology", () => {
  it("preserves authorization direction and never invents a reverse edge", () => {
    const edges = buildDirectedRegionEdges(oneWay);
    expect(edges).toEqual([{ from: "alpha", to: "beta" }]);
    expect(isTravelAuthorized(edges, "alpha", "beta")).toBe(true);
    expect(isTravelAuthorized(edges, "beta", "alpha")).toBe(false);
  });

  it("creates an origin departure and destination arrival for each directed edge", () => {
    const edges = buildDirectedRegionEdges(oneWay);
    const alpha = createRegionGates("alpha", edges, 32, 24);
    const beta = createRegionGates("beta", edges, 32, 24);
    expect(alpha).toEqual([
      expect.objectContaining({ edge: edges[0], role: "departure" }),
    ]);
    expect(beta).toEqual([
      expect.objectContaining({ edge: edges[0], role: "arrival" }),
    ]);
    expect(beta.some((gate) => gate.role === "departure" && gate.edge.to === "alpha")).toBe(false);
  });

  it("is byte-stable across region and connection input ordering", () => {
    const world = [makeRegion("a", ["c", "b"]), makeRegion("b", ["a"]), makeRegion("c", ["a"])];
    expect(buildDirectedRegionEdges(world)).toEqual(buildDirectedRegionEdges([
      { ...world[2], connections: [...world[2].connections].reverse() },
      { ...world[1], connections: [...world[1].connections].reverse() },
      { ...world[0], connections: [...world[0].connections].reverse() },
    ]));
  });

  it("allocates a distinct reachable perimeter lane to every touching edge role", () => {
    const spokes = Array.from({ length: 24 }, (_, index) => `spoke_${index}`);
    const graph = [makeRegion("hub", spokes), ...spokes.map((name) => makeRegion(name, ["hub"]))];
    const gates = createRegionGates("hub", buildDirectedRegionEdges(graph), 32, 24);
    expect(gates).toHaveLength(48);
    expect(new Set(gates.map((gate) => `${gate.tile.column},${gate.tile.row}`))).toHaveLength(48);
  });

  it("faces departures outward and arrivals inward at their perimeter", () => {
    const edges = buildDirectedRegionEdges(oneWay);
    const departure = createRegionGates("alpha", edges, 32, 24)[0];
    const arrival = createRegionGates("beta", edges, 32, 24)[0];
    expect(departure.facing).toBe(perimeterSide(departure.tile));
    expect(arrival.facing).toBe(opposite(perimeterSide(arrival.tile)));
  });
});

function perimeterSide(tile: { column: number; row: number }): "north" | "east" | "south" | "west" {
  if (tile.row === 1) return "north";
  if (tile.column === 30) return "east";
  if (tile.row === 22) return "south";
  return "west";
}

function opposite(side: "north" | "east" | "south" | "west"): "north" | "east" | "south" | "west" {
  return { north: "south", east: "west", south: "north", west: "east" }[side] as "north" | "east" | "south" | "west";
}

function makeRegion(name: string, connections: string[]): RegionSnapshot {
  return {
    name, connections, description: "unknown coast", energy_rate: 1, materials_rate: 1,
    current_energy: 5, current_materials: 5, max_energy: 10, max_materials: 10,
  };
}
