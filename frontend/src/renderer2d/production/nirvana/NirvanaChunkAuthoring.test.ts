import { describe, expect, it, vi } from "vitest";

import {
  NIRVANA_AUTHORED_CHUNK_COORDS,
  createNirvanaAuthoredChunk,
  nirvanaChunkLocalSemanticDigest,
  type NirvanaChunkMacroRole,
} from "./NirvanaChunkAuthoring";
import type { NirvanaMechanicsExclusions } from "./NirvanaInitialRegion";
import { createNirvanaChunk } from "./NirvanaRegionV2";

const EXPECTED_ROLES = new Map<string, NirvanaChunkMacroRole>([
  ["1,0", "woodland-meadow-transition"],
  ["0,1", "old-road-social-clearing"],
  ["1,1", "dry-swale-ford-continuation"],
  ["0,2", "settlement-clearing-grove"],
  ["1,2", "open-southern-land"],
]);

describe("Nirvana semantic chunk authoring", () => {
  it("authors the five locked macro roles as unique deterministic chunks", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("runtime randomness is forbidden");
    });
    try {
      const first = NIRVANA_AUTHORED_CHUNK_COORDS.map((coord) =>
        createNirvanaAuthoredChunk(coord, emptyExclusions()));
      const second = NIRVANA_AUTHORED_CHUNK_COORDS.map((coord) =>
        createNirvanaAuthoredChunk(coord, emptyExclusions()));

      expect(first.map(({ chunk }) => `${chunk.coord.column},${chunk.coord.row}`))
        .toEqual(["1,0", "0,1", "1,1", "0,2", "1,2"]);
      expect(first.map(({ role }) => role)).toEqual(
        first.map(({ chunk }) => EXPECTED_ROLES.get(`${chunk.coord.column},${chunk.coord.row}`)),
      );
      expect(new Set(first.map(({ chunk }) => chunk.contentHash))).toHaveLength(5);
      expect(new Set(first.map(({ semanticDigest }) => semanticDigest))).toHaveLength(5);
      expect(first.map(({ chunk }) => chunk.contentHash))
        .toEqual(second.map(({ chunk }) => chunk.contentHash));
      expect(first.map(({ semanticDigest }) => semanticDigest))
        .toEqual(second.map(({ semanticDigest }) => semanticDigest));
      expect(first.every(({ chunk }) => chunk.terrainCells.length === 48 * 32)).toBe(true);
    } finally {
      random.mockRestore();
    }
  });

  it("lays macro structure before seeded texture detail", () => {
    const authored = NIRVANA_AUTHORED_CHUNK_COORDS.map((coord) =>
      createNirvanaAuthoredChunk(coord, emptyExclusions()));
    const byRole = new Map(authored.map((entry) => [entry.role, entry.chunk]));

    expect(byRole.get("woodland-meadow-transition")?.landmarks.length).toBeGreaterThanOrEqual(3);
    expect(byRole.get("woodland-meadow-transition")?.quietClearings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "social-meadow" })]));
    expect(byRole.get("old-road-social-clearing")?.roadCells.length).toBeGreaterThan(40);
    expect(byRole.get("old-road-social-clearing")?.quietClearings)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: "social-meadow" })]));
    expect(byRole.get("dry-swale-ford-continuation")?.terrainCells)
      .toEqual(expect.arrayContaining([expect.objectContaining({ kind: "ford" })]));
    expect(byRole.get("settlement-clearing-grove")?.landmarks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ feature: "ruined-garden" })]));
    expect(byRole.get("open-southern-land")?.quietClearings)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "southern-growth", bounds: expect.objectContaining({ columns: 20 }) }),
      ]));

    const terrainFingerprints = authored.map(({ chunk }) =>
      chunk.terrainCells.slice(0, 128).map(({ kind, variant }) => `${kind}:${variant}`).join("|"));
    expect(new Set(terrainFingerprints).size).toBeGreaterThan(1);
  });

  it("normalizes the local semantic digest independently of chunk coordinates", () => {
    const original = createNirvanaAuthoredChunk(
      NIRVANA_AUTHORED_CHUNK_COORDS[0]!,
      emptyExclusions(),
    ).chunk;
    const relocated = createNirvanaChunk({
      ...original,
      coord: { column: 7, row: -3 },
      contentHash: undefined,
    });

    expect(relocated.contentHash).not.toBe(original.contentHash);
    expect(nirvanaChunkLocalSemanticDigest(relocated))
      .toBe(nirvanaChunkLocalSemanticDigest(original));
  });

  it("puts an open road cell on every declared connector", () => {
    for (const coord of NIRVANA_AUTHORED_CHUNK_COORDS) {
      const { chunk } = createNirvanaAuthoredChunk(coord, emptyExclusions());
      for (const connector of chunk.connectors) {
        const tile = connector.edge === "north"
          ? { column: connector.offset, row: 0 }
          : connector.edge === "south"
            ? { column: connector.offset, row: 31 }
            : connector.edge === "west"
              ? { column: 0, row: connector.offset }
              : { column: 47, row: connector.offset };
        expect(chunk.collision[tile.row * 48 + tile.column], `${coord.column},${coord.row}:${connector.edge}`)
          .toBe(0);
        expect(chunk.roadCells.some(({ tile: road }) =>
          road.column === tile.column && road.row === tile.row)).toBe(true);
      }
    }
  });

  it("publishes two-ended canonical swale semantics at chunk boundaries", () => {
    const { chunk } = createNirvanaAuthoredChunk(
      { column: 1, row: 1 },
      emptyExclusions(),
    );
    const north = chunk.terrainCells.find(({ tile }) => tile.column === 30 && tile.row === 0)!;
    const south = chunk.terrainCells.find(({ tile }) => tile.column === 30 && tile.row === 31)!;

    expect(north).toMatchObject({ kind: "dry-swale", connections: ["north", "south"] });
    expect(south).toMatchObject({ kind: "dry-swale", connections: ["north", "south"] });
  });

  it("keeps every road ford a pure east-west crossing instead of a mixed-axis junction", () => {
    const { chunk } = createNirvanaAuthoredChunk(
      { column: 1, row: 1 },
      emptyExclusions(),
    );
    const fords = chunk.roadCells.filter(({ surface }) => surface === "ford");

    expect(fords.length).toBeGreaterThan(0);
    expect(fords).toEqual(expect.arrayContaining([
      expect.objectContaining({ tile: { column: 30, row: 16 } }),
    ]));
    expect(fords.every(({ connections }) =>
      connections.length === 2
      && connections[0] === "east"
      && connections[1] === "west")).toBe(true);
    // owner-authorised Option A re-baseline, plan §P3: this chunk is built in isolation
    // (no terrain field, empty mechanics exclusions), so its terrain is the field-free
    // placeholder pass — these digests were re-measured directly from that exact call,
    // not copied from the genesis-recipe digest table, which builds chunk (1,1) with a
    // real field and real exclusions and therefore hashes differently.
    expect({
      contentHash: chunk.contentHash,
      semanticDigest: nirvanaChunkLocalSemanticDigest(chunk),
    }).toEqual({
      contentHash: "2bc2cad9",
      semanticDigest: "47255a8e",
    });
  });

  it("rejects authored landmark geometry that overlaps any mechanics obligation", () => {
    const coord = { column: 1, row: 0 } as const;
    const baseline = createNirvanaAuthoredChunk(coord, emptyExclusions()).chunk;
    const landmark = baseline.landmarks.find(({ collisionTiles }) => collisionTiles.length > 0)!;
    const local = landmark.collisionTiles[0]!;
    const global = { column: 48 + local.column, row: local.row };
    const point = { x: global.column * 32 + 16, y: global.row * 32 + 16 };
    const plot = { id: "blocked-plot", tile: global, door: global };
    const gate = {
      edge: { from: "nirvana", to: "warm_springs" },
      role: "departure" as const,
      tile: global,
      facing: "east" as const,
    };
    const cases: readonly [string, NirvanaMechanicsExclusions][] = [
      ["hard tile", { ...emptyExclusions(), hardTiles: [`${global.column},${global.row}`] }],
      ["visual rectangle", {
        ...emptyExclusions(),
        visualRects: [{ x: global.column * 32, y: global.row * 32, width: 32, height: 32 }],
      }],
      ["shelter plot", { ...emptyExclusions(), shelterPlots: [plot] }],
      ["staging point", { ...emptyExclusions(), stagingPoints: [point] }],
      ["anchor", { ...emptyExclusions(), anchors: [global] }],
      ["directed gate", { ...emptyExclusions(), gates: [gate] }],
    ];

    for (const [label, exclusions] of cases) {
      expect(() => createNirvanaAuthoredChunk(coord, exclusions), label)
        .toThrow(/mechanics exclusion/i);
    }
  });
});

function emptyExclusions(): NirvanaMechanicsExclusions {
  return {
    hardTiles: [],
    visualRects: [],
    shelterPlots: [],
    stagingPoints: [],
    anchors: [],
    gates: [],
  };
}
