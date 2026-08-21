export interface WorldPanGesture {
  readonly kind: "pan";
  readonly deltaCss: Readonly<{ x: number; y: number }>;
}

export interface WorldZoomGesture {
  readonly kind: "zoom";
  readonly factor: number;
  readonly anchorCss: Readonly<{ x: number; y: number }>;
}

export interface WheelNavigationInput {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly anchorCss: Readonly<{ x: number; y: number }>;
}

/**
 * How far a pointer may travel before a press stops being a CLICK and becomes a drag-pan, in CSS
 * px. Zero tolerance is what made click-to-descend impossible: a trackpad press moves a pixel or
 * two, so every intended click was a one-pixel pan and no click gesture existed at all.
 */
export const DRAG_DEAD_ZONE_CSS = 4;

/**
 * How long a press may last and still count as a click. A press held for longer than this is a
 * deliberate grab, even if the pointer never moved, and must not descend into a region on release.
 */
export const CLICK_MAX_DURATION_MS = 600;

export interface PointerPressSample {
  /** Total distance travelled from the press point, in CSS px. */
  readonly travelledCss: number;
  /** How long the press has been held, in ms. */
  readonly heldMs: number;
  /** Whether the press ever exceeded the dead zone (i.e. a pan actually started). */
  readonly dragged: boolean;
}

/** Whether a completed pointer press should be treated as a click rather than a drag. */
export function isClickGesture(sample: PointerPressSample): boolean {
  if (sample.dragged) return false;
  if (!Number.isFinite(sample.travelledCss) || !Number.isFinite(sample.heldMs)) return false;
  return sample.travelledCss <= DRAG_DEAD_ZONE_CSS && sample.heldMs <= CLICK_MAX_DURATION_MS;
}

const DEFAULT_ARROW_STEP_CSS = 32;
const WHEEL_LINE_CSS = 16;
const MIN_ZOOM_FACTOR = 0.8;
const MAX_ZOOM_FACTOR = 1.25;
const ZOOM_SENSITIVITY = 0.002;

/** Translate an arrow key into Camera2D's grabbed-content pan convention. */
export function arrowPanDelta(
  key: string,
  step = DEFAULT_ARROW_STEP_CSS,
): WorldPanGesture | null {
  if (!Number.isFinite(step) || step <= 0) return null;
  const deltaCss = key === "ArrowRight" ? { x: -step, y: 0 }
    : key === "ArrowLeft" ? { x: step, y: 0 }
      : key === "ArrowUp" ? { x: 0, y: step }
        : key === "ArrowDown" ? { x: 0, y: -step }
          : null;
  return deltaCss === null ? null : { kind: "pan", deltaCss };
}

/** Translate browser wheel units into bounded pan or anchored pinch-zoom intent. */
export function wheelNavigationIntent(
  input: Readonly<WheelNavigationInput>,
): WorldPanGesture | WorldZoomGesture | null {
  if (!validWheelInput(input)) return null;
  const units = wheelUnits(input);
  if (units === null) return null;
  const normalizedX = input.deltaX * units.x;
  const normalizedY = input.deltaY * units.y;

  if (input.ctrlKey) {
    if (normalizedY === 0) return null;
    return {
      kind: "zoom",
      factor: clamp(
        Math.exp(-normalizedY * ZOOM_SENSITIVITY),
        MIN_ZOOM_FACTOR,
        MAX_ZOOM_FACTOR,
      ),
      anchorCss: { ...input.anchorCss },
    };
  }
  const cappedX = clamp(normalizedX, -input.viewportWidth, input.viewportWidth);
  const cappedY = clamp(normalizedY, -input.viewportHeight, input.viewportHeight);
  if (cappedX === 0 && cappedY === 0) return null;
  return {
    kind: "pan",
    deltaCss: { x: -cappedX, y: -cappedY },
  };
}

function validWheelInput(input: Readonly<WheelNavigationInput>): boolean {
  return Number.isFinite(input.deltaX)
    && Number.isFinite(input.deltaY)
    && Number.isFinite(input.viewportWidth)
    && input.viewportWidth > 0
    && Number.isFinite(input.viewportHeight)
    && input.viewportHeight > 0
    && Number.isFinite(input.anchorCss.x)
    && Number.isFinite(input.anchorCss.y);
}

function wheelUnits(
  input: Readonly<WheelNavigationInput>,
): Readonly<{ x: number; y: number }> | null {
  if (input.deltaMode === WheelEvent.DOM_DELTA_PIXEL) return { x: 1, y: 1 };
  if (input.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: WHEEL_LINE_CSS, y: WHEEL_LINE_CSS };
  }
  if (input.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: input.viewportWidth, y: input.viewportHeight };
  }
  return null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
