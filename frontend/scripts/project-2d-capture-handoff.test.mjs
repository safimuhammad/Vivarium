import assert from "node:assert/strict";
import test from "node:test";

import { projectMotionSamplesForHandoff } from "./project-2d-capture-handoff.mjs";

const FRAME_COUNT = 3;
const HASH = "a".repeat(64);

function sourceFrame(frameIndex) {
  const transition = {
    commandId: "arrival:joe:20",
    actorId: "joe",
    reason: "region-transition",
    position: { x: 64, y: 96 },
    actorPosition: { x: 64, y: 96 },
    gate: {
      role: "arrival",
      tile: { column: 2, row: 3 },
      tileSize: 32,
      point: { x: 64, y: 96 },
    },
    fromRegion: "nirvana",
    toRegion: "warm_springs",
    sceneToken: 20,
    atMs: 700_000,
    frameIdentity: {
      runId: "mock-c02-v1",
      sourceKey: "fixture:C02",
      firstCursor: 20,
      lastCursor: 20,
      revision: 20,
    },
    nested: { unusedRendererDiagnostic: true },
  };
  return {
    frameIndex,
    presentationTimeMs: frameIndex * 1000 / 30,
    cursor: 20,
    epochReady: false,
    placementHash: HASH,
    placements: { "actor:joe": HASH },
    actors: [{
      id: "joe", instanceId: 1, position: { x: 1, y: 2 }, facing: "east",
      activeAction: "moving", opacity: 1, reposition: null,
      worldBounds: { x: 0, y: 0, width: 32, height: 64 },
      screenBounds: { x: 0, y: 0, width: 64, height: 128 },
      screenVisible: true, safeFrameVisible: true,
      unusedRig: "must-not-survive",
    }],
    focusSelectionKey: "agent:joe",
    camera: {
      mode: "story", zoom: 2, rasterOrigin: { x: 0, y: 0 },
      safeFrame: { x: 0, y: 0, width: 1_440, height: 900 },
      viewport: { width: 1_440, height: 900 },
    },
    regionTransitions: [transition],
    homes: [{ id: "home-1", instanceId: 7, unusedVisual: "must-not-survive" }],
    recentMarkers: [
      ...Array.from({ length: 64 }, (_, index) => ({
        marker: "movement-progress",
        index,
        heavyweightPayload: "must-not-survive",
      })),
      { marker: "repositioned", kind: "actor", actorId: "joe", atMs: 500 },
    ],
    pathFallbacks: 0,
    activeEffects: 0,
    activeRegion: { id: "warm_springs", unusedGraph: "must-not-survive" },
    environments: [{
      diagnostics: {
        capacities: { ground: 64, props: 32 },
        allocatedSlots: { ground: 48, props: 12 },
        unusedPhaseSignature: "must-not-survive",
      },
      unusedDecorationGraph: "must-not-survive",
    }],
    rendererPool: {
      activeCompressedMax: 1_024,
      decodedBytes: 512,
      leases: 2,
      waiterCount: 0,
      inFlightCount: 0,
      expectedActiveCompressedBytes: 256,
      entries: ["must-not-survive"],
      activeAtlasIds: ["must-not-survive"],
      lifecycle: { unused: "must-not-survive" },
    },
    unusedRendererGraph: { sentinel: "must-not-survive" },
  };
}

test("projects every consecutive frame without retaining renderer-only payload", () => {
  const projected = projectMotionSamplesForHandoff(
    Array.from({ length: FRAME_COUNT }, (_, frameIndex) => sourceFrame(frameIndex)),
  );
  const canonical = `${JSON.stringify(projected, null, 2)}\n`;
  const roundTrip = JSON.parse(canonical);

  assert.equal(projected.length, FRAME_COUNT);
  assert.equal(projected[0].frameIndex, 0);
  assert.equal(projected.at(-1).frameIndex, FRAME_COUNT - 1);
  assert.equal(roundTrip.length, FRAME_COUNT);
  assert.equal(roundTrip.at(-1).presentationTimeMs, (FRAME_COUNT - 1) * 1000 / 30);
  assert.equal(roundTrip[0].regionTransitions.length, 1);
  assert.equal(roundTrip.at(-1).regionTransitions.length, 0);
  assert.equal(canonical.includes("must-not-survive"), false);
});

test("retains every field consumed by the finalizer and removes only non-contract payload", () => {
  const projected = projectMotionSamplesForHandoff([sourceFrame(0)])[0];

  assert.deepEqual(projected, {
    frameIndex: 0,
    presentationTimeMs: 0,
    cursor: 20,
    epochReady: false,
    placementHash: HASH,
    placements: { "actor:joe": HASH },
    actors: [{
      id: "joe", instanceId: 1, position: { x: 1, y: 2 }, facing: "east",
      activeAction: "moving", opacity: 1, reposition: null,
      worldBounds: { x: 0, y: 0, width: 32, height: 64 },
      screenBounds: { x: 0, y: 0, width: 64, height: 128 },
      screenVisible: true, safeFrameVisible: true,
    }],
    focusSelectionKey: "agent:joe",
    camera: {
      mode: "story", zoom: 2, rasterOrigin: { x: 0, y: 0 },
      safeFrame: { x: 0, y: 0, width: 1_440, height: 900 },
      viewport: { width: 1_440, height: 900 },
    },
    regionTransitions: [{
      commandId: "arrival:joe:20",
      actorId: "joe",
      reason: "region-transition",
      position: { x: 64, y: 96 },
      actorPosition: { x: 64, y: 96 },
      gate: {
        role: "arrival",
        tile: { column: 2, row: 3 },
        tileSize: 32,
        point: { x: 64, y: 96 },
      },
      fromRegion: "nirvana",
      toRegion: "warm_springs",
      sceneToken: 20,
      atMs: 700_000,
      frameIdentity: {
        runId: "mock-c02-v1",
        sourceKey: "fixture:C02",
        firstCursor: 20,
        lastCursor: 20,
        revision: 20,
      },
    }],
    homes: [{ id: "home-1", instanceId: 7 }],
    recentMarkers: [
      { marker: "repositioned", kind: "actor", actorId: "joe", atMs: 500 },
    ],
    pathFallbacks: 0,
    activeEffects: 0,
    activeRegion: { id: "warm_springs" },
    environments: [{
      diagnostics: {
        capacities: { ground: 64, props: 32 },
        allocatedSlots: { ground: 48, props: 12 },
      },
    }],
    rendererPool: {
      activeCompressedMax: 1_024,
      decodedBytes: 512,
      leases: 2,
      waiterCount: 0,
      inFlightCount: 0,
      expectedActiveCompressedBytes: 256,
    },
  });
});

test("rejects a discontinuous frame ledger before writing a handoff", () => {
  assert.throws(
    () => projectMotionSamplesForHandoff([sourceFrame(0), sourceFrame(2)]),
    /motion sample 1 must have consecutive frameIndex 1/,
  );
});

test("rejects contradictory cumulative transition observations", () => {
  const changed = sourceFrame(1);
  changed.regionTransitions[0].toRegion = "nirvana_east";
  assert.throws(
    () => projectMotionSamplesForHandoff([sourceFrame(0), changed]),
    /transition command arrival:joe:20 has contradictory repeated observations/,
  );
});

test("ignores changing renderer-only transition diagnostics while retaining first observation time", () => {
  const before = sourceFrame(0);
  before.regionTransitions = [];
  const first = sourceFrame(1);
  first.regionTransitions[0].nested = { unusedRendererDiagnostic: "first" };
  const repeated = sourceFrame(2);
  repeated.regionTransitions[0].nested = { unusedRendererDiagnostic: "later" };

  const projected = projectMotionSamplesForHandoff([before, first, repeated]);

  assert.deepEqual(projected.map(({ regionTransitions }) => regionTransitions.length), [0, 1, 0]);
  assert.equal(projected[1].presentationTimeMs, 1_000 / 30);
  assert.equal("nested" in projected[1].regionTransitions[0], false);
});

test("retains only reposition markers in each rolling frame window", () => {
  const first = sourceFrame(0);
  first.recentMarkers = [
    { marker: "movement-progress", actorId: "joe", atMs: 100 },
    { marker: "repositioned", kind: "actor", actorId: "joe", atMs: 200 },
  ];
  const second = sourceFrame(1);
  second.recentMarkers = [
    ...first.recentMarkers,
    { marker: "movement-progress", actorId: "joe", atMs: 300 },
    { marker: "repositioned", kind: "actor", actorId: "maya", atMs: 400 },
  ];
  const projected = projectMotionSamplesForHandoff([first, second]);

  assert.deepEqual(projected.map(({ recentMarkers }) => recentMarkers), [
    [{ marker: "repositioned", kind: "actor", actorId: "joe", atMs: 200 }],
    [
      { marker: "repositioned", kind: "actor", actorId: "joe", atMs: 200 },
      { marker: "repositioned", kind: "actor", actorId: "maya", atMs: 400 },
    ],
  ]);
});
