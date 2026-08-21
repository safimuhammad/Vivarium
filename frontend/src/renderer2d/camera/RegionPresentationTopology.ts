/** Presentation topology supported by one logical region viewport. */
export type RegionPresentationTopology = "bounded" | "toroidal";

function assertPeriodicInterval(value: number, origin: number, extent: number): void {
  if (
    !Number.isFinite(value)
    || !Number.isFinite(origin)
    || !Number.isFinite(extent)
    || extent <= 0
    || !Number.isFinite(origin + extent)
  ) {
    throw new RangeError("Periodic coordinates require finite values and a positive finite extent.");
  }
}

/** Normalizes a coordinate into the half-open interval `[origin, origin + extent)`. */
export function wrapCoordinate(value: number, origin: number, extent: number): number {
  assertPeriodicInterval(value, origin, extent);
  const wrapped = origin + (((value - origin) % extent) + extent) % extent;
  if (!Number.isFinite(wrapped)) {
    throw new RangeError("Periodic coordinate normalization produced a non-finite result.");
  }
  return wrapped;
}

/** Returns the periodic copy of `value` nearest to `reference`. */
export function nearestPeriodicCoordinate(
  value: number,
  reference: number,
  origin: number,
  extent: number,
): number {
  assertPeriodicInterval(value, origin, extent);
  if (!Number.isFinite(reference)) {
    throw new RangeError("Periodic coordinate references must be finite.");
  }
  const wrapped = wrapCoordinate(value, origin, extent);
  const nearest = wrapped + Math.round((reference - wrapped) / extent) * extent;
  if (!Number.isFinite(nearest)) {
    throw new RangeError("Nearest periodic coordinate produced a non-finite result.");
  }
  return nearest;
}
