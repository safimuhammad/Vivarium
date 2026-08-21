import { describe, expect, it } from "vitest";

import { claimObserverRendererSurface } from "./rendererSurfaceOwnership";

describe("renderer surface ownership", () => {
  it("rejects a second renderer kind on one surface before ownership is released", () => {
    const surface = document.createElement("div");
    const production = claimObserverRendererSurface(surface, "canvas-production");

    let conflict: unknown;
    try {
      claimObserverRendererSurface(surface, "three-fallback");
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({
      name: "RendererSurfaceOwnershipError",
      code: "surface-already-owned",
    });

    production.release();
    expect(() => claimObserverRendererSurface(surface, "three-fallback")).not.toThrow();
  });

  it("allows different surfaces to be owned independently", () => {
    const firstSurface = document.createElement("div");
    const secondSurface = document.createElement("div");

    const first = claimObserverRendererSurface(firstSurface, "canvas-production");
    const second = claimObserverRendererSurface(secondSurface, "three-fallback");

    expect(first.kind).toBe("canvas-production");
    expect(second.kind).toBe("three-fallback");
    first.release();
    second.release();
  });

  it("makes release idempotent and prevents an old token from clearing a newer claim", () => {
    const surface = document.createElement("div");
    const old = claimObserverRendererSurface(surface, "three-fallback");
    old.release();

    const current = claimObserverRendererSurface(surface, "canvas-production");
    old.release();
    let conflict: unknown;
    try {
      claimObserverRendererSurface(surface, "three-fallback");
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: "surface-already-owned" });

    current.release();
    current.release();
    const next = claimObserverRendererSurface(surface, "three-fallback");
    expect(next.kind).toBe("three-fallback");
    next.release();
  });
});
