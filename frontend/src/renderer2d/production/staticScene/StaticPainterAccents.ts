import type { ProductionStaticDrawOperation } from "./ProductionStaticScene";

/** The atlas geometry needed to project a painter-local grounding accent. */
export interface StaticPainterFrameGeometry {
  readonly atlasId: string;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

const MIN_BAND_WIDTH = 12;
const MAX_BAND_HEIGHT = 8;
const BAND_HEIGHT_RATIO = 0.08;
const BAND_WIDTH_RATIO = 0.56;
const RIGHTWARD_OFFSET = 3;
const DOWNWARD_OFFSET = 2;

/**
 * Reuse the frame's foot-adjacent pixels as a small, down-right grounding edge.
 *
 * Region atlases already carry the dark lower edge/talus of their authored objects. A
 * narrow crop of that edge, expanded by a few pixels and shifted toward the shared light
 * direction, gives tall scenery a little separation from the ground without adding an
 * atlas frame or changing the object's measured contact footprint. The returned operation
 * is intended to be sorted immediately before the original operation at the same foot.
 */
export function createGroundingAccentOperation(
  stableId: string,
  frame: StaticPainterFrameGeometry,
  footX: number,
  footY: number,
): ProductionStaticDrawOperation {
  validateInput(stableId, frame, footX, footY);

  const sourceWidth = Math.min(
    frame.rect.width,
    Math.max(MIN_BAND_WIDTH, Math.round(frame.rect.width * BAND_WIDTH_RATIO)),
  );
  const sourceHeight = Math.min(
    frame.rect.height,
    Math.max(2, Math.min(MAX_BAND_HEIGHT, Math.round(frame.rect.height * BAND_HEIGHT_RATIO))),
  );
  const sourceX = frame.rect.x + clamp(
    Math.round(frame.pivot.x - sourceWidth / 2),
    0,
    frame.rect.width - sourceWidth,
  );
  const sourceY = frame.rect.y + clamp(
    Math.round(frame.pivot.y - sourceHeight + 1),
    0,
    frame.rect.height - sourceHeight,
  );
  const destinationWidth = sourceWidth + Math.max(4, Math.round(sourceWidth * 0.08));
  const destinationHeight = Math.max(2, Math.round(sourceHeight * 0.75));

  return {
    stableId,
    layer: "scenery",
    atlasId: frame.atlasId,
    source: {
      x: sourceX,
      y: sourceY,
      width: sourceWidth,
      height: sourceHeight,
    },
    destination: {
      x: Math.round(footX - destinationWidth / 2 + RIGHTWARD_OFFSET),
      y: Math.round(footY - destinationHeight + DOWNWARD_OFFSET),
      width: destinationWidth,
      height: destinationHeight,
    },
    pivotY: Math.round(footY),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function validateInput(
  stableId: string,
  frame: StaticPainterFrameGeometry,
  footX: number,
  footY: number,
): void {
  if (stableId.trim().length === 0) throw new Error("Grounding accent needs a stable ID.");
  if (!frame.atlasId.trim().length) throw new Error("Grounding accent needs an atlas ID.");
  const values = [
    frame.rect.x,
    frame.rect.y,
    frame.rect.width,
    frame.rect.height,
    frame.pivot.x,
    frame.pivot.y,
    footX,
    footY,
  ];
  if (!values.every(Number.isSafeInteger)
    || frame.rect.width <= 0
    || frame.rect.height <= 0
    || frame.pivot.x < 0
    || frame.pivot.y < 0
    || frame.pivot.x > frame.rect.width
    || frame.pivot.y > frame.rect.height) {
    throw new Error(`Grounding accent ${stableId} has invalid frame geometry.`);
  }
}
