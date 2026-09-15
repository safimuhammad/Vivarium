import type {
  ReplayArtifacts,
  ReplayPresentationWindow,
} from "./replayArtifactClient";
import type { ReplayState } from "./replayReducer";
import { parseSpatialTravelEvent } from "../presentation/eventPayloads";
import {
  restoreReplayFromArtifacts,
  type ReplayRestoreCheckpointSelector,
  type ReplayRestoreError,
  type ReplayRestoreMetadata,
} from "./replayRestore";

export type ReplaySessionStatus = "idle" | "ready" | "error";
export type ReplaySessionCheckpointSelector = ReplayRestoreCheckpointSelector;

export type ReplaySessionState =
  | {
      status: "idle";
      state: null;
      metadata: null;
      error: null;
      selector: null;
    }
  | {
      status: "ready";
      state: ReplayState;
      metadata: ReplayRestoreMetadata;
      error: null;
      selector: ReplaySessionCheckpointSelector;
    }
  | {
      status: "error";
      state: null;
      metadata: null;
      error: ReplayRestoreError;
      selector: ReplaySessionCheckpointSelector | null;
    };

export type ReplaySessionListener = () => void;

export interface ReplaySession {
  getState(): ReplaySessionState;
  getPresentationWindow(): ReplayPresentationWindow | null;
  restore(
    artifacts: ReplayArtifacts,
    selector: ReplayRestoreCheckpointSelector,
  ): ReplaySessionState;
  reset(): ReplaySessionState;
  subscribe(listener: ReplaySessionListener): () => void;
}

export function createReplaySession(): ReplaySession {
  let sessionState: ReplaySessionState = idleState();
  let presentationWindow: ReplayPresentationWindow | null = null;
  const listeners = new Set<ReplaySessionListener>();

  function setState(nextState: ReplaySessionState): ReplaySessionState {
    sessionState = nextState;
    for (const listener of listeners) {
      listener();
    }
    return sessionState;
  }

  return {
    getState: () => sessionState,
    getPresentationWindow: () => presentationWindow,
    restore(artifacts, selector) {
      const stableSelector = copyStableSelector(selector);
      presentationWindow = null;

      try {
        const result = restoreReplayFromArtifacts(artifacts, selector);
        if (result.status === "ready") {
          if (!stableSelector) {
            return setState({
              status: "error",
              state: null,
              metadata: null,
              error: {
                code: "invalid_selector",
                message:
                  "Replay session restore requires a stable checkpoint selector identity.",
              },
              selector: null,
            });
          }

          presentationWindow = createReplayPresentationWindow(
            artifacts,
            stableSelector,
          );

          return setState({
            status: "ready",
            state: result.state,
            metadata: result.metadata,
            error: null,
            selector: stableSelector,
          });
        }

        return setState({
          status: "error",
          state: null,
          metadata: null,
          error: result.error,
          selector: stableSelector,
        });
      } catch (error) {
        return setState({
          status: "error",
          state: null,
          metadata: null,
          error: {
            code: "hydrate_failed",
            message: `Replay session restore failed: ${errorMessage(error)}`,
          },
          selector: stableSelector,
        });
      }
    },
    reset() {
      presentationWindow = null;
      return setState(idleState());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Builds a renderer-safe historical window for one authoritative travel event.
 *
 * The ordinary Archive picker restores a selected checkpoint and gives its
 * whole retained suffix to the normal presentation queue. A Chronicle replay
 * card needs a stricter boundary: the selected card's world must be established
 * before anything later can clear or relocate that body. This selects the
 * newest checkpoint that was already true at the event's recorded time, applies
 * only the contiguous prefix through the card, and leaves the later suffix for
 * the archive session's replay clock.
 *
 * `null` is intentional. It preserves the prior moment-focus behavior when a
 * recording lacks a spatial checkpoint, the clicked event is malformed or
 * non-spatial, or the bounded artifact cannot prove a contiguous prefix.
 */
export function createHistoricalReplayPresentationWindow(
  artifacts: ReplayArtifacts,
  targetCursor: number,
): ReplayPresentationWindow | null {
  if (!Number.isSafeInteger(targetCursor) || targetCursor < 0) return null;
  if (!Array.isArray(artifacts.events) || !Array.isArray(artifacts.checkpoints)) {
    return null;
  }

  const byCursor = new Map<number, ReplayArtifacts["events"][number]>();
  for (const entry of artifacts.events) {
    if (!Number.isSafeInteger(entry.cursor) || entry.cursor < 0) return null;
    if (byCursor.has(entry.cursor)) return null;
    byCursor.set(entry.cursor, entry);
  }
  const target = byCursor.get(targetCursor);
  if (target === undefined || !Number.isFinite(target.event.timestamp)) return null;
  try {
    if (parseSpatialTravelEvent(target) === null) return null;
  } catch {
    return null;
  }

  const selected = artifacts.checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .filter(({ checkpoint }) => (
      (artifacts.runId === undefined || checkpoint.run_id === artifacts.runId)
      && checkpoint.snapshot.run_id === checkpoint.run_id
      && checkpoint.event_cursor <= targetCursor
      && checkpoint.world_time <= target.event.timestamp
      && checkpoint.snapshot.event_cursor === checkpoint.event_cursor
      && checkpoint.snapshot.world_time === checkpoint.world_time
      && checkpoint.snapshot.regions.some((region) => region.spatial !== undefined)
    ))
    .sort((left, right) => (
      right.checkpoint.event_cursor - left.checkpoint.event_cursor
      || right.checkpoint.world_time - left.checkpoint.world_time
      || right.index - left.index
    ))[0];
  if (selected === undefined) return null;

  const prefix: ReplayPresentationWindow["entries"][number][] = [];
  let priorTimestamp = selected.checkpoint.world_time;
  for (let cursor = selected.checkpoint.event_cursor + 1; cursor <= targetCursor; cursor += 1) {
    const entry = byCursor.get(cursor);
    if (
      entry === undefined
      || !Number.isFinite(entry.event.timestamp)
      || entry.event.timestamp < priorTimestamp
    ) return null;
    prefix.push(structuredClone(entry));
    priorTimestamp = entry.event.timestamp;
  }

  const continuation: ReplayPresentationWindow["entries"][number][] = [];
  let expectedCursor = targetCursor + 1;
  let continuationTimestamp = target.event.timestamp;
  for (;;) {
    const entry = byCursor.get(expectedCursor);
    if (entry === undefined) break;
    if (
      !Number.isFinite(entry.event.timestamp)
      || entry.event.timestamp < continuationTimestamp
    ) return null;
    continuation.push(structuredClone(entry));
    continuationTimestamp = entry.event.timestamp;
    expectedCursor += 1;
  }

  const checkpoint = selected.checkpoint;
  const checkpointIdentity = checkpoint.lineNumber === undefined
    ? `index-${selected.index}`
    : `line-${checkpoint.lineNumber}`;
  return deepFreeze({
    sourceKey: `archive:${encodeURIComponent(checkpoint.run_id)}:${checkpointIdentity}:replay-${checkpoint.event_cursor}-${targetCursor}`,
    checkpointIndex: selected.index,
    checkpointLineNumber: checkpoint.lineNumber ?? null,
    checkpointReason: checkpoint.reason,
    checkpointWorldTime: checkpoint.world_time,
    firstCursor: checkpoint.event_cursor,
    lastCursor: targetCursor,
    snapshot: structuredClone(checkpoint.snapshot),
    entries: prefix,
    historical: {
      targetCursor,
      targetWorldTime: target.event.timestamp,
      continuation,
    },
  });
}

function idleState(): ReplaySessionState {
  return {
    status: "idle",
    state: null,
    metadata: null,
    error: null,
    selector: null,
  };
}

function copyStableSelector(
  selector: ReplayRestoreCheckpointSelector,
): ReplaySessionCheckpointSelector | null {
  if (selector === null || typeof selector !== "object" || Array.isArray(selector)) {
    return null;
  }

  const input = selector as Record<string, unknown>;
  const hasIndex = Object.prototype.hasOwnProperty.call(input, "index");
  const hasLineNumber = Object.prototype.hasOwnProperty.call(input, "lineNumber");
  if (hasIndex === hasLineNumber) {
    return null;
  }

  if (
    hasIndex &&
    typeof input.index === "number" &&
    Number.isInteger(input.index) &&
    input.index >= 0
  ) {
    return { index: input.index };
  }
  if (
    hasLineNumber &&
    typeof input.lineNumber === "number" &&
    Number.isInteger(input.lineNumber) &&
    input.lineNumber >= 1
  ) {
    return { lineNumber: input.lineNumber };
  }
  return null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function createReplayPresentationWindow(
  artifacts: ReplayArtifacts,
  selector: ReplaySessionCheckpointSelector,
): ReplayPresentationWindow | null {
  const selected = selectedCheckpoint(artifacts.checkpoints, selector);
  if (selected === null) return null;
  const checkpoint = selected.checkpoint;
  if (artifacts.runId !== undefined && artifacts.runId !== checkpoint.run_id) {
    return null;
  }
  const entries: ReplayPresentationWindow["entries"][number][] = [];
  let expectedCursor = checkpoint.event_cursor + 1;
  for (const entry of artifacts.events) {
    if (entry.cursor <= checkpoint.event_cursor) continue;
    if (entry.cursor !== expectedCursor) break;
    entries.push(structuredClone(entry));
    expectedCursor += 1;
  }
  const lastCursor = entries.at(-1)?.cursor ?? checkpoint.event_cursor;
  const checkpointIdentity = checkpoint.lineNumber === undefined
    ? `index-${selected.index}`
    : `line-${checkpoint.lineNumber}`;
  return deepFreeze({
    sourceKey: `archive:${encodeURIComponent(checkpoint.run_id)}:${checkpointIdentity}:window-${checkpoint.event_cursor}-${lastCursor}`,
    checkpointIndex: selected.index,
    checkpointLineNumber: checkpoint.lineNumber ?? null,
    checkpointReason: checkpoint.reason,
    checkpointWorldTime: checkpoint.world_time,
    firstCursor: checkpoint.event_cursor,
    lastCursor,
    snapshot: structuredClone(checkpoint.snapshot),
    entries,
  });
}

function selectedCheckpoint(
  checkpoints: ReplayArtifacts["checkpoints"],
  selector: ReplaySessionCheckpointSelector,
): Readonly<{
  checkpoint: ReplayArtifacts["checkpoints"][number];
  index: number;
}> | null {
  if (selector === null || typeof selector !== "object" || Array.isArray(selector)) {
    return null;
  }
  const input = selector as Record<string, unknown>;
  const hasIndex = Object.prototype.hasOwnProperty.call(input, "index");
  const hasLineNumber = Object.prototype.hasOwnProperty.call(input, "lineNumber");
  if (hasIndex === hasLineNumber) return null;
  if (hasIndex) {
    const index = input.index;
    return typeof index === "number"
      && Number.isSafeInteger(index)
      && index >= 0
      && checkpoints[index] !== undefined
      ? { checkpoint: checkpoints[index], index }
      : null;
  }
  const lineNumber = input.lineNumber;
  if (
    typeof lineNumber !== "number"
    || !Number.isSafeInteger(lineNumber)
    || lineNumber < 1
  ) return null;
  const matches = checkpoints.flatMap((checkpoint, index) => (
    checkpoint.lineNumber === lineNumber ? [{ checkpoint, index }] : []
  ));
  return matches.length === 1 ? matches[0] : null;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
