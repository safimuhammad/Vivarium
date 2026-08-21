/**
 * @fileoverview The published `nirvana-west-v1` art and the profile that validates it at load.
 *
 * Byte-level and shape-level on purpose, for the same reason
 * `nirvanaEast/NirvanaEastAssetProfile.test.ts` pins Nirvana East's sha256/byte counts:
 * pinning these numbers is what makes "what shipped is what was approved" a checkable
 * claim rather than a promise.
 *
 * RE-PINNED for the composition-B republish (was: 512x896 terrain, 14 materials
 * including `brine`/`rime`, 7-field scenery tuples, 534 frames). See
 * `NirvanaWestAssetProfile.ts`'s module docstring for the full story.
 *
 * The fail-loud checks run at MODULE LOAD time (mirroring `WarmSpringsAssetProfile.ts`'s
 * corner-bit check), so they can only be exercised by re-evaluating the module against a
 * mutated atlas manifest: `vi.doMock` swaps the JSON import, `vi.resetModules` clears the
 * cached evaluation, and a fresh dynamic `import()` re-runs the module-level
 * `parseAtlasManifest` call. A synchronous throw during module evaluation surfaces as a
 * REJECTED import() promise, which is what each `rejects.toThrow` below observes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import atlasManifest from "../../../assets/renderer2d/regions/nirvana-west-v1/atlas.json";
import { PRODUCTION_ASSET_MANIFEST } from "../assets/productionManifest";

const ATLAS_JSON_SPECIFIER = "../../../assets/renderer2d/regions/nirvana-west-v1/atlas.json";
const PROFILE_MODULE_SPECIFIER = "./NirvanaWestAssetProfile";

describe("NirvanaWestAssetProfile", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock(ATLAS_JSON_SPECIFIER);
  });

  it("publishes the approved art, byte for byte, with the exact published frame count", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    const [terrain, scenery] = NIRVANA_WEST_ATLAS_PROFILE.descriptors;
    expect(terrain).toMatchObject({
      id: "nirvana-west-v1-terrain",
      width: 512,
      height: 960,
      compressedBytes: 105_813,
      sha256: "965c5b58b9ee741dee5db0a73641580d3051617ac42290f72d46e0a79c271278",
    });
    expect(scenery).toMatchObject({
      id: "nirvana-west-v1-scenery",
      width: 640,
      height: 1_600,
      compressedBytes: 26_018,
      sha256: "4ae4c705d503292802b050f2a1f871e76171e6d6d29020376706480dcfc16459",
    });
    // 468 terrain-grid frames (104 base fills + 280 corner-masked edges + 84 rim
    // lines) plus 83 scenery frames -- the exact published Nirvana West vocabulary.
    expect(Object.keys(NIRVANA_WEST_ATLAS_PROFILE.frames)).toHaveLength(551);
    expect(NIRVANA_WEST_ATLAS_PROFILE.compressedBytes).toBe(131_831);
    expect(NIRVANA_WEST_ATLAS_PROFILE.regionId).toBe("nirvana_west");
    expect(NIRVANA_WEST_ATLAS_PROFILE.requiredKit).toBe("ash-waste");
  });

  it("publishes the pinned, trimmed-and-extended material vocabulary in paint-priority order", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    // `brine`/`rime` were retired (compositions the owner did not choose); `slab`/
    // `spoil` are new walkable industrial terrain tiers.
    expect(NIRVANA_WEST_ATLAS_PROFILE.materials).toEqual([
      "ember", "emberdim", "glass", "cinder", "slatedark", "slate", "dust",
      "ash", "ashpale", "slab", "spoil", "clinker", "scree", "causeway",
    ]);
    expect(NIRVANA_WEST_ATLAS_PROFILE.blockingMaterials).toEqual(["ember", "clinker", "scree"]);
    expect(NIRVANA_WEST_ATLAS_PROFILE.rimMaterials).toEqual(["cinder", "ashpale", "clinker"]);
    expect(NIRVANA_WEST_ATLAS_PROFILE.voidMaterials).toEqual(["ember", "emberdim"]);
    expect(NIRVANA_WEST_ATLAS_PROFILE.materials).not.toContain("brine");
    expect(NIRVANA_WEST_ATLAS_PROFILE.materials).not.toContain("rime");
  });

  it("carries a measured, possibly-zero-area ground-contact rect on every scenery frame", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    const snag = NIRVANA_WEST_ATLAS_PROFILE.frames["s.snag.0"];
    expect(snag.contact).toEqual({ x: 9, y: 66, width: 15, height: 5 });
    // `emberwisp` is a flat decal with no wall: a legitimate zero-area footprint.
    const emberwisp = NIRVANA_WEST_ATLAS_PROFILE.frames["s.emberwisp.0"];
    expect(emberwisp.contact).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    // Terrain frames carry no contact field at all -- a full tile IS the ground.
    const emberBase = NIRVANA_WEST_ATLAS_PROFILE.frames["t.ember.0"];
    expect(emberBase.image).toBe("terrain");
    expect("contact" in emberBase).toBe(false);
  });

  it("stays well inside the per-kit ceiling, with the pilot's own reserved headroom", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE } = await import(PROFILE_MODULE_SPECIFIER);
    const atlasJsonBytes = 12_082;
    const environmentKitArtBytes = 794;
    const total = NIRVANA_WEST_ATLAS_PROFILE.compressedBytes + atlasJsonBytes + environmentKitArtBytes;
    expect(total).toBe(144_707);
    expect(total).toBeLessThan(196_608);
    // Published at 73.60% -- comfortably more than 40 KB below the ceiling.
    expect(196_608 - total).toBeGreaterThan(40 * 1_024);
  });

  it("enforces the shared active-atlas ceiling when it joins the manifest", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE, createNirvanaWestProductionManifest } =
      await import(PROFILE_MODULE_SPECIFIER);
    const manifest = createNirvanaWestProductionManifest(PRODUCTION_ASSET_MANIFEST);
    const projected = manifest.budgets.activeCompressedBytes["ash-waste"]
      + NIRVANA_WEST_ATLAS_PROFILE.compressedBytes;
    expect(projected).toBeLessThanOrEqual(manifest.budgets.activeCompressedMax);
    expect(manifest.atlases["nirvana-west-v1-terrain"]).toBeDefined();
    expect(manifest.atlases["nirvana-west-v1-scenery"]).toBeDefined();
    expect(manifest.regions).toBe(PRODUCTION_ASSET_MANIFEST.regions);
  });

  it("refuses a manifest extension whose atlas id already belongs to a different descriptor", async () => {
    const { NIRVANA_WEST_ATLAS_PROFILE, createNirvanaWestProductionManifest } =
      await import(PROFILE_MODULE_SPECIFIER);
    const colliding = {
      ...PRODUCTION_ASSET_MANIFEST,
      atlases: {
        ...PRODUCTION_ASSET_MANIFEST.atlases,
        [NIRVANA_WEST_ATLAS_PROFILE.terrainAtlasId]: {
          ...NIRVANA_WEST_ATLAS_PROFILE.descriptors[0]!,
          sha256: "0".repeat(64),
        },
      },
    };
    expect(() => createNirvanaWestProductionManifest(colliding))
      .toThrow(/already owned by another descriptor/);
  });

  it("refuses a manifest extension that overruns the shared active-atlas budget", async () => {
    const { createNirvanaWestProductionManifest } = await import(PROFILE_MODULE_SPECIFIER);
    const overBudget = {
      ...PRODUCTION_ASSET_MANIFEST,
      budgets: {
        ...PRODUCTION_ASSET_MANIFEST.budgets,
        activeCompressedBytes: {
          ...PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedBytes,
          "ash-waste": PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax,
        },
      },
    };
    expect(() => createNirvanaWestProductionManifest(overBudget))
      .toThrow(/active compressed budget exceeded/);
  });

  it("fails loudly when the atlas declares a corner-bit convention that disagrees with the terrain field", async () => {
    const mutated = structuredClone(atlasManifest) as Record<string, unknown>;
    mutated.cornerBits = { nw: 2, ne: 1, se: 4, sw: 8 };
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/corner bits/);
  });

  it("fails loudly when the manifest publishes its own environment image", async () => {
    const mutated = structuredClone(atlasManifest) as Record<string, unknown>;
    const images = mutated.images as Record<string, unknown>;
    images.environment = {
      file: "environment.png",
      width: 256,
      height: 128,
      compressedBytes: 794,
      decodedBytes: 131_072,
      encoding: "indexed8",
      sha256: "0".repeat(64),
    };
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(
      /must not publish its own environment image/,
    );
  });

  it("fails loudly when the manifest's material vocabulary drifts from the pinned list", async () => {
    const mutated = structuredClone(atlasManifest) as Record<string, unknown>;
    mutated.materials = (mutated.materials as string[]).slice(0, -1);
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/materials must publish exactly/);
  });

  it("fails loudly when an image is not published as indexed8", async () => {
    const mutated = structuredClone(atlasManifest) as { images: Record<string, Record<string, unknown>> };
    mutated.images.terrain!.encoding = "rgba8";
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/must be published as indexed8/);
  });

  it("fails loudly when the published frame count drifts from the expected total", async () => {
    const mutated = structuredClone(atlasManifest) as { terrainGrid: { ids: string[] } };
    mutated.terrainGrid.ids = mutated.terrainGrid.ids.slice(0, -1);
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/must publish exactly 551 frames/);
  });

  it("rejects the older 7-field scenery tuple shape now that contact rects are required", async () => {
    const mutated = structuredClone(atlasManifest) as {
      sceneryFrames: readonly (readonly unknown[])[];
    } & Record<string, unknown>;
    mutated.sceneryFrames = mutated.sceneryFrames.map((frame) => frame.slice(0, 7));
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/must be an 11-field tuple/);
  });

  it("fails loudly on a malformed partial-zero contact rect", async () => {
    const mutated = structuredClone(atlasManifest) as unknown as {
      sceneryFrames: (readonly unknown[])[];
    } & Record<string, unknown>;
    mutated.sceneryFrames = mutated.sceneryFrames.map((frame) => (
      frame[0] === "s.snag.0" ? [...frame.slice(0, 7), 5, 0, 0, 0] : frame
    ));
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(/malformed contact rect/);
  });

  it("fails loudly when a contact rect spills outside its own frame bounds", async () => {
    const mutated = structuredClone(atlasManifest) as unknown as {
      sceneryFrames: (readonly unknown[])[];
    } & Record<string, unknown>;
    mutated.sceneryFrames = mutated.sceneryFrames.map((frame) => (
      frame[0] === "s.snag.0" ? [...frame.slice(0, 9), 999, 999] : frame
    ));
    vi.doMock(ATLAS_JSON_SPECIFIER, () => ({ default: mutated }));
    await expect(import(PROFILE_MODULE_SPECIFIER)).rejects.toThrow(
      /contact rect exceeds its own frame bounds/,
    );
  });
});
