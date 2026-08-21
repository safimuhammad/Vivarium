/**
 * @fileoverview The frozen material vocabulary for production Nirvana West.
 *
 * This table, the offline art authoring script and the published atlas
 * (`frontend/src/assets/renderer2d/regions/nirvana-west-v1/atlas.json`) must all
 * agree. Every group below — `NIRVANA_WEST_MATERIALS`, `blockingMaterials`,
 * `edgeVariants`, `plainTiers`, `voidMaterials`, `rimMaterials` and
 * `fieldMaterials` — is checked against the shipped atlas's own top-level fields
 * of the same names by `NirvanaWestAssetProfile.ts` at module load, so a drift
 * between this file and the art is a crash at boot rather than a missing-frame
 * bug found by eye later.
 *
 * Deliberately dependency-free so it can be consumed by every other Nirvana
 * West production module (the terrain field, the recipe adapter, the atlas and
 * the painter) without pulling in the region's terrain logic.
 *
 * Region identity: `nirvana_west` is the `ash_waste` archetype — `config/world.yaml`
 * calls it *"a nuclear wasteland, all but dead"*. The shipped kit already declares
 * the vocabulary this composition honours: a `nuclear-crater-fissure` signature
 * role, a `coral-ember-fissure` terrain patch role, `charred-trunk` / `slag-rock`
 * / `ash-pile` / `bone-stone` scenery and an `ember` ambient emitter. The palette
 * is violet-slate and bone-ash with ONE saturated coral accent — a colour, and
 * more importantly a VALUE, that neither Nirvana (green/blue), Warm Springs
 * (cream/ochre/turquoise) nor Nirvana East (sand) occupies.
 *
 * Priority == array index == paint order. The lowest-priority material present at
 * a tile's four corners becomes the tile's base fill; every higher-priority
 * material is painted over it as a corner-mask transition.
 *
 * **RECONCILED to the published composition-B stack.** Two sessions built this
 * region concurrently and this file was left holding the older 14-material PILOT
 * stack — `brine` and `rime` present, `slab` and `spoil` absent — while the
 * published atlas, `NirvanaWestAssetProfile.ts`, `NirvanaWestAtlas.ts` and
 * `NirvanaWestPainter.ts` had all moved to the merged stack. That half-merge was
 * the defect: this file declared two materials the shipped art carries NO frames
 * for (a scene emitting either would have crashed at paint time), and omitted the
 * two the rest of the region does carry (so the field could never sample them and
 * still type-check). The published atlas is the authority and this table now
 * matches it exactly:
 *
 * - `brine` / `rime` are GONE. They belonged to compositions A and C, which the
 *   owner did not choose; composition B emits zero of either, and the shipped
 *   atlas publishes no frames for them.
 * - `slab` / `spoil` are ADDED, and they are **walkable** — poured concrete apron
 *   and tailings staining. Walkable is the whole point: an apron may run straight
 *   under a shelter plot at zero plot cost, which is what lets ground evidence be
 *   large and central, and they are the only RECTANGULAR shapes in a region
 *   otherwise made of fracture noise — so they are the part of the industrial
 *   push that still reads at island scale, where 100-300 px ruins do not.
 *
 * Only the corner field's variant SALT moves as a result (priority indices shift
 * by one either side of the swap), never a blocking decision: `blocked` is derived
 * from material identity, and the relative order of every material composition B
 * actually emits is unchanged. The region's collision, causeways, shelter plots
 * and seams are therefore bit-identical across this change; the authored
 * `staticSceneHash` is not, and that is the expected, deliberate re-baseline.
 */

/** Every material the production region can paint, in priority (paint) order. */
export const NIRVANA_WEST_MATERIALS = Object.freeze([
  // --- fissure floors: the lowest ground in the region -----------------
  "ember", // molten fissure floor, saturated coral. BLOCKS.
  "emberdim", // cooled / welded fissure seam. WALKABLE (the demote target of ember).
  "glass", // vitrified sheet, near-black with cyan-white crazing. WALKABLE.
  // --- the tonal tiers of the plain -----------------------------------
  "cinder", // burnt black pan with grit.
  "slatedark", // deep shadowed purple-slate.
  "slate", // the anchor purple-slate ground (production continuity).
  "dust", // mid lilac-grey, ash thinly over slate.
  "ash", // pale lilac ash drift.
  "ashpale", // brightest bone-lilac ash crest.
  // --- the industrial ground evidence: rectangular, and WALKABLE ------
  "slab", // poured concrete apron / foundation, warm-neutral, no violet.
  "spoil", // tailings and scorch staining, held dark enough never to read as ember.
  // --- upthrust / crusted ground: the blocking mass -------------------
  "clinker", // slag reef and joint rubble, angular black-violet. BLOCKS.
  "scree", // broken slate shard field. BLOCKS.
  // --- never sampled in the corner field ------------------------------
  "causeway", // a fused-glass crossing bar / connectivity-repair patch laid over blocked ground.
] as const);

/** One of the fourteen frozen Nirvana West materials, in paint-priority order. */
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
 * `emberdim`, `glass`, `cinder`, every tonal tier and both industrial tiers
 * (`slab` / `spoil`), which is what lets the region carry its identity across
 * the fixed shelter plots at zero plot cost.
 */
export const BLOCKING_NIRVANA_WEST_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "clinker",
  "scree",
]);

/**
 * The walkable stand-in each blocking material becomes on protected ground.
 *
 * This is the production plot-cost discipline, and the pairs are chosen so the
 * demotion is INVISIBLE: a blocking ember vein becomes a cooled ember vein, a
 * rubble reef becomes the burnt pan it sits on, and a shard field becomes the
 * slate it broke off. The picture is continuous; only the collision differs. (Nirvana's first
 * composition lost 100 of 128 plots; Warm Springs proved the fix is to keep the
 * identity WALKABLE rather than to move it out of the way.)
 */
export const NIRVANA_WEST_DEMOTIONS: Readonly<Record<string, NirvanaWestMaterial>> = Object.freeze({
  ember: "emberdim",
  clinker: "cinder",
  scree: "slatedark",
});

/** The six tonal tiers of one plain — the gradient that hides the 32px lattice. */
export const NIRVANA_WEST_PLAIN_TIERS: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder",
  "slatedark",
  "slate",
  "dust",
  "ash",
  "ashpale",
]);

/**
 * Materials whose interiors read as "void" — a tile based on one gets a rim line.
 *
 * Two, not three: `brine` left with composition A. Matches the published atlas's own
 * `voidMaterials` field exactly.
 */
export const NIRVANA_WEST_VOID_FAMILY: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "emberdim",
]);

/** Bank materials that carry an authored rim line against the void family. */
export const NIRVANA_WEST_RIM_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder",
  "ashpale",
  "clinker",
]);

/**
 * MUST equal both `EDGE_VARIANTS_BY_MATERIAL` in the offline art authoring
 * script and `atlas.json`'s own `edgeVariants` field — pinned against the
 * shipped `nirvana-west-v1` generation, which publishes 2 edge variants per mask
 * for `glass`, `cinder`, `slate`, `ash`, `slab`, `spoil` and `clinker`, 1 for the
 * rest, and none at all for `causeway`.
 */
export const NIRVANA_WEST_EDGE_VARIANTS: Readonly<Record<NirvanaWestMaterial, number>> =
  Object.freeze({
    ember: 1,
    emberdim: 1,
    glass: 2,
    cinder: 2,
    slatedark: 1,
    slate: 2,
    dust: 1,
    ash: 2,
    ashpale: 1,
    slab: 2,
    spoil: 2,
    clinker: 2,
    scree: 1,
    causeway: 0,
  });

export const NIRVANA_WEST_RIM_VARIANTS = 2;
export const NIRVANA_WEST_BASE_VARIANTS = 8;

/**
 * Corner-mask bit convention. Matches the shipped Nirvana / Warm Springs / Nirvana
 * West atlas sheets: bit 1 = NW, bit 2 = NE, bit 4 = SE, bit 8 = SW.
 */
export const NIRVANA_WEST_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

/** `t.<material>.<variant>` — a base fill. */
export function nirvanaWestBaseFrameId(material: NirvanaWestMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/** `e.<material>.<mask>.<variant>` — a corner-mask transition (masks 1..14). */
export function nirvanaWestEdgeFrameId(
  material: NirvanaWestMaterial,
  mask: number,
  variant: number,
): string {
  return `e.${material}.${mask}.${variant}`;
}

/** `w.<material>.<mask>.<variant>` — a rim line riding the bank's own contour. */
export function nirvanaWestRimFrameId(
  material: NirvanaWestMaterial,
  mask: number,
  variant: number,
): string {
  return `w.${material}.${mask}.${variant}`;
}

/** True when `material`'s interior reads as void (ember / emberdim / brine). */
export function isNirvanaWestVoidMaterial(material: NirvanaWestMaterial): boolean {
  return NIRVANA_WEST_VOID_FAMILY.includes(material);
}

/** True when `material` is a bank that carries an authored rim-line set. */
export function hasNirvanaWestRimSet(material: NirvanaWestMaterial): boolean {
  return NIRVANA_WEST_RIM_MATERIALS.includes(material);
}

/** True when `material` blocks movement. */
export function isBlockingNirvanaWestMaterial(material: NirvanaWestMaterial): boolean {
  return BLOCKING_NIRVANA_WEST_MATERIALS.includes(material);
}

/** The walkable stand-in for a blocking material on protected ground. */
export function demotedNirvanaWestMaterial(material: NirvanaWestMaterial): NirvanaWestMaterial {
  return NIRVANA_WEST_DEMOTIONS[material] ?? material;
}
