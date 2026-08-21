import { describe, expect, it, vi } from "vitest";

import { makeWorld } from "../test/fixtures";
import type { FrameIdentity, PresentedObserverFrame } from "./contracts";
import { PresentedWorldModel } from "./PresentedWorldModel";
import {
  createPresentationFrameAcceptanceTracker,
  createPresentationFrameSink,
} from "./PresentationFrameSink";

describe("PresentationFrameSink", () => {
  it("RED: tracks exact Canvas acceptance by frame and typed execution identity", () => {
    const tracker = createPresentationFrameAcceptanceTracker();
    const consequence = frame({
      revision: 4,
      firstCursor: 8,
      lastCursor: 8,
      scene: {
        momentId: "8:8:single",
        regionId: "meadow",
        phase: "consequence",
        focus: { kind: "system", regionId: "meadow" },
        dialogue: null,
        actorIntents: [],
        homeIntents: [],
        effectIntents: [],
        safeCancelMarkers: ["safe"],
        reducedMotion: false,
        execution: { sceneToken: 7, programId: "plan:7", eventType: "agent_entered_region" },
      },
    });
    expect(tracker.accepts(consequence)).toBe(false);
    tracker.markAccepted(consequence);
    expect(tracker.accepts(structuredClone(consequence))).toBe(true);
    expect(tracker.accepts({ ...consequence, revision: 5 })).toBe(false);
    expect(tracker.accepts({
      ...consequence,
      scene: { ...consequence.scene!, execution: { sceneToken: 8, programId: "plan:7" } },
    })).toBe(false);
    expect(tracker.accepts({
      ...consequence,
      scene: {
        ...consequence.scene!,
        execution: { sceneToken: 7, programId: "plan:7", eventType: "speak" },
      },
    })).toBe(false);
    tracker.clear();
    expect(tracker.accepts(consequence)).toBe(false);
    tracker.dispose();
    tracker.markAccepted(consequence);
    expect(tracker.accepts(consequence)).toBe(false);
  });

  it("uses a monotonic publication serial independent of frame revision", () => {
    const sink = createPresentationFrameSink();
    const first = frame({ revision: 27 });
    const second = frame({ revision: 27, selection: { kind: "region", id: "meadow" } });

    expect(sink.publish(first)).toBe(1);
    expect(sink.publish(second)).toBe(2);
    expect(sink.getSnapshot()).toMatchObject({
      publicationSerial: 2,
      frame: second,
      disposed: false,
    });
  });

  it("retains exactly one selected current frame", () => {
    const sink = createPresentationFrameSink();
    const first = frame({ revision: 1 });
    const second = frame({ revision: 2, firstCursor: 5, lastCursor: 5 });

    sink.publish(first);
    sink.publish(second);

    expect(sink.getSnapshot().frame).toEqual(second);
    expect(sink.getSnapshot().frame).not.toBe(second);
    expect(sink.getSnapshot().frame).not.toEqual(first);
  });

  it("rejects stale, regressing, and foreign publications without notifying", () => {
    const sink = createPresentationFrameSink();
    const accepted = frame({ revision: 4, firstCursor: 8, lastCursor: 8 });
    const listener = vi.fn();
    sink.subscribe(listener);
    expect(sink.publish(accepted)).toBe(1);

    const stale = frame({ revision: 3, firstCursor: 9, lastCursor: 9 });
    const regressing = frame({ revision: 4, firstCursor: 7, lastCursor: 7 });
    const foreignRun = frame({ runId: "run-b", revision: 5, firstCursor: 9, lastCursor: 9 });
    const foreignSource = frame({ sourceKey: "archive:1", revision: 5, firstCursor: 9, lastCursor: 9 });

    expect(sink.publish(stale)).toBe(1);
    expect(sink.publish(regressing)).toBe(1);
    expect(sink.publish(foreignRun)).toBe(1);
    expect(sink.publish(foreignSource)).toBe(1);
    expect(sink.getSnapshot().frame).toEqual(accepted);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rejects stale and foreign clears but accepts a current-lineage clear", () => {
    const sink = createPresentationFrameSink();
    const accepted = frame({ revision: 4, firstCursor: 8, lastCursor: 8 });
    const listener = vi.fn();
    sink.subscribe(listener);
    sink.publish(accepted);

    sink.clear(identityOf(accepted, { revision: 3 }));
    sink.clear(identityOf(accepted, { firstCursor: 7, lastCursor: 7 }));
    sink.clear(identityOf(accepted, { sourceKey: "archive:1", revision: 5 }));
    expect(sink.getSnapshot().frame).toEqual(accepted);
    expect(sink.getSnapshot().publicationSerial).toBe(1);

    sink.clear(identityOf(accepted, { revision: 5, firstCursor: 8, lastCursor: 8 }));
    expect(sink.getSnapshot()).toMatchObject({ frame: null, publicationSerial: 2 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("preserves the lineage guard after clear", () => {
    const sink = createPresentationFrameSink();
    sink.publish(frame({ revision: 4, firstCursor: 8, lastCursor: 8 }));
    sink.clear({
      runId: "run-a",
      sourceKey: "live:run-a",
      revision: 5,
      firstCursor: 8,
      lastCursor: 8,
    });

    expect(sink.publish(frame({ revision: 4, firstCursor: 9, lastCursor: 9 }))).toBe(2);
    expect(sink.getSnapshot().frame).toBeNull();
    expect(sink.publish(frame({ revision: 6, firstCursor: 9, lastCursor: 9 }))).toBe(3);
  });

  it("isolates subscriber exceptions and queues reentrant publications", () => {
    const sink = createPresentationFrameSink();
    const healthy = vi.fn();
    const second = frame({ revision: 2, firstCursor: 5, lastCursor: 5 });
    let reentered = false;
    sink.subscribe(() => {
      if (!reentered) {
        reentered = true;
        sink.publish(second);
      }
    });
    sink.subscribe(() => {
      throw new Error("observer failed");
    });
    sink.subscribe(healthy);

    expect(sink.publish(frame({ revision: 1 }))).toBe(1);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(sink.getSnapshot().publicationSerial).toBe(2);
    expect(sink.getSnapshot().frame).toEqual(second);
  });

  it("serializes a reentrant clear followed by a newer publication", () => {
    const sink = createPresentationFrameSink();
    const replacement = frame({ revision: 3, firstCursor: 5, lastCursor: 5 });
    const healthy = vi.fn();
    let reentered = false;
    sink.subscribe(() => {
      if (reentered) return;
      reentered = true;
      sink.clear({
        runId: "run-a",
        sourceKey: "live:run-a",
        revision: 2,
        firstCursor: 4,
        lastCursor: 4,
      });
      sink.publish(replacement);
    });
    sink.subscribe(healthy);

    expect(sink.publish(frame({ revision: 1 }))).toBe(1);
    expect(sink.getSnapshot()).toMatchObject({
      publicationSerial: 3,
      frame: replacement,
    });
    expect(healthy).toHaveBeenCalledTimes(3);
  });

  it("does not let a stale clear blank a newer bound frame", () => {
    const sink = createPresentationFrameSink();
    sink.publish(frame({ revision: 4, firstCursor: 8, lastCursor: 8 }));
    const newest = frame({ revision: 9, firstCursor: 12, lastCursor: 12 });
    sink.publish(newest);

    sink.clear({
      runId: "run-a",
      sourceKey: "live:run-a",
      revision: 8,
      firstCursor: 12,
      lastCursor: 12,
    });

    expect(sink.getSnapshot()).toMatchObject({
      publicationSerial: 2,
      frame: newest,
    });
  });

  it("deep-owns accepted frame truth and freezes every exposed snapshot value", () => {
    const sink = createPresentationFrameSink();
    const input = structuredClone(frame({
      selection: { kind: "region", id: "meadow" },
    })) as PresentedObserverFrame;
    sink.publish(input);
    const accepted = sink.getSnapshot();

    (input.backlog as { label: string }).label = "fabricated backlog";
    (input.transport as { retryable: boolean }).retryable = true;
    ((input.selection as { id: string }).id) = "fabricated-region";

    expect(accepted.frame).not.toBe(input);
    expect(accepted.frame).toMatchObject({
      backlog: { label: "Caught up" },
      transport: { retryable: false },
      selection: { kind: "region", id: "meadow" },
    });
    expect(() => {
      (accepted.frame!.backlog as { label: string }).label = "rewritten";
    }).toThrow();
    expect(() => {
      (accepted as { publicationSerial: number }).publicationSerial = 99;
    }).toThrow();
  });

  it("stops the current notification pass when a listener disposes the sink", () => {
    const sink = createPresentationFrameSink();
    const disposer = vi.fn(() => sink.dispose());
    const later = vi.fn();
    sink.subscribe(disposer);
    sink.subscribe(later);

    expect(sink.publish(frame())).toBe(1);
    expect(disposer).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    expect(sink.getSnapshot()).toMatchObject({
      disposed: true,
      frame: null,
      publicationSerial: 2,
    });
  });

  it("supports idempotent unsubscribe", () => {
    const sink = createPresentationFrameSink();
    const listener = vi.fn();
    const unsubscribe = sink.subscribe(listener);
    unsubscribe();
    unsubscribe();

    sink.publish(frame());
    expect(listener).not.toHaveBeenCalled();
  });

  it("disposes terminally and ignores all later work", () => {
    const sink = createPresentationFrameSink();
    const listener = vi.fn();
    sink.subscribe(listener);
    sink.publish(frame());
    sink.dispose();
    sink.dispose();
    const atDispose = sink.getSnapshot();

    expect(atDispose).toMatchObject({ disposed: true, frame: null, publicationSerial: 2 });
    expect(sink.publish(frame({ revision: 99, firstCursor: 99, lastCursor: 99 }))).toBe(2);
    sink.clear({
      runId: "run-a",
      sourceKey: "live:run-a",
      revision: 100,
      firstCursor: 99,
      lastCursor: 99,
    });
    expect(sink.subscribe(listener)).toEqual(expect.any(Function));
    expect(sink.getSnapshot()).toBe(atDispose);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("validates the first frame before accepting a lineage", () => {
    const sink = createPresentationFrameSink();
    expect(() => sink.publish(frame({ sourceKey: "" }))).toThrow("sourceKey");
    expect(sink.getSnapshot()).toMatchObject({ publicationSerial: 0, frame: null });
  });
});

function frame(overrides: Partial<PresentedObserverFrame> = {}): PresentedObserverFrame {
  const world = makeWorld({ run_id: overrides.runId ?? "run-a" });
  const identity: FrameIdentity = {
    runId: world.run_id,
    sourceKey: "live:run-a",
    revision: 1,
    firstCursor: world.event_cursor,
    lastCursor: world.event_cursor,
    ...identityOverrides(overrides),
  };
  const model = new PresentedWorldModel(world, {
    ...identity,
    firstCursor: world.event_cursor,
    lastCursor: world.event_cursor,
  });
  return {
    ...identity,
    source: "live",
    ingestedCursor: identity.lastCursor,
    presentedCursor: identity.lastCursor,
    world: model.getView(),
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: {
      connection: "live",
      ingestedCursor: identity.lastCursor,
      retryable: false,
    },
    ...overrides,
  };
}

function identityOverrides(overrides: Partial<PresentedObserverFrame>): Partial<FrameIdentity> {
  return {
    ...(overrides.runId === undefined ? {} : { runId: overrides.runId }),
    ...(overrides.sourceKey === undefined ? {} : { sourceKey: overrides.sourceKey }),
    ...(overrides.revision === undefined ? {} : { revision: overrides.revision }),
    ...(overrides.firstCursor === undefined ? {} : { firstCursor: overrides.firstCursor }),
    ...(overrides.lastCursor === undefined ? {} : { lastCursor: overrides.lastCursor }),
  };
}

function identityOf(
  value: PresentedObserverFrame,
  overrides: Partial<FrameIdentity>,
): FrameIdentity {
  return {
    runId: value.runId,
    sourceKey: value.sourceKey,
    revision: value.revision,
    firstCursor: value.firstCursor,
    lastCursor: value.lastCursor,
    ...overrides,
  };
}
