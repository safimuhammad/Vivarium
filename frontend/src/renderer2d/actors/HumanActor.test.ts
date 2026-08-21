import { describe, expect, it, vi, type Mock } from "vitest";

import type { AssetLease } from "../assets/atlasStore";
import { DEMO_HUMAN_MANIFEST } from "../assets/demoManifest";
import type { Direction4, Vec2 } from "../contracts";
import {
  createHumanActor,
  type ActorCommand,
  type ActorSnapshot,
  type HumanActorOptions,
  type HumanAtlasLeases,
} from "./HumanActor";

function fakeLease(label: string): AssetLease<ImageBitmap> & { readonly release: Mock<() => void> } {
  return { value: { label } as unknown as ImageBitmap, release: vi.fn<() => void>() };
}

function createLeases(): HumanAtlasLeases {
  return {
    body: fakeLease("body"),
    face: fakeLease("face"),
    held: fakeLease("held"),
  };
}

function createTestHumanActor(
  position: Vec2 = { x: 16, y: 16 },
  overrides: Partial<HumanActorOptions> = {},
) {
  return createHumanActor({
    id: "agent_aster",
    name: "Aster",
    position,
    facing: "east",
    manifest: DEMO_HUMAN_MANIFEST,
    blinkSeed: 20260711,
    ...overrides,
  });
}

function move(actor: ReturnType<typeof createTestHumanActor>, waypoints: readonly Vec2[], speedPixelsPerSecond = 40): void {
  actor.apply({ type: "moveTo", payload: { waypoints, speedPixelsPerSecond } });
}

function bodySignature(snapshot: ActorSnapshot): unknown {
  return snapshot.layers.body;
}

function advanceToSeededBlink(actor: ReturnType<typeof createTestHumanActor>): number {
  let nowMs = 0;
  for (let wake = 0; wake < 64; wake += 1) {
    const deadline = actor.nextDeadlineMs();
    expect(deadline).not.toBeNull();
    expect(deadline!).toBeGreaterThan(nowMs);
    nowMs = deadline!;
    actor.update(0, nowMs);
    if (actor.snapshot().channels.face === "blink") return nowMs;
  }
  throw new Error("Seeded blink did not occur within the bounded deadline sequence.");
}

describe("HumanActor continuous locomotion", () => {
  it("updates renderer-owned selection truth without rebuilding the actor", () => {
    const actor = createTestHumanActor();
    const instanceId = actor.snapshot().instanceId;
    actor.apply({ type: "selection", payload: { selected: true } });
    expect(actor.snapshot()).toMatchObject({ instanceId, channels: { selected: true } });
    actor.apply({ type: "selection", payload: { selected: false } });
    expect(actor.snapshot()).toMatchObject({ instanceId, channels: { selected: false } });
    expect(() => actor.apply({ type: "selection", payload: { selected: "yes" } } as unknown as ActorCommand)).toThrow(/selection/i);
  });

  it("moves through intermediate positions while walk frames advance", () => {
    const actor = createTestHumanActor();
    move(actor, [{ x: 48, y: 16 }, { x: 80, y: 16 }]);
    let nowMs = 0;
    const samples = [0.1, 0.1, 0.1, 0.1, 0.1].map((delta) => {
      nowMs += delta * 1000;
      actor.update(delta, nowMs);
      return actor.snapshot();
    });

    expect(new Set(samples.map(({ position }) => position.x)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(samples.map(({ frameIndex }) => frameIndex)).size).toBeGreaterThanOrEqual(2);
    expect(samples.at(-1)!.distanceTravelled).toBeGreaterThan(0);
    expect(samples.every(({ instanceId }) => instanceId === samples[0]!.instanceId)).toBe(true);
  });

  it("consumes movement across segments without overshooting either a corner or destination", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 });
    move(actor, [{ x: 8, y: 0 }, { x: 20, y: 0 }], 100);
    actor.update(0.5, 500);

    expect(actor.snapshot()).toMatchObject({
      position: { x: 20, y: 0 },
      distanceTravelled: 20,
      channels: { locomotion: "idle" },
    });
  });

  it.each([
    [{ x: 40, y: 12 }, "east"],
    [{ x: -40, y: 12 }, "west"],
    [{ x: 12, y: 40 }, "south"],
    [{ x: 12, y: -40 }, "north"],
  ] satisfies readonly [Vec2, Direction4][])("faces the dominant path axis toward %o", (destination, facing) => {
    const actor = createTestHumanActor({ x: 0, y: 0 }, { facing: "south" });
    move(actor, [destination]);
    expect(actor.snapshot().facing).toBe(facing);
  });

  it("keeps distance and stride phase invariant to timestep partitioning", () => {
    const once = createTestHumanActor({ x: 0, y: 0 });
    const partitioned = createTestHumanActor({ x: 0, y: 0 });
    move(once, [{ x: 100, y: 0 }], 37.5);
    move(partitioned, [{ x: 100, y: 0 }], 37.5);

    once.update(0.8, 800);
    for (let index = 1; index <= 8; index += 1) partitioned.update(0.1, index * 100);

    expect(partitioned.snapshot().position.x).toBeCloseTo(once.snapshot().position.x, 10);
    expect(partitioned.snapshot().distanceTravelled).toBeCloseTo(once.snapshot().distanceTravelled, 10);
    expect(partitioned.snapshot().stridePhase).toBeCloseTo(once.snapshot().stridePhase, 10);
    expect(partitioned.snapshot().layers.body).toEqual(once.snapshot().layers.body);
  });

  it("enters a visible turn state at a corner before walking the next segment", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 });
    move(actor, [{ x: 10, y: 0 }, { x: 10, y: 20 }], 40);
    actor.update(0.25, 250);

    expect(actor.snapshot()).toMatchObject({
      position: { x: 10, y: 0 },
      facing: "south",
      channels: { locomotion: "turn" },
    });
    actor.update(0.12, 370);
    expect(actor.snapshot()).toMatchObject({
      position: { x: 10, y: 0 },
      channels: { locomotion: "walk" },
    });
    actor.update(0.1, 470);
    expect(actor.snapshot().position.y).toBeGreaterThan(0);
  });

  it("never overshoots a real right-angle corner while consuming remaining time", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 });
    move(actor, [{ x: 8, y: 0 }, { x: 8, y: 12 }], 100);

    actor.update(0.32, 320);

    expect(actor.snapshot()).toMatchObject({
      position: { x: 8, y: 12 },
      distanceTravelled: 20,
      channels: { locomotion: "stop", facing: "south" },
    });
  });

  it("is timestep invariant across initial turn, right-angle corner, and stop to idle", () => {
    const once = createTestHumanActor({ x: 0, y: 0 }, { facing: "north" });
    const partitioned = createTestHumanActor({ x: 0, y: 0 }, { facing: "north" });
    const route = [{ x: 10, y: 0 }, { x: 10, y: 10 }] as const;
    move(once, route, 10);
    move(partitioned, route, 10);

    once.update(2.36, 2_360);
    let nowMs = 0;
    for (const delta of [0.12, 0.5, 0.5, 0.12, 0.5, 0.5, 0.12]) {
      nowMs += delta * 1_000;
      partitioned.update(delta, nowMs);
    }

    const selectInvariantState = ({ position, distanceTravelled, stridePhase, channels }: ActorSnapshot) => ({
      position, distanceTravelled, stridePhase, channels,
    });
    expect(selectInvariantState(once.snapshot())).toEqual(selectInvariantState(partitioned.snapshot()));
    expect(once.snapshot()).toMatchObject({
      position: { x: 10, y: 10 },
      distanceTravelled: 20,
      channels: { locomotion: "idle", facing: "south" },
    });
  });

  it("keeps turn and stop visible when delta lands exactly on each transition boundary", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 }, { facing: "north" });
    move(actor, [{ x: 10, y: 0 }, { x: 10, y: 10 }], 10);
    expect(actor.snapshot().channels.locomotion).toBe("turn");

    actor.update(0.12, 120);
    expect(actor.snapshot()).toMatchObject({ position: { x: 0, y: 0 }, channels: { locomotion: "walk" } });
    actor.update(1, 1_120);
    expect(actor.snapshot()).toMatchObject({ position: { x: 10, y: 0 }, channels: { locomotion: "turn" } });
    actor.update(0.12, 1_240);
    expect(actor.snapshot()).toMatchObject({ position: { x: 10, y: 0 }, channels: { locomotion: "walk" } });
    actor.update(1, 2_240);
    expect(actor.snapshot()).toMatchObject({ position: { x: 10, y: 10 }, channels: { locomotion: "stop" } });
    actor.update(0.12, 2_360);
    expect(actor.snapshot().channels.locomotion).toBe("idle");
  });

  it("holds stop before settling to idle", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 });
    move(actor, [{ x: 10, y: 0 }], 40);
    actor.update(0.25, 250);
    expect(actor.snapshot().channels.locomotion).toBe("stop");

    actor.update(0.1, 350);
    expect(actor.snapshot().channels.locomotion).toBe("stop");
    actor.update(0.03, 380);
    expect(actor.snapshot().channels.locomotion).toBe("idle");
  });

  it("rejects malformed movement instead of silently changing the route", () => {
    const actor = createTestHumanActor();
    expect(() => move(actor, [{ x: Number.NaN, y: 0 }])).toThrow(/waypoint/i);
    expect(() => move(actor, [{ x: 20, y: 0 }], 0)).toThrow(/speed/i);
  });

  it.each([
    { type: "face", payload: { direction: "up" } },
    { type: "status", payload: { locomotion: "sleep" } },
    { type: "status", payload: { locomotion: "idle", face: "smile" } },
    { type: "action", payload: { action: "dance", clipId: "work" } },
    { type: "action", payload: { action: "work", clipId: "missing" } },
    { type: "action", payload: { action: "work", clipId: "basket" } },
    { type: "action", payload: { action: "reach", clipId: "work" } },
    { type: "action", payload: { action: "speak", clipId: "blink" } },
    { type: "action", payload: { action: "hurt", clipId: "reach" } },
  ])("rejects invalid runtime command payload $type without mutation", (invalid) => {
    const actor = createTestHumanActor();
    const before = actor.snapshot();
    expect(() => actor.apply(invalid as unknown as ActorCommand)).toThrow();
    expect(actor.snapshot()).toEqual(before);
  });
});

describe("HumanActor independent animation channels", () => {
  it.each(["north", "east", "south", "west"] as const)("plays all four native idle frames while neutral facing %s", (facing) => {
    const actor = createTestHumanActor(undefined, { facing });
    const frames = new Set<number>();
    for (let wake = 0; wake < 4; wake += 1) {
      frames.add(actor.snapshot().layers.body.frameIndex);
      const deadline = actor.nextDeadlineMs();
      expect(deadline).not.toBeNull();
      actor.update(0, deadline!);
    }
    expect(actor.snapshot().layers.body.clipId).toBe(`idle_${facing}`);
    expect(frames).toEqual(new Set([0, 1, 2, 3]));
  });

  it.each([
    ["speak", { type: "action", payload: { action: "speak", clipId: "talk" } }],
    ["work", { type: "action", payload: { action: "work", clipId: "work" } }],
    ["weary", { type: "status", payload: { locomotion: "idle", face: "weary" } }],
    ["explicit blink", { type: "status", payload: { locomotion: "idle", face: "blink" } }],
  ] as const)("preserves the current nonzero idle body frame across %s", (_label, command) => {
    const actor = createTestHumanActor();
    actor.update(0, 240);
    const before = actor.snapshot().layers.body;
    expect(before.frameIndex).toBe(1);

    actor.apply(command);

    expect(actor.snapshot().layers.body).toEqual(before);
  });

  it("preserves the current nonzero idle body frame when a natural blink begins", () => {
    const actor = createTestHumanActor(undefined, { blinkSeed: 41 });
    let beforeBlink = actor.snapshot().layers.body;
    for (let wake = 0; wake < 64; wake += 1) {
      const deadline = actor.nextDeadlineMs()!;
      actor.update(0, deadline);
      if (actor.snapshot().channels.face === "blink") {
        expect(beforeBlink.frameIndex).not.toBe(0);
        expect(actor.snapshot().layers.body).toEqual(beforeBlink);
        return;
      }
      beforeBlink = actor.snapshot().layers.body;
    }
    throw new Error("Natural blink did not begin within bounded deadlines.");
  });

  it.each(["north", "east", "south", "west"] as const)("plays both native turn frames for %s within the 120 ms gate", (facing) => {
    const opposite: Record<Direction4, Direction4> = { north: "south", east: "west", south: "north", west: "east" };
    const actor = createTestHumanActor(undefined, { facing: opposite[facing] });
    actor.apply({ type: "face", payload: { direction: facing } });
    expect(actor.snapshot().layers.body).toMatchObject({ clipId: `turn_${facing}`, frameIndex: 0 });
    actor.update(0.06, 60);
    expect(actor.snapshot().layers.body).toMatchObject({ clipId: `turn_${facing}`, frameIndex: 1 });
    actor.update(0.06, 120);
    expect(actor.snapshot().channels.locomotion).toBe("idle");
  });

  it.each([
    ["south", 0], ["west", 1], ["north", 2], ["east", 3],
  ] as const)("keeps the face overlay compatible with a %s directional body", (facing, row) => {
    const actor = createTestHumanActor(undefined, { facing });
    const snapshot = actor.snapshot();
    expect(snapshot.layers.body.clipId).toBe(`idle_${facing}`);
    expect(snapshot.layers.face).toMatchObject({ clipId: `neutral_${facing}`, sourceRect: { y: row * 64 } });
  });

  it("uses the south face row for a non-directional front body action", () => {
    const actor = createTestHumanActor(undefined, { facing: "north" });
    actor.apply({ type: "action", payload: { action: "reach", clipId: "reach" } });
    const snapshot = actor.snapshot();
    expect(snapshot.layers.body.clipId).toBe("reach");
    expect(snapshot.layers.face).toMatchObject({ clipId: "neutral_south", sourceRect: { y: 0 } });
  });

  it.each([
    ["north", { x: 0, y: -4 }], ["east", { x: 4, y: 0 }],
    ["south", { x: 0, y: 4 }], ["west", { x: -4, y: 0 }],
  ] as const)("plays both native stop frames for %s within the 120 ms gate", (facing, destination) => {
    const actor = createTestHumanActor({ x: 0, y: 0 }, { facing });
    move(actor, [destination], 40);
    actor.update(0.1, 100);
    expect(actor.snapshot().layers.body).toMatchObject({ clipId: `stop_${facing}`, frameIndex: 0 });
    actor.update(0.06, 160);
    expect(actor.snapshot().layers.body).toMatchObject({ clipId: `stop_${facing}`, frameIndex: 1 });
    actor.update(0.06, 220);
    expect(actor.snapshot().channels.locomotion).toBe("idle");
  });

  it("uses seeded blink timing and changes only the face layer", () => {
    const first = createTestHumanActor(undefined, { blinkSeed: 41 });
    const second = createTestHumanActor(undefined, { blinkSeed: 41 });
    const before = first.snapshot();
    const blinkAt = advanceToSeededBlink(first);

    second.update(0, blinkAt);

    expect(first.snapshot().channels.face).toBe("blink");
    expect(first.snapshot().layers.face.clipId).toMatch(/^blink_/);
    expect(first.snapshot().layers.face).toEqual(second.snapshot().layers.face);
    expect(bodySignature(first.snapshot())).toEqual(bodySignature(second.snapshot()));
    expect(first.snapshot().layers.held).toEqual(before.layers.held);
  });

  it("does not pause or reset the independent idle body channel when a seeded blink begins", () => {
    const actor = createTestHumanActor(undefined, { blinkSeed: 41 });
    const blinkAt = advanceToSeededBlink(actor);
    const idle = DEMO_HUMAN_MANIFEST.layers.find(({ id }) => id === "body")!.clips.idle_east!;
    const cycleMs = idle.frames.reduce((sum, { durationMs }) => sum + durationMs, 0);
    let cursor = blinkAt % cycleMs;
    let expectedFrame = 0;
    for (const [index, { durationMs }] of idle.frames.entries()) {
      if (cursor < durationMs) { expectedFrame = index; break; }
      cursor -= durationMs;
    }
    expect(expectedFrame).not.toBe(0);
    expect(actor.snapshot().channels.face).toBe("blink");
    expect(actor.snapshot().layers.body).toMatchObject({ clipId: "idle_east", frameIndex: expectedFrame });
  });

  it("always exposes a future blink deadline from the cumulative clock", () => {
    const actor = createTestHumanActor(undefined, { blinkSeed: 41 });
    const blinkAt = advanceToSeededBlink(actor);
    expect(actor.nextDeadlineMs()).toBeGreaterThan(blinkAt);
    actor.update(0, blinkAt + 1_000);
    expect(actor.nextDeadlineMs()).toBeGreaterThan(blinkAt + 1_000);
  });

  it("schedules each blink transition in the future before returning to a quiet interval", () => {
    const actor = createTestHumanActor(undefined, { blinkSeed: 41 });
    const blinkAt = advanceToSeededBlink(actor);

    expect(actor.nextDeadlineMs()).toBe(blinkAt + 90);
    actor.update(0, blinkAt + 91);
    const intermediateDeadline = actor.nextDeadlineMs()!;
    expect(intermediateDeadline).toBeGreaterThan(blinkAt + 91);
    expect(intermediateDeadline).toBeLessThanOrEqual(blinkAt + 180);
    if (intermediateDeadline < blinkAt + 180) actor.update(0, intermediateDeadline);
    expect(actor.nextDeadlineMs()).toBe(blinkAt + 180);
    actor.update(0, blinkAt + 271);
    expect(actor.nextDeadlineMs()).toBeGreaterThan(blinkAt + 271);
  });

  it("animates talk entirely on the face layer", () => {
    const actor = createTestHumanActor();
    const before = actor.snapshot();
    actor.apply({ type: "action", payload: { action: "speak", clipId: "talk" } });
    actor.update(0.2, 200);

    expect(actor.snapshot().channels.face).toBe("talk");
    expect(actor.snapshot().layers.face.clipId).toMatch(/^talk_/);
    expect(bodySignature(actor.snapshot())).toEqual(bodySignature(before));
    expect(actor.snapshot().layers.held).toEqual(before.layers.held);
  });

  it("keeps talk independent while the multi-frame walk body advances", () => {
    const talker = createTestHumanActor({ x: 0, y: 0 });
    const control = createTestHumanActor({ x: 0, y: 0 });
    move(talker, [{ x: 100, y: 0 }], 40);
    move(control, [{ x: 100, y: 0 }], 40);
    talker.apply({ type: "action", payload: { action: "speak", clipId: "talk" } });

    talker.update(0.2, 200);
    control.update(0.2, 200);

    expect(talker.snapshot().layers.body).toEqual(control.snapshot().layers.body);
    expect(talker.snapshot().layers.body.frameIndex).not.toBe(0);
    expect(talker.snapshot().layers.face.clipId).toMatch(/^talk_/);
  });

  it("supports explicit status blink and talk faces instead of ignoring them", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion: "idle", face: "blink" } });
    expect(actor.snapshot()).toMatchObject({ channels: { face: "blink" }, layers: { face: { clipId: "blink_1_east" } } });
    actor.update(0.1, 100);
    expect(actor.snapshot()).toMatchObject({ channels: { face: "blink" }, layers: { face: { clipId: "blink_2_east" } } });
    actor.update(0.2, 300);
    expect(actor.snapshot().channels.face).toBe("neutral");

    actor.apply({ type: "status", payload: { locomotion: "idle", face: "talk" } });
    expect(actor.snapshot()).toMatchObject({ channels: { face: "talk" }, layers: { face: { clipId: "talk_1_east" } } });
    actor.update(0.2, 500);
    expect(actor.snapshot()).toMatchObject({ channels: { face: "talk" }, layers: { face: { clipId: "talk_2_east" } } });
  });

  it("changes a held object without changing body or face frames", () => {
    const actor = createTestHumanActor();
    const before = actor.snapshot();
    actor.apply({ type: "action", payload: { action: "none", clipId: "basket" } });

    expect(actor.snapshot().channels.heldObject).toBe("basket");
    expect(actor.snapshot().layers.held.clipId).toBe("basket");
    expect(bodySignature(actor.snapshot())).toEqual(bodySignature(before));
    expect(actor.snapshot().layers.face).toEqual(before.layers.face);
  });

  it("uses real manifest work and reach clips", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    const workStart = actor.snapshot();
    actor.update(0.17, 170);
    const workNext = actor.snapshot();

    expect(workStart.layers.held.clipId).toBe("work");
    expect(workNext.layers.held.clipId).toBe("work");
    expect(workNext.layers.held.frameIndex).not.toBe(workStart.layers.held.frameIndex);
    expect(workNext.layers.body.clipId).toBe(workStart.layers.body.clipId);

    actor.apply({ type: "action", payload: { action: "reach", clipId: "reach" } });
    expect(actor.snapshot().layers.body.clipId).toBe("reach");
    expect(actor.snapshot().layers.held.clipId).toBe("reach");
  });

  it("presents hurt on both the body action and face channels", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "hurt", clipId: "fall" } });

    expect(actor.snapshot().layers.body.clipId).toBe("fall");
    expect(actor.snapshot().channels.face).toBe("hurt");
    expect(actor.snapshot().layers.face.clipId).toBe("hurt_south");
  });

  it("breathes faintly while prone without changing position", () => {
    const actor = createTestHumanActor({ x: 14.25, y: 22.75 });
    actor.apply({ type: "status", payload: { locomotion: "prone", face: "weary" } });
    actor.update(0, 0);
    const first = actor.snapshot();
    actor.update(0.5, 500);
    const second = actor.snapshot();

    expect(second.position).toEqual(first.position);
    expect(second.layers.body.clipId).toBe("fall");
    expect(second.layers.body.frameIndex).not.toBe(first.layers.body.frameIndex);
    expect(second.channels.face).toBe("weary");
  });

  it("uses exactly the final two fall frames for prone breathing", () => {
    const actor = createTestHumanActor();
    const fall = DEMO_HUMAN_MANIFEST.layers.find(({ id }) => id === "body")!.clips.fall;
    const expected = [fall.frames.length - 2, fall.frames.length - 1];
    actor.apply({ type: "status", payload: { locomotion: "prone" } });

    const actual = [0, 420, 840, 1_260].map((nowMs, index) => {
      actor.update(index === 0 ? 0 : 0.42, nowMs);
      return actor.snapshot().layers.body.frameIndex;
    });

    expect([...new Set(actual)].sort()).toEqual(expected);
    expect(actual).toEqual([expected[0], expected[1], expected[0], expected[1]]);
  });

  it("returns the next strictly-future prone body deadline instead of an invisible weary blink", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion: "prone", face: "weary" } });
    expect(actor.nextDeadlineMs()).toBe(420);
    actor.update(0, 419);
    expect(actor.nextDeadlineMs()).toBe(420);
    actor.update(0, 420);
    expect(actor.nextDeadlineMs()).toBe(840);
  });

  it("returns looping held-work deadlines on every visible frame boundary", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    expect(actor.nextDeadlineMs()).toBe(160);
    actor.update(0, 160);
    expect(actor.snapshot().layers.held.frameIndex).toBe(1);
    expect(actor.nextDeadlineMs()).toBe(240);
    actor.update(0, 240);
    expect(actor.snapshot().layers.held.frameIndex).toBe(1);
    expect(actor.nextDeadlineMs()).toBe(320);
    actor.update(0, 320);
    expect(actor.snapshot().layers.held.frameIndex).toBe(0);
    expect(actor.nextDeadlineMs()).toBe(480);
  });

  it("aggregates blink and work deadlines from both visible layers", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    actor.apply({ type: "status", payload: { locomotion: "idle", face: "blink" } });

    expect(actor.nextDeadlineMs()).toBe(90);
    actor.update(0, 90);
    expect(actor.nextDeadlineMs()).toBe(160);
  });

  it("keeps held work active while talk supplies the next earlier face deadline", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    actor.apply({ type: "action", payload: { action: "speak", clipId: "talk" } });

    expect(actor.nextDeadlineMs()).toBe(160);
    actor.update(0, 160);
    expect(actor.snapshot().layers.held.frameIndex).toBe(1);
    expect(actor.nextDeadlineMs()).toBe(180);
  });

  it("selects the minimum strictly-future deadline across body, held, and face", () => {
    const actor = createTestHumanActor(undefined, { facing: "west" });
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    actor.apply({ type: "status", payload: { locomotion: "turn", face: "talk" } });

    expect(actor.nextDeadlineMs()).toBe(60);
    actor.update(0.06, 60);
    expect(actor.nextDeadlineMs()).toBe(120);
    actor.update(0.06, 120);
    expect(actor.nextDeadlineMs()).toBe(160);
  });

  it("returns no deadline when every visible channel is static", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "none", clipId: "basket" } });
    actor.apply({ type: "status", payload: { locomotion: "idle", face: "weary" } });
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it.each([
    ["reach", "reach", "reach"],
    ["hurt", "fall", "fall"],
  ] as const)("returns %s body deadlines only until the non-loop clip completes", (action, clipId, bodyClipId) => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action, clipId } });
    expect(actor.snapshot().layers.body.clipId).toBe(bodyClipId);
    expect(actor.nextDeadlineMs()).toBe(160);
    actor.update(0, 160);
    expect(actor.snapshot().layers.body.frameIndex).toBe(1);
    expect(actor.nextDeadlineMs()).toBe(320);
    actor.update(0, 320);
    expect(actor.nextDeadlineMs()).toBe(480);
    actor.update(0, 480);
    expect(actor.snapshot().layers.body.frameIndex).toBe(3);
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("aggregates a visible explicit talk face with reach before and after reach completes", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "reach", clipId: "reach" } });
    actor.apply({ type: "status", payload: { locomotion: "idle", face: "talk" } });

    expect(actor.nextDeadlineMs()).toBe(160);
    actor.update(0, 160);
    expect(actor.nextDeadlineMs()).toBe(180);
    actor.update(0, 480);
    expect(actor.snapshot().layers.body.frameIndex).toBe(3);
    expect(actor.nextDeadlineMs()).toBe(540);
  });

  it("aggregates a visible explicit blink face with reach", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "reach", clipId: "reach" } });
    actor.apply({ type: "status", payload: { locomotion: "idle", face: "blink" } });

    expect(actor.nextDeadlineMs()).toBe(90);
    actor.update(0, 90);
    expect(actor.nextDeadlineMs()).toBe(160);
    actor.update(0, 160);
    expect(actor.nextDeadlineMs()).toBe(180);
  });

  it("cancels the independent work-held channel when transitioning to prone", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    actor.update(0, 160);
    expect(actor.snapshot().layers.held).toMatchObject({ clipId: "work", frameIndex: 1 });

    actor.apply({ type: "status", payload: { locomotion: "prone", face: "weary" } });

    expect(actor.snapshot()).toMatchObject({
      channels: { locomotion: "prone", action: "none", heldObject: null },
      layers: { held: { clipId: "empty", frameIndex: 0 } },
    });
    expect(actor.nextDeadlineMs()).toBe(420);
  });

  it("does not reveal an unscheduled seeded blink after a non-loop reach has completed", () => {
    const neutral = createTestHumanActor(undefined, { blinkSeed: 41 });
    const blinkAt = advanceToSeededBlink(neutral);
    const actor = createTestHumanActor(undefined, { blinkSeed: 41 });
    actor.apply({ type: "action", payload: { action: "reach", clipId: "reach" } });
    actor.update(0, blinkAt);
    expect(actor.nextDeadlineMs()).toBeNull();
    expect(actor.snapshot().channels.face).toBe("neutral");
    expect(actor.snapshot().layers.face.clipId).toBe("neutral_south");
  });

  it.each(["weary", "hurt"] as const)("does not advertise an invisible seeded blink for a static %s face", (face) => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion: "idle", face } });
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it.each([
    ["turn", "weary"], ["stop", "hurt"],
  ] as const)("derives static %s→idle suppression from the visible %s state", (locomotion, face) => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion, face } });
    actor.update(0.12, 120);
    expect(actor.snapshot()).toMatchObject({ channels: { locomotion: "idle", face } });
    const settledBody = actor.snapshot().layers.body;

    actor.update(0, 1_000);

    expect(actor.snapshot().layers.body).toEqual(settledBody);
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("keeps death terminal and completely still", () => {
    const actor = createTestHumanActor({ x: 11.5, y: 19.25 });
    actor.apply({ type: "status", payload: { locomotion: "dead", face: "hurt" } });
    const dead = actor.snapshot();
    move(actor, [{ x: 100, y: 100 }], 500);
    actor.apply({ type: "action", payload: { action: "speak", clipId: "talk" } });
    actor.update(10, 10_000);

    expect(actor.snapshot()).toEqual(dead);
  });

  it("freezes every terminal layer after death interrupts an animated talk face", () => {
    const actor = createTestHumanActor({ x: 11.5, y: 19.25 });
    actor.apply({ type: "action", payload: { action: "work", clipId: "work" } });
    actor.update(0.17, 170);
    actor.apply({ type: "action", payload: { action: "speak", clipId: "talk" } });
    actor.update(0.2, 370);
    expect(actor.snapshot().channels.face).toBe("talk");

    actor.apply({ type: "status", payload: { locomotion: "dead" } });
    expect(actor.snapshot()).toMatchObject({
      channels: { locomotion: "dead", action: "none", face: "hurt", heldObject: null },
      layers: { face: { clipId: "hurt_south" }, held: { clipId: "empty" } },
    });
    const frozen = JSON.stringify(actor.snapshot());
    for (const [deltaSeconds, nowMs] of [[0, 370], [0.5, 870], [10, 10_870]] as const) {
      actor.update(deltaSeconds, nowMs);
      expect(JSON.stringify(actor.snapshot())).toBe(frozen);
    }
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("freezes every terminal layer after death interrupts an animated blink face", () => {
    const actor = createTestHumanActor({ x: 7.25, y: 13.75 }, { blinkSeed: 41 });
    move(actor, [{ x: 100, y: 13.75 }], 40);
    const blinkAt = advanceToSeededBlink(actor);
    actor.update(0.2, blinkAt + 91);
    expect(actor.snapshot()).toMatchObject({ channels: { face: "blink" }, layers: { face: { clipId: "blink_2_east" } } });

    actor.apply({ type: "status", payload: { locomotion: "dead" } });
    expect(actor.snapshot()).toMatchObject({
      channels: { locomotion: "dead", action: "none", face: "hurt", heldObject: null },
      layers: { face: { clipId: "hurt_south" }, held: { clipId: "empty" } },
    });
    const frozen = JSON.stringify(actor.snapshot());
    for (const [deltaSeconds, nowMs] of [[0, blinkAt + 91], [0.5, blinkAt + 591], [10, blinkAt + 10_591]] as const) {
      actor.update(deltaSeconds, nowMs);
      expect(JSON.stringify(actor.snapshot())).toBe(frozen);
    }
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it.each(["talk", "blink"] as const)("canonicalizes explicit dead + %s to one static terminal face", (face) => {
    const actor = createTestHumanActor({ x: 3.25, y: 9.75 });
    move(actor, [{ x: 80, y: 9.75 }], 40);
    actor.update(0.2, 200);

    actor.apply({ type: "status", payload: { locomotion: "dead", face } });

    expect(actor.snapshot()).toMatchObject({
      channels: { locomotion: "dead", action: "none", face: "hurt", heldObject: null },
      layers: { face: { clipId: "hurt_south", frameIndex: 0 }, held: { clipId: "empty", frameIndex: 0 } },
    });
    const frozen = JSON.stringify(actor.snapshot());
    for (const [deltaSeconds, nowMs] of [[0, 200], [0.5, 700], [10, 10_700]] as const) {
      actor.update(deltaSeconds, nowMs);
      expect(JSON.stringify(actor.snapshot())).toBe(frozen);
    }
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it.each(["blink", "talk"] as const)("normalizes an explicit %s face to a fixed terminal expression on death", (face) => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion: "dead", face } });
    const terminal = actor.snapshot();
    expect(terminal).toMatchObject({
      channels: { locomotion: "dead", face: "hurt" },
      layers: { face: { clipId: "hurt_south", frameIndex: 0 } },
    });
    actor.update(100, 100_000);
    expect(actor.snapshot()).toEqual(terminal);
  });
});

describe("HumanActor rendering and lifecycle", () => {
  it("rejects a manifest that violates the Task 3 native atlas contract", () => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    (manifest as { logicalWidth: number }).logicalWidth = 40;
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(/manifest/i);
  });

  it.each([
    ["body", "idle_south"],
    ["body", "walk_west"],
    ["body", "turn_north"],
    ["body", "stop_east"],
    ["body", "reach"],
    ["body", "fall"],
    ["face", "neutral_south"],
    ["face", "blink_2_west"],
    ["face", "talk_2_north"],
    ["face", "hurt_east"],
    ["held", "empty"],
    ["held", "basket"],
    ["held", "work"],
    ["held", "reach"],
  ] as const)("rejects a manifest missing required %s/%s at construction", (layerId, clipId) => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const layer = manifest.layers.find(({ id }) => id === layerId)!;
    delete (layer.clips as Record<string, unknown>)[clipId];
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(new RegExp(`${layerId}.*${clipId}`, "i"));
  });

  it("rejects a fall clip without two terminal prone frames", () => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const body = manifest.layers.find(({ id }) => id === "body")!;
    const mutableFall = body.clips.fall as unknown as {
      frames: unknown[]; cancelFrames: number[]; markers: unknown[];
    };
    mutableFall.frames = body.clips.fall.frames.slice(0, 1);
    mutableFall.cancelFrames = [0];
    mutableFall.markers = [];
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(/fall.*two/i);
  });

  it.each([
    ["idle_south", 3], ["walk_west", 5], ["turn_north", 1], ["stop_east", 1],
  ] as const)("rejects body clip %s when it has fewer than the binding frame count", (clipId, length) => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const body = manifest.layers.find(({ id }) => id === "body")!;
    const mutable = body.clips[clipId] as unknown as { frames: unknown[]; cancelFrames: number[]; markers: unknown[] };
    mutable.frames = body.clips[clipId]!.frames.slice(0, length);
    mutable.cancelFrames = Array.from({ length }, (_value, index) => index);
    mutable.markers = [];
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(new RegExp(`${clipId}.*frames`, "i"));
  });

  it("rejects a directional clip stored under the wrong manifest key", () => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const body = manifest.layers.find(({ id }) => id === "body")!;
    (body.clips as Record<string, unknown>).idle_north = structuredClone(body.clips.idle_south);
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(/idle_north.*id/i);
  });

  it("rejects a directional clip with a mislabeled direction", () => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const body = manifest.layers.find(({ id }) => id === "body")!;
    (body.clips.idle_north as { direction: Direction4 }).direction = "south";
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(/idle_north.*direction/i);
  });

  it("rejects directional frames bound to another direction's source row", () => {
    const manifest = structuredClone(DEMO_HUMAN_MANIFEST);
    const body = manifest.layers.find(({ id }) => id === "body")!;
    const mutableNorth = body.clips.idle_north as unknown as { frames: unknown[] };
    mutableNorth.frames = structuredClone(body.clips.idle_south.frames) as unknown[];
    expect(() => createTestHumanActor(undefined, { manifest })).toThrow(/idle_north.*source/i);
  });

  it("draws body, face, then held at one snapped native feet anchor with smoothing disabled", () => {
    const leases = createLeases();
    const actor = createTestHumanActor({ x: 16.4, y: 20.6 }, { atlasLeases: leases });
    const calls: unknown[][] = [];
    const context = {
      imageSmoothingEnabled: true,
      drawImage: (...args: unknown[]) => calls.push(args),
    } as unknown as CanvasRenderingContext2D;

    actor.draw(context);

    expect(context.imageSmoothingEnabled).toBe(false);
    expect(calls.map(([image]) => (image as { label: string }).label)).toEqual(["body", "face", "held"]);
    for (const call of calls) {
      expect(call.slice(5)).toEqual([-8, -40, 48, 64]);
      expect(call.slice(1, 5).every(Number.isInteger)).toBe(true);
      expect(call.slice(5).every(Number.isInteger)).toBe(true);
    }
  });

  it("draws an explicitly supplied frame snapshot without allocating a replacement snapshot", () => {
    const leases = createLeases();
    const actor = createTestHumanActor({ x: 16, y: 20 }, { atlasLeases: leases });
    const captured = actor.snapshot();
    actor.apply({ type: "face", payload: { direction: "north" } });
    const calls: unknown[][] = [];
    const context = {
      imageSmoothingEnabled: true,
      drawImage: (...args: unknown[]) => calls.push(args),
    } as unknown as CanvasRenderingContext2D;

    actor.draw(context, captured);

    expect(calls[0]!.slice(1, 5)).toEqual([
      captured.layers.body.sourceRect.x,
      captured.layers.body.sourceRect.y,
      captured.layers.body.sourceRect.width,
      captured.layers.body.sourceRect.height,
    ]);
  });

  it("emits arrival once and drains signals", () => {
    const actor = createTestHumanActor({ x: 0, y: 0 });
    move(actor, [{ x: 4, y: 0 }], 40);
    actor.update(0.1, 100);

    expect(actor.drainSignals()).toEqual([{
      type: "arrived",
      actorId: "agent_aster",
      position: { x: 4, y: 0 },
    }]);
    expect(actor.drainSignals()).toEqual([]);
  });

  it("disposes every owned atlas lease exactly once", () => {
    const leases = createLeases();
    const actor = createTestHumanActor(undefined, { atlasLeases: leases });

    actor.dispose();
    actor.dispose();

    expect(leases.body.release).toHaveBeenCalledTimes(1);
    expect(leases.face.release).toHaveBeenCalledTimes(1);
    expect(leases.held.release).toHaveBeenCalledTimes(1);
  });

  it("ignores malformed and valid commands after death without validation or mutation", () => {
    const actor = createTestHumanActor();
    actor.apply({ type: "status", payload: { locomotion: "dead", face: "hurt" } });
    const terminal = actor.snapshot();
    expect(() => actor.apply({ type: "face", payload: { direction: "up" } } as unknown as ActorCommand)).not.toThrow();
    expect(() => move(actor, [{ x: 100, y: 100 }], 40)).not.toThrow();
    expect(actor.snapshot()).toEqual(terminal);
  });

  it("ignores malformed and valid commands after disposal without validation or mutation", () => {
    const actor = createTestHumanActor();
    actor.dispose();
    const disposed = actor.snapshot();
    expect(() => actor.apply({ type: "status", payload: { locomotion: "sleep" } } as unknown as ActorCommand)).not.toThrow();
    expect(() => actor.apply({ type: "face", payload: { direction: "north" } })).not.toThrow();
    expect(actor.snapshot()).toEqual(disposed);
  });
});
