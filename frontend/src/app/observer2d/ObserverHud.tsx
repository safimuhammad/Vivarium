import type { ObserverHudView } from "./publicViewModels";

export interface ObserverHudProps {
  readonly view: ObserverHudView;
}

/**
 * Persistent public identity of the place being OBSERVED, plus the world's vital totals.
 *
 * Two scopes share one line, so both are named. The region is the one the viewer is looking at (the
 * viewer owns the camera, so the chrome describes their view, not the story's location — the story's
 * region is named in the Now card). The counts are whole-world totals, which is why they carry their
 * own label: unlabelled beside a region name they read as that region's population.
 */
export function ObserverHud({ view }: ObserverHudProps) {
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
    </section>
  );
}
