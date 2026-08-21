import { describe, expect, it } from "vitest";

import {
  INITIAL_OBSERVER_OVERLAY_STATE,
  reduceObserverOverlay,
} from "./overlayState";

describe("observer overlay state", () => {
  it("replaces the one primary surface rather than stacking drawers", () => {
    const world = reduceObserverOverlay(INITIAL_OBSERVER_OVERLAY_STATE, {
      type: "open",
      surface: { kind: "world" },
    });
    const chronicle = reduceObserverOverlay(world, {
      type: "open",
      surface: { kind: "chronicle", momentId: "moment-7" },
    });
    const selection = reduceObserverOverlay(chronicle, {
      type: "open",
      surface: { kind: "selection" },
    });
    const archive = reduceObserverOverlay(selection, {
      type: "open",
      surface: { kind: "archive" },
    });

    expect(world.surface).toEqual({ kind: "world" });
    expect(chronicle.surface).toEqual({ kind: "chronicle", momentId: "moment-7" });
    expect(selection.surface).toEqual({ kind: "selection" });
    expect(archive.surface).toEqual({ kind: "archive" });
    expect(Object.keys(archive)).toEqual(["surface"]);
  });

  it("closes on explicit close or Escape without owning or clearing selection truth", () => {
    const open = reduceObserverOverlay(INITIAL_OBSERVER_OVERLAY_STATE, {
      type: "open",
      surface: { kind: "selection" },
    });

    expect(reduceObserverOverlay(open, { type: "close" })).toBe(
      INITIAL_OBSERVER_OVERLAY_STATE,
    );
    expect(reduceObserverOverlay(open, { type: "escape" })).toBe(
      INITIAL_OBSERVER_OVERLAY_STATE,
    );
    expect("selection" in INITIAL_OBSERVER_OVERLAY_STATE).toBe(false);
  });
});
