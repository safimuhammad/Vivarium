import { describe, expect, it } from "vitest";

import {
  buildReplayScrubberModel,
  replayCheckpointOptionLabel,
  replayCheckpointOptionValue,
  replayCheckpointOptionValueFromSelector,
  replayCheckpointSelectorFromValue,
  type ReplayScrubberModel,
} from "./replayScrubber";
import type {
  ReplayCheckpointOption,
  ReplayMetadata,
} from "./replayMetadata";

describe("replayScrubber", () => {
  it("builds exact checkpoint points without collapsing repeated cursors", () => {
    const checkpoints = [
      checkpoint({ index: 0, lineNumber: 1, eventCursor: 3, worldTime: 10 }),
      checkpoint({ index: 1, lineNumber: 2, eventCursor: 3, worldTime: 12 }),
      checkpoint({ index: 2, lineNumber: 3, eventCursor: 7, worldTime: 20 }),
    ];
    const scrubber = expectReady(buildReplayScrubberModel(
      metadata({ checkpointOptions: checkpoints }),
      null,
    ));

    expect(scrubber).toMatchObject({
      pointCount: 3,
      min: 0,
      max: 2,
      step: 1,
      selectedIndex: 2,
      selectedValue: "line:3",
      cursorStart: 3,
      cursorEnd: 7,
      timeStart: 10,
      timeEnd: 20,
    });
    expect(scrubber.points.map((point) => ({
      index: point.index,
      checkpointIndex: point.checkpointIndex,
      value: point.value,
      identityKind: point.identityKind,
      identity: point.identity,
      eventCursor: point.eventCursor,
    }))).toEqual([
      {
        index: 0,
        checkpointIndex: 0,
        value: "line:1",
        identityKind: "lineNumber",
        identity: "1",
        eventCursor: 3,
      },
      {
        index: 1,
        checkpointIndex: 1,
        value: "line:2",
        identityKind: "lineNumber",
        identity: "2",
        eventCursor: 3,
      },
      {
        index: 2,
        checkpointIndex: 2,
        value: "line:3",
        identityKind: "lineNumber",
        identity: "3",
        eventCursor: 7,
      },
    ]);
    expect(scrubber.points[0].eventCursor).toBe(scrubber.points[1].eventCursor);
    expect(scrubber.points[0].value).not.toBe(scrubber.points[1].value);
  });

  it("uses index fallback when checkpoint line metadata is missing", () => {
    const checkpoints = [
      checkpoint({ index: 0, lineNumber: 1, eventCursor: 2, worldTime: 10 }),
      checkpoint({ index: 1, lineNumber: null, eventCursor: 3, worldTime: 12 }),
      checkpoint({ index: 2, lineNumber: 3, eventCursor: 3, worldTime: 14 }),
    ];
    const scrubber = expectReady(buildReplayScrubberModel(
      metadata({
        checkpointOptions: checkpoints,
        preview: readyPreview(checkpoints[1]),
      }),
      { index: 1 },
    ));

    expect(scrubber.selectedPoint).toMatchObject({
      checkpointIndex: 1,
      lineNumber: null,
      value: "index:1",
      selector: { index: 1 },
      identityKind: "index",
      identity: "1",
      eventCursor: 3,
    });
    expect(scrubber.points.map((point) => point.value)).toEqual([
      "line:1",
      "index:1",
      "line:3",
    ]);
    expect(scrubber.points.map((point) => point.value)).not.toContain("cursor:3");
  });

  it("falls back to the active preview point, then the latest checkpoint", () => {
    const checkpoints = [
      checkpoint({ index: 0, lineNumber: 7, eventCursor: 2, worldTime: 10 }),
      checkpoint({ index: 1, lineNumber: 8, eventCursor: 5, worldTime: 12 }),
    ];
    const activePreview = expectReady(buildReplayScrubberModel(
      metadata({
        checkpointOptions: checkpoints,
        preview: readyPreview(checkpoints[1]),
      }),
      { lineNumber: 999 },
    ));
    expect(activePreview.selectedValue).toBe("line:8");

    const latest = expectReady(buildReplayScrubberModel(
      metadata({
        checkpointOptions: checkpoints,
        preview: {
          ...readyPreview(checkpoints[1]),
          selectedCheckpointIndex: 99,
          selectedCheckpointLineNumber: 99,
        },
      }),
      null,
    ));
    expect(latest.selectedValue).toBe("line:8");
  });

  it("hides controls for non-ready metadata and short timelines", () => {
    const checkpoints = [
      checkpoint({ index: 0, lineNumber: 1 }),
      checkpoint({ index: 1, lineNumber: 2 }),
    ];
    expect(buildReplayScrubberModel(
      metadata({ status: "idle", checkpointOptions: checkpoints }),
      null,
    )).toMatchObject({ status: "hidden", hiddenReason: "metadata_idle" });
    expect(buildReplayScrubberModel(
      metadata({ status: "loading", checkpointOptions: checkpoints }),
      null,
    )).toMatchObject({ status: "hidden", hiddenReason: "metadata_loading" });
    expect(buildReplayScrubberModel(
      metadata({ status: "error", checkpointOptions: checkpoints }),
      null,
    )).toMatchObject({ status: "hidden", hiddenReason: "metadata_error" });
    expect(buildReplayScrubberModel(
      metadata({ checkpointOptions: [] }),
      null,
    )).toMatchObject({ status: "hidden", hiddenReason: "not_enough_points" });
    expect(buildReplayScrubberModel(
      metadata({ checkpointOptions: [checkpoints[0]] }),
      null,
    )).toMatchObject({ status: "hidden", hiddenReason: "not_enough_points" });
  });

  it("keeps checkpoint controls available for approximate passive previews", () => {
    const checkpoints = [
      checkpoint({ index: 0, lineNumber: 1, eventCursor: 2, worldTime: 10 }),
      checkpoint({ index: 1, lineNumber: 2, eventCursor: 3, worldTime: 12 }),
    ];
    const scrubber = expectReady(buildReplayScrubberModel(
      metadata({
        checkpointOptions: checkpoints,
        preview: {
          ...readyPreview(checkpoints[1]),
          eventOverlayApplied: true,
          finalStateExact: false,
          appliedEventCount: 2,
          renderedEventCursor: 5,
        },
      }),
      null,
    ));

    expect(scrubber.selectedPoint).toMatchObject({
      value: "line:2",
      selector: { lineNumber: 2 },
      eventCursor: 3,
      identityKind: "lineNumber",
      identity: "2",
    });
    expect(buildReplayScrubberModel(
      metadata({
        checkpointOptions: checkpoints,
        preview: basePreview("error"),
      }),
      null,
    )).toMatchObject({
      status: "ready",
      selectedValue: "line:2",
    });
  });

  it("parses and labels only stable checkpoint identities", () => {
    const lineOption = checkpoint({ index: 5, lineNumber: 12, eventCursor: 44, worldTime: 31.25 });
    const indexOption = checkpoint({ index: 6, lineNumber: null, eventCursor: 44, worldTime: 32 });

    expect(replayCheckpointOptionValue(lineOption)).toBe("line:12");
    expect(replayCheckpointOptionValue(indexOption)).toBe("index:6");
    expect(replayCheckpointOptionValueFromSelector({ lineNumber: 12 })).toBe("line:12");
    expect(replayCheckpointOptionValueFromSelector({ index: 6 })).toBe("index:6");
    expect(replayCheckpointOptionLabel(lineOption)).toBe("line 12 - 44 @ 31.3s");
    expect(replayCheckpointOptionLabel(indexOption)).toBe("#7 - 44 @ 32.0s");
    expect(replayCheckpointSelectorFromValue("line:12")).toEqual({ lineNumber: 12 });
    expect(replayCheckpointSelectorFromValue("index:6")).toEqual({ index: 6 });
    expect(replayCheckpointSelectorFromValue("cursor:44")).toBeNull();
    expect(replayCheckpointSelectorFromValue("line:0")).toBeNull();
    expect(replayCheckpointSelectorFromValue("index:-1")).toBeNull();
    expect(replayCheckpointSelectorFromValue("line:12:extra")).toBeNull();
  });
});

function expectReady(
  scrubber: ReplayScrubberModel,
): Extract<ReplayScrubberModel, { status: "ready" }> {
  expect(scrubber.status).toBe("ready");
  if (scrubber.status !== "ready") {
    throw new Error(`Expected scrubber to be ready, got ${scrubber.status}.`);
  }
  return scrubber;
}

function checkpoint({
  index,
  lineNumber,
  eventCursor = index + 1,
  worldTime = index + 10,
  reason = "world_tick",
}: {
  index: number;
  lineNumber: number | null;
  eventCursor?: number;
  worldTime?: number;
  reason?: string;
}): ReplayCheckpointOption {
  return {
    index,
    lineNumber,
    eventCursor,
    worldTime,
    reason,
    runId: "run-test",
  };
}

function metadata(
  overrides: Partial<ReplayMetadata> & {
    checkpointOptions?: ReplayCheckpointOption[];
  } = {},
): ReplayMetadata {
  const checkpointOptions = overrides.checkpointOptions ?? [
    checkpoint({ index: 0, lineNumber: 1 }),
    checkpoint({ index: 1, lineNumber: 2 }),
  ];
  const first = checkpointOptions.at(0);
  const last = checkpointOptions.at(-1);
  const preview = overrides.preview ?? (last ? readyPreview(last) : basePreview("none"));

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
    checkpointCount: checkpointOptions.length,
    firstCheckpointEventCursor: first?.eventCursor ?? null,
    firstCheckpointWorldTime: first?.worldTime ?? null,
    lastCheckpointEventCursor: last?.eventCursor ?? null,
    lastCheckpointWorldTime: last?.worldTime ?? null,
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
    preview,
    ...overrides,
    artifactIdentityKey: overrides.artifactIdentityKey ?? "replay-artifacts",
    workingSetRevision: overrides.workingSetRevision ?? 1,
    checkpointOptions,
    hasOlderCheckpoints: overrides.hasOlderCheckpoints ?? false,
    olderPageStatus: overrides.olderPageStatus ?? "idle",
    olderPageError: overrides.olderPageError ?? null,
    loadOlderCheckpoints: overrides.loadOlderCheckpoints ?? (() => undefined),
  };
}

function readyPreview(
  selected: ReplayCheckpointOption,
): ReplayMetadata["preview"] {
  return {
    ...basePreview("ready"),
    selectedCheckpointIndex: selected.index,
    selectedCheckpointLineNumber: selected.lineNumber,
    checkpointEventCursor: selected.eventCursor,
    checkpointWorldTime: selected.worldTime,
    renderedEventCursor: selected.eventCursor,
    renderedWorldTime: selected.worldTime,
    finalStateExact: true,
    eventOverlayApplied: false,
    appliedEventCount: 0,
    stopReason: null,
    stoppedBeforeCursor: null,
    nextExpectedCursor: selected.eventCursor + 1,
  };
}

function basePreview(
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
