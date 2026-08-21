/**
 * Material vocabulary for the Warm Springs geothermal pilot.
 *
 * Mirrors `valleyMaterials.ts` (the Nirvana river-valley pilot) exactly in
 * shape: priority is the paint order, the lowest-priority material among a
 * tile's four corners fills the tile, and every higher material is laid over
 * it as a corner-masked transition frame. That stack is what makes pool,
 * sinter, travertine, ochre mat, and sward interlock instead of meeting at a
 * hard tile border.
 *
 * The list, priority order, blocking set, and edge-variant counts below are
 * FROZEN by the Warm Springs contract (`scratchpad/warm-springs-contract.md`
 * §4) — they are the only coordination point with the concurrent art-authoring
 * script, so nothing here may drift from that table without the contract
 * changing too.
 */

export const WARM_SPRINGS_MATERIALS = Object.freeze([
  // Scalding pool centre, saturated milky cyan. Lowest priority: it fills a
  // tile whenever nothing hotter/higher is present at any corner.
  "poolhot",
  // Mineral pool, pale blue-green milk.
  "pool",
  // Scalding shallow at the pool edge, near-white.
  "poolrim",
  // Wet sinter apron - cream white, faint banding. WALKABLE.
  "sinter",
  // Dry terrace stone - warm cream-ochre banded. WALKABLE.
  "travertine",
  // Rust/orange microbial mat: ground too hot to stand on.
  "ochre",
  // Grey boiling mud.
  "mud",
  // Three TONAL TIERS of one sward, not three species - see GRASS_FAMILY.
  "shadegrass",
  "grass",
  "sungrass",
  // Dense scrub.
  "scrub",
  // Hot-spring reed bed.
  "reed",
  // Dark volcanic andesite scarp.
  "rock",
  // Boardwalk deck. Like Nirvana's `deck`, this is NOT sampled in the corner
  // field and never fills or overlays a terrain tile: the pool/mat/mud is
  // still painted underneath. It is the material a tile REPORTS once a
  // boardwalk carries it, so the tile's declared material continues to
  // explain its walkability - a deck tile is walkable, and it says "deck".
  "deck",
] as const);

export type WarmSpringsMaterial = (typeof WARM_SPRINGS_MATERIALS)[number];

export const WARM_SPRINGS_MATERIAL_PRIORITY: Readonly<Record<WarmSpringsMaterial, number>> =
  Object.freeze(
    Object.fromEntries(
      WARM_SPRINGS_MATERIALS.map((material, index) => [material, index]),
    ) as Record<WarmSpringsMaterial, number>,
  );

/** Materials a body may not stand on or route through (contract §4 "blocks" column). */
export const BLOCKING_WARM_SPRINGS_MATERIALS: readonly WarmSpringsMaterial[] = Object.freeze([
  "poolhot",
  "pool",
  "poolrim",
  "ochre",
  "mud",
  "scrub",
  "reed",
  "rock",
]);

/**
 * The sward, as ecology rather than as tone. A species that grows on grass
 * grows on every tier of it: the tiers model light, not habitat.
 */
export const GRASS_FAMILY: readonly WarmSpringsMaterial[] = Object.freeze([
  "shadegrass",
  "grass",
  "sungrass",
]);

/** Water as a body: the three pool tiers, from scalding centre to shallow rim. */
export const WATER_FAMILY: readonly WarmSpringsMaterial[] = Object.freeze([
  "poolhot",
  "pool",
  "poolrim",
]);

/** Bank materials that own a shoreline / wet-line overlay set (contract §4). */
export const SHORE_MATERIALS: readonly WarmSpringsMaterial[] = Object.freeze([
  "sinter",
  "travertine",
  "ochre",
]);

/**
 * Transition variants authored per material - MUST match the authoring
 * script's `edgeVariantCount`, or a tile would ask the atlas for a frame
 * nobody drew. Frozen by contract §5 ("Edge variants per material").
 */
export const WARM_SPRINGS_EDGE_VARIANTS: Readonly<Record<WarmSpringsMaterial, number>> =
  Object.freeze({
    poolhot: 1,
    pool: 2,
    poolrim: 1,
    sinter: 2,
    travertine: 1,
    ochre: 2,
    mud: 1,
    shadegrass: 1,
    grass: 1,
    sungrass: 1,
    scrub: 1,
    reed: 2,
    rock: 1,
    // `deck` is never sampled in the corner field and owns no terrain frames
    // at all (contract §5); this entry exists only so the type stays a total
    // record over every material.
    deck: 0,
  });

/** Shoreline variants authored per bank material (contract §5: "v in [0,2)"). */
export const WARM_SPRINGS_SHORE_VARIANTS = 2;

/** Base fills authored per material (contract §5: "v in [0, 8)"). */
export const WARM_SPRINGS_BASE_VARIANTS = 8;

/** Atlas frame id for a full-tile fill of one material: `t.<material>.<v>`. */
export function baseFrameId(material: WarmSpringsMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/**
 * Atlas frame id for a corner-masked transition: `e.<material>.<mask>.<v>`.
 * Mask 15 is total coverage and is served by the base fill instead.
 */
export function edgeFrameId(material: WarmSpringsMaterial, mask: number, variant: number): string {
  return `e.${material}.${mask}.${variant}`;
}

/**
 * Atlas frame id for a shoreline / wet-line band: `w.<material>.<mask>.<v>`.
 *
 * Shares the transition's mask and variant deliberately: the authoring script
 * derives both from the same seed, so the wet line follows exactly the
 * contour the bank edge was cut with rather than a second, similar curve.
 */
export function shoreFrameId(material: WarmSpringsMaterial, mask: number, variant: number): string {
  return `w.${material}.${mask}.${variant}`;
}

/** True when `material` is one of the three pool tiers. */
export function isWaterMaterial(material: WarmSpringsMaterial): boolean {
  return WATER_FAMILY.includes(material);
}

/** True when `material` owns a shoreline set. */
export function hasShoreSet(material: WarmSpringsMaterial): boolean {
  return SHORE_MATERIALS.includes(material);
}

/** True when `material` blocks standing/routing. */
export function isBlockingMaterial(material: WarmSpringsMaterial): boolean {
  return BLOCKING_WARM_SPRINGS_MATERIALS.includes(material);
}
