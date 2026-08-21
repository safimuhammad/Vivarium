import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../map/regionMap";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  feetAnchoredVisualRect,
  productionRectsOverlap,
  shelterRenderRect,
} from "../productionGeometry";
import { channelFrameIdFor } from "./NirvanaAtlas";
import { planNirvanaGrowth } from "./NirvanaGrowthPolicy";
import { createNirvanaRegionMapRecipe } from "./NirvanaRegionMapRecipe";
import {
  createNirvanaProceduralSeamContract,
  generateNirvanaProceduralChunk,
  type NirvanaProceduralChunkResult,
} from "./NirvanaProceduralChunk";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  type NirvanaChunkConnector,
  type NirvanaTileCoordinate,
} from "./NirvanaRegionV2";

function generatedResult(
  overrides: Partial<Parameters<typeof generateNirvanaProceduralChunk>[0]> = {},
): NirvanaProceduralChunkResult {
  const coord = overrides.coord ?? { column: 0, row: 3 };
  const runSeed = overrides.runSeed ?? 401;
  const seamContract = overrides.seamContract
    ?? createNirvanaProceduralSeamContract({
      runSeed,
      coord,
      edges: [
        { edge: "north", source: "authored-reciprocal", reciprocalOffsets: [25] },
        { edge: "east", source: "generated-shared" },
        { edge: "south", source: "generated-shared" },
        { edge: "west", source: "generated-shared" },
      ],
    });
  return generateNirvanaProceduralChunk({
    runSeed,
    coord,
    districtIndex: overrides.districtIndex ?? 8,
    seamContract,
  });
}

describe("NirvanaProceduralChunk", () => {
  it("copies authored reciprocal offsets and derives identical generated offsets on both seam sides", () => {
    const authored = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord: { column: 0, row: 3 },
      edges: [
        { edge: "north", source: "authored-reciprocal", reciprocalOffsets: [25, 8] },
      ],
    });
    const east = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord: { column: 0, row: 3 },
      edges: [{ edge: "east", source: "generated-shared" }],
    });
    const west = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord: { column: 1, row: 3 },
      edges: [{ edge: "west", source: "generated-shared" }],
    });

    expect(authored.connectors).toEqual([
      { edge: "north", offset: 8 },
      { edge: "north", offset: 25 },
    ]);
    expect(offsets(east.connectors, "east")).toEqual(offsets(west.connectors, "west"));
    expect(east.agreements[0]!.seamKey).toBe(west.agreements[0]!.seamKey);
    expect(east.generatorVersion).toBe(1);
    expect(Object.isFrozen(authored)).toBe(true);
    expect(Object.isFrozen(authored.agreements)).toBe(true);
    expect(Object.isFrozen(authored.connectors)).toBe(true);
  });

  it("is deterministic and varies semantic output by seed and coordinate", () => {
    const first = generatedResult();
    const repeated = generatedResult();
    const changedSeed = generatedResult({ runSeed: 402 });
    const changedCoord = generatedResult({
      coord: { column: 1, row: 3 },
      districtIndex: 9,
    });

    expect(repeated).toEqual(first);
    expect(repeated.chunk.contentHash).toBe(first.chunk.contentHash);
    expect(changedSeed.chunk.contentHash).not.toBe(first.chunk.contentHash);
    expect(changedCoord.chunk.contentHash).not.toBe(first.chunk.contentHash);
    expect(first.chunk.landmarks.every(({ id }) =>
      id.startsWith("nirvana:seed-401:generator-v1:chunk-0,3:"))).toBe(true);
    expect(changedSeed.chunk.landmarks.every(({ id }) =>
      id.startsWith("nirvana:seed-402:generator-v1:chunk-0,3:"))).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.district)).toBe(true);
    expect(Object.isFrozen(first.district.shelterPlots)).toBe(true);
  });

  it("keeps an old chunk byte-for-byte stable when the expansion receipt advances tiers", () => {
    const recipe = baseRecipe();
    const firstExpansion = planNirvanaGrowth(recipe, {
      populationHighWater: 225,
      builtFootprintHighWater: 0,
    });
    const secondExpansion = planNirvanaGrowth(
      recipe,
      { populationHighWater: 289, builtFootprintHighWater: 0 },
      firstExpansion,
    );
    const oldCoord = firstExpansion.addedChunkCoords[0]!;
    expect(firstExpansion.growthVersion).toBe(2);
    expect(secondExpansion.growthVersion).toBe(6);
    expect(secondExpansion.addedChunkCoords).toContainEqual(oldCoord);

    const atBirthTier = generatedResult({ coord: oldCoord, districtIndex: 8 });
    const afterLaterTier = generatedResult({ coord: oldCoord, districtIndex: 8 });

    expect(JSON.stringify(afterLaterTier.chunk)).toBe(JSON.stringify(atBirthTier.chunk));
    expect(JSON.stringify(afterLaterTier.district)).toBe(JSON.stringify(atBirthTier.district));
    expect(afterLaterTier.generationHash).toBe(atBirthTier.generationHash);
  });

  it("keeps semantic IDs and hashes independent of the district birth ordinal", () => {
    const eighth = generatedResult({ districtIndex: 8 });
    const laterAssignment = generatedResult({ districtIndex: 99 });

    expect(JSON.stringify(laterAssignment.chunk)).toBe(JSON.stringify(eighth.chunk));
    expect(laterAssignment.district.index).toBe(99);
    expect(laterAssignment.district.shelterPlots.map(({ id }) => id))
      .toEqual(eighth.district.shelterPlots.map(({ id }) => id));
    expect(laterAssignment.generationHash).toBe(eighth.generationHash);
  });

  it("keeps a shared seam reciprocal when its neighbors are born in different tiers", () => {
    const recipe = baseRecipe();
    const firstExpansion = planNirvanaGrowth(recipe, {
      populationHighWater: 225,
      builtFootprintHighWater: 0,
    });
    const secondExpansion = planNirvanaGrowth(
      recipe,
      { populationHighWater: 289, builtFootprintHighWater: 0 },
      firstExpansion,
    );
    const olderCoord = { column: 1, row: 3 };
    const laterCoord = { column: 2, row: 3 };
    expect(firstExpansion.addedChunkCoords).toContainEqual(olderCoord);
    expect(firstExpansion.addedChunkCoords).not.toContainEqual(laterCoord);
    expect(secondExpansion.addedChunkCoords).toContainEqual(laterCoord);

    const olderEast = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord: olderCoord,
      edges: [{ edge: "east", source: "generated-shared" }],
    });
    const laterWest = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord: laterCoord,
      edges: [{ edge: "west", source: "generated-shared" }],
    });

    expect(olderEast.agreements[0]!.seamKey).toBe(laterWest.agreements[0]!.seamKey);
    expect(offsets(olderEast.connectors, "east"))
      .toEqual(offsets(laterWest.connectors, "west"));
  });

  it("publishes one stable 32-person and 16-shelter district without duplicate IDs", () => {
    const first = generatedResult();
    const repeated = generatedResult();
    const neighbor = generatedResult({
      coord: { column: 1, row: 3 },
      districtIndex: 9,
    });

    expect(first.district.index).toBe(8);
    expect(first.district.stagingPoints).toHaveLength(32);
    expect(first.district.stagingAnchors).toHaveLength(32);
    expect(first.district.shelterPlots).toHaveLength(16);
    expect(new Set(first.district.shelterPlots.map(({ id }) => id)).size).toBe(16);
    expect(first.district.shelterPlots.map(({ id }) => id)).toEqual(
      repeated.district.shelterPlots.map(({ id }) => id),
    );
    expect(first.district.shelterPlots[0]!.id)
      .toBe("nirvana:seed-401:generator-v1:chunk-0,3:plot-0");
    const worldIds = [first, neighbor].flatMap(({ chunk, district }) => [
      ...chunk.landmarks.map(({ id }) => id),
      ...chunk.landmarks.flatMap(({ visuals }) => visuals.map(({ id }) => id)),
      ...district.shelterPlots.map(({ id }) => id),
    ]);
    expect(new Set(worldIds).size).toBe(worldIds.length);
    expect(first.chunk.landmarks.every(({ id }) =>
      id.startsWith("nirvana:seed-401:generator-v1:chunk-0,3:"))).toBe(true);
    expect(neighbor.chunk.landmarks.every(({ id }) =>
      id.startsWith("nirvana:seed-401:generator-v1:chunk-1,3:"))).toBe(true);
  });

  it("keeps at least sixty percent collision-open and groups scenery into two to five macro landmarks", () => {
    for (const runSeed of [1, 2, 3, 401, 99_999]) {
      const { chunk } = generatedResult({ runSeed });
      const open = chunk.collision.filter((value) => value === 0).length;
      expect(open / chunk.collision.length).toBeGreaterThanOrEqual(0.6);
      expect(chunk.landmarks.length).toBeGreaterThanOrEqual(2);
      expect(chunk.landmarks.length).toBeLessThanOrEqual(5);
      for (const landmark of chunk.landmarks) {
        expect(landmark.bounds.columns * landmark.bounds.rows).toBeGreaterThanOrEqual(16);
        expect(landmark.visuals).toHaveLength(1);
      }
    }
  });

  it("path-connects every connector, hub, staging point, shelter plot, and door", () => {
    const { chunk, district } = generatedResult();
    const required = [
      ...chunk.connectors.map(connectorTile),
      chunk.roadHub,
      ...district.stagingAnchors.map((tile) => localTile(tile, chunk.coord)),
      ...district.shelterPlots.flatMap(({ tile, door }) => [
        localTile(tile, chunk.coord),
        localTile(door, chunk.coord),
      ]),
    ];

    for (const tile of required) {
      expect(chunk.collision[tile.row * NIRVANA_CHUNK_COLUMNS + tile.column], key(tile)).toBe(0);
      expect(reachable(chunk.collision, chunk.roadHub, tile), key(tile)).toBe(true);
    }
  });

  it("keeps roads and complete actor/shelter visual envelopes clear of landmark collision", () => {
    const { chunk, district } = generatedResult();
    const origin = {
      column: chunk.coord.column * NIRVANA_CHUNK_COLUMNS,
      row: chunk.coord.row * NIRVANA_CHUNK_ROWS,
    };
    const protectedRects = [
      ...chunk.roadCells.map(({ tile }) => ({
        x: tile.column * TILE_SIZE,
        y: tile.row * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      })),
      ...district.stagingPoints.map((point) => feetAnchoredVisualRect({
        x: point.x - origin.column * TILE_SIZE,
        y: point.y - origin.row * TILE_SIZE,
      })),
      ...district.shelterPlots.map(({ tile }) => shelterRenderRect({
        column: tile.column - origin.column,
        row: tile.row - origin.row,
      })),
    ];

    for (const landmark of chunk.landmarks) {
      for (const collisionTile of landmark.collisionTiles) {
        const collisionRect = {
          x: collisionTile.column * TILE_SIZE,
          y: collisionTile.row * TILE_SIZE,
          width: TILE_SIZE,
          height: TILE_SIZE,
        };
        expect(
          protectedRects.some((rect) => productionRectsOverlap(rect, collisionRect)),
          `${landmark.id}:${key(collisionTile)}`,
        ).toBe(false);
      }
    }
  });

  it("uses only the approved dry Nirvana terrain vocabulary and marks road crossings as fords", () => {
    for (const runSeed of Array.from({ length: 24 }, (_, index) => index + 1)) {
      const { chunk } = generatedResult({ runSeed });
      expect(new Set(chunk.terrainCells.map(({ kind }) => kind))).not.toContain("water");
      const swale = chunk.terrainCells.filter(({ kind }) => kind === "dry-swale");
      if (swale.length === 0) continue;
      expect(chunk.terrainCells.some(({ kind }) => kind === "ford")).toBe(true);
      for (const road of chunk.roadCells.filter(({ surface }) => surface === "ford")) {
        expect(chunk.terrainCells.find(({ tile }) => key(tile) === key(road.tile))?.kind).toBe("ford");
      }
    }
  });

  it("produces a swale connection mask the production atlas can paint at every grown chunk edge", () => {
    // Regression for a real production bug: growth-generated chunks that roll a
    // dry-swale column used to compute a "dead end" connection mask (a lone
    // "north" or "south") at the chunk's own top/bottom row, because this
    // generator's swale connections only counted real in-chunk neighbors and
    // omitted the boundary-continuation rule the root chunk and the authored
    // dry-swale-ford-continuation chunk both apply. The atlas never authored a
    // swale dead-end frame (SWALE_FRAMES only has straights and corners), so the
    // real Nirvana painter (`channelFrameIdFor` via `NirvanaPainter` — the frame for a
    // dry-swale/ford cell now resolves there; the base-fill lookup `terrainFrameIdFor`
    // never even looks at channel kind) threw "Unsupported Nirvana swale connection
    // mask" the moment Nirvana grew a chunk that rolled a swale — every single time,
    // deterministically.
    let sawSwale = false;
    for (const runSeed of Array.from({ length: 60 }, (_, index) => index + 1)) {
      const { chunk } = generatedResult({ runSeed });
      const swale = chunk.terrainCells.filter(({ kind }) => kind === "dry-swale");
      if (swale.length === 0) continue;
      sawSwale = true;
      for (const cell of chunk.terrainCells) {
        if (cell.kind !== "dry-swale" && cell.kind !== "ford") continue;
        expect(
          () => channelFrameIdFor(cell),
          `seed ${runSeed} tile ${key(cell.tile)} kind ${cell.kind} connections ${JSON.stringify(cell.connections)}`,
        ).not.toThrow();
      }
      // The swale column always runs the full chunk height, so every dry-swale
      // row (the road/ford crossing aside) must resolve to the continuous
      // straight frame, never an isolated or dead-end frame.
      for (const cell of swale) {
        expect(channelFrameIdFor(cell)).toBe("terrain.swale.straight.ns");
      }
    }
    expect(sawSwale).toBe(true);
  });

  it("rejects mismatched, malformed, and caller-mutated seam contracts", () => {
    const coord = { column: 0, row: 3 };
    const contract = createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord,
      edges: [{ edge: "north", source: "authored-reciprocal", reciprocalOffsets: [25] }],
    });

    expect(() => generateNirvanaProceduralChunk({
      runSeed: 402,
      coord,
      districtIndex: 8,
      seamContract: contract,
    })).toThrow(/seam contract.*seed/i);
    expect(() => createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord,
      edges: [{ edge: "north", source: "authored-reciprocal", reciprocalOffsets: [48] }],
    })).toThrow(/offset/i);
    expect(() => createNirvanaProceduralSeamContract({
      runSeed: 401,
      coord,
      edges: [
        { edge: "east", source: "generated-shared" },
        { edge: "east", source: "generated-shared" },
      ],
    })).toThrow(/duplicate.*edge/i);
    expect(() => generateNirvanaProceduralChunk({
      runSeed: 401,
      coord,
      districtIndex: 8,
      seamContract: {
        ...contract,
        generatorVersion: 2 as 1,
      },
    })).toThrow(/generator version/i);
  });
});

const regions: readonly RegionSnapshot[] = [
  {
    name: "nirvana",
    description: "a once-heavenly landscape, now thinning and picked-over",
    connections: ["warm_springs"],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  },
  {
    name: "warm_springs",
    description: "hot spring lakes",
    connections: ["nirvana"],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  },
];

function baseRecipe() {
  return createNirvanaRegionMapRecipe(
    createRegionMapIdentity(401, regions[0]!, regions),
  );
}

function offsets(
  connectors: readonly NirvanaChunkConnector[],
  edge: NirvanaChunkConnector["edge"],
): readonly number[] {
  return connectors.filter((connector) => connector.edge === edge).map(({ offset }) => offset);
}

function connectorTile(connector: NirvanaChunkConnector): NirvanaTileCoordinate {
  switch (connector.edge) {
    case "north": return { column: connector.offset, row: 0 };
    case "east": return { column: NIRVANA_CHUNK_COLUMNS - 1, row: connector.offset };
    case "south": return { column: connector.offset, row: NIRVANA_CHUNK_ROWS - 1 };
    case "west": return { column: 0, row: connector.offset };
  }
}

function localTile(
  tile: TileCoord,
  coord: Readonly<{ column: number; row: number }>,
): NirvanaTileCoordinate {
  return {
    column: tile.column - coord.column * NIRVANA_CHUNK_COLUMNS,
    row: tile.row - coord.row * NIRVANA_CHUNK_ROWS,
  };
}

function reachable(
  collision: readonly (0 | 1)[],
  start: NirvanaTileCoordinate,
  goal: NirvanaTileCoordinate,
): boolean {
  const frontier = [start];
  const visited = new Set([key(start)]);
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    if (key(current) === key(goal)) return true;
    for (const next of [
      { column: current.column - 1, row: current.row },
      { column: current.column + 1, row: current.row },
      { column: current.column, row: current.row - 1 },
      { column: current.column, row: current.row + 1 },
    ]) {
      if (
        next.column < 0
        || next.column >= NIRVANA_CHUNK_COLUMNS
        || next.row < 0
        || next.row >= NIRVANA_CHUNK_ROWS
        || collision[next.row * NIRVANA_CHUNK_COLUMNS + next.column] === 1
        || visited.has(key(next))
      ) continue;
      visited.add(key(next));
      frontier.push(next);
    }
  }
  return false;
}

function key(tile: Readonly<{ column: number; row: number }>): string {
  return `${tile.column},${tile.row}`;
}
