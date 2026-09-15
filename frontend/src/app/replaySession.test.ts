import { describe, expect, it } from "vitest";

import rawC15 from "../../../tests/frontend-app/fixtures/chronicles/data/C15-archive-live-isolation.json";
import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import type { ReplayArtifacts } from "./replayArtifactClient";
import { parseSnapshotCheckpoint, type SnapshotCheckpoint } from "./replayArtifacts";
import {
  createHistoricalReplayPresentationWindow,
  createReplaySession,
  type ReplaySessionState,
} from "./replaySession";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";

describe("ReplaySession", () => {
  it("starts idle and resets back to idle", () => {
    const session = createReplaySession();

    expect(session.getState()).toEqual({
      status: "idle",
      state: null,
      metadata: null,
      error: null,
      selector: null,
    });

    session.restore(
      makeArtifacts({
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
      }),
      { index: 0 },
    );
    expect(session.getState().status).toBe("ready");

    const resetState = session.reset();

    expect(resetState).toBe(session.getState());
    expect(resetState).toEqual({
      status: "idle",
      state: null,
      metadata: null,
      error: null,
      selector: null,
    });
  });

  it("stores restored replay state and metadata on success", () => {
    const session = createReplaySession();
    const result = expectReady(
      session.restore(
        makeArtifacts({
          events: [eventEntry(2), eventEntry(4)],
          checkpoints: [
            checkpointRecord(makeWorld({ event_cursor: 4, world_time: 12.5 }), "manual", 9),
          ],
        }),
        { index: 0 },
      ),
    );

    expect(result).toBe(session.getState());
    expect(result.state.status).toBe("exact");
    expect(result.state.latestCursor).toBe(4);
    expect(result.metadata).toMatchObject({
      checkpointIndex: 0,
      lineNumber: 9,
      eventCursor: 4,
      worldTime: 12.5,
      reason: "manual",
      appliedEventCount: 0,
      skippedBeforeCheckpointCount: 2,
      stopReason: null,
    });
    expect(result.selector).toEqual({ index: 0 });
  });

  it("captures restore errors without throwing", () => {
    const session = createReplaySession();

    expect(() => {
      session.restore(makeArtifacts(), { index: 0 });
    }).not.toThrow();

    const state = expectError(session.getState());
    expect(state.error).toMatchObject({
      code: "empty_checkpoints",
    });
    expect(state.selector).toEqual({ index: 0 });
  });

  it("captures runtime-invalid selector shapes without storing unstable identities", () => {
    const session = createReplaySession();
    const artifacts = makeArtifacts({
      checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
    });

    for (const selector of [
      { eventCursor: 4 },
      { index: 0, lineNumber: 1 },
      { index: Number.NaN },
      { lineNumber: -1 },
    ]) {
      const state = expectError(
        session.restore(artifacts, selector as never),
      );
      expect(state.error.code).toBe("invalid_selector");
      expect(state.selector).toBeNull();
    }
  });

  it("restores repeated checkpoint cursors by stable index and line number", () => {
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
    const session = createReplaySession();

    const byIndex = expectReady(session.restore(artifacts, { index: 1 }));
    expect(byIndex.metadata).toMatchObject({
      checkpointIndex: 1,
      lineNumber: 101,
      eventCursor: 5,
      worldTime: 21,
    });
    expect(byIndex.state.positionsByAgentId.get("agent_001")?.region).toBe("grove");
    expect(byIndex.selector).toEqual({ index: 1 });

    const byLine = expectReady(session.restore(artifacts, { lineNumber: 100 }));
    expect(byLine.metadata).toMatchObject({
      checkpointIndex: 0,
      lineNumber: 100,
      eventCursor: 5,
      worldTime: 20,
    });
    expect(byLine.state.positionsByAgentId.get("agent_001")?.region).toBe("meadow");
    expect(byLine.selector).toEqual({ lineNumber: 100 });
  });

  it("preserves gap and stale stop metadata from restore", () => {
    const session = createReplaySession();

    const gap = expectReady(
      session.restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_left_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "meadow" },
            ),
            eventEntry(
              7,
              "agent_entered_region",
              { to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );
    expect(gap.metadata).toMatchObject({
      appliedEventCount: 1,
      stoppedBeforeCursor: 7,
      nextExpectedCursor: 6,
      stopReason: "gap",
    });

    const stale = expectReady(
      session.restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_left_region",
              { from_region: "meadow", to_region: "grove" },
              { actor_id: "agent_001", region: "meadow" },
            ),
            eventEntry(
              5,
              "agent_entered_region",
              { to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );
    expect(stale.metadata).toMatchObject({
      appliedEventCount: 1,
      stoppedBeforeCursor: 5,
      nextExpectedCursor: 6,
      stopReason: "stale",
    });
  });

  it("copies selector identity before caller mutations", () => {
    const session = createReplaySession();
    const selector = { index: 0 };

    session.restore(
      makeArtifacts({
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
      }),
      selector,
    );
    selector.index = 3;

    const state = expectReady(session.getState());
    expect(state.selector).toEqual({ index: 0 });
    expect(state.selector).not.toBe(selector);
  });

  it("does not mutate a live WorldStore while restoring replay artifacts", () => {
    const store = createWorldStore();
    const run = makeRun({ run_id: "live-run", event_cursor: 8 });
    const liveWorld = makeWorld({ run_id: "live-run", event_cursor: 8, world_time: 22 });
    const liveEntry = eventEntry(9);
    store.applyRun(run);
    store.applySnapshot(liveWorld);
    store.applyEventEnvelope(makeEventEnvelope({
      cursor: 8,
      next_cursor: 9,
      events: [liveEntry],
    }));
    const before = store.getState();

    const session = createReplaySession();
    const result = expectReady(
      session.restore(
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

  it("notifies subscribers and stops after unsubscribe", () => {
    const session = createReplaySession();
    const observed: ReplaySessionState["status"][] = [];
    const unsubscribe = session.subscribe(() => {
      observed.push(session.getState().status);
    });

    session.restore(
      makeArtifacts({
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
      }),
      { index: 0 },
    );
    session.reset();
    unsubscribe();
    session.restore(
      makeArtifacts({
        checkpoints: [checkpointRecord(makeWorld({ event_cursor: 5 }))],
      }),
      { index: 0 },
    );

    expect(observed).toEqual(["ready", "idle"]);
  });

  it("exposes an adjacent archive presentation window without changing ready state", () => {
    const checkpoint = checkpointRecord(
      makeWorld({ run_id: "archive-run", event_cursor: 4, world_time: 20 }),
      "manual",
      17,
    );
    const artifacts = makeArtifacts({
      events: [
        eventEntry(4),
        eventEntry(5, "speak", { message: "five" }),
        eventEntry(6, "speak", { message: "six" }),
        eventEntry(8, "agent_died", { agent_id: "agent_001" }),
      ],
      checkpoints: [checkpoint],
      runId: "archive-run",
    });
    const session = createReplaySession();

    const state = session.restore(artifacts, { lineNumber: 17 });
    const window = session.getPresentationWindow();

    expect(state.status).toBe("ready");
    expect(Object.keys(state).sort()).toEqual([
      "error",
      "metadata",
      "selector",
      "state",
      "status",
    ]);
    expect(window).toMatchObject({
      sourceKey: "archive:archive-run:line-17:window-4-6",
      checkpointIndex: 0,
      checkpointLineNumber: 17,
      firstCursor: 4,
      lastCursor: 6,
      snapshot: { run_id: "archive-run", event_cursor: 4 },
    });
    expect(window?.entries.map((entry) => entry.cursor)).toEqual([5, 6]);
  });

  it("uses C15's exact checkpoint/window identity and never aliases the Live source", () => {
    const rawCheckpoint = rawC15.checkpoints[0];
    const checkpoint = parseSnapshotCheckpoint(rawCheckpoint.checkpoint, {
      lineNumber: rawCheckpoint.line,
    });
    const session = createReplaySession();

    session.restore(
      makeArtifacts({
        checkpoints: [checkpoint],
        runId: rawC15.runId,
      }),
      { lineNumber: rawCheckpoint.line },
    );

    expect(session.getPresentationWindow()).toMatchObject({
      sourceKey: "archive:mock-c15-v1:line-1:window-0-0",
      checkpointIndex: 0,
      checkpointLineNumber: 1,
      firstCursor: 0,
      lastCursor: 0,
      entries: [],
    });
    expect(session.getPresentationWindow()?.sourceKey).not.toBe(
      `live:${rawC15.runId}`,
    );
  });

  it("uses checkpoint and retained-window identity in every archive source key", () => {
    const first = checkpointRecord(
      makeWorld({ run_id: "archive-run", event_cursor: 4, world_time: 20 }),
      "manual",
      17,
    );
    const second = checkpointRecord(
      makeWorld({ run_id: "archive-run", event_cursor: 4, world_time: 21 }),
      "manual",
      18,
    );
    const session = createReplaySession();
    const artifacts = makeArtifacts({
      events: [eventEntry(5)],
      checkpoints: [first, second],
      runId: "archive-run",
    });

    session.restore(artifacts, { lineNumber: 17 });
    const firstKey = session.getPresentationWindow()?.sourceKey;
    session.restore(artifacts, { lineNumber: 18 });
    const secondKey = session.getPresentationWindow()?.sourceKey;

    expect(firstKey).toBe("archive:archive-run:line-17:window-4-5");
    expect(secondKey).toBe("archive:archive-run:line-18:window-4-5");
    expect(secondKey).not.toBe(firstKey);
    expect(secondKey).not.toBe("live:archive-run");
  });

  it("does not create presentation capability across an artifact/checkpoint run mismatch", () => {
    const session = createReplaySession();
    const state = session.restore(
      makeArtifacts({
        runId: "replacement-run",
        checkpoints: [checkpointRecord(
          makeWorld({ run_id: "older-run", event_cursor: 4 }),
          "manual",
          17,
        )],
      }),
      { lineNumber: 17 },
    );

    expect(state.status).toBe("ready");
    expect(session.getPresentationWindow()).toBeNull();
  });

  it("owns the archive presentation window across caller mutation and clears it on failure or reset", () => {
    const checkpoint = checkpointRecord(
      makeWorld({ run_id: "archive-run", event_cursor: 4 }),
      "manual",
      17,
    );
    const artifacts = makeArtifacts({
      events: [eventEntry(5, "speak", { message: "durable" })],
      checkpoints: [checkpoint],
      runId: "archive-run",
    });
    const session = createReplaySession();

    session.restore(artifacts, { lineNumber: 17 });
    artifacts.events[0].event.payload.message = "mutated";
    checkpoint.snapshot.agents.length = 0;

    expect(session.getPresentationWindow()?.entries[0].event.payload.message).toBe("durable");
    expect(session.getPresentationWindow()?.snapshot.agents).not.toHaveLength(0);

    session.restore(makeArtifacts(), { index: 0 });
    expect(session.getPresentationWindow()).toBeNull();
    session.restore(makeArtifacts({ checkpoints: [checkpoint] }), { index: 0 });
    expect(session.getPresentationWindow()).not.toBeNull();
    session.reset();
    expect(session.getPresentationWindow()).toBeNull();
  });

  it("builds a spatial card window from the latest checkpoint true at the card time, never a later same-cursor snapshot", () => {
    const base = spatialReplaySnapshot("spatial-run", 0, 0, 20);
    const laterSameCursor = spatialReplaySnapshot("spatial-run", 1, 25, 120);
    const start = spatialReplayEntry("spatial_travel_started", 1, 10);
    const stop = spatialReplayEntry("spatial_travel_cancelled", 2, 20);
    const window = createHistoricalReplayPresentationWindow(makeArtifacts({
      runId: "spatial-run",
      events: [start, stop],
      checkpoints: [
        checkpointRecord(base, "recorded", 1),
        checkpointRecord(laterSameCursor, "future", 2),
      ],
    }), 1);

    expect(window).toMatchObject({
      sourceKey: "archive:spatial-run:line-1:replay-0-1",
      checkpointIndex: 0,
      firstCursor: 0,
      lastCursor: 1,
      snapshot: { world_time: 0, event_cursor: 0 },
      historical: { targetCursor: 1, targetWorldTime: 10 },
    });
    expect(window?.entries.map((entry) => entry.cursor)).toEqual([1]);
    expect(window?.historical?.continuation.map((entry) => entry.cursor)).toEqual([2]);
    expect(window?.snapshot.agents[0]?.spatial?.x).toBe(20);
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
    ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
    ...(overrides.eventTotalCount === undefined
      ? {}
      : { eventTotalCount: overrides.eventTotalCount }),
    ...(overrides.checkpointTotalCount === undefined
      ? {}
      : { checkpointTotalCount: overrides.checkpointTotalCount }),
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

function spatialReplaySnapshot(
  runId: string,
  eventCursor: number,
  worldTime: number,
  x: number,
): WorldSnapshot {
  const base = makeWorld({ run_id: runId, event_cursor: eventCursor, world_time: worldTime });
  return {
    ...base,
    agents: [{
      ...base.agents[0]!,
      position: "nirvana",
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x,
        y: 40,
        observed_at: worldTime,
        at_landmark: null,
        travel: null,
      },
    }],
    regions: [{
      ...base.regions[0]!,
      name: "nirvana",
      connections: [],
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        tile_size: 32,
        landmarks: [{ id: "east-gate", name: "East Gate", x: 120, y: 40, affordances: ["travel"] }],
        initial_pressure: { populationHighWater: 1, builtFootprintHighWater: 0 },
      },
    }],
    homes: [],
    ruins: [],
    pending_proposals: [],
    region_pressure: [{ region: "nirvana", population_high_water: 1, built_footprint_high_water: 0 }],
  };
}

function spatialReplayEntry(
  type: "spatial_travel_started" | "spatial_travel_cancelled",
  cursor: number,
  timestamp: number,
): EventEnvelopeEntry {
  const traveling = type === "spatial_travel_started";
  const position = traveling ? { x: 20, y: 40 } : { x: 120, y: 40 };
  const route = [{ x: 20, y: 40 }, { x: 120, y: 40 }];
  return {
    cursor,
    event: {
      type,
      source: "agent_001",
      scope: "local",
      region: "nirvana",
      target: null,
      timestamp,
      payload: {
        message: "Aster follows the east path.",
        agent_id: "agent_001",
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        travel_id: "journey-east",
        destination_id: "east-gate",
        route,
        started_at: 10,
        arrives_at: 20,
        position,
        spatial: {
          version: 1,
          region_id: "nirvana",
          map_id: "nirvana:test-layout",
          layout_fingerprint: "test-layout",
          ...position,
          observed_at: timestamp,
          at_landmark: traveling ? null : "east-gate",
          travel: traveling ? {
            id: "journey-east",
            destination_id: "east-gate",
            route,
            started_at: 10,
            arrives_at: 20,
          } : null,
        },
        ...(traveling ? {} : { reason: "stopped" }),
      },
    },
    resolved: { actor_id: "agent_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function expectReady(
  state: ReplaySessionState,
): Extract<ReplaySessionState, { status: "ready" }> {
  expect(state.status).toBe("ready");
  if (state.status !== "ready") {
    throw new Error(state.error?.message ?? "Expected replay session to be ready.");
  }
  return state;
}

function expectError(
  state: ReplaySessionState,
): Extract<ReplaySessionState, { status: "error" }> {
  expect(state.status).toBe("error");
  if (state.status !== "error") {
    throw new Error("Expected replay session restore to fail.");
  }
  expect(state.state).toBeNull();
  expect(state.metadata).toBeNull();
  return state;
}
