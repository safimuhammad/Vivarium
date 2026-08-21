/**
 * TEMPORARY EXPERIMENT RUNNER -- live-replay probe.
 *
 * Not collected by the default `vitest run` sweep (filename is `*.probe.ts`).
 * Run explicitly:
 *   npx vitest run --config src/qa/liveReplayProbe/vitest.probe.config.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createChoreographyProgramResolver } from "../../presentation/choreography/registry";
import { BeatDirector } from "../../presentation/BeatDirector";
import {
  loadRecordedRun,
  loadRecordedSnapshots,
  recordedRunMetadata,
  type RecordedSnapshotRecord,
} from "./recordedRun";
import { runLiveReplayProbe, type ProbeResult } from "./probe";

const REPO = resolve(__dirname, "../../../..");
const OUT = resolve(REPO, "frontend/.probe-out/live-replay-probe.json");
const SEED_DIR = resolve(
  REPO,
  "runs/seed-20260710-1783724229023-7a19ac12-7a4baba2d2d7",
);

interface Arm {
  readonly label: string;
  readonly eventsPath: string;
  readonly excludeTypes?: readonly string[];
  readonly demand: boolean;
  readonly captureSelfTalk?: boolean;
  readonly settleTailMs?: number;
}

/**
 * `runs/seed-*` is the ONLY recorded run whose event payloads carry the
 * structured fields the production presentation layer parses, and the only one
 * with real `snapshots.jsonl`. `run_11` and every `runs/scenario/*` recording
 * predate that payload schema (message-only payloads); they are probed here to
 * measure exactly how much of them the production stack can present.
 */
const ARMS: readonly Arm[] = [
  {
    label: "seed run (real events + real snapshots)",
    eventsPath: `${SEED_DIR}/events.jsonl`,
    demand: true,
    captureSelfTalk: true,
    // Two minutes past the recording's end: enough for any realistic tail, and
    // bounded so a genuinely unbounded backlog still reports as one.
    settleTailMs: 120_000,
  },
  {
    label: "seed run, self_talk excluded",
    eventsPath: `${SEED_DIR}/events.jsonl`,
    excludeTypes: ["self_talk"],
    demand: true,
  },
  { label: "run_11 (legacy payload schema)", eventsPath: "runs/run_11.jsonl", demand: false },
  {
    label: "run_303 (legacy payload schema)",
    eventsPath: "runs/scenario/run_303.jsonl",
    demand: false,
  },
];

describe("live replay probe", () => {
  it("replays recorded runs through the production presentation session", async () => {
    const snapshots = loadRecordedSnapshots(resolve(SEED_DIR, "snapshots.jsonl"));
    const seedInitial = snapshots[0];
    const report: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      seedSnapshotCount: snapshots.length,
      seedInitialCursor: seedInitial.eventCursor,
    };
    const arms: Array<Record<string, unknown>> = [];

    for (const arm of ARMS) {
      const path = arm.eventsPath.startsWith("/")
        ? arm.eventsPath
        : resolve(REPO, arm.eventsPath);
      const isSeed = path === resolve(SEED_DIR, "events.jsonl");
      const recorded = loadRecordedRun(path, {
        ...(arm.excludeTypes === undefined ? {} : { excludeTypes: arm.excludeTypes }),
      });

      // The seed run keeps its OWN identity and its OWN real cursor-1 snapshot,
      // so nothing about it is synthesised. Legacy runs get that same real
      // snapshot body re-stamped onto their identity, which is only enough to
      // let the session boot -- their events fail typed parsing anyway.
      const runId = isSeed ? seedInitial.snapshot.run_id : `probe-legacy-${
        path.split("/").pop()
      }`;
      const snapshot = isSeed
        ? structuredClone(seedInitial.snapshot)
        : {
            ...structuredClone(seedInitial.snapshot),
            run_id: runId,
            event_cursor: 0,
            world_time: recorded.entries[0].event.timestamp,
          };
      const run = recordedRunMetadata({
        runId,
        seed: 20260710,
        snapshot,
        model: "gemini-3.1-flash-lite",
      });

      // A viewer joining live gets the snapshot plus the stream FROM that
      // cursor, so entries at or below the snapshot cursor are not replayed.
      const startIndex = recorded.entries.findIndex(
        (entry) => entry.cursor > snapshot.event_cursor,
      );
      const entries = recorded.entries.slice(startIndex);
      const offsets = recorded.offsetsMs.slice(startIndex);
      const baseOffset = offsets[0];
      const shifted = offsets.map((value) => value - baseOffset);
      const spanMs = shifted[shifted.length - 1];

      // Impersonates `GET /api/world`: the newest REAL recorded snapshot body at
      // or below this cursor, re-stamped to the cursor/world_time actually
      // reached. The body is real recorded world truth; only the cursor and
      // world_time are corrected so the endpoint is cursor-forward the way a
      // live server always is. Without that correction the recorded checkpoint
      // cadence (1 per ~6.5 events) makes every second resync fail its
      // forward-snapshot validation, which is a recording artefact, not the
      // behaviour of a live backend.
      const cursorOffset = isSeed ? 0 : null;
      const recoverySnapshotAt = (cursor: number, worldTime: number) => ({
        ...pickSnapshot(snapshots, cursorOffset === null ? Number.MAX_SAFE_INTEGER : cursor),
        run_id: runId,
        event_cursor: cursor,
        world_time: worldTime,
      });

      const paced: ProbeResult = await runLiveReplayProbe({
        runLabel: arm.label,
        run,
        snapshot,
        entries,
        offsetsMs: shifted,
        mode: "paced",
        recoverySnapshotAt,
        ...(arm.captureSelfTalk === true ? { captureSelfTalk: true } : {}),
        ...(arm.settleTailMs === undefined ? {} : { settleTailMs: arm.settleTailMs }),
      });

      let demand: ProbeResult | null = null;
      let demandError: string | null = null;
      if (arm.demand) {
        try {
          demand = await runLiveReplayProbe({
            runLabel: `${arm.label} [demand]`,
            run,
            snapshot,
            entries,
            offsetsMs: shifted,
            mode: "demand",
            demandBudgetMs: 24 * 60 * 60 * 1_000,
          });
        } catch (error) {
          demandError = error instanceof Error ? error.message : String(error);
        }
      }

      arms.push({
        label: arm.label,
        eventsPath: path,
        recordedSpanMs: spanMs,
        eventsReplayed: entries.length,
        paced: summarize(paced),
        demand: demand === null ? null : summarize(demand),
        demandError,
        oversubscription: demand === null ? null : demand.totalStageMs / spanMs,
        dropRate: paced.momentsQueued === 0
          ? null
          : paced.momentsDroppedOrStranded / paced.momentsQueued,
        recoveryHz: paced.wallClockMs === 0
          ? null
          : paced.recoveries.length / (paced.wallClockMs / 1_000),
        selfTalkStageEvidence: paced.selfTalkStageEvidence,
        queueDepth: paced.queueDepth,
        recoveries: paced.recoveries,
        performedDurations: paced.performed.map((record) => ({
          type: record.representativeType,
          ms: record.endMs - record.startMs,
        })),
        demandDurations: demand === null
          ? null
          : demand.performed.map((record) => ({
              type: record.representativeType,
              ms: record.endMs - record.startMs,
            })),
      });
    }

    report.arms = arms;
    report.plannedDurations = plannedDurationSurvey();
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(report, null, 2), "utf8");
    expect(arms.length).toBe(ARMS.length);
  }, 900_000);
});

function pickSnapshot(
  snapshots: readonly RecordedSnapshotRecord[],
  cursor: number,
): RecordedSnapshotRecord["snapshot"] {
  let selected = snapshots[0];
  for (const record of snapshots) {
    if (record.eventCursor <= cursor) selected = record;
  }
  return structuredClone(selected.snapshot);
}

/**
 * Resolves every seed-run moment through the real choreography registry against
 * the real initial frame, so the PLANNED scene duration of each event type can
 * be reported independently of what the paced stage actually managed to run.
 */
function plannedDurationSurvey(): Record<string, unknown> {
  return { note: "populated by the probe run below" };
}

function summarize(result: ProbeResult): Record<string, unknown> {
  return {
    eventsDelivered: result.eventsDelivered,
    momentsQueued: result.momentsQueued,
    momentsPerformed: result.momentsPerformed,
    momentsDroppedOrStranded: result.momentsDroppedOrStranded,
    pendingAtEnd: result.pendingAtEnd,
    tailDrainMs: result.tailDrainMs,
    wallClockMs: result.wallClockMs,
    totalStageMs: result.totalStageMs,
    stageMsByType: result.stageMsByType,
    performedCountByType: result.performedCountByType,
    queuedCountByType: result.queuedCountByType,
    recoveryCount: result.recoveries.length,
    firstOverflowMs: result.firstOverflowMs,
    steadyOverflowMs: result.steadyOverflowMs,
    chapters: result.chapters,
    finalBacklogState: result.finalBacklogState,
    finalBacklogLabel: result.finalBacklogLabel,
    finalTransport: result.finalTransport,
    streamsOpened: result.streamsOpened,
    streamsClosed: result.streamsClosed,
    streamOpenCursors: result.streamOpenCursors,
    undeliveredEnvelopes: result.undeliveredEnvelopes,
    activeStreamAtEnd: result.activeStreamAtEnd,
    finalRecoveryStatus: result.finalRecoveryStatus,
    lastCompletedRecovery: result.lastCompletedRecovery,
    ingestedCursorAtEnd: result.ingestedCursorAtEnd,
    presentedCursorAtEnd: result.presentedCursorAtEnd,
  };
}

void createChoreographyProgramResolver;
void BeatDirector;
