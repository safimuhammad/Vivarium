import { describe, expect, it } from "vitest";

import {
  NIRVANA_ATLAS_PROFILE,
  type NirvanaAtlasFrameRecord,
  type NirvanaAtlasProfile,
} from "./NirvanaAssetProfile";
import {
  createNirvanaAtlasAssets,
  roadFrameIdFor,
  swaleFrameIdFor,
} from "./NirvanaAtlas";
import type { NirvanaCardinalDirection, NirvanaTerrainCell } from "./NirvanaRegionV2";

const terrainImage = { width: 512, height: 800 } as CanvasImageSource;
const sceneryImage = { width: 672, height: 1010 } as CanvasImageSource;

const ROAD_MASK_CASES: readonly (readonly [
  readonly NirvanaCardinalDirection[],
  string,
])[] = Object.freeze([
  [[], "terrain.road.isolated"],
  [["north"], "terrain.road.end.n"],
  [["east"], "terrain.road.end.e"],
  [["south"], "terrain.road.end.s"],
  [["west"], "terrain.road.end.w"],
  [["north", "south"], "terrain.road.straight.ns"],
  [["east", "west"], "terrain.road.straight.ew"],
  [["north", "east"], "terrain.road.corner.ne"],
  [["east", "south"], "terrain.road.corner.se"],
  [["south", "west"], "terrain.road.corner.sw"],
  [["north", "west"], "terrain.road.corner.nw"],
  [["north", "east", "west"], "terrain.road.tee.n"],
  [["north", "east", "south"], "terrain.road.tee.e"],
  [["east", "south", "west"], "terrain.road.tee.s"],
  [["north", "south", "west"], "terrain.road.tee.w"],
  [["north", "east", "south", "west"], "terrain.road.cross"],
]);

const SWALE_MASK_CASES: readonly (readonly [
  readonly NirvanaCardinalDirection[],
  string,
])[] = Object.freeze([
  [["north", "south"], "terrain.swale.straight.ns"],
  [["east", "west"], "terrain.swale.straight.ew"],
  [["north", "east"], "terrain.swale.corner.ne"],
  [["east", "south"], "terrain.swale.corner.se"],
  [["south", "west"], "terrain.swale.corner.sw"],
  [["north", "west"], "terrain.swale.corner.nw"],
]);

/** A minimal, fully-typed dry-swale/ford cell fixture; only `kind`/`connections` matter. */
function swaleCell(
  kind: "dry-swale" | "ford",
  connections: readonly NirvanaCardinalDirection[],
): NirvanaTerrainCell {
  return {
    tile: { column: 3, row: 2 },
    kind,
    variant: 0,
    base: "grass",
    overlays: [],
    shorelines: [],
    connections,
  };
}

describe("production Nirvana atlas", () => {
  it("validates and indexes the complete exact-region frame vocabulary", () => {
    const assets = createNirvanaAtlasAssets(
      terrainImage,
      sceneryImage,
      NIRVANA_ATLAS_PROFILE,
    );

    expect(assets.terrain).toBe(terrainImage);
    expect(assets.scenery).toBe(sceneryImage);
    expect(assets.frames.size).toBe(509);
    expect(assets.frames.get("terrain.road.cross")?.image).toBe("terrain");
    // Macro landmarks are addressed positionally in the scenery image now, not a
    // separate landmark atlas.
    expect(assets.frames.get("landmark.hero-oak")?.image).toBe("scenery");
  });

  it("fails closed on duplicate IDs, unknown owners, invalid geometry, or missing vocabulary", () => {
    const cross = requiredFrame("terrain.road.cross");

    expect(() => createNirvanaAtlasAssets(
      terrainImage,
      sceneryImage,
      profileWithFrames({
        ...NIRVANA_ATLAS_PROFILE.frames,
        "duplicate.record": { ...cross },
      }),
    )).toThrow(/duplicate frame/i);

    expect(() => createNirvanaAtlasAssets(
      terrainImage,
      sceneryImage,
      profileWithFrames({
        ...NIRVANA_ATLAS_PROFILE.frames,
        "terrain.road.cross": {
          ...cross,
          image: "unknown",
        } as unknown as NirvanaAtlasFrameRecord,
      }),
    )).toThrow(/unknown image/i);

    expect(() => createNirvanaAtlasAssets(
      terrainImage,
      sceneryImage,
      profileWithFrames({
        ...NIRVANA_ATLAS_PROFILE.frames,
        "terrain.road.cross": {
          ...cross,
          // 512 is exactly the terrain image's width, so this 32px-aligned cell falls
          // entirely outside the atlas.
          rect: { x: 512, y: 0, width: 32, height: 32 },
        },
      }),
    )).toThrow(/atlas bounds/i);

    const missing = { ...NIRVANA_ATLAS_PROFILE.frames };
    delete missing["terrain.road.cross"];
    expect(() => createNirvanaAtlasAssets(
      terrainImage,
      sceneryImage,
      profileWithFrames(missing),
    )).toThrow(/missing.*terrain\.road\.cross/i);
  });

  it("maps road connectors and every swale mask without painter fallbacks", () => {
    expect(roadFrameIdFor(
      {
        tile: { column: 47, row: 16 },
        connections: ["west"],
        surface: "dirt",
      },
      [{ edge: "east", offset: 16 }],
    )).toBe("terrain.road.straight.ew");
    expect(roadFrameIdFor(
      {
        tile: { column: 4, row: 3 },
        connections: ["north", "east", "south", "west"],
        surface: "dirt",
      },
      [],
    )).toBe("terrain.road.cross");
    expect(swaleFrameIdFor(swaleCell("dry-swale", ["south", "west"])))
      .toBe("terrain.swale.corner.sw");
    expect(swaleFrameIdFor(swaleCell("ford", ["north", "south"])))
      .toBe("terrain.ford.ew");
    expect(swaleFrameIdFor(swaleCell("ford", ["east", "west"])))
      .toBe("terrain.ford.ns");
  });

  it("maps every canonical dirt-road and dry-swale connection mask", () => {
    for (const [connections, expectedFrameId] of ROAD_MASK_CASES) {
      expect(roadFrameIdFor(
        {
          tile: { column: 4, row: 3 },
          connections,
          surface: "dirt",
        },
        [],
      ), `road mask ${connections.join("-") || "isolated"}`).toBe(expectedFrameId);
    }

    for (const [connections, expectedFrameId] of SWALE_MASK_CASES) {
      expect(
        swaleFrameIdFor(swaleCell("dry-swale", connections)),
        `swale mask ${connections.join("-")}`,
      ).toBe(expectedFrameId);
    }
  });

  it("maps road fords along one axis and rejects missing or mixed axes", () => {
    const fordFrameFor = (connections: readonly NirvanaCardinalDirection[]): string => (
      roadFrameIdFor(
        {
          tile: { column: 4, row: 3 },
          connections,
          surface: "ford",
        },
        [],
      )
    );

    expect(fordFrameFor(["east", "west"])).toBe("terrain.ford.ew");
    expect(fordFrameFor(["north", "south"])).toBe("terrain.ford.ns");
    expect(() => fordFrameFor([])).toThrow(/ford road.*mask/i);
    expect(() => fordFrameFor(["north", "east"])).toThrow(/ford road.*mask/i);
    expect(() => fordFrameFor(["north", "east", "south", "west"]))
      .toThrow(/ford road.*mask/i);
  });
});

function requiredFrame(id: string): NirvanaAtlasFrameRecord {
  const frame = NIRVANA_ATLAS_PROFILE.frames[id];
  if (frame === undefined) throw new Error(`Missing fixture frame ${id}`);
  return frame;
}

function profileWithFrames(
  frames: Readonly<Record<string, NirvanaAtlasFrameRecord>>,
): NirvanaAtlasProfile {
  return {
    ...NIRVANA_ATLAS_PROFILE,
    frames,
  };
}
