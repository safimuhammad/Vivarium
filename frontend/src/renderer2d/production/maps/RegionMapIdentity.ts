import type { RegionSnapshot } from "../../../app/schemas";
import type { RegionArchetype } from "../../../renderer/regions/visualRecipe";
import { buildDirectedRegionEdges, type DirectedRegionEdge, stableHash } from "./directedTopology";
import {
  clampAbundanceRatio,
  decideAssetFallback,
  type ProductionFailureDiagnostic,
} from "../failurePolicy";

export interface RegionMapIdentity {
  readonly runSeed: number;
  readonly regionId: string;
  readonly normalizedDescription: string;
  readonly archetype: RegionArchetype;
  readonly potential: Readonly<{
    energyRate: number;
    materialsRate: number;
    maxEnergy: number;
    maxMaterials: number;
  }>;
  readonly directedTopology: readonly DirectedRegionEdge[];
  readonly recipeVersion: 1;
  readonly diagnostics?: readonly ProductionFailureDiagnostic[];
}

export interface RegionCondition {
  readonly energyRatio: number;
  readonly materialsRatio: number;
  readonly diagnostics?: readonly ProductionFailureDiagnostic[];
}

const ARCHETYPE_RULES: readonly [readonly string[], RegionArchetype][] = [
  [["nuclear", "wasteland", "all but dead"], "ash_waste"],
  [["hot spring", "spring lake"], "spring_terraces"],
  [["near barren", "barren", "struggling"], "dry_scrub"],
  [["picked over", "thinning", "once heavenly"], "worn_heartland"],
];

/** Derive immutable map identity from run seed and static backend configuration. */
export function createRegionMapIdentity(
  runSeed: number,
  region: RegionSnapshot,
  regions: readonly RegionSnapshot[],
): RegionMapIdentity {
  if (!Number.isSafeInteger(runSeed)) throw new Error("run seed must be a safe integer");
  const normalizedDescription = normalizeDescription(region.description);
  const archetype = classifyArchetype(normalizedDescription);
  const fallback = archetype === "neutral_temperate"
    ? decideAssetFallback({
        failure: "unknown-region",
        subjectId: null,
        regionId: region.name,
        occurrence: 1,
      })
    : null;
  return {
    runSeed,
    regionId: region.name,
    normalizedDescription,
    archetype,
    potential: {
      energyRate: region.energy_rate,
      materialsRate: region.materials_rate,
      maxEnergy: region.max_energy,
      maxMaterials: region.max_materials,
    },
    directedTopology: buildDirectedRegionEdges(regions),
    recipeVersion: 1,
    ...(fallback?.action === "continue" ? { diagnostics: [fallback.diagnostic] } : {}),
  };
}

/** Derive mutable abundance cues without changing static terrain identity. */
export function deriveRegionCondition(region: RegionSnapshot): RegionCondition {
  const energy = clampAbundanceRatio({
    current: region.current_energy,
    maximum: region.max_energy,
    code: "invalid-energy-abundance-ratio",
    subjectId: null,
    regionId: region.name,
    occurrence: 1,
  });
  const materials = clampAbundanceRatio({
    current: region.current_materials,
    maximum: region.max_materials,
    code: "invalid-materials-abundance-ratio",
    subjectId: null,
    regionId: region.name,
    occurrence: 1,
  });
  const diagnostics = [energy.diagnostic, materials.diagnostic].filter(
    (value): value is ProductionFailureDiagnostic => value !== null,
  );
  return {
    energyRatio: energy.value,
    materialsRatio: materials.value,
    ...(diagnostics.length > 0 ? { diagnostics: Object.freeze(diagnostics) } : {}),
  };
}

/** Serialize an identity canonically for stable recipe caches and drift checks. */
export function regionMapIdentityHash(identity: RegionMapIdentity): string {
  return stableHash(JSON.stringify(identity)).toString(16).padStart(8, "0");
}

function classifyArchetype(description: string): RegionArchetype {
  return ARCHETYPE_RULES.find(([keywords]) => keywords.some((keyword) => description.includes(keyword)))?.[1] ?? "neutral_temperate";
}

function normalizeDescription(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
