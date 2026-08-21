import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import {
  applyEventEntry,
  applyReplayEntries,
  applySnapshotCheckpoint,
  createReplayState,
  replayHasExactWorldState,
} from "./replayReducer";
import type { EventEnvelopeEntry, SerializedEvent } from "./schemas";

describe("replayReducer", () => {
  it("seeds exact replay state from a snapshot checkpoint", () => {
    const world = makeWorld({ event_cursor: 4, world_time: 12.5 });
    const state = createReplayState(world);

    expect(state.mode).toBe("checkpoint");
    expect(state.status).toBe("exact");
    expect(state.baseSnapshot).toBe(world);
    expect(state.latestSnapshot).toBe(world);
    expect(state.baseCursor).toBe(4);
    expect(state.latestCursor).toBe(4);
    expect(state.appliedCursors).toEqual([]);
    expect(replayHasExactWorldState(state)).toBe(true);
    expect(state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "meadow",
      source: "snapshot",
      exact: true,
    });
    expect(state.homesByAgentId.get("agent_001")?.homeId).toBe("home_001");
    expect(state.statusesByAgentId.get("agent_002")?.status).toBe("paralyzed");
    expect(state.homesById.get("home_old")).toMatchObject({
      status: "ruin",
      source: "snapshot",
      exact: true,
    });
  });

  it("layers event-derived movement over the latest exact snapshot", () => {
    const world = makeWorld({ event_cursor: 4 });
    const state = applyReplayEntries(createReplayState(world), [
      entry(
        5,
        "agent_left_region",
        {
          from_region: "meadow",
          to_region: "grove",
        },
        {
          actor_id: "agent_001",
          region: "meadow",
        },
        { source: "agent_001", region: "meadow", timestamp: 13 },
      ),
      entry(
        6,
        "agent_entered_region",
        {
          from_region: "meadow",
          to_region: "grove",
        },
        {
          actor_id: "agent_001",
          region: "grove",
        },
        { source: "agent_001", region: "grove", timestamp: 13.1 },
      ),
    ]);

    expect(state.mode).toBe("event-overlay");
    expect(state.status).toBe("approximate");
    expect(state.latestSnapshot).toBe(world);
    expect(state.latestCursor).toBe(6);
    expect(state.appliedCursors).toEqual([5, 6]);
    expect(replayHasExactWorldState(state)).toBe(false);
    expect(state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "grove",
      fromRegion: "meadow",
      toRegion: "grove",
      inTransit: false,
      source: "event",
      exact: false,
    });
    expect(state.warnings.map((warning) => warning.code)).toContain(
      "event_overlay_approximate",
    );
  });

  it("records cursor gaps instead of claiming exact seek support", () => {
    const state = applyEventEntry(
      createReplayState(makeWorld({ event_cursor: 4 })),
      entry(
        7,
        "agent_entered_region",
        { to_region: "grove" },
        { actor_id: "agent_001", region: "grove" },
        { source: "agent_001", region: "grove" },
      ),
    );

    expect(state.status).toBe("gap");
    expect(state.gaps).toEqual([
      {
        afterCursor: 4,
        beforeCursor: 7,
        missingCount: 2,
      },
    ]);
    expect(state.warnings.map((warning) => warning.code)).toContain("cursor_gap");
  });

  it("allows events without a checkpoint but labels them as approximate hints", () => {
    const state = applyEventEntry(
      createReplayState(),
      entry(
        12,
        "home_joined",
        {
          agent_id: "agent_002",
          home_id: "home_001",
        },
        {
          actor_id: "agent_002",
          home_id: "home_001",
          region: "meadow",
        },
        { source: "agent_002", region: "meadow" },
      ),
    );

    expect(state.mode).toBe("event-overlay");
    expect(state.status).toBe("approximate");
    expect(state.baseSnapshot).toBeNull();
    expect(state.latestSnapshot).toBeNull();
    expect(state.homesByAgentId.get("agent_002")).toMatchObject({
      homeId: "home_001",
      source: "event",
      exact: false,
    });
    expect(state.warnings.map((warning) => warning.code)).toContain(
      "events_without_checkpoint",
    );
  });

  it("uses event subjects instead of treating source as the actor for recovery", () => {
    const world = makeWorld({
      agents: makeWorld().agents.map((agent) => ({
        ...agent,
        status: "paralyzed",
      })),
    });
    const state = applyEventEntry(
      createReplayState(world),
      entry(
        5,
        "agent_recovered",
        {
          giver_id: "agent_001",
          revived_id: "agent_002",
          resource_type: "energy",
          amount: 8,
        },
        {
          actor_id: "agent_001",
          target_id: "agent_002",
          resource_type: "energy",
          amount: 8,
        },
        { source: "agent_001", target: "agent_002", region: "grove" },
      ),
    );

    expect(state.statusesByAgentId.get("agent_002")).toMatchObject({
      status: "alive",
      source: "event",
      exact: false,
    });
    expect(state.statusesByAgentId.get("agent_001")).toMatchObject({
      status: "paralyzed",
      source: "snapshot",
      exact: true,
    });
  });

  it("uses structured home ids for collapse events rather than source", () => {
    const state = applyEventEntry(
      createReplayState(makeWorld({ event_cursor: 4 })),
      entry(
        5,
        "home_collapsed",
        {
          home_id: "home_001",
        },
        {
          home_id: "home_001",
          region: "meadow",
        },
        { source: "agent_001", region: "meadow" },
      ),
    );

    expect(state.homesById.get("home_001")).toMatchObject({
      status: "ruin",
      source: "event",
      exact: false,
    });
    expect(state.homesById.has("agent_001")).toBe(false);
  });

  it("warns when an event references an unloaded snapshot checkpoint", () => {
    const state = applyEventEntry(
      createReplayState(makeWorld({ event_cursor: 4 })),
      {
        ...entry(
          5,
          "speak",
          { message: "Across the meadow." },
          { actor_id: "agent_001", region: "meadow" },
          { source: "agent_001", region: "meadow" },
        ),
        snapshot_after: "snapshots/000005.json",
      },
    );

    expect(state.warnings.map((warning) => warning.code)).toContain(
      "snapshot_after_unloaded",
    );
    expect(state.latestSnapshot?.event_cursor).toBe(4);
    expect(state.status).toBe("approximate");
  });

  it("replaces approximate event overlays when a checkpoint is applied", () => {
    const approximate = applyEventEntry(
      createReplayState(makeWorld({ event_cursor: 4 })),
      entry(
        5,
        "agent_entered_region",
        { to_region: "grove" },
        { actor_id: "agent_001", region: "grove" },
        { source: "agent_001", region: "grove" },
      ),
    );
    const checkpoint = makeWorld({
      event_cursor: 5,
      agents: makeWorld().agents.map((agent) =>
        agent.id === "agent_001" ? { ...agent, position: "grove" } : agent,
      ),
    });

    const state = applySnapshotCheckpoint(approximate, checkpoint);

    expect(state.status).toBe("exact");
    expect(state.appliedCursors).toEqual([]);
    expect(state.warnings).toEqual([]);
    expect(state.positionsByAgentId.get("agent_001")).toMatchObject({
      region: "grove",
      source: "snapshot",
      exact: true,
    });
    expect(replayHasExactWorldState(state)).toBe(true);
  });
});

function entry(
  cursor: number,
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
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
      timestamp: overrides.timestamp ?? 12.25,
    },
    resolved,
    snapshot_after: null,
  };
}
