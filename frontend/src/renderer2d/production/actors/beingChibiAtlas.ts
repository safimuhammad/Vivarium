/**
 * @fileoverview Typed, validated loader for the `core-being-chibi` v2
 * sprite atlas geometry JSON (`assets/renderer2d/core/being-chibi.json`,
 * packed by `scripts/pack-being-chibi-atlas.mjs`) — the full 7-character
 * roster (`m1`, the shipped base, plus `f1`/`f2`/`f3`/`m2`/`m3`/`m4`).
 *
 * This module owns only frame *geometry* lookups (rects by character +
 * name, the three walk cycles, the shared frame envelope, the shared feet
 * pivot) and the deterministic being -> character assignment
 * ({@link resolveBeingCharacter}). It knows nothing about facing, gait,
 * stride distance, garment palette, or any other actor-behavioral concept —
 * those live in `SpriteSheetHumanActor.ts` (locomotion/pose) and
 * `beingPalette.ts` (garment recolor), which are this module's consumers.
 *
 * Every character ships the identical 17-frame pose-parity contract (12
 * walk + 5 pose frames sharing one global `frameWidth`/`frameHeight`/`feet`
 * envelope) — enforced by the packer at pack time (a missing frame fails
 * the pack) and re-validated here at module load (a malformed or
 * incomplete committed JSON fails loudly instead of silently degrading).
 */

import rawGeometry from "../../../assets/renderer2d/core/being-chibi.json";
import type { HumanAppearance } from "./appearance";

/** The manifest atlas id `SpriteSheetHumanActor` leases to draw this sheet. */
export const BEING_CHIBI_ATLAS_ID = "core-being-chibi";

/** The three directional walk cycles every packed character provides. */
export type BeingChibiWalkDirection = "down" | "up" | "side";

/** The full 7-character roster this atlas packs: `m1` (the shipped base) plus six new villagers. */
export const BEING_CHARACTER_IDS = ["m1", "f1", "f2", "f3", "m2", "m3", "m4"] as const;

/** One member of the packed 7-character roster. */
export type BeingCharacterId = (typeof BEING_CHARACTER_IDS)[number];

/**
 * The character every being resolves to when no roster context is
 * available (an actor constructed without an explicit `characterId`
 * option) — the shipped base villager, kept pixel-identical to its
 * pre-roster-integration appearance so every actor test written against
 * the single-character atlas stays valid unmodified.
 */
export const DEFAULT_BEING_CHARACTER_ID: BeingCharacterId = "m1";

const BEING_CHARACTER_ID_SET: ReadonlySet<string> = new Set(BEING_CHARACTER_IDS);

/** Top-left origin of one named frame's cell within the packed sheet. */
export interface BeingChibiFrameOrigin {
  readonly x: number;
  readonly y: number;
}

/** One character's packed frame geometry: its own 17 frames, walk cycles, and idle frame. */
export interface BeingChibiCharacterGroup {
  readonly frames: Readonly<Record<string, BeingChibiFrameOrigin>>;
  readonly walkCycles: Readonly<Record<BeingChibiWalkDirection, readonly string[]>>;
  readonly idleFrame: string;
}

/** Validated, immutable geometry for the `being-chibi` v2 sprite sheet. */
export interface BeingChibiAtlasGeometry {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly feet: BeingChibiFrameOrigin;
  readonly characters: Readonly<Record<BeingCharacterId, BeingChibiCharacterGroup>>;
}

const WALK_DIRECTIONS: readonly BeingChibiWalkDirection[] = ["down", "up", "side"];

function validateOrigin(candidate: unknown, label: string): BeingChibiFrameOrigin {
  if (typeof candidate !== "object" || candidate === null) {
    throw new TypeError(`being-chibi.json ${label} must be an object.`);
  }
  const origin = candidate as Record<string, unknown>;
  if (!Number.isFinite(origin.x) || !Number.isFinite(origin.y)) {
    throw new TypeError(`being-chibi.json ${label} must be a finite {x,y} rect.`);
  }
  return Object.freeze({ x: origin.x as number, y: origin.y as number });
}

function validateCharacterGroup(
  candidate: unknown,
  characterId: string,
  frameWidth: number,
  frameHeight: number,
): BeingChibiCharacterGroup {
  if (typeof candidate !== "object" || candidate === null) {
    throw new TypeError(`being-chibi.json characters["${characterId}"] must be an object.`);
  }
  const value = candidate as Record<string, unknown>;
  const { frames, walkCycles, idleFrame } = value;
  if (typeof frames !== "object" || frames === null) {
    throw new TypeError(`being-chibi.json characters["${characterId}"].frames must be an object.`);
  }
  const frameTable = frames as Record<string, unknown>;
  const validatedFrames: Record<string, BeingChibiFrameOrigin> = {};
  for (const [name, rect] of Object.entries(frameTable)) {
    validatedFrames[name] = validateOrigin(rect, `characters["${characterId}"].frames["${name}"]`);
  }
  if (Object.keys(validatedFrames).length !== 17) {
    throw new Error(
      `being-chibi.json characters["${characterId}"] must have exactly 17 frames `
      + `(12 walk + 5 pose), found ${Object.keys(validatedFrames).length}.`,
    );
  }

  if (typeof walkCycles !== "object" || walkCycles === null) {
    throw new TypeError(`being-chibi.json characters["${characterId}"].walkCycles must be an object.`);
  }
  const cycleTable = walkCycles as Record<string, unknown>;
  const validatedCycles: Record<string, readonly string[]> = {};
  for (const direction of WALK_DIRECTIONS) {
    const cycle = cycleTable[direction];
    if (!Array.isArray(cycle) || cycle.length === 0) {
      throw new TypeError(
        `being-chibi.json characters["${characterId}"].walkCycles.${direction} must be a non-empty array.`,
      );
    }
    for (const frameName of cycle) {
      if (typeof frameName !== "string" || !(frameName in validatedFrames)) {
        throw new TypeError(
          `being-chibi.json characters["${characterId}"].walkCycles.${direction} references `
          + `unknown frame "${String(frameName)}".`,
        );
      }
    }
    validatedCycles[direction] = Object.freeze([...(cycle as readonly string[])]);
  }

  if (typeof idleFrame !== "string" || !(idleFrame in validatedFrames)) {
    throw new TypeError(`being-chibi.json characters["${characterId}"].idleFrame must reference a known frame.`);
  }

  for (const [name, rect] of Object.entries(validatedFrames)) {
    if (rect.x < 0 || rect.y < 0 || rect.x + frameWidth <= rect.x || rect.y + frameHeight <= rect.y) {
      throw new RangeError(`being-chibi.json characters["${characterId}"].frames["${name}"] has an invalid origin.`);
    }
  }

  return Object.freeze({
    frames: Object.freeze(validatedFrames),
    walkCycles: Object.freeze({
      down: validatedCycles.down!,
      up: validatedCycles.up!,
      side: validatedCycles.side!,
    }),
    idleFrame: idleFrame as string,
  });
}

function validateGeometry(candidate: unknown): BeingChibiAtlasGeometry {
  if (typeof candidate !== "object" || candidate === null) {
    throw new TypeError("being-chibi.json must decode to an object.");
  }
  const value = candidate as Record<string, unknown>;
  const { frameWidth, frameHeight, feet, characters } = value;
  if (!Number.isFinite(frameWidth) || (frameWidth as number) <= 0) {
    throw new TypeError("being-chibi.json frameWidth must be a positive finite number.");
  }
  if (!Number.isFinite(frameHeight) || (frameHeight as number) <= 0) {
    throw new TypeError("being-chibi.json frameHeight must be a positive finite number.");
  }
  const feetPoint = validateOrigin(feet, "feet");
  if (feetPoint.x < 0 || feetPoint.x >= (frameWidth as number)
    || feetPoint.y < 0 || feetPoint.y >= (frameHeight as number)) {
    throw new RangeError("being-chibi.json feet anchor must fall inside the frame envelope.");
  }
  if (typeof characters !== "object" || characters === null) {
    throw new TypeError("being-chibi.json characters must be an object.");
  }
  const characterTable = characters as Record<string, unknown>;
  const missing = BEING_CHARACTER_IDS.filter((id) => !(id in characterTable));
  if (missing.length > 0) {
    throw new Error(`being-chibi.json characters is missing required roster member(s): ${missing.join(", ")}.`);
  }
  const validatedCharacters = {} as Record<BeingCharacterId, BeingChibiCharacterGroup>;
  for (const characterId of BEING_CHARACTER_IDS) {
    validatedCharacters[characterId] = validateCharacterGroup(
      characterTable[characterId],
      characterId,
      frameWidth as number,
      frameHeight as number,
    );
  }

  return Object.freeze({
    frameWidth: frameWidth as number,
    frameHeight: frameHeight as number,
    feet: feetPoint,
    characters: Object.freeze(validatedCharacters),
  });
}

/** Validated geometry for the packed `being-chibi` v2 sheet; throws once, at module load, on drift. */
export const BEING_CHIBI_GEOMETRY: BeingChibiAtlasGeometry = validateGeometry(rawGeometry);

/**
 * Every character id the packed atlas provides, in packing order.
 *
 * @returns The full roster of character ids this atlas has frame data for.
 */
export function characterIds(): readonly BeingCharacterId[] {
  return BEING_CHARACTER_IDS;
}

function requireCharacterGroup(characterId: BeingCharacterId): BeingChibiCharacterGroup {
  const group = BEING_CHIBI_GEOMETRY.characters[characterId];
  if (!group) throw new Error(`Unknown being-chibi character "${characterId}".`);
  return group;
}

/**
 * Look up one character's complete frame-rect table.
 *
 * @param characterId - Which packed character's frames to read.
 * @returns The character's 17 named frame rects (12 walk + 5 pose).
 * @throws {Error} If `characterId` is not a member of {@link BEING_CHARACTER_IDS}.
 */
export function framesFor(characterId: BeingCharacterId): Readonly<Record<string, BeingChibiFrameOrigin>> {
  return requireCharacterGroup(characterId).frames;
}

/**
 * Look up one named frame's origin rect within the packed sheet.
 *
 * @param frameName - A frame name from the character's own frame table
 *   (e.g. `"walk-side-1"`, `"pose-kneel"`) — bare, never
 *   character-prefixed; every character shares the same 17 frame names by
 *   the pose-parity contract.
 * @param characterId - Which packed character to read the frame from.
 *   Defaults to {@link DEFAULT_BEING_CHARACTER_ID} (`"m1"`) so callers that
 *   predate the roster (including every pre-existing `SpriteSheetHumanActor`
 *   test) keep resolving the exact same frame they always did.
 * @returns The frame's `{x, y}` origin (width/height are the sheet's uniform
 *   `frameWidth`/`frameHeight`).
 * @throws {Error} If `characterId` is unknown, or `frameName` is not a frame
 *   that character's atlas defines.
 */
export function beingChibiFrameRect(
  frameName: string,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): BeingChibiFrameOrigin {
  const rect = requireCharacterGroup(characterId).frames[frameName];
  if (!rect) throw new Error(`Unknown being-chibi frame "${frameName}" for character "${characterId}".`);
  return rect;
}

/**
 * Return the ordered frame names for one directional walk cycle.
 *
 * @param direction - Which of the three packed cycles to read.
 * @param characterId - Which packed character to read the cycle from.
 *   Defaults to {@link DEFAULT_BEING_CHARACTER_ID} (`"m1"`), matching
 *   {@link beingChibiFrameRect}'s default.
 * @returns The cycle's frame names, in stride order.
 */
export function beingChibiWalkCycle(
  direction: BeingChibiWalkDirection,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): readonly string[] {
  return requireCharacterGroup(characterId).walkCycles[direction];
}

/**
 * The stride index — within *any* directional walk cycle, not just `down` —
 * that represents the idle "passing" pose.
 *
 * The packed atlas only records one canonical idle frame per character
 * (authored against the `down` cycle, e.g. `"walk-down-1"`). By the
 * pose-parity contract every character's idle frame sits at the identical
 * stride position (validated below, once, at module load — not per call),
 * so this derives a single roster-wide index from `m1`'s own cycle rather
 * than requiring a `characterId` argument every consumer would otherwise
 * have to thread through just to reach an index that never actually varies.
 *
 * @returns The zero-based index of the idle pose within a 4-frame walk cycle.
 * @throws {Error} If any character's `idleFrame` is not a member of its own
 *   `walkCycles.down` (guarded already by {@link BeingChibiAtlasGeometry}
 *   validation, but checked again here defensively), or if characters
 *   disagree on the idle stride index (would violate the pose-parity
 *   contract every character is packed under).
 */
export function beingChibiIdleStrideIndex(): number {
  let sharedIndex: number | null = null;
  for (const characterId of BEING_CHARACTER_IDS) {
    const group = requireCharacterGroup(characterId);
    const index = group.walkCycles.down.indexOf(group.idleFrame);
    if (index < 0) {
      throw new Error(
        `being-chibi.json characters["${characterId}"].idleFrame "${group.idleFrame}" `
        + "is not a member of its own walkCycles.down.",
      );
    }
    if (sharedIndex === null) {
      sharedIndex = index;
    } else if (index !== sharedIndex) {
      throw new Error(
        `being-chibi.json characters disagree on idle stride index: "${characterId}" is ${index}, `
        + `expected ${sharedIndex} (pose-parity contract violation).`,
      );
    }
  }
  // BEING_CHARACTER_IDS is always non-empty, so sharedIndex is always assigned above.
  return sharedIndex as number;
}

/** FNV-1a hash, matching the same seed function used elsewhere for deterministic per-agent derivation. */
function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Deterministically resolve one being's roster character from its derived
 * appearance.
 *
 * `HumanAppearance` (from `appearance.ts`) is itself already a pure,
 * deterministic function of the being's agent id (`deriveHumanAppearance`),
 * so hashing its own fields — rather than requiring the agent id again
 * here — is sufficient to guarantee "same agent id -> same character,
 * always" while keeping this function's signature anchored to the
 * appearance value the brief specifies. A `"character-select"` domain tag
 * is folded into the hash key so this assignment decorrelates from
 * `resolveBeingPaletteVariant`'s own hash of the very same appearance
 * fields (otherwise both selections would move in lockstep for every
 * agent, collapsing two independent-feeling axes of visual variety into
 * one).
 *
 * This function never assigns a character itself — it is a pure spread
 * over {@link BEING_CHARACTER_IDS} — callers that want the shipped-base
 * default behavior (e.g. every actor constructed without explicit roster
 * context) use {@link DEFAULT_BEING_CHARACTER_ID} instead of calling this.
 *
 * @param appearance - The being's derived appearance.
 * @returns The roster character this being always resolves to.
 */
export function resolveBeingCharacter(appearance: HumanAppearance): BeingCharacterId {
  const key = [
    "character-select",
    appearance.rig,
    appearance.skinRamp,
    appearance.hairSilhouette,
    appearance.hairRamp,
    appearance.clothingSilhouette,
    appearance.clothingPalette,
    appearance.secondaryAccent ?? "none",
  ].join("\0");
  const index = stableHash(key) % BEING_CHARACTER_IDS.length;
  return BEING_CHARACTER_IDS[index]!;
}

/**
 * Type guard: is `value` a known roster character id?
 *
 * @param value - Candidate string to test.
 * @returns Whether `value` is a member of {@link BEING_CHARACTER_IDS}.
 */
export function isBeingCharacterId(value: string): value is BeingCharacterId {
  return BEING_CHARACTER_ID_SET.has(value);
}
