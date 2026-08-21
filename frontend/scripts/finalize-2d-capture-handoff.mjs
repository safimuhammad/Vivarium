#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import { buildProductionStageAnalysis } from "./build-production-stage-analysis.mjs";
import {
  convertProductionCaptureToOracleInput,
  createCanonicalChronicleEvidenceOracle,
} from "./chronicle-evidence-oracles.mjs";
import {
  projectRegionTransitionWitness,
  projectRepositionMarkersForHandoff,
} from "./project-2d-capture-handoff.mjs";
import { canonicalJson, readNormalizedJson } from "./recording-artifacts.mjs";

const DENSITY_CURSORS = Object.freeze([1_024, 2_048, 3_072, 4_096]);

/** Finalize one retained raw capture handoff without replaying or re-encoding media. */
export async function finalizeCaptureHandoff(options) {
  const handoffFile = path.resolve(options.handoffFile);
  const artifactRoot = path.resolve(options.artifactRoot);
  const directory = path.dirname(handoffFile);
  const handoff = await readNormalizedJson(handoffFile);
  validateHandoffIdentity(handoff);
  const catalog = JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data/catalog.json",
  ), "utf8"));
  const entry = catalog.chronicles.find(({ id }) => id === handoff.chronicleId);
  if (entry === undefined) throw new Error(`unknown handoff Chronicle ${handoff.chronicleId}`);
  const manifest = JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data", entry.file,
  ), "utf8"));
  const raw = captureHandoffToOracleInput(handoff, manifest, options.applicationOrigin);
  const requestSummary = assertRequestSummaryBindsNetwork(handoff, raw);
  const analysis = await buildProductionStageAnalysis();
  try {
    const oracle = createCanonicalChronicleEvidenceOracle({
      analysisRoot: analysis.distDir,
      analysisManifestFile: ".vite/manifest.json",
      artifactRoot,
      applicationOrigin: options.applicationOrigin,
      requestSummaries: {
        [`${handoff.chronicleId}/${handoff.viewport}`]: requestSummary,
      },
    });
    await oracle.writeViewportEvidence(directory, raw);
  } finally {
    await analysis.cleanup();
  }
  if (options.deleteOnSuccess === true) await rm(handoffFile, { force: true });
  return { finalized: `${handoff.chronicleId}/${handoff.viewport}` };
}

/** Prove the independently retained browser request summary binds adapter network truth. */
export function assertRequestSummaryBindsNetwork(handoff, raw) {
  const requestSummary = handoff?.observations?.requestSummary;
  if (requestSummary?.observedCount !== raw?.network?.requests?.length
    || requestSummary?.ledgerSha256 !== sha256(canonicalJson(raw.network.requests))) {
    throw new Error("independent request observation summary does not bind the raw network ledger");
  }
  return Object.freeze({
    observedCount: requestSummary.observedCount,
    ledgerSha256: requestSummary.ledgerSha256,
  });
}

/** Pure conversion of retained observations into the canonical oracle adapter input. */
export function captureHandoffToOracleInput(handoff, manifest, applicationOrigin) {
  validateHandoffIdentity(handoff);
  const observed = handoff.observations;
  if (!observed || typeof observed !== "object") throw new Error("capture handoff lacks observed facts");
  if (!("reducedTerminalCameraWitness" in handoff)) {
    throw new Error("capture handoff lacks reducedTerminalCameraWitness");
  }
  for (const field of [
    "semanticTerminalObservation", "terminalCameraWitness", "terminalAuthority", "operationalWorkload",
    "transportWitnesses", "eventWitnesses", "markers", "cadenceWindows",
    "lifecycle", "raster", "viewportMetrics", "navigation",
  ]) {
    if (!(field in observed)) throw new Error(`capture handoff lacks observed ${field}`);
  }
  const disposal = handoff.captureTerminal.rendererDisposals[0];
  if (!disposal?.before || !disposal?.after) throw new Error("renderer disposal handoff is incomplete");
  const artifactDirectory = `${handoff.chronicleId}/${handoff.viewport}`;
  const standardMotion = trustedMotionMode(handoff.standardMotion, "standardMotion");
  const reducedMotion = trustedMotionMode(handoff.reducedMotion, "reducedMotion");
  const facts = {
    chronicleId: handoff.chronicleId,
    viewport: handoff.viewport,
    expectedFinalCursor: manifest.expectedFinalCursor,
    semantic: {
      terminalObservation: observed.semanticTerminalObservation,
      terminalCameraWitness: observed.terminalCameraWitness,
      terminalAuthority: observed.terminalAuthority,
      operationalWorkload: observed.operationalWorkload,
      transportWitnesses: observed.transportWitnesses,
      eventWitnesses: observed.eventWitnesses,
      endpoints: standardMotion.endpoints,
      consequences: standardMotion.consequences,
      markers: observed.markers,
    },
    cursors: {
      samples: handoff.cursorSamples,
      gaps: recoveredCursorGaps(
        handoff.chronicleId,
        manifest,
        observed.eventWitnesses,
        handoff.cursorSamples,
      ),
    },
    motion: motionEvidence(handoff),
    performance: {
      drawSamplesMs: handoff.terminalObservation.renderer.draw.samplesMs,
      longTasksMs: handoff.performanceEvidence.longTasksMs,
      cadenceWindows: observed.cadenceWindows,
      runtimeSamples: runtimeEvidence(handoff.chronicleId, handoff.runtimeObservations),
      schedulerSamples: schedulerEvidence(disposal, handoff.performanceEvidence.schedulerSamples),
      archiveObservations: handoff.performanceEvidence.archiveObservations,
      lifecycle: lifecycleEvidence(disposal, handoff, observed.lifecycle),
    },
    assets: assetEvidence(
      handoff.motionSamples,
      disposal.after,
      handoff.chronicleId,
      observed.raster,
    ),
    reducedMotion: {
      standard: {
        ...standardMotion,
        captureId: `${handoff.chronicleId}:${handoff.viewport}:standard`,
        mode: "standard",
        artifactDirectory,
        terminalCameraWitness: observed.terminalCameraWitness,
      },
      reduced: {
        ...reducedMotion,
        captureId: `${handoff.chronicleId}:${handoff.viewport}:reduced`,
        mode: "reduced",
        artifactDirectory,
        terminalCameraWitness: handoff.reducedTerminalCameraWitness,
      },
    },
    viewportMetrics: {
      width: observed.viewportMetrics.width,
      height: observed.viewportMetrics.height,
      devicePixelRatio: observed.viewportMetrics.devicePixelRatio,
    },
  };
  return convertProductionCaptureToOracleInput({
    ...facts,
    applicationOrigin,
    navigation: observed.navigation,
    requests: handoff.requests,
  });
}

const MOTION_MODE_FIELDS = Object.freeze([
  "endpoints", "consequences", "markerOrder", "labels", "readingHoldsMs",
]);

function trustedMotionMode(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`capture handoff ${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((field) => !MOTION_MODE_FIELDS.includes(field));
  if (unknown.length > 0) {
    throw new Error(`capture handoff ${label} contains unknown field ${unknown.sort()[0]}`);
  }
  for (const field of MOTION_MODE_FIELDS) {
    if (!Array.isArray(value[field])) {
      throw new Error(`capture handoff ${label} ${field} must be an array`);
    }
  }
  return Object.freeze({
    endpoints: value.endpoints,
    consequences: value.consequences,
    markerOrder: value.markerOrder,
    labels: value.labels,
    readingHoldsMs: value.readingHoldsMs,
  });
}

function validateHandoffIdentity(handoff) {
  if (handoff?.schemaVersion !== 1) {
    throw new Error("capture handoff schemaVersion must be exactly 1");
  }
  if (typeof handoff.chronicleId !== "string" || !/^C(?:0[0-9]|1[0-7])$/.test(handoff.chronicleId)) {
    throw new Error("capture handoff chronicleId must be C00-C17");
  }
  if (handoff.viewport !== "desktop" && handoff.viewport !== "mobile") {
    throw new Error("capture handoff viewport must be desktop or mobile");
  }
}

function motionEvidence(handoff) {
  return {
    frames: handoff.motionSamples.map(({ frameIndex, cursor, activeEffects, placementHash }) => ({
      frameIndex, cursor, activeEffects, placementHash,
    })),
    trajectorySamples: handoff.motionSamples.map(({
      frameIndex,
      cursor,
      activeRegion,
      focusSelectionKey,
      camera,
      actors,
      recentMarkers,
      pathFallbacks,
    }) => ({
      frameIndex,
      cursor,
      regionId: activeRegion?.id ?? null,
      focusSelectionKey,
      camera,
      ...(recentMarkers === undefined ? {} : {
        recentMarkers: projectRepositionMarkersForHandoff(
          recentMarkers,
          `motion sample ${frameIndex}`,
        ),
      }),
      ...(pathFallbacks === undefined ? {} : { pathFallbacks }),
      actors: actors.map(({
        id,
        instanceId,
        position,
        facing,
        activeAction,
        opacity,
        reposition,
        worldBounds,
        screenBounds,
        screenVisible,
        safeFrameVisible,
      }) => ({
        id,
        position,
        facing,
        activeAction,
        worldBounds,
        screenBounds,
        screenVisible,
        safeFrameVisible,
        ...(instanceId === undefined ? {} : { instanceId }),
        ...(opacity === undefined ? {} : { opacity }),
        ...(reposition === undefined ? {} : { reposition }),
      })),
    })),
    regionTransitionWitnesses: regionTransitionEvidence(handoff.motionSamples),
    markerFrames: Object.fromEntries(handoff.markerFrames ?? []),
    checkpointWitnesses: handoff.checkpointWitnesses,
    placementCheckpoints: handoff.chronicleId === "C16"
      ? DENSITY_CURSORS.map((cursor) => {
          const sample = uniqueEpochReadySample(
            handoff.motionSamples,
            "cursor",
            cursor,
            "placement",
          );
          return { cursor, placements: sample.placements };
        })
      : [],
    homeOwnershipSegments: homeOwnershipSegments(handoff.motionSamples),
  };
}

function homeOwnershipSegments(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error("home ownership samples must be nonempty");
  }
  const segments = [];
  let priorFrameIndex = null;
  let priorSignature = null;
  for (const [sampleIndex, sample] of samples.entries()) {
    const frameIndex = sample?.frameIndex;
    if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) {
      throw new Error(`home ownership sample ${sampleIndex} frameIndex is invalid`);
    }
    if ((priorFrameIndex === null && frameIndex !== 0)
      || (priorFrameIndex !== null && frameIndex !== priorFrameIndex + 1)) {
      throw new Error("home ownership samples must cover consecutive frames from zero");
    }
    priorFrameIndex = frameIndex;
    const regionId = sample.activeRegion?.id ?? null;
    if (regionId !== null && (typeof regionId !== "string" || regionId.trim() === "")) {
      throw new Error(`home ownership sample ${sampleIndex} region is invalid`);
    }
    if (!Array.isArray(sample.homes)) {
      throw new Error(`home ownership sample ${sampleIndex} homes must be an array`);
    }
    const homes = sample.homes.map((home, homeIndex) => {
      const id = home?.id;
      const instanceId = home?.instanceId;
      if (typeof id !== "string" || id.trim() === "") {
        throw new Error(`home ownership sample ${sampleIndex} home ${homeIndex} id is invalid`);
      }
      if (!Number.isSafeInteger(instanceId) || instanceId <= 0) {
        throw new Error(
          `home ownership sample ${sampleIndex} home ${id} instanceId is invalid`,
        );
      }
      return { id, instanceId };
    }).sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : left.instanceId - right.instanceId
    ));
    if (new Set(homes.map(({ id }) => id)).size !== homes.length
      || new Set(homes.map(({ instanceId }) => instanceId)).size !== homes.length) {
      throw new Error(`home ownership sample ${sampleIndex} contains duplicate homes or instances`);
    }
    const signature = canonicalJson({ regionId, homes });
    const prior = segments.at(-1);
    if (signature === priorSignature) {
      prior.lastFrameIndex = frameIndex;
    } else {
      segments.push({ firstFrameIndex: frameIndex, lastFrameIndex: frameIndex, regionId, homes });
      priorSignature = signature;
    }
  }
  return segments;
}

function regionTransitionEvidence(samples) {
  const observed = new Map();
  for (const [sampleIndex, sample] of samples.entries()) {
    for (const [transitionIndex, transition] of (sample.regionTransitions ?? []).entries()) {
      const projected = projectRegionTransitionWitness(
        transition,
        `motion sample ${sampleIndex} transition ${transitionIndex}`,
      );
      const canonicalTransition = canonicalJson(projected);
      const repeated = observed.get(projected.commandId);
      if (repeated !== undefined) {
        if (repeated.canonicalTransition !== canonicalTransition) {
          throw new Error(
            `transition command ${String(projected.commandId)} has contradictory repeated observations`,
          );
        }
        continue;
      }
      observed.set(projected.commandId, {
        canonicalTransition,
        evidence: {
          actorId: projected.actorId,
          reason: projected.reason,
          position: { x: projected.position.x, y: projected.position.y },
          actorPosition: { x: projected.actorPosition.x, y: projected.actorPosition.y },
          gate: {
            role: projected.gate.role,
            tile: {
              column: projected.gate.tile.column,
              row: projected.gate.tile.row,
            },
            tileSize: projected.gate.tileSize,
            point: { x: projected.gate.point.x, y: projected.gate.point.y },
          },
          fromRegion: projected.fromRegion,
          toRegion: projected.toRegion,
          sceneToken: projected.sceneToken,
          commandId: projected.commandId,
          atMs: projected.atMs,
          frameIdentity: {
            runId: projected.frameIdentity.runId,
            sourceKey: projected.frameIdentity.sourceKey,
            firstCursor: projected.frameIdentity.firstCursor,
            lastCursor: projected.frameIdentity.lastCursor,
            revision: projected.frameIdentity.revision,
          },
          observedFrameIndex: sample.frameIndex,
          observedPresentationTimeMs: sample.presentationTimeMs,
        },
      });
    }
  }
  return [...observed.values()].map(({ evidence }) => evidence);
}

function schedulerEvidence(disposal, samples) {
  if (!Array.isArray(samples)) throw new Error("capture handoff scheduler samples are incomplete");
  const visible = samples.find((sample) => (
    sample?.mode === "visible" && sample?.routeId === "standard"
  ));
  if (visible === undefined) throw new Error("capture handoff lacks the standard scheduler owner");
  const scheduler = disposal.after.scheduler;
  const draw = disposal.after.draw;
  if (!scheduler || !draw) throw new Error("renderer disposal lacks scheduler evidence");
  const observedAtMs = Math.max(...samples.map((sample) => Number(sample.observedAtMs))) + 1;
  return [
    ...samples,
    {
      mode: "disposed",
      phase: "disposed",
      routeId: "standard",
      ownerId: visible.ownerId,
      dirty: Boolean(scheduler.dirty),
      rafScheduled: Boolean(scheduler.rafScheduled),
      wakeScheduled: Boolean(scheduler.wakeScheduled),
      nextDeadlineMs: scheduler.nextDeadlineMs === null
        ? null
        : Number(scheduler.nextDeadlineMs),
      observedAtMs,
      drawTotal: Number(draw.totalCount),
      reason: null,
      workload: "disposed",
    },
  ];
}

function runtimeSample(value) {
  const session = value.observation.observer.session;
  return {
    frameIndex: value.frameIndex,
    authoritativeCursor: value.authoritativeCursor,
    ingressAccepted: Math.max(0, value.authoritativeCursor - value.observation.ingestedCursor),
    directorPending: value.observation.pendingMoments,
    chroniclePrevious: session.chronicle.previous,
    chronicleUpcoming: session.chronicle.upcoming,
    retainedSafeCheckpoints: session.checkpoint.retainedSafeCheckpoints,
    activeSceneCount: value.observation.activeSceneCount,
    liveSessions: value.observation.observer.liveSessions,
    archiveSessions: value.observation.observer.archiveSessions,
    stageCount: value.observation.observer.stageCount,
    canvasCount: 1,
    phase: value.phase,
    stageId: value.observation.stageId,
    canvasId: value.observation.canvasId,
    epochReady: value.epochReady === true,
    workload: value.workload ?? null,
  };
}

function runtimeEvidence(chronicleId, observations) {
  if (chronicleId !== "C16") return observations.map(runtimeSample);
  return DENSITY_CURSORS.map((cursor) => {
    if (cursor === 1_024) {
      const matches = observations.filter((sample) => sample.authoritativeCursor === cursor
        && sample.phase === "active" && sample.observation.activeSceneCount === 1);
      if (matches.length !== 1) throw new Error("C16 runtime active witness must be unique at cursor 1024");
      return runtimeSample(matches[0]);
    }
    return runtimeSample(uniqueEpochReadySample(
      observations,
      "authoritativeCursor",
      cursor,
      "runtime",
    ));
  });
}

function lifecycleEvidence(disposal, handoff, observed) {
  const after = disposal.after;
  const counter = (value) => ({ ...value, live: value.outstanding });
  return {
    visibleRegionId: disposal.before.graph?.activeRegion?.id ?? null,
    stage: observed.stage,
    canvas: observed.canvas,
    graph: observed.graph,
    graphActors: counter(after.graph.ownership.actors),
    graphHomes: counter(after.graph.ownership.homes),
    graphEnvironments: counter(after.graph.ownership.environments),
    cache: {
      ...counter(after.cache),
      rebuildReasons: observed.cacheRebuildReasons.map((reason) => (
        reason === "initial" ? "map" : reason === "region" ? "region-identity" : reason
      )),
    },
    atlas: {
      decodeStarts: after.pool.lifecycle.decodeStarts,
      bitmapsClosed: after.pool.closeCount,
      acquireCalls: after.pool.lifecycle.acquireCalls + after.pool.lifecycle.retainCalls,
      releaseCalls: after.pool.lifecycle.leasesReleased,
      leasesCreated: after.pool.lifecycle.leasesCreated,
      leasesReleased: after.pool.lifecycle.leasesReleased,
    },
    react: observed.react,
    heap: handoff.performanceEvidence.heap,
  };
}

function assetEvidence(samples, settled, chronicleId, raster) {
  const selected = chronicleId === "C16"
    ? DENSITY_CURSORS.map((cursor) => uniqueEpochReadySample(
        samples,
        "cursor",
        cursor,
        "asset",
      ))
    : [samples.find((sample) => sample.rendererPool.decodedBytes > 0
      && sample.rendererPool.leases > 0) ?? samples.at(-1)];
  if (selected.some((sample) => !sample)) throw new Error("asset pressure handoff is incomplete");
  const phases = selected.map((sample) => chronicleId === "C16" ? `pressure-${sample.cursor}` : "active");
  const environmentSamples = selected.map((sample, index) => environmentSample(phases[index], sample));
  const poolSamples = selected.map((sample, index) => poolSample(phases[index], sample));
  poolSamples.push({ phase: "settled", capacity: settled.pool.activeCompressedMax, allocated: 0, inFlightCount: 0, waiterCount: 0 });
  const atlasSamples = selected.map((sample, index) => ({
    phase: phases[index], decodedBytes: sample.rendererPool.decodedBytes,
    leases: sample.rendererPool.leases, waiterCount: sample.rendererPool.waiterCount,
    inFlightCount: sample.rendererPool.inFlightCount,
  }));
  atlasSamples.push({ phase: "settled", decodedBytes: 0, leases: 0, waiterCount: 0, inFlightCount: 0 });
  return { raster, environmentSamples, poolSamples, atlasSamples };
}

function uniqueEpochReadySample(samples, cursorField, cursor, label) {
  const matches = samples.filter((sample) => (
    sample?.[cursorField] === cursor && sample.epochReady === true
  ));
  if (matches.length !== 1) {
    throw new Error(`C16 ${label} epoch-ready witness ${cursor} must be unique`);
  }
  return matches[0];
}

function environmentSample(phase, sample) {
  const diagnostics = sample.environments.map(({ diagnostics: value }) => value);
  return {
    phase,
    capacity: diagnostics.reduce((total, value) => total + sumValues(value.capacities), 0),
    allocated: diagnostics.reduce((total, value) => total + sumValues(value.allocatedSlots), 0),
    activeEffects: sample.activeEffects,
  };
}

function poolSample(phase, sample) {
  return {
    phase, capacity: sample.rendererPool.activeCompressedMax,
    allocated: sample.rendererPool.expectedActiveCompressedBytes,
    inFlightCount: sample.rendererPool.inFlightCount,
    waiterCount: sample.rendererPool.waiterCount,
  };
}

function recoveredCursorGaps(chronicleId, manifest, eventWitnesses, samples) {
  if (!Array.isArray(samples)) throw new Error(`${chronicleId} cursor samples are incomplete`);
  const ranges = missingTrustedCursorRanges(chronicleId, manifest, eventWitnesses);
  return ranges.map((range) => {
    const visible = samples.find((sample) => (
      sample.authoritativeCursor === range.toCursor
      && sample.acceptedCursor === range.fromCursor - 1
      && sample.presentedCursor < range.fromCursor
      && ["paused", "recovering"].includes(sample.phase)
    ));
    if (visible === undefined) {
      throw new Error(
        `${chronicleId} gap ${range.fromCursor}-${range.toCursor} lacks an exact visible witness`,
      );
    }
    const recovered = samples.find((sample) => (
      sample.frameIndex > visible.frameIndex
      && sample.authoritativeCursor === range.toCursor
      && sample.acceptedCursor === range.toCursor
      && sample.presentedCursor === range.toCursor
      && sample.publicCursor === range.toCursor
      && !["paused", "recovering"].includes(sample.phase)
      && (chronicleId !== "C16" || sample.epochReady === true)
    ));
    if (recovered === undefined) {
      throw new Error(
        `${chronicleId} gap ${range.fromCursor}-${range.toCursor} lacks an exact recovered epoch witness`,
      );
    }
    return {
      ...range,
      detectedFrameIndex: visible.frameIndex,
      visibleFrameIndex: visible.frameIndex,
      recoveredFrameIndex: recovered.frameIndex,
      resumedFrameIndex: recovered.frameIndex,
    };
  });
}

function missingTrustedCursorRanges(chronicleId, manifest, eventWitnesses) {
  if (!Array.isArray(manifest?.entries)) {
    throw new Error(`${chronicleId} trusted manifest cursor entries are unavailable`);
  }
  if (!Array.isArray(eventWitnesses)) {
    throw new Error(`${chronicleId} accepted SSE envelope witnesses are unavailable`);
  }
  const trustedCursors = [...new Set(manifest.entries.map((entry) => {
    const cursor = entry?.cursor;
    if (!Number.isSafeInteger(cursor) || cursor < 1) {
      throw new Error(`${chronicleId} trusted manifest contains an invalid cursor`);
    }
    return cursor;
  }))].sort((left, right) => left - right);
  const acceptedCursors = new Set(eventWitnesses.flatMap((witness) => {
    if (witness?.kind !== "envelope" || witness.disposition !== "accepted") return [];
    if (!Number.isSafeInteger(witness.cursor) || witness.cursor < 1) {
      throw new Error(`${chronicleId} accepted SSE envelope contains an invalid cursor`);
    }
    if (witness.envelope?.next_cursor !== witness.cursor) {
      throw new Error(`${chronicleId} accepted SSE envelope cursor does not match raw payload`);
    }
    return [witness.cursor];
  }));
  const missing = trustedCursors.filter((cursor) => !acceptedCursors.has(cursor));
  const ranges = [];
  for (const cursor of missing) {
    const previous = ranges.at(-1);
    if (previous !== undefined && cursor === previous.toCursor + 1) {
      previous.toCursor = cursor;
    } else {
      ranges.push({ fromCursor: cursor, toCursor: cursor });
    }
  }
  return ranges;
}

function sumValues(value) {
  return Object.values(value).reduce((total, count) => total + count, 0);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main(argv) {
  const value = (flag) => argv[argv.indexOf(flag) + 1];
  const handoffFile = value("--handoff");
  const artifactRoot = value("--artifact-root");
  const applicationOrigin = value("--application-origin");
  if (!handoffFile || !artifactRoot || !applicationOrigin) {
    throw new Error("usage: finalize-2d-capture-handoff.mjs --handoff <file> --artifact-root <root> --application-origin <origin> [--delete-on-success]");
  }
  process.stdout.write(`${JSON.stringify(await finalizeCaptureHandoff({
    handoffFile, artifactRoot, applicationOrigin,
    deleteOnSuccess: argv.includes("--delete-on-success"),
  }))}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
