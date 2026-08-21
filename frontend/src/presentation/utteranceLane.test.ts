import { describe, expect, it } from "vitest";

import type { EventEnvelopeEntry } from "../app/schemas";
import { BeatDirector, type StoryMoment } from "./BeatDirector";
import { CHOREOGRAPHY_FAMILY_EVENT_TYPES } from "./choreography/registry";
import {
  isUtteranceEvent,
  isUtteranceMoment,
  UTTERANCE_EVENT_TYPES,
  utterancesFor,
} from "./utteranceLane";

function entry(
  cursor: number,
  type: string,
  payload: Readonly<Record<string, unknown>>,
  region: string | null = "meadow",
): EventEnvelopeEntry {
  return {
    cursor,
    event: { type, source: "agent_001", payload: { ...payload }, scope: "local", region, target: null, timestamp: cursor },
    resolved: { actor_id: "agent_001" },
    snapshot_after: null,
  };
}

const speakEntry = (cursor: number, targetId: string | null = null): EventEnvelopeEntry => entry(
  cursor,
  "speak",
  { speaker_id: "agent_001", target_id: targetId, region: "meadow", speak_energy_cost: 1, message: "Hold the line." },
);

const thoughtEntry = (cursor: number): EventEnvelopeEntry => entry(
  cursor,
  "self_talk",
  { agent_id: "agent_001", message: "I am, and that is enough." },
  null,
);

const physicalEntry = (cursor: number): EventEnvelopeEntry => entry(
  cursor,
  "home_built",
  { builder_id: "agent_001", home_id: "home_001", region: "meadow", materials_spent: 80, home_integrity: 100, message: "built" },
);

const moment = (entries: readonly EventEnvelopeEntry[]): StoryMoment =>
  new BeatDirector().group([...entries])[0]!;

const regions = (map: Readonly<Record<string, string>>) =>
  (beingId: string): string | null => map[beingId] ?? null;

describe("the utterance lane's membership", () => {
  it("is exactly the communication choreography family, and cannot drift from it", () => {
    // The two lists are maintained in different files for different reasons.
    // If a 29th event type ever joins `communication`, this fails rather than
    // silently leaving it stuck on the stage.
    expect([...UTTERANCE_EVENT_TYPES].sort())
      .toEqual([...CHOREOGRAPHY_FAMILY_EVENT_TYPES.communication].sort());
  });

  it("routes speech and private thought to the overlay, and nothing else", () => {
    expect(isUtteranceEvent(speakEntry(1))).toBe(true);
    expect(isUtteranceEvent(thoughtEntry(2))).toBe(true);
    expect(isUtteranceEvent(physicalEntry(3))).toBe(false);
  });

  it("keeps a chained moment on the stage when any part of it moves a body", () => {
    // A moment is only display-only when EVERY piece of its evidence is: a chain
    // that happens to contain a `speak` alongside a physical beat still has a
    // body to move, and taking its lease away would leave that body unanimated.
    expect(isUtteranceMoment(moment([speakEntry(1)]))).toBe(true);
    expect(isUtteranceMoment(moment([thoughtEntry(1)]))).toBe(true);
    expect(isUtteranceMoment(moment([physicalEntry(1)]))).toBe(false);
    const mixed: StoryMoment = { ...moment([speakEntry(1)]), evidence: [speakEntry(1), physicalEntry(2)] };
    expect(isUtteranceMoment(mixed)).toBe(false);
  });
});

describe("the beats an utterance publishes", () => {
  it("carries the words verbatim, over the being who said them", () => {
    const [utterance] = utterancesFor(moment([speakEntry(4)]), regions({ agent_001: "meadow" }));
    expect(utterance).toMatchObject({
      cursor: 4,
      beingId: "agent_001",
      targetId: null,
      regionId: "meadow",
      text: "Hold the line.",
      variant: "spoken",
      eventType: "speak",
    });
  });

  it("calls a same-region targeted line a whisper and a distant one spoken", () => {
    // Byte-identical to `speakDefinition`'s own `localTarget` test, so the
    // bubble grammar cannot diverge between the two lanes.
    const near = utterancesFor(
      moment([speakEntry(4, "agent_002")]),
      regions({ agent_001: "meadow", agent_002: "meadow" }),
    );
    const far = utterancesFor(
      moment([speakEntry(4, "agent_002")]),
      regions({ agent_001: "meadow", agent_002: "warm_springs" }),
    );
    expect(near[0]?.variant).toBe("whisper");
    expect(far[0]?.variant).toBe("spoken");
  });

  it("reads a private thought's region from the world, because its payload carries none", () => {
    // The backend never stamps a region on `self_talk` (the event is PRIVATE and
    // routed nowhere), so a lane that trusted the payload would put every
    // thought in no region at all.
    const [utterance] = utterancesFor(moment([thoughtEntry(9)]), regions({ agent_001: "nirvana_west" }));
    expect(utterance).toMatchObject({
      beingId: "agent_001",
      regionId: "nirvana_west",
      variant: "thought",
      text: "I am, and that is enough.",
    });
  });

  it("skips evidence it cannot read rather than costing the run", () => {
    const broken = moment([entry(1, "speak", { speaker_id: 7 })]);
    expect(utterancesFor(broken, regions({}))).toEqual([]);
  });
});
