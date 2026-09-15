import { describe, expect, it } from "vitest";
import type { RegionSnapshot } from "../../../app/schemas";
import { TILE_SIZE } from "../../map/regionMap";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createProductionRegionMapRecipe } from "../maps/ProductionRegionMapRecipe";
import { findNavigationPath } from "./navigation";
import {
  createSpatialNavigationBundle,
  createSpatialNavigationExport,
  navigationLayoutFingerprint,
} from "./SpatialNavigationExport";

const regions: readonly RegionSnapshot[] = [
  makeRegion(
    "nirvana",
    "a once-heavenly landscape, now thinning and picked-over",
    ["warm_springs", "nirvana_east", "nirvana_west"],
  ),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  makeRegion("warm_springs", "hot spring lakes", ["nirvana_west", "nirvana_east", "nirvana"]),
];

const pressures = {
  nirvana: { populationHighWater: 4, builtFootprintHighWater: 0 },
  nirvana_east: { populationHighWater: 8, builtFootprintHighWater: 1 },
  nirvana_west: { populationHighWater: 2, builtFootprintHighWater: 0 },
  warm_springs: { populationHighWater: 16, builtFootprintHighWater: 3 },
} as const;

describe("production spatial navigation export", () => {
  it("exports real terrain and stable, open destinations from the same frozen recipe", () => {
    const region = { name: "nirvana", description: "a once-heavenly landscape, now thinning and picked-over", connections: [], energy_rate: 0.2, materials_rate: 0.2, current_energy: 40, current_materials: 40, max_energy: 100, max_materials: 100 };
    const pressure = { populationHighWater: 4, builtFootprintHighWater: 0 };
    const recipe = createProductionRegionMapRecipe(createRegionMapIdentity(41, region, [region]), pressure);
    const collisionBefore = Uint8Array.from(recipe.grid.collision);
    const exported = createSpatialNavigationExport(recipe, pressure);
    expect(recipe.grid.collision).toEqual(collisionBefore);
    expect(exported.layout_fingerprint).toBe(navigationLayoutFingerprint(recipe));
    expect(exported).toEqual(createSpatialNavigationExport(recipe, pressure));
    expect(exported.landmarks.some((site) => site.affordances.includes("energy"))).toBe(true);
    expect(exported.landmarks.some((site) => site.affordances.includes("materials"))).toBe(true);
    for (const point of [...exported.spawn_points, ...exported.landmarks]) {
      const column = Math.floor(point.x / 32), row = Math.floor(point.y / 32);
      expect(exported.walkable[row]?.[column]).toBe(1);
    }
    recipe.grid.collision.forEach((blocked, index) => {
      if (blocked) expect(exported.walkable[Math.floor(index / recipe.grid.columns)]?.[index % recipe.grid.columns]).toBe(0);
    });
  });

  it.each([7, 41, 229])(
    "exports every configured production region with reachable gates and gathering anchors at seed %s",
    (seed) => {
      const maps = regions.map((region) => {
        const recipe = createProductionRegionMapRecipe(
          createRegionMapIdentity(seed, region, regions),
          pressures[region.name as keyof typeof pressures],
        );
        return { recipe, initialPressure: pressures[region.name as keyof typeof pressures] };
      });
      const bundle = createSpatialNavigationBundle(maps);

      expect(bundle.version).toBe(2);
      expect(bundle.regions.map(({ region_id }) => region_id)).toEqual(
        regions.map(({ name }) => name),
      );
      expect(bundle.regions.map(({ gates }) => gates.length)).toEqual([6, 4, 4, 6]);
      const west = bundle.regions.find(({ region_id }) => region_id === "nirvana_west");
      expect(west?.initial_pressure).toEqual(pressures.nirvana_west);
      expect(west?.landmarks.filter((landmark) => landmark.affordances.includes("materials")))
        .not.toHaveLength(0);

      for (const exported of bundle.regions) {
        const recipe = maps.find(({ recipe: candidate }) => candidate.regionId === exported.region_id)?.recipe;
        expect(recipe).toBeDefined();
        expect(exported.gates).toEqual(recipe?.gates.map((gate) => ({
          from_region: gate.edge.from,
          to_region: gate.edge.to,
          role: gate.role,
          ...center(gate.tile),
        })));
        const start = tileForPoint(exported.spawn_points[0]!);
        const grid = {
          columns: exported.width,
          rows: exported.height,
          collision: Uint8Array.from(exported.walkable.flat().map((cell) => cell === 1 ? 0 : 1)),
          topology: "bounded" as const,
        };
        expect(exported.spawn_points.length).toBeGreaterThan(0);
        const gathering = exported.landmarks.filter((landmark) =>
          landmark.affordances.includes("energy") || landmark.affordances.includes("materials"));
        expect(gathering.length).toBeGreaterThan(0);

        for (const point of [
          ...exported.spawn_points,
          ...gathering,
          ...exported.gates,
        ]) {
          const tile = tileForPoint(point);
          expect(exported.walkable[tile.row]?.[tile.column], `${exported.region_id} ${tile.column},${tile.row}`)
            .toBe(1);
          expect(findNavigationPath(grid, { start, goal: tile }).status)
            .toBe("reached");
        }

        for (const gate of exported.gates) {
          const expectedLandmarkId = gate.role === "departure"
            ? `gate-${gate.to_region}`
            : `arrival-${gate.from_region}`;
          const landmark = exported.landmarks.find(({ id }) => id === expectedLandmarkId);
          expect(landmark, `${exported.region_id} ${expectedLandmarkId}`).toBeDefined();
          expect(landmark?.affordances).toContain(gate.role === "departure" ? "exit" : "entrance");
          expect(landmark).toMatchObject({ x: gate.x, y: gate.y });
        }
      }
    },
  );

  it("fails loudly when a required anchor is missing or blocked", () => {
    const region = regions[0]!;
    const pressure = pressures.nirvana;
    const recipe = createProductionRegionMapRecipe(
      createRegionMapIdentity(41, region, regions),
      pressure,
    );

    expect(() => createSpatialNavigationExport({ ...recipe, spawnAnchors: [] }, pressure))
      .toThrow(/spawn anchor/i);

    expect(() => createSpatialNavigationExport({
      ...recipe,
      arrivalAnchors: recipe.arrivalAnchors.slice(1),
    }, pressure)).toThrow(/arrival anchors/i);

    const blockedSpawn = recipe.spawnAnchors[0]!;
    const collision = Uint8Array.from(recipe.grid.collision);
    collision[blockedSpawn.row * recipe.grid.columns + blockedSpawn.column] = 1;
    expect(() => createSpatialNavigationExport({
      ...recipe,
      grid: { ...recipe.grid, collision },
    }, pressure)).toThrow(/anchor/i);
  });
});

function makeRegion(name: string, description: string, connections: string[]): RegionSnapshot {
  return {
    name,
    description,
    connections,
    energy_rate: name === "nirvana_west" ? 0.05 : 0.2,
    materials_rate: name === "nirvana_west" ? 0 : 0.2,
    current_energy: 40,
    current_materials: name === "nirvana_west" ? 0 : 40,
    max_energy: 100,
    max_materials: 100,
  };
}

function tileForPoint(point: { readonly x: number; readonly y: number }): { column: number; row: number } {
  return { column: Math.floor(point.x / TILE_SIZE), row: Math.floor(point.y / TILE_SIZE) };
}

function center(tile: { readonly column: number; readonly row: number }): { x: number; y: number } {
  return { x: tile.column * TILE_SIZE + TILE_SIZE / 2, y: tile.row * TILE_SIZE + TILE_SIZE / 2 };
}
