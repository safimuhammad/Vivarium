/**
 * @fileoverview Deterministic per-being, per-base-character palette
 * variation for the chibi sprite-sheet human actor
 * (`SpriteSheetHumanActor`).
 *
 * The packed `being-chibi` v2 atlas bakes exactly one garment palette per
 * roster character into its pixels. `LayeredHumanActor` varies appearance
 * at draw time via CSS `context.filter` strings because it composites
 * separate layer images — that approach does not apply here, since
 * `SpriteSheetHumanActor` blits one pre-baked raster frame per draw.
 * Instead this module performs an exact-RGB pixel remap (same technique as
 * the approved pilot template's `RECOLOR` table — the reference build under
 * `frontend/scripts/character-pipeline/`) to produce a small, fixed set of
 * recolored copies of the base atlas image, one per
 * `(characterId, BeingPaletteVariant)` pair, cached and reused across every
 * being that resolves to that pair — never recomputed per agent. Legacy
 * `BeingPaletteVariant` tables target the source PNG RGBs; the roster-aware
 * v2 path below targets the RGBs that actually survive packing into the
 * committed atlas and applies character-local wardrobe masks where the shared
 * atlas palette creates body-color collisions.
 *
 * `m1` (the shipped base) keeps its original, hand-authored, pixel-exact
 * remap tables verbatim — no roster-integration change may drift the
 * already-approved base villager. The six new roster characters
 * (`f1`/`f2`/`f3`/`m2`/`m3`/`m4`) each ship a `palette-sources.json`
 * (imported directly, per character) naming the exact garment RGBs eligible
 * for remapping (shirt/top + trousers/skirt family only — skin and hair are
 * never touched) plus one artist-reviewed `suggestedVariant` remap. The
 * legacy path uses that metadata verbatim for its named variant and derives
 * the remaining five-family variants programmatically. The v2 path retains
 * the same hue/saturation families while using packed-atlas garment samples,
 * preserving each tone's lightness without hand-authoring dozens of
 * additional RGB triples per character.
 */

import f1PaletteSourceJson from "../../../../assets/character-claude/roster/f1-sprites/palette-sources.json";
import f2PaletteSourceJson from "../../../../assets/character-claude/roster/f2-sprites/palette-sources.json";
import f3PaletteSourceJson from "../../../../assets/character-claude/roster/f3-sprites/palette-sources.json";
import m2PaletteSourceJson from "../../../../assets/character-claude/roster/m2-sprites/palette-sources.json";
import m3PaletteSourceJson from "../../../../assets/character-claude/roster/m3-sprites/palette-sources.json";
import m4PaletteSourceJson from "../../../../assets/character-claude/roster/m4-sprites/palette-sources.json";
import type { HumanAppearance } from "./appearance";
import {
  BEING_CHARACTER_IDS,
  BEING_CHIBI_GEOMETRY,
  type BeingCharacterId,
  DEFAULT_BEING_CHARACTER_ID,
} from "./beingChibiAtlas";

/** Garment palette family a being's sprite is recolored into. Bounded to a small, hand-authored set (kept ≤8). */
export const BEING_PALETTE_VARIANTS = [
  "slate-blue",
  "violet-grey",
  "moss",
  "ochre",
  "bone",
] as const;

/** One of the world's muted garment palette families, chosen deterministically per agent id. */
export type BeingPaletteVariant = (typeof BEING_PALETTE_VARIANTS)[number];

/** A plain 0-255 RGB color triple (no alpha). */
export interface RgbTriple {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** One exact-match (source pixel → replacement pixel) remap entry. */
export interface PaletteRemapEntry {
  readonly from: RgbTriple;
  readonly to: RgbTriple;
}

function rgb(r: number, g: number, b: number): RgbTriple {
  return { r, g, b };
}

/**
 * Validate and convert one raw `[r, g, b]` JSON array into an {@link RgbTriple}.
 *
 * Boundary validation for the per-character `palette-sources.json` imports:
 * `resolveJsonModule` types a JSON array literal as a widened `number[]`,
 * not a fixed 3-tuple, so a malformed source file (wrong length, or a
 * non-finite/out-of-range channel) fails loudly here instead of silently
 * producing `undefined` channels downstream.
 *
 * @param triple - The raw `[r, g, b]` array read from a character's
 *   `palette-sources.json`.
 * @param label - Description of the field being validated, for the error
 *   message.
 * @returns The validated `{r, g, b}` triple.
 * @throws {TypeError} If `triple` is not exactly 3 finite integers in [0, 255].
 */
function toRgbTriple(triple: readonly number[], label: string): RgbTriple {
  if (triple.length !== 3 || triple.some((channel) => (
    !Number.isFinite(channel) || channel < 0 || channel > 255 || !Number.isInteger(channel)
  ))) {
    throw new TypeError(`${label} must be an [r, g, b] array of three 0-255 integers, got ${JSON.stringify(triple)}.`);
  }
  return rgb(triple[0]!, triple[1]!, triple[2]!);
}

/**
 * Garment colors baked into the packed `being-chibi` sheet for `m1`,
 * verbatim from the approved pilot's `RECOLOR` source column: one shirt
 * tone and three trouser shading tones (light, dark, mid).
 */
const BASE_SHIRT = rgb(248, 225, 182);
const BASE_TROUSER_LIGHT = rgb(96, 84, 31);
const BASE_TROUSER_DARK = rgb(52, 39, 16);
const BASE_TROUSER_MID = rgb(83, 66, 26);

function remapTable(
  shirt: RgbTriple,
  trouserLight: RgbTriple,
  trouserDark: RgbTriple,
  trouserMid: RgbTriple,
): readonly PaletteRemapEntry[] {
  return Object.freeze([
    { from: BASE_SHIRT, to: shirt },
    { from: BASE_TROUSER_LIGHT, to: trouserLight },
    { from: BASE_TROUSER_DARK, to: trouserDark },
    { from: BASE_TROUSER_MID, to: trouserMid },
  ]);
}

/**
 * Exact-RGB remap tables per variant, for `m1` only. `slate-blue` is the
 * approved pilot's own shipped recolor verbatim; the remaining families are
 * hand-picked to sit in the same muted, desaturated register (violet-grey,
 * moss, ochre, bone) so every variant reads as belonging to the same world.
 * Kept byte-for-byte unchanged by the roster integration — every other
 * character's tables derive their own (hue, saturation) targets from this
 * one (see {@link VARIANT_HUE_SATURATION_TARGETS}), but this table itself
 * is never regenerated.
 */
const M1_PALETTE_REMAPS: Readonly<Record<BeingPaletteVariant, readonly PaletteRemapEntry[]>> = Object.freeze({
  "slate-blue": remapTable(rgb(154, 166, 192), rgb(110, 98, 128), rgb(72, 62, 88), rgb(92, 82, 108)),
  "violet-grey": remapTable(rgb(168, 150, 182), rgb(120, 102, 132), rgb(76, 62, 86), rgb(98, 82, 108)),
  moss: remapTable(rgb(162, 176, 146), rgb(100, 112, 84), rgb(64, 74, 52), rgb(86, 96, 70)),
  ochre: remapTable(rgb(196, 158, 88), rgb(132, 98, 42), rgb(86, 62, 24), rgb(108, 80, 34)),
  bone: remapTable(rgb(206, 198, 182), rgb(146, 138, 120), rgb(96, 88, 74), rgb(120, 110, 94)),
});

/**
 * Target (hue in degrees, saturation in [0,1]) per named variant, one
 * shared "family" signature every non-`m1` character's programmatically
 * derived variants are pulled toward. `slate-blue`/`moss`/`ochre`/`bone`
 * are calibrated as the median hue/saturation across `m1`'s own 4 shipped
 * garment roles for that variant (median, not mean, to stay robust against
 * the shirt role's much higher base lightness/saturation skewing its
 * converted hue relative to the three tightly-clustered trouser roles).
 *
 * `violet-grey` is deliberately NOT calibrated that way: `m1`'s own shipped
 * `violet-grey` sits only ~12° from `m1`'s own shipped `slate-blue` at
 * nearly identical saturation, which is fine for `m1` (a fixed, hand-tuned,
 * already-approved 4-color table) but reproduces as a near-indistinguishable
 * collision once *any* source lightness is fed through both targets
 * generically (see `beingPalette.test.ts`'s per-character variant-collision
 * coverage) — worst observed separation across the real roster's native
 * garment lightness values was ~2.9 redmean units (imperceptible). Retargeted
 * to a genuinely distinct hue with meaningfully higher saturation
 * (263.1°/.155 vs 305°/.26 — both hue-shifted *and* more saturated, not
 * just one or the other) while staying inside the same muted family
 * register every other variant occupies; worst-case separation across the
 * real roster is now ~9.3 redmean units.
 */
const VARIANT_HUE_SATURATION_TARGETS: Readonly<Record<BeingPaletteVariant, { readonly hue: number; readonly saturation: number }>> =
  Object.freeze({
    "slate-blue": Object.freeze({ hue: 263.1, saturation: 0.155 }),
    "violet-grey": Object.freeze({ hue: 305.0, saturation: 0.26 }),
    moss: Object.freeze({ hue: 86.5, saturation: 0.158 }),
    ochre: Object.freeze({ hue: 37.3, saturation: 0.519 }),
    bone: Object.freeze({ hue: 39.1, saturation: 0.125 }),
  });

/** Convert one 0-255 RGB triple to `{h: degrees in [0,360), s, l}` (`s`/`l` in [0,1]). */
function rgbToHsl({ r, g, b }: RgbTriple): { readonly h: number; readonly s: number; readonly l: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rf) h = (gf - bf) / d + (gf < bf ? 6 : 0);
  else if (max === gf) h = (bf - rf) / d + 2;
  else h = (rf - gf) / d + 4;
  return { h: (h / 6) * 360, s, l };
}

function hueToChannel(p: number, q: number, tInput: number): number {
  let t = tInput;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Convert `{h: degrees, s, l}` (`s`/`l` in [0,1]) back to a rounded, clamped 0-255 RGB triple. */
function hslToRgb(h: number, s: number, l: number): RgbTriple {
  if (s === 0) {
    const channel = Math.round(l * 255);
    return rgb(channel, channel, channel);
  }
  const hueFraction = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value * 255)));
  return rgb(
    toByte(hueToChannel(p, q, hueFraction + 1 / 3)),
    toByte(hueToChannel(p, q, hueFraction)),
    toByte(hueToChannel(p, q, hueFraction - 1 / 3)),
  );
}

/**
 * Recolor one source garment tone into a named variant's target hue/
 * saturation family, preserving the source's own lightness.
 *
 * @param source - The character's own native garment RGB.
 * @param variant - Which named variant family to remap toward.
 * @returns The recolored RGB: `variant`'s target hue and saturation, at
 *   `source`'s original lightness.
 */
function hueSaturationRemap(source: RgbTriple, variant: BeingPaletteVariant): RgbTriple {
  const { l } = rgbToHsl(source);
  const target = VARIANT_HUE_SATURATION_TARGETS[variant];
  return hslToRgb(target.hue, target.saturation, l);
}

interface SourcePaletteRoleEntry {
  readonly role: string;
  readonly rgb: readonly number[];
}

interface SuggestedVariantRemapEntry {
  readonly from: readonly number[];
  readonly to: readonly number[];
  readonly role: string;
}

interface CharacterPaletteSourceJson {
  readonly characterId: string;
  readonly sourcePalette: Readonly<Record<string, readonly SourcePaletteRoleEntry[]>>;
  readonly suggestedVariant: {
    readonly name: string;
    readonly remap: readonly SuggestedVariantRemapEntry[];
  };
}

/** Flatten one character's `sourcePalette` (grouped by garment family) into its full role list. */
function allSourceRoles(source: CharacterPaletteSourceJson): readonly SourcePaletteRoleEntry[] {
  return Object.values(source.sourcePalette).flat();
}

function requireBeingPaletteVariant(name: string, characterId: string): BeingPaletteVariant {
  if ((BEING_PALETTE_VARIANTS as readonly string[]).includes(name)) return name as BeingPaletteVariant;
  throw new TypeError(
    `${characterId} palette-sources.json suggestedVariant.name "${name}" is not a known BeingPaletteVariant.`,
  );
}

function rgbKey(color: RgbTriple): string {
  return `${color.r},${color.g},${color.b}`;
}

/**
 * Build one non-`m1` character's full 5-variant remap-table set from its
 * imported `palette-sources.json`.
 *
 * The character's own `suggestedVariant` is used verbatim (an
 * artist-reviewed remap, not a formula output) for the roles it names;
 * every other role/variant combination is derived via
 * {@link hueSaturationRemap}. This includes filling in any role the
 * suggested remap itself omits (`m2`'s shipped `"moss"` suggestion, for
 * example, only names its 3 tunic roles — its 2 trousers roles are backfilled
 * here via the formula) so every one of a character's 5 variants always
 * covers every one of its garment roles; a variant that silently left a
 * role unrecolored would read as a broken/half-applied palette switch.
 * Skin and hair are never part of `sourcePalette` to begin with, so they
 * can never end up in a remap table regardless.
 *
 * @param source - The character's parsed `palette-sources.json`.
 * @returns All 5 named variants' remap tables for this character, each
 *   covering every role in `source.sourcePalette`.
 */
function buildCharacterVariantTable(
  source: CharacterPaletteSourceJson,
): Readonly<Record<BeingPaletteVariant, readonly PaletteRemapEntry[]>> {
  const roles = allSourceRoles(source);
  const suggestedName = requireBeingPaletteVariant(source.suggestedVariant.name, source.characterId);
  const suggestedByFrom = new Map<string, RgbTriple>();
  for (const entry of source.suggestedVariant.remap) {
    const from = toRgbTriple(entry.from, `${source.characterId}.suggestedVariant.remap[].from`);
    const to = toRgbTriple(entry.to, `${source.characterId}.suggestedVariant.remap[].to`);
    suggestedByFrom.set(rgbKey(from), to);
  }

  const table = {} as Record<BeingPaletteVariant, readonly PaletteRemapEntry[]>;
  for (const variant of BEING_PALETTE_VARIANTS) {
    table[variant] = Object.freeze(roles.map((role): PaletteRemapEntry => {
      const from = toRgbTriple(role.rgb, `${source.characterId}.sourcePalette["${role.role}"].rgb`);
      if (variant === suggestedName) {
        const suggested = suggestedByFrom.get(rgbKey(from));
        if (suggested) return { from, to: suggested };
      }
      return { from, to: hueSaturationRemap(from, variant) };
    }));
  }
  return Object.freeze(table);
}

/**
 * Per-base (`characterId`) exact-RGB remap tables for every named variant.
 * `m1` is hand-authored and unchanged; every other character is derived
 * from its own `palette-sources.json` (see {@link buildCharacterVariantTable}).
 *
 * Exported (read-only) so `beingPalette.test.ts` can assert a minimum
 * perceptual separation between every variant pair, for every character,
 * directly against the real tables — rather than duplicating them or
 * re-deriving colors through a parallel test-only implementation.
 */
export const PALETTE_REMAPS_BY_CHARACTER: Readonly<Record<BeingCharacterId, Readonly<Record<BeingPaletteVariant, readonly PaletteRemapEntry[]>>>> =
  Object.freeze({
    m1: M1_PALETTE_REMAPS,
    f1: buildCharacterVariantTable(f1PaletteSourceJson as CharacterPaletteSourceJson),
    f2: buildCharacterVariantTable(f2PaletteSourceJson as CharacterPaletteSourceJson),
    f3: buildCharacterVariantTable(f3PaletteSourceJson as CharacterPaletteSourceJson),
    m2: buildCharacterVariantTable(m2PaletteSourceJson as CharacterPaletteSourceJson),
    m3: buildCharacterVariantTable(m3PaletteSourceJson as CharacterPaletteSourceJson),
    m4: buildCharacterVariantTable(m4PaletteSourceJson as CharacterPaletteSourceJson),
  });

function requireVariantTable(characterId: BeingCharacterId): Readonly<Record<BeingPaletteVariant, readonly PaletteRemapEntry[]>> {
  const table = PALETTE_REMAPS_BY_CHARACTER[characterId];
  if (!table) throw new Error(`Being palette has no remap tables for character "${characterId}".`);
  return table;
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
 * Deterministically resolve one being's palette variant from its derived
 * appearance.
 *
 * `HumanAppearance` (from `appearance.ts`) is itself already a pure,
 * deterministic function of the being's agent id (`deriveHumanAppearance`),
 * so hashing its own fields — rather than requiring the agent id again
 * here — is sufficient to guarantee "same agent id → same variant, always"
 * while keeping this function's signature anchored to the appearance value
 * the brief specifies. `characterId` is folded into the same hash key (see
 * `resolveBeingCharacter`'s own `"character-select"` domain tag for the
 * mirrored rationale) purely to decorrelate this being's palette pick from
 * its character pick — the variant returned is always a member of
 * {@link BEING_PALETTE_VARIANTS} regardless of `characterId`, since every
 * character ships a remap table for every named variant.
 *
 * @param appearance - The being's derived appearance.
 * @param characterId - The being's resolved roster character. Defaults to
 *   {@link DEFAULT_BEING_CHARACTER_ID} (`"m1"`) so callers that predate the
 *   roster keep resolving exactly the variant they always did.
 * @returns The garment palette variant this being always resolves to.
 */
export function resolveBeingPaletteVariant(
  appearance: HumanAppearance,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): BeingPaletteVariant {
  const key = [
    appearance.rig,
    appearance.skinRamp,
    appearance.hairSilhouette,
    appearance.hairRamp,
    appearance.clothingSilhouette,
    appearance.clothingPalette,
    appearance.secondaryAccent ?? "none",
    characterId,
  ].join("\0");
  const index = stableHash(key) % BEING_PALETTE_VARIANTS.length;
  return BEING_PALETTE_VARIANTS[index]!;
}

interface SizedImageSource {
  readonly width: number;
  readonly height: number;
}

/** Read pixel dimensions off a `CanvasImageSource` that exposes plain numeric `width`/`height`. */
function sourceDimensions(source: CanvasImageSource): SizedImageSource {
  const candidate = source as unknown as { readonly width?: unknown; readonly height?: unknown };
  if (typeof candidate.width === "number" && typeof candidate.height === "number"
    && Number.isFinite(candidate.width) && Number.isFinite(candidate.height)
    && candidate.width > 0 && candidate.height > 0) {
    return { width: candidate.width, height: candidate.height };
  }
  throw new TypeError("Being palette variant source must expose positive finite numeric width/height.");
}

function applyRemap(data: Uint8ClampedArray, entries: readonly PaletteRemapEntry[]): void {
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]!;
    const g = data[index + 1]!;
    const b = data[index + 2]!;
    for (const entry of entries) {
      if (r === entry.from.r && g === entry.from.g && b === entry.from.b) {
        data[index] = entry.to.r;
        data[index + 1] = entry.to.g;
        data[index + 2] = entry.to.b;
        break;
      }
    }
  }
}

function renderPaletteVariant(
  base: CanvasImageSource,
  variant: BeingPaletteVariant,
  characterId: BeingCharacterId,
): CanvasImageSource {
  const { width, height } = sourceDimensions(base);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error(`Being palette variant "${characterId}/${variant}" requires a 2D canvas context.`);
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(base, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  applyRemap(imageData.data, requireVariantTable(characterId)[variant]);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

/** One recolored copy per `(base image, characterId, variant)` triple, never recomputed once cached. */
const paletteSourceCache = new WeakMap<CanvasImageSource, Map<string, CanvasImageSource>>();

function paletteCacheKey(characterId: BeingCharacterId, variant: string): string {
  return `${characterId}\0${variant}`;
}

/**
 * Produce (or reuse) a whole-sheet recolored copy of `base` for one
 * `(characterId, variant)` pair.
 *
 * Cached per `(base, characterId, variant)` triple — calling this
 * repeatedly for many beings that share the same character and variant
 * (the common case, since both are capped at small enumerable sets) returns
 * the same cached canvas instance every time rather than recomputing or
 * allocating a fresh canvas per agent. Because the packed atlas is one
 * combined sheet spanning every roster character, a given cached copy is
 * only ever correctly recolored within `characterId`'s own frame region —
 * callers must draw from that same character's frame rects when sampling
 * this source, exactly as `SpriteSheetHumanActor` does.
 *
 * @param base - The source atlas image (the full packed sheet) to recolor.
 * @param variant - Which garment palette family to remap onto.
 * @param characterId - Which roster character's remap table to apply.
 *   Defaults to {@link DEFAULT_BEING_CHARACTER_ID} (`"m1"`) so callers that
 *   predate the roster keep resolving exactly the recolor they always did.
 * @returns A `CanvasImageSource` with the same geometry as `base`, with
 *   every exact-match `characterId` garment pixel replaced by `variant`'s
 *   palette.
 * @throws {TypeError} If `base` does not expose positive finite numeric
 *   `width`/`height`.
 * @throws {Error} If a 2D canvas context is unavailable in this runtime.
 */
export function createPaletteVariantSource(
  base: CanvasImageSource,
  variant: BeingPaletteVariant,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): CanvasImageSource {
  let perBase = paletteSourceCache.get(base);
  if (perBase === undefined) {
    perBase = new Map<string, CanvasImageSource>();
    paletteSourceCache.set(base, perBase);
  }
  const cacheKey = paletteCacheKey(characterId, variant);
  const cached = perBase.get(cacheKey);
  if (cached !== undefined) return cached;
  const rendered = renderPaletteVariant(base, variant, characterId);
  perBase.set(cacheKey, rendered);
  return rendered;
}

/**
 * The expanded garment families used by the roster-aware visual identity.
 *
 * The legacy {@link BEING_PALETTE_VARIANTS} export intentionally stays at its
 * original five members: region markers and older callers use that list as a
 * closed contract. These three additions are selected only by the v2
 * identity resolver below and therefore cannot change an existing marker or
 * actor's old palette mapping.
 */
export const BEING_VISUAL_PALETTE_VARIANTS = Object.freeze([
  ...BEING_PALETTE_VARIANTS,
  "terracotta",
  "deep-teal",
  "plum",
] as const);

/** A palette family available to the stable v2 visual identity resolver. */
export type BeingVisualPaletteVariant = (typeof BEING_VISUAL_PALETTE_VARIANTS)[number];

/** Small pixel-grid accessories drawn over the garment band of every pose. */
export const BEING_ACCESSORIES = Object.freeze([
  "none",
  "scarf",
  "collar",
  "satchel",
  "belt",
] as const);

export type BeingAccessory = (typeof BEING_ACCESSORIES)[number];

/** Shared hue/saturation targets for derived roster garment tones. */
const VISUAL_VARIANT_HUE_SATURATION_TARGETS: Readonly<Record<BeingVisualPaletteVariant, { readonly hue: number; readonly saturation: number }>> =
  Object.freeze({
    ...VARIANT_HUE_SATURATION_TARGETS,
    terracotta: Object.freeze({ hue: 14.5, saturation: 0.435 }),
    "deep-teal": Object.freeze({ hue: 183.0, saturation: 0.34 }),
    plum: Object.freeze({ hue: 313.0, saturation: 0.285 }),
  });

function hueSaturationRemapVisual(source: RgbTriple, variant: BeingVisualPaletteVariant): RgbTriple {
  const { l } = rgbToHsl(source);
  const target = VISUAL_VARIANT_HUE_SATURATION_TARGETS[variant];
  return hslToRgb(target.hue, target.saturation, l);
}

type VisualGarmentRegion = "upper" | "lower";

interface VisualGarmentRole {
  readonly from: RgbTriple;
  readonly region: VisualGarmentRegion;
}

interface VisualWardrobeBand {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function visualRole(region: VisualGarmentRegion, r: number, g: number, b: number): VisualGarmentRole {
  return Object.freeze({ from: rgb(r, g, b), region });
}

/**
 * Post-pack garment colors in the committed atlas. The source PNGs are
 * quantized into one shared 128-color table by pack-being-chibi-atlas.mjs,
 * so their original palette-sources.json RGBs are not the values a runtime
 * canvas receives. Keep those source metadata files unchanged and target the
 * actual packed RGBs here instead.
 *
 * Some packed colors are shared with hair, hands, straps, or boots. The
 * per-character bands below make those exact-RGB swaps wardrobe-only while
 * retaining enough torso and trouser coverage to make each family visible.
 */
const ATLAS_GARMENT_ROLES_BY_CHARACTER: Readonly<Record<BeingCharacterId, readonly VisualGarmentRole[]>> = Object.freeze({
  m1: Object.freeze([
    visualRole("upper", 243, 218, 174),
    visualRole("lower", 100, 87, 43),
    visualRole("lower", 45, 28, 16),
    visualRole("lower", 96, 54, 22),
  ]),
  f1: Object.freeze([
    visualRole("upper", 237, 191, 132),
    visualRole("lower", 100, 87, 43),
    visualRole("lower", 96, 54, 22),
  ]),
  f2: Object.freeze([
    visualRole("upper", 174, 69, 25),
    visualRole("lower", 72, 42, 24),
  ]),
  f3: Object.freeze([
    visualRole("upper", 144, 133, 105),
    visualRole("upper", 100, 87, 43),
    visualRole("lower", 243, 218, 174),
    visualRole("lower", 203, 150, 76),
  ]),
  m2: Object.freeze([
    visualRole("upper", 50, 62, 85),
    visualRole("lower", 96, 54, 22),
    visualRole("lower", 72, 42, 24),
  ]),
  m3: Object.freeze([
    visualRole("upper", 121, 62, 28),
    visualRole("lower", 100, 87, 43),
  ]),
  m4: Object.freeze([
    visualRole("upper", 237, 191, 132),
    visualRole("lower", 100, 87, 43),
    visualRole("lower", 72, 42, 24),
  ]),
});

/**
 * Conservative local masks for the quantized atlas. Upper bands stay inside
 * the torso and lower bands stay above the feet; narrow m4 shoulders avoid
 * its quantized skin highlight, which is the same RGB as its shirt fill.
 */
const ATLAS_WARDROBE_BANDS_BY_CHARACTER: Readonly<Record<BeingCharacterId, Readonly<Record<VisualGarmentRegion, VisualWardrobeBand>>>> = Object.freeze({
  m1: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 19, maxY: 31 }),
    lower: Object.freeze({ minX: 2, maxX: 19, minY: 31, maxY: 45 }),
  }),
  f1: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 16, maxY: 31 }),
    lower: Object.freeze({ minX: 2, maxX: 19, minY: 24, maxY: 42 }),
  }),
  f2: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 19, maxY: 37 }),
    lower: Object.freeze({ minX: 4, maxX: 17, minY: 32, maxY: 47 }),
  }),
  f3: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 19, maxY: 32 }),
    lower: Object.freeze({ minX: 3, maxX: 18, minY: 33, maxY: 45 }),
  }),
  m2: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 19, maxY: 39 }),
    lower: Object.freeze({ minX: 3, maxX: 18, minY: 29, maxY: 47 }),
  }),
  m3: Object.freeze({
    upper: Object.freeze({ minX: 3, maxX: 18, minY: 18, maxY: 37 }),
    lower: Object.freeze({ minX: 3, maxX: 18, minY: 31, maxY: 43 }),
  }),
  m4: Object.freeze({
    upper: Object.freeze({ minX: 6, maxX: 14, minY: 18, maxY: 31 }),
    lower: Object.freeze({ minX: 3, maxX: 18, minY: 30, maxY: 44 }),
  }),
});

type VisualPaletteRemapEntry = PaletteRemapEntry & { readonly region: VisualGarmentRegion };

function buildVisualVariantTable(
  characterId: BeingCharacterId,
): Readonly<Record<BeingVisualPaletteVariant, readonly VisualPaletteRemapEntry[]>> {
  const roles = ATLAS_GARMENT_ROLES_BY_CHARACTER[characterId];
  const table = {} as Record<BeingVisualPaletteVariant, readonly VisualPaletteRemapEntry[]>;
  for (const variant of BEING_VISUAL_PALETTE_VARIANTS) {
    table[variant] = Object.freeze(roles.map((role): VisualPaletteRemapEntry => ({
      from: role.from,
      to: hueSaturationRemapVisual(role.from, variant),
      region: role.region,
    })));
  }
  return Object.freeze(table);
}

/** Exact remap tables for every roster character and every v2 garment family. */
export const VISUAL_PALETTE_REMAPS_BY_CHARACTER: Readonly<
  Record<BeingCharacterId, Readonly<Record<BeingVisualPaletteVariant, readonly VisualPaletteRemapEntry[]>>>
> = Object.freeze({
  m1: buildVisualVariantTable("m1"),
  f1: buildVisualVariantTable("f1"),
  f2: buildVisualVariantTable("f2"),
  f3: buildVisualVariantTable("f3"),
  m2: buildVisualVariantTable("m2"),
  m3: buildVisualVariantTable("m3"),
  m4: buildVisualVariantTable("m4"),
});

function requireVisualVariantTable(
  characterId: BeingCharacterId,
): Readonly<Record<BeingVisualPaletteVariant, readonly VisualPaletteRemapEntry[]>> {
  const table = VISUAL_PALETTE_REMAPS_BY_CHARACTER[characterId];
  if (!table) throw new Error(`Being visual palette has no remap tables for character "${characterId}".`);
  return table;
}

/**
 * Apply the v2 table only to the packed character block's wardrobe bands.
 *
 * The original PNG source colors are exact and unambiguous before packing,
 * but the committed atlas is quantized through one shared 128-color palette.
 * That makes a few garment RGBs also occur in hair, hands, straps, or boots.
 * Restricting each exact RGB match to its character-local upper/lower band
 * keeps those body parts native while retaining a visible wardrobe change.
 * An unfamiliar atlas layout stays native: its garment coordinates are not
 * known, so a whole-image remap could also alter skin and hair.
 */
function applyVisualRemap(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  characterId: BeingCharacterId,
  entries: readonly VisualPaletteRemapEntry[],
): void {
  const packedWidth = BEING_CHIBI_GEOMETRY.frameWidth * 5;
  const packedCharacterHeight = BEING_CHIBI_GEOMETRY.frameHeight * 4;
  const packedHeight = packedCharacterHeight * BEING_CHARACTER_IDS.length;
  if (width !== packedWidth || height !== packedHeight) {
    return;
  }

  const characterIndex = BEING_CHARACTER_IDS.indexOf(characterId);
  if (characterIndex < 0) return;
  const blockTop = characterIndex * packedCharacterHeight;
  const bands = ATLAS_WARDROBE_BANDS_BY_CHARACTER[characterId];
  const entriesBySource = new Map<string, readonly VisualPaletteRemapEntry[]>();
  for (const entry of entries) {
    const key = `${entry.from.r},${entry.from.g},${entry.from.b}`;
    const existing = entriesBySource.get(key);
    entriesBySource.set(key, existing === undefined ? [entry] : [...existing, entry]);
  }

  for (let y = blockTop; y < blockTop + packedCharacterHeight; y += 1) {
    const localY = (y - blockTop) % BEING_CHIBI_GEOMETRY.frameHeight;
    for (let x = 0; x < width; x += 1) {
      const localX = x % BEING_CHIBI_GEOMETRY.frameWidth;
      const offset = (y * width + x) * 4;
      const candidates = entriesBySource.get(`${data[offset]},${data[offset + 1]},${data[offset + 2]}`);
      if (candidates === undefined) continue;
      const entry = candidates.find((candidate) => {
        const band = bands[candidate.region];
        return localX >= band.minX && localX <= band.maxX
          && localY >= band.minY && localY <= band.maxY;
      });
      if (entry === undefined) continue;
      data[offset] = entry.to.r;
      data[offset + 1] = entry.to.g;
      data[offset + 2] = entry.to.b;
    }
  }
}

/** Resolve a v2 garment family from the stable being id only. */
export function resolveBeingVisualPaletteVariant(
  agentId: string,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): BeingVisualPaletteVariant {
  const key = ["being-visual-palette-v2", agentId, characterId].join("\0");
  return BEING_VISUAL_PALETTE_VARIANTS[stableHash(key) % BEING_VISUAL_PALETTE_VARIANTS.length]!;
}

function renderVisualPaletteVariant(
  base: CanvasImageSource,
  variant: BeingVisualPaletteVariant,
  characterId: BeingCharacterId,
): CanvasImageSource {
  const { width, height } = sourceDimensions(base);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error(`Being visual palette variant "${characterId}/${variant}" requires a 2D canvas context.`);
  }
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, width, height);
  context.drawImage(base, 0, 0);
  const imageData = context.getImageData(0, 0, width, height);
  applyVisualRemap(imageData.data, width, height, characterId, requireVisualVariantTable(characterId)[variant]);
  context.putImageData(imageData, 0, 0);
  return canvas;
}

/** One cached recolored full-sheet source per (base image, character, v2 family). */
const visualPaletteSourceCache = new WeakMap<CanvasImageSource, Map<string, CanvasImageSource>>();

/** Produce or reuse one bounded v2 recolored atlas source. */
export function createVisualPaletteVariantSource(
  base: CanvasImageSource,
  variant: BeingVisualPaletteVariant,
  characterId: BeingCharacterId = DEFAULT_BEING_CHARACTER_ID,
): CanvasImageSource {
  let perBase = visualPaletteSourceCache.get(base);
  if (perBase === undefined) {
    perBase = new Map<string, CanvasImageSource>();
    visualPaletteSourceCache.set(base, perBase);
  }
  const cacheKey = paletteCacheKey(characterId, variant);
  const cached = perBase.get(cacheKey);
  if (cached !== undefined) return cached;
  const rendered = renderVisualPaletteVariant(base, variant, characterId);
  perBase.set(cacheKey, rendered);
  return rendered;
}

/** Per-family accessory ink, kept separate from source art so no PNG is rewritten. */
const ACCESSORY_INK_BY_VARIANT: Readonly<Record<BeingVisualPaletteVariant, string>> = Object.freeze({
  "slate-blue": "rgb(225 190 112)",
  "violet-grey": "rgb(224 176 211)",
  moss: "rgb(208 197 111)",
  ochre: "rgb(242 195 103)",
  bone: "rgb(170 142 106)",
  terracotta: "rgb(247 183 123)",
  "deep-teal": "rgb(137 211 197)",
  plum: "rgb(235 164 214)",
});

/** Pixel coordinates are cell-local; all lie below the face band (y >= 22). */
const ACCESSORY_PIXELS: Readonly<Record<Exclude<BeingAccessory, "none">, readonly (readonly [number, number])[]>> = Object.freeze({
  scarf: Object.freeze([
    [8, 22], [9, 23], [10, 23], [11, 23], [12, 24], [12, 25], [13, 26],
  ] as const),
  collar: Object.freeze([
    [8, 22], [9, 23], [10, 23], [11, 23], [12, 22],
  ] as const),
  satchel: Object.freeze([
    [7, 22], [8, 23], [9, 24], [10, 25], [11, 26], [12, 27], [13, 28],
    [13, 29], [14, 29], [15, 29], [13, 30], [14, 30], [15, 30], [13, 31], [14, 31], [15, 31],
  ] as const),
  belt: Object.freeze([
    [6, 33], [7, 33], [8, 33], [9, 33], [10, 33], [11, 33], [12, 33], [13, 33], [14, 33], [15, 33], [16, 33],
    [10, 34], [11, 34],
  ] as const),
});

/**
 * Draw one stable pixel-grid accessory in the caller's current frame space.
 * The actor supplies `(-feet.x, -feet.y)` after applying its normal pose,
 * scale, and mirror transform; portraits supply `(0, 0)`. Thus the same
 * pattern follows every frame and direction without a second atlas or a
 * per-frame canvas allocation.
 */
export function drawBeingAccessory(
  context: CanvasRenderingContext2D,
  accessory: BeingAccessory,
  paletteVariant: BeingVisualPaletteVariant,
  originX = -11,
  originY = -46,
): void {
  if (accessory === "none") return;
  const pixels = ACCESSORY_PIXELS[accessory];
  if (!pixels) return;
  const previousFillStyle = context.fillStyle;
  context.fillStyle = ACCESSORY_INK_BY_VARIANT[paletteVariant];
  for (let index = 0; index < pixels.length; index += 1) {
    const pixel = pixels[index]!;
    context.fillRect(originX + pixel[0], originY + pixel[1], 1, 1);
  }
  context.fillStyle = previousFillStyle;
}
