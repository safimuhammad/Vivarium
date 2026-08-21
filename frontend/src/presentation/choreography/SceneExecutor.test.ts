import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { BeatDirector, type StoryMoment } from "../BeatDirector";
import type { FrameIdentity, PresentedSceneView } from "../contracts";
import type {
  SceneRuntimeMarker,
  SceneRuntimeProgram,
  SceneRuntimeSignal,
} from "../SceneSettlementCoordinator";
import { getChronicleManifest } from "../fixtures/chronicleCatalog";
import { createSceneExecutor } from "./SceneExecutor";

const IDENTITY: FrameIdentity = Object.freeze({
  runId: "executor-run",
  sourceKey: "fixture:executor-run",
  revision: 7,
  firstCursor: 0,
  lastCursor: 0,
});

describe("SceneExecutor", () => {
  it("deep-owns a valid marker program and issues strictly increasing tokens", () => {
    const executor = createSceneExecutor();
    const input = runtimeStart();
    const token = executor.start(input, IDENTITY);
    (input.program as { id: string }).id = "mutated";
    (input.program.markers[0] as { name: string }).name = "mutated-marker";
    (input.program.phases[0].actorIntents as unknown as Array<unknown>).push({ kind: "idle" });

    expect(token).toBe(1);
    expect(executor.snapshot()).toMatchObject({
      sceneToken: 1,
      planId: "plan:executor",
      phase: "enter",
      emittedMarkers: [],
      consequenceCommitCount: 0,
      settled: false,
      disposed: false,
    });
    expect(() => executor.start(runtimeStart(), IDENTITY)).toThrow("unsettled");

    settleNormally(executor, token);
    expect(executor.start(runtimeStart(), { ...IDENTITY, revision: 9 })).toBe(2);
  });

  it.each([
    ["empty program id", (program: MutableProgram) => { program.id = " "; }],
    ["phase gap", (program: MutableProgram) => { program.phaseWindows[1]!.startMs = 201; }],
    ["phase overlap", (program: MutableProgram) => { program.phaseWindows[1]!.startMs = 199; }],
    ["phase does not cover duration", (program: MutableProgram) => { program.phaseWindows.at(-1)!.endMs = 999; }],
    ["phase view mismatch", (program: MutableProgram) => { program.phases[0]!.phase = "hold"; }],
    ["foreign moment view", (program: MutableProgram) => { program.phases[0]!.momentId = "other"; }],
    ["duplicate marker", (program: MutableProgram) => { program.markers[1]!.name = program.markers[0]!.name; }],
    ["unordered marker time", (program: MutableProgram) => { program.markers[1]!.atMs = 100; }],
    ["unordered marker tie", (program: MutableProgram) => { program.markers[3]!.order = -1; }],
    ["duplicate same-time order", (program: MutableProgram) => { program.markers[3]!.order = 0; }],
    ["marker beyond duration", (program: MutableProgram) => { program.markers[0]!.atMs = 1_001; }],
    ["two consequences", (program: MutableProgram) => { program.markers[0]!.role = "consequence"; }],
    ["optional consequence", (program: MutableProgram) => { program.markers[1]!.optional = true; }],
    ["wrong consequence name", (program: MutableProgram) => { program.consequenceMarker = "contact"; }],
    ["undeclared safe marker", (program: MutableProgram) => { program.safeCancelMarkers = ["missing"]; }],
    ["safe marker before consequence", (program: MutableProgram) => { program.markers[2]!.atMs = 300; }],
    ["missing settle", (program: MutableProgram) => { program.markers.pop(); }],
    ["settle before duration", (program: MutableProgram) => { program.markers.at(-1)!.atMs = 999; }],
  ] as const)("rejects malformed marker programs: %s", (_label, mutate) => {
    const executor = createSceneExecutor();
    const input = runtimeStart();
    mutate(input.program as MutableProgram);
    expect(() => executor.start(input, IDENTITY)).toThrow();
    expect(executor.snapshot().sceneToken).toBeNull();
  });

  it.each([
    [{ ...IDENTITY, runId: "" }, "runId"],
    [{ ...IDENTITY, sourceKey: "" }, "sourceKey"],
    [{ ...IDENTITY, revision: -1 }, "revision"],
    [{ ...IDENTITY, firstCursor: 2, lastCursor: 1 }, "firstCursor"],
  ] as const)("rejects malformed start identity %#", (identity, message) => {
    const executor = createSceneExecutor();
    expect(() => executor.start(runtimeStart(), identity)).toThrow(message);
  });

  it("emits crossed markers once in stable order and halts a large jump at publication", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);

    expect(executor.advance(1_000)).toEqual([
      { kind: "consequence-marker", sceneToken: token, marker: "truth" },
    ]);
    expect(executor.snapshot()).toMatchObject({
      phase: "consequence",
      emittedMarkers: ["contact", "truth"],
      consequenceCommitCount: 1,
      elapsedMs: 400,
      publishedRevision: null,
      settled: false,
    });
    expect(executor.nextDeadlineMs()).toBeNull();
    expect(executor.advance(10_000)).toEqual([]);
    expect(executor.snapshot().emittedMarkers).toEqual(["contact", "truth"]);
    expect(Object.isFrozen(executor.snapshot())).toBe(true);
    expect(Object.isFrozen(executor.snapshot().emittedMarkers)).toBe(true);
  });

  it("does not acknowledge publication before consequence or own a scheduler", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    expect(() => executor.acknowledgePublishedConsequence(token, 8, false, 0)).toThrow("before");

    const source = readFileSync(
      resolve(process.cwd(), "src/presentation/choreography/SceneExecutor.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/requestAnimationFrame|setTimeout|setInterval|performance\.now|visibilitychange/);
    expect(source).not.toMatch(/PresentationClock|FrameDriver|WakeScheduler/);
  });

  it("resumes the deferred large jump on an equal-time drain only after exact revision acknowledgement", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.advance(1_000);

    expect(() => executor.acknowledgePublishedConsequence(token, 7, false, 0)).toThrow("newer");
    expect(() => executor.acknowledgePublishedConsequence(token, -1, false, 0)).toThrow();
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    expect(executor.nextDeadlineMs()).toBe(400);
    expect(executor.advance(400)).toEqual([
      {
        kind: "safe-cancel-ack",
        sceneToken: token,
        cancelApplied: false,
        cancelGeneration: 0,
      },
      { kind: "scene-settled", sceneToken: token },
    ]);
    expect(executor.snapshot()).toMatchObject({
      emittedMarkers: ["contact", "truth", "safe-contact", "spark", "safe-exit", "settled"],
      publishedRevision: 8,
      settled: true,
      elapsedMs: 1_000,
    });
    expect(executor.nextDeadlineMs()).toBeNull();
    expect(executor.advance(1_000)).toEqual([]);
  });

  it("rejects conflicting active publication acknowledgements but ignores stale tokens", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.advance(400);
    executor.acknowledgePublishedConsequence(token - 1, 100, false, 0);
    expect(executor.snapshot().publishedRevision).toBeNull();
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    expect(() => executor.acknowledgePublishedConsequence(token, 9, false, 0)).toThrow("conflicting");
    expect(() => executor.acknowledgePublishedConsequence(token, 8, true, 1)).toThrow("conflicting");
  });

  it("retains a pre-consequence safe cancel and applies its exact generation only after publication", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.requestSafeCancel(token, "queue-overflow", 1);
    executor.requestSafeCancel(token, "queue-overflow", 1);

    expect(executor.advance(1_000)).toEqual([
      { kind: "consequence-marker", sceneToken: token, marker: "truth" },
    ]);
    expect(executor.snapshot()).toMatchObject({ cancelGeneration: 1, settled: false });
    executor.acknowledgePublishedConsequence(token, 8, true, 1);
    expect(executor.advance(400)).toEqual([
      {
        kind: "safe-cancel-ack",
        sceneToken: token,
        cancelApplied: true,
        cancelGeneration: 1,
      },
      { kind: "scene-settled", sceneToken: token },
    ]);
    expect(executor.snapshot()).toMatchObject({
      acknowledgedCancelGeneration: 1,
      settled: true,
      emittedMarkers: ["contact", "truth", "safe-contact"],
    });
  });

  it("requires a later safe marker for cancellation requested after a normal boundary", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.advance(400);
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    expect(executor.advance(600)).toEqual([
      {
        kind: "safe-cancel-ack",
        sceneToken: token,
        cancelApplied: false,
        cancelGeneration: 0,
      },
    ]);

    executor.requestSafeCancel(token, "late-pressure", 1);
    executor.requestSafeCancel(token - 1, "stale", 99);
    executor.requestSafeCancel(token, "older", 0);
    expect(executor.nextDeadlineMs()).toBe(1_000);
    expect(executor.advance(1_000)).toEqual([
      {
        kind: "safe-cancel-ack",
        sceneToken: token,
        cancelApplied: true,
        cancelGeneration: 1,
      },
      { kind: "scene-settled", sceneToken: token },
    ]);
  });

  it("rejects conflicting cancellation and acknowledgement generations", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.requestSafeCancel(token, "pressure", 1);
    expect(() => executor.requestSafeCancel(token, "different", 1)).toThrow("conflicting");
    executor.advance(400);
    expect(() => executor.acknowledgePublishedConsequence(token, 8, false, 0)).toThrow("cancellation");
    expect(() => executor.acknowledgePublishedConsequence(token, 8, true, 2)).toThrow("generation");
  });

  it("adopts only increasing cancellation generations before consequence", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.requestSafeCancel(token, "first", 1);
    executor.requestSafeCancel(token, "stale", 0);
    executor.requestSafeCancel(token, "newer", 2);
    expect(executor.snapshot().cancelGeneration).toBe(2);
    executor.advance(1_000);
    executor.acknowledgePublishedConsequence(token, 8, true, 2);
    expect(executor.advance(400)).toEqual([
      {
        kind: "safe-cancel-ack",
        sceneToken: token,
        cancelApplied: true,
        cancelGeneration: 2,
      },
      { kind: "scene-settled", sceneToken: token },
    ]);
  });

  it("exposes the next marker deadline, accepts equal elapsed time, and rejects time regression", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    expect(executor.nextDeadlineMs()).toBe(200);
    expect(executor.advance(0)).toEqual([]);
    expect(executor.advance(200)).toEqual([]);
    expect(executor.snapshot().emittedMarkers).toEqual(["contact"]);
    expect(executor.nextDeadlineMs()).toBe(400);
    expect(() => executor.advance(199)).toThrow("monotonic");
    expect(executor.advance(400)).toEqual([
      { kind: "consequence-marker", sceneToken: token, marker: "truth" },
    ]);
  });

  it("omits unavailable optional flourishes while preserving one consequence and settlement", () => {
    const executor = createSceneExecutor();
    const input = runtimeStart();
    (input.program as MutableProgram).markers = input.program.markers.filter(
      (marker) => marker.name !== "spark",
    ) as SceneRuntimeMarker[];
    const token = executor.start(input, IDENTITY);
    executor.advance(1_000);
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    const signals = executor.advance(400);

    expect(signals.map((signal) => signal.kind)).toEqual(["safe-cancel-ack", "scene-settled"]);
    expect(executor.snapshot()).toMatchObject({
      emittedMarkers: ["contact", "truth", "safe-contact", "safe-exit", "settled"],
      consequenceCommitCount: 1,
      settled: true,
    });
  });

  it("continues after one runtime optional-marker failure, reports once, and settles one consequence", () => {
    const failures: Array<{ kind: string; retryable: boolean; publicMessage: string }> = [];
    const executor = createSceneExecutor({ onFailure: (failure) => failures.push(failure) });
    const token = executor.start(runtimeStart(), IDENTITY);

    executor.reportUnavailableMarker(token, "spark");
    executor.reportUnavailableMarker(token, "spark");
    executor.advance(1_000);
    executor.acknowledgePublishedConsequence(token, 8, false, 0);
    const signals = executor.advance(400);

    expect(failures).toEqual([{
      kind: "marker",
      retryable: false,
      publicMessage: "A visual flourish was omitted. The world state remains current.",
    }]);
    expect(signals.map(({ kind }) => kind)).toEqual(["safe-cancel-ack", "scene-settled"]);
    expect(executor.snapshot()).toMatchObject({
      emittedMarkers: ["contact", "truth", "safe-contact", "safe-exit", "settled"],
      consequenceCommitCount: 1,
      settled: true,
    });
  });

  it.each(["contact", "truth", "safe-contact", "settled"])(
    "hard-rejects runtime loss of required causal marker %s",
    (marker) => {
      const executor = createSceneExecutor();
      const token = executor.start(runtimeStart(), IDENTITY);
      expect(() => executor.reportUnavailableMarker(token, marker)).toThrow("required causal marker");
      expect(executor.snapshot()).toMatchObject({ consequenceCommitCount: 0, settled: false });
    },
  );

  it("disposes terminally and invalidates all pending work", () => {
    const executor = createSceneExecutor();
    const token = executor.start(runtimeStart(), IDENTITY);
    executor.advance(1_000);
    executor.requestSafeCancel(token, "pressure", 1);
    executor.dispose();
    executor.dispose();

    expect(executor.snapshot()).toEqual({
      sceneToken: null,
      planId: null,
      phase: null,
      emittedMarkers: [],
      consequenceCommitCount: 0,
      publishedRevision: null,
      cancelGeneration: 0,
      acknowledgedCancelGeneration: null,
      elapsedMs: 0,
      settled: false,
      disposed: true,
    });
    expect(executor.advance(100_000)).toEqual([]);
    expect(executor.nextDeadlineMs()).toBeNull();
    executor.acknowledgePublishedConsequence(token, 8, true, 1);
    executor.requestSafeCancel(token, "late", 2);
    expect(() => executor.start(runtimeStart(), IDENTITY)).toThrow("disposed");
  });
});

type MutableProgram = {
  -readonly [K in keyof SceneRuntimeProgram]: K extends "phases"
    ? Array<MutableScene>
    : K extends "phaseWindows"
      ? Array<{ phase: "enter" | "hold" | "consequence" | "recover" | "exit"; startMs: number; endMs: number }>
      : K extends "markers"
        ? Array<{ name: string; atMs: number; order: number; role: SceneRuntimeMarker["role"]; optional: boolean }>
        : SceneRuntimeProgram[K];
};

type MutableScene = {
  -readonly [K in keyof PresentedSceneView]: PresentedSceneView[K];
};

function runtimeStart(): { moment: StoryMoment; program: SceneRuntimeProgram } {
  const moment = storyMoment();
  return {
    moment,
    program: program(moment),
  };
}

function storyMoment(): StoryMoment {
  const manifest = getChronicleManifest("C12");
  return new BeatDirector().group(manifest.entries.slice(0, 1))[0]!;
}

function program(moment: StoryMoment): SceneRuntimeProgram {
  const windows = [
    { phase: "enter" as const, startMs: 0, endMs: 200 },
    { phase: "hold" as const, startMs: 200, endMs: 400 },
    { phase: "consequence" as const, startMs: 400, endMs: 600 },
    { phase: "recover" as const, startMs: 600, endMs: 900 },
    { phase: "exit" as const, startMs: 900, endMs: 1_000 },
  ];
  const markers: SceneRuntimeMarker[] = [
    { name: "contact", atMs: 200, order: 0, role: "contact", optional: false },
    { name: "truth", atMs: 400, order: 0, role: "consequence", optional: false },
    { name: "safe-contact", atMs: 600, order: 0, role: "safe-cancel", optional: false },
    { name: "spark", atMs: 600, order: 1, role: "optional-effect", optional: true },
    { name: "safe-exit", atMs: 1_000, order: 0, role: "safe-cancel", optional: false },
    { name: "settled", atMs: 1_000, order: 1, role: "settle", optional: false },
  ];
  return {
    id: "plan:executor",
    phases: windows.map((window) => scene(moment, window.phase)),
    phaseWindows: windows,
    markers,
    durationMs: 1_000,
    consequenceMarker: "truth",
    safeCancelMarkers: ["safe-contact", "safe-exit"],
  };
}

function scene(moment: StoryMoment, phase: PresentedSceneView["phase"]): PresentedSceneView {
  return {
    momentId: moment.id,
    regionId: moment.representative.event.region,
    phase,
    focus: moment.focus,
    dialogue: null,
    actorIntents: [],
    homeIntents: [],
    effectIntents: [],
    safeCancelMarkers: ["safe-contact", "safe-exit"],
    reducedMotion: false,
  };
}

function settleNormally(
  executor: ReturnType<typeof createSceneExecutor>,
  token: number,
): readonly SceneRuntimeSignal[] {
  executor.advance(1_000);
  executor.acknowledgePublishedConsequence(token, 8, false, 0);
  return executor.advance(400);
}
