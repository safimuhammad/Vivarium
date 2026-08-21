import { describe, expect, it } from "vitest";

import type { ActorVisualIntent } from "../contracts";
import {
  boundLocomotion,
  gateLocomotion,
  locomotionFor,
  routeDistancePx,
  truncateApproach,
  WALK_MAX_DISTANCE_PX,
} from "./locomotionGate";

const move = (
  waypoints: readonly Readonly<{ x: number; y: number }>[],
  marker: string | null = "work-contact",
): ActorVisualIntent => ({
  actorId: "agent_001",
  kind: "move",
  target: waypoints.at(-1) ?? null,
  waypoints,
  facing: "east",
  marker,
});

/** A cardinal route of `tiles` 32px steps east. */
const route = (tiles: number) =>
  Array.from({ length: tiles + 1 }, (_, index) => ({ x: index * 32, y: 0 }));

describe("routeDistancePx", () => {
  it("follows the waypoints rather than the straight line between the ends", () => {
    expect(routeDistancePx([{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }])).toBe(200);
    expect(routeDistancePx([{ x: 0, y: 0 }])).toBe(0);
    expect(routeDistancePx([])).toBe(0);
  });
});

describe("locomotionFor", () => {
  it("walks up to the threshold and cuts beyond it", () => {
    expect(locomotionFor([{ x: 0, y: 0 }, { x: WALK_MAX_DISTANCE_PX, y: 0 }])).toBe("walk");
    expect(locomotionFor([{ x: 0, y: 0 }, { x: WALK_MAX_DISTANCE_PX + 1, y: 0 }])).toBe("cut");
  });

  it("treats a route with nothing to travel as a walk", () => {
    // Cutting a zero-length route would fade a being out and back in exactly
    // where it already stood.
    expect(locomotionFor([])).toBe("walk");
    expect(locomotionFor([{ x: 10, y: 10 }])).toBe("walk");
  });
});

describe("gateLocomotion", () => {
  it("leaves a near walk exactly as planned", () => {
    const near = move(route(4));
    expect(gateLocomotion(near)).toBe(near);
  });

  it("turns a far walk into a cut to the same place, facing the same way", () => {
    const far = move(route(40));
    const gated = gateLocomotion(far);
    expect(gated).toMatchObject({
      actorId: "agent_001",
      kind: "fade-reposition",
      repositionReason: "distance-cut",
      target: { x: 40 * 32, y: 0 },
      facing: "east",
      // The marker is what the settlement handshake and the renderer's command
      // binding key on: a cut beat must still commit at the same point in the
      // timeline the walking one would have.
      marker: "work-contact",
    });
  });

  it("drops the waypoints, which is what collapses the scene's duration", () => {
    // `movementBudgetMs` only stretches a phase to cover `move` intents that
    // carry two or more waypoints, so a cut beat falls back to its definition's
    // own base timing without any duration arithmetic here.
    expect(gateLocomotion(move(route(40)))).not.toHaveProperty("waypoints");
  });

  it("never touches an intent that is not a walk", () => {
    const pose: ActorVisualIntent = { actorId: "agent_001", kind: "work", target: null, marker: null };
    expect(gateLocomotion(pose)).toBe(pose);
  });

  it("leaves a walk alone when there is nowhere identifiable to cut to", () => {
    const nowhere: ActorVisualIntent = { actorId: "agent_001", kind: "move", target: null, marker: null };
    expect(gateLocomotion(nowhere)).toBe(nowhere);
  });
});

describe("truncateApproach", () => {
  it("keeps the route whole when it is already inside the threshold", () => {
    const whole = route(4);
    const truncated = truncateApproach(whole, WALK_MAX_DISTANCE_PX);
    expect(truncated.cutFrom).toBeNull();
    expect(truncated.waypoints).toBe(whole);
  });

  it("keeps the SUFFIX of a long route, ending exactly where the whole route ended", () => {
    const truncated = truncateApproach(route(40), WALK_MAX_DISTANCE_PX);
    expect(truncated.waypoints.at(-1)).toEqual({ x: 40 * 32, y: 0 });
    expect(routeDistancePx(truncated.waypoints)).toBeLessThanOrEqual(WALK_MAX_DISTANCE_PX);
  });

  it("cuts to an EXISTING waypoint of the certified route, never to an invented point", () => {
    const whole = route(40);
    const truncated = truncateApproach(whole, WALK_MAX_DISTANCE_PX);
    // This is the legality argument: `presentationRouteIsClear` sweeps every
    // waypoint envelope, so any waypoint of an accepted route is a point the
    // renderer will accept a reposition to.
    expect(whole).toContainEqual(truncated.cutFrom);
    expect(truncated.waypoints[0]).toEqual(truncated.cutFrom);
  });

  it("keeps the truncated tail a contiguous suffix of the original route", () => {
    const whole = route(40);
    const truncated = truncateApproach(whole, WALK_MAX_DISTANCE_PX);
    const start = whole.findIndex((point) => point.x === truncated.waypoints[0]!.x
      && point.y === truncated.waypoints[0]!.y);
    expect(truncated.waypoints).toEqual(whole.slice(start));
  });

  it("ALWAYS leaves at least one segment to walk — the departure contract", () => {
    // A being that is cut all the way onto its own gate would have left the
    // region without ever being seen to. One segment is the floor even when the
    // budget is zero.
    const truncated = truncateApproach(route(40), 0);
    expect(truncated.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(truncated.cutFrom).not.toBeNull();
  });

  it("leaves a route with nothing to travel exactly as it was", () => {
    const single = [{ x: 10, y: 10 }];
    expect(truncateApproach(single, WALK_MAX_DISTANCE_PX).cutFrom).toBeNull();
    expect(truncateApproach([], WALK_MAX_DISTANCE_PX).cutFrom).toBeNull();
  });
});

describe("boundLocomotion", () => {
  it("leaves a walk that is already inside the threshold exactly as planned", () => {
    const near = move(route(4));
    expect(boundLocomotion(near)).toBe(near);
  });

  it("truncates a long walk instead of cutting it away entirely", () => {
    const bounded = boundLocomotion(move(route(40), "departure-gate-reached"));
    // Still a walk. A region transition may not become a teleport.
    expect(bounded.kind).toBe("move");
    expect(bounded.marker).toBe("departure-gate-reached");
    expect(bounded.facing).toBe("east");
    // Still ends at the gate.
    expect(bounded.target).toEqual({ x: 40 * 32, y: 0 });
    expect(bounded.waypoints?.at(-1)).toEqual({ x: 40 * 32, y: 0 });
    // Bounded.
    expect(routeDistancePx(bounded.waypoints ?? [])).toBeLessThanOrEqual(WALK_MAX_DISTANCE_PX);
    // And it declares where it was cut from.
    expect(bounded.cutFrom).toEqual(bounded.waypoints?.[0]);
  });

  it("never declares a cut origin it does not need", () => {
    expect(boundLocomotion(move(route(4)))).not.toHaveProperty("cutFrom");
  });

  it("never touches an intent that is not a walk", () => {
    const pose: ActorVisualIntent = { actorId: "agent_001", kind: "work", target: null, marker: null };
    expect(boundLocomotion(pose)).toBe(pose);
  });

  it("leaves a walk alone when it carries no route to truncate", () => {
    const nowhere: ActorVisualIntent = {
      actorId: "agent_001",
      kind: "move",
      target: { x: 1, y: 1 },
      marker: null,
    };
    expect(boundLocomotion(nowhere)).toBe(nowhere);
  });
});
