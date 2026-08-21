/** Scheduling seam owned exclusively by the story director. */
export interface PresentationClock {
  now(): number;
  schedule(deadlineMs: number, callback: () => void): () => void;
}

/** Clamps one finite value to an inclusive range. */
export function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new RangeError("clamped value must be finite");
  return Math.min(maximum, Math.max(minimum, value));
}
