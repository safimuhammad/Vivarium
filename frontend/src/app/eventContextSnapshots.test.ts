import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import { eventPresentationContextFromSnapshots } from "./eventPresentation";
import { rememberEventContextFallbackSnapshot } from "./eventContextSnapshots";
import type { AgentSnapshot } from "./schemas";

describe("rememberEventContextFallbackSnapshot", () => {
  it("retains previous same-cursor snapshots so silent removals keep label fallbacks", () => {
    const initial = makeWorld();
    const sameCursorWithoutAster = {
      ...initial,
      agents: initial.agents.filter((agent) => agent.id !== "agent_001"),
    };

    const fallbacks = rememberEventContextFallbackSnapshot(
      [initial],
      sameCursorWithoutAster,
    );
    const context = eventPresentationContextFromSnapshots(
      sameCursorWithoutAster,
      fallbacks,
    );

    expect(fallbacks[0]).toBe(sameCursorWithoutAster);
    expect(fallbacks[1]).toBe(initial);
    expect((context.agentsById as ReadonlyMap<string, AgentSnapshot>).get("agent_001")?.name)
      .toBe("Aster");
  });

  it("dedupes repeated snapshot references while keeping the cache bounded", () => {
    const snapshots = Array.from({ length: 6 }, (_, index) => ({
      ...makeWorld(),
      event_cursor: index,
    }));

    const retained = snapshots.reduce(
      (previous, snapshot) => rememberEventContextFallbackSnapshot(previous, snapshot),
      [] as typeof snapshots,
    );
    const repeated = rememberEventContextFallbackSnapshot(retained, snapshots[5]);

    expect(retained).toHaveLength(4);
    expect(retained.map((snapshot) => snapshot.event_cursor)).toEqual([5, 4, 3, 2]);
    expect(repeated.map((snapshot) => snapshot.event_cursor)).toEqual([5, 4, 3, 2]);
  });
});
