import { describe, expect, it } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import type { ReplayArtifacts } from "./replayArtifactClient";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import { createReplayState } from "./replayReducer";
import type { ReplayRestoreMetadata } from "./replayRestore";
import { createReplaySession, type ReplaySessionState } from "./replaySession";
import { adaptReplaySessionToRenderSnapshot } from "./replayRenderAdapter";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";

describe("adaptReplaySessionToRenderSnapshot", () => {
  it("returns null for idle, error, and ready sessions without a checkpoint snapshot", () => {
    const session = createReplaySession();

    expect(adaptReplaySessionToRenderSnapshot(session.getState())).toBeNull();

    const error = session.restore(makeArtifacts(), { index: 0 });
    expect(error.status).toBe("error");
    expect(adaptReplaySessionToRenderSnapshot(error)).toBeNull();

    expect(
      adaptReplaySessionToRenderSnapshot({
        status: "ready",
        state: createReplayState(),
        metadata: metadata(),
        error: null,
        selector: { index: 0 },
      }),
    ).toBeNull();
  });

  it("returns a cloned exact checkpoint snapshot with exact metadata", () => {
    const world = makeWorld({ event_cursor: 4, world_time: 12.5 });
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({
          checkpoints: [checkpointRecord(world, "manual", 20)],
        }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot).toEqual(world);
    expect(adapted.snapshot).not.toBe(world);
    expect(adapted.snapshot.agents).not.toBe(world.agents);
    expect(adapted.snapshot.agents[0]).not.toBe(world.agents[0]);
    expect(adapted.snapshot.regions[0].connections).not.toBe(
      world.regions[0].connections,
    );
    expect(adapted.snapshot.homes[0].stakeholders).not.toBe(
      world.homes[0].stakeholders,
    );
    expect(adapted.snapshot.pending_proposals[0].resources).not.toBe(
      world.pending_proposals[0].resources,
    );
    expect(adapted.metadata).toMatchObject({
      sourceIdentifier: "replay-session",
      selector: { index: 0 },
      checkpointIndex: 0,
      checkpointLineNumber: 20,
      checkpointCursor: 4,
      checkpointWorldTime: 12.5,
      checkpointReason: "manual",
      checkpointRunId: world.run_id,
      renderedCursor: 4,
      renderedWorldTime: 12.5,
      replayMode: "checkpoint",
      replayStatus: "exact",
      checkpointStateExact: true,
      finalStateExact: true,
      eventOverlayApplied: false,
      appliedEventCount: 0,
      appliedCursors: [],
      warningCount: 0,
      gapCount: 0,
      synthesizedHomeIds: [],
      unrenderedAgentIds: [],
      unrenderedHomeIds: [],
    });
    expect(adapted.metadata.selector).not.toBe(ready.selector);
  });

  it("carries the checkpoint's recorded high-water pressure, not live counts", () => {
    // The map a replay draws is a function of `region_pressure`: it reaches
    // `exactNirvanaPressure` -> `planNirvanaGrowth`. Absent that key the frontend
    // falls back to counting the beings and homes standing *right now*, which is
    // not monotone — so a checkpoint taken after a die-back would grow a smaller
    // Nirvana than the run actually showed. The clone must not drop it.
    const world = makeWorld({
      region_pressure: [
        { region: "grove", population_high_water: 9, built_footprint_high_water: 6 },
        { region: "meadow", population_high_water: 4, built_footprint_high_water: 3 },
      ],
      seed_persona: "the shared genesis words",
    });
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({ checkpoints: [checkpointRecord(world, "manual", 20)] }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot.region_pressure).toEqual(world.region_pressure);
    expect(adapted.snapshot.seed_persona).toBe("the shared genesis words");
    // Recorded high-water strictly exceeds the live counts in this fixture, so a
    // derived fallback could not produce these numbers by accident.
    const liveGrovePopulation = world.agents.filter(
      (agent) => agent.position === "grove" && agent.status !== "dead",
    ).length;
    expect(liveGrovePopulation).toBeLessThan(9);
    // Entries are copied, so overlay work can never write back into the checkpoint.
    expect(adapted.snapshot.region_pressure).not.toBe(world.region_pressure);
    expect(adapted.snapshot.region_pressure?.[0]).not.toBe(world.region_pressure?.[0]);
  });

  it("applies approximate movement, status, and home overlays to a cloned snapshot", () => {
    const checkpoint = makeWorld({ event_cursor: 4, world_time: 12.5 });
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_entered_region",
              { to_region: "grove" },
              { actor_id: "agent_001", region: "grove" },
              { source: "agent_001", region: "grove", timestamp: 13 },
            ),
            eventEntry(
              6,
              "agent_died",
              { victim_id: "agent_002" },
              { target_id: "agent_002", region: "grove" },
              { source: "agent_001", target: "agent_002", timestamp: 14 },
            ),
            eventEntry(
              7,
              "home_collapsed",
              { home_id: "home_001" },
              { home_id: "home_001", region: "meadow" },
              { source: "agent_001", region: "meadow", timestamp: 15 },
            ),
            eventEntry(
              8,
              "home_built",
              { home_id: "home_new", owner_id: "agent_001" },
              { actor_id: "agent_001", home_id: "home_new", region: "grove" },
              { source: "agent_001", region: "grove", timestamp: 16 },
            ),
            eventEntry(
              9,
              "home_started_hoarding",
              { home_id: "home_incomplete" },
              { home_id: "home_incomplete", region: "grove" },
              { source: "agent_001", region: "grove", timestamp: 17 },
            ),
          ],
          checkpoints: [checkpointRecord(checkpoint)],
        }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot).not.toBe(checkpoint);
    expect(adapted.snapshot.agents.find((agent) => agent.id === "agent_001"))
      .toMatchObject({
        position: "grove",
        home_id: "home_new",
      });
    expect(adapted.snapshot.agents.find((agent) => agent.id === "agent_002"))
      .toMatchObject({
        status: "dead",
        died_at: 14,
      });
    expect(adapted.snapshot.homes.map((home) => home.home_id)).toEqual([
      "home_new",
    ]);
    expect(adapted.snapshot.homes[0]).toMatchObject({
      home_id: "home_new",
      owner_id: "agent_001",
      region: "grove",
      stakeholders: ["agent_001"],
      status: "standing",
      is_hoarding: false,
    });
    expect(adapted.snapshot.ruins.map((home) => home.home_id)).toEqual([
      "home_001",
      "home_old",
    ]);
    expect(adapted.snapshot.ruins.find((home) => home.home_id === "home_001"))
      .toMatchObject({
        status: "ruin",
        ruined_at: 15,
      });
    expect(adapted.snapshot.event_cursor).toBe(9);
    expect(adapted.snapshot.world_time).toBe(17);
    expect(checkpoint.agents[0].position).toBe("meadow");
    expect(checkpoint.homes[0].status).toBe("standing");
    expect(adapted.metadata).toMatchObject({
      renderedCursor: 9,
      renderedWorldTime: 17,
      replayMode: "event-overlay",
      replayStatus: "approximate",
      checkpointStateExact: true,
      finalStateExact: false,
      eventOverlayApplied: true,
      appliedEventCount: 5,
      appliedCursors: [5, 6, 7, 8, 9],
      synthesizedHomeIds: ["home_new"],
      unrenderedAgentIds: [],
      unrenderedHomeIds: ["home_incomplete"],
    });
  });

  it("preserves gap and stale stop metadata", () => {
    const gap = expectAdapted(
      expectReady(
        createReplaySession().restore(
          makeArtifacts({
            events: [
              eventEntry(
                5,
                "agent_entered_region",
                { to_region: "grove" },
                { actor_id: "agent_001", region: "grove" },
                { source: "agent_001", region: "grove" },
              ),
              eventEntry(
                7,
                "agent_entered_region",
                { to_region: "meadow" },
                { actor_id: "agent_001", region: "meadow" },
                { source: "agent_001", region: "meadow" },
              ),
            ],
            checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
          }),
          { index: 0 },
        ),
      ),
    );
    expect(gap.metadata).toMatchObject({
      appliedEventCount: 1,
      renderedCursor: 5,
      stopReason: "gap",
      stoppedBeforeCursor: 7,
      nextExpectedCursor: 6,
      gapCount: 0,
    });

    const stale = expectAdapted(
      expectReady(
        createReplaySession().restore(
          makeArtifacts({
            events: [
              eventEntry(
                5,
                "agent_entered_region",
                { to_region: "grove" },
                { actor_id: "agent_001", region: "grove" },
                { source: "agent_001", region: "grove" },
              ),
              eventEntry(
                5,
                "agent_entered_region",
                { to_region: "meadow" },
                { actor_id: "agent_001", region: "meadow" },
                { source: "agent_001", region: "meadow" },
              ),
            ],
            checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
          }),
          { index: 0 },
        ),
      ),
    );
    expect(stale.metadata).toMatchObject({
      appliedEventCount: 1,
      renderedCursor: 5,
      stopReason: "stale",
      stoppedBeforeCursor: 5,
      nextExpectedCursor: 6,
    });
  });

  it("keeps repeated checkpoint cursor identity on index or line number selectors", () => {
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

    const byIndex = expectAdapted(expectReady(session.restore(artifacts, { index: 1 })));
    expect(byIndex.metadata).toMatchObject({
      selector: { index: 1 },
      checkpointIndex: 1,
      checkpointLineNumber: 101,
      checkpointCursor: 5,
      checkpointWorldTime: 21,
    });
    expect(byIndex.snapshot.agents.find((agent) => agent.id === "agent_001")?.position)
      .toBe("grove");

    const byLine = expectAdapted(
      expectReady(session.restore(artifacts, { lineNumber: 100 })),
    );
    expect(byLine.metadata).toMatchObject({
      selector: { lineNumber: 100 },
      checkpointIndex: 0,
      checkpointLineNumber: 100,
      checkpointCursor: 5,
      checkpointWorldTime: 20,
    });
    expect(byLine.snapshot.agents.find((agent) => agent.id === "agent_001")?.position)
      .toBe("meadow");
  });

  it("reports unknown overlay agents without synthesizing renderer agents", () => {
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_born",
              { child_id: "agent_new" },
              { actor_id: "agent_001", region: "grove" },
              { source: "agent_001", region: "grove", timestamp: 13 },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot.agents.map((agent) => agent.id)).not.toContain(
      "agent_new",
    );
    expect(adapted.metadata.unrenderedAgentIds).toEqual(["agent_new"]);
  });

  it("reports invalid overlay regions without moving existing entities off known regions", () => {
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "agent_entered_region",
              { to_region: "void" },
              { actor_id: "agent_001", region: "void" },
              { source: "agent_001", region: "void", timestamp: 13 },
            ),
            eventEntry(
              6,
              "home_colonized",
              { home_id: "home_001", owner_id: "agent_001" },
              { actor_id: "agent_001", home_id: "home_001", region: "void" },
              { source: "agent_001", region: "void", timestamp: 14 },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot.agents.find((agent) => agent.id === "agent_001"))
      .toMatchObject({
        position: "meadow",
      });
    expect(adapted.snapshot.homes.find((home) => home.home_id === "home_001"))
      .toMatchObject({
        region: "meadow",
        status: "standing",
      });
    expect(adapted.metadata.unrenderedAgentIds).toEqual(["agent_001"]);
    expect(adapted.metadata.unrenderedHomeIds).toEqual(["home_001"]);
  });

  it("reports unknown ids referenced only by home stakeholder overlays", () => {
    const ready = expectReady(
      createReplaySession().restore(
        makeArtifacts({
          events: [
            eventEntry(
              5,
              "home_colonized",
              {
                home_id: "home_001",
                owner_id: "agent_001",
                new_stakeholders: ["agent_001", "agent_shadow"],
              },
              { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
              { source: "agent_001", region: "meadow", timestamp: 13 },
            ),
          ],
          checkpoints: [checkpointRecord(makeWorld({ event_cursor: 4 }))],
        }),
        { index: 0 },
      ),
    );

    const adapted = expectAdapted(ready);

    expect(adapted.snapshot.homes.find((home) => home.home_id === "home_001"))
      .toMatchObject({
        stakeholders: ["agent_001", "agent_shadow"],
      });
    expect(adapted.metadata.unrenderedAgentIds).toEqual(["agent_shadow"]);
  });

  it("does not mutate a live WorldStore while adapting replay state", () => {
    const store = createWorldStore();
    const run = makeRun({ run_id: "live-run", event_cursor: 8 });
    const liveWorld = makeWorld({ run_id: "live-run", event_cursor: 8, world_time: 22 });
    const liveEntry = eventEntry(9);

    store.applyRun(run);
    store.applySnapshot(liveWorld);
    store.applyEventEnvelope(makeEventEnvelope({
      cursor: 8,
      next_cursor: 10,
      events: [liveEntry],
    }));
    const before = store.getState();

    const replayReady = expectReady(
      createReplaySession().restore(
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

    expectAdapted(replayReady);

    expect(store.getState()).toBe(before);
    expect(store.getState().snapshot).toBe(liveWorld);
    expect(store.getState().eventCursor).toBe(10);
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

function expectReady(
  state: ReplaySessionState,
): Extract<ReplaySessionState, { status: "ready" }> {
  expect(state.status).toBe("ready");
  if (state.status !== "ready") {
    throw new Error(state.error?.message ?? "Expected replay session to be ready.");
  }
  return state;
}

function expectAdapted(
  state: Extract<ReplaySessionState, { status: "ready" }>,
): NonNullable<ReturnType<typeof adaptReplaySessionToRenderSnapshot>> {
  const adapted = adaptReplaySessionToRenderSnapshot(state);
  expect(adapted).not.toBeNull();
  if (!adapted) {
    throw new Error("Expected replay render snapshot.");
  }
  return adapted;
}
