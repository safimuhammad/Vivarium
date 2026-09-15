import { describe, expect, it } from "vitest";

import type { AgentSpatialSnapshot } from "../app/schemas";
import {
  createSpatialPlaybackClock,
  sampleAuthoritativeSpatialMotion,
} from "./spatialMotion";

function traveling(overrides: Partial<AgentSpatialSnapshot> = {}): AgentSpatialSnapshot {
  return {
    version: 1,
    region_id: "nirvana",
    map_id: "nirvana:pilot",
    layout_fingerprint: "pilot",
    x: 0,
    y: 0,
    observed_at: 10,
    at_landmark: null,
    travel: {
      id: "walk-east",
      destination_id: "quiet-spring",
      route: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      started_at: 10,
      arrives_at: 20,
    },
    ...overrides,
  };
}

describe("sampleAuthoritativeSpatialMotion", () => {
  it("interpolates an east-west route from the backend's absolute clock", () => {
    expect(sampleAuthoritativeSpatialMotion(traveling(), 15)).toMatchObject({
      position: { x: 50, y: 0 },
      traveling: true,
      travelId: "walk-east",
    });
  });

  it("holds the actual feet after a stopped travel without inventing another move", () => {
    const stopped = traveling({
      x: 83,
      y: 12,
      observed_at: 16,
      travel: null,
    });

    expect(sampleAuthoritativeSpatialMotion(stopped, 200)).toEqual({
      position: { x: 83, y: 12 },
      traveling: false,
      travelId: null,
    });
  });
});

describe("SpatialPlaybackClock", () => {
  it("freezes on pause, honors speed, and resets a replay to its explicit anchor", () => {
    const clock = createSpatialPlaybackClock({
      anchorAt: 10,
      anchorWallMs: 1_000,
      speed: 1,
      paused: false,
    });

    expect(clock.sample(6_000)).toBe(15);
    clock.setPaused(true, 6_000);
    expect(clock.sample(60_000)).toBe(15);
    clock.setPaused(false, 60_000);
    clock.setSpeed(2, 60_000);
    expect(clock.sample(61_500)).toBe(18);
    clock.reset({ anchorAt: 3, anchorWallMs: 70_000, speed: 0.5, paused: false });
    expect(clock.sample(74_000)).toBe(5);
  });
});
