import type {
  ReplayArtifacts,
  ReplayPresentationWindow,
} from "./replayArtifactClient";
import type { ReplayState } from "./replayReducer";
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
