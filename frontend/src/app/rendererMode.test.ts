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

  it("reaches the Living Atlas for the public event-demo source, without naming a renderer", () => {
    expect(parseRendererMode("?source=event-demo")).toBe("living-atlas");
    expect(parseRendererMode("?source=event-demo&scene=tour")).toBe("living-atlas");
  });

  it("lets an explicit renderer win over the event-demo source", () => {
    expect(parseRendererMode("?renderer=2d&source=event-demo")).toBe("2d");
    expect(parseRendererMode("?renderer=2d-slice&source=event-demo")).toBe("2d-slice");
  });

  it("does not mistake an unrelated source value for the demo route", () => {
    expect(parseRendererMode("?source=live-api")).toBe("gateway");
  });
});
