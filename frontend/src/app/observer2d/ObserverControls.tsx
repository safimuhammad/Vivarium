/** Shared observer controls, mounted in either the scene dock or an open drawer. */
import type { ReactNode } from "react";
import type { CameraMode } from "../../presentation/contracts";
import type { ObserverLivenessView } from "./observerLiveness";

export interface ObserverControlsProps {
  readonly mode: CameraMode;
  readonly viewerControlled: boolean;
  readonly followAvailable: boolean;
  readonly onAuto: () => void;
  readonly onFollow: () => void;
  readonly onFree: () => void;
  readonly subjectControl: ReactNode;
  readonly transport?: Readonly<{
    paused: boolean;
    liveness: ObserverLivenessView;
    onPause: () => void;
    onResume: () => void;
  }>;
}

/** Keeps camera ownership, chosen subject, and view playback together. */
export function ObserverControls({
  mode, viewerControlled, followAvailable, onAuto, onFollow, onFree,
  subjectControl, transport,
}: ObserverControlsProps) {
  const effectiveMode = viewerControlled ? "free" : mode;
  return <div className="observer-camera-controls">
    {transport !== undefined && <div className="observer-view-controls">
      <span className="observer-control-label">Watching</span>
      <span className="observer-view-state" data-state={transport.paused ? "paused" : transport.liveness.state}
        title={transport.liveness.detail}>
        <i aria-hidden="true" />{transport.paused ? "Paused view" : transport.liveness.label}
      </span>
      <button type="button" onClick={transport.paused ? transport.onResume : transport.onPause}
        title="Pauses the view. The world continues running.">
        {transport.paused ? "Resume view" : "Pause view"}
      </button>
    </div>}
    <div className="observer-camera-modes" role="group" aria-label="Camera mode">
      <span className="observer-control-label">Camera</span>
      <button type="button" className="observer-hud__framing"
        data-framing={viewerControlled ? "yours" : mode}
        aria-pressed={effectiveMode === "story"}
        disabled={effectiveMode === "story"}
        title="Stays with nearby activity and visits important moments elsewhere. Shortcut: S."
        onClick={onAuto}>Auto</button>
      <button type="button" aria-pressed={effectiveMode === "follow"}
        disabled={!followAvailable} onClick={onFollow}
        title="Keep the camera with a being as they move through the world.">Follow</button>
      <button type="button" aria-pressed={effectiveMode === "free"}
        onClick={onFree} title="Pan and zoom freely.">Free</button>
    </div>
    <div className="observer-focus-control">{subjectControl}</div>
  </div>;
}
