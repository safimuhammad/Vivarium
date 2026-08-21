import type { LayeredHumanSnapshot } from
  "../../renderer2d/production/actors/LayeredHumanActor";
import type { PilotFrame, PilotPhase } from "./PilotTimeline";

export interface PilotPresentation {
  readonly beatNumber: 1 | 2 | 3 | 4 | 5 | 6;
  readonly action: string;
  readonly facing: "forward" | "right" | "back" | "left";
  readonly primary: string;
  readonly secondary: string;
  readonly accessible: string;
}

const STATIC_ACTION_COPY = {
  "idle-hold": "Standing idle",
  "walk-stop": "Coming to a stop",
  "walk-orient": "Turning to face forward",
  "talk-neutral-open": "Preparing to talk",
  "talk-one": "Talking",
  "talk-two": "Talking",
  "talk-neutral-close": "Finishing talking",
  "reach-action": "Giving resources",
  "reach-gap": "Finished giving resources",
  "work-action": "Building with a hammer",
  "work-gap": "Finished building",
  "fall-action": "Hurt - falling",
  "prone-hold": "Injured - lying prone",
  "recover-action": "Recovering - getting up",
  "settled-hold": "Recovered - standing",
} as const;

function unreachable(value: never): never {
  throw new Error(`Unhandled character pilot presentation value: ${String(value)}.`);
}

function beatNumberFor(phase: PilotPhase): PilotPresentation["beatNumber"] {
  switch (phase) {
    case "idle-hold":
      return 1;
    case "walk-route":
    case "walk-stop":
    case "walk-orient":
      return 2;
    case "talk-neutral-open":
    case "talk-one":
    case "talk-two":
    case "talk-neutral-close":
      return 3;
    case "reach-action":
    case "reach-gap":
      return 4;
    case "work-action":
    case "work-gap":
      return 5;
    case "fall-action":
    case "prone-hold":
    case "recover-action":
    case "settled-hold":
      return 6;
    default:
      return unreachable(phase);
  }
}

function facingFor(
  facing: LayeredHumanSnapshot["facing"],
): PilotPresentation["facing"] {
  switch (facing) {
    case "south":
      return "forward";
    case "east":
      return "right";
    case "north":
      return "back";
    case "west":
      return "left";
    default:
      return unreachable(facing);
  }
}

function directionFor(facing: LayeredHumanSnapshot["facing"]): string {
  switch (facing) {
    case "south":
      return "down";
    case "east":
      return "right";
    case "north":
      return "up";
    case "west":
      return "left";
    default:
      return unreachable(facing);
  }
}

function actionFor(frame: PilotFrame): string {
  const { phase } = frame;
  switch (phase) {
    case "walk-route": {
      const direction = directionFor(frame.actor.facing);
      if (frame.actor.activeAction === "moving") return `Walking ${direction}`;
      if (frame.actor.activeAction === "orienting") return `Turning ${direction}`;
      return "Starting to walk";
    }
    case "idle-hold":
    case "walk-stop":
    case "walk-orient":
    case "talk-neutral-open":
    case "talk-one":
    case "talk-two":
    case "talk-neutral-close":
    case "reach-action":
    case "reach-gap":
    case "work-action":
    case "work-gap":
    case "fall-action":
    case "prone-hold":
    case "recover-action":
    case "settled-hold":
      return STATIC_ACTION_COPY[phase];
    default:
      return unreachable(phase);
  }
}

/** Convert one semantic pilot frame into shared visual and accessible copy. */
export function presentPilotFrame(frame: PilotFrame): PilotPresentation {
  const beatNumber = beatNumberFor(frame.phase);
  const action = actionFor(frame);
  const facing = facingFor(frame.actor.facing);
  return Object.freeze({
    beatNumber,
    action,
    facing,
    primary: `${beatNumber} / 6 · ${action}`,
    secondary: `Facing ${facing}`,
    accessible: `Beat ${beatNumber} of 6. ${action}. Facing ${facing}.`,
  });
}
