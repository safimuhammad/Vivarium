/** Legacy QA API adapted directly onto the production Nirvana atlas and painter. */

import { NIRVANA_ATLAS_PROFILE } from "../../renderer2d/production/nirvana/NirvanaAssetProfile";
import {
  createNirvanaAtlasAssets as createProductionAtlasAssets,
  roadFrameIdFor as productionRoadFrameIdFor,
  swaleFrameIdFor as productionSwaleFrameIdFor,
  type NirvanaAtlasAssets,
  type NirvanaAtlasFrame,
} from "../../renderer2d/production/nirvana/NirvanaAtlas";
import {
  clampNirvanaCamera,
  renderNirvanaRegion,
  type NirvanaCamera,
} from "../../renderer2d/production/nirvana/NirvanaPainter";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  createNirvanaChunk,
  createNirvanaRegion,
  type NirvanaChunkConnector,
  type NirvanaRegionV2,
} from "../../renderer2d/production/nirvana/NirvanaRegionV2";
import type {
  NirvanaV2PilotScene,
  RoadCell,
  RouteExit,
  TerrainCell,
} from "./scene";

export type NirvanaV2Camera = NirvanaCamera;
export type NirvanaV2AtlasFrame = NirvanaAtlasFrame;

export interface NirvanaV2AtlasAssets {
  readonly terrainImage: CanvasImageSource;
  readonly sceneryImage: CanvasImageSource;
  readonly frames: ReadonlyMap<string, NirvanaV2AtlasFrame>;
}

const regionByScene = new WeakMap<NirvanaV2PilotScene, NirvanaRegionV2>();

/**
 * Bind the legacy QA asset shape to the canonical production atlas profile.
 *
 * The pilot used to carry its own copy of the atlas manifest and assert it had not
 * drifted from production's. That copy described the retired `nirvana-v2` generation; now
 * that production publishes `nirvana-v3`, the pilot binds the production profile DIRECTLY,
 * which is the strongest form of the same guarantee — there is no second manifest left to
 * drift. It still fails closed on the art itself: `createNirvanaAtlasAssets` rejects any
 * image whose geometry does not match the production descriptors.
 */
export function createNirvanaV2AtlasAssets(
  terrainImage: CanvasImageSource,
  sceneryImage: CanvasImageSource,
): NirvanaV2AtlasAssets {
  const assets = createProductionAtlasAssets(
    terrainImage,
    sceneryImage,
    NIRVANA_ATLAS_PROFILE,
  );
  return Object.freeze({
    terrainImage: assets.terrain,
    sceneryImage: assets.scenery,
    frames: assets.frames,
  });
}

/** Clamp the legacy pilot camera through the production signed-bounds implementation. */
export function clampNirvanaV2Camera(
  scene: NirvanaV2PilotScene,
  camera: NirvanaV2Camera,
): NirvanaV2Camera {
  return clampNirvanaCamera(regionForScene(scene), camera);
}

/** Resolve a legacy route-exit list through production connector-aware road selection. */
export function roadFrameIdFor(
  road: RoadCell,
  routeExits: readonly RouteExit[],
): string {
  return productionRoadFrameIdFor(
    road,
    routeExits.map(routeExitToConnector),
  );
}

/** Re-export production swale selection under the legacy QA API. */
export const swaleFrameIdFor = productionSwaleFrameIdFor satisfies (
  cell: TerrainCell,
) => string;

/** Paint the legacy pilot scene exclusively through the production chunk painter. */
export function renderNirvanaV2Scene(
  context: CanvasRenderingContext2D,
  scene: NirvanaV2PilotScene,
  assets: NirvanaV2AtlasAssets,
  camera: NirvanaV2Camera,
): void {
  renderNirvanaRegion(
    context,
    regionForScene(scene),
    productionAssets(assets),
    camera,
  );
}

function regionForScene(scene: NirvanaV2PilotScene): NirvanaRegionV2 {
  const cached = regionByScene.get(scene);
  if (cached !== undefined) return cached;
  if (scene.dimensions.columns !== NIRVANA_CHUNK_COLUMNS
    || scene.dimensions.rows !== NIRVANA_CHUNK_ROWS
    || scene.dimensions.tileSize !== NIRVANA_TILE_SIZE
    || scene.collision.columns !== NIRVANA_CHUNK_COLUMNS
    || scene.collision.rows !== NIRVANA_CHUNK_ROWS) {
    throw new Error("Nirvana V2 QA scene does not match production chunk dimensions.");
  }
  const root = createNirvanaChunk({
    coord: { column: 0, row: 0 },
    columns: NIRVANA_CHUNK_COLUMNS,
    rows: NIRVANA_CHUNK_ROWS,
    terrainCells: scene.terrainCells,
    roadCells: scene.roadCells,
    roadHub: scene.roadHub,
    landmarks: scene.landmarks,
    scenery: Object.freeze([]),
    quietClearings: scene.quietClearings,
    collision: Array.from(scene.collision.cells, (value) => value as 0 | 1),
    connectors: scene.routeExits.map(routeExitToConnector),
  });
  const region = createNirvanaRegion(root);
  regionByScene.set(scene, region);
  return region;
}

function routeExitToConnector(routeExit: RouteExit): NirvanaChunkConnector {
  return Object.freeze({
    edge: routeExit.edge,
    offset: routeExit.edge === "east" || routeExit.edge === "west"
      ? routeExit.tile.row
      : routeExit.tile.column,
  });
}

function productionAssets(assets: NirvanaV2AtlasAssets): NirvanaAtlasAssets {
  return Object.freeze({
    terrain: assets.terrainImage,
    scenery: assets.sceneryImage,
    frames: assets.frames,
  });
}
