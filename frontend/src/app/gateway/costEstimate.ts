/**
 * What a run will cost and how fast it will think.
 *
 * The roster size is the biggest lever on both (spec §3.2 knob 1), so the
 * configuration screen shows the consequence next to the dial rather than
 * leaving a viewer to discover it on a bill. The per-being hourly rate is a
 * measured figure that lives on the server (`cost_per_being_hour_usd`, published
 * per place the minds can run), so a re-measurement moves this estimate without
 * a frontend change — and a provider the server did not describe, or described
 * without a rate, yields `null`, never a guess.
 *
 * **The number is indicative, not a quote, and the screen must say so.** Two
 * measured reasons, both carried in the server's own `cost_estimate_note`: the
 * per-token prices behind the rate are unconfirmed placeholders, and cost per
 * hour is not flat within a run — lifecycle history accumulates into every
 * prompt, so a long run costs more per hour at its end than at its start.
 */

import type { RunConfig, RunDefaults } from "./runConfig";

/** The cost and cadence consequences of one draft. */
export interface RunCostEstimate {
  /** Cost of every being thinking for an hour, or `null` if unknown. */
  readonly perHourUsd: number | null;
  /** Cost of the whole run; `null` when unbounded or when the rate is unknown. */
  readonly totalUsd: number | null;
  /** False when the run has no scheduled end. */
  readonly bounded: boolean;
  /** True only when the rate is known to be zero. */
  readonly free: boolean;
  /** How fast a being thinks here, in the server's own words. */
  readonly cadence: string | null;
  /** The viewer-facing name of the chosen place, falling back to its key. */
  readonly providerLabel: string;
}

/**
 * Estimates the cost and cadence of a draft.
 *
 * @param config - The draft being configured.
 * @param defaults - The server payload, which owns the measured rates.
 * @returns The consequences to show beside the roster and provider controls.
 */
export function estimateRunCost(config: RunConfig, defaults: RunDefaults): RunCostEstimate {
  const option = defaults.knobs.provider.options.find(
    (candidate) => candidate.value === config.provider,
  );
  const bounded = config.duration_seconds !== null;
  if (option === undefined) {
    return {
      perHourUsd: null,
      totalUsd: null,
      bounded,
      free: false,
      cadence: null,
      providerLabel: config.provider,
    };
  }
  if (option.cost_per_being_hour_usd === null) {
    return {
      perHourUsd: null,
      totalUsd: null,
      bounded,
      free: false,
      cadence: option.cadence,
      providerLabel: option.label,
    };
  }
  const perHourUsd = option.cost_per_being_hour_usd * config.beings.length;
  const hours = config.duration_seconds === null ? null : config.duration_seconds / 3600;
  return {
    perHourUsd,
    totalUsd: hours === null ? null : perHourUsd * hours,
    bounded,
    free: perHourUsd === 0,
    cadence: option.cadence,
    providerLabel: option.label,
  };
}

/**
 * Renders a dollar amount the way a viewer reads one.
 *
 * Whole amounts lose their trailing zeros; anything that would round to `$0.00`
 * says "under $0.01" instead, because a screen that reports free when it is not
 * is exactly the kind of lie this piece is careful about.
 */
export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "under $0.01";
  const rounded = Math.round(value * 100) / 100;
  const whole = Number.isInteger(rounded);
  return `$${rounded.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Renders a run length in plain words; `null` is an unbounded run. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null) return "until someone stops it";
  if (seconds < 60) return `${seconds} ${plural(seconds, "second")}`;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} ${plural(minutes, "minute")}`;
  if (minutes === 0) return `${hours} ${plural(hours, "hour")}`;
  return `${hours} ${plural(hours, "hour")} ${minutes} ${plural(minutes, "minute")}`;
}

function plural(count: number, word: string): string {
  return count === 1 ? word : `${word}s`;
}
