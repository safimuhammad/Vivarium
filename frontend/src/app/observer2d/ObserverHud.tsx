import type { ReactNode } from "react";

import type { ObserverHudView } from "./publicViewModels";

export interface ObserverHudProps {
  readonly view: ObserverHudView;
  /**
   * The observer's persistent controls, rendered at the end of the status line.
   *
   * The HUD is the one surface that is always on screen, so it is where a
   * control that must never be hunted for belongs — how the view is framed, and
   * how this run ends. Both were previously either a badge that appeared over
   * the art only once something had gone sideways, or nothing at all. Omitted on
   * every seam that has no run to control (recordings, fixtures, capture), where
   * the HUD stays purely informational.
   */
  readonly controls?: ReactNode;
}

/**
 * Persistent public identity of the place being OBSERVED, plus the world's vital totals.
 *
 * Two scopes share one line, so both are named. The region is the one the viewer is looking at (the
 * viewer owns the camera, so the chrome describes their view, not the story's location — the story's
 * region is named on the Chronicle's leading card). The counts are whole-world totals, which is why
 * they carry their own label: unlabelled beside a region name they read as that region's population.
 */
export function ObserverHud({ view, controls }: ObserverHudProps) {
  return (
    <section className="observer-panel observer-hud" aria-label="World status">
      <strong className="observer-hud__region">{view.regionDisplayName}</strong>
      <span aria-hidden="true"> · </span>
      <span>{view.humanTimeLabel}</span>
      <span aria-hidden="true"> · </span>
      <span className="observer-hud__totals-scope">World totals:</span>
      <span aria-hidden="true"> </span>
      <span>{view.livingAgents} living</span>
      <span aria-hidden="true"> · </span>
      <span>{view.deadAgents} dead</span>
      <span aria-hidden="true"> · </span>
      <span>{view.homes} homes</span>
      <span aria-hidden="true"> · </span>
      <span>{view.ruins} ruins</span>
      {controls === undefined ? null : <span className="observer-hud__controls">{controls}</span>}
    </section>
  );
}
