import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PRODUCTION_SCENE_MANIFEST } from "../ProductionCanvasSceneFactory";
import { productionAtlasIdsForRegion } from "../assets/ProductionRegionAssets";
import { ATLAS_BRIDGE_MATERIALS, ATLAS_BRIDGE_MATERIALS_ID } from "./AtlasBridgeAssets";

describe("Atlas bridge material integration", () => {
  it("ships the exact budgeted material bitmap registered by the production factory", async () => {
    const bytes = readFileSync(resolve(process.cwd(), "src/assets/renderer2d/atlas-bridge-materials-v1.webp"));
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1024, height: 1024 });
    expect(bytes.byteLength).toBe(ATLAS_BRIDGE_MATERIALS.compressedBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ATLAS_BRIDGE_MATERIALS.sha256);
    expect(PRODUCTION_SCENE_MANIFEST.atlases[ATLAS_BRIDGE_MATERIALS_ID]).toBe(ATLAS_BRIDGE_MATERIALS);
    expect(ATLAS_BRIDGE_MATERIALS.compressedBytes).toBeLessThan(300 * 1024);
    expect(ATLAS_BRIDGE_MATERIALS.decodedBytes).toBe(4 * 1024 * 1024);
  });

  it("leases the shared bridge materials in every region so camera changes cannot drop them", () => {
    for (const kit of Object.keys(PRODUCTION_SCENE_MANIFEST.regions)) {
      const ids = productionAtlasIdsForRegion(PRODUCTION_SCENE_MANIFEST, {
        regionId: "bridge-lease-study",
        kit: kit as keyof typeof PRODUCTION_SCENE_MANIFEST.regions,
      });
      expect(ids.filter((id) => id === ATLAS_BRIDGE_MATERIALS_ID)).toHaveLength(1);
    }
  });
});
