import type { ReactNode } from "react";

import type { ObserverHudView } from "./publicViewModels";
import type { ObserverLivenessView } from "./observerLiveness";

export interface ObserverHudProps {
  readonly view: ObserverHudView;
  readonly liveness?: ObserverLivenessView;
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
export function ObserverHud({ view, controls, liveness }: ObserverHudProps) {
  return (
    <section className="observer-panel observer-hud" aria-label="World status">
      <svg className="observer-hud__mark" viewBox="0 0 32 40" fill="none" aria-hidden="true">
        <path d="M16 37V14M16 27C5 28 2 20 3 14c9 0 13 5 13 13ZM16 20C16 9 22 5 29 6c0 9-5 14-13 14Z" fill="currentColor" />
        <path d="M16 38V14" stroke="currentColor" strokeWidth="2" />
      </svg>
      <span className="observer-hud__place">
        <span className="observer-hud__brand">Vivarium</span>
        <strong className="observer-hud__region">{view.regionDisplayName}</strong>
        <span className="observer-visually-hidden" aria-hidden="true"> · </span>
        <span className="observer-hud__time">{view.humanTimeLabel}</span>
      </span>
      <span className="observer-visually-hidden" aria-hidden="true"> · </span>
      <span className="observer-hud__metrics">
        {liveness !== undefined && <span className="observer-hud__liveness" data-state={liveness.state}
          title={liveness.detail}><i aria-hidden="true" />{liveness.state === "live" ? "World running" : liveness.label}</span>}
        <span className="observer-hud__totals-scope">World totals:</span>
        <span aria-hidden="true"> </span>
        <span className="observer-hud__metric observer-hud__metric--living"><b>{view.livingAgents}</b> living</span>
        <span className="observer-visually-hidden" aria-hidden="true"> · </span>
        <span className="observer-hud__metric"><b>{view.deadAgents}</b> dead</span>
        <span className="observer-visually-hidden" aria-hidden="true"> · </span>
        <span className="observer-hud__metric"><b>{view.homes}</b> homes</span>
        <span className="observer-visually-hidden" aria-hidden="true"> · </span>
        <span className="observer-hud__metric"><b>{view.ruins}</b> ruins</span>
      </span>
      {controls === undefined ? null : <span className="observer-hud__controls">{controls}</span>}
    </section>
  );
}
