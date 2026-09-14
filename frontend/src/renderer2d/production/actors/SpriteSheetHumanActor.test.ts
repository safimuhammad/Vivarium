/**
 * @fileoverview TDD spec for `SpriteSheetHumanActor` — locomotion, snapshot,
 * scheduling core (Task 3 of the chibi sprite-sheet actor integration).
 *
 * Step 1 — command union enumerated from `LayeredHumanActor.apply`
 * ------------------------------------------------------------------
 * `HumanPrimitiveCommand` (declared in `./LayeredHumanActor.ts`) is a
 * 11-member discriminated union on `kind`. Every member and its payload,
 * copied verbatim from source:
 *
 *  1. `{ kind: "move"; waypoints: readonly Vec2[]; speedPixelsPerSecond: number; gait: "walk" | "run" }`
 *  2. `{ kind: "orient"; facing: Direction4 }`
 *  3. `{ kind: "play-body"; action: PlayableBodyAction }`
 *     (`PlayableBodyAction` = `HumanBodyAction` minus `"idle" | "walk" | "run" | "turn" | "stop"`,
 *     plus the atlas-only `"kneel" | "gather"` verbs
 *     = `"reach-give" | "work" | "hurt-fall" | "prone" | "dead" | "kneel" | "gather"`)
 *  4. `{ kind: "set-face"; expression: HumanExpression }`
 *  5. `{ kind: "set-held"; heldId: string | null }`
 *  6. `{ kind: "set-status"; status: "alive" | "paralyzed" | "dead" }`
 *  7. `{ kind: "recover" }`
 *  8. `{ kind: "reposition"; position: Vec2; reason: "reduced-motion" | "fallback" | "region-transition" }`
 *  9. `{ kind: "set-offset"; offset: Vec2 }`
 * 10. `{ kind: "set-selected"; selected: boolean }`
 * 11. `{ kind: "clear-body" }`
 *
 * `SpriteSheetHumanActor.apply`/`stageCommands` must accept all eleven (never
 * throw, never silently drop) and be covered by a compile-time
 * exhaustiveness check in the `default` branch.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Vec2 } from "../../contracts";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../assets/productionManifest";
import * as failurePolicy from "../failurePolicy";
import { deriveHumanAppearance } from "./appearance";
import * as beingPalette from "./beingPalette";
import {
  BEING_CHIBI_ATLAS_ID,
  BEING_CHIBI_GEOMETRY,
  beingChibiFrameRect,
  characterIds,
  resolveBeingCharacter,
} from "./beingChibiAtlas";
import type { HumanPrimitiveCommand } from "./LayeredHumanActor";
import { SpriteSheetHumanActor, type SpriteSheetHumanActorOptions } from "./SpriteSheetHumanActor";

const ALL_COMMAND_KINDS = [
  "move",
  "orient",
  "play-body",
  "clear-body",
  "set-face",
  "set-held",
  "set-status",
  "recover",
  "reposition",
  "set-offset",
  "set-selected",
] as const;

interface DrawCall {
  readonly sourceX: number;
  readonly sourceY: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly destinationX: number;
  readonly destinationY: number;
  readonly destinationWidth: number;
  readonly destinationHeight: number;
  readonly translateX: number;
  readonly translateY: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
  readonly alpha: number;
}

interface FillRectCall {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly fillStyle: string;
  readonly alpha: number;
}

function fakeLease(): ProductionAssetLease<ImageBitmap> {
  return {
    value: { label: BEING_CHIBI_ATLAS_ID } as unknown as ImageBitmap,
    release: vi.fn<() => void>(),
  };
}

function makeLeases(): ReadonlyMap<string, ProductionAssetLease<ImageBitmap>> {
  return new Map([[BEING_CHIBI_ATLAS_ID, fakeLease()]]);
}

function makeActor(
  overrides: Partial<SpriteSheetHumanActorOptions> = {},
): SpriteSheetHumanActor {
  return new SpriteSheetHumanActor({
    id: "agent_test",
    name: "Test Being",
    position: { x: 0, y: 0 },
    facing: "south",
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: makeLeases(),
    ...overrides,
  });
}

/** Recording stub `CanvasRenderingContext2D`, following `LayeredHumanActor.compositor.test.ts`. */
function recordingContext(
  calls: DrawCall[],
  fills: FillRectCall[] = [],
): CanvasRenderingContext2D {
  let translateX = 0;
  let translateY = 0;
  let scaleX = 1;
  let scaleY = 1;
  let rotation = 0;
  const context = {
    imageSmoothingEnabled: true,
    filter: "none",
    globalCompositeOperation: "source-over" as GlobalCompositeOperation,
    globalAlpha: 1,
    fillStyle: "#000000" as string | CanvasGradient | CanvasPattern,
    save: (): void => undefined,
    restore: (): void => {
      translateX = 0;
      translateY = 0;
      scaleX = 1;
      scaleY = 1;
      rotation = 0;
    },
    translate: (x: number, y: number): void => {
      translateX = x;
      translateY = y;
    },
    scale: (x: number, y: number): void => {
      scaleX = x;
      scaleY = y;
    },
    rotate: (radians: number): void => {
      rotation = radians;
    },
    drawImage: (_image: CanvasImageSource, ...values: number[]): void => {
      const [sourceX, sourceY, sourceWidth, sourceHeight,
        destinationX, destinationY, destinationWidth, destinationHeight] = values;
      calls.push({
        sourceX: sourceX!,
        sourceY: sourceY!,
        sourceWidth: sourceWidth!,
        sourceHeight: sourceHeight!,
        destinationX: destinationX!,
        destinationY: destinationY!,
        destinationWidth: destinationWidth!,
        destinationHeight: destinationHeight!,
        translateX,
        translateY,
        scaleX,
        scaleY,
        rotation,
        alpha: context.globalAlpha,
      });
    },
    fillRect: (x: number, y: number, width: number, height: number): void => {
      fills.push({
        x,
        y,
        width,
        height,
        fillStyle: String(context.fillStyle),
        alpha: context.globalAlpha,
      });
    },
  };
  return context as unknown as CanvasRenderingContext2D;
}

/**
 * Install a mock `HTMLCanvasElement.prototype.getContext` that backs the
 * actor's shared offscreen tint-compositing scratch canvas, capturing the
 * `fillStyle`/`globalCompositeOperation` of its most recent `fillRect` call
 * — i.e. the tint color the actor last composited — without needing a real
 * browser 2D canvas (unavailable under jsdom). Returns a capture object the
 * test reads after calling `draw()`.
 */
function installTintScratchMock(): { fillStyle: string | null; composite: GlobalCompositeOperation | null } {
  const capture: { fillStyle: string | null; composite: GlobalCompositeOperation | null } = {
    fillStyle: null,
    composite: null,
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function scratchGetContext() {
    const ctx = {
      fillStyle: "#000000" as string | CanvasGradient | CanvasPattern,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      clearRect: (): void => undefined,
      drawImage: (): void => undefined,
      fillRect: (): void => {
        capture.fillStyle = String(ctx.fillStyle);
        capture.composite = ctx.globalCompositeOperation;
      },
    };
    return ctx as unknown as CanvasRenderingContext2D;
  });
  return capture;
}

describe("SpriteSheetHumanActor locomotion", () => {
  it("advances stride by distance, not time", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    // 3 legs of 9px each (stride = 9px/frame); speed = 72px/s chosen so every
    // dt below is an exact binary fraction (0.0625 = 1/16, 0.125 = 1/8) and
    // every distance/time product is exact IEEE-754, avoiding float flake.
    actor.apply(
      { kind: "move", waypoints: [{ x: 0, y: 27 }], speedPixelsPerSecond: 72, gait: "walk" },
      0,
    );
    const phases: number[] = [actor.snapshot().stridePhase];

    // Leg 1 (0 -> 9px) split across two uneven ticks: proves the result
    // depends only on cumulative distance, not on how many ticks or what
    // dt values were used to get there ("at any dt split").
    actor.advance(0.0625, 62.5);
    actor.advance(0.0625, 125);
    expect(actor.snapshot().distanceTravelled).toBe(9);
    phases.push(actor.snapshot().stridePhase);

    // Leg 2 (9 -> 18px), one tick.
    actor.advance(0.125, 250);
    expect(actor.snapshot().distanceTravelled).toBe(18);
    phases.push(actor.snapshot().stridePhase);

    // Leg 3 (18 -> 27px), one tick: completes the route (arrival).
    actor.advance(0.125, 375);

    expect(phases).toEqual([0, 1, 2]);
    expect(actor.snapshot().distanceTravelled).toBe(27);
  });

  it("idles on the passing frame when stationary", () => {
    const actor = makeActor({});
    expect(actor.snapshot().stridePhase).toBe(1);
    expect(actor.snapshot().routeActive).toBe(false);

    // South-directed, matching the default facing: isolates idle-vs-moving
    // frame selection from turn-commit timing (covered separately below).
    actor.apply(
      { kind: "move", waypoints: [{ x: 0, y: 9 }], speedPixelsPerSecond: 9, gait: "walk" },
      0,
    );
    actor.advance(1, 1000);
    const arrived = actor.snapshot();
    expect(arrived.distanceTravelled).toBe(9);
    expect(arrived.routeActive).toBe(false);
    expect(arrived.stridePhase).toBe(1);
  });

  it("mirrors the side sheet when facing west", () => {
    const idlePassing = beingChibiFrameRect("walk-side-1");

    const west = makeActor({ facing: "west", position: { x: 40, y: 60 } });
    const westCalls: DrawCall[] = [];
    west.draw(recordingContext(westCalls));
    expect(westCalls).toHaveLength(1);
    expect(westCalls[0]!.scaleX).toBe(-1);
    expect(westCalls[0]!.scaleY).toBe(1);
    expect(westCalls[0]!.translateX).toBe(40);
    expect(westCalls[0]!.translateY).toBe(60);
    expect(westCalls[0]!.sourceX).toBe(idlePassing.x);
    expect(westCalls[0]!.sourceY).toBe(idlePassing.y);
    // Feet-anchored destination rect, per being-chibi.json's feet {11, 46}:
    // drawn in the scaled/translated space, so the destination origin is
    // simply the negated feet pivot regardless of mirroring.
    expect(westCalls[0]!.destinationX).toBe(-BEING_CHIBI_GEOMETRY.feet.x);
    expect(westCalls[0]!.destinationY).toBe(-BEING_CHIBI_GEOMETRY.feet.y);
    expect(westCalls[0]!.destinationX).toBe(-11);
    expect(westCalls[0]!.destinationY).toBe(-46);
    expect(westCalls[0]!.destinationWidth).toBe(22);
    expect(westCalls[0]!.destinationHeight).toBe(48);

    const east = makeActor({ facing: "east", position: { x: 40, y: 60 } });
    const eastCalls: DrawCall[] = [];
    east.draw(recordingContext(eastCalls));
    expect(eastCalls).toHaveLength(1);
    expect(eastCalls[0]!.scaleX).toBe(1);
    expect(eastCalls[0]!.sourceX).toBe(idlePassing.x);
    expect(eastCalls[0]!.sourceY).toBe(idlePassing.y);
    expect(eastCalls[0]!.destinationX).toBe(-11);
    expect(eastCalls[0]!.destinationY).toBe(-46);
    expect(eastCalls[0]!.destinationWidth).toBe(22);
    expect(eastCalls[0]!.destinationHeight).toBe(48);
  });

  it("returns a near deadline while walking and blink-time when idle", () => {
    const walking = makeActor({});
    // South-directed, matching the default facing: no turn hold to isolate
    // the walking-cadence deadline from turn-commit timing (covered below).
    walking.apply(
      { kind: "move", waypoints: [{ x: 0, y: 900 }], speedPixelsPerSecond: 90, gait: "walk" },
      0,
    );
    const walkingDeadline = walking.nextDeadlineMs();
    expect(walkingDeadline).not.toBeNull();
    expect(walkingDeadline).toBeCloseTo(1_000 / 30, 10);

    const idle = makeActor({});
    const idleDeadline = idle.nextDeadlineMs();
    expect(idleDeadline).not.toBeNull();
    expect(idleDeadline as number).toBeGreaterThanOrEqual(3_000);
    expect(idleDeadline as number).toBeLessThan(3_000 + 4_001);

    const reducedMotion = makeActor({ reducedMotion: true });
    expect(reducedMotion.nextDeadlineMs()).toBeNull();
  });

  it("fade contract: fallback reposition fades out, cancelFallbackReposition restores", () => {
    const actor = makeActor({ position: { x: 10, y: 20 } });
    actor.apply({ kind: "reposition", position: { x: 100, y: 200 }, reason: "fallback" }, 0);

    const justStarted = actor.snapshot();
    expect(justStarted.opacity).toBe(1);
    expect(justStarted.reposition).toEqual({ phase: "fade-out", reason: "fallback", target: { x: 100, y: 200 } });

    actor.advance(0.05, 50);
    const midFade = actor.snapshot();
    expect(midFade.opacity).toBeGreaterThan(0);
    expect(midFade.opacity).toBeLessThan(1);
    expect(midFade.position).toEqual({ x: 10, y: 20 });
    expect(midFade.reposition?.phase).toBe("fade-out");

    actor.cancelFallbackReposition();
    const restored = actor.snapshot();
    expect(restored.opacity).toBe(1);
    expect(restored.reposition).toBeNull();
    expect(restored.position).toEqual({ x: 10, y: 20 });
  });

  it("presence-fade contract: beginPresenceVanish fades out in place and HOLDS invisible (no auto-reveal)", () => {
    // Backs the door-anchored home-interaction motion contract (SpatialDirector /
    // ProductionSceneGraph's "presence-fade" command): a being ducking inside a
    // home stays invisible for the whole hold/consequence phase, however long
    // that takes -- unlike the ordinary "fallback" reposition fade, which always
    // auto-reveals itself ~360ms later regardless of scene duration.
    const actor = makeActor({ position: { x: 10, y: 20 } });
    actor.apply({ kind: "orient", facing: "south" }, 0);
    actor.beginPresenceVanish();

    const justStarted = actor.snapshot();
    expect(justStarted.opacity).toBe(1);
    expect(justStarted.position).toEqual({ x: 10, y: 20 });

    actor.advance(0.05, 50);
    const midFade = actor.snapshot();
    expect(midFade.opacity).toBeGreaterThan(0);
    expect(midFade.opacity).toBeLessThan(1);
    expect(midFade.position).toEqual({ x: 10, y: 20 });

    // Fully faded well before 180ms elapses more; then advance a long,
    // arbitrary amount of additional time (standing in for however long the
    // choreography's hold/consequence phase actually lasts) and confirm it
    // stays invisible instead of auto-revealing.
    actor.advance(0.2, 250);
    const vanished = actor.snapshot();
    expect(vanished.opacity).toBe(0);
    expect(vanished.position).toEqual({ x: 10, y: 20 });

    actor.advance(5, 5_250);
    const stillVanished = actor.snapshot();
    expect(stillVanished.opacity).toBe(0);
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("presence-fade contract: beginPresenceReveal fades a vanished being back to visible in place", () => {
    const actor = makeActor({ position: { x: 10, y: 20 } });
    actor.beginPresenceVanish();
    actor.advance(0.2, 200);
    expect(actor.snapshot().opacity).toBe(0);

    actor.beginPresenceReveal();
    const revealDeadline = actor.nextDeadlineMs();
    expect(revealDeadline).not.toBeNull();
    expect(revealDeadline as number).toBeGreaterThan(200);

    actor.advance(0.05, 250);
    const midReveal = actor.snapshot();
    expect(midReveal.opacity).toBeGreaterThan(0);
    expect(midReveal.opacity).toBeLessThan(1);
    expect(midReveal.position).toEqual({ x: 10, y: 20 });

    actor.advance(0.2, 450);
    const revealed = actor.snapshot();
    expect(revealed.opacity).toBe(1);
    expect(revealed.reposition).toBeNull();
    expect(revealed.position).toEqual({ x: 10, y: 20 });
  });

  it("beginPresenceReveal is a no-op when the being is not currently vanished", () => {
    const actor = makeActor({ position: { x: 10, y: 20 } });
    const before = actor.snapshot();
    actor.beginPresenceReveal();
    expect(actor.snapshot()).toEqual(before);
  });

  it("an ordinary command supersedes an in-flight or held vanish, restoring full visibility immediately", () => {
    // "or when a later event places them outside again" -- SpatialDirector
    // drives vanish/reveal purely off beat lifecycle, never invented
    // occupancy state, so any later legitimate command (a fresh move,
    // death, paralysis, ...) must be able to unconditionally restore
    // visibility rather than leaving a being stuck invisible.
    const actor = makeActor({ position: { x: 10, y: 20 } });
    actor.beginPresenceVanish();
    actor.advance(0.2, 200);
    expect(actor.snapshot().opacity).toBe(0);

    actor.apply({ kind: "move", waypoints: [{ x: 50, y: 20 }], speedPixelsPerSecond: 40, gait: "walk" }, 200);
    expect(actor.snapshot().opacity).toBe(1);
    expect(actor.snapshot().reposition).toBeNull();
  });

  it("beginPresenceVanish is a no-op once the being is dead", () => {
    const actor = makeActor({ position: { x: 10, y: 20 } });
    actor.apply({ kind: "set-status", status: "dead" }, 0);
    actor.beginPresenceVanish();
    expect(actor.snapshot().opacity).toBe(1);
  });

  it("stagePosition adopts immediately; its returned handle idempotently restores prior transient state", () => {
    const actor = makeActor({ position: { x: 5, y: 5 } });
    actor.apply(
      { kind: "move", waypoints: [{ x: 50, y: 5 }], speedPixelsPerSecond: 10, gait: "walk" },
      0,
    );
    const rollback = actor.stagePosition({ x: 80, y: 80 });
    expect(rollback).not.toBeNull();
    expect(actor.snapshot().position).toEqual({ x: 80, y: 80 });
    expect(actor.snapshot().routeActive).toBe(false);

    rollback!();
    const restored = actor.snapshot();
    expect(restored.position).toEqual({ x: 5, y: 5 });
    expect(restored.routeActive).toBe(true);

    // Idempotent: calling again does nothing further.
    rollback!();
    expect(actor.snapshot().position).toEqual({ x: 5, y: 5 });
  });
});

describe("SpriteSheetHumanActor selected feet marker", () => {
  it("draws a restrained two-tone feet bracket only for the selected actor", () => {
    const actor = makeActor({ position: { x: 40, y: 60 } });
    const before: FillRectCall[] = [];
    actor.draw(recordingContext([], before));
    expect(before).toEqual([]);

    actor.apply({ kind: "set-selected", selected: true }, 0);
    const fills: FillRectCall[] = [];
    actor.draw(recordingContext([], fills));
    expect(fills).toEqual([
      { x: 31, y: 60, width: 18, height: 3, fillStyle: "#2b2420", alpha: 1 },
      { x: 31, y: 60, width: 4, height: 1, fillStyle: "#e1b454", alpha: 1 },
      { x: 31, y: 60, width: 1, height: 3, fillStyle: "#e1b454", alpha: 1 },
      { x: 45, y: 60, width: 4, height: 1, fillStyle: "#e1b454", alpha: 1 },
      { x: 48, y: 60, width: 1, height: 3, fillStyle: "#e1b454", alpha: 1 },
    ]);

    actor.apply({ kind: "set-selected", selected: false }, 1);
    const after: FillRectCall[] = [];
    actor.draw(recordingContext([], after));
    expect(after).toEqual([]);
  });

  it("uses the same presentation alpha as the selected sprite while fading and terminal", () => {
    const actor = makeActor({ position: { x: 40, y: 60 } });
    actor.apply({ kind: "set-selected", selected: true }, 0);
    actor.apply({ kind: "reposition", position: { x: 100, y: 60 }, reason: "fallback" }, 0);
    actor.advance(0.05, 50);

    const fadingDraws: DrawCall[] = [];
    const fadingFills: FillRectCall[] = [];
    actor.draw(recordingContext(fadingDraws, fadingFills));
    expect(fadingFills).toHaveLength(5);
    expect(fadingFills.every(({ alpha }) => alpha === fadingDraws[0]!.alpha)).toBe(true);
    expect(fadingDraws[0]!.alpha).toBeGreaterThan(0);
    expect(fadingDraws[0]!.alpha).toBeLessThan(1);

    actor.apply({ kind: "set-status", status: "dead" }, 50);
    const terminalDraws: DrawCall[] = [];
    const terminalFills: FillRectCall[] = [];
    actor.draw(recordingContext(terminalDraws, terminalFills));
    expect(terminalFills).toHaveLength(5);
    expect(terminalFills.every(({ alpha }) => alpha === terminalDraws[0]!.alpha)).toBe(true);
  });
});

describe("SpriteSheetHumanActor turn-commit hold (choreography timing parity)", () => {
  it("delays locomotion start by the turn-commit duration when a move begins with a facing change", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    // A long route (900px at 90px/s = 10s) so 1s of post-hold locomotion
    // doesn't also complete the route within the same asserted tick.
    actor.apply(
      { kind: "move", waypoints: [{ x: 900, y: 0 }], speedPixelsPerSecond: 90, gait: "walk" },
      0,
    );
    // Facing commits immediately to the new orientation...
    expect(actor.snapshot().facing).toBe("east");
    expect(actor.snapshot().activeAction).toBe("orienting");
    expect(actor.snapshot().distanceTravelled).toBe(0);

    const holdMs = actor.nextDeadlineMs();
    expect(holdMs).not.toBeNull();
    expect(holdMs as number).toBeGreaterThan(0);
    const half = (holdMs as number) / 2;

    // ...but no distance is covered until the hold elapses.
    actor.advance(half / 1_000, half);
    expect(actor.snapshot().distanceTravelled).toBe(0);
    expect(actor.snapshot().activeAction).toBe("orienting");

    actor.advance(half / 1_000, holdMs as number);
    expect(actor.snapshot().distanceTravelled).toBe(0);
    expect(actor.snapshot().activeAction).not.toBe("orienting");

    actor.advance(1, (holdMs as number) + 1_000);
    expect(actor.snapshot().distanceTravelled).toBeGreaterThan(0);
    expect(actor.snapshot().activeAction).toBe("moving");
  });

  it("commits the facing change synchronously under reducedMotion (no hold)", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south", reducedMotion: true });
    actor.apply(
      { kind: "move", waypoints: [{ x: 90, y: 0 }], speedPixelsPerSecond: 90, gait: "walk" },
      0,
    );
    expect(actor.snapshot().facing).toBe("east");
    expect(actor.snapshot().activeAction).not.toBe("orienting");
    expect(actor.nextDeadlineMs()).not.toBeNull();
    // No hold: nextDeadlineMs is the ordinary walking cadence, not a turn hold.
    expect(actor.nextDeadlineMs()).toBeCloseTo(1_000 / 30, 10);

    actor.advance(1, 1_000);
    expect(actor.snapshot().distanceTravelled).toBe(90);
    expect(actor.snapshot().routeActive).toBe(false);
  });

  it("nextDeadlineMs returns a future deadline while the turn hold is in effect", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    actor.apply(
      { kind: "move", waypoints: [{ x: 90, y: 0 }], speedPixelsPerSecond: 90, gait: "walk" },
      0,
    );
    const deadline = actor.nextDeadlineMs();
    expect(deadline).not.toBeNull();
    expect(deadline as number).toBeGreaterThan(0);

    actor.advance(0.001, 1);
    const midDeadline = actor.nextDeadlineMs();
    expect(midDeadline).not.toBeNull();
    expect(midDeadline as number).toBeGreaterThan(1);
  });

  it("also holds for a mid-route corner turn, not just the initial facing change", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    // Leg 2 is long (900px) so the final tick's post-hold locomotion doesn't
    // also complete the route within the same asserted tick.
    actor.apply(
      {
        kind: "move",
        waypoints: [{ x: 0, y: 90 }, { x: 900, y: 90 }],
        speedPixelsPerSecond: 180,
        gait: "walk",
      },
      0,
    );
    expect(actor.snapshot().facing).toBe("south");

    // 1s at 180px/s clears leg 1 (90px) with 500ms leftover, landing exactly
    // on the corner where leg 2 needs a turn to east — the hold consumes
    // that leftover time instead of also moving along leg 2 this tick.
    actor.advance(1, 1_000);
    expect(actor.snapshot().distanceTravelled).toBe(90);
    expect(actor.snapshot().facing).toBe("east");
    expect(actor.snapshot().activeAction).toBe("orienting");

    actor.advance(1, 2_000);
    expect(actor.snapshot().distanceTravelled).toBe(90);

    actor.advance(1, 3_000);
    expect(actor.snapshot().distanceTravelled).toBeGreaterThan(90);
    expect(actor.snapshot().activeAction).toBe("moving");
  });
});

describe("SpriteSheetHumanActor command union coverage", () => {
  it("clears a completed gather body pose without waiting for another action", () => {
    const actor = makeActor();
    actor.apply({ kind: "play-body", action: "gather" }, 0);
    expect(actor.snapshot().activeAction).toBe("gathering");
    actor.apply({ kind: "clear-body" }, 1);
    expect(actor.snapshot().activeAction).toBeNull();
    expect(actor.snapshot().layers.body.clipId).not.toBe("pose-crouch");
  });

  it.each(["paralyzed", "dead"] as const)("body cleanup preserves %s state", (status) => {
    const actor = makeActor();
    actor.apply({ kind: "set-status", status }, 0);
    actor.apply({ kind: "clear-body" }, 1);
    expect(actor.snapshot().activeAction).toBe(status === "dead" ? "dead" : "prone");
    expect(actor.snapshot().terminal).toBe(status === "dead");
    actor.apply({ kind: "move", waypoints: [{ x: 50, y: 0 }], speedPixelsPerSecond: 10, gait: "walk" }, 2);
    expect(actor.snapshot().routeActive).toBe(false);
  });

  it("body cleanup preserves an active route and turn timing", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    actor.apply({ kind: "move", waypoints: [{ x: 50, y: 0 }], speedPixelsPerSecond: 10, gait: "walk" }, 0);
    const before = actor.snapshot();
    const deadline = actor.nextDeadlineMs();
    actor.apply({ kind: "clear-body" }, 0);
    expect(actor.snapshot().activeAction).toBe(before.activeAction);
    expect(actor.snapshot().routeActive).toBe(true);
    expect(actor.nextDeadlineMs()).toBe(deadline);
    actor.advance(0.5, 500);
    actor.advance(0.5, 1_000);
    expect(actor.snapshot().position.x).toBeGreaterThan(0);
  });

  function sampleCommands(): readonly HumanPrimitiveCommand[] {
    return [
      { kind: "move", waypoints: [{ x: 5, y: 0 }], speedPixelsPerSecond: 10, gait: "walk" },
      { kind: "orient", facing: "east" },
      { kind: "play-body", action: "work" },
      { kind: "clear-body" },
      { kind: "set-face", expression: "talk-1" },
      { kind: "set-held", heldId: "basket" },
      { kind: "set-status", status: "paralyzed" },
      { kind: "recover" },
      { kind: "reposition", position: { x: 1, y: 1 }, reason: "reduced-motion" },
      { kind: "set-offset", offset: { x: 2, y: 2 } },
      { kind: "set-selected", selected: true },
    ];
  }

  it("enumerates exactly the eleven declared command kinds", () => {
    expect(sampleCommands().map((command) => command.kind).sort())
      .toEqual([...ALL_COMMAND_KINDS].sort());
  });

  it("accepts every declared command variant without throwing, storing state for each", () => {
    for (const command of sampleCommands()) {
      const actor = makeActor({});
      expect(() => actor.apply(command, 0)).not.toThrow();
      expect(() => actor.snapshot()).not.toThrow();
      expect(() => actor.draw(recordingContext([]))).not.toThrow();
    }
  });

  it("play-body dead/prone terminal-ish states are functionally applied, not just stored", () => {
    const dead = makeActor({});
    dead.apply({ kind: "play-body", action: "dead" }, 0);
    const deadSnapshot = dead.snapshot();
    expect(deadSnapshot.terminal).toBe(true);
    expect(deadSnapshot.activeAction).toBe("dead");
    expect(dead.nextDeadlineMs()).toBeNull();

    const paralyzed = makeActor({});
    paralyzed.apply({ kind: "play-body", action: "prone" }, 0);
    expect(paralyzed.snapshot().activeAction).toBe("prone");
    // Movement is blocked while paralyzed.
    paralyzed.apply(
      { kind: "move", waypoints: [{ x: 50, y: 0 }], speedPixelsPerSecond: 10, gait: "walk" },
      1,
    );
    expect(paralyzed.snapshot().routeActive).toBe(false);

    paralyzed.apply({ kind: "recover" }, 2);
    expect(paralyzed.snapshot().activeAction).toBe("recovering");
  });

  it("stores pose-visual commands (talk/reach/work) for Task 4 without acting on them yet", () => {
    const reaching = makeActor({});
    reaching.apply({ kind: "play-body", action: "reach-give" }, 0);
    expect(reaching.snapshot().activeAction).toBe("reaching");

    const working = makeActor({});
    working.apply({ kind: "play-body", action: "work" }, 0);
    expect(working.snapshot().activeAction).toBe("working");

    const hurt = makeActor({});
    hurt.apply({ kind: "play-body", action: "hurt-fall" }, 0);
    expect(hurt.snapshot().activeAction).toBe("hurt");

    const speaking = makeActor({});
    speaking.apply({ kind: "set-face", expression: "talk-2" }, 0);
    expect(speaking.snapshot().activeAction).toBe("speaking");
  });

  it("throws at runtime, in dev mode, on an unrecognized command kind (exhaustiveness guard)", () => {
    const actor = makeActor({});
    const bogus = { kind: "levitate" } as unknown as HumanPrimitiveCommand;
    expect(() => actor.apply(bogus, 0)).toThrow();
  });

  it("stageCommands rolls back the whole batch if one command throws", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    const badMove: HumanPrimitiveCommand = {
      kind: "move",
      waypoints: [{ x: Number.NaN, y: 0 }],
      speedPixelsPerSecond: 10,
      gait: "walk",
    };
    expect(() => actor.stageCommands(
      [{ kind: "orient", facing: "east" }, badMove],
      0,
    )).toThrow(TypeError);
    expect(actor.snapshot().facing).toBe("south");
  });

  it("stageCommands returns an idempotent rollback restoring pre-batch state", () => {
    const actor = makeActor({ position: { x: 0, y: 0 }, facing: "south" });
    const rollback = actor.stageCommands([{ kind: "orient", facing: "north" }], 0);
    expect(actor.snapshot().facing).toBe("north");
    rollback();
    expect(actor.snapshot().facing).toBe("south");
    rollback();
    expect(actor.snapshot().facing).toBe("south");
  });
});

describe("SpriteSheetHumanActor snapshot parity", () => {
  it("exposes the consumed ProductionHumanActorSnapshot fields", () => {
    const actor = makeActor({ id: "agent_snap", position: { x: 1, y: 2 }, facing: "south" });
    const snap = actor.snapshot();

    expect(snap.position).toEqual({ x: 1, y: 2 });
    expect(snap.facing).toBe("south");
    expect(snap.activeAction).toBeNull();
    expect(snap.opacity).toBe(1);
    expect(snap.terminal).toBe(false);
    expect(snap.distanceTravelled).toBe(0);
    expect(snap.stridePhase).toBe(1);
    expect(snap.reposition).toBeNull();
    expect(snap.artFallback).toBeNull();

    // A single-frame layers-compatible entry: one shared logical frame
    // reported under every LayeredHumanLayerSnapshot key.
    expect(snap.layers.body).toEqual(snap.layers.clothing);
    expect(snap.layers.body).toEqual(snap.layers.face);
    expect(snap.layers.body).toEqual(snap.layers.hair);
    expect(snap.layers.body).toEqual(snap.layers.held);
    expect(snap.layers.body).toEqual(snap.layers.status);
    expect(snap.layers.body.facing).toBe("south");
    expect(snap.layers.body.fallback).toBe(false);

    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.layers)).toBe(true);

    actor.apply({ kind: "play-body", action: "work" }, 0);
    expect(actor.snapshot().activeAction).toBe("working");

    actor.apply({ kind: "set-status", status: "dead" }, 1);
    const deadSnapshot = actor.snapshot();
    expect(deadSnapshot.activeAction).toBe("dead");
    expect(deadSnapshot.terminal).toBe(true);
  });

  it("marks artFallback and never throws when the atlas lease is unavailable", () => {
    const actor = makeActor({ atlasLeases: new Map() });
    expect(actor.snapshot().artFallback).toBe("person-marker");
    expect(actor.snapshot().layers.body.fallback).toBe(true);
    expect(() => actor.draw(recordingContext([]))).not.toThrow();
  });

  it("consults the shared decideAssetFallback policy rather than unconditionally degrading", () => {
    const spy = vi.spyOn(failurePolicy, "decideAssetFallback").mockReturnValue({
      action: "reject",
      reason: "required-marker-invalid",
      diagnostic: {
        code: "missing-character-art",
        subjectId: "agent_reject",
        regionId: null,
        occurrence: 1,
      },
    });
    try {
      const actor = makeActor({ id: "agent_reject", atlasLeases: new Map() });
      // The policy said "reject", not "continue with person-silhouette" —
      // the actor must honor that instead of hardcoding "person-marker".
      expect(actor.snapshot().artFallback).toBeNull();
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({
        failure: "missing-character-art",
        subjectId: "agent_reject",
        regionId: null,
        occurrence: 1,
      }));
      expect(() => actor.draw(recordingContext([]))).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SpriteSheetHumanActor disposal", () => {
  it("releases leases, is idempotent, and becomes permanently inert", () => {
    const release = vi.fn<() => void>();
    const leases = new Map([
      [BEING_CHIBI_ATLAS_ID, { value: {} as unknown as ImageBitmap, release }],
    ]);
    const actor = makeActor({ atlasLeases: leases });

    actor.dispose();
    expect(release).toHaveBeenCalledTimes(1);
    actor.dispose();
    expect(release).toHaveBeenCalledTimes(1);

    expect(actor.nextDeadlineMs()).toBeNull();
    expect(() => actor.apply({ kind: "orient", facing: "east" }, 0)).not.toThrow();
    expect(() => actor.draw(recordingContext([]))).not.toThrow();
    expect(actor.advance(1, 1_000)).toEqual([]);
  });
});

/**
 * @fileoverview Task 4 — pose grammar, terminal states, and deterministic
 * per-being palette (this actor's half of the palette integration; the
 * palette module itself is specced in `beingPalette.test.ts`).
 *
 * Pose-grammar timing constants asserted against below (kept in sync with
 * `SpriteSheetHumanActor.ts`'s own private constants of the same name):
 * `TALK_ALTERNATE_MS=200`, `WORK_ALTERNATE_MS=1000/3`, `BLINK_VISIBLE_MS=150`,
 * `HURT_TINT_MAX_ALPHA=0.5`/`HURT_TINT_DECAY_MS=500`,
 * `HURT_ROTATION_AMPLITUDE=0.09`/`HURT_ROTATION_DURATION_MS=1200`,
 * `FALL_ROTATION_DURATION_MS=550`, `PRONE_TINT="rgba(60,60,80,0.35)"`,
 * `PRONE_ALPHA_BASE=0.88`/`PRONE_ALPHA_AMPLITUDE=0.1`,
 * `RECOVER_ROTATION_DURATION_MS=900`, `DEAD_TINT="rgba(30,25,20,0.55)"`,
 * `BREATH_SCALE_AMPLITUDE=0.012`.
 */

describe("SpriteSheetHumanActor pose grammar — full command union (table-driven)", () => {
  /**
   * One representative pose-grammar expectation per `HumanPrimitiveCommand`
   * kind. The `switch` below is typed against the full union, so adding an
   * new command kind to `HumanPrimitiveCommand` without adding a case here
   * fails compilation (the `never` assignment in `default`) — the same
   * exhaustiveness guard `SpriteSheetHumanActor.apply` itself uses.
   */
  function checkPoseRow(kind: HumanPrimitiveCommand["kind"]): void {
    switch (kind) {
      case "move": {
        const actor = makeActor({});
        actor.apply({ kind: "move", waypoints: [{ x: 5, y: 0 }], speedPixelsPerSecond: 10, gait: "walk" }, 0);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "orient": {
        const actor = makeActor({});
        actor.apply({ kind: "orient", facing: "east" }, 0);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "play-body": {
        const actor = makeActor({});
        actor.apply({ kind: "play-body", action: "reach-give" }, 0);
        expect(actor.snapshot().layers.body.clipId).toBe("pose-reach");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        return;
      }
      case "clear-body": {
        const actor = makeActor({});
        actor.apply({ kind: "play-body", action: "gather" }, 0);
        actor.apply({ kind: "clear-body" }, 1);
        expect(actor.snapshot().activeAction).toBeNull();
        return;
      }
      case "set-face": {
        const actor = makeActor({});
        actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
        expect(actor.snapshot().activeAction).toBe("speaking");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        return;
      }
      case "set-held": {
        const actor = makeActor({});
        actor.apply({ kind: "set-held", heldId: "basket" }, 0);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "set-status": {
        const actor = makeActor({});
        actor.apply({ kind: "set-status", status: "dead" }, 0);
        expect(actor.snapshot().terminal).toBe(true);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
        return;
      }
      case "recover": {
        const actor = makeActor({});
        actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
        actor.apply({ kind: "recover" }, 1);
        expect(actor.snapshot().activeAction).toBe("recovering");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBeCloseTo(Math.PI / 2, 6);
        return;
      }
      case "reposition": {
        const actor = makeActor({});
        actor.apply({ kind: "reposition", position: { x: 1, y: 1 }, reason: "reduced-motion" }, 0);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "set-offset": {
        const actor = makeActor({});
        actor.apply({ kind: "set-offset", offset: { x: 2, y: 2 } }, 0);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "set-selected": {
        const actor = makeActor({});
        actor.apply({ kind: "set-selected", selected: true }, 0);
        expect(actor.snapshot().layers.body.clipId.endsWith(":selected")).toBe(true);
        return;
      }
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled pose-grammar row for command kind: ${String(_exhaustive)}`);
      }
    }
  }

  it("asserts a pose-grammar expectation for every declared command kind", () => {
    for (const kind of ALL_COMMAND_KINDS) checkPoseRow(kind);
  });
});

describe("SpriteSheetHumanActor pose grammar — play-body sub-actions (compile-exhaustive)", () => {
  function checkPlayBodyAction(
    action: "reach-give" | "work" | "hurt-fall" | "prone" | "dead" | "kneel" | "gather",
  ): void {
    switch (action) {
      case "reach-give": {
        const actor = makeActor({ id: "agent_reach" });
        actor.apply({ kind: "play-body", action: "reach-give" }, 0);
        expect(actor.snapshot().layers.body.clipId).toBe("pose-reach");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "kneel": {
        const actor = makeActor({ id: "agent_kneel" });
        actor.apply({ kind: "play-body", action: "kneel" }, 0);
        expect(actor.snapshot().activeAction).toBe("kneeling");
        expect(actor.snapshot().layers.body.clipId).toBe("pose-kneel");
        // Static hold, unlike "work": never alternates away from pose-kneel.
        actor.apply({ kind: "set-selected", selected: false }, 1_000);
        expect(actor.snapshot().layers.body.clipId).toBe("pose-kneel");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "gather": {
        const actor = makeActor({ id: "agent_gather" });
        actor.apply({ kind: "play-body", action: "gather" }, 0);
        expect(actor.snapshot().activeAction).toBe("gathering");
        expect(actor.snapshot().layers.body.clipId).toBe("pose-crouch");
        // Static hold, unlike "work": never alternates away from pose-crouch.
        actor.apply({ kind: "set-selected", selected: false }, 1_000);
        expect(actor.snapshot().layers.body.clipId).toBe("pose-crouch");
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBe(0);
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      case "work": {
        const actor = makeActor({ id: "agent_worker" });
        actor.apply({ kind: "play-body", action: "work" }, 0);
        const frameAt = (nowMs: number): string => {
          actor.apply({ kind: "set-selected", selected: false }, nowMs);
          return actor.snapshot().layers.body.clipId;
        };
        const early = frameAt(0);
        // Exactly 3 whole cadence periods later: guaranteed to flip parity
        // regardless of this agent's hash-derived phase offset.
        const later = frameAt(1_000);
        expect(["pose-crouch", "pose-reach"]).toContain(early);
        expect(["pose-crouch", "pose-reach"]).toContain(later);
        expect(later).not.toBe(early);
        return;
      }
      case "hurt-fall": {
        const actor = makeActor({ id: "agent_hurt" });
        const capture = installTintScratchMock();
        actor.apply({ kind: "play-body", action: "hurt-fall" }, 1_000);
        expect(actor.snapshot().activeAction).toBe("hurt");

        const start: DrawCall[] = [];
        actor.draw(recordingContext(start));
        expect(start[0]!.rotation).toBeCloseTo(0, 10);
        expect(capture.fillStyle).toBe("rgba(196,44,28,0.500)");
        expect(capture.composite).toBe("source-atop");

        capture.fillStyle = null;
        actor.apply({ kind: "set-selected", selected: false }, 1_000 + 250);
        const mid: DrawCall[] = [];
        actor.draw(recordingContext(mid));
        expect(capture.fillStyle).toBe("rgba(196,44,28,0.250)");
        expect(Math.abs(mid[0]!.rotation)).toBeLessThanOrEqual(0.09 + 1e-9);

        capture.fillStyle = null;
        actor.apply({ kind: "set-selected", selected: false }, 1_000 + 1_200);
        const settled: DrawCall[] = [];
        actor.draw(recordingContext(settled));
        expect(capture.fillStyle).toBeNull();
        expect(settled[0]!.rotation).toBe(0);
        return;
      }
      case "prone": {
        const actor = makeActor({ id: "agent_prone" });
        actor.apply({ kind: "play-body", action: "prone" }, 2_000);
        expect(actor.snapshot().terminal).toBe(false);
        expect(actor.snapshot().activeAction).toBe("prone");

        const capture = installTintScratchMock();
        const start: DrawCall[] = [];
        actor.draw(recordingContext(start));
        expect(start[0]!.rotation).toBe(0);
        expect(capture.fillStyle).toBeNull();

        actor.apply({ kind: "set-selected", selected: false }, 2_000 + 275);
        const mid: DrawCall[] = [];
        actor.draw(recordingContext(mid));
        const u = 275 / 550;
        expect(mid[0]!.rotation).toBeCloseTo(u * u * (Math.PI / 2), 10);

        capture.fillStyle = null;
        actor.apply({ kind: "set-selected", selected: false }, 2_000 + 550);
        const settled: DrawCall[] = [];
        actor.draw(recordingContext(settled));
        expect(settled[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
        expect(capture.fillStyle).toBe("rgba(60,60,80,0.35)");
        expect(capture.composite).toBe("source-atop");
        expect(settled[0]!.alpha).toBeGreaterThanOrEqual(0.88 - 0.1 - 1e-9);
        expect(settled[0]!.alpha).toBeLessThanOrEqual(0.88 + 0.1 + 1e-9);
        return;
      }
      case "dead": {
        const actor = makeActor({ id: "agent_dead" });
        const capture = installTintScratchMock();
        actor.apply({ kind: "play-body", action: "dead" }, 3_000);
        expect(actor.snapshot().terminal).toBe(true);
        const calls: DrawCall[] = [];
        actor.draw(recordingContext(calls));
        expect(calls[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);
        expect(capture.fillStyle).toBe("rgba(30,25,20,0.55)");
        expect(capture.composite).toBe("source-atop");
        expect(calls[0]!.alpha).toBe(1);
        return;
      }
      default: {
        const _exhaustive: never = action;
        throw new Error(`Unhandled play-body pose row for action: ${String(_exhaustive)}`);
      }
    }
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("maps every PlayableBodyAction to its pose frame/transform", () => {
    for (const action of ["reach-give", "work", "hurt-fall", "prone", "dead", "kneel", "gather"] as const) {
      checkPlayBodyAction(action);
    }
  });
});

describe("SpriteSheetHumanActor pose grammar — recover rotation staging", () => {
  it("eases rotation from pi/2 back to 0 over the recovery window, then holds at 0", () => {
    const actor = makeActor({ id: "agent_recover" });
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    actor.apply({ kind: "recover" }, 500);
    expect(actor.snapshot().activeAction).toBe("recovering");

    const start: DrawCall[] = [];
    actor.draw(recordingContext(start));
    expect(start[0]!.rotation).toBeCloseTo(Math.PI / 2, 10);

    actor.apply({ kind: "set-selected", selected: false }, 500 + 450);
    const mid: DrawCall[] = [];
    actor.draw(recordingContext(mid));
    expect(mid[0]!.rotation).toBeCloseTo((Math.PI / 2) * 0.5, 10);

    actor.apply({ kind: "set-selected", selected: false }, 500 + 900);
    const done: DrawCall[] = [];
    actor.draw(recordingContext(done));
    expect(done[0]!.rotation).toBeCloseTo(0, 10);

    actor.apply({ kind: "set-selected", selected: false }, 500 + 5_000);
    const held: DrawCall[] = [];
    actor.draw(recordingContext(held));
    expect(held[0]!.rotation).toBeCloseTo(0, 10);
  });
});

describe("SpriteSheetHumanActor pose grammar — talk alternation", () => {
  it("alternates pose-talk with the idle stance while speaking, and eventually shows both", () => {
    const actor = makeActor({ id: "agent_talker", facing: "south" });
    actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
    const frames = new Set<string>();
    for (let step = 0; step < 6; step += 1) {
      actor.apply({ kind: "set-selected", selected: false }, step * 200);
      frames.add(actor.snapshot().layers.body.clipId);
    }
    expect(frames.has("pose-talk")).toBe(true);
    expect(frames.size).toBeGreaterThan(1);
    for (const frame of frames) expect(["pose-talk", "walk-down-1"]).toContain(frame);
  });

  it("is deterministic: the same agent id replays an identical frame sequence", () => {
    const sequenceFor = (): readonly string[] => {
      const actor = makeActor({ id: "agent_talk_determinism" });
      actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
      const frames: string[] = [];
      for (let step = 0; step < 8; step += 1) {
        actor.apply({ kind: "set-selected", selected: false }, step * 200);
        frames.push(actor.snapshot().layers.body.clipId);
      }
      return frames;
    };
    expect(sequenceFor()).toEqual(sequenceFor());
  });

  it("gives different agent ids a different alternation phase (visual variety, not lockstep)", () => {
    const framesFor = (id: string): string => {
      const actor = makeActor({ id });
      actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
      const frames: string[] = [];
      for (let step = 0; step < 10; step += 1) {
        actor.apply({ kind: "set-selected", selected: false }, step * 40);
        frames.push(actor.snapshot().layers.body.clipId);
      }
      return frames.join(",");
    };
    const sequences = ["agent_phase_a", "agent_phase_b", "agent_phase_c", "agent_phase_d"].map(framesFor);
    expect(new Set(sequences).size).toBeGreaterThan(1);
  });
});

describe("SpriteSheetHumanActor pose grammar — work alternation", () => {
  it("gives different agent ids a different alternation phase (visual variety, not lockstep)", () => {
    const framesFor = (id: string): string => {
      const actor = makeActor({ id });
      actor.apply({ kind: "play-body", action: "work" }, 0);
      const frames: string[] = [];
      for (let step = 0; step < 12; step += 1) {
        actor.apply({ kind: "set-selected", selected: false }, step * 50);
        frames.push(actor.snapshot().layers.body.clipId);
      }
      return frames.join(",");
    };
    const sequences = ["agent_work_a", "agent_work_b", "agent_work_c", "agent_work_d"].map(framesFor);
    expect(new Set(sequences).size).toBeGreaterThan(1);
  });
});

describe("SpriteSheetHumanActor pose grammar — idle breathing & blink", () => {
  it("modulates scale by up to +-1.2% while truly idle, and is exactly 1 at construction (t=0)", () => {
    const actor = makeActor({ id: "agent_breathe" });
    const atZero: DrawCall[] = [];
    actor.draw(recordingContext(atZero));
    expect(atZero[0]!.scaleY).toBe(1);

    actor.apply({ kind: "set-selected", selected: false }, 400);
    const later: DrawCall[] = [];
    actor.draw(recordingContext(later));
    expect(later[0]!.scaleY).toBeGreaterThanOrEqual(1 - 0.012 - 1e-9);
    expect(later[0]!.scaleY).toBeLessThanOrEqual(1 + 0.012 + 1e-9);
  });

  it("does not breathe while an active pose (e.g. reach-give) is playing", () => {
    const actor = makeActor({ id: "agent_no_breathe" });
    actor.apply({ kind: "play-body", action: "reach-give" }, 0);
    actor.apply({ kind: "set-selected", selected: false }, 400);
    const calls: DrawCall[] = [];
    actor.draw(recordingContext(calls));
    expect(calls[0]!.scaleY).toBe(1);
  });

  it("suppresses breathing scale under reducedMotion", () => {
    const actor = makeActor({ id: "agent_reduced_breathe", reducedMotion: true });
    actor.apply({ kind: "set-selected", selected: false }, 400);
    const calls: DrawCall[] = [];
    actor.draw(recordingContext(calls));
    expect(calls[0]!.scaleY).toBe(1);
  });

  it("renders pose-blink for a short visible window at each scheduled blink, then returns to idle", () => {
    const actor = makeActor({ id: "agent_blinker", facing: "south" });
    const firstBlink = actor.nextDeadlineMs();
    expect(firstBlink).not.toBeNull();

    actor.apply({ kind: "set-selected", selected: false }, firstBlink!);
    expect(actor.snapshot().layers.body.clipId).toBe("pose-blink");
    // Scene-graph contract: must still return a future deadline while visibly animating.
    const closingDeadline = actor.nextDeadlineMs();
    expect(closingDeadline).not.toBeNull();
    expect(closingDeadline as number).toBeGreaterThan(firstBlink!);

    actor.apply({ kind: "set-selected", selected: false }, closingDeadline!);
    expect(actor.snapshot().layers.body.clipId).toBe("walk-down-1");
  });

  it("never blinks under reducedMotion", () => {
    const actor = makeActor({ id: "agent_no_blink", reducedMotion: true, facing: "south" });
    for (let step = 0; step < 50; step += 1) {
      actor.apply({ kind: "set-selected", selected: false }, step * 200);
      expect(actor.snapshot().layers.body.clipId).not.toBe("pose-blink");
    }
  });
});

describe("SpriteSheetHumanActor pose grammar — nextDeadlineMs stays live during active pose animations", () => {
  it("keeps returning a future deadline throughout the hurt decay window, then null once settled", () => {
    const actor = makeActor({ id: "agent_hurt_deadline" });
    actor.apply({ kind: "play-body", action: "hurt-fall" }, 0);
    let nowMs = 0;
    for (let guard = 0; guard < 50 && nowMs < 1_199; guard += 1) {
      const deadline = actor.nextDeadlineMs();
      expect(deadline).not.toBeNull();
      expect(deadline as number).toBeGreaterThan(nowMs);
      nowMs = Math.min(deadline as number, 1_199);
      actor.apply({ kind: "set-selected", selected: false }, nowMs);
    }
    actor.apply({ kind: "set-selected", selected: false }, 1_200);
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("keeps returning a future deadline indefinitely while paralyzed (continuous alpha pulse)", () => {
    const actor = makeActor({ id: "agent_prone_deadline" });
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    for (let step = 0; step < 5; step += 1) {
      const deadline = actor.nextDeadlineMs();
      expect(deadline).not.toBeNull();
      actor.apply({ kind: "set-selected", selected: false }, deadline as number);
    }
  });
});

describe("SpriteSheetHumanActor pose grammar — deterministic palette integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves one palette variant per agent at construction and recolors the base atlas when drawing", () => {
    const resolveSpy = vi.spyOn(beingPalette, "resolveBeingPaletteVariant");
    const createSpy = vi.spyOn(beingPalette, "createPaletteVariantSource");
    const leases = makeLeases();
    const actor = makeActor({ id: "agent_palette_wired", atlasLeases: leases });
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    const resolvedVariant = resolveSpy.mock.results[0]!.value as string;

    actor.draw(recordingContext([]));
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [passedBase, passedVariant] = createSpy.mock.calls[0]!;
    expect(passedBase).toBe(leases.get(BEING_CHIBI_ATLAS_ID)!.value);
    expect(passedVariant).toBe(resolvedVariant);
  });

  it("resolves the same variant across independent constructions of the same agent id", () => {
    const resolveSpy = vi.spyOn(beingPalette, "resolveBeingPaletteVariant");
    makeActor({ id: "agent_palette_stable" });
    makeActor({ id: "agent_palette_stable" });
    const [firstResult, secondResult] = resolveSpy.mock.results;
    expect(secondResult!.value).toBe(firstResult!.value);
  });

  it("never throws draw() when the leased bitmap lacks real pixel dimensions (graceful fallback)", () => {
    const actor = makeActor({ id: "agent_palette_fallback" });
    expect(() => actor.draw(recordingContext([]))).not.toThrow();
  });
});

/**
 * @fileoverview Roster integration (R3) — `characterId` frame-lookup
 * wiring. Every prior describe block in this file constructs actors
 * without a `characterId` option and must stay green unmodified: the
 * default (`"m1"`) preserves every pre-roster atlas coordinate exactly.
 * This block covers the opt-in, roster-aware path explicitly.
 */
describe("SpriteSheetHumanActor roster character wiring", () => {
  it("defaults to m1 when no characterId option is given (already covered implicitly by every test above)", () => {
    const idlePassing = beingChibiFrameRect("walk-side-1", "m1");
    const actor = makeActor({ facing: "east" });
    const calls: DrawCall[] = [];
    actor.draw(recordingContext(calls));
    expect(calls[0]!.sourceX).toBe(idlePassing.x);
    expect(calls[0]!.sourceY).toBe(idlePassing.y);
  });

  it("draws from the explicitly requested character's own frame rect, not m1's", () => {
    for (const characterId of characterIds().filter((id) => id !== "m1")) {
      const idlePassing = beingChibiFrameRect("walk-side-1", characterId);
      const actor = makeActor({ facing: "east", characterId });
      const calls: DrawCall[] = [];
      actor.draw(recordingContext(calls));
      expect(calls[0]!.sourceX).toBe(idlePassing.x);
      expect(calls[0]!.sourceY).toBe(idlePassing.y);
      // Every non-m1 roster member is packed at a different atlas position.
      const m1Idle = beingChibiFrameRect("walk-side-1", "m1");
      expect([calls[0]!.sourceX, calls[0]!.sourceY]).not.toEqual([m1Idle.x, m1Idle.y]);
    }
  });

  it("threads characterId into the palette resolution and recolor calls", () => {
    const resolveSpy = vi.spyOn(beingPalette, "resolveBeingPaletteVariant");
    const createSpy = vi.spyOn(beingPalette, "createPaletteVariantSource");
    try {
      const actor = makeActor({ id: "agent_roster_palette", characterId: "f1" });
      expect(resolveSpy).toHaveBeenCalledWith(expect.anything(), "f1");
      actor.draw(recordingContext([]));
      expect(createSpy).toHaveBeenCalledWith(expect.anything(), expect.anything(), "f1");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("every frame name (walk cycles, poses, idle) stays character-agnostic — same bare names regardless of characterId", () => {
    for (const characterId of characterIds()) {
      const actor = makeActor({ id: "agent_roster_frame_names", characterId });
      actor.apply({ kind: "play-body", action: "kneel" }, 0);
      expect(actor.snapshot().layers.body.clipId).toBe("pose-kneel");
    }
  });

  it("production spawning resolves a real roster character deterministically from the agent id", () => {
    const id = "aster_roster_wiring";
    const appearance = deriveHumanAppearance(id);
    const expectedCharacter = resolveBeingCharacter(appearance);
    const idlePassing = beingChibiFrameRect("walk-side-1", expectedCharacter);

    const actor = makeActor({ id, appearance, characterId: expectedCharacter, facing: "east" });
    const calls: DrawCall[] = [];
    actor.draw(recordingContext(calls));
    expect(calls[0]!.sourceX).toBe(idlePassing.x);
    expect(calls[0]!.sourceY).toBe(idlePassing.y);
  });
});
