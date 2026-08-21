import type { ReplayMetadata } from "./replayMetadata";
import type { WorldSnapshot } from "./schemas";

export type ReplayModeEntryStatus = "inactive" | "ready" | "error";
export type ReplayModeKind = "live" | "archive-preview";
export type ReplayModeExactness = "exact" | "approximate" | "unknown";
export type ReplayCheckpointIdentityKind = "lineNumber" | "index";
export type ReplayModeInactiveReason =
  | "metadata_idle"
  | "metadata_loading"
  | "no_checkpoint"
  | "not_ready"
  | "not_exact";

interface ReplayModeEntryBase {
  status: ReplayModeEntryStatus;
  mode: ReplayModeKind;
  selectedCheckpointIndex: number | null;
  selectedCheckpointLineNumber: number | null;
  checkpointIdentityKind: ReplayCheckpointIdentityKind | null;
  checkpointIdentity: string | null;
  checkpointEventCursor: number | null;
  checkpointWorldTime: number | null;
  renderedEventCursor: number | null;
  renderedWorldTime: number | null;
  finalStateExact: boolean | null;
  eventOverlayApplied: boolean | null;
  appliedEventCount: number | null;
  stopReason: ReplayMetadata["preview"]["stopReason"];
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number | null;
}

export type ReplayModeEntry =
  | (ReplayModeEntryBase & {
      status: "inactive";
      mode: "live";
      reason: ReplayModeInactiveReason;
      renderSnapshot: null;
      exactness: "unknown";
      error: null;
    })
  | (ReplayModeEntryBase & {
      status: "ready";
      mode: "archive-preview";
      reason: null;
      renderSnapshot: WorldSnapshot;
      exactness: "exact";
      error: null;
    })
  | (ReplayModeEntryBase & {
      status: "error";
      mode: ReplayModeKind;
      reason: null;
      renderSnapshot: null;
      exactness: "unknown";
      error: string;
    });

export function buildReplayModeEntry(metadata: ReplayMetadata): ReplayModeEntry {
  const preview = metadata.preview;

  if (metadata.status === "idle" || metadata.status === "loading") {
    return inactiveReplayModeEntry(
      metadata.status === "idle" ? "metadata_idle" : "metadata_loading",
    );
  }

  if (metadata.status === "error") {
    return {
      ...baseReplayModeEntry("error", "live", metadata),
      reason: null,
      renderSnapshot: null,
      exactness: "unknown",
      error: metadata.error ?? "Archive unavailable.",
    };
  }

  if (preview.status === "none") {
    return inactiveReplayModeEntry(
      preview.reason === "no_checkpoint" ? "no_checkpoint" : "not_ready",
      metadata,
    );
  }

  if (preview.status === "error") {
    return {
      ...baseReplayModeEntry("error", "archive-preview", metadata),
      reason: null,
      renderSnapshot: null,
      exactness: "unknown",
      error: preview.error ?? "Preview unavailable.",
    };
  }

  if (!preview.renderSnapshot) {
    return inactiveReplayModeEntry("not_ready", metadata);
  }

  if (
    preview.finalStateExact !== true ||
    preview.eventOverlayApplied !== false ||
    preview.selectedCheckpointIndex === null
  ) {
    return inactiveReplayModeEntry("not_exact", metadata);
  }

  return {
    ...baseReplayModeEntry("ready", "archive-preview", metadata),
    reason: null,
    renderSnapshot: preview.renderSnapshot,
    exactness: "exact",
    error: null,
  };
}

function inactiveReplayModeEntry(
  reason: ReplayModeInactiveReason,
  metadata?: ReplayMetadata,
): ReplayModeEntry {
  return {
    ...baseReplayModeEntry("inactive", "live", metadata),
    reason,
    renderSnapshot: null,
    exactness: "unknown",
    error: null,
  };
}

function baseReplayModeEntry<
  TStatus extends ReplayModeEntryStatus,
  TMode extends ReplayModeKind,
>(
  status: TStatus,
  mode: TMode,
  metadata?: ReplayMetadata,
): ReplayModeEntryBase & { status: TStatus; mode: TMode } {
  const preview = metadata?.preview;
  const identity = replayCheckpointIdentity(preview);
  return {
    status,
    mode,
    selectedCheckpointIndex: preview?.selectedCheckpointIndex ?? null,
    selectedCheckpointLineNumber: preview?.selectedCheckpointLineNumber ?? null,
    checkpointIdentityKind: identity.kind,
    checkpointIdentity: identity.value,
    checkpointEventCursor: preview?.checkpointEventCursor ?? null,
    checkpointWorldTime: preview?.checkpointWorldTime ?? null,
    renderedEventCursor: preview?.renderedEventCursor ?? null,
    renderedWorldTime: preview?.renderedWorldTime ?? null,
    finalStateExact: preview?.finalStateExact ?? null,
    eventOverlayApplied: preview?.eventOverlayApplied ?? null,
    appliedEventCount: preview?.appliedEventCount ?? null,
    stopReason: preview?.stopReason ?? null,
    stoppedBeforeCursor: preview?.stoppedBeforeCursor ?? null,
    nextExpectedCursor: preview?.nextExpectedCursor ?? null,
  };
}

function replayCheckpointIdentity(
  preview: ReplayMetadata["preview"] | undefined,
): {
  kind: ReplayCheckpointIdentityKind | null;
  value: string | null;
} {
  if (!preview) {
    return { kind: null, value: null };
  }
  if (preview.selectedCheckpointLineNumber !== null) {
    return {
      kind: "lineNumber",
      value: String(preview.selectedCheckpointLineNumber),
    };
  }
  if (preview.selectedCheckpointIndex !== null) {
    return {
      kind: "index",
      value: String(preview.selectedCheckpointIndex),
    };
  }
  return { kind: null, value: null };
}
