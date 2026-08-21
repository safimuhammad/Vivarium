import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "./RegionMapIdentity";
import {
  createRegionMapRecipe,
  regionMapRecipeHash,
  serializeRegionMapRecipe,
} from "./RegionMapRecipe";
import {
  createProductionRegionMapRecipe,
  parseProductionRegionMapRecipe,
} from "./ProductionRegionMapRecipe";

const regions: readonly RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs"]),
  makeRegion("warm_springs", "hot spring lakes", ["nirvana"]),
  makeRegion("Nirvana", "a once-heavenly landscape, now thinning and picked-over", []),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", []),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", []),
];

describe("ProductionRegionMapRecipe", () => {
  it("selects the dedicated builder for each exact lowercase region only", () => {
    const exactIdentity = createRegionMapIdentity(401, regions[0]!, regions);
    const springsIdentity = createRegionMapIdentity(401, regions[1]!, regions);
    const caseVariantIdentity = createRegionMapIdentity(401, regions[2]!, regions);
    const satelliteIdentity = createRegionMapIdentity(401, regions[3]!, regions);

    expect(createProductionRegionMapRecipe(exactIdentity).presentationProfile)
      .toMatchObject({ kind: "nirvana-v2", atlasProfileVersion: 2 });
    expect(createProductionRegionMapRecipe(springsIdentity).presentationProfile)
      .toMatchObject({ kind: "warm-springs-v1", atlasProfileVersion: 2 });
    expect(createProductionRegionMapRecipe(caseVariantIdentity).presentationProfile)
      .toBeUndefined();
    // RE-BASELINED for the approved Nirvana East "Butte Country" integration
    // (`.superpowers/sdd/nirvana-east-live-report.md`; owner approval "NIRVANA EAST =
    // composition B, Butte Country"). `nirvana_east` used to be the SATELLITE case here —
    // the region asserted to carry no exact profile. It now has an exact builder.
    expect(createProductionRegionMapRecipe(satelliteIdentity).presentationProfile)
      .toMatchObject({ kind: "nirvana-east-v1", atlasProfileVersion: 2 });
    // RE-BASELINED AGAIN for the approved Nirvana West "Ember Rift" integration
    // (`.superpowers/sdd/nirvana-west-live-report.md`). All four production regions now
    // have exact builders, so no lowercase region is left to carry the satellite role.
    // `caseVariantIdentity` above is what now holds the "exact LOWERCASE only" half of
    // this test's contract, and it is the stronger of the two cases: it proves the
    // dispatch is an exact string match rather than a case-insensitive one.
    expect(createProductionRegionMapRecipe(
      createRegionMapIdentity(401, regions[4]!, regions),
    ).presentationProfile).toMatchObject({ kind: "nirvana-west-v1", atlasProfileVersion: 2 });
    // Explicit budget: this case now builds all FOUR exact regions, each of which
    // authors a full terrain scene (Nirvana West's alone is ~670 ms cold). Measured at
    // 5,176 ms inside the parallel suite against vitest's 5,000 ms default — i.e. it was
    // failing on scheduling, not on anything it asserts. 30 s is generous headroom for
    // four scene builds and still catches a real order-of-magnitude regression.
  }, 30_000);

  /**
   * RE-BASELINED for the approved Warm Springs "Great Terrace" integration
   * (`.superpowers/sdd/warm-springs-live-report.md`; owner approval "for warm springs i
   * approve B-great terrace").
   *
   * `warm_springs` now has an exact builder, so it is no longer byte-identical to the
   * generic recipe — its `grid.collision` carries the terrace's blocking terrain and it
   * gains a `presentationProfile`. It is asserted separately below against the exact
   * property that DOES still hold: everything except collision and the profile is passed
   * through from the generic recipe unchanged. Every other non-exact identity is still
   * delegated byte for byte.
   */
  it("delegates every non-exact identity without changing bytes or hashes", () => {
    // RE-BASELINED: `nirvana_east` joins the exact set for the approved Butte Country
    // integration, and `nirvana_west` for the approved Ember Rift integration. Both are
    // asserted separately below against the property that DOES still hold — everything
    // except collision and the profile is passed through from the generic recipe
    // unchanged. The case-variant `Nirvana` is what still exercises byte-for-byte
    // delegation here, and it is the case that matters: a region the dispatch must NOT
    // claim.
    const exact = new Set(["nirvana", "warm_springs", "nirvana_east", "nirvana_west"]);
    for (const region of regions.filter(({ name }) => !exact.has(name))) {
      const identity = createRegionMapIdentity(229, region, regions);
      const generic = createRegionMapRecipe(identity);
      const production = createProductionRegionMapRecipe(identity);
      expect(serializeRegionMapRecipe(production), region.name)
        .toBe(serializeRegionMapRecipe(generic));
      expect(regionMapRecipeHash(production), region.name).toBe(regionMapRecipeHash(generic));
    }
  });

  it.each([
    ["warm_springs", 1, 0],
    // The additive Butte Country integration. Its allowance of up to 4 re-opened tiles is
    // the toroidal walk seam: Nirvana East re-derives its seam pair AFTER the terrain
    // unions in (one reciprocal pair per axis = at most 4 rim tiles), because the union
    // may well have re-closed whichever pair the generic recipe opened. Warm Springs
    // re-derives too but its seam happened to survive unchanged at this seed.
    ["nirvana_east", 3, 4],
  ] as const)("changes only collision and the presentation profile for exact %s", (
    _name,
    regionIndex,
    reopenAllowance,
  ) => {
    const identity = createRegionMapIdentity(229, regions[regionIndex]!, regions);
    const generic = createRegionMapRecipe(identity);
    const production = createProductionRegionMapRecipe(identity);

    const strip = (recipe: ReturnType<typeof createRegionMapRecipe>): string => {
      const value = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, unknown>;
      delete value.presentationProfile;
      delete value.grid;
      return JSON.stringify(value);
    };
    expect(strip(production)).toBe(strip(generic));
    expect(production.grid.columns).toBe(generic.grid.columns);
    expect(production.grid.rows).toBe(generic.grid.rows);
    // Terrain may only ever CLOSE ground, apart from the declared walk-seam allowance.
    let opened = 0;
    let closed = 0;
    for (let index = 0; index < generic.grid.collision.length; index += 1) {
      const before = generic.grid.collision[index]!;
      const after = production.grid.collision[index]!;
      if (before === 1 && after === 0) opened += 1;
      if (before === 0 && after === 1) closed += 1;
    }
    expect(opened).toBeLessThanOrEqual(reopenAllowance);
    expect(closed).toBeGreaterThan(0);
  });

  /**
   * The additive Ember Rift integration. Nirvana West is deliberately NOT in the
   * `it.each` table above, because it replaces a SECOND field the other two exact
   * regions leave alone: `animatedEnvironment`. The generic rule places 4 flames per
   * district anchor out in the rim `LANDSCAPE_SECTORS`, which for this region means fire
   * on cold bare slate, 32 of it, none of it on molten ground and none of it anywhere
   * near the middle of the region — so its builder replaces the whole field with its own
   * exact budget, placed from the terrain. What must still hold, and is asserted here, is
   * that this is the ONLY extra field it touches, and that its budget is a fixed number
   * `validateCompositionDensity` checks as an equality.
   */
  it("changes only collision, the presentation profile and animated placement for exact nirvana_west", () => {
    const identity = createRegionMapIdentity(229, regions[4]!, regions);
    const generic = createRegionMapRecipe(identity);
    const production = createProductionRegionMapRecipe(identity);

    const strip = (recipe: ReturnType<typeof createRegionMapRecipe>): string => {
      const value = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, unknown>;
      delete value.presentationProfile;
      delete value.grid;
      delete value.animatedEnvironment;
      return JSON.stringify(value);
    };
    expect(strip(production)).toBe(strip(generic));

    // DELIBERATE RE-BASELINE. The first rule kept the generic 32 placements and only
    // moved their tiles; measured on the shipped region that left all 32 inside the rim
    // `LANDSCAPE_SECTORS` and NOT ONE on live crust, because it demanded a
    // collision-open tile and `ember` blocks. The region now declares its own exact
    // budget in `EXACT_ANIMATED_ENVIRONMENT_BUDGETS` and mints its own ids. Still an
    // EQUALITY, never a range — which is what keeps the invariant able to catch a region
    // that emits one.
    expect(production.animatedEnvironment).toHaveLength(384);
    expect(generic.animatedEnvironment).toHaveLength(32);
    expect(new Set(production.animatedEnvironment.map((placement) => placement.id)).size)
      .toBe(production.animatedEnvironment.length);
    for (const placement of production.animatedEnvironment) {
      expect(["ember", "smoke-anchor"], placement.id).toContain(placement.kind);
    }

    // Terrain may only ever CLOSE ground, apart from the toroidal walk-seam allowance:
    // Nirvana West re-derives its seam pair AFTER the rift's blocking terrain unions in
    // (`applyWrapSeams`), so at most one reciprocal pair per axis — 4 rim tiles.
    expect(production.grid.columns).toBe(generic.grid.columns);
    expect(production.grid.rows).toBe(generic.grid.rows);
    let opened = 0;
    let closed = 0;
    for (let index = 0; index < generic.grid.collision.length; index += 1) {
      const before = generic.grid.collision[index]!;
      const after = production.grid.collision[index]!;
      if (before === 1 && after === 0) opened += 1;
      if (before === 0 && after === 1) closed += 1;
    }
    expect(opened).toBeLessThanOrEqual(4);
    expect(closed).toBeGreaterThan(0);
  });

  it("round-trips Nirvana through production parse authority and rejects scene-hash drift", () => {
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const recipe = createProductionRegionMapRecipe(identity);
    const serialized = serializeRegionMapRecipe(recipe);
    const parsed = parseProductionRegionMapRecipe(serialized, identity);

    expect(parsed).toEqual(recipe);
    expect(parsed).not.toBe(recipe);
    expect(parsed.grid.collision).not.toBe(recipe.grid.collision);

    const hostile = JSON.parse(serialized) as Record<string, any>;
    hostile.presentationProfile.staticSceneHash = hostile.presentationProfile.staticSceneHash === "00000000"
      ? "00000001"
      : "00000000";
    expect(() => parseProductionRegionMapRecipe(JSON.stringify(hostile), identity))
      .toThrow(/canonical deterministic fields|static scene hash/i);
  });

  it("round-trips only against the exact supplied Nirvana growth tier", () => {
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const firstTier = { populationHighWater: 225, builtFootprintHighWater: 0 };
    const recipe = createProductionRegionMapRecipe(identity, firstTier);
    const serialized = serializeRegionMapRecipe(recipe);

    expect(parseProductionRegionMapRecipe(serialized, identity, firstTier)).toEqual(recipe);
    expect(() => parseProductionRegionMapRecipe(serialized, identity, {
      populationHighWater: 224,
      builtFootprintHighWater: 112,
    })).toThrow(/canonical deterministic fields/i);
    expect(() => parseProductionRegionMapRecipe(serialized, identity, {
      populationHighWater: 289,
      builtFootprintHighWater: 0,
    })).toThrow(/canonical deterministic fields/i);

    const secondTier = { populationHighWater: 289, builtFootprintHighWater: 0 };
    const secondRecipe = createProductionRegionMapRecipe(identity, secondTier);
    expect(parseProductionRegionMapRecipe(
      serializeRegionMapRecipe(secondRecipe),
      identity,
      secondTier,
    )).toEqual(secondRecipe);
  });

  it("rejects a legacy generic Nirvana recipe instead of silently dropping the exact profile", () => {
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const legacyGeneric = createRegionMapRecipe(identity);

    expect(legacyGeneric.presentationProfile).toBeUndefined();
    expect(() => parseProductionRegionMapRecipe(
      serializeRegionMapRecipe(legacyGeneric),
      identity,
    )).toThrow(/canonical deterministic fields/i);
  });

  it("returns isolated Nirvana values on deterministic reconstruction", () => {
    const identity = createRegionMapIdentity(401, regions[0]!, regions);
    const first = createProductionRegionMapRecipe(identity);
    const second = createProductionRegionMapRecipe(identity);

    expect(serializeRegionMapRecipe(second)).toBe(serializeRegionMapRecipe(first));
    expect(second.grid.collision).not.toBe(first.grid.collision);
    expect(second.pathMask).not.toBe(first.pathMask);
    expect(second.shelterPlots).not.toBe(first.shelterPlots);
    expect(second.presentationProfile).not.toBe(first.presentationProfile);
  });
});

function makeRegion(
  name: string,
  description: string,
  connections: readonly string[],
): RegionSnapshot {
  return {
    name,
    description,
    connections: [...connections],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  };
}
