import { describe, expect, it } from "vitest";

import { estimateRunCost, formatDuration, formatUsd } from "./costEstimate";
import { MOCK_RUN_DEFAULTS_PAYLOAD } from "./mockRunLifecycleClient";
import { parseRunDefaults, type RunConfig, type RunDefaults } from "./runConfig";

/**
 * A minimal defaults payload — the contract, not the bytes.
 *
 * Deliberately smaller than the real response and deliberately silent about the
 * cost caveat, so the parser's "publish nothing, invent nothing" behaviour is
 * exercised. `estimateRunCost` against the *real* captured payload is covered
 * separately below.
 */
function defaults(): RunDefaults {
  return parseRunDefaults({
    schema: 1,
    defaults: {
      beings: [
        { name: "Joe", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Mae", start_region: "warm_springs", energy: 100, materials: 45 },
        { name: "Dick", start_region: "nirvana", energy: 100, materials: 45 },
        { name: "Allen", start_region: "nirvana", energy: 100, materials: 45 },
      ],
      abundance: 1,
      seed: 7,
      duration_seconds: 1800,
      provider: "gemini",
      reflect_every_n_breaths: 12,
      max_offspring: 5,
    },
    knobs: {
      beings: {
        label: "Beings",
        min_count: 1,
        max_count: 12,
        default_count: 4,
        fields: {
          energy: { label: "Energy", min: 50, max: 200, step: 5 },
          materials: { label: "Materials", min: 0, max: 100, step: 1 },
        },
      },
      abundance: { label: "Abundance", min: 0.25, max: 3, step: 0.05 },
      seed: { label: "Seed", min: 0, max: 999999, step: 1 },
      max_offspring: { label: "Children", min: 0, max: 10, step: 1 },
      duration_seconds: {
        label: "Length",
        choices: [
          { value: 1800, label: "30 minutes" },
          { value: null, label: "until stopped" },
        ],
      },
      provider: {
        label: "Minds",
        choices: [
          {
            value: "gemini",
            label: "the cloud",
            cost_per_being_hour_usd: 3,
            cadence: "a breath every few seconds",
          },
          {
            value: "ollama",
            label: "this machine",
            cost_per_being_hour_usd: 0,
            cadence: "minutes between breaths",
          },
        ],
      },
      reflect_every_n_breaths: { label: "Reflection", choices: [{ value: 12, label: "every 12" }] },
    },
    regions: [],
    locked: { world_tick_interval_seconds: 5 },
  });
}

function config(overrides: Partial<RunConfig> = {}): RunConfig {
  return { ...defaults().config, ...overrides };
}

describe("estimateRunCost", () => {
  it("multiplies the measured per-being rate by the roster and the run length", () => {
    const estimate = estimateRunCost(config(), defaults());

    expect(estimate.perHourUsd).toBe(12);
    expect(estimate.totalUsd).toBe(6);
    expect(estimate.bounded).toBe(true);
    expect(estimate.free).toBe(false);
    expect(estimate.cadence).toBe("a breath every few seconds");
    expect(estimate.providerLabel).toBe("the cloud");
  });

  it("reports a rate but no total for a run with no scheduled end", () => {
    const estimate = estimateRunCost(config({ duration_seconds: null }), defaults());

    expect(estimate.perHourUsd).toBe(12);
    expect(estimate.totalUsd).toBeNull();
    expect(estimate.bounded).toBe(false);
  });

  it("knows when the minds cost nothing", () => {
    const estimate = estimateRunCost(config({ provider: "ollama" }), defaults());

    expect(estimate.perHourUsd).toBe(0);
    expect(estimate.totalUsd).toBe(0);
    expect(estimate.free).toBe(true);
    expect(estimate.cadence).toBe("minutes between breaths");
  });

  it("scales with the roster", () => {
    const roster = config({ beings: [defaults().config.beings[0] as never] });

    expect(estimateRunCost(roster, defaults()).perHourUsd).toBe(3);
  });

  it("refuses to guess a rate for a provider the server did not describe", () => {
    const estimate = estimateRunCost(config({ provider: "mystery" }), defaults());

    expect(estimate.perHourUsd).toBeNull();
    expect(estimate.totalUsd).toBeNull();
    expect(estimate.cadence).toBeNull();
    expect(estimate.providerLabel).toBe("mystery");
  });

  it("prices the real server's own payload, which now publishes a rate per place", () => {
    const real = parseRunDefaults(structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD));
    const estimate = estimateRunCost(real.config, real);

    // 4 beings × $3/being-hour, over the world's own 30-minute default.
    expect(estimate.perHourUsd).toBe(12);
    expect(estimate.totalUsd).toBe(6);
    expect(estimate.free).toBe(false);
    expect(estimate.providerLabel).toBe("The cloud");
    expect(estimate.cadence).toBe("a breath every second or two");
  });

  it("reads this machine as free and slow on the real payload", () => {
    const real = parseRunDefaults(structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD));
    const estimate = estimateRunCost({ ...real.config, provider: "ollama" }, real);

    expect(estimate.perHourUsd).toBe(0);
    expect(estimate.totalUsd).toBe(0);
    expect(estimate.free).toBe(true);
    expect(estimate.cadence).toContain("minutes between breaths");
  });

  it("changes with the roster AND with the place, on the real payload", () => {
    const real = parseRunDefaults(structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD));
    const one = real.config.beings[0] as never;
    const single = { ...real.config, beings: [one] };

    expect(estimateRunCost(single, real).perHourUsd).toBe(3);
    expect(estimateRunCost({ ...single, provider: "ollama" }, real).perHourUsd).toBe(0);
  });
});

describe("the estimate's honesty caveat", () => {
  it("is published by the server and carried through the parse", () => {
    const real = parseRunDefaults(structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD));

    expect(real.cost_estimate_note).not.toBeNull();
    expect(real.cost_estimate_note).toContain("Indicative, not a quote");
  });

  it("says a long run costs more per hour than the figure shown", () => {
    const real = parseRunDefaults(structuredClone(MOCK_RUN_DEFAULTS_PAYLOAD));

    expect(real.cost_estimate_note).toContain("grows");
    expect(real.cost_estimate_note).toContain("43,000");
  });

  it("is null, not invented, when the server publishes none", () => {
    expect(defaults().cost_estimate_note).toBeNull();
  });
});

describe("formatUsd", () => {
  it.each([
    [0, "$0"],
    [6, "$6"],
    [12, "$12"],
    [1.5, "$1.50"],
    [0.25, "$0.25"],
    [0.004, "under $0.01"],
    [1234, "$1,234"],
  ])("renders %s as %s", (value, expected) => {
    expect(formatUsd(value)).toBe(expected);
  });
});

describe("formatDuration", () => {
  it.each([
    [900, "15 minutes"],
    [1800, "30 minutes"],
    [3600, "1 hour"],
    [14_400, "4 hours"],
    [5400, "1 hour 30 minutes"],
    [45, "45 seconds"],
  ])("renders %s seconds as %s", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("says plainly that an unbounded run has no end", () => {
    expect(formatDuration(null)).toBe("until someone stops it");
  });
});
