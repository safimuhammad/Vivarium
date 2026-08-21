import { classifyRunAcceptance } from "../../app/client";
import type {
  EventEnvelope,
  RunMetadata,
} from "../../app/schemas";
import type { StartLiveRunOptions } from "../../app/useLiveRun";
import type { ClassifiedCheckpointRecord } from "../contracts";
import {
  FIXTURE_PRESENTATION_SOURCE,
  type ChronicleManifest,
} from "./chronicleCatalog";

export interface FixtureTransportCallbacks {
  readonly onRunAccepted: NonNullable<StartLiveRunOptions["onRunAccepted"]>;
  readonly onSnapshotAccepted: NonNullable<StartLiveRunOptions["onSnapshotAccepted"]>;
  readonly onEnvelopeAccepted: NonNullable<StartLiveRunOptions["onEnvelopeAccepted"]>;
  readonly onCheckpointAccepted: (record: ClassifiedCheckpointRecord) => void;
}

export interface FixtureTransport {
  start(manifest: ChronicleManifest): void;
  deliverThroughCursor(cursor: number): void;
  deliverAll(): void;
  replaceRun(manifest: ChronicleManifest): void;
  dispose(): void;
}

interface ActiveFixtureRun {
  readonly generation: number;
  readonly manifest: ChronicleManifest;
  deliveredEntryCount: number;
  deliveredCheckpointCount: number;
}

/** Creates a provider-free Chronicle transport over the active Live ingress callbacks. */
export function createFixtureTransport(
  callbacks: FixtureTransportCallbacks,
): FixtureTransport {
  let disposed = false;
  let generation = 0;
  let currentRunId: string | null = null;
  let active: ActiveFixtureRun | null = null;

  const isCurrent = (candidate: ActiveFixtureRun): boolean => (
    !disposed
    && active === candidate
    && candidate.generation === generation
  );

  const acceptManifest = (manifest: ChronicleManifest): void => {
    if (disposed) return;
    generation += 1;
    const candidate: ActiveFixtureRun = {
      generation,
      manifest,
      deliveredEntryCount: 0,
      deliveredCheckpointCount: 0,
    };
    active = candidate;
    const disposition = classifyRunAcceptance(currentRunId, manifest.runId);
    currentRunId = manifest.runId;
    callbacks.onRunAccepted(makeFixtureRunMetadata(manifest), disposition);
    if (!isCurrent(candidate)) return;
    callbacks.onSnapshotAccepted(manifest.initialSnapshot);
  };

  const deliverThroughCursor = (cursor: number): void => {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError("fixture delivery cursor must be a non-negative safe integer");
    }
    const candidate = active;
    if (disposed || candidate === null) return;

    while (isCurrent(candidate)) {
      const entry = candidate.manifest.entries[candidate.deliveredEntryCount];
      const record = candidate.manifest.checkpoints[candidate.deliveredCheckpointCount];
      const entryEligible = entry !== undefined && entry.cursor <= cursor;
      const checkpointEligible = record !== undefined
        && record.checkpoint.event_cursor <= cursor;
      if (!entryEligible && !checkpointEligible) break;

      if (
        checkpointEligible
        && (!entryEligible || record.checkpoint.event_cursor < entry.cursor)
      ) {
        candidate.deliveredCheckpointCount += 1;
        callbacks.onCheckpointAccepted(record);
      } else if (entryEligible) {
        candidate.deliveredEntryCount += 1;
        callbacks.onEnvelopeAccepted(envelopeForEntry(entry));
      }
    }
  };

  return {
    start(manifest): void {
      if (disposed) return;
      if (active !== null) {
        throw new Error("FixtureTransport already started; use replaceRun");
      }
      acceptManifest(manifest);
    },
    deliverThroughCursor,
    deliverAll(): void {
      const candidate = active;
      if (disposed || candidate === null) return;
      deliverThroughCursor(candidate.manifest.expectedFinalCursor);
    },
    replaceRun(manifest): void {
      acceptManifest(manifest);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      active = null;
    },
  };
}

function makeFixtureRunMetadata(manifest: ChronicleManifest): RunMetadata {
  return {
    schema: 1,
    run_id: manifest.runId,
    seed: manifest.seed,
    started_at: manifest.initialSnapshot.world_time,
    status: "running",
    event_cursor: manifest.initialSnapshot.event_cursor,
    world_time: manifest.initialSnapshot.world_time,
    config_hash: `fixture:${manifest.id}:v${manifest.version}`,
    constants: {},
    seed_persona: null,
    provider: FIXTURE_PRESENTATION_SOURCE,
    model: FIXTURE_PRESENTATION_SOURCE,
    context_window: null,
    timing: {},
    artifacts: {
      events: "fixture",
      usage: "fixture",
      snapshots: "fixture",
      memory_root: "fixture",
    },
  };
}

function envelopeForEntry(
  entry: ChronicleManifest["entries"][number],
): EventEnvelope {
  return {
    schema: 1,
    cursor: Math.max(0, entry.cursor - 1),
    oldest_cursor: entry.cursor,
    next_cursor: entry.cursor,
    events: [entry],
    overflow: false,
    snapshot_required: false,
  };
}
