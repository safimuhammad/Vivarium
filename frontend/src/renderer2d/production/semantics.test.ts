import { describe, expect, it, vi } from "vitest";

import type { FrameIdentity } from "../../presentation/contracts";
import {
  createRendererSemanticPublisher,
  createRendererSemanticSnapshot,
  type RendererSemanticSubject,
} from "./semantics";

const identity: FrameIdentity = {
  runId: "run-one",
  sourceKey: "live:run-one",
  revision: 7,
  firstCursor: 4,
  lastCursor: 7,
};

function subject(
  kind: RendererSemanticSubject["kind"],
  id: string,
  overrides: Partial<RendererSemanticSubject> = {},
): RendererSemanticSubject {
  return {
    selection: { kind, id },
    stableSelectionKey: `${kind}:${id}`,
    kind,
    regionId: "worn",
    position: { x: 31, y: 63 },
    status: "alive",
    action: null,
    ...overrides,
  } as RendererSemanticSubject;
}

describe("production renderer semantics", () => {
  it("orders graph-visible subjects by bounded kind then private stable key", () => {
    const snapshot = createRendererSemanticSnapshot(identity, [
      subject("home", "z"),
      subject("agent", "z"),
      subject("ruin", "a"),
      subject("region", "z", { position: null }),
      subject("agent", "a"),
    ]);

    expect(snapshot.subjects.map(({ stableSelectionKey }) => stableSelectionKey)).toEqual([
      "region:z", "agent:a", "agent:z", "home:z", "ruin:a",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.subjects)).toBe(true);
  });

  it("publishes membership/status/action/tile changes without camera or sub-tile spam", () => {
    const onSnapshot = vi.fn();
    let now = 0;
    const publisher = createRendererSemanticPublisher({
      onSnapshot,
      now: () => now,
      minimumPositionIntervalMs: 250,
    });
    const initial = createRendererSemanticSnapshot(identity, [subject("agent", "a")]);
    publisher.accept(initial);
    publisher.accept(createRendererSemanticSnapshot(identity, [
      subject("agent", "a", { position: { x: 31.9, y: 63.9 } }),
    ]));
    now = 50;
    publisher.accept(createRendererSemanticSnapshot(identity, [
      subject("agent", "a", { position: { x: 32, y: 64 } }),
    ]));
    now = 80;
    publisher.accept(createRendererSemanticSnapshot(identity, [
      subject("agent", "a", { action: "moving" }),
    ]));
    now = 260;
    publisher.accept(createRendererSemanticSnapshot(identity, [
      subject("agent", "a", { position: { x: 32, y: 64 }, action: "moving" }),
    ]));

    expect(onSnapshot).toHaveBeenCalledTimes(3);
    expect(onSnapshot.mock.calls.map(([value]) => value.subjects[0].action)).toEqual([
      null, "moving", "moving",
    ]);
  });

  it("publishes complete frame identity advances even when renderer subject fields are unchanged", () => {
    const onSnapshot = vi.fn();
    const publisher = createRendererSemanticPublisher({ onSnapshot });
    publisher.accept(createRendererSemanticSnapshot(identity, [subject("agent", "a")]));
    publisher.accept(createRendererSemanticSnapshot({
      ...identity,
      revision: identity.revision + 1,
      lastCursor: identity.lastCursor + 1,
    }, [subject("agent", "a")]));

    expect(onSnapshot).toHaveBeenCalledTimes(2);
    expect(onSnapshot.mock.calls.map(([snapshot]) => snapshot.frameIdentity.revision))
      .toEqual([identity.revision, identity.revision + 1]);
  });

  it("never carries display prose or debug truth beyond bounded renderer fields", () => {
    const snapshot = createRendererSemanticSnapshot(identity, [subject("agent", "secret-agent")]);
    expect(Object.keys(snapshot.subjects[0]!).sort()).toEqual([
      "action", "kind", "position", "regionId", "selection", "stableSelectionKey", "status",
    ]);
    expect(JSON.stringify(snapshot)).not.toContain("camera");
    expect(JSON.stringify(snapshot)).not.toContain("diagnostic");
  });
});
