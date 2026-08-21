import assert from "node:assert/strict";
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  assertTimingParity,
  assertArtifactLayout,
  encodeFrameSequence,
  encodePreparedEvidenceTree,
  probeVideo,
  sealEvidenceTree,
  validatePreparedPresentationAuthority,
  validateEvidenceTree,
  validateC03ResourceTransferWitnessSidecar,
} from "./record-2d-chronicles.mjs";
import { buildChronicleContactSheet } from "./build-2d-chronicle-contact-sheets.mjs";
import { buildProductionStageAnalysis } from "./build-production-stage-analysis.mjs";
import {
  createCanonicalChronicleEvidenceOracle,
  trustedTerminalAuthority,
} from "./chronicle-evidence-oracles.mjs";
import {
  REQUIRED_VIEWPORT_SIDECARS,
  canonicalJson,
  listFilesRecursively,
  sha256Buffer,
} from "./recording-artifacts.mjs";

test("encodes timing-identical 30 fps WebM and MP4 from one canonical PNG sequence", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-video-"));
  try {
    const frames = path.join(root, "frames");
    await mkdir(frames);
    for (let index = 0; index < 4; index += 1) {
      await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: index * 40, g: 80, b: 120, alpha: 1 } } })
        .png()
        .toFile(path.join(frames, `${String(index).padStart(6, "0")}.png`));
    }
    const webm = path.join(root, "video.webm");
    const mp4 = path.join(root, "review.mp4");
    await encodeFrameSequence({ framesDirectory: frames, frameCount: 4, fps: 30, webmPath: webm, mp4Path: mp4 });
    const [webmProbe, mp4Probe] = await Promise.all([probeVideo(webm), probeVideo(mp4)]);
    assert.equal(webmProbe.frameCount, 4);
    assert.equal(mp4Probe.frameCount, 4);
    assertTimingParity(webmProbe, mp4Probe, 30);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("timing parity rejects frame duplication, fps drift, and duration retiming", () => {
  const canonical = { frameCount: 90, fpsNumerator: 30, fpsDenominator: 1, durationSeconds: 3 };
  assert.throws(() => assertTimingParity(canonical, { ...canonical, frameCount: 91 }, 30), /frame count/);
  assert.throws(() => assertTimingParity(canonical, { ...canonical, fpsNumerator: 30000, fpsDenominator: 1001 }, 30), /30 fps/);
  assert.throws(() => assertTimingParity(canonical, { ...canonical, durationSeconds: 3.1 }, 30), /duration/);
});

test("RED C03 witness layout is required only for C03 and forbidden everywhere else", () => {
  const base = canonicalArtifactLayout();
  assert.throws(() => assertArtifactLayout(base, "C03"), /missing.*resource-transfer-witness/i);
  assert.doesNotThrow(() => assertArtifactLayout([
    ...base,
    "desktop/resource-transfer-witness.json",
    "mobile/resource-transfer-witness.json",
  ], "C03"));
  assert.throws(() => assertArtifactLayout([
    ...base,
    "desktop/resource-transfer-witness.json",
  ], "C01"), /unexpected.*resource-transfer-witness/i);
});

test("RED C03 witness sidecar rejects missing, malformed, and retained-ledger-stale authority", () => {
  const authority = validC03WitnessAuthority("desktop");
  assert.doesNotThrow(() => validateC03ResourceTransferWitnessSidecar(authority.document, authority));

  const missing = structuredClone(authority.document);
  delete missing.standard.amount;
  assert.throws(
    () => validateC03ResourceTransferWitnessSidecar(missing, authority),
    /exact keys|amount/i,
  );
  const malformed = structuredClone(authority.document);
  malformed.standard.resourceType = "energy";
  assert.throws(
    () => validateC03ResourceTransferWitnessSidecar(malformed, authority),
    /trusted|resource|canonical/i,
  );
  const stale = structuredClone(authority.document);
  stale.standard.readingHoldMs += 1;
  assert.throws(
    () => validateC03ResourceTransferWitnessSidecar(stale, authority),
    /retained|canonical|drift/i,
  );
  const detached = structuredClone(authority);
  detached.standardRecording.frames[8].transferFrame.sender.position.x += 1;
  assert.throws(
    () => validateC03ResourceTransferWitnessSidecar(authority.document, detached),
    /position|continuity|retained/i,
  );
});

test("RED C03 retained witness rejects phase, index, and exact-type adversaries", () => {
  const base = validC03WitnessAuthority("desktop");
  const rejectsMutation = (label, mutate) => {
    const authority = structuredClone(base);
    mutate(authority.standardRecording.frames);
    assert.throws(
      () => validateC03ResourceTransferWitnessSidecar(authority.document, authority),
      /C03|retained|reading|continuity|position|action|effect/i,
      label,
    );
  };

  rejectsMutation("shuffled phase blocks", (frames) => {
    [frames[1].scenePhase, frames[24].scenePhase] = [frames[24].scenePhase, frames[1].scenePhase];
    [frames[1].transferFrame.phase, frames[24].transferFrame.phase] = [
      frames[24].transferFrame.phase,
      frames[1].transferFrame.phase,
    ];
  });
  rejectsMutation("phase re-entry after consequence", (frames) => {
    const reentry = structuredClone(frames[23]);
    reentry.scenePhase = "hold";
    reentry.transferFrame.phase = "hold";
    frames.splice(25, 0, reentry);
    frames.forEach((frame, frameIndex) => {
      frame.frameIndex = frameIndex;
      frame.transferFrame.frameIndex = frameIndex;
    });
  });
  rejectsMutation("frame-index gap", (frames) => {
    frames[10].frameIndex = 11;
    frames[10].transferFrame.frameIndex = 11;
  });
  rejectsMutation("extra phase", (frames) => {
    frames[25].scenePhase = "celebrate";
    frames[25].transferFrame.phase = "celebrate";
  });

  for (const [label, value] of [
    ["null activeEffects", null],
    ["string activeEffects", "0"],
    ["negative activeEffects", -1],
    ["fractional activeEffects", 0.5],
    ["NaN activeEffects", Number.NaN],
  ]) {
    rejectsMutation(label, (frames) => { frames[4].activeEffects = value; });
  }
  rejectsMutation("object activeAction", (frames) => {
    frames[4].transferFrame.sender.activeAction = { kind: "idle" };
  });
  rejectsMutation("numeric activeAction", (frames) => {
    frames[4].transferFrame.receiver.activeAction = 0;
  });
  rejectsMutation("teleport activeAction", (frames) => {
    frames[4].transferFrame.sender.activeAction = "teleport";
  });
  rejectsMutation("string endpoint position", (frames) => {
    frames[4].transferFrame.sender.position.x = "1936";
  });
  rejectsMutation("malformed endpoint position", (frames) => {
    frames[4].transferFrame.receiver.position = null;
  });
  rejectsMutation("numeric endpoint id", (frames) => {
    frames[4].transferFrame.sender.id = 1;
  });
  rejectsMutation("numeric reading field", (frames) => {
    frames[24].readingWitness.speakerName = 7;
  });
  rejectsMutation("string reading bound", (frames) => {
    frames[24].readingWitness.bounds.x = "128";
  });
  rejectsMutation("string reading viewport", (frames) => {
    frames[24].readingWitness.viewport.width = "1440";
  });
});

test("RED C03 retained witness binds its unique marker and accepted frame identity", () => {
  const base = validC03WitnessAuthority("desktop");
  const rejectsAuthority = (label, mutate) => {
    const authority = structuredClone(base);
    mutate(authority);
    assert.throws(
      () => validateC03ResourceTransferWitnessSidecar(authority.document, authority),
      /C03|marker|consequence|cursor|identity|acceptance/i,
      label,
    );
  };

  rejectsAuthority("missing standard transfer marker", (authority) => {
    authority.standardMarkers.observed = [];
  });
  rejectsAuthority("duplicate standard transfer marker", (authority) => {
    authority.standardMarkers.observed.push(structuredClone(authority.standardMarkers.observed[0]));
  });
  rejectsAuthority("wrong standard marker event", (authority) => {
    authority.standardMarkers.observed[0].expectedMarker = "event:resource_changed";
  });
  rejectsAuthority("foreign standard marker chronicle", (authority) => {
    authority.standardMarkers.chronicleId = "C04";
  });
  rejectsAuthority("foreign standard marker viewport", (authority) => {
    authority.standardMarkers.viewport = "mobile";
  });
  rejectsAuthority("foreign reduced marker capture", (authority) => {
    authority.reducedMarkers.captureId = "C03:mobile:reduced";
  });
  rejectsAuthority("marker points at recover rather than consequence", (authority) => {
    authority.standardMarkers.observed[0].frameIndex = 25;
  });
  rejectsAuthority("accepted frame does not span trusted cursor", (authority) => {
    const frame = authority.standardRecording.frames[24];
    frame.canvasFrameIdentity.lastCursor = 1;
    frame.observerFrameIdentity.lastCursor = 1;
  });
  rejectsAuthority("Canvas and observer identity are detached", (authority) => {
    authority.standardRecording.frames[24].observerFrameIdentity.sourceKey = "live:detached";
  });
  rejectsAuthority("reduced marker points at hold", (authority) => {
    authority.reducedMarkers.observed[0].frameIndex = 23;
  });
});

test("prepared eventless capture validates visible authority before PNG cleanup", async () => {
  const fixture = JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data/C00-world-four-regions-topology.json",
  ), "utf8"));
  const authority = trustedTerminalAuthority(fixture);
  const endpoint = {
    source: "live", runId: fixture.runId,
    sourceKey: `live:${fixture.runId}`, cursor: 0,
  };
  const workload = (label, completed) => ({
    workload: "ambient", label, mechanicFinalCursor: 0,
    selected: endpoint, live: endpoint, completed,
  });
  const transport = (sequence, kind) => ({
    sequence, kind, sourceId: 1, sourceRunId: fixture.runId,
    url: "/api/events/stream?cursor=0", cursor: 0,
    envelopeRunId: null, overflow: null, snapshotRequired: null,
    eventCount: null, envelope: null, disposition: "accepted",
  });
  const handoff = {
    chronicleId: "C00",
    requests: { runtimeRequests: [] },
    observations: {
      terminalAuthority: authority,
      operationalWorkload: { trace: [
        workload("live-0", false), workload("terminal-live-0", true),
      ] },
      transportWitnesses: [transport(1, "open"), transport(2, "close")],
      eventWitnesses: [],
      semanticTerminalObservation: {
        activeSceneCount: 0, pendingMoments: 0, presentedCursor: 0,
        observerFrameIdentity: {
          runId: endpoint.runId, sourceKey: endpoint.sourceKey,
        },
      },
    },
  };
  assert.deepEqual(validatePreparedPresentationAuthority(handoff, fixture), {
    required: true, completed: true,
  });
  const fabricated = structuredClone(handoff);
  fabricated.observations.semanticTerminalObservation.activeSceneCount = 1;
  assert.throws(() => validatePreparedPresentationAuthority(fabricated, fixture), /presentation terminal/);
  const downgraded = structuredClone(handoff);
  delete downgraded.observations.terminalAuthority.presentation;
  assert.throws(() => validatePreparedPresentationAuthority(downgraded, fixture), /differs from trusted fixture authority/);
  const fabricatedMechanic = structuredClone(handoff);
  fabricatedMechanic.observations.eventWitnesses.push({
    kind: "envelope", disposition: "accepted", cursor: 1,
    envelope: { next_cursor: 1, events: [{ cursor: 1 }] },
  });
  assert.throws(
    () => validatePreparedPresentationAuthority(fabricatedMechanic, fixture),
    /mechanic event witnesses must be exactly empty/,
  );
  const missingWitnessLedger = structuredClone(handoff);
  delete missingWitnessLedger.observations.eventWitnesses;
  assert.throws(
    () => validatePreparedPresentationAuthority(missingWitnessLedger, fixture),
    /mechanic event witnesses must be exactly empty/,
  );
});

test("missing conversion support fails clearly instead of omitting MP4", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-no-ffmpeg-"));
  try {
    await sharp({ create: { width: 8, height: 8, channels: 4, background: "#000" } }).png()
      .toFile(path.join(root, "000000.png"));
    await assert.rejects(
      encodeFrameSequence({ framesDirectory: root, frameCount: 1, fps: 30, webmPath: path.join(root, "a.webm"), mp4Path: path.join(root, "a.mp4"), ffmpegPath: "/definitely/missing/ffmpeg" }),
      /ffmpeg.*unavailable/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared capture rejects a frame whose manual presentation time drifts from exact 30 fps", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-capture-timeline-"));
  try {
    const fixtures = path.join(root, "fixtures");
    const evidence = path.join(root, "evidence");
    await Promise.all([mkdir(fixtures), mkdir(evidence)]);
    const fixtureName = "C03-synthetic.json";
    await writeFile(path.join(fixtures, fixtureName), canonicalJson({ id: "C03" }));
    const catalogPath = path.join(fixtures, "catalog.json");
    await writeFile(catalogPath, canonicalJson({ schema: 1, chronicles: [{
      id: "C03", slug: "synthetic", file: fixtureName, version: 1, seed: 30003,
      runId: "mock-c03-v1", expectedFinalCursor: 1,
    }] }));
    await writePreparedChronicle(evidence);
    const capturePath = path.join(evidence, "C03", "desktop", "capture.json");
    const capture = JSON.parse(await readFile(capturePath, "utf8"));
    capture.frames[1].presentationTimeMs = 34;
    capture.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(capture.frames)));
    await writeFile(capturePath, canonicalJson(capture));

    await assert.rejects(
      encodePreparedEvidenceTree(evidence, {
        catalogPath,
        fixtureDirectory: fixtures,
        allowPartialCatalog: true,
      }),
      /presentationTimeMs.*exact frame time/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared capture retains the ordered accepted-frame ledger after canonical PNG cleanup", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-retained-ledger-"));
  try {
    const fixtures = path.join(root, "fixtures");
    const evidence = path.join(root, "evidence");
    await Promise.all([mkdir(fixtures), mkdir(evidence)]);
    const fixtureName = "C03-synthetic.json";
    await writeFile(path.join(fixtures, fixtureName), canonicalJson({
      id: "C03",
      expectedMarkers: ["event:resource_changed"],
    }));
    const catalogPath = path.join(fixtures, "catalog.json");
    await writeFile(catalogPath, canonicalJson({ schema: 1, chronicles: [{
      id: "C03", slug: "synthetic", file: fixtureName, version: 1, seed: 30003,
      runId: "mock-c03-v1", expectedFinalCursor: 1,
    }] }));
    await writePreparedChronicle(evidence);

    await encodePreparedEvidenceTree(evidence, {
      catalogPath,
      fixtureDirectory: fixtures,
      allowPartialCatalog: true,
    });

    const directory = path.join(evidence, "C03", "desktop");
    const recording = JSON.parse(await readFile(path.join(directory, "recording.json"), "utf8"));
    assert.equal(recording.frames.length, 2);
    assert.deepEqual(recording.frames.map((frame) => frame.frameIndex), [0, 1]);
    assert.deepEqual(recording.frames.map((frame) => frame.presentationTimeMs), [0, 1000 / 30]);
    assert.equal(
      recording.timelineSha256,
      sha256Buffer(Buffer.from(canonicalJson(recording.frames))),
    );
    assert.deepEqual(
      recording.frames.map((frame) => frame.canvasFrameIdentity),
      recording.frames.map((frame) => frame.observerFrameIdentity),
    );
    assert.deepEqual(await encodePreparedEvidenceTree(evidence, {
      catalogPath,
      fixtureDirectory: fixtures,
      allowPartialCatalog: true,
    }), [], "already-encoded viewports must be skipped without rewriting evidence");
    await assert.rejects(readFile(path.join(directory, "capture.json")), /ENOENT/);
    await assert.rejects(readFile(path.join(directory, ".frames", "000000.png")), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prepared capture rejects a marker whose presentation time does not match its exact PNG frame", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-marker-frame-time-"));
  try {
    const fixtures = path.join(root, "fixtures");
    const evidence = path.join(root, "evidence");
    await Promise.all([mkdir(fixtures), mkdir(evidence)]);
    const fixtureName = "C03-synthetic.json";
    await writeFile(path.join(fixtures, fixtureName), canonicalJson({
      id: "C03",
      expectedMarkers: ["event:resource_changed"],
    }));
    const catalogPath = path.join(fixtures, "catalog.json");
    await writeFile(catalogPath, canonicalJson({ schema: 1, chronicles: [{
      id: "C03", slug: "synthetic", file: fixtureName, version: 1, seed: 30003,
      runId: "mock-c03-v1", expectedFinalCursor: 1,
    }] }));
    await writePreparedChronicle(evidence);
    const markersPath = path.join(evidence, "C03", "desktop", "markers.json");
    const markers = JSON.parse(await readFile(markersPath, "utf8"));
    markers.observed[0].presentationTimeMs = 1;
    await writeFile(markersPath, canonicalJson(markers));

    await assert.rejects(encodePreparedEvidenceTree(evidence, {
      catalogPath,
      fixtureDirectory: fixtures,
      allowPartialCatalog: true,
    }), /marker.*presentation time.*exact frame/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// 60_000, re-derived by measurement on 2026-08-21 after this test timed out in CI at
// 30_000 while passing locally. It is not slow because it is broken -- before ffmpeg was
// installed on the runner it crashed in milliseconds, so its real cost had never been
// observed anywhere. Measured here: 12,246 / 14,072 ms isolated, 14,025 / 18,040 ms
// inside the full `node --test` run (four files in parallel). The GitHub runner is a
// further ~1.5x, which puts the heaviest contended case around 27s -- under the old
// bound only until run-to-run variance pushed it over, which is exactly what CI hit.
// Bound = ceil(18,040 heaviest contended x 1.5 runner x 2 variance), the same derivation
// the repo uses elsewhere. Its two 120_000 siblings measure 23,663 ms and are genuinely
// heavier; the other four 30_000 tests in this file all finish under 8s and are
// deliberately left alone. This declares a wall-clock cost only -- no assertion changes,
// and a genuine hang still fails here rather than running forever.
test("seals and strictly checks recursive artifact hashes, normalized sidecars, and stale files", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-tree-"));
  try {
    const fixtures = path.join(root, "fixtures");
    const evidence = path.join(root, "evidence");
    await Promise.all([mkdir(fixtures), mkdir(evidence)]);
    const fixtureName = "C03-synthetic.json";
    const fixture = Buffer.from(canonicalJson({
      id: "C03",
      entries: [{ cursor: 2, event: { type: "resource_transferred", payload: {
        sender_id: "wanderer_001", receiver_id: "wanderer_002",
        resource_type: "materials", amount: 1,
      } } }],
      expectedMarkers: ["event:resource_transferred"],
    }));
    await writeFile(path.join(fixtures, fixtureName), fixture);
    const catalogPath = path.join(fixtures, "catalog.json");
    await writeFile(catalogPath, canonicalJson({ schema: 1, chronicles: [{
      id: "C03", slug: "synthetic", file: fixtureName, version: 1, seed: 30003,
      runId: "mock-c03-v1", expectedFinalCursor: 0,
    }] }));
    await writeSyntheticChronicle(evidence);
    await buildChronicleContactSheet(path.join(evidence, "C03"));
    await assert.rejects(sealEvidenceTree(evidence, { catalogPath, fixtureDirectory: fixtures }), /exact C00-C17/);
    const partialOptions = { catalogPath, fixtureDirectory: fixtures, allowPartialCatalog: true };
    const witnessPath = path.join(evidence, "C03", "desktop", "resource-transfer-witness.json");
    const witnessBytes = await readFile(witnessPath);
    await unlink(witnessPath);
    await assert.rejects(sealEvidenceTree(evidence, partialOptions), /missing.*resource-transfer-witness/i);
    await writeFile(witnessPath, witnessBytes);
    const malformedWitness = JSON.parse(witnessBytes.toString("utf8"));
    delete malformedWitness.standard.amount;
    await writeFile(witnessPath, canonicalJson(malformedWitness));
    await assert.rejects(sealEvidenceTree(evidence, partialOptions), /exact keys|amount/i);
    await writeFile(witnessPath, witnessBytes);
    const recordingPath = path.join(evidence, "C03", "desktop", "recording.json");
    const recordingBytes = await readFile(recordingPath);
    const malformedRecording = JSON.parse(recordingBytes.toString("utf8"));
    malformedRecording.frames[4].activeEffects = null;
    malformedRecording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(malformedRecording.frames)));
    await writeFile(recordingPath, canonicalJson(malformedRecording));
    await assert.rejects(sealEvidenceTree(evidence, partialOptions), /activeEffects|retained.*effect/i);
    await writeFile(recordingPath, recordingBytes);
    const markersPath = path.join(evidence, "C03", "desktop", "markers.json");
    const markersBytes = await readFile(markersPath);
    const foreignMarkers = JSON.parse(markersBytes.toString("utf8"));
    foreignMarkers.chronicleId = "C04";
    await writeFile(markersPath, canonicalJson(foreignMarkers));
    await assert.rejects(sealEvidenceTree(evidence, partialOptions), /marker.*identity/i);
    await writeFile(markersPath, markersBytes);
    const declaredExtra = path.join(evidence, "C03", "desktop", "declared-extra.txt");
    await writeFile(declaredExtra, "must not enter a fresh manifest");
    await assert.rejects(sealEvidenceTree(evidence, partialOptions), /unexpected evidence artifact/);
    await unlink(declaredExtra);
    await sealEvidenceTree(evidence, partialOptions);
    const manifest = JSON.parse(await readFile(path.join(evidence, "C03", "manifest.json"), "utf8"));
    assert.ok(manifest.artifacts.some(({ file }) => (
      file === "desktop/resource-transfer-witness.json"
    )), "sealed manifest must hash the C03 witness sidecar");
    const beforeCheck = await snapshotTree(evidence);
    await assert.rejects(
      validateEvidenceTree(evidence, partialOptions),
      /semantic|motion sidecar|retained recording|network sidecar|canonical oracle|evidence/i,
      "resealed synthetic sidecars must not pass canonical oracle revalidation",
    );
    assert.deepEqual(await snapshotTree(evidence), beforeCheck, "strict check must be byte-for-byte read-only");
    const staleWitness = JSON.parse(witnessBytes.toString("utf8"));
    staleWitness.standard.readingHoldMs += 1;
    await writeFile(witnessPath, canonicalJson(staleWitness));
    await assert.rejects(validateEvidenceTree(evidence, partialOptions), /hash mismatch/i);
    await writeFile(witnessPath, witnessBytes);
    await assert.rejects(
      validateEvidenceTree(evidence, { ...partialOptions, ffmpegPath: "/definitely/missing/ffmpeg" }),
      /ffmpeg.*unavailable/i,
    );

    const stale = path.join(evidence, "C03", "stale.txt");
    await writeFile(stale, "stale");
    await assert.rejects(validateEvidenceTree(evidence, partialOptions), /stale artifact/);
    await unlink(stale);
    const semanticPath = path.join(evidence, "C03", "desktop", "semantic.json");
    const semanticBytes = await readFile(semanticPath);
    await unlink(semanticPath);
    await assert.rejects(validateEvidenceTree(evidence, partialOptions), /missing artifact/);
    await writeFile(semanticPath, semanticBytes);
    await writeFile(path.join(fixtures, fixtureName), Buffer.from("changed fixture"));
    await assert.rejects(validateEvidenceTree(evidence, partialOptions), /fixture hash drift/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict validation round-trips a fully valid sealed C01 tree with raw motion witnesses", { timeout: 120_000 }, async () => {
  const { root, evidence, options } = await prepareValidC01Tree();
  try {
    const before = await snapshotTree(evidence);
    const forbiddenWitness = path.join(evidence, "C01", "desktop", "resource-transfer-witness.json");
    await writeFile(forbiddenWitness, canonicalJson({ schemaVersion: 1, chronicleId: "C01" }));
    await assert.rejects(sealEvidenceTree(evidence, options), /unexpected.*resource-transfer-witness/i);
    await unlink(forbiddenWitness);

    assert.deepEqual(await validateEvidenceTree(evidence, options), { chronicles: 1, viewports: 2 });
    assert.deepEqual(await snapshotTree(evidence), before, "strict valid-tree check must remain read-only");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("strict validation rejects resealed motion claims detached from retained recording and marker ledgers", { timeout: 120_000 }, async () => {
  const { root, evidence, options } = await prepareValidC01Tree();
  const motionPath = path.join(evidence, "C01", "desktop", "motion.json");
  const originalMotion = await readFile(motionPath);
  const unexpectedlyAccepted = [];
  const mutations = [
    ["missing retained motion frame", (motion) => { motion.frames.splice(3, 1); }, /motion frames.*exact retained recording order/i],
    ["missing retained trajectory frame", (motion) => { motion.trajectory.splice(3, 1); }, /trajectory frames.*exact retained recording order/i],
    ["unretained motion frame", (motion) => { motion.frames[0].frameIndex = 7; }, /motion frame 7.*retained recording/i],
    ["unretained trajectory frame", (motion) => { motion.trajectory.at(-1).frameIndex = 7; }, /trajectory frame 7.*retained recording/i],
    ["unretained transition frame", (motion) => {
      motion.trajectory[6].actors[0].activeAction = "moving";
      motion.trajectory[6].actors[0].facing = "west";
      const gateSample = structuredClone(motion.trajectory[2]);
      gateSample.frameIndex = 7;
      gateSample.actors[0].facing = "west";
      motion.trajectory.push(gateSample);
      for (const frameIndex of [8, 9, 10]) {
        const idle = structuredClone(gateSample);
        idle.frameIndex = frameIndex;
        idle.actors[0].activeAction = null;
        motion.trajectory.push(idle);
      }
      motion.regionTransitions[0].observedFrameIndex = 7;
      motion.regionTransitions[0].observedPresentationTimeMs = 7 * 1000 / 30;
      motion.markerFrames["event:agent_entered_region"] = 7;
      motion.markerFrames["checkpoint:final"] = 10;
    }, /transition frame 7.*retained recording/i],
    ["transition frame identity drift", (motion) => { motion.regionTransitions[0].frameIdentity.revision += 1; }, /transition frame 2.*identity.*retained recording/i],
    ["retained marker disagreement", (motion) => { motion.markerFrames["event:agent_left_region"] = 0; }, /markerFrames.*retained markers/i],
    ["unretained final checkpoint marker", (motion) => { motion.markerFrames["checkpoint:final"] = 7; }, /markerFrames.*retained markers/i],
    ["unretained placement checkpoint", (motion) => { motion.placementCheckpoints.push({ cursor: 99, placements: {} }); }, /placement checkpoint cursor 99.*retained motion frame/i],
  ];
  try {
    for (const [label, mutate, expected] of mutations) {
      const motion = JSON.parse(originalMotion.toString("utf8"));
      mutate(motion);
      await writeFile(motionPath, canonicalJson(motion));
      await sealEvidenceTree(evidence, options);
      try {
        await validateEvidenceTree(evidence, options);
        unexpectedlyAccepted.push(label);
      } catch (error) {
        assert.match(String(error?.message ?? error), expected, label);
      }
    }
    assert.deepEqual(unexpectedlyAccepted, [], `resealed detached claims were accepted: ${unexpectedlyAccepted.join(", ")}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function prepareValidC01Tree() {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-valid-c01-tree-"));
  const analysis = await buildProductionStageAnalysis();
  try {
    const fixtures = path.join(root, "fixtures");
    const evidence = path.join(root, "evidence");
    await Promise.all([mkdir(fixtures), mkdir(evidence)]);
    const fixtureName = "C01-movement-local-path.json";
    const canonicalFixture = path.resolve("tests/frontend-app/fixtures/chronicles/data", fixtureName);
    await copyFile(canonicalFixture, path.join(fixtures, fixtureName));
    const fixture = JSON.parse(await readFile(canonicalFixture, "utf8"));
    const catalogPath = path.join(fixtures, "catalog.json");
    await writeFile(catalogPath, canonicalJson({ schema: 1, chronicles: [{
      id: fixture.id,
      slug: fixture.slug,
      file: fixtureName,
      version: fixture.version,
      seed: fixture.seed,
      runId: fixture.runId,
      expectedFinalCursor: fixture.expectedFinalCursor,
    }] }));
    await writeValidC01Evidence(evidence, fixture, analysis.distDir);
    await buildChronicleContactSheet(path.join(evidence, "C01"));
    const options = { catalogPath, fixtureDirectory: fixtures, allowPartialCatalog: true };
    await sealEvidenceTree(evidence, options);
    return { root, evidence, options };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  } finally {
    await analysis.cleanup();
  }
}

async function snapshotTree(root) {
  const snapshot = {};
  for (const relative of await listFilesRecursively(root)) {
    snapshot[relative] = sha256Buffer(await readFile(path.join(root, relative)));
  }
  return snapshot;
}

function canonicalArtifactLayout() {
  const files = ["contact-sheet.json", "contact-sheet.png"];
  for (const viewport of ["desktop", "mobile"]) {
    files.push(
      `${viewport}/video.webm`,
      `${viewport}/review.mp4`,
      `${viewport}/reduced-video.webm`,
      `${viewport}/reduced-review.mp4`,
      `${viewport}/reduced-recording.json`,
      `${viewport}/reduced-markers.json`,
      ...REQUIRED_VIEWPORT_SIDECARS.map((sidecar) => `${viewport}/${sidecar}`),
    );
  }
  return files;
}

function validC03WitnessAuthority(viewport) {
  const viewportSize = viewport === "desktop"
    ? { width: 1_440, height: 900 }
    : { width: 390, height: 844 };
  const dialogueBounds = viewport === "desktop"
    ? { x: 128, y: 760, width: 1_184, height: 126 }
    : { x: 8, y: 710, width: 374, height: 126 };
  const readingWitness = {
    owner: "vivarium-2d-dialogue-now",
    speakerName: "Joe",
    targetName: "Mae",
    direction: "→",
    text: "Joe gave 1 material to Mae.",
    bounds: dialogueBounds,
    viewport: viewportSize,
  };
  const phaseAt = (frameIndex) => frameIndex === 0 ? "enter"
    : frameIndex <= 23 ? "hold"
      : frameIndex === 24 ? "consequence"
        : frameIndex === 25 ? "recover" : "exit";
  const frames = Array.from({ length: 27 }, (_, frameIndex) => {
    const phase = phaseAt(frameIndex);
    const frameIdentity = {
      runId: "mock-c03-v1",
      sourceKey: "live:mock-c03-v1",
      firstCursor: 1,
      lastCursor: 2,
      revision: frameIndex + 1,
    };
    return {
      frameIndex,
      mediaTimeMs: frameIndex * 1_000 / 30,
      presentationTimeMs: frameIndex * 1_000 / 30,
      scenePhase: phase,
      readingWitness: phase === "hold" || phase === "consequence" ? readingWitness : null,
      focusSelectionKey: "agent:wanderer_001",
      activeEffects: 0,
      canvasFrameIdentity: structuredClone(frameIdentity),
      observerFrameIdentity: structuredClone(frameIdentity),
      transferFrame: {
        frameIndex,
        phase,
        sender: {
          id: "wanderer_001", position: { x: 1_936, y: 176 },
          activeAction: "idle", safeFrameVisible: true,
        },
        receiver: {
          id: "wanderer_002", position: { x: 304, y: 112 },
          activeAction: "idle", safeFrameVisible: false,
        },
      },
    };
  });
  const evidence = {
    senderId: "wanderer_001",
    senderName: "Joe",
    receiverId: "wanderer_002",
    receiverName: "Mae",
    resourceType: "materials",
    amount: 1,
    direction: "→",
    text: "Joe gave 1 material to Mae.",
    focusSelectionKey: "agent:wanderer_001",
    senderSafeFrameVisible: true,
    maximumActiveEffects: 0,
    transferFrameCount: 27,
    senderPosition: { x: 1_936, y: 176 },
    receiverPosition: { x: 304, y: 112 },
    readingHoldMs: 23 * 1_000 / 30,
    dialogueBounds,
  };
  const fixture = {
    id: "C03",
    entries: [{
      cursor: 2,
      event: {
        type: "resource_transferred",
        payload: {
          sender_id: "wanderer_001",
          receiver_id: "wanderer_002",
          resource_type: "materials",
          amount: 1,
        },
      },
    }],
  };
  const markerLedger = {
    schemaVersion: 1,
    chronicleId: "C03",
    viewport,
    observed: [{
      expectedMarker: "event:resource_transferred",
      frameIndex: 24,
      mediaTimeMs: 24 * 1_000 / 30,
      presentationTimeMs: 24 * 1_000 / 30,
    }],
  };
  return {
    chronicleId: "C03",
    viewport,
    fixture,
    standardRecording: { frames: structuredClone(frames) },
    reducedRecording: { frames: structuredClone(frames) },
    standardMarkers: structuredClone(markerLedger),
    reducedMarkers: {
      ...structuredClone(markerLedger),
      captureId: `C03:${viewport}:reduced`,
    },
    document: {
      schemaVersion: 1,
      chronicleId: "C03",
      viewport,
      standard: structuredClone(evidence),
      reduced: structuredClone(evidence),
    },
  };
}

async function writeSyntheticChronicle(root) {
  const chronicle = path.join(root, "C03");
  const frames = path.join(root, "frames");
  await mkdir(frames, { recursive: true });
  for (let index = 0; index < 27; index += 1) {
    await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: index * 60, g: 80, b: 120, alpha: 1 } } })
      .png().toFile(path.join(frames, `${String(index).padStart(6, "0")}.png`));
  }
  for (const viewport of ["desktop", "mobile"]) {
    const authority = validC03WitnessAuthority(viewport);
    const frameLedger = await Promise.all(authority.standardRecording.frames.map(async (
      retained,
      frameIndex,
    ) => {
      const bytes = await readFile(path.join(frames, `${String(frameIndex).padStart(6, "0")}.png`));
      const identity = {
        runId: "mock-c03-v1", sourceKey: "live:mock-c03-v1",
        firstCursor: 1, lastCursor: 2, revision: frameIndex + 1,
      };
      return {
        ...retained,
        file: `.frames/${String(frameIndex).padStart(6, "0")}.png`,
        bytes: bytes.length,
        sha256: sha256Buffer(bytes),
        mediaTimeMs: frameIndex * 1000 / 30,
        presentationTimeMs: frameIndex * 1000 / 30,
        presentedCursor: frameIndex < 24 ? 1 : 2,
        exactBaseCursor: frameIndex < 24 ? 1 : 2,
        projectedThroughCursor: frameIndex < 24 ? 1 : 2,
        region: {
          activeRegionId: "meadow",
          visibleRegionId: "meadow",
          loadingRegionId: null,
        },
        presentedSource: "live",
        activeSceneCount: 1,
        pendingMoments: 0,
        canvasFrameIdentity: identity,
        observerFrameIdentity: identity,
      };
    }));
    const directory = path.join(chronicle, viewport);
    await mkdir(path.join(directory, "markers"), { recursive: true });
    const webm = path.join(directory, "video.webm");
    const mp4 = path.join(directory, "review.mp4");
    const probes = await encodeFrameSequence({ framesDirectory: frames, frameCount: 27, fps: 30, webmPath: webm, mp4Path: mp4 });
    const still = await readFile(path.join(frames, "000024.png"));
    await writeFile(path.join(directory, "markers", "000024-resource-transfer.png"), still);
    const videoRefs = {};
    for (const [kind, file] of [["webm", webm], ["mp4", mp4]]) {
      const bytes = await readFile(file);
      videoRefs[kind] = { file: path.basename(file), bytes: bytes.length, sha256: sha256Buffer(bytes), probe: probes[kind] };
    }
    await writeFile(path.join(directory, "recording.json"), canonicalJson({
      schemaVersion: 1, chronicleId: "C03", viewport, fps: 30, frameCount: 27,
      durationMs: 900,
      timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frameLedger))),
      frames: frameLedger,
      video: videoRefs,
    }));
    await writeFile(path.join(directory, "markers.json"), canonicalJson({
      schemaVersion: 1, chronicleId: "C03", viewport,
      expected: ["event:resource_transferred"],
      observed: [{ id: "C03:1:consequence", label: "Resource Transferred", expectedMarker: "event:resource_transferred", frameIndex: 24,
        mediaTimeMs: 24 * 1000 / 30, presentationTimeMs: 24 * 1000 / 30,
        still: { file: "markers/000024-resource-transfer.png", bytes: still.length, sha256: sha256Buffer(still) } }],
    }));
    const reducedVideoRefs = {};
    for (const [kind, source, name] of [
      ["webm", webm, "reduced-video.webm"],
      ["mp4", mp4, "reduced-review.mp4"],
    ]) {
      const bytes = await readFile(source);
      await writeFile(path.join(directory, name), bytes);
      reducedVideoRefs[kind] = {
        file: name,
        bytes: bytes.length,
        sha256: sha256Buffer(bytes),
        probe: probes[kind],
      };
    }
    await writeFile(path.join(directory, "reduced-recording.json"), canonicalJson({
      schemaVersion: 1, chronicleId: "C03", viewport,
      captureId: `C03:${viewport}:reduced`, mode: "reduced",
      fps: 30, frameCount: 27, durationMs: 900,
      timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frameLedger))),
      frames: frameLedger,
      video: reducedVideoRefs,
    }));
    await writeFile(path.join(directory, "reduced-markers.json"), canonicalJson({
      schemaVersion: 1, chronicleId: "C03", viewport,
      captureId: `C03:${viewport}:reduced`,
      expected: ["event:resource_transferred"],
      observed: [{ id: "C03:1:consequence", label: "Resource Transferred", expectedMarker: "event:resource_transferred", frameIndex: 24,
        mediaTimeMs: 24 * 1000 / 30, presentationTimeMs: 24 * 1000 / 30,
        still: { file: "markers/000024-resource-transfer.png", bytes: still.length, sha256: sha256Buffer(still) } }],
    }));
    await writeFile(
      path.join(directory, "resource-transfer-witness.json"),
      canonicalJson(authority.document),
    );
    for (const name of ["semantic", "cursors", "motion", "performance", "network", "assets", "reduced-motion", "viewport", "source-revision"]) {
      await writeFile(path.join(directory, `${name}.json`), canonicalJson({ schemaVersion: 1, chronicleId: "C03", viewport, evidence: { synthetic: true } }));
    }
  }
  await rm(frames, { recursive: true, force: true });
}

async function writePreparedChronicle(root) {
  for (const viewport of ["desktop", "mobile"]) {
    const directory = path.join(root, "C03", viewport);
    const framesDirectory = path.join(directory, ".frames");
    await mkdir(path.join(directory, "markers"), { recursive: true });
    await mkdir(framesDirectory, { recursive: true });
    const frames = [];
    for (let frameIndex = 0; frameIndex < 2; frameIndex += 1) {
      const file = `.frames/${String(frameIndex).padStart(6, "0")}.png`;
      const bytes = await sharp({
        create: {
          width: 64,
          height: 48,
          channels: 4,
          background: { r: frameIndex * 60, g: 80, b: 120, alpha: 1 },
        },
      }).png().toBuffer();
      await writeFile(path.join(directory, file), bytes);
      frames.push({
        frameIndex,
        file,
        bytes: bytes.length,
        sha256: sha256Buffer(bytes),
        mediaTimeMs: frameIndex * 1000 / 30,
        presentationTimeMs: frameIndex * 1000 / 30,
        presentedCursor: frameIndex,
        exactBaseCursor: frameIndex,
        projectedThroughCursor: frameIndex,
        region: {
          activeRegionId: "meadow",
          visibleRegionId: "meadow",
          loadingRegionId: null,
        },
        presentedSource: "live",
        activeSceneCount: 0,
        pendingMoments: 0,
        canvasFrameIdentity: {
          runId: "mock-c03-v1", sourceKey: "live:mock-c03-v1",
          firstCursor: frameIndex, lastCursor: frameIndex, revision: frameIndex + 1,
        },
        observerFrameIdentity: {
          runId: "mock-c03-v1", sourceKey: "live:mock-c03-v1",
          firstCursor: frameIndex, lastCursor: frameIndex, revision: frameIndex + 1,
        },
      });
    }
    const still = await readFile(path.join(framesDirectory, "000001.png"));
    await writeFile(path.join(directory, "markers", "000001-resource.png"), still);
    await writeFile(path.join(directory, "capture.json"), canonicalJson({
      schemaVersion: 1,
      chronicleId: "C03",
      viewport,
      route: "/?renderer=2d",
      clock: "ManualPresentationClock",
      captureMethod: "playwright-page-screenshot",
      playwrightRecordVideo: false,
      fps: 30,
      frameCount: frames.length,
      timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frames))),
      frames,
    }));
    await writeFile(path.join(directory, "markers.json"), canonicalJson({
      schemaVersion: 1,
      chronicleId: "C03",
      viewport,
      expected: ["event:resource_changed"],
      observed: [{
        id: "C03:1:consequence",
        label: "Resource gathered",
        expectedMarker: "event:resource_changed",
        frameIndex: 1,
        mediaTimeMs: 1000 / 30,
        presentationTimeMs: 1000 / 30,
        still: {
          file: "markers/000001-resource.png",
          bytes: still.length,
          sha256: sha256Buffer(still),
        },
      }],
    }));
    for (const name of [
      "semantic", "cursors", "motion", "performance", "network", "assets",
      "reduced-motion", "viewport", "source-revision",
    ]) {
      await writeFile(path.join(directory, `${name}.json`), canonicalJson({
        schemaVersion: 1,
        chronicleId: "C03",
        viewport,
        evidence: { synthetic: true },
      }));
    }
  }
}

async function writeValidC01Evidence(root, fixture, analysisRoot) {
  const chronicleDirectory = path.join(root, "C01");
  const applicationOrigin = "http://127.0.0.1:4173";
  const requests = [
    { sequence: 1, kind: "navigation", method: "GET", url: `${applicationOrigin}/?renderer=2d`, handler: "vite-navigation", status: 200, disposition: "fulfilled", responseStatus: 200, terminal: "finished", failureText: null },
    { sequence: 2, kind: "api", method: "GET", url: `${applicationOrigin}/api/replay/artifacts/raw`, handler: "raw-artifact-rejection", status: 0, disposition: "rejected", responseStatus: null, terminal: "failed", failureText: "fixture rejected raw artifact access" },
  ];
  const requestSummary = {
    observedCount: requests.length,
    ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(requests))),
  };
  for (const viewport of ["desktop", "mobile"]) {
    await writeValidC01Media(chronicleDirectory, viewport, fixture);
  }
  const oracle = createCanonicalChronicleEvidenceOracle({
    analysisRoot,
    analysisManifestFile: ".vite/manifest.json",
    artifactRoot: root,
    applicationOrigin,
    requestSummaries: {
      "C01/desktop": requestSummary,
      "C01/mobile": requestSummary,
    },
  });
  for (const viewport of ["desktop", "mobile"]) {
    const directory = path.join(chronicleDirectory, viewport);
    const sidecars = await oracle.buildViewportEvidence(validC01RawInput(fixture, viewport, requests));
    await Promise.all(Object.entries(sidecars).map(([filename, document]) => (
      writeFile(path.join(directory, filename), canonicalJson(document))
    )));
  }
}

async function writeValidC01Media(chronicleDirectory, viewport, fixture) {
  const directory = path.join(chronicleDirectory, viewport);
  const frames = path.join(directory, ".source-frames");
  const markersDirectory = path.join(directory, "markers");
  await Promise.all([mkdir(frames, { recursive: true }), mkdir(markersDirectory, { recursive: true })]);
  const pngs = await Promise.all(Array.from({ length: 7 }, async (_, frameIndex) => {
    const png = await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 4,
        background: { r: 64 + frameIndex * 12, g: 112 + frameIndex * 7, b: 92 + frameIndex * 5, alpha: 1 },
      },
    }).png().toBuffer();
    await writeFile(path.join(frames, `${String(frameIndex).padStart(6, "0")}.png`), png);
    return png;
  }));
  const video = path.join(directory, "video.webm");
  const review = path.join(directory, "review.mp4");
  const probes = await encodeFrameSequence({ framesDirectory: frames, frameCount: 7, webmPath: video, mp4Path: review });
  const reducedVideo = path.join(directory, "reduced-video.webm");
  const reducedReview = path.join(directory, "reduced-review.mp4");
  await Promise.all([copyFile(video, reducedVideo), copyFile(review, reducedReview)]);
  const identity = {
    runId: fixture.runId,
    sourceKey: `live:${fixture.runId}`,
    firstCursor: 0,
    lastCursor: fixture.expectedFinalCursor,
    revision: 1,
  };
  const presentedCursors = [0, 1, 2, 2, 2, 2, 2];
  const frameLedger = pngs.map((png, frameIndex) => ({
    frameIndex,
    mediaTimeMs: frameIndex * 1000 / 30,
    presentationTimeMs: frameIndex * 1000 / 30,
    presentedCursor: presentedCursors[frameIndex],
    exactBaseCursor: presentedCursors[frameIndex],
    projectedThroughCursor: presentedCursors[frameIndex],
    region: {
      activeRegionId: "nirvana_east",
      visibleRegionId: "nirvana_east",
      loadingRegionId: null,
    },
    presentedSource: "live",
    activeSceneCount: frameIndex < 6 ? 1 : 0,
    pendingMoments: frameIndex < 6 ? 1 : 0,
    bytes: png.length,
    sha256: sha256Buffer(png),
    canvasFrameIdentity: { ...identity },
    observerFrameIdentity: { ...identity },
  }));
  const videoReference = async (filename, file, probe) => ({
    file,
    bytes: (await stat(filename)).size,
    sha256: sha256Buffer(await readFile(filename)),
    probe,
  });
  const baseRecording = {
    schemaVersion: 1,
    chronicleId: "C01",
    viewport,
    fps: 30,
    frameCount: 7,
    durationMs: 7 * 1000 / 30,
    timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frameLedger))),
    frames: frameLedger,
  };
  await writeFile(path.join(directory, "recording.json"), canonicalJson({
    ...baseRecording,
    captureId: `C01:${viewport}:standard`,
    mode: "standard",
    video: {
      webm: await videoReference(video, "video.webm", probes.webm),
      mp4: await videoReference(review, "review.mp4", probes.mp4),
    },
  }));
  await writeFile(path.join(directory, "reduced-recording.json"), canonicalJson({
    ...baseRecording,
    captureId: `C01:${viewport}:reduced`,
    mode: "reduced",
    video: {
      webm: await videoReference(reducedVideo, "reduced-video.webm", probes.webm),
      mp4: await videoReference(reducedReview, "reduced-review.mp4", probes.mp4),
    },
  }));
  const markerFrameByName = {
    "event:agent_left_region": 1,
    "event:agent_entered_region": 2,
    "checkpoint:final": 6,
  };
  const observed = (await Promise.all(fixture.expectedMarkers.map(async (expectedMarker, index) => {
    const frameIndex = markerFrameByName[expectedMarker];
    assert.ok(Number.isSafeInteger(frameIndex), `test marker ${expectedMarker} requires an exact frame`);
    const png = pngs[frameIndex];
    const slug = expectedMarker.replace(/^(?:event|checkpoint):/, "").replaceAll("_", "-");
    const stillFile = `markers/${String(frameIndex).padStart(6, "0")}-${slug}.png`;
    await writeFile(path.join(directory, stillFile), png);
    return {
      id: `C01:${viewport}:${index}`,
      label: markerLabelForTest(expectedMarker),
      expectedMarker,
      frameIndex,
      mediaTimeMs: frameIndex * 1000 / 30,
      presentationTimeMs: frameIndex * 1000 / 30,
      still: { file: stillFile, bytes: png.length, sha256: sha256Buffer(png) },
    };
  }))).sort((left, right) => left.frameIndex - right.frameIndex || left.id.localeCompare(right.id));
  await writeFile(path.join(directory, "markers.json"), canonicalJson({
    schemaVersion: 1, chronicleId: "C01", viewport,
    captureId: `C01:${viewport}:standard`, expected: fixture.expectedMarkers, observed,
  }));
  await writeFile(path.join(directory, "reduced-markers.json"), canonicalJson({
    schemaVersion: 1, chronicleId: "C01", viewport,
    captureId: `C01:${viewport}:reduced`, expected: fixture.expectedMarkers, observed,
  }));
  await rm(frames, { recursive: true, force: true });
}

function validC01RawInput(fixture, viewport, requests) {
  const final = fixture.expectedTerminal.finalSnapshot;
  const identity = {
    runId: fixture.runId,
    sourceKey: `live:${fixture.runId}`,
    firstCursor: 0,
    lastCursor: fixture.expectedFinalCursor,
    revision: 1,
  };
  const markerFrameByName = {
    "event:agent_left_region": 1,
    "event:agent_entered_region": 2,
    "checkpoint:final": 6,
  };
  const markers = [...fixture.expectedMarkers].sort((left, right) => (
    markerFrameByName[left] - markerFrameByName[right]
  ));
  const endpoints = ["agent:wanderer_001:still"];
  const labels = markers.map(markerLabelForTest);
  const viewportRect = viewport === "desktop"
    ? { x: 0, y: 0, width: 1_440, height: 900 }
    : { x: 0, y: 0, width: 390, height: 844 };
  const values = [
    ["warm_springs", 900, 2_000, "east", "moving"],
    ["warm_springs", 920, 2_000, "east", "moving"],
    ["nirvana_east", 880, 560, "east", "moving"],
    ["nirvana_east", 912, 560, "east", "moving"],
    ["nirvana_east", 912, 560, "east", null],
    ["nirvana_east", 912, 560, "east", null],
    ["nirvana_east", 912, 560, "east", null],
  ];
  const trajectoryCursors = [0, 0, 1, 1, 2, 2, 2];
  const trajectorySamples = values.map(([regionId, x, y, facing, activeAction], frameIndex) => {
    const worldBounds = { x: x - 37, y: y - 62, width: 67, height: 72 };
    const camera = {
      mode: "story", zoom: 1,
      rasterOrigin: { x: viewportRect.width / 2 - x, y: viewportRect.height / 2 - y },
      safeFrame: viewportRect,
      viewport: { width: viewportRect.width, height: viewportRect.height },
    };
    const screenBounds = {
      x: worldBounds.x + camera.rasterOrigin.x,
      y: worldBounds.y + camera.rasterOrigin.y,
      width: 67,
      height: 72,
    };
    return {
      frameIndex, cursor: trajectoryCursors[frameIndex], regionId,
      focusSelectionKey: "agent:wanderer_001", camera,
      actors: [{ id: "wanderer_001", position: { x, y }, facing, activeAction, worldBounds,
        screenBounds, screenVisible: true, safeFrameVisible: true }],
    };
  });
  const runtimeBase = {
    chroniclePrevious: 1, chronicleUpcoming: 1, retainedSafeCheckpoints: 1,
    liveSessions: 1, archiveSessions: 0, stageCount: 1, canvasCount: 1,
    stageId: "stage-main", canvasId: "canvas-main",
  };
  const counter = (created, peak = created) => ({ created, disposed: created, live: 0, outstanding: 0, peak });
  const schedulerSamples = [
    { mode: "visible", phase: "ambient", routeId: "standard", ownerId: "standard-canvas", dirty: false, rafScheduled: false, wakeScheduled: true, nextDeadlineMs: 2_000, observedAtMs: 1_000, drawTotal: 10, reason: "graph-deadline" },
    { mode: "terminal-static", phase: "terminal-static", routeId: "reduced", ownerId: "reduced-canvas", dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, observedAtMs: 2_000, drawTotal: 10, reason: null,
      quiet: { durationMs: 1_000, drawDelta: 0, reactCommitDelta: 0, cursorBefore: 2, cursorAfter: 2, frameIdentityBefore: "a".repeat(64), frameIdentityAfter: "a".repeat(64), stateHashBefore: "b".repeat(64), stateHashAfter: "b".repeat(64) } },
    { mode: "hidden", phase: "hidden", routeId: "standard", ownerId: "standard-canvas", dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, observedAtMs: 3_000, drawTotal: 10, reason: null },
    { mode: "disposed", phase: "disposed", routeId: "standard", ownerId: "standard-canvas", dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, observedAtMs: 3_001, drawTotal: 10, reason: null },
    { mode: "reduced-active", phase: "active", routeId: "reduced", ownerId: "reduced-canvas", dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null, observedAtMs: 1_500, drawTotal: 9, reason: null },
  ];
  const terminalCameraStabilityWitness = () => ({
    requiredConsecutiveSamples: 3,
    markerFrameIndex: markerFrameByName["checkpoint:final"],
    samples: [4, 5, 6].map((frameIndex) => ({
      frameIndex,
      presentationTimeMs: frameIndex * 1_000 / 30,
      frameIdentity: { ...identity },
      presentation: {
        ingestedCursor: 2,
        presentedCursor: 2,
        canvasLastCursor: 2,
        activeSceneCount: 0,
        pendingMoments: 0,
      },
      world: {
        exactBaseCursor: 2,
        projectedThroughCursor: 2,
      },
      region: {
        activeRegionId: "nirvana_east",
        visibleRegionId: "nirvana_east",
        loadingRegionId: null,
      },
      camera: {
        mode: "story",
        center: { x: 912, y: 560 },
        zoom: 1,
        rasterOrigin: { x: viewportRect.width / 2 - 912, y: viewportRect.height / 2 - 560 },
        safeFrame: { ...viewportRect },
        viewport: { width: viewportRect.width, height: viewportRect.height },
        focusSelectionKey: "agent:wanderer_001",
        pendingStoryEntityId: null,
        pendingStoryTarget: null,
      },
      activeEffects: 0,
      actors: [{
        id: "wanderer_001",
        instanceId: 1,
        position: { x: 912, y: 560 },
        facing: "east",
        activeAction: null,
        reposition: null,
      }],
    })),
  });
  const motionMode = (mode) => ({
    captureId: `C01:${viewport}:${mode}`,
    mode,
    artifactDirectory: `C01/${viewport}`,
    endpoints,
    consequences: markers,
    markerOrder: markers,
    labels,
    readingHoldsMs: [1_000],
    terminalCameraWitness: terminalCameraStabilityWitness(),
  });
  return {
    chronicleId: "C01",
    viewport,
    expectedFinalCursor: 2,
    semantic: {
      terminalAuthority: trustedTerminalAuthority(fixture),
      operationalWorkload: { trace: [] },
      transportWitnesses: [],
      terminalObservation: {
        observerFrameIdentity: identity, canvasFrameIdentity: { ...identity },
        ingestedCursor: 2, presentedCursor: 2, targetCursor: 2,
        activeSceneCount: 0, pendingMoments: 0,
        frame: {
          ...identity, presentedCursor: 2,
          world: {
            worldTime: final.world_time,
            agents: final.agents.map((value) => ({ completeness: "exact", value })),
            homes: final.homes.map((value) => ({ completeness: "exact", value })),
            regions: final.regions.map((value) => ({ completeness: "exact", value })),
            ruins: final.ruins.map((value) => ({ completeness: "exact", value })),
            pendingProposals: final.pending_proposals,
            regionPressure: structuredClone(final.region_pressure),
          },
        },
      },
      terminalCameraWitness: terminalCameraStabilityWitness(),
      eventWitnesses: fixture.entries.map((entry) => ({
        kind: "envelope",
        disposition: "accepted",
        cursor: entry.cursor,
        envelope: { next_cursor: entry.cursor, events: [entry] },
      })),
      endpoints,
      consequences: markers,
      markers,
    },
    cursors: { samples: [
      { frameIndex: 0, authoritativeCursor: 0, acceptedCursor: 0, presentedCursor: 0, publicCursor: 0, phase: "running" },
      { frameIndex: 6, authoritativeCursor: 2, acceptedCursor: 2, presentedCursor: 2, publicCursor: 2, phase: "settled" },
    ], gaps: [] },
    motion: {
      frames: [0, 1, 2, 2, 2, 2, 2].map((cursor, frameIndex) => ({
        frameIndex, cursor, activeEffects: 0, placementHash: "0".repeat(64),
      })),
      trajectorySamples,
      homeOwnershipSegments: [],
      regionTransitionWitnesses: [{
        actorId: "wanderer_001", reason: "region-transition",
        position: { x: 880, y: 560 }, actorPosition: { x: 880, y: 560 },
        gate: { role: "arrival", tile: { column: 27, row: 17 }, tileSize: 32, point: { x: 880, y: 560 } },
        fromRegion: "warm_springs", toRegion: "nirvana_east", sceneToken: 2,
        commandId: "arrival:wanderer_001", atMs: 60, frameIdentity: identity,
        observedFrameIndex: 2, observedPresentationTimeMs: 1_000 / 15,
      }],
      markerFrames: structuredClone(markerFrameByName),
      checkpointWitnesses: {
        standard: {
          witnesses: [],
          markerFrames: structuredClone(markerFrameByName),
        },
        reduced: {
          witnesses: [],
          markerFrames: structuredClone(markerFrameByName),
        },
      },
      placementCheckpoints: [],
    },
    performance: {
      drawSamplesMs: [1, 2, 3, 4], longTasksMs: [],
      cadenceWindows: [{ mode: "visible", frameCount: 60, durationMs: 1_000 }, { mode: "reduced", frameCount: 30, durationMs: 1_000 }, { mode: "hidden", frameCount: 0, durationMs: 1_000 }],
      runtimeSamples: [
        { ...runtimeBase, frameIndex: 0, phase: "active", authoritativeCursor: 1, ingressAccepted: 1, directorPending: 1, activeSceneCount: 1 },
        { ...runtimeBase, frameIndex: 1, phase: "terminal", authoritativeCursor: 2, ingressAccepted: 0, directorPending: 0, activeSceneCount: 0, chroniclePrevious: 0, chronicleUpcoming: 0 },
      ],
      schedulerSamples, archiveObservations: [],
      lifecycle: {
        stage: counter(1), canvas: counter(1), graph: counter(1), graphActors: counter(4), graphHomes: counter(0), graphEnvironments: counter(2),
        cache: { ...counter(2), rebuildReasons: ["topology"] },
        atlas: { decodeStarts: 1, bitmapsClosed: 1, acquireCalls: 2, releaseCalls: 2, leasesCreated: 2, leasesReleased: 2 },
        react: { initialCommitCount: 1, finalCommitCount: 2, frameDrivenCommitCount: 0 },
        heap: { supportProbe: { api: "CDP HeapProfiler.collectGarbage", supported: false, reason: "CDP unavailable" }, collections: 0, baseline: null, tail: null, domBaseline: { nodes: 100, listeners: 10 }, domTail: { nodes: 110, listeners: 11 } },
      },
    },
    network: { requests },
    assets: {
      raster: { imageSmoothingSamples: [false], coordinates: [0, 0, viewportRect.width, viewportRect.height] },
      environmentSamples: [{ phase: "warm", capacity: 32, allocated: 1, activeEffects: 1 }],
      poolSamples: [{ phase: "warm", capacity: 32, allocated: 2, inFlightCount: 0, waiterCount: 0 }, { phase: "settled", capacity: 32, allocated: 0, inFlightCount: 0, waiterCount: 0 }],
      atlasSamples: [{ phase: "warm", decodedBytes: 100, leases: 2, waiterCount: 0, inFlightCount: 0 }, { phase: "settled", decodedBytes: 0, leases: 0, waiterCount: 0, inFlightCount: 0 }],
    },
    reducedMotion: { standard: motionMode("standard"), reduced: motionMode("reduced") },
    viewportMetrics: { width: viewportRect.width, height: viewportRect.height, devicePixelRatio: 1 },
  };
}

function markerLabelForTest(marker) {
  return marker.replace(/^event:/, "").replace(/^checkpoint:/, "Checkpoint ")
    .replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
