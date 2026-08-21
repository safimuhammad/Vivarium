import { describe, expect, it } from "vitest";

import { createShelterActor } from "./ShelterActor";
import {
  shelterComponentOffset,
  shelterFeetY,
  shelterFrameDestination,
  SHELTER_OCCUPIED_HEIGHT,
  SHELTER_OCCUPIED_LAST_ROW,
  shelterOccupiedDestination,
  shelterVisualBounds,
} from "./shelterGeometry";

describe("authoritative shelter geometry", () => {
  it("contains standing, falling, dust, and ruin frame placements in phase-aware bounds", () => {
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    shelter.apply({ type: "settle", phase: "standing" }, 0);
    const standing = shelter.snapshot();
    expect(shelterFrameDestination(standing, { x: 0, y: 0 })).toEqual({ x: 304, y: 16, width: 128, height: 128 });
    expect(SHELTER_OCCUPIED_HEIGHT).toBe(SHELTER_OCCUPIED_LAST_ROW + 1);
    expect(shelterVisualBounds(standing)).toEqual({ x: 276, y: 16, width: 156, height: 123 });
    expect(shelterVisualBounds(standing)!.y + shelterVisualBounds(standing)!.height).toBe(standing.plot.y + 27);
    expect(shelterFeetY(standing)).toBe(112);

    shelter.apply({ type: "collapse", durationMs: 2_400 }, 12_000);
    shelter.advanceTo(14_000);
    const collapsing = shelter.snapshot();
    expect(shelterVisualBounds(collapsing)).toEqual({ x: 278, y: 16, width: 158, height: 128 });
    for (const component of collapsing.components.filter(({ visibility }) => visibility === 1)) {
      const frame = shelterOccupiedDestination(collapsing, shelterComponentOffset(component));
      const bounds = shelterVisualBounds(collapsing)!;
      expect(frame.x).toBeGreaterThanOrEqual(bounds.x);
      expect(frame.y).toBeGreaterThanOrEqual(bounds.y);
      expect(frame.x + frame.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(bounds.y + bounds.height);
    }

    shelter.advanceTo(14_400);
    expect(shelterVisualBounds(shelter.snapshot())).toEqual({ x: 304, y: 16, width: 128, height: 123 });
  });

  it("returns no target for an absent shelter", () => {
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    expect(shelterVisualBounds(shelter.snapshot())).toBeNull();
  });
});
