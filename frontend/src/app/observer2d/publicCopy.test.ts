import { describe, expect, it, vi } from "vitest";

import type { PresentedObserverFrame } from "../../presentation/contracts";
import type { StoryMoment } from "../../presentation/BeatDirector";
import {
  frameEntityIdDenylist,
  momentEntityIdDenylist,
  safePublicCopy,
  safePublicEntityName,
} from "./publicCopy";

describe("public observer copy", () => {
  it("does only plain-partition matching for safe plain names without weakening mixed-case ID rejection", () => {
    const underscoredIds = Array.from(
      { length: 384 },
      (_, index) => `private_sigil_${index}`,
    );
    const deniedIds = frameEntityIdDenylist(frameWithAgentIds([
      ...underscoredIds,
      "secret",
    ]));
    const originalIncludes = String.prototype.includes;
    const includes = vi.spyOn(String.prototype, "includes").mockImplementation(function (
      this: string,
      searchString: string,
      position?: number,
    ): boolean {
      return originalIncludes.call(this, searchString, position);
    });

    try {
      expect(safePublicEntityName(deniedIds, "Willow")).toBe("Willow");
      expect(includes).toHaveBeenCalledTimes(2);
      includes.mockClear();
      expect(safePublicEntityName(deniedIds, "PRIVATE_SIGIL_127")).toBe("Unknown being");
      expect(includes).toHaveBeenCalledWith("_");
      expect(safePublicEntityName(deniedIds, "topsecret")).toBe("Unknown being");
      expect(safePublicEntityName(deniedIds, "SECRET")).toBe("SECRET");
    } finally {
      includes.mockRestore();
    }
  });

  it("returns a frozen native Set whose compiled privacy decision cannot be shadowed", () => {
    const deniedIds = frameEntityIdDenylist(frameWithAgentIds(["private_sigil_7"]));

    expect(deniedIds).toBeInstanceOf(Set);
    expect(Object.prototype.toString.call(deniedIds)).toBe("[object Set]");
    expect(Object.isFrozen(deniedIds)).toBe(true);
    expect(() => Object.defineProperty(deniedIds, "containsValue", {
      value: () => false,
    })).toThrow();
    expect(() => (deniedIds as Set<string>).delete("private_sigil_7")).toThrow();
    expect(Set.prototype.delete.call(deniedIds, "private_sigil_7")).toBe(true);
    expect(deniedIds.has("private_sigil_7")).toBe(false);

    const iterator = vi.spyOn(Set.prototype, Symbol.iterator).mockImplementation(function* (): SetIterator<unknown> {
      return;
    });
    try {
      expect(safePublicEntityName(deniedIds, "PRIVATE_SIGIL_7")).toBe("Unknown being");
    } finally {
      iterator.mockRestore();
    }
  });

  it("does not let an external native Set spoof the factory-owned compiled fast path", () => {
    const deniedIds = frameEntityIdDenylist(frameWithAgentIds(["factory_sigil"]));
    const ExternalSet = deniedIds.constructor as SetConstructor;
    const externalIds = new ExternalSet<string>(["external_sigil"]);

    expect(safePublicEntityName(externalIds, "EXTERNAL_SIGIL")).toBe("Unknown being");
    externalIds.delete("external_sigil");
    externalIds.add("replacement_sigil");
    expect(safePublicEntityName(externalIds, "EXTERNAL_SIGIL")).toBe("EXTERNAL_SIGIL");
    expect(safePublicEntityName(externalIds, "REPLACEMENT_SIGIL")).toBe("Unknown being");
  });

  it("reads caller-owned custom ReadonlySet values live without compiling them", () => {
    const backing = new Set<string>();
    const customIds = readonlySetView(backing);

    expect(safePublicEntityName(customIds, "WILLOW_SIGIL")).toBe("WILLOW_SIGIL");
    backing.add("willow_sigil");
    expect(safePublicEntityName(customIds, "WILLOW_SIGIL")).toBe("Unknown being");
    backing.delete("willow_sigil");
    expect(safePublicEntityName(customIds, "WILLOW_SIGIL")).toBe("WILLOW_SIGIL");
  });

  it("does not retain a stale partition for caller-owned mutable sets", () => {
    const deniedIds = new Set<string>();

    expect(safePublicEntityName(deniedIds, "Willow")).toBe("Willow");
    deniedIds.add("Willow");
    expect(safePublicEntityName(deniedIds, "Willow")).toBe("Unknown being");
    deniedIds.delete("Willow");
    expect(safePublicEntityName(deniedIds, "Willow")).toBe("Willow");
  });

  it("preserves trimming and the sensitive and legacy-copy fallbacks", () => {
    expect(safePublicCopy("  Willow  ", "Fallback")).toBe("Willow");
    expect(safePublicCopy("provider latency", "Fallback")).toBe("Fallback");
    expect(safePublicCopy("known agent_old_9", "Fallback")).toBe("Fallback");
  });

  it("collects resolved homes and every non-suffix home-event entity location", () => {
    const frame = frameWithAgentIds([]);
    const moment = momentWithEntry({
      source: "source-being",
      target: "target-being",
      resolved: {
        actor_id: "resolved-actor",
        target_id: "resolved-target",
        home_id: "resolved-sanctum",
      },
      payload: {
        home_id: "payload-home",
        target_home: "target-sanctum",
        child_id: "payload-child",
        parent_ids: ["payload-parent-a", "payload-parent-b"],
        stakeholders: ["stakeholder-a"],
        breachers: ["breacher-a"],
        recipients: ["recipient-a"],
        previous_stakeholders: ["previous-a"],
        new_stakeholders: ["new-a"],
        loot_shares: {
          "loot-recipient-a": 7,
          "loot-recipient-b": 5,
        },
      },
    });

    expect([...momentEntityIdDenylist(frame, moment)]).toEqual([
      "source-being",
      "target-being",
      "resolved-actor",
      "resolved-target",
      "resolved-sanctum",
      "payload-home",
      "target-sanctum",
      "payload-child",
      "payload-parent-a",
      "payload-parent-b",
      "stakeholder-a",
      "breacher-a",
      "recipient-a",
      "previous-a",
      "new-a",
      "loot-recipient-a",
      "loot-recipient-b",
    ]);
  });
});

function momentWithEntry(input: {
  readonly source: string;
  readonly target: string;
  readonly resolved: StoryMoment["representative"]["resolved"];
  readonly payload: Readonly<Record<string, unknown>>;
}): StoryMoment {
  const entry: StoryMoment["representative"] = {
    cursor: 4,
    event: {
      type: "home_thieved",
      source: input.source,
      target: input.target,
      payload: { ...input.payload },
      scope: "local",
      region: "meadow",
      timestamp: 42,
    },
    resolved: { ...input.resolved },
    snapshot_after: null,
  };
  return {
    id: "4:4:single",
    firstCursor: 4,
    lastCursor: 4,
    evidenceCursors: [4],
    evidence: [entry],
    representative: entry,
    chainKind: "single",
    priority: "drama",
    focus: { kind: "home", id: "resolved-sanctum" },
  };
}

function readonlySetView(backing: ReadonlySet<string>): ReadonlySet<string> {
  let view: ReadonlySet<string>;
  view = {
    get size(): number { return backing.size; },
    has: (value) => backing.has(value),
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing[Symbol.iterator](),
    forEach(callbackfn, thisArg): void {
      for (const value of backing) callbackfn.call(thisArg, value, value, view);
    },
  };
  return view;
}

function frameWithAgentIds(ids: readonly string[]): PresentedObserverFrame {
  return {
    runId: "shown-run",
    sourceKey: "live:shown-run",
    revision: 3,
    firstCursor: 0,
    lastCursor: 9,
    source: "live",
    ingestedCursor: 12,
    presentedCursor: 9,
    world: {
      exactBaseCursor: 9,
      projectedThroughCursor: 9,
      worldTime: 42,
      agents: ids.map((id, index) => ({
        completeness: "exact" as const,
        value: { id, name: `Being ${index}`, status: "alive", position: "nirvana" },
      })),
      regions: [],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: "live", ingestedCursor: 12, retryable: false },
  };
}
