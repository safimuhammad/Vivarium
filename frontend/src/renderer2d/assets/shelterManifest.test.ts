import { describe, expect, it } from "vitest";

import {
  DEMO_SHELTER_MANIFEST,
  SHELTER_ATLAS_CELL_IDS,
  validateShelterVisualManifest,
  type ShelterVisualManifest,
} from "./shelterManifest";

const mutate = (change: (copy: any) => void): ShelterVisualManifest => {
  const copy = structuredClone(DEMO_SHELTER_MANIFEST);
  change(copy);
  return copy;
};

describe("shelter visual manifest", () => {
  it("maps every native 5x4 cell exactly once with the approved component semantics", () => {
    expect(validateShelterVisualManifest(DEMO_SHELTER_MANIFEST)).toEqual([]);
    expect(DEMO_SHELTER_MANIFEST).toMatchObject({
      atlasId: "shelter",
      cellWidth: 128,
      cellHeight: 128,
      columns: 5,
      rows: 4,
      components: {
        foundation: { standing: "foundation", damaged: "foundation", falling: "foundation" },
        posts: { standing: "post", damaged: "post", falling: "post" },
        walls: { standing: "wall-intact", damaged: "wall-broken", falling: "wall-falling" },
        roof: { standing: "roof-intact", damaged: "roof-falling", falling: "roof-falling" },
        door: { standing: "door-closed", damaged: "door-falling", falling: "door-falling" },
        hearth: { standing: "hearth", damaged: "hearth", falling: "hearth" },
      },
      doorOpen: "door-open",
      accents: { window: "window", hearth: "hearth", chimney: "chimney", smoke: "smoke", dust: "dust" },
      damage: { wallCracked: "wall-cracked", wallBroken: "wall-broken" },
      ruins: {
        full: { frame: "rubble-full", composition: ["rubble-full"] },
        "picked-over": { frame: "rubble-picked-over", composition: ["rubble-picked-over"] },
        "nearly-bare": { frame: "rubble-nearly-bare", composition: ["rubble-nearly-bare"] },
      },
      empty: "empty",
    });

    expect(DEMO_SHELTER_MANIFEST.frames.map(({ id }) => id)).toEqual(SHELTER_ATLAS_CELL_IDS);
    expect(new Set(DEMO_SHELTER_MANIFEST.frames.map(({ id }) => id)).size).toBe(20);
    expect(new Set(DEMO_SHELTER_MANIFEST.frames.map(({ rect }) => `${rect.x},${rect.y}`)).size).toBe(20);
    expect(DEMO_SHELTER_MANIFEST.frames.map(({ rect }) => rect)).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        x: (index % 5) * 128,
        y: Math.floor(index / 5) * 128,
        width: 128,
        height: 128,
      })),
    );
  });

  it.each([
    ["missing cell", (manifest: any) => { manifest.frames.pop(); }],
    ["duplicate id", (manifest: any) => { manifest.frames[1].id = manifest.frames[0].id; }],
    ["duplicate rectangle", (manifest: any) => { manifest.frames[1].rect = { ...manifest.frames[0].rect }; }],
    ["out-of-bounds cell", (manifest: any) => { manifest.frames[19].rect.x = 640; }],
    ["non-native size", (manifest: any) => { manifest.frames[0].rect.width = 64; }],
    ["fractional origin", (manifest: any) => { manifest.frames[0].rect.x = 0.5; }],
    ["wrong standing component", (manifest: any) => { manifest.components.roof.standing = "wall-intact"; }],
    ["wrong falling component", (manifest: any) => { manifest.components.door.falling = "roof-falling"; }],
    ["missing explicit dust", (manifest: any) => { manifest.accents.dust = "empty"; }],
    ["missing open door", (manifest: any) => { manifest.doorOpen = "door-closed"; }],
    ["wrong ruin tier", (manifest: any) => { manifest.ruins.full.frame = "rubble-nearly-bare"; }],
    ["wrong ruin composition", (manifest: any) => { manifest.ruins["picked-over"].composition = ["rubble-full"]; }],
    ["occupied empty role", (manifest: any) => { manifest.empty = "dust"; }],
  ])("rejects %s", (_label, change) => {
    expect(validateShelterVisualManifest(mutate(change))).not.toEqual([]);
  });
});
