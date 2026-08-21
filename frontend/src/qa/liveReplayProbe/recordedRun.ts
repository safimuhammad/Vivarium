/**
 * TEMPORARY EXPERIMENT HARNESS -- live-replay probe (measurement, not a feature).
 *
 * The Node half: reads a real recorded backend run (`runs/*.jsonl`) off disk and
 * hands the text to the environment-free parser in `recordedRunText.ts`, which
 * the browser replay route uses unchanged. Everything else — the port of the
 * server's `_resolve_event`, the envelope shaping, the run metadata — lives
 * there, so there is exactly one copy of each.
 */

import { readFileSync } from "node:fs";

import {
  parseRecordedRun,
  parseRecordedSnapshots,
  type LoadRecordedRunOptions,
  type RecordedRun,
  type RecordedSnapshotRecord,
} from "./recordedRunText";

export {
  envelopeForBatch,
  recordedRunMetadata,
  resolveEventHints,
  restampSnapshot,
  type LoadRecordedRunOptions,
  type RecordedEventLine,
  type RecordedRun,
  type RecordedSnapshotRecord,
} from "./recordedRunText";

/** Reads a recorded `events.jsonl` into cursor-ordered live ingress entries. */
export function loadRecordedRun(
  path: string,
  options: LoadRecordedRunOptions = {},
): RecordedRun {
  return parseRecordedRun(readFileSync(path, "utf8"), path, options);
}

/** Reads a recorded `snapshots.jsonl` of real `world_snapshot_checkpoint` records. */
export function loadRecordedSnapshots(path: string): readonly RecordedSnapshotRecord[] {
  return parseRecordedSnapshots(readFileSync(path, "utf8"));
}
