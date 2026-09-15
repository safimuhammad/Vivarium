/** Shared production-map contract for physical navigation and the simulation backend. */
import { TILE_SIZE, tileCenter, type TileCoord } from "../../map/regionMap";
import { findNavigationPath, type NavigationGrid } from "./navigation";
import { regionMapRecipeHash, type RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import type { NirvanaGrowthPressure } from "../nirvana/NirvanaGrowthPolicy";
import { homeFootprintExclusionRects } from "../productionGeometry";

/** One named destination exported to the backend and navigation consumers. */
export interface SpatialLandmarkExport {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly affordances: readonly string[];
}

/** One authoritative directed gate from a concrete production recipe. */
export interface SpatialGateExport {
  readonly from_region: string;
  readonly to_region: string;
  readonly role: "arrival" | "departure";
  readonly x: number;
  readonly y: number;
}

/** One point in the exported map's pixel coordinate system. */
export interface SpatialPointExport {
  readonly x: number;
  readonly y: number;
}

/** One exported shelter plot and its hard runtime exclusion rectangles. */
export interface SpatialHomePlotExport extends SpatialPointExport {
  readonly id: string;
  readonly door: SpatialPointExport;
  readonly hard_rects: readonly Readonly<{
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }>[];
}

/** Version-one export for one concrete production region. */
export interface SpatialNavigationExportV1 {
  readonly version: 1;
  readonly region_id: string;
  readonly map_id: string;
  readonly layout_fingerprint: string;
  readonly tile_size: number;
  readonly width: number;
  readonly height: number;
  readonly topology: "bounded";
  readonly walkable: readonly (readonly number[])[];
  readonly landmarks: readonly SpatialLandmarkExport[];
  readonly spawn_points: readonly SpatialPointExport[];
  readonly gates: readonly SpatialGateExport[];
  readonly initial_pressure: Readonly<NirvanaGrowthPressure>;
  readonly home_plots: readonly SpatialHomePlotExport[];
}

/** Input pair used to assemble one map in a version-two navigation bundle. */
export interface SpatialNavigationBundleInput {
  readonly recipe: RegionMapRecipeV1;
  readonly initialPressure: NirvanaGrowthPressure;
}

/** Version-two bundle containing one version-one export for every input region. */
export interface SpatialNavigationBundleV2 {
  readonly version: 2;
  readonly regions: readonly SpatialNavigationExportV1[];
}

/** Fingerprint the complete concrete recipe, including growth and collision bytes. */
export function navigationLayoutFingerprint(recipe: RegionMapRecipeV1): string {
  return regionMapRecipeHash(recipe);
}

/**
 * Export bounded ground navigation without modifying the authored map.
 *
 * The exporter copies the recipe's collision bytes into a backend-compatible bounded
 * walkable grid, then proves every spawn, social/resource, and gate anchor against that
 * exact grid. Scenic interaction exclusions remain presentation-owned blocks in the
 * exported grid, so a landmark can never be emitted on a tile the backend cannot enter.
 *
 * @param recipe - Trusted concrete production recipe for one region.
 * @param initialPressure - Frozen pressure that selected this recipe's growth tier.
 * @returns A version-one navigation artifact for the concrete region.
 * @throws If the recipe, pressure, gates, anchors, or their routes are invalid.
 */
export function createSpatialNavigationExport(
  recipe: RegionMapRecipeV1,
  initialPressure: NirvanaGrowthPressure,
): SpatialNavigationExportV1 {
  validateRecipeShape(recipe);
  validatePressure(initialPressure);
  validateGrid(recipe.grid);
  const { columns: width, rows: height } = recipe.grid;
  const walkable = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, column) =>
      recipe.grid.collision[row * width + column] === 0 ? 1 : 0));

  // These authored bodies intentionally do not alter terrain collision. Feet must
  // nevertheless stay outside them, just as the existing renderer's routes do.
  for (const landmark of recipe.scenicLandmarks) {
    validateTile(landmark.contactTile, recipe.grid, `scenic landmark ${landmark.id} contact`);
    for (const offset of landmark.interactionExclusionOffsets) {
      if (!Number.isSafeInteger(offset.x) || !Number.isSafeInteger(offset.y)) {
        throw new Error(`scenic landmark ${landmark.id} exclusion offset must be an integer`);
      }
      const x = landmark.contactTile.column + offset.x;
      const y = landmark.contactTile.row + offset.y;
      if (x >= 0 && x < width && y >= 0 && y < height) walkable[y]![x] = 0;
    }
  }

  const open = (tile: TileCoord, label: string): void => {
    validateTile(tile, recipe.grid, label);
    if (walkable[tile.row]![tile.column] !== 1) {
      throw new Error(`${label} ${tileKey(tile)} must be walkable`);
    }
  };
  const landmarks: SpatialLandmarkExport[] = [];
  const landmarkIds = new Set<string>();
  const add = (
    id: string,
    name: string,
    tile: TileCoord,
    affordances: readonly string[],
    label: string,
  ): void => {
    if (landmarkIds.has(id)) throw new Error(`duplicate exported landmark ${id}`);
    open(tile, label);
    landmarkIds.add(id);
    landmarks.push({ id, name, ...tileCenter(tile), affordances: [...affordances] });
  };

  const anchorTargets: Array<Readonly<{ tile: TileCoord; label: string }>> = [];
  const requireAnchors = (
    anchors: readonly TileCoord[],
    kind: string,
    required: boolean,
  ): void => {
    if (required && anchors.length === 0) throw new Error(`${recipe.regionId} requires at least one ${kind} anchor`);
    const seen = new Set<string>();
    anchors.forEach((tile, index) => {
      const label = `${recipe.regionId} ${kind} anchor ${index + 1}`;
      open(tile, label);
      const key = tileKey(tile);
      if (seen.has(key)) throw new Error(`${recipe.regionId} ${kind} anchors must be unique`);
      seen.add(key);
      anchorTargets.push({ tile, label });
    });
  };

  requireAnchors(recipe.spawnAnchors, "spawn", true);
  requireAnchors(recipe.socialAnchors, "social", true);
  requireAnchors(recipe.resourceAnchors.energy, "energy", true);
  requireAnchors(recipe.resourceAnchors.materials, "materials", true);
  requireAnchors(recipe.arrivalAnchors, "arrival", false);

  const expectedArrivalAnchors = recipe.gates
    .filter((gate) => gate.role === "arrival")
    .map((gate) => gate.tile);
  if (!sameTiles(recipe.arrivalAnchors, expectedArrivalAnchors)) {
    throw new Error(`${recipe.regionId} arrival anchors must exactly match arrival gates`);
  }

  const gates: SpatialGateExport[] = [];
  const gateLandmarks: Array<Readonly<{
    id: string;
    name: string;
    tile: TileCoord;
    affordances: readonly string[];
    label: string;
  }>> = [];
  const gateKeys = new Set<string>();
  for (const [index, gate] of recipe.gates.entries()) {
    if (!isRecord(gate) || !isRecord(gate.edge)
        || typeof gate.edge.from !== "string" || gate.edge.from.length === 0
        || typeof gate.edge.to !== "string" || gate.edge.to.length === 0) {
      throw new Error(`${recipe.regionId} gate ${index + 1} must name both regions`);
    }
    if (gate.role !== "arrival" && gate.role !== "departure") {
      throw new Error(`${recipe.regionId} gate ${index + 1} has an invalid role`);
    }
    if (gate.edge.from === gate.edge.to) {
      throw new Error(`${recipe.regionId} gate ${index + 1} may not loop to itself`);
    }
    if ((gate.role === "departure" && gate.edge.from !== recipe.regionId)
        || (gate.role === "arrival" && gate.edge.to !== recipe.regionId)) {
      throw new Error(`${recipe.regionId} gate ${index + 1} role does not belong to this region`);
    }
    const gateKey = `${gate.edge.from}\u0000${gate.edge.to}\u0000${gate.role}`;
    if (gateKeys.has(gateKey)) throw new Error(`${recipe.regionId} has duplicate gate ${gateKey}`);
    gateKeys.add(gateKey);
    const label = `${recipe.regionId} ${gate.role} gate ${gate.edge.from}->${gate.edge.to}`;
    open(gate.tile, label);
    gates.push({
      from_region: gate.edge.from,
      to_region: gate.edge.to,
      role: gate.role,
      ...tileCenter(gate.tile),
    });
    anchorTargets.push({ tile: gate.tile, label });
    if (gate.role === "departure") {
      gateLandmarks.push({
        id: `gate-${gate.edge.to}`,
        name: `Path toward ${gate.edge.to.replaceAll("_", " ")}`,
        tile: gate.tile,
        affordances: ["exit"],
        label,
      });
    } else {
      gateLandmarks.push({
        id: `arrival-${gate.edge.from}`,
        name: `Arrival from ${gate.edge.from.replaceAll("_", " ")}`,
        tile: gate.tile,
        affordances: ["entrance"],
        label,
      });
    }
  }

  for (const kind of ["energy", "materials"] as const) {
    recipe.resourceAnchors[kind].forEach((tile, index) =>
      add(
        `${kind}-${index + 1}`,
        `${kind === "energy" ? "Foraging grove" : "Material clearing"} ${index + 1}`,
        tile,
        [kind],
        `${recipe.regionId} ${kind} anchor ${index + 1}`,
      ));
  }
  recipe.socialAnchors.forEach((tile, index) =>
    add(
      `clearing-${index + 1}`,
      `Gathering clearing ${index + 1}`,
      tile,
      ["social"],
      `${recipe.regionId} social anchor ${index + 1}`,
    ));
  for (const gateLandmark of gateLandmarks) {
    add(
      gateLandmark.id,
      gateLandmark.name,
      gateLandmark.tile,
      gateLandmark.affordances,
      gateLandmark.label,
    );
  }
  recipe.shelterPlots.forEach((plot) => {
    open(plot.tile, `${recipe.regionId} shelter plot ${plot.id}`);
    open(plot.door, `${recipe.regionId} shelter door ${plot.id}`);
    add(
      `plot-${plot.id}`,
      `Shelter plot ${plot.id}`,
      plot.door,
      ["shelter"],
      `${recipe.regionId} shelter door ${plot.id}`,
    );
  });

  const spawn_points = recipe.spawnAnchors.map((tile, index) => {
    open(tile, `${recipe.regionId} spawn anchor ${index + 1}`);
    return tileCenter(tile);
  });
  const navigationGrid: NavigationGrid = {
    columns: width,
    rows: height,
    collision: Uint8Array.from(walkable.flat().map((cell) => cell === 1 ? 0 : 1)),
    // The Python spatial pilot consumes bounded maps. Keep the published contract
    // honest even though the presentation recipe itself also records toroidal seams.
    topology: "bounded",
  };
  proveReachability(recipe, navigationGrid, anchorTargets);

  const fingerprint = navigationLayoutFingerprint(recipe);
  const pressure = Object.freeze({
    populationHighWater: initialPressure.populationHighWater,
    builtFootprintHighWater: initialPressure.builtFootprintHighWater,
  });
  return {
    version: 1,
    region_id: recipe.regionId,
    map_id: `${recipe.regionId}:${fingerprint}`,
    layout_fingerprint: fingerprint,
    tile_size: TILE_SIZE,
    width,
    height,
    topology: "bounded",
    walkable,
    landmarks,
    spawn_points,
    gates,
    initial_pressure: pressure,
    home_plots: recipe.shelterPlots.map((plot) => ({
      id: plot.id,
      ...tileCenter(plot.tile),
      door: tileCenter(plot.door),
      hard_rects: homeFootprintExclusionRects(tileCenter(plot.tile)),
    })),
  };
}

/**
 * Assemble one version-two bundle from independently built production recipes.
 *
 * @param inputs - One recipe and its own frozen growth pressure per input region.
 * @returns A deterministic bundle preserving input region order.
 * @throws If no maps are supplied or two maps share a region id.
 */
export function createSpatialNavigationBundle(
  inputs: readonly SpatialNavigationBundleInput[],
): SpatialNavigationBundleV2 {
  if (inputs.length === 0) throw new Error("spatial navigation bundle requires at least one region");
  const regionIds = new Set<string>();
  const regions = inputs.map(({ recipe, initialPressure }) => {
    if (regionIds.has(recipe.regionId)) {
      throw new Error(`spatial navigation bundle contains duplicate region ${recipe.regionId}`);
    }
    regionIds.add(recipe.regionId);
    return createSpatialNavigationExport(recipe, initialPressure);
  });
  return Object.freeze({ version: 2 as const, regions: Object.freeze(regions) });
}

function validatePressure(pressure: NirvanaGrowthPressure): void {
  if (!isRecord(pressure)
      || !Number.isSafeInteger(pressure.populationHighWater)
      || pressure.populationHighWater < 0) {
    throw new Error("initial pressure populationHighWater must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(pressure.builtFootprintHighWater) || pressure.builtFootprintHighWater < 0) {
    throw new Error("initial pressure builtFootprintHighWater must be a non-negative safe integer");
  }
}

function validateRecipeShape(recipe: RegionMapRecipeV1): void {
  if (!isRecord(recipe) || typeof recipe.regionId !== "string" || recipe.regionId.length === 0) {
    throw new Error("spatial navigation recipe must have a non-empty region id");
  }
  for (const [label, value] of [
    ["gates", recipe.gates],
    ["arrival anchors", recipe.arrivalAnchors],
    ["spawn anchors", recipe.spawnAnchors],
    ["social anchors", recipe.socialAnchors],
    ["shelter plots", recipe.shelterPlots],
    ["scenic landmarks", recipe.scenicLandmarks],
  ] as const) {
    if (!Array.isArray(value)) throw new Error(`${recipe.regionId} ${label} must be an array`);
  }
  if (!isRecord(recipe.resourceAnchors)
      || !Array.isArray(recipe.resourceAnchors.energy)
      || !Array.isArray(recipe.resourceAnchors.materials)) {
    throw new Error(`${recipe.regionId} resource anchors must contain energy and materials arrays`);
  }
}

function validateGrid(grid: RegionMapRecipeV1["grid"]): void {
  if (!isRecord(grid)
      || !Number.isSafeInteger(grid.columns) || grid.columns <= 0
      || !Number.isSafeInteger(grid.rows) || grid.rows <= 0) {
    throw new Error("spatial navigation recipe grid dimensions must be positive safe integers");
  }
  if (!(grid.collision instanceof Uint8Array)
      || grid.collision.length !== grid.columns * grid.rows) {
    throw new Error("spatial navigation recipe collision length must match grid dimensions");
  }
  if (grid.collision.some((cell) => cell !== 0 && cell !== 1)) {
    throw new Error("spatial navigation recipe collision must contain only binary cells");
  }
}

function validateTile(tile: TileCoord, grid: RegionMapRecipeV1["grid"], label: string): void {
  if (!isRecord(tile)
      || !Number.isSafeInteger(tile.column) || !Number.isSafeInteger(tile.row)
      || tile.column < 0 || tile.column >= grid.columns
      || tile.row < 0 || tile.row >= grid.rows) {
    throw new Error(`${label} ${tileKey(tile)} is outside the recipe grid`);
  }
}

function proveReachability(
  recipe: RegionMapRecipeV1,
  grid: NavigationGrid,
  targets: readonly Readonly<{ tile: TileCoord; label: string }>[],
): void {
  const start = recipe.spawnAnchors[0];
  if (start === undefined) throw new Error(`${recipe.regionId} requires a canonical spawn anchor`);
  for (const target of targets) {
    const result = findNavigationPath(grid, { start, goal: target.tile });
    if (result.status !== "reached") {
      throw new Error(`${target.label} ${tileKey(target.tile)} must be reachable from canonical spawn`);
    }
  }
}

function sameTiles(left: readonly TileCoord[], right: readonly TileCoord[]): boolean {
  return left.length === right.length
    && left.every((tile, index) => {
      const other = right[index];
      return other !== undefined && tile.column === other.column && tile.row === other.row;
    });
}

function tileKey(tile: unknown): string {
  return isRecord(tile) ? `${String(tile.column)},${String(tile.row)}` : "<invalid>";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
