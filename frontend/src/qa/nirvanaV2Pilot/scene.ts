/** QA-facing adapter over the production-owned Nirvana root chunk recipe. */

import {
  NIRVANA_ROOT_CAMERA_START,
  createNirvanaRootChunk,
  createNirvanaRootWoodlandVisuals,
} from "../../renderer2d/production/nirvana/NirvanaRootChunk";
import {
  NIRVANA_TILE_SIZE,
  type NirvanaCardinalDirection,
  type NirvanaChunkConnector,
  type NirvanaLandmarkCollisionRole,
  type NirvanaLandmarkFeature,
  type NirvanaLandmarkFrameId,
  type NirvanaLandmarkPlacement,
  type NirvanaLandmarkVisualPlacement,
  type NirvanaQuietClearing,
  type NirvanaRoadCell,
  type NirvanaTerrainCell,
  type NirvanaTerrainKind,
  type NirvanaTileCoordinate,
  type NirvanaTileRectangle,
} from "../../renderer2d/production/nirvana/NirvanaRegionV2";

export const NIRVANA_V2_TILE_SIZE = NIRVANA_TILE_SIZE;

export const NIRVANA_V2_DEFAULT_VIEWPORT = Object.freeze({
  width: 960,
  height: 540,
});

export type CardinalDirection = NirvanaCardinalDirection;
export type RouteEdge = Exclude<CardinalDirection, "north">;
export type TerrainKind = NirvanaTerrainKind;
export type LandmarkFeature = NirvanaLandmarkFeature;
export type LandmarkFrameId = NirvanaLandmarkFrameId;
export type LandmarkCollisionRole = NirvanaLandmarkCollisionRole;
export type LandmarkVisualPlacement = NirvanaLandmarkVisualPlacement;
export type TileCoordinate = NirvanaTileCoordinate;
export type TileRectangle = NirvanaTileRectangle;
export type TerrainCell = NirvanaTerrainCell;
export type RoadCell = NirvanaRoadCell;
export type LandmarkPlacement = NirvanaLandmarkPlacement;
export type QuietClearing = NirvanaQuietClearing;

export interface NirvanaV2SceneDimensions {
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
}

export interface RouteExit {
  readonly edge: RouteEdge;
  readonly tile: TileCoordinate;
}

export interface NirvanaV2CollisionGrid {
  readonly columns: number;
  readonly rows: number;
  readonly cells: Uint8Array;
}

export interface NirvanaV2PilotScene {
  readonly dimensions: NirvanaV2SceneDimensions;
  readonly terrainCells: readonly TerrainCell[];
  readonly roadCells: readonly RoadCell[];
  readonly routeExits: readonly RouteExit[];
  readonly roadHub: TileCoordinate;
  readonly landmarks: readonly LandmarkPlacement[];
  readonly quietClearings: readonly QuietClearing[];
  readonly collision: NirvanaV2CollisionGrid;
  readonly cameraStart: Readonly<{ x: number; y: number }>;
}

/** Preserve the pilot's QA hook while delegating its deterministic recipe to production. */
export function createNirvanaV2WoodlandVisuals(
  bounds: TileRectangle,
): readonly LandmarkVisualPlacement[] {
  return createNirvanaRootWoodlandVisuals(bounds);
}

/** Adapt one production connector to the pilot's legacy edge-and-tile representation. */
function connectorToRouteExit(
  connector: NirvanaChunkConnector,
  columns: number,
  rows: number,
): RouteExit {
  switch (connector.edge) {
    case "west":
      return Object.freeze({
        edge: connector.edge,
        tile: Object.freeze({ column: 0, row: connector.offset }),
      });
    case "east":
      return Object.freeze({
        edge: connector.edge,
        tile: Object.freeze({ column: columns - 1, row: connector.offset }),
      });
    case "south":
      return Object.freeze({
        edge: connector.edge,
        tile: Object.freeze({ column: connector.offset, row: rows - 1 }),
      });
    case "north":
      throw new Error("The Nirvana V2 pilot does not expose a north route exit");
  }
}

/** Build the legacy QA scene view from the production-owned root chunk. */
export function createNirvanaV2PilotScene(): NirvanaV2PilotScene {
  const root = createNirvanaRootChunk();
  const dimensions = Object.freeze({
    columns: root.columns,
    rows: root.rows,
    tileSize: NIRVANA_V2_TILE_SIZE,
    widthPixels: root.columns * NIRVANA_V2_TILE_SIZE,
    heightPixels: root.rows * NIRVANA_V2_TILE_SIZE,
  });

  return Object.freeze({
    dimensions,
    terrainCells: root.terrainCells,
    roadCells: root.roadCells,
    routeExits: Object.freeze(root.connectors.map((connector) =>
      connectorToRouteExit(connector, root.columns, root.rows))),
    roadHub: root.roadHub,
    landmarks: root.landmarks,
    quietClearings: root.quietClearings,
    collision: Object.freeze({
      columns: root.columns,
      rows: root.rows,
      cells: Uint8Array.from(root.collision),
    }),
    cameraStart: NIRVANA_ROOT_CAMERA_START,
  });
}
