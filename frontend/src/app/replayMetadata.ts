import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type ReplayArtifactClient,
  type ReplayArtifacts,
} from "./replayArtifactClient";
import { boundReplayArtifacts } from "./replayWorkingSet";
import {
  restoreReplayFromArtifacts,
  type ReplayRestoreMetadata,
} from "./replayRestore";
import {
  selectPresentedArchiveChronicleWindow,
  type PresentedHistoryEvent,
} from "./historySelectors";
import {
  createArchivePresentationContextIndex,
  type ArchivePresentationContextIndex,
  type ArchivePresentationProvenance,
} from "./replayArchiveContext";
import {
  buildReplayPreviewFromArtifacts,
  type ReplayPreviewErrorCategory,
  type ReplayPreviewNoneReason,
  type ReplayPreviewResult,
} from "./replayPreview";
import type { ReplaySessionCheckpointSelector } from "./replaySession";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import type { RunMetadata, WorldSnapshot } from "./schemas";

export type ReplayMetadataStatus = "idle" | "loading" | "ready" | "error";
export type ReplayRestoreCapabilityStatus = "none" | "ready" | "error";
export type ReplayPreviewMetadataStatus = "none" | "ready" | "error";
export type ReplayOlderPageStatus = "idle" | "loading" | "error";

const ARCHIVE_CHRONICLE_PREVIEW_LIMIT = 2;

export interface DuplicateCheckpointCursor {
  eventCursor: number;
  count: number;
}

export interface ReplayCheckpointOption {
  index: number;
  lineNumber: number | null;
  eventCursor: number;
  worldTime: number;
  reason: string;
  runId: string;
}

export interface ReplayMetadata {
  status: ReplayMetadataStatus;
  runId: string | null;
  artifactIdentityKey: string | null;
  workingSetRevision: number;
  error: string | null;
  loadDiagnostics: ReplayArtifactLoadDiagnostics;
  eventCount: number;
  eventLineCursorStart: number | null;
  eventLineCursorEnd: number | null;
  checkpointCount: number;
  checkpointOptions: ReplayCheckpointOption[];
  firstCheckpointEventCursor: number | null;
  firstCheckpointWorldTime: number | null;
  lastCheckpointEventCursor: number | null;
  lastCheckpointWorldTime: number | null;
  duplicateCheckpointCursorCount: number;
  duplicateCheckpointCursors: DuplicateCheckpointCursor[];
  archiveChronicle: ReplayArchiveChronicle;
  restoreCapability: ReplayRestoreCapability;
  preview: ReplayPreviewMetadata;
  hasOlderCheckpoints: boolean;
  olderPageStatus: ReplayOlderPageStatus;
  olderPageError: string | null;
  loadOlderCheckpoints(): void;
}

export type ReplayArtifactLoadSettledStatus =
  | "none"
  | "loading"
  | "ready"
  | "error"
  | "stale_ready"
  | "stale_error"
  | "idle";

export interface ReplayArtifactLoadDiagnostics {
  currentRequestId: number | null;
  activeRequestId: number | null;
  completedLoadCount: number;
  lastCompletedRequestId: number | null;
  lastSettledRequestId: number | null;
  lastSettledStatus: ReplayArtifactLoadSettledStatus;
  staleDropCount: number;
  lastStaleRequestId: number | null;
}

export interface ReplayRestoreCapability {
  status: ReplayRestoreCapabilityStatus;
  error: string | null;
  selectedCheckpointIndex: number | null;
  selectedCheckpointLineNumber: number | null;
  eventCursor: number | null;
  worldTime: number | null;
  finalStateExact: boolean | null;
  eventOverlayApplied: boolean | null;
  appliedEventCount: number | null;
  stopReason: ReplayRestoreMetadata["stopReason"];
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number | null;
}

export interface ReplayPreviewMetadata {
  status: ReplayPreviewMetadataStatus;
  renderSnapshot: WorldSnapshot | null;
  reason: ReplayPreviewNoneReason | null;
  error: string | null;
  errorSource: ReplayPreviewErrorCategory | null;
  errorCode: string | null;
  selectedCheckpointIndex: number | null;
  selectedCheckpointLineNumber: number | null;
  checkpointEventCursor: number | null;
  checkpointWorldTime: number | null;
  renderedEventCursor: number | null;
  renderedWorldTime: number | null;
  finalStateExact: boolean | null;
  eventOverlayApplied: boolean | null;
  appliedEventCount: number | null;
  stopReason: ReplayRestoreMetadata["stopReason"];
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number | null;
  unrenderedAgentCount: number;
  unrenderedHomeCount: number;
  synthesizedHomeCount: number;
}

export interface ReplayArchiveChronicle {
  eventCount: number;
  visibleCount: number;
  items: ReplayArchiveChronicleItem[];
  window: ReplayArchiveChronicleWindow;
}

export type ReplayArchiveChronicleOrder = "newest_first";

export interface ReplayArchiveChronicleWindow {
  windowStart: number;
  windowEnd: number;
  windowSize: number;
  itemCount: number;
  totalVisibleCount: number;
  hasPrevious: boolean;
  hasNext: boolean;
  order: ReplayArchiveChronicleOrder;
  rawCursorStart: number | null;
  rawCursorEnd: number | null;
  visibleCursorStart: number | null;
  visibleCursorEnd: number | null;
}

export type ReplayArchiveChronicleItem = PresentedHistoryEvent & {
  provenance: ArchivePresentationProvenance;
};

export interface UseReplayMetadataOptions {
  client?: ReplayArtifactClient;
  selector?: ReplaySessionCheckpointSelector | null;
  archiveWindowStart?: number;
  onSelectorReconciled?(selector: ReplaySessionCheckpointSelector): void;
}

export function useReplayMetadata(
  run: RunMetadata | null,
  options: UseReplayMetadataOptions = {},
): ReplayMetadata {
  const fallbackClient = useMemo(() => createLazyReplayArtifactClient(), []);
  const client = options.client ?? fallbackClient;
  const selector = options.selector ?? null;
  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const onSelectorReconciled = options.onSelectorReconciled;
  const archiveWindowStart = options.archiveWindowStart ?? 0;
  const artifactsKey = replayArtifactIdentityKey(run);
  const runId = run?.run_id ?? null;
  const latestLoadRequestId = useRef(0);
  const mountedRef = useRef(true);
  const [loadDiagnostics, setLoadDiagnostics] = useState<ReplayArtifactLoadDiagnostics>(
    () => emptyReplayArtifactLoadDiagnostics(),
  );
  const [loadState, setLoadState] = useState<ReplayMetadataLoadState>(
    () => ({
      status: "idle",
      runId: null,
      artifactIdentityKey: null,
      workingSetRevision: 0,
      artifacts: null,
      error: null,
    }),
  );
  const olderPageRequestId = useRef(0);
  const [olderPageState, setOlderPageState] = useState<{
    status: ReplayOlderPageStatus;
    error: string | null;
  }>({ status: "idle", error: null });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const requestId = ++latestLoadRequestId.current;
    ++olderPageRequestId.current;
    setOlderPageState({ status: "idle", error: null });
    if (!runId || !artifactsKey) {
      setLoadState({
        status: "idle",
        runId: null,
        artifactIdentityKey: null,
        workingSetRevision: 0,
        artifacts: null,
        error: null,
      });
      setLoadDiagnostics((previous) => ({
        ...previous,
        currentRequestId: null,
        activeRequestId: null,
        lastSettledStatus: "idle",
      }));
      return undefined;
    }

    setLoadDiagnostics((previous) => ({
      ...previous,
      currentRequestId: requestId,
      activeRequestId: requestId,
      lastSettledStatus: "loading",
    }));
    setLoadState({
      status: "loading",
      runId,
      artifactIdentityKey: artifactsKey,
      workingSetRevision: requestId,
      artifacts: null,
      error: null,
    });
    void client.fetchForRun(runId).then((artifacts) => {
      if (!mountedRef.current) {
        return;
      }
      if (latestLoadRequestId.current === requestId) {
        setLoadDiagnostics((previous) => ({
          ...previous,
          currentRequestId: requestId,
          activeRequestId: null,
          completedLoadCount: previous.completedLoadCount + 1,
          lastCompletedRequestId: requestId,
          lastSettledRequestId: requestId,
          lastSettledStatus: "ready",
        }));
        setLoadState({
          status: "ready",
          runId,
          artifactIdentityKey: artifactsKey,
          workingSetRevision: requestId,
          artifacts,
          error: null,
        });
      } else {
        setLoadDiagnostics((previous) => ({
          ...previous,
          lastSettledRequestId: requestId,
          lastSettledStatus: "stale_ready",
          staleDropCount: previous.staleDropCount + 1,
          lastStaleRequestId: requestId,
        }));
      }
    }).catch((error: unknown) => {
      if (!mountedRef.current) {
        return;
      }
      if (latestLoadRequestId.current === requestId) {
        setLoadDiagnostics((previous) => ({
          ...previous,
          currentRequestId: requestId,
          activeRequestId: null,
          completedLoadCount: previous.completedLoadCount + 1,
          lastCompletedRequestId: requestId,
          lastSettledRequestId: requestId,
          lastSettledStatus: "error",
        }));
        setLoadState({
          status: "error",
          runId,
          artifactIdentityKey: artifactsKey,
          workingSetRevision: requestId,
          artifacts: null,
          error,
        });
      } else {
        setLoadDiagnostics((previous) => ({
          ...previous,
          lastSettledRequestId: requestId,
          lastSettledStatus: "stale_error",
          staleDropCount: previous.staleDropCount + 1,
          lastStaleRequestId: requestId,
        }));
      }
    });

    return () => {
      if (latestLoadRequestId.current === requestId) {
        ++latestLoadRequestId.current;
      }
    };
  }, [artifactsKey, client, runId]);

  const loadOlderCheckpoints = useCallback(() => {
    if (
      loadState.status !== "ready" ||
      !loadState.artifacts.hasOlderCheckpoints ||
      olderPageState.status === "loading"
    ) {
      return;
    }
    const activeLoadRequestId = latestLoadRequestId.current;
    const requestId = ++olderPageRequestId.current;
    const sourceArtifacts = loadState.artifacts;
    setOlderPageState({ status: "loading", error: null });
    void client.fetchOlderArtifacts(sourceArtifacts).then(async (artifacts) => {
      const reconciledSelector = await client.reconcileSelector(
        sourceArtifacts,
        artifacts,
        selector,
      );
      if (
        !mountedRef.current ||
        latestLoadRequestId.current !== activeLoadRequestId ||
        olderPageRequestId.current !== requestId
      ) {
        return;
      }
      if (selectorRef.current === selector) {
        if (reconciledSelector) {
          onSelectorReconciled?.(reconciledSelector);
        }
        setLoadState((current) =>
          current.status === "ready" && current.artifacts === sourceArtifacts
            ? {
                ...current,
                artifacts,
                workingSetRevision: current.workingSetRevision + 1,
              }
            : current
        );
      }
      setOlderPageState({ status: "idle", error: null });
    }).catch((error: unknown) => {
      if (
        !mountedRef.current ||
        latestLoadRequestId.current !== activeLoadRequestId ||
        olderPageRequestId.current !== requestId
      ) {
        return;
      }
      setOlderPageState({ status: "error", error: errorMessage(error) });
    });
  }, [client, loadState, olderPageState.status, onSelectorReconciled, selector]);

  const metadata = useMemo(() => metadataFromLoadState(
    loadState,
    selector,
    archiveWindowStart,
    loadDiagnostics,
  ), [
    archiveWindowStart,
    loadDiagnostics,
    loadState,
    selector,
  ]);
  return useMemo(() => ({
    ...metadata,
    hasOlderCheckpoints:
      loadState.status === "ready" && Boolean(loadState.artifacts.hasOlderCheckpoints),
    olderPageStatus: olderPageState.status,
    olderPageError: olderPageState.error,
    loadOlderCheckpoints,
  }), [loadOlderCheckpoints, loadState, metadata, olderPageState]);
}

type ReplayMetadataLoadState =
  | {
      status: "idle";
      runId: null;
      artifactIdentityKey: null;
      workingSetRevision: 0;
      artifacts: null;
      error: null;
    }
  | {
      status: "loading";
      runId: string;
      artifactIdentityKey: string;
      workingSetRevision: number;
      artifacts: null;
      error: null;
    }
  | {
      status: "ready";
      runId: string;
      artifactIdentityKey: string;
      workingSetRevision: number;
      artifacts: ReplayArtifacts;
      error: null;
    }
  | {
      status: "error";
      runId: string;
      artifactIdentityKey: string;
      workingSetRevision: number;
      artifacts: null;
      error: unknown;
    };

export interface LoadReplayMetadataOptions {
  selector?: ReplaySessionCheckpointSelector | null;
  archiveWindowStart?: number;
}

export async function loadReplayMetadata(
  run: RunMetadata,
  client: ReplayArtifactClient = createLazyReplayArtifactClient(),
  options: LoadReplayMetadataOptions = {},
): Promise<ReplayMetadata> {
  try {
    return summarizeReplayArtifacts(await client.fetchForRun(run.run_id), run.run_id, {
      selector: options.selector ?? null,
      archiveWindowStart: options.archiveWindowStart ?? 0,
      artifactIdentityKey: replayArtifactIdentityKey(run),
      workingSetRevision: 1,
    });
  } catch (error) {
    return errorReplayMetadata(
      run.run_id,
      error,
      emptyReplayArtifactLoadDiagnostics(),
      replayArtifactIdentityKey(run),
      1,
    );
  }
}

export interface SummarizeReplayArtifactsOptions {
  selector?: ReplaySessionCheckpointSelector | null;
  archiveWindowStart?: number;
  loadDiagnostics?: ReplayArtifactLoadDiagnostics;
  artifactIdentityKey?: string | null;
  workingSetRevision?: number;
}

export function summarizeReplayArtifacts(
  artifacts: ReplayArtifacts,
  runId: string | null = null,
  options: SummarizeReplayArtifactsOptions = {},
): ReplayMetadata {
  artifacts = boundReplayArtifacts(artifacts);
  const eventCursors = artifacts.events.map((entry) => entry.cursor);
  const firstCheckpoint = artifacts.checkpoints[0] ?? null;
  const lastCheckpoint = artifacts.checkpoints.at(-1) ?? null;
  const duplicateCheckpointCursors = summarizeDuplicateCheckpointCursors(
    artifacts.checkpoints.map((checkpoint) => checkpoint.event_cursor),
  );
  const selector = options.selector ?? null;
  const previewArtifacts = replayArtifactsForCheckpointSelection(artifacts, selector);
  const restoreCapability = evaluatePassiveRestoreCapability(previewArtifacts, selector);
  const preview = summarizePassiveReplayPreview(
    buildReplayPreviewFromArtifacts(previewArtifacts, {
      selector: selector ?? undefined,
    }),
    previewArtifacts,
  );
  const archiveContextIndex = createArchivePresentationContextIndex({
    checkpoints: artifacts.checkpoints,
    previewSnapshot: preview.renderSnapshot,
  });
  const archiveChronicle = summarizeArchiveChronicle(
    artifacts.events,
    archiveContextIndex,
    options.archiveWindowStart ?? 0,
  );

  return {
    ...baseReplayMetadata(
      "ready",
      runId,
      options.loadDiagnostics ?? emptyReplayArtifactLoadDiagnostics(),
      options.artifactIdentityKey ?? null,
      options.workingSetRevision ?? 0,
    ),
    eventCount: artifacts.events.length,
    eventLineCursorStart: minOrNull(eventCursors),
    eventLineCursorEnd: maxOrNull(eventCursors),
    checkpointCount: artifacts.checkpoints.length,
    checkpointOptions: replayCheckpointOptions(artifacts.checkpoints),
    firstCheckpointEventCursor: firstCheckpoint?.event_cursor ?? null,
    firstCheckpointWorldTime: firstCheckpoint?.world_time ?? null,
    lastCheckpointEventCursor: lastCheckpoint?.event_cursor ?? null,
    lastCheckpointWorldTime: lastCheckpoint?.world_time ?? null,
    duplicateCheckpointCursorCount: duplicateCheckpointCursors.reduce(
      (total, item) => total + item.count - 1,
      0,
    ),
    duplicateCheckpointCursors,
    archiveChronicle,
    restoreCapability,
    preview,
    hasOlderCheckpoints: Boolean(artifacts.hasOlderCheckpoints),
  };
}

export function idleReplayMetadata(
  loadDiagnostics: ReplayArtifactLoadDiagnostics = emptyReplayArtifactLoadDiagnostics(),
): ReplayMetadata {
  return baseReplayMetadata("idle", null, loadDiagnostics);
}

export function loadingReplayMetadata(
  runId: string,
  loadDiagnostics: ReplayArtifactLoadDiagnostics = emptyReplayArtifactLoadDiagnostics(),
  artifactIdentityKey: string | null = null,
  workingSetRevision = 0,
): ReplayMetadata {
  return baseReplayMetadata(
    "loading",
    runId,
    loadDiagnostics,
    artifactIdentityKey,
    workingSetRevision,
  );
}

function errorReplayMetadata(
  runId: string,
  error: unknown,
  loadDiagnostics: ReplayArtifactLoadDiagnostics = emptyReplayArtifactLoadDiagnostics(),
  artifactIdentityKey: string | null = null,
  workingSetRevision = 0,
): ReplayMetadata {
  const message = errorMessage(error);
  return {
    ...baseReplayMetadata(
      "error",
      runId,
      loadDiagnostics,
      artifactIdentityKey,
      workingSetRevision,
    ),
    error: message,
    restoreCapability: {
      ...baseRestoreCapability("error"),
      error: message,
    },
    preview: {
      ...baseReplayPreviewMetadata("error"),
      error: message,
      errorSource: "artifact_load",
    },
  };
}

function metadataFromLoadState(
  loadState: ReplayMetadataLoadState,
  selector: ReplaySessionCheckpointSelector | null,
  archiveWindowStart: number,
  loadDiagnostics: ReplayArtifactLoadDiagnostics,
): ReplayMetadata {
  switch (loadState.status) {
    case "idle":
      return idleReplayMetadata(loadDiagnostics);
    case "loading":
      return loadingReplayMetadata(
        loadState.runId,
        loadDiagnostics,
        loadState.artifactIdentityKey,
        loadState.workingSetRevision,
      );
    case "error":
      return errorReplayMetadata(
        loadState.runId,
        loadState.error,
        loadDiagnostics,
        loadState.artifactIdentityKey,
        loadState.workingSetRevision,
      );
    case "ready":
      return summarizeReplayArtifacts(loadState.artifacts, loadState.runId, {
        selector,
        archiveWindowStart,
        loadDiagnostics,
        artifactIdentityKey: loadState.artifactIdentityKey,
        workingSetRevision: loadState.workingSetRevision,
      });
  }
}

function baseReplayMetadata(
  status: ReplayMetadataStatus,
  runId: string | null,
  loadDiagnostics: ReplayArtifactLoadDiagnostics,
  artifactIdentityKey: string | null = null,
  workingSetRevision = 0,
): ReplayMetadata {
  return {
    status,
    runId,
    artifactIdentityKey,
    workingSetRevision,
    error: null,
    loadDiagnostics,
    eventCount: 0,
    eventLineCursorStart: null,
    eventLineCursorEnd: null,
    checkpointCount: 0,
    checkpointOptions: [],
    firstCheckpointEventCursor: null,
    firstCheckpointWorldTime: null,
    lastCheckpointEventCursor: null,
    lastCheckpointWorldTime: null,
    duplicateCheckpointCursorCount: 0,
    duplicateCheckpointCursors: [],
    archiveChronicle: {
      eventCount: 0,
      visibleCount: 0,
      items: [],
      window: emptyArchiveChronicleWindow(),
    },
    restoreCapability: baseRestoreCapability("none"),
    preview: baseReplayPreviewMetadata("none"),
    hasOlderCheckpoints: false,
    olderPageStatus: "idle",
    olderPageError: null,
    loadOlderCheckpoints: noOperation,
  };
}

function noOperation(): void {}

function createLazyReplayArtifactClient(): ReplayArtifactClient {
  let clientPromise: Promise<ReplayArtifactClient> | null = null;
  const client = (): Promise<ReplayArtifactClient> => {
    clientPromise ??= import("./replayArtifactClient")
      .then(({ createReplayArtifactClient }) => createReplayArtifactClient());
    return clientPromise;
  };
  return {
    fetchArtifacts: async () => (await client()).fetchArtifacts(),
    fetchForRun: async (runId) => (await client()).fetchForRun(runId),
    fetchOlderArtifacts: async (artifacts) =>
      (await client()).fetchOlderArtifacts(artifacts),
    reconcileSelector: async (previous, next, selector) =>
      (await client()).reconcileSelector(previous, next, selector),
    exportEvents: async () => (await client()).exportEvents(),
    exportSnapshots: async () => (await client()).exportSnapshots(),
    fetchEvents: async () => (await client()).fetchEvents(),
    fetchSnapshots: async () => (await client()).fetchSnapshots(),
  };
}

function emptyReplayArtifactLoadDiagnostics(): ReplayArtifactLoadDiagnostics {
  return {
    currentRequestId: null,
    activeRequestId: null,
    completedLoadCount: 0,
    lastCompletedRequestId: null,
    lastSettledRequestId: null,
    lastSettledStatus: "none",
    staleDropCount: 0,
    lastStaleRequestId: null,
  };
}

function evaluatePassiveRestoreCapability(
  artifacts: ReplayArtifacts,
  selector: ReplaySessionCheckpointSelector | null = null,
): ReplayRestoreCapability {
  const selectedCheckpointIndex = selectedCheckpointIndexFromSelector(
    artifacts.checkpoints,
    selector,
  );
  const selectedCheckpoint = selectedCheckpointIndex === null
    ? null
    : artifacts.checkpoints[selectedCheckpointIndex] ?? null;
  const result = restoreReplayFromArtifacts(
    artifacts,
    selector ?? { index: Math.max(0, artifacts.checkpoints.length - 1) },
  );

  if (result.status === "ready") {
    return restoreCapabilityFromMetadata(result.metadata);
  }

  if (result.error.code === "empty_checkpoints") {
    return baseRestoreCapability("none");
  }

  return {
    ...selectedCheckpointCapabilityFields(
      selectedCheckpointIndex ?? Math.max(0, artifacts.checkpoints.length - 1),
      selectedCheckpoint,
    ),
    status: "error",
    error: result.error.message,
  };
}

function restoreCapabilityFromMetadata(
  metadata: ReplayRestoreMetadata,
): ReplayRestoreCapability {
  return {
    status: "ready",
    error: null,
    selectedCheckpointIndex: metadata.checkpointIndex,
    selectedCheckpointLineNumber: metadata.lineNumber,
    eventCursor: metadata.eventCursor,
    worldTime: metadata.worldTime,
    finalStateExact: metadata.finalStateExact,
    eventOverlayApplied: metadata.eventOverlayApplied,
    appliedEventCount: metadata.appliedEventCount,
    stopReason: metadata.stopReason,
    stoppedBeforeCursor: metadata.stoppedBeforeCursor,
    nextExpectedCursor: metadata.nextExpectedCursor,
  };
}

function baseRestoreCapability(
  status: ReplayRestoreCapabilityStatus,
): ReplayRestoreCapability {
  return {
    status,
    error: null,
    selectedCheckpointIndex: null,
    selectedCheckpointLineNumber: null,
    eventCursor: null,
    worldTime: null,
    finalStateExact: null,
    eventOverlayApplied: null,
    appliedEventCount: null,
    stopReason: null,
    stoppedBeforeCursor: null,
    nextExpectedCursor: null,
  };
}

function selectedCheckpointCapabilityFields(
  selectedCheckpointIndex: number,
  checkpoint: SnapshotCheckpoint | null,
): ReplayRestoreCapability {
  return {
    ...baseRestoreCapability("none"),
    selectedCheckpointIndex: checkpoint ? selectedCheckpointIndex : null,
    selectedCheckpointLineNumber: checkpoint?.lineNumber ?? null,
    eventCursor: checkpoint?.event_cursor ?? null,
    worldTime: checkpoint?.world_time ?? null,
  };
}

function replayCheckpointOptions(
  checkpoints: readonly SnapshotCheckpoint[],
): ReplayCheckpointOption[] {
  return checkpoints.map((checkpoint, index) => ({
    index,
    lineNumber: checkpoint.lineNumber ?? null,
    eventCursor: checkpoint.event_cursor,
    worldTime: checkpoint.world_time,
    reason: checkpoint.reason,
    runId: checkpoint.run_id,
  }));
}

function summarizeArchiveChronicle(
  events: ReplayArtifacts["events"],
  archiveContextIndex: ArchivePresentationContextIndex,
  requestedWindowStart: number,
): ReplayArchiveChronicle {
  const selection = selectPresentedArchiveChronicleWindow(
    events,
    (entry) => archiveContextIndex.contextForCursor(entry.cursor),
    {
      windowStart: requestedWindowStart,
      windowSize: ARCHIVE_CHRONICLE_PREVIEW_LIMIT,
    },
  );
  const windowItems = selection.items
    .map((item): ReplayArchiveChronicleItem => ({
      ...item,
      provenance: archiveContextIndex.provenanceForEvent(item.cursor, item.related),
    }));
  const rawCursors = events.map((entry) => entry.cursor);
  const visibleCursors = windowItems.map((item) => item.cursor);

  return {
    eventCount: events.length,
    visibleCount: selection.totalVisibleCount,
    items: windowItems,
    window: {
      windowStart: selection.windowStart,
      windowEnd: selection.windowEnd,
      windowSize: selection.windowSize,
      itemCount: windowItems.length,
      totalVisibleCount: selection.totalVisibleCount,
      hasPrevious: selection.windowStart > 0,
      hasNext: selection.windowEnd < selection.totalVisibleCount,
      order: "newest_first",
      rawCursorStart: minOrNull(rawCursors),
      rawCursorEnd: maxOrNull(rawCursors),
      visibleCursorStart: minOrNull(visibleCursors),
      visibleCursorEnd: maxOrNull(visibleCursors),
    },
  };
}

function emptyArchiveChronicleWindow(): ReplayArchiveChronicleWindow {
  return {
    windowStart: 0,
    windowEnd: 0,
    windowSize: ARCHIVE_CHRONICLE_PREVIEW_LIMIT,
    itemCount: 0,
    totalVisibleCount: 0,
    hasPrevious: false,
    hasNext: false,
    order: "newest_first",
    rawCursorStart: null,
    rawCursorEnd: null,
    visibleCursorStart: null,
    visibleCursorEnd: null,
  };
}

function selectedCheckpointIndexFromSelector(
  checkpoints: readonly SnapshotCheckpoint[],
  selector: ReplaySessionCheckpointSelector | null,
): number | null {
  if (checkpoints.length === 0) {
    return null;
  }
  if (!selector) {
    return checkpoints.length - 1;
  }
  if ("index" in selector && typeof selector.index === "number") {
    return Number.isInteger(selector.index) && selector.index >= 0 && selector.index < checkpoints.length
      ? selector.index
      : null;
  }
  if (
    "lineNumber" in selector &&
    typeof selector.lineNumber === "number" &&
    Number.isInteger(selector.lineNumber)
  ) {
    const index = checkpoints.findIndex(
      (checkpoint) => checkpoint.lineNumber === selector.lineNumber,
    );
    return index >= 0 ? index : null;
  }
  return null;
}

function summarizePassiveReplayPreview(
  result: ReplayPreviewResult,
  artifacts: ReplayArtifacts,
): ReplayPreviewMetadata {
  if (result.status === "ready") {
    const metadata = result.renderMetadata;
    return {
      status: "ready",
      renderSnapshot: result.renderSnapshot,
      reason: null,
      error: null,
      errorSource: null,
      errorCode: null,
      selectedCheckpointIndex: metadata.checkpointIndex,
      selectedCheckpointLineNumber: metadata.checkpointLineNumber,
      checkpointEventCursor: metadata.checkpointCursor,
      checkpointWorldTime: metadata.checkpointWorldTime,
      renderedEventCursor: metadata.renderedCursor,
      renderedWorldTime: metadata.renderedWorldTime,
      finalStateExact: metadata.finalStateExact,
      eventOverlayApplied: metadata.eventOverlayApplied,
      appliedEventCount: metadata.appliedEventCount,
      stopReason: metadata.stopReason,
      stoppedBeforeCursor: metadata.stoppedBeforeCursor,
      nextExpectedCursor: metadata.nextExpectedCursor,
      unrenderedAgentCount: metadata.unrenderedAgentIds.length,
      unrenderedHomeCount: metadata.unrenderedHomeIds.length,
      synthesizedHomeCount: metadata.synthesizedHomeIds.length,
    };
  }

  if (result.status === "none") {
    return {
      ...baseReplayPreviewMetadata("none"),
      ...previewCheckpointFields(result.selector, artifacts),
      reason: result.reason,
    };
  }

  return {
    ...baseReplayPreviewMetadata("error"),
    ...previewErrorCheckpointFields(result, artifacts),
    error: result.error.message,
    errorSource: result.error.source,
    errorCode: result.error.code,
  };
}

function previewErrorCheckpointFields(
  result: Extract<ReplayPreviewResult, { status: "error" }>,
  artifacts: ReplayArtifacts,
): Partial<ReplayPreviewMetadata> {
  if (result.sessionState?.status === "ready") {
    return previewRestoreMetadataFields(result.sessionState.metadata);
  }
  return previewCheckpointFields(result.selector, artifacts);
}

function previewRestoreMetadataFields(
  metadata: ReplayRestoreMetadata,
): Partial<ReplayPreviewMetadata> {
  return {
    selectedCheckpointIndex: metadata.checkpointIndex,
    selectedCheckpointLineNumber: metadata.lineNumber,
    checkpointEventCursor: metadata.eventCursor,
    checkpointWorldTime: metadata.worldTime,
    finalStateExact: metadata.finalStateExact,
    eventOverlayApplied: metadata.eventOverlayApplied,
    appliedEventCount: metadata.appliedEventCount,
    stopReason: metadata.stopReason,
    stoppedBeforeCursor: metadata.stoppedBeforeCursor,
    nextExpectedCursor: metadata.nextExpectedCursor,
  };
}

function previewCheckpointFields(
  selector: ReplayPreviewResult["selector"],
  artifacts: ReplayArtifacts,
): Partial<ReplayPreviewMetadata> {
  if (!selector) {
    return {};
  }

  if ("index" in selector && selector.index !== undefined) {
    const index = selector.index;
    const checkpoint = artifacts.checkpoints[index] ?? null;
    return {
      selectedCheckpointIndex: checkpoint ? index : null,
      selectedCheckpointLineNumber: checkpoint?.lineNumber ?? null,
      checkpointEventCursor: checkpoint?.event_cursor ?? null,
      checkpointWorldTime: checkpoint?.world_time ?? null,
    };
  }

  if (selector.lineNumber === undefined) {
    return {};
  }

  const checkpointIndex = artifacts.checkpoints.findIndex(
    (checkpoint) => checkpoint.lineNumber === selector.lineNumber,
  );
  const checkpoint = checkpointIndex >= 0 ? artifacts.checkpoints[checkpointIndex] : null;
  return {
    selectedCheckpointIndex: checkpoint ? checkpointIndex : null,
    selectedCheckpointLineNumber: checkpoint?.lineNumber ?? selector.lineNumber,
    checkpointEventCursor: checkpoint?.event_cursor ?? null,
    checkpointWorldTime: checkpoint?.world_time ?? null,
  };
}

function baseReplayPreviewMetadata(
  status: ReplayPreviewMetadataStatus,
): ReplayPreviewMetadata {
  return {
    status,
    renderSnapshot: null,
    reason: null,
    error: null,
    errorSource: null,
    errorCode: null,
    selectedCheckpointIndex: null,
    selectedCheckpointLineNumber: null,
    checkpointEventCursor: null,
    checkpointWorldTime: null,
    renderedEventCursor: null,
    renderedWorldTime: null,
    finalStateExact: null,
    eventOverlayApplied: null,
    appliedEventCount: null,
    stopReason: null,
    stoppedBeforeCursor: null,
    nextExpectedCursor: null,
    unrenderedAgentCount: 0,
    unrenderedHomeCount: 0,
    synthesizedHomeCount: 0,
  };
}

function summarizeDuplicateCheckpointCursors(
  eventCursors: readonly number[],
): DuplicateCheckpointCursor[] {
  const counts = new Map<number, number>();
  for (const cursor of eventCursors) {
    counts.set(cursor, (counts.get(cursor) ?? 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([eventCursor, count]) => ({ eventCursor, count }));
}

function replayArtifactsForCheckpointSelection(
  artifacts: ReplayArtifacts,
  selector: ReplaySessionCheckpointSelector | null,
): ReplayArtifacts {
  if (!selector) {
    return artifacts;
  }
  return {
    ...artifacts,
    events: [],
  };
}

export function replayArtifactIdentityKey(run: RunMetadata | null): string | null {
  if (!run) {
    return null;
  }
  return [
    run.run_id,
    run.artifacts.events,
    run.artifacts.snapshots,
  ].join("\n");
}

function minOrNull(values: readonly number[]): number | null {
  return values.length > 0 ? Math.min(...values) : null;
}

function maxOrNull(values: readonly number[]): number | null {
  return values.length > 0 ? Math.max(...values) : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
