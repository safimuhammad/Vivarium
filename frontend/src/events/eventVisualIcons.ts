import type { EventVisualIconKey } from "./eventVisualCatalog";

export interface EventVisualIconPath {
  d: string;
}

export interface EventVisualIconDefinition {
  viewBox: "0 0 24 24";
  paths: readonly EventVisualIconPath[];
}

export const FALLBACK_EVENT_VISUAL_ICON_KEY: EventVisualIconKey = "spark";

export const EVENT_VISUAL_ICON_DEFINITIONS = {
  birth: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 21c0-6.2 3.6-10.2 8-11-4.8-.9-8 1.8-8 11Z" },
      { d: "M12 21c0-6.2-3.6-10.2-8-11 4.8-.9 8 1.8 8 11Z" },
      { d: "M12 8V3" },
      { d: "M9.5 5.5h5" },
    ],
  },
  bond: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 19.2 6.2 13.6a3.7 3.7 0 0 1 5.2-5.3l.6.6.6-.6a3.7 3.7 0 0 1 5.2 5.3L12 19.2Z" },
    ],
  },
  breach: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M7 3h10l-2.3 6.2h4.1L9.2 21l2.3-8H7.8L7 3Z" },
      { d: "M9.2 7.2 14 3" },
    ],
  },
  crown: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M5 18h14" },
      { d: "M6 18 5 8l5 4.8L12 6l2 6.8L19 8l-1 10" },
      { d: "M8 21h8" },
    ],
  },
  decay: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 21V9" },
      { d: "M12 15c-3.6-.3-6-2-7-5 3.9-.4 6.4 1.2 7 5Z" },
      { d: "M12 11c3.5-.5 5.8-2.3 6.8-5.3-3.6-.2-6.1 1.5-6.8 5.3Z" },
      { d: "M8.2 20.2c2-1.6 5.6-1.6 7.6 0" },
    ],
  },
  footstep: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M8.2 13.8c-1.2 1.2-1.4 3.7-.2 5 1.1 1.1 3 .5 3.8-.8.8-1.4.4-3.6-.6-4.5-.8-.7-2.1-.6-3 .3Z" },
      { d: "M15.8 5.2c-1.2 1.2-1.4 3.7-.2 5 1.1 1.1 3 .5 3.8-.8.8-1.4.4-3.6-.6-4.5-.8-.7-2.1-.6-3 .3Z" },
    ],
  },
  gift: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M4.5 10h15v10h-15V10Z" },
      { d: "M3.8 7h16.4v3H3.8V7Z" },
      { d: "M12 7v13" },
      { d: "M8.5 7c-1.8 0-3-1-3-2.2S7.2 3 8.3 4.2L12 7" },
      { d: "M15.5 7c1.8 0 3-1 3-2.2S16.8 3 15.7 4.2L12 7" },
    ],
  },
  harvest: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 21V5" },
      { d: "M12 10c-3.4 0-5.5-1.5-6.5-4.4C9 5.2 11.3 6.7 12 10Z" },
      { d: "M12 14c3.4 0 5.5-1.5 6.5-4.4-3.5-.4-5.8 1.1-6.5 4.4Z" },
      { d: "M8 21h8" },
    ],
  },
  hearth: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 17.6c2.6-1.8 3.8-3.9 3.4-6.2-.2-1.5-1-2.8-2.4-4 .1 2.1-.6 3.7-2 4.8-.5-1.2-1.4-2.2-2.6-3-.7 2.1-.6 4 .4 5.6.7 1.1 1.8 2 3.2 2.8Z" },
      { d: "M6 19h12" },
      { d: "M8 21h8" },
    ],
  },
  home: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M4 11.5 12 5l8 6.5" },
      { d: "M6.5 10.2V20h11v-9.8" },
      { d: "M10 20v-5h4v5" },
    ],
  },
  ruin: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M5 20h14" },
      { d: "M7 20V8l3-2 2 2 3-3 2 3v12" },
      { d: "M10 20v-6" },
      { d: "M14 20v-7" },
      { d: "M7 12h10" },
    ],
  },
  skull: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M6.5 10.8C6.5 6.6 8.8 4 12 4s5.5 2.6 5.5 6.8c0 2.6-1 4.4-2.8 5.2v3.2H9.3V16c-1.8-.8-2.8-2.6-2.8-5.2Z" },
      { d: "M9.4 11.2h.1" },
      { d: "M14.5 11.2h.1" },
      { d: "M11 15.2h2" },
      { d: "M10 19.2v-2" },
      { d: "M14 19.2v-2" },
    ],
  },
  spark: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 3 14.2 9.8 21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z" },
      { d: "M19 4v4" },
      { d: "M21 6h-4" },
    ],
  },
  speech: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M5 6.5h14v9H10l-4.2 3.2V15.5H5v-9Z" },
      { d: "M8.5 10h7" },
      { d: "M8.5 12.7h4.8" },
    ],
  },
  theft: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M4.5 12c1.8-3 4.3-4.5 7.5-4.5s5.7 1.5 7.5 4.5c-1.8 3-4.3 4.5-7.5 4.5S6.3 15 4.5 12Z" },
      { d: "M8.2 11.7h2.1" },
      { d: "M13.7 11.7h2.1" },
      { d: "M9.4 16.8 8 20" },
      { d: "M14.6 16.8 16 20" },
    ],
  },
  thought: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M8 14.5a4.2 4.2 0 1 1 1.6-8.1 5 5 0 1 1 5.7 7.8H8Z" },
      { d: "M8.2 18.2h.1" },
      { d: "M5.5 20.7h.1" },
    ],
  },
  wound: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M5.5 18.5 18.5 5.5" },
      { d: "M7.5 8.2 4.8 5.5" },
      { d: "M11 4.8 8.2 2" },
      { d: "M15.8 19.2 13 16.5" },
      { d: "M19.2 15.8 16.5 13" },
      { d: "M9.5 14.5 14.5 9.5" },
    ],
  },
  world: {
    viewBox: "0 0 24 24",
    paths: [
      { d: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" },
      { d: "M3.5 12h17" },
      { d: "M12 3c2.2 2.4 3.3 5.4 3.3 9S14.2 18.6 12 21" },
      { d: "M12 3c-2.2 2.4-3.3 5.4-3.3 9S9.8 18.6 12 21" },
    ],
  },
} as const satisfies Record<EventVisualIconKey, EventVisualIconDefinition>;

export function getEventVisualIconDefinition(
  iconKey: EventVisualIconKey,
): EventVisualIconDefinition {
  return EVENT_VISUAL_ICON_DEFINITIONS[iconKey];
}

export function createEventVisualIconSvgElement(
  iconKey: EventVisualIconKey,
  ownerDocument: Document,
): SVGSVGElement {
  const definition = getEventVisualIconDefinition(iconKey);
  const svg = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", definition.viewBox);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("event-medallion-icon");
  for (const pathDefinition of definition.paths) {
    const path = ownerDocument.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathDefinition.d);
    svg.append(path);
  }
  return svg;
}
