/**
 * @fileoverview Camera-bounded Canvas painter for production Nirvana East.
 *
 * Streams one immutable draw plan through the shared `ProductionStaticScene` primitives —
 * the same validated operation record, stable-id uniqueness rule and integer blit the
 * Warm Springs and Nirvana painters use. Only the frame VOCABULARY is new, which is
 * exactly what a redesigned tile set is.
 *
 * Paint order, promoted verbatim from the approved pilot (`src/qa/nirvanaEastPilot/
 * eastPainter.ts`'s `createEastPaintPlan`, contract §6):
 *
 * 1. **Base fills**, every tile. One sweep so a material boundary interlocks everywhere.
 * 2. **Corner-masked transitions and wet lines**, every tile. Laid over the fills, so no
 *    32 px tile border survives anywhere in the region.
 * 3. **Scenery**, in ONE foot sort shared by the recipe's authored placements and the
 *    terrain field's own props (dust devils excluded here — see step 4): a butte's talus
 *    in front of a boulder must occlude it, and they are different layers only in the
 *    authoring model.
 * 4. **Dust devils, last of all.** Plumes are Nirvana East's signature element — this
 *    region's analogue of Warm Springs' steam pass (contract §6) — and must sit over the
 *    whole picture regardless of where their foot anchor would otherwise sort them.
 * 5. **The continuation matte**, the 8x8 pattern the renderer repeats outside the region.
 *    Warm Springs uses `t.grass.<v>`; Nirvana East has no grass. Composition B's floor is
 *    deliberately a PALE, CALM playa: `openFloorMaterialAt` (`eastScene.ts`) returns
 *    "hardpan" for the majority of its input range (everything between the salt-pan and
 *    oxide/gravel/redsand/dustgrass accent thresholds) — it is the honest dominant open
 *    floor material of the composition this atlas was authored for, so the matte uses
 *    `t.hardpan.<v>` rather than an arbitrary field material.
 *
 * The `dry-scrub` kit's authored `staticScenery` placements are drawn at their exact
 * authored tiles, in the approved vocabulary, by semantic kind. Nothing is displaced and
 * nothing is retired: `sun-rock` becomes a boulder, `deadwood` stays deadwood (same name,
 * same meaning), `dry-grass` a bunchgrass clump, `thorn` a thornbush. Their
 * `blocksMovement` flags are already in the recipe's collision, so the picture and the
 * mask continue to agree.
 *
 * Landform props (`s.mesa.0` / `s.butte.0` / `s.outcrop.0`) draw at their AUTHORED pivot:
 * `propsForLandform` (`eastScene.ts`, and its production equivalent in
 * `NirvanaEastTerrainField.ts`) already emits `x`/`y` pre-offset by the pivot, so this
 * module draws at `prop.x`/`prop.y` with `pivotY: prop.footY` exactly as the pilot painter
 * does — re-applying the pivot here would double-offset every landform in the region.
 */

import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import {
  createProductionStaticSceneDescriptor,
  createProductionStaticDrawOperation,
  createProductionStaticScenePlan,
  type ProductionStaticSceneAdvanceResult,
  type ProductionStaticDrawOperation,
  type ProductionStaticScenePlan,
  type ProductionStaticScenePreparation,
} from "../staticScene/ProductionStaticScene";
import { createGroundingAccentOperation } from "../staticScene/StaticPainterAccents";
import {
  createNirvanaEastAtlasAssets,
  requireNirvanaEastFrame,
  nirvanaEastBaseFrameId,
  nirvanaEastEdgeFrameId,
  nirvanaEastShoreFrameId,
  type NirvanaEastAtlasAssets,
  type NirvanaEastAtlasFrame,
} from "./NirvanaEastAtlas";
import {
  NIRVANA_EAST_TILE_SIZE,
  type NirvanaEastScene,
} from "./NirvanaEastTerrainField";

export { createNirvanaEastAtlasAssets };

const CONTINUATION_TILES = 8;

/**
 * The honest dominant open-floor material of composition B ("Butte Country") — see the
 * module docstring's step 5 for why `hardpan` and not an arbitrary field material.
 */
const CONTINUATION_MATERIAL = "hardpan" as const;

export class NirvanaEastPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaEastPainterError";
  }
}

/**
 * Authored kit scenery kind -> approved Nirvana East sprite family.
 *
 * The `dry-scrub` kit publishes exactly four semantic scenery kinds
 * (`biomeKits.ts`: blocking `sun-rock` / `deadwood`, passive `dry-grass` / `thorn`).
 * Every one has a same-meaning counterpart in the approved `nirvana-east-v1` vocabulary
 * (enumerated from the published atlas's `sceneryFrames`), so re-drawing them costs no
 * placement and no byte:
 *
 * - `sun-rock` (blocking) -> `boulder` — the published vocabulary's blocking rock mass;
 *   same role a sun-baked desert rock plays, one tile, solid.
 * - `deadwood` (blocking) -> `deadwood` — literal name and meaning match: a fallen,
 *   sun-bleached trunk that blocks passage.
 * - `dry-grass` (passive) -> `bunchgrass` — sparse, non-blocking bunch grass clumped over
 *   bare ground; the closest published texture to a generic "dry grass" kind.
 * - `thorn` (passive) -> `thornbush` — literal name and meaning match: thorny scrub, does
 *   not block.
 */
const AUTHORED_SCENERY_SPECIES: Readonly<Record<string, Readonly<{
  species: string;
  variants: number;
}>>> = Object.freeze({
  "sun-rock": Object.freeze({ species: "boulder", variants: 4 }),
  deadwood: Object.freeze({ species: "deadwood", variants: 3 }),
  "dry-grass": Object.freeze({ species: "bunchgrass", variants: 4 }),
  thorn: Object.freeze({ species: "thornbush", variants: 4 }),
});

interface SortableDraw {
  readonly operation: ProductionStaticDrawOperation;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly sortPriority: number;
  readonly stableId: string;
}

/** True for the signature dust-devil props — always painted in their own last pass. */
function isDustDevilFrame(frameId: string): boolean {
  return frameId.startsWith("s.dustdevil.");
}

/** Deterministic variant pick for an authored placement, stable in id and position. */
function authoredVariantIndex(
  placementId: string,
  column: number,
  row: number,
  variantCount: number,
): number {
  let hash = 2166136261 >>> 0;
  const identity = `${placementId} ${column},${row}`;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash >>> 0) % variantCount;
}

function frameOperation(
  stableId: string,
  layer: ProductionStaticDrawOperation["layer"],
  frame: NirvanaEastAtlasFrame,
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

function* nirvanaEastPaintOperations(
  scene: NirvanaEastScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaEastAtlasAssets,
): Generator<ProductionStaticDrawOperation, void, undefined> {
  const tile = NIRVANA_EAST_TILE_SIZE;

  for (const cell of scene.tiles) {
    yield frameOperation(
      `terrain:${cell.column},${cell.row}`,
      "terrain",
      requireNirvanaEastFrame(assets, nirvanaEastBaseFrameId(cell.base, cell.baseVariant)),
      cell.column * tile,
      cell.row * tile,
      tile,
      tile,
    );
  }

  for (const cell of scene.tiles) {
    for (let index = 0; index < cell.overlays.length; index += 1) {
      const overlay = cell.overlays[index]!;
      const frameId = overlay.mask === 15
        ? nirvanaEastBaseFrameId(overlay.material, overlay.variant)
        : nirvanaEastEdgeFrameId(overlay.material, overlay.mask, overlay.variant);
      yield frameOperation(
        `terrain-overlay:${cell.column},${cell.row}:${index}`,
        "terrain",
        requireNirvanaEastFrame(assets, frameId),
        cell.column * tile,
        cell.row * tile,
        tile,
        tile,
      );
    }
    for (let index = 0; index < cell.shorelines.length; index += 1) {
      const shore = cell.shorelines[index]!;
      yield frameOperation(
        `terrain-shore:${cell.column},${cell.row}:${index}`,
        "terrain",
        requireNirvanaEastFrame(
          assets,
          nirvanaEastShoreFrameId(shore.material, shore.mask, shore.variant),
        ),
        cell.column * tile,
        cell.row * tile,
        tile,
        tile,
      );
    }
  }

  const sorted: SortableDraw[] = [];

  for (const placement of recipe.staticScenery) {
    const species = AUTHORED_SCENERY_SPECIES[placement.kind];
    if (species === undefined) continue;
    const variant = authoredVariantIndex(
      placement.id,
      placement.tile.column,
      placement.tile.row,
      species.variants,
    );
    const frame = requireNirvanaEastFrame(assets, `s.${species.species}.${variant}`);
    // Foot-anchored on the placement's own tile centre, so the sprite stands where the
    // recipe says it stands regardless of how tall the new art is.
    const footX = placement.tile.column * tile + tile / 2;
    const footY = placement.tile.row * tile + tile;
    const worldX = footX - frame.pivot.x;
    const worldY = footY - frame.pivot.y;
    const stableId = `authored:${placement.id}`;
    if (isGroundingAccentScenery(frame.id)) {
      const accent = createGroundingAccentOperation(
        `grounding:${stableId}`,
        frame,
        footX,
        footY,
      );
      sorted.push({
        operation: accent,
        pivotX: footX,
        pivotY: footY,
        sortPriority: 0,
        stableId: accent.stableId,
      });
    }
    sorted.push({
      operation: frameOperation(
        stableId,
        "scenery",
        frame,
        worldX,
        worldY,
        frame.rect.width,
        frame.rect.height,
        footY,
      ),
      pivotX: footX,
      pivotY: footY,
      sortPriority: 1,
      stableId,
    });
  }

  for (const prop of scene.props) {
    if (isDustDevilFrame(prop.frameId)) continue;
    const frame = requireNirvanaEastFrame(assets, prop.frameId);
    const stableId = `prop:${prop.id}`;
    // Landform props (`s.mesa.0` / `s.butte.0` / `s.outcrop.0`) arrive with `x`/`y`
    // already offset by their authored pivot (see the module docstring) — draw them at
    // their own coordinates unmodified, exactly like every other prop.
    if (isGroundingAccentScenery(prop.frameId)) {
      const accent = createGroundingAccentOperation(
        `grounding:${stableId}`,
        frame,
        prop.footX,
        prop.footY,
      );
      sorted.push({
        operation: accent,
        pivotX: prop.footX,
        pivotY: prop.footY,
        sortPriority: 0,
        stableId: accent.stableId,
      });
    }
    sorted.push({
      operation: frameOperation(
        stableId,
        "scenery",
        frame,
        prop.x,
        prop.y,
        frame.rect.width,
        frame.rect.height,
        prop.footY,
      ),
      pivotX: prop.footX,
      pivotY: prop.footY,
      sortPriority: 1,
      stableId,
    });
  }

  sorted.sort((left, right) => (
    left.pivotY - right.pivotY
    || left.pivotX - right.pivotX
    || left.sortPriority - right.sortPriority
    || left.stableId.localeCompare(right.stableId)
  ));
  for (const { operation } of sorted) yield operation;

  for (const prop of scene.props) {
    if (!isDustDevilFrame(prop.frameId)) continue;
    const frame = requireNirvanaEastFrame(assets, prop.frameId);
    yield frameOperation(
      `dustdevil:${prop.id}`,
      "scenery",
      frame,
      prop.x,
      prop.y,
      frame.rect.width,
      frame.rect.height,
      prop.footY,
    );
  }

  for (let row = 0; row < CONTINUATION_TILES; row += 1) {
    for (let column = 0; column < CONTINUATION_TILES; column += 1) {
      const variant = continuationVariant(column, row);
      yield frameOperation(
        `continuation:${column},${row}`,
        "continuation",
        requireNirvanaEastFrame(assets, nirvanaEastBaseFrameId(CONTINUATION_MATERIAL, variant)),
        column * tile,
        row * tile,
        tile,
        tile,
      );
    }
  }
}

/** Existing large/structural East frames that benefit from a small grounded edge. */
function isGroundingAccentScenery(frameId: string): boolean {
  return [
    "s.mesa.",
    "s.butte.",
    "s.outcrop.",
    "s.hoodoo.",
    "s.mesquite.",
    "s.boulder.",
    "s.deadwood.",
    "s.plank.",
  ].some((prefix) => frameId.startsWith(prefix));
}

function continuationVariant(column: number, row: number): number {
  let value = (
    0x4e45_4153
    ^ Math.imul(column + 1, 0x45d9_f3b)
    ^ Math.imul(row + 1, 0x119d_e1f3)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d) >>> 0;
  return (value ^ (value >>> 15)) & 7;
}

/**
 * Create an O(1) cursor that streams the exact shared paint order under a work budget.
 *
 * @param scene - The built terrain field.
 * @param recipe - The region recipe the scene was built for (path network + scenery).
 * @param assets - The bound `nirvana-east-v1` sheets.
 * @param cacheIdentity - The renderer's cache key for this scene.
 * @returns A disposable preparation the renderer drains incrementally.
 * @throws {NirvanaEastPainterError} On an empty cache identity, a non-positive work
 *   budget, use after disposal or completion, or a duplicate stable id.
 */
export function createNirvanaEastPaintPreparation(
  scene: NirvanaEastScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaEastAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePreparation {
  if (cacheIdentity.trim().length === 0) {
    throw new NirvanaEastPainterError("Nirvana East paint cache identity must be non-empty.");
  }
  const iterator = nirvanaEastPaintOperations(scene, recipe, assets);
  const descriptor = createProductionStaticSceneDescriptor({
    cacheIdentity,
    worldBounds: {
      x: 0,
      y: 0,
      width: scene.columns * NIRVANA_EAST_TILE_SIZE,
      height: scene.rows * NIRVANA_EAST_TILE_SIZE,
    },
    topology: "bounded",
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
        throw new NirvanaEastPainterError(
          "Nirvana East paint preparation needs a positive work budget.",
        );
      }
      if (disposed) throw new NirvanaEastPainterError("Nirvana East paint preparation is disposed.");
      if (completed) {
        throw new NirvanaEastPainterError("Nirvana East paint preparation is complete.");
      }
      let workUnits = 0;
      try {
        while (workUnits < maxWorkUnits) {
          const next = iterator.next();
          if (next.done === true) {
            completed = true;
            return Object.freeze({ done: true, workUnits });
          }
          const operation = createProductionStaticDrawOperation(next.value, operationIndex);
          if (stableIds.has(operation.stableId)) {
            throw new NirvanaEastPainterError(
              `Nirvana East paint operation has duplicate stable ID ${operation.stableId}.`,
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

/** Drain the bounded preparation explicitly, for tests and inspection tools. */
export function createNirvanaEastPaintPlan(
  scene: NirvanaEastScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaEastAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePlan {
  const preparation = createNirvanaEastPaintPreparation(scene, recipe, assets, cacheIdentity);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    done = preparation.advance(1_536, (operation) => operations.push(operation)).done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(cacheIdentity, operations);
}
