export interface ReadingHoldFrame {
  readonly scenePhase: string | null;
  readonly readingWitness: ReadingHoldWitness | null;
}

export interface ReadingHoldWitness {
  readonly owner: "vivarium-2d-dialogue-now";
  readonly speakerName: string;
  readonly targetName: string | null;
  readonly direction: "→" | null;
  readonly text: string;
  readonly bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly viewport: Readonly<{ width: number; height: number }>;
}

/** Extract one exact production-scoped DialogueNow owner, or fail closed to no witness. */
export function extractProductionDialogueNowWitness(
  documentRoot: Document,
): ReadingHoldWitness | null {
  const apps = [...documentRoot.querySelectorAll<HTMLElement>(".vivarium-2d-app")];
  const stages = [...documentRoot.querySelectorAll<HTMLElement>(".presentation-world-stage")];
  const panels = [...documentRoot.querySelectorAll<HTMLElement>(".dialogue-now")];
  if (apps.length !== 1 || stages.length !== 1 || panels.length !== 1) return null;
  const app = apps[0]!;
  const stage = stages[0]!;
  const panel = panels[0]!;
  if (!app.contains(stage) || !app.contains(panel)) return null;

  const attributions = panel.querySelectorAll<HTMLElement>(".dialogue-now__attribution");
  const copies = panel.querySelectorAll<HTMLElement>("[data-dialogue-copy]");
  const speakers = panel.querySelectorAll<HTMLElement>("[data-dialogue-speaker]");
  const targets = panel.querySelectorAll<HTMLElement>("[data-dialogue-target]");
  const directions = panel.querySelectorAll<HTMLElement>("[data-dialogue-direction]");
  if (attributions.length !== 1 || copies.length !== 1 || speakers.length !== 1
    || targets.length > 1 || directions.length > 1 || targets.length !== directions.length) {
    return null;
  }
  const speakerName = speakers[0]!.textContent?.trim() ?? "";
  const targetName = targets[0]?.textContent?.trim() ?? null;
  const direction = directions[0]?.textContent?.trim() ?? null;
  const text = copies[0]!.textContent?.trim() ?? "";
  if (speakerName.length === 0 || text.length === 0
    || (targetName !== null && targetName.length === 0)
    || (direction !== null && direction !== "→")) return null;

  const view = documentRoot.defaultView;
  const bounds = panel.getBoundingClientRect();
  const viewport = { width: view?.innerWidth ?? 0, height: view?.innerHeight ?? 0 };
  if (!validBounds(bounds, viewport)) return null;
  return Object.freeze({
    owner: "vivarium-2d-dialogue-now",
    speakerName,
    targetName,
    direction,
    text,
    bounds: Object.freeze({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    }),
    viewport: Object.freeze(viewport),
  });
}

/** Measure a contiguous readable hold using exact recorded-frame ownership. */
export function readingHoldDuration(
  frames: readonly ReadingHoldFrame[],
  markerFrameIndex: number,
  framesPerSecond: number,
): number {
  if (!Number.isSafeInteger(markerFrameIndex)
    || markerFrameIndex < 0
    || markerFrameIndex >= frames.length) {
    throw new RangeError("markerFrameIndex must identify one captured frame");
  }
  if (!Number.isSafeInteger(framesPerSecond) || framesPerSecond <= 0) {
    throw new RangeError("framesPerSecond must be a positive safe integer");
  }
  let contiguousHoldFrames = 0;
  let witnessKey: string | null = null;
  for (let index = markerFrameIndex - 1; index >= 0; index -= 1) {
    const frame = frames[index]!;
    if (frame.scenePhase !== "hold") break;
    const currentKey = validReadingWitnessKey(frame.readingWitness);
    if (currentKey === null || (witnessKey !== null && currentKey !== witnessKey)) return 0;
    witnessKey = currentKey;
    contiguousHoldFrames += 1;
  }
  return witnessKey === null ? 0 : contiguousHoldFrames * 1_000 / framesPerSecond;
}

function validReadingWitnessKey(witness: ReadingHoldWitness | null): string | null {
  if (witness === null || witness.owner !== "vivarium-2d-dialogue-now"
    || witness.speakerName.trim().length === 0 || witness.text.trim().length === 0
    || (witness.targetName === null) !== (witness.direction === null)
    || (witness.targetName !== null && witness.targetName.trim().length === 0)
    || (witness.direction !== null && witness.direction !== "→")
    || !validBounds(witness.bounds, witness.viewport)) return null;
  return JSON.stringify([
    witness.owner,
    witness.speakerName,
    witness.targetName,
    witness.direction,
    witness.text,
    witness.bounds.x,
    witness.bounds.y,
    witness.bounds.width,
    witness.bounds.height,
    witness.viewport.width,
    witness.viewport.height,
  ]);
}

function validBounds(
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>,
  viewport: Readonly<{ width: number; height: number }>,
): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height, viewport.width, viewport.height]
    .every(Number.isFinite)
    && viewport.width > 0
    && viewport.height > 0
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.width > 0
    && bounds.height > 0
    && bounds.x + bounds.width <= viewport.width
    && bounds.y + bounds.height <= viewport.height;
}
