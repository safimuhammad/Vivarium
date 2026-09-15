/** Exact-region atlas selection for the production 2D renderer. */

import {
  NIRVANA_ATLAS_PROFILE,
  NIRVANA_REGION_ID,
} from "../nirvana/NirvanaAssetProfile";
import {
  NIRVANA_EAST_ATLAS_PROFILE,
  NIRVANA_EAST_REGION_ID,
} from "../nirvanaEast/NirvanaEastAssetProfile";
import {
  WARM_SPRINGS_ATLAS_PROFILE,
  WARM_SPRINGS_REGION_ID,
} from "../warmSprings/WarmSpringsAssetProfile";
import {
  NIRVANA_WEST_ATLAS_PROFILE,
  NIRVANA_WEST_REGION_ID,
} from "../nirvanaWest/NirvanaWestAssetProfile";
import type { RegionKitId } from "../maps/biomeKits";
import type { RegionPresentationProfile } from "../maps/RegionMapRecipe";
import type { ProductionAssetManifest } from "./productionManifest";
import { DEPTH_SCENERY_ATLAS_ID } from "../depth/DepthSceneryAssets";
import { ATLAS_BRIDGE_MATERIALS_ID } from "../world/AtlasBridgeAssets";

/**
 * The profile kinds, DERIVED from the recipe's own union rather than re-declared.
 *
 * This used to be a hand-copied duplicate of `RegionPresentationProfile["kind"]`, and the
 * two silently drifted the moment two regions were productionised concurrently — a recipe
 * carrying a kind this file had never heard of would not type-check at the call site.
 * Deriving it means a region added to the recipe union is automatically known here, and
 * the only thing left to add is its atlas row below.
 */
export type ProductionPresentationProfileKind = RegionPresentationProfile["kind"];

export interface ProductionRegionAssetIdentity {
  readonly regionId: string;
  readonly kit: RegionKitId;
  readonly presentationProfile?: RegionPresentationProfile;
}

/**
 * Which exact atlases each presentation profile owns, and the identity it belongs to.
 *
 * A table rather than a chain of `if`/`else` because this is the one place every exact
 * region has to touch, and regions are productionised concurrently: adding one is a
 * single row, so two agents landing two regions cannot silently overwrite each other's
 * branch. The `else` this replaced also had a real latent hazard — it treated ANY
 * unrecognised profile kind as Nirvana's, so a new region whose branch was forgotten
 * would have leased Nirvana's art instead of failing. It now fails loudly instead, which
 * is why the record is PARTIAL: a kind may legitimately exist in the recipe union before
 * its atlas profile has landed, and that state must be a clear error rather than silently
 * the wrong region's art.
 */
const EXACT_ATLAS_PROFILES: Readonly<Partial<Record<
  ProductionPresentationProfileKind,
  Readonly<{
    regionId: string;
    requiredKit: string;
    terrainAtlasId: string;
    sceneryAtlasId: string;
    label: string;
  }>
>>> = Object.freeze({
  "nirvana-v2": Object.freeze({
    regionId: NIRVANA_REGION_ID,
    requiredKit: NIRVANA_ATLAS_PROFILE.requiredKit,
    terrainAtlasId: NIRVANA_ATLAS_PROFILE.terrainAtlasId,
    sceneryAtlasId: NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    label: "The Nirvana V2 presentation profile belongs only to exact Nirvana.",
  }),
  "warm-springs-v1": Object.freeze({
    regionId: WARM_SPRINGS_REGION_ID,
    requiredKit: WARM_SPRINGS_ATLAS_PROFILE.requiredKit,
    terrainAtlasId: WARM_SPRINGS_ATLAS_PROFILE.terrainAtlasId,
    sceneryAtlasId: WARM_SPRINGS_ATLAS_PROFILE.sceneryAtlasId,
    label: "The Warm Springs V1 presentation profile belongs only to exact Warm Springs.",
  }),
  "nirvana-east-v1": Object.freeze({
    regionId: NIRVANA_EAST_REGION_ID,
    requiredKit: NIRVANA_EAST_ATLAS_PROFILE.requiredKit,
    terrainAtlasId: NIRVANA_EAST_ATLAS_PROFILE.terrainAtlasId,
    sceneryAtlasId: NIRVANA_EAST_ATLAS_PROFILE.sceneryAtlasId,
    label: "The Nirvana East V1 presentation profile belongs only to exact Nirvana East.",
  }),
  "nirvana-west-v1": Object.freeze({
    regionId: NIRVANA_WEST_REGION_ID,
    requiredKit: NIRVANA_WEST_ATLAS_PROFILE.requiredKit,
    terrainAtlasId: NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId,
    sceneryAtlasId: NIRVANA_WEST_ATLAS_PROFILE.sceneryAtlasId,
    label: "The Nirvana West V1 presentation profile belongs only to exact Nirvana West.",
  }),
});

/**
 * Resolve the complete atlas lease set for one exact production region.
 *
 * The shared biome pack remains the fallback vocabulary. Exact presentation
 * atlases are added only when the recipe carries the matching verified profile,
 * preventing one region's art from leaking to other regions with the same kit.
 */
export function productionAtlasIdsForRegion(
  manifest: ProductionAssetManifest,
  identity: ProductionRegionAssetIdentity,
): readonly string[] {
  if (identity.regionId.trim().length === 0) {
    throw new Error("Production region atlas resolution requires an exact region ID.");
  }
  const pack = manifest.regions[identity.kit];
  if (pack === undefined) {
    throw new Error(`Production region atlas pack is unavailable for ${identity.kit}.`);
  }

  const selected = new Set(Object.values(manifest.atlases)
    .filter(({ group }) => group === "core")
    .map(({ id }) => id));
  for (const atlasId of pack.atlasIds) selected.add(atlasId);
  if (manifest.atlases[DEPTH_SCENERY_ATLAS_ID] !== undefined) selected.add(DEPTH_SCENERY_ATLAS_ID);
  if (manifest.atlases[ATLAS_BRIDGE_MATERIALS_ID] !== undefined) selected.add(ATLAS_BRIDGE_MATERIALS_ID);

  const profile = identity.presentationProfile;
  if (profile !== undefined) {
    if (profile.atlasProfileVersion !== 2) {
      throw new Error("An exact presentation profile must use atlas profile version 2.");
    }
    if (!/^[0-9a-f]{8,64}$/.test(profile.staticSceneHash)) {
      throw new Error("The exact presentation static-scene hash is invalid.");
    }
    const owner = EXACT_ATLAS_PROFILES[profile.kind];
    if (owner === undefined) {
      throw new Error(`Unknown exact presentation profile ${String(profile.kind)}.`);
    }
    if (identity.regionId !== owner.regionId || identity.kit !== owner.requiredKit) {
      throw new Error(owner.label);
    }
    selected.add(owner.terrainAtlasId);
    selected.add(owner.sceneryAtlasId);
  }

  const ids = [...selected].sort(compareText);
  for (const id of ids) {
    if (manifest.atlases[id] === undefined) {
      throw new Error(`Production atlas descriptor is missing for selected ID ${id}.`);
    }
  }
  return Object.freeze(ids);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
