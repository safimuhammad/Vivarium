import type {
  EventPresentation,
  EventPresentationGroup,
} from "../eventPresentation";
import type {
  PresentedHistoryEvent,
  PresentedHistoryItem,
} from "../historySelectors";
import {
  getEventVisualMetadata,
  type EventVisualPriority,
} from "../../events/eventVisualCatalog";

export type NarrativeViewport = "desktop" | "mobile";

export type NarrativeFocusTarget =
  | { kind: "home"; id: string }
  | { kind: "agent"; id: string }
  | { kind: "region"; id: string }
  | null;

export interface NarrativeBeat {
  cursor: number;
  cursorWindow: string;
  type: string;
  label: string;
  detail: string;
  group: EventPresentationGroup;
  tone: EventPresentation["tone"];
  priority: EventVisualPriority;
  focus: NarrativeFocusTarget;
  presented: PresentedHistoryEvent;
}

const PRIORITY_RANK: Readonly<Record<EventVisualPriority, number>> = {
  ambient: 0,
  featured: 1,
  drama: 2,
};

const VIEWPORT_LIMIT: Readonly<Record<NarrativeViewport, number>> = {
  desktop: 3,
  mobile: 1,
};

const ATTENTION_WINDOW_SIZE = 24;

/** Resolves the strongest available map focus from structured presentation hints. */
export function focusTargetForBeat(
  presented: Pick<PresentedHistoryEvent, "related">,
): NarrativeFocusTarget {
  const homeId = presented.related.homeIds[0];
  if (homeId) {
    return { kind: "home", id: homeId };
  }
  const agentId = presented.related.agentIds[0];
  if (agentId) {
    return { kind: "agent", id: agentId };
  }
  const regionName = presented.related.regionNames[0];
  return regionName ? { kind: "region", id: regionName } : null;
}

/** Selects a bounded, attention-ranked story ribbon from presented history. */
export function selectStoryRibbonBeats(
  history: readonly PresentedHistoryItem[],
  viewport: NarrativeViewport,
): NarrativeBeat[] {
  return history
    .filter(
      (item): item is PresentedHistoryEvent =>
        item.kind === "event" && item.type !== "self_talk",
    )
    .map(projectNarrativeBeat)
    .sort((left, right) => right.cursor - left.cursor)
    .slice(0, ATTENTION_WINDOW_SIZE)
    .sort(
      (left, right) =>
        PRIORITY_RANK[right.priority] - PRIORITY_RANK[left.priority]
        || right.cursor - left.cursor,
    )
    .slice(0, VIEWPORT_LIMIT[viewport])
    .sort((left, right) => left.cursor - right.cursor);
}

function projectNarrativeBeat(presented: PresentedHistoryEvent): NarrativeBeat {
  return {
    cursor: presented.cursor,
    cursorWindow: presented.chainDetail?.window ?? String(presented.cursor),
    type: presented.type,
    label: presented.label,
    detail: presented.compactDetail?.text ?? presented.detail,
    group: presented.group,
    tone: presented.tone,
    priority: getEventVisualMetadata(presented.type)?.priority ?? "ambient",
    focus: focusTargetForBeat(presented),
    presented,
  };
}
