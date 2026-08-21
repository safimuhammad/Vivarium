import { describe, expect, it } from "vitest";
import { parseRendererMode } from "./rendererMode";

describe("parseRendererMode", () => {
  it("selects the explicit production and frozen-slice 2d routes", () => {
    expect(parseRendererMode("?renderer=2d-slice")).toBe("2d-slice");
    expect(parseRendererMode("?renderer=2d-slice&scene=walk")).toBe("2d-slice");
    expect(parseRendererMode("?renderer=2d")).toBe("2d");
  });

  it("mounts the way in by default, so nobody lands straight in a live world", () => {
    expect(parseRendererMode("")).toBe("gateway");
    expect(parseRendererMode("?renderer=unknown")).toBe("gateway");
    expect(parseRendererMode("?api=mock")).toBe("gateway");
  });

  it("still reaches the Living Atlas, but only when it is asked for by name", () => {
    expect(parseRendererMode("?renderer=living-atlas")).toBe("living-atlas");
  });
});
