#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createC02CaptureLedgers } from "./c02-handoff-roundtrip-fixture.mjs";
import {
  assertRequestSummaryBindsNetwork,
  captureHandoffToOracleInput,
} from "./finalize-2d-capture-handoff.mjs";
import { projectMotionSamplesForHandoff } from "./project-2d-capture-handoff.mjs";
import {
  canonicalJson,
  readNormalizedJson,
  writeNormalizedJson,
} from "./recording-artifacts.mjs";

/** Return a compact canonical digest of every adapter-derived C02-sized motion fact. */
export function canonicalAdapterSummary(handoff, manifest, applicationOrigin) {
  const oracle = captureHandoffToOracleInput(handoff, manifest, applicationOrigin);
  const requestSummary = assertRequestSummaryBindsNetwork(handoff, oracle);
  const evidence = Object.freeze({
    frames: oracle.motion.frames,
    trajectorySamples: oracle.motion.trajectorySamples,
    regionTransitionWitnesses: oracle.motion.regionTransitionWitnesses,
    homeOwnershipSegments: oracle.motion.homeOwnershipSegments,
    requestSummary,
    networkRequestCount: oracle.network.requests.length,
    networkLedgerSha256: createHash("sha256")
      .update(canonicalJson(oracle.network.requests))
      .digest("hex"),
    environmentSamples: oracle.assets.environmentSamples,
    poolSamples: oracle.assets.poolSamples,
    atlasSamples: oracle.assets.atlasSamples,
  });
  return Object.freeze({
    sha256: createHash("sha256").update(canonicalJson(oracle)).digest("hex"),
    evidenceSha256: createHash("sha256").update(canonicalJson(evidence)).digest("hex"),
    frameCount: oracle.motion.frames.length,
    trajectoryCount: oracle.motion.trajectorySamples.length,
    firstFrame: oracle.motion.frames[0],
    lastFrame: oracle.motion.frames.at(-1),
    regionTransitionWitnesses: oracle.motion.regionTransitionWitnesses,
    homeOwnershipSegments: oracle.motion.homeOwnershipSegments,
    requestSummary,
    networkRequestCount: oracle.network.requests.length,
    networkLedgerSha256: createHash("sha256")
      .update(canonicalJson(oracle.network.requests))
      .digest("hex"),
  });
}

async function main() {
  const [mode, inputFile, manifestFile, applicationOrigin, outputFile] = process.argv.slice(2);
  if (!mode || !inputFile || !manifestFile || !applicationOrigin) {
    throw new Error(
      "usage: c02-handoff-roundtrip-worker MODE INPUT MANIFEST ORIGIN [OUTPUT]",
    );
  }
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (mode === "legacy") {
    const handoff = await readNormalizedJson(inputFile);
    const ledgers = createC02CaptureLedgers(manifest);
    handoff.cursorSamples = ledgers.cursorSamples;
    handoff.motionSamples = ledgers.motionSamples;
    process.stdout.write(JSON.stringify({
      ...canonicalAdapterSummary(handoff, manifest, applicationOrigin),
      transitionFirstFrames: ledgers.transitionFirstFrames,
    }));
    return;
  }
  if (mode === "project") {
    if (!outputFile) throw new Error("project mode requires an output file");
    const handoff = await readNormalizedJson(inputFile);
    let ledgers = createC02CaptureLedgers(manifest);
    handoff.cursorSamples = ledgers.cursorSamples;
    handoff.motionSamples = projectMotionSamplesForHandoff(ledgers.motionSamples);
    const transitionFirstFrames = ledgers.transitionFirstFrames;
    ledgers = null;
    globalThis.gc?.();
    await writeNormalizedJson(outputFile, handoff);
    process.stdout.write(JSON.stringify({ transitionFirstFrames }));
    return;
  }
  if (mode !== "read") throw new Error(`unknown worker mode ${mode}`);
  const handoff = await readNormalizedJson(inputFile);
  globalThis.gc?.();
  const transitions = handoff.motionSamples.flatMap(({ regionTransitions }) => regionTransitions);
  const summary = canonicalAdapterSummary(handoff, manifest, applicationOrigin);
  process.stdout.write(JSON.stringify({
    ...summary,
    handoff: {
      schemaVersion: handoff.schemaVersion,
      chronicleId: handoff.chronicleId,
      viewport: handoff.viewport,
      cursorSampleCount: handoff.cursorSamples.length,
      motionSampleCount: handoff.motionSamples.length,
      firstFrameIndex: handoff.motionSamples[0].frameIndex,
      lastFrameIndex: handoff.motionSamples.at(-1).frameIndex,
      transitionCount: transitions.length,
      transitionCommandCount: new Set(transitions.map(({ commandId }) => commandId)).size,
      actorCount: handoff.motionSamples[0].actors.length,
      homeCount: handoff.motionSamples[0].homes.length,
      environmentCount: handoff.motionSamples[0].environments.length,
      placementCount: Object.keys(handoff.motionSamples[0].placements).length,
      containsRendererSentinel: handoff.motionSamples.some((sample) => (
        "unusedRendererGraph" in sample
        || sample.actors.some((actor) => "unusedRig" in actor)
        || sample.regionTransitions.some((transition) => "rendererDiagnostic" in transition)
      )),
      runtimeRequestCount: handoff.requests.runtimeRequests.length,
      runtimeRequestsSha256: createHash("sha256")
        .update(canonicalJson(handoff.requests.runtimeRequests))
        .digest("hex"),
      requestSummary: handoff.observations.requestSummary,
    },
  }));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
