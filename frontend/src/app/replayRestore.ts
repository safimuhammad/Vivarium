import type { ReplayArtifacts } from "./replayArtifactClient";
import {
  hydrateReplayFromCheckpoint,
  type HydratedReplay,
  type SnapshotCheckpoint,
} from "./replayArtifacts";
import {
  replayHasExactWorldState,
  type ReplayState,
} from "./replayReducer";

export type ReplayRestoreCheckpointSelector =
  | {
      index: number;
      lineNumber?: never;
    }
  | {
      lineNumber: number;
      index?: never;
    };

export type ReplayRestoreErrorCode =
  | "empty_checkpoints"
  | "checkpoint_index_out_of_range"
  | "checkpoint_line_number_missing"
  | "checkpoint_line_number_duplicate"
  | "invalid_selector"
  | "malformed_artifacts"
  | "hydrate_failed";

export interface ReplayRestoreError {
  code: ReplayRestoreErrorCode;
  message: string;
}

export interface ReplayRestoreMetadata {
  checkpointIndex: number;
  lineNumber: number | null;
  eventCursor: number;
  worldTime: number;
  reason: string;
  runId: string;
  appliedEventCount: number;
  skippedBeforeCheckpointCount: number;
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number;
  stopReason: HydratedReplay["stopReason"];
  checkpointStateExact: boolean;
  eventOverlayApplied: boolean;
  finalStateExact: boolean;
}

export type ReplayRestoreResult =
  | {
      status: "ready";
      state: ReplayState;
      metadata: ReplayRestoreMetadata;
      error: null;
    }
  | {
      status: "error";
      state: null;
      metadata: null;
      error: ReplayRestoreError;
    };

interface SelectedCheckpoint {
  checkpoint: SnapshotCheckpoint;
  index: number;
}

export function restoreReplayFromArtifacts(
  artifacts: ReplayArtifacts,
  selector: ReplayRestoreCheckpointSelector,
): ReplayRestoreResult {
  try {
    const selected = selectCheckpoint(artifacts, selector);
    if ("error" in selected) {
      return errorResult(selected.error.code, selected.error.message);
    }

    const hydrated = hydrateReplayFromCheckpoint(
      selected.checkpoint,
      artifacts.events,
    );

    return {
      status: "ready",
      state: hydrated.state,
      metadata: restoreMetadata(selected, hydrated),
      error: null,
    };
  } catch (error) {
    return errorResult(
      "hydrate_failed",
      `Replay checkpoint restore failed: ${errorMessage(error)}`,
    );
  }
}

function selectCheckpoint(
  artifacts: ReplayArtifacts,
  selector: ReplayRestoreCheckpointSelector,
): SelectedCheckpoint | { error: ReplayRestoreError } {
  const artifactError = validateArtifacts(artifacts);
  if (artifactError) {
    return { error: artifactError };
  }

  if (artifacts.checkpoints.length === 0) {
    return {
      error: {
        code: "empty_checkpoints",
        message: "Replay restore requires at least one snapshot checkpoint.",
      },
    };
  }

  const selectorKind = selectorKindOf(selector);
  if (selectorKind === "invalid") {
    return {
      error: {
        code: "invalid_selector",
        message:
          "Replay restore checkpoint selector must contain exactly one stable identity: index or lineNumber.",
      },
    };
  }

  if (selectorKind === "index") {
    return selectCheckpointByIndex(artifacts.checkpoints, selector.index);
  }

  return selectCheckpointByLineNumber(
    artifacts.checkpoints,
    selector.lineNumber,
  );
}

function selectCheckpointByIndex(
  checkpoints: readonly SnapshotCheckpoint[],
  index: unknown,
): SelectedCheckpoint | { error: ReplayRestoreError } {
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) {
    return {
      error: {
        code: "invalid_selector",
        message: "Replay restore checkpoint index must be a zero-based integer.",
      },
    };
  }

  const checkpoint = checkpoints[index];
  if (!checkpoint) {
    return {
      error: {
        code: "checkpoint_index_out_of_range",
        message: `Replay restore checkpoint index ${index} is out of range for ${checkpoints.length} checkpoint(s).`,
      },
    };
  }

  return { checkpoint, index };
}

function selectCheckpointByLineNumber(
  checkpoints: readonly SnapshotCheckpoint[],
  lineNumber: unknown,
): SelectedCheckpoint | { error: ReplayRestoreError } {
  if (
    typeof lineNumber !== "number" ||
    !Number.isInteger(lineNumber) ||
    lineNumber < 1
  ) {
    return {
      error: {
        code: "invalid_selector",
        message: "Replay restore checkpoint lineNumber must be a one-based integer.",
      },
    };
  }

  const matches: SelectedCheckpoint[] = [];
  checkpoints.forEach((checkpoint, index) => {
    if (checkpoint.lineNumber === lineNumber) {
      matches.push({ checkpoint, index });
    }
  });

  if (matches.length === 0) {
    return {
      error: {
        code: "checkpoint_line_number_missing",
        message: `Replay restore checkpoint line ${lineNumber} was not found.`,
      },
    };
  }

  if (matches.length > 1) {
    return {
      error: {
        code: "checkpoint_line_number_duplicate",
        message: `Replay restore checkpoint line ${lineNumber} matched ${matches.length} checkpoints.`,
      },
    };
  }

  return matches[0];
}

function restoreMetadata(
  selected: SelectedCheckpoint,
  hydrated: HydratedReplay,
): ReplayRestoreMetadata {
  const checkpoint = selected.checkpoint;
  return {
    checkpointIndex: selected.index,
    lineNumber: checkpoint.lineNumber ?? null,
    eventCursor: checkpoint.event_cursor,
    worldTime: checkpoint.world_time,
    reason: checkpoint.reason,
    runId: checkpoint.run_id,
    appliedEventCount: hydrated.appliedEventCount,
    skippedBeforeCheckpointCount: hydrated.skippedBeforeCheckpointCount,
    stoppedBeforeCursor: hydrated.stoppedBeforeCursor,
    nextExpectedCursor: hydrated.nextExpectedCursor,
    stopReason: hydrated.stopReason,
    checkpointStateExact: true,
    eventOverlayApplied: hydrated.appliedEventCount > 0,
    finalStateExact: replayHasExactWorldState(hydrated.state),
  };
}

function validateArtifacts(artifacts: ReplayArtifacts): ReplayRestoreError | null {
  if (artifacts === null || typeof artifacts !== "object") {
    return {
      code: "malformed_artifacts",
      message: "Replay restore artifacts must be an object.",
    };
  }
  if (!Array.isArray(artifacts.events)) {
    return {
      code: "malformed_artifacts",
      message: "Replay restore artifacts.events must be an array.",
    };
  }
  if (!Array.isArray(artifacts.checkpoints)) {
    return {
      code: "malformed_artifacts",
      message: "Replay restore artifacts.checkpoints must be an array.",
    };
  }
  return null;
}

function selectorKindOf(
  selector: ReplayRestoreCheckpointSelector,
): "index" | "lineNumber" | "invalid" {
  if (selector === null || typeof selector !== "object" || Array.isArray(selector)) {
    return "invalid";
  }

  const hasIndex = Object.prototype.hasOwnProperty.call(selector, "index");
  const hasLineNumber = Object.prototype.hasOwnProperty.call(selector, "lineNumber");
  if (hasIndex === hasLineNumber) {
    return "invalid";
  }

  return hasIndex ? "index" : "lineNumber";
}

function errorResult(
  code: ReplayRestoreErrorCode,
  message: string,
): ReplayRestoreResult {
  return {
    status: "error",
    state: null,
    metadata: null,
    error: { code, message },
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
