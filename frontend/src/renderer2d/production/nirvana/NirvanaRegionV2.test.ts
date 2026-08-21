import { describe, expect, it } from "vitest";

import {
  appendNirvanaChunk,
  createNirvanaChunk,
  createNirvanaRegion,
  nirvanaChunkKey,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaChunkCoord,
  type NirvanaChunkInput,
} from "./NirvanaRegionV2";

const CHUNK_COLUMNS = 48;
const CHUNK_ROWS = 32;

describe("NirvanaRegionV2", () => {
  it("keys signed safe chunk coordinates canonically", () => {
    expect(nirvanaChunkKey({ column: 0, row: 0 })).toBe("0,0");
    expect(nirvanaChunkKey({ column: -12, row: 7 })).toBe("-12,7");
    expect(() => nirvanaChunkKey({ column: 0.5, row: 0 })).toThrow(/safe integer/i);
    expect(() => nirvanaChunkKey({ column: Number.MAX_SAFE_INTEGER + 1, row: 0 }))
      .toThrow(/safe integer/i);
  });

  it("owns and freezes canonical chunk content with a deterministic semantic hash", () => {
    const input = chunkInput(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 14 }],
    );
    const first = createNirvanaChunk(input);
    const second = createNirvanaChunk(chunkInput(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 14 }],
    ));

    expect(first.contentHash).toMatch(/^[0-9a-f]{8}$/);
    expect(second.contentHash).toBe(first.contentHash);
    expect(createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }, [{ edge: "east", offset: 14 }]),
      terrainCells: terrainCells("meadow"),
    }).contentHash).not.toBe(first.contentHash);

    (input.coord as { column: number }).column = 9;
    (input.terrainCells[0]!.tile as { column: number }).column = 9;
    (input.collision as (0 | 1)[])[0] = 1;
    (input.connectors as NirvanaChunkConnector[])[0] = { edge: "west", offset: 3 };

    expect(first.coord).toEqual({ column: 0, row: 0 });
    expect(first.terrainCells[0]!.tile).toEqual({ column: 0, row: 0 });
    expect(first.collision[0]).toBe(0);
    expect(first.connectors).toEqual([{ edge: "east", offset: 14 }]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.terrainCells)).toBe(true);
    expect(Object.isFrozen(first.terrainCells[0]!.tile)).toBe(true);
    expect(Object.isFrozen(first.collision)).toBe(true);
  });

  it("rejects invalid dimensions, collision bytes, local tiles, connectors, and hashes", () => {
    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      columns: 47 as 48,
    })).toThrow(/48x32/i);
    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      collision: [0],
    })).toThrow(/collision.*1536/i);
    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      collision: Array.from(
        { length: CHUNK_COLUMNS * CHUNK_ROWS },
        (_, index) => (index === 0 ? 2 : 0),
      ) as (0 | 1)[],
    })).toThrow(/collision/i);
    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      roadCells: [{ tile: { column: 48, row: 0 }, connections: [], surface: "dirt" }],
    })).toThrow(/road.*bounds/i);
    expect(() => createNirvanaChunk(chunkInput(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 32 }],
    ))).toThrow(/connector.*offset/i);
    expect(() => createNirvanaChunk(chunkInput(
      { column: 0, row: 0 },
      [{ edge: "north", offset: 48 }],
    ))).toThrow(/connector.*offset/i);
    expect(() => createNirvanaChunk(chunkInput(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 14 }, { edge: "east", offset: 14 }],
    ))).toThrow(/duplicate connector/i);

    const valid = chunk({ column: 0, row: 0 });
    expect(() => createNirvanaRegion({ ...valid, contentHash: "00000000" }))
      .toThrow(/content hash/i);
  });

  it("rejects sparse collision arrays even when their length is exactly 1536", () => {
    const sparseCollision = new Array<0 | 1>(CHUNK_COLUMNS * CHUNK_ROWS);

    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      collision: sparseCollision,
    })).toThrow(/collision.*index 0/i);
  });

  it("requires collision storage to be an actual array", () => {
    const typedCollision = new Uint8Array(CHUNK_COLUMNS * CHUNK_ROWS);

    expect(() => createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      collision: typedCollision as unknown as readonly (0 | 1)[],
    })).toThrow(/collision.*array/i);
  });

  it("owns and validates each collision slot from the same single read", () => {
    const collision = Array.from(
      { length: CHUNK_COLUMNS * CHUNK_ROWS },
      () => 0 as 0 | 1,
    );
    let firstSlotReads = 0;
    Object.defineProperty(collision, 0, {
      configurable: true,
      enumerable: true,
      get(): 0 | 2 {
        firstSlotReads += 1;
        return firstSlotReads === 1 ? 0 : 2;
      },
    });

    const owned = createNirvanaChunk({
      ...chunkInput({ column: 0, row: 0 }),
      collision,
    });

    expect(firstSlotReads).toBe(1);
    expect(owned.collision[0]).toBe(0);
  });

  it("requires the first chunk at root and derives signed world bounds", () => {
    expect(() => createNirvanaRegion(chunk({ column: 1, row: 0 }))).toThrow(/root.*0,0/i);

    const root = chunk(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 14 }, { edge: "north", offset: 7 }],
    );
    const region = createNirvanaRegion(root);
    const ownedRoot = region.chunks.get("0,0");
    const east = chunk({ column: 1, row: 0 }, [{ edge: "west", offset: 14 }]);
    const north = chunk({ column: 0, row: -1 }, [{ edge: "south", offset: 7 }]);

    const expandedEast = appendNirvanaChunk(region, east);
    const expanded = appendNirvanaChunk(expandedEast, north);

    expect(expandedEast.bounds).toEqual({
      minTileColumn: 0,
      minTileRow: 0,
      columns: 96,
      rows: 32,
    });
    expect(expanded.bounds).toEqual({
      minTileColumn: 0,
      minTileRow: -32,
      columns: 96,
      rows: 64,
    });
    expect(expanded.chunks.get("0,0")).toBe(ownedRoot);
    expect(expanded.chunks.get("0,0")?.contentHash).toBe(root.contentHash);
    expect(region.chunks.has("1,0")).toBe(false);
  });

  it("rejects duplicate coordinates and incompatible occupied seams without mutating the prior region", () => {
    const root = chunk({ column: 0, row: 0 }, [{ edge: "east", offset: 14 }]);
    const region = createNirvanaRegion(root);
    const before = [...region.chunks];

    expect(() => appendNirvanaChunk(region, root)).toThrow(/duplicate.*0,0/i);
    expect(() => appendNirvanaChunk(
      region,
      chunk({ column: 1, row: 0 }, [{ edge: "west", offset: 15 }]),
    )).toThrow(/reciprocal connector/i);
    expect(() => appendNirvanaChunk(region, chunk({ column: 1, row: 0 })))
      .toThrow(/reciprocal connector/i);

    expect([...region.chunks]).toEqual(before);
    expect(region.bounds).toEqual({
      minTileColumn: 0,
      minTileRow: 0,
      columns: 48,
      rows: 32,
    });
  });

  it("rejects non-adjacent append coordinates without mutating the prior region", () => {
    const region = createNirvanaRegion(chunk({ column: 0, row: 0 }));
    const beforeRoot = region.chunks.get("0,0");

    expect(() => appendNirvanaChunk(region, chunk({ column: 2, row: 0 })))
      .toThrow(/cardinally adjacent/i);
    expect([...region.chunks.keys()]).toEqual(["0,0"]);
    expect(region.chunks.get("0,0")).toBe(beforeRoot);
    expect(region.bounds).toEqual({
      minTileColumn: 0,
      minTileRow: 0,
      columns: 48,
      rows: 32,
    });
  });

  it("exposes a frozen chunks map facade with no runtime mutators", () => {
    const chunks = createNirvanaRegion(chunk({ column: 0, row: 0 })).chunks;

    expect(Object.isFrozen(chunks)).toBe(true);
    for (const mutator of ["set", "delete", "clear"] as const) {
      expect(mutator in chunks, `${mutator} must be absent`).toBe(false);
      expect(Reflect.get(chunks, mutator), `${mutator} must be unavailable`).toBeUndefined();
    }
    expect(Reflect.set(chunks, "set", () => undefined)).toBe(false);
    expect("set" in chunks).toBe(false);
  });

  it("permits unmatched outer connectors and accepts exactly reciprocal occupied seams", () => {
    const root = chunk({ column: 0, row: 0 }, [
      { edge: "west", offset: 12 },
      { edge: "east", offset: 14 },
    ]);
    const region = createNirvanaRegion(root);
    const expanded = appendNirvanaChunk(
      region,
      chunk({ column: 1, row: 0 }, [
        { edge: "west", offset: 14 },
        { edge: "east", offset: 2 },
      ]),
    );

    expect(expanded.chunks.get("1,0")?.connectors).toEqual([
      { edge: "west", offset: 14 },
      { edge: "east", offset: 2 },
    ]);
  });
});

function chunk(
  coord: NirvanaChunkCoord,
  connectors: readonly NirvanaChunkConnector[] = [],
): NirvanaChunk {
  return createNirvanaChunk(chunkInput(coord, connectors));
}

function chunkInput(
  coord: NirvanaChunkCoord,
  connectors: readonly NirvanaChunkConnector[] = [],
): NirvanaChunkInput {
  return {
    coord: { ...coord },
    columns: CHUNK_COLUMNS,
    rows: CHUNK_ROWS,
    terrainCells: terrainCells("grass"),
    roadCells: [{
      tile: { column: 0, row: 0 },
      connections: [],
      surface: "dirt",
    }],
    roadHub: { column: 0, row: 0 },
    landmarks: [],
    scenery: [],
    quietClearings: [],
    collision: Array.from({ length: CHUNK_COLUMNS * CHUNK_ROWS }, () => 0 as const),
    connectors: connectors.map((connector) => ({ ...connector })),
  };
}

// "olive-grass" / "worn-grass" are retired; "grass" / "meadow" are two published
// nirvana-v3 materials, standing in as two distinct kinds for the hash-sensitivity test.
function terrainCells(
  kind: "grass" | "meadow",
): NirvanaChunkInput["terrainCells"] {
  return Array.from({ length: CHUNK_COLUMNS * CHUNK_ROWS }, (_, index) => ({
    tile: {
      column: index % CHUNK_COLUMNS,
      row: Math.floor(index / CHUNK_COLUMNS),
    },
    kind,
    variant: 0 as const,
    base: kind,
    overlays: [],
    shorelines: [],
  }));
}
