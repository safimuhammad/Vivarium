import {
  CHRONICLE_IDS,
  type ChronicleId,
  type ChronicleManifest,
} from "../presentation/fixtures/chronicleCatalog";
import { reviewCuesFor } from "./chronicleReviewCues";

export type ChroniclePlaybackSpeed = 0.5 | 1 | 1.5 | 2;

export interface AuthoredReviewCue {
  readonly key: string;
  readonly label: string;
  readonly instruction: string;
  readonly kind: "event" | "checkpoint";
  readonly cursor: number;
  readonly presentedTime: number;
}

export interface ChronicleReviewManifest {
  readonly id: ChronicleId;
  readonly slug: string;
  readonly expectedFinalCursor: number;
  readonly authorityKind: string;
  readonly markers: readonly AuthoredReviewCue[];
}

export interface ChronicleValidationQuery {
  readonly renderer: "2d";
  readonly chronicleId: ChronicleId;
}

export const CHRONICLE_FAILURE_MAX_TIME = 4_102_444_800 as const;

const CHRONICLE_ID_SET = new Set<string>(CHRONICLE_IDS);
const PLAYBACK_SPEEDS = new Set<number>([0.5, 1, 1.5, 2]);

/** Parses the closed development-route query contract. */
export function parseChronicleValidationQuery(search: string): ChronicleValidationQuery {
  const parameters = new URLSearchParams(search);
  const keys = [...parameters.keys()];
  if (keys.length !== 2 || keys[0] !== "renderer" || keys[1] !== "chronicle") {
    throw new Error("Chronicle QA requires exactly renderer=2d and one chronicle=C00-C19");
  }
  const rendererValues = parameters.getAll("renderer");
  const chronicleValues = parameters.getAll("chronicle");
  const renderer = rendererValues[0];
  const chronicleId = chronicleValues[0];
  if (
    rendererValues.length !== 1
    || chronicleValues.length !== 1
    || renderer !== "2d"
    || chronicleId === undefined
    || !/^C(?:0[0-9]|1[0-9])$/.test(chronicleId)
    || !CHRONICLE_ID_SET.has(chronicleId)
  ) {
    throw new Error("Chronicle QA accepts only renderer=2d and chronicle=C00-C19");
  }
  return Object.freeze({ renderer: "2d", chronicleId: chronicleId as ChronicleId });
}

/** Projects validated, exact fixture-bound human review cuts. */
export function projectChronicleReviewManifest(
  manifest: ChronicleManifest,
  cues: readonly AuthoredReviewCue[] = defaultCues(manifest.id),
): ChronicleReviewManifest {
  if (cues.length < 1 || cues.length > 5) {
    throw new Error("Chronicle review cues must contain one to five authored cuts");
  }
  const keys = new Set<string>();
  const labels = new Set<string>();
  const cursors = new Set<number>();
  let previous: AuthoredReviewCue | null = null;
  const markers = cues.map((cue) => {
    if (cue.key.trim() === "" || cue.label.trim() === "" || cue.instruction.trim() === "") {
      throw new Error("Chronicle review cue text must not be blank");
    }
    if (keys.has(cue.key) || labels.has(cue.label) || cursors.has(cue.cursor)) {
      throw new Error("Chronicle review cues require unique key, label, and cursor cuts");
    }
    if (!Number.isSafeInteger(cue.cursor) || cue.cursor < 0) {
      throw new Error("Chronicle review cue cursor must be a non-negative safe integer");
    }
    const authoritative = cue.kind === "event"
      ? manifest.entries.some((entry) => (
          entry.cursor === cue.cursor && entry.event.timestamp === cue.presentedTime
        ))
      : manifest.checkpoints.some((record) => (
          record.checkpoint.event_cursor === cue.cursor
          && record.checkpoint.world_time === cue.presentedTime
        ));
    if (!authoritative) {
      throw new Error("Chronicle review cue kind, cursor, and timestamp need exact fixture authority");
    }
    if (previous !== null && (
      cue.cursor < previous.cursor
      || cue.cursor === previous.cursor && cue.presentedTime < previous.presentedTime
    )) {
      throw new Error("Chronicle review cues must remain in chronological order");
    }
    keys.add(cue.key);
    labels.add(cue.label);
    cursors.add(cue.cursor);
    previous = cue;
    return Object.freeze({ ...cue });
  });
  return Object.freeze({
    id: manifest.id,
    slug: manifest.slug,
    expectedFinalCursor: manifest.expectedFinalCursor,
    authorityKind: manifest.expectedTerminal.presentationAuthority.kind,
    markers: Object.freeze(markers),
  });
}

/** Creates a deterministic privacy-safe failure token from allow-listed fields. */
export function createChronicleFailureToken(input: Readonly<{
  chronicleId: ChronicleId;
  cursor: number;
  presentedTime: number;
  speed: ChroniclePlaybackSpeed;
  viewport: Readonly<{ width: number; height: number }>;
}>): string {
  if (!CHRONICLE_ID_SET.has(input.chronicleId) || !/^C(?:0[0-9]|1[0-9])$/.test(input.chronicleId)) {
    throw new Error("Chronicle failure token id must be C00-C19 without delimiters");
  }
  if (!Number.isSafeInteger(input.cursor) || input.cursor < 0) {
    throw new Error("Chronicle failure token cursor must be a non-negative safe integer");
  }
  if (
    !Number.isFinite(input.presentedTime)
    || Object.is(input.presentedTime, -0)
    || input.presentedTime < 0
    || input.presentedTime > CHRONICLE_FAILURE_MAX_TIME
  ) {
    throw new Error("Chronicle failure token time is outside the safe range");
  }
  if (!PLAYBACK_SPEEDS.has(input.speed)) {
    throw new Error("Chronicle failure token speed is unsupported");
  }
  for (const [name, value] of Object.entries(input.viewport)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`Chronicle failure token viewport ${name} must be a positive safe integer`);
    }
  }
  return `VQA1|${input.chronicleId}|cursor=${input.cursor}|time=${input.presentedTime}`
    + `|speed=${input.speed}|viewport=${input.viewport.width}x${input.viewport.height}`;
}

function defaultCues(id: ChronicleId): readonly AuthoredReviewCue[] {
  return reviewCuesFor(id);
}
