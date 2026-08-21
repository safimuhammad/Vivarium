import type { ProductionRigId } from "../assets/productionManifest";

export const RIGS = Object.freeze(["human-a", "human-b"] as const satisfies readonly ProductionRigId[]);
export const SKIN_RAMPS = Object.freeze([
  "porcelain",
  "warm",
  "tan",
  "brown",
  "deep",
  "umber",
] as const);
export const HAIR_SILHOUETTES = Object.freeze([
  "crop",
  "messy",
  "waves",
  "bob",
  "braid",
  "bun",
  "coils",
  "short-curls",
] as const);
export const HAIR_RAMPS = Object.freeze([
  "espresso",
  "chestnut",
  "gold",
  "copper",
  "charcoal",
  "silver",
] as const);
export const CLOTHING_SILHOUETTES = Object.freeze([
  "work-shirt-sash",
  "short-jacket",
  "field-vest",
  "apron-wrap",
  "scarf-overshirt",
  "rolled-tunic",
  "utility-smock",
  "travel-shirt",
] as const);
export const CLOTHING_PALETTES = Object.freeze([
  "olive",
  "teal",
  "ochre",
  "rust",
  "slate",
  "plum",
  "cream",
  "denim",
] as const);
export const PERSONA_ACCENTS = Object.freeze([
  "thread-ochre",
  "thread-teal",
  "thread-plum",
  "thread-clay",
] as const);

export interface HumanAppearance {
  readonly rig: ProductionRigId;
  readonly skinRamp: (typeof SKIN_RAMPS)[number];
  readonly hairSilhouette: (typeof HAIR_SILHOUETTES)[number];
  readonly hairRamp: (typeof HAIR_RAMPS)[number];
  readonly clothingSilhouette: (typeof CLOTHING_SILHOUETTES)[number];
  readonly clothingPalette: (typeof CLOTHING_PALETTES)[number];
  readonly secondaryAccent: (typeof PERSONA_ACCENTS)[number] | null;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function select<T>(agentId: string, domain: string, inventory: readonly T[]): T {
  return inventory[stableHash(`${agentId}\0${domain}`) % inventory.length]!;
}

/** Derive immutable, category-agnostic production appearance from one complete agent ID. */
export function deriveHumanAppearance(agentId: string, persona?: string): HumanAppearance {
  if (typeof agentId !== "string" || agentId.trim().length === 0) {
    throw new TypeError("Human appearance requires a non-empty complete agent ID.");
  }
  const personaValue = typeof persona === "string" ? persona.trim() : "";
  return Object.freeze({
    rig: select(agentId, "rig", RIGS),
    skinRamp: select(agentId, "skin", SKIN_RAMPS),
    hairSilhouette: select(agentId, "hair-silhouette", HAIR_SILHOUETTES),
    hairRamp: select(agentId, "hair-ramp", HAIR_RAMPS),
    clothingSilhouette: select(agentId, "clothing-silhouette", CLOTHING_SILHOUETTES),
    clothingPalette: select(agentId, "clothing-palette", CLOTHING_PALETTES),
    secondaryAccent: personaValue.length === 0
      ? null
      : PERSONA_ACCENTS[
        stableHash(`${agentId}\0persona-accent\0${personaValue}`) % PERSONA_ACCENTS.length
      ]!,
  });
}
