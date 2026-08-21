/**
 * Pure edits to a `RunConfig`, every one bounded by the server's own knobs.
 *
 * The configuration screen owns no ranges. Each function here takes the
 * `RunDefaults` payload alongside the draft and clamps to *that*, so a tuning
 * change in `core/constants.py` moves both the slider and what the slider is
 * allowed to produce. Nothing in this module knows a number the server did not
 * send it, with one documented exception: the ordinal names given to beings
 * beyond the authored founders (see `EXTRA_BEING_NAMES`).
 *
 * Two shapes deliberately do not exist here:
 *
 * - **No region editing.** Regions are locked (spec §2). `setBeingRegion` can
 *   only move a being between regions the server published; anything else is
 *   ignored rather than accepted and silently dropped later.
 * - **No mating timeout, no memory root.** Both are derived by the server from
 *   `(provider, being count)` and per-run respectively (spec §5), and are not
 *   in `RunConfig` at all.
 */

import type {
  BeingConfig,
  NumericKnob,
  RunConfig,
  RunDefaults,
} from "./runConfig";

/**
 * Names for beings past the four the server publishes.
 *
 * `config/world.yaml` says it plainly: "Names are arbitrary labels, not
 * characters." These are ordinals for exactly that reason — they place a being
 * on the roster without authoring anything about who it is, and the viewer is
 * expected to type over them. Naming them after anything would be us writing a
 * character, which this world does not do.
 */
const EXTRA_BEING_NAMES: readonly string[] = [
  "Fifth",
  "Sixth",
  "Seventh",
  "Eighth",
  "Ninth",
  "Tenth",
  "Eleventh",
  "Twelfth",
  "Thirteenth",
  "Fourteenth",
  "Fifteenth",
  "Sixteenth",
];

/** A gentle, non-blocking observation about a draft the viewer may want. */
export interface ConfigNotice {
  readonly id: "all-alone" | "below-mating-floor" | "thin-land";
  readonly tone: "caution" | "note";
  readonly message: string;
}

/**
 * Resizes the roster.
 *
 * Growing appends beings that carry the roster's current starting stock and are
 * placed into the designed regions in turn, so a larger world does not silently
 * pile every newcomer into one place. Shrinking drops from the end, which keeps
 * every name, region and persona the viewer already wrote on the beings that
 * remain.
 *
 * @param config - The draft being edited.
 * @param defaults - The server payload; supplies the count bounds and regions.
 * @param count - The requested roster size, clamped to the `being_count` knob.
 * @returns A new draft; the input is never mutated.
 */
export function setBeingCount(
  config: RunConfig,
  defaults: RunDefaults,
  count: number,
): RunConfig {
  const target = Math.round(clamp(count, defaults.knobs.being_count));
  if (target === config.beings.length) return config;
  if (target < config.beings.length) {
    return { ...config, beings: config.beings.slice(0, target) };
  }
  const regions = regionKeys(defaults);
  const stock = uniformStock(config);
  const template = config.beings.at(-1) ?? defaults.config.beings[0];
  const beings: BeingConfig[] = [...config.beings];
  while (beings.length < target) {
    const index = beings.length;
    beings.push({
      name: defaults.config.beings[index]?.name
        ?? EXTRA_BEING_NAMES[index - defaults.config.beings.length]
        ?? `Being ${index + 1}`,
      start_region: regions[index % Math.max(regions.length, 1)]
        ?? template?.start_region
        ?? "",
      energy: stock.energy ?? template?.energy ?? defaults.knobs.energy.min,
      materials: stock.materials ?? template?.materials ?? defaults.knobs.materials.min,
      persona: null,
    });
  }
  return { ...config, beings };
}

/** Sets every being's starting energy at once, clamped and snapped to the knob. */
export function setUniformEnergy(
  config: RunConfig,
  defaults: RunDefaults,
  energy: number,
): RunConfig {
  const value = snap(energy, defaults.knobs.energy);
  return { ...config, beings: config.beings.map((being) => ({ ...being, energy: value })) };
}

/** Sets every being's starting materials at once, clamped and snapped to the knob. */
export function setUniformMaterials(
  config: RunConfig,
  defaults: RunDefaults,
  materials: number,
): RunConfig {
  const value = snap(materials, defaults.knobs.materials);
  return { ...config, beings: config.beings.map((being) => ({ ...being, materials: value })) };
}

/**
 * Reports the roster's shared starting stock.
 *
 * `null` means the beings do not agree — which the screen must say rather than
 * showing one of them and implying all. A config fetched from a running world
 * can be non-uniform even though this screen only ever writes uniform stock.
 */
export function uniformStock(config: RunConfig): {
  readonly energy: number | null;
  readonly materials: number | null;
} {
  return {
    energy: sharedValue(config.beings.map((being) => being.energy)),
    materials: sharedValue(config.beings.map((being) => being.materials)),
  };
}

/** Renames one being. Surrounding whitespace is dropped; an index off the roster is ignored. */
export function setBeingName(config: RunConfig, index: number, name: string): RunConfig {
  return editBeing(config, index, (being) => ({ ...being, name: name.trim() }));
}

/**
 * Moves one being to a different starting region.
 *
 * The server's published region list is the authority. A key it did not publish
 * is ignored outright — regions are locked (spec §2), and accepting an unknown
 * one would produce a payload the server rejects, or worse, a name the art
 * registry silently downgrades to generic terrain.
 */
export function setBeingRegion(
  config: RunConfig,
  defaults: RunDefaults,
  index: number,
  region: string,
): RunConfig {
  const known = new Set([
    ...regionKeys(defaults),
    ...config.beings.map((being) => being.start_region),
  ]);
  return editBeing(config, index, (being) => (
    known.has(region) ? { ...being, start_region: region } : being
  ));
}

/**
 * Writes (or clears) one being's persona.
 *
 * A blank string is stored as `null`, meaning "born from the shared genesis
 * seed" — the default, and materially different from being born from an empty
 * persona.
 */
export function setBeingPersona(
  config: RunConfig,
  index: number,
  persona: string,
): RunConfig {
  return editBeing(config, index, (being) => ({
    ...being,
    persona: persona.trim().length === 0 ? null : persona,
  }));
}

/** Sets the single world-abundance multiplier, clamped and snapped to the knob. */
export function setAbundance(
  config: RunConfig,
  defaults: RunDefaults,
  abundance: number,
): RunConfig {
  return { ...config, abundance: snap(abundance, defaults.knobs.abundance) };
}

/** Sets the land-shape seed, clamped to the knob and kept whole. */
export function setSeed(config: RunConfig, defaults: RunDefaults, seed: number): RunConfig {
  return { ...config, seed: Math.round(clamp(seed, defaults.knobs.seed)) };
}

/**
 * Draws a new land shape.
 *
 * The span is inclusive of both ends — a seed knob describes whole numbers, and
 * a roll that can never reach its own maximum is a quietly wrong dial.
 *
 * @param random - Injected source in `[0, 1)`. Injected rather than reached for
 *   so the roll is reproducible in a test, which is the same discipline the
 *   backend applies to its own RNG.
 */
export function rollSeed(
  config: RunConfig,
  defaults: RunDefaults,
  random: () => number,
): RunConfig {
  const knob = defaults.knobs.seed;
  const span = knob.max - knob.min + 1;
  return setSeed(config, defaults, Math.floor(knob.min + random() * span));
}

/** Selects a run length. A value the server did not offer leaves the draft unchanged. */
export function setDuration(
  config: RunConfig,
  defaults: RunDefaults,
  duration: number | null,
): RunConfig {
  const offered = defaults.knobs.duration.options.some((option) => option.value === duration);
  return offered ? { ...config, duration_seconds: duration } : config;
}

/** Selects where the minds run. A value the server did not offer is ignored. */
export function setProvider(
  config: RunConfig,
  defaults: RunDefaults,
  provider: string,
): RunConfig {
  const offered = defaults.knobs.provider.options.some((option) => option.value === provider);
  return offered ? { ...config, provider } : config;
}

/** Selects the reflection cadence. A value the server did not offer is ignored. */
export function setReflectEveryNBreaths(
  config: RunConfig,
  defaults: RunDefaults,
  breaths: number,
): RunConfig {
  const offered = defaults.knobs.reflect.options.some((option) => option.value === breaths);
  return offered ? { ...config, reflect_every_n_breaths: breaths } : config;
}

/** Sets the population ceiling, clamped to the knob and kept whole. */
export function setMaxOffspring(
  config: RunConfig,
  defaults: RunDefaults,
  maxOffspring: number,
): RunConfig {
  return {
    ...config,
    max_offspring: Math.round(clamp(maxOffspring, defaults.knobs.max_offspring)),
  };
}

/**
 * Observations worth showing before a run begins — never blocking, never scolding.
 *
 * Each one is a measured consequence, not a preference:
 *
 * - `all-alone`: every being in a region of its own is legal and produces a
 *   near-dead run, because nothing social can happen until someone walks.
 * - `below-mating-floor`: the roster starts under the materials a pair must put
 *   toward a child, read from the marker the server drew on the slider. Silent
 *   when the server published no such marker — a warning about a number we made
 *   up would be worse than no warning.
 * - `thin-land`: abundance at the very bottom of its band. This is the dial that
 *   once flipped a run from collapse to thriving; the low end is a choice, and
 *   saying so is not the same as discouraging it.
 */
export function configNotices(
  config: RunConfig,
  defaults: RunDefaults,
): readonly ConfigNotice[] {
  const notices: ConfigNotice[] = [];
  const occupied = new Map<string, number>();
  for (const being of config.beings) {
    occupied.set(being.start_region, (occupied.get(being.start_region) ?? 0) + 1);
  }
  if (config.beings.length > 1 && [...occupied.values()].every((count) => count === 1)) {
    notices.push({
      id: "all-alone",
      tone: "caution",
      message:
        "Every being begins alone. Nothing between them can happen until one of them walks.",
    });
  }
  const matingFloor = defaults.knobs.materials.markers[0]?.value ?? null;
  const stock = uniformStock(config).materials;
  if (matingFloor !== null && stock !== null && stock < matingFloor) {
    notices.push({
      id: "below-mating-floor",
      tone: "note",
      message:
        `No being begins with the ${matingFloor} materials a pair must put toward a child. `
        + "They will have to gather first.",
    });
  }
  if (config.abundance <= defaults.knobs.abundance.min) {
    notices.push({
      id: "thin-land",
      tone: "note",
      message: "The land is set as thin as it goes. Expect want, and expect it early.",
    });
  }
  return notices;
}

/** The locked region keys, in the order the server published them. */
export function regionKeys(defaults: RunDefaults): readonly string[] {
  return defaults.regions.length > 0
    ? defaults.regions.map((region) => region.key)
    : [...new Set(defaults.config.beings.map((being) => being.start_region))];
}

function editBeing(
  config: RunConfig,
  index: number,
  edit: (being: BeingConfig) => BeingConfig,
): RunConfig {
  if (index < 0 || index >= config.beings.length) return config;
  return {
    ...config,
    beings: config.beings.map((being, at) => (at === index ? edit(being) : being)),
  };
}

function sharedValue(values: readonly number[]): number | null {
  const first = values[0];
  if (first === undefined) return null;
  return values.every((value) => value === first) ? first : null;
}

function clamp(value: number, knob: NumericKnob): number {
  if (!Number.isFinite(value)) return knob.min;
  return Math.min(knob.max, Math.max(knob.min, value));
}

function snap(value: number, knob: NumericKnob): number {
  const clamped = clamp(value, knob);
  const steps = Math.round((clamped - knob.min) / knob.step);
  const snapped = knob.min + steps * knob.step;
  // Re-clamp: the final step can overshoot when the range is not a whole
  // multiple of the step, and rounding keeps 0.05-step sliders off 1.1500000002.
  return round(Math.min(knob.max, Math.max(knob.min, snapped)));
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
