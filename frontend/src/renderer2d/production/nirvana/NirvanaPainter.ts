/** Chunk-aware, camera-bounded Canvas painter for production Nirvana scenery. */

import {
  channelFrameIdFor,
  nirvanaTerrainOverlayFrameIds,
  roadFrameIdFor,
  terrainFrameIdFor,
  type NirvanaAtlasAssets,
  type NirvanaAtlasFrame,
} from "./NirvanaAtlas";
import { NIRVANA_ATLAS_PROFILE } from "./NirvanaAssetProfile";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  type NirvanaRegionV2,
} from "./NirvanaRegionV2";
import {
  createProductionStaticSceneDescriptor,
  createProductionStaticDrawOperation,
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  type ProductionStaticSceneAdvanceResult,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
  type ProductionStaticScenePreparation,
} from "../staticScene/ProductionStaticScene";

export interface NirvanaCamera {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class NirvanaPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaPainterError";
  }
}

interface LandmarkDraw {
  readonly operation: ProductionStaticDrawOperation;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly stableId: string;
}

const CHUNK_WIDTH_PIXELS = NIRVANA_CHUNK_COLUMNS * NIRVANA_TILE_SIZE;
const CHUNK_HEIGHT_PIXELS = NIRVANA_CHUNK_ROWS * NIRVANA_TILE_SIZE;
const CONTINUATION_TILES = 8;

/** Clamp one viewport to the signed bounds of the active chunk set. */
export function clampNirvanaCamera(
  region: NirvanaRegionV2,
  camera: NirvanaCamera,
): NirvanaCamera {
  validateCamera(camera);
  const minimumX = region.bounds.minTileColumn * NIRVANA_TILE_SIZE;
  const minimumY = region.bounds.minTileRow * NIRVANA_TILE_SIZE;
  const maximumWorldX = minimumX + region.bounds.columns * NIRVANA_TILE_SIZE;
  const maximumWorldY = minimumY + region.bounds.rows * NIRVANA_TILE_SIZE;
  const maximumX = Math.max(minimumX, maximumWorldX - camera.width);
  const maximumY = Math.max(minimumY, maximumWorldY - camera.height);
  return Object.freeze({
    x: Math.round(Math.min(maximumX, Math.max(minimumX, camera.x))),
    y: Math.round(Math.min(maximumY, Math.max(minimumY, camera.y))),
    width: camera.width,
    height: camera.height,
  });
}

/** Build the shared immutable terrain-road-landmark-continuation operation plan. */
export function createNirvanaPaintPlan(
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePlan {
  const operations: ProductionStaticDrawOperation[] = [];
  const preparation = createNirvanaPaintPreparation(region, assets, cacheIdentity);
  let result: ProductionStaticSceneAdvanceResult;
  do {
    result = preparation.advance(1_536, (operation) => operations.push(operation));
  } while (!result.done);
  preparation.dispose();
  return createProductionStaticScenePlan(cacheIdentity, operations);
}

/** Create an O(1) cursor that streams the exact shared paint order under a work budget. */
export function createNirvanaPaintPreparation(
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePreparation {
  if (cacheIdentity.trim().length === 0) {
    throw new NirvanaPainterError("Nirvana paint cache identity must be non-empty.");
  }
  const iterator = nirvanaPaintOperations(region, assets);
  const descriptor = createProductionStaticSceneDescriptor({
    cacheIdentity,
    worldBounds: {
      x: region.bounds.minTileColumn * NIRVANA_TILE_SIZE,
      y: region.bounds.minTileRow * NIRVANA_TILE_SIZE,
      width: region.bounds.columns * NIRVANA_TILE_SIZE,
      height: region.bounds.rows * NIRVANA_TILE_SIZE,
    },
    topology: "toroidal",
  });
  const stableIds = new Set<string>();
  let disposed = false;
  let completed = false;
  let operationIndex = 0;
  return Object.freeze({
    cacheIdentity,
    descriptor,
    advance(
      maxWorkUnits: number,
      visit: (operation: ProductionStaticDrawOperation) => void,
    ): ProductionStaticSceneAdvanceResult {
      if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits <= 0) {
        throw new NirvanaPainterError("Nirvana paint preparation needs a positive work budget.");
      }
      if (disposed) throw new NirvanaPainterError("Nirvana paint preparation is disposed.");
      if (completed) throw new NirvanaPainterError("Nirvana paint preparation is complete.");
      let workUnits = 0;
      try {
        while (workUnits < maxWorkUnits) {
          const next = iterator.next();
          if (next.done) {
            completed = true;
            return Object.freeze({ done: true, workUnits });
          }
          const operation = createProductionStaticDrawOperation(next.value, operationIndex);
          if (stableIds.has(operation.stableId)) {
            throw new NirvanaPainterError(
              `Nirvana paint operation has duplicate stable ID ${operation.stableId}.`,
            );
          }
          stableIds.add(operation.stableId);
          visit(operation);
          operationIndex += 1;
          workUnits += 1;
        }
        return Object.freeze({ done: false, workUnits });
      } catch (error) {
        disposed = true;
        iterator.return?.();
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      iterator.return?.();
      stableIds.clear();
    },
  });
}

function* nirvanaPaintOperations(
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
): Generator<ProductionStaticDrawOperation, void, undefined> {
  const chunks = [...region.chunks.values()].sort((left, right) => (
    left.coord.row - right.coord.row || left.coord.column - right.coord.column
  ));
  // Terrain in four ordered sweeps over the whole region, not per chunk, so a material
  // boundary that crosses a chunk seam still interlocks: every base fill, then every
  // corner-masked transition and waterline, then the authored dry channels on top.
  for (const chunk of chunks) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const cell of chunk.terrainCells) {
      const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + cell.tile.column;
      const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + cell.tile.row;
      yield frameOperation(
        `terrain:${worldColumn},${worldRow}`,
        "terrain",
        requiredFrame(assets, terrainFrameIdFor(cell)),
        originX + cell.tile.column * NIRVANA_TILE_SIZE,
        originY + cell.tile.row * NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
      );
    }
  }
  for (const chunk of chunks) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const cell of chunk.terrainCells) {
      const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + cell.tile.column;
      const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + cell.tile.row;
      const overlayIds = nirvanaTerrainOverlayFrameIds(cell);
      for (let index = 0; index < overlayIds.length; index += 1) {
        yield frameOperation(
          `terrain-overlay:${worldColumn},${worldRow}:${index}`,
          "terrain",
          requiredFrame(assets, overlayIds[index]!),
          originX + cell.tile.column * NIRVANA_TILE_SIZE,
          originY + cell.tile.row * NIRVANA_TILE_SIZE,
          NIRVANA_TILE_SIZE,
          NIRVANA_TILE_SIZE,
        );
      }
    }
  }
  for (const chunk of chunks) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const cell of chunk.terrainCells) {
      const channel = channelFrameIdFor(cell);
      if (channel === null) continue;
      const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + cell.tile.column;
      const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + cell.tile.row;
      yield frameOperation(
        `terrain-channel:${worldColumn},${worldRow}`,
        "terrain",
        requiredFrame(assets, channel),
        originX + cell.tile.column * NIRVANA_TILE_SIZE,
        originY + cell.tile.row * NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
      );
    }
  }
  for (const chunk of chunks) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const road of chunk.roadCells) {
      const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + road.tile.column;
      const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + road.tile.row;
      yield frameOperation(
        `road:${worldColumn},${worldRow}`,
        "terrain",
        requiredFrame(assets, roadFrameIdFor(road, chunk.connectors)),
        originX + road.tile.column * NIRVANA_TILE_SIZE,
        originY + road.tile.row * NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
      );
    }
  }

  // Macro landmarks and ground scenery share ONE foot sort: a willow in front of a wood
  // must occlude it, and they are different layers only in the authoring model.
  const scenery = collectLandmarks(region, assets);
  scenery.push(...collectScenery(region, assets));
  scenery.sort((left, right) => (
    left.pivotY - right.pivotY
    || left.pivotX - right.pivotX
    || left.stableId.localeCompare(right.stableId)
  ));
  for (const { operation } of scenery) yield operation;
  for (let row = 0; row < CONTINUATION_TILES; row += 1) {
    for (let column = 0; column < CONTINUATION_TILES; column += 1) {
      const variant = continuationVariant(column, row);
      yield frameOperation(
        `continuation:${column},${row}`,
        "continuation",
        requiredFrame(assets, `t.grass.${variant}`),
        column * NIRVANA_TILE_SIZE,
        row * NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
        NIRVANA_TILE_SIZE,
      );
    }
  }
}

/** Paint one atlas-composed scenery frame without accepting a scene-sized bitmap. */
export function renderNirvanaRegion(
  context: CanvasRenderingContext2D,
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
  cameraInput: NirvanaCamera,
): void {
  const plan = createNirvanaPaintPlan(region, assets, "nirvana-v2:standalone");
  renderNirvanaPaintPlan(context, region, assets, cameraInput, plan);
}

/** Paint a precomputed Nirvana scene plan without reconstructing static operations. */
export function renderNirvanaPaintPlan(
  context: CanvasRenderingContext2D,
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
  cameraInput: NirvanaCamera,
  plan: ProductionStaticScenePlan,
): void {
  const camera = clampNirvanaCamera(region, cameraInput);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, camera.width, camera.height);
  for (const operation of plan.operations) {
    if (operation.layer === "continuation"
      || !overlapsCamera(
        operation.destination.x,
        operation.destination.y,
        operation.destination.width,
        operation.destination.height,
        camera,
      )) continue;
    drawProductionStaticSceneOperation(
      context,
      atlasSource(assets, operation.atlasId),
      operation,
      camera,
    );
  }
}

function collectLandmarks(
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
): LandmarkDraw[] {
  const result: LandmarkDraw[] = [];
  for (const chunk of region.chunks.values()) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const landmark of chunk.landmarks) {
      for (const visual of landmark.visuals) {
        const frame = requiredFrame(assets, visual.frameId);
        const worldX = originX + visual.at.x;
        const worldY = originY + visual.at.y;
        const width = frame.rect.width * visual.scale;
        const height = frame.rect.height * visual.scale;
        const stableId = `landmark:${chunk.coord.column},${chunk.coord.row}:${visual.id}`;
        const pivotY = worldY + frame.pivot.y * visual.scale;
        result.push({
          operation: frameOperation(
            stableId,
            "scenery",
            frame,
            worldX,
            worldY,
            width,
            height,
            pivotY,
          ),
          pivotX: worldX + frame.pivot.x * visual.scale,
          pivotY,
          stableId,
        });
      }
    }
  }
  return result;
}

/** Collect one draw per ground-scenery sprite, pivot-anchored for the shared foot sort. */
function collectScenery(
  region: NirvanaRegionV2,
  assets: NirvanaAtlasAssets,
): LandmarkDraw[] {
  const result: LandmarkDraw[] = [];
  for (const chunk of region.chunks.values()) {
    const originX = chunk.coord.column * CHUNK_WIDTH_PIXELS;
    const originY = chunk.coord.row * CHUNK_HEIGHT_PIXELS;
    for (const sprite of chunk.scenery) {
      const frame = requiredFrame(assets, sprite.frameId);
      const worldX = originX + sprite.at.x;
      const worldY = originY + sprite.at.y;
      const stableId = `scenery:${chunk.coord.column},${chunk.coord.row}:${sprite.id}`;
      const pivotY = originY + sprite.foot.y;
      result.push({
        operation: frameOperation(
          stableId,
          "scenery",
          frame,
          worldX,
          worldY,
          frame.rect.width,
          frame.rect.height,
          pivotY,
        ),
        pivotX: originX + sprite.foot.x,
        pivotY,
        stableId,
      });
    }
  }
  return result;
}

function requiredFrame(assets: NirvanaAtlasAssets, id: string): NirvanaAtlasFrame {
  const frame = assets.frames.get(id);
  if (frame === undefined) {
    throw new NirvanaPainterError(`Nirvana atlas frame is missing: ${id}.`);
  }
  return frame;
}

function frameOperation(
  stableId: string,
  layer: ProductionStaticDrawOperation["layer"],
  frame: NirvanaAtlasFrame,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
  pivotY?: number,
): ProductionStaticDrawOperation {
  return {
    stableId,
    layer,
    atlasId: frame.atlasId,
    source: frame.rect,
    destination: {
      x: Math.round(worldX),
      y: Math.round(worldY),
      width: Math.round(width),
      height: Math.round(height),
    },
    ...(pivotY === undefined ? {} : { pivotY: Math.round(pivotY) }),
  };
}

function continuationVariant(column: number, row: number): 0 | 1 | 2 | 3 {
  let value = (
    0x4e49_5256
    ^ Math.imul(column + 1, 0x45d9_f3b)
    ^ Math.imul(row + 1, 0x119d_e1f3)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d) >>> 0;
  return ((value ^ (value >>> 15)) & 3) as 0 | 1 | 2 | 3;
}

function atlasSource(assets: NirvanaAtlasAssets, atlasId: string): CanvasImageSource {
  if (atlasId === NIRVANA_ATLAS_PROFILE.terrainAtlasId) return assets.terrain;
  if (atlasId === NIRVANA_ATLAS_PROFILE.sceneryAtlasId) return assets.scenery;
  throw new NirvanaPainterError(`Nirvana paint operation references unknown atlas ${atlasId}.`);
}

function overlapsCamera(
  x: number,
  y: number,
  width: number,
  height: number,
  camera: NirvanaCamera,
): boolean {
  return x + width > camera.x
    && x < camera.x + camera.width
    && y + height > camera.y
    && y < camera.y + camera.height;
}

function validateCamera(camera: NirvanaCamera): void {
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) {
    throw new NirvanaPainterError("Nirvana camera position must be finite.");
  }
  if (!Number.isSafeInteger(camera.width) || camera.width <= 0
    || !Number.isSafeInteger(camera.height) || camera.height <= 0) {
    throw new NirvanaPainterError("Nirvana camera dimensions must be positive integers.");
  }
}
