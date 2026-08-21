/**
 * Publish the freshly authored Nirvana West "ash-waste" vocabulary as the production
 * `nirvana-west-v1` art generation.
 *
 * The staged art at `frontend/src/assets/renderer2d/regions/.nirvana-west-v1-staging/`
 * is already the approved, final pixels — this script does not re-author a single
 * pixel. It republishes the staged `terrain.png` / `scenery.png` bytes verified against
 * the sha256 the staged manifest already declares, and rewrites only the MANIFEST —
 * adding the `compressedBytes` / `decodedBytes` fields the production asset descriptors
 * require, which the staged manifest expresses as `bytes` (plus the authoring-only
 * `rgbaBytes` / `indexedBytes`, both dropped as redundant with `decodedBytes`).
 *
 * Byte-identical art is the point: what ships is exactly what was staged for approval.
 *
 * Publication is atomic and content-addressed, exactly as `build-warm-springs-v1-atlas.mjs`
 * does it — staged in a `mkdtemp`, renamed into
 * `frontend/src/assets/renderer2d/regions/.nirvana-west-v1-generations/<fingerprint>/`,
 * with a symlink swapped over `frontend/src/assets/renderer2d/regions/nirvana-west-v1`.
 *
 * ## The one thing Warm Springs never had to do: kit art
 *
 * `environment.png` in the staging directory is NOT exact-region art — it is BIOME KIT
 * art. `nirvana_west` is the only region that resolves to the `ash-waste` archetype
 * (`config/world.yaml` describes it as "a nuclear wasteland, all but dead"), so this is
 * the one, reversible, recorded place the animated fire is allowed to overwrite the
 * kit's own `src/assets/renderer2d/regions/ash-waste/environment.png` and rebalance that
 * kit's `pack.json` `ash-waste-environment` descriptor. Geometry (256x128, 8x4 cells of
 * 32px) does not move, so `width`/`height`/`cellWidth`/`cellHeight`/`columns`/`rows` are
 * left untouched — only `compressedBytes` and `sha256` change. This step is explicit,
 * separately logged, and skippable with `--skip-kit-environment`.
 *
 * Usage: `node scripts/build-nirvana-west-v1-atlas.mjs [--skip-kit-environment]`
 */

import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(MODULE_ROOT, "..");
const REPOSITORY_ROOT = path.resolve(FRONTEND_ROOT, "..");
const STAGING_DIRECTORY = path.join(
  FRONTEND_ROOT,
  "src/assets/renderer2d/regions/.nirvana-west-v1-staging",
);
const OUTPUT_DIRECTORY = path.join(
  FRONTEND_ROOT,
  "src/assets/renderer2d/regions/nirvana-west-v1",
);
const KIT_DIRECTORY = path.join(FRONTEND_ROOT, "src/assets/renderer2d/regions/ash-waste");
const KIT_ENVIRONMENT_PATH = path.join(KIT_DIRECTORY, "environment.png");
const KIT_PACK_PATH = path.join(KIT_DIRECTORY, "pack.json");
const KIT_ENVIRONMENT_ATLAS_ID = "ash-waste-environment";

/** Per-kit region ceiling from the plan's Global Constraints (art + metadata). */
const REGION_KIT_CEILING_BYTES = 196_608;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Guard against publishing from the wrong source.
 *
 * Nirvana West has an older, unrelated pilot vocabulary (`brine`/`rime`, 7-field
 * scenery tuples, no measured ground contact) sitting elsewhere in the tree. Publishing
 * from the wrong directory would ship art the terrain field and the footprint system
 * cannot use. Fail loudly rather than silently publishing a lookalike manifest.
 */
function assertStagedManifestShape(staged) {
  if (!Array.isArray(staged.materials) || !staged.materials.includes("slab")
    || !staged.materials.includes("spoil")) {
    throw new Error(
      "Nirvana West staged manifest is missing the industrial ground materials "
      + `("slab", "spoil") — got materials [${(staged.materials ?? []).join(", ")}]. `
      + "This looks like the wrong source directory.",
    );
  }
  if (staged.materials.includes("brine") || staged.materials.includes("rime")) {
    throw new Error(
      'Nirvana West staged manifest declares "brine"/"rime" — that vocabulary belongs '
      + "to an older, unrelated pilot. Publishing from the wrong source directory.",
    );
  }
  if (!Array.isArray(staged.sceneryFrames) || staged.sceneryFrames.length === 0) {
    throw new Error("Nirvana West staged manifest must publish scenery frames.");
  }
  staged.sceneryFrames.forEach((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 11) {
      throw new Error(
        `Nirvana West staged scenery frame ${index} has ${Array.isArray(candidate) ? candidate.length : typeof candidate} `
        + "fields; the production tuple is 11 fields "
        + "(id,x,y,w,h,pivotX,pivotY,contactX,contactY,contactW,contactH). A 7-field tuple "
        + "is the old pilot shape and has no measured ground contact — reject it.",
      );
    }
  });
}

/**
 * Rewrite the staged manifest into the production shape.
 *
 * Only the two `images` records change: `compressedBytes` (the on-disk PNG size) and
 * `decodedBytes` (`width * height * 4`) are added so the published manifest can be
 * turned straight into a `ProductionAtlasDescriptor`. Every other field — the frame
 * ids, the terrain grid, the scenery tuples (including the 11-field ground-contact
 * tuples), the corner-bit declaration, the material vocabulary — is passed through
 * untouched, because changing any of them would change the picture.
 *
 * `images.environment` is DROPPED entirely: the animated sheet is kit art, published
 * separately below, and leaving a stale copy of its byte accounting inside the exact
 * region manifest would be a second source of truth for the same bytes.
 */
function productionManifest(staged, terrainBytes, sceneryBytes) {
  const image = (record, bytes, label) => {
    const digest = sha256(bytes);
    if (record.sha256 !== digest) {
      throw new Error(
        `Nirvana West ${label} art does not match the sha256 its staged manifest declares `
        + `(manifest ${record.sha256}, file ${digest}). The staged art has drifted; stop.`,
      );
    }
    if (record.bytes !== bytes.length) {
      throw new Error(
        `Nirvana West ${label} manifest byte count ${record.bytes} does not match the `
        + `${bytes.length} bytes on disk.`,
      );
    }
    return {
      file: record.file,
      width: record.width,
      height: record.height,
      colours: record.colours,
      encoding: record.encoding,
      compressedBytes: bytes.length,
      decodedBytes: record.width * record.height * 4,
      sha256: digest,
    };
  };
  const { environment: _environment, ...images } = staged.images;
  // `environmentGrid` goes with it. Both describe the per-KIT animated sheet, which lives
  // at `regions/ash-waste/environment.png` and is published separately; carrying a copy of
  // its metadata inside the exact region manifest would be a second source of truth for
  // bytes this generation does not own, and would declare an image with no file beside it.
  const { environmentGrid: _environmentGrid, ...rest } = staged;
  return {
    ...rest,
    images: {
      terrain: image(images.terrain, terrainBytes, "terrain"),
      scenery: image(images.scenery, sceneryBytes, "scenery"),
    },
  };
}

function generationFingerprint(files) {
  const hash = createHash("sha256");
  for (const { name, bytes } of [...files].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    hash.update(name).update("\0").update(sha256(bytes)).update("\0");
  }
  return hash.digest("hex");
}

async function pathMetadata(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

/** Stage, content-address, and symlink-swap one generation without touching any other. */
async function publishAtomically(files, outputDirectory) {
  const expected = ["atlas.json", "scenery.png", "terrain.png"];
  const names = files.map(({ name }) => name).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error(`Nirvana West publication requires exactly ${expected.join(", ")}`);
  }
  const outputParent = path.dirname(outputDirectory);
  const outputName = path.basename(outputDirectory);
  const generationsDirectory = path.join(outputParent, `.${outputName}-generations`);
  await mkdir(outputParent, { recursive: true });

  const currentOutput = await pathMetadata(outputDirectory);
  if (currentOutput !== null && !currentOutput.isSymbolicLink()) {
    throw new Error(
      `Atomic publication requires ${outputDirectory} to be absent or a symbolic link.`,
    );
  }
  await mkdir(generationsDirectory, { recursive: true });
  const staged = await mkdtemp(path.join(generationsDirectory, ".staging-"));
  let stagedOwned = true;
  let stagedLinkDirectory = null;
  try {
    await Promise.all(files.map(({ name, bytes }) => (
      writeFile(path.join(staged, name), bytes, { flag: "wx" })
    )));
    const generationDirectory = path.join(generationsDirectory, generationFingerprint(files));
    try {
      await rename(staged, generationDirectory);
      stagedOwned = false;
    } catch (error) {
      if (!error || typeof error !== "object" || !["EEXIST", "ENOTEMPTY"].includes(error.code)) {
        throw error;
      }
      const existing = await pathMetadata(generationDirectory);
      if (existing === null || !existing.isDirectory()) throw error;
    }
    stagedLinkDirectory = await mkdtemp(path.join(outputParent, `.${outputName}-link-`));
    const stagedLink = path.join(stagedLinkDirectory, "current");
    await symlink(path.relative(outputParent, generationDirectory), stagedLink, "dir");
    await rename(stagedLink, outputDirectory);
    return generationDirectory;
  } finally {
    if (stagedOwned) await rm(staged, { recursive: true, force: true });
    if (stagedLinkDirectory !== null) {
      await rm(stagedLinkDirectory, { recursive: true, force: true });
    }
  }
}

/** Serialise the ash-waste pack exactly as it is stored: compact JSON plus one newline. */
function serialiseKitPack(pack) {
  return Buffer.from(`${JSON.stringify(pack)}\n`, "utf8");
}

/**
 * Solve the ash-waste pack's `metadataBytes` for its own serialised length.
 *
 * The field counts the bytes of the object that contains it, so writing a new value can
 * change the length again. In practice this settles in one or two iterations; the loop
 * is bounded and throws rather than spinning if it ever does not converge.
 */
function solveKitMetadataBytes(pack) {
  let candidate = { ...pack };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const length = serialiseKitPack(candidate).length;
    if (candidate.metadataBytes === length) return candidate;
    candidate = { ...candidate, metadataBytes: length };
  }
  throw new Error("ash-waste pack.json metadataBytes did not converge.");
}

/**
 * Publish the staged `environment.png` into the `ash-waste` kit and rebalance its
 * `pack.json` `ash-waste-environment` descriptor.
 *
 * Mutates `KIT_ENVIRONMENT_PATH` and `KIT_PACK_PATH` in place (this is kit art, owned
 * outside the content-addressed region generation, so there is no symlink to swap).
 * Geometry is asserted unchanged before anything is written; only `compressedBytes` and
 * `sha256` move.
 *
 * @param staged - The parsed staged `atlas.json`, for its `images.environment` record.
 * @returns A before/after report for both files, for the console summary.
 */
async function publishKitEnvironment(staged) {
  const record = staged.images.environment;
  const environmentBytes = await readFile(path.join(STAGING_DIRECTORY, "environment.png"));
  const digest = sha256(environmentBytes);
  if (record.sha256 !== digest) {
    throw new Error(
      `Nirvana West environment art does not match the sha256 its staged manifest declares `
      + `(manifest ${record.sha256}, file ${digest}). The staged art has drifted; stop.`,
    );
  }
  if (record.bytes !== environmentBytes.length) {
    throw new Error(
      `Nirvana West environment manifest byte count ${record.bytes} does not match the `
      + `${environmentBytes.length} bytes on disk.`,
    );
  }

  const previousEnvironmentBytes = await readFile(KIT_ENVIRONMENT_PATH);
  const pack = JSON.parse(await readFile(KIT_PACK_PATH, "utf8"));
  const descriptor = pack.atlases.find(({ id }) => id === KIT_ENVIRONMENT_ATLAS_ID);
  if (descriptor === undefined) {
    throw new Error(`ash-waste pack.json has no ${KIT_ENVIRONMENT_ATLAS_ID} descriptor.`);
  }
  if (descriptor.width !== record.width || descriptor.height !== record.height) {
    throw new Error(
      `ash-waste ${KIT_ENVIRONMENT_ATLAS_ID} geometry (${descriptor.width}x${descriptor.height}) `
      + `does not match the staged environment sheet (${record.width}x${record.height}). Geometry `
      + "must stay identical; this script only republishes pixels and byte accounting.",
    );
  }
  const previousCompressedBytes = descriptor.compressedBytes;
  const previousSha256 = descriptor.sha256;
  descriptor.compressedBytes = environmentBytes.length;
  descriptor.sha256 = digest;
  const settled = solveKitMetadataBytes(pack);

  await writeFile(KIT_ENVIRONMENT_PATH, environmentBytes);
  await writeFile(KIT_PACK_PATH, serialiseKitPack(settled));

  return {
    environment: {
      previousBytes: previousEnvironmentBytes.length,
      previousSha256: sha256(previousEnvironmentBytes),
      bytes: environmentBytes.length,
      sha256: digest,
    },
    pack: {
      previousCompressedBytes,
      previousSha256,
      compressedBytes: descriptor.compressedBytes,
      sha256: descriptor.sha256,
      previousMetadataBytes: pack.metadataBytes,
      metadataBytes: settled.metadataBytes,
    },
  };
}

async function main() {
  const skipKitEnvironment = process.argv.includes("--skip-kit-environment");

  const [stagedManifestText, terrainBytes, sceneryBytes] = await Promise.all([
    readFile(path.join(STAGING_DIRECTORY, "atlas.json"), "utf8"),
    readFile(path.join(STAGING_DIRECTORY, "terrain.png")),
    readFile(path.join(STAGING_DIRECTORY, "scenery.png")),
  ]);
  const staged = JSON.parse(stagedManifestText);
  assertStagedManifestShape(staged);
  const manifest = productionManifest(staged, terrainBytes, sceneryBytes);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest)}\n`, "utf8");

  const files = [
    { name: "terrain.png", bytes: terrainBytes },
    { name: "scenery.png", bytes: sceneryBytes },
    { name: "atlas.json", bytes: manifestBytes },
  ];
  const artBytes = terrainBytes.length + sceneryBytes.length;
  const totalBytes = artBytes + manifestBytes.length;
  if (totalBytes > REGION_KIT_CEILING_BYTES) {
    throw new Error(
      `Nirvana West kit total ${totalBytes} B exceeds the ${REGION_KIT_CEILING_BYTES} B ceiling.`,
    );
  }

  const generationDirectory = await publishAtomically(files, OUTPUT_DIRECTORY);
  const frames = manifest.terrainGrid.ids.length + manifest.sceneryFrames.length;
  const lines = [
    `frames:    ${frames} (${manifest.terrainGrid.ids.length} terrain + ${manifest.sceneryFrames.length} scenery)`,
    `terrain:   ${terrainBytes.length} B  ${manifest.images.terrain.sha256}`,
    `scenery:   ${sceneryBytes.length} B  ${manifest.images.scenery.sha256}`,
    `atlas:     ${manifestBytes.length} B  ${sha256(manifestBytes)}`,
    `total:     ${totalBytes} B = ${(totalBytes / REGION_KIT_CEILING_BYTES * 100).toFixed(2)} % of ${REGION_KIT_CEILING_BYTES}`,
    `headroom:  ${REGION_KIT_CEILING_BYTES - totalBytes} B`,
    `published: ${path.relative(REPOSITORY_ROOT, generationDirectory)}`,
    `symlink:   ${path.relative(REPOSITORY_ROOT, OUTPUT_DIRECTORY)}`,
    "",
  ];

  if (skipKitEnvironment) {
    lines.push(
      "ash-waste/environment.png: skipped (--skip-kit-environment)",
      "ash-waste/pack.json:       skipped (--skip-kit-environment)",
      "",
    );
  } else {
    const kit = await publishKitEnvironment(staged);
    lines.push(
      "ash-waste/environment.png  (biome kit art, published separately from the region)",
      `  before: ${kit.environment.previousBytes} B  ${kit.environment.previousSha256}`,
      `  after:  ${kit.environment.bytes} B  ${kit.environment.sha256}`,
      "ash-waste/pack.json  (ash-waste-environment descriptor)",
      `  compressedBytes: ${kit.pack.previousCompressedBytes} -> ${kit.pack.compressedBytes}`,
      `  sha256:          ${kit.pack.previousSha256} -> ${kit.pack.sha256}`,
      `  metadataBytes:   ${kit.pack.previousMetadataBytes} -> ${kit.pack.metadataBytes}`,
      "",
    );
  }

  process.stdout.write(lines.join("\n"));
}

await main();
