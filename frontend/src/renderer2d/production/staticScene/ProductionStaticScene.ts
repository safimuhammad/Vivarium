/** Pure immutable draw-plan contract for exact-region production scenery. */

import type { Rect, Vec2 } from "../../contracts";
import type { PresentedObserverFrame } from "../../../presentation/contracts";
import type { RegionPresentationTopology } from "../../camera/RegionPresentationTopology";
import type { ProductionAssetLease } from "../assets/productionManifest";
import type {
  RegionMapRecipeV1,
  RegionPresentationProfile,
} from "../maps/RegionMapRecipe";

export type ProductionStaticSceneLayer = "terrain" | "scenery" | "continuation";

export interface ProductionStaticDrawOperation {
  readonly stableId: string;
  readonly layer: ProductionStaticSceneLayer;
  readonly atlasId: string;
  readonly source: Rect;
  readonly destination: Rect;
  /** World-space contact depth; required only for tall scenery operations. */
  readonly pivotY?: number;
}

export interface ProductionStaticScenePlan {
  readonly cacheIdentity: string;
  readonly operations: readonly ProductionStaticDrawOperation[];
}

export interface ProductionStaticSceneDescriptor {
  readonly cacheIdentity: string;
  readonly worldBounds: Rect;
  readonly topology: RegionPresentationTopology;
}

export interface ProductionStaticSceneContext {
  readonly frame: PresentedObserverFrame;
  readonly priorDescriptor: ProductionStaticSceneDescriptor | null;
}

export interface ProductionStaticSceneAdvanceResult {
  readonly done: boolean;
  readonly workUnits: number;
}

export interface ProductionStaticScenePreparation {
  readonly cacheIdentity: string;
  readonly descriptor: ProductionStaticSceneDescriptor;
  advance(
    maxWorkUnits: number,
    visit: (operation: ProductionStaticDrawOperation) => void,
  ): ProductionStaticSceneAdvanceResult;
  dispose(): void;
}

export interface ProductionStaticSceneProvider {
  readonly kind: RegionPresentationProfile["kind"];
  describe(
    recipe: RegionMapRecipeV1,
    context: ProductionStaticSceneContext,
  ): ProductionStaticSceneDescriptor;
  createPreparation(
    recipe: RegionMapRecipeV1,
    leases: ReadonlyMap<string, ProductionAssetLease>,
  ): ProductionStaticScenePreparation;
}

export class ProductionStaticSceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionStaticSceneError";
  }
}

/** Validate, detach, and freeze one cache/camera/topology descriptor. */
export function createProductionStaticSceneDescriptor(
  descriptor: ProductionStaticSceneDescriptor,
): ProductionStaticSceneDescriptor {
  if (descriptor.cacheIdentity.trim().length === 0) {
    throw new ProductionStaticSceneError("Static-scene descriptor identity must be non-empty.");
  }
  if (descriptor.topology !== "bounded" && descriptor.topology !== "toroidal") {
    throw new ProductionStaticSceneError("Static-scene descriptor topology is invalid.");
  }
  const worldBounds = ownWorldBounds(descriptor.worldBounds);
  return Object.freeze({
    cacheIdentity: descriptor.cacheIdentity,
    worldBounds,
    topology: descriptor.topology,
  });
}

/** Compare complete descriptor value identity without relying on caller object identity. */
export function sameProductionStaticSceneDescriptor(
  left: ProductionStaticSceneDescriptor,
  right: ProductionStaticSceneDescriptor,
): boolean {
  return left.cacheIdentity === right.cacheIdentity
    && left.topology === right.topology
    && left.worldBounds.x === right.worldBounds.x
    && left.worldBounds.y === right.worldBounds.y
    && left.worldBounds.width === right.worldBounds.width
    && left.worldBounds.height === right.worldBounds.height;
}

const MAX_PERIODIC_AXIS_COPIES = 4_096;
const MAX_PERIODIC_DRAW_COPIES = 65_536;

/** Return every translated world copy that intersects one validated visible viewport. */
export function visiblePeriodicDrawOffsets(
  worldBounds: Rect,
  visibleWorldBounds: Rect,
): readonly Vec2[] {
  validateFinitePositiveRect(worldBounds, "Periodic world bounds");
  validateFinitePositiveRect(visibleWorldBounds, "Periodic visible bounds");
  const xOffsets = visibleAxisOffsets(
    worldBounds.x,
    worldBounds.width,
    visibleWorldBounds.x,
    visibleWorldBounds.width,
  );
  const yOffsets = visibleAxisOffsets(
    worldBounds.y,
    worldBounds.height,
    visibleWorldBounds.y,
    visibleWorldBounds.height,
  );
  if (xOffsets.length * yOffsets.length > MAX_PERIODIC_DRAW_COPIES) {
    throw new ProductionStaticSceneError(
      "Periodic viewport requires too many intersecting draw copies.",
    );
  }
  const offsets: Vec2[] = [];
  for (const y of yOffsets) {
    for (const x of xOffsets) offsets.push(Object.freeze({ x, y }));
  }
  return Object.freeze(offsets);
}

/**
 * Half-width (px) of the band beside each seam whose beings get a periodic copy.
 *
 * Generous enough for a standing human envelope plus the overshoot of a being that has
 * already stepped past the rim on an unrolled route, and small enough that the extra pass
 * only ever runs while the viewer is actually looking at a seam.
 */
const SEAM_ACTOR_BAND_PX = 160;

/**
 * The translations at which a toroidal region's BEINGS must be redrawn so a crossing is
 * visible on both sides of the seam at once.
 *
 * At most one copy per edge and never a diagonal: a corner is never a legal wrap seam (see
 * `navigation/wrapSeams`), so a being can only ever be crossing one axis at a time.
 * Returns nothing for a bounded region, and nothing while the viewport is nowhere near a
 * seam — which is the overwhelmingly common case, so the pass costs nothing to have.
 *
 * @param descriptor - The observed region's presentation descriptor.
 * @param visibleWorldBounds - The world rect currently on screen.
 * @returns World-space translations to apply before the beings-only pass.
 */
export function visibleSeamActorOffsets(
  descriptor: Readonly<{ topology: RegionPresentationTopology; worldBounds: Rect }>,
  visibleWorldBounds: Rect,
): readonly Vec2[] {
  if (descriptor.topology !== "toroidal") return Object.freeze([]);
  const world = descriptor.worldBounds;
  if (!Number.isFinite(world.width) || !Number.isFinite(world.height)
    || world.width <= 0 || world.height <= 0) {
    return Object.freeze([]);
  }
  const offsets: Vec2[] = [];
  const sees = (x: number, y: number, width: number, height: number): boolean =>
    visibleWorldBounds.x < x + width
    && x < visibleWorldBounds.x + visibleWorldBounds.width
    && visibleWorldBounds.y < y + height
    && y < visibleWorldBounds.y + visibleWorldBounds.height;
  // +width carries the WEST band's beings onto the east edge, so it is worth drawing
  // exactly when the east seam is on screen. The other three read the same way.
  if (sees(world.x + world.width - SEAM_ACTOR_BAND_PX, world.y, SEAM_ACTOR_BAND_PX * 2, world.height)) {
    offsets.push(Object.freeze({ x: world.width, y: 0 }));
  }
  if (sees(world.x - SEAM_ACTOR_BAND_PX, world.y, SEAM_ACTOR_BAND_PX * 2, world.height)) {
    offsets.push(Object.freeze({ x: -world.width, y: 0 }));
  }
  if (sees(world.x, world.y + world.height - SEAM_ACTOR_BAND_PX, world.width, SEAM_ACTOR_BAND_PX * 2)) {
    offsets.push(Object.freeze({ x: 0, y: world.height }));
  }
  if (sees(world.x, world.y - SEAM_ACTOR_BAND_PX, world.width, SEAM_ACTOR_BAND_PX * 2)) {
    offsets.push(Object.freeze({ x: 0, y: -world.height }));
  }
  return Object.freeze(offsets);
}

/** Validate, detach, and freeze one exact-region static draw plan. */
export function createProductionStaticScenePlan(
  cacheIdentity: string,
  operations: readonly ProductionStaticDrawOperation[],
): ProductionStaticScenePlan {
  if (cacheIdentity.trim().length === 0) {
    throw new ProductionStaticSceneError("Static-scene cache identity must be non-empty.");
  }
  const stableIds = new Set<string>();
  const owned = operations.map((operation, index) => {
    const detached = createProductionStaticDrawOperation(operation, index);
    if (stableIds.has(operation.stableId)) {
      throw new ProductionStaticSceneError(
        `Static-scene operation has duplicate stable ID ${operation.stableId}.`,
      );
    }
    stableIds.add(operation.stableId);
    return detached;
  });
  return Object.freeze({
    cacheIdentity,
    operations: Object.freeze(owned),
  });
}

/** Validate, detach, and freeze one streamed exact-scene operation. */
export function createProductionStaticDrawOperation(
  operation: ProductionStaticDrawOperation,
  index = 0,
): ProductionStaticDrawOperation {
  if (operation.stableId.trim().length === 0) {
    throw new ProductionStaticSceneError(`Static-scene operation ${index} needs a stable ID.`);
  }
  if (operation.atlasId.trim().length === 0) {
    throw new ProductionStaticSceneError(
      `Static-scene operation ${operation.stableId} needs an atlas ID.`,
    );
  }
  if (operation.layer !== "terrain"
    && operation.layer !== "scenery"
    && operation.layer !== "continuation") {
    throw new ProductionStaticSceneError(
      `Static-scene operation ${operation.stableId} has an invalid layer.`,
    );
  }
  const source = ownRect(operation.source, "source", true);
  const destination = ownRect(operation.destination, "destination", false);
  if (operation.layer === "scenery") {
    if (!Number.isSafeInteger(operation.pivotY)) {
      throw new ProductionStaticSceneError(
        `Static-scene scenery operation ${operation.stableId} requires an integer pivotY.`,
      );
    }
  } else if (operation.pivotY !== undefined) {
    throw new ProductionStaticSceneError(
      `Static-scene pivot metadata belongs only to scenery operations.`,
    );
  }
  return Object.freeze({
    stableId: operation.stableId,
    layer: operation.layer,
    atlasId: operation.atlasId,
    source,
    destination,
    ...(operation.pivotY === undefined ? {} : { pivotY: operation.pivotY }),
  });
}

/** Execute one already-owned operation against an explicitly resolved atlas source. */
export function drawProductionStaticSceneOperation(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  operation: ProductionStaticDrawOperation,
  worldOffset: Vec2 = { x: 0, y: 0 },
): void {
  if (!Number.isFinite(worldOffset.x) || !Number.isFinite(worldOffset.y)) {
    throw new ProductionStaticSceneError("Static-scene draw offset must be finite.");
  }
  context.drawImage(
    image,
    operation.source.x,
    operation.source.y,
    operation.source.width,
    operation.source.height,
    Math.round(operation.destination.x - worldOffset.x),
    Math.round(operation.destination.y - worldOffset.y),
    operation.destination.width,
    operation.destination.height,
  );
}

function ownRect(rect: Rect, label: "source" | "destination", nonNegative: boolean): Rect {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every(Number.isSafeInteger)
    || rect.width <= 0
    || rect.height <= 0
    || (nonNegative && (rect.x < 0 || rect.y < 0))) {
    throw new ProductionStaticSceneError(
      `Static-scene ${label} rectangle requires valid integer geometry.`,
    );
  }
  return Object.freeze({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  });
}

function ownWorldBounds(rect: Rect): Rect {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isSafeInteger)
    || rect.width <= 0
    || rect.height <= 0
    || !Number.isSafeInteger(rect.x + rect.width)
    || !Number.isSafeInteger(rect.y + rect.height)) {
    throw new ProductionStaticSceneError(
      "Static-scene descriptor bounds require valid integer geometry.",
    );
  }
  return Object.freeze({ ...rect });
}

function validateFinitePositiveRect(rect: Rect, label: string): void {
  if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    || rect.width <= 0
    || rect.height <= 0
    || !Number.isFinite(rect.x + rect.width)
    || !Number.isFinite(rect.y + rect.height)) {
    throw new ProductionStaticSceneError(`${label} require finite positive geometry.`);
  }
}

function visibleAxisOffsets(
  worldOrigin: number,
  worldExtent: number,
  visibleOrigin: number,
  visibleExtent: number,
): readonly number[] {
  const visibleEnd = visibleOrigin + visibleExtent;
  const firstPeriod = Math.floor((visibleOrigin - worldOrigin) / worldExtent);
  const lastPeriodExclusive = Math.ceil((visibleEnd - worldOrigin) / worldExtent);
  const copyCount = lastPeriodExclusive - firstPeriod;
  if (!Number.isSafeInteger(firstPeriod)
    || !Number.isSafeInteger(lastPeriodExclusive)
    || !Number.isSafeInteger(copyCount)
    || copyCount <= 0
    || copyCount > MAX_PERIODIC_AXIS_COPIES) {
    throw new ProductionStaticSceneError(
      "Periodic viewport requires invalid or excessive axis coverage.",
    );
  }
  const offsets: number[] = [];
  for (let period = firstPeriod; period < lastPeriodExclusive; period += 1) {
    const offset = period * worldExtent;
    if (!Number.isFinite(offset)) {
      throw new ProductionStaticSceneError("Periodic draw offset must be finite.");
    }
    offsets.push(offset === 0 ? 0 : offset);
  }
  return offsets;
}
