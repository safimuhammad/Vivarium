import { describe, expect, it } from "vitest";

import { createCamera, deriveSheetZoomBounds, MAX_ZOOM } from "./Camera2D";
import type { CameraRegionSheet } from "./Camera2D";

/**
 * World-view navigation: the sheet SCOPE latch (a viewer inside a region cannot be zoomed out of
 * it), the `fly-to` descent/ascent, and local-frame rebasing on a region switch.
 */

/**
 * A 400x300 viewport over a 4000x2000 sheet whose focused plot is 800x300 — deliberately a
 * DIFFERENT aspect from the viewport, so the contain fit (`lodSnapshotZoom` 0.5) and the cover fit
 * (`coverZoom` 1.0) are different numbers. The band between them is exactly where a viewer used to
 * be "inside" a region with its neighbours on screen.
 */
const SHEET: CameraRegionSheet = {
  bounds: { x: 0, y: 0, width: 4_000, height: 2_000 },
  focusedRect: { x: 1_000, y: 500, width: 800, height: 300 },
  lodSnapshotZoom: 0.5,
  minZoom: 0.1,
  coverZoom: 1,
};

function sheetCamera(zoom: number, center = { x: 1_400, y: 650 }): ReturnType<typeof createCamera> {
  const camera = createCamera({
    width: 400,
    height: 300,
    initialCenter: center,
    initialZoom: zoom,
    reducedMotion: true,
  });
  camera.setRegionSheet(SHEET);
  return camera;
}

describe("sheet scope latch", () => {
  it("derives cover zoom as the axis maximum, above the contain-fit threshold", () => {
    const bounds = deriveSheetZoomBounds(
      { x: 0, y: 0, width: 4_000, height: 2_000 },
      { x: 0, y: 0, width: 800, height: 300 },
      400,
      300,
    );
    expect(bounds.lodSnapshotZoom).toBeCloseTo(Math.min(400 / 800, 300 / 300), 10);
    expect(bounds.coverZoom).toBeCloseTo(Math.max(400 / 800, 300 / 300), 10);
    expect(bounds.coverZoom).toBeGreaterThan(bounds.lodSnapshotZoom);
  });

  it("floors zoom at the region's COVER zoom inside a region, so no gesture reveals a neighbour", () => {
    const camera = sheetCamera(1.5);
    camera.setSheetScope("region");

    for (let index = 0; index < 40; index += 1) {
      camera.apply({ type: "zoom", factor: 0.8, anchorCss: { x: 200, y: 150 } });
    }

    expect(camera.snapshot().zoom).toBeCloseTo(SHEET.coverZoom as number, 10);
    expect(camera.minimumZoom()).toBeCloseTo(SHEET.coverZoom as number, 10);
  });

  it("never lets the viewport leave the focused region while region scope is latched", () => {
    const camera = sheetCamera(1.5);
    camera.setSheetScope("region");
    // The gesture that used to eject: zoom out hard, then try to pan away.
    for (let index = 0; index < 40; index += 1) {
      camera.apply({ type: "zoom", factor: 0.8, anchorCss: { x: 200, y: 150 } });
    }
    camera.apply({ type: "free-pan", deltaCss: { x: -1_000_000, y: -1_000_000 } });

    const { center, zoom } = camera.snapshot();
    const halfWidth = 400 / (2 * zoom);
    const halfHeight = 300 / (2 * zoom);
    expect(center.x - halfWidth).toBeGreaterThanOrEqual(SHEET.focusedRect.x - 1e-6);
    expect(center.x + halfWidth).toBeLessThanOrEqual(
      SHEET.focusedRect.x + SHEET.focusedRect.width + 1e-6,
    );
    expect(center.y - halfHeight).toBeGreaterThanOrEqual(SHEET.focusedRect.y - 1e-6);
    expect(center.y + halfHeight).toBeLessThanOrEqual(
      SHEET.focusedRect.y + SHEET.focusedRect.height + 1e-6,
    );
  });

  it("keeps the clamp on the whole sheet at ANY zoom while world scope is latched", () => {
    const camera = sheetCamera(1.5);
    camera.setSheetScope("world");
    // Well above the old threshold, where the clamp used to collapse onto the focused rect.
    camera.apply({ type: "free-pan", deltaCss: { x: -1_000_000, y: -1_000_000 } });

    expect(camera.snapshot().center.x)
      .toBeGreaterThan(SHEET.focusedRect.x + SHEET.focusedRect.width);
    expect(camera.minimumZoom()).toBeCloseTo(SHEET.minZoom, 10);
  });

  it("lifts a zoom already below the floor when region scope is entered", () => {
    const camera = sheetCamera(1);
    camera.setSheetScope("world");
    camera.apply({ type: "zoom", factor: 0.8, anchorCss: { x: 200, y: 150 } });
    expect(camera.snapshot().zoom).toBeLessThan(SHEET.coverZoom as number);

    camera.setSheetScope("region");

    expect(camera.snapshot().zoom).toBeCloseTo(SHEET.coverZoom as number, 10);
  });

  it("leaves the pre-existing zoom-derived regime alone under the default auto scope", () => {
    const camera = sheetCamera(1);
    // Four notches below the contain threshold (0.5): auto scope reverts to the world regime and
    // roams the whole sheet, exactly as it did before this change.
    for (let index = 0; index < 4; index += 1) {
      camera.apply({ type: "zoom", factor: 0.8, anchorCss: { x: 200, y: 150 } });
    }
    expect(camera.snapshot().zoom).toBeLessThan(SHEET.lodSnapshotZoom);
    camera.apply({ type: "free-pan", deltaCss: { x: -1_000_000, y: -1_000_000 } });

    expect(camera.snapshot().center.x)
      .toBeGreaterThan(SHEET.focusedRect.x + SHEET.focusedRect.width);
    expect(camera.minimumZoom()).toBeCloseTo(SHEET.minZoom, 10);
  });

  it("rejects a malformed scope and a non-positive cover zoom", () => {
    const camera = sheetCamera(1);
    camera.setSheetScope("sideways" as "auto");
    expect(camera.minimumZoom()).toBeCloseTo(SHEET.minZoom, 10);

    const before = camera.snapshot();
    camera.setRegionSheet({ ...SHEET, coverZoom: 0 });
    expect(camera.snapshot()).toEqual(before);
  });
});

describe("fly-to (descent and ascent)", () => {
  function flyingCamera(reducedMotion = false): ReturnType<typeof createCamera> {
    const camera = createCamera({
      width: 400,
      height: 300,
      initialCenter: { x: 200, y: 200 },
      initialZoom: 0.5,
      reducedMotion,
    });
    // World scope first, so installing the sheet does not clamp the start point into the focused
    // region: this camera starts out over the open sheet, which is where a descent starts.
    camera.setSheetScope("world");
    camera.setRegionSheet(SHEET);
    return camera;
  }

  it("eases centre and zoom together and lands exactly on the destination", () => {
    const camera = flyingCamera();
    const from = camera.snapshot().center;
    expect(from).toEqual({ x: 400, y: 300 });
    camera.apply({
      type: "fly-to",
      center: { x: 1_400, y: 650 },
      zoom: 1,
      durationMs: 900,
    });

    camera.update(450);
    const midway = camera.snapshot();
    expect(midway.zoom).toBeGreaterThan(0.5);
    expect(midway.zoom).toBeLessThan(1);
    expect(midway.center.x).toBeGreaterThan(from.x);
    expect(midway.center.x).toBeLessThan(1_400);
    expect(camera.isSettled()).toBe(false);
    // The precise flag: true while THIS fly-to is actually still in the air.
    expect(midway.flying).toBe(true);

    camera.update(450);
    const arrived = camera.snapshot();
    expect(arrived.zoom).toBeCloseTo(1, 10);
    expect(arrived.center).toEqual({ x: 1_400, y: 650 });
    expect(camera.isSettled()).toBe(true);
    expect(arrived.flying).toBe(false);
  });

  it("is obeyed while the viewer holds framing authority (it IS the viewer's own request)", () => {
    const camera = flyingCamera();
    camera.setViewerControl(true);
    camera.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 100 });
    camera.update(100);

    expect(camera.snapshot().center).toEqual({ x: 1_400, y: 650 });
    expect(camera.snapshot().zoom).toBeCloseTo(1, 10);
    expect(camera.snapshot().viewerControlled).toBe(true);
  });

  it("snaps instead of easing under reduced motion", () => {
    const camera = flyingCamera(true);

    camera.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 900 });

    expect(camera.snapshot().center).toEqual({ x: 1_400, y: 650 });
    expect(camera.snapshot().zoom).toBeCloseTo(1, 10);
    expect(camera.isSettled()).toBe(true);
  });

  it("yields to a viewer pan or zoom mid-flight", () => {
    const panned = flyingCamera();
    panned.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 900 });
    panned.update(300);
    const interruptedAt = panned.snapshot().center.x;
    panned.apply({ type: "free-pan", deltaCss: { x: 0, y: 0 } });
    panned.update(600);
    expect(panned.snapshot().center.x).toBeCloseTo(interruptedAt, 6);

    const zoomed = flyingCamera();
    zoomed.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 900 });
    zoomed.update(300);
    zoomed.apply({ type: "zoom", factor: 1, anchorCss: { x: 200, y: 150 } });
    const heldZoom = zoomed.snapshot().zoom;
    zoomed.update(600);
    expect(zoomed.snapshot().zoom).toBeCloseTo(heldZoom, 10);
  });

  it("is cancelled by an explicit hand-back to the director", () => {
    const camera = flyingCamera();
    camera.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 900 });
    camera.update(300);
    const interrupted = camera.snapshot().center;
    camera.apply({ type: "return-story" });
    camera.update(600);
    expect(camera.snapshot().center).toEqual(interrupted);
  });

  it("ignores a malformed flight", () => {
    const camera = flyingCamera();
    const before = camera.snapshot();
    camera.apply({ type: "fly-to", center: { x: Number.NaN, y: 0 }, zoom: 1, durationMs: 500 });
    camera.apply({ type: "fly-to", center: { x: 10, y: 10 }, zoom: 0, durationMs: 500 });
    expect(camera.snapshot()).toEqual(before);
  });

  it("clamps a flight's destination zoom into the camera's own bounds", () => {
    const camera = flyingCamera();
    camera.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 99, durationMs: 0 });
    expect(camera.snapshot().zoom).toBe(MAX_ZOOM);
  });
});

describe("rebaseLocalFrame", () => {
  it("keeps the viewer looking at the same sheet point when the local frame moves", () => {
    const camera = sheetCamera(1, { x: 1_400, y: 650 });
    camera.setSheetScope("world");
    // The observed region moved 600px right / 200px down on the sheet, so the same world point is
    // now 600/200 further LEFT/UP in local coordinates.
    camera.rebaseLocalFrame({ x: -600, y: -200 });

    expect(camera.snapshot().center).toEqual({ x: 800, y: 450 });
  });

  it("carries an in-flight descent into the new frame", () => {
    const camera = createCamera({
      width: 400,
      height: 300,
      initialCenter: { x: 200, y: 200 },
      initialZoom: 0.5,
    });
    camera.setSheetScope("world");
    camera.setRegionSheet(SHEET);
    camera.apply({ type: "fly-to", center: { x: 1_400, y: 650 }, zoom: 1, durationMs: 900 });
    camera.rebaseLocalFrame({ x: -600, y: -200 });
    camera.update(900);

    expect(camera.snapshot().center).toEqual({ x: 800, y: 450 });
  });

  it("ignores a zero or malformed shift", () => {
    const camera = sheetCamera(1);
    const before = camera.snapshot();
    camera.rebaseLocalFrame({ x: 0, y: 0 });
    camera.rebaseLocalFrame({ x: Number.NaN, y: 1 });
    expect(camera.snapshot()).toEqual(before);
  });
});
