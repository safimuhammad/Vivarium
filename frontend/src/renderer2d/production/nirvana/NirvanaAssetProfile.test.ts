import { describe, expect, it } from "vitest";

import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetManifest,
} from "../assets/productionManifest";
import {
  NIRVANA_ATLAS_PROFILE,
  NIRVANA_REGION_ID,
  createNirvanaProductionManifest,
} from "./NirvanaAssetProfile";

const PROFILE_ATLAS_IDS = ["nirvana-v3-scenery", "nirvana-v3-terrain"] as const;

describe("Nirvana production asset profile", () => {
  it("binds the exact Nirvana identity to two frozen production atlas descriptors", () => {
    expect(NIRVANA_REGION_ID).toBe("nirvana");
    expect(NIRVANA_ATLAS_PROFILE).toMatchObject({
      regionId: "nirvana",
      requiredKit: "worn-heartland",
      terrainAtlasId: "nirvana-v3-terrain",
      sceneryAtlasId: "nirvana-v3-scenery",
    });
    expect(NIRVANA_ATLAS_PROFILE.descriptors.map(({ id }) => id).sort()).toEqual(
      PROFILE_ATLAS_IDS,
    );

    const terrain = NIRVANA_ATLAS_PROFILE.descriptors.find(
      ({ id }) => id === NIRVANA_ATLAS_PROFILE.terrainAtlasId,
    );
    const scenery = NIRVANA_ATLAS_PROFILE.descriptors.find(
      ({ id }) => id === NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    );
    expect(terrain).toMatchObject({
      group: "region",
      regionKit: "worn-heartland",
      width: 512,
      height: 800,
      cellWidth: 32,
      cellHeight: 32,
      columns: 16,
      rows: 25,
      decodedBytes: 512 * 800 * 4,
    });
    expect(scenery).toMatchObject({
      group: "region",
      regionKit: "worn-heartland",
      width: 672,
      height: 1010,
      cellWidth: 32,
      cellHeight: 32,
      columns: 21,
      rows: 31,
      decodedBytes: 672 * 1010 * 4,
    });
    // owner-authorised Option A re-baseline, plan §P3: the symlink farm moved from
    // `.nirvana-v2-generations` to `.nirvana-v3-generations`; the generation-hash
    // directory naming convention itself is unchanged.
    const terrainGeneration = terrain?.url.href.match(
      /\/assets\/renderer2d\/regions\/\.nirvana-v3-generations\/([a-f0-9]{64})\/terrain\.png$/,
    );
    const sceneryGeneration = scenery?.url.href.match(
      /\/assets\/renderer2d\/regions\/\.nirvana-v3-generations\/([a-f0-9]{64})\/scenery\.png$/,
    );
    expect(terrainGeneration?.[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(sceneryGeneration?.[1]).toBe(terrainGeneration?.[1]);
    expect(terrain?.compressedBytes).toBeGreaterThan(0);
    expect(scenery?.compressedBytes).toBeGreaterThan(0);
    expect(terrain?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(scenery?.sha256).toMatch(/^[a-f0-9]{64}$/);

    expect(Object.isFrozen(NIRVANA_ATLAS_PROFILE)).toBe(true);
    expect(Object.isFrozen(NIRVANA_ATLAS_PROFILE.descriptors)).toBe(true);
    expect(NIRVANA_ATLAS_PROFILE.descriptors.every(Object.isFrozen)).toBe(true);
  });

  it("publishes the nirvana-v3 material vocabulary the terrain field was authored for", () => {
    // owner-authorised Option A re-baseline, plan §P3: the flat "olive-grass" /
    // "worn-grass" / "garden-floor" ground kinds are retired; the profile now
    // publishes the full river-valley material vocabulary instead.
    expect([...NIRVANA_ATLAS_PROFILE.materials].sort()).toEqual([
      "deepwater", "grass", "gravel", "meadow", "reed", "rock",
      "shadegrass", "shallow", "silt", "sungrass", "thicket", "water",
    ].sort());
    expect([...NIRVANA_ATLAS_PROFILE.blockingMaterials].sort()).toEqual([
      "deepwater", "reed", "rock", "shallow", "thicket", "water",
    ].sort());
    expect([...NIRVANA_ATLAS_PROFILE.shoreMaterials].sort()).toEqual([
      "gravel", "reed", "silt",
    ].sort());
  });

  it("publishes every validated frame under its owning production atlas", () => {
    const frames = Object.values(NIRVANA_ATLAS_PROFILE.frames);
    expect(frames).toHaveLength(509);
    expect(NIRVANA_ATLAS_PROFILE.frames["terrain.road.cross"]?.atlasId)
      .toBe(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
    // Macro landmarks are ground scenery now (`s.*` / `landmark.*` sprites addressed
    // positionally in the scenery image), not a separate landmark atlas.
    expect(NIRVANA_ATLAS_PROFILE.frames["landmark.hero-oak"]?.atlasId)
      .toBe(NIRVANA_ATLAS_PROFILE.sceneryAtlasId);
    expect(NIRVANA_ATLAS_PROFILE.frames["landmark.hero-oak"]).toMatchObject({
      rect: { width: 128, height: 128 },
      pivot: { x: 64, y: 124 },
    });
    // Base terrain fills resolve through the published `t.<material>.<variant>`
    // vocabulary rather than the retired `terrain.grass.olive.*` frame family.
    expect(NIRVANA_ATLAS_PROFILE.frames["t.grass.0"]?.atlasId)
      .toBe(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
    expect(Object.isFrozen(NIRVANA_ATLAS_PROFILE.frames)).toBe(true);
    expect(frames.every((frame) => (
      Object.isFrozen(frame)
      && Object.isFrozen(frame.rect)
      && Object.isFrozen(frame.pivot)
      && (frame.connections === undefined || Object.isFrozen(frame.connections))
    ))).toBe(true);
  });

  it("adds only the exact Nirvana descriptors without mutating biome pack ownership", () => {
    const beforeAtlasIds = Object.keys(PRODUCTION_ASSET_MANIFEST.atlases).sort();
    const beforeWornPack = structuredClone(
      PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"],
    );

    const overlay = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);

    expect(overlay).not.toBe(PRODUCTION_ASSET_MANIFEST);
    expect(overlay.atlases).not.toBe(PRODUCTION_ASSET_MANIFEST.atlases);
    expect(Object.keys(PRODUCTION_ASSET_MANIFEST.atlases).sort()).toEqual(beforeAtlasIds);
    expect(Object.keys(PRODUCTION_ASSET_MANIFEST.atlases)).not.toContain("nirvana-v3-terrain");
    expect(Object.keys(overlay.atlases).filter((id) => !beforeAtlasIds.includes(id)).sort())
      .toEqual(PROFILE_ATLAS_IDS);
    expect(overlay.regions).toBe(PRODUCTION_ASSET_MANIFEST.regions);
    expect(PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"]).toEqual(beforeWornPack);
    expect(overlay.regions["worn-heartland"]).toEqual(beforeWornPack);
    expect(Object.isFrozen(overlay)).toBe(true);
    expect(Object.isFrozen(overlay.atlases)).toBe(true);

    const projectedActiveBytes = PRODUCTION_ASSET_MANIFEST.budgets
      .activeCompressedBytes["worn-heartland"]
      + NIRVANA_ATLAS_PROFILE.descriptors.reduce(
        (total, descriptor) => total + descriptor.compressedBytes,
        0,
      );
    expect(projectedActiveBytes).toBeLessThanOrEqual(
      PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax,
    );
  });

  it("fails before publishing an overlay that would exceed the active compressed budget", () => {
    const base = {
      ...PRODUCTION_ASSET_MANIFEST,
      budgets: {
        ...PRODUCTION_ASSET_MANIFEST.budgets,
        activeCompressedBytes: {
          ...PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedBytes,
          "worn-heartland": PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax,
        },
      },
    } satisfies ProductionAssetManifest;

    expect(() => createNirvanaProductionManifest(base)).toThrow(
      /Nirvana V3 active compressed budget exceeded/,
    );
  });
});
