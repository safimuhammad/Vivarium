/**
 * The published `warm-springs-v1` art and the provider that fails closed around it.
 *
 * The art assertions are byte-level on purpose. The owner approved composition B by eye on
 * the pilot's exact pixels; the production generation republishes those bytes verbatim, so
 * pinning the sha256 and the byte counts is what makes "what shipped is what was approved"
 * a checkable claim rather than a promise.
 */

import { describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { PRODUCTION_ASSET_MANIFEST, type ProductionAssetLease } from "../assets/productionManifest";
import { productionAtlasIdsForRegion } from "../assets/ProductionRegionAssets";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import {
  createWarmSpringsProductionManifest,
  WARM_SPRINGS_ATLAS_PROFILE,
} from "./WarmSpringsAssetProfile";
import { createWarmSpringsRegionMapRecipe } from "./WarmSpringsRegionMapRecipe";
import {
  createWarmSpringsStaticScenePlan,
  describeWarmSpringsStaticScene,
  WARM_SPRINGS_STATIC_SCENE_PROVIDER,
} from "./WarmSpringsStaticSceneProvider";

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
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs"]),
  makeRegion("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana"]),
];

function leases(): Map<string, ProductionAssetLease> {
  return new Map<string, ProductionAssetLease>([
    [WARM_SPRINGS_ATLAS_PROFILE.terrainAtlasId,
      { value: { width: 512, height: 864 } as ImageBitmap, release: vi.fn() }],
    [WARM_SPRINGS_ATLAS_PROFILE.sceneryAtlasId,
      { value: { width: 480, height: 640 } as ImageBitmap, release: vi.fn() }],
  ]);
}

const identity = createRegionMapIdentity(401, WORLD[1]!, WORLD);

describe("WarmSpringsAssetProfile", () => {
  it("publishes the approved art, byte for byte", () => {
    const [terrain, scenery] = WARM_SPRINGS_ATLAS_PROFILE.descriptors;
    expect(terrain).toMatchObject({
      id: "warm-springs-v1-terrain",
      width: 512,
      height: 864,
      compressedBytes: 106_431,
      sha256: "c3488e06e43018aa2d2701b529ded1a36928c63158b11d92597cb2ecc3aa5663",
    });
    expect(scenery).toMatchObject({
      id: "warm-springs-v1-scenery",
      width: 480,
      height: 640,
      compressedBytes: 26_762,
      sha256: "968a1f468d58371c9419b8e48ed45266d5b680baf37197d08e115a4395d8e274",
    });
    expect(Object.keys(WARM_SPRINGS_ATLAS_PROFILE.frames)).toHaveLength(489);
    expect(WARM_SPRINGS_ATLAS_PROFILE.compressedBytes).toBe(133_193);
  });

  it("stays well inside the per-kit ceiling, with the headroom the pilot reserved", () => {
    const metadataBytes = 9_919;
    const total = WARM_SPRINGS_ATLAS_PROFILE.compressedBytes + metadataBytes;
    expect(total).toBe(143_112);
    expect(total).toBeLessThan(196_608);
    // Nirvana shipped at 97.93 % and needed a named 70-frame cut to get there, which is
    // why its reed beds later needed rescuing. This margin is deliberately not spent.
    expect(196_608 - total).toBeGreaterThan(50_000);
  });

  it("enforces the shared active-atlas ceiling when it joins the manifest", () => {
    const manifest = createWarmSpringsProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const projected = manifest.budgets.activeCompressedBytes["spring-terraces"]
      + WARM_SPRINGS_ATLAS_PROFILE.compressedBytes;
    expect(projected).toBeLessThanOrEqual(manifest.budgets.activeCompressedMax);
    expect(manifest.atlases["warm-springs-v1-terrain"]).toBeDefined();
    expect(manifest.atlases["warm-springs-v1-scenery"]).toBeDefined();
    expect(manifest.regions).toBe(PRODUCTION_ASSET_MANIFEST.regions);
  });

  it("leases the exact atlases only for exact Warm Springs", () => {
    const manifest = createWarmSpringsProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    expect(productionAtlasIdsForRegion(manifest, recipe))
      .toEqual(expect.arrayContaining(["warm-springs-v1-terrain", "warm-springs-v1-scenery"]));

    const generic = createRegionMapRecipe(identity);
    expect(productionAtlasIdsForRegion(manifest, generic))
      .not.toEqual(expect.arrayContaining(["warm-springs-v1-terrain"]));
    expect(() => productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana_east",
      kit: "spring-terraces",
      presentationProfile: recipe.presentationProfile,
    })).toThrow(/belongs only to exact Warm Springs/);
  });
});

describe("WarmSpringsStaticSceneProvider", () => {
  it("is registered under its own profile kind", () => {
    expect(WARM_SPRINGS_STATIC_SCENE_PROVIDER.kind).toBe("warm-springs-v1");
  });

  it("describes a bounded 3072x3072 scene keyed by identity and scene hash", () => {
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    const descriptor = describeWarmSpringsStaticScene(recipe);
    expect(descriptor.topology).toBe("bounded");
    expect(descriptor.worldBounds).toEqual({ x: 0, y: 0, width: 3072, height: 3072 });
    expect(descriptor.cacheIdentity).toBe(
      `warm-springs-v1:2:${recipe.identityHash}:${recipe.presentationProfile!.staticSceneHash}`,
    );
  });

  it("refuses a generic recipe rather than painting a fallback", () => {
    expect(() => describeWarmSpringsStaticScene(createRegionMapRecipe(identity))).toThrow();
  });

  it("refuses to paint without both exact atlas leases", () => {
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    const partial = leases();
    partial.delete(WARM_SPRINGS_ATLAS_PROFILE.sceneryAtlasId);
    expect(() => createWarmSpringsStaticScenePlan(recipe, partial))
      .toThrow(/requires both exact terrain and scenery atlas leases/);
  });

  it("resolves every frame it draws against the published generation", () => {
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    const plan = createWarmSpringsStaticScenePlan(recipe, leases());
    // One base fill per tile, plus overlays, wet lines, scenery and the 8x8 matte.
    expect(plan.operations.length).toBeGreaterThan(96 * 96);
    const atlasIds = new Set(plan.operations.map((operation) => operation.atlasId));
    expect([...atlasIds].sort())
      .toEqual(["warm-springs-v1-scenery", "warm-springs-v1-terrain"]);
    expect(new Set(plan.operations.map((operation) => operation.stableId)).size)
      .toBe(plan.operations.length);
    expect(plan.operations.filter((operation) => operation.layer === "continuation"))
      .toHaveLength(64);
  });

  it("paints every authored scenery placement, and steam over everything", () => {
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    const plan = createWarmSpringsStaticScenePlan(recipe, leases());
    const authored = plan.operations.filter((operation) =>
      operation.stableId.startsWith("authored:"));
    expect(authored).toHaveLength(recipe.staticScenery.length);

    const steamFirst = plan.operations.findIndex((operation) =>
      operation.stableId.startsWith("steam:"));
    const lastScenery = plan.operations.reduce((last, operation, index) => (
      operation.layer === "scenery" && !operation.stableId.startsWith("steam:") ? index : last
    ), -1);
    expect(steamFirst).toBeGreaterThan(lastScenery);
  });
});
