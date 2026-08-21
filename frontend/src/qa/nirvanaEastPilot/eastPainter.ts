/**
 * Rasterises the pilot Nirvana East scene through the PRODUCTION static-scene
 * primitives. Nothing here re-implements drawing: the plan is built with
 * `createProductionStaticScenePlan` / `createProductionStaticDrawOperation`
 * and executed with `drawProductionStaticSceneOperation` - the same validated
 * operation record, stable-id uniqueness rule, nearest-neighbour integer
 * blit, and terrain-then-scenery paint order the Warm Springs painter uses.
 * Only the frame VOCABULARY is new, which is exactly what a redesigned tile
 * set is.
 *
 * One addition beyond the base pass: a dedicated DUST-DEVIL PASS, drawn LAST,
 * after every other scenery operation - the Nirvana East analogue of Warm
 * Springs' steam pass (contract §6). Dust-devil plumes are the region's
 * signature element and must sit visually over everything - a butte's talus,
 * nearby thorn, a plank rail - regardless of where their foot-anchor would
 * otherwise sort them in the normal depth order.
 */

import {
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
} from "../../renderer2d/production/staticScene/ProductionStaticScene";
import { baseFrameId, edgeFrameId, shoreFrameId } from "./eastMaterials";
import { NIRVANA_EAST_LANDFORM_TIERS, PROP_PIVOTS, type NirvanaEastScene } from "./eastScene";

export const EAST_TERRAIN_ATLAS_ID = "nirvana-east-terrain";
export const EAST_SCENERY_ATLAS_ID = "nirvana-east-scenery";

export interface EastAtlasFrame {
  readonly id: string;
  readonly image: "terrain" | "scenery";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface EastAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  readonly frames: readonly EastAtlasFrame[];
}

/**
 * The compact schema-2 form the authoring script writes. Terrain frames are a
 * uniform grid (rects DERIVED from a column count and cell size; only the id
 * order is data); scenery frames are shelf-packed at many sizes and keep
 * explicit rects, as tuples. Mirrors `CompactSpringsAtlasManifest` exactly.
 */
export interface CompactEastAtlasManifest {
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
  manifest: EastAtlasManifest | CompactEastAtlasManifest,
): manifest is CompactEastAtlasManifest {
  return (manifest as CompactEastAtlasManifest).terrainGrid !== undefined;
}

export class EastPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EastPainterError";
  }
}

/**
 * The corner-mask bit convention `eastScene.ts`'s `deriveTile` actually uses:
 * corners are sampled NW, NE, SE, SW and folded into a mask via
 * `mask |= 1 << cornerIndex`, giving NW=1, NE=2, SE=4, SW=8 (contract §5).
 *
 * This is NOT re-derived from the manifest at scene-build time - the scene
 * builder is a pure, synchronous function with no file I/O, deliberately, so
 * plot-cost/connectivity/torus numbers can be computed before the art ever
 * lands. Instead, whenever a manifest declares its own `cornerBits`, this
 * module asserts the two agree, LOUDLY, the first time the atlas is loaded.
 */
export const SCENE_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

/**
 * Assert that a manifest's declared corner-bit convention (if any) matches
 * the one `eastScene.ts` actually builds masks with.
 *
 * @throws {EastPainterError} If the manifest declares a different
 *   convention. A manifest with no `cornerBits` field is not an error (older
 *   or hand-built manifests may omit it) - there is simply nothing to check.
 */
export function assertCornerBitsAgree(
  manifest: EastAtlasManifest | CompactEastAtlasManifest,
): void {
  const declared = isCompact(manifest) ? manifest.cornerBits : undefined;
  if (declared === undefined) return;
  const expected = SCENE_CORNER_BITS;
  if (
    declared.nw !== expected.nw || declared.ne !== expected.ne
    || declared.se !== expected.se || declared.sw !== expected.sw
  ) {
    throw new EastPainterError(
      "Nirvana East atlas declares a corner-bit convention "
      + `(nw=${declared.nw}, ne=${declared.ne}, se=${declared.se}, sw=${declared.sw}) that disagrees `
      + `with the scene's (nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). `
      + "Every transition frame would be mirrored/rotated relative to the material field - fix the "
      + "art authoring script's bit order or eastScene.ts's deriveTile, then re-check.",
    );
  }
}

/**
 * Assert that the atlas's authored landform frames (`s.mesa.0`, `s.butte.0`,
 * `s.outcrop.0`) match `eastScene.ts`'s `PROP_PIVOTS` table exactly - width,
 * height, and pivot. Round-1 open item 2 ("PROP_PIVOTS are placeholders")
 * asked that the real pivots be "read back out of atlas.json and asserted to
 * match rather than trusted" once the art landed; this is that check, run
 * automatically every time a compact manifest is expanded (the same
 * discipline {@link assertCornerBitsAgree} already applies to the corner-bit
 * convention) rather than trusted silently.
 *
 * @throws {EastPainterError} If a landform frame is missing, or its
 *   rect/pivot disagrees with `PROP_PIVOTS`.
 */
export function assertLandformPivotsAgree(frames: readonly EastAtlasFrame[]): void {
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
    const expected = PROP_PIVOTS[tier];
    if (expected === undefined) {
      throw new EastPainterError(`eastScene.ts's PROP_PIVOTS has no entry for landform tier ${tier}.`);
    }
    const [expectedWidth, expectedHeight, expectedPivotX, expectedPivotY] = expected;
    const frame = byId.get(`s.${tier}.0`);
    if (frame === undefined) {
      throw new EastPainterError(`Nirvana East atlas is missing the landform frame s.${tier}.0.`);
    }
    if (
      frame.rect.width !== expectedWidth || frame.rect.height !== expectedHeight
      || frame.pivot.x !== expectedPivotX || frame.pivot.y !== expectedPivotY
    ) {
      throw new EastPainterError(
        `Nirvana East atlas frame s.${tier}.0 is ${frame.rect.width}x${frame.rect.height} `
        + `pivot(${frame.pivot.x},${frame.pivot.y}), but eastScene.ts's PROP_PIVOTS expects `
        + `${expectedWidth}x${expectedHeight} pivot(${expectedPivotX},${expectedPivotY}). `
        + "A landform placed against the wrong pivot would draw floating above or sunk into the ground.",
      );
    }
  }
}

/** Expand the compact manifest into the explicit frame table the plan needs. */
export function expandEastAtlas(
  manifest: EastAtlasManifest | CompactEastAtlasManifest,
): EastAtlasManifest {
  if (!isCompact(manifest)) return manifest;
  assertCornerBitsAgree(manifest);
  const { columns, cell, ids, image } = manifest.terrainGrid;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(cell) || cell <= 0) {
    throw new EastPainterError(
      `Nirvana East atlas terrain grid is invalid: ${columns} columns of ${cell}px.`,
    );
  }
  const frames: EastAtlasFrame[] = ids.map((id, index) => ({
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
  assertLandformPivotsAgree(frames);
  return { schema: manifest.schema, tileSize: manifest.tileSize, frames };
}

export interface EastAtlasSources {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
}

/** Index a manifest by frame id, rejecting duplicates. Accepts either shape. */
export function indexEastFrames(
  manifest: EastAtlasManifest | CompactEastAtlasManifest,
): ReadonlyMap<string, EastAtlasFrame> {
  const frames = new Map<string, EastAtlasFrame>();
  for (const frame of expandEastAtlas(manifest).frames) {
    if (frames.has(frame.id)) {
      throw new EastPainterError(`Nirvana East atlas has a duplicate frame id ${frame.id}.`);
    }
    frames.set(frame.id, frame);
  }
  return frames;
}

function requireFrame(frames: ReadonlyMap<string, EastAtlasFrame>, id: string): EastAtlasFrame {
  const frame = frames.get(id);
  if (frame === undefined) {
    throw new EastPainterError(`Nirvana East atlas frame is missing: ${id}.`);
  }
  return frame;
}

function atlasIdFor(frame: EastAtlasFrame): string {
  return frame.image === "terrain" ? EAST_TERRAIN_ATLAS_ID : EAST_SCENERY_ATLAS_ID;
}

/** True for the signature dust-devil props - always painted in their own last pass. */
function isDustDevilFrame(frameId: string): boolean {
  return frameId.startsWith("s.dustdevil.");
}

/**
 * Build the immutable draw plan: every ground tile, every transition overlay,
 * every non-dust-devil prop sorted by foot, then EVERY DUST-DEVIL PROP LAST
 * so plumes sit over the whole picture regardless of normal depth order.
 */
export function createEastPaintPlan(
  scene: NirvanaEastScene,
  manifest: EastAtlasManifest | CompactEastAtlasManifest,
  cacheIdentity = `nirvana-east-pilot-${scene.compositionId}`,
): ProductionStaticScenePlan {
  const frames = indexEastFrames(manifest);
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

  const dustDevilProps = scene.props.filter((prop) => isDustDevilFrame(prop.frameId));
  const otherProps = scene.props.filter((prop) => !isDustDevilFrame(prop.frameId));

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
  for (const prop of dustDevilProps) {
    const frame = requireFrame(frames, prop.frameId);
    operations.push({
      stableId: `dustdevil:${prop.id}`,
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
export function renderEastPlan(
  context: CanvasRenderingContext2D,
  plan: ProductionStaticScenePlan,
  sources: EastAtlasSources,
  worldOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): void {
  context.imageSmoothingEnabled = false;
  for (const operation of plan.operations) {
    const image = operation.atlasId === EAST_TERRAIN_ATLAS_ID
      ? sources.terrain
      : operation.atlasId === EAST_SCENERY_ATLAS_ID
        ? sources.scenery
        : null;
    if (image === null) {
      throw new EastPainterError(`Unknown Nirvana East atlas ${operation.atlasId}.`);
    }
    drawProductionStaticSceneOperation(context, image, operation, worldOffset);
  }
}
