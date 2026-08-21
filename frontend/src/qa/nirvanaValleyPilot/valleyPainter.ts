/**
 * Rasterises the pilot valley through the PRODUCTION static-scene primitives.
 *
 * Nothing here re-implements drawing. The plan is built with
 * `createProductionStaticScenePlan` / `createProductionStaticDrawOperation` and
 * executed with `drawProductionStaticSceneOperation` - the same validated
 * operation record, the same stable-id uniqueness rule, the same nearest-
 * neighbour integer blit, and the same terrain-then-scenery, foot-sorted paint
 * order the Nirvana painter uses. Only the frame VOCABULARY is new, which is
 * exactly what a redesigned tile set is.
 */

import {
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
} from "../../renderer2d/production/staticScene/ProductionStaticScene";
import { baseFrameId, edgeFrameId, shoreFrameId } from "./valleyMaterials";
import type { ValleyScene } from "./valleyScene";

export const VALLEY_TERRAIN_ATLAS_ID = "valley-terrain";
export const VALLEY_SCENERY_ATLAS_ID = "valley-scenery";

export interface ValleyAtlasFrame {
  readonly id: string;
  readonly image: "terrain" | "scenery";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface ValleyAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  readonly frames: readonly ValleyAtlasFrame[];
}

/**
 * The compact form the authoring script writes (schema 2).
 *
 * Terrain frames are a uniform grid, so their rects are DERIVED from a column
 * count and a cell size and only the id order is data; scenery frames are
 * shelf-packed at many sizes and keep explicit rects, as tuples. This is the
 * same addressing production already uses - `terrainFramesByRole` stores a cell
 * index, never a rectangle - and it matters because atlas metadata counts
 * against the region kit's byte ceiling: 111 bytes a frame became 19.
 */
export interface CompactValleyAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  readonly terrainGrid: Readonly<{
    image: "terrain" | "scenery";
    columns: number;
    cell: number;
    ids: readonly string[];
  }>;
  /** `[id, x, y, width, height, pivotX, pivotY]` */
  readonly sceneryFrames: readonly (readonly [string, number, number, number, number, number, number])[];
}

function isCompact(
  manifest: ValleyAtlasManifest | CompactValleyAtlasManifest,
): manifest is CompactValleyAtlasManifest {
  return (manifest as CompactValleyAtlasManifest).terrainGrid !== undefined;
}

/** Expand the compact manifest into the explicit frame table the plan needs. */
export function expandValleyAtlas(
  manifest: ValleyAtlasManifest | CompactValleyAtlasManifest,
): ValleyAtlasManifest {
  if (!isCompact(manifest)) return manifest;
  const { columns, cell, ids, image } = manifest.terrainGrid;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(cell) || cell <= 0) {
    throw new ValleyPainterError(
      `Valley atlas terrain grid is invalid: ${columns} columns of ${cell}px.`,
    );
  }
  const frames: ValleyAtlasFrame[] = ids.map((id, index) => ({
    id,
    image,
    rect: {
      x: (index % columns) * cell,
      y: Math.floor(index / columns) * cell,
      width: cell,
      height: cell,
    },
    pivot: { x: 0, y: 0 },
  }));
  for (const [id, x, y, width, height, pivotX, pivotY] of manifest.sceneryFrames) {
    frames.push({
      id,
      image: "scenery",
      rect: { x, y, width, height },
      pivot: { x: pivotX, y: pivotY },
    });
  }
  return { schema: manifest.schema, tileSize: manifest.tileSize, frames };
}

export interface ValleyAtlasSources {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
}

export class ValleyPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValleyPainterError";
  }
}

/** Index a manifest by frame id, rejecting duplicates. Accepts either shape. */
export function indexValleyFrames(
  manifest: ValleyAtlasManifest | CompactValleyAtlasManifest,
): ReadonlyMap<string, ValleyAtlasFrame> {
  const frames = new Map<string, ValleyAtlasFrame>();
  for (const frame of expandValleyAtlas(manifest).frames) {
    if (frames.has(frame.id)) {
      throw new ValleyPainterError(`Valley atlas has a duplicate frame id ${frame.id}.`);
    }
    frames.set(frame.id, frame);
  }
  return frames;
}

function requireFrame(
  frames: ReadonlyMap<string, ValleyAtlasFrame>,
  id: string,
): ValleyAtlasFrame {
  const frame = frames.get(id);
  if (frame === undefined) {
    throw new ValleyPainterError(`Valley atlas frame is missing: ${id}.`);
  }
  return frame;
}

function atlasIdFor(frame: ValleyAtlasFrame): string {
  return frame.image === "terrain" ? VALLEY_TERRAIN_ATLAS_ID : VALLEY_SCENERY_ATLAS_ID;
}

/**
 * Build the immutable draw plan: every ground tile, every transition overlay,
 * then every prop sorted by its foot so canopies read in depth.
 */
export function createValleyPaintPlan(
  scene: ValleyScene,
  manifest: ValleyAtlasManifest | CompactValleyAtlasManifest,
  cacheIdentity = "nirvana-valley-pilot",
): ProductionStaticScenePlan {
  const frames = indexValleyFrames(manifest);
  const operations: ProductionStaticDrawOperation[] = [];

  for (const tile of scene.tiles) {
    const x = tile.column * scene.tileSize;
    const y = tile.row * scene.tileSize;
    const base = requireFrame(frames, baseFrameId(tile.base, tile.baseVariant));
    operations.push({
      stableId: `terrain:${tile.column},${tile.row}`,
      layer: "terrain",
      atlasId: atlasIdFor(base),
      source: base.rect,
      destination: { x, y, width: scene.tileSize, height: scene.tileSize },
    });
    for (const overlay of tile.overlays) {
      // Total coverage is the material's own fill, not a transition frame.
      const frame = overlay.mask === 15
        ? requireFrame(frames, baseFrameId(overlay.material, overlay.variant))
        : requireFrame(frames, edgeFrameId(overlay.material, overlay.mask, overlay.variant));
      operations.push({
        stableId: `edge:${tile.column},${tile.row}:${overlay.material}`,
        layer: "terrain",
        atlasId: atlasIdFor(frame),
        source: frame.rect,
        destination: { x, y, width: scene.tileSize, height: scene.tileSize },
      });
    }
    // The waterline, drawn LAST of the ground layers so it sits on top of the
    // bank it wets. The scene decides where one belongs; the frame shares the
    // bank transition's mask and variant, so the wet band follows exactly the
    // contour the bank was cut with.
    for (const shore of tile.shorelines) {
      const frame = requireFrame(frames, shoreFrameId(shore.material, shore.mask, shore.variant));
      operations.push({
        stableId: `shore:${tile.column},${tile.row}:${shore.material}`,
        layer: "terrain",
        atlasId: atlasIdFor(frame),
        source: frame.rect,
        destination: { x, y, width: scene.tileSize, height: scene.tileSize },
      });
    }
  }

  for (const prop of scene.props) {
    const frame = requireFrame(frames, prop.frameId);
    operations.push({
      stableId: `prop:${prop.id}`,
      layer: "scenery",
      atlasId: atlasIdFor(frame),
      source: frame.rect,
      destination: {
        x: prop.x,
        y: prop.y,
        width: frame.rect.width,
        height: frame.rect.height,
      },
      pivotY: prop.footY,
    });
  }

  return createProductionStaticScenePlan(cacheIdentity, operations);
}

/** Execute a plan into a native-scale context, in the production draw order. */
export function renderValleyPlan(
  context: CanvasRenderingContext2D,
  plan: ProductionStaticScenePlan,
  sources: ValleyAtlasSources,
  worldOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): void {
  context.imageSmoothingEnabled = false;
  for (const operation of plan.operations) {
    const image = operation.atlasId === VALLEY_TERRAIN_ATLAS_ID
      ? sources.terrain
      : operation.atlasId === VALLEY_SCENERY_ATLAS_ID
        ? sources.scenery
        : null;
    if (image === null) {
      throw new ValleyPainterError(`Unknown valley atlas ${operation.atlasId}.`);
    }
    drawProductionStaticSceneOperation(context, image, operation, worldOffset);
  }
}
