import type {
  ReplayCheckpointOption,
  ReplayMetadata,
} from "./replayMetadata";
import type { ReplaySessionCheckpointSelector } from "./replaySession";

export type ReplayCheckpointIdentityKind = "lineNumber" | "index";

export type ReplayScrubberHiddenReason =
  | "metadata_idle"
  | "metadata_loading"
  | "metadata_error"
  | "not_enough_points";

export interface ReplayScrubberPoint {
  index: number;
  checkpointIndex: number;
  lineNumber: number | null;
  eventCursor: number;
  worldTime: number;
  reason: string;
  runId: string;
  value: string;
  selector: ReplaySessionCheckpointSelector;
  identityKind: ReplayCheckpointIdentityKind;
  identity: string;
  label: string;
  optionLabel: string;
}

export type ReplayScrubberModel =
  | {
      status: "hidden";
      hiddenReason: ReplayScrubberHiddenReason;
      points: [];
    }
  | {
      status: "ready";
      hiddenReason: null;
      points: ReplayScrubberPoint[];
      selectedPoint: ReplayScrubberPoint;
      selectedIndex: number;
      selectedValue: string;
      selectedSelector: ReplaySessionCheckpointSelector;
      pointCount: number;
      min: number;
      max: number;
      step: 1;
      cursorStart: number;
      cursorEnd: number;
      timeStart: number;
      timeEnd: number;
    };

export function buildReplayScrubberModel(
  metadata: ReplayMetadata,
  selectedSelector: ReplaySessionCheckpointSelector | null,
): ReplayScrubberModel {
  if (metadata.status !== "ready") {
    return hidden(`metadata_${metadata.status}` as ReplayScrubberHiddenReason);
  }

  const points = metadata.checkpointOptions
    .map((option, index) => replayScrubberPoint(option, index))
    .filter((point): point is ReplayScrubberPoint => point !== null);

  if (points.length <= 1) {
    return hidden("not_enough_points");
  }

  const selectedValue = selectReplayCheckpointValue(metadata, selectedSelector, points);
  const selectedIndex = Math.max(
    0,
    points.findIndex((point) => point.value === selectedValue),
  );
  const selectedPoint = points[selectedIndex] ?? points[points.length - 1];

  return {
    status: "ready",
    hiddenReason: null,
    points,
    selectedPoint,
    selectedIndex,
    selectedValue: selectedPoint.value,
    selectedSelector: selectedPoint.selector,
    pointCount: points.length,
    min: 0,
    max: points.length - 1,
    step: 1,
    cursorStart: points[0].eventCursor,
    cursorEnd: points[points.length - 1].eventCursor,
    timeStart: points[0].worldTime,
    timeEnd: points[points.length - 1].worldTime,
  };
}

export function replayCheckpointOptionValue(
  option: ReplayCheckpointOption | undefined,
): string | null {
  if (!option) {
    return null;
  }
  return option.lineNumber === null
    ? `index:${option.index}`
    : `line:${option.lineNumber}`;
}

export function replayCheckpointOptionValueFromSelector(
  selector: ReplaySessionCheckpointSelector | null,
): string | null {
  if (!selector) {
    return null;
  }
  if ("lineNumber" in selector) {
    return `line:${selector.lineNumber}`;
  }
  return `index:${selector.index}`;
}

export function replayCheckpointOptionValueFromMetadata(
  metadata: ReplayMetadata,
): string | null {
  const lineNumber = metadata.preview.selectedCheckpointLineNumber;
  if (lineNumber !== null) {
    return `line:${lineNumber}`;
  }
  const index = metadata.preview.selectedCheckpointIndex;
  return index === null ? null : `index:${index}`;
}

export function replayCheckpointSelectorFromValue(
  value: string,
): ReplaySessionCheckpointSelector | null {
  const parts = value.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const [kind, raw] = parts;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return null;
  }
  if (kind === "line" && parsed >= 1) {
    return { lineNumber: parsed };
  }
  if (kind === "index") {
    return { index: parsed };
  }
  return null;
}

export function replayCheckpointOptionLabel(
  option: ReplayCheckpointOption,
): string {
  const point = `${option.eventCursor} @ ${formatReplayPointTime(option.worldTime)}`;
  const identity = option.lineNumber === null
    ? `#${option.index + 1}`
    : `line ${option.lineNumber}`;
  return `${identity} - ${point}`;
}

function replayScrubberPoint(
  option: ReplayCheckpointOption,
  index: number,
): ReplayScrubberPoint | null {
  const value = replayCheckpointOptionValue(option);
  const selector = replayCheckpointSelectorFromValue(value ?? "");
  if (!value || !selector) {
    return null;
  }
  const identityKind: ReplayCheckpointIdentityKind =
    option.lineNumber === null ? "index" : "lineNumber";
  const identity =
    option.lineNumber === null ? String(option.index) : String(option.lineNumber);
  const label = option.lineNumber === null
    ? `point ${option.index + 1}`
    : `line ${option.lineNumber}`;

  return {
    index,
    checkpointIndex: option.index,
    lineNumber: option.lineNumber,
    eventCursor: option.eventCursor,
    worldTime: option.worldTime,
    reason: option.reason,
    runId: option.runId,
    value,
    selector,
    identityKind,
    identity,
    label,
    optionLabel: replayCheckpointOptionLabel(option),
  };
}

function selectReplayCheckpointValue(
  metadata: ReplayMetadata,
  selectedSelector: ReplaySessionCheckpointSelector | null,
  points: readonly ReplayScrubberPoint[],
): string {
  const available = new Set(points.map((point) => point.value));
  const candidates = [
    replayCheckpointOptionValueFromSelector(selectedSelector),
    replayCheckpointOptionValueFromMetadata(metadata),
    points.at(-1)?.value ?? null,
  ];
  return candidates.find((value): value is string => value !== null && available.has(value))
    ?? points[points.length - 1].value;
}

function hidden(hiddenReason: ReplayScrubberHiddenReason): ReplayScrubberModel {
  return {
    status: "hidden",
    hiddenReason,
    points: [],
  };
}

function formatReplayPointTime(value: number): string {
  if (!Number.isFinite(value)) {
    return "unknown";
  }
  return `${value.toFixed(1)}s`;
}
