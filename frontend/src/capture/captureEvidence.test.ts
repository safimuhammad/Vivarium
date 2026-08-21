import { describe, expect, it } from "vitest";

import {
  assertNoFrameDrivenReactCommits,
  buildEventMarkerExpectations,
  captureReadyToSettle,
  assertC03ResourceTransferWitness,
  observedCursorAuthority,
  presentationTerminalReached,
  eventMarkerBoundaryReached,
  orderCapturedMarkerIds,
} from "./captureEvidence";

const settledState = JSON.stringify({
  publicText: "Aster rests in Mossmere.",
  observer: { runId: "run", sourceKey: "live:run", revision: 1, presentedCursor: 7 },
});

describe("capture evidence classification", () => {
  it("keeps capture open while a rendered actor has route-active or fallback-reposition semantics", () => {
    const settled = {
      minimumFrameCountReached: true,
      terminalReached: true,
      expectedMarkersReached: true,
      checkpointHoldActive: false,
      actors: [{ activeAction: null, reposition: null }],
    } as const;

    expect(captureReadyToSettle(settled)).toBe(true);
    expect(captureReadyToSettle({
      ...settled,
      actors: [{ activeAction: "moving", reposition: null }],
    })).toBe(false);
    expect(captureReadyToSettle({
      ...settled,
      actors: [{ activeAction: "orienting", reposition: null }],
    })).toBe(false);
    expect(captureReadyToSettle({
      ...settled,
      actors: [{
        activeAction: null,
        reposition: { phase: "fade-out", reason: "fallback", target: { x: 32, y: 64 } },
      }],
    })).toBe(false);
    expect(captureReadyToSettle({
      ...settled,
      actors: [{ activeAction: "working", reposition: null }],
    })).toBe(true);
  });

  it("binds repeated event marker IDs to their exact authoritative cursors", () => {
    const entries = [
      { cursor: 5, event: { type: "ruins_scavenged", payload: {} } },
      { cursor: 6, event: { type: "ruins_scavenged", payload: {} } },
      { cursor: 7, event: { type: "home_collapsed", payload: {} } },
    ];
    const expectations = buildEventMarkerExpectations(entries);

    expect([...expectations.keys()]).toEqual([
      "event:ruins_scavenged@cursor:5",
      "event:ruins_scavenged@cursor:6",
      "event:home_collapsed",
    ]);
    expect(expectations.get("event:ruins_scavenged@cursor:5")).toMatchObject({
      cursor: 5,
      eventType: "ruins_scavenged",
    });
    expect(expectations.get("event:ruins_scavenged@cursor:6")).toMatchObject({
      cursor: 6,
      eventType: "ruins_scavenged",
    });
    expect([...buildEventMarkerExpectations(entries, [
      "event:ruins_scavenged",
      "event:home_collapsed",
      "checkpoint:final",
    ]).keys()]).toEqual([
      "event:ruins_scavenged",
      "event:home_collapsed",
    ]);
  });

  it("RED C03: certifies one labeled transfer witness with no canvas transient", () => {
    expect(assertC03ResourceTransferWitness(c03TransferWitness())).toEqual({
      senderId: "wanderer_001",
      senderName: "Joe",
      receiverId: "wanderer_002",
      receiverName: "Mae",
      resourceType: "materials",
      amount: 1,
      direction: "→",
      text: "Joe gave 1 material to Mae.",
      focusSelectionKey: "agent:wanderer_001",
      senderSafeFrameVisible: true,
      maximumActiveEffects: 0,
      transferFrameCount: 5,
      senderPosition: { x: 1_936, y: 176 },
      receiverPosition: { x: 304, y: 112 },
      readingHoldMs: 23 * 1_000 / 30,
      dialogueBounds: { x: 128, y: 760, width: 1_184, height: 126 },
    });
  });

  it.each([
    ["duplicate canvas transient", { maximumActiveEffects: 1 }],
    ["wrong target attribution", { dialogueNow: { targetName: "Joe" } }],
    ["missing target attribution", { dialogueNow: { targetName: null } }],
    ["missing transfer direction", { dialogueNow: { direction: null } }],
    ["stale sender focus", { focusSelectionKey: "agent:wanderer_002" }],
    ["sender behind chrome", { actors: [{ id: "wanderer_001", safeFrameVisible: false }] }],
    ["short reading hold", { readingHoldMs: 700 }],
    ["clipped dialogue", { dialogueNow: { bounds: { x: 128, y: 800, width: 1_184, height: 126 } } }],
    ["wrong trusted resource", { resourceType: "energy" }],
    ["wrong trusted amount", { amount: 2 }],
    ["sender displacement", { transferFrames: transferFrames({ senderX: 1_937 }) }],
    ["receiver displacement", { transferFrames: transferFrames({ receiverX: 305 }) }],
    ["forbidden far reach", { transferFrames: transferFrames({ senderAction: "reach-give" }) }],
    ["forbidden far teleport", { transferFrames: transferFrames({ senderAction: "teleport" }) }],
    ["missing transfer phase", { transferFrames: transferFrames().slice(0, 4) }],
  ])("RED C03: rejects %s", (_label, override) => {
    expect(() => assertC03ResourceTransferWitness(mergeC03Witness(override)))
      .toThrow(/C03 resource-transfer witness/);
  });

  it.each([
    ["shuffled phase blocks", framesForPhases(["enter", "consequence", "hold", "recover", "exit"])],
    ["phase re-entry", framesForPhases(["enter", "hold", "consequence", "hold", "recover", "exit"])],
    ["repeated prior phase", framesForPhases(["enter", "hold", "hold", "enter", "consequence", "recover", "exit"])],
    ["extra phase", framesForPhases(["enter", "hold", "consequence", "celebrate", "recover", "exit"])],
    ["frame-index gap", transferFrames().map((frame, index) => ({
      ...frame,
      frameIndex: index < 3 ? index : index + 1,
    }))],
  ])("RED C03: rejects retained transfer continuity with %s", (_label, frames) => {
    expect(() => assertC03ResourceTransferWitness(mergeC03Witness({ transferFrames: frames })))
      .toThrow(/C03 resource-transfer witness/);
  });

  it.each([
    ["null active-effects", { maximumActiveEffects: null }],
    ["string active-effects", { maximumActiveEffects: "0" }],
    ["negative active-effects", { maximumActiveEffects: -1 }],
    ["fractional active-effects", { maximumActiveEffects: 0.5 }],
    ["NaN active-effects", { maximumActiveEffects: Number.NaN }],
    ["object active action", { transferFrames: transferFrames().map((frame, index) => index === 1
      ? { ...frame, sender: { ...frame.sender, activeAction: { kind: "idle" } } }
      : frame) }],
    ["numeric active action", { transferFrames: transferFrames().map((frame, index) => index === 1
      ? { ...frame, receiver: { ...frame.receiver, activeAction: 0 } }
      : frame) }],
    ["string endpoint position", { transferFrames: transferFrames().map((frame, index) => index === 1
      ? { ...frame, sender: { ...frame.sender, position: { x: "1936", y: 176 } } }
      : frame) }],
    ["non-finite endpoint position", { transferFrames: transferFrames().map((frame, index) => index === 1
      ? { ...frame, receiver: { ...frame.receiver, position: { x: Number.NaN, y: 112 } } }
      : frame) }],
    ["numeric endpoint id", { transferFrames: transferFrames().map((frame, index) => index === 1
      ? { ...frame, sender: { ...frame.sender, id: 1 } }
      : frame) }],
    ["numeric dialogue field", { dialogueNow: { speakerName: 7 } }],
    ["string dialogue bound", { dialogueNow: {
      bounds: { x: "128", y: 760, width: 1_184, height: 126 },
    } }],
    ["string viewport width", { viewport: { width: "1440", height: 900 } }],
  ])("RED C03: rejects malformed retained type %s", (_label, override) => {
    expect(() => assertC03ResourceTransferWitness(mergeC03Witness(override)))
      .toThrow(/C03 resource-transfer witness/);
  });

  it("binds movement markers to the payload traveler rather than any visible focused actor", () => {
    const expectations = buildEventMarkerExpectations([{
      cursor: 2,
      event: {
        type: "agent_entered_region",
        payload: {
          agent_id: "joe",
          from_region: "meadow",
          to_region: "distant",
        },
      },
    }]);
    const expectation = expectations.get("event:agent_entered_region")!;
    const boundary = {
      phase: "consequence",
      consequenceCommitted: true,
      frameIdentity: { firstCursor: 2, lastCursor: 2 },
      cameraMode: "story",
      focusSelectionKey: "agent:joe",
      actors: [
        { id: "joe", safeFrameVisible: true },
        { id: "mae", safeFrameVisible: true },
      ],
    } as const;

    expect(eventMarkerBoundaryReached(expectation, boundary)).toBe(true);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      phase: "recover",
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      phase: "exit",
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      phase: "hold",
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      phase: null,
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      consequenceCommitted: false,
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      focusSelectionKey: "agent:mae",
    })).toBe(false);
    expect(eventMarkerBoundaryReached(expectation, {
      ...boundary,
      actors: [
        { id: "joe", safeFrameVisible: false },
        { id: "mae", safeFrameVisible: true },
      ],
    })).toBe(false);
    expect(buildEventMarkerExpectations([{
      cursor: 2,
      event: { type: "agent_entered_region", payload: {} },
    }]).has("event:agent_entered_region")).toBe(false);
  });

  it("rejects an actual React commit during byte-identical isolated Canvas ticks", () => {
    expect(() => assertNoFrameDrivenReactCommits(
      { reactCommitCount: 3, acceptedPublicState: settledState },
      { reactCommitCount: 4, acceptedPublicState: settledState },
    )).toThrow(/frame-driven React commits are forbidden/);
  });

  it("does not classify an unrelated accepted publication outside the quiet probe", () => {
    expect(assertNoFrameDrivenReactCommits(
      { reactCommitCount: 3, acceptedPublicState: settledState },
      { reactCommitCount: 4, acceptedPublicState: JSON.stringify({
        publicText: "Aster rests in Mossmere.",
        observer: { runId: "run", sourceKey: "live:run", revision: 2, presentedCursor: 8 },
      }) },
    )).toBe(0);
  });

  it("orders marker artifacts by captured frame chronology rather than manifest declaration", () => {
    expect(orderCapturedMarkerIds(
      ["event:entered", "event:left", "checkpoint:final"],
      new Map([
        ["event:left", 12],
        ["event:entered", 18],
        ["checkpoint:final", 30],
      ]),
    )).toEqual(["event:left", "event:entered", "checkpoint:final"]);
  });

  it("rejects missing, foreign, duplicate, or invalid captured marker frames", () => {
    expect(() => orderCapturedMarkerIds(["event:left"], new Map())).toThrow(/exact expected set/i);
    expect(() => orderCapturedMarkerIds(
      ["event:left"],
      new Map([["event:left", 1], ["event:foreign", 2]]),
    )).toThrow(/exact expected set/i);
    expect(() => orderCapturedMarkerIds(
      ["event:left", "event:left"],
      new Map([["event:left", 1]]),
    )).toThrow(/unique/i);
    expect(() => orderCapturedMarkerIds(
      ["event:left"],
      new Map([["event:left", -1]]),
    )).toThrow(/non-negative integer/i);
  });

  it("preserves observed C15 Live cursor 4 when mechanic authority ends at 0", () => {
    const observation = {
      runId: "mock-c15-v1",
      sourceKey: "live:mock-c15-v1",
      ingestedCursor: 4,
      presentedCursor: 4,
      canvasLastCursor: 4,
      activeSceneCount: 0,
      pendingMoments: 0,
    };

    expect(observedCursorAuthority(observation)).toEqual({
      acceptedCursor: 4,
      presentedCursor: 4,
      publicCursor: 4,
      motionCursor: 4,
    });
    expect(presentationTerminalReached({
      source: "live",
      runId: "mock-c15-v1",
      sourceKey: "live:mock-c15-v1",
      cursor: 4,
    }, observation)).toBe(true);
  });

  it("requires exact C14 replacement lineage before accepting cursor reset terminal", () => {
    const replacement = {
      source: "live" as const,
      runId: "mock-c14-v1-replacement",
      sourceKey: "live:mock-c14-v1-replacement",
      cursor: 0,
    };
    const settled = {
      runId: replacement.runId,
      sourceKey: replacement.sourceKey,
      ingestedCursor: 0,
      presentedCursor: 0,
      canvasLastCursor: 0,
      activeSceneCount: 0,
      pendingMoments: 0,
    };

    expect(presentationTerminalReached(replacement, settled)).toBe(true);
    expect(presentationTerminalReached(replacement, {
      ...settled,
      runId: "mock-c14-v1",
      sourceKey: "live:mock-c14-v1",
    })).toBe(false);
    expect(presentationTerminalReached(replacement, {
      ...settled,
      sourceKey: "live:mock-c14-v1",
    })).toBe(false);
  });

  it("rejects a presentation terminal while a scene or queue is still active", () => {
    const terminal = {
      source: "live" as const,
      runId: "run",
      sourceKey: "live:run",
      cursor: 0,
    };
    const settled = {
      runId: "run",
      sourceKey: "live:run",
      ingestedCursor: 0,
      presentedCursor: 0,
      canvasLastCursor: 0,
      activeSceneCount: 0,
      pendingMoments: 0,
    };

    expect(presentationTerminalReached(terminal, { ...settled, activeSceneCount: 1 })).toBe(false);
    expect(presentationTerminalReached(terminal, { ...settled, pendingMoments: 1 })).toBe(false);
  });
});

function c03TransferWitness() {
  return {
    senderId: "wanderer_001",
    receiverId: "wanderer_002",
    resourceType: "materials",
    amount: 1,
    phase: "consequence",
    focusSelectionKey: "agent:wanderer_001",
    dialogue: {
      speakerId: "wanderer_001",
      speakerName: "Joe",
      text: "Joe gave 1 material to Mae.",
      hold: true,
    },
    dialogueNow: {
      speakerName: "Joe",
      targetName: "Mae",
      direction: "→",
      text: "Joe gave 1 material to Mae.",
      bounds: { x: 128, y: 760, width: 1_184, height: 126 },
    },
    viewport: { width: 1_440, height: 900 },
    actors: [{ id: "wanderer_001", safeFrameVisible: true }],
    maximumActiveEffects: 0,
    transferFrames: transferFrames(),
    readingHoldMs: 23 * 1_000 / 30,
  } as const;
}

function transferFrames(options: Readonly<{
  senderX?: number;
  receiverX?: number;
  senderAction?: string;
}> = {}) {
  return (["enter", "hold", "consequence", "recover", "exit"] as const).map((phase, frameIndex) => ({
    frameIndex,
    phase,
    sender: {
      id: "wanderer_001",
      position: { x: options.senderX ?? 1_936, y: 176 },
      activeAction: options.senderAction ?? "idle",
      safeFrameVisible: true,
    },
    receiver: {
      id: "wanderer_002",
      position: { x: options.receiverX ?? 304, y: 112 },
      activeAction: "idle",
      safeFrameVisible: false,
    },
  }));
}

function framesForPhases(phases: readonly string[]) {
  const templates = transferFrames();
  return phases.map((phase, frameIndex) => ({
    ...templates[Math.min(frameIndex, templates.length - 1)],
    frameIndex,
    phase,
  }));
}

function mergeC03Witness(override: Readonly<Record<string, unknown>>) {
  const base = c03TransferWitness();
  return {
    ...base,
    ...override,
    dialogueNow: {
      ...base.dialogueNow,
      ...(override.dialogueNow as Readonly<Record<string, unknown>> | undefined),
    },
  };
}
