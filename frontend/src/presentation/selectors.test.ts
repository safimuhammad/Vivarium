import { describe, expect, expectTypeOf, it } from "vitest";

import rawC17 from "../../../tests/frontend-app/fixtures/chronicles/data/C17-communication-perception-privacy.json";
import { parseEventEnvelope } from "../app/schemas";
import { makeWorld } from "../test/fixtures";
import { BeatDirector } from "./BeatDirector";
import type {
  ObserverSelection,
  PresentedObserverFrame,
  PresentedRecord,
} from "./contracts";
import {
  selectLivingAtlas,
  selectPresentedChronicle,
  selectPresentedDialogue,
  selectPresentedHud,
  selectPresentedSelection,
  type SanitizedChronicleData,
} from "./selectors";

const C17_ENTRIES = parseEventEnvelope({
  schema: 1,
  cursor: 0,
  oldest_cursor: 1,
  next_cursor: rawC17.expectedFinalCursor,
  events: rawC17.entries,
  overflow: false,
  snapshot_required: false,
}).events;
const C17_MOMENTS = new BeatDirector().group(C17_ENTRIES);

describe("presentation frame selectors", () => {
  it("accepts only the observer frame and sanitized Chronicle API shapes", () => {
    expectTypeOf(selectPresentedHud).parameters.toEqualTypeOf<[
      PresentedObserverFrame,
    ]>();
    expectTypeOf(selectPresentedDialogue).parameters.toEqualTypeOf<[
      PresentedObserverFrame,
      SanitizedChronicleData,
    ]>();
    expectTypeOf(selectPresentedChronicle).parameters.toEqualTypeOf<[
      PresentedObserverFrame,
      SanitizedChronicleData,
    ]>();
    expectTypeOf(selectPresentedSelection).parameters.toEqualTypeOf<[
      PresentedObserverFrame,
      SanitizedChronicleData,
    ]>();
  });

  it("derives honest HUD totals only from the presented frame", () => {
    const frame = makeFrame();
    const canonicalFuture = makeWorld({
      event_cursor: 99,
      agents: [],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    expect(selectPresentedHud(frame)).toEqual({
      presentedCursor: 3,
      ingestedCursor: 3,
      livingAgents: 2,
      paralyzedAgents: 1,
      deadAgents: 0,
      unresolvedAgentStatuses: 1,
      homes: 1,
      ruins: 1,
      pendingProposals: 1,
      vaultMaterials: 14,
      backlog: frame.backlog,
      transport: frame.transport,
    });
    expect(canonicalFuture.event_cursor).toBe(99);
  });

  it("keeps directed atlas connections and queues only redacted importance", () => {
    const frame = makeFrame();
    const chronicle = chronicleData({
      upcoming: [
        { sequence: 1, regionId: "meadow", urgency: "featured" },
        { sequence: 2, regionId: "meadow", urgency: "drama" },
        { sequence: 3, regionId: "unknown-future-place", urgency: "drama" },
      ],
    });

    const atlas = selectLivingAtlas(frame, chronicle);

    expect(atlas.regions).toEqual([
      {
        id: "grove",
        description: "Thick trunks and shaded roots.",
        connections: ["meadow"],
        livingAgents: 1,
        homes: 0,
        ruins: 1,
        queuedImportance: { ambient: 0, featured: 0, drama: 0 },
      },
      {
        id: "meadow",
        description: "Open grass and bright seed heads.",
        connections: ["grove"],
        livingAgents: 1,
        homes: 1,
        ruins: 0,
        queuedImportance: { ambient: 0, featured: 1, drama: 1 },
      },
    ]);
    expect(JSON.stringify(atlas)).not.toContain("unknown-future-place");
  });

  it("projects dialogue only from the active presented scene", () => {
    const dialogue = {
      speakerId: "wanderer_001",
      speakerName: "Mae",
      text: "The springs are quiet.",
      visibleCharacters: 22,
      cursor: 1,
      hold: true,
    };
    const frame = makeFrame({
      scene: {
        momentId: "1:1:single",
        regionId: "meadow",
        phase: "hold",
        focus: { kind: "agent", id: "wanderer_001" },
        dialogue,
        actorIntents: [],
        homeIntents: [],
        effectIntents: [],
        safeCancelMarkers: [],
        reducedMotion: false,
      },
    });

    expect(selectPresentedDialogue(
      frame,
      chronicleData({ now: C17_MOMENTS[0] }),
    )).toEqual(dialogue);
    expect(selectPresentedDialogue(makeFrame(), chronicleData())).toBeNull();
  });

  it("selects only records already present in the observer frame", () => {
    const selected = selectPresentedSelection(
      makeFrame({ selection: { kind: "agent", id: "agent_001" } }),
      chronicleData(),
    );

    expect(selected).toMatchObject({
      kind: "agent",
      id: "agent_001",
      record: { value: { name: "Aster", status: "alive" } },
    });
    expect(
      selectPresentedSelection(
        makeFrame({ selection: { kind: "agent", id: "future_child" } }),
        chronicleData(),
      ),
    ).toBeNull();
  });
});

describe("presented Chronicle privacy", () => {
  it("emits upcoming placeholders with exactly sequence, regionId, and urgency", () => {
    const result = selectPresentedChronicle(
      makeFrame(),
      chronicleData({
        upcoming: [
          Object.assign(
            { sequence: 8, regionId: "meadow", urgency: "drama" as const },
            {
              type: "agent_died",
              people: ["agent_001"],
              outcome: "dead",
              icon: "death",
              text: "Aster dies",
              payload: { victim_id: "agent_001" },
            },
          ),
          { sequence: 9, regionId: "not-in-the-frame", urgency: "featured" },
        ],
      }),
    );

    expect(result.upcoming).toEqual([
      { sequence: 8, regionId: "meadow", urgency: "drama" },
      { sequence: 9, regionId: null, urgency: "featured" },
    ]);
    expect(Object.keys(result.upcoming[0])).toEqual([
      "sequence",
      "regionId",
      "urgency",
    ]);
    expect(JSON.stringify(result.upcoming)).not.toMatch(
      /agent_died|people|outcome|death|Aster dies|victim_id/,
    );
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. The prior selection gate on PRIVATE
  // self-talk was reversed deliberately: ScopeType.PRIVATE only means other
  // BEINGS never perceive the thought (it is never routed to another agent's
  // inbox); the viewer is not a being, so viewer visibility is granted
  // regardless of selection. Do not restore this gate as a regression fix.
  it("shows PRIVATE self-talk regardless of selection", () => {
    const selfTalk = C17_MOMENTS[2];
    const data = chronicleData({ now: selfTalk, previous: [selfTalk] });

    for (const selection of [
      { kind: "agent", id: "wanderer_001" },
      null,
      { kind: "agent", id: "wanderer_002" },
      { kind: "home", id: "home_001" },
      { kind: "region", id: "meadow" },
      { kind: "moment", id: selfTalk.id, firstCursor: 3, lastCursor: 3 },
    ] satisfies readonly ObserverSelection[]) {
      const shown = selectPresentedChronicle(
        makeFrame({ selection }),
        data,
      );
      expect(shown.now).toEqual(selfTalk);
      expect(shown.now).not.toBe(selfTalk);
      expect(shown.previous).toEqual([selfTalk]);
      expect(shown.previous[0]).not.toBe(selfTalk);
      expect(JSON.stringify(shown)).toContain("I will keep this thought within.");
    }
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. Moment selection of a PRIVATE self-talk
  // moment was reversed to expose it, deliberately; do not restore the gate.
  it("exposes a private moment through moment selection", () => {
    const selfTalk = C17_MOMENTS[2];
    const selected = selectPresentedSelection(
      makeFrame({
        selection: {
          kind: "moment",
          id: selfTalk.id,
          firstCursor: selfTalk.firstCursor,
          lastCursor: selfTalk.lastCursor,
        },
      }),
      chronicleData({ previous: [selfTalk] }),
    );

    expect(selected).toMatchObject({
      kind: "moment",
      id: selfTalk.id,
      moment: { representative: { event: { type: "self_talk" } } },
    });
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. Active dialogue for PRIVATE self-talk was
  // reversed to show regardless of selection, deliberately; do not restore
  // the gate as a regression fix.
  it("exposes PRIVATE self-talk through active dialogue regardless of selection", () => {
    const selfTalk = C17_MOMENTS[2];
    const dialogue = {
      speakerId: "wanderer_001",
      speakerName: "Mae",
      text: "I will keep this thought within.",
      visibleCharacters: 35,
      cursor: 3,
      hold: true,
    };
    const scene = {
      momentId: selfTalk.id,
      regionId: null,
      phase: "hold" as const,
      focus: { kind: "agent" as const, id: "wanderer_001" },
      dialogue,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    };
    const chronicle = chronicleData({ now: selfTalk });

    expect(selectPresentedDialogue(makeFrame({ scene }), chronicle)).toEqual(dialogue);
    expect(selectPresentedDialogue(
      makeFrame({
        scene,
        selection: { kind: "agent", id: "wanderer_002" },
      }),
      chronicle,
    )).toEqual(dialogue);
    expect(selectPresentedDialogue(
      makeFrame({
        scene,
        selection: { kind: "agent", id: "wanderer_001" },
      }),
      chronicle,
    )).toEqual(dialogue);
  });

  it("allows an already-presented non-private moment selection", () => {
    const speech = C17_MOMENTS[0];
    const selected = selectPresentedSelection(
      makeFrame({
        selection: {
          kind: "moment",
          id: speech.id,
          firstCursor: speech.firstCursor,
          lastCursor: speech.lastCursor,
        },
      }),
      chronicleData({ previous: [speech] }),
    );

    expect(selected).toMatchObject({
      kind: "moment",
      id: speech.id,
      moment: { representative: { event: { type: "speak" } } },
    });
  });

  it("deep-owns visible Chronicle truth against post-selection caller mutation", () => {
    const speech = new BeatDirector().group([
      structuredClone(C17_ENTRIES[0]),
    ])[0];
    const gap = {
      firstCursor: 40,
      lastCursor: 44,
      chapter: "while-away" as const,
      archiveAvailable: true,
    };
    const input = chronicleData({ now: speech, previous: [speech], gaps: [gap] });

    const result = selectPresentedChronicle(
      makeFrame({ selection: { kind: "agent", id: "wanderer_001" } }),
      input,
    );
    speech.representative.event.payload.message = "caller rewrote the past";
    gap.lastCursor = 999;

    expect(result.now?.representative.event.payload.message).toBe(
      "Mae, the springs are quiet.",
    );
    expect(result.previous[0].representative.event.payload.message).toBe(
      "Mae, the springs are quiet.",
    );
    expect(result.gaps[0].lastCursor).toBe(44);
    expect(result.now).not.toBe(speech);
    expect(result.previous[0]).not.toBe(speech);
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. Self-talk is now presented (not hidden), so
  // this test's remaining purpose -- proving the presented copy is deep-owned
  // against later caller mutation -- is asserted directly instead of via a
  // hidden/null result. Do not restore the old hidden-by-default gate.
  it("deep-owns visible self-talk against post-presentation caller mutation", () => {
    const selfTalk = new BeatDirector().group([
      structuredClone(C17_ENTRIES[2]),
    ])[0];
    const input = chronicleData({ now: selfTalk, previous: [selfTalk] });
    const result = selectPresentedChronicle(makeFrame(), input);

    selfTalk.representative.event.payload.message = "leaked later";
    input.previous[0].representative.event.payload.message = "leaked again";

    expect(result.now?.representative.event.payload.message).toBe(
      "I will keep this thought within.",
    );
    expect(result.previous[0].representative.event.payload.message).toBe(
      "I will keep this thought within.",
    );
    expect(result.now).not.toBe(selfTalk);
    expect(result.previous[0]).not.toBe(selfTalk);
    expect(JSON.stringify(result)).not.toContain("leaked");
  });

  it("retains remote targeted-speech attribution without inventing movement or delivery", () => {
    const whisper = C17_MOMENTS[1];
    const frame = makeFrame({
      selection: { kind: "agent", id: "wanderer_001" },
      scene: null,
    });

    const result = selectPresentedChronicle(
      frame,
      chronicleData({ previous: [whisper] }),
    );
    const event = result.previous[0].representative.event;

    expect(event).toMatchObject({
      type: "speak",
      source: "wanderer_001",
      target: "wanderer_003",
      scope: "targeted",
      region: "warm_springs",
    });
    expect(result.previous[0].evidence).toHaveLength(1);
    expect(selectPresentedDialogue(
      frame,
      chronicleData({ previous: [whisper] }),
    )).toBeNull();
    expect(frame.scene).toBeNull();
  });
});

function makeFrame(
  overrides: Partial<PresentedObserverFrame> = {},
): PresentedObserverFrame {
  const world = makeWorld({ event_cursor: 3, world_time: 22 });
  const agents: PresentedRecord<(typeof world.agents)[number]>[] = [
    ...world.agents.map((value) => ({ completeness: "exact" as const, value })),
    {
      completeness: "projected-partial",
      value: { id: "unknown_status", position: "meadow" },
    },
  ];
  return {
    runId: "mock-c17-v1",
    sourceKey: "fixture:mock-c17-v1",
    revision: 4,
    firstCursor: 0,
    lastCursor: 3,
    source: "fixture",
    ingestedCursor: 3,
    presentedCursor: 3,
    world: {
      exactBaseCursor: 0,
      projectedThroughCursor: 3,
      worldTime: 22,
      agents,
      regions: world.regions.map((value) => ({ completeness: "exact", value })),
      homes: world.homes.map((value) => ({ completeness: "exact", value })),
      ruins: world.ruins.map((value) => ({ completeness: "exact", value })),
      pendingProposals: world.pending_proposals,
    },
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Live",
    },
    transport: {
      connection: "live",
      ingestedCursor: 3,
      retryable: true,
    },
    ...overrides,
  };
}

function chronicleData(
  overrides: Partial<SanitizedChronicleData> = {},
): SanitizedChronicleData {
  return {
    now: null,
    previous: [],
    upcoming: [],
    gaps: [],
    ...overrides,
  };
}
