import { describe, expect, it } from "vitest";

import {
  IDLE_LAUNCH,
  launchPollDelayMs,
  reduceLaunch,
  type LaunchAction,
  type LaunchPhase,
} from "./startSequence";

function run(actions: readonly LaunchAction[], from: LaunchPhase = IDLE_LAUNCH): LaunchPhase {
  return actions.reduce(reduceLaunch, from);
}

const accepted: LaunchAction = {
  kind: "accepted",
  runId: "run-1",
  atMs: 1_000,
  warnings: ["Every being begins alone in a different region."],
};

describe("reduceLaunch", () => {
  it("starts idle and moves to submitting", () => {
    expect(IDLE_LAUNCH.kind).toBe("idle");
    expect(reduceLaunch(IDLE_LAUNCH, { kind: "submit" }).kind).toBe("submitting");
  });

  it("waits after a 202 rather than claiming the world is alive", () => {
    const phase = run([{ kind: "submit" }, accepted]);

    expect(phase).toEqual({
      kind: "waiting",
      runId: "run-1",
      status: "starting",
      startedAtMs: 1_000,
      elapsedMs: 0,
      polls: 0,
      consecutiveFailures: 0,
      patienceExhausted: false,
      lastFailure: null,
      warnings: ["Every being begins alone in a different region."],
    });
  });

  it("keeps waiting while the world reports starting, tracking elapsed time", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "starting", atMs: 3_400 },
    ]);

    expect(phase.kind).toBe("waiting");
    expect(phase).toMatchObject({ elapsedMs: 2_400, polls: 1, status: "starting" });
    // The cautions were about this world; they stay readable for as long as the
    // viewer is waiting on it, not just for the instant the 202 landed.
    expect(phase).toMatchObject({
      warnings: ["Every being begins alone in a different region."],
    });
  });

  it("enters the world only when the world says it is running", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "starting", atMs: 2_000 },
      { kind: "polled", runId: "run-1", status: "running", atMs: 4_000 },
    ]);

    expect(phase).toEqual({ kind: "live", runId: "run-1" });
  });

  it("adopts a replacement run id reported by the world", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-2", status: "running", atMs: 4_000 },
    ]);

    expect(phase).toEqual({ kind: "live", runId: "run-2" });
  });

  it("keeps waiting on a status it does not recognise", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "unknown", atMs: 2_000 },
    ]);

    expect(phase.kind).toBe("waiting");
  });

  it("fails when the world reports failed", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "failed", atMs: 2_000 },
    ]);

    expect(phase.kind).toBe("failed");
    expect(phase).toMatchObject({ message: expect.stringMatching(/could not/i) });
  });

  it("fails when the world ended before it was ever watched", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "stopped", atMs: 2_000 },
    ]);

    expect(phase.kind).toBe("failed");
    expect(phase).toMatchObject({ message: expect.stringMatching(/ended/i) });
  });

  it("survives a transient poll failure — a world coming up is not a world that failed", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "poll-failed", atMs: 2_000, message: "network down" },
      { kind: "poll-failed", atMs: 3_000, message: "network down" },
      { kind: "polled", runId: "run-1", status: "running", atMs: 4_000 },
    ]);

    expect(phase).toEqual({ kind: "live", runId: "run-1" });
  });

  it("gives up only after the failures stop being transient", () => {
    const failures: LaunchAction[] = Array.from({ length: 6 }, (_, index) => ({
      kind: "poll-failed",
      atMs: 2_000 + index * 1_000,
      message: "network down",
    }));

    const phase = run([{ kind: "submit" }, accepted, ...failures]);

    expect(phase.kind).toBe("failed");
    expect(phase).toMatchObject({ message: expect.stringContaining("network down") });
  });

  it("clears the failure count once the world answers again", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "poll-failed", atMs: 2_000, message: "down" },
      { kind: "polled", runId: "run-1", status: "starting", atMs: 3_000 },
    ]);

    expect(phase).toMatchObject({ consecutiveFailures: 0, lastFailure: null });
  });

  it("admits when a world is taking longer than it should, without lying about it", () => {
    const phase = run([
      { kind: "submit" },
      accepted,
      { kind: "polled", runId: "run-1", status: "starting", atMs: 91_000 },
    ]);

    expect(phase).toMatchObject({ kind: "waiting", patienceExhausted: true });
  });

  it("carries the server's per-field complaints back to the screen", () => {
    const phase = run([
      { kind: "submit" },
      {
        kind: "rejected",
        message: "the world would not start",
        fieldErrors: [{ field: "abundance", message: "too high" }],
      },
    ]);

    expect(phase).toEqual({
      kind: "rejected",
      message: "the world would not start",
      fieldErrors: [{ field: "abundance", message: "too high" }],
    });
  });

  it("returns to idle so the conditions can be edited and tried again", () => {
    const phase = run([{ kind: "submit" }, { kind: "failed", message: "no" }, { kind: "reset" }]);

    expect(phase).toEqual(IDLE_LAUNCH);
  });

  it("ignores a poll that arrives when nothing is waiting", () => {
    expect(reduceLaunch(IDLE_LAUNCH, { kind: "polled", runId: "r", status: "running", atMs: 1 }))
      .toEqual(IDLE_LAUNCH);
  });
});

describe("launchPollDelayMs", () => {
  it("asks often at first and then backs off, so a slow world is not hammered", () => {
    expect(launchPollDelayMs(0)).toBe(400);
    expect(launchPollDelayMs(1)).toBe(600);
    expect(launchPollDelayMs(2)).toBe(900);
    expect(launchPollDelayMs(3)).toBe(1_350);
  });

  it("never backs off past a ceiling, so a world that comes up is noticed quickly", () => {
    expect(launchPollDelayMs(40)).toBe(3_000);
  });
});
