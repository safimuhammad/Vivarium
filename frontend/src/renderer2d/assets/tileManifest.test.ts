import { describe, expect, it } from "vitest";

import {
  NIRVANA_PROP_FRAME_IDS,
  NIRVANA_TILE_MANIFEST,
  connectedTileFrameId,
  resolveTileFrame,
  validateTileManifest,
  type TileManifest,
} from "./tileManifest";

const mutate = (change: (copy: any) => void): TileManifest => {
  const copy = structuredClone(NIRVANA_TILE_MANIFEST);
  change(copy);
  return copy;
};

describe("native tile manifest", () => {
  it("binds the complete canonical 8x8 inventory to exact native 32px cells", () => {
    expect(validateTileManifest(NIRVANA_TILE_MANIFEST)).toEqual([]);
    expect(NIRVANA_TILE_MANIFEST).toMatchObject({
      atlasId: "nirvana-tiles",
      columns: 8,
      rows: 8,
      cellWidth: 32,
      cellHeight: 32,
    });
    expect(NIRVANA_TILE_MANIFEST.frames).toHaveLength(64);
    expect(new Set(NIRVANA_TILE_MANIFEST.frames.map(({ id }) => id)).size).toBe(64);
    expect(NIRVANA_TILE_MANIFEST.frames.map(({ rect }) => rect)).toEqual(
      Array.from({ length: 64 }, (_, index) => ({
        x: (index % 8) * 32,
        y: Math.floor(index / 8) * 32,
        width: 32,
        height: 32,
      })),
    );
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "ground-a").rect).toEqual({ x: 0, y: 0, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "path-horizontal").rect).toEqual({ x: 0, y: 32, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "tree-a").rect).toEqual({ x: 64, y: 160, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "shrub-a").rect).toEqual({ x: 0, y: 160, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "garden-bed").rect).toEqual({ x: 96, y: 224, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "water-pool").rect).toEqual({ x: 224, y: 64, width: 32, height: 32 });
    expect(resolveTileFrame(NIRVANA_TILE_MANIFEST, "signpost").rect).toEqual({ x: 224, y: 192, width: 32, height: 32 });
    expect(NIRVANA_PROP_FRAME_IDS).toEqual({
      tree: "tree-a",
      "tree-round": "tree-b",
      shrub: "shrub-a",
      "shrub-round": "shrub-b",
      garden: "garden-bed",
      post: "signpost",
      "flowers-white": "flowers-white",
      "flowers-pink": "flowers-pink",
      "rock-small": "rock-small",
      "rock-large": "rock-large",
      "grass-tuft": "grass-tuft",
      "fallen-log": "fallen-log",
      reeds: "reeds",
      lily: "lily",
      stump: "stump",
      sapling: "sapling",
    });
  });

  it.each([
    [{ north: false, east: true, south: false, west: true }, "path-horizontal"],
    [{ north: true, east: false, south: true, west: false }, "path-vertical"],
    [{ north: true, east: true, south: false, west: false }, "path-corner-ne"],
    [{ north: false, east: true, south: true, west: false }, "path-corner-es"],
    [{ north: false, east: false, south: true, west: true }, "path-corner-sw"],
    [{ north: true, east: false, south: false, west: true }, "path-corner-wn"],
    [{ north: true, east: true, south: true, west: false }, "path-cross"],
    [{ north: false, east: false, south: false, west: false }, "path-plaza"],
  ])("selects a named path composition for %j", (connections, expected) => {
    expect(connectedTileFrameId("path", connections)).toBe(expected);
  });

  it("uses the matching named water composition for a pond tile", () => {
    expect(connectedTileFrameId("water", { north: true, east: true, south: false, west: false })).toBe("water-corner-ne");
    expect(connectedTileFrameId("water", { north: true, east: true, south: true, west: true })).toBe("water-cross");
    expect(connectedTileFrameId("water", { north: false, east: false, south: false, west: false })).toBe("water-pool");
  });

  it.each([
    ["missing cell", (manifest: any) => { manifest.frames.pop(); }],
    ["duplicate id", (manifest: any) => { manifest.frames[1].id = manifest.frames[0].id; }],
    ["duplicate rect", (manifest: any) => { manifest.frames[1].rect = { ...manifest.frames[0].rect }; }],
    ["wrong row-major binding", (manifest: any) => { manifest.frames[8].rect.x = 32; }],
    ["out-of-bounds frame", (manifest: any) => { manifest.frames[63].rect.x = 256; }],
    ["non-native frame", (manifest: any) => { manifest.frames[0].rect.width = 31; }],
    ["fractional origin", (manifest: any) => { manifest.frames[0].rect.x = 0.5; }],
  ])("rejects %s", (_label, change) => {
    expect(validateTileManifest(mutate(change))).not.toEqual([]);
  });

  it("rejects undeclared frame lookup instead of inventing an atlas coordinate", () => {
    expect(() => resolveTileFrame(NIRVANA_TILE_MANIFEST, "invented" as never)).toThrow(/undeclared/i);
  });
});
