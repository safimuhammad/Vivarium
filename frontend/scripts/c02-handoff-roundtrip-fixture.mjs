import assert from "node:assert/strict";

export const C02_FRAME_COUNT = 23_491;

/** Build the real-cardinality C02 cursor and renderer ledgers with shared source payloads. */
export function createC02CaptureLedgers(manifest) {
  const hash = "a".repeat(64);
  const actorIds = Object.freeze(manifest.initialSnapshot.agents.map(({ id }) => id));
  assert.deepEqual(actorIds, [
    "wanderer_001", "wanderer_002", "wanderer_003", "wanderer_004",
  ]);
  const actors = Object.freeze(actorIds.map((id, index) => Object.freeze({
    id,
    instanceId: index + 1,
    position: Object.freeze({ x: 64 + index * 96, y: 96 + index * 64 }),
    facing: index === 0 ? "east" : "south",
    activeAction: "moving",
    opacity: 1,
    reposition: null,
    worldBounds: Object.freeze({ x: 27 + index * 96, y: 34 + index * 64, width: 67, height: 72 }),
    screenBounds: Object.freeze({ x: 54 + index * 192, y: 68 + index * 128, width: 134, height: 144 }),
    screenVisible: true,
    safeFrameVisible: true,
    unusedRig: "must-not-survive",
  })));
  const placements = Object.freeze(Object.fromEntries(
    actorIds.map((id) => [`actor:${id}`, hash]),
  ));
  const camera = Object.freeze({
    mode: "story",
    zoom: 2,
    rasterOrigin: Object.freeze({ x: 0, y: 0 }),
    safeFrame: Object.freeze({ x: 20, y: 10, width: 1_400, height: 860 }),
    viewport: Object.freeze({ width: 1_440, height: 900 }),
  });
  const entered = manifest.entries.filter(({ event }) => event.type === "agent_entered_region");
  assert.equal(entered.length, 10);
  const transitionFirstFrames = Object.freeze(entered.map(({ cursor }) => cursor * 1_000));
  const transitions = Object.freeze(entered.map(({ cursor, event }, index) => {
    const { payload } = event;
    return Object.freeze({
      actorId: payload.agent_id,
      reason: "region-transition",
      position: Object.freeze({ x: 80 + index * 32, y: 112 + index * 16 }),
      actorPosition: Object.freeze({ x: 80 + index * 32, y: 112 + index * 16 }),
      gate: Object.freeze({
        role: "arrival",
        tile: Object.freeze({ column: 2 + index, row: 3 + index }),
        tileSize: 32,
        point: Object.freeze({ x: 80 + index * 32, y: 112 + index * 16 }),
      }),
      fromRegion: payload.from_region,
      toRegion: payload.to_region,
      sceneToken: cursor,
      commandId: `arrival:${payload.agent_id}:${cursor}`,
      atMs: transitionFirstFrames[index] * 1_000 / 30,
      frameIdentity: Object.freeze({
        runId: manifest.runId,
        sourceKey: `fixture:${manifest.id}`,
        firstCursor: cursor,
        lastCursor: cursor,
        revision: cursor,
      }),
      rendererDiagnostic: Object.freeze({ sentinel: "must-not-survive" }),
    });
  }));
  const transitionWindows = Object.freeze(Array.from(
    { length: transitions.length + 1 },
    (_, count) => Object.freeze(transitions.slice(0, count)),
  ));
  const environments = Object.freeze([Object.freeze({
    diagnostics: Object.freeze({
      capacities: Object.freeze({ ground: 64, props: 32 }),
      allocatedSlots: Object.freeze({ ground: 48, props: 12 }),
      unusedPhaseSignature: "must-not-survive",
    }),
    unusedDecorationGraph: "must-not-survive",
  })]);
  const rendererPool = Object.freeze({
    activeCompressedMax: 1_024,
    decodedBytes: 512,
    leases: 2,
    waiterCount: 0,
    inFlightCount: 0,
    expectedActiveCompressedBytes: 256,
    activeAtlasIds: Object.freeze(["must-not-survive"]),
  });
  const activeRegionIds = ["nirvana", ...entered.map(({ event }) => event.payload.to_region)];
  const transitionCountAt = (frameIndex) => transitionFirstFrames.filter((first) => first <= frameIndex).length;
  const cursorAt = (frameIndex) => Math.min(20, Math.floor(frameIndex / 1_000));
  const motionSamples = Array.from({ length: C02_FRAME_COUNT }, (_, frameIndex) => {
    const transitionCount = transitionCountAt(frameIndex);
    return {
      frameIndex,
      presentationTimeMs: frameIndex * 1_000 / 30,
      cursor: cursorAt(frameIndex),
      epochReady: false,
      placementHash: hash,
      placements,
      actors,
      focusSelectionKey: "agent:wanderer_003",
      camera,
      regionTransitions: transitionWindows[transitionCount],
      homes: Object.freeze([]),
      recentMarkers: Object.freeze([]),
      pathFallbacks: 0,
      activeEffects: 0,
      activeRegion: Object.freeze({ id: activeRegionIds[transitionCount] }),
      environments,
      rendererPool,
      unusedRendererGraph: Object.freeze({ sentinel: "must-not-survive" }),
    };
  });
  const cursorSamples = Array.from({ length: C02_FRAME_COUNT }, (_, frameIndex) => {
    const cursor = cursorAt(frameIndex);
    return {
      frameIndex,
      authoritativeCursor: cursor,
      acceptedCursor: cursor,
      presentedCursor: cursor,
      publicCursor: cursor,
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.id}`,
      epochReady: false,
      phase: frameIndex === C02_FRAME_COUNT - 1 ? "settled" : "running",
    };
  });
  return { motionSamples, cursorSamples, transitionFirstFrames };
}
