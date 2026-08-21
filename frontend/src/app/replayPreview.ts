import type {
  ReplayArtifactClient,
  ReplayArtifacts,
} from "./replayArtifactClient";
import {
  adaptReplaySessionToRenderSnapshot,
  type ReplayRenderSnapshot,
} from "./replayRenderAdapter";
import {
  createReplaySession,
  type ReplaySessionCheckpointSelector,
  type ReplaySessionState,
} from "./replaySession";

export type ReplayPreviewStatus = "none" | "ready" | "error";
export type ReplayPreviewErrorCategory = "artifact_load" | "restore" | "render";
export type ReplayPreviewNoneReason = "no_checkpoint";

export interface ReplayPreviewArtifactSummary {
  eventCount: number;
  checkpointCount: number;
  checkpointIndexCount: number;
}

export interface ReplayPreviewErrorDetail {
  source: ReplayPreviewErrorCategory;
  category: ReplayPreviewErrorCategory;
  message: string;
  code: string | null;
}

export type ReplayPreviewResult =
  | ReplayPreviewNoneResult
  | ReplayPreviewReadyResult
  | ReplayPreviewErrorResult;

export interface ReplayPreviewNoneResult {
  status: "none";
  reason: ReplayPreviewNoneReason;
  selector: ReplaySessionCheckpointSelector | null;
  artifacts: ReplayPreviewArtifactSummary;
  sessionState: ReplaySessionState | null;
}

export interface ReplayPreviewReadyResult {
  status: "ready";
  selector: ReplaySessionCheckpointSelector;
  artifacts: ReplayPreviewArtifactSummary;
  sessionState: Extract<ReplaySessionState, { status: "ready" }>;
  restoreMetadata: Extract<ReplaySessionState, { status: "ready" }>["metadata"];
  renderSnapshot: ReplayRenderSnapshot["snapshot"];
  renderMetadata: ReplayRenderSnapshot["metadata"];
}

export interface ReplayPreviewErrorResult {
  status: "error";
  selector: ReplaySessionCheckpointSelector | null;
  artifacts: ReplayPreviewArtifactSummary;
  sessionState: ReplaySessionState | null;
  error: ReplayPreviewErrorDetail;
}

export interface BuildReplayPreviewOptions {
  selector?: ReplaySessionCheckpointSelector;
}

export interface LoadReplayPreviewOptions extends BuildReplayPreviewOptions {
  client?: ReplayArtifactClient;
}

export function buildReplayPreviewFromArtifacts(
  artifacts: ReplayArtifacts,
  options: BuildReplayPreviewOptions = {},
): ReplayPreviewResult {
  const artifactSummary = summarizeArtifacts(artifacts);
  if (Array.isArray(artifacts?.checkpoints) && artifacts.checkpoints.length === 0) {
    return noneReplayPreview(
      artifactSummary,
      copySelector(options.selector ?? null),
      null,
    );
  }

  const selector = options.selector ?? defaultCheckpointSelector(artifacts);
  if (!selector) {
    return noneReplayPreview(artifactSummary, null, null);
  }

  const session = createReplaySession();
  let sessionState: ReplaySessionState;
  try {
    sessionState = session.restore(artifacts, selector);
  } catch (error) {
    return errorReplayPreview(
      "restore",
      errorMessage(error),
      errorCode(error),
      artifactSummary,
      copySelector(selector),
      null,
    );
  }

  return buildReplayPreviewFromSessionState(sessionState, artifactSummary);
}

export async function loadReplayPreview(
  options: LoadReplayPreviewOptions = {},
): Promise<ReplayPreviewResult> {
  const client: ReplayArtifactClient = options.client ?? (
    await import("./replayArtifactClient")
      .then(({ createReplayArtifactClient }) => createReplayArtifactClient())
  );
  let artifacts: ReplayArtifacts;

  try {
    artifacts = await client.fetchArtifacts();
  } catch (error) {
    return errorReplayPreview(
      "artifact_load",
      errorMessage(error),
      errorCode(error),
      emptyArtifactSummary(),
      copySelector(options.selector ?? null),
      null,
    );
  }

  return buildReplayPreviewFromArtifacts(artifacts, {
    selector: options.selector,
  });
}

export function buildReplayPreviewFromSessionState(
  sessionState: ReplaySessionState,
  artifactSummary: ReplayPreviewArtifactSummary = emptyArtifactSummary(),
): ReplayPreviewResult {
  if (sessionState.status === "idle") {
    return noneReplayPreview(artifactSummary, null, sessionState);
  }

  if (sessionState.status === "error") {
    return errorReplayPreview(
      "restore",
      sessionState.error.message,
      sessionState.error.code,
      artifactSummary,
      copySelector(sessionState.selector),
      sessionState,
    );
  }

  const selector = copySelector(sessionState.selector);
  if (!selector) {
    return errorReplayPreview(
      "render",
      "Replay preview requires a stable selector for ready replay sessions.",
      null,
      artifactSummary,
      null,
      sessionState,
    );
  }

  if (!sessionState.state.baseSnapshot) {
    return noneReplayPreview(artifactSummary, selector, sessionState);
  }

  let renderOutput: ReplayRenderSnapshot | null;
  try {
    renderOutput = adaptReplaySessionToRenderSnapshot(sessionState);
  } catch (error) {
    return errorReplayPreview(
      "render",
      errorMessage(error),
      errorCode(error),
      artifactSummary,
      selector,
      sessionState,
    );
  }

  if (!renderOutput) {
    return errorReplayPreview(
      "render",
      "Replay render adapter returned no snapshot for a ready replay session.",
      null,
      artifactSummary,
      selector,
      sessionState,
    );
  }

  return {
    status: "ready",
    selector,
    artifacts: artifactSummary,
    sessionState,
    restoreMetadata: sessionState.metadata,
    renderSnapshot: renderOutput.snapshot,
    renderMetadata: renderOutput.metadata,
  };
}

function defaultCheckpointSelector(
  artifacts: ReplayArtifacts,
): ReplaySessionCheckpointSelector | null {
  const checkpoints = Array.isArray(artifacts?.checkpoints)
    ? artifacts.checkpoints
    : null;
  if (!checkpoints || checkpoints.length === 0) {
    return checkpoints ? null : { index: 0 };
  }
  return { index: checkpoints.length - 1 };
}

function summarizeArtifacts(
  artifacts: ReplayArtifacts,
): ReplayPreviewArtifactSummary {
  return {
    eventCount: Array.isArray(artifacts?.events) ? artifacts.events.length : 0,
    checkpointCount: Array.isArray(artifacts?.checkpoints)
      ? artifacts.checkpoints.length
      : 0,
    checkpointIndexCount: Array.isArray(artifacts?.checkpointIndex)
      ? artifacts.checkpointIndex.length
      : 0,
  };
}

function emptyArtifactSummary(): ReplayPreviewArtifactSummary {
  return {
    eventCount: 0,
    checkpointCount: 0,
    checkpointIndexCount: 0,
  };
}

function noneReplayPreview(
  artifacts: ReplayPreviewArtifactSummary,
  selector: ReplaySessionCheckpointSelector | null,
  sessionState: ReplaySessionState | null,
): ReplayPreviewNoneResult {
  return {
    status: "none",
    reason: "no_checkpoint",
    selector: copySelector(selector),
    artifacts,
    sessionState,
  };
}

function errorReplayPreview(
  category: ReplayPreviewErrorCategory,
  message: string,
  code: string | null,
  artifacts: ReplayPreviewArtifactSummary,
  selector: ReplaySessionCheckpointSelector | null,
  sessionState: ReplaySessionState | null,
): ReplayPreviewErrorResult {
  return {
    status: "error",
    selector: copySelector(selector),
    artifacts,
    sessionState,
    error: {
      source: category,
      category,
      message,
      code,
    },
  };
}

function copySelector(
  selector: ReplaySessionCheckpointSelector | null,
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

function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}
