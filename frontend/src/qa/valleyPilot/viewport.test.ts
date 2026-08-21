import { describe, expect, it } from "vitest";

import {
  clampCamera,
  clampPan,
  clampZoom,
  initialCamera,
  KEY_PAN_STEP,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  zoomAroundPoint,
  type Camera,
  type SceneSize,
  type ViewportSize,
} from "./viewport";

const scene: SceneSize = { width: 1536, height: 1024 };

describe("clampZoom", () => {
  it("passes through a value inside the supported range", () => {
    expect(clampZoom(2)).toBe(2);
  });

  it("floors to the minimum zoom", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(-4)).toBe(MIN_ZOOM);
  });

  it("ceils to the maximum zoom", () => {
    expect(clampZoom(500)).toBe(MAX_ZOOM);
  });

  it("floors non-finite input to the minimum zoom", () => {
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MIN_ZOOM);
  });
});

describe("clampPan", () => {
  it("centers the scene on both axes when the viewport is larger than the scaled scene", () => {
    const viewport: ViewportSize = { width: 1800, height: 1300 };
    const pan = clampPan({ x: 999, y: -999 }, 1, scene, viewport);
    expect(pan.x).toBeCloseTo((1800 - 1536) / 2);
    expect(pan.y).toBeCloseTo((1300 - 1024) / 2);
  });

  it("restricts pan to [viewport - scaledScene, 0] when the scene is larger than the viewport", () => {
    const viewport: ViewportSize = { width: 800, height: 600 };
    const withinRange = clampPan({ x: -100, y: -50 }, 1, scene, viewport);
    expect(withinRange).toEqual({ x: -100, y: -50 });

    const tooFarRight = clampPan({ x: 500, y: 500 }, 1, scene, viewport);
    expect(tooFarRight).toEqual({ x: 0, y: 0 });

    const minX = viewport.width - scene.width;
    const minY = viewport.height - scene.height;
    const tooFarLeft = clampPan({ x: -5000, y: -5000 }, 1, scene, viewport);
    expect(tooFarLeft).toEqual({ x: minX, y: minY });
  });

  it("scales the clamp bounds with zoom", () => {
    const viewport: ViewportSize = { width: 800, height: 600 };
    const zoom = 2;
    const minX = viewport.width - scene.width * zoom;
    const pan = clampPan({ x: -100000, y: 0 }, zoom, scene, viewport);
    expect(pan.x).toBe(minX);
  });
});

describe("clampCamera", () => {
  it("clamps zoom first, then re-clamps pan against the resulting (not the requested) scale", () => {
    const viewport: ViewportSize = { width: 800, height: 600 };
    const camera = clampCamera({ zoom: 999, pan: { x: -100_000, y: -100_000 } }, scene, viewport);
    expect(camera.zoom).toBe(MAX_ZOOM);
    const minX = viewport.width - scene.width * MAX_ZOOM;
    const minY = viewport.height - scene.height * MAX_ZOOM;
    expect(camera.pan.x).toBe(minX);
    expect(camera.pan.y).toBe(minY);
  });
});

describe("initialCamera", () => {
  it("starts at native scale, centered, when the viewport comfortably fits the scene", () => {
    const viewport: ViewportSize = { width: 1900, height: 1200 };
    const camera = initialCamera(scene, viewport);
    expect(camera.zoom).toBe(1);
    expect(camera.pan.x).toBeCloseTo((1900 - 1536) / 2);
    expect(camera.pan.y).toBeCloseTo((1200 - 1024) / 2);
  });

  it("starts at native scale, top-left, when the viewport is smaller than the scene", () => {
    const viewport: ViewportSize = { width: 900, height: 700 };
    const camera = initialCamera(scene, viewport);
    expect(camera).toEqual({ zoom: 1, pan: { x: 0, y: 0 } });
  });
});

describe("panBy", () => {
  it("adds a screen-pixel delta and clamps at the scene edge", () => {
    const viewport: ViewportSize = { width: 900, height: 700 };
    const start: Camera = { zoom: 1, pan: { x: 0, y: 0 } };
    const moved = panBy(start, { x: -KEY_PAN_STEP, y: 0 }, scene, viewport);
    expect(moved.pan.x).toBe(-KEY_PAN_STEP);

    const minX = viewport.width - scene.width;
    const draggedPastEdge = panBy(start, { x: 100_000, y: 0 }, scene, viewport);
    expect(draggedPastEdge.pan.x).toBe(0);
    const draggedPastOtherEdge = panBy(start, { x: -100_000, y: 0 }, scene, viewport);
    expect(draggedPastOtherEdge.pan.x).toBe(minX);
  });
});

describe("zoomAroundPoint", () => {
  it("keeps the world point under the focal point fixed on screen", () => {
    const viewport: ViewportSize = { width: 900, height: 700 };
    const camera: Camera = { zoom: 1, pan: { x: -200, y: -100 } };
    const focal: { x: number; y: number } = { x: 300, y: 250 };
    const worldXBefore = (focal.x - camera.pan.x) / camera.zoom;
    const worldYBefore = (focal.y - camera.pan.y) / camera.zoom;

    const zoomed = zoomAroundPoint(camera, 2, focal, scene, viewport);

    const worldXAfter = (focal.x - zoomed.pan.x) / zoomed.zoom;
    const worldYAfter = (focal.y - zoomed.pan.y) / zoomed.zoom;
    expect(zoomed.zoom).toBe(2);
    expect(worldXAfter).toBeCloseTo(worldXBefore, 6);
    expect(worldYAfter).toBeCloseTo(worldYBefore, 6);
  });

  it("returns the same camera instance when the requested zoom does not change", () => {
    const viewport: ViewportSize = { width: 900, height: 700 };
    const camera: Camera = { zoom: 1, pan: { x: 0, y: 0 } };
    expect(zoomAroundPoint(camera, 1, { x: 10, y: 10 }, scene, viewport)).toBe(camera);
  });

  it("clamps the requested zoom before comparing and applying it", () => {
    const viewport: ViewportSize = { width: 900, height: 700 };
    const camera: Camera = { zoom: MAX_ZOOM, pan: { x: 0, y: 0 } };
    expect(zoomAroundPoint(camera, 999, { x: 10, y: 10 }, scene, viewport)).toBe(camera);
  });
});
