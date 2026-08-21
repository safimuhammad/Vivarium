import type { RegionArchetype } from "../../../renderer/regions/visualRecipe";
import type { RegionCondition } from "./RegionMapIdentity";

export type RegionKitId =
  | "worn-heartland"
  | "spring-terraces"
  | "dry-scrub"
  | "ash-waste"
  | "neutral-temperate";

export type AnimatedEnvironmentKind =
  | "water"
  | "reed"
  | "grass"
  | "shrub"
  | "tree"
  | "ember"
  | "smoke-anchor";

export type ScenicGrammarRole =
  | "worn-oak-grove"
  | "broken-fence-garden"
  | "reclaimed-path-shoulder"
  | "connected-spring-terrace"
  | "spring-hillside-terrace"
  | "reed-bank"
  | "wet-stone-willow"
  | "boardwalk-approach"
  | "sun-rock-outcrop"
  | "deadwood-thorn-crescent"
  | "wind-scrub-clump"
  | "nuclear-crater-fissure"
  | "fractured-industrial-pylon"
  | "slag-charred-ridge"
  | "ash-debris-fan"
  | "restrained-broad-grove"
  | "field-rock-boundary"
  | "wildflower-verge"
  | "satellite-accent";

export type TerrainPatchRole =
  | "picked-over-soil"
  | "worn-path"
  | "mineral-spring-ground"
  | "stepped-terrace-stone"
  | "cracked-earth"
  | "bare-scrub-wear"
  | "plum-charcoal-ground"
  | "coral-ember-fissure"
  | "crater-scar"
  | "temperate-verge"
  | "temperate-damp-verge";

export type VisualPathRole =
  | "reclaimed-path-network"
  | "spring-boardwalk-route"
  | "wind-worn-track"
  | "fractured-service-path"
  | "temperate-field-path";

export type OccupiedHomeContextRole =
  | "worn-homestead-yard"
  | "spring-home-terrace"
  | "bare-scrub-yard"
  | "ash-shelter-apron"
  | "temperate-homestead-yard";

declare const PLANNED_LANDMARK_ID: unique symbol;

/** A planning-only identifier that cannot be supplied as a runtime atlas key. */
export type PlannedLandmarkId = string & {
  readonly [PLANNED_LANDMARK_ID]: "PlannedLandmarkId";
};

/** Semantic future-art vocabulary; production renderers must never load this record. */
export interface PlannedLandmarkPlan {
  readonly recordType: "planned-landmark";
  readonly plannedId: PlannedLandmarkId;
  readonly semanticRole: ScenicGrammarRole;
  readonly runtimeAtlasLookup: false;
}

export interface BiomeSceneGrammar {
  readonly signatureRole: ScenicGrammarRole;
  readonly detachedSignatureRole?: ScenicGrammarRole;
  readonly supportRoles: readonly ScenicGrammarRole[];
  readonly terrainPatchRoles: readonly TerrainPatchRole[];
  readonly visualPathRole: VisualPathRole;
  readonly occupiedHomeContextRole: OccupiedHomeContextRole;
  /** Planning records keyed by semantic role; none is a currently loadable atlas key. */
  readonly plannedLandmarksByRole: Readonly<Partial<Record<ScenicGrammarRole, PlannedLandmarkPlan>>>;
}

export interface BiomeKit {
  readonly id: RegionKitId;
  readonly terrainFamily: "worn" | "spring" | "dry" | "ash" | "temperate";
  readonly groundCode: number;
  readonly waterStride: number;
  readonly blockingScenery: readonly string[];
  readonly passiveScenery: readonly string[];
  readonly animatedKinds: readonly AnimatedEnvironmentKind[];
  readonly sceneGrammar: BiomeSceneGrammar;
}

const KITS: Readonly<Record<RegionKitId, BiomeKit>> = {
  "worn-heartland": {
    id: "worn-heartland", terrainFamily: "worn", groundCode: 11, waterStride: 29,
    blockingScenery: ["old-oak", "worn-stone"], passiveScenery: ["faded-flower", "fallen-fence"],
    animatedKinds: ["grass", "shrub", "tree", "smoke-anchor"],
    sceneGrammar: {
      signatureRole: "worn-oak-grove",
      supportRoles: ["broken-fence-garden", "reclaimed-path-shoulder"],
      terrainPatchRoles: ["picked-over-soil", "worn-path"],
      visualPathRole: "reclaimed-path-network",
      occupiedHomeContextRole: "worn-homestead-yard",
      plannedLandmarksByRole: plannedLandmarks({
        "worn-oak-grove": "old-oak-grove-composite",
        "broken-fence-garden": "broken-fence-garden-composite",
        "reclaimed-path-shoulder": "reclaimed-path-shoulder-composite",
      }),
    },
  },
  "spring-terraces": {
    id: "spring-terraces", terrainFamily: "spring", groundCode: 23, waterStride: 7,
    blockingScenery: ["terrace-rock", "willow"], passiveScenery: ["spring-flower", "reed-bed"],
    animatedKinds: ["water", "reed", "grass", "shrub", "tree"],
    sceneGrammar: {
      signatureRole: "connected-spring-terrace",
      detachedSignatureRole: "spring-hillside-terrace",
      supportRoles: ["reed-bank", "wet-stone-willow", "boardwalk-approach"],
      terrainPatchRoles: ["mineral-spring-ground", "stepped-terrace-stone"],
      visualPathRole: "spring-boardwalk-route",
      occupiedHomeContextRole: "spring-home-terrace",
      plannedLandmarksByRole: plannedLandmarks({
        "connected-spring-terrace": "connected-spring-terrace-composite",
        "spring-hillside-terrace": "spring-hillside-terrace-composite",
        "reed-bank": "reed-bank-composite",
        "wet-stone-willow": "wet-stone-willow-composite",
        "boardwalk-approach": "short-boardwalk-composite",
      }),
    },
  },
  "dry-scrub": {
    id: "dry-scrub", terrainFamily: "dry", groundCode: 37, waterStride: 0,
    blockingScenery: ["sun-rock", "deadwood"], passiveScenery: ["dry-grass", "thorn"],
    animatedKinds: ["grass", "shrub", "smoke-anchor"],
    sceneGrammar: {
      signatureRole: "sun-rock-outcrop",
      supportRoles: ["deadwood-thorn-crescent", "wind-scrub-clump"],
      terrainPatchRoles: ["cracked-earth", "bare-scrub-wear"],
      visualPathRole: "wind-worn-track",
      occupiedHomeContextRole: "bare-scrub-yard",
      plannedLandmarksByRole: plannedLandmarks({
        "sun-rock-outcrop": "sun-rock-outcrop-composite",
        "deadwood-thorn-crescent": "deadwood-thorn-tangle-composite",
        "wind-scrub-clump": "wind-scrub-clump-composite",
      }),
    },
  },
  "ash-waste": {
    id: "ash-waste", terrainFamily: "ash", groundCode: 53, waterStride: 0,
    blockingScenery: ["charred-trunk", "slag-rock"], passiveScenery: ["ash-pile", "bone-stone"],
    animatedKinds: ["ember", "smoke-anchor"],
    sceneGrammar: {
      signatureRole: "nuclear-crater-fissure",
      supportRoles: ["fractured-industrial-pylon", "slag-charred-ridge", "ash-debris-fan"],
      terrainPatchRoles: ["plum-charcoal-ground", "coral-ember-fissure", "crater-scar"],
      visualPathRole: "fractured-service-path",
      occupiedHomeContextRole: "ash-shelter-apron",
      plannedLandmarksByRole: plannedLandmarks({
        "nuclear-crater-fissure": "nuclear-crater-fissure-composite",
        "fractured-industrial-pylon": "fractured-industrial-pylon-composite",
        "slag-charred-ridge": "slag-charred-ridge-composite",
        "ash-debris-fan": "ash-debris-fan-composite",
      }),
    },
  },
  "neutral-temperate": {
    id: "neutral-temperate", terrainFamily: "temperate", groundCode: 71, waterStride: 17,
    blockingScenery: ["broad-tree", "field-rock"], passiveScenery: ["wildflower", "soft-grass"],
    animatedKinds: ["water", "grass", "shrub", "tree"],
    sceneGrammar: {
      signatureRole: "restrained-broad-grove",
      supportRoles: ["field-rock-boundary", "wildflower-verge"],
      terrainPatchRoles: ["temperate-verge", "temperate-damp-verge"],
      visualPathRole: "temperate-field-path",
      occupiedHomeContextRole: "temperate-homestead-yard",
      plannedLandmarksByRole: plannedLandmarks({
        "restrained-broad-grove": "restrained-broad-grove-composite",
        "field-rock-boundary": "field-rock-boundary-composite",
        "wildflower-verge": "wildflower-verge-composite",
      }),
    },
  },
};

function plannedLandmarks(
  values: Readonly<Partial<Record<ScenicGrammarRole, string>>>,
): Readonly<Partial<Record<ScenicGrammarRole, PlannedLandmarkPlan>>> {
  return Object.fromEntries(Object.entries(values).map(([semanticRole, suffix]) => [
    semanticRole,
    {
      recordType: "planned-landmark",
      plannedId: `planned:${suffix}` as PlannedLandmarkId,
      semanticRole: semanticRole as ScenicGrammarRole,
      runtimeAtlasLookup: false,
    },
  ]));
}

/** Select the production map kit for a stable region archetype. */
export function selectBiomeKit(archetype: RegionArchetype): RegionKitId {
  return archetype.replaceAll("_", "-") as RegionKitId;
}

/** Return immutable authored data for one map kit. */
export function getBiomeKit(id: RegionKitId): BiomeKit {
  return KITS[id];
}

/** Derive mutable density/vitality cues while preserving the kit terrain family. */
export function conditionPresentation(id: RegionKitId, condition: RegionCondition): Readonly<{
  terrainFamily: BiomeKit["terrainFamily"];
  nodeDensity: number;
  moteDensity: number;
  vitality: number;
}> {
  const kit = getBiomeKit(id);
  return {
    terrainFamily: kit.terrainFamily,
    nodeDensity: clamp01(condition.materialsRatio),
    moteDensity: clamp01(condition.energyRatio),
    vitality: clamp01((condition.energyRatio + condition.materialsRatio) / 2),
  };
}

function clamp01(value: number): number {
  if (Number.isNaN(value) || value === Number.NEGATIVE_INFINITY) return 0;
  if (value === Number.POSITIVE_INFINITY) return 1;
  return Math.max(0, Math.min(1, value));
}
