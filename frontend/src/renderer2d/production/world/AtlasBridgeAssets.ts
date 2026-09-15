/** Shared bridge materials with their own bounded, verified production asset allowance. */
import type { ProductionAssetManifest, ProductionAtlasDescriptor } from "../assets/productionManifest";

export const ATLAS_BRIDGE_MATERIALS_ID = "atlas-bridge-materials-v1";
export const ATLAS_BRIDGE_MATERIALS: ProductionAtlasDescriptor = Object.freeze({
  id: ATLAS_BRIDGE_MATERIALS_ID,
  url: Object.freeze({ href: new URL("../../../assets/renderer2d/atlas-bridge-materials-v1.webp", import.meta.url).href }),
  group: "region", regionKit: null,
  width: 1024, height: 1024, cellWidth: 512, cellHeight: 512, columns: 2, rows: 2,
  compressedBytes: 271056, decodedBytes: 4194304,
  sha256: "3a543e488b75550d142c280cfba828c6ac60c458548e17e22286003c4329e2bc",
});

/** Register one shared bridge texture without changing the certified native atlas allowance. */
export function withAtlasBridgeManifest(base: ProductionAssetManifest): ProductionAssetManifest {
  const prior = base.atlases[ATLAS_BRIDGE_MATERIALS_ID];
  if (prior === ATLAS_BRIDGE_MATERIALS) return base;
  if (prior !== undefined) throw new Error("Atlas bridge material ID is already owned.");
  const add = (values: ProductionAssetManifest["budgets"]["activeCompressedBytes"], bytes: number): typeof values =>
    Object.freeze(Object.fromEntries(Object.entries(values).map(([kit, value]) => [kit, value + bytes]))) as typeof values;
  return Object.freeze({
    ...base,
    atlases: Object.freeze({ ...base.atlases, [ATLAS_BRIDGE_MATERIALS_ID]: ATLAS_BRIDGE_MATERIALS }),
    budgets: Object.freeze({
      ...base.budgets,
      activeCompressedMax: base.budgets.activeCompressedMax + ATLAS_BRIDGE_MATERIALS.compressedBytes,
      activeCompressedBytes: add(base.budgets.activeCompressedBytes, ATLAS_BRIDGE_MATERIALS.compressedBytes),
      exactPeakActiveDecodedBytes: add(base.budgets.exactPeakActiveDecodedBytes, ATLAS_BRIDGE_MATERIALS.decodedBytes),
    }),
  });
}
