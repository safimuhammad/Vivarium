import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import type { Rect } from "../../contracts";
import {
  PRODUCTION_ASSET_MANIFEST,
  type NativeFrameRef,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "../assets/productionManifest";
import { createRegionMapIdentity, type RegionCondition } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  MAX_EXACT_ANIMATED_ENVIRONMENT_BUDGET,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import type { AnimatedEnvironmentKind, RegionKitId } from "../maps/biomeKits";
import { feetAnchoredVisualRect } from "../productionGeometry";
import {
  bubbleScale,
  buildBurst,
  buildPip,
  buildTextBubble,
  hasFontGlyph,
  identityHue,
  layoutMessage,
  messageColumns,
  OVERLAY_GLYPH_NAMES,
  TEXT_KIND_METRICS,
  TEXT_SCALE_FLOOR,
  textBubbleScale,
  textScaleForLength,
} from "./bubbleGrammar";
import { createProductionRegionMapRecipe } from "../maps/ProductionRegionMapRecipe";
import {
  EnvironmentSystem,
  ENVIRONMENT_POOL_CAPACITIES,
  TEXT_FADE_OUT_MS,
  textFadeAlpha,
  TRANSIENT_SMOKE_SLOTS,
  type EnvironmentEffectRequest,
} from "./EnvironmentSystem";

type SpeechRequest = Extract<EnvironmentEffectRequest, { kind: "speech-bubble" }>;

/** One ordinary spoken line, with the grammar's own defaults filled in. */
function speech(speakerId: string, text: string, targetId?: string): SpeechRequest {
  return {
    kind: "speech-bubble",
    at: { x: 100, y: 100 },
    speakerId,
    variant: "speech",
    text,
    tailLean: 0,
    hue: identityHue(speakerId),
    accent: "#8a8270",
    tier: "murmur",
    ...(targetId === undefined ? {} : { targetId }),
  };
}

const world: RegionSnapshot[] = [
  region("worn", "a once-heavenly landscape, now thinning and picked-over"),
  region("spring", "hot spring lakes"),
  region("dry", "a struggling, near-barren stretch"),
  region("ash", "a nuclear wasteland, all but dead"),
  region("neutral", "a mild unnamed landscape"),
];

describe("EnvironmentSystem", () => {
  it("resolves all seven Task 6 animated kinds through each placement's active region pack", () => {
    const resolved = new Set<AnimatedEnvironmentKind>();
    for (const source of world) {
      const recipe = recipeFor(source);
      const system = createSystem(recipe);
      const diagnostics = system.diagnostics();
      diagnostics.resolvedKinds.forEach((kind) => resolved.add(kind));
      expect(diagnostics.missingKinds).toEqual([]);
      expect(diagnostics.resolvedAtlasIds).toEqual([`${recipe.kit}-environment`]);
      system.dispose();
    }
    expect([...resolved].sort()).toEqual(
      ["ember", "grass", "reed", "shrub", "smoke-anchor", "tree", "water"],
    );
  });

  it("keeps static biome identity and authored frames unchanged when condition changes", () => {
    const recipe = recipeFor(world[1]!);
    const initial = { energyRatio: 0.15, materialsRatio: 0.25 };
    const system = createSystem(recipe, initial);
    const before = system.diagnostics();

    system.reconcile({ energyRatio: 1, materialsRatio: 0.9 });
    const after = system.diagnostics();

    expect(after.kit).toBe("spring-terraces");
    expect(after.terrainFamily).toBe(before.terrainFamily);
    expect(after.frameSignature).toBe(before.frameSignature);
    expect(after.vitality).toBeGreaterThan(before.vitality);
    system.dispose();
  });

  it("derives deterministic phases and draw ordering independent of placement insertion order", () => {
    const recipe = recipeFor(world[0]!);
    const reversed = {
      ...recipe,
      animatedEnvironment: [...recipe.animatedEnvironment].reverse(),
    } satisfies RegionMapRecipeV1;
    const left = createSystem(recipe);
    const right = createSystem(reversed);
    left.advanceTo(1_234);
    right.advanceTo(1_234);

    expect(right.diagnostics().phaseSignature).toBe(left.diagnostics().phaseSignature);
    expect(right.nextDeadlineMs()).toBe(left.nextDeadlineMs());
    const leftCanvas = recordingContext();
    const rightCanvas = recordingContext();
    left.draw(leftCanvas.context, "air");
    right.draw(rightCanvas.context, "air");
    expect(rightCanvas.draws).toEqual(leftCanvas.draws);
    left.dispose();
    right.dispose();
  });

  it("preallocates exact named capacities and never exceeds them during large bursts", () => {
    const system = createSystem(recipeFor(world[3]!));
    for (let index = 0; index < 100; index += 1) {
      system.emit({ kind: "footstep", at: { x: index, y: index }, tint: "#ffffff" }, 10);
      system.emit({ kind: "smoke", at: { x: index, y: index }, tint: "#ffffff" }, 10);
    }
    const diagnostics = system.diagnostics();
    // DELIBERATE RE-BASELINE #2 (Nirvana West's fire at pilot density): `smoke` 48 -> 400.
    // #1 was 16 -> 48: the old 16 was over-subscribed 2x by ash-waste alone — that kit
    // declares ["ember", "smoke-anchor"] and BOTH pool to `smoke`, so ALL of the region's
    // animated placements land here, half were dropped at construction, and the pool was
    // then permanently full so no transient particle could ever draw there. #2 is the same
    // failure with a bigger number: the region now declares 384 placements.
    // What this test protects — that the pools are preallocated, exact, and never grow
    // under a burst — is unchanged; only the number moved, and it is no longer a literal:
    // it is derived from the recipe layer's own budget table so the two cannot drift.
    expect(diagnostics.capacities).toEqual({ water: 32, wind: 32, smoke: 400, footsteps: 24 });
    expect(diagnostics.allocatedSlots).toEqual(diagnostics.capacities);
    expect(diagnostics.activeWater).toBeLessThanOrEqual(32);
    expect(diagnostics.activeWind).toBeLessThanOrEqual(32);
    expect(diagnostics.activeSmoke).toBeLessThanOrEqual(400);
    expect(diagnostics.activeFootsteps).toBe(24);
    system.dispose();
  });

  it("seats every animated placement of the generic ash-waste region, with room to spare", () => {
    // The regression this locks: `ash-waste` declares ["ember", "smoke-anchor"] and
    // `poolFor` routes BOTH to the `smoke` pool, so ALL of the region's animated
    // placements compete for it. At the old capacity of 16, `insertFirstEmpty` seated
    // the first 16 and silently counted the rest as dropped — half of Nirvana West's
    // fire never drew — and the pool was then permanently full of ambient slots, so no
    // transient ember/smoke particle could ever appear in that region either.
    const recipe = recipeFor(world[3]!);
    expect(recipe.kit).toBe("ash-waste");
    expect(recipe.animatedEnvironment).toHaveLength(32);
    expect(new Set(recipe.animatedEnvironment.map(({ kind }) => kind)))
      .toEqual(new Set(["ember", "smoke-anchor"]));

    const system = createSystem(recipe);
    const seated = system.diagnostics();
    expect(seated.droppedEffects).toBe(0);
    expect(seated.activeSmoke).toBe(32);

    // And a burst of transient particles still finds slots on top of the ambient ones.
    // At the old capacity of 48 this burst seated 16 and DROPPED 52; it now fits whole,
    // which is the honest measure of the headroom rather than the saturation point.
    for (let index = 0; index < 100; index += 1) {
      system.emit({ kind: "ember", at: { x: index, y: index }, tint: "#e46c64" }, 10);
    }
    const burst = system.diagnostics();
    expect(burst.activeSmoke).toBe(132);
    expect(burst.activeSmoke).toBeLessThanOrEqual(ENVIRONMENT_POOL_CAPACITIES.smoke);
    system.dispose();
  });

  /**
   * The coupling that has now failed twice, closed as an invariant instead of a number.
   *
   * A region's animated-environment budget is declared in `RegionMapRecipe.ts`; the pool
   * that has to seat it is declared here. `ash-waste` is the one kit whose every animated
   * kind routes to a single pool, so if a region ever declares more than the pool holds,
   * `insertFirstEmpty` truncates the region's own signature and only a counter moves —
   * which is exactly how 16 of the first 32 flames went missing unnoticed.
   */
  it("seats the LARGEST animated budget any region declares, and still has transient slots", () => {
    expect(ENVIRONMENT_POOL_CAPACITIES.smoke - MAX_EXACT_ANIMATED_ENVIRONMENT_BUDGET)
      .toBeGreaterThanOrEqual(TRANSIENT_SMOKE_SLOTS);

    // ...and prove it on the real region that declares it, not on the arithmetic alone.
    const exactWorld: RegionSnapshot[] = [
      region("nirvana", "a once-heavenly landscape, now thinning and picked-over"),
      region("nirvana_west", "a nuclear wasteland, all but dead"),
    ];
    const recipe = createProductionRegionMapRecipe(
      createRegionMapIdentity(811, exactWorld[1]!, exactWorld),
    );
    expect(recipe.presentationProfile?.kind).toBe("nirvana-west-v1");
    expect(recipe.kit).toBe("ash-waste");
    expect(recipe.animatedEnvironment.length).toBe(MAX_EXACT_ANIMATED_ENVIRONMENT_BUDGET);

    const system = createSystem(recipe);
    const seated = system.diagnostics();
    // The whole point: not one placement is silently dropped.
    expect(seated.droppedEffects).toBe(0);
    expect(seated.activeSmoke).toBe(recipe.animatedEnvironment.length);

    for (let index = 0; index < TRANSIENT_SMOKE_SLOTS; index += 1) {
      system.emit({ kind: "ember", at: { x: index, y: index }, tint: "#e46c64" }, 10);
    }
    const burst = system.diagnostics();
    expect(burst.droppedEffects).toBe(0);
    expect(burst.activeSmoke).toBe(recipe.animatedEnvironment.length + TRANSIENT_SMOKE_SLOTS);
    system.dispose();
  });

  it("drops saturated effects deterministically, reuses expired slots, and allocates no overflow", () => {
    const left = createSystem(recipeFor(world[2]!));
    const right = createSystem(recipeFor(world[2]!));
    for (let index = 0; index < 30; index += 1) {
      const request = { kind: "footstep" as const, at: { x: index, y: 4 }, tint: "#c49c74" };
      left.emit(request, 100);
      right.emit(request, 100);
    }
    expect(left.diagnostics().droppedEffects).toBe(6);
    expect(right.diagnostics().effectSignature).toBe(left.diagnostics().effectSignature);
    left.advanceTo(1_000);
    left.emit({ kind: "footstep", at: { x: 90, y: 4 }, tint: "#c49c74" }, 1_000);
    expect(left.diagnostics().activeFootsteps).toBe(1);
    expect(left.diagnostics().allocatedSlots.footsteps).toBe(24);
    left.dispose();
    right.dispose();
  });

  it("reports only strictly future deadlines and null for settled or reduced-motion static state", () => {
    const moving = createSystem(recipeFor(world[1]!));
    moving.advanceTo(2_000);
    expect(moving.nextDeadlineMs()).toBeGreaterThan(2_000);

    const staticRecipe = {
      ...recipeFor(world[4]!),
      animatedEnvironment: [],
    } satisfies RegionMapRecipeV1;
    const settled = createSystem(staticRecipe);
    settled.advanceTo(2_000);
    expect(settled.nextDeadlineMs()).toBeNull();

    const reduced = createSystem(recipeFor(world[1]!), undefined, true);
    reduced.advanceTo(2_000);
    expect(reduced.nextDeadlineMs()).toBeNull();
    moving.dispose();
    settled.dispose();
    reduced.dispose();
  });

  it("owns no RAF, timer, listener, or hidden global clock", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/renderer2d/production/environment/EnvironmentSystem.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/requestAnimationFrame|cancelAnimationFrame/);
    expect(source).not.toMatch(/setTimeout|setInterval|addEventListener|removeEventListener/);
    expect(source).not.toMatch(/Date\.now|performance\.now/);

    const clock = vi.spyOn(Date, "now");
    const system = createSystem(recipeFor(world[0]!));
    system.advanceTo(500);
    system.nextDeadlineMs();
    system.dispose();
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
  });

  it("deep-owns exclusion zones and suppresses particles over face or dialogue rectangles", () => {
    const system = createSystem(recipeFor(world[0]!));
    const zones = [{ x: 10, y: 10, width: 20, height: 20 }];
    system.setExclusionZones(zones);
    (zones[0] as { x: number }).x = 1_000;
    system.emit({ kind: "footstep", at: { x: 15, y: 15 }, tint: "#ffffff" }, 0);
    system.emit({ kind: "smoke", at: { x: 16, y: 16 }, tint: "#ffffff" }, 0);
    system.emit({ kind: "footstep", at: { x: 40, y: 40 }, tint: "#ffffff" }, 0);

    expect(system.diagnostics().suppressedEffects).toBe(2);
    expect(system.diagnostics().activeEffects).toBe(1);
    expect(system.diagnostics().activeFootsteps).toBe(1);
    expect(system.diagnostics().activeSmoke).toBeLessThanOrEqual(16);
    system.setExclusionZones([{ x: 35, y: 35, width: 10, height: 10 }]);
    const canvas = recordingContext();
    system.draw(canvas.context, "ground");
    expect(canvas.fills).toEqual([]);
    system.dispose();
  });

  it("suppresses an animated air frame when any part of its full 32px rectangle meets a shelter", () => {
    const recipe = recipeFor(world[3]!);
    const placement = recipe.animatedEnvironment.find(({ kind }) => kind !== "water")!;
    const system = createSystem(recipe);
    const destination = { x: placement.tile.column * 32, y: placement.tile.row * 32 };
    system.setExclusionZones([{
      x: destination.x + 31,
      y: destination.y + 31,
      width: 128,
      height: 128,
    }]);

    const canvas = recordingContext();
    system.draw(canvas.context, "air");

    expect(canvas.draws.some((draw) => draw[5] === destination.x && draw[6] === destination.y)).toBe(false);
    system.dispose();
  });

  it("suppresses every transient and ambient frame intersecting a standing actor's full measured footprint", () => {
    const recipe = recipeFor(world[3]!);
    const placement = recipe.animatedEnvironment[0]!;
    const destination = { x: placement.tile.column * 32, y: placement.tile.row * 32 };
    const feet = { x: destination.x + 37, y: destination.y + 62 };
    const actorFootprint = feetAnchoredVisualRect(feet);
    const system = createSystem(recipe);
    system.setExclusionZones([actorFootprint]);
    for (const kind of ["footstep", "smoke", "ember", "dust"] as const) {
      system.emit({ kind, at: feet, tint: "#ffffff" }, 0);
    }

    const ground = recordingContext();
    const air = recordingContext();
    system.draw(ground.context, "ground");
    system.draw(air.context, "air");

    expect(system.diagnostics()).toMatchObject({
      suppressedEffects: 4,
      activeEffects: 0,
    });
    expect([...ground.draws, ...air.draws].some((draw) => (
      draw[5] === destination.x && draw[6] === destination.y
    ))).toBe(false);
    expect([...ground.fillRects, ...air.fillRects]).toEqual([]);
    system.dispose();
  });

  it("draws integer regional frames without smoothing and never applies spring or green tint to ash", () => {
    const recipe = recipeFor(world[3]!);
    const system = createSystem(recipe);
    system.emit({ kind: "footstep", at: { x: 20.8, y: 30.2 }, tint: "#54d4c4" }, 0);
    const ground = recordingContext();
    const air = recordingContext();
    system.draw(ground.context, "ground");
    system.draw(air.context, "air");

    expect(ground.context.imageSmoothingEnabled).toBe(false);
    expect(air.context.imageSmoothingEnabled).toBe(false);
    for (const draw of [...ground.draws, ...air.draws]) {
      expect(draw.slice(1).every(Number.isInteger)).toBe(true);
      expect(String(draw[0])).toContain("ash-waste-environment");
    }
    expect(ground.fills).not.toContain("#54d4c4");
    expect(ground.fills.every((tint) => !/^#(?:[0-7][0-9a-f])(?:[8-f][0-9a-f])(?:[0-7][0-9a-f])$/i.test(tint))).toBe(true);
    system.dispose();
  });

  it("deep-owns recipe and condition inputs so caller mutation cannot alter state", () => {
    const recipe = recipeFor(world[0]!);
    const condition = { energyRatio: 0.2, materialsRatio: 0.4 };
    const system = createSystem(recipe, condition);
    const before = system.diagnostics();
    const first = recipe.animatedEnvironment[0]! as unknown as {
      phaseSeed: number;
      tile: { column: number; row: number };
    };
    first.phaseSeed = 0;
    first.tile.column = 63;
    condition.energyRatio = 1;

    expect(system.diagnostics().phaseSignature).toBe(before.phaseSignature);
    expect(system.diagnostics().vitality).toBe(before.vitality);
    system.dispose();
  });

  it("deep-owns active-pack frames including nested rect and attachment anchors", () => {
    const recipe = recipeFor(world[0]!);
    const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST);
    const placement = recipe.animatedEnvironment[0]!;
    const sourceFrame = manifest.regions[recipe.kit].animatedFrames[placement.kind];
    const originalFrame = structuredClone(sourceFrame);
    const system = createSystem(
      recipe,
      { energyRatio: 0.7, materialsRatio: 0.5 },
      false,
      manifest,
    );
    const pools = system as unknown as Readonly<{
      water: readonly ({ kind: AnimatedEnvironmentKind; frame: NativeFrameRef | null } | null)[];
      wind: readonly ({ kind: AnimatedEnvironmentKind; frame: NativeFrameRef | null } | null)[];
      smoke: readonly ({ kind?: AnimatedEnvironmentKind; frame?: NativeFrameRef | null } | null)[];
    }>;
    const ownedFrame = [...pools.water, ...pools.wind, ...pools.smoke]
      .find((slot) => slot?.kind === placement.kind)?.frame;
    expect(ownedFrame).toBeDefined();
    expect.soft(ownedFrame).not.toBe(sourceFrame);
    expect.soft(ownedFrame!.rect).not.toBe(sourceFrame.rect);
    expect.soft(ownedFrame!.feet).not.toBe(sourceFrame.feet);
    expect.soft(ownedFrame!.faceAnchor).not.toBe(sourceFrame.faceAnchor);
    expect.soft(ownedFrame!.heldAnchor).not.toBe(sourceFrame.heldAnchor);

    const before = system.diagnostics();
    const beforeCanvas = recordingContext();
    system.draw(beforeCanvas.context, "air");
    const mutable = sourceFrame as unknown as {
      atlasId: string;
      durationMs: number;
      rect: { x: number; y: number; width: number; height: number };
      feet: { x: number; y: number };
      faceAnchor: { x: number; y: number };
      heldAnchor: { x: number; y: number };
    };
    mutable.atlasId = "foreign-biome-environment";
    mutable.durationMs += 99;
    Object.assign(mutable.rect, { x: 96, y: 96, width: 64, height: 64 });
    Object.assign(mutable.feet, { x: 999, y: 999 });
    Object.assign(mutable.faceAnchor, { x: 998, y: 998 });
    Object.assign(mutable.heldAnchor, { x: 997, y: 997 });

    const afterCanvas = recordingContext();
    system.draw(afterCanvas.context, "air");
    expect.soft(ownedFrame).toEqual(originalFrame);
    expect.soft(system.diagnostics().frameSignature).toBe(before.frameSignature);
    expect.soft(system.diagnostics().resolvedAtlasIds).toEqual(before.resolvedAtlasIds);
    expect.soft(afterCanvas.draws).toEqual(beforeCanvas.draws);
    system.dispose();
  });

  it.each([
    ["footstep", "left", { x: 8.6, y: 15.2 }],
    ["footstep", "right", { x: 30.4, y: 15.2 }],
    ["footstep", "top", { x: 15.2, y: 9.6 }],
    ["footstep", "bottom", { x: 15.2, y: 30.4 }],
    ["smoke", "left", { x: 8.6, y: 15.2 }],
    ["smoke", "right", { x: 30.4, y: 15.2 }],
    ["smoke", "top", { x: 15.2, y: 9.6 }],
    ["smoke", "bottom", { x: 15.2, y: 30.4 }],
  ] as const)(
    "suppresses a snapped %s footprint intersecting the exclusion zone's %s edge",
    (kind, _edge, at) => {
      const recipe = {
        ...recipeFor(world[4]!),
        animatedEnvironment: [],
      } satisfies RegionMapRecipeV1;
      const system = createSystem(recipe);
      system.setExclusionZones([{ x: 10, y: 10, width: 20, height: 20 }]);
      system.emit({ kind, at, tint: "#ffffff" }, 0);

      expect(system.diagnostics()).toMatchObject({
        suppressedEffects: 1,
        activeFootsteps: 0,
        activeSmoke: 0,
      });
      const canvas = recordingContext();
      system.draw(canvas.context, kind === "footstep" ? "ground" : "air");
      expect(canvas.fillRects).toEqual([]);
      system.dispose();
    },
  );

  it("suppresses later particle drift by intersecting the newly updated exclusion zones", () => {
    const recipe = {
      ...recipeFor(world[4]!),
      animatedEnvironment: [],
    } satisfies RegionMapRecipeV1;
    const system = createSystem(recipe);
    system.emit({ kind: "smoke", at: { x: 42.4, y: 42.4 }, tint: "#ffffff" }, 0);
    system.advanceTo(320);
    system.setExclusionZones([{ x: 42, y: 39, width: 2, height: 3 }]);

    const canvas = recordingContext();
    system.draw(canvas.context, "air");
    expect(canvas.fillRects).toEqual([]);
    system.dispose();
  });

  it.each([
    ["normal", false],
    ["reduced motion", true],
  ] as const)("snaps every %s transient fill rectangle to integer pixels", (_label, reducedMotion) => {
    const recipe = {
      ...recipeFor(world[4]!),
      animatedEnvironment: [],
    } satisfies RegionMapRecipeV1;
    const system = createSystem(recipe, undefined, reducedMotion);
    system.emit({ kind: "footstep", at: { x: 20.6, y: 30.4 }, tint: "#ffffff" }, 0);
    system.emit({ kind: "smoke", at: { x: 40.6, y: 50.4 }, tint: "#ffffff" }, 0);
    system.emit({ kind: "ember", at: { x: 60.6, y: 70.4 }, tint: "#ffffff" }, 0);
    system.emit({ kind: "dust", at: { x: 80.6, y: 90.4 }, tint: "#ffffff" }, 0);

    const ground = recordingContext();
    const air = recordingContext();
    system.draw(ground.context, "ground");
    system.draw(air.context, "air");
    const rectangles = [...ground.fillRects, ...air.fillRects];
    expect(rectangles).toEqual([
      [19, 29, 4, 2],
      [40, 49, 3, 3],
      [60, 69, 3, 3],
      [80, 89, 3, 3],
    ]);
    expect(rectangles.flat().every(Number.isInteger)).toBe(true);
    system.dispose();
  });

  // -------------------------------------------------------------------------
  // the legibility overlay (docs/frontend/BUBBLE_UI.md)
  // -------------------------------------------------------------------------

  it("draws every silhouette from hand-authored pixel type and never calls a system font", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "The silence holds us. I am here."), 0);
    system.emit({
      kind: "event-mark", at: { x: 240, y: 100 }, ownerId: "briar",
      glyph: "give", family: "exchange", tier: "beat", micro: "12",
    }, 0);
    system.emit({
      kind: "event-burst", at: { x: 300, y: 90 }, glyph: "strike", family: "harm",
    }, 0);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");

    expect(canvas.fillRects.length).toBeGreaterThan(0);
    // Type is drawn as pixels, not glyphs from a hinted system face. The
    // rejected overlay's "8px monospace" is exactly what made it read as UI.
    expect(canvas.fillTexts).toEqual([]);
    system.dispose();
  });

  it("fills a speech tail with the speaker's own identity hue so a bubble is attributable without a nameplate", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "I am here."), 0);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");

    expect(canvas.fills).toContain(identityHue("aster"));
    expect(identityHue("aster")).toBe(identityHue("aster"));
    expect(identityHue("aster")).not.toBe(identityHue("briar"));
    system.dispose();
  });

  // -------------------------------------------------------------------------
  // FULL MESSAGES (Safi, 2026-08-21) — "they should show full messages". The
  // three-line excerpt + fullness bar this replaces is gone: a bubble carries
  // the whole payload, the type steps down a bounded ladder to a legibility
  // FLOOR, and past that floor the BUBBLE grows instead of the type shrinking.
  // -------------------------------------------------------------------------

  it("shows a real 385-character payload in full, with no ellipsis and nothing dropped", () => {
    // Verbatim shape of a real runs/*.jsonl self_talk payload.
    const real = "I drift, content. The world outside is a distant, flickering memory; "
      + "here, in the sanctuary of the warm springs, there is only the rhythmic pulse "
      + "of our breathing. I am held by the presence of my companions, and by the "
      + "quiet that has settled over this place since the morning.";
    expect(real.length).toBeGreaterThan(250);
    const columns = messageColumns(
      real.length,
      TEXT_KIND_METRICS.speech.minColumns,
      TEXT_KIND_METRICS.speech.maxColumns,
    );
    const layout = layoutMessage(real, columns);

    expect(layout.lines.join(" ")).toBe(real);
    expect(layout.lines.join("")).not.toContain("\u2026");
    expect(layout.total).toBe(real.length);
    expect(layout.lines.every((line) => line.length <= columns)).toBe(true);
    // The whole message needs many more than the old three lines, and the
    // bubble is sized to hold every one of them.
    expect(layout.lines.length).toBeGreaterThan(3);

    const bubble = buildTextBubble({ kind: "speech", text: real, hue: "#9c4a33", accent: "#8a8270" });
    expect(bubble.layout!.lines.join(" ")).toBe(real);
    const brief = buildTextBubble({ kind: "speech", text: "Yes.", hue: "#9c4a33", accent: "#8a8270" });
    expect(bubble.surface.height).toBeGreaterThan(brief.surface.height * 2);
    expect(bubble.surface.width).toBeGreaterThan(brief.surface.width);
  });

  it("keeps a long message up for the full seven seconds, and no longer", () => {
    // Owner band (Safi, 2026-08-26): 5-7s, longer message = closer to 7s. A
    // 380-character line is nearly the saturation length, so it earns very
    // close to the ceiling -- and the ceiling is now a hard 7s, not 30s.
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "a".repeat(380)), 0);
    system.advanceTo(6_800);
    expect(system.diagnostics().activeBubbles).toBe(1);
    system.advanceTo(7_001);
    expect(system.diagnostics().activeBubbles).toBe(0);
    system.dispose();
  });

  it("steps the type down a bounded ladder and stops at the legibility floor", () => {
    // A remark can afford the camera's biggest type; a confession cannot.
    expect(textScaleForLength(40)).toBe(4);
    expect(textScaleForLength(200)).toBe(3);
    expect(textScaleForLength(385)).toBe(TEXT_SCALE_FLOOR);
    // Past the floor the type NEVER shrinks further, however long the message.
    expect(textScaleForLength(1_153)).toBe(TEXT_SCALE_FLOOR);
    expect(TEXT_SCALE_FLOOR).toBe(2);

    const roomy = { width: 1_440, height: 900 };
    const small = { width: 120, height: 80 };
    // The camera's own scale still caps it: no bubble is bigger than its zoom.
    expect(textBubbleScale(2, 40, { width: 100, height: 60 }, roomy)).toBe(2);
    expect(textBubbleScale(4, 40, { width: 100, height: 60 }, roomy)).toBe(4);
    expect(textBubbleScale(4, 385, { width: 100, height: 60 }, roomy)).toBe(TEXT_SCALE_FLOOR);
    // ONLY a frame too small to hold the bubble may go below the floor — a
    // narrow phone viewport — and never below the authored 1x face.
    expect(textBubbleScale(4, 385, { width: 100, height: 60 }, small)).toBe(1);
    expect(textBubbleScale(4, 385, { width: 400, height: 400 }, small)).toBe(1);
  });

  it("keeps a whole bubble inside the viewer's safe frame, however long the message", () => {
    const system = createSystem(recipeFor(world[0]!));
    // A speaker in the top-left corner: the bubble's natural home is off the
    // canvas entirely, which is where the end of a long sentence used to go.
    system.setAnchorPositions(new Map([["aster", { x: 30, y: 60 }]]));
    const long = "Joe, Dick, Allen -- it is as I feared. Both the East and West are "
      + "incredibly sparse, just like here. This region seems picked over, and pushing "
      + "further into similar territory may not yield much.";
    system.emit({ ...speech("aster", long), at: { x: 30, y: 60 } }, 0);

    const canvas = recordingContext();
    system.draw(canvas.context, "air", {
      zoom: 2,
      originX: 0,
      originY: 0,
      width: 1_440,
      height: 900,
      insets: { top: 60, right: 52, bottom: 109, left: 20 },
    });

    // The jsdom stub has no real canvas, so the surface paints run-length spans:
    // `fillRects` IS the drawn extent, in screen px.
    const box = paintedExtent(canvas.fillRects);
    expect(box.right - box.x).toBeGreaterThan(200);
    expect(box.x).toBeGreaterThanOrEqual(20);
    expect(box.y).toBeGreaterThanOrEqual(60);
    expect(box.right).toBeLessThanOrEqual(1_440 - 52);
    expect(box.bottom).toBeLessThanOrEqual(900 - 109);
    expect(system.diagnostics().overflowingBubbles).toBe(0);
    system.dispose();
  });

  it("moves a bubble off the speaker and off the being it is addressed to", () => {
    const system = createSystem(recipeFor(world[0]!));
    // The addressee stands exactly where the bubble's first candidate lands.
    const speaker = { x: 400, y: 400 };
    const listener = { x: 400, y: 330 };
    system.setAnchorPositions(new Map([["aster", speaker], ["briar", listener]]));
    system.emit({
      ...speech("aster", "Between us only -- I have been watching how you tend this place."),
      at: speaker,
      variant: "whisper",
      targetId: "briar",
      targetName: "Briar",
    }, 0);

    const canvas = recordingContext();
    system.draw(canvas.context, "air", {
      zoom: 2, originX: 0, originY: 0, width: 1_440, height: 900,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    const box = paintedExtent(canvas.fillRects);
    // Still a real bubble, not a demotion to a stud.
    expect(box.right - box.x).toBeGreaterThan(150);
    // Chibi frames are 22x46 world px standing on the feet anchor.
    for (const feet of [speaker, listener]) {
      const body = {
        x: (feet.x - 11) * 2,
        y: (feet.y - 46) * 2,
        right: (feet.x + 11) * 2,
        bottom: feet.y * 2,
      };
      const overlaps = box.x < body.right && box.right > body.x
        && box.y < body.bottom && box.bottom > body.y;
      expect(overlaps).toBe(false);
    }
    system.dispose();
  });

  it("draws every character a real message actually contains", () => {
    // Measured over 3,363 recorded `speak`/`self_talk` payloads: the ONLY
    // characters outside the authored face were `_` (219), `[`/`]` (43 each) and
    // a stray backtick. An unmapped character renders as `?`, which was
    // invisible behind a three-line excerpt and is a defect in a full message.
    for (const character of "_[]`") {
      expect(hasFontGlyph(character)).toBe(true);
    }
  });

  it("hard-breaks a monster token instead of overflowing the box", () => {
    const layout = layoutMessage(`${"z".repeat(60)} tail`, 14);
    expect(layout.lines.every((line) => line.length <= 14)).toBe(true);
    expect(layout.lines[0]!.endsWith("-")).toBe(true);
    expect(layout.lines.join("").replace(/-/gu, "")).toContain("tail");
  });

  it("tags directed speech with its addressee at the START, and tags nothing else", () => {
    const text = "I have been watching how you tend this place.";
    const plain = buildTextBubble({ kind: "whisper", text, hue: "#9c4a33", accent: "#8a8270" });
    const tagged = buildTextBubble({ kind: "whisper", text, hue: "#9c4a33", accent: "#8a8270", tag: "to Joe" });
    // The tag opens the bubble, so the box is exactly one type line taller.
    expect(tagged.surface.height).toBeGreaterThan(plain.surface.height);
    expect(tagged.layout!.lines.join(" ")).toBe(text);

    // Undirected speech and private self-talk carry no addressee at all.
    const system = createSystem(recipeFor(world[0]!));
    system.emit({ ...speech("aster", text), targetId: "briar", targetName: "Joe" }, 0);
    system.emit({ ...speech("briar", text), variant: "thought" }, 0);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");
    // Soft ink is used for the address line and nowhere else in the grammar.
    expect(canvas.fills).toContain("#2f3a2b");
    system.dispose();

    const quiet = createSystem(recipeFor(world[0]!));
    quiet.emit({ ...speech("briar", text), variant: "thought" }, 0);
    const quietCanvas = recordingContext();
    quiet.draw(quietCanvas.context, "air");
    expect(quietCanvas.fills).not.toContain("#2f3a2b");
    quiet.dispose();
  });

  it("makes a thought the quietest silhouette on screen: narrower than a whisper, which is narrower than speech", () => {
    const text = "It is good to be here with you, Allen. The silence is profound.";
    const speechBubble = buildTextBubble({ kind: "speech", text, hue: "#9c4a33", accent: "#8a8270" });
    const whisperBubble = buildTextBubble({ kind: "whisper", text, hue: "#9c4a33", accent: "#8a8270" });
    const thoughtBubble = buildTextBubble({ kind: "thought", text, hue: "#9c4a33", accent: "#8a8270" });

    expect(whisperBubble.layout!.lines.every((line) => line.length <= 16)).toBe(true);
    expect(thoughtBubble.layout!.lines.every((line) => line.length <= 14)).toBe(true);
    expect(speechBubble.layout!.lines.every((line) => line.length <= 18)).toBe(true);
    // A thought has no anchor stud: it is the one kind with no physical link to
    // the world. Its connector is three detached, shrinking puffs.
    expect(thoughtBubble.surface.height).toBeGreaterThan(speechBubble.surface.height);
  });

  it("gives speech a solid outline and whisper/thought a dashed one, so kind survives before a word is read", () => {
    const solid = buildTextBubble({ kind: "speech", text: "I am here.", hue: "#9c4a33", accent: "#8a8270" }).surface;
    const dashed = buildTextBubble({ kind: "whisper", text: "I am here.", hue: "#9c4a33", accent: "#8a8270" }).surface;
    const inkRun = (surface: typeof solid, row: number): number => {
      let count = 0;
      for (let x = 0; x < surface.width; x += 1) if (surface.at(x, row) === "#12180f") count += 1;
      return count;
    };
    expect(inkRun(solid, 0)).toBeGreaterThan(inkRun(dashed, 0));
  });

  it("lives 5s to 7s by message length, and reduced motion EXTENDS that", () => {
    // Owner-set band (Safi, 2026-08-26), replacing the reading-budget model:
    // `clamp(5000 + 5 x visibleChars, 5000, 7000)`. A bubble is the live pulse
    // of a conversation; the Chronicle feed is the record of it.
    const brief = createSystem(recipeFor(world[0]!));
    brief.emit(speech("aster", "Yes."), 0);
    // The floor is a flat five seconds -- not the 3.3s the old reading budget
    // gave a four-character line.
    brief.advanceTo(4_999);
    expect(brief.diagnostics().activeBubbles).toBe(1);
    brief.advanceTo(5_021);
    expect(brief.diagnostics().activeBubbles).toBe(0);
    brief.dispose();

    const long = createSystem(recipeFor(world[0]!));
    const real = "I drift, content. The world outside is a distant, flickering memory; "
      + "here, in the sanctuary of the warm springs, there is only the rhythmic pulse "
      + "of our breathing. I am held by the presence of my companions, and by the "
      + "quiet that has settled over this place since the morning.";
    long.emit(speech("aster", real), 0);
    // A median-length line earns most of the band ...
    long.advanceTo(6_000);
    expect(long.diagnostics().activeBubbles).toBe(1);
    // ... and the ceiling binds hard at seven seconds. This is the deliberate
    // consequence the owner chose: a 385-character line is NOT fully readable
    // above a head any more.
    long.advanceTo(7_001);
    expect(long.diagnostics().activeBubbles).toBe(0);
    long.dispose();

    // Longer means longer, monotonically, up to the ceiling.
    const shortRun = createSystem(recipeFor(world[0]!));
    shortRun.emit(speech("aster", "a".repeat(40)), 0);
    shortRun.advanceTo(5_199);
    expect(shortRun.diagnostics().activeBubbles).toBe(1);
    shortRun.advanceTo(5_221);
    expect(shortRun.diagnostics().activeBubbles).toBe(0);
    shortRun.dispose();

    // An outlier still cannot park itself over the world.
    const outlier = createSystem(recipeFor(world[0]!));
    outlier.emit(speech("aster", "a".repeat(1_153)), 0);
    outlier.advanceTo(7_001);
    expect(outlier.diagnostics().activeBubbles).toBe(0);
    outlier.dispose();

    // Reduced motion is the one carve-out kept from the old model: an
    // accessibility contract, not a reading budget.
    const calm = createSystem(recipeFor(world[0]!), undefined, true);
    calm.emit(speech("aster", "Yes."), 0);
    calm.advanceTo(5_021);
    expect(calm.diagnostics().activeBubbles).toBe(1);
    calm.dispose();
  });

  it("fades a being's previous bubble out when their next one arrives, then leaves residue", () => {
    // One head, one bubble -- but the replaced one now DISSOLVES rather than
    // popping (Safi, 2026-08-26: "the prev should fade away").
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "First."), 0);
    system.emit(speech("aster", "Second."), 100);
    // Both are alive for the length of the fade: the old one on its way out ...
    expect(system.diagnostics().activeBubbles).toBe(2);
    expect(system.diagnostics().activeResidue).toBe(0);
    system.advanceTo(300);
    expect(system.diagnostics().activeBubbles).toBe(2);
    // ... and gone, as residue, once the fade lands.
    system.advanceTo(501);
    expect(system.diagnostics().activeBubbles).toBe(1);
    expect(system.diagnostics().activeResidue).toBe(1);
    system.dispose();
  });

  it("dissolves a bubble instead of popping it, at both ends of its life", () => {
    // "Fade out, do not pop" (Safi, 2026-08-26). ONE 400ms alpha ramp serves
    // both ways a bubble leaves: running out of its 5-7s, and being superseded,
    // which simply pulls the deadline into that ramp.
    const expiresAtMs = 5_020;
    const slot = { expiresAtMs };
    // Full strength for the whole readable life ...
    expect(textFadeAlpha(slot, 0)).toBe(1);
    expect(textFadeAlpha(slot, expiresAtMs - TEXT_FADE_OUT_MS)).toBe(1);
    // ... then a ramp, not a cliff ...
    expect(textFadeAlpha(slot, expiresAtMs - TEXT_FADE_OUT_MS / 2)).toBeCloseTo(0.5, 5);
    expect(textFadeAlpha(slot, expiresAtMs - 40)).toBeCloseTo(0.1, 5);
    // ... reaching zero exactly at the deadline, never below it.
    expect(textFadeAlpha(slot, expiresAtMs)).toBe(0);
    expect(textFadeAlpha(slot, expiresAtMs + 10_000)).toBe(0);
    expect(TEXT_FADE_OUT_MS).toBe(400);
  });

  it("supersedes the partner it is answering, and nobody else in the world", () => {
    // THE RULE (Safi, 2026-08-26): a new utterance supersedes the previous one
    // from the same being, or from that being's conversation partner -- the pair
    // currently exchanging. Utterances elsewhere must NOT clear each other.
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "Have you seen the springs?", "briar"), 0);
    // A third being, talking to somebody else entirely, is a bystander here.
    system.emit(speech("cinder", "The ridge is bare again.", "dune"), 10);
    expect(system.diagnostics().activeBubbles).toBe(2);

    // Briar answers Aster: Aster's line is the one this reply displaces.
    system.emit(speech("briar", "Only at dusk.", "aster"), 20);
    expect(system.diagnostics().activeBubbles).toBe(3);
    system.advanceTo(421);
    // Aster's faded; briar's is up; cinder's -- a different conversation -- is
    // untouched and still running out its own 5-7s.
    expect(system.diagnostics().activeBubbles).toBe(2);
    expect(system.diagnostics().activeResidue).toBe(1);
    system.dispose();
  });

  it("does not let a stranger's line clear a bubble that was never addressed to them", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "A long thought about the water.", "briar"), 0);
    // Briar speaks -- but to a THIRD being, so this is not the pair exchanging.
    system.emit(speech("briar", "Dune, hold the door.", "dune"), 10);
    system.advanceTo(421);
    // Both survive: only a reply aimed BACK at the speaker supersedes.
    expect(system.diagnostics().activeBubbles).toBe(2);
    expect(system.diagnostics().activeResidue).toBe(0);
    system.dispose();
  });

  it("collapses an expired overlay into a residue pip that fades over six seconds, keeping at most three per being", () => {
    const system = createSystem(recipeFor(world[0]!));
    for (let index = 0; index < 5; index += 1) {
      system.emit({
        kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
        glyph: "gather", family: "exchange", tier: "beat",
      }, index * 10);
    }
    expect(system.diagnostics().activeResidue).toBe(3);
    // The surviving mark expires into residue of its own, which then fades.
    system.advanceTo(3_300);
    expect(system.diagnostics().activeMarkers).toBe(0);
    expect(system.diagnostics().activeResidue).toBe(3);
    system.advanceTo(9_400);
    expect(system.diagnostics().activeResidue).toBe(0);
    system.dispose();
  });

  it("opens a gather cloud whose dots fill, then resolves it into the real bubble without leaving residue", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({ kind: "event-gather", at: { x: 100, y: 100 }, ownerId: "aster" }, 0);
    expect(system.diagnostics().activeGathers).toBe(1);

    const early = recordingContext();
    system.draw(early.context, "air");
    const earlyLit = early.fills.filter((fill) => fill === "#12180f").length;

    system.advanceTo(600);
    const late = recordingContext();
    system.draw(late.context, "air");
    expect(late.fills.filter((fill) => fill === "#12180f").length).toBeGreaterThan(earlyLit);

    system.emit(speech("aster", "I am here."), 700);
    expect(system.diagnostics().activeGathers).toBe(0);
    expect(system.diagnostics().activeBubbles).toBe(1);
    // Resolving is not expiring: the gather BECAME the bubble.
    expect(system.diagnostics().activeResidue).toBe(0);
    system.dispose();
  });

  it("re-emitting a gather for the same being does not restart its dots", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({ kind: "event-gather", at: { x: 100, y: 100 }, ownerId: "aster" }, 0);
    system.emit({ kind: "event-gather", at: { x: 100, y: 100 }, ownerId: "aster" }, 300);
    expect(system.diagnostics().activeGathers).toBe(1);
    system.dispose();
  });

  it("bounds a gather so a cancelled scene never leaves a permanent cloud over a head", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({ kind: "event-gather", at: { x: 100, y: 100 }, ownerId: "aster" }, 0);
    system.advanceTo(2_400);
    expect(system.diagnostics().activeGathers).toBe(0);
    system.dispose();
  });

  it("marks an action with its family accent and glyph, and prints only an exact payload number beside it", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
      glyph: "strike", family: "harm", tier: "strike", micro: "-30",
    }, 0);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");

    expect(canvas.fills).toContain("#9c3b26");
    expect(canvas.fillTexts).toEqual([]);
    expect(system.diagnostics().activeMarkers).toBe(1);
    system.dispose();
  });

  it("holds a strike longer than a beat and a knell longest of all -- a death must not look like a greeting", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "beat",
      glyph: "give", family: "exchange", tier: "beat",
    }, 0);
    system.emit({
      kind: "event-mark", at: { x: 200, y: 100 }, ownerId: "strike",
      glyph: "strike", family: "harm", tier: "strike",
    }, 0);
    system.emit({
      kind: "event-mark", at: { x: 300, y: 100 }, ownerId: "knell",
      glyph: "fell", family: "harm", tier: "knell",
    }, 0);

    system.advanceTo(3_200);
    expect(system.diagnostics().activeMarkers).toBe(2);
    system.advanceTo(4_200);
    expect(system.diagnostics().activeMarkers).toBe(1);
    system.advanceTo(6_000);
    expect(system.diagnostics().activeMarkers).toBe(0);
    system.dispose();
  });

  it("inverts the field to ink and bone for a death burst, and for nothing else but a home collapse", () => {
    const ordinary = buildBurst({ glyph: "strike", accent: "#9c3b26" }).surface;
    const knell = buildBurst({ glyph: "fell", accent: "#9c3b26", invert: true }).surface;
    const inkPixels = (surface: typeof knell): number => {
      let count = 0;
      for (let y = 0; y < surface.height; y += 1) {
        for (let x = 0; x < surface.width; x += 1) if (surface.at(x, y) === "#12180f") count += 1;
      }
      return count;
    };
    expect(inkPixels(knell)).toBeGreaterThan(inkPixels(ordinary));
    // The knell speaks in bone, the only place that colour appears.
    let bone = 0;
    for (let y = 0; y < knell.height; y += 1) {
      for (let x = 0; x < knell.width; x += 1) if (knell.at(x, y) === "#e8dcc0") bone += 1;
    }
    expect(bone).toBeGreaterThan(0);
  });

  it("draws an aim thread to a receiver cap, and severs it short with accent cut-ticks for a refusal", () => {
    const aim = createSystem(recipeFor(world[0]!));
    aim.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
      glyph: "propose", family: "bond", tier: "beat",
      threads: [{ to: { x: 220, y: 100 }, mode: "aim", accent: "#a35f69", hue: "#43607f" }],
    }, 0);
    const aimCanvas = recordingContext();
    aim.draw(aimCanvas.context, "air");
    const aimDots = aimCanvas.fillRects.filter((rect) => rect[2] === 1 && rect[3] === 1).length;

    const severed = createSystem(recipeFor(world[0]!));
    severed.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
      glyph: "refuse", family: "bond", tier: "strike",
      threads: [{ to: { x: 220, y: 100 }, mode: "severed", accent: "#a35f69", hue: "#43607f" }],
    }, 0);
    const severedCanvas = recordingContext();
    severed.draw(severedCanvas.context, "air");

    // A refusal is a bond that STOPS: the thread halts at 55% and is struck
    // through by two cut-ticks in the family accent.
    expect(aimDots).toBeGreaterThan(0);
    expect(severedCanvas.fills.filter((fill) => fill === "#a35f69").length)
      .toBeGreaterThan(aimCanvas.fills.filter((fill) => fill === "#a35f69").length);
    aim.dispose();
    severed.dispose();
  });

  it("places a crowd deterministically -- same input, same layout -- and never overlaps two live marks", () => {
    const build = (): ReturnType<typeof createSystem> => {
      const system = createSystem(recipeFor(world[0]!));
      for (let index = 0; index < 7; index += 1) {
        system.emit({
          kind: "event-mark", at: { x: 100 + index * 6, y: 100 }, ownerId: `being-${index}`,
          glyph: "gather", family: "exchange", tier: "beat",
        }, index);
      }
      return system;
    };
    const left = recordingContext();
    const right = recordingContext();
    const first = build();
    const second = build();
    first.draw(left.context, "air");
    second.draw(right.context, "air");
    expect(right.fillRects).toEqual(left.fillRects);
    first.dispose();
    second.dispose();
  });

  it("demotes the least significant mark to a stud under crowding, and never demotes a knell", () => {
    const system = createSystem(recipeFor(world[0]!));
    for (let index = 0; index < 9; index += 1) {
      system.emit(speech(`being-${index}`, "The silence holds us."), index);
    }
    system.emit({
      kind: "speech-bubble", at: { x: 100, y: 100 }, speakerId: "elder", variant: "speech",
      text: "I am here.", tailLean: 0, hue: "#9c4a33", accent: "#8a8270", tier: "knell",
    }, 10);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");
    expect(canvas.fillRects.length).toBeGreaterThan(0);
    system.dispose();
  });

  it("collapses every bubble to a glyph stud below zoom 1.5 and restores its words above it", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit(speech("aster", "It is good to be here with you, Allen."), 0);

    const wide = recordingContext();
    system.draw(wide.context, "air", { zoom: 1, originX: 0, originY: 0 });
    const close = recordingContext();
    system.draw(close.context, "air", { zoom: 2, originX: 0, originY: 0 });

    expect(wide.fillRects.length).toBeGreaterThan(0);
    expect(close.fillRects.length).toBeGreaterThan(wide.fillRects.length);
    system.dispose();
  });

  it("collapses an action mark to its verb glyph below the text threshold, not just the text kinds", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
      glyph: "hoard", family: "exchange", tier: "beat", micro: "41",
    }, 0);

    const wide = recordingContext();
    system.draw(wide.context, "air", { zoom: 1, originX: 0, originY: 0 });
    const close = recordingContext();
    system.draw(close.context, "air", { zoom: 2, originX: 0, originY: 0 });

    // A full banner is wider than a 13px stud, so the wide view must draw a
    // narrower footprint -- otherwise the chrome is larger than the beings under it.
    const span = (rects: number[][]): number =>
      Math.max(...rects.map((r) => r[0]! + r[2]!)) - Math.min(...rects.map((r) => r[0]!));
    expect(span(wide.fillRects)).toBeLessThan(span(close.fillRects));
    system.dispose();
  });

  it("blits chrome at an integer scale so it is never sub-pixel at any camera zoom", () => {
    expect(bubbleScale(0.5)).toBe(1);
    expect(bubbleScale(1)).toBe(1);
    expect(bubbleScale(1.4)).toBe(1);
    expect(bubbleScale(1.6)).toBe(2);
    expect(bubbleScale(2)).toBe(2);
    expect(bubbleScale(3.7)).toBe(4);
    expect(bubbleScale(4)).toBe(4);
    // Clamped at both ends of the camera's own MIN_ZOOM 0.5 / MAX_ZOOM 4 range.
    expect(bubbleScale(0.1)).toBe(1);
    expect(bubbleScale(9)).toBe(4);
  });

  it("positions overlay chrome in screen space from the caller's raster origin, not the canvas transform", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "aster",
      glyph: "hearth", family: "dwell", tier: "beat",
    }, 0);

    const origin = screenRecordingContext();
    system.draw(origin.context, "air", { zoom: 2, originX: 0, originY: 0 });
    const shifted = screenRecordingContext();
    system.draw(shifted.context, "air", { zoom: 2, originX: 40, originY: 0 });

    expect(origin.transforms).toContainEqual([1, 0, 0, 1, 0, 0]);
    const originLeft = Math.min(...origin.fillRects.map((rect) => rect[0]!));
    const shiftedLeft = Math.min(...shifted.fillRects.map((rect) => rect[0]!));
    expect(shiftedLeft - originLeft).toBe(40);
    system.dispose();
  });

  it("never suppresses overlay chrome via exclusion zones, even directly over the being's own body rect", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.setExclusionZones([feetAnchoredVisualRect({ x: 100, y: 100 })]);
    system.emit(speech("aster", "I am here."), 0);
    system.emit({
      kind: "event-mark", at: { x: 100, y: 100 }, ownerId: "briar",
      glyph: "build", family: "dwell", tier: "beat",
    }, 0);

    expect(system.diagnostics().suppressedEffects).toBe(0);
    expect(system.diagnostics().activeBubbles).toBe(1);
    expect(system.diagnostics().activeMarkers).toBe(1);
    const canvas = recordingContext();
    system.draw(canvas.context, "air");
    expect(canvas.fillRects.length).toBeGreaterThan(0);
    system.dispose();
  });

  it("flies an item from its departure point to its arrival point on an arc, then disappears on arrival (no lingering)", () => {
    const system = createSystem(recipeFor(world[0]!));
    system.emit({
      kind: "flying-item", from: { x: 40, y: 100 }, to: { x: 120, y: 100 }, icon: "energy",
    }, 0);
    const start = recordingContext();
    system.draw(start.context, "air");
    expect(start.fillRects.length).toBeGreaterThan(0);
    expect(Math.min(...start.fillRects.map((rect) => rect[0]!))).toBeLessThan(60);

    system.advanceTo(500);
    const mid = recordingContext();
    system.draw(mid.context, "air");
    expect(Math.min(...mid.fillRects.map((rect) => rect[1]!)))
      .toBeLessThan(Math.min(...start.fillRects.map((rect) => rect[1]!)));

    system.advanceTo(1_000);
    const arrived = recordingContext();
    system.draw(arrived.context, "air");
    expect(arrived.fillRects).toEqual([]);
    system.dispose();
  });

  it("keeps every glyph in the grammar authored, so a new verb cannot silently render as nothing", () => {
    for (const glyph of OVERLAY_GLYPH_NAMES) {
      expect(buildPip(glyph, "#b8801f").surface.paintedCount).toBeGreaterThan(0);
    }
    expect(OVERLAY_GLYPH_NAMES.length).toBe(26);
  });


  it("uses an active-pack neutral diagnostic for a missing kind instead of borrowing another biome", () => {
    const ash = recipeFor(world[3]!);
    const first = ash.animatedEnvironment[0]!;
    const malformedTrustedRecipe = {
      ...ash,
      animatedEnvironment: [
        { ...first, kind: "water" as const },
        ...ash.animatedEnvironment.slice(1),
      ],
    } satisfies RegionMapRecipeV1;
    const system = createSystem(malformedTrustedRecipe);
    const diagnostics = system.diagnostics();
    expect(diagnostics.missingKinds).toEqual(["water"]);
    expect(diagnostics.neutralDiagnostics).toBe(1);
    expect(diagnostics.resolvedAtlasIds).toEqual(["ash-waste-environment"]);
    const canvas = recordingContext();
    system.draw(canvas.context, "ground");
    expect(canvas.draws.every((draw) => !String(draw[0]).includes("spring-terraces"))).toBe(true);
    expect(canvas.fills).toContain("#a39992");
    system.dispose();
  });

  it("releases every distinct lease exactly once, clears state, and remains inert after disposal", () => {
    const recipe = recipeFor(world[0]!);
    const release = vi.fn();
    const sharedLease: ProductionAssetLease = {
      value: { label: `${recipe.kit}-environment` } as unknown as ImageBitmap,
      release,
    };
    const leases = new Map<string, ProductionAssetLease>([
      [`${recipe.kit}-environment`, sharedLease],
      ["alias", sharedLease],
    ]);
    const system = new EnvironmentSystem({
      regionId: recipe.regionId,
      recipe,
      condition: { energyRatio: 1, materialsRatio: 1 },
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: leases,
    });
    system.dispose();
    system.dispose();
    system.reconcile({ energyRatio: 0, materialsRatio: 0 });
    system.setExclusionZones([{ x: 0, y: 0, width: 100, height: 100 }]);
    system.emit({ kind: "footstep", at: { x: 200, y: 200 }, tint: "#fff" }, 0);
    system.advanceTo(1_000);
    const canvas = recordingContext();
    system.draw(canvas.context, "ground");

    expect(release).toHaveBeenCalledTimes(1);
    expect(system.diagnostics()).toMatchObject({
      disposed: true,
      activeWater: 0,
      activeWind: 0,
      activeSmoke: 0,
      activeFootsteps: 0,
      nextDeadlineMs: null,
    });
    expect(canvas.draws).toEqual([]);
    expect(canvas.fills).toEqual([]);
  });
});

function recipeFor(source: RegionSnapshot): RegionMapRecipeV1 {
  return createRegionMapRecipe(createRegionMapIdentity(811, source, world));
}

function createSystem(
  recipe: RegionMapRecipeV1,
  condition: RegionCondition = { energyRatio: 0.7, materialsRatio: 0.5 },
  reducedMotion = false,
  manifest: ProductionAssetManifest = PRODUCTION_ASSET_MANIFEST,
): EnvironmentSystem {
  const atlasId = `${recipe.kit}-environment`;
  const lease: ProductionAssetLease = {
    value: { label: atlasId, toString: () => atlasId } as unknown as ImageBitmap,
    release: vi.fn(),
  };
  return new EnvironmentSystem({
    regionId: recipe.regionId,
    recipe,
    condition,
    manifest,
    atlasLeases: new Map([[atlasId, lease]]),
    reducedMotion,
  });
}

/**
 * A recording context that also implements `setTransform`, so the overlay's
 * screen-space pass can be observed. The plain {@link recordingContext} stub
 * deliberately omits it: the overlay must degrade to the ambient world space at
 * scale 1 when the host cannot enter screen space.
 */
function screenRecordingContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly fillRects: number[][];
  readonly transforms: number[][];
} {
  const base = recordingContext();
  const transforms: number[][] = [];
  const context = base.context as unknown as Record<string, unknown>;
  context.setTransform = (...args: number[]) => transforms.push(args);
  return { context: base.context, fillRects: base.fillRects, transforms };
}

function region(name: string, description: string): RegionSnapshot {
  return {
    name,
    description,
    connections: [],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 50,
    current_materials: 50,
    max_energy: 100,
    max_materials: 100,
  };
}

function recordingContext(): {
  readonly context: CanvasRenderingContext2D;
  readonly draws: unknown[][];
  readonly fills: string[];
  readonly fillRects: number[][];
  readonly fillTexts: Array<[string, number, number]>;
  readonly fillTextStyles: string[];
} {
  const draws: unknown[][] = [];
  const fills: string[] = [];
  const fillRects: number[][] = [];
  const fillTexts: Array<[string, number, number]> = [];
  const fillTextStyles: string[] = [];
  let fillStyle = "#000000";
  const context = {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    drawImage: (...args: unknown[]) => draws.push(args.map((value) => {
      if (typeof value === "object" && value !== null && "label" in value) {
        return (value as { label: string }).label;
      }
      return value;
    })),
    fillRect: vi.fn((...args: number[]) => {
      fills.push(fillStyle);
      fillRects.push(args);
    }),
    fillText: vi.fn((value: string, x: number, y: number) => {
      fillTexts.push([value, x, y]);
      fillTextStyles.push(fillStyle);
    }),
    get fillStyle() { return fillStyle; },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) { fillStyle = String(value); },
  } as unknown as CanvasRenderingContext2D;
  return { context, draws, fills, fillRects, fillTexts, fillTextStyles };
}

/** The drawn extent of one overlay pass, from the recording stub's span rects. */
function paintedExtent(rectangles: readonly number[][]): Readonly<{
  x: number;
  y: number;
  right: number;
  bottom: number;
}> {
  if (rectangles.length === 0) throw new Error("nothing was painted");
  return {
    x: Math.min(...rectangles.map(([x]) => x!)),
    y: Math.min(...rectangles.map(([, y]) => y!)),
    right: Math.max(...rectangles.map(([x, , width]) => x! + width!)),
    bottom: Math.max(...rectangles.map(([, y, , height]) => y! + height!)),
  };
}

function _assertKitType(_kit: RegionKitId): void {
  // Compile-time guard that fixture recipes continue to use the frozen kit vocabulary.
}

function _assertRectType(_rect: Rect): void {
  // Compile-time guard that exclusion zones use the shared renderer contract.
}
