/**
 * @fileoverview Camera-bounded Canvas painter for production Nirvana West.
 *
 * Streams one immutable draw plan through the shared `ProductionStaticScene` primitives —
 * the same validated operation record, stable-id uniqueness rule and integer blit the
 * Warm Springs and Nirvana East painters use. Only the frame VOCABULARY is new, which is
 * exactly what a redesigned tile set is.
 *
 * Paint order, promoted from the approved pilot (`src/qa/nirvanaWestPilot/
 * nirvanaWestPainter.ts`'s `createNirvanaWestPaintPlan`) and adapted to the production
 * streaming shape:
 *
 * 1. **Base fills**, every tile. One sweep so a material boundary interlocks everywhere.
 * 2. **Corner-masked transitions**, every tile. Laid over the fills, so no 32 px tile
 *    border survives anywhere in the region. Mask 15 is total coverage and is served by
 *    the base fill frame instead — the authoring script draws no `e.*.15.*` cell.
 * 3. **Rim lines**, every tile. Riding the exact contour a bank material's own edge
 *    transition was cut with (`nirvanaWestRimFrameId` shares mask and variant with the
 *    edge it rides), so the wet-looking line never reads as a second, unrelated curve.
 * 4. **Flat ground evidence**, in its own pass, BEFORE any standing scenery and OUTSIDE
 *    the foot sort. Of the ground-evidence species the design originally scoped
 *    (`slab` / `apron` / `spill` / `railspur`), only `railspur` survived into the
 *    published `nirvana-west-v1` scenery vocabulary — `slab` and `spoil` were promoted
 *    to full TERRAIN MATERIALS instead (they paint through steps 1-3 like any other
 *    material; see `NirvanaWestMaterials.ts`'s "Differences from the approved pilot
 *    vocabulary"), and `apron`/`spill` did not ship. `railspur` is a flat decal with no
 *    height — a rail bed laid straight over the ground — and must sit visually under
 *    everything that stands, never occluding and never being occluded by a foot-sort
 *    comparison that has no meaning for something with no foot. `tailings` is NOT flat
 *    (it has a body) and is drawn in the ordinary foot sort with every other prop.
 * 5. **Scenery**, in ONE foot sort shared by the recipe's authored placements and the
 *    terrain field's own props (flat ground evidence and emberwisp excluded — see steps 4
 *    and 6): a snag standing in front of a slag reef must occlude it, and they are
 *    different layers only in the authoring model.
 * 6. **Emberwisp, last of all.** Plumes are this region's signature ambient element — the
 *    direct analogue of Warm Springs' steam pass / Nirvana East's dust-devil pass — and
 *    must sit over the whole picture regardless of where their foot anchor would otherwise
 *    sort them.
 * 7. **The continuation matte**, the 8x8 pattern the renderer repeats outside the region.
 *    Warm Springs uses `t.grass.<v>`; this region's anchor ground tier is `slate` (the
 *    production-continuity anchor tier `NirvanaWestMaterials.ts` documents), so the matte
 *    uses `t.slate.<v>`.
 *
 * The `ash-waste` kit's authored `staticScenery` placements are drawn at their exact
 * authored tiles, in the approved vocabulary, by semantic kind. Nothing is displaced and
 * nothing is retired: `charred-trunk` becomes a snag, `slag-rock` a slag boulder,
 * `ash-pile` an ash pile, `bone-stone` a bone-pale stone. Their `blocksMovement` flags are
 * already in the recipe's collision, so the picture and the mask continue to agree.
 *
 * **Deliberately NOT drawn here: the animated environment.** The pilot painter carries an
 * animated fire/smoke/heat-haze layer (`createNirvanaWestFullPaintPlan`,
 * `nirvanaWestAnimationPhase`). In production that layer is owned entirely by
 * `environment/EnvironmentSystem`, which draws it per frame from `recipe.animatedEnvironment`
 * against the per-kit `ash-waste-environment` atlas — never per-region art (see
 * `NirvanaWestAssetProfile.ts`'s `assertNoEnvironmentImage`). A static scene is a CACHED
 * canvas and cannot animate, so reproducing the animated pass here would either be dead
 * code or a second, driftable source of the same frames. The terrain already carries the
 * fire's hot ground (the `ember`/`emberdim` fissure floor and the `coral-ember-fissure`
 * terrain patch role), so the static picture is not missing the region's identity — only
 * its motion, which belongs to the environment system.
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
import {
  createNirvanaWestAtlasAssets,
  requireNirvanaWestFrame,
  type NirvanaWestAtlasAssets,
  type NirvanaWestAtlasFrame,
} from "./NirvanaWestAtlas";
import {
  nirvanaWestBaseFrameId,
  nirvanaWestEdgeFrameId,
  nirvanaWestRimFrameId,
} from "./NirvanaWestMaterials";
import {
  NIRVANA_WEST_TILE_SIZE,
  type NirvanaWestScene,
} from "./NirvanaWestTerrainField";

export { createNirvanaWestAtlasAssets };

const CONTINUATION_TILES = 8;

/**
 * The production-continuity anchor ground tier — see the module docstring's step 7 for
 * why this is `slate` and not an arbitrary field material.
 */
const CONTINUATION_MATERIAL = "slate" as const;

/**
 * The flat ground-evidence species: no height, drawn under everything, no foot sort.
 *
 * Only `railspur` ships as a scenery species — see the module docstring's step 4 for
 * why `slab`/`apron`/`spill` are not here (two became terrain materials, one never
 * shipped). `tailings` is deliberately absent: it has a body and belongs in the
 * ordinary foot sort with every other standing prop.
 */
const FLAT_GROUND_EVIDENCE_SPECIES: ReadonlySet<string> = new Set([
  "railspur",
]);

export class NirvanaWestPainterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestPainterError";
  }
}

/**
 * Authored kit scenery kind -> approved Nirvana West sprite family.
 *
 * The `ash-waste` kit publishes exactly four semantic scenery kinds (`biomeKits.ts`:
 * blocking `charred-trunk` / `slag-rock`, passive `ash-pile` / `bone-stone`). Every one has
 * a same-meaning counterpart in the approved `nirvana-west-v1` vocabulary, so re-drawing
 * them costs no placement and no byte:
 *
 * - `charred-trunk` (blocking) -> `snag` — a burnt, standing dead trunk; the closest
 *   published texture to a fire-killed tree stub.
 * - `slag-rock` (blocking) -> `slagrock` — literal name and meaning match: a lump of
 *   solidified slag, one tile, solid.
 * - `ash-pile` (passive) -> `ashpile` — literal name and meaning match: a drift of loose
 *   ash, does not block.
 * - `bone-stone` (passive) -> `bonestone` — literal name and meaning match: a pale,
 *   bone-coloured stone, does not block.
 */
const AUTHORED_SCENERY_SPECIES: Readonly<Record<string, Readonly<{
  species: string;
  variants: number;
}>>> = Object.freeze({
  "charred-trunk": Object.freeze({ species: "snag", variants: 4 }),
  "slag-rock": Object.freeze({ species: "slagrock", variants: 4 }),
  "ash-pile": Object.freeze({ species: "ashpile", variants: 4 }),
  "bone-stone": Object.freeze({ species: "bonestone", variants: 4 }),
});

interface SortableDraw {
  readonly operation: ProductionStaticDrawOperation;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly stableId: string;
}

/** True for the signature emberwisp props — always painted in their own last pass. */
function isEmberwispFrame(frameId: string): boolean {
  return frameId.startsWith("s.emberwisp.");
}

/** True for the flat ground-evidence species — drawn under everything, never foot-sorted. */
function isFlatGroundEvidenceSpecies(species: string): boolean {
  return FLAT_GROUND_EVIDENCE_SPECIES.has(species);
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
  frame: NirvanaWestAtlasFrame,
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

function* nirvanaWestPaintOperations(
  scene: NirvanaWestScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaWestAtlasAssets,
): Generator<ProductionStaticDrawOperation, void, undefined> {
  const tile = NIRVANA_WEST_TILE_SIZE;

  // 1. Base fills, every tile.
  for (const cell of scene.tiles) {
    yield frameOperation(
      `terrain:${cell.column},${cell.row}`,
      "terrain",
      requireNirvanaWestFrame(assets, nirvanaWestBaseFrameId(cell.base, cell.baseVariant)),
      cell.column * tile,
      cell.row * tile,
      tile,
      tile,
    );
  }

  // 2. Corner-masked transitions, every tile. Mask 15 is served by the base fill instead.
  for (const cell of scene.tiles) {
    for (let index = 0; index < cell.overlays.length; index += 1) {
      const overlay = cell.overlays[index]!;
      const frameId = overlay.mask === 15
        ? nirvanaWestBaseFrameId(overlay.material, overlay.variant)
        : nirvanaWestEdgeFrameId(overlay.material, overlay.mask, overlay.variant);
      yield frameOperation(
        `terrain-overlay:${cell.column},${cell.row}:${index}`,
        "terrain",
        requireNirvanaWestFrame(assets, frameId),
        cell.column * tile,
        cell.row * tile,
        tile,
        tile,
      );
    }
  }

  // 3. Rim lines, every tile.
  for (const cell of scene.tiles) {
    for (let index = 0; index < cell.rims.length; index += 1) {
      const rim = cell.rims[index]!;
      yield frameOperation(
        `terrain-rim:${cell.column},${cell.row}:${index}`,
        "terrain",
        requireNirvanaWestFrame(assets, nirvanaWestRimFrameId(rim.material, rim.mask, rim.variant)),
        cell.column * tile,
        cell.row * tile,
        tile,
        tile,
      );
    }
  }

  // 4. Flat ground evidence, before all standing scenery and outside the foot sort.
  for (const prop of scene.props) {
    if (!isFlatGroundEvidenceSpecies(prop.species)) continue;
    const frame = requireNirvanaWestFrame(assets, prop.frameId);
    yield frameOperation(
      `flat:${prop.id}`,
      "scenery",
      frame,
      prop.x,
      prop.y,
      frame.rect.width,
      frame.rect.height,
      prop.footY,
    );
  }

  // 5. Scenery, in one shared foot sort: authored placements + the terrain field's own
  // props (flat ground evidence already drawn in step 4, emberwisp reserved for step 6).
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
    const frame = requireNirvanaWestFrame(assets, `s.${species.species}.${variant}`);
    // Foot-anchored on the placement's own tile centre, so the sprite stands where the
    // recipe says it stands regardless of how tall the new art is.
    const footX = placement.tile.column * tile + tile / 2;
    const footY = placement.tile.row * tile + tile;
    const worldX = footX - frame.pivot.x;
    const worldY = footY - frame.pivot.y;
    const stableId = `authored:${placement.id}`;
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
      stableId,
    });
  }

  for (const prop of scene.props) {
    if (isFlatGroundEvidenceSpecies(prop.species)) continue;
    if (isEmberwispFrame(prop.frameId)) continue;
    const frame = requireNirvanaWestFrame(assets, prop.frameId);
    const stableId = `prop:${prop.id}`;
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
      stableId,
    });
  }

  sorted.sort((left, right) => (
    left.pivotY - right.pivotY
    || left.pivotX - right.pivotX
    || left.stableId.localeCompare(right.stableId)
  ));
  for (const { operation } of sorted) yield operation;

  // 6. Emberwisp, last of all — over the whole picture regardless of foot order.
  for (const prop of scene.props) {
    if (!isEmberwispFrame(prop.frameId)) continue;
    const frame = requireNirvanaWestFrame(assets, prop.frameId);
    yield frameOperation(
      `wisp:${prop.id}`,
      "scenery",
      frame,
      prop.x,
      prop.y,
      frame.rect.width,
      frame.rect.height,
      prop.footY,
    );
  }

  // 7. The continuation matte, the region's anchor ground tier tiled 8x8.
  for (let row = 0; row < CONTINUATION_TILES; row += 1) {
    for (let column = 0; column < CONTINUATION_TILES; column += 1) {
      const variant = continuationVariant(column, row);
      yield frameOperation(
        `continuation:${column},${row}`,
        "continuation",
        requireNirvanaWestFrame(assets, nirvanaWestBaseFrameId(CONTINUATION_MATERIAL, variant)),
        column * tile,
        row * tile,
        tile,
        tile,
      );
    }
  }
}

function continuationVariant(column: number, row: number): number {
  let value = (
    0x4e56_5745
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
 * @param assets - The bound `nirvana-west-v1` sheets.
 * @param cacheIdentity - The renderer's cache key for this scene.
 * @returns A disposable preparation the renderer drains incrementally.
 * @throws {NirvanaWestPainterError} On an empty cache identity, a non-positive work
 *   budget, use after disposal or completion, or a duplicate stable id.
 */
export function createNirvanaWestPaintPreparation(
  scene: NirvanaWestScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaWestAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePreparation {
  if (cacheIdentity.trim().length === 0) {
    throw new NirvanaWestPainterError("Nirvana West paint cache identity must be non-empty.");
  }
  const iterator = nirvanaWestPaintOperations(scene, recipe, assets);
  const descriptor = createProductionStaticSceneDescriptor({
    cacheIdentity,
    worldBounds: {
      x: 0,
      y: 0,
      width: scene.columns * NIRVANA_WEST_TILE_SIZE,
      height: scene.rows * NIRVANA_WEST_TILE_SIZE,
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
        throw new NirvanaWestPainterError(
          "Nirvana West paint preparation needs a positive work budget.",
        );
      }
      if (disposed) throw new NirvanaWestPainterError("Nirvana West paint preparation is disposed.");
      if (completed) {
        throw new NirvanaWestPainterError("Nirvana West paint preparation is complete.");
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
            throw new NirvanaWestPainterError(
              `Nirvana West paint operation has duplicate stable ID ${operation.stableId}.`,
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
export function createNirvanaWestPaintPlan(
  scene: NirvanaWestScene,
  recipe: RegionMapRecipeV1,
  assets: NirvanaWestAtlasAssets,
  cacheIdentity: string,
): ProductionStaticScenePlan {
  const preparation = createNirvanaWestPaintPreparation(scene, recipe, assets, cacheIdentity);
  const operations: ProductionStaticDrawOperation[] = [];
  let done = false;
  while (!done) {
    done = preparation.advance(1_536, (operation) => operations.push(operation)).done;
  }
  preparation.dispose();
  return createProductionStaticScenePlan(cacheIdentity, operations);
}
