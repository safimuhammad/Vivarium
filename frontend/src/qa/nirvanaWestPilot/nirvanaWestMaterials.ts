/**
 * Nirvana West design pilot — the frozen material vocabulary.
 *
 * This module is the ONLY coordination point between the offline art authoring
 * script (`frontend/scripts/author-nirvana-west-pilot-art.mjs`, which mirrors
 * this table in plain JS) and the scene builder (`nirvanaWestScene.ts`). It is
 * deliberately dependency-free so both sides can be written concurrently.
 *
 * Region identity: `nirvana_west` is the `ash_waste` archetype — world.yaml
 * describes it as "a nuclear wasteland, all but dead". Its production kit
 * already declares the authored vocabulary this pilot honours: a
 * `nuclear-crater-fissure` signature role, a `coral-ember-fissure` terrain
 * patch role, `charred-trunk` / `slag-rock` / `ash-pile` / `bone-stone`
 * scenery and an `ember` ambient emitter. The palette is therefore
 * violet-slate and bone-ash with ONE saturated coral accent — a colour and,
 * more importantly, a VALUE that neither Nirvana (green/blue), Warm Springs
 * (cream/ochre/turquoise) nor Nirvana East (sand) occupies.
 *
 * Priority == array index == paint order. The lowest-priority material present
 * at a tile's four corners becomes the tile's base fill; every higher-priority
 * material is painted over it as a corner-mask transition. Low index therefore
 * means "underneath" — the fissure floors sit below the plains, which sit
 * below the drifted ash and the upthrust rubble.
 */

/** Every material the pilot can paint, in priority (paint) order. */
export const NIRVANA_WEST_MATERIALS = Object.freeze([
  // --- fissure floors: the lowest ground in the region -----------------
  "ember", // molten fissure floor, saturated coral. BLOCKS.
  "emberdim", // cooled / welded fissure seam. WALKABLE (the demote target of ember).
  "brine", // dead standing meltwater, near-black with a violet sheen. BLOCKS.
  "glass", // vitrified sheet, near-black with cyan-white crazing. WALKABLE.
  // --- the five tonal tiers of the plain ------------------------------
  "cinder", // burnt black pan with grit.
  "slatedark", // deep shadowed purple-slate.
  "slate", // the anchor purple-slate ground (production continuity).
  "dust", // mid lilac-grey, ash thinly over slate.
  "ash", // pale lilac ash drift.
  "ashpale", // brightest bone-lilac ash crest.
  // --- upthrust / crusted ground: the blocking mass -------------------
  "clinker", // slag reef and joint rubble, angular black-violet. BLOCKS.
  "scree", // broken slate shard field. BLOCKS.
  "rime", // pale salt-frost crust ridge. BLOCKS.
  // --- never sampled in the corner field ------------------------------
  "causeway", // a fused-glass crossing bar laid over blocked ground.
] as const);

export type NirvanaWestMaterial = (typeof NIRVANA_WEST_MATERIALS)[number];

/** The 13 materials that may appear in the corner field (`causeway` may not). */
export const NIRVANA_WEST_FIELD_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze(
  NIRVANA_WEST_MATERIALS.slice(0, 13),
);

/** Priority == index == paint order. */
export const NIRVANA_WEST_MATERIAL_PRIORITY: Readonly<Record<NirvanaWestMaterial, number>> =
  Object.freeze(
    Object.fromEntries(
      NIRVANA_WEST_MATERIALS.map((material, index) => [material, index]),
    ) as Record<NirvanaWestMaterial, number>,
  );

/**
 * Ground a body cannot cross. Everything else is walkable — including
 * `emberdim`, `glass`, `cinder` and every tonal tier, which is what lets the
 * region carry its identity across the fixed shelter plots at zero plot cost.
 */
export const BLOCKING_NIRVANA_WEST_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "brine",
  "clinker",
  "scree",
  "rime",
]);

/**
 * The walkable stand-in each blocking material becomes on shelter-plot ground.
 *
 * This is the pilot's plot-cost discipline, and the pairs are chosen so the
 * demotion is INVISIBLE: a blocking ember vein becomes a cooled ember vein, a
 * rubble reef becomes the burnt pan it sits on, a rime ridge becomes the pale
 * ash it is made of. The picture is continuous; only the collision differs.
 * (Nirvana's first composition lost 100 of 128 plots; Warm Springs proved the
 * fix is to keep the identity walkable rather than to move it out of the way.)
 */
export const NIRVANA_WEST_DEMOTIONS: Readonly<Record<string, NirvanaWestMaterial>> = Object.freeze({
  ember: "emberdim",
  brine: "glass",
  clinker: "cinder",
  scree: "slatedark",
  rime: "ashpale",
});

/** The five tonal tiers of one plain — the gradient that hides the 32px lattice. */
export const PLAIN_TIERS: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder",
  "slatedark",
  "slate",
  "dust",
  "ash",
  "ashpale",
]);

/** Materials whose interiors read as "void" — a tile based on one gets a rim line. */
export const VOID_FAMILY: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "emberdim",
  "brine",
]);

/** Bank materials that carry an authored rim line against the void family. */
export const NIRVANA_WEST_RIM_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder",
  "ashpale",
  "clinker",
]);

/** MUST equal `EDGE_VARIANTS_BY_MATERIAL` in author-nirvana-west-pilot-art.mjs. */
export const NIRVANA_WEST_EDGE_VARIANTS: Readonly<Record<NirvanaWestMaterial, number>> =
  Object.freeze({
    ember: 1,
    emberdim: 1,
    brine: 1,
    glass: 2,
    cinder: 2,
    slatedark: 1,
    slate: 2,
    dust: 1,
    ash: 2,
    ashpale: 1,
    clinker: 2,
    scree: 1,
    rime: 1,
    causeway: 0,
  });

export const NIRVANA_WEST_RIM_VARIANTS = 2;
export const NIRVANA_WEST_BASE_VARIANTS = 8;

/** Corner-mask bit convention. Matches the shipped Nirvana / Warm Springs sheets. */
export const NIRVANA_WEST_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

/** `t.<material>.<variant>` — a base fill. */
export function baseFrameId(material: NirvanaWestMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/** `e.<material>.<mask>.<variant>` — a corner-mask transition (masks 1..14). */
export function edgeFrameId(material: NirvanaWestMaterial, mask: number, variant: number): string {
  return `e.${material}.${mask}.${variant}`;
}

/** `w.<material>.<mask>.<variant>` — a rim line riding the bank's own contour. */
export function rimFrameId(material: NirvanaWestMaterial, mask: number, variant: number): string {
  return `w.${material}.${mask}.${variant}`;
}

export function isVoidMaterial(material: NirvanaWestMaterial): boolean {
  return VOID_FAMILY.includes(material);
}

export function hasRimSet(material: NirvanaWestMaterial): boolean {
  return NIRVANA_WEST_RIM_MATERIALS.includes(material);
}

export function isBlockingMaterial(material: NirvanaWestMaterial): boolean {
  return BLOCKING_NIRVANA_WEST_MATERIALS.includes(material);
}

/** The walkable stand-in for a blocking material on shelter-plot ground. */
export function demotedMaterial(material: NirvanaWestMaterial): NirvanaWestMaterial {
  return NIRVANA_WEST_DEMOTIONS[material] ?? material;
}
