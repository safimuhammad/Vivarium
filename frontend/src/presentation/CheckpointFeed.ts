import {
  CheckpointRunMismatchError,
  createHttpCheckpointApiClient,
  type CheckpointApiClient,
  type CheckpointRecord,
  type CheckpointRecordPage,
} from "../app/checkpointClient";
import { HttpResponseError } from "../app/client";
import type {
  ClassifiedCheckpointRecord,
  LiveCutSafety,
} from "./contracts";

/**
 * Records requested per page.
 *
 * Measured: a real checkpoint serialises to ~5.4 KB, so the previous 64 came to
 * ~343 KB against the server's 327,680-byte cap — every page over-budget from
 * roughly four minutes of world age. 16 leaves about four times the headroom on
 * a typical roster; the server's clamp (and `truncated`) is what guarantees the
 * rest as the roster grows.
 */
const CHECKPOINT_PAGE_LIMIT = 16;
/**
 * How far back a join or a recovery reads before it starts paging forward.
 *
 * The feed used to reset `lastDeliveredLine` to 0 and walk from line 1 on EVERY
 * join and every recovery — a day-old world needed ~364 sequential fetches, the
 * only genuinely O(all history) thing in the join path. It was also pure waste:
 * a checkpoint is a whole world snapshot, the newest supersedes every older one,
 * and the feed itself retains only `CHECKPOINT_FEED_RETAINED_SAFE_LIMIT` digests.
 * So a join anchors at the newest checkpoint and reads back exactly one page.
 */
const CHECKPOINT_JOIN_BACKFILL_LINES = CHECKPOINT_PAGE_LIMIT;
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const MAX_CHECKPOINT_FEED_LISTENERS = 64;
const MAX_RETAINED_FAULT_IDENTITIES = 128;

// A forever-running feed retains only the newest 64 live-safe checkpoint digests.
export const CHECKPOINT_FEED_RETAINED_SAFE_LIMIT = 64;

export interface CheckpointFeed {
  start(identity: { runId: string; sourceKey: string }): void;
  subscribe(listener: (record: ClassifiedCheckpointRecord) => void): () => void;
  subscribeFault(listener: (fault: CheckpointFeedFault) => void): () => void;
  reset(identity: { runId: string; sourceKey: string }): void;
  diagnostics(): CheckpointFeedDiagnostics;
  dispose(): void;
}

export interface CheckpointFeedFault {
  readonly kind: "oversized-record" | "run-mismatch" | "unavailable";
  readonly line: number | null;
  readonly retryable: boolean;
}

export interface CheckpointFeedDiagnostics {
  readonly disposed: boolean;
  readonly runId: string | null;
  readonly lastDeliveredLine: number;
  readonly polling: boolean;
  readonly retainedSafeCheckpoints: number;
  readonly faultCount: number;
}

export interface CheckpointFeedScheduledTask {
  cancel(): void;
}

export interface CheckpointFeedScheduler {
  schedule(
    delayMs: number,
    callback: () => void | Promise<void>,
  ): CheckpointFeedScheduledTask;
}

export interface CheckpointFeedOptions {
  readonly createClient?: (signal: AbortSignal) => CheckpointApiClient;
  readonly scheduler?: CheckpointFeedScheduler;
  readonly pollIntervalMs?: number;
  readonly probeManifestBeforeRepeat?: boolean;
}

/** Creates an identity-scoped, line-ordered checkpoint polling feed. */
export function createCheckpointFeed(
  options: CheckpointFeedOptions = {},
): CheckpointFeed {
  const scheduler = options.scheduler ?? browserCheckpointFeedScheduler;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const probeManifestBeforeRepeat = options.probeManifestBeforeRepeat
    ?? options.createClient === undefined;
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0) {
    throw new RangeError("pollIntervalMs must be a non-negative finite number");
  }

  let disposed = false;
  let runId: string | null = null;
  let sourceKey: string | null = null;
  let generation = 0;
  let polling = false;
  let lastDeliveredLine = 0;
  let anchored = false;
  let scheduled: CheckpointFeedScheduledTask | null = null;
  let controller: AbortController | null = null;
  let retainedSafeDigests: string[] = [];
  let faultIdentities: string[] = [];
  const listeners = new Set<(record: ClassifiedCheckpointRecord) => void>();
  const faultListeners = new Set<(fault: CheckpointFeedFault) => void>();

  const isCurrent = (candidate: number): boolean => (
    !disposed && candidate === generation && runId !== null && sourceKey !== null
  );

  const emitFault = (candidate: number, fault: CheckpointFeedFault): void => {
    if (!isCurrent(candidate)) return;
    const identity = `${fault.kind}:${fault.line ?? "none"}:${fault.retryable}`;
    if (faultIdentities.includes(identity)) return;
    faultIdentities = [...faultIdentities, identity].slice(-MAX_RETAINED_FAULT_IDENTITIES);
    for (const listener of [...faultListeners]) {
      if (!isCurrent(candidate)) return;
      try {
        listener(fault);
      } catch {
        // Fault observers are isolated from feed ownership and peer delivery.
      }
    }
  };

  const retainSafeDigest = (record: ClassifiedCheckpointRecord): void => {
    if (record.safety !== "safe-world-tick") return;
    const digest = `${record.line}:${record.checkpoint.run_id}:${record.checkpoint.event_cursor}:${record.checkpoint.world_time}`;
    retainedSafeDigests = [
      ...retainedSafeDigests.filter((retained) => retained !== digest),
      digest,
    ].slice(-CHECKPOINT_FEED_RETAINED_SAFE_LIMIT);
  };

  const schedulePoll = (candidate: number, delayMs: number): void => {
    if (!isCurrent(candidate)) return;
    scheduled?.cancel();
    scheduled = scheduler.schedule(delayMs, () => poll(candidate));
  };

  const poll = async (candidate: number): Promise<void> => {
    if (!isCurrent(candidate) || controller === null || runId === null) return;
    const activeController = controller;
    scheduled = null;
    polling = true;
    const acceptedRunId = runId;
    const client = (options.createClient ?? defaultClientFactory(acceptedRunId))(
      controller.signal,
    );
    let retry = true;
    try {
      if (probeManifestBeforeRepeat && lastDeliveredLine > 0) {
        const manifest = await client.getReplayManifest();
        if (!isCurrent(candidate)) return;
        if (manifest.runId !== acceptedRunId) {
          throw new CheckpointRunMismatchError(
            "checkpoint manifest run does not match feed identity",
            manifest.lastCheckpointLine,
          );
        }
        if (
          manifest.lastCheckpointLine === null
          || manifest.lastCheckpointLine <= lastDeliveredLine
        ) return;
      }
      let latest = await client.getLatestCheckpoint();
      if (!isCurrent(candidate) || latest === null) return;
      assertRecordRun(latest, acceptedRunId);
      if (latest.line <= lastDeliveredLine) return;
      const observedLatestLine = latest.line;
      latest = null;
      if (!anchored) {
        anchored = true;
        lastDeliveredLine = Math.max(
          lastDeliveredLine,
          observedLatestLine - CHECKPOINT_JOIN_BACKFILL_LINES,
        );
      }

      while (lastDeliveredLine < observedLatestLine) {
        const acceptedLine = lastDeliveredLine;
        const before = Math.min(
          observedLatestLine + 1,
          acceptedLine + CHECKPOINT_PAGE_LIMIT + 1,
        );
        let page: CheckpointRecordPage | null = await client.getCheckpointPage(
          before,
          CHECKPOINT_PAGE_LIMIT,
        );
        if (!isCurrent(candidate)) return;
        const forwardRecords = validatedForwardWindow(
          page,
          acceptedRunId,
          acceptedLine,
          before,
        );
        page = null;

        for (const record of forwardRecords) {
          if (!isCurrent(candidate)) return;
          const classified: ClassifiedCheckpointRecord = {
            line: record.line,
            checkpoint: record.checkpoint,
            safety: classifyCheckpointSafety(record),
          };
          retainSafeDigest(classified);
          lastDeliveredLine = record.line;
          for (const listener of [...listeners]) {
            if (!isCurrent(candidate)) return;
            try {
              listener(classified);
            } catch {
              // Record observers are isolated so one consumer cannot stall the feed.
            }
          }
        }
      }
    } catch (error) {
      if (!isCurrent(candidate) || activeController.signal.aborted) return;
      if (error instanceof CheckpointRunMismatchError) {
        retry = false;
        emitFault(candidate, { kind: "run-mismatch", line: error.line, retryable: false });
      } else if (error instanceof HttpResponseError && error.status === 413) {
        retry = false;
        emitFault(candidate, {
          kind: "oversized-record",
          line: null,
          retryable: false,
        });
      } else {
        emitFault(candidate, { kind: "unavailable", line: null, retryable: true });
      }
    } finally {
      if (isCurrent(candidate)) {
        polling = false;
        if (retry) schedulePoll(candidate, pollIntervalMs);
      }
    }
  };

  const reset = (identity: { runId: string; sourceKey: string }): void => {
    if (disposed) return;
    assertIdentity(identity);
    generation += 1;
    scheduled?.cancel();
    scheduled = null;
    controller?.abort();
    controller = new AbortController();
    runId = identity.runId;
    sourceKey = identity.sourceKey;
    polling = false;
    lastDeliveredLine = 0;
    anchored = false;
    retainedSafeDigests = [];
    faultIdentities = [];
    schedulePoll(generation, 0);
  };

  return {
    start: reset,
    subscribe(listener): () => void {
      if (disposed) return inertUnsubscribe;
      addBoundedListener(listeners, listener);
      return () => { listeners.delete(listener); };
    },
    subscribeFault(listener): () => void {
      if (disposed) return inertUnsubscribe;
      addBoundedListener(faultListeners, listener);
      return () => { faultListeners.delete(listener); };
    },
    reset,
    diagnostics(): CheckpointFeedDiagnostics {
      return {
        disposed,
        runId,
        lastDeliveredLine,
        polling,
        retainedSafeCheckpoints: retainedSafeDigests.length,
        faultCount: faultIdentities.length,
      };
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      generation += 1;
      scheduled?.cancel();
      scheduled = null;
      controller?.abort();
      controller = null;
      polling = false;
      listeners.clear();
      faultListeners.clear();
      retainedSafeDigests = [];
      faultIdentities = [];
    },
  };
}

function validatedForwardWindow(
  page: CheckpointRecordPage,
  expectedRunId: string,
  acceptedLine: number,
  before: number,
): readonly CheckpointRecord[] {
  if (page.runId !== expectedRunId) {
    throw new CheckpointRunMismatchError(
      "checkpoint page run does not match feed identity",
      page.records[0]?.line ?? null,
    );
  }
  if (page.before !== before || page.records.length === 0) {
    throw new Error("checkpoint page does not cover the requested forward window");
  }
  let previousLine = 0;
  for (const record of page.records) {
    assertRecordRun(record, expectedRunId);
    if (record.line <= previousLine || record.line >= before) {
      throw new Error("checkpoint page records must be strictly ordered before the window");
    }
    previousLine = record.line;
  }
  const pageFirstLine = page.records[0].line;
  if (page.nextBefore !== pageFirstLine) {
    throw new Error("checkpoint page nextBefore must identify its first record");
  }
  if (page.hasMore !== (pageFirstLine > 1)) {
    throw new Error("checkpoint page hasMore does not match its first record");
  }

  const forwardRecords = page.records.filter((record) => record.line > acceptedLine);
  const requestedLength = before - acceptedLine - 1;
  if (forwardRecords.length > requestedLength) {
    throw new Error("checkpoint page has an unresolved forward line range");
  }
  // A page SHORTER than requested is legal only when the server says it clamped the
  // page to its own byte budget. It drops from the oldest end, so what survives is
  // still the newest contiguous run ending at `before - 1`; the lines it dropped are
  // strictly older than the ones delivered and a checkpoint is a whole world
  // snapshot, so the newest supersedes them. Anything else short is a hole, and a
  // hole in checkpoint reconciliation is silent world drift.
  if (forwardRecords.length < requestedLength && !page.truncated) {
    throw new Error("checkpoint page has an unresolved forward line range");
  }
  const firstForwardLine = before - forwardRecords.length;
  forwardRecords.forEach((record, index) => {
    if (record.line !== firstForwardLine + index) {
      throw new Error("checkpoint page forward line range is not contiguous");
    }
  });
  return forwardRecords;
}

function defaultClientFactory(
  expectedRunId: string,
): (signal: AbortSignal) => CheckpointApiClient {
  return (signal) => createHttpCheckpointApiClient({ expectedRunId, signal });
}

function classifyCheckpointSafety(record: CheckpointRecord): LiveCutSafety {
  if (record.checkpoint.reason === "world_tick") return "safe-world-tick";
  if (record.checkpoint.reason.startsWith("event:")) return "archive-event";
  return "archive-manual";
}

function assertRecordRun(record: CheckpointRecord, expectedRunId: string): void {
  if (record.checkpoint.run_id !== expectedRunId) {
    throw new CheckpointRunMismatchError(
      "checkpoint record run does not match feed identity",
      record.line,
    );
  }
}

function assertIdentity(identity: { runId: string; sourceKey: string }): void {
  if (identity.runId.trim() === "" || identity.sourceKey.trim() === "") {
    throw new Error("checkpoint feed identity values must not be empty");
  }
}

function inertUnsubscribe(): void {}

function addBoundedListener<T>(listeners: Set<T>, listener: T): void {
  if (!listeners.has(listener) && listeners.size >= MAX_CHECKPOINT_FEED_LISTENERS) {
    throw new Error(`checkpoint feed listener limit ${MAX_CHECKPOINT_FEED_LISTENERS} exceeded`);
  }
  listeners.add(listener);
}

const browserCheckpointFeedScheduler: CheckpointFeedScheduler = {
  schedule(delayMs, callback): CheckpointFeedScheduledTask {
    const timeout = globalThis.setTimeout(() => { void callback(); }, delayMs);
    return { cancel: () => { globalThis.clearTimeout(timeout); } };
  },
};
