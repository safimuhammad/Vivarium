import { describe, expect, it, vi, type Mock } from "vitest";

import type { Vec2 } from "../../contracts";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "../assets/productionManifest";
import { deriveHumanAppearance } from "./appearance";
import {
  LayeredHumanActor,
  type HumanPrimitiveCommand,
  type LayeredHumanActorOptions,
  type LayeredHumanSnapshot,
} from "./LayeredHumanActor";

type TestLease = ProductionAssetLease<ImageBitmap> & { readonly release: Mock<() => void> };

function fakeLease(label: string): TestLease {
  return { value: { label } as unknown as ImageBitmap, release: vi.fn<() => void>() };
}

function createLeases(
  manifest: ProductionAssetManifest = PRODUCTION_ASSET_MANIFEST,
): ReadonlyMap<string, TestLease> {
  return new Map(
    Object.values(manifest.atlases)
      .filter(({ group }) => group === "core")
      .map(({ id }) => [id, fakeLease(id)]),
  );
}

function createActor(
  overrides: Partial<LayeredHumanActorOptions> = {},
): { readonly actor: LayeredHumanActor; readonly leases: ReadonlyMap<string, TestLease> } {
  const manifest = overrides.manifest ?? PRODUCTION_ASSET_MANIFEST;
  const leases = overrides.atlasLeases as ReadonlyMap<string, TestLease> | undefined
    ?? createLeases(manifest);
  return {
    actor: new LayeredHumanActor({
      id: "agent_aster",
      name: "Aster",
      persona: "quiet observer",
      position: { x: 24, y: 61 },
      facing: "east",
      manifest,
      atlasLeases: leases,
      ...overrides,
    }),
    leases,
  };
}

function layerFacings(snapshot: LayeredHumanSnapshot): readonly string[] {
  return Object.values(snapshot.layers).map(({ facing }) => facing);
}

function visualSignature(snapshot: LayeredHumanSnapshot): unknown {
  return {
    position: snapshot.position,
    facing: snapshot.facing,
    distanceTravelled: snapshot.distanceTravelled,
    stridePhase: snapshot.stridePhase,
    layers: snapshot.layers,
  };
}

interface IdleWakeSample {
  readonly deadlineMs: number;
  readonly face: LayeredHumanSnapshot["layers"]["face"];
  readonly snapshot: LayeredHumanSnapshot;
}

function captureIdleBlinkSequence(
  actor: LayeredHumanActor,
  requiredBlinkFrames: number,
): readonly IdleWakeSample[] {
  const samples: IdleWakeSample[] = [];
  let blinkFrames = 0;
  for (let wake = 0; wake < 200 && blinkFrames < requiredBlinkFrames; wake += 1) {
    const deadlineMs = actor.nextDeadlineMs();
    if (deadlineMs === null) throw new Error("Idle actor stopped advertising wake deadlines.");
    actor.advance(0, deadlineMs);
    const snapshot = actor.snapshot();
    const face = snapshot.layers.face;
    if (face.clipId.includes(":blink-")) blinkFrames += 1;
    samples.push({ deadlineMs, face, snapshot });
  }
  if (blinkFrames < requiredBlinkFrames) {
    throw new Error(`Observed only ${blinkFrames} idle blink frames.`);
  }
  return samples;
}

function drawingContext(calls: unknown[][]): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: true,
    filter: "none",
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    save: () => undefined,
    restore: () => undefined,
    drawImage: (...args: unknown[]) => calls.push(args),
    fillRect: () => undefined,
    strokeRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

function alphaRecordingContext(alphas: number[]): CanvasRenderingContext2D {
  let alpha = 1;
  const stack: number[] = [];
  return {
    imageSmoothingEnabled: true,
    filter: "none",
    globalCompositeOperation: "source-over",
    get globalAlpha() { return alpha; },
    set globalAlpha(value: number) { alpha = value; },
    fillStyle: "#000000",
    strokeStyle: "#000000",
    save: () => { stack.push(alpha); },
    restore: () => { alpha = stack.pop() ?? 1; },
    drawImage: () => { alphas.push(alpha); },
    fillRect: () => { alphas.push(alpha); },
    strokeRect: () => { alphas.push(alpha); },
  } as unknown as CanvasRenderingContext2D;
}

function atlasCalls(actor: LayeredHumanActor, atlasId: string): unknown[][] {
  const calls: unknown[][] = [];
  actor.draw(drawingContext(calls));
  return calls.filter(([image]) => (image as { label: string }).label === atlasId);
}

function agentIdForRig(rig: "human-a" | "human-b"): string {
  for (let index = 0; index < 100; index += 1) {
    const id = `compositor_${index}`;
    if (deriveHumanAppearance(id, "compositor review").rig === rig) return id;
  }
  throw new Error(`Could not derive a fixture ID for ${rig}.`);
}

describe("LayeredHumanActor mechanics-faithful state", () => {
  it("clears a completed gather body pose without waiting for another action", () => {
    const { actor } = createActor();
    actor.apply({ kind: "play-body", action: "gather" }, 0);
    expect(actor.snapshot().activeAction).not.toBeNull();
    actor.apply({ kind: "clear-body" }, 1);
    expect(actor.snapshot().activeAction).toBeNull();
  });

  it.each(["paralyzed", "dead"] as const)("body cleanup preserves %s state", (status) => {
    const { actor } = createActor();
    actor.apply({ kind: "set-status", status }, 0);
    actor.apply({ kind: "clear-body" }, 1);
    expect(actor.snapshot().activeAction).toBe(status === "dead" ? "dead" : "prone");
    expect(actor.snapshot().terminal).toBe(status === "dead");
    actor.apply({ kind: "move", waypoints: [{ x: 80, y: 61 }], speedPixelsPerSecond: 10, gait: "walk" }, 2);
    expect(actor.snapshot().routeActive).toBe(false);
  });

  it("body cleanup preserves an active route and turn timing", () => {
    const { actor } = createActor({ position: { x: 0, y: 0 }, facing: "south" });
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

  it("exposes only the currently active bounded semantic primitive", () => {
    const { actor } = createActor();
    expect(actor.snapshot().activeAction).toBeNull();

    actor.apply({
      kind: "move",
      waypoints: [{ x: 80, y: 61 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, 0);
    expect(actor.snapshot().activeAction).toBe("moving");

    actor.apply({ kind: "play-body", action: "work" }, 0);
    expect(actor.snapshot().activeAction).toBe("working");
    actor.advance(2, 2_000);
    expect(actor.snapshot().activeAction).toBeNull();

    actor.apply({ kind: "set-status", status: "paralyzed" }, 2_000);
    expect(actor.snapshot().activeAction).toBe("prone");
    actor.apply({ kind: "recover" }, 2_000);
    expect(actor.snapshot().activeAction).toBe("recovering");
  });

  it("reports actual locomotion ownership independently of presentation semantics", () => {
    const { actor } = createActor({ facing: "south" });
    const start = actor.snapshot().position;
    expect(actor.snapshot().routeActive).toBe(false);

    actor.apply({
      kind: "move",
      waypoints: [{ x: start.x, y: start.y + 96 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, 0);
    expect(actor.snapshot()).toMatchObject({ activeAction: "moving", routeActive: true });

    actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
    expect(actor.snapshot()).toMatchObject({ activeAction: "speaking", routeActive: true });

    actor.apply({ kind: "play-body", action: "work" }, 0);
    expect(actor.snapshot()).toMatchObject({ activeAction: "speaking", routeActive: false });

    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    actor.apply({
      kind: "move",
      waypoints: [{ x: start.x, y: start.y + 192 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, 0);
    expect(actor.snapshot()).toMatchObject({ activeAction: "prone", routeActive: false });
  });

  it("recovers from prone by traversing the existing hurt frames in reverse", () => {
    const { actor } = createActor();
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    actor.apply({ kind: "recover" } as unknown as HumanPrimitiveCommand, 0);

    const observed = [actor.snapshot().layers.body.frameIndex];
    const signals = [];
    for (const nowMs of [121, 241, 361, 481, 601, 721]) {
      signals.push(...actor.advance(0.12, nowMs));
      observed.push(actor.snapshot().layers.body.frameIndex);
    }

    expect(observed.slice(0, 6)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(signals.filter((signal) => (
      signal.kind === "marker" && signal.marker === "recovery-contact"
    ))).toHaveLength(1);
    expect(actor.snapshot().layers.body.clipId).toContain(":idle:");
    expect(new Set(layerFacings(actor.snapshot()))).toEqual(new Set(["east"]));
    expect(actor.snapshot().position).toEqual({ x: 24, y: 61 });
  });

  it("permits atomic reposition only for declared presentation fallback reasons", () => {
    const { actor } = createActor();
    const reposition = (reason: string): HumanPrimitiveCommand => ({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason,
    } as unknown as HumanPrimitiveCommand);

    expect(() => actor.apply(reposition("ordinary-movement"), 0)).toThrow(/reposition reason/i);
    actor.apply(reposition("reduced-motion"), 0);
    expect(actor.snapshot()).toMatchObject({
      position: { x: 96, y: 128 },
      opacity: 1,
      reposition: null,
    });
    expect(actor.advance(0, 0)).toContainEqual({
      kind: "repositioned",
      actorId: "agent_aster",
      position: { x: 96, y: 128 },
      reason: "reduced-motion",
    });
    actor.apply({
      kind: "reposition",
      position: { x: 32, y: 224 },
      reason: "region-transition",
    }, 0);
    expect(actor.snapshot()).toMatchObject({
      position: { x: 32, y: 224 },
      opacity: 1,
      reposition: null,
    });
    expect(actor.advance(0, 0)).toContainEqual({
      kind: "repositioned",
      actorId: "agent_aster",
      position: { x: 32, y: 224 },
      reason: "region-transition",
    });
  });

  it("fades through one exact transparent boundary before fallback repositioning", () => {
    const { actor } = createActor();
    const origin = { ...actor.snapshot().position };
    const target = { x: 96, y: 128 };
    actor.apply({ kind: "reposition", position: target, reason: "fallback" }, 0);

    expect(actor.snapshot()).toMatchObject({
      position: origin,
      opacity: 1,
      reposition: { phase: "fade-out", reason: "fallback", target },
    });
    expect(actor.nextDeadlineMs()).not.toBeNull();

    const samples: LayeredHumanSnapshot[] = [actor.snapshot()];
    const signals = [];
    for (let frame = 1; frame <= 60 && actor.snapshot().reposition !== null; frame += 1) {
      const nowMs = frame * 1_000 / 60;
      expect(actor.nextDeadlineMs()).toBeGreaterThan((frame - 1) * 1_000 / 60);
      signals.push(...actor.advance(1 / 60, nowMs));
      samples.push(actor.snapshot());
    }

    const changedIndex = samples.findIndex(({ position }) => (
      position.x === target.x && position.y === target.y
    ));
    expect(changedIndex).toBeGreaterThan(0);
    expect(samples[changedIndex - 1]).toMatchObject({
      position: origin,
      reposition: { phase: "fade-out", reason: "fallback" },
    });
    expect(samples[changedIndex]).toMatchObject({
      position: target,
      opacity: 0,
      reposition: { phase: "fade-in", reason: "fallback", target },
    });
    expect(samples.at(-1)).toMatchObject({ position: target, opacity: 1, reposition: null });
    expect((samples.length - 1) * 1_000 / 60).toBeLessThan(1_000);
    expect(signals.filter(({ kind }) => kind === "repositioned")).toEqual([{
      kind: "repositioned",
      actorId: "agent_aster",
      position: target,
      reason: "fallback",
    }]);
  });

  it("keeps a fallback fade active while accepting its paired orientation primitive", () => {
    const { actor } = createActor({ facing: "east" });
    const origin = actor.snapshot().position;
    const target = { x: 96, y: 128 };
    actor.stageCommands([{
      kind: "reposition",
      position: target,
      reason: "fallback",
    }, {
      kind: "orient",
      facing: "north",
    }], 0);

    expect(actor.snapshot()).toMatchObject({
      position: origin,
      opacity: 1,
      reposition: { phase: "fade-out", reason: "fallback", target },
      activeAction: "orienting",
    });
  });

  it("explicitly cancels a stale fallback back to its origin without a later relocation", () => {
    for (const [elapsedSeconds, elapsedMs] of [[0.09, 90], [0.2, 200]] as const) {
      const { actor } = createActor();
      const origin = actor.snapshot().position;
      actor.apply({
        kind: "reposition",
        position: { x: 96, y: 128 },
        reason: "fallback",
      }, 0);
      const emittedBeforeCancellation = actor.advance(elapsedSeconds, elapsedMs);
      expect(actor.snapshot().reposition).not.toBeNull();

      actor.cancelFallbackReposition();
      expect(actor.snapshot()).toMatchObject({
        position: origin,
        opacity: 1,
        reposition: null,
      });
      expect(actor.advance(0.5, elapsedMs + 500)).toEqual([]);
      expect(emittedBeforeCancellation.filter(({ kind }) => kind === "repositioned"))
        .toHaveLength(elapsedMs >= 180 ? 1 : 0);
    }
  });

  it("applies the fallback fade opacity to every drawn human layer", () => {
    const { actor } = createActor();
    actor.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 0);
    actor.advance(1 / 60, 1_000 / 60);
    const { opacity } = actor.snapshot();
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);

    const alphas: number[] = [];
    actor.draw(alphaRecordingContext(alphas));
    expect(alphas.length).toBeGreaterThan(0);
    expect(alphas.every((value) => value === opacity)).toBe(true);
  });

  it("applies fallback opacity to every person-marker primitive and accent", () => {
    const { actor: marker } = createActor({ atlasLeases: new Map() });
    marker.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 0);
    marker.advance(1 / 60, 1_000 / 60);

    const markerAlphas: number[] = [];
    marker.draw(alphaRecordingContext(markerAlphas));
    expect(markerAlphas.length).toBeGreaterThan(0);
    expect(markerAlphas.every((value) => value === marker.snapshot().opacity)).toBe(true);

    const { actor: layered } = createActor({ id: "agent_accented" });
    expect(layered.snapshot().appearance.secondaryAccent).not.toBeNull();
    layered.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 0);
    layered.advance(1 / 60, 1_000 / 60);
    const layeredAlphas: number[] = [];
    layered.draw(alphaRecordingContext(layeredAlphas));
    expect(layeredAlphas.every((value) => value === layered.snapshot().opacity)).toBe(true);
  });

  it("restores full visibility when locomotion, status, or recovery supersedes a fade", () => {
    const { actor } = createActor();
    const origin = actor.snapshot().position;
    actor.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 0);
    actor.advance(0.1, 100);
    expect(actor.snapshot()).toMatchObject({ position: origin, reposition: { phase: "fade-out" } });
    expect(actor.snapshot().opacity).toBeLessThan(1);

    actor.apply({ kind: "set-status", status: "paralyzed" }, 100);
    expect(actor.snapshot()).toMatchObject({ position: origin, opacity: 1, reposition: null });
    actor.apply({ kind: "recover" }, 100);
    expect(actor.snapshot()).toMatchObject({ opacity: 1, reposition: null, activeAction: "recovering" });

    actor.advance(1, 1_100);
    actor.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 1_100);
    actor.advance(0.2, 1_300);
    expect(actor.snapshot()).toMatchObject({
      position: { x: 96, y: 128 },
      opacity: 0,
      reposition: { phase: "fade-in" },
    });
    actor.apply({
      kind: "move",
      waypoints: [{ x: 128, y: 128 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, 1_300);
    expect(actor.snapshot()).toMatchObject({ opacity: 1, reposition: null, routeActive: true });
  });

  it("rolls back an in-flight fade through both scene-position and command transactions", () => {
    const { actor } = createActor();
    actor.apply({
      kind: "reposition",
      position: { x: 96, y: 128 },
      reason: "fallback",
    }, 0);
    actor.advance(1 / 60, 1_000 / 60);
    const fading = actor.snapshot();

    const rollbackPosition = actor.stagePosition({ x: 32, y: 224 });
    expect(actor.snapshot()).toMatchObject({ position: { x: 32, y: 224 }, opacity: 1, reposition: null });
    rollbackPosition?.();
    expect(actor.snapshot()).toEqual(fading);

    expect(() => actor.stageCommands([{
      kind: "move",
      waypoints: [{ x: 80, y: 61 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, {
      kind: "move",
      waypoints: [{ x: 96, y: 61 }],
      speedPixelsPerSecond: 0,
      gait: "walk",
    }], 1_000 / 60)).toThrow(/speed/i);
    expect(actor.snapshot()).toEqual(fading);
  });

  it("rolls back every staged command when a later command rejects", () => {
    const { actor } = createActor();
    const before = actor.snapshot();
    const commands: HumanPrimitiveCommand[] = [{
      kind: "move",
      waypoints: [{ x: 80, y: 61 }],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, {
      kind: "move",
      waypoints: [{ x: 96, y: 61 }],
      speedPixelsPerSecond: 0,
      gait: "walk",
    }];

    expect(() => actor.stageCommands(commands, 0)).toThrow(/speed/i);
    expect(actor.snapshot()).toEqual(before);
    expect(actor.advance(0, 0)).toEqual([]);
  });

  it("restores idle random state so the same actor replays every blink deadline and face plane", () => {
    const { actor } = createActor();
    const rollback = actor.stageCommands([{ kind: "set-selected", selected: false }], 0);

    const firstPass = captureIdleBlinkSequence(actor, 7);
    rollback();
    const replay = captureIdleBlinkSequence(actor, 7);

    expect(replay).toEqual(firstPass);
    const afterReplay = actor.snapshot();
    rollback();
    expect(actor.snapshot()).toEqual(afterReplay);
  });

  it("preserves the established default idle seed identity", () => {
    const { actor } = createActor();
    const firstBlink = captureIdleBlinkSequence(actor, 1)
      .find(({ face }) => face.clipId.includes(":blink-"));

    expect(firstBlink?.deadlineMs).toBe(5_721);
    expect(firstBlink?.face.clipId).toContain(":blink-1");
  });

  it("silently stages an atomic scene adoption without publishing a false reposition marker", () => {
    const { actor } = createActor();
    const stagePosition = (actor as unknown as {
      stagePosition?: (position: Vec2) => (() => void) | null;
    }).stagePosition;
    expect(stagePosition).toBeTypeOf("function");

    const rollback = stagePosition!.call(actor, { x: 48, y: 240 });

    expect(actor.snapshot()).toMatchObject({
      position: { x: 48, y: 240 },
      activeAction: null,
    });
    expect(actor.advance(0, 0).filter(({ kind }) => kind === "repositioned")).toEqual([]);
    rollback?.();
    rollback?.();
    expect(actor.snapshot().position).toEqual({ x: 24, y: 61 });
  });

  it("bounds scene-only visual offsets without adding durable travel distance", () => {
    const { actor } = createActor();
    actor.apply({
      kind: "set-offset",
      offset: { x: 6, y: -4 },
    } as unknown as HumanPrimitiveCommand, 0);
    expect(actor.snapshot().position).toEqual({ x: 30, y: 57 });
    expect(actor.snapshot().distanceTravelled).toBe(0);

    actor.apply({ kind: "set-offset", offset: { x: 0, y: 0 } } as unknown as HumanPrimitiveCommand, 0);
    expect(actor.snapshot().position).toEqual({ x: 24, y: 61 });
    expect(() => actor.apply({
      kind: "set-offset",
      offset: { x: 9, y: 0 },
    } as unknown as HumanPrimitiveCommand, 0)).toThrow(/8 pixels/i);
  });

  it("mechanics-faithful idle never emits an unrecorded action intent", () => {
    const { actor } = createActor();
    const initial = actor.snapshot();
    let nowMs = 0;
    const signals = [];
    for (let step = 0; step < 48; step += 1) {
      const deadline = actor.nextDeadlineMs();
      expect(deadline).not.toBeNull();
      expect(deadline!).toBeGreaterThan(nowMs);
      nowMs = deadline!;
      signals.push(...actor.advance(0, nowMs));
    }

    expect(signals).toEqual([]);
    expect(actor.snapshot().position).toEqual(initial.position);
    expect(actor.snapshot().layers.body.clipId).toContain(":idle:");
    expect(JSON.stringify(actor.snapshot())).not.toMatch(/move|work|speak|harvest|social|sleep|home-entry/);
  });

  it("never composites a front face over a sideways body", () => {
    for (const facing of ["east", "west"] as const) {
      const { actor } = createActor({ facing });
      const snapshot = actor.snapshot();
      const expected = PRODUCTION_ASSET_MANIFEST.human.rigs[snapshot.appearance.rig]
        .facePlanes[facing].neutral.frame.rect;

      expect(snapshot.layers.body.facing).toBe(facing);
      expect(snapshot.layers.face.facing).toBe(facing);
      expect(snapshot.layers.face.clipId).toBe(`${snapshot.appearance.rig}:${facing}:neutral`);
      const calls: unknown[][] = [];
      actor.draw(drawingContext(calls));
      const faceCall = calls[2]!;
      expect(faceCall.slice(1, 5)).toEqual([expected.x, expected.y, expected.width, expected.height]);
    }
  });

  it("advances six channels independently and draws them in declared order", () => {
    const { actor } = createActor();
    const initial = actor.snapshot();

    actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
    const talking = actor.snapshot();
    expect(talking.layers.face).not.toEqual(initial.layers.face);
    for (const layer of ["body", "hair", "clothing", "held", "status"] as const) {
      expect(talking.layers[layer]).toEqual(initial.layers[layer]);
    }

    actor.apply({ kind: "set-held", heldId: "basket" }, 0);
    const holding = actor.snapshot();
    expect(holding.layers.held).not.toEqual(talking.layers.held);
    actor.apply({ kind: "set-selected", selected: true }, 0);
    const selected = actor.snapshot();
    expect(selected.layers.status).not.toEqual(holding.layers.status);

    actor.apply({
      kind: "move",
      waypoints: [{ x: 60, y: 61 }],
      speedPixelsPerSecond: 30,
      gait: "walk",
    }, 0);
    actor.advance(0.2, 200);
    const walking = actor.snapshot();
    expect(walking.layers.body).not.toEqual(selected.layers.body);
    expect(walking.layers.hair).not.toEqual(selected.layers.hair);
    expect(walking.layers.clothing).not.toEqual(selected.layers.clothing);
    expect(walking.layers.face.clipId).toContain("talk-1");
    expect(walking.layers.held.clipId).toContain("basket");
    expect(walking.layers.status.clipId).toContain("selected");

    const calls: unknown[][] = [];
    actor.draw(drawingContext(calls));
    expect(calls.map(([image]) => (image as { label: string }).label)).toEqual([
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body,
      PRODUCTION_ASSET_MANIFEST.human.clothingAtlasBySilhouette[walking.appearance.clothingSilhouette],
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.face,
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.hair,
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.held,
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.status,
    ]);
  });

  it("uses stable full-ID appearance without category costume", () => {
    const first = createActor().actor.snapshot().appearance;
    const repeat = createActor().actor.snapshot().appearance;
    const changedCategory = createActor({ id: "mystic_aster" }).actor.snapshot().appearance;
    expect(first).toEqual(deriveHumanAppearance("agent_aster", "quiet observer"));
    expect(repeat).toEqual(first);
    expect(changedCategory).not.toEqual(first);
    expect(Object.values(first).some((value) => typeof value === "string" && /agent|mystic/.test(value))).toBe(false);
  });

  it.each(["east", "west", "north"] as const)(
    "direction:none action preserves retained %s facing",
    (facing) => {
      const { actor } = createActor({ facing });
      actor.apply({ kind: "play-body", action: "work" }, 0);
      const snapshot = actor.snapshot();
      expect(snapshot.facing).toBe(facing);
      expect(snapshot.layers.body.clipId).toBe(`${snapshot.appearance.rig}:work:${facing}`);
      expect(new Set(layerFacings(snapshot))).toEqual(new Set([facing]));
    },
  );

  it("switches every layer facing atomically on the authored turn marker", () => {
    const { actor } = createActor({ facing: "east" });
    actor.apply({ kind: "orient", facing: "north" }, 0);
    actor.advance(0.119, 119);
    expect(new Set(layerFacings(actor.snapshot()))).toEqual(new Set(["east"]));
    expect(actor.snapshot().layers.body.clipId).toBe(`${actor.snapshot().appearance.rig}:turn:east`);
    expect(actor.snapshot().layers.face.clipId).toContain(":east:");

    const signals = actor.advance(0.002, 121);
    expect(new Set(layerFacings(actor.snapshot()))).toEqual(new Set(["north"]));
    expect(actor.snapshot().facing).toBe("north");
    expect(actor.snapshot().layers.body.clipId).toBe(`${actor.snapshot().appearance.rig}:turn:north`);
    expect(actor.snapshot().layers.face.clipId).toContain(":north:");
    expect(signals).toEqual([expect.objectContaining({ kind: "marker", marker: "facing-switch" })]);
    expect(actor.advance(1, 1_121).filter(({ kind }) => kind === "marker")).toEqual([]);
  });

  it("commits reduced-motion orientation without an unscheduled turn", () => {
    const { actor } = createActor({ facing: "south", reducedMotion: true });

    actor.apply({ kind: "orient", facing: "west" }, 0);

    const snapshot = actor.snapshot();
    expect(snapshot.facing).toBe("west");
    expect(snapshot.activeAction).toBeNull();
    expect(new Set(layerFacings(snapshot))).toEqual(new Set(["west"]));
    expect(actor.nextDeadlineMs()).toBeNull();
  });

  it("retains a synchronous reduced-motion facing through the next body action", () => {
    const { actor } = createActor({ facing: "south", reducedMotion: true });

    actor.apply({ kind: "orient", facing: "west" }, 0);
    actor.apply({ kind: "play-body", action: "reach-give" }, 0);

    expect(actor.snapshot()).toMatchObject({
      facing: "west",
      activeAction: "reaching",
    });
    expect(new Set(layerFacings(actor.snapshot()))).toEqual(new Set(["west"]));
  });

  it("crosses large-delta markers exactly once in canonical frame order", () => {
    const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
    const work = manifest.human.rigs["human-a"].bodyClips["work:east"];
    (work as unknown as { markers: unknown[] }).markers = [
      { frame: 3, name: "work-contact" },
      { frame: 1, name: "hand-contact" },
    ];
    const { actor } = createActor({ manifest });
    actor.apply({ kind: "play-body", action: "work" }, 0);

    const signals = actor.advance(10, 10_000);
    expect(signals.map((signal) => signal.kind === "marker" ? signal.marker : signal.kind)).toEqual([
      "hand-contact",
      "work-contact",
    ]);
    expect(actor.advance(10, 20_000)).toEqual([]);
  });

  it.each(["walk", "run"] as const)(
    "%s is distance/stride driven and timestep-partition invariant",
    (gait) => {
      const once = createActor().actor;
      const partitioned = createActor().actor;
      const command: HumanPrimitiveCommand = {
        kind: "move",
        waypoints: [{ x: 124, y: 61 }],
        speedPixelsPerSecond: 30,
        gait,
      };
      once.apply(command, 0);
      partitioned.apply(command, 0);
      once.advance(0.8, 800);
      for (let step = 1; step <= 8; step += 1) partitioned.advance(0.1, step * 100);

      expect(visualSignature(partitioned.snapshot())).toEqual(visualSignature(once.snapshot()));
      const stride = PRODUCTION_ASSET_MANIFEST.human.rigs[once.snapshot().appearance.rig]
        .bodyClips[`${gait}:east`].strideLength!;
      expect(once.snapshot().stridePhase).toBeCloseTo(once.snapshot().distanceTravelled / stride, 12);
    },
  );

  it("consumes a multi-segment route without overshoot and emits arrival once", () => {
    const { actor } = createActor({ position: { x: 0, y: 0 }, facing: "east" });
    const waypoints = [{ x: 8, y: 0 }, { x: 20, y: 0 }];
    actor.apply({ kind: "move", waypoints, speedPixelsPerSecond: 100, gait: "run" }, 0);
    const signals = actor.advance(1, 1_000);

    expect(actor.snapshot()).toMatchObject({
      position: { x: 20, y: 0 },
      distanceTravelled: 20,
      activeAction: "moving",
    });
    expect(signals.filter(({ kind }) => kind === "arrived")).toEqual([]);
    const arrivalSignals = actor.advance(0.01, 1_010);
    expect(actor.snapshot()).toMatchObject({ position: { x: 20, y: 0 }, activeAction: null });
    expect(arrivalSignals.filter(({ kind }) => kind === "arrived")).toEqual([
      { kind: "arrived", actorId: "agent_aster", position: { x: 20, y: 0 } },
    ]);
    expect(actor.advance(1, 2_010).filter(({ kind }) => kind === "arrived")).toEqual([]);
  });

  it.each([false, true])(
    "RED: keeps every displacement moving-to-moving across turns and arrival (reduced=%s)",
    (reducedMotion) => {
      const { actor } = createActor({
        position: { x: 0, y: 0 },
        facing: "north",
        reducedMotion,
      });
      const endpoint = { x: 16, y: 8 };
      actor.apply({
        kind: "move",
        waypoints: [{ x: 8, y: 0 }, { x: 8, y: 8 }, endpoint],
        speedPixelsPerSecond: 24,
        gait: "walk",
      }, 0);

      const arrivals = [];
      let reachedEndpointMoving = false;
      for (let step = 1; step <= 400; step += 1) {
        const before = actor.snapshot();
        const signals = actor.advance(1 / 30, step * 1_000 / 30);
        arrivals.push(...signals.filter(({ kind }) => kind === "arrived"));
        const after = actor.snapshot();
        const dx = after.position.x - before.position.x;
        const dy = after.position.y - before.position.y;
        const moved = Math.hypot(dx, dy) > 1e-9;

        if (moved) {
          expect([before.activeAction, after.activeAction], `step ${step}`).toEqual([
            "moving",
            "moving",
          ]);
          expect(after.facing, `step ${step} facing`).toBe(before.facing);
          if (Math.abs(dx) >= Math.abs(dy)) {
            expect(after.facing).toBe(dx > 0 ? "east" : "west");
          } else expect(after.facing).toBe(dy > 0 ? "south" : "north");
        }
        if (before.activeAction === "orienting" || after.activeAction === "orienting") {
          expect({ dx, dy }, `step ${step} orientation displacement`).toEqual({ dx: 0, dy: 0 });
        }
        if (after.position.x === endpoint.x && after.position.y === endpoint.y
          && after.activeAction === "moving") {
          reachedEndpointMoving = true;
        }
        if (arrivals.length > 0) {
          expect(before).toMatchObject({ position: endpoint, activeAction: "moving" });
          expect(after).toMatchObject({ position: endpoint, activeAction: null });
          break;
        }
      }

      expect(reachedEndpointMoving).toBe(true);
      expect(arrivals).toEqual([
        { kind: "arrived", actorId: "agent_aster", position: endpoint },
      ]);
      expect(actor.advance(1 / 30, 401_000 / 30).filter(({ kind }) => kind === "arrived")).toEqual([]);
    },
  );

  it("keeps every advertised idle deadline strictly future", () => {
    const { actor } = createActor();
    let nowMs = 0;
    for (let wake = 0; wake < 40; wake += 1) {
      const deadline = actor.nextDeadlineMs();
      expect(deadline).not.toBeNull();
      expect(deadline!).toBeGreaterThan(nowMs);
      nowMs = deadline!;
      actor.advance(0, nowMs);
    }
  });

  it("keeps paralyzed motion prone and in-place, then makes death still and deadline-free", () => {
    const { actor } = createActor({ position: { x: 12.5, y: 19.25 } });
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    const position = actor.snapshot().position;
    actor.advance(0.42, 420);
    expect(actor.snapshot().position).toEqual(position);
    expect(actor.snapshot().layers.body.clipId).toContain(":prone:");
    expect(actor.nextDeadlineMs()).toBeGreaterThan(420);

    actor.apply({ kind: "set-status", status: "dead" }, 420);
    const dead = actor.snapshot();
    expect(dead.terminal).toBe(true);
    expect(actor.nextDeadlineMs()).toBeNull();
    expect(actor.advance(100, 100_420)).toEqual([]);
    expect(actor.snapshot()).toEqual(dead);
  });

  it.each([
    {
      label: "move",
      command: {
        kind: "move",
        waypoints: [{ x: 200, y: 20 }],
        speedPixelsPerSecond: 200,
        gait: "run",
      } as const,
    },
    { label: "orient", command: { kind: "orient", facing: "north" } as const },
    { label: "play-body", command: { kind: "play-body", action: "work" } as const },
  ])("guards paralysis from $label until explicit recovery", ({ command }) => {
    const { actor } = createActor({ position: { x: 10, y: 20 }, facing: "east" });
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    const prone = actor.snapshot();

    actor.apply(command, 1);
    actor.advance(2, 2_001);

    expect(actor.snapshot()).toMatchObject({
      position: prone.position,
      facing: prone.facing,
      layers: { body: { clipId: expect.stringContaining(":prone:") } },
    });
  });

  it("allows travel only after explicit recovery from paralysis", () => {
    const { actor } = createActor({ position: { x: 10, y: 20 }, facing: "east" });
    actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
    actor.apply({ kind: "set-status", status: "alive" }, 1);
    actor.apply({
      kind: "move",
      waypoints: [{ x: 30, y: 20 }],
      speedPixelsPerSecond: 20,
      gait: "walk",
    }, 1);
    actor.advance(1, 1_001);
    expect(actor.snapshot().position).toEqual({ x: 30, y: 20 });
  });

  it("cannot revive, move, orient, or animate after a terminal command race", () => {
    const { actor } = createActor();
    actor.apply({ kind: "set-status", status: "dead" }, 0);
    const dead = actor.snapshot();
    actor.apply({ kind: "set-status", status: "alive" }, 1);
    actor.apply({ kind: "move", waypoints: [{ x: 999, y: 999 }], speedPixelsPerSecond: 999, gait: "run" }, 1);
    actor.apply({ kind: "orient", facing: "south" }, 1);
    actor.apply({ kind: "set-face", expression: "talk-2" }, 1);
    actor.advance(100, 100_001);
    expect(actor.snapshot()).toEqual(dead);
  });

  it("RED: draws no full-body fallback when optional face and hair channels are missing", () => {
    const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
    delete (manifest.human.rigs["human-a"].facePlanes.east as Partial<Record<string, unknown>>).neutral;
    const leases = new Map(createLeases(manifest));
    leases.delete(manifest.human.layerAtlases.hair);
    const { actor } = createActor({ manifest, atlasLeases: leases });
    const snapshot = actor.snapshot();

    expect(snapshot.layers.face).toMatchObject({ facing: "east", fallback: false });
    expect(snapshot.layers.hair).toMatchObject({ facing: "east", fallback: false });
    expect(snapshot.layers.face.clipId).not.toContain("silhouette");
    expect(snapshot.layers.hair.clipId).not.toContain("silhouette");
    actor.apply({ kind: "play-body", action: "work" }, 0);
    const calls: unknown[][] = [];
    actor.draw(drawingContext(calls));
    expect(calls.filter(([image]) => (image as { label: string }).label
      === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body)).toHaveLength(1);
  });

  it.each(["hair", "clothing", "held", "status"] as const)(
    "RED: draws nothing for optional %s when its atlas descriptor is absent",
    (layer) => {
      const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
      const appearance = deriveHumanAppearance("agent_aster", "quiet observer");
      const atlasId = layer === "clothing"
        ? manifest.human.clothingAtlasBySilhouette[appearance.clothingSilhouette]
        : manifest.human.layerAtlases[layer];
      delete (manifest.atlases as Partial<Record<string, unknown>>)[atlasId];
      const leases = createLeases(manifest);
      const { actor } = createActor({ manifest, atlasLeases: leases });

      expect(actor.snapshot().layers[layer]).toMatchObject({ facing: "east", fallback: false });
      expect(actor.snapshot().layers[layer].clipId).not.toContain("silhouette");
      actor.apply({ kind: "play-body", action: "work" }, 0);
      const calls: unknown[][] = [];
      expect(() => actor.draw(drawingContext(calls))).not.toThrow();
      expect(calls.filter(([image]) => (image as { label: string }).label
        === manifest.human.layerAtlases.body)).toHaveLength(1);
      expect(calls.some(([image]) => (image as { label: string }).label === atlasId)).toBe(false);
    },
  );

  it.each(["face", "hair", "clothing", "held", "status"] as const)(
    "RED: draws nothing for optional %s when its lease is absent",
    (layer) => {
      const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
      const appearance = deriveHumanAppearance("agent_aster", "quiet observer");
      const atlasId = layer === "clothing"
        ? manifest.human.clothingAtlasBySilhouette[appearance.clothingSilhouette]
        : manifest.human.layerAtlases[layer];
      const leases = new Map(createLeases(manifest));
      leases.delete(atlasId);
      const { actor } = createActor({ manifest, atlasLeases: leases });
      expect(actor.snapshot().layers[layer]).toMatchObject({ facing: "east", fallback: false });
      expect(actor.snapshot().layers[layer].clipId).not.toContain("silhouette");
      actor.apply({ kind: "play-body", action: "work" }, 0);
      const calls: unknown[][] = [];
      actor.draw(drawingContext(calls));
      expect(calls.filter(([image]) => (image as { label: string }).label
        === manifest.human.layerAtlases.body)).toHaveLength(1);
      expect(calls.some(([image]) => (image as { label: string }).label === atlasId)).toBe(false);
    },
  );

  it("preserves the same public identity with a stable person marker when required body art is absent", () => {
    const leases = new Map(createLeases());
    leases.delete(PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body);
    const { actor } = createActor({ atlasLeases: leases });
    const calls: unknown[][] = [];
    const context = drawingContext(calls);
    const fillRect = vi.spyOn(context, "fillRect");

    expect(actor.snapshot()).toMatchObject({
      id: "agent_aster",
      position: { x: 24, y: 61 },
      facing: "east",
      artFallback: "person-marker",
      layers: { body: { clipId: "person-marker:east", facing: "east", fallback: true } },
    });
    expect(() => actor.draw(context)).not.toThrow();
    expect(calls).toEqual([]);
    expect(fillRect.mock.calls.length).toBeGreaterThanOrEqual(3);

    actor.apply({ kind: "move", waypoints: [{ x: 40, y: 61 }], speedPixelsPerSecond: 16, gait: "walk" }, 0);
    actor.advance(1, 1_000);
    expect(actor.snapshot()).toMatchObject({
      id: "agent_aster",
      position: { x: 40, y: 61 },
      artFallback: "person-marker",
    });
  });

  it("captures an immutable manifest view instead of observing later caller mutation", () => {
    const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
    const { actor } = createActor({ manifest, atlasLeases: createLeases(manifest) });
    const before = actor.snapshot();
    const rig = before.appearance.rig;
    const body = manifest.human.rigs[rig].bodyClips["idle:east"].frames[0]!;

    delete (manifest.human.rigs[rig].facePlanes.east as Partial<Record<string, unknown>>).neutral;
    (body.rect as { x: number }).x += 48;
    (body.faceAnchor as { x: number }).x += 7;
    delete (manifest.atlases as Partial<Record<string, unknown>>)[manifest.human.layerAtlases.hair];

    expect(actor.snapshot()).toEqual(before);
    expect(() => actor.draw(drawingContext([]))).not.toThrow();
  });

  it("uses the exact authored held-form columns without hashes or collisions", () => {
    const heldForms = [
      "none", "basket", "wood-bundle", "stone-bundle", "material-crate", "energy-gift",
      "proposal-token", "hammer", "hearth-fuel", "vault-deposit", "vault-withdraw",
      "raid-tool", "loot-crate", "ruin-debris", "resource-handful", "reserve",
    ];
    const heldAtlas = PRODUCTION_ASSET_MANIFEST.human.layerAtlases.held;
    for (const [index, heldId] of heldForms.entries()) {
      const { actor } = createActor({ facing: "east" });
      actor.apply({ kind: "set-held", heldId: heldId === "none" ? null : heldId }, 0);
      const calls = atlasCalls(actor, heldAtlas);
      expect(calls, heldId).toHaveLength(heldId === "none" ? 0 : 1);
      if (heldId !== "none") {
        expect(calls[0]!.slice(1, 5), heldId).toEqual([index * 48, 64, 48, 64]);
      }
    }
  });

  it("draws exactly the four required human layers while idle and at most one real held layer", () => {
    const { actor } = createActor();
    const idleCalls: unknown[][] = [];
    actor.draw(drawingContext(idleCalls));
    expect(idleCalls.map(([image]) => (image as { label: string }).label)).toEqual([
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body,
      PRODUCTION_ASSET_MANIFEST.human.clothingAtlasBySilhouette[actor.snapshot().appearance.clothingSilhouette],
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.face,
      PRODUCTION_ASSET_MANIFEST.human.layerAtlases.hair,
    ]);

    actor.apply({ kind: "set-held", heldId: "basket" }, 0);
    const heldCalls: unknown[][] = [];
    actor.draw(drawingContext(heldCalls));
    expect(heldCalls).toHaveLength(5);
    expect(heldCalls.filter(([image]) => (
      (image as { label: string }).label === PRODUCTION_ASSET_MANIFEST.human.layerAtlases.held
    ))).toHaveLength(1);
  });

  it("does not second-shift profile face or hair planes in the production compositor", () => {
    for (const rig of ["human-a", "human-b"] as const) {
      for (const facing of ["south", "east", "north", "west"] as const) {
        const { actor } = createActor({ id: agentIdForRig(rig), facing });
        expect(actor.snapshot().appearance.rig).toBe(rig);
        const calls: unknown[][] = [];
        actor.draw(drawingContext(calls));
        const byAtlas = (atlasId: string): unknown[][] => calls.filter(([image]) => (
          (image as { label: string }).label === atlasId
        ));
        const bodyDestination = byAtlas(PRODUCTION_ASSET_MANIFEST.human.layerAtlases.body)[0]!.slice(5, 7);
        expect(
          byAtlas(PRODUCTION_ASSET_MANIFEST.human.layerAtlases.face)[0]!.slice(5, 7),
          `${rig}/${facing}/face`,
        ).toEqual(bodyDestination);
        expect(
          byAtlas(PRODUCTION_ASSET_MANIFEST.human.layerAtlases.hair)[0]!.slice(5, 7),
          `${rig}/${facing}/hair`,
        ).toEqual(bodyDestination);
      }
    }
  });

  it("draws no status cue for alive unselected and uses explicit named status frames", () => {
    const statusAtlas = PRODUCTION_ASSET_MANIFEST.human.layerAtlases.status;
    const alive = createActor().actor;
    expect(atlasCalls(alive, statusAtlas)).toEqual([]);

    const selected = createActor().actor;
    selected.apply({ kind: "set-selected", selected: true }, 0);
    expect(atlasCalls(selected, statusAtlas)[0]!.slice(1, 5)).toEqual([0, 0, 32, 32]);

    const paralyzed = createActor().actor;
    paralyzed.apply({ kind: "set-status", status: "paralyzed" }, 0);
    expect(atlasCalls(paralyzed, statusAtlas)[0]!.slice(1, 5)).toEqual([32, 0, 32, 32]);

    const dead = createActor().actor;
    dead.apply({ kind: "set-status", status: "dead" }, 0);
    expect(atlasCalls(dead, statusAtlas)[0]!.slice(1, 5)).toEqual([64, 0, 32, 32]);
  });

  it("maps standing idle hair only to alternating rest phases", () => {
    const idle = createActor().actor;
    expect(idle.snapshot().layers.hair.frameIndex).toBe(0);
    idle.advance(0, 250);
    expect(idle.snapshot().layers.hair.frameIndex).toBe(1);
    idle.advance(0, 500);
    expect(idle.snapshot().layers.hair.frameIndex).toBe(0);
  });

  it("maps walk and run hair only to travel phases", () => {
    for (const gait of ["walk", "run"] as const) {
      const travelling = createActor().actor;
      travelling.apply({
        kind: "move",
        waypoints: [{ x: 200, y: 61 }],
        speedPixelsPerSecond: 30,
        gait,
      }, 0);
      travelling.advance(0.2, 200);
      expect([2, 3]).toContain(travelling.snapshot().layers.hair.frameIndex);
    }
  });

  it("maps work and reach hair to the action phase", () => {
    for (const action of ["work", "reach-give"] as const) {
      const acting = createActor().actor;
      acting.apply({ kind: "play-body", action }, 0);
      expect(acting.snapshot().layers.hair.frameIndex).toBe(4);
    }
  });

  it("maps hurt, prone, and dead hair to the grounded phase", () => {
    for (const status of ["paralyzed", "dead"] as const) {
      const grounded = createActor().actor;
      grounded.apply({ kind: "set-status", status }, 0);
      expect(grounded.snapshot().layers.hair.frameIndex).toBe(5);
    }
    const hurt = createActor().actor;
    hurt.apply({ kind: "play-body", action: "hurt-fall" }, 0);
    expect(hurt.snapshot().layers.hair.frameIndex).toBe(5);
  });

  it.each([
    ["idle", 0],
    ["work", 3],
    ["reach-give", 3],
    ["hurt-fall", 0],
    ["hurt-fall", 2],
    ["hurt-fall", 4],
    ["hurt-fall", 5],
    ["prone", 1],
    ["dead", 0],
  ] as const)(
    "places face, hair, and held overlays from the measured %s phase %i body anchors",
    (action, phase) => {
      const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
      const clip = manifest.human.rigs["human-a"].bodyClips[`${action}:east`];
      const frame = clip.frames[phase]!;
      const measured = {
        feet: { x: 22 + phase % 3, y: 61 },
        faceAnchor: { x: 17 + phase, y: 15 + phase * 2 },
        heldAnchor: { x: 31 + phase, y: 34 + phase * 2 },
      };
      Object.assign(frame, measured);
      const { actor } = createActor({ manifest, atlasLeases: createLeases(manifest) });
      actor.apply({ kind: "set-held", heldId: "basket" }, 0);
      if (action === "prone") actor.apply({ kind: "set-status", status: "paralyzed" }, 0);
      else if (action === "dead") actor.apply({ kind: "set-status", status: "dead" }, 0);
      else if (action !== "idle") actor.apply({ kind: "play-body", action }, 0);
      if (phase > 0 && action !== "dead") {
        const elapsedMs = clip.frames.slice(0, phase).reduce((sum, item) => sum + item.durationMs, 0) + 1;
        actor.advance(elapsedMs / 1_000, elapsedMs);
      }

      const calls: unknown[][] = [];
      actor.draw(drawingContext(calls));
      const byAtlas = (atlasId: string) => calls.filter(([image]) => (
        (image as { label: string }).label === atlasId
      ));
      const bodyLeft = 24 - measured.feet.x;
      const bodyTop = 61 - measured.feet.y;
      const expectedFace = [
        bodyLeft + measured.faceAnchor.x - 26,
        bodyTop + measured.faceAnchor.y - 19,
      ];
      const expectedHeld = [
        bodyLeft + measured.heldAnchor.x - 34,
        bodyTop + measured.heldAnchor.y - 38,
      ];
      const faceCalls = byAtlas(manifest.human.layerAtlases.face);
      const hairCalls = byAtlas(manifest.human.layerAtlases.hair);
      const heldCalls = byAtlas(manifest.human.layerAtlases.held);
      expect(faceCalls.length).toBeGreaterThan(0);
      expect(hairCalls.length).toBeGreaterThan(0);
      const keepsRealHeldForm = action !== "prone" && action !== "dead";
      expect(heldCalls.length).toBe(keepsRealHeldForm ? 1 : 0);
      for (const call of [...faceCalls, ...hairCalls]) expect(call.slice(5, 7)).toEqual(expectedFace);
      for (const call of heldCalls) {
        expect(call.slice(5, 7)).toEqual(expectedHeld);
      }
    },
  );

  it("draws integer native rectangles with smoothing disabled", () => {
    const { actor } = createActor({ position: { x: 24.4, y: 61.6 } });
    const calls: unknown[][] = [];
    const context = drawingContext(calls);
    actor.draw(context);

    expect(context.imageSmoothingEnabled).toBe(false);
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.slice(1).every(Number.isInteger)).toBe(true);
    }
  });

  it("detaches caller inputs, routes, lease maps, and immutable snapshots", () => {
    const position = { x: 0, y: 0 };
    const waypoint = { x: 10, y: 0 };
    const map = new Map(createLeases());
    const { actor } = createActor({ position, atlasLeases: map });
    position.x = 100;
    actor.apply({ kind: "move", waypoints: [waypoint], speedPixelsPerSecond: 10, gait: "walk" }, 0);
    waypoint.x = 1_000;
    map.clear();
    actor.advance(1, 1_000);

    const snapshot = actor.snapshot();
    expect(snapshot.position).toEqual({ x: 10, y: 0 });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.layers)).toBe(true);
    expect(() => {
      (snapshot.position as { x: number }).x = 999;
    }).toThrow();
    expect(actor.snapshot().position).toEqual({ x: 10, y: 0 });
    const calls: unknown[][] = [];
    actor.draw(drawingContext(calls));
    expect(calls).toHaveLength(4);
  });

  it("releases every unique lease exactly once and makes all post-dispose calls inert", () => {
    const { actor, leases } = createActor();
    actor.apply({ kind: "set-face", expression: "talk-1" }, 0);
    actor.dispose();
    actor.dispose();
    for (const lease of leases.values()) expect(lease.release).toHaveBeenCalledTimes(1);

    const disposed = actor.snapshot();
    expect(() => actor.apply({ kind: "set-status", status: "alive" }, 1)).not.toThrow();
    expect(actor.advance(100, 100_000)).toEqual([]);
    expect(actor.nextDeadlineMs()).toBeNull();
    const calls: unknown[][] = [];
    actor.draw(drawingContext(calls));
    expect(calls).toEqual([]);
    expect(actor.snapshot()).toEqual(disposed);
  });

  it("removes optional idle drift under reduced motion while retaining selection status", () => {
    const { actor } = createActor({ reducedMotion: true });
    actor.apply({ kind: "set-selected", selected: true }, 0);
    const still = actor.snapshot();
    actor.advance(100, 100_000);
    expect(actor.snapshot()).toEqual(still);
    expect(actor.snapshot().layers.status.clipId).toContain("selected");
    expect(actor.nextDeadlineMs()).toBeNull();
  });
});
