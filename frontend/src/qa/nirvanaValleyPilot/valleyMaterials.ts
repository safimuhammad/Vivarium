/**
 * Material vocabulary for the Nirvana river-valley pilot.
 *
 * Priority is the paint order: the lowest-priority material among a tile's four
 * corners fills the tile, and every higher material is laid over it as a
 * corner-masked transition frame. That stack is what makes grass, silt, gravel,
 * reed, and water interlock instead of meeting at a hard tile border.
 */

export const VALLEY_MATERIALS = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "gravel",
  "silt",
  // Three TONAL TIERS of one sward, not three species: they are overlapping
  // windows onto a single twelve-tone ramp, so the meadow carries the
  // reference plate's broad lit and shadowed passages while remaining one
  // continuous surface. Ecologically they are all grass - every species that
  // grows on one grows on all of them (see GRASS_FAMILY).
  "shadegrass",
  "grass",
  "sungrass",
  "meadow",
  "thicket",
  "reed",
  "rock",
  // Bridge deck. Unlike every material above it, `deck` is NOT sampled in the
  // corner field and never fills or overlays a terrain tile: the water still
  // flows underneath and is still painted. It is the material a tile REPORTS
  // once a bridge carries it, so the tile's declared material continues to
  // explain its walkability - a deck tile is walkable, and it says "deck".
  "deck",
] as const);

export type ValleyMaterial = (typeof VALLEY_MATERIALS)[number];

export const VALLEY_MATERIAL_PRIORITY: Readonly<Record<ValleyMaterial, number>> = Object.freeze(
  Object.fromEntries(
    VALLEY_MATERIALS.map((material, index) => [material, index]),
  ) as Record<ValleyMaterial, number>,
);

/** Materials a body may not stand on or route through. */
export const BLOCKING_VALLEY_MATERIALS: readonly ValleyMaterial[] = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "thicket",
  "reed",
  "rock",
]);

/**
 * The sward, as ecology rather than as tone. A species that grows on grass
 * grows on every tier of it: the tiers model light, not habitat, so adding them
 * must not move a single plant.
 */
export const GRASS_FAMILY: readonly ValleyMaterial[] = Object.freeze([
  "shadegrass",
  "grass",
  "sungrass",
]);

/** Water as a body: the materials a shoreline set is drawn against. */
export const WATER_VALLEY_MATERIALS: readonly ValleyMaterial[] = Object.freeze([
  "deepwater",
  "water",
  "shallow",
]);

/**
 * Bank materials that own a shoreline / wet-line overlay set.
 *
 * The reference plate has a distinct darker wet band where water meets bank and
 * a broken pale line of foam on the water side of it. The first pass had only
 * the transition's contact shadow, so the two materials met without a waterline
 * at all.
 */
export const SHORE_VALLEY_MATERIALS: readonly ValleyMaterial[] = Object.freeze([
  "gravel",
  "silt",
  "reed",
]);

/**
 * Transition variants authored per material - MUST match the authoring script's
 * `edgeVariantCount`, or a tile would ask the atlas for a frame nobody drew.
 *
 * Two variants exist so a long boundary never repeats one 32px wobble. Between
 * two tonal tiers of the same sward the boundary is a single palette step and
 * its shape cannot be seen at 1:1, so one variant is honestly enough there -
 * and those are the most common transitions on the plate, which is where the
 * bytes were.
 */
export const VALLEY_EDGE_VARIANTS: Readonly<Record<ValleyMaterial, number>> = Object.freeze({
  deepwater: 2,
  water: 2,
  shallow: 2,
  gravel: 2,
  silt: 2,
  shadegrass: 1,
  grass: 1,
  sungrass: 1,
  meadow: 1,
  thicket: 2,
  reed: 2,
  rock: 2,
  deck: 2,
});

/** Shoreline variants authored per bank material. */
export const VALLEY_SHORE_VARIANTS = 2;

/** Base fills authored per material. */
export const VALLEY_BASE_VARIANTS = 8;

/** Atlas frame id for a full-tile fill of one material. */
export function baseFrameId(material: ValleyMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/**
 * Atlas frame id for a corner-masked transition.
 * Mask 15 is total coverage and is served by the base fill instead.
 */
export function edgeFrameId(material: ValleyMaterial, mask: number, variant: number): string {
  return `e.${material}.${mask}.${variant}`;
}

/**
 * Atlas frame id for a shoreline / wet-line band.
 *
 * It shares the transition's mask and variant deliberately: the authoring
 * script derives both from the same seed, so the wet line follows exactly the
 * contour of the bank edge it belongs to rather than a second, similar curve.
 */
export function shoreFrameId(material: ValleyMaterial, mask: number, variant: number): string {
  return `w.${material}.${mask}.${variant}`;
}

/** True when `material` is one of the three water tiers. */
export function isWaterMaterial(material: ValleyMaterial): boolean {
  return WATER_VALLEY_MATERIALS.includes(material);
}

/** True when `material` owns a shoreline set. */
export function hasShoreSet(material: ValleyMaterial): boolean {
  return SHORE_VALLEY_MATERIALS.includes(material);
}
