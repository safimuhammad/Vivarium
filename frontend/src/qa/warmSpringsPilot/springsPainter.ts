/**
 * Rasterises the pilot Warm Springs scene through the PRODUCTION static-scene
 * primitives. Nothing here re-implements drawing: the plan is built with
 * `createProductionStaticScenePlan` / `createProductionStaticDrawOperation`
 * and executed with `drawProductionStaticSceneOperation` - the same validated
 * operation record, stable-id uniqueness rule, nearest-neighbour integer
 * blit, and terrain-then-scenery paint order the Nirvana painter uses. Only
 * the frame VOCABULARY is new, which is exactly what a redesigned tile set is.
 *
 * One addition beyond the Nirvana painter: a dedicated STEAM PASS, drawn
 * LAST, after every other scenery operation. Steam plumes are the region's
 * signature element and must sit visually over everything - a vent's cone,
 * nearby trees, boardwalk rails - regardless of where their foot-anchor
 * would otherwise sort them in the normal depth order.
 */

import {
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
} from "../../renderer2d/production/staticScene/ProductionStaticScene";
import { baseFrameId, edgeFrameId, shoreFrameId } from "./springsMaterials";
import type { WarmSpringsScene } from "./springsScene";

export const SPRINGS_TERRAIN_ATLAS_ID = "warm-springs-terrain";
export const SPRINGS_SCENERY_ATLAS_ID = "warm-springs-scenery";

export interface SpringsAtlasFrame {
  readonly id: string;
  readonly image: "terrain" | "scenery";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface SpringsAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  readonly frames: readonly SpringsAtlasFrame[];
}

/**
 * The compact schema-2 form the authoring script writes. Terrain frames are a
 * uniform grid (rects DERIVED from a column count and cell size; only the id
 * order is data); scenery frames are shelf-packed at many sizes and keep
 * explicit rects, as tuples. Mirrors `CompactValleyAtlasManifest` exactly.
 */
export interface CompactSpringsAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  /** The corner-mask bit convention the art was authored against. */
  readonly cornerBits?: Readonly<{ nw: number; ne: number; se: number; sw: number }>;
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
  manifest: SpringsAtlasManifest | CompactSpringsAtlasManifest,
): manifest is CompactSpringsAtlasManifest {
  return (manifest as CompactSpringsAtlasManifest).terrainGrid !== undefined;
}

export class SpringsPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpringsPainterError";
  }
}

/**
 * The corner-mask bit convention `springsScene.ts`'s `deriveTile` actually
 * uses: corners are sampled NW, NE, SE, SW and folded into a mask via
 * `mask |= 1 << cornerIndex`, giving NW=1, NE=2, SE=4, SW=8.
 *
 * This is NOT re-derived from the manifest at scene-build time - the scene
 * builder is a pure, synchronous function with no file I/O, deliberately,
 * so plot-cost/connectivity numbers can be computed before the art ever
 * lands. Instead, whenever a manifest declares its own `cornerBits`, this
 * module asserts the two agree, LOUDLY, the first time the atlas is loaded.
 * Getting this wrong mirrors/rotates every transition frame relative to the
 * material field - materials interlock along the wrong diagonal, subtle
 * enough to survive a glance and wrong on every plate - so a silent art-side
 * convention change must become an immediate crash here, not a rendering bug
 * discovered by eye later.
 */
export const SCENE_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

/**
 * Assert that a manifest's declared corner-bit convention (if any) matches
 * the one `springsScene.ts` actually builds masks with.
 *
 * @throws {SpringsPainterError} If the manifest declares a different
 *   convention. A manifest with no `cornerBits` field is not an error (older
 *   or hand-built manifests may omit it) - there is simply nothing to check.
 */
export function assertCornerBitsAgree(
  manifest: SpringsAtlasManifest | CompactSpringsAtlasManifest,
): void {
  const declared = isCompact(manifest) ? manifest.cornerBits : undefined;
  if (declared === undefined) return;
  const expected = SCENE_CORNER_BITS;
  if (
    declared.nw !== expected.nw || declared.ne !== expected.ne
    || declared.se !== expected.se || declared.sw !== expected.sw
  ) {
    throw new SpringsPainterError(
      "Warm Springs atlas declares a corner-bit convention "
      + `(nw=${declared.nw}, ne=${declared.ne}, se=${declared.se}, sw=${declared.sw}) that disagrees `
      + `with the scene's (nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). `
      + "Every transition frame would be mirrored/rotated relative to the material field - fix the "
      + "art authoring script's bit order or springsScene.ts's deriveTile, then re-check.",
    );
  }
}

/** Expand the compact manifest into the explicit frame table the plan needs. */
export function expandSpringsAtlas(
  manifest: SpringsAtlasManifest | CompactSpringsAtlasManifest,
): SpringsAtlasManifest {
  if (!isCompact(manifest)) return manifest;
  assertCornerBitsAgree(manifest);
  const { columns, cell, ids, image } = manifest.terrainGrid;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(cell) || cell <= 0) {
    throw new SpringsPainterError(
      `Warm Springs atlas terrain grid is invalid: ${columns} columns of ${cell}px.`,
    );
  }
  const frames: SpringsAtlasFrame[] = ids.map((id, index) => ({
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

export interface SpringsAtlasSources {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
}

/** Index a manifest by frame id, rejecting duplicates. Accepts either shape. */
export function indexSpringsFrames(
  manifest: SpringsAtlasManifest | CompactSpringsAtlasManifest,
): ReadonlyMap<string, SpringsAtlasFrame> {
  const frames = new Map<string, SpringsAtlasFrame>();
  for (const frame of expandSpringsAtlas(manifest).frames) {
    if (frames.has(frame.id)) {
      throw new SpringsPainterError(`Warm Springs atlas has a duplicate frame id ${frame.id}.`);
    }
    frames.set(frame.id, frame);
  }
  return frames;
}

function requireFrame(
  frames: ReadonlyMap<string, SpringsAtlasFrame>,
  id: string,
): SpringsAtlasFrame {
  const frame = frames.get(id);
  if (frame === undefined) {
    throw new SpringsPainterError(`Warm Springs atlas frame is missing: ${id}.`);
  }
  return frame;
}

function atlasIdFor(frame: SpringsAtlasFrame): string {
  return frame.image === "terrain" ? SPRINGS_TERRAIN_ATLAS_ID : SPRINGS_SCENERY_ATLAS_ID;
}

/** True for the signature steam props - always painted in their own last pass. */
function isSteamFrame(frameId: string): boolean {
  return frameId.startsWith("s.steam.") || frameId.startsWith("s.steamsmall.");
}

/**
 * Build the immutable draw plan: every ground tile, every transition overlay,
 * every non-steam prop sorted by foot, then EVERY STEAM PROP LAST so plumes
 * sit over the whole picture regardless of normal depth order.
 */
export function createSpringsPaintPlan(
  scene: WarmSpringsScene,
  manifest: SpringsAtlasManifest | CompactSpringsAtlasManifest,
  cacheIdentity = `warm-springs-pilot-${scene.compositionId}`,
): ProductionStaticScenePlan {
  const frames = indexSpringsFrames(manifest);
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

  const steamProps = scene.props.filter((prop) => isSteamFrame(prop.frameId));
  const otherProps = scene.props.filter((prop) => !isSteamFrame(prop.frameId));

  for (const prop of otherProps) {
    const frame = requireFrame(frames, prop.frameId);
    operations.push({
      stableId: `prop:${prop.id}`,
      layer: "scenery",
      atlasId: atlasIdFor(frame),
      source: frame.rect,
      destination: { x: prop.x, y: prop.y, width: frame.rect.width, height: frame.rect.height },
      pivotY: prop.footY,
    });
  }
  for (const prop of steamProps) {
    const frame = requireFrame(frames, prop.frameId);
    operations.push({
      stableId: `steam:${prop.id}`,
      layer: "scenery",
      atlasId: atlasIdFor(frame),
      source: frame.rect,
      destination: { x: prop.x, y: prop.y, width: frame.rect.width, height: frame.rect.height },
      pivotY: prop.footY,
    });
  }

  return createProductionStaticScenePlan(cacheIdentity, operations);
}

/** Execute a plan into a native-scale context, in the production draw order. */
export function renderSpringsPlan(
  context: CanvasRenderingContext2D,
  plan: ProductionStaticScenePlan,
  sources: SpringsAtlasSources,
  worldOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): void {
  context.imageSmoothingEnabled = false;
  for (const operation of plan.operations) {
    const image = operation.atlasId === SPRINGS_TERRAIN_ATLAS_ID
      ? sources.terrain
      : operation.atlasId === SPRINGS_SCENERY_ATLAS_ID
        ? sources.scenery
        : null;
    if (image === null) {
      throw new SpringsPainterError(`Unknown Warm Springs atlas ${operation.atlasId}.`);
    }
    drawProductionStaticSceneOperation(context, image, operation, worldOffset);
  }
}
