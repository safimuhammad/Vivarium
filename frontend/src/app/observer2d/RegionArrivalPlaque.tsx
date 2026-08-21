import { useEffect, useState, type ReactElement } from "react";

const PLAQUE_DURATION_MS = 1_800;

export interface RegionArrivalPlaqueProps {
  readonly regionName: string;
  readonly reducedMotion: boolean;
}

/** Announces and briefly presents the public name of the observed region. */
export function RegionArrivalPlaque({
  regionName,
  reducedMotion,
}: RegionArrivalPlaqueProps): ReactElement {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    setVisible(true);
    const timeout = window.setTimeout(() => setVisible(false), PLAQUE_DURATION_MS);
    return () => window.clearTimeout(timeout);
  }, [regionName]);

  return (
    <div className="region-arrival-plaque" data-region-arrival
      data-reduced-motion={reducedMotion ? "true" : "false"}
      aria-live="polite" aria-atomic="true">
      <span className="observer-visually-hidden">{visible ? `Entered ${regionName}` : ""}</span>
      {visible && <strong aria-hidden="true">{regionName.toLocaleUpperCase("en-US")}</strong>}
    </div>
  );
}
