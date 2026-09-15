import { describe, expect, it } from "vitest";

import { feetAnchoredVisualRect } from "../production/productionGeometry";
import { createCamera, deriveSheetZoomBounds, MAX_ZOOM, MIN_ZOOM } from "./Camera2D";

function expectFiniteCamera(camera: ReturnType<typeof createCamera>): void {
  const snapshot = camera.snapshot();
  expect([
    snapshot.center.x,
    snapshot.center.y,
    snapshot.zoom,
    snapshot.safeFrame.x,
    snapshot.safeFrame.y,
    snapshot.safeFrame.width,
    snapshot.safeFrame.height,
    snapshot.followDeadZone.x,
    snapshot.followDeadZone.y,
    snapshot.followDeadZone.width,
    snapshot.followDeadZone.height,
    snapshot.rasterOrigin.x,
    snapshot.rasterOrigin.y,
  ].every(Number.isFinite)).toBe(true);
  expect(Object.values(camera.worldToScreen({ x: 12, y: 24 })).every(Number.isFinite)).toBe(true);
  expect(Object.values(camera.screenToWorld({ x: 12, y: 24 })).every(Number.isFinite)).toBe(true);
}

function expectViewportInside(
  camera: ReturnType<typeof createCamera>,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  const topLeft = camera.screenToWorld({ x: 0, y: 0 });
  const bottomRight = camera.screenToWorld({
    x: camera.snapshot().safeFrame.x + camera.snapshot().safeFrame.width,
    y: camera.snapshot().safeFrame.y + camera.snapshot().safeFrame.height,
  });
  expect(topLeft.x).toBeGreaterThanOrEqual(bounds.x);
  expect(topLeft.y).toBeGreaterThanOrEqual(bounds.y);
  expect(bottomRight.x).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(bottomRight.y).toBeLessThanOrEqual(bounds.y + bounds.height);
}

function expectRectInsideSafeFrame(
  camera: ReturnType<typeof createCamera>,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  const frame = camera.snapshot().safeFrame;
  const topLeft = camera.worldToScreen({ x: rect.x, y: rect.y });
  const bottomRight = camera.worldToScreen({
    x: rect.x + rect.width,
    y: rect.y + rect.height,
  });
  expect(topLeft.x).toBeGreaterThanOrEqual(frame.x);
  expect(topLeft.y).toBeGreaterThanOrEqual(frame.y);
  expect(bottomRight.x).toBeLessThanOrEqual(frame.x + frame.width);
  expect(bottomRight.y).toBeLessThanOrEqual(frame.y + frame.height);
}

function expectSafeFrameInsideWorld(
  camera: ReturnType<typeof createCamera>,
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
): void {
  const frame = camera.snapshot().safeFrame;
  const topLeft = camera.screenToWorld({ x: frame.x, y: frame.y });
  const bottomRight = camera.screenToWorld({
    x: frame.x + frame.width,
    y: frame.y + frame.height,
  });
  expect(topLeft.x).toBeGreaterThanOrEqual(bounds.x);
  expect(topLeft.y).toBeGreaterThanOrEqual(bounds.y);
  expect(bottomRight.x).toBeLessThanOrEqual(bounds.x + bounds.width);
  expect(bottomRight.y).toBeLessThanOrEqual(bounds.y + bounds.height);
}

describe("Camera2D", () => {
  it("tracks a moving Story entity by stable selection key between observer frames", () => {
    const camera = createCamera({
      width: 512,
      height: 288,
      safeFrame: { top: 24, right: 24, bottom: 48, left: 96 },
    });
    const first = feetAnchoredVisualRect({ x: 96, y: 128 });
    camera.setEntityBounds("agent:joe", first);
    camera.apply({ type: "story-target", entityId: "agent:joe", target: first });
    camera.update(240);

    let moving = first;
    for (let tick = 0; tick < 24; tick += 1) {
      moving = { ...moving, x: moving.x + 8, y: moving.y + 4 };
      camera.setEntityBounds("agent:joe", moving);
      camera.update(16);
    }

    expect(camera.snapshot()).toMatchObject({
      mode: "story",
      storyEntityId: "agent:joe",
      storyTarget: moving,
    });
    expect(camera.snapshot().center).not.toEqual({ x: 0, y: 0 });
    expectRectInsideSafeFrame(camera, moving);
  });

  it.each([
    ["desktop", 1_440, 900, { top: 286, right: 52, bottom: 148, left: 260 }],
    ["mobile", 390, 844, { top: 120, right: 52, bottom: 276, left: 8 }],
  ] as const)("keeps a moving Story actor inside the real %s safe-frame geometry", (
    _name,
    width,
    height,
    safeFrame,
  ) => {
    const camera = createCamera({ width, height, safeFrame });
    camera.setWorldBounds({ x: 0, y: 0, width: 2_048, height: 2_048 });
    let actorFeet = { x: 336, y: 448 };
    let actor = feetAnchoredVisualRect(actorFeet);
    camera.setEntityBounds("agent:joe", actor);
    camera.apply({ type: "story-target", entityId: "agent:joe", target: actor });
    camera.update(240);

    for (let tick = 0; tick < 80; tick += 1) {
      actorFeet = { ...actorFeet, x: actorFeet.x + 4 };
      actor = feetAnchoredVisualRect(actorFeet);
      camera.setEntityBounds("agent:joe", actor);
      camera.update(16);
      expectRectInsideSafeFrame(camera, actor);
    }
  });

  it.each([
    ["desktop departure", 1_440, 900, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 944, y: 2_000 })],
    ["desktop arrival", 1_440, 900, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 368, y: 48 })],
    ["mobile departure", 390, 844, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 944, y: 2_000 })],
    ["mobile arrival", 390, 844, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 368, y: 48 })],
  ] as const)("keeps the real C01 %s gate inside unobscured chrome in normal and reduced motion", (
    _name,
    width,
    height,
    safeFrame,
    actor,
  ) => {
    for (const reducedMotion of [false, true]) {
      const camera = createCamera({ width, height, safeFrame, reducedMotion });
      const bounds = { x: 0, y: 0, width: 2_048, height: 2_048 };
      camera.setWorldBounds(bounds);
      camera.setEntityBounds("agent:wanderer_001", actor);
      camera.apply({ type: "story-target", entityId: "agent:wanderer_001", target: actor });
      if (!reducedMotion) camera.update(240);

      expectRectInsideSafeFrame(camera, actor);
      if (actor.y < bounds.y) {
        const protectedFrame = camera.snapshot().safeFrame;
        expect(camera.screenToWorld({ x: protectedFrame.x, y: protectedFrame.y }).y)
          .toBe(actor.y);
      } else {
        expectSafeFrameInsideWorld(camera, bounds);
      }
    }
  });

  it("reports deterministic unsettled state until the 240ms camera endpoint", () => {
    const camera = createCamera({ width: 512, height: 288 });
    expect(camera.isSettled()).toBe(true);
    camera.apply({ type: "story-target", target: { x: 320, y: 176, width: 32, height: 48 } });
    expect(camera.isSettled()).toBe(false);
    // A plain story-target ease is not a `fly-to`: `flying` (CameraSnapshot's precise "a fly-to is
    // animating right now" flag) stays false throughout, even while `isSettled()` reports the
    // broader "the camera is not done moving" during the very same ease.
    expect(camera.snapshot().flying).toBe(false);
    camera.update(239);
    expect(camera.isSettled()).toBe(false);
    expect(camera.snapshot().flying).toBe(false);
    camera.update(1);
    expect(camera.isSettled()).toBe(true);
    expect(camera.snapshot().flying).toBe(false);

    const reduced = createCamera({ width: 512, height: 288, reducedMotion: true });
    reduced.apply({ type: "story-target", target: { x: 320, y: 176, width: 32, height: 48 } });
    expect(reduced.isSettled()).toBe(true);
    expect(reduced.snapshot().center).toEqual(camera.snapshot().center);
  });

  it("does not let a story cue steal Follow or Free camera ownership", () => {
    const camera = createCamera({ width: 512, height: 288 });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.apply({ type: "story-target", target: { x: 400, y: 200, width: 32, height: 48 } });
    expect(camera.snapshot().mode).toBe("follow");

    camera.apply({ type: "free-pan", deltaCss: { x: 32, y: 0 } });
    camera.apply({ type: "story-target", target: { x: 0, y: 0, width: 32, height: 48 } });
    expect(camera.snapshot().mode).toBe("free");
  });

  it("stops an in-flight Story pan when Follow takes ownership before bounds arrive", () => {
    const camera = createCamera({ width: 512, height: 288 });
    camera.apply({ type: "story-target", target: { x: 384, y: 152, width: 32, height: 48 } });
    camera.apply({ type: "follow", entityId: "agent_aster" });

    camera.update(1_000);

    expect(camera.snapshot().center).toEqual({ x: 0, y: 0 });
  });

  it("stops following in place when the followed entity bounds disappear", () => {
    const camera = createCamera({ width: 512, height: 288 });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", { x: 240, y: -16, width: 32, height: 32 });
    camera.setEntityBounds("agent_aster", null);

    camera.update(1_000);

    expect(camera.snapshot().center).toEqual({ x: 0, y: 0 });
  });

  it("returns explicitly to Story and consumes the pending story target", () => {
    const camera = createCamera({ width: 512, height: 288, reducedMotion: true });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.apply({ type: "story-target", target: { x: 384, y: 152, width: 32, height: 48 } });

    expect(camera.snapshot().pendingStoryTarget).toEqual({ x: 384, y: 152, width: 32, height: 48 });
    camera.apply({ type: "return-story" });

    expect(camera.snapshot()).toMatchObject({
      mode: "story",
      center: { x: 400, y: 176 },
      pendingStoryTarget: null,
    });
  });

  it("keeps a followed entity inside the soft dead zone without moving", () => {
    const camera = createCamera({
      width: 512,
      height: 288,
      initialCenter: { x: 200, y: 120 },
      reducedMotion: true,
    });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", { x: 208, y: 118, width: 16, height: 32 });

    expect(camera.snapshot().center).toEqual({ x: 200, y: 120 });
  });

  it("moves only enough to bring a followed entity back to the dead-zone edge", () => {
    const camera = createCamera({ width: 512, height: 288, reducedMotion: true });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", { x: 240, y: -16, width: 32, height: 32 });

    const targetScreen = camera.worldToScreen({ x: 256, y: 0 });
    const { followDeadZone } = camera.snapshot();
    expect(targetScreen.x).toBeCloseTo(followDeadZone.x + followDeadZone.width);
    expect(targetScreen.y).toBeGreaterThanOrEqual(followDeadZone.y);
    expect(targetScreen.y).toBeLessThanOrEqual(followDeadZone.y + followDeadZone.height);
  });

  it("keeps moving Follow targets near the dead-zone edge at different frame rates", () => {
    const peakLags = [30, 60, 120].map((frameRate) => {
      const camera = createCamera({ width: 512, height: 288 });
      camera.apply({ type: "follow", entityId: "agent_walker" });
      camera.setEntityBounds("agent_walker", { x: 240, y: 120, width: 32, height: 32 });
      camera.update(1_000);

      let peakLag = 0;
      for (let frame = 1; frame <= frameRate * 4; frame += 1) {
        const bounds = {
          x: 240 + 32 * frame / frameRate,
          y: 120 + 16 * frame / frameRate,
          width: 32,
          height: 32,
        };
        camera.setEntityBounds("agent_walker", bounds);
        camera.update(1_000 / frameRate);
        const screen = camera.worldToScreen({ x: bounds.x + 16, y: bounds.y + 16 });
        const zone = camera.snapshot().followDeadZone;
        peakLag = Math.max(peakLag,
          screen.x - zone.x - zone.width,
          screen.y - zone.y - zone.height);
      }
      // At walking speed, easing may briefly trail by a fraction of one 32px tile.
      expect(peakLag).toBeLessThan(8);
      return peakLag;
    });
    expect(Math.max(...peakLags) - Math.min(...peakLags)).toBeLessThan(3);
  });

  it("centers story targets in the unobscured safe frame", () => {
    const camera = createCamera({
      width: 512,
      height: 288,
      safeFrame: { top: 24, right: 12, bottom: 40, left: 100 },
      reducedMotion: true,
    });
    camera.apply({ type: "story-target", target: { x: 184, y: 76, width: 32, height: 48 } });

    expect(camera.worldToScreen({ x: 200, y: 100 })).toEqual({ x: 300, y: 136 });
  });

  it("keeps every viewport corner inside finite map bounds at top and bottom story edges", () => {
    const camera = createCamera({ width: 1_440, height: 900, reducedMotion: true });
    camera.setWorldBounds({ x: 0, y: 0, width: 2_048, height: 2_048 });

    camera.apply({ type: "story-target", target: feetAnchoredVisualRect({ x: 720, y: 2_032 }) });
    expect(camera.snapshot().center.y).toBe(1_598);
    expectViewportInside(camera, { x: 0, y: 0, width: 2_048, height: 2_048 });

    camera.apply({ type: "story-target", target: feetAnchoredVisualRect({ x: 720, y: 176 }) });
    expect(camera.snapshot().center.y).toBe(450);
    expectViewportInside(camera, { x: 0, y: 0, width: 2_048, height: 2_048 });
  });

  it("keeps an authored edge target viewport-visible when safe-frame centering conflicts with world coverage", () => {
    const bounds = { x: 0, y: 0, width: 2_048, height: 2_048 };
    const camera = createCamera({
      width: 1_440,
      height: 900,
      safeFrame: { top: 300, right: 0, bottom: 0, left: 0 },
      reducedMotion: true,
    });
    camera.setWorldBounds(bounds);
    const targetBounds = feetAnchoredVisualRect({ x: 720, y: 124 });
    camera.apply({ type: "story-target", target: targetBounds });

    const target = camera.worldToScreen({ x: 720, y: 100 });
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.x).toBeLessThanOrEqual(1_440);
    expect(target.y).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThanOrEqual(900);
    expectRectInsideSafeFrame(camera, targetBounds);
    expectSafeFrameInsideWorld(camera, bounds);
  });

  it("keeps viewer zoom stable while bounded Story overscan protects complete boundary actors", () => {
    const bounds = { x: 0, y: 0, width: 2_048, height: 2_048 };
    const safeFrame = { top: 112, right: 20, bottom: 176, left: 20 };
    const targets = [
      feetAnchoredVisualRect({ x: 336, y: 144 }),
      feetAnchoredVisualRect({ x: 336, y: 1_952 }),
      feetAnchoredVisualRect({ x: 80, y: 768 }),
      feetAnchoredVisualRect({ x: 1_968, y: 768 }),
    ] as const;

    for (const target of targets) {
      const camera = createCamera({
        width: 1_440,
        height: 900,
        safeFrame,
        reducedMotion: true,
      });
      camera.setWorldBounds(bounds);
      camera.apply({ type: "story-target", target });

      expectRectInsideSafeFrame(camera, target);
      expectSafeFrameInsideWorld(camera, bounds);
      expect(camera.snapshot().zoom).toBe(1);
    }
  });

  it("never pumps edge zoom and preserves viewer zoom across edge and interior stories", () => {
    const bounds = { x: 0, y: 0, width: 2_048, height: 2_048 };
    const target = feetAnchoredVisualRect({ x: 336, y: 144 });
    const interior = feetAnchoredVisualRect({ x: 1_024, y: 1_048 });
    const camera = createCamera({
      width: 1_440,
      height: 900,
      safeFrame: { top: 112, right: 20, bottom: 176, left: 20 },
      reducedMotion: true,
    });
    camera.setWorldBounds(bounds);
    camera.apply({ type: "story-target", target });
    expect(camera.snapshot().zoom).toBe(1);

    camera.apply({ type: "story-target", target: interior });
    expect(camera.snapshot().zoom).toBe(1);

    camera.apply({ type: "zoom", factor: 2, anchorCss: { x: 720, y: 450 } });
    camera.apply({ type: "story-target", target });
    camera.apply({ type: "story-target", target: interior });
    expect(camera.snapshot().zoom).toBe(2);
  });

  it("keeps a followed boundary actor fully outside persistent chrome", () => {
    const target = feetAnchoredVisualRect({ x: 336, y: 144 });
    const camera = createCamera({
      width: 1_440,
      height: 900,
      safeFrame: { top: 112, right: 20, bottom: 176, left: 20 },
      reducedMotion: true,
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 2_048, height: 2_048 });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", target);

    expectRectInsideSafeFrame(camera, target);
  });

  it("raises zoom to cover bounded worlds and pins only impossible viewports at midpoint", () => {
    const bounds = { x: 0, y: 0, width: 2_048, height: 2_048 };
    const camera = createCamera({
      width: 1_440,
      height: 900,
      initialCenter: { x: 1_024, y: 1_024 },
      reducedMotion: true,
    });
    camera.setWorldBounds(bounds);
    camera.apply({ type: "free-pan", deltaCss: { x: 50_000, y: -50_000 } });
    expectViewportInside(camera, bounds);
    camera.apply({ type: "zoom", factor: 0.5, anchorCss: { x: 0, y: 0 } });
    expect(camera.snapshot().zoom).toBeCloseTo(1_440 / 2_048);
    expectViewportInside(camera, bounds);

    camera.setViewport(5_000, 4_000);
    expect(camera.snapshot().zoom).toBeCloseTo(5_000 / 2_048);
    expectViewportInside(camera, bounds);

    camera.setViewport(10_000, 9_000);
    expect(camera.snapshot().zoom).toBe(MAX_ZOOM);
    expect(camera.snapshot().center).toEqual({ x: 1_024, y: 1_024 });
  });

  it("clamps zoom and preserves the world point below the CSS anchor", () => {
    const camera = createCamera({ width: 512, height: 288, initialCenter: { x: 100, y: 60 } });
    const anchor = { x: 410, y: 80 };
    const anchoredWorld = camera.screenToWorld(anchor);

    camera.apply({ type: "zoom", factor: 100, anchorCss: anchor });
    expect(camera.snapshot().zoom).toBe(MAX_ZOOM);
    expect(camera.worldToScreen(anchoredWorld)).toEqual(anchor);

    camera.apply({ type: "zoom", factor: 0.0001, anchorCss: anchor });
    expect(camera.snapshot().zoom).toBe(MIN_ZOOM);
    expect(camera.worldToScreen(anchoredWorld)).toEqual(anchor);
  });

  it("keeps world/screen transforms reversible while exposing an integer raster origin", () => {
    const camera = createCamera({
      width: 511,
      height: 287,
      initialCenter: { x: 103.25, y: 72.75 },
      initialZoom: 1.35,
    });
    const world = { x: 218.125, y: -17.375 };

    const roundTrip = camera.screenToWorld(camera.worldToScreen(world));
    expect(roundTrip.x).toBeCloseTo(world.x, 10);
    expect(roundTrip.y).toBeCloseTo(world.y, 10);
    expect(Number.isInteger(camera.snapshot().rasterOrigin.x)).toBe(true);
    expect(Number.isInteger(camera.snapshot().rasterOrigin.y)).toBe(true);
  });

  it("uses the same endpoint with and without reduced motion", () => {
    const target = { x: 320, y: 176, width: 32, height: 48 };
    const animated = createCamera({ width: 512, height: 288 });
    const reduced = createCamera({ width: 512, height: 288, reducedMotion: true });

    animated.apply({ type: "story-target", target });
    reduced.apply({ type: "story-target", target });
    expect(animated.snapshot().center).not.toEqual(reduced.snapshot().center);

    animated.update(1_000);
    expect(animated.snapshot().center).toEqual(reduced.snapshot().center);
  });

  it("rejects malformed initial centers and every non-finite intent atomically", () => {
    const malformedInitial = createCamera({
      width: 512,
      height: 288,
      initialCenter: { x: Number.NaN, y: 24 },
    });
    expect(malformedInitial.snapshot().center).toEqual({ x: 0, y: 0 });
    expectFiniteCamera(malformedInitial);

    const malformedRects = [
      { x: Number.NaN, y: 20, width: 32, height: 48 },
      { x: 20, y: Number.POSITIVE_INFINITY, width: 32, height: 48 },
      { x: 20, y: 20, width: Number.NEGATIVE_INFINITY, height: 48 },
      { x: 20, y: 20, width: 32, height: Number.NaN },
    ];
    const camera = createCamera({ width: 512, height: 288 });
    for (const target of malformedRects) {
      const before = camera.snapshot();
      camera.apply({ type: "story-target", target });
      expect(camera.snapshot()).toEqual(before);
      expectFiniteCamera(camera);
    }

    for (const deltaCss of [
      { x: Number.NaN, y: 0 },
      { x: 0, y: Number.NEGATIVE_INFINITY },
    ]) {
      const before = camera.snapshot();
      camera.apply({ type: "free-pan", deltaCss });
      expect(camera.snapshot()).toEqual(before);
      expectFiniteCamera(camera);
    }

    for (const zoom of [
      { factor: Number.NaN, anchorCss: { x: 200, y: 100 } },
      { factor: Number.POSITIVE_INFINITY, anchorCss: { x: 200, y: 100 } },
      { factor: 2, anchorCss: { x: Number.POSITIVE_INFINITY, y: 100 } },
      { factor: 2, anchorCss: { x: 200, y: Number.NaN } },
    ]) {
      const before = camera.snapshot();
      camera.apply({ type: "zoom", ...zoom });
      expect(camera.snapshot()).toEqual(before);
      expectFiniteCamera(camera);
    }
  });

  it("constructs a finite camera when viewport, zoom, or initial insets are malformed", () => {
    const camera = createCamera({
      width: Number.POSITIVE_INFINITY,
      height: Number.NaN,
      initialZoom: Number.NEGATIVE_INFINITY,
      safeFrame: { top: 10, right: Number.NaN, bottom: 30, left: 100 },
    });

    expect(camera.snapshot()).toMatchObject({
      center: { x: 0, y: 0 },
      zoom: 1,
      safeFrame: { x: 0, y: 0, width: 1, height: 1 },
      rasterOrigin: { x: 1, y: 1 },
    });
    const before = camera.snapshot();
    camera.update(Number.NaN);
    expect(camera.snapshot()).toEqual(before);
    expectFiniteCamera(camera);
  });

  it("ignores non-finite entity bounds, viewport dimensions, and insets without partial mutation", () => {
    const camera = createCamera({
      width: 512,
      height: 288,
      safeFrame: { top: 10, right: 20, bottom: 30, left: 100 },
      reducedMotion: true,
    });
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", { x: 240, y: -16, width: 32, height: 32 });

    for (const bounds of [
      { x: Number.NaN, y: -16, width: 32, height: 32 },
      { x: 240, y: Number.POSITIVE_INFINITY, width: 32, height: 32 },
      { x: 240, y: -16, width: Number.NaN, height: 32 },
      { x: 240, y: -16, width: 32, height: Number.NEGATIVE_INFINITY },
    ]) {
      const before = camera.snapshot();
      camera.setEntityBounds("agent_aster", bounds);
      expect(camera.snapshot()).toEqual(before);
      expectFiniteCamera(camera);
    }

    const beforeViewport = camera.snapshot();
    camera.setViewport(Number.NaN, 144);
    expect(camera.snapshot()).toEqual(beforeViewport);
    camera.setViewport(256, Number.POSITIVE_INFINITY);
    expect(camera.snapshot()).toEqual(beforeViewport);

    camera.setSafeFrame({ top: 5, right: Number.NaN, bottom: 7, left: 9 });
    expect(camera.snapshot()).toEqual(beforeViewport);
    expectFiniteCamera(camera);
  });

  it("returns finite fallback transforms for malformed vectors without changing camera state", () => {
    const camera = createCamera({ width: 512, height: 288, initialCenter: { x: 100, y: 60 } });
    const before = camera.snapshot();

    expect(camera.worldToScreen({ x: Number.NaN, y: 20 })).toEqual({ x: 256, y: 144 });
    expect(camera.screenToWorld({ x: 20, y: Number.POSITIVE_INFINITY })).toEqual({ x: 100, y: 60 });
    expect(camera.snapshot()).toEqual(before);
    expectFiniteCamera(camera);
  });

  it("restores requested safe-frame margins after one-pixel and asymmetric resize extremes", () => {
    const requested = { top: 10, right: 20, bottom: 30, left: 100 };
    const camera = createCamera({ width: 512, height: 288, safeFrame: requested });
    expect(camera.snapshot().safeFrame).toEqual({ x: 100, y: 10, width: 392, height: 248 });

    camera.setViewport(1, 1);
    expect(camera.snapshot().safeFrame).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    camera.setViewport(40, 3);
    expect(camera.snapshot().safeFrame).toEqual({ x: 39, y: 2, width: 1, height: 1 });
    camera.setViewport(512, 288);

    expect(camera.snapshot().safeFrame).toEqual({ x: 100, y: 10, width: 392, height: 248 });
  });

  it("eases to a fixed destination independently of timestep partitioning", () => {
    const target = { x: 320, y: 176, width: 32, height: 48 };
    const once = createCamera({ width: 512, height: 288 });
    const twice = createCamera({ width: 512, height: 288 });
    const irregular = createCamera({ width: 512, height: 288 });
    for (const camera of [once, twice, irregular]) camera.apply({ type: "story-target", target });

    once.update(120);
    twice.update(60);
    twice.update(60);
    irregular.update(17);
    irregular.update(31);
    irregular.update(72);

    expect(twice.snapshot().center).toEqual(once.snapshot().center);
    expect(irregular.snapshot().center).toEqual(once.snapshot().center);
  });

  it("restarts one deterministic 240ms segment when the destination changes", () => {
    const first = { x: 120, y: 76, width: 32, height: 48 };
    const second = { x: 360, y: 196, width: 32, height: 48 };
    const once = createCamera({ width: 512, height: 288 });
    const split = createCamera({ width: 512, height: 288 });

    once.apply({ type: "story-target", target: first });
    split.apply({ type: "story-target", target: first });
    once.update(60);
    split.update(30);
    split.update(30);
    once.apply({ type: "story-target", target: second });
    split.apply({ type: "story-target", target: second });
    once.update(120);
    split.update(60);
    split.update(60);
    expect(split.snapshot().center).toEqual(once.snapshot().center);

    once.update(120);
    split.update(40);
    split.update(80);
    expect(split.snapshot().center).toEqual(once.snapshot().center);

    const reduced = createCamera({ width: 512, height: 288, reducedMotion: true });
    reduced.apply({ type: "story-target", target: second });
    expect(once.snapshot().center).toEqual(reduced.snapshot().center);
  });

  it("wraps free-pan centers on both toroidal axes while bounded cameras keep clamping", () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    const toroidal = createCamera({
      width: 20,
      height: 20,
      initialCenter: { x: 95, y: 95 },
      reducedMotion: true,
    });
    toroidal.setWorldBounds(bounds, "toroidal");
    toroidal.apply({ type: "free-pan", deltaCss: { x: -10, y: -20 } });

    expect(toroidal.snapshot()).toMatchObject({
      topology: "toroidal",
      center: { x: 5, y: 15 },
    });

    const bounded = createCamera({
      width: 20,
      height: 20,
      initialCenter: { x: 95, y: 95 },
      reducedMotion: true,
    });
    bounded.setWorldBounds(bounds);
    bounded.apply({ type: "free-pan", deltaCss: { x: -50, y: -50 } });

    expect(bounded.snapshot()).toMatchObject({
      topology: "bounded",
      center: { x: 90, y: 90 },
    });
  });

  it("canonicalizes toroidal screen points and renders the world copy nearest the camera", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
      reducedMotion: true,
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");

    expect(camera.worldToScreen({ x: 5, y: 50 })).toEqual({ x: 30, y: 20 });
    expect(camera.worldToScreen({ x: 205, y: 50 })).toEqual({ x: 30, y: 20 });
    expect(camera.screenToWorld({ x: 30, y: 20 })).toEqual({ x: 5, y: 50 });
    expect(camera.screenToWorld({ x: -10, y: -40 })).toEqual({ x: 65, y: 90 });
  });

  it("eases Story across a toroidal seam using the shortest periodic path", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
    camera.apply({ type: "story-target", target: { x: 4, y: 49, width: 2, height: 2 } });

    camera.update(120);

    expect(camera.snapshot().center.x).toBeCloseTo(0);
    expect(camera.snapshot().center.y).toBeCloseTo(50);
  });

  it("eases Follow across a toroidal seam using the shortest periodic path", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
    camera.apply({ type: "follow", entityId: "agent_aster" });
    camera.setEntityBounds("agent_aster", { x: 19, y: 49, width: 2, height: 2 });

    camera.update(120);

    expect(camera.snapshot().center.x).toBeCloseTo(3.5);
    expect(camera.snapshot().center.y).toBeCloseTo(50);
  });

  it("retains toroidal topology through checkpoints and later growth-bound updates", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
      reducedMotion: true,
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
    camera.apply({ type: "free-pan", deltaCss: { x: -10, y: 0 } });
    const checkpoint = camera.checkpoint();

    const restored = createCamera({ width: 1, height: 1 });
    restored.restore(checkpoint);
    expect(restored.snapshot()).toMatchObject({
      topology: "toroidal",
      center: { x: 5, y: 50 },
    });

    restored.setWorldBounds({ x: 0, y: 0, width: 200, height: 150 });
    restored.apply({ type: "free-pan", deltaCss: { x: -205, y: -155 } });
    expect(restored.snapshot()).toMatchObject({
      topology: "toroidal",
      center: { x: 10, y: 55 },
      worldBounds: { x: 0, y: 0, width: 200, height: 150 },
    });
  });

  it("stays finite when the viewport is larger than a toroidal circumference", () => {
    const camera = createCamera({
      width: 500,
      height: 400,
      initialCenter: { x: 95, y: 75 },
      reducedMotion: true,
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 80 }, "toroidal");
    camera.apply({ type: "free-pan", deltaCss: { x: -37, y: 91 } });
    camera.apply({ type: "zoom", factor: 0.5, anchorCss: { x: 400, y: 300 } });

    expect(camera.snapshot()).toMatchObject({
      topology: "toroidal",
      zoom: MIN_ZOOM,
    });
    expectFiniteCamera(camera);
    const canonical = camera.screenToWorld({ x: 499, y: 399 });
    expect(canonical.x).toBeGreaterThanOrEqual(0);
    expect(canonical.x).toBeLessThan(100);
    expect(canonical.y).toBeGreaterThanOrEqual(0);
    expect(canonical.y).toBeLessThan(80);
  });

  it("rejects malformed bounds atomically without changing active topology", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
      reducedMotion: true,
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
    const before = camera.snapshot();

    camera.setWorldBounds({ x: 0, y: 0, width: Number.NaN, height: 100 }, "bounded");
    expect(camera.snapshot()).toEqual(before);
    camera.setWorldBounds({ x: 0, y: 0, width: -1, height: 100 }, "bounded");
    expect(camera.snapshot()).toEqual(before);
  });

  it("rejects finite toroidal bounds atomically when center normalization overflows", () => {
    const camera = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: Number.MAX_VALUE, y: 50 },
      reducedMotion: true,
    });
    const before = camera.snapshot();

    expect(() => {
      camera.setWorldBounds({
        x: -Number.MAX_VALUE,
        y: 0,
        width: 1,
        height: 100,
      }, "toroidal");
    }).not.toThrow();
    expect(camera.snapshot()).toEqual(before);
  });

  it("restores legacy checkpoints without topology as bounded", () => {
    const source = createCamera({
      width: 40,
      height: 40,
      initialCenter: { x: 95, y: 50 },
      reducedMotion: true,
    });
    source.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
    const { topology: _topology, ...legacyCheckpoint } = source.checkpoint();

    const restored = createCamera({ width: 1, height: 1 });
    restored.restore(legacyCheckpoint);

    expect(restored.snapshot().topology).toBe("bounded");
  });

  describe("region sheet", () => {
    it("derives the world-view minimum zoom and region-view threshold as contain-fit ratios", () => {
      const sheetBounds = { x: 0, y: 0, width: 2_000, height: 1_000 };
      const focusedRect = { x: 0, y: 0, width: 500, height: 500 };

      const { minZoom, lodSnapshotZoom } = deriveSheetZoomBounds(sheetBounds, focusedRect, 800, 600);

      expect(minZoom).toBeCloseTo(Math.min(800 / 2_000, 600 / 1_000));
      expect(lodSnapshotZoom).toBeCloseTo(Math.min(800 / 500, 600 / 500));
      expect(minZoom).toBeLessThan(MIN_ZOOM);
    });

    it("clamps a tiny focused region's threshold at MAX_ZOOM instead of overshooting it", () => {
      const { lodSnapshotZoom } = deriveSheetZoomBounds(
        { x: 0, y: 0, width: 2_000, height: 1_000 },
        { x: 0, y: 0, width: 10, height: 10 },
        800,
        600,
      );
      expect(lodSnapshotZoom).toBe(MAX_ZOOM);
    });

    it("falls back to MIN_ZOOM for degenerate sheet or viewport input", () => {
      const zeroWidthSheet = deriveSheetZoomBounds(
        { x: 0, y: 0, width: 0, height: 1_000 },
        { x: 0, y: 0, width: 500, height: 500 },
        800,
        600,
      );
      expect(zeroWidthSheet.minZoom).toBe(MIN_ZOOM);

      const nonFiniteViewport = deriveSheetZoomBounds(
        { x: 0, y: 0, width: 2_000, height: 1_000 },
        { x: 0, y: 0, width: 500, height: 500 },
        Number.NaN,
        600,
      );
      expect(nonFiniteViewport.minZoom).toBe(MIN_ZOOM);
      expect(nonFiniteViewport.lodSnapshotZoom).toBe(MIN_ZOOM);
    });

    it("clamps free-pan to the whole sheet below threshold and to the focused rect at/above it", () => {
      const sheet = {
        bounds: { x: 0, y: 0, width: 2_000, height: 1_000 },
        focusedRect: { x: 600, y: 0, width: 500, height: 500 },
        lodSnapshotZoom: 1.2,
        minZoom: 0.4,
      };

      const worldView = createCamera({
        width: 200,
        height: 200,
        initialCenter: { x: 100, y: 100 },
        initialZoom: 1,
        reducedMotion: true,
      });
      worldView.setRegionSheet(sheet);
      worldView.apply({ type: "free-pan", deltaCss: { x: -1_000_000, y: -1_000_000 } });
      expectViewportInside(worldView, sheet.bounds);
      // Below threshold the clamp reaches past the focused rect into the rest of the sheet.
      expect(worldView.snapshot().center.x)
        .toBeGreaterThan(sheet.focusedRect.x + sheet.focusedRect.width);

      const regionView = createCamera({
        width: 200,
        height: 200,
        initialCenter: { x: 800, y: 200 },
        initialZoom: 2,
        reducedMotion: true,
      });
      regionView.setRegionSheet(sheet);
      regionView.apply({ type: "free-pan", deltaCss: { x: -1_000_000, y: -1_000_000 } });
      expectViewportInside(regionView, sheet.focusedRect);
    });

    it("never wraps the observer while a region sheet is active, even over toroidal worldBounds", () => {
      const camera = createCamera({
        width: 20,
        height: 20,
        initialCenter: { x: 95, y: 95 },
        reducedMotion: true,
      });
      camera.setWorldBounds({ x: 0, y: 0, width: 100, height: 100 }, "toroidal");
      camera.setRegionSheet({
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        focusedRect: { x: 0, y: 0, width: 100, height: 100 },
        lodSnapshotZoom: 0.01,
        minZoom: 0.01,
      });

      camera.apply({ type: "free-pan", deltaCss: { x: -10, y: -20 } });

      // A toroidal-topology camera with no sheet wraps this exact pan to (5, 15) (see the
      // "wraps free-pan centers..." test above). With a sheet active it clamps to the far edge
      // instead, proving the sheet retires the wrap at the camera layer.
      expect(camera.snapshot().center).toEqual({ x: 90, y: 90 });
    });

    it("allows the world-view floor to go below the single-region MIN_ZOOM", () => {
      const camera = createCamera({ width: 800, height: 600, initialZoom: 1, reducedMotion: true });
      camera.setRegionSheet({
        bounds: { x: 0, y: 0, width: 4_000, height: 4_000 },
        focusedRect: { x: 0, y: 0, width: 1_000, height: 1_000 },
        lodSnapshotZoom: 0.8,
        minZoom: 0.15,
      });

      camera.apply({ type: "zoom", factor: 0.0001, anchorCss: { x: 400, y: 300 } });

      expect(camera.snapshot().zoom).toBeCloseTo(0.15);
      expect(camera.snapshot().zoom).toBeLessThan(MIN_ZOOM);
    });

    it("eases the centre across the world-to-region crossing instead of snapping", () => {
      const sheet = {
        bounds: { x: 0, y: 0, width: 2_000, height: 1_000 },
        focusedRect: { x: 600, y: 0, width: 500, height: 500 },
        lodSnapshotZoom: 1,
        minZoom: 0.4,
      };
      const camera = createCamera({
        width: 200,
        height: 200,
        initialCenter: { x: 300, y: 300 },
        initialZoom: 0.9,
      });
      camera.setRegionSheet(sheet);

      camera.apply({ type: "zoom", factor: 2, anchorCss: { x: 100, y: 100 } });

      expect(camera.snapshot().zoom).toBeCloseTo(1.8);
      // The crossing does not teleport: immediately after, the centre has not yet snapped into
      // the focused rect (that would require an instant ~350px jump).
      expect(camera.isSettled()).toBe(false);
      expect(camera.snapshot().center.x).toBeLessThan(sheet.focusedRect.x);

      camera.update(300);

      expect(camera.isSettled()).toBe(true);
      expectViewportInside(camera, sheet.focusedRect);
    });

    it("crosses back from region to world view without any discontinuity (subset property)", () => {
      const sheet = {
        bounds: { x: 0, y: 0, width: 2_000, height: 1_000 },
        focusedRect: { x: 600, y: 0, width: 500, height: 500 },
        lodSnapshotZoom: 1,
        minZoom: 0.4,
      };
      const camera = createCamera({
        width: 100,
        height: 100,
        initialCenter: { x: 850, y: 250 },
        initialZoom: 1.5,
        reducedMotion: true,
      });
      camera.setRegionSheet(sheet);
      const before = camera.snapshot().center;

      camera.apply({ type: "zoom", factor: 0.5, anchorCss: { x: 50, y: 50 } });

      // The focused rect is always a subset of the sheet bounds, so a centre already valid for
      // the smaller (region) clamp needs no correction under the bigger (sheet) clamp.
      expect(camera.isSettled()).toBe(true);
      expect(camera.snapshot().center).toEqual(before);
    });

    it("rejects a malformed region sheet atomically and leaves prior clamping active", () => {
      const camera = createCamera({
        width: 40,
        height: 40,
        initialCenter: { x: 10, y: 10 },
        reducedMotion: true,
      });
      camera.setRegionSheet({
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        focusedRect: { x: 0, y: 0, width: 50, height: 50 },
        lodSnapshotZoom: 1,
        minZoom: 0.5,
      });
      const before = camera.snapshot();

      camera.setRegionSheet({
        bounds: { x: 0, y: 0, width: Number.NaN, height: 100 },
        focusedRect: { x: 0, y: 0, width: 50, height: 50 },
        lodSnapshotZoom: 1,
        minZoom: 0.5,
      });

      expect(camera.snapshot()).toEqual(before);
    });

    it("reverts to plain world-bounds clamping once the region sheet is cleared", () => {
      const camera = createCamera({
        width: 20,
        height: 20,
        initialCenter: { x: 10, y: 10 },
        reducedMotion: true,
      });
      camera.setWorldBounds({ x: 0, y: 0, width: 40, height: 40 });
      camera.setRegionSheet({
        bounds: { x: 0, y: 0, width: 100, height: 100 },
        focusedRect: { x: 0, y: 0, width: 100, height: 100 },
        lodSnapshotZoom: 0.01,
        minZoom: 0.5,
      });
      camera.apply({ type: "free-pan", deltaCss: { x: -1_000, y: 0 } });
      expect(camera.snapshot().center.x).toBeCloseTo(90);

      camera.setRegionSheet(null);
      camera.apply({ type: "free-pan", deltaCss: { x: -1_000, y: 0 } });
      expect(camera.snapshot().center.x).toBeCloseTo(30);
    });
  });
});
