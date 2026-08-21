/**
 * Pure geometry for docking the QA route's chrome (guided-tour toggle + overlay,
 * validation bar) outside the production world app's box instead of overlaying it.
 *
 * See `chronicleValidation.css`'s `.chronicle-validation-route .vivarium-2d-app`
 * override, which reads the `--qa-top-inset`/`--qa-bottom-inset` custom properties
 * this computes. `ChronicleValidationApp.tsx`'s measurement effect is a thin
 * DOM-reading wrapper around this function (`getBoundingClientRect()` doesn't
 * compute anything jsdom can verify, so the geometry itself lives here,
 * unit-testable with plain numbers — the same split `fitToBounds.ts` uses for the
 * guided tour's camera-fit math).
 */

export interface ChromeInsetInput {
  /** Bottom edge (viewport px) of the always-rendered guided-tour toggle checkbox, or 0 if not found. */
  readonly toggleBottom: number;
  /** Bottom edge (viewport px) of the guided-tour caption overlay, or `null` when the tour isn't active (not rendered). */
  readonly overlayBottom: number | null;
  /** Top edge (viewport px) of the validation bar, or `null` if not found (defensive; it's always rendered). */
  readonly barTop: number | null;
  readonly viewportHeight: number;
  /** Extra breathing room, in px, added beyond a chrome element's own measured edge. */
  readonly gapPx: number;
}

export interface ChromeInsets {
  readonly topInsetPx: number;
  readonly bottomInsetPx: number;
}

/**
 * Computes how much space, in px, the world app must be inset from the top and
 * bottom so none of its own (production) UI renders underneath the QA chrome.
 */
export function computeChromeInsets(input: ChromeInsetInput): ChromeInsets {
  const { toggleBottom, overlayBottom, barTop, viewportHeight, gapPx } = input;
  const topEdge = Math.max(toggleBottom, overlayBottom ?? 0);
  const topInsetPx = topEdge > 0 ? Math.round(topEdge + gapPx) : 0;
  const bottomInsetPx = barTop === null
    ? 0
    : Math.round(Math.max(0, viewportHeight - barTop) + gapPx);
  return Object.freeze({ topInsetPx, bottomInsetPx });
}
