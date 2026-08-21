import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import { replayHasExactWorldState } from "./replayReducer";
import {
  buildCheckpointIndex,
  hydrateReplayFromCheckpoint,
  parseReplayEventLine,
  parseSnapshotCheckpoint,
  parseSnapshotCheckpointLine,
  type SnapshotCheckpoint,
} from "./replayArtifacts";
import type { SerializedEvent, WorldSnapshot } from "./schemas";

describe("replayArtifacts", () => {
  it("parses valid checkpoints and rejects outer/nested cursor mismatches", () => {
    const world = makeWorld({ event_cursor: 5, world_time: 14 });
    const checkpoint = parseSnapshotCheckpointLine(
      JSON.stringify(checkpointRecord(world, "manual")),
      12,
    );

    expect(checkpoint).toMatchObject({
      schema: 1,
      type: "world_snapshot_checkpoint",
      reason: "manual",
      run_id: "seed-7-test",
      world_time: 14,
      event_cursor: 5,
      lineNumber: 12,
    });
    expect(checkpoint.snapshot).toEqual(world);

    expect(() =>
      parseSnapshotCheckpoint({
        ...checkpointRecord(world),
        event_cursor: 6,
      }),
    ).toThrow(/event_cursor 6 does not match snapshot event_cursor 5/);

    expect(() =>
      parseSnapshotCheckpoint({
        ...checkpointRecord(world),
        event_cursor: 5.5,
      }),
    ).toThrow(/checkpoint\.event_cursor must be a non-negative integer/);
  });

  it("builds a checkpoint index without deduping repeated event cursors", () => {
    const firstCheckpointLine = JSON.stringify(
      checkpointRecord(makeWorld({ event_cursor: 2, world_time: 13 }), "manual"),
    );
    const checkpoints = [
      { line: firstCheckpointLine },
      parseSnapshotCheckpoint(
        checkpointRecord(makeWorld({ event_cursor: 5, world_time: 14 }), "world_tick"),
        { lineNumber: 8 },
      ),
      parseSnapshotCheckpoint(
        checkpointRecord(makeWorld({ event_cursor: 5, world_time: 15 }), "world_tick"),
        { lineNumber: 9 },
      ),
    ];

    expect(buildCheckpointIndex(checkpoints)).toEqual([
      {
        lineNumber: 1,
        eventCursor: 2,
        worldTime: 13,
        reason: "manual",
        runId: "seed-7-test",
      },
      {
        lineNumber: 8,
        eventCursor: 5,
        worldTime: 14,
        reason: "world_tick",
        runId: "seed-7-test",
      },
      {
        lineNumber: 9,
        eventCursor: 5,
        worldTime: 15,
        reason: "world_tick",
        runId: "seed-7-test",
      },
    ]);
  });

  it("parses durable event lines with line cursors and live-style resolved hints", () => {
    const event = eventRecord({
      source: "agent_fallback",
      payload: {
        speaker_id: "agent_001",
        recipient_id: "agent_002",
        target_home: "home_001",
        amount: 7,
        resource_type: "energy",
        region: "payload_region",
      },
      region: "meadow",
      target: "agent_003",
    });

    const entry = parseReplayEventLine(JSON.stringify(event), 17);

    expect(entry.cursor).toBe(17);
    expect(entry.event).toEqual(event);
    expect(entry.snapshot_after).toBeNull();
    expect(entry.resolved).toEqual({
      actor_id: "agent_001",
      target_id: "agent_003",
      region: "meadow",
      home_id: "home_001",
      amount: 7,
      resource_type: "energy",
    });

    expect(
      parseReplayEventLine(
        JSON.stringify(eventRecord({ source: "agent_009", payload: {} })),
        18,
      ).resolved.actor_id,
    ).toBe("agent_009");
  });

  it("throws on malformed durable event JSONL", () => {
    expect(() => parseReplayEventLine("{", 1)).toThrow(/malformed JSON/);
  });

  it("hydrates from a checkpoint through contiguous events and stops before gaps", () => {
    const checkpoint = parseSnapshotCheckpoint(
      checkpointRecord(makeWorld({ event_cursor: 4 })),
    );
    const stale = parseReplayEventLine(
      JSON.stringify(eventRecord({ type: "speak" })),
      3,
    );
    const left = parseReplayEventLine(
      JSON.stringify(
        eventRecord({
          type: "agent_left_region",
          source: "agent_001",
          payload: {
            from_region: "meadow",
            to_region: "grove",
          },
          region: "meadow",
        }),
      ),
      5,
    );
    const entered = parseReplayEventLine(
      JSON.stringify(
        eventRecord({
          type: "agent_entered_region",
          source: "agent_001",
          payload: {
            from_region: "meadow",
            to_region: "grove",
          },
          region: "grove",
        }),
      ),
      6,
    );
    const afterGap = parseReplayEventLine(
      JSON.stringify(
        eventRecord({
          type: "agent_entered_region",
          source: "agent_002",
          payload: {
            to_region: "meadow",
          },
          region: "meadow",
        }),
      ),
      8,
    );

    const exact = hydrateReplayFromCheckpoint(checkpoint, [stale]);
    expect(exact.appliedEventCount).toBe(0);
    expect(exact.skippedBeforeCheckpointCount).toBe(1);
    expect(replayHasExactWorldState(exact.state)).toBe(true);

    const hydrated = hydrateReplayFromCheckpoint(checkpoint, [
      stale,
      left,
      entered,
      afterGap,
    ]);

    expect(hydrated.appliedEventCount).toBe(2);
    expect(hydrated.skippedBeforeCheckpointCount).toBe(1);
    expect(hydrated.stoppedBeforeCursor).toBe(8);
    expect(hydrated.nextExpectedCursor).toBe(7);
    expect(hydrated.stopReason).toBe("gap");
    expect(hydrated.state.status).toBe("approximate");
    expect(hydrated.state.latestCursor).toBe(6);
    expect(hydrated.state.appliedCursors).toEqual([5, 6]);
    expect(hydrated.state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "grove",
      source: "event",
      exact: false,
    });
    expect(hydrated.state.positionsByAgentId.get("agent_002")).toMatchObject({
      region: "grove",
      source: "snapshot",
      exact: true,
    });
  });
});

function checkpointRecord(
  snapshot: WorldSnapshot,
  reason = "world_tick",
): Omit<SnapshotCheckpoint, "lineNumber"> {
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
}

function eventRecord(
  overrides: Partial<SerializedEvent> = {},
): SerializedEvent {
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
