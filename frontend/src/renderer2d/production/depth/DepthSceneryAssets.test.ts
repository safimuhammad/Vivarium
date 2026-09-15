import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { PRODUCTION_ASSET_MANIFEST } from "../assets/productionManifest";
import { DEPTH_SCENERY_ATLAS, DEPTH_SCENERY_FRAMES, withDepthSceneryManifest } from "./DepthSceneryAssets";

describe("generated scenery atlas", () => {
  it("matches the shipped alpha art, exact bytes and bounded source rectangles", async () => {
    const bytes = await readFile(resolve("src/assets/renderer2d/depth-details-v1.webp"));
    const metadata = await sharp(bytes).metadata();
    expect(metadata).toMatchObject({ width: 1536, height: 1024, hasAlpha: true });
    expect(bytes.length).toBe(DEPTH_SCENERY_ATLAS.compressedBytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(DEPTH_SCENERY_ATLAS.sha256);
    for (const frame of Object.values(DEPTH_SCENERY_FRAMES)) {
      expect(frame.x + frame.width).toBeLessThanOrEqual(metadata.width!);
      expect(frame.y + frame.height).toBeLessThanOrEqual(metadata.height!);
    }
  });

  it("accounts for one shared bitmap without changing or repeatedly expanding the native budget", () => {
    const native = PRODUCTION_ASSET_MANIFEST;
    const extended = withDepthSceneryManifest(native);
    expect(extended.budgets.activeCompressedMax - native.budgets.activeCompressedMax).toBe(DEPTH_SCENERY_ATLAS.compressedBytes);
    expect(extended.budgets.exactPeakActiveDecodedBytes["worn-heartland"] - native.budgets.exactPeakActiveDecodedBytes["worn-heartland"])
      .toBe(DEPTH_SCENERY_ATLAS.decodedBytes);
    expect(extended.budgets.coreCompressedBytes).toBe(native.budgets.coreCompressedBytes);
    expect(withDepthSceneryManifest(extended)).toBe(extended);
    expect(native.budgets.activeCompressedMax).toBe(1310720);
  });
});
