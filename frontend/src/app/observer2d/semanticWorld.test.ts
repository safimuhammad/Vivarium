import { describe, expect, it, vi } from "vitest";

import type { PresentedObserverFrame } from "../../presentation/contracts";
import type { RendererSemanticSnapshot } from "../../renderer2d/production/semantics";
import {
  createSemanticWorldStore,
  SemanticSubjectTokenRegistry,
  projectSemanticWorld,
} from "./semanticWorld";

describe("semantic world public boundary", () => {
  it("rejects a semantic snapshot unless the complete accepted frame identity matches", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const stale = semanticSnapshot({ frameIdentity: {
      ...semanticSnapshot().frameIdentity,
      revision: frame.revision - 1,
    } });
    const foreign = semanticSnapshot({ frameIdentity: {
      ...semanticSnapshot().frameIdentity,
      sourceKey: "archive:foreign",
    } });

    expect(projectSemanticWorld(frame, stale, registry, "nirvana")).toBeNull();
    expect(projectSemanticWorld(frame, foreign, registry, "nirvana")).toBeNull();
    expect(registry.size).toBe(0);
  });

  it("rejects non-canonical subject order without mutating retained opaque tokens", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const first = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana")!;
    const home = first.subjects.find((subject) => subject.kind === "home")!;
    const beforeSelection = registry.selectionFor(home.token);
    const canonical = semanticSnapshot().subjects;
    const unsorted = semanticSnapshot({ subjects: [
      canonical[1]!,
      canonical[0]!,
      {
        selection: { kind: "agent", id: "new-private-agent" },
        stableSelectionKey: "stable-new-agent",
        kind: "agent",
        regionId: "nirvana",
        position: { x: 0, y: 0 },
        status: "alive",
        action: null,
      },
    ] });

    expect(projectSemanticWorld(frame, unsorted, registry, "nirvana", first)).toBeNull();
    expect(registry.size).toBe(4);
    expect(registry.selectionFor(home.token)).toEqual(beforeSelection);

    const stableKeyUnsorted = semanticSnapshot({ subjects: [
      canonical[0]!,
      { ...canonical[1]!, stableSelectionKey: "stable-z" },
      {
        selection: { kind: "agent", id: "new-private-agent" },
        stableSelectionKey: "stable-a",
        kind: "agent",
        regionId: "nirvana",
        position: { x: 0, y: 0 },
        status: "alive",
        action: null,
      },
    ] });
    expect(projectSemanticWorld(
      frame,
      stableKeyUnsorted,
      registry,
      "nirvana",
      first,
    )).toBeNull();
    expect(registry.size).toBe(4);
    expect(registry.selectionFor(home.token)).toEqual(beforeSelection);
  });

  it("projects stable region-agent-home-ruin public copy without raw identities or invented idle", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const view = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana");

    expect(view?.subjects.map((subject) => subject.kind)).toEqual([
      "region", "agent", "home", "ruin",
    ]);
    expect(view?.subjects.map((subject) => subject.name)).toEqual([
      "Nirvana", "Aster", "Aster's home", "Aster's former home",
    ]);
    expect(view?.subjects[1]).toMatchObject({
      status: "Alive",
      position: "Nirvana, column 2, row 3",
      currentAction: "Moving",
      selected: true,
      canFollow: true,
    });
    expect(view?.subjects[2]).toMatchObject({ status: "Standing", canFollow: true });
    expect(view?.subjects[3]?.status).toContain("Ruin");
    expect(view?.subjects[3]?.status).toContain("12 world time old");
    expect(view?.subjects[3]?.currentAction).toBe("No active action");
    expect(JSON.stringify(view)).not.toMatch(
      /agent_raw_17|home_raw_4|ruin_raw_8|nirvana-internal|stable-|\bidle\b/i,
    );
    expect(view?.subjects.every((subject) => /^subject-\d+$/.test(subject.token))).toBe(true);
  });

  it("retains opaque tokens through updates, does not reorder on position, and resolves callbacks privately", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const first = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana")!;
    const moving = semanticSnapshot({
      subjects: semanticSnapshot().subjects.map((subject) => subject.kind === "agent"
        ? { ...subject, position: { x: 159, y: 33 }, action: "speaking" }
        : subject),
    });
    const second = projectSemanticWorld(frame, moving, registry, "nirvana")!;

    expect(second.subjects.map((subject) => subject.token))
      .toEqual(first.subjects.map((subject) => subject.token));
    expect(second.subjects.map((subject) => subject.kind))
      .toEqual(["region", "agent", "home", "ruin"]);
    expect(second.subjects[1]).toMatchObject({
      position: "Nirvana, column 4, row 1",
      currentAction: "Speaking",
    });
    expect(registry.selectionFor(first.subjects[1]!.token))
      .toEqual({ kind: "agent", id: "agent_raw_17" });
  });

  it("builds public-name projection indexes once for a complete semantic snapshot", () => {
    const count = 24;
    let nameReads = 0;
    const frame: PresentedObserverFrame = {
      ...presentedFrame(),
      selection: null,
      world: {
        ...presentedFrame().world,
        agents: Array.from({ length: count }, (_, index) => ({
          completeness: "exact" as const,
          value: {
            id: `being-${index}`,
            get name(): string {
              nameReads += 1;
              return `Being ${index}`;
            },
            status: "alive",
            position: "nirvana",
          },
        })),
        homes: [],
        ruins: [],
      },
    };
    const snapshot = semanticSnapshot({
      subjects: Array.from({ length: count }, (_, index) => ({
        selection: { kind: "agent" as const, id: `being-${index}` },
        stableSelectionKey: `stable-${index.toString().padStart(2, "0")}`,
        kind: "agent" as const,
        regionId: "nirvana",
        position: { x: index * 32, y: 0 },
        status: "alive",
        action: null,
      })),
    });

    const view = projectSemanticWorld(
      frame,
      snapshot,
      new SemanticSubjectTokenRegistry(),
      null,
    );

    expect(view?.subjects).toHaveLength(count);
    expect(nameReads).toBe(count);
  });

  it("structurally shares every unchanged public subject across an exact identity advance", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const first = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana")!;
    const nextFrame: PresentedObserverFrame = {
      ...frame,
      revision: frame.revision + 1,
      lastCursor: frame.lastCursor + 1,
      presentedCursor: frame.presentedCursor + 1,
    };
    const nextSnapshot = semanticSnapshot({ frameIdentity: {
      ...semanticSnapshot().frameIdentity,
      revision: nextFrame.revision,
      lastCursor: nextFrame.lastCursor,
    } });

    const second = projectSemanticWorld(
      nextFrame,
      nextSnapshot,
      registry,
      "nirvana",
      first,
    )!;

    expect(second.frameIdentity).toEqual(nextSnapshot.frameIdentity);
    expect(second.subjects).toBe(first.subjects);
    expect(second.subjects.every((subject, index) => subject === first.subjects[index])).toBe(true);
  });

  it("replaces only the public subject whose projection changes", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const first = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana")!;
    const moving = semanticSnapshot({
      subjects: semanticSnapshot().subjects.map((subject) => subject.kind === "agent"
        ? { ...subject, position: { x: 159, y: 33 }, action: "speaking" }
        : subject),
    });

    const second = projectSemanticWorld(frame, moving, registry, "nirvana", first)!;

    expect(second.subjects).not.toBe(first.subjects);
    expect(second.subjects.map((subject, index) => subject === first.subjects[index]))
      .toEqual([true, false, true, true]);
  });

  it("updates exact frame ownership without notifying semantic subscribers when public rows are shared", () => {
    const frame = presentedFrame();
    const registry = new SemanticSubjectTokenRegistry();
    const first = projectSemanticWorld(frame, semanticSnapshot(), registry, "nirvana")!;
    const nextFrame: PresentedObserverFrame = {
      ...frame,
      revision: frame.revision + 1,
      lastCursor: frame.lastCursor + 1,
      presentedCursor: frame.presentedCursor + 1,
    };
    const nextSnapshot = semanticSnapshot({ frameIdentity: {
      ...semanticSnapshot().frameIdentity,
      revision: nextFrame.revision,
      lastCursor: nextFrame.lastCursor,
    } });
    const second = projectSemanticWorld(
      nextFrame,
      nextSnapshot,
      registry,
      "nirvana",
      first,
    )!;
    const store = createSemanticWorldStore();
    const subscriber = vi.fn();
    store.subscribe(subscriber);

    store.publish(first);
    store.publish(second);

    expect(store.getCurrent()).toBe(second);
    expect(store.getSnapshot()).toBe(first);
    expect(subscriber).toHaveBeenCalledOnce();
  });

  it("bounds hostile renderer status/action strings to neutral public copy", () => {
    const frame = presentedFrame();
    const snapshot = semanticSnapshot({
      subjects: semanticSnapshot().subjects.map((subject) => subject.kind === "agent"
        ? { ...subject, status: "agent_raw_17", action: "provider_prompt_token" }
        : subject),
    });
    const view = projectSemanticWorld(
      frame,
      snapshot,
      new SemanticSubjectTokenRegistry(),
      null,
    );
    expect(view?.subjects.find((subject) => subject.kind === "agent")).toMatchObject({
      status: "Status awaiting checkpoint",
      currentAction: "No active action",
    });
    expect(JSON.stringify(view)).not.toMatch(/agent_raw_17|provider_prompt_token/);
  });

  it("denies arbitrary frame entity IDs from semantic subject names", () => {
    const frame = presentedFrame();
    const hostile: PresentedObserverFrame = {
      ...frame,
      world: {
        ...frame.world,
        agents: [{ completeness: "exact", value: {
          id: "mystic_007",
          name: "Guide mystic_007",
          status: "alive",
          position: "nirvana",
        } }],
        homes: [{ completeness: "exact", value: {
          home_id: "shelter_4",
          owner_id: "mystic_007",
          region: "nirvana",
          status: "standing",
        } }],
        ruins: [],
      },
      selection: { kind: "agent", id: "mystic_007" },
    };
    const snapshot = semanticSnapshot({
      subjects: [
        { selection: { kind: "agent", id: "mystic_007" }, stableSelectionKey: "stable-a", kind: "agent", regionId: "nirvana", position: { x: 64, y: 96 }, status: "alive", action: "moving" },
        { selection: { kind: "home", id: "shelter_4" }, stableSelectionKey: "stable-h", kind: "home", regionId: "nirvana", position: { x: 128, y: 64 }, status: "standing", action: "building" },
      ],
    });

    const view = projectSemanticWorld(
      hostile,
      snapshot,
      new SemanticSubjectTokenRegistry(),
      null,
    );

    expect(view?.subjects.map((subject) => subject.name))
      .toEqual(["Unknown being", "Unknown being's home"]);
    expect(view?.subjects.map((subject) => subject.name).join(" ")).not.toContain("mystic_007");
  });

  it("preserves first-record ownership and ruin-age semantics while indexing duplicate IDs", () => {
    const base = presentedFrame();
    const frame: PresentedObserverFrame = {
      ...base,
      world: {
        ...base.world,
        homes: [
          { completeness: "projected-partial", value: { home_id: "home_raw_4" } },
          { completeness: "exact", value: {
            home_id: "home_raw_4",
            owner_id: "agent_raw_17",
          } },
        ],
        ruins: [
          { completeness: "exact", value: { home_id: "ruin_raw_8", ruined_at: null } },
          { completeness: "exact", value: {
            home_id: "ruin_raw_8",
            owner_id: "agent_raw_17",
            ruined_at: 30,
          } },
        ],
      },
    };

    const view = projectSemanticWorld(
      frame,
      semanticSnapshot(),
      new SemanticSubjectTokenRegistry(),
      null,
    )!;

    expect(view.subjects.find((subject) => subject.kind === "home")).toMatchObject({
      name: "Unknown being's home",
      status: "Status awaiting checkpoint",
    });
    expect(view.subjects.find((subject) => subject.kind === "ruin")).toMatchObject({
      name: "Unknown being's former home",
      status: "Ruin",
    });
  });

  it("uses the first duplicate agent name for the being and its owned home and ruin", () => {
    const base = presentedFrame();
    const frame: PresentedObserverFrame = {
      ...base,
      world: {
        ...base.world,
        agents: [
          { completeness: "exact", value: {
            id: "agent_raw_17",
            name: "First Aster",
            status: "alive",
            position: "nirvana",
          } },
          { completeness: "exact", value: {
            id: "agent_raw_17",
            name: "Second Aster",
            status: "alive",
            position: "nirvana",
          } },
        ],
      },
    };

    const view = projectSemanticWorld(
      frame,
      semanticSnapshot(),
      new SemanticSubjectTokenRegistry(),
      null,
    )!;

    expect(view.subjects.map((subject) => subject.name)).toEqual([
      "Nirvana",
      "First Aster",
      "First Aster's home",
      "First Aster's former home",
    ]);
  });
});

function semanticSnapshot(
  overrides: Partial<RendererSemanticSnapshot> = {},
): RendererSemanticSnapshot {
  return {
    frameIdentity: {
      runId: "shown-run",
      sourceKey: "live:shown-run",
      revision: 3,
      firstCursor: 0,
      lastCursor: 9,
    },
    subjects: [
      { selection: { kind: "region", id: "nirvana-internal" }, stableSelectionKey: "stable-1", kind: "region", regionId: "nirvana", position: null, status: "exact", action: null },
      { selection: { kind: "agent", id: "agent_raw_17" }, stableSelectionKey: "stable-2", kind: "agent", regionId: "nirvana", position: { x: 64, y: 96 }, status: "alive", action: "moving" },
      { selection: { kind: "home", id: "home_raw_4" }, stableSelectionKey: "stable-3", kind: "home", regionId: "nirvana", position: { x: 128, y: 64 }, status: "standing", action: "building" },
      { selection: { kind: "ruin", id: "ruin_raw_8" }, stableSelectionKey: "stable-4", kind: "ruin", regionId: "nirvana", position: { x: 160, y: 96 }, status: "ruin", action: null },
    ],
    ...overrides,
  };
}

function presentedFrame(): PresentedObserverFrame {
  return {
    runId: "shown-run", sourceKey: "live:shown-run", revision: 3,
    firstCursor: 0, lastCursor: 9, source: "live", ingestedCursor: 12, presentedCursor: 9,
    world: {
      exactBaseCursor: 9, projectedThroughCursor: 9, worldTime: 42,
      agents: [{ completeness: "exact", value: { id: "agent_raw_17", name: "Aster", status: "alive", position: "nirvana" } }],
      regions: [{ completeness: "exact", value: { name: "nirvana", description: "A quiet plain", connections: [] } }],
      homes: [{ completeness: "exact", value: { home_id: "home_raw_4", owner_id: "agent_raw_17", region: "nirvana", status: "standing" } }],
      ruins: [{ completeness: "exact", value: { home_id: "ruin_raw_8", owner_id: "agent_raw_17", region: "nirvana", status: "ruin", ruined_at: 30 } }],
      pendingProposals: [],
    },
    scene: null,
    selection: { kind: "agent", id: "agent_raw_17" },
    backlog: { pendingMoments: 0, firstPendingCursor: null, lastPendingCursor: null, state: "caught-up", label: "Caught up" },
    transport: { connection: "live", ingestedCursor: 12, retryable: false },
  };
}
