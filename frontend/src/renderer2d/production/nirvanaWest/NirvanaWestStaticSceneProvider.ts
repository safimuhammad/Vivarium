/**
 * @fileoverview Fail-closed Nirvana West static-scene provider for incremental Canvas caches.
 *
 * Registered under `kind: "nirvana-west-v1"`. Generic regions must never route
 * through it, and it refuses anything that is not exact `nirvana_west` on the
 * `ash-waste` kit carrying its trusted authored-scene sidecar at the recipe's
 * declared scene hash. Failing closed is the point: a silent fallback would
 * render different art under the same identity.
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
import { NIRVANA_WEST_ATLAS_PROFILE } from "./NirvanaWestAssetProfile";
import { createNirvanaWestAtlasAssets } from "./NirvanaWestAtlas";
import { createNirvanaWestPaintPreparation } from "./NirvanaWestPainter";
import {
  nirvanaWestAuthoredSceneSidecar,
  NIRVANA_WEST_REGION_ID,
  type NirvanaWestAuthoredScene,
} from "./NirvanaWestRegionMapRecipe";
import { NIRVANA_WEST_TILE_SIZE } from "./NirvanaWestTerrainField";

export class NirvanaWestStaticSceneProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestStaticSceneProviderError";
  }
}

function requireExactNirvanaWestScene(recipe: RegionMapRecipeV1): NirvanaWestAuthoredScene {
  const profile = recipe.presentationProfile;
  if (recipe.regionId !== NIRVANA_WEST_REGION_ID
    || recipe.kit !== NIRVANA_WEST_ATLAS_PROFILE.requiredKit
    || profile?.kind !== "nirvana-west-v1"
    || profile.atlasProfileVersion !== 2) {
    throw new NirvanaWestStaticSceneProviderError(
      "Nirvana West static scenery requires exact nirvana_west, ash-waste, and profile version 2.",
    );
  }
  const authored = nirvanaWestAuthoredSceneSidecar(recipe);
  if (authored === null) {
    throw new NirvanaWestStaticSceneProviderError(
      "Nirvana West static scenery requires its trusted authored-scene sidecar.",
    );
  }
  if (authored.sceneHash !== profile.staticSceneHash) {
    throw new NirvanaWestStaticSceneProviderError(
      "Nirvana West authored scene hash does not match the recipe profile.",
    );
  }
  return authored;
}

/**
 * Describe the trusted exact Nirvana West cache, camera bounds, and bounded topology.
 *
 * `topology: "bounded"` describes the CAMERA, not the walk physics. The region's
 * navigation grid is toroidal — beings walk across both seams — but the observer
 * camera stays bounded by the owner's decision, and the static-scene cache is a
 * camera-side concern. This is a deliberate shipped split, not an oversight — see
 * `.superpowers/sdd/torus-physics-report.md` step 4 ("being visibility at a seam"),
 * which keeps the toroidal camera-tiling path unreachable and solves the crossing
 * entirely at the being layer instead (unrolled route waypoints plus a beings-only
 * periodic redraw pass).
 *
 * @param recipe - A recipe for exact `nirvana_west` carrying its sidecar.
 * @returns The cache descriptor.
 * @throws {NirvanaWestStaticSceneProviderError} If the recipe is not trusted.
 */
export function describeNirvanaWestStaticScene(
  recipe: RegionMapRecipeV1,
): ProductionStaticSceneDescriptor {
  const profile = recipe.presentationProfile!;
  requireExactNirvanaWestScene(recipe);
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
      width: recipe.grid.columns * NIRVANA_WEST_TILE_SIZE,
      height: recipe.grid.rows * NIRVANA_WEST_TILE_SIZE,
    },
    topology: "bounded",
  });
}

/**
 * Create one bounded cursor over the authored scene retained by the trusted recipe.
 *
 * @param recipe - A recipe for exact `nirvana_west` carrying its sidecar.
 * @param leases - Decoded atlas leases, which must include both exact sheets.
 * @returns A disposable paint preparation.
 * @throws {NirvanaWestStaticSceneProviderError} If a required lease is missing.
 */
export function createNirvanaWestStaticScenePreparation(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ProductionStaticScenePreparation {
  const descriptor = describeNirvanaWestStaticScene(recipe);
  const authored = requireExactNirvanaWestScene(recipe);
  const terrainLease = leases.get(NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId);
  const sceneryLease = leases.get(NIRVANA_WEST_ATLAS_PROFILE.sceneryAtlasId);
  if (terrainLease === undefined || sceneryLease === undefined) {
    throw new NirvanaWestStaticSceneProviderError(
      "Nirvana West static scenery requires both exact terrain and scenery atlas leases.",
    );
  }
  return createNirvanaWestPaintPreparation(
    authored.scene,
    recipe,
    createNirvanaWestAtlasAssets(terrainLease.value, sceneryLease.value),
    descriptor.cacheIdentity,
  );
}

/**
 * Drain the bounded provider explicitly for standalone tests and inspection tools.
 *
 * @param recipe - A recipe for exact `nirvana_west` carrying its sidecar.
 * @param leases - Decoded atlas leases.
 * @returns The complete immutable draw plan.
 */
export function createNirvanaWestStaticScenePlan(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ReturnType<typeof createProductionStaticScenePlan> {
  const preparation = createNirvanaWestStaticScenePreparation(recipe, leases);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    done = preparation.advance(1_536, (operation) => operations.push(operation)).done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(preparation.cacheIdentity, operations);
}

/** Registry-ready exact provider; generic regions must never route through it. */
export const NIRVANA_WEST_STATIC_SCENE_PROVIDER: ProductionStaticSceneProvider = Object.freeze({
  kind: "nirvana-west-v1",
  describe: describeNirvanaWestStaticScene,
  createPreparation: createNirvanaWestStaticScenePreparation,
});
