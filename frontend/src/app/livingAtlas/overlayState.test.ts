import { describe, expect, it } from "vitest";

import {
  livingAtlasOverlayReducer,
  type LivingAtlasOverlayState,
} from "./overlayState";

const closed: LivingAtlasOverlayState = { surface: { kind: "closed" } };

describe("livingAtlasOverlayReducer", () => {
  it("replaces rather than stacks primary surfaces", () => {
    const world = livingAtlasOverlayReducer(closed, {
      type: "open",
      surface: { kind: "world" },
    });
    const chronicle = livingAtlasOverlayReducer(world, {
      type: "open",
      surface: { kind: "chronicle" },
    });

    expect(chronicle.surface).toEqual({ kind: "chronicle" });
  });

  it("opens selection context and closes it with Escape", () => {
    const selected = livingAtlasOverlayReducer(closed, {
      type: "select",
      selection: { kind: "agent", id: "wanderer_001" },
    });

    expect(selected.surface).toEqual({
      kind: "selection",
      selection: { kind: "agent", id: "wanderer_001" },
    });
    expect(livingAtlasOverlayReducer(selected, { type: "close" })).toEqual(closed);
  });

  it("switches archive and live chronicle in one surface slot", () => {
    const archive = livingAtlasOverlayReducer(closed, {
      type: "open",
      surface: { kind: "archive" },
    });

    expect(
      livingAtlasOverlayReducer(archive, {
        type: "open",
        surface: { kind: "chronicle" },
      }).surface.kind,
    ).toBe("chronicle");
  });
});
