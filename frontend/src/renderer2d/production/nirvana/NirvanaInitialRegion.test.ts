import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import {
  feetAnchoredVisualRect,
  shelterRenderRect,
} from "../productionGeometry";
import {
  NIRVANA_AUTHORED_CHUNK_COORDS,
  createNirvanaAuthoredChunk,
  nirvanaAuthoredChunkGeometry,
} from "./NirvanaChunkAuthoring";
import type { NirvanaChunk } from "./NirvanaRegionV2";
import { createNirvanaRootChunk, nirvanaRootChunkGeometry } from "./NirvanaRootChunk";
import {
  createNirvanaGenesisTerrainField,
  type NirvanaChunkGeometry,
} from "./NirvanaTerrainChunks";
import {
  createNirvanaInitialRegion,
  type NirvanaMechanicsExclusions,
} from "./NirvanaInitialRegion";

/**
 * The root's audited boundary-barrier removals (mirrors the private `ROOT_REMOVALS`
 * in `NirvanaInitialRegion.ts`; also asserted independently below).
 */
const AUDITED_ROOT_REMOVALS: readonly string[] = [
  "woodland-east-lower",
  "woodland-east-bottom",
  "woodland-bottom-midwest",
  "woodland-bottom-mideast",
  "woodland-bottom-east",
];

/**
 * Reconstruct the exact field-based, PRE-adaptation root chunk `createNirvanaInitialRegion`
 * builds internally (its `sourceRoot`), so tests can compare the derived root against the
 * right baseline.
 *
 * owner-authorised Option A re-baseline, plan §P3: the terrain field adds a SECOND,
 * silent landmark-removal mechanism (a boundary landmark standing in the new river is
 * retired by the water verdict) alongside the original, audited `ROOT_REMOVALS`
 * mechanism. Diffing the derived root against the field-FREE `createNirvanaRootChunk()`
 * conflates both mechanisms into one delta; diffing it against this field-based,
 * pre-adaptation root isolates exactly the audited one, which is what the receipts
 * are actually supposed to account for.
 *
 * The geometry is declared through the SAME functions production uses
 * (`nirvanaRootChunkGeometry` / `nirvanaAuthoredChunkGeometry`) rather than read back out
 * of a built chunk. Reading it back drops the relocation tables — a built chunk publishes
 * one placement per landmark, not two — which would give this baseline a different water
 * verdict from the region it is meant to mirror.
 */
function unadaptedFieldRoot(exclusions: NirvanaMechanicsExclusions): NirvanaChunk {
  const removalSet = new Set<string>(AUDITED_ROOT_REMOVALS);
  const rootGeometry = nirvanaRootChunkGeometry();
  const geometry: NirvanaChunkGeometry[] = [{
    ...rootGeometry,
    landmarks: rootGeometry.landmarks.filter(({ id }) => !removalSet.has(id)),
  }];
  for (const coord of NIRVANA_AUTHORED_CHUNK_COORDS) {
    geometry.push(nirvanaAuthoredChunkGeometry(coord));
  }
  const field = createNirvanaGenesisTerrainField(exclusions, geometry, 96, 96);
  return createNirvanaRootChunk(field);
}

describe("Nirvana initial 96x96 region", () => {
  it("preserves the approved source while composing an adapted root plus five unique chunks", () => {
    const approvedSourceBefore = createNirvanaRootChunk();
    const initial = createNirvanaInitialRegion(canonicalMechanicsExclusions());
    const derivedRoot = initial.region.chunks.get("0,0")!;

    expect([...initial.region.chunks.keys()]).toEqual([
      "0,0", "1,0", "0,1", "1,1", "0,2", "1,2",
    ]);
    expect(initial.region.bounds).toEqual({
      minTileColumn: 0,
      minTileRow: 0,
      columns: 96,
      rows: 96,
    });
    expect(new Set([...initial.region.chunks.values()].map(({ contentHash }) => contentHash))).toHaveLength(6);
    expect(new Set(initial.localSemanticDigests.values())).toHaveLength(6);
    expect(derivedRoot.contentHash).not.toBe(approvedSourceBefore.contentHash);
    expect(derivedRoot).not.toEqual(approvedSourceBefore);
    expect(initial.rootAdaptations.length).toBeGreaterThan(0);

    // Adaptation is derived output only: rebuilding the approved source must remain
    // byte-for-byte semantic-identical and keep its pinned content hash.
    expect(createNirvanaRootChunk()).toEqual(approvedSourceBefore);
    expect(createNirvanaRootChunk().contentHash).toBe(approvedSourceBefore.contentHash);
  });

  it("adapts exactly the five audited internal-seam barriers and preserves all retained root semantics", () => {
    const exclusions = canonicalMechanicsExclusions();
    const source = unadaptedFieldRoot(exclusions);
    const initial = createNirvanaInitialRegion(exclusions);
    const derived = initial.region.chunks.get("0,0")!;
    const expectedRemovedIds = AUDITED_ROOT_REMOVALS;

    expect(initial.rootAdaptations.map(({ sourceLandmark }) => sourceLandmark?.id))
      .toEqual(expectedRemovedIds);
    expect(initial.rootAdaptations.every(({ derivedLandmark }) => derivedLandmark === null)).toBe(true);
    expect(derived.landmarks).toEqual(
      source.landmarks.filter(({ id }) => !expectedRemovedIds.includes(id)),
    );
    expect(derived.terrainCells).toEqual(source.terrainCells);
    expect(derived.roadCells).toEqual(source.roadCells);
    expect(derived.roadHub).toEqual(source.roadHub);
    expect(derived.quietClearings).toEqual(source.quietClearings);
    expect(derived.connectors).toEqual(source.connectors);

    const exactConflicts = new Map(initial.rootAdaptations.map(({ sourceLandmark, conflicts }) => [
      sourceLandmark!.id,
      conflicts.map(({ tile }) => `${tile.column},${tile.row}`),
    ]));
    expect(exactConflicts).toEqual(new Map([
      ["woodland-east-lower", ["44,18", "46,18", "44,20", "46,20", "44,21", "44,24"]],
      ["woodland-east-bottom", ["42,25", "44,28", "42,29"]],
      ["woodland-bottom-midwest", ["18,29", "17,30"]],
      ["woodland-bottom-mideast", ["34,29", "33,30"]],
      ["woodland-bottom-east", ["36,28", "40,28", "38,29"]],
    ]));
  });

  it("enumerates and mechanically justifies every derived-root semantic change", () => {
    const exclusions = canonicalMechanicsExclusions();
    const source = unadaptedFieldRoot(exclusions);
    const initial = createNirvanaInitialRegion(exclusions);
    const derived = initial.region.chunks.get("0,0")!;
    const receipts = initial.rootAdaptations;

    expect(new Set(receipts.map(({ id }) => id)).size).toBe(receipts.length);
    for (const receipt of receipts) {
      expect(receipt.reasons.length, receipt.id).toBeGreaterThan(0);
      expect(receipt.reasons.every((reason) => [
        "mechanics-exclusion",
        "internal-east-seam",
        "internal-south-seam",
      ].includes(reason))).toBe(true);
      expect(
        receipt.sourceLandmark !== receipt.derivedLandmark
        || receipt.removedRoadTiles.length > 0
        || receipt.addedRoadTiles.length > 0,
        receipt.id,
      ).toBe(true);
    }

    const changedLandmarkIds = new Set([
      ...source.landmarks
        .filter((landmark) => !derived.landmarks.some((candidate) => candidate.id === landmark.id
          && JSON.stringify(candidate) === JSON.stringify(landmark)))
        .map(({ id }) => id),
      ...derived.landmarks
        .filter((landmark) => !source.landmarks.some((candidate) => candidate.id === landmark.id
          && JSON.stringify(candidate) === JSON.stringify(landmark)))
        .map(({ id }) => id),
    ]);
    const receiptedLandmarkIds = new Set(receipts.map(({ sourceLandmark }) => sourceLandmark.id));
    expect(receiptedLandmarkIds).toEqual(changedLandmarkIds);

    const changedCollisionTiles = changedCellKeys(source.collision, derived.collision);
    const receiptedCollisionTiles = new Set(receipts.flatMap((receipt) => [
      ...receipt.removedCollisionTiles,
      ...receipt.addedCollisionTiles,
    ].map(({ column, row }) => `${column},${row}`)));
    expect(receiptedCollisionTiles).toEqual(changedCollisionTiles);

    const changedRoadTiles = symmetricDifference(
      new Set(source.roadCells.map(({ tile }) => `${tile.column},${tile.row}`)),
      new Set(derived.roadCells.map(({ tile }) => `${tile.column},${tile.row}`)),
    );
    const receiptedRoadTiles = new Set(receipts.flatMap((receipt) => [
      ...receipt.removedRoadTiles,
      ...receipt.addedRoadTiles,
    ].map(({ column, row }) => `${column},${row}`)));
    expect(receiptedRoadTiles).toEqual(changedRoadTiles);
  });

  it("publishes the five exact macro roles without assigning one to the approved root", () => {
    const initial = createNirvanaInitialRegion(canonicalMechanicsExclusions());

    expect([...initial.macroRoles]).toEqual([
      ["1,0", "woodland-meadow-transition"],
      ["0,1", "old-road-social-clearing"],
      ["1,1", "dry-swale-ford-continuation"],
      ["0,2", "settlement-clearing-grove"],
      ["1,2", "open-southern-land"],
    ]);
    expect(initial.macroRoles.has("0,0")).toBe(false);
  });

  it("keeps every occupied internal seam reciprocal", () => {
    const { region } = createNirvanaInitialRegion(canonicalMechanicsExclusions());
    const pairs = [
      ["0,0", "east", "1,0", "west"],
      ["0,0", "south", "0,1", "north"],
      ["1,0", "south", "1,1", "north"],
      ["0,1", "east", "1,1", "west"],
      ["0,1", "south", "0,2", "north"],
      ["1,1", "south", "1,2", "north"],
      ["0,2", "east", "1,2", "west"],
    ] as const;

    for (const [leftKey, leftEdge, rightKey, rightEdge] of pairs) {
      const left = region.chunks.get(leftKey)!;
      const right = region.chunks.get(rightKey)!;
      expect(left.connectors.filter(({ edge }) => edge === leftEdge).map(({ offset }) => offset))
        .toEqual(right.connectors.filter(({ edge }) => edge === rightEdge).map(({ offset }) => offset));
    }
  });

  it("forms one connected walkable component over all six chunks", () => {
    const { region } = createNirvanaInitialRegion(canonicalMechanicsExclusions());
    const collision = compositeCollision(region.chunks);
    // owner-authorised Option A re-baseline, plan §P3: `NirvanaTerrainField` deliberately
    // leaves the region's outer rim OPEN in the mask each chunk publishes — closing it is
    // `NirvanaRegionMapRecipe`'s job, via `closeBoundedOuterEdge` on the composed grid —
    // and connectivity was only ever proved against the rim-CLOSED composition. Apply the
    // same closure here so this test proves the guarantee the field actually makes.
    closeOuterRim(collision, 96, 96);
    const open = collision.reduce((total, value) => total + (value === 0 ? 1 : 0), 0);
    const first = collision.findIndex((value) => value === 0);
    const visited = new Set<number>([first]);
    const queue = [first];
    while (queue.length > 0) {
      const index = queue.shift()!;
      const column = index % 96;
      const row = Math.floor(index / 96);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nextColumn = column + dc;
        const nextRow = row + dr;
        if (nextColumn < 0 || nextColumn >= 96 || nextRow < 0 || nextRow >= 96) continue;
        const next = nextRow * 96 + nextColumn;
        if (collision[next] !== 0 || visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }

    expect(visited.size).toBe(open);
  });

  it("declares only paired outer horizontal and vertical seam candidates", () => {
    const initial = createNirvanaInitialRegion(canonicalMechanicsExclusions());

    expect(initial.wrapSeamCandidates).toEqual([
      {
        axis: "x",
        negativeEdgeTile: { column: 0, row: 14 },
        positiveEdgeTile: { column: 95, row: 14 },
      },
      {
        axis: "y",
        negativeEdgeTile: { column: 84, row: 0 },
        positiveEdgeTile: { column: 84, row: 95 },
      },
    ]);
    for (const seam of initial.wrapSeamCandidates) {
      if (seam.axis === "x") {
        expect(seam.negativeEdgeTile.row).toBe(seam.positiveEdgeTile.row);
      } else {
        expect(seam.negativeEdgeTile.column).toBe(seam.positiveEdgeTile.column);
      }
    }
  });

  it("hashes layout, chunk semantics, seams, and canonicalized exclusions", () => {
    const firstExclusions = canonicalMechanicsExclusions();
    const reordered: NirvanaMechanicsExclusions = {
      hardTiles: [...firstExclusions.hardTiles].reverse(),
      visualRects: [...firstExclusions.visualRects].reverse(),
      shelterPlots: [...firstExclusions.shelterPlots].reverse(),
      stagingPoints: [...firstExclusions.stagingPoints].reverse(),
      anchors: [...firstExclusions.anchors].reverse(),
      gates: [...firstExclusions.gates].reverse(),
    };
    const first = createNirvanaInitialRegion(firstExclusions);
    const second = createNirvanaInitialRegion(reordered);
    const changed = createNirvanaInitialRegion({
      ...firstExclusions,
      hardTiles: [...firstExclusions.hardTiles, "47,47"],
    });

    expect(first.sceneHash).toMatch(/^[0-9a-f]{8}$/);
    expect(second.sceneHash).toBe(first.sceneHash);
    expect(changed.sceneHash).not.toBe(first.sceneHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.wrapSeamCandidates)).toBe(true);
  });
});

function canonicalMechanicsExclusions(): NirvanaMechanicsExclusions {
  const regions = regionFixtures();
  const recipe = createRegionMapRecipe(createRegionMapIdentity(401, regions[0]!, regions));
  const anchors = [
    ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors,
    ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy,
    ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
  ];
  return {
    hardTiles: [
      ...anchors,
      ...recipe.gates.map(({ tile }) => tile),
      ...recipe.shelterPlots.flatMap(({ tile, door }) => [tile, door]),
    ].map(({ column, row }) => `${column},${row}`),
    visualRects: [
      ...recipe.shelterPlots.map(({ tile }) => shelterRenderRect(tile)),
      ...recipe.stagingPoints.map(feetAnchoredVisualRect),
    ],
    shelterPlots: recipe.shelterPlots,
    stagingPoints: recipe.stagingPoints,
    anchors,
    gates: recipe.gates,
  };
}

function changedCellKeys(
  source: readonly (0 | 1)[],
  derived: readonly (0 | 1)[],
): Set<string> {
  const changed = new Set<string>();
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === derived[index]) continue;
    changed.add(`${index % 48},${Math.floor(index / 48)}`);
  }
  return changed;
}

function symmetricDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([
    ...[...left].filter((value) => !right.has(value)),
    ...[...right].filter((value) => !left.has(value)),
  ]);
}

function regionFixtures(): RegionSnapshot[] {
  const region = (
    name: string,
    description: string,
    connections: string[],
  ): RegionSnapshot => ({
    name,
    description,
    connections,
    energy_rate: 2,
    materials_rate: 2,
    current_energy: 20,
    current_materials: 20,
    max_energy: 40,
    max_materials: 40,
  });
  return [
    region("nirvana", "Once heavenly, now picked over and thinning.", ["warm_springs", "nirvana_east", "nirvana_west"]),
    region("warm_springs", "A hot spring lake.", ["nirvana"]),
    region("nirvana_east", "A struggling near barren plain.", ["nirvana"]),
    region("nirvana_west", "A nuclear wasteland all but dead.", ["nirvana"]),
  ];
}

function compositeCollision(
  chunks: ReadonlyMap<string, Readonly<{ coord: { column: number; row: number }; collision: readonly (0 | 1)[] }>>,
): Uint8Array {
  const collision = new Uint8Array(96 * 96);
  for (const chunk of chunks.values()) {
    for (let row = 0; row < 32; row += 1) {
      for (let column = 0; column < 48; column += 1) {
        const worldColumn = chunk.coord.column * 48 + column;
        const worldRow = chunk.coord.row * 32 + row;
        collision[worldRow * 96 + worldColumn] = chunk.collision[row * 48 + column]!;
      }
    }
  }
  return collision;
}

/** Mirrors `NirvanaRegionMapRecipe`'s private `closeBoundedOuterEdge`. */
function closeOuterRim(collision: Uint8Array, columns: number, rows: number): void {
  for (let column = 0; column < columns; column += 1) {
    collision[column] = 1;
    collision[(rows - 1) * columns + column] = 1;
  }
  for (let row = 0; row < rows; row += 1) {
    collision[row * columns] = 1;
    collision[row * columns + columns - 1] = 1;
  }
}
