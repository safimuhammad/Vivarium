import type { CSSProperties } from "react";

import { getEventVisualMetadata } from "../../events/eventVisualCatalog";
import {
  FALLBACK_EVENT_VISUAL_ICON_KEY,
  getEventVisualIconDefinition,
} from "../../events/eventVisualIcons";
import type { NarrativeBeat } from "./narrativeBeat";

const FALLBACK_EVENT_ACCENT = "#d6b96f";

interface StoryRibbonProps {
  beats: readonly NarrativeBeat[];
  onChoose(beat: NarrativeBeat): void;
}

type StoryRibbonItemStyle = CSSProperties & {
  "--event-color": string;
};

/** Presents a bounded set of world-story beats without owning playback state. */
export function StoryRibbon({ beats, onChoose }: StoryRibbonProps) {
  if (beats.length === 0) {
    return null;
  }

  return (
    <section
      className="story-ribbon"
      aria-label="World story"
      data-story-beat-count={beats.length}
    >
      <ol className="story-ribbon-list">
        {beats.map((beat) => {
          const metadata = getEventVisualMetadata(beat.type);
          const iconKey = metadata?.iconKey ?? FALLBACK_EVENT_VISUAL_ICON_KEY;
          const icon = getEventVisualIconDefinition(iconKey);
          const style: StoryRibbonItemStyle = {
            "--event-color": metadata?.accent ?? FALLBACK_EVENT_ACCENT,
          };
          return (
            <li
              className={`story-ribbon-item story-ribbon-item-${beat.priority}`}
              key={`${beat.cursorWindow}:${beat.type}`}
              style={style}
            >
              <button
                className="story-ribbon-beat"
                type="button"
                data-event-cursor={beat.cursor}
                data-event-cursor-window={beat.cursorWindow}
                data-event-type={beat.type}
                data-event-group={beat.group}
                data-event-tone={beat.tone}
                data-event-priority={beat.priority}
                data-event-focus-kind={beat.focus?.kind}
                data-event-focus-id={beat.focus?.id}
                aria-label={beat.focus
                  ? `Focus ${beat.label}; open chronicle at event ${beat.cursorWindow}`
                  : `Open chronicle at event ${beat.cursorWindow}: ${beat.label}`}
                onClick={() => onChoose(beat)}
              >
                <span
                  className="event-medallion story-ribbon-medallion"
                  data-event-icon={iconKey}
                  data-event-icon-label={metadata?.iconLabel ?? "Event"}
                  aria-hidden="true"
                >
                  <svg
                    className="event-medallion-icon"
                    viewBox={icon.viewBox}
                    aria-hidden="true"
                    focusable="false"
                  >
                    {icon.paths.map((path, index) => (
                      <path key={`${iconKey}:${index}`} d={path.d} />
                    ))}
                  </svg>
                </span>
                <span className="story-ribbon-copy">
                  <strong className="story-ribbon-label">{beat.label}</strong>
                  <span className="story-ribbon-detail">{beat.detail}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
