import { describe, expect, it } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import type { ReplayArtifacts } from "./replayArtifactClient";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import {
  restoreReplayFromArtifacts,
  type ReplayRestoreResult,
} from "./replayRestore";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";

describe("replayRestore", () => {
  it("hydrates an exact checkpoint restore without applying later overlays", () => {
    const checkpoint = checkpointRecord(
      makeWorld({ event_cursor: 4, world_time: 12.5 }),
      "manual",
      9,
    );
    const result = expectReady(
      restoreReplayFromArtifacts(
        makeArtifacts({
          events: [eventEntry(2), eventEntry(4)],
          checkpoints: [checkpoint],
        }),
        { index: 0 },
      ),
    );

    expect(result.state.status).toBe("exact");
    expect(result.state.latestCursor).toBe(4);
    expect(result.state.appliedCursors).toEqual([]);
    expect(result.state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "meadow",
      source: "snapshot",
      exact: true,
    });
    expect(result.metadata).toMatchObject({
      checkpointIndex: 0,
      lineNumber: 9,
      eventCursor: 4,
      worldTime: 12.5,
      reason: "manual",
      runId: "seed-7-test",
      appliedEventCount: 0,
      skippedBeforeCheckpointCount: 2,
      stoppedBeforeCursor: null,
      nextExpectedCursor: 5,
      stopReason: null,
      checkpointStateExact: true,
      eventOverlayApplied: false,
      finalStateExact: true,
    });
  });

  it("selects repeated checkpoint cursors by stable index and line identity", () => {
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

    const byIndex = expectReady(
      restoreReplayFromArtifacts(artifacts, { index: 1 }),
    );
    expect(byIndex.metadata).toMatchObject({
      checkpointIndex: 1,
      lineNumber: 101,
      eventCursor: 5,
      worldTime: 21,
    });
    expect(byIndex.state.positionsByAgentId.get("agent_001")?.region).toBe("grove");

    const byLine = expectReady(
      restoreReplayFromArtifacts(artifacts, { lineNumber: 100 }),
    );
    expect(byLine.metadata).toMatchObject({
      checkpointIndex: 0,
      lineNumber: 100,
      eventCursor: 5,
      worldTime: 20,
    });
    expect(byLine.state.positionsByAgentId.get("agent_001")?.region).toBe("meadow");
  });

  it("returns replay-only errors for empty artifacts and malformed inputs", () => {
    expect(
      expectError(restoreReplayFromArtifacts(makeArtifacts(), { index: 0 })),
    ).toMatchObject({
      code: "empty_checkpoints",
    });

    expect(
      expectError(
        restoreReplayFromArtifacts(
          makeArtifacts({
            checkpoints: [checkpointRecord(makeWorld({ event_cursor: 1 }))],
          }),
          { eventCursor: 1 } as never,
        ),
      ),
    ).toMatchObject({
      code: "invalid_selector",
    });

    expect(
      expectError(
        restoreReplayFromArtifacts(
          { events: [], checkpoints: "bad" } as never,
          { index: 0 },
        ),
      ),
    ).toMatchObject({
      code: "malformed_artifacts",
    });
  });

  it("returns replay-only errors for unstable or missing checkpoint identities", () => {
    expect(
      expectError(
        restoreReplayFromArtifacts(
          makeArtifacts({
            checkpoints: [checkpointRecord(makeWorld({ event_cursor: 1 }))],
          }),
          { index: 2 },
        ),
      ),
    ).toMatchObject({
      code: "checkpoint_index_out_of_range",
    });

    expect(
      expectError(
        restoreReplayFromArtifacts(
          makeArtifacts({
            checkpoints: [checkpointRecord(makeWorld({ event_cursor: 1 }), "manual", 7)],
          }),
          { lineNumber: 8 },
        ),
      ),
    ).toMatchObject({
      code: "checkpoint_line_number_missing",
    });

    expect(
      expectError(
        restoreReplayFromArtifacts(
          makeArtifacts({
            checkpoints: [
              checkpointRecord(makeWorld({ event_cursor: 1 }), "manual", 7),
              checkpointRecord(makeWorld({ event_cursor: 2 }), "world_tick", 7),
            ],
          }),
          { lineNumber: 7 },
        ),
      ),
    ).toMatchObject({
      code: "checkpoint_line_number_duplicate",
    });
  });

  it("applies a contiguous event overlay after the selected checkpoint", () => {
    const result = expectReady(
      restoreReplayFromArtifacts(
        makeArtifacts({
          events: [
            eventEntry(3),
            eventEntry(
              5,
              "agent_left_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "meadow" },
              { source: "agent_001", region: "meadow", timestamp: 13 },
            ),
            eventEntry(
              6,
              "agent_entered_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
              { source: "agent_001", region: "grove", timestamp: 13.1 },
            ),
          ],
          checkpoints: [
            checkpointRecord(makeWorld({ event_cursor: 4 }), "world_tick", 12),
          ],
        }),
        { lineNumber: 12 },
      ),
    );

    expect(result.state.status).toBe("approximate");
    expect(result.state.latestCursor).toBe(6);
    expect(result.state.appliedCursors).toEqual([5, 6]);
    expect(result.state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "grove",
      source: "event",
      exact: false,
    });
    expect(result.metadata).toMatchObject({
      appliedEventCount: 2,
      skippedBeforeCheckpointCount: 1,
      stoppedBeforeCursor: null,
      nextExpectedCursor: 7,
      stopReason: null,
      eventOverlayApplied: true,
      finalStateExact: false,
    });
  });

  it("stops before a gap without applying the later event", () => {
    const result = expectReady(
      restoreReplayFromArtifacts(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_left_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "meadow" },
              { source: "agent_001", region: "meadow" },
            ),
            eventEntry(
              7,
              "agent_entered_region",
              { to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
              { source: "agent_001", region: "grove" },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );

    expect(result.state.latestCursor).toBe(5);
    expect(result.state.appliedCursors).toEqual([5]);
    expect(result.metadata).toMatchObject({
      appliedEventCount: 1,
      stoppedBeforeCursor: 7,
      nextExpectedCursor: 6,
      stopReason: "gap",
      eventOverlayApplied: true,
      finalStateExact: false,
    });
  });

  it("stops before a stale event-line cursor without throwing", () => {
    const result = expectReady(
      restoreReplayFromArtifacts(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_left_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "meadow" },
              { source: "agent_001", region: "meadow" },
            ),
            eventEntry(
              5,
              "agent_entered_region",
              { to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
              { source: "agent_001", region: "grove" },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );

    expect(result.state.latestCursor).toBe(5);
    expect(result.state.appliedCursors).toEqual([5]);
    expect(result.metadata).toMatchObject({
      appliedEventCount: 1,
      stoppedBeforeCursor: 5,
      nextExpectedCursor: 6,
      stopReason: "stale",
      eventOverlayApplied: true,
      finalStateExact: false,
    });
  });

  it("does not mutate a live WorldStore while restoring replay artifacts", () => {
    const store = createWorldStore();
    const run = makeRun({ run_id: "live-run", event_cursor: 8 });
    const liveWorld = makeWorld({ event_cursor: 8, world_time: 22 });
    const liveEntry = eventEntry(9);
    store.applyRun(run);
    store.applySnapshot(liveWorld);
    store.applyEventEnvelope(makeEventEnvelope({
      cursor: 8,
      next_cursor: 9,
      events: [liveEntry],
    }));
    const before = store.getState();

    const result = expectReady(
      restoreReplayFromArtifacts(
        makeArtifacts({
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
        }),
        { index: 0 },
      ),
    );

    expect(result.state.latestCursor).toBe(5);
    expect(store.getState()).toBe(before);
    expect(store.getState().snapshot).toBe(liveWorld);
    expect(store.getState().eventCursor).toBe(9);
    expect(store.getState().eventBeats).toEqual([liveEntry]);
    expect(store.getState().connection).toBe("idle");
  });
});

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

function expectReady(
  result: ReplayRestoreResult,
): Extract<ReplayRestoreResult, { status: "ready" }> {
  expect(result.status).toBe("ready");
  if (result.status !== "ready") {
    throw new Error(result.error.message);
  }
  return result;
}

function expectError(
  result: ReplayRestoreResult,
): Extract<ReplayRestoreResult, { status: "error" }>["error"] {
  expect(result.status).toBe("error");
  if (result.status !== "error") {
    throw new Error("Expected replay restore to fail.");
  }
  expect(result.state).toBeNull();
  expect(result.metadata).toBeNull();
  return result.error;
}
