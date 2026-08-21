/**
 * @fileoverview Fail-closed coverage for the Nirvana West static-scene provider.
 *
 * Mirrors `warmSprings/WarmSpringsStaticSceneProvider.test.ts` in shape: the published
 * art's own byte-level pins live in `NirvanaWestAssetProfile.test.ts` (a sibling module
 * this file does not own), so this file is scoped entirely to the PROVIDER — every one
 * of its fail-closed rejection paths, plus the shape of the paint plan it produces
 * against the real recipe and the real published atlas.
 */

import { describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { PRODUCTION_ASSET_MANIFEST, type ProductionAssetLease } from "../assets/productionManifest";
import { productionAtlasIdsForRegion } from "../assets/ProductionRegionAssets";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe, type RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import {
  createNirvanaWestProductionManifest,
  NIRVANA_WEST_ATLAS_PROFILE,
} from "./NirvanaWestAssetProfile";
import { createNirvanaWestRegionMapRecipe } from "./NirvanaWestRegionMapRecipe";
import {
  createNirvanaWestStaticScenePlan,
  describeNirvanaWestStaticScene,
  NIRVANA_WEST_STATIC_SCENE_PROVIDER,
} from "./NirvanaWestStaticSceneProvider";

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

const WORLD: readonly RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_west"]),
  makeRegion("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana", "nirvana_west"]),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
];

function leases(): Map<string, ProductionAssetLease> {
  return new Map<string, ProductionAssetLease>([
    [NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId,
      { value: { width: 512, height: 960 } as ImageBitmap, release: vi.fn() }],
    [NIRVANA_WEST_ATLAS_PROFILE.sceneryAtlasId,
      { value: { width: 640, height: 1600 } as ImageBitmap, release: vi.fn() }],
  ]);
}

const identity = createRegionMapIdentity(701, WORLD[2]!, WORLD);

/** A recipe cast just enough to exercise one rejected field, never a real sidecar. */
function fixtureVariant(
  base: RegionMapRecipeV1,
  overrides: Readonly<Record<string, unknown>>,
): RegionMapRecipeV1 {
  return { ...base, ...overrides } as RegionMapRecipeV1;
}

describe("NirvanaWestAssetProfile manifest wiring", () => {
  it("leases the exact atlases only for exact Nirvana West", () => {
    const manifest = createNirvanaWestProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    expect(productionAtlasIdsForRegion(manifest, recipe))
      .toEqual(expect.arrayContaining([
        NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId,
        NIRVANA_WEST_ATLAS_PROFILE.sceneryAtlasId,
      ]));

    const generic = createRegionMapRecipe(identity);
    expect(productionAtlasIdsForRegion(manifest, generic))
      .not.toEqual(expect.arrayContaining([NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId]));
  });
});

describe("NirvanaWestStaticSceneProvider", () => {
  it("is registered under its own profile kind", () => {
    expect(NIRVANA_WEST_STATIC_SCENE_PROVIDER.kind).toBe("nirvana-west-v1");
  });

  it("describes a bounded 3072x3072 scene keyed by identity and scene hash", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const descriptor = describeNirvanaWestStaticScene(recipe);
    expect(descriptor.topology).toBe("bounded");
    expect(descriptor.worldBounds).toEqual({ x: 0, y: 0, width: 3072, height: 3072 });
    expect(descriptor.cacheIdentity).toBe(
      `nirvana-west-v1:2:${recipe.identityHash}:${recipe.presentationProfile!.staticSceneHash}`,
    );
  });

  it("refuses a generic recipe rather than painting a fallback", () => {
    expect(() => describeNirvanaWestStaticScene(createRegionMapRecipe(identity))).toThrow();
  });

  it("refuses a recipe for the wrong region", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const wrongRegion = fixtureVariant(recipe, { regionId: "warm_springs" });
    expect(() => describeNirvanaWestStaticScene(wrongRegion))
      .toThrow(/exact nirvana_west, ash-waste, and profile version 2/);
  });

  it("refuses a recipe for the wrong kit", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const wrongKit = fixtureVariant(recipe, { kit: "spring-terraces" });
    expect(() => describeNirvanaWestStaticScene(wrongKit))
      .toThrow(/exact nirvana_west, ash-waste, and profile version 2/);
  });

  it("refuses a recipe carrying the wrong presentation-profile kind", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const wrongKind = fixtureVariant(recipe, {
      presentationProfile: { ...recipe.presentationProfile!, kind: "warm-springs-v1" },
    });
    expect(() => describeNirvanaWestStaticScene(wrongKind))
      .toThrow(/exact nirvana_west, ash-waste, and profile version 2/);
  });

  it("refuses a recipe carrying the wrong atlas profile version", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const wrongVersion = fixtureVariant(recipe, {
      presentationProfile: { ...recipe.presentationProfile!, atlasProfileVersion: 1 },
    });
    expect(() => describeNirvanaWestStaticScene(wrongVersion))
      .toThrow(/exact nirvana_west, ash-waste, and profile version 2/);
  });

  it("refuses a recipe with the exact profile but no trusted authored-scene sidecar", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    // A shallow copy carries the exact same region/kit/profile fields but is a fresh
    // object identity — the sidecar WeakMap is keyed on identity, so this recipe is
    // indistinguishable from real Nirvana West except that it was never built by
    // `createNirvanaWestRegionMapRecipe`, exactly the "scene lost on a copy" case the
    // sidecar is meant to catch.
    const untrusted = fixtureVariant(recipe, {});
    expect(() => describeNirvanaWestStaticScene(untrusted))
      .toThrow(/requires its trusted authored-scene sidecar/);
  });

  it("refuses a recipe whose declared scene hash does not match its authored scene", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    // Mutate the SAME object the sidecar WeakMap is keyed on (recipe fields are
    // readonly only at the type level; the runtime object is a plain, unfrozen record),
    // so the sidecar is still found but its hash now disagrees with the profile's.
    (recipe as { presentationProfile?: unknown }).presentationProfile = {
      ...recipe.presentationProfile!,
      staticSceneHash: "00000000",
    };
    expect(() => describeNirvanaWestStaticScene(recipe))
      .toThrow(/authored scene hash does not match/);
  });

  it("refuses to paint without both exact atlas leases", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const partial = leases();
    partial.delete(NIRVANA_WEST_ATLAS_PROFILE.sceneryAtlasId);
    expect(() => createNirvanaWestStaticScenePlan(recipe, partial))
      .toThrow(/requires both exact terrain and scenery atlas leases/);
  });

  it("resolves every frame it draws against the published generation", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const plan = createNirvanaWestStaticScenePlan(recipe, leases());
    // One base fill per tile, plus overlays, rims, scenery and the 8x8 matte.
    expect(plan.operations.length).toBeGreaterThan(96 * 96);
    const atlasIds = new Set(plan.operations.map((operation) => operation.atlasId));
    expect([...atlasIds].sort())
      .toEqual(["nirvana-west-v1-scenery", "nirvana-west-v1-terrain"]);
    expect(new Set(plan.operations.map((operation) => operation.stableId)).size)
      .toBe(plan.operations.length);
    expect(plan.operations.filter((operation) => operation.layer === "continuation"))
      .toHaveLength(64);
  });

  it("paints every authored scenery placement, and emberwisp over everything", () => {
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const plan = createNirvanaWestStaticScenePlan(recipe, leases());
    const authored = plan.operations.filter((operation) =>
      operation.stableId.startsWith("authored:"));
    expect(authored).toHaveLength(recipe.staticScenery.length);

    const wispFirst = plan.operations.findIndex((operation) =>
      operation.stableId.startsWith("wisp:"));
    const lastScenery = plan.operations.reduce((last, operation, index) => (
      operation.layer === "scenery" && !operation.stableId.startsWith("wisp:") ? index : last
    ), -1);
    expect(wispFirst).toBeGreaterThan(lastScenery);
  });
});
