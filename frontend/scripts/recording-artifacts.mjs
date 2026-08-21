import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_SCHEMA_VERSION = 1;
export const RECORDING_FPS = 30;
export const VIEWPORTS = Object.freeze(["desktop", "mobile"]);
export const REQUIRED_VIEWPORT_SIDECARS = Object.freeze([
  "recording.json", "markers.json", "semantic.json", "cursors.json", "motion.json",
  "performance.json", "network.json", "assets.json", "reduced-motion.json",
  "viewport.json", "source-revision.json",
]);

export function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filename) {
  return sha256Buffer(await readFile(filename));
}

export function canonicalJson(value) {
  return `${JSON.stringify(normalizeJsonValue(value, "$"), null, 2)}\n`;
}

export async function writeNormalizedJson(filename, value) {
  await writeFile(filename, canonicalJson(value));
}

export async function readNormalizedJson(filename) {
  const raw = await readFile(filename, "utf8");
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${filename} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw !== canonicalJson(value)) throw new Error(`${filename} is not normalized canonical JSON`);
  return value;
}

export async function validateMarkerDocument(document, { directory, frameCount, fps = RECORDING_FPS }) {
  assertObject(document, "marker document");
  if (document.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new Error("marker schemaVersion must be 1");
  assertChronicleId(document.chronicleId);
  if (!VIEWPORTS.includes(document.viewport)) throw new Error("marker viewport must be desktop or mobile");
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new Error("marker frameCount must be positive");
  if (fps !== RECORDING_FPS) throw new Error("marker evidence must use exact 30 fps");
  if (!Array.isArray(document.expected) || document.expected.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new Error("marker expected list must contain nonblank names");
  }
  if (!Array.isArray(document.observed)) throw new Error("marker observed list must be an array");
  const ids = new Set();
  const observedExpected = new Set();
  for (const marker of document.observed) {
    assertObject(marker, "observed marker");
    if (typeof marker.id !== "string" || marker.id.trim() === "") throw new Error("blank marker id");
    if (ids.has(marker.id)) throw new Error(`duplicate marker id ${marker.id}`);
    ids.add(marker.id);
    if (typeof marker.label !== "string" || marker.label.trim() === "") throw new Error(`blank marker label ${marker.id}`);
    if (typeof marker.expectedMarker !== "string" || marker.expectedMarker.trim() === "") throw new Error(`blank expected marker ${marker.id}`);
    observedExpected.add(marker.expectedMarker);
    if (!Number.isSafeInteger(marker.frameIndex) || marker.frameIndex < 0 || marker.frameIndex >= frameCount) {
      throw new Error(`marker frameIndex is outside recording ${marker.id}`);
    }
    const exactTime = marker.frameIndex * 1000 / fps;
    if (!Number.isFinite(marker.mediaTimeMs) || Math.abs(marker.mediaTimeMs - exactTime) > 1e-6) {
      throw new Error(`marker mediaTimeMs must equal its exact frame timestamp ${marker.id}`);
    }
    if (!Number.isFinite(marker.presentationTimeMs) || marker.presentationTimeMs < 0) {
      throw new Error(`marker presentationTimeMs must be non-negative ${marker.id}`);
    }
    assertObject(marker.still, `marker still ${marker.id}`);
    if (typeof marker.still.file !== "string" || !/^markers\/[^/]+\.png$/.test(marker.still.file)) {
      throw new Error(`marker still must use markers/*.png ${marker.id}`);
    }
    await validateFileReference(marker.still, directory, `marker still ${marker.id}`);
  }
  const expected = [...new Set(document.expected)].sort();
  if (expected.length !== document.expected.length) throw new Error("duplicate expected marker name");
  const observed = [...observedExpected].sort();
  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new Error(`marker set mismatch expected=${expected.join(",")} observed=${observed.join(",")}`);
  }
}

/** Validate the retained ledger that binds encoded frames to accepted Canvas truth. */
export function validateRecordingFrameLedger(document, { label = "recording", fps = RECORDING_FPS } = {}) {
  assertObject(document, label);
  if (!Number.isSafeInteger(document.frameCount) || document.frameCount <= 0) throw new Error(`${label} frameCount must be positive`);
  if (fps !== RECORDING_FPS || document.fps !== fps) throw new Error(`${label} must use exact 30 fps`);
  if (!Array.isArray(document.frames) || document.frames.length !== document.frameCount) {
    throw new Error(`${label} frame ledger length mismatch`);
  }
  if (typeof document.timelineSha256 !== "string"
    || document.timelineSha256 !== sha256Buffer(Buffer.from(canonicalJson(document.frames)))) {
    throw new Error(`${label} frame ledger hash drift`);
  }
  for (const [frameIndex, frame] of document.frames.entries()) {
    assertObject(frame, `${label} frame ${frameIndex}`);
    const exactTime = frameIndex * 1000 / fps;
    if (frame.frameIndex !== frameIndex
      || !Number.isFinite(frame.mediaTimeMs) || Math.abs(frame.mediaTimeMs - exactTime) > 1e-9
      || !Number.isFinite(frame.presentationTimeMs) || Math.abs(frame.presentationTimeMs - exactTime) > 1e-9) {
      throw new Error(
        `${label} frame ledger timing drift at ${frameIndex}: frameIndex and presentationTimeMs/mediaTimeMs must equal exact frame time`,
      );
    }
    if (!Number.isSafeInteger(frame.bytes) || frame.bytes < 0 || !/^[a-f0-9]{64}$/.test(frame.sha256)) {
      throw new Error(`${label} frame ${frameIndex} file identity is invalid`);
    }
    validateAcceptedFrameIdentity(frame.canvasFrameIdentity, `${label} Canvas frame ${frameIndex}`);
    validateAcceptedFrameIdentity(frame.observerFrameIdentity, `${label} observer frame ${frameIndex}`);
    if (canonicalJson(frame.canvasFrameIdentity) !== canonicalJson(frame.observerFrameIdentity)) {
      throw new Error(`${label} frame acceptance drift at ${frameIndex}`);
    }
    validateRetainedAcceptedFrameLineage(frame, `${label} frame ${frameIndex}`);
  }
  return document.frames;
}

/** Bind marker still identities and timestamps to their exact retained frame. */
export function validateMarkersAgainstRecordingFrames(document, frames, label = "recording") {
  assertObject(document, `${label} markers`);
  if (!Array.isArray(frames) || !Array.isArray(document.observed)) throw new Error(`${label} marker/frame ledger is invalid`);
  for (const marker of document.observed) {
    const frame = frames[marker.frameIndex];
    if (!frame || marker.still.bytes !== frame.bytes || marker.still.sha256 !== frame.sha256
      || marker.mediaTimeMs !== frame.mediaTimeMs || marker.presentationTimeMs !== frame.presentationTimeMs) {
      throw new Error(`${label} marker ${String(marker.id)} does not match its exact frame ledger`);
    }
  }
}

export async function validateFileReference(reference, directory, label = "artifact") {
  assertObject(reference, label);
  if (typeof reference.file !== "string" || reference.file.trim() === "") throw new Error(`${label} file must be nonblank`);
  if (!Number.isSafeInteger(reference.bytes) || reference.bytes < 0) throw new Error(`${label} bytes must be non-negative`);
  if (!/^[a-f0-9]{64}$/.test(reference.sha256)) throw new Error(`${label} sha256 must be lowercase hex`);
  const filename = await resolveContainedFile(directory, reference.file);
  const metadata = await stat(filename);
  if (metadata.size !== reference.bytes) throw new Error(`${label} byte size mismatch`);
  if (await sha256File(filename) !== reference.sha256) throw new Error(`${label} hash mismatch`);
  return filename;
}

export async function resolveContainedFile(directory, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error(`artifact path escapes evidence directory: ${relative}`);
  const base = await realpath(directory);
  const candidate = path.resolve(directory, relative);
  const info = await lstat(candidate);
  if (info.isSymbolicLink()) throw new Error(`artifact path may not be a symbolic link: ${relative}`);
  const resolved = await realpath(candidate);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error(`artifact path escapes evidence directory: ${relative}`);
  return resolved;
}

export async function listFilesRecursively(directory, prefix = "") {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`evidence may not contain symbolic links: ${relative}`);
    if (entry.isDirectory()) output.push(...await listFilesRecursively(path.join(directory, entry.name), relative));
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

function normalizeJsonValue(value, location) {
  if (value === undefined) throw new TypeError(`${location} contains undefined`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError(`${location} must be a finite JSON number`);
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map((item, index) => normalizeJsonValue(item, `${location}[${index}]`));
  if (typeof value !== "object") throw new TypeError(`${location} is not JSON data`);
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = normalizeJsonValue(value[key], `${location}.${key}`);
  return result;
}

export function assertObject(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

export function assertChronicleId(value) {
  if (typeof value !== "string" || !/^C(?:0[0-9]|1[0-7])$/.test(value)) throw new Error(`invalid Chronicle id ${String(value)}`);
}

function validateAcceptedFrameIdentity(identity, label) {
  assertObject(identity, label);
  for (const field of ["runId", "sourceKey"]) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") throw new Error(`${label} ${field} must be nonblank`);
  }
  for (const field of ["firstCursor", "lastCursor", "revision"]) {
    if (!Number.isSafeInteger(identity[field]) || identity[field] < 0) throw new Error(`${label} ${field} must be non-negative`);
  }
  if (identity.lastCursor < identity.firstCursor) throw new Error(`${label} cursor range is invalid`);
}

function validateRetainedAcceptedFrameLineage(frame, label) {
  for (const field of ["presentedCursor", "exactBaseCursor", "projectedThroughCursor"]) {
    if (!Number.isSafeInteger(frame[field]) || frame[field] < 0) {
      throw new Error(`${label} ${field} must be non-negative retained accepted-frame lineage`);
    }
  }
  if (frame.exactBaseCursor > frame.presentedCursor
    || frame.presentedCursor > frame.projectedThroughCursor
    || frame.projectedThroughCursor > frame.canvasFrameIdentity.lastCursor
    || frame.presentedCursor > frame.canvasFrameIdentity.lastCursor) {
    throw new Error(`${label} retained accepted-frame lineage cursors are inconsistent`);
  }
  assertObject(frame.region, `${label} region retained accepted-frame lineage`);
  for (const field of ["activeRegionId", "visibleRegionId", "loadingRegionId"]) {
    const value = frame.region[field];
    if (value !== null && (typeof value !== "string" || value.trim() === "")) {
      throw new Error(`${label} region ${field} must be null or nonblank retained accepted-frame lineage`);
    }
  }
}
