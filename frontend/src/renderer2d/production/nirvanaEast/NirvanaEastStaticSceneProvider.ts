/**
 * @fileoverview Fail-closed Nirvana East static-scene provider for incremental Canvas caches.
 *
 * Registered under `kind: "nirvana-east-v1"`. Generic regions must never route through it,
 * and it refuses anything that is not exact `nirvana_east` on the `dry-scrub` kit carrying
 * its trusted authored-scene sidecar at the recipe's declared scene hash. Failing closed is
 * the point: a silent fallback would render different art under the same identity. Mirrors
 * `warmSprings/WarmSpringsStaticSceneProvider.ts` exactly in shape.
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
import { NIRVANA_EAST_ATLAS_PROFILE } from "./NirvanaEastAssetProfile";
import { createNirvanaEastAtlasAssets } from "./NirvanaEastAtlas";
import { createNirvanaEastPaintPreparation } from "./NirvanaEastPainter";
import {
  nirvanaEastAuthoredSceneSidecar,
  NIRVANA_EAST_REGION_ID,
  type NirvanaEastAuthoredScene,
} from "./NirvanaEastRegionMapRecipe";
import { NIRVANA_EAST_TILE_SIZE } from "./NirvanaEastTerrainField";

export class NirvanaEastStaticSceneProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaEastStaticSceneProviderError";
  }
}

function requireExactNirvanaEastScene(recipe: RegionMapRecipeV1): NirvanaEastAuthoredScene {
  const profile = recipe.presentationProfile;
  if (recipe.regionId !== NIRVANA_EAST_REGION_ID
    || recipe.kit !== NIRVANA_EAST_ATLAS_PROFILE.requiredKit
    || profile?.kind !== "nirvana-east-v1"
    || profile.atlasProfileVersion !== 2) {
    throw new NirvanaEastStaticSceneProviderError(
      "Nirvana East static scenery requires exact nirvana_east, dry-scrub, and profile version 2.",
    );
  }
  const authored = nirvanaEastAuthoredSceneSidecar(recipe);
  if (authored === null) {
    throw new NirvanaEastStaticSceneProviderError(
      "Nirvana East static scenery requires its trusted authored-scene sidecar.",
    );
  }
  if (authored.sceneHash !== profile.staticSceneHash) {
    throw new NirvanaEastStaticSceneProviderError(
      "Nirvana East authored scene hash does not match the recipe profile.",
    );
  }
  return authored;
}

/** Describe the trusted exact Nirvana East cache, camera bounds, and bounded topology. */
export function describeNirvanaEastStaticScene(
  recipe: RegionMapRecipeV1,
): ProductionStaticSceneDescriptor {
  const profile = recipe.presentationProfile!;
  requireExactNirvanaEastScene(recipe);
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
      width: recipe.grid.columns * NIRVANA_EAST_TILE_SIZE,
      height: recipe.grid.rows * NIRVANA_EAST_TILE_SIZE,
    },
    // The CAMERA is bounded in every region, Nirvana East included — only walking is
    // toroidal (`.superpowers/sdd/torus-physics-report.md` step 4: "Camera: UNCHANGED
    // ... camera.topology is 'bounded', not 'toroidal'. By design."). Matches Warm
    // Springs' value.
    topology: "bounded",
  });
}

/** Create one bounded cursor over the authored scene retained by the trusted recipe. */
export function createNirvanaEastStaticScenePreparation(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ProductionStaticScenePreparation {
  const descriptor = describeNirvanaEastStaticScene(recipe);
  const authored = requireExactNirvanaEastScene(recipe);
  const terrainLease = leases.get(NIRVANA_EAST_ATLAS_PROFILE.terrainAtlasId);
  const sceneryLease = leases.get(NIRVANA_EAST_ATLAS_PROFILE.sceneryAtlasId);
  if (terrainLease === undefined || sceneryLease === undefined) {
    throw new NirvanaEastStaticSceneProviderError(
      "Nirvana East static scenery requires both exact terrain and scenery atlas leases.",
    );
  }
  const assets = createNirvanaEastAtlasAssets(terrainLease.value, sceneryLease.value);
  return createNirvanaEastPaintPreparation(
    authored.scene,
    recipe,
    assets,
    descriptor.cacheIdentity,
  );
}

/** Drain the bounded provider explicitly for standalone tests and inspection tools. */
export function createNirvanaEastStaticScenePlan(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ReturnType<typeof createProductionStaticScenePlan> {
  const preparation = createNirvanaEastStaticScenePreparation(recipe, leases);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    done = preparation.advance(1_536, (operation) => operations.push(operation)).done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(preparation.cacheIdentity, operations);
}

/** Registry-ready exact provider; generic regions must never route through it. */
export const NIRVANA_EAST_STATIC_SCENE_PROVIDER: ProductionStaticSceneProvider = Object.freeze({
  kind: "nirvana-east-v1",
  describe: describeNirvanaEastStaticScene,
  createPreparation: createNirvanaEastStaticScenePreparation,
});
