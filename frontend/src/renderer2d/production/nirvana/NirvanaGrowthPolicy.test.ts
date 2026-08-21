import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { createNirvanaRegionMapRecipe } from "./NirvanaRegionMapRecipe";
import {
  MAX_NIRVANA_REQUIRED_DISTRICTS,
  planNirvanaGrowth,
} from "./NirvanaGrowthPolicy";

const regions: readonly RegionSnapshot[] = [
  {
    name: "nirvana",
    description: "a once-heavenly landscape, now thinning and picked-over",
    connections: ["warm_springs"],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  },
  {
    name: "warm_springs",
    description: "hot spring lakes",
    connections: ["nirvana"],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  },
];

function baseRecipe(): RegionMapRecipeV1 {
  return createNirvanaRegionMapRecipe(
    createRegionMapIdentity(401, regions[0]!, regions),
  );
}

describe("NirvanaGrowthPolicy", () => {
  it("derives the no-growth capacity from the actual uniform Genesis districts", () => {
    const plan = planNirvanaGrowth(baseRecipe(), {
      populationHighWater: 0,
      builtFootprintHighWater: 0,
    });

    expect(plan).toMatchObject({
      regionId: "nirvana",
      algorithmVersion: 1,
      growthVersion: 0,
      baseChunkColumns: 2,
      baseChunkRows: 3,
      targetChunkColumns: 2,
      targetChunkRows: 3,
      targetTileColumns: 96,
      targetTileRows: 96,
      baseDistrictCount: 8,
      requiredDistrictCount: 8,
      capacity: {
        populationPerDistrict: 32,
        builtFootprintPerDistrict: 16,
        reservedDistrictCount: 1,
        basePopulationWithoutReserve: 224,
        baseBuiltFootprintWithoutReserve: 112,
      },
    });
    expect(plan.addedChunkCoords).toEqual([]);
    expect(plan.growthHash).toMatch(/^[0-9a-f]{8}$/);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.capacity)).toBe(true);
    expect(Object.isFrozen(plan.addedChunkCoords)).toBe(true);
  });

  it("holds the reserve at the exact boundary and adds the complete south strip above it", () => {
    const recipe = baseRecipe();
    const populationBoundary = planNirvanaGrowth(recipe, {
      populationHighWater: 224,
      builtFootprintHighWater: 112,
    });
    const populationGrowth = planNirvanaGrowth(recipe, {
      populationHighWater: 225,
      builtFootprintHighWater: 112,
    });
    const builtGrowth = planNirvanaGrowth(recipe, {
      populationHighWater: 224,
      builtFootprintHighWater: 113,
    });

    expect(populationBoundary.addedChunkCoords).toEqual([]);
    for (const plan of [populationGrowth, builtGrowth]) {
      expect(plan.requiredDistrictCount).toBe(9);
      expect(plan.targetChunkColumns).toBe(2);
      expect(plan.targetChunkRows).toBe(4);
      expect(plan.addedChunkCoords).toEqual([
        { column: 0, row: 3 },
        { column: 1, row: 3 },
      ]);
      expect(plan.growthVersion).toBe(2);
      expect(plan.capacity.targetDistrictCount).toBe(10);
    }
    expect(populationGrowth.growthHash).toBe(builtGrowth.growthHash);
  });

  it("chooses the physically squarer east strip for the next pressure tier", () => {
    const plan = planNirvanaGrowth(baseRecipe(), {
      populationHighWater: 289,
      builtFootprintHighWater: 0,
    });

    expect(plan.requiredDistrictCount).toBe(11);
    expect(plan.targetChunkColumns).toBe(3);
    expect(plan.targetChunkRows).toBe(4);
    expect(plan.addedChunkCoords).toEqual([
      { column: 0, row: 3 },
      { column: 1, row: 3 },
      { column: 2, row: 0 },
      { column: 2, row: 1 },
      { column: 2, row: 2 },
      { column: 2, row: 3 },
    ]);
    expect(plan.capacity.targetDistrictCount).toBe(14);
  });

  it("produces complete rectangular strips with no holes at every bounded tier", () => {
    const recipe = baseRecipe();
    for (const populationHighWater of [225, 289, 417, 609, 865]) {
      const plan = planNirvanaGrowth(recipe, {
        populationHighWater,
        builtFootprintHighWater: 0,
      });
      const occupied = new Set<string>([
        "0,0", "1,0", "0,1", "1,1", "0,2", "1,2",
        ...plan.addedChunkCoords.map(({ column, row }) => `${column},${row}`),
      ]);
      expect(occupied.size).toBe(plan.targetChunkColumns * plan.targetChunkRows);
      for (let row = 0; row < plan.targetChunkRows; row += 1) {
        for (let column = 0; column < plan.targetChunkColumns; column += 1) {
          expect(occupied.has(`${column},${row}`), `${column},${row}`).toBe(true);
        }
      }
    }
  });

  it("is deterministic across equivalent object order and keeps a prior larger plan", () => {
    const recipe = baseRecipe();
    const first = planNirvanaGrowth(recipe, {
      populationHighWater: 225,
      builtFootprintHighWater: 0,
    });
    const reordered = planNirvanaGrowth(recipe, {
      builtFootprintHighWater: 0,
      populationHighWater: 225,
    });
    const larger = planNirvanaGrowth(recipe, {
      populationHighWater: 289,
      builtFootprintHighWater: 0,
    });
    const lowerAfterLarger = planNirvanaGrowth(
      recipe,
      { populationHighWater: 1, builtFootprintHighWater: 1 },
      larger,
    );

    expect(reordered).toEqual(first);
    expect(lowerAfterLarger.targetChunkColumns).toBe(larger.targetChunkColumns);
    expect(lowerAfterLarger.targetChunkRows).toBe(larger.targetChunkRows);
    expect(lowerAfterLarger.addedChunkCoords).toEqual(larger.addedChunkCoords);
    expect(lowerAfterLarger.growthHash).toBe(larger.growthHash);
    expect(lowerAfterLarger.pressure).toEqual({
      populationHighWater: larger.pressure.populationHighWater,
      builtFootprintHighWater: 1,
    });
  });

  it("rejects malformed pressure and boundedly rejects unreasonable demand", () => {
    const recipe = baseRecipe();
    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => planNirvanaGrowth(recipe, {
        populationHighWater: invalid,
        builtFootprintHighWater: 0,
      })).toThrow(/population.*non-negative safe integer/i);
    }
    expect(() => planNirvanaGrowth(recipe, {
      populationHighWater: MAX_NIRVANA_REQUIRED_DISTRICTS * 32,
      builtFootprintHighWater: 0,
    })).toThrow(/unreasonable.*district/i);
  });

  it("rejects a non-Nirvana, malformed-grid, or non-uniform district recipe", () => {
    const recipe = baseRecipe();
    expect(() => planNirvanaGrowth(
      { ...recipe, regionId: "warm_springs" },
      { populationHighWater: 0, builtFootprintHighWater: 0 },
    )).toThrow(/exact nirvana/i);
    expect(() => planNirvanaGrowth(
      { ...recipe, grid: { ...recipe.grid, columns: 95 } },
      { populationHighWater: 0, builtFootprintHighWater: 0 },
    )).toThrow(/2x3.*chunk/i);
    const unevenDistrict = {
      ...recipe.districts[1]!,
      stagingPoints: recipe.districts[1]!.stagingPoints.slice(1),
    };
    expect(() => planNirvanaGrowth(
      { ...recipe, districts: [recipe.districts[0]!, unevenDistrict, ...recipe.districts.slice(2)] },
      { populationHighWater: 0, builtFootprintHighWater: 0 },
    )).toThrow(/uniform.*capacity/i);
  });
});
