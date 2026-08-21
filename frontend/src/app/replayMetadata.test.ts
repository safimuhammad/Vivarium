import { StrictMode, act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import {
  REPLAY_CHECKPOINT_WORKING_SET_LIMIT,
  REPLAY_EVENT_WORKING_SET_LIMIT,
  fetchReplayArtifactsForRun,
  reconcileReplaySelectorAfterArtifactShift,
  type ReplayArtifactClient,
  type ReplayArtifacts,
} from "./replayArtifactClient";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import {
  loadReplayMetadata,
  replayArtifactIdentityKey,
  summarizeReplayArtifacts,
  useReplayMetadata,
  type ReplayMetadata,
} from "./replayMetadata";
import { buildReplayScrubberModel } from "./replayScrubber";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";

describe("replayMetadata", () => {
  it("bounds chronicle input and displayed checkpoint options to the client working set", () => {
    const metadata = summarizeReplayArtifacts(makeArtifacts({
      events: Array.from(
        { length: REPLAY_EVENT_WORKING_SET_LIMIT + 25 },
        (_, index) => eventEntry(index + 1),
      ),
      checkpoints: Array.from(
        { length: REPLAY_CHECKPOINT_WORKING_SET_LIMIT + 9 },
        (_, index) => checkpointRecord(
          makeWorld({ event_cursor: index + 1, world_time: index + 1 }),
          "world_tick",
          index + 1,
        ),
      ),
    }), "bounded-run");

    expect(metadata.eventCount).toBe(REPLAY_EVENT_WORKING_SET_LIMIT);
    expect(metadata.eventLineCursorStart).toBe(26);
    expect(metadata.checkpointCount).toBe(REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
    expect(metadata.checkpointOptions).toHaveLength(REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
    expect(metadata.checkpointOptions[0]?.lineNumber).toBe(10);
    expect(metadata.checkpointOptions.at(-1)?.lineNumber).toBe(
      REPLAY_CHECKPOINT_WORKING_SET_LIMIT + 9,
    );
    expect(metadata.archiveChronicle.eventCount).toBe(REPLAY_EVENT_WORKING_SET_LIMIT);
  });

  it("summarizes event line cursors, checkpoint ranges, and duplicate checkpoint cursors", () => {
    const artifacts = makeArtifacts({
      events: [eventEntry(2), eventEntry(4)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 12 }), "manual"),
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 14 }), "world_tick"),
        checkpointRecord(makeWorld({ event_cursor: 7, world_time: 20 }), "world_tick"),
      ],
    });

    expect(summarizeReplayArtifacts(artifacts, "run-1")).toMatchObject({
      status: "ready",
      runId: "run-1",
      error: null,
      eventCount: 2,
      eventLineCursorStart: 2,
      eventLineCursorEnd: 4,
      checkpointCount: 3,
      checkpointOptions: [
        {
          index: 0,
          lineNumber: null,
          eventCursor: 3,
          worldTime: 12,
          reason: "manual",
          runId: "seed-7-test",
        },
        {
          index: 1,
          lineNumber: null,
          eventCursor: 3,
          worldTime: 14,
          reason: "world_tick",
          runId: "seed-7-test",
        },
        {
          index: 2,
          lineNumber: null,
          eventCursor: 7,
          worldTime: 20,
          reason: "world_tick",
          runId: "seed-7-test",
        },
      ],
      firstCheckpointEventCursor: 3,
      firstCheckpointWorldTime: 12,
      lastCheckpointEventCursor: 7,
      lastCheckpointWorldTime: 20,
      duplicateCheckpointCursorCount: 1,
      duplicateCheckpointCursors: [{ eventCursor: 3, count: 2 }],
      archiveChronicle: {
        eventCount: 2,
        visibleCount: 2,
      },
      restoreCapability: {
        status: "ready",
        error: null,
        selectedCheckpointIndex: 2,
        selectedCheckpointLineNumber: null,
        eventCursor: 7,
        worldTime: 20,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 8,
      },
      preview: {
        status: "ready",
        error: null,
        selectedCheckpointIndex: 2,
        selectedCheckpointLineNumber: null,
        checkpointEventCursor: 7,
        checkpointWorldTime: 20,
        renderedEventCursor: 7,
        renderedWorldTime: 20,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 8,
        unrenderedAgentCount: 0,
        unrenderedHomeCount: 0,
        synthesizedHomeCount: 0,
      },
    });
  });

  it("summarizes selected checkpoints by line number and index fallback", () => {
    const first = checkpointRecord(
      makeWorld({ event_cursor: 5, world_time: 20 }),
      "manual",
      100,
    );
    const latest = checkpointRecord(
      makeWorld({
        event_cursor: 5,
        world_time: 21,
        agents: makeWorld().agents.map((agent) =>
          agent.id === "agent_001" ? { ...agent, position: "grove" } : agent,
        ),
      }),
      "world_tick",
    );
    const artifacts = makeArtifacts({
      events: [eventEntry(6)],
      checkpoints: [first, latest],
    });

    const byLine = summarizeReplayArtifacts(artifacts, "replay-run", {
      selector: { lineNumber: 100 },
    });
    expect(byLine.restoreCapability).toMatchObject({
      status: "ready",
      selectedCheckpointIndex: 0,
      selectedCheckpointLineNumber: 100,
      eventCursor: 5,
      worldTime: 20,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      finalStateExact: true,
    });
    expect(byLine.preview).toMatchObject({
      status: "ready",
      selectedCheckpointIndex: 0,
      selectedCheckpointLineNumber: 100,
      checkpointEventCursor: 5,
      checkpointWorldTime: 20,
      renderedEventCursor: 5,
      renderedWorldTime: 20,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      finalStateExact: true,
    });

    const byIndex = summarizeReplayArtifacts(artifacts, "replay-run", {
      selector: { index: 1 },
    });
    expect(byIndex.checkpointOptions).toEqual([
      expect.objectContaining({ index: 0, lineNumber: 100, eventCursor: 5 }),
      expect.objectContaining({ index: 1, lineNumber: null, eventCursor: 5 }),
    ]);
    expect(byIndex.restoreCapability).toMatchObject({
      status: "ready",
      selectedCheckpointIndex: 1,
      selectedCheckpointLineNumber: null,
      eventCursor: 5,
      worldTime: 21,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      finalStateExact: true,
    });
    expect(byIndex.preview).toMatchObject({
      status: "ready",
      selectedCheckpointIndex: 1,
      selectedCheckpointLineNumber: null,
      checkpointEventCursor: 5,
      checkpointWorldTime: 21,
      renderedEventCursor: 5,
      renderedWorldTime: 21,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      finalStateExact: true,
    });
    expect(byIndex.preview.checkpointEventCursor).toBe(byLine.preview.checkpointEventCursor);
    expect(byIndex.preview.selectedCheckpointIndex).not.toBe(
      byLine.preview.selectedCheckpointIndex,
    );
  });

  it("summarizes a passive archive chronicle without replay controls", () => {
    const archiveWorld = makeWorld({
      event_cursor: 2,
      agents: makeWorld().agents.map((agent) =>
        agent.id === "agent_001"
          ? { ...agent, name: "Archive Aster" }
          : agent,
      ),
    });
    const metadata = summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(archiveWorld, "world_tick", 12)],
      events: [
        eventEntry(2, eventRecord({
          payload: { speaker_id: "agent_001", message: "First archive call." },
          source: "agent_001",
          region: "meadow",
        })),
        eventEntry(4, eventRecord({
          payload: { speaker_id: "agent_001", message: "Last archive call." },
          source: "agent_001",
          region: "meadow",
        })),
      ],
    }), "archive-run");

    expect(metadata.archiveChronicle).toMatchObject({
      eventCount: 2,
      visibleCount: 2,
      items: [
        {
          kind: "event",
          cursor: 4,
          type: "speak",
          label: "spoke",
          detail: "Archive Aster: \"Last archive call.\"",
        },
        {
          kind: "event",
          cursor: 2,
          type: "speak",
          label: "spoke",
          detail: "Archive Aster: \"First archive call.\"",
        },
      ],
    });
  });

  it("fills archive chronicle context from checkpoint history when the preview snapshot is missing an older being", () => {
    const baseWorld = makeWorld();
    const olderWorld = makeWorld({
      event_cursor: 2,
      world_time: 14,
      agents: [
        ...baseWorld.agents,
        {
          ...baseWorld.agents[0],
          id: "agent_003",
          name: "Archive Echo",
        },
      ],
    });
    const finalWorld = makeWorld({
      event_cursor: 6,
      world_time: 20,
      agents: baseWorld.agents.filter((agent) => agent.id !== "agent_003"),
    });
    const metadata = summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [
        checkpointRecord(olderWorld, "manual", 21),
        checkpointRecord(finalWorld, "world_tick", 22),
      ],
      events: [
        eventEntry(2, eventRecord({
          source: "agent_003",
          payload: { speaker_id: "agent_003", message: "Older voice." },
          region: "meadow",
        })),
        eventEntry(3, eventRecord({
          source: "agent_404",
          payload: { speaker_id: "agent_404", message: "Unknown voice." },
          region: "meadow",
        })),
      ],
    }), "archive-run");

    expect(metadata.archiveChronicle.items).toMatchObject([
      {
        cursor: 3,
        detail: "being 404: \"Unknown voice.\"",
      },
      {
        cursor: 2,
        detail: "Archive Echo: \"Older voice.\"",
      },
    ]);
  });

  it("uses the later repeated-cursor checkpoint for archive row context", () => {
    const first = checkpointRecord(
      makeWorld({
        event_cursor: 2,
        world_time: 14,
        agents: makeWorld().agents.map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "First Aster" }
            : agent,
        ),
      }),
      "manual",
      31,
    );
    const later = checkpointRecord(
      makeWorld({
        event_cursor: 2,
        world_time: 15,
        agents: makeWorld().agents.map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "Later Aster" }
            : agent,
        ),
      }),
      "world_tick",
      32,
    );

    const metadata = summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [first, later],
      events: [
        eventEntry(2, eventRecord({
          source: "agent_001",
          payload: { speaker_id: "agent_001", message: "Same cursor." },
          region: "meadow",
        })),
      ],
    }), "archive-run");

    expect(metadata.archiveChronicle.items[0]).toMatchObject({
      cursor: 2,
      detail: "Later Aster: \"Same cursor.\"",
    });
  });

  it("summarizes archive window metadata and checkpoint provenance", () => {
    const baseWorld = makeWorld();
    const olderWorld = makeWorld({
      event_cursor: 3,
      world_time: 14,
      agents: [
        ...baseWorld.agents.map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "Older Aster" }
            : agent,
        ),
        {
          ...baseWorld.agents[0],
          id: "agent_003",
          name: "Archive Echo",
        },
      ],
    });
    const firstRepeatedWorld = makeWorld({
      event_cursor: 5,
      world_time: 15,
      agents: baseWorld.agents
        .filter((agent) => agent.id !== "agent_003")
        .map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "First Aster" }
            : agent,
        ),
    });
    const laterRepeatedWorld = makeWorld({
      event_cursor: 5,
      world_time: 16,
      agents: baseWorld.agents
        .filter((agent) => agent.id !== "agent_003")
        .map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "Later Aster" }
            : agent,
        ),
    });
    const finalWorld = makeWorld({
      event_cursor: 7,
      world_time: 20,
      agents: baseWorld.agents
        .filter((agent) => agent.id !== "agent_003")
        .map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "Final Aster" }
            : agent,
        ),
    });
    const artifacts = makeArtifacts({
      checkpoints: [
        checkpointRecord(olderWorld, "manual", 21),
        checkpointRecord(firstRepeatedWorld, "manual", 22),
        checkpointRecord(laterRepeatedWorld, "world_tick", 23),
        checkpointRecord(finalWorld, "world_tick", 24),
      ],
      events: [
        eventEntry(5, eventRecord({
          source: "agent_001",
          payload: { speaker_id: "agent_001", message: "Same cursor." },
          region: "meadow",
        })),
        eventEntry(6, eventRecord({
          source: "agent_003",
          payload: { speaker_id: "agent_003", message: "Removed voice." },
          region: "meadow",
        })),
        eventEntry(7, eventRecord({
          source: "agent_001",
          payload: { speaker_id: "agent_001", message: "Newest voice." },
          region: "meadow",
        })),
      ],
    });

    const firstWindow = summarizeReplayArtifacts(artifacts, "archive-run");
    expect(firstWindow.archiveChronicle).toMatchObject({
      eventCount: 3,
      visibleCount: 3,
      window: {
        windowStart: 0,
        windowEnd: 2,
        windowSize: 2,
        itemCount: 2,
        totalVisibleCount: 3,
        hasPrevious: false,
        hasNext: true,
        order: "newest_first",
        rawCursorStart: 5,
        rawCursorEnd: 7,
        visibleCursorStart: 6,
        visibleCursorEnd: 7,
      },
      items: [
        {
          cursor: 7,
          detail: "Final Aster: \"Newest voice.\"",
          provenance: {
            primary: {
              sourceKind: "preview_snapshot",
              checkpointIndex: null,
              lineNumber: null,
              eventCursor: 7,
            },
            presentationSource: {
              sourceKind: "preview_snapshot",
              checkpointIndex: null,
              lineNumber: null,
              eventCursor: 7,
            },
          },
        },
        {
          cursor: 6,
          detail: "Archive Echo: \"Removed voice.\"",
          provenance: {
            primary: {
              checkpointIndex: 2,
              lineNumber: 23,
              eventCursor: 5,
            },
            presentationSource: {
              checkpointIndex: 0,
              lineNumber: 21,
              eventCursor: 3,
            },
            fallbacks: [
              {
                checkpointIndex: 1,
                lineNumber: 22,
              },
              {
                checkpointIndex: 0,
                lineNumber: 21,
              },
            ],
          },
        },
      ],
    });

    const secondWindow = summarizeReplayArtifacts(artifacts, "archive-run", {
      archiveWindowStart: 2,
    });
    expect(secondWindow.archiveChronicle).toMatchObject({
      visibleCount: 3,
      window: {
        windowStart: 2,
        windowEnd: 3,
        itemCount: 1,
        hasPrevious: true,
        hasNext: false,
        visibleCursorStart: 5,
        visibleCursorEnd: 5,
      },
      items: [
        {
          cursor: 5,
          detail: "Later Aster: \"Same cursor.\"",
          provenance: {
            primary: {
              checkpointIndex: 2,
              lineNumber: 23,
              eventCursor: 5,
            },
            presentationSource: {
              checkpointIndex: 2,
              lineNumber: 23,
            },
            fallbacks: [
              {
                checkpointIndex: 1,
                lineNumber: 22,
                eventCursor: 5,
              },
              {
                checkpointIndex: 0,
                lineNumber: 21,
                eventCursor: 3,
              },
            ],
          },
        },
      ],
    });
  });

  it("windows archive metadata after grouping visible representative rows", () => {
    const archiveWorld = makeWorld({
      event_cursor: 4,
      world_time: 18,
      agents: makeWorld().agents.map((agent) =>
        agent.id === "agent_001"
          ? { ...agent, name: "Archive Aster" }
          : agent,
      ),
    });
    const artifacts = makeArtifacts({
      checkpoints: [checkpointRecord(archiveWorld, "world_tick", 40)],
      events: [
        eventEntry(4, eventRecord({
          type: "home_breached",
          source: "agent_001",
          payload: {
            home_id: "home_001",
            target_home: "home_001",
            breacher_id: "agent_001",
            region: "meadow",
            intent: "thieve",
          },
          region: "meadow",
        })),
        eventEntry(5, eventRecord({
          type: "home_thieved",
          source: "agent_001",
          payload: {
            home_id: "home_001",
            target_home: "home_001",
            breacher_id: "agent_001",
            region: "meadow",
            loot: { materials: 14 },
          },
          region: "meadow",
        })),
        eventEntry(6, eventRecord({
          source: "agent_001",
          payload: { speaker_id: "agent_001", message: "After the raid." },
          region: "meadow",
        })),
      ],
    });

    const firstWindow = summarizeReplayArtifacts(artifacts, "archive-run");
    expect(firstWindow.archiveChronicle).toMatchObject({
      eventCount: 3,
      visibleCount: 2,
      window: {
        windowStart: 0,
        windowEnd: 2,
        itemCount: 2,
        totalVisibleCount: 2,
        hasNext: false,
        rawCursorStart: 4,
        rawCursorEnd: 6,
        visibleCursorStart: 5,
        visibleCursorEnd: 6,
      },
      items: [
        {
          cursor: 6,
          type: "speak",
          detail: "Archive Aster: \"After the raid.\"",
        },
        {
          cursor: 5,
          type: "home_thieved",
          label: "vault stripped",
          chainDetail: {
            kind: "breach-theft",
            text: "after breach",
            count: 2,
            window: "4-5",
          },
          provenance: {
            primary: {
              checkpointIndex: 0,
              lineNumber: 40,
              eventCursor: 4,
            },
          },
        },
      ],
    });

    const clampedWindow = summarizeReplayArtifacts(artifacts, "archive-run", {
      archiveWindowStart: 99,
    });
    expect(clampedWindow.archiveChronicle).toMatchObject({
      eventCount: 3,
      visibleCount: 2,
      window: {
        windowStart: 0,
        windowEnd: 2,
        itemCount: 2,
        hasPrevious: false,
        hasNext: false,
        visibleCursorStart: 5,
        visibleCursorEnd: 6,
      },
      items: [
        {
          cursor: 6,
          type: "speak",
        },
        {
          cursor: 5,
        },
      ],
    });
  });

  it("selects the latest repeated-cursor checkpoint by stable index for passive restore and preview", () => {
    const first = checkpointRecord(
      makeWorld({ event_cursor: 5, world_time: 20 }),
      "manual",
      100,
    );
    const latest = checkpointRecord(
      makeWorld({ event_cursor: 5, world_time: 21 }),
      "world_tick",
      101,
    );

    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [first, latest],
    }), "repeated-run")).toMatchObject({
      status: "ready",
      checkpointCount: 2,
      duplicateCheckpointCursorCount: 1,
      duplicateCheckpointCursors: [{ eventCursor: 5, count: 2 }],
      restoreCapability: {
        status: "ready",
        selectedCheckpointIndex: 1,
        selectedCheckpointLineNumber: 101,
        eventCursor: 5,
        worldTime: 21,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        nextExpectedCursor: 6,
      },
      preview: {
        status: "ready",
        selectedCheckpointIndex: 1,
        selectedCheckpointLineNumber: 101,
        checkpointEventCursor: 5,
        checkpointWorldTime: 21,
        renderedEventCursor: 5,
        renderedWorldTime: 21,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        nextExpectedCursor: 6,
      },
    });
  });

  it("attaches a cloned render snapshot only for ready passive preview metadata", () => {
    const checkpoint = checkpointRecord(
      makeWorld({ event_cursor: 4, world_time: 18.5 }),
      "world_tick",
      8,
    );
    const metadata = summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpoint],
    }));

    expect(metadata.preview.status).toBe("ready");
    expect(metadata.preview.renderSnapshot).toMatchObject({
      event_cursor: 4,
      world_time: 18.5,
    });
    expect(metadata.preview.renderSnapshot).not.toBe(checkpoint.snapshot);
    expect(metadata.preview.renderSnapshot?.agents).not.toBe(checkpoint.snapshot.agents);
    expect(metadata.preview.renderSnapshot?.homes).not.toBe(checkpoint.snapshot.homes);
    expect(summarizeReplayArtifacts(makeArtifacts()).preview.renderSnapshot).toBeNull();
  });

  it("treats empty artifact streams as ready metadata", () => {
    expect(summarizeReplayArtifacts(makeArtifacts(), "empty-run")).toMatchObject({
      status: "ready",
      runId: "empty-run",
      eventCount: 0,
      eventLineCursorStart: null,
      eventLineCursorEnd: null,
      checkpointCount: 0,
      firstCheckpointEventCursor: null,
      lastCheckpointEventCursor: null,
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
          rawCursorStart: null,
          rawCursorEnd: null,
          visibleCursorStart: null,
          visibleCursorEnd: null,
          order: "newest_first",
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
      preview: {
        status: "none",
        reason: "no_checkpoint",
        error: null,
        selectedCheckpointIndex: null,
        selectedCheckpointLineNumber: null,
        renderedEventCursor: null,
        renderedWorldTime: null,
      },
    });
  });

  it("keeps events without checkpoints readable but non-previewable", () => {
    expect(summarizeReplayArtifacts(makeArtifacts({
      events: [eventEntry(1)],
    }), "events-only")).toMatchObject({
      status: "ready",
      runId: "events-only",
      eventCount: 1,
      eventLineCursorStart: 1,
      eventLineCursorEnd: 1,
      checkpointCount: 0,
      archiveChronicle: {
        eventCount: 1,
        visibleCount: 1,
        window: {
          windowStart: 0,
          windowEnd: 1,
          itemCount: 1,
          rawCursorStart: 1,
          rawCursorEnd: 1,
          visibleCursorStart: 1,
          visibleCursorEnd: 1,
        },
      },
      restoreCapability: {
        status: "none",
        selectedCheckpointIndex: null,
        eventCursor: null,
        worldTime: null,
      },
      preview: {
        status: "none",
        reason: "no_checkpoint",
        selectedCheckpointIndex: null,
        renderedEventCursor: null,
        renderedWorldTime: null,
      },
    });
  });

  it("keeps checkpoints without events previewable but archive-empty", () => {
    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 4, world_time: 18.5 }), "world_tick", 1),
      ],
    }), "checkpoint-only")).toMatchObject({
      status: "ready",
      runId: "checkpoint-only",
      eventCount: 0,
      eventLineCursorStart: null,
      eventLineCursorEnd: null,
      checkpointCount: 1,
      firstCheckpointEventCursor: 4,
      firstCheckpointWorldTime: 18.5,
      lastCheckpointEventCursor: 4,
      lastCheckpointWorldTime: 18.5,
      archiveChronicle: {
        eventCount: 0,
        visibleCount: 0,
        items: [],
        window: {
          windowStart: 0,
          windowEnd: 0,
          itemCount: 0,
          rawCursorStart: null,
          rawCursorEnd: null,
          visibleCursorStart: null,
          visibleCursorEnd: null,
        },
      },
      restoreCapability: {
        status: "ready",
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 1,
        eventCursor: 4,
        worldTime: 18.5,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 5,
      },
      preview: {
        status: "ready",
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 1,
        checkpointEventCursor: 4,
        checkpointWorldTime: 18.5,
        renderedEventCursor: 4,
        renderedWorldTime: 18.5,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 5,
      },
    });
  });

  it("keeps restore failures as ready metadata with passive capability errors", () => {
    const malformedSnapshot: WorldSnapshot = {
      ...makeWorld({ event_cursor: 4, world_time: 18.5 }),
      agents: undefined as unknown as WorldSnapshot["agents"],
    };

    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(malformedSnapshot, "world_tick", 8)],
    }), "restore-error-run")).toMatchObject({
      status: "ready",
      runId: "restore-error-run",
      checkpointCount: 1,
      restoreCapability: {
        status: "error",
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 8,
        eventCursor: 4,
        worldTime: 18.5,
        finalStateExact: null,
        eventOverlayApplied: null,
        appliedEventCount: null,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: null,
      },
      preview: {
        status: "error",
        errorSource: "restore",
        errorCode: "hydrate_failed",
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 8,
        checkpointEventCursor: 4,
        checkpointWorldTime: 18.5,
      },
    });
    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(malformedSnapshot, "world_tick", 8)],
    }), "restore-error-run").restoreCapability.error).toMatch(
      /Replay checkpoint restore failed/,
    );
    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(malformedSnapshot, "world_tick", 8)],
    }), "restore-error-run").preview.error).toMatch(
      /Replay checkpoint restore failed/,
    );
  });

  it("keeps render failures as ready metadata with passive preview errors", () => {
    const malformedRenderSnapshot: WorldSnapshot = {
      ...makeWorld({ event_cursor: 4, world_time: 18.5 }),
      regions: undefined as unknown as WorldSnapshot["regions"],
    };

    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(malformedRenderSnapshot, "world_tick", 9)],
    }), "render-error-run")).toMatchObject({
      status: "ready",
      runId: "render-error-run",
      checkpointCount: 1,
      restoreCapability: {
        status: "ready",
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 9,
        eventCursor: 4,
        worldTime: 18.5,
      },
      preview: {
        status: "error",
        errorSource: "render",
        errorCode: null,
        selectedCheckpointIndex: 0,
        selectedCheckpointLineNumber: 9,
        checkpointEventCursor: 4,
        checkpointWorldTime: 18.5,
        finalStateExact: true,
        eventOverlayApplied: false,
        appliedEventCount: 0,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 5,
      },
    });
    expect(summarizeReplayArtifacts(makeArtifacts({
      checkpoints: [checkpointRecord(malformedRenderSnapshot, "world_tick", 9)],
    }), "render-error-run").preview.error).toMatch(/Cannot read/);
  });

  it("summarizes passive overlay, gap, and stale stop metadata", () => {
    expect(summarizeReplayArtifacts(makeArtifacts({
      events: [eventEntry(5), eventEntry(6)],
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    }))).toMatchObject({
      restoreCapability: {
        status: "ready",
        appliedEventCount: 2,
        eventOverlayApplied: true,
        finalStateExact: false,
        stopReason: null,
        stoppedBeforeCursor: null,
        nextExpectedCursor: 7,
      },
      preview: {
        status: "ready",
        renderedEventCursor: 6,
        eventOverlayApplied: true,
        appliedEventCount: 2,
        finalStateExact: false,
        stopReason: null,
      },
    });

    expect(summarizeReplayArtifacts(makeArtifacts({
      events: [eventEntry(5), eventEntry(7)],
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    }))).toMatchObject({
      restoreCapability: {
        status: "ready",
        appliedEventCount: 1,
        eventOverlayApplied: true,
        finalStateExact: false,
        stopReason: "gap",
        stoppedBeforeCursor: 7,
        nextExpectedCursor: 6,
      },
      preview: {
        status: "ready",
        renderedEventCursor: 5,
        eventOverlayApplied: true,
        appliedEventCount: 1,
        finalStateExact: false,
        stopReason: "gap",
        stoppedBeforeCursor: 7,
        nextExpectedCursor: 6,
      },
    });

    expect(summarizeReplayArtifacts(makeArtifacts({
      events: [eventEntry(5), eventEntry(5)],
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    }))).toMatchObject({
      restoreCapability: {
        status: "ready",
        appliedEventCount: 1,
        eventOverlayApplied: true,
        finalStateExact: false,
        stopReason: "stale",
        stoppedBeforeCursor: 5,
        nextExpectedCursor: 6,
      },
      preview: {
        status: "ready",
        renderedEventCursor: 5,
        eventOverlayApplied: true,
        appliedEventCount: 1,
        finalStateExact: false,
        stopReason: "stale",
        stoppedBeforeCursor: 5,
        nextExpectedCursor: 6,
      },
    });
  });

  it("loads artifacts through the artifact client without mutating the live world store", async () => {
    const artifacts = makeArtifacts({
      events: [eventEntry(1)],
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4, world_time: 18.5 }))],
    });
    const client = fakeClient(async () => artifacts);
    const run = makeRun({ run_id: "metadata-run" });
    const world = makeWorld({ event_cursor: 4, world_time: 18.5 });
    const liveEntry = eventEntry(5);
    const store = createWorldStore();
    store.applyRun(run);
    store.applySnapshot(world);
    store.applyEventEnvelope(makeEventEnvelope({
      cursor: 4,
      next_cursor: 5,
      events: [liveEntry],
    }));
    const before = store.getState();

    await expect(loadReplayMetadata(run, client)).resolves.toMatchObject({
      status: "ready",
      runId: "metadata-run",
      eventCount: 1,
      checkpointCount: 1,
      restoreCapability: {
        status: "ready",
        selectedCheckpointIndex: 0,
        eventCursor: 4,
        worldTime: 18.5,
      },
      preview: {
        status: "ready",
        selectedCheckpointIndex: 0,
        checkpointEventCursor: 4,
        checkpointWorldTime: 18.5,
        renderedEventCursor: 4,
        renderedWorldTime: 18.5,
      },
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(client.fetchEvents).not.toHaveBeenCalled();
    expect(client.fetchSnapshots).not.toHaveBeenCalled();
    expect(store.getState()).toBe(before);
    expect(store.getState().snapshot).toBe(world);
    expect(store.getState().eventCursor).toBe(5);
    expect(store.getState().eventBeats).toEqual([liveEntry]);
  });

  it("retries a one-shot replay bootstrap when a restart races stale run artifacts", async () => {
    const stale = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ run_id: "previous-run" }), "world_tick", 1)],
    });
    stale.runId = "previous-run";
    const current = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ run_id: "restart-run" }), "world_tick", 2)],
    });
    current.runId = "restart-run";
    const responses = [stale, current];
    const client = fakeClient(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected replay bootstrap retry");
      }
      return response;
    });

    await expect(loadReplayMetadata(
      makeRun({ run_id: "restart-run" }),
      client,
    )).resolves.toMatchObject({
      status: "ready",
      runId: "restart-run",
      preview: {
        selectedCheckpointLineNumber: 2,
      },
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);
  });

  it("retries the active hook bootstrap when replay artifacts lag a live run restart", async () => {
    const stale = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ run_id: "hook-previous" }), "world_tick", 1)],
    });
    stale.runId = "hook-previous";
    const current = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ run_id: "hook-restart" }), "world_tick", 2)],
    });
    current.runId = "hook-restart";
    const responses = [stale, current];
    const client = fakeClient(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error("unexpected hook bootstrap retry");
      }
      return response;
    });
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "hook-restart" }),
        client,
        onMetadata: (metadata) => observed.push(metadata),
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "hook-restart",
      preview: {
        selectedCheckpointLineNumber: 2,
      },
    });
    await act(async () => root.unmount());
  });

  it("rejects a one-shot bootstrap after bounded retries remain on the previous run", async () => {
    const stale = makeArtifacts();
    stale.runId = "previous-run";
    const client = fakeClient(async () => stale);

    await expect(loadReplayMetadata(
      makeRun({ run_id: "current-run" }),
      client,
    )).resolves.toMatchObject({
      status: "error",
      runId: "current-run",
      error: "Replay artifacts remained on run previous-run while live run is current-run",
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(3);
  });

  it("rejects an active hook bootstrap after bounded restart retries are exhausted", async () => {
    const stale = makeArtifacts();
    stale.runId = "hook-previous-run";
    const client = fakeClient(async () => stale);
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "hook-current-run" }),
        client,
        onMetadata: (metadata) => observed.push(metadata),
      });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(client.fetchArtifacts).toHaveBeenCalledTimes(3);
    expect(lastMetadata(observed)).toMatchObject({
      status: "error",
      runId: "hook-current-run",
      error: "Replay artifacts remained on run hook-previous-run while live run is hook-current-run",
    });
    await act(async () => root.unmount());
  });

  it("derives archive point and window changes without refetching artifacts", async () => {
    const artifactLoad = createDeferred<ReplayArtifacts>();
    const client = fakeClient(async () => artifactLoad.promise);
    const artifacts = makeArtifacts({
      events: [eventEntry(1), eventEntry(2), eventEntry(3)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 1, world_time: 18 }), "manual", 1),
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 19 }), "manual", 2),
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 20 }), "world_tick", 3),
      ],
    });
    const observed: ReplayMetadata[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);
    const run = makeRun({ run_id: "derived-run" });
    const equivalentRun = makeRun({
      run_id: "derived-run",
      world_time: 99,
      artifacts: { ...run.artifacts },
    });

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run,
        client,
        archiveWindowStart: 0,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);

    await act(async () => {
      artifactLoad.resolve(artifacts);
      await artifactLoad.promise;
      await Promise.resolve();
    });
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      preview: {
        selectedCheckpointLineNumber: 3,
        selectedCheckpointIndex: 2,
      },
      archiveChronicle: {
        window: {
          windowStart: 0,
          windowEnd: 2,
        },
      },
    });

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run: equivalentRun,
        client,
        archiveWindowStart: 0,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "derived-run",
      preview: {
        selectedCheckpointLineNumber: 3,
        selectedCheckpointIndex: 2,
      },
    });

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run: equivalentRun,
        client,
        selector: { lineNumber: 1 },
        archiveWindowStart: 2,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
        checkpointEventCursor: 1,
        renderedEventCursor: 1,
      },
      archiveChronicle: {
        window: {
          windowStart: 2,
          windowEnd: 3,
        },
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("loads an older bounded page only after explicit archive navigation", async () => {
    const initial = makeArtifacts({
      events: [eventEntry(20)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 20, world_time: 20 }), "world_tick", 20),
      ],
    });
    initial.hasOlderCheckpoints = true;
    const older = makeArtifacts({
      events: [eventEntry(10), eventEntry(20)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 10, world_time: 10 }), "world_tick", 10),
        checkpointRecord(makeWorld({ event_cursor: 20, world_time: 20 }), "world_tick", 20),
      ],
    });
    older.hasOlderCheckpoints = false;
    const client = fakeClient(async () => initial);
    client.fetchOlderArtifacts = vi.fn(async () => older);
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "older-page-run" }),
        client,
        onMetadata: (metadata) => observed.push(metadata),
      });
      await Promise.resolve();
    });

    expect(client.fetchOlderArtifacts).not.toHaveBeenCalled();
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      checkpointCount: 1,
      hasOlderCheckpoints: true,
      olderPageStatus: "idle",
    });

    await act(async () => {
      lastMetadata(observed).loadOlderCheckpoints();
      await Promise.resolve();
    });

    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(client.fetchOlderArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      checkpointCount: 2,
      hasOlderCheckpoints: false,
      olderPageStatus: "idle",
    });
    await act(async () => root.unmount());
  });

  it("reconciles an index selection when an older page shifts the checkpoint window", async () => {
    const initial = makeArtifacts({
      checkpoints: Array.from({ length: REPLAY_CHECKPOINT_WORKING_SET_LIMIT }, (_, index) => (
        checkpointRecord(
          makeWorld({ event_cursor: index + 65, world_time: index + 65 }),
          "world_tick",
          index + 65,
        )
      )),
    });
    initial.hasOlderCheckpoints = true;
    const older = makeArtifacts({
      checkpoints: Array.from({ length: REPLAY_CHECKPOINT_WORKING_SET_LIMIT }, (_, index) => (
        checkpointRecord(
          makeWorld({ event_cursor: index + 1, world_time: index + 1 }),
          "world_tick",
          index + 1,
        )
      )),
    });
    older.hasOlderCheckpoints = false;
    const client = fakeClient(async () => initial);
    client.fetchOlderArtifacts = vi.fn(async () => older);
    const onSelectorReconciled = vi.fn();
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "selection-shift-run" }),
        client,
        selector: { index: 0 },
        onSelectorReconciled,
        onMetadata: (metadata) => observed.push(metadata),
      });
      await Promise.resolve();
    });
    expect(lastMetadata(observed).preview).toMatchObject({
      selectedCheckpointIndex: 0,
      selectedCheckpointLineNumber: 65,
    });

    await act(async () => {
      lastMetadata(observed).loadOlderCheckpoints();
      await Promise.resolve();
    });

    expect(onSelectorReconciled).toHaveBeenCalledWith({ lineNumber: 64 });
    const metadata = lastMetadata(observed);
    expect(metadata.preview).toMatchObject({
      status: "ready",
      selectedCheckpointIndex: 63,
      selectedCheckpointLineNumber: 64,
      checkpointEventCursor: 64,
    });
    const scrubber = buildReplayScrubberModel(metadata, { lineNumber: 64 });
    expect(scrubber).toMatchObject({
      status: "ready",
      selectedValue: "line:64",
      selectedPoint: {
        checkpointIndex: 63,
        lineNumber: 64,
        eventCursor: 64,
      },
    });
    await act(async () => root.unmount());
  });

  it("does not overwrite a newer selector when an older page resolves late", async () => {
    const initial = makeArtifacts({
      checkpoints: Array.from({ length: REPLAY_CHECKPOINT_WORKING_SET_LIMIT }, (_, index) => (
        checkpointRecord(
          makeWorld({ event_cursor: index + 65, world_time: index + 65 }),
          "world_tick",
          index + 65,
        )
      )),
    });
    initial.hasOlderCheckpoints = true;
    const older = makeArtifacts({
      checkpoints: Array.from({ length: REPLAY_CHECKPOINT_WORKING_SET_LIMIT }, (_, index) => (
        checkpointRecord(
          makeWorld({ event_cursor: index + 1, world_time: index + 1 }),
          "world_tick",
          index + 1,
        )
      )),
    });
    older.hasOlderCheckpoints = false;
    const deferredOlderPage = createDeferred<ReplayArtifacts>();
    const client = fakeClient(async () => initial);
    client.fetchOlderArtifacts = vi.fn(async () => deferredOlderPage.promise);
    const onSelectorReconciled = vi.fn();
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));
    const render = (selector: { index: number } | { lineNumber: number }) => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "newer-selection-run" }),
        client,
        selector,
        onSelectorReconciled,
        onMetadata: (metadata) => observed.push(metadata),
      });
    };

    await act(async () => {
      render({ index: 0 });
      await Promise.resolve();
    });
    await act(async () => {
      lastMetadata(observed).loadOlderCheckpoints();
      await Promise.resolve();
    });
    await act(async () => {
      render({ lineNumber: 100 });
      await Promise.resolve();
    });
    await act(async () => {
      deferredOlderPage.resolve(older);
      await deferredOlderPage.promise;
      await Promise.resolve();
    });

    expect(onSelectorReconciled).not.toHaveBeenCalled();
    expect(lastMetadata(observed)).toMatchObject({
      checkpointCount: REPLAY_CHECKPOINT_WORKING_SET_LIMIT,
      olderPageStatus: "idle",
      preview: {
        status: "ready",
        selectedCheckpointLineNumber: 100,
        finalStateExact: true,
      },
    });
    expect(
      lastMetadata(observed).checkpointOptions.some((option) => option.lineNumber === 100),
    ).toBe(true);
    await act(async () => root.unmount());
  });

  it("ignores delayed stale hook loads after artifact identity changes", async () => {
    const firstLoad = createDeferred<ReplayArtifacts>();
    const secondLoad = createDeferred<ReplayArtifacts>();
    const pendingLoads = [firstLoad, secondLoad];
    const client = fakeClient(async () => {
      const deferred = pendingLoads.shift();
      if (!deferred) {
        throw new Error("unexpected artifact load");
      }
      return deferred.promise;
    });
    const artifacts = makeArtifacts({
      events: [eventEntry(1), eventEntry(2), eventEntry(3)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 1, world_time: 18 }), "manual", 1),
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 19 }), "manual", 2),
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 20 }), "world_tick", 3),
      ],
    });
    const observed: ReplayMetadata[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);
    const run = makeRun({ run_id: "stale-run" });
    const nextRun = makeRun({
      run_id: "stale-run",
      artifacts: {
        ...run.artifacts,
        events: "runs/next-events.jsonl",
        snapshots: "runs/next-snapshots.jsonl",
      },
    });

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run,
        client,
        archiveWindowStart: 0,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      status: "loading",
      runId: "stale-run",
      artifactIdentityKey: replayArtifactIdentityKey(run),
      loadDiagnostics: {
        currentRequestId: 1,
        activeRequestId: 1,
        completedLoadCount: 0,
        lastCompletedRequestId: null,
        lastSettledRequestId: null,
        lastSettledStatus: "loading",
        staleDropCount: 0,
        lastStaleRequestId: null,
      },
    });

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run: nextRun,
        client,
        selector: { lineNumber: 1 },
        archiveWindowStart: 2,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(lastMetadata(observed)).toMatchObject({
      status: "loading",
      runId: "stale-run",
      artifactIdentityKey: replayArtifactIdentityKey(nextRun),
      loadDiagnostics: {
        currentRequestId: 3,
        activeRequestId: 3,
        completedLoadCount: 0,
        lastCompletedRequestId: null,
        staleDropCount: 0,
        lastStaleRequestId: null,
      },
    });

    await act(async () => {
      secondLoad.resolve(artifacts);
      await secondLoad.promise;
      await Promise.resolve();
    });
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "stale-run",
      artifactIdentityKey: replayArtifactIdentityKey(nextRun),
      workingSetRevision: 3,
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
        checkpointEventCursor: 1,
        renderedEventCursor: 1,
      },
      archiveChronicle: {
        window: {
          windowStart: 2,
          windowEnd: 3,
        },
      },
      loadDiagnostics: {
        currentRequestId: 3,
        activeRequestId: null,
        completedLoadCount: 1,
        lastCompletedRequestId: 3,
        lastSettledRequestId: 3,
        lastSettledStatus: "ready",
        staleDropCount: 0,
        lastStaleRequestId: null,
      },
    });

    await act(async () => {
      firstLoad.resolve(artifacts);
      await firstLoad.promise;
      await Promise.resolve();
    });
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "stale-run",
      artifactIdentityKey: replayArtifactIdentityKey(nextRun),
      workingSetRevision: 3,
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
        checkpointEventCursor: 1,
        renderedEventCursor: 1,
      },
      archiveChronicle: {
        window: {
          windowStart: 2,
          windowEnd: 3,
        },
      },
      loadDiagnostics: {
        currentRequestId: 3,
        activeRequestId: null,
        completedLoadCount: 1,
        lastCompletedRequestId: 3,
        lastSettledRequestId: 1,
        lastSettledStatus: "stale_ready",
        staleDropCount: 1,
        lastStaleRequestId: 1,
      },
    });
    const serializedDiagnostics = JSON.stringify(lastMetadata(observed).loadDiagnostics);
    expect(serializedDiagnostics).not.toContain("runs/next-events.jsonl");
    expect(serializedDiagnostics).not.toContain("runs/next-snapshots.jsonl");

    await act(async () => {
      root.unmount();
    });
  });

  it("turns missing, malformed, or rejected artifact loads into metadata errors", async () => {
    const client = fakeClient(async () => {
      throw new Error("/api/replay/artifacts/snapshots line 2: malformed checkpoint");
    });

    await expect(loadReplayMetadata(makeRun({ run_id: "bad-run" }), client)).resolves.toMatchObject({
      status: "error",
      runId: "bad-run",
      error: "/api/replay/artifacts/snapshots line 2: malformed checkpoint",
      eventCount: 0,
      checkpointCount: 0,
      restoreCapability: {
        status: "error",
        error: "/api/replay/artifacts/snapshots line 2: malformed checkpoint",
      },
      preview: {
        status: "error",
        error: "/api/replay/artifacts/snapshots line 2: malformed checkpoint",
        errorSource: "artifact_load",
      },
    });
  });

  it("turns rejected hook artifact loads into passive metadata errors", async () => {
    const artifactLoad = createDeferred<ReplayArtifacts>();
    const client = fakeClient(async () => artifactLoad.promise);
    const observed: ReplayMetadata[] = [];
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(ReplayMetadataProbe, {
        run: makeRun({ run_id: "hook-bad-run" }),
        client,
        onMetadata: (metadata: ReplayMetadata) => observed.push(metadata),
      }));
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      status: "loading",
      runId: "hook-bad-run",
      loadDiagnostics: {
        currentRequestId: 1,
        activeRequestId: 1,
        completedLoadCount: 0,
        lastCompletedRequestId: null,
        lastSettledStatus: "loading",
        staleDropCount: 0,
      },
    });

    await act(async () => {
      artifactLoad.reject(new Error("artifact stream rejected"));
      await artifactLoad.promise.catch(() => undefined);
      await Promise.resolve();
    });

    expect(lastMetadata(observed)).toMatchObject({
      status: "error",
      runId: "hook-bad-run",
      error: "artifact stream rejected",
      eventCount: 0,
      checkpointCount: 0,
      archiveChronicle: {
        eventCount: 0,
        visibleCount: 0,
        items: [],
      },
      restoreCapability: {
        status: "error",
        error: "artifact stream rejected",
      },
      preview: {
        status: "error",
        error: "artifact stream rejected",
        errorSource: "artifact_load",
      },
      loadDiagnostics: {
        currentRequestId: 1,
        activeRequestId: null,
        completedLoadCount: 1,
        lastCompletedRequestId: 1,
        lastSettledRequestId: 1,
        lastSettledStatus: "error",
        staleDropCount: 0,
      },
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps lifecycle diagnostics path-free and stable enough under StrictMode", async () => {
    const staleStrictLoad = createDeferred<ReplayArtifacts>();
    const activeStrictLoad = createDeferred<ReplayArtifacts>();
    const pendingLoads = [staleStrictLoad, activeStrictLoad];
    const client = fakeClient(async () => {
      const deferred = pendingLoads.shift();
      if (!deferred) {
        throw new Error("unexpected strict-mode artifact load");
      }
      return deferred.promise;
    });
    const artifacts = makeArtifacts({
      events: [eventEntry(1), eventEntry(2), eventEntry(3)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 1, world_time: 18 }), "manual", 1),
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 19 }), "manual", 2),
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 20 }), "world_tick", 3),
      ],
    });
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));
    const run = makeRun({
      run_id: "strict-run",
      artifacts: {
        events: "runs/strict-events.jsonl",
        snapshots: "runs/strict-snapshots.jsonl",
        usage: "runs/strict-usage.jsonl",
        memory_root: "memory",
      },
    });

    await act(async () => {
      renderReplayMetadataProbe(root, {
        strictMode: true,
        run,
        client,
        archiveWindowStart: 0,
        onMetadata: (metadata) => observed.push(metadata),
      });
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(lastMetadata(observed).loadDiagnostics).toMatchObject({
      activeRequestId: 3,
      completedLoadCount: 0,
      staleDropCount: 0,
      lastSettledStatus: "loading",
    });

    await act(async () => {
      activeStrictLoad.resolve(artifacts);
      await activeStrictLoad.promise;
      await Promise.resolve();
    });
    expect(lastMetadata(observed).loadDiagnostics).toMatchObject({
      completedLoadCount: 1,
      lastCompletedRequestId: 3,
      staleDropCount: 0,
      lastSettledStatus: "ready",
    });

    await act(async () => {
      renderReplayMetadataProbe(root, {
        strictMode: true,
        run,
        client,
        selector: { lineNumber: 1 },
        archiveWindowStart: 2,
        onMetadata: (metadata) => observed.push(metadata),
      });
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
      },
      archiveChronicle: {
        window: {
          windowStart: 2,
          windowEnd: 3,
        },
      },
      loadDiagnostics: {
        completedLoadCount: 1,
        lastCompletedRequestId: 3,
        staleDropCount: 0,
      },
    });

    const serializedDiagnostics = JSON.stringify(lastMetadata(observed).loadDiagnostics);
    expect(serializedDiagnostics).not.toContain("runs/strict-events.jsonl");
    expect(serializedDiagnostics).not.toContain("runs/strict-snapshots.jsonl");
    await act(async () => {
      root.unmount();
    });
  });

  it("does not publish artifact metadata after unmounting before load resolution", async () => {
    const artifactLoad = createDeferred<ReplayArtifacts>();
    const client = fakeClient(async () => artifactLoad.promise);
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: makeRun({ run_id: "unmount-run" }),
        client,
        onMetadata: (metadata) => observed.push(metadata),
      });
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(lastMetadata(observed)).toMatchObject({
      status: "loading",
      runId: "unmount-run",
      loadDiagnostics: {
        currentRequestId: 1,
        activeRequestId: 1,
        completedLoadCount: 0,
        lastSettledStatus: "loading",
        staleDropCount: 0,
      },
    });

    await act(async () => {
      root.unmount();
    });
    const observedCountAfterUnmount = observed.length;

    await act(async () => {
      artifactLoad.resolve(makeArtifacts({
        events: [eventEntry(1)],
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 1, world_time: 18 }), "manual", 1)],
      }));
      await artifactLoad.promise;
      await Promise.resolve();
    });
    expect(observed).toHaveLength(observedCountAfterUnmount);
  });

  it("drops stale rejected artifact loads without replacing newer ready metadata", async () => {
    const staleLoad = createDeferred<ReplayArtifacts>();
    const nextLoad = createDeferred<ReplayArtifacts>();
    const loads = [staleLoad, nextLoad];
    const client = fakeClient(async () => {
      const deferred = loads.shift();
      if (!deferred) {
        throw new Error("unexpected stale rejection artifact load");
      }
      return deferred.promise;
    });
    const artifacts = makeArtifacts({
      events: [eventEntry(1), eventEntry(2), eventEntry(3)],
      checkpoints: [
        checkpointRecord(makeWorld({ event_cursor: 1, world_time: 18 }), "manual", 1),
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 19 }), "manual", 2),
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 20 }), "world_tick", 3),
      ],
    });
    const observed: ReplayMetadata[] = [];
    const root = createRoot(document.createElement("div"));
    const run = makeRun({ run_id: "stale-error-run" });
    const nextRun = makeRun({
      run_id: "stale-error-next",
      artifacts: {
        ...run.artifacts,
        events: "runs/stale-error-next-events.jsonl",
        snapshots: "runs/stale-error-next-snapshots.jsonl",
      },
    });

    await act(async () => {
      renderReplayMetadataProbe(root, {
        run,
        client,
        onMetadata: (metadata) => observed.push(metadata),
      });
    });
    await act(async () => {
      renderReplayMetadataProbe(root, {
        run: nextRun,
        client,
        selector: { lineNumber: 1 },
        archiveWindowStart: 2,
        onMetadata: (metadata) => observed.push(metadata),
      });
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(2);

    await act(async () => {
      nextLoad.resolve(artifacts);
      await nextLoad.promise;
      await Promise.resolve();
    });
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "stale-error-next",
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
      },
      loadDiagnostics: {
        completedLoadCount: 1,
        staleDropCount: 0,
        lastSettledStatus: "ready",
      },
    });

    await act(async () => {
      staleLoad.reject(new Error("old artifact failure"));
      await staleLoad.promise.catch(() => undefined);
      await Promise.resolve();
    });
    expect(lastMetadata(observed)).toMatchObject({
      status: "ready",
      runId: "stale-error-next",
      error: null,
      preview: {
        selectedCheckpointLineNumber: 1,
        selectedCheckpointIndex: 0,
      },
      loadDiagnostics: {
        completedLoadCount: 1,
        lastCompletedRequestId: 3,
        lastSettledRequestId: 1,
        lastSettledStatus: "stale_error",
        staleDropCount: 1,
        lastStaleRequestId: 1,
      },
    });

    await act(async () => {
      root.unmount();
    });
  });
});

function fakeClient(
  fetchArtifacts: () => Promise<ReplayArtifacts>,
): ReplayArtifactClient {
  let client: ReplayArtifactClient;
  client = {
    exportEvents: vi.fn(async () => []),
    exportSnapshots: vi.fn(async () => []),
    fetchEvents: vi.fn(async () => []),
    fetchSnapshots: vi.fn(async () => []),
    fetchArtifacts: vi.fn(fetchArtifacts),
    fetchForRun: vi.fn((runId: string) =>
      fetchReplayArtifactsForRun(client, runId)
    ),
    fetchOlderArtifacts: vi.fn(async (artifacts: ReplayArtifacts) => artifacts),
    reconcileSelector: vi.fn(async (previous, next, selector) =>
      reconcileReplaySelectorAfterArtifactShift(previous, next, selector)
    ),
  };
  return client;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function ReplayMetadataProbe({
  run,
  client,
  selector = null,
  archiveWindowStart = 0,
  onSelectorReconciled,
  onMetadata,
}: {
  run: ReturnType<typeof makeRun>;
  client: ReplayArtifactClient;
  selector?: { lineNumber: number } | { index: number } | null;
  archiveWindowStart?: number;
  onSelectorReconciled?(selector: { lineNumber: number } | { index: number }): void;
  onMetadata(metadata: ReplayMetadata): void;
}) {
  const [reconciledSelector, setReconciledSelector] = useState(selector);
  useEffect(() => setReconciledSelector(selector), [selector]);
  const metadata = useReplayMetadata(run, {
    client,
    selector: onSelectorReconciled ? reconciledSelector : selector,
    archiveWindowStart,
    onSelectorReconciled: onSelectorReconciled
      ? (nextSelector) => {
          setReconciledSelector(nextSelector);
          onSelectorReconciled(nextSelector);
        }
      : undefined,
  });
  useEffect(() => {
    onMetadata(metadata);
  }, [metadata, onMetadata]);
  return null;
}

function renderReplayMetadataProbe(
  root: ReturnType<typeof createRoot>,
  {
    strictMode = false,
    ...props
  }: Parameters<typeof ReplayMetadataProbe>[0] & { strictMode?: boolean },
): void {
  const probe = createElement(ReplayMetadataProbe, props);
  root.render(strictMode ? createElement(StrictMode, null, probe) : probe);
}

function lastMetadata(observed: readonly ReplayMetadata[]): ReplayMetadata {
  const metadata = observed.at(-1);
  if (!metadata) {
    throw new Error("No replay metadata observed");
  }
  return metadata;
}

function makeArtifacts(
  overrides: Partial<ReplayArtifacts> = {},
): ReplayArtifacts {
  const checkpoints = overrides.checkpoints ?? [];
  return {
    events: overrides.events ?? [],
    checkpoints,
    checkpointIndex: overrides.checkpointIndex ?? checkpoints.map((checkpoint) => ({
      lineNumber: checkpoint.lineNumber,
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      reason: checkpoint.reason,
      runId: checkpoint.run_id,
    })),
  };
}

function checkpointRecord(
  snapshot: WorldSnapshot,
  reason = "world_tick",
  lineNumber?: number,
): SnapshotCheckpoint {
  const checkpoint: SnapshotCheckpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
  if (lineNumber !== undefined) {
    checkpoint.lineNumber = lineNumber;
  }
  return checkpoint;
}

function eventEntry(cursor: number, event = eventRecord()): EventEnvelopeEntry {
  return {
    cursor,
    event,
    resolved: {},
    snapshot_after: null,
  };
}

function eventRecord(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  return {
    type: "speak",
    source: "world",
    payload: {},
    scope: "local",
    region: null,
    target: null,
    timestamp: 13,
    ...overrides,
  };
}
