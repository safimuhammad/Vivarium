import { describe, expect, it, vi } from "vitest";

import type { ObserverRendererPort } from "./rendererPort";
import { createGuardedObserverRendererPort } from "./rendererPort";

describe("createGuardedObserverRendererPort observer requests", () => {
  it("forwards configured region observation while active and remains inert after one disposal", () => {
    const delegate = makePort();
    const guarded = createGuardedObserverRendererPort(delegate);

    guarded.observeRegion("spring");
    guarded.dispose();
    guarded.observeRegion("worn");
    guarded.dispose();

    expect(delegate.observeRegion).toHaveBeenCalledOnce();
    expect(delegate.observeRegion).toHaveBeenCalledWith("spring");
    expect(delegate.dispose).toHaveBeenCalledOnce();
  });
});

function makePort(): ObserverRendererPort {
  return {
    updatePresentation: vi.fn(),
    setSelection: vi.fn(),
    focusSelection: vi.fn(),
    observeRegion: vi.fn(),
    setSafeFrame: vi.fn(),
    setCameraMode: vi.fn(),
    panCamera: vi.fn(),
    zoomCamera: vi.fn(),
    resize: vi.fn(),
    diagnostics: vi.fn(() => ({
      disposed: false,
      frameIdentity: null,
      drawP95Ms: 0,
      scheduledFrame: false,
      activeActors: 0,
      activeHomes: 0,
      activeEffects: 0,
      staticLayerRebuilds: 0,
      assetBytes: 0,
      decodedAssetBytes: 0,
      pathFallbacks: 0,
    })),
    dispose: vi.fn(),
  };
}
