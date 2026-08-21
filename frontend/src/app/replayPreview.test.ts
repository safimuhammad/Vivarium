import { describe, expect, it, vi } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import {
  fetchReplayArtifactsForRun,
  reconcileReplaySelectorAfterArtifactShift,
  type ReplayArtifactClient,
  type ReplayArtifacts,
} from "./replayArtifactClient";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import {
  buildReplayPreviewFromArtifacts,
  buildReplayPreviewFromSessionState,
  loadReplayPreview,
  type ReplayPreviewErrorResult,
  type ReplayPreviewNoneResult,
  type ReplayPreviewReadyResult,
  type ReplayPreviewResult,
} from "./replayPreview";
import { createReplayState } from "./replayReducer";
import type { ReplayRestoreMetadata } from "./replayRestore";
import type { ReplaySessionState } from "./replaySession";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";

describe("replayPreview", () => {
  it("loads a ready preview from artifacts using the latest stable checkpoint index", async () => {
    const first = checkpointRecord(
      makeWorld({ event_cursor: 2, world_time: 10 }),
      "manual",
      20,
    );
    const latest = checkpointRecord(
      makeWorld({ event_cursor: 4, world_time: 12.5 }),
      "world_tick",
      21,
    );
    const artifacts = makeArtifacts({
      events: [eventEntry(3), eventEntry(4)],
      checkpoints: [first, latest],
    });
    const client = fakeClient(async () => artifacts);

    const preview = expectReady(await loadReplayPreview({ client }));

    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(client.fetchEvents).not.toHaveBeenCalled();
    expect(client.fetchSnapshots).not.toHaveBeenCalled();
    expect(preview.selector).toEqual({ index: 1 });
    expect(preview.artifacts).toEqual({
      eventCount: 2,
      checkpointCount: 2,
      checkpointIndexCount: 2,
    });
    expect(preview.sessionState.status).toBe("ready");
    expect(preview.restoreMetadata).toMatchObject({
      checkpointIndex: 1,
      lineNumber: 21,
      eventCursor: 4,
      worldTime: 12.5,
      skippedBeforeCheckpointCount: 2,
    });
    expect(preview.renderSnapshot).toEqual(latest.snapshot);
    expect(preview.renderSnapshot).not.toBe(latest.snapshot);
    expect(preview.renderMetadata).toMatchObject({
      sourceIdentifier: "replay-session",
      selector: { index: 1 },
      checkpointIndex: 1,
      checkpointLineNumber: 21,
      checkpointCursor: 4,
      checkpointWorldTime: 12.5,
      renderedCursor: 4,
      renderedWorldTime: 12.5,
      stopReason: null,
      nextExpectedCursor: 5,
    });
  });

  it("resolves artifact load failures to error results", async () => {
    const loadError = Object.assign(new Error("artifact endpoint unavailable"), {
      code: "artifact_unavailable",
    });
    const client = fakeClient(async () => {
      throw loadError;
    });

    await expect(loadReplayPreview({ client })).resolves.toMatchObject({
      status: "error",
      artifacts: {
        eventCount: 0,
        checkpointCount: 0,
        checkpointIndexCount: 0,
      },
      sessionState: null,
      error: {
        source: "artifact_load",
        category: "artifact_load",
        message: "artifact endpoint unavailable",
        code: "artifact_unavailable",
      },
    });
    expect(client.fetchArtifacts).toHaveBeenCalledTimes(1);
    expect(client.fetchEvents).not.toHaveBeenCalled();
    expect(client.fetchSnapshots).not.toHaveBeenCalled();
  });

  it("returns none for empty or checkpoint-free artifacts", () => {
    const preview = expectNone(
      buildReplayPreviewFromArtifacts(makeArtifacts({
        events: [eventEntry(1)],
      })),
    );

    expect(preview).toMatchObject({
      status: "none",
      reason: "no_checkpoint",
      selector: null,
      artifacts: {
        eventCount: 1,
        checkpointCount: 0,
        checkpointIndexCount: 0,
      },
      sessionState: null,
    });

    expect(
      buildReplayPreviewFromArtifacts(makeArtifacts(), {
        selector: { index: 0 },
      }),
    ).toMatchObject({
      status: "none",
      reason: "no_checkpoint",
      selector: { index: 0 },
    });
  });

  it("captures restore errors without throwing", () => {
    const malformedSnapshot: WorldSnapshot = {
      ...makeWorld({ event_cursor: 4, world_time: 18.5 }),
      agents: undefined as unknown as WorldSnapshot["agents"],
    };
    const artifacts = makeArtifacts({
      checkpoints: [checkpointRecord(malformedSnapshot, "world_tick", 8)],
    });

    expect(() => buildReplayPreviewFromArtifacts(artifacts)).not.toThrow();
    const preview = expectError(buildReplayPreviewFromArtifacts(artifacts));

    expect(preview.selector).toEqual({ index: 0 });
    expect(preview.sessionState?.status).toBe("error");
    expect(preview.error).toMatchObject({
      source: "restore",
      category: "restore",
      code: "hydrate_failed",
    });
    expect(preview.error.message).toMatch(/Replay checkpoint restore failed/);
  });

  it("rejects event-cursor-only selectors at the preview boundary", () => {
    const artifacts = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    });

    const preview = expectError(
      buildReplayPreviewFromArtifacts(artifacts, {
        selector: { eventCursor: 4 } as never,
      }),
    );

    expect(preview.selector).toBeNull();
    expect(preview.sessionState?.status).toBe("error");
    expect(preview.error).toMatchObject({
      source: "restore",
      category: "restore",
      code: "invalid_selector",
    });
  });

  it("keeps repeated checkpoint cursors distinguishable by index and line number", () => {
    const first = checkpointRecord(
      makeWorld({ event_cursor: 5, world_time: 20 }),
      "manual",
      100,
    );
    const second = checkpointRecord(
      makeWorld({
        event_cursor: 5,
        world_time: 21,
        agents: makeWorld().agents.map((agent) =>
          agent.id === "agent_001" ? { ...agent, position: "grove" } : agent,
        ),
      }),
      "world_tick",
      101,
    );
    const artifacts = makeArtifacts({ checkpoints: [first, second] });

    const byIndex = expectReady(buildReplayPreviewFromArtifacts(artifacts));
    expect(byIndex.selector).toEqual({ index: 1 });
    expect(byIndex.renderMetadata).toMatchObject({
      checkpointIndex: 1,
      checkpointLineNumber: 101,
      checkpointCursor: 5,
      checkpointWorldTime: 21,
    });
    expect(
      byIndex.renderSnapshot.agents.find((agent) => agent.id === "agent_001")
        ?.position,
    ).toBe("grove");

    const byLine = expectReady(
      buildReplayPreviewFromArtifacts(artifacts, { selector: { lineNumber: 100 } }),
    );
    expect(byLine.selector).toEqual({ lineNumber: 100 });
    expect(byLine.renderMetadata).toMatchObject({
      checkpointIndex: 0,
      checkpointLineNumber: 100,
      checkpointCursor: 5,
      checkpointWorldTime: 20,
    });
    expect(
      byLine.renderSnapshot.agents.find((agent) => agent.id === "agent_001")
        ?.position,
    ).toBe("meadow");
  });

  it("passes gap and stale stop metadata through to render metadata", () => {
    const gap = expectReady(
      buildReplayPreviewFromArtifacts(makeArtifacts({
        events: [eventEntry(5), eventEntry(7)],
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
      })),
    );
    expect(gap.renderMetadata).toMatchObject({
      appliedEventCount: 1,
      renderedCursor: 5,
      stopReason: "gap",
      stoppedBeforeCursor: 7,
      nextExpectedCursor: 6,
      checkpointStateExact: true,
      eventOverlayApplied: true,
      finalStateExact: false,
    });

    const stale = expectReady(
      buildReplayPreviewFromArtifacts(makeArtifacts({
        events: [eventEntry(5), eventEntry(5)],
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
      })),
    );
    expect(stale.renderMetadata).toMatchObject({
      appliedEventCount: 1,
      renderedCursor: 5,
      stopReason: "stale",
      stoppedBeforeCursor: 5,
      nextExpectedCursor: 6,
      checkpointStateExact: true,
      eventOverlayApplied: true,
      finalStateExact: false,
    });
  });

  it("returns none for ready session state without a checkpoint snapshot", () => {
    const sessionState: ReplaySessionState = {
      status: "ready",
      state: createReplayState(),
      metadata: metadata(),
      error: null,
      selector: { index: 0 },
    };

    const preview = expectNone(
      buildReplayPreviewFromSessionState(sessionState, {
        eventCount: 0,
        checkpointCount: 1,
        checkpointIndexCount: 1,
      }),
    );

    expect(preview).toMatchObject({
      status: "none",
      reason: "no_checkpoint",
      selector: { index: 0 },
      artifacts: {
        eventCount: 0,
        checkpointCount: 1,
        checkpointIndexCount: 1,
      },
      sessionState,
    });
  });

  it("does not mutate a live WorldStore while loading or building preview state", async () => {
    const store = createWorldStore();
    const run = makeRun({ run_id: "live-run", event_cursor: 8 });
    const liveWorld = makeWorld({
      run_id: "live-run",
      event_cursor: 8,
      world_time: 22,
    });
    const liveEntry = eventEntry(9);
    store.applyRun(run);
    store.applySnapshot(liveWorld);
    store.applyEventEnvelope(makeEventEnvelope({
      cursor: 8,
      next_cursor: 10,
      events: [liveEntry],
    }));
    const before = store.getState();
    const artifacts = makeArtifacts({
      events: [
        eventEntry(
          5,
          "agent_entered_region",
          { to_region: "grove" },
          { actor_id: "agent_001", region: "grove" },
          { source: "agent_001", region: "grove" },
        ),
      ],
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    });
    const client = fakeClient(async () => artifacts);

    expectReady(await loadReplayPreview({ client }));
    expectReady(buildReplayPreviewFromArtifacts(artifacts));

    expect(store.getState()).toBe(before);
    expect(store.getState().snapshot).toBe(liveWorld);
    expect(store.getState().eventCursor).toBe(10);
    expect(store.getState().eventBeats).toEqual([liveEntry]);
    expect(store.getState().connection).toBe("idle");
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

function eventEntry(
  cursor: number,
  type = "speak",
  payload: Record<string, unknown> = {},
  resolved: EventEnvelopeEntry["resolved"] = {},
  overrides: Partial<Omit<SerializedEvent, "type" | "payload">> = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: overrides.source ?? "world",
      payload,
      scope: overrides.scope ?? "local",
      region: overrides.region ?? null,
      target: overrides.target ?? null,
      timestamp: overrides.timestamp ?? 13,
    },
    resolved,
    snapshot_after: null,
  };
}

function metadata(
  overrides: Partial<ReplayRestoreMetadata> = {},
): ReplayRestoreMetadata {
  return {
    checkpointIndex: 0,
    lineNumber: null,
    eventCursor: 0,
    worldTime: 0,
    reason: "world_tick",
    runId: "seed-7-test",
    appliedEventCount: 0,
    skippedBeforeCheckpointCount: 0,
    stoppedBeforeCursor: null,
    nextExpectedCursor: 1,
    stopReason: null,
    checkpointStateExact: true,
    eventOverlayApplied: false,
    finalStateExact: false,
    ...overrides,
  };
}

function expectReady(result: ReplayPreviewResult): ReplayPreviewReadyResult {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error("Expected replay preview to be ready.");
  }
  return result;
}

function expectNone(result: ReplayPreviewResult): ReplayPreviewNoneResult {
  expect(result.status).toBe("none");
  if (result.status !== "none") {
    throw new Error("Expected replay preview to have no checkpoint.");
  }
  return result;
}

function expectError(result: ReplayPreviewResult): ReplayPreviewErrorResult {
  expect(result.status).toBe("error");
  if (result.status !== "error") {
    throw new Error("Expected replay preview to be an error.");
  }
  return result;
}
