import type { FrameRect } from "./spriteManifest";

/** Native shelter-atlas cells in reviewed row-major order. */
export const SHELTER_ATLAS_CELL_IDS = [
  "foundation",
  "post",
  "wall-intact",
  "roof-intact",
  "roof-falling",
  "door-closed",
  "door-open",
  "window",
  "hearth",
  "chimney",
  "smoke",
  "wall-cracked",
  "wall-broken",
  "wall-falling",
  "dust",
  "door-falling",
  "rubble-full",
  "rubble-picked-over",
  "rubble-nearly-bare",
  "empty",
] as const;

export type ShelterAtlasCellId = (typeof SHELTER_ATLAS_CELL_IDS)[number];
export type ShelterLogicalComponentId = "foundation" | "posts" | "walls" | "roof" | "door" | "hearth";
export type ShelterRuinTier = "full" | "picked-over" | "nearly-bare";

export interface ShelterAtlasCell {
  readonly id: ShelterAtlasCellId;
  readonly rect: FrameRect;
}

export interface ShelterComponentVisualMapping {
  readonly standing: ShelterAtlasCellId;
  readonly damaged: ShelterAtlasCellId;
  readonly falling: ShelterAtlasCellId;
}

export interface ShelterRuinVisualMapping {
  readonly frame: ShelterAtlasCellId;
  readonly composition: readonly ShelterAtlasCellId[];
}

/** Complete renderer contract for the native shelter component atlas. */
export interface ShelterVisualManifest {
  readonly id: string;
  readonly atlasId: "shelter";
  readonly cellWidth: 128;
  readonly cellHeight: 128;
  readonly columns: 5;
  readonly rows: 4;
  readonly frames: readonly ShelterAtlasCell[];
  readonly components: Readonly<Record<ShelterLogicalComponentId, ShelterComponentVisualMapping>>;
  readonly doorOpen: ShelterAtlasCellId;
  readonly accents: Readonly<{
    window: ShelterAtlasCellId;
    hearth: ShelterAtlasCellId;
    chimney: ShelterAtlasCellId;
    smoke: ShelterAtlasCellId;
    dust: ShelterAtlasCellId;
  }>;
  readonly damage: Readonly<{ wallCracked: ShelterAtlasCellId; wallBroken: ShelterAtlasCellId }>;
  readonly ruins: Readonly<Record<ShelterRuinTier, ShelterRuinVisualMapping>>;
  readonly empty: ShelterAtlasCellId;
}

const CELL_SIZE = 128;
const COLUMNS = 5;
const ROWS = 4;
const ATLAS_WIDTH = CELL_SIZE * COLUMNS;
const ATLAS_HEIGHT = CELL_SIZE * ROWS;

const EXPECTED_COMPONENTS = {
  foundation: { standing: "foundation", damaged: "foundation", falling: "foundation" },
  posts: { standing: "post", damaged: "post", falling: "post" },
  walls: { standing: "wall-intact", damaged: "wall-broken", falling: "wall-falling" },
  roof: { standing: "roof-intact", damaged: "roof-falling", falling: "roof-falling" },
  door: { standing: "door-closed", damaged: "door-falling", falling: "door-falling" },
  hearth: { standing: "hearth", damaged: "hearth", falling: "hearth" },
} as const satisfies Readonly<Record<ShelterLogicalComponentId, ShelterComponentVisualMapping>>;

const EXPECTED_ACCENTS = {
  window: "window",
  hearth: "hearth",
  chimney: "chimney",
  smoke: "smoke",
  dust: "dust",
} as const;

const EXPECTED_RUINS = {
  full: { frame: "rubble-full", composition: ["rubble-full"] },
  "picked-over": { frame: "rubble-picked-over", composition: ["rubble-picked-over"] },
  "nearly-bare": { frame: "rubble-nearly-bare", composition: ["rubble-nearly-bare"] },
} as const satisfies Readonly<Record<ShelterRuinTier, ShelterRuinVisualMapping>>;

const frames = SHELTER_ATLAS_CELL_IDS.map((id, index): ShelterAtlasCell => ({
  id,
  rect: {
    x: (index % COLUMNS) * CELL_SIZE,
    y: Math.floor(index / COLUMNS) * CELL_SIZE,
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
}));

/** Canonical reviewed mapping for `shelter-slice-atlas.png`. */
export const DEMO_SHELTER_MANIFEST: ShelterVisualManifest = {
  id: "vivarium-shelter-slice-v1",
  atlasId: "shelter",
  cellWidth: CELL_SIZE,
  cellHeight: CELL_SIZE,
  columns: COLUMNS,
  rows: ROWS,
  frames,
  components: EXPECTED_COMPONENTS,
  doorOpen: "door-open",
  accents: EXPECTED_ACCENTS,
  damage: { wallCracked: "wall-cracked", wallBroken: "wall-broken" },
  ruins: EXPECTED_RUINS,
  empty: "empty",
};

const finiteInteger = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value);

function sameArray(actual: readonly ShelterAtlasCellId[] | undefined, expected: readonly ShelterAtlasCellId[]): boolean {
  return actual !== undefined && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

/** Validates native atlas geometry and every semantic shelter mapping. */
export function validateShelterVisualManifest(manifest: ShelterVisualManifest): readonly string[] {
  const errors: string[] = [];
  if (!manifest.id) errors.push("shelter manifest id must not be empty");
  if (manifest.atlasId !== "shelter") errors.push("shelter manifest must use the shelter atlas");
  if (manifest.cellWidth !== CELL_SIZE || manifest.cellHeight !== CELL_SIZE) errors.push("shelter cells must be native 128x128");
  if (manifest.columns !== COLUMNS || manifest.rows !== ROWS) errors.push("shelter atlas must be an exact 5x4 grid");
  if (manifest.frames.length !== SHELTER_ATLAS_CELL_IDS.length) errors.push("shelter manifest must declare all 20 native cells");

  const seenIds = new Set<string>();
  const seenRects = new Set<string>();
  const knownIds = new Set<string>();
  manifest.frames.forEach((frame, index) => {
    const { rect } = frame;
    if (seenIds.has(frame.id)) errors.push(`${frame.id}: duplicate shelter frame id`);
    seenIds.add(frame.id);
    knownIds.add(frame.id);
    const rectKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (seenRects.has(rectKey)) errors.push(`${frame.id}: duplicate shelter frame rectangle`);
    seenRects.add(rectKey);
    if (![rect.x, rect.y, rect.width, rect.height].every(finiteInteger)) errors.push(`${frame.id}: frame rectangle must use finite integers`);
    if (rect.width !== CELL_SIZE || rect.height !== CELL_SIZE) errors.push(`${frame.id}: frame must be native 128x128`);
    if (rect.x % CELL_SIZE !== 0 || rect.y % CELL_SIZE !== 0) errors.push(`${frame.id}: frame must align to the native grid`);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > ATLAS_WIDTH || rect.y + rect.height > ATLAS_HEIGHT) errors.push(`${frame.id}: frame outside shelter atlas`);

    const expectedId = SHELTER_ATLAS_CELL_IDS[index];
    const expectedX = (index % COLUMNS) * CELL_SIZE;
    const expectedY = Math.floor(index / COLUMNS) * CELL_SIZE;
    if (frame.id !== expectedId || rect.x !== expectedX || rect.y !== expectedY) errors.push(`${frame.id}: frame does not match reviewed row-major shelter inventory`);
  });
  for (const id of SHELTER_ATLAS_CELL_IDS) if (!knownIds.has(id)) errors.push(`${id}: required shelter frame is missing`);

  for (const id of Object.keys(EXPECTED_COMPONENTS) as ShelterLogicalComponentId[]) {
    const actual = manifest.components[id];
    const expected = EXPECTED_COMPONENTS[id];
    if (!actual || actual.standing !== expected.standing || actual.damaged !== expected.damaged || actual.falling !== expected.falling) {
      errors.push(`${id}: invalid shelter component visual mapping`);
    }
  }
  if (manifest.doorOpen !== "door-open") errors.push("open door must map to the reviewed open-door cell");
  for (const key of Object.keys(EXPECTED_ACCENTS) as (keyof typeof EXPECTED_ACCENTS)[]) {
    if (manifest.accents[key] !== EXPECTED_ACCENTS[key]) errors.push(`${key}: invalid shelter accent mapping`);
  }
  if (manifest.damage.wallCracked !== "wall-cracked" || manifest.damage.wallBroken !== "wall-broken") errors.push("invalid shelter damage mapping");
  for (const tier of Object.keys(EXPECTED_RUINS) as ShelterRuinTier[]) {
    const actual = manifest.ruins[tier];
    const expected = EXPECTED_RUINS[tier];
    if (!actual || actual.frame !== expected.frame || !sameArray(actual.composition, expected.composition)) errors.push(`${tier}: invalid persistent rubble mapping`);
  }
  if (manifest.empty !== "empty") errors.push("transparent reserve cell must map to empty");

  return errors;
}

/** Resolves one declared shelter frame without numeric-coordinate fallbacks. */
export function resolveShelterFrame(manifest: ShelterVisualManifest, id: ShelterAtlasCellId): ShelterAtlasCell {
  const frame = manifest.frames.find((candidate) => candidate.id === id);
  if (frame === undefined) throw new Error(`Shelter frame ${id} is undeclared.`);
  return frame;
}
