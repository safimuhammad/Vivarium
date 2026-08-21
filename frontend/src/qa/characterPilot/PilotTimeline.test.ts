import { describe, expect, it, vi, type Mock } from "vitest";

import {
  LayeredHumanActor,
  type LayeredHumanSnapshot,
  type ProductionActorSignal,
} from "../../renderer2d/production/actors/LayeredHumanActor";
import type {
  ProductionAssetLease,
  ProductionAssetManifest,
  ProductionClip,
} from "../../renderer2d/production/assets/productionManifest";
import {
  CHARACTER_PILOT_AGENT_ID,
  CHARACTER_PILOT_APPEARANCE,
  CHARACTER_PILOT_MANIFEST,
} from "./pilotManifest";
import {
  createCharacterPilotTimeline,
  type CharacterPilotTimeline,
  type PilotFrame,
  type PilotMilestone,
  type PilotPhase,
} from "./PilotTimeline";

type TestLease = ProductionAssetLease<ImageBitmap> & {
  readonly release: Mock<() => void>;
};

interface PilotFixture {
  readonly actor: LayeredHumanActor;
  readonly timeline: CharacterPilotTimeline;
  readonly leases: ReadonlyMap<string, TestLease>;
}

interface MutableClock {
  nowMs: number;
}

const FIXED_STEP_MS = 20;
const START = Object.freeze({ x: 226, y: 102 });

function createLeases(
  manifest: ProductionAssetManifest = CHARACTER_PILOT_MANIFEST,
): ReadonlyMap<string, TestLease> {
  const clothingAtlas = manifest.human
    .clothingAtlasBySilhouette[CHARACTER_PILOT_APPEARANCE.clothingSilhouette];
  if (clothingAtlas === undefined) throw new Error("Pilot clothing atlas is missing.");
  const atlasIds = new Set([
    ...Object.values(manifest.human.layerAtlases),
    clothingAtlas,
  ]);
  return new Map([...atlasIds].map((id) => [
    id,
    {
      value: { atlasId: id } as unknown as ImageBitmap,
      release: vi.fn<() => void>(),
    },
  ]));
}

function createFixture(
  manifest: ProductionAssetManifest = CHARACTER_PILOT_MANIFEST,
): PilotFixture {
  const leases = createLeases(manifest);
  const actor = new LayeredHumanActor({
    id: CHARACTER_PILOT_AGENT_ID,
    name: "Pilot",
    position: START,
    facing: "south",
    manifest,
    atlasLeases: leases,
    appearance: CHARACTER_PILOT_APPEARANCE,
    paletteMode: "authored",
  });
  return {
    actor,
    timeline: createCharacterPilotTimeline(actor),
    leases,
  };
}

function step(
  timeline: CharacterPilotTimeline,
  clock: MutableClock,
  milliseconds = FIXED_STEP_MS,
): PilotFrame {
  clock.nowMs += milliseconds;
  return timeline.advance(milliseconds / 1_000, clock.nowMs);
}

function advanceUntil(
  timeline: CharacterPilotTimeline,
  predicate: (frame: PilotFrame) => boolean,
  limit = 2_000,
): PilotFrame {
  const clock = { nowMs: 0 };
  for (let index = 0; index < limit; index += 1) {
    const frame = step(timeline, clock);
    if (predicate(frame)) return frame;
  }
  throw new Error(`Test driver failed to reach predicate within ${limit} steps.`);
}

function faceExpression(snapshot: LayeredHumanSnapshot): string {
  return snapshot.layers.face.clipId.split(":").at(-1) ?? "";
}

function markerSignals(
  signals: readonly ProductionActorSignal[],
  marker: string,
): readonly Extract<ProductionActorSignal, { kind: "marker" }>[] {
  return signals.filter((signal): signal is Extract<ProductionActorSignal, { kind: "marker" }> =>
    signal.kind === "marker" && signal.marker === marker);
}

function uniqueInOrder<T>(values: readonly T[]): readonly T[] {
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}

function withoutInstance(frame: PilotFrame): unknown {
  const { instanceId: _instanceId, ...actor } = frame.actor;
  return {
    ...frame,
    actor,
  };
}

type MutableHumanRig = {
  bodyClips: Record<string, ProductionClip>;
};

function patchHumanAClips(
  patch: (clip: ProductionClip) => ProductionClip,
  action: string,
  facings: readonly string[] = ["south"],
): ProductionAssetManifest {
  const draft = structuredClone(CHARACTER_PILOT_MANIFEST);
  const rig = (
    draft.human.rigs as unknown as Record<string, MutableHumanRig>
  )["human-a"]!;
  for (const facing of facings) {
    const key = `${action}:${facing}`;
    const clip = rig.bodyClips[key];
    if (clip === undefined) throw new Error(`Missing test clip ${key}.`);
    rig.bodyClips[key] = patch(clip);
  }
  return draft;
}

function deepFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value)) {
    return value === null || typeof value !== "object";
  }
  return Object.values(value as Record<string, unknown>).every(deepFrozen);
}

function interceptActorSignals(
  actor: LayeredHumanActor,
  transform: (
    signals: readonly ProductionActorSignal[],
  ) => readonly ProductionActorSignal[],
): void {
  const realAdvance = actor.advance.bind(actor);
  vi.spyOn(actor, "advance").mockImplementation((deltaSeconds, nowMs) =>
    transform(realAdvance(deltaSeconds, nowMs)));
}

describe("character pilot timeline", () => {
  it("starts at the exact immutable front-idle milestone", () => {
    const { timeline } = createFixture();
    const frame = timeline.seek("front-idle");

    expect(frame).toMatchObject({
      beat: "idle",
      phase: "idle-hold",
      elapsedMs: 0,
      lastMarker: null,
      actor: {
        position: { x: 226, y: 102 },
        facing: "south",
        activeAction: null,
        distanceTravelled: 0,
        stridePhase: 0,
      },
    });
    expect(frame.actor.layers.body).toMatchObject({
      clipId: "human-a:idle:south",
      frameIndex: 0,
      facing: "south",
    });
    expect(frame.actor.layers.face.clipId).toBe("human-a:south:neutral");
    expect(frame.actor.layers.held.clipId).toBe("none:south");
    expect(deepFrozen(frame)).toBe(true);
  });

  it("exposes every semantic phase once in authored loop order", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = timeline.seek("front-idle");
    const phases: PilotPhase[] = [frame.phase];
    let completedLoop = false;

    for (let index = 0; index < 2_000; index += 1) {
      frame = step(timeline, clock);
      if (frame.phase !== phases.at(-1)) phases.push(frame.phase);
      if (frame.elapsedMs === 0 && phases.length > 1) {
        completedLoop = true;
        break;
      }
    }

    expect(completedLoop).toBe(true);
    expect(phases).toEqual([
      "idle-hold",
      "walk-route",
      "walk-stop",
      "walk-orient",
      "talk-neutral-open",
      "talk-one",
      "talk-two",
      "talk-neutral-close",
      "reach-action",
      "reach-gap",
      "work-action",
      "work-gap",
      "fall-action",
      "prone-hold",
      "recover-action",
      "settled-hold",
      "idle-hold",
    ] satisfies readonly PilotPhase[]);
  });

  it("holds front idle for 6500 ms and completes the seeded blink before walking", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    const visibleFaces = new Set<string>();
    let frame = timeline.seek("front-idle");
    while (frame.beat === "idle") {
      visibleFaces.add(faceExpression(frame.actor));
      frame = step(timeline, clock);
    }

    expect(frame.beat).toBe("walk");
    expect(frame.elapsedMs).toBe(6_500);
    expect(visibleFaces).toEqual(new Set(["neutral", "blink-1", "blink-2"]));
  });

  it("walks the exact rectangle through four atomic facings without teleporting", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let previous = timeline.seek("front-idle");
    const movingFacings = new Set<string>();
    const seenCorners = new Set<string>();
    const signals: ProductionActorSignal[] = [];
    let talk: PilotFrame | null = null;

    for (let index = 0; index < 1_000; index += 1) {
      const frame = step(timeline, clock);
      signals.push(...frame.signals);
      const dx = frame.actor.position.x - previous.actor.position.x;
      const dy = frame.actor.position.y - previous.actor.position.y;
      if (dx !== 0 || dy !== 0) {
        expect(dx === 0 || dy === 0).toBe(true);
        expect(Math.abs(dx) + Math.abs(dy)).toBeLessThanOrEqual(1 + 1e-9);
      }
      if (frame.actor.activeAction === "orienting") {
        expect({ dx, dy }).toEqual({ dx: 0, dy: 0 });
      }
      if (frame.actor.activeAction === "moving") {
        movingFacings.add(frame.actor.facing);
      }
      expect(new Set(Object.values(frame.actor.layers).map(({ facing }) => facing)))
        .toEqual(new Set([frame.actor.facing]));
      const positionKey = `${frame.actor.position.x},${frame.actor.position.y}`;
      if (["226,150", "286,150", "286,102", "226,102"].includes(positionKey)) {
        seenCorners.add(positionKey);
      }
      previous = frame;
      if (frame.beat === "talk") {
        talk = frame;
        break;
      }
    }

    expect(talk).not.toBeNull();
    expect(movingFacings).toEqual(new Set(["south", "east", "north", "west"]));
    expect(seenCorners).toEqual(new Set(["226,150", "286,150", "286,102", "226,102"]));
    expect(signals.filter(({ kind }) => kind === "arrived")).toHaveLength(1);
    expect(markerSignals(signals, "settled")).toHaveLength(1);
    expect(talk!.actor).toMatchObject({
      position: START,
      facing: "south",
      routeActive: false,
      activeAction: null,
    });
    expect(talk!.actor.layers.body.clipId).toBe("human-a:idle:south");
  });

  it("lands on the exact distance-driven east profile milestone", () => {
    const { timeline } = createFixture();
    const frame = timeline.seek("east-mid-walk");

    expect(frame).toMatchObject({
      beat: "walk",
      phase: "walk-route",
      actor: {
        position: { x: 256, y: 150 },
        facing: "east",
        activeAction: "moving",
        distanceTravelled: 78,
        stridePhase: 6.5,
      },
    });
    expect(frame.actor.layers.body).toMatchObject({
      clipId: "human-a:walk:east",
      frameIndex: 3,
    });
    expect(new Set(Object.values(frame.actor.layers).map(({ facing }) => facing)))
      .toEqual(new Set(["east"]));
  });

  it("is invariant to complete external timestep partitioning and preserves signal order", () => {
    const drive = (partitions: readonly number[]) => {
      const { timeline } = createFixture();
      const clock = { nowMs: 0 };
      const signals: ProductionActorSignal[] = [];
      let frame = timeline.seek("front-idle");
      for (const milliseconds of partitions) {
        frame = step(timeline, clock, milliseconds);
        signals.push(...frame.signals);
      }
      return {
        frame: withoutInstance(frame),
        signals,
      };
    };
    const uniform = Array.from({ length: 900 }, () => 20);
    const irregular = Array.from({ length: 90 }, () => [5, 15, 37, 63, 80]).flat();

    expect(irregular.reduce((sum, value) => sum + value, 0)).toBe(18_000);
    expect(drive(irregular)).toEqual(drive(uniform));
  });

  it("preserves the admitted fractional tail when an ordinary advance crosses auto-restart", () => {
    const drive = (partitions: readonly number[]) => {
      const { timeline } = createFixture();
      const clock = { nowMs: 0 };
      const signals: ProductionActorSignal[] = [];
      let frame = timeline.seek("front-idle");
      for (const milliseconds of partitions) {
        frame = step(timeline, clock, milliseconds);
        signals.push(...frame.signals);
      }
      return { frame: withoutInstance(frame), signals };
    };
    const commonPrefix = Array.from({ length: 960 }, () => 20);
    const crossing = [...commonPrefix, 115, 5];
    const split = [...commonPrefix, 100, 15, 5];

    expect(Math.max(...crossing)).toBeLessThanOrEqual(120);
    expect(crossing.reduce((sum, value) => sum + value, 0)).toBe(19_320);
    expect(drive(crossing)).toEqual(drive(split));
  });

  it("clamps janky presentation deltas to one authored frame without skipping contact poses", () => {
    const { timeline } = createFixture();
    const required = new Set([
      "hand-contact",
      "work-contact",
      "fall-contact",
      "recovery-contact",
    ]);
    const observed = new Set<string>();
    const jankyDeltas = [0.6, 0.19, 0.087, 0.24] as const;
    let nowMs = 0;

    for (let call = 0; call < 500 && observed.size < required.size; call += 1) {
      const deltaSeconds = jankyDeltas[call % jankyDeltas.length]!;
      nowMs += deltaSeconds * 1_000;
      const frame = timeline.advance(deltaSeconds, nowMs);
      for (const signal of frame.signals) {
        if (signal.kind !== "marker" || !required.has(signal.marker)) continue;
        observed.add(signal.marker);
        expect(deepFrozen(frame.signals)).toBe(true);
        if (signal.marker === "hand-contact") {
          expect(frame.beat).toBe("reach");
          expect(frame.actor.layers.body.frameIndex).toBe(3);
          expect(frame.actor.layers.held.clipId).toBe("resource-handful:south");
        } else if (signal.marker === "work-contact") {
          expect(frame.beat).toBe("work");
          expect(frame.actor.layers.body.frameIndex).toBe(3);
          expect(frame.actor.layers.held.clipId).toBe("hammer:south");
        } else if (signal.marker === "fall-contact") {
          expect(frame.beat).toBe("fall");
          expect(frame.actor.layers.body.frameIndex).toBe(4);
          expect(frame.actor.layers.face.clipId).toBe("human-a:south:hurt");
        } else {
          expect(frame.beat).toBe("recover");
          expect(frame.actor.layers.body.frameIndex).toBe(4);
          expect(frame.actor.activeAction).toBe("recovering");
        }
      }
    }

    expect(observed).toEqual(required);
  });

  it("admits at most 120 ms from a large finite presentation delta", () => {
    const { timeline } = createFixture();
    const frame = timeline.advance(1, 1_000);

    expect(frame.elapsedMs).toBe(120);
    expect(frame.beat).toBe("idle");
  });

  it("bounds Number.MAX_VALUE without overflow, catch-up debt, or a hang", () => {
    const { timeline } = createFixture();
    const first = timeline.advance(Number.MAX_VALUE, 1);
    const second = timeline.advance(Number.MAX_VALUE, 2);

    expect(first.elapsedMs).toBe(120);
    expect(second.elapsedMs).toBe(240);
    expect(first.signals).toEqual([]);
    expect(second.signals).toEqual([]);
  });

  it("still clears a fractional tail on explicit restart and seek", () => {
    const restartFixture = createFixture();
    restartFixture.timeline.advance(0.015, 15);
    const restarted = restartFixture.timeline.restart(15);
    const afterRestart = restartFixture.timeline.advance(0.005, 20);

    expect(restarted.elapsedMs).toBe(0);
    expect(afterRestart.elapsedMs).toBe(0);

    const seekFixture = createFixture();
    seekFixture.timeline.advance(0.015, 15);
    seekFixture.timeline.seek("front-idle");
    const afterSeek = seekFixture.timeline.advance(0.005, 20);
    expect(afterSeek.elapsedMs).toBe(0);
  });

  it("talks through the face channel while the body and route stay idle", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = advanceUntil(timeline, ({ beat }) => beat === "talk");
    clock.nowMs = frame.elapsedMs;
    const expressions = [faceExpression(frame.actor)];

    while (frame.beat === "talk") {
      expect(frame.actor.position).toEqual(START);
      expect(frame.actor.facing).toBe("south");
      expect(frame.actor.routeActive).toBe(false);
      expect(frame.actor.layers.body.clipId).toBe("human-a:idle:south");
      expect(frame.actor.layers.held.clipId).toBe("none:south");
      expect(frame.actor.layers.status.clipId).toBe("alive:south");
      frame = step(timeline, clock);
      if (frame.beat === "talk") expressions.push(faceExpression(frame.actor));
    }

    expect(uniqueInOrder(expressions)).toEqual([
      "neutral",
      "talk-1",
      "talk-2",
      "neutral",
    ]);
    expect(frame.beat).toBe("reach");
  });

  it("keeps the resource attached through one authored hand contact and clears after idle", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = advanceUntil(timeline, ({ beat }) => beat === "reach");
    clock.nowMs = frame.elapsedMs;
    const contacts: ProductionActorSignal[] = [];
    let clearFrame: PilotFrame | null = null;

    expect(frame.actor.layers.held.clipId).toBe("resource-handful:south");
    while (frame.beat === "reach") {
      const contact = markerSignals(frame.signals, "hand-contact");
      contacts.push(...contact);
      if (contact.length > 0) {
        expect(frame.actor.layers.body).toMatchObject({
          clipId: "human-a:reach-give:south",
          frameIndex: 3,
        });
        expect(frame.actor.layers.held.clipId).toBe("resource-handful:south");
      }
      if (frame.actor.layers.held.clipId === "none:south" && clearFrame === null) {
        clearFrame = frame;
      }
      frame = step(timeline, clock);
    }

    expect(contacts).toEqual([
      expect.objectContaining({
        kind: "marker",
        marker: "hand-contact",
        action: "reach-give",
        frameIndex: 3,
      }),
    ]);
    expect(clearFrame).not.toBeNull();
    expect(clearFrame!.actor.layers.body.clipId).toBe("human-a:idle:south");
    expect(frame.beat).toBe("work");
    expect(frame.elapsedMs - clearFrame!.elapsedMs).toBe(360);
    expect(frame.actor.layers.held.clipId).toBe("hammer:south");
  });

  it("keeps the hammer attached through one authored work contact and clears after idle", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = advanceUntil(timeline, ({ beat }) => beat === "work");
    clock.nowMs = frame.elapsedMs;
    const contacts: ProductionActorSignal[] = [];
    let clearFrame: PilotFrame | null = null;

    expect(frame.actor.layers.held.clipId).toBe("hammer:south");
    while (frame.beat === "work") {
      const contact = markerSignals(frame.signals, "work-contact");
      contacts.push(...contact);
      if (contact.length > 0) {
        expect(frame.actor.layers.body).toMatchObject({
          clipId: "human-a:work:south",
          frameIndex: 3,
        });
        expect(frame.actor.layers.held.clipId).toBe("hammer:south");
      }
      if (frame.actor.layers.held.clipId === "none:south" && clearFrame === null) {
        clearFrame = frame;
      }
      frame = step(timeline, clock);
    }

    expect(contacts).toEqual([
      expect.objectContaining({
        kind: "marker",
        marker: "work-contact",
        action: "work",
        frameIndex: 3,
      }),
    ]);
    expect(clearFrame).not.toBeNull();
    expect(clearFrame!.actor.layers.body.clipId).toBe("human-a:idle:south");
    expect(frame.beat).toBe("fall");
    expect(frame.elapsedMs - clearFrame!.elapsedMs).toBe(360);
    expect(frame.actor.layers.held.clipId).toBe("none:south");
  });

  it("falls directly into prone and reverses the fall on the same actor", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = advanceUntil(timeline, ({ beat }) => beat === "fall");
    clock.nowMs = frame.elapsedMs;
    const instanceId = frame.actor.instanceId;
    const fallContacts: ProductionActorSignal[] = [];

    while (frame.beat === "fall") {
      const contact = markerSignals(frame.signals, "fall-contact");
      fallContacts.push(...contact);
      if (contact.length > 0) {
        expect(frame.actor.layers.body).toMatchObject({
          clipId: "human-a:hurt-fall:south",
          frameIndex: 4,
        });
      }
      frame = step(timeline, clock);
    }
    expect(fallContacts).toEqual([
      expect.objectContaining({
        marker: "fall-contact",
        action: "hurt-fall",
        frameIndex: 4,
      }),
    ]);
    expect(frame).toMatchObject({
      beat: "prone",
      lastMarker: "fall-contact",
      actor: {
        instanceId,
        activeAction: "prone",
        position: START,
      },
    });
    expect(frame.actor.layers.body).toMatchObject({
      clipId: "human-a:prone:south",
      frameIndex: 0,
    });
    expect(frame.actor.layers.face.clipId).toBe("human-a:south:hurt");
    expect(frame.actor.layers.status.clipId).toBe("paralyzed:south");

    const proneAt = frame.elapsedMs;
    while (frame.beat === "prone") frame = step(timeline, clock);
    expect(frame.beat).toBe("recover");
    expect(frame.elapsedMs - proneAt).toBe(1_200);

    const reverseFrames = [frame.actor.layers.body.frameIndex];
    const recoveryContacts: ProductionActorSignal[] = [...markerSignals(
      frame.signals,
      "recovery-contact",
    )];
    while (frame.beat === "recover") {
      frame = step(timeline, clock);
      if (frame.beat === "recover") {
        reverseFrames.push(frame.actor.layers.body.frameIndex);
        recoveryContacts.push(...markerSignals(frame.signals, "recovery-contact"));
      }
    }

    expect(uniqueInOrder(reverseFrames)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(recoveryContacts).toEqual([
      expect.objectContaining({
        marker: "recovery-contact",
        action: "hurt-fall",
        frameIndex: 4,
      }),
    ]);
    expect(frame).toMatchObject({
      beat: "settled",
      actor: {
        instanceId,
        position: START,
        facing: "south",
        activeAction: null,
      },
    });
    expect(frame.actor.layers.body.clipId).toBe("human-a:idle:south");
    expect(frame.actor.layers.face.clipId).toBe("human-a:south:neutral");
  });

  it("holds the settled root for 1200 ms and auto-restarts the same actor", () => {
    const { timeline } = createFixture();
    const clock = { nowMs: 0 };
    let frame = advanceUntil(timeline, ({ beat }) => beat === "settled");
    clock.nowMs = frame.elapsedMs;
    const settledAt = frame.elapsedMs;
    const instanceId = frame.actor.instanceId;

    while (!(frame.beat === "idle" && frame.elapsedMs === 0)) {
      frame = step(timeline, clock);
    }

    expect(clock.nowMs - settledAt).toBe(1_200);
    expect(frame.actor).toMatchObject({
      instanceId,
      position: START,
      facing: "south",
      activeAction: null,
      distanceTravelled: 0,
      stridePhase: 0,
    });
    expect(frame.lastMarker).toBeNull();
    expect(frame.signals).toEqual([]);
  });

  it("seeks exact contact and prone milestones and reproduces all milestones on restart", () => {
    const { timeline } = createFixture();
    const milestones: readonly PilotMilestone[] = [
      "front-idle",
      "east-mid-walk",
      "reach-contact",
      "prone",
    ];
    const first = milestones.map((milestone) => timeline.seek(milestone));
    const instanceId = first[0]!.actor.instanceId;

    expect(first[2]).toMatchObject({
      beat: "reach",
      phase: "reach-action",
      lastMarker: "hand-contact",
      actor: {
        instanceId,
        facing: "south",
      },
    });
    expect(first[2]!.actor.layers.body).toMatchObject({
      clipId: "human-a:reach-give:south",
      frameIndex: 3,
    });
    expect(first[2]!.actor.layers.held.clipId).toBe("resource-handful:south");
    expect(first[3]).toMatchObject({
      beat: "prone",
      phase: "prone-hold",
      lastMarker: "fall-contact",
      actor: {
        instanceId,
        activeAction: "prone",
      },
    });

    timeline.restart(100);
    const second = milestones.map((milestone) => timeline.seek(milestone));
    expect(second.map(withoutInstance)).toEqual(first.map(withoutInstance));
    expect(second.every(({ actor }) => actor.instanceId === instanceId)).toBe(true);
  });

  it("rejects invalid clocks and all mutation after idempotent disposal", () => {
    const fixture = createFixture();
    const { timeline, actor, leases } = fixture;
    expect(() => timeline.advance(-0.001, 0)).toThrow(/non-negative finite delta/i);
    expect(() => timeline.advance(Number.NaN, 0)).toThrow(/non-negative finite delta/i);
    expect(() => timeline.advance(0, Number.POSITIVE_INFINITY)).toThrow(/finite.*time/i);
    timeline.advance(0, 10);
    expect(() => timeline.advance(0, 9)).toThrow(/monotonic/i);
    expect(() => timeline.restart(8)).toThrow(/monotonic/i);
    expect(() => timeline.seek("missing" as PilotMilestone)).toThrow(/unknown milestone/i);

    const beforeDispose = actor.snapshot();
    const dispose = vi.spyOn(actor, "dispose");
    timeline.dispose();
    timeline.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    for (const lease of leases.values()) expect(lease.release).toHaveBeenCalledTimes(1);
    expect(() => timeline.advance(0, 10)).toThrow(/disposed/i);
    expect(() => timeline.restart(10)).toThrow(/disposed/i);
    expect(() => timeline.seek("front-idle")).toThrow(/disposed/i);
    expect(actor.snapshot()).toEqual(beforeDispose);
  });

  it("fails as soon as an action returns idle without its required contact marker", () => {
    const manifest = patchHumanAClips(
      (clip) => ({ ...clip, markers: [] }),
      "reach-give",
    );
    const { timeline } = createFixture(manifest);

    expect(() => timeline.seek("reach-contact")).toThrow(
      /reach-give.*without exactly one hand-contact/i,
    );
  });

  it("rejects a required contact marker on the wrong authored frame", () => {
    const manifest = patchHumanAClips(
      (clip) => ({
        ...clip,
        markers: [{ frame: 2, name: "hand-contact" }],
      }),
      "reach-give",
    );
    const { timeline } = createFixture(manifest);

    expect(() => timeline.seek("reach-contact")).toThrow(
      /hand-contact.*reach-give.*frame 3/i,
    );
  });

  it("fails fast on a duplicate required contact marker from the real actor boundary", () => {
    const { actor, timeline } = createFixture();
    interceptActorSignals(actor, (signals) => {
      const contact = signals.find((signal) =>
        signal.kind === "marker" && signal.marker === "hand-contact");
      return contact === undefined ? signals : [...signals, contact];
    });

    expect(() => timeline.seek("reach-contact")).toThrow(/duplicate hand-contact/i);
  });

  it("fails fast when the real actor arrival signal is lost", () => {
    const { actor, timeline } = createFixture();
    interceptActorSignals(actor, (signals) =>
      signals.filter(({ kind }) => kind !== "arrived"));

    expect(() => timeline.seek("reach-contact")).toThrow(
      /route became inactive before its one arrival/i,
    );
  });

  it("fails fast when the native stop settled marker is lost", () => {
    const { actor, timeline } = createFixture();
    interceptActorSignals(actor, (signals) =>
      signals.filter((signal) =>
        signal.kind !== "marker" || signal.marker !== "settled"));

    expect(() => timeline.seek("reach-contact")).toThrow(
      /stop returned to idle without exactly one settled marker/i,
    );
  });

  it("fails fast when the final south facing-switch signal is lost", () => {
    const { actor, timeline } = createFixture();
    let facingSwitches = 0;
    interceptActorSignals(actor, (signals) =>
      signals.filter((signal) => {
        if (signal.kind !== "marker" || signal.marker !== "facing-switch") return true;
        facingSwitches += 1;
        return facingSwitches !== 4;
      }));

    expect(() => timeline.seek("reach-contact")).toThrow(
      /final orientation.*south facing-switch/i,
    );
  });

  it("fails fast when an authored action overruns its bounded phase", () => {
    const manifest = patchHumanAClips(
      (clip) => ({
        ...clip,
        frames: clip.frames.map((frame) => ({ ...frame, durationMs: 1_000 })),
      }),
      "reach-give",
    );
    const { timeline } = createFixture(manifest);

    expect(() => timeline.seek("reach-contact")).toThrow(
      /reach-give action exceeded its 1000 ms phase contract/i,
    );
  });

  it("bounds an unreachable seek to 2000 private steps", () => {
    const manifest = patchHumanAClips(
      (clip) => ({ ...clip, strideLength: 10 }),
      "walk",
      ["south", "east", "north", "west"],
    );
    const { timeline } = createFixture(manifest);

    expect(() => timeline.seek("east-mid-walk")).toThrow(
      /east-mid-walk.*2000 private steps/i,
    );
  });
});
