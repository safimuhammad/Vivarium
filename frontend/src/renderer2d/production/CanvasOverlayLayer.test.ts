import { describe, expect, it, vi } from "vitest";
import { prepareOverlayCanvas } from "./CanvasOverlayLayer";

describe("display-resolution bubble canvas", () => {
  it("keeps CSS geometry while allocating physical pixels and clearing old messages", () => {
    const view = { devicePixelRatio: 2 };
    const context = { setTransform: vi.fn(), clearRect: vi.fn() };
    const canvas = {
      width: 300, height: 150, style: { width: "", height: "" },
      ownerDocument: { defaultView: view }, getContext: () => context,
    } as unknown as HTMLCanvasElement;
    const target = prepareOverlayCanvas(canvas, 801, 601)!;
    expect([canvas.width, canvas.height]).toEqual([1602, 1202]);
    expect([canvas.style.width, canvas.style.height]).toEqual(["801px", "601px"]);
    expect(target).toEqual({ context, pixelRatio: 2 });
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1602, 1202);

    // Moving between displays must redraw existing text at the new density.
    view.devicePixelRatio = 1.5;
    expect(prepareOverlayCanvas(canvas, 801, 601)?.pixelRatio).toBe(1.5);
    expect([canvas.width, canvas.height]).toEqual([1202, 902]);
    expect(context.setTransform).toHaveBeenLastCalledWith(1, 0, 0, 1, 0, 0);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 1202, 902);
  });

  it("retains the main-canvas fallback for non-browser renderers", () => {
    expect(prepareOverlayCanvas(undefined, 800, 600)).toBeUndefined();
  });
});
