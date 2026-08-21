import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import {
  buildReplayModeEntry,
  type ReplayModeEntry,
} from "./replayMode";
import type { ReplayMetadata } from "./replayMetadata";

describe("replayMode", () => {
  it("builds inactive live entries while replay metadata is idle or loading", () => {
    expect(buildReplayModeEntry(metadata({ status: "idle" }))).toEqual({
      status: "inactive",
      mode: "live",
      selectedCheckpointIndex: null,
      selectedCheckpointLineNumber: null,
      checkpointIdentityKind: null,
      checkpointIdentity: null,
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
      reason: "metadata_idle",
      renderSnapshot: null,
      exactness: "unknown",
      error: null,
    });
    expect(buildReplayModeEntry(metadata({ status: "loading" }))).toEqual({
      status: "inactive",
      mode: "live",
      selectedCheckpointIndex: null,
      selectedCheckpointLineNumber: null,
      checkpointIdentityKind: null,
      checkpointIdentity: null,
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
      reason: "metadata_loading",
      renderSnapshot: null,
      exactness: "unknown",
      error: null,
    });
  });

  it("builds a ready exact archive preview entry with snapshot and checkpoint metadata", () => {
    const renderSnapshot = makeWorld({
      event_cursor: 15,
      world_time: 42.5,
    });

    const entry = expectReady(
      buildReplayModeEntry(metadata({
        preview: {
          ...basePreviewMetadata("ready"),
          renderSnapshot,
          selectedCheckpointIndex: 3,
          selectedCheckpointLineNumber: 99,
          checkpointEventCursor: 15,
          checkpointWorldTime: 42.5,
          renderedEventCursor: 15,
          renderedWorldTime: 42.5,
          finalStateExact: true,
          eventOverlayApplied: false,
          appliedEventCount: 0,
          stopReason: null,
          stoppedBeforeCursor: null,
          nextExpectedCursor: 16,
        },
      })),
    );

    expect(entry).toEqual({
      status: "ready",
      mode: "archive-preview",
      selectedCheckpointIndex: 3,
      selectedCheckpointLineNumber: 99,
      checkpointIdentityKind: "lineNumber",
      checkpointIdentity: "99",
      checkpointEventCursor: 15,
      checkpointWorldTime: 42.5,
      renderedEventCursor: 15,
      renderedWorldTime: 42.5,
      finalStateExact: true,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      stopReason: null,
      stoppedBeforeCursor: null,
      nextExpectedCursor: 16,
      reason: null,
      renderSnapshot,
      exactness: "exact",
      error: null,
    });
    expect(entry.renderSnapshot).toBe(renderSnapshot);
  });

  it("prefers checkpoint line-number identity while preserving index fallback", () => {
    const renderSnapshot = makeWorld({
      event_cursor: 5,
      world_time: 21,
    });
    const withLine = expectReady(
      buildReplayModeEntry(metadata({
        preview: {
          ...basePreviewMetadata("ready"),
          renderSnapshot,
          selectedCheckpointIndex: 1,
          selectedCheckpointLineNumber: 101,
          checkpointEventCursor: 5,
          checkpointWorldTime: 21,
          renderedEventCursor: 5,
          renderedWorldTime: 21,
          finalStateExact: true,
          eventOverlayApplied: false,
          nextExpectedCursor: 6,
        },
      })),
    );
    const earlierSameCursor = expectReady(
      buildReplayModeEntry(metadata({
        preview: {
          ...basePreviewMetadata("ready"),
          renderSnapshot,
          selectedCheckpointIndex: 0,
          selectedCheckpointLineNumber: 100,
          checkpointEventCursor: 5,
          checkpointWorldTime: 20,
          renderedEventCursor: 5,
          renderedWorldTime: 20,
          finalStateExact: true,
          eventOverlayApplied: false,
          nextExpectedCursor: 6,
        },
      })),
    );
    const indexOnly = expectReady(
      buildReplayModeEntry(metadata({
        preview: {
          ...basePreviewMetadata("ready"),
          renderSnapshot,
          selectedCheckpointIndex: 1,
          selectedCheckpointLineNumber: null,
          checkpointEventCursor: 5,
          checkpointWorldTime: 21,
          renderedEventCursor: 5,
          renderedWorldTime: 21,
          finalStateExact: true,
          eventOverlayApplied: false,
          nextExpectedCursor: 6,
        },
      })),
    );

    expect(withLine).toMatchObject({
      selectedCheckpointIndex: 1,
      selectedCheckpointLineNumber: 101,
      checkpointIdentityKind: "lineNumber",
      checkpointIdentity: "101",
      checkpointEventCursor: 5,
    });
    expect(earlierSameCursor).toMatchObject({
      selectedCheckpointIndex: 0,
      selectedCheckpointLineNumber: 100,
      checkpointIdentityKind: "lineNumber",
      checkpointIdentity: "100",
      checkpointEventCursor: 5,
    });
    expect(earlierSameCursor.checkpointEventCursor).toBe(withLine.checkpointEventCursor);
    expect(earlierSameCursor.checkpointIdentity).not.toBe(withLine.checkpointIdentity);
    expect(indexOnly).toMatchObject({
      selectedCheckpointIndex: 1,
      selectedCheckpointLineNumber: null,
      checkpointIdentityKind: "index",
      checkpointIdentity: "1",
      checkpointEventCursor: 5,
    });
  });

  it("keeps non-exact preview candidates inactive", () => {
    const renderSnapshot = makeWorld({
      event_cursor: 15,
      world_time: 42.5,
    });

    const exactCandidate: ReplayMetadata["preview"] = {
      ...basePreviewMetadata("ready"),
      renderSnapshot,
      selectedCheckpointIndex: 3,
      selectedCheckpointLineNumber: 99,
      checkpointEventCursor: 15,
      checkpointWorldTime: 42.5,
      renderedEventCursor: 15,
      renderedWorldTime: 42.5,
      finalStateExact: true,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      stopReason: null,
      stoppedBeforeCursor: null,
      nextExpectedCursor: 16,
    };
    const cases: Array<{
      name: string;
      preview: ReplayMetadata["preview"];
      reason: ReplayModeEntry["reason"];
    }> = [
      {
        name: "missing render snapshot",
        preview: { ...exactCandidate, renderSnapshot: null },
        reason: "not_ready",
      },
      {
        name: "non-exact final state",
        preview: { ...exactCandidate, finalStateExact: false },
        reason: "not_exact",
      },
      {
        name: "event overlay applied",
        preview: { ...exactCandidate, eventOverlayApplied: true, appliedEventCount: 3 },
        reason: "not_exact",
      },
      {
        name: "missing checkpoint identity",
        preview: { ...exactCandidate, selectedCheckpointIndex: null },
        reason: "not_exact",
      },
    ];

    for (const item of cases) {
      expect(
        buildReplayModeEntry(metadata({ preview: item.preview })),
        item.name,
      ).toMatchObject({
        status: "inactive",
        mode: "live",
        reason: item.reason,
        renderSnapshot: null,
        exactness: "unknown",
        selectedCheckpointIndex: item.preview.selectedCheckpointIndex,
        selectedCheckpointLineNumber: item.preview.selectedCheckpointLineNumber,
        checkpointIdentityKind: item.preview.selectedCheckpointLineNumber === null
          ? item.preview.selectedCheckpointIndex === null ? null : "index"
          : "lineNumber",
        checkpointIdentity: item.preview.selectedCheckpointLineNumber === null
          ? item.preview.selectedCheckpointIndex === null ? null : String(item.preview.selectedCheckpointIndex)
          : String(item.preview.selectedCheckpointLineNumber),
        checkpointEventCursor: item.preview.checkpointEventCursor,
        renderedEventCursor: item.preview.renderedEventCursor,
        finalStateExact: item.preview.finalStateExact,
        eventOverlayApplied: item.preview.eventOverlayApplied,
        appliedEventCount: item.preview.appliedEventCount,
      });
    }
  });

  it("builds preview errors as archive preview error entries", () => {
    expect(buildReplayModeEntry(metadata({
      preview: {
        ...basePreviewMetadata("error"),
        error: "Preview render failed.",
        errorSource: "render",
        selectedCheckpointIndex: 1,
        selectedCheckpointLineNumber: 27,
        checkpointEventCursor: 8,
        checkpointWorldTime: 30,
        finalStateExact: false,
        eventOverlayApplied: true,
        appliedEventCount: 2,
        stopReason: "gap",
        stoppedBeforeCursor: 11,
        nextExpectedCursor: 10,
      },
    }))).toEqual({
      status: "error",
      mode: "archive-preview",
      selectedCheckpointIndex: 1,
      selectedCheckpointLineNumber: 27,
      checkpointIdentityKind: "lineNumber",
      checkpointIdentity: "27",
      checkpointEventCursor: 8,
      checkpointWorldTime: 30,
      renderedEventCursor: null,
      renderedWorldTime: null,
      finalStateExact: false,
      eventOverlayApplied: true,
      appliedEventCount: 2,
      stopReason: "gap",
      stoppedBeforeCursor: 11,
      nextExpectedCursor: 10,
      reason: null,
      renderSnapshot: null,
      exactness: "unknown",
      error: "Preview render failed.",
    });
  });

  it("builds metadata errors as live mode error entries", () => {
    expect(buildReplayModeEntry(metadata({
      status: "error",
      error: "Archive artifacts unavailable.",
      preview: {
        ...basePreviewMetadata("error"),
        error: "Archive artifacts unavailable.",
        errorSource: "artifact_load",
        errorCode: "artifact_unavailable",
      },
    }))).toEqual({
      status: "error",
      mode: "live",
      selectedCheckpointIndex: null,
      selectedCheckpointLineNumber: null,
      checkpointIdentityKind: null,
      checkpointIdentity: null,
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
      reason: null,
      renderSnapshot: null,
      exactness: "unknown",
      error: "Archive artifacts unavailable.",
    });
  });
});

function metadata(overrides: Partial<ReplayMetadata> = {}): ReplayMetadata {
  return {
    status: "ready",
    runId: "replay-run",
    error: null,
    loadDiagnostics: {
      currentRequestId: null,
      activeRequestId: null,
      completedLoadCount: 0,
      lastCompletedRequestId: null,
      lastSettledRequestId: null,
      lastSettledStatus: "none",
      staleDropCount: 0,
      lastStaleRequestId: null,
    },
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
      window: {
        windowStart: 0,
        windowEnd: 0,
        windowSize: 2,
        itemCount: 0,
        totalVisibleCount: 0,
        hasPrevious: false,
        hasNext: false,
        order: "newest_first",
        rawCursorStart: null,
        rawCursorEnd: null,
        visibleCursorStart: null,
        visibleCursorEnd: null,
      },
    },
    restoreCapability: {
      status: "none",
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
    },
    preview: basePreviewMetadata("none"),
    ...overrides,
    artifactIdentityKey: overrides.artifactIdentityKey ?? "replay-artifacts",
    workingSetRevision: overrides.workingSetRevision ?? 1,
    hasOlderCheckpoints: overrides.hasOlderCheckpoints ?? false,
    olderPageStatus: overrides.olderPageStatus ?? "idle",
    olderPageError: overrides.olderPageError ?? null,
    loadOlderCheckpoints: overrides.loadOlderCheckpoints ?? (() => undefined),
  };
}

function basePreviewMetadata(
  status: ReplayMetadata["preview"]["status"],
): ReplayMetadata["preview"] {
  return {
    status,
    renderSnapshot: null,
    reason: status === "none" ? "no_checkpoint" : null,
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

function expectReady(
  entry: ReplayModeEntry,
): Extract<ReplayModeEntry, { status: "ready" }> {
  expect(entry.status).toBe("ready");
  if (entry.status !== "ready") {
    throw new Error("Expected replay mode entry to be ready.");
  }
  return entry;
}
