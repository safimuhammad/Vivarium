import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURES = Object.freeze([
  ["native", "png"],
  ["2x", "png"],
  ["desktop", "jpeg"],
  ["mobile", "jpeg"],
  ["dialogue", "png"],
  ["standing", "png"],
  ["collapse", "png"],
  ["ruin", "png"],
]);

const ATLAS_NAMES = Object.freeze([
  "human-body-atlas.png",
  "human-face-atlas.png",
  "human-held-atlas.png",
  "shelter-slice-atlas.png",
  "nirvana-tile-atlas.png",
]);

const SHA256 = /^[0-9a-f]{64}$/;

/** Validate the approved 2D slice captures and atlases against sidecars and review. */
export async function assertSliceContract({ repoRoot }) {
  const root = path.resolve(repoRoot);
  const shots = path.join(root, "docs/frontend/mockups/shots");
  const atlasRoot = path.join(root, "frontend/src/assets/renderer2d");
  const reviewPath = path.join(root, ".superpowers/sdd/2d-slice-final-review.md");
  const review = await readFile(reviewPath, "utf8");
  const reviewCaptureHashes = parseReviewCaptureHashes(review);
  const reviewAtlasHashes = parseReviewAtlasHashes(review);
  for (const name of ATLAS_NAMES) {
    if (!reviewAtlasHashes.has(name)) {
      throw new Error(`Final review atlas table is missing ${name}`);
    }
  }
  const expectedMembers = new Set(CAPTURES.flatMap(([basename, extension]) => [
    `vivarium-2d-slice-${basename}.json`,
    `vivarium-2d-slice-${basename}.${extension}`,
  ]));
  const actualMembers = (await readdir(shots)).filter((name) => (
    /^vivarium-2d-slice-.*\.(?:json|png|jpe?g)$/i.test(name)
  ));
  for (const member of actualMembers) {
    if (!expectedMembers.has(member)) {
      const knownCapture = CAPTURES.find(([basename]) => member.startsWith(`vivarium-2d-slice-${basename}.`));
      if (knownCapture !== undefined) {
        throw new Error(`${knownCapture[0]} must use .${knownCapture[1]}; received ${member}`);
      }
      throw new Error(`Unexpected canonical slice member: ${member}`);
    }
  }

  const captures = [];
  for (const [basename, extension] of CAPTURES) {
    const sidecarName = `vivarium-2d-slice-${basename}.json`;
    const expectedImageName = `vivarium-2d-slice-${basename}.${extension}`;
    if (!actualMembers.includes(sidecarName)) {
      throw new Error(`Missing canonical sidecar for ${basename}: ${sidecarName}`);
    }
    if (!actualMembers.includes(expectedImageName)) {
      throw new Error(`Missing canonical image for ${basename}: ${expectedImageName}`);
    }
    const sidecar = parseObject(
      JSON.parse(await readFile(path.join(shots, sidecarName), "utf8")),
      `${basename} sidecar`,
    );
    const image = parseObject(sidecar.image, `${basename} sidecar image`);
    if (image.file !== expectedImageName) {
      throw new Error(`${basename} must declare ${expectedImageName}; received ${String(image.file)}`);
    }
    const imagePath = path.join(shots, expectedImageName);
    await assertCanonicalRegularFile(imagePath, shots, `${basename} image`);
    const actualHash = hash(await readFile(imagePath));
    const sidecarHash = hashString(image.sha256, `${basename} sidecar hash`);
    const reviewHash = reviewCaptureHashes.get(expectedImageName);
    if (reviewHash === undefined) {
      throw new Error(`Final review is missing capture hash for ${basename}`);
    }
    if (actualHash === sidecarHash && actualHash !== reviewHash) {
      throw new Error(`Review hash mismatch for ${basename}: actual ${actualHash}, review ${reviewHash}`);
    }
    if (actualHash === reviewHash && actualHash !== sidecarHash) {
      throw new Error(`Sidecar hash mismatch for ${basename} image: sidecar ${sidecarHash}, review ${reviewHash}`);
    }
    if (actualHash !== sidecarHash) {
      throw new Error(`Image hash mismatch for ${basename}: actual ${actualHash}, sidecar ${sidecarHash}`);
    }
    if (actualHash !== reviewHash) {
      throw new Error(`Review hash mismatch for ${basename}: actual ${actualHash}, review ${reviewHash}`);
    }
    validateSidecarAtlasHashes(sidecar, basename, reviewAtlasHashes);
    captures.push(Object.freeze({ basename, image: expectedImageName, sha256: actualHash }));
  }

  if (reviewCaptureHashes.size !== CAPTURES.length) {
    throw new Error(`Final review must contain exactly ${CAPTURES.length} canonical capture hashes`);
  }

  const atlases = [];
  for (const name of ATLAS_NAMES) {
    const atlasPath = path.join(atlasRoot, name);
    await assertCanonicalRegularFile(atlasPath, atlasRoot, `${name} atlas`);
    const actualHash = hash(await readFile(atlasPath));
    const reviewHash = reviewAtlasHashes.get(name);
    if (reviewHash === undefined) {
      throw new Error(`Final review atlas table is missing ${name}`);
    }
    if (actualHash !== reviewHash) {
      throw new Error(`Atlas hash mismatch for ${name}: actual ${actualHash}, review ${reviewHash}`);
    }
    atlases.push(Object.freeze({ name, sha256: actualHash }));
  }
  if (reviewAtlasHashes.size !== ATLAS_NAMES.length) {
    throw new Error(`Final review must contain exactly ${ATLAS_NAMES.length} frozen atlas hashes`);
  }

  return Object.freeze({ captures: Object.freeze(captures), atlases: Object.freeze(atlases) });
}

function parseReviewCaptureHashes(review) {
  const hashes = new Map();
  for (const match of review.matchAll(
    /^\| `scratchpad\/2d-slice-task10-captures\/(vivarium-2d-slice-[^`]+\.(?:png|jpeg))` \| `([0-9a-f]{64})` \|$/gm,
  )) {
    if (hashes.has(match[1])) throw new Error(`Final review duplicates capture row ${match[1]}`);
    hashes.set(match[1], match[2]);
  }
  return hashes;
}

function parseReviewAtlasHashes(review) {
  const hashes = new Map();
  for (const match of review.matchAll(
    /^\| `((?:human-body|human-face|human-held|shelter-slice|nirvana-tile)-atlas\.png)` \| `[^`]+` \| `[^`]+` \| `([0-9a-f]{64})` \|$/gm,
  )) {
    if (hashes.has(match[1])) throw new Error(`Final review duplicates atlas row ${match[1]}`);
    hashes.set(match[1], match[2]);
  }
  return hashes;
}

function validateSidecarAtlasHashes(sidecar, basename, reviewAtlasHashes) {
  const assets = parseObject(sidecar.assets, `${basename} sidecar assets`);
  if (!Array.isArray(assets.exact)) {
    throw new Error(`${basename} sidecar assets.exact must be an array`);
  }
  const hashes = new Map();
  for (const value of assets.exact) {
    const item = parseObject(value, `${basename} sidecar atlas item`);
    if (typeof item.sourcePath !== "string") continue;
    const name = path.posix.basename(item.sourcePath);
    if (!ATLAS_NAMES.includes(name)) continue;
    if (hashes.has(name)) throw new Error(`${basename} sidecar duplicates atlas ${name}`);
    hashes.set(name, hashString(item.sha256, `${basename} ${name} sidecar atlas hash`));
  }
  for (const name of ATLAS_NAMES) {
    const sidecarHash = hashes.get(name);
    const reviewHash = reviewAtlasHashes.get(name);
    if (sidecarHash === undefined) throw new Error(`${basename} sidecar is missing atlas ${name}`);
    if (reviewHash === undefined || sidecarHash !== reviewHash) {
      throw new Error(`Sidecar atlas hash mismatch for ${name} in ${basename}`);
    }
  }
}

async function assertCanonicalRegularFile(file, owner, label) {
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink()) throw new Error(`${label} must not be a symlink escape from canonical shots`);
  if (!metadata.isFile()) throw new Error(`${label} must be a regular file`);
  const [resolvedFile, resolvedOwner] = await Promise.all([realpath(file), realpath(owner)]);
  if (resolvedFile !== resolvedOwner && !resolvedFile.startsWith(`${resolvedOwner}${path.sep}`)) {
    throw new Error(`${label} escapes its canonical directory`);
  }
}

function parseObject(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function hashString(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
  return value;
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

const isCli = process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  try {
    const result = await assertSliceContract({ repoRoot });
    console.log(`2D slice contract ok: captures=${result.captures.length}, atlases=${result.atlases.length}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
