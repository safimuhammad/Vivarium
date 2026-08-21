/**
 * Publish the approved Warm Springs "Great Terrace" (composition B) vocabulary as the
 * production `warm-springs-v1` art generation.
 *
 * The owner approved composition B on the pilot's own art
 * (`.superpowers/sdd/warm-springs-pilot-report.md` §10). That art already sits at
 * 143,126 B = 72.8 % of the 196,608 B per-kit ceiling with ~52 KB of headroom, and the
 * pilot report is explicit that the headroom is NOT to be spent. So this script does not
 * re-author a single pixel: it republishes the pilot's exact `terrain.png` / `scenery.png`
 * bytes, verified against the sha256 the pilot manifest already declares, and rewrites only
 * the MANIFEST — adding the `compressedBytes` / `decodedBytes` fields the production asset
 * descriptors require, which the pilot manifest expressed as `bytes` / `rgbaBytes`.
 *
 * Byte-identical art is the point: what ships is exactly what was approved by eye.
 *
 * Publication is atomic and content-addressed, exactly as
 * `build-nirvana-v3-valley-atlas.mjs` does it — staged in a `mkdtemp`, renamed into
 * `frontend/src/assets/renderer2d/regions/.warm-springs-v1-generations/<fingerprint>/`,
 * with a symlink swapped over `frontend/src/assets/renderer2d/regions/warm-springs-v1`.
 * The `spring-terraces` biome kit, `nirvana-v2` and `nirvana-v3` are never read or written.
 *
 * Usage: `node scripts/build-warm-springs-v1-atlas.mjs`
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
const SOURCE_DIRECTORY = path.join(FRONTEND_ROOT, "src/qa/warmSpringsPilot/assets");
const OUTPUT_DIRECTORY = path.join(
  FRONTEND_ROOT,
  "src/assets/renderer2d/regions/warm-springs-v1",
);

/** Per-kit region ceiling from the plan's Global Constraints (art + metadata). */
const REGION_KIT_CEILING_BYTES = 196_608;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Rewrite the pilot manifest into the production shape.
 *
 * Only the two `images` records change: `compressedBytes` (the on-disk PNG size) and
 * `decodedBytes` (`width * height * 4`) are added so the published manifest can be turned
 * straight into a `ProductionAtlasDescriptor`. Every other field — the frame ids, the
 * terrain grid, the scenery tuples, the corner-bit declaration, the material vocabulary —
 * is passed through untouched, because changing any of them would change the picture.
 */
function productionManifest(pilot, terrainBytes, sceneryBytes) {
  const image = (record, bytes, label) => {
    const digest = sha256(bytes);
    if (record.sha256 !== digest) {
      throw new Error(
        `Warm Springs ${label} art does not match the sha256 its pilot manifest declares `
        + `(manifest ${record.sha256}, file ${digest}). The approved art has drifted; stop.`,
      );
    }
    if (record.bytes !== bytes.length) {
      throw new Error(
        `Warm Springs ${label} manifest byte count ${record.bytes} does not match the `
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
  return {
    ...pilot,
    images: {
      terrain: image(pilot.images.terrain, terrainBytes, "terrain"),
      scenery: image(pilot.images.scenery, sceneryBytes, "scenery"),
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
    throw new Error(`Warm Springs publication requires exactly ${expected.join(", ")}`);
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

async function main() {
  const [pilotManifestText, terrainBytes, sceneryBytes] = await Promise.all([
    readFile(path.join(SOURCE_DIRECTORY, "atlas.json"), "utf8"),
    readFile(path.join(SOURCE_DIRECTORY, "terrain.png")),
    readFile(path.join(SOURCE_DIRECTORY, "scenery.png")),
  ]);
  const pilot = JSON.parse(pilotManifestText);
  const manifest = productionManifest(pilot, terrainBytes, sceneryBytes);
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
      `Warm Springs kit total ${totalBytes} B exceeds the ${REGION_KIT_CEILING_BYTES} B ceiling.`,
    );
  }

  const generationDirectory = await publishAtomically(files, OUTPUT_DIRECTORY);
  const frames = manifest.terrainGrid.ids.length + manifest.sceneryFrames.length;
  process.stdout.write([
    `frames:    ${frames} (${manifest.terrainGrid.ids.length} terrain + ${manifest.sceneryFrames.length} scenery)`,
    `terrain:   ${terrainBytes.length} B  ${manifest.images.terrain.sha256}`,
    `scenery:   ${sceneryBytes.length} B  ${manifest.images.scenery.sha256}`,
    `atlas:     ${manifestBytes.length} B  ${sha256(manifestBytes)}`,
    `total:     ${totalBytes} B = ${(totalBytes / REGION_KIT_CEILING_BYTES * 100).toFixed(2)} % of ${REGION_KIT_CEILING_BYTES}`,
    `published: ${path.relative(REPOSITORY_ROOT, generationDirectory)}`,
    `symlink:   ${path.relative(REPOSITORY_ROOT, OUTPUT_DIRECTORY)}`,
    "",
  ].join("\n"));
}

await main();
