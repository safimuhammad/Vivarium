/** Pure, capacity-derived expansion planning for the production Nirvana region. */

import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  type NirvanaChunkCoord,
} from "./NirvanaRegionV2";

const ALGORITHM_VERSION = 1 as const;
const BASE_CHUNK_COLUMNS = 2 as const;
const BASE_CHUNK_ROWS = 3 as const;
const RESERVED_DISTRICT_COUNT = 1 as const;
const FIXED_DIRECTION_ORDER: Readonly<Record<ExpansionDirection, number>> =
  Object.freeze({ east: 0, south: 1 });

/** Hard safety ceiling that prevents malformed snapshots from driving unbounded planning. */
export const MAX_NIRVANA_REQUIRED_DISTRICTS = 4_096 as const;

export interface NirvanaGrowthPressure {
  readonly populationHighWater: number;
  readonly builtFootprintHighWater: number;
}

export interface NirvanaGrowthCapacity {
  readonly populationPerDistrict: number;
  readonly builtFootprintPerDistrict: number;
  readonly reservedDistrictCount: 1;
  readonly basePopulationWithoutReserve: number;
  readonly baseBuiltFootprintWithoutReserve: number;
  readonly targetDistrictCount: number;
  readonly targetPopulationWithoutReserve: number;
  readonly targetBuiltFootprintWithoutReserve: number;
}

/** Immutable geometry receipt consumed by later recipe and cache integration. */
export interface NirvanaGrowthPlan {
  readonly regionId: "nirvana";
  readonly algorithmVersion: 1;
  /**
   * Geometry generation version. Zero is Genesis; each appended chunk advances it.
   * It therefore remains stable while pressure moves inside the same geometry tier.
   */
  readonly growthVersion: number;
  readonly growthHash: string;
  readonly pressure: NirvanaGrowthPressure;
  readonly baseChunkColumns: 2;
  readonly baseChunkRows: 3;
  readonly targetChunkColumns: number;
  readonly targetChunkRows: number;
  readonly targetTileColumns: number;
  readonly targetTileRows: number;
  readonly baseDistrictCount: number;
  readonly requiredDistrictCount: number;
  readonly addedChunkCoords: readonly NirvanaChunkCoord[];
  readonly capacity: NirvanaGrowthCapacity;
}

type ExpansionDirection = "east" | "south";

interface ExpansionCandidate {
  readonly direction: ExpansionDirection;
  readonly chunkColumns: number;
  readonly chunkRows: number;
  readonly addedCoords: readonly NirvanaChunkCoord[];
  readonly aspectScore: number;
}

/**
 * Plan append-only rectangular Nirvana growth from real recipe capacity.
 *
 * Passing the last published plan makes this function monotonic even if a malformed
 * caller supplies a lower observation than the durable high-water snapshot.
 */
export function planNirvanaGrowth(
  baseRecipe: RegionMapRecipeV1,
  pressure: NirvanaGrowthPressure,
  previousPlan?: NirvanaGrowthPlan,
): NirvanaGrowthPlan {
  const capacity = deriveBaseCapacity(baseRecipe);
  const requestedPressure = ownPressure(pressure);
  const effectivePressure = previousPlan === undefined
    ? requestedPressure
    : ownPressure({
        populationHighWater: Math.max(
          requestedPressure.populationHighWater,
          previousPlan.pressure.populationHighWater,
        ),
        builtFootprintHighWater: Math.max(
          requestedPressure.builtFootprintHighWater,
          previousPlan.pressure.builtFootprintHighWater,
        ),
      });
  const requiredDistrictCount = Math.max(
    capacity.baseDistrictCount,
    Math.ceil(effectivePressure.populationHighWater / capacity.populationPerDistrict)
      + RESERVED_DISTRICT_COUNT,
    Math.ceil(effectivePressure.builtFootprintHighWater / capacity.builtFootprintPerDistrict)
      + RESERVED_DISTRICT_COUNT,
  );
  if (requiredDistrictCount > MAX_NIRVANA_REQUIRED_DISTRICTS) {
    throw new Error(
      `Nirvana growth pressure requires an unreasonable ${requiredDistrictCount} districts`,
    );
  }

  let chunkColumns: number = BASE_CHUNK_COLUMNS;
  let chunkRows: number = BASE_CHUNK_ROWS;
  const addedChunkCoords: NirvanaChunkCoord[] = [];
  while (capacity.baseDistrictCount + addedChunkCoords.length < requiredDistrictCount) {
    const candidate = chooseExpansion(chunkColumns, chunkRows);
    chunkColumns = candidate.chunkColumns;
    chunkRows = candidate.chunkRows;
    addedChunkCoords.push(...candidate.addedCoords);
    if (
      capacity.baseDistrictCount + addedChunkCoords.length
      > MAX_NIRVANA_REQUIRED_DISTRICTS + Math.max(chunkColumns, chunkRows)
    ) {
      throw new Error("Nirvana growth planner exceeded its bounded district ceiling");
    }
  }

  const ownedCoords = Object.freeze(
    addedChunkCoords.map(({ column, row }) => Object.freeze({ column, row })),
  );
  const targetDistrictCount = capacity.baseDistrictCount + ownedCoords.length;
  const ownedCapacity: NirvanaGrowthCapacity = Object.freeze({
    populationPerDistrict: capacity.populationPerDistrict,
    builtFootprintPerDistrict: capacity.builtFootprintPerDistrict,
    reservedDistrictCount: RESERVED_DISTRICT_COUNT,
    basePopulationWithoutReserve:
      (capacity.baseDistrictCount - RESERVED_DISTRICT_COUNT) * capacity.populationPerDistrict,
    baseBuiltFootprintWithoutReserve:
      (capacity.baseDistrictCount - RESERVED_DISTRICT_COUNT) * capacity.builtFootprintPerDistrict,
    targetDistrictCount,
    targetPopulationWithoutReserve:
      (targetDistrictCount - RESERVED_DISTRICT_COUNT) * capacity.populationPerDistrict,
    targetBuiltFootprintWithoutReserve:
      (targetDistrictCount - RESERVED_DISTRICT_COUNT) * capacity.builtFootprintPerDistrict,
  });
  const geometryReceipt = {
    algorithmVersion: ALGORITHM_VERSION,
    baseDistrictCount: capacity.baseDistrictCount,
    populationPerDistrict: capacity.populationPerDistrict,
    builtFootprintPerDistrict: capacity.builtFootprintPerDistrict,
    targetChunkColumns: chunkColumns,
    targetChunkRows: chunkRows,
    addedChunkCoords: ownedCoords,
  };

  return Object.freeze({
    regionId: "nirvana",
    algorithmVersion: ALGORITHM_VERSION,
    growthVersion: ownedCoords.length,
    growthHash: stableHash(geometryReceipt),
    pressure: effectivePressure,
    baseChunkColumns: BASE_CHUNK_COLUMNS,
    baseChunkRows: BASE_CHUNK_ROWS,
    targetChunkColumns: chunkColumns,
    targetChunkRows: chunkRows,
    targetTileColumns: chunkColumns * NIRVANA_CHUNK_COLUMNS,
    targetTileRows: chunkRows * NIRVANA_CHUNK_ROWS,
    baseDistrictCount: capacity.baseDistrictCount,
    requiredDistrictCount,
    addedChunkCoords: ownedCoords,
    capacity: ownedCapacity,
  });
}

function deriveBaseCapacity(recipe: RegionMapRecipeV1): Readonly<{
  baseDistrictCount: number;
  populationPerDistrict: number;
  builtFootprintPerDistrict: number;
}> {
  if (recipe.regionId !== "nirvana") {
    throw new Error("Nirvana growth requires the exact Nirvana base recipe");
  }
  if (
    recipe.grid.columns !== BASE_CHUNK_COLUMNS * NIRVANA_CHUNK_COLUMNS
    || recipe.grid.rows !== BASE_CHUNK_ROWS * NIRVANA_CHUNK_ROWS
  ) {
    throw new Error("Nirvana growth requires the exact 2x3 Genesis chunk grid");
  }
  if (recipe.districts.length === 0) {
    throw new Error("Nirvana growth requires at least one base district");
  }
  const populationPerDistrict = recipe.districts[0]!.stagingPoints.length;
  const builtFootprintPerDistrict = recipe.districts[0]!.shelterPlots.length;
  if (populationPerDistrict <= 0 || builtFootprintPerDistrict <= 0) {
    throw new Error("Nirvana districts must provide positive capacity");
  }
  if (recipe.districts.some((district) =>
    district.stagingPoints.length !== populationPerDistrict
    || district.stagingAnchors.length !== populationPerDistrict
    || district.shelterPlots.length !== builtFootprintPerDistrict)) {
    throw new Error("Nirvana growth requires uniform district capacity");
  }
  if (
    recipe.stagingPoints.length !== recipe.districts.length * populationPerDistrict
    || recipe.shelterPlots.length !== recipe.districts.length * builtFootprintPerDistrict
  ) {
    throw new Error("Nirvana global capacity must equal its uniform district capacity");
  }
  return Object.freeze({
    baseDistrictCount: recipe.districts.length,
    populationPerDistrict,
    builtFootprintPerDistrict,
  });
}

function ownPressure(pressure: NirvanaGrowthPressure): NirvanaGrowthPressure {
  assertNonNegativeSafeInteger(
    pressure.populationHighWater,
    "population high-water",
  );
  assertNonNegativeSafeInteger(
    pressure.builtFootprintHighWater,
    "built footprint high-water",
  );
  return Object.freeze({
    populationHighWater: pressure.populationHighWater,
    builtFootprintHighWater: pressure.builtFootprintHighWater,
  });
}

function chooseExpansion(
  chunkColumns: number,
  chunkRows: number,
): ExpansionCandidate {
  const candidates: readonly ExpansionCandidate[] = [
    {
      direction: "east",
      chunkColumns: chunkColumns + 1,
      chunkRows,
      addedCoords: Object.freeze(Array.from(
        { length: chunkRows },
        (_, row) => Object.freeze({ column: chunkColumns, row }),
      )),
      aspectScore: physicalAspectScore(chunkColumns + 1, chunkRows),
    },
    {
      direction: "south",
      chunkColumns,
      chunkRows: chunkRows + 1,
      addedCoords: Object.freeze(Array.from(
        { length: chunkColumns },
        (_, column) => Object.freeze({ column, row: chunkRows }),
      )),
      aspectScore: physicalAspectScore(chunkColumns, chunkRows + 1),
    },
  ];
  return [...candidates].sort((left, right) =>
    left.aspectScore - right.aspectScore
    || left.addedCoords.length - right.addedCoords.length
    || FIXED_DIRECTION_ORDER[left.direction] - FIXED_DIRECTION_ORDER[right.direction])[0]!;
}

function physicalAspectScore(chunkColumns: number, chunkRows: number): number {
  const width = chunkColumns * NIRVANA_CHUNK_COLUMNS;
  const height = chunkRows * NIRVANA_CHUNK_ROWS;
  return Math.abs(Math.log(width / height));
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Nirvana ${label} must be a non-negative safe integer`);
  }
}

function stableHash(value: unknown): string {
  const source = JSON.stringify(canonicalJson(value));
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  );
}
