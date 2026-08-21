import type { RegionSnapshot } from "../../app/schemas";

export const REGION_VISUAL_RECIPE_VERSION = 1 as const;

export type RegionArchetype =
  | "ash_waste"
  | "spring_terraces"
  | "dry_scrub"
  | "worn_heartland"
  | "neutral_temperate";

export interface RegionVisualRecipeV1 {
  version: typeof REGION_VISUAL_RECIPE_VERSION;
  regionId: string;
  visualSeed: number;
  archetype: RegionArchetype;
  identity: {
    source: "description-keyword" | "fallback";
    normalizedDescription: string;
  };
  potential: {
    energyRate: number;
    materialsRate: number;
    maxEnergy: number;
    maxMaterials: number;
  };
  condition: { energyRatio: number; materialsRatio: number };
}

const ARCHETYPE_RULES: readonly [readonly string[], RegionArchetype][] = [
  [["nuclear", "wasteland", "all but dead"], "ash_waste"],
  [["hot spring", "spring lake"], "spring_terraces"],
  [["near barren", "barren", "struggling"], "dry_scrub"],
  [["picked over", "thinning", "once heavenly"], "worn_heartland"],
];

/** Derive stable visual identity and mutable condition data from a region snapshot. */
export function deriveRegionVisualRecipe(
  region: RegionSnapshot,
): RegionVisualRecipeV1 {
  const normalizedDescription = normalizeDescription(region.description);
  const archetype =
    ARCHETYPE_RULES.find(([keywords]) =>
      keywords.some((keyword) => normalizedDescription.includes(keyword)),
    )?.[1] ?? "neutral_temperate";

  return {
    version: REGION_VISUAL_RECIPE_VERSION,
    regionId: region.name,
    visualSeed: stringHash(region.name),
    archetype,
    identity: {
      source:
        archetype === "neutral_temperate"
          ? "fallback"
          : "description-keyword",
      normalizedDescription,
    },
    potential: {
      energyRate: region.energy_rate,
      materialsRate: region.materials_rate,
      maxEnergy: region.max_energy,
      maxMaterials: region.max_materials,
    },
    condition: {
      energyRatio: ratio(region.current_energy, region.max_energy),
      materialsRatio: ratio(region.current_materials, region.max_materials),
    },
  };
}

/** Serialize recipes in a canonical order suitable for cache and drift checks. */
export function regionVisualRecipeHash(
  recipes: readonly RegionVisualRecipeV1[],
): string {
  return JSON.stringify(
    [...recipes].sort((left, right) => {
      const regionOrder = compareText(left.regionId, right.regionId);
      return regionOrder !== 0
        ? regionOrder
        : compareText(JSON.stringify(left), JSON.stringify(right));
    }),
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeDescription(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function ratio(current: number, maximum: number): number {
  return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0;
}

function stringHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
