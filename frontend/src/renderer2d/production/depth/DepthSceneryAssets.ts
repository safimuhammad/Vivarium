/** Independently budgeted generated scenery; the native atlas certificates stay native. */
import type { Rect } from "../../contracts";
import type { ProductionAssetManifest, ProductionAtlasDescriptor } from "../assets/productionManifest";

export const DEPTH_SCENERY_ATLAS_ID = "observatory-depth-v1";
export const DEPTH_SCENERY_ATLAS: ProductionAtlasDescriptor = Object.freeze({
  id: DEPTH_SCENERY_ATLAS_ID,
  url: Object.freeze({ href: new URL("../../../assets/renderer2d/depth-details-v1.webp", import.meta.url).href }),
  group: "region", regionKit: null,
  width: 1536, height: 1024, cellWidth: 512, cellHeight: 512, columns: 3, rows: 2,
  compressedBytes: 512048, decodedBytes: 6291456,
  sha256: "890b3e67f8550e5f0ddee05a517a960cabda48208cddbbf0327818fa9e883c06",
});

export type DepthSceneryKind = "oak" | "willow" | "cedar" | "sandstone" | "well" | "cottage";
/** Measured isolated source rectangles, including the roots beyond the nominal cell boundary. */
export const DEPTH_SCENERY_FRAMES: Readonly<Record<DepthSceneryKind, Rect>> = Object.freeze({
  oak: Object.freeze({ x: 20, y: 24, width: 490, height: 506 }),
  willow: Object.freeze({ x: 542, y: 28, width: 466, height: 502 }),
  cedar: Object.freeze({ x: 1080, y: 22, width: 448, height: 508 }),
  sandstone: Object.freeze({ x: 18, y: 561, width: 494, height: 430 }),
  well: Object.freeze({ x: 612, y: 570, width: 355, height: 412 }),
  cottage: Object.freeze({ x: 1054, y: 536, width: 474, height: 450 }),
});

/** Add one shared, bounded decoration atlas to the exact scene manifest. */
export function withDepthSceneryManifest(base: ProductionAssetManifest): ProductionAssetManifest {
  const prior = base.atlases[DEPTH_SCENERY_ATLAS_ID];
  if (prior !== undefined && prior !== DEPTH_SCENERY_ATLAS) throw new Error("Depth scenery atlas ID is already owned.");
  if (prior === DEPTH_SCENERY_ATLAS) return base;
  if (DEPTH_SCENERY_ATLAS.compressedBytes > 600 * 1024
    || DEPTH_SCENERY_ATLAS.decodedBytes > 6 * 1024 * 1024) throw new Error("Depth scenery asset budget exceeded.");
  // One shared bitmap is live alongside native foreground/background atlas bundles.
  // Preserve their allowance and account for exactly this independently capped addition.
  const addForEveryKit = (values: ProductionAssetManifest["budgets"]["activeCompressedBytes"], bytes: number): typeof values =>
    Object.freeze(Object.fromEntries(Object.entries(values).map(([kit, value]) => [kit, value + bytes]))) as typeof values;
  return Object.freeze({
    ...base,
    atlases: Object.freeze({ ...base.atlases, [DEPTH_SCENERY_ATLAS_ID]: DEPTH_SCENERY_ATLAS }),
    budgets: Object.freeze({
      ...base.budgets,
      activeCompressedMax: base.budgets.activeCompressedMax + DEPTH_SCENERY_ATLAS.compressedBytes,
      activeCompressedBytes: addForEveryKit(base.budgets.activeCompressedBytes, DEPTH_SCENERY_ATLAS.compressedBytes),
      exactPeakActiveDecodedBytes: addForEveryKit(base.budgets.exactPeakActiveDecodedBytes, DEPTH_SCENERY_ATLAS.decodedBytes),
    }),
  });
}
