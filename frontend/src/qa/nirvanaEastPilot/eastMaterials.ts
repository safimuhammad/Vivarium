/**
 * Material vocabulary for the Nirvana East dry-scrub pilot (region 3 of 4).
 *
 * Mirrors `warmSpringsPilot/springsMaterials.ts` exactly in shape: priority is
 * the paint order, the lowest-priority material among a tile's four corners
 * fills the tile, and every higher material is laid over it as a corner-masked
 * transition frame.
 *
 * The list, priority order, blocking set, and edge-variant counts below are
 * FROZEN by the Nirvana East contract (`scratchpad/nirvana-east-contract.md`
 * §4) — the only coordination point with the concurrent art-authoring script,
 * so nothing here may drift from that table without the contract changing too.
 */

export const NIRVANA_EAST_MATERIALS = Object.freeze([
  // Bitter salt water, milky pale jade over red mud. Lowest priority: fills a
  // tile whenever nothing hotter/higher is present at any corner.
  "brine",
  // Shallow crusted brine, near-white with a pink flush.
  "brinerim",
  // Dry salt crust / playa, bone white, polygon cracks. WALKABLE.
  "salt",
  // Pale cracked clay pan, warm off-white / pale pink. WALKABLE.
  "hardpan",
  // The existing warm sand #f0c880, wind-rippled. WALKABLE.
  "sand",
  // Deep rust-red aeolian sand, fine ripples. WALKABLE.
  "redsand",
  // Dark iron-oxide mudstone / red desert pavement. WALKABLE.
  "oxide",
  // Charcoal desert-varnish lag gravel. WALKABLE.
  "gravel",
  // Sparse bleached khaki bunchgrass over sand. WALKABLE.
  "dustgrass",
  // Thorn scrub / mesquite thicket.
  "thorn",
  // Banded red mesa caprock top.
  "mesa",
  // Mesa cliff face + talus skirt, dark red banding.
  "scarp",
  // Deep shadowed fissure / slot canyon.
  "slot",
  // Plank causeway deck. Like Warm Springs' `deck`, this is NOT sampled in
  // the corner field and never fills or overlays a terrain tile: the
  // brine/thorn/scarp is still painted underneath. It is the material a tile
  // REPORTS once a plank causeway carries it, so the tile's declared material
  // continues to explain its walkability — a deck tile is walkable, and it
  // says "plank".
  "plank",
] as const);

export type NirvanaEastMaterial = (typeof NIRVANA_EAST_MATERIALS)[number];

export const NIRVANA_EAST_MATERIAL_PRIORITY: Readonly<Record<NirvanaEastMaterial, number>> =
  Object.freeze(
    Object.fromEntries(
      NIRVANA_EAST_MATERIALS.map((material, index) => [material, index]),
    ) as Record<NirvanaEastMaterial, number>,
  );

/** Materials a body may not stand on or route through (contract §4 "blocks" column). */
export const BLOCKING_NIRVANA_EAST_MATERIALS: readonly NirvanaEastMaterial[] = Object.freeze([
  "brine",
  "brinerim",
  "thorn",
  "mesa",
  "scarp",
  "slot",
]);

/** Materials that never block, and therefore carry the identity at zero plot cost. */
export const WALKABLE_NIRVANA_EAST_MATERIALS: readonly NirvanaEastMaterial[] = Object.freeze([
  "salt",
  "hardpan",
  "sand",
  "redsand",
  "oxide",
  "gravel",
  "dustgrass",
  "plank",
]);

/** Tonal tiers of one desert floor, share prop ecology (contract §4). */
export const GROUND_FAMILY: readonly NirvanaEastMaterial[] = Object.freeze([
  "sand",
  "redsand",
  "oxide",
  "hardpan",
  "gravel",
]);

/** Water as a body: bitter brine and its crusted shallow rim. */
export const WATER_FAMILY: readonly NirvanaEastMaterial[] = Object.freeze([
  "brine",
  "brinerim",
]);

/** Bank materials that own a shoreline / wet-line overlay set (contract §4). */
export const SHORE_MATERIALS: readonly NirvanaEastMaterial[] = Object.freeze([
  "salt",
  "hardpan",
  "oxide",
]);

/** Mesa / scarp / slot — the relief kit standing on flat sim ground (contract §4). */
export const CLIFF_FAMILY: readonly NirvanaEastMaterial[] = Object.freeze([
  "mesa",
  "scarp",
  "slot",
]);

/**
 * Transition variants authored per material — MUST match the authoring
 * script's `edgeVariantCount`, or a tile would ask the atlas for a frame
 * nobody drew. Frozen by contract §4 ("edge variants" column).
 */
export const NIRVANA_EAST_EDGE_VARIANTS: Readonly<Record<NirvanaEastMaterial, number>> =
  Object.freeze({
    brine: 2,
    brinerim: 1,
    salt: 2,
    hardpan: 2,
    sand: 1,
    redsand: 2,
    oxide: 2,
    gravel: 1,
    dustgrass: 1,
    thorn: 2,
    mesa: 1,
    scarp: 1,
    slot: 1,
    // `plank` is never sampled in the corner field and owns no terrain frames
    // at all (contract §4); this entry exists only so the type stays a total
    // record over every material.
    plank: 0,
  });

/** Shoreline variants authored per bank material (contract §5: "v in [0,2)"). */
export const NIRVANA_EAST_SHORE_VARIANTS = 2;

/** Base fills authored per material (contract §5: "v in [0, 8)"). */
export const NIRVANA_EAST_BASE_VARIANTS = 8;

/** Atlas frame id for a full-tile fill of one material: `t.<material>.<v>`. */
export function baseFrameId(material: NirvanaEastMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/**
 * Atlas frame id for a corner-masked transition: `e.<material>.<mask>.<v>`.
 * Mask 15 is total coverage and is served by the base fill instead.
 */
export function edgeFrameId(material: NirvanaEastMaterial, mask: number, variant: number): string {
  return `e.${material}.${mask}.${variant}`;
}

/**
 * Atlas frame id for a shoreline / wet-line band: `w.<material>.<mask>.<v>`.
 *
 * Shares the transition's mask and variant deliberately: the authoring script
 * derives both from the same seed, so the wet line follows exactly the
 * contour the bank edge was cut with rather than a second, similar curve.
 */
export function shoreFrameId(material: NirvanaEastMaterial, mask: number, variant: number): string {
  return `w.${material}.${mask}.${variant}`;
}

/** True when `material` is one of the two brine tiers. */
export function isWaterMaterial(material: NirvanaEastMaterial): boolean {
  return WATER_FAMILY.includes(material);
}

/** True when `material` owns a shoreline set. */
export function hasShoreSet(material: NirvanaEastMaterial): boolean {
  return SHORE_MATERIALS.includes(material);
}

/** True when `material` blocks standing/routing. */
export function isBlockingMaterial(material: NirvanaEastMaterial): boolean {
  return BLOCKING_NIRVANA_EAST_MATERIALS.includes(material);
}
