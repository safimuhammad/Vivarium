import { describe, expect, it } from "vitest";

import { createCamera } from "../camera/Camera2D";
import type { HitTarget } from "./hitTest";
import { hitTest } from "./hitTest";

const camera = createCamera({
  width: 512,
  height: 288,
  initialCenter: { x: 100, y: 100 },
});

describe("hitTest", () => {
  it("expands a small sprite target to at least 44x44 CSS pixels", () => {
    const target: HitTarget = {
      selection: { kind: "agent", id: "agent_aster" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({ pointCss: { x: 235, y: 144 }, targets: [target], camera })).toEqual(target.selection);
  });

  it("does not mutate the sprite's world collision footprint while expanding its hit region", () => {
    const target: HitTarget = {
      selection: { kind: "home", id: "home_aster" },
      worldBounds: { x: 88, y: 90, width: 24, height: 20 },
    };
    const originalBounds = { ...target.worldBounds };

    hitTest({ pointCss: { x: 256, y: 144 }, targets: [target], camera });

    expect(target.worldBounds).toEqual(originalBounds);
  });

  it("selects the overlapping target with the greatest feet Y", () => {
    const front: HitTarget = {
      selection: { kind: "agent", id: "agent_front" },
      worldBounds: { x: 92, y: 92, width: 16, height: 24 },
      feetY: 116,
    };
    const back: HitTarget = {
      selection: { kind: "agent", id: "agent_back" },
      worldBounds: { x: 92, y: 96, width: 16, height: 16 },
      feetY: 112,
    };

    expect(hitTest({ pointCss: { x: 256, y: 150 }, targets: [back, front], camera })).toEqual(front.selection);
  });

  it("breaks equal-feet overlap ties with the stable selection key", () => {
    const zeta: HitTarget = {
      selection: { kind: "agent", id: "zeta" },
      worldBounds: { x: 92, y: 92, width: 16, height: 24 },
      feetY: 116,
    };
    const alpha: HitTarget = {
      selection: { kind: "home", id: "alpha" },
      worldBounds: { x: 92, y: 92, width: 16, height: 24 },
      feetY: 116,
    };

    expect(hitTest({ pointCss: { x: 256, y: 150 }, targets: [zeta, alpha], camera })).toEqual(alpha.selection);
    expect(hitTest({ pointCss: { x: 256, y: 150 }, targets: [alpha, zeta], camera })).toEqual(alpha.selection);
  });

  it("uses the canonical selection key when explicit overlap keys collide", () => {
    const zeta: HitTarget = {
      selection: { kind: "agent", id: "zeta" },
      worldBounds: { x: 92, y: 92, width: 16, height: 24 },
      feetY: 116,
      selectionKey: "shared",
    };
    const alpha: HitTarget = {
      selection: { kind: "home", id: "alpha" },
      worldBounds: { x: 92, y: 92, width: 16, height: 24 },
      feetY: 116,
      selectionKey: "shared",
    };

    expect(hitTest({ pointCss: { x: 256, y: 150 }, targets: [zeta, alpha], camera })).toEqual(alpha.selection);
  });

  it("accounts for integer CSS scale and canvas offset", () => {
    const target: HitTarget = {
      selection: { kind: "region", id: "nirvana" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({
      pointCss: { x: 534, y: 310 },
      targets: [target],
      camera,
      cssScale: 2,
      canvasOffsetCss: { x: 20, y: 22 },
    })).toEqual(target.selection);
  });

  it("returns null outside every expanded target", () => {
    const target: HitTarget = {
      selection: { kind: "agent", id: "agent_aster" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({ pointCss: { x: 200, y: 144 }, targets: [target], camera })).toBeNull();
  });

  it("rejects non-finite pointer coordinates and target bounds", () => {
    const malformed: HitTarget = {
      selection: { kind: "agent", id: "poison" },
      worldBounds: { x: Number.NaN, y: 95, width: 10, height: 10 },
    };
    const valid: HitTarget = {
      selection: { kind: "agent", id: "agent_aster" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({ pointCss: { x: Number.NaN, y: 144 }, targets: [valid], camera })).toBeNull();
    expect(hitTest({ pointCss: { x: 256, y: 144 }, targets: [malformed, valid], camera })).toEqual(valid.selection);
  });

  it("safely ignores a malformed canvas offset instead of producing poisoned bounds", () => {
    const target: HitTarget = {
      selection: { kind: "home", id: "home_aster" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({
      pointCss: { x: 256, y: 144 },
      targets: [target],
      camera,
      canvasOffsetCss: { x: Number.POSITIVE_INFINITY, y: 0 },
    })).toEqual(target.selection);
  });

  it("drops targets when a camera projection is non-finite", () => {
    const target: HitTarget = {
      selection: { kind: "region", id: "nirvana" },
      worldBounds: { x: 95, y: 95, width: 10, height: 10 },
    };

    expect(hitTest({
      pointCss: { x: 256, y: 144 },
      targets: [target],
      camera: { worldToScreen: () => ({ x: Number.NaN, y: Number.POSITIVE_INFINITY }) },
    })).toBeNull();
  });
});
