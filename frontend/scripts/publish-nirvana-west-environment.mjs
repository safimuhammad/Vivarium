/**
 * Publish the approved Nirvana West animated FIRE into the `ash-waste` biome kit's
 * own `environment.png`, and re-balance that kit's `pack.json` descriptor.
 *
 * ## Why this is kit art and not exact-presentation art
 *
 * Every other piece of this region's approved vocabulary ships as the exact
 * `nirvana-west-v1` generation, which no other region can see. The animated layer
 * cannot: the production binding is per-KIT and purely ORDINAL —
 * `RegionAssetPackManifest.animatedFrames` is built as
 * `kit.animatedKinds.map((kind, i) => frame(`${kit}-environment`, i * 4, 8, 32, 32))`
 * (`productionManifest.ts:929-932`), and `validateProductionManifest` requires every
 * animated frame to live in the atlas literally named `${kit}-environment`
 * (`:1513-1516`). There is no frame-name table and no per-region override, so the only
 * place the fire can physically live is `regions/ash-waste/environment.png`.
 *
 * That is acceptable here for a reason worth stating: **`ash-waste` is Nirvana West's
 * kit and nothing else's.** `RegionMapIdentity` routes to the `ash_waste` archetype on
 * the phrase "a nuclear wasteland, all but dead" (`RegionMapIdentity.ts:33`), and
 * `config/world.yaml` gives that description to exactly one region. Warm Springs
 * deliberately never touched its kit's art; this region has to, and this script is the
 * single, reversible, recorded place where it happens.
 *
 * ## What changes, exactly
 *
 * 1. `src/assets/renderer2d/regions/ash-waste/environment.png` — replaced. Geometry is
 *    UNCHANGED at 256 x 128 = 8 x 4 cells of 32 px, so `decodedBytes` does not move and
 *    the cell -> rect arithmetic is untouched. Cells 0-3 are `ember`, cells 4-7 are
 *    `smoke-anchor`, matching `biomeKits.ts:163`'s declared order.
 * 2. `src/assets/renderer2d/regions/ash-waste/pack.json` — the ONE descriptor entry for
 *    `ash-waste-environment` has its `compressedBytes` and `sha256` updated. Nothing
 *    else in the file is touched.
 *
 * `metadataBytes` inside that file is self-referential (it equals the compact
 * serialisation length plus its trailing newline), so it is solved to a fixpoint rather
 * than hand-edited. Nothing reads the field — `productionManifest.ts` recomputes the
 * real number from the parsed object every time — but leaving it stale would be a lie
 * sitting in a data file.
 *
 * Usage: `node scripts/publish-nirvana-west-environment.mjs`
 * Rollback: restore both files from
 * `scratchpad/nirvana-west-live/rollback/rollback-to-old-nirvana-west.tar`.
 */

import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authorNirvanaWestProductionArt } from "./author-nirvana-west-production-art.mjs";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const KIT_DIRECTORY = path.join(FRONTEND_ROOT, "src/assets/renderer2d/regions/ash-waste");
const ENVIRONMENT_PATH = path.join(KIT_DIRECTORY, "environment.png");
const PACK_PATH = path.join(KIT_DIRECTORY, "pack.json");
const ENVIRONMENT_ATLAS_ID = "ash-waste-environment";

/** The kit's animated sheet budget. The whole fire has to fit inside this. */
const ENVIRONMENT_BUDGET_BYTES = 16_384;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Serialise the pack exactly as it is stored: compact JSON plus one newline. */
function serialise(pack) {
  return Buffer.from(`${JSON.stringify(pack)}\n`, "utf8");
}

/**
 * Solve `metadataBytes` for its own serialised length.
 *
 * The field counts the bytes of the object that contains it, so writing a new value can
 * change the length again. In practice this settles in one or two iterations; the loop
 * is bounded and throws rather than spinning if it ever does not converge.
 */
function solveMetadataBytes(pack) {
  let candidate = { ...pack };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const length = serialise(candidate).length;
    if (candidate.metadataBytes === length) return candidate;
    candidate = { ...candidate, metadataBytes: length };
  }
  throw new Error("ash-waste pack.json metadataBytes did not converge.");
}

async function main() {
  const staging = await mkdtemp(path.join(tmpdir(), "nirvana-west-environment-"));
  let environmentBytes;
  try {
    const authored = await authorNirvanaWestProductionArt(staging);
    const kinds = authored.environmentGrid.kinds;
    if (kinds.length !== 2 || kinds[0] !== "ember" || kinds[1] !== "smoke-anchor") {
      throw new Error(
        `ash-waste declares ["ember","smoke-anchor"]; the authored sheet declares `
        + `[${kinds.map((kind) => `"${kind}"`).join(",")}]. The binding is ordinal, so a `
        + "mismatched order would draw the wrong art for every placement.",
      );
    }
    if (authored.images.environment.width !== 256 || authored.images.environment.height !== 128) {
      throw new Error("ash-waste environment geometry must stay 256x128 (8x4 cells of 32px).");
    }
    environmentBytes = await readFile(path.join(staging, "environment.png"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  if (environmentBytes.length > ENVIRONMENT_BUDGET_BYTES) {
    throw new Error(
      `ash-waste environment sheet ${environmentBytes.length} B exceeds its `
      + `${ENVIRONMENT_BUDGET_BYTES} B budget.`,
    );
  }

  const previousBytes = await readFile(ENVIRONMENT_PATH);
  const pack = JSON.parse(await readFile(PACK_PATH, "utf8"));
  const descriptor = pack.atlases.find(({ id }) => id === ENVIRONMENT_ATLAS_ID);
  if (descriptor === undefined) throw new Error(`ash-waste pack.json has no ${ENVIRONMENT_ATLAS_ID}.`);
  if (descriptor.width !== 256 || descriptor.height !== 128) {
    throw new Error("ash-waste environment descriptor geometry is not the expected 256x128.");
  }
  const previousCompressed = descriptor.compressedBytes;
  const previousSha = descriptor.sha256;
  descriptor.compressedBytes = environmentBytes.length;
  descriptor.sha256 = sha256(environmentBytes);
  const settled = solveMetadataBytes(pack);

  await writeFile(ENVIRONMENT_PATH, environmentBytes);
  await writeFile(PACK_PATH, serialise(settled));

  process.stdout.write([
    "ash-waste/environment.png",
    `  before: ${previousBytes.length} B  ${sha256(previousBytes)}`,
    `  after:  ${environmentBytes.length} B  ${descriptor.sha256}`,
    "ash-waste/pack.json  (one descriptor entry)",
    `  compressedBytes: ${previousCompressed} -> ${descriptor.compressedBytes}`,
    `  sha256:          ${previousSha.slice(0, 16)}… -> ${descriptor.sha256.slice(0, 16)}…`,
    `  metadataBytes:   ${pack.metadataBytes} -> ${settled.metadataBytes}`,
    `  budget:          ${environmentBytes.length} / ${ENVIRONMENT_BUDGET_BYTES} B`,
    "",
  ].join("\n"));
}

await main();
