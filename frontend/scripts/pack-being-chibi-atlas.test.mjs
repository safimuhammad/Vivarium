import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, mkdtemp, rm, unlink } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

import {
  buildAtlas,
  buildCharacterGroup,
  CHARACTER_IDS,
  FEET,
  FRAME_HEIGHT,
  FRAME_WIDTH,
  IDLE_FRAME,
  OUTPUT_JSON,
  OUTPUT_PNG,
  serializeJson,
  sourceDirFor,
} from "./pack-being-chibi-atlas.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST_SOURCE = path.join(ROOT, "frontend/src/renderer2d/production/assets/productionManifest.ts");
const MAX_COMPRESSED_BYTES = 40 * 1024;

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

test("packs all 7 characters, each with the exact 17-frame schema, under a shared global envelope", async () => {
  const { json } = await buildAtlas();
  assert.equal(json.frameWidth, FRAME_WIDTH);
  assert.equal(json.frameHeight, FRAME_HEIGHT);
  assert.deepEqual(json.feet, FEET);

  assert.equal(Object.keys(json.characters).length, 7, "expected exactly 7 packed characters");
  assert.deepEqual(Object.keys(json.characters).sort(), [...CHARACTER_IDS].sort());

  for (const characterId of CHARACTER_IDS) {
    const group = json.characters[characterId];
    assert.ok(group, `characters is missing ${characterId}`);
    assert.equal(group.idleFrame, IDLE_FRAME, `${characterId}.idleFrame mismatch`);

    const walkKeys = Object.keys(group.frames).filter((key) => key.startsWith("walk-"));
    const poseKeys = Object.keys(group.frames).filter((key) => key.startsWith("pose-"));
    assert.equal(walkKeys.length, 12, `${characterId}: expected 12 walk frames (3 directions x 4 frames)`);
    assert.equal(poseKeys.length, 5, `${characterId}: expected 5 pose frames`);
    assert.equal(Object.keys(group.frames).length, 17, `${characterId}: expected exactly 17 packed frames`);

    for (const direction of ["down", "up", "side"]) {
      assert.deepEqual(
        group.walkCycles[direction],
        Array.from({ length: 4 }, (_unused, index) => `walk-${direction}-${index}`),
        `${characterId}.walkCycles.${direction} must list its four frames in order`,
      );
    }
    for (const pose of ["blink", "talk", "reach", "crouch", "kneel"]) {
      assert.ok(`pose-${pose}` in group.frames, `${characterId}.frames is missing pose-${pose}`);
    }
  }
});

test("every character's every frame rect sits fully within the atlas bounds and no two frames overlap", async () => {
  const { png, json } = await buildAtlas();
  const metadata = await sharp(png).metadata();

  const rects = Object.entries(json.characters).flatMap(([characterId, group]) => (
    Object.entries(group.frames).map(([name, origin]) => ({
      name: `${characterId}/${name}`,
      x: origin.x,
      y: origin.y,
    }))
  ));
  assert.equal(rects.length, 119, "expected 17 frames x 7 characters = 119 total packed rects");

  for (const rect of rects) {
    assert.ok(rect.x >= 0 && rect.y >= 0, `${rect.name} has a negative origin`);
    assert.ok(rect.x + json.frameWidth <= metadata.width, `${rect.name} exceeds atlas width ${metadata.width}`);
    assert.ok(rect.y + json.frameHeight <= metadata.height, `${rect.name} exceeds atlas height ${metadata.height}`);
  }

  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i];
      const b = rects[j];
      const overlaps = a.x < b.x + json.frameWidth && b.x < a.x + json.frameWidth
        && a.y < b.y + json.frameHeight && b.y < a.y + json.frameHeight;
      assert.ok(!overlaps, `${a.name} overlaps ${b.name}`);
    }
  }
});

/**
 * Compute the non-transparent alpha bounding box of one packed frame cell.
 *
 * @param {{ data: Buffer, info: { width: number } }} raw - Decoded RGBA atlas pixels.
 * @param {{ x: number, y: number }} origin - The frame's cell origin in the atlas.
 * @param {number} frameWidth - Cell width in pixels.
 * @param {number} frameHeight - Cell height in pixels.
 * @returns {{ minX: number, maxX: number } | null} Inclusive column bounds, or `null` if empty.
 */
function alphaBoundsX({ data, info }, origin, frameWidth, frameHeight) {
  let minX = frameWidth;
  let maxX = -1;
  for (let y = 0; y < frameHeight; y += 1) {
    for (let x = 0; x < frameWidth; x += 1) {
      const alpha = data[((origin.y + y) * info.width + (origin.x + x)) * 4 + 3];
      if (alpha > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
  }
  return maxX >= minX ? { minX, maxX } : null;
}

test("the feet anchor sits inside every frame's bounds, and every one of the 119 packed frames (17 x 7 characters) is centered on it", async () => {
  const { png, json } = await buildAtlas();
  assert.ok(json.feet.x >= 0 && json.feet.x < json.frameWidth, "feet.x must fall inside [0, frameWidth)");
  assert.ok(json.feet.y >= 0 && json.feet.y < json.frameHeight, "feet.y must fall inside [0, frameHeight)");

  const raw = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let checked = 0;
  for (const [characterId, group] of Object.entries(json.characters)) {
    for (const [name, origin] of Object.entries(group.frames)) {
      const label = `${characterId}/${name}`;
      const bounds = alphaBoundsX(raw, origin, json.frameWidth, json.frameHeight);
      assert.ok(bounds, `${label} contains no visible painted content to anchor`);
      const contentCenterX = (bounds.minX + bounds.maxX) / 2;
      assert.ok(
        Math.abs(contentCenterX - json.feet.x) <= 0.5,
        `${label} painted content center x=${contentCenterX} is more than 0.5px from feet.x=${json.feet.x}`,
      );
      checked += 1;
    }
  }
  assert.equal(checked, 119, "expected to have checked all 17 x 7 = 119 packed frames");
});

test("a character missing an entire source directory fails the pack", async () => {
  await assert.rejects(() => buildCharacterGroup("__missing_character__"));
});

test("a complete character directory minus exactly one frame file fails the pack (review fix — literal, staged, never mutates real assets)", async () => {
  const stagedRoot = await mkdtemp(path.join(tmpdir(), "being-chibi-missing-frame-"));
  try {
    // Stage a full, untouched copy of a real character's own source
    // directory (f1) — proves the failure below is caused specifically by
    // the one deleted frame, not by some other defect in a synthetic fixture.
    await cp(sourceDirFor("f1"), stagedRoot, { recursive: true });

    // Sanity check: the untouched staged copy packs cleanly on its own,
    // isolating the coming failure to the deletion below.
    const complete = await buildCharacterGroup("f1", 0, { sourceDir: stagedRoot });
    assert.equal(Object.keys(complete.group.frames).length, 17);

    // Delete exactly one of the 17 frames' source files (a single pose PNG)
    // from the staged copy — the real, approved `roster/f1-sprites/` on
    // disk is never touched.
    await unlink(path.join(stagedRoot, "pose-kneel.png"));

    await assert.rejects(
      () => buildCharacterGroup("f1", 0, { sourceDir: stagedRoot }),
      /ENOENT|pose-kneel/i,
      "a character directory missing exactly one frame file must fail the pack",
    );
  } finally {
    await rm(stagedRoot, { recursive: true, force: true });
  }
});

test("sourceDirFor resolves m1 to the flat base directory and every other id under roster/<id>-sprites", () => {
  assert.match(sourceDirFor("m1"), /character-claude$/);
  for (const characterId of CHARACTER_IDS.filter((id) => id !== "m1")) {
    assert.match(sourceDirFor(characterId), new RegExp(`roster[/\\\\]${characterId}-sprites$`));
  }
});

test("packed atlas PNG compresses under the 40 KB production budget", async () => {
  const { png } = await buildAtlas();
  assert.ok(
    png.length < MAX_COMPRESSED_BYTES,
    `packed atlas is ${png.length} bytes, expected under ${MAX_COMPRESSED_BYTES}`,
  );
});

test("committed being-chibi.png and being-chibi.json regenerate byte-for-byte", async () => {
  const { png, json } = await buildAtlas();
  const [committedPng, committedJsonText] = await Promise.all([
    readFile(OUTPUT_PNG),
    readFile(OUTPUT_JSON, "utf8"),
  ]);
  assert.ok(committedPng.equals(png), "committed being-chibi.png is stale; regenerate via pack-being-chibi-atlas.mjs");
  assert.equal(
    committedJsonText,
    serializeJson(json),
    "committed being-chibi.json is stale; regenerate via pack-being-chibi-atlas.mjs",
  );
});

test("packed PNG sha256 matches the core-being-chibi entry registered in the production manifest", async () => {
  const { png } = await buildAtlas();
  const manifestSource = await readFile(MANIFEST_SOURCE, "utf8");
  const match = manifestSource.match(/id:\s*"core-being-chibi"[\s\S]*?sha256:\s*"([a-f0-9]{64})"/);
  assert.ok(match, "productionManifest.ts has no registered sha256 for core-being-chibi");
  assert.equal(sha256(png), match[1], "packed PNG sha256 does not match the registered manifest entry");
});
