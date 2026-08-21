import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import {
  createRegionMapIdentity,
  deriveRegionCondition,
  regionMapIdentityHash,
} from "./RegionMapIdentity";

const regions: RegionSnapshot[] = [
  region("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"], 0.2, 0.2, 120, 120),
  region("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"], 0.1, 0.1, 70, 70),
  region("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"], 0.05, 0, 50, 10),
  region("warm_springs", "hot spring lakes - the least-poor refuge", ["nirvana_west", "nirvana_east", "nirvana"], 0.25, 0.2, 130, 130),
];

describe("RegionMapIdentity", () => {
  it("derives all four stable identities and the neutral fallback", () => {
    expect(regions.map((item) => createRegionMapIdentity(42, item, regions).archetype)).toEqual([
      "worn_heartland", "dry_scrub", "ash_waste", "spring_terraces",
    ]);
    expect(createRegionMapIdentity(42, region("other", "an unfamiliar coast", [], 1, 1, 10, 10), regions))
      .toMatchObject({
        archetype: "neutral_temperate",
        diagnostics: [{
          code: "unknown-region",
          subjectId: null,
          regionId: "other",
          occurrence: 1,
        }],
      });
  });

  it("canonicalizes region and connection order into one static identity", () => {
    const target = { ...regions[0], connections: [...regions[0].connections].reverse() };
    const left = createRegionMapIdentity(9001, regions[0], regions);
    const right = createRegionMapIdentity(9001, target, [...regions].reverse());
    expect(right).toEqual(left);
    expect(regionMapIdentityHash(right)).toBe(regionMapIdentityHash(left));
    expect(left.directedTopology).toHaveLength(10);
  });

  it("keeps mutable pool levels out of identity and clamps condition separately", () => {
    const depleted = { ...regions[2], current_energy: -8, current_materials: 0 };
    const full = { ...regions[2], current_energy: 999, current_materials: 999 };
    expect(createRegionMapIdentity(7, depleted, regions)).toEqual(createRegionMapIdentity(7, full, regions));
    expect(deriveRegionCondition(depleted)).toMatchObject({ energyRatio: 0, materialsRatio: 0 });
    expect(deriveRegionCondition(full)).toMatchObject({ energyRatio: 1, materialsRatio: 1 });
  });

  it.each([
    [Number.NaN, 10, 0, "invalid-energy-abundance-ratio"],
    [Number.POSITIVE_INFINITY, 10, 1, "invalid-energy-abundance-ratio"],
    [5, Number.POSITIVE_INFINITY, 0, "invalid-energy-abundance-ratio"],
  ] as const)(
    "clamps non-finite energy %s/%s to %s with one bounded diagnostic",
    (currentEnergy, maxEnergy, expected, code) => {
      const condition = deriveRegionCondition({
        ...regions[0],
        current_energy: currentEnergy,
        max_energy: maxEnergy,
      });
      expect(condition.energyRatio).toBe(expected);
      expect(condition.diagnostics).toEqual([{
        code,
        subjectId: null,
        regionId: "nirvana",
        occurrence: 1,
      }]);
    },
  );

  it("bounds invalid pool diagnostics to one entry per resource", () => {
    const condition = deriveRegionCondition({
      ...regions[0],
      current_energy: Number.NaN,
      current_materials: Number.NEGATIVE_INFINITY,
      max_energy: 0,
      max_materials: 0,
    });
    expect(condition).toMatchObject({ energyRatio: 0, materialsRatio: 0 });
    expect(condition.diagnostics).toHaveLength(2);
    expect(new Set(condition.diagnostics?.map(({ code }) => code))).toEqual(new Set([
      "invalid-energy-abundance-ratio",
      "invalid-materials-abundance-ratio",
    ]));
  });
});

function region(
  name: string,
  description: string,
  connections: string[],
  energyRate: number,
  materialsRate: number,
  maxEnergy: number,
  maxMaterials: number,
): RegionSnapshot {
  return {
    name, description, connections, energy_rate: energyRate, materials_rate: materialsRate,
    current_energy: maxEnergy / 2, current_materials: maxMaterials / 2,
    max_energy: maxEnergy, max_materials: maxMaterials,
  };
}
