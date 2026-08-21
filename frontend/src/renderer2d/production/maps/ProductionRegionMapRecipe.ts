/** Canonical exact-region production recipe selection for Live and replay. */

import { createNirvanaRegionMapRecipe } from "../nirvana/NirvanaRegionMapRecipe";
import type { NirvanaGrowthPressure } from "../nirvana/NirvanaGrowthPolicy";
import {
  createNirvanaEastRegionMapRecipe,
  NIRVANA_EAST_REGION_ID,
} from "../nirvanaEast/NirvanaEastRegionMapRecipe";
import {
  createNirvanaWestRegionMapRecipe,
  NIRVANA_WEST_REGION_ID,
} from "../nirvanaWest/NirvanaWestRegionMapRecipe";
import {
  createWarmSpringsRegionMapRecipe,
  WARM_SPRINGS_REGION_ID,
} from "../warmSprings/WarmSpringsRegionMapRecipe";
import type { RegionMapIdentity } from "./RegionMapIdentity";
import {
  createRegionMapRecipe,
  parseRegionMapRecipe,
  type RegionMapRecipeV1,
} from "./RegionMapRecipe";

/**
 * Build the authoritative recipe for one exact production region identity.
 *
 * Four regions have exact builders. `nirvana` REPLACES the generic recipe with its
 * authored chunk world; `warm_springs`, `nirvana_east` and `nirvana_west` keep the generic
 * recipe whole and only compose their approved terrain's blocking ground into
 * `grid.collision` — the Great Terrace, Butte Country and the Ember Rift respectively.
 * Every other identity is delegated unchanged, byte for byte.
 */
export function createProductionRegionMapRecipe(
  identity: RegionMapIdentity,
  pressure?: NirvanaGrowthPressure,
): RegionMapRecipeV1 {
  if (identity.regionId === "nirvana") return createNirvanaRegionMapRecipe(identity, pressure);
  if (identity.regionId === WARM_SPRINGS_REGION_ID) {
    return createWarmSpringsRegionMapRecipe(identity);
  }
  if (identity.regionId === NIRVANA_EAST_REGION_ID) {
    return createNirvanaEastRegionMapRecipe(identity);
  }
  if (identity.regionId === NIRVANA_WEST_REGION_ID) {
    return createNirvanaWestRegionMapRecipe(identity);
  }
  return createRegionMapRecipe(identity);
}

/** Parse persisted production recipe bytes against exact-region regeneration. */
export function parseProductionRegionMapRecipe(
  serialized: string,
  expectedIdentity: RegionMapIdentity,
  pressure?: NirvanaGrowthPressure,
): RegionMapRecipeV1 {
  return parseRegionMapRecipe(
    serialized,
    expectedIdentity,
    (identity) => createProductionRegionMapRecipe(identity, pressure),
  );
}
