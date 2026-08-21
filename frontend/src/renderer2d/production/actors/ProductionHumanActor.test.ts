import { describe, expect, it, vi, type Mock } from "vitest";

import type { Vec2 } from "../../contracts";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "../assets/productionManifest";
import type {
  ProductionActorFactoryInput,
  ProductionSceneFactories,
} from "../ProductionSceneGraph";
import {
  LayeredHumanActor,
  type HumanPrimitiveCommand,
  type LayeredHumanLayerSnapshot,
  type ProductionActorSignal,
} from "./LayeredHumanActor";
import type { ProductionHumanActor, ProductionHumanActorSnapshot } from "./ProductionHumanActor";

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

function drawingContext(): CanvasRenderingContext2D {
  return {
    imageSmoothingEnabled: true,
    filter: "none",
    globalCompositeOperation: "source-over",
    globalAlpha: 1,
    fillStyle: "#000000",
    strokeStyle: "#000000",
    save: () => undefined,
    restore: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    strokeRect: () => undefined,
  } as unknown as CanvasRenderingContext2D;
}

const FAKE_LAYER_SNAPSHOT: LayeredHumanLayerSnapshot = Object.freeze({
  clipId: "fake",
  frameIndex: 0,
  facing: "south",
  fallback: true,
});

function fakeSnapshot(id: string): ProductionHumanActorSnapshot {
  return {
    id,
    instanceId: 0,
    position: { x: 0, y: 0 },
    facing: "south",
    appearance: {
      rig: "human-a",
      skinRamp: "warm",
      hairSilhouette: "crop",
      hairRamp: "espresso",
      clothingSilhouette: "work-shirt-sash",
      clothingPalette: "olive",
      secondaryAccent: null,
    },
    distanceTravelled: 0,
    stridePhase: 0,
    terminal: false,
    routeActive: false,
    opacity: 1,
    reposition: null,
    activeAction: null,
    artFallback: null,
    layers: {
      body: FAKE_LAYER_SNAPSHOT,
      clothing: FAKE_LAYER_SNAPSHOT,
      face: FAKE_LAYER_SNAPSHOT,
      hair: FAKE_LAYER_SNAPSHOT,
      held: FAKE_LAYER_SNAPSHOT,
      status: FAKE_LAYER_SNAPSHOT,
    },
  };
}

/** Minimal hand-rolled actor proving the interface is implementable without `LayeredHumanActor`. */
class FakeProductionHumanActor implements ProductionHumanActor {
  readonly appliedCommands: HumanPrimitiveCommand[] = [];
  disposeCalls = 0;

  apply(command: HumanPrimitiveCommand, _nowMs: number): void {
    this.appliedCommands.push(command);
  }

  stagePosition(_position: Vec2): (() => void) | null {
    return () => undefined;
  }

  stageCommands(commands: readonly HumanPrimitiveCommand[], nowMs: number): () => void {
    for (const command of commands) this.apply(command, nowMs);
    return () => undefined;
  }

  advance(_deltaSeconds: number, _nowMs: number): readonly ProductionActorSignal[] {
    return [];
  }

  draw(_context: CanvasRenderingContext2D): void {}

  snapshot(): ProductionHumanActorSnapshot {
    return fakeSnapshot("fake_actor");
  }

  nextDeadlineMs(): number | null {
    return null;
  }

  cancelFallbackReposition(): void {}

  beginPresenceVanish(): void {}

  beginPresenceReveal(): void {}

  dispose(): void {
    this.disposeCalls += 1;
  }
}

function fakeFactoryInput(): ProductionActorFactoryInput {
  return {
    record: { completeness: "exact", value: { id: "agent_fake", name: "Fake" } },
    position: { x: 4, y: 8 },
    facing: "south",
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: new Map(),
    reducedMotion: false,
  };
}

describe("ProductionHumanActor", () => {
  it("LayeredHumanActor is assignable to ProductionHumanActor", () => {
    const manifest = PRODUCTION_ASSET_MANIFEST;
    const leases = createLeases(manifest);
    const actor = new LayeredHumanActor({
      id: "agent_check",
      name: "Check",
      position: { x: 24, y: 61 },
      facing: "south",
      manifest,
      atlasLeases: leases,
    });

    // Compile-time assignability: LayeredHumanActor must satisfy every member
    // of ProductionHumanActor with no widening or casts.
    const check: ProductionHumanActor = actor;

    expect(check.snapshot().id).toBe("agent_check");
    expect(check.nextDeadlineMs()).not.toBeNull();
    expect(() => check.draw(drawingContext())).not.toThrow();
    const rollback = check.stagePosition({ x: 40, y: 40 });
    expect(rollback).not.toBeNull();
    rollback?.();
    expect(check.snapshot().position).toEqual({ x: 24, y: 61 });
    const commandRollback = check.stageCommands(
      [{ kind: "set-selected", selected: true }],
      0,
    );
    expect(check.snapshot()).toBeDefined();
    commandRollback();
    expect(check.snapshot().layers.body.facing).toBe("south");
    expect(check.advance(0, 0)).toEqual([]);
    expect(() => check.cancelFallbackReposition()).not.toThrow();
    expect(() => check.dispose()).not.toThrow();
  });

  it("accepts a minimal fake actor as ProductionSceneFactories' createActor return", () => {
    const fake = new FakeProductionHumanActor();

    // Compile-time acceptance: the fake's own type is exactly
    // ProductionSceneFactories["createActor"]'s declared return type.
    const createActor: ProductionSceneFactories["createActor"] = (
      _input: ProductionActorFactoryInput,
    ): ProductionHumanActor => fake;

    const created = createActor(fakeFactoryInput());
    expect(created).toBe(fake);
    expect(created.snapshot().id).toBe("fake_actor");
    created.apply({ kind: "recover" }, 0);
    expect(fake.appliedCommands).toHaveLength(1);
    created.dispose();
    expect(fake.disposeCalls).toBe(1);
  });
});
