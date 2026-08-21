import { describe, expect, it } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import { createWorldStore } from "./store";

describe("WorldStore", () => {
  it("classifies runs and atomically clears compatibility state on replacement", () => {
    const store = createWorldStore();

    expect(store.applyRun(makeRun({ run_id: "run-a", event_cursor: 40 }))).toBe("initial");
    store.applySnapshot(makeWorld({ run_id: "run-a", event_cursor: 42 }));
    store.applyEventEnvelope(makeEventEnvelope({ cursor: 42, next_cursor: 45 }));

    expect(store.applyRun(makeRun({ run_id: "run-a", event_cursor: 46 }))).toBe("same-run");
    expect(store.getState().snapshot).not.toBeNull();
    expect(store.applyRun(makeRun({ run_id: "run-b", event_cursor: 2 }))).toBe("replacement");
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 2,
      eventBeats: [],
      chronicleHistory: [],
      needsSnapshot: false,
    });
    expect(store.getState().agentsById.size).toBe(0);
  });

  it("rejects snapshots from a stale run generation", () => {
    const store = createWorldStore();
    store.applyRun(makeRun({ run_id: "run-a", event_cursor: 8 }));
    store.applySnapshot(makeWorld({ run_id: "run-a", event_cursor: 8 }));
    store.applyRun(makeRun({ run_id: "run-b", event_cursor: 2 }));

    expect(store.applySnapshot(makeWorld({ run_id: "run-a", event_cursor: 99 }))).toBe(false);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 2,
    });
  });

  it("indexes snapshots by id and resets snapshot-required state", () => {
    const store = createWorldStore();
    store.applyEventEnvelope(makeEventEnvelope({ snapshot_required: true }));
    expect(store.getState().needsSnapshot).toBe(true);

    const world = makeWorld({ event_cursor: 5 });
    expect(store.applySnapshot(world)).toBe(true);
    const state = store.getState();

    expect(state.snapshot).toEqual(world);
    expect(state.eventCursor).toBe(world.event_cursor);
    expect(state.needsSnapshot).toBe(false);
    expect(state.agentsById.get("agent_001")?.name).toBe("Aster");
    expect(state.regionsByName.get("grove")?.current_materials).toBe(55);
    expect(state.homesById.get("home_001")?.status).toBe("standing");
    expect(state.ruinsById.get("home_old")?.status).toBe("ruin");
    expect(state.pendingProposalCount).toBe(1);
  });

  it("keeps the highest cursor from run metadata and event envelopes", () => {
    const store = createWorldStore();

    store.applyRun(makeRun({ event_cursor: 9 }));
    store.applyEventEnvelope(makeEventEnvelope({ next_cursor: 5 }));

    expect(store.getState().eventCursor).toBe(9);
    expect(store.getState().eventBeats).toHaveLength(1);
    expect(store.getState().chronicleHistory).toHaveLength(1);
  });

  it("rejects snapshots older than run metadata even before a world view exists", () => {
    const store = createWorldStore();

    store.applyRun(makeRun({ event_cursor: 9 }));
    const applied = store.applySnapshot(makeWorld({ event_cursor: 8, world_time: 12 }));

    expect(applied).toBe(false);
    expect(store.getState().eventCursor).toBe(9);
    expect(store.getState().snapshot).toBeNull();
  });

  it("marks overflow envelopes as requiring a fresh snapshot", () => {
    const store = createWorldStore();

    store.applySnapshot(makeWorld({ event_cursor: 4 }));
    store.applyEventEnvelope(
      makeEventEnvelope({
        overflow: true,
        snapshot_required: false,
        next_cursor: 12,
      }),
    );

    expect(store.getState().eventCursor).toBe(12);
    expect(store.getState().needsSnapshot).toBe(true);
    expect(store.getState().chronicleHistory[0]).toMatchObject({
      kind: "gap",
      reason: "overflow",
      afterCursor: 4,
      nextCursor: 12,
    });
  });

  it("ignores stale snapshots once a newer cursor is already accepted", () => {
    const store = createWorldStore();
    store.applySnapshot(makeWorld({ event_cursor: 10, world_time: 30 }));

    const applied = store.applySnapshot(makeWorld({ event_cursor: 8, world_time: 12 }));

    expect(applied).toBe(false);
    expect(store.getState().eventCursor).toBe(10);
    expect(store.getState().snapshot?.world_time).toBe(30);
  });

  it("caps retained event beats for animation consumers", () => {
    const store = createWorldStore();

    for (let cursor = 1; cursor <= 90; cursor += 1) {
      store.applyEventEnvelope(
        makeEventEnvelope({
          cursor: cursor - 1,
          next_cursor: cursor,
          events: [
            {
              ...makeEventEnvelope().events[0],
              cursor,
            },
          ],
        }),
      );
    }

    const beats = store.getState().eventBeats;
    expect(beats).toHaveLength(80);
    expect(beats[0].cursor).toBe(11);
    expect(beats.at(-1)?.cursor).toBe(90);
    expect(store.getState().chronicleHistory).toHaveLength(90);
    expect(store.getState().chronicleHistory[0]).toMatchObject({
      kind: "event",
      entry: expect.objectContaining({ cursor: 1 }),
    });
  });

  it("adds snapshot-required gaps without duplicating replayed envelopes", () => {
    const store = createWorldStore();
    const envelope = makeEventEnvelope({
      cursor: 12,
      oldest_cursor: 8,
      next_cursor: 14,
      snapshot_required: true,
      events: [
        {
          ...makeEventEnvelope().events[0],
          cursor: 14,
        },
      ],
    });

    store.applyEventEnvelope(envelope);
    store.applyEventEnvelope(envelope);

    const history = store.getState().chronicleHistory;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      kind: "gap",
      reason: "snapshot_required",
      afterCursor: 12,
      beforeCursor: 8,
      nextCursor: 14,
    });
    expect(history[1]).toMatchObject({
      kind: "event",
      entry: expect.objectContaining({ cursor: 14 }),
    });
  });
});
