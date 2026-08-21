import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import {
  CHRONICLE_IDS,
  EVIDENCE_CHRONICLE_IDS,
  EVIDENCE_SIDECAR_FILES,
  PRODUCTION_ACTOR_VISUAL_ENVELOPE,
  buildCursorEvidence,
  createCanonicalChronicleEvidenceOracle,
  createChronicleEvidenceOracle,
  convertProductionCaptureToOracleInput,
  trustedTerminalAuthority,
  validateEventlessOperationalAuthority,
} from "./chronicle-evidence-oracles.mjs";
import { canonicalJson, sha256Buffer, sha256File } from "./recording-artifacts.mjs";
import { buildProductionStageAnalysis } from "./build-production-stage-analysis.mjs";
import { encodeFrameSequence } from "./record-2d-chronicles.mjs";

// Full canonical catalog identity (independent literal, guards CHRONICLE_IDS against drift).
const CATALOG_IDS = Object.freeze([
  "C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08",
  "C09", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17",
  "C18", "C19",
]);
// Chronicles with fully captured evidence (independent literal, guards EVIDENCE_CHRONICLE_IDS
// against drift). C18/C19 are cataloged (see CATALOG_IDS) but have no captured evidence yet.
const LITERAL_IDS = Object.freeze([
  "C00", "C01", "C02", "C03", "C04", "C05", "C06", "C07", "C08",
  "C09", "C10", "C11", "C12", "C13", "C14", "C15", "C16", "C17",
]);
const SPECIAL_CURSORS = Object.freeze({
  C00: 0, C06: 5, C13: 120, C14: 0, C15: 0, C16: 4096,
});
const SEMANTIC_ORACLE = Object.freeze({
  negative: Object.freeze(["no-fabrication"]),
  positive: Object.freeze(["world-visible"]),
  terminal: Object.freeze(["settled"]),
});
const C01_MARKERS = Object.freeze([
  "event:agent_entered_region",
  "event:agent_left_region",
  "checkpoint:final",
]);
const C01_SEMANTIC_ORACLE = Object.freeze({
  negative: Object.freeze(["no-forbidden-edge", "no-teleport"]),
  positive: Object.freeze(["local-movement"]),
  terminal: Object.freeze(["final-checkpoint-aligned", "run-identity-preserved"]),
});
const C13_ACCEPTED_RANGES = Object.freeze([[1, 50]]);
const C16_ACCEPTED_RANGES = Object.freeze([
  [1, 50],
  [1_025, 1_074],
  [2_049, 2_098],
  [3_073, 3_122],
]);
const C09_HOME_VISIBILITY_SEGMENTS = Object.freeze([
  Object.freeze({ regionId: "nirvana", homeIds: Object.freeze(["home_c09", "home_zero"]) }),
  Object.freeze({ regionId: "warm_springs", homeIds: Object.freeze(["home_repair"]) }),
  Object.freeze({ regionId: "nirvana", homeIds: Object.freeze(["home_c09", "home_zero"]) }),
  Object.freeze({ regionId: "warm_springs", homeIds: Object.freeze(["home_repair"]) }),
  Object.freeze({ regionId: "nirvana", homeIds: Object.freeze(["home_c09", "home_zero"]) }),
  Object.freeze({ regionId: "warm_springs", homeIds: Object.freeze(["home_repair"]) }),
  Object.freeze({ regionId: "nirvana", homeIds: Object.freeze([]) }),
]);
const C09_HOME_VISIBILITY_FRAME_RANGES = Object.freeze([
  Object.freeze([0, 20]),
  Object.freeze([21, 40]),
  Object.freeze([41, 60]),
  Object.freeze([61, 80]),
  Object.freeze([81, 100]),
  Object.freeze([101, 120]),
  Object.freeze([121, 150]),
]);
const GRAPH_LIFECYCLE_ORACLES = Object.freeze({
  C05: Object.freeze({ schema: 1, actors: Object.freeze({ created: 4, peak: 4 }) }),
  C09: Object.freeze({
    schema: 1,
    homes: Object.freeze({
      created: 9,
      peak: 3,
      visibilitySegments: C09_HOME_VISIBILITY_SEGMENTS,
    }),
  }),
  C11: Object.freeze({ schema: 1, actors: Object.freeze({ created: 4, peak: 4 }) }),
  C12: Object.freeze({ schema: 1, homes: Object.freeze({ created: 1, peak: 1 }) }),
});
const CHECKPOINT_HOLD_DURATION_MS = 800;
const CHECKPOINT_SAMPLE_INTERVAL_MS = 1_000 / 30;
const EXPECTED_PRODUCTION_ACTOR_VISUAL_ENVELOPE = Object.freeze({
  left: -37,
  top: -62,
  width: 67,
  height: 72,
});
const CHECKPOINT_FOCUS_TARGETS = Object.freeze({
  C06: Object.freeze({
    1: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_b86b89df", removed: false,
      }),
    ]),
    2: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_b86b89df", removed: false,
      }),
    ]),
  }),
  C07: Object.freeze({
    1: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_c07", removed: false,
      }),
    ]),
    2: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_c07", removed: false,
      }),
    ]),
    3: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "region", entityId: null, removed: false,
      }),
    ]),
  }),
  C09: Object.freeze({
    1: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_repair", removed: false,
      }),
      Object.freeze({
        regionId: "nirvana", kind: "ruin", entityId: "home_c09", removed: false,
      }),
      Object.freeze({
        regionId: "nirvana", kind: "ruin", entityId: "home_zero", removed: false,
      }),
    ]),
    2: Object.freeze([
      Object.freeze({
        regionId: "warm_springs", kind: "home", entityId: "home_repair", removed: false,
      }),
      Object.freeze({
        regionId: "nirvana", kind: "region", entityId: null, removed: true,
      }),
    ]),
  }),
});
const CHECKPOINT_CORRECTION_IDS = Object.freeze({
  C06: Object.freeze({
    1: Object.freeze(["home_b86b89df", "wanderer_001"]),
    2: Object.freeze(["home_b86b89df", "wanderer_001"]),
  }),
  C07: Object.freeze({
    1: Object.freeze(["home_c07", "wanderer_002"]),
    2: Object.freeze([
      "home_c07", "nirvana", "nirvana_east", "nirvana_west",
      "wanderer_001", "warm_springs",
    ]),
    3: Object.freeze(["wanderer_002", "wanderer_004"]),
  }),
  C09: Object.freeze({
    1: Object.freeze([
      "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
      "nirvana_west", "wanderer_001", "warm_springs",
    ]),
    2: Object.freeze([
      "home_c09", "home_repair", "home_zero", "nirvana", "nirvana_east",
      "nirvana_west", "wanderer_001", "warm_springs",
    ]),
  }),
});

function syntheticCheckpointRecords(id, agents, homes) {
  const records = id === "C06"
    ? [
        { line: 1, eventCursor: 3, worldTime: 6_000 },
        { line: 2, eventCursor: 3, worldTime: 6_000 },
        { line: 3, eventCursor: 5, worldTime: 6_000 },
      ]
    : id === "C07"
    ? [
        { line: 1, eventCursor: 2, worldTime: 7_000 },
        { line: 2, eventCursor: 2, worldTime: 7_001 },
        { line: 3, eventCursor: 4, worldTime: 7_001 },
      ]
    : id === "C09"
      ? [{ line: 1, eventCursor: 2, worldTime: 9_001 }, { line: 2, eventCursor: 4, worldTime: 9_122 }]
      : [];
  const runId = `${id.toLowerCase()}-run`;
  return records.map(({ line, eventCursor, worldTime }) => {
    const checkpointHomes = id === "C06"
      ? [syntheticCheckpointHome(
          "home_b86b89df",
          "warm_springs",
          "standing",
          100,
          0,
        )]
      : id === "C07"
      ? [syntheticCheckpointHome(
          "home_c07",
          "warm_springs",
          "standing",
          line === 1 ? 25 : line === 2 ? 35 : 0,
          0,
        )]
      : id === "C09"
        ? [syntheticCheckpointHome("home_repair", "warm_springs", "standing", line === 1 ? 60 : 100, 0)]
        : structuredClone(homes);
    const checkpointRuins = id === "C09" && line === 1
      ? [
          syntheticCheckpointHome("home_c09", "nirvana", "ruin", 0, 60),
          syntheticCheckpointHome("home_zero", "nirvana", "ruin", 0, 40),
        ]
      : [];
    const snapshot = {
      agents: agents.map((agent) => ({ ...agent, checkpoint_line: line })),
      event_cursor: eventCursor,
      homes: checkpointHomes,
      pending_proposals: [],
      regions: id === "C07" ? [{ name: "warm_springs" }]
        : id === "C09" ? [{ name: "nirvana" }, { name: "warm_springs" }] : [],
      ruins: checkpointRuins,
      run_id: runId,
      schema: 1,
      world_time: worldTime,
    };
    return {
      line,
      checkpoint: {
        event_cursor: eventCursor,
        reason: "world_tick",
        run_id: runId,
        schema: 1,
        snapshot,
        type: "world_snapshot_checkpoint",
        world_time: worldTime,
      },
    };
  });
}

function syntheticCheckpointHome(homeId, region, status, integrity, remnantMaterials) {
  return {
    home_id: homeId,
    region,
    status,
    integrity,
    max_integrity: 100,
    remnant_materials: remnantMaterials,
  };
}

function syntheticRenderedCheckpointHomes(snapshot, activeRegionId, line, viewport) {
  const camera = {
    zoom: 1,
    rasterOrigin: { x: 0, y: 0 },
  };
  return [
    ...snapshot.homes.map((home) => ({ home, kind: "home" })),
    ...snapshot.ruins.map((home) => ({ home, kind: "ruin" })),
  ].filter(({ home }) => home.region === activeRegionId)
    .sort((left, right) => left.home.home_id.localeCompare(right.home.home_id))
    .map(({ home, kind }, index) => {
      const plot = { x: 96 + index * 80, y: 128 };
      const worldBounds = { x: plot.x, y: plot.y, width: 64, height: 64 };
      const screenBounds = {
        x: worldBounds.x * camera.zoom + camera.rasterOrigin.x,
        y: worldBounds.y * camera.zoom + camera.rasterOrigin.y,
        width: worldBounds.width * camera.zoom,
        height: worldBounds.height * camera.zoom,
      };
      return {
        id: home.home_id,
        instanceId: line * 10 + index + 1,
        kind,
        status: home.status,
        plot,
        durable: {
          status: home.status,
          integrityRatio: home.integrity / home.max_integrity,
          remnantMaterials: home.remnant_materials,
        },
        diagnostics: {
          rawIntegrity: home.integrity,
          rawMaxIntegrity: home.max_integrity,
          integrityClamped: false,
        },
        geometry: {
          logicalBounds: { width: worldBounds.width, height: worldBounds.height },
          worldBounds,
        },
        visual: kind === "ruin"
          ? { backComponents: [], frontComponents: [], ruinFrameId: "ruin-frame-1" }
          : { backComponents: ["foundation"], frontComponents: ["door"], ruinFrameId: null },
        screenBounds,
        screenVisible: screenBounds.x < viewport.width
          && screenBounds.x + screenBounds.width > 0
          && screenBounds.y < viewport.height
          && screenBounds.y + screenBounds.height > 0,
        safeFrameVisible: true,
      };
    });
}

function syntheticCheckpointWitnesses(id, agents, homes, viewportName = "desktop") {
  const firstElapsedMs = 14;
  const frames = id === "C06" ? [[10, 33], [35, 58]]
    : id === "C07" ? [[10, 33], [35, 58], [90, 113]]
    : id === "C09" ? [[10, 81], [100, 147]] : [];
  return syntheticCheckpointRecords(id, agents, homes)
    .filter((record) => CHECKPOINT_FOCUS_TARGETS[id]?.[record.line] !== undefined)
    .map((record, index) => {
    const firstFrameIndex = frames[index][0];
    const lastFrameIndex = frames[index][1];
    const checkpoint = record.checkpoint;
    const firstCursor = Math.max(0, checkpoint.event_cursor - 1);
    const focusTargets = CHECKPOINT_FOCUS_TARGETS[id][record.line];
    const durationMs = focusTargets.length * CHECKPOINT_HOLD_DURATION_MS;
    const viewport = viewportName === "desktop"
      ? { width: 1_440, height: 900 }
      : { width: 390, height: 844 };
    const camera = { zoom: 1, rasterOrigin: { x: 0, y: 0 } };
    const safeFrame = {
      x: 48,
      y: 48,
      width: viewport.width - 96,
      height: viewport.height - 96,
    };
    const samples = focusTargets.flatMap((target, segmentIndex) => {
      const renderedHomes = syntheticRenderedCheckpointHomes(
        checkpoint.snapshot,
        target.regionId,
        record.line,
        viewport,
      );
      return Array.from({ length: 24 }, (_, segmentSampleIndex) => {
        const sampleIndex = segmentIndex * 24 + segmentSampleIndex;
        const frameIndex = firstFrameIndex + sampleIndex;
        const elapsedMs = firstElapsedMs + sampleIndex * CHECKPOINT_SAMPLE_INTERVAL_MS;
        const segmentElapsedMs = firstElapsedMs
          + segmentSampleIndex * CHECKPOINT_SAMPLE_INTERVAL_MS;
        return {
          frameIndex,
          presentationTimeMs: frameIndex * CHECKPOINT_SAMPLE_INTERVAL_MS,
          elapsedMs,
          remainingMs: durationMs - elapsedMs,
          presentedCursor: checkpoint.event_cursor,
          frameIdentity: {
            runId: checkpoint.run_id,
            sourceKey: `live:${checkpoint.run_id}`,
            firstCursor,
            lastCursor: checkpoint.event_cursor,
            revision: record.line * 10 + segmentIndex,
          },
          publicationSerial: record.line * 100 + segmentIndex,
          activeRegionId: target.regionId,
          focusTarget: {
            ...target,
            segmentIndex,
            segmentCount: focusTargets.length,
            segmentDurationMs: CHECKPOINT_HOLD_DURATION_MS,
            segmentElapsedMs,
            segmentRemainingMs: CHECKPOINT_HOLD_DURATION_MS - segmentElapsedMs,
          },
          viewport: structuredClone(viewport),
          camera: structuredClone(camera),
          safeFrame: structuredClone(safeFrame),
          homes: structuredClone(renderedHomes),
        };
      });
    });
    return {
      line: record.line,
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      correctionEntityIds: [...CHECKPOINT_CORRECTION_IDS[id][record.line]],
      durationMs,
      firstFrameIndex,
      lastFrameIndex,
      firstPresentationTimeMs: firstFrameIndex * CHECKPOINT_SAMPLE_INTERVAL_MS,
      lastPresentationTimeMs: lastFrameIndex * CHECKPOINT_SAMPLE_INTERVAL_MS,
      firstElapsedMs,
      lastElapsedMs: firstElapsedMs
        + (lastFrameIndex - firstFrameIndex) * CHECKPOINT_SAMPLE_INTERVAL_MS,
      sampleCount: lastFrameIndex - firstFrameIndex + 1,
      presentedCursor: checkpoint.event_cursor,
      firstFrameIdentity: {
        runId: checkpoint.run_id,
        sourceKey: `live:${checkpoint.run_id}`,
        firstCursor,
        lastCursor: checkpoint.event_cursor,
        revision: record.line * 10,
      },
      lastFrameIdentity: {
        runId: checkpoint.run_id,
        sourceKey: `live:${checkpoint.run_id}`,
        firstCursor,
        lastCursor: checkpoint.event_cursor,
        revision: record.line * 10 + focusTargets.length - 1,
      },
      samples,
      world: {
        runId: checkpoint.snapshot.run_id,
        exactBaseCursor: checkpoint.snapshot.event_cursor,
        projectedThroughCursor: checkpoint.snapshot.event_cursor,
        worldTime: checkpoint.snapshot.world_time,
        agents: structuredClone(checkpoint.snapshot.agents),
        homes: structuredClone(checkpoint.snapshot.homes),
        regions: structuredClone(checkpoint.snapshot.regions),
        ruins: structuredClone(checkpoint.snapshot.ruins),
        pendingProposals: structuredClone(checkpoint.snapshot.pending_proposals),
      },
    };
  });
}

function syntheticCheckpointMarkerFrames(id, offset = 0) {
  if (id === "C06") return {
    "event:hearth_used": 9 + offset,
    "event:home_started_hoarding": 70 + offset,
    "checkpoint:final": 80 + offset,
  };
  if (id === "C07") return {
    "event:home_breached": 70 + offset,
    "event:home_thieved": 80 + offset,
    "checkpoint:final": 114 + offset,
  };
  if (id === "C09") return {
    "event:home_collapsed@cursor:1": 4 + offset,
    "event:home_collapsed@cursor:2": 5 + offset,
    "event:agent_left_region": 90 + offset,
    "event:ruins_scavenged@cursor:5": 94 + offset,
    "event:ruins_scavenged@cursor:6": 95 + offset,
    "checkpoint:final": 148 + offset,
  };
  return {};
}

function standardRecordingMarkerFrames(id) {
  if (id === "C01") return {
    "event:agent_left_region": 1,
    "event:agent_entered_region": 2,
    "checkpoint:final": 7,
  };
  if (id === "C07") return {
    ...syntheticCheckpointMarkerFrames(id),
    "event:settled": 113,
  };
  if (id === "C09") return {
    ...syntheticCheckpointMarkerFrames(id),
    "event:settled": 147,
  };
  return {
    "event:settled": 6,
    "checkpoint:final": 7,
  };
}

function reducedRecordingMarkerFrames(id) {
  if (id === "C01") return {
    "event:agent_left_region": 0,
    "event:agent_entered_region": 1,
    "checkpoint:final": 2,
  };
  return {
    "event:settled": 1,
    "checkpoint:final": 2,
  };
}

function syntheticCheckpointWitnessBundle(id, agents, homes, viewportName = "desktop") {
  const standard = syntheticCheckpointWitnesses(id, agents, homes, viewportName);
  const reducedFrameOffset = 100;
  const reducedTimeOffset = 5_000;
  const parityResidueMs = 1e-12;
  const reduced = standard.map((witness) => {
    const phaseOffsetMs = witness.firstElapsedMs;
    return {
      ...structuredClone(witness),
      firstFrameIndex: witness.firstFrameIndex + reducedFrameOffset,
      lastFrameIndex: witness.lastFrameIndex + reducedFrameOffset,
      firstPresentationTimeMs: witness.firstPresentationTimeMs + reducedTimeOffset,
      lastPresentationTimeMs: witness.lastPresentationTimeMs + reducedTimeOffset,
      firstElapsedMs: 0,
      lastElapsedMs: witness.lastElapsedMs - phaseOffsetMs + parityResidueMs,
      firstFrameIdentity: {
        ...witness.firstFrameIdentity,
        revision: witness.firstFrameIdentity.revision + 100,
      },
      lastFrameIdentity: {
        ...witness.lastFrameIdentity,
        revision: witness.lastFrameIdentity.revision + 100,
      },
      samples: witness.samples.map((sample, sampleIndex) => ({
        ...structuredClone(sample),
        frameIndex: sample.frameIndex + reducedFrameOffset,
        presentationTimeMs: sample.presentationTimeMs + reducedTimeOffset,
        elapsedMs: sample.elapsedMs - phaseOffsetMs
          + (sampleIndex === witness.samples.length - 1 ? parityResidueMs : 0),
        remainingMs: sample.remainingMs + phaseOffsetMs
          - (sampleIndex === witness.samples.length - 1 ? parityResidueMs : 0),
        frameIdentity: {
          ...sample.frameIdentity,
          revision: sample.frameIdentity.revision + 100,
        },
        publicationSerial: sample.publicationSerial + 1_000,
        focusTarget: {
          ...structuredClone(sample.focusTarget),
          segmentElapsedMs: sample.focusTarget.segmentElapsedMs - phaseOffsetMs
            + (sampleIndex === witness.samples.length - 1 ? parityResidueMs : 0),
          segmentRemainingMs: sample.focusTarget.segmentRemainingMs + phaseOffsetMs
            - (sampleIndex === witness.samples.length - 1 ? parityResidueMs : 0),
        },
        camera: {
          ...sample.camera,
          rasterOrigin: {
            x: sample.camera.rasterOrigin.x - 16,
            y: sample.camera.rasterOrigin.y,
          },
        },
        homes: sample.homes.map((home) => ({
          ...structuredClone(home),
          instanceId: home.instanceId + 100,
          plot: { x: home.plot.x + 16, y: home.plot.y },
          geometry: {
            ...structuredClone(home.geometry),
            worldBounds: {
              ...home.geometry.worldBounds,
              x: home.geometry.worldBounds.x + 16,
            },
          },
          screenBounds: { ...home.screenBounds },
        })),
      })),
    };
  });
  return {
    standard: {
      witnesses: standard,
      markerFrames: syntheticCheckpointMarkerFrames(id),
    },
    reduced: {
      witnesses: reduced,
      markerFrames: syntheticCheckpointMarkerFrames(id, reducedFrameOffset),
    },
  };
}

function syntheticCheckpointMotionFrames(id, finalCursor, placementHash) {
  if (!["C06", "C07", "C09"].includes(id)) {
    return [{ frameIndex: 0, cursor: finalCursor, activeEffects: 0, placementHash }];
  }
  const maximumFrame = id === "C06" ? 80 : id === "C07" ? 120 : 150;
  return Array.from({ length: maximumFrame + 1 }, (_, frameIndex) => {
    const cursor = id === "C06"
      ? frameIndex <= 58 ? 3 : finalCursor
      : id === "C07"
      ? frameIndex <= 58 ? 2 : finalCursor
      : frameIndex <= 81 ? 2 : finalCursor;
    return { frameIndex, cursor, activeEffects: 0, placementHash };
  });
}

function genericFixtureEntry(cursor) {
  return {
    cursor,
    event: { type: "settled", payload: { cursor } },
  };
}

function fixtureEntriesFor(id) {
  if (id === "C01") return [
    {
      cursor: 1,
      event: {
        type: "agent_left_region",
        payload: {
          agent_id: "wanderer_001",
          from_region: "meadow",
          to_region: "distant",
        },
      },
    },
    {
      cursor: 2,
      event: {
        type: "agent_entered_region",
        payload: {
          agent_id: "wanderer_001",
          from_region: "meadow",
          to_region: "distant",
        },
      },
    },
  ];
  const count = id === "C13" ? 120 : id === "C16" ? 4_096 : 0;
  return Array.from({ length: count }, (_, index) => {
    const entry = genericFixtureEntry(index + 1);
    return id === "C16"
      ? { ...entry, event: { ...entry.event, region: "warm_springs" } }
      : entry;
  });
}

function acceptedRangesFor(id) {
  if (id === "C01") return [[1, 2]];
  if (id === "C13") return C13_ACCEPTED_RANGES;
  if (id === "C16") return C16_ACCEPTED_RANGES;
  return [];
}

function acceptedEventWitnessesFor(id) {
  const entries = new Map(fixtureEntriesFor(id).map((entry) => [entry.cursor, entry]));
  return acceptedRangesFor(id).flatMap(([first, last]) => (
    Array.from({ length: last - first + 1 }, (_, index) => first + index)
  )).map((cursor) => ({
    kind: "envelope",
    disposition: "accepted",
    cursor,
    envelope: { next_cursor: cursor, events: [entries.get(cursor)] },
  }));
}
const TRUSTED_ROOT = await mkdtemp(path.join(os.tmpdir(), "vivarium-evidence-root-"));
await mkdir(path.join(TRUSTED_ROOT, "fixtures"), { recursive: true });
await mkdir(path.join(TRUSTED_ROOT, "analysis", ".vite"), { recursive: true });
await mkdir(path.join(TRUSTED_ROOT, "analysis", "assets"), { recursive: true });
await mkdir(path.join(TRUSTED_ROOT, "artifacts"), { recursive: true });
const catalogEntries = [];
for (const id of CATALOG_IDS) {
  const c16 = id === "C16";
  const agents = c16 ? Array.from({ length: 256 }, (_, index) => ({
    id: `pressure_${String(index).padStart(3, "0")}`,
    position: index < 65 ? "warm_springs"
      : index < 130 ? "nirvana"
        : index < 193 ? "nirvana_east"
          : "nirvana_west",
  })) : ["C00", "C14", "C15"].includes(id)
    ? [{ id: "wanderer_001", position: "meadow" }]
    : [{ id: "wanderer_001" }];
  const homes = c16 ? Array.from({ length: 128 }, (_, index) => ({
    home_id: `pressure_home_${String(index).padStart(3, "0")}`,
    region: ["warm_springs", "nirvana", "nirvana_east", "nirvana_west"][Math.floor(index / 32)],
  })) : [];
  const file = `${id}.json`;
  const c01 = id === "C01";
  const fixtureEntries = fixtureEntriesFor(id);
  await writeFile(path.join(TRUSTED_ROOT, "fixtures", file), canonicalJson({
    id,
    expectedFinalCursor: SPECIAL_CURSORS[id] ?? 4,
    expectedMarkers: c01 ? C01_MARKERS : ["checkpoint:final", "event:settled"],
    expectedTerminal: {
      semanticOracle: c01 ? C01_SEMANTIC_ORACLE : SEMANTIC_ORACLE,
      ...(GRAPH_LIFECYCLE_ORACLES[id] === undefined
        ? {}
        : { graphLifecycleOracle: GRAPH_LIFECYCLE_ORACLES[id] }),
    },
    initialSnapshot: {
      agents,
      homes,
      ...(c01 ? { regions: [
        { name: "meadow", connections: ["distant"] },
        { name: "distant", connections: [] },
      ] } : ["C00", "C14", "C15"].includes(id) ? {
        regions: [{ name: "meadow", connections: [] }],
      } : {}),
    },
    entries: fixtureEntries,
    checkpoints: c16
      ? [1024, 2048, 3072, 4096].map((event_cursor) => ({ checkpoint: { event_cursor, snapshot: { agents, homes } } }))
      : syntheticCheckpointRecords(id, agents, homes),
  }));
  catalogEntries.push({ id, file, expectedFinalCursor: SPECIAL_CURSORS[id] ?? 4 });
}
await writeFile(path.join(TRUSTED_ROOT, "catalog.json"), canonicalJson({ schema: 1, chronicles: catalogEntries }));
await writeFile(path.join(TRUSTED_ROOT, "analysis", "assets", "stage.js"), "export const productionStage = 1;\n");
await writeFile(path.join(TRUSTED_ROOT, "analysis", "assets", "z.js"), "export const z = 1;\n");
await writeFile(path.join(TRUSTED_ROOT, "analysis", "assets", "ä.js"), "export const umlaut = 1;\n");
await writeFile(path.join(TRUSTED_ROOT, "analysis", ".vite", "manifest.json"), canonicalJson({
  stage: { src: "src/renderer2d/production/PresentationWorldStage.tsx", file: "assets/stage.js", imports: ["z", "umlaut"], isEntry: true },
  z: { file: "assets/z.js" },
  umlaut: { file: "assets/ä.js" },
}));
const MEDIA_ROOT = path.join(TRUSTED_ROOT, "media-base");
const MEDIA_FRAME_COUNTS = Object.freeze({ standard: 149, reduced: 3 });
await mkdir(path.join(MEDIA_ROOT, "standard-frames"), { recursive: true });
await mkdir(path.join(MEDIA_ROOT, "reduced-frames"), { recursive: true });
/**
 * Seed frames for the synthetic media base, authored here rather than copied out of a
 * production build. `frontend/dist` is gitignored, its asset filenames are content
 * hashed, and CI runs this contract step before it ever builds the frontend, so
 * borrowing build output can only ever pass on a developer machine. Nothing decodes
 * these pixels: ffmpeg encodes them into the fixture videos and the oracles bind them by
 * byte length and hash. The two modes differ in both dimensions and fill so the standard
 * and reduced stills stay byte- and hash-distinct, which the "foreign still" rejection
 * later in this file depends on. Dimensions stay even for h264 `yuv420p`.
 */
const MEDIA_SEED_FRAMES = Object.freeze({
  standard: { width: 64, height: 48, background: { r: 24, g: 48, b: 96, alpha: 1 } },
  reduced: { width: 64, height: 32, background: { r: 192, g: 96, b: 24, alpha: 1 } },
});
for (const [mode, seed] of Object.entries(MEDIA_SEED_FRAMES)) {
  await sharp({
    create: { width: seed.width, height: seed.height, channels: 4, background: seed.background },
  }).png().toFile(path.join(MEDIA_ROOT, `${mode}-frames`, "000000.png"));
}
for (const mode of ["standard", "reduced"]) {
  for (let frameIndex = 1; frameIndex < MEDIA_FRAME_COUNTS[mode]; frameIndex += 1) {
    await copyFile(
      path.join(MEDIA_ROOT, `${mode}-frames`, "000000.png"),
      path.join(MEDIA_ROOT, `${mode}-frames`, `${String(frameIndex).padStart(6, "0")}.png`),
    );
  }
}
const MEDIA_PROBES = {};
for (const mode of ["standard", "reduced"]) {
  MEDIA_PROBES[mode] = await encodeFrameSequence({
    framesDirectory: path.join(MEDIA_ROOT, `${mode}-frames`),
    frameCount: MEDIA_FRAME_COUNTS[mode],
    webmPath: path.join(MEDIA_ROOT, `${mode}.webm`),
    mp4Path: path.join(MEDIA_ROOT, `${mode}.mp4`),
  });
}

async function artifactReference(filename, file) {
  return { file, bytes: (await stat(filename)).size, sha256: await sha256File(filename) };
}

async function prepareMotionArtifacts(
  chronicleId,
  viewport,
  mode,
  expectedMarkers = ["checkpoint:final", "event:settled"],
  namespace = chronicleId,
  lineage = {},
) {
  const relative = `${namespace}/${viewport}`;
  const directory = path.join(TRUSTED_ROOT, "artifacts", relative);
  await mkdir(path.join(directory, "markers"), { recursive: true });
  const webmName = mode === "standard" ? "video.webm" : "reduced-video.webm";
  const mp4Name = mode === "standard" ? "review.mp4" : "reduced-review.mp4";
  const recordingName = mode === "standard" ? "recording.json" : "reduced-recording.json";
  const markersName = mode === "standard" ? "markers.json" : "reduced-markers.json";
  const webm = path.join(directory, webmName);
  const mp4 = path.join(directory, mp4Name);
  const still = path.join(directory, "markers", `${mode}-000000.png`);
  await copyFile(path.join(MEDIA_ROOT, `${mode}.webm`), webm);
  await copyFile(path.join(MEDIA_ROOT, `${mode}.mp4`), mp4);
  await copyFile(path.join(MEDIA_ROOT, `${mode}-frames`, "000000.png"), still);
  const stillRef = await artifactReference(still, `markers/${mode}-000000.png`);
  const finalCursor = lineage.finalCursor ?? SPECIAL_CURSORS[chronicleId] ?? 4;
  const runId = lineage.runId ?? `${chronicleId.toLowerCase()}-run`;
  const acceptedIdentity = {
    runId,
    sourceKey: `live:${runId}`,
    firstCursor: 0,
    lastCursor: finalCursor,
    revision: 1,
  };
  const frameCount = MEDIA_FRAME_COUNTS[mode];
  const markerFrames = mode === "standard"
    ? standardRecordingMarkerFrames(chronicleId)
    : reducedRecordingMarkerFrames(chronicleId);
  const frameLedger = Array.from({ length: frameCount }, (_unused, frameIndex) => ({
    frameIndex,
    mediaTimeMs: frameIndex * 1000 / 30,
    presentationTimeMs: frameIndex * 1000 / 30,
    bytes: stillRef.bytes,
    sha256: stillRef.sha256,
    presentedCursor: finalCursor,
    exactBaseCursor: finalCursor,
    projectedThroughCursor: finalCursor,
    region: {
      activeRegionId: "meadow",
      visibleRegionId: "meadow",
      loadingRegionId: null,
    },
    canvasFrameIdentity: acceptedIdentity,
    observerFrameIdentity: { ...acceptedIdentity },
  }));
  await writeFile(path.join(directory, recordingName), canonicalJson({
    schemaVersion: 1,
    chronicleId,
    viewport,
    fps: 30,
    frameCount,
    durationMs: frameCount * 1000 / 30,
    timelineSha256: sha256Buffer(Buffer.from(canonicalJson(frameLedger))),
    frames: frameLedger,
    video: {
      webm: { ...await artifactReference(webm, webmName), probe: MEDIA_PROBES[mode].webm },
      mp4: { ...await artifactReference(mp4, mp4Name), probe: MEDIA_PROBES[mode].mp4 },
    },
  }));
  await writeFile(path.join(directory, markersName), canonicalJson({
    schemaVersion: 1,
    chronicleId,
    viewport,
    expected: expectedMarkers,
    observed: expectedMarkers.map((expectedMarker, index) => ({
      id: `${mode}-${index}`,
      label: expectedMarker,
      expectedMarker,
      frameIndex: markerFrames[expectedMarker],
      mediaTimeMs: markerFrames[expectedMarker] * 1000 / 30,
      presentationTimeMs: markerFrames[expectedMarker] * 1000 / 30,
      still: stillRef,
    })),
  }));
  return relative;
}

const MOTION_ARTIFACTS = {};
for (const id of LITERAL_IDS) {
  for (const viewport of ["desktop", "mobile"]) {
    for (const mode of ["standard", "reduced"]) {
      MOTION_ARTIFACTS[`${id}/${viewport}/${mode}`] = await prepareMotionArtifacts(
        id,
        viewport,
        mode,
        id === "C01" ? C01_MARKERS : ["checkpoint:final", "event:settled"],
      );
    }
  }
}
const CANONICAL_C00_MOTION = {};
const canonicalC00Manifest = JSON.parse(await readFile(path.resolve(
  "tests/frontend-app/fixtures/chronicles/data/C00-world-four-regions-topology.json",
)));
for (const mode of ["standard", "reduced"]) {
  CANONICAL_C00_MOTION[mode] = await prepareMotionArtifacts(
    "C00",
    "desktop",
    mode,
    ["checkpoint:final"],
    "canonical-C00",
    { runId: canonicalC00Manifest.expectedTerminal.finalSnapshot.run_id },
  );
}
const CANONICAL_C12_MOTION = {};
for (const mode of ["standard", "reduced"]) {
  CANONICAL_C12_MOTION[mode] = await prepareMotionArtifacts(
    "C12",
    "mobile",
    mode,
    ["checkpoint:final", "event:settled"],
    "canonical-C12-travel",
    { finalCursor: 12 },
  );
}
const BASE_REQUESTS = Object.freeze([
  Object.freeze({ sequence: 1, kind: "navigation", method: "GET", url: "http://127.0.0.1:4173/?renderer=2d", handler: "vite-navigation", status: 200, disposition: "fulfilled", responseStatus: 200, terminal: "finished", failureText: null }),
  Object.freeze({ sequence: 2, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/replay/artifacts/raw", handler: "raw-artifact-rejection", status: 0, disposition: "rejected", responseStatus: null, terminal: "failed", failureText: "net::ERR_FAILED" }),
]);
const REQUEST_SUMMARY = Object.freeze({
  observedCount: BASE_REQUESTS.length,
  ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(BASE_REQUESTS))),
});
const TRUSTED_CONFIG = Object.freeze({
  catalogRoot: TRUSTED_ROOT,
  catalogFile: "catalog.json",
  fixtureDirectory: "fixtures",
  analysisRoot: path.join(TRUSTED_ROOT, "analysis"),
  analysisManifestFile: ".vite/manifest.json",
  stageSource: "src/renderer2d/production/PresentationWorldStage.tsx",
  artifactRoot: path.join(TRUSTED_ROOT, "artifacts"),
  applicationOrigin: "http://127.0.0.1:4173",
  requestSummaries: Object.fromEntries(LITERAL_IDS.flatMap((id) => ["desktop", "mobile"].map((viewport) => [`${id}/${viewport}`, REQUEST_SUMMARY]))),
});
const ORACLE = createChronicleEvidenceOracle(TRUSTED_CONFIG);
const buildViewportEvidence = ORACLE.buildViewportEvidence;
const buildChronicleEvidenceMatrix = ORACLE.buildChronicleEvidenceMatrix;
const writeViewportEvidence = ORACLE.writeViewportEvidence;
test.after(async () => rm(TRUSTED_ROOT, { recursive: true, force: true }));

function fullPlacements() {
  const placements = {};
  for (let index = 0; index < 256; index += 1) {
    const id = `actor:pressure_${String(index).padStart(3, "0")}`;
    placements[id] = sha256Buffer(Buffer.from(id));
  }
  for (let index = 0; index < 128; index += 1) {
    const id = `home:pressure_home_${String(index).padStart(3, "0")}`;
    placements[id] = sha256Buffer(Buffer.from(id));
  }
  return placements;
}

function cursorEvidence(id, finalCursor) {
  if (id === "C13") {
    return {
      samples: [
        sample(0, 0, 0, 0, 0, "running"),
        sample(1, 1, 1, 1, 1, "running"),
        sample(2, 120, 50, 1, 1, "paused"),
        sample(3, 120, 120, 120, 120, "settled"),
      ],
      gaps: [{ fromCursor: 51, toCursor: 120, detectedFrameIndex: 2, visibleFrameIndex: 2, recoveredFrameIndex: 3, resumedFrameIndex: 3 }],
    };
  }
  if (id === "C16") {
    return {
      samples: [
        sample(0, 1_024, 50, 0, 0, "recovering"),
        sample(1, 1_024, 1_024, 1_024, 1_024, "settled"),
        sample(2, 2_048, 1_074, 1_024, 1_024, "paused"),
        sample(3, 2_048, 2_048, 2_048, 2_048, "settled"),
        sample(4, 3_072, 2_098, 2_048, 2_048, "recovering"),
        sample(5, 3_072, 3_072, 3_072, 3_072, "settled"),
        sample(6, 4_096, 3_122, 3_072, 3_072, "recovering"),
        sample(7, 4_096, 4_096, 4_096, 4_096, "settled"),
      ],
      gaps: [
        { fromCursor: 51, toCursor: 1_024, detectedFrameIndex: 0, visibleFrameIndex: 0, recoveredFrameIndex: 1, resumedFrameIndex: 1 },
        { fromCursor: 1_075, toCursor: 2_048, detectedFrameIndex: 2, visibleFrameIndex: 2, recoveredFrameIndex: 3, resumedFrameIndex: 3 },
        { fromCursor: 2_099, toCursor: 3_072, detectedFrameIndex: 4, visibleFrameIndex: 4, recoveredFrameIndex: 5, resumedFrameIndex: 5 },
        { fromCursor: 3_123, toCursor: 4_096, detectedFrameIndex: 6, visibleFrameIndex: 6, recoveredFrameIndex: 7, resumedFrameIndex: 7 },
      ],
    };
  }
  return finalCursor === 0
    ? { samples: [sample(0, 0, 0, 0, 0, "settled")], gaps: [] }
    : { samples: [sample(0, 0, 0, 0, 0, "running"), sample(1, finalCursor, finalCursor, finalCursor, finalCursor, "settled")], gaps: [] };
}

function sample(frameIndex, authoritativeCursor, acceptedCursor, presentedCursor, publicCursor, phase) {
  return { frameIndex, authoritativeCursor, acceptedCursor, presentedCursor, publicCursor, phase };
}

function performanceEvidence(id) {
  const c16 = id === "C16";
  const eventless = ["C00", "C14", "C15"].includes(id);
  const runtimeBase = { ingressAccepted: 0, directorPending: 0, chroniclePrevious: 1, chronicleUpcoming: 1, retainedSafeCheckpoints: 1, activeSceneCount: 0, liveSessions: 1, archiveSessions: 0, stageCount: 1, canvasCount: 1, stageId: "stage-main", canvasId: "canvas-main" };
  return {
    drawSamplesMs: [1, 2, 3, 4],
    longTasksMs: [],
    cadenceWindows: [
      { mode: "visible", frameCount: 60, durationMs: 1000 },
      { mode: "reduced", frameCount: 30, durationMs: 1000 },
      { mode: "hidden", frameCount: 0, durationMs: 1000 },
    ],
    runtimeSamples: c16
      ? [1024, 2048, 3072, 4096].map((authoritativeCursor, frameIndex) => ({
          ...runtimeBase,
          frameIndex,
          authoritativeCursor,
          phase: frameIndex === 0 ? "active" : authoritativeCursor === 4096 ? "terminal" : "pressure",
          activeSceneCount: frameIndex === 0 ? 1 : 0,
          chroniclePrevious: authoritativeCursor === 4096 ? 0 : 1,
          chronicleUpcoming: authoritativeCursor === 4096 ? 0 : 1,
        }))
      : [
          { ...runtimeBase, frameIndex: 0, phase: "active", authoritativeCursor: id === "C00" || id === "C14" || id === "C15" ? 0 : 1, ingressAccepted: id === "C00" || id === "C14" || id === "C15" ? 0 : 1, directorPending: 1, activeSceneCount: 1 },
          { ...runtimeBase, frameIndex: 1, phase: "terminal", authoritativeCursor: SPECIAL_CURSORS[id] ?? 4, chroniclePrevious: 0, chronicleUpcoming: 0 },
        ],
    schedulerSamples: [
      {
        mode: "visible",
        phase: "ambient",
        routeId: "standard",
        ownerId: "standard-canvas",
        dirty: false,
        rafScheduled: false,
        wakeScheduled: true,
        nextDeadlineMs: 2_000,
        observedAtMs: 1_000,
        drawTotal: 10,
        reason: "graph-deadline",
      },
      {
        mode: "terminal-static",
        phase: "terminal-static",
        routeId: "reduced",
        ownerId: "reduced-canvas",
        dirty: false,
        rafScheduled: false,
        wakeScheduled: false,
        nextDeadlineMs: null,
        observedAtMs: 2_000,
        drawTotal: 10,
        reason: null,
        quiet: {
          durationMs: 1_000,
          drawDelta: 0,
          reactCommitDelta: 0,
          cursorBefore: SPECIAL_CURSORS[id] ?? 4,
          cursorAfter: SPECIAL_CURSORS[id] ?? 4,
          frameIdentityBefore: "a".repeat(64),
          frameIdentityAfter: "a".repeat(64),
          stateHashBefore: "b".repeat(64),
          stateHashAfter: "b".repeat(64),
        },
      },
      {
        mode: "hidden",
        phase: "hidden",
        routeId: "standard",
        ownerId: "standard-canvas",
        dirty: false,
        rafScheduled: false,
        wakeScheduled: false,
        nextDeadlineMs: null,
        observedAtMs: 3_000,
        drawTotal: 10,
        reason: null,
      },
      {
        mode: "disposed",
        phase: "disposed",
        routeId: "standard",
        ownerId: "standard-canvas",
        dirty: false,
        rafScheduled: false,
        wakeScheduled: false,
        nextDeadlineMs: null,
        observedAtMs: 3_001,
        drawTotal: 10,
        reason: null,
      },
      {
        mode: "reduced-active",
        phase: "active",
        routeId: "reduced",
        ownerId: "reduced-canvas",
        dirty: false,
        rafScheduled: false,
        wakeScheduled: false,
        nextDeadlineMs: null,
        observedAtMs: 1_500,
        drawTotal: 9,
        reason: null,
      },
    ],
    archiveObservations: c16 ? Array.from({ length: 25 }, (_, index) => ({
      cycle: index + 1,
      source: "archive",
      liveCursorBefore: 4096,
      liveCursorAfter: 4096,
      liveStateHashBefore: "a".repeat(64),
      liveStateHashAfter: "a".repeat(64),
      liveSessions: 1,
      archiveSessions: 1,
      stageId: "stage-main",
      canvasId: "canvas-main",
      archiveSpatialBinding: {
        placementRebound: true,
        recipesRebound: true,
      },
      restoredLiveSpatialBinding: {
        placementRebound: false,
        recipesRebound: false,
      },
    })) : [],
    lifecycle: {
      visibleRegionId: c16 ? "warm_springs" : eventless ? "meadow" : "alpha",
      stage: counter(1),
      canvas: counter(1),
      graph: counter(1),
      graphActors: GRAPH_LIFECYCLE_ORACLES[id]?.actors === undefined
        ? counter(c16 ? 65 : 1)
        : counter(
            GRAPH_LIFECYCLE_ORACLES[id].actors.created,
            GRAPH_LIFECYCLE_ORACLES[id].actors.peak,
          ),
      graphHomes: GRAPH_LIFECYCLE_ORACLES[id]?.homes === undefined
        ? counter(c16 ? 32 : ["C06", "C07"].includes(id) ? 1 : 0)
        : counter(
            GRAPH_LIFECYCLE_ORACLES[id].homes.created,
            GRAPH_LIFECYCLE_ORACLES[id].homes.peak,
          ),
      graphEnvironments: counter(c16 || eventless ? 1 : 4),
      cache: { ...counter(2), rebuildReasons: ["topology"] },
      atlas: { decodeStarts: 1, bitmapsClosed: 1, acquireCalls: 2, releaseCalls: 2, leasesCreated: 2, leasesReleased: 2 },
      react: { initialCommitCount: 1, finalCommitCount: 2, frameDrivenCommitCount: 0 },
      heap: c16
        ? {
            supportProbe: { api: "CDP HeapProfiler.collectGarbage", supported: true, reason: null },
            collections: 2,
            baseline: { usedSize: 10_000, embedderHeapUsedSize: 20_000, backingStorageSize: 30_000 },
            tail: { usedSize: 10_100, embedderHeapUsedSize: 20_100, backingStorageSize: 30_100 },
            domBaseline: { nodes: 100, listeners: 10 },
            domTail: { nodes: 110, listeners: 11 },
          }
        : { supportProbe: { api: "CDP HeapProfiler.collectGarbage", supported: false, reason: "CDP unavailable" }, collections: 0, baseline: null, tail: null, domBaseline: { nodes: 100, listeners: 10 }, domTail: { nodes: 110, listeners: 11 } },
    },
  };
}

function counter(created, peak = created) {
  return { created, disposed: created, live: 0, outstanding: 0, peak };
}

function productionActorWorldBounds(x, y) {
  return {
    x: x + EXPECTED_PRODUCTION_ACTOR_VISUAL_ENVELOPE.left,
    y: y + EXPECTED_PRODUCTION_ACTOR_VISUAL_ENVELOPE.top,
    width: EXPECTED_PRODUCTION_ACTOR_VISUAL_ENVELOPE.width,
    height: EXPECTED_PRODUCTION_ACTOR_VISUAL_ENVELOPE.height,
  };
}

function c01TrajectorySamples(viewport) {
  const viewportRect = viewport === "desktop"
    ? { x: 0, y: 0, width: 1_440, height: 900 }
    : { x: 0, y: 0, width: 390, height: 844 };
  const values = [
    ["meadow", 100, 100, "east", "moving"],
    ["meadow", 120, 100, "east", "moving"],
    ["distant", 2_512, 1_360, "east", "moving"],
    ["distant", 2_528, 1_360, "east", "moving"],
    ["distant", 2_544, 1_360, "east", "moving"],
    ["distant", 2_544, 1_360, "east", null],
    ["distant", 2_544, 1_360, "east", null],
    ["distant", 2_544, 1_360, "east", null],
  ];
  return values.map(([regionId, x, y, facing, activeAction], frameIndex) => {
    const worldBounds = productionActorWorldBounds(x, y);
    const camera = {
      mode: "story",
      zoom: 1,
      rasterOrigin: { x: viewportRect.width / 2 - x, y: viewportRect.height / 2 - y },
      safeFrame: viewportRect,
      viewport: { width: viewportRect.width, height: viewportRect.height },
    };
    const screenBounds = {
      x: worldBounds.x + camera.rasterOrigin.x,
      y: worldBounds.y + camera.rasterOrigin.y,
      width: worldBounds.width,
      height: worldBounds.height,
    };
    return {
      frameIndex,
      cursor: frameIndex < 2 ? 0 : frameIndex < 5 ? 1 : 2,
      regionId,
      focusSelectionKey: "agent:wanderer_001",
      camera,
      actors: [{
        id: "wanderer_001",
        position: { x, y },
        facing,
        activeAction,
        worldBounds,
        screenBounds,
        screenVisible: true,
        safeFrameVisible: true,
      }],
    };
  });
}

function detailedTravelSample({
  frameIndex,
  cursor,
  regionId,
  actorId = "wanderer_001",
  x,
  y,
  facing = "east",
  activeAction = "moving",
  viewport = "mobile",
}) {
  const viewportRect = viewport === "desktop"
    ? { x: 0, y: 0, width: 1_440, height: 900 }
    : { x: 0, y: 0, width: 390, height: 844 };
  const worldBounds = productionActorWorldBounds(x, y);
  const camera = {
    mode: "story",
    zoom: 1,
    rasterOrigin: { x: viewportRect.width / 2 - x, y: viewportRect.height / 2 - y },
    safeFrame: viewportRect,
    viewport: { width: viewportRect.width, height: viewportRect.height },
  };
  const screenBounds = {
    x: worldBounds.x + camera.rasterOrigin.x,
    y: worldBounds.y + camera.rasterOrigin.y,
    width: worldBounds.width,
    height: worldBounds.height,
  };
  return {
    frameIndex,
    cursor,
    regionId,
    focusSelectionKey: `agent:${actorId}`,
    camera,
    actors: [{
      id: actorId,
      position: { x, y },
      facing,
      activeAction,
      worldBounds,
      screenBounds,
      screenVisible: true,
      safeFrameVisible: true,
    }],
  };
}

function travelEntry(cursor, type, actorId, fromRegion, toRegion) {
  return {
    cursor,
    event: {
      type,
      payload: {
        agent_id: actorId,
        from_region: fromRegion,
        to_region: toRegion,
      },
    },
  };
}

function twoLegTravelContract() {
  const actorId = "wanderer_001";
  const regions = [
    { name: "alpha", connections: ["beta"] },
    { name: "beta", connections: ["gamma"] },
    { name: "gamma", connections: [] },
  ];
  const legs = [
    { actorId, fromRegion: "alpha", toRegion: "beta", leftCursor: 1, enteredCursor: 2 },
    { actorId, fromRegion: "beta", toRegion: "gamma", leftCursor: 3, enteredCursor: 4 },
  ];
  const entries = legs.flatMap((leg) => [
    travelEntry(leg.leftCursor, "agent_left_region", actorId, leg.fromRegion, leg.toRegion),
    travelEntry(leg.enteredCursor, "agent_entered_region", actorId, leg.fromRegion, leg.toRegion),
  ]);
  const trajectorySamples = [
    detailedTravelSample({ frameIndex: 0, cursor: 0, regionId: "alpha", x: 112, y: 112 }),
    detailedTravelSample({ frameIndex: 1, cursor: 0, regionId: "alpha", x: 128, y: 112 }),
    detailedTravelSample({ frameIndex: 2, cursor: 1, regionId: "beta", x: 208, y: 208 }),
    detailedTravelSample({ frameIndex: 3, cursor: 1, regionId: "beta", x: 224, y: 208 }),
    detailedTravelSample({ frameIndex: 4, cursor: 2, regionId: "beta", x: 224, y: 208 }),
    detailedTravelSample({ frameIndex: 5, cursor: 2, regionId: "beta", x: 240, y: 208 }),
    detailedTravelSample({ frameIndex: 6, cursor: 3, regionId: "gamma", x: 304, y: 304 }),
    detailedTravelSample({ frameIndex: 7, cursor: 3, regionId: "gamma", x: 320, y: 304 }),
  ];
  const witness = (leg, observedFrameIndex, x, y) => ({
    actorId,
    reason: "region-transition",
    position: { x, y },
    actorPosition: { x, y },
    gate: {
      role: "arrival",
      tile: { column: Math.floor(x / 32), row: Math.floor(y / 32) },
      tileSize: 32,
      point: { x, y },
    },
    fromRegion: leg.fromRegion,
    toRegion: leg.toRegion,
    sceneToken: leg.enteredCursor,
    commandId: `arrival:${leg.enteredCursor}:${actorId}`,
    atMs: observedFrameIndex * (1_000 / 30),
    frameIdentity: {
      runId: "c02-run",
      sourceKey: "live:c02-run",
      firstCursor: leg.enteredCursor,
      lastCursor: leg.enteredCursor,
      revision: leg.enteredCursor,
    },
    observedFrameIndex,
    observedPresentationTimeMs: observedFrameIndex * (1_000 / 30),
  });
  return {
    actorId,
    regions,
    legs,
    entries,
    trajectorySamples,
    regionTransitionWitnesses: [
      witness(legs[0], 2, 208, 208),
      witness(legs[1], 6, 304, 304),
    ],
  };
}

async function withSyntheticTravelInput(chronicleId, contract, callback) {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", `${chronicleId}.json`);
  const original = await readFile(fixturePath);
  try {
    const fixture = JSON.parse(original);
    fixture.entries = structuredClone(contract.entries);
    fixture.initialSnapshot.regions = structuredClone(contract.regions);
    fixture.expectedTerminal.semanticOracle = {
      negative: ["no-alpha-gamma-shortcut"],
      positive: ["all-directed-edges", "forbidden-shortcut"],
      terminal: [...fixture.expectedTerminal.semanticOracle.terminal],
    };
    await writeFile(fixturePath, canonicalJson(fixture));

    const input = makeInput(chronicleId, "mobile");
    input.semantic.terminalAuthority = trustedTerminalAuthority(fixture);
    input.semantic.terminalObservation.frame.world.regions = fixture.initialSnapshot.regions
      .map((value) => ({ completeness: "exact", value }));
    input.semantic.eventWitnesses = fixture.entries.map((entry) => ({
      kind: "envelope",
      disposition: "accepted",
      cursor: entry.cursor,
      envelope: { next_cursor: entry.cursor, events: [structuredClone(entry)] },
    }));
    input.motion.trajectorySamples = structuredClone(contract.trajectorySamples);
    input.motion.regionTransitionWitnesses = structuredClone(contract.regionTransitionWitnesses);
    await callback(input, fixture);
  } finally {
    await writeFile(fixturePath, original);
  }
}

async function withCanonicalC12TravelInput(callback) {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", "C12.json");
  const catalogPath = path.join(TRUSTED_ROOT, "catalog.json");
  const [originalFixture, originalCatalog, canonical] = await Promise.all([
    readFile(fixturePath),
    readFile(catalogPath),
    realFixture("C12"),
  ]);
  try {
    const fixture = JSON.parse(originalFixture);
    const travelEntries = canonical.entries.filter(({ event }) => (
      event.type === "agent_left_region" || event.type === "agent_entered_region"
    ));
    assert.deepEqual(travelEntries.map(({ cursor }) => cursor), [11, 12]);
    fixture.expectedFinalCursor = 12;
    fixture.entries = travelEntries;
    fixture.initialSnapshot.regions = canonical.initialSnapshot.regions;
    fixture.expectedTerminal.semanticOracle = {
      negative: [...canonical.expectedTerminal.semanticOracle.negative],
      positive: ["travel"],
      terminal: [...fixture.expectedTerminal.semanticOracle.terminal],
    };
    const catalog = JSON.parse(originalCatalog);
    catalog.chronicles.find(({ id }) => id === "C12").expectedFinalCursor = 12;
    await writeFile(fixturePath, canonicalJson(fixture));
    await writeFile(catalogPath, canonicalJson(catalog));

    const input = makeInput("C12", "mobile");
    input.expectedFinalCursor = 12;
    input.semantic.terminalAuthority = trustedTerminalAuthority(fixture);
    input.semantic.eventWitnesses = travelEntries.map((entry) => ({
      kind: "envelope",
      disposition: "accepted",
      cursor: entry.cursor,
      envelope: { next_cursor: entry.cursor, events: [structuredClone(entry)] },
    }));
    const terminal = input.semantic.terminalObservation;
    terminal.ingestedCursor = 12;
    terminal.presentedCursor = 12;
    terminal.targetCursor = 12;
    for (const identity of [terminal.observerFrameIdentity, terminal.canvasFrameIdentity, terminal.frame]) {
      identity.lastCursor = 12;
    }
    terminal.frame.presentedCursor = 12;
    for (const witness of [
      input.semantic.terminalCameraWitness,
      input.reducedMotion.standard.terminalCameraWitness,
      input.reducedMotion.reduced.terminalCameraWitness,
    ]) {
      for (const cameraSample of witness.samples) {
        cameraSample.frameIdentity.lastCursor = 12;
        cameraSample.presentation.ingestedCursor = 12;
        cameraSample.presentation.presentedCursor = 12;
        cameraSample.presentation.canvasLastCursor = 12;
        cameraSample.world.exactBaseCursor = 12;
        cameraSample.world.projectedThroughCursor = 12;
      }
    }
    for (const mode of [input.reducedMotion.standard, input.reducedMotion.reduced]) {
      mode.artifactDirectory = CANONICAL_C12_MOTION[mode.mode];
    }
    terminal.frame.world.regions = fixture.initialSnapshot.regions
      .map((value) => ({ completeness: "exact", value }));
    input.cursors = {
      samples: [sample(0, 0, 0, 0, 0, "running"), sample(1, 12, 12, 12, 12, "settled")],
      gaps: [],
    };
    const actorId = travelEntries[0].event.payload.agent_id;
    input.motion.trajectorySamples = [
      detailedTravelSample({ frameIndex: 0, cursor: 10, regionId: "nirvana", actorId, x: 112, y: 112 }),
      detailedTravelSample({ frameIndex: 1, cursor: 10, regionId: "nirvana", actorId, x: 128, y: 112 }),
      detailedTravelSample({ frameIndex: 2, cursor: 11, regionId: "warm_springs", actorId, x: 208, y: 208 }),
      detailedTravelSample({ frameIndex: 3, cursor: 11, regionId: "warm_springs", actorId, x: 224, y: 208 }),
    ];
    input.motion.regionTransitionWitnesses = [{
      actorId,
      reason: "region-transition",
      position: { x: 208, y: 208 },
      actorPosition: { x: 208, y: 208 },
      gate: {
        role: "arrival",
        tile: { column: 6, row: 6 },
        tileSize: 32,
        point: { x: 208, y: 208 },
      },
      fromRegion: "nirvana",
      toRegion: "warm_springs",
      sceneToken: 12,
      commandId: `arrival:12:${actorId}`,
      atMs: 2_000 / 30,
      frameIdentity: {
        runId: "c12-run",
        sourceKey: "live:c12-run",
        firstCursor: 12,
        lastCursor: 12,
        revision: 12,
      },
      observedFrameIndex: 2,
      observedPresentationTimeMs: 2_000 / 30,
    }];
    input.performance.runtimeSamples.at(-1).authoritativeCursor = 12;
    input.performance.lifecycle.visibleRegionId = "nirvana";
    for (const schedulerSample of input.performance.schedulerSamples) {
      if (schedulerSample.quiet !== undefined) {
        schedulerSample.quiet.cursorBefore = 12;
        schedulerSample.quiet.cursorAfter = 12;
      }
    }
    const localOracle = createChronicleEvidenceOracle(TRUSTED_CONFIG);
    await callback(input, fixture, localOracle.buildViewportEvidence);
  } finally {
    await writeFile(fixturePath, originalFixture);
    await writeFile(catalogPath, originalCatalog);
  }
}

function expectedMarkers(chronicleId) {
  return chronicleId === "C01" ? [...C01_MARKERS] : ["checkpoint:final", "event:settled"];
}

function evidenceMarkerLabel(marker) {
  return marker.replace(/^event:/, "").replace(/^checkpoint:/, "Checkpoint ")
    .replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function moveC01Actor(value, sampleIndex, x, y) {
  const sample = value.motion.trajectorySamples[sampleIndex];
  const actor = sample.actors[0];
  actor.position = { x, y };
  sample.camera.rasterOrigin = {
    x: sample.camera.viewport.width / 2 - x,
    y: sample.camera.viewport.height / 2 - y,
  };
  actor.worldBounds = productionActorWorldBounds(x, y);
  actor.screenBounds = {
    x: actor.worldBounds.x * sample.camera.zoom + sample.camera.rasterOrigin.x,
    y: actor.worldBounds.y * sample.camera.zoom + sample.camera.rasterOrigin.y,
    width: actor.worldBounds.width * sample.camera.zoom,
    height: actor.worldBounds.height * sample.camera.zoom,
  };
  actor.screenVisible = actor.screenBounds.x < sample.camera.viewport.width
    && actor.screenBounds.x + actor.screenBounds.width > 0
    && actor.screenBounds.y < sample.camera.viewport.height
    && actor.screenBounds.y + actor.screenBounds.height > 0;
  actor.safeFrameVisible = actor.screenBounds.x >= sample.camera.safeFrame.x
    && actor.screenBounds.y >= sample.camera.safeFrame.y
    && actor.screenBounds.x + actor.screenBounds.width <= sample.camera.safeFrame.x + sample.camera.safeFrame.width
    && actor.screenBounds.y + actor.screenBounds.height <= sample.camera.safeFrame.y + sample.camera.safeFrame.height;
}

function terminalCameraWitness(identity, cursor, markerFrameIndex) {
  const sample = (frameIndex) => ({
    frameIndex,
    presentationTimeMs: frameIndex * 1000 / 30,
    frameIdentity: { ...identity },
    presentation: {
      ingestedCursor: cursor,
      presentedCursor: cursor,
      canvasLastCursor: cursor,
      activeSceneCount: 0,
      pendingMoments: 0,
    },
    world: {
      exactBaseCursor: cursor,
      projectedThroughCursor: cursor,
    },
    region: {
      activeRegionId: "meadow",
      visibleRegionId: "meadow",
      loadingRegionId: null,
    },
    camera: {
      mode: "story",
      center: { x: 160, y: 100 },
      zoom: 1,
      rasterOrigin: { x: 560, y: 350 },
      safeFrame: { x: 20, y: 20, width: 1_400, height: 860 },
      viewport: { width: 1_440, height: 900 },
      focusSelectionKey: "agent:wanderer_001",
      pendingStoryEntityId: null,
      pendingStoryTarget: null,
    },
    activeEffects: 0,
    actors: [{
      id: "wanderer_001",
      instanceId: 1,
      position: { x: 160, y: 100 },
      facing: "south",
      activeAction: null,
      reposition: null,
    }],
  });
  return {
    requiredConsecutiveSamples: 3,
    markerFrameIndex,
    samples: [
      sample(markerFrameIndex - 2),
      sample(markerFrameIndex - 1),
      sample(markerFrameIndex),
    ],
  };
}

function makeInput(chronicleId = "C03", viewport = "desktop") {
  const expectedFinalCursor = SPECIAL_CURSORS[chronicleId] ?? 4;
  const terminalAgents = chronicleId === "C16"
    ? Array.from({ length: 256 }, (_, index) => ({
        id: `pressure_${String(index).padStart(3, "0")}`,
        position: index < 65 ? "warm_springs"
          : index < 130 ? "nirvana"
            : index < 193 ? "nirvana_east"
              : "nirvana_west",
      }))
    : ["C00", "C14", "C15"].includes(chronicleId)
      ? [{ id: "wanderer_001", position: "meadow" }]
      : [{ id: "wanderer_001" }];
  const terminalHomes = chronicleId === "C16"
    ? Array.from({ length: 128 }, (_, index) => ({
        home_id: `pressure_home_${String(index).padStart(3, "0")}`,
        region: ["warm_springs", "nirvana", "nirvana_east", "nirvana_west"][Math.floor(index / 32)],
      }))
    : [];
  const terminalRegions = chronicleId === "C01" ? [
    { name: "meadow", connections: ["distant"] },
    { name: "distant", connections: [] },
  ] : ["C00", "C14", "C15"].includes(chronicleId)
    ? [{ name: "meadow", connections: [] }]
    : [];
  const terminalIdentity = {
    runId: `${chronicleId.toLowerCase()}-run`, sourceKey: `live:${chronicleId.toLowerCase()}-run`,
    firstCursor: 0, lastCursor: expectedFinalCursor, revision: 1,
  };
  const eventWitnesses = acceptedEventWitnessesFor(chronicleId);
  const authoritySnapshot = {
    agents: terminalAgents,
    homes: terminalHomes,
    ...(terminalRegions.length > 0 ? { regions: terminalRegions } : {}),
  };
  const authorityRunId = `${chronicleId.toLowerCase()}-run`;
  const terminalAuthority = {
    mechanic: {
      runId: authorityRunId,
      finalCursor: expectedFinalCursor,
      finalSnapshot: authoritySnapshot,
    },
    presentation: {
      kind: "mechanic-story",
      terminal: {
        source: "live",
        runId: authorityRunId,
        sourceKey: `live:${authorityRunId}`,
        cursor: expectedFinalCursor,
        snapshot: authoritySnapshot,
      },
    },
  };
  const placements = fullPlacements();
  const placementHash = sha256Buffer(Buffer.from(canonicalJson(placements)));
  const placementCheckpoints = chronicleId === "C16"
    ? [1024, 2048, 3072, 4096].map((cursor) => ({ cursor, placements: { ...placements } }))
    : [];
  const motionFrames = chronicleId === "C16"
    ? [1024, 2048, 3072, 4096].map((cursor, index) => ({ frameIndex: index + 1, cursor, activeEffects: 0, placementHash }))
    : syntheticCheckpointMotionFrames(
        chronicleId,
        expectedFinalCursor,
        "0".repeat(64),
      );
  const pressurePhases = [1024, 2048, 3072, 4096].map((cursor) => `pressure-${cursor}`);
  const markers = expectedMarkers(chronicleId);
  const markerFrames = standardRecordingMarkerFrames(chronicleId);
  const trajectorySamples = chronicleId === "C01"
    ? c01TrajectorySamples(viewport)
    : [{ frameIndex: 0, regionId: null, actors: [{ id: "wanderer_001", position: { x: 0, y: 0 } }] }];
  return {
    chronicleId,
    viewport,
    expectedFinalCursor,
    semantic: {
      terminalAuthority,
      operationalWorkload: { trace: [] },
      transportWitnesses: [],
      terminalObservation: {
        observerFrameIdentity: terminalIdentity,
        canvasFrameIdentity: { ...terminalIdentity },
        ingestedCursor: expectedFinalCursor,
        presentedCursor: expectedFinalCursor,
        targetCursor: expectedFinalCursor,
        activeSceneCount: 0,
        pendingMoments: 0,
        frame: {
          ...terminalIdentity,
          presentedCursor: expectedFinalCursor,
          world: {
            worldTime: 0,
            agents: terminalAgents.map((value) => ({ completeness: "exact", value })),
            homes: terminalHomes.map((value) => ({ completeness: "exact", value })),
            regions: terminalRegions.map((value) => ({ completeness: "exact", value })),
            ruins: [], pendingProposals: [],
          },
        },
      },
      terminalCameraWitness: terminalCameraWitness(
        terminalIdentity,
        expectedFinalCursor,
        markerFrames["checkpoint:final"],
      ),
      eventWitnesses,
      endpoints: ["agent:wanderer_001:still"],
      consequences: markers,
      markers,
    },
    cursors: cursorEvidence(chronicleId, expectedFinalCursor),
    motion: {
      frames: motionFrames,
      trajectorySamples,
      homeOwnershipSegments: chronicleId === "C09"
        ? C09_HOME_VISIBILITY_SEGMENTS.map(({ regionId, homeIds }, segmentIndex) => ({
            firstFrameIndex: C09_HOME_VISIBILITY_FRAME_RANGES[segmentIndex][0],
            lastFrameIndex: C09_HOME_VISIBILITY_FRAME_RANGES[segmentIndex][1],
            regionId,
            homes: homeIds.map((id, homeIndex) => ({
              id,
              instanceId: [1, 3, 4, 6, 7, 9, 10][segmentIndex] + homeIndex,
            })),
          }))
        : [],
      regionTransitionWitnesses: chronicleId === "C01" ? [{
        actorId: "wanderer_001",
        reason: "region-transition",
        position: { x: 2_512, y: 1_360 },
        actorPosition: { x: 2_512, y: 1_360 },
        gate: {
          role: "arrival", tile: { column: 78, row: 42 }, tileSize: 32,
          point: { x: 2_512, y: 1_360 },
        },
        fromRegion: "meadow",
        toRegion: "distant",
        sceneToken: 2,
        commandId: "arrival:wanderer_001",
        atMs: 60,
        frameIdentity: { ...terminalIdentity },
        observedFrameIndex: 2,
        observedPresentationTimeMs: 1_000 / 15,
      }] : [],
      markerFrames,
      checkpointWitnesses: syntheticCheckpointWitnessBundle(
        chronicleId,
        terminalAgents,
        terminalHomes,
        viewport,
      ),
      placementCheckpoints,
    },
    performance: performanceEvidence(chronicleId),
    network: {
      requests: structuredClone(BASE_REQUESTS),
    },
    assets: {
      raster: { imageSmoothingSamples: [false], coordinates: [0, 0, 1_440, 900] },
      environmentSamples: chronicleId === "C16"
        ? pressurePhases.map((phase) => ({ id: "environment", phase, capacity: 32, allocated: 12, activeEffects: 12 }))
        : [{ id: "environment", phase: "warm", capacity: 32, allocated: 12, activeEffects: 12 }],
      poolSamples: [
        ...(chronicleId === "C16" ? pressurePhases : ["warm"]).map((phase) => ({ phase, capacity: 32, allocated: 12, inFlightCount: 0, waiterCount: 0 })),
        { phase: "settled", capacity: 32, allocated: 0, inFlightCount: 0, waiterCount: 0 },
      ],
      atlasSamples: [
        ...(chronicleId === "C16" ? pressurePhases : ["warm"]).map((phase) => ({ phase, decodedBytes: 2048, leases: 2, waiterCount: 0, inFlightCount: 0 })),
        { phase: "settled", decodedBytes: 0, leases: 0, waiterCount: 0, inFlightCount: 0 },
      ],
    },
    reducedMotion: {
      standard: {
        captureId: `${chronicleId}-${viewport}-standard`,
        mode: "standard",
        artifactDirectory: MOTION_ARTIFACTS[`${chronicleId}/${viewport}/standard`],
        endpoints: ["agent:wanderer_001:still"],
        consequences: [...markers].sort(),
        markerOrder: markers,
        labels: markers.map(evidenceMarkerLabel),
        readingHoldsMs: markers.map(() => 900),
        terminalCameraWitness: terminalCameraWitness(
          terminalIdentity,
          expectedFinalCursor,
          markerFrames["checkpoint:final"],
        ),
      },
      reduced: {
        captureId: `${chronicleId}-${viewport}-reduced`,
        mode: "reduced",
        artifactDirectory: MOTION_ARTIFACTS[`${chronicleId}/${viewport}/reduced`],
        endpoints: ["agent:wanderer_001:still"],
        consequences: [...markers].sort(),
        markerOrder: markers,
        labels: markers.map(evidenceMarkerLabel),
        readingHoldsMs: markers.map(() => 900),
        terminalCameraWitness: terminalCameraWitness(terminalIdentity, expectedFinalCursor, 2),
      },
    },
    viewportMetrics: viewport === "desktop"
      ? { width: 1440, height: 900, devicePixelRatio: 1 }
      : { width: 390, height: 844, devicePixelRatio: 1 },
  };
}

function mutate(input, mutateValue) {
  const copy = structuredClone(input);
  mutateValue(copy);
  return copy;
}

async function realFixture(id) {
  const catalog = JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data/catalog.json",
  ), "utf8"));
  const entry = catalog.chronicles.find((value) => value.id === id);
  return JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data",
    entry.file,
  ), "utf8"));
}

function endpoint(source, runId, cursor, sourceKey = `${source}:${runId}`) {
  return { source, runId, sourceKey, cursor };
}

function traceEntry(workload, label, selected, live, completed) {
  return { workload, label, mechanicFinalCursor: 0, selected, live, completed };
}

function transportEntry({
  sequence, kind, sourceId, sourceRunId, sourceCursor, cursor = sourceCursor,
  disposition = "accepted", overflow = null, snapshotRequired = null,
  envelope = null,
}) {
  return {
    sequence,
    kind,
    sourceId,
    sourceRunId,
    // The production EventSource factory retains the browser-authored relative
    // request target in raw capture evidence.  Keep this fixture at that trust
    // boundary instead of silently pre-normalizing it to an absolute URL.
    url: `/api/events/stream?cursor=${sourceCursor}`,
    cursor,
    envelopeRunId: null,
    overflow,
    snapshotRequired,
    eventCount: envelope === null ? null : envelope.events.length,
    envelope,
    disposition,
  };
}

test("eventless authority proves C00, C14, and C15 only from operational evidence", async () => {
  const c00 = await realFixture("C00");
  const c00Authority = trustedTerminalAuthority(c00);
  const c00Live = endpoint("live", "mock-c00-v1", 0);
  assert.deepEqual(validateEventlessOperationalAuthority({
    chronicleId: "C00",
    fixture: c00,
    authority: c00Authority,
    workload: { trace: [
      traceEntry("ambient", "live-0", c00Live, c00Live, false),
      traceEntry("ambient", "terminal-live-0", c00Live, c00Live, true),
    ] },
    transportWitnesses: [
      transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 2, kind: "close", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }),
    ],
    terminalObservation: {
      activeSceneCount: 0, pendingMoments: 0, presentedCursor: 0,
      observerFrameIdentity: { runId: c00Live.runId, sourceKey: c00Live.sourceKey },
    },
    network: { requests: [] },
  }).positive, ["four-region-topology", "observer-checkpoint"]);
  assert.throws(() => validateEventlessOperationalAuthority({
    chronicleId: "C00",
    fixture: c00,
    authority: c00Authority,
    workload: { trace: [
      traceEntry("ambient", "live-0", c00Live, c00Live, false),
      traceEntry("ambient", "terminal-live-0", c00Live, c00Live, true),
    ] },
    transportWitnesses: [
      { ...transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }), url: "/api/events/stream?cursor=99" },
      { ...transportEntry({ sequence: 2, kind: "close", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }), url: "/api/events/stream?cursor=99" },
    ],
    terminalObservation: {
      activeSceneCount: 0, pendingMoments: 0, presentedCursor: 0,
      observerFrameIdentity: { runId: c00Live.runId, sourceKey: c00Live.sourceKey },
    },
    network: { requests: [] },
  }), /URL cursor must match/);
  assert.throws(() => validateEventlessOperationalAuthority({
    chronicleId: "C00",
    fixture: c00,
    authority: c00Authority,
    workload: { trace: [
      traceEntry("ambient", "live-0", c00Live, c00Live, false),
      traceEntry("ambient", "terminal-live-0", c00Live, c00Live, true),
    ] },
    transportWitnesses: [
      transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 2, kind: "close", sourceId: 1, sourceRunId: c00Live.runId, sourceCursor: 0 }),
    ],
    terminalObservation: {
      activeSceneCount: 1, pendingMoments: 0, presentedCursor: 0,
      observerFrameIdentity: { runId: c00Live.runId, sourceKey: c00Live.sourceKey },
    },
    network: { requests: [] },
  }), /presentation terminal/);

  for (const id of ["C00", "C14", "C15"]) {
    const fixture = await realFixture(id);
    delete fixture.expectedTerminal.presentationAuthority;
    assert.throws(() => trustedTerminalAuthority(fixture), /exact eventless presentation authority/);
  }

  const c14 = await realFixture("C14");
  const c14Authority = trustedTerminalAuthority(c14);
  const old0 = endpoint("live", "mock-c14-v1", 0);
  const old2 = endpoint("live", "mock-c14-v1", 2);
  const old3 = endpoint("live", "mock-c14-v1", 3);
  const replacement0 = endpoint("live", "mock-c14-v1-replacement", 0);
  const c14Trace = [
    traceEntry("transport-recovery", "old-live-0", old0, old0, false),
    traceEntry("transport-recovery", "old-live-2", old2, old2, false),
    traceEntry("transport-recovery", "old-live-3", old3, old3, false),
    traceEntry("transport-recovery", "replacement-live-0", replacement0, replacement0, false),
    traceEntry("transport-recovery", "stale-old-run-rejected", replacement0, replacement0, true),
  ];
  const c14Evidence = {
    chronicleId: "C14", fixture: c14, authority: c14Authority,
    workload: { trace: c14Trace },
    terminalObservation: {
      activeSceneCount: 0, pendingMoments: 0, presentedCursor: 0,
      observerFrameIdentity: { runId: replacement0.runId, sourceKey: replacement0.sourceKey },
    },
    transportWitnesses: [
      transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: old0.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 2, kind: "error", sourceId: 1, sourceRunId: old0.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 3, kind: "close", sourceId: 1, sourceRunId: old0.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 4, kind: "open", sourceId: 2, sourceRunId: old0.runId, sourceCursor: 2 }),
      transportEntry({
        sequence: 5, kind: "envelope", sourceId: 2, sourceRunId: old0.runId,
        sourceCursor: 2, cursor: 3, overflow: true, snapshotRequired: true,
        envelope: { schema: 1, cursor: 2, oldest_cursor: 2, next_cursor: 3, events: [], overflow: true, snapshot_required: true },
      }),
      transportEntry({ sequence: 6, kind: "close", sourceId: 2, sourceRunId: old0.runId, sourceCursor: 2 }),
      transportEntry({ sequence: 7, kind: "open", sourceId: 3, sourceRunId: old0.runId, sourceCursor: 3 }),
      transportEntry({ sequence: 8, kind: "close", sourceId: 3, sourceRunId: old0.runId, sourceCursor: 3 }),
      transportEntry({ sequence: 9, kind: "open", sourceId: 4, sourceRunId: replacement0.runId, sourceCursor: 0 }),
      transportEntry({
        sequence: 10, kind: "envelope", sourceId: 3, sourceRunId: old0.runId,
        sourceCursor: 3, cursor: 99, disposition: "forced-stale-callback",
        overflow: true, snapshotRequired: true,
        envelope: { schema: 1, cursor: 3, oldest_cursor: 4, next_cursor: 99, events: [], overflow: true, snapshot_required: true },
      }),
      transportEntry({ sequence: 11, kind: "close", sourceId: 4, sourceRunId: replacement0.runId, sourceCursor: 0 }),
    ],
    network: { requests: [
      { sequence: 1, url: "http://127.0.0.1/api/replay/checkpoints?before=3&limit=64", status: 413, disposition: "fulfilled" },
      { sequence: 2, url: "http://127.0.0.1/api/world", status: 200, disposition: "fulfilled" },
      { sequence: 3, url: "http://127.0.0.1/api/run", status: 200, disposition: "fulfilled" },
      { sequence: 4, url: "http://127.0.0.1/api/world", status: 200, disposition: "fulfilled" },
    ] },
  };
  assert.deepEqual(
    validateEventlessOperationalAuthority(c14Evidence).positive,
    ["gap", "reconnect", "snapshot-retry", "413", "replacement", "stale-reject"],
  );
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c14Evidence,
    workload: { trace: c14Trace.filter(({ label }) => label !== "old-live-2") },
  }), /exact ordered trace/);
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c14Evidence,
    network: { requests: c14Evidence.network.requests.slice(0, 2) },
  }), /replacement run\/world/);
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c14Evidence,
    transportWitnesses: [
      c14Evidence.transportWitnesses.at(-1),
      ...c14Evidence.transportWitnesses.slice(0, -1),
    ],
  }), /contiguous|ordered lifecycle/);
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c14Evidence,
    authority: { ...c14Authority, presentation: {
      ...c14Authority.presentation,
      terminal: { ...c14Authority.presentation.terminal, runId: old0.runId },
    } },
  }), /differs from trusted fixture authority/);

  const c15 = await realFixture("C15");
  const c15Authority = trustedTerminalAuthority(c15);
  const live0 = endpoint("live", "mock-c15-v1", 0);
  const live2 = endpoint("live", "mock-c15-v1", 2);
  const live4 = endpoint("live", "mock-c15-v1", 4);
  const archive2 = endpoint(
    "archive",
    "mock-c15-v1",
    2,
    "archive:mock-c15-v1:line-1:window-2-2",
  );
  const c15Evidence = {
    chronicleId: "C15", fixture: c15, authority: c15Authority,
    workload: { trace: [
      traceEntry("archive-live-isolation", "live-0", live0, live0, false),
      traceEntry("archive-live-isolation", "live-2", live2, live2, false),
      traceEntry("archive-live-isolation", "archive-2", archive2, live2, false),
      traceEntry("archive-live-isolation", "archive-2-live-4", archive2, live4, false),
      traceEntry("archive-live-isolation", "terminal-live-4", live4, live4, true),
    ] },
    transportWitnesses: [
      transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: live0.runId, sourceCursor: 0 }),
      transportEntry({
        sequence: 2, kind: "envelope", sourceId: 1, sourceRunId: live0.runId,
        sourceCursor: 0, cursor: 2, overflow: true, snapshotRequired: true,
        envelope: { schema: 1, cursor: 0, oldest_cursor: 0, next_cursor: 2, events: [], overflow: true, snapshot_required: true },
      }),
      transportEntry({ sequence: 3, kind: "close", sourceId: 1, sourceRunId: live0.runId, sourceCursor: 0 }),
      transportEntry({ sequence: 4, kind: "open", sourceId: 2, sourceRunId: live0.runId, sourceCursor: 2 }),
      transportEntry({
        sequence: 5, kind: "envelope", sourceId: 2, sourceRunId: live0.runId,
        sourceCursor: 2, cursor: 4, overflow: true, snapshotRequired: true,
        envelope: { schema: 1, cursor: 2, oldest_cursor: 2, next_cursor: 4, events: [], overflow: true, snapshot_required: true },
      }),
      transportEntry({ sequence: 6, kind: "close", sourceId: 2, sourceRunId: live0.runId, sourceCursor: 2 }),
      transportEntry({ sequence: 7, kind: "open", sourceId: 3, sourceRunId: live0.runId, sourceCursor: 4 }),
      transportEntry({ sequence: 8, kind: "close", sourceId: 3, sourceRunId: live0.runId, sourceCursor: 4 }),
    ],
    terminalObservation: {
      activeSceneCount: 0, pendingMoments: 0, presentedCursor: 4,
      observerFrameIdentity: { runId: live4.runId, sourceKey: live4.sourceKey },
    },
    network: { requests: [] },
  };
  assert.deepEqual(validateEventlessOperationalAuthority(c15Evidence).positive,
    ["observer-frame", "isolated-sessions", "bounded-live-ingestion"]);
  const reboundToClosedSource = structuredClone(c15Evidence);
  for (const index of [4, 5]) {
    reboundToClosedSource.transportWitnesses[index].sourceId = 1;
    reboundToClosedSource.transportWitnesses[index].url = "/api/events/stream?cursor=0";
  }
  assert.throws(
    () => validateEventlessOperationalAuthority(reboundToClosedSource),
    /bound to each exact Live source/,
  );
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c15Evidence,
    terminalObservation: { ...c15Evidence.terminalObservation, presentedCursor: 0 },
  }), /presentation terminal/);
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c15Evidence,
    transportWitnesses: [
      ...c15Evidence.transportWitnesses.slice(0, 1),
      { ...c15Evidence.transportWitnesses[1], eventCount: 1 },
      ...c15Evidence.transportWitnesses.slice(2),
    ],
  }), /may not fabricate mechanic event witnesses/);
  assert.throws(() => validateEventlessOperationalAuthority({
    ...c15Evidence,
    fixture: {
      ...c15,
      expectedTerminal: {
        ...c15.expectedTerminal,
        semanticOracle: { ...c15.expectedTerminal.semanticOracle, positive: ["unproven"] },
      },
    },
    authority: trustedTerminalAuthority({
      ...c15,
      expectedTerminal: {
        ...c15.expectedTerminal,
        semanticOracle: { ...c15.expectedTerminal.semanticOracle, positive: ["unproven"] },
      },
    }),
  }), /claims differ from operationally proven claims/);
});

test("C14 cursor evidence keeps zero mechanic truth separate from checkpoint presentation lineage", async () => {
  const fixture = await realFixture("C14");
  const authority = trustedTerminalAuthority(fixture);
  const old0 = endpoint("live", "mock-c14-v1", 0);
  const old2 = endpoint("live", "mock-c14-v1", 2);
  const old3 = endpoint("live", "mock-c14-v1", 3);
  const replacement0 = endpoint("live", "mock-c14-v1-replacement", 0);
  const workload = { trace: [
    traceEntry("transport-recovery", "old-live-0", old0, old0, false),
    traceEntry("transport-recovery", "old-live-2", old2, old2, false),
    traceEntry("transport-recovery", "old-live-3", old3, old3, false),
    traceEntry("transport-recovery", "replacement-live-0", replacement0, replacement0, false),
    traceEntry("transport-recovery", "stale-old-run-rejected", replacement0, replacement0, true),
  ] };
  const cursorSample = (frameIndex, authoritativeCursor, endpointValue, phase) => ({
    frameIndex,
    authoritativeCursor,
    acceptedCursor: endpointValue.cursor,
    presentedCursor: endpointValue.cursor,
    publicCursor: endpointValue.cursor,
    phase,
    runId: endpointValue.runId,
    sourceKey: endpointValue.sourceKey,
  });
  const validSamples = [
    cursorSample(0, 0, old0, "running"),
    cursorSample(1, 2, old2, "running"),
    cursorSample(2, 3, old3, "running"),
    cursorSample(3, 0, replacement0, "running"),
    cursorSample(4, 0, replacement0, "settled"),
  ];
  const evidence = buildCursorEvidence(
    { schemaVersion: 1, chronicleId: "C14", viewport: "desktop" },
    { samples: validSamples, gaps: [] },
    0,
    authority,
    workload,
  );
  assert.equal(evidence.samples[1].authoritativeCursor, 2);
  assert.equal(evidence.samples[1].presentedCursor, 2);
  assert.equal(evidence.verdict.exactReplacementLineage, true);

  const crossPhase = structuredClone({ samples: validSamples, gaps: [] });
  crossPhase.samples[1].authoritativeCursor = 0;
  assert.throws(() => buildCursorEvidence(
    { schemaVersion: 1, chronicleId: "C14", viewport: "desktop" },
    crossPhase,
    0,
    authority,
    workload,
  ), /exact operational presentation lineage/);

  const missingCheckpoint = structuredClone({ samples: validSamples, gaps: [] });
  missingCheckpoint.samples.splice(1, 1);
  assert.throws(() => buildCursorEvidence(
    { schemaVersion: 1, chronicleId: "C14", viewport: "desktop" },
    missingCheckpoint,
    0,
    authority,
    workload,
  ), /exact operational presentation lineage/);
});

test("baseline emits exactly nine deterministic normalized sidecars", async () => {
  const first = await buildViewportEvidence(makeInput());
  const second = await buildViewportEvidence(makeInput());
  assert.deepEqual(Object.keys(first).sort(), [...EVIDENCE_SIDECAR_FILES].sort());
  assert.deepEqual(first, second);
  assert.equal(first["performance.json"].verdict.passed, true);
  assert.deepEqual(first["semantic.json"].operationalWorkload, { trace: [] });
  assert.deepEqual(first["semantic.json"].transportWitnesses, []);
  assert.equal(first["source-revision.json"].fixture.sha256, sha256Buffer(await readFile(path.join(TRUSTED_ROOT, "fixtures", "C03.json"))));
  await assert.rejects(() => buildViewportEvidence(mutate(makeInput(), (value) => {
    value.semantic.terminalAuthority.presentation.terminal.cursor = 0;
  })), /raw terminal authority differs/);
});

test("trusted authority and returned evidence are deeply isolated and immutable", async () => {
  const mutableConfig = structuredClone(TRUSTED_CONFIG);
  const isolated = createChronicleEvidenceOracle(mutableConfig);
  const first = await isolated.buildViewportEvidence(makeInput());
  assert.throws(() => first["source-revision.json"].closure.files.splice(0, 1), TypeError);
  assert.throws(() => { first["network.json"].requests[0].url = "http://attacker.invalid/"; }, TypeError);
  mutableConfig.requestSummaries["C03/desktop"].observedCount = 999;
  mutableConfig.requestSummaries["C03/desktop"].ledgerSha256 = "f".repeat(64);
  const second = await isolated.buildViewportEvidence(makeInput());
  assert.deepEqual(second["source-revision.json"], first["source-revision.json"]);
  assert.deepEqual(second["network.json"], first["network.json"]);
});

test("production resource caps and all fixture Graph populations are oracle-owned", async () => {
  assert.throws(() => createChronicleEvidenceOracle({ ...TRUSTED_CONFIG, resourceCaps: { maxWaiters: 9_999, maxInFlight: 9_999 } }), /resourceCaps are oracle-owned/);
  const vacantActors = mutate(makeInput("C03"), (value) => { value.performance.lifecycle.graphActors = counter(0); });
  await assert.rejects(() => buildViewportEvidence(vacantActors), /Graph actor activity must match canonical fixture/);
  const vacantEnvironment = mutate(makeInput("C03"), (value) => { value.performance.lifecycle.graphEnvironments = counter(0); });
  await assert.rejects(() => buildViewportEvidence(vacantEnvironment), /Graph environment activity must be non-vacuous/);
});

test("producer-authored Graph lifecycle oracles reject neighboring capture counts", async () => {
  for (const chronicleId of ["C05", "C09", "C11", "C12"]) {
    await buildViewportEvidence(makeInput(chronicleId));
  }

  const rejected = [
    ["C05", "actors", 5, 4],
    ["C11", "actors", 3, 3],
    ["C11", "actors", 5, 4],
    ["C09", "homes", 8, 3],
    ["C09", "homes", 10, 3],
    ["C09", "homes", 9, 4],
    ["C12", "homes", 2, 1],
  ];
  for (const [chronicleId, family, created, peak] of rejected) {
    const input = mutate(makeInput(chronicleId), (value) => {
      value.performance.lifecycle[family === "actors" ? "graphActors" : "graphHomes"] = counter(created, peak);
    });
    await assert.rejects(
      () => buildViewportEvidence(input),
      new RegExp(`authored Graph ${family === "actors" ? "actor" : "home"} lifecycle`),
    );
  }
});

test("C09 authored home visibility schedule rejects same-region churn and a missing remount", async () => {
  await buildViewportEvidence(makeInput("C09"));

  const churn = mutate(makeInput("C09"), (value) => {
    const first = value.motion.homeOwnershipSegments[0];
    first.lastFrameIndex = 0;
    value.motion.homeOwnershipSegments.splice(1, 0, {
      ...structuredClone(first),
      firstFrameIndex: 1,
      lastFrameIndex: 20,
      homes: first.homes.map((home) => ({ ...home, instanceId: home.instanceId + 100 })),
    });
  });
  await assert.rejects(
    () => buildViewportEvidence(churn),
    /home visibility segment schedule|home ownership instances/,
  );

  const missingRemount = mutate(makeInput("C09"), (value) => {
    const [removed] = value.motion.homeOwnershipSegments.splice(3, 1);
    value.motion.homeOwnershipSegments[2].lastFrameIndex = removed.lastFrameIndex;
  });
  await assert.rejects(
    () => buildViewportEvidence(missingRemount),
    /home visibility segment schedule/,
  );

  const reusedInstance = mutate(makeInput("C09"), (value) => {
    value.motion.homeOwnershipSegments[2].homes[0].instanceId =
      value.motion.homeOwnershipSegments[0].homes[0].instanceId;
  });
  await assert.rejects(
    () => buildViewportEvidence(reusedInstance),
    /home ownership instances differ from authored lifecycle/,
  );
});

test("C09 lifecycle authority binds created homes to authored visibility occurrences", async () => {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", "C09.json");
  const original = await readFile(fixturePath);
  try {
    const inconsistent = JSON.parse(original);
    inconsistent.expectedTerminal.graphLifecycleOracle.homes.created = 8;
    await writeFile(fixturePath, canonicalJson(inconsistent));
    await assert.rejects(
      () => createChronicleEvidenceOracle(TRUSTED_CONFIG)
        .buildViewportEvidence(makeInput("C09")),
      /Graph homes created must equal authored visibility occurrences/,
    );
  } finally {
    await writeFile(fixturePath, original);
  }
});

test("production navigation is immutable exact /?renderer=2d", async () => {
  const wrongPath = mutate(makeInput(), (value) => { value.network.requests[0].url = "http://127.0.0.1:4173/review?renderer=2d"; });
  await assert.rejects(() => buildViewportEvidence(wrongPath), /production navigation must be exact/);
  const extraQuery = mutate(makeInput(), (value) => { value.network.requests[0].url += "&debug=true"; });
  await assert.rejects(() => buildViewportEvidence(extraQuery), /production navigation must be exact/);
});

test("media and marker sidecars must validate actual bytes, probes, still hashes, and order", async () => {
  const directory = path.join(TRUSTED_ROOT, "artifacts", MOTION_ARTIFACTS["C03/desktop/standard"]);
  const recordingPath = path.join(directory, "recording.json");
  const reducedRecordingPath = path.join(directory, "reduced-recording.json");
  const markerPath = path.join(directory, "markers.json");
  const originalRecording = await readFile(recordingPath);
  const originalReducedRecording = await readFile(reducedRecordingPath);
  const originalMarkers = await readFile(markerPath);
  try {
    let recording = JSON.parse(originalRecording);
    recording.video.webm.probe.frameCount = 2;
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /WebM probe mismatch for frameCount/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.frames = [];
    recording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(recording.frames)));
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /frame ledger length mismatch/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.timelineSha256 = "f".repeat(64);
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /frame ledger hash drift/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.frames[0].presentationTimeMs = 1;
    recording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(recording.frames)));
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /frame ledger timing drift/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.frames[0].frameIndex = 1;
    recording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(recording.frames)));
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /frame ledger timing drift/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.frames[0].observerFrameIdentity.revision += 1;
    recording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(recording.frames)));
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /frame acceptance drift/);
    await writeFile(recordingPath, originalRecording);

    recording = JSON.parse(originalRecording);
    recording.frames[0].canvasFrameIdentity.sourceKey = "";
    recording.frames[0].observerFrameIdentity.sourceKey = "";
    recording.timelineSha256 = sha256Buffer(Buffer.from(canonicalJson(recording.frames)));
    await writeFile(recordingPath, canonicalJson(recording));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /sourceKey must be nonblank/);
    await writeFile(recordingPath, originalRecording);

    const markers = JSON.parse(originalMarkers);
    markers.observed.reverse();
    await writeFile(markerPath, canonicalJson(markers));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /markers artifact order must bind captured marker order/);
    await writeFile(markerPath, originalMarkers);

    markers.observed.reverse();
    markers.observed[0].still.sha256 = "f".repeat(64);
    await writeFile(markerPath, canonicalJson(markers));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /marker still.*hash mismatch/);
    await writeFile(markerPath, originalMarkers);

    const foreignStill = path.join(directory, "markers", "reduced-000000.png");
    markers.observed[0].still = await artifactReference(foreignStill, "markers/reduced-000000.png");
    await writeFile(markerPath, canonicalJson(markers));
    await assert.rejects(() => buildViewportEvidence(makeInput()), /marker.*does not match its exact frame ledger/);
    await writeFile(markerPath, originalMarkers);

    const detachedMarkers = JSON.parse(originalMarkers);
    const detachedFinal = detachedMarkers.observed.find(({ expectedMarker }) => (
      expectedMarker === "checkpoint:final"
    ));
    detachedFinal.frameIndex -= 1;
    detachedFinal.mediaTimeMs = detachedFinal.frameIndex * 1000 / 30;
    detachedFinal.presentationTimeMs = detachedFinal.frameIndex * 1000 / 30;
    await writeFile(markerPath, canonicalJson(detachedMarkers));
    await assert.rejects(
      () => buildViewportEvidence(makeInput()),
      /standard recording marker checkpoint:final differs from semantic marker frame/,
    );
    await writeFile(markerPath, originalMarkers);

    await writeFile(reducedRecordingPath, originalRecording);
    await assert.rejects(() => buildViewportEvidence(makeInput()), /does not match its exact frame ledger/);
  } finally {
    await writeFile(recordingPath, originalRecording);
    await writeFile(reducedRecordingPath, originalReducedRecording);
    await writeFile(markerPath, originalMarkers);
  }
});

test("pure adapter converts and cross-checks real production capture ledger shapes", async () => {
  const { network: _network, ...facts } = makeInput("C03", "desktop");
  const routeLedger = [
    { requestId: 7, sequence: 1, handler: "run", method: "GET", path: "/api/run", disposition: "fulfilled", status: 200 },
    { requestId: 8, sequence: 2, handler: "raw-artifact-reject", method: "GET", path: "/api/replay/artifacts/events", disposition: "rejected", status: 0 },
  ];
  const observedRoutes = routeLedger.map((entry) => ({
    requestId: entry.requestId,
    sequence: entry.sequence,
    method: entry.method,
    path: entry.path,
  }));
  const capture = {
    ...facts,
    applicationOrigin: "http://127.0.0.1:4173",
    navigation: { method: "GET", path: "/?renderer=2d", disposition: "fulfilled", status: 200 },
    requests: { routeLedger, observedRoutes },
  };
  const converted = convertProductionCaptureToOracleInput(capture);
  assert.deepEqual(converted.network.requests.map(({ handler }) => handler), ["vite-navigation", "api-fixture", "raw-artifact-rejection"]);
  const requestSummary = {
    observedCount: converted.network.requests.length,
    ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(converted.network.requests))),
  };
  const adaptedOracle = createChronicleEvidenceOracle({
    ...TRUSTED_CONFIG,
    requestSummaries: { "C03/desktop": requestSummary },
  });
  assert.equal((await adaptedOracle.buildViewportEvidence(converted))["network.json"].verdict.accounted, true);
  const mismatched = structuredClone(capture);
  mismatched.requests.observedRoutes[0].path = "/api/world";
  assert.throws(() => convertProductionCaptureToOracleInput(mismatched), /observed route mismatch/);

  const externalRuntime = structuredClone(capture);
  externalRuntime.requests.runtimeRequests = [
    ...converted.network.requests,
    {
      sequence: 4,
      kind: "source",
      method: "GET",
      url: "https://evil.example/x",
      handler: "production-source",
      status: 200,
      disposition: "fulfilled",
      responseStatus: 200,
      terminal: "finished",
      failureText: null,
    },
  ];
  const externalConverted = convertProductionCaptureToOracleInput(externalRuntime);
  assert.equal(externalConverted.network.requests.at(-1).url, "https://evil.example/x");
  const externalOracle = createChronicleEvidenceOracle({
    ...TRUSTED_CONFIG,
    requestSummaries: { "C03/desktop": {
      observedCount: externalConverted.network.requests.length,
      ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(externalConverted.network.requests))),
    } },
  });
  await assert.rejects(() => externalOracle.buildViewportEvidence(externalConverted), /external origin/);
});

test("production capture adapter binds duplicate API observations by route occurrence", () => {
  const { network: _network, ...facts } = makeInput("C03", "desktop");
  const routeLedger = [
    { requestId: 7, sequence: 1, handler: "run", method: "GET", path: "/api/run", disposition: "fulfilled", status: 200 },
    { requestId: 8, sequence: 2, handler: "replay-manifest", method: "GET", path: "/api/replay/manifest", disposition: "fulfilled", status: 200 },
    { requestId: 9, sequence: 3, handler: "replay-manifest", method: "GET", path: "/api/replay/manifest", disposition: "fulfilled", status: 200 },
    { requestId: 10, sequence: 4, handler: "world", method: "GET", path: "/api/world", disposition: "fulfilled", status: 200 },
  ];
  const observedRoutes = routeLedger.map((entry) => ({
    requestId: entry.requestId,
    sequence: entry.sequence,
    method: entry.method,
    path: entry.path,
  }));
  const runtimeRequests = [
    { sequence: 1, kind: "navigation", method: "GET", url: "http://127.0.0.1:4173/?renderer=2d", handler: "vite-navigation", status: 200, disposition: "fulfilled" },
    { sequence: 2, kind: "source", method: "GET", url: "http://127.0.0.1:4173/src/main.tsx", handler: "production-source", status: 200, disposition: "fulfilled" },
    { sequence: 3, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/run", handler: "api-fixture", status: 200, disposition: "fulfilled" },
    { sequence: 4, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/replay/manifest", handler: "api-fixture", status: 200, disposition: "fulfilled" },
    { sequence: 5, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/replay/manifest", handler: "api-fixture", status: 200, disposition: "fulfilled" },
    { sequence: 6, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/world", handler: "api-fixture", status: 200, disposition: "fulfilled" },
  ];
  const capture = {
    ...facts,
    applicationOrigin: "http://127.0.0.1:4173",
    navigation: { method: "GET", path: "/?renderer=2d", disposition: "fulfilled", status: 200 },
    requests: { routeLedger, observedRoutes, runtimeRequests },
  };

  const converted = convertProductionCaptureToOracleInput(capture);

  assert.deepEqual(converted.network.requests, runtimeRequests);
});

test("production capture adapter rejects missing or extra API observations", () => {
  const { network: _network, ...facts } = makeInput("C03", "desktop");
  const routeLedger = [
    { requestId: 7, sequence: 1, handler: "run", method: "GET", path: "/api/run", disposition: "fulfilled", status: 200 },
    { requestId: 8, sequence: 2, handler: "replay-manifest", method: "GET", path: "/api/replay/manifest", disposition: "fulfilled", status: 200 },
  ];
  const observedRoutes = routeLedger.map((entry) => ({
    requestId: entry.requestId,
    sequence: entry.sequence,
    method: entry.method,
    path: entry.path,
  }));
  const runtimeRequests = [
    { sequence: 1, kind: "navigation", method: "GET", url: "http://127.0.0.1:4173/?renderer=2d", handler: "vite-navigation", status: 200, disposition: "fulfilled" },
    { sequence: 2, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/run", handler: "api-fixture", status: 200, disposition: "fulfilled" },
    { sequence: 3, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/replay/manifest", handler: "api-fixture", status: 200, disposition: "fulfilled" },
  ];
  const capture = {
    ...facts,
    applicationOrigin: "http://127.0.0.1:4173",
    navigation: { method: "GET", path: "/?renderer=2d", disposition: "fulfilled", status: 200 },
    requests: { routeLedger, observedRoutes, runtimeRequests },
  };
  const missing = structuredClone(capture);
  missing.requests.runtimeRequests.pop();
  const extra = structuredClone(capture);
  extra.requests.runtimeRequests.push({
    sequence: 4, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/replay/manifest",
    handler: "api-fixture", status: 200, disposition: "fulfilled",
  });

  assert.throws(() => convertProductionCaptureToOracleInput(missing), /API observation count/);
  assert.throws(() => convertProductionCaptureToOracleInput(extra), /API observation count/);
});

test("production capture adapter rejects reordered or status-mismatched API observations", () => {
  const { network: _network, ...facts } = makeInput("C03", "desktop");
  const routeLedger = [
    { requestId: 7, sequence: 1, handler: "run", method: "GET", path: "/api/run", disposition: "fulfilled", status: 200 },
    { requestId: 8, sequence: 2, handler: "world", method: "GET", path: "/api/world", disposition: "fulfilled", status: 200 },
  ];
  const observedRoutes = routeLedger.map((entry) => ({
    requestId: entry.requestId,
    sequence: entry.sequence,
    method: entry.method,
    path: entry.path,
  }));
  const runtimeRequests = [
    { sequence: 1, kind: "navigation", method: "GET", url: "http://127.0.0.1:4173/?renderer=2d", handler: "vite-navigation", status: 200, disposition: "fulfilled" },
    { sequence: 2, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/run", handler: "api-fixture", status: 200, disposition: "fulfilled" },
    { sequence: 3, kind: "api", method: "GET", url: "http://127.0.0.1:4173/api/world", handler: "api-fixture", status: 200, disposition: "fulfilled" },
  ];
  const capture = {
    ...facts,
    applicationOrigin: "http://127.0.0.1:4173",
    navigation: { method: "GET", path: "/?renderer=2d", disposition: "fulfilled", status: 200 },
    requests: { routeLedger, observedRoutes, runtimeRequests },
  };
  const reordered = structuredClone(capture);
  [reordered.requests.runtimeRequests[1], reordered.requests.runtimeRequests[2]] = [
    { ...reordered.requests.runtimeRequests[2], sequence: 2 },
    { ...reordered.requests.runtimeRequests[1], sequence: 3 },
  ];
  const statusMismatch = structuredClone(capture);
  statusMismatch.requests.runtimeRequests[2].status = 500;

  assert.throws(() => convertProductionCaptureToOracleInput(reordered), /API observation mismatch route 1/);
  assert.throws(() => convertProductionCaptureToOracleInput(statusMismatch), /API observation mismatch route 2/);
});

test("oracle owns exact special cursor counts and eventless zero truth", async () => {
  for (const [id, expected] of Object.entries(SPECIAL_CURSORS)) {
    const input = mutate(makeInput(id), (value) => {
      value.expectedFinalCursor = expected + 1;
      value.cursors.samples.at(-1).authoritativeCursor = expected + 1;
      value.cursors.samples.at(-1).acceptedCursor = expected + 1;
      value.cursors.samples.at(-1).presentedCursor = expected + 1;
      value.cursors.samples.at(-1).publicCursor = expected + 1;
    });
    await assert.rejects(() => buildViewportEvidence(input), new RegExp(`${id} expectedFinalCursor must be ${expected}`));
  }
});

test("C06, C07, and C09 motion evidence retains exact trusted checkpoint correction holds", async () => {
  for (const chronicleId of ["C06", "C07", "C09"]) {
    const input = makeInput(chronicleId);
    const sidecars = await buildViewportEvidence(input);
    assert.deepEqual(
      sidecars["motion.json"].checkpointWitnesses,
      input.motion.checkpointWitnesses,
    );
  }
  const ordinary = await buildViewportEvidence(makeInput("C03"));
  assert.deepEqual(
    ordinary["motion.json"].checkpointWitnesses,
    syntheticCheckpointWitnessBundle("C03", [], []),
  );
});

test("C06 checkpoint holds retain standard and reduced proof and reject contradiction", async () => {
  const input = makeInput("C06");
  const fixture = JSON.parse(await readFile(path.join(TRUSTED_ROOT, "fixtures", "C06.json")));
  assert.equal(input.expectedFinalCursor, 5);
  assert.equal(fixture.expectedFinalCursor, 5);
  assert.deepEqual(
    fixture.checkpoints.map(({ checkpoint }) => checkpoint.event_cursor),
    [3, 3, 5],
  );
  assert.deepEqual(
    input.motion.checkpointWitnesses.standard.witnesses.map(({ line }) => line),
    [1, 2],
  );
  assert.deepEqual(
    input.motion.checkpointWitnesses.reduced.witnesses.map(({ line }) => line),
    [1, 2],
  );
  const sidecars = await buildViewportEvidence(input);
  assert.deepEqual(sidecars["motion.json"].checkpointWitnesses, input.motion.checkpointWitnesses);

  const contradictory = mutate(input, (value) => {
    value.motion.checkpointWitnesses.reduced.witnesses[1].correctionEntityIds.pop();
  });
  await assert.rejects(
    () => buildViewportEvidence(contradictory),
    /C06 reduced checkpoint hold line 2.*correctionEntityIds/i,
  );
});

test("C06 checkpoint holds reject causal contradictions in standard and reduced evidence", async () => {
  const standard = mutate(makeInput("C06"), (value) => {
    const line1 = value.motion.checkpointWitnesses.standard.witnesses[0];
    value.motion.checkpointWitnesses.standard.markerFrames["event:hearth_used"]
      = line1.firstFrameIndex;
  });
  await assert.rejects(
    () => buildViewportEvidence(standard),
    /C06 standard checkpoint hold causal order/i,
  );

  const reduced = mutate(makeInput("C06"), (value) => {
    const line2 = value.motion.checkpointWitnesses.reduced.witnesses[1];
    value.motion.checkpointWitnesses.reduced.markerFrames["event:home_started_hoarding"]
      = line2.lastFrameIndex;
  });
  await assert.rejects(
    () => buildViewportEvidence(reduced),
    /C06 reduced checkpoint hold causal order/i,
  );
});

test("C06 checkpoint holds reject a normalized standard reduced semantic contradiction", async () => {
  const contradictory = mutate(makeInput("C06"), (value) => {
    const witness = value.motion.checkpointWitnesses.reduced.witnesses[0];
    witness.firstFrameIdentity.firstCursor = 1;
    witness.lastFrameIdentity.firstCursor = 1;
    for (const sample of witness.samples) sample.frameIdentity.firstCursor = 1;
  });
  await assert.rejects(
    () => buildViewportEvidence(contradictory),
    /C06 checkpoint hold standard\/reduced semantic parity/i,
  );
});

test("checkpoint correction holds reject missing, altered, abbreviated, and misordered proof", async () => {
  const rejected = [
    ["missing witness", "C07", (value) => { value.motion.checkpointWitnesses.standard.witnesses.pop(); }, /C07 standard.*checkpoint hold.*line 3/i],
    ["wrong snapshot", "C07", (value) => { value.motion.checkpointWitnesses.reduced.witnesses[0].world.agents[0].checkpoint_line = 99; }, /C07 reduced checkpoint hold line 1.*agents.*trusted snapshot/i],
    ["short duration", "C07", (value) => { value.motion.checkpointWitnesses.standard.witnesses[0].durationMs = 799; }, /C07 standard checkpoint hold line 1.*durationMs.*800/i],
    ["short sample coverage", "C07", (value) => { value.motion.checkpointWitnesses.reduced.witnesses[0].sampleCount = 23; }, /C07 reduced checkpoint hold line 1.*30Hz sample coverage/i],
    ["wrong causal ordering", "C07", (value) => { value.motion.checkpointWitnesses.reduced.markerFrames["event:home_breached"] = 158; }, /C07 reduced.*checkpoint hold causal order/i],
    ["wrong correction IDs", "C07", (value) => { value.motion.checkpointWitnesses.standard.witnesses[1].correctionEntityIds.pop(); }, /C07 standard checkpoint hold line 2.*correctionEntityIds/i],
    ["wrong cursor", "C09", (value) => { value.motion.checkpointWitnesses.reduced.witnesses[1].eventCursor -= 1; }, /C09 reduced checkpoint hold line 2.*eventCursor/i],
    ["wrong world time", "C09", (value) => { value.motion.checkpointWitnesses.standard.witnesses[0].worldTime += 1; }, /C09 standard checkpoint hold line 1.*worldTime/i],
    ["wrong presented cursor", "C09", (value) => { value.motion.checkpointWitnesses.reduced.witnesses[0].presentedCursor += 1; }, /C09 reduced checkpoint hold line 1.*presentedCursor/i],
    ["coalesced collapse occurrences", "C09", (value) => {
      value.motion.checkpointWitnesses.standard.markerFrames["event:home_collapsed@cursor:2"]
        = value.motion.checkpointWitnesses.standard.markerFrames["event:home_collapsed@cursor:1"];
    }, /C09 standard.*checkpoint hold causal order/i],
    ["coalesced scavenge occurrences", "C09", (value) => {
      value.motion.checkpointWitnesses.reduced.markerFrames["event:ruins_scavenged@cursor:6"]
        = value.motion.checkpointWitnesses.reduced.markerFrames["event:ruins_scavenged@cursor:5"];
    }, /C09 reduced.*checkpoint hold causal order/i],
    ["wrong frame identity", "C09", (value) => { value.motion.checkpointWitnesses.standard.witnesses[1].lastFrameIdentity.lastCursor -= 1; }, /C09 standard checkpoint hold line 2.*frame identity/i],
    ["wrong line 3 correction IDs", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[2].correctionEntityIds.pop();
    }, /C07 reduced checkpoint hold line 3.*correctionEntityIds/i],
    ["wrong line 3 cursor", "C07", (value) => {
      value.motion.checkpointWitnesses.standard.witnesses[2].eventCursor -= 1;
    }, /C07 standard checkpoint hold line 3.*eventCursor.*trusted checkpoint/i],
    ["wrong line 3 world", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[2]
        .world.homes[0].integrity = 99;
    }, /C07 reduced checkpoint hold line 3.*homes.*trusted snapshot/i],
    ["line 3 invented sweep", "C07", (value) => {
      const witness = value.motion.checkpointWitnesses.standard.witnesses[2];
      for (const sample of witness.samples) {
        sample.focusTarget.removed = true;
        sample.homes = [];
      }
    }, /C07 standard checkpoint hold line 3.*focus target 0.*region/i],
    ["intra-segment revision churn", "C09", (value) => {
      value.motion.checkpointWitnesses.standard.witnesses[0]
        .samples[1].frameIdentity.revision += 1;
    }, /C09 standard checkpoint hold line 1.*segment 0.*revision.*stable/i],
    ["intra-segment source lineage churn", "C09", (value) => {
      const witness = value.motion.checkpointWitnesses.standard.witnesses[0];
      witness.samples[1].frameIdentity.sourceKey = `replacement:${witness.firstFrameIdentity.runId}`;
    }, /C09 standard checkpoint hold line 1.*frame lineage.*stable/i],
    ["intra-segment publication churn", "C09", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[0]
        .samples[1].publicationSerial += 1;
    }, /C09 reduced checkpoint hold line 1.*segment 0.*publication.*stable/i],
    ["missing boundary publication", "C09", (value) => {
      const samples = value.motion.checkpointWitnesses.reduced.witnesses[0].samples;
      for (const sample of samples.slice(24, 48)) {
        sample.publicationSerial = samples[0].publicationSerial;
      }
    }, /C09 reduced checkpoint hold line 1.*boundary 1.*publication/i],
    ["missing boundary revision", "C09", (value) => {
      const samples = value.motion.checkpointWitnesses.standard.witnesses[0].samples;
      for (const sample of samples.slice(24, 48)) {
        sample.frameIdentity.revision = samples[0].frameIdentity.revision;
      }
    }, /C09 standard checkpoint hold line 1.*boundary 1.*revision.*publication/i],
    ["boundary first-cursor lineage churn", "C09", (value) => {
      const samples = value.motion.checkpointWitnesses.reduced.witnesses[0].samples;
      for (const sample of samples.slice(24, 48)) {
        sample.frameIdentity.firstCursor = 0;
      }
    }, /C09 reduced checkpoint hold line 1.*frame lineage.*stable/i],
    ["hidden extra boundary publication", "C09", (value) => {
      const witness = value.motion.checkpointWitnesses.standard.witnesses[1];
      const samples = witness.samples;
      for (const sample of samples.slice(24, 48)) {
        sample.frameIdentity.revision += 1;
        sample.publicationSerial += 1;
      }
      witness.lastFrameIdentity.revision += 1;
    }, /C09 standard checkpoint hold line 2.*boundary 1.*exactly one.*revision.*publication/i],
    ["line 3 before theft marker", "C07", (value) => {
      value.motion.checkpointWitnesses.standard.markerFrames["event:home_thieved"] = 90;
    }, /C07 standard.*causal order.*home_thieved.*line3/i],
    ["final marker at line 3 last frame", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.markerFrames["checkpoint:final"] = 213;
    }, /C07 reduced.*causal order.*line3\.last.*checkpoint:final/i],
    ["final marker before line 3 last frame", "C07", (value) => {
      value.motion.checkpointWitnesses.standard.markerFrames["checkpoint:final"] = 112;
    }, /C07 standard.*causal order.*line3\.last.*checkpoint:final/i],
    ["final marker at line 2 last frame", "C09", (value) => {
      value.motion.checkpointWitnesses.standard.markerFrames["checkpoint:final"] = 147;
    }, /C09 standard.*causal order.*line2\.last.*checkpoint:final/i],
    ["intervening cursor", "C07", (value) => {
      value.motion.frames.find(({ frameIndex }) => frameIndex === 20).cursor = 3;
    }, /C07 standard checkpoint hold line 1.*contiguously bound/i],
    ["remaining is not monotonic", "C07", (value) => {
      const samples = value.motion.checkpointWitnesses.standard.witnesses[0].samples;
      samples[1].remainingMs = samples[0].remainingMs;
    }, /C07 standard checkpoint hold line 1.*elapsed.*remaining.*monotonic/i],
    ["wrong rendered durable state", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[0]
        .samples[0].homes[0].durable.integrityRatio = 0.99;
    }, /C07 reduced checkpoint hold line 1.*rendered home_c07.*trusted checkpoint/i],
    ["corrected shelter outside safe frame", "C09", (value) => {
      for (const sample of value.motion.checkpointWitnesses.standard.witnesses[0].samples) {
        sample.safeFrame = { x: 500, y: 500, width: 500, height: 300 };
        for (const home of sample.homes) home.safeFrameVisible = false;
      }
    }, /C09 standard checkpoint hold line 1.*continuous.*home_repair.*24 samples/i],
    ["corrected shelter readable for only one sample", "C09", (value) => {
      const witness = value.motion.checkpointWitnesses.standard.witnesses[0];
      for (const sample of witness.samples.slice(1, 24)) {
        sample.safeFrame = { x: 500, y: 500, width: 500, height: 300 };
        const target = sample.homes.find(({ id }) => id === sample.focusTarget.entityId);
        target.safeFrameVisible = false;
      }
    }, /C09 standard checkpoint hold line 1.*continuous.*home_repair.*24 samples/i],
    ["forged screen visibility", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[0]
        .samples[0].homes[0].screenVisible = false;
    }, /C07 reduced checkpoint hold line 1.*screenVisible.*geometry/i],
    ["forged screen bounds", "C07", (value) => {
      value.motion.checkpointWitnesses.standard.witnesses[0]
        .samples[0].homes[0].screenBounds.x += 1;
    }, /C07 standard checkpoint hold line 1.*screenBounds.*geometry/i],
    ["forged camera geometry", "C09", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[0]
        .samples[24].camera.rasterOrigin.x += 10;
    }, /C09 reduced checkpoint hold line 1.*screenBounds.*geometry/i],
    ["forged viewport geometry", "C07", (value) => {
      value.motion.checkpointWitnesses.standard.witnesses[1]
        .samples[0].viewport.width += 1;
    }, /C07 standard checkpoint hold line 2.*viewport.*capture viewport geometry/i],
    ["forged structure world bounds", "C09", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[0]
        .samples[48].homes[0].geometry.worldBounds.width += 1;
    }, /C09 reduced checkpoint hold line 1.*worldBounds.*structure geometry/i],
    ["safe frame outside viewport", "C07", (value) => {
      value.motion.checkpointWitnesses.reduced.witnesses[1]
        .samples[0].safeFrame.x = 1_000;
    }, /C07 reduced checkpoint hold line 2.*safeFrame.*viewport geometry/i],
    ["wrong focus target order", "C09", (value) => {
      for (const sample of value.motion.checkpointWitnesses.standard.witnesses[0].samples) {
        if (sample.focusTarget.segmentIndex !== 0) continue;
        sample.focusTarget = {
          ...sample.focusTarget,
          kind: "ruin",
          entityId: "home_c09",
          regionId: "nirvana",
        };
        sample.activeRegionId = "nirvana";
      }
    }, /C09 standard checkpoint hold line 1.*focus target 0.*home_repair/i],
    ["abbreviated focus segment", "C09", (value) => {
      const witness = value.motion.checkpointWitnesses.reduced.witnesses[0];
      witness.samples[23].focusTarget.segmentIndex = 1;
    }, /C09 reduced checkpoint hold line 1.*focus target 0.*home_repair/i],
    ["focus segment phase drift", "C09", (value) => {
      const samples = value.motion.checkpointWitnesses.standard.witnesses[0].samples;
      for (const sample of samples.slice(24, 48)) {
        sample.focusTarget.segmentElapsedMs += 1;
        sample.focusTarget.segmentRemainingMs -= 1;
      }
    }, /C09 standard checkpoint hold line 1.*focus target 1.*complete 800ms segment timing/i],
    ["focus segment cadence drift", "C09", (value) => {
      const sample = value.motion.checkpointWitnesses.reduced.witnesses[0].samples[25];
      sample.focusTarget.segmentElapsedMs += 1;
      sample.focusTarget.segmentRemainingMs -= 1;
    }, /C09 reduced checkpoint hold line 1.*focus target 1.*complete 800ms segment timing/i],
    ["silent ruin sweep not rendered", "C09", (value) => {
      const bundle = value.motion.checkpointWitnesses.reduced;
      const ghost = structuredClone(bundle.witnesses[0].samples[0].homes[0]);
      for (const sample of bundle.witnesses[1].samples) sample.homes.push(ghost);
    }, /C09 reduced checkpoint hold line 2.*renderer home partition/i],
    ["normalized semantic parity", "C09", (value) => {
      const witness = value.motion.checkpointWitnesses.reduced.witnesses[0];
      witness.firstFrameIdentity.firstCursor = 0;
      witness.lastFrameIdentity.firstCursor = 0;
      for (const sample of witness.samples) {
        sample.frameIdentity.firstCursor = 0;
      }
    }, /C09 checkpoint hold standard\/reduced semantic parity/i],
  ];
  for (const [label, chronicleId, mutation, expectation] of rejected) {
    await assert.rejects(
      () => buildViewportEvidence(mutate(makeInput(chronicleId), mutation)),
      expectation,
      label,
    );
  }

  const untrustedExtra = mutate(makeInput("C03"), (value) => {
    value.motion.checkpointWitnesses.standard = structuredClone(
      makeInput("C07").motion.checkpointWitnesses.standard,
    );
  });
  await assert.rejects(
    () => buildViewportEvidence(untrustedExtra),
    /C03 standard checkpoint holds must be empty/i,
  );
});

test("C16 derives max density from four exact full placement observations", async () => {
  const empty = mutate(makeInput("C16"), (value) => { value.motion.placementCheckpoints[0].placements = {}; });
  await assert.rejects(() => buildViewportEvidence(empty), /C16 density.*256 actors and 128 homes/);
  const missingEntity = mutate(makeInput("C16"), (value) => { delete value.motion.placementCheckpoints[1].placements[Object.keys(value.motion.placementCheckpoints[1].placements)[0]]; });
  await assert.rejects(() => buildViewportEvidence(missingEntity), /C16 density.*256 actors and 128 homes/);
  const moved = mutate(makeInput("C16"), (value) => {
    value.motion.placementCheckpoints[2].placements["actor:pressure_000"] = "f".repeat(64);
    value.motion.frames[2].placementHash = sha256Buffer(Buffer.from(canonicalJson(value.motion.placementCheckpoints[2].placements)));
  });
  await assert.rejects(() => buildViewportEvidence(moved), /unstable placement actor:pressure_000/);
  const unbound = mutate(makeInput("C16"), (value) => { value.motion.frames[1].placementHash = "f".repeat(64); });
  await assert.rejects(() => buildViewportEvidence(unbound), /placement frame hash mismatch at cursor 2048/);
  const invented = mutate(makeInput("C16"), (value) => {
    for (const checkpoint of value.motion.placementCheckpoints) {
      checkpoint.placements = Object.fromEntries(Object.entries(checkpoint.placements).map(([id, hash]) => [id.replace("pressure", "invented"), hash]));
    }
    value.motion.frames = value.motion.placementCheckpoints.map((checkpoint, index) => ({ frameIndex: index + 1, cursor: checkpoint.cursor, activeEffects: 0, placementHash: sha256Buffer(Buffer.from(canonicalJson(checkpoint.placements))) }));
  });
  await assert.rejects(() => buildViewportEvidence(invented), /C16 placement identities must match canonical fixture/);
});

test("semantic verdict comes from trusted authority bound to measured terminal facts", async () => {
  const baseline = makeInput();
  const evidence = await buildViewportEvidence(baseline);
  assert.deepEqual(
    evidence["semantic.json"].terminalCameraWitness,
    baseline.semantic.terminalCameraWitness,
  );
  const misaligned = mutate(makeInput(), (value) => { value.semantic.terminalObservation.canvasFrameIdentity.revision += 1; });
  await assert.rejects(() => buildViewportEvidence(misaligned), /frame identities differ/);
  const invented = mutate(makeInput(), (value) => { value.semantic.markers.push("event:invented"); });
  await assert.rejects(() => buildViewportEvidence(invented), /semantic markers must match trusted fixture markers/);
  const teleport = mutate(makeInput("C01"), (value) => {
    moveC01Actor(value, 1, 1_000, 100);
  });
  await assert.rejects(() => buildViewportEvidence(teleport), /trajectory teleport detected/);
  const rewrittenEvent = mutate(makeInput("C01"), (value) => {
    value.semantic.eventWitnesses[0].envelope.events[0].event.type = "invented";
  });
  await assert.rejects(() => buildViewportEvidence(rewrittenEvent), /event witnesses differ/);
});

test("terminal camera witness fails closed on absence, drift, loading, pending work, region mismatch, and unsettled actors", async () => {
  const cases = [
    ["missing", (value) => { delete value.semantic.terminalCameraWitness; }, /terminal camera witness/],
    ["short", (value) => { value.semantic.terminalCameraWitness.samples.pop(); }, /three consecutive terminal camera samples/],
    ["nonconsecutive", (value) => { value.semantic.terminalCameraWitness.samples[1].frameIndex += 3; }, /consecutive frame indexes/],
    ["marker", (value) => { value.semantic.terminalCameraWitness.markerFrameIndex -= 1; }, /checkpoint:final marker frame/],
    ["previous camera drift", (value) => { value.semantic.terminalCameraWitness.samples[0].camera.center.x += 1; }, /camera.*stable/],
    ["next camera drift", (value) => { value.semantic.terminalCameraWitness.samples[2].camera.zoom += 0.01; }, /camera.*stable/],
    ["loading", (value) => { value.semantic.terminalCameraWitness.samples[1].region.loadingRegionId = "distant"; }, /loading region.*clear/],
    ["pending story", (value) => { value.semantic.terminalCameraWitness.samples[1].camera.pendingStoryEntityId = "agent:other"; }, /pending story camera target/],
    ["pending moment", (value) => { value.semantic.terminalCameraWitness.samples[1].presentation.pendingMoments = 1; }, /terminal presentation counters/],
    ["region mismatch", (value) => { value.semantic.terminalCameraWitness.samples[1].region.visibleRegionId = "distant"; }, /active and visible region/],
    ["region drift", (value) => { value.semantic.terminalCameraWitness.samples[2].region.activeRegionId = "distant"; value.semantic.terminalCameraWitness.samples[2].region.visibleRegionId = "distant"; }, /region.*stable/],
    ["active actor", (value) => { value.semantic.terminalCameraWitness.samples[1].actors[0].activeAction = "moving"; }, /actors.*idle/],
    ["repositioning actor", (value) => { value.semantic.terminalCameraWitness.samples[1].actors[0].reposition = { phase: "fade-out", reason: "fallback", target: { x: 1, y: 2 } }; }, /actors.*idle/],
    ["actor drift", (value) => { value.semantic.terminalCameraWitness.samples[2].actors[0].position.x += 1; }, /actor state.*stable/],
  ];
  for (const [label, mutateValue, message] of cases) {
    const input = mutate(makeInput(), mutateValue);
    await assert.rejects(() => buildViewportEvidence(input), message, label);
  }
});

test("standard and reduced terminal camera witnesses require retained accepted-frame lineage", async () => {
  const rewriteStandardIdentity = (value, rewrite) => {
    for (const identity of [
      value.semantic.terminalObservation.observerFrameIdentity,
      value.semantic.terminalObservation.canvasFrameIdentity,
      value.semantic.terminalObservation.frame,
      ...value.semantic.terminalCameraWitness.samples.map(({ frameIdentity }) => frameIdentity),
      ...value.reducedMotion.standard.terminalCameraWitness.samples.map(({ frameIdentity }) => frameIdentity),
    ]) rewrite(identity);
  };
  const standardCases = [
    ["missing", (value) => { delete value.reducedMotion.standard.terminalCameraWitness; }],
    ["four-sample rewrite", (value) => {
      for (const witness of [
        value.semantic.terminalCameraWitness,
        value.reducedMotion.standard.terminalCameraWitness,
      ]) {
        const preceding = structuredClone(witness.samples[0]);
        preceding.frameIndex -= 1;
        preceding.presentationTimeMs -= 1_000 / 30;
        witness.samples.unshift(preceding);
      }
    }, /exactly three consecutive terminal camera samples/],
    ["revision-shifted", (value) => rewriteStandardIdentity(value, (identity) => { identity.revision += 1; })],
    ["firstCursor-shifted", (value) => rewriteStandardIdentity(value, (identity) => { identity.firstCursor += 1; })],
    ["coherently rewritten", (value) => rewriteStandardIdentity(value, (identity) => {
      identity.runId = "forged-run";
      identity.sourceKey = "live:forged-run";
    })],
    ["time-shifted", (value) => {
      for (const witness of [
        value.semantic.terminalCameraWitness,
        value.reducedMotion.standard.terminalCameraWitness,
      ]) {
        for (const sample of witness.samples) sample.presentationTimeMs += 1;
      }
    }],
    ["exact-base-shifted", (value) => {
      for (const witness of [
        value.semantic.terminalCameraWitness,
        value.reducedMotion.standard.terminalCameraWitness,
      ]) {
        for (const sample of witness.samples) sample.world.exactBaseCursor -= 1;
      }
    }],
    ["region-shifted", (value) => {
      for (const witness of [
        value.semantic.terminalCameraWitness,
        value.reducedMotion.standard.terminalCameraWitness,
      ]) {
        for (const sample of witness.samples) {
          sample.region.activeRegionId = "distant";
          sample.region.visibleRegionId = "distant";
        }
      }
    }],
  ];
  for (const [label, mutateValue, message = /standard terminal camera witness.*retained recording lineage/] of standardCases) {
    await assert.rejects(
      () => buildViewportEvidence(mutate(makeInput(), mutateValue)),
      message,
      `standard ${label}`,
    );
  }

  const reducedCases = [
    ["revision-shifted", (identity) => { identity.revision += 1; }],
    ["firstCursor-shifted", (identity) => { identity.firstCursor += 1; }],
    ["coherently rewritten", (identity) => {
      identity.firstCursor += 1;
      identity.revision += 7;
    }],
  ];
  for (const [label, rewrite] of reducedCases) {
    const input = mutate(makeInput(), (value) => {
      for (const sample of value.reducedMotion.reduced.terminalCameraWitness.samples) {
        rewrite(sample.frameIdentity);
      }
    });
    await assert.rejects(
      () => buildViewportEvidence(input),
      /reduced terminal camera witness.*retained recording lineage/,
      `reduced ${label}`,
    );
  }

  const reducedLineageCases = [
    ["time-shifted", (sample) => { sample.presentationTimeMs += 1; }],
    ["exact-base-shifted", (sample) => { sample.world.exactBaseCursor -= 1; }],
    ["region-shifted", (sample) => {
      sample.region.activeRegionId = "distant";
      sample.region.visibleRegionId = "distant";
    }],
  ];
  for (const [label, rewrite] of reducedLineageCases) {
    const input = mutate(makeInput(), (value) => {
      for (const sample of value.reducedMotion.reduced.terminalCameraWitness.samples) {
        rewrite(sample);
      }
    });
    await assert.rejects(
      () => buildViewportEvidence(input),
      /reduced terminal camera witness.*retained recording lineage/,
      `reduced ${label}`,
    );
  }

  const reordered = mutate(makeInput(), (value) => {
    value.reducedMotion.reduced.terminalCameraWitness.samples.reverse();
  });
  await assert.rejects(
    () => buildViewportEvidence(reordered),
    /reduced terminal camera witness.*(?:consecutive frame indexes|checkpoint:final marker frame)/,
  );
});

test("C04 non-movement trajectory rejects a continuously visible same-region teleport across metadata changes", async () => {
  const teleport = mutate(makeInput("C04"), (value) => {
    value.motion.trajectorySamples = [
      {
        frameIndex: 0,
        regionId: "warm_springs",
        phase: "shelter-building",
        actors: [{
          id: "wanderer_001",
          position: { x: 304, y: 80 },
          activeAction: "building",
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
      {
        frameIndex: 1,
        regionId: "warm_springs",
        phase: "shelter-settled",
        actors: [{
          id: "wanderer_001",
          position: { x: 336, y: 144 },
          activeAction: "idle",
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
    ];
  });

  await assert.rejects(() => buildViewportEvidence(teleport), /trajectory teleport detected for wanderer_001/);
});

test("trajectory accepts only an exact fully-transparent fallback reposition boundary", async () => {
  const safeFallback = mutate(makeInput("C04"), (value) => {
    value.motion.trajectorySamples = [
      {
        frameIndex: 0,
        regionId: "warm_springs",
        pathFallbacks: 0,
        recentMarkers: [],
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 304, y: 80 },
          activeAction: null,
          opacity: 1,
          reposition: null,
          screenVisible: false,
          safeFrameVisible: false,
        }],
      },
      {
        frameIndex: 1,
        regionId: "warm_springs",
        pathFallbacks: 1,
        recentMarkers: [],
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 304, y: 80 },
          activeAction: null,
          opacity: 0.05,
          reposition: {
            phase: "fade-out",
            reason: "fallback",
            target: { x: 1_104, y: 1_168 },
          },
          screenVisible: false,
          safeFrameVisible: false,
        }],
      },
      {
        frameIndex: 2,
        regionId: "warm_springs",
        pathFallbacks: 1,
        recentMarkers: [{ kind: "actor", actorId: "wanderer_001", marker: "repositioned", atMs: 180 }],
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 1_104, y: 1_168 },
          activeAction: null,
          opacity: 0,
          reposition: {
            phase: "fade-in",
            reason: "fallback",
            target: { x: 1_104, y: 1_168 },
          },
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
      {
        frameIndex: 3,
        regionId: "warm_springs",
        pathFallbacks: 1,
        recentMarkers: [{ kind: "actor", actorId: "wanderer_001", marker: "repositioned", atMs: 180 }],
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 1_104, y: 1_168 },
          activeAction: null,
          opacity: 0.1,
          reposition: {
            phase: "fade-in",
            reason: "fallback",
            target: { x: 1_104, y: 1_168 },
          },
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
      {
        frameIndex: 4,
        regionId: "warm_springs",
        pathFallbacks: 1,
        recentMarkers: [{ kind: "actor", actorId: "wanderer_001", marker: "repositioned", atMs: 180 }],
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 1_104, y: 1_168 },
          activeAction: null,
          opacity: 1,
          reposition: null,
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
    ];
  });

  await assert.doesNotReject(() => buildViewportEvidence(safeFallback));
  const visibleJump = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples[2].actors[0].opacity = 0.01;
  });
  await assert.rejects(
    () => buildViewportEvidence(visibleJump),
    /fallback relocation must occur at opacity zero for wanderer_001/,
  );
  const mislabeledJump = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples[2].actors[0].reposition.reason = "reduced-motion";
  });
  await assert.rejects(
    () => buildViewportEvidence(mislabeledJump),
    /fallback reposition reason must be fallback/,
  );
  const swappedActor = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples[2].actors[0].instanceId = 42;
  });
  await assert.rejects(
    () => buildViewportEvidence(swappedActor),
    /fallback reposition changed actor instance for wanderer_001/,
  );
  const incompleteFade = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples.splice(3);
  });
  await assert.rejects(
    () => buildViewportEvidence(incompleteFade),
    /fallback reposition remains active at trajectory end for wanderer_001/,
  );
  const clippedStart = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples.shift();
  });
  await assert.rejects(
    () => buildViewportEvidence(clippedStart),
    /fallback reposition was already active at trajectory start for wanderer_001/,
  );
  const missingMidpointMarker = mutate(safeFallback, (value) => {
    value.motion.trajectorySamples[2].recentMarkers = [];
  });
  await assert.rejects(
    () => buildViewportEvidence(missingMidpointMarker),
    /fallback relocation lacks its midpoint marker for wanderer_001/,
  );
  const staleMarkerSecondCycle = mutate(safeFallback, (value) => {
    const retainedMarker = structuredClone(value.motion.trajectorySamples[4].recentMarkers);
    const target = { x: 1_232, y: 1_168 };
    value.motion.trajectorySamples.push(
      {
        frameIndex: 5,
        regionId: "warm_springs",
        pathFallbacks: 2,
        recentMarkers: retainedMarker,
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: { x: 1_104, y: 1_168 },
          activeAction: null,
          opacity: 0.05,
          reposition: { phase: "fade-out", reason: "fallback", target },
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
      {
        frameIndex: 6,
        regionId: "warm_springs",
        pathFallbacks: 2,
        recentMarkers: retainedMarker,
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: target,
          activeAction: null,
          opacity: 0,
          reposition: { phase: "fade-in", reason: "fallback", target },
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
      {
        frameIndex: 7,
        regionId: "warm_springs",
        pathFallbacks: 2,
        recentMarkers: retainedMarker,
        actors: [{
          id: "wanderer_001",
          instanceId: 41,
          position: target,
          activeAction: null,
          opacity: 1,
          reposition: null,
          screenVisible: true,
          safeFrameVisible: true,
        }],
      },
    );
  });
  await assert.rejects(
    () => buildViewportEvidence(staleMarkerSecondCycle),
    /fallback relocation lacks its midpoint marker for wanderer_001/,
  );
});

test("semantic provenance partitions sparse accepted SSE truth from recovered cursor ranges", async () => {
  const c13 = (await buildViewportEvidence(makeInput("C13")))["semantic.json"];
  assert.equal(c13.eventWitnesses.length, 50);
  assert.deepEqual(c13.eventProvenance, {
    trustedCursorCount: 120,
    accepted: { count: 50, ranges: [{ fromCursor: 1, toCursor: 50 }] },
    recovered: { count: 70, ranges: [{ fromCursor: 51, toCursor: 120 }] },
  });

  const c16 = (await buildViewportEvidence(makeInput("C16")))["semantic.json"];
  assert.equal(c16.eventWitnesses.length, 200);
  assert.deepEqual(c16.eventProvenance, {
    trustedCursorCount: 4_096,
    accepted: {
      count: 200,
      ranges: [
        { fromCursor: 1, toCursor: 50 },
        { fromCursor: 1_025, toCursor: 1_074 },
        { fromCursor: 2_049, toCursor: 2_098 },
        { fromCursor: 3_073, toCursor: 3_122 },
      ],
    },
    recovered: {
      count: 3_896,
      ranges: [
        { fromCursor: 51, toCursor: 1_024 },
        { fromCursor: 1_075, toCursor: 2_048 },
        { fromCursor: 2_099, toCursor: 3_072 },
        { fromCursor: 3_123, toCursor: 4_096 },
      ],
    },
  });
});

test("semantic provenance rejects duplicate, rewritten, unexpected, and missing accepted witnesses", async () => {
  const cases = [
    ["duplicate", (value) => {
      value.semantic.eventWitnesses.push(structuredClone(value.semantic.eventWitnesses[0]));
    }, /duplicate accepted semantic event witness cursor 1/],
    ["rewritten", (value) => {
      value.semantic.eventWitnesses[0].envelope.events[0].event.payload.cursor = -1;
    }, /accepted semantic event witnesses differ from trusted fixture cursor 1/],
    ["unexpected", (value) => {
      value.semantic.eventWitnesses.push({
        kind: "envelope",
        disposition: "accepted",
        cursor: 121,
        envelope: { next_cursor: 121, events: [genericFixtureEntry(121)] },
      });
    }, /unexpected accepted semantic event witness cursor 121/],
    ["missing", (value) => {
      value.semantic.eventWitnesses = value.semantic.eventWitnesses.filter(({ cursor }) => cursor !== 50);
    }, /trusted fixture cursor 50 has no semantic provenance/],
  ];
  for (const [label, change, expected] of cases) {
    await assert.rejects(
      () => buildViewportEvidence(mutate(makeInput("C13"), change)),
      expected,
      label,
    );
  }
});

test("semantic provenance rejects shifted, overlapping, missing, and incomplete recovery gaps", async () => {
  const shifted = mutate(makeInput("C13"), (value) => {
    value.cursors.gaps[0].fromCursor = 50;
    value.cursors.samples[2].acceptedCursor = 49;
  });
  await assert.rejects(() => buildViewportEvidence(shifted), /trusted fixture cursor 50 has overlapping semantic provenance/);

  const overlap = mutate(makeInput("C13"), (value) => {
    value.cursors.gaps.push({ ...value.cursors.gaps[0] });
  });
  await assert.rejects(() => buildViewportEvidence(overlap), /overlapping cursor gaps/);

  const missingGap = mutate(makeInput("C16"), (value) => {
    value.cursors.gaps.splice(1, 1);
  });
  await assert.rejects(() => buildViewportEvidence(missingGap), /trusted fixture cursor 1075 has no semantic provenance/);

  const dropped1025 = mutate(makeInput("C16"), (value) => {
    value.semantic.eventWitnesses = value.semantic.eventWitnesses.filter(({ cursor }) => cursor !== 1_025);
  });
  await assert.rejects(() => buildViewportEvidence(dropped1025), /trusted fixture cursor 1025 has no semantic provenance/);
});

test("semantic provenance rejects non-positive and duplicate trusted fixture cursors", async () => {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", "C13.json");
  const original = await readFile(fixturePath);
  try {
    const duplicate = JSON.parse(original);
    duplicate.entries.push(structuredClone(duplicate.entries[0]));
    await writeFile(fixturePath, canonicalJson(duplicate));
    await assert.rejects(
      () => createChronicleEvidenceOracle(TRUSTED_CONFIG).buildViewportEvidence(makeInput("C13")),
      /trusted fixture event cursor 1 must be unique/,
    );

    const nonPositive = JSON.parse(original);
    nonPositive.entries[0].cursor = 0;
    await writeFile(fixturePath, canonicalJson(nonPositive));
    await assert.rejects(
      () => createChronicleEvidenceOracle(TRUSTED_CONFIG).buildViewportEvidence(makeInput("C13")),
      /trusted fixture event cursor must be positive/,
    );
  } finally {
    await writeFile(fixturePath, original);
  }
});

test("C01 motion oracle rejects off-screen, missing, incoherent, early, illegal, and unsettled travel", async () => {
  assert.deepEqual(PRODUCTION_ACTOR_VISUAL_ENVELOPE, {
    left: -37, top: -62, right: 30, bottom: 10, width: 67, height: 72,
  });
  const cases = [
    ["legacyActorBounds", (value) => {
      const sample = value.motion.trajectorySamples[1];
      const actor = sample.actors[0];
      actor.worldBounds = {
        x: actor.position.x - 16,
        y: actor.position.y - 48,
        width: 32,
        height: 48,
      };
      actor.screenBounds = {
        x: actor.worldBounds.x * sample.camera.zoom + sample.camera.rasterOrigin.x,
        y: actor.worldBounds.y * sample.camera.zoom + sample.camera.rasterOrigin.y,
        width: actor.worldBounds.width * sample.camera.zoom,
        height: actor.worldBounds.height * sample.camera.zoom,
      };
    }, /actor world bounds disagree with position/],
    ["offSafeFrame", (value) => { value.motion.trajectorySamples[1].actors[0].safeFrameVisible = false; }, /focused moving actor.*safe frame/],
    ["missingDestination", (value) => { value.motion.trajectorySamples[3].actors = []; }, /destination movement.*missing/],
    ["invalidFacing", (value) => { value.motion.trajectorySamples[1].actors[0].facing = "diagonal"; }, /invalid movement facing/],
    ["invalidAction", (value) => { value.motion.trajectorySamples[1].actors[0].activeAction = null; }, /moving actor.*action/],
    ["facingDiscontinuity", (value) => { value.motion.trajectorySamples[1].actors[0].facing = "west"; }, /movement-facing discontinuity/],
    ["wrongGate", (value) => { value.motion.regionTransitionWitnesses[0].position.x += 32; }, /arrival gate/],
    ["coherentWrongGate", (value) => {
      const witness = value.motion.regionTransitionWitnesses[0];
      witness.position = { x: 2_480, y: 1_360 };
      witness.actorPosition = { x: 2_480, y: 1_360 };
      witness.gate.tile = { column: 77, row: 42 };
      witness.gate.point = { x: 2_480, y: 1_360 };
      for (let index = 2; index < value.motion.trajectorySamples.length; index += 1) {
        const actor = value.motion.trajectorySamples[index].actors[0];
        moveC01Actor(value, index, actor.position.x - 32, actor.position.y);
      }
    }, /trusted production map recipe|directed arrival gate/],
    ["legacyUntranslatedGate", (value) => {
      const witness = value.motion.regionTransitionWitnesses[0];
      witness.position = { x: 2_000, y: 848 };
      witness.actorPosition = { x: 2_000, y: 848 };
      witness.gate.tile = { column: 62, row: 26 };
      witness.gate.point = { x: 2_000, y: 848 };
      for (let index = 2; index < value.motion.trajectorySamples.length; index += 1) {
        const actor = value.motion.trajectorySamples[index].actors[0];
        moveC01Actor(value, index, actor.position.x - 512, actor.position.y - 512);
      }
    }, /trusted production map recipe|directed arrival gate/],
    ["wrongTransitionSubject", (value) => { value.motion.regionTransitionWitnesses[0].actorId = "mae"; }, /arrival transition.*subject/],
    ["missingTransition", (value) => { value.motion.regionTransitionWitnesses = []; }, /region-transition witness/],
    ["earlyEntered", (value) => { value.motion.markerFrames["event:agent_entered_region"] = 1; }, /entered marker.*arrival transition/],
    ["teleport", (value) => { moveC01Actor(value, 1, 1_000, 100); }, /trajectory teleport detected/],
    ["forbiddenEdge", (value) => { value.motion.trajectorySamples[2].regionId = "gamma"; }, /trajectory forbidden region edge/],
    ["unstableTail", (value) => {
      value.motion.trajectorySamples[6].actors[0].activeAction = "moving";
    }, /three consecutive stable.*idle.*safe-frame-visible/],
  ];
  for (const [label, change, expected] of cases) {
    await assert.rejects(() => buildViewportEvidence(mutate(makeInput("C01"), change)), expected, label);
  }

  const evidence = await buildViewportEvidence(makeInput("C01"));
  assert.deepEqual(evidence["motion.json"].regionTransitions[0].gate, {
    role: "arrival",
    tile: { column: 78, row: 42 },
    tileSize: 32,
    point: { x: 2_512, y: 1_360 },
  });
  assert.deepEqual(evidence["motion.json"].verdict.semanticClaims, {
    "local-movement": true,
    "movement-continuity": true,
    "no-forbidden-edge": true,
    "no-teleport": true,
    "travel-legs": true,
  });
  assert.deepEqual(evidence["semantic.json"].observed, C01_SEMANTIC_ORACLE);
});

test("C01 oracle binds the canonical multi-edge topology to its translated arrival gate", async () => {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", "C01.json");
  const original = await readFile(fixturePath);
  const canonical = JSON.parse(await readFile(path.resolve(
    "tests/frontend-app/fixtures/chronicles/data/C01-movement-local-path.json",
  )));
  try {
    const fixture = JSON.parse(original);
    fixture.initialSnapshot.regions = structuredClone(canonical.initialSnapshot.regions);
    fixture.entries = structuredClone(canonical.entries);
    await writeFile(fixturePath, canonicalJson(fixture));

    const input = makeInput("C01");
    const regions = structuredClone(canonical.initialSnapshot.regions);
    input.semantic.terminalAuthority.mechanic.finalSnapshot.regions = structuredClone(regions);
    input.semantic.terminalAuthority.presentation.terminal.snapshot.regions = structuredClone(regions);
    input.semantic.terminalObservation.frame.world.regions = regions
      .map((value) => ({ completeness: "exact", value }));
    input.semantic.eventWitnesses = canonical.entries.map((entry) => ({
      kind: "envelope",
      disposition: "accepted",
      cursor: entry.cursor,
      envelope: { next_cursor: entry.cursor, events: [structuredClone(entry)] },
    }));

    const trajectory = [
      ["warm_springs", 900, 2_000],
      ["warm_springs", 920, 2_000],
      ["nirvana_east", 880, 560],
      ["nirvana_east", 896, 560],
      ["nirvana_east", 912, 560],
      ["nirvana_east", 912, 560],
      ["nirvana_east", 912, 560],
      ["nirvana_east", 912, 560],
    ];
    for (const [index, [regionId, x, y]] of trajectory.entries()) {
      input.motion.trajectorySamples[index].regionId = regionId;
      moveC01Actor(input, index, x, y);
    }
    const witness = input.motion.regionTransitionWitnesses[0];
    witness.position = { x: 880, y: 560 };
    witness.actorPosition = { x: 880, y: 560 };
    witness.gate.tile = { column: 27, row: 17 };
    witness.gate.point = { x: 880, y: 560 };
    witness.fromRegion = "warm_springs";
    witness.toRegion = "nirvana_east";

    const localOracle = createChronicleEvidenceOracle(TRUSTED_CONFIG);
    const evidence = await localOracle.buildViewportEvidence(input);
    assert.deepEqual(evidence["motion.json"].regionTransitions[0].gate, {
      role: "arrival",
      tile: { column: 27, row: 17 },
      tileSize: 32,
      point: { x: 880, y: 560 },
    });

    const legacy = mutate(input, (value) => {
      const legacyWitness = value.motion.regionTransitionWitnesses[0];
      legacyWitness.position = { x: 368, y: 48 };
      legacyWitness.actorPosition = { x: 368, y: 48 };
      legacyWitness.gate.tile = { column: 11, row: 1 };
      legacyWitness.gate.point = { x: 368, y: 48 };
      for (let index = 2; index < value.motion.trajectorySamples.length; index += 1) {
        const actor = value.motion.trajectorySamples[index].actors[0];
        moveC01Actor(value, index, actor.position.x - 512, actor.position.y - 512);
      }
    });
    await assert.rejects(
      () => localOracle.buildViewportEvidence(legacy),
      /trusted production map recipe|directed arrival gate/,
    );
  } finally {
    await writeFile(fixturePath, original);
  }
});

test("travel events cannot opt out of moving-to-moving displacement validation", async () => {
  const fixturePath = path.join(TRUSTED_ROOT, "fixtures", "C02.json");
  const original = await readFile(fixturePath);
  try {
    const fixture = JSON.parse(original);
    const entries = [
      travelEntry(1, "agent_left_region", "wanderer_001", "meadow", "distant"),
      travelEntry(2, "agent_entered_region", "wanderer_001", "meadow", "distant"),
    ];
    fixture.entries = entries;
    fixture.initialSnapshot.regions = [
      { name: "meadow", connections: ["distant"] },
      { name: "distant", connections: [] },
    ];
    await writeFile(fixturePath, canonicalJson(fixture));

    const input = makeInput("C02", "mobile");
    input.semantic.terminalAuthority = trustedTerminalAuthority(fixture);
    input.semantic.terminalObservation.frame.world.regions = fixture.initialSnapshot.regions
      .map((value) => ({ completeness: "exact", value }));
    input.semantic.eventWitnesses = entries.map((entry) => ({
      kind: "envelope",
      disposition: "accepted",
      cursor: entry.cursor,
      envelope: { next_cursor: entry.cursor, events: [entry] },
    }));
    input.motion.trajectorySamples = c01TrajectorySamples("mobile");
    input.motion.trajectorySamples[0].actors[0].activeAction = null;

    await assert.rejects(
      () => buildViewportEvidence(input),
      /moving actor wanderer_001 action is not active during displacement/,
    );
  } finally {
    await writeFile(fixturePath, original);
  }
});

test("C02 binds normalized motion claims to every trusted travel leg", async () => {
  const contract = twoLegTravelContract();
  await withSyntheticTravelInput("C02", contract, async (input) => {
    const evidence = await buildViewportEvidence(input);
    assert.equal(evidence["motion.json"].trajectory[0].cursor, 0);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["travel-legs"], true);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["all-directed-edges"], true);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["forbidden-shortcut"], true);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["no-alpha-gamma-shortcut"], true);
  });
});

test("C09 travel focus begins after the preceding trusted checkpoint hold and stays fail-closed", async () => {
  const contract = twoLegTravelContract();
  contract.trajectorySamples = [
    detailedTravelSample({ frameIndex: 0, cursor: 0, regionId: "alpha", x: 112, y: 112 }),
    detailedTravelSample({ frameIndex: 1, cursor: 0, regionId: "alpha", x: 128, y: 112 }),
    detailedTravelSample({ frameIndex: 2, cursor: 1, regionId: "beta", x: 208, y: 208 }),
    detailedTravelSample({ frameIndex: 3, cursor: 1, regionId: "beta", x: 224, y: 208 }),
    detailedTravelSample({ frameIndex: 10, cursor: 2, regionId: "beta", x: 224, y: 208, activeAction: null }),
    detailedTravelSample({ frameIndex: 81, cursor: 2, regionId: "beta", x: 224, y: 208, activeAction: null }),
    detailedTravelSample({ frameIndex: 82, cursor: 2, regionId: "beta", x: 224, y: 208 }),
    detailedTravelSample({ frameIndex: 83, cursor: 2, regionId: "beta", x: 240, y: 208 }),
    detailedTravelSample({ frameIndex: 84, cursor: 3, regionId: "gamma", x: 304, y: 304 }),
    detailedTravelSample({ frameIndex: 85, cursor: 3, regionId: "gamma", x: 320, y: 304 }),
  ];
  for (const sample of contract.trajectorySamples.filter(({ frameIndex }) => (
    frameIndex >= 10 && frameIndex <= 81
  ))) {
    sample.focusSelectionKey = "home:home_repair";
  }
  contract.regionTransitionWitnesses[1].observedFrameIndex = 84;
  contract.regionTransitionWitnesses[1].observedPresentationTimeMs = 84 * (1_000 / 30);
  contract.regionTransitionWitnesses[1].atMs = 84 * (1_000 / 30);

  await withSyntheticTravelInput("C09", contract, async (input) => {
    const evidence = await buildViewportEvidence(input);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["travel-legs"], true);

    input.motion.trajectorySamples.find(({ frameIndex }) => frameIndex === 83)
      .focusSelectionKey = "home:home_repair";
    await assert.rejects(
      () => buildViewportEvidence(input),
      /travel leg 3-4.*traveler wanderer_001 is not visibly Story-focused/,
    );
  });
});

test("C02 travel trajectory cursors cannot regress, oscillate, or exceed terminal authority", async () => {
  const cases = [
    ["regression", (input) => { input.motion.trajectorySamples[4].cursor = 0; }, /trajectory cursor must not regress/],
    ["oscillation", (input) => {
      input.motion.trajectorySamples[4].cursor = 3;
      input.motion.trajectorySamples[5].cursor = 2;
    }, /trajectory cursor must not regress/],
    ["terminal overflow", (input) => {
      input.motion.trajectorySamples[4].cursor = input.expectedFinalCursor + 1;
    }, /trajectory cursor exceeds expected final cursor 4/],
  ];
  for (const [label, change, expected] of cases) {
    const contract = twoLegTravelContract();
    await withSyntheticTravelInput("C02", contract, async (input) => {
      change(input);
      await assert.rejects(() => buildViewportEvidence(input), expected, label);
    });
  }
});

test("C02 rejects a trusted traveler disappearing after the first completed leg", async () => {
  const contract = twoLegTravelContract();
  await withSyntheticTravelInput("C02", contract, async (input) => {
    for (const sample of input.motion.trajectorySamples.filter(({ cursor }) => cursor >= 2)) {
      sample.actors = [];
    }
    await assert.rejects(
      () => buildViewportEvidence(input),
      /travel leg 3-4.*traveler wanderer_001 is missing/,
    );
  });
});

test("C02 rejects a trusted travel leg with zero visible displacement", async () => {
  const contract = twoLegTravelContract();
  await withSyntheticTravelInput("C02", contract, async (input) => {
    moveC01Actor(input, 5, 224, 208);
    moveC01Actor(input, 7, 304, 304);
    await assert.rejects(
      () => buildViewportEvidence(input),
      /travel leg 3-4.*no visible locomotion displacement/,
    );
  });
});

test("C02 rejects missing, duplicate, and event-mismatched travel transition witnesses", async () => {
  const cases = [
    ["missing", (input) => { input.motion.regionTransitionWitnesses.pop(); }, /travel leg 3-4.*exactly one region-transition witness/],
    ["duplicate", (input) => {
      input.motion.regionTransitionWitnesses.push(structuredClone(input.motion.regionTransitionWitnesses[1]));
      input.motion.regionTransitionWitnesses[2].commandId = "duplicate:arrival:4";
    }, /travel leg 3-4.*exactly one region-transition witness/],
    ["wrongActor", (input) => {
      input.motion.regionTransitionWitnesses[1].actorId = "wanderer_002";
    }, /travel leg 3-4.*exactly one region-transition witness/],
    ["wrongCursor", (input) => {
      input.motion.regionTransitionWitnesses[1].frameIdentity.firstCursor = 3;
      input.motion.regionTransitionWitnesses[1].frameIdentity.lastCursor = 3;
    }, /travel leg 3-4.*exactly one region-transition witness/],
  ];
  for (const [label, change, expected] of cases) {
    const contract = twoLegTravelContract();
    await withSyntheticTravelInput("C02", contract, async (input) => {
      change(input);
      await assert.rejects(() => buildViewportEvidence(input), expected, label);
    });
  }
});

test("C02 all-directed-edges semantic authority rejects incomplete trusted topology coverage", async () => {
  const contract = twoLegTravelContract();
  contract.entries.splice(2, 2);
  contract.trajectorySamples.splice(4);
  contract.regionTransitionWitnesses.splice(1);
  await withSyntheticTravelInput("C02", contract, async (input) => {
    await assert.rejects(
      () => buildViewportEvidence(input),
      /all-directed-edges.*trusted topology/,
    );
  });
});

test("canonical C12 travel authority is proven by its exact cursor-11/12 visible leg", async () => {
  await withCanonicalC12TravelInput(async (input, _fixture, build) => {
    const evidence = await build(input);
    assert.equal(evidence["motion.json"].verdict.semanticClaims.travel, true);
    assert.equal(evidence["motion.json"].verdict.semanticClaims["travel-legs"], true);
    assert.deepEqual(evidence["motion.json"].verdict.travelLegs, [{
      actorId: "wanderer_003",
      enteredCursor: 12,
      fromRegion: "nirvana",
      leftCursor: 11,
      toRegion: "warm_springs",
    }]);
  });
});

test("canonical C12 travel semantic claim rejects a missing transition witness", async () => {
  await withCanonicalC12TravelInput(async (input, _fixture, build) => {
    input.motion.regionTransitionWitnesses = [];
    await assert.rejects(
      () => build(input),
      /travel leg 11-12.*exactly one region-transition witness/,
    );
  });
});

test("raw evidence cannot select catalog, fixture, analysis closure, or trusted roots", async () => {
  const injected = makeInput();
  injected.sourceRevision = { trustedRoot: "/tmp/attacker", fixture: { file: "fake.json" }, closureManifest: { file: "fake.json" } };
  await assert.rejects(() => buildViewportEvidence(injected), /trusted authority must not be supplied by raw evidence/);
});

test("cursor samples bind accepted truth to authoritative prefixes and gaps to visible recovery", async () => {
  const futureAccepted = mutate(makeInput("C13"), (value) => { value.cursors.samples[1].acceptedCursor = 2; });
  await assert.rejects(() => buildViewportEvidence(futureAccepted), /acceptedCursor exceeds authoritativeCursor/);
  const outside = mutate(makeInput("C13"), (value) => { value.cursors.gaps[0].toCursor = 121; });
  await assert.rejects(() => buildViewportEvidence(outside), /gap exceeds expected final cursor/);
  const invisible = mutate(makeInput("C13"), (value) => { value.cursors.samples[2].acceptedCursor = 60; value.cursors.samples[2].presentedCursor = 60; value.cursors.samples[2].publicCursor = 60; });
  await assert.rejects(() => buildViewportEvidence(invisible), /gap is not visibly lagged/);
  const noRecovery = mutate(makeInput("C13"), (value) => { value.cursors.gaps[0].recoveredFrameIndex = 99; value.cursors.gaps[0].resumedFrameIndex = 99; });
  await assert.rejects(() => buildViewportEvidence(noRecovery), /gap recovery frame/);
  const noDetection = mutate(makeInput("C13"), (value) => {
    value.cursors.gaps[0].detectedFrameIndex = 1;
    value.cursors.gaps[0].visibleFrameIndex = 1;
  });
  await assert.rejects(() => buildViewportEvidence(noDetection), /gap detection frame/);
  const overlap = mutate(makeInput("C13"), (value) => { value.cursors.gaps.push({ ...value.cursors.gaps[0] }); });
  await assert.rejects(() => buildViewportEvidence(overlap), /overlapping cursor gaps/);
});

test("performance lifecycle rejects every required bounds, ownership, heap, Archive, and disposal failure", async () => {
  const boundedTerminalHistory = mutate(makeInput("C01"), (value) => { value.performance.runtimeSamples.at(-1).chroniclePrevious = 2; });
  assert.equal((await buildViewportEvidence(boundedTerminalHistory))["performance.json"].runtimeSamples.at(-1).chroniclePrevious, 2);
  const boundedActorRecreation = mutate(makeInput("C01"), (value) => { value.performance.lifecycle.graphActors = { ...counter(2), peak: 1 }; });
  assert.equal((await buildViewportEvidence(boundedActorRecreation))["performance.json"].lifecycle.graphActors.created, 2);
  const excessiveActorRecreation = mutate(boundedActorRecreation, (value) => { value.performance.lifecycle.graphActors = { ...counter(3), peak: 1 }; });
  await assert.rejects(() => buildViewportEvidence(excessiveActorRecreation), /Graph actor recreation exceeds canonical transition allowance/);
  const excessiveActorPeak = mutate(boundedActorRecreation, (value) => { value.performance.lifecycle.graphActors.peak = 2; });
  await assert.rejects(() => buildViewportEvidence(excessiveActorPeak), /Graph actor peak exceeds canonical fixture population/);
  const unbalancedActorDisposal = mutate(boundedActorRecreation, (value) => { value.performance.lifecycle.graphActors.disposed = 1; });
  await assert.rejects(() => buildViewportEvidence(unbalancedActorDisposal), /graphActors ownership must settle exactly/);
  const cases = [
    ["directorPending", (v) => { v.performance.runtimeSamples[0].directorPending = 49; }, /director pending.*48/],
    ["chroniclePrevious", (v) => { v.performance.runtimeSamples[0].chroniclePrevious = 49; }, /Chronicle window.*48/],
    ["checkpoint", (v) => { v.performance.runtimeSamples[0].retainedSafeCheckpoints = 65; }, /checkpoint.*64/],
    ["activeScene", (v) => { v.performance.runtimeSamples[0].activeSceneCount = 2; }, /exactly one active scene/],
    ["stage", (v) => { v.performance.runtimeSamples[0].stageCount = 2; }, /one Stage and Canvas/],
    ["archiveCycles", (v) => { v.performance.archiveObservations.pop(); }, /25 real Archive cycle observations/],
    ["schedulerOwner", (v) => { v.performance.schedulerSamples[1].ownerId = "other"; }, /one scheduler owner/],
    ["hiddenWake", (v) => { v.performance.schedulerSamples[2].wakeScheduled = true; }, /hidden scheduler must settle/],
    ["graphDispose", (v) => { v.performance.lifecycle.graph.disposed = 0; v.performance.lifecycle.graph.live = 1; v.performance.lifecycle.graph.outstanding = 1; }, /graph.*settle/],
    ["graphLive", (v) => { v.performance.lifecycle.graph.live = 1; }, /graph live.*outstanding/],
    ["cacheReason", (v) => { v.performance.lifecycle.cache.rebuildReasons = ["actor-motion"]; }, /cache rebuild reason/],
    ["atlasLease", (v) => { v.performance.lifecycle.atlas.leasesReleased = 1; }, /atlas leases must settle/],
    ["atlasAcquire", (v) => { v.performance.lifecycle.atlas.releaseCalls = 1; }, /atlas acquisitions must settle/],
    ["react", (v) => { v.performance.lifecycle.react.frameDrivenCommitCount = 1; }, /frame-driven React commits/],
    ["heap", (v) => { v.performance.lifecycle.heap.tail.usedSize += 4 * 1024 * 1024 + 1; }, /heap usedSize plateau/],
    ["dom", (v) => { v.performance.lifecycle.heap.domTail.listeners += 26; }, /listener plateau/],
    ["canvasDispose", (v) => { v.performance.lifecycle.canvas.disposed = 0; v.performance.lifecycle.canvas.live = 1; v.performance.lifecycle.canvas.outstanding = 1; }, /canvas.*settle/],
    ["terminalPreviousBound", (v) => { v.performance.runtimeSamples.at(-1).chroniclePrevious = 49; }, /Chronicle window.*48/],
    ["terminalUpcoming", (v) => { v.performance.runtimeSamples.at(-1).chronicleUpcoming = 1; }, /runtime terminal queues and scene must settle/],
  ];
  for (const [label, change, expected] of cases) {
    const input = mutate(makeInput("C16"), change);
    await assert.rejects(() => buildViewportEvidence(input), expected, label);
  }
  const missingPressure = mutate(makeInput("C16"), (value) => { value.performance.runtimeSamples.splice(1, 1); });
  await assert.rejects(() => buildViewportEvidence(missingPressure), /C16 runtime samples must cover 1024,2048,3072,4096/);
  const noActive = mutate(makeInput("C16"), (value) => { value.performance.runtimeSamples.forEach((sample) => { sample.activeSceneCount = 0; }); });
  await assert.rejects(() => buildViewportEvidence(noActive), /active presentation phase with exactly one scene/);
  const archiveChangedLive = mutate(makeInput("C16"), (value) => { value.performance.archiveObservations[3].liveStateHashAfter = "b".repeat(64); });
  await assert.rejects(() => buildViewportEvidence(archiveChangedLive), /Archive cycle altered Live truth/);
  const archiveStage = mutate(makeInput("C16"), (value) => { value.performance.archiveObservations[4].stageId = "other"; });
  await assert.rejects(() => buildViewportEvidence(archiveStage), /Archive cycles must share one Stage and Canvas/);
  const forgedArchivePlacementBinding = mutate(makeInput("C16"), (value) => {
    value.performance.archiveObservations[5].archiveSpatialBinding.placementRebound = false;
  });
  await assert.rejects(() => buildViewportEvidence(forgedArchivePlacementBinding), /Archive Graph must use rebound spatial resources/);
  const forgedArchiveRecipeBinding = mutate(makeInput("C16"), (value) => {
    value.performance.archiveObservations[6].archiveSpatialBinding.recipesRebound = false;
  });
  await assert.rejects(() => buildViewportEvidence(forgedArchiveRecipeBinding), /Archive Graph must use rebound spatial resources/);
  const forgedRestoredLiveBinding = mutate(makeInput("C16"), (value) => {
    value.performance.archiveObservations[7].restoredLiveSpatialBinding.placementRebound = true;
  });
  await assert.rejects(() => buildViewportEvidence(forgedRestoredLiveBinding), /restored Live Graph must use initial spatial resources/);
  const missingSpatialBinding = mutate(makeInput("C16"), (value) => {
    delete value.performance.archiveObservations[8].archiveSpatialBinding;
  });
  await assert.rejects(() => buildViewportEvidence(missingSpatialBinding), /Archive spatial binding/);
  const zeroGraph = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.graphActors = counter(0); });
  await assert.rejects(() => buildViewportEvidence(zeroGraph), /Graph actor activity must match canonical fixture/);
  const fullWorldActors = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.graphActors = counter(256); });
  await assert.rejects(() => buildViewportEvidence(fullWorldActors), /Graph actor activity must match canonical fixture/);
  const fullWorldHomes = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.graphHomes = counter(128); });
  await assert.rejects(() => buildViewportEvidence(fullWorldHomes), /Graph home activity must match canonical fixture/);
  const wrongVisibleRegion = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.visibleRegionId = "nirvana_east"; });
  await assert.rejects(() => buildViewportEvidence(wrongVisibleRegion), /visible Graph region must match canonical fixture/);
  const wrongEnvironmentCount = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.graphEnvironments = counter(2); });
  await assert.rejects(() => buildViewportEvidence(wrongEnvironmentCount), /Graph environment activity must match canonical fixture/);
  const zeroAtlas = mutate(makeInput("C16"), (value) => { value.performance.lifecycle.atlas = { decodeStarts: 0, bitmapsClosed: 0, acquireCalls: 0, releaseCalls: 0, leasesCreated: 0, leasesReleased: 0 }; });
  await assert.rejects(() => buildViewportEvidence(zeroAtlas), /atlas lifecycle must be non-vacuous/);
});

test("scheduler certification requires reason-bound ambience and reduced terminal zero quiet evidence", async () => {
  const cases = [
    ["phase", (v) => { delete v.performance.schedulerSamples[0].phase; }, /scheduler phase/],
    ["wrongVisiblePhase", (v) => { v.performance.schedulerSamples[0].phase = "active"; }, /visible scheduler.*ambient/],
    ["wrongVisibleRoute", (v) => { v.performance.schedulerSamples[0].routeId = "reduced"; }, /visible scheduler.*standard/],
    ["wrongReducedRoute", (v) => { v.performance.schedulerSamples[4].routeId = "standard"; }, /reduced-active scheduler.*reduced/],
    ["wrongHiddenRoute", (v) => { v.performance.schedulerSamples[2].routeId = "reduced"; }, /hidden scheduler.*standard/],
    ["wrongDisposedOwner", (v) => { v.performance.schedulerSamples[3].ownerId = "other"; }, /standard visible.*share one scheduler owner/],
    ["wrongTerminalOwner", (v) => { v.performance.schedulerSamples[1].ownerId = "other"; }, /reduced active.*share one scheduler owner/],
    ["zeroAmbience", (v) => {
      Object.assign(v.performance.schedulerSamples[0], {
        wakeScheduled: false, nextDeadlineMs: null, reason: null,
      });
    }, /visible ambience.*wake/],
    ["deadline", (v) => { delete v.performance.schedulerSamples[0].nextDeadlineMs; }, /scheduler nextDeadlineMs/],
    ["nullDeadline", (v) => { v.performance.schedulerSamples[0].nextDeadlineMs = null; }, /future visible deadline/],
    ["missingReason", (v) => { v.performance.schedulerSamples[0].reason = null; }, /reason-bound/],
    ["wrongReason", (v) => { v.performance.schedulerSamples[0].reason = "post-commit-retry"; }, /reason-bound graph deadline/],
    ["dualHandles", (v) => { v.performance.schedulerSamples[0].rafScheduled = true; }, /simultaneous RAF and wake/],
    ["wakePast", (v) => { v.performance.schedulerSamples[0].nextDeadlineMs = 999; }, /future visible deadline/],
    ["terminalHandle", (v) => { v.performance.schedulerSamples[1].wakeScheduled = true; }, /terminal-static scheduler must be zero/],
    ["terminalDeadline", (v) => { v.performance.schedulerSamples[1].nextDeadlineMs = 2_100; }, /terminal-static scheduler must be zero/],
    ["quietDuration", (v) => { v.performance.schedulerSamples[1].quiet.durationMs = 999; }, /quiet window.*1000/],
    ["quietDraw", (v) => { v.performance.schedulerSamples[1].quiet.drawDelta = 1; }, /quiet draw delta/],
    ["quietReact", (v) => { v.performance.schedulerSamples[1].quiet.reactCommitDelta = 1; }, /quiet React commit delta/],
    ["quietCursor", (v) => { v.performance.schedulerSamples[1].quiet.cursorAfter += 1; }, /quiet cursor identity/],
    ["quietFrame", (v) => { v.performance.schedulerSamples[1].quiet.frameIdentityAfter = "c".repeat(64); }, /quiet frame identity/],
    ["quietState", (v) => { v.performance.schedulerSamples[1].quiet.stateHashAfter = "c".repeat(64); }, /quiet accepted state/],
    ["hiddenDeadline", (v) => { v.performance.schedulerSamples[2].nextDeadlineMs = 4_000; }, /hidden scheduler must settle/],
    ["disposedHandle", (v) => { v.performance.schedulerSamples[3].rafScheduled = true; }, /disposed scheduler must settle/],
  ];
  for (const [label, change, expected] of cases) {
    await assert.rejects(() => buildViewportEvidence(mutate(makeInput("C01"), change)), expected, label);
  }
});

test("asset lifecycle rejects environment, pool, atlas capacity and settlement failures", async () => {
  const cases = [
    [(v) => { v.assets.environmentSamples[0].allocated = 33; }, /environment allocation exceeds capacity/],
    [(v) => { v.assets.environmentSamples[0].activeEffects = 33; }, /active effects exceed environment capacity/],
    [(v) => { v.assets.poolSamples[0].allocated = 33; }, /pool allocation exceeds capacity/],
    [(v) => { v.assets.poolSamples[1].waiterCount = 1; }, /pool must settle/],
    [(v) => { v.assets.atlasSamples[1].leases = 1; }, /atlas must settle/],
    [(v) => { v.assets.atlasSamples[1].decodedBytes = 1; }, /atlas must settle/],
  ];
  for (const [change, expected] of cases) await assert.rejects(() => buildViewportEvidence(mutate(makeInput(), change)), expected);
  const missingPressure = mutate(makeInput("C16"), (value) => { value.assets.poolSamples.splice(1, 1); });
  await assert.rejects(() => buildViewportEvidence(missingPressure), /C16 pool pressure phases/);
  const unstableAtlas = mutate(makeInput("C16"), (value) => { value.assets.atlasSamples[2].decodedBytes = 4096; });
  await assert.rejects(() => buildViewportEvidence(unstableAtlas), /atlas pressure plateau/);
  const waiters = mutate(makeInput("C16"), (value) => { value.assets.poolSamples[0].waiterCount = 65; });
  await assert.rejects(() => buildViewportEvidence(waiters), /waiter capacity 64/);
  const flights = mutate(makeInput("C16"), (value) => { value.assets.atlasSamples[0].inFlightCount = 17; });
  await assert.rejects(() => buildViewportEvidence(flights), /in-flight capacity 16/);
  const waiterPlateau = mutate(makeInput("C16"), (value) => { value.assets.poolSamples[2].waiterCount = 1; });
  await assert.rejects(() => buildViewportEvidence(waiterPlateau), /pool pressure waiter\/in-flight plateau/);
  const flightPlateau = mutate(makeInput("C16"), (value) => { value.assets.atlasSamples[2].inFlightCount = 1; });
  await assert.rejects(() => buildViewportEvidence(flightPlateau), /atlas pressure waiter\/in-flight plateau/);
});

test("network requires a complete sequenced ledger and decoded production-only closure", async () => {
  const omitted = mutate(makeInput(), (value) => { value.network.requests = []; });
  await assert.rejects(() => buildViewportEvidence(omitted), /trusted request ledger count mismatch/);
  const sequence = mutate(makeInput(), (value) => { value.network.requests[0].sequence = 2; });
  await assert.rejects(() => buildViewportEvidence(sequence), /request ledger sequence/);
  const encoded = mutate(makeInput(), (value) => { value.network.requests[0].url = "http://127.0.0.1:4173/src/%74hree/index.ts"; });
  await assert.rejects(() => buildViewportEvidence(encoded), /forbidden 3D\/demo\/slice/);
  const doubleEncoded = mutate(makeInput(), (value) => { value.network.requests[0].url = "http://127.0.0.1:4173/src/%2574hree/index.ts"; });
  await assert.rejects(() => buildViewportEvidence(doubleEncoded), /double-encoded request/);
  const unhandled = mutate(makeInput(), (value) => { value.network.requests[0].handler = "invented"; });
  await assert.rejects(() => buildViewportEvidence(unhandled), /unhandled request/);
  const external = mutate(makeInput(), (value) => { value.network.requests[0].url = "https://example.com/asset.png"; });
  await assert.rejects(() => buildViewportEvidence(external), /external origin/);
  const mutation = mutate(makeInput(), (value) => { value.network.requests[0].method = "POST"; });
  await assert.rejects(() => buildViewportEvidence(mutation), /mutation method/);
  const noNavigation = mutate(makeInput(), (value) => { value.network.requests[0].kind = "asset"; });
  await assert.rejects(() => buildViewportEvidence(noNavigation), /production navigation request/);
  const rawAccepted = mutate(makeInput(), (value) => {
    Object.assign(value.network.requests[1], {
      status: 200, disposition: "fulfilled", responseStatus: 200,
      terminal: "finished", failureText: null,
    });
  });
  await assert.rejects(() => buildViewportEvidence(rawAccepted), /raw artifact request must be rejected/);
  const rawForbiddenResponse = mutate(makeInput(), (value) => {
    Object.assign(value.network.requests[1], {
      status: 403, disposition: "fulfilled", responseStatus: 403,
      terminal: "finished", failureText: null,
    });
  });
  await assert.rejects(() => buildViewportEvidence(rawForbiddenResponse), /raw artifact request must be rejected/);
  const abortedButFulfilled = mutate(makeInput(), (value) => { value.network.requests[1].status = 0; value.network.requests[1].disposition = "fulfilled"; });
  await assert.rejects(() => buildViewportEvidence(abortedButFulfilled), /response-less request must retain rejected transport authority/);
  const source404 = mutate(makeInput(), (value) => {
    Object.assign(value.network.requests[1], {
      kind: "source", handler: "production-source",
      url: "http://127.0.0.1:4173/src/main.tsx", status: 404,
      disposition: "fulfilled", responseStatus: 404,
      terminal: "finished", failureText: null,
    });
  });
  await assert.rejects(() => buildViewportEvidence(source404), /production-source request has invalid disposition/);
  const forbiddenSource = mutate(makeInput(), (value) => {
    Object.assign(value.network.requests[1], {
      kind: "source", handler: "production-source",
      url: "http://127.0.0.1:4173/src/renderer/WorldRenderer.ts",
      status: 200, disposition: "fulfilled", responseStatus: 200,
      terminal: "finished", failureText: null,
    });
  });
  await assert.rejects(() => buildViewportEvidence(forbiddenSource), /forbidden 3D\/demo\/slice request/);
  const assetMutation = mutate(makeInput(), (value) => {
    Object.assign(value.network.requests[1], {
      kind: "asset", handler: "production-asset", method: "POST",
      url: "http://127.0.0.1:4173/assets/a.png", status: 200,
      disposition: "fulfilled", responseStatus: 200,
      terminal: "finished", failureText: null,
    });
  });
  await assert.rejects(() => buildViewportEvidence(assetMutation), /mutation method POST/);
});

test("network accepts only the authored optional API statuses and requires dual lifecycle", async () => {
  const buildTrusted = async (request) => {
    const input = makeInput();
    input.network.requests = [
      structuredClone(BASE_REQUESTS[0]),
      request,
      structuredClone(BASE_REQUESTS[1]),
    ].map((value, index) => ({ ...value, sequence: index + 1 }));
    const summary = {
      observedCount: input.network.requests.length,
      ledgerSha256: sha256Buffer(Buffer.from(canonicalJson(input.network.requests))),
    };
    const trusted = {
      ...TRUSTED_CONFIG,
      requestSummaries: {
        ...TRUSTED_CONFIG.requestSummaries,
        ["C03/desktop"]: summary,
      },
    };
    return createChronicleEvidenceOracle(trusted).buildViewportEvidence(input);
  };
  const completed = (url, status = 200) => ({
    sequence: 2,
    kind: "api",
    method: "GET",
    url: `http://127.0.0.1:4173${url}`,
    handler: "api-fixture",
    status,
    disposition: "fulfilled",
    responseStatus: status,
    terminal: "finished",
    failureText: null,
  });
  const missingLatest = {
    ...completed("/api/replay/checkpoints/latest", 404),
    terminal: "failed",
    failureText: "net::ERR_ABORTED",
  };
  await buildTrusted(missingLatest);
  await buildTrusted(completed("/api/replay/checkpoints?before=1&limit=1", 413));

  await assert.rejects(() => buildTrusted(completed("/api/run", 404)), /API fixture request has invalid disposition/);
  await assert.rejects(() => buildTrusted(completed("/api/run", 413)), /API fixture request has invalid disposition/);
  await assert.rejects(() => buildTrusted(completed("/api/replay/checkpoints/latest", 500)), /API fixture request has invalid disposition/);
  await assert.rejects(() => buildTrusted({ ...missingLatest, disposition: "rejected" }), /runtime response authority/);
  const missingLifecycle = completed("/api/run", 200);
  delete missingLifecycle.responseStatus;
  delete missingLifecycle.terminal;
  delete missingLifecycle.failureText;
  await assert.rejects(() => buildTrusted(missingLifecycle), /terminal lifecycle/);
});

test("canonical ordering is code-unit stable across input permutations and literal matrix order", async () => {
  assert.deepEqual(CHRONICLE_IDS, CATALOG_IDS);
  assert.deepEqual(EVIDENCE_CHRONICLE_IDS, LITERAL_IDS);
  const input = makeInput();
  assert.deepEqual((await buildViewportEvidence(input))["source-revision.json"].closure.files.map(({ file }) => file), ["assets/stage.js", "assets/z.js", "assets/ä.js"]);

  const complete = LITERAL_IDS.flatMap((id) => [makeInput(id, "desktop"), makeInput(id, "mobile")]);
  const expectedOrder = LITERAL_IDS.flatMap((id) => [`${id}/desktop`, `${id}/mobile`]);
  assert.deepEqual((await buildChronicleEvidenceMatrix(complete)).map(({ chronicleId, viewport }) => `${chronicleId}/${viewport}`), expectedOrder);
});

test("reduced motion requires nonempty independent evidence cross-bound to semantics and markers", async () => {
  const baseline = makeInput();
  assert.deepEqual(
    (await buildViewportEvidence(baseline))["reduced-motion.json"].standard.terminalCameraWitness,
    baseline.reducedMotion.standard.terminalCameraWitness,
  );
  assert.deepEqual(
    (await buildViewportEvidence(baseline))["reduced-motion.json"].reduced.terminalCameraWitness,
    baseline.reducedMotion.reduced.terminalCameraWitness,
  );
  const witnessCases = [
    ["missing", (value) => { delete value.reducedMotion.reduced.terminalCameraWitness; }, /reduced terminal camera witness/],
    ["previous drift", (value) => { value.reducedMotion.reduced.terminalCameraWitness.samples[0].camera.center.x += 1; }, /reduced terminal camera witness.*camera.*stable/],
    ["next drift", (value) => { value.reducedMotion.reduced.terminalCameraWitness.samples[2].camera.zoom += 0.01; }, /reduced terminal camera witness.*camera.*stable/],
  ];
  for (const [label, mutateValue, message] of witnessCases) {
    await assert.rejects(
      () => buildViewportEvidence(mutate(makeInput(), mutateValue)),
      message,
      label,
    );
  }
  const bothEmpty = mutate(makeInput(), (value) => {
    for (const mode of [value.reducedMotion.standard, value.reducedMotion.reduced]) {
      mode.endpoints = []; mode.consequences = []; mode.markerOrder = []; mode.labels = []; mode.readingHoldsMs = [];
    }
  });
  await assert.rejects(() => buildViewportEvidence(bothEmpty), /nonempty independent reduced-motion evidence/);
  const unrelated = mutate(makeInput(), (value) => {
    value.reducedMotion.standard.endpoints = ["unrelated"];
    value.reducedMotion.reduced.endpoints = ["unrelated"];
  });
  await assert.rejects(() => buildViewportEvidence(unrelated), /reduced-motion endpoints must bind semantic evidence/);
  const parity = mutate(makeInput(), (value) => { value.reducedMotion.reduced.readingHoldsMs = [901]; });
  await assert.rejects(() => buildViewportEvidence(parity), /reduced-motion readingHoldsMs parity/);
  const sameCapture = mutate(makeInput(), (value) => { value.reducedMotion.reduced.captureId = value.reducedMotion.standard.captureId; });
  await assert.rejects(() => buildViewportEvidence(sameCapture), /distinct capture IDs/);
  const wrongMode = mutate(makeInput(), (value) => { value.reducedMotion.reduced.mode = "standard"; });
  await assert.rejects(() => buildViewportEvidence(wrongMode), /reduced capture mode/);
});

test("C16 supports truthful GC-supported and unsupported certification branches", async () => {
  const unsupported = mutate(makeInput("C16"), (value) => {
    value.performance.lifecycle.heap = {
      supportProbe: { api: "CDP HeapProfiler.collectGarbage", supported: false, reason: "CDP unavailable" },
      collections: 0,
      baseline: null,
      tail: null,
      domBaseline: { nodes: 100, listeners: 10 },
      domTail: { nodes: 110, listeners: 11 },
    };
  });
  assert.equal((await buildViewportEvidence(unsupported))["performance.json"].lifecycle.heap.gcSupported, false);
  const lied = mutate(unsupported, (value) => { value.performance.lifecycle.heap.collections = 1; });
  await assert.rejects(() => buildViewportEvidence(lied), /unsupported GC probe cannot report collections/);
});

test("draw, long-task, smoothing, and integer gates remain fail closed", async () => {
  const vacuous = mutate(makeInput(), (value) => { value.performance.drawSamplesMs = [0, 0, 0, 0]; });
  await assert.rejects(() => buildViewportEvidence(vacuous), /draw samples must include a positive measured duration/);
  const p95 = mutate(makeInput(), (value) => { value.performance.drawSamplesMs = [1, 1, 1, 1, 5]; });
  await assert.rejects(() => buildViewportEvidence(p95), /draw p95.*4 ms/);
  const maximum = mutate(makeInput(), (value) => { value.performance.drawSamplesMs = [1, 51]; });
  await assert.rejects(() => buildViewportEvidence(maximum), /draw maximum.*50 ms/);
  const longTask = mutate(makeInput(), (value) => { value.performance.longTasksMs = [50.1]; });
  await assert.rejects(() => buildViewportEvidence(longTask), /long task.*50 ms/);
  const capturedProductLongTask = mutate(makeInput(), (value) => { value.performance.longTasksMs = [80]; });
  await assert.rejects(() => buildViewportEvidence(capturedProductLongTask), /long task.*50 ms/);
  const smoothing = mutate(makeInput(), (value) => { value.assets.raster.imageSmoothingSamples = [false, true]; });
  await assert.rejects(() => buildViewportEvidence(smoothing), /image smoothing must be disabled/);
  const fractional = mutate(makeInput(), (value) => { value.assets.raster.coordinates = [0, 0.5]; });
  await assert.rejects(() => buildViewportEvidence(fractional), /integer aligned/);
});

test("canonical provider-free adapter binds real catalog fixtures to a production analysis manifest", async () => {
  const analysis = await buildProductionStageAnalysis();
  try {
    const canonical = createCanonicalChronicleEvidenceOracle({
      analysisRoot: analysis.distDir,
      analysisManifestFile: ".vite/manifest.json",
      artifactRoot: path.join(TRUSTED_ROOT, "artifacts"),
      applicationOrigin: "http://127.0.0.1:4173",
      requestSummaries: { "C00/desktop": REQUEST_SUMMARY },
    });
    const input = makeInput("C00", "desktop");
    const canonicalManifest = JSON.parse(await readFile(path.resolve(
      "tests/frontend-app/fixtures/chronicles/data/C00-world-four-regions-topology.json",
    ), "utf8"));
    const authority = trustedTerminalAuthority(canonicalManifest);
    const terminalSnapshot = canonicalManifest.expectedTerminal.finalSnapshot;
    const terminalObservation = input.semantic.terminalObservation;
    terminalObservation.observerFrameIdentity.runId = terminalSnapshot.run_id;
    terminalObservation.observerFrameIdentity.sourceKey = `live:${terminalSnapshot.run_id}`;
    terminalObservation.canvasFrameIdentity.runId = terminalSnapshot.run_id;
    terminalObservation.canvasFrameIdentity.sourceKey = `live:${terminalSnapshot.run_id}`;
    terminalObservation.frame.runId = terminalSnapshot.run_id;
    terminalObservation.frame.sourceKey = `live:${terminalSnapshot.run_id}`;
    for (const witness of [
      input.semantic.terminalCameraWitness,
      input.reducedMotion.standard.terminalCameraWitness,
      input.reducedMotion.reduced.terminalCameraWitness,
    ]) {
      for (const cameraSample of witness.samples) {
        cameraSample.frameIdentity.runId = terminalSnapshot.run_id;
        cameraSample.frameIdentity.sourceKey = `live:${terminalSnapshot.run_id}`;
      }
    }
    terminalObservation.frame.world = {
      worldTime: terminalSnapshot.world_time,
      agents: terminalSnapshot.agents.map((value) => ({ completeness: "exact", value })),
      homes: terminalSnapshot.homes.map((value) => ({ completeness: "exact", value })),
      regions: terminalSnapshot.regions.map((value) => ({ completeness: "exact", value })),
      ruins: terminalSnapshot.ruins.map((value) => ({ completeness: "exact", value })),
      pendingProposals: terminalSnapshot.pending_proposals,
      regionPressure: structuredClone(terminalSnapshot.region_pressure),
    };
    input.semantic = {
      ...input.semantic,
      terminalAuthority: authority,
      operationalWorkload: { trace: [
        traceEntry("ambient", "live-0", endpoint("live", terminalSnapshot.run_id, 0), endpoint("live", terminalSnapshot.run_id, 0), false),
        traceEntry("ambient", "terminal-live-0", endpoint("live", terminalSnapshot.run_id, 0), endpoint("live", terminalSnapshot.run_id, 0), true),
      ] },
      transportWitnesses: [
        transportEntry({ sequence: 1, kind: "open", sourceId: 1, sourceRunId: terminalSnapshot.run_id, sourceCursor: 0 }),
        transportEntry({ sequence: 2, kind: "close", sourceId: 1, sourceRunId: terminalSnapshot.run_id, sourceCursor: 0 }),
      ],
      endpoints: ["agent:wanderer_001:still"],
      consequences: ["checkpoint:final"],
      markers: ["checkpoint:final"],
    };
    for (const mode of [input.reducedMotion.standard, input.reducedMotion.reduced]) {
      mode.consequences = ["checkpoint:final"];
      mode.markerOrder = ["checkpoint:final"];
      mode.labels = ["Checkpoint Final"];
      mode.artifactDirectory = CANONICAL_C00_MOTION[mode.mode];
    }
    input.performance.lifecycle.visibleRegionId = "nirvana";
    input.performance.lifecycle.graphActors = counter(2);
    input.performance.lifecycle.graphHomes = counter(0);
    input.performance.lifecycle.graphEnvironments = counter(1);
    input.cursors.samples = [
      {
        ...sample(0, 0, 0, 0, 0, "running"),
        runId: terminalSnapshot.run_id,
        sourceKey: `live:${terminalSnapshot.run_id}`,
      },
      {
        ...sample(1, 0, 0, 0, 0, "settled"),
        runId: terminalSnapshot.run_id,
        sourceKey: `live:${terminalSnapshot.run_id}`,
      },
    ];
    const trace = input.semantic.operationalWorkload.trace;
    input.performance.runtimeSamples[0].phase = "operational";
    input.performance.runtimeSamples[0].activeSceneCount = 0;
    input.performance.runtimeSamples[0].workload = trace[0];
    input.performance.runtimeSamples[1].workload = trace[1];
    for (const sample of input.performance.schedulerSamples) {
      sample.workload = sample.mode === "terminal-static" ? "terminal"
        : sample.mode === "visible" ? "ambient" : sample.mode;
    }
    const reducedScheduler = input.performance.schedulerSamples.find(({ mode }) => mode === "reduced-active");
    reducedScheduler.phase = "operational";
    reducedScheduler.workload = "ambient";
    const sidecars = await canonical.buildViewportEvidence(input);
    assert.match(sidecars["source-revision.json"].catalog.file, /catalog\.json$/);
    assert.equal(sidecars["source-revision.json"].fixture.file.endsWith("C00-world-four-regions-topology.json"), true);
    assert.equal(sidecars["source-revision.json"].closure.files.length > 0, true);
    assert.equal(sidecars["network.json"].verdict.accounted, true);
    assert.deepEqual(sidecars["semantic.json"].observed.positive, ["four-region-topology", "observer-checkpoint"]);
    assert.equal(sidecars["semantic.json"].operationalWorkload.completed, true);
    const fullWorldGraph = mutate(input, (value) => {
      value.performance.lifecycle.graphActors = counter(4);
    });
    await assert.rejects(
      () => canonical.buildViewportEvidence(fullWorldGraph),
      /Graph actor activity must match canonical fixture/,
    );
    const wrongVisibleRegion = mutate(input, (value) => {
      value.performance.lifecycle.visibleRegionId = "warm_springs";
    });
    await assert.rejects(
      () => canonical.buildViewportEvidence(wrongVisibleRegion),
      /visible Graph region must match canonical fixture/,
    );
    const driftedPressure = mutate(input, (value) => {
      value.semantic.terminalObservation.frame.world.regionPressure[0].population_high_water += 1;
    });
    await assert.rejects(
      () => canonical.buildViewportEvidence(driftedPressure),
      /terminal presented world differs from trusted region_pressure/,
    );
    const unpublishedPressure = mutate(input, (value) => {
      delete value.semantic.terminalObservation.frame.world.regionPressure;
    });
    await assert.rejects(
      () => canonical.buildViewportEvidence(unpublishedPressure),
      /terminal presented frame did not publish trusted region_pressure/,
    );
    const reorderedPressure = mutate(input, (value) => {
      value.semantic.terminalObservation.frame.world.regionPressure.reverse();
    });
    assert.deepEqual(
      (await canonical.buildViewportEvidence(reorderedPressure))["semantic.json"]
        .terminalObservation.frame.world.regionPressure.map(({ region }) => region),
      terminalSnapshot.region_pressure.map(({ region }) => region).reverse(),
      "region pressure binds by region identity, not authored order",
    );
  } finally {
    await analysis.cleanup();
  }
});

test("a trusted snapshot fact with no presented projection fails by name", async () => {
  const variantDirectory = "fixtures-unprojected";
  await mkdir(path.join(TRUSTED_ROOT, variantDirectory), { recursive: true });
  const fixture = JSON.parse(await readFile(path.join(TRUSTED_ROOT, "fixtures", "C03.json"), "utf8"));
  fixture.initialSnapshot.tide_level = 3;
  await writeFile(
    path.join(TRUSTED_ROOT, variantDirectory, "C03.json"),
    canonicalJson(fixture),
  );
  const oracle = createChronicleEvidenceOracle({
    ...TRUSTED_CONFIG,
    fixtureDirectory: variantDirectory,
  });
  const input = makeInput("C03");
  input.semantic.terminalAuthority = trustedTerminalAuthority(fixture);
  await assert.rejects(
    () => oracle.buildViewportEvidence(input),
    /terminal presented world has no projection for trusted tide_level/,
  );
});

test("writer persists only canonical evidence sidecars", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vivarium-chronicle-evidence-"));
  try {
    const written = await writeViewportEvidence(root, makeInput());
    assert.deepEqual(written, [...EVIDENCE_SIDECAR_FILES]);
    for (const filename of written) {
      const raw = await readFile(path.join(root, filename), "utf8");
      assert.equal(raw, canonicalJson(JSON.parse(raw)));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
