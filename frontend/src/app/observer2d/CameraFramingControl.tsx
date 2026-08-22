/**
 * WHO IS FRAMING THE VIEW — stated permanently, in the HUD.
 *
 * This replaces the cream "You are steering the view. / Resume story framing (S)"
 * pill that used to appear over the top-right of the world (owner direction,
 * Safi, asked twice, decided 2026-08-22). Two things are deliberately different
 * from the thing it replaces, and neither is cosmetic:
 *
 * 1. **It is always here.** The pill materialised over the art only once the
 *    viewer had taken the camera, which is exactly when the art is being looked
 *    at closely; and it landed in the same corner the full-height Chronicle now
 *    occupies. This is one short reading on the status line that already says
 *    what the world is doing, present whether or not anything is wrong. A viewer
 *    can learn where the way back lives *before* they need it.
 * 2. **It cannot be dropped on the way to the renderer.** The button is disabled
 *    only while there is genuinely nothing to hand back; when it is live it
 *    drives a serial, not a mode, because a viewer who took the camera by
 *    ZOOMING never changed the mode and every mode-based dedup between the shell
 *    and the renderer swallowed the request. See `resumeStorySerial` in
 *    `PresentationWorldStage`.
 */

import type { JSX } from "react";

import type { CameraMode } from "../../presentation/contracts";

export interface CameraFramingControlProps {
  /** The camera mode the renderer has accepted. */
  readonly mode: CameraMode;
  /** True while the VIEWER holds framing authority (a pan, a zoom, or Free). */
  readonly viewerControlled: boolean;
  /** Ask the director to take the camera back. */
  readonly onResumeStory: () => void;
}

/** How the framing reads, and whether there is anything to return from. */
type Framing = "yours" | "follow" | "story";

function resolveFraming(mode: CameraMode, viewerControlled: boolean): Framing {
  if (viewerControlled) return "yours";
  return mode === "follow" ? "follow" : "story";
}

const WORD: Readonly<Record<Framing, string>> = Object.freeze({
  yours: "Yours",
  follow: "Follow",
  story: "Story",
});

const DESCRIPTION: Readonly<Record<Framing, string>> = Object.freeze({
  yours: "You are steering the view. Press to resume story framing, or press S.",
  follow: "Following one being. Press to resume story framing, or press S.",
  story: "The story is framing the view.",
});

/** The persistent framing reading, and the one press that hands the camera back. */
export function CameraFramingControl({
  mode,
  viewerControlled,
  onResumeStory,
}: CameraFramingControlProps): JSX.Element {
  const framing = resolveFraming(mode, viewerControlled);
  return (
    <button
      type="button"
      className="observer-hud__framing"
      data-framing={framing}
      // Already the director's: there is nothing to return from, and a control
      // that claims otherwise is the same silent lie the pill told.
      disabled={framing === "story"}
      aria-label={`Framing: ${WORD[framing]}. ${DESCRIPTION[framing]}`}
      title={DESCRIPTION[framing]}
      onClick={onResumeStory}
    >
      <span aria-hidden="true">Framing</span>
      <b aria-hidden="true">{WORD[framing]}</b>
    </button>
  );
}
