/**
 * @fileoverview Fail-closed Warm Springs static-scene provider for incremental Canvas caches.
 *
 * Registered under `kind: "warm-springs-v1"`. Generic regions must never route through it,
 * and it refuses anything that is not exact `warm_springs` on the `spring-terraces` kit
 * carrying its trusted authored-scene sidecar at the recipe's declared scene hash. Failing
 * closed is the point: a silent fallback would render different art under the same identity.
 */

import type { ProductionAssetLease } from "../assets/productionManifest";
import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import {
  createProductionStaticSceneDescriptor,
  createProductionStaticScenePlan,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePreparation,
  type ProductionStaticSceneProvider,
  type ProductionStaticSceneDescriptor,
} from "../staticScene/ProductionStaticScene";
import { WARM_SPRINGS_ATLAS_PROFILE } from "./WarmSpringsAssetProfile";
import { createWarmSpringsAtlasAssets } from "./WarmSpringsAtlas";
import { createWarmSpringsPaintPreparation } from "./WarmSpringsPainter";
import {
  warmSpringsAuthoredSceneSidecar,
  WARM_SPRINGS_REGION_ID,
  type WarmSpringsAuthoredScene,
} from "./WarmSpringsRegionMapRecipe";
import { WARM_SPRINGS_TILE_SIZE } from "./WarmSpringsTerrainField";

export class WarmSpringsStaticSceneProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarmSpringsStaticSceneProviderError";
  }
}

function requireExactWarmSpringsScene(recipe: RegionMapRecipeV1): WarmSpringsAuthoredScene {
  const profile = recipe.presentationProfile;
  if (recipe.regionId !== WARM_SPRINGS_REGION_ID
    || recipe.kit !== WARM_SPRINGS_ATLAS_PROFILE.requiredKit
    || profile?.kind !== "warm-springs-v1"
    || profile.atlasProfileVersion !== 2) {
    throw new WarmSpringsStaticSceneProviderError(
      "Warm Springs static scenery requires exact warm_springs, spring-terraces, and profile version 2.",
    );
  }
  const authored = warmSpringsAuthoredSceneSidecar(recipe);
  if (authored === null) {
    throw new WarmSpringsStaticSceneProviderError(
      "Warm Springs static scenery requires its trusted authored-scene sidecar.",
    );
  }
  if (authored.sceneHash !== profile.staticSceneHash) {
    throw new WarmSpringsStaticSceneProviderError(
      "Warm Springs authored scene hash does not match the recipe profile.",
    );
  }
  return authored;
}

/** Describe the trusted exact Warm Springs cache, camera bounds, and bounded topology. */
export function describeWarmSpringsStaticScene(
  recipe: RegionMapRecipeV1,
): ProductionStaticSceneDescriptor {
  const profile = recipe.presentationProfile!;
  requireExactWarmSpringsScene(recipe);
  return createProductionStaticSceneDescriptor({
    cacheIdentity: [
      profile.kind,
      profile.atlasProfileVersion,
      recipe.identityHash,
      profile.staticSceneHash,
    ].join(":"),
    worldBounds: {
      x: 0,
      y: 0,
      width: recipe.grid.columns * WARM_SPRINGS_TILE_SIZE,
      height: recipe.grid.rows * WARM_SPRINGS_TILE_SIZE,
    },
    topology: "bounded",
  });
}

/** Create one bounded cursor over the authored scene retained by the trusted recipe. */
export function createWarmSpringsStaticScenePreparation(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ProductionStaticScenePreparation {
  const descriptor = describeWarmSpringsStaticScene(recipe);
  const authored = requireExactWarmSpringsScene(recipe);
  const terrainLease = leases.get(WARM_SPRINGS_ATLAS_PROFILE.terrainAtlasId);
  const sceneryLease = leases.get(WARM_SPRINGS_ATLAS_PROFILE.sceneryAtlasId);
  if (terrainLease === undefined || sceneryLease === undefined) {
    throw new WarmSpringsStaticSceneProviderError(
      "Warm Springs static scenery requires both exact terrain and scenery atlas leases.",
    );
  }
  const assets = createWarmSpringsAtlasAssets(terrainLease.value, sceneryLease.value);
  return createWarmSpringsPaintPreparation(
    authored.scene,
    recipe,
    assets,
    descriptor.cacheIdentity,
  );
}

/** Drain the bounded provider explicitly for standalone tests and inspection tools. */
export function createWarmSpringsStaticScenePlan(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ReturnType<typeof createProductionStaticScenePlan> {
  const preparation = createWarmSpringsStaticScenePreparation(recipe, leases);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    done = preparation.advance(1_536, (operation) => operations.push(operation)).done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(preparation.cacheIdentity, operations);
}

/** Registry-ready exact provider; generic regions must never route through it. */
export const WARM_SPRINGS_STATIC_SCENE_PROVIDER: ProductionStaticSceneProvider = Object.freeze({
  kind: "warm-springs-v1",
  describe: describeWarmSpringsStaticScene,
  createPreparation: createWarmSpringsStaticScenePreparation,
});
