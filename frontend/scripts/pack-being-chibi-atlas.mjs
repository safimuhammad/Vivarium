#!/usr/bin/env node
/**
 * Pack the approved chibi-villager source frames for the full 7-character
 * roster into the production `core-being-chibi` v2 sprite atlas (PNG + JSON)
 * consumed by the 2D sprite-sheet being actor.
 *
 * Source frames (read-only inputs):
 *   - `m1` (the shipped base): `frontend/assets/character-claude/`
 *   - Every other roster character (`f1`, `f2`, `f3`, `m2`, `m3`, `m4`):
 *     `frontend/assets/character-claude/roster/<characterId>-sprites/`
 *
 * Each character directory provides the same 17-frame set:
 *   - `walk-{down,up,side}.png`: horizontal 4-frame strips, each strip
 *     frame height 48px; frame width is that strip's total width / 4. Native
 *     per-frame width varies by character and even by strip within one
 *     character (e.g. m1's up-sheet measures 21px/frame against its
 *     down/side sheets' 22px/frame; the roster characters run narrower
 *     still, down to 16px/frame) — every extracted frame is composited
 *     centered within the uniform 22px-wide atlas cell regardless of its
 *     native width, so the single global `feet.x` anchor stays accurate for
 *     every character and every direction (see `centerOffset`).
 *   - `pose-{blink,talk,reach,crouch,kneel}.png`: single frames, each
 *     exactly 48px tall; native width also varies per character (and even
 *     per pose within one character) and is centered the same way as the
 *     walk frames — only m1's poses happen to already measure the full 22px
 *     cell width natively (so centering is a no-op for them).
 *
 * Packed layout: characters are stacked vertically in `CHARACTER_IDS`
 * order, each occupying 4 rows (down/up/side walk rows, then one pose row)
 * of 5 columns (`max(4 walk frames, 5 poses)`) at the uniform 22x48 cell
 * size. Every character's frame rects are recorded at their absolute
 * (whole-atlas) pixel position under `characters.<id>.frames`, so runtime
 * consumers never need to know the packing order or compute a per-character
 * offset themselves.
 *
 * Output (checked in, generated — never hand-edit):
 *   - `frontend/src/assets/renderer2d/core/being-chibi.png`
 *   - `frontend/src/assets/renderer2d/core/being-chibi.json`
 *
 * Usage:
 *   node scripts/pack-being-chibi-atlas.mjs          # write PNG + JSON
 *   node scripts/pack-being-chibi-atlas.mjs --check  # verify committed
 *                                                     # outputs match a
 *                                                     # fresh regeneration
 *                                                     # byte-for-byte
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SOURCE_DIR = path.join(ROOT, "frontend/assets/character-claude");
export const ROSTER_DIR = path.join(SOURCE_DIR, "roster");
export const OUTPUT_DIR = path.join(ROOT, "frontend/src/assets/renderer2d/core");
export const OUTPUT_PNG = path.join(OUTPUT_DIR, "being-chibi.png");
export const OUTPUT_JSON = path.join(OUTPUT_DIR, "being-chibi.json");

export const FRAME_WIDTH = 22;
export const FRAME_HEIGHT = 48;
export const FEET = Object.freeze({ x: 11, y: 46 });
export const IDLE_FRAME = "walk-down-1";

/** The full 7-character roster, in packed (vertical stacking) order. `m1` is the shipped base. */
export const CHARACTER_IDS = Object.freeze(["m1", "f1", "f2", "f3", "m2", "m3", "m4"]);

/**
 * Native bearing of each authored side-walk strip.
 *
 * The runtime has one simple convention: a packed side frame natively faces
 * east and the renderer mirrors it only for west. The approved f3 source is
 * the exceptional west-facing strip, so normalize it at this pack boundary
 * rather than putting a character-specific exception in the actor renderer.
 */
export const SIDE_SOURCE_FACING_BY_CHARACTER = Object.freeze({
  m1: "east",
  f1: "east",
  f2: "east",
  f3: "west",
  m2: "east",
  m3: "east",
  m4: "east",
});

/** Walk cycle source strips, in the exact row order they are packed within one character's block. */
const WALK_STRIPS = Object.freeze([
  Object.freeze({ direction: "down", file: "walk-down.png" }),
  Object.freeze({ direction: "up", file: "walk-up.png" }),
  Object.freeze({ direction: "side", file: "walk-side.png" }),
]);
const WALK_FRAMES_PER_STRIP = 4;

/** Single-frame authored poses, packed in this order onto each character's final row. */
const POSES = Object.freeze(["blink", "talk", "reach", "crouch", "kneel"]);
const EXPECTED_FRAME_COUNT = WALK_STRIPS.length * WALK_FRAMES_PER_STRIP + POSES.length;

const COLUMNS = Math.max(WALK_FRAMES_PER_STRIP, POSES.length);
/** Rows one character occupies: one per walk direction, plus one shared pose row. */
const ROWS_PER_CHARACTER = WALK_STRIPS.length + 1;
export const ATLAS_WIDTH = COLUMNS * FRAME_WIDTH;
export const ATLAS_HEIGHT = CHARACTER_IDS.length * ROWS_PER_CHARACTER * FRAME_HEIGHT;

const PNG_ENCODE_OPTIONS = { palette: true, colours: 128, dither: 0, compressionLevel: 9 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * Resolve one character's source frame directory.
 *
 * @param {string} characterId - A member of {@link CHARACTER_IDS}.
 * @returns {string} Absolute path to that character's source directory.
 */
export function sourceDirFor(characterId) {
  return characterId === "m1" ? SOURCE_DIR : path.join(ROSTER_DIR, `${characterId}-sprites`);
}

/**
 * Split one horizontal walk strip into its four native frames.
 *
 * Each strip's per-frame width is derived from the strip's own total
 * width (total / 4) rather than assumed to be exactly `FRAME_WIDTH`,
 * because the approved source art is not perfectly uniform across
 * strips or characters (see module docstring). The extracted buffers keep
 * their native width; the caller centers them within the uniform
 * `FRAME_WIDTH` atlas cell (see `centerOffset` in `buildCharacterGroup`) so
 * the single global `feet.x` anchor stays accurate for every character and
 * direction.
 *
 * @param {string} stripPath - Absolute path to the walk strip PNG.
 * @returns {Promise<{ frames: Buffer[], nativeFrameWidth: number }>} Four
 *   PNG-encoded frame buffers (left to right) and their shared native width.
 */
async function extractWalkFrames(stripPath) {
  const source = await readFile(stripPath);
  const metadata = await sharp(source).metadata();
  if (metadata.height !== FRAME_HEIGHT) {
    throw new Error(`${stripPath}: height ${metadata.height} does not match frameHeight ${FRAME_HEIGHT}`);
  }
  if (!metadata.width || metadata.width % WALK_FRAMES_PER_STRIP !== 0) {
    throw new Error(`${stripPath}: width ${metadata.width} does not divide evenly into ${WALK_FRAMES_PER_STRIP} frames`);
  }
  const nativeFrameWidth = metadata.width / WALK_FRAMES_PER_STRIP;
  if (nativeFrameWidth > FRAME_WIDTH) {
    throw new Error(`${stripPath}: native frame width ${nativeFrameWidth} exceeds atlas cell width ${FRAME_WIDTH}`);
  }
  const frames = [];
  for (let index = 0; index < WALK_FRAMES_PER_STRIP; index += 1) {
    frames.push(await sharp(source)
      .extract({ left: index * nativeFrameWidth, top: 0, width: nativeFrameWidth, height: FRAME_HEIGHT })
      .png()
      .toBuffer());
  }
  return { frames, nativeFrameWidth };
}

/**
 * Compute the horizontal offset that centers a `nativeWidth`-wide frame
 * inside one `FRAME_WIDTH`-wide atlas cell.
 *
 * Rounds the split padding to the nearest pixel (biasing the extra pixel,
 * if any, to the right) rather than always flooring, so the resulting
 * content bounding-box center lands as close as possible to the shared
 * `feet.x` anchor — flooring an odd single-pixel gap (as a naive
 * left-align, or `Math.floor` centering, would) leaves it a full pixel
 * off instead of exactly on anchor. Verified against the packed PNG's
 * measured alpha bounding boxes for every one of the roster's 119 packed
 * frames; see `pack-being-chibi-atlas.test.mjs`.
 *
 * @param {number} nativeWidth - The frame's native (pre-atlas) pixel width.
 * @returns {number} Left offset, in pixels, within the atlas cell.
 */
function centerOffset(nativeWidth) {
  return Math.round((FRAME_WIDTH - nativeWidth) / 2);
}

/**
 * Read and validate one single-frame authored pose PNG.
 *
 * Native pose width varies by character (and even by pose within one
 * character — the shipped m1 base happens to author every pose at exactly
 * the full `FRAME_WIDTH`, but the roster characters do not); height must
 * always be exactly `FRAME_HEIGHT`. The caller centers the returned buffer
 * within the atlas cell via `centerOffset`, same as a walk frame.
 *
 * @param {string} sourceDir - The owning character's source directory.
 * @param {string} pose - Pose name (e.g. `"blink"`).
 * @returns {Promise<{ buffer: Buffer, nativeWidth: number }>} The pose's
 *   PNG-encoded pixels at their native width, and that native width.
 */
async function readPoseFrame(sourceDir, pose) {
  const posePath = path.join(sourceDir, `pose-${pose}.png`);
  const source = await readFile(posePath);
  const metadata = await sharp(source).metadata();
  if (metadata.height !== FRAME_HEIGHT) {
    throw new Error(`${posePath}: height ${metadata.height} does not match frameHeight ${FRAME_HEIGHT}`);
  }
  if (!metadata.width || metadata.width > FRAME_WIDTH) {
    throw new Error(`${posePath}: native frame width ${metadata.width} exceeds atlas cell width ${FRAME_WIDTH}`);
  }
  return { buffer: await sharp(source).png().toBuffer(), nativeWidth: metadata.width };
}

/**
 * Build one character's 17-frame packed group (composite instructions plus
 * its frame-lookup geometry), anchored at `rowOffset` whole-atlas rows.
 *
 * Enforces the pose-parity contract: a character missing any of the 12 walk
 * frames or 5 pose frames — whether from a missing source file (the
 * underlying `readFile` throws) or any other extraction failure — fails
 * this call, and therefore fails the whole pack; `buildAtlas` never
 * silently packs a partial character.
 *
 * @param {string} characterId - A member of {@link CHARACTER_IDS}.
 * @param {number} [rowOffset] - Whole-atlas row offset this character's
 *   block starts at, in units of `FRAME_HEIGHT`. Defaults to `0`, which
 *   `pack-being-chibi-atlas.test.mjs` relies on to exercise one character in
 *   isolation (e.g. to prove a missing frame fails the pack) without
 *   needing to reconstruct the whole roster's packing order.
 * @param {{ sourceDir?: string }} [options] - Test-only override:
 *   `sourceDir` replaces the normal `sourceDirFor(characterId)` resolution
 *   with an arbitrary directory. `pack-being-chibi-atlas.test.mjs` uses
 *   this to stage a temp copy of one real character's directory with
 *   exactly one frame file deleted, proving the pose-parity contract fails
 *   the pack on a literal missing frame — without ever mutating the real,
 *   approved source assets under `SOURCE_DIR`/`ROSTER_DIR`.
 * @returns {Promise<{
 *   composites: Array<{ input: Buffer, left: number, top: number }>,
 *   group: { frames: Record<string, {x: number, y: number}>,
 *     walkCycles: Record<string, string[]>, idleFrame: string },
 * }>} This character's composite instructions (to merge into the
 *   whole-atlas composite list) and its packed frame geometry.
 */
export async function buildCharacterGroup(characterId, rowOffset = 0, options = {}) {
  const sourceDir = options.sourceDir ?? sourceDirFor(characterId);
  const composites = [];
  const frames = {};

  for (const [row, strip] of WALK_STRIPS.entries()) {
    const { frames: stripFrames, nativeFrameWidth } = await extractWalkFrames(path.join(sourceDir, strip.file));
    const framesForAtlas = strip.direction === "side" && SIDE_SOURCE_FACING_BY_CHARACTER[characterId] === "west"
      ? await Promise.all(stripFrames.map((buffer) => sharp(buffer).flop().png().toBuffer()))
      : stripFrames;
    const offset = centerOffset(nativeFrameWidth);
    framesForAtlas.forEach((buffer, column) => {
      const name = `walk-${strip.direction}-${column}`;
      const x = column * FRAME_WIDTH;
      const y = (rowOffset + row) * FRAME_HEIGHT;
      frames[name] = { x, y };
      composites.push({ input: buffer, left: x + offset, top: y });
    });
  }

  const poseRow = rowOffset + WALK_STRIPS.length;
  for (const [column, pose] of POSES.entries()) {
    const { buffer, nativeWidth } = await readPoseFrame(sourceDir, pose);
    const offset = centerOffset(nativeWidth);
    const name = `pose-${pose}`;
    const x = column * FRAME_WIDTH;
    const y = poseRow * FRAME_HEIGHT;
    frames[name] = { x, y };
    composites.push({ input: buffer, left: x + offset, top: y });
  }

  if (Object.keys(frames).length !== EXPECTED_FRAME_COUNT) {
    throw new Error(
      `${characterId}: expected exactly ${EXPECTED_FRAME_COUNT} packed frames, got ${Object.keys(frames).length}`,
    );
  }

  const walkCycles = Object.fromEntries(WALK_STRIPS.map(({ direction }) => [
    direction,
    Array.from({ length: WALK_FRAMES_PER_STRIP }, (_unused, index) => `walk-${direction}-${index}`),
  ]));

  return { composites, group: { frames, walkCycles, idleFrame: IDLE_FRAME } };
}

/**
 * Build the packed being-chibi atlas PNG and its frame-lookup JSON from the
 * approved source frames of every character in {@link CHARACTER_IDS}.
 *
 * Deterministic and side-effect free: reads only the read-only source
 * frames under `SOURCE_DIR`/`ROSTER_DIR` and returns the packed bytes in
 * memory. Callers decide whether to write, compare, or hash the result.
 *
 * @returns {Promise<{ png: Buffer, json: object }>} The packed PNG buffer
 *   and its companion frame-atlas JSON, ready to serialize.
 */
export async function buildAtlas() {
  const composites = [];
  const characters = {};

  for (const [index, characterId] of CHARACTER_IDS.entries()) {
    const rowOffset = index * ROWS_PER_CHARACTER;
    const { composites: characterComposites, group } = await buildCharacterGroup(characterId, rowOffset);
    composites.push(...characterComposites);
    characters[characterId] = group;
  }

  const png = await sharp({
    create: { width: ATLAS_WIDTH, height: ATLAS_HEIGHT, channels: 4, background: TRANSPARENT },
  }).composite(composites).png(PNG_ENCODE_OPTIONS).toBuffer();

  const json = {
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
    feet: { ...FEET },
    characters,
  };

  return { png, json };
}

/** Serialize the atlas JSON the exact way it is written to disk. */
export function serializeJson(json) {
  return `${JSON.stringify(json, null, 2)}\n`;
}

async function readCommitted() {
  const [png, jsonText] = await Promise.all([
    readFile(OUTPUT_PNG).catch(() => null),
    readFile(OUTPUT_JSON, "utf8").catch(() => null),
  ]);
  return { png, jsonText };
}

/**
 * Verify the committed PNG+JSON match a fresh regeneration byte-for-byte,
 * without writing, rewriting, or deleting any file.
 *
 * @returns {Promise<number>} `0` when the committed outputs are current, `1` on drift.
 */
async function check() {
  const { png, json } = await buildAtlas();
  const jsonText = serializeJson(json);
  const committed = await readCommitted();
  const drift = [];
  if (!committed.png || !committed.png.equals(png)) drift.push(path.relative(ROOT, OUTPUT_PNG));
  if (committed.jsonText !== jsonText) drift.push(path.relative(ROOT, OUTPUT_JSON));
  if (drift.length > 0) {
    console.error(`being-chibi atlas drift, regenerate via this script: ${drift.join(", ")}`);
    return 1;
  }
  const sha256 = createHash("sha256").update(png).digest("hex");
  console.log(`being-chibi atlas is current (${png.length} bytes, sha256=${sha256}).`);
  return 0;
}

/**
 * Regenerate and write the committed PNG+JSON from the approved source frames.
 *
 * @returns {Promise<number>} `0` on success.
 */
async function write() {
  const { png, json } = await buildAtlas();
  await writeFile(OUTPUT_PNG, png);
  await writeFile(OUTPUT_JSON, serializeJson(json));
  const sha256 = createHash("sha256").update(png).digest("hex");
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_PNG)} (${png.length} bytes, sha256=${sha256})`);
  console.log(`Wrote ${path.relative(ROOT, OUTPUT_JSON)}`);
  return 0;
}

async function main() {
  return process.argv.includes("--check") ? check() : write();
}

const isCli = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  process.exitCode = await main();
}
