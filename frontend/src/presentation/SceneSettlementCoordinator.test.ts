import { describe, expect, it, vi } from "vitest";

import { PresentedWorldModel } from "./PresentedWorldModel";
import type { FrameIdentity } from "./contracts";
import { getChronicleManifest } from "./fixtures/chronicleCatalog";
import { BeatDirector, type StoryMoment } from "./BeatDirector";
import {
  SceneSettlementCoordinator,
  type SceneRuntimePort,
  type SceneRuntimeProgram,
  type SceneRuntimeSignal,
  type SceneRuntimeStart,
} from "./SceneSettlementCoordinator";
import { createSceneExecutor } from "./choreography/SceneExecutor";

const identity: FrameIdentity = {
  runId: "mock-c12-v1",
  sourceKey: "fixture:mock-c12-v1",
  revision: 1,
  firstCursor: 0,
  lastCursor: 0,
};

class ScriptedRuntime implements SceneRuntimePort {
  readonly log: string[];
  readonly token: number;
  signals: SceneRuntimeSignal[] = [];
  cancelRequests: string[] = [];
  disposed = false;
  startFailures = 0;
  acknowledgeFailures = 0;
  cancelFailures = 0;

  constructor(log: string[], token = 41) {
    this.log = log;
    this.token = token;
  }

  start(_input: SceneRuntimeStart, _identity: FrameIdentity): number {
    if (this.startFailures > 0) {
      this.startFailures -= 1;
      throw new Error("runtime start unavailable");
    }
    return this.token;
  }

  advance(_nowMs: number): readonly SceneRuntimeSignal[] {
    return this.signals.splice(0);
  }

  acknowledgePublishedConsequence(
    sceneToken: number,
    publishedRevision: number,
    _cancelRequested: boolean,
    _cancelGeneration: number,
  ): void {
    if (this.acknowledgeFailures > 0) {
      this.acknowledgeFailures -= 1;
      throw new Error("runtime acknowledgement unavailable");
    }
    this.log.push(`acknowledge(${sceneToken},${publishedRevision})`);
  }

  requestSafeCancel(sceneToken: number, reason: string, _cancelGeneration: number): void {
    if (this.cancelFailures > 0) {
      this.cancelFailures -= 1;
      throw new Error("runtime cancellation unavailable");
    }
    this.cancelRequests.push(`${sceneToken}:${reason}`);
  }

  nextDeadlineMs(): number | null {
    return null;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function setup(options: {
  readonly publish?: (moment: StoryMoment) => number;
  readonly complete?: (moment: StoryMoment) => void;
  readonly commitFailures?: number;
} = {}): {
  coordinator: SceneSettlementCoordinator;
  runtime: ScriptedRuntime;
  model: PresentedWorldModel;
  moment: StoryMoment;
  log: string[];
  completions: StoryMoment[];
} {
  const manifest = getChronicleManifest("C12");
  const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
  const moment = new BeatDirector().group(manifest.entries.slice(0, 1))[0];
  const log: string[] = [];
  const completions: StoryMoment[] = [];
  const runtime = new ScriptedRuntime(log);
  const applyEvidence = model.applyEvidence.bind(model);
  let commitFailures = options.commitFailures ?? 0;
  vi.spyOn(model, "applyEvidence").mockImplementation((entries) => {
    if (commitFailures > 0) {
      commitFailures -= 1;
      throw new Error("model commit unavailable");
    }
    log.push("commit");
    return applyEvidence(entries);
  });
  const coordinator = new SceneSettlementCoordinator({
    model,
    runtime,
    publishConsequenceFrame(current) {
      log.push(`publish(${current.lastCursor},2)`);
      return options.publish?.(current) ?? 2;
    },
    onSettlementComplete(current) {
      log.push("cursor-advance");
      completions.push(current);
      options.complete?.(current);
    },
  });
  coordinator.begin({ moment, program: programFor(moment) }, identity);
  return { coordinator, runtime, model, moment, log, completions };
}

describe("SceneSettlementCoordinator", () => {
  it("preserves the publication barrier with the real scheduler-free executor", () => {
    const manifest = getChronicleManifest("C12");
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const moment = new BeatDirector().group(manifest.entries.slice(0, 1))[0]!;
    const runtime = createSceneExecutor();
    const order: string[] = [];
    const applyEvidence = model.applyEvidence.bind(model);
    vi.spyOn(model, "applyEvidence").mockImplementation((entries) => {
      order.push("commit");
      return applyEvidence(entries);
    });
    const coordinator = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => {
        order.push("publish:2");
        return 2;
      },
      onSettlementComplete: () => order.push("cursor-advance"),
    });
    coordinator.begin({ moment, program: executableProgramFor(moment) }, identity);

    coordinator.advance(1_000);
    expect(order).toEqual(["commit", "publish:2"]);
    expect(coordinator.getSnapshot()).toMatchObject({
      consequenceCommitted: true,
      publishedRevision: 2,
      safeBoundaryAcknowledged: false,
      sceneSettled: false,
    });
    expect(coordinator.nextDeadlineMs()).toBe(500);

    coordinator.advance(500);
    expect(order).toEqual(["commit", "publish:2", "cursor-advance"]);
    expect(coordinator.getSnapshot()).toMatchObject({
      safeBoundaryAcknowledged: true,
      acknowledgedCancelGeneration: 0,
      sceneSettled: true,
    });
    expect(model.getView().projectedThroughCursor).toBe(moment.lastCursor);
  });

  it("does not advance presentedCursor while the scene executor is stalled", () => {
    const { coordinator, completions, model } = setup();

    coordinator.advance(50_000);

    expect(model.getView().projectedThroughCursor).toBe(0);
    expect(completions).toEqual([]);
    expect(coordinator.getSnapshot().sceneSettled).toBe(false);
  });

  it("commits duplicate consequence markers exactly once", () => {
    const { coordinator, runtime, model, log } = setup();
    runtime.signals.push(
      { kind: "consequence-marker", sceneToken: 41, marker: "truth" },
      { kind: "consequence-marker", sceneToken: 41, marker: "truth" },
      { kind: "consequence-marker", sceneToken: 99, marker: "stale" },
    );

    coordinator.advance(500);

    expect(model.getView().projectedThroughCursor).toBe(1);
    expect(log).toEqual(["commit", "publish(1,2)", "acknowledge(41,2)"]);
    expect(coordinator.getSnapshot()).toMatchObject({
      consequenceCommitted: true,
      publishedRevision: 2,
      safeBoundaryAcknowledged: false,
    });
  });

  it("publishes the consequence frame before acknowledging a safe cancellation", () => {
    const { coordinator, runtime, log } = setup();
    coordinator.requestSafeCancel("pressure");
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    coordinator.advance(500);
    runtime.signals.push({ kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: true, cancelGeneration: 1 });
    coordinator.advance(501);

    expect(runtime.cancelRequests).toEqual(["41:pressure"]);
    expect(log).toEqual(["commit", "publish(1,2)", "acknowledge(41,2)"]);
    expect(coordinator.getSnapshot()).toMatchObject({
      publishedRevision: 2,
      safeBoundaryAcknowledged: true,
      cancelRequested: true,
    });
  });

  it("does not accept a declined safe cancellation as the requested boundary", () => {
    const { coordinator, runtime, completions } = setup();
    coordinator.requestSafeCancel("pressure");
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    coordinator.advance(500);
    runtime.signals.push(
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 1 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(700);

    expect(coordinator.getSnapshot().safeBoundaryAcknowledged).toBe(false);
    expect(completions).toEqual([]);
    runtime.signals.push(
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: true, cancelGeneration: 1 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(800);
    expect(completions).toHaveLength(1);
  });

  it("requires a new applied acknowledgement when cancellation follows a normal boundary", () => {
    const { coordinator, runtime, completions } = setup();
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    coordinator.advance(500);
    runtime.signals.push({ kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 });
    coordinator.advance(600);
    expect(coordinator.getSnapshot().safeBoundaryAcknowledged).toBe(true);

    coordinator.requestSafeCancel("late-pressure");
    expect(coordinator.getSnapshot().safeBoundaryAcknowledged).toBe(false);
    runtime.signals.push(
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(700);
    expect(completions).toEqual([]);

    runtime.signals.push(
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: true, cancelGeneration: 1 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(800);
    expect(completions).toHaveLength(1);
  });

  it("rejects a reused scene token before delayed prior-scene signals can settle a new moment", () => {
    const { coordinator, runtime, moment } = setup();
    runtime.signals.push(
      { kind: "consequence-marker", sceneToken: 41, marker: "truth" },
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(1_000);
    const nextMoment = {
      ...moment,
      id: "second",
      firstCursor: 2,
      lastCursor: 2,
      evidenceCursors: [2],
      evidence: moment.evidence.map((entry) => ({ ...entry, cursor: 2 })),
      representative: { ...moment.representative, cursor: 2 },
    };

    expect(() => coordinator.begin(
      { moment: nextMoment, program: programFor(nextMoment) },
      identity,
    )).toThrow("scene tokens must increase monotonically");
  });

  it("retries commit, publish, acknowledgement, and cancellation collaborators without new evidence signals", () => {
    let publicationFailures = 1;
    const { coordinator, runtime, model, completions } = setup({
      commitFailures: 1,
      publish: () => {
        if (publicationFailures > 0) {
          publicationFailures -= 1;
          throw new Error("publisher unavailable");
        }
        return 3;
      },
    });
    runtime.cancelFailures = 1;
    runtime.acknowledgeFailures = 1;

    expect(() => coordinator.requestSafeCancel("pressure")).toThrow("runtime cancellation unavailable");
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    expect(() => coordinator.advance(500)).toThrow("model commit unavailable");
    expect(() => coordinator.advance(501)).toThrow("publisher unavailable");
    expect(() => coordinator.advance(502)).toThrow("runtime acknowledgement unavailable");
    expect(() => coordinator.advance(503)).not.toThrow();

    expect(model.getView().projectedThroughCursor).toBe(1);
    expect(runtime.cancelRequests).toEqual(["41:pressure"]);
    runtime.signals.push(
      { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: true, cancelGeneration: 1 },
      { kind: "scene-settled", sceneToken: 41 },
    );
    coordinator.advance(1_000);
    expect(completions).toHaveLength(1);
  });

  it("serializes reentrant listener advances behind publish and runtime acknowledgement", () => {
    let publications = 0;
    const { coordinator, runtime, completions, log } = setup({
      publish: () => {
        publications += 1;
        return 2;
      },
    });
    let injected = false;
    coordinator.subscribe(() => {
      const snapshot = coordinator.getSnapshot();
      if (!injected && snapshot.consequenceCommitted && snapshot.publishedRevision === null) {
        injected = true;
        runtime.signals.push(
          { kind: "consequence-marker", sceneToken: 41, marker: "truth" },
          { kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 },
          { kind: "scene-settled", sceneToken: 41 },
        );
        coordinator.advance(1_000);
      }
    });

    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    coordinator.advance(500);

    expect(publications).toBe(1);
    expect(log.indexOf("acknowledge(41,2)")).toBeLessThan(log.indexOf("cursor-advance"));
    expect(completions).toHaveLength(1);
  });

  it.each(["throw", "invalid"] as const)(
    "commits once and retries publication after a %s publisher failure",
    (failure) => {
      let publications = 0;
      const { coordinator, runtime, model, log } = setup({
        publish: () => {
          publications += 1;
          if (publications === 1) {
            if (failure === "throw") throw new Error("publisher unavailable");
            return -1;
          }
          return 3;
        },
      });
      runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
      expect(() => coordinator.advance(500)).toThrow();
      expect(model.getView().projectedThroughCursor).toBe(1);
      expect(coordinator.getSnapshot()).toMatchObject({
        consequenceCommitted: true,
        publishedRevision: null,
      });

      runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
      coordinator.advance(501);

      expect(model.getView().projectedThroughCursor).toBe(1);
      expect(publications).toBe(2);
      expect(log.filter((item) => item === "commit")).toHaveLength(1);
      expect(coordinator.getSnapshot().publishedRevision).toBe(3);
    },
  );

  it("advances to lastCursor only after scene-settled", () => {
    const { coordinator, runtime, log, completions, moment } = setup();
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    coordinator.advance(500);
    runtime.signals.push({ kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 });
    log.push("safe-cancel-ack");
    coordinator.advance(600);

    expect(completions).toEqual([]);
    runtime.signals.push({ kind: "scene-settled", sceneToken: 41 });
    log.push("scene-settled");
    coordinator.advance(1_000);

    expect(completions).toEqual([moment]);
    expect(log).toEqual([
      "commit",
      "publish(1,2)",
      "acknowledge(41,2)",
      "safe-cancel-ack",
      "scene-settled",
      "cursor-advance",
    ]);
    coordinator.advance(2_000);
    expect(completions).toHaveLength(1);
  });

  it("rejects stale tokens and releases its runtime on disposal", () => {
    const { coordinator, runtime, model } = setup();
    runtime.signals.push(
      { kind: "consequence-marker", sceneToken: 40, marker: "stale" },
      { kind: "safe-cancel-ack", sceneToken: 40, cancelApplied: true, cancelGeneration: 0 },
      { kind: "scene-settled", sceneToken: 40 },
    );
    coordinator.advance(1_000);
    coordinator.dispose();

    expect(model.getView().projectedThroughCursor).toBe(0);
    expect(runtime.disposed).toBe(true);
    expect(coordinator.getSnapshot().sceneToken).toBeNull();
  });

  it("notifies healthy listeners even when a peer listener and completion callback throw", () => {
    const { coordinator, runtime } = setup({
      complete: () => {
        throw new Error("completion observer failed");
      },
    });
    let healthyNotifications = 0;
    coordinator.subscribe(() => {
      throw new Error("listener failed");
    });
    coordinator.subscribe(() => {
      healthyNotifications += 1;
    });
    runtime.signals.push({ kind: "consequence-marker", sceneToken: 41, marker: "truth" });
    expect(() => coordinator.advance(500)).not.toThrow();
    runtime.signals.push({ kind: "safe-cancel-ack", sceneToken: 41, cancelApplied: false, cancelGeneration: 0 });
    expect(() => coordinator.advance(600)).not.toThrow();
    runtime.signals.push({ kind: "scene-settled", sceneToken: 41 });
    expect(() => coordinator.advance(1_000)).not.toThrow();

    expect(coordinator.getSnapshot().sceneSettled).toBe(true);
    expect(healthyNotifications).toBeGreaterThanOrEqual(3);
  });
});

function programFor(moment: StoryMoment): SceneRuntimeProgram {
  return executableProgramFor(moment);
}

function executableProgramFor(moment: StoryMoment): SceneRuntimeProgram {
  const phaseWindows = [
    { phase: "enter" as const, startMs: 0, endMs: 200 },
    { phase: "hold" as const, startMs: 200, endMs: 500 },
    { phase: "consequence" as const, startMs: 500, endMs: 700 },
    { phase: "recover" as const, startMs: 700, endMs: 900 },
    { phase: "exit" as const, startMs: 900, endMs: 1_000 },
  ];
  return {
    id: `real:${moment.id}`,
    phaseWindows,
    phases: phaseWindows.map(({ phase }) => ({
      momentId: moment.id,
      regionId: moment.representative.event.region,
      phase,
      focus: moment.focus,
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: ["safe-exit"],
      reducedMotion: false,
    })),
    markers: [
      { name: "truth", atMs: 500, order: 0, role: "consequence", optional: false },
      { name: "safe-exit", atMs: 1_000, order: 0, role: "safe-cancel", optional: false },
      { name: "settled", atMs: 1_000, order: 1, role: "settle", optional: false },
    ],
    durationMs: 1_000,
    consequenceMarker: "truth",
    safeCancelMarkers: ["safe-exit"],
  };
}
