import type { WorldSnapshot } from "../../../app/schemas";
import {
  cloneTrustedRegionMapRecipe,
  serializeRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { PlacementLedger, type PlacementLedgerSnapshot } from "./PlacementLedger";

export interface PreparedPlacementGeneration {
  readonly runId: string;
  readonly eventCursor: number;
}

/** Owns one replaceable placement generation for a single run and recipe set. */
export interface PlacementGenerationOwner {
  readonly ownerId: symbol;
  readonly runId: string;
  generation(): number;
  /** Monotonic revision advanced only when the committed canonical recipe set changes. */
  spatialGeneration(): number;
  current(): PlacementLedger;
  snapshot(): PlacementLedgerSnapshot;
  recipes(): ReadonlyMap<string, RegionMapRecipeV1>;
  prepareFromSnapshot(snapshot: WorldSnapshot): PreparedPlacementGeneration;
  commitPrepared(prepared: PreparedPlacementGeneration): void;
  rollbackPrepared(prepared: PreparedPlacementGeneration): void;
  dispose(): void;
}

interface OwnedPreparedPlacementGeneration extends PreparedPlacementGeneration {
  readonly owner: symbol;
  readonly baseGeneration: number;
  readonly ledger: PlacementLedger;
  readonly priorLedger: PlacementLedger;
  readonly recipes: readonly RegionMapRecipeV1[];
  readonly priorRecipes: readonly RegionMapRecipeV1[];
  readonly spatialIdentity: string;
  readonly priorSpatialIdentity: string;
  readonly spatialChanged: boolean;
  readonly state: { status: "prepared" | "committed" | "rolled-back" };
}

/** Rebuild the trusted recipe set from one exact recovery snapshot off-side. */
export type PlacementRecipeResolver = (
  snapshot: WorldSnapshot,
) => readonly RegionMapRecipeV1[];

/** Create an owner whose active ledger changes only after a prepared candidate commits. */
export function createPlacementGenerationOwner(
  recipes: readonly RegionMapRecipeV1[],
  snapshot: WorldSnapshot,
  recipeResolver?: PlacementRecipeResolver,
): PlacementGenerationOwner {
  const owner = Symbol("placement-generation-owner");
  let activeRecipes = ownExactRecipeSet(recipes, snapshot);
  let activeSpatialIdentity = recipeSetSpatialIdentity(activeRecipes);
  let generation = 0;
  let spatialGeneration = 0;
  let active = PlacementLedger.reconstruct(activeRecipes, checkpointFrom(snapshot));
  let disposed = false;

  return {
    ownerId: owner,
    runId: snapshot.run_id,
    generation(): number {
      return generation;
    },
    spatialGeneration(): number {
      return spatialGeneration;
    },
    current(): PlacementLedger {
      return active;
    },
    snapshot(): PlacementLedgerSnapshot {
      return active.snapshot();
    },
    recipes(): ReadonlyMap<string, RegionMapRecipeV1> {
      return new Map(activeRecipes.map((recipe) => [
        recipe.regionId,
        cloneTrustedRegionMapRecipe(recipe),
      ]));
    },
    prepareFromSnapshot(next): PreparedPlacementGeneration {
      if (disposed) throw new Error("placement generation owner is disposed");
      if (next.run_id !== snapshot.run_id) {
        throw new Error("placement recovery candidate must retain the active run");
      }
      const checkpoint = {
        agents: next.agents,
        homes: [...next.homes, ...next.ruins],
      };
      const candidateRecipes = recipeResolver === undefined
        ? activeRecipes
        : ownExactRecipeSet(recipeResolver(structuredClone(next)), next);
      const spatialIdentity = recipeSetSpatialIdentity(candidateRecipes);
      const spatialChanged = spatialIdentity !== activeSpatialIdentity;
      const ledger = !spatialChanged && active.hasEquivalentCheckpointPlacement(checkpoint)
        ? active
        : PlacementLedger.reconstruct(candidateRecipes, checkpoint);
      return Object.freeze<OwnedPreparedPlacementGeneration>({
        owner,
        baseGeneration: generation,
        runId: next.run_id,
        eventCursor: next.event_cursor,
        ledger,
        priorLedger: active,
        recipes: spatialChanged ? candidateRecipes : activeRecipes,
        priorRecipes: activeRecipes,
        spatialIdentity: spatialChanged ? spatialIdentity : activeSpatialIdentity,
        priorSpatialIdentity: activeSpatialIdentity,
        spatialChanged,
        state: { status: "prepared" },
      });
    },
    commitPrepared(value): void {
      const prepared = value as OwnedPreparedPlacementGeneration;
      if (disposed) throw new Error("placement generation owner is disposed");
      if (
        prepared.owner !== owner
        || prepared.baseGeneration !== generation
        || prepared.state.status !== "prepared"
      ) {
        throw new Error("prepared placement generation is stale or belongs to another owner");
      }
      active = prepared.ledger;
      activeRecipes = prepared.recipes;
      activeSpatialIdentity = prepared.spatialIdentity;
      generation += 1;
      if (prepared.spatialChanged) spatialGeneration += 1;
      prepared.state.status = "committed";
    },
    rollbackPrepared(value): void {
      const prepared = value as OwnedPreparedPlacementGeneration;
      if (
        disposed
        || prepared.owner !== owner
        || prepared.state.status !== "committed"
        || prepared.baseGeneration + 1 !== generation
        || active !== prepared.ledger
      ) return;
      active = prepared.priorLedger;
      activeRecipes = prepared.priorRecipes;
      activeSpatialIdentity = prepared.priorSpatialIdentity;
      generation += 1;
      if (prepared.spatialChanged) spatialGeneration += 1;
      prepared.state.status = "rolled-back";
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
    },
  };
}

function ownExactRecipeSet(
  recipes: readonly RegionMapRecipeV1[],
  snapshot: WorldSnapshot,
): readonly RegionMapRecipeV1[] {
  const byRegion = new Map<string, RegionMapRecipeV1>();
  for (const recipe of recipes) {
    if (byRegion.has(recipe.regionId)) {
      throw new Error(`placement recipes contain duplicate region ${recipe.regionId}`);
    }
    byRegion.set(recipe.regionId, cloneTrustedRegionMapRecipe(recipe));
  }
  const expected = new Set(snapshot.regions.map(({ name }) => name));
  if (expected.size !== snapshot.regions.length || byRegion.size !== expected.size) {
    throw new Error("placement recipes must exactly cover snapshot regions");
  }
  for (const regionId of byRegion.keys()) {
    if (!expected.has(regionId)) {
      throw new Error("placement recipes must exactly cover snapshot regions");
    }
  }
  return Object.freeze(snapshot.regions.map(({ name }) => {
    const recipe = byRegion.get(name);
    if (recipe === undefined) {
      throw new Error("placement recipes must exactly cover snapshot regions");
    }
    return recipe;
  }));
}

function recipeSetSpatialIdentity(recipes: readonly RegionMapRecipeV1[]): string {
  return [...recipes]
    .sort((left, right) => left.regionId.localeCompare(right.regionId))
    .map((recipe) => {
      const serialized = serializeRegionMapRecipe(recipe);
      return `${recipe.regionId.length}:${recipe.regionId}:${serialized.length}:${serialized}`;
    })
    .join("|");
}

function checkpointFrom(snapshot: WorldSnapshot): Readonly<{
  agents: WorldSnapshot["agents"];
  homes: WorldSnapshot["homes"];
}> {
  return {
    agents: snapshot.agents,
    homes: [...snapshot.homes, ...snapshot.ruins],
  };
}
