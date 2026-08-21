import { describe, expect, it, vi } from "vitest";

import { createCacheCanvasOwner } from "./CacheCanvasOwner";

describe("CacheCanvasOwner", () => {
  it.each(["terrain", "scenery", "continuation-matte"] as const)(
    "clears, zero-sizes, and releases one %s cache exactly once",
    (label) => {
      const clearRect = vi.fn();
      const context = {
        clearRect,
        imageSmoothingEnabled: true,
      } as unknown as CanvasRenderingContext2D;
      const canvas = {
        width: 0,
        height: 0,
        dataset: {},
        getContext: vi.fn(() => context),
      } as unknown as HTMLCanvasElement;
      const release = vi.fn();

      const owner = createCacheCanvasOwner({
        label,
        width: 320,
        height: 192,
        createCanvas: () => canvas,
        release,
      });

      expect(owner.canvas).toBe(canvas);
      expect(owner.context).toBe(context);
      expect(canvas.width).toBe(320);
      expect(canvas.height).toBe(192);
      expect(canvas.dataset.cache).toBe(label);
      expect(context.imageSmoothingEnabled).toBe(false);

      owner.dispose();
      owner.dispose();

      expect(clearRect).toHaveBeenCalledOnce();
      expect(clearRect).toHaveBeenCalledWith(0, 0, 320, 192);
      expect(canvas.width).toBe(0);
      expect(canvas.height).toBe(0);
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it("releases a context-less candidate after zero-sizing it", () => {
    const canvas = {
      width: 0,
      height: 0,
      dataset: {},
      getContext: vi.fn(() => null),
    } as unknown as HTMLCanvasElement;
    const release = vi.fn();

    expect(() => createCacheCanvasOwner({
      label: "scenery",
      width: 64,
      height: 64,
      createCanvas: () => canvas,
      release,
    })).toThrow(/context/i);

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(release).toHaveBeenCalledOnce();
  });
});
