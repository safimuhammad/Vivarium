/**
 * Rasterises the pilot Nirvana West scene through the PRODUCTION static-scene
 * primitives. Nothing here re-implements drawing: the plan is built with
 * `createProductionStaticScenePlan` / `createProductionStaticDrawOperation`
 * and executed with `drawProductionStaticSceneOperation` - the same validated
 * operation record, stable-id uniqueness rule, nearest-neighbour integer
 * blit, and terrain-then-scenery paint order the Warm Springs / Nirvana East
 * painters use. Only the frame VOCABULARY is new, which is exactly what a
 * redesigned tile set is.
 *
 * One addition beyond the base pass: a dedicated EMBERWISP PASS, drawn LAST,
 * after every other scenery operation - the Nirvana West analogue of Warm
 * Springs' steam pass / Nirvana East's dust-devil pass. Emberwisp plumes are
 * the region's signature ambient element and must sit visually over
 * everything - a slag reef, a charred trunk, a causeway rail - regardless of
 * where their foot-anchor would otherwise sort them in the normal depth
 * order.
 *
 * A second, separate addition: the ANIMATED ENVIRONMENT layer (fire/smoke/
 * heat-haze). This mirrors production's mechanism exactly - see
 * `nirvanaWestAnimationPhase` / `nirvanaWestSettledPhase` (copied verbatim
 * from `EnvironmentSystem.ts`'s `phaseIndex` / `seededSettledPhase`) and
 * `createNirvanaWestFullPaintPlan` / `renderNirvanaWestFullPlan` (the
 * animated-aware siblings of `createNirvanaWestPaintPlan` /
 * `renderNirvanaWestPlan`, which are both kept exactly as they were so no
 * existing caller regresses). The animated layer is drawn LAST of all -
 * after even the emberwisp pass - so fire and smoke sit over the whole
 * picture.
 */

import {
  createProductionStaticDrawOperation,
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
} from "../../renderer2d/production/staticScene/ProductionStaticScene";
import { baseFrameId, edgeFrameId, rimFrameId } from "./nirvanaWestMaterials";
import type { NirvanaWestAnimatedKind, NirvanaWestScene } from "./nirvanaWestScene";

export const NIRVANA_WEST_TERRAIN_ATLAS_ID = "nirvana-west-terrain";
export const NIRVANA_WEST_SCENERY_ATLAS_ID = "nirvana-west-scenery";
export const NIRVANA_WEST_ENVIRONMENT_ATLAS_ID = "nirvana-west-environment";

export interface NirvanaWestAtlasFrame {
  readonly id: string;
  readonly image: "terrain" | "scenery";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface NirvanaWestAtlasManifest {
  readonly schema: number;
  readonly tileSize: number;
  readonly frames: readonly NirvanaWestAtlasFrame[];
}

/**
 * The compact schema-2 form the authoring script writes. Terrain frames are a
 * uniform grid (rects DERIVED from a column count and cell size; only the id
 * order is data); scenery frames are shelf-packed at many sizes and keep
 * explicit rects, as tuples. Mirrors `CompactEastAtlasManifest` /
 * `CompactSpringsAtlasManifest` exactly.
 */
export interface CompactNirvanaWestAtlasManifest {
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
  /**
   * The animated-environment sheet: a per-kit `environment.png`, `columns`
   * cells wide at `cell`px each. `kinds[i]` occupies the four consecutive
   * cells `i*4 .. i*4+3` (`ANIMATED_FRAME_COUNT` horizontal frames), mirroring
   * production's `productionManifest.ts:929-932` cell arithmetic exactly.
   * REQUIRED - the animated layer has no optional/legacy fallback.
   */
  readonly environmentGrid: Readonly<{
    image: "environment";
    columns: number;
    cell: number;
    kinds: readonly NirvanaWestAnimatedKind[];
  }>;
}

function isCompact(
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
): manifest is CompactNirvanaWestAtlasManifest {
  return (manifest as CompactNirvanaWestAtlasManifest).terrainGrid !== undefined;
}

export class NirvanaWestPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestPainterError";
  }
}

/**
 * The corner-mask bit convention `nirvanaWestScene.ts`'s `deriveTile` actually
 * uses: corners are sampled NW, NE, SE, SW and folded into a mask via
 * `mask |= 1 << cornerIndex`, giving NW=1, NE=2, SE=4, SW=8.
 *
 * This is NOT re-derived from the manifest at scene-build time - the scene
 * builder is a pure, synchronous function with no file I/O, deliberately, so
 * plot-cost/connectivity/torus numbers can be computed before the art ever
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
 * the one `nirvanaWestScene.ts` actually builds masks with.
 *
 * @throws {NirvanaWestPainterError} If the manifest declares a different
 *   convention. A manifest with no `cornerBits` field is not an error (older
 *   or hand-built manifests may omit it) - there is simply nothing to check.
 */
export function assertCornerBitsAgree(
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
): void {
  const declared = isCompact(manifest) ? manifest.cornerBits : undefined;
  if (declared === undefined) return;
  const expected = SCENE_CORNER_BITS;
  if (
    declared.nw !== expected.nw || declared.ne !== expected.ne
    || declared.se !== expected.se || declared.sw !== expected.sw
  ) {
    throw new NirvanaWestPainterError(
      "Nirvana West atlas declares a corner-bit convention "
      + `(nw=${declared.nw}, ne=${declared.ne}, se=${declared.se}, sw=${declared.sw}) that disagrees `
      + `with the scene's (nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). `
      + "Every transition frame would be mirrored/rotated relative to the material field - fix the "
      + "art authoring script's bit order or nirvanaWestScene.ts's deriveTile, then re-check.",
    );
  }
}

/** Expand the compact manifest into the explicit frame table the plan needs. */
export function expandNirvanaWestAtlas(
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
): NirvanaWestAtlasManifest {
  if (!isCompact(manifest)) return manifest;
  assertCornerBitsAgree(manifest);
  const { columns, cell, ids, image } = manifest.terrainGrid;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(cell) || cell <= 0) {
    throw new NirvanaWestPainterError(
      `Nirvana West atlas terrain grid is invalid: ${columns} columns of ${cell}px.`,
    );
  }
  const frames: NirvanaWestAtlasFrame[] = ids.map((id, index) => ({
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

export interface NirvanaWestAtlasSources {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
  readonly environment: CanvasImageSource;
}

/** Index a manifest by frame id, rejecting duplicates. Accepts either shape. */
export function indexNirvanaWestFrames(
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
): ReadonlyMap<string, NirvanaWestAtlasFrame> {
  const frames = new Map<string, NirvanaWestAtlasFrame>();
  for (const frame of expandNirvanaWestAtlas(manifest).frames) {
    if (frames.has(frame.id)) {
      throw new NirvanaWestPainterError(`Nirvana West atlas has a duplicate frame id ${frame.id}.`);
    }
    frames.set(frame.id, frame);
  }
  return frames;
}

function requireFrame(
  frames: ReadonlyMap<string, NirvanaWestAtlasFrame>,
  id: string,
): NirvanaWestAtlasFrame {
  const frame = frames.get(id);
  if (frame === undefined) {
    throw new NirvanaWestPainterError(`Nirvana West atlas frame is missing: ${id}.`);
  }
  return frame;
}

function atlasIdFor(frame: NirvanaWestAtlasFrame): string {
  return frame.image === "terrain" ? NIRVANA_WEST_TERRAIN_ATLAS_ID : NIRVANA_WEST_SCENERY_ATLAS_ID;
}

/** True for the signature emberwisp props - always painted in their own last pass. */
function isEmberwispFrame(frameId: string): boolean {
  return frameId.startsWith("s.emberwisp.");
}

/**
 * Build the immutable draw plan: every ground tile, every corner-mask edge
 * transition, every rim line, every non-emberwisp prop sorted by foot, then
 * EVERY EMBERWISP PROP LAST so plumes sit over the whole picture regardless
 * of normal depth order.
 */
export function createNirvanaWestPaintPlan(
  scene: NirvanaWestScene,
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
  cacheIdentity = `nirvana-west-pilot-${scene.compositionId}-${scene.ruinKit}`,
): ProductionStaticScenePlan {
  const frames = indexNirvanaWestFrames(manifest);
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
    for (const rim of tile.rims) {
      const frame = requireFrame(frames, rimFrameId(rim.material, rim.mask, rim.variant));
      operations.push({
        stableId: `rim:${tile.column},${tile.row}:${rim.material}`,
        layer: "terrain",
        atlasId: atlasIdFor(frame),
        source: frame.rect,
        destination: { x, y, width: scene.tileSize, height: scene.tileSize },
      });
    }
  }

  const emberwispProps = scene.props.filter((prop) => isEmberwispFrame(prop.frameId));
  const otherProps = scene.props.filter((prop) => !isEmberwispFrame(prop.frameId));

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
  for (const prop of emberwispProps) {
    const frame = requireFrame(frames, prop.frameId);
    operations.push({
      stableId: `wisp:${prop.id}`,
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
export function renderNirvanaWestPlan(
  context: CanvasRenderingContext2D,
  plan: ProductionStaticScenePlan,
  sources: NirvanaWestAtlasSources,
  worldOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
): void {
  context.imageSmoothingEnabled = false;
  for (const operation of plan.operations) {
    const image = operation.atlasId === NIRVANA_WEST_TERRAIN_ATLAS_ID
      ? sources.terrain
      : operation.atlasId === NIRVANA_WEST_SCENERY_ATLAS_ID
        ? sources.scenery
        : null;
    if (image === null) {
      throw new NirvanaWestPainterError(`Unknown Nirvana West atlas ${operation.atlasId}.`);
    }
    drawProductionStaticSceneOperation(context, image, operation, worldOffset);
  }
}

// ---------------------------------------------------------------------------
// animated environment - fire/smoke/heat-haze overlay
//
// Mirrors production's `EnvironmentSystem.ts` phase math VERBATIM (contract):
// `phaseIndex(slot, nowMs)` / `seededSettledPhase(seed)` there become
// `nirvanaWestAnimationPhase` / `nirvanaWestSettledPhase` here, and the atlas
// cell arithmetic mirrors `productionManifest.ts:929-932` (`x = (cell % 8) *
// 32, y = floor(cell / 8) * 32`, `kinds[i]` occupying cells `i*4 .. i*4+3`).
// ---------------------------------------------------------------------------

/** Mirrors production's `EnvironmentSystem.ts` `ANIMATED_FRAME_COUNT` exactly. */
export const NIRVANA_WEST_ANIMATED_FRAME_COUNT = 4;

/** This pilot's per-frame duration; 4 frames * 160ms = a 640ms animation cycle. */
export const NIRVANA_WEST_ANIMATED_FRAME_MS = 160;

/**
 * The phase (frame index, `0..frameCount-1`) an animated placement shows at
 * `nowMs`, resolved STATELESSLY from `phaseSeed` alone - no per-frame update
 * loop, no stored "current frame" anywhere. Copied verbatim from production's
 * `EnvironmentSystem.ts` `phaseIndex` (`cycle = duration * frameCount;
 * phaseOffset = phaseSeed % cycle; floor((now + phaseOffset) / duration) %
 * frameCount`) so this pilot cannot drift from the real formula.
 *
 * @param nowMs - The animation clock, in milliseconds. A non-finite or
 *   negative value is clamped to 0 rather than propagating `NaN`/a negative
 *   phase offset.
 * @param phaseSeed - The placement's `phaseSeed` (non-negative integer).
 * @param durationMs - Per-frame duration; defaults to
 *   {@link NIRVANA_WEST_ANIMATED_FRAME_MS}.
 * @param frameCount - Frames per cycle; defaults to
 *   {@link NIRVANA_WEST_ANIMATED_FRAME_COUNT}.
 * @returns The frame index to draw, always in `[0, frameCount)`.
 */
export function nirvanaWestAnimationPhase(
  nowMs: number,
  phaseSeed: number,
  durationMs: number = NIRVANA_WEST_ANIMATED_FRAME_MS,
  frameCount: number = NIRVANA_WEST_ANIMATED_FRAME_COUNT,
): number {
  const clampedNow = Number.isFinite(nowMs) && nowMs >= 0 ? nowMs : 0;
  const cycle = durationMs * frameCount;
  const phaseOffset = phaseSeed % cycle;
  return Math.floor((clampedNow + phaseOffset) / durationMs) % frameCount;
}

/** The reduced-motion still: `phaseSeed % frameCount`. Mirrors `seededSettledPhase`. */
export function nirvanaWestSettledPhase(phaseSeed: number): number {
  return phaseSeed % NIRVANA_WEST_ANIMATED_FRAME_COUNT;
}

/** One placement's resolved draw geometry: its destination tile plus all 4 candidate frames. */
export interface NirvanaWestAnimatedOperation {
  readonly stableId: string;
  readonly destination: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly frames: readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
  readonly phaseSeed: number;
  readonly durationMs: number;
}

/** The static scene plan, unchanged, plus the animated-environment operations layered over it. */
export interface NirvanaWestPaintPlan {
  readonly plan: ProductionStaticScenePlan;
  readonly animated: readonly NirvanaWestAnimatedOperation[];
}

type FrameRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/**
 * Resolve `scene.animatedEnvironment` into draw-ready operations against
 * `manifest.environmentGrid`. Requires the COMPACT manifest form - the
 * expanded/explicit `NirvanaWestAtlasManifest` carries no environment grid.
 *
 * @throws {NirvanaWestPainterError} If the manifest is not compact, its
 *   environment grid geometry is invalid, its declared `kinds` overflow the
 *   32-cell sheet, or a placement's kind is missing from `kinds`.
 */
function buildAnimatedOperations(
  scene: NirvanaWestScene,
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
): readonly NirvanaWestAnimatedOperation[] {
  if (!isCompact(manifest)) {
    throw new NirvanaWestPainterError(
      "Nirvana West animated environment requires the compact manifest form - the expanded/"
      + "explicit NirvanaWestAtlasManifest carries no environmentGrid to derive frame rects from.",
    );
  }
  const { environmentGrid } = manifest;
  const { columns, cell, kinds } = environmentGrid;
  if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(cell) || cell <= 0) {
    throw new NirvanaWestPainterError(
      `Nirvana West atlas environment grid is invalid: ${columns} columns of ${cell}px.`,
    );
  }
  // The sheet this pilot's asset contract fixes is 256x128 at 32px cells - 8
  // columns x 4 rows = 32 cells total, so the row count here is the pilot's
  // fixed "4", not `NIRVANA_WEST_ANIMATED_FRAME_COUNT` reused by coincidence.
  const totalCells = columns * 4;
  const neededCells = kinds.length * NIRVANA_WEST_ANIMATED_FRAME_COUNT;
  if (neededCells > totalCells) {
    throw new NirvanaWestPainterError(
      `Nirvana West environment grid overflows its sheet: ${kinds.length} kinds x `
      + `${NIRVANA_WEST_ANIMATED_FRAME_COUNT} frames each needs ${neededCells} cells, but the `
      + `${columns}-column sheet holds only ${totalCells}.`,
    );
  }

  const framesByKind = new Map<NirvanaWestAnimatedKind, readonly FrameRect[]>();
  kinds.forEach((kind, kindIndex) => {
    const baseCell = kindIndex * NIRVANA_WEST_ANIMATED_FRAME_COUNT;
    const frames: FrameRect[] = [];
    for (let frame = 0; frame < NIRVANA_WEST_ANIMATED_FRAME_COUNT; frame += 1) {
      const cellIndex = baseCell + frame;
      frames.push(Object.freeze({
        x: (cellIndex % columns) * cell,
        y: Math.floor(cellIndex / columns) * cell,
        width: cell,
        height: cell,
      }));
    }
    framesByKind.set(kind, Object.freeze(frames));
  });

  return Object.freeze(scene.animatedEnvironment.map((placement) => {
    const frames = framesByKind.get(placement.kind);
    if (frames === undefined) {
      throw new NirvanaWestPainterError(
        `Nirvana West placement ${placement.id} has kind "${placement.kind}", which is not in the `
        + `environment grid's declared kinds (${kinds.join(", ")}).`,
      );
    }
    return Object.freeze({
      stableId: `env:${placement.id}`,
      destination: Object.freeze({
        x: placement.tile.column * scene.tileSize,
        y: placement.tile.row * scene.tileSize,
        width: scene.tileSize,
        height: scene.tileSize,
      }),
      frames,
      phaseSeed: placement.phaseSeed,
      durationMs: NIRVANA_WEST_ANIMATED_FRAME_MS,
    });
  }));
}

/**
 * Build both the static plan (unchanged behaviour, via
 * {@link createNirvanaWestPaintPlan}) and the resolved animated-environment
 * operations, in one call.
 */
export function createNirvanaWestFullPaintPlan(
  scene: NirvanaWestScene,
  manifest: NirvanaWestAtlasManifest | CompactNirvanaWestAtlasManifest,
  cacheIdentity = `nirvana-west-pilot-${scene.compositionId}-${scene.ruinKit}`,
): NirvanaWestPaintPlan {
  return Object.freeze({
    plan: createNirvanaWestPaintPlan(scene, manifest, cacheIdentity),
    animated: buildAnimatedOperations(scene, manifest),
  });
}

/**
 * Execute a full plan: the static scene first (via {@link renderNirvanaWestPlan},
 * unchanged), then EVERY animated operation LAST - after the emberwisp pass -
 * so fire and smoke sit over the whole picture.
 *
 * Each animated blit is validated through {@link createProductionStaticDrawOperation}
 * / drawn through {@link drawProductionStaticSceneOperation} - the same
 * production draw primitive every other operation in this painter uses. This
 * deliberately does NOT go through {@link createProductionStaticScenePlan}:
 * that helper's stable-id uniqueness check is a whole-ARRAY invariant meant
 * for a plan built once and cached, and an animated operation's resolved
 * frame changes every call as `nowMs` advances - constructing (and
 * validating) one fresh, single-operation record per draw sidesteps that
 * entirely rather than fighting it.
 *
 * @param nowMs - The animation clock, in milliseconds. Defaults to 0 (the
 *   first frame of every cycle).
 * @param reducedMotion - When true, every placement holds at its seeded
 *   settled still ({@link nirvanaWestSettledPhase}) instead of animating.
 */
export function renderNirvanaWestFullPlan(
  context: CanvasRenderingContext2D,
  plan: NirvanaWestPaintPlan,
  sources: NirvanaWestAtlasSources,
  worldOffset: Readonly<{ x: number; y: number }> = { x: 0, y: 0 },
  nowMs = 0,
  reducedMotion = false,
): void {
  renderNirvanaWestPlan(context, plan.plan, sources, worldOffset);
  context.imageSmoothingEnabled = false;
  for (const operation of plan.animated) {
    const phase = reducedMotion
      ? nirvanaWestSettledPhase(operation.phaseSeed)
      : nirvanaWestAnimationPhase(nowMs, operation.phaseSeed, operation.durationMs);
    const source = operation.frames[phase];
    const drawOperation = createProductionStaticDrawOperation({
      stableId: `${operation.stableId}:${phase}`,
      // Neither "terrain" (no pivot) nor a depth-sorted "scenery" role fits an
      // animated overlay drawn in its own always-last pass; "terrain" is
      // picked only because it is the layer that does not require `pivotY`.
      layer: "terrain",
      atlasId: NIRVANA_WEST_ENVIRONMENT_ATLAS_ID,
      source,
      destination: operation.destination,
    });
    drawProductionStaticSceneOperation(context, sources.environment, drawOperation, worldOffset);
  }
}
