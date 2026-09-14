import { describe, expect, it } from "vitest";

import type {
  CameraMode,
  ObserverSelection,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import {
  advanceFollow,
  followableAgentKeys,
  FOLLOW_ARRIVAL_TIMEOUT_MS,
  FOLLOW_OFF,
  FOLLOW_RELEASED,
  type FollowState,
  type FollowTickInput,
  projectFollowRoster,
  readFollowSubject,
  requestFollow,
} from "./followSubject";
import type { SemanticSubjectView } from "./semanticWorld";

const REGION_NAMES = new Map([
  ["nirvana", "Nirvana"],
  ["warm_springs", "Warm Springs"],
  ["far_shore", "Far Shore"],
]);

describe("projectFollowRoster", () => {
  it("offers every living being in the world, not only the region on screen", () => {
    // The camera can only latch onto what is rendered, but the CHOICE must span
    // the world -- a viewer cannot pick someone they are not allowed to see.
    const roster = projectFollowRoster(makeFrame(), REGION_NAMES, () => true);

    expect(roster.candidates.map((candidate) => ({
      name: candidate.name,
      region: candidate.regionDisplayName,
    }))).toEqual([
      { name: "Wren", region: "Far Shore" },
      { name: "Aster", region: "Nirvana" },
      { name: "Ilyra", region: "Nirvana" },
      { name: "Rhea", region: "Warm Springs" },
    ]);
  });

  it("never renders an opaque identifier and keeps ids as callback keys", () => {
    const roster = projectFollowRoster(makeFrame({
      world: {
        ...makeFrame().world,
        agents: [{ completeness: "exact", value: {
          id: "agent_001", name: "agent_001", position: "nirvana", status: "alive",
        } }],
      },
    }), REGION_NAMES, () => true);

    expect(roster.candidates[0]?.name).toBe("Unknown being");
    expect(roster.candidates[0]?.key).toBe("agent_001");
  });

  it("withholds the dead, the unplaced, and beings this build has no art for", () => {
    const roster = projectFollowRoster(makeFrame(), REGION_NAMES, (key) => key !== "far_shore");

    expect(roster.candidates.map((candidate) => candidate.name)).toEqual([
      "Aster", "Ilyra", "Rhea",
    ]);
    // Withheld from the CHOICE, but still known to the machine: a being who dies
    // while followed has to be distinguishable from one who never existed.
    expect(roster.byKey.get("agent_dead")).toMatchObject({ name: "Bramble", dead: true });
    expect(roster.byKey.get("agent_far")).toMatchObject({ reachable: false, living: true });
    expect(roster.byKey.get("agent_unresolved")).toMatchObject({ living: false, dead: false });
  });

  it("counts a paralyzed being as living, exactly as every other total does", () => {
    const roster = projectFollowRoster(makeFrame(), REGION_NAMES, () => true);
    expect(roster.byKey.get("agent_ilyra")).toMatchObject({ living: true, dead: false });
  });
});

describe("followableAgentKeys", () => {
  it("keeps only the beings the renderer says the camera may latch onto", () => {
    const keys = followableAgentKeys([
      subject("subject-1", "agent", true),
      subject("subject-2", "agent", false),
      subject("subject-3", "home", true),
    ], (token) => ({
      "subject-1": { kind: "agent", id: "agent_aster" },
      "subject-2": { kind: "agent", id: "agent_ilyra" },
      "subject-3": { kind: "home", id: "home_001" },
    } as Record<string, Exclude<ObserverSelection, null>>)[token] ?? null);

    expect([...keys]).toEqual(["agent_aster"]);
  });
});

describe("advanceFollow", () => {
  it("brings the chosen being's region up before asking the camera for anything", () => {
    // Order matters: the renderer resolves `follow` against the region it has
    // MOUNTED, so asking for follow first is rejected every time.
    const started = requestFollow("agent_rhea", input({ observedRegionKey: "nirvana" }));

    expect(started.effect).toEqual({ kind: "observe-region", regionKey: "warm_springs" });
    expect(started.state).toMatchObject({ kind: "waiting", name: "Rhea" });
  });

  it("takes the camera back from a viewer who was already holding it", () => {
    // The reported defect (Safi, 2026-08-27: *"the follow doesnt work well it stays on auto"*).
    // `free` means the viewer is driving, and they are driving after any pan, any arrow key, and
    // after every Atlas island click -- choosing a PLACE requests Free on purpose. A `free` that
    // pre-dates the pick is not a pan away from the pick: vetoing on it dropped the choice with
    // no effect, no request to the renderer and no notice, so the control read `Automatic` again
    // at once and every later pick died the same way.
    const started = requestFollow("agent_aster", input({ cameraMode: "free" }));

    expect(started.effect).toEqual({ kind: "engage", agentKey: "agent_aster" });
    expect(started.state).toMatchObject({ kind: "following", name: "Aster", confirmed: false });
    expect(readFollowSubject(started.state).name).toBe("Aster");
  });

  it("carries a claim on the camera across a pursuit that has to travel", () => {
    // The same pick, for a being in another region: the mode is still `free` for every tick the
    // region takes to mount, so the claim has to survive the wait rather than only the first tick.
    const started = requestFollow("agent_rhea", input({
      cameraMode: "free",
      observedRegionKey: "nirvana",
    }));
    expect(started.effect).toEqual({ kind: "observe-region", regionKey: "warm_springs" });

    const mounting = advanceFollow(started.state, input({
      cameraMode: "free",
      observedRegionKey: "warm_springs",
      followableKeys: new Set(),
    }));
    expect(mounting.state.kind).toBe("waiting");

    const arrived = advanceFollow(mounting.state, input({
      cameraMode: "free",
      observedRegionKey: "warm_springs",
      followableKeys: new Set(["agent_rhea"]),
    }));
    expect(arrived.effect).toEqual({ kind: "engage", agentKey: "agent_rhea" });
  });

  it("still ends silently on a PAN, which is the viewer taking the camera back", () => {
    // b953c9d's interaction model, unchanged: a manual pan ends the pursuit and says nothing,
    // because the viewer knows what they just did. What is new is only that the pursuit has to
    // have HAD the camera first -- a pan is a change, not a standing condition.
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const panned = advanceFollow(settled, input({ cameraMode: "free" }));

    expect(panned.state).toBe(FOLLOW_OFF);
    expect(panned.effect).toEqual({ kind: "none" });
  });

  it("ends on a pan that lands while a claimed pursuit is still travelling", () => {
    // The claim is spent the moment the camera is seen out of `free` -- here, the pursuit takes
    // it (`follow`) and the viewer then pans away. Without the hand-off the claim would outlive
    // its purpose and a pan could never end a pursuit that began under Free.
    const started = requestFollow("agent_rhea", input({
      cameraMode: "free",
      observedRegionKey: "nirvana",
    }));
    const engaged = advanceFollow(started.state, input({
      cameraMode: "follow",
      observedRegionKey: "warm_springs",
      followableKeys: new Set(["agent_rhea"]),
    }));
    expect(engaged.state).toMatchObject({ kind: "following", confirmed: true });

    const panned = advanceFollow(engaged.state, input({
      cameraMode: "free",
      observedRegionKey: "warm_springs",
      followableKeys: new Set(["agent_rhea"]),
    }));
    expect(panned.state).toBe(FOLLOW_OFF);
  });

  it("asks for a region ONCE, so ticking it from a render cannot spin", () => {
    // The shell ticks this after every render; a transition that mints a fresh
    // state object every time would be an infinite render loop, not a pursuit.
    const asked = requestFollow("agent_rhea", input({ observedRegionKey: "nirvana" }));
    const again = advanceFollow(asked.state, input({ observedRegionKey: "nirvana" }));

    expect(again.state).toBe(asked.state);
    expect(again.effect).toEqual({ kind: "none" });
  });

  it("gives up on a region that never arrives, instead of asking for it forever", () => {
    const asked = requestFollow("agent_rhea", input({
      observedRegionKey: "nirvana",
      nowMs: 5_000,
    }));
    const expired = advanceFollow(asked.state, input({
      observedRegionKey: "nirvana",
      nowMs: 5_000 + FOLLOW_ARRIVAL_TIMEOUT_MS,
    }));

    expect(expired.state).toBe(FOLLOW_RELEASED);
    expect(expired.effect).toEqual({
      kind: "abandon",
      notice: "Rhea could not be brought into view. Auto framing resumed.",
    });
  });

  it("engages only once the being is actually in the mounted scene", () => {
    const waiting = requestFollow("agent_rhea", input({ observedRegionKey: "nirvana" })).state;

    const stillMounting = advanceFollow(waiting, input({
      observedRegionKey: "warm_springs",
      followableKeys: new Set(),
    }));
    expect(stillMounting.effect).toEqual({ kind: "none" });
    expect(stillMounting.state.kind).toBe("waiting");

    const arrived = advanceFollow(stillMounting.state, input({
      observedRegionKey: "warm_springs",
      followableKeys: new Set(["agent_rhea"]),
    }));
    expect(arrived.effect).toEqual({ kind: "engage", agentKey: "agent_rhea" });
    expect(arrived.state).toMatchObject({ kind: "following", confirmed: false });
  });

  it("is idempotent, so the shell may tick it on every render without looping", () => {
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const again = advanceFollow(settled, input({ cameraMode: "follow" }));

    expect(again.state).toBe(settled);
    expect(again.effect).toEqual({ kind: "none" });
  });

  it("follows a being across a border by re-observing the region they walked into", () => {
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const moved = advanceFollow(settled, input({
      cameraMode: "follow",
      observedRegionKey: "nirvana",
      roster: rosterWith({ agent_aster: { regionKey: "warm_springs" } }),
    }));

    expect(moved.effect).toEqual({ kind: "observe-region", regionKey: "warm_springs" });
    expect(moved.state).toMatchObject({ kind: "waiting", regionKey: "warm_springs" });
  });

  it("follows the being a viewer CLICKS while already following someone else", () => {
    // The renderer re-latches on the spot (`setSelection` while mode is follow),
    // so a HUD still naming the previous being would be the original lie again.
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const retargeted = advanceFollow(settled, input({
      cameraMode: "follow",
      selectedSubject: { kind: "agent", id: "agent_ilyra" },
    }));

    expect(retargeted.state).toMatchObject({
      kind: "following", agentKey: "agent_ilyra", name: "Ilyra", confirmed: true,
    });
    expect(retargeted.effect).toEqual({ kind: "none" });
  });

  it("stands down when a viewer re-aims the follow at a HOME, which is not a being", () => {
    // A home cannot appear on a roster of beings, so the shell names it as a
    // subject this control did not choose rather than the control claiming Aster.
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const home = advanceFollow(settled, input({
      cameraMode: "follow",
      selectedSubject: { kind: "home", id: "home_001" },
    }));

    expect(home.state).toBe(FOLLOW_OFF);
    expect(home.effect).toEqual({ kind: "none" });
  });

  it("ignores a selection the renderer would not re-latch on", () => {
    // Selecting a region or a moment does not move a live follow, so the subject
    // this control names must not move either.
    const settled = following("agent_aster", "Aster", "nirvana", true);
    expect(advanceFollow(settled, input({
      cameraMode: "follow",
      selectedSubject: null,
    })).state).toBe(settled);
  });

  it("says the followed being died and hands framing back — it never re-aims silently", () => {
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const died = advanceFollow(settled, input({
      cameraMode: "follow",
      roster: rosterWith({ agent_aster: { living: false, dead: true } }),
    }));

    expect(died.state).toBe(FOLLOW_RELEASED);
    expect(died.effect).toEqual({
      kind: "abandon",
      notice: "Aster has died. Auto framing resumed.",
    });
  });

  it("says so when a followed being walks into a region this build cannot render", () => {
    const settled = following("agent_aster", "Aster", "nirvana", true);
    const gone = advanceFollow(settled, input({
      cameraMode: "follow",
      roster: rosterWith({ agent_aster: { regionKey: "far_shore", reachable: false } }),
    }));

    expect(gone.state).toBe(FOLLOW_RELEASED);
    expect(gone.effect).toEqual({
      kind: "abandon",
      notice: "Aster moved somewhere this view has no art for. Auto framing resumed.",
    });
  });

  it("gives up out loud when a chosen being never arrives", () => {
    const waiting = requestFollow("agent_rhea", input({
      observedRegionKey: "warm_springs",
      followableKeys: new Set(),
      nowMs: 1_000,
    })).state;

    const expired = advanceFollow(waiting, input({
      observedRegionKey: "warm_springs",
      followableKeys: new Set(),
      nowMs: 1_000 + FOLLOW_ARRIVAL_TIMEOUT_MS,
    }));

    expect(expired.state).toBe(FOLLOW_RELEASED);
    expect(expired.effect).toEqual({
      kind: "abandon",
      notice: "Rhea could not be brought into view. Auto framing resumed.",
    });
  });

  it("ends the pursuit WITHOUT a notice when the viewer takes the camera themselves", () => {
    // A pan drops the renderer into `free`; the framing control's release drops
    // it into `story`. Both are deliberate acts, and telling someone what they
    // just did is noise, not honesty.
    for (const mode of ["free", "story"] as const) {
      const taken = advanceFollow(
        following("agent_aster", "Aster", "nirvana", true),
        input({ cameraMode: mode }),
      );
      expect(taken.state).toBe(FOLLOW_OFF);
      expect(taken.effect).toEqual({ kind: "none" });
    }
  });

  it("lets a viewer PAN out of a pursuit that has not even arrived yet", () => {
    // Otherwise the camera would be snatched back the instant the being came
    // into view, long after the viewer had gone somewhere else by hand.
    const waiting = requestFollow("agent_rhea", input({ observedRegionKey: "nirvana" })).state;
    const panned = advanceFollow(waiting, input({
      observedRegionKey: "warm_springs",
      cameraMode: "free",
    }));

    expect(panned.state).toBe(FOLLOW_OFF);
    expect(panned.effect).toEqual({ kind: "none" });
  });

  it("keeps the subject named through a zoom, which takes authority but not the mode", () => {
    // `zoomCamera` deliberately does not change the camera mode; the framing
    // control already reads `Yours` for it. The subject is still the subject.
    const zoomed = advanceFollow(
      following("agent_aster", "Aster", "nirvana", true),
      input({ cameraMode: "follow" }),
    );
    expect(zoomed.state).toMatchObject({ kind: "following", name: "Aster" });
  });

  it("adopts the being a viewer followed by hand, so the HUD's reading stays true", () => {
    // Click a being, press F: a path that predates this control entirely.
    const adopted = advanceFollow(FOLLOW_OFF, input({
      cameraMode: "follow",
      selectedSubject: { kind: "agent", id: "agent_aster" },
    }));

    expect(adopted.state).toMatchObject({ kind: "following", name: "Aster", confirmed: true });
    expect(adopted.effect).toEqual({ kind: "none" });
  });

  it("will not adopt again after a deliberate ending, which would be a stalemate", () => {
    // Releasing while the camera is still nominally in `follow` is the exact
    // window in which adoption and release would take turns forever.
    const released = advanceFollow(FOLLOW_RELEASED, input({
      cameraMode: "follow",
      selectedSubject: { kind: "agent", id: "agent_aster" },
    }));
    expect(released.state).toBe(FOLLOW_RELEASED);

    // Once the camera has actually left follow, adoption is armed again.
    const rearmed = advanceFollow(FOLLOW_RELEASED, input({ cameraMode: "story" }));
    expect(rearmed.state).toBe(FOLLOW_OFF);
  });

  it("never adopts a being it would have to abandon on the very next tick", () => {
    // Wren is alive and selected, but lives where this build has no art. Adopting
    // her would be adopt -> abandon -> adopt, forever.
    const refused = advanceFollow(FOLLOW_OFF, input({
      cameraMode: "follow",
      selectedSubject: { kind: "agent", id: "agent_far" },
    }));
    expect(refused.state).toBe(FOLLOW_OFF);
    expect(refused.effect).toEqual({ kind: "none" });
  });

  it("stays quiet about a hand-driven follow of something that is not a living being", () => {
    expect(advanceFollow(FOLLOW_OFF, input({
      cameraMode: "follow",
      selectedSubject: { kind: "agent", id: "agent_dead" },
    })).state).toBe(FOLLOW_OFF);
    expect(advanceFollow(FOLLOW_OFF, input({ cameraMode: "follow" })).state).toBe(FOLLOW_OFF);
  });

  it("refuses a being who left the world between the roster and the click", () => {
    const rejected = requestFollow("agent_ghost", input({}));
    expect(rejected.state).toBe(FOLLOW_RELEASED);
    expect(rejected.effect).toEqual({
      kind: "abandon",
      notice: "That being is no longer in the world. Auto framing resumed.",
    });
  });
});

describe("readFollowSubject", () => {
  it("names nobody under director framing, and marks a pursuit still in flight", () => {
    expect(readFollowSubject(FOLLOW_OFF)).toEqual({ key: null, name: null, pending: false });
    expect(readFollowSubject({
      kind: "waiting", agentKey: "agent_rhea", name: "Rhea",
      regionKey: "warm_springs", deadlineMs: 10, asked: true, claimingCamera: false,
    })).toEqual({ key: "agent_rhea", name: "Rhea", pending: true });
    expect(readFollowSubject(following("agent_aster", "Aster", "nirvana", true)))
      .toEqual({ key: "agent_aster", name: "Aster", pending: false });
  });
});

function following(
  agentKey: string,
  name: string,
  regionKey: string,
  confirmed: boolean,
): FollowState {
  return { kind: "following", agentKey, name, regionKey, confirmed, claimingCamera: false };
}

function subject(
  token: string,
  kind: SemanticSubjectView["kind"],
  canFollow: boolean,
): SemanticSubjectView {
  return {
    token,
    kind,
    name: "Someone",
    status: "Alive",
    position: "Tile 1, 1",
    currentAction: "Resting",
    selected: false,
    canFollow,
  };
}

function rosterWith(
  overrides: Readonly<Record<string, Partial<{
    regionKey: string | null;
    living: boolean;
    dead: boolean;
    reachable: boolean;
  }>>>,
): FollowTickInput["roster"] {
  const base = projectFollowRoster(makeFrame(), REGION_NAMES, (key) => key !== "far_shore");
  const byKey = new Map(base.byKey);
  for (const [key, patch] of Object.entries(overrides)) {
    const fact = byKey.get(key);
    if (fact === undefined) continue;
    byKey.set(key, { ...fact, ...patch });
  }
  return { candidates: base.candidates, byKey };
}

function input(overrides: Partial<FollowTickInput>): FollowTickInput {
  return {
    roster: projectFollowRoster(makeFrame(), REGION_NAMES, (key) => key !== "far_shore"),
    observedRegionKey: "nirvana",
    followableKeys: new Set(["agent_aster", "agent_ilyra"]),
    cameraMode: "story" as CameraMode,
    selectedSubject: null,
    nowMs: 0,
    ...overrides,
  };
}

function makeFrame(overrides: Partial<PresentedObserverFrame> = {}): PresentedObserverFrame {
  return {
    runId: "run-secret",
    sourceKey: "source-secret",
    revision: 1,
    firstCursor: 0,
    lastCursor: 7,
    source: "fixture",
    ingestedCursor: 9,
    presentedCursor: 7,
    world: {
      exactBaseCursor: 6,
      projectedThroughCursor: 7,
      worldTime: 42,
      agents: [
        { completeness: "exact", value: {
          id: "agent_aster", name: "Aster", position: "nirvana", status: "alive",
        } },
        { completeness: "exact", value: {
          id: "agent_ilyra", name: "Ilyra", position: "nirvana", status: "paralyzed",
        } },
        { completeness: "exact", value: {
          id: "agent_rhea", name: "Rhea", position: "warm_springs", status: "alive",
        } },
        { completeness: "exact", value: {
          id: "agent_dead", name: "Bramble", position: "nirvana", status: "dead",
        } },
        { completeness: "exact", value: {
          id: "agent_far", name: "Wren", position: "far_shore", status: "alive",
        } },
        { completeness: "projected-partial", value: {
          id: "agent_unresolved", name: "Moss", position: "nirvana",
        } },
      ],
      regions: [
        { completeness: "exact", value: { name: "nirvana", connections: [] } },
        { completeness: "exact", value: { name: "warm_springs", connections: [] } },
      ],
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
    transport: { connection: "live", ingestedCursor: 9, retryable: false },
    ...overrides,
  };
}
