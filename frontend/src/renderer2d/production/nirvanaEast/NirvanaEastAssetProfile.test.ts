/**
 * @fileoverview The published `nirvana-east-v1` art and the profile that validates it at load.
 *
 * Byte-level and shape-level on purpose, for the same reason
 * `warmSprings/WarmSpringsStaticSceneProvider.test.ts` pins Warm Springs' sha256/byte
 * counts: the owner approved composition B ("Butte Country") by eye on the pilot's exact
 * pixels, so pinning these numbers is what makes "what shipped is what was approved" a
 * checkable claim rather than a promise.
 *
 * The corner-bit and landform-pivot fail-loud checks run at MODULE LOAD time (mirroring
 * `WarmSpringsAssetProfile.ts`'s corner-bit check and `eastPainter.ts`'s
 * `assertLandformPivotsAgree`), so they can only be exercised by re-evaluating the module
 * against a mutated atlas manifest: `vi.doMock` swaps the JSON import, `vi.resetModules`
 * clears the cached evaluation, and a fresh dynamic `import()` re-runs the module-level
 * `parseAtlasManifest` call. A synchronous throw during module evaluation surfaces as a
 * REJECTED import() promise, which is what each `rejects.toThrow` below observes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import atlasManifest from "../../../assets/renderer2d/regions/nirvana-east-v1/atlas.json";
import { PRODUCTION_ASSET_MANIFEST } from "../assets/productionManifest";

const ATLAS_JSON_SPECIFIER = "../../../assets/renderer2d/regions/nirvana-east-v1/atlas.json";
const PROFILE_MODULE_SPECIFIER = "./NirvanaEastAssetProfile";

describe("NirvanaEastAssetProfile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock(ATLAS_JSON_SPECIFIER);
  });

  it("publishes the approved art, byte for byte, with the exact published frame count", async () => {
    const { NIRVANA_EAST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    const [terrain, scenery] = NIRVANA_EAST_ATLAS_PROFILE.descriptors;
    expect(terrain).toMatchObject({
      id: "nirvana-east-v1-terrain",
      width: 512,
      height: 928,
      compressedBytes: 109_910,
      sha256: "b723b00f710e236ac2b2d86e884dd24abab6805dc2bff39ce0e9208ef3d3260b",
    });
    expect(scenery).toMatchObject({
      id: "nirvana-east-v1-scenery",
      width: 528,
      height: 1_464,
      compressedBytes: 48_008,
      sha256: "b5d9af6ba829192fa01dd0f5d287ef6424da6641b7dee0240ea06c0c54488235",
    });
    // 454 terrain frames (104 base + 266 corner-masked edges + 84 wet lines) plus 55
    // scenery frames — the composition-B vocabulary plus the five landform plan variants
    // (butte 1-2, outcrop 1-3). The terrain sheet is byte-identical to the approved
    // generation; only the scenery sheet grew.
    expect(Object.keys(NIRVANA_EAST_ATLAS_PROFILE.frames)).toHaveLength(509);
    expect(NIRVANA_EAST_ATLAS_PROFILE.compressedBytes).toBe(157_918);
    expect(NIRVANA_EAST_ATLAS_PROFILE.regionId).toBe("nirvana_east");
    expect(NIRVANA_EAST_ATLAS_PROFILE.requiredKit).toBe("dry-scrub");
  });

  it("stays well inside the per-kit ceiling, with real headroom still reserved", async () => {
    const { NIRVANA_EAST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    const metadataBytes = 9_797;
    const total = NIRVANA_EAST_ATLAS_PROFILE.compressedBytes + metadataBytes;
    expect(total).toBe(167_715);
    expect(total).toBeLessThan(196_608);
    // Published at 85.30% -- the landform plan variants spent 18,854 B of the pilot's
    // reserved 47,747 B, and more than 25 KB (~28.2 KB) is still deliberately unspent.
    expect(196_608 - total).toBeGreaterThan(25 * 1_024);
  });

  it("enforces the shared active-atlas ceiling when it joins the manifest", async () => {
    const { NIRVANA_EAST_ATLAS_PROFILE, createNirvanaEastProductionManifest } =
      await import(PROFILE_MODULE_SPECIFIER);
    const manifest = createNirvanaEastProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const projected = manifest.budgets.activeCompressedBytes["dry-scrub"]
      + NIRVANA_EAST_ATLAS_PROFILE.compressedBytes;
    expect(projected).toBeLessThanOrEqual(manifest.budgets.activeCompressedMax);
    expect(manifest.atlases["nirvana-east-v1-terrain"]).toBeDefined();
    expect(manifest.atlases["nirvana-east-v1-scenery"]).toBeDefined();
    expect(manifest.regions).toBe(PRODUCTION_ASSET_MANIFEST.regions);
  });

  it("refuses a manifest extension whose atlas id already belongs to a different descriptor", async () => {
    const { NIRVANA_EAST_ATLAS_PROFILE, createNirvanaEastProductionManifest } =
      await import(PROFILE_MODULE_SPECIFIER);
    const colliding = {
      ...PRODUCTION_ASSET_MANIFEST,
      atlases: {
        ...PRODUCTION_ASSET_MANIFEST.atlases,
        [NIRVANA_EAST_ATLAS_PROFILE.terrainAtlasId]: {
          ...NIRVANA_EAST_ATLAS_PROFILE.descriptors[0]!,
          sha256: "0".repeat(64),
        },
      },
    };
    expect(() => createNirvanaEastProductionManifest(colliding))
      .toThrow(/already owned by another descriptor/);
  });

  it("refuses a manifest extension that overruns the shared active-atlas budget", async () => {
    const { createNirvanaEastProductionManifest } = await import(PROFILE_MODULE_SPECIFIER);
    const overBudget = {
      ...PRODUCTION_ASSET_MANIFEST,
      budgets: {
        ...PRODUCTION_ASSET_MANIFEST.budgets,
        activeCompressedBytes: {
          ...PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedBytes,
          "dry-scrub": PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax,
        },
      },
    };
    expect(() => createNirvanaEastProductionManifest(overBudget))
      .toThrow(/active compressed budget exceeded/);
  });

  it("fails loudly when the atlas declares a corner-bit convention that disagrees with the terrain field", async () => {
    const mutated = structuredClone(atlasManifest) as Record<string, unknown>;
    mutated.cornerBits = { nw: 2, ne: 1, se: 4, sw: 8 };
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/corner bits/);
  });

  it("fails loudly when a published landform frame disagrees with PROP_PIVOTS", async () => {
    const mutated = structuredClone(atlasManifest) as unknown as {
      sceneryFrames: readonly (readonly [string, number, number, number, number, number, number])[];
    } & Record<string, unknown>;
    mutated.sceneryFrames = mutated.sceneryFrames.map((frame) => (
      frame[0] === "s.mesa.0"
        ? [frame[0], frame[1], frame[2], frame[3], frame[4], frame[5] + 1, frame[6]] as const
        : frame
    ));
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/PROP_PIVOTS expects/);
  });
});
