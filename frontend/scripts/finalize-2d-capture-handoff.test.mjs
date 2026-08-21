import assert from "node:assert/strict";
import { constants as bufferConstants } from "node:buffer";
import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertRequestSummaryBindsNetwork,
  captureHandoffToOracleInput,
  finalizeCaptureHandoff,
} from "./finalize-2d-capture-handoff.mjs";
import { projectMotionSamplesForHandoff } from "./project-2d-capture-handoff.mjs";
import {
  canonicalJson,
  sha256Buffer,
  writeNormalizedJson,
} from "./recording-artifacts.mjs";

const C02_FRAME_COUNT = 23_491;
const REQUIRED_STRING_HEADROOM_BYTES = 384 * 1024 * 1024;
const APPLICATION_ORIGIN = "http://127.0.0.1:4173";
const C02_MANIFEST_FILE = fileURLToPath(new URL(
  "../../tests/frontend-app/fixtures/chronicles/data/C02-travel-all-regions.json",
  import.meta.url,
));
const C02_WORKER_FILE = fileURLToPath(new URL("./c02-handoff-roundtrip-worker.mjs", import.meta.url));
const execFileAsync = promisify(execFile);

function counter(created = 1) {
  return { created, disposed: created, live: 0, outstanding: 0, peak: created };
}

function trustedManifest(id, expectedFinalCursor) {
  return {
    id,
    expectedFinalCursor,
    entries: Array.from({ length: expectedFinalCursor }, (_, index) => ({ cursor: index + 1 })),
  };
}

function acceptedEnvelopeWitnesses(ranges) {
  const cursors = ranges.flatMap(([first, last]) => (
    Array.from({ length: last - first + 1 }, (_, index) => first + index)
  ));
  return cursors.map((cursor, index) => ({
    sequence: index + 1,
    kind: "envelope",
    disposition: "accepted",
    cursor,
    envelope: { next_cursor: cursor },
  }));
}

function terminalCameraWitness() {
  const sample = (frameIndex) => ({
    frameIndex,
    presentationTimeMs: frameIndex * 1000 / 30,
    frameIdentity: {
      runId: "r", sourceKey: "s", firstCursor: 1, lastCursor: 1, revision: 1,
    },
    presentation: {
      ingestedCursor: 1, presentedCursor: 1, canvasLastCursor: 1,
      activeSceneCount: 0, pendingMoments: 0,
    },
    world: {
      exactBaseCursor: 1,
      projectedThroughCursor: 1,
    },
    region: {
      activeRegionId: "meadow", visibleRegionId: "meadow", loadingRegionId: null,
    },
    camera: {
      mode: "story",
      center: { x: 160, y: 100 },
      zoom: 2,
      rasterOrigin: { x: 100, y: 50 },
      safeFrame: { x: 20, y: 10, width: 300, height: 180 },
      viewport: { width: 1_440, height: 900 },
      focusSelectionKey: "agent:a",
      pendingStoryEntityId: null,
      pendingStoryTarget: null,
    },
    activeEffects: 0,
    actors: [{
      id: "a", instanceId: 1,
      position: { x: 0, y: 0 }, facing: "east",
      activeAction: null, reposition: null,
    }],
  });
  return {
    requiredConsecutiveSamples: 3,
    markerFrameIndex: 2,
    samples: [sample(0), sample(1), sample(2)],
  };
}

function handoff() {
  const pool = {
    activeCompressedMax: 1_000,
    decodedBytes: 0,
    leases: 0,
    waiterCount: 0,
    inFlightCount: 0,
    expectedActiveCompressedBytes: 0,
    closeCount: 1,
    lifecycle: {
      acquireCalls: 1, retainCalls: 1, decodeStarts: 1,
      leasesCreated: 2, leasesReleased: 2,
    },
  };
  return {
    schemaVersion: 1,
    chronicleId: "C01",
    viewport: "desktop",
    cursorSamples: [{ frameIndex: 0, authoritativeCursor: 1, acceptedCursor: 1, presentedCursor: 1, publicCursor: 1, phase: "settled" }],
    motionSamples: [{
      frameIndex: 0, presentationTimeMs: 0, cursor: 1, epochReady: false,
      activeEffects: 0, placementHash: "0".repeat(64),
      placements: {}, environments: [{ diagnostics: { capacities: { a: 2 }, allocatedSlots: { a: 1 } } }],
      activeRegion: { id: "meadow" },
      recentMarkers: [],
      pathFallbacks: 0,
      focusSelectionKey: "agent:a",
      camera: {
        mode: "story",
        zoom: 2,
        rasterOrigin: { x: 100, y: 50 },
        safeFrame: { x: 20, y: 10, width: 300, height: 180 },
      },
      actors: [{
        id: "a",
        position: { x: 0, y: 0 },
        facing: "east",
        activeAction: "moving",
        worldBounds: { x: -37, y: -62, width: 67, height: 72 },
        screenBounds: { x: 26, y: -74, width: 134, height: 144 },
        screenVisible: true,
        safeFrameVisible: false,
      }],
      homes: [],
      regionTransitions: [{
        actorId: "a",
        reason: "region-transition",
        position: { x: 0, y: 0 },
        actorPosition: { x: 0, y: 0 },
        gate: {
          role: "arrival", tile: { column: 0, row: 0 }, tileSize: 32,
          point: { x: 0, y: 0 },
        },
        fromRegion: "meadow",
        toRegion: "distant",
        sceneToken: 2,
        commandId: "arrival:a",
        atMs: 50,
        frameIdentity: {
          runId: "r", sourceKey: "s", firstCursor: 1, lastCursor: 1, revision: 1,
        },
      }],
      rendererPool: { ...pool, decodedBytes: 64, leases: 2, expectedActiveCompressedBytes: 64 },
    }],
    runtimeObservations: [{
      frameIndex: 0, authoritativeCursor: 1, phase: "terminal",
      workload: null,
      observation: {
        ingestedCursor: 1, pendingMoments: 0, activeSceneCount: 0,
        stageId: "stage-1", canvasId: "canvas-1",
        observer: { liveSessions: 1, archiveSessions: 0, stageCount: 1, session: {
          chronicle: { previous: 0, upcoming: 0 }, checkpoint: { retainedSafeCheckpoints: 1 },
        } },
      },
    }],
    performanceEvidence: {
      longTasksMs: [],
      schedulerSamples: [{
        mode: "visible", phase: "ambient", routeId: "standard", ownerId: "canvas-1",
        dirty: false, rafScheduled: false, wakeScheduled: true, nextDeadlineMs: 2_000,
        observedAtMs: 1_000, drawTotal: 7, reason: "graph-deadline",
      }],
      archiveObservations: [],
      heap: {},
    },
    terminalObservation: { renderer: { draw: { samplesMs: [1] } } },
    reducedTerminalCameraWitness: terminalCameraWitness(),
    standardMotion: { endpoints: ["agent:a"], consequences: ["event:moved"], markerOrder: ["event:moved"], labels: ["Moved"], readingHoldsMs: [0] },
    reducedMotion: { endpoints: ["agent:a"], consequences: ["event:moved"], markerOrder: ["event:moved"], labels: ["Moved"], readingHoldsMs: [0] },
    captureTerminal: { rendererDisposals: [{ before: {}, after: {
      graph: { ownership: { actors: counter(), homes: counter(), environments: counter() } },
      cache: { ...counter(2), lastRebuildReason: "region" }, pool,
      scheduler: {
        dirty: false, rafScheduled: false, wakeScheduled: false, nextDeadlineMs: null,
      },
      draw: { totalCount: 7 },
    } }] },
    requests: {
      routeLedger: [{ requestId: 1, sequence: 1, handler: "run", method: "GET", path: "/api/run", disposition: "fulfilled", status: 200 }],
      observedRoutes: [{ requestId: 1, sequence: 1, method: "GET", path: "/api/run" }],
    },
    observations: {
      terminalCameraWitness: terminalCameraWitness(),
      terminalAuthority: {
        mechanic: { runId: "r", finalCursor: 1, finalSnapshot: {} },
        presentation: {
          kind: "mechanic-story",
          terminal: { source: "live", runId: "r", sourceKey: "s", cursor: 1, snapshot: {} },
        },
      },
      operationalWorkload: { trace: [] },
      transportWitnesses: [],
      semanticTerminalObservation: {
        observerFrameIdentity: { runId: "r", sourceKey: "s", firstCursor: 1, lastCursor: 1, revision: 1 },
        canvasFrameIdentity: { runId: "r", sourceKey: "s", firstCursor: 1, lastCursor: 1, revision: 1 },
        ingestedCursor: 1, presentedCursor: 1, targetCursor: 1, activeSceneCount: 0, pendingMoments: 0,
        frame: { runId: "r", sourceKey: "s", firstCursor: 1, lastCursor: 1, revision: 1, presentedCursor: 1, world: {
          worldTime: 0, agents: [], homes: [], regions: [], ruins: [], pendingProposals: [],
        } },
      },
      eventWitnesses: [],
      markers: ["event:moved"],
      cadenceWindows: [{ mode: "visible", frameCount: 7, durationMs: 140 }],
      lifecycle: {
        stage: counter(), canvas: counter(), graph: counter(),
        react: { initialCommitCount: 2, finalCommitCount: 3, frameDrivenCommitCount: 0 },
        cacheRebuildReasons: ["initial", "region"],
      },
      raster: { imageSmoothingSamples: [false], coordinates: [0, 0, 1_440, 900] },
      viewportMetrics: { width: 1_440, height: 900, devicePixelRatio: 2 },
      navigation: { method: "GET", path: "/?renderer=2d", status: 200, disposition: "fulfilled" },
    },
  };
}

function c16Handoff() {
  const input = structuredClone(handoff());
  input.chronicleId = "C16";
  input.captureTerminal.rendererDisposals[0].before.graph = {
    activeRegion: { id: "warm_springs" },
  };
  input.cursorSamples = [
    { frameIndex: 0, authoritativeCursor: 1_024, acceptedCursor: 50, presentedCursor: 0, publicCursor: 0, phase: "recovering", epochReady: false },
    { frameIndex: 1, authoritativeCursor: 1_024, acceptedCursor: 1_024, presentedCursor: 1_024, publicCursor: 1_024, phase: "settled", epochReady: true },
    { frameIndex: 2, authoritativeCursor: 2_048, acceptedCursor: 1_074, presentedCursor: 1_024, publicCursor: 1_024, phase: "paused", epochReady: false },
    { frameIndex: 3, authoritativeCursor: 2_048, acceptedCursor: 2_048, presentedCursor: 2_048, publicCursor: 2_048, phase: "settled", epochReady: true },
    { frameIndex: 4, authoritativeCursor: 3_072, acceptedCursor: 2_098, presentedCursor: 2_048, publicCursor: 2_048, phase: "recovering", epochReady: false },
    { frameIndex: 5, authoritativeCursor: 3_072, acceptedCursor: 3_072, presentedCursor: 3_072, publicCursor: 3_072, phase: "settled", epochReady: true },
    { frameIndex: 6, authoritativeCursor: 4_096, acceptedCursor: 3_122, presentedCursor: 3_072, publicCursor: 3_072, phase: "recovering", epochReady: false },
    { frameIndex: 7, authoritativeCursor: 4_096, acceptedCursor: 4_096, presentedCursor: 4_096, publicCursor: 4_096, phase: "settled", epochReady: true },
  ];
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([
    [1, 50],
    [1_025, 1_074],
    [2_049, 2_098],
    [3_073, 3_122],
  ]);
  input.motionSamples = [1_024, 2_048, 3_072, 4_096].map((cursor, index) => ({
    ...structuredClone(input.motionSamples[0]),
    frameIndex: index,
    presentationTimeMs: index * 100,
    cursor,
    epochReady: true,
  }));
  const runtime = (cursor, index, phase, activeSceneCount, epochReady) => ({
    ...structuredClone(input.runtimeObservations[0]),
    frameIndex: index,
    authoritativeCursor: cursor,
    phase,
    epochReady,
    observation: {
      ...structuredClone(input.runtimeObservations[0].observation),
      ingestedCursor: cursor,
      activeSceneCount,
    },
  });
  input.runtimeObservations = [
    runtime(1_024, 0, "active", 1, false),
    runtime(2_048, 2, "pressure", 0, true),
    runtime(3_072, 3, "pressure", 0, true),
    runtime(4_096, 4, "terminal", 0, true),
  ];
  return input;
}

function c13Handoff() {
  const input = structuredClone(handoff());
  input.chronicleId = "C13";
  input.cursorSamples = [
    { frameIndex: 0, authoritativeCursor: 120, acceptedCursor: 50, presentedCursor: 1, publicCursor: 1, phase: "paused" },
    { frameIndex: 1, authoritativeCursor: 120, acceptedCursor: 120, presentedCursor: 120, publicCursor: 120, phase: "settled" },
  ];
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 50]]);
  return input;
}

test("finalizer conversion consumes raw observations instead of manufacturing verdict facts", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  const converted = captureHandoffToOracleInput(input, trustedManifest("C01", 1), "http://127.0.0.1:4173");
  assert.deepEqual(converted.semantic.terminalObservation, input.observations.semanticTerminalObservation);
  assert.deepEqual(converted.semantic.terminalCameraWitness, input.observations.terminalCameraWitness);
  assert.deepEqual(
    converted.reducedMotion.standard.terminalCameraWitness,
    input.observations.terminalCameraWitness,
  );
  assert.deepEqual(
    converted.reducedMotion.reduced.terminalCameraWitness,
    input.reducedTerminalCameraWitness,
  );
  assert.deepEqual(converted.semantic.terminalAuthority, input.observations.terminalAuthority);
  assert.deepEqual(converted.semantic.operationalWorkload, input.observations.operationalWorkload);
  assert.deepEqual(converted.semantic.transportWitnesses, input.observations.transportWitnesses);
  assert.equal(converted.performance.runtimeSamples[0].workload, null);
  assert.deepEqual(converted.performance.cadenceWindows, input.observations.cadenceWindows);
  assert.deepEqual(converted.performance.lifecycle.stage, input.observations.lifecycle.stage);
  assert.deepEqual(converted.performance.lifecycle.react, input.observations.lifecycle.react);
  assert.deepEqual(converted.assets.raster, input.observations.raster);
  assert.equal(converted.performance.lifecycle.atlas.acquireCalls, 2);
  assert.equal(converted.performance.lifecycle.atlas.releaseCalls, 2);
  assert.equal(converted.network.requests[0].url, "http://127.0.0.1:4173/?renderer=2d");
  assert.deepEqual(converted.motion.trajectorySamples[0], {
    frameIndex: 0,
    cursor: 1,
    regionId: "meadow",
    focusSelectionKey: "agent:a",
    camera: input.motionSamples[0].camera,
    recentMarkers: [],
    pathFallbacks: 0,
    actors: input.motionSamples[0].actors,
  });
  assert.deepEqual(converted.motion.regionTransitionWitnesses, [{
    ...input.motionSamples[0].regionTransitions[0],
    observedFrameIndex: 0,
    observedPresentationTimeMs: 0,
  }]);
  assert.deepEqual(converted.performance.schedulerSamples.at(-1), {
    mode: "disposed",
    phase: "disposed",
    routeId: "standard",
    ownerId: "canvas-1",
    dirty: false,
    rafScheduled: false,
    wakeScheduled: false,
    nextDeadlineMs: null,
    observedAtMs: 1_001,
    drawTotal: 7,
    reason: null,
    workload: "disposed",
  });
});

test("finalizer rejects absent and unknown raw handoff schema versions", () => {
  for (const schemaVersion of [undefined, 0, 2, "1"]) {
    const input = handoff();
    input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
    if (schemaVersion === undefined) delete input.schemaVersion;
    else input.schemaVersion = schemaVersion;
    assert.throws(
      () => captureHandoffToOracleInput(
        input,
        trustedManifest("C01", 1),
        "http://127.0.0.1:4173",
      ),
      /capture handoff schemaVersion must be exactly 1/,
    );
  }
});

test("finalizer rejects raw motion-mode keys that could override derived authority", () => {
  for (const [modeField, injected] of [
    ["standardMotion", { captureId: "forged", artifactDirectory: "C00/desktop" }],
    ["reducedMotion", { mode: "standard", unknownDiagnostic: true }],
  ]) {
    const input = handoff();
    input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
    Object.assign(input[modeField], injected);
    assert.throws(
      () => captureHandoffToOracleInput(
        input,
        trustedManifest("C01", 1),
        "http://127.0.0.1:4173",
      ),
      new RegExp(`${modeField} contains unknown field`),
    );
  }
});

test("finalizer strips unprojected transition fields at the trust boundary", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  input.motionSamples[0].regionTransitions[0].rendererDiagnostic = { mutable: true };
  const converted = captureHandoffToOracleInput(
    input,
    trustedManifest("C01", 1),
    "http://127.0.0.1:4173",
  );
  assert.equal("rendererDiagnostic" in converted.motion.regionTransitionWitnesses[0], false);
});

test("finalizer rejects a noncanonical raw handoff before catalog lookup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "vivarium-handoff-canonical-"));
  const handoffFile = path.join(directory, "capture-raw-observations.json");
  try {
    await writeFile(handoffFile, '{"schemaVersion":1, "schemaVersion":1}\n');
    await assert.rejects(
      finalizeCaptureHandoff({
        handoffFile,
        artifactRoot: directory,
        applicationOrigin: "http://127.0.0.1:4173",
      }),
      /not normalized canonical JSON/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finalizer rejects request-summary count and canonical ledger hash drift", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  const raw = captureHandoffToOracleInput(
    input,
    trustedManifest("C01", 1),
    APPLICATION_ORIGIN,
  );
  input.observations.requestSummary = {
    observedCount: raw.network.requests.length,
    ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(raw.network.requests))),
  };
  assert.deepEqual(assertRequestSummaryBindsNetwork(input, raw), input.observations.requestSummary);

  for (const mutation of [
    (summary) => { summary.observedCount += 1; },
    (summary) => { summary.ledgerSha256 = "0".repeat(64); },
  ]) {
    const forged = structuredClone(input);
    mutation(forged.observations.requestSummary);
    assert.throws(
      () => assertRequestSummaryBindsNetwork(forged, raw),
      /request observation summary does not bind/,
    );
  }
});

test("complete C02-sized four-actor serialization envelope round-trips canonically", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "vivarium-c02-handoff-"));
  const baseFile = path.join(directory, "capture-base.json");
  const handoffFile = path.join(directory, "capture-raw-observations.json");
  const complete = handoff();
  try {
    // This browser-free regression owns the original writer/string-ceiling failure path:
    // every top-level handoff ledger is present, while the expensive cursor/motion ledgers
    // use C02's exact frame count, manifest population, and transition cardinality. The
    // fresh Playwright C02 canary separately owns semantic/oracle validity of real capture.
    complete.chronicleId = "C02";
    complete.checkpointWitnesses = {
      standard: { witnesses: [], markerFrames: {} },
      reduced: { witnesses: [], markerFrames: {} },
    };
    complete.markerFrames = [];
    complete.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 20]]);
    const runtimeRequests = [
      {
        sequence: 1,
        kind: "navigation",
        method: "GET",
        url: `${APPLICATION_ORIGIN}/?renderer=2d`,
        handler: "vite-navigation",
        status: 200,
        disposition: "fulfilled",
        responseStatus: 200,
        terminal: "finished",
        failureText: null,
      },
      {
        sequence: 2,
        kind: "api",
        method: "GET",
        url: `${APPLICATION_ORIGIN}/api/run`,
        handler: "api-fixture",
        status: 200,
        disposition: "fulfilled",
        responseStatus: 200,
        terminal: "finished",
        failureText: null,
      },
    ];
    complete.requests.runtimeRequests = runtimeRequests;
    complete.observations.requestSummary = {
      observedCount: runtimeRequests.length,
      ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(runtimeRequests))),
    };
    await writeNormalizedJson(baseFile, complete);

    const workerArgs = ["--expose-gc", "--max-old-space-size=384", C02_WORKER_FILE];
    const legacyResult = await execFileAsync(process.execPath, [
      ...workerArgs,
      "legacy",
      baseFile,
      C02_MANIFEST_FILE,
      APPLICATION_ORIGIN,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const legacySummary = JSON.parse(legacyResult.stdout);
    const projectResult = await execFileAsync(process.execPath, [
      ...workerArgs,
      "project",
      baseFile,
      C02_MANIFEST_FILE,
      APPLICATION_ORIGIN,
      handoffFile,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const expectedTransitionFrames = JSON.parse(projectResult.stdout).transitionFirstFrames;

    const metadata = await stat(handoffFile);
    const { stdout } = await execFileAsync(process.execPath, [
      ...workerArgs,
      "read",
      handoffFile,
      C02_MANIFEST_FILE,
      APPLICATION_ORIGIN,
    ], { maxBuffer: 4 * 1024 * 1024 });
    const roundTrip = JSON.parse(stdout);

    assert.equal(roundTrip.sha256, legacySummary.sha256);
    assert.equal(roundTrip.evidenceSha256, legacySummary.evidenceSha256);
    assert.deepEqual(roundTrip.regionTransitionWitnesses, legacySummary.regionTransitionWitnesses);
    assert.deepEqual(
      roundTrip.regionTransitionWitnesses.map(({ observedFrameIndex }) => observedFrameIndex),
      expectedTransitionFrames,
    );
    assert.deepEqual(
      roundTrip.regionTransitionWitnesses.map(({ observedPresentationTimeMs }) => (
        observedPresentationTimeMs
      )),
      expectedTransitionFrames.map((frameIndex) => frameIndex * 1_000 / 30),
    );
    assert.equal(roundTrip.frameCount, C02_FRAME_COUNT);
    assert.equal(roundTrip.trajectoryCount, C02_FRAME_COUNT);
    assert.equal(roundTrip.firstFrame.frameIndex, 0);
    assert.equal(roundTrip.lastFrame.frameIndex, C02_FRAME_COUNT - 1);
    assert.equal(roundTrip.lastFrame.cursor, 20);
    assert.deepEqual(roundTrip.homeOwnershipSegments, legacySummary.homeOwnershipSegments);
    assert.deepEqual(roundTrip.handoff, {
      schemaVersion: 1,
      chronicleId: "C02",
      viewport: "desktop",
      cursorSampleCount: C02_FRAME_COUNT,
      motionSampleCount: C02_FRAME_COUNT,
      firstFrameIndex: 0,
      lastFrameIndex: C02_FRAME_COUNT - 1,
      transitionCount: 10,
      transitionCommandCount: 10,
      actorCount: 4,
      homeCount: 0,
      environmentCount: 1,
      placementCount: 4,
      containsRendererSentinel: false,
      runtimeRequestCount: 2,
      runtimeRequestsSha256: complete.observations.requestSummary.ledgerSha256,
      requestSummary: complete.observations.requestSummary,
    });
    assert.deepEqual(roundTrip.requestSummary, complete.observations.requestSummary);
    assert.equal(roundTrip.networkRequestCount, 2);
    assert.equal(
      roundTrip.networkLedgerSha256,
      complete.observations.requestSummary.ledgerSha256,
    );
    assert.ok(
      metadata.size < Math.floor(bufferConstants.MAX_STRING_LENGTH / 4),
      `canonical handoff ${metadata.size} bytes exceeds the quarter-ceiling safety budget`,
    );
    assert.ok(
      metadata.size + REQUIRED_STRING_HEADROOM_BYTES < bufferConstants.MAX_STRING_LENGTH,
      `canonical handoff ${metadata.size} bytes lacks ${REQUIRED_STRING_HEADROOM_BYTES} bytes of string headroom`,
    );
    assert.match(roundTrip.sha256, /^[a-f0-9]{64}$/);
    assert.match(roundTrip.evidenceSha256, /^[a-f0-9]{64}$/);
    t.diagnostic(
      `canonicalBytes=${metadata.size} maxStringLength=${bufferConstants.MAX_STRING_LENGTH} parentMaxRSS=${process.resourceUsage().maxRSS}`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("projected handoff motion produces the exact same canonical oracle input", () => {
  const legacy = handoff();
  legacy.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  legacy.motionSamples[0].unusedRendererGraph = { sentinel: "must-not-survive" };
  legacy.motionSamples[0].environments[0].unusedDecorationGraph = "must-not-survive";
  legacy.motionSamples[0].rendererPool.unusedAtlasEntries = ["must-not-survive"];
  legacy.motionSamples[0].homes = [{ id: "home-a", instanceId: 7, unusedVisual: "must-not-survive" }];

  const projected = structuredClone(legacy);
  projected.motionSamples = projectMotionSamplesForHandoff(projected.motionSamples);

  assert.equal(JSON.stringify(projected.motionSamples).includes("must-not-survive"), false);
  assert.deepEqual(
    captureHandoffToOracleInput(
      projected,
      trustedManifest("C01", 1),
      "http://127.0.0.1:4173",
    ),
    captureHandoffToOracleInput(
      legacy,
      trustedManifest("C01", 1),
      "http://127.0.0.1:4173",
    ),
  );
});

test("finalizer rejects a raw handoff without its terminal camera witness", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  delete input.observations.terminalCameraWitness;
  assert.throws(
    () => captureHandoffToOracleInput(
      input,
      trustedManifest("C01", 1),
      "http://127.0.0.1:4173",
    ),
    /terminalCameraWitness/,
  );
});

test("finalizer rejects a raw handoff without its reduced terminal camera witness", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  delete input.reducedTerminalCameraWitness;
  assert.throws(
    () => captureHandoffToOracleInput(
      input,
      trustedManifest("C01", 1),
      "http://127.0.0.1:4173",
    ),
    /reducedTerminalCameraWitness/,
  );
});

test("finalizer coalesces identical transition observations but rejects contradictory repeats", () => {
  const identical = handoff();
  identical.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  const repeated = structuredClone(identical.motionSamples[0]);
  repeated.frameIndex = 1;
  repeated.presentationTimeMs = 1_000 / 30;
  identical.motionSamples.push(repeated);
  const converted = captureHandoffToOracleInput(
    identical,
    trustedManifest("C01", 1),
    "http://127.0.0.1:4173",
  );
  assert.equal(converted.motion.regionTransitionWitnesses.length, 1);
  assert.equal(converted.motion.regionTransitionWitnesses[0].observedFrameIndex, 0);

  const contradictory = structuredClone(identical);
  contradictory.motionSamples[1].regionTransitions[0].actorPosition.x += 1;
  assert.throws(
    () => captureHandoffToOracleInput(
      contradictory,
      trustedManifest("C01", 1),
      "http://127.0.0.1:4173",
    ),
    /transition command arrival:a has contradictory repeated observations/,
  );
});

test("finalizer collapses stable home ownership and preserves same-region instance churn", () => {
  const input = handoff();
  input.observations.eventWitnesses = acceptedEnvelopeWitnesses([[1, 1]]);
  const sample = input.motionSamples[0];
  sample.activeRegion = { id: "nirvana" };
  sample.homes = [{ id: "home_a", instanceId: 1 }];

  input.motionSamples.push({
    ...structuredClone(sample),
    frameIndex: 1,
    presentationTimeMs: 1_000 / 30,
  });
  input.motionSamples.push({
    ...structuredClone(sample),
    frameIndex: 2,
    presentationTimeMs: 2_000 / 30,
    homes: [{ id: "home_a", instanceId: 2 }],
  });
  input.motionSamples.push({
    ...structuredClone(sample),
    frameIndex: 3,
    presentationTimeMs: 3_000 / 30,
    activeRegion: { id: "warm_springs" },
    homes: [],
  });

  const converted = captureHandoffToOracleInput(
    input,
    trustedManifest("C01", 1),
    "http://127.0.0.1:4173",
  );
  assert.deepEqual(converted.motion.homeOwnershipSegments, [
    {
      firstFrameIndex: 0,
      lastFrameIndex: 1,
      regionId: "nirvana",
      homes: [{ id: "home_a", instanceId: 1 }],
    },
    {
      firstFrameIndex: 2,
      lastFrameIndex: 2,
      regionId: "nirvana",
      homes: [{ id: "home_a", instanceId: 2 }],
    },
    {
      firstFrameIndex: 3,
      lastFrameIndex: 3,
      regionId: "warm_springs",
      homes: [],
    },
  ]);
});

test("finalizer rejects missing terminal authority, workload, or transport facts", () => {
  for (const field of ["terminalAuthority", "operationalWorkload", "transportWitnesses"]) {
    const input = handoff();
    delete input.observations[field];
    assert.throws(
      () => captureHandoffToOracleInput(
        input,
        trustedManifest("C01", 1),
        "http://127.0.0.1:4173",
      ),
      new RegExp(`lacks observed ${field}`),
    );
  }
});

test("finalizer conversion rejects a handoff without separately observed facts", () => {
  const input = handoff();
  delete input.observations;
  assert.throws(
    () => captureHandoffToOracleInput(input, trustedManifest("C01", 1), "http://127.0.0.1:4173"),
    /lacks observed facts/,
  );
});

test("C16 finalizer requires one unique epoch-ready plateau per density cursor", () => {
  const exact = c16Handoff();
  assert.doesNotThrow(() => captureHandoffToOracleInput(
    exact,
    trustedManifest("C16", 4_096),
    "http://127.0.0.1:4173",
  ));

  const missing = c16Handoff();
  missing.motionSamples.find(({ cursor }) => cursor === 2_048).epochReady = false;
  assert.throws(
    () => captureHandoffToOracleInput(
      missing,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /epoch-ready witness 2048 must be unique/,
  );

  const duplicate = c16Handoff();
  duplicate.motionSamples.push(structuredClone(
    duplicate.motionSamples.find(({ cursor }) => cursor === 3_072),
  ));
  assert.throws(
    () => captureHandoffToOracleInput(
      duplicate,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /epoch-ready witness 3072 must be unique/,
  );
});

test("finalizer derives every maximal C13/C16 gap from accepted SSE envelope truth", () => {
  const c13 = captureHandoffToOracleInput(
    c13Handoff(),
    trustedManifest("C13", 120),
    "http://127.0.0.1:4173",
  );
  assert.deepEqual(c13.cursors.gaps, [{
    fromCursor: 51,
    toCursor: 120,
    detectedFrameIndex: 0,
    visibleFrameIndex: 0,
    recoveredFrameIndex: 1,
    resumedFrameIndex: 1,
  }]);

  const c16 = captureHandoffToOracleInput(
    c16Handoff(),
    trustedManifest("C16", 4_096),
    "http://127.0.0.1:4173",
  );
  assert.deepEqual(c16.cursors.gaps, [
    { fromCursor: 51, toCursor: 1_024, detectedFrameIndex: 0, visibleFrameIndex: 0, recoveredFrameIndex: 1, resumedFrameIndex: 1 },
    { fromCursor: 1_075, toCursor: 2_048, detectedFrameIndex: 2, visibleFrameIndex: 2, recoveredFrameIndex: 3, resumedFrameIndex: 3 },
    { fromCursor: 2_099, toCursor: 3_072, detectedFrameIndex: 4, visibleFrameIndex: 4, recoveredFrameIndex: 5, resumedFrameIndex: 5 },
    { fromCursor: 3_123, toCursor: 4_096, detectedFrameIndex: 6, visibleFrameIndex: 6, recoveredFrameIndex: 7, resumedFrameIndex: 7 },
  ]);
});

test("finalizer rejects missing accepted boundaries, false accepted overlap, and missing epoch recovery", () => {
  const missingBoundary = c16Handoff();
  missingBoundary.observations.eventWitnesses = missingBoundary.observations.eventWitnesses.filter(
    ({ cursor }) => cursor !== 50,
  );
  assert.throws(
    () => captureHandoffToOracleInput(
      missingBoundary,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /gap.*50.*1024.*witness/i,
  );

  const mismatchedEnvelope = c16Handoff();
  mismatchedEnvelope.observations.eventWitnesses.find(({ cursor }) => cursor === 50)
    .envelope.next_cursor = 49;
  assert.throws(
    () => captureHandoffToOracleInput(
      mismatchedEnvelope,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /accepted SSE envelope cursor does not match raw payload/,
  );

  const falseOverlap = c16Handoff();
  falseOverlap.observations.eventWitnesses.push(...acceptedEnvelopeWitnesses([[1_075, 1_075]]));
  assert.throws(
    () => captureHandoffToOracleInput(
      falseOverlap,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /gap.*1076.*2048.*witness/i,
  );

  const missingEpoch = c16Handoff();
  missingEpoch.cursorSamples.find(({ authoritativeCursor, epochReady }) => (
    authoritativeCursor === 3_072 && epochReady === true
  )).epochReady = false;
  assert.throws(
    () => captureHandoffToOracleInput(
      missingEpoch,
      trustedManifest("C16", 4_096),
      "http://127.0.0.1:4173",
    ),
    /gap.*2099.*3072.*recovered/i,
  );
});
