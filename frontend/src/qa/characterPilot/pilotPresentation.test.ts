import { describe, expect, it } from "vitest";

import type { HumanSemanticAction } from
  "../../renderer2d/production/actors/LayeredHumanActor";
import type { ProductionFacing } from
  "../../renderer2d/production/assets/productionManifest";
import type { PilotFrame, PilotPhase } from "./PilotTimeline";
import { presentPilotFrame } from "./pilotPresentation";

type StaticPilotPhase = Exclude<PilotPhase, "walk-route">;

interface StaticCase {
  readonly beatNumber: 1 | 2 | 3 | 4 | 5 | 6;
  readonly action: string;
}

const STATIC_CASES = {
  "idle-hold": { beatNumber: 1, action: "Standing idle" },
  "walk-stop": { beatNumber: 2, action: "Coming to a stop" },
  "walk-orient": { beatNumber: 2, action: "Turning to face forward" },
  "talk-neutral-open": { beatNumber: 3, action: "Preparing to talk" },
  "talk-one": { beatNumber: 3, action: "Talking" },
  "talk-two": { beatNumber: 3, action: "Talking" },
  "talk-neutral-close": { beatNumber: 3, action: "Finishing talking" },
  "reach-action": { beatNumber: 4, action: "Giving resources" },
  "reach-gap": { beatNumber: 4, action: "Finished giving resources" },
  "work-action": { beatNumber: 5, action: "Building with a hammer" },
  "work-gap": { beatNumber: 5, action: "Finished building" },
  "fall-action": { beatNumber: 6, action: "Hurt - falling" },
  "prone-hold": { beatNumber: 6, action: "Injured - lying prone" },
  "recover-action": { beatNumber: 6, action: "Recovering - getting up" },
  "settled-hold": { beatNumber: 6, action: "Recovered - standing" },
} as const satisfies Readonly<Record<StaticPilotPhase, StaticCase>>;

const STATIC_CASE_ROWS = Object.entries(STATIC_CASES) as readonly (
  readonly [StaticPilotPhase, StaticCase]
)[];

const MOVEMENT_FACINGS = [
  ["south", "forward", "down"],
  ["east", "right", "right"],
  ["north", "back", "up"],
  ["west", "left", "left"],
] as const;

function frameFor(
  phase: PilotPhase,
  facing: ProductionFacing = "south",
  activeAction: HumanSemanticAction = null,
  clipId = "human-a:deliberately-unrelated:north",
): PilotFrame {
  return Object.freeze({
    phase,
    beat: "idle",
    elapsedMs: 0,
    actor: Object.freeze({
      facing,
      activeAction,
      layers: Object.freeze({
        body: Object.freeze({ clipId }),
      }),
    }),
    signals: Object.freeze([]),
    lastMarker: null,
  }) as unknown as PilotFrame;
}

describe("presentPilotFrame", () => {
  it.each(STATIC_CASE_ROWS)(
    "maps %s to its exact approved copy",
    (phase, { beatNumber, action }) => {
      const presentation = presentPilotFrame(frameFor(phase));

      expect(presentation).toEqual({
        beatNumber,
        action,
        facing: "forward",
        primary: `${beatNumber} / 6 · ${action}`,
        secondary: "Facing forward",
        accessible: `Beat ${beatNumber} of 6. ${action}. Facing forward.`,
      });
    },
  );

  it.each(MOVEMENT_FACINGS)(
    "maps moving and orienting %s route states to %s-facing copy",
    (actorFacing, facing, direction) => {
      const moving = presentPilotFrame(
        frameFor("walk-route", actorFacing, "moving"),
      );
      const orienting = presentPilotFrame(
        frameFor("walk-route", actorFacing, "orienting"),
      );

      expect(moving).toEqual({
        beatNumber: 2,
        action: `Walking ${direction}`,
        facing,
        primary: `2 / 6 · Walking ${direction}`,
        secondary: `Facing ${facing}`,
        accessible: `Beat 2 of 6. Walking ${direction}. Facing ${facing}.`,
      });
      expect(orienting).toEqual({
        beatNumber: 2,
        action: `Turning ${direction}`,
        facing,
        primary: `2 / 6 · Turning ${direction}`,
        secondary: `Facing ${facing}`,
        accessible: `Beat 2 of 6. Turning ${direction}. Facing ${facing}.`,
      });
    },
  );

  it("uses starting copy when the walk route has no movement action", () => {
    expect(presentPilotFrame(frameFor("walk-route", "east", null))).toEqual({
      beatNumber: 2,
      action: "Starting to walk",
      facing: "right",
      primary: "2 / 6 · Starting to walk",
      secondary: "Facing right",
      accessible: "Beat 2 of 6. Starting to walk. Facing right.",
    });
  });

  it("derives semantics from phase and actor state without parsing clip IDs", () => {
    const frame = frameFor(
      "work-action",
      "west",
      null,
      "human-a:hurt-fall:north",
    );
    const before = structuredClone(frame);

    expect(presentPilotFrame(frame)).toEqual({
      beatNumber: 5,
      action: "Building with a hammer",
      facing: "left",
      primary: "5 / 6 · Building with a hammer",
      secondary: "Facing left",
      accessible: "Beat 5 of 6. Building with a hammer. Facing left.",
    });
    expect(presentPilotFrame(frame)).toEqual(presentPilotFrame(frame));
    expect(frame).toEqual(before);
  });
});
