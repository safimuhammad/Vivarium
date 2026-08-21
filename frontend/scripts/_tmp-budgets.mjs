import { PRODUCTION_ASSET_MANIFEST } from "../src/renderer2d/production/assets/productionManifest.ts";
const b = PRODUCTION_ASSET_MANIFEST.budgets;
process.stdout.write(JSON.stringify({
  coreCompressedBytes: b.coreCompressedBytes,
  exactCoreDecodedBytes: b.exactCoreDecodedBytes,
  regionMetadataCompressedBytes: b.regionMetadataCompressedBytes,
  regionMetadataDecodedBytes: b.regionMetadataDecodedBytes,
  regionCompressedBytes: b.regionCompressedBytes,
  activeCompressedBytes: b.activeCompressedBytes,
  exactPeakActiveDecodedBytes: b.exactPeakActiveDecodedBytes,
}, null, 2));
