import { describe, expect, it } from "vitest";

import {
  NIRVANA_ATLAS_PROFILE,
  createNirvanaProductionManifest,
} from "../nirvana/NirvanaAssetProfile";
import { PRODUCTION_ASSET_MANIFEST } from "./productionManifest";
import { productionAtlasIdsForRegion } from "./ProductionRegionAssets";

describe("production exact-region atlas resolution", () => {
  it("adds Nirvana V2 atlases only for the exact verified Nirvana presentation", () => {
    const manifest = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const baseWornIds = [...PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].atlasIds];
    const exact = productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana",
      kit: "worn-heartland",
      presentationProfile: {
        kind: "nirvana-v2",
        atlasProfileVersion: 2,
        staticSceneHash: "12345678",
      },
    });
    const otherWorn = productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana_east",
      kit: "worn-heartland",
    });

    expect(exact).toEqual(expect.arrayContaining([
      NIRVANA_ATLAS_PROFILE.terrainAtlasId,
      NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    ]));
    expect(otherWorn).not.toContain(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
    expect(otherWorn).not.toContain(NIRVANA_ATLAS_PROFILE.sceneryAtlasId);
    expect(PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].atlasIds)
      .toEqual(baseWornIds);
  });

  it("does not infer V2 art from the Nirvana name without the verified profile", () => {
    const manifest = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);

    expect(productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana",
      kit: "worn-heartland",
    })).not.toEqual(expect.arrayContaining([
      NIRVANA_ATLAS_PROFILE.terrainAtlasId,
      NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    ]));
  });

  it("fails closed on a cross-region Nirvana profile or missing selected descriptor", () => {
    const manifest = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const profile = {
      kind: "nirvana-v2" as const,
      atlasProfileVersion: 2 as const,
      staticSceneHash: "12345678",
    };

    expect(() => productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana_west",
      kit: "worn-heartland",
      presentationProfile: profile,
    })).toThrow(/exact.*nirvana|nirvana.*exact/i);

    const missing = Object.freeze({
      ...manifest,
      atlases: Object.freeze(Object.fromEntries(
        Object.entries(manifest.atlases).filter(([id]) => (
          id !== NIRVANA_ATLAS_PROFILE.sceneryAtlasId
        )),
      )),
    });
    expect(() => productionAtlasIdsForRegion(missing, {
      regionId: "nirvana",
      kit: "worn-heartland",
      presentationProfile: profile,
    })).toThrow(/descriptor/i);
  });

  it("returns one sorted, descriptor-backed atlas ID set", () => {
    const manifest = createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const ids = productionAtlasIdsForRegion(manifest, {
      regionId: "nirvana",
      kit: "worn-heartland",
      presentationProfile: {
        kind: "nirvana-v2",
        atlasProfileVersion: 2,
        staticSceneHash: "12345678",
      },
    });

    expect(ids).toEqual([...new Set(ids)].sort());
    expect(ids.every((id) => manifest.atlases[id] !== undefined)).toBe(true);
  });
});
