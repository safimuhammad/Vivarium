import { describe, expect, it } from "vitest";

import { PresentedWorldModel } from "./PresentedWorldModel";
import { SceneSettlementCoordinator, type SceneRuntimePort, type SceneRuntimeProgram, type SceneRuntimeSignal, type SceneRuntimeStart } from "./SceneSettlementCoordinator";
import { BeatDirector } from "./BeatDirector";
import {
  StoryDirector,
  buildStoryProgram,
  speechHoldMs,
} from "./StoryDirector";
import type { ClassifiedCheckpointRecord, FrameIdentity } from "./contracts";
import { createManualPresentationClock } from "./fixtures/ManualPresentationClock";
import type { PresentationClock } from "./storyClock";
import { getChronicleManifest } from "./fixtures/chronicleCatalog";
import type { PresentedEventType } from "./eventPayloads";
import { createSceneExecutor } from "./choreography/SceneExecutor";
import type {
  ConversationStaging,
  ConversationStagingDecision,
  ConversationStagingInput,
} from "./conversationStaging";

class ClocklessRuntime implements SceneRuntimePort {
  private token = 0;
  private program: SceneRuntimeStart["program"] | null = null;
  private consequenceSent = false;
  private acknowledged = false;
  private boundarySent = false;
  private settled = false;
  cancelRequests = 0;
  cancelGeneration = 0;
  disposed = false;
  startFailures = 0;
  acknowledgeFailures = 0;
  cancelFailures = 0;

  start(input: SceneRuntimeStart, _identity: FrameIdentity): number {
    if (this.startFailures > 0) {
      this.startFailures -= 1;
      throw new Error("runtime start unavailable");
    }
    this.token += 1;
    this.program = input.program;
    this.consequenceSent = false;
    this.acknowledged = false;
    this.boundarySent = false;
    this.settled = false;
    return this.token;
  }

  advance(nowMs: number): readonly SceneRuntimeSignal[] {
    if (this.program === null) return [];
    const signals: SceneRuntimeSignal[] = [];
    const consequenceAt = this.program.phaseWindows.find((window) => window.phase === "consequence")?.startMs ?? 0;
    if (!this.consequenceSent && nowMs >= consequenceAt) {
      this.consequenceSent = true;
      signals.push({ kind: "consequence-marker", sceneToken: this.token, marker: this.program.consequenceMarker });
    }
    if (this.acknowledged && !this.boundarySent) {
      this.boundarySent = true;
      signals.push({
        kind: "safe-cancel-ack",
        sceneToken: this.token,
        cancelApplied: this.cancelRequests > 0,
        cancelGeneration: this.cancelGeneration,
      });
    }
    if (this.boundarySent && !this.settled && nowMs >= this.program.durationMs) {
      this.settled = true;
      signals.push({ kind: "scene-settled", sceneToken: this.token });
    }
    return signals;
  }

  acknowledgePublishedConsequence(
    _sceneToken: number,
    _publishedRevision: number,
    _cancelRequested: boolean,
    _cancelGeneration: number,
  ): void {
    if (this.acknowledgeFailures > 0) {
      this.acknowledgeFailures -= 1;
      throw new Error("runtime acknowledgement unavailable");
    }
    this.acknowledged = true;
  }

  requestSafeCancel(_sceneToken: number, _reason: string, cancelGeneration: number): void {
    if (this.cancelFailures > 0) {
      this.cancelFailures -= 1;
      throw new Error("runtime cancellation unavailable");
    }
    this.cancelRequests += 1;
    this.cancelGeneration = cancelGeneration;
  }

  nextDeadlineMs(): number | null {
    if (this.program === null || this.settled) return null;
    if (!this.consequenceSent) {
      return this.program.phaseWindows.find((window) => window.phase === "consequence")?.startMs ?? 0;
    }
    if (this.acknowledged && !this.boundarySent) return 0;
    return this.program.durationMs;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function setup(options: {
  readonly publish?: () => number;
  readonly programResolver?: Readonly<{ resolve(moment: ReturnType<typeof singleMoment>): SceneRuntimeStart["program"] }>;
  readonly manifestId?: "C07" | "C09" | "C12";
  readonly conversationStaging?: ConversationStaging;
} = {}) {
  const manifest = getChronicleManifest(options.manifestId ?? "C12");
  const identity: FrameIdentity = {
    runId: manifest.runId,
    sourceKey: `fixture:${manifest.runId}`,
    revision: 1,
    firstCursor: 0,
    lastCursor: 0,
  };
  const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
  const runtime = new ClocklessRuntime();
  let revision = 1;
  const settlement = new SceneSettlementCoordinator({
    model,
    runtime,
    publishConsequenceFrame: () => options.publish?.() ?? ++revision,
    onSettlementComplete: () => undefined,
  });
  const clock = createManualPresentationClock();
  const director = new StoryDirector({
    clock,
    identity,
    model,
    settlement,
    ...(options.programResolver === undefined ? {} : { programResolver: options.programResolver }),
    ...(options.conversationStaging === undefined
      ? {}
      : { conversationStaging: options.conversationStaging }),
  } as never);
  return { manifest, identity, model, runtime, settlement, clock, director };
}

describe("StoryDirector", () => {
  it("RED: resolves once and retains the exact active program, scene, and executor token", () => {
    const moment = singleMoment("C12", "agent_born");
    const base = buildStoryProgram(moment, 1);
    const exactProgram = {
      ...base,
      id: "exact:birth-program",
      phases: base.phases.map((phase) => ({
        ...phase,
        actorIntents: phase.phase === "enter"
          ? [{ actorId: "child", kind: "orient" as const, target: { x: 80, y: 96 }, marker: "exact-enter" }]
          : phase.actorIntents,
      })),
    };
    let resolutions = 0;
    const { director } = setup({
      programResolver: {
        resolve(candidate) {
          resolutions += 1;
          expect(candidate.id).toBe(moment.id);
          return exactProgram;
        },
      },
    });

    director.ingest([moment]);
    const active = director.getSnapshot() as ReturnType<StoryDirector["getSnapshot"]> & {
      activeProgramId?: string | null;
      activeScene?: SceneRuntimeStart["program"]["phases"][number] | null;
      activeSceneToken?: number | null;
    };
    expect(resolutions).toBe(1);
    expect(active.activeProgramId).toBe("exact:birth-program");
    expect(active.activeScene).toEqual(exactProgram.phases[0]);
    expect(active.activeSceneToken).toBe(1);

    director.setPaused(true);
    director.setPaused(false);
    director.setSpeed(2);
    director.holdCurrentMoment(true);
    director.holdCurrentMoment(false);
    expect(resolutions).toBe(1);
  });

  it("runs all five phases with exactly one active C12 scene", () => {
    const { director, clock, manifest } = setup();
    const moments = new BeatDirector().group(manifest.entries);
    director.ingest(moments);

    // C12 opens on a `speak`, which the utterance lane clears without a lease,
    // so the first moment to actually reach the stage is cursor 2.
    const active = director.getSnapshot().activeMoment;
    expect(active?.firstCursor).toBe(2);
    expect(director.getSnapshot().pending[0]?.firstCursor).toBe(3);
    const program = buildStoryProgram(active!, 1);
    const observed = new Set([director.getSnapshot().phase]);
    for (const window of program.phaseWindows.slice(1)) {
      clock.advanceTo(window.startMs);
      observed.add(director.getSnapshot().phase);
    }
    clock.advanceTo(program.durationMs);

    expect([...observed]).toEqual(["enter", "hold", "consequence", "recover", "exit"]);
    expect(director.getSnapshot().presentedCursor).toBe(2);
    expect(director.getSnapshot().activeMoment?.firstCursor).toBe(3);
  });

  it("paces the complete frozen C12 life story to its final causal cursor", () => {
    const { director, clock, model, manifest } = setup();
    director.ingest(new BeatDirector().group(manifest.entries));

    clock.advanceTo(100_000);

    expect(director.getSnapshot()).toMatchObject({
      ingestedCursor: 12,
      presentedCursor: 12,
      activeMoment: null,
      pending: [],
    });
    expect(model.getView().projectedThroughCursor).toBe(12);
  });

  it("uses the exact speech reading hold and never compresses it with speed", () => {
    expect([0, 36, 198, 500].map(speechHoldMs)).toEqual([3_000, 3_000, 12_000, 12_000]);
    const speech = new BeatDirector().group(getChronicleManifest("C17").entries.slice(0, 1))[0];
    const slow = buildStoryProgram(speech, 0.5);
    const fast = buildStoryProgram(speech, 2);
    const hold = (program: typeof slow) => program.phaseWindows.find((window) => window.phase === "hold")!;

    expect(hold(slow).endMs - hold(slow).startMs).toBe(hold(fast).endMs - hold(fast).startMs);
    expect(fast.durationMs).toBeLessThan(slow.durationMs);
  });

  it("keeps ambient, featured, and drama defaults inside their exact timing bands", () => {
    const resource = singleMoment("C12", "resource_changed");
    const birth = singleMoment("C12", "agent_born");
    const death = singleMoment("C11", "agent_died");

    expect(buildStoryProgram(resource, 1).durationMs).toBeGreaterThanOrEqual(1_500);
    expect(buildStoryProgram(resource, 1).durationMs).toBeLessThanOrEqual(2_000);
    expect(buildStoryProgram(birth, 1).durationMs).toBeGreaterThanOrEqual(2_500);
    expect(buildStoryProgram(birth, 1).durationMs).toBeLessThanOrEqual(3_500);
    expect(buildStoryProgram(death, 1).durationMs).toBeGreaterThanOrEqual(3_200);
    expect(buildStoryProgram(death, 1).durationMs).toBeLessThanOrEqual(4_500);
  });

  it("applies a speed change to the active enter phase without shortening its hold", () => {
    // The vehicle used to be a speech moment, whose hold is the reading time of
    // its words. Speech no longer takes the stage at all (two-lane split), so
    // this now guards the same rule on a moment that does.
    const { director, clock } = setup();
    const staged = stagedMoment();
    director.ingest([staged]);
    const base = buildStoryProgram(staged, 1);
    const enterEnd = base.phaseWindows.find((window) => window.phase === "enter")!.endMs;
    const hold = base.phaseWindows.find((window) => window.phase === "hold")!;
    const holdMs = hold.endMs - hold.startMs;

    director.setSpeed(2);
    clock.advanceTo(enterEnd / 2);
    expect(director.getSnapshot().phase).toBe("hold");
    clock.advanceBy(holdMs - 1);
    expect(director.getSnapshot().phase).toBe("hold");
    clock.advanceBy(1);
    expect(director.getSnapshot().phase).toBe("consequence");
  });

  it.each([0.5, 2] as const)(
    "keeps consequence causal time unscaled at %sx while compressing only allowed phases",
    (speed) => {
      const { director, clock } = setup();
      const moment = reCursorMoment(singleMoment("C12", "agent_born"), 1);
      director.ingest([moment]);
      director.setSpeed(speed);
      const program = buildStoryProgram(moment, 1);
      const enter = program.phaseWindows.find((window) => window.phase === "enter")!;
      const hold = program.phaseWindows.find((window) => window.phase === "hold")!;
      const consequence = program.phaseWindows.find((window) => window.phase === "consequence")!;
      const consequenceWallStart = (enter.endMs - enter.startMs) / speed
        + (hold.endMs - hold.startMs);

      clock.advanceTo(consequenceWallStart);
      expect(director.getSnapshot().phase).toBe("consequence");
      clock.advanceBy(consequence.endMs - consequence.startMs - 1);
      expect(director.getSnapshot().phase).toBe("consequence");
      clock.advanceBy(1);
      expect(director.getSnapshot().phase).toBe("recover");
    },
  );

  it("freezes causal phase and cursor while paused or holding the active moment", () => {
    const { director, clock, manifest } = setup();
    director.ingest(new BeatDirector().group(manifest.entries.slice(0, 2)));
    const before = director.getSnapshot();

    director.setPaused(true);
    clock.advanceBy(30_000);
    expect(director.getSnapshot()).toMatchObject({
      activeMoment: before.activeMoment,
      phase: before.phase,
      presentedCursor: before.presentedCursor,
    });

    director.setPaused(false);
    director.holdCurrentMoment(true);
    clock.advanceBy(30_000);
    expect(director.getSnapshot().phase).toBe(before.phase);
    expect(director.getSnapshot().presentedCursor).toBe(before.presentedCursor);
    director.holdCurrentMoment(false);
    expect(clock.pendingCount()).toBe(1);
  });

  it("freezes the entire visible snapshot and model while paused, including accepted checkpoints", () => {
    const { director, model, manifest } = setup();
    director.ingest([stagedMoment(1)]);
    director.setPaused(true);
    const frozen = director.getSnapshot();
    const modelBefore = model.getView();
    director.ingest([stagedMoment(2)]);
    director.acceptCheckpoint(checkpointAtOne(manifest.initialSnapshot));

    expect(director.getSnapshot()).toBe(frozen);
    expect(model.getView()).toBe(modelBefore);
    director.setPaused(false);
    expect(director.getSnapshot().ingestedCursor).toBe(2);
    expect(model.getView().exactBaseCursor).toBe(0);
  });

  it("bounds a paused burst, preserves a pressure digest, and cancels only through settlement", () => {
    // C13 is 120 consecutive `speak` events. Since the two-lane split that is no
    // longer a backlog at all — the utterance lane clears every one of them
    // without a lease, which is the entire point — so the pressure path is now
    // guarded with a burst of moments that genuinely occupy the stage.
    const { director, runtime } = setup();
    const pressure = stagedBurst(120);
    director.ingest(pressure.slice(0, 1));
    director.setPaused(true);
    director.ingest(pressure.slice(1));
    const frozen = director.getSnapshot();
    expect(frozen.pending).toEqual([]);
    director.setPaused(false);

    const snapshot = director.getSnapshot();
    expect(snapshot.pending.length).toBeLessThanOrEqual(48);
    expect(snapshot.backlog.state).toBe("overflow");
    expect(snapshot.pressureSummaries).toHaveLength(1);
    expect(snapshot.pressureSummaries[0]).toMatchObject({
      firstCursor: 2,
      ambientCount: 0,
      archiveAvailable: true,
    });
    expect(snapshot.pressureSummaries[0].majorMomentIds.length).toBeGreaterThan(0);
    expect(snapshot.pressureSummaries[0].majorMomentIds.length).toBeLessThanOrEqual(32);
    const typedSummary = snapshot.pressureSummaries[0] as typeof snapshot.pressureSummaries[number] & {
      readonly majorDigest?: readonly { readonly eventType: string; readonly count: number }[];
    };
    expect(typedSummary.majorDigest).toEqual([{ eventType: "agent_recovered", count: 71 }]);
    expect(
      snapshot.pressureSummaries[0].ambientCount
      + typedSummary.majorDigest!.reduce((count, item) => count + item.count, 0),
    ).toBe(
      snapshot.pressureSummaries[0].lastCursor
      - snapshot.pressureSummaries[0].firstCursor
      + 1,
    );
    expect(runtime.cancelRequests).toBe(1);
    expect(snapshot.presentedCursor).toBe(0);
  });

  it("bounds repeated pressure summaries and chapters while retaining the newest exact ranges", () => {
    const { director } = setup();
    const base = singleMoment("C17", "speak");
    director.setPaused(true);
    let cursor = 0;
    for (let batch = 0; batch < 40; batch += 1) {
      const moments = Array.from({ length: 60 }, () => reCursorMoment(base, ++cursor));
      director.ingest(moments);
    }
    director.setPaused(false);
    for (let index = 0; index < 100; index += 1) {
      director.acceptIngressFault({
        kind: "cursor-gap",
        firstMissingCursor: 10_000 + index * 2,
        lastMissingCursor: 10_001 + index * 2,
      });
    }

    const snapshot = director.getSnapshot();
    expect(snapshot.pressureSummaries.length).toBeLessThanOrEqual(32);
    expect(snapshot.chapters.length).toBeLessThanOrEqual(32);
    expect(snapshot.pressureSummaries.at(-1)?.lastCursor).toBe(2_352);
    expect(snapshot.chapters.at(-1)).toMatchObject({
      firstCursor: 10_198,
      lastCursor: 10_199,
    });
  });

  it("rolls evicted overflow batches into one lossless bounded aggregate", () => {
    const { director } = setup();
    const base = singleMoment("C17", "speak");
    director.setPaused(true);
    let cursor = 0;
    for (let batch = 0; batch < 40; batch += 1) {
      director.ingest(Array.from({ length: 60 }, () => reCursorMoment(base, ++cursor)));
    }
    director.setPaused(false);

    const summaries = director.getSnapshot().pressureSummaries;
    const first = summaries[0];
    const majorCount = summaries.flatMap((summary) => summary.majorDigest)
      .reduce((count, item) => count + item.count, 0);
    expect(summaries).toHaveLength(32);
    expect(first).toMatchObject({ firstCursor: 1, lastCursor: 492, ambientCount: 0 });
    expect(first.majorDigest).toEqual([{ eventType: "speak", count: 492 }]);
    expect(majorCount).toBe(2_352);
    expect(summaries.at(-1)?.lastCursor).toBe(2_352);
  });

  it("keeps digest event types canonical and treats unknown future evidence as ambient", () => {
    const { director } = setup();
    const base = singleMoment("C17", "speak");
    const unknown = Array.from({ length: 60 }, (_, index) => {
      const moment = reCursorMoment(base, index + 1);
      const evidence = moment.evidence.map((entry) => ({
        ...entry,
        event: { ...entry.event, type: "future_observer_event" },
      }));
      return { ...moment, priority: "featured" as const, evidence, representative: evidence[0] };
    });
    director.setPaused(true);
    director.ingest(unknown);
    director.setPaused(false);
    const summary = director.getSnapshot().pressureSummaries[0];
    const canonical: readonly Readonly<{
      eventType: PresentedEventType;
      count: number;
    }>[] = summary.majorDigest;

    expect(canonical).toEqual([]);
    expect(summary.ambientCount).toBe(12);
    expect(summary.majorMomentIds).toEqual([]);
  });

  it("waits for Task 5 recovery after a pressure gap instead of auto-starting post-gap evidence", () => {
    const { director, clock, model } = setup();
    // A burst of stage-occupying moments: speech no longer creates pressure.
    const pressure = stagedBurst(120);
    director.ingest(pressure.slice(0, 1));
    director.setPaused(true);
    director.ingest(pressure.slice(1));
    director.setPaused(false);
    const active = director.getSnapshot().activeMoment!;

    clock.advanceTo(buildStoryProgram(active, 1).durationMs);

    expect(director.getSnapshot().presentedCursor).toBe(1);
    expect(model.getView().projectedThroughCursor).toBe(1);
    expect(director.getSnapshot().activeMoment).toBeNull();
    expect(director.getSnapshot().pending[0].firstCursor).toBeGreaterThan(2);
    expect(director.getSnapshot().backlog.state).toBe("overflow");
    clock.advanceBy(60_000);
    expect(model.getView().projectedThroughCursor).toBe(1);
  });

  it("does not coalesce protected travel, birth, death, recovery, proposal, home, or contest moments inside budget", () => {
    // `speak` is deliberately absent: since the two-lane split it is never
    // subject to the pressure policy at all, which is a stronger guarantee than
    // "protected from coalescing" and is covered by the utterance-lane tests.
    const kinds = [
      singleMoment("C12", "agent_entered_region"),
      singleMoment("C12", "agent_born"),
      singleMoment("C11", "agent_died"),
      singleMoment("C12", "agent_recovered"),
      singleMoment("C12", "mating_initiated"),
      singleMoment("C12", "home_built"),
      singleMoment("C07", "home_thieved"),
    ].map((moment, index) => ({
      ...moment,
      id: `protected-${index + 1}`,
      firstCursor: index + 1,
      lastCursor: index + 1,
      evidenceCursors: [index + 1],
      evidence: moment.evidence.map((entry) => ({ ...entry, cursor: index + 1 })),
      representative: { ...moment.representative, cursor: index + 1 },
    }));
    const { director } = setup();
    director.setPaused(true);
    director.ingest(kinds);
    director.setPaused(false);

    expect(director.getSnapshot().pressureSummaries).toEqual([]);
    expect([
      director.getSnapshot().activeMoment,
      ...director.getSnapshot().pending,
    ].map((moment) => moment?.id)).toEqual(kinds.map((moment) => moment.id));
  });

  it("coalesces only contiguous ambient pressure and accounts for every skipped moment", () => {
    const base = singleMoment("C12", "resource_changed");
    const ambient = Array.from({ length: 60 }, (_, index) => ({
      ...base,
      id: `ambient-${index + 1}`,
      firstCursor: index + 1,
      lastCursor: index + 1,
      evidenceCursors: [index + 1],
      evidence: base.evidence.map((entry) => ({ ...entry, cursor: index + 1 })),
      representative: { ...base.representative, cursor: index + 1 },
    }));
    const { director } = setup();
    director.setPaused(true);
    director.ingest(ambient);
    director.setPaused(false);

    const summary = director.getSnapshot().pressureSummaries[0];
    expect(summary.ambientCount).toBe(summary.lastCursor - summary.firstCursor + 1);
    expect(summary.majorMomentIds).toEqual([]);
  });

  it("hides future silent checkpoint truth until its cursor settles, then applies the exact cut", () => {
    const { director, clock, model, manifest } = setup();
    const checkpoint = checkpointAtOne(manifest.initialSnapshot, {
      line: 7,
      regionEnergy: 137,
    });
    const regionName = manifest.initialSnapshot.regions[0].name;
    const initialWorldTime = manifest.initialSnapshot.world_time;
    const initialRegionEnergy = manifest.initialSnapshot.regions[0].current_energy;
    director.ingest([stagedMoment(1)]);
    director.acceptCheckpoint(checkpoint);
    expect(model.getView()).toMatchObject({
      exactBaseCursor: 0,
      worldTime: initialWorldTime,
    });
    expect(model.getView().regions.find(({ value }) => value.name === regionName)?.value.current_energy).toBe(
      initialRegionEnergy,
    );

    clock.advanceTo(buildStoryProgram(director.getSnapshot().activeMoment!, 1).durationMs);
    expect(director.getSnapshot().presentedCursor).toBe(1);
    expect(model.getView()).toMatchObject({
      exactBaseCursor: 1,
      worldTime: initialWorldTime + 1,
    });
    expect(model.getView().regions.find(({ value }) => value.name === regionName)?.value.current_energy).toBe(137);
  });

  it("keeps a pending safe live checkpoint when a later archive-only record arrives", () => {
    const { director, clock, model, manifest } = setup();
    const regionName = manifest.initialSnapshot.regions[0].name;
    const safe = checkpointAtOne(manifest.initialSnapshot, {
      line: 7,
      regionEnergy: 137,
    });
    const unsafe = checkpointAtOne(manifest.initialSnapshot, {
      line: 99,
      safety: "archive-manual",
      regionEnergy: 3,
    });

    director.ingest([stagedMoment(1)]);
    director.acceptCheckpoint(safe);
    director.acceptCheckpoint(unsafe);
    clock.advanceTo(buildStoryProgram(director.getSnapshot().activeMoment!, 1).durationMs);

    expect(model.getView()).toMatchObject({
      exactBaseCursor: 1,
      worldTime: manifest.initialSnapshot.world_time + 1,
    });
    expect(model.getView().regions.find(({ value }) => value.name === regionName)?.value.current_energy).toBe(137);
  });

  it("presents C07 same-cursor checkpoint corrections in line order before the later contest", () => {
    const { director, clock, model, manifest } = setup({ manifestId: "C07" });
    const moments = new BeatDirector().group(manifest.entries);
    expect(moments.map(({ firstCursor, lastCursor }) => [firstCursor, lastCursor])).toEqual([
      [1, 2],
      [3, 4],
    ]);
    director.ingest(moments);
    director.acceptCheckpoint(manifest.checkpoints[0]!);
    director.acceptCheckpoint(manifest.checkpoints[1]!);

    settleActiveMoment(director, clock);

    const breached = director.getSnapshot().checkpointHold;
    expect(breached).toMatchObject({
      line: 1,
      eventCursor: 2,
      worldTime: 1_800_070_000,
      correctionEntityIds: ["home_c07", "wanderer_002"],
      elapsedMs: 0,
      remainingMs: breached?.durationMs,
    });
    expect(homeIntegrity(model, "home_c07")).toBe(25);
    expect(director.getSnapshot().activeMoment).toBeNull();
    expect(director.getSnapshot().pending[0]?.firstCursor).toBe(3);

    clock.advanceBy(breached!.durationMs - 1);
    expect(director.getSnapshot().checkpointHold?.line).toBe(1);
    expect(homeIntegrity(model, "home_c07")).toBe(25);

    clock.advanceBy(1);
    const repaired = director.getSnapshot().checkpointHold;
    expect(repaired).toMatchObject({
      line: 2,
      eventCursor: 2,
      worldTime: 1_800_070_001,
      correctionEntityIds: [
        "home_c07",
        "nirvana",
        "nirvana_east",
        "nirvana_west",
        "wanderer_001",
        "warm_springs",
      ],
      elapsedMs: 0,
      remainingMs: repaired?.durationMs,
    });
    expect(homeIntegrity(model, "home_c07")).toBe(35);
    expect(director.getSnapshot().activeMoment).toBeNull();

    clock.advanceBy(repaired!.durationMs);
    expect(director.getSnapshot().checkpointHold).toBeNull();
    expect(director.getSnapshot().activeMoment?.firstCursor).toBe(3);
  });

  it("falls back to one regional focus beat for C07's final agent-only checkpoint", () => {
    const { director, clock, manifest } = setup({ manifestId: "C07" });
    director.ingest(new BeatDirector().group(manifest.entries));
    for (const checkpoint of manifest.checkpoints) director.acceptCheckpoint(checkpoint);

    const finalTick = advanceToCheckpointHoldLine(director, clock, 3);

    expect(director.getSnapshot()).toMatchObject({
      presentedCursor: 4,
      activeMoment: null,
      pending: [],
    });
    expect(finalTick).toEqual({
      line: 3,
      eventCursor: 4,
      worldTime: 1_800_070_001,
      correctionEntityIds: ["wanderer_002", "wanderer_004"],
      elapsedMs: 0,
      durationMs: 800,
      remainingMs: 800,
      segmentElapsedMs: 0,
      segmentDurationMs: 800,
      segmentRemainingMs: 800,
      focusTarget: {
        regionId: "warm_springs",
        kind: "region",
        entityId: null,
        segmentIndex: 0,
        segmentCount: 1,
        removed: false,
      },
    });
  });

  it("presents the C09 tick checkpoint before higher-cursor moments at the same timestamp", () => {
    const { director, clock, model, manifest } = setup({ manifestId: "C09" });
    const moments = new BeatDirector().group(manifest.entries);
    director.ingest(moments);
    director.acceptCheckpoint(manifest.checkpoints[0]!);

    settleActiveMoment(director, clock);
    expect(director.getSnapshot().presentedCursor).toBe(1);
    expect(director.getSnapshot().checkpointHold).toBeNull();
    settleActiveMoment(director, clock);

    expect(director.getSnapshot().presentedCursor).toBe(2);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      line: 1,
      eventCursor: 2,
      worldTime: 1_800_090_001,
      correctionEntityIds: [
        "home_c09",
        "home_repair",
        "home_zero",
        "nirvana",
        "nirvana_east",
        "nirvana_west",
        "wanderer_001",
        "warm_springs",
      ],
    });
    expect(homeIntegrity(model, "home_repair")).toBe(60);
    expect(director.getSnapshot().activeMoment).toBeNull();
    expect(director.getSnapshot().pending[0]?.firstCursor).toBe(3);
  });

  it("sequences C09 structural checkpoint corrections as deterministic unscaled focus segments", () => {
    const { director, clock, manifest } = setup({ manifestId: "C09" });
    director.ingest(new BeatDirector().group(manifest.entries));
    director.acceptCheckpoint(manifest.checkpoints[0]!);
    director.acceptCheckpoint(manifest.checkpoints[1]!);

    const first = advanceToCheckpointHoldLine(director, clock, 1);
    expect(first).toMatchObject({
      line: 1,
      elapsedMs: 0,
      durationMs: 2_400,
      remainingMs: 2_400,
      segmentElapsedMs: 0,
      segmentDurationMs: 800,
      segmentRemainingMs: 800,
      focusTarget: {
        regionId: "warm_springs",
        kind: "home",
        entityId: "home_repair",
        segmentIndex: 0,
        segmentCount: 3,
        removed: false,
      },
    });

    clock.advanceBy(799);
    expect(clock.pendingCount()).toBe(1);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      elapsedMs: 799,
      segmentElapsedMs: 799,
      segmentRemainingMs: 1,
      focusTarget: { entityId: "home_repair", segmentIndex: 0 },
    });
    clock.advanceBy(1);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      elapsedMs: 800,
      segmentElapsedMs: 0,
      segmentRemainingMs: 800,
      focusTarget: {
        regionId: "nirvana",
        kind: "ruin",
        entityId: "home_c09",
        segmentIndex: 1,
        segmentCount: 3,
        removed: false,
      },
    });
    clock.advanceBy(800);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      elapsedMs: 1_600,
      focusTarget: {
        regionId: "nirvana",
        kind: "ruin",
        entityId: "home_zero",
        segmentIndex: 2,
        segmentCount: 3,
        removed: false,
      },
    });
    clock.advanceBy(799);
    expect(director.getSnapshot().checkpointHold?.line).toBe(1);
    clock.advanceBy(1);
    expect(director.getSnapshot().checkpointHold?.line).not.toBe(1);

    const second = advanceToCheckpointHoldLine(director, clock, 2);
    expect(second).toMatchObject({
      line: 2,
      elapsedMs: 0,
      durationMs: 1_600,
      remainingMs: 1_600,
      focusTarget: {
        regionId: "warm_springs",
        kind: "home",
        entityId: "home_repair",
        segmentIndex: 0,
        segmentCount: 2,
        removed: false,
      },
    });
    clock.advanceBy(800);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      line: 2,
      elapsedMs: 800,
      segmentElapsedMs: 0,
      segmentRemainingMs: 800,
      focusTarget: {
        regionId: "nirvana",
        kind: "region",
        entityId: null,
        segmentIndex: 1,
        segmentCount: 2,
        removed: true,
      },
    });
  });

  it("freezes a checkpoint correction hold while paused and never speed-compresses readability", () => {
    const { director, clock, manifest } = setup({ manifestId: "C07" });
    const travel = new BeatDirector().group(manifest.entries)[0]!;
    director.ingest([travel]);
    director.acceptCheckpoint(manifest.checkpoints[0]!);
    settleActiveMoment(director, clock);
    const durationMs = director.getSnapshot().checkpointHold!.durationMs;

    clock.advanceBy(200);
    director.setSpeed(2);
    expect(director.getSnapshot().checkpointHold).toMatchObject({
      line: 1,
      elapsedMs: 200,
      remainingMs: durationMs - 200,
    });
    clock.advanceBy(100);
    director.setPaused(true);
    const frozen = director.getSnapshot();
    expect(frozen.checkpointHold).toMatchObject({
      line: 1,
      elapsedMs: 300,
      remainingMs: durationMs - 300,
    });

    clock.advanceBy(5_000);
    expect(director.getSnapshot()).toBe(frozen);
    director.setPaused(false);
    clock.advanceBy(durationMs - 301);
    expect(director.getSnapshot().checkpointHold?.line).toBe(1);
    clock.advanceBy(1);
    expect(director.getSnapshot().checkpointHold).toBeNull();
  });

  it("deduplicates stale checkpoint lines and reports active overflow without mutating bounded ownership", () => {
    const { director, manifest } = setup({ manifestId: "C07" });
    const base = manifest.checkpoints[0]!;
    director.ingest([new BeatDirector().group(manifest.entries)[0]!]);
    for (let line = 1; line <= 64; line += 1) {
      expect(director.acceptCheckpoint({ ...base, line })).toBe("accepted");
    }
    expect(director.acceptCheckpoint({ ...base, line: 64 })).toBe("ignored");
    expect(director.acceptCheckpoint({ ...base, line: 12 })).toBe("ignored");

    expect(director.diagnostics()).toMatchObject({
      pendingCheckpoints: 64,
      ownedCheckpoints: 64,
      checkpointQueueLimit: 64,
      checkpointOverflow: null,
    });
    expect(director.acceptCheckpoint({ ...base, line: 65 })).toBe("overflow");
    expect(director.diagnostics()).toMatchObject({
      pendingCheckpoints: 64,
      ownedCheckpoints: 64,
      checkpointOverflow: {
        line: 65,
        digest: `65:${manifest.runId}:2:1800070000`,
      },
    });
  });

  it("compacts an arbitrarily long paused checkpoint burst to its newest audited safe cut", () => {
    const { director, clock, model, manifest } = setup({ manifestId: "C07" });
    const travel = new BeatDirector().group(manifest.entries)[0]!;
    director.setPaused(true);
    const frozen = director.getSnapshot();
    const modelBefore = model.getView();
    director.ingest([travel]);
    const base = manifest.checkpoints[0]!;
    for (let line = 1; line <= 100; line += 1) {
      expect(director.acceptCheckpoint({ ...base, line })).toBe(
        line === 1 ? "accepted" : "compacted",
      );
    }

    expect(director.getSnapshot()).toBe(frozen);
    expect(model.getView()).toBe(modelBefore);
    expect(director.diagnostics()).toMatchObject({
      pendingCheckpoints: 1,
      ownedCheckpoints: 1,
      checkpointCompaction: {
        count: 99,
        newestCompactedDigest: `99:${manifest.runId}:2:1800070000`,
      },
      checkpointOverflow: null,
    });

    director.setPaused(false);
    expect(director.getSnapshot().activeMoment?.lastCursor).toBe(2);
    settleActiveMoment(director, clock);
    expect(director.getSnapshot().checkpointHold?.line).toBe(100);
    expect(homeIntegrity(model, "home_c07")).toBe(25);
  });

  it("clears checkpoint queue, hold witness, and clock ownership on reset and dispose", () => {
    const resetting = setup({ manifestId: "C07" });
    const moments = new BeatDirector().group(resetting.manifest.entries);
    resetting.director.ingest(moments);
    resetting.director.acceptCheckpoint(resetting.manifest.checkpoints[0]!);
    resetting.director.acceptCheckpoint(resetting.manifest.checkpoints[1]!);
    settleActiveMoment(resetting.director, resetting.clock);
    expect(resetting.director.getSnapshot().checkpointHold?.line).toBe(1);
    expect(resetting.clock.pendingCount()).toBe(1);

    resetting.director.reset(
      { ...resetting.identity, revision: 2 },
      resetting.model,
      resetting.settlement,
    );
    expect(resetting.director.getSnapshot().checkpointHold).toBeNull();
    expect(resetting.director.diagnostics().pendingCheckpoints).toBe(0);
    expect(resetting.clock.pendingCount()).toBe(0);

    const disposing = setup({ manifestId: "C07" });
    const travel = new BeatDirector().group(disposing.manifest.entries)[0]!;
    disposing.director.ingest([travel]);
    disposing.director.acceptCheckpoint(disposing.manifest.checkpoints[0]!);
    settleActiveMoment(disposing.director, disposing.clock);
    disposing.director.dispose();
    expect(disposing.director.getSnapshot().checkpointHold).toBeNull();
    expect(disposing.director.diagnostics().pendingCheckpoints).toBe(0);
    expect(disposing.clock.pendingCount()).toBe(0);
  });

  it("integrates a late wall callback piecewise and preserves a twelve-second speech hold", () => {
    const lateClock = new LatePresentationClock();
    const manifest = getChronicleManifest("C12");
    const identity: FrameIdentity = {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 0,
    };
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const runtime = new ClocklessRuntime();
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    const director = new StoryDirector({ clock: lateClock, identity, model, settlement });
    // Speech used to supply the long hold this integrates across; it no longer
    // reaches the stage, so the hold window is read off the staged program.
    const staged = stagedMoment();
    director.ingest([staged]);
    director.setSpeed(2);
    const hold = buildStoryProgram(staged, 1).phaseWindows.find(
      (window) => window.phase === "hold",
    )!;

    lateClock.fireLateAt(hold.startMs + (hold.endMs - hold.startMs) / 2);

    expect(director.getSnapshot().phase).toBe("hold");
    expect(director.getSnapshot().presentedCursor).toBe(0);
  });

  it("reschedules a deterministic bounded clock retry after a publisher exception", () => {
    let publications = 0;
    const { director, clock, settlement } = setup({
      publish: () => {
        publications += 1;
        if (publications === 1) throw new Error("publisher unavailable");
        return 2;
      },
    });
    const moment = stagedMoment();
    director.ingest([moment]);
    const consequence = buildStoryProgram(moment, 1).phaseWindows.find(
      (window) => window.phase === "consequence",
    )!;

    expect(() => clock.advanceTo(consequence.startMs)).toThrow("publisher unavailable");
    expect(clock.pendingCount()).toBe(1);
    clock.advanceBy(99);
    expect(publications).toBe(1);
    clock.advanceBy(1);

    expect(publications).toBe(2);
    expect(settlement.getSnapshot().publishedRevision).toBe(2);
    expect(clock.pendingCount()).toBe(1);
  });

  it("schedules a positive sub-ULP causal remainder at a representably future wall instant", () => {
    const initialWallMs = 7_866.66666666664;
    const clock = createManualPresentationClock({
      initialNowMs: initialWallMs,
      maxCallbacksPerAdvance: 8,
    });
    const manifest = getChronicleManifest("C12");
    const identity: FrameIdentity = {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 0,
    };
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const runtime = createSceneExecutor();
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    const moment = reCursorMoment(singleMoment("C12", "agent_born"), 1);
    const program = subUlpBoundaryProgram(moment);
    const director = new StoryDirector({
      clock,
      identity,
      model,
      settlement,
      programResolver: { resolve: () => program },
    });

    director.ingest([moment]);
    clock.advanceTo(initialWallMs + 300);
    expect(settlement.getSnapshot()).toMatchObject({
      consequenceCommitted: true,
      publishedRevision: 2,
    });

    expect(() => clock.advanceTo(initialWallMs + 400)).not.toThrow();
    expect(runtime.snapshot().elapsedMs).toBeLessThan(400);
    expect(clock.pendingCount()).toBe(1);

    clock.advanceBy(Number.EPSILON * clock.now());
    expect(runtime.snapshot().elapsedMs).toBeGreaterThanOrEqual(400);
    expect(runtime.snapshot().acknowledgedCancelGeneration).toBe(0);
  });

  it("keeps the publication-unblocked deferred drain at the same wall instant", () => {
    const clock = new LatePresentationClock();
    const manifest = getChronicleManifest("C12");
    const identity: FrameIdentity = {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 0,
    };
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const runtime = createSceneExecutor();
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    const moment = reCursorMoment(singleMoment("C12", "agent_born"), 1);
    const program = subUlpBoundaryProgram(moment);
    const director = new StoryDirector({
      clock,
      identity,
      model,
      settlement,
      programResolver: { resolve: () => program },
    });

    director.ingest([moment]);
    clock.fireLateAt(600);
    expect(settlement.getSnapshot()).toMatchObject({
      consequenceCommitted: true,
      publishedRevision: 2,
      sceneSettled: false,
    });
    expect(runtime.snapshot().elapsedMs).toBe(300);
    expect(clock.pendingDeadlineMs()).toBe(clock.now());

    clock.fireLateAt(600);
    expect(runtime.snapshot()).toMatchObject({
      elapsedMs: 600,
      acknowledgedCancelGeneration: 0,
      settled: true,
    });
    expect(director.getSnapshot()).toMatchObject({
      presentedCursor: 1,
      activeMoment: null,
    });
  });

  it("reschedules the same bounded retry path after acknowledgement and cancellation failures", () => {
    const acknowledgement = setup();
    acknowledgement.runtime.acknowledgeFailures = 1;
    const first = stagedMoment();
    acknowledgement.director.ingest([first]);
    const consequence = buildStoryProgram(first, 1).phaseWindows.find(
      (window) => window.phase === "consequence",
    )!;
    expect(() => acknowledgement.clock.advanceTo(consequence.startMs)).toThrow(
      "runtime acknowledgement unavailable",
    );
    expect(acknowledgement.clock.pendingCount()).toBe(1);
    acknowledgement.clock.advanceBy(100);
    expect(acknowledgement.settlement.getSnapshot().publishedRevision).not.toBeNull();

    const cancellation = setup();
    cancellation.director.ingest([stagedMoment(1)]);
    cancellation.director.setPaused(true);
    cancellation.runtime.cancelFailures = 1;
    expect(() => cancellation.director.ingest(new BeatDirector().group(
      getChronicleManifest("C13").entries.slice(1),
    ))).toThrow("runtime cancellation unavailable");
    expect(cancellation.clock.pendingCount()).toBe(1);
    cancellation.clock.advanceBy(100);
    expect(cancellation.runtime.cancelRequests).toBe(1);
  });

  it("defers a checkpoint while a queued post-gap moment has an earlier event timestamp", () => {
    const { director, clock, model, manifest } = setup();
    const earlyTime = manifest.initialSnapshot.world_time + 0.5;
    const pressure = stagedBurst(120).map((moment) => retimeMoment(moment, earlyTime));
    director.ingest(pressure.slice(0, 1));
    director.setPaused(true);
    director.ingest(pressure.slice(1));
    director.setPaused(false);
    clock.advanceTo(buildStoryProgram(director.getSnapshot().activeMoment!, 1).durationMs);
    expect(director.getSnapshot().presentedCursor).toBe(1);

    director.acceptCheckpoint(checkpointAtOne(manifest.initialSnapshot));

    expect(model.getView().exactBaseCursor).toBe(0);
  });

  it("records ingress faults without advancing truth and requests safe cancellation", () => {
    const { director, runtime } = setup();
    director.ingest([stagedMoment(1)]);
    director.acceptIngressFault({ kind: "cursor-gap", firstMissingCursor: 2, lastMissingCursor: 9 });

    expect(director.getSnapshot().chapters).toEqual([{
      firstCursor: 2,
      lastCursor: 9,
      chapter: "world-moved-ahead",
      archiveAvailable: true,
    }]);
    expect(director.getSnapshot().presentedCursor).toBe(0);
    expect(runtime.cancelRequests).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // BUBBLES-FIX 2026-08-21 — a RETRYABLE checkpoint-poll failure must not silence
  // the world. Measured on the recorded run through the production observer: one
  // `{ kind: "unavailable", retryable: true }` fault latched `recoveryRequired`,
  // which gates `drainUtterances`, so the non-blocking overlay lane died; the
  // queue then overflowed every ~40s and `applyPressurePolicy` discarded ~30
  // `speak`s at a time. 93% of a run is utterances, so the world went silent and
  // the killfeed read `0 shown · 0 held · N aged out`.
  // ---------------------------------------------------------------------------

  it("keeps the utterance lane draining through a retryable checkpoint-poll fault", () => {
    const { director } = setup();
    const utterance = (cursor: number) => reCursorMoment(singleMoment("C17", "speak"), cursor);

    director.acceptIngressFault({ kind: "unavailable", line: null, retryable: true });
    director.ingest([utterance(1), utterance(2), utterance(3)]);

    const snapshot = director.getSnapshot();
    expect(snapshot.utterances.length).toBe(3);
    expect(snapshot.pending).toEqual([]);
    expect(snapshot.presentedCursor).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // CONVERSATIONAL STAGING 2026-08-22 — beings talking to each other stand
  // together. The rule itself lives in `conversationStaging.ts` and is tested
  // there against real terrain; what is tested HERE is the director's half: the
  // words wait for the feet, they wait in order, they are never lost, and the
  // walk is published the instant it is decided rather than with the words.
  // ---------------------------------------------------------------------------

  it("publishes an approach at once and holds its words until the feet arrive", () => {
    const staging = stubStaging({ delayMs: 2_000 });
    const { director, clock } = setup({ conversationStaging: staging });

    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 1)]);

    // The walk is out immediately ...
    const started = director.getSnapshot();
    expect(started.staging.map((beat) => beat.id)).toEqual(["stub:1:approach"]);
    // ... and the words are not.
    expect(started.utterances).toEqual([]);
    // The evidence and the cursor are NOT delayed with them: only the bubble is.
    expect(started.presentedCursor).toBe(1);

    clock.advanceBy(1_999);
    expect(director.getSnapshot().utterances).toEqual([]);

    clock.advanceBy(1);
    const arrived = director.getSnapshot();
    expect(arrived.utterances).toHaveLength(1);
    expect(arrived.staging.map((beat) => beat.id))
      .toEqual(["stub:1:approach", "stub:1:face"]);
  });

  it("raises an unstaged line with no delay at all", () => {
    const staging = stubStaging({ delayMs: 0 });
    const { director } = setup({ conversationStaging: staging });

    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 1)]);

    expect(director.getSnapshot().utterances).toHaveLength(1);
  });

  it("keeps a held line ahead of the lines drained behind it", () => {
    const staging = stubStaging({ delayMs: 2_000, stageCursors: [1] });
    const { director, clock } = setup({ conversationStaging: staging });

    director.ingest([
      reCursorMoment(singleMoment("C17", "speak"), 1),
      reCursorMoment(singleMoment("C17", "speak"), 2),
      reCursorMoment(singleMoment("C17", "speak"), 3),
    ]);

    // Nothing jumps the queue: an ordered feed is worth a bounded lag.
    expect(director.getSnapshot().utterances).toEqual([]);
    clock.advanceBy(2_000);
    expect(director.getSnapshot().utterances.map((utterance) => utterance.cursor))
      .toEqual([1, 2, 3]);
  });

  it("raises every held word when a paused view resumes", () => {
    const staging = stubStaging({ delayMs: 2_000 });
    const { director, clock } = setup({ conversationStaging: staging });
    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 1)]);
    director.setPaused(true);

    clock.advanceBy(10_000);
    // A paused view is frozen: the words must not appear behind its back.
    expect(director.getSnapshot().utterances).toEqual([]);

    director.setPaused(false);
    expect(director.getSnapshot().utterances).toHaveLength(1);
  });

  it("tells staging which bodies the active scene already owns", () => {
    const staging = stubStaging({ delayMs: 0 });
    const moment = singleMoment("C12", "agent_born");
    const base = buildStoryProgram(moment, 1);
    const occupied = {
      ...base,
      id: "occupied:program",
      phases: base.phases.map((phase) => ({
        ...phase,
        actorIntents: phase.phase === "recover"
          ? [{ actorId: "wanderer_003", kind: "orient" as const, target: { x: 8, y: 8 }, marker: null }]
          : [],
      })),
    };
    const { director } = setup({
      conversationStaging: staging,
      programResolver: { resolve: () => occupied },
    });

    director.ingest([moment]);
    expect(director.getSnapshot().activeMoment).not.toBeNull();
    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 2)]);

    // Every phase counts, not merely the one on screen: a scene that will move
    // a being in its recover phase owns that being now.
    expect([...staging.seen.at(-1)!.busyBeingIds]).toEqual(["wanderer_003"]);
  });

  it("still raises the words when a staging decision throws", () => {
    // Spatial truth can be mid-replacement. A lane that let that escape would
    // reach the ingress isolation catch and take 93% of a run's beats with it.
    const staging: ConversationStaging = {
      reset: () => undefined,
      stage: () => {
        throw new Error("placement generation is being replaced");
      },
    };
    const { director } = setup({ conversationStaging: staging });

    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 1)]);

    expect(director.getSnapshot().utterances).toHaveLength(1);
    expect(director.getSnapshot().staging).toEqual([]);
    expect(director.getSnapshot().presentedCursor).toBe(1);
  });

  it("drops in-flight staging when the run is replaced", () => {
    const staging = stubStaging({ delayMs: 5_000 });
    const { director, clock, identity, manifest } = setup({ conversationStaging: staging });
    director.ingest([reCursorMoment(singleMoment("C17", "speak"), 1)]);
    expect(director.getSnapshot().staging).toHaveLength(1);

    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime: new ClocklessRuntime(),
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    director.reset({ ...identity, revision: identity.revision + 1 }, model, settlement);

    expect(staging.resets).toBe(1);
    expect(director.getSnapshot().staging).toEqual([]);
    clock.advanceBy(10_000);
    // Words belonging to a run this director no longer presents are gone with it.
    expect(director.getSnapshot().utterances).toEqual([]);
  });

  it("does not safe-cancel the running scene for a retryable checkpoint-poll fault", () => {
    const { director, runtime } = setup();
    director.ingest([stagedMoment(1)]);
    expect(director.getSnapshot().activeMoment).not.toBeNull();

    director.acceptIngressFault({ kind: "unavailable", line: null, retryable: true });

    expect(runtime.cancelRequests).toBe(0);
    expect(director.getSnapshot().activeMoment).not.toBeNull();
  });

  it("reports a retryable ingress fault rather than absorbing it silently", () => {
    const { director } = setup();
    expect(director.diagnostics().retryableIngressFaults).toBe(0);

    director.acceptIngressFault({ kind: "unavailable", line: null, retryable: true });
    director.acceptIngressFault({ kind: "unavailable", line: null, retryable: true });

    expect(director.diagnostics().retryableIngressFaults).toBe(2);
    expect(director.diagnostics().recoveryRequired).toBe(false);
    expect(director.diagnostics().lastRetryableIngressFault).toEqual({ kind: "unavailable", line: null });
    // The other lane-stopping bound is published for the same reason: it is invisible otherwise.
    expect(director.diagnostics().deferredUtteranceEvidence).toBe(0);
  });

  it("still demands recovery, and stops the lanes, for a NON-retryable checkpoint fault", () => {
    const { director, runtime } = setup();
    const utterance = (cursor: number) => reCursorMoment(singleMoment("C17", "speak"), cursor);
    director.ingest([stagedMoment(1)]);

    director.acceptIngressFault({ kind: "run-mismatch", line: 7, retryable: false });
    director.ingest([utterance(2), utterance(3)]);

    expect(runtime.cancelRequests).toBe(1);
    expect(director.diagnostics().recoveryRequired).toBe(true);
    expect(director.getSnapshot().pending.length).toBe(2);
    expect(director.getSnapshot().presentedCursor).toBe(0);
  });

  it("rejects a stale reset identity and resets atomically to a newer revision", () => {
    const { director, identity, model, settlement } = setup();
    expect(() => director.reset(identity, model, settlement)).toThrow("reset identity is stale");
    const newer = { ...identity, revision: 2 };

    director.reset(newer, model, settlement);

    expect(director.getSnapshot()).toMatchObject({
      identity: newer,
      ingestedCursor: 0,
      presentedCursor: 0,
      activeMoment: null,
      pending: [],
    });
  });

  it("rejects an idle reset whose coordinator still owns a different model", () => {
    const { director, identity, settlement, manifest } = setup();
    const newer = { ...identity, revision: 2 };
    const replacementModel = new PresentedWorldModel(manifest.initialSnapshot, newer);

    expect(() => director.reset(newer, replacementModel, settlement)).toThrow(
      "settlement coordinator must own the reset model",
    );
    expect(director.getSnapshot().identity).toEqual(identity);
  });

  it("rejects an active reset that tries to reuse its unsettled coordinator", () => {
    const { director, identity, model, settlement } = setup();
    director.ingest([stagedMoment(1)]);
    const before = director.getSnapshot();

    expect(() => director.reset(
      { ...identity, revision: 2 },
      model,
      settlement,
    )).toThrow("active reset requires a fresh settlement coordinator");

    expect(director.getSnapshot()).toMatchObject({
      identity,
      activeMoment: before.activeMoment,
      presentedCursor: 0,
    });
  });

  it("replaces an active scene atomically when reset receives a fresh coordinator", () => {
    const { director, identity, model, runtime, manifest } = setup();
    director.ingest(new BeatDirector().group(manifest.entries.slice(0, 1)));
    const replacementRuntime = new ClocklessRuntime();
    const replacement = new SceneSettlementCoordinator({
      model,
      runtime: replacementRuntime,
      publishConsequenceFrame: () => 3,
      onSettlementComplete: () => undefined,
    });
    const newer = { ...identity, revision: 2 };

    director.reset(newer, model, replacement);

    expect(runtime.disposed).toBe(true);
    expect(replacementRuntime.disposed).toBe(false);
    expect(director.getSnapshot()).toMatchObject({
      identity: newer,
      activeMoment: null,
      pending: [],
      presentedCursor: 0,
    });
  });

  it("releases a hold requested reentrantly at settlement and starts the next story", () => {
    const manifest = getChronicleManifest("C12");
    const identity: FrameIdentity = {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 0,
    };
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const runtime = new ClocklessRuntime();
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    let director: StoryDirector;
    settlement.subscribe(() => {
      if (settlement.getSnapshot().sceneSettled) director.holdCurrentMoment(true);
    });
    const clock = createManualPresentationClock();
    director = new StoryDirector({ clock, identity, model, settlement });
    director.ingest([stagedMoment(1), stagedMoment(2)]);
    clock.advanceTo(buildStoryProgram(director.getSnapshot().activeMoment!, 1).durationMs);
    expect(director.getSnapshot().activeMoment).toBeNull();

    director.holdCurrentMoment(false);

    expect(director.getSnapshot().activeMoment?.firstCursor).toBe(2);
  });

  it("installs provisional active truth before begin-time subscribers settle the scene", () => {
    const manifest = getChronicleManifest("C12");
    const identity: FrameIdentity = {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 0,
    };
    const model = new PresentedWorldModel(manifest.initialSnapshot, identity);
    const runtime = new ScriptOnBeginRuntime();
    const settlement = new SceneSettlementCoordinator({
      model,
      runtime,
      publishConsequenceFrame: () => 2,
      onSettlementComplete: () => undefined,
    });
    let injected = false;
    settlement.subscribe(() => {
      const token = settlement.getSnapshot().sceneToken;
      if (injected || token === null) return;
      injected = true;
      runtime.signals.push(
        { kind: "consequence-marker", sceneToken: token, marker: "consequence-published" },
        { kind: "safe-cancel-ack", sceneToken: token, cancelApplied: false, cancelGeneration: 0 },
        { kind: "scene-settled", sceneToken: token },
      );
      settlement.advance(100_000);
    });
    const director = new StoryDirector({
      clock: createManualPresentationClock(),
      identity,
      model,
      settlement,
    });
    director.ingest(new BeatDirector().group(manifest.entries.slice(0, 1)));

    expect(director.getSnapshot()).toMatchObject({
      presentedCursor: 1,
      activeMoment: null,
      pending: [],
    });
    expect(model.getView().projectedThroughCursor).toBe(1);
  });

  it("preflights an entire ingest batch before mutating cursor or queue state", () => {
    const { director } = setup();
    const valid = reCursorMoment(singleMoment("C17", "speak"), 1);
    const invalid = reCursorMoment(singleMoment("C17", "speak"), 3);

    expect(() => director.ingest([valid, invalid])).toThrow(
      "expected next story cursor 2, received 3",
    );
    expect(director.getSnapshot()).toMatchObject({
      ingestedCursor: 0,
      activeMoment: null,
      pending: [],
    });
  });

  it("keeps a scene queued when runtime start fails so a later resume can retry atomically", () => {
    const { director, runtime } = setup();
    const moment = stagedMoment();
    runtime.startFailures = 1;

    expect(() => director.ingest([moment])).toThrow("runtime start unavailable");
    expect(director.getSnapshot()).toMatchObject({
      ingestedCursor: 1,
      activeMoment: null,
      pending: [moment],
    });
    director.setPaused(true);
    director.setPaused(false);
    expect(director.getSnapshot().activeMoment).toEqual(moment);
  });

  it("isolates StoryDirector subscribers so one failure cannot hide state from peers", () => {
    const { director } = setup();
    let healthyNotifications = 0;
    director.subscribe(() => {
      throw new Error("subscriber failed");
    });
    director.subscribe(() => {
      healthyNotifications += 1;
    });

    expect(() => director.setSpeed(1.5)).not.toThrow();
    expect(healthyNotifications).toBe(1);
  });

  it("disposes the sole clock handle and the clockless runtime", () => {
    const { director, runtime, clock } = setup();
    director.ingest([stagedMoment(1)]);
    expect(clock.pendingCount()).toBe(1);

    director.dispose();

    expect(clock.pendingCount()).toBe(0);
    expect(runtime.disposed).toBe(true);
  });
});

/**
 * A moment that still occupies a body, re-cursored to `cursor`.
 *
 * Since the 2026-07-31 two-lane split, `speak` and `self_talk` are display-only:
 * the director clears them onto the utterance overlay without a stage lease, so
 * a speech moment can no longer stand in for "a moment on the stage" the way it
 * did throughout these tests. Every test whose subject is the STAGE (holds,
 * resets, clock retries, checkpoints, pressure) now names a moment that takes
 * one; the tests whose subject is speech still use speech.
 */
function stagedMoment(cursor = 1) {
  return reCursorMoment(singleMoment("C12", "agent_recovered"), cursor);
}

/** A contiguous burst of stage-occupying moments — C13's shape, in the right lane. */
function stagedBurst(count: number, startCursor = 1) {
  return Array.from({ length: count }, (_, index) => stagedMoment(startCursor + index));
}

/**
 * A conversational-staging double that decides by cursor, not by geometry.
 *
 * The real rule is proven against real terrain in `conversationStaging.test.ts`.
 * Here the director's own contract is what is under test, so the decision is
 * made trivial and the timing is made exact.
 */
function stubStaging(options: {
  readonly delayMs: number;
  readonly stageCursors?: readonly number[];
}): ConversationStaging & {
  readonly seen: readonly ConversationStagingInput[];
  readonly resets: number;
} {
  const seen: ConversationStagingInput[] = [];
  let resets = 0;
  return {
    get seen() {
      return seen;
    },
    get resets() {
      return resets;
    },
    reset() {
      resets += 1;
    },
    stage(input: ConversationStagingInput): ConversationStagingDecision {
      seen.push(input);
      const staged = options.stageCursors === undefined
        || options.stageCursors.includes(input.utterance.cursor);
      if (!staged || options.delayMs === 0) {
        return Object.freeze({
          beats: Object.freeze([]),
          arrivalBeats: Object.freeze([]),
          delayMs: 0,
          outcome: "already-together" as const,
        });
      }
      const listenerId = input.utterance.targetId ?? input.utterance.beingId;
      return Object.freeze({
        beats: Object.freeze([Object.freeze({
          id: `stub:${input.utterance.cursor}:approach`,
          kind: "approach" as const,
          beingId: listenerId,
          regionId: "spring",
          waypoints: Object.freeze([{ x: 0, y: 0 }, { x: 32, y: 0 }]),
        })]),
        arrivalBeats: Object.freeze([Object.freeze({
          id: `stub:${input.utterance.cursor}:face`,
          kind: "face" as const,
          beingId: listenerId,
          regionId: "spring",
          facing: "east" as const,
        })]),
        delayMs: options.delayMs,
        outcome: "approach" as const,
      });
    },
  };
}

function singleMoment(id: "C07" | "C11" | "C12" | "C17", type: string) {
  const entry = getChronicleManifest(id).entries.find((candidate) => candidate.event.type === type);
  if (entry === undefined) throw new Error(`${id} lacks ${type}`);
  return new BeatDirector().group([{ ...entry, cursor: 1 }])[0];
}

function checkpointAtOne(
  snapshot: ReturnType<typeof getChronicleManifest>["initialSnapshot"],
  options: Readonly<{
    line?: number;
    safety?: ClassifiedCheckpointRecord["safety"];
    regionEnergy?: number;
  }> = {},
): ClassifiedCheckpointRecord {
  const safety = options.safety ?? "safe-world-tick";
  const checkpointSnapshot = structuredClone(snapshot);
  if (options.regionEnergy !== undefined) {
    checkpointSnapshot.regions[0] = {
      ...checkpointSnapshot.regions[0],
      current_energy: options.regionEnergy,
    };
  }
  return {
    line: options.line ?? 1,
    safety,
    checkpoint: {
      schema: 1,
      type: "world_snapshot_checkpoint",
      run_id: snapshot.run_id,
      world_time: snapshot.world_time + 1,
      event_cursor: 1,
      reason: safety === "safe-world-tick"
        ? "world_tick"
        : safety === "archive-manual"
          ? "manual"
          : "event:speak",
      snapshot: {
        ...checkpointSnapshot,
        world_time: snapshot.world_time + 1,
        event_cursor: 1,
      },
    },
  };
}

function settleActiveMoment(
  director: StoryDirector,
  clock: ReturnType<typeof createManualPresentationClock>,
): void {
  const moment = director.getSnapshot().activeMoment;
  if (moment === null) throw new Error("expected an active story moment");
  clock.advanceBy(buildStoryProgram(moment, 1).durationMs);
}

function advanceToCheckpointHoldLine(
  director: StoryDirector,
  clock: ReturnType<typeof createManualPresentationClock>,
  line: number,
): NonNullable<ReturnType<StoryDirector["getSnapshot"]>["checkpointHold"]> {
  for (let step = 0; step < 32; step += 1) {
    const snapshot = director.getSnapshot();
    if (snapshot.checkpointHold?.line === line) return snapshot.checkpointHold;
    if (snapshot.checkpointHold !== null) {
      clock.advanceBy(snapshot.checkpointHold.segmentRemainingMs ?? snapshot.checkpointHold.remainingMs);
      continue;
    }
    if (snapshot.activeMoment !== null) {
      settleActiveMoment(director, clock);
      continue;
    }
    throw new Error(`checkpoint line ${line} cannot advance from an idle director`);
  }
  throw new Error(`checkpoint line ${line} did not become active within the bounded test walk`);
}

function homeIntegrity(model: PresentedWorldModel, homeId: string): number | undefined {
  return model.getView().homes.find(({ value }) => value.home_id === homeId)?.value.integrity;
}

function retimeMoment(
  moment: ReturnType<BeatDirector["group"]>[number],
  timestamp: number,
): ReturnType<BeatDirector["group"]>[number] {
  const evidence = moment.evidence.map((entry) => ({
    ...entry,
    event: { ...entry.event, timestamp },
  }));
  const representativeIndex = moment.evidence.findIndex(
    (entry) => entry.cursor === moment.representative.cursor,
  );
  return {
    ...moment,
    evidence,
    representative: evidence[representativeIndex],
  };
}

function reCursorMoment(
  moment: ReturnType<BeatDirector["group"]>[number],
  cursor: number,
): ReturnType<BeatDirector["group"]>[number] {
  const evidence = moment.evidence.map((entry) => ({
    ...entry,
    cursor,
    event: { ...entry.event, timestamp: cursor },
  }));
  return {
    ...moment,
    id: `${cursor}:${cursor}:single`,
    firstCursor: cursor,
    lastCursor: cursor,
    evidenceCursors: [cursor],
    evidence,
    representative: evidence[0],
  };
}

function withSpeechLength(
  moment: ReturnType<BeatDirector["group"]>[number],
  length: number,
): ReturnType<BeatDirector["group"]>[number] {
  const evidence = moment.evidence.map((entry) => ({
    ...entry,
    event: {
      ...entry.event,
      payload: { ...entry.event.payload, message: "x".repeat(length) },
    },
  }));
  return { ...moment, evidence, representative: evidence[0] };
}

function subUlpBoundaryProgram(
  moment: ReturnType<BeatDirector["group"]>[number],
): SceneRuntimeProgram {
  const base = buildStoryProgram(moment, 1);
  const windows = ([
    ["enter", 0, 200],
    ["hold", 200, 300],
    ["consequence", 300, 400],
    ["recover", 400, 500],
    ["exit", 500, 600],
  ] as const).map(([phase, startMs, endMs]) => Object.freeze({ phase, startMs, endMs }));
  const phases = windows.map((window, index) => Object.freeze({
    ...base.phases[index]!,
    phase: window.phase,
  }));
  return Object.freeze({
    ...base,
    id: "story:sub-ulp-boundary",
    phases: Object.freeze(phases),
    phaseWindows: Object.freeze(windows),
    markers: Object.freeze([
      Object.freeze({ name: "contact", atMs: 200, order: 0, role: "contact" as const, optional: false }),
      Object.freeze({ name: "truth", atMs: 300, order: 0, role: "consequence" as const, optional: false }),
      Object.freeze({ name: "safe", atMs: 400, order: 0, role: "safe-cancel" as const, optional: false }),
      Object.freeze({ name: "final-safe", atMs: 600, order: 0, role: "safe-cancel" as const, optional: false }),
      Object.freeze({ name: "settled", atMs: 600, order: 1, role: "settle" as const, optional: false }),
    ]),
    durationMs: 600,
    consequenceMarker: "truth",
    safeCancelMarkers: Object.freeze(["safe", "final-safe"]),
  });
}

class LatePresentationClock implements PresentationClock {
  private current = 0;
  private callback: (() => void) | null = null;
  private deadlineMs: number | null = null;

  now(): number {
    return this.current;
  }

  schedule(deadlineMs: number, callback: () => void): () => void {
    this.callback = callback;
    this.deadlineMs = deadlineMs;
    return () => {
      if (this.callback !== callback) return;
      this.callback = null;
      this.deadlineMs = null;
    };
  }

  pendingDeadlineMs(): number | null {
    return this.deadlineMs;
  }

  fireLateAt(nowMs: number): void {
    this.current = nowMs;
    const callback = this.callback;
    this.callback = null;
    this.deadlineMs = null;
    callback?.();
  }
}

class ScriptOnBeginRuntime implements SceneRuntimePort {
  readonly signals: SceneRuntimeSignal[] = [];

  start(): number {
    return 1;
  }

  advance(): readonly SceneRuntimeSignal[] {
    return this.signals.splice(0);
  }

  acknowledgePublishedConsequence(): void {}

  requestSafeCancel(): void {}

  nextDeadlineMs(): number | null {
    return null;
  }

  dispose(): void {}
}
