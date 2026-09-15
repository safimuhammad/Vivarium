import { describe, expect, it } from "vitest";

import {
  AUTO_CAMERA_DWELL_MS,
  AUTO_CAMERA_QUIET_MS,
  AUTO_CAMERA_RETURN_COOLDOWN_MS,
  createAutoCameraDirectorState,
  rebaseAutoCameraDirector,
  resolveAutoCamera,
  type AutoCameraDirectorState,
} from "./AutoCameraDirector";

type ScenePhase = "enter" | "hold" | "consequence" | "recover" | "exit";

function activity(
  regionId: string,
  momentId: string,
  eventType: string,
  phase: ScenePhase = "hold",
  subjectId: string | null = "traveler",
) {
  return { regionId, momentId, eventType, phase, subjectId };
}

function advance(
  state: AutoCameraDirectorState,
  input: Readonly<{
    nowMs: number;
    currentRegionId: string | null;
    activity?: ReturnType<typeof activity> | null;
  }>,
) {
  return resolveAutoCamera(state, {
    lineageKey: "live:run-a",
    nowMs: input.nowMs,
    currentRegionId: input.currentRegionId,
    activity: input.activity ?? null,
  });
}

describe("AutoCameraDirector", () => {
  it("keeps an explicit initial Auto rebase through the first live lineage", () => {
    const rebased = rebaseAutoCameraDirector(createAutoCameraDirectorState(), "spring", 100);
    const bound = advance(rebased, {
      nowMs: 101,
      currentRegionId: "spring",
      activity: activity("worn", "remote-1", "resource_changed"),
    });
    expect(bound.decision).toMatchObject({
      regionId: "spring", switchRequested: false, reason: "dwell",
    });
    expect(bound.next.enteredAtMs).toBe(100);
    expect(bound.next.lineageKey).toBe("live:run-a");

    const later = advance(bound.next, {
      nowMs: 100 + AUTO_CAMERA_DWELL_MS,
      currentRegionId: "spring",
      activity: activity("worn", "remote-2", "resource_changed"),
    });
    expect(later.decision).toMatchObject({ regionId: "worn", switchRequested: true });
  });

  it("starts fresh for a different known run after a viewer rebase", () => {
    const firstRun = advance(createAutoCameraDirectorState(), {
      nowMs: 0, currentRegionId: "spring",
    });
    const rebased = rebaseAutoCameraDirector(firstRun.next, "spring", 100);
    const newRun = resolveAutoCamera(rebased, {
      lineageKey: "live:run-b",
      nowMs: 101,
      currentRegionId: "spring",
      activity: activity("worn", "new-run-first", "agent_left_region"),
    });
    expect(newRun.decision).toMatchObject({
      regionId: "worn", switchRequested: true, reason: "initial",
    });
  });

  it("uses the first typed action to establish initial framing over a stale mounted region", () => {
    const initial = advance(createAutoCameraDirectorState(), {
      nowMs: 0,
      currentRegionId: "nirvana",
      activity: activity("worn", "worn-1", "agent_left_region"),
    });

    expect(initial.decision).toMatchObject({
      regionId: "worn",
      switchRequested: true,
      reason: "initial",
    });

    const loading = advance(initial.next, {
      nowMs: 1,
      currentRegionId: "nirvana",
      activity: activity("worn", "worn-1", "agent_left_region"),
    });
    expect(loading.decision).toMatchObject({
      regionId: "worn",
      switchRequested: true,
      reason: "settling",
    });
  });

  it("keeps the current region through its thirty-second dwell despite routine remote activity", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed"),
    }));

    const beforeDwell = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS - 1,
      currentRegionId: "worn",
      activity: activity("spring", "spring-1", "resource_changed"),
    });

    expect(beforeDwell.decision).toMatchObject({
      regionId: "worn",
      switchRequested: false,
      reason: "dwell",
    });
  });

  it("moves to an important remote birth after the dwell and the local action completes", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed"),
    }));
    ({ next: state } = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS - 1,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed", "exit"),
    }));

    const decision = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS,
      currentRegionId: "worn",
      activity: activity("spring", "spring-birth", "agent_born"),
    });

    expect(decision.decision).toMatchObject({
      regionId: "spring",
      switchRequested: true,
      reason: "important",
    });
  });

  it("waits for the current action to finish before taking an important remote beat", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed"),
    }));
    ({ next: state } = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS - 1,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed"),
    }));

    const heldForAction = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS,
      currentRegionId: "worn",
      activity: activity("spring", "spring-death", "agent_died"),
    });
    expect(heldForAction.decision).toMatchObject({
      regionId: "worn",
      switchRequested: false,
      reason: "action",
    });

    const afterExit = advance(heldForAction.next, {
      nowMs: AUTO_CAMERA_DWELL_MS + 1,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed", "exit"),
    });
    expect(afterExit.decision).toMatchObject({
      regionId: "spring",
      switchRequested: true,
      reason: "important",
    });
  });

  it("keeps the watched region through consecutive remote arrivals inside its dwell", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed", "exit"),
    }));

    const firstArrival = advance(state, {
      nowMs: 1,
      currentRegionId: "worn",
      activity: activity("spring", "arrival-1", "agent_entered_region"),
    });
    expect(firstArrival.decision).toMatchObject({
      regionId: "worn",
      switchRequested: false,
      reason: "dwell",
    });

    const secondArrival = advance(firstArrival.next, {
      nowMs: 2,
      currentRegionId: "worn",
      activity: activity("grove", "arrival-2", "agent_entered_region"),
    });
    expect(secondArrival.decision).toMatchObject({
      regionId: "worn",
      switchRequested: false,
      reason: "dwell",
    });
  });

  it("finishes an arrival that began while its source was mounted", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "journey-1", "agent_entered_region", "enter", "traveler"),
    }));

    const arrivalHold = advance(state, {
      nowMs: 1,
      currentRegionId: "worn",
      activity: activity("spring", "journey-1", "agent_entered_region", "hold", "traveler"),
    });
    expect(arrivalHold.decision).toMatchObject({
      regionId: "spring",
      switchRequested: true,
      reason: "arrival",
    });
  });

  it("uses a quiet spell to visit retained remote activity, then cools down before returning", () => {
    let state = createAutoCameraDirectorState();
    ({ next: state } = advance(state, {
      nowMs: 0,
      currentRegionId: "worn",
      activity: activity("worn", "worn-1", "resource_changed"),
    }));
    const firstMove = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS + AUTO_CAMERA_QUIET_MS,
      currentRegionId: "worn",
      activity: activity("spring", "spring-1", "resource_changed"),
    });
    expect(firstMove.decision).toMatchObject({
      regionId: "spring",
      switchRequested: true,
      reason: "quiet",
    });

    ({ next: state } = advance(firstMove.next, {
      nowMs: AUTO_CAMERA_DWELL_MS + AUTO_CAMERA_QUIET_MS + 1,
      currentRegionId: "spring",
      activity: activity("spring", "spring-1", "resource_changed", "exit"),
    }));

    const blockedReturn = advance(state, {
      nowMs: AUTO_CAMERA_DWELL_MS * 2 + AUTO_CAMERA_QUIET_MS + 1,
      currentRegionId: "spring",
      activity: activity("worn", "worn-home", "home_built"),
    });
    expect(blockedReturn.decision).toMatchObject({
      regionId: "spring",
      switchRequested: false,
      reason: "cooldown",
    });

    const releasedReturn = advance(blockedReturn.next, {
      nowMs: AUTO_CAMERA_DWELL_MS + AUTO_CAMERA_QUIET_MS + 1
        + AUTO_CAMERA_RETURN_COOLDOWN_MS,
      currentRegionId: "spring",
      activity: activity("worn", "worn-home", "home_built"),
    });
    expect(releasedReturn.decision).toMatchObject({
      regionId: "worn",
      switchRequested: true,
      reason: "important",
    });
  });
});
