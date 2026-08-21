import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertSliceContract } from "./assert-2d-slice-contract.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BASENAMES = [
  "native", "2x", "desktop", "mobile", "dialogue", "standing", "collapse", "ruin",
];
const ATLAS_NAMES = [
  "human-body-atlas.png",
  "human-face-atlas.png",
  "human-held-atlas.png",
  "shelter-slice-atlas.png",
  "nirvana-tile-atlas.png",
];

test("accepts the exact canonical eight-pair and five-atlas contract", async () => {
  const sandbox = await createSandbox();
  try {
    const result = await assertSliceContract({ repoRoot: sandbox });
    assert.equal(result.captures.length, 8);
    assert.equal(result.atlases.length, 5);
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
});

test("rejects changed image bytes", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    await writeFile(path.join(shots, "vivarium-2d-slice-native.png"), "changed");
  }, /image hash mismatch.*native/i);
});

test("rejects a changed sidecar hash", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    const file = path.join(shots, "vivarium-2d-slice-native.json");
    const sidecar = JSON.parse(await readFile(file, "utf8"));
    sidecar.image.sha256 = "0".repeat(64);
    await writeFile(file, `${JSON.stringify(sidecar)}\n`);
  }, /sidecar hash.*native/i);
});

test("rejects an omitted pair member", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    await unlink(path.join(shots, "vivarium-2d-slice-standing.json"));
  }, /missing canonical sidecar.*standing/i);
});

test("rejects extra canonical prefix pair members", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    await writeFile(path.join(shots, "vivarium-2d-slice-invented.json"), "{}\n");
  }, /unexpected canonical slice member.*invented/i);
});

test("rejects desktop or mobile extension substitution", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    const file = path.join(shots, "vivarium-2d-slice-desktop.json");
    const sidecar = JSON.parse(await readFile(file, "utf8"));
    sidecar.image.file = "vivarium-2d-slice-desktop.png";
    await writeFile(file, `${JSON.stringify(sidecar)}\n`);
    await copyFile(
      path.join(shots, "vivarium-2d-slice-desktop.jpeg"),
      path.join(shots, "vivarium-2d-slice-desktop.png"),
    );
    await unlink(path.join(shots, "vivarium-2d-slice-desktop.jpeg"));
  }, /desktop.*\.jpeg/i);
});

test("rejects non-desktop JPEG substitution", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    const file = path.join(shots, "vivarium-2d-slice-ruin.json");
    const sidecar = JSON.parse(await readFile(file, "utf8"));
    sidecar.image.file = "vivarium-2d-slice-ruin.jpeg";
    await writeFile(file, `${JSON.stringify(sidecar)}\n`);
    await copyFile(
      path.join(shots, "vivarium-2d-slice-ruin.png"),
      path.join(shots, "vivarium-2d-slice-ruin.jpeg"),
    );
    await unlink(path.join(shots, "vivarium-2d-slice-ruin.png"));
  }, /ruin.*\.png/i);
});

test("rejects a canonical image symlinked to scratchpad", async () => {
  await expectSandboxFailure(async ({ root, shots }) => {
    const image = path.join(shots, "vivarium-2d-slice-native.png");
    const scratch = path.join(root, "scratchpad", "substitute.png");
    await mkdir(path.dirname(scratch), { recursive: true });
    await copyFile(image, scratch);
    await unlink(image);
    await symlink(scratch, image);
  }, /escape|symlink|canonical shots/i);
});

test("rejects a stale final-review capture hash", async () => {
  await expectSandboxFailure(async ({ review }) => {
    const source = await readFile(review, "utf8");
    await writeFile(review, source.replace(
      "67b0f8cab75c4d2d231f4cba54cae3d3605c3c0fbc246ba9975ebafb9c151ed0",
      "f".repeat(64),
    ));
  }, /review hash.*native/i);
});

test("rejects changed atlas bytes", async () => {
  await expectSandboxFailure(async ({ atlases }) => {
    await writeFile(path.join(atlases, "human-face-atlas.png"), "changed");
  }, /atlas hash mismatch.*human-face/i);
});

test("rejects a stale atlas hash in a canonical sidecar", async () => {
  await expectSandboxFailure(async ({ shots }) => {
    const file = path.join(shots, "vivarium-2d-slice-dialogue.json");
    const sidecar = JSON.parse(await readFile(file, "utf8"));
    const face = sidecar.assets.exact.find(({ sourcePath }) => sourcePath.endsWith("human-face-atlas.png"));
    face.sha256 = "0".repeat(64);
    await writeFile(file, `${JSON.stringify(sidecar)}\n`);
  }, /sidecar atlas hash.*human-face.*dialogue/i);
});

test("rejects a missing final-review atlas row", async () => {
  await expectSandboxFailure(async ({ review }) => {
    const source = await readFile(review, "utf8");
    await writeFile(review, source.replace(/^\| `human-held-atlas\.png`.*\n/m, ""));
  }, /review.*atlas.*human-held|atlas.*review.*human-held/i);
});

async function expectSandboxFailure(mutate, pattern) {
  const root = await createSandbox();
  const paths = sandboxPaths(root);
  try {
    await mutate({ root, ...paths });
    await assert.rejects(assertSliceContract({ repoRoot: root }), pattern);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createSandbox() {
  const root = await mkdtemp(path.join(tmpdir(), "vivarium-slice-contract-"));
  const target = sandboxPaths(root);
  await Promise.all([
    mkdir(target.shots, { recursive: true }),
    mkdir(target.atlases, { recursive: true }),
    mkdir(path.dirname(target.review), { recursive: true }),
  ]);
  for (const basename of BASENAMES) {
    const sidecarName = `vivarium-2d-slice-${basename}.json`;
    await copyFile(
      path.join(REPO_ROOT, "docs/frontend/mockups/shots", sidecarName),
      path.join(target.shots, sidecarName),
    );
    const sidecar = JSON.parse(await readFile(path.join(target.shots, sidecarName), "utf8"));
    await copyFile(
      path.join(REPO_ROOT, "docs/frontend/mockups/shots", sidecar.image.file),
      path.join(target.shots, sidecar.image.file),
    );
  }
  for (const name of ATLAS_NAMES) {
    await copyFile(
      path.join(REPO_ROOT, "frontend/src/assets/renderer2d", name),
      path.join(target.atlases, name),
    );
  }
  await copyFile(
    path.join(REPO_ROOT, ".superpowers/sdd/2d-slice-final-review.md"),
    target.review,
  );
  return root;
}

function sandboxPaths(root) {
  return {
    shots: path.join(root, "docs/frontend/mockups/shots"),
    atlases: path.join(root, "frontend/src/assets/renderer2d"),
    review: path.join(root, ".superpowers/sdd/2d-slice-final-review.md"),
  };
}
