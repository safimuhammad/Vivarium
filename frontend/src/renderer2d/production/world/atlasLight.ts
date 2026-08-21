/**
 * @fileoverview The atlas's time-of-day light pass (design of record:
 * `docs/frontend/ATLAS_VIEW.md` §5, "Time of day is real").
 *
 * One pure call per frame resolves the whole map's palette from the world's own clock: the sea's
 * near/far gradient, its wave ticks, the three water contour bands, the tint and strength of the
 * single light pass laid over the land layer, the shadow depth, and whether lit things
 * (hearths, being halos) are drawn at all.
 *
 * Day is neutral; dusk warms the land and deepens the shadow; night desaturates everything and
 * then the hearths come on, so the map becomes a constellation of who is alive and where. A screen
 * left on for hours *changes*, from one tint pass and no new data.
 *
 * Zero imports, no clock of its own: the caller passes the day fraction it read off the frame
 * (`frame.world.worldTime`, seconds, {@link SECONDS_PER_WORLD_DAY} to a day -- the same day length
 * `publicViewModels.ts`'s `formatWorldTime` already shows in the HUD).
 */

/** Seconds in one world day -- the same divisor the HUD's `Day N, H:MM` label uses. */
export const SECONDS_PER_WORLD_DAY = 86_400;

/** The resolved palette for one moment of the world's day. */
export interface AtlasLight {
  /** A coarse name for the current light (`"night" | "dawn" | "day" | "dusk"`), for diagnostics. */
  readonly name: string;
  /** Day fraction this light was resolved from, in `[0, 1)`. */
  readonly dayFraction: number;
  /** Sea radial gradient, centre and rim. */
  readonly seaNear: string;
  readonly seaFar: string;
  /** Wave tick colour on the open sea. */
  readonly wave: string;
  /** The three water contour bands, shallowest last. */
  readonly shelf: string;
  readonly shallow: string;
  readonly foam: string;
  /** Breaking surf, right at the waterline. */
  readonly surf: string;
  /** The single light pass laid over everything that stands in the world. */
  readonly landTint: string;
  readonly landTintA: number;
  /** How dark an island's cast shadow falls into the water. */
  readonly shadowA: number;
  /** Whether hearths, being halos and event pulses light up. */
  readonly glow: boolean;
  /** How strong that glow is, in `[0, 1]` -- eases in through dusk rather than switching on. */
  readonly glowStrength: number;
}

interface LightKey {
  readonly at: number;
  readonly name: string;
  readonly seaNear: string;
  readonly seaFar: string;
  readonly wave: string;
  readonly shelf: string;
  readonly shallow: string;
  readonly foam: string;
  readonly surf: string;
  readonly landTint: string;
  readonly landTintA: number;
  readonly shadowA: number;
  readonly glowStrength: number;
}

/**
 * The keyframes, in day fraction order (0 = midnight). Day and dusk are exactly the palettes the
 * approved plates were rendered from (`docs/frontend/mockups/atlas-impl/`); dawn is dusk's cooler
 * mirror, and the pair of `day` keys hold the middle of the day flat so noon does not drift.
 */
const KEYS: readonly LightKey[] = Object.freeze([
  {
    at: 0, name: "night",
    seaNear: "#0a2e46", seaFar: "#03162a", wave: "#43738f",
    shelf: "#143d57", shallow: "#22586f", foam: "#96bacc", surf: "#b9d3df",
    landTint: "#2a3f78", landTintA: 0.46, shadowA: 0.5, glowStrength: 1,
  },
  {
    at: 0.21, name: "dawn",
    seaNear: "#12617a", seaFar: "#06334a", wave: "#66a3b3",
    shelf: "#1d7489", shallow: "#4b979c", foam: "#e3d8c6", surf: "#f3ecdd",
    landTint: "#ff9d5c", landTintA: 0.15, shadowA: 0.4, glowStrength: 0.45,
  },
  {
    at: 0.32, name: "day",
    seaNear: "#0a6d81", seaFar: "#014a5e", wave: "#6dbdb4",
    shelf: "#1b8a99", shallow: "#4bb2a6", foam: "#cdeade", surf: "#fdfffb",
    landTint: "#ffe9c0", landTintA: 0.05, shadowA: 0.34, glowStrength: 0,
  },
  {
    at: 0.7, name: "day",
    seaNear: "#0a6d81", seaFar: "#014a5e", wave: "#6dbdb4",
    shelf: "#1b8a99", shallow: "#4bb2a6", foam: "#cdeade", surf: "#fdfffb",
    landTint: "#ffe9c0", landTintA: 0.05, shadowA: 0.34, glowStrength: 0,
  },
  {
    at: 0.82, name: "dusk",
    seaNear: "#12617a", seaFar: "#06334a", wave: "#66a3b3",
    shelf: "#1d7489", shallow: "#4b979c", foam: "#eed6ba", surf: "#fbe9cf",
    landTint: "#ff9d5c", landTintA: 0.19, shadowA: 0.42, glowStrength: 0.7,
  },
  {
    at: 0.92, name: "night",
    seaNear: "#0a2e46", seaFar: "#03162a", wave: "#43738f",
    shelf: "#143d57", shallow: "#22586f", foam: "#96bacc", surf: "#b9d3df",
    landTint: "#2a3f78", landTintA: 0.46, shadowA: 0.5, glowStrength: 1,
  },
]);

/**
 * Applies the same light pass to a flat colour that {@link resolveAtlasLight} applies to the land
 * layer -- used for the things drawn as vector marks rather than as raster layers (bridge decks,
 * huts, ruins), so a bridge at night is as dark as the island it lands on.
 *
 * @param base - A `#rrggbb` colour.
 * @param light - The current light.
 * @returns The tinted `#rrggbb` colour.
 */
export function tintedHex(base: string, light: AtlasLight): string {
  if (light.landTintA <= 0) return base;
  return mixHex(base, light.landTint, light.landTintA);
}

function parseHex(value: string): readonly [number, number, number] {
  return [
    parseInt(value.slice(1, 3), 16),
    parseInt(value.slice(3, 5), 16),
    parseInt(value.slice(5, 7), 16),
  ];
}

function toHex(channel: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(channel)));
  return clamped.toString(16).padStart(2, "0");
}

function mixHex(from: string, to: string, t: number): string {
  const [r0, g0, b0] = parseHex(from);
  const [r1, g1, b1] = parseHex(to);
  return `#${toHex(r0 + (r1 - r0) * t)}${toHex(g0 + (g1 - g0) * t)}${toHex(b0 + (b1 - b0) * t)}`;
}

/**
 * Converts a world clock reading into a day fraction.
 *
 * @param worldTime - `frame.world.worldTime`, in seconds. Non-finite input resolves to midday, so
 *   a frame missing a clock still renders a legible map rather than a black one.
 * @returns The fraction of the world day elapsed, in `[0, 1)`.
 */
export function atlasDayFraction(worldTime: number): number {
  if (!Number.isFinite(worldTime)) return 0.5;
  const withinDay = ((worldTime % SECONDS_PER_WORLD_DAY) + SECONDS_PER_WORLD_DAY) % SECONDS_PER_WORLD_DAY;
  return withinDay / SECONDS_PER_WORLD_DAY;
}

/**
 * Resolves the whole map's light for one moment of the world's day.
 *
 * @param dayFraction - Fraction of the world day elapsed (see {@link atlasDayFraction}). Values
 *   outside `[0, 1)` wrap.
 * @returns The palette for this moment. Colours are interpolated between the keyframes, so the map
 *   changes continuously rather than snapping between three named looks.
 */
export function resolveAtlasLight(dayFraction: number): AtlasLight {
  const fraction = Number.isFinite(dayFraction) ? ((dayFraction % 1) + 1) % 1 : 0.5;
  let lower = KEYS[KEYS.length - 1] as LightKey;
  let upper = KEYS[0] as LightKey;
  let span = (KEYS[0] as LightKey).at + (1 - (KEYS[KEYS.length - 1] as LightKey).at);
  let offset = fraction < (KEYS[0] as LightKey).at
    ? fraction + (1 - (KEYS[KEYS.length - 1] as LightKey).at)
    : fraction - (KEYS[KEYS.length - 1] as LightKey).at;
  for (let index = 0; index < KEYS.length - 1; index += 1) {
    const a = KEYS[index] as LightKey;
    const b = KEYS[index + 1] as LightKey;
    if (fraction >= a.at && fraction < b.at) {
      lower = a;
      upper = b;
      span = b.at - a.at;
      offset = fraction - a.at;
      break;
    }
  }
  const t = span <= 0 ? 0 : Math.max(0, Math.min(1, offset / span));
  const eased = t * t * (3 - 2 * t);
  const glowStrength = lower.glowStrength + (upper.glowStrength - lower.glowStrength) * eased;
  return Object.freeze({
    name: eased < 0.5 ? lower.name : upper.name,
    dayFraction: fraction,
    seaNear: mixHex(lower.seaNear, upper.seaNear, eased),
    seaFar: mixHex(lower.seaFar, upper.seaFar, eased),
    wave: mixHex(lower.wave, upper.wave, eased),
    shelf: mixHex(lower.shelf, upper.shelf, eased),
    shallow: mixHex(lower.shallow, upper.shallow, eased),
    foam: mixHex(lower.foam, upper.foam, eased),
    surf: mixHex(lower.surf, upper.surf, eased),
    landTint: mixHex(lower.landTint, upper.landTint, eased),
    landTintA: lower.landTintA + (upper.landTintA - lower.landTintA) * eased,
    shadowA: lower.shadowA + (upper.shadowA - lower.shadowA) * eased,
    glow: glowStrength > 0.02,
    glowStrength,
  });
}
