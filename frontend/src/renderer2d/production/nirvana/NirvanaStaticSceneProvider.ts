/** Fail-closed Nirvana V2 static-scene provider for incremental Canvas caches. */

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
import { NIRVANA_ATLAS_PROFILE } from "./NirvanaAssetProfile";
import { createNirvanaAtlasAssets } from "./NirvanaAtlas";
import { createNirvanaPaintPreparation } from "./NirvanaPainter";
import { nirvanaInitialRegionSidecar } from "./NirvanaRegionMapRecipe";
import { NIRVANA_TILE_SIZE } from "./NirvanaRegionV2";

export class NirvanaStaticSceneProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaStaticSceneProviderError";
  }
}

/** Describe the trusted exact Nirvana cache, camera bounds, and toroidal topology. */
export function describeNirvanaStaticScene(
  recipe: RegionMapRecipeV1,
): ProductionStaticSceneDescriptor {
  const initial = requireExactNirvanaInitialRegion(recipe);
  const profile = recipe.presentationProfile!;
  return createProductionStaticSceneDescriptor({
    cacheIdentity: [
      "nirvana-v2",
      profile.atlasProfileVersion,
      recipe.identityHash,
      profile.staticSceneHash,
    ].join(":"),
    worldBounds: {
      x: initial.region.bounds.minTileColumn * NIRVANA_TILE_SIZE,
      y: initial.region.bounds.minTileRow * NIRVANA_TILE_SIZE,
      width: initial.region.bounds.columns * NIRVANA_TILE_SIZE,
      height: initial.region.bounds.rows * NIRVANA_TILE_SIZE,
    },
    topology: "toroidal",
  });
}

/** Create one bounded cursor over the authored scene retained by the trusted recipe. */
export function createNirvanaStaticScenePreparation(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ProductionStaticScenePreparation {
  const descriptor = describeNirvanaStaticScene(recipe);
  const initial = requireExactNirvanaInitialRegion(recipe);
  const terrainLease = leases.get(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
  const sceneryLease = leases.get(NIRVANA_ATLAS_PROFILE.sceneryAtlasId);
  if (terrainLease === undefined || sceneryLease === undefined) {
    throw new NirvanaStaticSceneProviderError(
      "Nirvana V3 static scenery requires both exact terrain and scenery atlas leases.",
    );
  }
  const assets = createNirvanaAtlasAssets(
    terrainLease.value,
    sceneryLease.value,
    NIRVANA_ATLAS_PROFILE,
  );
  const preparation = createNirvanaPaintPreparation(
    initial.region,
    assets,
    descriptor.cacheIdentity,
  );
  return preparation;
}

function requireExactNirvanaInitialRegion(
  recipe: RegionMapRecipeV1,
): NonNullable<ReturnType<typeof nirvanaInitialRegionSidecar>> {
  const profile = recipe.presentationProfile;
  if (recipe.regionId !== "nirvana"
    || recipe.kit !== NIRVANA_ATLAS_PROFILE.requiredKit
    || profile?.kind !== "nirvana-v2"
    || profile.atlasProfileVersion !== 2) {
    throw new NirvanaStaticSceneProviderError(
      "Nirvana V2 static scenery requires exact Nirvana, worn-heartland, and profile version 2.",
    );
  }
  const initial = nirvanaInitialRegionSidecar(recipe);
  if (initial === null) {
    throw new NirvanaStaticSceneProviderError(
      "Nirvana V2 static scenery requires its trusted authored-scene sidecar.",
    );
  }
  if (initial.sceneHash !== profile.staticSceneHash) {
    throw new NirvanaStaticSceneProviderError(
      "Nirvana V2 reconstructed scene hash does not match the recipe profile.",
    );
  }
  return initial;
}

/** Drain the bounded provider explicitly for standalone tests and inspection tools. */
export function createNirvanaStaticScenePlan(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ReturnType<typeof createProductionStaticScenePlan> {
  const preparation = createNirvanaStaticScenePreparation(recipe, leases);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    const result = preparation.advance(1_536, (operation) => operations.push(operation));
    done = result.done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(preparation.cacheIdentity, operations);
}

/** Registry-ready exact provider; generic regions must never route through it. */
export const NIRVANA_STATIC_SCENE_PROVIDER: ProductionStaticSceneProvider = Object.freeze({
  kind: "nirvana-v2",
  describe: describeNirvanaStaticScene,
  createPreparation: createNirvanaStaticScenePreparation,
});
