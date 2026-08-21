/**
 * Project transient browser motion observations to the exact finalizer contract.
 *
 * The browser debug seam exposes substantially more renderer internals than the
 * evidence oracle consumes. Repeating those internals across long 30 Hz travel
 * captures can exceed V8's single-string limit before the raw handoff is written.
 * This projection retains every frame and every field read by
 * `captureHandoffToOracleInput`, while removing non-contract renderer payload.
 */

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const POOL_FIELDS = Object.freeze([
  "activeCompressedMax",
  "decodedBytes",
  "leases",
  "waiterCount",
  "inFlightCount",
  "expectedActiveCompressedBytes",
]);

/** Return a consecutive, lossless-for-the-finalizer motion ledger. */
export function projectMotionSamplesForHandoff(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("capture handoff motion samples must be a nonempty array");
  }
  const observedTransitions = new Map();
  return Object.freeze(samples.map((sample, index) => (
    projectMotionSample(sample, index, observedTransitions)
  )));
}

function projectMotionSample(sample, index, observedTransitions) {
  assertRecord(sample, `motion sample ${index}`);
  const frameIndex = nonNegativeSafeInteger(sample.frameIndex, `motion sample ${index} frameIndex`);
  if (frameIndex !== index) {
    throw new Error(`motion sample ${index} must have consecutive frameIndex ${index}`);
  }
  const presentationTimeMs = finiteNonNegativeNumber(
    sample.presentationTimeMs,
    `motion sample ${index} presentationTimeMs`,
  );
  const cursor = nonNegativeSafeInteger(sample.cursor, `motion sample ${index} cursor`);
  if (typeof sample.epochReady !== "boolean") {
    throw new Error(`motion sample ${index} epochReady must be boolean`);
  }
  if (typeof sample.placementHash !== "string" || !SHA256_PATTERN.test(sample.placementHash)) {
    throw new Error(`motion sample ${index} placementHash must be SHA-256`);
  }
  assertRecord(sample.placements, `motion sample ${index} placements`);
  if (!Array.isArray(sample.actors)) throw new Error(`motion sample ${index} actors must be an array`);
  if (!Array.isArray(sample.regionTransitions)) {
    throw new Error(`motion sample ${index} regionTransitions must be an array`);
  }
  if (!Array.isArray(sample.homes)) throw new Error(`motion sample ${index} homes must be an array`);
  if (!Array.isArray(sample.recentMarkers)) {
    throw new Error(`motion sample ${index} recentMarkers must be an array`);
  }
  if (!Array.isArray(sample.environments)) {
    throw new Error(`motion sample ${index} environments must be an array`);
  }
  assertRecord(sample.camera, `motion sample ${index} camera`);
  const activeEffects = nonNegativeSafeInteger(
    sample.activeEffects,
    `motion sample ${index} activeEffects`,
  );
  const pathFallbacks = nonNegativeSafeInteger(
    sample.pathFallbacks,
    `motion sample ${index} pathFallbacks`,
  );

  return Object.freeze({
    frameIndex,
    presentationTimeMs,
    cursor,
    epochReady: sample.epochReady,
    placementHash: sample.placementHash,
    placements: sample.placements,
    actors: Object.freeze(sample.actors.map((actor, actorIndex) => (
      projectActor(actor, `motion sample ${index} actor ${actorIndex}`)
    ))),
    focusSelectionKey: sample.focusSelectionKey ?? null,
    camera: sample.camera,
    regionTransitions: projectRegionTransitions(
      sample.regionTransitions,
      observedTransitions,
      `motion sample ${index}`,
    ),
    homes: Object.freeze(sample.homes.map((home, homeIndex) => (
      projectHome(home, `motion sample ${index} home ${homeIndex}`)
    ))),
    recentMarkers: projectRepositionMarkersForHandoff(
      sample.recentMarkers,
      `motion sample ${index}`,
    ),
    pathFallbacks,
    activeEffects,
    activeRegion: projectActiveRegion(sample.activeRegion, `motion sample ${index} activeRegion`),
    environments: Object.freeze(sample.environments.map((environment, environmentIndex) => (
      projectEnvironment(environment, `motion sample ${index} environment ${environmentIndex}`)
    ))),
    rendererPool: projectRendererPool(sample.rendererPool, `motion sample ${index} rendererPool`),
  });
}

function projectRegionTransitions(transitions, observed, label) {
  const newlyObserved = [];
  for (const [transitionIndex, transition] of transitions.entries()) {
    const transitionLabel = `${label} transition ${transitionIndex}`;
    const projected = projectRegionTransitionWitness(transition, transitionLabel);
    const canonical = stableJson(projected);
    const prior = observed.get(projected.commandId);
    if (prior !== undefined) {
      if (prior !== canonical) {
        throw new Error(
          `transition command ${projected.commandId} has contradictory repeated observations`,
        );
      }
      continue;
    }
    observed.set(projected.commandId, canonical);
    newlyObserved.push(projected);
  }
  return Object.freeze(newlyObserved);
}

/** Project one renderer transition to the finite typed evidence contract. */
export function projectRegionTransitionWitness(transition, label = "region transition") {
  assertRecord(transition, label);
  const actorId = nonBlankString(transition.actorId, `${label} actorId`);
  if (transition.reason !== "region-transition") {
    throw new Error(`${label} reason must be region-transition`);
  }
  const position = projectVec2(transition.position, `${label} position`);
  const actorPosition = projectVec2(transition.actorPosition, `${label} actorPosition`);
  assertRecord(transition.gate, `${label} gate`);
  if (transition.gate.role !== "arrival") throw new Error(`${label} gate role must be arrival`);
  assertRecord(transition.gate.tile, `${label} gate tile`);
  const tile = Object.freeze({
    column: nonNegativeSafeInteger(transition.gate.tile.column, `${label} gate tile column`),
    row: nonNegativeSafeInteger(transition.gate.tile.row, `${label} gate tile row`),
  });
  if (transition.gate.tileSize !== 32) throw new Error(`${label} gate tileSize must be 32`);
  const point = projectVec2(transition.gate.point, `${label} gate point`);
  const fromRegion = nonBlankString(transition.fromRegion, `${label} fromRegion`);
  const toRegion = nonBlankString(transition.toRegion, `${label} toRegion`);
  const sceneToken = nonNegativeSafeInteger(transition.sceneToken, `${label} sceneToken`);
  const commandId = nonBlankString(transition.commandId, `${label} commandId`);
  const atMs = finiteNonNegativeNumber(transition.atMs, `${label} atMs`);
  const frameIdentity = projectFrameIdentity(transition.frameIdentity, `${label} frameIdentity`);
  return Object.freeze({
    actorId,
    reason: "region-transition",
    position,
    actorPosition,
    gate: Object.freeze({ role: "arrival", tile, tileSize: 32, point }),
    fromRegion,
    toRegion,
    sceneToken,
    commandId,
    atMs,
    frameIdentity,
  });
}

function projectVec2(value, label) {
  assertRecord(value, label);
  return Object.freeze({
    x: finiteNumber(value.x, `${label} x`),
    y: finiteNumber(value.y, `${label} y`),
  });
}

function projectFrameIdentity(value, label) {
  assertRecord(value, label);
  const firstCursor = nonNegativeSafeInteger(value.firstCursor, `${label} firstCursor`);
  const lastCursor = nonNegativeSafeInteger(value.lastCursor, `${label} lastCursor`);
  if (lastCursor < firstCursor) throw new Error(`${label} cursor range is reversed`);
  return Object.freeze({
    runId: nonBlankString(value.runId, `${label} runId`),
    sourceKey: nonBlankString(value.sourceKey, `${label} sourceKey`),
    firstCursor,
    lastCursor,
    revision: nonNegativeSafeInteger(value.revision, `${label} revision`),
  });
}

/** Project one rolling marker window to the exact reposition evidence consumed downstream. */
export function projectRepositionMarkersForHandoff(markers, label = "recent markers") {
  return Object.freeze(markers.flatMap((marker, markerIndex) => {
    const markerLabel = `${label} marker ${markerIndex}`;
    assertRecord(marker, markerLabel);
    if (marker.marker !== "repositioned") return [];
    if (marker.kind !== "actor") throw new Error(`${markerLabel} repositioned kind must be actor`);
    if (typeof marker.actorId !== "string" || marker.actorId.trim() === "") {
      throw new Error(`${markerLabel} repositioned actorId is invalid`);
    }
    const atMs = finiteNonNegativeNumber(marker.atMs, `${markerLabel} repositioned atMs`);
    return [Object.freeze({
      marker: "repositioned",
      kind: "actor",
      actorId: marker.actorId,
      atMs,
    })];
  }));
}

function projectActor(actor, label) {
  assertRecord(actor, label);
  for (const field of [
    "id", "position", "facing", "activeAction", "worldBounds", "screenBounds",
    "screenVisible", "safeFrameVisible",
  ]) {
    if (!(field in actor)) throw new Error(`${label} lacks ${field}`);
  }
  return Object.freeze({
    id: actor.id,
    position: actor.position,
    facing: actor.facing,
    activeAction: actor.activeAction,
    worldBounds: actor.worldBounds,
    screenBounds: actor.screenBounds,
    screenVisible: actor.screenVisible,
    safeFrameVisible: actor.safeFrameVisible,
    ...(actor.instanceId === undefined ? {} : { instanceId: actor.instanceId }),
    ...(actor.opacity === undefined ? {} : { opacity: actor.opacity }),
    ...(actor.reposition === undefined ? {} : { reposition: actor.reposition }),
  });
}

function projectHome(home, label) {
  assertRecord(home, label);
  if (typeof home.id !== "string" || home.id.trim() === "") throw new Error(`${label} id is invalid`);
  const instanceId = positiveSafeInteger(home.instanceId, `${label} instanceId`);
  return Object.freeze({ id: home.id, instanceId });
}

function projectActiveRegion(region, label) {
  if (region === null) return null;
  assertRecord(region, label);
  if (typeof region.id !== "string" || region.id.trim() === "") throw new Error(`${label} id is invalid`);
  return Object.freeze({ id: region.id });
}

function projectEnvironment(environment, label) {
  assertRecord(environment, label);
  assertRecord(environment.diagnostics, `${label} diagnostics`);
  assertRecord(environment.diagnostics.capacities, `${label} capacities`);
  assertRecord(environment.diagnostics.allocatedSlots, `${label} allocatedSlots`);
  return Object.freeze({
    diagnostics: Object.freeze({
      capacities: environment.diagnostics.capacities,
      allocatedSlots: environment.diagnostics.allocatedSlots,
    }),
  });
}

function projectRendererPool(pool, label) {
  assertRecord(pool, label);
  return Object.freeze(Object.fromEntries(POOL_FIELDS.map((field) => [
    field,
    finiteNonNegativeNumber(pool[field], `${label} ${field}`),
  ])));
}

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function finiteNonNegativeNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function finiteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function nonBlankString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a nonblank string`);
  }
  return value;
}

function nonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(normalizeStable(value));
}

function normalizeStable(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("transition evidence contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeStable);
  assertRecord(value, "transition evidence");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalizeStable(value[key])]));
}
