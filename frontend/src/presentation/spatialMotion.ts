/**
 * Sampling of backend-authoritative spatial movement.
 *
 * This module never plans, bends, truncates, or otherwise improves a route. It
 * turns the coordinates and absolute route clock published by the world into a
 * point the renderer can draw at the current presentation-playback time.
 */

import type { AgentSpatialSnapshot, SpatialPoint } from "../app/schemas";

export interface AuthoritativeSpatialMotionSample {
  readonly position: SpatialPoint;
  readonly traveling: boolean;
  readonly travelId: string | null;
}

export interface SpatialPlaybackClockAnchor {
  /** Simulation-clock seconds at this browser-clock anchor. */
  readonly anchorAt: number;
  /** Presentation clock milliseconds at which `anchorAt` was observed. */
  readonly anchorWallMs: number;
  readonly speed: number;
  readonly paused: boolean;
}

export interface SpatialPlaybackClock {
  /** Sample the simulation clock at a presentation-clock millisecond. */
  sample(wallNowMs: number): number;
  /** Freeze or resume without allowing elapsed paused wall time into the route clock. */
  setPaused(paused: boolean, wallNowMs: number): void;
  /** Change speed while retaining the current sampled simulation time. */
  setSpeed(speed: number, wallNowMs: number): void;
  /** Start a new live run or archive replay from its explicitly recorded anchor. */
  reset(anchor: SpatialPlaybackClockAnchor): void;
  snapshot(): Readonly<SpatialPlaybackClockAnchor>;
}

/**
 * Sample a recorded route at an explicit simulation time.
 *
 * Routes have no per-waypoint timestamps, so their recorded absolute interval
 * is apportioned by actual route length. A stopped or degenerate route stays
 * exactly on backend-reported feet; it never becomes a renderer move command.
 */
export function sampleAuthoritativeSpatialMotion(
  spatial: AgentSpatialSnapshot,
  at: number,
): AuthoritativeSpatialMotionSample {
  assertFinite(at, "spatial sample time");
  const travel = spatial.travel;
  if (travel === null) {
    return Object.freeze({
      position: point(spatial.x, spatial.y),
      traveling: false,
      travelId: null,
    });
  }
  if (at <= travel.started_at) {
    return Object.freeze({
      position: copyPoint(travel.route[0]!),
      traveling: true,
      travelId: travel.id,
    });
  }
  if (at >= travel.arrives_at) {
    return Object.freeze({
      position: copyPoint(travel.route.at(-1)!),
      traveling: false,
      travelId: travel.id,
    });
  }
  const duration = travel.arrives_at - travel.started_at;
  if (duration <= 0 || travel.route.length === 1) {
    return Object.freeze({
      position: copyPoint(travel.route.at(-1)!),
      traveling: true,
      travelId: travel.id,
    });
  }
  const totalLength = routeLength(travel.route);
  if (totalLength <= 0) {
    return Object.freeze({
      position: copyPoint(travel.route.at(-1)!),
      traveling: true,
      travelId: travel.id,
    });
  }
  const distance = totalLength * ((at - travel.started_at) / duration);
  return Object.freeze({
    position: pointAtDistance(travel.route, distance),
    traveling: true,
    travelId: travel.id,
  });
}

/** Construct a replay-aware wall-to-simulation clock with no checkpoint dependency. */
export function createSpatialPlaybackClock(
  initial: SpatialPlaybackClockAnchor,
): SpatialPlaybackClock {
  let anchor = validateAnchor(initial);

  const currentAt = (wallNowMs: number): number => {
    assertFinite(wallNowMs, "spatial playback wall time");
    if (anchor.paused) return anchor.anchorAt;
    return anchor.anchorAt + Math.max(0, wallNowMs - anchor.anchorWallMs) * anchor.speed / 1_000;
  };

  const reanchor = (
    patch: Pick<SpatialPlaybackClockAnchor, "speed" | "paused">,
    wallNowMs: number,
  ): void => {
    const at = currentAt(wallNowMs);
    anchor = validateAnchor({
      anchorAt: at,
      anchorWallMs: wallNowMs,
      speed: patch.speed,
      paused: patch.paused,
    });
  };

  return Object.freeze({
    sample: currentAt,
    setPaused(paused: boolean, wallNowMs: number): void {
      if (typeof paused !== "boolean") throw new TypeError("spatial playback paused must be boolean");
      if (paused === anchor.paused) return;
      reanchor({ speed: anchor.speed, paused }, wallNowMs);
    },
    setSpeed(speed: number, wallNowMs: number): void {
      assertSpeed(speed);
      if (speed === anchor.speed) return;
      reanchor({ speed, paused: anchor.paused }, wallNowMs);
    },
    reset(next: SpatialPlaybackClockAnchor): void {
      anchor = validateAnchor(next);
    },
    snapshot(): Readonly<SpatialPlaybackClockAnchor> {
      return Object.freeze({ ...anchor });
    },
  });
}

function routeLength(route: readonly SpatialPoint[]): number {
  let total = 0;
  for (let index = 1; index < route.length; index += 1) {
    total += distance(route[index - 1]!, route[index]!);
  }
  return total;
}

function pointAtDistance(route: readonly SpatialPoint[], requested: number): SpatialPoint {
  let remaining = Math.max(0, requested);
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1]!;
    const to = route[index]!;
    const length = distance(from, to);
    if (length === 0) continue;
    if (remaining <= length) {
      const progress = remaining / length;
      return point(
        from.x + (to.x - from.x) * progress,
        from.y + (to.y - from.y) * progress,
      );
    }
    remaining -= length;
  }
  return copyPoint(route.at(-1)!);
}

function distance(left: SpatialPoint, right: SpatialPoint): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function point(x: number, y: number): SpatialPoint {
  return Object.freeze({ x, y });
}

function copyPoint(value: SpatialPoint): SpatialPoint {
  return point(value.x, value.y);
}

function validateAnchor(value: SpatialPlaybackClockAnchor): SpatialPlaybackClockAnchor {
  assertFinite(value.anchorAt, "spatial playback anchorAt");
  assertFinite(value.anchorWallMs, "spatial playback anchorWallMs");
  assertSpeed(value.speed);
  if (typeof value.paused !== "boolean") throw new TypeError("spatial playback paused must be boolean");
  return Object.freeze({ ...value });
}

function assertSpeed(value: number): void {
  assertFinite(value, "spatial playback speed");
  if (value <= 0) throw new RangeError("spatial playback speed must be positive");
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
