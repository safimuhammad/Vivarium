#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARTIFACT_SCHEMA_VERSION,
  RECORDING_FPS,
  REQUIRED_VIEWPORT_SIDECARS,
  VIEWPORTS,
  assertChronicleId,
  assertObject,
  canonicalJson,
  listFilesRecursively,
  readNormalizedJson,
  sha256Buffer,
  validateFileReference,
  validateMarkerDocument,
  validateRecordingFrameLedger,
  writeNormalizedJson,
} from "./recording-artifacts.mjs";
import { buildProductionStageAnalysis } from "./build-production-stage-analysis.mjs";
import {
  createCanonicalChronicleEvidenceOracle,
  EVIDENCE_SIDECAR_FILES,
  trustedTerminalAuthority,
  validateEventlessOperationalAuthority,
} from "./chronicle-evidence-oracles.mjs";

const DEFAULT_FFMPEG = process.env.VIVARIUM_FFMPEG ?? "ffmpeg";
const DEFAULT_FFPROBE = process.env.VIVARIUM_FFPROBE ?? "ffprobe";
const COMPLETE_CHRONICLE_IDS = Object.freeze(Array.from({ length: 18 }, (_, index) => `C${String(index).padStart(2, "0")}`));

export async function encodeFrameSequence({
  framesDirectory,
  frameCount,
  fps = RECORDING_FPS,
  webmPath,
  mp4Path,
  ffmpegPath = DEFAULT_FFMPEG,
}) {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new Error("frameCount must be a positive safe integer");
  if (fps !== RECORDING_FPS) throw new Error("recordings must use exact 30 fps");
  await assertCanonicalFrameSequence(framesDirectory, frameCount);
  const input = path.join(framesDirectory, "%06d.png");
  const common = [
    "-hide_banner", "-loglevel", "error", "-y", "-framerate", String(fps),
    "-start_number", "0", "-i", input, "-frames:v", String(frameCount), "-an",
    "-map_metadata", "-1", "-fflags", "+bitexact",
  ];
  try {
    await runCommand(ffmpegPath, [
      ...common, "-c:v", "libvpx-vp9", "-lossless", "1", "-threads", "1",
      // Canonical scene captures are opaque. Pin RGB to avoid FFmpeg selecting
      // the experimental alpha format (gbrap) for PNG inputs.
      "-pix_fmt", "gbrp", "-row-mt", "0", webmPath,
    ]);
    await runCommand(ffmpegPath, [
      ...common, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", "-threads", "1", "-movflags", "+faststart", mp4Path,
    ]);
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error(`ffmpeg conversion support is unavailable at ${ffmpegPath}`, { cause: error });
    throw error;
  }
  const [webmProbe, mp4Probe] = await Promise.all([probeVideo(webmPath), probeVideo(mp4Path)]);
  if (webmProbe.frameCount !== frameCount || mp4Probe.frameCount !== frameCount) {
    throw new Error(`encoded frame count mismatch expected=${frameCount} webm=${webmProbe.frameCount} mp4=${mp4Probe.frameCount}`);
  }
  assertTimingParity(webmProbe, mp4Probe, fps);
  return { webm: webmProbe, mp4: mp4Probe };
}

export async function probeVideo(filename, ffprobePath = DEFAULT_FFPROBE) {
  let result;
  try {
    result = await runCommand(ffprobePath, [
      "-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,r_frame_rate,avg_frame_rate,time_base,start_time,duration,nb_read_frames:format=duration",
      "-of", "json", filename,
    ]);
  } catch (error) {
    if (error && error.code === "ENOENT") throw new Error(`ffprobe support is unavailable at ${ffprobePath}`, { cause: error });
    throw error;
  }
  const parsed = JSON.parse(result.stdout);
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error(`ffprobe found no video stream in ${filename}`);
  const [fpsNumerator, fpsDenominator] = parseFraction(stream.avg_frame_rate || stream.r_frame_rate, "frame rate");
  const frameCount = Number(stream.nb_read_frames);
  const durationSeconds = Number(parsed.format?.duration ?? stream.duration);
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0) throw new Error(`ffprobe did not count frames in ${filename}`);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error(`ffprobe did not report duration for ${filename}`);
  return Object.freeze({
    codec: stream.codec_name,
    width: Number(stream.width),
    height: Number(stream.height),
    frameCount,
    fpsNumerator,
    fpsDenominator,
    durationSeconds,
    timeBase: stream.time_base,
    startTimeSeconds: Number(stream.start_time ?? 0),
  });
}

export function assertTimingParity(webm, mp4, fps = RECORDING_FPS) {
  for (const [label, probe] of [["WebM", webm], ["MP4", mp4]]) {
    if (probe.fpsNumerator / probe.fpsDenominator !== fps) throw new Error(`${label} must remain exact ${fps} fps`);
    if (!Number.isSafeInteger(probe.frameCount) || probe.frameCount <= 0) throw new Error(`${label} frame count is invalid`);
  }
  if (webm.frameCount !== mp4.frameCount) throw new Error(`WebM/MP4 frame count mismatch ${webm.frameCount}/${mp4.frameCount}`);
  const oneFrameSeconds = 1 / fps;
  if (Math.abs(webm.durationSeconds - mp4.durationSeconds) > oneFrameSeconds + 1e-6) {
    throw new Error(`WebM/MP4 duration differs by more than one recorded frame`);
  }
  const expectedDuration = webm.frameCount / fps;
  for (const [label, probe] of [["WebM", webm], ["MP4", mp4]]) {
    if (Math.abs(probe.durationSeconds - expectedDuration) > oneFrameSeconds + 1e-6) {
      throw new Error(`${label} duration is retimed relative to its frame count`);
    }
  }
}

export async function assertCanonicalFrameSequence(directory, frameCount) {
  const expected = Array.from({ length: frameCount }, (_, index) => `${String(index).padStart(6, "0")}.png`);
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`canonical PNG sequence mismatch expected=${expected.length} actual=${actual.length}`);
  }
  await Promise.all(expected.map((file) => access(path.join(directory, file))));
}

export async function sealEvidenceTree(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const catalogPath = path.resolve(options.catalogPath ?? defaultCatalogPath());
  const fixtureDirectory = path.resolve(options.fixtureDirectory ?? path.dirname(catalogPath));
  const catalog = await readCatalog(catalogPath, options.allowPartialCatalog === true);
  const actualDirectories = await chronicleDirectories(root);
  assertSameList(actualDirectories, catalog.chronicles.map(({ id }) => id), "Chronicle directory set");
  const indexEntries = [];
  for (const entry of catalog.chronicles) {
    const directory = path.join(root, entry.id);
    const fixturePath = path.join(fixtureDirectory, entry.file);
    const fixtureBytes = await readFile(fixturePath);
    const fixtureManifest = JSON.parse(fixtureBytes.toString("utf8"));
    const files = (await listFilesRecursively(directory))
      .filter((file) => file !== "manifest.json")
      .filter((file) => !file.startsWith(".frames/") && file !== "capture.json");
    const forbiddenTransient = (await listFilesRecursively(directory)).filter((file) => file.startsWith(".frames/") || file === "capture.json");
    if (forbiddenTransient.length > 0) throw new Error(`${entry.id} contains transient capture artifacts: ${forbiddenTransient.join(",")}`);
    assertArtifactLayout(files, entry.id);
    for (const viewport of VIEWPORTS) {
      await validateC03WitnessFile(directory, entry.id, viewport, fixtureManifest);
    }
    const artifacts = [];
    for (const file of files) {
      const bytes = await readFile(path.join(directory, file));
      artifacts.push({ file, bytes: bytes.length, sha256: sha256Buffer(bytes) });
    }
    const manifest = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      chronicle: {
        id: entry.id, slug: entry.slug, version: entry.version, seed: entry.seed,
        runId: entry.runId, expectedFinalCursor: entry.expectedFinalCursor,
        fixture: { file: entry.file, bytes: fixtureBytes.length, sha256: sha256Buffer(fixtureBytes) },
      },
      viewports: [...VIEWPORTS],
      artifacts,
    };
    const manifestPath = path.join(directory, "manifest.json");
    await writeNormalizedJson(manifestPath, manifest);
    const manifestBytes = await readFile(manifestPath);
    indexEntries.push({ id: entry.id, file: `${entry.id}/manifest.json`, bytes: manifestBytes.length, sha256: sha256Buffer(manifestBytes) });
  }
  await writeNormalizedJson(path.join(root, "index.json"), {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    catalog: { file: path.basename(catalogPath), sha256: sha256Buffer(await readFile(catalogPath)) },
    chronicles: indexEntries,
  });
}

export async function validateEvidenceTree(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const catalogPath = path.resolve(options.catalogPath ?? defaultCatalogPath());
  const fixtureDirectory = path.resolve(options.fixtureDirectory ?? path.dirname(catalogPath));
  const ffmpegPath = options.ffmpegPath ?? DEFAULT_FFMPEG;
  const ffprobePath = options.ffprobePath ?? DEFAULT_FFPROBE;
  await assertConversionSupport(ffmpegPath);
  const catalog = await readCatalog(catalogPath, options.allowPartialCatalog === true);
  const analysis = await buildProductionStageAnalysis();
  try {
  const expectedIds = catalog.chronicles.map(({ id }) => id);
  const topLevel = (await readdir(root, { withFileTypes: true })).map(({ name }) => name).sort();
  assertSameList(topLevel, ["index.json", ...expectedIds].sort(), "evidence root entries");
  const index = await readNormalizedJson(path.join(root, "index.json"));
  assertObject(index, "evidence index");
  if (index.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new Error("evidence index schemaVersion must be 1");
  if (index.catalog?.sha256 !== sha256Buffer(await readFile(catalogPath))) throw new Error("catalog hash drift");
  assertSameList(index.chronicles?.map(({ id }) => id) ?? [], expectedIds, "index Chronicle ids");
  for (const entry of catalog.chronicles) {
    const directory = path.join(root, entry.id);
    const indexRecord = index.chronicles.find(({ id }) => id === entry.id);
    await validateFileReference(indexRecord, root, `${entry.id} manifest index record`);
    const manifest = await readNormalizedJson(path.join(directory, "manifest.json"));
    validateChronicleMetadata(manifest, entry);
    const fixtureBytes = await readFile(path.join(fixtureDirectory, entry.file));
    if (manifest.chronicle.fixture.sha256 !== sha256Buffer(fixtureBytes)
      || manifest.chronicle.fixture.bytes !== fixtureBytes.length) throw new Error(`${entry.id} fixture hash drift`);
    const fixtureManifest = JSON.parse(fixtureBytes.toString("utf8"));
    assertSameList(manifest.viewports, VIEWPORTS, `${entry.id} viewports`);
    const actualArtifacts = (await listFilesRecursively(directory)).filter((file) => file !== "manifest.json");
    const declaredArtifacts = manifest.artifacts.map(({ file }) => file);
    if (new Set(declaredArtifacts).size !== declaredArtifacts.length) throw new Error(`${entry.id} duplicate manifest artifact`);
    const stale = actualArtifacts.filter((file) => !declaredArtifacts.includes(file));
    const missing = declaredArtifacts.filter((file) => !actualArtifacts.includes(file));
    if (stale.length > 0) throw new Error(`${entry.id} stale artifact ${stale.join(",")}`);
    if (missing.length > 0) throw new Error(`${entry.id} missing artifact ${missing.join(",")}`);
    assertArtifactLayout(actualArtifacts, entry.id);
    if (JSON.stringify(declaredArtifacts) !== JSON.stringify([...declaredArtifacts].sort())) throw new Error(`${entry.id} manifest artifacts must be sorted`);
    for (const artifact of manifest.artifacts) await validateFileReference(artifact, directory, `${entry.id} artifact ${artifact.file}`);
    await validateContactSheet(directory, entry.id);
    for (const viewport of VIEWPORTS) {
      const retained = await validateViewport(
        directory,
        entry.id,
        viewport,
        ffprobePath,
        fixtureManifest,
      );
      await revalidateCanonicalSidecars({
        root, directory: path.join(directory, viewport), chronicleId: entry.id,
        viewport, expectedFinalCursor: entry.expectedFinalCursor, analysis,
        retainedRecording: retained.recording,
        retainedMarkers: retained.markers,
      });
    }
  }
  return { chronicles: expectedIds.length, viewports: expectedIds.length * VIEWPORTS.length };
  } finally {
    await analysis.cleanup();
  }
}

async function assertConversionSupport(ffmpegPath) {
  let result;
  try {
    result = await runCommand(ffmpegPath, ["-hide_banner", "-encoders"]);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(`ffmpeg conversion support is unavailable at ${ffmpegPath}`, { cause: error });
    }
    throw error;
  }
  const encoders = result.stdout;
  const missing = ["libvpx-vp9", "libx264"].filter((encoder) => !encoders.includes(encoder));
  if (missing.length > 0) {
    throw new Error(`ffmpeg conversion support is unavailable at ${ffmpegPath}: missing ${missing.join(", ")}`);
  }
}

export async function encodePreparedEvidenceTree(rootDirectory, options = {}) {
  const root = path.resolve(rootDirectory);
  const catalogPath = path.resolve(options.catalogPath ?? defaultCatalogPath());
  const fixtureDirectory = path.resolve(options.fixtureDirectory ?? path.dirname(catalogPath));
  const catalog = await readCatalog(catalogPath, options.allowPartialCatalog === true);
  const encoded = [];
  for (const entry of catalog.chronicles) {
    for (const viewport of VIEWPORTS) {
      const directory = path.join(root, entry.id, viewport);
      const fixtureManifest = JSON.parse(await readFile(
        path.join(fixtureDirectory, entry.file),
        "utf8",
      ));
      const result = await encodePreparedViewport(directory, {
        chronicleId: entry.id,
        viewport,
        expectedMarkers: fixtureManifest.expectedMarkers,
        fixture: fixtureManifest,
        ffmpegPath: options.ffmpegPath ?? DEFAULT_FFMPEG,
        skipEncoded: true,
      });
      if (result === "encoded") encoded.push(`${entry.id}/${viewport}`);
    }
  }
  return encoded;
}

/** Encode and clean one prepared Chronicle viewport to keep peak PNG storage bounded. */
export async function encodePreparedViewport(directory, options) {
  const capturePath = path.join(directory, "capture.json");
  const framesDirectory = path.join(directory, ".frames");
  const recordingPath = path.join(directory, "recording.json");
  const [hasCapture, hasFrames, hasRecording] = await Promise.all([
    fileExists(capturePath),
    fileExists(framesDirectory),
    fileExists(recordingPath),
  ]);
  if (!hasCapture && !hasFrames && hasRecording && options.skipEncoded === true) return "skipped";
  if (hasRecording || !hasCapture || !hasFrames) {
    throw new Error(`${options.chronicleId}/${options.viewport} prepared viewport state is incomplete or conflicts with an existing recording`);
  }
  await validatePreparedPresentationAuthorityFile(directory, options.fixture);
  const capture = await readNormalizedJson(capturePath);
  await validatePreparedCapture(
    directory,
    options.chronicleId,
    options.viewport,
    capture,
    options.expectedMarkers,
  );
  const webmPath = path.join(directory, "video.webm");
  const mp4Path = path.join(directory, "review.mp4");
  const probes = await encodeFrameSequence({
    framesDirectory,
    frameCount: capture.frameCount,
    fps: capture.fps,
    webmPath,
    mp4Path,
    ffmpegPath: options.ffmpegPath ?? DEFAULT_FFMPEG,
  });
  const video = {};
  for (const [kind, filename] of [["webm", webmPath], ["mp4", mp4Path]]) {
    const bytes = await readFile(filename);
    video[kind] = {
      file: path.basename(filename),
      bytes: bytes.length,
      sha256: sha256Buffer(bytes),
      probe: probes[kind],
    };
  }
  await writeNormalizedJson(recordingPath, {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    chronicleId: options.chronicleId,
    viewport: options.viewport,
    fps: RECORDING_FPS,
    frameCount: capture.frameCount,
    durationMs: capture.frameCount * 1000 / RECORDING_FPS,
    timelineSha256: capture.timelineSha256,
    provenance: {
      route: capture.route,
      clock: capture.clock,
      captureMethod: capture.captureMethod,
      playwrightRecordVideo: capture.playwrightRecordVideo,
    },
    lifecycle: capture.lifecycle ?? null,
    frames: capture.frames,
    video,
  });
  await rm(framesDirectory, { recursive: true, force: true });
  await rm(capturePath, { force: true });
  await encodeReducedPreparedViewport(directory, options);
  return "encoded";
}

async function validatePreparedPresentationAuthorityFile(directory, fixture) {
  if (fixture === undefined) throw new Error("prepared viewport requires its trusted fixture contract");
  if (!["C00", "C14", "C15"].includes(fixture.id)) return;
  const authority = trustedTerminalAuthority(fixture, { strictEventless: true });
  if (authority.presentation.kind === "mechanic-story") return;
  const handoffPath = path.join(directory, "capture-raw-observations.json");
  if (!await fileExists(handoffPath)) {
    throw new Error(`${fixture.id} eventless prepared viewport requires raw presentation authority before encoding`);
  }
  validatePreparedPresentationAuthority(await readNormalizedJson(handoffPath), fixture);
}

/** Fail closed on eventless visible authority before lossy prepared-PNG cleanup. */
export function validatePreparedPresentationAuthority(handoff, fixture) {
  assertObject(handoff, "prepared capture raw handoff");
  assertObject(fixture, "prepared capture trusted fixture");
  if (handoff.chronicleId !== fixture.id) {
    throw new Error("prepared capture raw handoff Chronicle differs from trusted fixture");
  }
  if (!["C00", "C14", "C15"].includes(fixture.id)) {
    return { required: false, completed: true };
  }
  const authority = trustedTerminalAuthority(fixture, { strictEventless: true });
  if (authority.presentation.kind === "mechanic-story") {
    return { required: false, completed: true };
  }
  const observed = handoff.observations;
  assertObject(observed, `${fixture.id} prepared capture observations`);
  if (!Array.isArray(observed.eventWitnesses) || observed.eventWitnesses.length !== 0) {
    throw new Error(`${fixture.id} eventless mechanic event witnesses must be exactly empty before encoding`);
  }
  const result = validateEventlessOperationalAuthority({
    chronicleId: fixture.id,
    fixture,
    authority: observed.terminalAuthority,
    workload: observed.operationalWorkload,
    transportWitnesses: observed.transportWitnesses,
    terminalObservation: observed.semanticTerminalObservation,
    network: { requests: handoff.requests?.runtimeRequests ?? [] },
  });
  return deepFreezeForRecord({ required: true, completed: result.completed });
}

function deepFreezeForRecord(value) {
  if (value === null || typeof value !== "object") return value;
  for (const item of Object.values(value)) deepFreezeForRecord(item);
  return Object.freeze(value);
}

async function encodeReducedPreparedViewport(directory, options) {
  const capturePath = path.join(directory, "reduced-capture.json");
  const framesDirectory = path.join(directory, ".reduced-frames");
  const recordingPath = path.join(directory, "reduced-recording.json");
  const [hasCapture, hasFrames, hasRecording] = await Promise.all([
    fileExists(capturePath), fileExists(framesDirectory), fileExists(recordingPath),
  ]);
  if (!hasCapture && !hasFrames && !hasRecording) return;
  if (hasRecording || !hasCapture || !hasFrames) {
    throw new Error(`${options.chronicleId}/${options.viewport} reduced prepared viewport state is incomplete`);
  }
  const capture = await readNormalizedJson(capturePath);
  await validatePreparedCapture(
    directory,
    options.chronicleId,
    options.viewport,
    capture,
    options.expectedMarkers,
    "reduced-markers.json",
    ".reduced-frames",
  );
  const webmPath = path.join(directory, "reduced-video.webm");
  const mp4Path = path.join(directory, "reduced-review.mp4");
  const probes = await encodeFrameSequence({
    framesDirectory,
    frameCount: capture.frameCount,
    fps: capture.fps,
    webmPath,
    mp4Path,
    ffmpegPath: options.ffmpegPath ?? DEFAULT_FFMPEG,
  });
  const video = {};
  for (const [kind, filename] of [["webm", webmPath], ["mp4", mp4Path]]) {
    const bytes = await readFile(filename);
    video[kind] = {
      file: path.basename(filename), bytes: bytes.length,
      sha256: sha256Buffer(bytes), probe: probes[kind],
    };
  }
  await writeNormalizedJson(recordingPath, {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    chronicleId: options.chronicleId,
    viewport: options.viewport,
    captureId: capture.captureId,
    mode: "reduced",
    fps: RECORDING_FPS,
    frameCount: capture.frameCount,
    durationMs: capture.frameCount * 1000 / RECORDING_FPS,
    timelineSha256: capture.timelineSha256,
    provenance: {
      route: capture.route, clock: capture.clock,
      captureMethod: capture.captureMethod,
      playwrightRecordVideo: capture.playwrightRecordVideo,
    },
    lifecycle: capture.lifecycle ?? null,
    frames: capture.frames,
    video,
  });
  await rm(framesDirectory, { recursive: true, force: true });
  await rm(capturePath, { force: true });
}

async function fileExists(filename) {
  try {
    await access(filename);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function validatePreparedCapture(
  directory,
  chronicleId,
  viewport,
  capture,
  expectedMarkers,
  markersFilename = "markers.json",
  frameDirectoryName = ".frames",
) {
  if (capture.schemaVersion !== ARTIFACT_SCHEMA_VERSION || capture.chronicleId !== chronicleId || capture.viewport !== viewport) {
    throw new Error(`${chronicleId}/${viewport}/capture.json identity mismatch`);
  }
  if (capture.route !== "/?renderer=2d") throw new Error(`${chronicleId}/${viewport} capture must use the production /?renderer=2d route`);
  if (capture.clock !== "ManualPresentationClock") throw new Error(`${chronicleId}/${viewport} capture must use ManualPresentationClock`);
  if (capture.captureMethod !== "playwright-page-screenshot" || capture.playwrightRecordVideo !== false) {
    throw new Error(`${chronicleId}/${viewport} capture must use PNG page screenshots with Playwright recordVideo disabled`);
  }
  if (capture.fps !== RECORDING_FPS || !Number.isSafeInteger(capture.frameCount) || capture.frameCount <= 0) {
    throw new Error(`${chronicleId}/${viewport}/capture.json must declare positive exact 30 fps frames`);
  }
  if (!Array.isArray(capture.frames) || capture.frames.length !== capture.frameCount) {
    throw new Error(`${chronicleId}/${viewport} capture frame ledger length mismatch`);
  }
  const timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(capture.frames)));
  if (capture.timelineSha256 !== timelineSha256) {
    throw new Error(`${chronicleId}/${viewport} capture timeline hash is invalid`);
  }
  validateRecordingFrameLedger(capture, {
    label: `${chronicleId}/${viewport} prepared capture`,
    fps: RECORDING_FPS,
  });
  await assertCanonicalFrameSequence(path.join(directory, frameDirectoryName), capture.frameCount);
  for (const [frameIndex, frame] of capture.frames.entries()) {
    assertObject(frame, `${chronicleId}/${viewport} frame ${frameIndex}`);
    const expectedFile = `${frameDirectoryName}/${String(frameIndex).padStart(6, "0")}.png`;
    const exactTime = frameIndex * 1000 / RECORDING_FPS;
    if (frame.frameIndex !== frameIndex || frame.file !== expectedFile) {
      throw new Error(`${chronicleId}/${viewport} frame ledger must be ordered and contiguous at ${frameIndex}`);
    }
    if (!Number.isFinite(frame.presentationTimeMs) || Math.abs(frame.presentationTimeMs - exactTime) > 1e-9) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} presentationTimeMs must equal exact frame time`);
    }
    if (!Number.isFinite(frame.mediaTimeMs) || Math.abs(frame.mediaTimeMs - exactTime) > 1e-9) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} mediaTimeMs must equal exact frame time`);
    }
    if (!Number.isSafeInteger(frame.presentedCursor) || frame.presentedCursor < 0) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} presentedCursor must be non-negative`);
    }
    if (!["live", "archive"].includes(frame.presentedSource)) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} presentedSource is invalid`);
    }
    validateAcceptedFrameIdentity(frame.canvasFrameIdentity, `${chronicleId}/${viewport} Canvas frame ${frameIndex}`);
    validateAcceptedFrameIdentity(frame.observerFrameIdentity, `${chronicleId}/${viewport} observer frame ${frameIndex}`);
    if (canonicalJson(frame.canvasFrameIdentity) !== canonicalJson(frame.observerFrameIdentity)) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} was not accepted by Canvas at the observer revision`);
    }
    if (frame.canvasFrameIdentity.lastCursor < frame.presentedCursor) {
      throw new Error(`${chronicleId}/${viewport} frame ${frameIndex} exposes future public cursor truth`);
    }
    await validateFileReference(frame, directory, `${chronicleId}/${viewport} frame ${frameIndex}`);
  }
  const markers = await readNormalizedJson(path.join(directory, markersFilename));
  await validateMarkerDocument(markers, {
    directory,
    frameCount: capture.frameCount,
    fps: RECORDING_FPS,
  });
  assertSameList([...markers.expected].sort(), [...expectedMarkers].sort(), `${chronicleId}/${viewport} fixture marker set`);
  for (const marker of markers.observed) {
    const frame = capture.frames[marker.frameIndex];
    if (marker.still.bytes !== frame.bytes || marker.still.sha256 !== frame.sha256) {
      throw new Error(`${chronicleId}/${viewport} marker ${marker.id} is not an exact captured frame copy`);
    }
    if (marker.mediaTimeMs !== frame.mediaTimeMs
      || marker.presentationTimeMs !== frame.presentationTimeMs) {
      throw new Error(`${chronicleId}/${viewport} marker ${marker.id} presentation time must equal its exact frame`);
    }
  }
}

function validateAcceptedFrameIdentity(identity, label) {
  assertObject(identity, label);
  for (const field of ["runId", "sourceKey"]) {
    if (typeof identity[field] !== "string" || identity[field].trim() === "") {
      throw new Error(`${label} ${field} must be nonblank`);
    }
  }
  for (const field of ["firstCursor", "lastCursor", "revision"]) {
    if (!Number.isSafeInteger(identity[field]) || identity[field] < 0) {
      throw new Error(`${label} ${field} must be non-negative`);
    }
  }
  if (identity.lastCursor < identity.firstCursor) throw new Error(`${label} cursor range is invalid`);
}

async function validateC03WitnessFile(
  chronicleDirectory,
  chronicleId,
  viewport,
  fixture,
  retainedStandard = undefined,
  retainedReduced = undefined,
  retainedStandardMarkers = undefined,
  retainedReducedMarkers = undefined,
) {
  if (chronicleId !== "C03") return;
  const directory = path.join(chronicleDirectory, viewport);
  const [
    document,
    standardRecording,
    reducedRecording,
    standardMarkers,
    reducedMarkers,
  ] = await Promise.all([
    readNormalizedJson(path.join(directory, "resource-transfer-witness.json")),
    retainedStandard ?? readNormalizedJson(path.join(directory, "recording.json")),
    retainedReduced ?? readNormalizedJson(path.join(directory, "reduced-recording.json")),
    retainedStandardMarkers ?? readNormalizedJson(path.join(directory, "markers.json")),
    retainedReducedMarkers ?? readNormalizedJson(path.join(directory, "reduced-markers.json")),
  ]);
  validateC03ResourceTransferWitnessSidecar(document, {
    chronicleId,
    viewport,
    fixture,
    standardRecording,
    reducedRecording,
    standardMarkers,
    reducedMarkers,
  });
}

/** Validate C03 transfer evidence against trusted payload and retained frame ledgers. */
export function validateC03ResourceTransferWitnessSidecar(document, authority) {
  assertExactKeys(
    document,
    ["schemaVersion", "chronicleId", "viewport", "standard", "reduced"],
    "C03 resource-transfer witness",
  );
  if (document.schemaVersion !== ARTIFACT_SCHEMA_VERSION
    || document.chronicleId !== "C03"
    || document.chronicleId !== authority.chronicleId
    || document.viewport !== authority.viewport
    || !VIEWPORTS.includes(document.viewport)) {
    throw new Error("C03 resource-transfer witness identity mismatch");
  }
  const trusted = trustedC03TransferPayload(authority.fixture);
  const standard = deriveC03TransferEvidence(
    authority.standardRecording,
    authority.standardMarkers,
    trusted,
    document.viewport,
    "standard",
  );
  const reduced = deriveC03TransferEvidence(
    authority.reducedRecording,
    authority.reducedMarkers,
    trusted,
    document.viewport,
    "reduced",
  );
  assertExactC03Evidence(document.standard, "standard C03 resource-transfer witness");
  assertExactC03Evidence(document.reduced, "reduced C03 resource-transfer witness");
  if (canonicalJson(document.standard) !== canonicalJson(standard)) {
    throw new Error("standard C03 resource-transfer witness has retained-ledger canonical drift");
  }
  if (canonicalJson(document.reduced) !== canonicalJson(reduced)) {
    throw new Error("reduced C03 resource-transfer witness has retained-ledger canonical drift");
  }
  if (canonicalJson(document.standard) !== canonicalJson(document.reduced)) {
    throw new Error("C03 resource-transfer witness standard/reduced authority differs");
  }
  return document;
}

function trustedC03TransferPayload(fixture) {
  assertObject(fixture, "C03 trusted fixture");
  if (fixture.id !== "C03" || !Array.isArray(fixture.entries)) {
    throw new Error("C03 resource-transfer witness lacks trusted fixture entries");
  }
  const entries = fixture.entries.filter(({ event }) => event?.type === "resource_transferred");
  if (entries.length !== 1) {
    throw new Error("C03 resource-transfer witness requires exactly one trusted transfer payload");
  }
  const entry = entries[0];
  const payload = entry.event?.payload;
  assertObject(payload, "C03 trusted transfer payload");
  if (!Number.isSafeInteger(entry.cursor) || entry.cursor !== 2
    || payload.sender_id !== "wanderer_001" || payload.receiver_id !== "wanderer_002"
    || payload.resource_type !== "materials" || payload.amount !== 1) {
    throw new Error("C03 resource-transfer witness trusted payload drift");
  }
  return Object.freeze({
    senderId: payload.sender_id,
    receiverId: payload.receiver_id,
    resourceType: payload.resource_type,
    amount: payload.amount,
    cursor: entry.cursor,
  });
}

function deriveC03TransferEvidence(recording, markers, trusted, viewport, mode) {
  assertObject(recording, `${mode} C03 retained recording`);
  if (!Array.isArray(recording.frames) || recording.frames.length === 0) {
    throw new Error(`${mode} C03 retained recording lacks frames`);
  }
  let maximumActiveEffects = 0;
  for (const [frameIndex, frame] of recording.frames.entries()) {
    assertObject(frame, `${mode} C03 retained frame ${frameIndex}`);
    if (!isNonNegativeSafeInteger(frame.activeEffects)) {
      throw new Error(`${mode} C03 retained frame ${frameIndex} activeEffects must be a non-negative safe integer`);
    }
    maximumActiveEffects = Math.max(maximumActiveEffects, frame.activeEffects);
  }
  const transferFrames = recording.frames.filter((frame) => frame.transferFrame !== null
    && frame.transferFrame !== undefined);
  if (transferFrames.length < 5) {
    throw new Error(`${mode} C03 retained transfer continuity is incomplete`);
  }
  const expectedPhases = ["enter", "hold", "consequence", "recover", "exit"];
  let phaseIndex = 0;
  for (const [index, frame] of transferFrames.entries()) {
    const transfer = frame.transferFrame;
    assertObject(transfer, `${mode} C03 retained transfer frame`);
    assertObject(transfer.sender, `${mode} C03 retained sender frame`);
    assertObject(transfer.receiver, `${mode} C03 retained receiver frame`);
    if (!Number.isSafeInteger(frame.frameIndex)
      || transfer.frameIndex !== frame.frameIndex
      || (index > 0 && frame.frameIndex !== transferFrames[index - 1].frameIndex + 1)
      || transfer.phase !== frame.scenePhase
      || typeof transfer.phase !== "string") {
      throw new Error(`${mode} C03 retained transfer frame continuity drift`);
    }
    if (transfer.phase !== expectedPhases[phaseIndex]) {
      if (phaseIndex >= expectedPhases.length - 1
        || transfer.phase !== expectedPhases[phaseIndex + 1]) {
        throw new Error(`${mode} C03 retained transfer phase order or block continuity drift`);
      }
      phaseIndex += 1;
    }
    if (frame.focusSelectionKey !== `agent:${trusted.senderId}`) {
      throw new Error(`${mode} C03 retained transfer sender focus drift`);
    }
    assertObject(transfer.sender.position, `${mode} C03 retained sender position`);
    assertObject(transfer.receiver.position, `${mode} C03 retained receiver position`);
    if (typeof transfer.sender.id !== "string" || transfer.sender.id !== trusted.senderId
      || typeof transfer.receiver.id !== "string" || transfer.receiver.id !== trusted.receiverId
      || !isExactFiniteNumber(transfer.sender.position.x, 1_936)
      || !isExactFiniteNumber(transfer.sender.position.y, 176)
      || !isExactFiniteNumber(transfer.receiver.position.x, 304)
      || !isExactFiniteNumber(transfer.receiver.position.y, 112)) {
      throw new Error(`${mode} C03 retained transfer endpoint position continuity drift`);
    }
    if (!isExactC03Action(transfer.sender.activeAction)
      || !isExactC03Action(transfer.receiver.activeAction)) {
      throw new Error(`${mode} C03 retained transfer activeAction must be a string or null`);
    }
    if (transfer.sender.safeFrameVisible !== true
      || forbiddenC03TransferAction(transfer.sender.activeAction)
      || forbiddenC03TransferAction(transfer.receiver.activeAction)) {
      throw new Error(`${mode} C03 retained transfer contains forbidden movement or reach action`);
    }
  }
  if (phaseIndex !== expectedPhases.length - 1) {
    throw new Error(`${mode} C03 retained transfer phase continuity is incomplete`);
  }
  validateC03TransferMarker(markers, recording, trusted, viewport, mode);
  const consequenceIndex = transferFrames.findIndex(({ transferFrame }) => (
    transferFrame.phase === "consequence"
  ));
  if (consequenceIndex <= 0) {
    throw new Error(`${mode} C03 retained transfer lacks consequence reading authority`);
  }
  const consequenceFrame = transferFrames[consequenceIndex];
  const readingWitness = consequenceFrame.readingWitness;
  validateC03ReadingWitness(readingWitness, viewport, `${mode} C03 consequence`);
  let readingFrameCount = 0;
  for (let index = consequenceIndex - 1; index >= 0; index -= 1) {
    const frame = transferFrames[index];
    if (frame.scenePhase !== "hold") break;
    validateC03ReadingWitness(frame.readingWitness, viewport, `${mode} C03 hold`);
    if (canonicalJson(frame.readingWitness) !== canonicalJson(readingWitness)) {
      throw new Error(`${mode} C03 retained reading witness is interrupted`);
    }
    readingFrameCount += 1;
  }
  const readingHoldMs = readingFrameCount * 1_000 / RECORDING_FPS;
  if (readingHoldMs < 750) throw new Error(`${mode} C03 retained reading hold is too short`);
  if (maximumActiveEffects !== 0) {
    throw new Error(`${mode} C03 retained transfer owns a forbidden canvas transient`);
  }
  return {
    senderId: trusted.senderId,
    senderName: "Joe",
    receiverId: trusted.receiverId,
    receiverName: "Mae",
    resourceType: trusted.resourceType,
    amount: trusted.amount,
    direction: "→",
    text: "Joe gave 1 material to Mae.",
    focusSelectionKey: `agent:${trusted.senderId}`,
    senderSafeFrameVisible: true,
    maximumActiveEffects: 0,
    transferFrameCount: transferFrames.length,
    senderPosition: { x: 1_936, y: 176 },
    receiverPosition: { x: 304, y: 112 },
    readingHoldMs,
    dialogueBounds: { ...readingWitness.bounds },
  };
}

function validateC03ReadingWitness(witness, viewport, label) {
  assertObject(witness, `${label} reading witness`);
  assertExactKeys(
    witness,
    ["owner", "speakerName", "targetName", "direction", "text", "bounds", "viewport"],
    `${label} reading witness`,
  );
  for (const field of ["owner", "speakerName", "targetName", "direction", "text"]) {
    if (typeof witness[field] !== "string") {
      throw new Error(`${label} reading witness ${field} must be a string`);
    }
  }
  assertExactKeys(witness.viewport, ["width", "height"], `${label} viewport`);
  const expectedViewport = viewport === "desktop"
    ? { width: 1_440, height: 900 }
    : { width: 390, height: 844 };
  if (!isExactFiniteNumber(witness.viewport.width, expectedViewport.width)
    || !isExactFiniteNumber(witness.viewport.height, expectedViewport.height)
    || witness.owner !== "vivarium-2d-dialogue-now"
    || witness.speakerName !== "Joe" || witness.targetName !== "Mae"
    || witness.direction !== "→" || witness.text !== "Joe gave 1 material to Mae."
    || canonicalJson(witness.viewport) !== canonicalJson(expectedViewport)) {
    throw new Error(`${label} reading witness attribution or viewport drift`);
  }
  assertExactKeys(witness.bounds, ["x", "y", "width", "height"], `${label} bounds`);
  const bounds = witness.bounds;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every((value) => (
    typeof value === "number" && Number.isFinite(value)
  ))
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > expectedViewport.width
    || bounds.y + bounds.height > expectedViewport.height) {
    throw new Error(`${label} reading witness bounds are clipped`);
  }
}

function validateC03TransferMarker(markers, recording, trusted, viewport, mode) {
  assertObject(markers, `${mode} C03 retained markers`);
  const expectedCaptureId = `C03:${viewport}:reduced`;
  if (markers.schemaVersion !== ARTIFACT_SCHEMA_VERSION
    || markers.chronicleId !== "C03"
    || markers.viewport !== viewport
    || (mode === "reduced" && markers.captureId !== expectedCaptureId)
    || (mode === "standard" && markers.captureId !== undefined)
    || (markers.mode !== undefined && markers.mode !== mode)) {
    throw new Error(`${mode} C03 retained marker document identity mismatch`);
  }
  if (!Array.isArray(markers.observed)) {
    throw new Error(`${mode} C03 retained markers lacks an observed ledger`);
  }
  const matches = markers.observed.filter((marker) => (
    marker !== null
    && typeof marker === "object"
    && !Array.isArray(marker)
    && marker.expectedMarker === "event:resource_transferred"
  ));
  if (matches.length !== 1) {
    throw new Error(`${mode} C03 retained markers require exactly one event:resource_transferred marker`);
  }
  const marker = matches[0];
  if (!Number.isSafeInteger(marker.frameIndex) || marker.frameIndex < 0) {
    throw new Error(`${mode} C03 retained transfer marker frameIndex is invalid`);
  }
  const frame = recording.frames[marker.frameIndex];
  assertObject(frame, `${mode} C03 retained transfer marker frame`);
  assertObject(frame.transferFrame, `${mode} C03 retained transfer marker transfer frame`);
  if (frame.frameIndex !== marker.frameIndex
    || frame.transferFrame.frameIndex !== marker.frameIndex
    || frame.scenePhase !== "consequence"
    || frame.transferFrame.phase !== "consequence"
    || typeof marker.mediaTimeMs !== "number"
    || !Number.isFinite(marker.mediaTimeMs)
    || marker.mediaTimeMs !== frame.mediaTimeMs
    || typeof marker.presentationTimeMs !== "number"
    || !Number.isFinite(marker.presentationTimeMs)
    || marker.presentationTimeMs !== frame.presentationTimeMs) {
    throw new Error(`${mode} C03 retained transfer marker is detached from its consequence frame`);
  }
  validateAcceptedFrameIdentity(
    frame.canvasFrameIdentity,
    `${mode} C03 retained transfer marker Canvas identity`,
  );
  validateAcceptedFrameIdentity(
    frame.observerFrameIdentity,
    `${mode} C03 retained transfer marker observer identity`,
  );
  if (canonicalJson(frame.canvasFrameIdentity) !== canonicalJson(frame.observerFrameIdentity)) {
    throw new Error(`${mode} C03 retained transfer marker has detached accepted identities`);
  }
  if (frame.canvasFrameIdentity.firstCursor > trusted.cursor
    || frame.canvasFrameIdentity.lastCursor < trusted.cursor) {
    throw new Error(`${mode} C03 retained transfer marker identity does not span trusted cursor ${trusted.cursor}`);
  }
}

function isExactFiniteNumber(value, expected) {
  return typeof value === "number" && Number.isFinite(value) && value === expected;
}

function isNonNegativeSafeInteger(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExactC03Action(action) {
  return action === null || typeof action === "string";
}

function forbiddenC03TransferAction(action) {
  return action !== null && /move|reposition|reach|walk|run|teleport/i.test(action);
}

function assertExactC03Evidence(value, label) {
  assertExactKeys(value, [
    "senderId", "senderName", "receiverId", "receiverName", "resourceType", "amount",
    "direction", "text", "focusSelectionKey", "senderSafeFrameVisible",
    "maximumActiveEffects", "transferFrameCount", "senderPosition", "receiverPosition",
    "readingHoldMs", "dialogueBounds",
  ], label);
}

function assertExactKeys(value, keys, label) {
  assertObject(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} must contain exact keys`);
  }
}

async function validateViewport(chronicleDirectory, chronicleId, viewport, ffprobePath, fixtureManifest) {
  const directory = path.join(chronicleDirectory, viewport);
  const files = await readdir(directory);
  for (const required of [...REQUIRED_VIEWPORT_SIDECARS, "video.webm", "review.mp4", "markers"]) {
    if (!files.includes(required)) throw new Error(`${chronicleId}/${viewport} missing ${required}`);
  }
  for (const sidecar of REQUIRED_VIEWPORT_SIDECARS) {
    const value = await readNormalizedJson(path.join(directory, sidecar));
    if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION || value.chronicleId !== chronicleId || value.viewport !== viewport) {
      throw new Error(`${chronicleId}/${viewport}/${sidecar} identity mismatch`);
    }
  }
  const recording = await readNormalizedJson(path.join(directory, "recording.json"));
  if (recording.fps !== RECORDING_FPS) throw new Error(`${chronicleId}/${viewport} recording must use 30 fps`);
  if (!Number.isSafeInteger(recording.frameCount) || recording.frameCount <= 0) throw new Error(`${chronicleId}/${viewport} invalid frameCount`);
  const expectedDurationMs = recording.frameCount * 1000 / RECORDING_FPS;
  if (!Number.isFinite(recording.durationMs) || Math.abs(recording.durationMs - expectedDurationMs) > 1e-6) {
    throw new Error(`${chronicleId}/${viewport} durationMs must derive from exact frames`);
  }
  if (!/^[a-f0-9]{64}$/.test(recording.timelineSha256)) throw new Error(`${chronicleId}/${viewport} invalid timeline hash`);
  if (!Array.isArray(recording.frames) || recording.frames.length !== recording.frameCount) {
    throw new Error(`${chronicleId}/${viewport} retained frame ledger length mismatch`);
  }
  if (recording.timelineSha256 !== sha256Buffer(Buffer.from(canonicalJson(recording.frames)))) {
    throw new Error(`${chronicleId}/${viewport} retained frame ledger hash drift`);
  }
  validateRecordingFrameLedger(recording, {
    label: `${chronicleId}/${viewport} retained recording`,
    fps: RECORDING_FPS,
  });
  for (const [frameIndex, frame] of recording.frames.entries()) {
    const exactTime = frameIndex * 1000 / RECORDING_FPS;
    if (frame.frameIndex !== frameIndex
      || Math.abs(frame.mediaTimeMs - exactTime) > 1e-9
      || Math.abs(frame.presentationTimeMs - exactTime) > 1e-9) {
      throw new Error(`${chronicleId}/${viewport} retained frame ledger timing drift at ${frameIndex}`);
    }
    if (!Number.isSafeInteger(frame.presentedCursor) || frame.presentedCursor < 0) {
      throw new Error(`${chronicleId}/${viewport} retained frame ${frameIndex} presentedCursor must be non-negative`);
    }
    validateAcceptedFrameIdentity(frame.canvasFrameIdentity, `${chronicleId}/${viewport} retained Canvas frame ${frameIndex}`);
    if (canonicalJson(frame.canvasFrameIdentity) !== canonicalJson(frame.observerFrameIdentity)) {
      throw new Error(`${chronicleId}/${viewport} retained Canvas acceptance drift at ${frameIndex}`);
    }
  }
  await validateFileReference(recording.video?.webm, directory, `${chronicleId}/${viewport} WebM`);
  await validateFileReference(recording.video?.mp4, directory, `${chronicleId}/${viewport} MP4`);
  const [webm, mp4] = await Promise.all([
    probeVideo(path.join(directory, recording.video.webm.file), ffprobePath),
    probeVideo(path.join(directory, recording.video.mp4.file), ffprobePath),
  ]);
  assertProbeMatches(webm, recording.video.webm.probe, `${chronicleId}/${viewport} WebM probe`);
  assertProbeMatches(mp4, recording.video.mp4.probe, `${chronicleId}/${viewport} MP4 probe`);
  if (webm.frameCount !== recording.frameCount || mp4.frameCount !== recording.frameCount) throw new Error(`${chronicleId}/${viewport} recorded frame count drift`);
  assertTimingParity(webm, mp4, RECORDING_FPS);
  const markers = await readNormalizedJson(path.join(directory, "markers.json"));
  await validateMarkerDocument(markers, { directory, frameCount: recording.frameCount, fps: RECORDING_FPS });
  assertSameList([...markers.expected].sort(), [...fixtureManifest.expectedMarkers].sort(), `${chronicleId}/${viewport} retained marker set`);
  for (const marker of markers.observed) {
    const frame = recording.frames[marker.frameIndex];
    if (marker.still.bytes !== frame.bytes || marker.still.sha256 !== frame.sha256
      || marker.mediaTimeMs !== frame.mediaTimeMs
      || marker.presentationTimeMs !== frame.presentationTimeMs) {
      throw new Error(`${chronicleId}/${viewport} retained marker ${marker.id} does not match its exact frame ledger`);
    }
  }
  const reducedRecording = await readNormalizedJson(path.join(directory, "reduced-recording.json"));
  const reducedMarkers = await readNormalizedJson(path.join(directory, "reduced-markers.json"));
  if (reducedRecording.chronicleId !== chronicleId || reducedRecording.viewport !== viewport
    || reducedRecording.mode !== "reduced") {
    throw new Error(`${chronicleId}/${viewport} reduced recording identity mismatch`);
  }
  validateRecordingFrameLedger(reducedRecording, {
    label: `${chronicleId}/${viewport} retained reduced recording`,
    fps: RECORDING_FPS,
  });
  await validateMarkerDocument(reducedMarkers, {
    directory, frameCount: reducedRecording.frameCount, fps: RECORDING_FPS,
  });
  await validateFileReference(reducedRecording.video?.webm, directory, `${chronicleId}/${viewport} reduced WebM`);
  await validateFileReference(reducedRecording.video?.mp4, directory, `${chronicleId}/${viewport} reduced MP4`);
  const [standardBytes, reducedBytes] = await Promise.all([
    readFile(path.join(directory, "recording.json")),
    readFile(path.join(directory, "reduced-recording.json")),
  ]);
  if (sha256Buffer(standardBytes) === sha256Buffer(reducedBytes)) {
    throw new Error(`${chronicleId}/${viewport} reduced recording must be independently captured`);
  }
  await validateC03WitnessFile(
    chronicleDirectory,
    chronicleId,
    viewport,
    fixtureManifest,
    recording,
    reducedRecording,
    markers,
    reducedMarkers,
  );
  return { recording, markers };
}

async function revalidateCanonicalSidecars({
  root,
  directory,
  chronicleId,
  viewport,
  expectedFinalCursor,
  analysis,
  retainedRecording,
  retainedMarkers,
}) {
  const documents = Object.fromEntries(await Promise.all(EVIDENCE_SIDECAR_FILES.map(async (filename) => (
    [filename, await readNormalizedJson(path.join(directory, filename))]
  ))));
  const semantic = documents["semantic.json"];
  const cursors = documents["cursors.json"];
  const motion = documents["motion.json"];
  const performance = documents["performance.json"];
  const network = documents["network.json"];
  const assets = documents["assets.json"];
  const reduced = documents["reduced-motion.json"];
  const metrics = documents["viewport.json"];
  validateMotionAgainstRetainedLedger(
    motion,
    retainedRecording,
    retainedMarkers,
    `${chronicleId}/${viewport}`,
  );
  const requests = network.requests;
  if (!Array.isArray(requests) || requests.length === 0) {
    throw new Error(`${chronicleId}/${viewport} network sidecar lacks canonical request evidence`);
  }
  const ledgerSha256 = sha256Buffer(Buffer.from(canonicalJson(requests)));
  const firstRequest = requests[0];
  if (firstRequest === undefined) throw new Error(`${chronicleId}/${viewport} has no request authority`);
  const applicationOrigin = new URL(firstRequest.url).origin;
  const oracle = createCanonicalChronicleEvidenceOracle({
    analysisRoot: analysis.distDir,
    analysisManifestFile: ".vite/manifest.json",
    artifactRoot: root,
    applicationOrigin,
    requestSummaries: {
      [`${chronicleId}/${viewport}`]: { observedCount: requests.length, ledgerSha256 },
    },
  });
  const raw = {
    chronicleId,
    viewport,
    expectedFinalCursor,
    semantic: {
      terminalObservation: semantic.terminalObservation,
      terminalCameraWitness: semantic.terminalCameraWitness,
      terminalAuthority: semantic.terminalAuthority,
      operationalWorkload: semantic.operationalWorkload,
      transportWitnesses: semantic.transportWitnesses,
      eventWitnesses: semantic.eventWitnesses,
      endpoints: semantic.endpoints,
      consequences: semantic.consequences,
      markers: semantic.markers,
    },
    cursors: { samples: cursors.samples, gaps: cursors.gaps },
    motion: {
      frames: motion.frames,
      trajectorySamples: motion.trajectory,
      homeOwnershipSegments: motion.homeOwnershipSegments,
      regionTransitionWitnesses: motion.regionTransitions,
      markerFrames: motion.markerFrames,
      checkpointWitnesses: motion.checkpointWitnesses,
      placementCheckpoints: motion.placementCheckpoints,
    },
    performance: {
      drawSamplesMs: performance.draw.samplesMs,
      longTasksMs: performance.longTasks.samplesMs,
      cadenceWindows: performance.cadence,
      runtimeSamples: performance.runtimeSamples,
      schedulerSamples: performance.scheduler.samples,
      archiveObservations: performance.archive.observations,
      lifecycle: performance.lifecycle,
    },
    network: { requests: network.requests },
    assets: {
      raster: assets.raster,
      environmentSamples: assets.environmentSamples,
      poolSamples: assets.poolSamples,
      atlasSamples: assets.atlasSamples,
    },
    reducedMotion: {
      standard: denormalizeMotionMode(reduced.standard),
      reduced: denormalizeMotionMode(reduced.reduced),
    },
    viewportMetrics: {
      width: metrics.width, height: metrics.height,
      devicePixelRatio: metrics.devicePixelRatio,
    },
  };
  const rebuilt = await oracle.buildViewportEvidence(raw);
  for (const filename of EVIDENCE_SIDECAR_FILES) {
    if (canonicalJson(rebuilt[filename]) !== canonicalJson(documents[filename])) {
      throw new Error(`${chronicleId}/${viewport}/${filename} canonical oracle drift`);
    }
  }
}

function validateMotionAgainstRetainedLedger(motion, recording, markers, label) {
  assertObject(motion, `${label} motion sidecar`);
  assertObject(recording, `${label} retained recording`);
  assertObject(markers, `${label} retained markers`);
  if (!Array.isArray(recording.frames)) throw new Error(`${label} retained recording lacks a frame ledger`);
  const retainedFrameIndices = recording.frames.map(({ frameIndex }) => frameIndex);
  const retainedByIndex = new Map(recording.frames.map((frame) => [frame.frameIndex, frame]));
  const retainedFrame = (frameIndex, claim) => {
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || !retainedByIndex.has(frameIndex)) {
      throw new Error(`${label} ${claim} frame ${String(frameIndex)} is absent from the retained recording`);
    }
    return retainedByIndex.get(frameIndex);
  };

  if (!Array.isArray(motion.frames) || motion.frames.length === 0) {
    throw new Error(`${label} motion sidecar has no frame claims`);
  }
  const claimedMotionFrames = new Set();
  for (const frame of motion.frames) {
    const retained = retainedFrame(frame?.frameIndex, "motion");
    if (claimedMotionFrames.has(frame.frameIndex)) {
      throw new Error(`${label} motion frame ${frame.frameIndex} is claimed more than once`);
    }
    claimedMotionFrames.add(frame.frameIndex);
    if (frame.cursor !== retained.presentedCursor) {
      throw new Error(`${label} motion frame ${frame.frameIndex} cursor differs from the retained recording`);
    }
  }
  const motionFrameIndices = motion.frames.map(({ frameIndex }) => frameIndex);
  if (canonicalJson(motionFrameIndices) !== canonicalJson(retainedFrameIndices)) {
    throw new Error(`${label} motion frames must match the exact retained recording order`);
  }

  if (!Array.isArray(motion.regionTransitions)) {
    throw new Error(`${label} motion sidecar lacks region-transition claims`);
  }
  for (const transition of motion.regionTransitions) {
    const retained = retainedFrame(transition?.observedFrameIndex, "transition");
    if (canonicalJson(transition.frameIdentity) !== canonicalJson(retained.canvasFrameIdentity)) {
      throw new Error(`${label} transition frame ${transition.observedFrameIndex} identity differs from the retained recording`);
    }
    if (!Number.isFinite(transition.observedPresentationTimeMs)
      || Math.abs(transition.observedPresentationTimeMs - retained.presentationTimeMs) > 1e-9) {
      throw new Error(`${label} transition frame ${transition.observedFrameIndex} time differs from the retained recording`);
    }
  }

  if (!Array.isArray(motion.trajectory)) throw new Error(`${label} motion sidecar lacks trajectory claims`);
  for (const sample of motion.trajectory) retainedFrame(sample?.frameIndex, "trajectory");
  const trajectoryFrameIndices = motion.trajectory.map(({ frameIndex }) => frameIndex);
  if (canonicalJson(trajectoryFrameIndices) !== canonicalJson(retainedFrameIndices)) {
    throw new Error(`${label} trajectory frames must match the exact retained recording order`);
  }

  if (!Array.isArray(markers.observed)) throw new Error(`${label} retained markers lack observations`);
  const retainedMarkerFrames = {};
  for (const marker of markers.observed) {
    if (Object.hasOwn(retainedMarkerFrames, marker.expectedMarker)) {
      throw new Error(`${label} retained markers contain duplicate authority for ${marker.expectedMarker}`);
    }
    retainedFrame(marker.frameIndex, `retained marker ${marker.expectedMarker}`);
    retainedMarkerFrames[marker.expectedMarker] = marker.frameIndex;
  }
  if (canonicalJson(motion.markerFrames) !== canonicalJson(retainedMarkerFrames)) {
    throw new Error(`${label} motion markerFrames disagree with the retained markers ledger`);
  }

  if (!Array.isArray(motion.placementCheckpoints)) {
    throw new Error(`${label} motion sidecar lacks placement checkpoints`);
  }
  for (const checkpoint of motion.placementCheckpoints) {
    const frame = motion.frames.find((candidate) => candidate.cursor === checkpoint?.cursor);
    if (frame === undefined) {
      throw new Error(`${label} placement checkpoint cursor ${String(checkpoint?.cursor)} lacks a retained motion frame`);
    }
    retainedFrame(frame.frameIndex, `placement checkpoint cursor ${checkpoint.cursor}`);
  }
}

function denormalizeMotionMode(mode) {
  return {
    captureId: mode.captureId,
    mode: mode.mode,
    artifactDirectory: path.posix.dirname(mode.recording.file),
    endpoints: mode.endpoints,
    consequences: mode.consequences,
    markerOrder: mode.markerOrder,
    labels: mode.labels,
    readingHoldsMs: mode.readingHoldsMs,
    terminalCameraWitness: mode.terminalCameraWitness,
  };
}

export async function validateContactSheet(directory, chronicleId) {
  const sidecar = await readNormalizedJson(path.join(directory, "contact-sheet.json"));
  if (sidecar.schemaVersion !== ARTIFACT_SCHEMA_VERSION || sidecar.chronicleId !== chronicleId) throw new Error(`${chronicleId} contact sheet identity mismatch`);
  await validateFileReference(sidecar.image, directory, `${chronicleId} contact sheet image`);
  if (!Array.isArray(sidecar.cells) || sidecar.cells.length === 0) throw new Error(`${chronicleId} contact sheet has no labeled cells`);
  for (const cell of sidecar.cells) {
    if (typeof cell.label !== "string" || cell.label.trim() === "") throw new Error(`${chronicleId} contact sheet has blank label`);
    await validateFileReference(cell.source, directory, `${chronicleId} contact sheet source`);
  }
  const expectedCells = [];
  for (const viewport of VIEWPORTS) {
    const markers = await readNormalizedJson(path.join(directory, viewport, "markers.json"));
    expectedCells.push(...markers.observed.map((marker) => ({
      markerId: marker.id,
      label: `${chronicleId} · ${viewport.toUpperCase()} · ${marker.label}`,
      viewport,
      frameIndex: marker.frameIndex,
      mediaTimeMs: marker.mediaTimeMs,
      source: {
        file: `${viewport}/${marker.still.file}`,
        bytes: marker.still.bytes,
        sha256: marker.still.sha256,
      },
    })));
  }
  const normalizedCells = sidecar.cells.map((cell) => ({
    markerId: cell.markerId,
    label: cell.label,
    viewport: cell.viewport,
    frameIndex: cell.frameIndex,
    mediaTimeMs: cell.mediaTimeMs,
    source: cell.source,
  }));
  if (canonicalJson(normalizedCells) !== canonicalJson(expectedCells)) {
    throw new Error(`${chronicleId} contact sheet marker cell cross-link drift`);
  }
}

function assertProbeMatches(actual, recorded, label) {
  if (canonicalJson(actual) !== canonicalJson(recorded)) throw new Error(`${label} is stale`);
}

function validateChronicleMetadata(manifest, entry) {
  assertObject(manifest, `${entry.id} manifest`);
  if (manifest.schemaVersion !== ARTIFACT_SCHEMA_VERSION) throw new Error(`${entry.id} manifest schemaVersion must be 1`);
  const actual = manifest.chronicle;
  for (const key of ["id", "slug", "version", "seed", "runId", "expectedFinalCursor"]) {
    if (actual?.[key] !== entry[key]) throw new Error(`${entry.id} manifest ${key} drift`);
  }
  if (actual.fixture?.file !== entry.file) throw new Error(`${entry.id} fixture path drift`);
}

async function readCatalog(catalogPath, allowPartialCatalog = false) {
  const catalog = await readNormalizedJson(catalogPath);
  if (catalog.schema !== 1 || !Array.isArray(catalog.chronicles) || catalog.chronicles.length === 0) throw new Error("Chronicle catalog must be schema 1 and nonempty");
  const ids = [];
  for (const entry of catalog.chronicles) {
    assertChronicleId(entry.id);
    if (ids.includes(entry.id)) throw new Error(`duplicate Chronicle catalog id ${entry.id}`);
    ids.push(entry.id);
    if (typeof entry.file !== "string" || path.basename(entry.file) !== entry.file) throw new Error(`${entry.id} fixture file must be a basename`);
  }
  if (!allowPartialCatalog && JSON.stringify(ids) !== JSON.stringify(COMPLETE_CHRONICLE_IDS)) {
    throw new Error(`recording catalog must contain exact C00-C17 order`);
  }
  return catalog;
}

async function chronicleDirectories(root) {
  return (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^C(?:0[0-9]|1[0-7])$/.test(entry.name))
    .map(({ name }) => name).sort();
}

function assertSameList(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch expected=${expected.join(",")} actual=${actual.join(",")}`);
}

export function assertArtifactLayout(files, chronicleId) {
  const required = ["contact-sheet.json", "contact-sheet.png"];
  for (const viewport of VIEWPORTS) {
    required.push(
      `${viewport}/video.webm`,
      `${viewport}/review.mp4`,
      `${viewport}/reduced-video.webm`,
      `${viewport}/reduced-review.mp4`,
      `${viewport}/reduced-recording.json`,
      `${viewport}/reduced-markers.json`,
      ...REQUIRED_VIEWPORT_SIDECARS.map((sidecar) => `${viewport}/${sidecar}`),
    );
    if (chronicleId === "C03") required.push(`${viewport}/resource-transfer-witness.json`);
  }
  const allowed = new Set(required);
  const unexpected = files.filter((file) => !allowed.has(file)
    && !VIEWPORTS.some((viewport) => new RegExp(`^${viewport}/markers/[^/]+\\.png$`).test(file)));
  if (unexpected.length > 0) throw new Error(`${chronicleId} unexpected evidence artifact ${unexpected.join(",")}`);
  const missing = required.filter((file) => !files.includes(file));
  if (missing.length > 0) throw new Error(`${chronicleId} missing required evidence artifact ${missing.join(",")}`);
}

function defaultCatalogPath() {
  return fileURLToPath(new URL("../../tests/frontend-app/fixtures/chronicles/data/catalog.json", import.meta.url));
}

function parseFraction(value, label) {
  const match = /^(\d+)\/(\d+)$/.exec(String(value));
  if (!match || Number(match[2]) === 0) throw new Error(`invalid ffprobe ${label}: ${String(value)}`);
  return [Number(match[1]), Number(match[2])];
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function main(argv) {
  const preparedViewport = optionValue(argv, "--prepared-viewport", false);
  if (preparedViewport !== null) {
    const chronicleId = optionValue(argv, "--chronicle-id");
    const viewport = optionValue(argv, "--viewport-name");
    const fixturePath = optionValue(argv, "--fixture");
    if (!chronicleId || !VIEWPORTS.includes(viewport) || !fixturePath) {
      throw new Error("usage: record-2d-chronicles.mjs --prepared-viewport <directory> --chronicle-id <C00..C17> --viewport-name <desktop|mobile> --fixture <manifest.json>");
    }
    assertChronicleId(chronicleId);
    const fixture = JSON.parse(await readFile(path.resolve(fixturePath), "utf8"));
    const result = await encodePreparedViewport(path.resolve(preparedViewport), {
      chronicleId,
      viewport,
      expectedMarkers: fixture.expectedMarkers,
      fixture,
    });
    process.stdout.write(`${JSON.stringify({ [result]: `${chronicleId}/${viewport}` })}\n`);
    return;
  }
  const output = optionValue(argv, "--output");
  const catalogPath = optionValue(argv, "--catalog", false);
  if (!output || (!argv.includes("--check") && !argv.includes("--all"))) {
    throw new Error("usage: record-2d-chronicles.mjs --check|--all --output <directory>");
  }
  const options = catalogPath ? { catalogPath } : {};
  if (argv.includes("--all")) {
    const encoded = await encodePreparedEvidenceTree(output, options);
    process.stdout.write(`${JSON.stringify({ encoded })}\n`);
    return;
  }
  const result = await validateEvidenceTree(output, options);
  process.stdout.write(`${JSON.stringify({ checked: path.resolve(output), ...result })}\n`);
}

function optionValue(argv, name, required = true) {
  const index = argv.indexOf(name);
  const value = index < 0 ? null : argv[index + 1] ?? null;
  if (required && value === null) return null;
  return value;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
